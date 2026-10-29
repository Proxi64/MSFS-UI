import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Type only: configurator.ts imports the sim's store, which node cannot load; the pure parts are in favorites.ts.
import type { ConfiguratorState } from '../src/sim/configurator.ts';
import { isFavoriteLivery, withFavoriteLivery } from '../src/sim/favorites.ts';

const state: ConfiguratorState = {
  variants: [],
  liveries: [],
  details: { variationId: 'v1', displayName: 'Phenom 300E', creator: 'FSReborn' },
  variationTitle: 'Manchester Interior',
};
const red = { id: 'v1:2', title: 'Red', imageUrl: 'r.png', directoryPath: String.raw`SimObjects\Airplanes\P\liveries\x\Red`, isSelected: true };

describe('favourite liveries of the configurator', () => {
  it('adds a favourite livery with its aircraft and variant, used now when selected', () => {
    const next = withFavoriteLivery([], red, true, state, 1000)!;
    assert.deepEqual(next, [
      {
        variationId: 'v1',
        dir: 'simobjects/airplanes/p/liveries/x/red',
        title: 'Red',
        image: 'r.png',
        displayName: 'Phenom 300E',
        creator: 'FSReborn',
        variation: 'Manchester Interior',
        usedAt: 1000,
      },
    ]);
    assert.equal(isFavoriteLivery(red, next), true);
  });

  it('marks a livery that is not selected as never used', () => {
    assert.equal(withFavoriteLivery([], { ...red, isSelected: false }, true, state, 1000)![0]!.usedAt, 0);
  });

  it('removes it, and changes nothing when already in that state or without a folder or a thumbnail', () => {
    const one = withFavoriteLivery([], red, true, state, 1000)!;
    assert.deepEqual(withFavoriteLivery(one, red, false, state, 2000), []);
    assert.equal(withFavoriteLivery(one, red, true, state, 2000), null);
    assert.equal(withFavoriteLivery([], red, false, state, 2000), null);
    assert.equal(withFavoriteLivery([], { ...red, directoryPath: '', imageUrl: '' }, true, state, 2000), null);
    assert.equal(isFavoriteLivery({ ...red, directoryPath: '', imageUrl: '' }, one), false);
  });

  it('identifies a livery without a folder by the folder of its thumbnail (COWS DA42, iFly 737 MAX)', () => {
    const image = (folder: string) => `coui://html_ui/VFS/SimObjects/Airplanes/COWS_DA42TDI/${folder}/thumbnail.png`;
    const white = { id: 'v1:0', title: 'White', imageUrl: image('texture'), directoryPath: '', isSelected: false };
    const ribbon = { id: 'v1:1', title: 'Ribbon', imageUrl: image('texture.RIBBON'), directoryPath: '', isSelected: false };
    const one = withFavoriteLivery([], ribbon, true, state, 1000)!;
    assert.equal(one[0]!.dir, 'simobjects/airplanes/cows_da42tdi/texture.ribbon');
    assert.equal(isFavoriteLivery(ribbon, one), true);
    assert.equal(isFavoriteLivery(white, one), false);
    assert.deepEqual(withFavoriteLivery(one, ribbon, false, state, 2000), []);
  });

  it('leaves the aircraft details out when the configurator is on another variant', () => {
    const next = withFavoriteLivery([], { ...red, id: 'v2:0' }, true, state, 1000)!;
    assert.equal(next[0]!.variationId, 'v2');
    assert.equal(next[0]!.displayName, undefined);
    assert.equal(next[0]!.variation, undefined);
  });
});
