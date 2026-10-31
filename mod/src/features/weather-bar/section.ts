// What the weather bar's sections share (bar.ts builds them): their markup, the creation of their sim components, the
// actions of their buttons.

import { el } from '../../core/dom.ts';
import { logError } from '../../core/log.ts';
import { addPanelLayers } from '../../core/theme.ts';
import type { ComponentGuid, SimComponent } from '../../sim/components.ts';
import { translate } from '../../sim/localization.ts';

/** A section: header (title on the left, value on the right) and body. */
export interface Section {
  section: HTMLElement;
  value: HTMLElement;
  body: HTMLElement;
}

/** Creates a sim component in `host`; `onReady` gets it once created, then the bar draws itself again from the model. */
export type MakeComponent = (guid: ComponentGuid, host: HTMLElement, attributes: Record<string, string>, onReady: (created: SimComponent) => void) => void;

/**
 * A section titled `title` at the end of `parent`: a card of its own, with the background layers of the sim's cards,
 * so that every gap of the column shows the map (the owner's wish, 2026-10-31: those between the sections were filled).
 */
export function createSection(parent: HTMLElement, title: string): Section {
  const section = el('div', 'msfs-ui-wx__section', parent);
  addPanelLayers(section);
  const header = el('div', 'msfs-ui-header', section);
  el('span', 'msfs-ui-title', header).textContent = title;
  const value = el('div', 'msfs-ui-value msfs-ui-wx__value', header);
  const body = el('div', 'msfs-ui-wx__body', section);
  return { section, value, body };
}

/** An action of a button; its failure is logged as `what`. */
export function run(what: string, action: Promise<void>): void {
  action.catch((error: unknown) => logError(what, error));
}

/** A translated label without its final precision in brackets. */
export function shortLabel(key: string): string {
  return translate(key).replace(/\s*\([^)]*\)\s*$/, '');
}
