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
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
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
    const vault = await pending;
    assert.ok(vault, 'the vault opened');
    return vault;
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

  it('returns null when nothing answers within the time, and removes its listener', async () => {
    fake.answers = false;
    const scope = new Scope();
    const pending = openVault(scope);
    assert.equal(fake.listenerCount(), 1);
    mock.timers.tick(2999);
    assert.equal(fake.listenerCount(), 1);
    mock.timers.tick(1);
    assert.equal(await pending, null);
    assert.equal(fake.listenerCount(), 0);
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
    const vault = await pending;
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
});
