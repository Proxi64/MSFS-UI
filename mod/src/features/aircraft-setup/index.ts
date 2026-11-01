// Setup panel in the aircraft selection (panel.ts), and the left column widened by `widenColumn` layout units; in the
// side by side layout (the liveries in the gallery), the column only holds the variants: it is narrower instead. In
// Showcase it is never narrower than the width where the bottom row's three labels show whole (the owner, 2026-11-01),
// whatever the option.

import { uiUnit } from '../../core/dom.ts';
import { log, logError } from '../../core/log.ts';
import { injectStyle } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import type { Settings } from '../../generated/catalog.ts';
import { onScreenActive, SCREENS, type Manipulator } from '../../sim/screens.ts';
import { liveriesInGallery } from '../../sim/selection-layout.ts';
import CSS from './aircraft-setup.css';
import { SetupPanel } from './panel.ts';
import { columnExtra } from './showcase-layout.ts';

/** Width given to the left column in the side by side layout, in layout units from the sim's 470: 400 units. */
const SIDE_BY_SIDE_EXTRA = -70;
/** The layout is checked as often as the panel is laid out. */
const LAYOUT_CHECK_MS = 250;

export function aircraftSetup(settings: Settings['aircraftSetup'], scope: Scope): void {
  injectStyle(CSS, scope);
  const hooked = onScreenActive(SCREENS.planeSelection, scope, (page, screen) => {
    const panel = new SetupPanel(page, screen);
    const column = columnResizer(page, screen);
    if (column) {
      let applied = 0;
      // The extra the bottom row needs, worked out again only when its need changes (no swing at every pass).
      let fit = { need: 0, extra: 0 };
      const apply = () => {
        const row = panel.bottomRow();
        if (row && row.need !== fit.need) fit = { need: row.need, extra: columnExtra(row.need, row.frame, uiUnit(), column.base) };
        const extra = liveriesInGallery() ? SIDE_BY_SIDE_EXTRA : Math.max(settings.widenColumn, fit.extra);
        if (extra === applied) return;
        applied = extra;
        column.resize(extra);
      };
      // First once the gallery has mounted (right after this feature): its flag then tells Gallery and List from
      // Showcase, so the column does not take the Showcase width for one pass on entering Gallery or List.
      screen.timeout(apply, 0);
      screen.interval(apply, LAYOUT_CHECK_MS);
    }
    panel.mount();
  });
  if (!hooked) throw new Error('the aircraft selection screen is missing');
  log(`setup panel in the aircraft selection${settings.widenColumn > 0 ? `, left column ${settings.widenColumn} units wider` : ''}`);
}

/**
 * A function that widens the left column by `extra` layout units (narrows it when negative) and moves the grid by as
 * much, and the column's own width in units (`base`); null when the columns are not found. The sim places them with
 * styles such as `calc(var(--unscaledScreenHeight) * 470px / 1080)`: `extra` is added to those values (width of
 * `LeftBlock`, `left` of `RightBlock`), and the originals are put back on leaving. No artificial `resize` event: a virtual list of the sim
 * crashes handling one (`t.gap`); the sim's grid is refreshed when it is shown again.
 */
function columnResizer(page: Manipulator, scope: Scope): { resize(extra: number): void; base: number } | null {
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
  const base = /\* (-?[\d.]+)px \/ 1080/.exec(originals.width);
  return {
    base: base ? parseFloat(base[1]!) : 0,
    resize: (extra) => {
      left.style.width = shifted(originals.width, extra);
      right.style.left = shifted(originals.left, extra);
    },
  };
}
