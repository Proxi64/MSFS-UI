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

/** Variant of a configurator livery id: `<variationId>:<n>`. */
export function variationOf(liveryId: string): string {
  const at = liveryId.indexOf(':');
  return at < 0 ? liveryId : liveryId.slice(0, at);
}

/** A livery of the configurator, as far as finding one goes. */
export interface LiveryCandidate {
  /** `<variationId>:<n>`. */
  id: string;
  title: string;
  directoryPath: string;
  imageUrl?: string;
}

/**
 * Folder of a configurator livery: its `directoryPath`, or the folder of its thumbnail for a livery that has none
 * (the textures beside the aircraft, `texture.<name>`: COWS DA42, iFly 737 MAX). Empty when it has neither.
 */
export function liveryFolder(livery: { directoryPath: string; imageUrl?: string }): string {
  return livery.directoryPath || (livery.imageUrl ? liveryDirectory(livery.imageUrl) : '');
}

/**
 * The livery of variant `variationId` for `wanted`: same folder (either form), otherwise same title. Liveries of
 * another variant are never taken: right after a change of variant, the configurator's list may still be the previous
 * variant's, and choosing one of its liveries would bring that variant back.
 */
export function matchLivery<T extends LiveryCandidate>(liveries: readonly T[], variationId: string, wanted: { dir: string; title: string }): T | undefined {
  const own = liveries.filter((livery) => !!livery && variationOf(livery.id) === variationId);
  const key = liveryKey(wanted.dir);
  return own.filter((livery) => liveryKey(liveryFolder(livery)) === key)[0] || own.filter((livery) => !!wanted.title && livery.title === wanted.title)[0];
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
