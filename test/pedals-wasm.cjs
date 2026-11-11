// 4.7: the drive, fuzz and pitch pedals behave like the real ones, through the shipped engine (rig-dsp.wasm).
// Drives clean up when you play softer, the gain knob adds distortion, the tone knob adds treble,
// nothing blows up; pitch pedals land on the right note and hold it steady (no warble).
const fs = require('node:fs');
const path = require('node:path');
const G = require('../src/renderer/data/gear2014.json');

const SR = 48000;
const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '../src/renderer/worklets/rig-dsp.wasm'))), {}).exports;
const need = x.mem_needed();
if (need > x.memory.buffer.byteLength) x.memory.grow(Math.ceil((need - x.memory.buffer.byteLength) / 65536));

let bad = 0;
const ok = (c, msg) => {
  console.log(c ? 'ok  ' : 'FAIL', msg);
  if (!c) bad++;
};

const spec = (key, knobs = {}) => {
  let s = `kind\t${/^Bass_/.test(key) ? 'bass' : 'guitar'}\ngear\t${G[key].t === 'rack' ? 'rack' : 'pre'}\t${key}\n`;
  for (const [n, , lo, hi, d] of G[key].k || []) s += `k\t${n}\t${n in knobs ? knobs[n] : d}\t${lo}\t${hi}\n`;
  return s;
};
// render `secs` of a signal through one pedal (a fresh engine each time); returns the left output
const render = (key, knobs, sig, secs = 1.5) => {
  if (!x.init(SR)) throw new Error('init');
  const s = Buffer.from(spec(key, knobs) + '\0');
  new Uint8Array(x.memory.buffer, x.buf_spec(), s.length).set(s);
  if (!x.build(0)) throw new Error('build ' + key);
  x.select(0);
  const input = new Float32Array(x.memory.buffer, x.buf_in(), 128);
  const out = new Float32Array(x.memory.buffer, x.buf_l(), 128);
  const n = Math.round(secs * SR);
  const y = new Float32Array(n);
  for (let o = 0; o < n; o += 128) {
    for (let i = 0; i < 128; i++) input[i] = sig(o + i);
    x.process(128);
    for (let i = 0; i < 128 && o + i < n; i++) y[o + i] = out[i];
  }
  return y;
};
const amp = (y, a, n, hz) => {
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re += y[a + i] * w * Math.cos((2 * Math.PI * hz * i) / SR);
    im += y[a + i] * w * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return (4 * Math.hypot(re, im)) / n;
};
const db = (v) => 20 * Math.log10(v + 1e-12);
const sine = (hz, a) => (i) => a * Math.sin((2 * Math.PI * hz * i) / SR);
// a string-like note: every harmonic, falling off like a plucked string's
const saw = (hz, a) => (i) => {
  let v = 0;
  for (let k = 1; k <= 40; k++) v += Math.sin((2 * Math.PI * hz * k * i) / SR) / k;
  return a * 0.55 * v;
};
// harmonics of a 110 Hz note over the last half second: distortion (dB), and brightness: the top
// harmonics (1.1 to 4.4 kHz) against the bottom ones (110 to 550 Hz), in dB
const harm = (y) => {
  const a = y.length - SR / 2, n = SR / 2;
  let h1 = 0, rest = 0, top = 0, low = 0;
  for (let k = 1; k <= 40; k++) {
    const v = amp(y, a, n, 110 * k) ** 2;
    if (k === 1) h1 = v;
    else rest += v;
    if (k <= 5) low += v;
    if (k >= 10) top += v;
  }
  return { thd: 10 * Math.log10(rest / h1), bright: 10 * Math.log10(top / low) };
};

// --- drives and fuzzes
const DRIVES = ['Pedal_SuperDrive', 'Bass_Pedal_BassOverdrive', 'Pedal_VintageDistortion', 'Pedal_Distortion', 'Pedal_MetalDistortion', 'Pedal_BuzzOne', 'Pedal_BuzzToo', 'Pedal_CaptFuzzle', 'Pedal_FuzzWasHe', 'Pedal_GermaniumDrive', 'Pedal_LineDrive', 'Pedal_CustomDrive', 'Pedal_MarshallGuvnorPlus', 'Pedal_ShredZone', 'Bass_Pedal_BassDistortion', 'Bass_Pedal_BassFuzz', 'Pedal_RangeBooster'];
for (const key of DRIVES) {
  // a very loud note, then silence: finite, bounded, and it goes quiet
  const y = render(key, {}, (i) => (i < SR ? Math.sin((2 * Math.PI * 82.4 * i) / SR) : 0), 2);
  let finite = true, peak = 0, tail = 0;
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) finite = false;
    peak = Math.max(peak, Math.abs(y[i]));
    if (i > 1.5 * SR) tail = Math.max(tail, Math.abs(y[i]));
  }
  ok(finite && peak < 4 && tail < 1e-3, `${key}: a loud note stays finite (peak ${peak.toFixed(2)}) and dies away (${tail.toExponential(1)})`);
}
// play softer, it cleans up
for (const key of ['Pedal_SuperDrive', 'Pedal_FuzzWasHe', 'Pedal_GermaniumDrive', 'Pedal_MarshallGuvnorPlus', 'Pedal_RangeBooster']) {
  const hard = harm(render(key, {}, sine(110, 0.5))).thd, soft = harm(render(key, {}, sine(110, 0.05))).thd;
  ok(hard > soft + 5, `${key}: cleans up when played softer (${hard.toFixed(1)} dB → ${soft.toFixed(1)} dB)`);
}
// more gain, more distortion
for (const key of ['Pedal_SuperDrive', 'Pedal_VintageDistortion', 'Pedal_Distortion', 'Pedal_FuzzWasHe', 'Pedal_GermaniumDrive', 'Pedal_CustomDrive', 'Pedal_MarshallGuvnorPlus', 'Bass_Pedal_BassDistortion']) {
  const lo = harm(render(key, { Gain: 1 }, sine(110, 0.15))).thd, hi = harm(render(key, { Gain: 100 }, sine(110, 0.15))).thd;
  ok(hi > lo + 3, `${key}: Gain up adds distortion (${lo.toFixed(1)} → ${hi.toFixed(1)} dB)`);
}
// the tone knob brightens
for (const key of ['Pedal_SuperDrive', 'Pedal_VintageDistortion', 'Pedal_Distortion', 'Pedal_BuzzOne', 'Pedal_FuzzWasHe', 'Pedal_GermaniumDrive', 'Pedal_CustomDrive']) {
  const lo = harm(render(key, { Tone: 1 }, saw(110, 0.3))).bright, hi = harm(render(key, { Tone: 100 }, saw(110, 0.3))).bright;
  ok(hi > lo + 3, `${key}: Tone up is brighter (top end ${lo.toFixed(1)} → ${hi.toFixed(1)} dB)`);
}

// --- pitch pedals: the right note, held steady
const steady = (y, hz, played) => {
  // the shifted note's strength in short windows over the last second (40 ms, or long enough to
  // tell it apart from the note played)
  const w = Math.round(SR * Math.max(0.04, 3 / Math.abs(played - hz))), v = [];
  for (let a = y.length - SR; a + w <= y.length; a += w) v.push(db(amp(y, a, w, hz)));
  return { lvl: v.reduce((s, q) => s + q, 0) / v.length, range: Math.max(...v) - Math.min(...v) };
};
for (const [key, knob, st] of [['Pedal_MultiPitch', 'Pitch 1', -12], ['Pedal_MultiPitch', 'Pitch 1', -5], ['Pedal_MultiPitch', 'Pitch 1', 7], ['Pedal_MultiPitch', 'Pitch 1', 12], ['Pedal_MultiPitch', 'Pitch 1', 24], ['Rack_StudioPitch', 'Pitch', -24], ['Pedal_Octavius', null, -12], ['Bass_Pedal_BassSubOctave', null, -12]]) {
  for (const hz of [98, 247]) {
    const knobs = knob ? { [knob]: st, Mix: 100 } : { Mix: 100 };
    const y = render(key, knobs, sine(hz, 0.2), 2);
    const t = hz * 2 ** (st / 12);
    const s = steady(y, t, hz);
    // nothing else but the note played and the shifted note
    const a = y.length - SR, n = SR;
    let stray = 0;
    for (let f = 40; f < 3000; f *= 1.03) if (Math.abs(f / t - 1) > 0.06 && Math.abs(f / hz - 1) > 0.06) stray = Math.max(stray, amp(y, a, n, f));
    ok(s.lvl > -30 && s.range < 1.5 && db(stray) < s.lvl - 25, `${key} ${st > 0 ? '+' : ''}${st} on ${hz} Hz: lands on ${t.toFixed(0)} Hz, steady within ${s.range.toFixed(2)} dB, nothing else ${(s.lvl - db(stray)).toFixed(0)} dB down`);
  }
}

if (bad) {
  console.log(`\n${bad} failed`);
  process.exit(1);
}
console.log('\nall passed');
