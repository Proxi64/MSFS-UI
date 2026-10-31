// Loading an aircraft with its livery through the sim's configurator (`Game.Aircraft.Configurator`), and the date of
// use of a favourite livery. The tail number follows the livery (features/tail-number.ts).

import { answerWithin } from '../core/async.ts';
import { log, logError } from '../core/log.ts';
import type { Scope } from '../core/scope.ts';
import { findFavoriteLivery, loadFavoriteLiveries, saveFavoriteLiveries, type LiveryRef } from './favorites.ts';
import { liveryDirectory, liveryFolder, matchLivery, variationOf } from './liveries.ts';
import { ANSWER_TIMEOUT_MS, readArray, store, watch } from './store.ts';

/** A livery of the configurator (`Configurator.Liveries`). */
export interface ConfiguratorLivery {
  /** `<variationId>:<n>`. */
  id: string;
  title: string;
  imageUrl: string;
  /** `SimObjects\…\liveries\…`. */
  directoryPath: string;
  isSelected: boolean;
  isDisabled?: boolean;
}

/** An aircraft as `GetAircraftFromVariationId` and `AircraftList` give it (fields used). */
interface AircraftRef {
  aircraftId: number;
  variationIndex: number;
  variationId: string;
  displayName: string;
  creator: string;
}

/** The use is recorded a little after the aircraft changes: the livery follows the change of aircraft. */
const RECORD_DELAY_MS = 1500;
/** Wait for the configurator to take the aircraft asked directly, before going through the sim's list. */
const DIRECT_CHANGE_MS = 1500;
/** Longest wait for the configurator to take the aircraft or the variant asked through its list. */
const CHANGE_TIMEOUT_MS = 3000;
/** Longest wait for the configurator's liveries to be those of the variant just loaded. */
const LIVERIES_TIMEOUT_MS = 1500;

const aircraft = store.Game.Aircraft;
const configurator = aircraft.Configurator;

/**
 * At each change of the current aircraft, until `scope` is disposed: when its livery is a favourite, the favourite's
 * date of use (Free Flight's favourites put the latest first).
 */
export function trackFavoriteUse(scope: Scope): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch<{ variationId: string } | null>(scope, aircraft.CurrentAircraft, (current) => {
    if (!current || !current.variationId) return;
    clearTimeout(timer);
    timer = setTimeout(() => recordFavoriteUse(current.variationId).catch((error: unknown) => logError('the use of a favourite could not be recorded', error)), RECORD_DELAY_MS);
  });
  scope.add(() => clearTimeout(timer));
}

async function recordFavoriteUse(variationId: string): Promise<void> {
  const details = (await answerWithin(configurator.Details(), ANSWER_TIMEOUT_MS, 'the configurator')) as { variationId: string } | null;
  // The configurator follows the current aircraft; on another aircraft, the livery read would be the wrong one.
  const liveries = details && details.variationId === variationId ? await readArray<ConfiguratorLivery>(configurator.Liveries, 'the liveries') : [];
  const selected = liveries.filter((livery) => livery && livery.isSelected)[0];
  if (!selected) return;
  const favorites = loadFavoriteLiveries();
  const at = findFavoriteLivery(favorites, variationId, liveryFolder(selected));
  if (at < 0) return;
  favorites[at]!.usedAt = Date.now();
  saveFavoriteLiveries(favorites);
}

/**
 * Loads the variant, then the livery `wanted` when given. The sim's list has one entry per modular aircraft (with its
 * current variant), and `GetAircraftFromVariationId` gives for its other variants a number that
 * `SetAircraftForConfigurator` does not load (seen on sim 1.9.18): the aircraft is then loaded and the variant chosen
 * (`SelectItem`).
 */
export async function loadAircraft(variationId: string, wanted?: LiveryRef): Promise<void> {
  const details = (await answerWithin(aircraft.GetAircraftFromVariationId.request(variationId), ANSWER_TIMEOUT_MS, 'the variant')) as AircraftRef | null;
  if (!details) throw new Error(`variant ${variationId} not found`);
  const configuratorIs = async (test: (ref: AircraftRef) => boolean) => {
    const current = (await answerWithin(configurator.Details(), ANSWER_TIMEOUT_MS, 'the configurator')) as AircraftRef | null;
    return !!current && test(current);
  };
  const sameAircraft = (ref: AircraftRef) => ref.displayName === details.displayName && ref.creator === details.creator;

  // 1. Directly.
  await answerWithin(configurator.SetAircraftForConfigurator.request(`${details.aircraftId}||${details.variationIndex}`), ANSWER_TIMEOUT_MS, 'the change of aircraft');
  const loaded = await waitFor(() => configuratorIs((ref) => ref.variationId === variationId), DIRECT_CHANGE_MS);
  // No `!await …`: Coherent GT does not load a module with an operator before `await`.
  if (!loaded) {
    // 2. Otherwise through the entry of the sim's list for this aircraft (unless the configurator is already on it).
    const onAircraft = await configuratorIs(sameAircraft);
    if (!onAircraft) {
      const entry = (await readArray<AircraftRef>(aircraft.AircraftList, 'the aircraft list')).filter((item) => item && sameAircraft(item))[0];
      if (!entry) throw new Error(`${details.displayName} is not in the list (category tab?)`);
      await answerWithin(configurator.SetAircraftForConfigurator.request(`${entry.aircraftId}||${entry.variationIndex}`), ANSWER_TIMEOUT_MS, 'the change of aircraft');
      const switched = await waitFor(() => configuratorIs(sameAircraft), CHANGE_TIMEOUT_MS);
      if (!switched) throw new Error('the sim did not change the aircraft in time');
    }
    // 3. Then the variant.
    const onVariant = await configuratorIs((ref) => ref.variationId === variationId);
    if (!onVariant) {
      await answerWithin(configurator.SelectItem.request(variationId), ANSWER_TIMEOUT_MS, 'the change of variant');
      const changed = await waitFor(() => configuratorIs((ref) => ref.variationId === variationId), CHANGE_TIMEOUT_MS);
      if (!changed) throw new Error('the sim did not change the variant in time');
    }
  }

  if (wanted) {
    // Right after a change of variant the configurator may still list the previous variant's liveries: they are read
    // again until they are this variant's (matchLivery never takes another variant's).
    let liveries: ConfiguratorLivery[] = [];
    await waitFor(async () => {
      liveries = await readArray<ConfiguratorLivery>(configurator.Liveries, 'the liveries');
      return liveries.some((livery) => !!livery && variationOf(livery.id) === variationId);
    }, LIVERIES_TIMEOUT_MS);
    const match = matchLivery(liveries, variationId, wanted);
    if (match && !match.isSelected) await answerWithin(configurator.SaveVariationId.request(match.id), ANSWER_TIMEOUT_MS, 'the change of livery');
    else if (!match) log(`livery "${wanted.title || wanted.dir}" not found for ${details.displayName}: the sim's livery is kept`);
  }
  log(`aircraft loaded: ${details.displayName}${wanted ? `, ${wanted.title}` : ''}`);
}

/**
 * Sets the configurator on the current aircraft (variant and current livery), as the sim's "Configure" button does.
 * Needed when the sim has released it (leaving the selection screen): a choice sent to a released configurator makes
 * the current aircraft invalid. True when the configurator is ready.
 */
export async function syncConfiguratorToCurrent(): Promise<boolean> {
  const [current, details] = (await answerWithin(Promise.all([aircraft.CurrentAircraft(), configurator.Details()]), ANSWER_TIMEOUT_MS, 'the current aircraft')) as [
    { variationId: string; isValid: boolean; thumbnailPath: string } | null,
    { variationId: string } | null,
  ];
  if (!current || !current.isValid) return false;
  if (details && details.variationId === current.variationId) return true;
  // Going through the list entry and `SelectItem` puts the first livery back: the current one is applied again.
  const livery = current.thumbnailPath ? { dir: liveryDirectory(current.thumbnailPath), title: '', image: current.thumbnailPath } : undefined;
  await loadAircraft(current.variationId, livery);
  const after = (await answerWithin(configurator.Details(), ANSWER_TIMEOUT_MS, 'the configurator')) as { variationId: string } | null;
  return !!after && after.variationId === current.variationId;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until `test` is true; false when the time is up. */
async function waitFor(test: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const ok = await test();
    if (ok) return true;
    await delay(100);
  }
  return false;
}
