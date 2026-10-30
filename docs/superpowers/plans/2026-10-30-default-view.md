# The Default View Made by the Mod: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The gallery's Default view drawn by the mod with Gallery's bar, filters, sorts and tiles, laid out as the sim's grid: two rows of large tiles scrolling horizontally, whole columns aligned on the bar.

**Architecture:** The view keeps its stored name `stock`. `render()` stops treating it as "the sim's grid": it builds tiles as for Gallery (the sim's `TileButton_Fleet`, the same pool, the same rules of `tiles.ts`), grouped in column hosts of two tiles inside a `real-scroll` with `direction="x"`. The pure geometry (columns, tile size, settling on a column) lives in a new `default-grid.ts`; `core/virtual-list.ts` is reused along the x axis by passing `{ top: left, bottom: right }` extents.

**Tech Stack:** TypeScript (ES2017), the sim's Coherent GT components, node:test.

**Spec:** `docs/superpowers/specs/2026-10-30-default-view-design.md`

## Global Constraints

- The project's rules (CLAUDE.md): the sim's own components (`TileButton_Fleet`, `real-scroll`); a recycling pool of tiles, never every tile alive; the 250 ms layout passes write only on change (`setVariable`, `setStyle`); `inputLocker` on what is clickable; ES2017; every change through a `Scope`; any new sim reference declared in `compat.json`.
- The sim's grid, measured at 3440 × 1440 (2026-10-30): tile 480 × 426 pixels = **360 units** wide, image **229 / 480** of the tile's width, gap **24 units**, two rows, horizontal scrolling.
- A text banner never shorter than its three lines: **75 units** (`BANNER_HEIGHT` of `gallery.ts`); otherwise one more column.
- Bar: Gallery's one-line bar (36 units high, 12 units above the grid). Grid bottom (with its scroll bar) on the right block's bottom.
- No cut tile at rest; the bar's left and right edges on the first and last visible columns' edges, to the pixel.
- English everywhere; one commit per task; never push.

## Review Focus

1. Fewer tiles than the visible columns (a search, the Hidden or Favorites view): no scroll bar, tiles from the left, the bar keeps the grid's width — Task 2 measures it in the sim.
2. An odd number of tiles: the last column has its top tile only, the bottom cell empty — `columnOf` test in Task 1.
3. A short screen (1080 lines) or a narrow one: the banner under 75 units takes one more column — `defaultGrid` test in Task 1.
4. A scroll position between two columns (wheel, drag, `maxScroll` not a multiple of the step) settles on the nearest whole column within `[0, maxScroll]` — `settleColumn` test in Task 1.
5. Switching from Default to Gallery or List and back: the list's axis changes, the pool and the selection reveal follow — Task 2 measures it in the sim.

---

### Task 1: The grid's geometry

**Files:**
- Create: `mod/src/features/aircraft-gallery/default-grid.ts`
- Test: `mod/test/default-grid.test.ts`

**Interfaces:**
- Produces:
  - `defaultGrid(width: number, height: number, unit: number): { columns: number; tileWidth: number; tileHeight: number; imageHeight: number; gap: number; gridWidth: number }` — `width`, `height`: the room for the two rows (pixels); `gap = Math.round(24 * unit)`; `columns` nearest `(width + gap) / (360 * unit + gap)`, at least 1, plus one while the banner (`tileHeight - imageHeight`) is under `75 * unit`; `tileWidth = Math.floor((width - (columns - 1) * gap) / columns)`; `tileHeight = Math.floor((height - gap) / 2)`; `imageHeight = Math.round(tileWidth * 229 / 480)`; `gridWidth = columns * tileWidth + (columns - 1) * gap` (at most `columns - 1` pixels short of `width`: every column the same width, the bar takes `gridWidth`).
  - `settleColumn(position: number, step: number, max: number): number` — the multiple of `step` nearest `position`, clamped to `[0, max]`; `max` itself when it is nearer than the last multiple.
  - `columnOf(index: number): { column: number; row: 0 | 1 }` — column-major as the sim's grid (index 0 and 1 in column 0).

- [ ] **Step 1: Write the failing tests** (`describe('default grid')`)
  - `defaultGrid(1614, 854, 1440 / 1080)` → `{ columns: 3, gap: 32, tileWidth: 516, gridWidth: 1612, tileHeight: 411, imageHeight: 246 }` (the owner's screen; banner 165 px ≥ 100).
  - `defaultGrid(1210, 600, 1)` → banner rule: with 3 columns `tileWidth` 387, `imageHeight` 185, `tileHeight` 288, banner 103 ≥ 75 → `columns: 3`; and `defaultGrid(1210, 420, 1)` → `tileHeight` 198, banner 13 < 75 → more columns until the banner fits (assert `tileHeight - imageHeight >= 75` and `columns > 3`).
  - `defaultGrid(300, 854, 1440 / 1080).columns === 1`.
  - `settleColumn(0, 548, 3000) === 0`; `settleColumn(300, 548, 3000) === 548`; `settleColumn(260, 548, 3000) === 0`; `settleColumn(2990, 548, 3000) === 3000`; `settleColumn(-20, 548, 3000) === 0`.
  - `columnOf(0)` → `{ column: 0, row: 0 }`, `columnOf(1)` → `{ column: 0, row: 1 }`, `columnOf(4)` → `{ column: 2, row: 0 }`.

- [ ] **Step 2:** `cd mod; npm run check` → the new tests fail (module missing).
- [ ] **Step 3:** Implement the three functions in `default-grid.ts` (head comment: what the sim's grid measures, the spec).
- [ ] **Step 4:** `npm run check` → all pass.
- [ ] **Step 5:** Commit `Gallery: the Default grid's geometry`.

### Task 2: Default drawn by the mod

**Files:**
- Modify: `mod/src/features/aircraft-gallery/gallery.ts` (render, layout, materialize, scroll, filters, list creation)
- Modify: `mod/src/features/aircraft-gallery/aircraft-gallery.css` (the `is-stock` rules)
- Modify: `mod/src/features/aircraft-gallery/livery-column.ts`, `mod/test/aircraft-gallery.test.ts` (remove `stockFiltersFit` and its test)
- Modify: `mod/compat.json` only if a new sim reference appears

**Interfaces:**
- Consumes: Task 1's `defaultGrid`, `settleColumn`, `columnOf`; `cellAction` of `core/virtual-list.ts` with `{ top: rect.left, bottom: rect.right }` extents along x.
- Produces: in the Default view, `.msfs-ui-gal__body.is-grid` holding a `real-scroll[direction="x"]` whose content is a row of `.msfs-ui-gal__column` hosts, each holding up to two `.msfs-ui-gal__tile` hosts (cells, as Gallery's).

- [ ] **Step 1: Render.** Remove the `stock` early return of `render()`: Default computes `tiles` as Gallery, builds one column host per two cells (`columnOf`), cells as Gallery's (`fleetTile`, `fillCell(cell, true)`, the eye, veil, bookmark, hover, click). `fillCell` / `createSlot` take "tile" for `view !== 'list'`. The pool is shared with Gallery's kind of tile when the view changes between the two (*ruling*: one pool per kind of component, not per view).
- [ ] **Step 2: The list's axis.** The list is a `real-scroll` created for an axis: `direction="x"` in Default, `"y"` otherwise; a change of axis replaces it (the old one removed with its content, the pool's slots parked first). `scrollTo`, `scrollToSelected` and `materialize` use the axis: along x, `left`/`right` and the column's position; `scrollToSelected` settles on the selected tile's column.
- [ ] **Step 3: Layout.** In Default: the root covers the whole right block (not the header only); the sim's grid and search hidden as in Gallery (`showStockGrid(false)`; the sim's grid refreshed and shown again when the mod unloads); no livery column (`placeLiveries(null)`); `defaultGrid(right block width, right block height - 36u - 12u - GRID_SCROLL_ROOM, unit)` with `GRID_SCROLL_ROOM` measured (the bar's thickness and its gap; start from 24 units); `setVariable` for `--grid-tile-w`, `--grid-tile-h`, `--grid-image-h`, `--grid-gap`; the bar and the list `gridWidth` wide from the block's left edge (`setStyle`).
- [ ] **Step 4: CSS.** Replace the `is-stock` block: the bar on one line as Gallery's; `.is-grid .scroll__content` a row (`display: flex; flex-direction: row; align-items: flex-start`, no padding); `.msfs-ui-gal__column` a column of two tiles, `margin-right: var(--grid-gap)` except the last; the tiles `--grid-tile-w` × `--grid-tile-h`, `--grid-gap` between the two rows, the image block `--grid-image-h`; the sim's horizontal `scroll__bar-container` from the grid's left edge to its right one, its bottom on the block's bottom (measure, then set).
- [ ] **Step 5: Filters in place.** `setFilter` toggles in Default as elsewhere; `renderBar` selects the filters in Default too; `lastView` no longer written (field removed from `GalleryMemory`; a stored one ignored); remove `stockFiltersFit`, `STOCK_FILTERS_WIDTH`, `is-cramped` and their test.
- [ ] **Step 6: Tests.** `npm run check` → all pass; `dotnet build generator/MsfsUi.slnx` (warnings are errors).
- [ ] **Step 7: Measure in the sim** (`msfs-ui-dev install`, `reload`, the Default view; scratchpad probes): bar left = first column's left, bar right = last visible column's right, both within 0 px; no tile cut at `currentScroll` 0; the second row's bottom + scroll bar ≤ block bottom (1269 at 1440 lines), bar bottom on it; `document.querySelectorAll('.msfs-ui-gal__tile [name="Content"]')` ≈ visible tiles + margins (the pool keeps few); Review Focus 1 and 5 (a search leaving two tiles; Default → List → Default with the selection revealed). Then the owner's screenshot.
- [ ] **Step 8:** Commit `Gallery: Default drawn by the mod, the sim's grid layout`.

### Task 3: Whole columns at rest, docs

**Files:**
- Modify: `mod/src/features/aircraft-gallery/gallery.ts` (settling)
- Modify: `docs/user-guide.md`, `mod/README.md`, `docs/next-steps.md` (1c, 1d), `CHANGELOG.md` (2.0.1), `docs/sim-reference.md` (the horizontal `real-scroll` measures)

**Interfaces:**
- Consumes: Task 1's `settleColumn`; Task 2's x list.

- [ ] **Step 1: Measure the wheel** on the x list in the sim (the owner scrolls one notch; `currentScroll` before and after) and the drag of its bar.
- [ ] **Step 2: Settle.** In Default, `ui-scroll` events restart a 150 ms timer (`scope.timeout`); when it fires, `scrollToPosition(settleColumn(currentScroll, tileWidth + gap, maxScroll))` when different. If one notch moves less than a column, the wheel step is set to one column (`*ruling*` from Step 1's measure, recorded in the ledger).
- [ ] **Step 3:** `npm run check`; measure in the sim: after a wheel notch and after a drag, `currentScroll` a multiple of the step (or `maxScroll`), the first visible column's left on the grid's left.
- [ ] **Step 4: Docs.** User guide (Default: the mod's view, the sim's layout), `mod/README.md` (the Default grid, `default-grid.ts`, the gallery memory without `lastView`), next-steps (1d done, replaced by this; 1c (3) superseded), CHANGELOG 2.0.1 (the Default view line replaces "Hidden and Favorites in the Default view"), sim-reference (the horizontal `real-scroll`: works, its bar inset by default).
- [ ] **Step 5:** Commit `Gallery: Default settles on whole columns; docs`.
