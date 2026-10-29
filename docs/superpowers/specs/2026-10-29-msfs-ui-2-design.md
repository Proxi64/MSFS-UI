# MSFS-UI 2.0: design

Approved by the owner on 2026-10-29 (brainstorming, then plan approval). Step A and step 0 are done (docs/next-steps.md, the skill `msfs-wasm`); step 1 is planned in `docs/superpowers/plans/2026-10-29-wasm-vault.md`.

## Title

A WASM vault for the mod's data, then an app connected to the sim

## Context

MSFS-UI 1.x (mod `msfs-ui` + app MSFS-UI-GENERATOR, 1.3.1) keeps the mod's data (favourite liveries, tail numbers, last uses, last weather choices) in the sim's `datastorage`. That store is fragile: the sim writes it to the disk only when it saves its profile (1.8 works around it by re-validating an option), and on a Microsoft Store user's sim it is missing altogether (next-steps 1.5). The owner wants a fork towards a more professional version, with WASM.

What the owner said (brainstorming, 2026-10-29):
- "Professional" means four things: flawless reliability, a richer app, a polished presentation, an architecture open to contributors.
- **The first 2.0 must get one thing perfectly right: reliability, through WASM.**
- The second direction chosen: **the app connected to the sim** (live state, the user's data visible and editable, export / import).
- Must not happen: **the sim slower**, even a little. **Once on 2.0, it must work.**
- Losing the 1.x data at the move to 2.0 is acceptable (no migration needed).

What the SDK offers (MSFS 2024 SDK 1.8.1, read through the project's MCP server):
- `MSFS_IO.h`: async file open / read / write / close for a WASM module (its `\work` folder).
- `MSFS_CommBus.h`: `fsCommBusCall` / `fsCommBusRegister`, broadcast to JS, WASM and SimConnect.
- `SimConnect.h`: `SimConnect_CallCommBusEvent`, `SimConnect_SubscribeToCommBusEvent`: an external program talks on the same bus.
- Also `MSFS_Flow.h` (flight events), `MSFS_Network.h` (HTTP), `MSFS_PlannedRoute.h` (EFB route): for later 2.x features.
- The LLVM / WASI toolchain is installed with the SDK; no standalone module sample is in it.
- Another mod's author (sim-reference.md, storage): a standalone module in `modules/<name>.wasm` writes to `\work` at once; the menu reaches it after `engine.trigger('ADD_VIEW_LISTENER', 'JS_LISTENER_COMM_BUS', location.pathname)`, sends with `engine.call('COMM_BUS_WASM_CALLBACK', event, text)`, receives with `engine.on('EVENT_FROM_VIEW_LISTENER', …)`; build with `/GS-`; event names shared by every module (unique prefix). Not verified here.

## Design

**Goals of 2.0**
1. A standalone WASM module in the `msfs-ui` package is the mod's store: every write reaches the disk at once, on Steam and on the Microsoft Store edition.
2. The app reads the same data (file when the sim is closed, CommBus when it runs), shows it, edits it, exports and imports it.

**Non-goals of 2.0** (later 2.x): installer, auto-update, code signing, contributor architecture; logbook, flight scenarios, SimBrief; migration of the 1.x data.

**Anti-goals**
- Any measurable cost to the sim: the module does nothing per frame, wakes only on a message; the menu sends only on change, debounced; no polling.
- A 2.0 that loses data: a write confirmed by the module is on the disk; a crash during a write never leaves an unreadable file.

**Decisions**
- Owner: reliability first; app connected second; 1.x data may be lost.
- Mine (to be checked by the owner):
  - A 2.0 of the same project, developed on a branch `v2`, published in place of 1.x (one flightsim.to page, one user base).
  - The mod stays autonomous in the sim: the app is never needed for it to work.
  - `core/storage.ts` keeps its synchronous API (`loadData`, `saveData`, `deleteData`): an in-memory copy loaded from the module before the features start, writes applied to the copy then sent to the module. No feature module changes.
  - If the module does not answer at start-up (a bounded wait), the mod falls back to `datastorage` as in 1.x and says so (log, Compatibility page): it never stops working.
  - CommBus event names prefixed `MSFS_UI_`.
  - Write safety: two files written alternately with a sequence number (MSFS_IO has no rename), the newest readable one wins.
  - The `.wasm` source lives in a new `wasm/` folder (C++, SDK toolchain, `/GS-`); the build embeds the binary in the app like `mod/dist/main.js`; `PackageLayout` gains `modules/msfs-ui.wasm`.
  - The app talks to the sim through SimConnect + CommBus; the Coherent inspector stays for the dev tool and the live checks.

**Left to the builder:** the file format inside `\work` (JSON is expected), message framing if the CommBus has a size limit, the SimConnect binding (managed wrapper or P/Invoke of the native DLL, licence checked), UI of the app's new Data page.

## Steps (each presented, validated, committed as usual; never pushed)

**Step A: a project skill for MSFS 2024 WASM (before anything else; the owner's request).**
The owner dropped a generic `tools/SKILL.md` ("wasm-expert": Rust, wasm-bindgen, browser, Component Model, WASI runtimes); almost none of it applies to an MSFS module. The owner chose: **a specialised skill, written on the same model, in the project** (the generic one not installed).
- Write `.claude/skills/msfs-wasm/SKILL.md` (frontmatter `name`, `description` saying when to use it: writing, building, packaging, testing or debugging a WASM module of the sim, or the menu / app talking to it), following `superpowers:writing-skills`.
- Content, every fact sourced from the installed SDK 1.8.1 (read through the `msfs-2024-sdk` MCP server) or from the project's own findings (`docs/sim-reference.md`), the unverified ones marked as such:
  - Toolchain: the SDK's `WASM/llvm` clang and `WASM/wasi-sysroot`, the flags of the SDK's own projects (`WASM/projects/SimUtils/SimUtils.vcxproj`, `gdiplus/WasmGdiPlus.vcxproj`), `/GS-` (`__stack_chk_fail` not provided), a build from the command line for this repo (`build-release.ps1`).
  - Module kinds: standalone module (`modules/<name>.wasm` of a Community package, lifetime sim start to Quit, entry points) vs gauge modules; listing it in `layout.json` (`PackageBuilder`); a file added to a mounted package needs a restart.
  - APIs: `MSFS_IO.h` (async, the `\work` folder, `FsIOErr_AccessNotAllowed` outside the package), `MSFS_CommBus.h` (broadcast flags, register / call, unique `MSFS_UI_` prefix), `SimConnect.h` CommBus calls (the app side), the menu side (`ADD_VIEW_LISTENER` `JS_LISTENER_COMM_BUS`, `COMM_BUS_WASM_CALLBACK`, `EVENT_FROM_VIEW_LISTENER`), and pointers to `MSFS_Flow.h`, `MSFS_Network.h`, `MSFS_Vars.h`, `MSFS_PlannedRoute.h` for later.
  - Rules of this project applied to WASM: no per-frame work, wake on messages only, debounce writes, async I/O only; crash-safe writes (A/B files); English everywhere; no personal data in binaries (paths); never break the mod when the module is missing (fallback).
  - Verifying: what to measure in the sim (module loaded, `\work` file content, round trip times, frame cost) with `msfs-ui-dev` and the sim's console; the pitfalls (shared event names, message size, Store edition paths).
  - What does **not** apply from generic WASM advice (wasm-bindgen, Component Model, browser instantiation, WASI Preview 2 runtimes): one short section, so that it is not followed by mistake.
- Remove `tools/SKILL.md` (the owner's choice: the project skill replaces it).
- Mention the skill in `CLAUDE.md` (Names and layout) and `docs/development.md`.
- Check: the skill shows in the session's skill list; each SDK fact it states found again in the SDK files; commit "Skill: MSFS 2024 WASM".

**Step 0: feasibility spike (throwaway, branch `v2-spike`, nothing kept).** Measure, on the owner's Steam sim:
1. A minimal standalone module (`modules/msfs-ui.wasm`, listed in `layout.json`) in the package installed by `msfs-ui-dev install` loads at sim start (its log line in the console / a file in `\work`).
2. The exact `\work` path on Steam, and that it survives a Quit and a restart.
3. A round trip menu → module → menu over the CommBus (the calls above), the largest message that passes, the latency.
4. A round trip app → menu over SimConnect `CallCommBusEvent` / `SubscribeToCommBusEvent`.
5. Cost: frame time and menu responsiveness with the module loaded and idle, then during writes.
6. Then the Store user tries the spike's package (does the module load, where is `\work`).
Outcome: a short report in `docs/next-steps.md`; go / no-go for steps 1 and 2. If a point fails, back to the owner before any design change.

**Step 1: the WASM vault (2.0-a).**
- `wasm/` module: register `MSFS_UI_STORE_*` events (load all, set key, delete key), keep the data in memory, write the A/B files asynchronously, answer each write with its sequence number.
- `mod/src/core/storage.ts`: in-memory copy, async start-up load from the module before `main.ts` starts the features, fallback to `datastorage`; `sim/profile-save.ts` used only in fallback.
- `generator/MsfsUi.Core/Packaging/PackageLayout.cs`, `PackageBuilder.cs`: ship the module; build scripts and `build-release.ps1`: build and embed it.
- `mod/compat.json` + `CompatibilityChecker`: a check "the store module answers".
- Tests: storage copy and fallback (node:test, fake bus); A/B file choice (module unit tests if the toolchain allows, else the logic kept in a small pure part); package contents (Core tests).

**Step 2: the app connected (2.0-b).**
- `MsfsUi.Core`: a SimConnect + CommBus client (connect when the sim runs, never throw, worker thread as `SimSession.RefreshAsync`).
- Reading the `\work` file when the sim is closed.
- A Data page (MVVM, x:Bind, resw strings, AutomationIds): favourites, tail numbers, last uses; edit, delete, export / import (JSON file).
- UI tests on the isolated profile, with a fake bus.

**Step 3: release 2.0.0** (docs, CHANGELOG, user guide, flightsim.to text), then the 2.x list (presentation, open architecture, logbook through `MSFS_Flow`, scenarios, SimBrief).

## Verification

- Every step: `npm run check` in `mod/`, `dotnet build` and `dotnet test generator/MsfsUi.slnx`, `msfs-ui-dev install` + restart (a new file in the package needs a restart), measures with `msfs-ui-dev eval` and the files in `\work`.
- Reliability: change a favourite, kill the sim's process at once, restart: the change is there. Same after Quit from the main menu without a flight (the case 1.x had to work around).
- Fallback: package without the module: the mod works on `datastorage` and the Compatibility page says why.
- Performance: frame time and the 250 ms layout passes measured with and without the module, idle and while writing; no difference beyond noise.
- App: with the sim running, edit a favourite in the app, see it in the sim at once; with the sim closed, the Data page reads the file.
- Store edition: the Store user tests the step 0 package, then the 2.0 beta.

