# Aircraft Selection Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A *Side by side* layout of the aircraft selection (aircraft on the left half of the gallery, the current aircraft's liveries as large tiles on the right half), chosen in MSFS-UI-GENERATOR through a new *choice* option type; *Classic* stays the default.

**Architecture:** The *choice* type is added to the shared contract on both readers (mod build and settings validation; `MsfsUi.Core` and the Features page). The setup panel's configurator logic moves to `mod/src/sim/configurator.ts` so that the panel and a new livery column share it. The gallery, when its `layout` option is `sideBySide`, narrows its list to the left half and mounts the livery column on the right half; a flag in `mod/src/sim/selection-layout.ts` tells the setup panel to drop its thumbnails meanwhile.

**Tech Stack:** TypeScript 7 (ES2017 output, esbuild, `node:test`) for the mod; C# / .NET 10, WinUI 3, MSTest, UI Automation for the app.

**Spec:** [docs/superpowers/specs/2026-10-27-aircraft-selection-layouts-design.md](../specs/2026-10-27-aircraft-selection-layouts-design.md)

## Global Constraints

- Everything written in English (code, comments, logs, UI texts, docs, commit messages).
- ES2017, no operator before `await`, no raw U+2028 / U+2029; the build refuses them.
- Every visible element is a sim component (`createComponent`), every list that scrolls the sim's `real-scroll`; every sim reference declared in `mod/compat.json` (the build says which is missing).
- Every change to the sim goes through a `Scope` and is undone on dispose.
- App: nullable, warnings as errors, analyzers `latest-recommended`, `generator/.editorconfig`; public API of `MsfsUi.Core` documented; `x:Bind` with an explicit `Mode`; texts in `Strings/en-us/Resources.resw` when not from the catalogue; every focusable element with a stable `AutomationId`.
- After the change of `mod/features.json`: `MSFS_UI_UPDATE_FIXTURES=1 dotnet test generator/MsfsUi.slnx`, then `npm run check` in `mod/`.
- Commits: one per design step (1: choice type; 2: shared configurator logic; 3: the layout; 4: docs), each after the owner validated the step; never push. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- *Classic* users see no change: default `classic`, and in *Classic* no code path of the setup panel or gallery changes behaviour.

## Review Focus

1. Switching the gallery to the *Default* view and back in *Side by side*: the livery column hides and the setup panel gets its thumbnails back, then the reverse (Task 6, step "measure the views").
2. A livery click right after coming back to the aircraft selection (configurator released): the aircraft must stay valid; the guard of `chooseLivery` reloads instead (Task 3 keeps the guard; Task 6, step "released configurator").
3. An aircraft with more than a hundred liveries: only the tiles near the visible part get components, and scrolling creates the next ones (Task 6, step "many liveries").
4. Leaving the screen, turning the feature off or reloading the mod: the flag is cleared, the setup panel shows its thumbnails, the sim's right block is visible again (Task 6, step "leave and reload").
5. A settings file without `layout` (older app) or with an unknown value (`"stacked"`): *Classic*, with one adjustment reported by the app and one problem logged by the mod (Tasks 1 and 2 tests).

---

## Design step 1: the *choice* option type

### Task 1: *choice* in the mod's contract (schema, build, settings)

**Files:**
- Modify: `mod/schema/features.schema.json` (option `type` enum, a third `oneOf` branch)
- Modify: `mod/build/catalog.ts` (`ChoiceOptionJson`, `checkCatalog`, `generateCatalogModule`)
- Modify: `mod/src/core/settings.ts` (`OptionValue`, `ChoiceOptionSpec`, `resolveOption`)
- Test: `mod/test/settings.test.ts`, `mod/test/build.test.ts`

**Interfaces:**
- Produces (settings.ts): `type OptionValue = boolean | number | string`; `interface ChoiceOptionSpec { readonly id: string; readonly type: 'choice'; readonly default: string; readonly choices: readonly string[] }`; `type OptionSpec = BooleanOptionSpec | NumberOptionSpec | ChoiceOptionSpec`.
- Produces (catalog.ts): `interface ChoiceOptionJson { id; type: 'choice'; title; description; default: string; choices: { id: string; title: string; description?: string }[] }`; in the generated `Settings`, a choice option is typed as the union of its ids, e.g. `layout: 'classic' | 'sideBySide';`; in `CATALOG`, `{ id, type: 'choice', default, choices: ['classic', 'sideBySide'] }` (ids only).

- [ ] **Step 1: Write the failing tests**

In `settings.test.ts`, extend the test catalogue with `{ id: 'layout', type: 'choice', default: 'classic', choices: ['classic', 'sideBySide'] }` on a feature `aircraftGallery` (and its value in `valid()`), then add:

```ts
it('keeps a choice that is one of its ids', () => {
  const raw = valid();
  raw.features.aircraftGallery.layout = 'sideBySide';
  assert.equal(resolveSettings(raw, CATALOG).values.aircraftGallery!.layout, 'sideBySide');
});

it('defaults an unknown choice and reports it', () => {
  const raw = valid();
  (raw.features.aircraftGallery as Record<string, unknown>).layout = 'stacked';
  const result = resolveSettings(raw, CATALOG);
  assert.equal(result.values.aircraftGallery!.layout, 'classic');
  assert.deepEqual(result.problems, ['"aircraftGallery.layout" is not one of its choices: default used']);
});
```

In `build.test.ts`: `checkCatalog` reports `features.json: option "f.layout" has its default outside its choices` (default `'x'`), `... has fewer than two choices` (one choice) and `... lists choice "a" twice`; `generateCatalogModule` writes `layout: 'classic' | 'sideBySide';` and `"choices": ["classic", "sideBySide"]` in `CATALOG`.

- [ ] **Step 2: Run the tests, they fail**

Run: `cd mod; node --test test/settings.test.ts test/build.test.ts`
Expected: FAIL (choice options unknown to `resolveOption`, `checkCatalog`, the generator).

- [ ] **Step 3: Implement**

`resolveOption`: a choice takes a string that is in `choices`, otherwise its default with the problem text above. `checkCatalog`: the three rules above. `generateCatalogModule`: the union type from `choices[].id` (JSON-quoted), `CATALOG` with the ids only. Schema: `"type": { "enum": ["boolean", "number", "choice"] }` and a branch `{ "required": ["choices"], "properties": { "type": { "const": "choice" }, "id": true, "title": true, "description": true, "default": { "$ref": "#/$defs/identifier" }, "choices": { "type": "array", "minItems": 2, "items": { "type": "object", "required": ["id", "title"], "additionalProperties": false, "properties": { "id": { "$ref": "#/$defs/identifier" }, "title": { "$ref": "#/$defs/text" }, "description": { "$ref": "#/$defs/text" } } } } }, "additionalProperties": false }`. The catalogue's description in the schema mentions "default one of the choices" among the rules checked by both readers.

- [ ] **Step 4: Run the mod's checks, they pass**

Run: `cd mod; npm run check`
Expected: build OK (`features: 7/7 ported`), every test passes.

### Task 2: *choice* in `MsfsUi.Core`

**Files:**
- Modify: `generator/MsfsUi.Core/Features/FeatureCatalog.cs` (`OptionType.Choice`, `ChoiceDefinition`, `OptionDefinition.Choices`, `DefaultValue`, `Validate`)
- Modify: `generator/MsfsUi.Core/Features/FeatureSettings.cs` (`OptionValue.Text`, `FromChoice`, `ToString`, `ToJsonElement`, `[JsonSerializable(typeof(string))]`)
- Modify: `generator/MsfsUi.Core/Features/SettingsNormalizer.cs` (`Resolve`)
- Modify: `generator/MsfsUi.Core/Features/ConfigScript.cs` (`WriteString`)
- Test: `generator/MsfsUi.Core.Tests/Features/FeatureTestData.cs`, `FeatureCatalogTests.cs`, `SettingsAndConfigScriptTests.cs`

**Interfaces:**
- Consumes: the JSON shape of Task 1.
- Produces: `OptionType.Choice` (`[JsonStringEnumMemberName("choice")]`); `public sealed record ChoiceDefinition(string Id, string Title, string? Description = null);` `OptionDefinition(..., IReadOnlyList<ChoiceDefinition>? Choices = null)` (last parameter); `OptionValue.FromChoice(string id)`, `OptionValue.Text` (the choice id; empty for the other types).

- [ ] **Step 1: Write the failing tests**

`FeatureTestData.Catalog`: add on `fastMenus` an option `{ "id": "layout", "type": "choice", "title": "Layout", "description": "How things are laid out.", "default": "classic", "choices": [ { "id": "classic", "title": "Classic" }, { "id": "sideBySide", "title": "Side by side", "description": "Two columns." } ] }` (and fix the assertions that count options).

Tests:
- `Parse` reads the choices (`Choices.Count == 2`, `DefaultValue == OptionValue.FromChoice("classic")`);
- `Parse` throws `InvalidFeatureCatalogException` for a default not in the choices, one choice only, a duplicate choice id, no `choices`;
- `Normalize` keeps `"sideBySide"`; an unknown `"stacked"` and a number `3` give `classic` with the adjustment `Option 'fastMenus.layout' is not one of its choices: default used.`; a missing value gives `classic` without adjustment;
- `ToSettings` then `TryParse` then `Normalize` round-trips `"sideBySide"`;
- `ConfigScript.Generate` writes `"layout": "sideBySide"`.

- [ ] **Step 2: Run the tests, they fail**

Run: `dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"`
Expected: FAIL (build error on the new members, then failing assertions).

- [ ] **Step 3: Implement**

`Validate`: for `Choice`, a string default that is one of at least two choices, unique non-empty ids and titles (messages in the style of the existing ones). `Resolve`: a JSON string among the ids, otherwise the default and the adjustment above. `ToJsonElement` and `ConfigScript` write the id as a string. XML documentation on every new public member.

- [ ] **Step 4: Run the tests, they pass**

Run: `dotnet build generator/MsfsUi.slnx` then `dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"`
Expected: build without warnings; all non-UI tests pass (the real catalogue has no choice option yet: fixtures unchanged).

- [ ] **Step 5: Owner validates step 1, then commit**

```
git add mod/schema mod/build/catalog.ts mod/src/core/settings.ts mod/test generator/MsfsUi.Core generator/MsfsUi.Core.Tests
git commit -F <message file>   # "Contract: choice option type", body: what both readers accept and the default rule
```

The Features page learns the type in Task 5, with the first option that uses it (the app's UI tests run on the real catalogue, which has none before).

---

## Design step 2: the configurator logic shared

### Task 3: `mod/src/sim/configurator.ts`

**Files:**
- Create: `mod/src/sim/configurator.ts`
- Modify: `mod/src/features/aircraft-setup/panel.ts` (uses it; its `ConfiguratorItem`, `ConfiguratorDetails`, `canApply`, `chooseVariant`, `chooseLivery`, `setFavoriteLivery`, `isFavorite` and the reading in `reload` move out)
- Test: `mod/test/configurator.test.ts`

**Interfaces:**
- Consumes: `syncConfiguratorToCurrent`, `ConfiguratorLivery` (`sim/aircraft-loading.ts`); `loadFavoriteLiveries`, `saveFavoriteLiveries`, `findFavoriteLivery`, `FavoriteLivery` (`sim/favorites.ts`); `liveryKey`, `variationOf` (`sim/liveries.ts`).
- Produces:
  - `interface ConfiguratorItem { id: string; title: string; isSelected: boolean; isDisabled: boolean }`
  - `interface ConfiguratorDetails { variationId: string; displayName: string; creator: string }`
  - `interface ConfiguratorState { variants: ConfiguratorItem[]; liveries: ConfiguratorLivery[]; details: ConfiguratorDetails | null; variationTitle: string }` (`variationTitle`: the selected variant's title when there are several, else `''`)
  - `readConfigurator(): Promise<ConfiguratorState>`
  - `chooseVariant(state: ConfiguratorState, id: string): Promise<boolean>` and `chooseLivery(state: ConfiguratorState, id: string): Promise<boolean>`: false when ignored (already selected, unavailable, or the guard failed: the caller reloads)
  - `isFavoriteLivery(livery: ConfiguratorLivery, favorites: readonly FavoriteLivery[]): boolean`
  - `withFavoriteLivery(favorites: readonly FavoriteLivery[], livery: ConfiguratorLivery, on: boolean, state: ConfiguratorState, now: number): FavoriteLivery[] | null` (pure; null when nothing changes)
  - `setFavoriteLivery(state: ConfiguratorState, id: string, on: boolean): void` (loads, `withFavoriteLivery`, saves)

- [ ] **Step 1: Write the failing tests** (`configurator.test.ts`, pure parts only)

```ts
const state = { variants: [], liveries: [], details: { variationId: 'v1', displayName: 'Phenom 300E', creator: 'FSReborn' }, variationTitle: 'Manchester Interior' };
const red = { id: 'v1:2', title: 'Red', imageUrl: 'r.png', directoryPath: String.raw`SimObjects\Airplanes\P\liveries\x\Red`, isSelected: true };

it('adds a favourite livery with its aircraft and variant, used now when selected', () => {
  const next = withFavoriteLivery([], red, true, state, 1000)!;
  assert.deepEqual(next, [{ variationId: 'v1', dir: 'simobjects/airplanes/p/liveries/x/red', title: 'Red', image: 'r.png', displayName: 'Phenom 300E', creator: 'FSReborn', variation: 'Manchester Interior', usedAt: 1000 }]);
});
it('removes it, and changes nothing when already in that state', () => {
  const one = withFavoriteLivery([], red, true, state, 1000)!;
  assert.deepEqual(withFavoriteLivery(one, red, false, state, 2000), []);
  assert.equal(withFavoriteLivery(one, red, true, state, 2000), null);
  assert.equal(withFavoriteLivery([], { ...red, directoryPath: '' }, true, state, 2000), null);
});
it('leaves aircraft details out when the configurator is on another variant', () => {
  const next = withFavoriteLivery([], { ...red, id: 'v2:0' }, true, state, 1000)!;
  assert.equal(next[0]!.displayName, undefined);
});
```

(The expected `dir` is whatever `liveryKey` returns for that path; check it in `liveries.test.ts` and copy it.)

- [ ] **Step 2: Run them, they fail**

Run: `cd mod; node --test test/configurator.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `configurator.ts` and make `panel.ts` use it**

The bodies are those of the panel today (`canApply`'s log line kept: `choice ignored (configurator on …, item of …)`); `chooseVariant` checks against the selected variant's id as `chooseVariant` in the panel does. The panel keeps its own `scheduleReload` and calls it when a choice returns false. No change of behaviour.

- [ ] **Step 4: Run the checks and verify in the sim**

Run: `cd mod; npm run check`, then `& $dev install; & $dev reload` (sim running).
Expected: all tests pass; in the sim, on the aircraft selection: a click on a variant then on a livery thumbnail changes them, a heart adds and removes a favourite livery, the Free Flight favourites follow; `& $dev console "[msfs-ui]"` shows no error.

- [ ] **Step 5: Owner validates step 2, then commit** (`Setup panel: configurator logic in sim/configurator.ts`)

---

## Design step 3: the side by side layout

### Task 4: pure parts of the livery column

**Files:**
- Create: `mod/src/features/aircraft-gallery/livery-column.ts` (pure)
- Test: `mod/test/aircraft-gallery.test.ts`

**Interfaces:**
- Produces:
  - `splitColumns(width: number, gap: number): { left: number; right: number }`: whole pixels, `left = floor((width - gap) / 2)`, `right = width - gap - left`
  - `liveryTileSize(column: number, room: number, gap: number, banner: number): { width: number; imageHeight: number; height: number }`: two per row in `column - room` (room: scroll bar room), `width = floor((column - room - gap) / 2)`, `imageHeight = round(width * 344 / 720)`, `height = imageHeight + round(banner)`
  - `liveryTail(chosen: string | undefined, atcId: string | null, title: string, maxLength: number): string`: the first valid of the chosen number, the `atc_id`, a registration in the title (`pickRegistration` order of `features/tail-number.ts`), else `''`

Two calls settled here. The spec lists "name, then `livery.cfg`" but asks for "the number the mod would apply": `features/tail-number.ts` tries `atc_id` before the name, so this order is kept. The spec's case "Tail number per livery off" is not handled: the gallery only receives its own settings, and the chosen numbers are the user's own; they show in both cases.

- [ ] **Step 1: Write the failing tests**

```ts
it('splits the gallery in two columns of whole pixels', () => {
  assert.deepEqual(splitColumns(1614, 16), { left: 799, right: 799 });
  assert.deepEqual(splitColumns(1615, 16), { left: 799, right: 800 });
});
it('sizes two livery tiles per row in the thumbnails ratio', () => {
  // 3440 x 1440: unit 4/3; room 24 units = 32 px, gap 12 units = 16 px, banner 54 units = 72 px.
  assert.deepEqual(liveryTileSize(799, 32, 16, 72), { width: 375, imageHeight: 179, height: 251 });
});
it('shows the tail number the mod would apply', () => {
  assert.equal(liveryTail('F-TEST', 'VH-OZG', 'Qantas VH-ABC', 9), 'F-TEST');
  assert.equal(liveryTail(undefined, 'VH-OZG', 'Qantas VH-ABC', 9), 'VH-OZG');
  assert.equal(liveryTail(undefined, null, 'Qantas VH-ABC', 9), 'VH-ABC');
  assert.equal(liveryTail(undefined, null, 'FSReborn Livery', 9), '');
});
```

- [ ] **Step 2: Run them, they fail** (`node --test test/aircraft-gallery.test.ts`: module not found)
- [ ] **Step 3: Implement** the three functions (`liveryTail` uses `pickRegistration` and `registrationFromName` of `sim/registration.ts`)
- [ ] **Step 4: Run them, they pass**

### Task 5: the `layout` option, end to end in the app

**Files:**
- Modify: `mod/features.json` (option `layout` on `aircraftGallery`, the JSON of the spec, word for word)
- Modify: `mod/src/features/aircraft-gallery/index.ts` (reads `settings.layout`, passes it to `new Gallery(page, screen, settings.layout)`; logs `aircraft gallery in the aircraft selection, side by side layout` when `sideBySide`)
- Modify: `mod/src/features/aircraft-gallery/gallery.ts` (constructor parameter `layout: Settings['aircraftGallery']['layout']`, stored; used in Task 6)
- Modify: `generator/MsfsUi.App/ViewModels/FeatureItemViewModel.cs` (`OptionItemViewModel.IsChoice`, `Choices`, `SelectedChoiceIndex`, `ChoiceDescription`; `ChoiceItemViewModel`)
- Modify: `generator/MsfsUi.App/Pages/FeaturesPage.xaml` (a `RadioButtons` in `OptionTemplate`)
- Modify: `generator/MsfsUi.Core.Tests/Contracts/ModContractTests.cs` (custom fixture with `"aircraftGallery": { "options": { "layout": "sideBySide" } }`), `mod/test/config-contract.test.ts` (expects `layout: 'sideBySide'` from the custom fixture, `'classic'` from the defaults)
- Regenerate: `mod/test/fixtures/config.defaults.js`, `config.custom.js`
- Test: `generator/MsfsUi.App.UITests/AppTests.cs`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `ChoiceItemViewModel(string Id, string Title, string AutomationId)` with `AutomationId = $"Choice_{featureId}_{optionId}_{choiceId}"`; the option's `RadioButtons` keeps the option's `AutomationId` (`Option_aircraftGallery_layout`).

A `RadioButtons` rather than the spec's `ComboBox` (a call of the spec, settled here): its `ItemTemplate` can be a `RadioButton` with an `x:Bind` `AutomationId` per choice, which a `ComboBoxItem` cannot get without a style binding; with two to four choices, all are visible at once.

- [ ] **Step 1: Write the failing UI test**

```csharp
[TestMethod]
public void FeaturesSaveTheChosenLayout()
{
    using var app = AppSession.Start();
    app.Navigate("NavFeatures");
    AppSession.Expand(app.FindByName("Aircraft gallery and list", "Expander"));
    app.Navigate("Choice_aircraftGallery_layout_sideBySide");   // SelectionItemPattern.Select
    app.Invoke("FeaturesApply");
    app.WaitForText("FeaturesMessage", "Settings applied");
    StringAssert.Contains(File.ReadAllText(Path.Combine(app.DataRoot, "settings.json")), "\"layout\": \"sideBySide\"");
}
```

- [ ] **Step 2: Add the option to `features.json`, read it in the mod, regenerate the fixtures**

Run: `cd mod; npm run check` (builds: the gallery reads `settings.layout`), then `$env:MSFS_UI_UPDATE_FIXTURES=1; dotnet test generator/MsfsUi.slnx --filter "TestCategory!=UI"; Remove-Item Env:MSFS_UI_UPDATE_FIXTURES`, then `npm run check` again.
Expected: fixtures rewritten with `"layout": "classic"` / `"sideBySide"`; mod tests pass. The UI test still fails (no template).

- [ ] **Step 3: The view model and the template**

`OptionTemplate` gets, in column 1, a `RadioButtons` (`Visibility="{x:Bind IsChoice, Mode=OneTime}"`, `ItemsSource="{x:Bind Choices, Mode=OneTime}"`, `SelectedIndex="{x:Bind SelectedChoiceIndex, Mode=TwoWay}"`, `AutomationId` and `Name` as the other controls) whose `ItemTemplate` is a `RadioButton` bound `OneTime` to `Title` and `AutomationId`; the selected choice's description shows under the option's own (`ChoiceDescription`, `OneWay`). `Load` / `ToChoice` handle `OptionType.Choice` with `OptionValue.FromChoice`; `OnSelectedChoiceIndexChanged` calls `_changed()`.

- [ ] **Step 4: Run every test**

Run: `dotnet build generator/MsfsUi.slnx; dotnet test generator/MsfsUi.slnx`
Expected: no warning; every test passes, the new UI test included.

### Task 6: the livery column, the split gallery, the setup panel following

**Files:**
- Create: `mod/src/sim/selection-layout.ts`
- Create: `mod/src/features/aircraft-gallery/liveries.ts` (`LiveryColumn`)
- Modify: `mod/src/features/aircraft-gallery/gallery.ts` (`layout()`, mount of the column, the flag)
- Modify: `mod/src/features/aircraft-gallery/aircraft-gallery.css` (column, tiles)
- Modify: `mod/src/features/aircraft-setup/panel.ts` (`layoutLists` without liveries while the flag is set)
- Modify: `mod/compat.json` only if the build asks for a reference

**Interfaces:**
- Consumes: Task 3 (`readConfigurator`, `chooseLivery`, `setFavoriteLivery`, `isFavoriteLivery`), Task 4 (`splitColumns`, `liveryTileSize`, `liveryTail`), `orderLiveries` (`features/aircraft-setup/livery-order.ts`), `revealPosition` and `Rows` (`features/aircraft-setup/setup-layout.ts`), `COMPONENTS.fleetTile`, `COMPONENTS.wishlistButton`.
- Produces: `setLiveriesInGallery(shown: boolean): void`, `liveriesInGallery(): boolean` (module state, false at load); `class LiveryColumn { constructor(page: Manipulator, scope: Scope, parent: HTMLElement); place(rect: { left: number; top: number; width: number; height: number } | null): void }` (`null` hides it).

- [ ] **Step 1: `selection-layout.ts`, and the setup panel follows it**

`layoutLists` (panel.ts): when `liveriesInGallery()`, the livery header and list get `display: none`, the room counts only the variant header, the tail row and the buttons with three gaps, and the liveries count as zero rows; the class `is-without-liveries` on the root marks it. Otherwise unchanged.

- [ ] **Step 2: `LiveryColumn`**

Header (`msfs-ui-header`: `translate('TT:GENERIC.LIVERY')`, then the current or hovered livery's title) and a `real-scroll` of tiles. Each tile: a host with `marquee__trigger`, a `TileButton_Fleet` (`AircraftImage` = `imageUrl`, `AircraftName` = translated title, `Subtitle` = `liveryTail(...)`, `Distance` = `''`) whose `tileClick` / `tileHover` without data are stopped at the host as in the gallery, and a `IconButton_Light_Wishlist`; components created within 300 units of the visible part (as `Gallery.materialize`). Order: `orderLiveries` with favourites first. Selection, `is-disabled` dimming and hearts as in the setup panel. A click: `chooseLivery(state, id)`, reload when false. Reload (80 ms debounce) on `Configurator.Details`, `CurrentAircraft` and `FAVORITE_LIVERIES_CHANGED`; on a new variant the list opens on the selected livery (`revealPosition`). `livery.cfg` of the tiles in view read once each (`fetch('coui://html_ui/VFS/' + directoryPath with '/' + '/livery.cfg')`), the tail line redrawn when it arrives; chosen numbers from `loadLiveryTails()[liveryKey(directoryPath)]`. Between two aircraft (no liveries) the header stays and the list is empty.

- [ ] **Step 3: The gallery splits in *Side by side***

In `layout()`, when `layout === 'sideBySide'` and the view is not `stock`: `splitColumns(rect.width, 12 * unit)`; the body's width is `left`; the column is placed at `left + gap`, under the bar, `right` wide, down to the bottom of the right block; `setLiveriesInGallery(true)`. Otherwise `column.place(null)` and `setLiveriesInGallery(false)`. `scope.add(() => setLiveriesInGallery(false))`. The gallery's tile columns follow the narrower body by themselves (`content.clientWidth`).

- [ ] **Step 4: Build, install, measure in the sim** (settings with `"aircraftGallery": { "options": { "layout": "sideBySide" } }` through `& $dev install --settings <file>`)

Run: `cd mod; npm run check`, install, `& $dev reload`; on the aircraft selection, measure with `& $dev eval @<script>`:
- the two columns: same top (12 units under the bar), whole-pixel widths, the column's right edge on the right block's; on 3440 × 1440, tiles about 375 px wide with images of the 720 × 344 ratio;
- the Phenom 300E: 27 tiles, favourites first, the current one selected, tail line filled (at least the chosen number);
- **measure the views**: Default view → no column, `.msfs-ui-setup__liveries` displayed; Gallery and List → column back, setup panel without liveries;
- **released configurator**: leave to the main menu, come back, click a livery at once → `CurrentAircraft.isValid` stays true;
- **many liveries**: on the aircraft with the most liveries, created components ≤ tiles near the view; scroll to the bottom, the last tiles get theirs;
- **leave and reload**: leave the screen, then `& $dev reload` → no `.msfs-ui-gal`, the right block visible, `liveriesInGallery()` false (through `window.__msfsUiRuntime` or the panel showing its thumbnails on return);
- `& $dev check`: every check passes; `& $dev console "[msfs-ui]"`: no error.
Then ask the owner for a screenshot.

- [ ] **Step 5: Owner validates step 3, then commit** (`Aircraft gallery: side by side layout`), Tasks 4 to 6 together.

---

## Design step 4: documents and version

### Task 7: documents

**Files:**
- Modify: `docs/user-guide.md` (gallery section: the *Layout* option and the side by side layout; setup panel: no thumbnails in that layout)
- Modify: `mod/README.md` (folder map: `livery-column.ts`, `liveries.ts`, `sim/configurator.ts`, `sim/selection-layout.ts`; the components list: `TileButton_Fleet` as a livery tile)
- Modify: `docs/development.md` (Contracts: the *choice* type on both readers)
- Modify: `docs/next-steps.md` (1.7 done; the Maintenance *choice* row done), `CLAUDE.md` (progress row)
- Version 1.1.0 only if the owner agrees: `modVersion` in `mod/features.json`, `version` in `mod/package.json`, `<Version>` in `generator/Directory.Build.props`, then the fixtures again

- [ ] **Step 1: Write the documents; run `npm run check` and `dotnet test generator/MsfsUi.slnx`**
- [ ] **Step 2: Owner validates, then commit** (`Docs: aircraft selection layouts`)
