import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { liveryDirectory, liveryKey, loadLiveryTails, matchLivery, saveLiveryTail, variationOf } from '../src/sim/liveries.ts';

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

  it('reads the variant of a livery id', () => {
    assert.equal(variationOf('ABC-123:4'), 'ABC-123');
    assert.equal(variationOf('ABC-123'), 'ABC-123');
  });

  describe('matchLivery', () => {
    const livery = (id: string, title: string, folder: string) => ({ id, title, directoryPath: `SimObjects\\Airplanes\\Microsoft_SF50\\liveries\\microsoft\\${folder}` });
    const variantA = [livery('A:0', 'White', 'White_A'), livery('A:1', 'Apex Corso Red', 'Apex_Corso_Red')];
    const variantB = [livery('B:0', 'White', 'White_B'), livery('B:1', 'Apex Corso Red', 'Apex_Corso_Red')];

    it('finds the livery of the variant by its folder, in either form', () => {
      assert.equal(matchLivery(variantB, 'B', { dir: FOLDER, title: '' }), variantB[1]);
    });

    it('falls back on the title within the variant', () => {
      assert.equal(matchLivery(variantB, 'B', { dir: 'elsewhere', title: 'White' }), variantB[0]);
    });

    it('never takes a livery of another variant (a list not updated yet after a change of variant)', () => {
      assert.equal(matchLivery(variantA, 'B', { dir: FOLDER, title: 'White' }), undefined);
      assert.equal(matchLivery(variantA.concat(variantB), 'B', { dir: 'elsewhere', title: 'White' }), variantB[0]);
    });
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
