// The mod's log, in the sim's console: read by the app (Log page) and by `msfs-ui-dev console "[msfs-ui]"`.

export const LOG_TAG = '[msfs-ui]';

/** One string only: Coherent's inspector forwards only the first argument of a console call. */
export function log(message: string): void {
  console.log(`${LOG_TAG} ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const detail = error === undefined ? '' : describeErrorWithStack(error);
  console.error(`${LOG_TAG} ${message}${detail ? `: ${detail}` : ''}`);
}

/** Readable text of a thrown value. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Readable text of a thrown value, its stack trace after the message (the log's errors). */
function describeErrorWithStack(error: unknown): string {
  return error instanceof Error && error.stack ? `${error.message}\n${error.stack}` : describeError(error);
}
