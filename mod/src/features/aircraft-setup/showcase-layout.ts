// Fixed places of the Showcase setup panel, without the sim (tested by test/aircraft-setup.test.ts). Top to bottom under
// the title block: the variants in a one-row dropdown, the livery header, the current livery large, a grid of small
// liveries three to a row and two whole rows high, and a block of two rows (the tail number, then Fuel and
// Identification) beside the Configure tile. Every part keeps the same place for a given panel size, whatever the
// aircraft: the number of variants or liveries changes what a part shows, never where it is. The gaps between the blocks
// are equal and share the room left (the owner, 2026-11-01).

import { GAP, LIVERY_RATIO } from './setup-layout.ts';

/** Layout units: height of each row of the bottom block (as `.msfs-ui-setup__tail`). */
const ROW_HEIGHT = 30;
/** Small liveries per row of the grid. */
export const GRID_COLUMNS = 3;
/** Rows of small liveries in view: never a cut one. */
export const GRID_ROWS = 2;
/** More liveries than the grid shows: it scrolls. */
const GRID_FITS = GRID_COLUMNS * GRID_ROWS;
/** Layout units kept beside the thumbnails for the sim's scroll bar (7.5 units wide), when the grid scrolls. */
const GRID_BAR_ROOM = 20;
/** The left column over the sim's in Showcase, at most, in layout units, unless its labels need more. */
const SHOWCASE_EXTRA_MAX = 90;

/** A part's place, in pixels from the panel's top. */
export interface Span {
  top: number;
  height: number;
}

/** The grid of small liveries: its place and its thumbnails, one size for every aircraft, in whole pixels. */
export interface GridPlace extends Span {
  /** More liveries than it shows: the scroll bar on the right, the columns closer. */
  scrolls: boolean;
  thumbWidth: number;
  thumbHeight: number;
  /** Between the first and the second column. */
  columnGap: number;
  /** Between the second and the third: it takes what the whole pixels leave, so that a grid without a bar ends on the panel's edge. */
  lastGap: number;
  /** From one row to the next, the gap included. */
  rowStep: number;
}

export interface ShowcasePlaces {
  /** Between all the blocks, the title block's bottom to the bottom block's top. */
  gap: number;
  /** One row, as high as the livery header. */
  variants: Span;
  header: Span;
  /** As wide as the panel. */
  livery: Span;
  /** The large livery gave up height: the column is too wide for it and the gaps at their minimum. */
  cropped: boolean;
  /** Three thumbnails across, two rows high. */
  grid: GridPlace;
  /** Two rows and their gap, ending on the panel's bottom. */
  bottom: Span;
}

/**
 * The places of the panel's parts in whole pixels, for a panel `width` x `height` pixels from the title block's bottom
 * to the bottom block's, a livery header `headerHeight` pixels high and `unit` pixels per layout unit; `count` liveries
 * (only the grid's columns depend on them). The five gaps are equal and share what the parts leave, the rounding going
 * to the large livery's height; at their minimum (`GAP`, a column wide enough to need it), the large livery gives up
 * height instead (`cropped`).
 */
export function showcasePlaces(width: number, height: number, headerHeight: number, unit: number, count: number): ShowcasePlaces {
  const panel = Math.round(width);
  const high = Math.round(height);
  const smallGap = Math.round(GAP * unit);
  const bottomHeight = 2 * Math.round(ROW_HEIGHT * unit) + smallGap;
  const thumbWidth = Math.max(0, Math.floor((panel - Math.round(GRID_BAR_ROOM * unit) - (GRID_COLUMNS - 1) * smallGap) / GRID_COLUMNS));
  const thumbHeight = Math.round(thumbWidth * LIVERY_RATIO);
  const gridHeight = GRID_ROWS * thumbHeight + (GRID_ROWS - 1) * smallGap;

  const fixed = 2 * headerHeight + gridHeight + bottomHeight;
  const whole = Math.round(panel * LIVERY_RATIO);
  const gap = Math.max(smallGap, Math.floor((high - fixed - whole) / 5));
  const liveryHeight = high - fixed - 5 * gap;

  const variants = { top: gap, height: headerHeight };
  const header = { top: variants.top + headerHeight + gap, height: headerHeight };
  const livery = { top: header.top + headerHeight + gap, height: liveryHeight };
  const scrolls = count > GRID_FITS;
  const spread = panel - GRID_COLUMNS * thumbWidth;
  const columnGap = scrolls ? smallGap : Math.floor(spread / 2);
  const grid = {
    top: livery.top + liveryHeight + gap,
    height: gridHeight,
    scrolls,
    thumbWidth,
    thumbHeight,
    columnGap,
    lastGap: scrolls ? smallGap : spread - columnGap,
    rowStep: thumbHeight + smallGap,
  };
  return { gap, variants, header, livery, cropped: liveryHeight < whole, grid, bottom: { top: high - bottomHeight, height: bottomHeight } };
}

/** Whether the panel gets its parts: under it (the screen animates) it is not laid out. */
export function panelHasRoom(places: ShowcasePlaces): boolean {
  return places.grid.thumbHeight >= 1 && places.livery.height >= places.grid.thumbHeight;
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

/** The left column's extra width in Showcase, in layout units: the option (`widen`) up to about 90, what the labels need (`labels`) above it. */
export function showcaseColumnExtra(widen: number, labels: number): number {
  return Math.max(Math.min(widen, SHOWCASE_EXTRA_MAX), labels);
}

/** The place of livery `index` in the grid of small liveries: three to a row, row-major, the first on top left. */
export function gridCell(index: number): { row: number; column: number } {
  return { row: Math.floor(index / GRID_COLUMNS), column: index % GRID_COLUMNS };
}

/**
 * The scroll position, in pixels, that brings row `row` of a grid of `rows` rows (`rowStep` pixels apart) into its view
 * of two whole rows, scrolled to `scroll`: null when it already is, on a whole row; otherwise the grid moves by whole
 * rows and as little as it can.
 */
export function gridReveal(row: number, rowStep: number, scroll: number, rows: number): number | null {
  const last = Math.max(0, rows - GRID_ROWS);
  const first = Math.max(0, Math.min(last, Math.round(scroll / rowStep)));
  const wanted = row < first ? row : row >= first + GRID_ROWS ? row - GRID_ROWS + 1 : first;
  const position = Math.max(0, Math.min(last, wanted)) * rowStep;
  return position === scroll ? null : position;
}
