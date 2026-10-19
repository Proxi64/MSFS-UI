# Golden fixtures

Expected outputs of the MSFS-UI 0.3.0 Node tool (`cli/package.ts`), used to prove that the C# package generation is equivalent. They were produced on 2026-10-16 from a fake `fs-base-ui` (the `MASTER_PAGE_HTML` of `cli/test-helpers.ts`, no sim file), by building a package with `buildPackage` and reading back its files.

| File | Content |
|---|---|
| `0.3.0/masterpage-input.html` | Fake MasterPage given to the tool |
| `0.3.0/masterpage-output.html` | Same component with the loader inserted |
| `0.3.0/masterpage-bom-crlf-input.html` / `-output.html` | Same, with a byte order mark and a final CRLF |
| `0.3.0/layout.json` | `layout.json` of the built package |
| `0.3.0/layout-entries.json` | The entries behind it: path, size and FILETIME read from the built files |
| `0.3.0/manifest.json` | `manifest.json` of the built package (title `MSFS-UI (personnel)` in 0.3.0) |

These files are marked `-text` in `.gitattributes`: Git must never change their line endings.
