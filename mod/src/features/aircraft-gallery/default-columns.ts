// The Showcase view on whole columns (gallery.ts): its list scrolls along x as the sim's grid, and rests on a whole column
// of its grid (default-grid.ts) after the wheel, a drag of the bar, or a change of the column width.

import type { Scope } from '../../core/scope.ts';
import { settleOnStep } from '../../core/wheel-steps.ts';
import type { RealScroll } from '../../sim/real-scroll.ts';
import { keepOnSteps } from '../../sim/step-scroll.ts';
import type { DefaultGrid } from './default-grid.ts';
import type { GalleryCells } from './gallery-cells.ts';

export class DefaultColumns {
  private readonly cells: GalleryCells;
  /** The gallery's body: the presses and the wheel over the bar or a tile arrive there. */
  private readonly body: HTMLElement;
  /** The Showcase view's grid, as last laid out (null until then): its column step places the selected tile. */
  private grid: DefaultGrid | null = null;

  constructor(cells: GalleryCells, body: HTMLElement) {
    this.cells = cells;
    this.body = body;
  }

  /** The grid as now laid out; returns the one before (null the first time). */
  setGrid(grid: DefaultGrid): DefaultGrid | null {
    const previous = this.grid;
    this.grid = grid;
    return previous;
  }

  /** A column's step: the tile's width and the gap, in pixels (0 before the grid is laid out). */
  step(): number {
    return this.grid ? this.grid.tileWidth + this.grid.gap : 0;
  }

  /** Scrolls to column `column` (the list's end when that is nearer), measuring the list's sizes again first. */
  scrollToColumn(column: number): void {
    const step = this.step();
    if (!step) return;
    this.cells.scrollTo(settleOnStep(Math.max(0, column) * step, step, this.maxOf(this.cells.list)));
  }

  /** The list rests on whole columns (sim/step-scroll.ts). Listeners disposed with `scope` (the list's). */
  keep(scope: Scope, list: RealScroll): void {
    keepOnSteps(scope, {
      list,
      host: this.body,
      step: () => (this.cells.list === list ? this.step() : 0),
      max: () => this.maxOf(list),
      scrollTo: (position) => this.cells.scrollTo(position),
    });
  }

  /** The list's largest scroll, its sizes measured again first. */
  private maxOf(list: RealScroll): number {
    if (list.updateSizes) list.updateSizes();
    return list.maxScroll || 0;
  }
}
