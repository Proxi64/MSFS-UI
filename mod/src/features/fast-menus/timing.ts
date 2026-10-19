// The timing rules of fast menus, without the sim (tested by test/fast-menus.test.ts).

/** Options of a timeline animation, configuration or event: durations in ms (or s for transitions). */
export interface Timed {
  duration?: number;
  iterations?: number;
  [key: string]: unknown;
}

/** A timeline as far as its configuration goes (`UITimeline` of the sim). */
export interface ConfiguredTimeline {
  configuration: Timed;
}

/**
 * The timeline's original configuration is kept on the timeline itself, under this key shared by every version of
 * the mod: a new version (hot reload, other speed) scales from the original values, never from values an older
 * version already shortened, and no list of timelines is kept alive by the mod.
 */
export const ORIGINAL_CONFIGURATION = '__msfsUiOriginalConfiguration';

export const CONFIGURATION_KEYS = ['duration', 'initialDelay', 'startingTransition'] as const;
export const ANIMATION_KEYS = ['duration', 'animationStart', 'offset'] as const;
export const EVENT_KEYS = ['delay'] as const;
export const TRANSITION_KEYS = ['duration', 'delay'] as const;

/** A copy of `options` with its numeric `keys` multiplied by `factor`. */
export function scaled<T extends object>(options: T, keys: readonly string[], factor: number): T {
  const copy = Object.assign({}, options) as Record<string, unknown>;
  for (const key of keys) {
    const value = copy[key];
    if (typeof value === 'number') copy[key] = value * factor;
  }
  return copy as T;
}

/** Loading indicators and the like loop forever: they keep their pace. */
export function isLooping(options: Timed | undefined): boolean {
  return !!options && options.iterations === -1;
}

/**
 * Gives the timeline a configuration scaled by `factor` from its original one (once per factor), and returns the
 * original. A looping timeline keeps its original configuration.
 */
export function prepareTimeline(timeline: ConfiguredTimeline, factor: number): Timed {
  const record = timeline as unknown as Record<string, unknown>;
  let original = record[ORIGINAL_CONFIGURATION] as Timed | undefined;
  if (!original) {
    original = timeline.configuration || {};
    record[ORIGINAL_CONFIGURATION] = original;
  }
  const wanted = isLooping(original) ? original : scaled(original, CONFIGURATION_KEYS, factor);
  if (!sameValues(timeline.configuration, wanted)) timeline.configuration = wanted;
  return original;
}

/** An animation added to a timeline whose original configuration is `original`. */
export function scaledAnimation(animation: Timed, original: Timed, factor: number): Timed {
  if (isLooping(original)) return animation;
  if (!isLooping(animation)) return scaled(animation, ANIMATION_KEYS, factor);
  // A looping animation that inherits its duration from the (shortened) configuration keeps the original one.
  return animation.duration === undefined && original.duration !== undefined ? Object.assign({}, animation, { duration: original.duration }) : animation;
}

function sameValues(current: Timed | undefined, wanted: Timed): boolean {
  if (!current) return false;
  return CONFIGURATION_KEYS.every((key) => current[key] === wanted[key]);
}
