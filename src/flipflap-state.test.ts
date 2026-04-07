import { describe, expect, it } from "vitest";

import {
  advanceBoard,
  type BoardConfig,
  CHAR_SET,
  charIndex,
  createBoard,
  formatPostsForBoard,
  isBoardSettled,
  selectFlipFlapPost,
  setTargetText,
  stepsToTarget,
} from "./flipflap-state";

describe("CHAR_SET", () => {
  it("starts with space and contains uppercase letters", () => {
    expect(CHAR_SET[0]).toBe(" ");
    expect(CHAR_SET).toContain("A");
    expect(CHAR_SET).toContain("Z");
  });

  it("contains digits", () => {
    for (let d = 0; d <= 9; d++) {
      expect(CHAR_SET).toContain(String(d));
    }
  });

  it("has no duplicate characters", () => {
    const unique = new Set(CHAR_SET);
    expect(unique.size).toBe(CHAR_SET.length);
  });
});

describe("charIndex", () => {
  it("returns 0 for space", () => {
    expect(charIndex(" ")).toBe(0);
  });

  it("returns correct index for A", () => {
    expect(charIndex("A")).toBe(CHAR_SET.indexOf("A"));
  });

  it("returns 0 for unknown characters (maps to space)", () => {
    expect(charIndex("\t")).toBe(0);
    expect(charIndex("\n")).toBe(0);
  });

  it("is case-insensitive (lowercase maps to uppercase)", () => {
    expect(charIndex("a")).toBe(charIndex("A"));
    expect(charIndex("z")).toBe(charIndex("Z"));
  });
});

describe("stepsToTarget", () => {
  it("returns 0 when current equals target", () => {
    expect(stepsToTarget("A", "A")).toBe(0);
  });

  it("returns 1 when target is the next character", () => {
    // Space → A is one step forward in the character set
    expect(stepsToTarget(" ", "A")).toBe(charIndex("A") - charIndex(" "));
  });

  it("wraps around when target is before current in the character set", () => {
    // Forward-only: going from B to A requires cycling through the rest
    // of the character set and wrapping back to A.
    const bIdx = charIndex("B");
    const aIdx = charIndex("A");
    expect(stepsToTarget("B", "A")).toBe(CHAR_SET.length - bIdx + aIdx);
  });

  it("returns full cycle length for space to space (no-op)", () => {
    expect(stepsToTarget(" ", " ")).toBe(0);
  });
});

describe("createBoard", () => {
  it("creates a board with the specified dimensions", () => {
    const config: BoardConfig = { rows: 2, cols: 5 };
    const board = createBoard(config);

    expect(board.rows).toBe(2);
    expect(board.cols).toBe(5);
    expect(board.cells.length).toBe(2);
    expect(board.cells[0].length).toBe(5);
  });

  it("initializes all cells to space with zero steps remaining", () => {
    const board = createBoard({ rows: 1, cols: 3 });

    for (const cell of board.cells[0]) {
      expect(cell.current).toBe(" ");
      expect(cell.target).toBe(" ");
      expect(cell.stepsRemaining).toBe(0);
    }
  });
});

describe("setTargetText", () => {
  it("sets target characters for a single row", () => {
    const board = createBoard({ rows: 1, cols: 5 });
    setTargetText(board, ["HELLO"]);

    expect(board.cells[0][0].target).toBe("H");
    expect(board.cells[0][1].target).toBe("E");
    expect(board.cells[0][2].target).toBe("L");
    expect(board.cells[0][3].target).toBe("L");
    expect(board.cells[0][4].target).toBe("O");
  });

  it("pads short lines with spaces", () => {
    const board = createBoard({ rows: 1, cols: 5 });
    setTargetText(board, ["HI"]);

    expect(board.cells[0][0].target).toBe("H");
    expect(board.cells[0][1].target).toBe("I");
    expect(board.cells[0][2].target).toBe(" ");
    expect(board.cells[0][3].target).toBe(" ");
    expect(board.cells[0][4].target).toBe(" ");
  });

  it("truncates long lines to board width", () => {
    const board = createBoard({ rows: 1, cols: 3 });
    setTargetText(board, ["HELLO"]);

    expect(board.cells[0][0].target).toBe("H");
    expect(board.cells[0][1].target).toBe("E");
    expect(board.cells[0][2].target).toBe("L");
  });

  it("handles multiple rows", () => {
    const board = createBoard({ rows: 2, cols: 3 });
    setTargetText(board, ["ABC", "XYZ"]);

    expect(board.cells[0][0].target).toBe("A");
    expect(board.cells[1][2].target).toBe("Z");
  });

  it("fills extra rows with spaces when fewer lines than rows", () => {
    const board = createBoard({ rows: 3, cols: 3 });
    setTargetText(board, ["HI"]);

    expect(board.cells[0][0].target).toBe("H");
    expect(board.cells[1][0].target).toBe(" ");
    expect(board.cells[2][0].target).toBe(" ");
  });

  it("computes stepsRemaining for each cell", () => {
    const board = createBoard({ rows: 1, cols: 2 });
    setTargetText(board, ["AZ"]);

    // From space to A
    expect(board.cells[0][0].stepsRemaining).toBe(stepsToTarget(" ", "A"));
    // From space to Z
    expect(board.cells[0][1].stepsRemaining).toBe(stepsToTarget(" ", "Z"));
  });

  it("converts lowercase to uppercase", () => {
    const board = createBoard({ rows: 1, cols: 3 });
    setTargetText(board, ["abc"]);

    expect(board.cells[0][0].target).toBe("A");
    expect(board.cells[0][1].target).toBe("B");
    expect(board.cells[0][2].target).toBe("C");
  });

  it("replaces unmapped characters with space", () => {
    const board = createBoard({ rows: 1, cols: 3 });
    setTargetText(board, ["A\tB"]);

    expect(board.cells[0][0].target).toBe("A");
    expect(board.cells[0][1].target).toBe(" ");
    expect(board.cells[0][2].target).toBe("B");
  });

  it("keeps non-latin characters by inserting them into the active drum", () => {
    const board = createBoard({ rows: 1, cols: 1 });
    setTargetText(board, ["東"], { random: () => 0 });

    expect(board.cells[0][0].target).toBe("東");
    expect(board.cells[0][0].stepsRemaining).toBeGreaterThan(0);

    while (board.cells[0][0].stepsRemaining > 0) {
      advanceBoard(board);
    }

    expect(board.cells[0][0].current).toBe("東");
  });

  it("uses the same insertion position for repeated non-latin characters", () => {
    const board = createBoard({ rows: 1, cols: 2 });
    setTargetText(board, ["東東"], { random: () => 0.37 });

    expect(board.cells[0][0].stepsRemaining).toBe(board.cells[0][1].stepsRemaining);
  });

  it("rebuilds non-latin insertion positions for each new target text", () => {
    const first = createBoard({ rows: 1, cols: 1 });
    setTargetText(first, ["東"], { random: () => 0 });

    const second = createBoard({ rows: 1, cols: 1 });
    setTargetText(second, ["東"], { random: () => 0.5 });

    expect(first.activeCharToIndex.get("東")).toBe(0);
    expect(second.activeCharToIndex.get("東")).toBe(24);
  });

  it("normalizes current characters that no longer exist in the new tweet drum", () => {
    const board = createBoard({ rows: 1, cols: 1 });
    setTargetText(board, ["東"], { random: () => 0 });
    while (board.cells[0][0].stepsRemaining > 0) {
      advanceBoard(board);
    }

    setTargetText(board, [" "]);

    expect(board.cells[0][0].current).toBe(" ");
    expect(board.cells[0][0].target).toBe(" ");
    expect(board.cells[0][0].stepsRemaining).toBe(0);
  });
});

describe("advanceBoard", () => {
  it("advances each cell by one step", () => {
    const board = createBoard({ rows: 1, cols: 1 });
    setTargetText(board, ["C"]);

    const initialSteps = board.cells[0][0].stepsRemaining;
    const flipped = advanceBoard(board);

    expect(board.cells[0][0].stepsRemaining).toBe(initialSteps - 1);
    expect(board.cells[0][0].current).toBe(CHAR_SET[1]); // one step from space
    expect(flipped.length).toBe(1);
    expect(flipped[0]).toEqual({ row: 0, col: 0 });
  });

  it("does not advance cells that are already at target", () => {
    const board = createBoard({ rows: 1, cols: 2 });
    // Both cells start at space, target is space → already settled
    const flipped = advanceBoard(board);

    expect(flipped.length).toBe(0);
    expect(board.cells[0][0].current).toBe(" ");
    expect(board.cells[0][0].stepsRemaining).toBe(0);
  });

  it("advances through the full character set to reach target", () => {
    const board = createBoard({ rows: 1, cols: 1 });
    setTargetText(board, ["B"]);

    const totalSteps = board.cells[0][0].stepsRemaining;
    for (let i = 0; i < totalSteps; i++) {
      advanceBoard(board);
    }

    expect(board.cells[0][0].current).toBe("B");
    expect(board.cells[0][0].stepsRemaining).toBe(0);
  });

  it("wraps around the character set correctly", () => {
    // Set board to "B", then set target to "A" — must wrap around
    const board = createBoard({ rows: 1, cols: 1 });
    setTargetText(board, ["B"]);

    // Advance to B first
    while (board.cells[0][0].stepsRemaining > 0) {
      advanceBoard(board);
    }
    expect(board.cells[0][0].current).toBe("B");

    // Now target A — requires wrapping
    setTargetText(board, ["A"]);
    const wrapSteps = board.cells[0][0].stepsRemaining;
    expect(wrapSteps).toBe(CHAR_SET.length - charIndex("B") + charIndex("A"));

    for (let i = 0; i < wrapSteps; i++) {
      advanceBoard(board);
    }
    expect(board.cells[0][0].current).toBe("A");
  });

  it("returns positions of all cells that flipped", () => {
    const board = createBoard({ rows: 2, cols: 2 });
    setTargetText(board, ["AB", "CD"]);

    const flipped = advanceBoard(board);

    // All 4 cells should have flipped (all moving from space toward targets)
    expect(flipped.length).toBe(4);
  });
});

describe("isBoardSettled", () => {
  it("returns true for a fresh board", () => {
    const board = createBoard({ rows: 2, cols: 3 });
    expect(isBoardSettled(board)).toBe(true);
  });

  it("returns false when cells are still flipping", () => {
    const board = createBoard({ rows: 1, cols: 1 });
    setTargetText(board, ["Z"]);
    expect(isBoardSettled(board)).toBe(false);
  });

  it("returns true after all cells reach their targets", () => {
    const board = createBoard({ rows: 1, cols: 1 });
    setTargetText(board, ["A"]);

    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }

    expect(isBoardSettled(board)).toBe(true);
    expect(board.cells[0][0].current).toBe("A");
  });
});

describe("formatPostsForBoard", () => {
  it("formats a single short post into board lines", () => {
    const lines = formatPostsForBoard(["Hello world"], 8, 40);

    expect(lines.length).toBe(8);
    expect(lines[0]).toBe("Hello world");
  });

  it("wraps long posts across multiple lines", () => {
    const longPost = "A".repeat(80);
    const lines = formatPostsForBoard([longPost], 4, 40);

    // 80 chars at 40 cols = 2 lines, plus separator and blank lines
    expect(lines[0]).toBe("A".repeat(40));
    expect(lines[1]).toBe("A".repeat(40));
  });

  it("separates multiple posts with blank lines", () => {
    const lines = formatPostsForBoard(["POST1", "POST2"], 8, 40);

    // POST1 on line 0, blank separator, POST2 after
    const post1Idx = lines.indexOf("POST1");
    const post2Idx = lines.indexOf("POST2");
    expect(post1Idx).toBeGreaterThanOrEqual(0);
    expect(post2Idx).toBeGreaterThan(post1Idx + 1);
  });

  it("pads output to exactly the requested number of rows", () => {
    const lines = formatPostsForBoard(["HI"], 6, 20);
    expect(lines.length).toBe(6);
  });

  it("truncates output to the requested number of rows", () => {
    const posts = Array.from({ length: 50 }, (_, i) => `Post ${i}`);
    const lines = formatPostsForBoard(posts, 4, 40);
    expect(lines.length).toBe(4);
  });

  it("handles empty post array", () => {
    const lines = formatPostsForBoard([], 4, 20);
    expect(lines.length).toBe(4);
    expect(lines.every((l: string) => l === "")).toBe(true);
  });

  it("adds @username prefix to posts with author info", () => {
    const lines = formatPostsForBoard([{ text: "Hello", author: "@user" }], 4, 40);
    expect(lines[0]).toContain("@user");
    expect(lines.join("\n")).toContain("Hello");
  });

  it("fills the board with a single post before truncating overflow", () => {
    const rows = 2;
    const cols = 5;
    const capacity = rows * cols;
    const post = "ABCDEFGHIJKL"; // 12 chars, board capacity is 10

    const lines = formatPostsForBoard([post], rows, cols);

    const board = createBoard({ rows, cols });
    setTargetText(board, lines);

    const rendered = board.cells.flatMap((row) => row.map((cell) => cell.target)).join("");

    expect(rendered).toBe(post.slice(0, capacity));
  });

  it("preserves all post characters when content fits within board capacity", () => {
    const rows = 2;
    const cols = 5;
    const post = "ABCDEFGHI"; // 9 chars, board capacity is 10

    const lines = formatPostsForBoard([post], rows, cols);

    const board = createBoard({ rows, cols });
    setTargetText(board, lines);

    const rendered = board.cells.flatMap((row) => row.map((cell) => cell.target)).join("");

    expect(rendered).toBe("ABCDEFGHI ");
  });
});

describe("selectFlipFlapPost", () => {
  it("returns only one post for the current index", () => {
    const posts = ["first", "second", "third"];

    expect(selectFlipFlapPost(posts, 1)).toEqual(["second"]);
  });

  it("wraps index when the post index exceeds the post count", () => {
    const posts = ["first", "second", "third"];

    expect(selectFlipFlapPost(posts, 4)).toEqual(["second"]);
  });

  it("returns empty list when no posts are available", () => {
    expect(selectFlipFlapPost([], 0)).toEqual([]);
  });
});
