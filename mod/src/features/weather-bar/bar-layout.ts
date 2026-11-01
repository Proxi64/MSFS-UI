// Sizes of the weather bar, without the sim (tested by test/weather-bar.test.ts): the presets grid in whole pixels.
// bar.ts measures the page and writes the results.

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

