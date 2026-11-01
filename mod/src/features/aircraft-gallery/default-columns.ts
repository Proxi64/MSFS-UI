// The Showcase view on whole columns (gallery.ts): its list scrolls along x as the sim's grid, and rests on a whole column
// of its grid (default-grid.ts) after the wheel, a drag of the bar, or a change of the column width.

import { debounced } from '../../core/async.ts';
import type { Scope } from '../../core/scope.ts';
import type { RealScroll } from '../../sim/real-scroll.ts';
import { settleColumn, WheelColumns, type DefaultGrid } from './default-grid.ts';
import type { GalleryCells } from './gallery-cells.ts';

/** Quiet time after the last scroll of the Showcase view before it settles on a whole column. */
const SETTLE_DELAY_MS = 150;

/**
 * No mouse button held during `event`. Coherent GT has no `buttons` (measured on 1.9.21, 2026-10-30): its `which`, as
 * in WebKit, is 0 when no button is down and the button's number plus one otherwise.
 */
function noButtonHeld(event: MouseEvent): boolean {
  const buttons = (event as { buttons?: unknown }).buttons;
  return typeof buttons === 'number' ? buttons === 0 : event.which === 0;
}

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
    const list = this.cells.list;
    if (list.updateSizes) list.updateSizes();
    this.cells.scrollTo(settleColumn(Math.max(0, column) * step, step, list.maxScroll || 0));
  }

  /**
   * The list rests on whole columns. The wheel moves whole columns instead of the sim's own step (a third of a column:
   * 187 pixels of 548 at 1440 lines, measured on 1.9.21, 2026-10-30): one per notch of a mouse wheel, the small deltas
   * of a touchpad adding up (WheelColumns), each notch going on from the column the previous ones aimed at while the
   * list still moves. A scroll that ends between columns (the bar dragged) settles on the nearest one 150 ms after the
   * last `ui-scroll` or wheel event; while a mouse button that went down in the gallery is held, it waits for the
   * release: a `mouseup` on the window (where the sim's own drags end), or the first move that reports no button held
   * (a release the page never got). Listeners disposed with `scope` (the list's).
   */
  keep(scope: Scope, list: RealScroll): void {
    const wheel = new WheelColumns();
    /** The column the wheel aims at while the list moves; null once it settles (the next notch starts from where it is). */
    let target: number | null = null;
    let held = false;
    const settle = () => {
      wheel.reset();
      target = null;
      this.settle(list);
    };
    const quiet = debounced(() => {
      if (!held) settle();
    }, SETTLE_DELAY_MS);
    scope.add(quiet.cancel);
    const release = () => {
      if (!held) return;
      held = false;
      quiet.cancel();
      settle();
    };
    // The body is an input group: a press on the bar or a tile arrives here (capture: before the sim's list handles it).
    scope.listen(
      this.body,
      'mousedown',
      () => {
        held = true;
      },
      true,
    );
    scope.listen(window, 'mouseup', release, true);
    scope.listen(document, 'mousemove', (event) => {
      if (held && noButtonHeld(event)) release();
    });
    scope.listen(
      this.body,
      'wheel',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        quiet.call();
        const columns = wheel.add(event.deltaY || event.deltaX, event.deltaMode);
        const step = this.step();
        if (!columns || !step) return;
        if (list.updateSizes) list.updateSizes();
        const max = list.maxScroll || 0;
        const from = target !== null ? target : Math.round(settleColumn(list.currentScroll || 0, step, max) / step);
        target = Math.max(0, Math.min(Math.ceil(max / step), from + columns));
        this.scrollToColumn(target);
      },
      true,
    );
    scope.listen(list, 'ui-scroll', quiet.call);
  }

  /** The list on the whole column nearest to where it is (or at its end), when it is not on one. */
  private settle(list: RealScroll): void {
    const step = this.step();
    if (!step || this.cells.list !== list) return;
    if (list.updateSizes) list.updateSizes();
    const at = list.currentScroll || 0;
    const to = settleColumn(at, step, list.maxScroll || 0);
    if (to !== at) this.cells.scrollTo(to);
  }
}
