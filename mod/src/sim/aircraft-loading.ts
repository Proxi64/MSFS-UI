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
/** Longest wait for the current aircraft to follow the configurator (under 530 ms measured on 1.9.21, 2026-11-02). */
const CURRENT_TIMEOUT_MS = 3000;
/** Longest wait for the aircraft list to hold something after it was asked again (278 ms at most measured on 1.9.21). */
const LIST_TIMEOUT_MS = 3000;
/** The sim's All tab (`Game.Aircraft.FilteredCategory`). */
const ALL_CATEGORY = 'PLANETYPE_ALL';

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

/** Follows the current aircraft until `scope` is disposed (the value at once, then each change of aircraft, variant or livery). */
export function watchCurrentAircraft<Current>(scope: Scope, callback: (current: Current | null) => void): void {
  watch<Current | null>(scope, aircraft.CurrentAircraft, callback);
}

/** The current aircraft. */
export function readCurrentAircraft<Current>(): Promise<Current | null> {
  return answerWithin(aircraft.CurrentAircraft() as Promise<Current | null>, ANSWER_TIMEOUT_MS, 'the current aircraft');
}

/** The sim's answer for a variant. */
export function readVariant<Variant>(variationId: string): Promise<Variant | null> {
  return answerWithin(aircraft.GetAircraftFromVariationId.request(variationId), ANSWER_TIMEOUT_MS, 'the variant') as Promise<Variant | null>;
}

/**
 * Loads the variant as the current aircraft, then the livery `wanted` when given. The configurator is first set on the
 * current aircraft: a request of the aircraft it already holds changes nothing (measured on 1.9.21, 2026-11-02, with the
 * ATR 72 in the configurator and the ATR 42 current). Fails, the aircraft as it was, when the sim does not follow.
 */
export async function loadAircraft(variationId: string, wanted?: LiveryRef): Promise<void> {
  // An invalid current aircraft has nothing to protect and no aircraft to sync on: a new choice is its way out.
  const current = await readCurrentAircraft<{ isValid: boolean }>();
  if (current && current.isValid) {
    const ready = await syncConfiguratorToCurrent();
    if (!ready) throw new Error('the configurator cannot be set on the current aircraft');
  } else {
    await leaveVariant(variationId);
  }
  const name = await setConfigurator(variationId, wanted);
  log(`aircraft loaded: ${name}${wanted ? `, ${wanted.title || wanted.dir}` : ''}`);
}

/**
 * Takes the configurator off the variant: a request of the aircraft it holds changes nothing, and with an invalid current
 * aircraft (the failed request left it on the target, measured on 1.9.21, 2026-11-02) the current one would stay invalid.
 */
async function leaveVariant(variationId: string): Promise<void> {
  const holds = async () => {
    const details = (await answerWithin(configurator.Details(), ANSWER_TIMEOUT_MS, 'the configurator')) as AircraftRef | null;
    return !!details && details.variationId === variationId;
  };
  const onIt = await holds();
  if (!onIt) return;
  const other = (await readArray<AircraftRef>(aircraft.AircraftList, 'the aircraft list')).filter((item) => !!item && item.variationId !== variationId)[0];
  if (!other) return;
  await answerWithin(configurator.SetAircraftForConfigurator.request(`${other.aircraftId}||${other.variationIndex}`), ANSWER_TIMEOUT_MS, 'the change of aircraft');
  await waitFor(async () => {
    const still = await holds();
    return !still;
  }, CHANGE_TIMEOUT_MS);
}

/**
 * Sets the configurator, and with it the current aircraft, on the variant, then the livery `wanted` when given; the
 * aircraft's name. The sim's list has one entry per modular aircraft (with its current variant), and
 * `GetAircraftFromVariationId` gives for its other variants a number that `SetAircraftForConfigurator` does not load
 * (seen on sim 1.9.18): the aircraft is then loaded and the variant chosen (`SelectItem`).
 */
async function setConfigurator(variationId: string, wanted?: LiveryRef): Promise<string> {
  const details = (await answerWithin(aircraft.GetAircraftFromVariationId.request(variationId), ANSWER_TIMEOUT_MS, 'the variant')) as AircraftRef | null;
  // For a variant it does not know the sim answers an aircraft without a name, number -1 (measured on 1.9.21, 2026-11-02).
  if (!details || details.aircraftId < 0) throw new Error(`variant ${variationId} not found`);
  const configuratorIs = async (test: (ref: AircraftRef) => boolean) => {
    const current = (await answerWithin(configurator.Details(), ANSWER_TIMEOUT_MS, 'the configurator')) as AircraftRef | null;
    return !!current && test(current);
  };
  // By number too: the list's entry and the configurator may carry another variant's name ("146-300" for "146-300QT").
  const sameAircraft = (ref: AircraftRef) => ref.aircraftId === details.aircraftId || (ref.displayName === details.displayName && ref.creator === details.creator);

  // 1. Directly.
  await answerWithin(configurator.SetAircraftForConfigurator.request(`${details.aircraftId}||${details.variationIndex}`), ANSWER_TIMEOUT_MS, 'the change of aircraft');
  const loaded = await waitFor(() => configuratorIs((ref) => ref.variationId === variationId), DIRECT_CHANGE_MS);
  // No `!await …`: Coherent GT does not load a module with an operator before `await`.
  if (!loaded) {
    // 2. Otherwise through the entry of the sim's list for this aircraft (unless the configurator is already on it).
    // The direct request may land on the aircraft under another variant (a variant of its own name, "146-300QT" of
    // "146-300": measured on 1.9.21, 2026-11-02): the configurator then offers the variant, only to be chosen.
    const offersVariant = async () => (await readArray<{ id: string }>(configurator.Items, 'the variants')).some((item) => !!item && item.id === variationId);
    const onAircraft = (await configuratorIs(sameAircraft)) || (await waitFor(offersVariant, DIRECT_CHANGE_MS));
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

  const followed = await waitFor(() => currentIs(variationId), CURRENT_TIMEOUT_MS);
  if (!followed) {
    const current = (await answerWithin(aircraft.CurrentAircraft(), ANSWER_TIMEOUT_MS, 'the current aircraft')) as { variationId: string } | null;
    throw new Error(`the current aircraft is still ${current ? current.variationId : '?'}, not ${variationId}`);
  }

  if (wanted) {
    const liveries = await readLiveriesOf(variationId);
    const match = matchLivery(liveries, variationId, wanted);
    if (match && match.isDisabled) log(`livery "${match.title}" of ${details.displayName} is unavailable: the sim's livery is kept`);
    else if (match && !match.isSelected) await answerWithin(configurator.SaveVariationId.request(match.id), ANSWER_TIMEOUT_MS, 'the change of livery');
    else if (!match) log(`livery "${wanted.title || wanted.dir}" not found for ${details.displayName}: the sim's livery is kept`);
  }
  return details.displayName;
}

async function currentIs(variationId: string): Promise<boolean> {
  const current = (await answerWithin(aircraft.CurrentAircraft(), ANSWER_TIMEOUT_MS, 'the current aircraft')) as { variationId: string } | null;
  return !!current && current.variationId === variationId;
}

/**
 * The configurator's liveries. Right after a change of variant it may still list the previous variant's: they are read
 * again until they are this variant's, for a bounded time (matchLivery never takes another variant's).
 */
export async function readLiveriesOf(variationId: string): Promise<ConfiguratorLivery[]> {
  let liveries: ConfiguratorLivery[] = [];
  await waitFor(async () => {
    liveries = await readArray<ConfiguratorLivery>(configurator.Liveries, 'the liveries');
    return liveries.some((livery) => !!livery && variationOf(livery.id) === variationId);
  }, LIVERIES_TIMEOUT_MS);
  return liveries;
}

/**
 * Runs `use` on the aircraft of the All tab, wherever the sim stands. The list is that of the category tab the sim
 * remembers (empty: every aircraft), which is put back afterwards, its list asked again, so that the user's tab has not
 * changed. Meant for outside the aircraft selection, whose gallery would follow the list.
 */
export async function withAllAircraft<Item, Result>(use: (items: Item[]) => Promise<Result>): Promise<Result> {
  const category = (await answerWithin(aircraft.FilteredCategory(), ANSWER_TIMEOUT_MS, 'the category tab')) as string | null;
  const otherTab = !!category && category !== ALL_CATEGORY;
  if (otherTab) await answerWithin(aircraft.SetAircraftCategoryFilter.request(ALL_CATEGORY), ANSWER_TIMEOUT_MS, 'the category tab');
  try {
    await answerWithin(aircraft.UpdateAircraftList.request(''), ANSWER_TIMEOUT_MS, 'the aircraft list');
    let items: Item[] = [];
    await waitFor(async () => {
      items = await readArray<Item>(aircraft.AircraftList, 'the aircraft list');
      return items.length > 0;
    }, LIST_TIMEOUT_MS);
    return await use(items);
  } finally {
    if (otherTab) {
      // A failure here must not take the place of the first one.
      const back = async () => {
        await answerWithin(aircraft.SetAircraftCategoryFilter.request(category as string), ANSWER_TIMEOUT_MS, 'the category tab');
        await answerWithin(aircraft.UpdateAircraftList.request(''), ANSWER_TIMEOUT_MS, 'the aircraft list');
      };
      await back().catch((error: unknown) => logError(`the category tab ${category} could not be put back`, error));
    }
  }
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
  await setConfigurator(current.variationId, livery);
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
