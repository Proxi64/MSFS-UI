// The mod's memory of aircraft: favourites (gallery heart), favourite liveries (heart of the setup panel's
// thumbnails) and the last use of each variant (livery, date). Same storage keys as 0.3.0 (mod/README.md, Data stored in the sim).
// Aircraft are identified by `variationId` (stable); `aircraftId` may change when an aircraft is installed.

import { loadData, saveData } from '../core/storage.ts';
import { liveryKey } from './liveries.ts';

export interface FavoriteAircraft {
  variationId: string;
  displayName?: string;
  creator?: string;
  variation?: string;
  thumbnailPath?: string;
}

/** A favourite livery, for one variant. */
export interface FavoriteLivery {
  variationId: string;
  /** Folder of the livery, in the form of `liveryKey`. */
  dir: string;
  title: string;
  image: string;
  displayName?: string;
  creator?: string;
  variation?: string;
  /** Last use of the aircraft with this livery (see `recordUse`). */
  usedAt?: number;
}

export interface LiveryRef {
  dir: string;
  title: string;
  image: string;
}

export interface AircraftUse {
  livery?: LiveryRef;
  usedAt: number;
}

export type AircraftUses = Record<string, AircraftUse>;

const FAVORITES_KEY = 'FAVORITE_AIRCRAFT';
const FAVORITE_LIVERIES_KEY = 'FAVORITE_LIVERIES';
const USES_KEY = 'AIRCRAFT_USES';
/** Variants whose last use is kept. */
export const MAX_USES = 60;

/** Event sent on `document` at each change of the favourite liveries (the setup panel and the gallery redraw). */
export const FAVORITE_LIVERIES_CHANGED = 'msfs-ui-favorite-liveries';

/** Early versions stored only the ids: they are still read. */
export function loadFavorites(): FavoriteAircraft[] {
  return loadData<(FavoriteAircraft | string)[]>(FAVORITES_KEY, []).map((favorite) => (typeof favorite === 'string' ? { variationId: favorite } : favorite));
}

export function saveFavorites(favorites: FavoriteAircraft[]): void {
  saveData(FAVORITES_KEY, favorites);
}

export function loadFavoriteLiveries(): FavoriteLivery[] {
  return loadData<FavoriteLivery[]>(FAVORITE_LIVERIES_KEY, []);
}

export function saveFavoriteLiveries(favorites: FavoriteLivery[]): void {
  saveData(FAVORITE_LIVERIES_KEY, favorites);
  document.dispatchEvent(new CustomEvent(FAVORITE_LIVERIES_CHANGED));
}

/** Favourite liveries of an aircraft: same variant, or same name and publisher (its other variants). */
export function favoriteLiveriesOf(favorites: readonly FavoriteLivery[], aircraft: { variationId: string; displayName?: string; creator?: string }): FavoriteLivery[] {
  return favorites.filter(
    (favorite) =>
      favorite.variationId === aircraft.variationId || (!!favorite.displayName && favorite.displayName === aircraft.displayName && favorite.creator === aircraft.creator),
  );
}

/** Index of the favourite livery of this variant in this folder (any form: configurator, thumbnail, key), or -1. */
export function findFavoriteLivery(favorites: readonly FavoriteLivery[], variationId: string, dir: string): number {
  const key = liveryKey(dir);
  for (let i = 0; i < favorites.length; i++) {
    if (favorites[i]!.variationId === variationId && favorites[i]!.dir === key) return i;
  }
  return -1;
}

export function loadUses(): AircraftUses {
  return loadData<AircraftUses>(USES_KEY, {});
}

export function saveUses(uses: AircraftUses): void {
  saveData(USES_KEY, uses);
}

/**
 * The uses after a use of `variationId` at `now`, with `livery` (or the one known before), keeping the `MAX_USES`
 * most recent variants.
 */
export function withUse(uses: AircraftUses, variationId: string, livery: LiveryRef | undefined, now: number): AircraftUses {
  const previous = uses[variationId];
  const all: AircraftUses = Object.assign({}, uses);
  all[variationId] = { livery: livery || (previous && previous.livery), usedAt: now };
  const kept = Object.keys(all)
    .sort((a, b) => all[b]!.usedAt - all[a]!.usedAt)
    .slice(0, MAX_USES);
  const trimmed: AircraftUses = {};
  for (const id of kept) trimmed[id] = all[id]!;
  return trimmed;
}
