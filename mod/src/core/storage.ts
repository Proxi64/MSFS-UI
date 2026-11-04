// The mod's memory. In the vault module when it answers (sim/vault.ts, setStorageBackend), with the changes made on
// `datastorage` before a late answer, joined to the vault's newer values (moveSessionWrites). Else in the sim's persistent
// storage (`datastorage`, where the menu keeps its `LAYOUT_*` keys): the sim keeps it in memory and writes it to the disk
// only when it saves its profile. The mod never asks for that save: asked through a validated option, it reset the sim's
// graphics settings (measured on 1.9.21, 2026-11-02; docs/next-steps.md). So a change made without the vault is lost if
// the sim quits before saving its profile by itself.
// `localStorage` is emptied at every start of the sim: never used. Keys are those of 0.3.0, so the user's data
// (favourites, tail numbers…) carries over; their content is documented in mod/README.md (Data stored in the sim).

import { logError } from './log.ts';

export const STORAGE_PREFIX = 'MSFS_UI_';

/** Where the mod's data lives. Keys are the full ones (`MSFS_UI_<key>`). */
export interface StorageBackend {
  readonly kind: 'vault' | 'datastorage';
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

interface DataStorage {
  getData(key: string): string | null | undefined;
  setData(key: string, value: string): unknown;
  deleteData(key: string): unknown;
}

interface StorageWindow {
  datastorage?: DataStorage;
  top?: { datastorage?: DataStorage } | null;
}

function storage(): DataStorage | undefined {
  const page = window as unknown as StorageWindow;
  return page.datastorage || (page.top ? page.top.datastorage : undefined);
}

/** Without a `datastorage` (one user's sim, next-steps.md 1.5): the data of this session only, so that a click still works. */
const memory = new Map<string, string>();
let memoryLogged = false;
/**
 * The keys written to the default backend since the start, each with the value it had before the session's first write
 * to it (undefined: absent): moved into a vault that answers late (moveSessionWrites).
 */
const written = new Map<string, string | undefined>();

/** Remembers the value `key` had before the session's first write to it. */
function noteWrite(key: string): void {
  if (!written.has(key)) written.set(key, datastorageBackend.get(key));
}

/**
 * Kept in `datastorage` by a session without the vault: the mod's keys it wrote and the id of the last such session.
 * At the next start with the vault, what those keys added joins the vault's data (takeFallbackWrites); until 2.1.0 they
 * were deleted unread (clearDatastorage).
 */
const FALLBACK_MARK = 'FALLBACK_WRITES';
/** Kept in the vault: the id of the last mark whose keys it took, so that a mark not yet cleared is not taken twice. */
const TAKEN_MARK = 'FALLBACK_TAKEN';

interface FallbackMark {
  id: string;
  keys: string[];
}

/** The id of this session's mark, made at its first write to `datastorage`. */
let sessionMark = '';

function readMark(): FallbackMark | null {
  const store = storage();
  const raw = store ? store.getData(STORAGE_PREFIX + FALLBACK_MARK) : undefined;
  if (!raw) return null;
  try {
    const mark = storedObject(JSON.parse(raw));
    if (!mark || typeof mark.id !== 'string' || !Array.isArray(mark.keys)) return null;
    return { id: mark.id, keys: (mark.keys as unknown[]).filter((key): key is string => typeof key === 'string') };
  } catch (error) {
    logError('the mark of a session without the vault is unreadable, ignored', error);
    return null;
  }
}

/** Adds a key of the mod's data written to `datastorage` to the mark, under this session's id. */
function markWrite(key: string, store: DataStorage): void {
  const name = key.indexOf(STORAGE_PREFIX) === 0 ? key.slice(STORAGE_PREFIX.length) : key;
  if (DATASTORAGE_KEYS.indexOf(name) < 0) return;
  if (!sessionMark) sessionMark = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const mark = readMark() || { id: sessionMark, keys: [] };
  if (mark.id === sessionMark && mark.keys.indexOf(name) >= 0) return;
  mark.id = sessionMark;
  if (mark.keys.indexOf(name) < 0) mark.keys.push(name);
  store.setData(STORAGE_PREFIX + FALLBACK_MARK, JSON.stringify(mark));
}

/** The sim's `datastorage`: the default backend. */
const datastorageBackend: StorageBackend = {
  kind: 'datastorage',
  get(key) {
    const store = storage();
    if (!store) return memory.get(key);
    return store.getData(key) || undefined;
  },
  set(key, value) {
    noteWrite(key);
    const store = storage();
    if (!store) {
      if (!memoryLogged) logError(`no datastorage: the mod's data is kept for this session only (${key})`);
      memoryLogged = true;
      memory.set(key, value);
      return;
    }
    store.setData(key, value);
    markWrite(key, store);
  },
  remove(key) {
    noteWrite(key);
    const store = storage();
    if (!store) {
      memory.delete(key);
      return;
    }
    store.deleteData(key);
    markWrite(key, store);
  },
};

let backend: StorageBackend = datastorageBackend;

/** Sets where the data lives; null for `datastorage`. */
export function setStorageBackend(next: StorageBackend | null): void {
  backend = next || datastorageBackend;
}

/**
 * The keys the mod keeps in `datastorage` when it has no vault (mod/README.md, Data stored in the sim), copied into a new
 * vault: those of 1.x, and the hidden aircraft of 2.0, kept there while the vault module of 2.0.1 to 2.0.3 failed.
 */
const DATASTORAGE_KEYS = ['FAVORITE_LIVERIES', 'LIVERY_TAILS', 'BASE_TAIL', 'WEATHER_BAR', 'WEATHER_BAR_TAB', 'AIRCRAFT_GALLERY', 'HIDDEN_AIRCRAFT'];

/** Keys of earlier versions that may linger in `datastorage`: nothing reads them any more. */
const OLD_DATASTORAGE_KEYS = ['FAVORITE_AIRCRAFT', 'AIRCRAFT_USES'];

/** The mod's keys `datastorage` holds (without the prefix), the mark of a session without the vault included: what clearDatastorage removes. */
export function datastorageKeys(): string[] {
  return DATASTORAGE_KEYS.concat(OLD_DATASTORAGE_KEYS, [FALLBACK_MARK]).filter((key) => datastorageBackend.get(STORAGE_PREFIX + key) !== undefined);
}

/** What identifies an item of the mod's stored lists: a list is never replaced, its new items join the vault's. */
const LIST_ITEM_IDS: Record<string, (item: Record<string, unknown>) => string> = {
  FAVORITE_LIVERIES: (item) => `${String(item.variationId)}|${String(item.dir)}`,
  HIDDEN_AIRCRAFT: (item) => `${String(item.displayName)}|${String(item.creator)}`,
};
/** Stored objects whose entries join the vault's, the session's value winning for the same entry. */
const MERGED_OBJECTS = ['LIVERY_TAILS'];

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    logError('a value written without the vault is unreadable, ignored', error);
    return undefined;
  }
}

/**
 * What the vault holds once `value`, written by a session without it, has joined `current`; null to leave the vault as
 * it is. That session never saw the vault's data (`datastorage` is emptied once the vault holds them, since 2.0.8), and a
 * key is written whole: its value says what it added, not what the vault should lose. So a list keeps the vault's items
 * and takes the new ones, an object its entries with the session's, and any other key (a setting, or `BASE_TAIL`, which
 * is recorded with no click when empty) keeps the vault's value when it has one. A value that cannot be read changes nothing.
 * `base`: the value the session started from, when known: an entry it merely carried from there does not replace the
 * vault's. A stale list item may come back (an aircraft shown again in the vault, still in a `datastorage` not cleared):
 * a click repairs it, a lost one does not come back.
 */
function joinedValue(key: string, current: string | undefined, value: string, base?: string): string | null {
  if (current === undefined) return value;
  const itemId = LIST_ITEM_IDS[key];
  if (!itemId && MERGED_OBJECTS.indexOf(key) < 0) return null;
  const kept = parsed(current);
  const added = parsed(value);
  if (itemId) {
    if (!Array.isArray(kept) || !Array.isArray(added)) return null;
    const known = (kept as unknown[]).map((item) => storedObject(item)).filter((item) => !!item).map((item) => itemId(item as Record<string, unknown>));
    const fresh = (added as unknown[]).filter((item) => {
      const entry = storedObject(item);
      return !!entry && known.indexOf(itemId(entry)) < 0;
    });
    return fresh.length > 0 ? JSON.stringify((kept as unknown[]).concat(fresh)) : null;
  }
  const keptEntries = storedObject(kept);
  const addedEntries = storedObject(added);
  if (!keptEntries || !addedEntries) return null;
  const baseEntries = base === undefined ? null : storedObject(parsed(base));
  const entries = Object.assign({}, keptEntries);
  for (const name of Object.keys(addedEntries)) {
    const carried = !!baseEntries && name in entries && baseEntries[name] === addedEntries[name];
    if (!carried) entries[name] = addedEntries[name];
  }
  const joined = JSON.stringify(entries);
  return joined === JSON.stringify(keptEntries) ? null : joined;
}

/**
 * Joins into `target` (the vault) the keys that sessions without the vault wrote to `datastorage` since the vault last
 * took them (their mark; joinedValue). The keys this session wrote are left to moveSessionWrites, which joins them too.
 * Returns the keys changed (without the prefix); the mark is recorded as taken.
 */
export function takeFallbackWrites(target: StorageBackend): string[] {
  const mark = readMark();
  if (!mark) return [];
  const taken = JSON.stringify(mark.id);
  if (target.get(STORAGE_PREFIX + TAKEN_MARK) === taken) return [];
  const changed: string[] = [];
  for (const key of mark.keys) {
    if (DATASTORAGE_KEYS.indexOf(key) < 0 || written.has(STORAGE_PREFIX + key)) continue;
    const value = datastorageBackend.get(STORAGE_PREFIX + key);
    if (value === undefined) continue;
    const current = target.get(STORAGE_PREFIX + key);
    const joined = current === value ? null : joinedValue(key, current, value);
    if (joined === null) continue;
    target.set(STORAGE_PREFIX + key, joined);
    changed.push(key);
  }
  target.set(STORAGE_PREFIX + TAKEN_MARK, taken);
  return changed;
}

/**
 * Removes the mod's keys from `datastorage`, once the vault holds the data for good (the owner's report, 2026-10-31:
 * after Uninstall everything, a new vault took them back, 50 hidden aircraft among them). Not a write of the session
 * (moveSessionWrites ignores it). It reaches the disk when the sim saves its profile by itself; until then the keys come
 * back at each start and are removed again. Returns the keys removed (without the prefix).
 */
export function clearDatastorage(): string[] {
  const store = storage();
  const keys = datastorageKeys();
  for (const key of keys) {
    if (store) store.deleteData(STORAGE_PREFIX + key);
    else memory.delete(STORAGE_PREFIX + key);
  }
  return keys;
}

/**
 * Copies into `target` the mod's keys found in `datastorage`, except those `target` already has; `datastorage` is left
 * as it was. Returns the keys copied (without the prefix).
 */
export function copyFromDatastorage(target: StorageBackend): string[] {
  const copied: string[] = [];
  for (const key of DATASTORAGE_KEYS) {
    const value = datastorageBackend.get(STORAGE_PREFIX + key);
    if (value === undefined || target.get(STORAGE_PREFIX + key) !== undefined) continue;
    target.set(STORAGE_PREFIX + key, value);
    copied.push(key);
  }
  return copied;
}

/** What moveSessionWrites did; keys without the prefix, sorted. */
export interface SessionMove {
  /** The session's value (or removal) written into the target. */
  moved: string[];
  /** The target's value kept: it changed since the value the session started from, and nothing of the session joins it. */
  kept: string[];
}

/**
 * Moves into `target` the keys written to the default backend since the start: the changes of a session that began
 * on `datastorage` before the vault answered. Since 2.0 `datastorage` may hold stale data (that of 1.x, or of an
 * earlier session that fell back), and the session computed its values from it: a key's value (or its removal) goes
 * into `target` only when `target` still holds what `datastorage` had before the session's first write to that key
 * (or already holds the session's value). Otherwise `target`'s newer value stays, with what the session added to a list
 * or an object joined to it (joinedValue: a heart clicked meanwhile is not lost); any other key keeps `target`'s.
 */
export function moveSessionWrites(target: StorageBackend): SessionMove {
  const result: SessionMove = { moved: [], kept: [] };
  written.forEach((base, key) => {
    const value = datastorageBackend.get(key);
    const current = target.get(key);
    const name = key.indexOf(STORAGE_PREFIX) === 0 ? key.slice(STORAGE_PREFIX.length) : key;
    if (current !== base && current !== value) {
      const joined = current !== undefined && value !== undefined ? joinedValue(name, current, value, base) : null;
      if (joined === null) {
        result.kept.push(name);
      } else {
        target.set(key, joined);
        result.moved.push(name);
      }
      return;
    }
    if (value === undefined) target.remove(key);
    else target.set(key, value);
    result.moved.push(name);
  });
  written.clear();
  result.moved.sort();
  result.kept.sort();
  return result;
}

/** Forgets the session's memory and written keys (the tests: each starts as a new session). */
export function resetSessionStorage(): void {
  memory.clear();
  written.clear();
  memoryLogged = false;
  sessionMark = '';
}

/**
 * The value stored under `MSFS_UI_<key>`, or `fallback` when absent or unreadable. The value is the parsed JSON as it
 * was stored, not checked: its reader keeps only what has the right type (`storedObject`, sim/hidden.ts).
 */
export function loadData<T>(key: string, fallback: T): T {
  try {
    const raw = backend.get(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    logError(`stored value ${STORAGE_PREFIX}${key} is unreadable, ignored`, error);
    return fallback;
  }
}

export function saveData(key: string, value: unknown): void {
  backend.set(STORAGE_PREFIX + key, JSON.stringify(value));
}

export function deleteData(key: string): void {
  backend.remove(STORAGE_PREFIX + key);
}

/** A stored value as a JSON object (not null, not an array), or null: the start of a reader's checks. */
export function storedObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
