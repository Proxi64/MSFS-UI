import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { HIDDEN_AIRCRAFT_CHANGED, isHidden, loadHidden, saveHidden, withHidden, withVariationIds, type HiddenAircraft } from '../src/sim/hidden.ts';
import { learnVariantGroup, loadVariantGroups, sameVariantGroup, VARIANT_GROUPS_CHANGED, variantGroupsFrom, withVariantGroup } from '../src/sim/variant-groups.ts';

const vision: HiddenAircraft = { displayName: 'Vision Jet G2', creator: 'Working Title' };
const cessna: HiddenAircraft = { displayName: 'Cessna 172 Skyhawk', creator: 'Asobo' };

describe('hidden aircraft list', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it('adds and removes an aircraft by name and publisher', () => {
    const added = withHidden([cessna], vision, true);
    assert.deepEqual(added, [cessna, vision]);
    assert.deepEqual(withHidden(added!, { displayName: 'Vision Jet G2', creator: 'Working Title' }, false), [cessna]);
  });

  it('returns null when nothing changes', () => {
    assert.equal(withHidden([vision], vision, true), null);
    assert.equal(withHidden([cessna], vision, false), null);
  });

  it('matches the same name and publisher, not the same name of another publisher', () => {
    assert.equal(isHidden([vision], { displayName: 'Vision Jet G2', creator: 'Working Title' }), true);
    assert.equal(isHidden([vision], { displayName: 'Vision Jet G2', creator: 'Other' }), false);
    assert.equal(isHidden([], vision), false);
  });

  // The 146-200's entry reads "146-200", "146-200QC" or "146-200QT" after its variant, even its aircraftId changes
  // (measured on 1.9.21, 2026-11-02): only the configurator's group of variants ties them.
  const qc = { displayName: 'Just Flight 146-200QC', creator: 'Just Flight', variationId: 'qc' };
  const airCal = { displayName: 'Just Flight 146-200', creator: 'Just Flight', variationId: 'aircal' };
  const groups = [['aircal', 'qc', 'qt']];

  it('keeps the variant an aircraft was hidden on, and finds it under the name of another variant of its group', () => {
    const hidden = withHidden([], qc, true)!;
    assert.deepEqual(hidden, [{ displayName: 'Just Flight 146-200QC', creator: 'Just Flight', variationId: 'qc' }]);
    assert.equal(isHidden(hidden, airCal, groups), true, 'another variant of its group');
    assert.equal(isHidden(hidden, airCal), false, 'without its group, the name alone: the defect of 2.1.0');
    assert.equal(isHidden(hidden, { ...airCal, variationId: 'other' }, groups), false, 'a variant of no group');
    assert.deepEqual(withHidden(hidden, airCal, false, groups), [], 'shown again from its other name');
  });

  it('gives a variant id to the aircraft hidden by name, as the list shows them', () => {
    const old = [{ displayName: 'Just Flight 146-200QC', creator: 'Just Flight' }, cessna];
    assert.deepEqual(withVariationIds(old, [airCal, qc]), [{ displayName: 'Just Flight 146-200QC', creator: 'Just Flight', variationId: 'qc' }, cessna]);
    assert.equal(withVariationIds(old, [airCal]), null, 'not in the list under its name: unchanged');
    assert.equal(withVariationIds([qc], [qc]), null);
  });

  it('ignores a stored value that is not a list of name and publisher', () => {
    const data = new Map<string, string>();
    const withVariant = { displayName: 'a', creator: 'b', variationId: 'v' };
    data.set('MSFS_UI_HIDDEN_AIRCRAFT', JSON.stringify([vision, null, 3, { displayName: 'x' }, { displayName: 1, creator: 'y' }, cessna, withVariant, { displayName: 'c', creator: 'd', variationId: 5 }]));
    (globalThis as { window?: unknown }).window = { datastorage: { getData: (key: string) => data.get(key), setData: () => undefined, deleteData: () => undefined }, top: null };
    assert.deepEqual(loadHidden(), [vision, cessna, withVariant, { displayName: 'c', creator: 'd' }]);
    data.set('MSFS_UI_HIDDEN_AIRCRAFT', '{"a":1}');
    assert.deepEqual(loadHidden(), []);
  });

  it('saves under MSFS_UI_HIDDEN_AIRCRAFT and sends the event', () => {
    const data = new Map<string, string>();
    const datastorage = {
      getData: (key: string) => data.get(key),
      setData: (key: string, value: string) => data.set(key, value),
      deleteData: (key: string) => data.delete(key),
    };
    (globalThis as { window?: unknown }).window = { datastorage, top: null };
    const events: string[] = [];
    (globalThis as { document?: unknown }).document = { dispatchEvent: (event: { type: string }) => events.push(event.type) };
    saveHidden([vision]);
    assert.equal(data.get('MSFS_UI_HIDDEN_AIRCRAFT'), JSON.stringify([vision]));
    assert.deepEqual(events, [HIDDEN_AIRCRAFT_CHANGED]);
    assert.deepEqual(loadHidden(), [vision]);
  });
});

describe('groups of variants', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it('ties two variant ids of one group, or the same id', () => {
    const groups = [['a', 'b'], ['c', 'd']];
    assert.equal(sameVariantGroup(groups, 'a', 'b'), true);
    assert.equal(sameVariantGroup(groups, 'a', 'a'), true);
    assert.equal(sameVariantGroup(groups, 'a', 'c'), false);
    assert.equal(sameVariantGroup(groups, undefined, 'a'), false);
    assert.equal(sameVariantGroup([], 'x', 'x'), true);
  });

  it('adds a group in place of one sharing a variant (the aircraft updated), not twice', () => {
    assert.deepEqual(withVariantGroup([['a', 'b'], ['c', 'd']], ['b', 'a', 'e']), [['c', 'd'], ['b', 'a', 'e']]);
    assert.equal(withVariantGroup([['a', 'b']], ['b', 'a']), null, 'already there');
    assert.equal(withVariantGroup([], ['a']), null, 'one variant');
    assert.equal(withVariantGroup([], ['a', 'a']), null, 'one variant twice');
  });

  it('keeps only lists of two variant ids or more from a stored value', () => {
    assert.deepEqual(variantGroupsFrom([['a', 'b'], ['c'], 'x', null, ['d', 3, 'e', '']]), [['a', 'b'], ['d', 'e']]);
    assert.deepEqual(variantGroupsFrom({ a: 1 }), []);
  });

  it('learns the variants of an aircraft whose models differ, once their models are known', () => {
    const data = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      datastorage: { getData: (key: string) => data.get(key), setData: (key: string, value: string) => data.set(key, value), deleteData: () => undefined },
      top: null,
    };
    const events: string[] = [];
    (globalThis as { document?: unknown }).document = { dispatchEvent: (event: { type: string }) => events.push(event.type) };
    const models = new Map([
      ['aircal', '146-200'],
      ['qc', '146-200QC'],
      ['p1', 'Phenom 300E'],
      ['p2', 'Phenom 300E'],
    ]);
    learnVariantGroup(['p1', 'p2'], models);
    learnVariantGroup(['aircal', 'qt'], models);
    assert.deepEqual(loadVariantGroups(), [], 'same model, or a model not known yet: nothing');
    learnVariantGroup(['aircal', 'qc'], models);
    assert.deepEqual(loadVariantGroups(), [['aircal', 'qc']]);
    learnVariantGroup(['qc', 'aircal'], models);
    assert.deepEqual(events, [VARIANT_GROUPS_CHANGED], 'once');
  });
});
