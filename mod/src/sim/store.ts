// The sim's data model, built the way the sim builds it: `UniversalProxy(new ReadableStore())`. Every path is a
// node: `node()` reads its value, `node.request(param)` triggers an action, `node.watch(...)` follows changes.
// Paths read in pkgCore.se.js (sim 1.9.18) are listed in compat.json ("symbols").

import { ReadableStore } from '/Global/shared/store.js';
import { UniversalProxy } from '/Global/shared/utils.js';
import { logError } from '../core/log.ts';
import type { Scope } from '../core/scope.ts';

export interface StoreNode {
  (): Promise<any>;
  request(param?: string): Promise<unknown>;
  /** For an array: loads items [start, start + count[ and returns the total size. */
  requestRange(start: number, count: number): Promise<number>;
  getElement(index: number): Promise<any>;
  watch(id: string, callback: (value: any) => void): Promise<number>;
  unwatch(watcherId: number): boolean;
  [key: string]: any;
}

export const store = UniversalProxy(new ReadableStore()) as StoreNode;

/** Follows a value of the model until `scope` is disposed; the callback also receives the current value. */
export function watch<T>(scope: Scope, node: StoreNode, callback: (value: T) => void): void {
  let watcherId: number | undefined;
  let active = true;
  node
    .watch('msfs-ui', (value: T) => {
      if (active) callback(value);
    })
    .then(
      (id) => {
        if (active) watcherId = id;
        else node.unwatch(id);
      },
      (error: unknown) => logError('a watch on the data model failed', error),
    );
  scope.add(() => {
    active = false;
    if (watcherId !== undefined) node.unwatch(watcherId);
  });
}

/** Reads every item of an array of the model. */
export async function readArray<T>(node: StoreNode): Promise<T[]> {
  const total = await node.requestRange(0, 1000);
  const items: T[] = [];
  for (let i = 0; i < total; i++) items.push(await node.getElement(i));
  return items;
}

/** Translates a `TT:…` key with the sim's localisation (the key itself when unknown). */
export function translate(key: string): string {
  const top = window.top as unknown as { g_localization?: { Translate(key: string): string } } | null;
  const localization = top ? top.g_localization : undefined;
  return (localization && localization.Translate(key)) || key;
}

// ----- Types of the values read (partial) -----

export interface DataValue {
  value: number;
  valueStr: string;
  unit: string;
}
