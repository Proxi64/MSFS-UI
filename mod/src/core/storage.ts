// The mod's memory, in the sim's persistent storage (`datastorage`, where the menu keeps its `LAYOUT_*` keys).
// `localStorage` is emptied at every start of the sim: never used. Keys are those of 0.3.0, so the user's data
// (favourites, tail numbers…) carries over; their content is documented in mod/README.md (Data stored in the sim).

import { logError } from './log.ts';

export const STORAGE_PREFIX = 'MSFS_UI_';

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

/** The value stored under `MSFS_UI_<key>`, or `fallback` when absent or unreadable. */
export function loadData<T>(key: string, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  let raw: string | null | undefined;
  try {
    raw = store.getData(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    logError(`stored value ${STORAGE_PREFIX}${key} is unreadable, ignored`, error);
    return fallback;
  }
}

export function saveData(key: string, value: unknown): void {
  const store = storage();
  if (!store) {
    logError(`no datastorage: ${STORAGE_PREFIX}${key} not saved`);
    return;
  }
  store.setData(STORAGE_PREFIX + key, JSON.stringify(value));
}

export function deleteData(key: string): void {
  const store = storage();
  if (store) store.deleteData(STORAGE_PREFIX + key);
}
