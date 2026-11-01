// Components of a list recycled as it scrolls, as the sim's own grid does. Creating one of the sim's tiles means loading
// its template and image, then laying the page out again: a list that creates and destroys its tiles while scrolling
// stutters as if loading all the time. A pool creates a few slots (a card and its icon) and moves them between the
// cells near the view; a slot far from it waits in a hidden parking (out of the layout). Moving a slot keeps the
// component loaded and active (measured on 1.9.21: 4.8 ms with the layout).

import { el, uiUnit } from '../core/dom.ts';
import type { IconToggle } from '../core/icon-toggle.ts';
import type { Scope } from '../core/scope.ts';
import { cellAction, type Extent } from '../core/virtual-list.ts';
import type { SimComponent } from './components.ts';

/** A card and its icon, in hosts that move from cell to cell (`cardHost` and `iconHost`, appended to a cell's host). */
export interface PoolSlot<T> {
  readonly cardHost: HTMLElement;
  readonly iconHost: HTMLElement;
  card: SimComponent | null;
  icon: IconToggle | null;
  /** What the slot shows now (null while parked). */
  item: T | null;
  /** The host it belongs in (null while parked); a new slot joins it once its components are made. */
  host: HTMLElement | null;
}

/** How a pool makes its slots: the classes of their two hosts (the list's CSS sizes them), and their components. */
export interface PoolSlotMaker<T> {
  readonly cardClass: string;
  readonly iconClass: string;
  /** Makes the slot's components in its hosts, once per slot. */
  create(slot: PoolSlot<T>, scope: Scope): void;
}

export class ComponentPool<T> {
  private readonly scope: Scope;
  private readonly parking: HTMLElement;
  /** Where new slots make their components, out of sight: a list may drop its hosts meanwhile. */
  private readonly staging: HTMLElement;
  private readonly maker: PoolSlotMaker<T>;
  private readonly slots: PoolSlot<T>[] = [];
  private readonly free: PoolSlot<T>[] = [];
  /** Slots whose components are made: only these move (the sim refuses a component moved while it sets up). */
  private readonly ready: PoolSlot<T>[] = [];
  /** Slots released while still loading: parked once ready. */
  private readonly pending: PoolSlot<T>[] = [];

  /** `maker` makes the slots; `parent` holds the hidden parking. The slots are disposed with `scope`. */
  constructor(scope: Scope, parent: HTMLElement, maker: PoolSlotMaker<T>) {
    this.scope = scope;
    this.maker = maker;
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
      slot = { cardHost: el('div', this.maker.cardClass), iconHost: el('div', this.maker.iconClass), card: null, icon: null, item, host };
      this.slots.push(slot);
      this.staging.appendChild(slot.cardHost);
      this.staging.appendChild(slot.iconHost);
      this.maker.create(slot, this.scope);
      return slot;
    }
    slot.item = item;
    slot.host = host;
    host.appendChild(slot.cardHost);
    this.placeIcon(slot, host);
    return slot;
  }

  /**
   * The icon host follows the card: once made, the card's element holds it, so that the pointer on the
   * icon is still on the card (its Hover state stays) and the icon moves with the card; before, `parent` holds it.
   */
  private placeIcon(slot: PoolSlot<T>, parent: HTMLElement): void {
    if (slot.card && slot.iconHost.parentNode === slot.card.element) return;
    parent.appendChild(slot.iconHost);
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
      this.placeIcon(slot, slot.host);
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
    this.placeIcon(slot, this.parking);
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

/** A cell of a pooled list: its host keeps its place in the list, its slot and card are there while it is near the view. */
export interface PooledCell<C> {
  readonly host: HTMLElement;
  slot: PoolSlot<C> | null;
  card: SimComponent | null;
}

/** How a list's cells get their components. */
export interface PooledCellsOptions<C> {
  /** The kind of component the list shows now (tiles, rows…): another kind than the last one makes a new pool. */
  kind(): string;
  /** How the pool of a kind makes its slots. */
  maker(kind: string): PoolSlotMaker<C>;
  /** A cell got a slot: the list shows its item there (a slot still loading has no card yet: `create` shows it once ready). */
  assigned(cell: C): void;
  /** How near the visible part the cells get components (MARGINS when not given). */
  readonly margins?: PoolMargins;
}

/** Components are created for the cells within `create` of the visible part, and kept within `keep`, in layout units. */
export interface PoolMargins {
  create: number;
  keep: number;
}

/** The margins of the gallery's lists. */
const MARGINS: PoolMargins = { create: 300, keep: 600 };

/**
 * The components of a list's cells, kept only near its visible part (core/virtual-list.ts), in slots of a pool of the
 * current kind (made when first needed). Shared by the gallery, its livery column and the setup panel's strip.
 */
export class PooledCells<C extends PooledCell<C>> {
  private readonly owner: Scope;
  private readonly parent: HTMLElement;
  private readonly options: PooledCellsOptions<C>;
  private pool: ComponentPool<C> | null = null;
  private poolKind: string | null = null;
  private poolScope: Scope | null = null;

  /** The pools' slots are disposed with `owner`; `parent` holds their hidden parking. */
  constructor(owner: Scope, parent: HTMLElement, options: PooledCellsOptions<C>) {
    this.owner = owner;
    this.parent = parent;
    this.options = options;
  }

  /**
   * Gives the cells near `view` a slot and takes it back from those far from it, along the list's axis (`x`: the cells
   * come into view from the sides). The positions are all read before any change, so the engine lays the page out once.
   */
  materialize(cells: readonly C[], view: HTMLElement, axis: 'x' | 'y'): void {
    const extent = axis === 'x' ? (rect: DOMRect): Extent => ({ top: rect.left, bottom: rect.right }) : (rect: DOMRect): Extent => rect;
    const visible = extent(view.getBoundingClientRect());
    if (visible.bottom - visible.top <= 0) return;
    const unit = uiUnit();
    const units = this.options.margins || MARGINS;
    const margins = { create: units.create * unit, keep: units.keep * unit };
    const actions = cells.map((cell) => cellAction(extent(cell.host.getBoundingClientRect()), cell.slot !== null, visible, margins));
    cells.forEach((cell, at) => {
      if (actions[at] === 'create') this.assign(cell);
      else if (actions[at] === 'destroy') this.release(cell);
    });
  }

  /** The cell's slot goes back to the pool's parking (the host keeps its place in the list). */
  release(cell: C): void {
    if (cell.slot && this.pool) this.pool.release(cell.slot);
    cell.slot = null;
    cell.card = null;
  }

  /** Every slot to the parking, items forgotten (a new list). */
  releaseAll(): void {
    if (this.pool) this.pool.releaseAll();
  }

  /** A slot's components are made (see ComponentPool.markReady). */
  markReady(slot: PoolSlot<C>): void {
    if (this.pool) this.pool.markReady(slot);
  }

  /** Number of slots of the current pool (for the checks). */
  get size(): number {
    return this.pool ? this.pool.size : 0;
  }

  /** The cell gets a slot of the pool (a parked one first). */
  private assign(cell: C): void {
    const slot = this.currentPool().acquire(cell.host, cell);
    cell.slot = slot;
    cell.card = slot.card;
    this.options.assigned(cell);
  }

  private currentPool(): ComponentPool<C> {
    const kind = this.options.kind();
    if (!this.pool || this.poolKind !== kind) {
      if (this.poolScope) this.poolScope.dispose();
      const scope = (this.poolScope = this.owner.child());
      this.poolKind = kind;
      this.pool = new ComponentPool<C>(scope, this.parent, this.options.maker(kind));
    }
    return this.pool;
  }
}
