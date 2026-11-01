// Fixed places of the Showcase setup panel, without the sim (tested by test/aircraft-setup.test.ts). Top to bottom:
// the variants in a one-row dropdown, the livery header, the current livery large, a grid of small liveries four to a
// row scrolling down, and a block of two rows (the tail number, then Fuel and Identification) beside the Configure
// tile. Every part keeps the same place for a given panel size, whatever the aircraft: the number of variants or
// liveries changes what a part shows, never where it is.

import { GAP, LIVERY_RATIO, PADDING_TOP, SCROLL_BAR_ROOM } from './setup-layout.ts';

/** Layout units: height of each row of the bottom block (as `.msfs-ui-setup__tail`). */
const ROW_HEIGHT = 30;
/** Small liveries per row of the grid. */
export const GRID_COLUMNS = 4;

/** A part's place, in pixels from the panel's top. */
export interface Span {
  top: number;
  height: number;
}

/** The grid of small liveries: its place and its thumbnails, in whole pixels. */
export interface GridPlace extends Span {
  /** The liveries do not fit: the scroll bar takes its room on the right. */
  scrolls: boolean;
  thumbWidth: number;
  /** The fourth column's width: it takes what the whole pixels leave, so that the grid ends on the panel's edge. */
  lastWidth: number;
  thumbHeight: number;
  /** From one row to the next, the gap included. */
  rowStep: number;
}

export interface ShowcasePlaces {
  /** One row, as high as the livery header. */
  variants: Span;
  header: Span;
  /** As wide as the panel. */
  livery: Span;
  /** Four whole thumbnails across; it scrolls down. */
  grid: GridPlace;
  /** Two rows and their gap, ending on the panel's bottom. */
  bottom: Span;
}

/**
 * The places of the panel's parts in whole pixels, for a panel `width` x `height` pixels, a livery header
 * `headerHeight` pixels high and `unit` pixels per layout unit. The parts from the variants to the grid follow each
 * other with one gap between; the bottom block ends on the bottom and the grid fills everything from its top to one gap
 * above the block. `scrolls` (gridFor): the liveries do not fit the grid, so a vertical scroll bar takes its room on
 * the right and the four thumbnails share the rest of the width (whole pixels; the sim's proportions).
 */
export function showcasePlaces(width: number, height: number, headerHeight: number, unit: number, scrolls: boolean): ShowcasePlaces {
  const gap = Math.round(GAP * unit);
  const row = Math.round(ROW_HEIGHT * unit);
  const variants = { top: Math.round(PADDING_TOP * unit), height: headerHeight };
  const header = { top: variants.top + variants.height + gap, height: headerHeight };
  const livery = { top: header.top + header.height + gap, height: Math.round(width * LIVERY_RATIO) };
  const bottomHeight = 2 * row + gap;
  const bottom = { top: height - bottomHeight, height: bottomHeight };

  const gridTop = livery.top + livery.height + gap;
  const bar = scrolls ? Math.round(SCROLL_BAR_ROOM * unit) : 0;
  const room = Math.round(width) - (GRID_COLUMNS - 1) * gap - bar;
  const thumbWidth = Math.floor(room / GRID_COLUMNS);
  const thumbHeight = Math.round(thumbWidth * LIVERY_RATIO);
  const grid = {
    top: gridTop,
    height: bottom.top - gap - gridTop,
    scrolls,
    thumbWidth,
    lastWidth: room - (GRID_COLUMNS - 1) * thumbWidth,
    thumbHeight,
    rowStep: thumbHeight + gap,
  };
  return { variants, header, livery, grid, bottom };
}

/**
 * The grid for `count` liveries, from its two forms (the place given by showcasePlaces without and with the scroll bar);
 * a function of the count and the sizes only, never of what the last pass drew, so that it cannot swing between two
 * widths from pass to pass. The wide form when the rows fit; the scrolling form when they fit in neither; between the
 * two (the wide rows too high by a few pixels, the narrow ones fitting: a list that would not scroll, with room left for
 * a scroll bar it does not show) the wide form, its thumbnails lowered to fit: on the panel's edges, no bar, at most 6 %
 * lower than the sim's proportions (the sim's image covers its button: it is cut, not squeezed).
 */
export function gridFor(count: number, wide: GridPlace, narrow: GridPlace): GridPlace {
  const rows = Math.ceil(count / GRID_COLUMNS);
  const high = (grid: GridPlace) => rows * grid.rowStep - (grid.rowStep - grid.thumbHeight);
  if (rows === 0 || high(wide) <= wide.height) return wide;
  if (high(narrow) > narrow.height) return narrow;
  const gap = wide.rowStep - wide.thumbHeight;
  const thumbHeight = Math.floor((wide.height - (rows - 1) * gap) / rows);
  return { ...wide, thumbHeight, rowStep: thumbHeight + gap };
}

/** Whether the grid gets at least one row: under it (the screen animates) the panel is not laid out. */
export function gridHasRoom(grid: Pick<GridPlace, 'height' | 'thumbHeight' | 'rowStep'>): boolean {
  return grid.thumbHeight >= 1 && grid.height >= grid.rowStep;
}

/** What the bottom block's parts need, in pixels (measured by the caller). */
export interface BottomNeeds {
  tail: number;
  field: number;
  fuel: number;
  identification: number;
  configure: number;
}

/** The bottom block's columns: the tile, the right column, and in that column the tail title's and the Fuel button's widths. */
export interface BottomColumns {
  configure: number;
  right: number;
  tailTitle: number;
  fuel: number;
}

/**
 * The columns of the bottom block in a row `width` wide, `gap` pixels apart, whole pixels: the right column's two rows
 * (the tail number's title and field, Fuel and Identification) share one vertical line (the owner's mark, 2026-11-01).
 * The first column, the tail title and Fuel, is as wide as the wider of the two; the second, the field and
 * Identification, as wide as the wider of those; the right column is their sum and the gap, the Configure tile takes the
 * rest. The field and Identification take what remains of their rows, so both end on the panel's edge. Null when the
 * tile gets less than its own need.
 */
export function bottomColumns(width: number, gap: number, needs: BottomNeeds): BottomColumns | null {
  const first = Math.max(Math.ceil(needs.tail), Math.ceil(needs.fuel));
  const second = Math.max(Math.ceil(needs.field), Math.ceil(needs.identification));
  const right = first + gap + second;
  const configure = width - gap - right;
  return configure < Math.ceil(needs.configure) ? null : { configure, right, tailTitle: first, fuel: first };
}

/** The columns until the needs are measured, or while the left column widens to them: halves, in whole pixels. */
export function sharedColumns(width: number, gap: number): BottomColumns {
  const right = Math.floor((width - gap) / 2);
  const half = Math.floor((right - gap) / 2);
  return { configure: width - gap - right, right, tailTitle: half, fuel: half };
}

/** The width the bottom block needs, in whole pixels: its right column, the gap and the Configure tile (bottomColumns). */
export function rowNeed(needs: BottomNeeds, gap: number): number {
  return Math.ceil(needs.configure) + gap + Math.max(Math.ceil(needs.tail), Math.ceil(needs.fuel)) + gap + Math.max(Math.ceil(needs.field), Math.ceil(needs.identification));
}

/**
 * The extra width, in whole layout units, the left column needs over the sim's `base` units for a panel `need` pixels
 * wide, the column `frame` pixels wider than the panel (the sim's border around it), `unit` pixels per layout unit.
 * One pixel to spare: the engine rounds the column's width down.
 */
export function columnExtra(need: number, frame: number, unit: number, base: number): number {
  return Math.ceil((need + frame + 1) / unit - base);
}

/** The place of livery `index` in the grid of small liveries: four to a row, row-major, the first on top left. */
export function gridCell(index: number): { row: number; column: number } {
  return { row: Math.floor(index / GRID_COLUMNS), column: index % GRID_COLUMNS };
}

/**
 * The scroll position, in pixels, that brings row `row` of the grid (thumbnails `thumbHeight` pixels high, `rowStep`
 * pixels from one row to the next) into a view `view` pixels high scrolled to `scroll`: null when the row is already
 * whole in view; otherwise the grid moves as little as it can: a row above the view, or cut at its top, on the view's
 * top; one below it, or cut at the bottom, with its thumbnails' bottom on the view's bottom; within 0 to `max`, the
 * largest scroll.
 */
export function gridReveal(row: number, rowStep: number, thumbHeight: number, view: number, scroll: number, max: number): number | null {
  const top = row * rowStep;
  const bottom = top + thumbHeight;
  if (top >= scroll && bottom <= scroll + view) return null;
  return Math.max(0, Math.min(max, top < scroll ? top : bottom - view));
}
