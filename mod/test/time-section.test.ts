// The weather bar's times of day at a change of departure: the sim publishes the departure, then the time of the new
// place in its time zone (measured on 1.9.21, 2026-11-02); a mode is applied again with that time, not the time of the
// place left. The sim's `/Global` modules are stubbed by module hooks, as in sim-answers.test.ts.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

const asModule = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const GLOBAL_STUBS: Record<string, string> = {
  '/Global/shared/store.js': 'export class ReadableStore {}',
  '/Global/shared/utils.js': 'export function UniversalProxy() { return globalThis.__msfsUiFakeModel; }',
  '/Global/engine_ui.bundle.js': 'export const AttachTrait = () => undefined; export const GuidToTrait = {};',
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    // The stylesheets are text for the build (esbuild); no rule is needed here.
    const stub = specifier.endsWith('.css') ? 'export default "";' : GLOBAL_STUBS[specifier];
    return stub !== undefined ? { url: asModule(stub), shortCircuit: true } : nextResolve(specifier, context);
  },
});

const value = (seconds: number) => ({ value: seconds, valueStr: '', unit: '' });
/** The sim's time at a place of offset `zoneHours`, 10:00 UTC on 2026-12-01 (winter). */
const timeAt = (zoneHours: number) => ({
  isLiveTime: false,
  utcTime: value(10 * 3600),
  localTime: value(10 * 3600 + zoneHours * 3600),
  localTimeWithoutOffset: value(10 * 3600 + zoneHours * 3600),
  day: 1,
  month: 12,
  year: 2026,
});
const sent: string[] = [];
const request = (name: string) => ({ request: (param?: string) => (sent.push(`${name} ${param}`), Promise.resolve(undefined)) });
const model = {
  Game: {
    CurrentFlight: {
      GameFlight: { timeData: () => Promise.resolve(timeAt(0)) },
      SetDepartureTime: request('time'),
      SetLiveOffset: request('offset'),
      ResetToSystemTime: request('reset'),
    },
  },
};
(globalThis as { __msfsUiFakeModel?: unknown }).__msfsUiFakeModel = model;
// Set by the build (esbuild's define).
(globalThis as { __MSFS_UI_BUILD__?: string }).__MSFS_UI_BUILD__ = 'test';

const { Scope } = await import('../src/core/scope.ts');
const { TimeSection } = await import('../src/features/weather-bar/time-section.ts');
const { departureSeconds } = await import('../src/features/weather-bar/time-of-day.ts');

const LONDON = `N51° 28' 39.00", W0° 27' 41.00"`;
const PARIS = `N49° 0' 35.00", E2° 32' 55.00"`;
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('a time of day at a change of departure', () => {
  let scope: InstanceType<typeof Scope>;
  let times: InstanceType<typeof TimeSection>;
  beforeEach(async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    sent.length = 0;
    scope = new Scope();
    times = new TimeSection(scope, { chosen: () => undefined });
    times.setTime(timeAt(0));
    times.setDeparture(LONDON);
    await times.apply('dawn');
    sent.length = 0;
  });
  afterEach(() => {
    scope.dispose();
    mock.timers.reset();
  });

  it('is applied again with the time of the new place, not the one left', async () => {
    times.setDeparture(PARIS);
    await settle();
    assert.deepEqual(sent, [], 'nothing sent with the time of London');
    times.setTime(timeAt(1));
    await settle();
    assert.deepEqual(sent, [`time ${departureSeconds('dawn', timeAt(1), PARIS)}`]);
    assert.notEqual(departureSeconds('dawn', timeAt(1), PARIS), departureSeconds('dawn', timeAt(0), PARIS), 'the zone matters');
  });

  it('is applied after a while when no new time comes (the same zone)', async () => {
    times.setDeparture(PARIS);
    mock.timers.tick(1999);
    await settle();
    assert.deepEqual(sent, []);
    mock.timers.tick(1);
    await settle();
    assert.deepEqual(sent, [`time ${departureSeconds('dawn', timeAt(0), PARIS)}`]);
  });

  it('is applied once for two departures in a row, at the last one', async () => {
    times.setDeparture(PARIS);
    times.setDeparture(LONDON);
    times.setTime(timeAt(0));
    await settle();
    mock.timers.tick(5000);
    await settle();
    assert.deepEqual(sent, [`time ${departureSeconds('dawn', timeAt(0), LONDON)}`]);
  });

  it('gives way to a click made while it waits: another mode, with the time of the new place', async () => {
    times.setDeparture(PARIS);
    await times.choose('dusk');
    assert.deepEqual(sent, [], 'it waits for the time of the new place too');
    times.setTime(timeAt(1));
    await settle();
    assert.deepEqual(sent, [`time ${departureSeconds('dusk', timeAt(1), PARIS)}`]);
    mock.timers.tick(5000);
    await settle();
    assert.equal(sent.length, 1, 'once');
  });

  it('gives way to a click made while it waits: Now, at once and for good', async () => {
    times.setDeparture(PARIS);
    await times.choose('now');
    assert.deepEqual(sent, ['reset true']);
    times.setTime(timeAt(1));
    mock.timers.tick(5000);
    await settle();
    assert.deepEqual(sent, ['reset true'], 'Dawn not sent over it');
  });

  it('is not applied when the time is Now, nor after the bar is gone', async () => {
    await times.apply('now');
    sent.length = 0;
    times.setDeparture(PARIS);
    times.setTime(timeAt(1));
    mock.timers.tick(5000);
    await settle();
    assert.deepEqual(sent, []);
    await times.apply('dusk');
    sent.length = 0;
    times.setDeparture(LONDON);
    scope.dispose();
    mock.timers.tick(5000);
    await settle();
    assert.deepEqual(sent, []);
  });
});
