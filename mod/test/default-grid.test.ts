import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barColumns, columnOf, defaultGrid, shareTabs, VIEW_TAB_UNITS } from '../src/features/aircraft-gallery/default-grid.ts';

describe('default grid', () => {
  it('sizes the owner\'s screen: three columns, the banner over its three lines', () => {
    assert.deepEqual(defaultGrid(1614, 854, 1440 / 1080), { columns: 3, gap: 32, tileWidth: 516, gridWidth: 1612, tileHeight: 411, imageHeight: 246 });
  });

  it('keeps three columns when the banner fits', () => {
    const grid = defaultGrid(1210, 600, 1);
    assert.equal(grid.columns, 3);
    assert.equal(grid.tileWidth, 387);
    assert.equal(grid.imageHeight, 185);
    assert.equal(grid.tileHeight, 288);
    assert.ok(grid.tileHeight - grid.imageHeight >= 75);
  });

  it('adds columns until the banner fits when the rows are short', () => {
    const grid = defaultGrid(1210, 420, 1);
    assert.equal(grid.tileHeight, 198);
    assert.ok(grid.tileHeight - grid.imageHeight >= 75, `banner ${grid.tileHeight - grid.imageHeight}`);
    assert.ok(grid.columns > 3);
  });

  it('gives one column to a narrow room', () => {
    assert.equal(defaultGrid(300, 854, 1440 / 1080).columns, 1);
  });
});

describe('columnOf', () => {
  it('fills the first column before the second one, row by row', () => {
    assert.deepEqual(columnOf(0), { column: 0, row: 0 });
    assert.deepEqual(columnOf(1), { column: 0, row: 1 });
    assert.deepEqual(columnOf(4), { column: 2, row: 0 });
  });
});

describe('barColumns', () => {
  const unit = 1440 / 1080;
  it("puts the bar's three parts over the owner's three columns", () => {
    // Measured on the owner's screen (3440 x 1440): 3 columns of 516 pixels, 32 apart, 1612 in all.
    const grid = { columns: 3, tileWidth: 516, tileHeight: 404, imageHeight: 246, gap: 32, gridWidth: 1612 };
    assert.deepEqual(barColumns(grid, unit), { first: { left: 0, right: 516 }, middle: { left: 548, right: 1064 }, last: { left: 1096, right: 1612 } });
  });

  it('gives the middle part every column between the first and the last', () => {
    const grid = { columns: 4, tileWidth: 379, tileHeight: 404, imageHeight: 181, gap: 32, gridWidth: 1612 };
    assert.deepEqual(barColumns(grid, 1), { first: { left: 0, right: 379 }, middle: { left: 411, right: 1201 }, last: { left: 1233, right: 1612 } });
  });

  it('keeps one line under three columns, or when a part is too narrow for its controls', () => {
    assert.equal(barColumns({ columns: 2, tileWidth: 791, tileHeight: 404, imageHeight: 377, gap: 32, gridWidth: 1614 }, unit), null);
    // 300 pixels at one pixel per unit: under the 356 units of Hidden, Favorites and the dropdown.
    assert.equal(barColumns({ columns: 3, tileWidth: 300, tileHeight: 300, imageHeight: 143, gap: 24, gridWidth: 948 }, 1), null);
  });
});
describe('view tabs', () => {
  it('shares the room equally in whole pixels, the last tab taking the rest', () => {
    assert.deepEqual(shareTabs(330, 3), [110, 110, 110]);
    assert.deepEqual(shareTabs(332, 3), [110, 110, 112]);
    assert.deepEqual(shareTabs(331, 3), [110, 110, 111]);
  });

  it('keeps the bar over the columns at the minimum last column, and on one line below it', () => {
    const min = 30 + 3 * (6 + VIEW_TAB_UNITS);
    const grid = (last: number) => ({ columns: 3, tileWidth: last, tileHeight: 404, imageHeight: 246, gap: 32, gridWidth: 3 * last + 64 });
    assert.notEqual(barColumns(grid(min), 1), null);
    assert.equal(barColumns(grid(min - 1), 1), null);
  });
});
