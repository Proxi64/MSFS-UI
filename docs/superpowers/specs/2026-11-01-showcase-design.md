# The Showcase view and its setup panel: design

Asked by the owner on 2026-11-01, from a screenshot of the Default view (3440 × 1440): "je n'aime pas la page default", "c'est surtout le bloc de gauche que je n'aime pas", then, over mockups shown in the browser, the decisions below. Mockups: `.superpowers/brainstorm/` (not in Git), the last one `variants-v5.html`.

## Intent

The aircraft selection has three views: **Gallery** and **List** (the mod's lists) and **Default** (two rows of large tiles scrolling horizontally, 2.0.1). The *Layout* option of the app (*Classic* / *Side by side*) changes Gallery and List: side by side, the gallery shows the liveries of the current aircraft in a column of its own; in *Classic*, and always in Default, the setup panel on the left shows them as small thumbnails.

The owner keeps the large tiles and their horizontal scrolling, and dislikes the left block: a gap under the livery thumbnails, six small thumbnails, a large "Configure your aircraft" tile. And whatever replaces it must keep **every part at the same place from one aircraft to the next** (the owner: "la vignette de livrée ne va faire que monter et descendre à chaque changement d'avion et les gens détestent ça"): today the variants take one to three rows and push the liveries down.

Once the setup panel gets its new block, Gallery in *Classic* and Default would differ only by the size of the aircraft tiles. So each view gets a character of its own: Gallery and List are always side by side, and the large-tile view, renamed **Showcase**, is the one with the liveries in the setup panel.

## What the user sees

### The views (the owner)

- The view tabs read **Gallery**, **List**, **Showcase** (Showcase in place of Default, same place). "Showcase" is longer than "Default"; the **three tabs keep the same width** (the owner, 2026-11-01, over a first plan that narrowed List), **110 units each** instead of 100 (the owner, once measured: "Showcase" needs 110 units with its padding and the selected tab's tick; Gallery 83, List 57), the sort dropdown of Gallery and List taking 30 units less, and **everything stays aligned as today** (the owner): the bar's edges, the Showcase tab's right edge on the livery column's edge (Gallery, List) and on the last column's edge (Showcase), to the pixel. Each label shows whole, the selected tab's corner tick clear of it, at every resolution checked; the narrowest tab the Showcase bar accepts over its last column is the room "Showcase" needs (narrower, the bar falls back to one line). Today the tabs are 100 units each in Gallery and List (`aircraft-gallery.css`), and share the last column equally in the Default view (`gallery-bar.ts`, the minimum `LAST_MIN_UNITS` in `default-grid.ts`).
- **Gallery** and **List** are always laid out side by side (today's *Side by side*); the setup panel there is unchanged (variants, statistics, tail number, buttons, no liveries).
- **Showcase**: on the right, today's Default view unchanged (two rows of large tiles, horizontal scrolling, the bar over the columns, no cut tile at rest); on the left, the new setup panel below.
- The *Layout* option is removed from the app (Features page) and from `mod/features.json`; the *Aircraft gallery* feature keeps no option. A settings file that still holds `layout` (any value) is read without complaint and without an adjustment shown to the user (*my call*); the value is dropped when the settings are next written.
- The gallery's memory: a stored view `stock` (Default) opens Showcase (*my call*: the internal id becomes `showcase`, `stock` read as `showcase`).

### The setup panel in Showcase (the owner)

Every part at a fixed place for a given screen size, whatever the aircraft, its variants and its liveries. From top to bottom, all as wide as the sim's title block:

1. **The sim's title block** (name, studio, variant), unchanged.
2. **The variants in a dropdown**, one row high: the sim's `Dropdown` (as the gallery's sort), showing the selected variant (*my call*: not the number of variants shown on the mockup, "4 variants ▾": the sim's dropdown shows only its current item's title). Opened, its list lies over the livery header and the large livery and **ends exactly on the large livery's bottom edge** (the owner chose this over a list ending anywhere, over one covering the whole livery block, and over arrows); its rows share that height in whole rows (the count nearest the sim's dropdown row height, each row in whole pixels), and it scrolls by whole rows past that. One variant: the dropdown shows it in its Disabled state and does not open (*my call*).
3. **The livery header**, as today: "Livery" and the name of the current livery.
4. **The current livery, large**, as wide as the panel, in the proportions of the sim's livery images: an arrow on each side for the previous and the next livery (in the panel's livery order: favourites first, as today), its position ("3 / 14"), its heart. The wheel over it moves to the previous or next livery (*my call*, shown on the mockup). At the first or last livery, the arrow toward the end is disabled (*my call*: no wrap-around).
5. **A strip of small liveries** under it, scrolling **horizontally**, that **fills its height** down to the tail number row (the owner, 2026-11-01, over a leftover of about 70 pixels under two rows of four whole thumbnails): whole rows, as many as come nearest to four thumbnails across (three on the owner's screen), the thumbnails in the sim's proportions, the last column showing in part; a click chooses the livery; the current one is outlined and scrolled into view. Each small livery keeps its heart, as today's thumbnails (*my call*: the mockup showed none; a favourite is set on the large livery or on a small one).
6. **Tail number** and its field, on one row (as today).
7. **Fuel and Payload**, **Identification** and **Configure your aircraft** side by side on one row: the sim's "Configure your aircraft" tile reduced to the height of the other buttons, its key (F) kept. In Showcase the left column is never narrower than the width where the three labels show whole, whatever the *Widen the left column* option (the owner, 2026-11-01: they fit with 5 pixels to spare at its default, 50 units, not under about 46); Gallery and List keep their widths.

The open variants list always reaches the large livery's bottom, even with few variants, an empty band under the last one (the owner, 2026-11-01).

The aircraft's statistics are not shown in Showcase (the owner: there is no fixed place for them; they still show in Gallery and List).

Nothing is left between the strip and the tail number but its scroll bar and a gap (the rows share the room, a pixel or two at most left over).

## Constraints

- The project's rules (CLAUDE.md): the sim's own components for everything visible (the dropdown, the livery images, the arrows, the scrolling elements; the mod's own SVG only for the heart and the eye); every sim component and manipulator API declared in `compat.json`; the sim's `real-scroll` for what scrolls, a recycling pool for a long list (the strip of an aircraft with hundreds of liveries); 250 ms layout passes writing only on change (`setVariable`, `setStyle`); `inputLocker` on everything clickable; every change to the sim through a `Scope` (the reduced Configure tile included, restored when the mod unloads); ES2017.
- Known traps (CLAUDE.md, Findings): the sim's `Dropdown` keeps its list's scroll position between openings (scroll it on opening, by whole items); visual states apply on the next frame (measure after a short delay); whole-pixel widths, the last item taking the rest; an element over a sim component but outside it takes the component's Hover state away.
- Each livery arrow, wheel step or strip click chooses the livery through the configurator (`sim/configurator.ts`, `syncConfiguratorToCurrent()` first), as a thumbnail click does today; rapid steps must not leave the sim on another livery than the one shown, nor freeze the panel.
- The three buttons of the bottom row: whole pixels, the last taking the rest; each label whole at every resolution checked (`tools/resolution-check/`, the resolutions of 2.0.2). If a label cannot show whole at some resolution, stop and ask the owner (the sim's texts are not shortened).
- The view tabs: measured in the three views, before and after, at every resolution checked: the bar's edges and the last tab's right edge unchanged to the pixel.
- Verified by measuring in the sim (`getBoundingClientRect`): the same top and bottom of every part for an aircraft with one variant, one with four, and the iFly 737 MAX (one variant per livery); the open dropdown's bottom on the large livery's bottom, to the pixel; the panel's blocks on the title block's edges; then the owner's screenshots.
- Tests (node:test) for the pure parts: the fixed places, the dropdown's rows, the strip's rows, the bottom row's widths; the gallery memory reading `stock`; the settings with a stale `layout` (mod and app).
- Documentation: user guide, `mod/README.md`, the app's Readme page if it names the views or the layout, `docs/next-steps.md`, CLAUDE.md.

## Non-goals

- Changing the right side of Showcase (the large tiles and their scrolling, 2.0.1).
- Changing the setup panel of Gallery and List, or their side by side layout.
- Keeping *Classic* as an option.
- Gamepad or keyboard navigation (the mod's panels are mouse only).
- Removing the *choice* option type from the contract (it stays, tested by its own test catalogue).

## Left to the builder

- Which sim components make the large livery (the image source with enough resolution: the livery column of the side by side layout already shows large livery images), the arrows and the disabled arrow; to be found in `fs-base-ui` and `cookedcomps` and declared in `compat.json`. If the sim has no arrow component that fits, stop and ask the owner.
- How the sim's "Configure your aircraft" tile is reduced (it lives in `Fleet_Details`, whose statistics the panel already hides) while keeping its key and its click.
- How the strip scrolls horizontally (`real-scroll direction="x"` as the Showcase grid, or the grid's own mechanism) and its wheel step.
- How fast livery steps reach the configurator (each one, or the last after a short settle), measured in the sim.
- How the code is shared with the current panel (the Gallery and List panel keeps today's code paths) and with the Showcase grid.
- The exact metrics at 1080, 1440 and 2160 lines.
