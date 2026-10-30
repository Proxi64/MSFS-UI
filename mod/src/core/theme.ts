// The sim's look for what the sim draws without a component (classes in theme.css: msfs-ui-panel, -header, -title,
// -value, msfs-ui-compact-tile), and the panels' background and mouse lock.

import type { Scope } from './scope.ts';
import { el } from './dom.ts';
import { injectStyle } from './runtime.ts';
import THEME_CSS from './theme.css';

/** Injects the theme's stylesheet; removed with `scope`. Called once by main.ts before the features start. */
export function injectTheme(scope: Scope): void {
  injectStyle(THEME_CSS, scope);
}

/** Input group that keeps the mouse for the panel (see `addPanelLayers`). */
export const PANEL_INPUT_GROUP = 'inputLocker';

/**
 * Smallest gap between the groups of blocks of a column on Free Flight, in layout units: the sim's own under its
 * aircraft button (measured 2026-10-30 at 1080, 1440 and 2160 lines). The weather bar widens it to fill its column
 * (the owner's choice, 2026-10-30) and gives the gap it uses, in pixels, to the page's other columns in
 * GROUP_GAP_ATTRIBUTE. In pixels rounded down, as the engine draws the other gaps.
 */
export const GROUP_GAP = 24;
export const GROUP_GAP_ATTRIBUTE = 'data-msfs-ui-group-gap';

/**
 * A panel on the sim's background, built like the sim's cards: frosted glass (`blurredBackground`, an effect of
 * Coherent), the accessibility layer and a black veil at 20 %.
 */
export function panel(className: string, parent?: Element): HTMLDivElement {
  const element = el('div', `msfs-ui-panel ${className}`, parent);
  addPanelLayers(element);
  return element;
}

/**
 * Background layers, and mouse lock: without `data-input-group`, Coherent passes clicks and the wheel through to the
 * engine, so to the map under the panel ("Custom" point, zoom…). The sim puts `inputLocker` on its own panels
 * (Flight Conditions widget, flight plan); buttons inside keep their `generic-button`. The layers sit behind the
 * content (`z-index: -1` inside the panel, which is its own stacking context).
 */
export function addPanelLayers(element: HTMLElement): void {
  element.setAttribute('data-input-group', PANEL_INPUT_GROUP);
  el('div', 'msfs-ui-panel__blur blurredBackground', element);
  el('div', 'msfs-ui-panel__accessibility', element);
  el('div', 'msfs-ui-panel__tint', element);
}
