# Hidden aircraft, new icons, the bar split in two: design

Approved by the owner on 2026-10-30 (brainstorming, with a mock-up chosen in the visual companion: version B). To ship in 2.0.0, before it is published.

## Intent

Many aircraft are never flown (the owner's example: "Archer Midnight") and make the user scroll the gallery and the list to find the one wanted. The user hides them, aircraft by aircraft, and the gallery shows only what is flown. The owner also wants the hearts gone ("je n'aime pas trop les cœurs") and asks for quality and good looks above all: "je veux qu'on produise quelque chose de QUALITÉ et ESTHÉTIQUE, sinon ça ne m'intéresse pas".

## What the user sees

### Hiding an aircraft

- Every **aircraft** tile (Gallery view) and row (List view) has a small **slashed eye** in its top right corner. Liveries never have one.
- A click hides the aircraft: the whole aircraft, with all its liveries, and all its variants (the gallery shows one entry per aircraft: *my call*). It leaves the gallery and the list at once.
- The sim's own grid (the **Default** view) is not changed: hidden aircraft are still there (*my call*: the mod does not filter the sim's grid).

### The Hidden filter

- A **Hidden** button, left of **Favorites**, with the slashed eye before its text (as Favorites gets the bookmark before its text).
- On: the gallery shows only the hidden aircraft; their eye is shown "on"; a click on it brings the aircraft back (it leaves the Hidden view at once).
- **Hidden** and **Favorites** are never on together: turning one on turns the other off (*my call*).
- Empty Hidden view: a short message in the style of the Favorites one ("No hidden aircraft: click the eye on an aircraft to hide it.").
- The count (`shown / total`) does not count the hidden aircraft in the normal view (*my call*).

### Favourites come first (the owner)

- A hidden aircraft that has a favourite livery is **not** taken out: it stays in the normal view and in the Favorites tiles, its tile or row **slightly darkened**, with the slashed eye laid over it, so that the user sees it is hidden and kept only for its favourites (*my call*: the same look in both views).
- The Free Flight favourites do not change.

### The icons (the owner chose version B)

- **Favourite**: a bookmark with a star (drawn after the owner's sketch), replacing **every** heart: the livery column (Gallery and List), the setup panel's livery thumbnails, the gallery's Favorites tiles, the Free Flight favourites. Empty bookmark: not a favourite; the star disc filled: a favourite.
- **Hidden**: a slashed eye (drawn after the owner's sketch).
- Both are line icons in the sim's white and line weight, **smaller than the hearts were**, in the **top right corner** of the tile or row (no longer centred in the row's height).
- They are the mod's own drawings (SVG), not the sim's: an exception to the rule "the sim's own components for everything visible", wanted by the owner; CLAUDE.md records it. Reference: the mock-up `icons-and-bar.html`, version B (kept in `.superpowers/brainstorm/`, not in the repository; the SVG paths below are the source).
- States, as the sim's own buttons do: a hover lightens the icon (*my call*: no "preview of the opposite state" as the sim's heart did, which users took for a bug in 1.2).

### The bar, in the side by side layout (the owner's mock-up)

- Above the aircraft column: search, count, **Hidden**, **Favorites**.
- Above the livery column: the sort dropdown, the reverse button, **Gallery**, **List**, **Default**.
- In the Classic layout, the bar keeps its single line (*my call*: no livery column to stand above), with Hidden added left of Favorites.

### Text overflow (seen on 2026-10-30)

- In the livery column's List view, a selected row was wider than the others and ran past the column's frame, and its text ran under the heart. Every livery row has the same width, inside the column, and every text (aircraft and liveries, both views) stops before its icon.

### Details settled after the builder check (all *my calls*)

- **On a darkened (hidden but favourite) aircraft**: the corner eye is the "on" eye and a click brings the aircraft back (as in the Hidden view); the large eye over the thumbnail is only a marker, not clickable.
- **Such an aircraft also appears in the Hidden view** (it is hidden).
- **When a livery of a hidden aircraft becomes a favourite** (the aircraft selected in the Hidden view, or hidden while selected): the aircraft appears at once in the normal view, veiled (the owner's decision of 2026-10-30: favourites come first, without exception).
- **When its last favourite livery goes while the screen stays open**: it stays where it is, darkened, until the order is set again (a new sort, search, filter, category tab, or the screen opened again), as the favourites first of 1.10 do; then it leaves.
- **Counts**: normal view, `shown / total` = the tiles shown (darkened ones included) / the aircraft of the category tab; Hidden view, `shown / total` = the hidden aircraft shown / the aircraft of the tab; Favorites view unchanged.
- **The Favorites tiles** stay one tile per favourite livery; the tile of a livery whose aircraft is hidden is darkened with the large eye marker; its corner icon is the bookmark (a click removes the favourite, as today). No eye in the corner of a Favorites tile.
- **The selected aircraft can be hidden**: it leaves the gallery but stays the sim's selected aircraft (the left column still shows it); nothing is sent to the configurator.
- **Identity**: an aircraft is its name and publisher, stored as `[{ "displayName": "…", "creator": "…" }]` (the shape the favourites already use, `sim/favorites.ts`; read later by the app, step 2), compared as the favourites compare them.
- **Buttons of the mod**: the icons are the mod's own buttons (its element and input group, no sim component), mouse only like the rest of the mod's panels; `IconButton_Light_Wishlist` goes from `compat.json` and `components.ts` once no longer used.
- **The star of a favourite**: cut out of the filled disc (even-odd fill), so that it shows the row's own colour in every state (plain, selected, hovered); on a hovered (white) row the strokes turn dark (`currentColor`).
- **No new option**: hiding is part of the *Aircraft gallery and list* feature, always on with it (no change to `features.json`).
- **The bar's fit**: in the side by side layout the aircraft column's bar must fit at its width; measured, and if it does not, the count shortens before anything wraps.
- **Version**: still 2.0.0 (not published yet).

## Look and quality bar

- Colours measured in the sim (List rows: light blue `rgb(59, 132, 235)` at 30 % over `rgba(30, 66, 118, 0.2)`; selected `rgb(59, 132, 235)`; hovered white with dark text: the icons turn dark on a white row).
- Darkened hidden-but-favourite tile: a dark veil over the thumbnail and the text area (*my call*: about 35 % black), the slashed eye centred on the thumbnail, white, about the size of the Gallery view's corner icon ×2.
- Every element aligned to the pixel (the project's method: measured with `getBoundingClientRect`), then a screenshot from the owner before the commit.

## Data

- New key `MSFS_UI_HIDDEN_AIRCRAFT`: the hidden aircraft, each identified by **name and publisher** (the sim's list has one entry per modular aircraft, the variation ids change between variants: CLAUDE.md "Aircraft list"). Kept in the vault like the other keys (`core/storage.ts`); not one of the 1.x keys copied at the first start (it did not exist).
- The gallery's memory (`MSFS_UI_AIRCRAFT_GALLERY`) gains the Hidden filter's state; a stored `favoritesOnly` keeps working.

## Non-goals

- Hiding liveries or variants one by one.
- Hiding aircraft from the sim's own grid, from the Free Flight block or from the sim's other screens.
- A management page in MSFS-UI-GENERATOR (step 2 of 2.0 will show the data).

## Constraints

- The project's rules (CLAUDE.md): ES2017, every change through a `Scope`, `inputLocker` / `data-input-group` on anything clickable, `setVariable()` in the 250 ms layout passes, the recycling pool of tiles (`sim/component-pool.ts`, `core/virtual-list.ts`: never every tile alive), measured in the sim.
- No cost per frame; the order of the favourites first is kept while the screen stays (1.10); hiding an aircraft must not make the tile under the mouse jump in a way the user did not ask for (the hidden one leaves; the others close the gap).
- Tests (node:test) for the pure parts: which tiles are visible, darkened, counted, with Hidden on or off, with favourites.
- Release 2.0.0 is rebuilt after this work (the current zip lacks it and the List colours).

## Left to the builder

- How the icons are built in the page (inline SVG in an element of the mod, with its own input group), sizes in the sim's units, exact corner offsets (to be measured against the tile's own corner).
- How the bar is split (two bars, or one bar laid out on the two columns by the 250 ms layout pass, as `selection-layout.ts` already places the livery column).
- The removal of the `IconButton_Light_Wishlist` component from `compat.json` if no longer used.

## The icons (version B, viewBox 0 0 24 24, stroke white, width 1.7, round caps and joins)

- Bookmark, empty: `M6.5 20.5V5.2c0-1.1.9-2 2-2h7c1.1 0 2 .9 2 2v5.3`, `M6.5 20.5l4.6-3.4`, a circle `cx 16.6 cy 16.6 r 5.2` stroked, and a star polygon `16.6,13.9 17.4,15.7 19.3,15.8 17.8,17 18.3,18.9 16.6,17.9 14.9,18.9 15.4,17 13.9,15.8 15.8,15.7` filled white.
- Bookmark, favourite: the same, the circle `r 5.6` filled white with the star cut out of it (even-odd), showing the row's colour.
- Slashed eye: `M2.5 12c2.2-3.9 5.6-6 9.5-6s7.3 2.1 9.5 6c-2.2 3.9-5.6 6-9.5 6s-7.3-2.1-9.5-6z`, a circle `cx 12 cy 12 r 3.2`, a line from `4.5,19.5` to `19.5,4.5`. "On" (in the Hidden view and on a darkened tile): full white; "off" (to hide): white at about 55 % until hovered.
