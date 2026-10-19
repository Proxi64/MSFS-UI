// Types of `/Global/shared/utils.js` (fs-base-ui, re-exports common.js), limited to what the mod uses.

/**
 * Proxy that turns every property access into a path (`root.Game.CurrentFlight` → ["Game", "CurrentFlight"])
 * and every call into `target.call(path, ...args)`.
 */
export declare function UniversalProxy<T extends object>(target: T): unknown;

/** Event channel with the sim's engine. */
export interface ViewListener {
  trigger(event: string, ...args: unknown[]): void;
}

/** Opens (or shares, when `singleton`) the listener `name`. */
export declare function RegisterViewListener(name: string, onConnected?: () => void, singleton?: boolean): ViewListener;
