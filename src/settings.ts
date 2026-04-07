/**
 * Settings types and IPC helpers for the fliptrix settings window.
 *
 * This module owns the TypeScript mirror of the Rust `AppSettings` struct
 * and provides thin async wrappers around the Tauri commands so the settings
 * UI never calls `invoke` directly (keeps IPC surface auditable and testable).
 *
 * The shape MUST stay in sync with `src-tauri/src/settings.rs`. Serde field
 * names are snake_case to match the Rust serialisation convention.
 */

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which renderer the screensaver uses. Mirrors Rust `ScreensaverMode`. */
export type ScreensaverMode = "flip_flap" | "matrix" | "both";

/** All user-configurable settings. Mirrors Rust `AppSettings`. */
export interface AppSettings {
  // General
  idle_timeout_secs: number;
  mouse_dead_zone_px: number;
  debug_logging_enabled: boolean;

  // Mode
  mode: ScreensaverMode;
  mode_switch_interval_mins: number;

  // FlipFlap renderer
  flipflap_rows: number;
  flipflap_cols: number;
  flipflap_tick_ms: number;
  flipflap_rotation_secs: number;
  flipflap_volume: number;
  flipflap_background_image: string | null;
  flipflap_background_animation_enabled: boolean;
  flipflap_background_pulse_speed: number;
  flipflap_accounts: string[];
  flipflap_search_query: string;
  flipflap_time_window_hours: number;
  flipflap_truncation_chars: number;

  // Matrix renderer
  matrix_font_size: number;
  matrix_spawn_density: number;
  matrix_glow_intensity: number;
  matrix_tick_ms: number;
  matrix_background_layers: number;
  matrix_post_rotation_secs: number;
  matrix_accounts: string[];
  matrix_search_query: string;
  matrix_time_window_hours: number;
  matrix_truncation_chars: number;
}

/** Defaults that match `AppSettings::default()` in Rust. */
export const DEFAULT_SETTINGS: AppSettings = {
  idle_timeout_secs: 300,
  mouse_dead_zone_px: 5,
  debug_logging_enabled: false,
  mode: "matrix",
  mode_switch_interval_mins: 10,
  flipflap_rows: 8,
  flipflap_cols: 40,
  flipflap_tick_ms: 80,
  flipflap_rotation_secs: 6,
  flipflap_volume: 0.6,
  flipflap_background_image: null,
  flipflap_background_animation_enabled: true,
  flipflap_background_pulse_speed: 1,
  flipflap_accounts: [],
  flipflap_search_query: "",
  flipflap_time_window_hours: 24,
  flipflap_truncation_chars: 280,
  matrix_font_size: 24,
  matrix_spawn_density: 0.5,
  matrix_glow_intensity: 12,
  matrix_tick_ms: 40,
  matrix_background_layers: 1,
  matrix_post_rotation_secs: 15,
  matrix_accounts: [],
  matrix_search_query: "",
  matrix_time_window_hours: 24,
  matrix_truncation_chars: 280,
};

export function cloneDefaultSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    flipflap_accounts: [...DEFAULT_SETTINGS.flipflap_accounts],
    matrix_accounts: [...DEFAULT_SETTINGS.matrix_accounts],
  };
}

export function withScreensaverMode(settings: AppSettings, mode: ScreensaverMode): AppSettings {
  return {
    ...settings,
    mode,
  };
}

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

/**
 * Fetches the current settings from the Rust backend.
 * Falls back to `DEFAULT_SETTINGS` when no settings have been persisted yet.
 */
export async function getSettings(): Promise<AppSettings> {
  try {
    return await invoke<AppSettings>("get_settings");
  } catch {
    return cloneDefaultSettings();
  }
}

/**
 * Persists settings to the Rust backend.
 * The backend validates the values before writing; throws on validation error.
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  await invoke("set_settings", { newSettings: settings });
}

export async function activateScreensaver(): Promise<void> {
  await invoke("activate_screensaver");
}

/** Returns whether the autostart entry currently exists. */
export async function getAutostartEnabled(): Promise<boolean> {
  try {
    return await invoke<boolean>("get_autostart_enabled");
  } catch {
    return false;
  }
}

/**
 * Enables or disables the autostart entry.
 *
 * `exePath` is the path to the fliptrix binary. On Linux it becomes the
 * `Exec=` line in the `.desktop` file. Pass an empty string when disabling.
 */
export async function setAutostartEnabled(enabled: boolean, exePath: string): Promise<void> {
  await invoke("set_autostart_enabled", { enabled, exePath });
}

export async function openLogsDirectory(): Promise<string> {
  return await invoke<string>("open_logs_directory");
}
