import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dropdownListToward, dropdownListWithin, dropdownScrollPosition } from '../src/sim/dropdown-list.ts';

describe('the sim dropdown list toward an obstacle under it', () => {
  const metrics = { item: 33, edge: 6, padding: 9, spacing: 3 };
  const toward = (count: number, below: number, gap: number, least: number, above = 300, unit = 1) =>
    dropdownListToward({ count, below, gap, least, above, unit }, metrics, 3);

  it('shows the whole items that leave the gap nearest the wanted one, the next item under the bottom edge', () => {
    // 33 n + 3 units, half a pixel more: gaps of 56 (7 items) and 23 (8 items) above the obstacle, 24 wanted.
    assert.deepEqual(toward(100, 290, 24, 6), { up: false, size: 267.5 });
    // Gaps of 41 (7 items) and 8 (8 items): 8 is the nearer.
    assert.deepEqual(toward(100, 275, 24, 6), { up: false, size: 267.5 });
    // Gaps of 41 (7) and 8 (8): 8 is nearer but under the least gap of 10.
    assert.deepEqual(toward(100, 275, 24, 10), { up: false, size: 234.5 });
    // Gaps of 41 (8 items) and 8 (9 items), 30 wanted: 41 is the nearer.
    assert.deepEqual(toward(100, 308, 30, 0), { up: false, size: 267.5 });
  });

  it("measures the half pixel in the window's pixels", () => {
    assert.deepEqual(toward(100, 290, 24, 6, 300, 4 / 3), { up: false, size: 267.375 });
  });

  it('is as tall as its items, the sim edge under the last, when they all fit', () => {
    assert.deepEqual(toward(4, 300, 24, 6), { up: false, size: 141 });
    // Eight items: 273 units, a gap of 27 (the nearest); seven would leave 66.
    assert.deepEqual(toward(8, 300, 24, 6), { up: false, size: 273 });
    // Two items, fewer than the least three, open downwards when they fit.
    assert.deepEqual(toward(2, 100, 24, 6), { up: false, size: 75 });
  });

  it('opens upwards when fewer than the least items fit above the obstacle, one item at least', () => {
    // Two items leave 31, three would pass the obstacle: upwards, eight items in 290 units (nine need 300).
    assert.deepEqual(toward(10, 100, 24, 6, 290), { up: true, size: 267.5 });
    assert.deepEqual(toward(10, 100, 24, 6, 0), { up: true, size: 36.5 });
    assert.deepEqual(toward(5, 100, 24, 6), { up: true, size: 174 });
  });
});

describe('the sim dropdown list scrolled to an item', () => {
  it('opens at the top for no item or the first', () => {
    assert.equal(dropdownScrollPosition({ index: -1, step: 36, height: 32, edge: 6, max: 1000 }), 0);
    assert.equal(dropdownScrollPosition({ index: 0, step: 36, height: 32, edge: 6, max: 1000 }), 0);
  });

  it('shows the previous item whole above the top: the edge less the gap between items past the whole steps', () => {
    assert.equal(dropdownScrollPosition({ index: 3, step: 36, height: 32, edge: 6, max: 1000 }), 110);
    assert.equal(dropdownScrollPosition({ index: 3, step: 36, height: 32, edge: 0, max: 1000 }), 108);
  });

  it('rounds up to a whole pixel, as the sim scrolls', () => {
    // 1164 lines (measured): 5 x 35.567 + 6 - 3.567 = 180.268; 7 x 35.567 + 2.433 = 251.402; 9 x 35.567 + 2.433 = 322.536, rounded up.
    assert.equal(dropdownScrollPosition({ index: 5, step: 35.567, height: 32, edge: 6, max: 10000 }), 181);
    assert.equal(dropdownScrollPosition({ index: 7, step: 35.567, height: 32, edge: 6, max: 10000 }), 252);
    assert.equal(dropdownScrollPosition({ index: 9, step: 35.567, height: 32, edge: 6, max: 10000 }), 323);
  });

  it('stops at the end of the list', () => {
    assert.equal(dropdownScrollPosition({ index: 30, step: 36, height: 32, edge: 6, max: 500 }), 500);
  });
});

describe('the sim dropdown list ending on a given line', () => {
  const metrics = { item: 33, edge: 6, padding: 9, spacing: 3 };

  it('is as high as the room, the sim scroll filling it, when all the items fit', () => {
    assert.deepEqual(dropdownListWithin({ count: 5, below: 321, unit: 1 }, metrics), { size: 321.5, scroll: null });
  });

  it('keeps whole items in its scrolling area and the room left empty at the bottom when they scroll', () => {
    // 321: nine whole items take 300 (33 x 9 + 3), a tenth would take 333: 21 left under the scrolling area.
    assert.deepEqual(dropdownListWithin({ count: 20, below: 321, unit: 1 }, metrics), { size: 321.5, scroll: 300 });
    assert.deepEqual(dropdownListWithin({ count: 20, below: 321, unit: 4 / 3 }, metrics), { size: 321.375, scroll: 300 });
    // Ten items need 339 (33 x 10 + 9), more than 321: they scroll, nine whole ones.
    assert.deepEqual(dropdownListWithin({ count: 10, below: 321, unit: 1 }, metrics), { size: 321.5, scroll: 300 });
  });
});
