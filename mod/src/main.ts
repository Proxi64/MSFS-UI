// Entry point of the mod, imported by the loader that the app inserts in the menu's MasterPage
// (MsfsUi.Core MasterPageLoader): `import('/msfs-ui/main.js')`, or with `?t=…` for a hot reload.

import { CONFIG_URL, loadSettings } from './core/config.ts';
import { log, logError } from './core/log.ts';
import { root, runtime, startRuntime } from './core/runtime.ts';
import type { Scope } from './core/scope.ts';
import { clearDatastorage, copyFromDatastorage, datastorageKeys, moveSessionWrites, setStorageBackend, takeFallbackWrites } from './core/storage.ts';
import { injectTheme } from './core/theme.ts';
import { FEATURES } from './features.ts';
import { dropAircraftUses, dropFavoriteAircraft } from './sim/favorites.ts';
import { saveProfileOnce, startProfileSaves } from './sim/profile-save.ts';
import { openVault, type Vault } from './sim/vault.ts';
import { FEATURE_IDS, type FeatureId, type Settings } from './generated/catalog.ts';

// The app's compatibility check counts console errors from this line on (CompatibilityChecker.ModLoadedMarker):
// logged before the previous version is unloaded, so a failing cleanup of that version still counts.
log(`module loaded (version ${runtime.version}, build ${runtime.build})`);
startRuntime();
start().catch((error: unknown) => logError('start-up failed', error));

/** What the vault module said of itself (its STATUS answer), shown with the storage on the Compatibility page. */
let moduleState = '';
/** The scope of each running feature. */
const featureScopes = new Map<FeatureId, Scope>();

async function start(): Promise<void> {
  const loaded = await loadSettings();
  // A newer version may have been loaded while the settings were read: it has unloaded this one.
  if (root.disposed) return;
  // Before the features: the data lives in the vault module when it answers, else in the sim storage, whose writes are
  // saved to the disk through a profile save (sim/profile-save.ts), until the module answers late (adoptLateVault).
  const fallback = root.child();
  let lateMs: number | undefined;
  const opened = await openVault(root, {
    onLate: (vault, afterMs) => {
      lateMs = afterMs;
      if (vault) adoptLateVault(vault, afterMs, fallback);
    },
    onState: (state) => {
      moduleState = state;
    },
  });
  if (root.disposed) return;
  root.add(() => setStorageBackend(null));
  if (opened.vault) {
    fallback.dispose();
    useVault(opened.vault);
    log(`data kept in the vault module (${opened.vault.describe()})`);
  } else {
    startProfileSaves(fallback);
    runtime.storage = {
      kind: 'datastorage',
      get detail() {
        const late = lateMs === undefined ? '' : `; it answered after ${lateMs} ms with an unreadable snapshot: this session's data stays in the sim storage`;
        return `${moduleNote()}${opened.reason}${late}`;
      },
    };
    log(`data kept in the sim storage: ${opened.reason}`);
  }
  // The favourites are liveries since 1.3.0: the favourite aircraft of earlier versions go (saved with the profile).
  dropFavoriteAircraft();
  // The last use of each variant, recorded until 2.0.4, was read by nobody: it goes too.
  dropAircraftUses();
  runtime.settings = loaded.settings;
  runtime.settingsSource = loaded.source;
  if (loaded.problems.length > 0) {
    logError(`settings from ${loaded.source === 'config.js' ? CONFIG_URL : 'the defaults'}, with problems: ${loaded.problems.join('; ')}`);
  } else {
    log(`settings read from ${CONFIG_URL}`);
  }

  injectTheme(root);
  startFeatures(loaded.settings);
}

function moduleNote(): string {
  return moduleState ? `module: ${moduleState}; ` : '';
}

/**
 * The data in the vault from now on: into a vault that never saved anything the mod's data comes over from the sim storage
 * (1.x's, or a session's without a working vault), then the changes this session made there before a late answer, except
 * where the vault's value is newer than the one they were made from (logged). Returns the keys moved.
 */
function useVault(vault: Vault, lateMs?: number): string[] {
  const backend = vault.backend();
  if (vault.seq === 0) {
    const copied = copyFromDatastorage(backend);
    if (copied.length > 0) log(`data of an earlier version copied into the vault: ${copied.join(', ')}`);
  }
  // A session without the vault since it last saved: what it added joins the vault's data, and would otherwise be cleared unread.
  const taken = takeFallbackWrites(backend);
  if (taken.length > 0) log(`additions of a session without the vault joined to it: ${taken.join(', ')}`);
  const { moved, kept } = moveSessionWrites(backend);
  if (kept.length > 0) log(`the vault's newer values kept over this session's changes made on the sim storage: ${kept.join(', ')}`);
  setStorageBackend(backend);
  clearDatastorageOnceSaved(vault);
  // Live: each read of the app's probe gives the current seq, size and keys (last, read by the app's check).
  runtime.storage = {
    kind: 'vault',
    get detail() {
      return `${moduleNote()}${lateMs === undefined ? '' : `answered after ${lateMs} ms; `}${vault.describe()}`;
    },
  };
  return moved;
}

/**
 * The sim storage's copy of the mod's data goes once the vault holds the data on the disk, with a profile save: a new
 * vault (after Uninstall everything, or its files deleted) would otherwise take it back (the owner, 2026-10-31: 50 hidden
 * aircraft came back). Kept when the vault does not confirm its save. A later session without the vault then starts
 * from an empty sim storage, and its changes give way to the vault's values (moveSessionWrites).
 */
function clearDatastorageOnceSaved(vault: Vault): void {
  const leftovers = datastorageKeys();
  if (leftovers.length === 0) return;
  vault.whenSaved().then(
    (saved) => {
      if (root.disposed) return;
      if (!saved) {
        logError(`the sim storage keeps the mod's data (${leftovers.join(', ')}): the vault did not confirm its save`);
        return;
      }
      const cleared = clearDatastorage();
      if (cleared.length === 0) return;
      log(`sim storage cleared of the mod's data, which the vault keeps: ${cleared.join(', ')}`);
      saveProfileOnce();
    },
    (error: unknown) => logError('the sim storage could not be cleared of the mod data', error),
  );
}

/**
 * The module answered after the time-out (the sim was slow to start it): the session moves to the vault with the
 * changes made meanwhile, the profile saves stop, and the features start again to read their data from the vault
 * (they read the sim storage at their start, and would write it back over the vault's).
 */
function adoptLateVault(vault: Vault, afterMs: number, fallback: Scope): void {
  if (root.disposed) return;
  fallback.dispose();
  const moved = useVault(vault, afterMs);
  log(`data moved to the vault module${moved.length > 0 ? ` with this session's changes (${moved.join(', ')})` : ''} (${vault.describe()})`);
  if (featureScopes.size > 0 && runtime.settings) {
    featureScopes.forEach((scope) => scope.dispose());
    featureScopes.clear();
    runtime.started.length = 0;
    runtime.failed.length = 0;
    startFeatures(runtime.settings);
  }
}

function startFeatures(settings: Settings): void {
  const off: FeatureId[] = [];
  for (const id of FEATURE_IDS) {
    if (!settings[id].enabled) off.push(id);
    else startFeature(id, settings[id]);
  }
  const list = (ids: FeatureId[]) => (ids.length > 0 ? ids.join(', ') : 'none');
  log(`features started: ${list(runtime.started)}; off: ${list(off)}`);
}

/** Starts one feature in its own scope. */
function startFeature<Id extends FeatureId>(id: Id, settings: Settings[Id]): void {
  const start = FEATURES[id];
  const scope = root.child();
  const fail = (error: unknown) => {
    // A start still pending when a newer version took over, or when the features started again: already disposed.
    if (root.disposed || featureScopes.get(id) !== scope) return;
    logError(`feature ${id} failed to start, its changes are undone`, error);
    scope.dispose();
    featureScopes.delete(id);
    const at = runtime.started.indexOf(id);
    if (at >= 0) runtime.started.splice(at, 1);
    runtime.failed.push(id);
  };
  featureScopes.set(id, scope);
  runtime.started.push(id);
  try {
    const result = start(settings, scope);
    if (result) result.catch(fail);
  } catch (error) {
    fail(error);
  }
}
