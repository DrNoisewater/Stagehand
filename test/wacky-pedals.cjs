// 4.20: the wacky pedals (Quack, Croak, Caterwaul, Blorp) through the shipped engine (rig-dsp.wasm),
// on made-up guitar and bass playing. Each one must really do its job, follow the playing, keep
// a sane level, leave the sound untouched at Blend 0, and every knob must change the sound.
//   node test/wacky-pedals.cjs [--wav <dir>]     (--wav writes short clips of each pedal)
// WACKY_WASM=<file> tests another build of the engine.
const fs = require('node:fs');
const path = require('node:path');
const G = require('../src/renderer/data/gear2014.json');

const WASM = process.env.WACKY_WASM || path.join(__dirname, '../src/renderer/worklets/rig-dsp.wasm');
const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(WASM)), {}).exports;
const need = x.mem_needed();
if (need > x.memory.buffer.byteLength) x.memory.grow(Math.ceil((need - x.memory.buffer.byteLength) / 65536));
const wavDir = process.argv.includes('--wav') ? process.argv[process.argv.indexOf('--wav') + 1] : null;

let bad = 0;
const ok = (c, msg) => {
  console.log(c ? 'ok  ' : 'FAIL', msg);
  if (!c) bad++;
};
const PEDALS = ['Pedal_Quack', 'Pedal_Croak', 'Pedal_Caterwaul', 'Pedal_Blorp'];
const KNOBS = { Pedal_Quack: ['Beak', 'Wobble', 'Blend'], Pedal_Croak: ['Throat', 'Hop', 'Blend'], Pedal_Caterwaul: ['Meow', 'Hiss', 'Blend'], Pedal_Blorp: ['Vowel', 'Orbit', 'Blend'] };

// --- the engine
const spec = (key, knobs = {}, kind = 'guitar') => {
  // no pedal: a piece the engine doesn't know (it is skipped), so the rest of the chain is the same
  let s = `kind\t${kind}\ngear\tpre\t${key || 'Pedal_NotThere'}\n`;
  if (!key) return s;
  for (const [n, , lo, hi, d] of G[key].k) s += `k\t${n}\t${n in knobs ? knobs[n] : d}\t${lo}\t${hi}\n`;
  return s;
};
const render = (key, knobs, input, { kind = 'guitar', sr = 48000 } = {}) => {
  if (!x.init(sr)) throw new Error('init');
  const s = Buffer.from(spec(key, knobs, kind) + '\0');
  new Uint8Array(x.memory.buffer, x.buf_spec(), s.length).set(s);
  if (!x.build(0)) throw new Error('build ' + key);
  x.select(0);
  const inp = new Float32Array(x.memory.buffer, x.buf_in(), 128);
  const out = new Float32Array(x.memory.buffer, x.buf_l(), 128);
  const y = new Float32Array(input.length);
  for (let o = 0; o < input.length; o += 128) {
    const m = Math.min(128, input.length - o);
    inp.fill(0);
    inp.set(input.subarray(o, o + m));
    x.process(128);
    y.set(out.subarray(0, m), o);
  }
  return y;
};

// --- made-up playing
// a plucked string, the same at every sample rate: harmonics that fade, the top ones first
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
const pluck = (y, at, hz, amp, dur, sr) => {
  const m = Math.round(dur * sr);
  const f = Math.round(sr / 200);
  for (let k = 1; k <= 30 && k * hz < 8000; k++) {
    const ph = k * 2.399, a = ((amp * 0.6) / k) * Math.abs(Math.sin(k * 0.6)); // picked a fifth of the way along
    for (let i = 0; i < m && at + i < y.length; i++) {
      const t = i / sr;
      y[at + i] += a * Math.exp(-t * (0.8 + 0.35 * k)) * Math.sin(2 * Math.PI * k * hz * t + ph) * (i > m - f ? (m - i) / f : 1);
    }
  }
};
const riff = (notes, sr, gap = 0.36, hold = 1.4, amp = 0.12) => {
  const y = new Float32Array(Math.round((notes.length * gap + hold + 0.6) * sr));
  notes.forEach((hz, i) => pluck(y, Math.round(i * gap * sr), hz, amp, i === notes.length - 1 ? hold : gap * 0.95, sr));
  return y;
};
const GTR = [82.41, 98, 110, 123.5, 146.8, 164.8, 196, 246.9, 329.6, 196];
const BASS = [41.2, 49, 55, 61.7, 73.4, 82.4, 98, 55];
const tone = (hz, secs, sr, amp = 0.12) => {
  const y = new Float32Array(Math.round(secs * sr));
  for (let i = 0; i < y.length; i++) y[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr) * Math.min(1, i / (0.003 * sr));
  return y;
};
// a held note with every harmonic (like a string that keeps ringing at one loudness)
const saw = (hz, secs, sr, amp = 0.08) => {
  const y = new Float32Array(Math.round(secs * sr));
  for (let i = 0; i < y.length; i++) {
    let v = 0;
    for (let k = 1; k * hz < 8000; k++) v += Math.sin((2 * Math.PI * k * hz * i) / sr) / k;
    y[i] = amp * v * Math.min(1, i / (0.003 * sr));
  }
  return y;
};

// --- measures
const peakOf = (y) => y.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (y, a = 0, b = y.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += y[i] * y[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const db = (v) => 20 * Math.log10(v + 1e-12);
const diffDb = (a, b) => {
  let s = 0, r = 0;
  for (let i = 0; i < a.length; i++) (s += (a[i] - b[i]) ** 2), (r += b[i] * b[i]);
  return 10 * Math.log10((s + 1e-20) / (r + 1e-20));
};
const goertzel = (y, a, n, hz, sr) => {
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re += y[a + i] * w * Math.cos((2 * Math.PI * hz * i) / sr);
    im += y[a + i] * w * Math.sin((2 * Math.PI * hz * i) / sr);
  }
  return (4 * Math.hypot(re, im)) / n;
};
// spectral centroid (Hz) of a stretch, from a plain DFT on 50 Hz steps up to 8 kHz
const centroid = (y, a, n, sr) => {
  let num = 0, den = 0;
  for (let f = 50; f <= 8000; f += 50) {
    const m = goertzel(y, a, n, f, sr) ** 2;
    num += f * m, den += m;
  }
  return num / den;
};
// the pitch of a stretch, by autocorrelation between lo and hi Hz (parabolic refinement)
const pitch = (y, a, n, sr, lo, hi) => {
  const best = { lag: 0, c: -1 };
  const cs = [];
  for (let lag = Math.floor(sr / hi); lag <= Math.ceil(sr / lo); lag++) {
    let c = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < n; i++) (c += y[a + i] * y[a + i + lag]), (e1 += y[a + i] ** 2), (e2 += y[a + i + lag] ** 2);
    const v = c / Math.sqrt(e1 * e2 + 1e-20);
    cs.push([lag, v]);
    if (v > best.c) (best.c = v), (best.lag = lag);
  }
  const k = cs.findIndex(([l]) => l === best.lag);
  let lag = best.lag;
  if (k > 0 && k < cs.length - 1) {
    const [y0, y1, y2] = [cs[k - 1][1], cs[k][1], cs[k + 1][1]];
    lag += (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2);
  }
  return sr / lag;
};
// the loudness contour (rectified, smoothed), sampled at 1 kHz
const contour = (y, sr) => {
  const out = [];
  let e = 0;
  const a = 1 - Math.exp(-2 * Math.PI * 150 / sr);
  const step = sr / 1000;
  for (let i = 0; i < y.length; i++) {
    e += a * (Math.abs(y[i]) - e);
    if (i % step === 0) out.push(e);
  }
  return Float32Array.from(out);
};

// --- clips to hear (nobody can listen here; these are for the player)
const writeWav = (file, y, sr) => {
  const b = Buffer.alloc(44 + y.length * 2);
  b.write('RIFF', 0), b.writeUInt32LE(36 + y.length * 2, 4), b.write('WAVEfmt ', 8), b.writeUInt32LE(16, 16), b.writeUInt16LE(1, 20), b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24), b.writeUInt32LE(sr * 2, 28), b.writeUInt16LE(2, 32), b.writeUInt16LE(16, 34), b.write('data', 36), b.writeUInt32LE(y.length * 2, 40);
  for (let i = 0; i < y.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(y[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
};

const SR = 48000;
const gtr = riff(GTR, SR);
const bass = riff(BASS, SR, 0.42, 1.6, 0.15);
const dryG = render(null, {}, gtr);
const dryB = render(null, {}, bass, { kind: 'bass' });
if (wavDir) {
  fs.mkdirSync(wavDir, { recursive: true });
  writeWav(path.join(wavDir, 'dry-guitar.wav'), dryG, SR);
  writeWav(path.join(wavDir, 'dry-bass.wav'), dryB, SR);
}

for (const key of PEDALS) {
  const name = G[key].n;
  ok(G[key] && G[key].k.map((k) => k[0]).join() === KNOBS[key].join(), `${name}: knobs ${KNOBS[key].join(', ')}`);
  for (const [kind, input, dry] of [['guitar', gtr, dryG], ['bass', bass, dryB]]) {
    const y = render(key, {}, input, { kind });
    if (wavDir) writeWav(path.join(wavDir, `${name.toLowerCase()}-${kind}.wav`), y, SR);
    let finite = true, peak = 0, sum = 0;
    for (const v of y) (finite = finite && Number.isFinite(v)), (peak = Math.max(peak, Math.abs(v))), (sum += v);
    const lvl = db(rms(y)) - db(rms(dry));
    const dc = Math.abs(sum / y.length) / rms(y);
    ok(finite && peak < 1.05, `${name} on ${kind}: finite, peak ${peak.toFixed(2)} (input peak ${peakOf(input).toFixed(2)})`);
    ok(Math.abs(lvl) < 4.5, `${name} on ${kind}: level ${lvl.toFixed(1)} dB against the dry sound (no jump in volume)`);
    ok(dc < 0.01, `${name} on ${kind}: no offset (DC ${(dc * 100).toFixed(2)}% of the level)`);
    ok(diffDb(y, dry) > -8, `${name} on ${kind}: changes the sound (${diffDb(y, dry).toFixed(1)} dB away from dry)`);
    const tail = rms(y, y.length - Math.round(0.15 * SR));
    ok(db(tail) < -70, `${name} on ${kind}: goes quiet after the last note (${db(tail).toFixed(0)} dB)`);
    // Blend 0: exactly the dry sound
    const zero = render(key, { Blend: 0 }, input, { kind });
    let same = true;
    for (let i = 0; i < zero.length; i++) if (zero[i] !== dry[i]) (same = false), i = zero.length;
    ok(same, `${name} on ${kind}: Blend 0 is your own sound, bit for bit`);
    // every knob
    for (const k of KNOBS[key]) {
      const lo = render(key, { [k]: 0 }, input, { kind }), hi = render(key, { [k]: 100 }, input, { kind });
      const d = diffDb(hi, lo);
      ok(d > -12, `${name} on ${kind}: ${k} 0 vs 100 changes the sound (${d.toFixed(1)} dB)`);
    }
  }
  // the same at other sample rates: same level, nothing blows up
  const levels = [];
  for (const sr of [44100, 48000, 96000]) {
    const inp = riff(GTR.slice(0, 5), sr);
    const y = render(key, {}, inp, { sr });
    levels.push(db(rms(y)) - db(rms(render(null, {}, inp, { sr }))));
    ok(y.every(Number.isFinite), `${name} at ${sr} Hz: finite`);
  }
  ok(Math.max(...levels) - Math.min(...levels) < 2, `${name}: same level at 44.1, 48 and 96 kHz (${levels.map((v) => v.toFixed(1)).join(', ')} dB)`);
  // no hiss lifted between notes: quiet noise in, quiet out
  {
    const n = new Float32Array(SR);
    for (let i = 0; i < n.length; i++) n[i] = rnd() * 0.0003;
    const y = render(key, { Blend: 100 }, n);
    ok(db(rms(y, SR / 2)) < db(rms(n)) + 6, `${name}: noise between notes stays down (${db(rms(n)).toFixed(0)} in, ${db(rms(y, SR / 2)).toFixed(0)} dB out)`);
  }
  // picked again at the same loudness: the call starts again (the attack is heard)
  {
    const inp = new Float32Array(Math.round(2.2 * SR));
    for (let i = 0; i < 6; i++) pluck(inp, Math.round(i * 0.3 * SR), 146.8, 0.12, 0.29, SR);
    const y = render(key, { Blend: 100 }, inp);
    const early = [], late = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.round(i * 0.3 * SR);
      early.push(centroid(y, a + Math.round(0.012 * SR), Math.round(0.03 * SR), SR));
      late.push(centroid(y, a + Math.round(0.2 * SR), Math.round(0.03 * SR), SR));
    }
    if (key === 'Pedal_Quack') ok(early.every((e, i) => e > late[i] * 1.1), `Quack: every repeated pick quacks again (bright ${early.map((v) => v.toFixed(0)).join('/')} Hz, then ${late.map((v) => v.toFixed(0)).join('/')} Hz)`);
  }
}

// --- what makes each one what it is
{
  // Quack: on a steady note the voice is bright when the beak opens on the attack and sweeps down as it closes
  const inp = saw(110, 1, SR);
  const y = render('Pedal_Quack', { Blend: 100, Wobble: 0 }, inp);
  const c = [0.01, 0.06, 0.12, 0.2, 0.35].map((t) => centroid(y, Math.round(t * SR), Math.round(0.03 * SR), SR));
  ok(c[0] > c[2] * 1.3 && c[1] > c[3] && c[2] > c[4], `Quack: brightness falls after the attack (${c.map((v) => v.toFixed(0)).join(' > ')} Hz)`);
  // Beak: sharper is a narrower, more nasal voice: a faster fall
  const sharp = render('Pedal_Quack', { Blend: 100, Wobble: 0, Beak: 100 }, inp);
  const soft = render('Pedal_Quack', { Blend: 100, Wobble: 0, Beak: 0 }, inp);
  const at = (z, t) => centroid(z, Math.round(t * SR), Math.round(0.03 * SR), SR);
  ok(at(sharp, 0.01) / at(sharp, 0.12) > at(soft, 0.01) / at(soft, 0.12), `Quack: Beak 100 closes faster than Beak 0 (${(at(sharp, 0.01) / at(sharp, 0.12)).toFixed(2)}x vs ${(at(soft, 0.01) / at(soft, 0.12)).toFixed(2)}x by 120 ms)`);
  // Wobble: the voice warbles: its brightness moves up and down during a held note
  const steady = [], wob = [];
  const held = saw(110, 1.6, SR);
  const w0 = render('Pedal_Quack', { Blend: 100, Wobble: 0 }, held), w1 = render('Pedal_Quack', { Blend: 100, Wobble: 100 }, held);
  for (let t = 0.6; t < 1.5; t += 0.025) steady.push(at(w0, t)), wob.push(at(w1, t));
  const spread = (a) => Math.max(...a) / Math.min(...a);
  ok(spread(wob) > 1.3 && spread(steady) < 1.15, `Quack: Wobble moves the voice (brightness swings ${spread(wob).toFixed(2)}x, without it ${spread(steady).toFixed(2)}x)`);
}
{
  // Croak: a held note becomes a train of pulses at the Hop rate, with the octave below in it
  const inp = tone(110, 2, SR);
  for (const [hop, hz] of [[50, 28.5], [0, 12], [100, 45]]) {
    const y = render('Pedal_Croak', { Blend: 100, Hop: hop }, inp);
    const e = contour(y.subarray(SR), SR);
    const mean = e.reduce((s, v) => s + v, 0) / e.length;
    let best = 0, bestHz = 0;
    for (let f = 5; f <= 60; f += 0.5) {
      const m = goertzel(e, 0, e.length, f, 1000) / mean;
      if (m > best) (best = m), (bestHz = f);
    }
    ok(Math.abs(bestHz - hz) < hz * 0.08 && best > 0.5, `Croak: Hop ${hop}: pulses at ${bestHz} Hz (expected about ${hz}), ${(best * 100).toFixed(0)}% deep`);
  }
  const dryE = contour(render(null, {}, inp).subarray(SR), SR);
  const dm = dryE.reduce((s, v) => s + v, 0) / dryE.length;
  let dryBest = 0;
  for (let f = 5; f <= 60; f += 0.5) dryBest = Math.max(dryBest, goertzel(dryE, 0, dryE.length, f, 1000) / dm);
  ok(dryBest < 0.05, `Croak: the dry note has no such pulsing (${(dryBest * 100).toFixed(1)}%)`);
  const y = render('Pedal_Croak', { Blend: 100, Throat: 100 }, inp);
  const yl = render('Pedal_Croak', { Blend: 100, Throat: 0 }, inp);
  const sub = (z) => db(goertzel(z, SR, SR / 2, 55, SR)) - db(goertzel(z, SR, SR / 2, 110, SR));
  ok(sub(y) > -6, `Croak: the octave below is there (55 Hz is ${sub(y).toFixed(1)} dB against the 110 Hz note, Throat 100)`);
  ok(sub(y) > sub(yl) + 3, `Croak: Throat brings in more of it (${sub(yl).toFixed(1)} dB at Throat 0)`);
  // on bass the octave below a low A (27.5 Hz) is there but kept in check
  const by = render('Pedal_Croak', { Blend: 100 }, tone(55, 2, SR, 0.3), { kind: 'bass' });
  ok(by.every(Number.isFinite) && peakOf(by) < 1.05, `Croak on a bass low A: bounded (peak ${peakOf(by).toFixed(2)})`);
}
{
  // Caterwaul: the voice glides m - ee - ah - ow (a bright "ee" early, a dark "ow" late) and the pitch bends up then back
  const inp = tone(220, 2, SR);
  const y = render('Pedal_Caterwaul', { Blend: 100, Hiss: 0, Meow: 60 }, inp);
  const tm = 0.28 + 0.42 * 0.6;
  const at = (t) => centroid(y, Math.round(t * SR), Math.round(0.03 * SR), SR);
  // "ee" has its second resonance high (about 2.3 kHz), "ow" low (about 0.9 kHz): compare the energy up there with the energy below 1 kHz
  const band = (t, lo, hi) => {
    let e = 0;
    for (let f = lo; f <= hi; f += 50) e += goertzel(y, Math.round(t * SR), Math.round(0.03 * SR), f, SR) ** 2;
    return e;
  };
  const eeness = (t) => db(Math.sqrt(band(t, 1800, 2800) / band(t, 200, 1000)));
  const ee = eeness(0.395 * 1.15 * tm - 0.015), ow = eeness(tm * 1.5);
  ok(ee > ow + 10, `Caterwaul: the mouth glides from ee to ow (energy around 2 kHz against below 1 kHz: ${ee.toFixed(1)} dB, then ${ow.toFixed(1)} dB)`);
  const n = Math.round(0.03 * SR);
  const p = [tm * 0.25, tm * 0.75, tm + 0.2].map((t) => pitch(y, Math.round(t * SR - n / 2), n, SR, 180, 280));
  const cents = p.map((v) => 1200 * Math.log2(v / 220));
  ok(cents[0] > 50 && cents[1] < -50 && Math.abs(cents[2]) < 35, `Caterwaul: the meow bends up (${cents[0].toFixed(0)} cents), back down (${cents[1].toFixed(0)}), then sits on the note (${cents[2].toFixed(0)})`);
  const y0 = render('Pedal_Caterwaul', { Blend: 100, Hiss: 0, Meow: 0 }, inp);
  const p0 = 1200 * Math.log2(pitch(y0, Math.round(0.07 * SR - n / 2), n, SR, 180, 280) / 220);
  ok(cents[0] > p0 + 30, `Caterwaul: Meow 0 bends less (${p0.toFixed(0)} cents up)`);
  // Hiss: breath on top: more energy up high
  const hi = (z) => db(goertzel(z, Math.round(0.02 * SR), SR / 10, 6000, SR) + goertzel(z, Math.round(0.02 * SR), SR / 10, 7000, SR));
  const h1 = render('Pedal_Caterwaul', { Blend: 100, Hiss: 100 }, inp);
  ok(hi(h1) > hi(y) + 10, `Caterwaul: Hiss adds breath up high (${(hi(h1) - hi(y)).toFixed(0)} dB more around 6 to 7 kHz)`);
}
{
  // Blorp: a ring modulator: the partials no longer sit on the note's harmonics
  const inp = tone(220, 1.5, SR);
  const harmonicShare = (z) => {
    let on = 0, all = 0;
    for (let f = 20; f <= 5000; f += 5) {
      const m = goertzel(z, SR / 2, SR / 2, f, SR) ** 2;
      all += m;
      const k = Math.round(f / 220);
      if (k >= 1 && Math.abs(f - k * 220) <= 10) on += m;
    }
    return on / all;
  };
  const y = render('Pedal_Blorp', { Blend: 100, Orbit: 0 }, inp);
  const dry = render(null, {}, inp);
  ok(harmonicShare(dry) > 0.95 && harmonicShare(y) < 0.3, `Blorp: off-key partials (${(harmonicShare(y) * 100).toFixed(0)}% of the sound on the note's harmonics, dry ${(harmonicShare(dry) * 100).toFixed(0)}%)`);
  // Vowel: dark ooo to bright eee
  const at = (z) => centroid(z, SR, Math.round(0.2 * SR), SR);
  const v0 = at(render('Pedal_Blorp', { Blend: 100, Vowel: 0 }, inp)), v1 = at(render('Pedal_Blorp', { Blend: 100, Vowel: 100 }, inp));
  ok(v1 > v0 * 2, `Blorp: Vowel opens the mouth from ${v0.toFixed(0)} Hz to ${v1.toFixed(0)} Hz`);
  // Orbit: faster bubbling: the brightness changes more often
  const moves = (z) => {
    const c = [];
    for (let t = 0.5; t < 1.45; t += 0.01) c.push(centroid(z, Math.round(t * SR), Math.round(0.01 * SR), SR));
    let m = 0;
    for (let i = 1; i < c.length; i++) m += Math.abs(Math.log(c[i] / c[i - 1]));
    return m;
  };
  const o0 = moves(render('Pedal_Blorp', { Blend: 100, Orbit: 0 }, inp)), o1 = moves(render('Pedal_Blorp', { Blend: 100, Orbit: 100 }, inp));
  ok(o1 > o0 * 1.5, `Blorp: Orbit 100 bubbles more than Orbit 0 (${o1.toFixed(1)} vs ${o0.toFixed(1)})`);
}
// --- light on the computer
{
  const inp = riff(GTR, SR);
  for (const key of PEDALS) {
    const t0 = process.hrtime.bigint();
    render(key, {}, inp);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const t1 = process.hrtime.bigint();
    render(null, {}, inp);
    const base = Number(process.hrtime.bigint() - t1) / 1e6;
    const pct = ((ms - base) / ((inp.length / SR) * 1000)) * 100;
    ok(pct < 5, `${G[key].n}: about ${pct.toFixed(2)}% of one core`);
  }
}
if (bad) {
  console.log(`${bad} failed`);
  process.exit(1);
}
console.log('wacky pedals: all ok');
