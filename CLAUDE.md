# MSFS-UI: instructions for Claude Code

A personal mod of the MSFS 2024 main menu (Steam, sim 1.9.18, `fs-base-ui` 0.1.10) and the Windows app that installs it. The documentation is in [docs/](docs/README.md); this file sums up what to keep in mind while working on the project.

## Names and layout

- **MSFS-UI-GENERATOR**: the Windows app (`generator/`, exe `MSFS-UI-GENERATOR.exe`, data in `%LOCALAPPDATA%\MSFS-UI-GENERATOR`).
- **msfs-ui**: the package installed in the sim's Community folder; the mod's sources are in `mod/`.
- `docs/` (user guide, development, sim reference, feature ideas), `tools/msfs-sdk-mcp` (MCP server: the MSFS 2024 SDK and SimConnect, declared in `.mcp.json`), `tools/make-icon.ps1` (the app's icon), `build-release.ps1` (the release; output in `release/`, ignored by Git).
- The C# projects keep their internal names (`MsfsUi.App`, `MsfsUi.Core`, `MsfsUi.Core.Tests`, `MsfsUi.App.UITests`, `MsfsUi.DevTool`).

## Language

- **Everything is written in English**: code, comments, log and tool messages, app UI, mod UI, documentation, plans and commit messages. Only the conversation with the user is in French.
- The mod UI reuses the sim's translation keys when they exist (`translate('TT:…')`).

## Commands

```powershell
cd mod; npm run check; cd ..                     # contracts, tsc, esbuild → mod/dist/main.js, node:test
dotnet build generator/MsfsUi.slnx               # warnings are errors (the app embeds mod/dist/main.js: build the mod first)
dotnet test generator/MsfsUi.slnx                # Core tests + UI tests (they open app windows, about 20 s)
dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"
winapp run generator/MsfsUi.App/MsfsUi.App.csproj --detach --json
pwsh -File build-release.ps1                     # release\MSFS-UI-GENERATOR\ + zip (mod in release mode, every test, publish)

$dev = "generator\MsfsUi.DevTool\bin\Debug\net10.0-windows\msfs-ui-dev.exe"
& $dev install [--settings file]                 # package with mod/dist/main.js + generated config.js
& $dev reload; & $dev console "[msfs-ui]"; & $dev eval "window.__msfsUiRuntime"; & $dev check
```

- After a change of `mod/features.json`: `MSFS_UI_UPDATE_FIXTURES=1 dotnet test generator/MsfsUi.slnx`, then `npm run check` in `mod/` (shared `config.js` fixtures).
- The sim reads a new package and the MasterPage only at start-up; a file **added** to a mounted package is not served until a restart; everything else reloads live (`reload`).
- The VS Code C# extension (Roslyn, C# Dev Kit) keeps `generator/` open: stop its servers (with the user's agreement) before renaming folders there.

## Working method

1. Present each step (what, files, open points) and **wait for the user's go-ahead** before coding; one commit per step validated, in the form the user asks; never push.
2. Explore the sim: `fs-base-ui\html_ui\Global\*.js` and `cookedcomps\*` (`name="…"`, `…Manipulator` classes, `Game.…` paths); read the real state with `msfs-ui-dev eval`; try an action, then put the original state back.
3. Code, build, test; install and reload in the sim.
4. Verify by measuring (in the sim: `eval`, `getBoundingClientRect`; in the app: UI Automation from PowerShell, elements by `AutomationProperties.AutomationId`, buttons through `InvokePattern`), alignments to the pixel; then ask the user for a screenshot.
5. Document (`docs/`, `mod/README.md`, this file), then commit.

## Rules

- **No personal data** anywhere in the project or the release (user's rule): the author is **Proxi64**, never the user's first name; paths to a user's folder use variables (`%USERPROFILE%`, `%LOCALAPPDATA%`) or are relative to the repository; release binaries are built with mapped paths and without Source Link (`generator/Directory.Build.targets`).
- **No file of Asobo** in the repository: the MasterPage is read on the user's machine.
- **Readable exports only**: `/Global/engine_ui.bundle.js`, `/Global/shared/utils.js`, `/Global/shared/store.js`; never the minified names of `lib.js`.
- **Every change to the sim is reversible**: it goes through a `Scope`.
- **ES2017**, no operator before `await`, no raw U+2028 / U+2029 (`String.fromCharCode`); the build refuses them. The Write and Edit tools turn `\uXXXX` escapes into raw characters: build code points (`char.ConvertFromUtf32`, `String.fromCharCode`). In Bash, heredocs and `node -e` lose backslashes and backticks: write scripts to the scratchpad with the Write tool, then run them.
- **Contracts** (docs/development.md): `mod/features.json` and `mod/compat.json` are shared with the app; the build refuses a feature module that does not read its options, and any sim reference (GUID, `name="…"`, `TT:` key, `/Global` import, `coui://` file, `--color…`) missing from `compat.json`.
- **The sim's own components** for everything visible (user's rule): `mod/src/sim/components.ts` creates them with `window.ResourcesManager.createElementFromGuid`; declare each in `compat.json` "components" (attributes, states, values, children) and the manipulator APIs called in "symbols". Text fields: the sim's `Search_Input` (`src/sim/text-field.ts`). Lists that scroll: the sim's `<real-scroll direction="y">`. A text too long for its place: the sim's `marquee__trigger` class on the tile's host. `theme.css` keeps only what the sim draws without a component (card layers, section headers).
- **Persistent data** in `datastorage` (`MSFS_UI_` prefix), never `localStorage` (emptied at every start).
- **App**: nullable, warnings as errors, analyzers `latest-recommended`, code style enforced (`generator/.editorconfig`), the public API of `MsfsUi.Core` documented, every package version pinned (`generator/Directory.Packages.props`). MVVM: one view model per page, `x:Bind` with an explicit `Mode`; texts in `Strings/en-us/Resources.resw`; no colour in XAML; every focusable element named; `SimSession.RefreshAsync` never throws but when cancelled; no exception thrown from `async void` handlers. Details in [docs/development.md](docs/development.md).
- **UI tests** run the built app on an isolated profile (`MSFS_UI_DATA_ROOT`, `MSFS_UI_INSPECTOR_HOST`): they never touch the real sim, Community folder or data.

## Findings to keep in mind

The full list is in [docs/sim-reference.md](docs/sim-reference.md#coherent-gt). The ones that bite most often:

| Area | Finding | Answer |
|---|---|---|
| Mouse | Click and wheel reach only elements with `data-input-group`; without it they go to the map or scene under the panel | `inputLocker` on every panel; never `pointer-events: none` on a panel (it is inherited) |
| Layout | Visual states apply on the next frame; no ellipsis; computed widths rounded down; a one-line `flex-wrap` stretches its items; negative margins do not widen | Measure after a short delay; fit the layout to the measured text; whole-pixel widths, the last item takes the rest; `align-items: flex-start` |
| Components | An optional visual state added by the mod is hidden again for good by the Disabled state | Show such an element by CSS |
| Screens | The sim's screens animate and resize without notice; the airport / traffic cards share the weather bar's place | Absolute panels laid out every 250 ms on an anchor; tabs; `isOnScreen` |
| Data | `FlightConditions` published only after `UpdateFlightConditions.request("")`; updates may arrive out of order | Request on mount; grace delay |
| Configurator | Released when leaving the aircraft selection; a choice sent to it then makes the current aircraft invalid | `syncConfiguratorToCurrent()` before acting |
| Aircraft list | One entry per modular aircraft | Reason per aircraft (name + publisher) |
| Start-up | The sim activates Free Flight behind the scenes, then resets the flight conditions | Apply a remembered choice when the panel is really visible |
| Resize | An artificial `resize` event crashes a virtual list of the sim | Never send one |
| WinUI | A closed `InfoBar` still counts in a `StackPanel`'s `Spacing`; a `ContentDialog` shows as a `Popup` window to UI Automation | Bind its `Visibility` with `IsOpen` |

The map gestures to remove the departure / arrival were tried and abandoned at the user's request: do not propose them again unprompted.

## Progress

Plan: `%USERPROFILE%\.claude\plans\jaunty-foraging-allen.md` (steps 0 to 6). The Git history was started again from version 1.0.0 (2026-10-19, without personal data): the steps below, and version 0.3.0 (Node tool `cli/`, first mod), are no longer in it.

| Step | Content |
|---|---|
| 0 | WinUI 3 solution scaffold |
| 1a–1c | `MsfsUi.Core` (sim detection, package build and install, Coherent inspector, compatibility check), `msfs-ui-dev` |
| 2a | Mod foundations: contracts, build, runtime `config.js` |
| 2b | Fast menus, time wheel, tail number per livery |
| 2c | Weather bar made of the sim's components |
| 2d-1 | Setup panel in the aircraft selection |
| 2d-2a | Aircraft gallery and list (sorts, favourites first, the sim's `real-scroll`, three-line tiles) |
| 2d-2b | Free Flight favourites; the mod at parity with 0.3.0 |
| 3a | App foundations and the Home page |
| 3b | Features page |
| 3c | Compatibility and Log pages |
| 3d | UI tests, code review fixes, accessibility, light / dark button |
| 5 | Reorganisation: `generator/`, `mod/`, `docs/` in English; the app named MSFS-UI-GENERATOR (data folder moved); 0.3.0 removed |
| 4 | Version 1.0.0: release build (`build-release.ps1`, self-contained folder and zip, 217 MB / 81 MB), app icon (`tools/make-icon.ps1`), the WinUI component of the Windows App SDK instead of the metapackage; Data page and backup / restore removed (user's decision: not needed); Readme page at the bottom of the navigation (how it works, no file of the sim modified) |
| **6** | Next: improvements from [docs/feature-ideas.md](docs/feature-ideas.md) |

The package installed in Community is still the 1.0.0-dev mod: Generate & install from the 1.0.0 app (`release\MSFS-UI-GENERATOR\`) updates it.
