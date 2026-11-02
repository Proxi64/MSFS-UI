// Loading an aircraft against a fake of the sim's configurator: the current aircraft does not follow a request when the
// configurator already holds the target (measured on 1.9.21, 2026-11-02), and the All tab is read without leaving the
// user's tab changed. The sim's `/Global` modules are stubbed by module hooks, as in sim-answers.test.ts.

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

interface Aircraft {
  aircraftId: number;
  variationIndex: number;
  variationId: string;
  displayName: string;
  creator: string;
}

const atr42: Aircraft = { aircraftId: 78, variationIndex: 1, variationId: 'atr42', displayName: 'ATR 42', creator: 'S' };
const atr72: Aircraft = { aircraftId: 28, variationIndex: 1, variationId: 'atr72', displayName: 'ATR 72', creator: 'S' };
const helicopter: Aircraft = { aircraftId: 5, variationIndex: 0, variationId: 'h125', displayName: 'H125', creator: 'S' };

/** The sim, as measured: a request of the aircraft the configurator holds changes nothing. */
const sim = {
  current: atr42 as Aircraft | null,
  currentValid: true,
  details: atr42 as Aircraft | null,
  /** False: the current aircraft does not follow the configurator at all. */
  currentFollows: true,
  category: 'PLANETYPE_ALL',
  listed: 'PLANETYPE_ALL',
  requests: [] as string[],
};

const byId = (id: string | undefined) => [atr42, atr72, helicopter].filter((plane) => `${plane.aircraftId}||${plane.variationIndex}` === id)[0] || null;

const listNode = {
  requestRange: () => Promise.resolve(sim.listed === 'HELICOPTER' ? 1 : 2),
  getElement: (index: number) => Promise.resolve(sim.listed === 'HELICOPTER' ? helicopter : [atr42, atr72][index]),
};
const requestNode = (name: string, action: (param?: string) => void = () => undefined) => ({
  request: (param?: string) => {
    sim.requests.push(`${name} ${param === undefined ? '' : param}`.trim());
    action(param);
    return Promise.resolve(undefined);
  },
});
const model = {
  Game: {
    Aircraft: {
      CurrentAircraft: () => Promise.resolve(sim.current ? { variationId: sim.current.variationId, isValid: sim.currentValid, thumbnailPath: '' } : null),
      FilteredCategory: () => Promise.resolve(sim.category),
      AircraftList: listNode,
      GetAircraftFromVariationId: {
        // An unknown variant, as measured on 1.9.21 (2026-11-02): an aircraft without a name, number -1.
        request: (id: string) => Promise.resolve([atr42, atr72, helicopter].filter((plane) => plane.variationId === id)[0] || { aircraftId: -1, variationIndex: 0, variationId: id, displayName: '', creator: '' }),
      },
      SetAircraftCategoryFilter: requestNode('category', (param) => {
        sim.category = param || '';
      }),
      UpdateAircraftList: requestNode('update', () => {
        sim.listed = sim.category;
      }),
      Configurator: {
        Details: () => Promise.resolve(sim.details),
        Liveries: { requestRange: () => Promise.resolve(0), getElement: () => Promise.resolve(null) },
        SelectItem: requestNode('variant'),
        SaveVariationId: requestNode('livery'),
        SetAircraftForConfigurator: requestNode('set', (param) => {
          const plane = byId(param);
          if (!plane || (sim.details && sim.details.variationId === plane.variationId)) return;
          sim.details = plane;
          if (sim.currentFollows) sim.current = plane;
        }),
      },
    },
  },
};
(globalThis as { __msfsUiFakeModel?: unknown }).__msfsUiFakeModel = model;

const { loadAircraft, withAllAircraft } = await import('../src/sim/aircraft-loading.ts');

/** Runs `work` to its end, the fake clock moved on while it waits. */
async function settled<T>(work: Promise<T>): Promise<T> {
  let done = false;
  const end = () => {
    done = true;
  };
  work.then(end, end);
  for (let round = 0; round < 200 && !done; round++) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    mock.timers.tick(100);
  }
  return work;
}

describe('loadAircraft', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    Object.assign(sim, { current: atr42, currentValid: true, details: atr42, currentFollows: true, category: 'PLANETYPE_ALL', listed: 'PLANETYPE_ALL', requests: [] });
  });
  afterEach(() => mock.timers.reset());

  it('changes the current aircraft when the configurator already holds the target', async () => {
    // The state a change outside Free Flight leaves: the configurator on the ATR 72, the current aircraft the ATR 42.
    sim.details = atr72;
    await settled(loadAircraft('atr72'));
    assert.equal(sim.current!.variationId, 'atr72');
    assert.deepEqual(
      sim.requests.filter((request) => request.startsWith('set')),
      ['set 78||1', 'set 28||1'],
      'the configurator set on the current aircraft first, so that the request changes something',
    );
  });

  it('does not ask for a change of configurator when it is on the current aircraft already, but for the target', async () => {
    await settled(loadAircraft('atr72'));
    assert.deepEqual(sim.requests, ['set 28||1']);
    assert.equal(sim.current!.variationId, 'atr72');
  });

  it('sends no change of aircraft for a variant the sim does not know: it answers an empty aircraft', async () => {
    await assert.rejects(settled(loadAircraft('gone')), { message: 'variant gone not found' });
    assert.deepEqual(sim.requests, []);
    assert.equal(sim.current!.variationId, 'atr42');
  });

  it('fails when the current aircraft does not follow', async () => {
    sim.currentFollows = false;
    await assert.rejects(settled(loadAircraft('atr72')), { message: 'the current aircraft is still atr42, not atr72' });
  });

  it('sends nothing when the current aircraft cannot be used to set the configurator', async () => {
    sim.currentValid = false;
    await assert.rejects(settled(loadAircraft('atr72')), { message: 'the configurator cannot be set on the current aircraft' });
    assert.deepEqual(sim.requests, []);
  });
});

describe('withAllAircraft', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    Object.assign(sim, { current: atr42, currentValid: true, details: atr42, currentFollows: true, category: 'PLANETYPE_ALL', listed: 'PLANETYPE_ALL', requests: [] });
  });
  afterEach(() => mock.timers.reset());

  const names = (items: Aircraft[]) => items.map((item) => item.variationId);

  it('reads the list on the All tab without touching the tab', async () => {
    const read = await settled(withAllAircraft<Aircraft, string[]>((items) => Promise.resolve(names(items))));
    assert.deepEqual(read, ['atr42', 'atr72']);
    assert.deepEqual(sim.requests, ['update']);
    assert.equal(sim.category, 'PLANETYPE_ALL');
  });

  it('reads the All list from another tab, keeps it while working, then puts the tab back', async () => {
    Object.assign(sim, { category: 'HELICOPTER', listed: 'HELICOPTER' });
    let during = '';
    const read = await settled(
      withAllAircraft<Aircraft, string[]>((items) => {
        during = sim.category;
        return Promise.resolve(names(items));
      }),
    );
    assert.deepEqual(read, ['atr42', 'atr72']);
    assert.equal(during, 'PLANETYPE_ALL');
    assert.equal(sim.category, 'HELICOPTER');
    assert.equal(sim.listed, 'HELICOPTER');
  });

  it('puts the tab back after a failure', async () => {
    Object.assign(sim, { category: 'HELICOPTER', listed: 'HELICOPTER' });
    await assert.rejects(settled(withAllAircraft<Aircraft, void>(() => Promise.reject(new Error('no')))), { message: 'no' });
    assert.equal(sim.category, 'HELICOPTER');
  });

  it('leaves an empty category as it is: the list holds every aircraft then', async () => {
    Object.assign(sim, { category: '', listed: '' });
    const read = await settled(withAllAircraft<Aircraft, string[]>((items) => Promise.resolve(names(items))));
    assert.deepEqual(read, ['atr42', 'atr72']);
    assert.deepEqual(sim.requests, ['update']);
    assert.equal(sim.category, '');
  });
});
