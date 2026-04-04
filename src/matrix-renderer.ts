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
  /** Number of background layers to render behind the foreground (0-3). */
  backgroundLayerCount: number;
  /** Seconds between injecting the next post as a data packet. */
  postRotationSec: number;
}

/** Sensible defaults — authentic Matrix look without excessive CPU usage. */
export const DEFAULT_MATRIX_CONFIG: MatrixConfig = {
  fontSize: 24,
  spawnDensity: 0.5,
  glowIntensity: 12,
  tickIntervalMs: 40,
  backgroundLayerCount: 1,
  postRotationSec: 15,
};

// ---------------------------------------------------------------------------
// Layer configuration
// ---------------------------------------------------------------------------

export type MatrixLayerId = "far" | "mid" | "near" | "foreground";

export interface MatrixLayerConfig {
  id: MatrixLayerId;
  fontSize: number;
  alpha: number;
  compositeBlur: number;
  glowBlur: number;
  spawnDensity: number;
  tickIntervalMs: number;
}

const MAX_MATRIX_BACKGROUND_LAYERS = 3;

export function deriveMatrixLayerConfigs(base: MatrixConfig): MatrixLayerConfig[] {
  const glow = Math.max(0, base.glowIntensity);
  const minFontSize = 8;

  const backgroundLayers: MatrixLayerConfig[] = [
    {
      id: "far",
      fontSize: Math.max(minFontSize, Math.round(base.fontSize * 0.68)),
      alpha: 0.13,
      compositeBlur: 5.2,
      glowBlur: Math.max(1.4, glow * 0.82),
      spawnDensity: clampProbability(base.spawnDensity * 0.14),
      tickIntervalMs: Math.max(1, Math.round(base.tickIntervalMs * 2.15)),
    },
    {
      id: "mid",
      fontSize: Math.max(minFontSize, Math.round(base.fontSize * 0.84)),
      alpha: 0.2,
      compositeBlur: 4.0,
      glowBlur: Math.max(2.4, glow * 1.12),
      spawnDensity: clampProbability(base.spawnDensity * 0.24),
      tickIntervalMs: Math.max(1, Math.round(base.tickIntervalMs * 1.75)),
    },
    {
      id: "near",
      fontSize: Math.max(minFontSize, Math.round(base.fontSize * 1.02)),
      alpha: 0.34,
      compositeBlur: 2.6,
      glowBlur: Math.max(3.2, glow * 1.45),
      spawnDensity: clampProbability(base.spawnDensity * 0.38),
      tickIntervalMs: Math.max(1, Math.round(base.tickIntervalMs * 1.28)),
    },
  ];

  const enabledBackgroundLayers = clampBackgroundLayerCount(base.backgroundLayerCount);

  return [
    ...backgroundLayers.slice(MAX_MATRIX_BACKGROUND_LAYERS - enabledBackgroundLayers),
    {
      id: "foreground",
      fontSize: Math.max(minFontSize, Math.round(base.fontSize * 1.22)),
      alpha: 0.96,
      compositeBlur: 0.95,
      glowBlur: glow * 2.35,
      spawnDensity: clampProbability(base.spawnDensity * 0.56),
      tickIntervalMs: Math.max(1, Math.round(base.tickIntervalMs * 0.95)),
    },
  ];
}

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampBackgroundLayerCount(value: number): number {
  return Math.min(MAX_MATRIX_BACKGROUND_LAYERS, Math.max(0, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

const BG_COLOR = "#000000";
export const MATRIX_GLYPH_PIXEL_SCALE = 0.5;
export const MATRIX_GREEN_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 24, 8],
  [0, 42, 14],
  [0, 62, 20],
  [6, 92, 28],
  [16, 128, 38],
  [38, 176, 68],
  [88, 224, 128],
  [154, 242, 182],
];
const PACKET_RGB: readonly [number, number, number] = [118, 232, 150];
const TRAIL_VOID_RGB = MATRIX_GREEN_PALETTE[0];
const TRAIL_DIM_RGB = MATRIX_GREEN_PALETTE[1];
const TRAIL_MID_RGB = MATRIX_GREEN_PALETTE[3];
const TRAIL_HIGH_RGB = MATRIX_GREEN_PALETTE[4];
const TRAIL_BRIGHT_RGB = MATRIX_GREEN_PALETTE[5];
const HEAD_RGB = MATRIX_GREEN_PALETTE[7];

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
  private glyphScratchCanvas: HTMLCanvasElement;
  private glyphScratchCtx: CanvasRenderingContext2D;
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

    this.glyphScratchCanvas = document.createElement("canvas");
    const glyphScratchCtx = this.glyphScratchCanvas.getContext("2d");
    if (!glyphScratchCtx) throw new Error("Failed to get glyph scratch canvas context");
    this.glyphScratchCtx = glyphScratchCtx;

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
    const glowBoost = board.columns[colIndex].drop?.glowBoost ?? 1;

    for (let row = 0; row < grid.rows; row++) {
      const cell = getCellAt(board, row, colIndex);
      if (cell.brightness <= 0.01 && !cell.isPacket) continue;

      const style = this.getGlyphStyle(layer, cell.brightness, cell.isPacket, glowBoost);
      const y = row * cellSize;
      this.drawGlyph(ctx, cell.char, centerX, y, cellSize, style);
    }
  }

  private getGlyphStyle(
    layer: MatrixLayerRuntime,
    brightness: number,
    isPacket: boolean,
    glowBoost: number,
  ): GlyphStyle {
    const isForeground = layer.config.id === "foreground";
    const effectiveGlowBoost = isPacket ? 1 : glowBoost;

    if (isPacket) {
      return {
        coreRgb: PACKET_RGB,
        coreAlpha: isForeground ? 0.9 : 0.7,
        glowRgb: PACKET_RGB,
        glowAlpha: isForeground ? 0.42 : 0.18,
        glowBlur: isForeground ? layer.config.glowBlur * 1.35 : layer.config.glowBlur * 0.7,
      };
    }

    if (brightness > 0.95) {
      return this.applyGlowBoost(
        {
          coreRgb: HEAD_RGB,
          coreAlpha: 0.86,
          glowRgb: HEAD_RGB,
          glowAlpha: isForeground ? 0.72 : 0.3,
          glowBlur: isForeground ? layer.config.glowBlur * 1.05 : layer.config.glowBlur * 0.72,
        },
        effectiveGlowBoost,
      );
    }

    if (brightness > 0.78) {
      return this.applyGlowBoost(
        {
          coreRgb: MATRIX_GREEN_PALETTE[6],
          coreAlpha: 0.74,
          glowRgb: MATRIX_GREEN_PALETTE[6],
          glowAlpha: isForeground ? 0.48 : 0.18,
          glowBlur: isForeground ? layer.config.glowBlur * 0.95 : layer.config.glowBlur * 0.55,
        },
        effectiveGlowBoost,
      );
    }

    if (brightness > 0.62) {
      return this.applyGlowBoost(
        {
          coreRgb: TRAIL_BRIGHT_RGB,
          coreAlpha: 0.64,
          glowRgb: TRAIL_BRIGHT_RGB,
          glowAlpha: isForeground ? 0.4 : 0.14,
          glowBlur: isForeground ? layer.config.glowBlur * 0.82 : layer.config.glowBlur * 0.45,
        },
        effectiveGlowBoost,
      );
    }

    if (brightness > 0.42) {
      return this.applyGlowBoost(
        {
          coreRgb: TRAIL_HIGH_RGB,
          coreAlpha: 0.54,
          glowRgb: TRAIL_HIGH_RGB,
          glowAlpha: isForeground ? 0.3 : 0.1,
          glowBlur: isForeground ? layer.config.glowBlur * 0.68 : layer.config.glowBlur * 0.36,
        },
        effectiveGlowBoost,
      );
    }

    if (brightness > 0.24) {
      return this.applyGlowBoost(
        {
          coreRgb: TRAIL_MID_RGB,
          coreAlpha: 0.46,
          glowRgb: TRAIL_MID_RGB,
          glowAlpha: isForeground ? 0.2 : 0.05,
          glowBlur: isForeground ? layer.config.glowBlur * 0.52 : layer.config.glowBlur * 0.22,
        },
        effectiveGlowBoost,
      );
    }

    if (brightness > 0.12) {
      return this.applyGlowBoost(
        {
          coreRgb: TRAIL_DIM_RGB,
          coreAlpha: 0.34,
          glowRgb: TRAIL_DIM_RGB,
          glowAlpha: isForeground ? 0.12 : 0.03,
          glowBlur: isForeground ? layer.config.glowBlur * 0.36 : layer.config.glowBlur * 0.12,
        },
        effectiveGlowBoost,
      );
    }

    return {
      coreRgb: TRAIL_VOID_RGB,
      coreAlpha: 0.24,
      glowRgb: TRAIL_VOID_RGB,
      glowAlpha: 0,
      glowBlur: 0,
    };
  }

  private applyGlowBoost(style: GlyphStyle, glowBoost: number): GlyphStyle {
    if (glowBoost <= 1) {
      return style;
    }

    return {
      ...style,
      coreAlpha: Math.min(1, style.coreAlpha * (0.94 + glowBoost * 0.12)),
      glowAlpha: Math.min(1, style.glowAlpha * (0.82 + glowBoost * 0.36)),
      glowBlur: style.glowBlur * (0.9 + glowBoost * 0.24),
    };
  }

  private drawGlyph(
    ctx: CanvasRenderingContext2D,
    char: string,
    x: number,
    y: number,
    cellSize: number,
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

    this.drawPixelatedCore(ctx, char, x, y, cellSize, style);
  }

  private drawPixelatedCore(
    ctx: CanvasRenderingContext2D,
    char: string,
    x: number,
    y: number,
    cellSize: number,
    style: GlyphStyle,
  ): void {
    const pixelFontSize = Math.max(4, Math.round(cellSize * MATRIX_GLYPH_PIXEL_SCALE));
    const scratchWidth = Math.max(16, pixelFontSize + 10);
    const scratchHeight = Math.max(18, Math.round(pixelFontSize * 1.6) + 10);

    if (
      this.glyphScratchCanvas.width !== scratchWidth ||
      this.glyphScratchCanvas.height !== scratchHeight
    ) {
      this.glyphScratchCanvas.width = scratchWidth;
      this.glyphScratchCanvas.height = scratchHeight;
    }

    this.glyphScratchCtx.clearRect(0, 0, scratchWidth, scratchHeight);
    this.glyphScratchCtx.font = `${pixelFontSize}px "MS Gothic", "Osaka", monospace`;
    this.glyphScratchCtx.textAlign = "center";
    this.glyphScratchCtx.textBaseline = "top";
    this.glyphScratchCtx.fillStyle = rgba(style.coreRgb, style.coreAlpha);
    this.glyphScratchCtx.fillText(char, scratchWidth / 2, 2);

    const drawWidth = Math.max(1, Math.round(cellSize * 0.98));
    const drawHeight = Math.max(1, Math.round(cellSize * 1.24));

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.glyphScratchCanvas,
      Math.round(x - drawWidth / 2),
      Math.round(y),
      drawWidth,
      drawHeight,
    );
    ctx.restore();
  }

  private createLayers(): MatrixLayerRuntime[] {
    const layerConfigs = deriveMatrixLayerConfigs(this.config);

    return layerConfigs.map((config, index) => {
      const surface = document.createElement("canvas");
      surface.width = this.canvas.width;
      surface.height = this.canvas.height;

      const ctx = surface.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to get 2d canvas context for Matrix layer");
      }

      const grid = computeMatrixGrid(surface.width, surface.height, config.fontSize);
      const board = createMatrixBoard(grid.rows, grid.cols);
      this.warmLayerBoard(
        board,
        config.spawnDensity,
        12 + index * 10 + Math.floor(Math.random() * 28),
      );

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

  private warmLayerBoard(board: MatrixBoard, spawnDensity: number, ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      spawnDrops(board, spawnDensity);
      advanceMatrix(board);
    }
  }
}

function rgba(rgb: readonly [number, number, number], alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamped})`;
}
