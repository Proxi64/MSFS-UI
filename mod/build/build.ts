// Builds the menu mod: mod/dist/main.js, one ES2017 module that the app embeds and copies into the package.
//
//   node build/build.ts             validate the contracts, generate, type-check, bundle and check the module
//   node build/build.ts --release   the same, without the inline source map (the module shipped in the app)
//
// Steps: features.json and compat.json against their schemas and consistency rules; src/generated/catalog.ts from
// features.json; feature modules and sim references against the contracts; tsc on the mod and on the Node code;
// esbuild; syntax checks of the bundle (Coherent GT predates ES2018). Any error stops the build (exit code 1).

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as esbuild from 'esbuild';
import { checkCatalog, generateCatalogModule, type CatalogJson } from './catalog.ts';
import { checkFeatureModules, checkModuleSyntax, checkSimReferences, checkSourceCharacters, type CompatJson } from './checks.ts';

const MOD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(MOD_DIR, 'dist', 'main.js');
const GENERATED = join(MOD_DIR, 'src', 'generated', 'catalog.ts');

class BuildError extends Error {
  readonly details: string[];
  constructor(step: string, details: string[]) {
    super(step);
    this.details = details;
  }
}

function fail(step: string, details: string[]): void {
  if (details.length > 0) throw new BuildError(step, details);
}

function readJson<T>(name: string): T {
  try {
    return JSON.parse(readFileSync(join(MOD_DIR, name), 'utf8')) as T;
  } catch (error) {
    throw new BuildError(`${name} is unreadable`, [(error as Error).message]);
  }
}

function validateSchema(name: string, schemaName: string, data: unknown): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(readJson<object>(join('schema', schemaName)));
  if (!validate(data)) {
    fail(`${name} does not match ${schemaName}`, (validate.errors || []).map((e) => `${name}${e.instancePath || ''}: ${e.message || 'invalid'}`));
  }
}

/** Every file of src/, by path relative to mod with forward slashes. */
function readSources(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|css)$/.test(name)) files.set(relative(MOD_DIR, path).split(sep).join('/'), readFileSync(path, 'utf8'));
    }
  };
  walk(join(MOD_DIR, 'src'));
  return files;
}

function writeIfChanged(path: string, text: string): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function typecheck(project: string): void {
  const tsc = join(MOD_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', join(MOD_DIR, project), '--pretty', 'false'], { encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.status !== 0) fail(`type errors (${project})`, output ? output.split('\n') : [`tsc exited with ${result.status}`]);
}

async function bundle(release: boolean): Promise<string> {
  const builtAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const result = await esbuild.build({
    entryPoints: [join(MOD_DIR, 'src', 'main.ts')],
    outfile: 'main.js',
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2017',
    // ASCII output: non-ASCII characters (and U+2028 / U+2029) are escaped.
    charset: 'ascii',
    // The source map shows the TypeScript sources in the inspector while developing; it doubles the module's size.
    sourcemap: release ? false : 'inline',
    legalComments: 'none',
    logLevel: 'silent',
    tsconfig: join(MOD_DIR, 'tsconfig.json'),
    // The sim's modules are resolved by Coherent GT in the page, to share the menu's instances.
    external: ['/Global/*'],
    loader: { '.css': 'text' },
    define: { __MSFS_UI_BUILD__: JSON.stringify(builtAt) },
  });
  fail('esbuild warnings', result.warnings.map((warning) => warning.text));
  return result.outputFiles[0]!.text;
}

async function main(): Promise<void> {
  const started = Date.now();
  const catalog = readJson<CatalogJson>('features.json');
  const compat = readJson<CompatJson>('compat.json');
  validateSchema('features.json', 'features.schema.json', catalog);
  validateSchema('compat.json', 'compat.schema.json', compat);
  fail('features.json is inconsistent', checkCatalog(catalog));
  const version = readJson<{ version: string }>('package.json').version;
  if (version !== catalog.modVersion) fail('versions differ', [`package.json has ${version}, features.json has modVersion ${catalog.modVersion}`]);

  writeIfChanged(GENERATED, generateCatalogModule(catalog));
  const sources = readSources();
  const modules = checkFeatureModules(catalog, sources);
  fail('feature modules do not match features.json', modules.errors);
  fail('the sources use the sim beyond compat.json', checkSimReferences(compat, sources));
  fail('invalid characters in the sources', checkSourceCharacters(sources));

  typecheck('tsconfig.json');
  typecheck('tsconfig.node.json');

  const release = process.argv.includes('--release');
  const code = await bundle(release);
  fail('the module would not load in Coherent GT', checkModuleSyntax(code));
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, code);

  const ported = catalog.features.length - modules.notPorted.length;
  console.log(`mod ${catalog.modVersion}: ${relative(MOD_DIR, OUT_FILE)} (${Math.round(code.length / 1024)} KB${release ? ', release' : ', with source map'}) in ${Date.now() - started} ms`);
  console.log(`features: ${ported}/${catalog.features.length} ported${modules.notPorted.length > 0 ? ` (not yet: ${modules.notPorted.join(', ')})` : ''}`);
}

main().catch((error: unknown) => {
  if (error instanceof BuildError) {
    console.error(`Build failed: ${error.message}`);
    for (const detail of error.details) console.error(`  ${detail}`);
  } else {
    console.error('Build failed:', error);
  }
  process.exitCode = 1;
});
