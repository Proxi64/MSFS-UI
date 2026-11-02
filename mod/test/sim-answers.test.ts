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
const { chooseLivery, chooseVariant, readConfigurator } = await import('../src/sim/configurator.ts');
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

// The sim reports a change 0.5 to 1.2 s after it (measured on 1.9.21, 2026-11-02): a click back on the livery or the
// variant it is leaving came while the state still showed that one selected, and was dropped (the sim stayed on the other).
describe('a click back before the sim reports the change', () => {
  const twoLiveries = [
    { id: 'v1:0', title: 'Livery 01', imageUrl: 'a.png', directoryPath: 'SimObjects/a', isSelected: true },
    { id: 'v1:1', title: 'Livery 02', imageUrl: 'b.png', directoryPath: 'SimObjects/b', isSelected: false },
  ];
  const current = model.Game.Aircraft.CurrentAircraft;
  afterEach(async () => {
    configurator.Liveries.getElement = (index: number) => Promise.resolve(liveries[index]);
    configurator.Liveries.requestRange = () => Promise.resolve(liveries.length);
    configurator.Items.getElement = (index: number) => Promise.resolve(variants[index]);
    configurator.Details.read = () => Promise.resolve({ variationId: 'v1' });
    current.read = () => Promise.resolve({ variationId: 'v1', isValid: true, thumbnailPath: '' });
    configurator.SaveVariationId.request = () => Promise.resolve(undefined);
    configurator.SelectItem.request = () => Promise.resolve(undefined);
    // What was sent and not reported is forgotten by a read that shows the state again.
    await readConfigurator();
  });

  it('sends the livery the sim is leaving, after the other, one at a time', async () => {
    configurator.Liveries.getElement = (index: number) => Promise.resolve(twoLiveries[index]);
    configurator.Liveries.requestRange = () => Promise.resolve(twoLiveries.length);
    const state = await readConfigurator();
    const sent: string[] = [];
    let first: () => void = () => undefined;
    configurator.SaveVariationId.request = (id?: string) => {
      sent.push(`${id} start`);
      return new Promise<undefined>((resolve) => {
        const end = () => {
          sent.push(`${id} end`);
          resolve(undefined);
        };
        if (sent.length === 1) first = end;
        else end();
      });
    };
    const toTwo = chooseLivery(state, 'v1:1');
    const back = chooseLivery(state, 'v1:0');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.deepEqual(sent, ['v1:1 start'], 'the second waits for the first');
    first();
    assert.deepEqual(await Promise.all([toTwo, back]), [true, true]);
    assert.deepEqual(sent, ['v1:1 start', 'v1:1 end', 'v1:0 start', 'v1:0 end']);
    assert.equal(await chooseLivery(state, 'v1:0'), false, 'the one just chosen again: nothing sent');
  });

  it('sends the variant the sim is leaving, checked against the variant it took', async () => {
    const state = await readConfigurator();
    const sent: string[] = [];
    configurator.SelectItem.request = (id?: string) => {
      sent.push(String(id));
      // The sim takes it at once, and reports it to the configurator's list later.
      configurator.Details.read = () => Promise.resolve({ variationId: String(id) });
      current.read = () => Promise.resolve({ variationId: String(id), isValid: true, thumbnailPath: '' });
      return Promise.resolve(undefined);
    };
    assert.equal(await chooseVariant(state, 'v2'), true);
    assert.equal(await chooseVariant(state, 'v1'), true, 'the state still shows v1 selected');
    assert.deepEqual(sent, ['v2', 'v1']);
  });
});
