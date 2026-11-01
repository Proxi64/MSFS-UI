import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { overflows, rowCount, statisticsRoom, variantsHeight, variantsPerRow } from '../src/features/aircraft-setup/setup-layout.ts';
import { bottomColumns, columnExtra, gridCell, gridReveal, panelHasRoom, rowNeed, sharedColumns, showcaseColumnExtra, showcasePlaces } from '../src/features/aircraft-setup/showcase-layout.ts';
import { LiverySends, LiveryStepper } from '../src/features/aircraft-setup/livery-stepper.ts';
import { firstAvailableLivery, orderLiveries } from '../src/sim/livery-order.ts';
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

describe('firstAvailableLivery', () => {
  const on = (id: string, isDisabled = false) => ({ id, isDisabled });
  it("is the first of the panel's order: favourites first, each part in the sim's order", () => {
    assert.equal(firstAvailableLivery([on('v1:0'), on('v1:1'), on('v1:2')], () => false)!.id, 'v1:0');
    assert.equal(firstAvailableLivery([on('v1:0'), on('v1:1'), on('v1:2')], (item) => item.id === 'v1:2')!.id, 'v1:2');
  });
  it('skips an unavailable livery; null when none is left', () => {
    assert.equal(firstAvailableLivery([on('v1:0', true), on('v1:1')], () => false)!.id, 'v1:1');
    assert.equal(firstAvailableLivery([on('v1:0', true), on('v1:1')], (item) => item.id === 'v1:0')!.id, 'v1:1');
    assert.equal(firstAvailableLivery([on('v1:0', true)], () => false), null);
    assert.equal(firstAvailableLivery([], () => false), null);
  });
});

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
  // A panel from the title block's bottom to the bottom block's: width, height, pixels per unit. The owner's window
  // (2161 x 1164), 1920 x 1080, 2560 x 1440 and 3840 x 2160 as measured on 1.9.21, and the other ends of the range.
  const sizes: ReadonlyArray<[number, number, number]> = [
    [558, 630, 1164 / 1080],
    [523, 585, 1],
    [699, 780, 1440 / 1080],
    [1046, 1170, 2],
    [349, 390, 720 / 1080],
    [2092, 2340, 4],
  ];
  const headerOf = (unit: number) => Math.round(36 * unit);

  it('showcasePlaces shares the room in equal gaps, whole pixels, the rounding to the large livery', () => {
    for (const [width, height, unit] of sizes) {
      for (const count of [0, 3, 6, 7, 27]) {
        const places = showcasePlaces(width, height, headerOf(unit), unit, count);
        const { gap, variants, header, livery, grid, bottom } = places;
        assert.equal(variants.top, gap, 'one gap under the title block');
        assert.equal(header.top, variants.top + variants.height + gap);
        assert.equal(livery.top, header.top + header.height + gap);
        assert.equal(grid.top, livery.top + livery.height + gap);
        assert.equal(bottom.top, grid.top + grid.height + gap);
        assert.equal(bottom.top + bottom.height, height);
        assert.ok(gap >= Math.round(6 * unit), `the gap ${gap} at ${unit}`);
        assert.equal(variants.height, headerOf(unit));
        assert.equal(header.height, headerOf(unit));
        const rest = livery.height - Math.round(width * 0.47);
        assert.ok(rest >= 0 && rest < 5, `the rounding ${rest}`);
        assert.equal(places.cropped, false);
        for (const span of [variants, header, livery, grid, bottom]) assert.ok(Number.isInteger(span.top) && Number.isInteger(span.height));
      }
    }
  });

  it('showcasePlaces on the owner\'s window: the mockup\'s numbers', () => {
    const places = showcasePlaces(558, 630, 39, 1164 / 1080, 16);
    assert.equal(places.gap, 10);
    assert.deepEqual(places.variants, { top: 10, height: 39 });
    assert.deepEqual(places.header, { top: 59, height: 39 });
    assert.deepEqual(places.livery, { top: 108, height: 262 });
    assert.equal(places.grid.top, 380);
    assert.equal(places.grid.thumbWidth, 174);
    assert.equal(places.grid.thumbHeight, 82);
    assert.equal(places.grid.height, 170, 'two rows and their gap');
    assert.deepEqual(places.bottom, { top: 560, height: 70 });
    assert.equal(showcasePlaces(558, 632, 39, 1164 / 1080, 16).livery.height, 264, 'the 2 pixels of rounding go to the large livery');
  });

  it('the gaps are about 7.8 units at the default column, at every resolution', () => {
    for (const [width, height, unit] of sizes.slice(1)) {
      const { gap } = showcasePlaces(width, height, headerOf(unit), unit, 0);
      assert.ok(gap / unit > 6.9 && gap / unit < 8.5, `${gap} pixels at ${unit}`);
    }
  });

  it('gives the same places whatever the aircraft: the number of liveries changes the grid only', () => {
    const { grid: few, ...one } = showcasePlaces(558, 632, 39, 1164 / 1080, 3);
    for (const count of [0, 6, 7, 400]) {
      const { grid, ...other } = showcasePlaces(558, 632, 39, 1164 / 1080, count);
      assert.deepEqual(other, one);
      assert.equal(grid.top, few.top);
      assert.equal(grid.height, few.height);
      assert.equal(grid.thumbWidth, few.thumbWidth, 'one thumbnail size for every aircraft');
      assert.equal(grid.thumbHeight, few.thumbHeight);
    }
  });

  it('six liveries or fewer: no bar, the three columns from edge to edge, in whole pixels', () => {
    for (const [width, height, unit] of sizes) {
      for (const count of [1, 6]) {
        const { grid } = showcasePlaces(width, height, headerOf(unit), unit, count);
        assert.equal(grid.scrolls, false);
        assert.equal(3 * grid.thumbWidth + grid.columnGap + grid.lastGap, width);
        assert.ok(grid.lastGap - grid.columnGap === 0 || grid.lastGap - grid.columnGap === 1);
      }
    }
  });

  it('more than six: the bar on the right, the columns closer', () => {
    for (const [width, height, unit] of sizes) {
      const { grid } = showcasePlaces(width, height, headerOf(unit), unit, 7);
      const gap = Math.round(6 * unit);
      assert.equal(grid.scrolls, true);
      assert.equal(grid.columnGap, gap);
      assert.equal(grid.lastGap, gap);
      const left = width - (3 * grid.thumbWidth + 2 * gap);
      assert.ok(left >= Math.round(20 * unit) && left < Math.round(20 * unit) + 3, `${left} pixels for the bar`);
    }
  });

  it('two whole rows at most, in the sim\'s proportions', () => {
    for (const [width, height, unit] of sizes) {
      const { grid } = showcasePlaces(width, height, headerOf(unit), unit, 27);
      assert.equal(grid.thumbHeight, Math.round(grid.thumbWidth * 0.47));
      assert.equal(grid.rowStep, grid.thumbHeight + Math.round(6 * unit));
      assert.equal(grid.height, 2 * grid.thumbHeight + Math.round(6 * unit));
      assert.equal(grid.height, 2 * grid.rowStep - (grid.rowStep - grid.thumbHeight));
    }
  });

  it('a column too wide: the gaps at their minimum, the large livery gives up height', () => {
    const places = showcasePlaces(700, 628, 39, 1164 / 1080, 27);
    assert.equal(places.gap, 6);
    assert.equal(places.cropped, true);
    assert.equal(places.livery.height, 628 - 5 * 6 - 2 * 39 - places.grid.height - places.bottom.height);
    assert.ok(places.livery.height < Math.round(700 * 0.47));
    assert.equal(places.bottom.top + places.bottom.height, 628);
  });

  it('panelHasRoom: nothing is laid out while the screen animates', () => {
    assert.equal(panelHasRoom(showcasePlaces(558, 632, 39, 1164 / 1080, 3)), true);
    assert.equal(panelHasRoom(showcasePlaces(558, 300, 39, 1164 / 1080, 3)), false, 'the panel still growing');
    assert.equal(panelHasRoom(showcasePlaces(0, 632, 39, 1164 / 1080, 3)), false, 'no width yet');
  });

  it('showcaseColumnExtra: the option up to about 90 units, the labels above', () => {
    assert.equal(showcaseColumnExtra(50, 0), 50);
    assert.equal(showcaseColumnExtra(90, 0), 90);
    assert.equal(showcaseColumnExtra(200, 0), 90, 'the option has no effect above');
    assert.equal(showcaseColumnExtra(0, 53), 53, 'the labels');
    assert.equal(showcaseColumnExtra(200, 120), 120, 'long labels pass the cap');
    assert.equal(showcaseColumnExtra(-10, -50), -10);
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

  it('gridCell places the liveries three to a row, row-major', () => {
    assert.deepEqual([0, 2, 3, 7].map(gridCell), [
      { row: 0, column: 0 },
      { row: 0, column: 2 },
      { row: 1, column: 0 },
      { row: 2, column: 1 },
    ]);
  });

  it('gridReveal keeps two whole rows in view and moves by whole rows', () => {
    // Rows 88 apart, 10 rows: at most (10 - 2) rows of scroll.
    const reveal = (row: number, scroll: number) => gridReveal(row, 88, scroll, 10);
    assert.equal(reveal(0, 0), null);
    assert.equal(reveal(1, 0), null, 'the second row in view');
    assert.equal(reveal(2, 0), 88, 'one row below: one row down');
    assert.equal(reveal(5, 0), 4 * 88, 'far below: the row last in view');
    assert.equal(reveal(9, 0), 8 * 88, 'the last row: the end');
    assert.equal(reveal(3, 3 * 88), null);
    assert.equal(reveal(4, 3 * 88), null);
    assert.equal(reveal(2, 3 * 88), 2 * 88, 'above: the row first in view');
    assert.equal(reveal(0, 8 * 88), 0);
    assert.equal(gridReveal(1, 88, 0, 2), null, 'two rows: nothing to scroll');
    assert.equal(gridReveal(0, 88, 0, 1), null);
  });

  it('gridReveal puts a scroll left between two rows back on a row', () => {
    assert.equal(gridReveal(1, 88, 40, 10), 0, 'nearest the first row, the second in view');
    assert.equal(gridReveal(1, 88, 50, 10), 88, 'nearest the second row');
    assert.equal(gridReveal(0, 88, 50, 10), 0);
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
