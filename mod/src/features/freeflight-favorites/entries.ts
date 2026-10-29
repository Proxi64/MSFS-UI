// Which favourites the Free Flight block shows, without the sim (tested by test/freeflight-favorites.test.ts): one
// entry per favourite livery (the heart of the liveries in the aircraft selection), which loads the aircraft with it.
// The order goes from the most recently used to the oldest, and is kept while the screen stays on display.

import { type FavoriteLivery, type LiveryRef } from '../../sim/favorites.ts';
import { liveryKey } from '../../sim/liveries.ts';

export interface FavoriteEntry {
  /** Stable id, for the order kept on screen. */
  id: string;
  variationId: string;
  name: string;
  creator: string;
  /** Variant title (may be a `TT:` key), empty for an aircraft without variants. */
  variation: string;
  /** The favourite livery, shown and loaded. */
  livery: LiveryRef;
  image: string;
  usedAt: number;
}

/** One entry per favourite livery, in the order stored. */
export function collectEntries(liveries: readonly FavoriteLivery[]): FavoriteEntry[] {
  return liveries.map((favorite) => ({
    id: `livery:${favorite.variationId}|${favorite.dir}`,
    variationId: favorite.variationId,
    name: (favorite.displayName || favorite.variationId).trim(),
    creator: (favorite.creator || '').trim(),
    variation: favorite.variation || '',
    livery: { dir: favorite.dir, title: favorite.title, image: favorite.image },
    image: favorite.image,
    usedAt: favorite.usedAt || 0,
  }));
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

/** The entry of the current aircraft: same variant and same livery (`livery` in the form of `liveryKey`). */
export function isCurrentEntry(entry: FavoriteEntry, current: { variationId: string; livery: string }): boolean {
  return entry.variationId === current.variationId && liveryKey(entry.livery.dir) === current.livery;
}

/** The favourite liveries without the one of this entry. */
export function withoutLivery(liveries: readonly FavoriteLivery[], entry: FavoriteEntry): FavoriteLivery[] {
  return liveries.filter((favorite) => `livery:${favorite.variationId}|${favorite.dir}` !== entry.id);
}
