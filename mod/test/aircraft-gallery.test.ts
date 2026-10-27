import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareNatural, favoriteFrom, favoritesFirst, isFavoriteAircraft, normalize, sortTiles, visibleTiles, type AircraftItem } from '../src/features/aircraft-gallery/tiles.ts';
import type { FavoriteLivery } from '../src/sim/favorites.ts';
import { galleryBodyClass, liveryTail, liveryTileSize, splitColumns } from '../src/features/aircraft-gallery/livery-column.ts';

const aircraft = (variationId: string, displayName: string, creator: string, variation = ''): AircraftItem => ({
  aircraftId: 1,
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
    const all = visibleTiles({ items: ITEMS, favorites: [], liveries: [], favoritesOnly: false, search: '', translate: identity });
    assert.equal(all.length, 3);
    const found = visibleTiles({ items: ITEMS, favorites: [], liveries: [], favoritesOnly: false, search: 'aeronautica cap', translate: identity });
    assert.deepEqual(found.map((tile) => tile.item.variationId), ['cap4']);
    const variant = visibleTiles({ items: ITEMS, favorites: [], liveries: [], favoritesOnly: false, search: 'executive', translate: identity });
    assert.deepEqual(variant.map((tile) => tile.item.variationId), ['sf50-exec']);
  });

  it('gives one tile per favourite livery, and per favourite aircraft without favourite livery', () => {
    const liveries = [livery('sf50-exec', 'Arrivee Alpine'), livery('sf50-exec', 'Apex Corso Red')];
    const tiles = visibleTiles({ items: ITEMS, favorites: [favoriteFrom(ITEMS[1]!)], liveries, favoritesOnly: true, search: '', translate: identity });
    assert.deepEqual(
      tiles.map((tile) => `${tile.item.variationId}:${tile.livery ? tile.livery.title : '-'}`),
      ['sf50-exec:Arrivee Alpine', 'sf50-exec:Apex Corso Red', 'c172:-'],
    );
  });

  it('gives a favourite livery of another variant to the entry of the same aircraft, once', () => {
    const items = [aircraft('sf50-family', 'Vision Jet G2', 'Working Title', 'Family Seating'), aircraft('sf50-copy', 'Vision Jet G2', 'Working Title', 'Family Seating')];
    const liveries = [livery('sf50-exec', 'Arrivee Alpine', { displayName: 'Vision Jet G2', creator: 'Working Title' })];
    const tiles = visibleTiles({ items, favorites: [], liveries, favoritesOnly: true, search: '', translate: identity });
    assert.deepEqual(tiles.map((tile) => tile.item.variationId), ['sf50-family']);
  });

  it('searches favourite liveries on their title and variant', () => {
    const liveries = [livery('sf50-exec', 'Arrivee Alpine', { variation: 'Executive Seating' }), livery('sf50-exec', 'Apex Corso Red')];
    const tiles = visibleTiles({ items: ITEMS, favorites: [], liveries, favoritesOnly: true, search: 'alpine', translate: identity });
    assert.deepEqual(tiles.map((tile) => tile.livery && tile.livery.title), ['Arrivee Alpine']);
  });
});

describe('favourites of an aircraft', () => {
  it('counts the gallery heart of any variant and the favourite liveries', () => {
    const other = favoriteFrom(aircraft('sf50-family', 'Vision Jet G2', 'Working Title', 'Family Seating'));
    assert.equal(isFavoriteAircraft([other], [], ITEMS[0]!), true, 'same aircraft, another variant');
    assert.equal(isFavoriteAircraft([], [livery('c172', 'Red')], ITEMS[1]!), true);
    assert.equal(isFavoriteAircraft([], [], ITEMS[2]!), false);
  });

  it('stores the variant of modular aircraft only', () => {
    assert.equal(favoriteFrom(ITEMS[0]!).variation, 'Executive Seating');
    assert.equal(favoriteFrom(ITEMS[1]!).variation, '');
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
  it('puts favourite aircraft and livery tiles first, keeping the order of each part', () => {
    const items = [aircraft('a', 'A', 'S'), aircraft('b', 'B', 'S'), aircraft('c', 'C', 'S'), aircraft('d', 'D', 'S')];
    const tiles = items.map((item) => ({ item }));
    const sorted = favoritesFirst(tiles, [favoriteFrom(items[3]!)], [livery('b', 'Red')]);
    assert.deepEqual(sorted.map((tile) => tile.item.variationId), ['b', 'd', 'a', 'c']);
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