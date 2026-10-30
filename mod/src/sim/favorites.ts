// The mod's memory of aircraft: favourite liveries (bookmark of the liveries: setup panel, livery column, Favorites
// tiles) and the last use of each variant (livery, date). Same storage keys as 0.3.0 (mod/README.md, Data stored in
// the sim). The favourites are liveries only since 1.3.0: an aircraft is a favourite when one of its liveries is.
// Aircraft are identified by `variationId` (stable); `aircraftId` may change when an aircraft is installed.

import { log } from '../core/log.ts';
import { deleteData, loadData, saveData } from '../core/storage.ts';
import { liveryFolder, liveryKey, variationOf } from './liveries.ts';

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

/** The favourite aircraft (the gallery's heart) of the versions before 1.3.0: dropped (dropFavoriteAircraft). */
const OLD_FAVORITE_AIRCRAFT_KEY = 'FAVORITE_AIRCRAFT';
const FAVORITE_LIVERIES_KEY = 'FAVORITE_LIVERIES';
const USES_KEY = 'AIRCRAFT_USES';
/** Variants whose last use is kept. */
export const MAX_USES = 60;

/** Event sent on `document` at each change of the favourite liveries (the setup panel and the gallery redraw). */
export const FAVORITE_LIVERIES_CHANGED = 'msfs-ui-favorite-liveries';

/**
 * Removes the favourite aircraft of the versions before 1.3.0 (a heart on the aircraft, apart from its liveries; the
 * owner's decision: not converted). Returns how many there were, 0 when there is nothing left to remove.
 */
export function dropFavoriteAircraft(): number {
  const old = loadData<unknown[] | null>(OLD_FAVORITE_AIRCRAFT_KEY, null);
  if (old === null) return 0;
  deleteData(OLD_FAVORITE_AIRCRAFT_KEY);
  const count = Array.isArray(old) ? old.length : 0;
  log(`favourite aircraft of an earlier version removed (${count}): the favourites are liveries now`);
  return count;
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

/** A livery of the configurator, as far as its favourite goes. */
export interface ConfiguratorLiveryRef {
  /** `<variationId>:<n>`. */
  id: string;
  title: string;
  imageUrl: string;
  directoryPath: string;
  isSelected: boolean;
}

/** The aircraft the configurator is on: its details and the title of its variant (when it has several). */
export interface ConfiguratorAircraft {
  details: { variationId: string; displayName: string; creator: string } | null;
  variationTitle: string;
}

/** Whether a livery of the configurator is a favourite of its variant (one without a folder or a thumbnail never is). */
export function isFavoriteLivery(livery: ConfiguratorLiveryRef, favorites: readonly FavoriteLivery[]): boolean {
  const folder = liveryFolder(livery);
  return !!folder && findFavoriteLivery(favorites, variationOf(livery.id), folder) >= 0;
}

/**
 * The favourite liveries with `livery` added (`on`) or removed; null when nothing changes. A new favourite keeps the
 * aircraft's name, publisher and variant when the configurator is on its variant, and is used `now` when selected.
 */
export function withFavoriteLivery(
  favorites: readonly FavoriteLivery[],
  livery: ConfiguratorLiveryRef,
  on: boolean,
  aircraft: ConfiguratorAircraft,
  now: number,
): FavoriteLivery[] | null {
  const folder = liveryFolder(livery);
  if (!folder) return null;
  const variationId = variationOf(livery.id);
  const at = findFavoriteLivery(favorites, variationId, folder);
  if (!on) return at >= 0 ? favorites.filter((_favorite, index) => index !== at) : null;
  if (at >= 0) return null;
  const details = aircraft.details && aircraft.details.variationId === variationId ? aircraft.details : null;
  return favorites.concat([
    {
      variationId,
      dir: liveryKey(folder),
      title: livery.title,
      image: livery.imageUrl,
      displayName: details ? details.displayName : undefined,
      creator: details ? details.creator : undefined,
      variation: details ? aircraft.variationTitle : undefined,
      usedAt: livery.isSelected ? now : 0,
    },
  ]);
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
