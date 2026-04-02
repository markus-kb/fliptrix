import { describe, expect, it } from "vitest";

import { DEFAULT_AUDIO_CONFIG, type FlipAudioConfig, randomizeFlipParams } from "./flipflap-audio";

describe("DEFAULT_AUDIO_CONFIG", () => {
  it("has sensible defaults for volume and pitch", () => {
    expect(DEFAULT_AUDIO_CONFIG.masterVolume).toBeGreaterThan(0);
    expect(DEFAULT_AUDIO_CONFIG.masterVolume).toBeLessThanOrEqual(1);
    expect(DEFAULT_AUDIO_CONFIG.pitchCenter).toBeGreaterThan(500);
    expect(DEFAULT_AUDIO_CONFIG.pitchVariation).toBeGreaterThan(0);
    expect(DEFAULT_AUDIO_CONFIG.volumeVariation).toBeGreaterThan(0);
    expect(DEFAULT_AUDIO_CONFIG.volumeVariation).toBeLessThan(1);
  });

  it("has a short duration appropriate for a mechanical click", () => {
    expect(DEFAULT_AUDIO_CONFIG.durationMs).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_AUDIO_CONFIG.durationMs).toBeLessThanOrEqual(50);
  });
});

describe("randomizeFlipParams", () => {
  it("returns pitch within the configured variation range", () => {
    const config: FlipAudioConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      pitchCenter: 1000,
      pitchVariation: 200,
    };

    // Run multiple times to cover randomness
    for (let i = 0; i < 50; i++) {
      const params = randomizeFlipParams(config);
      expect(params.pitch).toBeGreaterThanOrEqual(800);
      expect(params.pitch).toBeLessThanOrEqual(1200);
    }
  });

  it("returns volume within the configured variation range", () => {
    const config: FlipAudioConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      masterVolume: 0.5,
      volumeVariation: 0.2,
    };

    for (let i = 0; i < 50; i++) {
      const params = randomizeFlipParams(config);
      expect(params.volume).toBeGreaterThanOrEqual(0.3);
      expect(params.volume).toBeLessThanOrEqual(0.7);
    }
  });

  it("clamps volume to 0-1 range", () => {
    const config: FlipAudioConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      masterVolume: 0.95,
      volumeVariation: 0.5, // Could push above 1
    };

    for (let i = 0; i < 50; i++) {
      const params = randomizeFlipParams(config);
      expect(params.volume).toBeLessThanOrEqual(1);
      expect(params.volume).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns duration from config", () => {
    const config: FlipAudioConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      durationMs: 25,
    };

    const params = randomizeFlipParams(config);
    expect(params.durationMs).toBe(25);
  });

  it("produces varying results across calls (not constant)", () => {
    const pitches = new Set<number>();
    for (let i = 0; i < 20; i++) {
      pitches.add(randomizeFlipParams(DEFAULT_AUDIO_CONFIG).pitch);
    }
    // With randomness, we should get more than 1 unique value in 20 tries
    expect(pitches.size).toBeGreaterThan(1);
  });
});
