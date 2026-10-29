# MSFS-UI: instructions for Claude Code

A personal mod of the MSFS 2024 main menu (Steam, sim 1.9.21, `fs-base-ui` 0.1.10; most findings made on 1.9.18) and the Windows app that installs it. The documentation is listed in [README.md](README.md#documentation); this file sums up what to keep in mind while working on the project.

## Names and layout

- **MSFS-UI-GENERATOR**: the Windows app (`generator/`, exe `MSFS-UI-GENERATOR.exe`, data in `%LOCALAPPDATA%\MSFS-UI-GENERATOR`).
- **msfs-ui**: the package installed in the sim's Community folder; the mod's sources are in `mod/`.
- **wasm/**: the vault, a WASM module of the `msfs-ui` package that keeps the mod's data in files of its `work` folder (2.0; protocol and file format in `wasm/README.md`).
- `docs/` (user guide, development, sim reference, next steps, feature ideas, `images/` for the README's screenshots), `tools/msfs-sdk-mcp` (MCP server: the MSFS 2024 SDK and SimConnect, declared in `.mcp.json`), `tools/make-icon.ps1` (the app's icon), `.claude/skills/msfs-wasm` (skill for the sim's WASM modules: use it for any work on the 2.0 module, its build, its CommBus messages or its files), `build-release.ps1` (the release; output in `release/`, ignored by Git).
- `LICENSE`: MIT, © 2026 Proxi64 (also in `mod/package.json` and `tools/msfs-sdk-mcp`); the README opens with a disclaimer (not affiliated with Microsoft or Asobo, use at your own risk) and ends with the licence.
- The C# projects keep their internal names (`MsfsUi.App`, `MsfsUi.Core`, `MsfsUi.Core.Tests`, `MsfsUi.App.UITests`, `MsfsUi.DevTool`).

## Language

- **Everything is written in English**: code, comments, log and tool messages, app UI, mod UI, documentation, plans and commit messages. Only the conversation with the user is in French.
- The mod UI reuses the sim's translation keys when they exist (`translate('TT:…')`).

## Commands

```powershell
cd mod; npm run check; cd ..                     # contracts, tsc, esbuild → mod/dist/main.js, node:test
dotnet build generator/MsfsUi.slnx               # warnings are errors (the app embeds mod/dist/main.js and wasm/dist/msfs-ui.wasm: build the mod and the module first)
dotnet test generator/MsfsUi.slnx                # Core tests + UI tests (they open app windows, about 20 s)
dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"
winapp run generator/MsfsUi.App/MsfsUi.App.csproj --detach --json
pwsh -File wasm/build.ps1                        # the vault module: build, checks, node tests (needs MSFS2024_SDK)
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
5. Document (`docs/`, `mod/README.md`, this file, `docs/next-steps.md`), then commit.

## Rules

- **No personal data** anywhere in the project or the release (user's rule): the author is **Proxi64**, never the user's first name; paths to a user's folder use variables (`%USERPROFILE%`, `%LOCALAPPDATA%`) or are relative to the repository; release binaries are built with mapped paths and without Source Link (`generator/Directory.Build.targets`).
- **No file of Asobo** in the repository: the MasterPage is read on the user's machine.
- **Readable exports only**: `/Global/engine_ui.bundle.js`, `/Global/shared/utils.js`, `/Global/shared/store.js`; never the minified names of `lib.js`.
- **Every change to the sim is reversible**: it goes through a `Scope`.
- **ES2017**, no operator before `await`, no raw U+2028 / U+2029 (`String.fromCharCode`); the build refuses them. The Write and Edit tools turn `\uXXXX` escapes into raw characters: build code points (`char.ConvertFromUtf32`, `String.fromCharCode`). In Bash, heredocs and `node -e` lose backslashes and backticks: write scripts to the scratchpad with the Write tool, then run them.
- **Contracts** (docs/development.md): `mod/features.json` and `mod/compat.json` are shared with the app; the build refuses a feature module that does not read its options, and any sim reference (GUID, `name="…"`, `TT:` key, `/Global` import, `coui://` file, `--color…`) missing from `compat.json`.
- **The sim's own components** for everything visible (user's rule): `mod/src/sim/components.ts` creates them with `window.ResourcesManager.createElementFromGuid`; declare each in `compat.json` "components" (attributes, states, values, children) and the manipulator APIs called in "symbols". Text fields: the sim's `Search_Input` (`src/sim/text-field.ts`). Lists that scroll: the sim's `<real-scroll direction="y">`; a long list of the sim's tiles recycles a pool of them (`sim/component-pool.ts`, `core/virtual-list.ts`): never keep every tile alive. A text too long for its place: the sim's `marquee__trigger` class on the tile's host. `theme.css` keeps only what the sim draws without a component (card layers, section headers).
- **Persistent data** (`MSFS_UI_` prefix): the mod's data goes through `core/storage.ts` to the vault (`sim/vault.ts`, the WASM module), `datastorage` only as the fallback when the module does not answer; never `localStorage` (emptied at every start).
- **App**: nullable, warnings as errors, analyzers `latest-recommended`, code style enforced (`generator/.editorconfig`), the public API of `MsfsUi.Core` documented, every package version pinned (`generator/Directory.Packages.props`). MVVM: one view model per page, `x:Bind` of values with an explicit `Mode` (`OneTime` for those that never change; command and event bindings keep the default, as the WinUI review advises); texts in `Strings/en-us/Resources.resw`; no colour in XAML; every focusable element named, with a stable `AutomationId` (from the catalogue's ids in templates); `SimSession.RefreshAsync` never throws but when cancelled, and reads on a worker thread; installations and removals one at a time (`PackageInstaller` lock, `SimSession.PackageOperation` for the pages); no exception thrown from `async void` handlers. Details in [docs/development.md](docs/development.md).
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
| Performance | Writing a CSS variable lays the whole subtree out again, even with its current value (about 90 ms under the gallery's tiles) | `setVariable()`: write a variable only when it changes, above all in the 250 ms layout passes |
| Storage | The sim writes `datastorage` to the disk (its Steam Cloud profile) only when it saves its profile (an option validated): not after a write, not when it quits. On one user's sim (a Microsoft Store install; other Store users have no such problem) `datastorage` is missing from `mainUI.html` (another mod's author, on a Store sim: it shows after `ADD_VIEW_LISTENER` of `JS_LISTENER_DATASTORAGE`) | The vault (2.0) replaces it: the module writes its own files at once. `sim/profile-save.ts` stays for the `datastorage` fallback: after every write, re-validate one option with its current value; for that user's sim, next-steps.md 1.5 |
| Resize | An artificial `resize` event crashes a virtual list of the sim | Never send one |
| WinUI | A closed `InfoBar` still counts in a `StackPanel`'s `Spacing`; a `ContentDialog` shows as a `Popup` window to UI Automation | Bind its `Visibility` with `IsOpen` |

The map gestures to remove the departure / arrival were tried and abandoned at the user's request: do not propose them again unprompted.

## Progress

The original plan, `%USERPROFILE%\.claude\plans\jaunty-foraging-allen.md` (steps 0 to 6), is history: later decisions changed it (names, layout, no Data page). **What comes next is in [docs/next-steps.md](docs/next-steps.md)**: keep it up to date at the end of every step. The Git history was started again from version 1.0.0 (2026-10-19, without personal data): the steps below, and version 0.3.0 (Node tool `cli/`, first mod), are no longer in it.

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
| 4 | Version 1.0.0: release build (`build-release.ps1`, self-contained folder and zip, 218 MB / 81 MB), app icon (`tools/make-icon.ps1`), the WinUI component of the Windows App SDK instead of the metapackage; Data page and backup / restore removed (user's decision: not needed); Readme page at the bottom of the navigation (how it works, no file of the sim modified) |
| Reviews | Code reviews of the mod (`9e73a13`: points 1 to 4 fixed, the rest in next-steps.md) and of the app (`18f8f04`, every point fixed: package operations, removal, reload warnings, newer settings, inspector, polling, logs, automation ids) |
| 1.0.1 | Version 1.0.1 with the review fixes: release built and checked without personal data (217 MB / 81 MB); MIT License; published on 2026-10-19 (public repository, GitHub release `1.0.1` with its zip). The owner pushes and publishes: the permission system blocks Claude's pushes |
| 1.0.2 | Detailed Storage check (another user's favourites not kept: their sim's storage is to be found), release built on 2026-10-26; the mod unchanged |
| 1.6 | User report of 2026-10-27 (iFly 737 MAX, FS Reborn Phenom 300E): the setup panel's variants and liveries in the sim's `real-scroll`, heights shared by `setup-layout.ts`; checked in the sim |
| 1.7 | Aircraft selection layouts (design and plan in `docs/superpowers/`): the *choice* option type on both readers (radio buttons in the app); the configurator logic shared (`sim/configurator.ts`); the gallery's *Layout* option, *Side by side*: aircraft 3 and liveries 2 per row of the same width (`livery-column.ts`, `liveries.ts`), List rows on both sides, the left column at 400 units while the gallery shows the liveries (`sim/selection-layout.ts`). Performance measured in the sim: `setVariable()`, no `tileHover` while the setup panel shows, a recycling pool of tiles (156 ms per change of layout before, 20 to 40 ms after) |
| 1.2.0 | Version 1.2.0 (2026-10-27, numbered 1.1.0 at first): 1.6, 1.7 (aircraft selection layouts, smoother aircraft selection) and 1.8 (the mod's data kept after a restart: `sim/profile-save.ts`), final review by two fresh reviewers and its fixes; release built on 2026-10-27 (217 MB / 81 MB, rebuilt with 1.8), checked without personal data, not published yet |
| 1.2.1 | Version 1.2.1 (2026-10-28): the map buttons of Free Flight (legend, layers, display) work again, the weather bar steps aside while their panel is open (1.9); release built, checked without personal data, published on 2026-10-28 (tag `v1.2.1`). Storage missing on one user's sim (a Microsoft Store install, 1.5) measured, on hold |
| 1.10 | Favourites are liveries (user report of 2026-10-29): no heart on the aircraft tiles, an aircraft with a favourite livery is a favourite, the order of the favourites kept while the screen stays, the favourite aircraft of earlier versions removed; checked in the sim. For 1.3.0 (provisional: the project is to be reoriented) |
| 1.11 | *Side by side* is the default layout of the aircraft selection (the owner's decision); settings already saved keep their value. For 1.3.0 |
| 1.3.0 | Version 1.3.0 (2026-10-29, a provisional number: the project is to be reoriented): 1.10, 1.11 and 1.12 (livery rows as wide as their header); release built (217 MB / 81 MB), checked without personal data, published on flightsim.to |
| 1.3.1 | Version 1.3.1 (2026-10-29): 1.13 (a heart on every livery: one without a folder is identified by its thumbnail's); the owner raises the version at each upload to flightsim.to; release built, not published yet |
| 2.0-1 | 2.0 step 1, the WASM vault (branch `v2`): the module `msfs-ui.wasm` keeps the mod's data in A / B files of its `work` folder (on the disk at once, kept after a force-stop); `core/storage.ts` over `sim/vault.ts`, `datastorage` as the fallback; the package ships the module with an MSFS 2024 manifest; a Storage group on the Compatibility page. Measured in the sim (Steam, 1.9.21), details in docs/next-steps.md. The data of 1.x is copied once into a new vault (the owner's request) |
| 2.0.0 | Version 2.0.0 (2026-10-29): the vault released (merged into `main`); release built (217 MB / 82 MB), checked without personal data; installed by the release app over 1.3.1 and checked in the sim (the 1.x data copied into the vault, no *Applying setting* message) |
| **6** | Next: new features, from 6a (A1, favourite and recent airports); order, design and open questions in [docs/next-steps.md](docs/next-steps.md) |

The package installed in Community is a 2.0 development build of 2026-10-29 with the vault (`msfs-ui-dev install`, the app's settings: side by side layout); before it, the published 1.0.1, validated in the sim on 2026-10-19 (163/163 compatibility checks, every feature working).
