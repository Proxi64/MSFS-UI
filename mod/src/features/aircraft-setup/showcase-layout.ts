// Fixed places of the Showcase setup panel, without the sim (tested by test/aircraft-setup.test.ts). Top to bottom:
// the variants in a one-row dropdown, the livery header, the current livery large, a strip of small liveries scrolling
// sideways, the tail number row and a row of three buttons. Every part keeps the same place for a given panel size,
// whatever the aircraft: the number of variants or liveries changes what a part shows, never where it is.

import { GAP, LIVERY_RATIO, PADDING_TOP } from './setup-layout.ts';

/** Layout units: height of the dropdown, of the tail number row (as `.msfs-ui-setup__tail`) and of the buttons' row. */
export const ROW_HEIGHT = 30;
/** Layout units the sim's horizontal scroll bar takes under the strip of small liveries. */
export const STRIP_BAR_UNITS = 8;
/** Small liveries per row in the strip. */
export const STRIP_COLUMNS = 4;

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
 * other with one gap between; the buttons end on the bottom, the tail row sits one gap above them, and the strip takes
 * the rows of small liveries that fit between its top and the tail row (its bar room and one gap kept). The room left
 * under the strip, less than one row, lies between its bar and the tail row.
 */
export function showcasePlaces(width: number, height: number, headerHeight: number, unit: number): ShowcasePlaces {
  const gap = Math.round(GAP * unit);
  const row = Math.round(ROW_HEIGHT * unit);
  const variants = { top: Math.round(PADDING_TOP * unit), height: row };
  const header = { top: variants.top + variants.height + gap, height: headerHeight };
  const livery = { top: header.top + header.height + gap, height: Math.round(width * LIVERY_RATIO) };
  const actions = { top: height - row, height: row };
  const tail = { top: actions.top - gap - row, height: row };

  const thumbWidth = Math.floor((width - (STRIP_COLUMNS - 1) * gap) / STRIP_COLUMNS);
  const thumbHeight = Math.round(thumbWidth * LIVERY_RATIO);
  const stripTop = livery.top + livery.height + gap;
  const room = tail.top - gap - Math.ceil(STRIP_BAR_UNITS * unit) - stripTop;
  const rows = Math.max(1, Math.floor((room + gap) / (thumbHeight + gap)));
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
