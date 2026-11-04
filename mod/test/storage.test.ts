import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  clearDatastorage,
  copyFromDatastorage,
  datastorageKeys,
  deleteData,
  loadData,
  moveSessionWrites,
  takeFallbackWrites,
  resetSessionStorage,
  saveData,
  setStorageBackend,
  storedObject,
  type StorageBackend,
} from '../src/core/storage.ts';

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
    resetSessionStorage();
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

  it("copies the mod's keys from datastorage into a backend, keeping what the backend has", () => {
    const data = fakePage();
    data.set('MSFS_UI_FAVORITE_LIVERIES', '[{"dir":"a"}]');
    data.set('MSFS_UI_LIVERY_TAILS', '{"a":"F-ABCD"}');
    data.set('MSFS_UI_BASE_TAIL', '"ASXGS"');
    data.set('MSFS_UI_OTHER', '1');
    const copy = new Map<string, string>([['MSFS_UI_BASE_TAIL', '"KEPT"']]);
    const backend: StorageBackend = { kind: 'vault', get: (key) => copy.get(key), set: (key, value) => void copy.set(key, value), remove: (key) => void copy.delete(key) };
    assert.deepEqual(copyFromDatastorage(backend), ['FAVORITE_LIVERIES', 'LIVERY_TAILS']);
    assert.equal(copy.get('MSFS_UI_FAVORITE_LIVERIES'), '[{"dir":"a"}]');
    assert.equal(copy.get('MSFS_UI_BASE_TAIL'), '"KEPT"');
    assert.equal(copy.has('MSFS_UI_OTHER'), false, "only the mod's keys");
    assert.equal(data.get('MSFS_UI_FAVORITE_LIVERIES'), '[{"dir":"a"}]', 'datastorage left as it was');
  });

  it("lists then clears the mod's keys of datastorage, old ones included, without touching the others or counting as the session's writes", () => {
    const data = fakePage();
    data.set('MSFS_UI_HIDDEN_AIRCRAFT', '[]');
    data.set('MSFS_UI_FAVORITE_AIRCRAFT', '[]');
    data.set('MSFS_UI_AIRCRAFT_USES', '{}');
    data.set('LAYOUT_SOMETHING', 'the sim');
    assert.deepEqual(datastorageKeys(), ['HIDDEN_AIRCRAFT', 'FAVORITE_AIRCRAFT', 'AIRCRAFT_USES']);
    assert.deepEqual(clearDatastorage(), ['HIDDEN_AIRCRAFT', 'FAVORITE_AIRCRAFT', 'AIRCRAFT_USES']);
    assert.deepEqual([...data.keys()], ['LAYOUT_SOMETHING']);
    assert.deepEqual(datastorageKeys(), []);
    const copy = new Map<string, string>([['MSFS_UI_HIDDEN_AIRCRAFT', '[1]']]);
    const target: StorageBackend = { kind: 'vault', get: (key) => copy.get(key), set: (key, value) => void copy.set(key, value), remove: (key) => void copy.delete(key) };
    assert.deepEqual(moveSessionWrites(target), { moved: [], kept: [] }, 'not moved into a vault as a removal');
  });

  it('copies the hidden aircraft too: 2.0 kept them in datastorage while its vault module failed', () => {
    const data = fakePage();
    data.set('MSFS_UI_HIDDEN_AIRCRAFT', '[{"displayName":"C172","creator":"Asobo"}]');
    const copy = new Map<string, string>();
    const backend: StorageBackend = { kind: 'vault', get: (key) => copy.get(key), set: (key, value) => void copy.set(key, value), remove: (key) => void copy.delete(key) };
    assert.deepEqual(copyFromDatastorage(backend), ['HIDDEN_AIRCRAFT']);
    assert.equal(copy.get('MSFS_UI_HIDDEN_AIRCRAFT'), '[{"displayName":"C172","creator":"Asobo"}]');
  });

  it('copies nothing without a datastorage', () => {
    (globalThis as { window?: unknown }).window = { top: null };
    const copy = new Map<string, string>();
    const backend: StorageBackend = { kind: 'vault', get: (key) => copy.get(key), set: (key, value) => void copy.set(key, value), remove: (key) => void copy.delete(key) };
    assert.deepEqual(copyFromDatastorage(backend), []);
    assert.equal(copy.size, 0);
  });

  it('keeps the data of the session without a datastorage, and logs it once', () => {
    (globalThis as { window?: unknown }).window = { top: null };
    saveData('X', 1);
    saveData('Y', 2);
    assert.equal(error.mock.callCount(), 1);
    assert.equal(loadData('X', 'fallback'), 1, 'a click still works for the session');
    deleteData('X');
    assert.equal(loadData('X', 'fallback'), 'fallback');
  });

  /** A vault backend over a map. */
  function vaultOf(copy: Map<string, string>): StorageBackend {
    return { kind: 'vault', get: (key) => copy.get(key), set: (key, value) => void copy.set(key, value), remove: (key) => void copy.delete(key) };
  }

  it("moves the session's writes into a vault that answers late when the vault still holds their base, then forgets them", () => {
    const data = fakePage();
    data.set('MSFS_UI_OLD', '"untouched"');
    data.set('MSFS_UI_FAVORITE_LIVERIES', '[{"dir":"a"}]');
    data.set('MSFS_UI_GONE', '"in the vault"');
    saveData('FAVORITE_LIVERIES', [{ dir: 'a' }, { dir: 'b' }]);
    saveData('FAVORITE_LIVERIES', [{ dir: 'b' }]);
    saveData('GONE', 1);
    deleteData('GONE');
    saveData('NEW', 2);
    const copy = new Map<string, string>([
      ['MSFS_UI_FAVORITE_LIVERIES', '[{"dir":"a"}]'],
      ['MSFS_UI_GONE', '"in the vault"'],
      ['MSFS_UI_KEPT', '"kept"'],
    ]);
    const backend = vaultOf(copy);
    assert.deepEqual(moveSessionWrites(backend), { moved: ['FAVORITE_LIVERIES', 'GONE', 'NEW'], kept: [] });
    assert.equal(copy.get('MSFS_UI_FAVORITE_LIVERIES'), '[{"dir":"b"}]', "the vault held the base of the session's first write: its change applies");
    assert.equal(copy.has('MSFS_UI_GONE'), false, 'a removal is moved too');
    assert.equal(copy.get('MSFS_UI_NEW'), '2', 'absent before and in the vault: written');
    assert.equal(copy.get('MSFS_UI_KEPT'), '"kept"');
    assert.equal(copy.has('MSFS_UI_OLD'), false, 'only what the session wrote');
    assert.deepEqual(moveSessionWrites(backend), { moved: [], kept: [] }, 'moved once');
  });

  it("joins what the session added to the vault's newer list, and keeps its other newer keys", () => {
    const data = fakePage();
    saveData('HIDDEN_AIRCRAFT', [{ displayName: 'clicked', creator: 'c' }]);
    saveData('WEATHER_BAR_TAB', 'session');
    const copy = new Map<string, string>([
      ['MSFS_UI_HIDDEN_AIRCRAFT', '[{"displayName":"a","creator":"c"},{"displayName":"b","creator":"c"}]'],
      ['MSFS_UI_WEATHER_BAR_TAB', '"newer"'],
    ]);
    assert.deepEqual(moveSessionWrites(vaultOf(copy)), { moved: ['HIDDEN_AIRCRAFT'], kept: ['WEATHER_BAR_TAB'] });
    assert.deepEqual(JSON.parse(copy.get('MSFS_UI_HIDDEN_AIRCRAFT')!).map((item: { displayName: string }) => item.displayName), ['a', 'b', 'clicked'], "the session's click not lost");
    assert.equal(copy.get('MSFS_UI_WEATHER_BAR_TAB'), '"newer"');
    assert.equal(data.get('MSFS_UI_WEATHER_BAR_TAB'), '"session"');
  });

  it("does not let an entry carried from a stale base replace the vault's newer one", () => {
    const data = fakePage();
    // The session started from a list and tail numbers left in datastorage; the vault has moved on since.
    data.set('MSFS_UI_LIVERY_TAILS', '{"x":"F-OLD"}');
    saveData('LIVERY_TAILS', { x: 'F-OLD', z: 'F-ZZZZ' });
    const copy = new Map<string, string>([['MSFS_UI_LIVERY_TAILS', '{"x":"F-NEW","y":"F-TWO"}']]);
    assert.deepEqual(moveSessionWrites(vaultOf(copy)), { moved: ['LIVERY_TAILS'], kept: [] });
    assert.deepEqual(JSON.parse(copy.get('MSFS_UI_LIVERY_TAILS')!), { x: 'F-NEW', y: 'F-TWO', z: 'F-ZZZZ' });
  });

  it("gives the session's own edit of an entry the last word", () => {
    fakePage();
    saveData('LIVERY_TAILS', { x: 'F-EDIT' });
    const copy = new Map<string, string>([['MSFS_UI_LIVERY_TAILS', '{"x":"F-NEW","y":"F-TWO"}']]);
    assert.deepEqual(moveSessionWrites(vaultOf(copy)), { moved: ['LIVERY_TAILS'], kept: [] });
    assert.deepEqual(JSON.parse(copy.get('MSFS_UI_LIVERY_TAILS')!), { x: 'F-EDIT', y: 'F-TWO' });
  });

  it('keeps the vault as it is when the session added nothing to its list', () => {
    const data = fakePage();
    data.set('MSFS_UI_HIDDEN_AIRCRAFT', '[{"displayName":"a","creator":"c"}]');
    deleteData('HIDDEN_AIRCRAFT');
    saveData('HIDDEN_AIRCRAFT', [{ displayName: 'a', creator: 'c' }]);
    const copy = new Map<string, string>([['MSFS_UI_HIDDEN_AIRCRAFT', '[{"displayName":"a","creator":"c"},{"displayName":"b","creator":"c"}]']]);
    assert.deepEqual(moveSessionWrites(vaultOf(copy)), { moved: [], kept: ['HIDDEN_AIRCRAFT'] });
  });

  it('counts a vault that already holds the session value as moved', () => {
    const data = fakePage();
    data.set('MSFS_UI_BASE_TAIL', '"OLD"');
    saveData('BASE_TAIL', 'SAME');
    const copy = new Map<string, string>([['MSFS_UI_BASE_TAIL', '"SAME"']]);
    assert.deepEqual(moveSessionWrites(vaultOf(copy)), { moved: ['BASE_TAIL'], kept: [] });
    assert.equal(copy.get('MSFS_UI_BASE_TAIL'), '"SAME"');
  });

  it("keeps the vault's value over a removal made from a stale base", () => {
    const data = fakePage();
    data.set('MSFS_UI_WEATHER_BAR_TAB', '"old"');
    deleteData('WEATHER_BAR_TAB');
    const copy = new Map<string, string>([['MSFS_UI_WEATHER_BAR_TAB', '"newer"']]);
    assert.deepEqual(moveSessionWrites(vaultOf(copy)), { moved: [], kept: ['WEATHER_BAR_TAB'] });
    assert.equal(copy.get('MSFS_UI_WEATHER_BAR_TAB'), '"newer"');
    assert.equal(data.has('MSFS_UI_WEATHER_BAR_TAB'), false, 'datastorage keeps the removal');
  });

  it("keeps a new vault's 1.x copy and the session's changes together (main.ts on a vault at seq 0)", () => {
    const data = fakePage();
    data.set('MSFS_UI_LIVERY_TAILS', '{"a":"F-ABCD"}');
    saveData('LIVERY_TAILS', { a: 'F-ABCD', b: 'F-WXYZ' });
    const copy = new Map<string, string>();
    const backend = vaultOf(copy);
    assert.deepEqual(copyFromDatastorage(backend), ['LIVERY_TAILS']);
    assert.deepEqual(moveSessionWrites(backend), { moved: ['LIVERY_TAILS'], kept: [] });
    assert.equal(copy.get('MSFS_UI_LIVERY_TAILS'), '{"a":"F-ABCD","b":"F-WXYZ"}');
  });

  it("marks the keys of the mod's data a session writes to datastorage, under one id", () => {
    const data = fakePage();
    saveData('FAVORITE_LIVERIES', [{ dir: 'a' }]);
    saveData('LIVERY_TAILS', { a: 'F-ABCD' });
    saveData('FAVORITE_LIVERIES', [{ dir: 'b' }]);
    saveData('OTHER', 1);
    const mark = JSON.parse(data.get('MSFS_UI_FALLBACK_WRITES')!) as { id: string; keys: string[] };
    assert.deepEqual(mark.keys, ['FAVORITE_LIVERIES', 'LIVERY_TAILS'], 'the data copied into a vault only, once each');
    assert.ok(mark.id);
    assert.ok(datastorageKeys().indexOf('FALLBACK_WRITES') >= 0, 'cleared with the data');
  });

  /** An earlier session without the vault: its writes and its mark in datastorage. */
  function earlierSession(data: Map<string, string>, values: Record<string, string>): void {
    for (const key of Object.keys(values)) data.set(`MSFS_UI_${key}`, values[key]!);
    data.set('MSFS_UI_FALLBACK_WRITES', JSON.stringify({ id: 'earlier', keys: Object.keys(values) }));
  }

  it('joins a hidden aircraft of a session without the vault to those of the vault: 50 and 1 give 51', () => {
    const data = fakePage();
    const hidden = Array.from({ length: 50 }, (_, at) => ({ displayName: `Aircraft ${at}`, creator: 'Studio' }));
    // datastorage is empty once the vault holds the data: that session saw no hidden aircraft, and wrote its one.
    earlierSession(data, { HIDDEN_AIRCRAFT: JSON.stringify([{ displayName: 'New', creator: 'Studio', variationId: 'n' }]) });
    const copy = new Map<string, string>([['MSFS_UI_HIDDEN_AIRCRAFT', JSON.stringify(hidden)]]);
    assert.deepEqual(takeFallbackWrites(vaultOf(copy)), ['HIDDEN_AIRCRAFT']);
    const joined = JSON.parse(copy.get('MSFS_UI_HIDDEN_AIRCRAFT')!) as { displayName: string }[];
    assert.equal(joined.length, 51);
    assert.equal(joined[50]!.displayName, 'New');
  });

  it('joins favourite liveries without a double, the vault keeping its own of the same livery', () => {
    const data = fakePage();
    const same = { variationId: 'v', dir: 'a', usedAt: 1 };
    earlierSession(data, { FAVORITE_LIVERIES: JSON.stringify([{ ...same, usedAt: 2 }, { variationId: 'v', dir: 'b' }, 3, null]) });
    const copy = new Map<string, string>([['MSFS_UI_FAVORITE_LIVERIES', JSON.stringify([same])]]);
    assert.deepEqual(takeFallbackWrites(vaultOf(copy)), ['FAVORITE_LIVERIES']);
    assert.deepEqual(JSON.parse(copy.get('MSFS_UI_FAVORITE_LIVERIES')!), [same, { variationId: 'v', dir: 'b' }]);
  });

  it("joins tail numbers, the session's winning for the same livery", () => {
    const data = fakePage();
    earlierSession(data, { LIVERY_TAILS: '{"a":"F-NEW","b":"F-BBBB"}' });
    const copy = new Map<string, string>([['MSFS_UI_LIVERY_TAILS', '{"a":"F-OLD","c":"F-CCCC"}']]);
    assert.deepEqual(takeFallbackWrites(vaultOf(copy)), ['LIVERY_TAILS']);
    assert.deepEqual(JSON.parse(copy.get('MSFS_UI_LIVERY_TAILS')!), { a: 'F-NEW', c: 'F-CCCC', b: 'F-BBBB' });
  });

  it('keeps the value of the vault for any other key, a BASE_TAIL recorded with no click among them, and takes it when the vault has none', () => {
    const data = fakePage();
    earlierSession(data, { BASE_TAIL: '"FROM-THE-SIM"', WEATHER_BAR: '{"weather":1}', AIRCRAFT_GALLERY: '{"view":"list"}' });
    const copy = new Map<string, string>([
      ['MSFS_UI_BASE_TAIL', '"MINE"'],
      ['MSFS_UI_WEATHER_BAR', '{"weather":4}'],
    ]);
    assert.deepEqual(takeFallbackWrites(vaultOf(copy)), ['AIRCRAFT_GALLERY']);
    assert.equal(copy.get('MSFS_UI_BASE_TAIL'), '"MINE"');
    assert.equal(copy.get('MSFS_UI_WEATHER_BAR'), '{"weather":4}');
    assert.equal(copy.get('MSFS_UI_AIRCRAFT_GALLERY'), '{"view":"list"}');
  });

  it('changes nothing with a value that cannot be read, a key not of the data, or a key not in the mark', () => {
    const data = fakePage();
    earlierSession(data, { HIDDEN_AIRCRAFT: 'not json', LIVERY_TAILS: '[]', NOT_DATA: '1' });
    data.set('MSFS_UI_FAVORITE_LIVERIES', '[{"variationId":"stale","dir":"x"}]');
    const copy = new Map<string, string>([
      ['MSFS_UI_HIDDEN_AIRCRAFT', '[{"displayName":"a","creator":"b"}]'],
      ['MSFS_UI_LIVERY_TAILS', '{"a":"F-AAAA"}'],
      ['MSFS_UI_FAVORITE_LIVERIES', '[]'],
    ]);
    assert.deepEqual(takeFallbackWrites(vaultOf(copy)), []);
    assert.equal(copy.get('MSFS_UI_HIDDEN_AIRCRAFT'), '[{"displayName":"a","creator":"b"}]');
    assert.equal(copy.get('MSFS_UI_LIVERY_TAILS'), '{"a":"F-AAAA"}');
    assert.equal(copy.get('MSFS_UI_FAVORITE_LIVERIES'), '[]', 'a stale leftover, not written without the vault');
    assert.equal(copy.has('MSFS_UI_NOT_DATA'), false);
  });

  it('takes a mark once, while it is not cleared yet', () => {
    const data = fakePage();
    earlierSession(data, { HIDDEN_AIRCRAFT: '[{"displayName":"New","creator":"S"}]' });
    const copy = new Map<string, string>([['MSFS_UI_HIDDEN_AIRCRAFT', '[]']]);
    assert.deepEqual(takeFallbackWrites(vaultOf(copy)), ['HIDDEN_AIRCRAFT']);
    assert.equal(copy.get('MSFS_UI_FALLBACK_TAKEN'), '"earlier"');
    // Shown again and hidden no more, in a session with the vault: the mark left in datastorage does not bring it back.
    copy.set('MSFS_UI_HIDDEN_AIRCRAFT', '[]');
    assert.deepEqual(takeFallbackWrites(vaultOf(copy)), []);
    assert.equal(copy.get('MSFS_UI_HIDDEN_AIRCRAFT'), '[]');
  });

  it("leaves this session's writes to moveSessionWrites, which joins them to a newer vault value", () => {
    const data = fakePage();
    data.set('MSFS_UI_FAVORITE_LIVERIES', '[{"dir":"old"}]');
    saveData('FAVORITE_LIVERIES', [{ dir: 'old' }, { dir: 'clicked' }]);
    const copy = new Map<string, string>([['MSFS_UI_FAVORITE_LIVERIES', '[{"dir":"newer"}]']]);
    assert.deepEqual(takeFallbackWrites(vaultOf(copy)), []);
    assert.equal(copy.get('MSFS_UI_FAVORITE_LIVERIES'), '[{"dir":"newer"}]', 'not taken by the mark');
    assert.deepEqual(moveSessionWrites(vaultOf(copy)), { moved: ['FAVORITE_LIVERIES'], kept: [] });
    assert.deepEqual(JSON.parse(copy.get('MSFS_UI_FAVORITE_LIVERIES')!), [{ dir: 'newer' }, { dir: 'old' }, { dir: 'clicked' }]);
  });

  it('takes nothing without a mark (data left by 2.1.0 or before, or by 1.x)', () => {
    const data = fakePage();
    data.set('MSFS_UI_FAVORITE_LIVERIES', '[{"dir":"old"}]');
    const copy = new Map<string, string>([['MSFS_UI_FAVORITE_LIVERIES', '[{"dir":"a"}]']]);
    assert.deepEqual(takeFallbackWrites(vaultOf(copy)), []);
    assert.equal(copy.has('MSFS_UI_FALLBACK_TAKEN'), false);
  });

  it('records the base of the session without a datastorage too (absent)', () => {
    (globalThis as { window?: unknown }).window = { top: null };
    saveData('FAVORITE_LIVERIES', [{ dir: 'clicked' }]);
    saveData('X', 1);
    const copy = new Map<string, string>([['MSFS_UI_FAVORITE_LIVERIES', '[{"dir":"a"}]']]);
    assert.deepEqual(moveSessionWrites(vaultOf(copy)), { moved: ['FAVORITE_LIVERIES', 'X'], kept: [] });
    assert.deepEqual(JSON.parse(copy.get('MSFS_UI_FAVORITE_LIVERIES')!), [{ dir: 'a' }, { dir: 'clicked' }]);
    assert.equal(copy.get('MSFS_UI_X'), '1');
  });
});

describe('stored values', () => {
  it('reads an object, nothing else', () => {
    assert.deepEqual(storedObject({ a: 1 }), { a: 1 });
    for (const value of [null, undefined, [], 'text', 3, true]) assert.equal(storedObject(value), null);
  });
});
