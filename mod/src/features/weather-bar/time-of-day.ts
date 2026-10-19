// Times of day of the weather bar, without the sim (tested by test/weather-bar.test.ts). Two modes, as the sim's
// widget:
// - live weather (`isUsingLiveTimeBuffer`): moves back within the last 24 hours (`SetLiveOffset`, seconds ≤ 0), the
//   weather staying the real one of that moment; "Now" brings the offset back to 0;
// - otherwise: sets the departure time (`SetDepartureTime`, local seconds); "Now" goes back to the real time.

import { parseDms, sunTimes } from './sun.ts';
import type { TimeInfo } from './model.ts';

export type TimeMode = 'now' | 'dawn' | 'day' | 'dusk' | 'night';
export type DayMoment = Exclude<TimeMode, 'now'>;

export const TIME_MODES: readonly TimeMode[] = ['now', 'dawn', 'day', 'dusk', 'night'];

const DAY = 86400;
/** Local times used without a departure position (or in polar night or day), in minutes. */
const FALLBACK_LOCAL_MINUTES: Record<DayMoment, number> = { dawn: 6 * 60, day: 12 * 60, dusk: 18 * 60, night: 0 };
/** Two times closer than this are the same for the bar. */
const SAME_TIME_S = 60;
/** Time and offset do not arrive together: a mismatch right after sending is not an outside change. */
export const SETTLE_MS = 2500;

/** The last time setting the bar sent, to recognise its own change when the sim publishes it. */
export interface SentTime {
  kind: 'time' | 'offset';
  value: number;
  at: number;
}

/**
 * Local time of the departure, in seconds since midnight, for a moment of the day: sunrise, solar noon, sunset, or
 * twelve hours after noon, at the departure's position (`dms`). `SetDepartureTime` takes a local time.
 */
export function departureSeconds(moment: DayMoment, time: TimeInfo, dms: string): number {
  const offsetSeconds = time.localTime.value - time.utcTime.value;
  const position = parseDms(dms);
  const sun = position && sunTimes(position.lat, position.lon, time.year, time.month, time.day);
  let localMinutes: number;
  if (sun) {
    const utcMinutes = { dawn: sun.sunrise, day: sun.noon, dusk: sun.sunset, night: sun.noon + 720 }[moment];
    localMinutes = utcMinutes + offsetSeconds / 60;
  } else {
    localMinutes = FALLBACK_LOCAL_MINUTES[moment];
  }
  const minutes = ((Math.round(localMinutes) % 1440) + 1440) % 1440;
  return minutes * 60;
}

/** Live offset (seconds ≤ 0, whole minutes) of the most recent `target` local time within the last 24 hours. */
export function liveOffsetFor(target: number, time: TimeInfo): number {
  const back = (((time.localTimeWithoutOffset.value - target) % DAY) + DAY) % DAY;
  return back === 0 ? 0 : -Math.round(back / 60) * 60;
}

/**
 * The time mode the bar shows selected once the sim publishes a time: "now" while the time is live, the mode the bar
 * applied while the time is still the one it sent, otherwise none (the time was changed elsewhere).
 */
export function currentTimeMode(
  previous: TimeMode | null,
  sent: SentTime | null,
  time: TimeInfo,
  liveBuffer: boolean,
  liveOffset: number,
  now: number,
): TimeMode | null {
  // Right after sending, the sim still publishes values of the old time (seen on sim 1.9.18): the applied mode stays.
  const settling = !!sent && previous !== null && previous !== 'now' && now - sent.at <= SETTLE_MS;
  if (settling) return previous;
  if (time.isLiveTime && (!liveBuffer || liveOffset === 0)) return 'now';
  if (previous === null || previous === 'now' || !sent) return null;
  const matches =
    sent.kind === 'offset'
      ? liveBuffer && Math.abs(liveOffset - sent.value) < SAME_TIME_S
      : [time.localTime.value, time.utcTime.value].some((value) => Math.abs(value - sent.value) < SAME_TIME_S);
  return matches ? previous : null;
}
