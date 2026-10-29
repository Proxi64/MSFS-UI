// Globals provided by Coherent GT and by the build (build/build.ts).

/** Build stamp (UTC date and time), injected by esbuild. */
declare const __MSFS_UI_BUILD__: string;

/** Coherent GT's bridge to the sim's engine. */
declare const engine: {
  trigger(event: string, ...args: unknown[]): void;
  /** Subscribes to an engine event; `clear()` removes the subscription. */
  on(event: string, handler: (...args: any[]) => void): { clear(): void } | undefined;
  off(event: string, handler: (...args: any[]) => void): void;
  /** Calls a function of the sim; a promise (it may never settle). */
  call(name: string, ...args: unknown[]): Promise<unknown>;
};

/** Stylesheets are bundled as text (esbuild `text` loader) and injected by the mod. */
declare module '*.css' {
  const css: string;
  export default css;
}
