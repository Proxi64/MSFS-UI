# Feature ideas

Features that could be added to the mod, with what the sim offers for each, a proposed design, the unknowns and an estimate. It is the list to pick the next versions from.

**Status:** B1, B2 and D1 are done (since 0.3.0, rewritten in 1.0); G1 is done by MSFS-UI-GENERATOR (the Features page applies the settings to the running sim). G2 (backup and restore) was in 0.3.0 and the first 1.0 builds, then removed on 2026-10-19 at the user's request: not needed. The rest is not implemented. The order suggested for the next versions, and the design of the first one (A1), are in [next-steps.md](next-steps.md).

## Method

Research of 16 October 2026 on sim **1.9.18** (`fs-base-ui` 0.1.10):

- **offline**, in the menu's files (`html_ui\Global\*.js`, `cookedcomps\*.html`): 657 data-model paths, 805 component classes, 51 navigation events, and the code that calls the candidate actions, to learn their parameters;
- **live**, with the inspector, **read only**: screen registry, real values of the candidate paths on Free Flight (departure LFBZ), airport search by ICAO, then in flight with the pause menu open.

No candidate action was triggered: what changes the sim's state (choosing a departure, a runway, launching the flight…) is "read in the code", not verified yet.

| Mark | Meaning |
|---|---|
| Feasibility **verified** | The data was read in the sim and the action has a known form (read in the sim's code) |
| Feasibility **likely** | Paths and events found in the code, not read or tested in the sim yet |
| Feasibility **to explore** | A lead, with unknown data or parameters |
| Effort S / M / L | A few hours / one or two days / several days |
| Risk | Chance of breaking the menu, or of depending on a fragile API |

## Summary

| # | Feature | Screen | Feasibility | Effort | Value | Risk |
|---|---|---|---|---|---|---|
| [A1](#a1-favourite-and-recent-airports) | Favourite and recent airports | Free Flight | Verified (search) | M | High | Low |
| [A2](#a2-departure-spot-remembered-per-airport) | Departure spot remembered per airport | Free Flight | Verified | S | Medium | Low |
| [A3](#a3-runway-advised-by-the-wind) | Runway advised by the wind | Free Flight | Verified | M | High | Low |
| [A4](#a4-departure-airport-card) | Departure airport card | Free Flight | Verified | M | Medium | Low |
| [A5](#a5-flight-scenarios) | Flight scenarios (everything set in one click) | Free Flight | Likely | L | Very high | Medium |
| B1 | METAR and flight category of the departure | Free Flight | **Done** | | | |
| B2 | Traffic and multiplayer in the bar | Free Flight | **Done** | | | |
| [B3](#b3-departure-date) | Departure date (seasons, memory) | Free Flight | Verified (form) | S | Medium | Low |
| [B4](#b4-custom-weather-presets) | Custom weather presets | Free Flight | To explore | M | Medium | Medium |
| [C1](#c1-map-filters-remembered) | Map filters and style remembered | Free Flight | Verified | S | Medium | Low |
| [C2](#c2-go-to-an-airport-on-the-map) | Go to an airport on the map | Free Flight | Likely | S | Low | Low |
| D1 | Gallery sort | Aircraft selection | **Done** | | | |
| [D2](#d2-personal-gallery-filters) | Personal filters (recent, publisher, tags) | Aircraft selection | Verified (mod data) | M | Medium | Low |
| [D3](#d3-controls-preset-per-aircraft) | Controls preset per aircraft | Aircraft selection | To explore | M | High | Medium |
| [D4](#d4-fuel-and-payload-remembered) | Fuel and payload remembered | Aircraft selection | To explore | L | Medium | High |
| [E1](#e1-cleaner-home-screen) | Cleaner home screen | Home | Likely | S | Low | Low |
| [E2](#e2-cleaner-menu-bar) | Cleaner menu bar | All | Verified | S | Low | Low |
| [E3](#e3-straight-to-free-flight) | Straight to Free Flight | Home | To explore | M | Medium | Medium |
| [F1](#f1-flight-card-in-the-pause-menu) | Flight card in the pause menu | Pause in flight | Verified | M | Medium | Low |
| [F2](#f2-weather-and-time-from-the-pause-menu) | Weather and time from the pause menu | Pause in flight | To explore | M | High | Medium |
| G1 | The mod's settings changed live | App | **Done** (MSFS-UI-GENERATOR) | | | |
| G2 | Backup and restore of the data | App | Removed (not needed) | | | |
| [G3](#g3-quick-graphics-profiles) | Quick graphics profiles | Options | To explore | L | Medium | High |
| [H1](#h1-in-flight-toolbar-panel) | In-flight toolbar panel | In flight | Likely (SDK mechanism) | L | High | Low |
| [H2](#h2-automatic-logbook) | Automatic logbook | App + SimConnect | Likely | L | Medium | Low |

### Recommended order

1. **A1, then A2 and A3**: choosing the departure becomes as quick as choosing the aircraft. A1 brings the "choose an airport by ICAO" brick, reused afterwards.
2. **A5**: scenarios assemble A1, A2, the weather bar, B2 and the existing aircraft loading. It is the strongest feature, but it depends on the previous ones.
3. The rest as wanted; **H1** and **H2** are separate projects (another mechanism than the menu mod).

## A. Departure (Free Flight)

### A1. Favourite and recent airports

**Idea.** Tiles (or ICAO labels) of favourite airports and of the latest departures, in Free Flight's left column next to the aircraft favourites. A click sets the departure; a dedicated button sets the arrival.

**What the sim offers.**
- Airport search through the `JS_LISTENER_AIRPORT_SEARCH` listener. **Verified**: `trigger('AIRPORT_INPUT_TEXT', uid, 'LFBP', 'ON_AIRPORT_SELECTED')` answers `ResultsUpdated(uid, results)`, with `{ index, database: "SEARCH", ICAO, name, city, type, wlType, icon }`.
- Selection: `trigger('ON_DEPARTURE_AIRPORT_SELECTED', index, database)` or `ON_ARRIVAL_AIRPORT_SELECTED` (code of `FreeFlightPlanManipulator`). Not tested.
- Removal: `Game.CurrentFlight.SetFreeflightDeparture.request("0")` / `SetFreeflightArrival`; swap: `SwitchFreeflightDepartureArrival.request("")`.
- Current departure: `GameFlight.departure` (`id`, `worldLocation.iCAO`, `title` as `TT:AIRPORTLR.<ICAO>.name`, `city`, `dms`). The sim already keeps a history (`UpdateHistory`).

**Design.** `sim/airport-search.ts`: `selectAirport(icao, 'departure' | 'arrival')` = search, wait for the exact ICAO result, select, wait for the new `departure.worldLocation.iCAO` (3 s, as aircraft loading). A feature module with rows like the Free Flight favourites, a star to add the current departure. Data: `MSFS_UI_FAVORITE_AIRPORTS`, `MSFS_UI_RECENT_DEPARTURES` (10 at most).

**Unknowns.** Whether `SetSearchParams` is needed for an exact ICAO; behaviour while the sim's drop-down list is open.

**Estimate.** Effort M · value high · risk low.

### A2. Departure spot remembered per airport

**Idea.** Remember the last departure type chosen per airport (runway, parking, helipad) and set it again when coming back to that airport.

**What the sim offers.** **Verified** on LFBZ: `departure.runwayIndex`, `taxiIndex`, `helipadIndex`, `customType`, and in `departure.worldLocation.airportInfos`: `runways`, `taxis` (26 named spots), `helipads`, `customDepartureTypes`. Actions (code of `FreeflightRunwaysManipulator`): `SetDepartureRunwayIndex`, `SetDepartureTaxiIndex`, `SetDepartureHelipadIndex`, `SetCustomDepartureTypeIndex` (index as text), and `SetArrival…`.

**Design.** A feature without UI: follows `departure`; on a change of airport, applies the remembered spot (by **name**, the index may change with a scenery update); remembers every change made by the user. Data: `MSFS_UI_DEPARTURE_SPOTS`.

**Unknowns.** Exact link between `customType` and the departure type shown; order of updates when the sim picks a default spot (a grace delay).

**Estimate.** Effort S · value medium · risk low.

### A3. Runway advised by the wind

**Idea.** Next to the sim's runway choice, the head and cross wind components of each runway, the best one highlighted; a click selects it.

**What the sim offers.** **Verified**: runway names ("27", "09") with length and surface (`GetInfosFromAirport`), the wind at the departure in `departure.worldLocation.windInfo` and in the METAR. The heading follows from the runway number (27 → 270°, within 10°); selection by `SetDepartureRunwayIndex`.

**Design.** Computation in a pure module (components, choice); a small block under the sim's runway card, or in A4. Wind from the METAR in Live weather, otherwise `GetWeatherAtLocation`.

**Unknowns.** No exact magnetic heading (the number only); parallel runways (L/R/C).

**Estimate.** Effort M · value high · risk low.

### A4. Departure airport card

**Idea.** A compact card of the chosen airport: runways (length, surface, lights), frequencies, number of SIDs, STARs and approaches, weather.

**What the sim offers.** **Verified** on LFBZ: `GetInfosFromAirport.request(id)` (`runways`, `frequencies`), `airportInfos.departures` (16 SIDs), `arrivals` (14 STARs), `approaches` (9); `Game.Airport.GetLiveAirportActivity.request(id)` gives `{ departures, arrivals }` (empty without live traffic).

**Design.** A tab next to Weather in the weather bar, or a "Departure" block merged with the METAR.

**Unknowns.** Content of the SID / STAR entries; use of the live activity.

**Estimate.** Effort M · value medium · risk low.

### A5. Flight scenarios

**Idea.** Save a typical flight and set it again in one click: aircraft, variant and livery, departure and spot, arrival, weather, time of day, date, traffic. Example: "Biarritz circuits" = Vision Jet G2 Executive, LFBZ parking 97, clear skies, Dawn, AI traffic. Option: launch the flight.

**What the sim offers.** Every brick exists, most already in the mod: aircraft loading, A1, A2, `SetWeatherPreset`, the bar's time logic, B3, the traffic buttons; launch: `Game.CurrentFlight.LaunchFlight.request("")` once `Game.CurrentFlight.ReadyToFlyBtnState` is true (readable, verified).

**Design.** A "Scenarios" block on Free Flight (save the current state, list, apply, delete); applied **step by step**, each step waiting for its confirmation in the data model, the aircraft last. Data: `MSFS_UI_SCENARIOS`.

**Unknowns.** The order the sim accepts (does choosing a departure reset the time or weather?); conditions of `ReadyToFlyBtnState`; a missing element (aircraft uninstalled, airport absent).

**Estimate.** Effort L · value very high · risk medium.

## B. Weather, time and flight conditions

### B3. Departure date

**Idea.** Season buttons (the 15th of the middle month) or "Today", and the last date remembered; the bar's sun times already follow the date.

**What the sim offers.** `Game.CurrentFlight.SetDepartureDate.request("<day>|<month>|<year>")` (form read in `FlightConditionsCalendarManipulator`); current date in `timeData.day/month/year` and `GameFlight.fullDateString` (verified).

**Design.** A "Date" row in the weather bar, or the wheel on the widget's date.

**Unknowns.** Effect in Live weather (the date is probably imposed).

**Estimate.** Effort S · value medium · risk low.

### B4. Custom weather presets

**Idea.** Save the current custom weather under a name and find it in the bar next to the sim's presets.

**What the sim offers.** Events `Game.Weather.FlightConditions.SaveAsCustomPreset`, `EditCustomPreset`, `RemoveCustomPreset`. The current list holds only the sim's 11 presets.

**Design.** Explore first: save a custom weather from the sim's screen, then read `PresetList` again. If the sim lists them, the bar already shows them; otherwise a "Save" button calling the sim's action.

**Unknowns.** The actions' parameters; persistence; icons.

**Estimate.** Effort M · value medium · risk medium.

## C. World map

### C1. Map filters remembered

**Idea.** Remember the map's filters (airports, heliports, seaplane bases, weather layer, wind particles) and style, and set them again at start-up if they changed.

**What the sim offers.** **Verified**: `Game.Worldmap.Filter.Sections` (`{ iD, filterName, choices, value }`), `Filter.AdvancedLayers.WeatherLayer`, `WindParticles`, `Filter.SelectedMapStyle`. Actions: `Filter.ToggleFilter.request("<iD>/<value>")`, `Filter.SetSelectedMapStyle.request("<index>")`, `Filter.Reset`.

**Design.** Without UI: recorded at each change, applied once per session at the first display of Free Flight. Data: `MSFS_UI_WORLDMAP_FILTERS`.

**Unknowns.** Does the sim already keep them between sessions? If so, useless.

**Estimate.** Effort S · value medium · risk low.

### C2. Go to an airport on the map

**Idea.** Type an ICAO to centre the map on the airport and open its card.

**What the sim offers.** **Verified**: `Game.Worldmap.WorldLocations.FromICAO.request("LFBP")` gives the place (`uID`); selection: `WorldLocations.SelectFromUnicID.request(uID)`.

**Design.** A small field with the airport favourites (A1).

**Unknowns.** Does `SelectFromUnicID` centre the map or only select?

**Estimate.** Effort S · value low · risk low.

## D. Aircraft selection

### D2. Personal gallery filters

**Idea.** Filters the sim does not have: "Recent" (from the recorded aircraft use), by publisher, and personal tags ("IFR", "School", "Bush"…).

**What the sim offers.** Nothing more than the list (`creator`, `displayName`, `variation`): everything rests on the mod's data. The sim's categories are the tabs.

**Design.** Buttons next to Favorites; tags edited with the sim's text field. Data: `MSFS_UI_AIRCRAFT_TAGS`.

**Estimate.** Effort M · value medium · risk low.

### D3. Controls preset per aircraft

**Idea.** Load a controls preset (joystick, pedals) tied to the aircraft chosen, for example one for helicopters and one for aeroplanes.

**What the sim offers.** `Game.Options.Controls.LoadPreset.request(JSON)`, `FetchDevicePresets`, `FetchAllDevices`, `ApplyCurrentPresetToAllAircraft`.

**Unknowns.** The JSON's full form; effect of a load outside the controls screen; whether the sim already ties a preset to each aircraft (then useless).

**Estimate.** Effort M · value high (if the sim does not) · risk medium.

### D4. Fuel and payload remembered

**Idea.** Remember the fuel and payload per aircraft and set them again on loading.

**What the sim offers.** The Fuel and Payload screen opens by `GOTO_WORLDMAP_PLANECONFIGURATION_FUEL_XML`, but no path reads or writes the fuel in the menu's data model; quantities are SimVars, not available in `mainUi` (verified).

**Design.** Probably out of reach of the menu mod; possible through SimConnect (H2).

**Estimate.** Effort L · value medium · risk high.

## E. Home, menu bar, navigation

### E1. Cleaner home screen

**Idea.** Hide the home tiles not used in Free Flight play (Career, Challenges, Marketplace, New content…).

**What the sim offers.** `HomeTilesManipulator` and the tile manipulators; tile states in `Elements.Homepage.*` (verified).

**Design.** CSS on the tiles, the hidden tiles chosen in the settings.

**Estimate.** Effort S · value low · risk low.

### E2. Cleaner menu bar

**Idea.** Hide the Market, Notifications, Friends or Communications icons of the top bar.

**What the sim offers.** **Verified**: `Elements.Menubar.Market`, `.Notifications`, `.State.Hidden`, `.State.Disabled`; `MenuBarManipulator`.

**Design.** CSS on the buttons (by `name`), one option per button.

**Estimate.** Effort S · value low · risk low.

### E3. Straight to Free Flight

**Idea.** At start-up, open Free Flight without going through the home screen.

**What the sim offers.** The home buttons (`HomePageManipulator`) and the navigation events; no `GOTO_` event for Free Flight itself (only `GOTO_FREEFLIGHT_PLANE_SELECTION`).

**Design.** Click the home's Free Flight button once per session, when the home becomes visible.

**Unknowns.** Start-up sequence (news screens, popups); a loop if the home shows again.

**Estimate.** Effort M · value medium · risk medium.

## F. In flight: the pause menu

**Verified in flight (LFBZ, Vision Jet G2).** During the flight the menu stays the same `mainUi` page: the mod stays loaded, and the pause menu is another root component, `MasterPagePauseManipulator`, showing `PauseFreeFlightManipulator` (Resume, Restart, Abort, Options, Main menu). It is in `GuidToManipulator`, so the mod can hook it like the other screens. The data model stays readable; SimVars do not.

### F1. Flight card in the pause menu

**Idea.** In the pause menu, a card: aircraft, livery and tail number, departure and arrival, local time, weather; with a flight plan, remaining distance and time, next waypoint.

**What the sim offers.** **Verified** in flight: `GameFlight` holds `remainingDistance`, `remainingTimeEstimation`, `remainingFuelEstimation`, `totalDistance`, `nextWaypointInformation` (empty without a flight plan), `timeData`, `weatherIndex`, `timeOfDay`, `CurrentAircraft`.

**Design.** A panel next to the pause buttons (`Pause_Buttons`), with the same bricks as the other panels.

**Unknowns.** Refresh while the sim is paused; tests with a flight plan.

**Estimate.** Effort M · value medium · risk low.

### F2. Weather and time from the pause menu

**Idea.** The weather and time bar also in the pause menu, to change the atmosphere in flight.

**What the sim offers.** The same paths as on Free Flight; the toolbar's weather panel (`Panel_WeatherManipulator`) shows that the sim changes the weather in flight.

**Design.** The weather bar anchored in the pause menu.

**Unknowns.** Do `SetWeatherPreset`, `SetDepartureTime` and `SetLiveOffset` work in flight? To test one by one.

**Estimate.** Effort M · value high · risk medium.

## G. Settings, data, options

### G3. Quick graphics profiles

**Idea.** Switch between two graphics profiles ("Performance", "Quality") in one click.

**What the sim offers.** `Game.Options.RetrieveGlobalRenderingPreset`, `POPUP_UPDATE_GRAPHICS_PRESET`, `Game.Options.General.UpdateSectionOptionsGeneral`, `Game.Options.General.Item[section]`.

**Unknowns.** Writing a setting through the data model (only reading was seen); settings that need a restart; leaving the options inconsistent.

**Estimate.** Effort L · value medium · risk high.

## H. Beyond the main menu

### H1. In-flight toolbar panel

**Idea.** A panel of the mod in the in-flight toolbar (like the sim's weather panel): weather and time, tail number, useful data, with access to SimVars.

**What the sim offers.** Toolbar panels are separate pages; Community packages already add some. It is the SDK's official mechanism (`InGamePanels`), without replacing a file of the sim, and these pages load the SimVar API.

**Design.** A second module in the `msfs-ui` package (an `InGamePanels` declaration, its own page and script), generated by the app; communication with the menu mod through `datastorage`.

**Unknowns.** The exact declaration for MSFS 2024 (in the local SDK, through `tools/msfs-sdk-mcp`); access to the menu's data model from a panel page.

**Estimate.** Effort L · value high · risk low.

### H2. Automatic logbook

**Idea.** A logbook kept automatically: date, aircraft, livery, departure, arrival, duration, distance.

**What the sim offers.** From `mainUi`: aircraft, planned departure and arrival, flight start (the pause menu, to confirm). The real arrival and duration need SimConnect (position, on ground, flight time); `node-simconnect` is already used by `tools/msfs-sdk-mcp`.

**Design.** Part of MSFS-UI-GENERATOR (SimConnect from .NET), writing a CSV or JSON file; the mod could show it through `datastorage`.

**Estimate.** Effort L · value medium · risk low.

## Out of reach or not advised

| Lead | Reason |
|---|---|
| Reading or writing SimVars from the menu | `SimVar` does not exist in `mainUi` (verified in flight); use a panel (H1) or SimConnect (H2) |
| Career, challenges, marketplace, Reno | Outside the project's Free Flight use; very specific screens and data |
| The mod's own keyboard shortcuts | Keys go through the sim's input bar: conflicts with its shortcuts |
| Patches of `lib.js` | Minified names, changing with every version |
| Forced resize of the sim's lists | An artificial `resize` crashes a virtual list (`t.gap`) |
| Removing the departure and arrival by a gesture on the map | Tried and abandoned on 16/10/2026: map clicks only arrive as `mousePressOutsideView` / `mouseReleaseOutsideView`, without button or position and identical for both buttons; a double click zooms; a long press lets the sim set a Custom point; a right-click menu was not satisfying. The cross of the sim's departure and arrival fields stays the reliable way |
| Zooming or moving the map | No command in the menu (`MapScale` is read only) |

## Appendix: candidate APIs

To add to the [sim reference](sim-reference.md) and to `mod/compat.json` as soon as a feature uses them.

| Path or event | Form | Status |
|---|---|---|
| `JS_LISTENER_AIRPORT_SEARCH`: `AIRPORT_INPUT_TEXT(uid, text, event)` → `ResultsUpdated(uid, results)` | `index`, `database`, `ICAO`, `name`, `city`, `type`, `wlType`, `icon` | Verified (search) |
| `ON_DEPARTURE_AIRPORT_SELECTED(index, database)`, `ON_ARRIVAL_AIRPORT_SELECTED(…)` | Same listener | Sim's code |
| `Game.CurrentFlight.SetFreeflightDeparture` / `SetFreeflightArrival.request("0")`, `SwitchFreeflightDepartureArrival.request("")` | Remove, swap | Sim's code |
| `GameFlight.departure` / `arrival` | `id`, `runwayIndex`, `taxiIndex`, `helipadIndex`, `customType`, `worldLocation` (`iCAO`, `title`, `city`, `dms`, `windInfo`, `airportInfos`) | Verified |
| `airportInfos` | `runways`, `taxis`, `helipads`, `frequencies`, `departures`, `arrivals`, `approaches`, `customDepartureTypes`, `runwaySelected` | Verified |
| `SetDepartureRunwayIndex`, `SetDepartureTaxiIndex`, `SetDepartureHelipadIndex`, `SetCustomDepartureTypeIndex` (and `SetArrival…`) | Index as text | Sim's code |
| `Game.Airport.GetInfosFromAirport.request(id)`, `GetLiveAirportActivity.request(id)` | Runways, frequencies; departures, arrivals | Verified |
| `Game.CurrentFlight.SetDepartureDate.request("day\|month\|year")` | Departure date | Sim's code |
| `Game.CurrentFlight.LaunchFlight.request("")`, `ReadyToFlyBtnState` | Flight launch | Sim's code; state verified |
| `GameFlight` (in flight) | `remainingDistance`, `remainingTimeEstimation`, `remainingFuelEstimation`, `nextWaypointInformation`, `fullDateString`, `isLiveTraffic`, `isLiveMultiplayer` | Verified |
| `Game.Worldmap.Filter.*` | Sections, layers, style; `ToggleFilter`, `SetSelectedMapStyle`, `Reset` | Verified (read) |
| `Game.Worldmap.WorldLocations.FromICAO.request(icao)`, `SelectFromUnicID`, `PlayerLocation` | Places | Verified (`FromICAO`, `PlayerLocation`) |
| `Game.Aircraft.GetAircraftCategories.request("")` | Categories | Verified |
| `Elements.Menubar.*`, `Elements.Homepage.*` | Button and tile states | Verified |
| `Game.Options.General.FetchCategories.request("")`, `Game.Options.Controls.LoadPreset.request(JSON)` | Options | Verified / sim's code |
| `PauseFreeFlightManipulator`, `MasterPagePauseManipulator`, `FreeflightRunwaysManipulator`, `FreeFlightPlanManipulator`, `HomePageManipulator`, `WorldmapFiltersManipulator` | Screens to hook | Verified (registry; pause shown in flight) |
