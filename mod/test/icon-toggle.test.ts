import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { iconToggle } from '../src/core/icon-toggle.ts';
import { BOOKMARK_FULL_SVG } from '../src/core/icons.ts';
import { Scope } from '../src/core/scope.ts';

type Listener = (event: FakeEvent) => void;
interface FakeEvent {
  stopped: boolean;
  stopPropagation(): void;
}

/** Just enough of an element: attributes, classes, children, and a click that bubbles. */
class FakeElement {
  className = '';
  innerHTML = '';
  parentNode: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly classList = {
    contains: (name: string) => this.className.split(' ').indexOf(name) >= 0,
    add: (name: string) => {
      if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim();
    },
    remove: (name: string) => {
      this.className = this.className.split(' ').filter((part) => part && part !== name).join(' ');
    },
  };
  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeElement): FakeElement {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) || []).concat(listener));
  }
  removeEventListener(): void {}
  /** Dispatches `type` here and up the parents until a listener stops it. */
  click(): void {
    const event: FakeEvent = { stopped: false, stopPropagation: () => (event.stopped = true) };
    for (let at: FakeElement | null = this; at && !event.stopped; at = at.parentNode) {
      for (const listener of at.listeners.get('click') || []) listener(event);
    }
  }
}

describe('iconToggle', () => {
  const saved = (globalThis as { document?: unknown }).document;
  beforeEach(() => {
    (globalThis as { document?: unknown }).document = { createElement: () => new FakeElement() };
  });
  afterEach(() => {
    (globalThis as { document?: unknown }).document = saved;
  });

  function make(kind: 'favorite' | 'hidden' = 'favorite') {
    const scope = new Scope();
    const parent = new FakeElement();
    const calls: boolean[] = [];
    const icon = iconToggle(scope, parent as unknown as Element, kind, (checked) => calls.push(checked));
    const element = icon.element as unknown as FakeElement;
    return { scope, parent, calls, icon, element };
  }

  it('is a button of the mod with the class of its kind and an SVG in currentColor', () => {
    const { parent, element } = make('hidden');
    assert.equal(element.parentNode, parent);
    assert.equal(element.className, 'msfs-ui-icon msfs-ui-icon--hidden');
    assert.ok(element.attributes.has('data-input-group'), 'the sim sends it clicks');
    assert.ok(element.innerHTML.indexOf('currentColor') > 0);
  });

  it('shows its state with the is-on class', () => {
    const { icon, element } = make();
    assert.equal(element.classList.contains('is-on'), false);
    icon.set(true);
    assert.equal(element.classList.contains('is-on'), true);
    icon.set(false);
    assert.equal(element.classList.contains('is-on'), false);
  });

  it('draws a full bookmark for a favourite and an empty one otherwise', () => {
    const { icon, element } = make();
    const empty = element.innerHTML;
    icon.set(true);
    assert.notEqual(element.innerHTML, empty);
    assert.ok(element.innerHTML.indexOf('evenodd') > 0);
    icon.set(false);
    assert.equal(element.innerHTML, empty);
  });

  it('cuts the star out of the disc under both fill rules and keeps no stroked ring under the disc', () => {
    const path = /<path d="(M16.6 11[^"]*)"/.exec(BOOKMARK_FULL_SVG)![1]!;
    const [disc, star] = path.split('z');
    // Signed area of the star polygon (y down): opposite to the disc's clockwise arc, so nonzero cuts it out too.
    const points = star!.split('L').map((part) => part.replace('M', '').trim().split(' ').map(Number));
    let area = 0;
    points.forEach((a, at) => {
      const b = points[(at + 1) % points.length]!;
      area += a[0]! * b[1]! - b[0]! * a[1]!;
    });
    assert.ok(area < 0, 'the star runs counter-clockwise');
    assert.ok(disc!.indexOf('1 1 0 11.2') > 0, 'the disc sweeps clockwise');
    assert.equal(BOOKMARK_FULL_SVG.indexOf('<circle'), -1);
  });

  it('asks for the opposite state at a click and does not let the click reach the tile under it', () => {
    const { parent, calls, icon, element } = make();
    let reached = 0;
    parent.addEventListener('click', () => reached++);
    element.click();
    assert.deepEqual(calls, [true]);
    icon.set(true);
    element.click();
    assert.deepEqual(calls, [true, false]);
    assert.equal(reached, 0);
  });

  it('is removed with its scope', () => {
    const { scope, parent, element } = make();
    assert.equal(parent.children.length, 1);
    scope.dispose();
    assert.equal(parent.children.length, 0);
    assert.equal(element.parentNode, null);
  });
});
