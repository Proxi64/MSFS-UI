import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { HIDDEN_AIRCRAFT_CHANGED, isHidden, loadHidden, saveHidden, withHidden, type HiddenAircraft } from '../src/sim/hidden.ts';

const vision: HiddenAircraft = { displayName: 'Vision Jet G2', creator: 'Working Title' };
const cessna: HiddenAircraft = { displayName: 'Cessna 172 Skyhawk', creator: 'Asobo' };

describe('hidden aircraft list', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it('adds and removes an aircraft by name and publisher', () => {
    const added = withHidden([cessna], vision, true);
    assert.deepEqual(added, [cessna, vision]);
    assert.deepEqual(withHidden(added!, { displayName: 'Vision Jet G2', creator: 'Working Title' }, false), [cessna]);
  });

  it('returns null when nothing changes', () => {
    assert.equal(withHidden([vision], vision, true), null);
    assert.equal(withHidden([cessna], vision, false), null);
  });

  it('matches another variant of the same aircraft, not the same name of another publisher', () => {
    assert.equal(isHidden([vision], { displayName: 'Vision Jet G2', creator: 'Working Title' }), true);
    assert.equal(isHidden([vision], { displayName: 'Vision Jet G2', creator: 'Other' }), false);
    assert.equal(isHidden([], vision), false);
  });

  it('ignores a stored value that is not a list of name and publisher', () => {
    const data = new Map<string, string>();
    data.set('MSFS_UI_HIDDEN_AIRCRAFT', JSON.stringify([vision, null, 3, { displayName: 'x' }, { displayName: 1, creator: 'y' }, cessna]));
    (globalThis as { window?: unknown }).window = { datastorage: { getData: (key: string) => data.get(key), setData: () => undefined, deleteData: () => undefined }, top: null };
    assert.deepEqual(loadHidden(), [vision, cessna]);
    data.set('MSFS_UI_HIDDEN_AIRCRAFT', '{"a":1}');
    assert.deepEqual(loadHidden(), []);
  });

  it('saves under MSFS_UI_HIDDEN_AIRCRAFT and sends the event', () => {
    const data = new Map<string, string>();
    const datastorage = {
      getData: (key: string) => data.get(key),
      setData: (key: string, value: string) => data.set(key, value),
      deleteData: (key: string) => data.delete(key),
    };
    (globalThis as { window?: unknown }).window = { datastorage, top: null };
    const events: string[] = [];
    (globalThis as { document?: unknown }).document = { dispatchEvent: (event: { type: string }) => events.push(event.type) };
    saveHidden([vision]);
    assert.equal(data.get('MSFS_UI_HIDDEN_AIRCRAFT'), JSON.stringify([vision]));
    assert.deepEqual(events, [HIDDEN_AIRCRAFT_CHANGED]);
    assert.deepEqual(loadHidden(), [vision]);
  });
});
