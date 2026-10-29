// The messages exchanged with the vault module (wasm/, built by 2.0 step 1) over the sim's CommBus. Text only; the
// module's side is described in wasm/README.md.
//   LOAD   <requestId>
//   LOADED <requestId> \n <seq> \n <text>   (seq 0 and an empty text when nothing is stored; the text may hold newlines)
//   SAVE   <seq> \n <text>
//   SAVED  <seq> \n <status>                (ok, stale, too-big, or "error <code>")

export const VAULT_EVENTS = {
  load: 'MSFS_UI_VAULT_LOAD',
  loaded: 'MSFS_UI_VAULT_LOADED',
  save: 'MSFS_UI_VAULT_SAVE',
  saved: 'MSFS_UI_VAULT_SAVED',
} as const;

/** The largest snapshot the module accepts. */
export const VAULT_MAX_BYTES = 524288;

const NON_ASCII = new RegExp('[^\\x00-\\x7F]', 'g');
const BACKSLASH_U = String.fromCharCode(92) + 'u';

/** `text` with every character above 0x7F written as a JSON escape: the snapshot is then plain ASCII and parses to the same value. */
export function toAscii(text: string): string {
  return text.replace(NON_ASCII, (char) => BACKSLASH_U + ('0000' + char.charCodeAt(0).toString(16)).slice(-4));
}

export function encodeSave(seq: number, text: string): string {
  return `${seq}\n${text}`;
}

/** The sim may deliver a module's answer with its terminating NUL. */
function withoutNul(payload: string): string {
  return payload.endsWith('\0') ? payload.slice(0, -1) : payload;
}

const COUNT = /^\d+$/;

export function decodeLoaded(payload: string): { requestId: number; seq: number; text: string } | null {
  const text = withoutNul(payload);
  const first = text.indexOf('\n');
  if (first < 0) return null;
  const second = text.indexOf('\n', first + 1);
  if (second < 0) return null;
  const requestId = text.slice(0, first);
  const seq = text.slice(first + 1, second);
  if (!COUNT.test(requestId) || !COUNT.test(seq)) return null;
  return { requestId: Number(requestId), seq: Number(seq), text: text.slice(second + 1) };
}

export function decodeSaved(payload: string): { seq: number; status: string } | null {
  const text = withoutNul(payload);
  const at = text.indexOf('\n');
  if (at < 0) return null;
  const seq = text.slice(0, at);
  const status = text.slice(at + 1);
  if (!COUNT.test(seq) || !status) return null;
  return { seq: Number(seq), status };
}
