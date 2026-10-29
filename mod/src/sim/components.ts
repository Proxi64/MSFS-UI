// The sim's own components (cookedcomps), created by the mod so that what it adds looks and behaves exactly like the
// sim: same markup, visual states (hover, selected, disabled), sounds and accessibility. Verified on sim 1.9.18:
// `window.ResourcesManager.createElementFromGuid(guid, factory)` builds the component from its cooked template; once
// loaded, its manipulator is activated, as the sim does for the components it creates on the fly.
// Every component used is listed in compat.json ("components") with the attributes, states and values the mod uses.

import { AttachTrait, GuidToTrait, type TraitClass } from '/Global/engine_ui.bundle.js';
import { withTimeout } from '../core/async.ts';
import { logError } from '../core/log.ts';
import type { Scope } from '../core/scope.ts';

/** Components the mod creates, by GUID (compat.json, "components"). */
export const COMPONENTS = {
  /** Choice tile: Live / Preset / Custom, traffic and multiplayer in the sim's Flight Conditions panel. */
  tileButton: '{68CB981E-3551-4AB9-8C2C-54470940600B}',
  /** Square button with one of the sim's icons. */
  iconButtonSquared: '{4DA5F24F-8B9F-4157-8700-19F5E06B68E9}',
  /** Tab: Runways / Frequencies of the sim's airport card. */
  textTab: '{B3646052-B1D6-44DA-854F-F3C6301FE03C}',
  /** Flight category (VFR, MVFR, IFR, LIFR) with its colour, as on the sim's airport card. */
  flightRules: '{6C8546B4-5DC2-4565-8344-02BEC2D16F6B}',
  /** Small text button (Fuel, Identification…). */
  textButtonSmall: '{18790BAC-6BA6-45F1-A5B0-4719AAA02CAB}',
  /** Livery thumbnail button of the sim's configurator. */
  liveryButton: '{4F4F64CD-07F8-4B9C-8822-4E076700DB75}',
  /** The sim's aircraft tile (aircraft selection grid). */
  fleetTile: '{4624E83D-9CA8-48D6-B42C-FE4E2810951F}',
  /** Horizontal tile of the sim's marketplace: image, title, publisher. */
  horizontalTile: '{35A4F244-E2BB-4DF1-984E-BCBE663FC209}',
  /** The sim's dropdown list. */
  dropdown: '{3321B59E-EA1D-4C72-8D69-3F1BB530437C}',
  /** Text field of the sim (search fields); with `State_Input`, a plain input without the magnifier. */
  searchInput: '{996A0E75-BA4D-4EB4-BD27-683B1013B42C}',
} as const;

export type ComponentGuid = (typeof COMPONENTS)[keyof typeof COMPONENTS];

/** Time allowed for a component to load before its creation is given up. */
const LOAD_TIMEOUT_MS = 5000;

interface Loading {
  whenAllLoaded: Promise<unknown>;
}

/** A component element of the sim (`ui-resource-element`, class UIResourceBase of engine_ui.bundle.js). */
interface SimElement extends HTMLElement {
  loadingList: Loading;
  manipulator: { refLoadingPromise?: Loading; activate(): void; deactivate(): void } | null;
  traits: {
    selectable?: { Set(selected: boolean): void; isSelected(): boolean; unSetElementRef?(): void };
    deactivable?: { Set(disabled: boolean): void; isDisabled(): boolean };
  };
  setExposedAttribute(name: string, value: string): void;
  getExposedValue(name: string): unknown;
  updateVisual(change: Record<string, boolean>): void;
}

interface ResourcesManager {
  createElementFromGuid(guid: string, factory: { createElementFromName(tag?: string): HTMLElement }): SimElement | undefined;
}

/** What `createElementFromGuid` needs to create the bare element; the template fills it. */
const ELEMENT_FACTORY = {
  createElementFromName: (tag?: string): HTMLElement => document.createElement(tag || 'ui-resource-element'),
};

/** A created component. Changes go through the sim's own traits, so the visual states stay the sim's. */
export class SimComponent {
  readonly element: HTMLElement;
  private readonly scope: Scope;
  private readonly attributes = new Map<string, string>();

  constructor(element: HTMLElement, scope: Scope) {
    this.element = element;
    this.scope = scope;
  }

  private get sim(): SimElement {
    return this.element as SimElement;
  }

  /** Sets an exposed attribute (`Title`, `Text`, `Icon`…), only when it changes. */
  set(attribute: string, value: string): void {
    if (this.attributes.get(attribute) === value) return;
    this.attributes.set(attribute, value);
    this.sim.setExposedAttribute(attribute, value);
  }

  /**
   * Selected: drawn by the component's own Selected state. A component whose template has no `selectable` trait (the
   * sim's TextTab) gets one first, as the sim's cards do for their tabs.
   */
  select(selected: boolean): void {
    let selectable = this.sim.traits.selectable;
    if (!selectable && selected) {
      const trait = traitNamed('selectable');
      if (trait && this.element.isConnected && AttachTrait(this.element, 'selectable', trait)) {
        // Detached with the component (the sim warns that an attached trait otherwise leaks).
        const traits = this.sim.traits;
        this.scope.add(() => {
          const attached = traits.selectable;
          if (attached && attached.unSetElementRef) attached.unSetElementRef();
          delete traits.selectable;
        });
      }
      selectable = this.sim.traits.selectable;
    }
    if (selectable && selectable.isSelected() !== selected) selectable.Set(selected);
  }

  /** Disabled: dimmed by the component's own Disabled state. */
  disable(disabled: boolean): void {
    const deactivable = this.sim.traits.deactivable;
    if (deactivable && deactivable.isDisabled() !== disabled) deactivable.Set(disabled);
  }

  get disabled(): boolean {
    const deactivable = this.sim.traits.deactivable;
    return !!deactivable && deactivable.isDisabled();
  }

  /**
   * Passes visual flags to the component's manipulator (its `onVisualUpdate`), as the sim does: the element keeps
   * them, so a flag such as `forceInput` stays set through the manipulator's own later updates.
   */
  updateVisual(change: Record<string, boolean>): void {
    this.sim.updateVisual(change);
  }

  /** The component's manipulator (its own API, typed by the caller), or null. */
  manipulator<T>(): T | null {
    return (this.sim.manipulator as unknown as T | null) || null;
  }

  /** An exposed value of the component (for example a colour), or undefined. */
  value(name: string): unknown {
    return this.sim.getExposedValue(name);
  }

  /** Calls `handler` on a click, unless the component is disabled. */
  onClick(scope: Scope, handler: () => void): void {
    scope.listen(this.element, 'click', () => {
      if (!this.disabled) handler();
    });
  }
}

/**
 * Creates the component `guid` in `parent`, filling it (the parent gives the size and position), loads and activates
 * it. It is deactivated and removed when `scope` is disposed. Rejects if the sim cannot create it in time.
 */
export async function createComponent(scope: Scope, guid: ComponentGuid, parent: HTMLElement, attributes?: Record<string, string>): Promise<SimComponent> {
  const manager = (window as unknown as { ResourcesManager?: ResourcesManager }).ResourcesManager;
  const element = manager ? manager.createElementFromGuid(guid, ELEMENT_FACTORY) : undefined;
  if (!element) throw new Error(`the sim cannot create component ${guid}`);

  // The template positions the component in its own layout (anchors, pivot, absolute): here it fills its parent.
  const style = element.style;
  style.position = 'relative';
  style.left = '0';
  style.top = '0';
  style.width = '100%';
  style.height = '100%';
  for (const variable of ['--h-anchor', '--v-anchor', '--pivot-x', '--pivot-y']) style.setProperty(variable, '0%');
  scope.add(() => {
    if (element.manipulator) {
      try {
        element.manipulator.deactivate();
      } catch (error) {
        logError(`component ${guid} failed to deactivate`, error);
      }
    }
    if (element.parentNode) element.parentNode.removeChild(element);
  });
  parent.appendChild(element);

  const late = `component ${guid} did not load within ${LOAD_TIMEOUT_MS} ms`;
  await withTimeout(element.loadingList.whenAllLoaded, LOAD_TIMEOUT_MS, late);
  const manipulator = element.manipulator;
  if (manipulator && manipulator.refLoadingPromise) await withTimeout(manipulator.refLoadingPromise.whenAllLoaded, LOAD_TIMEOUT_MS, late);
  if (scope.disposed) return new SimComponent(element, scope);
  if (manipulator) manipulator.activate();

  const component = new SimComponent(element, scope);
  if (attributes) for (const name of Object.keys(attributes)) component.set(name, attributes[name]!);
  return component;
}

/** The trait class registered under `name` (`selectable`…), found by name rather than by GUID. */
function traitNamed(name: string): TraitClass | undefined {
  let found: TraitClass | undefined;
  GuidToTrait.forEach((trait) => {
    if (!found && trait && trait.traitName === name) found = trait;
  });
  return found;
}

