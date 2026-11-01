// The sim's dropdown list (tested by test/dropdown-list.test.ts): the metrics of its list in layout units, and its scroll in
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
export const DROPDOWN_SPACING = 3;

/** The sim's dropdown in layout units: an item with its gap, the edge above and below, the padding, the gap between items. */
export interface DropdownMetrics {
  item: number;
  edge: number;
  padding: number;
  spacing: number;
}

export const DROPDOWN_METRICS: DropdownMetrics = { item: DROPDOWN_ITEM, edge: DROPDOWN_EDGE, padding: DROPDOWN_PADDING, spacing: DROPDOWN_SPACING };
/** A list toward an obstacle under it (dropdownListToward), in layout units. */
export interface ListToward {
  count: number;
  /** From the dropdown's bottom (the list's top) to the obstacle's top. */
  below: number;
  /** The gap wanted between the list's bottom and the obstacle, and the least one. */
  gap: number;
  least: number;
  /** From the dropdown's top to the top of the room above it. */
  above: number;
  /** Pixels per layout unit. */
  unit: number;
}

/**
 * The list of `list.count` items going down toward an obstacle (the owner's choice, 2026-11-01: the presets' list down
 * to the map's buttons): its first item at the sim's own edge under the dropdown, whole items only, as many as leave
 * the gap above the obstacle nearest `list.gap`, never under `list.least`. All of them, the sim's edge under the last,
 * when they fit; otherwise the list ends on the last whole item's bottom (n items, the edge above them, no gap after
 * the last: the next one starts the gap's width under the bottom edge, so no part of it shows), half a pixel more as
 * the engine rounds the height down. Upwards, to the top of the room above (`list.above`), when fewer than
 * `leastItems` fit below and some do not.
 */
export function dropdownListToward(list: ListToward, metrics: DropdownMetrics, leastItems: number): { up: boolean; size: number } {
  const size = (items: number) => (items >= list.count ? list.count * metrics.item + metrics.padding : items * metrics.item + metrics.edge - metrics.spacing);
  let best = 0;
  for (let items = 1; items <= list.count; items++) {
    const gap = list.below - size(items);
    if (gap < list.least) break;
    if (best === 0 || Math.abs(gap - list.gap) <= Math.abs(list.below - size(best) - list.gap)) best = items;
  }
  const sized = (up: boolean, items: number) => ({ up, size: size(items) + (items < list.count ? 0.5 / list.unit : 0) });
  if (best >= Math.min(leastItems, list.count)) return sized(false, best);
  let above = 1;
  while (above < list.count && size(above + 1) <= list.above) above++;
  return sized(true, above);
}

/** A list ending on a given line whatever its items (dropdownListWithin), in layout units. */
export interface ListWithin {
  /** The list's box, and the room of its scrolling area: the box less the room whole items leave, or null when it is the box. */
  size: number;
  scroll: number | null;
}

/**
 * The list of `count` items going down exactly `below` layout units (the owner's rule: it always ends there). All the
 * items fit (the sim's edge above and below them): the box is `below` and the sim's scroll fills it, the room under the
 * last item empty. Otherwise the scrolling area keeps whole items only (`scroll`: n items, the edge above, no gap after
 * the last, so that no part of the next shows) and the box, `below`, shows the room left under it, empty. Half a pixel
 * more on the box: the engine rounds the height down. `unit`: pixels per layout unit.
 */
export function dropdownListWithin(list: { count: number; below: number; unit: number }, metrics: DropdownMetrics): ListWithin {
  const size = list.below + 0.5 / list.unit;
  if (list.count * metrics.item + metrics.padding <= list.below) return { size, scroll: null };
  const items = Math.max(1, Math.floor((list.below - metrics.edge + metrics.spacing) / metrics.item));
  return { size, scroll: items * metrics.item + metrics.edge - metrics.spacing };
}

/** Where a list opened on the item `index` is scrolled (scrollDropdownTo), in pixels. */
export interface ScrollTo {
  index: number;
  /** The items' spacing and an item's height on the screen. */
  step: number;
  height: number;
  /** The list's top padding: given, the previous item passes whole above the top. */
  edge: number;
  max: number;
}

/**
 * The item `index` at the top of the list, a whole number of steps down; with the list's top padding (`edge`, more
 * than the gap between items), that much further less the gap, so that the previous item passes whole above the top
 * and the item shows the gap's width under it. The sim scrolls by whole pixels while the items' spacing is not one
 * (measured 2026-11-01, 1164 lines: positions rounded down, up to a pixel of the previous item showed; rounded up, up
 * to a pixel of the next one): rounded up: the top slips at most a pixel into the gap above the item, the next one stays hidden. The first item, or none (-1):
 * the list's top.
 */
export function dropdownScrollPosition(to: ScrollTo): number {
  if (to.index <= 0) return 0;
  return Math.min(to.max, Math.ceil(to.index * to.step + Math.max(0, to.edge - (to.step - to.height))));
}

/**
 * Opened, a dropdown's list shows its first items, or the item `index` at its top: the sim kept the position of an
 * earlier opening, in the middle of an item after a change of resolution (measured 2026-10-30). The position is a whole
 * number of items, by the items' spacing on the screen, so that they stay whole (dropdownScrollPosition); `edge`, the
 * list's top padding in layout units when it is the sim's own (the presets' list), hides the previous item whole.
 * `dropdown` is the component's element (the one holding the list); nothing happens while the list is closed.
 */
export function scrollDropdownTo(dropdown: HTMLElement, index: number, edge = 0): void {
  const list = dropdown.querySelector<HTMLElement>('[name="List"]');
  const scroll = list ? list.querySelector<RealScroll>('real-scroll') : null;
  if (!list || !scroll || window.getComputedStyle(list).display === 'none') return;
  const unit = uiUnit();
  const boxes: DOMRect[] = Array.prototype.slice
    .call(list.querySelectorAll('virtual-list-wrapper'))
    .map((slot: HTMLElement) => slot.getBoundingClientRect())
    .filter((box: DOMRect) => box.height > 0)
    .sort((a: DOMRect, b: DOMRect) => a.top - b.top);
  const step = boxes.length > 1 ? boxes[1]!.top - boxes[0]!.top : DROPDOWN_ITEM * unit;
  const height = boxes.length > 0 ? boxes[0]!.height : (DROPDOWN_ITEM - DROPDOWN_SPACING) * unit;
  // The edge in whole pixels, as the engine draws it (6 pixels at 1164 lines, measured 2026-11-01).
  scroll.scrollToPosition(dropdownScrollPosition({ index, step, height, edge: Math.floor(edge * unit), max: scroll.maxScroll }));
}
