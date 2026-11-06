// Unit tests for the move/merge rules — no DOM, no server, no network: `bun test` runs this
// directly against the same file the browser loads (`frontend/modules/.logic.ts`).

import { describe, expect, test } from "bun:test";
import {
  addRandomTile,
  emptyCells,
  emptyGrid,
  hasReached,
  isGameOver,
  mergeLine,
  move,
  newGame,
  randomTileValue,
  type Grid,
} from "../frontend/modules/.logic.ts";

function grid(rows: number[][]): Grid {
  return rows;
}

describe("mergeLine", () => {
  test("slides tiles down without merging when nothing matches", () => {
    expect(mergeLine([0, 2, 0, 4])).toEqual({ line: [2, 4, 0, 0], gained: 0 });
  });

  test("merges one adjacent pair", () => {
    expect(mergeLine([2, 2, 0, 0])).toEqual({ line: [4, 0, 0, 0], gained: 4 });
  });

  test("a run of three equal tiles merges only the first pair — each tile merges once", () => {
    expect(mergeLine([2, 2, 2, 0])).toEqual({ line: [4, 2, 0, 0], gained: 4 });
  });

  test("four equal tiles merge as two separate pairs", () => {
    expect(mergeLine([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], gained: 8 });
  });

  test("a merged tile does not merge again with its new neighbour in the same line", () => {
    // 4,4 merges to 8; the lone 8 that follows must NOT fold into it a second time.
    expect(mergeLine([4, 4, 8, 0])).toEqual({ line: [8, 8, 0, 0], gained: 8 });
  });

  test("unequal tiles never merge", () => {
    expect(mergeLine([2, 4, 2, 4])).toEqual({ line: [2, 4, 2, 4], gained: 0 });
  });
});

describe("move", () => {
  test("left slides and merges every row independently", () => {
    const g = grid([
      [2, 2, 0, 0],
      [0, 0, 4, 4],
      [2, 0, 2, 0],
      [0, 0, 0, 0],
    ]);
    const result = move(g, "left");
    expect(result.grid).toEqual([
      [4, 0, 0, 0],
      [8, 0, 0, 0],
      [4, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(result.scoreGained).toBe(4 + 8 + 4);
    expect(result.moved).toBe(true);
  });

  test("right mirrors left", () => {
    const g = grid([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(move(g, "right").grid[0]).toEqual([0, 0, 0, 4]);
  });

  test("up and down work across columns the same way rows do", () => {
    const g = grid([
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(move(g, "up").grid).toEqual([
      [4, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(move(g, "down").grid).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [4, 0, 0, 0],
    ]);
  });

  test("a move that changes nothing reports moved: false", () => {
    const g = grid([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ]);
    const result = move(g, "left");
    expect(result.moved).toBe(false);
    expect(result.scoreGained).toBe(0);
    expect(result.grid).toEqual(g);
  });

  test("sliding into open space with no merge still counts as moved", () => {
    const g = grid([
      [0, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(move(g, "left").moved).toBe(true);
  });
});

describe("addRandomTile", () => {
  test("places exactly one tile on an empty cell", () => {
    const before = emptyGrid();
    const after = addRandomTile(before, () => 0);
    const filled = after.flat().filter((v) => v !== 0);
    expect(filled.length).toBe(1);
    expect(emptyCells(after).length).toBe(emptyCells(before).length - 1);
  });

  test("a full grid is returned unchanged", () => {
    const full = grid([
      [2, 2, 2, 2],
      [2, 2, 2, 2],
      [2, 2, 2, 2],
      [2, 2, 2, 2],
    ]);
    expect(addRandomTile(full, () => 0)).toEqual(full);
  });

  test("spawns 2 below the 0.9 threshold and 4 at or above it", () => {
    expect(randomTileValue(() => 0)).toBe(2);
    expect(randomTileValue(() => 0.89)).toBe(2);
    expect(randomTileValue(() => 0.9)).toBe(4);
    expect(randomTileValue(() => 0.999)).toBe(4);
  });
});

describe("newGame", () => {
  test("starts with exactly two tiles", () => {
    const g = newGame(() => 0.1);
    const filled = g.flat().filter((v) => v !== 0);
    expect(filled.length).toBe(2);
  });
});

describe("isGameOver", () => {
  test("a board with an empty cell is never over", () => {
    expect(isGameOver(emptyGrid())).toBe(false);
  });

  test("a full board where every move still merges something is not over", () => {
    const g = grid([
      [2, 2, 4, 8],
      [4, 8, 16, 32],
      [2, 4, 8, 16],
      [4, 2, 4, 2],
    ]);
    expect(isGameOver(g)).toBe(false); // left merges the top-left 2s
  });

  test("a full board with no legal move anywhere is over", () => {
    const g = grid([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ]);
    expect(isGameOver(g)).toBe(true);
  });
});

describe("hasReached", () => {
  test("true once a tile reaches the target value", () => {
    const g = grid([
      [2048, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(hasReached(g, 2048)).toBe(true);
    expect(hasReached(emptyGrid(), 2048)).toBe(false);
  });
});
