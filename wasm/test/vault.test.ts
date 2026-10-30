import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadVault, wasmBuilt, type Harness } from './harness.ts';

const skip = wasmBuilt ? false : 'wasm/dist/msfs-ui.wasm is missing: run wasm/build.ps1 first';
const decoder = new TextDecoder();

const newDisk = () => new Map<string, Uint8Array>();
const dataOf = (disk: Map<string, Uint8Array>, slot: string) => {
  const bytes = disk.get(`/work/vault-${slot}.data`);
  return bytes === undefined ? undefined : decoder.decode(bytes);
};
const headOf = (disk: Map<string, Uint8Array>, slot: string) => {
  const bytes = disk.get(`/work/vault-${slot}.head`);
  return bytes === undefined ? undefined : decoder.decode(bytes);
};
const answers = (vault: Harness, event: string) => vault.sent.filter((message) => message.event === event).map((message) => message.text);

/** Starts a module on the disk, lets its start-up read end, and asks for the stored text. */
async function loadedText(disk: Map<string, Uint8Array>): Promise<string> {
  const vault = await loadVault(disk);
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', 'q');
  return answers(vault, 'MSFS_UI_VAULT_LOADED')[0];
}

test('answers an empty vault', { skip }, async () => {
  const vault = await loadVault(newDisk());
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', '7');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['7\n0\n']);
});

test('saves, then loads after a restart', { skip }, async () => {
  const disk = newDisk();
  const vault = await loadVault(disk);
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '1\n{"a":"1"}');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['1\nok']);
  assert.equal(dataOf(disk, 'a'), '{"a":"1"}');
  const head = headOf(disk, 'a')!;
  assert.equal(head.length, 64);
  assert.ok(head.startsWith('MSFSUI-VAULT 1 0000000001 0000000009 '), head);
  assert.equal(head.endsWith('\n'), true);
  assert.equal(await loadedText(disk), 'q\n1\n{"a":"1"}');
});

test('answers STATUS at once, before and after the start-up read', { skip }, async () => {
  const disk = newDisk();
  const first = await loadVault(disk);
  await first.settle();
  first.send('MSFS_UI_VAULT_SAVE', '1\n{"a":"1"}');
  await first.settle();
  const vault = await loadVault(disk);
  vault.send('MSFS_UI_VAULT_LOAD', 'q');
  vault.send('MSFS_UI_VAULT_STATUS', 's1');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_STATUS', 's2');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_STATE'), [
    // Only slot a was written: one head read waits (pending 1), the LOAD is deferred.
    's1\nready 0 phase 1 pending 1 deferred 1 attempts 1\nregistered 1 1 1\nreads 1 0\nheads 0 0 data 0 0\nreceived 1 0\nseq 0',
    's2\nready 1 phase 2 pending 0 deferred 0 attempts 1\nregistered 1 1 1\nreads 2 2\nheads 1 0 data 1 0\nreceived 1 0\nseq 1',
  ]);
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['q\n1\n{"a":"1"}']);
});

/** A disk with two snapshots: seq 1 in slot a, seq 2 (the newest) in slot b. */
async function twoSnapshots(): Promise<Map<string, Uint8Array>> {
  const disk = newDisk();
  const vault = await loadVault(disk);
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '1\nolder');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '2\nnewest');
  await vault.settle();
  return disk;
}

test('starts the read again when a start-up read never calls back', { skip }, async () => {
  // Measured in the sim on 2026-10-30: one of the two head reads launched by module_init never called back.
  const vault = await loadVault(await twoSnapshots(), { loseReads: ['/work/vault-b.head'] });
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', 'q1');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), [], 'still waiting after one LOAD');
  vault.send('MSFS_UI_VAULT_LOAD', 'q2');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['q1\n2\nnewest', 'q2\n2\nnewest']);
  vault.send('MSFS_UI_VAULT_STATUS', 's');
  assert.match(answers(vault, 'MSFS_UI_VAULT_STATE')[0], /^s\nready 1 phase 2 pending 0 deferred 0 attempts 2\n/);
});

test('waits for a file read before rather than leaving out its snapshot', { skip }, async () => {
  // The newest slot's head was opened once, then lost; at the restart it cannot be opened: the module must not take
  // it as absent (it would load seq 1, then write over the newest snapshot).
  const disk = await twoSnapshots();
  const vault = await loadVault(disk, { loseReads: ['/work/vault-b.head'] });
  await vault.settle();
  vault.refuseOpens.add('/work/vault-b.head');
  for (const id of ['q1', 'q2']) vault.send('MSFS_UI_VAULT_LOAD', id);
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), [], 'no answer while slot b cannot be read');
  vault.refuseOpens.delete('/work/vault-b.head');
  for (const id of ['q3', 'q4']) vault.send('MSFS_UI_VAULT_LOAD', id);
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['q1\n2\nnewest', 'q2\n2\nnewest', 'q3\n2\nnewest', 'q4\n2\nnewest']);
  assert.equal(dataOf(disk, 'b'), 'newest');
});

test('ignores the callback of a read dropped by a restart', { skip }, async () => {
  const disk = await twoSnapshots();
  const vault = await loadVault(disk, { loseReads: ['/work/vault-a.head'] });
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', 'q1');
  vault.send('MSFS_UI_VAULT_LOAD', 'q2');
  await vault.settle();
  // The dropped read calls back after all, once the module is ready: nothing must change.
  vault.releaseLost();
  await vault.settle();
  vault.send('MSFS_UI_VAULT_STATUS', 's');
  // Launched: 2 heads, then 2 heads and 2 data after the restart; ended: all but the dropped one.
  assert.match(answers(vault, 'MSFS_UI_VAULT_STATE')[0], /\nreads 6 5\nheads 1 1 data 1 1\n/);
  vault.send('MSFS_UI_VAULT_SAVE', '3\nafter');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['3\nok']);
  assert.equal(dataOf(disk, 'a'), 'after', 'the first write goes to the slot other than the loaded one (b)');
  assert.equal(dataOf(disk, 'b'), 'newest');
});

test('alternates the slots', { skip }, async () => {
  const disk = newDisk();
  const vault = await loadVault(disk);
  await vault.settle();
  const slotsAfter: (string | undefined)[][] = [];
  for (const seq of [1, 2, 3]) {
    vault.send('MSFS_UI_VAULT_SAVE', `${seq}\ntext ${seq}`);
    await vault.settle();
    slotsAfter.push([dataOf(disk, 'a'), dataOf(disk, 'b')]);
  }
  assert.deepEqual(slotsAfter, [
    ['text 1', undefined],
    ['text 1', 'text 2'],
    ['text 3', 'text 2'],
  ]);
  assert.equal(await loadedText(disk), 'q\n3\ntext 3');
});

test('keeps the previous snapshot when the head was not written', { skip }, async () => {
  const disk = newDisk();
  // Callbacks of save 1: open data, write data, open head, write head (4); of save 2, the data's open and write (6).
  const vault = await loadVault(disk, { stopAfter: 6 });
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '1\nfirst');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '2\nsecond');
  await vault.settle();
  assert.equal(dataOf(disk, 'b'), 'second');
  assert.equal(headOf(disk, 'b'), undefined);
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['1\nok']);
  assert.equal(await loadedText(disk), 'q\n1\nfirst');
});

test('ignores a slot whose data does not match its checksum', { skip }, async () => {
  const disk = newDisk();
  const vault = await loadVault(disk);
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '1\nfirst');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '2\nsecond');
  await vault.settle();
  assert.equal(await loadedText(disk), 'q\n2\nsecond');
  disk.set('/work/vault-b.data', new TextEncoder().encode('secXnd'));
  assert.equal(await loadedText(disk), 'q\n1\nfirst');
});

test('coalesces saves during a write', { skip }, async () => {
  const disk = newDisk();
  const vault = await loadVault(disk);
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '1\none');
  vault.send('MSFS_UI_VAULT_SAVE', '2\ntwo');
  vault.send('MSFS_UI_VAULT_SAVE', '3\nthree');
  await vault.settle();
  assert.deepEqual([...answers(vault, 'MSFS_UI_VAULT_SAVED')].sort(), ['1\nok', '2\nok', '3\nok']);
  assert.equal(answers(vault, 'MSFS_UI_VAULT_SAVED')[0], '1\nok');
  assert.ok(vault.writes.filter((path) => path.endsWith('.data')).length <= 2, vault.writes.join());
  assert.equal(await loadedText(disk), 'q\n3\nthree');
});

test('answers LOAD after a SAVE with the saved text', { skip }, async () => {
  const vault = await loadVault(newDisk());
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '4\nhot');
  vault.send('MSFS_UI_VAULT_LOAD', '9');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['9\n4\nhot']);
});

test('refuses stale and oversize saves', { skip }, async () => {
  const disk = newDisk();
  const vault = await loadVault(disk);
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '1\none');
  vault.send('MSFS_UI_VAULT_SAVE', '1\nagain');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['1\nstale', '1\nok']);
  const before = new Map(disk);
  vault.send('MSFS_UI_VAULT_SAVE', `2\n${'x'.repeat(524289)}`);
  await vault.settle();
  assert.equal(answers(vault, 'MSFS_UI_VAULT_SAVED')[2], '2\ntoo-big');
  assert.deepEqual(disk, before);
  vault.send('MSFS_UI_VAULT_SAVE', `2\n${'x'.repeat(524288)}`);
  await vault.settle();
  assert.equal(answers(vault, 'MSFS_UI_VAULT_SAVED')[3], '2\nok');
});

test('frees the seq of a failed write', { skip }, async () => {
  const disk = newDisk();
  const vault = await loadVault(disk);
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '4\nfour');
  await vault.settle();
  vault.failWrites = true;
  vault.send('MSFS_UI_VAULT_SAVE', '5\nfive');
  await vault.settle();
  assert.equal(answers(vault, 'MSFS_UI_VAULT_SAVED')[1], '5\nerror 1');
  vault.send('MSFS_UI_VAULT_LOAD', 'r');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['r\n4\nfour']);
  vault.failWrites = false;
  vault.send('MSFS_UI_VAULT_SAVE', '5\nfive');
  await vault.settle();
  assert.equal(answers(vault, 'MSFS_UI_VAULT_SAVED')[2], '5\nok');
  assert.equal(await loadedText(disk), 'q\n5\nfive');
});

test('answers a LOAD that arrives before the start-up read ends', { skip }, async () => {
  const disk = newDisk();
  const first = await loadVault(disk);
  await first.settle();
  first.send('MSFS_UI_VAULT_SAVE', '5\nstored');
  await first.settle();
  const vault = await loadVault(disk);
  vault.send('MSFS_UI_VAULT_LOAD', '3');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), []);
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['3\n5\nstored']);
});

test('keeps the last settled snapshot when the third save stops after its data and before its head', { skip }, async () => {
  const disk = newDisk();
  // Saves 1 and 2 take 4 callbacks each; save 3 writes slot a's data (open, write) and the sim stops before its head.
  const vault = await loadVault(disk, { stopAfter: 10 });
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '1\none');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '2\ntwo');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '3\nthree');
  await vault.settle();
  assert.equal(dataOf(disk, 'a'), 'three');
  assert.ok(headOf(disk, 'a')!.startsWith('MSFSUI-VAULT 1 0000000001 '), 'the head of slot a still describes save 1');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['1\nok', '2\nok']);
  assert.equal(await loadedText(disk), 'q\n2\ntwo');
});

// A read that fails at start-up must not lose a snapshot that was readable: the module writes the slot it did not
// load from, or, with nothing loaded, the slot other than the one with the newest valid head.
test('does not write over the loaded snapshot when the newer slot cannot be read', { skip }, async () => {
  const disk = newDisk();
  const first = await loadVault(disk);
  await first.settle();
  first.send('MSFS_UI_VAULT_SAVE', '4\nfour');
  await first.settle();
  first.send('MSFS_UI_VAULT_SAVE', '5\nfive');
  await first.settle();
  const vault = await loadVault(disk);
  vault.failReads.add('/work/vault-b.data');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', 'q');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['q\n4\nfour']);
  vault.send('MSFS_UI_VAULT_SAVE', '5\nnew five');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['5\nok']);
  assert.equal(dataOf(disk, 'a'), 'four', 'the loaded snapshot is untouched');
  assert.equal(await loadedText(disk), 'q\n5\nnew five');
});

test('does not write first onto the slot with the newest valid head when nothing could be read', { skip }, async () => {
  const disk = newDisk();
  const first = await loadVault(disk);
  await first.settle();
  first.send('MSFS_UI_VAULT_SAVE', '1\none');
  await first.settle();
  const vault = await loadVault(disk);
  vault.failReads.add('/work/vault-a.data');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', 'q');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['q\n0\n']);
  vault.send('MSFS_UI_VAULT_SAVE', '2\ntwo');
  await vault.settle();
  assert.equal(dataOf(disk, 'a'), 'one', 'slot a, possibly valid, is spared');
  assert.equal(dataOf(disk, 'b'), 'two');
  assert.equal(await loadedText(disk), 'q\n2\ntwo');
});
