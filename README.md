# fliptrix

`fliptrix` is a desktop fake screensaver built with Tauri, vanilla TypeScript, and Rust.
It supports `Matrix`, `FlipFlap`, and `Both` modes, activates after idle time, and can render X/Twitter-backed content with separate data sources per mode.

## Features

- fullscreen screensaver window on each monitor
- idle activation and input-based deactivation
- `Matrix`, `FlipFlap`, and auto-switching `Both` mode
- settings UI for renderer behavior, idle timeout, autostart, and X data
- separate X account/search configuration for Matrix and FlipFlap
- per-mode on-disk post caches

## Requirements

### General

- Node with `corepack` enabled
- Rust installed via `rustup`

### Linux build prerequisites

Tauri on Linux needs system packages that are not vendored in this repo.

Typical Ubuntu 24.04 packages:

```bash
sudo apt install pkg-config patchelf libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev
```

### E2E prerequisites

- Install `tauri-driver` (`cargo install tauri-driver`)
- Build the desktop app binary before running E2E tests
- Linux: install `WebKitWebDriver` (Ubuntu package: `webkit2gtk-driver`)
- Windows: install a matching WebDriver for your installed Edge version (for `tauri-driver`)

## Install

```bash
corepack pnpm install
```

## Run In Development

Start the desktop app with hot reload:

```bash
corepack pnpm tauri dev
```

If you only want the frontend dev server:

```bash
corepack pnpm dev
```

## Build

Build frontend assets only:

```bash
corepack pnpm build
```

Build the desktop application bundle:

```bash
corepack pnpm tauri build
```

Build outputs are produced under `src-tauri/target/`.

## Use The App

1. Launch `fliptrix`.
2. Open the main settings window.
3. Set your idle timeout, mode, and renderer settings.
4. If you want X-backed content, paste an X API bearer token and save it.
5. Configure Matrix and FlipFlap accounts or search queries separately.
6. Click `Refresh posts now` to populate the caches.
7. Optionally enable autostart.
8. Leave the machine idle until the timeout is reached.

### X Data Notes

- Matrix and FlipFlap use separate content settings.
- Their caches are stored separately.
- If no cached posts are available, the app falls back to demo content.

### Logging

- Logs are persisted to the app log directory via `tauri-plugin-log`.
- Open the folder from Settings -> Diagnostics -> `Open logs folder`.
- `Enable debug logs` increases verbosity for troubleshooting (off by default).
- Sensitive values (like bearer tokens) are not logged.
- Typical log locations:
  - Windows: `%LOCALAPPDATA%\com.fliptrix.desktop\logs`
  - Linux: `$XDG_DATA_HOME/com.fliptrix.desktop/logs` (or `~/.local/share/com.fliptrix.desktop/logs`)

## Quality Checks

Frontend:

```bash
corepack pnpm test
corepack pnpm lint
corepack pnpm format:check
```

Rust:

```bash
. "$HOME/.cargo/env" && cargo fmt --all -- --check
. "$HOME/.cargo/env" && cargo test
```

End-to-end:

```bash
# Generic full E2E flows (runs on Windows and Linux)
corepack pnpm e2e:generic

# Platform-focused suites
corepack pnpm e2e:windows
corepack pnpm e2e:linux
```

Platform verification commands:

```bash
corepack pnpm verify:windows
corepack pnpm verify:linux
```

E2E suite types:

- Generic full E2E: shared desktop behavior on both platforms
- Windows-only focused tests: Windows-specific autostart/path behavior
- Linux-only focused tests: Linux-specific autostart/path behavior

Notes:

- Multi-monitor behavior is intentionally out of scope for current E2E tests
- E2E runs are deterministic and do not call live X APIs
- Linux E2E requires a real graphical session. On headless machines, Tauri/WebKitGTK may fail with `Failed to initialize GTK` or WebDriver session timeouts.
- If Linux E2E is blocked by a headless environment, the next steps are:
- install the native drivers: `cargo install tauri-driver` and `sudo apt install webkit2gtk-driver`
- run the tests inside a desktop session with `DISPLAY` or Wayland available, or provide a virtual display such as `xvfb`
- verify the app launches directly before retrying E2E: `src-tauri/target/debug/fliptrix`

## Useful Commands

```bash
corepack pnpm tauri dev
corepack pnpm tauri build
corepack pnpm test
corepack pnpm lint
corepack pnpm format
corepack pnpm e2e:generic
corepack pnpm e2e:windows
corepack pnpm e2e:linux
```

## Notes

- Primary runtime target: Windows 11
- Linux is supported for development and packaging
- user-space only, no admin rights required
- no native `.scr` registration

## Documentation

- Product requirements: `docs/PRD`
- Technical spec: `docs/TECH-SPEC.md`
- Implementation plan: `docs/IMPLEMENTATION-PLAN.md`
- E2E testing guide: `docs/E2E-TESTING.md`
