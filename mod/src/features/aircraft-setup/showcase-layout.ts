// Fixed places of the Showcase setup panel, without the sim (tested by test/aircraft-setup.test.ts). Top to bottom:
// the variants in a one-row dropdown, the livery header, the current livery large, a strip of small liveries scrolling
// sideways, the tail number row and a row of three buttons. Every part keeps the same place for a given panel size,
// whatever the aircraft: the number of variants or liveries changes what a part shows, never where it is.

import { GAP, LIVERY_RATIO, PADDING_TOP } from './setup-layout.ts';

/** Layout units: height of the dropdown, of the tail number row (as `.msfs-ui-setup__tail`) and of the buttons' row. */
const ROW_HEIGHT = 30;
/** Layout units the sim's horizontal scroll bar takes under the strip of small liveries. */
export const STRIP_BAR_UNITS = 8;
/** Small liveries per row that would fill the strip's width: only used to choose the number of rows. */
const STRIP_COLUMNS = 4;

/** A part's place, in pixels from the panel's top. */
export interface Span {
  top: number;
  height: number;
}

export interface ShowcasePlaces {
  variants: Span;
  header: Span;
  /** As wide as the panel. */
  livery: Span;
  strip: Span & { rows: number; thumbWidth: number; thumbHeight: number };
  tail: Span;
  /** Ends on the panel's bottom. */
  actions: Span;
}

/**
 * The places of the panel's parts in whole pixels, for a panel `width` x `height` pixels, a livery header
 * `headerHeight` pixels high and `unit` pixels per layout unit. The parts from the variants to the strip follow each
 * other with one gap between; the buttons end on the bottom, the tail row sits one gap above them, and the strip fills
 * everything from its top to the tail row less one gap and its bar room (the owner, 2026-11-01: no gap under the strip).
 * Its rows are the whole number nearest to what thumbnails four to a row would give (3 on the owner's screen); they
 * share the height, keeping the sim's proportions, so a row no longer holds a whole number of them: the strip scrolls
 * sideways and its last column shows in part, which tells there are more.
 */
export function showcasePlaces(width: number, height: number, headerHeight: number, unit: number): ShowcasePlaces {
  const gap = Math.round(GAP * unit);
  const row = Math.round(ROW_HEIGHT * unit);
  const variants = { top: Math.round(PADDING_TOP * unit), height: row };
  const header = { top: variants.top + variants.height + gap, height: headerHeight };
  const livery = { top: header.top + header.height + gap, height: Math.round(width * LIVERY_RATIO) };
  const actions = { top: height - row, height: row };
  const tail = { top: actions.top - gap - row, height: row };

  const stripTop = livery.top + livery.height + gap;
  const room = tail.top - gap - Math.ceil(STRIP_BAR_UNITS * unit) - stripTop;
  const fourWidth = Math.floor((width - (STRIP_COLUMNS - 1) * gap) / STRIP_COLUMNS);
  const fourHeight = Math.round(fourWidth * LIVERY_RATIO);
  const rows = Math.max(1, Math.round((room + gap) / (fourHeight + gap)));
  const thumbHeight = Math.floor((room - (rows - 1) * gap) / rows);
  const thumbWidth = Math.round(thumbHeight / LIVERY_RATIO);
  const strip = { top: stripTop, height: rows * thumbHeight + (rows - 1) * gap, rows, thumbWidth, thumbHeight };
  return { variants, header, livery, strip, tail, actions };
}

/**
 * Widths of the three buttons of the bottom row in a row `width` wide, `gap` pixels apart. Each button gets its need
 * (rounded up to whole pixels); the remainder is shared equally in whole pixels, the last button taking the rest.
 * Null when the needs do not fit.
 */
export function actionWidths(width: number, gap: number, needs: readonly [number, number, number]): [number, number, number] | null {
  const wanted = needs.map((need) => Math.ceil(need));
  const remainder = width - 2 * gap - (wanted[0] + wanted[1] + wanted[2]);
  if (remainder < 0) return null;
  const share = Math.floor(remainder / 3);
  return [wanted[0] + share, wanted[1] + share, wanted[2] + remainder - 2 * share];
}

/** The width the bottom row needs, in whole pixels: the three buttons' needs (rounded up) and the two gaps. */
export function rowNeed(needs: readonly [number, number, number], gap: number): number {
  return Math.ceil(needs[0]) + Math.ceil(needs[1]) + Math.ceil(needs[2]) + 2 * gap;
}

/**
 * The extra width, in whole layout units, the left column needs over the sim's `base` units for a panel `need` pixels
 * wide, the column `frame` pixels wider than the panel (the sim's border around it), `unit` pixels per layout unit.
 * One pixel to spare: the engine rounds the column's width down.
 */
export function columnExtra(need: number, frame: number, unit: number, base: number): number {
  return Math.ceil((need + frame + 1) / unit - base);
}

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
