# fliptrix Reference

## Product Overview

fliptrix is a desktop screensaver that renders X/Twitter content in two visual modes:

- **FlipFlap** — realistic split-flap board with sequential forward-only character rotation, synchronized mechanical click sounds, and background image with pulse animation.
- **Matrix** — classic green-on-black digital rain with posts embedded as "data packets."
- **Both** — auto-switches between FlipFlap and Matrix at a configurable interval.

It activates after a configurable idle timeout, creates one fullscreen borderless window per monitor, and exits on any keyboard input or mouse movement beyond a dead-zone. No admin rights required.

## Platform

- **Primary**: Windows 11 (user-space, no `.scr` registration)
- **Secondary**: Linux (development/testing)

## Architecture

```text
[ Idle Monitor (Rust) ]
        ↓ (user idle > N seconds)
[ Lifecycle State Machine ]
        ↓
[ Window Manager → fullscreen per monitor ]
        ↓
[ Frontend Renderer (canvas) ]
        ↓ (keyboard / mouse movement)
[ Immediate exit ]
```

Separation of concerns:

- **Rust core**: idle detection, window management, X API client, cache I/O, settings persistence
- **Frontend**: canvas rendering (FlipFlap / Matrix), settings UI, screensaver overlay lifecycle
- **Communication**: Tauri commands + events (no direct DOM manipulation for screensaver rendering)

### Key modules

| Layer | File | Purpose |
|-------|------|---------|
| Rust | `api_client.rs` | X API v2 client (bearer token auth, timeline/search) |
| Rust | `autostart.rs` | User-level autostart (Windows Startup, Linux `.desktop`) |
| Rust | `cache.rs` | Per-mode JSON file cache (`flipflap-cache.json`, `matrix-cache.json`) |
| Rust | `idle.rs` | Platform idle detection (Windows `GetLastInputInfo`, Linux XScreenSaver) |
| Rust | `input.rs` | Mouse dead-zone calculation |
| Rust | `lifecycle.rs` | State machine: Monitoring → ScreensaverActive |
| Rust | `models.rs` | Post, PostCache, FetchConfig, XApiError structs |
| Rust | `settings.rs` | AppSettings with validation and serde |
| Rust | `windowing.rs` | Per-monitor fullscreen window creation/destruction |
| Rust | `lib.rs` | Tauri commands, state management, bearer token resolution, idle poller |
| Rust | `build.rs` | Injects `FLIPTRIX_GIT_HASH` at compile time for build verification |
| TS | `flipflap-state.ts` | Per-cell character drums, board state |
| TS | `flipflap-renderer.ts` | Canvas rendering for FlipFlap mode |
| TS | `flipflap-audio.ts` | Web Audio synthesized click sounds |
| TS | `flipflap-backgrounds.ts` | Background image loading and selection |
| TS | `background-image.ts` | Cover placement + pulse transform animation |
| TS | `matrix-state.ts` | Rain column state management |
| TS | `matrix-renderer.ts` | Canvas rendering for Matrix mode |
| TS | `screensaver-overlay.ts` | Screensaver activation/deactivation, post refresh, auto-refresh |
| TS | `settings-ui.ts` | Settings form HTML and form data collection |
| TS | `settings.ts` | Settings state management and Tauri command bridge |
| TS | `app-shell.ts` | Phase 7 status shell |

## X Data Flow

1. User enters bearer token in settings UI → saved via `tauri-plugin-store`
2. `FLIPTRIX_BEARER_TOKEN` env var can also supply a token (never written to store; used only when no stored token exists)
3. `fetch_posts` command calls X API v2 → per-mode `FetchConfig` (accounts, search query, time window)
4. Posts cached to per-mode JSON files in app data directory
5. Frontend retrieves cached posts → renders them in the active mode
6. If no cache exists, demo content is displayed
7. Auto-refresh runs on a configurable interval (0 = disabled, 2–24 hours)

### Token priority

1. Stored token (from settings UI) — always wins
2. `FLIPTRIX_BEARER_TOKEN` env var — fallback, never persisted

## Settings

All settings are persisted in `tauri-plugin-store` under the key `app_settings`. Unknown fields are silently ignored for forward compatibility.

| Setting | Default | Notes |
|---------|---------|-------|
| `mode` | `"matrix"` | `"flip_flap"`, `"matrix"`, or `"both"` |
| `idle_timeout_secs` | 300 | Seconds before screensaver activates |
| `mouse_dead_zone_px` | 5.0 | Mouse movement threshold to deactivate |
| `flipflap_rows` | 8 | Board height |
| `flipflap_cols` | 40 | Board width |
| `flipflap_tick_ms` | 80 | Flip animation speed |
| `flipflap_rotation_secs` | 6 | Seconds per post |
| `flipflap_background_image` | null | Optional background image path |
| `flipflap_background_animation_enabled` | true | Pulse zoom on background |
| `flipflap_background_pulse_speed` | 1.0 | Pulse animation multiplier |
| `flipflap_volume` | 0.3 | Click volume (0–1) |
| `flipflap_accounts` | [] | X usernames for FlipFlap |
| `flipflap_search_query` | "" | X search query for FlipFlap |
| `flipflap_time_window_hours` | 24 | Post age filter |
| `flipflap_truncation_chars` | 280 | Max characters per post |
| `matrix_font_size` | 24 | Rain character size |
| `matrix_spawn_density` | 0.5 | Column fill rate |
| `matrix_glow_intensity` | 12.0 | Glow effect strength |
| `matrix_tick_ms` | 40 | Rain speed |
| `matrix_background_layers` | 1 | Background rain layers (0–3) |
| `matrix_post_rotation_secs` | 6 | Seconds per post |
| `matrix_accounts` | [] | X usernames for Matrix |
| `matrix_search_query` | "" | X search query for Matrix |
| `matrix_time_window_hours` | 24 | Post age filter |
| `matrix_truncation_chars` | 280 | Max characters per post |
| `auto_refresh_hours` | 0 | 0 = disabled, 2–24 even |
| `fetch_on_startup` | false | Auto-fetch when app starts |
| `debug_logging_enabled` | false | Verbose log output |

## Autostart

- **Windows**: batch file in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`
- **Linux**: `.desktop` file in `~/.config/autostart/`
- User-space only, no admin rights

## Security

- Bearer token stored **plaintext** in `store.json` (tauri-plugin-store)
- Located at `%APPDATA%\com.fliptrix.desktop\` (Windows) or `~/.local/share/com.fliptrix.desktop/` (Linux)
- `FLIPTRIX_BEARER_TOKEN` env var alternative: never persisted to disk, used only when no stored token
- `store.json` and `.env` are in `.gitignore`
- CSP is currently disabled (`"csp": null` in tauri.conf.json) — canvas-only rendering mitigates XSS risk
- Bearer token is held in memory by `XApiClient` for the duration of the app session; it is never logged

## E2E Testing

Desktop E2E tests drive the real Tauri app via `tauri-driver` + WebDriverIO.

```bash
corepack pnpm e2e:generic       # shared flows (Windows + Linux)
corepack pnpm e2e:windows       # Windows-specific
corepack pnpm e2e:linux         # Linux-specific
```

Key env vars for E2E:

| Variable | Purpose |
|----------|---------|
| `FLIPTRIX_E2E_APP` | Override binary path |
| `FLIPTRIX_E2E=1` | Set by harness |
| `FLIPTRIX_STORE_FILE` | Suite-scoped store file |
| `FLIPTRIX_APP_DATA_DIR` | Isolated temp directory |
| `FLIPTRIX_X_API_BASE` | Fixture server URL |
| `FLIPTRIX_BEARER_TOKEN` | Bearer token override |

Determinism rules: no live API calls, no real autostart writes, per-suite isolated data.

## Data Storage Locations

| Data | Windows | Linux |
|------|---------|-------|
| Settings + token | `%APPDATA%\com.fliptrix.desktop\` | `~/.local/share/com.fliptrix.desktop/` |
| Post caches | Same as above | Same as above |
| Logs | `%LOCALAPPDATA%\com.fliptrix.desktop\logs` | `~/.local/share/com.fliptrix.desktop/logs` |
| Autostart | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` | `~/.config/autostart/` |

## Tech Stack

- **Frontend**: vanilla TypeScript, Vite, canvas 2D API
- **Desktop runtime**: Tauri v2
- **Native integration**: Rust (idle detection, windowing, autostart)
- **Package manager**: `pnpm` via `corepack`
- **Lint/format**: Biome (frontend), `rustfmt` (Rust)
- **Tests**: Vitest (TS unit), `cargo test` (Rust unit), Node.js test runner (e2e)

## Build Verification

Every binary carries a short git commit hash embedded at compile time. This lets users confirm which source commit their download was built from.

**How it works:**

1. `build.rs` runs `git rev-parse --short HEAD` during compilation and injects the result as `FLIPTRIX_GIT_HASH` via `cargo:rustc-env`.
2. The Rust constant `GIT_HASH` reads this value (falls back to `"dev"` when not in a git checkout).
3. The Tauri command `get_build_info()` returns this hash to the frontend.
4. The settings UI displays it next to the app title as a subtle tag.

**Verifying a binary:**

1. Open fliptrix Settings and note the hash shown in the header (e.g., `6e9c998`).
2. Compare against `git log --oneline -1` on the source repo.
3. If they match, the binary was built from that exact commit.
4. If the hash shows `"dev"`, the binary was built from a non-git source (e.g., a tarball).

**Caveats:**

- The hash reflects the commit at `cargo build` time, not `tauri build` time. Since `tauri build` triggers `cargo build`, the hash is always current.
- Builds from downloaded `.tar.gz` archives (without `.git`) will show `"dev"`.