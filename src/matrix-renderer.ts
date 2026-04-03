/**
 * Matrix rain canvas renderer — draws and animates digital rain with embedded
 * X post "data packets".
 *
 * The visual treatment aims for a subtle film-faithful depth effect rather than
 * a dramatic 3D camera move: faint blurred background streams sit behind the
 * main rain plane, while the foreground heads and bright trail cells get a
 * stronger phosphor bloom.
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
  spawnDensity: 0.04,
  glowIntensity: 6,
  tickIntervalMs: 50,
  postRotationSec: 15,
};

// ---------------------------------------------------------------------------
// Layer configuration
// ---------------------------------------------------------------------------

export type MatrixLayerId = "far" | "mid" | "foreground";

export interface MatrixLayerConfig {
  id: MatrixLayerId;
  fontSize: number;
  alpha: number;
  compositeBlur: number;
  glowBlur: number;
  spawnDensity: number;
  tickIntervalMs: number;
}

export function deriveMatrixLayerConfigs(base: MatrixConfig): MatrixLayerConfig[] {
  const glow = Math.max(0, base.glowIntensity);
  const minFontSize = 8;

  return [
    {
      id: "far",
      fontSize: Math.max(minFontSize, Math.round(base.fontSize * 0.78)),
      alpha: 0.18,
      compositeBlur: 2.4,
      glowBlur: Math.max(0.5, glow * 0.3),
      spawnDensity: clampProbability(base.spawnDensity * 0.35),
      tickIntervalMs: Math.max(1, Math.round(base.tickIntervalMs * 1.7)),
    },
    {
      id: "mid",
      fontSize: Math.max(minFontSize, Math.round(base.fontSize * 0.9)),
      alpha: 0.38,
      compositeBlur: 1.1,
      glowBlur: Math.max(0.75, glow * 0.55),
      spawnDensity: clampProbability(base.spawnDensity * 0.6),
      tickIntervalMs: Math.max(1, Math.round(base.tickIntervalMs * 1.25)),
    },
    {
      id: "foreground",
      fontSize: Math.max(minFontSize, Math.round(base.fontSize)),
      alpha: 1,
      compositeBlur: 0,
      glowBlur: glow * 1.45,
      spawnDensity: clampProbability(base.spawnDensity),
      tickIntervalMs: Math.max(1, Math.round(base.tickIntervalMs)),
    },
  ];
}

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

const BG_COLOR = "#000000";
const HEAD_RGB: readonly [number, number, number] = [204, 255, 204];
const PACKET_RGB: readonly [number, number, number] = [232, 255, 232];
const TRAIL_BRIGHT_RGB: readonly [number, number, number] = [0, 255, 65];
const TRAIL_MID_RGB: readonly [number, number, number] = [0, 122, 31];
const TRAIL_DIM_RGB: readonly [number, number, number] = [0, 61, 15];

// ---------------------------------------------------------------------------
// Layout helper
// ---------------------------------------------------------------------------

export interface MatrixGrid {
  cols: number;
  rows: number;
}

export function computeMatrixGrid(
  canvasWidth: number,
  canvasHeight: number,
  fontSize: number,
): MatrixGrid {
  return {
    cols: Math.max(1, Math.floor(canvasWidth / fontSize)),
    rows: Math.max(1, Math.floor(canvasHeight / fontSize)),
  };
}

// ---------------------------------------------------------------------------
// Runtime layer state
// ---------------------------------------------------------------------------

interface MatrixLayerRuntime {
  config: MatrixLayerConfig;
  board: MatrixBoard;
  grid: MatrixGrid;
  surface: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lastTickTime: number;
  lastPostRotationTime: number;
  activePacketCols: number[];
}

interface GlyphStyle {
  coreRgb: readonly [number, number, number];
  coreAlpha: number;
  glowRgb: readonly [number, number, number];
  glowAlpha: number;
  glowBlur: number;
}

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

export class MatrixRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: MatrixConfig;
  private layers: MatrixLayerRuntime[] = [];

  private animationFrameId: number | null = null;
  private running = false;

  /** Posts available for injection as data packets. */
  private posts: (string | PostEntry)[] = [];
  /** Index tracking which post to inject next. */
  private postIndex = 0;

  constructor(canvas: HTMLCanvasElement, config?: Partial<MatrixConfig>) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d canvas context");
    this.ctx = ctx;

    this.config = { ...DEFAULT_MATRIX_CONFIG, ...config };
    this.layers = this.createLayers();
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

    const now = performance.now();
    for (const layer of this.layers) {
      layer.lastTickTime = now;
      layer.lastPostRotationTime = now;
    }

    this.drawComposite();
    this.loop(now);
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

    if (newWidth <= 0 || newHeight <= 0) return;

    if (newWidth === this.canvas.width && newHeight === this.canvas.height) return;

    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    this.layers = this.createLayers();
    this.drawComposite();
  }

  private loop(now: number): void {
    if (!this.running) return;

    let compositeDirty = false;
    for (const layer of this.layers) {
      const elapsed = now - layer.lastTickTime;
      if (elapsed < layer.config.tickIntervalMs) {
        continue;
      }

      layer.lastTickTime = now;
      compositeDirty = this.tickLayer(layer, now) || compositeDirty;
    }

    if (compositeDirty) {
      this.drawComposite();
    }

    this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  private tickLayer(layer: MatrixLayerRuntime, now: number): boolean {
    spawnDrops(layer.board, layer.config.spawnDensity);

    const dirty = advanceMatrix(layer.board);
    if (
      layer.config.id === "foreground" &&
      now - layer.lastPostRotationTime >= this.config.postRotationSec * 1000 &&
      this.posts.length > 0
    ) {
      layer.lastPostRotationTime = now;
      this.rotatePostPacket(layer, dirty);
    }

    if (dirty.length === 0) {
      return false;
    }

    for (const col of dirty) {
      this.drawLayerColumn(layer, col);
    }

    return true;
  }

  private rotatePostPacket(layer: MatrixLayerRuntime, dirty: number[]): void {
    for (const col of layer.activePacketCols) {
      clearDataPacket(layer.board, col);
      if (!dirty.includes(col)) {
        dirty.push(col);
      }
    }
    layer.activePacketCols = [];

    if (this.posts.length === 0) return;

    const post = this.posts[this.postIndex];
    const text = typeof post === "string" ? post : post.text;
    const author = typeof post === "object" && post.author ? `@${post.author}: ` : "";
    const fullText = (author + text).toUpperCase();

    this.postIndex = (this.postIndex + 1) % this.posts.length;

    const charsPerCol = layer.board.rows;
    const numCols = Math.ceil(fullText.length / charsPerCol);
    const maxStart = Math.max(0, layer.board.cols - numCols);
    const startCol = Math.floor(Math.random() * (maxStart + 1));

    for (let i = 0; i < numCols; i++) {
      const colIndex = startCol + i;
      if (colIndex >= layer.board.cols) break;

      const chunk = fullText.slice(i * charsPerCol, (i + 1) * charsPerCol);
      injectDataPacket(layer.board, chunk, colIndex, 0);
      layer.activePacketCols.push(colIndex);
      if (!dirty.includes(colIndex)) {
        dirty.push(colIndex);
      }
    }
  }

  private drawComposite(): void {
    this.ctx.fillStyle = BG_COLOR;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (const layer of this.layers) {
      this.ctx.save();
      this.ctx.globalAlpha = layer.config.alpha;
      this.ctx.filter =
        layer.config.compositeBlur > 0 ? `blur(${layer.config.compositeBlur}px)` : "none";
      this.ctx.drawImage(layer.surface, 0, 0);
      this.ctx.restore();
    }
  }

  private drawLayerColumn(layer: MatrixLayerRuntime, colIndex: number): void {
    const { ctx, config, board, grid } = layer;
    const x = colIndex * config.fontSize;
    const cellSize = config.fontSize;

    ctx.clearRect(x - 1, 0, cellSize + 2, layer.surface.height);
    ctx.font = `${config.fontSize}px "MS Gothic", "Osaka", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const centerX = x + cellSize / 2;

    for (let row = 0; row < grid.rows; row++) {
      const cell = getCellAt(board, row, colIndex);
      if (cell.brightness <= 0.01 && !cell.isPacket) continue;

      const style = this.getGlyphStyle(layer, cell.brightness, cell.isPacket);
      const y = row * cellSize;
      this.drawGlyph(ctx, cell.char, centerX, y, style);
    }
  }

  private getGlyphStyle(
    layer: MatrixLayerRuntime,
    brightness: number,
    isPacket: boolean,
  ): GlyphStyle {
    const isForeground = layer.config.id === "foreground";

    if (isPacket) {
      return {
        coreRgb: PACKET_RGB,
        coreAlpha: isForeground ? 1 : 0.8,
        glowRgb: PACKET_RGB,
        glowAlpha: isForeground ? 0.65 : 0.25,
        glowBlur: isForeground ? layer.config.glowBlur * 1.15 : layer.config.glowBlur * 0.5,
      };
    }

    if (brightness > 0.95) {
      return {
        coreRgb: HEAD_RGB,
        coreAlpha: 1,
        glowRgb: HEAD_RGB,
        glowAlpha: isForeground ? 0.8 : 0.2,
        glowBlur: isForeground ? layer.config.glowBlur : layer.config.glowBlur * 0.45,
      };
    }

    if (brightness > 0.5) {
      return {
        coreRgb: TRAIL_BRIGHT_RGB,
        coreAlpha: 0.92,
        glowRgb: TRAIL_BRIGHT_RGB,
        glowAlpha: isForeground ? 0.42 : 0.14,
        glowBlur: isForeground ? layer.config.glowBlur * 0.7 : layer.config.glowBlur * 0.3,
      };
    }

    if (brightness > 0.2) {
      return {
        coreRgb: TRAIL_MID_RGB,
        coreAlpha: 0.78,
        glowRgb: TRAIL_MID_RGB,
        glowAlpha: isForeground ? 0.12 : 0,
        glowBlur: isForeground ? layer.config.glowBlur * 0.35 : 0,
      };
    }

    return {
      coreRgb: TRAIL_DIM_RGB,
      coreAlpha: 0.5,
      glowRgb: TRAIL_DIM_RGB,
      glowAlpha: 0,
      glowBlur: 0,
    };
  }

  private drawGlyph(
    ctx: CanvasRenderingContext2D,
    char: string,
    x: number,
    y: number,
    style: GlyphStyle,
  ): void {
    if (style.glowBlur > 0 && style.glowAlpha > 0) {
      ctx.shadowBlur = style.glowBlur;
      ctx.shadowColor = rgba(style.glowRgb, style.glowAlpha);
      ctx.fillStyle = rgba(style.glowRgb, style.glowAlpha);
      ctx.fillText(char, x, y);
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
    }

    ctx.fillStyle = rgba(style.coreRgb, style.coreAlpha);
    ctx.fillText(char, x, y);
  }

  private createLayers(): MatrixLayerRuntime[] {
    const layerConfigs = deriveMatrixLayerConfigs(this.config);

    return layerConfigs.map((config) => {
      const surface = document.createElement("canvas");
      surface.width = this.canvas.width;
      surface.height = this.canvas.height;

      const ctx = surface.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to get 2d canvas context for Matrix layer");
      }

      const grid = computeMatrixGrid(surface.width, surface.height, config.fontSize);
      const board = createMatrixBoard(grid.rows, grid.cols);

      return {
        config,
        board,
        grid,
        surface,
        ctx,
        lastTickTime: 0,
        lastPostRotationTime: 0,
        activePacketCols: [],
      };
    });
  }
}

function rgba(rgb: readonly [number, number, number], alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamped})`;
}
