import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { columnOf, defaultGrid, settleColumn, WheelColumns } from '../src/features/aircraft-gallery/default-grid.ts';

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

describe('settleColumn', () => {
  it('settles on the multiple of the step nearest the position', () => {
    assert.equal(settleColumn(0, 548, 3000), 0);
    assert.equal(settleColumn(300, 548, 3000), 548);
    assert.equal(settleColumn(260, 548, 3000), 0);
  });

  it('clamps to the range, max itself when nearer than the last multiple', () => {
    assert.equal(settleColumn(2990, 548, 3000), 3000);
    assert.equal(settleColumn(-20, 548, 3000), 0);
  });
});

describe('columnOf', () => {
  it('fills the first column before the second one, row by row', () => {
    assert.deepEqual(columnOf(0), { column: 0, row: 0 });
    assert.deepEqual(columnOf(1), { column: 0, row: 1 });
    assert.deepEqual(columnOf(4), { column: 2, row: 0 });
  });
});

describe('WheelColumns', () => {
  it('moves one column per notch of a mouse wheel, toward the end or the start', () => {
    const wheel = new WheelColumns();
    assert.equal(wheel.add(100, 0), 1);
    assert.equal(wheel.add(100, 0), 1);
    assert.equal(wheel.add(-100, 0), -1);
    assert.equal(wheel.add(300, 0), 3);
  });

  it('adds up small deltas (a touchpad) into whole columns', () => {
    const wheel = new WheelColumns();
    assert.equal(wheel.add(50, 0), 0);
    assert.equal(wheel.add(50, 0), 1);
    const moves = [30, 30, 30, 30, 30, 30, 30].map((delta) => wheel.add(delta, 0));
    assert.deepEqual(moves, [0, 0, 0, 1, 0, 0, 1]);
  });

  it('starts again from nothing when the direction changes, or after a reset', () => {
    const wheel = new WheelColumns();
    assert.equal(wheel.add(80, 0), 0);
    assert.equal(wheel.add(-30, 0), 0, 'the 80 toward the end are dropped');
    assert.equal(wheel.add(-70, 0), -1);
    assert.equal(wheel.add(60, 0), 0);
    wheel.reset();
    assert.equal(wheel.add(60, 0), 0, 'the 60 before the reset are forgotten');
  });

  it('counts a delta in lines or pages as one notch, and nothing for no delta', () => {
    const wheel = new WheelColumns();
    assert.equal(wheel.add(3, 1), 1);
    assert.equal(wheel.add(-1, 2), -1);
    assert.equal(wheel.add(0, 0), 0);
  });
});
