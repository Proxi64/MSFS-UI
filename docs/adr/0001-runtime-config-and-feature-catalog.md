# ADR-0001: Runtime configuration and a shared feature catalogue

> Paths updated on 2026-10-19 after the repository was reorganised: `menu-mod/` is now `mod/`, `app/` is now `generator/`, and the app is named MSFS-UI-GENERATOR. `cli/` (the 0.3.0 tool) was removed.

**Status:** Accepted
**Date:** 2026-10-16
**Deciders:** Proxi64 (owner), Claude (implementation)

## Context

MSFS-UI 0.3.0 has two parts:
- A Node tool (`cli/`) builds a Community package that replaces the MSFS 2024 menu MasterPage with a copy carrying a small loader.
- A TypeScript menu mod (`mod/`) is compiled by esbuild into `html_ui/msfs-ui/main.js` and imported by that loader.

The user's settings (`msfs-ui.config.json`) are injected into `main.js` at build time (esbuild `define __MSFS_UI_CONFIG__`). Changing a setting means rebuilding the mod, which needs Node and esbuild.

Version 1.0 replaces the tool with a standalone WinUI 3 app:
- The user picks features and options in a UI, then the app generates and installs the package.
- **No Node or npm on the user's machine.**
- The mod is rewritten at the same time.

The app and the mod therefore need a contract for three things:
1. how the chosen settings reach the mod;
2. which features and options exist, with their types and defaults, so the app can build its UI;
3. what the mod relies on in the sim, so the app can run the compatibility check.

Hard constraints:
- **Mod runtime.** The mod runs in Coherent GT, an old WebKit that rejects ES2018+ syntax. Module imports of package files by absolute path work: the loader already does `import('/msfs-ui/main.js')`.
- **Reload behaviour.** The sim mounts a new package only at startup, but re-reads files of an already mounted package on the fly; hot reload uses `import('/msfs-ui/main.js?t=…')`.
- **No sim files in the repository.** The MasterPage is read from the user's machine when the package is generated.
- **One source of truth.** The app and the mod must not disagree on a feature's options or defaults.

## Decision

1. **Settings are read at runtime** from a generated ES module, `html_ui/msfs-ui/config.js`:
   - **Format**: `export default { "schemaVersion": 1, "features": { "<featureId>": { "enabled": true, "<optionId>": <value>, … } } };`, preceded by a comment naming the generating app version and stating that the file must not be edited by hand.
   - **Import**: the mod imports it at start-up with `import('/msfs-ui/config.js?t=' + Date.now())`. The cache-buster means a hot reload picks up new settings.
   - **Fallback**: if the import fails or the content is invalid, the mod logs an error and uses the defaults compiled into `main.js`. It never starts half-configured.
2. **`mod/features.json` is the feature catalogue.** For each feature it gives:
   - `id`, `title`, `description`, `screen`, `enabledByDefault`;
   - typed `options`: `boolean`, or `number` with `min` / `max` / `step` / `unit`, each with its `default`, `title` and `description`.

   Who uses it:
   - The **mod build** (`mod/build.mjs`) compiles the defaults into `main.js` and fails if a feature module and its catalogue entry disagree (missing feature, option not read by the code, wrong type).
   - The **app** embeds the same file and builds the Features page from it.
   - **Validation in the app** checks the user's settings against it: unknown ids are dropped, values are clamped to their range, and missing values take the default.
3. **`mod/compat.json` lists what the mod relies on in the sim**: readable exports by module, screens (GUID and class), anchors (`name="…"`), data-model and event symbols, sim files, CSS variables and translation keys. The app's `CompatibilityChecker` runs offline and live checks from it, replacing the hard-coded lists in `cli/check.ts`. A mod change that adds a dependency updates `compat.json` in the same commit.
4. **The package records what it was generated from.** `msfs-ui.json` gains `settingsSha256` (hash of `config.js`) and `modSha256` (hash of `main.js`), so Home can report "settings changed since install" separately from "sim updated" (MasterPage hash) and "app updated" (version).
5. **App settings** live in `%LOCALAPPDATA%\MSFS-UI\settings.json` (`schemaVersion`, then per feature `enabled` and option values). The package's `config.js` is always derived from them; it is never the source.

## Options Considered

### Option A: Keep settings baked into `main.js` (status quo)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low (exists today) |
| Cost | Needs Node + esbuild at every generation, bundled with the app or required on the machine |
| Scalability | Every setting change is a full rebuild |
| Team familiarity | High |

**Pros:** one file; no runtime failure mode for missing settings.
**Cons:** breaks the "no Node" requirement unless a JS bundler ships inside the app; slow; hot reload needs a rebuild.

### Option B: Generated `config.js` module, imported at runtime (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low: one extra file and one dynamic import |
| Cost | None at generation time: the app writes a small text file |
| Scalability | Settings change applies on hot reload, without a rebuild |
| Team familiarity | Same mechanism as the existing loader and hot reload |

**Pros:** `main.js` is byte-identical for every user and can be embedded and hashed; generation is pure file writing; a module import has proven to work in Coherent GT.
**Cons:** a new runtime failure mode (missing or invalid `config.js`), handled by the compiled-in defaults; to be verified once in the sim early in step 2.

### Option C: `config.json` read with `fetch`

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | None |
| Scalability | Same as B |
| Team familiarity | `fetch` of package files is proven only for VFS paths (`coui://html_ui/VFS/…`) |

**Pros:** plain data file, no JavaScript generated by the app.
**Cons:** path and caching behaviour of `fetch` for package files under `/msfs-ui/` are unverified in Coherent GT; B reuses a path that is known to work.

### Option D: Settings in the sim's `datastorage`, written through the Coherent inspector

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | The sim must be running to change a setting |
| Scalability | Instant, no file at all |
| Team familiarity | Known (`cli/backup.ts` already writes `datastorage`) |

**Pros:** settings survive package regeneration.
**Cons:** the app cannot configure the mod while the sim is closed (the common case); settings become invisible in the package; mixes user data (favourites…) with configuration.

## Trade-off Analysis

B is the only option that meets the "no Node" requirement and keeps the generation step trivial without relying on unverified Coherent behaviour. A would ship a JavaScript bundler inside a .NET app for no user benefit. C is equivalent to B but on a less proven path. D fails the main use case (configure before launching the sim).

Making `features.json` and `compat.json` the shared contract costs a little up front: the build check and a JSON schema. It removes the most likely class of bugs in a two-language product: the UI offering an option the mod ignores, a renamed default, or a sim dependency the check forgets (as found in the 0.3.0 code review, where `cli/check.ts` lagged behind the mod).

## Consequences

- **Easier:**
  - generating the package anywhere, with no Node;
  - changing settings while the sim runs (write `config.js`, then hot-reload);
  - adding a feature: catalogue entry, feature module and `compat.json` entries, and the UI follows;
  - telling the user exactly why the package needs regenerating.
- **Harder:**
  - the mod's start-up becomes asynchronous: it must wait for `config.js` before starting features;
  - the catalogue format is now a public contract between two code bases, versioned by `schemaVersion`.
- **To revisit:**
  - whether `config.js` should also carry per-user data migrations;
  - whether `features.json` titles should be localisable (English only for now);
  - option types beyond `boolean` and `number` (for example a choice list) when a feature needs one.

## Action Items

1. [x] Step 1a: `PackageBuilder` writes `config.js`, and `msfs-ui.json` with `settingsSha256` and `modSha256`. Golden test against the 0.3.0 tool for the MasterPage, `layout.json` and `manifest.json`.
2. [x] Step 1a: C# models for `features.json` and `config.js` with source-generated `System.Text.Json`. Settings validation (drop, clamp, default), with tests.
3. [x] Step 1c: `CompatibilityChecker` driven by a `compat.json`, provisionally built from `cli/check.ts` lists.
4. [x] Step 2a: the build (`mod/build/build.ts`, TypeScript run by Node rather than `build.mjs`) checks catalogue ↔ code consistency; the mod loads `config.js`, falls back to compiled defaults, and was verified in the sim first (2026-10-17: read by the real menu, change applied by a hot reload, syntax error / wrong schema / missing file fall back to the defaults).
5. [x] Step 2a: the real `features.json` and JSON schemas for both files under `mod/schema/`; `compat.json` is owned by the mod and kept up to date by the build check as features are ported (steps 2b to 2d).
