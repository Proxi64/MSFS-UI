// The settings chosen in the app, read at start-up from the module the app generates in the package,
// html_ui/msfs-ui/config.js (see Contracts in docs/development.md). Without a usable file, the mod runs with the catalogue defaults.

import { CATALOG, type Settings } from '../generated/catalog.ts';
import { withTimeout } from './async.ts';
import { describeError } from './log.ts';
import { defaultSettings, resolveSettings } from './settings.ts';

export const CONFIG_URL = '/msfs-ui/config.js';

/** A module that fails to load should reject at once; this bounds the wait if Coherent never settles it. */
const LOAD_TIMEOUT_MS = 5000;

export interface LoadedSettings {
  readonly settings: Settings;
  /** `config.js` when the file was read (possibly with adjustments), `defaults` otherwise. */
  readonly source: 'config.js' | 'defaults';
  /** What was wrong, for the log. */
  readonly problems: string[];
}

export async function loadSettings(): Promise<LoadedSettings> {
  let module: { default?: unknown };
  try {
    // The query string makes a hot reload read the current file instead of the module cached by the page.
    module = await withTimeout(import(CONFIG_URL + '?t=' + Date.now()), LOAD_TIMEOUT_MS, `no answer after ${LOAD_TIMEOUT_MS} ms`);
  } catch (error) {
    return {
      settings: defaultSettings(CATALOG) as unknown as Settings,
      source: 'defaults',
      problems: [`${CONFIG_URL} could not be loaded (${describeError(error)})`],
    };
  }
  const resolved = resolveSettings(module.default, CATALOG);
  return {
    settings: resolved.values as unknown as Settings,
    source: resolved.allDefaults ? 'defaults' : 'config.js',
    problems: resolved.problems,
  };
}

