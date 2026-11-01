// Sizes of the setup panel's two lists, without the sim (tested by test/aircraft-setup.test.ts). The variants and the
// livery thumbnails share the room between the panel's fixed parts; each list scrolls in the sim's own scrolling
// element when it needs more. An aircraft with many variants (the iFly 737 MAX makes one per livery) keeps its
// liveries in view, and the reverse.

import type { Rows } from '../../core/virtual-list.ts';

/**
 * Layout units, as in aircraft-setup.css: height of a variant tile, gap between tiles, the panel's padding at the top
 * only (its blocks as wide as the sim's title block, the last one 6 units above the sim's "Configure" tile).
 */
export const VARIANT_HEIGHT = 36;
export const GAP = 6;
export const PADDING_TOP = 6;

/** Rows each list keeps when the other one needs more room. */
export const KEEP_VARIANT_ROWS = 3;
export const KEEP_LIVERY_ROWS = 2;

/** Variant tiles per row: as many (3, 2 or 1) as let the widest name show whole in `width`. */
export function variantsPerRow(count: number, width: number, needed: number, gap: number): number {
  let perRow = Math.min(3, Math.max(1, count));
  while (perRow > 1 && (width - gap * (perRow - 1)) / perRow < needed) perRow--;
  return perRow;
}

/** Rows of `count` items laid out `perRow` per row. */
export function rowCount(count: number, perRow: number): number {
  return count > 0 ? Math.ceil(count / Math.max(1, perRow)) : 0;
}

/**
 * Height given to the variants, in whole pixels; the liveries take the rest of `room`. The variants take what they
 * need while the liveries keep up to KEEP_LIVERY_ROWS rows; past that they keep up to KEEP_VARIANT_ROWS rows and
 * scroll.
 */
export function variantsHeight(room: number, variants: Rows, liveries: Rows): number {
  const natural = variants.count * variants.step;
  const keepVariants = Math.min(variants.count, KEEP_VARIANT_ROWS) * variants.step;
  const keepLiveries = Math.min(liveries.count, KEEP_LIVERY_ROWS) * liveries.step;
  const height = Math.min(natural, Math.max(keepVariants, room - keepLiveries), Math.max(0, room));
  return Math.max(0, Math.floor(height));
}

/**
 * True when the rows need more than `height`: the list scrolls. One pixel of rounding allowed, as variantsHeight rounds
 * the height down (measured 2026-10-30 at 1164 lines: two rows of 90.55 pixels in a list of 90, with half a pixel,
 * marked scrolling with no bar, its tiles 24 units short of the edge).
 */
export function overflows(rows: Rows, height: number): boolean {
  return rows.count * rows.step > height + 1;
}

/** Livery thumbnails: three per row, in the proportions of the sim's thumbnails (about 2:1). */
export const LIVERY_COLUMNS = 3;
export const LIVERY_RATIO = 0.47;

/** A livery thumbnail in a list `width` wide, LIVERY_COLUMNS per row `gap` pixels apart: whole pixels wide. */
export function thumbnailSize(width: number, gap: number): { width: number; height: number } {
  const thumbnail = (width - (LIVERY_COLUMNS - 1) * gap) / LIVERY_COLUMNS;
  return { width: Math.floor(thumbnail), height: Math.round(thumbnail * LIVERY_RATIO) };
}

/**
 * The room the aircraft's statistics take, in pixels: `count` rows of `row` layout units (`unit` pixels each) and the
 * gap under them, rounded up; 0 when there are none, or when the lists would no longer have all they `need` in the
 * `room` left (the statistics never make a list scroll).
 */
export function statisticsRoom(statistics: { count: number; row: number; unit: number; gap: number }, room: number, need: number): number {
  const high = statistics.count > 0 ? Math.ceil(statistics.count * statistics.row * statistics.unit + statistics.gap) : 0;
  return high > 0 && room - high >= need ? high : 0;
}
