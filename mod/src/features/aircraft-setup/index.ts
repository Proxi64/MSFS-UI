// Setup panel in the aircraft selection (panel.ts), and the left column widened by `widenColumn` layout units; in the
// side by side layout (the liveries in the gallery), the column only holds the variants: it is narrower instead.

import { log, logError } from '../../core/log.ts';
import { injectStyle } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import type { Settings } from '../../generated/catalog.ts';
import { onScreenActive, SCREENS, type Manipulator } from '../../sim/screens.ts';
import { liveriesInGallery } from '../../sim/selection-layout.ts';
import CSS from './aircraft-setup.css';
import { SetupPanel } from './panel.ts';

/** Width given to the left column in the side by side layout, in layout units from the sim's 470: 400 units. */
const SIDE_BY_SIDE_EXTRA = -70;
/** The layout is checked as often as the panel is laid out. */
const LAYOUT_CHECK_MS = 250;

export function aircraftSetup(settings: Settings['aircraftSetup'], scope: Scope): void {
  injectStyle(CSS, scope);
  const hooked = onScreenActive(SCREENS.planeSelection, scope, (page, screen) => {
    const resize = columnResizer(page, screen);
    if (resize) {
      let applied = 0;
      const apply = () => {
        const extra = liveriesInGallery() ? SIDE_BY_SIDE_EXTRA : settings.widenColumn;
        if (extra === applied) return;
        applied = extra;
        resize(extra);
      };
      apply();
      screen.interval(apply, LAYOUT_CHECK_MS);
    }
    new SetupPanel(page, screen).mount();
  });
  if (!hooked) throw new Error('the aircraft selection screen is missing');
  log(`setup panel in the aircraft selection${settings.widenColumn > 0 ? `, left column ${settings.widenColumn} units wider` : ''}`);
}

/**
 * A function that widens the left column by `extra` layout units (narrows it when negative) and moves the grid by as
 * much; null when the columns are not found. The sim places them with styles such as
 * `calc(var(--unscaledScreenHeight) * 470px / 1080)`: `extra` is added to those values (width of `LeftBlock`, `left`
 * of `RightBlock`), and the originals are put back on leaving. No artificial `resize` event: a virtual list of the sim
 * crashes handling one (`t.gap`); the sim's grid is refreshed when it is shown again.
 */
function columnResizer(page: Manipulator, scope: Scope): ((extra: number) => void) | null {
  const left = page.elt.querySelector<HTMLElement>('[name="PlaneSelection_Content"] > [name="LeftBlock"]');
  const right = page.elt.querySelector<HTMLElement>('[name="PlaneSelection_Content"] > [name="RightBlock"]');
  if (!left || !right) {
    logError('aircraft selection: columns not found, width unchanged');
    return null;
  }
  const originals = { width: left.style.width, left: right.style.left };
  scope.add(() => {
    left.style.width = originals.width;
    right.style.left = originals.left;
  });
  const shifted = (original: string, extra: number) =>
    original.replace(/\* (-?[\d.]+)px \/ 1080/, (_match, value: string) => `* ${parseFloat(value) + extra}px / 1080`);
  if (shifted(originals.width, 1) === originals.width || shifted(originals.left, 1) === originals.left) {
    logError('aircraft selection: unexpected style format, width unchanged');
    return null;
  }
  return (extra) => {
    left.style.width = shifted(originals.width, extra);
    right.style.left = shifted(originals.left, extra);
  };
}
