mod api_client;
mod autostart;
mod cache;
mod idle;
mod input;
mod lifecycle;
mod models;
mod settings;
mod windowing;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

use api_client::XApiClient;
use idle::IdleProvider;
use lifecycle::{LifecycleConfig, LifecycleMachine, ScreensaverState, StateTransition};
use models::{Post, PostCache};
use settings::{AppSettings, ScreensaverDisplayTarget};
use windowing::MonitorInfo;

// ---------------------------------------------------------------------------
// Store keys — single source of truth for tauri-plugin-store key names
// ---------------------------------------------------------------------------

const STORE_KEY_BEARER_TOKEN: &str = "bearer_token";
const STORE_KEY_APP_SETTINGS: &str = "app_settings";

const STORE_FILE_ENV: &str = "FLIPTRIX_STORE_FILE";
const APP_DATA_DIR_ENV: &str = "FLIPTRIX_APP_DATA_DIR";
const BEARER_TOKEN_ENV: &str = "FLIPTRIX_BEARER_TOKEN";

/// Short git commit hash injected at compile time by build.rs.
/// Falls back to "dev" when not building from a git checkout.
const GIT_HASH: &str = match option_env!("FLIPTRIX_GIT_HASH") {
    Some(hash) => hash,
    None => "dev",
};

/// Tauri app identifier — must match `tauri.conf.json` → `identifier`.
const APP_ID: &str = "com.fliptrix.desktop";

fn store_file_name() -> String {
    match std::env::var(STORE_FILE_ENV) {
        Ok(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                "store.json".to_string()
            } else {
                trimmed.to_string()
            }
        }
        Err(_) => "store.json".to_string(),
    }
}

fn resolve_app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(override_dir) = std::env::var(APP_DATA_DIR_ENV) {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            let path = std::path::PathBuf::from(trimmed);
            std::fs::create_dir_all(&path).map_err(|e| {
                format!(
                    "failed to create e2e app data dir '{}': {e}",
                    path.display()
                )
            })?;
            return Ok(path);
        }
    }

    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("failed to create app data dir '{}': {e}", path.display()))?;
    Ok(path)
}

/// Runtime flag that controls whether debug/trace logs are emitted.
static DEBUG_LOGGING_ENABLED: AtomicBool = AtomicBool::new(false);

fn set_debug_logging_enabled(enabled: bool) {
    DEBUG_LOGGING_ENABLED.store(enabled, Ordering::Relaxed);
}

fn should_emit_log(metadata: &log::Metadata<'_>) -> bool {
    if matches!(metadata.level(), log::Level::Debug | log::Level::Trace)
        && !DEBUG_LOGGING_ENABLED.load(Ordering::Relaxed)
    {
        return false;
    }

    !matches!(metadata.target(), "hyper" | "h2" | "mio")
}

// ---------------------------------------------------------------------------
// Shared state managed by Tauri
// ---------------------------------------------------------------------------

/// Holds the lifecycle state machine, screensaver configuration, and X API
/// client behind Mutexes so Tauri commands and the background poller can
/// share them safely.
struct AppState {
    lifecycle: Mutex<LifecycleMachine>,
    idle_provider: Mutex<Option<Box<dyn IdleProvider>>>,
    /// Current user settings. Kept in-memory so the screensaver overlay can
    /// read renderer parameters without an IPC round-trip at activation time.
    settings: Mutex<AppSettings>,
    /// X API client. `None` until the user sets a bearer token.
    api_client: Mutex<Option<XApiClient>>,
    /// Path to the app data directory (for cache file I/O).
    app_data_dir: std::path::PathBuf,
}

// ---------------------------------------------------------------------------
// Tauri commands — Phase 2
// ---------------------------------------------------------------------------

/// Returns the current system idle time in seconds, or an error message if
/// idle detection is unavailable (headless, Wayland, missing libs, etc.).
#[tauri::command]
fn get_idle_seconds(state: tauri::State<'_, AppState>) -> Result<u64, String> {
    let guard = state
        .idle_provider
        .lock()
        .map_err(|e| format!("idle provider lock poisoned: {e}"))?;
    match guard.as_ref() {
        Some(provider) => provider.idle_seconds(),
        None => Err("idle detection is not available on this platform/session".into()),
    }
}

/// Returns the current lifecycle state as a JSON-serializable string.
#[tauri::command]
fn get_lifecycle_state(state: tauri::State<'_, AppState>) -> Result<ScreensaverState, String> {
    let guard = state
        .lifecycle
        .lock()
        .map_err(|e| format!("lifecycle lock poisoned: {e}"))?;
    Ok(guard.state())
}

// ---------------------------------------------------------------------------
// Tauri commands — Phase 3
// ---------------------------------------------------------------------------

/// Creates fullscreen screensaver windows on all monitors.
///
/// Async because Tauri window creation on Windows deadlocks in synchronous
/// commands (WebView2 limitation). Returns the labels of created windows.
#[tauri::command]
async fn activate_screensaver(app: AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();

    // Transition the state machine.
    {
        let mut guard = state
            .lifecycle
            .lock()
            .map_err(|e| format!("lifecycle lock poisoned: {e}"))?;

        // If already active, return the existing window labels.
        if guard.state() == ScreensaverState::ScreensaverActive {
            let existing: Vec<String> = app
                .webview_windows()
                .keys()
                .filter(|l| l.starts_with("screensaver-"))
                .cloned()
                .collect();
            return Ok(existing);
        }

        // Force-activate regardless of idle time (manual trigger from settings/debug).
        guard.force_activate();
    }

    let display_target = state
        .settings
        .lock()
        .map(|s| s.screensaver_display_target)
        .unwrap_or(ScreensaverDisplayTarget::All);

    let labels = windowing::create_screensaver_windows(&app, display_target);

    if labels.is_empty() {
        // Roll back the state machine if no windows could be created.
        let mut guard = state.lifecycle.lock().map_err(|e| format!("{e}"))?;
        guard.on_user_input();
        return Err("failed to create any screensaver windows".into());
    }

    // Emit the activation event so the frontend/idle poller stays in sync.
    let _ = app.emit("screensaver:activate", ());

    Ok(labels)
}

/// Destroys all screensaver windows and returns to monitoring state.
///
/// Called by the frontend when user input (keyboard or mouse beyond dead-zone)
/// is detected. Also async for consistency with activate_screensaver.
#[tauri::command]
async fn deactivate_screensaver(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    {
        let mut guard = state
            .lifecycle
            .lock()
            .map_err(|e| format!("lifecycle lock poisoned: {e}"))?;

        if guard.state() != ScreensaverState::ScreensaverActive {
            return Ok(());
        }

        guard.on_user_input();
    }

    windowing::destroy_screensaver_windows(&app);

    // Emit the deactivation event.
    let _ = app.emit("screensaver:deactivate", ());

    Ok(())
}

/// Returns information about all connected monitors.
#[tauri::command]
async fn get_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    windowing::enumerate_monitors(&app)
}

/// Checks whether a mouse movement from origin to current position exceeds
/// the configured dead-zone threshold. Called by the frontend's `mousemove`
/// handler to decide whether to trigger deactivation.
#[tauri::command]
fn check_mouse_dead_zone(
    state: tauri::State<'_, AppState>,
    origin_x: f64,
    origin_y: f64,
    current_x: f64,
    current_y: f64,
) -> bool {
    let dead_zone = state
        .settings
        .lock()
        .map(|g| g.mouse_dead_zone_px)
        .unwrap_or(input::DEFAULT_DEAD_ZONE_PX);
    input::exceeds_dead_zone(origin_x, origin_y, current_x, current_y, dead_zone)
}

/// Returns the configured mouse dead-zone radius in logical pixels.
#[tauri::command]
fn get_dead_zone_px(state: tauri::State<'_, AppState>) -> f64 {
    state
        .settings
        .lock()
        .map(|g| g.mouse_dead_zone_px)
        .unwrap_or(input::DEFAULT_DEAD_ZONE_PX)
}

// ---------------------------------------------------------------------------
// Tauri commands — Phase 4: X data integration
// ---------------------------------------------------------------------------

/// Stores the user's X API bearer token and (re)initializes the API client.
///
/// The token is persisted in `tauri-plugin-store` so it survives restarts.
/// An empty token clears the stored key and disables the API client.
#[tauri::command]
async fn set_api_key(app: AppHandle, bearer_token: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let store_file = store_file_name();
    let store = app
        .store(store_file.as_str())
        .map_err(|e| format!("failed to open store: {e}"))?;

    if bearer_token.trim().is_empty() {
        // Clear the token.
        let _ = store.delete(STORE_KEY_BEARER_TOKEN);
        store
            .save()
            .map_err(|e| format!("store save failed: {e}"))?;
        let mut guard = state
            .api_client
            .lock()
            .map_err(|e| format!("api_client lock poisoned: {e}"))?;
        *guard = None;
        log::info!("API key cleared");
        return Ok(());
    }

    // Validate the token by constructing a client (checks non-empty).
    let client = XApiClient::new(bearer_token.clone())?;

    // Persist to store.
    store.set(
        STORE_KEY_BEARER_TOKEN,
        serde_json::Value::String(bearer_token),
    );
    store
        .save()
        .map_err(|e| format!("store save failed: {e}"))?;

    // Update the in-memory client.
    let mut guard = state
        .api_client
        .lock()
        .map_err(|e| format!("api_client lock poisoned: {e}"))?;
    *guard = Some(client);
    log::info!("API key set successfully");

    Ok(())
}

/// Returns whether an API key is currently configured (without revealing it).
#[tauri::command]
fn get_api_key_status(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let guard = state
        .api_client
        .lock()
        .map_err(|e| format!("api_client lock poisoned: {e}"))?;
    Ok(guard.is_some())
}

fn validate_mode(mode: &str) -> Result<&str, String> {
    match mode {
        "flipflap" | "matrix" => Ok(mode),
        _ => Err(format!(
            "unknown mode: {mode} (expected 'flipflap' or 'matrix')"
        )),
    }
}

/// Fetches posts from the X API for a specific mode and updates the cache.
///
/// `mode` must be `"flipflap"` or `"matrix"`. Reads the mode's X data
/// configuration from the persisted app settings, fetches posts via the API
/// client, and writes the result to that mode's dedicated cache file.
///
/// Falls back to cached data if the fetch fails entirely.
#[tauri::command]
async fn fetch_posts(app: AppHandle, mode: String) -> Result<Vec<Post>, String> {
    let state = app.state::<AppState>();
    let mode = validate_mode(&mode)?;

    // Get the API client (must have a bearer token set).
    // Clone it out of the Mutex so we don't hold the guard across .await.
    let client = {
        let guard = state
            .api_client
            .lock()
            .map_err(|e| format!("api_client lock poisoned: {e}"))?;
        guard
            .as_ref()
            .ok_or("API key not set — configure it in settings first")?
            .clone()
    };

    let mode_config = {
        let settings = state
            .settings
            .lock()
            .map_err(|e| format!("settings lock poisoned: {e}"))?
            .clone();
        let fetch_config = settings.to_fetch_config();
        match mode {
            "flipflap" => fetch_config.flipflap,
            "matrix" => fetch_config.matrix,
            _ => unreachable!("validate_mode only allows supported modes"),
        }
    };

    log::info!(
        "starting X post fetch (mode={mode}, accounts={}, search_configured={}, window_hours={})",
        mode_config.accounts.len(),
        mode_config
            .search_query
            .as_deref()
            .is_some_and(|query| !query.trim().is_empty()),
        mode_config.time_window_hours
    );

    // Nothing to fetch if no accounts or search query configured.
    if mode_config.accounts.is_empty() && mode_config.search_query.is_none() {
        return Err("no accounts or search query configured for this mode".into());
    }

    // Fetch from the API.
    let started_at = Instant::now();
    let posts = client
        .fetch_posts_for_config(&mode_config)
        .await
        .map_err(|e| {
            log::error!("X post fetch failed (mode={mode}): {e}");
            e
        })?;
    log::info!(
        "X post fetch succeeded (mode={mode}, posts={}, duration_ms={})",
        posts.len(),
        started_at.elapsed().as_millis()
    );

    // Write to cache.
    let new_cache = PostCache {
        fetched_at: chrono::Utc::now(),
        posts: posts.clone(),
    };
    if let Err(e) = cache::write_cache(&state.app_data_dir, mode, &new_cache) {
        log::error!("failed to write cache: {e}");
        // Non-fatal — we still have the posts in memory.
    }

    Ok(posts)
}

/// Returns cached posts from disk. Does not make any API calls.
///
/// Returns an empty array if no cache exists (not an error — the frontend
/// can decide whether to show a "no data" state or trigger a fetch).
#[tauri::command]
fn get_cached_posts(
    state: tauri::State<'_, AppState>,
    mode: String,
    truncation_chars: Option<usize>,
) -> Result<PostCache, String> {
    let mode = validate_mode(&mode)?;
    if matches!(truncation_chars, Some(0)) {
        return Err("truncation_chars must be > 0 when provided".into());
    }

    match cache::read_cache(&state.app_data_dir, mode) {
        Some(mut cache) => {
            if let Some(max_chars) = truncation_chars {
                for post in &mut cache.posts {
                    post.text = post.truncated_text(max_chars);
                }
            }
            Ok(cache)
        }
        None => Ok(PostCache {
            fetched_at: chrono::Utc::now(),
            posts: Vec::new(),
        }),
    }
}

/// Returns whether the post cache is fresh (not stale).
#[tauri::command]
fn is_cache_fresh(state: tauri::State<'_, AppState>, mode: String) -> Result<bool, String> {
    let mode = validate_mode(&mode)?;
    Ok(cache::is_cache_fresh(
        &state.app_data_dir,
        mode,
        cache::DEFAULT_STALENESS_HOURS,
    ))
}

// ---------------------------------------------------------------------------
// Tauri commands — Phase 7: settings and autostart
// ---------------------------------------------------------------------------

/// Returns the current `AppSettings`. The frontend reads this on startup
/// and after any setting change to keep its UI in sync.
#[tauri::command]
async fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let store_file = store_file_name();
    let store = app
        .store(store_file.as_str())
        .map_err(|e| format!("failed to open store: {e}"))?;

    match store.get(STORE_KEY_APP_SETTINGS) {
        Some(value) => serde_json::from_value::<AppSettings>(value)
            .map(|settings| settings.upgrade_legacy_defaults())
            .map_err(|e| format!("failed to parse stored settings: {e}")),
        None => Ok(AppSettings::default()),
    }
}

/// Validates and persists `AppSettings`, then updates the in-memory state so
/// changes take effect immediately without a restart.
#[tauri::command]
async fn set_settings(app: AppHandle, new_settings: AppSettings) -> Result<(), String> {
    // Validate before persisting so we never store invalid data.
    new_settings
        .validate()
        .map_err(|e| format!("invalid settings: {e}"))?;

    let store_file = store_file_name();
    let store = app
        .store(store_file.as_str())
        .map_err(|e| format!("failed to open store: {e}"))?;

    let value = serde_json::to_value(&new_settings)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;

    store.set(STORE_KEY_APP_SETTINGS, value);
    store
        .save()
        .map_err(|e| format!("store save failed: {e}"))?;

    let debug_logging_enabled = new_settings.debug_logging_enabled;
    let mode = new_settings.mode;

    // Update in-memory settings so the idle poller picks up the new
    // idle_timeout and the dead-zone check uses the new value immediately.
    let state = app.state::<AppState>();
    {
        let mut guard = state
            .settings
            .lock()
            .map_err(|e| format!("settings lock poisoned: {e}"))?;

        // Push the new idle timeout into the lifecycle config.
        // We replace the whole machine with the same state but new config —
        // a clean approach that avoids exposing a `set_config` mutation on
        // LifecycleMachine (which would need extra tests).
        {
            let mut lc_guard = state
                .lifecycle
                .lock()
                .map_err(|e| format!("lifecycle lock poisoned: {e}"))?;
            let current_state = lc_guard.state();
            let new_config = LifecycleConfig {
                idle_timeout_secs: new_settings.idle_timeout_secs,
                ..LifecycleConfig::default()
            };
            *lc_guard = LifecycleMachine::new(new_config);
            // Restore the current state if it was active so we don't
            // accidentally deactivate a running screensaver.
            if current_state == ScreensaverState::ScreensaverActive {
                lc_guard.force_activate();
            }
        }

        *guard = new_settings;
    }

    set_debug_logging_enabled(debug_logging_enabled);

    log::info!(
        "settings updated and applied (mode={:?}, debug_logging_enabled={})",
        mode,
        debug_logging_enabled
    );
    Ok(())
}

/// Returns whether the autostart entry currently exists.
#[tauri::command]
fn get_autostart_enabled() -> bool {
    autostart::is_autostart_enabled(APP_ID)
}

/// Enables or disables autostart.
///
/// `exe_path` is the path to the fliptrix binary, passed by the frontend
/// using Tauri's `resolveResource` or a stored install path.
/// On Linux this becomes the `Exec=` line in the `.desktop` file.
#[tauri::command]
async fn set_autostart_enabled(
    app: AppHandle,
    enabled: bool,
    exe_path: String,
) -> Result<(), String> {
    if enabled {
        let path = std::path::Path::new(&exe_path);
        autostart::enable_autostart(APP_ID, path).map_err(|e| e.to_string())?;
        log::info!("autostart enabled by user");
    } else {
        autostart::disable_autostart(APP_ID).map_err(|e| e.to_string())?;
        log::info!("autostart disabled by user");
    }
    // Emit an event so the frontend can update its toggle without a round-trip.
    let _ = app.emit("autostart:changed", enabled);
    Ok(())
}

/// Opens the application log directory in the system file explorer.
#[tauri::command]
fn open_logs_directory(app: AppHandle) -> Result<String, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("failed to resolve log dir: {e}"))?;

    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("failed to create log dir {}: {e}", log_dir.display()))?;

    app.opener()
        .open_path(log_dir.display().to_string(), None::<&str>)
        .map_err(|e| format!("failed to open log dir: {e}"))?;

    let display = log_dir.display().to_string();
    log::info!("opened logs directory: {display}");
    Ok(display)
}

// ---------------------------------------------------------------------------
// Background idle poller
// ---------------------------------------------------------------------------

/// Spawns a background thread that periodically checks idle time, feeds it
/// into the state machine, and emits Tauri events on state transitions.
///
/// On `Activate`, also creates the screensaver windows. On `Deactivate`
/// (which can only happen via `on_user_input` from a command), destroys them.
///
/// Uses a plain OS thread with `thread::sleep` rather than an async task —
/// idle polling is simple periodic I/O that doesn't benefit from async, and
/// this avoids pulling in a direct tokio dependency.
fn start_idle_poller(app: &AppHandle, poll_interval: Duration) {
    let handle = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(poll_interval);

            let state = handle.state::<AppState>();

            // Read idle time — skip this tick if provider is unavailable.
            let idle_secs = {
                let guard = match state.idle_provider.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                match guard.as_ref() {
                    Some(provider) => match provider.idle_seconds() {
                        Ok(secs) => secs,
                        Err(e) => {
                            log::warn!("idle query failed: {e}");
                            continue;
                        }
                    },
                    None => continue,
                }
            };

            // Feed idle time into the state machine.
            let transition = {
                let mut guard = match state.lifecycle.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                guard.tick(idle_secs)
            };

            // Act on state transitions.
            if let Some(t) = transition {
                match t {
                    StateTransition::Activate => {
                        log::info!("idle timeout reached — activating screensaver");
                        let display_target = state
                            .settings
                            .lock()
                            .map(|s| s.screensaver_display_target)
                            .unwrap_or(ScreensaverDisplayTarget::All);

                        windowing::create_screensaver_windows(&handle, display_target);
                        if let Err(e) = handle.emit("screensaver:activate", ()) {
                            log::error!("failed to emit screensaver:activate: {e}");
                        }
                    }
                    StateTransition::Deactivate => {
                        log::info!("user input detected — deactivating screensaver");
                        windowing::destroy_screensaver_windows(&handle);
                        if let Err(e) = handle.emit("screensaver:deactivate", ()) {
                            log::error!("failed to emit screensaver:deactivate: {e}");
                        }
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Store initialization helper
// ---------------------------------------------------------------------------

/// Resolves the bearer token at startup using a clear priority order:
///
/// 1. **Stored (JSON) token** — if `store.json` contains a valid
///    `bearer_token` key, it is used. This is the value the user explicitly
///    saved via the settings UI.
/// 2. **Environment variable** — `FLIPTRIX_BEARER_TOKEN` is checked as a
///    fallback when no stored token exists. The env var is **never** written
///    to the store, so it can be used for scenarios where the token should
///    not live on disk (e.g. CI, launcher scripts).
/// 3. **Neither** — returns `None` and the API client stays unavailable
///    until the user configures a token.
///
/// Returns `(token_string, source)` where `source` indicates the origin.
fn resolve_bearer_token(
    stored_token: Option<&str>,
    env_token: Option<&str>,
) -> Option<(String, &'static str)> {
    if let Some(stored) = stored_token {
        if !stored.trim().is_empty() {
            return Some((stored.to_string(), "store"));
        }
    }

    if let Some(env) = env_token {
        if !env.trim().is_empty() {
            return Some((env.to_string(), "env"));
        }
    }

    None
}

/// Restores the API client from a previously stored bearer token, falling back
/// to the `FLIPTRIX_BEARER_TOKEN` environment variable when no stored token
/// exists.
///
/// Called during app setup so the client is available immediately without
/// the user having to re-enter their key after every restart.
fn restore_api_client(app: &AppHandle) -> Option<XApiClient> {
    let store_file = store_file_name();
    let store = match app.store(store_file.as_str()) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("could not open store during startup: {e}");
            // Fall through to env var check even when store is unavailable.
            let env_token = std::env::var(BEARER_TOKEN_ENV).ok();
            let resolved = resolve_bearer_token(None, env_token.as_deref())?;
            return XApiClient::new(resolved.0).ok();
        }
    };

    let stored_token: Option<String> = store
        .get(STORE_KEY_BEARER_TOKEN)
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    if let Some(ref tok) = stored_token {
        if tok.trim().is_empty() {
            let _ = store.delete(STORE_KEY_BEARER_TOKEN);
            let _ = store.save();
        }
    }

    let env_token = std::env::var(BEARER_TOKEN_ENV).ok();
    let resolved = resolve_bearer_token(stored_token.as_deref(), env_token.as_deref())?;

    match resolved.1 {
        "store" => log::info!("API client restored from stored bearer token"),
        "env" => log::info!("API client restored from FLIPTRIX_BEARER_TOKEN env var"),
        _ => {}
    }

    match XApiClient::new(resolved.0) {
        Ok(client) => Some(client),
        Err(e) => {
            log::warn!("retrieved bearer token is invalid: {e}");
            None
        }
    }
}

/// Returns the short git commit hash embedded at build time.
/// Frontend can call this to display the build version for verification
/// against the source repository.
#[tauri::command]
fn get_build_info() -> String {
    GIT_HASH.to_string()
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // LifecycleConfig::default() gives us the poll interval. The idle timeout
    // is overridden later inside setup() once the persisted settings are loaded.
    let config = LifecycleConfig::default();

    let log_plugin = {
        let builder = tauri_plugin_log::Builder::new()
            .clear_targets()
            .target(Target::new(TargetKind::LogDir {
                file_name: Some("fliptrix".into()),
            }))
            .level(log::LevelFilter::Trace)
            .max_file_size(1_000_000)
            .rotation_strategy(RotationStrategy::KeepSome(5))
            .timezone_strategy(TimezoneStrategy::UseLocal)
            .filter(should_emit_log);

        #[cfg(debug_assertions)]
        let builder = builder.target(Target::new(TargetKind::Stdout));

        builder.build()
    };

    tauri::Builder::default()
        .plugin(log_plugin)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, focus the existing window.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            // Phase 2
            get_idle_seconds,
            get_lifecycle_state,
            // Phase 3
            activate_screensaver,
            deactivate_screensaver,
            get_monitors,
            check_mouse_dead_zone,
            get_dead_zone_px,
            // Phase 4
            set_api_key,
            get_api_key_status,
            fetch_posts,
            get_cached_posts,
            is_cache_fresh,
            // Phase 7
            get_settings,
            set_settings,
            get_autostart_enabled,
            set_autostart_enabled,
            open_logs_directory,
            // Build verification
            get_build_info,
        ])
        .setup(move |app| {
            // Resolve the app data directory for cache file I/O.
            let app_data_dir = resolve_app_data_dir(app.handle())?;

            // Restore the API client from a stored bearer token, falling back to
            // the FLIPTRIX_BEARER_TOKEN environment variable.
            let api_client = restore_api_client(app.handle());

            // Load persisted settings, falling back to defaults.
            let stored_settings: AppSettings = {
                let store_file = store_file_name();
                let store = app
                    .handle()
                    .store(store_file.as_str())
                    .map_err(|e| format!("failed to open store: {e}"))?;
                match store.get(STORE_KEY_APP_SETTINGS) {
                    Some(v) => serde_json::from_value::<AppSettings>(v)
                        .unwrap_or_default()
                        .upgrade_legacy_defaults(),
                    None => AppSettings::default(),
                }
            };

            // Use the persisted idle timeout for the lifecycle config.
            let lifecycle_config = LifecycleConfig {
                idle_timeout_secs: stored_settings.idle_timeout_secs,
                ..config
            };
            let poll_interval_final = Duration::from_secs(lifecycle_config.poll_interval_secs);

            set_debug_logging_enabled(stored_settings.debug_logging_enabled);
            log::info!(
                "debug logging {}",
                if stored_settings.debug_logging_enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            );

            // Try to create the platform idle provider. Log and continue if it
            // fails (e.g. headless server, Wayland-only session).
            let idle_provider: Option<Box<dyn IdleProvider>> = match idle::create_idle_provider() {
                Ok(provider) => {
                    log::info!("idle detection initialized");
                    Some(provider)
                }
                Err(e) => {
                    log::warn!("idle detection unavailable: {e}");
                    None
                }
            };

            let app_state = AppState {
                lifecycle: Mutex::new(LifecycleMachine::new(lifecycle_config)),
                idle_provider: Mutex::new(idle_provider),
                settings: Mutex::new(stored_settings),
                api_client: Mutex::new(api_client),
                app_data_dir,
            };
            app.manage(app_state);

            start_idle_poller(app.handle(), poll_interval_final);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ---------------------------------------------------------------------------
// Config tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod config_tests {
    use serde_json::Value;

    fn load_tauri_config() -> Value {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let config_path = manifest_dir.join("tauri.conf.json");
        let content = std::fs::read_to_string(&config_path)
            .unwrap_or_else(|e| panic!("failed to read {}: {e}", config_path.display()));
        serde_json::from_str(&content)
            .unwrap_or_else(|e| panic!("failed to parse {}: {e}", config_path.display()))
    }

    #[test]
    fn test_main_window_has_minimum_size() {
        let config = load_tauri_config();
        let windows = config
            .get("app")
            .and_then(|a| a.get("windows"))
            .and_then(|w| w.as_array())
            .expect("tauri.conf.json app.windows must be an array");

        let main = windows
            .first()
            .expect("tauri.conf.json must have at least one window");

        let min_width = main
            .get("minWidth")
            .and_then(|v| v.as_u64())
            .expect("main window must have minWidth");
        let min_height = main
            .get("minHeight")
            .and_then(|v| v.as_u64())
            .expect("main window must have minHeight");

        assert!(
            min_width >= 640,
            "main window minWidth ({min_width}) must be >= 640"
        );
        assert!(
            min_height >= 480,
            "main window minHeight ({min_height}) must be >= 480"
        );
    }
}

#[cfg(test)]
mod bearer_token_resolution_tests {
    use super::*;

    #[test]
    fn test_stored_token_takes_priority_over_env() {
        let result = resolve_bearer_token(Some("stored-token"), Some("env-token"));
        assert_eq!(result, Some(("stored-token".to_string(), "store")));
    }

    #[test]
    fn test_env_token_used_when_no_stored_token() {
        let result = resolve_bearer_token(None, Some("env-token"));
        assert_eq!(result, Some(("env-token".to_string(), "env")));
    }

    #[test]
    fn test_none_when_no_stored_and_no_env() {
        let result = resolve_bearer_token(None, None);
        assert_eq!(result, None);
    }

    #[test]
    fn test_stored_token_takes_priority_even_when_env_is_set() {
        let result = resolve_bearer_token(Some("store-wins"), Some("env-loses"));
        let (token, source) = result.expect("should return a token");
        assert_eq!(token, "store-wins");
        assert_eq!(source, "store");
    }

    #[test]
    fn test_empty_stored_token_falls_back_to_env() {
        let result = resolve_bearer_token(Some(""), Some("env-token"));
        assert_eq!(result, Some(("env-token".to_string(), "env")));
    }

    #[test]
    fn test_whitespace_stored_token_falls_back_to_env() {
        let result = resolve_bearer_token(Some("   "), Some("env-token"));
        assert_eq!(result, Some(("env-token".to_string(), "env")));
    }

    #[test]
    fn test_empty_env_token_returns_none_when_no_store() {
        let result = resolve_bearer_token(None, Some(""));
        assert_eq!(result, None);
    }

    #[test]
    fn test_whitespace_env_token_returns_none_when_no_store() {
        let result = resolve_bearer_token(None, Some("   "));
        assert_eq!(result, None);
    }

    #[test]
    fn test_both_empty_returns_none() {
        let result = resolve_bearer_token(Some(""), Some(""));
        assert_eq!(result, None);
    }

    #[test]
    fn test_stored_token_ignored_when_empty_but_env_present() {
        let result = resolve_bearer_token(Some(""), Some("fallback"));
        assert_eq!(result, Some(("fallback".to_string(), "env")));
    }

    #[test]
    fn test_valid_stored_token_ignores_empty_env() {
        let result = resolve_bearer_token(Some("stored-val"), Some(""));
        assert_eq!(result, Some(("stored-val".to_string(), "store")));
    }

    #[test]
    fn test_env_var_constant_value() {
        assert_eq!(BEARER_TOKEN_ENV, "FLIPTRIX_BEARER_TOKEN");
    }
}

#[cfg(test)]
mod build_info_tests {
    use super::*;

    #[test]
    fn test_get_build_info_returns_non_empty_hash() {
        let hash = get_build_info();
        assert!(!hash.is_empty(), "build hash must not be empty");
    }

    #[test]
    fn test_get_build_info_matches_expected_format() {
        let hash = get_build_info();
        // Either a 7+ hex git short hash, or "dev" for non-git builds.
        let is_valid_hash = hash.len() >= 7 && hash.chars().all(|c| c.is_ascii_hexdigit());
        let is_dev = hash == "dev";
        assert!(
            is_valid_hash || is_dev,
            "build hash must be a hex short hash or 'dev', got: {hash}"
        );
    }
}
