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

/**
 * The variant and the livery last sent, until a read of the configurator shows them selected: the sim reports a change
 * 0.5 to 1.2 s after it (measured on 1.9.21, 2026-11-02), and a state read meanwhile still shows the one it is leaving as
 * selected, so that a click back on it within that time was taken for a click on the selected one and dropped.
 */
interface Asked {
  id: string;
  at: number;
}
const asked: { variant: Asked | null; livery: Asked | null } = { variant: null, livery: null };
/** An answer of the sim that never comes does not hold a choice for good. */
const ASKED_MS = 5000;

/** The selected one of `items` as the user last chose it: the one sent and not reported yet, else the state's. */
function chosenId(kind: 'variant' | 'livery', items: readonly { id: string; isSelected: boolean }[]): string {
  const sent = asked[kind];
  if (sent && Date.now() - sent.at < ASKED_MS) return sent.id;
  asked[kind] = null;
  const selected = items.filter((item) => item.isSelected)[0];
  return selected ? selected.id : '';
}

/** A read shows the sent one selected (reported), or no longer lists it (another aircraft): it is the state's again. */
function forgetReported(kind: 'variant' | 'livery', items: readonly { id: string; isSelected: boolean }[]): void {
  const sent = asked[kind];
  if (!sent) return;
  const item = items.filter((candidate) => candidate.id === sent.id)[0];
  if (!item || item.isSelected) asked[kind] = null;
}

/** The choices go to the configurator one at a time: two in flight could be saved out of order (the sim keeping the older). */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(send: () => Promise<T>): Promise<T> {
  const run = turn.then(send);
  turn = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Reads the configurator's variants, liveries and details. */
export async function readConfigurator(): Promise<ConfiguratorState> {
  const [variants, liveries, details] = await Promise.all([
    readArray<ConfiguratorItem>(configurator.Items, 'the variants'),
    readArray<ConfiguratorLivery>(configurator.Liveries, 'the liveries'),
    answerWithin(configurator.Details() as Promise<ConfiguratorDetails | null>, ANSWER_TIMEOUT_MS, 'the configurator'),
  ]);
  const items = variants.filter((item) => !!item);
  const selected = items.filter((item) => item.isSelected)[0];
  forgetReported('variant', items);
  forgetReported('livery', liveries.filter((livery) => !!livery));
  return {
    variants: items,
    liveries: liveries.filter((livery) => !!livery),
    details,
    variationTitle: items.length > 1 && selected ? selected.title : '',
  };
}

/** The models of the variants the sim answered for, by variant id: they do not change while the sim runs. */
const variantModels = new Map<string, string>();
/** The reads under way, by variant id: a reload while one waits does not ask again. */
const modelReads = new Map<string, Promise<void>>();
/** The variants (of `unansweredOf`, the current variants' ids) the sim did not answer for: not asked again for them. */
const unanswered = new Set<string>();
let unansweredOf = '';

/** The models known so far, by variant id (readVariantModels). */
export function knownVariantModels(): ReadonlyMap<string, string> {
  return variantModels;
}

/**
 * The model of each of `variants`, by id (`GetAircraftFromVariationId`, for the variants' labels: sim/aircraft-names.ts).
 * One the sim does not answer for (failure or timeout, logged) is left out, and not asked again while the variants
 * stay those of the same aircraft. A single variant has no label to choose.
 */
export async function readVariantModels(variants: readonly ConfiguratorItem[]): Promise<ReadonlyMap<string, string>> {
  if (variants.length < 2) return variantModels;
  const of = variants.map((variant) => variant.id).join('|');
  if (of !== unansweredOf) {
    unansweredOf = of;
    unanswered.clear();
  }
  const reads = variants
    .filter((variant) => !variantModels.has(variant.id) && !unanswered.has(variant.id))
    .map((variant) => {
      let read = modelReads.get(variant.id);
      if (!read) {
        read = answerOrNull(store.Game.Aircraft.GetAircraftFromVariationId.request(variant.id), ANSWER_TIMEOUT_MS, 'the model of a variant could not be read').then((answer) => {
          modelReads.delete(variant.id);
          const details = answer as { modelName?: string } | null;
          if (details) variantModels.set(variant.id, details.modelName || '');
          else if (unansweredOf === of) unanswered.add(variant.id);
        });
        modelReads.set(variant.id, read);
      }
      return read;
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
 * Selects a variant of `state`. False when ignored (already chosen, unknown, or the configurator is not on the current
 * aircraft: the caller reads the configurator again).
 */
export async function chooseVariant(state: ConfiguratorState, id: string): Promise<boolean> {
  const item = state.variants.filter((candidate) => candidate.id === id)[0];
  const selected = chosenId('variant', state.variants);
  if (!item || id === selected) return false;
  return sendChoice('variant', id, async () => {
    // The variants listed belong to the configurator's aircraft: check that it is the current aircraft, on the variant
    // last chosen (the sim may have taken a variant sent before and not reported it yet).
    const ready = await canApply(selected);
    if (!ready) return false;
    await answerWithin(configurator.SelectItem.request(id), ANSWER_TIMEOUT_MS, 'the change of variant');
    return true;
  });
}

/** A choice marked as sent, then sent in turn; the mark goes when it is ignored or fails. */
function sendChoice(kind: 'variant' | 'livery', id: string, send: () => Promise<boolean>): Promise<boolean> {
  asked[kind] = { id, at: Date.now() };
  const forget = () => {
    const sent = asked[kind];
    if (sent && sent.id === id) asked[kind] = null;
  };
  return inTurn(send).then(
    (done) => {
      if (!done) forget();
      return done;
    },
    (error: unknown) => {
      forget();
      throw error;
    },
  );
}

/** Selects a livery of `state`. False when ignored (already chosen, unavailable, unknown, or the guard failed). */
export async function chooseLivery(state: ConfiguratorState, id: string): Promise<boolean> {
  const livery = state.liveries.filter((candidate) => candidate.id === id)[0];
  if (!livery || id === chosenId('livery', state.liveries)) return false;
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
  return sendChoice('livery', id, async () => {
    const ready = await canApply(variationOf(id));
    if (!ready) return false;
    await answerWithin(configurator.SaveVariationId.request(id), ANSWER_TIMEOUT_MS, 'the change of livery');
    return true;
  });
}

/** Adds or removes a favourite livery of `state`; the change event redraws the panels that show them. */
export function setFavoriteLivery(state: ConfiguratorState, id: string, on: boolean): void {
  const livery = state.liveries.filter((candidate) => candidate.id === id)[0];
  if (!livery) return;
  const next = withFavoriteLivery(loadFavoriteLiveries(), livery, on, state, Date.now());
  if (next) saveFavoriteLiveries(next);
}
