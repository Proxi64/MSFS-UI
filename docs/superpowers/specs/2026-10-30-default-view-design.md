# The Default view, made by the mod: design

Asked by the owner on 2026-10-30, for 2.0.1 (branch `v2.0.1`): "je veux que la page default soit traitée comme les pages gallery et list. Seul le layout change", and "essaye d'aligner les choses proprement". Replaces the item 1d of docs/next-steps.md (on hold until then).

## Intent

The aircraft selection has three views: Gallery and List are drawn by the mod (search, count, Hidden and Favorites filters, sorts, favourites first, the slashed eye, the bookmarks); **Default** shows the sim's own grid, which has none of it. The owner does not use Default, but several users love it, for its large tiles (the owner's guess). Default must offer everything Gallery and List offer, keeping the large tiles of the sim's grid and their horizontal scrolling. And everything in it aligned to the pixel: today the sim's grid starts with a cut tile, ends 32 pixels before the bar and runs 2 pixels below its block.

## What the user sees

### Like Gallery and List (the owner)

- The same bar: search, count, **Hidden**, **Favorites**, the sort and its direction, **Gallery**, **List**, **Default**.
- The same tiles and rules as Gallery (`tiles.ts`): favourites first, the order kept while the screen stays, a hidden aircraft gone (or darkened with its eye laid over it when it has a favourite livery), the Hidden view, the Favorites view (one tile per favourite livery, its bookmark in the corner), the empty-view messages, the count, the eye in each aircraft tile's top right corner, a click selecting the aircraft (or the livery of a Favorites tile), the selected tile shown when the view opens.
- The filters work in place: clicking Hidden or Favorites in Default filters Default (*my call*: the 2.0.1 behaviour of a filter clicked in the sim's grid, which switched to the last of the mod's views, goes with the sim's grid; `lastView` is no longer written, a stored one is ignored).
- The sorts are the mod's, as in Gallery: the sim's grid is no longer shown, so the order sent to the sim's list matters no more than in Gallery (the item 1d problem goes away).

### The layout: the sim's grid, aligned (the owner)

Measured on the owner's sim (3440 × 1440, 2026-10-30): the sim's grid is its `TileButton_Fleet` at 480 × 426 pixels (360 × 320 units: image 229 pixels, text banner 197), two rows, 32 pixels (24 units) between the tiles, scrolling horizontally on the whole right block (1272 to 2886), about three columns in view. The left block keeps the setup panel with its livery thumbnails, as wide as the sim makes it in this view.

- **Two rows of large tiles, scrolling horizontally** (the owner: yes to keeping the horizontal scrolling).
- **Whole columns, filling the width exactly**: the number of columns is the one that gives the tile width nearest the sim's 360 units (three on the owner's screen); the tile width in whole pixels so that those columns and their 24-unit gaps fill the grid's width; every column the same width (each is the last one at some scroll position), so the grid and the bar may be up to one pixel per column short of the right block (*my call*, from the plan).
- **Two rows filling the height**: from 12 units under the bar down to the scroll bar, the scroll bar's bottom on the right block's bottom (the left panel's bottom). The image keeps the sim's ratio (229 / 480 of the tile's width); the text banner takes the rest of the tile's height (*my call*: the image is never stretched; the sim's banner is mostly empty, so it absorbs the difference). If the banner would be shorter than its three lines of text, one more column is taken.
- **The bar on one line above the grid**, its left edge on the first column's left edge and its right edge (the **Default** button's) on the last column's right edge, to the pixel. The bar's height and its controls as in Gallery's one-line bar (*my call*).
- **The scroll bar** under the grid, from its left edge to its right one.
- **Never a cut tile at rest**: the scrolling stops on a whole column (the wheel moves column by column; a drag of the scroll bar settles on the nearest column when released) (*my call* on the wheel step, to be measured against the sim's own grid).
- No livery column in Default, whatever the gallery's *Layout* option (as today); the setup panel shows its livery thumbnails, the left block as wide as the sim makes it in Default.
- The sim's grid and its search are hidden while Default shows, as they are in Gallery and List (and shown again when the mod is unloaded).

### The text of a tile

Three lines as in Gallery (name; variant; studio) (*my call*: the same tile, larger; the sim's grid shows two).

## Constraints

- The project's rules (CLAUDE.md): the sim's own components (`TileButton_Fleet` is already the gallery's tile), a recycling pool of tiles (`sim/component-pool.ts`, `core/virtual-list.ts`: never every tile alive; here along the horizontal axis), the 250 ms layout passes writing only on change (`setVariable`, `setStyle`), `inputLocker` on everything clickable, ES2017, every change through a `Scope`, contracts in `compat.json`.
- No cost per frame; scrolling as smooth as Gallery's.
- Verified by measuring in the sim (`getBoundingClientRect`): bar edges = grid edges, no cut tile at rest, scroll bar edges = grid edges, grid bottom = left panel bottom; then the owner's screenshots.
- Tests (node:test) for the pure parts: the number of columns, the tile size, the column a scroll position settles on, the edges.

## Non-goals

- Changing Gallery or List.
- A vertical Default view, or a choice between the two.
- The sim's own grid (left as it is, only hidden).
- Gamepad or keyboard navigation (the mod's panels are mouse only).

## Left to the builder

- How the horizontal scroll is made: the sim's `real-scroll` with `direction="x"` if it works (to be measured), else what the sim's own grid uses (`PlaneSelection_List` and its `Scroll`), within the rule of the sim's own components.
- How `core/virtual-list.ts` gains the horizontal axis (or a sibling), and how the gallery's code is shared between the three views rather than copied.
- The wheel's step and the settling after a drag, measured against the sim's grid.
- The exact vertical metrics (bar height, gaps) at 1080, 1440 and 2160 lines.
