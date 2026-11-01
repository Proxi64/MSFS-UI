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

1. **The title on three lines at a fixed height** (the owner, 2026-11-01: the sim wraps a long name on two lines, which moved everything under it, 38 pixels on the DHC-2 at 1440 lines): the **model** large, the **brand**, the **studio**, one line for brand and studio when they are the same. The sim's display name is always brand + model (checked on 149 aircraft: longest model 35 characters, 2 empty brands, 1 empty model: the display name then takes the model's line). The variant is no longer in the title, only in its row. A brand of the form "X, a Y company" shows Y ("De Havilland Canada"). A model too long for its line has its text reduced to fit, never cut, never wrapped. The same title in Gallery and List (the owner).
2. **The variants in a dropdown**, one row high, **in the livery header's style** (the owner's Paint mockup of 2026-11-01, over a first version where the dropdown was a plain button): "Variant" on the left, the selected variant and the dropdown's arrow on the right, with always a gap after the word; **the model when the variants' models differ** (some add-ons declare a livery as the variant's name: the 146-200QC's variants read "146-200 QC Royal Air Force, 32 Squadron, ZE708 CMk3" and their models 146-200, 146-200QC, 146-200QT), in the row and in the list, else the sim's title; the sim's `Dropdown` (as the gallery's sort), showing the selected variant (*my call*: not the number of variants shown on the mockup, "4 variants ▾": the sim's dropdown shows only its current item's title). Opened, its list lies over the livery header and the large livery and **ends exactly on the large livery's bottom edge** (the owner chose this over a list ending anywhere, over one covering the whole livery block, and over arrows); its rows share that height in whole rows (the count nearest the sim's dropdown row height, each row in whole pixels), and it scrolls by whole rows past that. One variant: the dropdown shows it in its Disabled state and does not open (*my call*).
3. **The livery header**, as today: "Livery" and the name of the current livery.
4. **The current livery, large**, as wide as the panel, in the proportions of the sim's livery images: an arrow on each side for the previous and the next livery (in the panel's livery order: favourites first, as today), its position ("3 / 14"), its heart. The wheel over it moves to the previous or next livery (*my call*, shown on the mockup). At the first or last livery, the arrow toward the end is disabled (*my call*: no wrap-around).
5. **A grid of small liveries** under it, **three per row, two whole rows at most in view, never a cut thumbnail**, scrolling vertically **row by row** (the owner, 2026-11-01, on seeing four per row too small in the sim): one thumbnail size for every aircraft, in the sim's proportions; six liveries or fewer: no bar and the columns spread to reach both edges of the panel; more: the sim's bar on the right and the columns closer; a click chooses the livery; the current one is outlined and scrolled into view. Each small livery keeps its heart.
6. **The bottom block, two rows high, in two columns** (the owner's Paint mockup of 2026-11-01, over a first version with the three buttons on one row): on the left the sim's **"Configure your aircraft" tile as the sim draws it** (its text size, gradient, key F, cockpit drawing as far as it fits), as high as the two rows and their gap; on the right **Tail number** and its field on the first row, **Fuel and Payload** and **Identification** on the second. The right column is **as wide as its labels need** (the wider of its two rows), the Configure tile takes the rest (the owner). In Showcase the left column is never narrower than the width where those labels show whole and the Configure tile keeps its own text whole, whatever the *Widen the left column* option (the owner, 2026-11-01); Gallery and List keep their widths.

The owner's marks on a screenshot (2026-11-01): (a) **the same gap between the blocks as seen**, to the pixel, at every resolution: title block, Variant row, Livery row, large livery, grid of small liveries (the panel's gap, whole pixels); (b) **the livery images fill their button's whole box**, so the large livery reaches the panel's left and right edges (the sim's livery button insets its `Image` by 3 units; the mod's rule sets it to 0, still cropped and not squeezed) and, the same for the thumbnails, the grid's outer columns reach the edges, the selected outline staying on the cell's edge; (c) **the right column's two rows share one vertical line**: the tail title is as wide as Fuel and Payload and its field as wide as Identification (first column the wider of the two, second column the wider of the two, the Configure tile the rest).

The open variants list always reaches the large livery's bottom, even with few variants, an empty band under the last one (the owner, 2026-11-01).

The aircraft's statistics are not shown in Showcase (the owner: there is no fixed place for them; they still show in Gallery and List).

**The gaps between all the blocks** (title, Variant, Livery, large livery, thumbnails, bottom block) **are equal, to the pixel, and share the room left** (the owner, 2026-11-01): about 7.8 units at the default column, computed for every resolution from 720 to 4320 lines; the 0 to 3 pixels of rounding go to the large livery's height.

**Nothing of this depends on the aircraft.** The left column in Showcase is capped at about 90 units over the sim's (the *Widen the left column* option has no effect above; computed: 130 leaves no gap and 200 overflows). If long labels in another language need more, the column follows them and the large livery gives up height as a last resort, cropped toward the top, the gaps staying at their minimum (the owner chose this: the crop never varies from one aircraft to the next).

### The sorts (the owner, 2026-11-01)

In the gallery's sort dropdown (all three views): **Model**, **Manufacturer**, **Studio**, in that order, instead of Name, Studio, Max range. *Model* sorts on the model ("Cessna Citation Longitude" under C, no longer under T with Textron), labelled with the sim's own word (`TT:MANUFACTURE.BREADCRUMB.MODEL`: "Model", "Modèle"); *Manufacturer* sorts on the brand as shown ("X, a Y company" as Y: the DHC-2 under De Havilland Canada), then on the model, the aircraft without a brand last; the English word, as "Studio" (the sim has no key for it alone in its menus; its texts say "manufacturer", French "constructeur"); *Studio* as today. A model or brand missing: the display name stands in for it. Max range goes. A remembered sort on the name or on Max range opens on Model; the direction button and favourites first as today.

### The aircraft tiles of Showcase (the owner)

The banner on four lines: the **model** (A319 | CFM | WF), the **brand** (Airbus), the **variant** (Standard Density), and the **studio always on the banner's lowest line** (FenixSim), the variant's line empty when there is none. Model and brand in the name's bold style, variant and studio lighter. A line too long (about 44 characters fit: a long brand, a livery declared as the variant) has its text reduced to fit, never cut. The tiles of Gallery do not change (the owner: no room there; to be looked at again after seeing Showcase).

## Constraints

- The project's rules (CLAUDE.md): the sim's own components for everything visible (the dropdown, the livery images, the arrows, the scrolling elements; the mod's own SVG only for the heart and the eye); every sim component and manipulator API declared in `compat.json`; the sim's `real-scroll` for what scrolls, a recycling pool for a long list (the grid of an aircraft with hundreds of liveries); 250 ms layout passes writing only on change (`setVariable`, `setStyle`); `inputLocker` on everything clickable; every change to the sim through a `Scope` (the moved Configure tile included, restored when the mod unloads); ES2017.
- Known traps (CLAUDE.md, Findings): the sim's `Dropdown` keeps its list's scroll position between openings (scroll it on opening, by whole items); visual states apply on the next frame (measure after a short delay); whole-pixel widths, the last item taking the rest; an element over a sim component but outside it takes the component's Hover state away.
- Each livery arrow, wheel step or click in the grid chooses the livery through the configurator (`sim/configurator.ts`, `syncConfiguratorToCurrent()` first), as a thumbnail click does today; rapid steps must not leave the sim on another livery than the one shown, nor freeze the panel.
- The bottom block's two columns: whole pixels, the Configure tile taking what the right column leaves; each label and the tile's text whole at every resolution checked (`tools/resolution-check/`, the resolutions of 2.0.2). If a label cannot show whole at some resolution, stop and ask the owner (the sim's texts are not shortened).
- The view tabs: measured in the three views, before and after, at every resolution checked: the bar's edges and the last tab's right edge unchanged to the pixel.
- Verified by measuring in the sim (`getBoundingClientRect`): the same top and bottom of every part for an aircraft with one variant, one with four, and the iFly 737 MAX (one variant per livery); the open dropdown's bottom on the large livery's bottom, to the pixel; the panel's blocks on the title block's edges; then the owner's screenshots.
- Tests (node:test) for the pure parts: the fixed places, the dropdown's rows, the grid's cells and reveal, the bottom block's columns; the gallery memory reading `stock`; the settings with a stale `layout` (mod and app).
- Documentation: user guide, `mod/README.md`, the app's Readme page if it names the views or the layout, `docs/next-steps.md`, CLAUDE.md.

## Non-goals

- Changing the right side of Showcase (the large tiles and their scrolling, 2.0.1).
- Changing the setup panel of Gallery and List, or their side by side layout.
- Keeping *Classic* as an option.
- Gamepad or keyboard navigation (the mod's panels are mouse only).
- Removing the *choice* option type from the contract (it stays, tested by its own test catalogue).

## Left to the builder

- Which sim components make the large livery (the image source with enough resolution: the livery column of the side by side layout already shows large livery images), the arrows and the disabled arrow; to be found in `fs-base-ui` and `cookedcomps` and declared in `compat.json`. If the sim has no arrow component that fits, stop and ask the owner.
- How the sim's "Configure your aircraft" tile is moved into the bottom block (it lives in `Fleet_Details`, whose statistics the panel already hides) while keeping its look, its key and its click.
- How the grid of small liveries scrolls (`real-scroll direction="y"`) and its wheel step.
- How fast livery steps reach the configurator (each one, or the last after a short settle), measured in the sim.
- How the code is shared with the current panel (the Gallery and List panel keeps today's code paths) and with the Showcase grid.
- The exact metrics at 1080, 1440 and 2160 lines.
