# MCP server "MSFS 2024 SDK"

A local MCP server that gives Claude:

**The SDK reference** (always available, reads the SDK folder)

| Tool | Role |
|---|---|
| `sdk_overview` | SDK version, areas, key files |
| `sdk_list_dir` / `sdk_read_file` | Browse and read the files |
| `sdk_search` | Full-text or regex search (the LLVM toolchain is skipped by default) |
| `sdk_key_events` | Catalogue of the ~2080 key events (`MSFS_EventsEnum.h`) with a usage example |
| `sdk_simconnect_api` | Signature of a `SimConnect_*` function, definition of an enum or struct |
| `sdk_behavior_vars` | A:/L:/K:/B:… variables used in the ModelBehaviorDefs, with units and RPN examples |

**Live SimConnect** (MSFS 2024 must be running)

| Tool | Role |
|---|---|
| `sim_status` | Connection and sim version |
| `sim_snapshot` | Position, altitudes, speeds, attitude, autopilot, gear, flaps, fuel, QNH |
| `sim_get_vars` / `sim_set_var` | Read / write SimVars and LVars (`L:…`) |
| `sim_send_event` | Key event (`AP_MASTER`, `AP_ALT_VAR_SET_ENGLISH` + `[35000]`…) or custom event |
| `sim_list_input_events` / `sim_get_input_event` / `sim_set_input_event` | Cockpit input events (B:), MSFS 2024 |

## In the MSFS-UI project (Claude Code)

The server is declared in `.mcp.json`, at the repository's root, with a path relative to it (Claude Code starts the server in the project folder):

```json
{
  "mcpServers": {
    "msfs-2024-sdk": {
      "type": "stdio",
      "command": "node",
      "args": ["tools/msfs-sdk-mcp/server/index.js"]
    }
  }
}
```

- When the project opens, Claude Code offers this server: **accept** it.
- Its dependencies are in `tools/msfs-sdk-mcp/node_modules` (otherwise `npm install` in this folder).
- **SDK folder**: the first that exists among `MSFS_SDK_PATH`, `%USERPROFILE%\Model Context Protocol\MSFS 2024 SDK`, `C:\MSFS 2024 SDK` and `MSFS2024_SDK`. On the sim's machine: `C:\MSFS 2024 SDK` (SDK 1.8.1).

## Claude Desktop

In `%APPDATA%\Claude\claude_desktop_config.json` (after `npm install` in this folder), with `<repository>` replaced by the full path of the repository (Claude Desktop does not expand variables there):

```json
{
  "mcpServers": {
    "msfs-2024-sdk": {
      "command": "node",
      "args": ["<repository>\\tools\\msfs-sdk-mcp\\server\\index.js"],
      "env": { "MSFS_SDK_PATH": "C:\\MSFS 2024 SDK" }
    }
  }
}
```

## Notes

- The SimConnect connection is found automatically (Windows registry, filled in by MSFS at start-up). For a sim on another PC: variables `SIMCONNECT_HOST` and `SIMCONNECT_PORT`.
- Reading and writing LVars through SimConnect is an MSFS 2024 feature.
- Arbitrary RPN calculator code cannot run through SimConnect alone (it would need a WASM module such as MobiFlight).
- Dependencies: `@modelcontextprotocol/sdk`, `node-simconnect` (a pure JavaScript implementation of the SimConnect protocol), `zod`.
