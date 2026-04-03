/**
 * Pure Matrix rain board state — character set, drop physics, trail fading,
 * and data packet injection.
 *
 * This module has zero DOM, canvas, or audio dependencies. It models the
 * Matrix digital rain as a grid of columns, each with an independently
 * falling drop and a fading trail of characters. Readable X post text is
 * injected as "data packets" that appear inline within column streams.
 *
 * The design mirrors flipflap-state.ts: pure functions, deterministic ticks,
 * fully testable without animation timers or browser APIs.
 */

// ---------------------------------------------------------------------------
// Character set
// ---------------------------------------------------------------------------

/**
 * The ordered character set for Matrix rain.
 *
 * Uses half-width Katakana (U+FF65–U+FF9F) for the authentic Matrix look,
 * supplemented with ASCII digits and a handful of cryptic symbols. Full-width
 * Kanji were intentionally excluded — half-width Katakana are more readable
 * at small canvas font sizes and match the film's actual character set more
 * closely.
 */
export const MATRIX_CHARS: readonly string[] = [
  // Half-width Katakana (U+FF66–U+FF9D, skip U+FF65 half-width middot)
  "ｦ",
  "ｧ",
  "ｨ",
  "ｩ",
  "ｪ",
  "ｫ",
  "ｬ",
  "ｭ",
  "ｮ",
  "ｯ",
  "ｱ",
  "ｲ",
  "ｳ",
  "ｴ",
  "ｵ",
  "ｶ",
  "ｷ",
  "ｸ",
  "ｹ",
  "ｺ",
  "ｻ",
  "ｼ",
  "ｽ",
  "ｾ",
  "ｿ",
  "ﾀ",
  "ﾁ",
  "ﾂ",
  "ﾃ",
  "ﾄ",
  "ﾅ",
  "ﾆ",
  "ﾇ",
  "ﾈ",
  "ﾉ",
  "ﾊ",
  "ﾋ",
  "ﾌ",
  "ﾍ",
  "ﾎ",
  "ﾏ",
  "ﾐ",
  "ﾑ",
  "ﾒ",
  "ﾓ",
  "ﾔ",
  "ﾕ",
  "ﾖ",
  "ﾗ",
  "ﾘ",
  "ﾙ",
  "ﾚ",
  "ﾛ",
  "ﾜ",
  "ﾝ",
  // ASCII digits
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  // Cryptic symbols
  ":",
  ".",
  "=",
  "*",
  "+",
  "-",
  "<",
  ">",
  "|",
  "Z",
];

/** Return a uniformly random character from MATRIX_CHARS. */
export function randomMatrixChar(): string {
  return MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/**
 * A single falling drop within a column.
 *
 * The drop "head" is the brightest cell. Behind it the trail fades over
 * `trailLength` cells. Once the head exits the bottom of the board the drop
 * is cleared so a new one can be spawned.
 */
export interface RainDrop {
  /** Current row of the drop head (0 = top). */
  headRow: number;
  /** Number of cells in the fading trail above the head. */
  trailLength: number;
  /** Ticks remaining until the next downward step (speed control). */
  ticksUntilMove: number;
  /** How many ticks between each downward step. Lower = faster. */
  speed: number;
}

/**
 * A "data packet" — readable X post text injected vertically into a column.
 *
 * Packet characters render with higher brightness than rain characters so
 * they stand out as readable text within the stream.
 */
export interface DataPacket {
  /** Characters to display (one per row). */
  chars: string[];
  /** Row index where the packet starts. */
  startRow: number;
}

/** Per-column state including the active drop, trail, and any data packet. */
export interface RainColumn {
  /** Active falling drop, or null if this column is idle. */
  drop: RainDrop | null;
  /**
   * Per-cell brightness values for this column (length === board.rows).
   * 0 = black, 1 = head/full brightness. Trail cells decay from 1 toward 0.
   */
  brightness: number[];
  /**
   * Per-cell characters for this column (length === board.rows).
   * Characters are randomized on each advance to create the "glittering" effect.
   */
  chars: string[];
  /** Optional data packet overlaid on this column. */
  packet: DataPacket | null;
}

/** The complete Matrix rain board state. */
export interface MatrixBoard {
  rows: number;
  cols: number;
  columns: RainColumn[];
}

/** What getCellAt returns for a single canvas cell. */
export interface MatrixCell {
  /** Character to render at this position. */
  char: string;
  /**
   * Brightness 0–1. Callers map this to an alpha or color intensity.
   * > 0.9 = drop head (bright white-green)
   * 0.2–0.9 = trail (medium green)
   * < 0.2 = fading out (dark green)
   * 0 = black (no character shown)
   */
  brightness: number;
  /** True when this cell belongs to a data packet (readable post text). */
  isPacket: boolean;
}

// ---------------------------------------------------------------------------
// Board creation
// ---------------------------------------------------------------------------

/** Minimum trail length in cells. */
const MIN_TRAIL = 8;
/** Maximum trail length in cells. */
const MAX_TRAIL = 28;
/** Default number of ticks between drop moves (base speed). */
const BASE_SPEED = 2;
/** Speed variation ± ticks around BASE_SPEED. */
const SPEED_VARIATION = 2;

/** Create a fresh Matrix rain board with all cells dark. */
export function createMatrixBoard(rows: number, cols: number): MatrixBoard {
  const columns: RainColumn[] = [];
  for (let c = 0; c < cols; c++) {
    columns.push({
      drop: null,
      brightness: new Array<number>(rows).fill(0),
      chars: Array.from({ length: rows }, () => randomMatrixChar()),
      packet: null,
    });
  }
  return { rows, cols, columns };
}

// ---------------------------------------------------------------------------
// Reading cell state
// ---------------------------------------------------------------------------

/**
 * Return the visual state of a single cell.
 * Returns a zero-brightness cell for out-of-bounds positions.
 */
export function getCellAt(board: MatrixBoard, row: number, col: number): MatrixCell {
  if (row < 0 || row >= board.rows || col < 0 || col >= board.cols) {
    return { char: " ", brightness: 0, isPacket: false };
  }

  const column = board.columns[col];
  const brightness = column.brightness[row];
  const char = column.chars[row];

  // Check if this row falls within an active data packet overlay
  const isPacket =
    column.packet !== null &&
    row >= column.packet.startRow &&
    row < column.packet.startRow + column.packet.chars.length;

  if (isPacket && column.packet) {
    const packetChar = column.packet.chars[row - column.packet.startRow];
    return {
      char: packetChar,
      // Data packets are always rendered at maximum brightness
      brightness: 1.0,
      isPacket: true,
    };
  }

  return { char, brightness, isPacket: false };
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

/**
 * Probabilistically spawn new drops in idle columns.
 *
 * @param board - Board to modify in place.
 * @param density - Probability (0–1) of spawning a new drop in each idle column
 *   per call. At density 1.0 every idle column gets a drop immediately.
 */
export function spawnDrops(board: MatrixBoard, density: number): void {
  for (let c = 0; c < board.cols; c++) {
    const col = board.columns[c];
    // Only spawn if the column is idle
    if (col.drop !== null) continue;
    if (Math.random() > density) continue;

    const trailLength = MIN_TRAIL + Math.floor(Math.random() * (MAX_TRAIL - MIN_TRAIL + 1));
    const speed = Math.max(
      1,
      BASE_SPEED + Math.floor(Math.random() * (SPEED_VARIATION * 2 + 1)) - SPEED_VARIATION,
    );

    col.drop = {
      headRow: 0,
      trailLength,
      ticksUntilMove: speed,
      speed,
    };

    // Brighten the head cell immediately so it's visible on first render
    col.brightness[0] = 1.0;
    col.chars[0] = randomMatrixChar();
  }
}

// ---------------------------------------------------------------------------
// Advancing
// ---------------------------------------------------------------------------

/** How much brightness decays per cell above the head (linear fade). */
const TRAIL_BRIGHTNESS_STEP = 1 / (MAX_TRAIL + 1);
/** Brightness fade-out rate for idle cells per tick. */
const FADE_RATE = 0.05;

/**
 * Advance the board state by one tick.
 *
 * Moves all active drops downward according to their speed, refreshes trail
 * brightness, fades idle cells, and randomizes head characters.
 *
 * @returns An array of column indices that changed and need redrawing
 *   (dirty-column tracking for the renderer).
 */
export function advanceMatrix(board: MatrixBoard): number[] {
  const dirty: number[] = [];

  for (let c = 0; c < board.cols; c++) {
    const col = board.columns[c];
    let changed = false;

    // --- Fade all cells that have lingering brightness ---
    for (let r = 0; r < board.rows; r++) {
      if (col.brightness[r] > 0 && col.drop === null) {
        col.brightness[r] = Math.max(0, col.brightness[r] - FADE_RATE);
        changed = true;
      }
    }

    // --- Advance active drop ---
    if (col.drop !== null) {
      const drop = col.drop;

      drop.ticksUntilMove--;
      if (drop.ticksUntilMove <= 0) {
        drop.ticksUntilMove = drop.speed;
        drop.headRow++;
        changed = true;

        if (drop.headRow >= board.rows) {
          // Drop has exited the bottom — clear it and let the trail fade
          col.drop = null;
        }
      }

      // Recompute brightness for all cells in this column
      if (drop !== null || col.drop === null) {
        refreshColumnBrightness(board.rows, col, col.drop ?? drop);
        changed = true;
      }
    }

    // --- Randomize head character each tick for the "glittering" effect ---
    if (col.drop !== null) {
      col.chars[col.drop.headRow] = randomMatrixChar();
      changed = true;
    }

    // --- Data packets are always dirty if present ---
    if (col.packet !== null) {
      changed = true;
    }

    if (changed) dirty.push(c);
  }

  return dirty;
}

/**
 * Recompute per-cell brightness for a column based on the current drop position.
 *
 * The head cell is always brightness 1. Cells above it fade linearly over
 * the trail length. Cells that have no drop decrement naturally via FADE_RATE.
 */
function refreshColumnBrightness(rows: number, col: RainColumn, drop: RainDrop): void {
  for (let r = 0; r < rows; r++) {
    const distFromHead = drop.headRow - r;

    if (r === drop.headRow) {
      // Drop head — maximum brightness
      col.brightness[r] = 1.0;
    } else if (distFromHead > 0 && distFromHead <= drop.trailLength) {
      // Trail — linear fade from 1 down to near 0
      col.brightness[r] = Math.max(
        0,
        1.0 - distFromHead * TRAIL_BRIGHTNESS_STEP * (MAX_TRAIL / drop.trailLength),
      );
    } else if (r > drop.headRow) {
      // Below the head — not yet reached
      col.brightness[r] = 0;
    }
    // Cells above the trail keep their previous brightness and fade naturally
  }
}

// ---------------------------------------------------------------------------
// Data packet injection
// ---------------------------------------------------------------------------

/**
 * Inject readable post text vertically into a column as a "data packet".
 *
 * The text characters replace the rain characters in that column section,
 * and are rendered at maximum brightness so they stand out as readable
 * content within the stream. The packet persists until explicitly cleared
 * or replaced by a new injection.
 *
 * If the column index is out of bounds the call is silently ignored.
 * If the text is longer than the board rows it is truncated.
 *
 * @param board - Board to modify in place.
 * @param text - Text to display vertically. Each character occupies one row.
 * @param colIndex - Column index to inject the packet into.
 * @param startRow - Starting row for the packet (default 0).
 */
export function injectDataPacket(
  board: MatrixBoard,
  text: string,
  colIndex: number,
  startRow = 0,
): void {
  if (colIndex < 0 || colIndex >= board.cols) return;

  const col = board.columns[colIndex];
  const maxChars = board.rows - startRow;
  const chars = text.slice(0, maxChars).split("");

  col.packet = { chars, startRow };
}

/**
 * Remove a data packet from a column.
 *
 * After clearing, the column reverts to displaying normal rain characters.
 */
export function clearDataPacket(board: MatrixBoard, colIndex: number): void {
  if (colIndex < 0 || colIndex >= board.cols) return;
  board.columns[colIndex].packet = null;
}
