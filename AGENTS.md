# AGENTS.md

## Purpose

- Guide coding agents working in `fliptrix`.
- Make the smallest correct change that moves the app toward the documented screensaver architecture.
- Treat `docs/TECH-SPEC.md` and `docs/PRD` as the product source of truth.

## Read First

- Read `docs/TECH-SPEC.md` before changing runtime architecture, platform behavior, windowing, or idle detection.
- Read `docs/PRD` before changing user-facing behavior, settings semantics, or data rules.

## Product Constraints

- user-space only
- no native `.scr` registration
- Windows-first production target
- multi-monitor support is required
- all displayed content should come from X data when configured
- keep storage simple unless requirements change

## Stack

- frontend: vanilla TypeScript + Vite
- desktop runtime: Tauri v2
- native integration: Rust
- package manager: `pnpm` via `corepack`

## Architecture Rules

- keep idle monitoring separate from screensaver rendering
- isolate platform-specific Rust code behind small modules
- prefer one fullscreen window per monitor
- keep settings logic separate from renderer logic
- keep X fetch/cache logic separate from rendering
- prefer explicit, readable code over heavy abstraction

## Working Commands

- install deps: `corepack pnpm install`
- dev app: `corepack pnpm tauri dev`
- build frontend: `corepack pnpm build`
- build desktop app: `corepack pnpm tauri build`
- lint: `corepack pnpm lint`
- format check: `corepack pnpm format:check`
- frontend tests: `corepack pnpm test`
- rust fmt check: `. "$HOME/.cargo/env" && cargo fmt --all -- --check`
- rust tests: `. "$HOME/.cargo/env" && cargo test`

## Current State

- Phase 7 is complete.
- Settings UI, autostart, and mode switching are implemented.
- Matrix and FlipFlap each have their own X settings and cache files.
- Main implementation lives in `src/` and `src-tauri/`.

## Editing Guidance

- prefer small, direct changes
- match existing naming and file structure
- add or update regression tests when behavior changes
- use Biome for frontend formatting and `rustfmt` for Rust
- avoid changing host dependency setup unless the problem is actually environmental

## When Updating This File

- keep it short
- keep it repo-specific
- update commands or architecture notes when they materially change
