import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VAULT_EVENTS, VAULT_MAX_BYTES, decodeLoaded, decodeSaved, decodeState, encodeSave, toAscii } from '../src/core/vault-protocol.ts';

describe('vault protocol', () => {
  it('names the events and the size limit', () => {
    assert.deepEqual(VAULT_EVENTS, {
      load: 'MSFS_UI_VAULT_LOAD',
      loaded: 'MSFS_UI_VAULT_LOADED',
      save: 'MSFS_UI_VAULT_SAVE',
      saved: 'MSFS_UI_VAULT_SAVED',
      status: 'MSFS_UI_VAULT_STATUS',
      state: 'MSFS_UI_VAULT_STATE',
    });
    assert.equal(VAULT_MAX_BYTES, 524288);
  });

  it('decodes a STATE answer on one line, without its NUL', () => {
    assert.deepEqual(decodeState('12\nready 1 phase 2\nreads 4 4\n\0'), { requestId: 12, state: 'ready 1 phase 2; reads 4 4' });
    assert.equal(decodeState('12'), null);
    assert.equal(decodeState('x\nready 1'), null);
    assert.equal(decodeState('12\n'), null);
  });

  it('toAscii keeps only characters up to 0x7F and JSON.parse gives the original back', () => {
    // Non-ASCII sample built from code points: the editor tools would turn escapes into raw characters.
    const text = `Air Cara${String.fromCharCode(0xef)}bes ${String.fromCharCode(0x5168, 0x65e5, 0x7a7a)} ${String.fromCharCode(0xd83d, 0xde00)} ${String.fromCharCode(0x2028)}`;
    const json = JSON.stringify({ t: text });
    const ascii = toAscii(json);
    for (let at = 0; at < ascii.length; at++) assert.ok(ascii.charCodeAt(at) <= 0x7f, `char ${at} is above 0x7F`);
    assert.notEqual(ascii, json);
    assert.deepEqual(JSON.parse(ascii), { t: text });
    assert.equal(toAscii('{"a":1}'), '{"a":1}');
  });

  it('encodeSave puts the seq, a newline and the text', () => {
    assert.equal(encodeSave(3, 'x'), '3\nx');
  });

  it('decodeLoaded reads the request id, the seq and the whole text', () => {
    assert.deepEqual(decodeLoaded('7\n2\n{"a":1}'), { requestId: 7, seq: 2, text: '{"a":1}' });
    assert.deepEqual(decodeLoaded('7\n2\na\nb\n'), { requestId: 7, seq: 2, text: 'a\nb\n' });
    assert.deepEqual(decodeLoaded('9\n0\n'), { requestId: 9, seq: 0, text: '' });
    assert.deepEqual(decodeLoaded('7\n2\n{"a":1}\0'), { requestId: 7, seq: 2, text: '{"a":1}' });
  });

  it('decodeLoaded refuses malformed payloads', () => {
    for (const payload of ['', '7', '7\n2', 'x\n2\n{}', '7\ny\n{}', '-1\n2\n{}', '7\n1.5\n{}']) assert.equal(decodeLoaded(payload), null, JSON.stringify(payload));
  });

  it('decodeSaved reads the seq and the status', () => {
    assert.deepEqual(decodeSaved('4\nok'), { seq: 4, status: 'ok' });
    assert.deepEqual(decodeSaved('4\nerror 5'), { seq: 4, status: 'error 5' });
    assert.deepEqual(decodeSaved('4\nstale\0'), { seq: 4, status: 'stale' });
    for (const payload of ['', '4', '4\n', 'x\nok', '-4\nok']) assert.equal(decodeSaved(payload), null, JSON.stringify(payload));
  });
});
