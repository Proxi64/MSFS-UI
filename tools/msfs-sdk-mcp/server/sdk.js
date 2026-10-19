// Accès en lecture au dossier du SDK MSFS 2024 : arborescence, recherche plein texte,
// catalogues (événements KEY_, API SimConnect.h, variables des ModelBehaviorDefs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEXT_EXT = new Set([
  '.h', '.hpp', '.c', '.cpp', '.cs', '.py', '.js', '.ts', '.json', '.xml', '.xsd', '.xmlod',
  '.md', '.txt', '.cfg', '.ini', '.props', '.targets', '.csproj', '.vcxproj', '.sln', '.fx',
  '.hlsl', '.html', '.css', '.ui', '.loc', '.bat', '.ps1', '.toml', '.yaml', '.yml', '.rc',
]);
// Dossiers volumineux et peu utiles (toolchain LLVM / libc WASI) exclus par défaut des recherches.
const TOOLCHAIN_DIRS = ['WASM/llvm', 'WASM/wasi-sysroot'];
const MAX_FILE_BYTES = 3 * 1024 * 1024;

const AREAS = {
  'SimConnect SDK': "API SimConnect native (SimConnect.h), bibliothèques .lib/.dll, wrapper managé .NET (Microsoft.FlightSimulator.SimConnect.dll).",
  'WASM': "Développement de modules WebAssembly (gauges, systèmes) : en-têtes MSFS/*.h (MSFS_Vars, MSFS_Events, gauges.h…), exemples, toolchain LLVM.",
  'ModelBehaviorDefs': "Templates XML de comportements de cockpit (Asobo, WorkingTitle) : exemples réels d'utilisation des SimVars A:, L:, B:, K: en RPN.",
  'Schemas': "Schémas JSON des extensions glTF ASOBO_* (matériaux, collisions, gizmos, lumières).",
  'LodProcessingPresets': "Préréglages de génération automatique des LOD (.xmlod).",
  'SharedAssets': "Ressources partagées du SDK (textures, modèles, matériaux).",
  'Tools': "Outils : exporteurs Blender / 3ds Max, extension VS Code, débogueurs, fspackagetool, BglExplorer.",
  'Licenses': "CLUF du SDK MSFS.",
};

function defaultSdkPath() {
  const candidates = [
    process.env.MSFS_SDK_PATH,
    path.join(os.homedir(), 'Model Context Protocol', 'MSFS 2024 SDK'),
    'C:\\MSFS 2024 SDK',
    process.env.MSFS2024_SDK,
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.statSync(c).isDirectory()) return c; } catch { /* ignore */ }
  }
  return candidates[0] || '';
}

export class Sdk {
  constructor(root = defaultSdkPath()) {
    this.root = root;
    this._files = null;      // [{rel, size}]
    this._content = new Map();
    this._keyEvents = null;
    this._behaviorVars = null;
  }

  ensureRoot() {
    if (!this.root || !fs.existsSync(this.root)) {
      throw new Error(`Dossier du SDK introuvable : "${this.root}". Renseignez le chemin du SDK MSFS 2024 dans les réglages de l'extension (variable MSFS_SDK_PATH).`);
    }
  }

  resolve(rel = '') {
    this.ensureRoot();
    const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
    const abs = path.resolve(this.root, clean);
    const rootAbs = path.resolve(this.root);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new Error('Chemin hors du SDK refusé.');
    return abs;
  }

  toRel(abs) { return path.relative(this.root, abs).split(path.sep).join('/'); }

  files() {
    if (this._files) return this._files;
    this.ensureRoot();
    const out = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.isFile()) {
          let size = 0;
          try { size = fs.statSync(abs).size; } catch { /* ignore */ }
          out.push({ rel: this.toRel(abs), size });
        }
      }
    };
    walk(this.root);
    out.sort((a, b) => a.rel.localeCompare(b.rel));
    this._files = out;
    return out;
  }

  isText(rel) { return TEXT_EXT.has(path.extname(rel).toLowerCase()); }
  isToolchain(rel) { return TOOLCHAIN_DIRS.some((d) => rel === d || rel.startsWith(d + '/')); }

  read(rel) {
    if (this._content.has(rel)) return this._content.get(rel);
    const abs = this.resolve(rel);
    const buf = fs.readFileSync(abs);
    let text;
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le').slice(1);
    else text = buf.toString('utf8').replace(/^\uFEFF/, '');
    if (buf.length <= MAX_FILE_BYTES) this._content.set(rel, text);
    return text;
  }

  version() {
    try { return fs.readFileSync(this.resolve('version.txt'), 'utf8').trim().split(/\r?\n/)[0].trim(); } catch { return 'inconnue'; }
  }

  overview() {
    const files = this.files();
    const areas = {};
    for (const f of files) {
      const top = f.rel.includes('/') ? f.rel.split('/')[0] : '(racine)';
      areas[top] ??= { files: 0, bytes: 0 };
      areas[top].files++; areas[top].bytes += f.size;
    }
    return {
      sdk_path: this.root,
      version: this.version(),
      total_files: files.length,
      areas: Object.entries(areas).map(([name, s]) => ({
        name, files: s.files, size_mb: +(s.bytes / 1048576).toFixed(1), description: AREAS[name] || '',
      })),
      key_files: [
        'SimConnect SDK/include/SimConnect.h',
        'WASM/include/MSFS/MSFS_Vars.h',
        'WASM/include/MSFS/MSFS_Events.h',
        'WASM/include/MSFS/Types/MSFS_EventsEnum.h',
        'WASM/include/MSFS/Legacy/gauges.h',
        'ModelBehaviorDefs/Asobo/Common/Autopilot.xml',
      ],
      note: "La documentation HTML officielle (liste complète des SimVars et unités) n'est pas incluse dans le SDK local : https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Simulation_Variables.htm",
    };
  }

  listDir(rel = '', depth = 1, limit = 400) {
    const base = this.resolve(rel);
    const st = fs.statSync(base);
    if (!st.isDirectory()) throw new Error(`"${rel}" n'est pas un dossier.`);
    const out = [];
    const walk = (dir, d) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
      for (const e of entries) {
        if (out.length >= limit) return;
        const abs = path.join(dir, e.name);
        const r = this.toRel(abs);
        if (e.isDirectory()) {
          out.push(r + '/');
          if (d < depth) walk(abs, d + 1);
        } else {
          let size = 0; try { size = fs.statSync(abs).size; } catch { /* */ }
          out.push(`${r}  (${size < 1024 ? size + ' o' : (size / 1024).toFixed(1) + ' Ko'})`);
        }
      }
    };
    walk(base, 1);
    return { path: rel || '/', entries: out, truncated: out.length >= limit };
  }

  readFile(rel, startLine = 1, maxLines = 300) {
    if (!this.isText(rel)) {
      const abs = this.resolve(rel);
      const size = fs.statSync(abs).size;
      return { path: rel, binary: true, size, note: 'Fichier binaire : contenu non affiché.' };
    }
    const lines = this.read(rel).split(/\r?\n/);
    const s = Math.max(1, startLine);
    const e = Math.min(lines.length, s + maxLines - 1);
    const body = lines.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(5)}| ${l}`).join('\n');
    return { path: rel, total_lines: lines.length, start_line: s, end_line: e, content: body, more: e < lines.length };
  }

  search({ query, regex = false, caseSensitive = false, pathFilter = '', extensions = [], contextLines = 1, maxResults = 40, includeToolchain = false }) {
    if (!query) throw new Error('query est vide.');
    let re;
    try {
      re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? '' : 'i');
    } catch (e) { throw new Error('Expression régulière invalide : ' + e.message); }
    const pf = String(pathFilter || '').replace(/\\/g, '/').toLowerCase();
    const exts = new Set((extensions || []).map((x) => (x.startsWith('.') ? x : '.' + x).toLowerCase()));
    const results = [];
    let filesMatched = 0, scanned = 0, truncated = false;
    for (const f of this.files()) {
      if (!this.isText(f.rel) || f.size > MAX_FILE_BYTES) continue;
      if (!includeToolchain && this.isToolchain(f.rel)) continue;
      if (pf && !f.rel.toLowerCase().includes(pf)) continue;
      if (exts.size && !exts.has(path.extname(f.rel).toLowerCase())) continue;
      scanned++;
      let text; try { text = this.read(f.rel); } catch { continue; }
      if (!re.test(text)) continue;
      filesMatched++;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        if (results.length >= maxResults) { truncated = true; break; }
        const a = Math.max(0, i - contextLines), b = Math.min(lines.length - 1, i + contextLines);
        const snippet = [];
        for (let j = a; j <= b; j++) snippet.push(`${j === i ? '>' : ' '}${String(j + 1).padStart(5)}| ${lines[j].slice(0, 300)}`);
        results.push({ file: f.rel, line: i + 1, snippet: snippet.join('\n') });
      }
      if (truncated) break;
    }
    return { query, files_scanned: scanned, files_matched: filesMatched, results, truncated };
  }

  // ---------- Catalogue des événements clés (K: / KEY_) ----------
  keyEvents() {
    if (this._keyEvents) return this._keyEvents;
    const rel = 'WASM/include/MSFS/Types/MSFS_EventsEnum.h';
    const text = this.read(rel);
    const list = [];
    const lines = text.split(/\r?\n/);
    let region = '';
    lines.forEach((l, i) => {
      const r = l.match(/#pragma\s+region\s+(.*)/);
      if (r) region = r[1].trim();
      const m = l.match(/^#define\s+KEY_([A-Z0-9_]+)\s+\((KEY_ID_MIN|THIRD_PARTY_EVENT_ID_MIN|[A-Z_]+)\s*\+\s*(\d+)\)\s*(\/\/.*)?$/);
      if (m) list.push({ event: m[1], define: 'KEY_' + m[1], offset: `${m[2]} + ${m[3]}`, region, comment: (m[4] || '').replace(/^\/\/\s*/, ''), line: i + 1 });
    });
    this._keyEvents = { file: rel, list };
    return this._keyEvents;
  }

  lookupKeyEvents(query, max = 50) {
    const { file, list } = this.keyEvents();
    const toks = String(query || '').toUpperCase().replace(/^K:|^KEY_/, '').split(/[\s_]+/).filter(Boolean);
    const exact = String(query || '').toUpperCase().replace(/^K:|^KEY_/, '').replace(/\s+/g, '_');
    let hits = list.filter((k) => toks.every((t) => k.event.includes(t)));
    hits.sort((a, b) => (b.event === exact) - (a.event === exact) || a.event.length - b.event.length);
    const vars = this.behaviorVars();
    const out = hits.slice(0, max).map((k) => {
      const usage = vars.get('K:' + k.event);
      return { ...k, simconnect_name: k.event, used_in_behaviors: usage ? usage.count : 0, example: usage?.examples?.[0] };
    });
    return { source: file, total_events: list.length, matches: hits.length, results: out };
  }

  // ---------- API SimConnect.h ----------
  lookupSimConnectApi(name) {
    const rel = 'SimConnect SDK/include/SimConnect.h';
    const lines = this.read(rel).split(/\r?\n/);
    const q = String(name || '').trim();
    if (!q) throw new Error('name est vide.');
    const qU = q.toUpperCase();
    const results = [];
    for (let i = 0; i < lines.length && results.length < 15; i++) {
      const l = lines[i];
      const fn = l.match(/SIMCONNECTAPI\s+(SimConnect_\w+)\s*\(/);
      if (fn && fn[1].toUpperCase().includes(qU.replace(/^SIMCONNECT_?/, 'SIMCONNECT_'))) {
        results.push({ kind: 'function', name: fn[1], line: i + 1, declaration: l.trim() });
        continue;
      }
      const blk = l.match(/^(SIMCONNECT_ENUM(?:_FLAGS)?|SIMCONNECT_STRUCT|SIMCONNECT_REFSTRUCT|struct|enum)\s+(\w+)/);
      if (blk && blk[2].toUpperCase().includes(qU)) {
        let j = i, body = [];
        if (l.includes(';') && !l.includes('{')) {
          // ENUM_FLAGS : déclaration puis constantes "static const ... NAME = value;"
          body.push(l);
          for (j = i + 1; j < lines.length && j < i + 60; j++) {
            if (/^\s*static const/.test(lines[j]) || /^\s*\/\//.test(lines[j])) body.push(lines[j]);
            else break;
          }
        } else {
          let depth = 0, started = false;
          for (j = i; j < lines.length && j < i + 250; j++) {
            body.push(lines[j]);
            depth += (lines[j].match(/{/g) || []).length;
            if (depth > 0) started = true;
            depth -= (lines[j].match(/}/g) || []).length;
            if (started && depth <= 0) break;
          }
        }
        results.push({ kind: blk[1].includes('ENUM') || blk[1] === 'enum' ? 'enum' : 'struct', name: blk[2], line: i + 1, definition: body.join('\n') });
      }
    }
    if (!results.length) {
      // constante isolée (ex. SIMCONNECT_OBJECT_ID_USER, SIMCONNECT_RECV_ID_EVENT)
      lines.forEach((l, i) => {
        if (results.length < 15 && l.toUpperCase().includes(qU)) results.push({ kind: 'reference', line: i + 1, text: l.trim() });
      });
    }
    return { source: rel, query: q, results, doc: 'https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_API_Reference.htm' };
  }

  // ---------- Variables référencées dans les ModelBehaviorDefs ----------
  behaviorVars() {
    if (this._behaviorVars) return this._behaviorVars;
    const map = new Map();
    const add = (key, unit, file, line, text) => {
      let v = map.get(key);
      if (!v) { v = { count: 0, units: new Set(), files: new Set(), examples: [] }; map.set(key, v); }
      v.count++;
      if (unit) v.units.add(unit.trim().toLowerCase());
      v.files.add(file);
      if (v.examples.length < 3) v.examples.push({ file, line, text: text.trim().slice(0, 240) });
    };
    for (const f of this.files()) {
      if (!f.rel.startsWith('ModelBehaviorDefs/') || !f.rel.toLowerCase().endsWith('.xml')) continue;
      let text; try { text = this.read(f.rel); } catch { continue; }
      text = text.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
      const lines = text.split(/\r?\n/);
      lines.forEach((l, i) => {
        for (const m of l.matchAll(/\((>?)([ALBEOHIKZ]):([A-Za-z0-9_ .:#{}-]+?)(?:,\s*([A-Za-z0-9 _/^*.-]+))?\)/g)) {
          const prefix = m[2];
          let name = m[3].trim();
          if (/[#{}]/.test(name)) name = name.replace(/#[A-Z_]+#|\{[^}]*\}/g, '#').trim();
          if (prefix === 'K') name = name.replace(/^\d+:/, '');
          if (prefix !== 'L' && prefix !== 'B' && prefix !== 'O') name = name.toUpperCase();
          if (!/[A-Za-z]{2}/.test(name)) continue; // nom entièrement paramétré (#VAR#) : inutile
          add(`${prefix}:${name}`, m[4], f.rel, i + 1, l);
        }
      });
    }
    this._behaviorVars = map;
    return map;
  }

  lookupBehaviorVars({ query = '', prefix = '', max = 60 }) {
    const map = this.behaviorVars();
    const toks = String(query).toUpperCase().split(/\s+/).filter(Boolean);
    const p = String(prefix || '').toUpperCase().replace(':', '');
    const out = [];
    for (const [key, v] of map) {
      if (p && !key.startsWith(p + ':')) continue;
      const K = key.toUpperCase();
      if (!toks.every((t) => K.includes(t))) continue;
      out.push({ var: key, uses: v.count, units: [...v.units], files: v.files.size, examples: v.examples.slice(0, 2) });
    }
    out.sort((a, b) => b.uses - a.uses);
    const byPrefix = {};
    for (const k of map.keys()) { const pp = k.split(':')[0]; byPrefix[pp] = (byPrefix[pp] || 0) + 1; }
    return {
      note: '"#" dans un nom = paramètre de template (index moteur, n° de radio…).',
      distinct_by_prefix: byPrefix,
      matches: out.length,
      results: out.slice(0, max),
    };
  }
}
