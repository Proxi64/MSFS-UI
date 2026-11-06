# Build your own MSFS-UI

This guide is for anyone who wants to take the code of MSFS-UI and make it their own: change a colour or a size, add an option, fix something that bothers them, or build a whole new feature for the main menu of Microsoft Flight Simulator 2024. **You do not need to be a programmer.** An AI assistant (Claude, ChatGPT, Gemini, Copilot, Cursor, Codex, Mistral…, whichever you like) writes the code with you; this guide gives you everything around it: what to install, how the project is organised, how to build it, how to try your changes in the sim, how to talk to the AI so that it does good work, and how to share the result.

Read it once from top to bottom, then keep it at hand. Words you may not know are explained in the [glossary](#glossary) at the end.

> [!WARNING]
> MSFS-UI is a personal project, not affiliated with, endorsed by or supported by Microsoft or Asobo Studio. It relies on undocumented parts of the sim's menu that any sim update may change. Your own version carries the same risk. The good news: **no file of the sim is ever modified**. Removing the package from the Community folder always brings the original menu back.

## Contents

1. [How MSFS-UI works, in plain words](#1-how-msfs-ui-works-in-plain-words)
2. [What is in the repository](#2-what-is-in-the-repository)
3. [What you need](#3-what-you-need)
4. [Get the code](#4-get-the-code)
5. [Build it for the first time](#5-build-it-for-the-first-time)
6. [Try your version in the sim](#6-try-your-version-in-the-sim)
7. [Work with an AI](#7-work-with-an-ai)
8. [Recipes: your first changes](#8-recipes-your-first-changes)
9. [Explore the sim's menu](#9-explore-the-sims-menu)
10. [The rules the build enforces, and why](#10-the-rules-the-build-enforces-and-why)
11. [Test and check your work](#11-test-and-check-your-work)
12. [Save your work with Git](#12-save-your-work-with-git)
13. [Share your version](#13-share-your-version)
14. [After a sim update](#14-after-a-sim-update)
15. [Troubleshooting](#15-troubleshooting)
16. [Glossary](#glossary)
17. [Where to read more](#where-to-read-more)

## 1. How MSFS-UI works, in plain words

The main menu of MSFS 2024 (Free Flight, the aircraft selection, the world map…) is **a web page**. The sim shows it with a small built-in browser engine called **Coherent GT**. Like any web page, it is made of HTML elements, CSS styles and JavaScript code. This is what makes a menu mod possible: we add our own JavaScript to that page.

The sim loads add-ons from its **Community folder**. Each add-on is a **package**: a folder with a few description files and the files it adds or replaces. A package can replace a file of the sim by putting a file with the same name at the same place. MSFS-UI uses this:

```
                 your PC
 ┌─────────────────────────────────────────────────────────────┐
 │  MSFS-UI-GENERATOR (the Windows app)                        │
 │   1. reads the sim's own menu root page (the "MasterPage")  │
 │   2. makes a copy and adds one line to it: "load our mod"   │
 │   3. writes the package msfs-ui into the Community folder:  │
 │        the modified copy of the MasterPage                  │
 │        main.js    = the mod itself (all our features)       │
 │        config.js  = your settings (which features, options) │
 │        msfs-ui.wasm = the "vault" that saves your data      │
 └─────────────────────────────────────────────────────────────┘
                          │  the sim starts
                          ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  MSFS 2024 main menu (a web page in Coherent GT)            │
 │   the copied MasterPage loads main.js                       │
 │   main.js reads config.js, then starts each feature:        │
 │   weather bar, aircraft gallery, favourites, …              │
 └─────────────────────────────────────────────────────────────┘
```

A few important ideas:

- **The repository never contains a file of the sim.** The copy of the MasterPage is made on each user's machine, from their own sim. This respects Asobo's files and keeps the mod working when the sim's menu changes a little.
- **The mod works on the sim's real objects.** It imports the sim's own JavaScript modules, so it sees the same data (the current aircraft, the weather, the time) and can ask the sim to do things (load an aircraft, change the time).
- **Everything the mod shows is made of the sim's own components** (its buttons, tiles, dropdowns, scroll lists). That is why the mod looks like part of the sim.
- **Everything the mod changes can be undone.** The mod can be reloaded while the sim runs (a "hot reload"), and it cleans up after itself first.
- **Two programs, two languages.** The mod is written in **TypeScript** (JavaScript with types), turned into one file, `main.js`. The app is written in **C#** (.NET, WinUI 3). A third, tiny piece, the vault, is written in **C++** and compiled to **WebAssembly** (a `.wasm` file the sim runs).
- **The app and the mod agree through two files**: `mod/features.json` (the list of features and their options: the app builds its Features page from it) and `mod/compat.json` (everything the mod needs from the sim: the app checks it on its Compatibility page).

Most changes you will want to make are in the mod (`mod/`). You rarely need to touch the app, and almost never the vault.

## 2. What is in the repository

```
MSFS-UI/
├─ mod/                  THE MENU MOD (TypeScript): this is where most of your changes go
│  ├─ features.json      the catalogue: every feature, its title, description and options
│  ├─ compat.json        everything the mod uses from the sim (checked by the app)
│  ├─ src/
│  │  ├─ main.ts         entry point: reads the settings, starts the features
│  │  ├─ features.ts     the list of features (id → code that starts it)
│  │  ├─ features/       one folder or file per feature (see the table below)
│  │  ├─ sim/            how to talk to the sim: screens, components, aircraft, data…
│  │  └─ core/           tools that do not depend on the sim: Scope, storage, log, theme…
│  ├─ test/              automatic tests of the mod
│  ├─ build/             the build script and its checks
│  └─ dist/main.js       the built mod (created by the build, not in Git)
├─ generator/            THE WINDOWS APP MSFS-UI-GENERATOR (C#, .NET 10, WinUI 3)
│  ├─ MsfsUi.App/        the app's windows and pages
│  ├─ MsfsUi.Core/       finding the sim, building and installing the package, checks
│  ├─ MsfsUi.DevTool/    msfs-ui-dev, a command-line tool for developers (very useful)
│  └─ …Tests/            automatic tests of the app
├─ wasm/                 THE VAULT (C++ → WebAssembly): saves the mod's data in files
├─ docs/                 the documentation (you are reading it)
├─ tools/                helper scripts (screen resolution checks, the app's icon, an MCP server)
├─ build-release.ps1     builds a release: the app folder and its zip
├─ AGENTS.md             instructions for an AI working on this project
└─ CLAUDE.md             the original author's own instructions for Claude Code (project history)
```

The features, and where their code is:

| Feature (in the app) | Screen | Code |
|---|---|---|
| Fast menus | All menus | `mod/src/features/fast-menus/` |
| Weather and time bar | Free Flight | `mod/src/features/weather-bar/` |
| Mouse wheel on the time | Free Flight | `mod/src/features/time-wheel.ts` (the simplest one: start here) |
| Tail number per livery | Aircraft selection | `mod/src/features/tail-number.ts` |
| Setup panel | Aircraft selection | `mod/src/features/aircraft-setup/` |
| Aircraft gallery and list | Aircraft selection | `mod/src/features/aircraft-gallery/` |
| Free Flight favourites | Free Flight | `mod/src/features/freeflight-favorites/` |
| Free Flight on wide screens | Free Flight | `mod/src/features/freeflight-layout/` |

Inside a feature's folder, files ending in `.css` hold its layout (sizes, positions), `index.ts` starts it, and files whose header comment says "pure" hold calculations without any contact with the sim (they are the ones with tests).

## 3. What you need

**To change the mod and try it in the sim** (the usual case):

| Tool | Why | How to get it |
|---|---|---|
| Windows 10 or 11 (64-bit) and MSFS 2024 | To run the sim and the app | — |
| **Git** | To download the code and keep the history of your changes | `winget install Git.Git` or [git-scm.com](https://git-scm.com) |
| **Node.js 22.18 or later** | To build the mod (TypeScript → `main.js`) and run its tests | `winget install OpenJS.NodeJS.LTS` or [nodejs.org](https://nodejs.org) (take the LTS version) |
| **.NET 10 SDK** | To build the app and the developer tool | `winget install Microsoft.DotNet.SDK.10` or [dot.net](https://dot.net) |
| **PowerShell 7** | The project's scripts need it (`pwsh`) | `winget install Microsoft.PowerShell` |
| **A code editor** | To read and change the files | [Visual Studio Code](https://code.visualstudio.com) (`winget install Microsoft.VisualStudioCode`), or the editor of your AI tool (Cursor, Windsurf…) |
| **An AI assistant** | To write the code with you | See [7. Work with an AI](#7-work-with-an-ai) |

To type the `winget` commands: open the **Terminal** app (or PowerShell) from the Start menu, paste the command, press Enter. Close and reopen the terminal after installing, so that it finds the new tools. To check:

```powershell
git --version        # git version 2.x
node --version       # v22.18.0 or higher
dotnet --version     # 10.x
pwsh --version       # PowerShell 7.x
```

**Only for some tasks:**

| Tool | When you need it |
|---|---|
| **MSFS 2024 SDK** | To build the vault module (`wasm/`) yourself. Not needed if you take the module from an installed release (see [step 5.2](#52-the-vault-module)). The SDK is offered by the sim in Developer Mode and on the official SDK site ([docs.flightsimulator.com](https://docs.flightsimulator.com)); its installer sets the `MSFS2024_SDK` variable (set it yourself to the SDK folder if it does not) |
| **Visual Studio 2022 or later with "Desktop development with C++"** | Only to build a release (`build-release.ps1`): the small launcher exe is compiled with it. The free Community edition is enough |
| **WinApp CLI 0.7+ and Windows Developer Mode** | Only for `winapp run` (starting the app from the command line in its development identity). Running the built `.exe` directly works without it |

## 4. Get the code

**Option A, recommended: your own copy on GitHub (a "fork").** You keep your changes online, you can share them, and you can still take later improvements from the original.

1. Create a free account on [github.com](https://github.com).
2. Open [github.com/Proxi64/MSFS-UI](https://github.com/Proxi64/MSFS-UI) and click **Fork**. You now have `github.com/<you>/MSFS-UI`.
3. On your PC, in a terminal, go to the folder where you keep projects and download your fork:

   ```powershell
   cd $env:USERPROFILE\Documents
   git clone https://github.com/<you>/MSFS-UI.git
   cd MSFS-UI
   ```

4. Tell Git who you are (shown in your commits; use a nickname if you prefer):

   ```powershell
   git config user.name "YourNickname"
   git config user.email "you@example.com"
   ```

**Option B: without GitHub.** On the project's GitHub page, **Code › Download ZIP**, unzip it, then in that folder run `git init`, `git add .`, `git commit -m "Start"` so that you can still go back in time.

Open the folder in your editor (in VS Code: **File › Open Folder…**). Every command of this guide runs in a terminal **at the root of that folder** (where `README.md` is), unless it says otherwise.

## 5. Build it for the first time

Do this once before changing anything: if something fails here, it is your setup, not your change.

### 5.1 The mod

```powershell
cd mod
npm ci              # downloads the build tools (esbuild, TypeScript…) into mod/node_modules, once
npm run check       # checks, builds mod/dist/main.js, runs the tests
cd ..
```

`npm run check` must end without an error and with the tests passing (a summary such as `ℹ pass 454`, `ℹ fail 0`). It does a lot at once: it validates `features.json` and `compat.json`, checks the rules of [section 10](#10-the-rules-the-build-enforces-and-why), compiles the TypeScript, bundles everything into `mod/dist/main.js`, and runs the tests. **Run it after every change to the mod.**

### 5.2 The vault module

The app contains the vault module `wasm/dist/msfs-ui.wasm`, and refuses to build without it. Two ways to get it:

- **Without the SDK (simplest):** install the official MSFS-UI release once ([the GitHub releases](https://github.com/Proxi64/MSFS-UI/releases), or flightsim.to), click **Generate & install** in its app, then copy the module it installed:

  ```powershell
  New-Item -ItemType Directory -Force wasm\dist
  Copy-Item "<your Community folder>\msfs-ui\modules\msfs-ui.wasm" wasm\dist\
  ```

  (The app's Home page shows where your Community folder is.) This is fine as long as you do not change the vault itself.

- **With the MSFS 2024 SDK:** `pwsh -File wasm/build.ps1` builds it, checks it and runs its tests.

### 5.3 The app and the developer tool

```powershell
dotnet build generator/MsfsUi.slnx
dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"
```

The build treats every warning as an error: it must end with `0 Warning(s)` and `0 Error(s)`. The tests must pass. (Without the filter, the tests also open the app's windows for about 20 seconds: do not touch the mouse meanwhile.)

You now have:

- the app: `generator\MsfsUi.App\bin\Debug\net10.0-windows10.0.26100.0\win-x64\MSFS-UI-GENERATOR.exe`;
- the developer tool: `generator\MsfsUi.DevTool\bin\Debug\net10.0-windows\msfs-ui-dev.exe`.

**Important:** the app carries a copy of `mod/dist/main.js` inside its exe, taken when it was built. After a change to the mod, either rebuild the app (`dotnet build`) before using its **Generate & install**, or use the developer tool, which always takes the latest `mod/dist/main.js` (next section).

## 6. Try your version in the sim

Your version installs as the same `msfs-ui` package as the official one: it **replaces** it in the Community folder (your favourites and other data in the vault are kept). Only one menu mod can replace the MasterPage at a time: if another menu mod is installed, the installer refuses and names it.

### 6.1 The developer tool, `msfs-ui-dev`

It does from the command line what the app does, plus what a developer needs. To save typing, keep its path in a variable (in each new terminal):

```powershell
$dev = "generator\MsfsUi.DevTool\bin\Debug\net10.0-windows\msfs-ui-dev.exe"
& $dev status          # sim found? package installed? another menu mod in the way? sim running?
```

| Command | What it does |
|---|---|
| `& $dev install` | Builds the package from `mod/dist/main.js`, your settings and the vault module, and installs it in Community |
| `& $dev install --settings my-settings.json` | The same with a settings file of your own (format in [mod/README.md](../mod/README.md#commands)); without it, the app's settings, or the defaults |
| `& $dev reload` | Reloads the mod in the running sim: your change shows in a second, no restart |
| `& $dev console "[msfs-ui]"` | Shows the mod's messages from the sim's console (errors included) |
| `& $dev eval "<JavaScript>"` | Runs JavaScript in the sim's menu page and prints the result |
| `& $dev check` | The compatibility check: does the sim still offer everything the mod needs? (`--detail` for every line) |
| `& $dev remove` | Removes the package: the original menu comes back at the next start |

The tool talks to the running sim through the Coherent GT inspector that the sim opens on your PC (`127.0.0.1:19999`); `reload`, `console`, `eval` and the live part of `check` need the sim running, with its main menu loaded.

### 6.2 The development loop

The first time:

1. Close the sim.
2. `& $dev install`
3. Start the sim. (It reads a new package, and the MasterPage, only at start-up.)

Then, for each change, **with the sim running**:

```powershell
cd mod; npm run check; cd ..      # build and test the mod
& $dev install                    # put the new main.js in the package
& $dev reload                     # reload it in the sim
& $dev console "[msfs-ui]"        # read what it says
```

The change is live within a second or two. A restart of the sim is needed again only when a **new file** is added to the package (the installer says so) or after a sim update.

The first line the mod writes is `[msfs-ui] module loaded (version …, build …)`: if you see it with the time of your build, the sim runs your version. Errors are written `[msfs-ui] … failed: …`.

### 6.3 If the menu breaks

It will happen, and it is harmless. In order:

1. `& $dev console "[msfs-ui]"`: the error usually names the problem. Give it to your AI.
2. Go back to your last working version (`git stash`, see [section 12](#12-save-your-work-with-git)), `npm run check`, `install`, `reload`.
3. If the menu does not answer at all: close the sim, `& $dev remove`, start the sim. The original menu is back.

## 7. Work with an AI

### 7.1 Which kind of AI

| Kind | Examples | How well it fits |
|---|---|---|
| **An agent with access to your files and terminal** | Claude Code, OpenAI Codex, GitHub Copilot (agent mode), Cursor, Windsurf, Gemini CLI, Cline… | **Best.** It reads the project, changes the files, runs `npm run check` and `msfs-ui-dev` itself, and fixes its own errors. Many of these read `AGENTS.md` (or `CLAUDE.md` for Claude Code) at the root automatically |
| **A chat in the browser** | ChatGPT, Claude.ai, Gemini, Le Chat, Copilot chat… | Works, with more effort: you paste the files it needs and copy its changes back. Fine for small changes |

Whichever you use, the AI does not know this project. **The file [`AGENTS.md`](../AGENTS.md) at the root of the repository is written for it**: what the project is, its architecture, its rules, its commands, the traps of the sim's engine, and how to check a change. Always make the AI read it first.

### 7.2 The first message

With an agent (it can read files):

```text
Read AGENTS.md at the root of this repository, then docs/development.md and mod/README.md.
Do not change anything yet. Tell me in a few lines what this project is, how a feature is
organised, and which commands you will run to check a change.
```

With a chat (it cannot read files): paste the whole content of `AGENTS.md` first, then:

```text
That is the instruction file of the project I am working on. I will paste the files you need.
Do not invent the content of a file I have not pasted: ask me for it.
```

### 7.3 Asking for a change

The method that works:

1. **One small change at a time.** "Make the favourites' rows a bit taller", not "redesign Free Flight".
2. **Say what you see and what you want**, with the screen and a screenshot if your AI accepts images: "On Free Flight, the Favorites rows are too close to each other. I want twice the space between them."
3. **Ask for a plan first**: "Before coding, tell me which files you will change and how." Read it; ask questions if anything is unclear. This avoids long detours.
4. **Let it build and test**: the agent runs `npm run check`; with a chat, you run it and paste the full error back.
5. **Try it in the sim** (`install`, `reload`) and **tell the AI what you see**, with the mod's console lines (`& $dev console "[msfs-ui]"`).
6. **When it works, save it** with a Git commit ([section 12](#12-save-your-work-with-git)). Then the next change.

Useful phrases:

- "Explain this file to me as to a beginner: `mod/src/features/time-wheel.ts`."
- "Where is the code that draws X? Show me the file and the lines."
- "This error came from `npm run check`: … Fix it without disabling the check."
- "Use `msfs-ui-dev eval` to read the real size of this element in the sim before changing the CSS."
- "Check that this change respects the rules of AGENTS.md (sim components, Scope, compat.json, ES2017)."
- "Undo your last change." (or `git checkout -- .` yourself)

### 7.4 With a chat: which files to paste

| You want to… | Paste |
|---|---|
| Change a feature's look | Its `.css` file, and the `.ts` file that creates the elements (its `panel.ts` or `index.ts`) |
| Change what a feature does | Its folder's `index.ts` and the file the AI asks for |
| Add or change an option | `mod/features.json` (the feature's entry) and the feature's `index.ts` (or its single `.ts` file) |
| Add a feature | `mod/features.json` (one entry as an example), `mod/src/features.ts`, `mod/src/features/time-wheel.ts` (as a model) |
| Use something of the sim | `mod/compat.json` and `docs/sim-reference.md` |
| An error | The full output of `npm run check`, or the console lines |

Paste each file with its path on the line above, between three backticks.

### 7.5 What to watch in the AI's answers

AIs know the web very well, which is a trap here: the sim's engine is **not** a modern browser. The build catches most mistakes, but check that the AI:

- **does not write modern JavaScript the engine refuses** (`{...object}` spread of objects, `Object.fromEntries`, `!await x`): the build refuses some, others fail only in the sim;
- **uses the sim's own components** (`createComponent` in `mod/src/sim/components.ts`) rather than drawing its own buttons, lists or text fields in HTML and CSS;
- **registers every change to the sim in a `Scope`** (`scope.listen`, `scope.patch`, `scope.add`…), so that the hot reload undoes it;
- **declares in `compat.json`** every new thing it uses from the sim (a component GUID, a `name="…"`, a `TT:` translation key, a CSS variable `--color…`);
- **stores data through `core/storage.ts`** with a key starting `MSFS_UI_`, never `localStorage` (emptied at every start);
- **does not disable a check, a test or a warning** to make the build pass;
- **does not claim it works** before you have seen it in the sim.

If the AI goes round in circles on a bug, stop it: ask it to list what it knows for sure, what it supposes, and to measure in the sim (`eval`) before changing more code. Or start a new conversation with a short summary: a fresh start often helps.

## 8. Recipes: your first changes

Each recipe is a real change you can make in a few minutes, with or without an AI. Make them in order the first time: they teach you the whole loop.

### 8.1 Change an option's default value

The mouse wheel on Free Flight's time moves it by 60 seconds per notch by default. Make it 5 minutes.

1. Open `mod/features.json`, find `"id": "timeWheel"`, then its option `"id": "step"`, and change `"default": 60` to `"default": 300` (it must be within `min` and `max`, on the `step` grid).
2. The app and the mod share test files made from this catalogue. Regenerate them, then build:

   ```powershell
   $env:MSFS_UI_UPDATE_FIXTURES = "1"; dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"; Remove-Item Env:MSFS_UI_UPDATE_FIXTURES
   cd mod; npm run check; cd ..
   dotnet build generator/MsfsUi.slnx
   ```

3. `& $dev install` (without `--settings`, it uses your saved settings if the app has some, otherwise the new default), `& $dev reload`. On Free Flight, turn the wheel over the time.

A default only applies to users who have not saved that option yet; to try any value at once, change it on the app's Features page instead.

### 8.2 Change a look (CSS)

Each feature's layout is in its `.css` file. Sizes are written in **units** of the sim's mock-ups: `calc(var(--u) * 6)` means 6 units, where one unit is 1/1080 of the screen's height (so the layout looks the same at every resolution).

Example: more space between the Free Flight favourites. In `mod/src/features/freeflight-favorites/freeflight-favorites.css`:

```css
.msfs-ui-fav__row { position: relative; width: 100%; height: calc(var(--u) * 77); margin-bottom: calc(var(--u) * 6); }
```

Change `* 6` to `* 12` in `margin-bottom`, then build, install, reload.

**Read the comment above a rule before changing it.** Many sizes are also used by the TypeScript code (here, the comment says "the heights match panel.ts"): change one without the other and rows get cut. Ask your AI: "Is this value also used in the TypeScript code? Change both."

### 8.3 Add an option to a feature

Add a **Reverse** switch to the mouse wheel on the time (wheel up = earlier).

1. In `mod/features.json`, in `timeWheel`'s `"options"`, after `fastStep`, add:

   ```json
   {
     "id": "reverse",
     "type": "boolean",
     "title": "Reverse",
     "description": "Wheel up moves the time earlier, wheel down later.",
     "default": false
   }
   ```

2. In `mod/src/features/time-wheel.ts`, the line that computes the direction becomes:

   ```ts
   const direction = (event.deltaY < 0 ? 1 : -1) * (settings.reverse ? -1 : 1);
   const delta = direction * (event.shiftKey ? settings.fastStep : settings.step);
   ```

   The type of `settings` is generated from `features.json`: `settings.reverse` exists and is a boolean as soon as the catalogue has it. If you add an option and forget to read it, the build refuses: every option must be used.

3. Regenerate the shared test files, build and try, as in 8.1. Rebuild the app (`dotnet build`) and open it: the Features page shows the new switch by itself, built from `features.json`.

Option types: `boolean` (a switch), `number` (with `min`, `max`, `step` and an optional `unit`), `choice` (radio buttons: a list of `choices`, each with an `id`, a `title` and an optional `description`). The full schema is `mod/schema/features.schema.json`.

### 8.4 Add a new feature

A minimal feature that writes in the log each time Free Flight opens, and optionally when it closes. Once it works, you have the skeleton of any feature.

1. **The catalogue**, `mod/features.json`, at the end of `"features"` (the id is in camelCase):

   ```json
   {
     "id": "helloFreeFlight",
     "title": "Hello Free Flight",
     "description": "Writes in the mod's log when Free Flight opens.",
     "screen": "Free Flight",
     "enabledByDefault": true,
     "options": [
       {
         "id": "logClose",
         "type": "boolean",
         "title": "Also when it closes",
         "description": "Also writes a line when Free Flight closes.",
         "default": true
       }
     ]
   }
   ```

2. **The code**, a new file `mod/src/features/hello-free-flight.ts` (the file name is the id in kebab-case; a feature with several files gets a folder of that name with an `index.ts`):

   ```ts
   // Writes in the mod's log when Free Flight opens, and when it closes with the option logClose.

   import { log } from '../core/log.ts';
   import type { Scope } from '../core/scope.ts';
   import type { Settings } from '../generated/catalog.ts';
   import { onScreenActive, SCREENS } from '../sim/screens.ts';

   export function helloFreeFlight(settings: Settings['helloFreeFlight'], scope: Scope): void {
     const hooked = onScreenActive(SCREENS.freeFlight, scope, (page, screen) => {
       log(`Free Flight opened (${Math.round(page.elt.getBoundingClientRect().width)} px wide)`);
       // `screen` is a Scope disposed when Free Flight closes: what is added to it runs then.
       if (settings.logClose) screen.add(() => log('Free Flight closed'));
     });
     if (!hooked) throw new Error('the Free Flight screen is missing');
   }
   ```

3. **The registry**, `mod/src/features.ts`: add `import { helloFreeFlight } from './features/hello-free-flight.ts';` with the other imports, and `helloFreeFlight,` in the `FEATURES` list. (Forget it and the build says `Property 'helloFreeFlight' is missing in type … 'FeatureRegistry'`.)
4. Regenerate the shared test files, build, install, reload, as in 8.1. Open and close Free Flight, then `& $dev console "[msfs-ui]"`.

From there, a real feature creates the sim's components on the screen (`createComponent`, see `mod/src/sim/components.ts` and how `freeflight-favorites/panel.ts` does it), places them (CSS in units, layout passes every 250 ms on an anchor element), reads the sim's data (`store` and `watch`, `mod/src/sim/store.ts`) and keeps its data (`loadData` / `saveData`, `mod/src/core/storage.ts`). Ask your AI to study an existing feature close to your idea first, and to follow its patterns. Ideas, with what the sim offers for each: [docs/feature-ideas.md](feature-ideas.md).

### 8.5 Change the app

The app is a standard WinUI 3 app (C#, MVVM): pages in `generator/MsfsUi.App/Pages/`, their logic in `ViewModels/`, their texts in `Strings/en-us/Resources.resw`, the real work in `MsfsUi.Core`. Its build is strict (warnings are errors, code style enforced): let your AI run `dotnet build` and fix every message. Its rules are in [docs/development.md, The app's structure](development.md#the-apps-structure). You rarely need it: a new option of the mod appears in the app by itself.

## 9. Explore the sim's menu

To change something of the sim (move a block, read a value), you first need to know how the sim builds it. The sim's menu files are on your PC, in its `fs-base-ui` package (the app's Home page shows the path):

- `html_ui\Global\*.js`: the menu's JavaScript (large files; search them with your editor's search);
- `cookedcomps\{GUID}.html` and `.json`: the sim's components (one file per component: its elements, each with a `name="…"`, and its visual states).

**Read them, never copy them into the project.** And the running menu can be explored with `eval`:

```powershell
& $dev eval "document.querySelector('[name=FreeFlight_AircraftButton]').getBoundingClientRect()"
& $dev eval "window.__msfsUiRuntime.settings"           # the settings the mod runs with
& $dev eval "window.__msfsUiRuntime.storage.kind"       # vault or datastorage
& $dev eval "Array.from(document.querySelectorAll('[name]')).slice(0, 50).map(e => e.getAttribute('name')).join(', ')"
```

What the project already found is written down, so neither you nor the AI needs to find it again: [docs/sim-reference.md](sim-reference.md) (screens, data model, events, the engine's limits) and the "traps" table of [AGENTS.md](../AGENTS.md). Tell your AI: "Look in docs/sim-reference.md before exploring."

When you find something new about the sim, note it in `docs/sim-reference.md`: it is the project's memory.

## 10. The rules the build enforces, and why

`npm run check` stops with an explanation when one of these rules is broken. Do not ask the AI to remove the check: fix the cause.

| Rule | Why |
|---|---|
| Every feature of `features.json` has its code (`src/features/<id-in-kebab-case>`), registered in `src/features.ts`, which reads every one of its options | The app shows what the catalogue lists: an option that does nothing would lie to the user |
| Every reference to the sim is declared in `compat.json`: component and screen GUIDs, `name="…"` anchors, `TT:` translation keys, `/Global/…` imports, `coui://` files, the sim's CSS variables | After a sim update, the Compatibility page checks them all and tells which feature may break |
| JavaScript ES2017 only; no operator before `await` (`!await x`) | The sim's engine is an old WebKit: newer syntax stops the whole mod from loading |
| No raw U+2028 / U+2029 characters (invisible line separators) in the sources | The engine refuses them in strings; build them with `String.fromCharCode` |
| Strict TypeScript | Type errors are caught before the sim |
| Imports from the sim only from `/Global/engine_ui.bundle.js`, `/Global/shared/utils.js`, `/Global/shared/store.js`, by readable names | The other files' names are minified and change with each sim update |

And the rules no tool checks, which the project keeps all the same:

- **The sim's own components** for everything visible. Exceptions: the mod's two icons (heart, slashed eye), drawn in SVG.
- **Every change to the sim through a `Scope`** (listeners, patches, timers, added elements): the hot reload and closing a screen undo it.
- **Data through `core/storage.ts`**, keys starting with `MSFS_UI_`: it goes to the vault (files that survive a restart), or to the sim's `datastorage` when the vault does not answer. Never `localStorage`.
- **No file of Asobo** in the repository or in a release.
- **Everything in English** in the code, its comments, the messages and the documentation (the sim's own texts come from its translation keys, `translate('TT:…')`, so they follow the sim's language).
- **No personal data**: no real name, no path to your user folder (`C:\Users\YourName\…`) in the files; write `%USERPROFILE%` or a path relative to the repository.

## 11. Test and check your work

- **Automatic tests.** `npm run check` runs the mod's tests (`mod/test/*.test.ts`); `dotnet test generator/MsfsUi.slnx` runs the app's. When you or the AI write a calculation (a size, an order, a filter), put it in a "pure" function (no contact with the sim) and ask the AI for a test of it: it is the cheapest way to keep it right.
- **In the sim, by measuring.** Looking is not enough to know that two blocks are aligned: ask the AI to measure with `eval` and `getBoundingClientRect()` (positions in pixels), and compare.
- **At several resolutions.** The layout depends on the screen's shape. With the sim in windowed mode, `tools/resolution-check/` sets its size and takes screenshots ([docs/development.md, Screen resolutions](development.md#screen-resolutions)). At least: 1920 × 1080, 2560 × 1440, and a wide screen (3440 × 1440) if your change touches Free Flight.
- **The compatibility check.** `& $dev check` after adding something of the sim to `compat.json`.
- **Your settings.** Turn your feature off in the app (Features page, **Apply**): the menu must be exactly the original one. Turn it on again: no error in the console.

## 12. Save your work with Git

Git keeps every version of your work. Save (commit) each time something works; you can always go back.

```powershell
git status                          # what changed since the last commit
git diff                            # the changes, line by line
git add -A                          # take every change
git commit -m "Free Flight favourites: twice the space between rows"
git log --oneline                   # the history
```

| You want to… | Command |
|---|---|
| Throw away all changes since the last commit | `git checkout -- .` (and `git clean -fd` for new files: careful, they are deleted) |
| Put your changes aside, then take them back | `git stash`, then `git stash pop` |
| Try something big without risk | `git switch -c my-idea` (a new branch); back with `git switch main` |
| Send your commits to your fork on GitHub | `git push` |
| Take the original project's latest changes | Once: `git remote add upstream https://github.com/Proxi64/MSFS-UI.git`; then `git fetch upstream` and `git merge upstream/main` (your AI can help with conflicts) |

Write commit messages in English, saying what changed for the user. Many AI agents can commit for you: ask them to show you the message first.

## 13. Share your version

You may share your version freely: MSFS-UI is under the **MIT License** ([LICENSE](../LICENSE)). The only obligation: **keep the licence file and its copyright line** ("© 2026 Proxi64") in your copy and in what you distribute. You can add your own line for your changes.

Good practice:

- **Say clearly that it is a modified version**, and by whom, in its README and its description (for example "based on MSFS-UI by Proxi64"), so that users know whom to ask for help.
- **Keep the disclaimer**: not affiliated with Microsoft or Asobo, use at your own risk.
- **Users can install only one menu mod at a time** (the official MSFS-UI or yours): both replace the same page, and the app refuses a second one. Tell your users to remove the other one first.
- **Never include a file of the sim**, and nothing personal (the release script checks that no file contains the path of your user folder).

To build a release (the app's folder and a zip, as the official one):

```powershell
pwsh -File build-release.ps1        # needs Visual Studio's C++ tools; -SkipUiTests to skip the UI tests
```

It builds the mod and the app in Release, runs every test, publishes the app to `release\MSFS-UI-GENERATOR\` (a folder that runs on any Windows 10 1809+ x64 PC, nothing to install) and zips it. Before, set the version in three places, which a test checks are equal: `modVersion` in `mod/features.json` (and `version` in `mod/package.json`), `<Version>` in `generator/Directory.Build.props`, and the `Identity` version (`x.y.z.0`) in `generator/MsfsUi.App/Package.appxmanifest`. Describe your changes in `CHANGELOG.md`.

To publish: on your fork's GitHub page, **Releases › Draft a new release**, a tag such as `v1.0.0-yourname`, the notes, and the zip attached. Or on flightsim.to.

## 14. After a sim update

A sim update can move or rename what the mod uses. Then:

1. Start the sim, then `& $dev check --detail` (or the app's **Compatibility** page). The lines in error tell what disappeared and which feature is affected.
2. Give that output to your AI with `mod/compat.json` and the code of the affected feature: "The sim was updated; these checks fail. Find in the sim's files (`fs-base-ui`) what replaced them."
3. Fix, update `compat.json`, build, check again.

The app also says *Installed, update needed* on Home after a sim update: **Generate & install** makes the copy of the new MasterPage.

## 15. Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| `npm` or `node` "is not recognized" | Node.js not installed, or the terminal was open before | Install Node.js, close and reopen the terminal |
| `npm run check`: an error naming `compat.json` | The code uses something of the sim that is not declared | Add it to the right list of `mod/compat.json` (look at how a similar one is declared) |
| `npm run check`: `option "…" of features.json is never read` | An option of `features.json` is not used by its feature | Read it as `settings.<option>` in the feature's code, or remove it |
| `npm run check`: an error about `await` or U+2028 | Syntax the sim's engine refuses | See [section 10](#10-the-rules-the-build-enforces-and-why) |
| `dotnet build`: "mod\dist\main.js is missing" | The mod was not built | `cd mod; npm run check` |
| `dotnet build`: "wasm\dist\msfs-ui.wasm is missing" | The vault module is missing | [Step 5.2](#52-the-vault-module) |
| `dotnet test`: a contract test fails after a change of `features.json` | The shared test files are old | Run the tests with `MSFS_UI_UPDATE_FIXTURES=1` ([recipe 8.1](#81-change-an-options-default-value)), then `npm run check` |
| `msfs-ui-dev reload` / `console` / `eval` cannot connect | The sim is not running, or its main menu is not loaded yet | Wait for the main menu; check `& $dev status` |
| Your change does not show in the sim | `install` forgotten, the old `main.js`, or the app's Generate & install with an app built before the change | `npm run check`, `& $dev install`, `& $dev reload`; check the build time in the first console line |
| "restart needed" after `install` | A new file in the package, or a first install | Restart the sim |
| The menu is broken or empty | An error in the mod | [6.3](#63-if-the-menu-breaks); `& $dev remove` always brings the original menu back |
| Clicks go through your panel to the map | The panel has no input lock | The mod's panels use `inputLocker` (`core/theme.ts`): build yours like the existing ones |
| The installer refuses: another mod replaces the same page | Another menu mod is in Community | Remove it from the Community folder |
| Your favourites are gone after installing your version | They are in the vault, which your version reads like the original: they should not be. If the Compatibility page says *datastorage*, the vault module did not answer | Restart the sim once after installing; check `wasm\dist\msfs-ui.wasm` was there when you installed |

## Glossary

| Word | Meaning |
|---|---|
| **Anchor** | An element of the sim's page found by its `name="…"` attribute, used by the mod to place its blocks |
| **Build** | Turning the source code into what runs: `npm run check` for the mod, `dotnet build` for the app |
| **Coherent GT** | The browser engine that shows the sim's menus; an old WebKit with limits (section 10) |
| **Commit** | A saved version of your work in Git |
| **Community folder** | The sim's folder for add-on packages |
| **Component** | A ready-made element of the sim's menu (a tile, a button, a dropdown), identified by a GUID |
| **`compat.json`** | The list of everything the mod uses from the sim, checked by the app |
| **`config.js`** | The user's settings, written by the app next to the mod in the package |
| **`datastorage`** | The sim's own storage for menus; the mod's fallback when the vault does not answer |
| **`features.json`** | The catalogue of the mod's features and their options, shared by the mod and the app |
| **Fork** | Your own copy of a project on GitHub |
| **GUID** | A long identifier such as `{3C7A4EC5-E7F6-4761-B27F-A0EA89C0F081}` (here, the Free Flight screen) |
| **Hot reload** | Reloading the mod in the running sim, without a restart (`msfs-ui-dev reload`) |
| **Inspector** | The connection the sim opens on your PC (port 19999) to look inside its pages; used by the app and `msfs-ui-dev` |
| **Manipulator** | The JavaScript object behind a sim component or screen (its behaviour) |
| **MasterPage** | The root component of the sim's menu; the package replaces it with a copy that loads the mod |
| **`msfs-ui-dev`** | The developer's command-line tool (`generator/MsfsUi.DevTool`) |
| **Package** | A folder in Community that the sim loads (here `msfs-ui`) |
| **Pure function** | Code that only computes, without touching the sim: easy to test |
| **Scope** | The mod's tool that records every change it makes to the sim, to undo them all at once |
| **TypeScript** | JavaScript with types; the mod's language, compiled to `main.js` |
| **Unit (`--u`)** | 1/1080 of the screen's height: the sim's mock-ups are drawn in these units |
| **Vault** | The mod's WebAssembly module that writes its data (favourites, tail numbers…) to files |
| **WASM / WebAssembly** | Compiled code the sim runs safely; the vault is one |
| **WinUI 3** | The Windows framework of the app's windows |

## Where to read more

| Document | What you find there |
|---|---|
| [AGENTS.md](../AGENTS.md) | The instructions for an AI: architecture, rules, commands, traps |
| [User guide](user-guide.md) | What every feature does, from the user's side |
| [Development](development.md) | The build, the developer tool, how the package works, the contracts, the release, the app's structure |
| [Mod README](../mod/README.md) | The mod's sources file by file, the sim's components it uses, its stored data |
| [Sim reference](sim-reference.md) | What is known of the sim's menu: files, screens, data, events, the engine's limits |
| [Feature ideas](feature-ideas.md) | Features that could come next, with what the sim offers for each |
| [Next steps](next-steps.md) | Where the original project stands |
| [wasm/README.md](../wasm/README.md) | The vault's protocol and file format |
