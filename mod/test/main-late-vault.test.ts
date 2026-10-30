// main.ts's late path, without the sim: the sim's `/Global` modules, the stylesheet and config.js are stubbed by module
// hooks (main.ts imports every feature), the vault module is a fake `engine` that answers after the time-out. main.ts
// starts on import and once per process: one scenario in this file.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, before, describe, it, mock } from 'node:test';
import { loadData, saveData, STORAGE_PREFIX } from '../src/core/storage.ts';
import { VAULT_EVENTS } from '../src/core/vault-protocol.ts';
import { FEATURE_IDS } from '../src/generated/catalog.ts';

const asModule = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const GLOBAL_STUBS: Record<string, string> = {
  '/Global/engine_ui.bundle.js':
    'export function AttachTrait() { return false; } export const GuidToTrait = {}; export const GuidToManipulator = {}; export class UITimeline {} export class UITransition {}',
  '/Global/shared/store.js': 'export class ReadableStore {}',
  // Every path of the data model is a node; its reads and requests never answer.
  '/Global/shared/utils.js':
    'const node = () => new Proxy(function () {}, { get: (target, key) => (key === "then" ? undefined : node()), apply: () => new Promise(() => {}) });' +
    ' export function UniversalProxy() { return node(); }',
};
/** Every feature off: the test is about the storage. */
const CONFIG = `export default ${JSON.stringify({ schemaVersion: 1, features: Object.fromEntries(FEATURE_IDS.map((id) => [id, { enabled: false }])) })};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = GLOBAL_STUBS[specifier];
    if (stub !== undefined) return { url: asModule(stub), shortCircuit: true };
    if (specifier.indexOf('/msfs-ui/config.js') === 0) return { url: asModule(CONFIG), shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export default "";', shortCircuit: true };
    return nextLoad(url, context);
  },
});

type Handler = (...args: unknown[]) => void;

/** The sim's `engine`, with a vault module that answers only when told. */
class LateEngine {
  handlers: Handler[] = [];
  sent: { event: string; text: string }[] = [];
  on = (event: string, handler: Handler) => {
    if (event === 'EVENT_FROM_VIEW_LISTENER') this.handlers.push(handler);
    return { clear: () => this.off(event, handler) };
  };
  off = (_event: string, handler: Handler) => {
    const at = this.handlers.indexOf(handler);
    if (at >= 0) this.handlers.splice(at, 1);
  };
  trigger = () => {};
  call = (_name: string, event: string, text: string): Promise<void> => {
    this.sent.push({ event, text });
    return Promise.resolve();
  };
  emit(eventName: string, payload: string): void {
    for (const handler of this.handlers.slice()) handler('JS_LISTENER_COMM_BUS', eventName, payload);
  }
}

const realTick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('main.ts, a vault module that answers late', () => {
  const data = new Map<string, string>();
  const engine = new LateEngine();
  const logs: string[] = [];
  let unload: (() => void) | undefined;
  before(() => {
    mock.method(console, 'error', () => {});
    mock.method(console, 'log', (...args: unknown[]) => void logs.push(args.join(' ')));
    const datastorage = {
      getData: (key: string) => data.get(key),
      setData: (key: string, value: string) => data.set(key, value),
      deleteData: (key: string) => data.delete(key),
    };
    const element = () => ({ setAttribute() {}, remove() {}, textContent: '' });
    const page: Record<string, unknown> = { datastorage, top: null, location: { pathname: '/menu.html' } };
    Object.assign(globalThis, {
      window: page,
      engine,
      document: { head: { appendChild() {}, removeChild() {} }, createElement: element },
      __MSFS_UI_BUILD__: 'test',
    });
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  });
  after(() => {
    if (unload) unload();
    mock.timers.reset();
    mock.restoreAll();
    for (const name of ['window', 'engine', 'document', '__MSFS_UI_BUILD__']) delete (globalThis as Record<string, unknown>)[name];
  });

  it("keeps the vault's newer values, moves the session's other changes, and the data lives in the vault", async () => {
    // The stale data of 1.x left in the sim storage.
    data.set(`${STORAGE_PREFIX}FAVORITE_LIVERIES`, '[{"dir":"old"}]');
    await import('../src/main.ts');
    const runtime = () => (globalThis as { window: { __msfsUiRuntime?: { storage?: { kind: string }; unload(): void } } }).window.__msfsUiRuntime;
    unload = () => runtime()?.unload();
    for (let i = 0; i < 50 && !engine.sent.some((message) => message.event === VAULT_EVENTS.load); i++) await realTick();
    const load = engine.sent.filter((message) => message.event === VAULT_EVENTS.load)[0];
    assert.ok(load, 'the vault asked for');
    mock.timers.tick(3000);
    for (let i = 0; i < 50 && !runtime()?.storage; i++) await realTick();
    assert.equal(runtime()?.storage?.kind, 'datastorage', 'the time-out: the session starts on the sim storage');

    // The fallback window: a bookmark clicked on the stale list, a key the vault does not have.
    saveData('FAVORITE_LIVERIES', [{ dir: 'old' }, { dir: 'clicked' }]);
    saveData('BASE_TAIL', 'ASXGS');

    const snapshot = { [`${STORAGE_PREFIX}FAVORITE_LIVERIES`]: '[{"dir":"newer"}]', [`${STORAGE_PREFIX}AIRCRAFT_USES`]: '{"x":5}' };
    engine.emit(VAULT_EVENTS.loaded, `${load.text}\n7\n${JSON.stringify(snapshot)}`);

    assert.equal(runtime()?.storage?.kind, 'vault');
    assert.deepEqual(loadData('FAVORITE_LIVERIES', null), [{ dir: 'newer' }], "the vault's newer list kept");
    assert.equal(loadData('BASE_TAIL', ''), 'ASXGS', "the session's new key moved");
    assert.deepEqual(loadData('AIRCRAFT_USES', null), { x: 5 });
    assert.ok(logs.some((line) => line.indexOf('newer values kept') >= 0 && line.indexOf('FAVORITE_LIVERIES') >= 0), 'the kept key logged');
    assert.ok(logs.some((line) => line.indexOf('data moved to the vault module') >= 0 && line.indexOf('BASE_TAIL') >= 0), 'the moved key logged');

    mock.timers.tick(300);
    const save = engine.sent.filter((message) => message.event === VAULT_EVENTS.save).pop();
    assert.ok(save, 'the merged snapshot saved');
    const saved = JSON.parse(save.text.slice(save.text.indexOf('\n') + 1)) as Record<string, string>;
    assert.equal(saved[`${STORAGE_PREFIX}FAVORITE_LIVERIES`], '[{"dir":"newer"}]');
    assert.equal(saved[`${STORAGE_PREFIX}BASE_TAIL`], '"ASXGS"');
  });
});
