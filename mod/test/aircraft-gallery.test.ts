import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareNatural,
  emptyMessage,
  favoriteAircraftIds,
  favoritesFirst,
  hasFavoriteLivery,
  accumulateKept,
  keptAircraftIds,
  normalize,
  readFilter,
  sortTiles,
  toggleFilter,
  visibleTiles,
  type AircraftItem,
} from '../src/features/aircraft-gallery/tiles.ts';
import type { FavoriteLivery } from '../src/sim/favorites.ts';
import { aircraftEdges, aircraftRowWidth, lastColumnSpan, galleryBodyClass, liveryFit, liveryTail, liveryTileSize, shortCount, splitColumns } from '../src/features/aircraft-gallery/livery-column.ts';

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
    const all = visibleTiles({ items: ITEMS, liveries: [], favoritesOnly: false, search: '', hiddenOnly: false, hidden: [], keepIds: [], translate: identity });
    assert.equal(all.length, 3);
    const found = visibleTiles({ items: ITEMS, liveries: [], favoritesOnly: false, search: 'aeronautica cap', hiddenOnly: false, hidden: [], keepIds: [], translate: identity });
    assert.deepEqual(found.map((tile) => tile.item.variationId), ['cap4']);
    const variant = visibleTiles({ items: ITEMS, liveries: [], favoritesOnly: false, search: 'executive', hiddenOnly: false, hidden: [], keepIds: [], translate: identity });
    assert.deepEqual(variant.map((tile) => tile.item.variationId), ['sf50-exec']);
  });

  it('gives one tile per favourite livery only', () => {
    const liveries = [livery('sf50-exec', 'Arrivee Alpine'), livery('sf50-exec', 'Apex Corso Red')];
    const tiles = visibleTiles({ items: ITEMS, liveries, favoritesOnly: true, search: '', hiddenOnly: false, hidden: [], keepIds: [], translate: identity });
    assert.deepEqual(
      tiles.map((tile) => `${tile.item.variationId}:${tile.livery ? tile.livery.title : '-'}`),
      ['sf50-exec:Arrivee Alpine', 'sf50-exec:Apex Corso Red'],
    );
  });

  it('gives a favourite livery of another variant to the entry of the same aircraft, once', () => {
    const items = [aircraft('sf50-family', 'Vision Jet G2', 'Working Title', 'Family Seating'), aircraft('sf50-copy', 'Vision Jet G2', 'Working Title', 'Family Seating')];
    const liveries = [livery('sf50-exec', 'Arrivee Alpine', { displayName: 'Vision Jet G2', creator: 'Working Title' })];
    const tiles = visibleTiles({ items, liveries, favoritesOnly: true, search: '', hiddenOnly: false, hidden: [], keepIds: [], translate: identity });
    assert.deepEqual(tiles.map((tile) => tile.item.variationId), ['sf50-family']);
  });

  it('searches favourite liveries on their title and variant', () => {
    const liveries = [livery('sf50-exec', 'Arrivee Alpine', { variation: 'Executive Seating' }), livery('sf50-exec', 'Apex Corso Red')];
    const tiles = visibleTiles({ items: ITEMS, liveries, favoritesOnly: true, search: 'alpine', hiddenOnly: false, hidden: [], keepIds: [], translate: identity });
    assert.deepEqual(tiles.map((tile) => tile.livery && tile.livery.title), ['Arrivee Alpine']);
  });
});

describe('hidden aircraft', () => {
  const hiddenVision = [{ displayName: 'Vision Jet G2', creator: 'Working Title' }];
  const query = (extra: Partial<Parameters<typeof visibleTiles>[0]>) =>
    visibleTiles(Object.assign({ items: ITEMS, liveries: [], favoritesOnly: false, search: '', hiddenOnly: false, hidden: hiddenVision, keepIds: [], translate: identity }, extra));

  it('leaves a hidden aircraft out of the normal view', () => {
    assert.deepEqual(query({}).map((tile) => tile.item.variationId), ['c172', 'cap4']);
  });

  it('keeps a hidden aircraft whose id is in keepIds, veiled', () => {
    const tiles = query({ keepIds: [ITEMS[0]!.aircraftId] });
    assert.deepEqual(tiles.map((tile) => tile.item.variationId), ['sf50-exec', 'c172', 'cap4']);
    assert.deepEqual(tiles.map((tile) => !!tile.veiled), [true, false, false]);
  });

  it('keeps it veiled when its favourite is of another variant', () => {
    const liveries = [livery('sf50-family', 'Red', { displayName: 'Vision Jet G2', creator: 'Working Title' })];
    const keepIds = favoriteAircraftIds(ITEMS, liveries);
    const tiles = query({ liveries, keepIds });
    assert.deepEqual(tiles.map((tile) => `${tile.item.variationId}:${!!tile.veiled}`), ['sf50-exec:true', 'c172:false', 'cap4:false']);
  });

  it('keeps a hidden aircraft veiled when its favourite was added after the order was set', () => {
    // The order was set without favourites (frozen ids empty); a livery of the hidden Vision Jet got its heart since.
    const liveries = [livery('sf50-exec', 'Alpine')];
    const tiles = query({ liveries, keepIds: keptAircraftIds([], ITEMS, liveries) });
    const vision = tiles.filter((tile) => tile.item.variationId === 'sf50-exec')[0];
    assert.ok(vision, 'the hidden aircraft is shown');
    assert.equal(vision.veiled, true);
  });

  it('keeps a hidden aircraft veiled after its last heart goes, until the order is set again', () => {
    const kept: number[] = [];
    const hearted = [livery('sf50-exec', 'Alpine')];
    accumulateKept(kept, keptAircraftIds([], ITEMS, hearted));
    // The heart is removed: the aircraft stays, veiled.
    accumulateKept(kept, keptAircraftIds([], ITEMS, []));
    const vision = query({ liveries: [], keepIds: kept }).filter((tile) => tile.item.variationId === 'sf50-exec')[0];
    assert.ok(vision, 'the hidden aircraft is still shown');
    assert.equal(vision.veiled, true);
    // The order set again: the list is emptied and the aircraft leaves.
    kept.length = 0;
    accumulateKept(kept, keptAircraftIds(null, ITEMS, []));
    assert.equal(query({ liveries: [], keepIds: kept }).some((tile) => tile.item.variationId === 'sf50-exec'), false);
  });

  it('keeps the aircraft frozen with the order and those of the favourites now, once each', () => {
    const liveries = [livery('sf50-exec', 'Alpine')];
    // The Cessna was a favourite when the order was set: it stays until the order is set again.
    assert.deepEqual(keptAircraftIds([ITEMS[1]!.aircraftId, ITEMS[0]!.aircraftId], ITEMS, liveries), [ITEMS[1]!.aircraftId, ITEMS[0]!.aircraftId]);
    assert.deepEqual(keptAircraftIds(null, ITEMS, liveries), [ITEMS[0]!.aircraftId]);
  });

  it('shows only the hidden aircraft in the Hidden view, not veiled, one tile per aircraft', () => {
    const items = ITEMS.concat([aircraft('sf50-family', 'Vision Jet G2', 'Working Title', 'Family Seating')]);
    const tiles = query({ items, hiddenOnly: true, keepIds: [items[0]!.aircraftId] });
    assert.deepEqual(tiles.map((tile) => tile.item.variationId), ['sf50-exec']);
    assert.equal(!!tiles[0]!.veiled, false);
  });

  it('filters the Hidden view with the search', () => {
    const hidden = hiddenVision.concat([{ displayName: 'Cessna 172 Skyhawk', creator: 'Asobo' }]);
    assert.deepEqual(query({ hidden, hiddenOnly: true }).length, 2);
    assert.deepEqual(query({ hidden, hiddenOnly: true, search: 'cessna' }).map((tile) => tile.item.variationId), ['c172']);
  });

  it('veils a Favorites tile whose aircraft is hidden', () => {
    const liveries = [livery('sf50-exec', 'Alpine'), livery('c172', 'Red')];
    const tiles = query({ liveries, favoritesOnly: true });
    assert.deepEqual(tiles.map((tile) => `${tile.item.variationId}:${!!tile.veiled}`), ['sf50-exec:true', 'c172:false']);
  });
});

describe('gallery filter', () => {
  it('reads the remembered filter, Favorites winning when both were stored', () => {
    assert.equal(readFilter({}), 'all');
    assert.equal(readFilter({ favoritesOnly: false, hiddenOnly: false }), 'all');
    assert.equal(readFilter({ favoritesOnly: true }), 'favorites');
    assert.equal(readFilter({ hiddenOnly: true }), 'hidden');
    assert.equal(readFilter({ favoritesOnly: true, hiddenOnly: true }), 'favorites');
  });

  it('turns one filter on and the other off, and the current one off on a second click', () => {
    assert.equal(toggleFilter('all', 'hidden'), 'hidden');
    assert.equal(toggleFilter('all', 'favorites'), 'favorites');
    assert.equal(toggleFilter('favorites', 'hidden'), 'hidden');
    assert.equal(toggleFilter('hidden', 'favorites'), 'favorites');
    assert.equal(toggleFilter('hidden', 'hidden'), 'all');
    assert.equal(toggleFilter('favorites', 'favorites'), 'all');
  });

  it('explains an empty view', () => {
    const hint = 'No hidden aircraft: click the eye on an aircraft to hide it.';
    assert.equal(emptyMessage('hidden', { favorites: 2, hidden: 0, searching: false }), hint);
    // Hidden aircraft of other category tabs only: none to show here either.
    assert.equal(emptyMessage('hidden', { favorites: 0, hidden: 3, searching: false }), hint);
    assert.equal(emptyMessage('hidden', { favorites: 0, hidden: 0, searching: true }), hint);
    assert.equal(emptyMessage('hidden', { favorites: 0, hidden: 3, searching: true }), 'No aircraft matches.');
    assert.equal(emptyMessage('favorites', { favorites: 0, hidden: 0, searching: true }), 'No favorites yet: click the heart on a livery.');
    assert.equal(emptyMessage('favorites', { favorites: 1, hidden: 0, searching: true }), 'No aircraft matches.');
    assert.equal(emptyMessage('all', { favorites: 0, hidden: 0, searching: false }), 'No aircraft matches.');
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

  // 3440 x 1440: the column 700 px, its bar 10 px, room 24 units = 32 px, gap 12 units = 16 px, banner 72 px, rows 83 units.
  const sizes = { room: 32, gap: 16, banner: 72, rowStep: 110.67 };

  it('fills the column with its two tiles when the list does not scroll', () => {
    const fit = liveryFit(700, 10, sizes, 4, false, 816);
    assert.equal(fit.full, true);
    assert.equal(fit.tile.width * 2 + fit.gap, 700, 'the second tile ends on the column edge');
    assert.equal(fit.gap, 16);
  });

  it('keeps the bar and its room when the tiles scroll, the gap taking the odd pixel', () => {
    const fit = liveryFit(701, 10, sizes, 8, false, 816);
    assert.equal(fit.full, false);
    assert.equal(fit.tile.width, Math.floor((701 - 10 - 32 - 16) / 2));
    assert.equal(fit.tile.width * 2 + fit.gap, 701 - 10 - 32);
    assert.ok(fit.gap >= 16 && fit.gap <= 17);
  });

  it('never makes the two tiles wider than the box when the bar is fractional', () => {
    // Bar 7.5 units, room 24 units, gap 12 units, at 1080, 1200 and 1600 lines (unit = lines / 1080 x 1... scaled).
    for (const unit of [1, 1200 / 1080, 1600 / 1080]) {
      const sized = { room: 24 * unit, gap: 12 * unit, banner: 54 * unit, rowStep: 83 * unit };
      for (const column of [600, 650.5, 700.25, 733.75, 799]) {
        const fit = liveryFit(column, 7.5 * unit, sized, 40, false, 300);
        assert.equal(fit.full, false);
        const space = column - 7.5 * unit - sized.room;
        assert.ok(2 * fit.tile.width + fit.gap <= space, `unit ${unit} column ${column}: ${2 * fit.tile.width + fit.gap} > ${space}`);
      }
    }
  });

  it('decides on the full width, so the tiles cannot swing between the two sizes', () => {
    // Full-width tiles of 342 px are 235 high: two rows of 251 fit 502, not 500; narrower ones would, but are not used.
    const fit = liveryFit(700, 10, sizes, 4, false, 500);
    assert.equal(fit.full, false);
  });

  it('lets List rows fit without the bar', () => {
    assert.equal(liveryFit(700, 10, sizes, 7, true, 816).full, true);
    assert.equal(liveryFit(700, 10, sizes, 8, true, 816).full, false);
  });

  it('shows the tail number the mod would apply', () => {
    assert.equal(liveryTail('F-TEST', 'VH-OZG', 'Qantas VH-ABC', 9), 'F-TEST');
    assert.equal(liveryTail(undefined, 'VH-OZG', 'Qantas VH-ABC', 9), 'VH-OZG');
    assert.equal(liveryTail(undefined, null, 'Qantas VH-ABC', 9), 'VH-ABC');
    assert.equal(liveryTail(undefined, null, 'FSReborn Livery', 9), '');
  });
});

describe('gallery bar and rows', () => {
  it('shortens the count only when the full count would leave the search too narrow', () => {
    // The room is the search's width and the count's together (the search takes what the count leaves).
    assert.equal(shortCount(700, 100, 320), false);
    assert.equal(shortCount(420, 100, 320), false);
    assert.equal(shortCount(419, 100, 320), true);
  });

  it('puts the aircraft tiles, rows and bar on the same edges in both views', () => {
    // Three tiles of 322 px with 8 px each side: from the first tile's left to the last one's right.
    // Measured at 1440 lines (8 px margins): tiles 322 px; the rows on the same edges.
    assert.deepEqual(aircraftEdges({ columns: 3, width: 322 }, 8, 1016), { left: 8, right: 1006, rowRight: 1006 });
    // A short list whose tiles take the scroll bar's room: the rows stop before it.
    assert.deepEqual(aircraftEdges({ columns: 3, width: 328 }, 8, 1016), { left: 8, right: 1024, rowRight: 1016 });
  });

  it('gives the last column of tiles, where Hidden and Favorites stand', () => {
    // Measured at 1440 lines (8 px margins, tiles 322 px): the last tile from 684 to 1006, 16 px after the second one.
    assert.deepEqual(lastColumnSpan({ columns: 3, width: 322 }, 8), { left: 684, right: 1006, gap: 16 });
    // Fractional margins (1200 lines: 6.67 px) still give whole pixels.
    assert.deepEqual(lastColumnSpan({ columns: 3, width: 268 }, 6 * (1200 / 1080)), { left: 569, right: 837, gap: 13 });
  });

  it('gives the aircraft rows the same width whether the list scrolls or not', () => {
    // 3440 x 1440: the list 1058 px, the room 24 units = 32 px, the sim's scroll bar 10 px.
    assert.equal(aircraftRowWidth(1058, 32, 10), 1016);
    assert.equal(aircraftRowWidth(1058.6, 32, 10), 1016);
  });
});

describe('gallery body class', () => {
  it('keeps the side by side flag whenever the list is rebuilt', () => {
    assert.equal(galleryBodyClass('list', true), 'msfs-ui-gal__body is-list is-side-by-side');
    assert.equal(galleryBodyClass('gallery', false), 'msfs-ui-gal__body is-gallery');
    // The Default view's grid (gallery.ts): never side by side.
    assert.equal(galleryBodyClass('grid', false), 'msfs-ui-gal__body is-grid');
  });
});