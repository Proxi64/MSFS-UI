# Changelog

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
