// Runs the real vault module (wasm/dist/msfs-ui.wasm) with fake sim imports: a disk in memory, an I/O queue whose
// callbacks run in settle(), and a CommBus whose answers are collected in `sent`.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const wasmPath = fileURLToPath(new URL('../dist/msfs-ui.wasm', import.meta.url));
export const wasmBuilt = existsSync(wasmPath);

export interface Harness {
  /** Delivers a CommBus message to the module (as the menu would). */
  send(event: string, text: string): void;
  /** Runs the queued I/O callbacks (and those they queue) until none is left. */
  settle(): Promise<void>;
  /** What the module sent on the CommBus, in order. */
  sent: { event: string; text: string }[];
  /** Paths of the files the module wrote (one entry per write that reached the disk). */
  writes: string[];
  /** While true, every write fails (fsIOWrite answers an error). */
  failWrites: boolean;
  /** Drops every queued callback: the sim stopped now. */
  crash(): void;
}

export interface LoadOptions {
  /** The instance freezes (drops its queued callbacks) once this many I/O callbacks have run. */
  stopAfter?: number;
}

const OPEN_FLAGS = { RDONLY: 1, WRONLY: 2, RDWR: 4, CREAT: 8, TRUNC: 16 };

interface Exports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  __indirect_function_table: WebAssembly.Table;
  __wasm_call_ctors(): void;
  module_init(): void;
}

export async function loadVault(disk: Map<string, Uint8Array>, options: LoadOptions = {}): Promise<Harness> {
  const module = new WebAssembly.Module(readFileSync(wasmPath));
  const sent: { event: string; text: string }[] = [];
  const writes: string[] = [];
  const queue: (() => void)[] = [];
  const handles = new Map<bigint, { path: string; writable: boolean }>();
  const callbacks = new Map<string, number>(); // CommBus event -> table index
  let nextHandle = 1n;
  let executed = 0;
  let frozen = false;
  let failWrites = false;
  let exports!: Exports;

  const text = (pointer: number, length?: number) => {
    const bytes = new Uint8Array(exports.memory.buffer);
    let end = pointer;
    if (length === undefined) while (bytes[end] !== 0) end++;
    else end = pointer + length;
    return Buffer.from(bytes.subarray(pointer, end)).toString('utf8');
  };
  const call = (index: number, ...args: unknown[]) => (exports.__indirect_function_table.get(index) as (...a: unknown[]) => unknown)(...args);
  const enqueue = (task: () => void) => {
    if (!frozen) queue.push(task);
  };
  const open = (path: string, flags: number, writable: boolean) => {
    const handle = nextHandle++;
    handles.set(handle, { path, writable });
    return handle;
  };

  const fakes: Record<string, (...args: any[]) => unknown> = {
    fsIOOpen(pathPointer: number, flags: number, callback: number, user: number) {
      const path = text(pathPointer);
      const write = (flags & (OPEN_FLAGS.WRONLY | OPEN_FLAGS.RDWR)) !== 0;
      if (!disk.has(path) && !(write && flags & OPEN_FLAGS.CREAT)) return 0n;
      const handle = open(path, flags, write);
      enqueue(() => {
        if (write) {
          if (flags & OPEN_FLAGS.TRUNC || !disk.has(path)) disk.set(path, new Uint8Array(0));
        }
        call(callback, handle, user);
      });
      return handle;
    },
    fsIOOpenRead(pathPointer: number, flags: number, offset: number, count: number, callback: number, user: number) {
      const path = text(pathPointer);
      const file = disk.get(path);
      if (file === undefined || count > file.length) return 0n;
      const handle = open(path, flags, false);
      enqueue(() => {
        const buffer = exports.malloc(Math.max(count, 1)); // the sim's buffer: never freed by the module
        new Uint8Array(exports.memory.buffer).set(file.subarray(offset, offset + count), buffer);
        call(callback, handle, buffer, offset, count, user);
      });
      return handle;
    },
    fsIOWrite(handle: bigint, bufferPointer: number, offset: number, count: number, callback: number, user: number) {
      const file = handles.get(handle);
      if (failWrites) return 1; // FsIOErr_BadParams
      if (file === undefined || !file.writable) return 4; // FsIOErr_FileNotOpened
      const data = new Uint8Array(exports.memory.buffer).slice(bufferPointer, bufferPointer + count);
      enqueue(() => {
        const current = disk.get(file.path) ?? new Uint8Array(0);
        const next = new Uint8Array(Math.max(current.length, offset + count));
        next.set(current);
        next.set(data, offset);
        disk.set(file.path, next);
        writes.push(file.path);
        call(callback, handle, bufferPointer, offset, count, user);
      });
      return 0;
    },
    fsIOClose(handle: bigint) {
      return handles.delete(handle) ? 0 : 4;
    },
    fsIOGetLastError() {
      return 0;
    },
    fsCommBusRegister(namePointer: number, callback: number, context: number) {
      callbacks.set(text(namePointer), callback);
      callbacks.set(`${text(namePointer)}\0ctx`, context);
      return 1;
    },
    fsCommBusCall(namePointer: number, bufferPointer: number, size: number) {
      sent.push({ event: text(namePointer), text: text(bufferPointer, size) });
      return 1;
    },
  };

  const imports: WebAssembly.Imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    imports[entry.module] ??= {};
    imports[entry.module][entry.name] = fakes[entry.name] ?? (() => 0);
  }
  const instance = new WebAssembly.Instance(module, imports);
  exports = instance.exports as unknown as Exports;
  exports.__wasm_call_ctors();
  exports.module_init();

  return {
    sent,
    writes,
    get failWrites() {
      return failWrites;
    },
    set failWrites(value: boolean) {
      failWrites = value;
    },
    send(event, message) {
      const callback = callbacks.get(event);
      if (callback === undefined) throw new Error(`no callback registered for ${event}`);
      const bytes = Buffer.from(message, 'utf8');
      const pointer = exports.malloc(Math.max(bytes.length, 1));
      new Uint8Array(exports.memory.buffer).set(bytes, pointer);
      call(callback, pointer, bytes.length, callbacks.get(`${event}\0ctx`) ?? 0);
      exports.free(pointer);
    },
    async settle() {
      while (queue.length > 0) {
        const task = queue.shift()!;
        task();
        executed++;
        if (options.stopAfter !== undefined && executed >= options.stopAfter) {
          frozen = true;
          queue.length = 0;
        }
        await Promise.resolve();
      }
    },
    crash() {
      frozen = true;
      queue.length = 0;
    },
  };
}
