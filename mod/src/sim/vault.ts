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

export interface Vault {
  /** The sequence number of the latest snapshot sent (or loaded). */
  readonly seq: number;
  backend(): StorageBackend;
  /** Sends the pending snapshot now. */
  flush(): void;
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
  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const onLate = options.onLate;
  const onState = options.onState;
  return new Promise<OpenResult>((resolve) => {
    const requestId = 1 + Math.floor(Math.random() * 1000000000);
    const startedAt = Date.now();
    let settled = false;
    let registered = false;
    // After the time-out, the listener stays (until the scope ends) to tell a late module from a missing one.
    let watchingLate = false;
    let retry: ReturnType<typeof setInterval> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    let vault: VaultImpl | undefined;

    const stopWaiting = () => {
      if (retry !== undefined) clearInterval(retry);
      if (giveUp !== undefined) clearTimeout(giveUp);
      retry = undefined;
      giveUp = undefined;
    };

    const unregister = () => {
      if (!registered) return;
      registered = false;
      try {
        engine.off('EVENT_FROM_VIEW_LISTENER', onEvent);
      } catch (error) {
        logError('the vault listener could not be removed', error);
      }
    };

    const finish = (result: VaultImpl | null, reason: string, keepListening = false) => {
      if (settled) return;
      settled = true;
      stopWaiting();
      if (!result && keepListening && registered) watchingLate = true;
      else if (!result) unregister();
      resolve({ vault: result, reason });
      if (registered && onState) sendToModule(VAULT_EVENTS.status, String(requestId));
    };

    const onEvent: Handler = (listener, eventName, payload) => {
      // Other add-ons' events arrive many times per second: dropped first.
      if (String(listener).toUpperCase() !== LISTENER) return;
      if (typeof eventName !== 'string' || eventName.indexOf('MSFS_UI_VAULT_') !== 0) return;
      const text = typeof payload === 'string' ? payload : '';
      if (eventName === VAULT_EVENTS.loaded) {
        const loaded = decodeLoaded(text);
        if (!loaded || loaded.requestId !== requestId) return;
        if (settled) {
          if (!watchingLate) return;
          // Late: the features already read the sim storage; `onLate` moves the session to the vault.
          watchingLate = false;
          const afterMs = Date.now() - startedAt;
          const late = onLate ? parseSnapshot(loaded.text) : null;
          if (!onLate || !late) {
            unregister();
            log(`the vault module answered after ${afterMs} ms; this session's data stays in the sim storage`);
            if (onLate) onLate(null, afterMs);
            return;
          }
          // Kept listening: its SAVED answers.
          vault = new VaultImpl(late, loaded.seq);
          log(`the vault module answered after ${afterMs} ms`);
          onLate(vault, afterMs);
          return;
        }
        const copy = parseSnapshot(loaded.text);
        if (!copy) {
          finish(null, 'the vault snapshot is unreadable');
          return;
        }
        vault = new VaultImpl(copy, loaded.seq);
        finish(vault, '');
      } else if (eventName === VAULT_EVENTS.saved) {
        const saved = decodeSaved(text);
        if (saved && vault) vault.saved(saved.seq, saved.status);
      } else if (eventName === VAULT_EVENTS.state) {
        const state = decodeState(text);
        if (state && state.requestId === requestId && onState) onState(state.state);
      }
    };

    try {
      engine.on('EVENT_FROM_VIEW_LISTENER', onEvent);
      registered = true;
      // On an already disposed scope, this runs at once and settles the promise.
      scope.add(() => {
        if (vault) vault.dispose();
        unregister();
        finish(null, 'the mod was unloaded');
      });
      if (settled) return;
      engine.trigger('ADD_VIEW_LISTENER', LISTENER, window.location.pathname);
      // The timers first: an answer arriving inside the first call settles the promise and stops them.
      const sendLoad = () => sendToModule(VAULT_EVENTS.load, String(requestId));
      retry = setInterval(sendLoad, LOAD_RETRY_MS);
      giveUp = setTimeout(() => finish(null, `the vault module did not answer within ${timeoutMs} ms`, true), timeoutMs);
      sendLoad();
    } catch (error) {
      finish(null, `the CommBus is not available: ${describeError(error)}`);
    }
  });
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

  private readonly copy: Map<string, string>;

  constructor(copy: Map<string, string>, seq: number) {
    this.copy = copy;
    this.current = seq;
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
      return;
    }
    const seq = this.current + 1;
    this.current = seq;
    sendToModule(VAULT_EVENTS.save, encodeSave(seq, text));
    if (this.ended) return;
    this.timers.set(
      seq,
      setTimeout(() => {
        this.timers.delete(seq);
        logError(`the vault module did not confirm save ${seq} within ${CONFIRM_TIMEOUT_MS} ms`);
      }, CONFIRM_TIMEOUT_MS),
    );
  }
}
