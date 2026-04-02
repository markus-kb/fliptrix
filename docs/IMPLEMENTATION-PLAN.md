# Implementation Plan

Seven phases from scaffold to production-ready screensaver.
Each phase has clear exit criteria and builds on the previous one.

---

## Phase 1 — Scaffold and Tooling (COMPLETE)

**Goal:** Working Tauri + Vite + TypeScript project with CI-ready commands.

**Deliverables:**

- Tauri v2 app shell with vanilla TypeScript frontend
- Biome (lint/format), Vitest (tests), TypeScript strict mode
- All scripts in `package.json`: `dev`, `build`, `lint`, `format`, `format:check`, `test`, `test:watch`, `tauri`, `preview`
- Minimal app shell with first passing test
- `AGENTS.md` with exact working commands
- All checks green: `pnpm test`, `pnpm lint`, `pnpm build`, `cargo test`, `cargo fmt --check`, `pnpm tauri build`

**Exit criteria:** Every command listed in AGENTS.md passes. Desktop binary builds.

---

## Phase 2 — Idle Detection and Screensaver Lifecycle

**Goal:** Rust-side idle monitoring, state machine, single-instance enforcement, and Tauri command/event bridge.

**Deliverables:**

- `src-tauri/src/idle.rs` — platform-specific idle time query
  - Linux: `XScreenSaverQueryInfo` via `x11-dl` crate (dynamic loading, X11 only)
  - Windows: `GetLastInputInfo` via `windows` crate
  - Exposed as `idle_seconds() -> Result<u64, String>`
- `src-tauri/src/lifecycle.rs` — deterministic state machine
  - States: `Monitoring`, `ScreensaverActive`
  - Config: `idle_timeout_secs` (default 300), `mouse_dead_zone_px` (default 5), `poll_interval_secs` (default 5)
  - Pure transition logic, fully unit-tested
- Tauri integration in `lib.rs`:
  - `tauri-plugin-single-instance` for single-instance enforcement
  - Tauri commands: `get_idle_seconds`, `get_lifecycle_state`
  - Background polling task emitting `screensaver:activate` / `screensaver:deactivate` events
- Frontend: app shell updated to show Phase 2 status and lifecycle state (dev/debug)
- Unit tests for state machine transitions and idle logic edge cases

**Dependencies:** Phase 1 complete.

**Risks:**

- Headless dev server cannot live-test idle detection — mitigated by pure-logic unit tests and dynamic library loading
- Windows code compiles behind `cfg` but cannot be integration-tested on Linux host
- `x11-dl` requires `libXss.so` at runtime on X11 sessions (not on Wayland)

**Exit criteria:** All Phase 1 checks still pass. Rust unit tests cover lifecycle transitions and idle edge cases. `cargo test` green. `pnpm tauri build` produces binary with idle detection compiled in.

---

## Phase 3 — Fullscreen Multi-Monitor Windows

**Goal:** One borderless, always-on-top, fullscreen window per monitor. Cursor hidden. Immediate exit on user input.

**Deliverables:**

- Monitor enumeration (Tauri window API or platform-specific)
- Fullscreen borderless window creation per detected display
- Always-on-top and cursor-hide behavior
- Mouse movement detection with configurable dead-zone threshold
- Keyboard input detection for immediate exit
- Clean state restoration on deactivation (cursor restore, window close)
- Integration with lifecycle state machine (activate creates windows, deactivate destroys them)

**Dependencies:** Phase 2 complete.

**Risks:**

- Multi-monitor DPI differences may cause sizing issues
- Always-on-top behavior varies across Linux window managers
- Cannot test multi-monitor on headless server

**Exit criteria:** On a graphical session, idle timeout triggers fullscreen overlay on all monitors. Any keyboard or mouse movement beyond dead-zone exits cleanly.

---

## Phase 4 — X Data Integration

**Goal:** Fetch, cache, and serve X/Twitter post data for renderers.

**Deliverables:**

- `src-tauri/src/api_client.rs` — X API client using user-supplied bearer token
- Per-mode configuration: accounts, search queries, time window, truncation length
- Simple `posts.json` file cache in app data directory
- Daily refresh strategy (fetch on first launch if stale, manual "Refresh Now")
- Secure storage for API key via Tauri secure store
- Tauri commands: `fetch_posts`, `get_cached_posts`, `set_api_key`
- Graceful fallback to cached data on fetch failure

**Dependencies:** Phase 2 (lifecycle running), Phase 3 (windows available for rendering).

**Risks:**

- X API rate limits and authentication changes
- Large post volumes need truncation and rotation logic
- API key security in user-space storage

**Exit criteria:** Posts fetched from X API, cached to `posts.json`, and retrievable via Tauri commands. Stale cache serves data when API is unavailable.

---

## Phase 5 — FlipFlap Renderer

**Goal:** Realistic split-flap display rendering with synchronized mechanical sound.

**Deliverables:**

- Canvas-based FlipFlap renderer in TypeScript
- Sequential forward-only flap rotation through character set
- Configurable board size (rows x columns, default 8x40)
- Mechanical flip sound via Web Audio API, synchronized to visual flip
- Slight random pitch/volume variation for realism
- Post rotation interval (configurable, default 15-30 seconds)
- Content from cached X posts, truncated to configured length
- Deterministic animation state for testability

**Dependencies:** Phase 3 (fullscreen windows), Phase 4 (post data).

**Risks:**

- Audio synchronization precision across browsers/platforms
- Performance at large board sizes
- Realistic visual quality requires careful CSS/canvas work

**Exit criteria:** FlipFlap mode displays cached posts with realistic split-flap animation and synchronized sound. Configurable board size and rotation speed.

---

## Phase 6 — Matrix Renderer

**Goal:** Classic green digital rain with X posts as readable data packets.

**Deliverables:**

- Canvas-based Matrix rain renderer
- Katakana, Japanese, and cryptic symbol character set
- X posts appear as readable "data packets" within rain streams
- Configurable rain density, speed, and glow
- Same data source and rotation logic as FlipFlap
- Performance-optimized for fullscreen rendering (<5% CPU target)

**Dependencies:** Phase 3 (fullscreen windows), Phase 4 (post data).

**Risks:**

- GPU/CPU usage at high resolution and density
- Readable text within rain needs careful contrast tuning

**Exit criteria:** Matrix mode renders digital rain with embedded X post content. Stays under 5% CPU on target hardware.

---

## Phase 7 — Settings UI, Autostart, and Polish

**Goal:** User-facing settings window, autostart, mode switching, and production polish.

**Deliverables:**

- Settings window (separate from screensaver overlay)
  - Mode selection: FlipFlap only, Matrix only, or both (auto-switch interval)
  - Per-mode X account/query/time-window/truncation settings
  - FlipFlap: board size, rotation speed, sound volume
  - Matrix: rain density, speed, glow
  - General: idle timeout, mouse dead-zone
  - "Refresh Now" button for X data
- Autostart registration
  - Windows: user Startup folder shortcut
  - Linux: `~/.config/autostart` desktop entry
- Mode switching logic (only via settings, never during active screensaver)
- Error reporting UI (concise messages, detailed logs)
- Final performance audit and cleanup

**Dependencies:** All previous phases.

**Risks:**

- Settings persistence format versioning
- Autostart reliability across OS versions
- Edge cases in mode switching during active screensaver

**Exit criteria:** Complete user-facing application. Settings persist across restarts. Autostart works on Windows and Linux. Mode switching works correctly. All success criteria from PRD met.

---

## Dependency Graph

```text
Phase 1 (Scaffold)
    └── Phase 2 (Idle + Lifecycle)
            └── Phase 3 (Fullscreen Windows)
                    ├── Phase 4 (X Data)
                    │       ├── Phase 5 (FlipFlap)
                    │       └── Phase 6 (Matrix)
                    └───────┴── Phase 7 (Settings + Polish)
```

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Headless dev server limits testing | Medium | Unit tests for pure logic; manual testing on graphical sessions |
| X API changes or rate limits | High | Cache-first strategy; graceful fallback; daily fetch only |
| Multi-monitor DPI issues | Medium | One window per monitor; test on mixed-DPI setups |
| Wayland incompatibility for idle detection | Low | X11 is primary; document Wayland limitation; consider D-Bus fallback later |
| Windows code untestable on Linux host | Medium | `cfg`-gated compilation; CI matrix with Windows runner |
| Audio sync precision | Medium | Web Audio API scheduling; test on multiple browsers |
