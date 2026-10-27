import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cellAction } from '../src/core/virtual-list.ts';

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
