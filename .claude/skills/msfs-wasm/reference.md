# MSFS 2024 WASM: reference

Read from the installed SDK (`%MSFS2024_SDK%`, 1.8.1) and the sim's `fs-base-ui` (0.1.10). Re-read the headers with the `msfs-2024-sdk` MCP server (`sdk_read_file`) before relying on a signature: they are the source of truth.

## Toolchain (in the SDK)

| Path | Content |
|---|---|
| `WASM/llvm/bin/` | `clang-cl.exe` (clang 15.0.1, Asobo's fork `innative-llvm`), `wasm-ld.exe`, `llvm-ar.exe` |
| `WASM/wasi-sysroot/` | `include/`, `lib/wasm32-wasi/` (`libc.a`, `libc++.a`, `libc++abi.a`, `libclang_rt.builtins-wasm32.a`, `crt1-reactor.o`…) |
| `WASM/include/MSFS/` | The APIs (`MSFS.h`, `MSFS_IO.h`, `MSFS_CommBus.h`, `MSFS_Flow.h`, `MSFS_Network.h`, `MSFS_Vars.h`…) |
| `WASM/WasmVersions/MSFS_WasmVersions.a` | Version information library (whether a module must link it: **unverified**) |
| `WASM/lib/` | `SimUtils.a`, `gdiplus.a` (and `_debug` builds) |

The SDK's own projects (`WASM/projects/SimUtils/SimUtils.vcxproj`) build through a Visual Studio platform `MSFS` / toolset `MSFS2024` (not installed on this machine), with: `BufferSecurityCheck` false, `ExceptionHandling` false, `NoEntryPoint` true, defines `__wasi__;_STRING_H_CPLUSPLUS_98_CONFORMANCE_;_WCHAR_H_CPLUSPLUS_98_CONFORMANCE_;_WINDLL` (plus `_LIBCPP_HAS_NO_THREADS` in Debug), release `MaxSpeed` with whole-program optimisation. `gauges.h` uses `_MSFS_WASM` to drop `__stdcall`.

**Command-line build: verified in the sim on 2026-10-29** (the module `Ready`, its files written and read back, CommBus round trips; spike of next-steps.md, 2.0 step 0):

```powershell
$wasm = Join-Path $env:MSFS2024_SDK 'WASM'
$sysroot = Join-Path $wasm 'wasi-sysroot'
# clang-cl in gcc mode: with a wasm target, its MSVC-style flags (/O2, /GS-, /imsvc…) are ignored ("argument unused").
& "$wasm\llvm\bin\clang-cl.exe" --driver-mode=g++ --target=wasm32-unknown-wasi "--sysroot=$sysroot" -c -O2 -std=c++17 `
  -fno-exceptions -fno-rtti -fno-stack-protector -fvisibility=hidden -mbulk-memory -fstack-size-section `
  -D_MSFS_WASM -D__wasi__ -D_LIBCPP_HAS_NO_THREADS -D_STRING_H_CPLUSPLUS_98_CONFORMANCE_ -D_WCHAR_H_CPLUSPLUS_98_CONFORMANCE_ `
  -I "$wasm\include" src\module.cpp -o obj\module.o
& "$wasm\llvm\bin\wasm-ld.exe" --no-entry --allow-undefined --export-table --stack-guard-page --strip-debug --no-eac-patch `
  --export=__wasm_call_ctors --export=module_init --export=module_deinit `
  --export=malloc --export=free --export=mallinfo --export=mchunkit_begin --export=mchunkit_next `
  --export=get_pages_state --export=mark_decommit_pages `
  -L "$sysroot\lib\wasm32-wasi" -lc "$sysroot\lib\wasm32-wasi\libclang_rt.builtins-wasm32.a" `
  obj\module.o -o dist\msfs-ui.wasm
```

- **The memory exports are required** (`malloc` … `mark_decommit_pages`, from the SDK's `libc.a`): without them the sim lists the module as `Failed`, even one whose `module_init` is empty; with them it is `Ready`. The version exports of `MSFS_WasmVersions.a` (`GetSimConnectVersion`, `GetExtensionVersion`, `GetExtensionVersionBuffer`) are not: a module with only those failed, one with the memory exports alone started.
- `--export-table`, `__wasm_call_ctors`, `-mbulk-memory`, `-fstack-size-section`, `--stack-guard-page` match the working modules of other add-ons (ChasePlane): kept, each one's necessity not isolated.
- `--strip-debug` also drops the `editandcontinue` section the linker adds by default, and the build machine's paths with the debug info.
- Do **not** export `Update_StandAlone` (ChasePlane does): by its name, a per-frame entry point (**unverified**); this project's module has no per-frame work.
- Check the result before installing: list its imports and exports (Node: `WebAssembly.Module.imports` / `exports` of `new WebAssembly.Module(bytes)`); an import outside `env.fs*` and `wasi_snapshot_preview1.*` (such as `__stack_chk_fail`) means a flag is missing.

**Did it start?** The sim writes `%APPDATA%\Microsoft Flight Simulator 2024\AsoboReport-RunningSession.txt` while it runs (Steam). Its `[Wasm_Modules]` section lists every module with `Handle,DebugName,PackageName,MemorySize,Status,…`: `Ready` or `Failed`, nothing more about why. The sim compiles each module to a native DLL in the package's WASM folder (below); a DLL there does not mean the module started.

## Entry points

```cpp
#include <MSFS/MSFS.h>
extern "C" MSFS_CALLBACK void module_init(void) { /* register CommBus events, start the first read */ }
extern "C" MSFS_CALLBACK void module_deinit(void) { /* fsCommBusUnregisterAll(); close files */ }
```

A standalone module lives from the sim's start to its Quit (reported by another mod's author; it was running at the main menu in the spike). Its place in the package: `modules/<name>.wasm`, listed in `layout.json` (verified). Several modules can live in one package (verified: each gets its own line in the report). Avoid `printf` until its output is known: the spike dropped it while it could not tell why its module failed.

**The package's manifest decides its WASM folder** (verified on Steam): with `"builder": "Microsoft Flight Simulator 2024"` (as ChasePlane's, with `"export_type": "Community"` and `"minimum_compatibility_version"`), the sim uses `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\<package folder>\`; without it, `…\WASM\MSFS2020\<package folder>\`. The compiled DLLs and the `work` folder are there. A module was only ever `Ready` in a package with the MSFS 2024 manifest (the failing builds were tried in both). The project's package (verified on 2026-10-29, Steam, 1.9.21) ships `modules/msfs-ui.wasm` with that manifest, `minimum_game_version` 1.9.12 and the total size in the `D20` form: the module is `Ready` and the package's **MasterPage override still works** (the menu is the mod's). The module is read only at the sim's start.

## MSFS_IO.h

```cpp
FsIOFile fsIOOpen(const char* path, FsIOOpenFlags flags, FsIOFileOpenCallback cb, void* user);
FsIOErr  fsIORead(FsIOFile f, char* out, int offset, int count, FsIOFileReadCallback cb, void* user);
FsIOFile fsIOOpenRead(const char* path, FsIOOpenFlags flags, int offset, int count, FsIOFileReadCallback cb, void* user);
FsIOErr  fsIOWrite(FsIOFile f, const char* in, int offset, int count, FsIOFileWriteCallback cb, void* user);
FsIOErr  fsIOClose(FsIOFile f);
bool fsIOIsOpened(FsIOFile); bool fsIOInProgress(FsIOFile); bool fsIOIsDone(FsIOFile); bool fsIOHasError(FsIOFile);
FsIOErr fsIOGetLastError(FsIOFile); unsigned long long fsIOGetFileSize(FsIOFile);
```

- Flags: `FsIOOpenFlag_RDONLY`, `_WRONLY`, `_RDWR`, `_CREAT`, `_TRUNC`, `_HIDDEN`.
- Errors: `FsIOErr_BadParams`, `_FileNotFound`, `_AccessNotAllowed` (e.g. a file of another package), `_FileNotOpened`, `_ReadNotAllowed`, `_PartialReadImpossible`, `_OperationImpossible` (an operation already running on the file), `_UnknownError`.
- `FS_IO_ERROR_FILE` (0) is the failed handle. No rename, no delete, no directory listing.
- **Paths** (verified): `"\\work\\name"` and `"/work/name"` reach the package's `work` folder; `"work/name"` does not (open fails, then the write gives `FsIOErr_FileNotOpened`).
- **On the disk** (verified on Steam): `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\<package folder>\work\` (MSFS 2024 manifest, above). The files survive a Quit and a restart and are read back. The real module (the vault, `wasm/`) keeps `work\vault-a.head|data` and `vault-b.head|data`, each save to the other slot (seq 23 / 24, later 38 / 39…); a save is on the disk when the module answers: the sim's process force-stopped 2 s after a change still gave the change at the next start. On a hot reload of the mod, the old version's last save reaches the module before the new version's load. Store edition (reported, **unverified**): `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalState\WASM\MSFS2020\<package folder>\work\`.
- **Reading** (verified): `fsIOOpenRead(path, RDONLY, 0, count, cb, user)` works when `count` is at most the file's size; asking more than the size makes the open fail (`FS_IO_ERROR_FILE`). `fsIOOpen(path, RDONLY, cb)` then `fsIOGetFileSize`: its callback never came in the spike (**unverified** why). So the format must tell the reader the size (a fixed-size header file, or the size kept in another file) until a way to read a file of unknown size is measured.
- **Writing** (verified): `fsIOOpen(path, WRONLY | CREAT | TRUNC, cb)`, then `fsIOWrite` in the open callback, then `fsIOClose` in the write callback.

## MSFS_CommBus.h

```cpp
typedef void (*fsCommBusWasmCallback)(const char* buf, unsigned int bufSize, void* ctx);
bool fsCommBusCall(const char* eventName, const char* buf, unsigned int bufSize, FsCommBusBroadcastFlags to = FsCommBusBroadcast_Default);
bool fsCommBusRegister(const char* eventName, fsCommBusWasmCallback cb, void* ctx = nullptr);
int  fsCommBusUnregister(const char* eventName, fsCommBusWasmCallback cb = nullptr);
bool fsCommBusUnregisterOneEvent(const char* eventName, fsCommBusWasmCallback cb, void* ctx);
bool fsCommBusUnregisterAll();
```

Flags: `FsCommBusBroadcast_JS` (1), `_Wasm` (2), `_WasmSelfCall` (4, needs `_Wasm`), `_SimConnect` (8), `_Default` = JS | Wasm | SimConnect, `_AllWasm`, `_All`. The buffer is a byte string; the menu side sends and receives text (JSON).

## Menu side (sim's `html_ui`)

From `JS/Services/CommBus.js` and the `ViewListener` class of `JS/common.js`:

- Register: `RegisterViewListener("JS_LISTENER_COMM_BUS")`, which ends in `Coherent.trigger("ADD_VIEW_LISTENER", name, window.location.pathname)` (`JS/common.js`). The mod uses only the readable exports (`CLAUDE.md`), so call `engine` / `Coherent` directly rather than these classes, and declare the names in `mod/compat.json`.
- Send: `engine.call("COMM_BUS_WASM_CALLBACK", eventName, text)`; also `"COMM_BUS_SIMCONNECT_CALLBACK"` (to SimConnect clients) and `"COMM_BUS_ALL_CALLBACK"`. Returns a promise. Plain text passes (JSON not required).
- Receive: `engine.on("EVENT_FROM_VIEW_LISTENER", (listenerName, eventName, ...args) => …)`, keeping only `listenerName.toUpperCase() === "JS_LISTENER_COMM_BUS"`; `engine.off` the same function when the mod's `Scope` is disposed.
- **In the main menu (`mainUI.html`) there is no `Coherent` global** (verified): use `engine.on`, `engine.off`, `engine.trigger`, `engine.call`.
- Measured (verified, main menu, Steam): menu → module → menu round trips of 10 B to 1 MB all arrive, 12 to 22 ms; the menu's frame cadence (about 100 ms per frame at the main menu, in the spike) is the same idle and while messaging back to back.
- **The bus is shared**: the menu listener also receives other add-ons' events (ChasePlane's `p42_chaseplane_comms_wasm_ping`, many per second); filter on the `MSFS_UI_` prefix, early.
- Whether the menu answers before the module is up: **unverified**; the mod repeats its first LOAD every 500 ms until the module answers, with a bound of 3000 ms, then falls back on `datastorage` (with a package without the module, measured: it falls back with that reason).
- With the real module loaded, the frame cadence was measured on the Free Flight screen (not the main menu of the spike above), over 4 s, with no comparison without the module: mean 16.57 ms, p95 17.2 ms, max 18.1 ms.

## SimConnect side (the app)

```c
SimConnect_SubscribeToCommBusEvent(HANDLE h, SIMCONNECT_CLIENT_EVENT_ID id, const char* name);
SimConnect_UnsubscribeToCommBusEvent(HANDLE h, SIMCONNECT_CLIENT_EVENT_ID id);
SimConnect_CallCommBusEvent(HANDLE h, const char* name, SIMCONNECT_COMM_BUS_BROADCAST_TO to, DWORD size, const char* data);
```

`SIMCONNECT_COMM_BUS_BROADCAST_TO_JS` (1), `_WASM` (2), `_SIMCONNECT` (8), `_SIMCONNECT_SELF_CALL` (16), `_DEFAULT`, `_ALL_SIMCONNECT`, `_ALL`. Messages arrive as `SIMCONNECT_RECV_ID_COMM_BUS` (43 in the enum), struct `SIMCONNECT_RECV_COMM_BUS`: the 12-byte `SIMCONNECT_RECV` header, the 16 bytes of `SIMCONNECT_RECV_LIST_TEMPLATE`, `uEventID` at offset 28, the text from offset 32 to `cbData`.

Verified on 2026-10-29 (Steam, main menu):
- **The managed wrapper does not load in .NET 10**: `lib\managed\Microsoft.FlightSimulator.SimConnect.dll` is a .NET Framework 4 C++/CLI assembly. Call the native `lib\SimConnect.dll` through P/Invoke (`SimConnect_Open`, `SimConnect_GetNextDispatch`, the two CommBus calls); it exports them.
- App → module → app (`BROADCAST_TO_WASM`, the module answering with `FsCommBusBroadcast_SimConnect`): 80 to 110 ms with a 5 ms dispatch poll. App → menu (`BROADCAST_TO_JS`) and menu → app (`engine.call('COMM_BUS_SIMCONNECT_CALLBACK', name, text)`): both arrive.
- **`SimConnect_CallCommBusEvent` crashes the calling process** (access violation inside `SimConnect.dll`) for a message between 40,000 and 50,000 bytes; 40,000 passes. Never send more than 32 KB in one call: frame the protocol in chunks. Never probe the limit again from a process the user sees (each crash opens a Windows error dialog).
- Redistribution terms of `SimConnect.dll`: **unverified**.

## Later APIs

- `MSFS_Flow.h`: `fsFlowRegister(cb, ctx)`, events `FltLoad`, `FltLoaded`, `TeleportStart` / `Done`, `BackOnTrackStart` / `Done`, `SkipStart` / `Done`, `BackToMainMenu`, `RTCStart` / `End`, `ReplayStart` / `End`, `FlightStart`, `FlightEnd`, `PlaneCrash`.
- `MSFS_Network.h`: `fsNetworkHttpRequestGet` / `Post` / `Put(url, param, cb, user)`, then `fsNetworkHttpRequestGetData` / `GetDataSize` (the data is available only during the frame of the callback: copy it).
- `MSFS_PlannedRoute.h`: `fsPlannedRouteGetEfbRoute()`, broadcast and request callbacks.
- `MSFS_Vars.h`: sim variables (A:, L:…) from a module.
