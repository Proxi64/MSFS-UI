// The sim's dropdown list (tested by test/dropdown-list.test.ts): the size of its list in layout units, and its scroll in
// whole items. The sizes live here, not in components.ts, which needs the sim's bundle: the tests load this module.

import { uiUnit } from '../core/dom.ts';
import type { RealScroll } from './real-scroll.ts';

/**
 * The sim's dropdown list, in layout units (measured 2026-10-30): items of 30 with 3 between them (DROPDOWN_ITEM per
 * item), DROPDOWN_EDGE of padding above and below, so `List_Size` = items x 33 + 9 (DROPDOWN_PADDING).
 */
export const DROPDOWN_ITEM = 33;
export const DROPDOWN_EDGE = 6;
export const DROPDOWN_PADDING = 9;

/** The sim's dropdown in layout units: an item with its gap, the edge above and below, the padding. */
export interface DropdownMetrics {
  item: number;
  edge: number;
  padding: number;
}

export const DROPDOWN_METRICS: DropdownMetrics = { item: DROPDOWN_ITEM, edge: DROPDOWN_EDGE, padding: DROPDOWN_PADDING };

/** The dropdown's list as the mod sets it: upwards or not, its `List_Size` and its top padding, in layout units. */
export interface DropdownListSize {
  up: boolean;
  size: number;
  padding: number;
}

/**
 * The list of `list.count` items: downwards, exactly to the bottom of the room under the dropdown (`below`, in layout
 * units), the sim's own scroll for the items that do not fit, whole items at rest (the room they leave goes into the top
 * padding); upwards to the top of the room above (`above`) when fewer than `least` items fit below. `unit`: pixels per
 * layout unit (half a pixel more downwards: the engine rounds the height down).
 */
export function dropdownListSize(list: { count: number; below: number; above: number; unit: number }, metrics: DropdownMetrics, least: number): DropdownListSize {
  const fitBelow = Math.floor((list.below - metrics.padding) / metrics.item);
  if (fitBelow < least) {
    const fitAbove = Math.floor((list.above - metrics.padding) / metrics.item);
    return { up: true, size: Math.max(1, Math.min(list.count, fitAbove)) * metrics.item + metrics.padding, padding: metrics.edge };
  }
  if (list.count <= fitBelow) return { up: false, size: list.count * metrics.item + metrics.padding, padding: metrics.edge };
  return {
    up: false,
    size: list.below + 0.5 / list.unit,
    padding: metrics.edge + list.below - (fitBelow * metrics.item + metrics.padding),
  };
}

/**
 * Opened, a dropdown's list shows its first items, or the item `index` at its top: the sim kept the position of an
 * earlier opening, in the middle of an item after a change of resolution (measured 2026-10-30). The position is a whole
 * number of items, by the items' spacing on the screen, so that they stay whole. `dropdown` is the component's element
 * (the one holding the list); nothing happens while the list is closed.
 */
export function scrollDropdownTo(dropdown: HTMLElement, index: number): void {
  const list = dropdown.querySelector<HTMLElement>('[name="List"]');
  const scroll = list ? list.querySelector<RealScroll>('real-scroll') : null;
  if (!list || !scroll || window.getComputedStyle(list).display === 'none') return;
  const tops = Array.prototype.slice
    .call(list.querySelectorAll('virtual-list-wrapper'))
    .map((slot: HTMLElement) => slot.getBoundingClientRect())
    .filter((box: DOMRect) => box.height > 0)
    .map((box: DOMRect) => box.top)
    .sort((a: number, b: number) => a - b);
  const step = tops.length > 1 ? tops[1]! - tops[0]! : DROPDOWN_ITEM * uiUnit();
  scroll.scrollToPosition(Math.min(scroll.maxScroll, Math.max(0, index) * step));
}
