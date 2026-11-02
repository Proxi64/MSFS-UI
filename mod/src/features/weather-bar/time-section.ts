// The weather bar's times of day (bar.ts): Now, Dawn, Day, Dusk, Night as the sim's tiles, applied at the departure
// (time-of-day.ts), the one in force selected.

import { answerWithin } from '../../core/async.ts';
import { el } from '../../core/dom.ts';
import type { Scope } from '../../core/scope.ts';
import { COMPONENTS, type SimComponent } from '../../sim/components.ts';
import { ANSWER_TIMEOUT_MS, store, type TimeInfo } from '../../sim/store.ts';
import { run, type MakeComponent } from './section.ts';
import { currentTimeMode, departureSeconds, liveOffsetFor, TIME_MODES, type SentTime, type TimeMode } from './time-of-day.ts';

const TIME_LABELS: Record<TimeMode, string> = { now: 'Now', dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

const flight = store.Game.CurrentFlight;
const gameFlight = flight.GameFlight;

/**
 * After a change of departure the sim publishes the time of the new place, in its time zone, a little later (measured on
 * 1.9.21, 2026-11-02: the departure, then the time); a mode applied at once took the zone of the place left (Dawn at
 * LFPG 6:37 instead of 7:37). It waits for that time, or this long when none comes (the same zone).
 */
const DEPARTURE_TIME_MS = 2000;

/** The sim's time as the bar follows it. */
export interface TimeState {
  time: TimeInfo;
  liveBuffer: boolean;
  liveOffset: number;
  departureDms: string;
}

export interface TimeEvents {
  /** A time of day was clicked and applied. */
  chosen(mode: TimeMode): void;
}

export class TimeSection {
  private readonly scope: Scope;
  private readonly events: TimeEvents;
  private readonly buttons = new Map<TimeMode, SimComponent>();
  private time: TimeInfo | null = null;
  /** The time mode the bar applied; null when the time was changed elsewhere. */
  private mode: TimeMode | null = null;
  private lastSent: SentTime | null = null;
  private liveBuffer = false;
  private liveOffset = 0;
  private departureDms = '';
  /** The mode to apply again at a new departure, once its time comes (DEPARTURE_TIME_MS). */
  private pendingMode: TimeMode | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(scope: Scope, events: TimeEvents) {
    this.scope = scope;
    this.events = events;
    scope.add(() => clearTimeout(this.pendingTimer));
  }

  build(body: HTMLElement, component: MakeComponent): void {
    const row = el('div', 'msfs-ui-wx__row', body);
    for (const mode of TIME_MODES) {
      const host = el('div', 'msfs-ui-wx__choice msfs-ui-compact-tile', row);
      component(COMPONENTS.tileButton, host, { Title: TIME_LABELS[mode] }, (created) => {
        this.buttons.set(mode, created);
        created.onClick(this.scope, () => run('the time could not be changed', this.choose(mode)));
      });
    }
  }

  setTime(time: TimeInfo): void {
    this.time = time;
    this.applyPending();
    this.render();
  }

  setLiveBuffer(on: boolean): void {
    this.liveBuffer = on;
    this.render();
  }

  setLiveOffset(offset: number): void {
    this.liveOffset = offset;
    this.render();
  }

  /** Dawn, day… depend on the place: computed again for a new departure, with the time of the new place. */
  setDeparture(dms: string): void {
    if (dms === this.departureDms) return;
    this.departureDms = dms;
    const mode = this.pendingMode || this.mode;
    if (!mode || mode === 'now') return;
    this.pendingMode = mode;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => this.applyPending(), DEPARTURE_TIME_MS);
  }

  private applyPending(): void {
    const mode = this.pendingMode;
    if (!mode || this.scope.disposed) return;
    this.pendingMode = null;
    clearTimeout(this.pendingTimer);
    run('the time could not be changed', this.apply(mode));
  }

  /** The state read at once by the restore of the last choice (the watches may not have answered yet). */
  adopt(state: TimeState): void {
    this.time = state.time;
    this.liveBuffer = state.liveBuffer;
    this.liveOffset = state.liveOffset;
    this.departureDms = state.departureDms;
  }

  render(): void {
    if (!this.time) return;
    this.mode = currentTimeMode(this.mode, this.lastSent, this.time, this.liveBuffer, this.liveOffset, Date.now());
    this.buttons.forEach((button, mode) => button.select(mode === this.mode));
  }

  async apply(mode: TimeMode): Promise<void> {
    const time = this.time || ((await answerWithin(gameFlight.timeData(), ANSWER_TIMEOUT_MS, 'the time')) as TimeInfo);
    if (mode === 'now') {
      this.lastSent = null;
      this.mode = 'now';
      if (this.liveBuffer) await answerWithin(flight.SetLiveOffset.request('0'), ANSWER_TIMEOUT_MS, 'the change of time');
      else await answerWithin(flight.ResetToSystemTime.request('true'), ANSWER_TIMEOUT_MS, 'the change of time');
      return;
    }
    const target = departureSeconds(mode, time, this.departureDms);
    this.mode = mode;
    if (this.liveBuffer) {
      const offset = liveOffsetFor(target, time);
      this.lastSent = { kind: 'offset', value: offset, at: Date.now() };
      await answerWithin(flight.SetLiveOffset.request(String(offset)), ANSWER_TIMEOUT_MS, 'the change of time');
    } else {
      this.lastSent = { kind: 'time', value: target, at: Date.now() };
      await answerWithin(flight.SetDepartureTime.request(String(target)), ANSWER_TIMEOUT_MS, 'the change of time');
    }
  }

  private async choose(mode: TimeMode): Promise<void> {
    await this.apply(mode);
    this.events.chosen(mode);
  }
}
