# fliptrix

A desktop screensaver that renders live X/Twitter posts as a **split-flap departure board** or **Matrix digital rain**. Built with Tauri, Rust, and vanilla TypeScript.

![fliptrix](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue) ![fliptrix](https://img.shields.io/badge/status-phase%207-green)

## Modes

- **FlipFlap** — realistic airport split-flap display with per-cell character rotation, mechanical click sounds, and optional background image with pulse animation
- **Matrix** — classic green digital rain with X posts embedded as data packets
- **Both** — auto-switches between modes at a configurable interval

## Features

- Fullscreen borderless window on each monitor
- Idle activation with configurable timeout (default 5 minutes)
- Immediate exit on keyboard or mouse movement (with dead-zone)
- X API v2 integration with per-mode account/search configuration
- Auto-refresh and fetch-on-startup
- User-level autostart (no admin rights)
- User-space only — no `.scr` registration or system hooks

## Install

```bash
corepack pnpm install
```

Linux requires system packages:

```bash
sudo apt install pkg-config patchelf libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev
```

## Run

```bash
corepack pnpm tauri dev        # desktop app with hot reload
corepack pnpm dev              # frontend only
```

## Build

```bash
corepack pnpm build            # frontend assets
corepack pnpm tauri build      # desktop application bundle
```

## Commands

```bash
corepack pnpm test             # TS unit tests
corepack pnpm lint             # Biome lint
corepack pnpm format:check     # Biome format check
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
cargo fmt --all -- --check      # Rust format check
corepack pnpm e2e:generic      # cross-platform E2E
corepack pnpm e2e:windows      # Windows E2E
corepack pnpm e2e:linux         # Linux E2E
```

## X API Setup

1. Launch fliptrix and open settings
2. Paste your X API bearer token and click **Save token**
3. Configure accounts or search queries per mode
4. Click **Refresh posts now** to fetch content

Alternatively, set the `FLIPTRIX_BEARER_TOKEN` environment variable. The stored token takes priority; the env var is used as fallback and is never written to disk.

## Security

The bearer token is stored in plaintext in `store.json` (app data directory). See [docs/REFERENCE.md](docs/REFERENCE.md#security) for details and recommendations.

## Documentation

- [Reference](docs/REFERENCE.md) — architecture, settings, X data flow, security, E2E testing, storage paths

## Build Verification

Each binary displays its source commit hash in Settings (next to the app title). Compare it against `git log --oneline -1` on the repo to confirm provenance. Builds without git show `"dev"`.

## License

Private — all rights reserved.