// Mouse wheel on Free Flight's "Flight Conditions" widget: moves the time by one step per notch (up = later);
// Shift + wheel: fast step. Follows the widget's mode:
// - live weather: moves within the last 24 hours (SetLiveOffset, like the timeline), without leaving live;
// - otherwise: changes the departure time (SetDepartureTime, like the slider).

import { log, logError } from '../core/log.ts';
import type { Scope } from '../core/scope.ts';
import type { Settings } from '../generated/catalog.ts';
import { onScreenActive, SCREENS } from '../sim/screens.ts';
import { store, watch, type DataValue } from '../sim/store.ts';

const WIDGET = '[name="Flight_Conditions_History_Widget"]';
const DAY = 86400;
/** Notches closer than this build on the value aimed at, not on the value read (which may lag behind). */
const BURST_MS = 1500;

interface TimeInfo {
  isLiveTime: boolean;
  /** Local time shown (live offset included), in seconds since midnight. */
  localTime: DataValue;
}

export function timeWheel(settings: Settings['timeWheel'], scope: Scope): void {
  const flight = store.Game.CurrentFlight;

  const hooked = onScreenActive(SCREENS.freeFlight, scope, (page, screen) => {
    let time: TimeInfo | null = null;
    let liveBuffer = false;
    let liveOffset = 0;
    let target: { live: boolean; value: number; at: number } | null = null;

    watch<TimeInfo>(screen, flight.GameFlight.timeData, (value) => (time = value));
    watch<boolean>(screen, flight.GameFlight.isUsingLiveTimeBuffer, (value) => (liveBuffer = !!value));
    watch<number>(screen, flight.GameFlight.liveTimeOffset, (value) => (liveOffset = value || 0));

    // One listener on the document (bubbling phase: `wheel` does reach it), filtered on the widget.
    screen.listen(document, 'wheel', (event) => {
      const widget = event.target instanceof Element ? event.target.closest(WIDGET) : null;
      if (!widget || !page.elt.contains(widget) || !time || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();

      const delta = (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? settings.fastStep : settings.step);
      const now = Date.now();
      const recent = target && target.live === liveBuffer && now - target.at < BURST_MS ? target.value : null;
      const failed = (error: unknown) => logError('the time could not be changed', error);

      if (liveBuffer) {
        // Offset in seconds, from -24 h to 0 (now).
        const offset = Math.max(-DAY, Math.min(0, (recent !== null ? recent : liveOffset) + delta));
        target = { live: true, value: offset, at: now };
        flight.SetLiveOffset.request(String(offset)).catch(failed);
      } else {
        const seconds = ((((recent !== null ? recent : time.localTime.value) + delta) % DAY) + DAY) % DAY;
        target = { live: false, value: seconds, at: now };
        flight.SetDepartureTime.request(String(seconds)).catch(failed);
      }
    });
  });
  if (!hooked) throw new Error('the Free Flight screen is missing');
  log(`wheel on the time: ${duration(settings.step)} per notch, ${duration(settings.fastStep)} with Shift`);
}

/** 90 → "1 min 30 s", 600 → "10 min", 7200 → "120 min". */
function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}
