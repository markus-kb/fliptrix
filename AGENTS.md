# AGENTS.md

## Purpose

- This file guides coding agents working in `fliptrix`.
- The repository is now at Phase 7 — Settings UI, autostart, and mode switching.
- `docs/TECH-SPEC.md` and `docs/PRD` remain the product source of truth.
- Make the smallest correct change that moves the project toward the documented screensaver architecture.

## Repository Context

- Product goal: a cross-platform fake screensaver with FlipFlap and Matrix modes.
- Primary runtime target: Windows 11.
- Secondary development target: Linux.
- Current phase: Phase 7 complete — Settings UI, autostart, and mode switching.
- Frontend stack: vanilla TypeScript + Vite.
- Desktop runtime: Tauri v2.
- Rust is used for system integration and native desktop behavior.

## Mandatory Reading

- Read `docs/TECH-SPEC.md` before changing runtime architecture, platform behavior, windowing, or idle detection.
- Read `docs/PRD` before changing user-facing behavior, rendering goals, data rules, or settings semantics.
- Read this file before adding dependencies, commands, or conventions.

## Product Constraints

- No admin rights.
- User-space only.
- No native `.scr` registration.
- Cross-platform codebase with Windows-first production behavior.
- Multi-monitor support is a core requirement.
- All displayed content must come from X data once Phase 4 is implemented.
- Storage should stay simple unless the user explicitly changes direction.

## Cursor And Copilot Rules

- No Cursor rules were found in `.cursor/rules/`.
- No `.cursorrules` file exists in this repository.
- No Copilot instructions were found in `.github/copilot-instructions.md`.
- If these files are added later, fold their repo-specific rules into this document.

## Working Commands

### Frontend

- Install dependencies: `corepack pnpm install`
- Start frontend dev server: `corepack pnpm dev`
- Build frontend assets: `corepack pnpm build`
- Preview built frontend: `corepack pnpm preview`

### Formatting And Linting

- Format all supported files: `corepack pnpm format`
- Check formatting only: `corepack pnpm format:check`
- Lint and static-check supported files: `corepack pnpm lint`
- Biome config lives in `biome.json`.

### Frontend Tests

- Run all frontend tests: `corepack pnpm test`
- Run a single test file: `corepack pnpm exec vitest run src/app-shell.test.ts`
- Run a single named test: `corepack pnpm exec vitest run -t "renders the Phase 1 status shell for fliptrix"`
- Run tests in watch mode: `corepack pnpm test:watch`

### Tauri And Rust

- Run Tauri in development: `corepack pnpm tauri dev`
- Build desktop bundle: `corepack pnpm tauri build`
- Check Rust formatting: `. "$HOME/.cargo/env" && cargo fmt --all -- --check`
- Format Rust code: `. "$HOME/.cargo/env" && cargo fmt --all`
- Run Rust tests: `. "$HOME/.cargo/env" && cargo test`
- Run a single Rust test by name: `. "$HOME/.cargo/env" && cargo test test_name`

## Current Environment Notes

- Frontend Phase 1 commands are working in this repository.
- `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm build`, `cargo test`, and `corepack pnpm tauri build` currently pass.
- `pnpm-lock.yaml` is the authoritative JavaScript lockfile for this repo.
- Rust toolchain is installed via `rustup` in the user account.
- Linux desktop prerequisites are installed on the current host.
- `pkg-config`, GTK 3, WebKitGTK 4.1, `librsvg2`, and AppIndicator development packages are available.
- `libXss.so.1` (runtime) is available but `libxss-dev` (headers) is not installed; `x11-dl` uses `dlopen` so this is fine.
- If Rust/Tauri builds fail in another environment with `glib-sys` or `webkit2gtk` errors, check host dependencies before changing repo code.

## Linux Prerequisite Reminder

- Tauri desktop builds on Linux need system packages that are not vendored in the repo.
- The exact package names depend on distro.
- Typical missing pieces include `pkg-config`, `glib-2.0`, `webkit2gtk`, and related GTK development headers.
- On Ubuntu 24.04, the current working package set is `pkg-config`, `patchelf`, `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, and `libayatana-appindicator3-dev`.
- Do not try to “fix” missing host libraries by changing Cargo dependencies unless you know the runtime implication.

## Architecture Direction

- Keep idle monitoring separate from screensaver rendering.
- Keep platform-specific code isolated behind small Rust modules.
- Prefer one fullscreen window per monitor rather than spanning mixed-DPI desktops.
- Keep frontend rendering logic separate from settings logic.
- Keep X fetch/cache code separate from visual renderers.
- Favor simple file-backed persistence over databases.

## Code Style: General

- Match established repo conventions before inventing new ones.
- Prefer explicit, readable code over abstraction-heavy designs.
- Keep functions small enough to scan quickly.
- Avoid speculative framework structure before a requirement exists.
- Use comments sparingly and only for non-obvious rationale.
- Keep public module boundaries clear.

## Imports

- Group imports by runtime/platform, third-party packages, then local modules.
- Remove unused imports immediately.
- Avoid wildcard imports.
- Prefer named imports over namespace imports unless a package API clearly benefits from namespacing.

## Formatting

- Let Biome format frontend files.
- Let `rustfmt` format Rust files.
- Do not hand-format against tool output.
- Keep line length moderate and diff-friendly.

## Types And Data Modeling

- Prefer explicit types at boundaries: config, storage, Tauri commands, and external API data.
- Use discriminated unions or enums for modes and state machines.
- Keep persisted data JSON-safe and versionable.
- Validate external data before it enters core logic.
- Avoid stringly typed mode names scattered across the app.

## Naming

- TypeScript: `camelCase` for variables/functions, `PascalCase` for types/classes.
- Rust: `snake_case` for functions/modules/variables, `PascalCase` for types, `SCREAMING_SNAKE_CASE` for constants.
- Use domain names that match the product language: `idleTimeout`, `mouseDeadZone`, `flipSequence`, `postCache`, `screensaverWindow`.
- Avoid generic names like `data`, `value`, `handler`, or `manager` unless the scope is tiny and obvious.

## Error Handling

- Do not silently swallow errors affecting launch, config, input detection, cache reads, or API fetches.
- Add context when bubbling errors upward.
- Avoid `unwrap` and `expect` in Rust production paths.
- Show concise, actionable UI messages and keep deeper detail in logs.
- Prefer graceful fallback to cached data rather than a crash when X fetches fail.

## Logging And Secrets

- Log startup, shutdown, config load, refresh attempts, and platform integration failures.
- Keep logs concise and actionable.
- Never log API keys, bearer tokens, or secret config values.
- Redact sensitive values in error output.

## Frontend Guidance

- Keep the frontend framework-light unless the user explicitly asks for a heavier stack.
- Use `requestAnimationFrame` for animation work.
- Avoid DOM-heavy rendering for Matrix mode; prefer canvas.
- Keep FlipFlap animation state deterministic and testable.
- Separate shell/setup code from renderer-specific modules.

## Rust Guidance

- Keep Rust focused on idle detection, window management, autostart, secure storage, and OS integration.
- Isolate Windows and Linux logic behind `cfg`-gated modules.
- Keep Tauri commands narrow and explicit.
- Add unit tests for pure Rust logic where possible.

## Testing Expectations

- Follow TDD for new behavior when practical: write or update a failing test, implement the smallest change, then refactor.
- Add regression coverage when changing parsing, state transitions, timing, or persistence behavior.
- Prefer deterministic tests over clock- or event-race-dependent tests.
- For frontend shell logic, keep pure functions easy to test without a browser.
- For renderer logic, isolate layout/timing calculations into testable helpers.

## Phase 1 Baseline

- `src/app-shell.ts` defines the current shell markup.
- `src/app-shell.test.ts` covers the current shell output.
- `src/main.ts` mounts the app shell into `#app`.
- `src-tauri/` is scaffolded but no project-specific native behavior exists yet.

## Phase 2 Modules

- `src-tauri/src/idle.rs` — platform-specific idle detection via `IdleProvider` trait.
  - Linux: `X11IdleProvider` using `XScreenSaverQueryInfo` via `x11-dl` (dynamic loading).
  - Windows: `WindowsIdleProvider` using `GetLastInputInfo`.
  - `create_idle_provider()` convenience constructor.
  - `mock::MockIdleProvider` for deterministic testing.
- `src-tauri/src/lifecycle.rs` — pure deterministic state machine.
  - `ScreensaverState`: `Monitoring`, `ScreensaverActive`.
  - `LifecycleMachine` with `tick(idle_secs)` and `on_user_input()` transitions.
  - `LifecycleConfig` with `idle_timeout_secs` (default 300) and `poll_interval_secs` (default 5).
- `src-tauri/src/lib.rs` — Tauri wiring.
  - `tauri-plugin-single-instance` for single-instance enforcement.
  - Tauri commands: `get_idle_seconds`, `get_lifecycle_state`.
  - Background thread polling idle time every `poll_interval_secs`.
  - Emits `screensaver:activate` / `screensaver:deactivate` events on state transitions.
- `docs/IMPLEMENTATION-PLAN.md` — seven-phase plan with dependency graph and risk register.

## Phase 3 Modules

- `src-tauri/src/input.rs` — pure mouse dead-zone math.
  - `DEFAULT_DEAD_ZONE_PX` constant (5.0 logical pixels).
  - `exceeds_dead_zone()` using squared Euclidean distance (no sqrt).
  - 11 unit tests covering boundary, diagonal, negative, and edge cases.
- `src-tauri/src/windowing.rs` — monitor enumeration and screensaver window management.
  - `MonitorInfo` — serializable monitor geometry struct.
  - `screensaver_label(index)` — deterministic window label generation.
  - `create_screensaver_windows()` — one borderless, always-on-top, fullscreen window per monitor with cursor hidden.
  - `destroy_screensaver_windows()` — instant destroy with cursor restore.
  - `enumerate_monitors()` — returns `Vec<MonitorInfo>` for frontend/settings.
  - 4 unit tests for label generation and serialization.
- `src-tauri/src/lifecycle.rs` — updated with `force_activate()` for manual activation.
  - 3 additional tests: force from monitoring, idempotent when active, force+deactivate cycle.
- `src-tauri/src/lib.rs` — Phase 3 Tauri wiring.
  - `AppState` extended with `mouse_dead_zone_px: f64`.
  - New commands: `activate_screensaver` (async), `deactivate_screensaver` (async), `get_monitors` (async), `check_mouse_dead_zone`, `get_dead_zone_px`.
  - Idle poller creates/destroys windows on state transitions.
- `src/screensaver.ts` — pure frontend logic for window detection and mouse tracking.
  - `isScreensaverWindow(label)` — checks if a Tauri window label is a screensaver overlay.
  - `MouseTracker` class — origin recording and dead-zone exceedance check (mirrors Rust math).
  - 11 unit tests.
- `src/screensaver-overlay.ts` — DOM setup for screensaver windows.
  - Black fullscreen overlay with `cursor: none`.
  - `keydown` listener → calls `deactivate_screensaver`.
  - `mousemove` listener → tracks origin, checks dead-zone, calls `deactivate_screensaver` on exceedance.
  - Lazy-imported from `main.ts` to avoid loading Tauri IPC in non-screensaver windows.
- `src/main.ts` — updated to detect window type via `getCurrentWebviewWindow().label`.
  - Screensaver windows load the overlay; main window loads the settings shell.
- `src/app-shell.ts` — updated to Phase 3 status with feature list.
- `src/styles.css` — added `.screensaver-overlay` and `.screensaver-placeholder` styles.

## Phase 4 Modules

- `src-tauri/src/models.rs` — data types for X API integration.
  - `Post` — normalized post struct with `id`, `text`, `author_username`, `author_id`, `created_at`.
  - `ModeDataConfig` — per-mode config: `accounts`, optional `search_query`, `time_window_hours`, `truncation_length`.
  - `FetchConfig` — internal top-level fetch config derived from `AppSettings`.
  - `PostCache` — serializable cache wrapper with `posts` and `fetched_at`.
  - X API v2 response types: `XApiTweetResponse`, `XApiTweet`, `XApiNoteTweet`, `XApiIncludes`, `XApiUser`, `XApiMeta`, `XApiError`, `XApiUserLookupResponse`, `XApiUserData`.
  - 16 unit tests.
- `src-tauri/src/api_client.rs` — X API v2 HTTP client.
  - `XApiClient` (Clone + Debug) with bearer token auth.
  - `resolve_user_id()` — username to user ID lookup.
  - `fetch_user_timeline()` — paginated user timeline fetch.
  - `search_recent()` — recent search endpoint.
  - `fetch_posts_for_config()` — high-level: resolves usernames, fetches timelines + search, deduplicates, sorts.
  - `normalize_response()`, `build_user_map()`, `deduplicate_and_sort()` helpers.
  - 12 unit tests.
- `src-tauri/src/cache.rs` — file-backed per-mode post caches.
  - `read_cache()` — reads `posts_matrix.json` / `posts_flipflap.json` from app data dir.
  - `write_cache()` — atomic write via temp file + rename.
  - `is_cache_fresh()` — staleness check against configurable max age.
  - `cache_path()` — resolves the mode-specific cache file path in app data dir.
  - 11 unit tests.
- `src-tauri/src/lib.rs` — Phase 4 Tauri wiring.
  - `tauri-plugin-store` registered for secure API key storage.
  - `AppState` expanded with `api_client: Mutex<Option<XApiClient>>` and `app_data_dir: PathBuf`.
  - `AppState` constructed inside `.setup()` (needs `app.path().app_data_dir()`).
  - `restore_api_client_from_store()` — restores API client from store on startup.
  - 5 X-data commands: `set_api_key`, `get_api_key_status`, `fetch_posts`, `get_cached_posts`, `is_cache_fresh`.
- `src-tauri/Cargo.toml` — added `reqwest` (0.12, rustls-tls+json), `tauri-plugin-store` (2), `chrono` (0.4, serde), `tempfile` (3, dev-dependency).
- `src-tauri/capabilities/default.json` — added `"store:default"` permission.
- `package.json` — added `@tauri-apps/plugin-store` (2.4.2).
- `src/app-shell.ts` — updated to Phase 4 with API key status, cache status, feature list.
- `src/app-shell.test.ts` — updated to test Phase 4 shell content (4 tests).

## Phase 5 Modules

- `src/flipflap-state.ts` — pure FlipFlap board state machine with zero DOM dependencies.
  - `CHAR_SET` — ordered character drum: space, A-Z, 0-9, punctuation (45 characters).
  - `charIndex()` — character to drum index lookup (case-insensitive, unknown → space).
  - `stepsToTarget()` — forward-only rotation distance between two characters.
  - `BoardConfig`, `FlapCell`, `FlapBoard`, `CellPosition` — board data types.
  - `createBoard()` — fresh board with all cells at space.
  - `setTargetText()` — set target characters from lines, computes steps per cell.
  - `advanceBoard()` — advance all active cells by one step, returns flipped positions.
  - `isBoardSettled()` — check if all cells have reached their targets.
  - `PostEntry` — post with optional author attribution.
  - `formatPostsForBoard()` — format posts into board lines with wrapping, padding, truncation.
  - 36 unit tests.
- `src/flipflap-audio.ts` — synthesized mechanical flip sounds via Web Audio API.
  - `FlipAudioConfig` — volume, pitch, variation, and duration settings.
  - `FlipSoundParams` — randomized parameters for a single flip sound.
  - `DEFAULT_AUDIO_CONFIG` — defaults tuned for Solari-style clack (1800Hz center, 15ms).
  - `randomizeFlipParams()` — pure parameter randomizer (testable).
  - `FlipSoundPlayer` — Web Audio playback with filtered white noise bursts.
    - Bandpass filter shapes noise into mechanical click.
    - Gain envelope provides sharp attack and fast decay.
    - Max 8 concurrent sounds per frame to avoid audio overload.
    - Lazy AudioContext creation for browser autoplay policy compliance.
  - 7 unit tests.
- `src/flipflap-renderer.ts` — canvas-based board rendering and animation loop.
  - `FlipFlapConfig` — rows, cols, tick interval, post rotation, audio config.
  - `DEFAULT_FLIPFLAP_CONFIG` — 8x40 board, 30ms tick, 20s rotation.
  - `FlipFlapRenderer` — main renderer class.
    - `setPostContent()` — set posts to rotate through.
    - `start()` / `stop()` — animation lifecycle with requestAnimationFrame.
    - `resizeCanvas()` — responsive layout on window resize.
    - Draws flap cells with rounded corners, split line, and monospace characters.
    - Advances board state at configurable tick interval.
    - Rotates to next posts when board settles and interval elapses.
  - `computeCellLayout()` — pure layout math with aspect ratio constraints.
  - 5 unit tests.
- `src/screensaver-overlay.ts` — updated to render FlipFlap on a fullscreen canvas.
  - Creates `<canvas class="flipflap-canvas">` instead of placeholder text.
  - Loads cached posts from Rust backend via `get_cached_posts` IPC.
  - Falls back to demo content when no posts are cached.
  - Uses ResizeObserver for responsive canvas sizing.
- `src/app-shell.ts` — updated to Phase 5 with FlipFlap features.
- `src/app-shell.test.ts` — updated to test Phase 5 shell content (4 tests).
- `src/styles.css` — added `.flipflap-canvas` styles.

## Phase 6 Modules

- `src/matrix-state.ts` — pure Matrix rain board state machine with zero DOM dependencies.
  - `MATRIX_CHARS` — half-width Katakana (U+FF66–U+FF9D), ASCII digits, cryptic symbols (~70 characters).
  - `randomMatrixChar()` — uniform random character from MATRIX_CHARS.
  - `RainDrop` — per-column falling drop: `headRow`, `trailLength`, `ticksUntilMove`, `speed`.
  - `DataPacket` — readable post text injected vertically: `chars[]`, `startRow`.
  - `RainColumn` — per-column state: `drop`, `brightness[]`, `chars[]`, `packet`.
  - `MatrixBoard` — grid of columns with `rows`, `cols`, `columns[]`.
  - `MatrixCell` — cell read result: `char`, `brightness` (0–1), `isPacket`.
  - `createMatrixBoard(rows, cols)` — fresh board with all cells dark.
  - `getCellAt(board, row, col)` — read a single cell (safe for out-of-bounds).
  - `spawnDrops(board, density)` — probabilistic drop spawning in idle columns.
  - `advanceMatrix(board)` — tick all columns, returns dirty column indices.
  - `injectDataPacket(board, text, colIndex, startRow?)` — place post text vertically in a column.
  - `clearDataPacket(board, colIndex)` — remove a data packet from a column.
  - 27 unit tests.
- `src/matrix-renderer.ts` — canvas-based Matrix rain renderer.
  - `MatrixConfig` — `fontSize`, `spawnDensity`, `glowIntensity`, `tickIntervalMs`, `postRotationSec`.
  - `DEFAULT_MATRIX_CONFIG` — 16px font, 4% spawn density, 6px glow, 50ms ticks, 15s post rotation.
  - `MatrixGrid` — `cols`, `rows` — grid dimensions derived from canvas size.
  - `computeMatrixGrid(canvasW, canvasH, fontSize)` — pure layout helper (half-width chars ≈ square at fontSize).
  - `MatrixRenderer` — main renderer class.
    - `setPostContent()` — set posts to rotate through as data packets.
    - `start()` / `stop()` — animation lifecycle with requestAnimationFrame.
    - `resizeCanvas()` — reinitializes board for new canvas dimensions.
    - Dirty-column optimization: only redraws columns that changed each tick.
    - Drop head rendered in bright white-green; trail fades through bright/mid/dim green.
    - Data packets rendered in warm white with double glow for readability.
    - Posts injected as vertical multi-column data packets on rotation interval.
  - 12 unit tests.
- `src/matrix-state.test.ts` — 27 tests for all pure state functions.
- `src/matrix-renderer.test.ts` — 12 tests for `computeMatrixGrid` and config defaults.
- `src/screensaver-overlay.ts` — updated to render Matrix digital rain (Phase 6 default).
  - Creates `<canvas class="matrix-canvas">` instead of FlipFlap canvas.
  - Loads cached posts from Rust backend via `get_cached_posts` IPC.
  - Falls back to demo content when no posts are cached.
  - FlipFlap imports removed; will be restored in Phase 7 with mode switching.
- `src/app-shell.ts` — updated to Phase 6 with Matrix features.
- `src/app-shell.test.ts` — updated to test Phase 6 shell content (4 tests).
- `src/styles.css` — added `.matrix-canvas` styles.

## Phase 7 Modules

- `src-tauri/src/settings.rs` — NEW. `AppSettings` struct (22 fields) and `ScreensaverMode` enum.
  - `ScreensaverMode`: `FlipFlap`, `Matrix` (default), `Both` — serializes as snake_case strings.
  - All fields have `#[serde(default)]` so partial JSON round-trips safely.
  - Includes per-mode X data fields: accounts, search query, time window, truncation.
  - `validate()` — rejects out-of-range values (idle timeout, volume, spawn density, font size, time window, truncation, etc.).
  - `to_fetch_config()` derives the backend X fetch config from persisted settings.
  - 24 unit tests covering defaults, serialization, fetch-config derivation, partial deserialization, and validation.
- `src-tauri/src/autostart.rs` — NEW. Platform-gated autostart file management.
  - **Linux**: writes `~/.config/autostart/<app_id>.desktop` (XDG spec; reads `XDG_CONFIG_HOME` or `HOME`).
  - **Windows**: writes `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\<app_id>.bat`.
  - No `dirs`/`dirs-next` dependency — uses only std env vars.
  - `autostart_path()`, `enable_autostart()`, `disable_autostart()`, `is_autostart_enabled()`.
  - Tests serialize env-var mutations behind `XDG_LOCK: Mutex<()>` to prevent parallel-test races.
  - 5 unit tests (Linux-gated).
- `src-tauri/src/lib.rs` — Updated.
  - Added `mod settings; mod autostart;` and `STORE_KEY_APP_SETTINGS`, `APP_ID` constants.
  - `AppState` now has `settings: Mutex<AppSettings>` (replaces old `mouse_dead_zone_px: f64` field).
  - `check_mouse_dead_zone` and `get_dead_zone_px` read dead zone from `state.settings`.
  - `restore_api_client_from_store()` called on startup; persisted settings loaded and used for lifecycle config.
  - 4 new Tauri commands: `get_settings`, `set_settings`, `get_autostart_enabled`, `set_autostart_enabled`.
  - `set_settings` validates, persists to store, updates in-memory state, and rebuilds lifecycle machine.
- `src/settings.ts` — NEW. TypeScript mirror of Rust `AppSettings`.
  - `ScreensaverMode` type (`"matrix" | "flip_flap" | "both"`).
  - `AppSettings` interface with all 22 fields, including per-mode X data config.
  - `DEFAULT_SETTINGS` constant matching Rust defaults.
  - IPC wrappers: `getSettings()`, `saveSettings()`, `getAutostartEnabled()`, `setAutostartEnabled()`.
  - `cloneDefaultSettings()` avoids sharing the default accounts arrays.
  - 9 unit tests.
- `src/settings-ui.ts` — NEW. Full settings window UI (no external framework).
  - `initSettingsUi(root)` — async entry point; loads settings, renders form, wires events.
  - `buildSettingsHtml()` — renders grouped fieldsets: General, Mode, FlipFlap, Matrix, X Data, Autostart.
  - `wireForm()` — mode select toggles switch-interval field; volume range updates live output label.
  - Per-mode X data fields: accounts textarea, search query, time window, truncation for FlipFlap and Matrix.
  - Autostart toggle calls `setAutostartEnabled` immediately on change; reverts checkbox on failure.
  - API key save button calls `set_api_key` IPC and refreshes status hint.
  - Refresh posts button calls `fetch_posts` for both modes.
  - Reset-to-defaults button repopulates form without saving.
  - Main submit calls `saveSettings` with inline success/error feedback banner.
- `src/screensaver-overlay.ts` — Updated for Phase 7.
  - Reads `AppSettings` via `invoke("get_settings")` on startup.
  - Mode-based renderer dispatch: `startMatrixRenderer`, `startFlipFlapRenderer`, `startBothModeRenderer`.
  - `startBothModeRenderer` alternates between Matrix and FlipFlap on `mode_switch_interval_mins`, stopping the previous renderer before each swap.
  - Mouse deactivation uses the persisted `mouse_dead_zone_px` setting.
  - `loadCachedPosts` requests a mode-specific cache and applies truncation in the backend response.
  - Demo fallback uses `{ text: string }[]` objects.
- `src/main.ts` — Updated. Main window branch lazy-imports `initSettingsUi`; no longer uses `createAppShell`.
- `src/app-shell.ts` — Updated to Phase 7 status and features list.
- `src/app-shell.test.ts` — Updated to test Phase 7 shell content (4 tests).
- `src/styles.css` — Added full settings UI styles: `.settings-shell`, `.settings-header`, `.settings-form`,
  `.settings-feedback` variants, `fieldset.panel` override, `.field`, `.field-label`, `.field-hint`,
  `.field-row`, `.field-checkbox`, `.settings-actions`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`,
  `.range-output`.

## When Updating This File

- Update commands whenever `package.json`, Tauri scripts, or Rust workflow changes.
- Add single-test examples for every new test runner.
- Add Cursor/Copilot rules if those files appear later.
- Keep this file repo-specific; do not turn it into generic advice.
