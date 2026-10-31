// Tail number per livery. The sim's "Tail number" field is global; whenever the livery (or the variant, or the
// aircraft) changes, the field gets the first valid one of:
// 1. the number the user chose for that livery (sim/liveries.ts);
// 2. the livery's own: `atc_id` of its livery.cfg, then a registration recognised in its name;
// 3. the default number: the first one the mod read in the field, kept in the sim's storage.
// A change made by the user (the mod's setup panel or the sim's Identification tab) is kept for the current livery.

import { answerWithin } from '../core/async.ts';
import { log, logError } from '../core/log.ts';
import type { Scope } from '../core/scope.ts';
import { loadData, saveData } from '../core/storage.ts';
import type { Settings } from '../generated/catalog.ts';
import {
  liveryDirectory,
  liveryKey,
  loadLiveryTails,
  readLiveryCfg,
  saveLiveryTail,
  TAIL_NUMBER,
  tailLength,
  tailNumberField,
  type Identification,
} from '../sim/liveries.ts';
import { atcIdFromCfg, liveryNameFromCfg, liveryTailCandidates, pickRegistration } from '../sim/registration.ts';
import { translate } from '../sim/localization.ts';
import { ANSWER_TIMEOUT_MS, store, watch } from '../sim/store.ts';

/** Storage key of the default number, read once then kept: otherwise the field keeps the last number typed. */
const BASE_TAIL_KEY = 'BASE_TAIL';
/** A value we wrote that comes back within this delay is ours, not the user's. */
const OWN_WRITE_MS = 5000;
/** While the livery changes, the field may move without the user. */
const LIVERY_CHANGE_MS = 2500;

interface AircraftDetails {
  displayName: string;
  thumbnailPath: string;
}

export function tailNumber(_settings: Settings['tailNumber'], scope: Scope): void {
  const aircraft = store.Game.Aircraft;
  /** Folder of the current livery; the first value received (state at load time) is not applied. */
  let currentLivery: string | null = null;
  /** Last known value of the field. */
  let lastTail: string | null = null;
  /** Values we have just written, not to be taken for the user's. */
  const ownWrites: { value: string; at: number }[] = [];
  let liveryChangedAt = 0;
  let baseTail = loadData<string>(BASE_TAIL_KEY, '');

  const isOwnWrite = (value: string) => ownWrites.some((write) => write.value === value && Date.now() - write.at < OWN_WRITE_MS);

  watch<AircraftDetails>(scope, aircraft.CurrentAircraft, (details) => {
    const thumbnail = details && details.thumbnailPath;
    if (!thumbnail) return;
    const folder = liveryDirectory(thumbnail);
    if (folder === currentLivery) return;
    const first = currentLivery === null;
    currentLivery = folder;
    liveryChangedAt = Date.now();
    if (!first) applyForLivery(folder, details.displayName).catch((error: unknown) => logError('the tail number could not be applied', error));
  });

  watch<Identification>(scope, aircraft.CurrentIdentification, (identification) => {
    const field = tailNumberField(identification);
    if (!field) return;
    if (!baseTail && field.value && !isOwnWrite(field.value)) {
      baseTail = field.value;
      saveData(BASE_TAIL_KEY, baseTail);
    }
    const previous = lastTail;
    lastTail = field.value;
    if (previous === null || field.value === previous || !currentLivery) return;
    if (isOwnWrite(field.value) || Date.now() - liveryChangedAt < LIVERY_CHANGE_MS) return;
    saveLiveryTail(currentLivery, field.value);
    log(`tail number ${field.value} kept for livery ${liveryKey(currentLivery)}`);
  });
  // The field is published only after an update is requested.
  aircraft.UpdateCurrentAircraftIdentification.request().catch(() => undefined);
  log('tail number per livery');

  async function applyForLivery(folder: string, aircraftName: string): Promise<void> {
    // Each wait may let the user pick another livery: a stale apply must not write onto it.
    const stillCurrent = () => !scope.disposed && folder === currentLivery;

    await answerWithin(aircraft.UpdateCurrentAircraftIdentification.request(), ANSWER_TIMEOUT_MS, 'the update of the tail number');
    const field = tailNumberField(await answerWithin(aircraft.CurrentIdentification(), ANSWER_TIMEOUT_MS, 'the tail number'));
    if (!stillCurrent()) return;
    const maxLength = tailLength(field);

    // The number chosen for the livery first, without reading its livery.cfg.
    const chosen = loadLiveryTails()[liveryKey(folder)];
    let choice = pickRegistration(liveryTailCandidates({ chosen, atcId: null, name: null }), maxLength);
    let liveryName: string | null = null;
    if (!choice) {
      const cfg = await readLiveryCfg(folder);
      if (!stillCurrent()) return;
      liveryName = liveryNameFromCfg(cfg);
      const own = liveryTailCandidates({ chosen, atcId: atcIdFromCfg(cfg), name: liveryName ? translate(liveryName) : null });
      choice = pickRegistration(own.concat([{ source: 'default', value: baseTail }]), maxLength);
    }
    if (!choice || (field && field.value === choice.registration)) return;

    ownWrites.push({ value: choice.registration, at: Date.now() });
    if (ownWrites.length > 10) ownWrites.shift();
    await answerWithin(aircraft.SetCurrentAircraftIdentification.request(`${TAIL_NUMBER}%%${choice.registration}`), ANSWER_TIMEOUT_MS, 'the change of tail number');
    log(`tail number ${choice.registration} (${choice.source}, livery "${liveryName || liveryKey(folder)}", ${aircraftName})`);
  }
}
