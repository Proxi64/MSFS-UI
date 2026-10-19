// Setup panel in the aircraft selection (panel.ts), and the left column widened by `widenColumn` layout units.

import { log, logError } from '../../core/log.ts';
import { injectStyle } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import type { Settings } from '../../generated/catalog.ts';
import { onScreenActive, SCREENS, type Manipulator } from '../../sim/screens.ts';
import CSS from './aircraft-setup.css';
import { SetupPanel } from './panel.ts';

export function aircraftSetup(settings: Settings['aircraftSetup'], scope: Scope): void {
  injectStyle(CSS, scope);
  const hooked = onScreenActive(SCREENS.planeSelection, scope, (page, screen) => {
    if (settings.widenColumn > 0) widenLeftColumn(page, screen, settings.widenColumn);
    new SetupPanel(page, screen).mount();
  });
  if (!hooked) throw new Error('the aircraft selection screen is missing');
  log(`setup panel in the aircraft selection${settings.widenColumn > 0 ? `, left column ${settings.widenColumn} units wider` : ''}`);
}

/**
 * Widens the left column by `extra` layout units and moves the grid by as much. The sim places them with styles such
 * as `calc(var(--unscaledScreenHeight) * 470px / 1080)`: `extra` is added to those values (width of `LeftBlock`,
 * `left` of `RightBlock`), and the originals are put back on leaving. No artificial `resize` event: a virtual list of
 * the sim crashes handling one (`t.gap`); the sim's grid is refreshed when it is shown again.
 */
function widenLeftColumn(page: Manipulator, scope: Scope, extra: number): void {
  const left = page.elt.querySelector<HTMLElement>('[name="PlaneSelection_Content"] > [name="LeftBlock"]');
  const right = page.elt.querySelector<HTMLElement>('[name="PlaneSelection_Content"] > [name="RightBlock"]');
  if (!left || !right) {
    logError('aircraft selection: columns not found, width unchanged');
    return;
  }
  const shift = (element: HTMLElement, property: 'width' | 'left') => {
    const original = element.style[property];
    const shifted = original.replace(/\* (-?[\d.]+)px \/ 1080/, (_match, value: string) => `* ${parseFloat(value) + extra}px / 1080`);
    if (shifted === original) return false;
    element.style[property] = shifted;
    scope.add(() => {
      element.style[property] = original;
    });
    return true;
  };
  const widened = shift(left, 'width');
  const moved = shift(right, 'left');
  if (!widened || !moved) logError('aircraft selection: unexpected style format, width partly changed');
}
