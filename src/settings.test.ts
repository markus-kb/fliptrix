import { describe, expect, it } from "vitest";

import {
  type AppSettings,
  DEFAULT_SETTINGS,
  type ScreensaverDisplayTarget,
  type ScreensaverMode,
} from "./settings";

describe("DEFAULT_SETTINGS", () => {
  it("uses matrix as the default mode", () => {
    expect(DEFAULT_SETTINGS.mode).toBe<ScreensaverMode>("matrix");
  });

  it("has a 5-minute idle timeout by default", () => {
    expect(DEFAULT_SETTINGS.idle_timeout_secs).toBe(300);
  });

  it("has a 5-pixel dead-zone by default", () => {
    expect(DEFAULT_SETTINGS.mouse_dead_zone_px).toBe(5);
  });

  it("keeps debug logging disabled by default", () => {
    expect(DEFAULT_SETTINGS.debug_logging_enabled).toBe(false);
  });

  it("has expected FlipFlap defaults", () => {
    expect(DEFAULT_SETTINGS.flipflap_rows).toBe(8);
    expect(DEFAULT_SETTINGS.flipflap_cols).toBe(40);
    expect(DEFAULT_SETTINGS.flipflap_tick_ms).toBe(80);
    expect(DEFAULT_SETTINGS.flipflap_rotation_secs).toBe(6);
    expect(DEFAULT_SETTINGS.flipflap_volume).toBeCloseTo(0.6);
    expect(DEFAULT_SETTINGS.flipflap_background_image).toBeNull();
    expect(DEFAULT_SETTINGS.flipflap_background_animation_enabled).toBe(true);
    expect(DEFAULT_SETTINGS.flipflap_background_pulse_speed).toBe(1);
  });

  it("has expected Matrix defaults", () => {
    expect(DEFAULT_SETTINGS.matrix_font_size).toBe(24);
    expect(DEFAULT_SETTINGS.matrix_spawn_density).toBeCloseTo(0.5);
    expect(DEFAULT_SETTINGS.matrix_glow_intensity).toBe(12);
    expect(DEFAULT_SETTINGS.matrix_tick_ms).toBe(40);
    expect(DEFAULT_SETTINGS.matrix_background_layers).toBe(1);
    expect(DEFAULT_SETTINGS.matrix_post_rotation_secs).toBe(15);
  });

  it("has expected FlipFlap X data defaults", () => {
    expect(DEFAULT_SETTINGS.flipflap_accounts).toEqual([]);
    expect(DEFAULT_SETTINGS.flipflap_search_query).toBe("");
    expect(DEFAULT_SETTINGS.flipflap_time_window_hours).toBe(24);
    expect(DEFAULT_SETTINGS.flipflap_truncation_chars).toBe(280);
  });

  it("has expected Matrix X data defaults", () => {
    expect(DEFAULT_SETTINGS.matrix_accounts).toEqual([]);
    expect(DEFAULT_SETTINGS.matrix_search_query).toBe("");
    expect(DEFAULT_SETTINGS.matrix_time_window_hours).toBe(24);
    expect(DEFAULT_SETTINGS.matrix_truncation_chars).toBe(280);
  });

  it("has expected auto-refresh and startup fetch defaults", () => {
    expect(DEFAULT_SETTINGS.auto_refresh_hours).toBe(0);
    expect(DEFAULT_SETTINGS.fetch_on_startup).toBe(false);
  });

  it("targets all screens by default", () => {
    expect(DEFAULT_SETTINGS.screensaver_display_target).toBe<ScreensaverDisplayTarget>("all");
  });

  it("is a plain object (spread-cloneable without reference sharing)", () => {
    const copy: AppSettings = { ...DEFAULT_SETTINGS };
    copy.idle_timeout_secs = 999;
    expect(DEFAULT_SETTINGS.idle_timeout_secs).toBe(300);
  });
});

describe("ScreensaverMode type", () => {
  it("accepts all three valid mode strings", () => {
    const modes: ScreensaverMode[] = ["flip_flap", "matrix", "both"];
    expect(modes).toHaveLength(3);
  });
});

describe("ScreensaverDisplayTarget type", () => {
  it("accepts all valid display target strings", () => {
    const targets: ScreensaverDisplayTarget[] = ["main_only", "other_only", "all"];
    expect(targets).toHaveLength(3);
  });
});
