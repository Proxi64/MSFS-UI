// The weather presets: the sim's own, titled by a translation key with an icon of the sim, and those that other
// packages add, titled by their name (measured 2026-10-30 with a package of 215: their icons are missing from the sim,
// which draws an arrow instead), and the preset remembered by the bar.

import type { WeatherPreset } from './model.ts';

/** The sim's own presets have one of its translation keys as title (`TT:` and the key); the added ones, their name. */
export function isSimPreset(preset: WeatherPreset): boolean {
  return preset.title.indexOf('TT:') === 0;
}

/**
 * The remembered preset: by its title, as the indexes move when presets are added or removed (measured 2026-10-30:
 * the sim's "Last custom" went from 10 to 225 with a package of 215 presets); by its index for a memory without a
 * title (earlier versions). Undefined when it is no longer there.
 */
export function rememberedPreset(presets: WeatherPreset[], index: number | null, title: string | null | undefined): WeatherPreset | undefined {
  if (title) return presets.find((preset) => preset.title === title);
  return index === null ? undefined : presets.find((preset) => preset.index === index);
}
