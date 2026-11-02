// What *Remember my last plane* keeps, without the sim (tested by test/last-plane.test.ts). The sim does not keep the last
// aircraft across a restart (the owner's restart, 2026-11-02): the mod stores the current aircraft, its variant and its
// livery under MSFS_UI_LAST_PLANE. An aircraft is found by its variant, through the sim (`GetAircraftFromVariationId`): the sim's
// list has one entry per aircraft, under the name of its last used variant (at a start, "146-300" for a stored "146-300QT"),
// so a stored name may not be in it; a livery by its folder (`liveryKey`).

import { loadData, saveData, storedObject } from '../../core/storage.ts';
import { NO_VARIANT_GROUPS, type VariantGroups } from '../../sim/variant-groups.ts';
import { isHidden, type HiddenAircraft } from '../../sim/hidden.ts';
import { liveryDirectory, liveryKey } from '../../sim/liveries.ts';
import type { AircraftItem } from './tiles.ts';

const LAST_PLANE_KEY = 'LAST_PLANE';

export interface LastPlane {
  variationId: string;
  displayName: string;
  creator: string;
  /** Title of the variant, for the log. */
  variation: string;
  /** Folder of the livery, in the form of `liveryKey`; '' when the sim gave no thumbnail. */
  dir: string;
}

/** The current aircraft as the sim gives it (`Game.Aircraft.CurrentAircraft`, fields used). */
export interface CurrentPlane {
  variationId: string;
  displayName: string;
  creator: string;
  variation?: string;
  thumbnailPath?: string;
  isValid: boolean;
}

/**
 * The aircraft choice at this start of the sim. On `window`, once per sim session: neither a reload of the mod nor a late
 * vault restarts it, and the sim's aircraft is not taken for the user's choice meanwhile.
 */
export interface StartPlaneState {
  /** The choice was made or given up: the changes of the current aircraft are the user's from now on. */
  done: boolean;
  /** The aircraft the sim was left on when a stored one could not be restored: not recorded, until another is chosen. */
  simsChoice: LastPlane | null;
}

/** What to keep of the current aircraft; null when it is invalid or missing. */
export function lastPlaneOf(current: CurrentPlane | null | undefined): LastPlane | null {
  if (!current || !current.isValid || !current.variationId) return null;
  return {
    variationId: current.variationId,
    displayName: current.displayName,
    creator: current.creator,
    variation: current.variation || '',
    dir: current.thumbnailPath ? liveryKey(liveryDirectory(current.thumbnailPath)) : '',
  };
}

/** The last plane of a stored value; null unless each field has its type. */
export function lastPlaneFrom(stored: unknown): LastPlane | null {
  const entry = storedObject(stored);
  if (!entry || typeof entry.variationId !== 'string' || !entry.variationId) return null;
  if (typeof entry.displayName !== 'string' || typeof entry.creator !== 'string' || typeof entry.dir !== 'string') return null;
  return {
    variationId: entry.variationId,
    displayName: entry.displayName,
    creator: entry.creator,
    variation: typeof entry.variation === 'string' ? entry.variation : '',
    dir: entry.dir,
  };
}

export function loadLastPlane(): LastPlane | null {
  return lastPlaneFrom(loadData<unknown>(LAST_PLANE_KEY, null));
}

export function saveLastPlane(plane: LastPlane): void {
  saveData(LAST_PLANE_KEY, plane);
}

/** The stored variant as the sim answers for it; for a variant it does not know, a number of -1 (measured on 1.9.21). */
export interface LastPlaneVariant {
  aircraftId: number;
  isUsable?: boolean;
}

/**
 * Why the last plane stays where it is; null when it can come back. `variant`: the sim's answer for the stored variant.
 * Hidden under its own name, under the name of its entry in the list (the name the owner hid it by), or on another
 * variant of its group (`groups`).
 */
export function lastPlaneProblem(
  variant: LastPlaneVariant | null,
  items: readonly AircraftItem[],
  last: LastPlane,
  hidden: readonly HiddenAircraft[],
  groups: VariantGroups = NO_VARIANT_GROUPS,
): string | null {
  if (!variant || variant.aircraftId < 0) return 'it is no longer installed';
  const entry = items.filter((item) => !!item && item.aircraftId === variant.aircraftId)[0];
  if (isHidden(hidden, last, groups) || (entry && isHidden(hidden, entry, groups))) return 'it is hidden';
  if (variant.isUsable === false) return 'it cannot be flown';
  return null;
}

/** The livery to ask for (`loadAircraft`): by its folder alone; none without one. */
export function liveryRefOf(last: LastPlane): { dir: string; title: string; image: string } | undefined {
  return last.dir ? { dir: last.dir, title: '', image: '' } : undefined;
}

/**
 * What to store for the current aircraft; null for nothing: before the choice of this start is over (the sim imposes its
 * own aircraft at the start), when it is what is stored, or while it is the aircraft the sim was left on. Leaving that
 * aircraft ends this last exception (`state` is changed).
 */
export function planeToRecord(state: StartPlaneState | undefined, stored: LastPlane | null, current: CurrentPlane | null | undefined): LastPlane | null {
  if (!state || !state.done) return null;
  const plane = lastPlaneOf(current);
  if (!plane) return null;
  if (state.simsChoice) {
    if (samePlane(state.simsChoice, plane)) return null;
    state.simsChoice = null;
  }
  return stored && samePlane(stored, plane) ? null : plane;
}

function samePlane(a: LastPlane, b: LastPlane): boolean {
  return a.variationId === b.variationId && a.dir === b.dir;
}
