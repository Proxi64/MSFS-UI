import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { overflows, rowCount, statisticsRoom, variantsHeight, variantsPerRow } from '../src/features/aircraft-setup/setup-layout.ts';
import { bottomColumns, columnExtra, gridCell, gridFor, gridHasRoom, gridReveal, rowNeed, sharedColumns, showcasePlaces } from '../src/features/aircraft-setup/showcase-layout.ts';
import { LiverySends, LiveryStepper } from '../src/features/aircraft-setup/livery-stepper.ts';
import { orderLiveries } from '../src/sim/livery-order.ts';
import {
  favoriteLiveriesOf,
  findFavoriteLivery,
  FAVORITE_LIVERIES_CHANGED,
  dropAircraftUses,
  dropFavoriteAircraft,
  saveFavoriteLiveries,
  favoriteLiveriesFrom,
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
  // A variant tile and its gap at 1080 lines (36 + 6).
  const variant = 42;

  it('puts up to three variants per row, fewer when the widest name needs it', () => {
    assert.equal(variantsPerRow(8, 480, 100, 6), 3);
    assert.equal(variantsPerRow(8, 480, 200, 6), 2);
    assert.equal(variantsPerRow(8, 480, 300, 6), 1);
    assert.equal(variantsPerRow(2, 480, 100, 6), 2, 'no more per row than variants');
    assert.equal(variantsPerRow(0, 480, 100, 6), 1);
    assert.equal(rowCount(7, 3), 3);
    assert.equal(rowCount(0, 3), 0);
  });

  it('gives the variants what they need when it fits, never more than the room', () => {
    assert.equal(variantsHeight(600, { count: 2, step: variant }), 84);
    assert.equal(variantsHeight(600, { count: 0, step: variant }), 0);
    assert.equal(variantsHeight(250.6, { count: 30, step: variant }), 250, 'iFly 737 MAX: one variant per livery');
    assert.equal(variantsHeight(-20, { count: 10, step: variant }), 0);
  });

  it('tells when a list scrolls, with the pixel its height loses when rounded down', () => {
    assert.equal(overflows({ count: 3, step: variant }, 126), false);
    assert.equal(overflows({ count: 3, step: variant }, 125.6), false);
    assert.equal(overflows({ count: 3, step: variant }, 125), false);
    assert.equal(overflows({ count: 3, step: variant }, 124.9), true);
  });

  it('shows the statistics only when the variants keep all they need', () => {
    const statistics = { count: 3, row: 36, unit: 1, gap: 6 };
    assert.equal(statisticsRoom(statistics, 500, 386), 114);
    assert.equal(statisticsRoom(statistics, 500, 387), 0, 'the list would scroll');
    assert.equal(statisticsRoom({ ...statistics, count: 0 }, 500, 0), 0);
    assert.equal(statisticsRoom({ ...statistics, unit: 1.078 }, 500, 0), 123, 'rounded up');
  });

  it('does not scroll a list given its whole rows rounded down (measured 2026-10-30, 1164 lines)', () => {
    // Two rows of 42 units at 1.078 pixels per unit: 90.55 pixels, the list 90 high (variantsHeight rounds down).
    const rows = { count: 2, step: 42 * 1.078 };
    const height = variantsHeight(90.9, rows);
    assert.equal(height, 90);
    assert.equal(overflows(rows, height), false);
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
      datastorage: { getData: (key: string) => data.get(key), setData: (key: string, value: string) => data.set(key, value), deleteData: (key: string) => data.delete(key) },
    };
    (globalThis as { document?: unknown }).document = target;
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it('drops the favourite aircraft of earlier versions once, and keeps the favourite liveries', () => {
    data.set('MSFS_UI_FAVORITE_AIRCRAFT', JSON.stringify(['v1', { variationId: 'v2', displayName: 'Caravan' }]));
    data.set('MSFS_UI_FAVORITE_LIVERIES', '[]');
    assert.equal(dropFavoriteAircraft(), 2);
    assert.equal(data.has('MSFS_UI_FAVORITE_AIRCRAFT'), false);
    assert.equal(data.get('MSFS_UI_FAVORITE_LIVERIES'), '[]');
    assert.equal(dropFavoriteAircraft(), 0, 'nothing left to drop');
  });

  it('drops the last uses of earlier versions once, and keeps the favourite liveries', () => {
    data.set('MSFS_UI_AIRCRAFT_USES', JSON.stringify({ v1: { usedAt: 5 } }));
    data.set('MSFS_UI_FAVORITE_LIVERIES', '[]');
    assert.equal(dropAircraftUses(), true);
    assert.equal(data.has('MSFS_UI_AIRCRAFT_USES'), false);
    assert.equal(data.get('MSFS_UI_FAVORITE_LIVERIES'), '[]');
    assert.equal(dropAircraftUses(), false, 'nothing left to drop');
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

describe('favourite liveries read from the storage', () => {
  const red = { variationId: 'v1', dir: 'simobjects/a/red', title: 'Red', image: 'r.png' };

  it('keeps the well-formed favourite liveries, their optional fields when they have their type', () => {
    const full = { ...red, displayName: 'Phenom 300E', creator: 'FSReborn', variation: 'Manchester', usedAt: 1000 };
    assert.deepEqual(favoriteLiveriesFrom([full, red]), [full, red]);
    assert.deepEqual(favoriteLiveriesFrom([{ ...red, displayName: 7, usedAt: 'today' }]), [red]);
  });

  it('drops a favourite without its variant, folder, title or image, and a value that is not a list', () => {
    assert.deepEqual(favoriteLiveriesFrom([null, 'red', { ...red, dir: undefined }, { ...red, title: 3 }, red]), [red]);
    assert.deepEqual(favoriteLiveriesFrom({ 0: red }), []);
  });
});

describe('showcase panel layout', () => {
  const sizes: ReadonlyArray<[number, number, number]> = [
    [691, 932, 1.333],
    [691, 765, 1.333],
    [386, 520, 0.741],
    [920, 1240, 2],
  ];

  it('showcasePlaces keeps every part in place', () => {
    for (const [width, height, unit] of sizes) {
      for (const scrolls of [false, true]) {
        const gap = Math.round(6 * unit);
        const row = Math.round(30 * unit);
        const bar = scrolls ? Math.round(24 * unit) : 0;
        const headerHeight = Math.round(24 * unit);
        const places = showcasePlaces(width, height, headerHeight, unit, scrolls);
        const { variants, header, livery, grid, bottom } = places;
        assert.equal(variants.top, Math.round(6 * unit));
        assert.equal(variants.height, headerHeight);
        assert.equal(header.top, variants.top + variants.height + gap);
        assert.equal(header.height, headerHeight);
        assert.equal(livery.top, header.top + header.height + gap);
        assert.equal(livery.height, Math.round(width * 0.47));
        assert.equal(grid.top, livery.top + livery.height + gap);
        assert.equal(grid.top + grid.height + gap, bottom.top);
        assert.equal(bottom.top + bottom.height, height);
        assert.equal(bottom.height, 2 * row + gap);
        assert.equal(grid.thumbWidth, Math.floor((width - 3 * gap - bar) / 4));
        assert.equal(grid.thumbHeight, Math.round(grid.thumbWidth * 0.47));
        assert.equal(grid.rowStep, grid.thumbHeight + gap);
        for (const span of [variants, header, livery, grid, bottom]) assert.ok(Number.isInteger(span.top) && Number.isInteger(span.height));
        assert.ok(Number.isInteger(grid.thumbWidth) && Number.isInteger(grid.thumbHeight) && Number.isInteger(grid.rowStep));
      }
    }
  });

  it('showcasePlaces on the owner panel (691 x 765, unit 1.333)', () => {
    const places = showcasePlaces(691, 765, 32, 1.333, false);
    assert.deepEqual(places.variants, { top: 8, height: 32 });
    assert.deepEqual(places.header, { top: 48, height: 32 });
    assert.deepEqual(places.livery, { top: 88, height: 325 });
    assert.equal(places.grid.thumbWidth, 166);
    assert.equal(places.grid.thumbHeight, 78);
    assert.equal(places.grid.rowStep, 86);
    assert.deepEqual(places.bottom, { top: 765 - 88, height: 88 });
    assert.equal(showcasePlaces(691, 765, 32, 1.333, true).grid.thumbWidth, Math.floor((691 - 24 - 32) / 4));
  });

  it('gives the same places whatever the aircraft: they depend on the size only', () => {
    assert.deepEqual(showcasePlaces(691, 932, 32, 1.333, true), showcasePlaces(691, 932, 32, 1.333, true));
  });

  const needs = { tail: 120, field: 150, fuel: 160, identification: 200, configure: 250 };

  it('bottomColumns shares one vertical line between the right column\'s rows, the tile the rest', () => {
    // First column max(120, 160) = 160, second max(150, 200) = 200: 160 + 8 + 200 = 368; the tile 691 - 8 - 368 = 315.
    assert.deepEqual(bottomColumns(691, 8, needs), { configure: 315, right: 368, tailTitle: 160, fuel: 160 });
    // A wider tail title and field: 200 + 8 + 210 = 418.
    assert.deepEqual(bottomColumns(691, 8, { ...needs, tail: 200, field: 210 }), { configure: 265, right: 418, tailTitle: 200, fuel: 200 });
    const columns = bottomColumns(691, 8, { ...needs, tail: 120.2, field: 250.1 });
    assert.ok(columns);
    assert.equal(columns.configure + 8 + columns.right, 691);
    assert.ok(Object.values(columns).every(Number.isInteger));
  });

  it('bottomColumns is null when the tile does not get its need', () => {
    assert.ok(bottomColumns(626, 8, needs), 'exactly the need');
    assert.equal(bottomColumns(625, 8, needs), null);
  });

  it('rowNeed adds the right column, the gap and the tile, rounded up', () => {
    assert.equal(rowNeed(needs, 8), 368 + 8 + 250);
    assert.equal(rowNeed({ ...needs, fuel: 160.2, configure: 249.5 }, 8), 369 + 8 + 250);
    assert.equal(rowNeed({ ...needs, tail: 200, field: 210 }, 8), 200 + 8 + 210 + 8 + 250);
  });

  it('columnExtra widens the left column to the bottom block, in whole units (measured 2026-11-01 at 1440 lines)', () => {
    // A need of 515 pixels, the column 2 pixels wider than the panel, the sim's 470 units.
    const extra = columnExtra(515, 2, 4 / 3, 470);
    assert.equal(extra, Math.ceil(518 / (4 / 3) - 470));
    assert.ok(Math.floor((470 + extra) * (4 / 3)) - 2 >= 515, 'the block fits at that extra');
    assert.ok(Math.floor((470 + extra - 1) * (4 / 3)) - 2 < 516, 'one unit less is too narrow');
    assert.equal(columnExtra(515, 2, 1, 470), 48, 'at 1080 lines');
    assert.ok(columnExtra(400, 2, 1, 470) < 0, 'a short block needs no extra: the option decides');
  });

  it('gridCell places the liveries four to a row, row-major', () => {
    assert.deepEqual([0, 3, 4, 9].map(gridCell), [
      { row: 0, column: 0 },
      { row: 0, column: 3 },
      { row: 1, column: 0 },
      { row: 2, column: 1 },
    ]);
  });

  it('gridReveal keeps a whole row in view, aligns another on the edge it was beyond, within the scroll range', () => {
    // Thumbnails 79 high, rows 87 apart, a view of 270 (3 rows plus 9, the third ending at 253), 10 rows: at most 862 - 270 = 592.
    const reveal = (row: number, scroll: number, max = 592) => gridReveal(row, 87, 79, 270, scroll, max);
    assert.equal(reveal(0, 0), null);
    assert.equal(reveal(2, 0), null, 'ends at 253');
    assert.equal(reveal(3, 0), 3 * 87 + 79 - 270, 'cut at the bottom: its thumbnails on the view bottom, less than a row');
    assert.ok(reveal(3, 0)! < 87);
    assert.equal(reveal(9, 0), 592, 'the last row: the end of the grid');
    assert.equal(reveal(5, 0), 5 * 87 + 79 - 270, 'beyond the bottom: on the view bottom');
    assert.equal(reveal(1, 200), 87, 'cut at the top: on the top');
    assert.equal(reveal(0, 400), 0, 'above the view: on the top');
    assert.equal(reveal(1, 0, 0), null, 'nothing to scroll');
    assert.equal(gridReveal(3, 87, 79, 340, 0, 0), null, 'a row that ends on the view bottom without its gap is whole');
  });

  it('gridFor depends on the count and the sizes only: wide when the rows fit, scrolling when they fit in neither form', () => {
    // A grid 248 high. Wide: 166 x 78, rows 86 apart: 2 rows (164) fit, 3 rows (250) do not. Narrow: 158 x 74, 82 apart:
    // 3 rows (238) fit, 4 rows (320) do not.
    const wide = showcasePlaces(691, 765, 32, 1.333, false).grid;
    const narrow = showcasePlaces(691, 765, 32, 1.333, true).grid;
    assert.equal(wide.height, 248);
    assert.deepEqual(gridFor(0, wide, narrow), wide);
    assert.deepEqual(gridFor(8, wide, narrow), wide);
    assert.deepEqual(gridFor(13, wide, narrow), narrow);
    assert.deepEqual(gridFor(27, wide, narrow), narrow);
    assert.equal(narrow.scrolls, true);
    assert.equal(narrow.top, wide.top);
    assert.equal(narrow.height, wide.height, 'the scroll bar changes only the thumbnails');
  });

  it('gridFor lowers the wide thumbnails when only the narrow rows would fit: on the panel edges, no bar, no list that does not scroll', () => {
    const wide = showcasePlaces(691, 765, 32, 1.333, false).grid;
    const narrow = showcasePlaces(691, 765, 32, 1.333, true).grid;
    for (const count of [9, 12]) {
      const grid = gridFor(count, wide, narrow);
      assert.equal(grid.scrolls, false);
      assert.equal(grid.thumbWidth, wide.thumbWidth);
      assert.equal(grid.lastWidth, wide.lastWidth);
      assert.equal(grid.thumbHeight, 77, 'three rows of 77 and two gaps of 8 in 248');
      assert.equal(grid.rowStep, 85);
      assert.ok(3 * grid.thumbHeight + 2 * 8 <= grid.height);
    }
  });

  it('the fourth column takes what the whole pixels leave: the grid ends on the panel edge, or on the bar room', () => {
    for (const [width, height, unit] of sizes) {
      const gap = Math.round(6 * unit);
      const wide = showcasePlaces(width, height, Math.round(36 * unit), unit, false).grid;
      assert.equal(3 * (wide.thumbWidth + gap) + wide.lastWidth, width);
      assert.ok(wide.lastWidth >= wide.thumbWidth && wide.lastWidth < wide.thumbWidth + 4);
      const narrow = showcasePlaces(width, height, Math.round(36 * unit), unit, true).grid;
      assert.equal(3 * (narrow.thumbWidth + gap) + narrow.lastWidth, width - Math.round(24 * unit));
    }
  });

  it('gridHasRoom wants at least one row, its gap included', () => {
    assert.equal(gridHasRoom({ height: 86, thumbHeight: 78, rowStep: 86 }), true);
    assert.equal(gridHasRoom({ height: 85, thumbHeight: 78, rowStep: 86 }), false);
    assert.equal(gridHasRoom({ height: 0, thumbHeight: 0, rowStep: 8 }), false, 'the panel still animating');
    assert.equal(gridHasRoom({ height: 300, thumbHeight: 0, rowStep: 8 }), false, 'no width yet: no thumbnail');
  });

  it('sharedColumns shares the block in halves, whole pixels, until the needs are measured', () => {
    const columns = sharedColumns(691, 8);
    assert.deepEqual(columns, { configure: 342, right: 341, tailTitle: 166, fuel: 166 });
    assert.equal(columns.configure + 8 + columns.right, 691);
  });
});

describe('livery stepper', () => {
  const three = ['a', 'b', 'c'];

  it('has nothing to show or step without liveries', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', [], null);
    assert.equal(stepper.shown(), null);
    assert.equal(stepper.position(), null);
    assert.equal(stepper.canStep(-1), false);
    assert.equal(stepper.canStep(1), false);
    assert.equal(stepper.step(1), null);
    assert.equal(stepper.pending(), null);
  });

  it('cannot step with one livery', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', ['a'], 'a');
    assert.deepEqual(stepper.position(), { index: 1, count: 1 });
    assert.equal(stepper.canStep(-1), false);
    assert.equal(stepper.canStep(1), false);
  });

  it('steps to the end and stays there', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    assert.equal(stepper.canStep(-1), false);
    assert.equal(stepper.canStep(1), true);
    assert.equal(stepper.step(1), 'b');
    assert.equal(stepper.step(1), 'c');
    assert.equal(stepper.shown(), 'c');
    assert.equal(stepper.pending(), 'c');
    assert.deepEqual(stepper.position(), { index: 3, count: 3 });
    assert.equal(stepper.canStep(1), false);
    assert.equal(stepper.canStep(-1), true);
    assert.equal(stepper.step(1), 'c');
    assert.equal(stepper.pending(), 'c');
  });

  it('takes the wheel steps whole and clamps them', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    assert.equal(stepper.step(5), 'c');
    assert.equal(stepper.step(-1), 'b');
    assert.equal(stepper.step(-9), 'a');
  });

  it('chooses a listed livery directly, from the shown one, and ignores one not listed', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    assert.equal(stepper.choose('c'), 'c');
    assert.equal(stepper.pending(), 'c');
    assert.deepEqual(stepper.position(), { index: 3, count: 3 });
    assert.equal(stepper.choose('unavailable'), 'c', 'an unavailable livery is not in the list');
    assert.equal(stepper.pending(), 'c');
    assert.equal(stepper.choose('a'), 'a');
    assert.equal(stepper.pending(), null, 'back on the current livery: nothing to send');
  });

  it('chooses against the sent livery until the sim reports it', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.choose('b');
    stepper.sent();
    assert.equal(stepper.choose('b'), 'b');
    assert.equal(stepper.pending(), null, 'the sent one: nothing more to send');
    assert.equal(stepper.choose('a'), 'a');
    assert.equal(stepper.pending(), 'a');
  });

  it('keeps the pending step over a reload that still reports the old livery', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    stepper.setLiveries('plane', three, 'a');
    assert.equal(stepper.shown(), 'b');
    assert.equal(stepper.pending(), 'b');
  });

  it('clears the pending step when the reload reports it', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    stepper.setLiveries('plane', three, 'b');
    assert.equal(stepper.pending(), null);
    assert.equal(stepper.shown(), 'b');
  });

  it('drops a pending step that left the list', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(2);
    stepper.setLiveries('plane', ['a', 'b'], 'a');
    assert.equal(stepper.pending(), null);
    assert.equal(stepper.shown(), 'a');
  });

  it('drops the pending step for another aircraft', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    stepper.setLiveries('other', ['x', 'y'], 'y');
    assert.equal(stepper.pending(), null);
    assert.equal(stepper.shown(), 'y');
  });

  it('steps from the shown livery, not the configurator one', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    assert.equal(stepper.step(1), 'c');
    assert.equal(stepper.step(-1), 'b');
  });

  it('changes nothing when a step does not move, and clears the pending step when it lands on the current livery', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    assert.equal(stepper.step(-1), 'a');
    assert.equal(stepper.pending(), null);
    stepper.step(1);
    assert.equal(stepper.step(1), 'c');
    assert.equal(stepper.step(1), 'c');
    assert.equal(stepper.pending(), 'c');
    stepper.step(-2);
    assert.equal(stepper.pending(), null);
    assert.equal(stepper.shown(), 'a');
  });

  it('starts from the first livery when the current one is not listed', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'zzz');
    assert.equal(stepper.step(1), 'b');
  });

  it('forgets the pending step once sent, and shows it until the sim reports it', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    stepper.sent();
    assert.equal(stepper.pending(), null);
    assert.equal(stepper.shown(), 'b');
    stepper.setLiveries('plane', three, 'a');
    assert.equal(stepper.shown(), 'b');
    assert.deepEqual(stepper.position(), { index: 2, count: 3 });
  });

  it('releases the sent livery when a reload reports it', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    stepper.sent();
    stepper.setLiveries('plane', three, 'b');
    assert.equal(stepper.shown(), 'b');
    stepper.setLiveries('plane', three, 'c');
    assert.equal(stepper.shown(), 'c');
  });

  it('drops the sent livery on another aircraft or when it leaves the list', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    stepper.sent();
    stepper.setLiveries('other', ['x', 'y'], 'y');
    assert.equal(stepper.shown(), 'y');
    stepper.setLiveries('plane', three, 'a');
    stepper.step(2);
    stepper.sent();
    stepper.setLiveries('plane', ['a', 'b'], 'a');
    assert.equal(stepper.shown(), 'a');
  });

  it('steps from the sent livery before the reload', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    stepper.sent();
    assert.equal(stepper.canStep(-1), true);
    assert.equal(stepper.step(1), 'c');
    assert.equal(stepper.pending(), 'c');
  });

  it('sets pending when stepping back to the current livery while a sent one waits', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    stepper.sent();
    assert.equal(stepper.step(-1), 'a');
    assert.equal(stepper.pending(), 'a');
    stepper.setLiveries('plane', three, 'a');
    assert.equal(stepper.pending(), 'a');
  });

  it('returns to the current livery when the sent one is abandoned', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    stepper.step(1);
    stepper.sent();
    stepper.abandonSent();
    assert.equal(stepper.shown(), 'a');
  });

  it('has no position when the shown livery is not listed', () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'zzz');
    assert.equal(stepper.position(), null);
    assert.equal(stepper.shown(), 'zzz');
    assert.equal(stepper.canStep(-1), false);
    assert.equal(stepper.canStep(1), true);
  });
});

describe('livery sends', () => {
  const three = ['a', 'b', 'c'];
  const make = () => {
    const stepper = new LiveryStepper();
    stepper.setLiveries('plane', three, 'a');
    return { stepper, sends: new LiverySends(stepper) };
  };

  it('sends quick steps once, the last one shown', () => {
    const { stepper, sends } = make();
    stepper.step(1);
    stepper.step(1);
    const sent = sends.take();
    assert.deepEqual(sent, { id: 'c', number: 1, overSent: false });
    assert.equal(sends.take(), null, 'nothing left to send');
    assert.equal(stepper.shown(), 'c');
  });

  it('lets only the last send give the livery back to the sim', () => {
    const { stepper, sends } = make();
    stepper.step(1);
    const first = sends.take()!;
    stepper.step(1);
    const second = sends.take()!;
    assert.equal(sends.answered(first.number, false), false, 'an older refusal changes nothing');
    assert.equal(stepper.shown(), 'c');
    assert.equal(sends.answered(second.number, true), false);
    assert.equal(stepper.shown(), 'c');
    assert.equal(sends.answered(second.number, false), true);
    assert.equal(stepper.shown(), 'a');
  });

  it('sends a step taken after a send', () => {
    const { stepper, sends } = make();
    stepper.step(1);
    const first = sends.take()!;
    stepper.step(1);
    assert.equal(stepper.shown(), 'c');
    assert.equal(sends.answered(first.number, true), false);
    assert.deepEqual(sends.take(), { id: 'c', number: 2, overSent: true });
  });

  it('sends a return to the livery the sim is leaving as following a send not reported yet', () => {
    const { stepper, sends } = make();
    stepper.step(1);
    sends.take();
    // Before any reload reports b, the user goes back to a: the state read still lists a as selected.
    stepper.choose('a');
    assert.deepEqual(sends.take(), { id: 'a', number: 2, overSent: true });
    stepper.setLiveries('plane', three, 'a');
    assert.equal(stepper.awaited(), null, 'reported');
    stepper.step(1);
    assert.equal(sends.take()!.overSent, false, 'nothing awaited any more');
  });

  it('abandons the last send taken and never reported, not an older one nor one reported', () => {
    const { stepper, sends } = make();
    stepper.step(1);
    const first = sends.take()!;
    stepper.step(1);
    const second = sends.take()!;
    assert.equal(sends.isLast(first.number), false);
    assert.equal(sends.isLast(second.number), true);
    assert.equal(sends.expired(first.number), false, 'an older send');
    assert.equal(stepper.shown(), 'c');
    assert.equal(sends.expired(second.number), true);
    assert.equal(stepper.shown(), 'a', 'the configurator again');
    assert.equal(sends.expired(second.number), false, 'once');

    stepper.step(1);
    const third = sends.take()!;
    stepper.setLiveries('plane', three, 'b');
    assert.equal(sends.expired(third.number), false, 'reported meanwhile');
    assert.equal(stepper.shown(), 'b');
  });

  it('drops a step not sent yet (another variant chosen)', () => {
    const { stepper, sends } = make();
    stepper.step(1);
    stepper.drop();
    assert.equal(sends.take(), null);
    assert.equal(stepper.shown(), 'a');
  });
});
