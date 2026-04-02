import { describe, expect, it } from "vitest";

import {
  advanceMatrix,
  createMatrixBoard,
  getCellAt,
  injectDataPacket,
  MATRIX_CHARS,
  type MatrixBoard,
  type RainColumn,
  randomMatrixChar,
  spawnDrops,
} from "./matrix-state";

// ---------------------------------------------------------------------------
// MATRIX_CHARS
// ---------------------------------------------------------------------------

describe("MATRIX_CHARS", () => {
  it("contains a non-empty set of characters", () => {
    expect(MATRIX_CHARS.length).toBeGreaterThan(10);
  });

  it("contains half-width Katakana characters", () => {
    // Half-width Katakana block: U+FF65–U+FF9F
    const hasKatakana = MATRIX_CHARS.some(
      (ch: string) => ch.charCodeAt(0) >= 0xff65 && ch.charCodeAt(0) <= 0xff9f,
    );
    expect(hasKatakana).toBe(true);
  });

  it("contains ASCII digits", () => {
    expect(MATRIX_CHARS).toContain("0");
    expect(MATRIX_CHARS).toContain("9");
  });

  it("has no duplicate characters", () => {
    const unique = new Set(MATRIX_CHARS);
    expect(unique.size).toBe(MATRIX_CHARS.length);
  });
});

// ---------------------------------------------------------------------------
// randomMatrixChar
// ---------------------------------------------------------------------------

describe("randomMatrixChar", () => {
  it("returns a character from MATRIX_CHARS", () => {
    for (let i = 0; i < 50; i++) {
      expect(MATRIX_CHARS).toContain(randomMatrixChar());
    }
  });

  it("produces varying results across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(randomMatrixChar());
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// createMatrixBoard
// ---------------------------------------------------------------------------

describe("createMatrixBoard", () => {
  it("creates a board with the correct dimensions", () => {
    const board = createMatrixBoard(20, 10);
    expect(board.rows).toBe(20);
    expect(board.cols).toBe(10);
  });

  it("initializes all cells with brightness 0", () => {
    const board = createMatrixBoard(5, 5);
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        expect(getCellAt(board, r, c).brightness).toBe(0);
      }
    }
  });

  it("initializes all cells with a character", () => {
    const board = createMatrixBoard(5, 5);
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        expect(typeof getCellAt(board, r, c).char).toBe("string");
      }
    }
  });

  it("creates independent column states", () => {
    const board = createMatrixBoard(10, 4);
    expect(board.columns).toHaveLength(4);
  });

  it("handles a single-cell board", () => {
    const board = createMatrixBoard(1, 1);
    expect(board.rows).toBe(1);
    expect(board.cols).toBe(1);
    expect(getCellAt(board, 0, 0)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getCellAt
// ---------------------------------------------------------------------------

describe("getCellAt", () => {
  it("returns brightness and char for valid positions", () => {
    const board = createMatrixBoard(3, 3);
    const cell = getCellAt(board, 1, 2);
    expect(cell).toHaveProperty("brightness");
    expect(cell).toHaveProperty("char");
  });

  it("returns brightness 0 for out-of-bounds row", () => {
    const board = createMatrixBoard(3, 3);
    const cell = getCellAt(board, 99, 0);
    expect(cell.brightness).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// advanceMatrix
// ---------------------------------------------------------------------------

describe("advanceMatrix", () => {
  it("returns an array of dirty column indices", () => {
    const board = createMatrixBoard(20, 5);
    // Spawn some drops first so there's something to advance
    spawnDrops(board, 1.0); // density 1.0 spawns drops everywhere
    const dirty = advanceMatrix(board);
    expect(Array.isArray(dirty)).toBe(true);
  });

  it("marks active columns as dirty", () => {
    const board = createMatrixBoard(20, 3);
    // Force spawn in all columns
    spawnDrops(board, 1.0);
    const dirty = advanceMatrix(board);
    // Every column that has an active drop should be dirty
    expect(dirty.length).toBeGreaterThan(0);
  });

  it("moves drop head downward each tick", () => {
    const board = createMatrixBoard(20, 1);
    spawnDrops(board, 1.0);

    // Record the first bright cell position
    const before = findDropHead(board, 0);
    advanceMatrix(board);
    const after = findDropHead(board, 0);

    // Head should have advanced or wrapped
    if (before !== null && after !== null) {
      // Either moved down by 1, or wrapped to top
      expect(after === before + 1 || after === 0).toBe(true);
    }
  });

  it("returns only unique column indices", () => {
    const board = createMatrixBoard(20, 5);
    spawnDrops(board, 1.0);
    const dirty = advanceMatrix(board);
    const unique = new Set(dirty);
    expect(unique.size).toBe(dirty.length);
  });

  it("column indices are within valid range", () => {
    const board = createMatrixBoard(20, 6);
    spawnDrops(board, 1.0);
    const dirty = advanceMatrix(board);
    for (const col of dirty) {
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(board.cols);
    }
  });
});

// ---------------------------------------------------------------------------
// spawnDrops
// ---------------------------------------------------------------------------

describe("spawnDrops", () => {
  it("spawns drops in columns at density 1.0", () => {
    const board = createMatrixBoard(20, 10);
    spawnDrops(board, 1.0);
    // At density 1.0 every column should have an active drop
    const activeColumns = board.columns.filter((col: RainColumn) => col.drop !== null);
    expect(activeColumns.length).toBe(10);
  });

  it("does not spawn in already-active columns", () => {
    const board = createMatrixBoard(20, 5);
    spawnDrops(board, 1.0); // all columns get drops
    const dropsBefore = board.columns.map((col: RainColumn) => col.drop);
    spawnDrops(board, 1.0); // second call should not replace existing drops
    for (let i = 0; i < board.cols; i++) {
      expect(board.columns[i].drop).toBe(dropsBefore[i]);
    }
  });

  it("does not spawn at density 0.0", () => {
    const board = createMatrixBoard(20, 10);
    spawnDrops(board, 0.0);
    const activeColumns = board.columns.filter((col: RainColumn) => col.drop !== null);
    expect(activeColumns.length).toBe(0);
  });

  it("assigns a random trail length to each drop", () => {
    const board = createMatrixBoard(30, 20);
    spawnDrops(board, 1.0);
    const lengths = new Set(board.columns.map((col: RainColumn) => col.drop?.trailLength));
    // With 20 columns we should see some variation in trail lengths
    expect(lengths.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// injectDataPacket
// ---------------------------------------------------------------------------

describe("injectDataPacket", () => {
  it("places characters from the text into the column", () => {
    const board = createMatrixBoard(20, 5);
    injectDataPacket(board, "HELLO", 2);

    // The characters H,E,L,L,O should appear somewhere in column 2
    const chars: string[] = [];
    for (let r = 0; r < board.rows; r++) {
      chars.push(getCellAt(board, r, 2).char);
    }
    const found = "HELLO".split("").filter((ch: string) => chars.includes(ch));
    expect(found.length).toBeGreaterThan(0);
  });

  it("marks packet cells with high brightness", () => {
    const board = createMatrixBoard(20, 5);
    injectDataPacket(board, "ABCDE", 1);

    // At least some cells in column 1 should have high brightness (data packet)
    let highBrightCount = 0;
    for (let r = 0; r < board.rows; r++) {
      if (getCellAt(board, r, 1).brightness > 0.8) {
        highBrightCount++;
      }
    }
    expect(highBrightCount).toBeGreaterThan(0);
  });

  it("truncates text longer than board rows", () => {
    const board = createMatrixBoard(5, 3);
    // Text longer than board rows should not throw
    expect(() => injectDataPacket(board, "ABCDEFGHIJKLMNOP", 0)).not.toThrow();
  });

  it("does nothing for out-of-bounds column index", () => {
    const board = createMatrixBoard(10, 3);
    expect(() => injectDataPacket(board, "HI", 99)).not.toThrow();
  });

  it("marks the column as dirty after injection", () => {
    const board = createMatrixBoard(20, 5);
    injectDataPacket(board, "TEST", 3);
    // After injection, advancing should include column 3 as dirty
    const dirty = advanceMatrix(board);
    expect(dirty).toContain(3);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the row of the brightest cell in a column (the drop "head").
 * Returns null if no bright cell found.
 */
function findDropHead(board: MatrixBoard, col: number): number | null {
  let maxBrightness = 0;
  let headRow: number | null = null;
  for (let r = 0; r < board.rows; r++) {
    const { brightness } = getCellAt(board, r, col);
    if (brightness > maxBrightness) {
      maxBrightness = brightness;
      headRow = r;
    }
  }
  return headRow;
}
