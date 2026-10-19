# MSFS-UI

A personal mod of the **Microsoft Flight Simulator 2024** main menu, and the Windows app that installs it.

- **MSFS-UI-GENERATOR**, the app: choose the features and their options, generate the `msfs-ui` package and install it in the sim's Community folder, check that the sim still offers what the mod needs.
- **msfs-ui**, the package: faster menus; a weather and time bar on Free Flight with presets, METAR, sun times and traffic; the wheel on the time; favourite aircraft and liveries loaded in one click; an aircraft gallery and list with search, favourites and sorts; a setup panel for variants, liveries and tail number; a tail number per livery. Everything it shows is made of the sim's own components.

Version 1.0.0, tested on MSFS 2024 1.9.18 (Steam), base package `fs-base-ui` 0.1.10.

## Repository

```
generator/   MSFS-UI-GENERATOR (.NET 10, WinUI 3): the app, its library, its tests and a developer tool
mod/         the menu mod (TypeScript), installed in the sim as the msfs-ui package
docs/        documentation
tools/       msfs-sdk-mcp, the MSFS 2024 SDK for Claude Code (MCP server); make-icon.ps1, the app's icon
build-release.ps1   the release: release\MSFS-UI-GENERATOR\ and its zip
```

## Build

```powershell
cd mod; npm ci; npm run check; cd ..
dotnet build generator/MsfsUi.slnx
dotnet test generator/MsfsUi.slnx
```

Then run `generator\MsfsUi.App\bin\Debug\net10.0-windows10.0.26100.0\win-x64\MSFS-UI-GENERATOR.exe`.

## Documentation

- [User guide](docs/user-guide.md)
- [Development](docs/development.md)
- [Sim reference](docs/sim-reference.md)
- [Feature ideas](docs/feature-ideas.md)

## How it works

The menu of MSFS 2024 is an HTML page run by Coherent GT. The `msfs-ui` package replaces the menu's root component, the MasterPage, with a copy made on the user's machine from the installed sim, plus a small loader that imports the mod. The mod works on the menu's own objects, and everything it changes is undone when it unloads, so that it reloads live while the sim runs. The repository holds no file of Asobo.
