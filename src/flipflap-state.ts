/**
 * Pure FlipFlap board state — character set, rotation logic, and post formatting.
 *
 * This module has zero DOM, canvas, or audio dependencies. It models the
 * split-flap display as a grid of cells, each rotating forward-only through
 * an active character set. The active set starts from the Latin drum and can
 * be extended per post with non-Latin characters. The deterministic tick model
 * makes it fully testable without animation timers.
 *
 * Real split-flap displays rotate forward through a fixed drum of characters.
 * To reach a character that appears "earlier" in the set, the flap must cycle
 * all the way around. This is the defining visual characteristic of the display.
 */

/**
 * The ordered character set for the split-flap drum.
 *
 * Modeled after real Solari boards: space, then letters A-Z, then digits 0-9,
 * then common punctuation. Every flap cell cycles forward through this exact
 * sequence. Characters not in this base set are either inserted into the
 * active per-post drum (for visible non-whitespace characters) or mapped to
 * space.
 */
export const CHAR_SET: readonly string[] = [
  " ",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
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
  ".",
  ",",
  "'",
  ":",
  ";",
  "!",
  "?",
  "-",
  "/",
  "@",
  "#",
];

/**
 * Precomputed lookup table: character → index in CHAR_SET.
 * Unknown characters are not in the map; callers should fall back to 0 (space).
 */
const charToIndex: ReadonlyMap<string, number> = new Map(CHAR_SET.map((ch, i) => [ch, i]));

/** Returns the index of a character in CHAR_SET (0 for unknown/lowercase). */
export function charIndex(ch: string): number {
  const upper = ch.toUpperCase();
  return charToIndex.get(upper) ?? 0;
}

/**
 * Calculate how many forward steps are needed to rotate from `current` to `target`.
 *
 * Forward-only: if target is at or after current, it's a simple difference.
 * If target is before current, the flap must wrap around the full drum.
 * Returns 0 when current === target.
 */
export function stepsToTarget(current: string, target: string): number {
  const from = charIndex(current);
  const to = charIndex(target);
  if (from === to) return 0;
  if (to > from) return to - from;
  // Wrap around: remaining chars to end + distance from start to target
  return CHAR_SET.length - from + to;
}

/** Configuration for a split-flap board. */
export interface BoardConfig {
  rows: number;
  cols: number;
}

/** A single flap cell on the board. */
export interface FlapCell {
  /** The character currently displayed. */
  current: string;
  /** The character this cell is rotating toward. */
  target: string;
  /** How many forward steps remain before reaching the target. */
  stepsRemaining: number;
}

/** The complete board state — a grid of flap cells. */
export interface FlapBoard {
  rows: number;
  cols: number;
  cells: FlapCell[][];
  activeCharSet: readonly string[];
  activeCharToIndex: ReadonlyMap<string, number>;
}

/** Position of a cell on the board — returned by advanceBoard for audio sync. */
export interface CellPosition {
  row: number;
  col: number;
}

/** Create a fresh board with all cells at space. */
export function createBoard(config: BoardConfig): FlapBoard {
  const cells: FlapCell[][] = [];
  for (let r = 0; r < config.rows; r++) {
    const row: FlapCell[] = [];
    for (let c = 0; c < config.cols; c++) {
      row.push({ current: " ", target: " ", stepsRemaining: 0 });
    }
    cells.push(row);
  }
  return {
    rows: config.rows,
    cols: config.cols,
    cells,
    activeCharSet: CHAR_SET,
    activeCharToIndex: charToIndex,
  };
}

export interface SetTargetTextOptions {
  random?: () => number;
}

/**
 * Set the target text for the board.
 *
 * Each element of `lines` becomes one row. Characters are normalized to the
 * active drum for this tweet window: base Latin characters are uppercased,
 * repeated non-Latin characters reuse the same random insertion, and
 * unsupported whitespace-like characters map to space. Short lines are padded,
 * long lines truncated. Fewer lines than rows results in blank rows at the
 * bottom.
 *
 * This recomputes `stepsRemaining` for every cell based on the distance from
 * its current character to the new target.
 */
export function setTargetText(
  board: FlapBoard,
  lines: string[],
  options?: SetTargetTextOptions,
): void {
  const random = options?.random ?? Math.random;
  const activeCharSet = buildActiveCharSet(lines, random);
  const activeCharToIndex = new Map(activeCharSet.map((ch, i) => [ch, i]));
  board.activeCharSet = activeCharSet;
  board.activeCharToIndex = activeCharToIndex;

  for (let r = 0; r < board.rows; r++) {
    const line = r < lines.length ? lines[r] : "";
    for (let c = 0; c < board.cols; c++) {
      const ch = c < line.length ? normalizeCharForSet(line[c], activeCharToIndex) : " ";
      const cell = board.cells[r][c];
      const normalizedCurrent = normalizeCharForSet(cell.current, activeCharToIndex);
      if (normalizedCurrent !== cell.current) {
        cell.current = normalizedCurrent;
      }
      cell.target = ch;
      cell.stepsRemaining = stepsToTargetInSet(
        cell.current,
        ch,
        activeCharToIndex,
        activeCharSet.length,
      );
    }
  }
}

/**
 * Advance every active cell by one step.
 *
 * Returns the positions of cells that flipped (stepsRemaining > 0 before
 * this call). The caller uses this list to trigger audio for each flip.
 */
export function advanceBoard(board: FlapBoard): CellPosition[] {
  const flipped: CellPosition[] = [];

  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const cell = board.cells[r][c];
      if (cell.stepsRemaining <= 0) continue;

      const currentIdx = board.activeCharToIndex.get(cell.current.toUpperCase()) ?? 0;
      const nextIdx = (currentIdx + 1) % board.activeCharSet.length;
      cell.current = board.activeCharSet[nextIdx];
      cell.stepsRemaining--;
      flipped.push({ row: r, col: c });
    }
  }

  return flipped;
}

function buildActiveCharSet(lines: string[], random: () => number): readonly string[] {
  const active = [...CHAR_SET];
  const seenExtra = new Set<string>();

  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const upper = line[i].toUpperCase();
      if (charToIndex.has(upper)) continue;
      if (isWhitespaceLike(upper)) continue;
      if (seenExtra.has(upper)) continue;

      seenExtra.add(upper);
      const insertion = Math.floor(random() * (active.length + 1));
      active.splice(insertion, 0, upper);
    }
  }

  return active;
}

function normalizeCharForSet(ch: string, lookup: ReadonlyMap<string, number>): string {
  const upper = ch.toUpperCase();
  if (lookup.has(upper)) return upper;
  return " ";
}

function stepsToTargetInSet(
  current: string,
  target: string,
  lookup: ReadonlyMap<string, number>,
  setLength: number,
): number {
  const from = lookup.get(current.toUpperCase()) ?? 0;
  const to = lookup.get(target.toUpperCase()) ?? 0;
  if (from === to) return 0;
  if (to > from) return to - from;
  return setLength - from + to;
}

function isWhitespaceLike(ch: string): boolean {
  return ch.trim().length === 0;
}

/** Check whether all cells have reached their targets. */
export function isBoardSettled(board: FlapBoard): boolean {
  for (const row of board.cells) {
    for (const cell of row) {
      if (cell.stepsRemaining > 0) return false;
    }
  }
  return true;
}

// --- Post formatting ---

/** A post with optional author attribution. */
export interface PostEntry {
  text: string;
  author?: string;
}

/**
 * Select exactly one post for the current FlipFlap rotation index.
 *
 * FlipFlap intentionally shows one post per board cycle so users get a stable
 * readable hold period before the next mechanical transition starts.
 */
export function selectFlipFlapPost(
  posts: (string | PostEntry)[],
  postIndex: number,
): (string | PostEntry)[] {
  if (posts.length === 0) {
    return [];
  }

  const normalizedIndex = ((postIndex % posts.length) + posts.length) % posts.length;
  return [posts[normalizedIndex]];
}

/**
 * Format posts for display on the split-flap board.
 *
 * Each post becomes one or more lines (word-wrapped at `cols`). Posts are
 * separated by a blank line. The result is padded or truncated to exactly
 * `rows` lines.
 *
 * Accepts either plain strings or PostEntry objects with optional author prefix.
 */
export function formatPostsForBoard(
  posts: (string | PostEntry)[],
  rows: number,
  cols: number,
): string[] {
  const allLines: string[] = [];

  for (let i = 0; i < posts.length; i++) {
    if (i > 0) allLines.push(""); // blank separator between posts

    const entry = posts[i];
    const text = typeof entry === "string" ? entry : entry.text;
    const author = typeof entry === "string" ? undefined : entry.author;

    // Build the display text: "@author: text" or just "text"
    const displayText = author ? `${author}: ${text}` : text;

    // Word-wrap to board width
    const wrapped = wrapText(displayText, cols);
    allLines.push(...wrapped);
  }

  // Pad or truncate to exactly `rows` lines
  const result: string[] = [];
  for (let r = 0; r < rows; r++) {
    result.push(r < allLines.length ? allLines[r] : "");
  }
  return result;
}

/**
 * Simple character-level wrap — splits text into chunks of at most `width`.
 *
 * Tried word-boundary wrapping but split-flap displays use fixed-width
 * character cells with no proportional spacing, so hard wrapping at the
 * column boundary is more authentic to real Solari boards.
 */
function wrapText(text: string, width: number): string[] {
  if (text.length === 0) return [""];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) {
    lines.push(text.slice(i, i + width));
  }
  return lines;
}
