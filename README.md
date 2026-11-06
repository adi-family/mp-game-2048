# 2048

The classic 2048, as one dashboard — a 4×4 sliding-tile puzzle with real slide/merge animations,
a best score that survives a reload, and nothing on the backend: every rule lives in the browser.

This bundle carries one element:

| kind | name | what it is |
|---|---|---|
| dashboard | `game-2048` | the game itself — frontend only, a one-route backend stub for the dashboard contract |

Install it:

```sh
adi-mono marketplace install <marketplace>/game-2048
```

It arrives archived, same as every dashboard — start it from the Dashboards page, or:

```sh
adi-mono marketplace start <marketplace>/game-2048/dashboards/game-2048
```

Then open it by its hostname. No secret, no project, nothing else to configure.

## Why no backend logic

2048's entire rulebook — sliding, merging, spawning, win/lose detection — runs client-side; there
is nothing for a server to compute or to keep private. The backend half of this dashboard exists
only because the dashboard contract (`guides/dashboards.md`) needs one: it is the template's
own unmodified `backend/index.ts`, answering `/api/health` so the page's status dot has something
to poll, and nothing more. No route file was added.

## How it's built

`frontend/modules/game.ts` is the panel; `frontend/modules/.logic.ts` is the whole rulebook —
pure functions over a plain 4×4 number grid, no DOM, no randomness that isn't passed in as an
argument. The dot in its name keeps it off the shell's auto-mounted panel list (`guides/
dashboards.md`'s module discovery lists every `modules/*.ts` that doesn't start with `.`); the
panel reaches it at runtime as a same-origin `./.logic.js` import, which the frontend server
resolves straight back to this file.

The rules:

- **merge once per move**: scanned left-to-right (or the equivalent for the direction moved), a
  tile that has already merged this move never merges again — `[2,2,2,0]` slides to `[4,2,0,0]`,
  not `[4,4,0,0]`; `[2,2,2,2]` merges as two separate pairs, `[4,4,0,0]`.
- **spawn**: after every move that actually changes the board, one new tile lands on a random
  empty cell — 2 nine times out of ten, 4 the rest.
- **win**: reaching 2048 offers *Keep going* as well as *New game* — the board keeps playing, and
  nothing about reaching 2048 a second time re-fires the banner.
- **game over**: every one of the four directions is checked against the current board; only when
  none of them would change anything is it actually over, not merely "no empty cell left" (a full
  board that can still merge is not over).

`frontend/modules/game.ts` renders this onto a board of real DOM tiles kept alive across moves —
a tile that slides keeps its element and just gets new `--x`/`--y` custom properties (a CSS
`transition` on `left`/`top` does the sliding); a tile consumed by a merge is removed once the
slide finishes and a freshly minted tile appears at the destination with a short "pop" animation;
a spawned tile gets a "scale in" animation. The board is drawn as CSS percentages off one `SIZE`
constant, so it holds together at any panel width, and the same palette is used in light and dark
(the template's own ADI tokens already cover both — see `[data-theme="light"]` in `frontend/
index.html`).

Input: `ArrowLeft/Right/Up/Down` and `a`/`d`/`w`/`s` (case-insensitive, ignored while any text
input or textarea elsewhere on the page has focus), plus a touch swipe (24px minimum, whichever
axis moved further wins ties). Best score is `localStorage["adi.game2048.best"]`, scoped to the
browser, not the backend — there is nothing server-side to lose it with.

## Checking it works

```sh
bun test test/game-logic.test.ts
```

19 checks against `frontend/modules/.logic.ts` directly — no DOM, no server: every merge shape
(`mergeLine`), all four directions (`move`), the spawn distribution with an injected `rng`
(`addRandomTile`, `randomTileValue`), and game-over detection against both a mid-game and a
fully-deadlocked board (`isGameOver`).

A second, optional check covers what the logic tests structurally can't: whether the win/game-over
overlay is actually invisible when it should be. `.g2048__overlay` sets `display: flex` (to centre
its card), and an author stylesheet rule always outranks the UA's own `[hidden] { display: none }`
at equal specificity — so a missing `.g2048__overlay[hidden]` override renders the overlay (and
its "New game" button) permanently, over the board, regardless of the `hidden` attribute. Neither
`bun:test`'s DOM nor happy-dom compute CSS cascade, so this needs a real browser:

```sh
bun add -d playwright && bunx playwright install chromium   # one-time, not needed to play the game
bun test test/overlay-visibility.test.ts
```

It skips (with a warning, not a failure) if Playwright isn't installed — the dashboard itself has
no dependency on it.

## Licence

MIT.
