import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { LIVERIES_IN_GALLERY_CHANGED, liveriesInGallery, setLiveriesInGallery, setSetupPanelShown, setupPanelShown } from '../src/sim/selection-layout.ts';

describe('selection layout flags', () => {
  let sent: string[];
  beforeEach(() => {
    sent = [];
    (globalThis as { document?: unknown }).document = { dispatchEvent: (event: Event) => sent.push(event.type) };
  });
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('start off and follow what the features set', () => {
    assert.equal(liveriesInGallery(), false);
    assert.equal(setupPanelShown(), false);
    setLiveriesInGallery(true);
    setSetupPanelShown(true);
    assert.equal(liveriesInGallery(), true);
    assert.equal(setupPanelShown(), true);
    setLiveriesInGallery(false);
    setSetupPanelShown(false);
    assert.equal(liveriesInGallery(), false);
    assert.equal(setupPanelShown(), false);
  });

  it('tell the setup panel when the liveries come into or leave the gallery (a change of view), and only then', () => {
    setLiveriesInGallery(true);
    setLiveriesInGallery(true);
    setLiveriesInGallery(false);
    setLiveriesInGallery(false);
    assert.deepEqual(sent, [LIVERIES_IN_GALLERY_CHANGED, LIVERIES_IN_GALLERY_CHANGED]);
  });
});
