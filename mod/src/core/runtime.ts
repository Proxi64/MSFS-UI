// The mod's lifetime in the menu page. Each loaded version owns one root scope. A hot reload imports a new main.js,
// which first unloads the previous version through `window.__msfsUiRuntime`, so every change to the sim is undone
// exactly once. The app's programs use the same handle (backup restore unloads the mod before writing its keys).

import { MOD_VERSION, type FeatureId, type Settings } from '../generated/catalog.ts';
import { logError } from './log.ts';
import { Scope } from './scope.ts';

/** What the loaded mod reports about itself, readable in the page (`window.__msfsUiRuntime`) by the app. */
export interface RuntimeHandle {
  readonly version: string;
  readonly build: string;
  /** Where the settings came from, once read. */
  settingsSource: 'config.js' | 'defaults' | undefined;
  settings: Settings | undefined;
  /** Where the mod keeps its data, and why (the vault module, or the sim storage when the module did not answer). */
  storage: { kind: 'vault' | 'datastorage'; detail: string } | undefined;
  /** Features running, in catalogue order. */
  readonly started: FeatureId[];
  /** Features whose start failed (their changes are undone). */
  readonly failed: FeatureId[];
  /** Undoes everything the mod changed; the handle is removed from the page. */
  unload(): void;
}

declare global {
  interface Window {
    __msfsUiRuntime?: { unload(): void };
  }
}

/** The whole mod: disposed when this version is unloaded. */
export const root = new Scope();

export const runtime: RuntimeHandle = {
  version: MOD_VERSION,
  build: __MSFS_UI_BUILD__,
  settingsSource: undefined,
  settings: undefined,
  storage: undefined,
  started: [],
  failed: [],
  unload: () => root.dispose(),
};

/** First thing the mod does: unloads a previous version, then registers this one. */
export function startRuntime(): void {
  const previous = window.__msfsUiRuntime;
  if (previous) {
    try {
      previous.unload();
    } catch (error) {
      logError('the previous version of the mod failed to unload', error);
    }
  }
  window.__msfsUiRuntime = runtime;
  root.add(() => {
    if (window.__msfsUiRuntime === runtime) delete window.__msfsUiRuntime;
  });
}

/** Adds a stylesheet to the page; removed with `scope`. */
export function injectStyle(css: string, scope: Scope): HTMLStyleElement {
  const style = document.createElement('style');
  style.setAttribute('data-msfs-ui', '');
  style.textContent = css;
  return scope.append(document.head, style);
}
