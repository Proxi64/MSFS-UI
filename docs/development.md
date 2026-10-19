# Development

How the project is built, tested and changed. Users only need the [user guide](user-guide.md).

## Repository

```
generator/   MSFS-UI-GENERATOR, the Windows app (.NET 10, WinUI 3), with its library and tests
mod/         the menu mod (TypeScript → one ES2017 module), installed in the sim as the msfs-ui package
docs/        this documentation
tools/       msfs-sdk-mcp, an MCP server giving Claude Code the MSFS 2024 SDK and SimConnect; make-icon.ps1, the app's icon
build-release.ps1   the release (see below); its output goes to release/, ignored by Git
```

Inside `generator/` (solution `MsfsUi.slnx`):

| Project | Role |
|---|---|
| `MsfsUi.App` | The WinUI 3 app (`MSFS-UI-GENERATOR.exe`): unpackaged, self-contained, MVVM with CommunityToolkit.Mvvm |
| `MsfsUi.Core` | Everything but the UI: sim detection, package build and install, Coherent inspector client, compatibility check, settings |
| `MsfsUi.Core.Tests` | MSTest tests of the library; they never touch the sim or the real Community folder |
| `MsfsUi.App.UITests` | UI tests: the built app driven through Windows UI Automation on an isolated profile |
| `MsfsUi.DevTool` | `msfs-ui-dev`, the developer's console over `MsfsUi.Core` (not shipped) |

The mod's own layout, build and conventions are in [mod/README.md](../mod/README.md).

## Prerequisites

- Windows 11, MSFS 2024 (to try the mod);
- .NET 10 SDK, and WinApp CLI 0.7+ with Developer Mode (to run the app from the command line);
- Node.js 22.18+ (only to build the mod; the app ships the built module).

## Build and test

```powershell
cd mod; npm ci; npm run check; cd ..                    # contracts, tsc, esbuild → mod/dist/main.js, node:test
dotnet build generator/MsfsUi.slnx                      # warnings are errors
dotnet test generator/MsfsUi.slnx                       # Core tests + UI tests (they open app windows, about 20 s)
dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"   # without the UI tests
winapp run generator/MsfsUi.App/MsfsUi.App.csproj --detach --json
```

The app embeds `mod/dist/main.js`, `mod/features.json` and `mod/compat.json`: build the mod first, or the app's build stops with a clear message.

After a change of `mod/features.json`, the settings modules shared by both test suites are generated again: `MSFS_UI_UPDATE_FIXTURES=1 dotnet test generator/MsfsUi.slnx`, then `npm run check` in `mod/`.

## The developer tool

`msfs-ui-dev` works on the real sim, without the app's UI:

```powershell
$dev = "generator\MsfsUi.DevTool\bin\Debug\net10.0-windows\msfs-ui-dev.exe"
& $dev status                       # sim found, package state, conflicts
& $dev install [--settings file]    # package with mod/dist/main.js and the generated config.js
& $dev reload                       # hot reload of the mod while the sim runs
& $dev console "[msfs-ui]"          # the mod's log in the sim's console
& $dev eval "window.__msfsUiRuntime.settings"   # JavaScript in the menu page
& $dev check [--detail]             # compatibility, offline and live
```

## How the package works

1. The main menu (`mainUi.html`) is built from "cooked" components in `fs-base-ui\cookedcomps\`. Its root is the **MasterPage**, `{7DA60FBA-EF32-48F2-974D-F8BEA35337A4}`: one line of nested `<ui-resource-element>`, and a `.json` describing its children.
2. A Community package replaces a file of a base package by placing it at the same relative path: the `msfs-ui` package contains `cookedcomps\{7DA60FBA-…}.html` and `.json`.
3. The copy is made on the user's machine: the repository holds no file of Asobo. `PackageBuilder` reads the installed component, checks its shape (one line, balanced tags, no script, no loader yet) and inserts the loader before the last closing tag: an invisible image whose `onload` creates a `<script type="module" src="/msfs-ui/main.js">`, once, and only in `mainUi.html`.
4. `main.js` imports the sim's modules by their absolute paths (`/Global/engine_ui.bundle.js`, `/Global/shared/utils.js`, `/Global/shared/store.js`): it gets **the same instances** as the menu, and works on the real objects.
5. The settings are a second module, `config.js`, which the mod imports at start-up (see [Contracts between the app and the mod](#contracts-between-the-app-and-the-mod)): changing a setting rewrites this file and reloads the mod, without a restart.

| Package file | Content |
|---|---|
| `cookedcomps\{MasterPage}.html` / `.json` | Copy of the sim's component, with the loader |
| `html_ui\msfs-ui\main.js` | The mod, as embedded in the app |
| `html_ui\msfs-ui\config.js` | The user's settings (`ConfigScript`) |
| `html_ui\msfs-ui\px.gif` | The 1 × 1 image that triggers the loader |
| `msfs-ui.json` | State: version, generation time, `fs-base-ui` version, SHA-256 of the original MasterPage, of `main.js` and of `config.js`; tells why the package needs generating again, and that the folder is ours |
| `layout.json`, `manifest.json` | Files every package needs (exact FILETIME dates, total size) |

## Contracts between the app and the mod

The app is written in C#, the mod in TypeScript, and the user's machine has no Node: the app cannot compile the mod. Three things are therefore settled by files that both sides read, so that they never disagree (decided on 2026-10-16, at the start of version 1.0).

**The settings are read at runtime.** `main.js` is the same for every user; the app writes the user's choices next to it, as a module:

```js
// Generated by MSFS-UI-GENERATOR 1.0.0. Do not edit: change the settings in MSFS-UI-GENERATOR.
export default {
  "schemaVersion": 1,
  "features": {
    "weatherBar": { "enabled": true, "metar": true, … }
  }
};
```

- The mod imports it at start-up with `import('/msfs-ui/config.js?t=' + Date.now())`, so a hot reload picks up new settings. If the file is missing or invalid, the mod logs an error and runs with the defaults compiled into `main.js` (verified in the sim: syntax error, wrong schema, missing file).
- The source of the settings is the app's `settings.json`; `config.js` is always derived from it, never edited.
- `msfs-ui.json` records the hashes of `main.js` and `config.js`, so that Home tells "settings changed" apart from "app updated" and "sim updated" (MasterPage hash).

**`mod/features.json` is the feature catalogue**: for each feature its `id`, `title`, `description`, `screen`, `enabledByDefault`, and typed options (`boolean`, or `number` with `min` / `max` / `step` / `unit`, each with a `default`). Its schema is `mod/schema/features.schema.json`.
- The mod build compiles the defaults into `main.js` and fails if a feature module and its entry disagree (missing feature, option not read, wrong type).
- The app embeds the same file and builds the Features page from it; it checks the stored settings against it (unknown ids dropped, values clamped to their range, missing values set to the default).

**`mod/compat.json` lists what the mod relies on in the sim**: readable exports by module, screens, anchors (`name="…"`), components, data-model and event symbols, files, CSS variables and translation keys, plus live checks. Its schema is `mod/schema/compat.schema.json`. The app's compatibility check runs from it, and the mod build refuses a sim reference that is not listed: a change that adds a dependency on the sim updates `compat.json` in the same commit.

Options set aside:
- settings compiled into `main.js` (as in 0.3.0): the app would need Node and esbuild to change a setting;
- a `config.json` read with `fetch`: equivalent, but `fetch` of a package file is not proven in Coherent GT, whereas a module import is (the loader uses one);
- settings in the sim's `datastorage`: the mod could not be configured while the sim is closed.

The cost: the mod's start-up waits for `config.js`, and both files are a contract versioned by `schemaVersion`. A new option type (a choice list, for example) needs both readers updated.

## Working method

1. **Explore the sim**: search `fs-base-ui\html_ui\Global\*.js` and `cookedcomps\*` (`name="…"` attributes, `…Manipulator` classes, `Game.…` paths); read the real state with `msfs-ui-dev eval`; try an action, then put the original state back.
2. **Code**, then `npm run check` (mod) or `dotnet build` / `dotnet test` (app).
3. **Verify by measuring**: in the sim with `eval` (`getBoundingClientRect`, classes, model values), in the app with UI Automation (elements by `AutomationProperties.AutomationId`), rather than by asking to look; alignments to the pixel. Then a screenshot to the user.
4. **Document** (this folder, `mod/README.md`), then one commit per step validated in the sim.

## Rules

- **No file of Asobo** in the repository: the MasterPage is read on the user's machine.
- **Readable exports only** from the sim: `/Global/engine_ui.bundle.js`, `/Global/shared/utils.js`, `/Global/shared/store.js`; never the minified names of `lib.js`.
- **Every change to the sim is reversible**: it goes through a `Scope`, undone on unload and hot reload.
- **ES2017**, no operator before `await`, no raw U+2028 / U+2029 (`String.fromCharCode`); the build checks all three.
- **Contracts**: `mod/features.json` and `mod/compat.json` are shared with the app. A feature lives in `mod/src/features/<id>` and reads every option of its catalogue entry; every sim reference (GUID, `name="…"`, `TT:` key, `/Global` import, `coui://` file, CSS variable) is listed in `compat.json`. The build refuses anything else.
- **The sim's own components** for everything visible (`src/sim/components.ts`, `ResourcesManager.createElementFromGuid`), never imitations; `theme.css` only keeps what the sim draws without a component (card layers, section headers).
- **Persistent data** in `datastorage` with the `MSFS_UI_` prefix, never `localStorage` (emptied at every start).
- **Everything in English**: code, comments, messages, UI, documentation, commits.
- **No personal data**, in the repository or in the release: the author is **Proxi64**; a path to a user's folder is written with a variable (`%USERPROFILE%`, `%LOCALAPPDATA%`, `os.homedir()`) or relative to the repository. Release binaries are built with mapped paths and without Source Link (`generator/Directory.Build.targets`, `generator/Directory.Build.props`), so that they hold no path of the build machine.
- **App (C#)**: nullable, warnings as errors, analyzers `latest-recommended`, code style enforced (`generator/.editorconfig`), the public API of `MsfsUi.Core` documented, every package version pinned (`generator/Directory.Packages.props`).

## The app's structure

- Services are composed in `App.xaml.cs`, the Core services as `msfs-ui-dev` composes them.
- `Services/SimSession.cs` keeps the sim, its running state, the package status and the generation inputs up to date (every 5 s) for every page. `RefreshAsync` never throws but when cancelled: the pages refresh in `finally` blocks and the polling goes on.
- One view model per page (`ViewModels/`, CommunityToolkit.Mvvm partial properties), pages bound with `x:Bind` (with an explicit `Mode`: `OneTime` for values that never change). A row command of a list belongs to the row.
- Texts in `Strings/en-us/Resources.resw` (`x:Uid` in XAML, `Strings.Get` in code); dialogs through `IDialogService`; the theme through `ThemeService`.
- No colour in XAML (theme resources only, for dark and high contrast); every focusable element has an accessible name; a result shown by an icon also has it in its accessible name.
- Page content sits on the left up to `PageMaxWidth`, in a `Grid` whose single star column has that `MaxWidth`. A closed `InfoBar` still counts in a `StackPanel`'s `Spacing`: its `Visibility` follows its `IsOpen`.
- Data folder: `%LOCALAPPDATA%\MSFS-UI-GENERATOR` (`AppPaths`): `settings.json`, `app.json`, `logs\`, `staging\`.

## UI tests

`generator/MsfsUi.App.UITests` starts the built `MSFS-UI-GENERATOR.exe` on an isolated profile (`AppSession`): a temporary folder with a fake `fs-base-ui`, a fake Community folder and the data folder, whose `app.json` names them. Two variables, read by `App.xaml.cs` for the tests only, point the app there: `MSFS_UI_DATA_ROOT` (data folder) and `MSFS_UI_INSPECTOR_HOST` (`127.0.0.1:9`, where nothing listens). The real sim, Community folder and data are never touched. Buttons are clicked once enabled (an async command stays disabled until its previous run ends). A `ContentDialog` shows as a `Popup` window inside the main window.

## Release

```powershell
pwsh -File build-release.ps1 [-SkipUiTests]
```

It stops at the first failure:
1. the mod: `npm ci`, `npm run check`, then `node build/build.ts --release` (the module without its source map, which the app embeds);
2. the app: `dotnet build` of the whole solution in Release, then every test (UI tests included unless `-SkipUiTests`; they run the Release app);
3. `dotnet publish` of `MsfsUi.App` (profile `win-x64`: self-contained, unpackaged, ReadyToRun) to `release\MSFS-UI-GENERATOR\`;
4. the zip `release\MSFS-UI-GENERATOR-<version>.zip`.

The version comes from `mod/features.json` (`modVersion`) and must equal `<Version>` in `generator/Directory.Build.props`. The `release\` folder is ignored by Git. Afterwards `mod/dist/main.js` is the release module: `npm run check` builds the development one again.

The folder (about 217 MB, 82 MB zipped) runs on any Windows 10 1809+ x64 machine without installing anything: .NET and the Windows App SDK are inside. The app references only the **WinUI component** of the Windows App SDK (`Microsoft.WindowsAppSDK.WinUI`, with `Microsoft.Windows.SDK.BuildTools.MSIX` as a component used on its own requires), not the `Microsoft.WindowsAppSDK` metapackage, whose AI, ML, Search and Widgets components would add about 60 MB.

The icon (`generator/MsfsUi.App/Assets/AppIcon.ico`) is drawn by `tools/make-icon.ps1` (`-Preview` also writes PNG previews).
