import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { constrain, defaultSettings, resolveSettings, type FeatureSpec, type NumberOptionSpec } from '../src/core/settings.ts';

const CATALOG: FeatureSpec[] = [
  {
    id: 'fastMenus',
    enabledByDefault: true,
    options: [
      { id: 'speed', type: 'number', default: 2, min: 1, max: 4, step: 0.5 },
      { id: 'instantImages', type: 'boolean', default: true },
    ],
  },
  { id: 'tailNumber', enabledByDefault: false, options: [] },
];

const valid = () => ({
  schemaVersion: 1,
  features: { fastMenus: { enabled: false, speed: 3, instantImages: false }, tailNumber: { enabled: true } },
});

describe('defaultSettings', () => {
  it('gives every feature its enabled flag and option defaults', () => {
    assert.deepEqual(defaultSettings(CATALOG), {
      fastMenus: { enabled: true, speed: 2, instantImages: true },
      tailNumber: { enabled: false },
    });
  });
});

describe('resolveSettings', () => {
  it('takes valid settings as they are, without problems', () => {
    const result = resolveSettings(valid(), CATALOG);
    assert.deepEqual(result.problems, []);
    assert.equal(result.allDefaults, false);
    assert.deepEqual(result.values, valid().features);
  });

  for (const [label, raw] of [
    ['undefined', undefined],
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
  ] as const) {
    it(`gives the defaults for ${label}`, () => {
      const result = resolveSettings(raw, CATALOG);
      assert.equal(result.allDefaults, true);
      assert.deepEqual(result.values, defaultSettings(CATALOG));
      assert.equal(result.problems.length, 1);
    });
  }

  it('gives the defaults for another schema version', () => {
    const result = resolveSettings({ ...valid(), schemaVersion: 2 }, CATALOG);
    assert.equal(result.allDefaults, true);
    assert.match(result.problems[0]!, /schema version 2 instead of 1/);
  });

  it('gives the defaults without a feature table', () => {
    const result = resolveSettings({ schemaVersion: 1, features: [] }, CATALOG);
    assert.equal(result.allDefaults, true);
    assert.deepEqual(result.problems, ['no feature table']);
  });

  it('defaults a missing feature and reports it', () => {
    const raw = valid() as { features: Record<string, unknown> };
    delete raw.features.tailNumber;
    const result = resolveSettings(raw, CATALOG);
    assert.equal(result.allDefaults, false);
    assert.deepEqual(result.values.tailNumber, { enabled: false });
    assert.deepEqual(result.problems, ['feature "tailNumber" missing: defaults used']);
  });

  it('reports unknown features and options and ignores them', () => {
    const raw = valid() as { features: Record<string, Record<string, unknown>> };
    raw.features.oldFeature = { enabled: true };
    raw.features.fastMenus!.legacy = 1;
    const result = resolveSettings(raw, CATALOG);
    assert.deepEqual(result.problems, ['unknown feature "oldFeature" ignored', 'unknown option "fastMenus.legacy" ignored']);
    assert.equal('oldFeature' in result.values, false);
    assert.equal('legacy' in result.values.fastMenus!, false);
  });

  it('defaults values of the wrong type, one by one', () => {
    const raw = { schemaVersion: 1, features: { fastMenus: { enabled: 'yes', speed: '3', instantImages: 0 }, tailNumber: { enabled: true } } };
    const result = resolveSettings(raw, CATALOG);
    assert.deepEqual(result.values.fastMenus, { enabled: true, speed: 2, instantImages: true });
    assert.deepEqual(result.values.tailNumber, { enabled: true });
    assert.deepEqual(result.problems, [
      '"fastMenus.enabled" is not a boolean: default used',
      '"fastMenus.speed" is not a number: default used',
      '"fastMenus.instantImages" is not a boolean: default used',
    ]);
  });

  it('defaults missing options and non-finite numbers', () => {
    const raw = { schemaVersion: 1, features: { fastMenus: { enabled: true, speed: Infinity }, tailNumber: { enabled: true } } };
    const result = resolveSettings(raw, CATALOG);
    assert.deepEqual(result.values.fastMenus, { enabled: true, speed: 2, instantImages: true });
    assert.deepEqual(result.problems, ['"fastMenus.speed" is not a number: default used', '"fastMenus.instantImages" missing: default used']);
  });

  it('brings numbers into range and onto the grid, and reports it', () => {
    const raw = valid();
    raw.features.fastMenus.speed = 9;
    const result = resolveSettings(raw, CATALOG);
    assert.equal(result.values.fastMenus!.speed, 4);
    assert.deepEqual(result.problems, ['"fastMenus.speed" adjusted from 9 to 4 (range or step)']);
  });
});

describe('choice options', () => {
  const choices: FeatureSpec[] = [
    { id: 'aircraftGallery', enabledByDefault: true, options: [{ id: 'layout', type: 'choice', default: 'classic', choices: ['classic', 'sideBySide'] }] },
  ];
  const settings = (layout: unknown) => ({ schemaVersion: 1, features: { aircraftGallery: { enabled: true, layout } } });

  it('defaults to the catalogue default', () => {
    assert.deepEqual(defaultSettings(choices), { aircraftGallery: { enabled: true, layout: 'classic' } });
  });

  it('keeps a choice that is one of its ids', () => {
    const result = resolveSettings(settings('sideBySide'), choices);
    assert.equal(result.values.aircraftGallery!.layout, 'sideBySide');
    assert.deepEqual(result.problems, []);
  });

  it('defaults an unknown choice or another type, and reports it', () => {
    for (const value of ['stacked', 3]) {
      const result = resolveSettings(settings(value), choices);
      assert.equal(result.values.aircraftGallery!.layout, 'classic');
      assert.deepEqual(result.problems, ['"aircraftGallery.layout" is not one of its choices: default used']);
    }
  });
});

describe('constrain (same results as MsfsUi.Core SettingsNormalizer.Constrain)', () => {
  const speed: NumberOptionSpec = { id: 'speed', type: 'number', default: 2, min: 1, max: 4, step: 0.5 };
  const cases: [NumberOptionSpec, number, number][] = [
    [speed, 2, 2],
    [speed, 2.3, 2.5],
    [speed, 2.2, 2],
    [speed, 2.25, 2.5], // halfway: away from zero
    [speed, 0, 1],
    [speed, -7, 1],
    [speed, 4.2, 4],
    [speed, 100, 4],
    // The range is not a whole number of steps: the top is the last grid point below the maximum.
    [{ id: 'x', type: 'number', default: 0, min: 0, max: 10, step: 3 }, 10, 9],
    // Decimal steps stay exact.
    [{ id: 'x', type: 'number', default: 0, min: 0, max: 1, step: 0.1 }, 0.3, 0.3],
    // No step: clamped only.
    [{ id: 'x', type: 'number', default: 0, min: -5, max: 5 }, 2.345, 2.345],
    [{ id: 'x', type: 'number', default: 0, min: -5, max: 5 }, -9, -5],
  ];
  for (const [option, value, expected] of cases) {
    it(`${value} in [${option.min}, ${option.max}] step ${option.step ?? 'none'} → ${expected}`, () => {
      assert.equal(constrain(option, value), expected);
    });
  }
});
