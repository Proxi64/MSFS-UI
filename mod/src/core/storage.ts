// The mod's memory. By default in the sim's persistent storage (`datastorage`, where the menu keeps its `LAYOUT_*` keys):
// the sim keeps it in memory and writes it to the disk only when it saves its profile, so every write asks for that save
// (onStorageWrite). When the vault module answers (sim/vault.ts), the data lives there instead (setStorageBackend),
// with the changes made on `datastorage` before a late answer, unless the vault's values are newer (moveSessionWrites).
// `localStorage` is emptied at every start of the sim: never used. Keys are those of 0.3.0, so the user's data
// (favourites, tail numbers…) carries over; their content is documented in mod/README.md (Data stored in the sim).

import { logError } from './log.ts';

export const STORAGE_PREFIX = 'MSFS_UI_';

/** Run after every write to `datastorage` (the profile save, sim/profile-save.ts: the sim writes its storage to the disk only then). */
let afterWrite: (() => void) | null = null;

/** Sets what runs after every write to `datastorage`; null for nothing. */
export function onStorageWrite(listener: (() => void) | null): void {
  afterWrite = listener;
}

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
    if (afterWrite) afterWrite();
  },
  remove(key) {
    noteWrite(key);
    const store = storage();
    if (!store) {
      memory.delete(key);
      return;
    }
    store.deleteData(key);
    if (afterWrite) afterWrite();
  },
};

let backend: StorageBackend = datastorageBackend;

/** Sets where the data lives; null for `datastorage`. */
export function setStorageBackend(next: StorageBackend | null): void {
  backend = next || datastorageBackend;
}

/** The keys 1.x kept in `datastorage` (mod/README.md, Data stored in the sim), copied into a new vault. */
const KEYS_OF_1X = ['FAVORITE_LIVERIES', 'LIVERY_TAILS', 'AIRCRAFT_USES', 'BASE_TAIL', 'WEATHER_BAR', 'WEATHER_BAR_TAB', 'AIRCRAFT_GALLERY'];

/**
 * Copies into `target` the keys of 1.x found in `datastorage`, except those `target` already has; `datastorage` is
 * left as it was. Returns the keys copied (without the prefix).
 */
export function copyFromDatastorage(target: StorageBackend): string[] {
  const copied: string[] = [];
  for (const key of KEYS_OF_1X) {
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
  /** The target's value kept: it changed since the value the session started from. */
  kept: string[];
}

/**
 * Moves into `target` the keys written to the default backend since the start: the changes of a session that began
 * on `datastorage` before the vault answered. Since 2.0 `datastorage` may hold stale data (that of 1.x, or of an
 * earlier session that fell back), and the session computed its values from it: a key's value (or its removal) goes
 * into `target` only when `target` still holds what `datastorage` had before the session's first write to that key
 * (or already holds the session's value); otherwise `target`'s newer value is kept.
 */
export function moveSessionWrites(target: StorageBackend): SessionMove {
  const result: SessionMove = { moved: [], kept: [] };
  written.forEach((base, key) => {
    const value = datastorageBackend.get(key);
    const current = target.get(key);
    const name = key.indexOf(STORAGE_PREFIX) === 0 ? key.slice(STORAGE_PREFIX.length) : key;
    if (current !== base && current !== value) {
      result.kept.push(name);
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
}

/** The value stored under `MSFS_UI_<key>`, or `fallback` when absent or unreadable. */
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
