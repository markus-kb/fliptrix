import { describe, expect, it } from "vitest";

import {
  computeCoverPlacement,
  computeSwirlTransform,
  DEFAULT_BACKGROUND_SWIRL_SPEED,
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

describe("computeSwirlTransform", () => {
  it("keeps background fully covering viewport while drifting", () => {
    const transform = computeSwirlTransform({
      viewportWidth: 2560,
      viewportHeight: 1440,
      imageWidth: 1280,
      imageHeight: 720,
      animationEnabled: true,
      swirlSpeed: DEFAULT_BACKGROUND_SWIRL_SPEED,
      nowMs: 30000,
    });

    expect(transform.drawWidth).toBeGreaterThan(2560);
    expect(transform.drawHeight).toBeGreaterThan(1440);
    expect(transform.drawX).toBeLessThan(0);
    expect(transform.drawY).toBeLessThan(0);
  });

  it("returns centered cover placement when animation is disabled", () => {
    const transform = computeSwirlTransform({
      viewportWidth: 1600,
      viewportHeight: 900,
      imageWidth: 1000,
      imageHeight: 1000,
      animationEnabled: false,
      swirlSpeed: 2,
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
});
