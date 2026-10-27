// Components of a list recycled as it scrolls, as the sim's own grid does. Creating one of the sim's tiles means loading
// its template and image, then laying the page out again: a list that creates and destroys its tiles while scrolling
// stutters as if loading all the time. A pool creates a few slots (a card and its heart) and moves them between the
// cells near the view; a slot far from it waits in a hidden parking (out of the layout). Moving a slot keeps the
// component loaded and active (measured on 1.9.18: 4.8 ms with the layout).

import { el } from '../core/dom.ts';
import type { Scope } from '../core/scope.ts';
import type { SimComponent } from './components.ts';

/** A card and its heart, in hosts that move from cell to cell (`cardHost` and `heartHost`, appended to a cell's host). */
export interface PoolSlot<T> {
  readonly cardHost: HTMLElement;
  readonly heartHost: HTMLElement;
  card: SimComponent | null;
  heart: SimComponent | null;
  /** What the slot shows now (null while parked). */
  item: T | null;
  /** The host it belongs in (null while parked); a new slot joins it once its components are made. */
  host: HTMLElement | null;
}

export class ComponentPool<T> {
  private readonly scope: Scope;
  private readonly parking: HTMLElement;
  /** Where new slots make their components, out of sight: a list may drop its hosts meanwhile. */
  private readonly staging: HTMLElement;
  private readonly create: (slot: PoolSlot<T>, scope: Scope) => void;
  private readonly slots: PoolSlot<T>[] = [];
  private readonly free: PoolSlot<T>[] = [];
  /** Slots whose components are made: only these move (the sim refuses a component moved while it sets up). */
  private readonly ready: PoolSlot<T>[] = [];
  /** Slots released while still loading: parked once ready. */
  private readonly pending: PoolSlot<T>[] = [];

  /**
   * `create` makes the slot's components in its hosts (once per slot); `parent` holds the hidden parking. The slots
   * are disposed with `scope`.
   */
  constructor(scope: Scope, parent: HTMLElement, create: (slot: PoolSlot<T>, scope: Scope) => void) {
    this.scope = scope;
    this.create = create;
    this.parking = el('div', 'msfs-ui-pool');
    this.parking.style.display = 'none';
    scope.append(parent, this.parking);
    this.staging = el('div', 'msfs-ui-pool');
    this.staging.style.cssText = 'position: absolute; left: 0; top: 0; width: 300px; height: 200px; overflow: hidden; visibility: hidden; pointer-events: none';
    scope.append(parent, this.staging);
  }

  /**
   * A slot for `item` in `host`: a parked one (the one that showed `item` if any), moved there at once; or a new one,
   * which makes its components out of sight and joins `host` when ready (`markReady`).
   */
  acquire(host: HTMLElement, item: T): PoolSlot<T> {
    let at = -1;
    for (let i = 0; i < this.free.length && at < 0; i++) if (this.free[i]!.item === item) at = i;
    if (at < 0 && this.free.length > 0) at = this.free.length - 1;
    let slot: PoolSlot<T>;
    if (at >= 0) {
      slot = this.free.splice(at, 1)[0]!;
    } else {
      slot = { cardHost: el('div', 'msfs-ui-gal__card'), heartHost: el('div', 'msfs-ui-gal__heart'), card: null, heart: null, item, host };
      this.slots.push(slot);
      this.staging.appendChild(slot.cardHost);
      this.staging.appendChild(slot.heartHost);
      this.create(slot, this.scope);
      return slot;
    }
    slot.item = item;
    slot.host = host;
    host.appendChild(slot.cardHost);
    host.appendChild(slot.heartHost);
    return slot;
  }

  /** The slot's components are made: it may move from now on (and goes to the parking if released meanwhile). */
  markReady(slot: PoolSlot<T>): void {
    if (this.ready.indexOf(slot) < 0) this.ready.push(slot);
    const at = this.pending.indexOf(slot);
    if (at >= 0) {
      this.pending.splice(at, 1);
      this.release(slot);
    } else if (slot.host) {
      slot.host.appendChild(slot.cardHost);
      slot.host.appendChild(slot.heartHost);
    }
  }

  /** The slot goes to the parking; it keeps its item, so the same cell gets it back first. A slot still loading stays where it is until ready. */
  release(slot: PoolSlot<T>): void {
    if (this.free.indexOf(slot) >= 0) return;
    slot.host = null;
    if (this.ready.indexOf(slot) < 0) {
      if (this.pending.indexOf(slot) < 0) this.pending.push(slot);
      return;
    }
    this.parking.appendChild(slot.cardHost);
    this.parking.appendChild(slot.heartHost);
    this.free.push(slot);
  }

  /** Every slot to the parking, items forgotten (a new list); one still loading follows once ready. */
  releaseAll(): void {
    for (const slot of this.slots) {
      this.release(slot);
      slot.item = null;
    }
  }

  /** Number of slots created (for the log and the checks). */
  get size(): number {
    return this.slots.length;
  }
}
