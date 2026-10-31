// What Free Flight's two columns share, so that their first blocks stand level: the weather bar (right column) and the
// favourites (left column) leave the sim's own gap under the top cards.

/**
 * The sim's gap under its top cards on Free Flight, in layout units: under the aircraft button, above its search field
 * (measured 2026-10-30 at 1080, 1440 and 2160 lines), and under the Flight Conditions widget, above its runway card
 * (32 pixels at 1440 lines, measured 2026-10-31). The weather bar's tabs start that far under the widget, level with the
 * search field; the favourites that far under the aircraft button when the search field is not there. In pixels
 * rounded down, as the engine draws the other gaps.
 */
export const GROUP_GAP = 24;
