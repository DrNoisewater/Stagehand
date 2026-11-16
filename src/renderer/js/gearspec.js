/**
 * Rocksmith 2014 gear → the sound engine's tone description.
 *
 * A tone is { kind: 'guitar'|'bass', gear: [{ slot, key, knobs }] } where
 * slot is pre|amp|post|cab|rack, key is a Rocksmith gear key (Amp_OrangeAD50,
 * Pedal_SpringReverb, Cab_…) and knobs maps knob keys (Amp_OrangeAD50_Gain) or
 * knob names (Gain) to values. Missing knobs take Rocksmith's defaults.
 */
let DB = null;
let loading = null;

export function loadGear() {
  if (DB) return Promise.resolve(DB);
  if (!loading)
    loading = fetch(new URL('../data/gear2014.json', import.meta.url))
      .then((r) => r.json())
      .then((j) => (DB = j))
      .catch(() => (DB = {}));
  return loading;
}

/** For tests: use this gear table instead of fetching it. */
export function setGear(db) {
  DB = db;
}

export function gearInfo(key) {
  return (DB && DB[key]) || null;
}

/** Display name of a piece of gear ("Orange AD50", "Spring Reverb"). */
export function gearName(key) {
  const g = gearInfo(key);
  if (g) return g.n;
  return String(key || '')
    .replace(/^(Bass_)?(Amp|Cab|Pedal|Rack)_/i, '')
    .replace(/_(57|Condenser|Ribbon|Tube)_.*$/i, '')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

const ORDER = { pre: 0, amp: 1, post: 2, cab: 3, rack: 4 };
const clean = (s) => String(s).replace(/[\t\n\r]/g, ' ');

/** The text the engine reads (see native/dsp/sh_util.c). */
export function toSpec(tone) {
  const lines = [`kind\t${tone.kind === 'bass' ? 'bass' : 'guitar'}`];
  const gear = [...(tone.gear || [])].sort((a, b) => (ORDER[a.slot] ?? 9) - (ORDER[b.slot] ?? 9) || (a.order || 0) - (b.order || 0));
  for (const g of gear) {
    if (!g || g.bypass || !g.key || !(g.slot in ORDER)) continue;
    lines.push(`gear\t${g.slot}\t${clean(g.key)}`);
    const info = gearInfo(g.key);
    const given = g.knobs || {};
    const byName = {};
    for (const [k, v] of Object.entries(given)) byName[k.toLowerCase()] = v;
    if (info && info.k) {
      for (const [name, key, min, max, def, opt] of info.k) {
        if (opt && opt.live) continue; // 4.20: played live (labLatch), never rebuilds the tone
        let v = given[key];
        if (v === undefined) v = byName[name.toLowerCase()];
        if (v === undefined || !Number.isFinite(Number(v))) v = def;
        lines.push(`k\t${clean(name)}\t${Number(v)}\t${min}\t${max}`);
      }
      // 4.6: the movable mic in front of a cabinet (Mic Position / Distance / Angle, Room Mic)
      if (g.slot === 'cab')
        for (const [k, v] of Object.entries(given)) if (/^(Mic (Position|Distance|Angle)|Room Mic)$/.test(k) && Number.isFinite(Number(v))) lines.push(`k\t${k}\t${Number(v)}\t0\t100`);
    } else {
      for (const [k, v] of Object.entries(given)) {
        if (!Number.isFinite(Number(v))) continue;
        const name = k.startsWith(`${g.key}_`) ? k.slice(g.key.length + 1) : k;
        lines.push(`k\t${clean(name)}\t${Number(v)}\t0\t100`);
      }
    }
  }
  if (tone.gate) lines.push(`gate\t${Number(tone.gate)}`);
  return lines.join('\n') + '\n';
}

/** The amp's gain knob position (0..1), for the Gain slider's starting point. */
export function ampGain(tone) {
  const amp = (tone.gear || []).find((g) => g.slot === 'amp');
  if (!amp) return 0.5;
  const info = gearInfo(amp.key);
  const knobs = (info && info.k) || [];
  const pick = knobs.find(([n]) => /gain|pre ?amp|loudness|^vol|volume|speaker/i.test(n));
  if (!pick) return 0.5;
  const [name, key, min, max, def] = pick;
  const given = amp.knobs || {};
  let v = given[key] ?? Object.entries(given).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  if (v === undefined) v = def;
  return Math.max(0, Math.min(1, (Number(v) - min) / (max - min || 1)));
}

/** Short description of a tone's rig: "Super Drive → Marshall JCM800 → 1960 AX". */
export function describe(tone) {
  const gear = [...(tone.gear || [])].sort((a, b) => (ORDER[a.slot] ?? 9) - (ORDER[b.slot] ?? 9) || (a.order || 0) - (b.order || 0));
  return gear.map((g) => gearName(g.key)).join(' → ');
}

/** 4.20: The Lab's pedal numbers (native/dsp/sh_wacky.h): bit (1 << n) of the live footswitch and
 * switch masks. Keep in step with the engine. */
export const LAB_BITS = { Pedal_Quack: 1, Pedal_Croak: 2, Pedal_Caterwaul: 3, Pedal_Blorp: 4, Pedal_Gobble: 5, Pedal_Slug: 6, Pedal_Boing: 7, Pedal_Gremlin: 8, Pedal_Invader: 9, Pedal_Confetti: 10, Pedal_Blender: 11, Pedal_Fossil: 12, Pedal_Charmer: 13, Pedal_Haunt: 14 };

/** 4.20: the thirty that followed have a live slot each (their own footswitches and buttons, one
 * bit each, and one live value: a lever or a control that changes while you play). The engine's
 * slots are 15 + n and 79 + n (SHP_LABW0, SHP_LABV0 in native/dsp/sh_engine.h). */
export const LAB_KINDS = Object.fromEntries(
  ['Annwn', 'Apoptosis', 'Bifrost', 'BluePrince', 'Claude', 'DejaVu', 'Duat', 'EventHorizon', 'Fenrir', 'Inanna', 'Janus', 'Kitsune', 'Kukulkan', 'Long', 'Maui', 'Mimic', 'Molt', 'Nataraja', 'Nothing', 'Olympus', 'Ouroboros', 'Parasite', 'Reliquary', 'Seance', 'Severed', 'Shango', 'Tezcatl', 'Veles', 'WhoAreYou', 'Wukong'].map((n, i) => [`Pedal_${n}`, 15 + i]));
export const LAB_WORD0 = 15;
export const LAB_VAL0 = 79;

/** 4.20: the controls in a tone that change while you play without rebuilding it (Blue Prince's
 * Room): { pedal number: value }. */
export function labVals(tone) {
  const out = {};
  for (const g of (tone && tone.gear) || []) {
    const info = g && !g.bypass && gearInfo(g.key);
    if (!info || !info.k || !(g.key in LAB_KINDS)) continue;
    for (const [name, key, , , def, opt] of info.k) {
      if (!(opt && opt.live === 'val')) continue;
      const given = g.knobs || {};
      const v = given[key] ?? Object.entries(given).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] ?? def;
      out[LAB_KINDS[g.key]] = Number(v) || 0;
    }
  }
  return out;
}

/** 4.20: the switches in a tone that change while you play (Haunt's Slow/Fast), as the engine's mask. */
export function labLatch(tone) {
  let m = 0;
  for (const g of (tone && tone.gear) || []) {
    const info = g && !g.bypass && gearInfo(g.key);
    if (!info || !info.k || !(g.key in LAB_BITS)) continue;
    for (const [name, key, min, , def, opt] of info.k) {
      if (!(opt && opt.live)) continue;
      const given = g.knobs || {};
      let v = given[key] ?? Object.entries(given).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] ?? def;
      if (Number(v) > min + 0.5) m |= 1 << LAB_BITS[g.key];
    }
  }
  return m;
}
