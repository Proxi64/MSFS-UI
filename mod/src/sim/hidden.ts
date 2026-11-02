// The aircraft the user hides from the gallery. An aircraft is identified by its name and publisher, and by a variant id
// kept when it was hidden: the sim's list has one entry per aircraft, whose name may follow its variant (the 146-200,
// sim/variant-groups.ts), so the entry is also found when it shows another variant of that one's group. Kept in the
// vault under MSFS_UI_HIDDEN_AIRCRAFT.

import { loadData, saveData } from '../core/storage.ts';
import { NO_VARIANT_GROUPS, sameVariantGroup, type VariantGroups } from './variant-groups.ts';

/** A hidden aircraft: name and publisher, and a variant id of it (none for one hidden by 2.1.0 or before, until it is seen). */
export interface HiddenAircraft {
  displayName: string;
  creator: string;
  variationId?: string;
}

/** An aircraft as the list or the sim gives it (fields used). */
export interface AircraftRef {
  displayName: string;
  creator: string;
  variationId?: string;
}

const HIDDEN_AIRCRAFT_KEY = 'HIDDEN_AIRCRAFT';

/** Event sent on `document` at each change of the hidden aircraft (the gallery redraws). */
export const HIDDEN_AIRCRAFT_CHANGED = 'msfs-ui-hidden-aircraft';

export function loadHidden(): HiddenAircraft[] {
  // The stored value is not trusted: only the well-formed items are kept (a wrong one would make isHidden throw).
  const stored: unknown = loadData<unknown>(HIDDEN_AIRCRAFT_KEY, []);
  if (!Array.isArray(stored)) return [];
  const list: HiddenAircraft[] = [];
  for (const item of stored as unknown[]) {
    const entry = item as Partial<HiddenAircraft> | null;
    if (!entry || typeof entry.displayName !== 'string' || typeof entry.creator !== 'string') continue;
    const hidden: HiddenAircraft = { displayName: entry.displayName, creator: entry.creator };
    if (typeof entry.variationId === 'string' && entry.variationId) hidden.variationId = entry.variationId;
    list.push(hidden);
  }
  return list;
}

export function saveHidden(list: HiddenAircraft[]): void {
  saveData(HIDDEN_AIRCRAFT_KEY, list);
  document.dispatchEvent(new CustomEvent(HIDDEN_AIRCRAFT_CHANGED));
}

/** Whether `hidden` is the aircraft `item`: same name and publisher, or the item shows a variant of its variant's group. */
function sameAircraft(hidden: HiddenAircraft, item: AircraftRef, groups: VariantGroups): boolean {
  if (hidden.displayName === item.displayName && hidden.creator === item.creator) return true;
  return sameVariantGroup(groups, hidden.variationId, item.variationId);
}

/** Whether the aircraft (any of its variants) is in the list. */
export function isHidden(list: readonly HiddenAircraft[], item: AircraftRef, groups: VariantGroups = NO_VARIANT_GROUPS): boolean {
  return list.some((hidden) => sameAircraft(hidden, item, groups));
}

/** The list with the aircraft added (`on`, with its variant id) or removed; null when nothing changes. */
export function withHidden(list: readonly HiddenAircraft[], item: AircraftRef, on: boolean, groups: VariantGroups = NO_VARIANT_GROUPS): HiddenAircraft[] | null {
  if (isHidden(list, item, groups) === on) return null;
  if (!on) return list.filter((hidden) => !sameAircraft(hidden, item, groups));
  const added: HiddenAircraft = { displayName: item.displayName, creator: item.creator };
  if (item.variationId) added.variationId = item.variationId;
  return list.concat([added]);
}

/**
 * The list with a variant id given to the aircraft hidden by 2.1.0 or before (by name only) that `items` show under that
 * name, so that they stay hidden when their name follows another variant; null when nothing changes.
 */
export function withVariationIds(list: readonly HiddenAircraft[], items: readonly AircraftRef[]): HiddenAircraft[] | null {
  let changed = false;
  const next = list.map((hidden) => {
    if (hidden.variationId) return hidden;
    const item = items.filter((candidate) => !!candidate && !!candidate.variationId && candidate.displayName === hidden.displayName && candidate.creator === hidden.creator)[0];
    if (!item) return hidden;
    changed = true;
    return { displayName: hidden.displayName, creator: hidden.creator, variationId: item.variationId };
  });
  return changed ? next : null;
}
