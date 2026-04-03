import { describe, expect, it } from "vitest";

import {
  computeMatrixGrid,
  DEFAULT_MATRIX_CONFIG,
  deriveMatrixLayerConfigs,
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
    };
    expect(config.fontSize).toBe(24);
    expect(config.spawnDensity).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Layered depth treatment
// ---------------------------------------------------------------------------

describe("deriveMatrixLayerConfigs", () => {
  it("creates far, mid, and foreground layers in order", () => {
    const layers = deriveMatrixLayerConfigs(DEFAULT_MATRIX_CONFIG);

    expect(layers.map((layer) => layer.id)).toEqual(["far", "mid", "foreground"]);
  });

  it("keeps the foreground brightest and fastest", () => {
    const [far, mid, foreground] = deriveMatrixLayerConfigs(DEFAULT_MATRIX_CONFIG);

    expect(foreground.alpha).toBeGreaterThan(mid.alpha);
    expect(mid.alpha).toBeGreaterThan(far.alpha);
    expect(foreground.glowBlur).toBeGreaterThan(mid.glowBlur);
    expect(mid.glowBlur).toBeGreaterThanOrEqual(far.glowBlur);
    expect(foreground.tickIntervalMs).toBeLessThan(mid.tickIntervalMs);
    expect(mid.tickIntervalMs).toBeLessThan(far.tickIntervalMs);
  });

  it("keeps the background sparser than the foreground", () => {
    const [far, mid, foreground] = deriveMatrixLayerConfigs(DEFAULT_MATRIX_CONFIG);

    expect(far.spawnDensity).toBeLessThan(mid.spawnDensity);
    expect(mid.spawnDensity).toBeLessThan(foreground.spawnDensity);
  });
});
