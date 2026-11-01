import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WheelSteps } from '../src/core/wheel-steps.ts';

describe('WheelSteps', () => {
  it('moves one step per notch of a mouse wheel, toward the end or the start', () => {
    const wheel = new WheelSteps();
    assert.equal(wheel.add(100, 0), 1);
    assert.equal(wheel.add(100, 0), 1);
    assert.equal(wheel.add(-100, 0), -1);
    assert.equal(wheel.add(300, 0), 3);
  });

  it('adds up small deltas (a touchpad) into whole steps', () => {
    const wheel = new WheelSteps();
    assert.equal(wheel.add(50, 0), 0);
    assert.equal(wheel.add(50, 0), 1);
    const moves = [30, 30, 30, 30, 30, 30, 30].map((delta) => wheel.add(delta, 0));
    assert.deepEqual(moves, [0, 0, 0, 1, 0, 0, 1]);
  });

  it('starts again from nothing when the direction changes, or after a reset', () => {
    const wheel = new WheelSteps();
    assert.equal(wheel.add(80, 0), 0);
    assert.equal(wheel.add(-30, 0), 0, 'the 80 toward the end are dropped');
    assert.equal(wheel.add(-70, 0), -1);
    assert.equal(wheel.add(60, 0), 0);
    wheel.reset();
    assert.equal(wheel.add(60, 0), 0, 'the 60 before the reset are forgotten');
  });

  it('counts a delta in lines or pages as one notch, and nothing for no delta', () => {
    const wheel = new WheelSteps();
    assert.equal(wheel.add(3, 1), 1);
    assert.equal(wheel.add(-1, 2), -1);
    assert.equal(wheel.add(0, 0), 0);
  });
});
