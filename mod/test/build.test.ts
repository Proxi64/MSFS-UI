import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkCatalog, generateCatalogModule, kebabCase, type CatalogJson } from '../build/catalog.ts';
import { checkFeatureModules, checkModuleSyntax, checkSimReferences, checkSourceCharacters, type CompatJson } from '../build/checks.ts';

const catalog = (): CatalogJson => ({
  schemaVersion: 1,
  modVersion: '1.0.0',
  features: [
    {
      id: 'timeWheel',
      title: 'Wheel',
      description: 'd',
      screen: 'Free Flight',
      enabledByDefault: true,
      options: [
        { id: 'step', type: 'number', title: 'Step', description: 'd', default: 60, min: 10, max: 3600, step: 10, unit: 's' },
        { id: 'invert', type: 'boolean', title: 'Invert', description: 'd', default: false },
      ],
    },
    { id: 'tailNumber', title: 'Tail', description: 'd', screen: 'Aircraft selection', enabledByDefault: false, options: [] },
  ],
});

const compat = (): CompatJson => ({
  exports: [{ module: 'shared/utils.js', names: ['UniversalProxy'] }],
  screens: [{ label: 'Free Flight', guid: '{3C7A4EC5-E7F6-4761-B27F-A0EA89C0F081}', className: 'FreeFlightPageManipulator' }],
  components: [{ label: 'Tile', guid: '{68CB981E-3551-4AB9-8C2C-54470940600B}', name: 'TileButton', children: ['CornerWhite'] }],
  anchors: ['Search'],
  files: ['components/shared/resources/Icons/General/Selected.svg'],
  colorVariables: ['--colorPrimary'],
  translations: ['TT:MENU.OK'],
});

describe('checkCatalog', () => {
  it('accepts a consistent catalogue', () => {
    assert.deepEqual(checkCatalog(catalog()), []);
  });

  it('reports duplicate ids, ranges and defaults off the grid', () => {
    const bad = catalog();
    bad.features.push({ ...bad.features[1]! });
    const options = bad.features[0]!.options;
    options.push({ ...options[1]! });
    options.push({ id: 'a', type: 'number', title: 't', description: 'd', default: 1, min: 5, max: 2 });
    options.push({ id: 'b', type: 'number', title: 't', description: 'd', default: 9, min: 0, max: 5 });
    options.push({ id: 'c', type: 'number', title: 't', description: 'd', default: 15, min: 10, max: 30, step: 10 });
    assert.deepEqual(checkCatalog(bad), [
      'features.json: feature "tailNumber" is listed twice',
      'features.json: option "timeWheel.invert" is listed twice',
      'features.json: option "timeWheel.a" has min > max',
      'features.json: option "timeWheel.b" has its default outside its range',
      'features.json: option "timeWheel.c" has its default off its step grid',
    ]);
  });
});

describe('generateCatalogModule', () => {
  it('names the feature files in kebab case', () => {
    assert.equal(kebabCase('freeflightFavorites'), 'freeflight-favorites');
    assert.equal(kebabCase('aircraftGallery'), 'aircraft-gallery');
  });

  it('types the settings and lists the specs in catalogue order', () => {
    const module = generateCatalogModule(catalog());
    assert.match(module, /export const MOD_VERSION = "1\.0\.0";/);
    assert.match(module, /timeWheel: \{\n {4}enabled: boolean;\n {4}\/\*\* Step\. 10 to 3600 s\. \*\/\n {4}step: number;\n {4}\/\*\* Invert\. \*\/\n {4}invert: boolean;/);
    assert.match(module, /export const FEATURE_IDS: readonly FeatureId\[\] = \["timeWheel","tailNumber"\];/);
    assert.match(module, /"id": "invert",\n\s+"type": "boolean",\n\s+"default": false\n/);
    // Titles and descriptions stay in features.json: the mod only needs ids, types and ranges.
    assert.doesNotMatch(module, /"title"/);
  });
});

describe('checkFeatureModules', () => {
  const registry = (entries: string) => ['src/features.ts', `export const FEATURES = { ${entries} };`] as const;

  it('reports catalogue features without a module as not ported when their entry is null', () => {
    const files = new Map([registry('timeWheel: null, tailNumber: null')]);
    assert.deepEqual(checkFeatureModules(catalog(), files), { errors: [], notPorted: ['timeWheel', 'tailNumber'] });
  });

  it('accepts a module that reads every option, in a file or a folder', () => {
    const code = 'export function timeWheel(settings) { return settings.step + (settings.invert ? 1 : 0); }';
    const asFile = new Map([registry('timeWheel: timeWheel, tailNumber: null'), ['src/features/time-wheel.ts', code]]);
    assert.deepEqual(checkFeatureModules(catalog(), asFile).errors, []);
    const asFolder = new Map([
      registry('timeWheel: timeWheel, tailNumber: null'),
      ['src/features/time-wheel/index.ts', 'use(settings.step);'],
      ['src/features/time-wheel/invert.ts', 'use(settings.invert);'],
    ]);
    assert.deepEqual(checkFeatureModules(catalog(), asFolder).errors, []);
  });

  it('reports unread options, unknown modules and registry mismatches', () => {
    const files = new Map([
      registry('timeWheel: null, tailNumber: tailNumber'),
      ['src/features/time-wheel.ts', 'use(settings.step); use(stepInvert);'],
      ['src/features/old-thing.ts', ''],
    ]);
    assert.deepEqual(checkFeatureModules(catalog(), files).errors, [
      'src/features/old-thing.ts: no feature "old-thing" in features.json (feature modules are named after their id in kebab case)',
      'src/features.ts: "timeWheel" has a module but its registry entry is null',
      'src/features/time-wheel: option "timeWheel.invert" of features.json is never read (settings.invert)',
      'src/features.ts: "tailNumber" has no module under src/features/ but is not null',
    ]);
  });
});

describe('checkSimReferences', () => {
  it('accepts what compat.json lists', () => {
    const code = [
      "import { UniversalProxy, type ViewListener } from '/Global/shared/utils.js';",
      "onScreenActive('{3C7A4EC5-E7F6-4761-B27F-A0EA89C0F081}'); createComponent('{68CB981E-3551-4AB9-8C2C-54470940600B}');",
      "page.querySelector('[name=\"Search\"]'); translate('TT:MENU.OK'); '.x [name=\"CornerWhite\"] {}';",
      '.x { color: var(--colorPrimary); background: url("coui://html_UI/VFS/components/shared/resources/Icons/General/Selected.svg"); }',
    ].join('\n');
    assert.deepEqual(checkSimReferences(compat(), new Map([['src/a.ts', code]])), []);
  });

  it('reports what compat.json does not list', () => {
    const code = [
      "import { RegisterViewListener as listen } from '/Global/shared/utils.js';",
      "import { ReadableStore } from '/Global/shared/store.js';",
      "'{7822664D-7F34-4A46-904A-F82929865103}'; '[name=\"RightBlock\"]'; 'TT:MENU.CANCEL';",
      '.x { color: var(--colorSpecial); background: url("coui://html_UI/VFS/components/x.svg"); }',
    ].join('\n');
    assert.deepEqual(checkSimReferences(compat(), new Map([['src/a.ts', code]])), [
      'src/a.ts: screen or component {7822664D-7F34-4A46-904A-F82929865103} is used but not listed in compat.json',
      'src/a.ts: anchor RightBlock is used but not listed in compat.json',
      'src/a.ts: translation key TT:MENU.CANCEL is used but not listed in compat.json',
      'src/a.ts: sim file components/x.svg is used but not listed in compat.json',
      'src/a.ts: CSS variable --colorSpecial is used but not listed in compat.json',
      'src/a.ts: export of shared/utils.js RegisterViewListener is used but not listed in compat.json',
      'src/a.ts: export of shared/store.js ReadableStore is used but not listed in compat.json',
    ]);
  });

  it('ignores the generated catalogue', () => {
    assert.deepEqual(checkSimReferences(compat(), new Map([['src/generated/catalog.ts', "'TT:ANY.KEY'"]])), []);
  });
});

describe('syntax checks', () => {
  const separator = String.fromCharCode(0x2028);

  it('finds raw line separators in the sources', () => {
    const files = new Map([['src/a.ts', `ok\nconst s = "a${separator}b";`]]);
    assert.deepEqual(checkSourceCharacters(files), ['src/a.ts:2: raw U+2028 or U+2029 (build it with String.fromCharCode)']);
  });

  it('refuses an operator before await, but not elsewhere', () => {
    for (const line of ['if (!await x) {}', 'const n = -await x;', 'return typeof await x;', 'f(~await x);', 'y = void await x;']) {
      assert.equal(checkModuleSyntax(line).length, 1, line);
    }
    for (const line of ['const ok = await x;', 'if (!ok) {}', 'return await x;', 'a = b - await c;', '//# sourceMappingURL=data:,!await x']) {
      assert.deepEqual(checkModuleSyntax(line), [], line);
    }
  });
});
