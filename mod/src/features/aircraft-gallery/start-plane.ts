// The aircraft at each start of the sim, once, when Free Flight is really on the screen. *Remember my last plane* on: the
// aircraft, variant and livery the mod stored (last-plane.ts), since the sim does not keep them across a restart (the
// owner's restart, 2026-11-02: another aircraft than the last selected); off: the first aircraft of the list
// (`firstAircraft`, tiles.ts) with its first livery in the setup panel's order. Measured on 1.9.21 (2026-11-02,
// docs/next-steps.md row 1o): Free Flight puts its own aircraft back each time it opens, so a choice made earlier is lost;
// a choice made once it is on the screen stays, and leaves the flight conditions alone. The sim remembers the last livery
// of each variant, so the livery is always sent.

import { log, logError } from '../../core/log.ts';
import { runtime } from '../../core/runtime.ts';
import type { Scope } from '../../core/scope.ts';
import { loadAircraft, readCurrentAircraft, readLiveriesOf, readVariant, watchCurrentAircraft, withAllAircraft } from '../../sim/aircraft-loading.ts';
import { chooseLivery, readConfigurator } from '../../sim/configurator.ts';
import { isFavoriteLivery, loadFavoriteLiveries } from '../../sim/favorites.ts';
import { FLIGHT_CONDITIONS_WIDGET } from '../../sim/freeflight-layout.ts';
import { loadHidden } from '../../sim/hidden.ts';
import { variationOf } from '../../sim/liveries.ts';
import { firstAvailableLivery } from '../../sim/livery-order.ts';
import { isShown, onScreenActive, SCREENS } from '../../sim/screens.ts';
import { loadVariantGroups } from '../../sim/variant-groups.ts';
import { lastPlaneOf, lastPlaneProblem, liveryRefOf, loadLastPlane, planeToRecord, saveLastPlane, type CurrentPlane, type LastPlaneVariant, type StartPlaneState } from './last-plane.ts';
import { firstAircraft, type AircraftItem } from './tiles.ts';

declare global {
  interface Window {
    /** Once per sim session, not at every reload of the mod: set when the choice starts. */
    __msfsUiStartPlane?: StartPlaneState;
  }
}

const POLL_MS = 250;
/** How long the stored livery may take to show on the current aircraft after its request. */
const LIVERY_BACK_MS = 3000;
/** How often the current aircraft is compared with what is stored (the sim's changes arrive by a watch). */
const RECORD_POLL_MS = 1000;

/** How a choice ended: made, left to the next display of the screen, or given up with the sim's aircraft in its place. */
type Outcome = 'made' | 'later' | 'givenUp';

/**
 * Runs `choose` the first time Free Flight is really on the screen (at start-up the sim activates it behind the scenes),
 * once the vault has answered: on the sim storage, the mod's data is not known. A vault that answers late starts the
 * features again, and this with them. Without a vault the aircraft stays the sim's.
 */
function atFirstFreeFlight(scope: Scope, what: string, choose: (screen: Scope) => Promise<Outcome>): void {
  let waitLogged = false;
  const hooked = onScreenActive(SCREENS.freeFlight, scope, (page, screen) => {
    screen.interval(() => {
      if (window.__msfsUiStartPlane || !isShown(page.elt.querySelector(FLIGHT_CONDITIONS_WIDGET))) return;
      if (!runtime.storage || runtime.storage.kind !== 'vault') {
        if (!waitLogged) log(`${what} not selected: the vault has not answered`);
        waitLogged = true;
        return;
      }
      const state: StartPlaneState = { done: false, simsChoice: null };
      window.__msfsUiStartPlane = state;
      choose(screen)
        .catch((error: unknown): Outcome => {
          logError(`the ${what} could not be selected: the aircraft stays as it was`, error);
          return 'givenUp';
        })
        .then((outcome) => finish(state, outcome))
        .catch((error: unknown) => logError(`the ${what}: the end of its selection failed`, error));
    }, POLL_MS);
  });
  if (!hooked) throw new Error('the Free Flight screen is missing');
}

async function finish(state: StartPlaneState, outcome: Outcome): Promise<void> {
  if (outcome === 'later') {
    delete window.__msfsUiStartPlane;
    return;
  }
  try {
    if (outcome === 'givenUp') state.simsChoice = lastPlaneOf(await readCurrentAircraft<CurrentPlane>());
  } finally {
    state.done = true;
  }
}

/** *Remember my last plane* off: the first aircraft of the list, once per sim start. */
export function selectFirstPlaneAtStart(scope: Scope): void {
  atFirstFreeFlight(scope, 'first aircraft', selectFirstPlane);
}

async function selectFirstPlane(screen: Scope): Promise<Outcome> {
  const hidden = loadHidden();
  return withAllAircraft<AircraftItem, Outcome>(async (items) => {
    // The screen closed before anything was sent: left to its next display.
    if (screen.disposed) return 'later';
    const first = firstAircraft(items, hidden, loadVariantGroups());
    if (!first) {
      log('first aircraft not selected: the list has no aircraft to fly');
      return 'made';
    }
    await loadAircraft(first.variationId);
    const liveries = (await readLiveriesOf(first.variationId)).filter((livery) => !!livery && variationOf(livery.id) === first.variationId);
    const favorites = loadFavoriteLiveries();
    const livery = firstAvailableLivery(liveries, (candidate) => isFavoriteLivery(candidate, favorites));
    if (!livery) {
      log(`first aircraft selected: ${first.displayName}, without a livery to choose`);
      return 'made';
    }
    await chooseLivery(await readConfigurator(), livery.id);
    log(`first aircraft selected: ${first.displayName}, ${livery.title}`);
    return 'made';
  });
}

/**
 * *Remember my last plane* on: the stored aircraft comes back once per sim start, and each change of the current aircraft
 * is stored from then on, whichever screen made it. Nothing stored: the first aircraft of the list. Not found again: the
 * sim's aircraft stays.
 */
export function rememberLastPlane(scope: Scope): void {
  atFirstFreeFlight(scope, 'last aircraft', restoreLastPlane);
  recordLastPlane(scope);
}

async function restoreLastPlane(screen: Scope): Promise<Outcome> {
  const last = loadLastPlane();
  // Nothing stored (a new user): the first aircraft of the list, as with the option off (the owner, 2026-11-02).
  if (!last) return selectFirstPlane(screen);
  const hidden = loadHidden();
  return withAllAircraft<AircraftItem, Outcome>(async (items) => {
    if (screen.disposed) return 'later';
    const problem = lastPlaneProblem(await readVariant<LastPlaneVariant>(last.variationId), items, last, hidden, loadVariantGroups());
    if (problem) {
      log(`last aircraft not restored (${last.displayName}): ${problem}; the sim's aircraft stays`);
      return 'givenUp';
    }
    await loadAircraft(last.variationId, liveryRefOf(last));
    const back = await liveryCameBack(last.dir);
    if (!back) {
      log(`last aircraft restored without its livery (${last.displayName}, ${last.dir}): the memory stays`);
      return 'givenUp';
    }
    log(`last aircraft restored: ${last.displayName}, ${last.variation}, ${last.dir}`);
    return 'made';
  });
}

/** Whether the current aircraft shows the stored livery, for a bounded time: it follows the request a little later. */
async function liveryCameBack(dir: string): Promise<boolean> {
  if (!dir) return true;
  const end = Date.now() + LIVERY_BACK_MS;
  for (;;) {
    const plane = lastPlaneOf(await readCurrentAircraft<CurrentPlane>());
    if (plane && plane.dir === dir) return true;
    if (Date.now() >= end) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * Stores the current aircraft when it differs from what is stored, the choice of this start being over. A poll rather than
 * at each change: the change is noticed even when it came while the choice was under way, or in another instance of the
 * mod that ended it.
 */
function recordLastPlane(scope: Scope): void {
  let latest: CurrentPlane | null = null;
  let handled: CurrentPlane | null = null;
  watchCurrentAircraft<CurrentPlane>(scope, (current) => {
    latest = current;
  });
  scope.interval(() => {
    const state = window.__msfsUiStartPlane;
    if (!state || !state.done || latest === handled) return;
    handled = latest;
    const plane = planeToRecord(state, loadLastPlane(), latest);
    if (!plane) return;
    saveLastPlane(plane);
    log(`last aircraft stored: ${plane.displayName}, ${plane.variation}, ${plane.dir}`);
  }, RECORD_POLL_MS);
}
