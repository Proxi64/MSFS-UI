import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TimeInfo, WeatherInfo, WeatherPreset } from '../src/features/weather-bar/model.ts';
import { isSimPreset, rememberedPreset } from '../src/features/weather-bar/presets.ts';
import { parseDms, sunTimes } from '../src/features/weather-bar/sun.ts';
import { currentTimeMode, departureSeconds, liveOffsetFor, SETTLE_MS } from '../src/features/weather-bar/time-of-day.ts';
import { cloudText, flightRules, visibilityText, weatherSummary, windText } from '../src/features/weather-bar/weather-text.ts';

const value = (v: number, unit = '', valueStr = String(v)) => ({ value: v, unit, valueStr });

/** Minutes, compared within a tolerance (the NOAA approximation is good to about a minute). */
function near(actual: number, expected: number, tolerance = 5): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

describe('sunTimes', () => {
  it('gives the sunrise, noon and sunset of Paris at the summer solstice (UTC minutes)', () => {
    const sun = sunTimes(48.8566, 2.3522, 2026, 6, 21)!;
    near(sun.sunrise, 3 * 60 + 47);
    near(sun.noon, 11 * 60 + 52);
    near(sun.sunset, 19 * 60 + 58);
  });

  it('gives the winter times of Paris', () => {
    const sun = sunTimes(48.8566, 2.3522, 2026, 12, 21)!;
    near(sun.sunrise, 7 * 60 + 42);
    near(sun.sunset, 15 * 60 + 56);
  });

  it('gives null in polar night and polar day', () => {
    assert.equal(sunTimes(69.65, 18.96, 2026, 12, 21), null);
    assert.equal(sunTimes(69.65, 18.96, 2026, 6, 21), null);
  });
});

describe('parseDms', () => {
  it('reads both forms the sim shows', () => {
    for (const text of [`N43° 28' 6.00", W1° 31' 52.00"`, `43°28'06"N 1°31'52"W`]) {
      const position = parseDms(text)!;
      near(position.lat, 43.4683, 0.001);
      near(position.lon, -1.5311, 0.001);
    }
  });

  it('reads the southern and eastern hemispheres', () => {
    assert.deepEqual(parseDms(`S33° 56' 0.00", E151° 10' 0.00"`), { lat: -(33 + 56 / 60), lon: 151 + 10 / 60 });
  });

  it('gives null for another form', () => {
    assert.equal(parseDms(''), null);
    assert.equal(parseDms('43.47, -1.53'), null);
    assert.equal(parseDms(`N43° 28'`), null, 'no longitude');
  });
});

const time = (local: number, utc: number, withoutOffset = local, isLiveTime = false): TimeInfo => ({
  isLiveTime,
  utcTime: value(utc),
  localTime: value(local),
  localTimeWithoutOffset: value(withoutOffset),
  day: 21,
  month: 6,
  year: 2026,
});
const PARIS = `N48° 51' 24.00", E2° 21' 8.00"`;

describe('departureSeconds', () => {
  it('uses the sun at the departure, in local time', () => {
    // Paris in summer: UTC+2.
    const summer = time(14 * 3600, 12 * 3600);
    near(departureSeconds('dawn', summer, PARIS) / 60, 5 * 60 + 47);
    near(departureSeconds('dusk', summer, PARIS) / 60, 21 * 60 + 58);
    // Solar noon + 12 h: 23:52 UTC, so 01:52 local the next morning.
    near(departureSeconds('night', summer, PARIS) / 60, 1 * 60 + 52, 6);
    assert.equal(departureSeconds('day', summer, PARIS) % 60, 0, 'whole minutes');
  });

  it('falls back to fixed local times without a position', () => {
    const any = time(50000, 43000);
    assert.equal(departureSeconds('dawn', any, ''), 6 * 3600);
    assert.equal(departureSeconds('day', any, ''), 12 * 3600);
    assert.equal(departureSeconds('dusk', any, ''), 18 * 3600);
    assert.equal(departureSeconds('night', any, ''), 0);
  });
});

describe('liveOffsetFor', () => {
  const now = time(14 * 3600, 12 * 3600);
  it('goes back to the most recent such time within 24 hours', () => {
    assert.equal(liveOffsetFor(6 * 3600, now), -8 * 3600);
    assert.equal(liveOffsetFor(15 * 3600, now), -23 * 3600, 'later today means yesterday');
    assert.equal(liveOffsetFor(14 * 3600, now), 0);
  });
});

describe('currentTimeMode', () => {
  const at = 100000;
  it('is "now" while the time is live', () => {
    assert.equal(currentTimeMode(null, null, time(0, 0, 0, true), false, 0, at), 'now');
    assert.equal(currentTimeMode('dawn', null, time(0, 0, 0, true), true, 0, at), 'now');
  });

  it('keeps the applied mode while the time is the one sent', () => {
    const sent = { kind: 'time' as const, value: 21000, at: at - 60000 };
    assert.equal(currentTimeMode('dawn', sent, time(21030, 13800), false, 0, at), 'dawn');
    const offset = { kind: 'offset' as const, value: -3600, at: at - 60000 };
    assert.equal(currentTimeMode('dusk', offset, time(0, 0), true, -3590, at), 'dusk');
  });

  it('keeps the applied mode while the sim still publishes the old, live time right after sending', () => {
    const sent = { kind: 'time' as const, value: 21600, at };
    assert.equal(currentTimeMode('dawn', sent, time(52140, 45000, 52140, true), false, 0, at + 100), 'dawn');
    assert.equal(currentTimeMode('dawn', sent, time(21600, 14400), false, 0, at + 1000), 'dawn');
  });

  it('keeps it for a moment after sending, then drops it if the time differs', () => {
    const sent = { kind: 'time' as const, value: 21000, at };
    assert.equal(currentTimeMode('dawn', sent, time(40000, 33000), false, 0, at + SETTLE_MS), 'dawn');
    assert.equal(currentTimeMode('dawn', sent, time(40000, 33000), false, 0, at + SETTLE_MS + 1), null);
  });

  it('drops "now" and any mode without a time sent once the time is not live', () => {
    assert.equal(currentTimeMode('now', null, time(40000, 33000), false, 0, at), null);
    assert.equal(currentTimeMode('dawn', null, time(40000, 33000), false, 0, at), null);
    assert.equal(currentTimeMode(null, { kind: 'time', value: 40000, at }, time(40000, 33000), false, 0, at), null);
  });
});

const weather = (fields: Partial<WeatherInfo>): WeatherInfo =>
  Object.assign(
    {
      temperature: value(18, '°C'),
      visibility: value(10, 'km'),
      windSpeed: value(6, 'kt'),
      windDirDeg: value(350),
      cloudAltitude: value(400, 'ft'),
      precipitation: value(0),
      coverage: 1,
      flightRules: 'IFR',
    },
    fields,
  );

describe('weather presets', () => {
  const preset = (index: number, title: string): WeatherPreset => ({ index, title, iconUrl: '', enabled: true, isSelected: false });
  // As measured with a package of 215 presets: the sim's first ten, the added ones, then the sim's "Last custom".
  const presets = [
    preset(0, 'TT:MENU.WEATHERTYPE_0DYNAMIC'),
    preset(1, 'TT:MENU.WEATHERTYPE_9CLEAR_SKY'),
    preset(10, 'WPPv2 - Altocumulus - Blue Skies'),
    preset(11, 'WPPv2 - Hail Core Buildups'),
    preset(225, 'TT:MENU.WEATHERTYPE_LASTCUSTOM'),
  ];

  it('tells the sim presets from the added ones by their title', () => {
    assert.deepEqual(presets.filter(isSimPreset).map((p) => p.index), [0, 1, 225]);
    assert.deepEqual(presets.filter((p) => !isSimPreset(p)).map((p) => p.index), [10, 11]);
  });

  it('finds the remembered preset by its title once the indexes have moved', () => {
    assert.equal(rememberedPreset(presets, 10, 'TT:MENU.WEATHERTYPE_LASTCUSTOM')!.index, 225);
    assert.equal(rememberedPreset(presets, 3, 'WPPv2 - Hail Core Buildups')!.index, 11);
  });

  it('gives nothing when the remembered preset is gone, rather than the one now at its index', () => {
    assert.equal(rememberedPreset(presets, 11, 'WPPv2 - Removed Preset'), undefined);
  });

  it('finds a memory of earlier versions (no title) by its index', () => {
    assert.equal(rememberedPreset(presets, 1, undefined)!.title, 'TT:MENU.WEATHERTYPE_9CLEAR_SKY');
    assert.equal(rememberedPreset(presets, 1, null)!.index, 1);
    assert.equal(rememberedPreset(presets, 7, undefined), undefined);
    assert.equal(rememberedPreset(presets, null, undefined), undefined);
  });
});

describe('weather text', () => {
  it('summarises a METAR', () => {
    assert.equal(weatherSummary(weather({})), '350° 6 kt · 10+ km · OVC 400 ft · 18 °C');
    assert.equal(flightRules(weather({ flightRules: 'lifr' })), 'LIFR');
    assert.equal(flightRules(weather({ flightRules: '' })), null);
  });

  it('writes calm, variable and missing winds', () => {
    assert.equal(windText(weather({ windSpeed: value(0, 'kt') })), 'Calm');
    assert.equal(windText(weather({ windDirDeg: value(-1) })), 'VRB 6 kt');
    assert.equal(windText(weather({ windDirDeg: value(5) })), '005° 6 kt');
    assert.equal(windText(weather({ windSpeed: value(-2147483648) })), null);
  });

  it('rounds visibility as a METAR does', () => {
    assert.equal(visibilityText(weather({ visibility: value(3.25, 'km') })), '3.3 km');
    assert.equal(visibilityText(weather({ visibility: value(7.6, 'km') })), '8 km');
  });

  it('reads the cover on the scale of its source', () => {
    // METAR (has a flight category): 0 to 1; no cover when Live is off, so the ceiling is shown.
    assert.equal(cloudText(weather({ coverage: 0.3 })), 'SCT 400 ft');
    assert.equal(cloudText(weather({ coverage: 0 })), 'Ceiling 400 ft');
    // Simulated weather: percent; a clear sky keeps a residual cloud base.
    assert.equal(cloudText(weather({ flightRules: '', coverage: 60, cloudAltitude: value(3000, 'ft') })), 'BKN 3000 ft');
    assert.equal(cloudText(weather({ flightRules: '', coverage: 1 })), 'Clear');
    assert.equal(cloudText(weather({ flightRules: '', coverage: -1 })), null);
  });
});
