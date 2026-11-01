// The sim's configurator (`Game.Aircraft.Configurator`) as the aircraft selection uses it: the variants, liveries and
// aircraft it is on, and the choices sent to it. Shared by the setup panel and the gallery's livery column. The sim
// releases the configurator when leaving the screen and sets it only on a click on a tile or on "Configure"; a choice
// sent to a released configurator makes the current aircraft invalid: every choice is guarded (`canApply`).

import { answerOrNull, answerWithin } from '../core/async.ts';
import { logError } from '../core/log.ts';
import { syncConfiguratorToCurrent, type ConfiguratorLivery } from './aircraft-loading.ts';
import { loadFavoriteLiveries, saveFavoriteLiveries, withFavoriteLivery } from './favorites.ts';
import { variationOf } from './liveries.ts';
import { ANSWER_TIMEOUT_MS, readArray, store } from './store.ts';

/** A variant of the configurator (`Configurator.Items`). */
export interface ConfiguratorItem {
  id: string;
  title: string;
  isSelected: boolean;
  isDisabled: boolean;
}

export interface ConfiguratorDetails {
  variationId: string;
  displayName: string;
  creator: string;
}

/** What the configurator holds: its variants, the liveries of the selected one, and the aircraft. */
export interface ConfiguratorState {
  variants: ConfiguratorItem[];
  liveries: ConfiguratorLivery[];
  details: ConfiguratorDetails | null;
  /** Title of the selected variant when the aircraft has several, else ''. */
  variationTitle: string;
}

const configurator = store.Game.Aircraft.Configurator;

/** Reads the configurator's variants, liveries and details. */
export async function readConfigurator(): Promise<ConfiguratorState> {
  const [variants, liveries, details] = await Promise.all([
    readArray<ConfiguratorItem>(configurator.Items, 'the variants'),
    readArray<ConfiguratorLivery>(configurator.Liveries, 'the liveries'),
    answerWithin(configurator.Details() as Promise<ConfiguratorDetails | null>, ANSWER_TIMEOUT_MS, 'the configurator'),
  ]);
  const items = variants.filter((item) => !!item);
  const selected = items.filter((item) => item.isSelected)[0];
  return {
    variants: items,
    liveries: liveries.filter((livery) => !!livery),
    details,
    variationTitle: items.length > 1 && selected ? selected.title : '',
  };
}

/** The models of the variants read so far, by variant id: they do not change while the sim runs. */
const variantModels = new Map<string, string>();

/**
 * The model of each of `variants`, by id (`GetAircraftFromVariationId`, for the variants' labels: sim/aircraft-names.ts);
 * one the sim does not answer for is left out, and asked again next time. A single variant has no label to choose.
 */
export async function readVariantModels(variants: readonly ConfiguratorItem[]): Promise<ReadonlyMap<string, string>> {
  if (variants.length < 2) return variantModels;
  const reads = variants
    .filter((variant) => !variantModels.has(variant.id))
    .map(async (variant) => {
      const details = (await answerOrNull(store.Game.Aircraft.GetAircraftFromVariationId.request(variant.id), ANSWER_TIMEOUT_MS, 'the model of a variant could not be read')) as {
        modelName?: string;
      } | null;
      if (details) variantModels.set(variant.id, details.modelName || '');
    });
  await Promise.all(reads);
  return variantModels;
}

/** Sets the configurator on the current aircraft (variant and current livery) unless it already is. True when ready. */
export async function syncConfigurator(): Promise<boolean> {
  const ready = await syncConfiguratorToCurrent();
  if (!ready) logError('the configurator cannot be set on the current aircraft');
  return ready;
}

/** Before acting: the configurator is ready and the item belongs to its aircraft. */
async function canApply(itemVariationId: string): Promise<boolean> {
  const ready = await syncConfigurator();
  const details = (await answerWithin(configurator.Details(), ANSWER_TIMEOUT_MS, 'the configurator')) as { variationId: string } | null;
  if (ready && details && details.variationId === itemVariationId) return true;
  logError(`choice ignored (configurator on ${details ? details.variationId : '?'}, item of ${itemVariationId})`);
  return false;
}

/**
 * Selects a variant of `state`. False when ignored (already selected, unknown, or the configurator is not on the
 * current aircraft: the caller reads the configurator again).
 */
export async function chooseVariant(state: ConfiguratorState, id: string): Promise<boolean> {
  const item = state.variants.filter((candidate) => candidate.id === id)[0];
  if (!item || item.isSelected) return false;
  // The variants listed belong to the configurator's aircraft: check that it is the current aircraft.
  const selected = state.variants.filter((candidate) => candidate.isSelected)[0];
  const ready = await canApply(selected ? selected.id : '');
  if (!ready) return false;
  await answerWithin(configurator.SelectItem.request(id), ANSWER_TIMEOUT_MS, 'the change of variant');
  return true;
}

/** Selects a livery of `state`. False when ignored (already selected, unavailable, unknown, or the guard failed). */
export async function chooseLivery(state: ConfiguratorState, id: string): Promise<boolean> {
  const livery = state.liveries.filter((candidate) => candidate.id === id)[0];
  if (!livery || livery.isSelected) return false;
  return sendLivery(livery);
}

/**
 * Selects a livery of `state` while a livery sent before may not be reported yet: `state` may still list `id` as
 * selected (the livery the sim is leaving), so it is sent all the same. False when ignored (unavailable, unknown, or
 * the guard failed).
 */
export async function chooseLiveryWhileSending(state: ConfiguratorState, id: string): Promise<boolean> {
  const livery = state.liveries.filter((candidate) => candidate.id === id)[0];
  if (!livery) return false;
  return sendLivery(livery);
}

async function sendLivery(livery: ConfiguratorLivery): Promise<boolean> {
  const id = livery.id;
  if (livery.isDisabled) return false;
  const ready = await canApply(variationOf(id));
  if (!ready) return false;
  await answerWithin(configurator.SaveVariationId.request(id), ANSWER_TIMEOUT_MS, 'the change of livery');
  return true;
}

/** Adds or removes a favourite livery of `state`; the change event redraws the panels that show them. */
export function setFavoriteLivery(state: ConfiguratorState, id: string, on: boolean): void {
  const livery = state.liveries.filter((candidate) => candidate.id === id)[0];
  if (!livery) return;
  const next = withFavoriteLivery(loadFavoriteLiveries(), livery, on, state, Date.now());
  if (next) saveFavoriteLiveries(next);
}
