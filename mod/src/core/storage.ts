// The mod's memory. By default in the sim's persistent storage (`datastorage`, where the menu keeps its `LAYOUT_*` keys):
// the sim keeps it in memory and writes it to the disk only when it saves its profile, so every write asks for that save
// (onStorageWrite). When the vault module answers (sim/vault.ts), the data lives there instead (setStorageBackend).
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

/** The sim's `datastorage`: the default backend. */
const datastorageBackend: StorageBackend = {
  kind: 'datastorage',
  get(key) {
    const store = storage();
    if (!store) return undefined;
    return store.getData(key) || undefined;
  },
  set(key, value) {
    const store = storage();
    if (!store) {
      logError(`no datastorage: ${key} not saved`);
      return;
    }
    store.setData(key, value);
    if (afterWrite) afterWrite();
  },
  remove(key) {
    const store = storage();
    if (!store) return;
    store.deleteData(key);
    if (afterWrite) afterWrite();
  },
};

let backend: StorageBackend = datastorageBackend;

/** Sets where the data lives; null for `datastorage`. */
export function setStorageBackend(next: StorageBackend | null): void {
  backend = next || datastorageBackend;
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
