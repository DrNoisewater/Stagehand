/**
 * Real amps: which NAM capture plays in a tone's amp place.
 *
 * For a tone, in order:
 *  1. Real amps turned off (Settings) → the modelled amp.
 *  2. The tone's own choice: tone.capture = pack id, or 'off'.
 *  3. Your choice for that Rocksmith amp (Captures › assign), or 'off'.
 *  4. The curated capture for that amp (data/capturemap.json), once you've got it.
 *  Else the modelled amp, and the tone editor offers "Get real amp".
 * The Rocksmith gain knob picks among a pack's models (they're captured at
 * different gain settings); what's left of the difference is an input trim.
 */
import { ampGain } from './gearspec.js';

const EMPTY = { packs: [], assign: {}, map: { packs: {}, amps: {} }, t3k: {}, busy: null };
export const caps = { st: EMPTY, events: new EventTarget(), loaded: false };

function getOn() {
  try {
    return localStorage.getItem('stagehand.realAmps') !== 'off';
  } catch (_) {
    return true;
  }
}
let enabled = getOn();

export function realAmpsOn() {
  return enabled;
}

export function setRealAmps(on) {
  enabled = !!on;
  try {
    localStorage.setItem('stagehand.realAmps', on ? 'on' : 'off');
  } catch (_) {}
  caps.events.dispatchEvent(new Event('change'));
}

function bridge() {
  return typeof window !== 'undefined' && window.stagehand && window.stagehand.captures ? window.stagehand.captures : null;
}

async function call(name, ...args) {
  const b = bridge();
  if (!b) throw new Error('Not available here.');
  const r = await b[name](...args);
  if (r && r.__sh) {
    if (r.ok) return r.value;
    throw Object.assign(new Error(r.error || 'Something went wrong'), { code: r.code || null });
  }
  return r;
}

function set(st) {
  if (!st) return;
  caps.st = { ...EMPTY, ...st };
  caps.loaded = true;
  caps.events.dispatchEvent(new Event('change'));
}

/** Loads the list once and follows changes from the main process. */
export async function loadCaptures() {
  const b = bridge();
  if (!b) return caps.st;
  if (!caps._hooked && window.stagehand.on) {
    caps._hooked = true;
    window.stagehand.on('captures:change', (st) => set(st));
  }
  set(await call('get').catch(() => null));
  return caps.st;
}

export const capturesApi = {
  assign: (ampKey, packId) => call('assign', ampKey, packId).then(set),
  remove: (packId) => call('remove', packId).then(set),
  setKind: (packId, kind) => call('setKind', packId, kind).then(set),
  addFiles: async (ampKey) => {
    const r = await call('addFiles', ampKey);
    if (r && r.state) set(r.state);
    return r;
  },
  setKey: (id) => call('setKey', id).then(set),
  connect: () => call('connect').then(set),
  disconnect: () => call('disconnect').then(set),
  useBrowser: (on) => call('useBrowser', on).then(set),
  get: async (packKey, ampKey) => {
    const r = await call('get3k', packKey, ampKey);
    if (r && r.state) set(r.state);
    return r;
  },
  browse: async (ampKey, opts) => {
    const r = await call('browse', ampKey, opts);
    if (r && r.state) set(r.state);
    return r;
  },
};

export function ampOf(tone) {
  return ((tone && tone.gear) || []).find((g) => g.slot === 'amp' && !g.bypass) || null;
}

export function packById(id) {
  return caps.st.packs.find((p) => p.id === id) || null;
}

/** The curated TONE3000 capture for a Rocksmith amp: { key, def } or null. */
export function curatedFor(ampKey) {
  const k = caps.st.map && caps.st.map.amps ? caps.st.map.amps[ampKey] : null;
  return k && caps.st.map.packs[k] ? { key: k, def: caps.st.map.packs[k] } : null;
}

/** The pack you already have for a curated key (downloaded from TONE3000). */
export function packForCurated(key) {
  return caps.st.packs.find((p) => p.mapKey === key) || null;
}

function chooseModel(pack, gain) {
  const ms = pack.models || [];
  let best = ms[0];
  for (const m of ms) if (Math.abs((m.gain ?? 0.5) - gain) < Math.abs((best.gain ?? 0.5) - gain)) best = m;
  return best;
}

/**
 * What plays in this tone's amp place: { pack, model, path, url, fullRig, gainRef, ampKey, why }
 * or null for the modelled amp. why: 'tone' | 'yours' | 'curated'.
 */
export function resolveCapture(tone) {
  const amp = ampOf(tone);
  if (!amp || !enabled) return null;
  const ampKey = amp.key;
  let pack = null;
  let why = null;
  if (tone.capture === 'off') return null;
  if (tone.capture) {
    pack = packById(tone.capture);
    why = 'tone';
  }
  if (!pack) {
    const a = caps.st.assign[ampKey];
    if (a === 'off') return null;
    if (a) (pack = packById(a)), (why = 'yours');
  }
  if (!pack) {
    const c = curatedFor(ampKey);
    if (c) (pack = packForCurated(c.key)), (why = 'curated');
  }
  if (!pack || !pack.models || !pack.models.length) return null;
  const gain = ampGain(tone);
  const model = chooseModel(pack, gain);
  if (!model) return null;
  return {
    pack,
    model,
    path: model.path,
    url: model.url,
    fullRig: pack.kind === 'full',
    // the knob position this model plays as captured (unknown: as the tone has it)
    gainRef: model.gain ?? gain,
    ampKey,
    why,
  };
}

/** For the UI: is there a real amp to get for this tone? { key, def } or null. */
export function suggestionFor(tone) {
  const amp = ampOf(tone);
  if (!amp || resolveCapture(tone)) return null;
  if (tone.capture === 'off' || caps.st.assign[amp.key] === 'off') return null;
  const c = curatedFor(amp.key);
  return c && !packForCurated(c.key) ? c : null;
}

/** Short credit line: "Mesa Dual Rectifier · by deathblossomaudio". */
export function creditOf(pack) {
  if (!pack) return '';
  return `${pack.title}${pack.maker ? ` · by ${pack.maker}` : ''}`;
}
