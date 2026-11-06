// Pure 2048 rules — no DOM, no randomness baked in (every random choice takes an injectable
// `rng`), so this file is exactly what `test/game-logic.test.ts` exercises and exactly what
// `game.ts` renders: one rulebook, not two copies of it that could drift apart.
//
// A dot-prefixed module name is deliberate: `frontend/index.ts`'s own `moduleIds()` lists every
// `modules/*.ts` that does NOT start with `.` and auto-mounts each one as a panel — this file has
// no `default` export shaped like a panel, so it must stay off that list. `game.ts` reaches it at
// runtime as a same-origin relative import, `./.logic.js`, which the frontend server resolves
// back to this file (see its `moduleSource`); nothing here is special-cased, the leading dot is
// the whole mechanism.

export const SIZE = 4;

export type Grid = number[][]; // 0 means empty; any other value is a tile, always a power of 2.
export type Direction = "left" | "right" | "up" | "down";

export function emptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

export function gridsEqual(a: Grid, b: Grid): boolean {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

export function emptyCells(grid: Grid): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) cells.push([r, c]);
    }
  }
  return cells;
}

/** 2 nine times out of ten, 4 the rest — the standard 2048 spawn rule. */
export function randomTileValue(rng: () => number = Math.random): number {
  return rng() < 0.9 ? 2 : 4;
}

/** A new grid with one more tile placed on a random empty cell, or the same grid if it's full. */
export function addRandomTile(grid: Grid, rng: () => number = Math.random): Grid {
  const cells = emptyCells(grid);
  if (cells.length === 0) return grid;
  const [r, c] = cells[Math.floor(rng() * cells.length)];
  const next = cloneGrid(grid);
  next[r][c] = randomTileValue(rng);
  return next;
}

/**
 * Compress and merge one line toward its start: zeros drop out, then adjacent equal tiles merge
 * — each tile at most once, left to right, which is why a run of three equal tiles merges the
 * first pair and leaves the third alone rather than cascading (`[2,2,2,0] -> [4,2,0,0]`, not
 * `[4,4,0,0]`) while four merges into two separate pairs (`[2,2,2,2] -> [4,4,0,0]`).
 */
export function mergeLine(line: number[]): { line: number[]; gained: number } {
  const nums = line.filter((v) => v !== 0);
  const result: number[] = [];
  let gained = 0;
  let i = 0;
  while (i < nums.length) {
    if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
      const merged = nums[i] * 2;
      result.push(merged);
      gained += merged;
      i += 2;
    } else {
      result.push(nums[i]);
      i += 1;
    }
  }
  while (result.length < SIZE) result.push(0);
  return { line: result, gained };
}

function transpose(grid: Grid): Grid {
  return grid[0].map((_, c) => grid.map((row) => row[c]));
}

function reverseRows(grid: Grid): Grid {
  return grid.map((row) => row.slice().reverse());
}

export interface MoveResult {
  grid: Grid;
  moved: boolean;
  scoreGained: number;
}

/** One slide in `direction`, merging as it goes — the one place every direction funnels through
 *  `mergeLine`, so up/down/left/right can never disagree about how a merge works. */
export function move(grid: Grid, direction: Direction): MoveResult {
  let working = cloneGrid(grid);
  if (direction === "up" || direction === "down") working = transpose(working);
  if (direction === "right" || direction === "down") working = reverseRows(working);

  let scoreGained = 0;
  working = working.map((row) => {
    const { line, gained } = mergeLine(row);
    scoreGained += gained;
    return line;
  });

  if (direction === "right" || direction === "down") working = reverseRows(working);
  if (direction === "up" || direction === "down") working = transpose(working);

  return { grid: working, moved: !gridsEqual(grid, working), scoreGained };
}

export const DIRECTIONS: Direction[] = ["left", "right", "up", "down"];

/** Full board, and no direction changes anything — true game over, not merely "no tiles left to
 *  spawn" (an empty board trivially has no direction that "moves" anything either, but it is the
 *  opposite of over). */
export function isGameOver(grid: Grid): boolean {
  return emptyCells(grid).length === 0 && DIRECTIONS.every((d) => !move(grid, d).moved);
}

export function hasReached(grid: Grid, target: number): boolean {
  return grid.some((row) => row.some((v) => v >= target));
}

export const WIN_VALUE = 2048;

/** A fresh board: two tiles, the only state a new game ever starts from. */
export function newGame(rng: () => number = Math.random): Grid {
  let grid = addRandomTile(emptyGrid(), rng);
  grid = addRandomTile(grid, rng);
  return grid;
}
