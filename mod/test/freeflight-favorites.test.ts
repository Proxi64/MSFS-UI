import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectEntries, isCurrentEntry, orderEntries, withoutLivery, type FavoriteEntry } from '../src/features/freeflight-favorites/entries.ts';
import type { FavoriteLivery } from '../src/sim/favorites.ts';

const livery = (variationId: string, title: string, extra: Partial<FavoriteLivery> = {}): FavoriteLivery =>
  Object.assign({ variationId, dir: `simobjects/${variationId}/liveries/${title}`, title, image: `${title}.png` }, extra);

const ids = (entries: readonly FavoriteEntry[]) => entries.map((entry) => entry.id);

describe('collectEntries', () => {
  it('gives one entry per favourite livery, loading that livery', () => {
    const entries = collectEntries([livery('sf50-exec', 'Red', { displayName: 'Vision Jet G2 ', creator: 'Working Title', variation: 'Executive', usedAt: 5 })]);
    assert.equal(entries.length, 1);
    const entry = entries[0]!;
    assert.equal(entry.id, 'livery:sf50-exec|simobjects/sf50-exec/liveries/Red');
    assert.equal(entry.name, 'Vision Jet G2');
    assert.equal(entry.variation, 'Executive');
    assert.deepEqual(entry.livery, { dir: 'simobjects/sf50-exec/liveries/Red', title: 'Red', image: 'Red.png' });
    assert.equal(entry.image, 'Red.png');
    assert.equal(entry.usedAt, 5);
  });

  it('names an entry after its variant when the livery has no aircraft name', () => {
    const entry = collectEntries([livery('c172', 'Blue')])[0]!;
    assert.equal(entry.name, 'c172');
    assert.equal(entry.creator, '');
    assert.equal(entry.usedAt, 0);
  });
});

describe('orderEntries', () => {
  const entries = collectEntries([livery('a', 'A', { usedAt: 1 }), livery('b', 'B', { usedAt: 3 }), livery('c', 'C', { usedAt: 2 })]);
  const [a, b, c] = ids(entries);

  it('sorts the first display from the most recently used', () => {
    const ordered = orderEntries(entries, null);
    assert.deepEqual(ids(ordered.entries), [b, c, a]);
    assert.deepEqual(ordered.order, [b, c, a]);
  });

  it('keeps the order of the screen afterwards, whatever the uses', () => {
    const used = collectEntries([livery('a', 'A', { usedAt: 9 }), livery('b', 'B', { usedAt: 3 }), livery('c', 'C', { usedAt: 2 })]);
    assert.deepEqual(ids(orderEntries(used, [b!, c!, a!]).entries), [b, c, a]);
  });

  it('puts the entries added since at the end, in their own order', () => {
    assert.deepEqual(ids(orderEntries(entries, [c!]).entries), [c, a, b]);
  });
});

describe('isCurrentEntry', () => {
  const current = { variationId: 'sf50-exec', livery: 'simobjects/sf50-exec/liveries/red' };

  it('selects an entry only on its variant and its livery', () => {
    const red = collectEntries([livery('sf50-exec', 'Red')])[0]!;
    const blue = collectEntries([livery('sf50-exec', 'Blue')])[0]!;
    assert.equal(isCurrentEntry(red, current), true);
    assert.equal(isCurrentEntry(blue, current), false);
    assert.equal(isCurrentEntry(red, { variationId: 'c172', livery: 'simobjects/sf50-exec/liveries/red' }), false);
  });
});

describe('removal from the heart', () => {
  it('removes only the livery of the entry', () => {
    const liveries = [livery('sf50-exec', 'Red'), livery('sf50-exec', 'Blue')];
    const entry = collectEntries([liveries[0]!])[0]!;
    assert.deepEqual(
      withoutLivery(liveries, entry).map((kept) => kept.title),
      ['Blue'],
    );
  });
});
