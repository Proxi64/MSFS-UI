// Connexion SimConnect en direct (MSFS 2024 doit être lancé sur ce PC, ou SimConnect configuré en réseau).
import {
  open, Protocol, SimConnectConstants, SimConnectDataType, SimConnectPeriod,
  DataRequestFlag, EventFlag, RawBuffer, SimConnectException,
} from 'node-simconnect';

const APP_NAME = 'MSFS 2024 SDK MCP';
const OPEN_TIMEOUT_MS = 6000;
const REQ_TIMEOUT_MS = 4000;
const EXC_WAIT_MS = 350;

const exceptionName = (code) => SimConnectException[code] ?? `EXCEPTION_${code}`;

function normalizeVarName(name) {
  let n = String(name).trim();
  if (/^A:/i.test(n)) n = n.slice(2).trim();
  return n; // "L:xxx" conservé tel quel (lecture LVar supportée par MSFS 2024)
}

function remoteOptions() {
  const host = process.env.SIMCONNECT_HOST;
  const port = Number(process.env.SIMCONNECT_PORT);
  return host && port ? { remote: { host, port } } : undefined;
}

export class Sim {
  constructor() {
    this.handle = null;
    this.info = null;
    this.connecting = null;
    this.nextId = 100;
    this.pendingData = new Map();     // requestID -> {resolve, ...}
    this.pendingInput = new Map();    // requestID -> {resolve}
    this.sendOwners = new Map();      // sendId -> collector[]
    this.eventIds = new Map();        // nom événement -> clientEventId
    this.inputEvents = null;          // cache de l'énumération
    this.lastError = null;
  }

  id() { this.nextId = (this.nextId + 1) % 0x7fffffff || 100; return this.nextId; }

  async connect() {
    if (this.handle) return this.handle;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('délai de connexion dépassé')), OPEN_TIMEOUT_MS));
      try {
        const { recvOpen, handle } = await Promise.race([open(APP_NAME, Protocol.KittyHawk, remoteOptions()), timeout]);
        this.handle = handle;
        this.info = {
          application: recvOpen.applicationName,
          version: `${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}.${recvOpen.applicationBuildMajor}.${recvOpen.applicationBuildMinor}`,
          simconnect: `${recvOpen.simConnectVersionMajor}.${recvOpen.simConnectVersionMinor}.${recvOpen.simConnectBuildMajor}.${recvOpen.simConnectBuildMinor}`,
          connected_at: new Date().toISOString(),
        };
        this.wire(handle);
        return handle;
      } catch (e) {
        this.lastError = e?.message || String(e);
        throw new Error(`Impossible de se connecter à MSFS via SimConnect (${this.lastError}). Vérifiez que Microsoft Flight Simulator 2024 est lancé sur ce PC.`);
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  reset(reason) {
    this.lastError = reason;
    try { this.handle?.close(); } catch { /* */ }
    this.handle = null; this.info = null;
    this.eventIds.clear(); this.inputEvents = null;
    for (const p of this.pendingData.values()) p.reject(new Error('Connexion SimConnect fermée : ' + reason));
    for (const p of this.pendingInput.values()) p.reject(new Error('Connexion SimConnect fermée : ' + reason));
    this.pendingData.clear(); this.pendingInput.clear(); this.sendOwners.clear();
  }

  wire(h) {
    h.on('quit', () => this.reset('le simulateur a quitté'));
    h.on('close', () => this.reset('connexion fermée'));
    h.on('error', (e) => { this.lastError = e?.message || String(e); });
    h.on('exception', (ex) => {
      const owners = this.sendOwners.get(ex.sendId);
      const info = { exception: exceptionName(ex.exception), index: ex.index };
      if (owners) owners.forEach((o) => o(info)); else this.lastError = `${info.exception} (sendId ${ex.sendId})`;
    });
    h.on('simObjectData', (d) => {
      const p = this.pendingData.get(d.requestID);
      if (p) { this.pendingData.delete(d.requestID); p.resolve(d); }
    });
    h.on('getInputEvent', (d) => {
      const p = this.pendingInput.get(d.requestID);
      if (p) { this.pendingInput.delete(d.requestID); p.resolve(d); }
    });
  }

  track(sendId, collector) {
    const arr = this.sendOwners.get(sendId) || [];
    arr.push(collector); this.sendOwners.set(sendId, arr);
    setTimeout(() => this.sendOwners.delete(sendId), 10000);
  }

  status() {
    return { connected: !!this.handle, sim: this.info, last_error: this.lastError };
  }

  // ---------- Lecture de variables ----------
  async getVars(vars) {
    const h = await this.connect();
    const def = this.id(), req = this.id();
    const errors = {};
    const specs = vars.map((v, i) => {
      const name = normalizeVarName(v.name);
      const isString = v.type === 'string';
      const unit = isString ? null : (v.unit || (v.type === 'bool' ? 'bool' : 'number'));
      const sendId = h.addToDataDefinition(def, name, unit,
        isString ? SimConnectDataType.STRING256 : SimConnectDataType.FLOAT64, 0, i);
      this.track(sendId, (ex) => { errors[i] = ex.exception; });
      return { i, name, unit, isString, isBool: v.type === 'bool' };
    });
    const reqSend = h.requestDataOnSimObject(req, def, SimConnectConstants.OBJECT_ID_USER,
      SimConnectPeriod.ONCE, DataRequestFlag.DATA_REQUEST_FLAG_TAGGED);
    let reqError = null;
    this.track(reqSend, (ex) => { reqError = ex.exception; });

    const data = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pendingData.delete(req); resolve(null); }, REQ_TIMEOUT_MS);
      this.pendingData.set(req, { resolve: (d) => { clearTimeout(t); resolve(d); }, reject: (e) => { clearTimeout(t); reject(e); } });
    });
    try { h.clearDataDefinition(def); } catch { /* */ }

    const values = {};
    if (data) {
      for (let k = 0; k < data.defineCount; k++) {
        const tag = data.data.readInt32();
        const s = specs[tag];
        if (!s) break;
        values[tag] = s.isString ? data.data.readString256() : data.data.readFloat64();
      }
    }
    return specs.map((s) => {
      const r = { name: s.name, unit: s.unit ?? undefined };
      if (s.i in values) {
        let v = values[s.i];
        if (s.isBool) v = v !== 0;
        else if (typeof v === 'number') v = Math.round(v * 1e6) / 1e6;
        r.value = v;
      } else {
        r.error = errors[s.i] || reqError || (data ? 'valeur non renvoyée' : 'pas de réponse (délai dépassé)');
      }
      return r;
    });
  }

  // ---------- Écriture de variables ----------
  async setVar(name, unit, value) {
    const h = await this.connect();
    const def = this.id();
    const n = normalizeVarName(name);
    const errs = [];
    const s1 = h.addToDataDefinition(def, n, unit || 'number', SimConnectDataType.FLOAT64);
    this.track(s1, (ex) => errs.push(ex.exception));
    const buf = new RawBuffer(8);
    buf.writeFloat64(Number(value));
    const s2 = h.setDataOnSimObject(def, SimConnectConstants.OBJECT_ID_USER, { buffer: buf, arrayCount: 0, tagged: false });
    this.track(s2, (ex) => errs.push(ex.exception));
    await new Promise((r) => setTimeout(r, EXC_WAIT_MS));
    try { h.clearDataDefinition(def); } catch { /* */ }
    if (errs.length) throw new Error(`SimConnect a refusé l'écriture de "${n}" : ${errs.join(', ')} (variable inconnue ou non modifiable — essayez plutôt un événement K:).`);
    return { name: n, unit: unit || 'number', value: Number(value), status: 'envoyé' };
  }

  // ---------- Événements clés ----------
  async sendEvent(event, params = []) {
    const h = await this.connect();
    const name = String(event).trim().replace(/^K:/i, '').replace(/^KEY_/i, '');
    const errs = [];
    let cid = this.eventIds.get(name);
    if (cid === undefined) {
      cid = this.id();
      const s = h.mapClientEventToSimEvent(cid, name);
      let mapErr = null;
      this.track(s, (ex) => { mapErr = ex.exception; });
      await new Promise((r) => setTimeout(r, EXC_WAIT_MS));
      if (mapErr) throw new Error(`Événement "${name}" non reconnu par le simulateur (${mapErr}).`);
      this.eventIds.set(name, cid);
    }
    const p = params.map((x) => (Number(x) >>> 0));
    let s;
    if (p.length <= 1) {
      s = h.transmitClientEvent(SimConnectConstants.OBJECT_ID_USER, cid, p[0] ?? 0, 1, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY);
    } else {
      s = h.transmitClientEventEx(SimConnectConstants.OBJECT_ID_USER, cid, 1, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY, p[0], p[1], p[2], p[3], p[4]);
    }
    this.track(s, (ex) => errs.push(ex.exception));
    await new Promise((r) => setTimeout(r, EXC_WAIT_MS));
    if (errs.length) throw new Error(`Envoi de "${name}" refusé : ${errs.join(', ')}`);
    return { event: name, params: params.map(Number), status: 'envoyé' };
  }

  // ---------- Input events (B: vars, MSFS 2024) ----------
  async listInputEvents(force = false) {
    const h = await this.connect();
    if (this.inputEvents && !force) return this.inputEvents;
    const req = this.id();
    const list = [];
    await new Promise((resolve) => {
      let idle;
      const done = () => { h.off?.('inputEventsList', onList); h.removeListener?.('inputEventsList', onList); resolve(); };
      const onList = (r) => {
        if (r.requestID !== req) return;
        r.inputEventDescriptors.forEach((d) => list.push({ name: d.name, hash: d.inputEventIdHash.toString(), type: d.type === 1 ? 'string' : 'number' }));
        clearTimeout(idle);
        if (r.entryNumber + 1 >= r.outOf) done(); else idle = setTimeout(done, 1500);
      };
      h.on('inputEventsList', onList);
      const s = h.enumerateInputEvents(req);
      this.track(s, () => { clearTimeout(idle); done(); });
      idle = setTimeout(done, REQ_TIMEOUT_MS);
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.inputEvents = list;
    return list;
  }

  async findInputEvent(name) {
    const list = await this.listInputEvents();
    const n = String(name).replace(/^B:/i, '');
    const ev = list.find((e) => e.name === n) || list.find((e) => e.name.toLowerCase() === n.toLowerCase());
    if (!ev) throw new Error(`Input event "${n}" introuvable pour l'avion chargé (utilisez sim_list_input_events).`);
    return ev;
  }

  async getInputEvent(name) {
    const h = await this.connect();
    const ev = await this.findInputEvent(name);
    const req = this.id();
    let err = null;
    const s = h.getInputEvent(req, BigInt(ev.hash));
    this.track(s, (ex) => { err = ex.exception; });
    const d = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pendingInput.delete(req); resolve(null); }, REQ_TIMEOUT_MS);
      this.pendingInput.set(req, { resolve: (x) => { clearTimeout(t); resolve(x); }, reject: (e) => { clearTimeout(t); reject(e); } });
    });
    if (!d) throw new Error(`Pas de réponse pour "${ev.name}"${err ? ' : ' + err : ''}.`);
    return { name: ev.name, value: d.value };
  }

  async setInputEvent(name, value) {
    const h = await this.connect();
    const ev = await this.findInputEvent(name);
    const errs = [];
    const v = ev.type === 'string' ? String(value) : Number(value);
    const s = h.setInputEvent(BigInt(ev.hash), v);
    this.track(s, (ex) => errs.push(ex.exception));
    await new Promise((r) => setTimeout(r, EXC_WAIT_MS));
    if (errs.length) throw new Error(`Écriture de "${ev.name}" refusée : ${errs.join(', ')}`);
    return { name: ev.name, value: v, status: 'envoyé' };
  }
}

export const SNAPSHOT_VARS = [
  { name: 'TITLE', type: 'string' },
  { name: 'ATC MODEL', type: 'string' },
  { name: 'ATC ID', type: 'string' },
  { name: 'PLANE LATITUDE', unit: 'degrees' },
  { name: 'PLANE LONGITUDE', unit: 'degrees' },
  { name: 'PLANE ALTITUDE', unit: 'feet' },
  { name: 'PLANE ALT ABOVE GROUND', unit: 'feet' },
  { name: 'INDICATED ALTITUDE', unit: 'feet' },
  { name: 'AIRSPEED INDICATED', unit: 'knots' },
  { name: 'GROUND VELOCITY', unit: 'knots' },
  { name: 'AIRSPEED MACH', unit: 'mach' },
  { name: 'VERTICAL SPEED', unit: 'feet per minute' },
  { name: 'PLANE HEADING DEGREES MAGNETIC', unit: 'degrees' },
  { name: 'PLANE PITCH DEGREES', unit: 'degrees' },
  { name: 'PLANE BANK DEGREES', unit: 'degrees' },
  { name: 'SIM ON GROUND', unit: 'bool', type: 'bool' },
  { name: 'AUTOPILOT MASTER', unit: 'bool', type: 'bool' },
  { name: 'AUTOPILOT HEADING LOCK DIR', unit: 'degrees' },
  { name: 'AUTOPILOT ALTITUDE LOCK VAR', unit: 'feet' },
  { name: 'AUTOPILOT AIRSPEED HOLD VAR', unit: 'knots' },
  { name: 'AUTOPILOT VERTICAL HOLD VAR', unit: 'feet per minute' },
  { name: 'GEAR HANDLE POSITION', unit: 'bool', type: 'bool' },
  { name: 'FLAPS HANDLE INDEX', unit: 'number' },
  { name: 'SPOILERS HANDLE POSITION', unit: 'percent' },
  { name: 'BRAKE PARKING POSITION', unit: 'bool', type: 'bool' },
  { name: 'FUEL TOTAL QUANTITY WEIGHT', unit: 'kilograms' },
  { name: 'KOHLSMAN SETTING MB', unit: 'millibars' },
];
