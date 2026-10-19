// Loading an aircraft with its livery through the sim's configurator (`Game.Aircraft.Configurator`), and the record of
// each aircraft's use. The tail number follows the livery (features/tail-number.ts).

import { log, logError } from '../core/log.ts';
import type { Scope } from '../core/scope.ts';
import { findFavoriteLivery, loadFavoriteLiveries, loadUses, saveFavoriteLiveries, saveUses, withUse, type AircraftUse } from './favorites.ts';
import { liveryDirectory, liveryKey } from './liveries.ts';
import { readArray, store, watch } from './store.ts';

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

const aircraft = store.Game.Aircraft;
const configurator = aircraft.Configurator;

/** Records the livery of the current aircraft at each of its changes, until `scope` is disposed. */
export function trackAircraftUse(scope: Scope): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch<{ variationId: string } | null>(scope, aircraft.CurrentAircraft, (current) => {
    if (!current || !current.variationId) return;
    clearTimeout(timer);
    timer = setTimeout(() => recordUse(current.variationId).catch((error: unknown) => logError('the aircraft use could not be recorded', error)), RECORD_DELAY_MS);
  });
  scope.add(() => clearTimeout(timer));
}

async function recordUse(variationId: string): Promise<void> {
  const details = (await configurator.Details()) as { variationId: string } | null;
  // The configurator follows the current aircraft; on another aircraft, the livery read would be the wrong one.
  const liveries = details && details.variationId === variationId ? await readArray<ConfiguratorLivery>(configurator.Liveries) : [];
  const selected = liveries.filter((livery) => livery && livery.isSelected)[0];
  const livery = selected ? { dir: selected.directoryPath, title: selected.title, image: selected.imageUrl } : undefined;
  saveUses(withUse(loadUses(), variationId, livery, Date.now()));

  if (selected) {
    const favorites = loadFavoriteLiveries();
    const at = findFavoriteLivery(favorites, variationId, selected.directoryPath);
    if (at >= 0) {
      favorites[at]!.usedAt = Date.now();
      saveFavoriteLiveries(favorites);
    }
  }
}

/**
 * Loads the variant, then puts back its last livery. The sim's list has one entry per modular aircraft (with its
 * current variant), and `GetAircraftFromVariationId` gives for its other variants a number that
 * `SetAircraftForConfigurator` does not load (seen on sim 1.9.18): the aircraft is then loaded and the variant chosen
 * (`SelectItem`).
 */
export async function loadAircraft(variationId: string, use?: AircraftUse): Promise<void> {
  const details = (await aircraft.GetAircraftFromVariationId.request(variationId)) as AircraftRef | null;
  if (!details) throw new Error(`variant ${variationId} not found`);
  const configuratorIs = async (test: (ref: AircraftRef) => boolean) => {
    const current = (await configurator.Details()) as AircraftRef | null;
    return !!current && test(current);
  };
  const sameAircraft = (ref: AircraftRef) => ref.displayName === details.displayName && ref.creator === details.creator;

  // 1. Directly.
  await configurator.SetAircraftForConfigurator.request(`${details.aircraftId}||${details.variationIndex}`);
  const loaded = await waitFor(() => configuratorIs((ref) => ref.variationId === variationId), 1500);
  // No `!await …`: Coherent GT does not load a module with an operator before `await`.
  if (!loaded) {
    // 2. Otherwise through the entry of the sim's list for this aircraft (unless the configurator is already on it).
    const onAircraft = await configuratorIs(sameAircraft);
    if (!onAircraft) {
      const entry = (await readArray<AircraftRef>(aircraft.AircraftList)).filter((item) => item && sameAircraft(item))[0];
      if (!entry) throw new Error(`${details.displayName} is not in the list (category tab?)`);
      await configurator.SetAircraftForConfigurator.request(`${entry.aircraftId}||${entry.variationIndex}`);
      const switched = await waitFor(() => configuratorIs(sameAircraft), 3000);
      if (!switched) throw new Error('the sim did not change the aircraft in time');
    }
    // 3. Then the variant.
    const onVariant = await configuratorIs((ref) => ref.variationId === variationId);
    if (!onVariant) {
      await configurator.SelectItem.request(variationId);
      const changed = await waitFor(() => configuratorIs((ref) => ref.variationId === variationId), 3000);
      if (!changed) throw new Error('the sim did not change the variant in time');
    }
  }

  const wanted = use && use.livery;
  if (wanted) {
    const liveries = await readArray<ConfiguratorLivery>(configurator.Liveries);
    // Folder in either form (`SimObjects\…` of the configurator, `coui://…/SimObjects/…` of the thumbnails).
    const key = liveryKey(wanted.dir);
    const match =
      liveries.filter((livery) => livery && liveryKey(livery.directoryPath) === key)[0] ||
      liveries.filter((livery) => livery && !!wanted.title && livery.title === wanted.title)[0];
    if (match && !match.isSelected) await configurator.SaveVariationId.request(match.id);
  }
  log(`aircraft loaded: ${details.displayName}${wanted ? `, ${wanted.title}` : ''}`);
}

/**
 * Sets the configurator on the current aircraft (variant and current livery), as the sim's "Configure" button does.
 * Needed when the sim has released it (leaving the selection screen): a choice sent to a released configurator makes
 * the current aircraft invalid. True when the configurator is ready.
 */
export async function syncConfiguratorToCurrent(): Promise<boolean> {
  const [current, details] = (await Promise.all([aircraft.CurrentAircraft(), configurator.Details()])) as [
    { variationId: string; isValid: boolean; thumbnailPath: string } | null,
    { variationId: string } | null,
  ];
  if (!current || !current.isValid) return false;
  if (details && details.variationId === current.variationId) return true;
  // Going through the list entry and `SelectItem` puts the first livery back: the current one is applied again.
  const livery = current.thumbnailPath ? { dir: liveryDirectory(current.thumbnailPath), title: '', image: current.thumbnailPath } : undefined;
  await loadAircraft(current.variationId, { livery, usedAt: 0 });
  const after = (await configurator.Details()) as { variationId: string } | null;
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
