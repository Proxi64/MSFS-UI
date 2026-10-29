// The aircraft the user hides from the gallery. An aircraft is identified by its name and publisher (the sim's list has
// one entry per modular aircraft and the variation ids change between variants), as the favourite liveries of an
// aircraft are (sim/favorites.ts). Kept in the vault under MSFS_UI_HIDDEN_AIRCRAFT.

import { loadData, saveData } from '../core/storage.ts';

/** A hidden aircraft: name and publisher. */
export interface HiddenAircraft {
  displayName: string;
  creator: string;
}

const HIDDEN_AIRCRAFT_KEY = 'HIDDEN_AIRCRAFT';

/** Event sent on `document` at each change of the hidden aircraft (the gallery redraws). */
export const HIDDEN_AIRCRAFT_CHANGED = 'msfs-ui-hidden-aircraft';

export function loadHidden(): HiddenAircraft[] {
  return loadData<HiddenAircraft[]>(HIDDEN_AIRCRAFT_KEY, []);
}

export function saveHidden(list: HiddenAircraft[]): void {
  saveData(HIDDEN_AIRCRAFT_KEY, list);
  document.dispatchEvent(new CustomEvent(HIDDEN_AIRCRAFT_CHANGED));
}

/** Whether the aircraft (any of its variants) is in the list. */
export function isHidden(list: readonly HiddenAircraft[], item: { displayName: string; creator: string }): boolean {
  return list.some((hidden) => hidden.displayName === item.displayName && hidden.creator === item.creator);
}

/** The list with the aircraft added (`on`) or removed; null when nothing changes. */
export function withHidden(list: readonly HiddenAircraft[], item: { displayName: string; creator: string }, on: boolean): HiddenAircraft[] | null {
  if (isHidden(list, item) === on) return null;
  if (on) return list.concat([{ displayName: item.displayName, creator: item.creator }]);
  return list.filter((hidden) => !(hidden.displayName === item.displayName && hidden.creator === item.creator));
}
