import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AircraftItem } from '../src/features/aircraft-gallery/tiles.ts';
import { findLastPlane, lastPlaneFrom, lastPlaneOf, liveryRefOf, planeToRecord, type LastPlane } from '../src/features/aircraft-gallery/last-plane.ts';

const THUMBNAIL = 'coui://html_ui/VFS/SimObjects/Airplanes/asobo_atr/liveries/Asobo/Highline/thumbnail/thumbnail.png';
const KEY = 'simobjects/airplanes/asobo_atr/liveries/asobo/highline';

const current = (variationId: string, thumbnailPath = THUMBNAIL, isValid = true) => ({
  variationId,
  displayName: 'ATR 72-600',
  creator: 'Studio',
  variation: 'Highline 01',
  thumbnailPath,
  isValid,
});
const plane = (variationId = 'atr72', dir = KEY): LastPlane => ({ variationId, displayName: 'ATR 72-600', creator: 'Studio', variation: 'Highline 01', dir });

const item = (variationId: string, displayName = 'ATR 72-600', isUsable = true) =>
  ({ aircraftId: 1, variationIndex: 0, variationId, displayName, creator: 'Studio', variation: '', isModular: false, thumbnailPath: '', isSelected: false, isUsable }) as AircraftItem;

describe('what the last plane keeps', () => {
  it('takes the aircraft, its variant and its livery from the current aircraft', () => {
    assert.deepEqual(lastPlaneOf(current('atr72')), plane());
  });

  it('keeps nothing of an invalid current aircraft, or of none', () => {
    assert.equal(lastPlaneOf(current('atr72', THUMBNAIL, false)), null);
    assert.equal(lastPlaneOf(current('')), null);
    assert.equal(lastPlaneOf(null), null);
  });

  it('keeps the aircraft of a current aircraft without a thumbnail, without a livery', () => {
    assert.deepEqual(lastPlaneOf(current('atr72', '')), plane('atr72', ''));
  });
});

describe('the stored last plane', () => {
  it('reads what was stored', () => {
    assert.deepEqual(lastPlaneFrom(JSON.parse(JSON.stringify(plane()))), plane());
  });

  it('does not trust a stored value', () => {
    for (const stored of [null, [], 'atr72', 3, {}, { ...plane(), variationId: '' }, { ...plane(), variationId: 3 }, { ...plane(), displayName: null }, { ...plane(), creator: 1 }, { ...plane(), dir: 1 }]) {
      assert.equal(lastPlaneFrom(stored), null, JSON.stringify(stored));
    }
  });

  it('accepts a value without its variant title', () => {
    const { variation: _variation, ...rest } = plane();
    assert.equal(lastPlaneFrom(rest)!.variation, '');
  });
});

describe('finding the last plane again', () => {
  it('takes the entry of the variant', () => {
    const found = findLastPlane([item('a380', 'A380'), item('atr72')], plane(), []);
    assert.equal(found.problem, undefined);
    assert.equal(found.item!.variationId, 'atr72');
  });

  it('takes the entry of a modular aircraft, on another variant, by name and publisher', () => {
    assert.equal(findLastPlane([item('atr72-cargo')], plane(), []).item!.variationId, 'atr72-cargo');
  });

  it('prefers the variant among several entries of the same name (one variant per livery)', () => {
    assert.equal(findLastPlane([item('other'), item('atr72')], plane(), []).item!.variationId, 'atr72');
  });

  it('leaves an aircraft no longer in the list', () => {
    const found = findLastPlane([item('a380', 'A380'), null as unknown as AircraftItem], plane(), []);
    assert.equal(found.item, undefined);
    assert.match(found.problem!, /no longer in the list/);
  });

  it('leaves a hidden aircraft', () => {
    assert.match(findLastPlane([item('atr72')], plane(), [{ displayName: 'ATR 72-600', creator: 'Studio' }]).problem!, /hidden/);
  });

  it('leaves an aircraft that cannot be flown', () => {
    assert.match(findLastPlane([item('atr72', 'ATR 72-600', false)], plane(), []).problem!, /cannot be flown/);
  });
});

describe('the livery asked for', () => {
  it('is the stored folder', () => {
    assert.deepEqual(liveryRefOf(plane()), { dir: KEY, title: '', image: '' });
  });

  it('is none without a folder', () => {
    assert.equal(liveryRefOf(plane('atr72', '')), undefined);
  });
});

describe('what is recorded', () => {
  const closed = () => ({ done: false, simsChoice: null as LastPlane | null });
  const open = (simsChoice: LastPlane | null = null) => ({ done: true, simsChoice });

  it('nothing before the restore has been done or given up: the sim imposes its own aircraft at the start', () => {
    assert.equal(planeToRecord(undefined, plane('stored'), current('c400')), null);
    assert.equal(planeToRecord(closed(), plane('stored'), current('c400')), null);
  });

  it('the current aircraft, when nothing is stored yet', () => {
    assert.deepEqual(planeToRecord(open(), null, current('atr72')), plane());
  });

  it('a plain change of aircraft, or of livery alone', () => {
    assert.deepEqual(planeToRecord(open(), plane('atr42'), current('atr72')), plane());
    assert.deepEqual(planeToRecord(open(), plane('atr72', 'other'), current('atr72')), plane());
  });

  it('nothing when it is what is stored, or when the current aircraft is invalid', () => {
    assert.equal(planeToRecord(open(), plane(), current('atr72')), null);
    assert.equal(planeToRecord(open(), plane('atr42'), current('atr72', THUMBNAIL, false)), null);
  });

  it('not the sim\'s aircraft left after a restore given up: the memory stays', () => {
    const state = open(plane('c400'));
    assert.equal(planeToRecord(state, plane('gone'), current('c400')), null);
    assert.deepEqual(state.simsChoice, plane('c400'));
  });

  it('the first real change after a restore given up, and from then on the sim\'s aircraft too', () => {
    const state = open(plane('c400'));
    assert.deepEqual(planeToRecord(state, plane('gone'), current('atr72')), plane());
    assert.equal(state.simsChoice, null);
    assert.deepEqual(planeToRecord(state, plane(), current('c400')), plane('c400'));
  });
});
