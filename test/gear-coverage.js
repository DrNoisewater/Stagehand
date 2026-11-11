/**
 * 4.5.x: runs every amp, pedal and rack in gear2014.json through the real C engine
 * (native/build/gear_cover_test) and reports: does the piece change the sound, and does
 * each of its knobs (min vs max)? Writes src/renderer/data/gear-live.json, which the Gear
 * Showroom and Create a Tone use so a knob that does nothing is never shown as turnable.
 *   node test/gear-coverage.js [--write]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'native', 'build', 'gear_cover_test');
const G = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/data/gear2014.json'), 'utf8'));
const BASE = { guitar: ['amp\tAmp_TW22', 'cab\tCab_TW112C_57_Cone'], bass: ['amp\tBass_Amp_LT25B', 'cab\tBass_Cab_CS112BC_57_Cone'] };
const spec = (kind, gear) => `kind\t${kind}\n` + gear.map(([slot, key, knobs]) => {
  const info = G[key];
  const lines = [`gear\t${slot}\t${key}`];
  if (info && info.k) for (const [name, , min, max, def] of info.k) lines.push(`k\t${name}\t${knobs && name in knobs ? knobs[name] : def}\t${min}\t${max}`);
  return lines.join('\n');
}).join('\n') + '\n';
const run = (parts) => {
  const out = execFileSync(BIN, { input: parts.map(([label, s]) => `@@ ${label}\n${s}`).join('') }).toString();
  return Object.fromEntries(out.trim().split('\n').map((l) => l.split('\t')).map(([label, ok, db]) => [label, { ok: ok === '1', db: Number(db) }]));
};
const result = {};
let quietGear = [];
let deadKnobs = 0;
let liveKnobs = 0;
const only = process.argv.filter((x) => !x.startsWith('--')).slice(2);
for (const [key, g] of Object.entries(G)) {
  if (!['amp', 'pedal', 'rack'].includes(g.t)) continue;
  if (only.length && !only.includes(key)) continue;
  const kind = /^Bass_/.test(key) ? 'bass' : 'guitar';
  // a gate only matters where there's hiss to stop: judge it in front of a high-gain amp
  const base = (/NoiseGate/.test(key) ? ['amp\tAmp_HG500', 'cab\tCab_HG2120C_57_Cone'] : BASE[kind]).map((l) => l.split('\t'));
  const slot = g.t === 'amp' ? 'amp' : g.t === 'rack' ? 'rack' : /Verb|Delay|Echo|Chorus|Flange|Phase|Trem|Vibe|Rotatoe|Mod/.test(key) ? 'post' : 'pre';
  const withIt = g.t === 'amp' ? [['amp', key], base[1]] : [base[0], [slot, key], base[1]];
  // the reference amp for amps: a different amp than the one being tested
  const refAmp = kind === 'bass' ? (key === 'Bass_Amp_EdenE300' ? 'Bass_Amp_LT25B' : 'Bass_Amp_EdenE300') : key === 'Amp_AT20' ? 'Amp_AT120' : 'Amp_AT20';
  const parts = [['base', spec(kind, g.t === 'amp' ? [['amp', refAmp], base[1]] : base)], ['with', spec(kind, withIt)]];
  const r = run(parts);
  const knobs = {};
  // each knob min vs max, with the piece's other knobs at their defaults, then all at max, then all at min:
  // a knob counts as live if it changes the sound in any of these (an EQ's frequency knob only
  // matters once its band is boosted, as on the real thing)
  for (const [name, , min, max] of g.k || []) {
    let best = -120;
    for (const ctx of ['def', 'max', 'min']) {
      const others = (v) => Object.fromEntries((g.k || []).map(([n, , lo, hi, def]) => [n, n === name ? v : ctx === 'max' ? hi : ctx === 'min' ? lo : def]));
      const at = (v) => spec(kind, withIt.map(([s, k]) => [s, k, k === key ? others(v) : null]));
      const r2 = run([['min', at(min)], ['max', at(max)]]);
      best = Math.max(best, r2.max.db);
      if (best > -40) break;
    }
    knobs[name] = Math.round(best);
    if (best > -40) liveKnobs++;
    else deadKnobs++;
  }
  const changes = r.with.db;
  if (!(changes > -40)) quietGear.push(key);
  result[key] = { live: changes > -40, ok: r.with.ok, db: Math.round(changes), knobs };
}
// 4.6: the movable mic in front of the cabinet (Mic Position / Distance / Angle, Room Mic)
let micBad = 0;
if (!only.length) {
  const cabBase = 'kind\tguitar\ngear\tamp\tAmp_HG500\ngear\tcab\tCab_HG2120C_57_Cone\n';
  const parts = [['base', cabBase], ['same', cabBase + 'k\tMic Position\t8\t0\t100\n']];
  for (const [n, v] of [['Mic Position', 90], ['Mic Distance', 100], ['Mic Angle', 100], ['Room Mic', 100]]) parts.push([n, cabBase + `k\t${n}\t${v}\t0\t100\n`]);
  const r = run(parts);
  const moved = Object.entries(r).filter(([n]) => !['base', 'same'].includes(n));
  micBad = moved.filter(([, x]) => !(x.db > -40)).length + (r.same.db > -60 ? 1 : 0);
  console.log(`mic: ${moved.map(([n, x]) => `${n} ${x.db.toFixed(1)} dB`).join(', ')}; at the cone it matches the old cone sound (${r.same.db.toFixed(0)} dB)`);
}
console.log(`${Object.keys(result).length} pieces checked; ${quietGear.length} change nothing: ${quietGear.join(', ') || 'none'}`);
console.log(`knobs: ${liveKnobs} change the sound, ${deadKnobs} don't`);
for (const [k, v] of Object.entries(result)) {
  const dead = Object.entries(v.knobs).filter(([, d]) => d <= -40).map(([n]) => n);
  if (dead.length) console.log(`  ${k}: no effect from ${dead.join(', ')}`);
}
if (process.argv.includes('--write') && !only.length) fs.writeFileSync(path.join(ROOT, 'src/renderer/data/gear-live.json'), JSON.stringify(result));
if (process.argv.includes('--strict') && (deadKnobs > 0 || micBad > 0)) process.exit(1);
