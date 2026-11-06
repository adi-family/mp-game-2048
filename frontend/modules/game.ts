// 2048 — the panel. All rules live in ./.logic.ts (unit-tested, no DOM); everything here is
// rendering, input and persistence: drawing the board, animating a move, keyboard/WASD/touch
// input, best score in localStorage, and the win/game-over banners.

import {
  SIZE,
  WIN_VALUE,
  addRandomTile,
  hasReached,
  isGameOver,
  move,
  newGame,
  type Direction,
  type Grid,
} from "./.logic.js";

interface Ctx {
  dashboard: string;
  api: { base: string | null; get(path: string): Promise<unknown> };
  panel(title?: string): HTMLElement;
}

const BEST_KEY = "adi.game2048.best";
const SLIDE_MS = 120;

const TILE_COLORS: Record<number, { bg: string; fg: string }> = {
  2: { bg: "#EEE4DA", fg: "#6F6C67" },
  4: { bg: "#EDE0C8", fg: "#6F6C67" },
  8: { bg: "#F2B179", fg: "#FBFAF8" },
  16: { bg: "#F59563", fg: "#FBFAF8" },
  32: { bg: "#F67C5F", fg: "#FBFAF8" },
  64: { bg: "#F65E3B", fg: "#FBFAF8" },
  128: { bg: "#EDCF72", fg: "#FBFAF8" },
  256: { bg: "#EDCC61", fg: "#FBFAF8" },
  512: { bg: "#EDC850", fg: "#FBFAF8" },
  1024: { bg: "#EDC53F", fg: "#FBFAF8" },
  2048: { bg: "#E8532A", fg: "#FBFAF8" },
};
const SUPER_TILE = { bg: "#3C3A32", fg: "#FBFAF8" };

function tileColor(value: number) {
  return TILE_COLORS[value] ?? SUPER_TILE;
}

function fontSizeFor(value: number): string {
  return value >= 1024 ? "0.62em" : value >= 128 ? "0.8em" : "1em";
}

function loadBest(): number {
  const raw = Number(localStorage.getItem(BEST_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function saveBest(value: number) {
  localStorage.setItem(BEST_KEY, String(value));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let idCounter = 0;
function nextId(): number {
  return ++idCounter;
}

/** One tile as the board tracks it for rendering — an id so a move can slide the same DOM
 *  element instead of redrawing from scratch. `./.logic.ts`'s plain number grid has no need to
 *  carry this; it is purely a rendering concern. */
interface Tile {
  id: number;
  value: number;
  r: number;
  c: number;
}

interface TileMove {
  id: number;
  toR: number;
  toC: number;
}

interface MoveOutcome {
  moved: boolean;
  scoreGained: number;
  moves: TileMove[];
  survivors: Tile[];
  mergedIds: Set<number>;
  consumedIds: Set<number>;
}

/**
 * The same compress-then-merge rule as `./.logic.ts`'s `mergeLine`, applied to tile *objects*
 * instead of plain numbers, line by line, so the renderer knows not just the resulting values but
 * which tile slides where and which pair disappears into a freshly minted merged tile. Built on
 * the identical single left-to-right pass `mergeLine` uses — a run of three equal tiles merges
 * only the first pair, four merge as two pairs — so this can never disagree with the tested logic
 * about *which* values come out the far end, only add *where* each one visually came from.
 */
function computeMove(tiles: Tile[], direction: Direction): MoveOutcome {
  const lineOf = (r: number, c: number) => (direction === "left" || direction === "right" ? r : c);
  const orderIndex = (r: number, c: number) => {
    if (direction === "left") return c;
    if (direction === "right") return SIZE - 1 - c;
    if (direction === "up") return r;
    return SIZE - 1 - r;
  };
  const slotPosition = (line: number, slot: number): [number, number] => {
    const pos = direction === "right" || direction === "down" ? SIZE - 1 - slot : slot;
    return direction === "left" || direction === "right" ? [line, pos] : [pos, line];
  };

  const byLine = new Map<number, Tile[]>();
  for (const tile of tiles) {
    const key = lineOf(tile.r, tile.c);
    const list = byLine.get(key) ?? [];
    list.push(tile);
    byLine.set(key, list);
  }

  const moves: TileMove[] = [];
  const survivors: Tile[] = [];
  const mergedIds = new Set<number>();
  const consumedIds = new Set<number>();
  let scoreGained = 0;

  for (let line = 0; line < SIZE; line++) {
    const ordered = (byLine.get(line) ?? [])
      .slice()
      .sort((a, b) => orderIndex(a.r, a.c) - orderIndex(b.r, b.c));

    let slot = 0;
    let i = 0;
    while (i < ordered.length) {
      const cur = ordered[i];
      const nxt = ordered[i + 1];
      const [toR, toC] = slotPosition(line, slot);
      if (nxt && cur.value === nxt.value) {
        moves.push({ id: cur.id, toR, toC });
        moves.push({ id: nxt.id, toR, toC });
        consumedIds.add(cur.id);
        consumedIds.add(nxt.id);
        const merged: Tile = { id: nextId(), value: cur.value * 2, r: toR, c: toC };
        mergedIds.add(merged.id);
        survivors.push(merged);
        scoreGained += merged.value;
        i += 2;
      } else {
        moves.push({ id: cur.id, toR, toC });
        survivors.push({ id: cur.id, value: cur.value, r: toR, c: toC });
        i += 1;
      }
      slot += 1;
    }
  }

  const moved = moves.some((m) => tiles.some((t) => t.id === m.id && (t.r !== m.toR || t.c !== m.toC)));
  return { moved, scoreGained, moves, survivors, mergedIds, consumedIds };
}

export default async function game2048(ctx: Ctx) {
  const root = ctx.panel("2048");
  root.classList.add("g2048");
  injectStyles();

  root.innerHTML = `
    <div class="g2048__head">
      <div class="g2048__scores">
        <div class="g2048__score"><span>score</span><strong data-score>0</strong></div>
        <div class="g2048__score"><span>best</span><strong data-best>0</strong></div>
      </div>
      <button type="button" class="g2048__new" data-new>New game</button>
    </div>
    <p class="g2048__hint">Arrows or WASD to move. Swipe on touch.</p>
    <div class="g2048__stage">
      <div class="g2048__grid" data-grid></div>
      <div class="g2048__tiles" data-tiles></div>
      <div class="g2048__overlay" data-overlay hidden>
        <div class="g2048__overlay-card">
          <p data-overlay-text></p>
          <div class="g2048__overlay-actions">
            <button type="button" data-keep-going hidden>Keep going</button>
            <button type="button" data-try-again>New game</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const scoreEl = root.querySelector<HTMLElement>("[data-score]")!;
  const bestEl = root.querySelector<HTMLElement>("[data-best]")!;
  const gridEl = root.querySelector<HTMLElement>("[data-grid]")!;
  const tilesEl = root.querySelector<HTMLElement>("[data-tiles]")!;
  const stageEl = root.querySelector<HTMLElement>(".g2048__stage")!;
  const overlayEl = root.querySelector<HTMLElement>("[data-overlay]")!;
  const overlayTextEl = root.querySelector<HTMLElement>("[data-overlay-text]")!;
  const keepGoingBtn = root.querySelector<HTMLButtonElement>("[data-keep-going]")!;

  for (let i = 0; i < SIZE * SIZE; i++) {
    gridEl.append(Object.assign(document.createElement("div"), { className: "g2048__cell" }));
  }

  let grid: Grid;
  let tiles: Tile[] = [];
  const els = new Map<number, HTMLElement>();
  let score = 0;
  let best = loadBest();
  let won = false;
  let keepGoing = false;
  let over = false;
  let busy = false;

  bestEl.textContent = String(best);

  function positionEl(el: HTMLElement, tile: { r: number; c: number }) {
    el.style.setProperty("--x", String(tile.c));
    el.style.setProperty("--y", String(tile.r));
  }

  function createTileEl(tile: Tile): HTMLElement {
    const el = document.createElement("div");
    el.className = "g2048__tile";
    const { bg, fg } = tileColor(tile.value);
    el.style.setProperty("--bg", bg);
    el.style.setProperty("--fg", fg);
    el.style.fontSize = fontSizeFor(tile.value);
    el.textContent = String(tile.value);
    positionEl(el, tile);
    return el;
  }

  function tilesFromGrid(g: Grid): Tile[] {
    const result: Tile[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (g[r][c] !== 0) result.push({ id: nextId(), value: g[r][c], r, c });
      }
    }
    return result;
  }

  function spawnOne(before: Grid): { grid: Grid; tile: Tile | null } {
    const next = addRandomTile(before);
    if (next === before) return { grid: next, tile: null };
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (before[r][c] === 0 && next[r][c] !== 0) {
          return { grid: next, tile: { id: nextId(), value: next[r][c], r, c } };
        }
      }
    }
    return { grid: next, tile: null };
  }

  function start() {
    tilesEl.innerHTML = "";
    els.clear();
    grid = newGame();
    tiles = tilesFromGrid(grid);
    for (const tile of tiles) {
      const el = createTileEl(tile);
      el.classList.add("g2048__tile--spawn");
      tilesEl.append(el);
      els.set(tile.id, el);
    }
    score = 0;
    won = false;
    keepGoing = false;
    over = false;
    overlayEl.hidden = true;
    scoreEl.textContent = "0";
  }

  function showOverlay(text: string, offerKeepGoing: boolean) {
    overlayTextEl.textContent = text;
    keepGoingBtn.hidden = !offerKeepGoing;
    overlayEl.hidden = false;
  }

  async function doMove(direction: Direction) {
    if (busy || over || (won && !keepGoing)) return;
    const outcome = computeMove(tiles, direction);
    if (!outcome.moved) return;
    busy = true;

    for (const m of outcome.moves) {
      const el = els.get(m.id);
      if (el) positionEl(el, { r: m.toR, c: m.toC });
    }

    score += outcome.scoreGained;
    scoreEl.textContent = String(score);
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      saveBest(best);
    }
    grid = move(grid, direction).grid;

    await wait(SLIDE_MS);

    for (const id of outcome.consumedIds) {
      els.get(id)?.remove();
      els.delete(id);
    }
    for (const tile of outcome.survivors) {
      if (!outcome.mergedIds.has(tile.id)) continue;
      const el = createTileEl(tile);
      el.classList.add("g2048__tile--merged");
      tilesEl.append(el);
      els.set(tile.id, el);
    }
    tiles = outcome.survivors;

    const spawned = spawnOne(grid);
    grid = spawned.grid;
    if (spawned.tile) {
      const el = createTileEl(spawned.tile);
      el.classList.add("g2048__tile--spawn");
      tilesEl.append(el);
      els.set(spawned.tile.id, el);
      tiles.push(spawned.tile);
    }

    if (!won && hasReached(grid, WIN_VALUE)) {
      won = true;
      showOverlay("You reached 2048!", true);
    } else if (isGameOver(grid)) {
      over = true;
      showOverlay("Game over", false);
    }

    busy = false;
  }

  const KEY_DIRECTIONS: Record<string, Direction> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    a: "left",
    d: "right",
    w: "up",
    s: "down",
  };

  function isTyping(): boolean {
    const el = document.activeElement as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  }

  function onKeydown(ev: KeyboardEvent) {
    if (!root.isConnected) return;
    if (isTyping()) return;
    const direction = KEY_DIRECTIONS[ev.key.length === 1 ? ev.key.toLowerCase() : ev.key];
    if (!direction) return;
    ev.preventDefault();
    void doMove(direction);
  }

  let touchStart: { x: number; y: number } | null = null;
  function onTouchStart(ev: TouchEvent) {
    const t = ev.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(ev: TouchEvent) {
    if (!touchStart) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    const SWIPE_MIN = 24;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    const direction: Direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    void doMove(direction);
  }

  window.addEventListener("keydown", onKeydown);
  stageEl.addEventListener("touchstart", onTouchStart as EventListener, { passive: true });
  stageEl.addEventListener("touchend", onTouchEnd as EventListener);

  root.querySelector("[data-new]")!.addEventListener("click", start);
  root.querySelector("[data-try-again]")!.addEventListener("click", start);
  keepGoingBtn.addEventListener("click", () => {
    keepGoing = true;
    overlayEl.hidden = true;
  });

  start();
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .g2048 { --cell-gap: 10px; }
    .g2048__head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-bottom: 4px;
    }
    .g2048__scores { display: flex; gap: 10px; }
    .g2048__score {
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      min-width: 64px; padding: 6px 10px; border-radius: var(--r, 6px);
      background: var(--bg-raise, #1E1E1E); border: 1px solid var(--line, rgba(255,255,255,.07));
    }
    .g2048__score span {
      font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
      color: var(--ink-3, #6F6C67);
    }
    .g2048__score strong {
      font: 600 16px var(--mono, ui-monospace, monospace); color: var(--ink, #ECEAE6);
      font-variant-numeric: tabular-nums;
    }
    .g2048__new {
      border: 1px solid var(--line-strong, rgba(255,255,255,.13)); background: var(--bg-raise, #1E1E1E);
      color: var(--ink, #ECEAE6); border-radius: var(--r, 6px); padding: 8px 14px;
      font: 500 13.5px var(--sans, system-ui, sans-serif); cursor: pointer;
    }
    .g2048__new:hover { background: var(--bg-active, #232323); }
    .g2048__hint { margin: 0 0 12px; color: var(--ink-3, #6F6C67); font-size: 12.5px; }
    .g2048__stage {
      position: relative; width: 100%; max-width: 420px; aspect-ratio: 1 / 1;
      margin: 0 auto; touch-action: none; user-select: none;
    }
    .g2048__grid {
      position: absolute; inset: 0; display: grid;
      grid-template-columns: repeat(${SIZE}, 1fr); grid-template-rows: repeat(${SIZE}, 1fr);
      gap: var(--cell-gap); padding: var(--cell-gap);
      background: var(--bg-side, #101010); border-radius: 10px;
    }
    .g2048__cell { background: var(--bg-hover, #1B1B1B); border-radius: 6px; }
    .g2048__tiles { position: absolute; inset: 0; padding: var(--cell-gap); pointer-events: none; }
    .g2048__tile {
      position: absolute;
      width: calc((100% - var(--cell-gap)) / ${SIZE} - var(--cell-gap));
      height: calc((100% - var(--cell-gap)) / ${SIZE} - var(--cell-gap));
      left: calc(var(--x) * (100% - var(--cell-gap)) / ${SIZE} + var(--cell-gap));
      top: calc(var(--y) * (100% - var(--cell-gap)) / ${SIZE} + var(--cell-gap));
      display: flex; align-items: center; justify-content: center;
      border-radius: 6px; font: 700 1.6em/1 var(--sans, system-ui, sans-serif);
      background: var(--bg); color: var(--fg);
      transition: left 120ms ease-in-out, top 120ms ease-in-out;
    }
    @keyframes g2048-spawn { from { transform: scale(0); } to { transform: scale(1); } }
    @keyframes g2048-merge { 0% { transform: scale(1); } 50% { transform: scale(1.18); } 100% { transform: scale(1); } }
    .g2048__tile--spawn { animation: g2048-spawn 140ms ease-out; }
    .g2048__tile--merged { animation: g2048-merge 140ms ease-out; }
    .g2048__overlay {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--bg-side, #101010) 72%, transparent);
      border-radius: 10px;
    }
    .g2048__overlay-card { text-align: center; }
    .g2048__overlay-card p {
      margin: 0 0 14px; font: 600 20px var(--sans, system-ui, sans-serif); color: var(--ink, #ECEAE6);
    }
    .g2048__overlay-actions { display: flex; gap: 8px; justify-content: center; }
    .g2048__overlay-actions button {
      border: 1px solid var(--line-strong, rgba(255,255,255,.13)); background: var(--accent, #E8532A);
      color: #fff; border-radius: var(--r, 6px); padding: 8px 14px; cursor: pointer;
      font: 500 13.5px var(--sans, system-ui, sans-serif);
    }
    .g2048__overlay-actions button[data-try-again] { background: var(--bg-raise, #1E1E1E); color: var(--ink, #ECEAE6); }
  `;
  document.head.append(style);
}
