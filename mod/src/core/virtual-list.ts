// Lists of the sim's components kept small (tested by test/virtual-list.test.ts). One of the sim's aircraft tiles is
// about 110 elements, and every change of layout lays them all out again: with the 149 tiles of the gallery alive, any
// change (a hover, a selection) costs about 150 ms at 3440 × 1440 (4.8 ms without them; measured on 1.9.18). So a list
// keeps components only near its visible part, as the sim's own grid does: its cells keep their place, empty.

/** What to do with a cell: create its components, destroy them, or nothing. */
export type CellAction = 'create' | 'destroy' | 'none';

/** A vertical extent, in pixels. */
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
