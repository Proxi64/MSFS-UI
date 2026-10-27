import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { deleteData, loadData, onStorageWrite, saveData } from '../src/core/storage.ts';

/** The sim's `datastorage`, on a fake `window`. */
function fakePage(onTop = false): Map<string, string> {
  const data = new Map<string, string>();
  const datastorage = {
    getData: (key: string) => data.get(key),
    setData: (key: string, value: string) => data.set(key, value),
    deleteData: (key: string) => data.delete(key),
  };
  (globalThis as { window?: unknown }).window = onTop ? { top: { datastorage } } : { datastorage, top: null };
  return data;
}

describe('storage', () => {
  let error: ReturnType<typeof mock.method>;
  beforeEach(() => {
    error = mock.method(console, 'error', () => {});
  });
  afterEach(() => {
    error.mock.restore();
    delete (globalThis as { window?: unknown }).window;
  });

  it('stores JSON under the MSFS_UI_ prefix and reads it back', () => {
    const data = fakePage();
    saveData('LIVERY_TAILS', { a: 'F-ABCD' });
    assert.equal(data.get('MSFS_UI_LIVERY_TAILS'), '{"a":"F-ABCD"}');
    assert.deepEqual(loadData('LIVERY_TAILS', {}), { a: 'F-ABCD' });
  });

  it('uses the top window storage when the page has none', () => {
    const data = fakePage(true);
    saveData('BASE_TAIL', 'ASXGS');
    assert.equal(data.get('MSFS_UI_BASE_TAIL'), '"ASXGS"');
  });

  it('gives the fallback when absent, and logs unreadable values', () => {
    const data = fakePage();
    assert.deepEqual(loadData('MISSING', [1]), [1]);
    assert.equal(error.mock.callCount(), 0);
    data.set('MSFS_UI_BROKEN', '{not json');
    assert.equal(loadData('BROKEN', 'fallback'), 'fallback');
    assert.equal(error.mock.callCount(), 1);
  });

  it('deletes a key', () => {
    const data = fakePage();
    saveData('X', 1);
    deleteData('X');
    assert.equal(data.has('MSFS_UI_X'), false);
  });

  it('tells the listener after every write and delete (the profile save), and nothing once it is removed', () => {
    fakePage();
    let writes = 0;
    onStorageWrite(() => writes++);
    try {
      saveData('X', 1);
      deleteData('X');
      assert.equal(writes, 2);
    } finally {
      onStorageWrite(null);
    }
    saveData('X', 2);
    assert.equal(writes, 2);
  });
  it('logs instead of failing without a datastorage', () => {
    (globalThis as { window?: unknown }).window = { top: null };
    saveData('X', 1);
    assert.equal(error.mock.callCount(), 1);
    assert.equal(loadData('X', 'fallback'), 'fallback');
  });
});
