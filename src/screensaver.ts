/**
 * Pure screensaver logic — window detection and mouse dead-zone tracking.
 *
 * This module contains no Tauri or DOM dependencies so it can be fully
 * unit-tested under Vitest without mocking platform APIs.
 */

const SCREENSAVER_LABEL_PREFIX = "screensaver-";

/**
 * Checks whether a Tauri window label belongs to a screensaver overlay.
 *
 * Screensaver windows are created by the Rust `windowing` module with labels
 * like `screensaver-0`, `screensaver-1`, etc. The main settings window is
 * labeled `main`.
 */
export function isScreensaverWindow(label: string): boolean {
  return label.startsWith(SCREENSAVER_LABEL_PREFIX);
}

/**
 * Tracks the mouse origin position and determines whether subsequent
 * movement exceeds a configurable dead-zone radius.
 *
 * The frontend `mousemove` handler creates one tracker per screensaver
 * activation, records the first mouse position as the origin, then checks
 * each subsequent event against the dead-zone. This mirrors the Rust-side
 * `input::exceeds_dead_zone` math but runs entirely in JS to avoid
 * cross-process IPC on every mouse event.
 */
export class MouseTracker {
  private originX: number | null = null;
  private originY: number | null = null;

  /** Whether an origin position has been recorded. */
  hasOrigin(): boolean {
    return this.originX !== null;
  }

  /** Record the initial cursor position (typically on the first `mousemove`). */
  recordOrigin(x: number, y: number): void {
    this.originX = x;
    this.originY = y;
  }

  /**
   * Check whether the current position exceeds the dead-zone around the origin.
   *
   * Uses Euclidean distance with squared comparison (no sqrt) for consistency
   * with the Rust implementation in `input.rs`.
   *
   * Returns `false` if no origin has been recorded yet.
   */
  exceedsDeadZone(currentX: number, currentY: number, deadZonePx: number): boolean {
    if (this.originX === null || this.originY === null) {
      return false;
    }

    const dx = currentX - this.originX;
    const dy = currentY - this.originY;
    return dx * dx + dy * dy > deadZonePx * deadZonePx;
  }

  /** Reset the tracker, clearing the origin position. */
  reset(): void {
    this.originX = null;
    this.originY = null;
  }
}
