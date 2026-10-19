// Values of the sim's data model read by the weather bar (partial types). Paths are listed in compat.json ("symbols").

import type { DataValue } from '../../sim/store.ts';

export interface TimeInfo {
  isLiveTime: boolean;
  utcTime: DataValue;
  /** Local time shown (live offset included), in seconds since midnight. */
  localTime: DataValue;
  /** Real local time, without the live offset. */
  localTimeWithoutOffset: DataValue;
  day: number;
  month: number;
  year: number;
}

export interface WeatherPreset {
  index: number;
  title: string;
  iconUrl: string;
  enabled: boolean;
  isSelected: boolean;
}

export interface FlightLocation {
  /** Location id (0 without departure), parameter of the `Game.Weather.*` and `Game.Airport.*` requests. */
  id: number;
  worldLocation: { iCAO: string; title: string; dms: string };
}

/** Weather at a location: `GetWeatherFromMetarAtLocation` (real) or `GetWeatherAtLocation` (simulated). */
export interface WeatherInfo {
  temperature: DataValue;
  visibility: DataValue;
  windSpeed: DataValue;
  windDirDeg: DataValue;
  cloudAltitude: DataValue;
  precipitation: DataValue;
  /** Cloud cover, from 0 to 1 for the METAR; in percent for the simulated weather. */
  coverage: number;
  /** `VFR`, `MVFR`, `IFR`, `LIFR` (METAR); empty for the simulated weather. */
  flightRules: string;
}

/** A button of `Game.CurrentFlight.FlightConditions`; `id` is the parameter of `SetFlightConditionConfiguration`. */
export interface FlightConfigurationButton {
  id: string;
  selected: boolean;
  disabled: boolean;
}

export interface FlightConditions {
  multiplayer: FlightConfigurationButton[];
  airtraffic: FlightConfigurationButton[];
  weather: FlightConfigurationButton[];
}
