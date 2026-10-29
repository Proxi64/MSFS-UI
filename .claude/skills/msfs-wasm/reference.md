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

**Command-line build: unverified**, a starting point to prove in a spike, then to put in a script called by `build-release.ps1`:

```powershell
$wasm = Join-Path $env:MSFS2024_SDK 'WASM'
& "$wasm\llvm\bin\clang-cl.exe" --target=wasm32-unknown-wasi /c /O2 /GS- /EHs-c- /std:c++17 `
  /D_MSFS_WASM /D__wasi__ /D_LIBCPP_HAS_NO_THREADS /D_STRING_H_CPLUSPLUS_98_CONFORMANCE_ /D_WCHAR_H_CPLUSPLUS_98_CONFORMANCE_ `
  /imsvc "$wasm\wasi-sysroot\include" /I "$wasm\include" src\module.cpp /Fo:obj\module.o
& "$wasm\llvm\bin\wasm-ld.exe" --no-entry --allow-undefined --export=module_init --export=module_deinit `
  -L "$wasm\wasi-sysroot\lib\wasm32-wasi" -lc -lc++ -lc++abi "$wasm\wasi-sysroot\lib\wasm32-wasi\libclang_rt.builtins-wasm32.a" `
  obj\module.o -o dist\msfs-ui.wasm
```

Check the result: `module_init` / `module_deinit` exported, and no import outside what the sim provides (`env.fs*`, WASI); an unexpected import (such as `__stack_chk_fail`) means a flag is missing.

## Entry points

```cpp
#include <MSFS/MSFS.h>
extern "C" MSFS_CALLBACK void module_init(void) { /* register CommBus events, start the first read */ }
extern "C" MSFS_CALLBACK void module_deinit(void) { /* fsCommBusUnregisterAll(); close files */ }
```

A standalone module lives from the sim's start to its Quit (reported by another mod's author: **unverified** here). Its place in the package: `modules/<name>.wasm` (same report, **unverified**).

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
- The writable folder is `\work` of the package (reported; its path on the disk, **unverified**: Store edition `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalState\WASM\MSFS2020\<package folder>\work\`, `MSFS2020` possibly `MSFS2024`; Steam not measured).

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
- Send: `Coherent.call("COMM_BUS_WASM_CALLBACK", eventName, text)`; also `"COMM_BUS_SIMCONNECT_CALLBACK"` and `"COMM_BUS_ALL_CALLBACK"`. Returns a promise (errors logged by the sim).
- Receive: `Coherent.on("EVENT_FROM_VIEW_LISTENER", (listenerName, eventName, ...args) => …)`, keeping only `listenerName.toUpperCase() === "JS_LISTENER_COMM_BUS"`. Keep the handle and `clear()` it when the mod's `Scope` is disposed.
- Whether the menu (`mainUI.html`) answers before the module is up: **unverified**; the mod waits with a bound.

## SimConnect side (the app)

```c
SimConnect_SubscribeToCommBusEvent(HANDLE h, SIMCONNECT_CLIENT_EVENT_ID id, const char* name);
SimConnect_UnsubscribeToCommBusEvent(HANDLE h, SIMCONNECT_CLIENT_EVENT_ID id);
SimConnect_CallCommBusEvent(HANDLE h, const char* name, SIMCONNECT_COMM_BUS_BROADCAST_TO to, DWORD size, const char* data);
```

`SIMCONNECT_COMM_BUS_BROADCAST_TO_JS` (1), `_WASM` (2), `_SIMCONNECT` (8), `_SIMCONNECT_SELF_CALL` (16), `_DEFAULT`, `_ALL_SIMCONNECT`, `_ALL`. Messages arrive as `SIMCONNECT_RECV_ID_COMM_BUS`, struct `SIMCONNECT_RECV_COMM_BUS` (`uEventID`, `rgData`). Whether the managed wrapper (`Microsoft.FlightSimulator.SimConnect.dll`) exposes these calls, and the redistribution terms of `SimConnect.dll`: **unverified**.

## Later APIs

- `MSFS_Flow.h`: `fsFlowRegister(cb, ctx)`, events `FltLoad`, `FltLoaded`, `TeleportStart` / `Done`, `BackOnTrackStart` / `Done`, `SkipStart` / `Done`, `BackToMainMenu`, `RTCStart` / `End`, `ReplayStart` / `End`, `FlightStart`, `FlightEnd`, `PlaneCrash`.
- `MSFS_Network.h`: `fsNetworkHttpRequestGet` / `Post` / `Put(url, param, cb, user)`, then `fsNetworkHttpRequestGetData` / `GetDataSize` (the data is available only during the frame of the callback: copy it).
- `MSFS_PlannedRoute.h`: `fsPlannedRouteGetEfbRoute()`, broadcast and request callbacks.
- `MSFS_Vars.h`: sim variables (A:, L:…) from a module.
