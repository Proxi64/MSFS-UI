import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitScale, nextFontSize } from '../src/core/text-fit.ts';

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

describe('nextFontSize', () => {
  it('takes the scaled size at the first round', () => {
    assert.equal(nextFontSize(0, 16.1), 16.1);
  });

  it('takes the scaled size when it draws at another whole pixel size', () => {
    assert.equal(nextFontSize(16.1, 14.8), 14.8);
  });

  it('goes one whole pixel down when the scaled size would draw as the current one', () => {
    assert.equal(nextFontSize(16.1, 15.94), 15);
    assert.equal(nextFontSize(15.62, 15.5), 15);
  });
});
