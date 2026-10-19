import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { Scope } from '../src/core/scope.ts';

describe('Scope', () => {
  it('runs cleanups last in, first out, once', () => {
    const scope = new Scope();
    const order: number[] = [];
    scope.add(() => order.push(1));
    scope.add(() => order.push(2));
    scope.dispose();
    scope.dispose();
    assert.deepEqual(order, [2, 1]);
    assert.equal(scope.disposed, true);
  });

  it('runs a cleanup at once when added to a disposed scope', () => {
    const scope = new Scope();
    scope.dispose();
    let ran = false;
    scope.add(() => (ran = true));
    assert.equal(ran, true);
  });

  it('carries on after a failing cleanup and logs it with the tag', () => {
    const error = mock.method(console, 'error', () => {});
    try {
      const scope = new Scope();
      let ran = false;
      scope.add(() => (ran = true));
      scope.add(() => {
        throw new Error('boom');
      });
      scope.dispose();
      assert.equal(ran, true);
      assert.equal(error.mock.callCount(), 1);
      assert.match(String(error.mock.calls[0]!.arguments[0]), /^\[msfs-ui\] a cleanup failed: boom/);
    } finally {
      error.mock.restore();
    }
  });

  it('disposes children with the parent', () => {
    const parent = new Scope();
    const child = parent.child();
    let ran = false;
    child.add(() => (ran = true));
    parent.dispose();
    assert.equal(ran, true);
    assert.equal(child.disposed, true);
  });

  it('forgets a child disposed on its own (no growth of the parent)', () => {
    const parent = new Scope();
    for (let i = 0; i < 100; i++) parent.child().dispose();
    assert.equal((parent as unknown as { cleanups: unknown[] }).cleanups.length, 0);
  });

  describe('patch', () => {
    it('wraps a method and restores it', () => {
      const target = { greet: (name: string) => `hello ${name}` };
      const original = target.greet;
      const scope = new Scope();
      scope.patch(target, 'greet', (greet) => (name: string) => greet(name).toUpperCase());
      assert.equal(target.greet('you'), 'HELLO YOU');
      scope.dispose();
      assert.equal(target.greet, original);
    });

    it('keeps patches stacked on top working when an inner one is disposed first', () => {
      const target = { value: () => 'base' };
      const inner = new Scope();
      const outer = new Scope();
      inner.patch(target, 'value', (value) => () => `${value()}+inner`);
      outer.patch(target, 'value', (value) => () => `${value()}+outer`);
      assert.equal(target.value(), 'base+inner+outer');
      inner.dispose();
      assert.equal(target.value(), 'base+outer');
      outer.dispose();
      assert.equal(target.value(), 'base');
    });

    it('restores an inherited method by removing the own property', () => {
      class Base {
        run(): string {
          return 'base';
        }
      }
      class Screen extends Base {}
      const scope = new Scope();
      scope.patch(Screen.prototype, 'run', (run) => function (this: Screen) {
        return `${run.call(this)}+patched`;
      });
      assert.equal(new Screen().run(), 'base+patched');
      scope.dispose();
      assert.equal(Object.prototype.hasOwnProperty.call(Screen.prototype, 'run'), false);
      assert.equal(new Screen().run(), 'base');
    });

    it('keeps `this` and handles a missing original method', () => {
      const target: { hook?: (this: { name: string }) => string; name: string } = { name: 'screen' };
      const scope = new Scope();
      scope.patch(target, 'hook', (original) => function (this: { name: string }) {
        return `${original ? 'with' : 'without'} original, on ${this.name}`;
      });
      assert.equal(target.hook!(), 'without original, on screen');
      scope.dispose();
      assert.equal('hook' in target, false);
    });
  });

  it('removes event listeners, with their capture flag', () => {
    const target = new EventTarget();
    const scope = new Scope();
    let calls = 0;
    scope.listen(target, 'ping', () => calls++, { capture: true });
    target.dispatchEvent(new Event('ping'));
    scope.dispose();
    target.dispatchEvent(new Event('ping'));
    assert.equal(calls, 1);
  });

  it('clears timers', async () => {
    const scope = new Scope();
    let ticks = 0;
    scope.interval(() => ticks++, 1);
    scope.timeout(() => (ticks += 100), 1);
    scope.dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(ticks, 0);
  });
});
