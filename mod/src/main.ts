// Entry point of the mod, imported by the loader that the app inserts in the menu's MasterPage
// (MsfsUi.Core MasterPageLoader): `import('/msfs-ui/main.js')`, or with `?t=…` for a hot reload.

import { CONFIG_URL, loadSettings } from './core/config.ts';
import { log, logError } from './core/log.ts';
import { root, runtime, startRuntime } from './core/runtime.ts';
import { setStorageBackend } from './core/storage.ts';
import { injectTheme } from './core/theme.ts';
import { FEATURES } from './features.ts';
import { dropFavoriteAircraft } from './sim/favorites.ts';
import { startProfileSaves } from './sim/profile-save.ts';
import { openVault } from './sim/vault.ts';
import { FEATURE_IDS, type FeatureId, type Settings } from './generated/catalog.ts';

// The app's compatibility check counts console errors from this line on (CompatibilityChecker.ModLoadedMarker):
// logged before the previous version is unloaded, so a failing cleanup of that version still counts.
log(`module loaded (version ${runtime.version}, build ${runtime.build})`);
startRuntime();
start().catch((error: unknown) => logError('start-up failed', error));

async function start(): Promise<void> {
  const loaded = await loadSettings();
  // A newer version may have been loaded while the settings were read: it has unloaded this one.
  if (root.disposed) return;
  // Before the features: the data lives in the vault module when it answers, else in the sim storage, whose writes are
  // saved to the disk through a profile save (sim/profile-save.ts).
  const opened = await openVault(root);
  if (root.disposed) return;
  const vault = opened.vault;
  if (vault) {
    setStorageBackend(vault.backend());
    root.add(() => setStorageBackend(null));
    runtime.storage = { kind: 'vault', detail: vault.describe() };
    log(`data kept in the vault module (${runtime.storage.detail})`);
  } else {
    startProfileSaves(root);
    runtime.storage = { kind: 'datastorage', detail: opened.reason };
    log(`data kept in the sim storage: ${opened.reason}`);
  }
  // The favourites are liveries since 1.3.0: the favourite aircraft of earlier versions go (saved with the profile).
  dropFavoriteAircraft();
  runtime.settings = loaded.settings;
  runtime.settingsSource = loaded.source;
  if (loaded.problems.length > 0) {
    logError(`settings from ${loaded.source === 'config.js' ? CONFIG_URL : 'the defaults'}, with problems: ${loaded.problems.join('; ')}`);
  } else {
    log(`settings read from ${CONFIG_URL}`);
  }

  injectTheme(root);
  const off: FeatureId[] = [];
  const notPorted: FeatureId[] = [];
  for (const id of FEATURE_IDS) {
    if (!loaded.settings[id].enabled) off.push(id);
    else if (!startFeature(id, loaded.settings[id])) notPorted.push(id);
  }
  const list = (ids: FeatureId[]) => (ids.length > 0 ? ids.join(', ') : 'none');
  log(`features started: ${list(runtime.started)}; off: ${list(off)}${notPorted.length > 0 ? `; not ported yet: ${list(notPorted)}` : ''}`);
}

/** Starts one feature in its own scope; false when it is not ported yet. */
function startFeature<Id extends FeatureId>(id: Id, settings: Settings[Id]): boolean {
  const start = FEATURES[id];
  if (!start) return false;
  const scope = root.child();
  const fail = (error: unknown) => {
    // A start still pending when a newer version took over: its scope is already disposed with this version.
    if (root.disposed) return;
    logError(`feature ${id} failed to start, its changes are undone`, error);
    scope.dispose();
    const at = runtime.started.indexOf(id);
    if (at >= 0) runtime.started.splice(at, 1);
    runtime.failed.push(id);
  };
  runtime.started.push(id);
  try {
    const result = start(settings, scope);
    if (result) result.catch(fail);
  } catch (error) {
    fail(error);
  }
  return true;
}
