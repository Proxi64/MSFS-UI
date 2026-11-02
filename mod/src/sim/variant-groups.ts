// The variants of an aircraft whose name follows its variant. The sim's list has one entry per aircraft, under the name,
// the variant id and even the `aircraftId` of the variant last used: the 146-200's entry is "Just Flight 146-200" (37)
// on Air Cal, "146-200QC" (51) on its QC, "146-200QT" (65) on its QT (measured on 1.9.21, 2026-11-02), so nothing the
// list gives finds again a hidden aircraft or the aircraft of a favourite livery stored on another variant. The
// configurator lists every variant of the aircraft it is on (`Configurator.Items`): the setup panel keeps those whose
// models differ (`learnVariantGroup`), and a stored variant id belongs to an entry when the entry shows a variant of its
// group. An aircraft whose variants share its model needs none: its name finds it. Kept under MSFS_UI_AIRCRAFT_VARIANTS.

import { loadData, saveData } from '../core/storage.ts';

/** Groups of variant ids, one per aircraft whose variants have different models. */
export type VariantGroups = readonly (readonly string[])[];

export const NO_VARIANT_GROUPS: VariantGroups = [];

const VARIANT_GROUPS_KEY = 'AIRCRAFT_VARIANTS';

/** Event sent on `document` when a group is learned (the gallery redraws). */
export const VARIANT_GROUPS_CHANGED = 'msfs-ui-variant-groups';

/** The groups of a stored value: only lists of two variant ids or more. */
export function variantGroupsFrom(stored: unknown): string[][] {
  if (!Array.isArray(stored)) return [];
  const groups: string[][] = [];
  for (const group of stored as unknown[]) {
    if (!Array.isArray(group)) continue;
    const ids = (group as unknown[]).filter((id): id is string => typeof id === 'string' && !!id);
    if (ids.length > 1) groups.push(ids);
  }
  return groups;
}

export function loadVariantGroups(): string[][] {
  return variantGroupsFrom(loadData<unknown>(VARIANT_GROUPS_KEY, []));
}

/** Whether two variant ids are the same, or variants of one aircraft. */
export function sameVariantGroup(groups: VariantGroups, a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a === b || groups.some((group) => group.indexOf(a) >= 0 && group.indexOf(b) >= 0);
}

/**
 * The groups with `ids` (the variants of one aircraft) in place of any group sharing one of them (the aircraft updated,
 * with a variant more or less); null when it is already there, or when there are fewer than two.
 */
export function withVariantGroup(groups: VariantGroups, ids: readonly string[]): string[][] | null {
  const group = ids.filter((id, at) => !!id && ids.indexOf(id) === at);
  if (group.length < 2) return null;
  const same = (other: readonly string[]) => other.length === group.length && group.every((id) => other.indexOf(id) >= 0);
  if (groups.some(same)) return null;
  return groups.filter((other) => !other.some((id) => group.indexOf(id) >= 0)).map((other) => other.slice()).concat([group]);
}

/**
 * Keeps the variants of the configurator's aircraft when their models are known and differ (the names in the list then
 * follow the variant); nothing otherwise.
 */
export function learnVariantGroup(ids: readonly string[], models: ReadonlyMap<string, string>): void {
  if (ids.length < 2 || !ids.every((id) => models.has(id))) return;
  const distinct = ids.map((id) => models.get(id)).filter((model, at, all) => all.indexOf(model) === at);
  if (distinct.length < 2) return;
  const next = withVariantGroup(loadVariantGroups(), ids);
  if (!next) return;
  saveData(VARIANT_GROUPS_KEY, next);
  document.dispatchEvent(new CustomEvent(VARIANT_GROUPS_CHANGED));
}
