// Favourites on Free Flight (panel.ts), and the record of each aircraft's use (last livery per variant, date of use
// of each favourite livery), taken at every change of aircraft whatever the screen.

import { log } from '../../core/log.ts';
import { injectStyle } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import type { Settings } from '../../generated/catalog.ts';
import { trackAircraftUse } from '../../sim/aircraft-loading.ts';
import { onScreenActive, SCREENS } from '../../sim/screens.ts';
import CSS from './freeflight-favorites.css';
import { FavoritesPanel } from './panel.ts';

export function freeflightFavorites(_settings: Settings['freeflightFavorites'], scope: Scope): void {
  injectStyle(CSS, scope);
  trackAircraftUse(scope);
  const hooked = onScreenActive(SCREENS.freeFlight, scope, (page, screen) => new FavoritesPanel(page, screen).mount());
  if (!hooked) throw new Error('the Free Flight screen is missing');
  log('favourites on Free Flight, aircraft use recorded');
}
