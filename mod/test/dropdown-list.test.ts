import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dropdownListSize } from '../src/sim/dropdown-list.ts';

describe('the sim dropdown list size', () => {
  const metrics = { item: 33, edge: 6, padding: 9 };

  it('opens downwards to the length of its items when they fit', () => {
    assert.deepEqual(dropdownListSize({ count: 4, below: 200, above: 300, unit: 1 }, metrics, 3), { up: false, size: 141, padding: 6 });
  });

  it('scrolls downwards to the bottom of the room, the room left by whole items in its top padding', () => {
    assert.deepEqual(dropdownListSize({ count: 10, below: 200, above: 300, unit: 4 / 3 }, metrics, 3), { up: false, size: 200.375, padding: 32 });
  });

  it('opens upwards when fewer than the least items fit below, one item at least', () => {
    assert.deepEqual(dropdownListSize({ count: 10, below: 100, above: 300, unit: 1 }, metrics, 3), { up: true, size: 273, padding: 6 });
    assert.deepEqual(dropdownListSize({ count: 10, below: 100, above: 0, unit: 1 }, metrics, 3), { up: true, size: 42, padding: 6 });
  });
});
