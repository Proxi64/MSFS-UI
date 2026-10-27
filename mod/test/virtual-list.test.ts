import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cellAction, layoutWidth } from '../src/core/virtual-list.ts';

describe('cellAction', () => {
  // A list showing 1000 to 2000 px; components made within 300 px of it, kept within 900 px.
  const view = { top: 1000, bottom: 2000 };
  const margins = { create: 300, keep: 900 };

  it('creates the cells in view or near it', () => {
    assert.equal(cellAction({ top: 1500, bottom: 1700 }, false, view, margins), 'create');
    assert.equal(cellAction({ top: 2250, bottom: 2450 }, false, view, margins), 'create');
    assert.equal(cellAction({ top: 600, bottom: 750 }, false, view, margins), 'create');
  });

  it('leaves the far cells empty', () => {
    assert.equal(cellAction({ top: 2400, bottom: 2600 }, false, view, margins), 'none');
    assert.equal(cellAction({ top: 300, bottom: 600 }, false, view, margins), 'none');
  });

  it('keeps the created cells until they are far, then destroys them', () => {
    assert.equal(cellAction({ top: 2400, bottom: 2600 }, true, view, margins), 'none', 'between the margins: kept');
    assert.equal(cellAction({ top: 2950, bottom: 3150 }, true, view, margins), 'destroy');
    assert.equal(cellAction({ top: -100, bottom: 50 }, true, view, margins), 'destroy');
  });
});

describe('layoutWidth', () => {
  // Tiles in a fixed number of columns: narrower tiles are also shorter, so the content is lower in less width.
  const contentHeight = (width: number) => Math.round(width * 1.25);

  it('keeps the full width while the content fits in it', () => {
    assert.deepEqual(layoutWidth(800, 10, contentHeight, 1000), { width: 800, scrolls: false });
  });

  it('takes the width the scroll bar leaves when the content does not fit in the full width', () => {
    assert.deepEqual(layoutWidth(800, 10, contentHeight, 990), { width: 790, scrolls: true });
  });

  it('decides on the full width only: content that would fit once narrower still scrolls (no swing)', () => {
    // At 790 px the content is 988 px high and would fit in 990: deciding on the current width would swing.
    assert.equal(contentHeight(790) <= 990, true);
    assert.deepEqual(layoutWidth(800, 10, contentHeight, 990), { width: 790, scrolls: true });
  });
});