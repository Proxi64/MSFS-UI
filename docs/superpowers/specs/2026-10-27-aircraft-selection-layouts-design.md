# Aircraft selection layouts: design

2026-10-27. Status: proposed, to be approved by the owner before any code.

## Why

A user wrote on 2026-10-27, with screenshots, about the aircraft selection:

1. iFly 737 MAX: one variant per livery; the variants ran out of the setup panel. **Fixed** (next-steps 1.6).
2. FS Reborn Phenom 300E: eight variants left no room for the livery thumbnails. **Fixed** (1.6).
3. The livery thumbnails are too small to recognise a paint scheme: 205 px wide at 3440 × 1440, about 160 px at 1920 × 1080, three per row in the left column. Their suggestion: a gallery in two parts, aircraft and their liveries, both with large previews.

The owner decided (2026-10-27):

- on `main`, not on a separate branch;
- as **layouts chosen in MSFS-UI-GENERATOR's options**; the current layout stays the default;
- the first new layout is **side by side** (mock-up B of the three shown: A stacked, B side by side, C tabs).

## Goals

- A *Side by side* layout: the gallery area is cut in two columns, the aircraft on the left, the liveries of the current aircraft on the right, as large tiles with their name and tail number.
- The layout is chosen on the Features page of the app. *Classic* (today's layout) is the default: a user who never changes it sees no difference.
- A general *choice* option type in the shared contract, reusable later (E1 / E2 in feature-ideas.md).

## Non-goals

- The stacked (A) and tabs (C) layouts. They can be added later as more values of the same option.
- Every aircraft's liveries in the gallery. The sim's configurator holds the liveries of one aircraft at a time; reading another aircraft's would change the sim's current aircraft.
- Changing the variant from the livery column (the variants stay in the left column).
- A split the user can drag.

## Anti-goals (a failure even if it works)

- Anything of the sim left changed after leaving the screen, turning the feature off or switching the layout: everything goes through a `Scope`.
- A livery click that makes the current aircraft invalid. The configurator may be released (CLAUDE.md, "Configurator"): the setup panel's guard (`syncConfiguratorToCurrent` then a check that the item belongs to the configurator's aircraft) applies to the new column too.
- UI drawn by the mod where the sim has a component.
- Any change for the users who keep *Classic*.

## The option: a *choice* type

`mod/features.json`, on the `aircraftGallery` feature (the layout cuts the gallery; the setup panel follows it):

```json
{
  "id": "layout",
  "type": "choice",
  "title": "Layout",
  "description": "How the aircraft selection shows the aircraft and their liveries.",
  "default": "classic",
  "choices": [
    { "id": "classic", "title": "Classic", "description": "The gallery fills the right side; the liveries are small thumbnails in the setup panel." },
    { "id": "sideBySide", "title": "Side by side", "description": "The aircraft on the left half of the gallery, the liveries of the current aircraft on the right half, as large tiles with their name and tail number." }
  ]
}
```

Everything that reads the contract learns the type:

| Where | Change |
|---|---|
| `mod/schema/features.schema.json` | `choice`: `default` a string that must be one of `choices[].id`; `choices` of at least two `{ id, title, description? }` with unique ids |
| `mod/build/catalog.ts` | The generated `Settings` type gives a union of the ids (`'classic' \| 'sideBySide'`) |
| `mod/src/core/settings.ts` | A value that is not one of the ids takes the default |
| `MsfsUi.Core` (`FeatureCatalog`, `OptionType`, `OptionValue`, `SettingsNormalizer`, `ConfigScript`) | Read `choices`; a string value; an unknown value takes the default (as an out-of-range number does); written to `config.js` as a string |
| `MsfsUi.App` Features page | A `ComboBox` of the choices' titles, the selected choice's description under it; `AutomationId` `Option_<feature>_<option>`, each item `Choice_<feature>_<option>_<id>` |
| Fixtures and tests | `MSFS_UI_UPDATE_FIXTURES=1 dotnet test`, then `npm run check`; Core tests (parse, normalise, write), a UI test that changes the layout, mod tests of the settings validation |

## The side by side layout

### Geometry

The sim's right block (`RightBlock`), as the gallery uses it today:

- the gallery's bar keeps the full width, unchanged;
- below it, two columns of the same width, 12 units apart, in whole pixels;
- **left column**: the gallery's list, Gallery or List view, with its own rules (columns of tiles from their aimed width, at least two);
- **right column**: a header as in the setup panel (*Livery*, then the name of the current livery, or of the hovered one), then the liveries in the sim's `real-scroll`, **two tiles per row**, with room for the scroll bar as in setup-layout.ts.

Sizes this gives (measured right block): at 3440 × 1440 the column is 799 px wide, a livery tile about 380 px (1.9 × today); at 1920 × 1080 about 280 px (1.75 ×).

In the *Default* view (the sim's own grid) the gallery draws nothing: there is no livery column, and the setup panel shows its thumbnails as in *Classic*.

### Livery tiles

- The sim's aircraft tile, `TileButton_Fleet`, as in the gallery: `AircraftImage` the livery's thumbnail, `AircraftName` its title, `Subtitle` its tail number, no third line.
- Its image area takes the thumbnails' ratio, 720 × 344 (the gallery's list rows do the same for `Marketplace_Tile_Horizontal`), so a thumbnail is never cut.
- The sim's heart (`IconButton_Light_Wishlist`) in the corner, as on the gallery's tiles: a favourite livery of the variant shown, the same favourites as the setup panel's hearts.
- Favourites first, then the sim's order, an order kept while the variant stays (`orderLiveries`).
- The current livery is selected; an unavailable one is dimmed and ignores clicks, as in the setup panel.
- The text scrolls on hover when too long (`marquee__trigger` on the host).
- Components created only near the visible part of the list, as in the gallery: some aircraft have more than a hundred liveries.

### Tail number on a tile

The number the mod would apply to that livery (features/tail-number.ts), in that order: the one the user chose for it; a registration recognised in its name; the `atc_id` of its `livery.cfg`, read only for the tiles in view and kept in memory. Nothing when none is found. If the *Tail number per livery* feature is off, the tile shows the livery's own number (name or `livery.cfg`).

### Behaviour

- A click on an aircraft tile: as today (the sim's selection; the configurator follows); the livery column then shows that aircraft's liveries.
- A click on a livery tile: the same action as a thumbnail of the setup panel (the guard above, then `Configurator.SaveVariationId`).
- Hover on a livery tile: its name in the column's header.
- The variants stay in the setup panel; a change of variant there redraws the livery column, which opens on the selected livery (as the setup panel's variants list opens on the selected variant).
- While the configurator gives no liveries (between two aircraft), the column keeps its header and shows no tiles.

### The setup panel in this layout

While the gallery shows the livery column, the setup panel drops its *Livery* header and thumbnails: the variants take the room left by the tail number and the buttons (setup-layout.ts with no livery rows). The iFly's 30 variants get the whole height. When the column goes (Default view, gallery off, screen left), the thumbnails come back.

### Code

- The configurator logic of the setup panel moves to a shared module in `mod/src/sim/` (read the variants, liveries and details; the guard; choose a livery; set a favourite livery), used by the setup panel and the livery column. A first commit does only this move, with no visible change.
- `mod/src/features/aircraft-gallery/liveries.ts`: the livery column (sizes in a pure, tested module, as setup-layout.ts).
- A shared flag (in `mod/src/sim/`) set by the gallery while it shows the livery column, read by the setup panel at each layout pass (every 250 ms): no order between the two features at start-up.
- `compat.json`: nothing new is expected (the components, `real-scroll` and the configurator paths are declared); the build says so if a reference is missing.

## Verification

- Pure parts with `node:test`: the column sizes, the order and the tail number line of the tiles, the choice option's validation.
- App: Core tests of the choice type; a UI test that picks *Side by side* and finds it in the settings written.
- In the sim, measured with `msfs-ui-dev eval`: the two columns at whole pixels and aligned under the bar; tile sizes; the Phenom 300E (27 liveries, 7 variants); an aircraft with a single livery; the Default view; switching the layout in the app then *Generate & install* and reload; leaving the screen puts everything back. Then a screenshot from the owner.

## Steps (one commit each, each approved first)

1. The *choice* option type, mod and app, with its tests (no option uses it yet; the tests use their own catalogue).
2. The setup panel's configurator logic moved to `mod/src/sim/`, no visible change.
3. The `layout` option and the side by side layout, the setup panel following it.
4. Documents: user guide, `mod/README.md`, `docs/next-steps.md`, `CLAUDE.md`; version 1.1.0 (a new option of the gallery; the owner decides).

## Decided by the owner

On `main`; layouts in the generator's options; *Classic* stays the default; the side by side layout first.

## Calls made in this design (to check)

- The option belongs to the *Aircraft gallery and list* feature, named *Layout*, values *Classic* and *Side by side*.
- A `ComboBox` on the Features page (two values now, more later).
- Two columns of equal width; two livery tiles per row.
- A livery tile shows its name and tail number; the sim's aircraft tile, with the thumbnail's ratio.
- The livery column also in the List view (the aircraft as rows on the left).
- The setup panel drops its thumbnails while the column is shown.
- The livery column opens on the selected livery; it stays empty between two aircraft.
