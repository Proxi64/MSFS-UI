// Aircraft gallery and list in the aircraft selection (gallery.ts), in place of the sim's grid; in Gallery and List, the
// liveries of the current aircraft on the right half (liveries.ts). The options are read once per start: `rememberLayout`,
// the view and the sort come back (memory.ts); without `rememberPlane`, the first aircraft of the list at each sim start
// (first-plane.ts).

import { log } from '../../core/log.ts';
import { injectStyle } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import type { Settings } from '../../generated/catalog.ts';
import { onScreenActive, SCREENS } from '../../sim/screens.ts';
import CSS from './aircraft-gallery.css';
import { selectFirstPlaneAtStart } from './first-plane.ts';
import { Gallery } from './gallery.ts';
import { GallerySession } from './memory.ts';

export function aircraftGallery(settings: Settings['aircraftGallery'], scope: Scope): void {
  injectStyle(CSS, scope);
  const session = new GallerySession(settings.rememberLayout);
  const hooked = onScreenActive(SCREENS.planeSelection, scope, (page, screen) => new Gallery(page, screen, session).mount());
  if (!hooked) throw new Error('the aircraft selection screen is missing');
  if (!settings.rememberPlane) selectFirstPlaneAtStart(scope);
  log(`aircraft gallery in the aircraft selection${settings.rememberLayout ? ', layout remembered' : ''}${settings.rememberPlane ? ', last plane remembered' : ''}`);
}
