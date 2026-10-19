#!/usr/bin/env node
// Serveur MCP « MSFS 2024 SDK » — référence du SDK + SimConnect en direct.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Sdk } from './sdk.js';
import { Sim, SNAPSHOT_VARS } from './sim.js';

const sdk = new Sdk();
const sim = new Sim();

const server = new McpServer(
  { name: 'msfs-2024-sdk', version: '1.0.0' },
  {
    instructions:
      "Outils pour Microsoft Flight Simulator 2024. Les outils sdk_* lisent le SDK installé localement " +
      "(SimConnect.h, en-têtes WASM, ModelBehaviorDefs, schémas). Les outils sim_* parlent au simulateur en direct via SimConnect " +
      "et nécessitent que MSFS 2024 soit lancé. Pour trouver le nom exact d'un événement, utiliser sdk_key_events ; " +
      "pour des exemples réels d'usage d'une SimVar avec son unité, utiliser sdk_behavior_vars.",
  },
);

const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e?.message || String(e) }] });
const wrap = (fn) => async (args) => { try { return ok(await fn(args || {})); } catch (e) { return fail(e); } };
const RO = { readOnlyHint: true, openWorldHint: false };

// ---------------- Référence SDK ----------------
server.registerTool('sdk_overview', {
  title: 'Vue d’ensemble du SDK',
  description: 'Version du SDK MSFS 2024 installé, chemin, grandes zones (SimConnect, WASM, ModelBehaviorDefs…) et fichiers clés.',
  inputSchema: {},
  annotations: RO,
}, wrap(() => sdk.overview()));

server.registerTool('sdk_list_dir', {
  title: 'Lister un dossier du SDK',
  description: 'Liste le contenu d’un dossier du SDK (chemin relatif à la racine du SDK, ex. "WASM/include/MSFS").',
  inputSchema: {
    path: z.string().default('').describe('Chemin relatif ; vide = racine'),
    depth: z.number().int().min(1).max(5).default(1),
  },
  annotations: RO,
}, wrap(({ path, depth }) => sdk.listDir(path, depth)));

server.registerTool('sdk_read_file', {
  title: 'Lire un fichier du SDK',
  description: 'Lit un fichier texte du SDK avec numéros de ligne (en-têtes .h, XML, JSON, exemples .cs/.cpp…).',
  inputSchema: {
    path: z.string().describe('Chemin relatif, ex. "SimConnect SDK/include/SimConnect.h"'),
    start_line: z.number().int().min(1).default(1),
    max_lines: z.number().int().min(1).max(2000).default(300),
  },
  annotations: RO,
}, wrap(({ path, start_line, max_lines }) => sdk.readFile(path, start_line, max_lines)));

server.registerTool('sdk_search', {
  title: 'Rechercher dans le SDK',
  description: 'Recherche plein texte (ou regex) dans tous les fichiers texte du SDK. La toolchain LLVM/WASI est exclue par défaut.',
  inputSchema: {
    query: z.string().describe('Texte ou expression régulière'),
    regex: z.boolean().default(false),
    case_sensitive: z.boolean().default(false),
    path_filter: z.string().default('').describe('Sous-chaîne que le chemin doit contenir, ex. "ModelBehaviorDefs/Asobo/Airliner" ou "MSFS_"'),
    extensions: z.array(z.string()).default([]).describe('Ex. ["h","xml"]'),
    context_lines: z.number().int().min(0).max(10).default(1),
    max_results: z.number().int().min(1).max(200).default(40),
    include_toolchain: z.boolean().default(false),
  },
  annotations: RO,
}, wrap((a) => sdk.search({
  query: a.query, regex: a.regex, caseSensitive: a.case_sensitive, pathFilter: a.path_filter,
  extensions: a.extensions, contextLines: a.context_lines, maxResults: a.max_results, includeToolchain: a.include_toolchain,
})));

server.registerTool('sdk_key_events', {
  title: 'Chercher un événement clé (K:)',
  description: 'Cherche dans le catalogue officiel des ~2000 événements clés (MSFS_EventsEnum.h). Mots séparés = tous requis, ex. "AP ALT SET". Renvoie le nom à utiliser avec SimConnect / sim_send_event et un exemple d’usage tiré des ModelBehaviorDefs.',
  inputSchema: {
    query: z.string().describe('Ex. "AP_MASTER", "flaps", "baro set", "com radio swap"'),
    max_results: z.number().int().min(1).max(300).default(50),
  },
  annotations: RO,
}, wrap(({ query, max_results }) => sdk.lookupKeyEvents(query, max_results)));

server.registerTool('sdk_simconnect_api', {
  title: 'Chercher dans l’API SimConnect',
  description: 'Renvoie la signature d’une fonction SimConnect_*, ou la définition complète d’un enum/struct de SimConnect.h (ex. "AddToDataDefinition", "SIMCONNECT_PERIOD", "SIMCONNECT_RECV_EVENT").',
  inputSchema: { name: z.string() },
  annotations: RO,
}, wrap(({ name }) => sdk.lookupSimConnectApi(name)));

server.registerTool('sdk_behavior_vars', {
  title: 'Variables utilisées dans les ModelBehaviorDefs',
  description: 'Catalogue des variables (A: SimVars, L: LVars, K: événements, B: input events…) réellement utilisées dans les templates Asobo/WorkingTitle du SDK, avec unités observées et exemples de code RPN. Utile pour trouver le bon nom et la bonne unité. Préfixes : A=SimVar, L=LVar, K=événement clé, B=input event, E=environnement, O=composant, H=événement HTML, I=instrument.',
  inputSchema: {
    query: z.string().default('').describe('Mots à chercher dans le nom, ex. "AUTOPILOT ALTITUDE"'),
    prefix: z.enum(['', 'A', 'L', 'K', 'B', 'E', 'O', 'H', 'I', 'Z']).default('').describe('Filtrer par type'),
    max_results: z.number().int().min(1).max(300).default(60),
  },
  annotations: RO,
}, wrap(({ query, prefix, max_results }) => sdk.lookupBehaviorVars({ query, prefix, max: max_results })));

// ---------------- SimConnect en direct ----------------
const varSpec = z.object({
  name: z.string().describe('SimVar (ex. "PLANE ALTITUDE", "NAV ACTIVE FREQUENCY:1") ou LVar préfixée "L:" (ex. "L:S_FCU_AP1")'),
  unit: z.string().optional().describe('Unité SimConnect, ex. "feet", "knots", "degrees", "bool", "number". Défaut "number".'),
  type: z.enum(['number', 'bool', 'string']).default('number'),
});

server.registerTool('sim_status', {
  title: 'État de la connexion au simulateur',
  description: 'Tente de se connecter à MSFS 2024 via SimConnect et renvoie la version du simulateur, ou l’erreur.',
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
}, wrap(async () => { try { await sim.connect(); } catch { /* état renvoyé ci-dessous */ } return sim.status(); }));

server.registerTool('sim_snapshot', {
  title: 'Instantané du vol',
  description: 'Lit d’un coup l’état courant de l’avion : identité, position, altitudes, vitesses, attitude, consignes pilote auto, train, volets, carburant, calage altimétrique.',
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: true },
}, wrap(async () => {
  const r = await sim.getVars(SNAPSHOT_VARS);
  return Object.fromEntries(r.map((x) => [x.name, x.error ? `⚠ ${x.error}` : x.value]));
}));

server.registerTool('sim_get_vars', {
  title: 'Lire des variables',
  description: 'Lit une ou plusieurs SimVars (A:) ou LVars (L:) sur l’avion de l’utilisateur, en une seule requête.',
  inputSchema: { vars: z.array(varSpec).min(1).max(100) },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, wrap(({ vars }) => sim.getVars(vars)));

server.registerTool('sim_set_var', {
  title: 'Écrire une variable',
  description: 'Écrit une SimVar modifiable ou une LVar (L:) sur l’avion de l’utilisateur. Beaucoup de SimVars sont en lecture seule : préférer alors sim_send_event.',
  inputSchema: {
    name: z.string(),
    unit: z.string().default('number'),
    value: z.number(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}, wrap(({ name, unit, value }) => sim.setVar(name, unit, value)));

server.registerTool('sim_send_event', {
  title: 'Envoyer un événement',
  description: 'Envoie un événement clé (ex. "AP_MASTER", "AP_ALT_VAR_SET_ENGLISH" avec [35000], "KOHLSMAN_SET") ou un événement custom d’add-on (nom contenant un point, ex. "A32NX.FCU_HDG_INC"). Jusqu’à 5 paramètres entiers.',
  inputSchema: {
    event: z.string(),
    params: z.array(z.number()).max(5).default([]),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}, wrap(({ event, params }) => sim.sendEvent(event, params)));

server.registerTool('sim_list_input_events', {
  title: 'Lister les input events (B:)',
  description: 'Énumère les input events MSFS 2024 de l’avion chargé (boutons/interrupteurs du cockpit), filtrables par texte.',
  inputSchema: {
    filter: z.string().default(''),
    refresh: z.boolean().default(false).describe('Forcer une nouvelle énumération (après changement d’avion)'),
    max_results: z.number().int().min(1).max(2000).default(200),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, wrap(async ({ filter, refresh, max_results }) => {
  const list = await sim.listInputEvents(refresh);
  const toks = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = list.filter((e) => toks.every((t) => e.name.toLowerCase().includes(t)));
  return { total: list.length, matches: hits.length, results: hits.slice(0, max_results).map(({ name, type }) => ({ name, type })) };
}));

server.registerTool('sim_get_input_event', {
  title: 'Lire un input event',
  description: 'Lit la valeur courante d’un input event (B:) de l’avion chargé.',
  inputSchema: { name: z.string() },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, wrap(({ name }) => sim.getInputEvent(name)));

server.registerTool('sim_set_input_event', {
  title: 'Actionner un input event',
  description: 'Fixe la valeur d’un input event (B:) — équivaut à manipuler la commande du cockpit.',
  inputSchema: { name: z.string(), value: z.union([z.number(), z.string()]) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}, wrap(({ name, value }) => sim.setInputEvent(name, value)));

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[msfs-2024-sdk] prêt — SDK : ${sdk.root || '(non trouvé)'}\n`);
