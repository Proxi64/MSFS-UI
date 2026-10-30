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

/** The wheel delta that moves the Default view one column: a mouse wheel's notch (deltaY 100, deltaMode 0, measured on 1.9.21, 2026-10-30). */
export const WHEEL_COLUMN_DELTA = 100;

/**
 * The wheel's travel in whole columns: the events' deltas add up (a touchpad or a free-spinning wheel gives many small
 * ones) and every WHEEL_COLUMN_DELTA of them is one column; a change of direction starts again from nothing.
 */
export class WheelColumns {
  private rest = 0;

  /** The whole columns this event adds (negative toward the start); a delta in lines or pages (`deltaMode` not 0) is one notch. */
  add(delta: number, deltaMode: number): number {
    if (!delta) return 0;
    const pixels = deltaMode === 0 ? delta : Math.sign(delta) * WHEEL_COLUMN_DELTA;
    if (this.rest !== 0 && Math.sign(this.rest) !== Math.sign(pixels)) this.rest = 0;
    this.rest += pixels;
    const columns = this.rest > 0 ? Math.floor(this.rest / WHEEL_COLUMN_DELTA) : Math.ceil(this.rest / WHEEL_COLUMN_DELTA);
    if (columns === 0) return 0;
    this.rest -= columns * WHEEL_COLUMN_DELTA;
    return columns;
  }

  /** Forgets the travel short of a column. */
  reset(): void {
    this.rest = 0;
  }
}

/** A part of the bar, in pixels from the grid's left edge. */
export interface BarSpan {
  left: number;
  right: number;
}

/**
 * Narrowest room for Hidden, Favorites and the sort dropdown, in units: the two buttons (114 and 130, the gallery's
 * CSS), the margin between them and before the dropdown (6 each), and 100 for the dropdown's title.
 */
const MIDDLE_MIN_UNITS = 114 + 6 + 130 + 6 + 100;
/**
 * Narrowest room for the sort's direction (30) and the three view tabs (6 before each), in units: 70 for a tab, room
 * for its label ("Gallery", "List", "Default"), its padding and the selected tab's corner tick.
 */
const LAST_MIN_UNITS = 30 + 3 * (6 + 70);

/**
 * The bar of the Default view over the grid's columns (the owner's wish, 2026-10-30): the search and count over the
 * first column, Hidden, Favorites and the sort dropdown over the middle ones, the sort's direction and the view tabs
 * over the last; each part from its columns' left edge to their right one. Null under three columns, or when the
 * middle or last part would be too narrow for its controls: the bar then stays on one line.
 */
export function barColumns(grid: DefaultGrid, unit: number): { first: BarSpan; middle: BarSpan; last: BarSpan } | null {
  if (grid.columns < 3) return null;
  const step = grid.tileWidth + grid.gap;
  const lastLeft = (grid.columns - 1) * step;
  const middle = { left: step, right: lastLeft - grid.gap };
  const last = { left: lastLeft, right: grid.gridWidth };
  if (middle.right - middle.left < MIDDLE_MIN_UNITS * unit || last.right - last.left < LAST_MIN_UNITS * unit) return null;
  return { first: { left: 0, right: grid.tileWidth }, middle, last };
}

/** The place of a tile in the Default view's grid: column-major, as the sim (tiles 0 and 1 in column 0). */
export function columnOf(index: number): { column: number; row: 0 | 1 } {
  return { column: Math.floor(index / 2), row: index % 2 === 0 ? 0 : 1 };
}
