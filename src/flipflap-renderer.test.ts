import { describe, expect, it } from "vitest";

import {
  computeCellLayout,
  createFlapSurfaceTheme,
  DEFAULT_FLIPFLAP_CONFIG,
} from "./flipflap-renderer";

describe("DEFAULT_FLIPFLAP_CONFIG", () => {
  it("uses the requested default timing", () => {
    expect(DEFAULT_FLIPFLAP_CONFIG.rows).toBe(8);
    expect(DEFAULT_FLIPFLAP_CONFIG.cols).toBe(40);
    expect(DEFAULT_FLIPFLAP_CONFIG.tickIntervalMs).toBe(80);
    expect(DEFAULT_FLIPFLAP_CONFIG.backgroundImageUrl).toBeNull();
    expect(DEFAULT_FLIPFLAP_CONFIG.backgroundAnimationEnabled).toBe(true);
    expect(DEFAULT_FLIPFLAP_CONFIG.backgroundSwirlSpeed).toBe(1);
  });
});

describe("createFlapSurfaceTheme", () => {
  it("creates distinct tones for the upper and lower flap halves", () => {
    const theme = createFlapSurfaceTheme();

    expect(theme.topBase).not.toBe(theme.bottomBase);
    expect(theme.hingeShadow).not.toBe(theme.topHighlight);
  });

  it("includes hardware accents for a more physical board", () => {
    const theme = createFlapSurfaceTheme();

    expect(theme.rivet).toMatch(/^#/);
    expect(theme.frameInner).toMatch(/^#/);
  });
});

describe("computeCellLayout", () => {
  it("computes positive cell dimensions for a standard canvas", () => {
    const layout = computeCellLayout(1920, 1080, 8, 40);

    expect(layout.cellWidth).toBeGreaterThan(0);
    expect(layout.cellHeight).toBeGreaterThan(0);
    expect(layout.offsetX).toBeGreaterThanOrEqual(0);
    expect(layout.offsetY).toBeGreaterThanOrEqual(0);
  });

  it("centers the board horizontally and vertically", () => {
    const layout = computeCellLayout(800, 600, 4, 10);

    // Total board width should be less than canvas width, with positive offset.
    // The renderer uses a 3px inter-cell gap in the current board treatment.
    const totalW = layout.cellWidth * 10 + 9 * 3;
    expect(layout.offsetX).toBeCloseTo((800 - totalW) / 2, 0);
  });

  it("handles very wide canvases without negative dimensions", () => {
    const layout = computeCellLayout(3840, 200, 2, 40);

    expect(layout.cellWidth).toBeGreaterThan(0);
    expect(layout.cellHeight).toBeGreaterThan(0);
  });

  it("handles very tall canvases without negative dimensions", () => {
    const layout = computeCellLayout(200, 2160, 20, 3);

    expect(layout.cellWidth).toBeGreaterThan(0);
    expect(layout.cellHeight).toBeGreaterThan(0);
  });

  it("scales proportionally for different board sizes", () => {
    const small = computeCellLayout(800, 600, 4, 20);
    const large = computeCellLayout(800, 600, 8, 40);

    // Larger board should have smaller cells
    expect(large.cellWidth).toBeLessThan(small.cellWidth);
    expect(large.cellHeight).toBeLessThan(small.cellHeight);
  });
});
