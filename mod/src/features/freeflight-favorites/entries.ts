// Which favourites the Free Flight block shows, without the sim (tested by test/freeflight-favorites.test.ts):
// - one entry per favourite livery (heart of the setup panel's thumbnails), which loads the aircraft with it;
// - one entry per favourite aircraft (heart of the gallery) that has no favourite livery, with the last livery used
//   with its variant.
// The order goes from the most recently used to the oldest, and is kept while the screen stays on display.

import { favoriteLiveriesOf, type AircraftUses, type FavoriteAircraft, type FavoriteLivery, type LiveryRef } from '../../sim/favorites.ts';
import { liveryKey } from '../../sim/liveries.ts';

export interface FavoriteEntry {
  /** Stable id, for the order kept on screen. */
  id: string;
  variationId: string;
  name: string;
  creator: string;
  /** Variant title (may be a `TT:` key), empty for an aircraft without variants. */
  variation: string;
  /** The livery shown and loaded: the favourite one, or the last one used with this variant. */
  livery?: LiveryRef;
  image: string;
  /** A favourite livery: the entry is selected only when this livery is the current one. */
  fixedLivery: boolean;
  usedAt: number;
}

/**
 * Favourite liveries, then favourite aircraft that have none: an aircraft with favourite liveries (same variant, or
 * same name and publisher for its other variants) does not get its "last livery" entry as well.
 */
export function collectEntries(favorites: readonly FavoriteAircraft[], liveries: readonly FavoriteLivery[], uses: AircraftUses): FavoriteEntry[] {
  const entries: FavoriteEntry[] = liveries.map((favorite) => ({
    id: `livery:${favorite.variationId}|${favorite.dir}`,
    variationId: favorite.variationId,
    name: (favorite.displayName || favorite.variationId).trim(),
    creator: (favorite.creator || '').trim(),
    variation: favorite.variation || '',
    livery: { dir: favorite.dir, title: favorite.title, image: favorite.image },
    image: favorite.image,
    fixedLivery: true,
    usedAt: favorite.usedAt || 0,
  }));
  for (const favorite of favorites) {
    if (favoriteLiveriesOf(liveries, favorite).length > 0) continue;
    const use = uses[favorite.variationId];
    const livery = use ? use.livery : undefined;
    entries.push({
      id: `aircraft:${favorite.variationId}`,
      variationId: favorite.variationId,
      name: (favorite.displayName || favorite.variationId).trim(),
      creator: (favorite.creator || '').trim(),
      variation: favorite.variation || '',
      livery,
      image: (livery && livery.image) || favorite.thumbnailPath || '',
      fixedLivery: false,
      usedAt: use ? use.usedAt : 0,
    });
  }
  return entries;
}

/**
 * The entries in order. Without `order` (first display of the screen): from the most recently used to the oldest,
 * and that order is returned to be kept. With it: the kept order, so that a clicked entry does not jump to the top
 * under the mouse; entries added since go at the end.
 */
export function orderEntries(entries: readonly FavoriteEntry[], order: readonly string[] | null): { entries: FavoriteEntry[]; order: string[] } {
  if (!order) {
    const sorted = entries.slice().sort((a, b) => b.usedAt - a.usedAt);
    return { entries: sorted, order: sorted.map((entry) => entry.id) };
  }
  const rank = (entry: FavoriteEntry) => {
    const at = order.indexOf(entry.id);
    return at >= 0 ? at : order.length;
  };
  const kept = entries.map((entry, at) => ({ entry, at }));
  kept.sort((a, b) => rank(a.entry) - rank(b.entry) || a.at - b.at);
  return { entries: kept.map((item) => item.entry), order: order.slice() };
}

/**
 * The entry of the current aircraft: same variant, and for a favourite livery the same livery too (`livery` in the
 * form of `liveryKey`).
 */
export function isCurrentEntry(entry: FavoriteEntry, current: { variationId: string; livery: string }): boolean {
  if (entry.variationId !== current.variationId) return false;
  return !entry.fixedLivery || (!!entry.livery && liveryKey(entry.livery.dir) === current.livery);
}

/**
 * The favourites without the aircraft of this entry: every variant of it (same variant, or same name and publisher),
 * as the gallery's heart does.
 */
export function withoutAircraft(favorites: readonly FavoriteAircraft[], entry: FavoriteEntry): FavoriteAircraft[] {
  return favorites.filter(
    (favorite) =>
      favorite.variationId !== entry.variationId &&
      !(!!favorite.displayName && favorite.displayName.trim() === entry.name && (favorite.creator || '').trim() === entry.creator),
  );
}

/** The favourite liveries without the one of this entry. */
export function withoutLivery(liveries: readonly FavoriteLivery[], entry: FavoriteEntry): FavoriteLivery[] {
  return liveries.filter((favorite) => `livery:${favorite.variationId}|${favorite.dir}` !== entry.id);
}
