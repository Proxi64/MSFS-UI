// Promise helpers. Coherent GT may never settle some promises (a module that fails to load, a request the sim
// ignores): every wait the mod depends on is bounded.

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