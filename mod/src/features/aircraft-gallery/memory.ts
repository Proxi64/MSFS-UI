// What the gallery keeps, without the sim (tested by test/aircraft-gallery.test.ts). A stored value is not trusted: each
// field is kept when it has its type.

import { loadData, saveData, storedObject } from '../../core/storage.ts';
import type { View } from './gallery-cells.ts';
import type { GalleryFilter, LocalSort } from './tiles.ts';

const MEMORY_KEY = 'AIRCRAFT_GALLERY';

/** The layout, as stored: what the *Remember my layout* option brings back. */
export interface GalleryMemory {
  view: View;
  sort: { option: LocalSort; reversed: boolean };
}

const VIEWS: readonly View[] = ['gallery', 'list', 'showcase'];
const SORTS: readonly LocalSort[] = ['model', 'manufacturer', 'studio'];

/** A stored view: `stock`, the name of the Showcase view until now, is read as `showcase`, as anything else. */
function viewFrom(stored: unknown): View {
  return VIEWS.indexOf(stored as View) >= 0 ? (stored as View) : 'showcase';
}

/**
 * The layout of a stored value: Showcase and Model, A to Z, a new user's, when it has none. A sort of earlier versions
 * (Name, Max range, the sim's option keys of 0.3.0) reads as Model. What it holds besides is dropped (the filters of
 * earlier versions, the `lastView` of 2.0.1's development builds).
 */
export function galleryMemoryFrom(stored: unknown): GalleryMemory {
  const entry = storedObject(stored) || {};
  const sort = storedObject(entry.sort);
  const known = !!sort && typeof sort.option === 'string' && typeof sort.reversed === 'boolean';
  return {
    view: viewFrom(entry.view),
    sort: {
      option: known && SORTS.indexOf(sort.option as LocalSort) >= 0 ? (sort.option as LocalSort) : 'model',
      reversed: known && sort.reversed === true,
    },
  };
}

/**
 * The gallery's state for one start of the mod, kept from one opening of the screen to the next (the screen's Gallery is
 * made again each time). The layout comes from the storage with *Remember my layout*, and is saved there; without it, it
 * starts from the defaults and lives until the sim stops, what is stored staying as it was. The filter is never stored:
 * it starts off at every start of the sim.
 */
export class GallerySession {
  readonly memory: GalleryMemory;
  filter: GalleryFilter = 'all';
  private readonly remember: boolean;

  constructor(remember: boolean) {
    this.remember = remember;
    this.memory = galleryMemoryFrom(remember ? loadData<unknown>(MEMORY_KEY, null) : null);
  }

  save(): void {
    if (this.remember) saveData(MEMORY_KEY, this.memory);
  }
}
