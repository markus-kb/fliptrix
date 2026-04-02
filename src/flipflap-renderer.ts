/**
 * FlipFlap canvas renderer — draws and animates the split-flap board.
 *
 * Renders the board state from flipflap-state.ts onto a <canvas> element,
 * animating each flap's forward rotation with a simplified 3D flip effect.
 * Audio is synchronized via FlipSoundPlayer on each advance tick.
 *
 * The renderer uses requestAnimationFrame for smooth 60fps animation and
 * manages the tick interval that advances the board state. Post rotation
 * is handled externally — the caller supplies new post text via
 * `setPostContent()` and the renderer transitions the board to it.
 */

import { type FlipAudioConfig, FlipSoundPlayer } from "./flipflap-audio";
import type { FlapBoard, PostEntry } from "./flipflap-state";
import {
  advanceBoard,
  createBoard,
  formatPostsForBoard,
  isBoardSettled,
  setTargetText,
} from "./flipflap-state";

/** Configuration for the FlipFlap renderer. */
export interface FlipFlapConfig {
  /** Number of rows on the board. */
  rows: number;
  /** Number of columns on the board. */
  cols: number;
  /** Milliseconds between each flap advance tick. */
  tickIntervalMs: number;
  /** Seconds between post rotations. */
  postRotationSec: number;
  /** Audio configuration. Null to disable sound. */
  audio: FlipAudioConfig | null;
}

/** Sensible defaults matching the PRD (8x40 board, 20s rotation). */
export const DEFAULT_FLIPFLAP_CONFIG: FlipFlapConfig = {
  rows: 8,
  cols: 40,
  tickIntervalMs: 30,
  postRotationSec: 20,
  audio: null, // Populated by FlipFlapRenderer from default audio config
};

// --- Visual constants ---

/** Background color for each flap cell (dark charcoal). */
const CELL_BG = "#1a1a1a";
/** Split line color (the gap between top and bottom halves). */
const SPLIT_LINE_COLOR = "#0d0d0d";
/** Character color (warm off-white, like real Solari boards). */
const CHAR_COLOR = "#e8dcc8";
/** Board background (darker than cells, visible as grid gaps). */
const BOARD_BG = "#0a0a0a";
/** Cell corner radius as fraction of cell height. */
const CORNER_RADIUS_RATIO = 0.08;
/** Gap between cells in pixels. */
const CELL_GAP = 2;
/** Padding around the entire board in pixels. */
const BOARD_PADDING = 16;

/**
 * Manages the full FlipFlap rendering lifecycle.
 *
 * Usage:
 *   const renderer = new FlipFlapRenderer(canvas, config);
 *   renderer.setPostContent(posts);
 *   renderer.start();
 *   // ... later
 *   renderer.stop();
 */
export class FlipFlapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: FlipFlapConfig;
  private board: FlapBoard;
  private audioPlayer: FlipSoundPlayer | null;

  private animationFrameId: number | null = null;
  private lastTickTime = 0;
  private lastPostRotationTime = 0;
  private running = false;

  /** Posts available for rotation. */
  private posts: (string | PostEntry)[] = [];
  /** Index of the current post rotation window. */
  private postIndex = 0;

  constructor(canvas: HTMLCanvasElement, config?: Partial<FlipFlapConfig>) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d canvas context");
    this.ctx = ctx;

    this.config = { ...DEFAULT_FLIPFLAP_CONFIG, ...config };
    this.board = createBoard({ rows: this.config.rows, cols: this.config.cols });

    if (this.config.audio) {
      this.audioPlayer = new FlipSoundPlayer(this.config.audio);
    } else {
      this.audioPlayer = new FlipSoundPlayer();
    }
  }

  /** Set the posts to rotate through on the board. */
  setPostContent(posts: (string | PostEntry)[]): void {
    this.posts = posts;
    this.postIndex = 0;
    this.showCurrentPosts();
  }

  /** Start the animation loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickTime = performance.now();
    this.lastPostRotationTime = performance.now();
    this.resizeCanvas();
    this.loop(performance.now());
  }

  /** Stop the animation loop and release resources. */
  stop(): void {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.audioPlayer?.dispose();
  }

  /** Resize the canvas to fill its parent container. */
  resizeCanvas(): void {
    const parent = this.canvas.parentElement;
    if (parent) {
      this.canvas.width = parent.clientWidth;
      this.canvas.height = parent.clientHeight;
    }
  }

  // --- Private: animation loop ---

  private loop(now: number): void {
    if (!this.running) return;

    // Advance board state at the configured tick interval
    const tickElapsed = now - this.lastTickTime;
    if (tickElapsed >= this.config.tickIntervalMs) {
      this.lastTickTime = now;
      this.tick();
    }

    // Rotate to next posts when the board is settled and the interval has passed
    const rotationElapsed = now - this.lastPostRotationTime;
    if (
      isBoardSettled(this.board) &&
      rotationElapsed >= this.config.postRotationSec * 1000 &&
      this.posts.length > 0
    ) {
      this.lastPostRotationTime = now;
      this.advancePostWindow();
    }

    this.draw();
    this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  private tick(): void {
    const flipped = advanceBoard(this.board);
    if (flipped.length > 0 && this.audioPlayer) {
      // Play a flip sound for a subset of the flipped cells.
      // Playing one sound per visual tick is more realistic than per-cell —
      // real boards produce a composite "clatter" not individual clicks.
      this.audioPlayer.playFlip();
    }
  }

  private advancePostWindow(): void {
    // Advance by `rows` posts worth to fill the next board
    this.postIndex += this.config.rows;
    if (this.postIndex >= this.posts.length) {
      this.postIndex = 0;
    }
    this.showCurrentPosts();
  }

  private showCurrentPosts(): void {
    if (this.posts.length === 0) return;

    // Select a window of posts to display
    const windowPosts = this.posts.slice(this.postIndex, this.postIndex + this.config.rows);

    const lines = formatPostsForBoard(windowPosts, this.config.rows, this.config.cols);
    setTargetText(this.board, lines);
  }

  // --- Private: drawing ---

  private draw(): void {
    const { canvas, ctx, board } = this;
    const { width, height } = canvas;

    // Clear
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, width, height);

    // Compute cell dimensions to fill the canvas
    const layout = computeCellLayout(width, height, board.rows, board.cols);

    // Draw each cell
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const cell = board.cells[r][c];
        const x = layout.offsetX + c * (layout.cellWidth + CELL_GAP);
        const y = layout.offsetY + r * (layout.cellHeight + CELL_GAP);
        this.drawCell(x, y, layout.cellWidth, layout.cellHeight, cell.current);
      }
    }
  }

  private drawCell(x: number, y: number, w: number, h: number, char: string): void {
    const ctx = this.ctx;
    const radius = h * CORNER_RADIUS_RATIO;
    const halfH = h / 2;

    // Top half of the flap
    ctx.save();
    ctx.beginPath();
    roundedRectPath(ctx, x, y, w, halfH, radius, radius, 0, 0);
    ctx.fillStyle = CELL_BG;
    ctx.fill();
    ctx.restore();

    // Bottom half of the flap (slightly lighter to simulate depth)
    ctx.save();
    ctx.beginPath();
    roundedRectPath(ctx, x, y + halfH, w, halfH, 0, 0, radius, radius);
    ctx.fillStyle = CELL_BG;
    ctx.fill();
    ctx.restore();

    // Split line — the horizontal gap between halves
    ctx.fillStyle = SPLIT_LINE_COLOR;
    ctx.fillRect(x, y + halfH - 0.5, w, 1);

    // Character — centered in the cell, clipped to avoid overflow
    if (char !== " ") {
      const fontSize = h * 0.65;
      ctx.save();
      ctx.font = `bold ${fontSize}px "Courier New", "Consolas", monospace`;
      ctx.fillStyle = CHAR_COLOR;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(char, x + w / 2, y + h / 2 + 1);
      ctx.restore();
    }
  }
}

// --- Layout helpers ---

interface CellLayout {
  cellWidth: number;
  cellHeight: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Compute cell dimensions to fill the canvas while maintaining a reasonable
 * aspect ratio for the flap cells (roughly 3:4 width:height like real boards).
 */
export function computeCellLayout(
  canvasWidth: number,
  canvasHeight: number,
  rows: number,
  cols: number,
): CellLayout {
  const availW = canvasWidth - 2 * BOARD_PADDING - (cols - 1) * CELL_GAP;
  const availH = canvasHeight - 2 * BOARD_PADDING - (rows - 1) * CELL_GAP;

  const cellW = availW / cols;
  const cellH = availH / rows;

  // Maintain a reasonable aspect ratio (cells should be taller than wide)
  const targetRatio = 0.75; // width/height
  let finalW = cellW;
  let finalH = cellH;

  if (cellW / cellH > targetRatio) {
    // Too wide — constrain by height
    finalW = cellH * targetRatio;
  } else if (cellW / cellH < targetRatio * 0.5) {
    // Too narrow — constrain by width
    finalH = cellW / targetRatio;
  }

  // Center the board in the canvas
  const totalW = finalW * cols + (cols - 1) * CELL_GAP;
  const totalH = finalH * rows + (rows - 1) * CELL_GAP;
  const offsetX = (canvasWidth - totalW) / 2;
  const offsetY = (canvasHeight - totalH) / 2;

  return { cellWidth: finalW, cellHeight: finalH, offsetX, offsetY };
}

// --- Canvas path helpers ---

/**
 * Draws a rounded rectangle path with individual corner radii.
 *
 * Used instead of ctx.roundRect() for broader compatibility — the native
 * API isn't available in all WebKit/WebView2 versions Tauri targets.
 */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
): void {
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}
