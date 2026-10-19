// Liveries as the mod identifies them, and the tail numbers chosen per livery. The sim's "Tail number" field is
// global: without this memory, the last number typed would end up on every aircraft.

import { loadData, saveData } from '../core/storage.ts';

/** Translation key and `dataName` of the sim's tail number field (aircraft identification). */
export const TAIL_NUMBER = 'TT:MENU.AIRCRAFT.TAIL_NUMBER';

/** Storage key: livery key → tail number (mod/README.md, Data stored in the sim). */
const LIVERY_TAILS_KEY = 'LIVERY_TAILS';

/**
 * Key of a livery, from its folder in either form: `coui://html_ui/VFS/SimObjects/…/livery` (thumbnails) or
 * `SimObjects\…\livery` (configurator). Lower case, forward slashes, no trailing slash.
 */
export function liveryKey(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^coui:\/\/html_ui\/vfs\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Folder of a livery from its thumbnail: `…/liveries/<author>/<livery>/thumbnail/thumbnail.png`. */
export function liveryDirectory(thumbnailPath: string): string {
  const parts = thumbnailPath.split('/');
  parts.pop();
  if (parts.length > 0 && parts[parts.length - 1]!.toLowerCase() === 'thumbnail') parts.pop();
  return parts.join('/');
}

export function loadLiveryTails(): Record<string, string> {
  return loadData<Record<string, string>>(LIVERY_TAILS_KEY, {});
}

export function saveLiveryTail(liveryPath: string, tail: string): void {
  const tails = loadLiveryTails();
  tails[liveryKey(liveryPath)] = tail;
  saveData(LIVERY_TAILS_KEY, tails);
}
