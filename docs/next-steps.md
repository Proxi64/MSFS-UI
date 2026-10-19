# Next steps

Where MSFS-UI stands, and what is suggested next, in order. Each step is presented, approved, done, validated in the sim, then committed, one at a time (see the working method in [development.md](development.md#working-method)). Last updated on 2026-10-19 (after the code review of the mod).

## Where things stand

- **Version 1.0.0** is done: the app MSFS-UI-GENERATOR (Home, Features, Compatibility, Log, Readme) and the `msfs-ui` mod, at parity with 0.3.0 and rebuilt from the sim's own components. Tested on MSFS 2024 1.9.18 (Steam), `fs-base-ui` 0.1.10: 163 compatibility checks pass (111 offline, 52 live).
- The release (`build-release.ps1`) gives a self-contained folder of 218 MB and a zip of 81 MB, without personal data.
- The Git history was started again on 2026-10-19, from version 1.0.0, without personal data. It is not published yet.
- The package installed in the sim's Community folder is a development build of 1.0.0 with the mod's review fixes.
- Code reviews of 2026-10-19: the mod's points 1 to 4 are fixed (the rest is under Maintenance below); every point of the app's review is fixed (removal that keeps the package recognised, installations one at a time, reload failures as warnings, newer settings replaced only after a confirmation, sturdier inspector and live probe, refresh off the UI thread, logs kept 30 days, automation ids, theme text styles). The release folder still holds 1.0.0 as built before them: build it again before publishing it.

## 1. Before new features

| # | Step | Why | How |
|---|---|---|---|
| 1.1 | Publish the repository | The local repository has no remote | GitHub Desktop: *File › Add local repository* on the project folder, then *Publish repository* under the Proxi64 account, private or public |
| 1.2 | Install 1.0.0 in the sim | Community still holds 1.0.0-dev | Run `release\MSFS-UI-GENERATOR\MSFS-UI-GENERATOR.exe`, **Generate & install**, restart the sim, then the **Compatibility** page with the main menu displayed |
| 1.3 | Try the release on a clean Windows (optional) | The release should run without .NET or the Windows App SDK installed; this has not been tried on another machine yet | Copy the folder into Windows Sandbox and run the exe: the Home page should open and say *Sim not found* |
| 1.4 | Publish a GitHub release (optional) | A download for other users | After 1.1: tag `v1.0.0`, attach `release\MSFS-UI-GENERATOR-1.0.0.zip` |

## 2. New features (step 6)

The candidates, with what the sim offers for each, are analysed in [feature-ideas.md](feature-ideas.md). The suggested order:

| Order | Feature | Effort | Why in this order |
|---|---|---|---|
| 6a | [A1](feature-ideas.md#a1-favourite-and-recent-airports) Favourite and recent airports | M | Choosing the departure becomes as quick as choosing the aircraft; brings the "choose an airport by ICAO" brick that 6b to 6d reuse |
| 6b | [A2](feature-ideas.md#a2-departure-spot-remembered-per-airport) Departure spot remembered per airport | S | Small, no UI; completes A1 |
| 6c | [A3](feature-ideas.md#a3-runway-advised-by-the-wind) Runway advised by the wind | M | Uses the METAR already shown by the weather bar |
| 6d | [A5](feature-ideas.md#a5-flight-scenarios) Flight scenarios | L | The strongest feature: assembles the aircraft loading, A1, A2, the weather bar and the traffic |

Then, as wanted:
- quick ones (effort S): [B3](feature-ideas.md#b3-departure-date) departure date, [C1](feature-ideas.md#c1-map-filters-remembered) map filters remembered (first check whether the sim already keeps them), [E2](feature-ideas.md#e2-cleaner-menu-bar) cleaner menu bar;
- in flight: [F1](feature-ideas.md#f1-flight-card-in-the-pause-menu) flight card and [F2](feature-ideas.md#f2-weather-and-time-from-the-pause-menu) weather and time in the pause menu;
- separate projects, with another mechanism than the menu mod: [H1](feature-ideas.md#h1-in-flight-toolbar-panel) in-flight toolbar panel, [H2](feature-ideas.md#h2-automatic-logbook) automatic logbook.

Each new feature adds a minor version (1.1.0, 1.2.0…): `modVersion` in `mod/features.json`, `version` in `mod/package.json` and `<Version>` in `generator/Directory.Build.props`.

### 6a in detail: favourite and recent airports

**What.** On Free Flight, under the aircraft favourites of the left column, an *Airports* section:
- one row per favourite airport and per recent departure: ICAO code, name and city;
- a click on a row sets the airport as the departure; a small button sets it as the arrival;
- the sim's heart on the current departure's row adds it to the favourites or removes it, as for the aircraft.

**Exploration in the sim first** (sim running; every change put back afterwards):
1. `ON_DEPARTURE_AIRPORT_SELECTED(index, database)` really sets the departure (read in the sim's code, never triggered yet);
2. a search for an exact ICAO (`LFBZ`) returns that airport first, or needs `SetSearchParams`;
3. what happens when the sim's own drop-down list is open at that moment.

**Code.**
- `mod/src/sim/airport-search.ts`: search, wait for the exact ICAO, select, wait for the sim's confirmation (`departure.worldLocation.iCAO`), with a bounded wait;
- `mod/src/features/favorite-airports/`, made of the sim's components (`Marketplace_Tile_Horizontal` rows, `IconButton_Light_Wishlist` heart, `real-scroll`), with its pure parts tested;
- `features.json` (feature `favoriteAirports` and its options) and `compat.json` (listener, events, paths, components);
- data in the sim's storage: `MSFS_UI_FAVORITE_AIRPORTS`, `MSFS_UI_RECENT_DEPARTURES`;
- the app shows the new feature on its Features page by itself; only the shared `config.js` fixtures are generated again.

**Open questions for the user.**
- Placement: a second section under the aircraft favourites, or *Aircraft* / *Airports* tabs in the same card?
- Options: show the recent departures or not, and how many (0 to 10, 5 by default)?
- The *arrival* button on each row: now, or the departure only at first?

## 3. Maintenance

| Item | Why | Effort |
|---|---|---|
| Translate `tools/msfs-sdk-mcp` into English | Its code, tool descriptions and messages are still in French (it came from another project); the project's rule is English everywhere | S |
| Livery thumbnails of the setup panel in the sim's `real-scroll` | They still scroll with the mod's own `wheel` handler (`mod/src/features/aircraft-setup/panel.ts`), unlike the gallery and the Free Flight favourites; the sim's scroll bar would show | S |
| A *choice* option type in `features.json` | Only `boolean` and `number` exist; features such as E1 / E2 (which tiles or icons to hide) need a list. Both readers change: the mod's build and settings validation, and the app's catalogue, settings normaliser and Features page | M, when first needed |
| Rest of the mod's code review (2026-10-19) | Points 1 to 4 are fixed (blocked weather bar, bounded waits, livery of the right variant, the sim's sort put back). Left: `Scope.timeout` keeps its cleanup after firing; the setup panel's wheel takes a horizontal scroll for an upward one (gone with `real-scroll`, above); the gallery's *List* tab is translated when the module loads; duplicated manipulator types and the tail number lookup; dead code (`button`, `loadSvg`, `deleteData`, `icons.ts`) and stale comments; `text-overflow: ellipsis` that the engine ignores, and the studio gradient written twice. Optional: typed reads of the data model, the aircraft list read item by item (to measure), accents in the search | S |
| After every sim update | The mod depends on undocumented parts of the menu | **Generate & install**, then **Compatibility** with the sim running; update [sim-reference.md](sim-reference.md), `compat.json` and the tested version in the README and the user guide |

## Not planned

- Backup and restore of the mod's data: removed on 2026-10-19 (not needed).
- Removing the departure and arrival by a gesture on the map: tried and abandoned (see [feature-ideas.md](feature-ideas.md#out-of-reach-or-not-advised), with the other leads out of reach).
