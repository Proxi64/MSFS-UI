// The vault protocol as the mod speaks it (mod/src/core/vault-protocol.ts), against the real module: the mod's tests use
// a fake module and the module's tests write their payloads by hand, so a drift between the two sides shows here.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeLoaded, decodeSaved, decodeState, encodeSave, toAscii, VAULT_EVENTS, VAULT_MAX_BYTES } from '../../mod/src/core/vault-protocol.ts';
import { loadVault, wasmBuilt, type Harness } from './harness.ts';

const skip = wasmBuilt ? false : 'wasm/dist/msfs-ui.wasm is missing: run wasm/build.ps1 first';

const answers = (vault: Harness, event: string) => vault.sent.filter((message) => message.event === event).map((message) => message.text);

/**
 * A module started on `disk`, its start-up read ended: asked as the mod asks (the same LOAD again while it waits; a
 * missing file is confirmed at the fourth attempt), what it sent until then cleared.
 */
async function started(disk: Map<string, Uint8Array>): Promise<Harness> {
  const vault = await loadVault(disk);
  await vault.settle();
  for (let asked = 0; asked < 6 && answers(vault, VAULT_EVENTS.loaded).length === 0; asked++) {
    vault.send(VAULT_EVENTS.load, '1');
    await vault.settle();
  }
  assert.equal(answers(vault, VAULT_EVENTS.loaded).length, 1, 'the start-up read ended');
  vault.sent.length = 0;
  return vault;
}

test("the module answers the mod's LOAD of an empty vault in the form the mod decodes", { skip }, async () => {
  const vault = await started(new Map());
  vault.send(VAULT_EVENTS.load, '7');
  assert.deepEqual(answers(vault, VAULT_EVENTS.loaded).map(decodeLoaded), [{ requestId: 7, seq: 0, text: '' }]);
});

test("a snapshot saved with the mod's encoding loads back, after a restart, to the same data", { skip }, async () => {
  const disk = new Map<string, Uint8Array>();
  const data = { MSFS_UI_LIVERY_TAILS: '{"a":"F-GKXA"}', MSFS_UI_WEATHER_BAR: 'Zürich, 東京' };
  const first = await started(disk);
  first.send(VAULT_EVENTS.save, encodeSave(1, toAscii(JSON.stringify(data))));
  await first.settle();
  assert.deepEqual(answers(first, VAULT_EVENTS.saved).map(decodeSaved), [{ seq: 1, status: 'ok' }]);

  const vault = await started(disk);
  vault.send(VAULT_EVENTS.load, '42');
  const loaded = answers(vault, VAULT_EVENTS.loaded).map(decodeLoaded)[0];
  assert.ok(loaded);
  assert.equal(loaded.requestId, 42);
  assert.equal(loaded.seq, 1);
  assert.deepEqual(JSON.parse(loaded.text), data);
});

test("the module's size limit is the mod's VAULT_MAX_BYTES", { skip }, async () => {
  const vault = await started(new Map());
  vault.send(VAULT_EVENTS.save, encodeSave(1, 'x'.repeat(VAULT_MAX_BYTES + 1)));
  vault.send(VAULT_EVENTS.save, encodeSave(2, 'x'.repeat(VAULT_MAX_BYTES)));
  await vault.settle();
  assert.deepEqual(answers(vault, VAULT_EVENTS.saved).map(decodeSaved), [
    { seq: 1, status: 'too-big' },
    { seq: 2, status: 'ok' },
  ]);
});

test("the module's STATE answer decodes to one line for the mod's request", { skip }, async () => {
  const vault = await started(new Map());
  vault.send(VAULT_EVENTS.status, '5');
  const state = answers(vault, VAULT_EVENTS.state).map(decodeState)[0];
  assert.ok(state);
  assert.equal(state.requestId, 5);
  assert.match(state.state, /^ready 1 phase \d+ .*; registered 1 1 1; /);
  assert.equal(state.state.includes('\n'), false);
});
