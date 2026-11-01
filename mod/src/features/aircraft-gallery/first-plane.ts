// *Remember my last plane* off: the first aircraft of the list (`firstAircraft`, tiles.ts) with its first livery in the
// setup panel's order, once per sim start. Measured on 1.9.21 (2026-11-02, docs/next-steps.md row 1o):
// Free Flight puts its own aircraft back each time it opens, so a choice made earlier is lost; a choice made once it is
// on the screen stays, and leaves the flight conditions alone. The variant is the one the list entry carries, the one
// its tile shows. The sim remembers the last livery of each variant, so the livery is always sent.

import { log, logError } from '../../core/log.ts';
import { runtime } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import { loadAircraft, readLiveriesOf, withAllAircraft } from '../../sim/aircraft-loading.ts';
import { chooseLivery, readConfigurator } from '../../sim/configurator.ts';
import { isFavoriteLivery, loadFavoriteLiveries } from '../../sim/favorites.ts';
import { FLIGHT_CONDITIONS_WIDGET } from '../../sim/freeflight-layout.ts';
import { loadHidden } from '../../sim/hidden.ts';
import { variationOf } from '../../sim/liveries.ts';
import { firstAvailableLivery } from '../../sim/livery-order.ts';
import { isShown, onScreenActive, SCREENS } from '../../sim/screens.ts';
import { firstAircraft, type AircraftItem } from './tiles.ts';

declare global {
  interface Window {
    /** Once per sim session, not at every reload of the mod: set when the choice starts. */
    __msfsUiFirstPlaneChosen?: boolean;
  }
}

const POLL_MS = 250;

/**
 * Selects the first aircraft the first time Free Flight is really on the screen (at start-up the sim activates it behind
 * the scenes), once the vault has answered: on the sim storage, the hidden aircraft and the favourites are not known. A
 * vault that answers late starts the features again, and this with them. Without a vault the aircraft stays the sim's.
 */
export function selectFirstPlaneAtStart(scope: Scope): void {
  let waitLogged = false;
  const hooked = onScreenActive(SCREENS.freeFlight, scope, (page, screen) => {
    screen.interval(() => {
      if (window.__msfsUiFirstPlaneChosen || !isShown(page.elt.querySelector(FLIGHT_CONDITIONS_WIDGET))) return;
      if (!runtime.storage || runtime.storage.kind !== 'vault') {
        if (!waitLogged) log('first aircraft not selected: the vault has not answered');
        waitLogged = true;
        return;
      }
      window.__msfsUiFirstPlaneChosen = true;
      selectFirstPlane(screen).catch((error: unknown) => logError('the first aircraft could not be selected: the aircraft stays as it was', error));
    }, POLL_MS);
  });
  if (!hooked) throw new Error('the Free Flight screen is missing');
}

async function selectFirstPlane(screen: Scope): Promise<void> {
  const hidden = loadHidden();
  await withAllAircraft<AircraftItem, void>(async (items) => {
    // The screen closed before anything was sent: left to its next display.
    if (screen.disposed) {
      window.__msfsUiFirstPlaneChosen = false;
      return;
    }
    const first = firstAircraft(items, hidden);
    if (!first) {
      log('first aircraft not selected: the list has no aircraft to fly');
      return;
    }
    await loadAircraft(first.variationId);
    const liveries = (await readLiveriesOf(first.variationId)).filter((livery) => !!livery && variationOf(livery.id) === first.variationId);
    const favorites = loadFavoriteLiveries();
    const livery = firstAvailableLivery(liveries, (candidate) => isFavoriteLivery(candidate, favorites));
    if (!livery) {
      log(`first aircraft selected: ${first.displayName}, without a livery to choose`);
      return;
    }
    await chooseLivery(await readConfigurator(), livery.id);
    log(`first aircraft selected: ${first.displayName}, ${livery.title}`);
  });
}
