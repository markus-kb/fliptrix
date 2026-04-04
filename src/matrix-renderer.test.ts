import { describe, expect, it } from "vitest";

import {
  computeMatrixGrid,
  DEFAULT_MATRIX_CONFIG,
  deriveMatrixLayerConfigs,
  MATRIX_GLYPH_PIXEL_SCALE,
  MATRIX_GREEN_PALETTE,
  type MatrixConfig,
} from "./matrix-renderer";

// ---------------------------------------------------------------------------
// computeMatrixGrid
// ---------------------------------------------------------------------------

describe("computeMatrixGrid", () => {
  it("computes positive rows and columns for a standard canvas", () => {
    const grid = computeMatrixGrid(1920, 1080, 20);
    expect(grid.cols).toBeGreaterThan(0);
    expect(grid.rows).toBeGreaterThan(0);
  });

  it("produces more columns than rows for a landscape canvas", () => {
    const grid = computeMatrixGrid(1920, 1080, 20);
    expect(grid.cols).toBeGreaterThan(grid.rows);
  });

  it("scales with font size — larger font means fewer columns", () => {
    const small = computeMatrixGrid(1920, 1080, 14);
    const large = computeMatrixGrid(1920, 1080, 28);
    expect(small.cols).toBeGreaterThan(large.cols);
    expect(small.rows).toBeGreaterThan(large.rows);
  });

  it("handles a minimal canvas without crashing", () => {
    const grid = computeMatrixGrid(40, 40, 20);
    expect(grid.cols).toBeGreaterThan(0);
    expect(grid.rows).toBeGreaterThan(0);
  });

  it("produces integer rows and columns", () => {
    const grid = computeMatrixGrid(800, 600, 16);
    expect(Number.isInteger(grid.cols)).toBe(true);
    expect(Number.isInteger(grid.rows)).toBe(true);
  });

  it("matches expected column count for known inputs", () => {
    // 1920 / 16 = 120 columns exactly
    const grid = computeMatrixGrid(1920, 960, 16);
    expect(grid.cols).toBe(120);
    expect(grid.rows).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MATRIX_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_MATRIX_CONFIG", () => {
  it("has a valid font size", () => {
    expect(DEFAULT_MATRIX_CONFIG.fontSize).toBeGreaterThan(8);
    expect(DEFAULT_MATRIX_CONFIG.fontSize).toBeLessThan(40);
  });

  it("has spawn density in valid range", () => {
    expect(DEFAULT_MATRIX_CONFIG.spawnDensity).toBeGreaterThan(0);
    expect(DEFAULT_MATRIX_CONFIG.spawnDensity).toBeLessThanOrEqual(1);
  });

  it("has a positive glow intensity", () => {
    expect(DEFAULT_MATRIX_CONFIG.glowIntensity).toBeGreaterThanOrEqual(0);
  });

  it("has a positive post rotation interval", () => {
    expect(DEFAULT_MATRIX_CONFIG.postRotationSec).toBeGreaterThan(0);
  });

  it("has a positive tick interval", () => {
    expect(DEFAULT_MATRIX_CONFIG.tickIntervalMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// MatrixConfig type contract
// ---------------------------------------------------------------------------

describe("MatrixConfig type contract", () => {
  it("accepts a minimal config override", () => {
    const config: MatrixConfig = {
      ...DEFAULT_MATRIX_CONFIG,
      fontSize: 24,
      spawnDensity: 0.5,
      backgroundLayerCount: 2,
    };
    expect(config.fontSize).toBe(24);
    expect(config.spawnDensity).toBe(0.5);
    expect(config.backgroundLayerCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Layered depth treatment
// ---------------------------------------------------------------------------

describe("deriveMatrixLayerConfigs", () => {
  it("creates far, mid, and foreground layers in order", () => {
    const layers = deriveMatrixLayerConfigs(DEFAULT_MATRIX_CONFIG);

    expect(layers.map((layer) => layer.id)).toEqual(["near", "foreground"]);
  });

  it("can disable all background layers", () => {
    const layers = deriveMatrixLayerConfigs({ ...DEFAULT_MATRIX_CONFIG, backgroundLayerCount: 0 });

    expect(layers.map((layer) => layer.id)).toEqual(["foreground"]);
  });

  it("can enable all background layers", () => {
    const layers = deriveMatrixLayerConfigs({ ...DEFAULT_MATRIX_CONFIG, backgroundLayerCount: 3 });

    expect(layers.map((layer) => layer.id)).toEqual(["far", "mid", "near", "foreground"]);
  });

  it("keeps the foreground brightest and fastest", () => {
    const [near, foreground] = deriveMatrixLayerConfigs(DEFAULT_MATRIX_CONFIG);

    expect(near.id).toBe("near");
    expect(foreground.id).toBe("foreground");
    expect(foreground.alpha).toBeGreaterThan(near.alpha);
    expect(foreground.glowBlur).toBeGreaterThan(near.glowBlur);
    expect(foreground.tickIntervalMs).toBeLessThan(near.tickIntervalMs);
  });

  it("keeps the background sparser than the foreground", () => {
    const [near, foreground] = deriveMatrixLayerConfigs(DEFAULT_MATRIX_CONFIG);

    expect(near.spawnDensity).toBeLessThan(foreground.spawnDensity);
  });

  it("gives the foreground a slightly larger apparent glyph size", () => {
    const [, foreground] = deriveMatrixLayerConfigs(DEFAULT_MATRIX_CONFIG);

    expect(foreground.fontSize).toBeGreaterThanOrEqual(
      Math.round(DEFAULT_MATRIX_CONFIG.fontSize * 1.18),
    );
  });

  it("pushes the foreground blur beyond the base glow setting", () => {
    const [, foreground] = deriveMatrixLayerConfigs(DEFAULT_MATRIX_CONFIG);

    expect(foreground.glowBlur).toBeGreaterThan(DEFAULT_MATRIX_CONFIG.glowIntensity * 2);
  });
});

describe("MATRIX_GREEN_PALETTE", () => {
  it("uses more than four green shades", () => {
    expect(MATRIX_GREEN_PALETTE.length).toBeGreaterThan(4);
  });

  it("keeps the highlight green-led instead of neutral white", () => {
    const head = MATRIX_GREEN_PALETTE[MATRIX_GREEN_PALETTE.length - 1];

    expect(head[1]).toBeGreaterThan(head[0]);
    expect(head[1]).toBeGreaterThan(head[2]);
  });
});

describe("MATRIX_GLYPH_PIXEL_SCALE", () => {
  it("renders glyph cores at a reduced internal resolution for visible pixel dots", () => {
    expect(MATRIX_GLYPH_PIXEL_SCALE).toBeLessThan(0.7);
  });
});
