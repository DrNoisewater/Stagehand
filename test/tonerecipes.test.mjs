// Create tone's starting sounds and the noise gate, measured through the real sound engine
// (the WebAssembly build), on a synthesised guitar: riff, lead line, chord, pickup noise.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { engine, cabIR, measure, noise, rmsDb, G, SH_ROOT } from './tonelab.mjs';

const R = await import(pathToFileURL(path.join(SH_ROOT, 'src/renderer/js/tonerecipes.js')).href);
const { cabinetFor } = await import(pathToFileURL(path.join(SH_ROOT, 'src/renderer/js/cabinets.js')).href);
const SR = 48000;
const eng = engine();
let failed = 0;
const ok = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
};

// --- the recipes are made of real gear with real knobs
ok('every starting sound and pedal uses gear and knobs the engine knows', () => {
  const gear = JSON.parse(fs.readFileSync(path.join(SH_ROOT, 'src/renderer/data/gear2014.json'), 'utf8'));
  for (const kind of ['guitar', 'bass']) {
    for (const p of R.PEDALS[kind]) {
      assert.ok(gear[p.key], `${p.key} is in the gear list`);
      const names = gear[p.key].k.map((k) => k[0].toLowerCase());
      for (const [n] of p.knobs) assert.ok(names.includes(n.toLowerCase()), `${p.key} has a ${n} knob`);
      for (const n of Object.keys(p.start)) assert.ok(names.includes(n.toLowerCase()), `${p.key} starts ${n}`);
    }
    for (const s of R.STYLES[kind]) {
      assert.ok(R.AMPS[kind].some((a) => a.pack === s.amp), `${s.id}: amp ${s.amp}`);
      for (const p of [...s.pre, ...s.post]) assert.ok(R.pedalFor(kind, p.key), `${s.id}: ${p.key} is a pedal you can add`);
    }
  }
  for (const id of ['thrash', 'modernmetal', 'hairlead', 'shred']) assert.ok(R.STYLES.guitar.some((s) => s.id === id), `${id} is a starting sound`);
});

ok('pedals move along the board and across the amp', () => {
  const b = [R.newPedal('guitar', 'Pedal_SuperDrive'), R.newPedal('guitar', 'Pedal_Chorus20')];
  assert.deepEqual(b.map((p) => p.where), ['pre', 'post']);
  const m = R.movePedal(b, 0, +1); // past the amp
  assert.deepEqual(m.map((p) => [p.key, p.where]), [['Pedal_SuperDrive', 'post'], ['Pedal_Chorus20', 'post']]);
  const back = R.movePedal(m, 1, -1); // chorus in front of the drive, still after the amp
  assert.deepEqual(back.map((p) => p.key), ['Pedal_Chorus20', 'Pedal_SuperDrive']);
  assert.deepEqual(R.movePedal(b, 0, -1).map((p) => p.key), b.map((p) => p.key)); // nothing left of the first
  const t = R.buildTone({ kind: 'guitar', ...R.fromStyle('guitar', R.styleOf('guitar', 'thrash')), cab: 'auto' });
  const order = t.gear.map((g) => g.slot);
  assert.deepEqual(order, ['pre', 'amp', 'cab', 'post', 'rack']);
});

// --- how they sound
const M = {};
for (const id of ['clean', 'thrash', 'modernmetal', 'metal', 'hairlead', 'shred']) {
  const t = R.buildTone({ kind: 'guitar', ...R.fromStyle('guitar', R.styleOf('guitar', id)), cab: 'auto' });
  const cab = cabinetFor(t);
  M[id] = measure(eng, t, { ir: cab ? cabIR(cab) : null });
}
console.log('     measured:', Object.entries(M).map(([k, m]) => `${k} drive ${m.softDrop} scoop ${m.scoop} bright ${m.bright} sustain ${m.sustainLead}s`).join(' | '));

ok('the clean sound stays clean; the metal and lead sounds are fully driven', () => {
  assert.ok(M.clean.softDrop > 12, `clean evens out picking by only a little (${M.clean.softDrop} dB of 18)`);
  for (const id of ['thrash', 'modernmetal', 'metal', 'hairlead', 'shred']) assert.ok(M[id].softDrop < 3, `${id} is saturated (${M[id].softDrop} dB)`);
});
ok('thrash is scooped and has bite; the leads push the mids and sing', () => {
  assert.ok(M.thrash.scoop < M.metal.scoop - 2, `thrash mids ${M.thrash.scoop} vs heavy metal ${M.metal.scoop}`);
  assert.ok(M.thrash.bright > M.metal.bright + 2, `thrash bite ${M.thrash.bright} vs ${M.metal.bright}`);
  for (const id of ['hairlead', 'shred']) {
    assert.ok(M[id].scoop > M.thrash.scoop + 3, `${id} mids ${M[id].scoop} vs thrash ${M.thrash.scoop}`);
    assert.ok(M[id].sustainLead >= 2, `${id} sustain ${M[id].sustainLead}s`);
  }
});

ok('the tube drive keeps the low end and rolls off the top, like the real pedal', () => {
  // the old drive cut 30 dB at 60 Hz (only fizz went into the amp)
  eng.build('kind\tguitar\ngear\tpre\tPedal_SuperDrive\nk\tGain\t12\t1\t100\nk\tTone\t58\t1\t100\ngate\t-200\n');
  const at = (hz) => {
    const n = SR * 0.4, x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.05 * Math.sin((2 * Math.PI * hz * i) / SR);
    return rmsDb(eng.run(x), n / 2, n) - rmsDb(x, n / 2, n);
  };
  const k = at(1000), lo = at(120) - k, hi = at(4000) - k;
  console.log(`     tube drive: 120 Hz ${lo.toFixed(1)} dB, 4 kHz ${hi.toFixed(1)} dB (against 1 kHz)`);
  assert.ok(lo > -14 && lo < -2, `120 Hz at ${lo.toFixed(1)} dB`);
  assert.ok(hi < 0, `4 kHz at ${hi.toFixed(1)} dB`);
});

// --- the noise gate: quiet between notes on a high-gain tone, without cutting notes short
const heavy = { kind: 'guitar', gear: [G('pre', 'Pedal_SuperDrive', { Gain: 10, Tone: 60 }, 0), G('amp', 'Amp_CA100', {}, 1), G('cab', 'Cab_CA412C_57_Cone', {}, 2)] };
ok('the noise gate silences hum and hiss between notes (Auto), and Off lets it through', () => {
  const ir = cabIR('4x12_straight');
  const res = {};
  for (const [mode, v] of [['auto', 0], ['off', -40]]) {
    eng.x.param(7, v);
    res[mode] = measure(eng, heavy, { ir, noiseDb: -66 }).noise;
  }
  eng.x.param(7, 0);
  console.log(`     noise between notes: auto ${res.auto} dB, off ${res.off} dB (under the playing)`);
  assert.ok(res.auto < -35, `auto: ${res.auto} dB`);
  assert.ok(res.off > -15, `off: ${res.off} dB`);
});

ok('a held note fading out is not cut until it sinks into the noise (Strong cuts sooner)', () => {
  const ir = cabIR('4x12_straight');
  const NZ = -66, rate = 10;
  const n = SR * 9, x = noise(n, NZ, 4);
  // a short chord, a pause (the gate learns the noise), then a note fading at 10 dB a second
  for (let i = 0; i < SR; i++) x[i] += 0.3 * Math.exp((-i / SR) * 3) * Math.sin((2 * Math.PI * 147 * i) / SR);
  for (let i = 0; i < SR * 6; i++) {
    const t = i / SR, a = 0.4 * 10 ** (-(rate * t) / 20);
    let v = 0;
    for (let k = 1; k <= 6; k++) v += Math.sin(2 * Math.PI * 196 * k * t + k) / k;
    x[SR * 3 + i] += a * v * 0.6;
  }
  const out = {};
  for (const [mode, v] of [['off', -40], ['auto', 0], ['strong', 8]]) {
    eng.x.param(7, v);
    eng.build(heavy, ir);
    out[mode] = eng.run(x);
  }
  eng.x.param(7, 0);
  const win = (y, t) => rmsDb(y, Math.floor(t * SR), Math.floor((t + 0.05) * SR));
  const cut = (y) => {
    for (let t = 3.1; t < 8.9; t += 0.05) if (win(y, t) < win(out.off, t) - 6) return t;
    return 9;
  };
  // where the note itself is as loud as the noise
  const meet = 3 + (20 * Math.log10(0.24) - NZ - 3) / rate;
  const a = cut(out.auto), s = cut(out.strong);
  console.log(`     the note meets the noise at ${meet.toFixed(2)} s: auto cuts at ${a.toFixed(2)} s, strong at ${s.toFixed(2)} s`);
  assert.ok(a > meet - 0.8, `auto cut the note ${(meet - a).toFixed(2)} s early`);
  assert.ok(s < a, 'strong closes sooner than auto');
  assert.ok(rmsDb(out.auto, SR * 1.8, SR * 2.8) - win(out.off, 3.2) < -35, 'quiet in the pause');
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('all ok');
