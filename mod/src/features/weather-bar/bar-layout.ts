// Sizes of the weather bar, without the sim (tested by test/weather-bar.test.ts): the presets grid in whole pixels, the
// height of the dropdown of the added presets. bar.ts measures the page and writes the results.

/** Gap between the bar's tiles, and between its blocks (the tabs, the sections), in layout units (as in weather-bar.css). */
export const GAP = 6;

/** A cell of the presets grid: its first column (counted over the rows) and the number of columns it spans. */
export interface PresetCell {
  start: number;
  span: number;
}

/** A cell's width and margins, in whole pixels. */
export interface PresetCellSize {
  width: number;
  marginRight: number;
  marginTop: number;
}

/**
 * The preset grid `width` pixels wide, `perRow` cells per row, `gap` pixels between them, in whole pixels: the pixels
 * left over go one each to the first cells of the rows. In units, the engine rounded each cell down and the rows ended
 * 5 pixels short (measured 2026-10-30).
 */
export function presetCellSizes(width: number, gap: number, perRow: number, cells: readonly PresetCell[]): PresetCellSize[] {
  const free = width - (perRow - 1) * gap;
  const base = Math.floor(free / perRow);
  const extra = free - base * perRow;
  return cells.map(({ start, span }) => {
    const column = start % perRow;
    let size = (span - 1) * gap;
    for (let at = column; at < column + span; at++) size += base + (at < extra ? 1 : 0);
    return { width: size, marginRight: column + span >= perRow ? 0 : gap, marginTop: start >= perRow ? gap : 0 };
  });
}

/** The sim's dropdown in layout units (sim/components.ts): an item with its gap, the edge above and below, the padding. */
export interface DropdownMetrics {
  item: number;
  edge: number;
  padding: number;
}

/** The dropdown's list as bar.ts sets it: upwards or not, its `List_Size` and its top padding, in layout units. */
export interface PresetListSize {
  up: boolean;
  size: number;
  padding: number;
}

/**
 * The list of the added presets, `list.count` of them: downwards, exactly to the bottom of the panel's last buttons
 * (`below`, in layout units under the dropdown), the sim's own scroll for the items that do not fit, whole items at rest
 * (the room they leave goes into the top padding); upwards to the top of the column (`above`) when fewer than `least`
 * items fit below. `unit`: pixels per layout unit (half a pixel more downwards: the engine rounds the height down).
 */
export function presetListSize(list: { count: number; below: number; above: number; unit: number }, metrics: DropdownMetrics, least: number): PresetListSize {
  const fitBelow = Math.floor((list.below - metrics.padding) / metrics.item);
  if (fitBelow < least) {
    const fitAbove = Math.floor((list.above - metrics.padding) / metrics.item);
    return { up: true, size: Math.max(1, Math.min(list.count, fitAbove)) * metrics.item + metrics.padding, padding: metrics.edge };
  }
  if (list.count <= fitBelow) return { up: false, size: list.count * metrics.item + metrics.padding, padding: metrics.edge };
  return {
    up: false,
    size: list.below + 0.5 / list.unit,
    padding: metrics.edge + list.below - (fitBelow * metrics.item + metrics.padding),
  };
}
