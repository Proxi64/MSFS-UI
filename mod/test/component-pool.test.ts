import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Scope } from '../src/core/scope.ts';
import { PooledCells, type PoolSlot, type PooledCell } from '../src/sim/component-pool.ts';
import type { SimComponent } from '../src/sim/components.ts';

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Just enough of an element for the pool: a class, a style, children that move, and a place on the screen. */
class FakeElement {
  className = '';
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  rect: Rect = { top: 0, bottom: 0, left: 0, right: 0 };
  appendChild(child: FakeElement): FakeElement {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeElement): FakeElement {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  getBoundingClientRect(): Rect {
    return this.rect;
  }
}

interface Cell extends PooledCell<Cell> {
  index: number;
}

const asElement = (element: FakeElement) => element as unknown as HTMLElement;

/** A vertical list of `count` cells 100 pixels high, one under the other (along x: side by side). */
function cellsOf(count: number, axis: 'x' | 'y'): Cell[] {
  return Array.from({ length: count }, (_, index) => {
    const host = new FakeElement();
    host.rect = axis === 'y' ? { top: index * 100, bottom: index * 100 + 100, left: 0, right: 100 } : { top: 0, bottom: 100, left: index * 100, right: index * 100 + 100 };
    return { index, host: asElement(host), slot: null, card: null };
  });
}

describe('PooledCells', () => {
  let scope: Scope;
  let parent: FakeElement;
  let view: FakeElement;
  let kind: string;
  let created: string[];
  let assigned: number[];
  /** What the cards and the list were told, in order: `moved <card>` and `assigned <cell> <card>`. */
  let told: string[];
  let pooled: PooledCells<Cell>;

  beforeEach(() => {
    // One layout unit is one pixel: the margins are 300 and 600 pixels.
    (globalThis as { document?: unknown }).document = { createElement: () => new FakeElement(), documentElement: {} };
    (globalThis as { window?: unknown }).window = { innerHeight: 1080, getComputedStyle: () => ({ getPropertyValue: () => '1080' }) };
    scope = new Scope();
    parent = new FakeElement();
    view = new FakeElement();
    view.rect = { top: 0, bottom: 1000, left: 0, right: 1000 };
    kind = 'tile';
    created = [];
    assigned = [];
    told = [];
    pooled = new PooledCells<Cell>(scope, asElement(parent), {
      kind: () => kind,
      maker: (poolKind) => ({
        cardClass: `card-${poolKind}`,
        iconClass: `icon-${poolKind}`,
        create: (slot: PoolSlot<Cell>) => {
          created.push(poolKind);
          const id = created.length;
          slot.card = { element: asElement(new FakeElement()), id, moved: () => told.push(`moved ${id}`) } as unknown as SimComponent;
          pooled.markReady(slot);
        },
      }),
      assigned: (cell) => {
        assigned.push(cell.index);
        told.push(`assigned ${cell.index} ${(cell.card as unknown as { id: number }).id}`);
      },
    });
  });

  afterEach(() => {
    scope.dispose();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it('gives a slot to the cells within 300 pixels of the view, and to none farther', () => {
    const cells = cellsOf(30, 'y');
    pooled.materialize(cells, asElement(view), 'y');
    assert.deepEqual(assigned, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    assert.equal(created.length, 14);
    assert.equal(pooled.size, 14);
    assert.ok(cells[13]!.slot && cells[13]!.card, 'the slot and its card');
    assert.equal(cells[14]!.slot, null);
  });

  it('takes the slots back beyond 600 pixels and gives them to the cells coming into view, without making new ones', () => {
    const cells = cellsOf(30, 'y');
    pooled.materialize(cells, asElement(view), 'y');
    view.rect = { top: 2000, bottom: 3000, left: 0, right: 1000 };
    pooled.materialize(cells, asElement(view), 'y');
    assert.equal(cells[12]!.slot, null, '700 pixels away: released');
    assert.ok(cells[13]!.slot, '600 pixels away: kept');
    assert.ok(cells[16]!.slot && cells[29]!.slot, 'cells 16 to 29 come into view (16 is 300 pixels away)');
    assert.equal(created.length, 15, 'the 13 parked slots are reused: one new slot for the 14 cells');
  });

  it('tells a reused card it moved before the cell it now shows draws it (its Selected state is sent again)', () => {
    pooled.materialize(cellsOf(3, 'y'), asElement(view), 'y');
    // A new list (another aircraft): every slot parked, then given to the new cells, the last parked first.
    pooled.releaseAll();
    assert.deepEqual(told.slice(-3), ['moved 1', 'moved 2', 'moved 3'], 'parked');
    told = [];
    pooled.materialize(cellsOf(3, 'y'), asElement(view), 'y');
    assert.deepEqual(told, ['moved 3', 'assigned 0 3', 'moved 2', 'assigned 1 2', 'moved 1', 'assigned 2 1']);
  });

  it('makes a new pool for another kind of component, the old one going with its slots', () => {
    const cells = cellsOf(5, 'y');
    pooled.materialize(cells, asElement(view), 'y');
    pooled.releaseAll();
    cells.forEach((cell) => pooled.release(cell));
    kind = 'row';
    pooled.materialize(cells, asElement(view), 'y');
    assert.deepEqual(created, ['tile', 'tile', 'tile', 'tile', 'tile', 'row', 'row', 'row', 'row', 'row']);
    assert.equal(parent.children.filter((child) => child.className === 'msfs-ui-pool').length, 2, 'one parking and one staging');
  });

  it('measures along x when the list scrolls sideways', () => {
    const cells = cellsOf(30, 'x');
    pooled.materialize(cells, asElement(view), 'x');
    assert.equal(created.length, 14);
  });

  it('does nothing while the view has no size', () => {
    view.rect = { top: 0, bottom: 0, left: 0, right: 0 };
    pooled.materialize(cellsOf(5, 'y'), asElement(view), 'y');
    assert.equal(created.length, 0);
  });
});
