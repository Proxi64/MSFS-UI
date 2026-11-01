// SimComponent's Selected state: sent to the sim's trait only when it changes, and queued again after the element
// moved (the sim drops a visual change made in the same task as a move, and does not queue the same flags twice:
// components.ts, moved). The sim's `/Global` module is stubbed by module hooks.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import type { Scope } from '../src/core/scope.ts';

const asModule = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const GLOBAL_STUBS: Record<string, string> = {
  '/Global/engine_ui.bundle.js': 'export function AttachTrait() { return false; } export const GuidToTrait = {};',
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = GLOBAL_STUBS[specifier];
    return stub !== undefined ? { url: asModule(stub), shortCircuit: true } : nextResolve(specifier, context);
  },
});

const { SimComponent } = await import('../src/sim/components.ts');

/**
 * A component element whose selectable trait records what it is sent (`Set <value>`), and whose visual flags record
 * what is queued for the sim's visual pass (`queued <value>`: only a flag that changes, as the sim's updateVisual).
 */
function fakeComponent(selected: boolean) {
  const sent: string[] = [];
  const flags = { selected };
  const element = {
    updateVisual: (change: { selected: boolean }) => {
      if (flags.selected === change.selected) return;
      flags.selected = change.selected;
      sent.push(`queued ${change.selected}`);
    },
    traits: {
      selectable: {
        selected,
        isSelected: () => element.traits.selectable.selected,
        Set: (value: boolean) => {
          element.traits.selectable.selected = value;
          sent.push(`Set ${value}`);
          element.updateVisual({ selected: value });
        },
      },
    },
  };
  return { component: new SimComponent(element as unknown as HTMLElement, {} as Scope), sent, flags };
}

describe('SimComponent.select', () => {
  it('sends the Selected state only when the trait has another one', () => {
    const { component, sent } = fakeComponent(false);
    component.select(false);
    component.select(true);
    component.select(true);
    component.select(false);
    assert.deepEqual(sent, ['Set true', 'queued true', 'Set false', 'queued false']);
  });

  it('queues it again once after the element moved, even when the trait and the flags already have it', () => {
    const { component, sent, flags } = fakeComponent(false);
    component.moved();
    component.select(false);
    component.select(false);
    assert.deepEqual(sent, ['queued true', 'Set false', 'queued false'], 'the other value first: the change is queued again');
    assert.equal(flags.selected, false);
    sent.length = 0;
    component.moved();
    component.select(true);
    assert.deepEqual(sent, ['Set true', 'queued true'], 'a real change is queued as it is');
  });
});
