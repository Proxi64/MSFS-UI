import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveriesInGallery, setLiveriesInGallery, setSetupPanelShown, setupPanelShown } from '../src/sim/selection-layout.ts';

describe('selection layout flags', () => {
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
});
