// Which tiles the gallery shows, without the sim (tested by test/aircraft-gallery.test.ts): one tile per aircraft of
// the sim's list, or with the Favorites filter one tile per favourite livery (as on Free Flight) and one per favourite
// aircraft without favourite liveries; the search filters on name, publisher, variant and livery.

import { favoriteLiveriesOf, type FavoriteAircraft, type FavoriteLivery } from '../../sim/favorites.ts';

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
 * Favourites of this aircraft, all variants: the sim's list has one entry per modular aircraft (with its current
 * variant), so the heart is about the aircraft (same name, same publisher), not the variant.
 */
export function favoritesOf(favorites: readonly FavoriteAircraft[], item: AircraftItem): FavoriteAircraft[] {
  return favorites.filter((favorite) => favorite.variationId === item.variationId || (favorite.displayName === item.displayName && favorite.creator === item.creator));
}

/** A gallery favourite, or at least one favourite livery (setup panel). */
export function isFavoriteAircraft(favorites: readonly FavoriteAircraft[], liveries: readonly FavoriteLivery[], item: AircraftItem): boolean {
  return favoritesOf(favorites, item).length > 0 || favoriteLiveriesOf(liveries, item).length > 0;
}

/** The favourite of an aircraft as stored (mod/README.md, Data stored in the sim). */
export function favoriteFrom(item: AircraftItem): FavoriteAircraft {
  return {
    variationId: item.variationId,
    displayName: item.displayName,
    creator: item.creator,
    variation: item.isModular ? item.variation : '',
    thumbnailPath: item.thumbnailPath,
  };
}

export interface TileQuery {
  items: readonly AircraftItem[];
  favorites: readonly FavoriteAircraft[];
  liveries: readonly FavoriteLivery[];
  favoritesOnly: boolean;
  search: string;
  /** Translation of the sim's keys (variant and livery titles may be `TT:` keys). */
  translate: (key: string) => string;
}

/** The tiles to show, in the order of the sim's list. */
export function visibleTiles(query: TileQuery): Tile[] {
  const { items, favorites, liveries, favoritesOnly, translate } = query;
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
  for (const item of items) {
    if (!favoritesOnly) {
      tiles.push({ item });
      continue;
    }
    const own = liveries.filter((livery) => owners.get(livery) === item);
    if (own.length > 0) for (const livery of own) tiles.push({ item, livery });
    else if (favoritesOf(favorites, item).length > 0) tiles.push({ item });
  }
  const terms = normalize(query.search).split(' ').filter((term) => !!term);
  if (terms.length === 0) return tiles;
  return tiles.filter(({ item, livery }) => {
    const variation = livery ? `${livery.variation ? translate(livery.variation) : ''} ${translate(livery.title)}` : translate(item.variation);
    const text = normalize(`${item.displayName} ${item.creator} ${variation}`);
    return terms.every((term) => text.indexOf(term) >= 0);
  });
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
 * Favourites first, whatever the sort: favourite aircraft (heart, or a favourite livery) and favourite livery tiles,
 * then the others, each part in the order given.
 */
export function favoritesFirst(tiles: readonly Tile[], favorites: readonly FavoriteAircraft[], liveries: readonly FavoriteLivery[]): Tile[] {
  const isFavorite = (tile: Tile) => !!tile.livery || isFavoriteAircraft(favorites, liveries, tile.item);
  return tiles.filter(isFavorite).concat(tiles.filter((tile) => !isFavorite(tile)));
}
