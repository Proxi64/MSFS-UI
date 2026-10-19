import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectEntries, isCurrentEntry, orderEntries, withoutAircraft, withoutLivery, type FavoriteEntry } from '../src/features/freeflight-favorites/entries.ts';
import type { AircraftUses, FavoriteAircraft, FavoriteLivery } from '../src/sim/favorites.ts';

const livery = (variationId: string, title: string, extra: Partial<FavoriteLivery> = {}): FavoriteLivery =>
  Object.assign({ variationId, dir: `simobjects/${variationId}/liveries/${title}`, title, image: `${title}.png` }, extra);
const favorite = (variationId: string, displayName: string, creator: string, extra: Partial<FavoriteAircraft> = {}): FavoriteAircraft =>
  Object.assign({ variationId, displayName, creator, variation: '', thumbnailPath: `${variationId}.png` }, extra);

const ids = (entries: readonly FavoriteEntry[]) => entries.map((entry) => entry.id);

describe('collectEntries', () => {
  it('gives one entry per favourite livery, loading that livery', () => {
    const entries = collectEntries([], [livery('sf50-exec', 'Red', { displayName: 'Vision Jet G2 ', creator: 'Working Title', variation: 'Executive', usedAt: 5 })], {});
    assert.equal(entries.length, 1);
    const entry = entries[0]!;
    assert.equal(entry.id, 'livery:sf50-exec|simobjects/sf50-exec/liveries/Red');
    assert.equal(entry.name, 'Vision Jet G2');
    assert.equal(entry.variation, 'Executive');
    assert.deepEqual(entry.livery, { dir: 'simobjects/sf50-exec/liveries/Red', title: 'Red', image: 'Red.png' });
    assert.equal(entry.fixedLivery, true);
    assert.equal(entry.usedAt, 5);
  });

  it('gives a favourite aircraft the last livery used with its variant', () => {
    const uses: AircraftUses = { c172: { livery: { dir: 'SimObjects\\c172\\liveries\\blue', title: 'Blue', image: 'blue.png' }, usedAt: 9 } };
    const entry = collectEntries([favorite('c172', 'Cessna 172', 'Asobo')], [], uses)[0]!;
    assert.equal(entry.id, 'aircraft:c172');
    assert.equal(entry.image, 'blue.png');
    assert.equal(entry.livery!.title, 'Blue');
    assert.equal(entry.fixedLivery, false);
    assert.equal(entry.usedAt, 9);
  });

  it('falls back on the aircraft thumbnail when it was never used', () => {
    const entry = collectEntries([favorite('c172', 'Cessna 172', 'Asobo')], [], {})[0]!;
    assert.equal(entry.image, 'c172.png');
    assert.equal(entry.livery, undefined);
    assert.equal(entry.usedAt, 0);
  });

  it('leaves out a favourite aircraft that has favourite liveries, of any of its variants', () => {
    const entries = collectEntries(
      [favorite('sf50-exec', 'Vision Jet G2', 'Working Title'), favorite('c172', 'Cessna 172', 'Asobo')],
      [livery('sf50-family', 'Red', { displayName: 'Vision Jet G2', creator: 'Working Title' })],
      {},
    );
    assert.deepEqual(ids(entries), ['livery:sf50-family|simobjects/sf50-family/liveries/Red', 'aircraft:c172']);
  });
});

describe('orderEntries', () => {
  const entries = collectEntries(
    [favorite('a', 'A', 'S'), favorite('b', 'B', 'S'), favorite('c', 'C', 'S')],
    [],
    { a: { usedAt: 1 }, b: { usedAt: 3 }, c: { usedAt: 2 } },
  );

  it('sorts the first display from the most recently used', () => {
    const ordered = orderEntries(entries, null);
    assert.deepEqual(ids(ordered.entries), ['aircraft:b', 'aircraft:c', 'aircraft:a']);
    assert.deepEqual(ordered.order, ['aircraft:b', 'aircraft:c', 'aircraft:a']);
  });

  it('keeps the order of the screen afterwards, whatever the uses', () => {
    const used = collectEntries([favorite('a', 'A', 'S'), favorite('b', 'B', 'S'), favorite('c', 'C', 'S')], [], { a: { usedAt: 9 } });
    assert.deepEqual(ids(orderEntries(used, ['aircraft:b', 'aircraft:c', 'aircraft:a']).entries), ['aircraft:b', 'aircraft:c', 'aircraft:a']);
  });

  it('puts the entries added since at the end, in their own order', () => {
    const order = ['aircraft:c'];
    assert.deepEqual(ids(orderEntries(entries, order).entries), ['aircraft:c', 'aircraft:a', 'aircraft:b']);
  });
});

describe('isCurrentEntry', () => {
  const current = { variationId: 'sf50-exec', livery: 'simobjects/sf50-exec/liveries/red' };

  it('selects a favourite livery only on that livery', () => {
    const red = collectEntries([], [livery('sf50-exec', 'Red')], {})[0]!;
    const blue = collectEntries([], [livery('sf50-exec', 'Blue')], {})[0]!;
    assert.equal(isCurrentEntry(red, current), true);
    assert.equal(isCurrentEntry(blue, current), false);
  });

  it('selects a favourite aircraft on its variant, whatever the livery', () => {
    const entry = collectEntries([favorite('sf50-exec', 'Vision Jet G2', 'Working Title')], [], {})[0]!;
    assert.equal(isCurrentEntry(entry, current), true);
    assert.equal(isCurrentEntry(entry, { variationId: 'c172', livery: '' }), false);
  });
});

describe('removal from the heart', () => {
  it('removes every variant of the aircraft', () => {
    const favorites = [favorite('sf50-exec', 'Vision Jet G2', 'Working Title'), favorite('sf50-family', 'Vision Jet G2 ', 'Working Title'), favorite('c172', 'Cessna 172', 'Asobo')];
    const entry = collectEntries([favorites[0]!], [], {})[0]!;
    assert.deepEqual(
      withoutAircraft(favorites, entry).map((kept) => kept.variationId),
      ['c172'],
    );
  });

  it('removes only the livery of the entry', () => {
    const liveries = [livery('sf50-exec', 'Red'), livery('sf50-exec', 'Blue')];
    const entry = collectEntries([], [liveries[0]!], {})[0]!;
    assert.deepEqual(
      withoutLivery(liveries, entry).map((kept) => kept.title),
      ['Blue'],
    );
  });
});
