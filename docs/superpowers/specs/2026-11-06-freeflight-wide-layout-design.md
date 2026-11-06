# Free Flight on every screen width: design

Asked by the owner on 2026-11-06, after a user's comment on flightsim.to (lalabubu, a 34-inch monitor): "even on my
34-inch monitor, placing the Favorite Aircraft and Weather/Traffic panels on the left and right sides leaves the central
area, where the globe for selecting airports is displayed, far too cramped and practically unusable [...] Would it be
possible to make the Aircraft and Weather panels automatically adjust their size based on the window width? [...]
especially for users with 21:9 or even 32:9 aspect ratio monitors." The decisions below were taken over mockups shown in
the browser (`.superpowers/brainstorm/`, not in Git; the last ones `wide-freeflight-v5.html` and
`wide-freeflight-proposal-2.html`).

## Intent

The sim lays Free Flight out in a frame **1880 units wide** centred on the screen: every block is placed by an inline
style `left: calc(var(--h-anchor) + calc(var(--unscaledScreenHeight) * Npx / 1080))` with `--h-anchor: 50%` and
N = ±940 for the frame's edges (measured 2026-11-06 at 3440 × 1440, below). On the owner's screen the aircraft button
starts 467 px from the left edge and the right column ends 467 px from the right edge (350 units); on a 16:9 screen the
margin is 20 units. The mod's panels are anchored on those sim blocks (the weather bar under
the widget, `weather-bar/bar.ts`; the favourites under the aircraft button, `freeflight-favorites/panel.ts`), so they
stay in that area too. The sides of the screen are empty, and the globe is squeezed between two columns that fill the
screen's height.

The update moves **Free Flight's two columns to the edges of the screen**, stretches the block between them, and puts
**every gap of the screen on one rule**: "propre, symétrique et cohérent" (the owner). The aircraft selection is not
changed: the owner waits to see whether users ask for it.

## What the user sees (the owner's decisions)

All values are in layout units: the mod's `--u`, 1/1080 of the screen height. Only the screen's **proportion** changes
the layout, so 1920 × 1080, 2560 × 1440 and 3840 × 2160 look the same.

The mod reads the screen's size itself, in the sim, at each layout pass (`window.innerWidth`, `window.innerHeight`, as
`right-column.ts` already does): the layout follows a change of resolution or of the window's size at once, and the
generator needs to know nothing about the user's screen.

### Two gaps, nothing else

- **24 units between groups** (the sim's `GROUP_GAP`, 32 px at 1440 lines: the gap the sim leaves under the aircraft
  button, above *Search location*):
  - the left column 24 units from the screen's left edge, the right column 24 units from its right edge;
  - Departure / Arrival 24 units from each column;
  - aircraft button → *Search location*;
  - the profile bar 24 units from the screen's top, then 24 units to *Flight Conditions*;
  - *Flight Conditions* → the Weather / Airport tabs;
  - map buttons and scale → *EFB*, *EFB* → *Start flight*, *Start flight* 24 units from the screen's bottom.
- **6 units inside a group** (the weather bar's `GAP`): between the bar's sections as today; *Search location* →
  favourites, **equal to** Weather / Airport tabs → *Today*, so that the favourites start level with *Today* (the
  owner: "sinon ce n'est pas en face").

### Alignments

- The aircraft button, Departure / Arrival and *Flight Conditions*: the same top and the same bottom.
- *Search location* level with the Weather / Airport tabs: **the tabs' row takes the measured height of *Search
  location*** (today it is `TAB_ROW`, 36 units, `weather-bar/right-column.ts`; *Search location* is 30 units, the
  `Searchblock`'s own height). The owner chose this over making the sim's field taller.
- The favourites level with *Today*.
- The two columns the same width (as today: the aircraft button and the right column are both 440 units wide).
- The profile bar's right edge on the right column's right edge.
- The Back / Select hints on the left column's left edge and on *Start flight*'s bottom.

### Across widths

- **Departure / Arrival stretches** between the two columns (the owner chose this over keeping its width, centred).
- **The whole layout stops at the width of a 21:9 screen** (3440 × 1440: 2580 units) and stays centred beyond it. On a
  32:9 screen (5120 × 1440) the layout is exactly the 3440 × 1440 one, the globe free on both sides; only the outer
  margin grows. The owner chose this over Departure / Arrival stretching without limit (2864 units at 32:9) and over a
  capped Departure / Arrival, which would break the 24-unit gaps on each side of it.
- **The same rules on 16:9 screens.** Today the sim leaves there an edge margin of 20 units and 6 units on each side of
  Departure / Arrival (988 units wide at every ratio): the columns move 4 units outward and Departure / Arrival
  narrows to 944 units (1604 at 3440 × 1440, 1584 at 2560 × 1080).
- 16:10: the sim shows it as 16:9 (measured in 1f); it gets the 16:9 layout.

### Free Flight's blocks

| Block | Owner | Moves with |
|---|---|---|
| Aircraft button | sim | left column |
| *Search location* | sim | left column |
| Favourites | mod | left column (already anchored on the aircraft button) |
| Back / Select hints | sim | left column |
| Departure / Arrival (with runway and swap) | sim | stretched between the columns |
| Profile bar (B, profile, notifications, settings) | sim | right column |
| *Flight Conditions* widget | sim | right column |
| Weather / Airport tabs, *Today*, *Weather*, *Presets*, *Air traffic*, *Multiplayer*, METAR | mod | right column (anchored on the widget) |
| The sim's Airport and Traffic cards (behind the Airport tab) | sim | right column (held by `right-column.ts`) |
| Map scale, map buttons (legend, layers, display) and their panels | sim | right column |
| *EFB*, *Start flight* | sim | right column |

The airport label on the map is the map's own and is not moved.

## What the sim does (measured 2026-11-06, 3440 × 1440, Free Flight shown)

Units below are layout units (1 unit = 1.333 px at 1440 lines). Every block is an absolute element of `FreeFlightPage`
(or of `MenuBarPage`) placed by its inline style from the screen's centre (`--h-anchor: 50%`, `--v-anchor: 50%`) and a
pivot (`--pivot-x`, `--pivot-y`, applied as a `transform`):

| Element (`name`) | Place (inline style) | Box | Holds |
|---|---|---|---|
| `MainBlock` | `left: 50%`, pivot −50 %, `width: 1880`, `top: 50% − 450`, `height: 190` | 90 → 280 | `FreeFlight_AircraftButton` (`left: 0`, 440 wide), `FreeFlight_Plan` (Departure / Arrival, `left: 446`, `right: 446`), `WeatherBlock` (`left: 1440`, `right: 0`: the *Flight Conditions* title, 88 high, and `Flight_Conditions_History_Widget`, 96 high, 6 apart) |
| `Searchblock` | `left: 50% − 940`, `top: 50% − 236`, 440 × 30, z-index 51 | 304 → 334 | `Search` |
| `Worldmap_Filters` | `left: 50% + 940`, pivot −100 % / −100 %, `top: 50% + 378`, 440 × 44 | 874 → 918 | the scale (`ScaleBlock`), the map buttons (`Buttons`), their panels (`Content`) |
| `Buttons` (FreeFlightPage) | `left: 50% + 940`, pivot −100 %, bottom at 1059.75 | 942 → 1059.75 | `EFB` (49.5 high), `Fly` (*Start flight*, 49.5 high), 18.75 apart |
| `MenuBar` (in `MenuBarPage`, **shared by every screen**) | `left: 50% + 940`, pivot −100 %, `top: 50% − 525`, 50 high | 15 → 65 | `ShortcutWrap` (B), `MenuBar_ProfileButton`, the icon buttons, `Market`, `SettingsButton` |

So the frame is 1880 units (centre ± 940); the gaps today are 24 under `MainBlock`, 25 under `MenuBar`, 6 around
`FreeFlight_Plan`, 24 between the map buttons and *EFB*, 18.75 between *EFB* and *Start flight*, 20.25 under *Start
flight*. The Back / Select hints were not on the screen during the measure. Moving a block means rewriting the offset
of its `left` (and `top`), or the `width` and inner `left` / `right` of `MainBlock`, through a scope that puts the
inline style back; the sim did not rewrite these styles while Free Flight stayed shown (to be confirmed across screen
changes and a change of resolution).

## Constraints

- Every change to the sim through a `Scope` (reversible); every sim element touched (`name="…"`, classes, GUIDs)
  declared in `mod/compat.json`, so the Compatibility page flags a sim update that breaks it.
- Click and wheel reach only elements with `data-input-group`; a sim element moved over a mod panel (z-index 50) needs
  a higher z-index, checked by hit testing.
- The sim animates and resizes its screens without notice: places computed in the existing 250 ms passes, whole
  pixels, a CSS variable written only when it changes (`setVariable()`).
- The sim's other screens are not touched. **The profile bar (`MenuBar`) is shared by every screen: it moves only while
  Free Flight is shown** (the owner, 2026-11-06, over moving it on every screen or never), and goes back to the sim's
  place when another screen shows; the same for the Back / Select hints if they are shared.
- No `resize` event sent; no profile save.
- Nothing else of the mod's Free Flight behaviour changes: the tabs, the cards held under them, the map panels hiding
  the bar, the favourites hidden while the search shows its results, the presets list sized toward the map buttons
  (`presets.sizeList`, which then follows the moved map buttons).

## My calls (the owner can correct them)

- **A new feature, *Free Flight layout*** (`freeflightLayout`, enabled by default, no option) moves the sim's blocks;
  off, the sim keeps its own places and the mod's panels follow them as today. The two rules on the mod's own blocks
  (tabs as high as *Search location*, *Search location* → favourites 6 units) belong to their features and apply either
  way.
- The places are computed by a **pure function** (screen width and height in pixels, the measured heights of the sim's
  blocks → a rectangle per block, in whole pixels), tested under `node:test`, as `bar-layout.ts` and
  `showcase-layout.ts` are.
- The column width stays the sim's (measured), not a constant of the mod.
- The favourites stay level with *Today* even when the sim does not show *Search location* (today they then rise to
  24 units under the aircraft button): a block's place does not depend on what the column shows (the owner's wish of
  2026-10-31, 1j).
- Screens narrower than 16:9 (4:3, 5:4) get the same rules if the sim draws them at their width (Departure / Arrival
  about 464 units at 4:3); the builder measures what the sim does there.
- The vertical places of the bottom right blocks (map buttons, *EFB*, *Start flight*) are computed from the screen's
  bottom; the room between the METAR and the map buttons is what is left (it depends on the bar's content).

## Left to the builder (to settle by measuring in the sim first)

- Whether the sim writes the inline styles above again (screen changes, a change of resolution, its animations), and
  how the scope keeps them.
- Where the Back / Select hints are and when they show.
- Where the map buttons' panels, the search results and the sim's cards open once their anchors move.
- The behaviour at a change of resolution while Free Flight is shown.

## Out of scope

- The aircraft selection (later, if users ask for it).
- An option for the layout's maximum width (16:9, 21:9, whole screen): set aside.
- **MSFS-UI-Editor**, the owner's idea of a separate mod where users move and resize every block on a grid, the
  generator's mod and the Editor never installed together: to be written in `docs/feature-ideas.md` with this step.

## Verification

- `npm run check` (contracts, the layout function's tests: every gap and alignment at 16:9, 2560 × 1080, 3440 × 1440,
  32:9; the cap at 21:9), the `config.js` fixtures updated for the new feature, `dotnet test`.
- Installed and reloaded; measured in the sim with `getBoundingClientRect` at 1920 × 1080, 2560 × 1440, 3840 × 2160,
  3440 × 1440 and in a 32:9 window (`tools/resolution-check/`): every gap at 24 or 6 units and every alignment to the
  pixel; `freeflight.js` clean.
- Hit tests: every moved block answers clicks and the wheel; the globe answers in the centre; the map panels, the search
  results, the Airport and Traffic cards open in the right place.
- The feature off and reloaded: every sim block back in its own place.
- The owner's screenshots at 3440 × 1440, then the answer to lalabubu.
