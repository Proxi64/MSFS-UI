import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { orderLiveries } from '../src/features/aircraft-setup/livery-order.ts';
import { overflows, revealPosition, rowCount, variantsHeight, variantsPerRow } from '../src/features/aircraft-setup/setup-layout.ts';
import {
  favoriteLiveriesOf,
  findFavoriteLivery,
  FAVORITE_LIVERIES_CHANGED,
  loadFavorites,
  MAX_USES,
  saveFavoriteLiveries,
  withUse,
  type FavoriteLivery,
} from '../src/sim/favorites.ts';
import { cleanTail } from '../src/sim/registration.ts';

const livery = (id: string) => ({ id });

describe('orderLiveries', () => {
  const favorites = new Set(['v1:2', 'v1:4']);
  const isFavorite = (item: { id: string }) => favorites.has(item.id);

  it('puts favourites first, each part in the sim order', () => {
    const result = orderLiveries([livery('v1:0'), livery('v1:2'), livery('v1:3'), livery('v1:4')], isFavorite, null);
    assert.deepEqual(result.items.map((item) => item.id), ['v1:2', 'v1:4', 'v1:0', 'v1:3']);
    assert.equal(result.reordered, true);
    assert.deepEqual(result.order, { variationId: 'v1', ids: ['v1:2', 'v1:4', 'v1:0', 'v1:3'] });
  });

  it('keeps the order of the variant when a heart changes', () => {
    const first = orderLiveries([livery('v1:0'), livery('v1:2'), livery('v1:3')], isFavorite, null);
    favorites.add('v1:3');
    const again = orderLiveries([livery('v1:0'), livery('v1:2'), livery('v1:3')], isFavorite, first.order);
    assert.deepEqual(again.items.map((item) => item.id), ['v1:2', 'v1:0', 'v1:3']);
    assert.equal(again.reordered, false);
    favorites.delete('v1:3');
  });

  it('orders again for another variant, and keeps new ids in the sim order', () => {
    const first = orderLiveries([livery('v1:0'), livery('v1:2')], isFavorite, null);
    const other = orderLiveries([livery('v2:0'), livery('v2:1')], isFavorite, first.order);
    assert.equal(other.reordered, true);
    const grown = orderLiveries([livery('v1:0'), livery('v1:9'), livery('v1:2'), livery('v1:8')], isFavorite, first.order);
    assert.deepEqual(grown.items.map((item) => item.id), ['v1:2', 'v1:0', 'v1:9', 'v1:8']);
  });
});

describe('setup panel layout', () => {
  // Steps of the sim at 1080 lines: a variant tile and its gap (36 + 6), a row of thumbnails and its gap (75 + 6).
  const variant = 42;
  const liveryStep = 81;

  it('puts up to three variants per row, fewer when the widest name needs it', () => {
    assert.equal(variantsPerRow(8, 480, 100, 6), 3);
    assert.equal(variantsPerRow(8, 480, 200, 6), 2);
    assert.equal(variantsPerRow(8, 480, 300, 6), 1);
    assert.equal(variantsPerRow(2, 480, 100, 6), 2, 'no more per row than variants');
    assert.equal(variantsPerRow(0, 480, 100, 6), 1);
    assert.equal(rowCount(7, 3), 3);
    assert.equal(rowCount(0, 3), 0);
  });

  it('gives the variants what they need when everything fits', () => {
    assert.equal(variantsHeight(600, { count: 2, step: variant }, { count: 3, step: liveryStep }), 84);
    assert.equal(variantsHeight(600, { count: 0, step: variant }, { count: 3, step: liveryStep }), 0);
  });

  it('keeps two rows of liveries in view under many variants (Phenom 300E: 8 variants, one per row)', () => {
    const height = variantsHeight(450, { count: 8, step: variant }, { count: 6, step: liveryStep });
    assert.equal(height, 450 - 2 * liveryStep);
    assert.equal(overflows({ count: 8, step: variant }, height), true, 'the variants scroll');
  });

  it('keeps one row of liveries when the variant has a single livery (iFly 737 MAX: one variant per livery)', () => {
    const height = variantsHeight(500, { count: 30, step: variant }, { count: 1, step: liveryStep });
    assert.equal(height, 500 - liveryStep);
  });

  it('keeps three rows of variants when the room is short, and never more than the room', () => {
    assert.equal(variantsHeight(250, { count: 10, step: variant }, { count: 5, step: liveryStep }), 3 * variant);
    assert.equal(variantsHeight(100, { count: 10, step: variant }, { count: 5, step: liveryStep }), 100);
    assert.equal(variantsHeight(-20, { count: 10, step: variant }, { count: 5, step: liveryStep }), 0);
  });

  it('tells when a list scrolls, with half a pixel of rounding', () => {
    assert.equal(overflows({ count: 3, step: variant }, 126), false);
    assert.equal(overflows({ count: 3, step: variant }, 125.6), false);
    assert.equal(overflows({ count: 3, step: variant }, 125), true);
  });

  it('scrolls to show the selected variant, centred, within the list', () => {
    const rows = { count: 20, step: variant };
    assert.equal(revealPosition(0, rows, 210), 0);
    assert.equal(revealPosition(10, rows, 210), 10 * variant - 84);
    assert.equal(revealPosition(19, rows, 210), 20 * variant - 210, 'the last row ends at the bottom');
    assert.equal(revealPosition(5, { count: 3, step: variant }, 210), 0, 'a list that fits does not scroll');
  });
});

describe('favourites', () => {
  const sf50 = 'simobjects/airplanes/microsoft_sf50/liveries/microsoft/apex_corso_red';
  const favorites: FavoriteLivery[] = [
    { variationId: 'v1', dir: sf50, title: 'Red', image: 'a.png', displayName: 'Vision Jet', creator: 'Cirrus' },
    { variationId: 'v2', dir: 'other', title: 'Blue', image: 'b.png', displayName: 'Vision Jet', creator: 'Cirrus' },
    { variationId: 'v3', dir: 'x', title: 'Green', image: 'c.png', displayName: 'Caravan', creator: 'Cessna' },
  ];

  it('finds a favourite livery by its folder in any form', () => {
    assert.equal(findFavoriteLivery(favorites, 'v1', String.raw`SimObjects\Airplanes\Microsoft_SF50\liveries\microsoft\Apex_Corso_Red`), 0);
    assert.equal(findFavoriteLivery(favorites, 'v1', `coui://html_ui/VFS/${sf50}/`), 0);
    assert.equal(findFavoriteLivery(favorites, 'v2', sf50), -1, 'another variant');
  });

  it('gives the favourite liveries of an aircraft, all its variants', () => {
    assert.deepEqual(favoriteLiveriesOf(favorites, { variationId: 'v9', displayName: 'Vision Jet', creator: 'Cirrus' }).map((f) => f.title), ['Red', 'Blue']);
    assert.deepEqual(favoriteLiveriesOf(favorites, { variationId: 'v3' }).map((f) => f.title), ['Green']);
  });

  it('keeps the most recent uses, with the livery known before', () => {
    let uses = withUse({}, 'v1', { dir: 'd', title: 'Red', image: 'a.png' }, 1000);
    uses = withUse(uses, 'v1', undefined, 2000);
    assert.deepEqual(uses.v1, { livery: { dir: 'd', title: 'Red', image: 'a.png' }, usedAt: 2000 });
    for (let i = 0; i < MAX_USES + 5; i++) uses = withUse(uses, `x${i}`, undefined, 3000 + i);
    assert.equal(Object.keys(uses).length, MAX_USES);
    assert.equal('v1' in uses, false, 'the oldest are dropped');
  });
});

describe('favourites in the storage', () => {
  let data: Map<string, string>;
  let events: number;
  beforeEach(() => {
    data = new Map();
    events = 0;
    const target = new EventTarget();
    target.addEventListener(FAVORITE_LIVERIES_CHANGED, () => events++);
    (globalThis as { window?: unknown }).window = {
      top: null,
      datastorage: { getData: (key: string) => data.get(key), setData: (key: string, value: string) => data.set(key, value), deleteData: () => undefined },
    };
    (globalThis as { document?: unknown }).document = target;
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it('reads the favourites of early versions (ids only)', () => {
    data.set('MSFS_UI_FAVORITE_AIRCRAFT', JSON.stringify(['v1', { variationId: 'v2', displayName: 'Caravan' }]));
    assert.deepEqual(loadFavorites(), [{ variationId: 'v1' }, { variationId: 'v2', displayName: 'Caravan' }]);
  });

  it('announces a change of the favourite liveries', () => {
    saveFavoriteLiveries([]);
    assert.equal(events, 1);
    assert.equal(data.get('MSFS_UI_FAVORITE_LIVERIES'), '[]');
  });
});

describe('cleanTail', () => {
  it('keeps letters, digits and hyphens in upper case, cut to the length', () => {
    assert.equal(cleanTail('f-abcd', 9), 'F-ABCD');
    assert.equal(cleanTail('n 561_aj!', 9), 'N561AJ');
    assert.equal(cleanTail('ABCDEFGHIJK', 9), 'ABCDEFGHI');
  });
});
