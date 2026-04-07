//! User-facing application settings — modes, renderer parameters, and
//! general screensaver behaviour.
//!
//! This module owns the canonical `AppSettings` type and its defaults.
//! Persistence is handled by `tauri-plugin-store` in `lib.rs`; this module
//! stays pure (no I/O) so it can be unit-tested without a Tauri runtime.
//!
//! # Design rationale
//! A single flat struct is deliberately chosen over per-section sub-structs
//! because: (a) the total field count is small, (b) the frontend always
//! reads/writes the whole settings object in one round-trip, and (c) flat
//! serialisation makes forward-compatibility easy (unknown keys are silently
//! ignored by serde).

use serde::{Deserialize, Serialize};

use crate::models::{FetchConfig, ModeDataConfig};

// ---------------------------------------------------------------------------
// Screensaver mode
// ---------------------------------------------------------------------------

/// Which visual mode the screensaver runs in.
///
/// `Both` rotates between FlipFlap and Matrix on a configurable interval.
/// Switching mode is only allowed from within the settings window, never
/// during an active screensaver session.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreensaverMode {
    FlipFlap,
    #[default]
    Matrix,
    Both,
}

// ---------------------------------------------------------------------------
// Top-level settings
// ---------------------------------------------------------------------------

/// All user-configurable settings for fliptrix.
///
/// Stored as JSON via `tauri-plugin-store` under the key `"app_settings"`.
/// All fields carry `serde(default)` so new fields added in future versions
/// get their Rust defaults when loading an older persisted file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    // --- General ---
    /// Seconds of inactivity before the screensaver activates (default: 300).
    #[serde(default = "default_idle_timeout_secs")]
    pub idle_timeout_secs: u64,

    /// Pixel radius within which mouse movement is ignored (default: 5).
    #[serde(default = "default_mouse_dead_zone_px")]
    pub mouse_dead_zone_px: f64,

    /// Enables verbose debug/trace logging for diagnostics (default: false).
    #[serde(default = "default_debug_logging_enabled")]
    pub debug_logging_enabled: bool,

    // --- Mode ---
    /// Which visual mode to show (default: Matrix).
    #[serde(default)]
    pub mode: ScreensaverMode,

    /// When `mode == Both`, minutes between automatic mode switches (default: 10).
    #[serde(default = "default_mode_switch_interval_mins")]
    pub mode_switch_interval_mins: u64,

    // --- FlipFlap renderer ---
    /// FlipFlap board rows (default: 8).
    #[serde(default = "default_flipflap_rows")]
    pub flipflap_rows: usize,

    /// FlipFlap board columns (default: 40).
    #[serde(default = "default_flipflap_cols")]
    pub flipflap_cols: usize,

    /// Milliseconds between cell advance ticks (default: 80).
    #[serde(default = "default_flipflap_tick_ms")]
    pub flipflap_tick_ms: u64,

    /// Seconds before rotating to the next post (default: 20).
    #[serde(default = "default_flipflap_rotation_secs")]
    pub flipflap_rotation_secs: u64,

    /// Master flip-sound volume, 0.0–1.0 (default: 0.6).
    #[serde(default = "default_flipflap_volume")]
    pub flipflap_volume: f64,

    /// Optional filename from `src/assets/bg` used as FlipFlap background.
    #[serde(default)]
    pub flipflap_background_image: Option<String>,

    /// Enables the subtle background pulse animation in FlipFlap mode.
    #[serde(default = "default_flipflap_background_animation_enabled")]
    pub flipflap_background_animation_enabled: bool,

    /// Speed multiplier for FlipFlap background pulse (default: 1.0).
    #[serde(default = "default_flipflap_background_pulse_speed")]
    pub flipflap_background_pulse_speed: f64,

    /// X accounts whose posts should appear in FlipFlap mode.
    #[serde(default)]
    pub flipflap_accounts: Vec<String>,

    /// Optional X recent-search query for FlipFlap mode.
    #[serde(default)]
    pub flipflap_search_query: String,

    /// How many hours of FlipFlap posts to fetch from X.
    #[serde(default = "default_flipflap_time_window_hours")]
    pub flipflap_time_window_hours: u64,

    /// Maximum displayed character count for FlipFlap posts.
    #[serde(default = "default_flipflap_truncation_chars")]
    pub flipflap_truncation_chars: usize,

    // --- Matrix renderer ---
    /// Rain character font size in pixels (default: 24).
    #[serde(default = "default_matrix_font_size")]
    pub matrix_font_size: u32,

    /// Probability a column spawns a new drop per tick, 0.0–1.0 (default: 0.5).
    #[serde(default = "default_matrix_spawn_density")]
    pub matrix_spawn_density: f64,

    /// Canvas shadow blur radius in pixels for the green glow (default: 12).
    #[serde(default = "default_matrix_glow_intensity")]
    pub matrix_glow_intensity: f64,

    /// Milliseconds between rain advance ticks (default: 40).
    #[serde(default = "default_matrix_tick_ms")]
    pub matrix_tick_ms: u64,

    /// Number of background rain layers to render behind the foreground (default: 1).
    #[serde(default = "default_matrix_background_layers")]
    pub matrix_background_layers: u8,

    /// Seconds before rotating to the next post as a data packet (default: 15).
    #[serde(default = "default_matrix_post_rotation_secs")]
    pub matrix_post_rotation_secs: u64,

    /// X accounts whose posts should appear in Matrix mode.
    #[serde(default)]
    pub matrix_accounts: Vec<String>,

    /// Optional X recent-search query for Matrix mode.
    #[serde(default)]
    pub matrix_search_query: String,

    /// How many hours of Matrix posts to fetch from X.
    #[serde(default = "default_matrix_time_window_hours")]
    pub matrix_time_window_hours: u64,

    /// Maximum displayed character count for Matrix posts.
    #[serde(default = "default_matrix_truncation_chars")]
    pub matrix_truncation_chars: usize,
}

// ---------------------------------------------------------------------------
// Default helpers — serde requires free functions for `serde(default = "...")`.
// ---------------------------------------------------------------------------

fn default_idle_timeout_secs() -> u64 {
    300
}
fn default_mouse_dead_zone_px() -> f64 {
    5.0
}
fn default_debug_logging_enabled() -> bool {
    false
}
fn default_mode_switch_interval_mins() -> u64 {
    10
}
fn default_flipflap_rows() -> usize {
    8
}
fn default_flipflap_cols() -> usize {
    40
}
fn default_flipflap_tick_ms() -> u64 {
    80
}
fn default_flipflap_rotation_secs() -> u64 {
    6
}
fn default_flipflap_volume() -> f64 {
    0.6
}
fn default_flipflap_background_animation_enabled() -> bool {
    true
}
fn default_flipflap_background_pulse_speed() -> f64 {
    1.0
}
fn default_flipflap_time_window_hours() -> u64 {
    24
}
fn default_flipflap_truncation_chars() -> usize {
    280
}
fn default_matrix_font_size() -> u32 {
    24
}
fn default_matrix_spawn_density() -> f64 {
    0.5
}
fn default_matrix_glow_intensity() -> f64 {
    12.0
}
fn default_matrix_tick_ms() -> u64 {
    40
}
fn default_matrix_background_layers() -> u8 {
    1
}
fn default_matrix_post_rotation_secs() -> u64 {
    15
}
fn default_matrix_time_window_hours() -> u64 {
    24
}
fn default_matrix_truncation_chars() -> usize {
    280
}

const LEGACY_FLIPFLAP_TICK_MS: u64 = 30;
const LEGACY_MATRIX_FONT_SIZE: u32 = 16;
const LEGACY_MATRIX_SPAWN_DENSITY: f64 = 0.04;
const LEGACY_MATRIX_GLOW_INTENSITY: f64 = 6.0;
const LEGACY_MATRIX_TICK_MS: u64 = 50;

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            idle_timeout_secs: default_idle_timeout_secs(),
            mouse_dead_zone_px: default_mouse_dead_zone_px(),
            debug_logging_enabled: default_debug_logging_enabled(),
            mode: ScreensaverMode::default(),
            mode_switch_interval_mins: default_mode_switch_interval_mins(),
            flipflap_rows: default_flipflap_rows(),
            flipflap_cols: default_flipflap_cols(),
            flipflap_tick_ms: default_flipflap_tick_ms(),
            flipflap_rotation_secs: default_flipflap_rotation_secs(),
            flipflap_volume: default_flipflap_volume(),
            flipflap_background_image: None,
            flipflap_background_animation_enabled: default_flipflap_background_animation_enabled(),
            flipflap_background_pulse_speed: default_flipflap_background_pulse_speed(),
            flipflap_accounts: Vec::new(),
            flipflap_search_query: String::new(),
            flipflap_time_window_hours: default_flipflap_time_window_hours(),
            flipflap_truncation_chars: default_flipflap_truncation_chars(),
            matrix_font_size: default_matrix_font_size(),
            matrix_spawn_density: default_matrix_spawn_density(),
            matrix_glow_intensity: default_matrix_glow_intensity(),
            matrix_tick_ms: default_matrix_tick_ms(),
            matrix_background_layers: default_matrix_background_layers(),
            matrix_post_rotation_secs: default_matrix_post_rotation_secs(),
            matrix_accounts: Vec::new(),
            matrix_search_query: String::new(),
            matrix_time_window_hours: default_matrix_time_window_hours(),
            matrix_truncation_chars: default_matrix_truncation_chars(),
        }
    }
}

impl AppSettings {
    pub fn upgrade_legacy_defaults(mut self) -> Self {
        if self.flipflap_rows == 8
            && self.flipflap_cols == 40
            && self.flipflap_tick_ms == LEGACY_FLIPFLAP_TICK_MS
        {
            self.flipflap_tick_ms = default_flipflap_tick_ms();
        }

        if self.matrix_font_size == LEGACY_MATRIX_FONT_SIZE
            && (self.matrix_spawn_density - LEGACY_MATRIX_SPAWN_DENSITY).abs() < f64::EPSILON
            && (self.matrix_glow_intensity - LEGACY_MATRIX_GLOW_INTENSITY).abs() < f64::EPSILON
            && self.matrix_tick_ms == LEGACY_MATRIX_TICK_MS
        {
            self.matrix_font_size = default_matrix_font_size();
            self.matrix_spawn_density = default_matrix_spawn_density();
            self.matrix_glow_intensity = default_matrix_glow_intensity();
            self.matrix_tick_ms = default_matrix_tick_ms();
        }

        self
    }

    fn mode_data_config(
        accounts: &[String],
        search_query: &str,
        time_window_hours: u64,
        truncation_chars: usize,
    ) -> ModeDataConfig {
        ModeDataConfig {
            accounts: accounts.to_vec(),
            search_query: if search_query.trim().is_empty() {
                None
            } else {
                Some(search_query.trim().to_string())
            },
            time_window_hours,
            truncation_length: truncation_chars,
        }
    }

    pub fn to_fetch_config(&self) -> FetchConfig {
        FetchConfig {
            flipflap: Self::mode_data_config(
                &self.flipflap_accounts,
                &self.flipflap_search_query,
                self.flipflap_time_window_hours,
                self.flipflap_truncation_chars,
            ),
            matrix: Self::mode_data_config(
                &self.matrix_accounts,
                &self.matrix_search_query,
                self.matrix_time_window_hours,
                self.matrix_truncation_chars,
            ),
        }
    }

    /// Validates that all numeric fields are within acceptable ranges.
    ///
    /// Returns an error string describing the first out-of-range field, or
    /// `Ok(())` if everything is valid.
    ///
    /// Validation is intentionally lenient — we clamp rather than reject where
    /// possible, but completely nonsensical values (zero tick, zero columns)
    /// would break the renderer and are rejected here.
    pub fn validate(&self) -> Result<(), String> {
        if self.idle_timeout_secs == 0 {
            return Err("idle_timeout_secs must be > 0".into());
        }
        if self.mouse_dead_zone_px < 0.0 {
            return Err("mouse_dead_zone_px must be >= 0".into());
        }
        if self.mode_switch_interval_mins == 0 {
            return Err("mode_switch_interval_mins must be > 0".into());
        }
        if self.flipflap_rows == 0 {
            return Err("flipflap_rows must be > 0".into());
        }
        if self.flipflap_cols == 0 {
            return Err("flipflap_cols must be > 0".into());
        }
        if self.flipflap_tick_ms == 0 {
            return Err("flipflap_tick_ms must be > 0".into());
        }
        if self.flipflap_rotation_secs == 0 {
            return Err("flipflap_rotation_secs must be > 0".into());
        }
        if !(0.0..=1.0).contains(&self.flipflap_volume) {
            return Err("flipflap_volume must be 0.0–1.0".into());
        }
        if !(0.1..=3.0).contains(&self.flipflap_background_pulse_speed) {
            return Err("flipflap_background_pulse_speed must be 0.1–3.0".into());
        }
        if self.flipflap_time_window_hours == 0 {
            return Err("flipflap_time_window_hours must be > 0".into());
        }
        if self.flipflap_truncation_chars == 0 {
            return Err("flipflap_truncation_chars must be > 0".into());
        }
        if self.matrix_font_size == 0 {
            return Err("matrix_font_size must be > 0".into());
        }
        if !(0.0..=1.0).contains(&self.matrix_spawn_density) {
            return Err("matrix_spawn_density must be 0.0–1.0".into());
        }
        if self.matrix_glow_intensity < 0.0 {
            return Err("matrix_glow_intensity must be >= 0".into());
        }
        if self.matrix_tick_ms == 0 {
            return Err("matrix_tick_ms must be > 0".into());
        }
        if self.matrix_background_layers > 3 {
            return Err("matrix_background_layers must be 0–3".into());
        }
        if self.matrix_post_rotation_secs == 0 {
            return Err("matrix_post_rotation_secs must be > 0".into());
        }
        if self.matrix_time_window_hours == 0 {
            return Err("matrix_time_window_hours must be > 0".into());
        }
        if self.matrix_truncation_chars == 0 {
            return Err("matrix_truncation_chars must be > 0".into());
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings_are_valid() {
        assert!(AppSettings::default().validate().is_ok());
    }

    #[test]
    fn test_default_mode_is_matrix() {
        assert_eq!(AppSettings::default().mode, ScreensaverMode::Matrix);
    }

    #[test]
    fn test_default_idle_timeout() {
        assert_eq!(AppSettings::default().idle_timeout_secs, 300);
    }

    #[test]
    fn test_default_dead_zone() {
        assert!((AppSettings::default().mouse_dead_zone_px - 5.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_default_debug_logging_disabled() {
        assert!(!AppSettings::default().debug_logging_enabled);
    }

    #[test]
    fn test_default_matrix_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.matrix_font_size, 24);
        assert!((settings.matrix_spawn_density - 0.5).abs() < f64::EPSILON);
        assert!((settings.matrix_glow_intensity - 12.0).abs() < f64::EPSILON);
        assert_eq!(settings.matrix_tick_ms, 40);
        assert_eq!(settings.matrix_background_layers, 1);
    }

    #[test]
    fn test_default_flipflap_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.flipflap_rows, 8);
        assert_eq!(settings.flipflap_cols, 40);
        assert_eq!(settings.flipflap_tick_ms, 80);
        assert_eq!(settings.flipflap_background_image, None);
        assert!(settings.flipflap_background_animation_enabled);
        assert!((settings.flipflap_background_pulse_speed - 1.0).abs() < f64::EPSILON);
        assert_eq!(settings.flipflap_rotation_secs, 6);
    }

    #[test]
    fn test_default_x_data_settings() {
        let settings = AppSettings::default();
        assert!(settings.flipflap_accounts.is_empty());
        assert_eq!(settings.flipflap_search_query, "");
        assert_eq!(settings.flipflap_time_window_hours, 24);
        assert_eq!(settings.flipflap_truncation_chars, 280);
        assert!(settings.matrix_accounts.is_empty());
        assert_eq!(settings.matrix_search_query, "");
        assert_eq!(settings.matrix_time_window_hours, 24);
        assert_eq!(settings.matrix_truncation_chars, 280);
    }

    #[test]
    fn test_serialization_roundtrip() {
        let settings = AppSettings::default();
        let json = serde_json::to_string(&settings).unwrap();
        let restored: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(settings, restored);
    }

    #[test]
    fn test_deserialization_fills_missing_fields_with_defaults() {
        // An empty JSON object should give us all defaults.
        let settings: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings, AppSettings::default());
    }

    #[test]
    fn test_mode_serializes_as_snake_case() {
        let s = serde_json::to_string(&ScreensaverMode::FlipFlap).unwrap();
        assert_eq!(s, "\"flip_flap\"");
        let s = serde_json::to_string(&ScreensaverMode::Matrix).unwrap();
        assert_eq!(s, "\"matrix\"");
        let s = serde_json::to_string(&ScreensaverMode::Both).unwrap();
        assert_eq!(s, "\"both\"");
    }

    #[test]
    fn test_mode_deserializes_from_snake_case() {
        let m: ScreensaverMode = serde_json::from_str("\"flip_flap\"").unwrap();
        assert_eq!(m, ScreensaverMode::FlipFlap);
        let m: ScreensaverMode = serde_json::from_str("\"matrix\"").unwrap();
        assert_eq!(m, ScreensaverMode::Matrix);
        let m: ScreensaverMode = serde_json::from_str("\"both\"").unwrap();
        assert_eq!(m, ScreensaverMode::Both);
    }

    #[test]
    fn test_validate_rejects_zero_idle_timeout() {
        let mut s = AppSettings::default();
        s.idle_timeout_secs = 0;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_negative_dead_zone() {
        let mut s = AppSettings::default();
        s.mouse_dead_zone_px = -1.0;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_volume_out_of_range() {
        let mut s = AppSettings::default();
        s.flipflap_volume = 1.1;
        assert!(s.validate().is_err());
        s.flipflap_volume = -0.1;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_background_pulse_speed_out_of_range() {
        let mut s = AppSettings::default();
        s.flipflap_background_pulse_speed = 0.09;
        assert!(s.validate().is_err());
        s.flipflap_background_pulse_speed = 3.1;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_spawn_density_out_of_range() {
        let mut s = AppSettings::default();
        s.matrix_spawn_density = 1.5;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_zero_flipflap_rows() {
        let mut s = AppSettings::default();
        s.flipflap_rows = 0;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_zero_matrix_font_size() {
        let mut s = AppSettings::default();
        s.matrix_font_size = 0;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_zero_flipflap_time_window() {
        let mut s = AppSettings::default();
        s.flipflap_time_window_hours = 0;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_zero_matrix_truncation_chars() {
        let mut s = AppSettings::default();
        s.matrix_truncation_chars = 0;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_too_many_matrix_background_layers() {
        let mut s = AppSettings::default();
        s.matrix_background_layers = 4;
        assert!(s.validate().is_err());
    }

    #[test]
    fn test_to_fetch_config_maps_per_mode_x_fields() {
        let settings = AppSettings {
            flipflap_accounts: vec!["alice".into(), "bob".into()],
            flipflap_search_query: "from:alice has:media".into(),
            flipflap_time_window_hours: 12,
            flipflap_truncation_chars: 140,
            matrix_accounts: vec!["carol".into()],
            matrix_search_query: String::new(),
            matrix_time_window_hours: 48,
            matrix_truncation_chars: 320,
            ..AppSettings::default()
        };

        let config = settings.to_fetch_config();

        assert_eq!(config.flipflap.accounts, vec!["alice", "bob"]);
        assert_eq!(
            config.flipflap.search_query.as_deref(),
            Some("from:alice has:media")
        );
        assert_eq!(config.flipflap.time_window_hours, 12);
        assert_eq!(config.flipflap.truncation_length, 140);
        assert_eq!(config.matrix.accounts, vec!["carol"]);
        assert_eq!(config.matrix.search_query, None);
        assert_eq!(config.matrix.time_window_hours, 48);
        assert_eq!(config.matrix.truncation_length, 320);
    }

    #[test]
    fn test_partial_json_override() {
        // Supplying only some fields should keep the rest at their defaults.
        let json = r#"{"mode": "flip_flap", "idle_timeout_secs": 600}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.mode, ScreensaverMode::FlipFlap);
        assert_eq!(settings.idle_timeout_secs, 600);
        // Unspecified fields stay at defaults.
        assert!(!settings.debug_logging_enabled);
        assert_eq!(settings.flipflap_rows, 8);
        assert_eq!(settings.matrix_font_size, 24);
        assert_eq!(settings.flipflap_time_window_hours, 24);
        assert_eq!(settings.matrix_truncation_chars, 280);
    }

    #[test]
    fn test_upgrade_legacy_defaults_updates_old_renderer_defaults() {
        let upgraded = AppSettings {
            flipflap_tick_ms: 30,
            matrix_font_size: 16,
            matrix_spawn_density: 0.04,
            matrix_glow_intensity: 6.0,
            matrix_tick_ms: 50,
            ..AppSettings::default()
        }
        .upgrade_legacy_defaults();

        assert_eq!(upgraded.flipflap_tick_ms, 80);
        assert_eq!(upgraded.matrix_font_size, 24);
        assert!((upgraded.matrix_spawn_density - 0.5).abs() < f64::EPSILON);
        assert!((upgraded.matrix_glow_intensity - 12.0).abs() < f64::EPSILON);
        assert_eq!(upgraded.matrix_tick_ms, 40);
    }
}
