# User guide

MSFS-UI improves the main menu of **Microsoft Flight Simulator 2024**. It has two parts:

- **MSFS-UI-GENERATOR**, a Windows app: you choose the features, it generates the `msfs-ui` package, installs it in the sim's Community folder, and checks that the sim still offers what the mod needs;
- the **`msfs-ui` package**, the mod itself, which runs inside the sim's menu.

Developed on MSFS 2024 1.9.18 and tested on 1.9.21 (Steam), base UI package `fs-base-ui` 0.1.10.

## Contents

- [Install and first run](#install-and-first-run)
- [The app](#the-app): Home, Features, Compatibility, Log, Readme
- [The mod in the sim](#the-mod-in-the-sim): fast menus, weather and time bar, wheel on the time, Free Flight favourites, aircraft gallery and list, setup panel, tail number per livery
- [After a sim update](#after-a-sim-update)
- [Troubleshooting](#troubleshooting)

## Install and first run

1. Copy the `MSFS-UI-GENERATOR` folder anywhere and run `MSFS-UI-GENERATOR.exe`. Nothing else needs installing: .NET and the Windows App SDK ship with it.
2. The **Home** page finds the sim (Steam or Microsoft Store). If it does not, **Choose folders…** asks for the Community folder, then for the sim's `fs-base-ui` folder.
3. **Generate & install** puts the `msfs-ui` package in Community.
4. Start (or restart) the sim: it reads a new package only at start-up.

Version 2.0 also puts a small module, `msfs-ui.wasm`, in the package: it keeps your favourites, tail numbers and last choices in files of its own folder (`%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\msfs-ui\work`), written at once. The sim loads a module only when it starts, so the first install of 2.0, and every installation that adds the module, needs a **restart of the sim** (the app says so). At the first start of 2.0, the favourites, tail numbers and last choices kept by version 1.x are copied into it.

The app keeps its own data in `%LOCALAPPDATA%\MSFS-UI-GENERATOR`: your feature settings (`settings.json`), the folders chosen by hand and the theme (`app.json`), and the log files. Earlier versions used `%LOCALAPPDATA%\MSFS-UI`; that folder is moved there the first time.

To remove the mod: **Remove** on the Home page, then restart the sim. The mod never changes a file of the sim: only the `Community\msfs-ui` folder is involved.

## The app

The navigation is on the left; **Readme**, at the bottom, explains how the app and the mod work, and that no file of the sim is modified. The sun / moon button on the right of the title bar switches between the light and dark themes; until you use it, the app follows Windows.

### Home

- **Microsoft Flight Simulator 2024**: how the sim was found (Steam, Microsoft Store or folders chosen by hand), whether it is running, the `fs-base-ui` version and the Community folder. **Choose folders…** replaces the detection; **Use detected folders** goes back to it.
- **msfs-ui package**: its state, with the reasons when it should be generated again:
  - *Installed and up to date*;
  - *Installed, update needed*: the sim was updated, the settings changed, or the package comes from another version;
  - *Not installed*;
  - *Another msfs-ui folder is in Community*: a folder the app did not create, which it never touches.

  Other Community packages that also replace the menu's root page are listed: only one of them can win.
- **Generate & install** builds the package from the sim installed on this machine and your settings, and installs it. When the sim is running and only reads the files again, the mod is reloaded at once; when a restart is needed (first install, sim update), the app says so. If the reload does not get through (the sim's menu not on screen), the package is installed all the same: use **Reload in sim** later. While an installation or a removal runs, from Home or from Features, the other actions wait for it.
- **Reload in sim** reloads the mod in the running sim.
- **Remove** deletes the package, after confirmation. If the running sim holds one of its files, the removal stops and says so: the package stays recognised, and **Remove** works once the sim is closed.

### Features

One card per feature of the mod, with its switch, its description and the screen where it acts. A feature with options opens to show them: switches, numbers with their range, step and unit, and choices as radio buttons (the selected choice's explanation under the option's). Options are inactive while their feature is off.

- **Apply** saves the choices. When the package is installed, it is updated (only the settings change) and, when the sim is running, the mod is reloaded: the change is live at once, without restarting the sim.
- **Discard changes** goes back to the saved choices; **Reset to defaults** shows the defaults, which **Apply** then saves.
- Settings saved by a newer version of the app are shown as this version understands them, with a warning; **Apply** asks before replacing them, since the choices only the newer version knows would be lost.
- *Unsaved changes* shows while something differs from what is saved. Changes not applied are kept when you visit another page.

### Compatibility

What the mod needs from the sim, checked in the sim's files and, while the sim runs, in its main menu. It runs when the page opens; **Check again** runs it again. The checks are grouped; a group with a failure is open and shows what went wrong. After a sim update, a failure tells which features may no longer work.

### Log

- **App**: what the app did, live (also written to `%LOCALAPPDATA%\MSFS-UI-GENERATOR\logs`, one file per day, kept 30 days).
- **Mod in the sim**: the mod's own lines, read from the console of the sim's main menu (the sim must be running). **Read again** reads them again.
- **Copy** copies the log shown; **Open log folder** opens the folder of the log files.

## The mod in the sim

Everything the mod shows is made of the sim's own components (tiles, buttons, tabs, text fields, scroll bars), so it looks and behaves like the rest of the menu. When the mouse is over one of the mod's panels, neither the click nor the wheel reaches the map or the scene under it.

### Fast menus

**Where:** every menu screen.

- The menu's animations (panels appearing, transitions) are shorter: twice as short by default (option *Animation speed*, 1 keeps the sim's speed). Looping animations, such as loading indicators, keep their pace.
- Images show as soon as they are loaded, without the sim's half-second fade (option *Images without fade*).

### Weather and time bar

**Where:** Free Flight, right column, just under the sim's *Flight Conditions* widget.

When an airport (or an aircraft of the traffic) is selected on the map, the sim shows its card in the same column. Two tabs then appear under the widget, **Weather** and **Airport** (or **Traffic**): only the chosen one shows. Without such a card, the tabs disappear.

The map buttons under the column (*Legend*, *Map Layers*, *World Map display*) open their panel in the same place: the bar steps aside while it is open, and comes back when it is closed with its button.

| Section | Content |
|---|---|
| **Weather** | One icon per weather preset of the sim (Live, clear skies… thunderstorm, the last custom weather). A click applies it, as in the sim's panel; the preset's name shows on hover |
| **METAR** (option *METAR section*) | The real weather at the departure airport: its flight category in colour (VFR, MVFR, IFR, LIFR), then wind, visibility, clouds and temperature. Out of Live weather, a second line gives the **simulated** weather at the departure, to compare. Shown only with a departure airport |
| **Time** | The local time of the departure, and **Now**, **Dawn**, **Day**, **Dusk**, **Night** |
| **Air traffic**, **Multiplayer** (option *Traffic section*) | The sim's buttons (Live / AI / Off, Live / All Players / Off), without opening its panel. A button the sim makes unavailable (multiplayer offline) is inactive |

The time buttons follow the widget's mode:

| Button | In Live weather (red 24-hour timeline) | Out of Live (custom time) |
|---|---|---|
| **Now** | Back to the present | Back to the real time (Live) |
| **Dawn** / **Day** / **Dusk** / **Night** | Back to the last sunrise / solar noon / sunset / solar midnight of the last 24 hours, with the real weather of that moment | Sets the departure time to that moment |

The sun times are computed for the departure airport and its date. Without a departure (or during polar day or night), the bar uses 6:00, 12:00, 18:00 and 0:00. When the departure airport changes while a moment is selected, the time follows the new place.

**Last choice remembered** (option *Remember the last choice*): the last preset, time button and traffic choices clicked in the bar are applied again the first time the bar shows after the sim starts. (At start-up the sim activates Free Flight behind the scenes, then resets the flight conditions: a choice applied earlier would be lost.)

### Mouse wheel on the time

**Where:** Free Flight, over the *Flight Conditions* widget (the time and the timeline).

| Gesture | Effect |
|---|---|
| Wheel up / down | One minute later / earlier per notch (option *Step*) |
| Shift + wheel | Ten minutes per notch (option *Step with Shift*) |

In Live weather the wheel moves within the last 24 hours and stays live; out of Live it changes the departure time on the same date. Fast notches add up correctly.

### Favourites on Free Flight

**Where:** Free Flight, left column, under *Search location*, as wide as the aircraft button. The block hides while the search shows its results.

- One row per **favourite livery** (the bookmark of the liveries in the aircraft selection).
- Each row shows the livery's thumbnail, the aircraft's name, then its variant, livery and tail number. A text too long for the row scrolls when the mouse is over it.
- **Click**: loads the variant, then the livery; the sim's aircraft button follows. The row of the current aircraft is selected.
- **Bookmark**: clicking it removes the favourite livery.
- **Order**: from the most recently used, computed when the screen opens, then kept while it stays open, so that a clicked row does not jump under the mouse.
- The use of each aircraft (last livery per variant) is recorded at every change of aircraft, whatever the screen.

### Aircraft gallery and list

**Where:** aircraft selection (*Change Aircraft*), in place of the sim's grid. The sim's category tabs (All, Airplane, Helicopter…) still apply.

| Control | Role |
|---|---|
| Search field | Filters by name, publisher or variant at each key press; several words must all match; accents and case are ignored |
| Count | Aircraft shown / aircraft of the tab |
| **Hidden** | Shows the hidden aircraft only (see *Hiding aircraft* below). Left of *Favorites*; the two are never on together |
| **Favorites** | Shows the favourites only, with one tile per favourite livery |
| Sort | **Name** (natural order: ATR 42, ATR 72, Cessna 172), **Studio** (then name) or **Max Range** (the sim's sort); the arrow reverses the order. A new order starts from the top |
| **Gallery** / **List** / **Default** | Tiles in columns; one compact row per aircraft; the sim's own grid |

- **Favourites are liveries**: an aircraft is a favourite as soon as one of its liveries is (of any of its variants). Favourite aircraft always come first, whatever the sort. The order is set when the screen opens and kept while it stays open, so that an aircraft does not jump away when you mark one of its liveries; it is set again on a new sort, search, filter or category tab.
- **Gallery**: the sim's aircraft tiles, with the name, the variant and the studio on three lines. **List**: one row per aircraft, the thumbnail then *name - studio - variant* on one line.
- Both views scroll with the wheel or the sim's scroll bar; a text too long for its tile scrolls on hover.
- **Click** selects the aircraft, exactly like a tile of the sim; **hover** shows it in the header of the left column, unless the setup panel is shown: the header then stays on the selected aircraft, whose variants and tail number the panel shows.
- **No bookmark on the aircraft**: the bookmarks (a bookmark with a star, in the top right corner, in the sim's yellow on a favourite) are on the liveries (the setup panel's thumbnails, or the livery column in the side by side layout). The **Favorites** filter shows one tile per favourite livery, with its bookmark to remove it; a click loads the aircraft with that livery. Switching the **Hidden** or **Favorites** filter scrolls the list back to the top.
- **Hiding aircraft**: every aircraft tile and row has a slashed eye in its top right corner (not the Favorites tiles, nor the liveries). A click hides the aircraft, with all its variants: it leaves the three views. The **Hidden** filter shows the hidden aircraft; a click on the eye there brings one back, and the view says *No hidden aircraft: click the eye on an aircraft to hide it.* when none is hidden. An aircraft with a favourite livery stays among the favourites, darkened, with a large slashed eye on its image. The count shows the aircraft shown / those of the tab.
- On opening, the gallery scrolls to the selected aircraft. The view, the Hidden and Favorites filters and the sort are remembered.
- **Default** is drawn by the mod too, with the same bar, filters, sorts, eyes and bookmarks as Gallery and List, in the sim's own layout: its large tiles in two rows, scrolling sideways. The grid stops on whole columns, aligned on the scroll bar: one wheel notch moves one column, and a column dragged by the bar settles on the nearest one.

**Layout** (option of the feature in MSFS-UI-GENERATOR):

| Layout | What the aircraft selection shows |
|---|---|
| **Classic** | The gallery fills the right side; the liveries are small thumbnails in the setup panel |
| **Side by side** (default) | The aircraft on the left part of the gallery, three per row; the liveries of the current aircraft on the right part, two per row, as large as the aircraft tiles. The left column keeps the variants, the tail number and the Fuel and Identification buttons, without the livery thumbnails, and is narrower (400 layout units) |

In the side by side layout:
- the bar is split over the two columns: search, count, *Hidden* and *Favorites* above the aircraft; sort, direction, *Gallery*, *List* and *Default* above the liveries (the count shortens first when the controls do not fit). In the Classic layout the bar stays on one line;
- each livery tile shows the livery's thumbnail whole, its name and its tail number (the one you chose for it, else the `atc_id` of its `livery.cfg`, else a registration found in its name; nothing when none is found);
- **List** shows both sides as rows, on two lines: the aircraft's name then *studio · variant*; the livery's name then its tail number;
- a click on a livery changes it, as in the setup panel; the bookmark marks it as a favourite; hovering shows its name above the column, which opens on the selected livery;
- **Default** brings the sim's grid back, and the setup panel its thumbnails.

### Aircraft setup panel

**Where:** aircraft selection, left column, in place of the aircraft's statistics. The column is widened (option *Widen the left column*, 50 layout units by default; 0 keeps the sim's width). In the gallery's side by side layout, the panel has no livery thumbnails (they are in the gallery) and the column is 400 units wide instead.

| Section | Content |
|---|---|
| **Variant** | One tile per variant, up to three per row (fewer when the names are long); a click changes the variant (the sim then puts back its first livery) |
| **Livery** | The livery thumbnails, three per row, favourites first; the active one is framed. Its name shows next to the title, the hovered one's on hover. A click changes the livery. A bookmark on each thumbnail marks it as a favourite (for the variant shown) |
| **Tail number** | The tail number of the current livery (letters, digits, dash; 9 characters at most) |
| Buttons | **Fuel and Payload** and **Identification** open those tabs of the sim's configurator directly |

The variants and the liveries share the panel's height. Each list scrolls with the mouse wheel and shows the sim's scroll bar when it needs more room. Under many variants (some aircraft make one variant per livery), the liveries keep at least two rows in view, and the variants at least three; the variants list opens on the selected one.

Everything happens without opening the configurator and its 3D preview. Typing in the tail number field turns the sim's keyboard shortcuts off until you click elsewhere; the number is sent when you leave the field or press Enter.

The panel always sets the sim's configurator on the current aircraft before acting: a choice sent to a released configurator would make the current aircraft invalid (empty left column). If it cannot, the click is ignored and the lists are read again: click again.

### Tail number per livery

**Where:** everywhere, in the background.

The sim has one tail number field for all aircraft. The mod gives each livery its own number. At each change of aircraft, variant or livery it applies, in this order:

1. the number you chose for this livery, if any;
2. otherwise the livery's own: `atc_id` in its `livery.cfg`, or a registration found in its name (`F-GKXA`, `HB-JVA`, `N561AJ`…);
3. otherwise the default number, read once from the sim's field (`ASXGS` on the sim as installed).

A number is remembered for the current livery as soon as you change the tail number, in the setup panel or in the sim's Identification tab.

## After a sim update

1. Open the app: the Home page says *Installed, update needed* with *The sim was updated since* when the menu's root page changed.
2. **Generate & install**, then restart the sim.
3. Open **Compatibility** with the sim running and its main menu displayed. A failure lists what disappeared or changed; the features that use it may not work until the mod is updated (they can be turned off on the Features page meanwhile).

## Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| The sim's menu is broken | The mod, or another package that replaces the same page | **Remove** on Home and restart the sim: the original menu always comes back |
| No change in the sim after installing | The sim reads a new package only at start-up | Restart the sim |
| Home: *Other packages replace the same menu page* | Another Community package replaces the menu's root page too | Remove one of them |
| Home: *Sim not found* | Neither Steam nor the Microsoft Store installation was found | **Choose folders…** |
| The left column of the aircraft selection is empty | The current aircraft became invalid (a choice sent to a released configurator) | Click an aircraft in the gallery; otherwise leave and reopen the screen |
| A favourite does not load (*not in the list*) | The aircraft is not in the category tab chosen in the aircraft selection | Choose the *All* tab |
| The Favorites block disappears on Free Flight | *Search location* shows its results | Normal: it comes back when the results close |
| METAR shows *No METAR* | No answer from the sim within 4 s, or no station | Choose the departure again |
| *Ceiling 400 ft* instead of a cloud cover | Out of Live weather, the sim's METAR keeps the ceiling but not the cover | Normal |
| Favourites, tail numbers or the last weather choice lost after a restart (2.0) | The module did not answer, so the mod fell back on the sim's own storage, which reaches the disk less reliably (the module is read only when the sim starts; or the package was installed without it) | Restart the sim after installing. **Compatibility**, group *Storage*, says which storage is in use and why the module did not answer (for example *the vault module did not answer within 3000 ms*) |
| Favourites, tail numbers or the last weather choice lost after a restart (1.x) | The sim writes its storage to the disk only when it saves its profile; the mod asks for that save after each change (2 s after the last), by validating the sim's option *Show the white dot cursor in freelook* with its current value. A version before 1.2.0 did not | Update to 1.2.0. If it still happens, open **Compatibility**: the live check *the option re-validated to save the profile* says whether the sim still offers that option |
| The same tail number on every aircraft | Numbers typed before the per-livery memory, or liveries without a number | Type the number wanted for each livery |

The **Log** page (tab *Mod in the sim*) shows the mod's messages and errors; include them when reporting a problem.
