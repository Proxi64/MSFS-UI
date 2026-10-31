// What Free Flight's two columns share, so that their groups of blocks stand the same distance apart: the weather bar
// (right column) sets the gap, the favourites (left column) read it at each layout pass (250 ms), with no order between
// the two features at start-up.

/**
 * Gap between the groups of blocks of a column on Free Flight, in layout units, when the weather bar does not set one:
 * the sim's own under its aircraft button (measured 2026-10-30 at 1080, 1440 and 2160 lines). The weather bar shares
 * its column's room evenly instead (the owner's choice, 2026-10-30: wider when the column has room, down to 6 units
 * when a METAR or a card's tabs fill it) and gives the gap it uses, in pixels, to the page's other column in
 * GROUP_GAP_ATTRIBUTE. In pixels rounded down, as the engine draws the other gaps.
 */
export const GROUP_GAP = 24;
export const GROUP_GAP_ATTRIBUTE = 'data-msfs-ui-group-gap';
