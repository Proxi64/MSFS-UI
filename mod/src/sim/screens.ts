// Hooks into the sim's screens. Every component has a manipulator class, registered in `GuidToManipulator` before the
// mod loads; its `onActivation` / `onDeactivation` are wrapped once per screen, and each activation is dispatched
// to the features that asked for it.

import { GuidToManipulator, type ManipulatorClass } from '/Global/engine_ui.bundle.js';
import { logError } from '../core/log.ts';
import { root } from '../core/runtime.ts';
import type { Scope } from '../core/scope.ts';

/** Manipulator instance; `elt` is the component's root element. */
export interface Manipulator {
  elt: HTMLElement;
}

/** Screens the mod hooks (GUIDs and class names are listed in compat.json, "screens"). */
export const SCREENS = {
  freeFlight: '{3C7A4EC5-E7F6-4761-B27F-A0EA89C0F081}',
  planeSelection: '{7822664D-7F34-4A46-904A-F82929865103}',
} as const;

export type ScreenGuid = (typeof SCREENS)[keyof typeof SCREENS];

type OnActive = (manipulator: Manipulator, scope: Scope) => void;

interface ScreenHook {
  readonly cls: ManipulatorClass;
  /** Subscriptions, with the scope that owns each one. */
  readonly listeners: Map<OnActive, Scope>;
  /** Active manipulators, with the scope of each subscription for that activation. */
  readonly active: Map<Manipulator, Map<OnActive, Scope>>;
}

const hooks = new Map<string, ScreenHook>();

/**
 * Calls `onActive(manipulator, scope)` whenever the screen is activated, until `owner` is disposed. `scope` is
 * disposed when the screen is deactivated. A screen already on display (hot reload) is handled at once.
 * Returns false when the screen does not exist in this version of the sim (logged).
 */
export function onScreenActive(guid: ScreenGuid, owner: Scope, onActive: OnActive): boolean {
  const hook = hookScreen(guid);
  if (!hook) return false;
  hook.listeners.set(onActive, owner);
  owner.add(() => {
    hook.listeners.delete(onActive);
    hook.active.forEach((scopes) => {
      const scope = scopes.get(onActive);
      scopes.delete(onActive);
      if (scope) scope.dispose();
    });
  });
  for (const manipulator of shownInstances(hook.cls)) {
    let scopes = hook.active.get(manipulator);
    if (!scopes) hook.active.set(manipulator, (scopes = new Map()));
    if (!scopes.has(onActive)) startListener(hook, scopes, manipulator, onActive, owner);
  }
  return true;
}

function hookScreen(guid: string): ScreenHook | undefined {
  const existing = hooks.get(guid);
  if (existing) return existing;
  const cls = GuidToManipulator.get(guid);
  if (!cls) {
    logError(`screen ${guid} not found: the sim may have changed (run the compatibility check)`);
    return undefined;
  }
  const hook: ScreenHook = { cls, listeners: new Map(), active: new Map() };
  hooks.set(guid, hook);
  root.add(() => hooks.delete(guid));

  root.patch(cls.prototype, 'onActivation', (original) =>
    function (this: Manipulator, ...args: unknown[]): unknown {
      const result = original ? original.apply(this, args) : undefined;
      activate(hook, this);
      return result;
    },
  );
  root.patch(cls.prototype, 'onDeactivation', (original) =>
    function (this: Manipulator, ...args: unknown[]): unknown {
      deactivate(hook, this);
      return original ? original.apply(this, args) : undefined;
    },
  );
  return hook;
}

function activate(hook: ScreenHook, manipulator: Manipulator): void {
  deactivate(hook, manipulator);
  const scopes = new Map<OnActive, Scope>();
  hook.active.set(manipulator, scopes);
  hook.listeners.forEach((owner, onActive) => startListener(hook, scopes, manipulator, onActive, owner));
}

function deactivate(hook: ScreenHook, manipulator: Manipulator): void {
  const scopes = hook.active.get(manipulator);
  if (!scopes) return;
  hook.active.delete(manipulator);
  scopes.forEach((scope) => scope.dispose());
}

function startListener(hook: ScreenHook, scopes: Map<OnActive, Scope>, manipulator: Manipulator, onActive: OnActive, owner: Scope): void {
  const scope = owner.child();
  scopes.set(onActive, scope);
  try {
    onActive(manipulator, scope);
  } catch (error) {
    logError(`a feature failed on screen ${hook.cls.name}`, error);
    scope.dispose();
  }
}

/** Instances of `cls` currently on display. */
function shownInstances(cls: ManipulatorClass): Manipulator[] {
  const instances: Manipulator[] = [];
  const elements = document.querySelectorAll('ui-resource-element');
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i] as HTMLElement & { manipulator?: Manipulator };
    const manipulator = element.manipulator;
    if (manipulator && manipulator instanceof (cls as unknown as Function) && isShown(element)) instances.push(manipulator);
  }
  return instances;
}

/**
 * Drawn on the screen: has a size and is not transparent, whatever its classes. The sim's runway card keeps the
 * `disabled` class (and `pointer-events: none`) while it is displayed, which `isShown` rules out.
 */
export function isOnScreen(element: HTMLElement | null): element is HTMLElement {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && parseFloat(window.getComputedStyle(element).opacity) > 0;
}

/** On display: has a size and no disabled ancestor. */
export function isShown(element: Element | null): element is HTMLElement {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && !element.closest('.disabled');
}
