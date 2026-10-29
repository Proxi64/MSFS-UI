import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareNatural, favoriteAircraftIds, favoritesFirst, hasFavoriteLivery, normalize, sortTiles, visibleTiles, type AircraftItem } from '../src/features/aircraft-gallery/tiles.ts';
import type { FavoriteLivery } from '../src/sim/favorites.ts';
import { galleryBodyClass, liveryTail, liveryTileSize, splitColumns } from '../src/features/aircraft-gallery/livery-column.ts';

let nextAircraftId = 1;
const aircraft = (variationId: string, displayName: string, creator: string, variation = ''): AircraftItem => ({
  aircraftId: nextAircraftId++,
  variationIndex: 0,
  variationId,
  displayName,
  creator,
  variation,
  isModular: !!variation,
  thumbnailPath: `${variationId}.png`,
  isSelected: false,
  isUsable: true,
});

const ITEMS = [
  aircraft('sf50-exec', 'Vision Jet G2', 'Working Title', 'Executive Seating'),
  aircraft('c172', 'Cessna 172 Skyhawk', 'Asobo'),
  aircraft('cap4', 'CAP-4 Paulistinha', 'Companhia Aeronáutica Paulista'),
];
const livery = (variationId: string, title: string, extra: Partial<FavoriteLivery> = {}): FavoriteLivery =>
  Object.assign({ variationId, dir: `${variationId}/${title}`, title, image: `${title}.png` }, extra);
const identity = (key: string) => key;

describe('normalize', () => {
  it('ignores case, accents and punctuation', () => {
    assert.equal(normalize('Companhia Aeronáutica  Paulista CAP-4'), 'companhia aeronautica paulista cap 4');
    assert.equal(normalize('  Çà Été  '), 'ca ete');
  });
});

describe('visibleTiles', () => {
  it('gives one tile per aircraft without the filter, searched on every word', () => {
    const all = visibleTiles({ items: ITEMS, liveries: [], favoritesOnly: false, search: '', translate: identity });
    assert.equal(all.length, 3);
    const found = visibleTiles({ items: ITEMS, liveries: [], favoritesOnly: false, search: 'aeronautica cap', translate: identity });
    assert.deepEqual(found.map((tile) => tile.item.variationId), ['cap4']);
    const variant = visibleTiles({ items: ITEMS, liveries: [], favoritesOnly: false, search: 'executive', translate: identity });
    assert.deepEqual(variant.map((tile) => tile.item.variationId), ['sf50-exec']);
  });

  it('gives one tile per favourite livery only', () => {
    const liveries = [livery('sf50-exec', 'Arrivee Alpine'), livery('sf50-exec', 'Apex Corso Red')];
    const tiles = visibleTiles({ items: ITEMS, liveries, favoritesOnly: true, search: '', translate: identity });
    assert.deepEqual(
      tiles.map((tile) => `${tile.item.variationId}:${tile.livery ? tile.livery.title : '-'}`),
      ['sf50-exec:Arrivee Alpine', 'sf50-exec:Apex Corso Red'],
    );
  });

  it('gives a favourite livery of another variant to the entry of the same aircraft, once', () => {
    const items = [aircraft('sf50-family', 'Vision Jet G2', 'Working Title', 'Family Seating'), aircraft('sf50-copy', 'Vision Jet G2', 'Working Title', 'Family Seating')];
    const liveries = [livery('sf50-exec', 'Arrivee Alpine', { displayName: 'Vision Jet G2', creator: 'Working Title' })];
    const tiles = visibleTiles({ items, liveries, favoritesOnly: true, search: '', translate: identity });
    assert.deepEqual(tiles.map((tile) => tile.item.variationId), ['sf50-family']);
  });

  it('searches favourite liveries on their title and variant', () => {
    const liveries = [livery('sf50-exec', 'Arrivee Alpine', { variation: 'Executive Seating' }), livery('sf50-exec', 'Apex Corso Red')];
    const tiles = visibleTiles({ items: ITEMS, liveries, favoritesOnly: true, search: 'alpine', translate: identity });
    assert.deepEqual(tiles.map((tile) => tile.livery && tile.livery.title), ['Arrivee Alpine']);
  });
});

describe('favourite aircraft', () => {
  it('are the aircraft with a favourite livery, of any of their variants', () => {
    const other = livery('sf50-family', 'Red', { displayName: 'Vision Jet G2', creator: 'Working Title' });
    assert.equal(hasFavoriteLivery([other], ITEMS[0]!), true, 'same aircraft, another variant');
    assert.equal(hasFavoriteLivery([livery('c172', 'Red')], ITEMS[1]!), true);
    assert.equal(hasFavoriteLivery([livery('c172', 'Red')], ITEMS[2]!), false);
    assert.deepEqual(favoriteAircraftIds(ITEMS, [livery('c172', 'Red')]), [ITEMS[1]!.aircraftId]);
  });
});

describe('sortTiles', () => {
  const tiles = [
    aircraft('c404', 'Cessna 404 Titan', 'Microsoft/Carenado'),
    aircraft('atr42', 'ATR 42-600', 'Microsoft / S&H Software'),
    aircraft('c172', 'Cessna 172 Skyhawk', 'Asobo Studio'),
    aircraft('b747', 'Boeing 747-8', 'Asobo Studio'),
    aircraft('b737', 'Boeing 737 MAX', ' Asobo Studio'),
    aircraft('atr72', 'ATR 72-600', 'Microsoft / S&H Software'),
  ].map((item) => ({ item }));
  const ids = (sorted: { item: AircraftItem }[]) => sorted.map((tile) => tile.item.variationId);

  it('sorts by the displayed name, numbers in natural order', () => {
    assert.deepEqual(ids(sortTiles(tiles, 'name', false)), ['atr42', 'atr72', 'b737', 'b747', 'c172', 'c404']);
  });

  it('reverses the order', () => {
    assert.deepEqual(ids(sortTiles(tiles, 'name', true)), ['c404', 'c172', 'b747', 'b737', 'atr72', 'atr42']);
  });

  it('sorts by studio then name, ignoring spaces and case', () => {
    assert.deepEqual(ids(sortTiles(tiles, 'studio', false)), ['b737', 'b747', 'c172', 'c404', 'atr42', 'atr72']);
  });

  it('keeps the sim order for ties', () => {
    const same = [aircraft('b', 'Same', 'X'), aircraft('a', 'Same', 'X')].map((item) => ({ item }));
    assert.deepEqual(ids(sortTiles(same, 'name', false)), ['b', 'a']);
    assert.deepEqual(ids(sortTiles(same, 'name', true)), ['b', 'a']);
  });

  it('compares runs of digits as numbers', () => {
    assert.ok(compareNatural('cessna 42', 'cessna 404') < 0);
    assert.ok(compareNatural('a 2', 'a 10') < 0);
    assert.equal(compareNatural('x', 'x'), 0);
  });
});

describe('favoritesFirst', () => {
  it('puts the favourite aircraft given and the livery tiles first, keeping the order of each part', () => {
    const items = [aircraft('a', 'A', 'S'), aircraft('b', 'B', 'S'), aircraft('c', 'C', 'S'), aircraft('d', 'D', 'S')];
    const tiles = [{ item: items[0]! }, { item: items[1]! }, { item: items[2]!, livery: livery('c', 'Red') }, { item: items[3]! }];
    const sorted = favoritesFirst(tiles, [items[3]!.aircraftId]);
    assert.deepEqual(sorted.map((tile) => tile.item.variationId), ['c', 'd', 'a', 'b']);
  });

  it('keeps an aircraft in its place while the favourites given are those of an earlier order', () => {
    const items = [aircraft('a', 'A', 'S'), aircraft('b', 'B', 'S')];
    const tiles = items.map((item) => ({ item }));
    // A livery of b made a favourite since the order was set: b does not jump to the top under the mouse.
    const earlier = favoriteAircraftIds(items, []);
    assert.deepEqual(favoritesFirst(tiles, earlier).map((tile) => tile.item.variationId), ['a', 'b']);
    assert.deepEqual(favoritesFirst(tiles, favoriteAircraftIds(items, [livery('b', 'Red')])).map((tile) => tile.item.variationId), ['b', 'a']);
  });
});

describe('livery column', () => {
  it('splits the gallery so that three aircraft and two liveries per row get the same width', () => {
    // 3440 x 1440: unit 4/3; gap 12 units = 16 px, scroll bar room 24 units = 32 px, tile margin 6 units = 8 px.
    const { left, right } = splitColumns(1747, 16, 32, 8);
    assert.equal(left + 16 + right, 1747);
    const aircraft = (left - 32) / 3 - 2 * 8;
    const livery = liveryTileSize(right, 32, 16, 72).width;
    assert.ok(Math.abs(aircraft - livery) <= 1, `aircraft ${aircraft}, livery ${livery}`);
    assert.equal(Number.isInteger(left), true);
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
});

describe('gallery body class', () => {
  it('keeps the side by side flag whenever the list is rebuilt', () => {
    assert.equal(galleryBodyClass('list', true), 'msfs-ui-gal__body is-list is-side-by-side');
    assert.equal(galleryBodyClass('gallery', false), 'msfs-ui-gal__body is-gallery');
  });
});