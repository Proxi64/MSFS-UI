// Checks of the mod's sources and of the bundled module, run by build.ts. Each returns error messages (empty: OK).

import { kebabCase, type CatalogJson } from './catalog.ts';

/** Source files of the mod: path relative to mod with forward slashes (`src/features/x.ts`) → text. */
export type SourceFiles = ReadonlyMap<string, string>;

export interface CompatJson {
  exports: { module: string; names: string[] }[];
  screens: { label: string; guid: string; className: string }[];
  components: { label: string; guid: string; name: string; children?: string[] }[];
  /** Options of the sim the mod uses (their ids carry a GUID): see sim/profile-save.ts. */
  options?: { label: string; section: string; id: string }[];
  anchors: string[];
  files: string[];
  colorVariables: string[];
  translations: string[];
}

export interface FeatureModuleReport {
  errors: string[];
  /** Catalogue features without a module yet (their registry entry is null). */
  notPorted: string[];
}

const FEATURES_DIR = 'src/features/';
const REGISTRY = 'src/features.ts';

/**
 * Each feature lives in src/features/<feature-id>.ts or src/features/<feature-id>/, reads every option of its
 * catalogue entry as `settings.<option>`, and is registered in src/features.ts; a feature without a module has a
 * `null` registry entry. (The registry's type already fails to compile for a missing or unknown feature id.)
 */
export function checkFeatureModules(catalog: CatalogJson, files: SourceFiles): FeatureModuleReport {
  const errors: string[] = [];
  const notPorted: string[] = [];
  const byName = new Map(catalog.features.map((feature) => [kebabCase(feature.id), feature]));
  const owned = new Map<string, string[]>();
  for (const path of files.keys()) {
    if (!path.startsWith(FEATURES_DIR) || !path.endsWith('.ts')) continue;
    const rest = path.slice(FEATURES_DIR.length);
    const name = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest.slice(0, -'.ts'.length);
    if (!byName.has(name)) {
      errors.push(`${path}: no feature "${name}" in features.json (feature modules are named after their id in kebab case)`);
      continue;
    }
    const list = owned.get(name) || [];
    list.push(path);
    owned.set(name, list);
  }

  const registry = files.get(REGISTRY) || '';
  for (const [name, feature] of byName) {
    const paths = owned.get(name);
    const isNull = new RegExp(`\\b${feature.id}\\s*:\\s*null\\b`).test(registry);
    if (!paths) {
      notPorted.push(feature.id);
      if (!isNull) errors.push(`${REGISTRY}: "${feature.id}" has no module under ${FEATURES_DIR} but is not null`);
      continue;
    }
    if (isNull) errors.push(`${REGISTRY}: "${feature.id}" has a module but its registry entry is null`);
    const code = paths.map((path) => files.get(path)).join('\n');
    for (const option of feature.options) {
      if (!new RegExp(`\\bsettings\\.${option.id}\\b`).test(code)) {
        errors.push(`${FEATURES_DIR}${name}: option "${feature.id}.${option.id}" of features.json is never read (settings.${option.id})`);
      }
    }
  }
  return { errors, notPorted };
}

/**
 * What the sources take from the sim must be listed in compat.json, so the app's compatibility check covers it:
 * screen and component GUIDs, anchors (`name="…"`, or a child declared by a component), translation keys, named imports of the sim's modules, sim files (`coui://…/VFS/`)
 * and the sim's CSS variables (colours, font sizes, screen height, background opacity).
 */
export function checkSimReferences(compat: CompatJson, files: SourceFiles): string[] {
  const errors: string[] = [];
  const require = (path: string, kind: string, value: string, listed: readonly string[]) => {
    if (!listed.includes(value)) errors.push(`${path}: ${kind} ${value} is used but not listed in compat.json`);
  };
  const optionGuids = (compat.options || []).map((option) => (/\{[0-9A-F-]{36}\}/.exec(option.id) || [''])[0]);
  const guids = compat.screens.map((screen) => screen.guid).concat(compat.components.map((component) => component.guid), optionGuids);
  const names = compat.anchors.concat(...compat.components.map((component) => component.children || []));
  for (const [path, text] of files) {
    if (path.startsWith('src/generated/')) continue;
    for (const match of text.matchAll(/\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/g)) require(path, 'screen, component or option', match[0], guids);
    for (const match of text.matchAll(/\bname="([A-Za-z0-9_]+)"/g)) require(path, 'anchor', match[1]!, names);
    for (const match of text.matchAll(/\bTT:[A-Z0-9_.]+/g)) require(path, 'translation key', match[0], compat.translations);
    for (const match of text.matchAll(/coui:\/\/html_UI\/VFS\/([^"')\s]+)/g)) require(path, 'sim file', match[1]!, compat.files);
    for (const match of text.matchAll(/var\((--(?:color[A-Za-z0-9]+|fontSize[A-Za-z0-9]+|unscaledScreenHeight|backgroundOpacity))\)/g)) {
      require(path, 'CSS variable', match[1]!, compat.colorVariables);
    }
    for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\/Global\/([^']+)'/g)) {
      const listed = compat.exports.find((entry) => entry.module === match[2]);
      for (const part of match[1]!.split(',')) {
        const name = part.trim();
        if (name && !name.startsWith('type ')) require(path, `export of ${match[2]}`, name.split(/\s+as\s+/)[0]!, listed ? listed.names : []);
      }
    }
  }
  return errors;
}

/** U+2028 and U+2029: invalid in a string literal before ES2019, and turned into raw characters by some editors. */
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`);

/** Raw line or paragraph separators in the sources (build them with `String.fromCharCode`). */
export function checkSourceCharacters(files: SourceFiles): string[] {
  const errors: string[] = [];
  for (const [path, text] of files) {
    const lines = text.split('\n');
    lines.forEach((line, at) => {
      if (LINE_SEPARATORS.test(line)) errors.push(`${path}:${at + 1}: raw U+2028 or U+2029 (build it with String.fromCharCode)`);
    });
  }
  return errors;
}

/**
 * Coherent GT rejects a unary operator before `await` (`!await x`, `-await x`, `typeof await x`…): the whole module
 * fails to load. esbuild produces that form from `!(await x)`.
 */
const UNARY_AWAIT = /(?:[!~]|\b(?:typeof|void|delete)\s|(?:[=(,:?[]|\breturn)\s*[-+])\s*await\b/;

/** Syntax of the bundled module that Coherent GT does not load. */
export function checkModuleSyntax(code: string): string[] {
  const errors: string[] = [];
  code.split('\n').forEach((line, at) => {
    if (line.startsWith('//# sourceMappingURL=')) return;
    if (UNARY_AWAIT.test(line)) {
      errors.push(`main.js:${at + 1}: an operator before "await" does not load in Coherent GT ("${line.trim().slice(0, 120)}"): write "const ok = await x; if (!ok) …"`);
    }
    if (LINE_SEPARATORS.test(line)) errors.push(`main.js:${at + 1}: raw U+2028 or U+2029`);
  });
  return errors;
}
