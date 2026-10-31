// The sim's data model, built the way the sim builds it: `UniversalProxy(new ReadableStore())`. Every path is a
// node: `node()` reads its value, `node.request(param)` triggers an action, `node.watch(...)` follows changes.
// Paths read in pkgCore.se.js (sim 1.9.18) are listed in compat.json ("symbols").

import { ReadableStore } from '/Global/shared/store.js';
import { UniversalProxy } from '/Global/shared/utils.js';
import { answerWithin } from '../core/async.ts';
import { logError } from '../core/log.ts';
import type { Scope } from '../core/scope.ts';

export interface StoreNode {
  (): Promise<any>;
  request(param?: string): Promise<unknown>;
  /** For an array: loads items [start, start + count[ and returns the total size. */
  requestRange(start: number, count: number): Promise<number>;
  getElement(index: number): Promise<any>;
  watch(id: string, callback: (value: any) => void): Promise<number>;
  unwatch(watcherId: number): boolean;
  [key: string]: any;
}

export const store = UniversalProxy(new ReadableStore()) as StoreNode;

/** Follows a value of the model until `scope` is disposed; the callback also receives the current value. */
export function watch<T>(scope: Scope, node: StoreNode, callback: (value: T) => void): void {
  let watcherId: number | undefined;
  let active = true;
  node
    .watch('msfs-ui', (value: T) => {
      if (active) callback(value);
    })
    .then(
      (id) => {
        if (active) watcherId = id;
        else node.unwatch(id);
      },
      (error: unknown) => logError('a watch on the data model failed', error),
    );
  scope.add(() => {
    active = false;
    if (watcherId !== undefined) node.unwatch(watcherId);
  });
}

/**
 * Longest wait for one answer of the sim. Coherent may never settle a request (core/async.ts): without a bound, what
 * waits for it would never end, silently. The slowest answers measured on 1.9.21 (2026-10-31, while opening the
 * aircraft selection and changing its tabs, 402 rounds): 699 ms for the size of the aircraft list (149 aircraft),
 * 460 ms for the configurator's variants, 205 ms for an action, 123 ms for one item of a list.
 */
export const ANSWER_TIMEOUT_MS = 5000;

/** Items the sim is asked to load at once; `requestRange` answers the array's whole size whatever the range. */
const RANGE = 1000;

/**
 * Reads every item of an array of the model, `what` for the error when the sim does not answer: each range of RANGE
 * items is asked before its items are read (a list longer than one range is read whole), and each request is bounded
 * (the ranges, then each item), not the whole array, so that a long list is not cut short.
 */
export async function readArray<T>(node: StoreNode, what: string): Promise<T[]> {
  const total = await answerWithin(node.requestRange(0, RANGE), ANSWER_TIMEOUT_MS, what);
  const items: T[] = [];
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % RANGE === 0) await answerWithin(node.requestRange(i, RANGE), ANSWER_TIMEOUT_MS, what);
    items.push(await answerWithin(node.getElement(i) as Promise<T>, ANSWER_TIMEOUT_MS, what));
  }
  return items;
}

// ----- Types of the values read (partial) -----

export interface DataValue {
  value: number;
  valueStr: string;
  unit: string;
}

/** The flight's time (`Game.CurrentFlight.GameFlight.timeData`), read by the weather bar and the time wheel. */
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
