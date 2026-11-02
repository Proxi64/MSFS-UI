// The mod's data in the vault module (wasm/): the whole key/value copy travels over the sim's CommBus as one JSON text,
// the module writes it to its own `work` folder, which survives a restart without any profile save. The menu has no
// `Coherent` global: `engine.on` / `engine.off` / `engine.trigger` / `engine.call` (see .claude/skills/msfs-wasm).
// The messages are in core/vault-protocol.ts. If the module does not answer in time, the mod starts on `datastorage`
// and moves to the vault when it answers (main.ts).

import { debounced } from '../core/async.ts';
import { describeError, log, logError } from '../core/log.ts';
import type { Scope } from '../core/scope.ts';
import { STORAGE_PREFIX, type StorageBackend } from '../core/storage.ts';
import { VAULT_EVENTS, VAULT_MAX_BYTES, decodeLoaded, decodeSaved, decodeState, encodeSave, toAscii } from '../core/vault-protocol.ts';

const LISTENER = 'JS_LISTENER_COMM_BUS';
const DEFAULT_TIMEOUT_MS = 3000;
/** A burst of writes gives one snapshot, this long after the last. */
const SAVE_DELAY_MS = 300;
/** The module answers every SAVE; none within this time is logged. */
const CONFIRM_TIMEOUT_MS = 5000;
/** The first LOAD may reach the bus before the module listens: ask again until it answers. */
const LOAD_RETRY_MS = 500;
/**
 * After the time-out, while a late answer is awaited: the module reads its files again only when asked (a start-up read
 * lost, or a file it failed to open), so it is still asked, less often, until it answers or the scope ends.
 */
const LATE_LOAD_RETRY_MS = 2000;

export interface Vault {
  /** The sequence number of the latest snapshot sent (or loaded). */
  readonly seq: number;
  backend(): StorageBackend;
  /** Sends the pending snapshot now. */
  flush(): void;
  /**
   * Sends the pending snapshot now; true once the module confirms that the vault's current content is on the disk
   * (at once when nothing is waiting), false when that save failed, was too big to send, or was not confirmed in time.
   */
  whenSaved(): Promise<boolean>;
  /** One line for the app: `seq 4, 120 bytes, keys: A, B` (keys without the prefix). */
  describe(): string;
}

type Handler = (...args: unknown[]) => void;

/** What `openVault` found: the vault, or null and the reason the mod keeps `datastorage`. */
export interface OpenResult {
  vault: Vault | null;
  /** Empty when the vault opened. */
  reason: string;
}

export interface OpenOptions {
  /** How long the start waits for the module; 3000 ms by default. */
  timeoutMs?: number;
  /**
   * A module that answers after the time-out: its vault (null when its snapshot is unreadable) and the delay. Without
   * it, a late answer is only logged.
   */
  onLate?: (vault: Vault | null, afterMs: number) => void;
  /** The module's own state, asked once the wait ends (STATUS), on one line; a module before 2.0.1 does not answer. */
  onState?: (state: string) => void;
}

/**
 * Connects to the vault module and reads its snapshot. No vault when it does not answer within the time-out, when its
 * snapshot is unreadable or when the CommBus fails. The listener and the timers go with `scope`, which also flushes
 * the pending snapshot. Never rejects. After a time-out the listener stays until the scope ends: a module that
 * answers late is logged and its vault given to `onLate`, which moves the session to it.
 */
export function openVault(scope: Scope, options: OpenOptions = {}): Promise<OpenResult> {
  return new Promise<OpenResult>((resolve) => new VaultOpening(scope, options, resolve).start());
}

/** One opening of the vault (openVault): its request, its wait for the module, then its late answer if any. */
class VaultOpening {
  private readonly scope: Scope;
  private readonly timeoutMs: number;
  private readonly onLate: OpenOptions['onLate'];
  private readonly onState: OpenOptions['onState'];
  private readonly resolve: (result: OpenResult) => void;
  private readonly requestId = 1 + Math.floor(Math.random() * 1000000000);
  private readonly startedAt = Date.now();
  private settled = false;
  private registered = false;
  /** After the time-out, the listener stays (until the scope ends) to tell a late module from a missing one. */
  private watchingLate = false;
  private retryTimer: ReturnType<typeof setInterval> | undefined;
  private giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  private lateRetryTimer: ReturnType<typeof setInterval> | undefined;
  private vault: VaultImpl | undefined;

  constructor(scope: Scope, options: OpenOptions, resolve: (result: OpenResult) => void) {
    this.scope = scope;
    this.timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
    this.onLate = options.onLate;
    this.onState = options.onState;
    this.resolve = resolve;
  }

  start(): void {
    try {
      engine.on('EVENT_FROM_VIEW_LISTENER', this.onEvent);
      this.registered = true;
      // On an already disposed scope, this runs at once and settles the promise.
      this.scope.add(() => {
        if (this.vault) this.vault.dispose();
        this.stopAskingLate();
        this.unregister();
        this.finish(null, 'the mod was unloaded');
      });
      if (this.settled) return;
      engine.trigger('ADD_VIEW_LISTENER', LISTENER, window.location.pathname);
      // The timers first: an answer arriving inside the first call settles the promise and stops them.
      this.retryTimer = setInterval(this.sendLoad, LOAD_RETRY_MS);
      this.giveUpTimer = setTimeout(() => this.giveUp(`the vault module did not answer within ${this.timeoutMs} ms`), this.timeoutMs);
      this.sendLoad();
    } catch (error) {
      this.finish(null, `the CommBus is not available: ${describeError(error)}`);
    }
  }

  private readonly sendLoad = (): void => sendToModule(VAULT_EVENTS.load, String(this.requestId));

  private readonly onEvent: Handler = (listener, eventName, payload) => {
    // Other add-ons' events arrive many times per second: dropped first.
    if (String(listener).toUpperCase() !== LISTENER) return;
    if (typeof eventName !== 'string' || eventName.indexOf('MSFS_UI_VAULT_') !== 0) return;
    const text = typeof payload === 'string' ? payload : '';
    if (eventName === VAULT_EVENTS.loaded) {
      this.onLoaded(text);
    } else if (eventName === VAULT_EVENTS.saved) {
      const saved = decodeSaved(text);
      if (saved && this.vault) this.vault.saved(saved.seq, saved.status);
    } else if (eventName === VAULT_EVENTS.state) {
      const state = decodeState(text);
      if (state && state.requestId === this.requestId && this.onState) this.onState(state.state);
    }
  };

  /** The module's snapshot, for this request: the vault, or a late answer after the time-out. */
  private onLoaded(text: string): void {
    const loaded = decodeLoaded(text);
    if (!loaded || loaded.requestId !== this.requestId) return;
    if (this.settled) {
      if (this.watchingLate) this.onLateAnswer(loaded.text, loaded.seq);
      return;
    }
    const copy = parseSnapshot(loaded.text);
    if (!copy) {
      this.finish(null, 'the vault snapshot is unreadable');
      return;
    }
    this.vault = new VaultImpl(copy, loaded.seq);
    this.finish(this.vault, '');
  }

  /** Late: the features already read the sim storage; `onLate` moves the session to the vault. */
  private onLateAnswer(text: string, seq: number): void {
    this.watchingLate = false;
    this.stopAskingLate();
    const afterMs = Date.now() - this.startedAt;
    const late = this.onLate ? parseSnapshot(text) : null;
    if (!this.onLate || !late) {
      this.unregister();
      log(`the vault module answered after ${afterMs} ms; this session's data stays in the sim storage`);
      if (this.onLate) this.onLate(null, afterMs);
      return;
    }
    // Kept listening: its SAVED answers.
    this.vault = new VaultImpl(late, seq);
    log(`the vault module answered after ${afterMs} ms`);
    this.onLate(this.vault, afterMs);
  }

  /** The wait ended without the vault: no vault for now, the listener kept for a late answer, still asked for. */
  private giveUp(reason: string): void {
    if (this.settled) return;
    if (this.registered) this.watchingLate = true;
    this.settle(null, reason);
    if (this.watchingLate) this.lateRetryTimer = setInterval(this.sendLoad, LATE_LOAD_RETRY_MS);
  }

  private stopAskingLate(): void {
    if (this.lateRetryTimer !== undefined) clearInterval(this.lateRetryTimer);
    this.lateRetryTimer = undefined;
  }

  /** The wait ended with the vault, or for good without it. */
  private finish(result: VaultImpl | null, reason: string): void {
    if (this.settled) return;
    if (!result) this.unregister();
    this.settle(result, reason);
  }

  private settle(result: VaultImpl | null, reason: string): void {
    this.settled = true;
    this.stopWaiting();
    this.resolve({ vault: result, reason });
    if (this.registered && this.onState) sendToModule(VAULT_EVENTS.status, String(this.requestId));
  }

  private stopWaiting(): void {
    if (this.retryTimer !== undefined) clearInterval(this.retryTimer);
    if (this.giveUpTimer !== undefined) clearTimeout(this.giveUpTimer);
    this.retryTimer = undefined;
    this.giveUpTimer = undefined;
  }

  private unregister(): void {
    if (!this.registered) return;
    this.registered = false;
    try {
      engine.off('EVENT_FROM_VIEW_LISTENER', this.onEvent);
    } catch (error) {
      logError('the vault listener could not be removed', error);
    }
  }
}

/** The key/value copy of a stored snapshot; an empty text is an empty copy, null when it is unreadable. */
function parseSnapshot(text: string): Map<string, string> | null {
  const copy = new Map<string, string>();
  if (!text) return copy;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    for (const key of Object.keys(parsed)) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'string') copy.set(key, value);
    }
    return copy;
  } catch (error) {
    logError('the vault snapshot is unreadable, the sim storage is kept', error);
    return null;
  }
}

function sendToModule(event: string, text: string): void {
  try {
    engine.call('COMM_BUS_WASM_CALLBACK', event, text).catch((error: unknown) => logError(`${event} could not be sent to the vault module`, error));
  } catch (error) {
    logError(`${event} could not be sent to the vault module`, error);
  }
}

class VaultImpl implements Vault {
  private current: number;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly save = debounced(() => this.send(), SAVE_DELAY_MS);
  private ended = false;
  /** The latest save the module confirmed (the loaded one at first: it is on the disk). */
  private confirmed: number;
  /** The latest change could not be sent (a snapshot too big): the disk does not hold it. */
  private refused = false;
  /** Who waits for a save (whenSaved), by its seq. */
  private readonly waiters: { seq: number; resolve: (ok: boolean) => void }[] = [];

  private readonly copy: Map<string, string>;

  constructor(copy: Map<string, string>, seq: number) {
    this.copy = copy;
    this.current = seq;
    this.confirmed = seq;
  }

  get seq(): number {
    return this.current;
  }

  backend(): StorageBackend {
    return {
      kind: 'vault',
      get: (key) => this.copy.get(key),
      set: (key, value) => {
        this.copy.set(key, value);
        this.changed();
      },
      remove: (key) => {
        if (this.copy.delete(key)) this.changed();
      },
    };
  }

  flush(): void {
    this.save.flush();
  }

  whenSaved(): Promise<boolean> {
    this.save.flush();
    const seq = this.current;
    if (this.refused) return Promise.resolve(false);
    if (this.confirmed >= seq) return Promise.resolve(true);
    // Sent, and its answer already came back as a failure (or it timed out): its timer is gone.
    if (!this.timers.has(seq)) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => this.waiters.push({ seq, resolve }));
  }

  describe(): string {
    const keys = Array.from(this.copy.keys())
      .map((key) => (key.indexOf(STORAGE_PREFIX) === 0 ? key.slice(STORAGE_PREFIX.length) : key))
      .sort();
    return `seq ${this.current}, ${this.snapshot().length} bytes, keys: ${keys.length > 0 ? keys.join(', ') : 'none'}`;
  }

  /** The scope is disposed: sends the pending snapshot, then stops. */
  dispose(): void {
    this.ended = true;
    this.save.flush();
    this.save.cancel();
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }

  /** An answer of the module to a SAVE. */
  saved(seq: number, status: string): void {
    const timer = this.timers.get(seq);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(seq);
    if (status !== 'ok') logError(`the vault module answered ${status} to save ${seq}`);
    else if (seq > this.confirmed) this.confirmed = seq;
    this.answerWaiters(seq, status === 'ok');
  }

  /** A confirmed save answers those waiting for it or an earlier one; a failed one, those waiting for it. */
  private answerWaiters(seq: number, ok: boolean): void {
    for (let at = this.waiters.length - 1; at >= 0; at--) {
      const waiter = this.waiters[at]!;
      if (waiter.seq === seq || (ok && waiter.seq < seq)) {
        this.waiters.splice(at, 1);
        waiter.resolve(ok);
      }
    }
  }

  private snapshot(): string {
    const object: Record<string, string> = {};
    this.copy.forEach((value, key) => {
      object[key] = value;
    });
    return toAscii(JSON.stringify(object));
  }

  private changed(): void {
    if (!this.ended) this.save.call();
  }

  private send(): void {
    const text = this.snapshot();
    if (text.length > VAULT_MAX_BYTES) {
      logError(`the vault snapshot is too big (${text.length} bytes, above ${VAULT_MAX_BYTES}): not saved`);
      this.refused = true;
      return;
    }
    this.refused = false;
    const seq = this.current + 1;
    this.current = seq;
    sendToModule(VAULT_EVENTS.save, encodeSave(seq, text));
    if (this.ended) return;
    this.timers.set(
      seq,
      setTimeout(() => {
        this.timers.delete(seq);
        logError(`the vault module did not confirm save ${seq} within ${CONFIRM_TIMEOUT_MS} ms`);
        this.answerWaiters(seq, false);
      }, CONFIRM_TIMEOUT_MS),
    );
  }
}
