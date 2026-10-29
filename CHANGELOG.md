# Changelog

## 1.3.0 (2026-10-29)

- **Favourites are liveries.** The heart on the aircraft tiles of the gallery and list is gone: it marked the aircraft, not the livery shown on its image, which was confusing next to the livery hearts. Mark liveries with their heart (the setup panel's thumbnails, or the livery column in the side by side layout); an aircraft with a favourite livery is a favourite and comes first. The **Favorites** filter and the Free Flight block show the favourite liveries.
- **Favourite aircraft of earlier versions are removed** at the first start: mark their liveries again.
- **Side by side is the default layout** of the aircraft selection (the aircraft and the large livery tiles next to each other). Settings already saved keep the layout chosen; *Classic* stays available in MSFS-UI-GENERATOR (Features, Aircraft gallery and list, Layout).
- **Livery rows**: in the List view of the side by side layout, the livery rows end with the column's header when they all fit, instead of leaving room for a scroll bar that does not show.
- **No more jumping tiles**: marking a livery no longer moves its aircraft to the top of the gallery under the mouse. The favourites are put first when the screen opens, and again on a new sort, search, filter or category tab.

## 1.2.1 (2026-10-28)

- **Weather bar**: the map buttons under it (*Legend*, *Map Layers*, *World Map display*) work again. Their panels open in the bar's place, so the bar hid them; it now steps aside while one is open, as the sim's own content does.

## 1.2.0 (2026-10-27)

- **Your favourites, tail numbers and last choices are now kept after a restart.** The sim writes its storage to the disk only when it saves its profile, which it does when one of its options is validated, not when the mod writes nor when you quit. The mod now asks for that save after each change, by validating the sim's option *Show the white dot cursor in freelook* with its current value (nothing changes). Before, any change made in a session without a change of the sim's options was lost.
- **Aircraft selection layouts**: a new *Layout* option of the *Aircraft gallery and list* feature, set in MSFS-UI-GENERATOR. *Classic* (the default) is the layout so far. *Side by side* cuts the gallery in two: the aircraft on the left, three per row, and the liveries of the current aircraft on the right, two per row, as large as the aircraft tiles, with their name and tail number. The left column then drops its livery thumbnails (the variants, the tail number and the Fuel and Identification buttons stay) and is narrower. The *List* view shows both sides as rows.
- **Setup panel**: the variants and the liveries share the panel's height and scroll in the sim's own list. Aircraft with many variants (iFly 737 MAX, FS Reborn Phenom 300E) no longer push the liveries, the tail number and the buttons out of the panel.
- **Smoother aircraft selection**: the gallery and the livery column recycle a few of the sim's tiles as you scroll, instead of keeping all of them; the layout passes no longer re-lay the page out four times a second; the gallery no longer makes the sim load an aircraft's statistics for every tile passing under the mouse while the setup panel shows (the header of the left column now stays on the selected aircraft).
- **List rows**: a text too long for its row stops before the heart.
- **The app**: options can now be a choice among several values, shown as radio buttons.

## 1.0.2 (2026-10-26)

- **Compatibility**: the Storage check says what the sim offers. It shows where the sim's storage is, checks each method the mod calls, names what the storage has when a method is missing, and lists the mod's data stored. `searchData` is no longer required: the mod does not call it. If your favourites or tail numbers are not kept after a restart, open the Storage group of the Compatibility page and report what it shows, with your sim version (Steam or Microsoft Store, and its number).
- The mod itself is unchanged.

## 1.0.1 (2026-10-19)

The first public release.

**MSFS-UI-GENERATOR**, a Windows app that installs and sets up **msfs-ui**, a mod of the Microsoft Flight Simulator 2024 main menu:

- **Fast menus**: shorter animations, images without fade.
- **Weather and time bar** on Free Flight: the sim's weather presets, METAR of the departure with its flight category, Now / Dawn / Day / Dusk / Night at the departure's sun times, air traffic and multiplayer, the last choice remembered.
- **Mouse wheel on the time** of the Flight Conditions widget.
- **Favourites on Free Flight**: favourite aircraft and liveries loaded in one click.
- **Aircraft gallery and list** in the aircraft selection: search, favourites first, sorts by name, studio and range.
- **Setup panel** in the aircraft selection: variants, liveries with favourites, tail number, Fuel and Identification.
- **Tail number per livery**.

Everything the mod shows is made of the sim's own components. It never modifies a file of the sim: it lives in its own `msfs-ui` package in the Community folder, and the app's **Remove** brings the original menu back.

Since 1.0.0 (not published), fixes from the code reviews:

- The mod: the weather bar no longer lets a click through to the map while the sim blocks the flight conditions; every wait on the sim is bounded; a favourite of another variant loads with its own livery; the sim's aircraft order is put back when the gallery closes.
- The app: installations and removals run one at a time; a removal stopped by a locked file leaves a package still recognised; a failed hot reload after a successful installation is a warning; settings saved by a newer version are replaced only after a confirmation; logs are kept 30 days.

## 1.0.0 (2026-10-19)

The 1.0 rewrite (not published): the WinUI 3 app replaces the 0.3.0 command-line tool, and the mod is rewritten with the sim's own components and settings read at runtime.
