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

import { BackgroundImageManager, DEFAULT_BACKGROUND_SWIRL_SPEED } from "./background-image";
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
  /** Fullscreen background image URL shown behind the board. */
  backgroundImageUrl: string | null;
  /** Enables subtle background drift animation to reduce static burn-in. */
  backgroundAnimationEnabled: boolean;
  /** Speed multiplier for the drift animation. */
  backgroundSwirlSpeed: number;
  /** Emits the currently targeted board lines whenever post window changes. */
  onVisibleLinesChange?: (lines: string[]) => void;
}

/** Sensible defaults matching the PRD (8x40 board, 20s rotation). */
export const DEFAULT_FLIPFLAP_CONFIG: FlipFlapConfig = {
  rows: 8,
  cols: 40,
  tickIntervalMs: 80,
  postRotationSec: 20,
  audio: null, // Populated by FlipFlapRenderer from default audio config
  backgroundImageUrl: null,
  backgroundAnimationEnabled: true,
  backgroundSwirlSpeed: DEFAULT_BACKGROUND_SWIRL_SPEED,
  onVisibleLinesChange: undefined,
};

// --- Visual constants ---

/** Board background (darker than cells, visible as grid gaps). */
const BOARD_BG = "#060708";
/** Cell corner radius as fraction of cell height. */
const CORNER_RADIUS_RATIO = 0.08;
/** Gap between cells in pixels. */
const CELL_GAP = 3;
/** Padding around the entire board in pixels. */
const BOARD_PADDING = 22;

export interface FlapSurfaceTheme {
  frameOuter: string;
  frameInner: string;
  frameHighlight: string;
  topBase: string;
  bottomBase: string;
  topHighlight: string;
  bottomShadow: string;
  hingeShadow: string;
  hingeMetal: string;
  ribShadow: string;
  rivet: string;
  rivetShadow: string;
  charPrimary: string;
  charSecondary: string;
}

export function createFlapSurfaceTheme(): FlapSurfaceTheme {
  return {
    frameOuter: "#050607",
    frameInner: "#13171b",
    frameHighlight: "#2d343b",
    topBase: "#21272d",
    bottomBase: "#171c21",
    topHighlight: "#3a4148",
    bottomShadow: "#0b0e12",
    hingeShadow: "#08090a",
    hingeMetal: "#646a70",
    ribShadow: "#11151a",
    rivet: "#7b8187",
    rivetShadow: "#090b0d",
    charPrimary: "#efe2ca",
    charSecondary: "#b9ab95",
  };
}

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
  private theme: FlapSurfaceTheme;
  private backgroundImageManager: BackgroundImageManager | null;

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
    this.theme = createFlapSurfaceTheme();

    if (this.config.audio) {
      this.audioPlayer = new FlipSoundPlayer(this.config.audio);
    } else {
      this.audioPlayer = new FlipSoundPlayer();
    }

    this.backgroundImageManager = this.config.backgroundImageUrl
      ? new BackgroundImageManager(this.config.backgroundImageUrl)
      : null;
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
    if (this.posts.length === 0) {
      this.config.onVisibleLinesChange?.([]);
      return;
    }

    // Select a window of posts to display
    const windowPosts = this.posts.slice(this.postIndex, this.postIndex + this.config.rows);

    const lines = formatPostsForBoard(windowPosts, this.config.rows, this.config.cols);
    setTargetText(this.board, lines);
    this.config.onVisibleLinesChange?.(lines);
  }

  // --- Private: drawing ---

  private draw(): void {
    const { canvas, ctx, board } = this;
    const { width, height } = canvas;

    const drewImage = this.backgroundImageManager?.draw(
      ctx,
      width,
      height,
      this.config.backgroundAnimationEnabled,
      this.config.backgroundSwirlSpeed,
      performance.now(),
    );

    if (drewImage) {
      ctx.fillStyle = "rgba(6, 7, 8, 0.5)";
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = BOARD_BG;
      ctx.fillRect(0, 0, width, height);
    }

    // Compute cell dimensions to fill the canvas
    const layout = computeCellLayout(width, height, board.rows, board.cols);
    this.drawBoardFrame(layout, board.rows, board.cols);

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

  private drawBoardFrame(layout: CellLayout, rows: number, cols: number): void {
    const ctx = this.ctx;
    const width = layout.cellWidth * cols + (cols - 1) * CELL_GAP;
    const height = layout.cellHeight * rows + (rows - 1) * CELL_GAP;
    const x = layout.offsetX - BOARD_PADDING * 0.55;
    const y = layout.offsetY - BOARD_PADDING * 0.55;
    const w = width + BOARD_PADDING * 1.1;
    const h = height + BOARD_PADDING * 1.1;
    const radius = Math.max(8, layout.cellHeight * 0.18);

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    ctx.beginPath();
    roundedRectPath(ctx, x, y, w, h, radius, radius, radius, radius);
    const frameGradient = ctx.createLinearGradient(x, y, x, y + h);
    frameGradient.addColorStop(0, this.theme.frameHighlight);
    frameGradient.addColorStop(0.12, this.theme.frameInner);
    frameGradient.addColorStop(1, this.theme.frameOuter);
    ctx.fillStyle = frameGradient;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    roundedRectPath(
      ctx,
      x + 6,
      y + 6,
      w - 12,
      h - 12,
      radius * 0.78,
      radius * 0.78,
      radius * 0.78,
      radius * 0.78,
    );
    const innerGradient = ctx.createLinearGradient(x, y, x, y + h);
    innerGradient.addColorStop(0, "rgba(255,255,255,0.04)");
    innerGradient.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.strokeStyle = innerGradient;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  private drawCell(x: number, y: number, w: number, h: number, char: string): void {
    const ctx = this.ctx;
    const theme = this.theme;
    const radius = h * CORNER_RADIUS_RATIO;
    const halfH = h / 2;
    const seamHeight = Math.max(1, h * 0.028);
    const inset = Math.max(1, Math.round(w * 0.028));

    const topGradient = ctx.createLinearGradient(x, y, x, y + halfH);
    topGradient.addColorStop(0, theme.topHighlight);
    topGradient.addColorStop(0.18, theme.topBase);
    topGradient.addColorStop(1, theme.ribShadow);

    const bottomGradient = ctx.createLinearGradient(x, y + halfH, x, y + h);
    bottomGradient.addColorStop(0, theme.topBase);
    bottomGradient.addColorStop(0.3, theme.bottomBase);
    bottomGradient.addColorStop(1, theme.bottomShadow);

    // Top half of the flap
    ctx.save();
    ctx.beginPath();
    roundedRectPath(ctx, x, y, w, halfH, radius, radius, 0, 0);
    ctx.fillStyle = topGradient;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    roundedRectPath(
      ctx,
      x + inset,
      y + inset,
      w - inset * 2,
      halfH - inset * 1.8,
      radius * 0.65,
      radius * 0.65,
      0,
      0,
    );
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    ctx.fill();
    ctx.restore();

    // Bottom half of the flap (slightly lighter to simulate depth)
    ctx.save();
    ctx.beginPath();
    roundedRectPath(ctx, x, y + halfH, w, halfH, 0, 0, radius, radius);
    ctx.fillStyle = bottomGradient;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Split line — the horizontal gap between halves
    const seamGradient = ctx.createLinearGradient(
      x,
      y + halfH - seamHeight,
      x,
      y + halfH + seamHeight,
    );
    seamGradient.addColorStop(0, "rgba(255,255,255,0.06)");
    seamGradient.addColorStop(0.45, theme.hingeMetal);
    seamGradient.addColorStop(0.5, theme.hingeShadow);
    seamGradient.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = seamGradient;
    ctx.fillRect(x, y + halfH - seamHeight, w, seamHeight * 2);

    const rivetRadius = Math.max(1.1, Math.min(w, h) * 0.035);
    this.drawRivet(x + w * 0.12, y + halfH, rivetRadius);
    this.drawRivet(x + w * 0.88, y + halfH, rivetRadius);

    // Character — centered in the cell, clipped to avoid overflow
    if (char !== " ") {
      const fontSize = h * 0.7;
      this.drawFlapCharacter(char, x, y, w, halfH, fontSize);
    }
  }

  private drawRivet(x: number, y: number, radius: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y + radius * 0.24, radius * 1.12, 0, Math.PI * 2);
    ctx.fillStyle = this.theme.rivetShadow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    const rivetGradient = ctx.createRadialGradient(
      x - radius * 0.35,
      y - radius * 0.45,
      radius * 0.2,
      x,
      y,
      radius,
    );
    rivetGradient.addColorStop(0, "rgba(255,255,255,0.38)");
    rivetGradient.addColorStop(0.45, this.theme.rivet);
    rivetGradient.addColorStop(1, this.theme.hingeShadow);
    ctx.fillStyle = rivetGradient;
    ctx.fill();
    ctx.restore();
  }

  private drawFlapCharacter(
    char: string,
    x: number,
    y: number,
    w: number,
    halfH: number,
    fontSize: number,
  ): void {
    const ctx = this.ctx;
    const fullH = halfH * 2;
    const centerX = x + w / 2;
    const centerY = y + fullH * 0.53;

    ctx.save();
    ctx.font = `600 ${fontSize}px "Arial Narrow", "Helvetica Neue", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.scale(0.92, 1);

    // Top half clips the upper portion of a single glyph.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x / 0.92, y, w / 0.92, halfH - 0.5);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.fillText(char, centerX / 0.92, centerY + 2);
    ctx.fillStyle = this.theme.charPrimary;
    ctx.fillText(char, centerX / 0.92, centerY);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillText(char, centerX / 0.92, centerY - 2);
    ctx.restore();

    // Bottom half clips the lower portion of that same glyph and recesses it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x / 0.92, y + halfH, w / 0.92, halfH);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.fillText(char, centerX / 0.92, centerY + 3);
    ctx.fillStyle = this.theme.charSecondary;
    ctx.fillText(char, centerX / 0.92, centerY + 1);
    ctx.restore();

    ctx.restore();
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
