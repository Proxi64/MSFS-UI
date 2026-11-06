// What Free Flight's two columns share, so that their blocks stand level: the weather bar (right column) and the
// favourites (left column) leave the same gaps under the top row (the owner, 2026-11-06: the favourites level with
// *Today*, the tabs level with *Search location*).

/**
 * The sim's gap under its top cards on Free Flight, in layout units: under the aircraft button, above its search field
 * (measured 2026-10-30 at 1080, 1440 and 2160 lines), and under the Flight Conditions widget, above its runway card
 * (32 pixels at 1440 lines, measured 2026-10-31). The weather bar's tabs start that far under the widget, level with the
 * search field. In pixels rounded down, as the engine draws the other gaps.
 */
export const GROUP_GAP = 24;

/** The gap inside a group, in layout units: between the weather bar's sections, under the search field and the tabs. */
export const SECTION_GAP = 6;

/** The height of the sim's search field on Free Flight (`Searchblock`), and of the weather bar's tab row, in layout units. */
export const SEARCH_ROW = 30;

/** The sim's Flight Conditions widget on Free Flight: shown (`isShown`) once the screen is really on display. */
export const FLIGHT_CONDITIONS_WIDGET = '[name="Flight_Conditions_History_Widget"]';

/**
 * The top, in pixels, of what comes under the search field or the tab row below a block of the top row whose bottom is
 * `anchorBottom`: the favourites under the aircraft button (whether the sim shows its search field or not: a block's
 * place does not depend on what the column shows), *Today* under the Flight Conditions widget.
 */
export function underSearchTop(anchorBottom: number, unit: number): number {
  return anchorBottom + Math.floor(GROUP_GAP * unit) + Math.floor(SEARCH_ROW * unit) + Math.floor(SECTION_GAP * unit);
}
