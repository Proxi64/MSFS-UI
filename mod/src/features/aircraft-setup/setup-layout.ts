// Sizes of the setup panel's two lists, without the sim (tested by test/aircraft-setup.test.ts). The variants and the
// livery thumbnails share the room between the panel's fixed parts; each list scrolls in the sim's own scrolling
// element when it needs more. An aircraft with many variants (the iFly 737 MAX makes one per livery) keeps its
// liveries in view, and the reverse.

/** Rows of a list: their number and the height of one row with the gap under it, in pixels. */
export interface Rows {
  count: number;
  step: number;
}

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

/**
 * Scroll position that shows row `row` in a list of `height`, centred when the list scrolls (0 for the first rows).
 */
export function revealPosition(row: number, rows: Rows, height: number): number {
  const max = Math.max(0, rows.count * rows.step - height);
  const centred = row * rows.step - (height - rows.step) / 2;
  return Math.round(Math.min(max, Math.max(0, centred)));
}
