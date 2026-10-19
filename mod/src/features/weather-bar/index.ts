// Weather and time bar on Free Flight, under the sim's Flight Conditions widget:
// - weather: the sim's presets (0 = live, the last one = last custom weather);
// - time: now (real time, live), dawn, day, dusk, night (computed at the chosen departure);
// - METAR (option `metar`): real weather at the departure airport and its flight category; when Live is off, also
//   the simulated weather, to compare;
// - traffic and multiplayer (option `traffic`): the buttons of the sim's flight conditions;
// - with `remember`, the last choice made in the bar is applied again at the first display of Free Flight after the
//   sim starts.

import { log, logError } from '../../core/log.ts';
import { injectStyle } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import type { Settings } from '../../generated/catalog.ts';
import { onScreenActive, SCREENS } from '../../sim/screens.ts';
import { WeatherBar } from './bar.ts';
import CSS from './weather-bar.css';

export function weatherBar(settings: Settings['weatherBar'], scope: Scope): void {
  injectStyle(CSS, scope);
  const hooked = onScreenActive(SCREENS.freeFlight, scope, (page, screen) => {
    new WeatherBar(page, screen, settings).mount().catch((error: unknown) => {
      if (!screen.disposed) logError('the weather bar could not be shown', error);
    });
  });
  if (!hooked) throw new Error('the Free Flight screen is missing');
  log(`weather bar${settings.metar ? ', METAR' : ''}${settings.traffic ? ', traffic and multiplayer' : ''}${settings.remember ? ', last choice remembered' : ''}`);
}
