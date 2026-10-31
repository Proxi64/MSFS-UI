// Promise helpers. Coherent GT may never settle some promises (a module that fails to load, a request the sim
// ignores): every wait the mod depends on is bounded.

import { logError } from './log.ts';

/** Settles like `promise`, or rejects with `message` after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** An answer of the sim: settles like `promise`, or rejects after `ms` with "`what`: no answer after `ms` ms". */
export function answerWithin<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return withTimeout(promise, ms, `${what}: no answer after ${ms} ms`);
}

/** An answer of the sim, or null when it fails or does not come within `ms`; the failure is logged as `failure`. */
export function answerOrNull<T>(promise: Promise<T>, ms: number, failure: string): Promise<T | null> {
  return withTimeout(promise, ms, `no answer after ${ms} ms`).catch((error: unknown) => {
    logError(failure, error);
    return null;
  });
}

/**
 * `action` run once, `ms` after the last of a burst of calls; `flush` runs a pending run at once (nothing when none is
 * pending), `cancel` drops it.
 */
export function debounced(action: () => void, ms: number): { call(): void; flush(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    call: () => {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        action();
      }, ms);
    },
    flush: () => {
      if (timer === undefined) return;
      cancel();
      action();
    },
    cancel,
  };
}