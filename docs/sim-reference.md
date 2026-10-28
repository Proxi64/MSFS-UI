# Sim reference

Everything the mod uses from the MSFS 2024 menu, found on sim **1.9.18** (base package `fs-base-ui` 0.1.10) by reading its files (`html_ui\Global\lib.js`, `pkgCore.se.js`, `pkg\base.bundle.js`, `shared\*.js`, `cookedcomps\*`) and by testing in the sim. None of it is documented by Asobo: a sim update may change any of it. The mod declares what it uses in [`mod/compat.json`](../mod/compat.json), which the app checks (Compatibility page).

The sim's components the mod creates, and how, are described in the [mod's README](../mod/README.md#the-sims-own-components).

## The sim's files

| File (`fs-base-ui\html_ui\…`) | Useful content |
|---|---|
| `Global\mainUi.html` | Main menu page (`<entry-point>`, `mainUi.bundle.js`) |
| `Global\engine_ui.bundle.js` | UI engine: `GuidToManipulator`, `UITimeline`, `UITransition`, `UIAnimation`, `GuidToTrait`, `AttachTrait` (readable export names) |
| `Global\lib.js` | Menu library (minified export names, never imported): `CrossFadeElement`, text fields, input bar, virtual lists, `text-marquee`, `real-scroll` |
| `Global\shared\utils.js` | Re-exports `shared\common.js`: `UniversalProxy`, `RegisterViewListener`, `ViewListener` |
| `Global\shared\store.js` | `ReadableStore` (data model), `DataValue`… |
| `Global\pkgCore.se.js` | Free Flight, Flight Conditions, weather screens |
| `Global\pkg\base.bundle.js` | Aircraft selection, configurator, fleet |
| `SCSS\common.css` | Common styles (`img.img-fade`…) |
| `cookedcomps\{GUID}.html` / `.json` | "Cooked" components: template, exposed attributes, visual states |

The mod imports only exports with **readable names** (`engine_ui.bundle.js`, `shared/utils.js`, `shared/store.js`): the minified names of `lib.js` change from one version to the next.

## Screens and elements

| GUID | Class | Role |
|---|---|---|
| `{7DA60FBA-EF32-48F2-974D-F8BEA35337A4}` | (none) | MasterPage, the menu's root; replaced by the package |
| `{3C7A4EC5-E7F6-4761-B27F-A0EA89C0F081}` | `FreeFlightPageManipulator` | Free Flight |
| `{7822664D-7F34-4A46-904A-F82929865103}` | `PlaneSelectionFreeflightPageManipulator` | Aircraft selection |

Classes are registered by the `Manipulator({ name, guid })` decorator in `GuidToManipulator` (a Map from the upper-case GUID to the class). Their `traitName` is empty: only the class name is readable. An instance has an `elt` field (its root element); an element has a `manipulator` field.

Elements found by their `name` attribute:

| Screen | `name` | Role |
|---|---|---|
| Free Flight | `FreeFlight_AircraftButton` | Aircraft button (top left) |
| | `Search` | *Search location* field |
| | `Flight_Conditions_History_Widget` | Time widget and 24-hour timeline |
| | `FreeFlight_Runways` | Card of the selected airport (runways, spots) under the widget, 440 units wide. It carries the `disabled` class (`pointer-events: none`) while shown, even without the mod: its runways cannot be clicked. Zero size without an airport |
| | `FreeFlight_Traffic` | Card of a traffic aircraft selected on the map, at the **same place** as `FreeFlight_Runways`; the sim switches between them with the `State_Traffic` and `State_Runways` visual states |
| | `Worldmap_Filters` | Map filters |
| Map (page `atlas`) | `Worldmap_Buttons` | Small window the sim draws on the map on a click (Set as departure, Set as arrival…); it is in the `atlas` page, not in `mainUi` |
| Aircraft selection | `PlaneSelection_Content` | Content; listens to `tileHover`; its manipulator has `updateAircraftList()` |
| | `LeftBlock` / `RightBlock` | Left column / grid area |
| | `Fleet_Details` | Aircraft details (class `hide` when the aircraft is invalid); `Header`, `Scroll`, `ButtonBlock` inside |
| | `PlaneSelection_List`, `TileButton_Fleet` | The sim's grid and its tiles |
| | `RightBlock` › `Header` › `Search` | *Search aircraft* field |
| | `Dropdown_Sortby`, `IconButton_Squared_Sort` | The sim's sort and its direction: declared but **disabled** (`active="false"`), never shown on this screen |

## Data model

Built by `UniversalProxy(new ReadableStore())`. A path is written with dots; `()` reads, `.request(p)` acts, `.watch(id, callback)` / `.unwatch(n)` follow a value, `.requestRange(start, count)` loads an array and returns its size, `.getElement(i)` reads an element.

### Current flight, weather and time

| Path | Type | Meaning |
|---|---|---|
| `Game.CurrentFlight.GameFlight.timeData` | `TimeInfo` | `isLiveTime`, `utcTime`, `localTime` (live offset included), `localTimeWithoutOffset` (real time), `day`, `month`, `year`; seconds since midnight |
| `…GameFlight.weatherIndex` | number | Active weather preset |
| `…GameFlight.isLiveWeather` | boolean | Live weather |
| `…GameFlight.isUsingLiveTimeBuffer` | boolean | Live mode with the 24-hour history (red timeline) |
| `…GameFlight.liveTimeOffset` | number | Live offset, seconds (−86400 to 0) |
| `…GameFlight.timeOfDay` | text | `Dawn`, `Day`, `Dusk`, `Night` (computed by the sim) |
| `…GameFlight.departure` / `arrival` | object | `id` (0 without; parameter of the weather requests), `worldLocation.iCAO`, `.title`, `.dms` ("43° 28' 6.10" N, 1° 32' 4.74" W"); no numeric latitude / longitude. A free point has its own `id` (2 for Custom Departure, 3 for Custom Arrival) and an empty `iCAO` |
| `…GameFlight.isDepartureValid` | boolean | A departure is chosen |
| `Game.CurrentFlight.SetDepartureTime.request("<s>")` | action | **Local** departure time, seconds; leaves Live |
| `Game.CurrentFlight.ResetToSystemTime.request("true")` | action | Real time (Live) |
| `Game.CurrentFlight.SetLiveOffset.request("<s>")` | action | Live offset (≤ 0); stays live |
| `Game.CurrentFlight.SetFlightConditionConfiguration.request(id)` | action | Clicks a flight-condition button: `WEATHERLIVE`, `WEATHERPRESET`, `WEATHERCUSTOM`, `AIRTRAFFICLIVE`, `AIRTRAFFICAI`, `AIRTRAFFICOFF`, `MULTIPLAYERLIVE`, `MULTIPLAYERALL`, `MULTIPLAYEROFF` |
| `Game.CurrentFlight.FlightConditions` | object | `{ multiplayer, airtraffic, weather }`, each a list of buttons `{ id, selected, disabled }`; an unavailable button is present with `disabled: true`. **Published only after** `UpdateFlightConditions.request("")`, as the sim's panel does |
| `Game.Weather.GetWeatherFromMetarAtLocation.request("<id>")` | action → `WeatherInfo` | **Real** weather (METAR) at place `id`: `temperature`, `visibility`, `windSpeed`, `windDirDeg`, `cloudAltitude`, `precipitation` (`DataValue`s, absent at −1 or −2147483648, or an empty `valueStr`), `coverage` (0 to 1), `flightRules` (`VFR`, `MVFR`, `IFR`, `LIFR`). Out of Live, `coverage` is 0 while `cloudAltitude` keeps the ceiling. May answer `undefined` |
| `Game.Weather.GetWeatherAtLocation.request("<id>")` | action → `WeatherInfo` | **Simulated** weather at `id` (the preset's); `coverage` in percent, empty `flightRules` |
| `Game.Weather.FlightConditions.PresetList` | array | `WeatherPreset`: `index`, `title` (`TT:` key), `iconUrl`, `backgroundUrl`, `enabled`, `isSelected` |
| `Game.Weather.FlightConditions.SetWeatherPreset.request("<n>")` | action | Applies preset `n` (0 = Live) |
| `Elements.FlightConditions.InteractionBlocked` | boolean | Flight conditions cannot be changed |

### Map (Free Flight)

| Path | Type | Meaning |
|---|---|---|
| `Game.Worldmap.WorldLocations.SelectedWorldLocation` | number | Place selected on the map: 0 none, 1 free point, otherwise an airport id |
| `Game.Worldmap.WorldLocations.SelectFromUnicID.request("0")` | action | Clears the selection |
| `Elements.Worldmap.WorldmapButtons` | array | Buttons of the map's window: `text` (`TT:` key), `type`, `isEnabled`, `eventName` |
| `Game.Worldmap.MapScale` | `DataValue` | Map scale (metres); read only |

There is **no command** to zoom or move the map from the menu.

### Aircraft

| Path | Type | Meaning |
|---|---|---|
| `Game.Aircraft.CurrentAircraft` | `AircraftDetails` | Current aircraft: `displayName`, `creator`, `variation`, `variationId`, `thumbnailPath` (the **livery's** thumbnail), `isValid`… |
| `Game.Aircraft.AircraftList` | array | Aircraft of the category tab; **one entry per modular aircraft** (with its current variant); `aircraftId`, `variationIndex`, `isSelected`, `isUsable` |
| `Game.Aircraft.FilteredCategory` | text | Active category tab |
| `Game.Aircraft.GetAircraftFromVariationId.request(id)` | action | Details of a variant; for a variant other than the list's, gives an `aircraftId` that `SetAircraftForConfigurator` does not load |
| `Game.Aircraft.GetAircraftSortingOptions.request("")` | action → list | Sort options, as translation keys: `TT:MENU.ACPROPUI_MAX_RANGE`, `TT:MENU.ACPROPUI_MAX_ALTITUDE`, `TT:MENU.NAME`, `TT:MENU.PAYLOAD`, `TT:MENU.AIRCRAFT_SPEED`. The **first** is the sim's own order (its sort dropdown starts on it, not reversed): Max Range |
| `Game.Aircraft.SetAircraftSortingOption.request("<option>")` | action | Sorts `AircraftList`; a `!` prefix reverses the order. The sim's grid follows; the order stays until another sort is sent (the mod puts the first option back when the gallery closes) |
| `Game.Aircraft.Configurator.SetAircraftForConfigurator.request("<aircraftId>\|\|<variationIndex>")` | action | Sets the configurator (and the current aircraft); values of `AircraftList` |
| `Game.Aircraft.Configurator.Details` | `AircraftDetails` | The configurator's aircraft |
| `Game.Aircraft.Configurator.Items` | array | Variants: `id` (= `variationId`), `title`, `imageUrl`, `isSelected`, `isDisabled` |
| `Game.Aircraft.Configurator.SelectItem.request(id)` | action | Changes the variant (puts the first livery back) |
| `Game.Aircraft.Configurator.Liveries` | array | Liveries: `id` (`<variationId>:<n>`), `title`, `imageUrl`, `directoryPath` (`SimObjects\…\liveries\…`), `isSelected` |
| `Game.Aircraft.Configurator.SaveVariationId.request(id)` | action | Changes the livery |
| `Game.Aircraft.UpdateCurrentAircraftIdentification.request()` | action | Publishes the current identification |
| `Game.Aircraft.CurrentIdentification` | object | `identificationInfos`: `dataName` (`TT:MENU.AIRCRAFT.TAIL_NUMBER`…), `value`, `regex`, `allowedLength` (9 for the tail number) |
| `Game.Aircraft.SetCurrentAircraftIdentification.request("<dataName>%%<value>")` | action | Writes a field; **the tail number is global**, shared by every aircraft |

**The configurator:** the sim releases it when leaving the aircraft selection and sets it only on a click on a tile or on *Configure*. A `SaveVariationId` sent to a released configurator makes the current aircraft **invalid** (`isValid: false`, name `NOT_FOUND`): `Fleet_Details` hides and the configurator empties. Always `SetAircraftForConfigurator` on the current aircraft before acting.

## Events

| Event | Sent | Effect |
|---|---|---|
| `tileClick` (`CustomEvent`, `detail` = an `AircraftList` item, `bubbles`) | On the selection screen's element | The page calls `SetAircraftForConfigurator`, as for the sim's tiles |
| `tileHover` (`detail` = item or `null`) | On `PlaneSelection_Content` | The header of the left column shows this aircraft |
| `engine.trigger('LAUNCH_FLOW_EVENT_TO_GLOBAL_FLOW_FROM_VIEW', '<event>', '')` | Engine | Opens a screen: `GOTO_WORLDMAP_PLANECONFIGURATION_FUEL_XML`, `…_IDENTIFICATION_XML`, `…_VARIANT_XML`, `…_LIVERY_XML`, `…_LAUNCHER_XML` |
| `engine.on('mousePressOutsideView', f)` / `mouseReleaseOutsideView` | Engine | Press / release outside the page (3D scene, Free Flight map); returns `{ clear() }` |

**Mouse on the Free Flight map:** clicks on the map never reach the page, only the two engine events above, **without button or position** and identical for the left and right buttons; a double click zooms the map, which the menu cannot prevent. Removing the departure and arrival by a gesture on the map was tried and abandoned for these reasons.

## View listeners (`RegisterViewListener`)

| Name | Use |
|---|---|
| `JS_LISTENER_INPUT_STACK` | `trigger('ENTER_INPUT_FIELD', …)` gives the keyboard to a field; `trigger('EXIT_INPUT_FIELD')` gives it back |
| `JS_LISTENER_INPUTBAR` | `engine.trigger('REGISTER_INPUT_BAR', id, location.pathname)` then `SET_INPUT_BAR(id, [], 'SCANNING', …)` turn the sim's shortcuts off; `SCANNING` is the context the sim's own field sets (an unknown context is ignored); `REMOVE_INPUT_BAR` turns them back on. The sim's `Search_Input` does all this itself: the mod uses it for its text fields |
| `UI_GLOBAL_STORE` | Used by `ReadableStore` |

With `singleton = true`, `RegisterViewListener` shares the existing listener.

## Animations

| Element | Durations | Fast menus patch |
|---|---|---|
| `UITimeline` | ms: `configuration.duration`, `initialDelay`, `startingTransition`; per animation `duration`, `animationStart`, `offset` (`add` always recomputes `delay`); events (`addEvent`): `delay`; `iterations: -1` loops | Durations and offsets divided by the speed factor; loops unchanged |
| `UITransition.getTransitionStr(changes, options)` | seconds: `options.duration`, `options.delay` | Divided by the speed factor |
| `<cross-fade>` | CSS rule `img.img-fade.img-fade--enabled { transition: opacity 0.5s }` | Replaced by `transition: none` |

## Storage and translation

| Element | Use |
|---|---|
| `datastorage.getData(key)`, `setData(key, text)`, `deleteData(key)`, `searchData(prefix)` | **Persistent** native storage (global in `mainUi`, otherwise `window.top.datastorage`); the mod's keys start with `MSFS_UI_`; the mod calls the first three only. Kept in memory: written to the disk only when the sim saves its profile (below). On the owner's sim (Steam, 1.9.21, 2026-10-28) it is a native `[object DataStorage]`, an own property of the menu's window, with no `JS_LISTENER_DATASTORAGE` registered (registering it there gets no answer). On another user's sim (Microsoft Store / Xbox edition, 1.9.21, 2026-10-28) it is missing altogether: nothing the mod writes is kept ([next-steps.md](next-steps.md), 1.5) |
| `localStorage` | Available but **emptied at every start** of the sim |
| `window.top.g_localization.Translate('TT:…')` | Translates a key of the sim; the English texts are in `fs-base\en-US.locPak` |

**When the storage reaches the disk** (measured on 1.9.21, 2026-10-27). `datastorage` is kept in memory; the sim writes it to the disk, inside its Steam Cloud profile (`<Steam>\userdata\<account>\2537590\remote\profile_00`), only when it saves its profile. It does so when one of its options is validated: not after a `setData`, and not when it quits, even through its menu. A value written then, the sim restarted: the value is gone, and the profile is rewritten at start-up with its previous content. One option changed in Options (*Buildings* High → Low → High): the profile is written at once, with the value. The options page validates an option with the flow event `engine.trigger('LAUNCH_FLOW_EVENT_TO_GLOBAL_FLOW_FROM_VIEW', 'VALIDATE', strId, index, metadata, param)` (`CreateOnOffOption` in `pkgCore.se.js`); sent with the option's **current** index, it saves the profile and changes nothing. The options of a section are read with `Game.Options.General.UpdateSectionOptionsGeneral.request(section)`, then `Game.Options.General.Item[section]` (items `{ strID, dataRoute, optionType }`), each item's details at its `dataRoute` walked from the store's root (`{ strId, sTitle, iDefault, daChoices, daMetadatas, strParam }`). The mod re-validates *Show the white dot cursor in freelook* (Flight interface, `compat.json` "options") 2 s after its last write (`mod/src/sim/profile-save.ts`).

The translation keys the mod uses are listed in `compat.json` ("translations").

## The sim's look

| Element | Value |
|---|---|
| Colours (CSS variables set by the sim at runtime) | `--colorPrimary` #3B84EB, `--colorGradient` #144893, `--colorSecondary` #242934, `--colorComplementary1` white, `--colorComplementary2` black, `--colorSpecial` #FFDE03 |
| Frosted glass | Class `blurredBackground` (Coherent effect) on a white layer, under a 20 % black veil |
| Section header | 36 units, black at 30 %, title in `--fontSizeXS` bold |
| Mouse lock | `data-input-group="inputLocker"` on the panels (Flight Conditions widget, flight plan…) |
| Studio backdrop of the aircraft thumbnails | Light blue-grey gradient (165, 173, 198) → (100, 118, 152); a few publishers ship transparent thumbnails |

## Aircraft files (VFS)

Files of mounted packages can be read with `fetch('coui://html_ui/VFS/<path>')`, for example `SimObjects/Airplanes/<aircraft>/liveries/<author>/<livery>/livery.cfg`. In `livery.cfg`, the registration is `atc_id` in `[FLTSIM.N]`; the livery's name is `name` in `[GENERAL]`. A livery's folder follows from its thumbnail: `…/<livery>/thumbnail/thumbnail.png`.

## Packages

- The sim reads a **new** Community package, and the MasterPage, only at start-up.
- A mounted package serves on the fly only the files its `layout.json` listed at start-up: a file changed since is served again, a file **added** since is not served until the sim restarts. The installer asks for a restart then.

## Coherent GT

The sim's UI engine is Coherent GT, based on an old WebKit. Findings (1.9.18):

| Area | Constraint | What the mod does |
|---|---|---|
| Syntax | Object spread `{...obj}` (ES2018) refused; ES2018+ APIs (`Object.fromEntries`…) not guaranteed | Compiled to **ES2017**; such APIs are not used |
| Syntax | A unary operator before `await` (`!await x`) refused | `const ok = await x; if (!ok)`; the build refuses it |
| Syntax | Before ES2019, U+2028 and U+2029 end a line and are refused in a string | Built with `String.fromCharCode`; programs sent to the page escape them |
| Mouse | `mousedown`, `mouseup`, `click` reach only elements with `data-input-group`; without it, only hovers | The sim's components carry it |
| Mouse | On an element without an input group, click and wheel go to the engine: on Free Flight, to the **map under the panel** ("Custom" point, zoom) | `inputLocker` on every panel |
| Mouse | `pointer-events: none` is inherited: the children of a disabled row no longer receive anything | A disabled row is only dimmed; a busy list is made inactive, never its panel |
| Mouse | A click on the map or the scene sends no `mousedown` to the page | A "click elsewhere" also listens to `mousePressOutsideView` |
| Wheel | No reliable native scrolling on a plain element; `wheel` bubbles to the `document` | The sim's `<real-scroll direction="y">`, created by the mod, scrolls on the wheel and draws the sim's scroll bar (`currentScroll`, `maxScroll`, `scrollToPosition`, `updateSizes`, `ui-scroll` event; its `.scroll__content` is a plain block) |
| Keyboard | A plain field receives only `focus`, `keydown`, `input` | The sim's `Search_Input` component |
| Text | No ellipsis for cut text | The sim's `text-marquee` scrolls a long text on hover, also when a parent carries the `marquee__trigger` class |
| Images | The sim's SVG icons have no colour of their own (black in `<img>`) | Inserted in the page and coloured with `fill` |
| Layout | A one-line `flex-wrap` container stretches its items (`align-content` ignored) | `align-items: flex-start` |
| Layout | Negative margins do not widen an element; computed widths are rounded down | Widths computed without negative margins, in whole pixels, the last item of a row taking the rest |
| Layout | The sim's screens animate and resize without notice | Panels placed absolutely, laid out every 250 ms on an anchor `[name="…"]`; unit `--u` = 1/1080 of the screen height |
| Components | Visual states apply on the next frame; an optional state added by the mod (`TileButton_Fleet`'s `State_Distance`) is hidden again for good by the Disabled state | Measure after a short delay; such an element is shown by CSS |
| Performance | Writing a CSS variable (`style.setProperty('--x', …)`) lays the whole subtree out again, even with its current value: about 90 ms under 78 gallery tiles at 3440 × 1440; a plain property written with its current value costs nothing. Any change of layout costs as much, growing with the number of sim components created | `setVariable()` (`core/dom.ts`) writes a variable only when it changes: the 250 ms layout passes no longer stutter (2026-10-27: 0 slow frames out of 120 while scrolling, against 15); components created only near the view |
| Performance | The sim renders about 10 frames per second when its window is not in front | Frame times measured with the sim in front |
| Performance | One of the sim's aircraft tiles (`TileButton_Fleet`) is about 110 elements: 149 alive made each change of layout cost 156 ms (4.8 ms without them); creating tiles while scrolling stutters (template, image, layout) | A pool of tiles recycled as the list scrolls (`sim/component-pool.ts`), as the sim's own grid does: 20 to 40 ms per change |
| Components | A created component moved to another parent stays loaded and active (4.8 ms with the layout); one moved or removed while it sets up fails (`setElementRef called on element being removed`) | New components are made in a hidden staging area, moved once ready |
| Resize | An artificial `resize` event crashes a virtual list of the sim (`t.gap`) | Never sent |
| Console | `console.log` passes only its first argument to the inspector | One string per message |
| Canvas | `getImageData` is not supported | Images cannot be analysed |
| Data | `FlightConditions` is published only after `UpdateFlightConditions.request("")`; updates may arrive out of order | Requested on mount; grace delay after a change |
| Start-up | The sim activates Free Flight behind the scenes, then resets the flight conditions | A remembered choice is applied when the panel is really on screen |
| In flight | The `mainUi` page and the mod stay loaded; the pause menu is `PauseFreeFlightManipulator`; `SimVar` does not exist in `mainUi` | — |
