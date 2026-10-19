// Everything the mod changes in the sim goes through a Scope, so that it can be undone: when a screen closes, when a
// feature fails to start, and when a hot reload replaces the whole mod (the new version unloads the old one first).

import { logError } from './log.ts';

export type Cleanup = () => void;

type Method = ((...args: any[]) => any) | undefined;
/** Keys of `T` that hold a method (possibly absent). */
export type MethodKey<T> = { [K in keyof T]-?: T[K] extends Method ? K : never }[keyof T];

/** A group of cleanups undone together, last in, first out. */
export class Scope {
  private readonly cleanups: Cleanup[] = [];
  private isDisposed = false;
  /** Set on a child: drops its entry from the parent once it is disposed on its own. */
  private detach: Cleanup | undefined;

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Runs `cleanup` when the scope is disposed, or at once if it already is. */
  add(cleanup: Cleanup): void {
    if (this.isDisposed) run(cleanup);
    else this.cleanups.push(cleanup);
  }

  /** A sub-group, disposed with this one or earlier by its own `dispose`. */
  child(): Scope {
    const child = new Scope();
    const disposeChild = () => child.dispose();
    this.add(disposeChild);
    child.detach = () => {
      const at = this.cleanups.indexOf(disposeChild);
      if (at >= 0) this.cleanups.splice(at, 1);
    };
    return child;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    while (this.cleanups.length > 0) run(this.cleanups.pop()!);
    if (this.detach) this.detach();
  }

  /**
   * Replaces the method `target[key]` by `wrap(original)` until the scope is disposed. Patches by other scopes may
   * stack on top: on dispose, a patch that is no longer the outermost one is not removed (that would also remove the
   * patches above it) but becomes inert, calling straight through to the original.
   */
  patch<T extends object, K extends MethodKey<T>>(target: T, key: K, wrap: (original: T[K]) => T[K]): void {
    const own = Object.prototype.hasOwnProperty.call(target, key);
    const original = target[key];
    const replacement = wrap(original);
    let active = true;
    const installed = function (this: unknown, ...args: unknown[]): unknown {
      const method = (active ? replacement : original) as Method;
      return method ? method.apply(this, args) : undefined;
    } as unknown as T[K];
    target[key] = installed;
    this.add(() => {
      active = false;
      if (target[key] !== installed) return;
      // An inherited method is restored by removing the own property, so later changes to the parent still show.
      if (own) target[key] = original;
      else delete target[key];
    });
  }

  listen<K extends keyof DocumentEventMap>(target: Document, type: K, listener: (event: DocumentEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  listen<K extends keyof WindowEventMap>(target: Window, type: K, listener: (event: WindowEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  listen(target: EventTarget, type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void;
  listen(target: EventTarget, type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void {
    target.addEventListener(type, listener, options);
    const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
    this.add(() => target.removeEventListener(type, listener, capture));
  }

  /** Subscribes to an event of the sim's engine (`engine.on`), for example `mousePressOutsideView`. */
  onEngine(event: string, handler: (...args: any[]) => void): void {
    const subscription = engine.on(event, handler);
    this.add(() => {
      if (subscription) subscription.clear();
    });
  }

  interval(callback: () => void, ms: number): void {
    const id = setInterval(callback, ms);
    this.add(() => clearInterval(id));
  }

  timeout(callback: () => void, ms: number): void {
    const id = setTimeout(callback, ms);
    this.add(() => clearTimeout(id));
  }

  /** Appends `child` to `parent`; removed when the scope is disposed. */
  append<E extends Node>(parent: Node, child: E): E {
    parent.appendChild(child);
    this.add(() => {
      if (child.parentNode) child.parentNode.removeChild(child);
    });
    return child;
  }
}

function run(cleanup: Cleanup): void {
  try {
    cleanup();
  } catch (error) {
    logError('a cleanup failed', error);
  }
}
