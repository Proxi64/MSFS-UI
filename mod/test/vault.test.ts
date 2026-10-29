import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { Scope } from '../src/core/scope.ts';
import { STORAGE_PREFIX } from '../src/core/storage.ts';
import { VAULT_EVENTS, VAULT_MAX_BYTES } from '../src/core/vault-protocol.ts';
import { openVault } from '../src/sim/vault.ts';

type Handler = (...args: unknown[]) => void;

interface Sent {
  event: string;
  text: string;
}

/** The sim's `engine` on a fake global, with the vault module answering like the real one. */
class FakeEngine {
  handlers = new Map<string, Handler[]>();
  sent: Sent[] = [];
  triggers: unknown[][] = [];
  /** What the module has stored; null for nothing. */
  stored: { seq: number; text: string } | null = null;
  answers = true;
  /** The status of the SAVED answers; null for none. */
  saveStatus: string | null = 'ok';
  /** Request ids to send before the real one. */
  decoyIds: number[] = [];

  on = (event: string, handler: Handler) => {
    const list = this.handlers.get(event) || [];
    list.push(handler);
    this.handlers.set(event, list);
    return { clear: () => this.off(event, handler) };
  };
  off = (event: string, handler: Handler) => {
    const list = this.handlers.get(event) || [];
    const at = list.indexOf(handler);
    if (at >= 0) list.splice(at, 1);
  };
  trigger = (...args: unknown[]) => {
    this.triggers.push(args);
  };
  call = (name: string, event: string, text: string): Promise<void> => {
    assert.equal(name, 'COMM_BUS_WASM_CALLBACK');
    this.sent.push({ event, text });
    if (this.answers) Promise.resolve().then(() => this.answer(event, text));
    return Promise.resolve();
  };

  listenerCount(): number {
    return (this.handlers.get('EVENT_FROM_VIEW_LISTENER') || []).length;
  }
  /** Delivers an event of the CommBus listener to the mod. */
  emit(eventName: string, payload: string, listener = 'JS_LISTENER_COMM_BUS'): void {
    for (const handler of (this.handlers.get('EVENT_FROM_VIEW_LISTENER') || []).slice()) handler(listener, eventName, payload);
  }
  private answer(event: string, text: string): void {
    if (event === VAULT_EVENTS.load) {
      for (const id of this.decoyIds) this.emit(VAULT_EVENTS.loaded, `${id}\n99\n{"MSFS_UI_DECOY":"1"}`);
      this.emit(VAULT_EVENTS.loaded, `${text}\n${this.stored ? this.stored.seq : 0}\n${this.stored ? this.stored.text : ''}`);
    } else if (event === VAULT_EVENTS.save && this.saveStatus !== null) {
      this.emit(VAULT_EVENTS.saved, `${text.split('\n')[0]}\n${this.saveStatus}`);
    }
  }
  saves(): Sent[] {
    return this.sent.filter((message) => message.event === VAULT_EVENTS.save);
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('vault', () => {
  let fake: FakeEngine;
  let error: ReturnType<typeof mock.method>;
  beforeEach(() => {
    fake = new FakeEngine();
    (globalThis as { window?: unknown }).window = { location: { pathname: '/menu.html' } };
    (globalThis as { engine?: unknown }).engine = fake;
    error = mock.method(console, 'error', () => {});
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  });
  afterEach(() => {
    mock.timers.reset();
    error.mock.restore();
    delete (globalThis as { engine?: unknown }).engine;
    delete (globalThis as { window?: unknown }).window;
  });

  async function open(scope: Scope) {
    const pending = openVault(scope);
    await Promise.resolve();
    await Promise.resolve();
    const result = await pending;
    assert.ok(result.vault, 'the vault opened');
    return result.vault;
  }

  it('opens with the stored snapshot', async () => {
    fake.stored = { seq: 5, text: JSON.stringify({ [`${STORAGE_PREFIX}B`]: '2', [`${STORAGE_PREFIX}A`]: '"x"' }) };
    const scope = new Scope();
    const vault = await open(scope);
    assert.equal(vault.seq, 5);
    assert.equal(vault.backend().kind, 'vault');
    assert.equal(vault.backend().get(`${STORAGE_PREFIX}A`), '"x"');
    assert.equal(vault.backend().get(`${STORAGE_PREFIX}MISSING`), undefined);
    assert.match(vault.describe(), /^seq 5, \d+ bytes, keys: A, B$/);
    assert.deepEqual(fake.triggers[0], ['ADD_VIEW_LISTENER', 'JS_LISTENER_COMM_BUS', '/menu.html']);
    scope.dispose();
  });

  it('opens empty when nothing is stored', async () => {
    const scope = new Scope();
    const vault = await open(scope);
    assert.equal(vault.seq, 0);
    assert.equal(vault.describe(), 'seq 0, 2 bytes, keys: none');
    scope.dispose();
  });

  it('returns null when nothing answers within the time, and removes its listener with the scope', async () => {
    fake.answers = false;
    const scope = new Scope();
    const pending = openVault(scope);
    assert.equal(fake.listenerCount(), 1);
    mock.timers.tick(2999);
    assert.equal(fake.listenerCount(), 1);
    mock.timers.tick(1);
    assert.deepEqual(await pending, { vault: null, reason: 'the vault module did not answer within 3000 ms' });
    assert.equal(fake.listenerCount(), 1, 'kept to see a late answer');
    scope.dispose();
    assert.equal(fake.listenerCount(), 0);
  });

  it('keeps a passive listener after the time-out and reports a late module without switching to it', async () => {
    fake.answers = false;
    const log = mock.method(console, 'log', () => {});
    const scope = new Scope();
    const late: number[] = [];
    const pending = openVault(scope, 3000, (afterMs) => late.push(afterMs));
    const id = fake.sent[0]!.text;
    mock.timers.tick(3000);
    assert.equal((await pending).vault, null);
    assert.equal(fake.listenerCount(), 1, 'still listening');
    // Another request id is ignored.
    fake.emit(VAULT_EVENTS.loaded, '123\n7\n{}');
    assert.deepEqual(late, []);
    mock.timers.tick(200);
    fake.emit(VAULT_EVENTS.loaded, `${id}\n7\n{"MSFS_UI_A":"1"}`);
    assert.deepEqual(late, [3200]);
    assert.equal(fake.listenerCount(), 0, 'the late answer is seen once');
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.deepEqual(
      lines.filter((line) => line.indexOf('answered after') >= 0),
      ["[msfs-ui] the vault module answered after 3200 ms; this session's data stays in the sim storage"],
    );
    log.mock.restore();
    scope.dispose();
  });

  it('leaves no listener after the scope ends, even while watching for a late module', async () => {
    fake.answers = false;
    const scope = new Scope();
    const pending = openVault(scope);
    mock.timers.tick(3000);
    await pending;
    assert.equal(fake.listenerCount(), 1);
    scope.dispose();
    assert.equal(fake.listenerCount(), 0);
  });

  it('asks again every 500 ms until the module answers', async () => {
    let loads = 0;
    fake.call = (_name, event, text) => {
      fake.sent.push({ event, text });
      if (event === VAULT_EVENTS.load && ++loads === 2) Promise.resolve().then(() => fake.emit(VAULT_EVENTS.loaded, `${text}\n3\n{"MSFS_UI_A":"1"}`));
      return Promise.resolve();
    };
    const scope = new Scope();
    const pending = openVault(scope);
    assert.equal(loads, 1);
    mock.timers.tick(500);
    const result = await pending;
    assert.equal(loads, 2);
    assert.ok(result.vault);
    assert.equal(result.vault.seq, 3);
    scope.dispose();
  });

  it('describes the current seq, size and keys after a confirmed write', async () => {
    const scope = new Scope();
    const vault = await open(scope);
    assert.equal(vault.describe(), 'seq 0, 2 bytes, keys: none');
    vault.backend().set(`${STORAGE_PREFIX}A`, '1');
    vault.flush();
    await tick();
    assert.equal(vault.describe(), 'seq 1, 17 bytes, keys: A');
    scope.dispose();
  });

  it("ignores other add-ons' events and other request ids", async () => {
    fake.stored = { seq: 1, text: '{"MSFS_UI_A":"1"}' };
    fake.decoyIds = [123456];
    const scope = new Scope();
    const pending = openVault(scope);
    fake.emit('p42_chaseplane_comms_wasm_ping', 'x');
    fake.emit(VAULT_EVENTS.loaded, '1\n50\n{"MSFS_UI_OTHER":"1"}', 'JS_LISTENER_SOMETHING_ELSE');
    for (const handler of fake.handlers.get('EVENT_FROM_VIEW_LISTENER') || []) handler('js_listener_comm_bus', 'p42_other', 'a', 'b');
    const vault = (await pending).vault;
    assert.ok(vault);
    assert.equal(vault.seq, 1);
    assert.equal(vault.describe(), 'seq 1, 17 bytes, keys: A');
    scope.dispose();
  });

  it('sends one snapshot for a burst of writes, 300 ms after the last', async () => {
    const scope = new Scope();
    const vault = await open(scope);
    const backend = vault.backend();
    backend.set(`${STORAGE_PREFIX}A`, '1');
    mock.timers.tick(200);
    backend.set(`${STORAGE_PREFIX}B`, '2');
    backend.remove(`${STORAGE_PREFIX}A`);
    mock.timers.tick(299);
    assert.equal(fake.saves().length, 0);
    mock.timers.tick(1);
    assert.deepEqual(fake.saves(), [{ event: VAULT_EVENTS.save, text: '1\n{"MSFS_UI_B":"2"}' }]);
    assert.equal(vault.seq, 1);
    backend.set(`${STORAGE_PREFIX}C`, '3');
    vault.flush();
    assert.equal(fake.saves().length, 2);
    assert.equal(fake.saves()[1]!.text.split('\n')[0], '2');
    await tick();
    assert.equal(error.mock.callCount(), 0);
    scope.dispose();
  });

  it('sends only ASCII', async () => {
    const scope = new Scope();
    const vault = await open(scope);
    vault.backend().set(`${STORAGE_PREFIX}T`, JSON.stringify(String.fromCharCode(0x5168)));
    vault.flush();
    const text = fake.saves()[0]!.text;
    for (let at = 0; at < text.length; at++) assert.ok(text.charCodeAt(at) <= 0x7f);
    scope.dispose();
  });

  it('flushes a pending snapshot when its scope is disposed, then removes its listener', async () => {
    const scope = new Scope();
    const vault = await open(scope);
    vault.backend().set(`${STORAGE_PREFIX}A`, '1');
    assert.equal(fake.saves().length, 0);
    scope.dispose();
    assert.equal(fake.saves().length, 1);
    assert.equal(fake.listenerCount(), 0);
    mock.timers.tick(10000);
    assert.equal(fake.saves().length, 1, 'no timer left running');
    assert.equal(error.mock.callCount(), 0, 'no timeout logged after the dispose');
  });

  it('refuses a snapshot above VAULT_MAX_BYTES', async () => {
    const scope = new Scope();
    const vault = await open(scope);
    vault.backend().set(`${STORAGE_PREFIX}BIG`, 'x'.repeat(VAULT_MAX_BYTES));
    vault.flush();
    assert.equal(fake.saves().length, 0);
    assert.equal(error.mock.callCount(), 1);
    assert.match(String(error.mock.calls[0]!.arguments[0]), /too big|too large|524288/);
    assert.equal(vault.seq, 0);
    scope.dispose();
  });

  it('logs a SAVED that is not ok', async () => {
    fake.saveStatus = 'too-big';
    const scope = new Scope();
    const vault = await open(scope);
    vault.backend().set(`${STORAGE_PREFIX}A`, '1');
    vault.flush();
    await tick();
    assert.equal(error.mock.callCount(), 1);
    assert.match(String(error.mock.calls[0]!.arguments[0]), /too-big/);
    scope.dispose();
  });

  it('logs once when no SAVED arrives within 5000 ms', async () => {
    fake.saveStatus = null;
    const scope = new Scope();
    const vault = await open(scope);
    vault.backend().set(`${STORAGE_PREFIX}A`, '1');
    vault.flush();
    mock.timers.tick(4999);
    assert.equal(error.mock.callCount(), 0);
    mock.timers.tick(1);
    assert.equal(error.mock.callCount(), 1);
    assert.match(String(error.mock.calls[0]!.arguments[0]), /did not confirm save 1 within 5000 ms/);
    scope.dispose();
  });

  it('falls back with a reason when the stored snapshot is unreadable', async () => {
    fake.stored = { seq: 3, text: '{not json' };
    const scope = new Scope();
    const pending = openVault(scope);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(await pending, { vault: null, reason: 'the vault snapshot is unreadable' });
    assert.equal(fake.listenerCount(), 0);
    scope.dispose();
  });

  it('resolves on an already disposed scope with no timer left running', async () => {
    const scope = new Scope();
    scope.dispose();
    const result = await openVault(scope);
    assert.equal(result.vault, null);
    assert.equal(fake.listenerCount(), 0);
    assert.equal(fake.sent.length, 0);
    mock.timers.tick(10000);
    assert.equal(fake.sent.length, 0, 'no retry timer left');
  });

  it('stops its timers when the module answers inside the first call', async () => {
    fake.call = (_name, event, text) => {
      fake.sent.push({ event, text });
      fake.emit(VAULT_EVENTS.loaded, `${text}
0
`);
      return Promise.resolve();
    };
    const scope = new Scope();
    const result = await openVault(scope);
    assert.ok(result.vault);
    const before = fake.sent.length;
    mock.timers.tick(10000);
    assert.equal(fake.sent.length, before, 'no LOAD retry after the answer');
    scope.dispose();
  });

  it('falls back instead of rejecting when the CommBus throws', async () => {
    fake.trigger = () => {
      throw new Error('no bus');
    };
    const scope = new Scope();
    const result = await openVault(scope);
    assert.deepEqual(result, { vault: null, reason: 'the CommBus is not available: no bus' });
    assert.equal(fake.listenerCount(), 0);
    mock.timers.tick(10000);
    assert.equal(fake.sent.length, 0);
    scope.dispose();
  });
});
