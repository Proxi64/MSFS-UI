// The sim keeps its `datastorage` in memory and writes it to the disk (its Steam Cloud profile, `profile_00`) only when
// it saves its profile, which it does when one of its own options is validated: never after a write of the mod, nor
// when it quits, even through its menu (measured on 1.9.21, 2026-10-27). The mod's data (favourites, tail numbers,
// the weather bar's last choice…) was lost at every restart. So after the mod writes, it asks for a profile save the
// way the options page does: the flow event VALIDATE for one on/off option, with the option's current value, so that
// nothing changes. The option is declared in compat.json ("options"), checked live by the app's Compatibility page.

import { debounced, withTimeout } from '../core/async.ts';
import { log, logError } from '../core/log.ts';
import type { Scope } from '../core/scope.ts';
import { onStorageWrite } from '../core/storage.ts';
import { readArray, store, type StoreNode } from './store.ts';

/** The option re-validated: "Show the white dot cursor in freelook" (Flight interface), on or off. */
const SECTION = 'MENU_OPTIONS_FLIGHT_INTERFACE';
const OPTION = 'OptionsGeneralItemGUID_{666BFED5-26A0-4C7D-BF27-D717AFCAF33D}';
/** A burst of writes (bookmarks clicked one after the other) gives one save, this long after the last. */
const DELAY_MS = 2000;
const ANSWER_TIMEOUT_MS = 5000;

/** An option of a section of the General options (`Game.Options.General.Item[section]`). */
interface OptionItem {
  strID: string;
  /** Path of its details in the data model, from the root (`GAME/OPTIONS/GENERAL/ITEM/<section>/<id>`). */
  dataRoute: string;
}

/** The details of an on/off or choice option, as the options page reads them. */
interface OptionDetails {
  strId: string;
  /** Index of the current choice. */
  iDefault: number;
  daMetadatas?: string[];
  strParam?: string;
}

/** Asks for a profile save after each burst of writes of the mod, until `scope` is disposed (a pending one runs then). */
export function startProfileSaves(scope: Scope): void {
  const save = debounced(() => {
    saveProfile().catch((error: unknown) => logError('the sim profile could not be saved: the latest changes of the mod may be lost at the next start', error));
  }, DELAY_MS);
  onStorageWrite(save.call);
  scope.add(() => {
    onStorageWrite(null);
    save.flush();
  });
}

/** The option's current value sent back with VALIDATE: the sim saves its profile, and its storage with it. */
async function saveProfile(): Promise<void> {
  const general = store.Game.Options.General;
  const late = `the sim's options did not answer within ${ANSWER_TIMEOUT_MS} ms`;
  await withTimeout(general.UpdateSectionOptionsGeneral.request(SECTION), ANSWER_TIMEOUT_MS, late);
  const items = await withTimeout(readArray<OptionItem>(general.Item[SECTION]), ANSWER_TIMEOUT_MS, late);
  const item = items.filter((candidate) => !!candidate && candidate.strID === OPTION)[0];
  if (!item) throw new Error(`option ${OPTION} not found in ${SECTION}`);
  let node: StoreNode = store;
  for (const part of item.dataRoute.split('/')) node = node[part];
  const option = (await withTimeout(node(), ANSWER_TIMEOUT_MS, late)) as OptionDetails | null;
  if (!option || option.strId !== OPTION || typeof option.iDefault !== 'number') throw new Error(`option ${OPTION} unreadable`);
  const value = option.iDefault;
  engine.trigger('LAUNCH_FLOW_EVENT_TO_GLOBAL_FLOW_FROM_VIEW', 'VALIDATE', option.strId, value, option.daMetadatas ? option.daMetadatas[value] || '' : '', option.strParam || '');
  log('mod data saved to the sim profile');
}
