import { describe, expect, it } from "vitest";

import {
  advanceBoard,
  CHAR_SET,
  createBoard,
  formatPostsForBoard,
  isBoardSettled,
  setTargetText,
} from "./flipflap-state";

/**
 * Integration tests for Japanese (non-Latin) character handling in FlipFlap.
 *
 * These tests exercise the full pipeline: post formatting → setTargetText →
 * advanceBoard → settle. They verify that each cell's drum contains only its
 * own non-Latin character and that the same character within a tweet shares
 * the same drum position.
 */
describe("Japanese character integration", () => {
  it("full pipeline: '東京' renders correctly with per-cell drums", () => {
    const board = createBoard({ rows: 1, cols: 2 });
    setTargetText(board, ["東京"], { random: () => 0.5 });

    // Cell 0 target "東": drum has base + "東" only
    expect(board.cells[0][0].target).toBe("東");
    expect(board.cells[0][0].activeCharSet).toContain("東");
    expect(board.cells[0][0].activeCharSet).not.toContain("京");
    expect(board.cells[0][0].activeCharSet.length).toBe(CHAR_SET.length + 1);

    // Cell 1 target "京": drum has base + "京" only
    expect(board.cells[0][1].target).toBe("京");
    expect(board.cells[0][1].activeCharSet).toContain("京");
    expect(board.cells[0][1].activeCharSet).not.toContain("東");
    expect(board.cells[0][1].activeCharSet.length).toBe(CHAR_SET.length + 1);

    // Advance to settlement
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }

    expect(board.cells[0][0].current).toBe("東");
    expect(board.cells[0][1].current).toBe("京");
  });

  it("full pipeline: mixed Latin and Japanese renders correctly", () => {
    const board = createBoard({ rows: 1, cols: 4 });
    setTargetText(board, ["A東B京"], { random: () => 0.5 });

    // Cell 0 target "A": no non-latin chars
    expect(board.cells[0][0].target).toBe("A");
    expect(board.cells[0][0].activeCharSet.length).toBe(CHAR_SET.length);

    // Cell 1 target "東": only "東"
    expect(board.cells[0][1].target).toBe("東");
    expect(board.cells[0][1].activeCharSet).toContain("東");
    expect(board.cells[0][1].activeCharSet).not.toContain("京");

    // Cell 2 target "B": no non-latin chars
    expect(board.cells[0][2].target).toBe("B");
    expect(board.cells[0][2].activeCharSet.length).toBe(CHAR_SET.length);

    // Cell 3 target "京": only "京"
    expect(board.cells[0][3].target).toBe("京");
    expect(board.cells[0][3].activeCharSet).toContain("京");
    expect(board.cells[0][3].activeCharSet).not.toContain("東");

    // Advance to settlement
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }

    expect(board.cells[0][0].current).toBe("A");
    expect(board.cells[0][1].current).toBe("東");
    expect(board.cells[0][2].current).toBe("B");
    expect(board.cells[0][3].current).toBe("京");
  });

  it("repeated same Japanese char: both cells settle to the same character", () => {
    const board = createBoard({ rows: 1, cols: 2 });
    setTargetText(board, ["東東"], { random: () => 0.5 });

    // Both cells should have same drum position for "東"
    const idx0 = board.cells[0][0].activeCharToIndex.get("東");
    const idx1 = board.cells[0][1].activeCharToIndex.get("東");
    expect(idx0).toBe(idx1);

    // Both should have same stepsRemaining
    expect(board.cells[0][0].stepsRemaining).toBe(board.cells[0][1].stepsRemaining);

    // Advance to settlement
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }

    expect(board.cells[0][0].current).toBe("東");
    expect(board.cells[0][1].current).toBe("東");
  });

  it("different tweets get different random positions for same char", () => {
    const first = createBoard({ rows: 1, cols: 1 });
    setTargetText(first, ["東"], { random: () => 0 });

    const second = createBoard({ rows: 1, cols: 1 });
    setTargetText(second, ["東"], { random: () => 0.5 });

    expect(first.cells[0][0].activeCharToIndex.get("東")).not.toBe(
      second.cells[0][0].activeCharToIndex.get("東"),
    );
  });

  it("board with no Japanese: all cells use base CHAR_SET only", () => {
    const board = createBoard({ rows: 1, cols: 3 });
    setTargetText(board, ["ABC"]);

    for (let c = 0; c < 3; c++) {
      expect(board.cells[0][c].activeCharSet.length).toBe(CHAR_SET.length);
      expect(board.cells[0][c].activeCharSet).not.toContain("東");
    }

    // Advance to settlement
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }

    expect(board.cells[0][0].current).toBe("A");
    expect(board.cells[0][1].current).toBe("B");
    expect(board.cells[0][2].current).toBe("C");
  });

  it("full post pipeline: formatted post with Japanese chars sets correct targets", () => {
    const post = "東京タワー";
    const lines = formatPostsForBoard([post], 1, 10);
    const board = createBoard({ rows: 1, cols: 10 });
    setTargetText(board, lines, { random: () => 0.5 });

    // Verify targets match the post
    const targets = board.cells[0].map((c) => c.target).join("");
    expect(targets).toBe(post.padEnd(10, " "));

    // Each Japanese char should have its own drum
    // Cell with "東" should not have "京", "タ", "ワ" in its drum
    expect(board.cells[0][0].activeCharSet).toContain("東");
    expect(board.cells[0][0].activeCharSet).not.toContain("京");
    expect(board.cells[0][0].activeCharSet).not.toContain("タ");
    expect(board.cells[0][0].activeCharSet).not.toContain("ワ");

    // Advance to settlement
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }

    expect(board.cells[0][0].current).toBe("東");
    expect(board.cells[0][1].current).toBe("京");
    expect(board.cells[0][2].current).toBe("タ");
    expect(board.cells[0][3].current).toBe("ワ");
  });

  it("transitioning between posts resets character positions", () => {
    const board = createBoard({ rows: 1, cols: 1 });

    // First post with random 0
    setTargetText(board, ["東"], { random: () => 0 });
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }
    expect(board.cells[0][0].current).toBe("東");

    // Second post with different random — targets space (no non-latin)
    setTargetText(board, [" "], { random: () => 0.5 });
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }
    expect(board.cells[0][0].current).toBe(" ");

    // Third post with different random — "東" gets a new position
    setTargetText(board, ["東"], { random: () => 0.9 });
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }
    expect(board.cells[0][0].current).toBe("東");
  });

  it("multi-row Japanese text: each cell has only its own char", () => {
    const board = createBoard({ rows: 2, cols: 3 });
    setTargetText(board, ["東京A", "B大阪"], { random: () => 0.5 });

    // Row 0
    expect(board.cells[0][0].target).toBe("東");
    expect(board.cells[0][0].activeCharSet).toContain("東");
    expect(board.cells[0][0].activeCharSet).not.toContain("京");
    expect(board.cells[0][0].activeCharSet).not.toContain("阪");

    expect(board.cells[0][1].target).toBe("京");
    expect(board.cells[0][1].activeCharSet).toContain("京");
    expect(board.cells[0][1].activeCharSet).not.toContain("東");
    expect(board.cells[0][1].activeCharSet).not.toContain("阪");

    expect(board.cells[0][2].target).toBe("A");
    expect(board.cells[0][2].activeCharSet.length).toBe(CHAR_SET.length);

    // Row 1
    expect(board.cells[1][0].target).toBe("B");
    expect(board.cells[1][0].activeCharSet.length).toBe(CHAR_SET.length);

    expect(board.cells[1][1].target).toBe("大");
    expect(board.cells[1][1].activeCharSet).toContain("大");
    expect(board.cells[1][1].activeCharSet).not.toContain("東");
    expect(board.cells[1][1].activeCharSet).not.toContain("京");
    expect(board.cells[1][1].activeCharSet).not.toContain("阪");

    expect(board.cells[1][2].target).toBe("阪");
    expect(board.cells[1][2].activeCharSet).toContain("阪");
    expect(board.cells[1][2].activeCharSet).not.toContain("東");
    expect(board.cells[1][2].activeCharSet).not.toContain("京");
    expect(board.cells[1][2].activeCharSet).not.toContain("大");

    // Advance to settlement
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }

    expect(board.cells[0][0].current).toBe("東");
    expect(board.cells[0][1].current).toBe("京");
    expect(board.cells[0][2].current).toBe("A");
    expect(board.cells[1][0].current).toBe("B");
    expect(board.cells[1][1].current).toBe("大");
    expect(board.cells[1][2].current).toBe("阪");
  });

  it("same Japanese char across rows: shares drum position", () => {
    const board = createBoard({ rows: 2, cols: 1 });
    setTargetText(board, ["東", "東"], { random: () => 0.5 });

    const idx0 = board.cells[0][0].activeCharToIndex.get("東");
    const idx1 = board.cells[1][0].activeCharToIndex.get("東");
    expect(idx0).toBe(idx1);
    expect(board.cells[0][0].stepsRemaining).toBe(board.cells[1][0].stepsRemaining);

    // Advance to settlement
    while (!isBoardSettled(board)) {
      advanceBoard(board);
    }

    expect(board.cells[0][0].current).toBe("東");
    expect(board.cells[1][0].current).toBe("東");
  });
});
