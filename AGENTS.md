# AGENTS.md: instructions for an AI working on MSFS-UI

You are an AI assistant (any vendor, any tool) asked to read, change, fix or extend this repository. This file gives you what you need to work on it safely: what the project is, how it is built, the rules it keeps, the traps of the environment it runs in, and how to prove a change works. Read it whole before your first change; then read the documents it points to when a task touches their area.

The person you work with may be a beginner: their guide is [docs/build-your-own.md](docs/build-your-own.md). `CLAUDE.md` holds the original author's own instructions for Claude Code and the project's history; where it and this file differ on *how to work with the user*, follow the user in front of you.

## 1. How to work with the user

1. **Plan before code.** For each change, say in a few lines what you will do, which files you will touch and what is uncertain; wait for the user's go-ahead. Small steps: one change, built, tested, tried in the sim, then the next.
2. **Explain in plain words** when the user is not a developer: what a file does, why a rule exists, what a command will do before running it.
3. **Never claim a change works before it was built, tested and, for anything visible or anything touching the sim, seen in the sim.** Say what you verified and what remains for the user to check.
4. **Never weaken a check** (the build's contract checks, a test, the C# analyzers, warnings as errors) to get a green build. Fix the cause.
5. **Do not commit, push or publish unless asked.** When asked to commit: one commit per validated step, an English message saying what changed for the user.
6. **Talk to the user in their language; write everything in the repository in English** (code, comments, log messages, UI texts, documentation, commit messages). Sim texts shown by the mod come from the sim's translation keys (`translate('TT:…')`).
7. If a task is ambiguous, or you are about to guess how the sim behaves, **ask or measure** (section 7); do not invent sim APIs, GUIDs, element names or file contents. If you cannot read a file the user has not given you, ask for it.

## 2. What the project is

A mod of the **Microsoft Flight Simulator 2024** main menu, and the Windows app that installs it (MIT, © 2026 Proxi64; version in `mod/features.json` › `modVersion`).

- The sim's menu is an HTML page run by **Coherent GT** (an old WebKit). Its root component is the **MasterPage**, `{7DA60FBA-EF32-48F2-974D-F8BEA35337A4}`, in the sim's base package `fs-base-ui` (`cookedcomps\{GUID}.html` / `.json`).
- A Community package overrides a base file by putting one at the same relative path. The package **`msfs-ui`** holds a copy of the MasterPage **made on the user's machine** (never stored in the repository) with a loader inserted (an invisible image whose `onload` imports `/msfs-ui/main.js` once, in `mainUi.html` only), plus `html_ui/msfs-ui/main.js` (the mod), `html_ui/msfs-ui/config.js` (the user's settings), `px.gif`, `modules/msfs-ui.wasm` (the vault), `msfs-ui.json` (state and hashes), `layout.json`, `manifest.json`.
- `main.js` imports the sim's modules by absolute path and gets **the same instances as the menu**: it works on the sim's real data model and components.

Three programs:

| Part | Folder | Language | Role |
|---|---|---|---|
| **msfs-ui**, the mod | `mod/` | TypeScript → one ES2017 module (`mod/dist/main.js`, esbuild) | Every feature in the sim's menu |
| **MSFS-UI-GENERATOR**, the app | `generator/` | C#, .NET 10, WinUI 3, MVVM (CommunityToolkit.Mvvm) | Finds the sim, builds and installs the package, Features page (settings), compatibility check, logs. Embeds `main.js`, `features.json`, `compat.json` and the vault module |
| **The vault** | `wasm/` | C++17 → WebAssembly (MSFS 2024 SDK) | Stores the mod's data in files of the package's `work` folder; talks to the mod over the CommBus |

`generator/` projects: `MsfsUi.App` (the app), `MsfsUi.Core` (everything but UI: `Sim/` detection, `Packaging/` build and install, `Coherent/` inspector client, `Compatibility/`, `Features/` catalogue and settings, `Settings/`), `MsfsUi.Core.Tests` (MSTest), `MsfsUi.App.UITests` (UI Automation on an isolated profile), `MsfsUi.DevTool` (`msfs-ui-dev`, developer CLI), `MsfsUi.Launcher` (release launcher, NativeAOT).

## 3. Commands

Run from the repository root (PowerShell; `pwsh` 7 for scripts).

```powershell
cd mod; npm ci; npm run check; cd ..     # schemas, contract checks, tsc (strict), esbuild → mod/dist/main.js, node:test
pwsh -File wasm/build.ps1                # the vault → wasm/dist/msfs-ui.wasm, checks, tests (needs $env:MSFS2024_SDK)
dotnet build generator/MsfsUi.slnx       # warnings are errors; needs mod/dist/main.js and wasm/dist/msfs-ui.wasm
dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"   # Core tests
dotnet test generator/MsfsUi.slnx        # + UI tests (open app windows, ~20 s; the user must not touch the mouse)
pwsh -File build-release.ps1 [-SkipUiTests]   # release folder + zip in release/ (needs VS C++ tools for the launcher)

$dev = "generator\MsfsUi.DevTool\bin\Debug\net10.0-windows\msfs-ui-dev.exe"
& $dev status                            # sim found, package state, conflicts, sim running
& $dev install [--settings file] [--vault none]   # package from mod/dist/main.js + config.js (+ vault)
& $dev reload                            # hot reload of the mod in the running sim
& $dev console "[msfs-ui]"               # the mod's log lines from the sim's console
& $dev eval "<JS expression>"            # evaluate in the mainUi page (or "@file.js")
& $dev check [--detail]                  # compat.json checked offline (sim files) and live
& $dev remove                            # remove the package
```

- Without the SDK, `wasm/dist/msfs-ui.wasm` can be copied from an installed official package (`<Community>\msfs-ui\modules\msfs-ui.wasm`) as long as the vault is not changed.
- After **any change of `mod/features.json`**: `MSFS_UI_UPDATE_FIXTURES=1 dotnet test generator/MsfsUi.slnx` (in PowerShell: `$env:MSFS_UI_UPDATE_FIXTURES = "1"`, then remove it), then `npm run check` in `mod/`: the `config.js` fixtures shared by both test suites are regenerated.
- The app embeds `mod/dist/main.js` at build time: after a mod change, rebuild the app before using its *Generate & install*; `msfs-ui-dev install` always takes the current `mod/dist/main.js`.
- The dev tool reaches the running sim through the Coherent GT inspector, `127.0.0.1:19999`; live commands need the sim's main menu loaded.
- **The sim reads a new package, the MasterPage and the WASM module only at start-up**; a file *added* to a mounted package is not served until a restart (the installer says so). Everything else reloads live with `reload`.

## 4. Architecture of the mod

```
mod/
  features.json        the feature catalogue (contract with the app)
  compat.json          every sim reference the mod uses (contract with the app's compatibility check)
  schema/              JSON schemas of both
  build/               build.ts (pipeline), catalog.ts (generates src/generated/catalog.ts), checks.ts (contract checks)
  types/Global/        hand-written types of the sim's readable modules
  src/main.ts          unloads a previous version, reads config.js, opens the vault, starts each enabled feature
  src/features.ts      registry: feature id → start function (typed against the catalogue)
  src/features/<id>    one feature per file or folder, named after its id in kebab-case
  src/sim/             everything that talks to the sim (screens, components, store, configurator, vault, liveries…)
  src/core/            sim-independent tools (Scope, storage, log, dom, theme, async, text fitting, virtual lists…)
  test/                node:test, pure modules only
```

The file-by-file description, the sim components used and how, and every stored key are in [mod/README.md](mod/README.md). Read it before changing a feature.

**A feature** is `export function myFeature(settings: Settings['myFeature'], scope: Scope): void | Promise<void>`, registered in `src/features.ts`, with its entry in `features.json` (id camelCase; options `boolean`, `number` with `min`/`max`/`step`/`unit`, or `choice` with `choices`; each with a `default`). It must read every option as `settings.<option>` (checked by the build). If it throws or rejects, its scope is disposed and it is listed in `window.__msfsUiRuntime.failed`. The simplest example is `src/features/time-wheel.ts`; a complete panel is `src/features/freeflight-favorites/`.

The building blocks:

| Need | Use |
|---|---|
| Run code when a screen shows | `onScreenActive(SCREENS.freeFlight, scope, (page, screenScope) => …)` (`sim/screens.ts`); `screenScope` is disposed when the screen hides. Add a screen's GUID and manipulator class to `SCREENS` and to `compat.json` "screens" |
| Undo everything | `Scope` (`core/scope.ts`): `listen`, `patch`, `add`, `child`, intervals and timeouts; every change to the sim goes through one |
| Show something | `createComponent(scope, COMPONENTS.x, parent, attributes)` (`sim/components.ts`): the sim's own component from its cooked template; `SimComponent` (`setExposedAttribute`, select, disable). New component: add it to `COMPONENTS` and to `compat.json` "components" with the attributes, states, values and children you use |
| A panel | `panel()` / `addPanelLayers()` (`core/theme.ts`): the sim's card layers and the `inputLocker` input group; CSS in the feature's `.css` (layout only), injected with `injectStyle(css, scope)` |
| A text field | `sim/text-field.ts` (the sim's `Search_Input`) |
| A scrolling list | `createRealScroll` (`sim/real-scroll.ts`, the sim's `<real-scroll direction="y">`); many tiles: a recycled pool (`sim/component-pool.ts`, `core/virtual-list.ts`), never every tile alive |
| Read or act on sim data | `store` and `watch(scope, node, cb)` (`sim/store.ts`); requests are `node.Request.request(arg)` promises; every wait is bounded (`core/async.ts`, `ANSWER_TIMEOUT_MS`) |
| The aircraft configurator | `sim/configurator.ts`, `sim/aircraft-loading.ts` (`loadAircraft`, `syncConfiguratorToCurrent`, `withAllAircraft`) |
| Persistent data | `loadData` / `saveData` / `deleteData` (`core/storage.ts`), keys `MSFS_UI_*`, JSON; validate what you read (`storedObject`): a stored value is never trusted |
| Translations | `translate('TT:…')` (`sim/localization.ts`), keys declared in `compat.json` "translations" |
| Log | `log()`, `logError()` (`core/log.ts`): one string per call, prefixed `[msfs-ui]` |
| Write a CSS variable | `setVariable()` / `setStyle()` (`core/dom.ts`): write only on change (each write of a variable re-lays out the subtree, ~90 ms under the gallery) |

Layout conventions: the sim's mock-ups are in **units** of 1/1080 of the screen height; the mod's roots define `--u` (on the sim's own elements `--u` is undefined: use `calc(var(--unscaledScreenHeight) * Npx / 1080)`). Panels are absolute, laid out in a **250 ms pass** on an anchor element (`[name="…"]`), in whole pixels, measured positions read before any write. Calculations go into **pure** modules (no DOM, no sim) with `node:test` tests.

`window.__msfsUiRuntime` exposes `version`, `build`, `settingsSource`, `settings`, `storage` (`kind`: `vault` or `datastorage`, `detail`), `started`, `failed`, `unload()`.

## 5. Contracts between the app and the mod

The user's machine has no Node: the app never compiles the mod. So:

- **Settings are read at runtime**: the app writes `config.js` (`export default { schemaVersion: 1, features: { <id>: { enabled, …options } } }`) from its `settings.json`; the mod imports it with a cache-busting query; missing or invalid → defaults compiled from the catalogue, each fix logged. Validation rules are the same on both sides (`mod/src/core/settings.ts`, `MsfsUi.Core/Features/SettingsNormalizer.cs`).
- **`mod/features.json`** is the catalogue: the build generates typed settings from it and refuses a mismatch with the code; the app builds its Features page from it. A new option *type* needs both readers changed (schema, build checks and generated types, mod validation, `MsfsUi.Core` catalogue / normaliser / `ConfigScript`, the Features page). The version is in three places checked equal by a test: `features.json` › `modVersion` (and `mod/package.json`), `generator/Directory.Build.props` › `<Version>`, `generator/MsfsUi.App/Package.appxmanifest` › `Identity` (`x.y.z.0`).
- **`mod/compat.json`** lists every sim dependency: readable exports by module, screens, components, anchors (`name="…"`), component patterns, data-model and event symbols, files, CSS variables, translation keys, and live checks (ES2017 functions run in the page with `ctx = { store, engineUi, utils, flight, aircraft }`, returning `{ ok, detail }`). **The build refuses any sim reference missing from it**: a change that adds a dependency updates it in the same change.

## 6. Hard rules

- **ES2017 only** (Coherent GT): no object spread `{...o}`, no ES2018+ APIs (`Object.fromEntries`…), **no unary operator before `await`** (`const ok = await x; if (!ok)`), **no raw U+2028 / U+2029** in sources (`String.fromCharCode`). The build refuses the last two. Tools that write files may turn `\uXXXX` escapes into raw characters: build such code points at runtime.
- **Readable sim exports only**: `/Global/engine_ui.bundle.js`, `/Global/shared/utils.js`, `/Global/shared/store.js`. Never the minified names of `lib.js` (they change with each sim version).
- **No file of Asobo** in the repository or a release; read the sim's files on the user's machine.
- **Every change to the sim is reversible**, through a `Scope`.
- **The sim's own components for everything visible** (`createComponent`), never HTML/CSS imitations. Only exceptions: the mod's own SVG icons, the heart and the slashed eye (`core/icons.ts`, `core/icon-toggle.ts`). `theme.css` keeps only what the sim draws without a component, the mod's roots and colour variables, the row tile and the icons; a feature's CSS does layout only.
- **Text too long**: no ellipsis in the engine; the sim's `marquee__trigger` class on the tile's host, or `core/text-fit.ts` to reduce the font.
- **Storage**: `core/storage.ts` → the vault (`sim/vault.ts`), the sim's `datastorage` only as the fallback when the module does not answer; **never `localStorage`** (emptied at every start). Keys `MSFS_UI_*`.
- **Never ask the sim to save its profile** (validating one of its options): it resets the user's graphics settings.
- **Never dispatch an artificial `resize` event**: it crashes a virtual list of the sim.
- **No personal data** anywhere: the author is Proxi64; paths with `%USERPROFILE%`, `%LOCALAPPDATA%` or relative to the repository; release binaries are built with mapped paths and without Source Link.
- **App (C#)**: nullable on, warnings as errors, analyzers `latest-recommended`, code style from `generator/.editorconfig`, public API of `MsfsUi.Core` documented, package versions pinned in `generator/Directory.Packages.props`. One view model per page; `x:Bind` of values with an explicit `Mode` (`OneTime` when constant; command and event bindings keep the default); texts in `Strings/en-us/Resources.resw`; no colour in XAML (theme resources); every focusable element named with a stable `AutomationId`; `SimSession.RefreshAsync` never throws except when cancelled and reads on a worker thread; package installs and removals one at a time (`PackageInstaller` lock, `SimSession.PackageOperation`); no exception thrown out of `async void` handlers.
- **UI tests** run the built app on an isolated profile (`MSFS_UI_DATA_ROOT`, `MSFS_UI_INSPECTOR_HOST`): never against the real sim, Community folder or data.
- **Vault**: change `wasm/` only when the task requires it; its protocol is tested against the mod's encoders (`wasm/test/protocol-contract.test.ts`); read [wasm/README.md](wasm/README.md) first. Never free memory in an I/O callback; a read's callback gets its number, never a pointer.

## 7. How to find out how the sim behaves

Nothing of the sim's menu is documented by Asobo. Before writing code that depends on it:

1. **Check what is already known**: [docs/sim-reference.md](docs/sim-reference.md) (files, screens and GUIDs, data model paths, events, storage, Coherent GT constraints) and section 8 below.
2. **Read the sim's files** on the user's machine, in `fs-base-ui` (path from `msfs-ui-dev status`): `html_ui\Global\*.js` (search `…Manipulator` classes, `Game.…` paths), `cookedcomps\{GUID}.html` / `.json` (`name="…"` elements, exposed attributes, visual states). Read, never copy into the repository.
3. **Read the live state** with `msfs-ui-dev eval` (`document.querySelector('[name=…]')`, `getBoundingClientRect()`, the data model through `window.__msfsUiRuntime` or the store). When you try an action, put the original state back afterwards.
4. **Write down** what you found in `docs/sim-reference.md`, with the sim version and date.

## 8. Traps of the sim's engine and menu (measured)

| Area | Finding | Answer |
|---|---|---|
| Mouse | Click and wheel reach only elements with `data-input-group`; elsewhere they go to the map or scene under the panel | `inputLocker` on every panel (`core/theme.ts`); never `pointer-events: none` on a panel (inherited) |
| Hover | An element laid over a sim component but outside its element takes the component's Hover state away | Put it inside the component's own element; `pointer-events: auto` on the clickable element, `none` on its SVG children |
| Layout | Visual states apply on the next frame; no ellipsis; computed widths rounded down; a one-line `flex-wrap` stretches its items; negative margins do not widen | Measure after a short delay; whole-pixel widths, the last item takes the rest; `align-items: flex-start` |
| Components | An optional visual state added by the mod is hidden again for good by the Disabled state; a change of visual state in the same task as a move of the element is lost | Show such an element by CSS; tell a moved component (`SimComponent.moved`) |
| Components | A component moved or removed while it sets up fails | Create it in a hidden staging area, move it once ready |
| Screens | The sim's screens animate and resize without notice | Absolute panels laid out every 250 ms on an anchor; `isOnScreen`, `isShown` (`sim/screens.ts`) |
| Variables | `--u` is undefined on the sim's elements; the mod's panels are at z-index 50 | `calc(var(--unscaledScreenHeight) * Npx / 1080)` there; a z-index above 50 for a sim element over a panel; check stacking by hit testing (`document.elementFromPoint`) |
| Stacking | A sim element whose ancestors all have a transform and `z-index: 0` stays under a mod panel whatever its z-index | Do not cover it: end the panel's box before it |
| Performance | Writing a CSS variable re-lays out the subtree even with the same value; ~110 elements per aircraft tile | Write on change only (`setVariable`); recycle tiles (pool) |
| Data | `FlightConditions` is published only after `UpdateFlightConditions.request("")`; updates may arrive out of order; an unknown data-model path fails silently (`undefined`, 0) | Request on mount; grace delay; live checks read where the data is filled |
| Start-up | The sim activates Free Flight behind the scenes, then resets the flight conditions | Apply a remembered choice only when the panel is really visible |
| Configurator | Released when leaving the aircraft selection; Free Flight puts its own aircraft back each time it opens; a request for the aircraft it already holds does nothing; on a category tab without the aircraft its lists are empty and a request makes the current aircraft invalid; it reports a variant or livery change 0.5 to 1.2 s later | `syncConfiguratorToCurrent()` before acting; `loadAircraft` (checks `CurrentAircraft`); `withAllAircraft`; `sim/configurator.ts` keeps the choice sent until a read shows it |
| Aircraft list | One entry per aircraft; some add-ons change the entry's name, variant id and `aircraftId` with the variant | Identify an aircraft by name + publisher, plus the variant groups (`sim/variant-groups.ts`); `variationId` is stable, `aircraftId` is not |
| Dropdown | The sim's `Dropdown` keeps its list's scroll position between openings | Scroll it on opening by whole items (`sim/dropdown-list.ts`) |
| Storage | `datastorage` reaches the disk only when the sim saves its profile; missing on one user's sim | The vault; never ask for a profile save |
| Vault | The sim may never call back a start-up read; a failed open looks like a missing file and is still called back on file 0 | Handled in the module and `sim/vault.ts`; read wasm/README.md before touching it |
| Console | `console.log` passes only its first argument to the inspector | One string per message (`log()`) |
| Canvas | `getImageData` is unsupported | Images cannot be analysed |

## 9. Proving a change

1. `npm run check` (mod) and, if the app or a contract changed, `dotnet build` and `dotnet test` (Core tests at least). Zero warnings, every test passing.
2. New calculations in pure modules, with tests.
3. In the sim: `msfs-ui-dev install`, `reload`, `console "[msfs-ui]"` (no error since the `module loaded` line, the build time is yours). Measure with `eval` (`getBoundingClientRect`, computed styles, classes, model values) rather than asking the user to look; alignments to the pixel.
4. Layout changes: at least 1920 × 1080, 2560 × 1440 and 3440 × 1440 (`tools/resolution-check/`, see [docs/development.md](docs/development.md#screen-resolutions)); grow the window during a session (what is remembered must be in units, not pixels).
5. The feature turned off: the menu must be exactly the sim's. `msfs-ui-dev check` when `compat.json` changed.
6. In the app: UI Automation by `AutomationId`, buttons through `InvokePattern`.
7. Then ask the user for a screenshot and their own check.

## 10. Documentation to keep up to date

| Change | Update |
|---|---|
| A feature's behaviour, an option | [docs/user-guide.md](docs/user-guide.md), [mod/README.md](mod/README.md), `CHANGELOG.md` |
| A source file added, moved or split | The source layout in [mod/README.md](mod/README.md) |
| Something learned about the sim | [docs/sim-reference.md](docs/sim-reference.md) |
| Build, tools, app structure, release | [docs/development.md](docs/development.md) |
| A rule or a trap | This file |
| [docs/build-your-own.md](docs/build-your-own.md) | Its HTML page: `node tools/docs-html/build.mjs` (never edit `docs/build-your-own.html` by hand; `--check` fails when it is out of date) |
| What comes next | [docs/next-steps.md](docs/next-steps.md) |

## 11. Index of the documentation

| Document | Content |
|---|---|
| [README.md](README.md) | Overview, screenshots, build in three lines |
| [docs/build-your-own.md](docs/build-your-own.md) | The beginner's guide to building their own version (tools, loop, recipes) |
| [docs/development.md](docs/development.md) | Build and tests, the developer tool, the package, the contracts, the vault, working method, rules, app structure, UI tests, release |
| [mod/README.md](mod/README.md) | The mod's build checks, sources file by file, the sim components it uses, stored data, start-up |
| [docs/sim-reference.md](docs/sim-reference.md) | What is known of the sim's menu |
| [docs/user-guide.md](docs/user-guide.md) | Every feature from the user's side, troubleshooting |
| [docs/feature-ideas.md](docs/feature-ideas.md) | Candidate features with what the sim offers for each |
| [docs/next-steps.md](docs/next-steps.md) | The original project's state and plan |
| [wasm/README.md](wasm/README.md) | The vault's protocol, file format, build and tests |
| `.claude/skills/msfs-wasm/` | Verified facts on the sim's WASM modules (SDK toolchain, MSFS_IO, CommBus), useful to any AI |
| `tools/msfs-sdk-mcp/` | An MCP server exposing the MSFS 2024 SDK and SimConnect (declared in `.mcp.json`) |
