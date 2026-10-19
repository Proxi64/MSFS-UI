// The mod's log, in the sim's console: read by the app (Log page) and by `msfs-ui-dev console "[msfs-ui]"`.

export const LOG_TAG = '[msfs-ui]';

/** One string only: Coherent's inspector forwards only the first argument of a console call. */
export function log(message: string): void {
  console.log(`${LOG_TAG} ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const detail = error === undefined ? '' : describeError(error, true);
  console.error(`${LOG_TAG} ${message}${detail ? `: ${detail}` : ''}`);
}

/** Readable text of a thrown value; with `stack`, the stack trace follows the message. */
export function describeError(error: unknown, stack = false): string {
  if (error instanceof Error) return stack && error.stack ? `${error.message}\n${error.stack}` : error.message;
  return String(error);
}
