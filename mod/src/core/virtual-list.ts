// Lists of the sim's components kept small (tested by test/virtual-list.test.ts). One of the sim's aircraft tiles is
// about 110 elements, and every change of layout lays them all out again: with the 149 tiles of the gallery alive, any
// change (a hover, a selection) costs about 150 ms at 3440 × 1440 (4.8 ms without them; measured on 1.9.21). So a list
// keeps components only near its visible part, as the sim's own grid does: its cells keep their place, empty.

/** What to do with a cell: create its components, destroy them, or nothing. */
export type CellAction = 'create' | 'destroy' | 'none';

/** An extent along a list's axis, in pixels: top and bottom, or left and right along x (gallery.ts). */
export interface Extent {
  top: number;
  bottom: number;
}

/**
 * The action for a cell: its components are created within `margins.create` of the visible part, and kept until
 * farther than `margins.keep` (a gap between the two, so a small scroll back and forth does not create them again).
 */
export function cellAction(cell: Extent, created: boolean, view: Extent, margins: { create: number; keep: number }): CellAction {
  const distance = Math.max(0, view.top - cell.bottom, cell.top - view.bottom);
  if (!created) return distance <= margins.create ? 'create' : 'none';
  return distance > margins.keep ? 'destroy' : 'none';
}

/**
 * The width a list lays its tiles out in: the full width while its content fits in it, otherwise the width its scroll
 * bar leaves (`bar`). Decided on the full width only: tiles in a fixed number of columns are shorter when narrower, so
 * a decision on the current width would make the content fit again once the bar shows, then scroll again once it
 * goes, the tiles changing size at every pass.
 */
export function layoutWidth(full: number, bar: number, contentHeightAt: (width: number) => number, listHeight: number): { width: number; scrolls: boolean } {
  const scrolls = contentHeightAt(full) > listHeight + 0.5;
  return { width: scrolls ? full - bar : full, scrolls };
}