// Sun times (sunrise, solar noon, sunset) for a position and a date, in UTC minutes. NOAA approximations
// (declination and equation of time by Fourier series): about a minute of accuracy, plenty to set a flight's time.

export interface SunTimes {
  /** UTC minutes since midnight (may fall outside [0, 1440[: take them modulo 1440). */
  sunrise: number;
  noon: number;
  sunset: number;
}

const RAD = Math.PI / 180;

/** Null when the sun does not rise (polar night) or does not set (polar day) that day. */
export function sunTimes(latDeg: number, lonDeg: number, year: number, month: number, day: number): SunTimes | null {
  const dayOfYear = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);

  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  const lat = latDeg * RAD;
  // 90.833°: atmospheric refraction and apparent radius of the sun's disc.
  const cosHourAngle = Math.cos(90.833 * RAD) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  if (cosHourAngle > 1 || cosHourAngle < -1) return null;
  const hourAngleDeg = Math.acos(cosHourAngle) / RAD;

  const noon = 720 - 4 * lonDeg - eqTime;
  return { sunrise: noon - 4 * hourAngleDeg, noon, sunset: noon + 4 * hourAngleDeg };
}

/**
 * Reads a "DMS" position as the sim shows it, for example `N43° 28' 6.00", W1° 31' 52.00"` or
 * `43°28'06"N 1°31'52"W`. Null when the text has another form.
 */
export function parseDms(text: string): { lat: number; lon: number } | null {
  const parts: { hemisphere: string; value: number }[] = [];
  const re = /([NSEW])?\s*(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && parts.length < 2) {
    const hemisphere = (match[1] || match[5] || '').toUpperCase();
    if (!hemisphere) continue;
    const value = parseFloat(match[2]!) + parseFloat(match[3] || '0') / 60 + parseFloat(match[4] || '0') / 3600;
    parts.push({ hemisphere, value: hemisphere === 'S' || hemisphere === 'W' ? -value : value });
  }
  const lat = parts.find((part) => part.hemisphere === 'N' || part.hemisphere === 'S');
  const lon = parts.find((part) => part.hemisphere === 'E' || part.hemisphere === 'W');
  return lat && lon ? { lat: lat.value, lon: lon.value } : null;
}
