// Types of `/Global/engine_ui.bundle.js` (fs-base-ui), limited to what the mod uses.
// The module is not bundled with the mod: esbuild keeps it as an external import, resolved by Coherent GT.

/**
 * Component class registered by the sim's `Manipulator({ name, guid })` decorator. `traitName` is empty in
 * practice (seen on sim 1.9.18): the class name is the only readable identifier.
 */
export interface ManipulatorClass {
  readonly name: string;
  readonly traitName: string | undefined;
  readonly traitTemplateGuid: string;
  prototype: {
    onActivation?: (...args: unknown[]) => unknown;
    onDeactivation?: (...args: unknown[]) => unknown;
  };
}

/** Registry: GUID (upper case, in braces) → component class. */
export declare const GuidToManipulator: Map<string, ManipulatorClass>;

/** Options of a timeline animation. Durations in milliseconds. */
export interface TimelineAnimationOptions {
  duration?: number;
  /** Ignored as input: `add` computes it (`calcStartTime`) from `animationStart`, `offset` and `initialDelay`. */
  delay?: number;
  /** Absolute start of the animation in the timeline. */
  animationStart?: number;
  /** Start relative to the end of the latest animation already added. */
  offset?: number;
  /** -1 = loops forever. */
  iterations?: number;
  [key: string]: unknown;
}

/** Configuration of a timeline: defaults of its animations, plus these fields. */
export interface TimelineConfiguration extends TimelineAnimationOptions {
  initialDelay?: number;
  startingTransition?: number;
}

export interface TimelineEvent {
  delay: number;
  event: () => unknown;
  [key: string]: unknown;
}

export declare class UITimeline {
  configuration: TimelineConfiguration;
  add(...animations: TimelineAnimationOptions[]): boolean;
  addEvent(...events: TimelineEvent[]): void;
}

/** Options of a CSS transition. Durations in seconds. */
export interface TransitionOptions {
  duration: number;
  delay: number;
  easing: string;
}

export declare class UITransition {
  getTransitionStr(transition: { changes: Record<string, unknown> }, options: TransitionOptions): string;
}

/** A trait class (behaviour of a component: selectable, deactivable…), registered under its `traitName`. */
export interface TraitClass {
  new (...args: unknown[]): unknown;
  readonly name: string;
  readonly traitName?: string;
}

/** Registry: trait GUID → trait class. */
export declare const GuidToTrait: Map<string, TraitClass>;

/** Attaches a new instance of `trait` to `element` as `element.traits[name]` (the element must be in the document). */
export declare function AttachTrait(element: Element, name: string, trait: TraitClass, ...args: unknown[]): Element | null;
