# WASM vault (MSFS-UI 2.0, step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. REQUIRED for every task touching the module or the bus: the project skill `msfs-wasm`.

**Goal:** The mod's data (favourites, tail numbers, last uses, last choices) is kept by a standalone WASM module of the `msfs-ui` package, written to the disk at once, with `datastorage` as the fallback when the module does not answer.

**Architecture:** The module (`wasm/`, C++ in a plain C style, SDK toolchain) is a dumb, crash-safe store of one ASCII text: it loads the newest valid of two file slots at start, answers `LOAD`, writes each `SAVE` to the other slot (data file, then head file) and acknowledges it. The mod keeps `core/storage.ts`'s synchronous API over a backend: an in-memory copy sent to the module as one JSON snapshot (debounced), or `datastorage` as in 1.x. The app embeds the module like `main.js` and ships it in the package with an MSFS 2024 manifest.

**Tech Stack:** C++ written as plain C (clang-cl 15 of the SDK in gcc mode, wasm-ld), TypeScript ES2017 (esbuild, node:test), .NET 10 (MsfsUi.Core, MSTest).

**Spec:** `docs/superpowers/specs/2026-10-29-msfs-ui-2-design.md`; the spike's measures in `.claude/skills/msfs-wasm/reference.md` and `docs/next-steps.md` (2.0, step 0).

## Global Constraints

- Everything in English; no personal data (no build-machine path in `msfs-ui.wasm`: `--strip-debug`, checked by the build).
- Zero cost to the sim: no per-frame work, no `Update_StandAlone` export, no timer in the module; the menu debounces.
- The build command and exports are exactly those verified in `reference.md` (memory exports required).
- Module paths `"/work/…"`; reads always ask the exact size (a larger count fails).
- CommBus event names prefixed `MSFS_UI_`; the menu filters other add-ons' events out at once.
- Menu side uses `engine.on/off/trigger/call` (no `Coherent` in the main menu); every subscription removed with its `Scope`.
- ES2017 in the mod (no operator before `await`, no raw U+2028/U+2029); `\uXXXX` built with `String.fromCharCode` (the Write tool turns escapes into raw characters).
- App rules of CLAUDE.md (nullable, warnings as errors, public API of `MsfsUi.Core` documented, pinned packages).
- Losing 1.x data at the move to 2.0 is accepted (no migration). Changed after the plan ran: the owner asked for the copy of the 1.x keys into a new vault (done, `copyFromDatastorage`).
- Branch `v2`; one commit per task; never push.

## Review Focus

1. **Non-ASCII values** (livery titles such as "Air Caraïbes", "全日空"): the snapshot round-trips unchanged; the bus only ever carries ASCII (escaped by the menu). Test in Task 2.
2. **Crash between the data write and the head write**, or during either: the next start loads the previous snapshot, never a mix or nothing. Test in Task 1 (fake disk, callbacks dropped).
3. **Hot reload with a save pending** (`msfs-ui-dev reload`, the app's Apply): the old version flushes, the new version's `LOAD` gets that snapshot. Tests in Tasks 1 (SAVE then LOAD order) and 2 (flush on dispose); measured in Task 5.
4. **Module missing, `Failed` or late** (package from 1.x, the sim of 1.5): the mod runs on `datastorage` with the profile saves, says so in its log and on the Compatibility page. Tests in Tasks 2 and 4.
5. **Bursts and oversize**: hearts clicked fast give one save with the last state; a SAVE arriving while a write runs replaces any queued one; a snapshot above 524,288 bytes is refused (logged, previous kept). Tests in Tasks 1 and 2.

---

### Task 1: The vault module and its test harness

**Files:**
- Create: `wasm/src/vault.cpp`, `wasm/build.ps1`, `wasm/README.md`, `wasm/test/harness.ts`, `wasm/test/vault.test.ts`
- Output (ignored by Git through `dist/`, `obj/`): `wasm/dist/msfs-ui.wasm`

**Interfaces:**
- Produces, on the CommBus (payloads ASCII, fields separated by `\n`):
  - `MSFS_UI_VAULT_LOAD` ← `<requestId>`; answered `MSFS_UI_VAULT_LOADED` → `<requestId>\n<seq>\n<text>` (`0` and empty text when nothing is stored); a LOAD received before the start-up read ends is answered when it ends.
  - `MSFS_UI_VAULT_SAVE` ← `<seq>\n<text>`; answered `MSFS_UI_VAULT_SAVED` → `<seq>\nok`, `<seq>\nstale` (seq not above the current one), `<seq>\ntoo-big` (text above 524,288 bytes), `<seq>\nerror <FsIOErr>`.
  - Answers broadcast with `FsCommBusBroadcast_JS` only (step 2 adds SimConnect).
- Produces, in `\work`: slots `a` and `b`, each `/work/vault-<slot>.data` (the text, exactly) and `/work/vault-<slot>.head`, 64 bytes: `MSFSUI-VAULT 1 <seq %010u> <length %010u> <fnv1a32 %08x>` padded with spaces to 63, then `\n`.
- Produces: `wasm/build.ps1 [-NoTest]` → `wasm/dist/msfs-ui.wasm`, failing when an import is outside `env.fs*` / `wasi_snapshot_preview1.*`, a required export is missing, or a path of the machine (`$env:USERPROFILE`, `$env:USERNAME`) is in the binary.

- [ ] **Step 1: Write the harness** `wasm/test/harness.ts`: `loadVault(disk: Map<string, Uint8Array>, options?: { stopAfter?: number }): Promise<Harness>` with `send(event: string, text: string): void`, `settle(): Promise<void>` (runs the queued I/O callbacks), `sent: { event: string; text: string }[]`, `crash(): void` (drops every queued callback). It instantiates `wasm/dist/msfs-ui.wasm` with fake imports built from `WebAssembly.Module.imports` (no-op for any import not faked), calls `__wasm_call_ctors` then `module_init`. Fakes, matching the sim as measured: `fsIOOpen` (TRUNC empties the file), `fsIOOpenRead` (returns 0n when the file is missing or `count` exceeds its size), `fsIOWrite`, `fsIOClose`, `fsIOGetLastError`; callbacks queued, called through `__indirect_function_table.get(index)` with `FsIOFile` as `BigInt`; read buffers allocated with the module's `malloc`. `fsCommBusRegister` keeps the callbacks; `send` copies the text into module memory (`malloc`), calls the callback, then `free`s.

- [ ] **Step 2: Write the failing tests** `wasm/test/vault.test.ts` (skipped with a message when `wasm/dist/msfs-ui.wasm` is missing):
  - `answers an empty vault`: new disk, LOAD `7` → LOADED `7\n0\n`.
  - `saves, then loads after a restart`: SAVE `1\n{"a":"1"}`, settle → SAVED `1\nok`; disk has `/work/vault-a.data` = `{"a":"1"}` and a 64-byte head with seq `0000000001`; a new instance on the same disk answers LOAD with `1\n{"a":"1"}`.
  - `alternates the slots`: saves 1, 2, 3 → data in a, b, a; LOAD after a restart gives seq 3.
  - `keeps the previous snapshot when the head was not written`: save 1, settle; save 2 with `stopAfter` reached after the data write (crash before the head) → restart → LOADED seq 1, text of 1.
  - `ignores a slot whose data does not match its checksum`: corrupt `vault-b.data` after save 2 → restart → seq 1.
  - `coalesces saves during a write`: SAVE 1, 2, 3 without settling, then settle → SAVED `ok` for 1, 2 and 3 (2 answered when 3 is written), disk seq 3, at most 2 data writes.
  - `answers LOAD after a SAVE with the saved text` (hot reload order): SAVE 4 then LOAD 9 in the same turn → LOADED `9\n4\n…`.
  - `refuses stale and oversize saves`: SAVE 1 twice → second `stale`; a 524,289-byte text → `too-big`, disk unchanged.
  - `answers a LOAD that arrives before the start-up read ends`: LOAD before the first settle → answered after it.

- [ ] **Step 3: Run them, watch them fail**

Run, once Step 4's script exists and `vault.cpp` is an empty `module_init`: `pwsh -File wasm/build.ps1` → the build passes, the tests FAIL on their assertions.

- [ ] **Step 4: Implement `wasm/build.ps1`** with the exact compile and link commands of `reference.md` (sources `wasm/src/*.cpp`, unchanged flags: the SDK headers are C++, `MSFS_Core.h` has default member initialisers), then the import / export / path checks (Node `WebAssembly.Module.imports` / `exports`), then `node --test "wasm/test/*.test.ts"` unless `-NoTest`.

- [ ] **Step 5: Implement `wasm/src/vault.cpp`**: `module_init` registers `MSFS_UI_VAULT_LOAD` and `MSFS_UI_VAULT_SAVE`, then reads both heads (exact 64 bytes), then each valid head's data (exact length; none when 0), keeps the newest slot whose FNV-1a 32 matches. State: `current {seq, slot, text}`, `writing` flag, one `queued` snapshot (a newer SAVE replaces it, the replaced one answered `ok` once the newer is written). Write = data (`WRONLY|CREAT|TRUNC`) → close → head → close → SAVED. Copy incoming buffers (`malloc`); free replaced texts. `module_deinit`: `fsCommBusUnregisterAll()`.

- [ ] **Step 6: Build and run the tests**

Run: `pwsh -File wasm/build.ps1` → every test PASS, checks OK, `wasm/dist/msfs-ui.wasm` written.

- [ ] **Step 7: Write `wasm/README.md`** (what the module does, the protocol and file format above, how to build and test, that it needs `MSFS2024_SDK`), then commit: `git add wasm; git commit` "Vault: the WASM module, its build and its tests".

### Task 2: The mod on the vault

**Files:**
- Create: `mod/src/core/vault-protocol.ts`, `mod/src/sim/vault.ts`, `mod/test/vault-protocol.test.ts`, `mod/test/vault.test.ts`
- Modify: `mod/src/core/storage.ts`, `mod/src/core/runtime.ts`, `mod/src/main.ts`, `mod/test/storage.test.ts` (create if missing)

**Interfaces:**
- Consumes: Task 1's events and payloads.
- Produces:
  - `core/vault-protocol.ts`: `VAULT_EVENTS = { load: 'MSFS_UI_VAULT_LOAD', loaded: 'MSFS_UI_VAULT_LOADED', save: 'MSFS_UI_VAULT_SAVE', saved: 'MSFS_UI_VAULT_SAVED' }`, `VAULT_MAX_BYTES = 524288`, `toAscii(text: string): string` (every char above 0x7F as `\uXXXX`, so `JSON.parse` gives the same value back), `encodeSave(seq: number, text: string): string`, `decodeLoaded(payload: string): { requestId: number; seq: number; text: string } | null`, `decodeSaved(payload: string): { seq: number; status: string } | null`.
  - `core/storage.ts`: `interface StorageBackend { readonly kind: 'vault' | 'datastorage'; get(key: string): string | undefined; set(key: string, value: string): void; remove(key: string): void }`, `setStorageBackend(backend: StorageBackend | null): void` (null: `datastorage`); `loadData` / `saveData` / `deleteData` / `onStorageWrite` unchanged for callers; `onStorageWrite` fires only for the `datastorage` backend.
  - `sim/vault.ts`: `openVault(scope: Scope, timeoutMs?: number /* 3000 */): Promise<Vault | null>`; `interface Vault { readonly seq: number; backend(): StorageBackend; flush(): void; describe(): string }`. The backend's writes update the copy and send `toAscii(JSON.stringify(copy))` 300 ms after the last write (`core/async.ts` `debounced`); `flush()` sends at once; the scope's disposal flushes, then `engine.off`. A SAVED other than `ok` is logged with `logError`.
  - `RuntimeHandle.storage: { kind: 'vault' | 'datastorage'; detail: string } | undefined`.

- [ ] **Step 1: Write the failing tests**
  - `vault-protocol.test.ts`: `toAscii` of `{"t":"Air Caraïbes 全日空"}` has only chars ≤ 0x7F and `JSON.parse` gives the original; `encodeSave(3, 'x')` is `3\nx`; `decodeLoaded('7\n2\n{"a":1}')` → `{ requestId: 7, seq: 2, text: '{"a":1}' }`, a text containing `\n` kept whole; malformed payloads → null.
  - `vault.test.ts` (fake `engine` global answering like the module, fake timers): `opens with the stored snapshot`; `returns null when nothing answers within the time` (and removes its listener); `ignores other add-ons' events and other request ids`; `sends one snapshot for a burst of writes, 300 ms after the last`; `flushes a pending snapshot when its scope is disposed`; `refuses a snapshot above VAULT_MAX_BYTES` (logged, nothing sent); `logs a SAVED that is not ok`.
  - `storage.test.ts`: `saveData then loadData through a backend`; `falls back to datastorage after setStorageBackend(null)`; `onStorageWrite fires only on datastorage`.

- [ ] **Step 2: Run them, watch them fail**: `cd mod; node --test test/vault-protocol.test.ts test/vault.test.ts test/storage.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement** `vault-protocol.ts`, `vault.ts`, the backend in `storage.ts` (the `datastorage` code becomes the default backend), `runtime.storage`, and in `main.ts`, before the features: `const vault = await openVault(root);` then (after the `root.disposed` check) either `setStorageBackend(vault.backend())`, `root.add(() => setStorageBackend(null))`, `runtime.storage = { kind: 'vault', detail: vault.describe() }`, or `startProfileSaves(root)` and `runtime.storage = { kind: 'datastorage', detail: 'the vault module did not answer within 3000 ms' }`; log which.

- [ ] **Step 4: Run** `cd mod; npm run check` → PASS (contracts, tsc, build, every test).

- [ ] **Step 5: Commit** "Vault: the mod keeps its data in the WASM module".

### Task 3: The package ships the module

**Files:**
- Modify: `generator/MsfsUi.Core/Packaging/PackageLayout.cs`, `PackageBuilder.cs` (`PackageInputs`), `PackageState.cs`, `PackageInstaller.cs` (status and `NextStepAfterInstall`), `SimPackageFiles.cs`, `generator/MsfsUi.App/MsfsUi.App.csproj`, `generator/MsfsUi.App/Services/ModResources.cs`, `generator/MsfsUi.App/ViewModels/FeaturesViewModel.cs`, `generator/MsfsUi.App/Services/SimSession.cs`, `generator/MsfsUi.DevTool/Program.cs`, `build-release.ps1`
- Test: `generator/MsfsUi.Core.Tests/Packaging/PackageBuilderTests.cs`, `PackageInstallerTests.cs`, `SimPackageFilesTests.cs` (or where the manifest text is tested), `Settings/SettingsStoreTests.cs`

**Interfaces:**
- Consumes: `wasm/dist/msfs-ui.wasm` (Task 1).
- Produces: `PackageLayout.VaultModulePath = "modules/msfs-ui.wasm"`; `PackageInputs(string Version, ReadOnlyMemory<byte> ModScript, string ConfigScript, ReadOnlyMemory<byte> VaultModule)` (empty `VaultModule` = no module, for the fallback test); `PackageInputs.ForMod(catalog, modScript, vaultModule, selection)`; `PackageState.VaultSha256` (string?, absent before 2.0); `ModResources.VaultModule`; DevTool `install --vault <file|none>` (default `wasm\dist\msfs-ui.wasm`).

- [ ] **Step 1: Write the failing tests**
  - Builder: the package contains `modules/msfs-ui.wasm` with the input's bytes, listed in `layout.json`, counted in `total_package_size`; `state.VaultSha256` is its SHA-256; with an empty `VaultModule`, no `modules/` folder and `VaultSha256` null.
  - Manifest: `FormatManifest` gives, in this order, `dependencies`, `content_type` `MISC`, `title`, `manufacturer`, `creator`, `package_version`, `minimum_game_version` `1.9.12`, `minimum_compatibility_version` `9.12.0.245`, `export_type` `Community`, `builder` `Microsoft Flight Simulator 2024`, `release_notes`, `total_package_size` (the values of the package verified `Ready` in the spike).
  - Installer: a changed `VaultSha256` makes the status `UpdateNeeded` with `ModChanged`; installing it while the sim runs gives `NextStep.RestartSim` even when every file existed before (the module is read only at start).
- [ ] **Step 2: Run** `dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"` → FAIL on those tests.
- [ ] **Step 3: Implement**; the csproj embeds `..\..\wasm\dist\msfs-ui.wasm` as `MsfsUi.Mod.msfs-ui.wasm` with an `<Error>` like main.js's ("run `pwsh -File wasm/build.ps1` first"); `build-release.ps1` gains the step `Vault module: build and tests` (`pwsh -File wasm\build.ps1`) before the app build.
- [ ] **Step 4: Run** `cd mod; npm run check; cd ..; pwsh -File wasm/build.ps1; dotnet build generator/MsfsUi.slnx; dotnet test generator/MsfsUi.slnx` → PASS (UI tests included).
- [ ] **Step 5: Commit** "Vault: the package ships the module with an MSFS 2024 manifest".

### Task 4: The Compatibility page knows the vault

**Files:**
- Modify: `generator/MsfsUi.Core/Compatibility/CompatibilityChecker.cs` (`StorageProbe`)
- Test: `generator/MsfsUi.Core.Tests/Compatibility/CompatibilityCheckerTests.cs`

**Interfaces:** Consumes `window.__msfsUiRuntime.storage` (Task 2).

- [ ] **Step 1: Write the failing test**: run `StorageProbe` with Jint (already a test dependency, `Directory.Packages.props`) on a fake `window`: with `__msfsUiRuntime.storage = { kind: 'vault', detail: 'seq 12, 3 kB' }` and no `datastorage`, every item is ok and the first is `vault (WASM module)` with that detail; with `kind: 'datastorage'`, the first item is not ok with its detail, and the `datastorage` items are as in 1.x.
- [ ] **Step 2: Run** the Core tests → FAIL.
- [ ] **Step 3: Implement**: the first item `vault (WASM module)`; when the vault is used, the `datastorage` items say `not used: the vault keeps the data` and are ok; the `mod data` item lists the stored keys from the vault when it is used (Task 2's `describe()` gives them).
- [ ] **Step 4: Run** the Core tests → PASS. **Step 5: Commit** "Compatibility: the vault in the Storage group".

### Task 5: Verification in the sim and documentation

**Files:**
- Modify: `CLAUDE.md` (Commands: `pwsh -File wasm/build.ps1`; Rules: "Persistent data" now the vault, `datastorage` as the fallback; Names and layout: `wasm/`), `docs/development.md` (repository, build, the vault), `mod/README.md` (data stored), `docs/sim-reference.md` (storage), `docs/user-guide.md` (a restart after installing 2.0; troubleshooting), `docs/next-steps.md` (step 1 row), `.claude/skills/msfs-wasm/reference.md` (anything newly measured)

- [ ] **Step 1: In the sim** (owner restarts when asked): `msfs-ui-dev install`, restart → the menu is the mod's (MasterPage override still applied with the new manifest), `msfs-ui.wasm` `Ready` in `AsoboReport-RunningSession.txt`, `window.__msfsUiRuntime.storage.kind === 'vault'`.
- [ ] **Step 2**: mark a favourite livery → within 1 s a new head in `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\msfs-ui\work\`; Quit from the menu, restart → the favourite is there.
- [ ] **Step 3**: change a tail number, wait 2 s, end the sim's process (`Stop-Process`), restart → the change is there.
- [ ] **Step 4**: `msfs-ui-dev reload` right after a heart click → still `vault`, the heart kept.
- [ ] **Step 5**: `msfs-ui-dev install --vault none`, restart → `storage.kind === 'datastorage'`, Compatibility page explains; `msfs-ui-dev install`, restart.
- [ ] **Step 6**: frame cadence of the menu (the spike's `requestAnimationFrame` probe) idle and while clicking hearts: no difference; Compatibility page all green.
- [ ] **Step 7**: document, then commit "Docs: the vault (2.0 step 1)".
