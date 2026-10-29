# Hidden aircraft, new icons, the bar split in two: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user hides aircraft from the gallery and the list (a slashed eye on aircraft only, a **Hidden** filter), every heart becomes the owner's bookmark-with-a-star, the bar splits over the two columns in the side by side layout, and the livery rows stop overflowing.

**Architecture:** The hidden aircraft are a new stored list (`sim/hidden.ts`, key `HIDDEN_AIRCRAFT`, kept in the vault like the other keys). Which tiles show, and which are veiled (hidden but kept for a favourite), is decided by the pure `visibleTiles` (`aircraft-gallery/tiles.ts`). The icons are the mod's own SVG buttons (`core/icons.ts`, `core/icon-toggle.ts`) replacing the sim's `IconButton_Light_Wishlist` everywhere.

**Tech Stack:** TypeScript ES2017 (esbuild, node:test), CSS in the sim's units (`--u`), Coherent GT.

**Spec:** `docs/superpowers/specs/2026-10-30-hidden-aircraft-design.md` (read it: every "my call" there is binding).

## Global Constraints

- Everything in English; no personal data.
- ES2017, no operator before `await`, every change to the page through a `Scope`; anything clickable has a `data-input-group` (`core/dom.ts` `button()`); `setVariable()` in the 250 ms layout passes; never every tile alive (the existing pools).
- The icons: version B of the spec, its SVG paths verbatim; line icons, white, stroke width 1.7, smaller than the hearts were, in the **top right corner** of the tile or row; on a hovered (white) row the strokes turn dark (`currentColor`).
- The favourite star is cut out of the filled disc (even-odd fill).
- Aircraft identity: `{ displayName, creator }`, compared as `favoriteLiveriesOf` compares them (`sim/favorites.ts`).
- No change to `features.json`; the version stays 2.0.0.
- Measured in the sim to the pixel, then a screenshot from the owner, before each visual task's commit.

## Review Focus

1. **Hiding the aircraft under the mouse** in a long scrolled list: it leaves, the list does not jump back to the top, the next tile takes its place. Checked in the sim in Task 3, step 5 (the scroll position read before and after with `msfs-ui-dev eval`).
2. **A hidden aircraft with a favourite livery of another variant** (modular aircraft): still veiled and shown (identity by name and publisher). Test in Task 1.
3. **The last favourite of a veiled aircraft removed** while the screen stays: it stays veiled until the order is set again. Test in Task 1 (`keepIds`).
4. **Hidden and Favorites on together from an old memory** (`favoritesOnly: true`, then Hidden clicked): Hidden turns Favorites off, and a memory holding both reads as Favorites only. Test in Task 3.
5. **Search inside the Hidden view**: the search filters the hidden aircraft too. Test in Task 1.

---

### Task 1: The hidden list and which tiles show

**Files:**
- Create: `mod/src/sim/hidden.ts`, `mod/test/hidden.test.ts`
- Modify: `mod/src/features/aircraft-gallery/tiles.ts`, `mod/test/aircraft-gallery.test.ts`

**Interfaces:**
- Produces, `sim/hidden.ts`: `interface HiddenAircraft { displayName: string; creator: string }`; `loadHidden(): HiddenAircraft[]`; `saveHidden(list: HiddenAircraft[]): void` (key `HIDDEN_AIRCRAFT`, then `document.dispatchEvent(new CustomEvent(HIDDEN_AIRCRAFT_CHANGED))`); `HIDDEN_AIRCRAFT_CHANGED = 'msfs-ui-hidden-aircraft'`; `isHidden(list: readonly HiddenAircraft[], item: { displayName: string; creator: string }): boolean`; `withHidden(list: readonly HiddenAircraft[], item: { displayName: string; creator: string }, on: boolean): HiddenAircraft[] | null` (null when nothing changes).
- Produces, `tiles.ts`: `Tile` gains `veiled?: boolean`; `TileQuery` gains `hiddenOnly: boolean`, `hidden: readonly HiddenAircraft[]`, `keepIds: readonly number[]` (aircraft shown although hidden: the gallery passes its frozen favourite ids).

- [ ] **Step 1: Write the failing tests**
  - `hidden.test.ts`: `withHidden` adds and removes by name and publisher, returns null when unchanged; `isHidden` matches another variant of the same aircraft; `saveHidden` writes `MSFS_UI_HIDDEN_AIRCRAFT` and dispatches the event (fake `window`/`document` as in `storage.test.ts`).
  - `aircraft-gallery.test.ts`, new `describe('hidden aircraft')`:
    - `leaves a hidden aircraft out of the normal view`;
    - `keeps a hidden aircraft whose id is in keepIds, veiled` (`veiled === true`, others `undefined`/false);
    - `keeps it veiled when its favourite is of another variant` (the gallery's `favoriteAircraftIds` finds it by name and publisher: assert through `favoriteAircraftIds` + `visibleTiles`);
    - `shows only the hidden aircraft in the Hidden view, not veiled, one tile per aircraft`;
    - `filters the Hidden view with the search`;
    - `veils a Favorites tile whose aircraft is hidden`;
    - existing tests updated to pass `hiddenOnly: false, hidden: [], keepIds: []`.
- [ ] **Step 2: Run** `cd mod; node --test test/hidden.test.ts test/aircraft-gallery.test.ts` → FAIL.
- [ ] **Step 3: Implement** `sim/hidden.ts` and the `visibleTiles` rules of the spec (normal: not hidden, or hidden with `aircraftId` in `keepIds` → `veiled`; Favorites: livery tiles, `veiled` when the owner aircraft is hidden; Hidden: hidden aircraft only; the gallery never passes `hiddenOnly` and `favoritesOnly` both true; the search applies in every view).
- [ ] **Step 4: Run** `cd mod; npm run check` → PASS.
- [ ] **Step 5: Commit** "Gallery: the hidden aircraft list and which tiles show".

### Task 2: The new icons everywhere

**Files:**
- Create: `mod/src/core/icon-toggle.ts`, `mod/test/icon-toggle.test.ts`
- Modify: `mod/src/core/icons.ts` (bookmark empty, bookmark full, slashed eye; `HEART_SVG` removed), `mod/src/features/aircraft-gallery/gallery.ts` (Favorites tiles), `liveries.ts`, `aircraft-gallery.css`, `mod/src/features/aircraft-setup/panel.ts` (+ its CSS), `mod/src/features/freeflight-favorites/panel.ts` (+ its CSS), `mod/src/sim/components.ts` and `mod/compat.json` (`wishlistButton` / `IconButton_Light_Wishlist` removed), `mod/README.md` (components list)

**Interfaces:**
- Produces, `core/icon-toggle.ts`: `type IconKind = 'favorite' | 'hidden'`; `iconToggle(scope: Scope, parent: Element, kind: IconKind, onToggle: (checked: boolean) => void): IconToggle`; `interface IconToggle { readonly element: HTMLElement; set(checked: boolean): void }`. The element: `button()` of `core/dom.ts`, class `msfs-ui-icon msfs-ui-icon--<kind>`, `is-on` when checked; a click calls `onToggle(!checked)` and stops the event (the tile under it must not be clicked); the SVG uses `currentColor`.

- [ ] **Step 1: Write the failing test** `icon-toggle.test.ts` (fake DOM as in `dom.test.ts`): `set(true)` adds `is-on`, `set(false)` removes it; a click calls `onToggle(true)` when off and `onToggle(false)` when on, and does not reach a listener on the parent; the scope's disposal removes the element.
- [ ] **Step 2: Run** it → FAIL.
- [ ] **Step 3: Implement** `icons.ts` (paths of the spec, verbatim; the full bookmark's disc with the star cut out, `fill-rule="evenodd"`) and `icon-toggle.ts`; replace every `COMPONENTS.wishlistButton` (gallery Favorites tiles, livery column, setup panel thumbnails, Free Flight rows) with `iconToggle(…, 'favorite', …)`, keeping each call site's existing favourite logic; CSS: the icon in the top right corner, smaller than the heart was (start at 22 units square on a row, 20 on a tile, measured), `color` white, dark on a hovered row (`.msfs-ui-gal__row:hover`), the `is-on` state as the spec says; remove the component from `components.ts` and `compat.json`.
- [ ] **Step 4: Run** `cd mod; npm run check` → PASS (the contracts check `compat.json`).
- [ ] **Step 5: In the sim** (`msfs-ui-dev install`, `reload`): every former heart is a bookmark in the top right corner, the favourite logic unchanged (add / remove a favourite in each of the four places), measured; screenshot from the owner.
- [ ] **Step 6: Commit** "Icons: a bookmark with a star instead of the hearts".

### Task 3: Hiding aircraft in the gallery

**Files:**
- Modify: `mod/src/features/aircraft-gallery/gallery.ts`, `aircraft-gallery.css`, `mod/README.md` (data key `MSFS_UI_HIDDEN_AIRCRAFT`, the memory's `hiddenOnly`)
- Test: `mod/test/aircraft-gallery.test.ts` (the memory and filter rules, as pure functions extracted to `tiles.ts` if needed)

**Interfaces:**
- Consumes: Task 1 (`loadHidden`, `saveHidden`, `withHidden`, `isHidden`, `HIDDEN_AIRCRAFT_CHANGED`, `TileQuery.hiddenOnly/hidden/keepIds`, `Tile.veiled`); Task 2 (`iconToggle(…, 'hidden', …)`).
- Produces: `GalleryMemory.hiddenOnly?: boolean`; in `tiles.ts`, `readFilter(memory: { favoritesOnly?: boolean; hiddenOnly?: boolean }): 'all' | 'favorites' | 'hidden'` (both true reads as `'favorites'`).

- [ ] **Step 1: Write the failing tests**: `readFilter` (both true → favorites; hiddenOnly alone → hidden; none → all); `turning Hidden on turns Favorites off` as a pure `toggleFilter(current, clicked): 'all' | 'favorites' | 'hidden'` (clicking the current one → all).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**:
  - the **Hidden** button (the sim's `textButtonSmall`, like Favorites) left of Favorites, the slashed eye before its text, Favorites with the bookmark before its text;
  - every aircraft tile and row: `iconToggle(…, 'hidden', …)` in its top right corner (off: 55 % white until hovered; on: full white), a click hides / brings back the aircraft (`saveHidden(withHidden(…))`), the gallery re-renders on `HIDDEN_AIRCRAFT_CHANGED` without resetting the scroll;
  - `keepIds` = the frozen favourite ids of 1.10 (`favoriteIds`); veiled tiles: a dark veil (about 35 % black) over the tile and the large slashed eye centred on the thumbnail (marker, not clickable), the corner eye "on";
  - Favorites tiles: no eye in the corner (the bookmark only), veiled when their aircraft is hidden;
  - the empty Hidden view: "No hidden aircraft: click the eye on an aircraft to hide it."; the counts of the spec.
- [ ] **Step 4: Run** `cd mod; npm run check` → PASS. **Step 5: In the sim**: hide the Archer Midnight from a scrolled list (it leaves, no jump), Hidden view, bring it back, a hidden aircraft with a favourite livery (veiled, in both views), measured; screenshot. **Step 6: Commit** "Gallery: hide aircraft, the Hidden filter".

### Task 4: The bar split, and no row overflow

**Files:**
- Modify: `mod/src/features/aircraft-gallery/gallery.ts` (bar), `liveries.ts` / `livery-column.ts` / `mod/src/sim/selection-layout.ts` as needed, `aircraft-gallery.css`

**Interfaces:** Consumes the controls of Task 3. Produces nothing new for other tasks.

- [ ] **Step 1: Write the failing test** for any pure layout helper added (e.g. the split widths: `splitBar(totalWidth, aircraftWidth, liveryLeft)` if the bar's place is computed), in `selection-layout.test.ts` or `aircraft-gallery.test.ts`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: side by side — search, count, Hidden, Favorites above the aircraft column; sort, reverse, Gallery, List, Default above the livery column, aligned to its left and right edges; Classic — one line as today with Hidden added; if the aircraft column's controls do not fit, the count shortens first. Livery rows: every row the same width, inside the column; every text stops before its corner icon (aircraft and liveries, both views).
- [ ] **Step 4: Run** `cd mod; npm run check` → PASS. **Step 5: In the sim**: both layouts, both views, an aircraft with two liveries (the Vueling case of the spec): edges measured to the pixel; screenshot. **Step 6: Commit** "Gallery: the bar split over the two columns, rows inside their column".

### Task 5: Documentation and the release

**Files:** `CLAUDE.md` (the rule "the sim's own components for everything visible": the mod's own icons are the owner's wanted exception; progress row), `docs/user-guide.md` (hiding, the icons), `mod/README.md`, `docs/next-steps.md`, `CHANGELOG.md` (2.0.0 entry), then `build-release.ps1`.

- [ ] **Step 1**: update the docs (English, no personal data). **Step 2**: `pwsh -File build-release.ps1` → every test PASS, zip built; personal data scan of the release 0 hits; SHA-256 in `docs/next-steps.md`. **Step 3: Commit** "Docs: hidden aircraft and the new icons; release 2.0.0 rebuilt".
