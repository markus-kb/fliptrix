import { describe, expect, it } from "vitest";

import {
  computeCoverPlacement,
  computePulseTransform,
  DEFAULT_BACKGROUND_PULSE_SPEED,
} from "./background-image";

describe("computeCoverPlacement", () => {
  it("fills the viewport while preserving image aspect ratio", () => {
    const placement = computeCoverPlacement({
      viewportWidth: 1920,
      viewportHeight: 1080,
      imageWidth: 1280,
      imageHeight: 720,
      scaleMultiplier: 1,
    });

    expect(placement.drawWidth).toBeGreaterThanOrEqual(1920);
    expect(placement.drawHeight).toBeGreaterThanOrEqual(1080);
    expect(placement.drawX).toBeCloseTo(0);
    expect(placement.drawY).toBeCloseTo(0);
  });

  it("centers portrait images inside landscape viewports", () => {
    const placement = computeCoverPlacement({
      viewportWidth: 1920,
      viewportHeight: 1080,
      imageWidth: 800,
      imageHeight: 1200,
      scaleMultiplier: 1,
    });

    expect(placement.drawWidth).toBeGreaterThanOrEqual(1920);
    expect(placement.drawHeight).toBeGreaterThanOrEqual(1080);
    expect(placement.drawX).toBeCloseTo(0);
    expect(placement.drawY).toBeLessThan(0);
  });
});

describe("computePulseTransform", () => {
  it("keeps background fully covering viewport while pulsating", () => {
    const transform = computePulseTransform({
      viewportWidth: 2560,
      viewportHeight: 1440,
      imageWidth: 1280,
      imageHeight: 720,
      animationEnabled: true,
      pulseSpeed: DEFAULT_BACKGROUND_PULSE_SPEED,
      nowMs: 30000,
    });

    expect(transform.drawWidth).toBeGreaterThan(2560);
    expect(transform.drawHeight).toBeGreaterThan(1440);
    // Pulse animation centers the image - no drift
    expect(transform.drawX).toBeCloseTo((2560 - transform.drawWidth) / 2, 0);
    expect(transform.drawY).toBeCloseTo((1440 - transform.drawHeight) / 2, 0);
  });

  it("returns centered cover placement when animation is disabled", () => {
    const transform = computePulseTransform({
      viewportWidth: 1600,
      viewportHeight: 900,
      imageWidth: 1000,
      imageHeight: 1000,
      animationEnabled: false,
      pulseSpeed: 2,
      nowMs: 30000,
    });

    const centered = computeCoverPlacement({
      viewportWidth: 1600,
      viewportHeight: 900,
      imageWidth: 1000,
      imageHeight: 1000,
      scaleMultiplier: 1,
    });

    expect(transform).toEqual(centered);
  });

  it("pulsates zoom without position drift", () => {
    const viewportWidth = 1920;
    const viewportHeight = 1080;
    const imageWidth = 1280;
    const imageHeight = 720;

    // Sample transforms at different times
    const samples = [0, 5000, 10000, 15000, 20000].map((nowMs) =>
      computePulseTransform({
        viewportWidth,
        viewportHeight,
        imageWidth,
        imageHeight,
        animationEnabled: true,
        pulseSpeed: 1,
        nowMs,
      }),
    );

    // All samples should be centered (drawX should equal the calculated center for each)
    for (const transform of samples) {
      const expectedCenterX = (viewportWidth - transform.drawWidth) / 2;
      const expectedCenterY = (viewportHeight - transform.drawHeight) / 2;
      expect(transform.drawX).toBeCloseTo(expectedCenterX, 0);
      expect(transform.drawY).toBeCloseTo(expectedCenterY, 0);
    }

    // But zoom should vary (scale changes over time)
    const zoomValues = samples.map((t) => t.drawWidth / imageWidth);
    const minZoom = Math.min(...zoomValues);
    const maxZoom = Math.max(...zoomValues);
    expect(maxZoom).toBeGreaterThan(minZoom);
  });
});
