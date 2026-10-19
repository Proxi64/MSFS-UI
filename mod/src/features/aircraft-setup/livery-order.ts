// Order of the livery thumbnails, without the sim (tested by test/aircraft-setup.test.ts): favourites first, each part
// in the sim's order. The order is set when a variant first appears, then kept: clicking a heart or a livery does not
// move the thumbnail under the mouse.

/** The order set for a variant. */
export interface LiveryOrder {
  variationId: string;
  ids: string[];
}

/** Variant of a configurator livery id: `<variationId>:<n>`. */
export function variationOf(liveryId: string): string {
  const at = liveryId.indexOf(':');
  return at < 0 ? liveryId : liveryId.slice(0, at);
}

/**
 * `items` in display order. `previous` is the order set before; a new one is set (and `reordered` is true) when the
 * variant changes.
 */
export function orderLiveries<T extends { id: string }>(
  items: readonly T[],
  isFavorite: (item: T) => boolean,
  previous: LiveryOrder | null,
): { items: T[]; order: LiveryOrder; reordered: boolean } {
  const variationId = items.length > 0 ? variationOf(items[0]!.id) : '';
  let order = previous;
  let reordered = false;
  if (!order || order.variationId !== variationId) {
    const sorted = items.filter(isFavorite).concat(items.filter((item) => !isFavorite(item)));
    order = { variationId, ids: sorted.map((item) => item.id) };
    reordered = true;
  }
  const ids = order.ids;
  const rank = (item: T) => {
    const at = ids.indexOf(item.id);
    return at >= 0 ? at : ids.length;
  };
  // Ties (ids new since the order was set) keep the sim's order: the index breaks them, whatever the engine's sort.
  const ordered = items.map((item, at) => ({ item, at })).sort((a, b) => rank(a.item) - rank(b.item) || a.at - b.at);
  return { items: ordered.map((entry) => entry.item), order, reordered };
}
