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
