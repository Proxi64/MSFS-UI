# msfs-ui.wasm: the vault

A standalone WebAssembly module of the MSFS 2024 sim that stores the mod's data in files of the package's `work` folder, because the sim's own `datastorage` reaches the disk only when it saves its profile. It works on a CommBus message or an I/O callback only: no per-frame work, no timer. Background and verified facts: `.claude/skills/msfs-wasm/`.

## Protocol

CommBus events, payloads in ASCII, fields separated by `\n`. Answers are broadcast to the menu (`FsCommBusBroadcast_JS`) only. A trailing NUL in a received payload is ignored.

| Event | Direction | Payload |
|---|---|---|
| `MSFS_UI_VAULT_LOAD` | to the module | `<requestId>` |
| `MSFS_UI_VAULT_LOADED` | from the module | `<requestId>\n<seq>\n<text>`; `0` and an empty text when nothing is stored |
| `MSFS_UI_VAULT_SAVE` | to the module | `<seq>\n<text>` |
| `MSFS_UI_VAULT_SAVED` | from the module | `<seq>\nok`, `<seq>\nstale`, `<seq>\ntoo-big`, or `<seq>\nerror <FsIOErr>` |

- A LOAD answers with the newest accepted text, even one still being written (a SAVE then a LOAD in the same turn gives the saved text). A LOAD or SAVE received before the start-up read ends is answered when it ends.
- `stale`: the seq is not above the highest accepted so far. `too-big`: the text is above 524,288 bytes.
- Saves received while a write runs are coalesced: only the newest is written next; the seqs it replaced are answered `ok` once it is written. `ok` always means the snapshot is on the disk.

## Files

Two slots, `a` and `b`, written alternately (the sim offers no rename): `/work/vault-<slot>.data` holds the text exactly; `/work/vault-<slot>.head` is 64 bytes: `MSFSUI-VAULT 1 <seq %010u> <length %010u> <fnv1a32 %08x>`, padded with spaces to 63 bytes, then `\n`. A write is data, then head. At start-up the module reads both heads (64 bytes), then the data of each valid head (exactly its length), and keeps the newest slot whose FNV-1a 32 matches: an interrupted write leaves the previous snapshot. The first write goes to the slot other than the one loaded; with nothing readable, to the slot other than the one with the newest valid head (its data may only have failed to read this time), or to slot a when no head is valid.

Reads use `fsIOOpenRead` with exact sizes only (a count above the file's size fails in the sim).

## Build and test

Needs the MSFS 2024 SDK (`MSFS2024_SDK`) and Node 22.18 or later (runs the `.ts` tests by type stripping, as the mod's tests do).

```powershell
pwsh -File wasm/build.ps1            # wasm/dist/msfs-ui.wasm, checks, then the tests
pwsh -File wasm/build.ps1 -NoTest    # without the tests
node --test "wasm/test/*.test.ts"    # the tests alone (need a built module)
```

The build checks that every import is the sim's (`env.fs*`) or the C library's (`wasi_snapshot_preview1.*`), that the required exports are there, and that no path or name of the build machine is in the binary. The tests (`test/vault.test.ts`) run the real module in Node with fake sim imports (`test/harness.ts`: a disk in memory, queued I/O callbacks, a crash that drops them). `dist/` and `obj/` are ignored by Git.
