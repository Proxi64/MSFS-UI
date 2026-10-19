import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { liveryDirectory, liveryKey, loadLiveryTails, saveLiveryTail } from '../src/sim/liveries.ts';

const FOLDER = 'coui://html_ui/VFS/SimObjects/Airplanes/Microsoft_SF50/liveries/microsoft/Apex_Corso_Red';
const KEY = 'simobjects/airplanes/microsoft_sf50/liveries/microsoft/apex_corso_red';

describe('liveries', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('gives the same key for the thumbnail form and the configurator form of a folder', () => {
    assert.equal(liveryKey(FOLDER), KEY);
    assert.equal(liveryKey('SimObjects\\Airplanes\\Microsoft_SF50\\liveries\\microsoft\\Apex_Corso_Red\\'), KEY);
  });

  it('finds the livery folder from its thumbnail, with or without the thumbnail folder', () => {
    assert.equal(liveryDirectory(`${FOLDER}/thumbnail/thumbnail.png`), FOLDER);
    assert.equal(liveryDirectory(`${FOLDER}/thumbnail.jpg`), FOLDER);
  });

  it('keeps tail numbers by livery key in MSFS_UI_LIVERY_TAILS', () => {
    const data = new Map<string, string>([['MSFS_UI_LIVERY_TAILS', JSON.stringify({ other: 'F-ABCD' })]]);
    (globalThis as { window?: unknown }).window = {
      top: null,
      datastorage: { getData: (key: string) => data.get(key), setData: (key: string, value: string) => data.set(key, value), deleteData: () => undefined },
    };
    saveLiveryTail(`${FOLDER}/`, 'N561AJ');
    assert.deepEqual(loadLiveryTails(), { other: 'F-ABCD', [KEY]: 'N561AJ' });
  });
});
