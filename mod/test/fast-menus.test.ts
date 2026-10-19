import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ORIGINAL_CONFIGURATION, prepareTimeline, scaled, scaledAnimation, type Timed } from '../src/features/fast-menus/timing.ts';

describe('fast menus timing', () => {
  it('scales the numeric keys only, on a copy', () => {
    const options = { duration: 400, delay: 100, easing: 'linear' };
    assert.deepEqual(scaled(options, ['duration', 'delay', 'missing'], 0.5), { duration: 200, delay: 50, easing: 'linear' });
    assert.equal(options.duration, 400);
  });

  it('shortens a timeline configuration once and keeps the original on the timeline', () => {
    const configuration: Timed = { duration: 400, initialDelay: 200, elements: [] };
    const timeline = { configuration };
    assert.equal(prepareTimeline(timeline, 0.5), configuration);
    assert.equal(timeline.configuration.duration, 200);
    assert.equal(timeline.configuration.initialDelay, 100);
    const shortened = timeline.configuration;
    prepareTimeline(timeline, 0.5);
    assert.equal(timeline.configuration, shortened, 'not shortened twice');
    assert.equal((timeline as unknown as Record<string, unknown>)[ORIGINAL_CONFIGURATION], configuration);
  });

  it('scales from the original values in a new version of the mod, whatever the factor', () => {
    const timeline = { configuration: { duration: 400 } as Timed };
    prepareTimeline(timeline, 0.5);
    // A hot reload with speed 4, then with speed 1: the old version's 200 ms is not the base.
    prepareTimeline(timeline, 0.25);
    assert.equal(timeline.configuration.duration, 100);
    prepareTimeline(timeline, 1);
    assert.equal(timeline.configuration.duration, 400);
  });

  it('leaves looping timelines and animations at their pace', () => {
    const looping = { configuration: { duration: 1000, iterations: -1 } as Timed };
    assert.equal(prepareTimeline(looping, 0.5).duration, 1000);
    assert.equal(looping.configuration.duration, 1000);
    assert.deepEqual(scaledAnimation({ duration: 300 }, { iterations: -1 }, 0.5), { duration: 300 });
  });

  it('shortens animations, but a looping animation keeps the original inherited duration', () => {
    const original: Timed = { duration: 800 };
    assert.deepEqual(scaledAnimation({ duration: 300, animationStart: 100, offset: 50 }, original, 0.5), { duration: 150, animationStart: 50, offset: 25 });
    assert.deepEqual(scaledAnimation({ iterations: -1 }, original, 0.5), { iterations: -1, duration: 800 });
    assert.deepEqual(scaledAnimation({ iterations: -1, duration: 120 }, original, 0.5), { iterations: -1, duration: 120 });
  });
});
