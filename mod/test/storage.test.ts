import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { deleteData, loadData, onStorageWrite, saveData, setStorageBackend, type StorageBackend } from '../src/core/storage.ts';

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
  it('saveData then loadData through a backend', () => {
    const data = fakePage();
    const copy = new Map<string, string>();
    const backend: StorageBackend = { kind: 'vault', get: (key) => copy.get(key), set: (key, value) => void copy.set(key, value), remove: (key) => void copy.delete(key) };
    setStorageBackend(backend);
    try {
      saveData('A', { n: 1 });
      assert.equal(copy.get('MSFS_UI_A'), '{"n":1}');
      assert.deepEqual(loadData('A', null), { n: 1 });
      assert.equal(data.size, 0, 'datastorage untouched');
      deleteData('A');
      assert.equal(copy.has('MSFS_UI_A'), false);
    } finally {
      setStorageBackend(null);
    }
  });

  it('falls back to datastorage after setStorageBackend(null)', () => {
    const data = fakePage();
    const copy = new Map<string, string>();
    setStorageBackend({ kind: 'vault', get: (key) => copy.get(key), set: (key, value) => void copy.set(key, value), remove: (key) => void copy.delete(key) });
    setStorageBackend(null);
    saveData('B', 2);
    assert.equal(data.get('MSFS_UI_B'), '2');
    assert.equal(copy.size, 0);
  });

  it('onStorageWrite fires only on datastorage', () => {
    fakePage();
    const copy = new Map<string, string>();
    let writes = 0;
    onStorageWrite(() => writes++);
    try {
      setStorageBackend({ kind: 'vault', get: (key) => copy.get(key), set: (key, value) => void copy.set(key, value), remove: (key) => void copy.delete(key) });
      saveData('C', 1);
      deleteData('C');
      assert.equal(writes, 0);
      setStorageBackend(null);
      saveData('C', 1);
      assert.equal(writes, 1);
    } finally {
      setStorageBackend(null);
      onStorageWrite(null);
    }
  });

  it('logs instead of failing without a datastorage', () => {
    (globalThis as { window?: unknown }).window = { top: null };
    saveData('X', 1);
    assert.equal(error.mock.callCount(), 1);
    assert.equal(loadData('X', 'fallback'), 'fallback');
  });
});
