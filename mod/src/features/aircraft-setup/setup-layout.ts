// Sizes of the setup panel's variants list in the Gallery and List views, without the sim (tested by
// test/aircraft-setup.test.ts): the variants take the room the panel's fixed parts leave, and scroll in the sim's own
// scrolling element when they need more. The units and the livery proportions are shared with the Showcase panel
// (showcase-layout.ts).

import type { Rows } from '../../core/virtual-list.ts';

/**
 * Layout units, as in aircraft-setup.css: height of a variant tile, gap between tiles, the panel's padding at the top
 * only (its blocks as wide as the sim's title block).
 */
export const VARIANT_HEIGHT = 36;
export const GAP = 6;
export const PADDING_TOP = 6;

/** The proportions of the sim's livery images (about 2:1). */
export const LIVERY_RATIO = 0.47;

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

/** Height given to the variants, in whole pixels: what they need, never more than `room`. */
export function variantsHeight(room: number, variants: Rows): number {
  return Math.max(0, Math.floor(Math.min(variants.count * variants.step, room)));
}

/**
 * True when the rows need more than `height`: the list scrolls. One pixel of rounding allowed, as variantsHeight rounds
 * the height down (measured 2026-10-30 at 1164 lines: two rows of 90.55 pixels in a list of 90, with half a pixel,
 * marked scrolling with no bar, its tiles 24 units short of the edge).
 */
export function overflows(rows: Rows, height: number): boolean {
  return rows.count * rows.step > height + 1;
}

/**
 * The room the aircraft's statistics take, in pixels: `count` rows of `row` layout units (`unit` pixels each) and the
 * gap under them, rounded up; 0 when there are none, or when the variants would no longer have all they `need` in the
 * `room` left (the statistics never make the list scroll).
 */
export function statisticsRoom(statistics: { count: number; row: number; unit: number; gap: number }, room: number, need: number): number {
  const high = statistics.count > 0 ? Math.ceil(statistics.count * statistics.row * statistics.unit + statistics.gap) : 0;
  return high > 0 && room - high >= need ? high : 0;
}
