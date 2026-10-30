// Geometry of the gallery's Default view: two rows of large tiles scrolling horizontally, laid out like the sim's own
// grid (measured at 3440 x 1440 on 2026-10-30). Pure functions, tested by test/default-grid.test.ts; no sim here.

/** Tile width of the sim's grid, in units: measured on the sim's grid at 3440 x 1440 (2026-10-30). */
const TILE_UNITS = 360;
/** Gap between two tiles of the sim's grid, in units: measured on the sim's grid at 3440 x 1440 (2026-10-30). */
const GAP_UNITS = 24;
/** Proportions of the sim's grid images (480 × 229): the image is never cut. */
const IMAGE_RATIO = 229 / 480;
/** Room the text banner needs under the image: its three lines of text, 75 units (measured 2026-10-30). */
const BANNER_UNITS = 75;

/** The grid's measures, in pixels. */
export interface DefaultGrid {
  columns: number;
  tileWidth: number;
  tileHeight: number;
  imageHeight: number;
  gap: number;
  gridWidth: number;
}

/**
 * The Default view's grid in a room `width` × `height` pixels for the two rows, at `unit` pixels per unit. The columns
 * are the nearest count to the room's width (one or more); columns are added while the banner under the image is
 * shorter than its room. Every column has the same width; `gridWidth` is the width the tiles take (at most
 * `columns - 1` pixels short of `width`).
 */
export function defaultGrid(width: number, height: number, unit: number): DefaultGrid {
  const gap = Math.round(GAP_UNITS * unit);
  const tileHeight = Math.floor((height - gap) / 2);
  const bannerRoom = BANNER_UNITS * unit;
  const layoutFor = (columns: number): DefaultGrid => {
    const tileWidth = Math.floor((width - (columns - 1) * gap) / columns);
    const imageHeight = Math.round(tileWidth * IMAGE_RATIO);
    return { columns, tileWidth, tileHeight, imageHeight, gap, gridWidth: columns * tileWidth + (columns - 1) * gap };
  };
  let columns = Math.max(1, Math.round((width + gap) / (TILE_UNITS * unit + gap)));
  let grid = layoutFor(columns);
  while (tileHeight - grid.imageHeight < bannerRoom) {
    const next = layoutFor(columns + 1);
    if (next.tileWidth < 1) break;
    columns += 1;
    grid = next;
  }
  return grid;
}

/**
 * The scroll position of the Default view settled on the column nearest `position`: a multiple of `step` (one column
 * plus its gap), clamped to `[0, max]`; `max` itself when it is nearer than the last multiple not above it.
 */
export function settleColumn(position: number, step: number, max: number): number {
  const clamped = Math.max(0, Math.min(max, position));
  let candidate = Math.round(clamped / step) * step;
  if (candidate > max) candidate = Math.floor(max / step) * step;
  return max - clamped < Math.abs(clamped - candidate) ? max : candidate;
}

/** The place of a tile in the Default view's grid: column-major, as the sim (tiles 0 and 1 in column 0). */
export function columnOf(index: number): { column: number; row: 0 | 1 } {
  return { column: Math.floor(index / 2), row: index % 2 === 0 ? 0 : 1 };
}
