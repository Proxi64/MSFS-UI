// Every wait of the mod on the sim is bounded (core/async.ts): a request the sim never answers ends in an error that
// names it, which the callers log, instead of a silent wait. The sim's `/Global` modules are stubbed by module hooks:
// the data model is a fake built by the test (FakeModel), whose requests answer or not as each test says.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

const asModule = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const GLOBAL_STUBS: Record<string, string> = {
  '/Global/shared/store.js': 'export class ReadableStore {}',
  '/Global/shared/utils.js': 'export function UniversalProxy() { return globalThis.__msfsUiFakeModel; }',
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = GLOBAL_STUBS[specifier];
    return stub !== undefined ? { url: asModule(stub), shortCircuit: true } : nextResolve(specifier, context);
  },
});

/** A request that never answers. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

type Answer = () => Promise<unknown>;

/** A node of the fake data model: its value, its action, and as an array its items. */
function node(read: Answer = () => Promise.resolve(null), items: unknown[] = []) {
  const fake = Object.assign(() => fake.read(), {
    read,
    request: (() => Promise.resolve(undefined)) as (param?: string) => Promise<unknown>,
    requestRange: (() => Promise.resolve(items.length)) as () => Promise<number>,
    getElement: ((index: number) => Promise.resolve(items[index])) as (index: number) => Promise<unknown>,
    watch: () => Promise.resolve(0),
    unwatch: () => true,
  });
  return fake;
}

const variants = [
  { id: 'v1', title: 'Passengers', isSelected: true, isDisabled: false },
  { id: 'v2', title: 'Cargo', isSelected: false, isDisabled: false },
];
const liveries = [{ id: 'v1:0', title: 'Livery 01', imageUrl: 'a.png', directoryPath: 'SimObjects/a', isSelected: true }];
const model = {
  Game: {
    Aircraft: {
      CurrentAircraft: node(() => Promise.resolve({ variationId: 'v1', isValid: true, thumbnailPath: '' })),
      Configurator: {
        Items: node(undefined, variants),
        Liveries: node(undefined, liveries),
        Details: node(() => Promise.resolve({ variationId: 'v1' })),
        SelectItem: node(),
        SaveVariationId: node(),
      },
    },
  },
};
(globalThis as { __msfsUiFakeModel?: unknown }).__msfsUiFakeModel = model;

const { ANSWER_TIMEOUT_MS, readArray } = await import('../src/sim/store.ts');
const { chooseVariant, readConfigurator } = await import('../src/sim/configurator.ts');
const configurator = model.Game.Aircraft.Configurator;

/** Lets the pending promises run, the fake timers moved `ms` on. */
async function elapse(ms: number): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  mock.timers.tick(ms);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('waits on the sim', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => {
    mock.timers.reset();
    configurator.Items.getElement = (index: number) => Promise.resolve(variants[index]);
    configurator.Details.read = () => Promise.resolve({ variationId: 'v1' });
    configurator.SelectItem.request = () => Promise.resolve(undefined);
  });

  it('reads every item of an array', async () => {
    assert.deepEqual(await readArray(configurator.Items, 'the variants'), variants);
  });

  it('reads a list longer than one range whole, asking each range before its items', async () => {
    // As the sim: the whole size whatever the range asked, an item only once its range was asked.
    const names = Array.from({ length: 2500 }, (_, at) => `aircraft ${at}`);
    const asked: number[] = [];
    const loaded = new Set<number>();
    const long = node();
    long.requestRange = ((start: number, count: number) => {
      asked.push(start);
      for (let at = start; at < Math.min(start + count, names.length); at++) loaded.add(at);
      return Promise.resolve(names.length);
    }) as () => Promise<number>;
    long.getElement = (index: number) => Promise.resolve(loaded.has(index) ? names[index] : undefined);
    assert.deepEqual(await readArray(long, 'the aircraft list'), names);
    assert.deepEqual(asked, [0, 1000, 2000]);
  });

  it('gives up an array whose item never comes, naming it', async () => {
    configurator.Items.getElement = (index: number) => (index === 1 ? never() : Promise.resolve(variants[index]));
    const read = assert.rejects(readArray(configurator.Items, 'the variants'), { message: `the variants: no answer after ${ANSWER_TIMEOUT_MS} ms` });
    await elapse(ANSWER_TIMEOUT_MS);
    await read;
  });

  it('bounds each request of an array, not the whole array: a long list is not cut short', async () => {
    let answered = 0;
    configurator.Items.getElement = (index: number) =>
      new Promise((resolve) =>
        setTimeout(() => {
          answered++;
          resolve(variants[index]);
        }, ANSWER_TIMEOUT_MS - 1),
      );
    const read = readArray(configurator.Items, 'the variants');
    await elapse(ANSWER_TIMEOUT_MS - 1);
    await elapse(ANSWER_TIMEOUT_MS - 1);
    assert.deepEqual(await read, variants);
    assert.equal(answered, 2);
  });

  it('gives up reading the configurator when its details never come', async () => {
    configurator.Details.read = never;
    const read = assert.rejects(readConfigurator(), { message: `the configurator: no answer after ${ANSWER_TIMEOUT_MS} ms` });
    await elapse(ANSWER_TIMEOUT_MS);
    await read;
  });

  it('gives up a choice of variant the sim never answers', async () => {
    const state = await readConfigurator();
    configurator.SelectItem.request = never;
    const choice = assert.rejects(chooseVariant(state, 'v2'), { message: `the change of variant: no answer after ${ANSWER_TIMEOUT_MS} ms` });
    await elapse(ANSWER_TIMEOUT_MS);
    await choice;
  });
});
