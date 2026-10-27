// Aircraft gallery and list in the aircraft selection (gallery.ts), in place of the sim's grid; in the side by side
// layout, the liveries of the current aircraft on the right half (liveries.ts).

import { log } from '../../core/log.ts';
import { injectStyle } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import type { Settings } from '../../generated/catalog.ts';
import { onScreenActive, SCREENS } from '../../sim/screens.ts';
import CSS from './aircraft-gallery.css';
import { Gallery } from './gallery.ts';

export function aircraftGallery(settings: Settings['aircraftGallery'], scope: Scope): void {
  injectStyle(CSS, scope);
  const layout = settings.layout;
  const hooked = onScreenActive(SCREENS.planeSelection, scope, (page, screen) => new Gallery(page, screen, layout).mount());
  if (!hooked) throw new Error('the aircraft selection screen is missing');
  log(`aircraft gallery in the aircraft selection${layout === 'sideBySide' ? ', side by side layout' : ''}`);
}
