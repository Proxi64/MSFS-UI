import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitScale } from '../src/core/text-fit.ts';

describe('fitScale', () => {
  it('leaves a text that fits at its size', () => {
    assert.equal(fitScale(100, 200), 1);
    assert.equal(fitScale(200, 200), 1);
  });

  it('reduces a text too long just enough to fit, never over its line', () => {
    assert.equal(fitScale(400, 200), 0.5);
    const scale = fitScale(333, 200);
    assert.ok(scale < 1);
    assert.ok(333 * scale <= 200);
    assert.ok(333 * (scale + 0.011) > 200, 'by hundredths');
  });

  it('changes nothing while there is nothing to measure', () => {
    assert.equal(fitScale(0, 200), 1, 'no text');
    assert.equal(fitScale(100, 0), 1, 'no line yet');
    assert.equal(fitScale(Number.NaN, 200), 1);
  });
});
