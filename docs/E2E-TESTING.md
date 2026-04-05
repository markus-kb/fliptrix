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
corepack pnpm e2e:windows
corepack pnpm e2e:linux
```

Verification commands:

```bash
corepack pnpm verify:windows
corepack pnpm verify:linux
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
