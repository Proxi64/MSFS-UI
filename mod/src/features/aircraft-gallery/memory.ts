// The gallery's memory, as stored (gallery.ts saves it at each change of view, filter or sort), without the sim (tested
// by test/aircraft-gallery.test.ts). A stored value is not trusted: each field is kept when it has its type.

import { storedObject } from '../../core/storage.ts';
import type { View } from './gallery-cells.ts';

export interface GalleryMemory {
  view: View;
  /** The Favorites filter; never together with `hiddenOnly` (readFilter). */
  favoritesOnly: boolean;
  /** The Hidden filter: only the hidden aircraft (absent before 2.0.0). */
  hiddenOnly?: boolean;
  /** Sort: the id of one of the gallery's sorts; absent: the sim's order, unchanged. */
  sort?: { option: string; reversed: boolean } | null;
}

const VIEWS: readonly View[] = ['gallery', 'list', 'showcase'];

/** A stored view: `stock`, the name of the Showcase view until now, is read as `showcase`; the Gallery view for any other. */
function viewFrom(stored: unknown): View {
  if (stored === 'stock') return 'showcase';
  return VIEWS.indexOf(stored as View) >= 0 ? (stored as View) : 'gallery';
}

/**
 * The memory of a stored value: the Gallery view and no filter when it has none. What it holds besides is dropped (the
 * `lastView` of 2.0.1's development builds, a filter clicked in the sim's grid).
 */
export function galleryMemoryFrom(stored: unknown): GalleryMemory {
  const entry = storedObject(stored) || {};
  const memory: GalleryMemory = {
    view: viewFrom(entry.view),
    favoritesOnly: entry.favoritesOnly === true,
  };
  if (typeof entry.hiddenOnly === 'boolean') memory.hiddenOnly = entry.hiddenOnly;
  const sort = storedObject(entry.sort);
  if (sort && typeof sort.option === 'string' && typeof sort.reversed === 'boolean') memory.sort = { option: sort.option, reversed: sort.reversed };
  return memory;
}
