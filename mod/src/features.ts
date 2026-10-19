// The registry of features: one entry per feature of the catalogue (features.json). The type does not compile if a
// catalogue feature is missing here or if an entry is not in the catalogue. Each feature lives in
// src/features/<feature-id>.ts (or a folder of that name) and reads every option of its catalogue entry; build.ts
// checks both.

import type { Scope } from './core/scope.ts';
import { aircraftGallery } from './features/aircraft-gallery/index.ts';
import { aircraftSetup } from './features/aircraft-setup/index.ts';
import { fastMenus } from './features/fast-menus/index.ts';
import { freeflightFavorites } from './features/freeflight-favorites/index.ts';
import { weatherBar } from './features/weather-bar/index.ts';
import { tailNumber } from './features/tail-number.ts';
import { timeWheel } from './features/time-wheel.ts';
import type { FeatureId, Settings } from './generated/catalog.ts';

/**
 * Starts a feature with its settings. Everything it changes in the sim goes through `scope`, which is disposed if
 * the start throws or its promise rejects, and when the mod is unloaded.
 */
export type FeatureStart<Id extends FeatureId> = (settings: Settings[Id], scope: Scope) => void | Promise<void>;

/** `null`: not ported to the 1.0 mod yet (steps 2b to 2d); the mod logs it and carries on. */
export type FeatureRegistry = { readonly [Id in FeatureId]: FeatureStart<Id> | null };

export const FEATURES: FeatureRegistry = {
  fastMenus,
  weatherBar,
  timeWheel,
  tailNumber,
  aircraftSetup,
  aircraftGallery,
  freeflightFavorites,
};
