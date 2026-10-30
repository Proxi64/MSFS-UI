// Which tiles the gallery shows, without the sim (tested by test/aircraft-gallery.test.ts): one tile per aircraft of
// the sim's list, or with the Favorites filter one tile per favourite livery (as on Free Flight); the search filters
// on name, publisher, variant and livery. The favourites are liveries: an aircraft is a favourite when one of its
// liveries is.

import { favoriteLiveriesOf, type FavoriteLivery } from '../../sim/favorites.ts';
import { isHidden, type HiddenAircraft } from '../../sim/hidden.ts';

/** An item of `Game.Aircraft.AircraftList` (fields used). */
export interface AircraftItem {
  aircraftId: number;
  variationIndex: number;
  variationId: string;
  displayName: string;
  /** Studio (`Asobo Studio`). */
  creator: string;
  variation: string;
  isModular: boolean;
  thumbnailPath: string;
  isSelected: boolean;
  isUsable: boolean;
}

/** A tile: an aircraft of the sim's list, or (Favorites filter) one of its favourite liveries. */
export interface Tile {
  item: AircraftItem;
  livery?: FavoriteLivery;
  /** Shown darkened: the aircraft is hidden but kept for its favourite liveries. */
  veiled?: boolean;
}

/** Lower case without accents or punctuation, for a tolerant search. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * At least one favourite livery, of any variant: the sim's list has one entry per modular aircraft (with its current
 * variant), so a favourite livery of another variant (same name, same publisher) counts too.
 */
export function hasFavoriteLivery(liveries: readonly FavoriteLivery[], item: AircraftItem): boolean {
  return favoriteLiveriesOf(liveries, item).length > 0;
}

/** The `aircraftId` of the favourite aircraft of the list, for an order that stays while the screen does (favoritesFirst). */
export function favoriteAircraftIds(items: readonly AircraftItem[], liveries: readonly FavoriteLivery[]): number[] {
  return items.filter((item) => hasFavoriteLivery(liveries, item)).map((item) => item.aircraftId);
}

/**
 * The hidden aircraft kept in the normal view, veiled (`keepIds`): those that were favourites when the order was set
 * (`frozen`, kept while the screen stays, as the favourites put first) and those that are favourites now, so that a
 * livery given a heart since shows its hidden aircraft at once ("favourites come first", without exception).
 */
export function keptAircraftIds(frozen: readonly number[] | null, items: readonly AircraftItem[], liveries: readonly FavoriteLivery[]): number[] {
  const kept = frozen ? frozen.slice() : [];
  for (const id of favoriteAircraftIds(items, liveries)) if (kept.indexOf(id) < 0) kept.push(id);
  return kept;
}

/**
 * The ids kept so far (`kept`, changed in place) with those of `current` added: a hidden aircraft that was kept veiled
 * (a favourite at some time since the order was set) stays so when its last favourite livery goes, until the order is
 * set again (the gallery empties the list then).
 */
export function accumulateKept(kept: number[], current: readonly number[]): number[] {
  for (const id of current) if (kept.indexOf(id) < 0) kept.push(id);
  return kept;
}

export interface TileQuery {
  items: readonly AircraftItem[];
  liveries: readonly FavoriteLivery[];
  favoritesOnly: boolean;
  /** The Hidden view: only the hidden aircraft (never together with `favoritesOnly`). */
  hiddenOnly: boolean;
  hidden: readonly HiddenAircraft[];
  /** `aircraftId`s shown although hidden, veiled (the gallery passes keptAircraftIds: its frozen ids and the favourites of now). */
  keepIds: readonly number[];
  search: string;
  /** Translation of the sim's keys (variant and livery titles may be `TT:` keys). */
  translate: (key: string) => string;
}

/** The tiles to show, in the order of the sim's list. */
export function visibleTiles(query: TileQuery): Tile[] {
  const { items, liveries, favoritesOnly, hiddenOnly, hidden, keepIds, translate } = query;
  // Each favourite livery goes to one entry of the list only: its variant's, otherwise the first entry of the same
  // aircraft (name and publisher), so that it is not repeated when several entries bear the same name.
  const owners = new Map<FavoriteLivery, AircraftItem>();
  if (favoritesOnly) {
    for (const livery of liveries) {
      const owner =
        items.filter((item) => item.variationId === livery.variationId)[0] || items.filter((item) => favoriteLiveriesOf([livery], item).length > 0)[0];
      if (owner) owners.set(livery, owner);
    }
  }
  const tiles: Tile[] = [];
  const seen: AircraftItem[] = [];
  for (const item of items) {
    const itemHidden = isHidden(hidden, item);
    if (hiddenOnly) {
      // One tile per aircraft: the sim's list may hold several entries of the same name and publisher.
      if (itemHidden && !seen.some((other) => other.displayName === item.displayName && other.creator === item.creator)) {
        seen.push(item);
        tiles.push({ item });
      }
    } else if (favoritesOnly) {
      for (const livery of liveries) if (owners.get(livery) === item) tiles.push(itemHidden ? { item, livery, veiled: true } : { item, livery });
    } else if (!itemHidden) {
      tiles.push({ item });
    } else if (keepIds.indexOf(item.aircraftId) >= 0) {
      tiles.push({ item, veiled: true });
    }
  }
  const terms = normalize(query.search).split(' ').filter((term) => !!term);
  if (terms.length === 0) return tiles;
  return tiles.filter(({ item, livery }) => {
    const variation = livery ? `${livery.variation ? translate(livery.variation) : ''} ${translate(livery.title)}` : translate(item.variation);
    const text = normalize(`${item.displayName} ${item.creator} ${variation}`);
    return terms.every((term) => text.indexOf(term) >= 0);
  });
}

/** The gallery's filter: every aircraft, the favourite liveries (Favorites) or the hidden aircraft (Hidden). */
export type GalleryFilter = 'all' | 'favorites' | 'hidden';

/** The filter of the gallery's memory; a memory with both flags (never written) reads as Favorites. */
export function readFilter(memory: { favoritesOnly?: boolean; hiddenOnly?: boolean }): GalleryFilter {
  if (memory.favoritesOnly) return 'favorites';
  return memory.hiddenOnly ? 'hidden' : 'all';
}

/** A click on the Favorites or Hidden button: that filter on and the other off, or off again when it was on. */
export function toggleFilter(current: GalleryFilter, clicked: 'favorites' | 'hidden'): GalleryFilter {
  return current === clicked ? 'all' : clicked;
}

/**
 * The message of an empty view: `favorites` and `hidden` are the numbers of favourite liveries and hidden aircraft
 * kept (every category tab), `searching` whether the search has text.
 */
export function emptyMessage(filter: GalleryFilter, counts: { favorites: number; hidden: number; searching: boolean }): string {
  if (filter === 'favorites' && counts.favorites === 0) return 'No favorites yet: click the heart on a livery.';
  // Without a search, an empty Hidden view has nothing hidden in this category tab.
  if (filter === 'hidden' && (!counts.searching || counts.hidden === 0)) return 'No hidden aircraft: click the eye on an aircraft to hide it.';
  return 'No aircraft matches.';
}

/** Sorts made by the mod on the tiles (the sim offers none of them). */
export type LocalSort = 'name' | 'studio';

/** Sort keys of an aircraft: its displayed name and its studio, normalised. */
function sortKeys(item: AircraftItem): { studio: string; name: string } {
  return { studio: normalize(item.creator || ''), name: normalize(item.displayName) };
}

/**
 * Natural order: runs of digits compare as numbers, so that "ATR 42" comes before "ATR 72" and "Cessna 172" before
 * "Cessna 404" (character by character, "404" would come before "42").
 */
export function compareNatural(a: string, b: string): number {
  const left = a.match(/[0-9]+|[^0-9]+/g) || [];
  const right = b.match(/[0-9]+|[^0-9]+/g) || [];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i]!;
    const y = right[i]!;
    if (x === y) continue;
    const numbers = /^[0-9]/.test(x) && /^[0-9]/.test(y);
    if (numbers && Number(x) !== Number(y)) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

/**
 * The tiles sorted by displayed name (Name), or by studio then name, in natural order; `reversed` gives the opposite
 * order. Ties keep the sim's order.
 */
export function sortTiles(tiles: readonly Tile[], sort: LocalSort, reversed: boolean): Tile[] {
  const keyed = tiles.map((tile, at) => ({ tile, at, keys: sortKeys(tile.item) }));
  keyed.sort((a, b) => {
    let order: number;
    if (sort === 'name') order = compareNatural(a.keys.name, b.keys.name);
    else order = compareNatural(a.keys.studio, b.keys.studio) || compareNatural(a.keys.name, b.keys.name);
    if (reversed) order = -order;
    return order || a.at - b.at;
  });
  return keyed.map((entry) => entry.tile);
}

/**
 * Favourites first, whatever the sort: the favourite aircraft (`favoriteIds`, from favoriteAircraftIds) and the
 * favourite livery tiles, then the others, each part in the order given. The gallery keeps the ids of its first
 * display while the screen stays, so that an aircraft whose livery gets a heart does not jump away under the mouse.
 */
export function favoritesFirst(tiles: readonly Tile[], favoriteIds: readonly number[]): Tile[] {
  const isFavorite = (tile: Tile) => !!tile.livery || favoriteIds.indexOf(tile.item.aircraftId) >= 0;
  return tiles.filter(isFavorite).concat(tiles.filter((tile) => !isFavorite(tile)));
}
