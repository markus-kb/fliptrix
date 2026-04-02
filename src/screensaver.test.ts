import { describe, expect, it } from "vitest";

import { isScreensaverWindow, MouseTracker } from "./screensaver";

describe("isScreensaverWindow", () => {
  it("returns true for screensaver window labels", () => {
    expect(isScreensaverWindow("screensaver-0")).toBe(true);
    expect(isScreensaverWindow("screensaver-1")).toBe(true);
    expect(isScreensaverWindow("screensaver-42")).toBe(true);
  });

  it("returns false for the main window", () => {
    expect(isScreensaverWindow("main")).toBe(false);
  });

  it("returns false for arbitrary labels", () => {
    expect(isScreensaverWindow("settings")).toBe(false);
    expect(isScreensaverWindow("")).toBe(false);
    expect(isScreensaverWindow("screensaver")).toBe(false);
  });
});

describe("MouseTracker", () => {
  it("records the origin on first movement", () => {
    const tracker = new MouseTracker();
    expect(tracker.hasOrigin()).toBe(false);

    tracker.recordOrigin(100, 200);
    expect(tracker.hasOrigin()).toBe(true);
  });

  it("reports no exceedance when no origin is set", () => {
    const tracker = new MouseTracker();
    expect(tracker.exceedsDeadZone(150, 250, 5)).toBe(false);
  });

  it("reports no exceedance for movement within dead-zone", () => {
    const tracker = new MouseTracker();
    tracker.recordOrigin(100, 200);

    // 3px right, 3px down → distance ≈ 4.24, below 5px
    expect(tracker.exceedsDeadZone(103, 203, 5)).toBe(false);
  });

  it("reports exceedance for movement beyond dead-zone", () => {
    const tracker = new MouseTracker();
    tracker.recordOrigin(100, 200);

    // 6px right → distance = 6, exceeds 5px
    expect(tracker.exceedsDeadZone(106, 200, 5)).toBe(true);
  });

  it("reports no exceedance at exactly the boundary", () => {
    const tracker = new MouseTracker();
    tracker.recordOrigin(0, 0);

    // Exactly 5px → not strictly greater
    expect(tracker.exceedsDeadZone(5, 0, 5)).toBe(false);
  });

  it("handles diagonal movement correctly", () => {
    const tracker = new MouseTracker();
    tracker.recordOrigin(0, 0);

    // 4 right, 4 down → √32 ≈ 5.66, exceeds 5
    expect(tracker.exceedsDeadZone(4, 4, 5)).toBe(true);
  });

  it("handles negative direction movement", () => {
    const tracker = new MouseTracker();
    tracker.recordOrigin(100, 200);

    // 6px left → distance = 6
    expect(tracker.exceedsDeadZone(94, 200, 5)).toBe(true);
  });

  it("resets origin and tracking state", () => {
    const tracker = new MouseTracker();
    tracker.recordOrigin(100, 200);
    expect(tracker.hasOrigin()).toBe(true);

    tracker.reset();
    expect(tracker.hasOrigin()).toBe(false);
  });
});
