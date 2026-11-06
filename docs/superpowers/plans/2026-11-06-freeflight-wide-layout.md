# Free Flight on every screen width: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free Flight's two columns at the screen's edges (capped at 21:9), Departure / Arrival stretched between them, every gap of the screen 24 or 6 layout units, every alignment to the pixel.

**Architecture:** A pure function computes every place in whole pixels from the screen size; a new feature, `freeflightLayout`, writes those places into the inline styles of the sim's blocks during Free Flight's 250 ms layout pass and puts the sim's styles back through the screen's scope. The two rules on the mod's own blocks (tab row as high as *Search location*, favourites level with *Today*) change the weather bar and the favourites, whatever the new feature.

**Tech Stack:** TypeScript (ES2017), esbuild, `node:test`; the app's catalogue (`mod/features.json`) and contracts (`mod/compat.json`).

**Spec:** `docs/superpowers/specs/2026-11-06-freeflight-wide-layout-design.md` (read its *What the sim does* table first).

## Global Constraints

- Layout unit `u` = `uiUnit()` (`core/dom.ts`), px per unit; a length of N units is `Math.floor(N * u)` px, as the mod's other gaps.
- Group gap 24 units (`GROUP_GAP`, `sim/freeflight-layout.ts`); inside a group 6 units (`GAP`, `weather-bar/bar-layout.ts`).
- Layout width capped at 2580 units (21:9 at 1080 units high), centred beyond.
- The sim's blocks keep their own sizes, except `MainBlock`'s width and the `Buttons` block's height.
- Every write through `setStyle` / `setVariable` (`core/dom.ts`): only on change.
- Every sim style changed is put back by the scope; the profile bar (`MenuBar`) changed only while Free Flight is shown.
- Every new sim name in `compat.json` "anchors"; the style formats the code relies on in "componentPatterns".
- English everywhere in the repository; one commit per task, after the owner's go-ahead on the task's result.

## Review Focus

- A change of resolution or window size while Free Flight is shown: the next pass (≤ 250 ms) puts every block at its new place (Task 5 measures it).
- An odd screen width (2161 × 1164): edges still whole pixels, `MainBlock` symmetric (`places` test in Task 1).
- The sim's Airport / Traffic card and the map buttons' panels opening after the move: at the right column (Task 3 moves every block anchored on the frame's edge, Task 5 opens them).
- Leaving Free Flight for another screen: the profile bar back at the sim's place on that screen (Task 4, measured in Task 5).
- The feature turned off in the app: every sim block back where the sim puts it, the mod's own rules kept (Task 5).

---

### Task 1: The places, as a pure function

**Files:**
- Create: `mod/src/features/freeflight-layout/places.ts`
- Test: `mod/test/freeflight-layout.test.ts`

**Interfaces:**
- Produces:
  - `MAX_LAYOUT_UNITS = 2580`
  - `interface PlaceInput { width: number; height: number; unit: number; menuHeight: number; mainHeight: number; efbHeight: number; flyHeight: number }` (screen in px, `unit` px per unit, the sim blocks' own heights in px as drawn)
  - `interface Places { left: number; right: number; columnWidth: number; planInset: number; menuTop: number; mainTop: number; searchTop: number; buttonsBottom: number; buttonsHeight: number; filtersBottom: number }` (whole px from the screen's left / top edge; `right` is the right column's right edge; `columnWidth` = `Math.floor(440 * unit)`; `planInset` = `columnWidth + g` for `FreeFlight_Plan`'s `left` and `right` inside `MainBlock`)
  - `function freeflightPlaces(input: PlaceInput): Places`

- [ ] **Step 1: Write the failing tests** (`describe('freeflightPlaces')`), with g = `Math.floor(24 * u)`, s unused here:
  - 3440 × 1440 (u = 4/3, g = 32): `left === 32`, `right === 3408`, `columnWidth === 586`, `planInset === 618`, `menuTop === 32`, `mainTop === 32 + 66 + 32` (menuHeight 66), `searchTop === mainTop + 253 + 32` (mainHeight 253), `buttonsBottom === 1440 - 32`, `buttonsHeight === 66 + 32 + 66`, `filtersBottom === buttonsBottom - buttonsHeight - 32`.
  - 1920 × 1080 (u = 1, g = 24): `left === 24`, `right === 1896`.
  - 5120 × 1440 (cap: 2580 units = 3440 px): `left === 840 + 32`, `right === 840 + 3440 - 32`.
  - 2161 × 1164 (odd width): `left` and `right` integers, `(right - left) % 2 === 0`, and `left - 0` equals `2161 - right` within 1 px.
  - every field is an integer for the four sizes.
- [ ] **Step 2: Run `npm test` in `mod/`**; expected: FAIL, module not found.
- [ ] **Step 3: Implement `freeflightPlaces`.** Layout width `Math.min(width, Math.floor(MAX_LAYOUT_UNITS * unit))`; content width `2 * Math.floor((layoutWidth - 2 * g) / 2)` (even, so `MainBlock`'s −50 % pivot lands on a whole pixel); `left = Math.round((width - content) / 2)`, `right = left + content`.
- [ ] **Step 4: Run `npm test`**; expected: PASS.
- [ ] **Step 5: Commit** `Free Flight layout: the places, as a pure function`.

### Task 2: The mod's own blocks on the two rules

**Files:**
- Modify: `mod/src/sim/freeflight-layout.ts` (add `SEARCH_ROW = 30`: *Search location*'s height in units, the sim's `Searchblock`)
- Modify: `mod/src/features/weather-bar/right-column.ts` (`TAB_ROW` → the row `Math.floor(SEARCH_ROW * u)` px high, written in the layout pass)
- Modify: `mod/src/features/weather-bar/weather-bar.css` (`.msfs-ui-wx-tabs`: no padding; `.msfs-ui-wx-tabs__tab`: height 100 %)
- Modify: `mod/src/features/weather-bar/bar.ts` (`layout()`), `mod/src/features/freeflight-favorites/panel.ts` (`layout()`)
- Test: `mod/test/freeflight-layout.test.ts`

**Interfaces:**
- Produces, in `mod/src/sim/freeflight-layout.ts`: `function underSearchTop(anchorBottom: number, unit: number): number` = `anchorBottom + Math.floor(GROUP_GAP * unit) + Math.floor(SEARCH_ROW * unit) + Math.floor(GAP * unit)`, the top of the favourites under the aircraft button and of *Today* under the widget (one function for both columns).

- [ ] **Step 1: Failing test**: `underSearchTop(373, 4 / 3) === 373 + 32 + 40 + 8`; `underSearchTop(280, 1) === 280 + 24 + 30 + 6`.
- [ ] **Step 2: `npm test`**: FAIL.
- [ ] **Step 3: Implement** `underSearchTop`; in `bar.ts` the bar's `top` = `underSearchTop(rect.bottom, unit) - origin.top` when the tabs show (the tab row `Math.floor(SEARCH_ROW * u)` px, its buttons filling it); in `panel.ts` the favourites' `top` = `underSearchTop(button.bottom, unit) - origin.top` whether the sim shows *Search location* or not (the spec's call: fixed place), `BOTTOM_ROOM` unchanged.
- [ ] **Step 4: `npm run check`**: PASS (contracts, tsc, tests).
- [ ] **Step 5: Install and reload** (`msfs-ui-dev install`, `reload`); measure with `getBoundingClientRect` at 3440 × 1440: tabs row top = `Searchblock` top and same height (40 px); favourites top = *Today* top (with at least one favourite livery); tab labels whole. Owner's screenshot of the tab row (the buttons now fill the row: a visible change).
- [ ] **Step 6: Commit** `Free Flight: the tab row as high as Search location, the favourites level with Today`.

### Task 3: New feature `freeflightLayout`, horizontal places

**Files:**
- Modify: `mod/features.json` (new entry after `freeflightFavorites`: id `freeflightLayout`, title `Free Flight on wide screens`, description `Moves Free Flight's columns to the edges of the screen (up to a 21:9 width) and evens out the gaps between its blocks.`, screen `Free Flight`, enabled by default, no option)
- Modify: `mod/src/features.ts` (registry)
- Create: `mod/src/features/freeflight-layout/index.ts`, `mod/src/features/freeflight-layout/sim-blocks.ts`
- Modify: `mod/compat.json` (anchors `MainBlock`, `FreeFlight_Plan`, `WeatherBlock`, `FreeFlightPage`; a "componentPatterns" entry *Free Flight frame*: the edge blocks' `left` as `calc(var(--h-anchor) + calc(var(--unscaledScreenHeight) * ±940px / 1080))` and `MainBlock`'s `width: calc(var(--unscaledScreenHeight) * 1880px / 1080)`, read from the cooked component of `FreeFlightPage`)
- Fixtures: `MSFS_UI_UPDATE_FIXTURES=1 dotnet test generator/MsfsUi.slnx`

**Interfaces:**
- Consumes: `freeflightPlaces`, `Places` (Task 1).
- Produces: `class SimBlock { constructor(element: HTMLElement, scope: Scope); set(properties: Partial<Record<'left' | 'top' | 'width' | 'height' | 'right', string>>, anchors?: { h?: string; v?: string }): void }`: keeps the element's inline `style` attribute once, puts it back on dispose, writes only changed values (`setStyle`, `setVariable` for `--h-anchor` / `--v-anchor`).

- [ ] **Step 1: Failing test** for the edge rule, in `freeflight-layout.test.ts`: `function frameEdge(style: string): -1 | 0 | 1` returns −1 for `left: calc(var(--h-anchor) + calc(var(--unscaledScreenHeight) * -940px / 1080))`, 1 for `* 940px` and `* 940.0000px`, 0 for `* 446px` and for an empty style.
- [ ] **Step 2: `npm test`**: FAIL.
- [ ] **Step 3: Implement** `frameEdge` (in `sim-blocks.ts`), `SimBlock`, and the feature: `onScreenActive(SCREENS.freeFlight, …)`, a pass every 250 ms (skipped while the widget is not `isShown`): read `innerWidth`, `innerHeight`, `uiUnit()`, the heights as drawn, compute `freeflightPlaces`; each direct child of `FreeFlightPage` whose inline style has `--h-anchor: 50%` and `frameEdge` ≠ 0 gets `--h-anchor: 0%` and `left` = `places.left` (−1) or `places.right` (1), px, its pivot untouched (this catches `Searchblock`, `Worldmap_Filters`, `Buttons`, `FreeFlight_Runways`, `FreeFlight_Traffic` and any block the sim shows later); `MainBlock`: `--h-anchor: 0%`, `left` = `(left + right) / 2`, `width` = `right - left`; `FreeFlight_Plan`: `left` and `right` = `planInset`; `WeatherBlock`: `left` = `right - left - columnWidth`. Log `Free Flight laid out to the screen's edges` once.
- [ ] **Step 4: `npm run check`**, then the fixtures and `dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"`: PASS.
- [ ] **Step 5: Install, reload, measure at 3440 × 1440**: aircraft button, `Searchblock` left = 32; widget, `Worldmap_Filters`, `Buttons` right = 3408; `FreeFlight_Plan` 32 px from each column; the bar and tabs over the widget; `msfs-ui-dev check` green.
- [ ] **Step 6: Commit** `Free Flight on wide screens: the columns at the screen's edges`.

### Task 4: Vertical places and the profile bar

**Files:**
- Modify: `mod/src/features/freeflight-layout/index.ts`
- Modify: `mod/compat.json` (anchors `MenuBarPage`, `MenuBar`, `Fly`; the pattern of `MenuBar`'s `left` and `top`, of `MainBlock`'s and `Searchblock`'s `top`, of `Worldmap_Filters`' `top`)

**Interfaces:**
- Consumes: `Places`, `SimBlock` (Tasks 1, 3).

- [ ] **Step 1: Implement**: `MenuBar` (`document.querySelector('[name="MenuBarPage"] [name="MenuBar"]')`): `--h-anchor: 0%`, `left` = `right`, `--v-anchor: 0%`, `top` = `menuTop`, in the Free Flight screen scope only (put back when the screen is deactivated); `MainBlock` `--v-anchor: 0%`, `top` = `mainTop`; `Searchblock` `--v-anchor: 0%`, `top` = `searchTop`; `Buttons`: `--v-anchor: 0%`, `top` = `buttonsBottom` (pivot −100 % keeps it bottom-anchored), `height` = `buttonsHeight` (`EFB` at its top, `Fly` at its bottom); `Worldmap_Filters`: `--v-anchor: 0%`, `top` = `filtersBottom`.
- [ ] **Step 2: `npm run check`**: PASS.
- [ ] **Step 3: Install, reload, measure at 3440 × 1440**: `MenuBar` top 32, right 3408; `MainBlock` top = menu bottom + 32; `Searchblock` top = `MainBlock` bottom + 32; *Start flight* bottom 1408; *EFB* → *Start flight* 32; map buttons → *EFB* 32; open another screen (Home, aircraft selection): `MenuBar` back at the sim's place (its inline style identical to the one read before).
- [ ] **Step 4: Commit** `Free Flight on wide screens: the rows at the screen's top and bottom, the profile bar while Free Flight shows`.

### Task 5: Every resolution, every interaction

**Files:**
- Modify (only if a measure fails): the files of Tasks 1 to 4
- Modify: `docs/sim-reference.md` (Free Flight's frame and inline styles, the finding table)

- [ ] **Step 1: Measure** (`tools/resolution-check/sim-window.ps1`, `freeflight.js`) at 1920 × 1080, 2560 × 1440, 3840 × 2160, 3440 × 1440, 2560 × 1080, a 32:9 window and 2161 × 1164: every gap 24 or 6 units (whole px), the top row's tops and bottoms equal, *Search location* level with the tabs, the favourites with *Today*, the layout centred at 32:9, `freeflight.js` clean.
- [ ] **Step 2: Interactions** (hit tests and real clicks): globe clickable in the centre; the map buttons' three panels open at the right column and the bar hides as before; an airport and a traffic aircraft selected: their card under the tabs; *Search location* results open and the favourites hide; Departure / Arrival fields and swap work; a change of window size while Free Flight shows: places follow within 250 ms.
- [ ] **Step 3: Feature off** in the app (or a settings file with `freeflightLayout` disabled), reload: every sim style back to the one read before (compare the inline `style` attributes), the tabs and favourites rules still applied.
- [ ] **Step 4: The Back / Select hints**: find where they are and when they show; if they are on the frame's left edge they are already moved by Task 3's rule, else list them in `docs/next-steps.md` for the owner.
- [ ] **Step 5: Owner's screenshots** at 3440 × 1440 and 1920 × 1080; then commit `Free Flight on wide screens: measured at every resolution`.

### Task 6: Documentation

**Files:** `docs/user-guide.md`, `mod/README.md`, `docs/next-steps.md` (a row for this step, *Resume here*), `docs/feature-ideas.md` (MSFS-UI-Editor: a separate mod, never installed with this one, every block movable and resizable on a grid in a generator page with live preview; the 15 blocks of the owner's capture; the open question of the Weather / Airport tabs), `CLAUDE.md` (Progress row).

- [ ] **Step 1: Write the docs**; `npm run check`, `dotnet test generator/MsfsUi.slnx`: PASS.
- [ ] **Step 2: Commit** `Docs: Free Flight on wide screens`.
