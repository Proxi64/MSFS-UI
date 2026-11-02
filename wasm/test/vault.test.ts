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

/**
 * Asks for the stored text as the menu does: the same LOAD every 500 ms until the module answers (a missing file is
 * confirmed at the second attempt of the start-up read, which the second LOAD starts). Undefined after `max` LOADs.
 */
async function askUntilAnswered(vault: Harness, max = 2): Promise<string | undefined> {
  for (let asked = 0; asked < max; asked++) {
    vault.send('MSFS_UI_VAULT_LOAD', 'q');
    await vault.settle();
    const loaded = answers(vault, 'MSFS_UI_VAULT_LOADED');
    if (loaded.length > 0) return loaded[0];
  }
  return undefined;
}

/** A module on the disk whose start-up read has ended, as the menu leaves it; what it sent until then is cleared. */
async function readyVault(disk: Map<string, Uint8Array>, options?: Parameters<typeof loadVault>[1]): Promise<Harness> {
  const vault = await loadVault(disk, options);
  await vault.settle();
  assert.notEqual(await askUntilAnswered(vault), undefined, 'the start-up read ended');
  vault.sent.length = 0;
  return vault;
}

/** Starts a module on the disk, lets its start-up read end, and asks for the stored text. */
async function loadedText(disk: Map<string, Uint8Array>): Promise<string | undefined> {
  const vault = await loadVault(disk);
  await vault.settle();
  return askUntilAnswered(vault);
}

test('answers an empty vault once the missing files are confirmed by a second attempt', { skip }, async () => {
  const vault = await loadVault(newDisk());
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', '7');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), [], 'one failed open is not an empty vault');
  vault.send('MSFS_UI_VAULT_LOAD', '7');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['7\n0\n'], 'the same request answered once');
  vault.send('MSFS_UI_VAULT_STATUS', 's');
  assert.match(answers(vault, 'MSFS_UI_VAULT_STATE')[0]!, /^s\nready 1 phase 2 pending 0 deferred 0 attempts 2\n/);
});

test('starts on missing files when the sim still calls back their failed opens', { skip }, async () => {
  // 2.0.1 to 2.0.3 died at every start of the sim with an empty `work` folder (2026-10-31): the callback of a failed
  // open used a ticket the module had already freed.
  const disk = newDisk();
  const vault = await loadVault(disk, { callbackFailedOpens: true });
  await vault.settle();
  assert.equal(await askUntilAnswered(vault), 'q\n0\n');
  vault.send('MSFS_UI_VAULT_STATUS', 's');
  assert.ok(answers(vault, 'MSFS_UI_VAULT_STATE')[0]!.includes('\nreads 0 0\n'), 'a failed open is no read');
  vault.send('MSFS_UI_VAULT_SAVE', '1\n{"a":"1"}');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['1\nok']);

  // Slot a written, slot b still missing: its failed opens call back again at the next start, at both attempts.
  const again = await loadVault(disk, { callbackFailedOpens: true });
  await again.settle();
  assert.equal(await askUntilAnswered(again), 'q\n1\n{"a":"1"}');
  again.send('MSFS_UI_VAULT_STATUS', 's');
  assert.ok(answers(again, 'MSFS_UI_VAULT_STATE')[0]!.includes('\nreads 3 3\n'), answers(again, 'MSFS_UI_VAULT_STATE')[0]);
});

test('saves, then loads after a restart', { skip }, async () => {
  const disk = newDisk();
  const vault = await readyVault(disk);
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

/** A disk with two snapshots: seq 1 in slot a, seq 2 (the newest) in slot b. */
async function twoSnapshots(): Promise<Map<string, Uint8Array>> {
  const disk = newDisk();
  const vault = await loadVault(disk);
  await vault.settle();
  await askUntilAnswered(vault);
  vault.send('MSFS_UI_VAULT_SAVE', '1\nolder');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_SAVE', '2\nnewest');
  await vault.settle();
  return disk;
}

test('answers STATUS at once, before and after the start-up read', { skip }, async () => {
  const vault = await loadVault(await twoSnapshots());
  vault.send('MSFS_UI_VAULT_LOAD', 'q');
  vault.send('MSFS_UI_VAULT_STATUS', 's1');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_STATUS', 's2');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_STATE'), [
    // Both head reads wait (pending 2), the LOAD is deferred.
    's1\nready 0 phase 1 pending 2 deferred 1 attempts 1\nregistered 1 1 1\nreads 2 0\nheads 0 0 data 0 0\nreceived 1 0\naccepted 0',
    's2\nready 1 phase 2 pending 0 deferred 0 attempts 1\nregistered 1 1 1\nreads 4 4\nheads 1 1 data 1 1\nreceived 1 0\naccepted 2',
  ]);
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['q\n2\nnewest']);
});

// The sim gives the same answer for a missing file and a file it failed to open: one failure must never pass for an
// empty vault, whose first saves would then write over both slots (2.1.0 and before).
test('does not answer an empty vault when both heads fail to open once', { skip }, async () => {
  const disk = await twoSnapshots();
  const vault = await loadVault(disk, { refuseOpens: ['/work/vault-a.head', '/work/vault-b.head'] });
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', 'q');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), []);
  vault.refuseOpens.clear();
  assert.equal(await askUntilAnswered(vault), 'q\n2\nnewest');
  vault.send('MSFS_UI_VAULT_SAVE', '3\nafter');
  await vault.settle();
  assert.equal(dataOf(disk, 'a'), 'after');
  assert.equal(dataOf(disk, 'b'), 'newest', 'the loaded snapshot is untouched');
});

test('does not answer an empty vault when both heads read short once', { skip }, async () => {
  const vault = await loadVault(await twoSnapshots());
  vault.failReads.add('/work/vault-a.head');
  vault.failReads.add('/work/vault-b.head');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', 'q');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), []);
  vault.failReads.clear();
  assert.equal(await askUntilAnswered(vault, 3), 'q\n2\nnewest');
});

test('takes a file that cannot be opened twice as absent', { skip }, async () => {
  // Slot b never written: confirmed missing at the second attempt, slot a loaded.
  const disk = newDisk();
  const first = await loadVault(disk);
  await first.settle();
  await askUntilAnswered(first);
  first.send('MSFS_UI_VAULT_SAVE', '1\none');
  await first.settle();
  assert.equal(await loadedText(disk), 'q\n1\none');
});

test('waits for the newest snapshot when its data cannot be read, rather than answering an older one', { skip }, async () => {
  for (const failure of ['short read', 'refused open'] as const) {
    const disk = await twoSnapshots();
    const vault = await loadVault(disk);
    if (failure === 'short read') vault.failReads.add('/work/vault-b.data');
    else vault.refuseOpens.add('/work/vault-b.data');
    await vault.settle();
    assert.equal(await askUntilAnswered(vault, 4), undefined, `${failure}: no answer while the newest data cannot be read`);
    vault.failReads.clear();
    vault.refuseOpens.clear();
    assert.equal(await askUntilAnswered(vault, 3), 'q\n2\nnewest', failure);
  }
});

test('ends the start-up read with what it could read after 5 attempts', { skip }, async () => {
  const disk = newDisk();
  const first = await loadVault(disk);
  await first.settle();
  await askUntilAnswered(first);
  first.send('MSFS_UI_VAULT_SAVE', '4\nfour');
  await first.settle();
  first.send('MSFS_UI_VAULT_SAVE', '5\nfive');
  await first.settle();
  const vault = await loadVault(disk);
  vault.failReads.add('/work/vault-b.data');
  await vault.settle();
  assert.equal(await askUntilAnswered(vault, 20), 'q\n4\nfour');
  vault.send('MSFS_UI_VAULT_STATUS', 's');
  assert.match(answers(vault, 'MSFS_UI_VAULT_STATE')[0]!, /^s\nready 1 phase 2 pending 0 deferred 0 attempts 5\n/);
  // As in 2.1.0 then: the first write goes to the slot other than the loaded one.
  vault.send('MSFS_UI_VAULT_SAVE', '5\nnew five');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['5\nok']);
  assert.equal(dataOf(disk, 'a'), 'four', 'the loaded snapshot is untouched');
  assert.equal(await loadedText(disk), 'q\n5\nnew five');
});

test('keeps one deferred LOAD per request while the start-up read waits', { skip }, async () => {
  const disk = await twoSnapshots();
  const vault = await loadVault(disk, { loseReads: ['/work/vault-b.head'] });
  await vault.settle();
  vault.refuseOpens.add('/work/vault-b.head');
  for (let asked = 0; asked < 6; asked++) vault.send('MSFS_UI_VAULT_LOAD', 'q');
  await vault.settle();
  vault.send('MSFS_UI_VAULT_STATUS', 's');
  assert.match(answers(vault, 'MSFS_UI_VAULT_STATE')[0]!, /^s\nready 0 phase 1 pending \d+ deferred 1 /);
  vault.refuseOpens.clear();
  assert.equal(await askUntilAnswered(vault, 3), 'q\n2\nnewest');
  assert.equal(answers(vault, 'MSFS_UI_VAULT_LOADED').length, 1);
});

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

/** A start whose head reads wait, then end after the first LOAD while slot b's data read waits in turn. */
async function slowStart(): Promise<Harness> {
  const vault = await loadVault(await twoSnapshots(), { loseReads: ['/work/vault-a.head', '/work/vault-b.head'] });
  await vault.settle();
  vault.send('MSFS_UI_VAULT_LOAD', 'q1');
  vault.loseReads.add('/work/vault-b.data');
  vault.releaseLost();
  await vault.settle(); // both heads and slot a's data ended: the start-up read progressed since q1
  return vault;
}

test('keeps a slow start-up read that progressed since the previous LOAD', { skip }, async () => {
  const vault = await slowStart();
  vault.send('MSFS_UI_VAULT_LOAD', 'q2');
  vault.send('MSFS_UI_VAULT_STATUS', 's1');
  assert.match(answers(vault, 'MSFS_UI_VAULT_STATE')[0], /^s1\nready 0 phase 2 pending 1 deferred 2 attempts 1\n/, 'not restarted at the second LOAD');
  vault.releaseLost();
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['q1\n2\nnewest', 'q2\n2\nnewest']);
  vault.send('MSFS_UI_VAULT_STATUS', 's2');
  assert.match(answers(vault, 'MSFS_UI_VAULT_STATE')[1], /^s2\nready 1 phase 2 pending 0 deferred 0 attempts 1\nregistered 1 1 1\nreads 4 4\n/);
});

test('restarts a start-up read that progressed, then stopped', { skip }, async () => {
  const vault = await slowStart();
  vault.send('MSFS_UI_VAULT_LOAD', 'q2');
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), [], 'q2: progressing, kept waiting');
  vault.send('MSFS_UI_VAULT_LOAD', 'q3'); // nothing ended since q2: slot b's data read is lost
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['q1\n2\nnewest', 'q2\n2\nnewest', 'q3\n2\nnewest']);
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
  const vault = await readyVault(disk);
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
  const vault = await readyVault(disk, { stopAfter: 6 });
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
  const vault = await readyVault(disk);
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
  const vault = await readyVault(disk);
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
  const vault = await readyVault(newDisk());
  vault.send('MSFS_UI_VAULT_SAVE', '4\nhot');
  vault.send('MSFS_UI_VAULT_LOAD', '9');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['9\n4\nhot']);
});

test('refuses stale and oversize saves', { skip }, async () => {
  const disk = newDisk();
  const vault = await readyVault(disk);
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
  const vault = await readyVault(disk);
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
  const vault = await loadVault(await twoSnapshots());
  vault.send('MSFS_UI_VAULT_LOAD', '3');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), []);
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['3\n2\nnewest']);
});

// The sim calls back an open that failed, on file 0 (seen for reads, 2.0.4). Until 2.1.0 the write path went on in that
// callback with no snapshot, or with the next save's: it could truncate a slot and lose the loaded snapshot.
test('ignores the callback of a write open that failed', { skip }, async () => {
  const disk = await twoSnapshots(); // seq 1 in slot a, seq 2 (the newest) in slot b: the next write goes to slot a
  const vault = await readyVault(disk, { callbackFailedOpens: true });
  const slotB = [dataOf(disk, 'b'), headOf(disk, 'b')];
  vault.refuseWriteOpens.add('/work/vault-a.data');
  vault.send('MSFS_UI_VAULT_SAVE', '3\nthree');
  await vault.settle(); // the failed open's callback runs
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['3\nerror 4']);
  assert.deepEqual([dataOf(disk, 'b'), headOf(disk, 'b')], slotB, 'the newest snapshot untouched');
  vault.send('MSFS_UI_VAULT_LOAD', 'r');
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_LOADED'), ['r\n2\nnewest'], 'still loaded');
  vault.refuseWriteOpens.clear();
  vault.send('MSFS_UI_VAULT_SAVE', '3\nthree');
  await vault.settle();
  assert.equal(answers(vault, 'MSFS_UI_VAULT_SAVED')[1], '3\nok');
  assert.equal(dataOf(disk, 'b'), 'newest', 'written to the slot other than the loaded one');
  assert.equal(await loadedText(disk), 'q\n3\nthree');
});

test('does not let the callback of a failed write open fail the next save', { skip }, async () => {
  const disk = await twoSnapshots();
  const vault = await readyVault(disk, { callbackFailedOpens: true });
  vault.refuseWriteOpens.add('/work/vault-a.data');
  vault.send('MSFS_UI_VAULT_SAVE', '3\nthree'); // fails at once; its open is called back later
  vault.refuseWriteOpens.clear();
  vault.send('MSFS_UI_VAULT_SAVE', '3\nagain'); // the failed seq is free again: written while the late callback waits
  await vault.settle();
  assert.deepEqual(answers(vault, 'MSFS_UI_VAULT_SAVED'), ['3\nerror 4', '3\nok']);
  assert.equal(await loadedText(disk), 'q\n3\nagain');
});

test('keeps the last settled snapshot when the third save stops after its data and before its head', { skip }, async () => {
  const disk = newDisk();
  // Saves 1 and 2 take 4 callbacks each; save 3 writes slot a's data (open, write) and the sim stops before its head.
  const vault = await readyVault(disk, { stopAfter: 10 });
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

// Once the attempts are used up, a read that failed must still not lose a snapshot that was readable: the module writes
// the slot it did not load from (the test of 5 attempts above), or, with nothing loaded, the slot other than the one
// with the newest valid head.
test('does not write first onto the slot with the newest valid head when nothing could be read', { skip }, async () => {
  const disk = newDisk();
  const first = await readyVault(disk);
  first.send('MSFS_UI_VAULT_SAVE', '1\none');
  await first.settle();
  const vault = await loadVault(disk);
  vault.failReads.add('/work/vault-a.data');
  await vault.settle();
  assert.equal(await askUntilAnswered(vault, 20), 'q\n0\n');
  vault.send('MSFS_UI_VAULT_SAVE', '2\ntwo');
  await vault.settle();
  assert.equal(dataOf(disk, 'a'), 'one', 'slot a, possibly valid, is spared');
  assert.equal(dataOf(disk, 'b'), 'two');
  assert.equal(await loadedText(disk), 'q\n2\ntwo');
});
