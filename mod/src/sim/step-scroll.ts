// A list of the sim resting on whole steps: the Showcase view's columns, the grid of small liveries' rows. The wheel moves
// whole steps instead of the sim's own (a third of a column: 187 pixels of 548 at 1440 lines, measured on 1.9.21,
// 2026-10-30), and a scroll that ends between two steps (the bar dragged) settles on the nearest one.

import { debounced } from '../core/async.ts';
import type { Scope } from '../core/scope.ts';
import { settleOnStep, WheelSteps } from '../core/wheel-steps.ts';
import type { RealScroll } from './real-scroll.ts';

/** Quiet time after the last scroll before the list settles on a whole step. */
const SETTLE_DELAY_MS = 150;

/**
 * No mouse button held during `event`. Coherent GT has no `buttons` (measured on 1.9.21, 2026-10-30): its `which`, as
 * in WebKit, is 0 when no button is down and the button's number plus one otherwise.
 */
function noButtonHeld(event: MouseEvent): boolean {
  const buttons = (event as { buttons?: unknown }).buttons;
  return typeof buttons === 'number' ? buttons === 0 : event.which === 0;
}

export interface StepScrollOptions {
  list: RealScroll;
  /** Where the presses and the wheel over the list arrive: an input group holding it. */
  host: HTMLElement;
  /** From one step to the next, in pixels (0 before the list is laid out). */
  step(): number;
  /** The largest scroll position, in pixels. */
  max(): number;
  /** Scrolls the list to a position it rests on. */
  scrollTo(position: number): void;
}

/**
 * Keeps the list on whole steps until `scope` is disposed: one step per notch of a mouse wheel, the small deltas of a
 * touchpad adding up (WheelSteps), each notch going on from the step the previous ones aimed at while the list still
 * moves. A scroll between two steps settles on the nearest 150 ms after the last `ui-scroll` or wheel event; while a
 * mouse button that went down in `host` is held, it waits for the release: a `mouseup` on the window (where the sim's
 * own drags end), or the first move that reports no button held (a release the page never got).
 */
export function keepOnSteps(scope: Scope, options: StepScrollOptions): void {
  const { list, host } = options;
  const wheel = new WheelSteps();
  /** The step the wheel aims at while the list moves; null once it settles (the next notch starts from where it is). */
  let target: number | null = null;
  let held = false;
  const settle = () => {
    wheel.reset();
    target = null;
    const step = options.step();
    if (!step) return;
    const at = list.currentScroll || 0;
    const to = settleOnStep(at, step, options.max());
    if (to !== at) options.scrollTo(to);
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
  // An input group: a press on the bar or an item arrives here (capture: before the sim's list handles it).
  scope.listen(
    host,
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
    host,
    'wheel',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      quiet.call();
      const steps = wheel.add(event.deltaY || event.deltaX, event.deltaMode);
      const step = options.step();
      if (!steps || !step) return;
      const max = options.max();
      const from = target !== null ? target : Math.round(settleOnStep(list.currentScroll || 0, step, max) / step);
      target = Math.max(0, Math.min(Math.ceil(max / step), from + steps));
      options.scrollTo(settleOnStep(target * step, step, max));
    },
    true,
  );
  scope.listen(list, 'ui-scroll', quiet.call);
}
