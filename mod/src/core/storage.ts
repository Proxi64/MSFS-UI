// The mod's memory. By default in the sim's persistent storage (`datastorage`, where the menu keeps its `LAYOUT_*` keys):
// the sim keeps it in memory and writes it to the disk only when it saves its profile, so every write asks for that save
// (onStorageWrite). When the vault module answers (sim/vault.ts), the data lives there instead (setStorageBackend),
// with the changes made on `datastorage` before a late answer (moveSessionWrites).
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
/** The keys written to the default backend since the start: moved into a vault that answers late (moveSessionWrites). */
const written = new Set<string>();

/** The sim's `datastorage`: the default backend. */
const datastorageBackend: StorageBackend = {
  kind: 'datastorage',
  get(key) {
    const store = storage();
    if (!store) return memory.get(key);
    return store.getData(key) || undefined;
  },
  set(key, value) {
    written.add(key);
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
    written.add(key);
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

/**
 * Writes into `target` every key written to the default backend since the start (its current value, or its removal),
 * newer than what `target` holds: the changes of a session that began on `datastorage` before the vault answered.
 * Returns the keys moved (without the prefix).
 */
export function moveSessionWrites(target: StorageBackend): string[] {
  const moved: string[] = [];
  written.forEach((key) => {
    const value = datastorageBackend.get(key);
    if (value === undefined) target.remove(key);
    else target.set(key, value);
    moved.push(key.indexOf(STORAGE_PREFIX) === 0 ? key.slice(STORAGE_PREFIX.length) : key);
  });
  written.clear();
  return moved.sort();
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
