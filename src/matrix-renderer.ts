/**
 * Matrix rain canvas renderer — draws and animates digital rain with embedded
 * X post "data packets".
 *
 * Renders the board state from matrix-state.ts onto a <canvas> element,
 * drawing half-width Katakana and other Matrix characters falling top-to-bottom
 * in columns. Readable X post text is injected periodically as bright data
 * packets within the rain streams.
 *
 * Performance is kept under 5% CPU via dirty-column tracking: only columns
 * that changed since the last frame are cleared and redrawn. The animation
 * loop runs via requestAnimationFrame; board state is advanced at a fixed tick
 * interval (decoupled from frame rate so slow devices don't look broken).
 */

import type { PostEntry } from "./flipflap-state";
import {
  advanceMatrix,
  clearDataPacket,
  createMatrixBoard,
  getCellAt,
  injectDataPacket,
  type MatrixBoard,
  spawnDrops,
} from "./matrix-state";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for the Matrix renderer. */
export interface MatrixConfig {
  /** Font size in pixels. Determines column/row count from canvas dimensions. */
  fontSize: number;
  /** Probability (0–1) of spawning a new drop per idle column per tick. */
  spawnDensity: number;
  /** shadowBlur pixels for the green glow effect. 0 disables glow. */
  glowIntensity: number;
  /** Milliseconds between board state ticks. Lower = faster rain. */
  tickIntervalMs: number;
  /** Seconds between injecting the next post as a data packet. */
  postRotationSec: number;
}

/** Sensible defaults — authentic Matrix look without excessive CPU usage. */
export const DEFAULT_MATRIX_CONFIG: MatrixConfig = {
  fontSize: 16,
  spawnDensity: 0.04, // ~4% of idle columns spawn per tick — moderate density
  glowIntensity: 6,
  tickIntervalMs: 50, // ~20 ticks/sec; fast enough for fluid rain
  postRotationSec: 15,
};

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

/** Canvas background — pure black. */
const BG_COLOR = "#000000";
/** Drop head color — bright white-green for maximum contrast. */
const HEAD_COLOR = "#ccffcc";
/** Data packet color — warm white, distinct from rain characters. */
const PACKET_COLOR = "#e8ffe8";
/** Full-brightness trail color (just below head). */
const TRAIL_BRIGHT = "#00ff41";
/** Mid-brightness trail color. */
const TRAIL_MID = "#007a1f";
/** Low-brightness trail color. */
const TRAIL_DIM = "#003d0f";

// ---------------------------------------------------------------------------
// Layout helper
// ---------------------------------------------------------------------------

/** Column and row count derived from canvas size and font size. */
export interface MatrixGrid {
  cols: number;
  rows: number;
}

/**
 * Compute grid dimensions from canvas size and font size.
 *
 * Half-width Katakana characters are roughly square at most monospace font
 * sizes, so we use fontSize as both the column width and row height.
 */
export function computeMatrixGrid(
  canvasWidth: number,
  canvasHeight: number,
  fontSize: number,
): MatrixGrid {
  return {
    cols: Math.floor(canvasWidth / fontSize),
    rows: Math.floor(canvasHeight / fontSize),
  };
}

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

/**
 * Manages the full Matrix rain rendering lifecycle.
 *
 * Usage:
 *   const renderer = new MatrixRenderer(canvas, config);
 *   renderer.setPostContent(posts);
 *   renderer.start();
 *   // ... later
 *   renderer.stop();
 */
export class MatrixRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: MatrixConfig;
  private board: MatrixBoard;
  private grid: MatrixGrid;

  private animationFrameId: number | null = null;
  private lastTickTime = 0;
  private lastPostRotationTime = 0;
  private running = false;

  /** Posts available for injection as data packets. */
  private posts: (string | PostEntry)[] = [];
  /** Index tracking which post to inject next. */
  private postIndex = 0;
  /** Columns that currently hold data packets (for clearing after rotation). */
  private activePacketCols: number[] = [];

  constructor(canvas: HTMLCanvasElement, config?: Partial<MatrixConfig>) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d canvas context");
    this.ctx = ctx;

    this.config = { ...DEFAULT_MATRIX_CONFIG, ...config };
    this.grid = computeMatrixGrid(canvas.width, canvas.height, this.config.fontSize);
    this.board = createMatrixBoard(this.grid.rows, this.grid.cols);
  }

  /** Set the posts to rotate through as data packets. */
  setPostContent(posts: (string | PostEntry)[]): void {
    this.posts = posts;
    this.postIndex = 0;
  }

  /** Start the animation loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.resizeCanvas();
    this.drawBackground();
    this.lastTickTime = performance.now();
    this.lastPostRotationTime = performance.now();
    this.loop(performance.now());
  }

  /** Stop the animation loop and release resources. */
  stop(): void {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /** Resize the canvas and reinitialize the board for the new dimensions. */
  resizeCanvas(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const newWidth = parent.clientWidth;
    const newHeight = parent.clientHeight;

    if (newWidth === this.canvas.width && newHeight === this.canvas.height) return;

    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    this.grid = computeMatrixGrid(newWidth, newHeight, this.config.fontSize);
    this.board = createMatrixBoard(this.grid.rows, this.grid.cols);
    this.activePacketCols = [];
    this.drawBackground();
  }

  // --- Private: animation loop ---

  private loop(now: number): void {
    if (!this.running) return;

    const tickElapsed = now - this.lastTickTime;
    if (tickElapsed >= this.config.tickIntervalMs) {
      this.lastTickTime = now;
      this.tick(now);
    }

    this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  private tick(now: number): void {
    // Spawn new drops probabilistically in idle columns
    spawnDrops(this.board, this.config.spawnDensity);

    // Advance all drops and get the list of dirty columns to redraw
    const dirty = advanceMatrix(this.board);

    // Rotate to next post data packet when interval elapses
    const rotationElapsed = now - this.lastPostRotationTime;
    if (rotationElapsed >= this.config.postRotationSec * 1000 && this.posts.length > 0) {
      this.lastPostRotationTime = now;
      this.rotatePostPacket(dirty);
    }

    // Only redraw the columns that changed (dirty-column optimization)
    for (const col of dirty) {
      this.drawColumn(col);
    }
  }

  /**
   * Clear old data packet columns and inject the next post into new ones.
   *
   * A post is split into chunks matching the board height, then each chunk
   * is injected into a separate column. This gives the effect of post text
   * appearing as multiple parallel vertical streams within the rain.
   *
   * The dirty array is extended with the affected columns so they get redrawn
   * this tick.
   */
  private rotatePostPacket(dirty: number[]): void {
    // Clear previous packet columns
    for (const col of this.activePacketCols) {
      clearDataPacket(this.board, col);
    }
    this.activePacketCols = [];

    if (this.posts.length === 0) return;

    const post = this.posts[this.postIndex];
    const text = typeof post === "string" ? post : post.text;
    const author = typeof post === "object" && post.author ? `@${post.author}: ` : "";
    const fullText = (author + text).toUpperCase();

    this.postIndex = (this.postIndex + 1) % this.posts.length;

    // Inject text across consecutive columns, one character per row
    const charsPerCol = this.board.rows;
    const numCols = Math.ceil(fullText.length / charsPerCol);

    // Pick a random starting column that fits the packet width
    const maxStart = Math.max(0, this.board.cols - numCols);
    const startCol = Math.floor(Math.random() * (maxStart + 1));

    for (let i = 0; i < numCols; i++) {
      const colIndex = startCol + i;
      if (colIndex >= this.board.cols) break;

      const chunk = fullText.slice(i * charsPerCol, (i + 1) * charsPerCol);
      injectDataPacket(this.board, chunk, colIndex, 0);
      this.activePacketCols.push(colIndex);
      if (!dirty.includes(colIndex)) dirty.push(colIndex);
    }
  }

  // --- Private: drawing ---

  /** Fill the entire canvas with the background color. */
  private drawBackground(): void {
    this.ctx.fillStyle = BG_COLOR;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Redraw a single column.
   *
   * Clears the vertical strip occupied by this column and redraws every
   * visible cell. Only called for dirty columns to minimize canvas operations.
   */
  private drawColumn(colIndex: number): void {
    const { ctx, config, board, grid } = this;
    const fs = config.fontSize;
    const x = colIndex * fs;

    // Clear the column strip
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(x, 0, fs, this.canvas.height);

    ctx.font = `${fs}px "MS Gothic", "Osaka", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const centerX = x + fs / 2;

    for (let r = 0; r < grid.rows; r++) {
      const cell = getCellAt(board, r, colIndex);
      if (cell.brightness <= 0.01 && !cell.isPacket) continue;

      const y = r * fs;

      if (cell.isPacket) {
        // Data packets render in bright near-white with stronger glow
        if (config.glowIntensity > 0) {
          ctx.shadowBlur = config.glowIntensity * 2;
          ctx.shadowColor = PACKET_COLOR;
        }
        ctx.fillStyle = PACKET_COLOR;
        ctx.fillText(cell.char, centerX, y);
        ctx.shadowBlur = 0;
        continue;
      }

      // Drop head — bright white-green
      if (cell.brightness > 0.95) {
        if (config.glowIntensity > 0) {
          ctx.shadowBlur = config.glowIntensity;
          ctx.shadowColor = HEAD_COLOR;
        }
        ctx.fillStyle = HEAD_COLOR;
      } else if (cell.brightness > 0.5) {
        // Upper trail — bright green
        if (config.glowIntensity > 0) {
          ctx.shadowBlur = config.glowIntensity * 0.5;
          ctx.shadowColor = TRAIL_BRIGHT;
        }
        ctx.fillStyle = TRAIL_BRIGHT;
      } else if (cell.brightness > 0.2) {
        // Mid trail — medium green
        ctx.shadowBlur = 0;
        ctx.fillStyle = TRAIL_MID;
      } else {
        // Fading tail — dark green
        ctx.shadowBlur = 0;
        ctx.fillStyle = TRAIL_DIM;
      }

      ctx.fillText(cell.char, centerX, y);
      ctx.shadowBlur = 0;
    }
  }
}
