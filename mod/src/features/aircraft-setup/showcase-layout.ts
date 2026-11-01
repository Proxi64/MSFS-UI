// Fixed places of the Showcase setup panel, without the sim (tested by test/aircraft-setup.test.ts). Top to bottom:
// the variants in a one-row dropdown, the livery header, the current livery large, a grid of small liveries four to a
// row scrolling down, and a block of two rows (the tail number, then Fuel and Identification) beside the Configure
// tile. Every part keeps the same place for a given panel size, whatever the aircraft: the number of variants or
// liveries changes what a part shows, never where it is.

import { GAP, LIVERY_RATIO, PADDING_TOP, SCROLL_BAR_ROOM } from './setup-layout.ts';

/** Layout units: height of the dropdown, of the tail number row (as `.msfs-ui-setup__tail`) and of the buttons' row. */
const ROW_HEIGHT = 30;
/** Layout units the sim's horizontal scroll bar takes under the strip of small liveries (replaced in the next task). */
export const STRIP_BAR_UNITS = 8;
/** Small liveries per row of the grid. */
const GRID_COLUMNS = 4;

/** A part's place, in pixels from the panel's top. */
export interface Span {
  top: number;
  height: number;
}

export interface ShowcasePlaces {
  /** One row, as high as the livery header. */
  variants: Span;
  header: Span;
  /** As wide as the panel. */
  livery: Span;
  /** Four whole thumbnails across, `rowStep` pixels from one row to the next; it scrolls down. */
  grid: Span & { columns: 4; thumbWidth: number; thumbHeight: number; rowStep: number };
  /** Two rows and their gap, ending on the panel's bottom. */
  bottom: Span;
}

/**
 * The places of the panel's parts in whole pixels, for a panel `width` x `height` pixels, a livery header
 * `headerHeight` pixels high and `unit` pixels per layout unit. The parts from the variants to the grid follow each
 * other with one gap between; the bottom block ends on the bottom and the grid fills everything from its top to one gap
 * above the block. `scrolls`: the liveries do not fit the grid, so a vertical scroll bar takes its room on the right
 * and the four thumbnails share the rest of the width (whole pixels; the sim's proportions).
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
  const thumbWidth = Math.floor((width - (GRID_COLUMNS - 1) * gap - bar) / GRID_COLUMNS);
  const thumbHeight = Math.round(thumbWidth * LIVERY_RATIO);
  const grid = { top: gridTop, height: bottom.top - gap - gridTop, columns: GRID_COLUMNS as 4, thumbWidth, thumbHeight, rowStep: thumbHeight + gap };
  return { variants, header, livery, grid, bottom };
}

/** What the bottom block's parts need, in pixels (measured by the caller). */
export interface BottomNeeds {
  tail: number;
  field: number;
  fuel: number;
  identification: number;
  configure: number;
}

/**
 * The columns of the bottom block in a row `width` wide, `gap` pixels apart, whole pixels: the right column (the tail
 * number's title and field above Fuel and Identification) is as wide as the wider of its two rows, `title + gap + field`
 * or `fuel + gap + identification`; the Configure tile takes the rest. In the right column the tail title and the Fuel
 * button keep their need, the field and Identification take the rest of their rows. Null when the tile gets less than
 * its own need.
 */
export function bottomColumns(width: number, gap: number, needs: BottomNeeds): { configure: number; right: number; tailTitle: number; fuel: number } | null {
  const tailTitle = Math.ceil(needs.tail);
  const fuel = Math.ceil(needs.fuel);
  const right = Math.max(tailTitle + gap + Math.ceil(needs.field), fuel + gap + Math.ceil(needs.identification));
  const configure = width - gap - right;
  return configure < Math.ceil(needs.configure) ? null : { configure, right, tailTitle, fuel };
}

/** The width the bottom block needs, in whole pixels: its right column, the gap and the Configure tile (bottomColumns). */
export function rowNeed(needs: BottomNeeds, gap: number): number {
  return Math.ceil(needs.configure) + gap + Math.max(Math.ceil(needs.tail) + gap + Math.ceil(needs.field), Math.ceil(needs.fuel) + gap + Math.ceil(needs.identification));
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
 * The scroll position, in pixels, that brings row `row` of the grid (`rowStep` pixels per row, gap included) into a
 * view `view` pixels high scrolled to `scroll`: null when the row is already whole in view; otherwise whole rows: a
 * row above the view, or cut at its top, on the view's top; one below it, or cut at the bottom, with its bottom on the
 * view's bottom; within 0 to `max`, the largest scroll.
 */
export function gridReveal(row: number, rowStep: number, view: number, scroll: number, max: number): number | null {
  const top = row * rowStep;
  const bottom = top + rowStep;
  if (top >= scroll && bottom <= scroll + view) return null;
  return Math.max(0, Math.min(max, top < scroll ? top : bottom - view));
}

// Until the next task replaces the strip of small liveries by the grid.
/** The place of livery `index` in the strip of small liveries: column-major, `rows` to a column, the first on top. */
export function stripCell(index: number, rows: number): { column: number; row: number } {
  return { column: Math.floor(index / rows), row: index % rows };
}

/**
 * The scroll position, in pixels, that brings column `column` of the strip into a view `view` pixels wide scrolled to
 * `scroll`: null when the column is already whole in view; otherwise the strip moves as little as it can: a column
 * cut on the left, or beyond it, on the view's left edge; one cut on the right, or beyond it, on the view's right edge;
 * within the scroll range. The strip has `columns` columns `thumbWidth` pixels wide, `gap` pixels apart.
 */
export function stripReveal(column: number, columns: number, thumbWidth: number, gap: number, view: number, scroll: number): number | null {
  const left = column * (thumbWidth + gap);
  const right = left + thumbWidth;
  if (left >= scroll && right <= scroll + view) return null;
  const max = Math.max(0, columns * thumbWidth + (columns - 1) * gap - view);
  return Math.max(0, Math.min(max, left < scroll ? left : right - view));
}
