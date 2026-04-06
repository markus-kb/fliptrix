# E2E Testing

This repository uses desktop end-to-end tests that drive the real Tauri app via `tauri-driver` and WebDriver.

## Test Suites

- `e2e:generic`: full shared E2E flows for both Windows and Linux
- `e2e:windows`: Windows-only focused checks
- `e2e:linux`: Linux-only focused checks

Multi-monitor checks are currently out of scope.

## Prerequisites

1. Install Node dependencies:

```bash
corepack pnpm install
```

2. Install `tauri-driver`:

```bash
cargo install tauri-driver
```

On Linux, also install the native WebKit driver package:

```bash
sudo apt install webkit2gtk-driver

# verify binary is available (note exact binary name)
which WebKitWebDriver
```

3. Build a Tauri binary (debug or release):

```bash
corepack pnpm build
corepack pnpm tauri build --debug --no-bundle
```

By default, the tests look for:

- `src-tauri/target/debug/fliptrix(.exe)`
- `src-tauri/target/release/fliptrix(.exe)`

You can override the binary path with `FLIPTRIX_E2E_APP`.

## Commands

```bash
corepack pnpm e2e:generic
corepack pnpm e2e:generic:headless
corepack pnpm e2e:windows
corepack pnpm e2e:linux
corepack pnpm e2e:linux:headless
```

Verification commands:

```bash
corepack pnpm verify:windows
corepack pnpm verify:linux
corepack pnpm verify:linux:headless
```

## Environment Variables

- `FLIPTRIX_E2E_APP`: absolute/relative path to the Tauri binary
- `FLIPTRIX_TAURI_DRIVER`: `tauri-driver` command override
- `FLIPTRIX_E2E_DRIVER_PORT`: WebDriver port (default `4444`)
- `FLIPTRIX_E2E_DRIVER_PATH`: WebDriver path (default `/`)
- `FLIPTRIX_E2E_DRIVER_ARGS`: extra args for `tauri-driver`
- `FLIPTRIX_E2E_APP_ARGS`: extra args passed to the app process

The test harness also sets these for deterministic execution:

- `FLIPTRIX_E2E=1`
- `FLIPTRIX_APP_DATA_DIR` (isolated temp directory)
- `FLIPTRIX_STORE_FILE` (suite-scoped store file)
- `FLIPTRIX_E2E_AUTOSTART_DIR` (isolated autostart directory)
- `FLIPTRIX_X_API_BASE` (fixture server URL for generic refresh tests)

## Determinism Rules

- No live X API calls during E2E runs.
- No writes to real user autostart files.
- Per-suite isolated app data and store file.

## Headless Linux

Linux E2E requires a real graphical session. On headless machines, the app may
fail before WebDriver can create a session, typically with errors like
`Failed to initialize GTK` or a timeout when creating the WebDriver session.

By default, the harness auto-detects `/usr/bin/WebKitWebDriver` and passes it
to `tauri-driver` on Linux when no explicit native driver argument is set.

If that happens, the next steps are:

1. Confirm the native drivers are installed: `cargo install tauri-driver`, `sudo apt install webkit2gtk-driver`, and `which WebKitWebDriver`
2. Verify the app launches directly: `src-tauri/target/debug/fliptrix`
3. Run the suite inside a desktop session with `DISPLAY` or Wayland available, or provide a virtual display:

```bash
xvfb-run -a corepack pnpm e2e:generic
```

For full CI-style verification on headless Linux:

```bash
corepack pnpm verify:linux:headless
```

4. If your WebKit driver lives outside `/usr/bin/WebKitWebDriver`, set it explicitly:

```bash
FLIPTRIX_E2E_DRIVER_ARGS="--native-driver /path/to/WebKitWebDriver" corepack pnpm e2e:generic
```
