import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { debounced } from '../src/core/async.ts';

describe('debounced', () => {
  it('runs once, after the last call of a burst', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let runs = 0;
      const save = debounced(() => runs++, 2000);
      save.call();
      mock.timers.tick(1500);
      save.call();
      mock.timers.tick(1500);
      assert.equal(runs, 0, 'still waiting: the second call restarted the delay');
      mock.timers.tick(500);
      assert.equal(runs, 1);
      mock.timers.tick(5000);
      assert.equal(runs, 1, 'nothing more without a call');
    } finally {
      mock.timers.reset();
    }
  });

  it('flushes a pending run at once, and does nothing when none is pending', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let runs = 0;
      const save = debounced(() => runs++, 2000);
      save.flush();
      assert.equal(runs, 0);
      save.call();
      save.flush();
      assert.equal(runs, 1);
      mock.timers.tick(5000);
      assert.equal(runs, 1, 'the flushed run is not repeated');
    } finally {
      mock.timers.reset();
    }
  });
});