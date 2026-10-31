// The weather bar's last choice, as stored (bar.ts saves it and applies it again), without the sim (tested by
// test/weather-bar.test.ts). A stored value is not trusted: a wrong time sent to the sim would be a NaN departure time.

import { storedObject } from '../../core/storage.ts';
import { TIME_MODES, type TimeMode } from './time-of-day.ts';

/** The last choice, remembered when `remember` is on (mod/README.md, Data stored in the sim). */
export interface Memory {
  weather: number | null;
  /** Title of the weather preset, which finds it again when the indexes move (presets.ts, rememberedPreset). */
  weatherTitle?: string | null;
  time: TimeMode | null;
  /** Id of the button chosen (`AIRTRAFFICAI`…), per group. */
  airtraffic?: string | null;
  multiplayer?: string | null;
}

/** The memory of a stored value: each choice when it has its type, none otherwise. */
export function memoryFrom(stored: unknown): Memory {
  const entry = storedObject(stored) || {};
  const memory: Memory = {
    weather: typeof entry.weather === 'number' && isFinite(entry.weather) && entry.weather >= 0 ? Math.floor(entry.weather) : null,
    time: TIME_MODES.indexOf(entry.time as TimeMode) >= 0 ? (entry.time as TimeMode) : null,
  };
  if (typeof entry.weatherTitle === 'string') memory.weatherTitle = entry.weatherTitle;
  if (typeof entry.airtraffic === 'string') memory.airtraffic = entry.airtraffic;
  if (typeof entry.multiplayer === 'string') memory.multiplayer = entry.multiplayer;
  return memory;
}
