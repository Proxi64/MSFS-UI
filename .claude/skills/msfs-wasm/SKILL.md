---
name: msfs-wasm
description: Use when writing, building, packaging, testing or debugging a WebAssembly module for Microsoft Flight Simulator 2024 (standalone module of a Community package, C++ with the MSFS SDK), or when the sim's HTML/JS menu or an external app (SimConnect) must talk to such a module through the CommBus, or read and write files from the sim (MSFS_IO, the \work folder).
---

# MSFS 2024 WASM modules

## Overview

An MSFS WASM module is **not** a browser or WASI-runtime module: it is C++ compiled with the SDK's own clang fork, loaded by the sim, with no `main`, calling only the APIs of the SDK's `MSFS/*.h` headers. Every fact below comes from the installed SDK (`C:\MSFS 2024 SDK`, 1.8.1, readable through the `msfs-2024-sdk` MCP server: `sdk_read_file`, `sdk_search`) or from the sim's own files; what is only reported is marked **unverified**: measure it before relying on it.

**REQUIRED BACKGROUND:** the project's rules in `CLAUDE.md` (English everywhere, no personal data, every change to the sim reversible, verify by measuring) apply to the module as to the mod.

## When to use

- Adding or changing the module under `wasm/`, its build, or its place in the `msfs-ui` package.
- The menu mod (`mod/src`) or MSFS-UI-GENERATOR sending to or receiving from the module.
- A symptom: the module does not load, a CommBus message never arrives, a file is not written, the sim stutters after the module was added.

Not for: the menu mod alone (`mod/README.md`), SimConnect without the CommBus (`SimConnect.h`).

## Quick reference

| Need | Where (SDK) | Key points |
|---|---|---|
| Entry points | `WASM/include/MSFS/MSFS.h`, `Legacy/gauges.h` | `extern "C" MSFS_CALLBACK void module_init(void)` and `module_deinit(void)`; `MSFS_CALLBACK` = `__attribute__((visibility("default")))` |
| Files | `MSFS_IO.h` | All async with callbacks: `fsIOOpen`, `fsIORead`, `fsIOWrite`, `fsIOClose`; flags `RDONLY`, `WRONLY`, `RDWR`, `CREAT`, `TRUNC`; no rename, no delete; `FsIOErr_AccessNotAllowed` outside the package |
| Messages | `MSFS_CommBus.h` | `fsCommBusRegister(name, cb, ctx)`, `fsCommBusCall(name, buf, size, flags)`; flags `FsCommBusBroadcast_JS`, `_Wasm`, `_WasmSelfCall`, `_SimConnect`, `_Default` (JS + Wasm + SimConnect) |
| App side | `SimConnect SDK/include/SimConnect.h` | `SimConnect_SubscribeToCommBusEvent(h, eventId, name)`, `SimConnect_CallCommBusEvent(h, name, broadcastTo, size, data)`; received as `SIMCONNECT_RECV_ID_COMM_BUS` (`SIMCONNECT_RECV_COMM_BUS`: `uEventID`, `rgData`) |
| Menu side | sim: `html_ui/JS/Services/CommBus.js`, `JS/common.js` (`ViewListener`) | `engine.trigger("ADD_VIEW_LISTENER", "JS_LISTENER_COMM_BUS", location.pathname)`; send `engine.call("COMM_BUS_WASM_CALLBACK", name, text)` (also `COMM_BUS_SIMCONNECT_CALLBACK`, `COMM_BUS_ALL_CALLBACK`); receive `engine.on("EVENT_FROM_VIEW_LISTENER", (listener, event, ...args))`, filtered on the listener's name. No `Coherent` global in the main menu |
| Did it start? | `%APPDATA%\Microsoft Flight Simulator 2024\AsoboReport-RunningSession.txt` | `[Wasm_Modules]`: `Ready` or `Failed` per module (no reason given) |
| Later | `MSFS_Flow.h`, `MSFS_Network.h`, `MSFS_Vars.h`, `MSFS_PlannedRoute.h` | Flight events (load, start, end, crash, back to menu), HTTP GET / POST / PUT, sim variables, the EFB route |

Details, signatures and the build command: [reference.md](reference.md).

## Rules for this project

1. **Zero cost to the sim.** No work per frame, no polling, no busy wait: the module wakes on a CommBus message or an I/O callback only. The menu sends on change only, debounced. Measure the frame time with and without the module.
2. **Async I/O only**, one operation per file at a time (`FsIOErr_OperationImpossible` otherwise); keep the state in memory, write it after.
3. **Crash-safe writes**: no rename exists, so write two files alternately (A / B) with a sequence number and a checksum; on load, the newest valid one wins. A write is confirmed to the menu only from its write callback.
4. **Event names are global** to every module, gauge and app of the sim: prefix every name `MSFS_UI_`.
5. **Never break the mod**: the menu must work when the module is missing, late or failing (bounded wait, then fallback, logged and shown on the Compatibility page).
6. **No personal data** in the binary: no absolute paths of the build machine (`-fdebug-prefix-map`, no debug info in release).
7. **New file in a mounted package = restart of the sim** (`layout.json` is read at start-up); list the `.wasm` in `layout.json` through `PackageBuilder`, and give the package an MSFS 2024 manifest (`"builder": "Microsoft Flight Simulator 2024"`, reference.md): it also decides the `work` folder's place on the disk.

## Common mistakes

| Mistake | Fix |
|---|---|
| Following generic WebAssembly advice (wasm-bindgen, wasm-pack, Component Model / WIT, `WebAssembly.instantiate`, WASI Preview 2 runtimes, Rust targets) | None of it applies: the sim loads the module itself and offers only the SDK's imports |
| Module `Failed` in the report, even an empty one | Export the memory functions of the SDK's `libc.a` (`malloc`, `free`, `mallinfo`, `mchunkit_begin`, `mchunkit_next`, `get_pages_state`, `mark_decommit_pages`) and the function table; give the package an MSFS 2024 manifest (`builder`). The verified command is in reference.md |
| Passing `/O2`, `/GS-`, `/imsvc` to `clang-cl` for a wasm target | They are ignored ("argument unused"): run it with `--driver-mode=g++` and gcc flags (`-O2`, `-fno-stack-protector`) |
| Leaving the stack protector on | `-fno-stack-protector` (the `/GS-` of the reports): otherwise the module imports `__stack_chk_fail`, which the sim does not provide (reported by another mod's author; the SDK's projects set `BufferSecurityCheck` false) |
| Reading a file with a larger count than its size | `fsIOOpenRead` then fails: the reader must know the size (verified) |
| Waiting for good on an I/O callback | At some starts of the sim a read launched in `module_init` never calls back (verified, 1.9.21: 2 starts out of 5): never let a module depend on one callback; give a way to start again (the vault reads again from the menu's second LOAD on, when no read ended since the previous LOAD: a slow start keeps its reads) and a status event answered at once to see it |
| A SimConnect message above 32 KB | `SimConnect_CallCommBusEvent` crashes the app between 40 and 50 KB (verified): send in chunks |
| Using `Microsoft.FlightSimulator.SimConnect.dll` from .NET 10 | It is .NET Framework C++/CLI and does not load: P/Invoke the native `SimConnect.dll` |
| C++ exceptions, RTTI-dependent code, threads | The SDK's projects build with `ExceptionHandling` false and `_LIBCPP_HAS_NO_THREADS`; return error codes |
| Assuming a CommBus message is delivered, ordered or of any size | Unverified: measure the largest message and keep framing in the protocol (sequence numbers, acknowledgements) |
| Guessing the `\work` path | In the module: `"\\work\\name"` or `"/work/name"`, never `"work/name"`. On the disk (Steam, verified): `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\<package folder>\work\`; the Microsoft Store edition's is **unverified** |
| Testing only in a unit test | The sim is the runtime: install with `msfs-ui-dev install`, restart, check the console and the files, measure |

## Verifying a change

1. Build the module (reference.md), `npm run check` in `mod/`, `dotnet build` / `dotnet test generator/MsfsUi.slnx`.
2. `msfs-ui-dev install`, then restart the sim (a new or replaced `.wasm` is read at start-up; restarts cost the owner time: put several variants of a module in one package to compare them in one start).
3. The module's status in `AsoboReport-RunningSession.txt`, the files it wrote in its `work` folder, a status event it answers (its own log kept in memory) and a round trip from the menu with `msfs-ui-dev eval` (store async results in `window.__msfsUiProbe`, read them in a second eval).
4. Frame time and the menu's 250 ms layout passes, module idle and while writing: no difference beyond noise.
