// The weather of a location (real METAR or simulated weather) as one short line, in the manner of a METAR:
// "350° 6 kt · 10 km · OVC 400 ft · 18 °C". A missing value is left out (the sim marks it with -1 or -2147483648, or
// with an empty text).

import type { DataValue } from '../../sim/store.ts';
import type { WeatherInfo } from './model.ts';

/** Flight categories returned by the sim (`flightRules`), from the best to the worst. */
export const FLIGHT_RULES = ['VFR', 'MVFR', 'IFR', 'LIFR'] as const;
export type FlightRules = (typeof FLIGHT_RULES)[number];

function isSet(value: DataValue | undefined): value is DataValue {
  return !!value && typeof value.value === 'number' && value.value > -1e6;
}

/** The known flight category (`VFR`…), or null. */
export function flightRules(info: WeatherInfo): FlightRules | null {
  const rules = (info.flightRules || '').toUpperCase();
  return (FLIGHT_RULES as readonly string[]).indexOf(rules) >= 0 ? (rules as FlightRules) : null;
}

export function windText(info: WeatherInfo): string | null {
  const speed = info.windSpeed;
  if (!isSet(speed) || speed.value < 0) return null;
  const knots = Math.round(speed.value);
  if (knots === 0) return 'Calm';
  const direction = info.windDirDeg;
  const from = isSet(direction) && direction.value >= 0 ? `${String(Math.round(direction.value) % 360).padStart(3, '0')}°` : 'VRB';
  return `${from} ${knots} ${speed.unit || 'kt'}`;
}

export function visibilityText(info: WeatherInfo): string | null {
  const visibility = info.visibility;
  if (!isSet(visibility) || visibility.value < 0) return null;
  const value = visibility.value >= 10 ? '10+' : visibility.value < 5 ? visibility.value.toFixed(1) : String(Math.round(visibility.value));
  return `${value} ${visibility.unit || 'km'}`;
}

/**
 * Cloud cover as a METAR code, with the cloud base when known. The scale depends on the source: from 0 to 1 for the
 * METAR (recognised by its flight category), in percent for the simulated weather; guessing it from the value would
 * mix up 1 % and 100 %. When Live is off, the sim's METAR keeps its ceiling but gives a zero cover (seen on sim
 * 1.9.18): the ceiling is shown then ("Ceiling 400 ft"). For the simulated weather the cover decides (a clear sky
 * keeps a residual cloud base).
 */
export function cloudText(info: WeatherInfo): string | null {
  const base = info.cloudAltitude;
  const baseText = isSet(base) && base.value > 0 && base.valueStr !== '' ? `${Math.round(base.value)} ${base.unit || 'ft'}` : null;
  const isMetar = flightRules(info) !== null;
  const raw = typeof info.coverage === 'number' && info.coverage >= 0 ? info.coverage : null;
  const cover = raw === null ? null : isMetar ? raw : raw / 100;
  if (cover === null || cover < 0.05) return isMetar && baseText ? `Ceiling ${baseText}` : cover === null ? null : 'Clear';
  const code = cover <= 0.25 ? 'FEW' : cover <= 0.5 ? 'SCT' : cover <= 0.875 ? 'BKN' : 'OVC';
  return baseText ? `${code} ${baseText}` : code;
}

export function temperatureText(info: WeatherInfo): string | null {
  const temperature = info.temperature;
  return isSet(temperature) && temperature.valueStr !== '' ? `${Math.round(temperature.value)} ${temperature.unit || '°C'}` : null;
}

export function weatherSummary(info: WeatherInfo): string {
  return [windText(info), visibilityText(info), cloudText(info), temperatureText(info)].filter((part) => !!part).join(' · ');
}
