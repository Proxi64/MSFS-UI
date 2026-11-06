// Free Flight's places on every screen width, without the sim (tested by test/freeflight-layout.test.ts): the two
// columns 24 units from the screen's edges, up to a 21:9 width and centred beyond it; the rows 24 units apart from the
// screen's top and bottom (the owner, 2026-11-06; docs/superpowers/specs/2026-11-06-freeflight-wide-layout-design.md).
// Everything in whole pixels, so that blocks placed by different rules still share their edges.

import { GROUP_GAP } from '../../sim/freeflight-layout.ts';

/** The layout's widest, in layout units: a 21:9 screen (3440 x 1440). */
export const MAX_LAYOUT_UNITS = 2580;
/** The sim's column width (the aircraft button, the Flight Conditions block), in layout units. */
const COLUMN_UNITS = 440;

/** The screen and the heights of the sim's blocks, in pixels as drawn; `unit` in pixels per layout unit. */
export interface PlaceInput {
  width: number;
  height: number;
  unit: number;
  /** The profile bar (`MenuBar`). */
  menuHeight: number;
  /** The top row (`MainBlock`): the aircraft button, Departure / Arrival, Flight Conditions. */
  mainHeight: number;
  efbHeight: number;
  /** Start flight. */
  flyHeight: number;
}

/** Whole pixels from the screen's left or top edge. */
export interface Places {
  /** The left column's left edge. */
  left: number;
  /** The right column's right edge. */
  right: number;
  columnWidth: number;
  /** Departure / Arrival's `left` and `right` inside the top row: a column and a group gap. */
  planInset: number;
  menuTop: number;
  mainTop: number;
  /** Search location, a group gap under the top row. */
  searchTop: number;
  /** Start flight's bottom. */
  buttonsBottom: number;
  /** EFB and Start flight with a group gap between them. */
  buttonsHeight: number;
  /** The map buttons' bottom, a group gap above EFB. */
  filtersBottom: number;
}

export function freeflightPlaces(input: PlaceInput): Places {
  const { width, height, unit } = input;
  const gap = Math.floor(GROUP_GAP * unit);
  const layoutWidth = Math.min(width, Math.floor(MAX_LAYOUT_UNITS * unit));
  // Even, so that the top row's −50 % pivot lands on a whole pixel.
  const content = 2 * Math.floor((layoutWidth - 2 * gap) / 2);
  const left = Math.round((width - content) / 2);
  const columnWidth = Math.floor(COLUMN_UNITS * unit);
  const mainTop = gap + input.menuHeight + gap;
  const buttonsBottom = height - gap;
  const buttonsHeight = input.efbHeight + gap + input.flyHeight;
  return {
    left,
    right: left + content,
    columnWidth,
    planInset: columnWidth + gap,
    menuTop: gap,
    mainTop,
    searchTop: mainTop + input.mainHeight + gap,
    buttonsBottom,
    buttonsHeight,
    filtersBottom: buttonsBottom - buttonsHeight - gap,
  };
}
