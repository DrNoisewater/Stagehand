// 4.20: the forty-four pedals in The Lab through the shipped engine (rig-dsp.wasm), on made-up
// guitar and bass playing. Each pedal's own checks come from its brief (docs/lab-pedals.md);
// every pedal also: guitar and bass at 44.1/48/96 kHz, silence stays silent, Mix 0 is the
// input untouched, sane levels and peaks, footswitches pressed and let go.
//   node test/wacky-pedals.cjs [--wav <dir>] [only…]     (--wav writes short clips of each pedal)
// WACKY_WASM=<file> tests another build of the engine.
const fs = require('node:fs');
const path = require('node:path');
const G = require('../src/renderer/data/gear2014.json');

const WASM = process.env.WACKY_WASM || path.join(__dirname, '../src/renderer/worklets/rig-dsp.wasm');
const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(WASM)), {}).exports;
const need = x.mem_needed();
if (need > x.memory.buffer.byteLength) x.memory.grow(Math.ceil((need - x.memory.buffer.byteLength) / 65536));
const args = process.argv.slice(2);
const wavDir = args.includes('--wav') ? args[args.indexOf('--wav') + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--wav');

let bad = 0;
const ok = (c, msg) => {
  console.log(c ? 'ok  ' : 'FAIL', msg);
  if (!c) bad++;
};
const LAB = Object.keys(G).filter((k) => G[k].c === 'The Lab');
const BIT = { Pedal_Quack: 1, Pedal_Croak: 2, Pedal_Caterwaul: 3, Pedal_Blorp: 4, Pedal_Gobble: 5, Pedal_Slug: 6, Pedal_Boing: 7, Pedal_Gremlin: 8, Pedal_Invader: 9, Pedal_Confetti: 10, Pedal_Blender: 11, Pedal_Fossil: 12, Pedal_Charmer: 13, Pedal_Haunt: 14 };
const SHP = { hold: 11, lever: 12, latch: 13, tempo: 14 };
// the thirty that followed: each has its own live slot (footswitch bits) and live value
const KIND = Object.fromEntries(['Annwn', 'Apoptosis', 'Bifrost', 'BluePrince', 'Claude', 'DejaVu', 'Duat', 'EventHorizon', 'Fenrir', 'Inanna', 'Janus', 'Kitsune', 'Kukulkan', 'Long', 'Maui', 'Mimic', 'Molt', 'Nataraja', 'Nothing', 'Olympus', 'Ouroboros', 'Parasite', 'Reliquary', 'Seance', 'Severed', 'Shango', 'Tezcatl', 'Veles', 'WhoAreYou', 'Wukong'].map((n, i) => [`Pedal_${n}`, 15 + i]));
const WORD0 = 15, VAL0 = 79;
const word = (key, bits) => x.param(WORD0 + KIND[key], bits);
const lval = (key, v) => x.param(VAL0 + KIND[key], v);
// how each of the thirty is played in the shared checks: which footswitches are down (bits) at t s
const B = (...bits) => bits.reduce((m, b) => m | (1 << b), 0);
const PLAY = {
  Pedal_Apoptosis: (t) => (t > 1.0 && t < 1.05 ? B(0) : 0), // Release: one press
  Pedal_Claude: (t) => (t < 0.9 ? B(0) : B(1, 2)) | (t > 1.0 && t < 1.05 ? B(4) : 0), // learn the first phrase, then Recall it round and round
  Pedal_DejaVu: (t) => (t > 1.4 && t < 1.45 ? B(0) : 0) | (t > 1.45 && t < 3.2 ? B(1) : 0), // Enter, then Repeat
  Pedal_Kukulkan: () => B(0), // Rise lit
  Pedal_Mimic: (t) => (t < 1.0 ? B(0) : B(1)), // Listen, then Speak
  Pedal_Nataraja: () => B(0), // Dance lit
  Pedal_Seance: (t) => B(0) | (t > 2.0 && t < 2.05 ? B(1) : 0), // Listen lit, Summon once
  Pedal_Shango: (t) => (t > 0.2 && t < 1.2 ? B(0) : 0) | (t > 1.3 && t < 1.35 ? B(1) : 0), // Call, then Answer
  Pedal_Kitsune: (t) => (t > 1.2 && t < 1.25 ? B(0) : 0), // Trick once
  Pedal_Olympus: (t) => (t > 1.2 && t < 2.4 ? B(0) : 0) | (t > 2.6 && t < 3.0 ? B(1) : 0),
};
const LONGTAIL = { Pedal_Reliquary: 8, Pedal_Seance: 10, Pedal_Duat: 8, Pedal_Ouroboros: 8, Pedal_Bifrost: 7, Pedal_Inanna: 6, Pedal_EventHorizon: 7, Pedal_Annwn: 7 };

// --- the engine
const spec = (key, knobs = {}, kind = 'guitar') => {
  let s = `kind\t${kind}\ngear\tpre\t${key || 'Pedal_NotThere'}\n`;
  if (!key) return s;
  for (const [n, , lo, hi, d, o] of G[key].k) if (!(o && o.live)) s += `k\t${n}\t${n in knobs ? knobs[n] : d}\t${lo}\t${hi}\n`;
  return s;
};
/** at(t, block) is called before each block (t in seconds) to press switches; returns the output */
const render = (key, knobs, input, { kind = 'guitar', sr = 48000, block = 128, at, live = {} } = {}) => {
  if (!x.init(sr)) throw new Error('init');
  for (const id of Object.values(SHP)) x.param(id, 0);
  SHP_ALL();
  for (const [k, v] of Object.entries(live)) x.param(SHP[k] ?? Number(k), v);
  const s = Buffer.from(spec(key, knobs, kind) + '\0');
  new Uint8Array(x.memory.buffer, x.buf_spec(), s.length).set(s);
  if (!x.build(0)) throw new Error('build ' + key);
  x.select(0);
  const y = new Float32Array(input.length);
  for (let o = 0; o < input.length; o += block) {
    const m = Math.min(block, input.length - o);
    if (at) at(o / sr);
    const inp = new Float32Array(x.memory.buffer, x.buf_in(), block);
    const out = new Float32Array(x.memory.buffer, x.buf_l(), block);
    inp.fill(0);
    inp.set(input.subarray(o, o + m));
    x.process(m);
    y.set(out.subarray(0, m), o);
  }
  return y;
};
/** the footswitch down or up; for the thirty, `on` is their first footswitch (or a time: their plan) */
const press = (key, on, t) => {
  if (!(key in KIND)) return x.param(SHP.hold, on ? 1 << BIT[key] : 0);
  if (PLAY[key] && t !== undefined) return word(key, PLAY[key](t));
  word(key, on ? B(0) : 0);
};
const SHP_ALL = () => { for (const n of Object.values(KIND)) x.param(WORD0 + n, 0), x.param(VAL0 + n, 0); };

// --- made-up playing
const pluck = (y, at, hz, amp, dur, sr) => {
  const m = Math.round(dur * sr);
  const f = Math.round(sr / 200);
  for (let k = 1; k <= 30 && k * hz < 8000; k++) {
    const ph = k * 2.399, a = ((amp * 0.6) / k) * Math.abs(Math.sin(k * 0.6));
    for (let i = 0; i < m && at + i < y.length; i++) {
      const t = i / sr;
      y[at + i] += a * Math.exp(-t * (0.8 + 0.35 * k)) * Math.sin(2 * Math.PI * k * hz * t + ph) * (i > m - f ? (m - i) / f : 1);
    }
  }
};
const riff = (notes, sr, gap = 0.36, hold = 1.4, amp = 0.12, tail = 0.6) => {
  const y = new Float32Array(Math.round((notes.length * gap + hold + tail) * sr));
  notes.forEach((hz, i) => pluck(y, Math.round(i * gap * sr), hz, amp, i === notes.length - 1 ? hold : gap * 0.95, sr));
  return y;
};
const GTR = [82.41, 98, 110, 123.5, 146.8, 164.8, 196, 246.9, 329.6, 196];
const BASS = [41.2, 49, 55, 61.7, 73.4, 82.4, 98, 55];
// a held note with every harmonic, steady
const saw = (hz, secs, sr, amp = 0.1, start = 0) => {
  const y = new Float32Array(Math.round((start + secs) * sr));
  let p = 0;
  for (let i = Math.round(start * sr), j = 0; i < y.length; i++, j++) {
    p += hz / sr;
    if (p >= 1) p -= 1;
    y[i] = amp * (2 * p - 1) * Math.min(1, j / (0.004 * sr)) * Math.min(1, (y.length - i) / (0.004 * sr));
  }
  return y;
};
const sine = (hz, secs, sr, amp = 0.1) => {
  const y = new Float32Array(Math.round(secs * sr));
  for (let i = 0; i < y.length; i++) y[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr) * Math.min(1, i / (0.004 * sr));
  return y;
};
const cat = (...parts) => {
  const y = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) y.set(p, o), (o += p.length);
  return y;
};
const quiet = (secs, sr) => new Float32Array(Math.round(secs * sr));

// --- measuring
const rms = (y, a = 0, b = y.length) => {
  let s = 0;
  a = Math.max(0, Math.round(a)), b = Math.min(y.length, Math.round(b));
  for (let i = a; i < b; i++) s += y[i] * y[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const peak = (y, a = 0, b = y.length) => {
  let m = 0;
  for (let i = Math.max(0, a); i < Math.min(b, y.length); i++) m = Math.max(m, Math.abs(y[i]));
  return m;
};
const finite = (y) => y.every(Number.isFinite);
// where the sound's weight sits (Hz), from zero crossings of its slope (bright = high)
const bright = (y, a, b, sr) => {
  let n = 0, d = 0, prev = 0;
  for (let i = Math.max(1, a); i < b; i++) {
    const v = y[i] - y[i - 1];
    if ((v > 0) !== (prev > 0)) n++;
    prev = v;
    d++;
  }
  return (n / 2 / d) * sr;
};
// the pitch (Hz) of a stretch, by autocorrelation; f range limits the search
const pitch = (y, a, b, sr, fmin = 40, fmax = 2000) => {
  a = Math.round(a), b = Math.round(b);
  const n = b - a, tmin = Math.floor(sr / fmax), tmax = Math.min(Math.ceil(sr / fmin), Math.floor(n / 2));
  let best = 0, bt = 0;
  const r = [];
  for (let t = tmin; t <= tmax; t++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = a; i < b - t; i++) s += y[i] * y[i + t], e1 += y[i] * y[i], e2 += y[i + t] * y[i + t];
    r[t] = s / Math.sqrt(e1 * e2 + 1e-20);
  }
  // the first strong peak (not a multiple of the period)
  const top = r.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);
  for (let t = tmin + 1; t < tmax; t++)
    if (r[t] > 0.85 * top && r[t] >= r[t - 1] && r[t] >= r[t + 1]) {
      bt = t;
      best = r[t];
      break;
    }
  if (!bt) return 0;
  const p = r[bt - 1], q = r[bt], s = r[bt + 1];
  const off = (p - s) / (2 * (p - 2 * q + s) || 1);
  return sr / (bt + off);
};
const cents = (f, ref) => 1200 * Math.log2(f / ref);
// how much the level moves at about hz (0..1): the level's swing at that rate
const throb = (y, a, b, sr, hz) => {
  const w = Math.round(sr / (hz > 12 ? 200 : 100));
  const env = [];
  for (let i = a; i + w < b; i += w) env.push(rms(y, i, i + w));
  const er = sr / w;
  const mean = env.reduce((s, v) => s + v, 0) / env.length;
  let c = 0, s = 0;
  env.forEach((v, i) => ((c += (v - mean) * Math.cos((2 * Math.PI * hz * i) / er)), (s += (v - mean) * Math.sin((2 * Math.PI * hz * i) / er))));
  return (2 * Math.hypot(c, s)) / env.length / (mean || 1);
};
// where the sound's weight sits (Hz): the spectrum's centre of mass over a stretch
const fftc = (re, im) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]], [im[i], im[j]] = [im[j], im[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k), s = Math.sin(a * k);
        const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k + len / 2] = re[i + k] - xr, im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr, im[i + k] += xi;
      }
  }
};
const centroid = (y, a, b, sr) => {
  let n = 1;
  while (n < b - a && n < 8192) n <<= 1;
  if (n > b - a) n >>= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = y[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fftc(re, im);
  let m = 0, w = 0;
  for (let k = 1; k < n / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    (m += p * k), (w += p);
  }
  return ((m / (w || 1)) * sr) / n;
};
// the strongest throb between lo and hi Hz
const throbPeak = (y, a, b, sr, lo, hi) => {
  let best = 0;
  for (let h = lo; h <= hi; h += 0.05) best = Math.max(best, throb(y, a, b, sr, h));
  return best;
};
// strength of a frequency in a stretch (Goertzel), relative to the stretch's level
const tone = (y, a, b, sr, hz) => {
  let c = 0, s = 0;
  for (let i = a; i < b; i++) (c += y[i] * Math.cos((2 * Math.PI * hz * i) / sr)), (s += y[i] * Math.sin((2 * Math.PI * hz * i) / sr));
  return (2 * Math.hypot(c, s)) / (b - a) / (rms(y, a, b) * Math.SQRT2 || 1);
};
const maxStep = (y, a, b) => {
  let m = 0;
  for (let i = Math.max(1, a); i < b; i++) m = Math.max(m, Math.abs(y[i] - y[i - 1]));
  return m;
};
const wav = (name, y, sr) => {
  if (!wavDir) return;
  fs.mkdirSync(wavDir, { recursive: true });
  const b = Buffer.alloc(44 + y.length * 2);
  b.write('RIFF', 0), b.writeUInt32LE(36 + y.length * 2, 4), b.write('WAVEfmt ', 8), b.writeUInt32LE(16, 16), b.writeUInt16LE(1, 20), b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24), b.writeUInt32LE(sr * 2, 28), b.writeUInt16LE(2, 32), b.writeUInt16LE(16, 34), b.write('data', 36), b.writeUInt32LE(y.length * 2, 40);
  for (let i = 0; i < y.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(y[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path.join(wavDir, name + '.wav'), b);
};
const want = (k) => !only.length || only.some((o) => k.toLowerCase().includes(o.toLowerCase()));

// ------------------------------------------------------------------ every pedal --
ok(LAB.length === 44, `The Lab has 44 pedals (${LAB.length})`);
for (const key of LAB) {
  if (!want(key) || process.env.OWN_ONLY) continue;
  const name = G[key].n;
  for (const kind of ['guitar', 'bass']) {
    for (const sr of [44100, 48000, 96000]) {
      const inp = riff(kind === 'bass' ? BASS : GTR, sr);
      const end = inp.length;
      const dry = render(null, {}, inp, { kind, sr });
      // the footswitch held through the middle of the riff, then let go
      const hasHold = (G[key].m || []).some(([, t]) => t !== 'lever');
      const hasLever = (G[key].m || []).some(([, t]) => t === 'lever');
      const y = render(key, {}, inp, {
        kind, sr, block: sr === 44100 ? 32 : 128,
        at: (t) => {
          if (hasHold) press(key, t > 1.2 && t < 2.4, t);
          if (key === 'Pedal_Boing') x.param(SHP.lever, t > 2.6 && t < 3.0 ? 0.6 : 0);
          else if (hasLever) lval(key, t > 2.6 && t < 3.0 ? 0.6 : 0);
        },
      });
      const lv = db(rms(y, 0, end)) - db(rms(dry, 0, end));
      const pk = peak(y) / peak(dry);
      if (sr === 48000) wav(`${name}-${kind}`, y, sr);
      ok(finite(y), `${name} ${kind} ${sr}: every sample a number`);
      ok(Math.abs(lv) < 6, `${name} ${kind} ${sr}: level near the dry sound (${lv.toFixed(1)} dB)`);
      ok(pk < 4, `${name} ${kind} ${sr}: peaks sane (${pk.toFixed(2)}x the dry peak)`);
      if (sr === 48000) {
        // silence in → silence out, also with the footswitch held and the lever pulled
        const s = render(key, {}, quiet(3, sr), { kind, sr, at: (t) => { press(key, t > 0.5 && t < 2, t); x.param(SHP.lever, t > 0.5 && t < 2 ? 1 : 0); if (key in KIND) lval(key, t > 0.5 && t < 2 ? 1 : 0); } });
        ok(peak(s) < 1e-5, `${name} ${kind}: silence stays silent (${peak(s).toExponential(1)})`);
        // after the playing stops it goes quiet (tails die away)
        const tail = render(key, {}, cat(inp, quiet(LONGTAIL[key] || 4, sr)), { kind, sr, at: (t) => PLAY[key] && t < inp.length / sr && press(key, 0, t) });
        ok(rms(tail, tail.length - sr * 0.5, tail.length) < 1e-4, `${name} ${kind}: quiet again after the playing stops (${db(rms(tail, tail.length - sr * 0.5)).toFixed(0)} dB)`);
        // Mix 0: the input untouched
        const m0 = render(key, { Mix: 0 }, inp, { kind, sr });
        const diff = m0.reduce((m, v, i) => Math.max(m, Math.abs(v - dry[i])), 0);
        if (G[key].k.some(([n]) => n === 'Mix')) ok(diff < 1e-6, `${name} ${kind}: Mix 0 is the dry sound (${diff.toExponential(1)})`);
      }
    }
  }
  // every control on the faceplate changes the sound (each one moved from end to end, others as they are)
  const sr = 48000;
  const inp = riff(GTR, sr);
  for (const [n, , lo, hi, , o] of G[key].k) {
    if (o && o.live) continue;
    const opts = { sr, at: (t) => press(key, t > 0.6 && t < 3.0, t) };
    // the controls that only work in a mode: test them in it
    const loose = { 'Pedal_Charmer Min/Maj': -40, 'Pedal_Apoptosis Air': -40 }; // checked on their own below (Air: the highs of a guitar are small)
    const base = { Pedal_Slug: { Tail: { 'Single/Flow': 0 } }, Pedal_Blorp: { Orbit: { 'Talk/Auto': 1 } }, Pedal_Charmer: { 'Min/Maj': { Drone: 100 }, Shift: { Drone: 100 } }, Pedal_Gobble: { Rate: { 'Auto/Hold': 0 } }, Pedal_Invader: { Sync: { Speed: 3 } } }[key]?.[n] || {};
    const a = render(key, { ...base, [n]: lo }, inp, opts), b = render(key, { ...base, [n]: hi }, inp, opts);
    let d = 0;
    for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
    const rel = db(Math.sqrt(d / a.length)) - db(rms(a));
    ok(rel > (loose[`${key} ${n}`] ?? -30), `${name}: ${n} changes the sound (${rel.toFixed(0)} dB)`);
  }
}

// -------------------------------------------------------- each pedal's own checks --
const sr = 48000;
const seg = (s, e) => [Math.round(s * sr), Math.round(e * sr)];

if (want('Quack')) {
  // light and hard picking quack differently: the hard one opens brighter
  const n = (amp) => riff([110, 110, 110], sr, 0.5, 0.5, amp);
  const lightY = render('Pedal_Quack', { Mix: 100 }, n(0.02)), hardY = render('Pedal_Quack', { Mix: 100 }, n(0.2));
  const bl = centroid(lightY, ...seg(0.02, 0.12), sr), bh = centroid(hardY, ...seg(0.02, 0.12), sr);
  ok(bh > bl * 1.25, `Quack: a hard pick opens brighter than a light one (${bl.toFixed(0)} → ${bh.toFixed(0)} Hz)`);
  const lv = [0, 1, 2].map((m) => db(rms(render('Pedal_Quack', { 'Low/Band/High': m, Mix: 100 }, riff(GTR, sr)))));
  ok(Math.max(...lv) - Math.min(...lv) < 3, `Quack: Low, Band and High at matched levels (${lv.map((v) => v.toFixed(1)).join(' / ')} dB)`);
  const s = render('Pedal_Quack', { Beak: 100 }, cat(sine(220, 0.3, sr, 0.3), quiet(2, sr)), { at: (t) => press('Pedal_Quack', t > 0.1) });
  ok(rms(s, ...seg(1.5, 2.3)) < 1e-5, 'Quack: Beak at full with Honk held never rings on its own');
  const h0 = render('Pedal_Quack', { Mix: 100 }, saw(110, 1, sr, 0.03)), h1 = render('Pedal_Quack', { Mix: 100 }, saw(110, 1, sr, 0.03), { at: () => press('Pedal_Quack', 1) });
  ok(centroid(h1, ...seg(0.4, 0.9), sr) > centroid(h0, ...seg(0.4, 0.9), sr) * 1.2, `Quack: Honk opens the mouth (${centroid(h0, ...seg(0.4, 0.9), sr).toFixed(0)} → ${centroid(h1, ...seg(0.4, 0.9), sr).toFixed(0)} Hz)`);
}
if (want('Croak')) {
  const held = saw(110, 2, sr, 0.08);
  const d0 = render('Pedal_Croak', { Depth: 0, Mix: 100 }, held), d6 = render('Pedal_Croak', { Depth: 60, Mix: 100 }, held);
  const t0 = throb(d0, ...seg(0.5, 1.9), sr, 4), t6 = throb(d6, ...seg(0.5, 1.9), sr, 4);
  ok(t6 > 0.25 && t0 < 0.05, `Croak: a held note pulses at Hop (4 a second: ${t6.toFixed(2)}), Depth 0 doesn't (${t0.toFixed(2)})`);
  const l = db(rms(render('Pedal_Croak', { 'Low/High': 0 }, riff(GTR, sr)))), h = db(rms(render('Pedal_Croak', { 'Low/High': 1 }, riff(GTR, sr))));
  ok(Math.abs(l - h) < 3, `Croak: Low and High without a big jump in level (${(h - l).toFixed(1)} dB)`);
  const st = render('Pedal_Croak', { Mix: 100, Hop: 6 }, riff([110, 147, 110, 147], sr, 0.12, 0.12, 0.12));
  ok(rms(st, ...seg(0, 0.5)) > 0.01, 'Croak: short notes croak');
}
if (want('Gobble')) {
  // a note whose tone never changes by itself (only its loudness fades), so any change is the pedal's
  const n = (amp) => saw(110, 0.7, sr, amp).map((v, i) => v * Math.exp((-3 * i) / sr));
  const vary = (y, a, b) => {
    const v = [];
    for (let t = a; t < b; t += 0.04) v.push(centroid(y, ...seg(t, t + 0.04), sr));
    return Math.max(...v) - Math.min(...v);
  };
  const soft = render('Pedal_Gobble', { Mix: 100 }, n(0.015)), hard = render('Pedal_Gobble', { Mix: 100 }, n(0.2));
  ok(vary(hard, 0.02, 0.5) > vary(soft, 0.02, 0.5) * 1.3, `Gobble: a stronger pick moves the mouth further (${vary(soft, 0.02, 0.5).toFixed(0)} → ${vary(hard, 0.02, 0.5).toFixed(0)} Hz)`);
  const hold = render('Pedal_Gobble', { Mix: 100, 'Auto/Hold': 1 }, saw(110, 2, sr, 0.08)), auto = render('Pedal_Gobble', { Mix: 100, 'Auto/Hold': 0, Rate: 5 }, saw(110, 2, sr, 0.08));
  ok(vary(hold, 0.4, 1.8) < vary(auto, 0.4, 1.8) * 0.5, `Gobble: Hold keeps the vowel still (${vary(hold, 0.4, 1.8).toFixed(0)} vs Auto ${vary(auto, 0.4, 1.8).toFixed(0)} Hz)`);
  const vw = [0, 1, 2].map((v) => centroid(render('Pedal_Gobble', { Mix: 100, Vowel: v, 'Auto/Hold': 1 }, saw(110, 1, sr, 0.08)), ...seg(0.3, 0.9), sr));
  ok(vw[2] > vw[1] * 1.2 && vw[0] > vw[1], `Gobble: AH, OW and EE sound different (${vw.map((v) => v.toFixed(0)).join(' / ')} Hz)`);
}
if (want('Slug')) {
  const n = riff([110, 147, 165], sr, 0.8, 0.8);
  const dry = render(null, {}, n), y = render('Pedal_Slug', { 'Single/Flow': 0 }, n);
  const early = db(rms(y, ...seg(0, 0.02))) - db(rms(dry, ...seg(0, 0.02))), late = db(rms(y, ...seg(0.35, 0.55))) - db(rms(dry, ...seg(0.35, 0.55)));
  ok(early < -15 && late > -3, `Slug: the pick's attack is gone (${early.toFixed(0)} dB) and the note swells in (${late.toFixed(1)} dB at 0.4 s)`);
  ok(db(rms(y, ...seg(0.8, 0.82))) - db(rms(dry, ...seg(0.8, 0.82))) < -10, 'Slug Single: the next note swells again');
  const legato = cat(saw(110, 0.5, sr, 0.08), saw(147, 0.5, sr, 0.08), quiet(1, sr));
  const fl = render('Pedal_Slug', { 'Single/Flow': 1, Rise: 100 }, legato), fd = render(null, {}, legato);
  ok(db(rms(fl, ...seg(0.5, 0.55))) - db(rms(fd, ...seg(0.5, 0.55))) > -3, 'Slug Flow: legato playing keeps the swell');
  const noise = new Float32Array(sr * 2).map(() => (Math.random() * 2 - 1) * 0.0008);
  ok(rms(render('Pedal_Slug', {}, noise)) < 0.0003, 'Slug: muted-string noise never sets it off');
}
if (want('Blorp')) {
  const corners = [[0, 0], [100, 0], [0, 100], [100, 100]].map(([X, Y]) => centroid(render('Pedal_Blorp', { 'Mouth X': X, 'Mouth Y': Y, Wobble: 0, Mix: 100 }, saw(110, 1, sr, 0.08)), ...seg(0.3, 0.9), sr));
  const spread = Math.max(...corners) / Math.min(...corners);
  ok(spread > 1.5 && new Set(corners.map((c) => Math.round(c / 60))).size === 4, `Blorp: the four corners are different vowels (${corners.map((c) => c.toFixed(0)).join(' / ')} Hz)`);
  const p = (w) => {
    const y = render('Pedal_Blorp', { Wobble: w, Mix: 100 }, sine(220, 2, sr, 0.08));
    const ps = [];
    for (let t = 0.3; t < 1.8; t += 0.05) ps.push(cents(pitch(y, ...seg(t, t + 0.05), sr, 150, 400), 220));
    return Math.max(...ps) - Math.min(...ps);
  };
  const p0 = p(0), p100 = p(100);
  ok(p0 < 3 && p100 > 30 && p100 < 130, `Blorp: Wobble 0 holds the pitch (${p0.toFixed(1)} cents), Wobble 100 warbles about ±50 (${p100.toFixed(0)} cents)`);
}
if (want('Boing')) {
  for (const [iv, semis] of [[0, -12], [1, 7], [2, 12], [3, 24]]) {
    for (const [what, input, hz] of [['a held note', sine(220, 1.6, sr, 0.1), 220], ['a chord (its root)', null, 0]]) {
      if (!input) continue;
      const y = render('Pedal_Boing', { Interval: iv, Rise: 40 }, input, { at: (t) => press('Pedal_Boing', t > 0.4) });
      const f = pitch(y, ...seg(1.0, 1.4), sr, 50, 4000);
      ok(Math.abs(cents(f, hz * 2 ** (semis / 12))) < 25, `Boing ${G.Pedal_Boing.k[0][5].labels[iv]}: Jump moves ${what} to ${(hz * 2 ** (semis / 12)).toFixed(0)} Hz (${f.toFixed(1)})`);
      ok(Math.abs(cents(pitch(y, ...seg(0.1, 0.35), sr, 50, 4000), hz)) < 10, `Boing ${G.Pedal_Boing.k[0][5].labels[iv]}: at rest your own pitch`);
    }
  }
  const chord = new Float32Array(sr * 1.6);
  for (const f of [110, 138.6, 164.8]) pluck(chord, 0, f, 0.1, 1.6, sr);
  const cy = render('Pedal_Boing', { Interval: 2, Rise: 40 }, chord, { at: (t) => press('Pedal_Boing', t > 0.4) });
  ok(tone(cy, ...seg(0.9, 1.4), sr, 220) > 2 * tone(cy, ...seg(0.9, 1.4), sr, 110), 'Boing +12: a chord moves up an octave too');
  // let go halfway up: it comes back from where it got to, without a jump
  const y = render('Pedal_Boing', { Interval: 2, Rise: 600, Fall: 300 }, sine(220, 2, sr, 0.1), { at: (t) => press('Pedal_Boing', t > 0.4 && t < 0.7) });
  ok(maxStep(y, ...seg(0.6, 1.2)) < 0.06, `Boing: let go mid-rise and the pitch turns back smoothly (largest step ${maxStep(y, ...seg(0.6, 1.2)).toFixed(3)})`);
  const at0 = render('Pedal_Boing', {}, riff(GTR, sr)), dry = render(null, {}, riff(GTR, sr));
  ok(at0.every((v, i) => Math.abs(v - dry[i]) < 1e-6), 'Boing: at rest the sound is exactly your own (no delay)');
  const lever = render('Pedal_Boing', { Interval: 2 }, sine(220, 1.5, sr, 0.1), { at: (t) => x.param(SHP.lever, t > 0.4 ? 0.5 : 0) });
  ok(Math.abs(cents(pitch(lever, ...seg(1.0, 1.4), sr), 220 * 2 ** 0.5)) < 30, `Boing: Bend halfway at +12 is about +6 (${pitch(lever, ...seg(1.0, 1.4), sr).toFixed(0)} Hz)`);
  const both = render('Pedal_Boing', { Interval: 2, Rise: 40 }, sine(220, 1.5, sr, 0.1), { at: (t) => (x.param(SHP.lever, 0.5), press('Pedal_Boing', t > 0.4)) });
  ok(Math.abs(cents(pitch(both, ...seg(1.0, 1.4), sr), 440)) < 25, 'Boing: Jump and Bend together: the bigger one wins (not added up)');
}
if (want('Caterwaul')) {
  const n = cat(quiet(0.1, sr), saw(220, 1.2, sr, 0.1));
  const curve = (y) => {
    const ps = [];
    for (let t = 0.12; t < 1.1; t += 0.03) ps.push(cents(pitch(y, ...seg(t, t + 0.03), sr, 100, 900), 220) / 100);
    return ps;
  };
  const up = curve(render('Pedal_Caterwaul', { Meow: 3, Mix: 100, Tail: 600 }, n)), dn = curve(render('Pedal_Caterwaul', { Meow: 3, Mix: 100, Tail: 600, 'Up/Down': 1 }, n));
  ok(Math.max(...up) > 2.3 && Math.max(...up) < 3.6, `Caterwaul Up: the meow rises about 3 semitones (${Math.max(...up).toFixed(1)})`);
  ok(Math.min(...dn) < -2.3 && Math.min(...dn) > -3.6, `Caterwaul Down: it falls instead (${Math.min(...dn).toFixed(1)})`);
  ok(Math.abs(up[up.length - 1]) < 0.3, 'Caterwaul: back to the note after Tail');
  const m0 = curve(render('Pedal_Caterwaul', { Meow: 0, Mix: 100 }, n));
  ok(Math.max(...m0.map(Math.abs)) < 0.15, 'Caterwaul: Meow 0 bends nothing');
  const h = render('Pedal_Caterwaul', { Hiss: 100, Purr: 0 }, cat(saw(220, 0.5, sr, 0.1), quiet(1, sr)));
  ok(rms(h, ...seg(1.0, 1.5)) < 1e-5, 'Caterwaul: the hiss stops when you stop');
  const pr = render('Pedal_Caterwaul', { Purr: 100, Meow: 0, Mix: 100 }, saw(220, 1.5, sr, 0.1));
  ok(throb(pr, ...seg(0.3, 1.4), sr, 25) > 0.2, `Caterwaul: Purr flutters about 25 a second (${throb(pr, ...seg(0.3, 1.4), sr, 25).toFixed(2)})`);
  const rep = render('Pedal_Caterwaul', {}, riff([220, 220, 220, 220], sr, 0.15, 0.4));
  ok(rms(rep, ...seg(0.05, 0.6)) > 0.3 * rms(render(null, {}, riff([220, 220, 220, 220], sr, 0.15, 0.4)), ...seg(0.05, 0.6)), 'Caterwaul: fast repeated notes keep sounding');
}
const synthCheck = (key, kind, hz) => {
  const input = cat(saw(hz, 1.2, sr, 0.1), quiet(0.6, sr));
  const y = render(key, { Mix: 100, ...(key === 'Pedal_Gremlin' ? { Sub: 0, Root: 100, Fifth: 0 } : { Voice: 1, Filter: 4000 }) }, input, { kind });
  const f = pitch(y, ...seg(0.5, 1.0), sr, 25, 2000);
  return { f, after: rms(y, ...seg(1.4, 1.8)), y };
};
if (want('Gremlin')) {
  for (const [kind, hz] of [['guitar', 110], ['guitar', 330], ['bass', 41.2], ['bass', 73.4]]) {
    const { f, after } = synthCheck('Pedal_Gremlin', kind, hz);
    ok(Math.abs(cents(f, hz)) < 20, `Gremlin ${kind}: the synth plays the note you play (${hz} → ${f.toFixed(1)} Hz)`);
    ok(after < 1e-4, `Gremlin ${kind}: it stops when you stop`);
  }
  const y = render('Pedal_Gremlin', { Mix: 100, Sub: 100, Root: 0, Fifth: 0, Bite: 0 }, saw(220, 1, sr, 0.1));
  ok(Math.abs(cents(pitch(y, ...seg(0.5, 0.9), sr, 50, 1000), 110)) < 20, 'Gremlin: Sub is an octave below');
  const f5 = render('Pedal_Gremlin', { Mix: 100, Sub: 0, Root: 0, Fifth: 100, Bite: 0 }, saw(220, 1, sr, 0.1));
  ok(Math.abs(cents(pitch(f5, ...seg(0.5, 0.9), sr, 50, 1000), 330)) < 20, 'Gremlin: Fifth is a fifth above');
  const chord = new Float32Array(sr * 1.5);
  for (const f of [110, 138.6, 164.8, 220]) pluck(chord, 0, f, 0.1, 1.5, sr);
  const cy = render('Pedal_Gremlin', { Mix: 100 }, chord);
  ok(rms(cy, ...seg(0.3, 1.3)) < 0.25 * rms(render('Pedal_Gremlin', { Mix: 100 }, saw(110, 1.5, sr, 0.1)), ...seg(0.3, 1.3)), 'Gremlin: a chord gives the synth nothing to follow');
  const sl = render('Pedal_Gremlin', { Mix: 100, Glide: 300, Sub: 0, Fifth: 0 }, cat(saw(110, 0.8, sr, 0.1), saw(220, 0.8, sr, 0.1)));
  const mid = pitch(sl, ...seg(0.9, 0.95), sr, 50, 1000);
  ok(mid > 115 && mid < 210, `Gremlin: Glide slides between notes (${mid.toFixed(0)} Hz on the way)`);
}
if (want('Invader')) {
  for (const [kind, hz] of [['guitar', 196], ['bass', 55]]) {
    const { f, after } = synthCheck('Pedal_Invader', kind, hz);
    ok(Math.abs(cents(f, hz)) < 20, `Invader ${kind}: Lead plays your note (${hz} → ${f.toFixed(1)} Hz)`);
    ok(after < 1e-4, `Invader ${kind}: no stuck note after you stop`);
  }
  const step = render('Pedal_Invader', { Voice: 3, Speed: 4, Mix: 100, Filter: 8000 }, saw(110, 2.2, sr, 0.1));
  const notes = [];
  for (let t = 0.6; t < 2.0; t += 0.25) notes.push(Math.round(cents(pitch(step, ...seg(t + 0.05, t + 0.2), sr, 50, 1000), 110) / 100));
  ok(new Set(notes).size >= 3 && notes.every((n) => [0, 7, 12].includes(n)), `Invader Step: 0, +7, +12, +7 (${notes.join(' ')})`);
  const las = render('Pedal_Invader', { Voice: 2, Speed: 1, Mix: 100, Filter: 8000 }, saw(110, 1.5, sr, 0.1));
  const early = pitch(las, ...seg(0.12, 0.17), sr, 50, 2000), late = pitch(las, ...seg(1.1, 1.3), sr, 50, 2000);
  ok(early > late * 1.5, `Invader Laser: each note dives down (${early.toFixed(0)} → ${late.toFixed(0)} Hz)`);
  const hold = render('Pedal_Invader', { Mix: 100 }, cat(saw(196, 0.8, sr, 0.1), quiet(1, sr)), { at: (t) => press('Pedal_Invader', t > 0.5 && t < 1.5) });
  ok(rms(hold, ...seg(1.0, 1.4)) > 0.01 && Math.abs(cents(pitch(hold, ...seg(1.0, 1.4), sr), 196)) < 25, 'Invader: Hold keeps the note after you stop');
  ok(rms(hold, ...seg(1.65, 1.8)) < 1e-4, 'Invader: let go of Hold and it stops');
  const none = render('Pedal_Invader', { Mix: 100 }, cat(quiet(0.5, sr), saw(196, 0.5, sr, 0.1)), { at: (t) => press('Pedal_Invader', t > 0.2) });
  ok(rms(none, ...seg(0.6, 0.95)) > 0.005, 'Invader: Hold pressed with no note keeps nothing (the synth still plays new notes)');
  const lfo = (bpm) => {
    const y = render('Pedal_Invader', { Voice: 0, Speed: 2.2, Sync: 1, Mix: 100, Filter: 600 }, saw(110, 3, sr, 0.1), { live: { tempo: bpm } });
    const c = [], step = 0.02;
    for (let t = 0.5; t < 2.9; t += step) c.push(centroid(y, ...seg(t, t + 0.04), sr));
    const mean = c.reduce((s, v) => s + v, 0) / c.length;
    let best = 0, bh = 0;
    for (let h = 0.8; h <= 4.2; h += 0.02) {
      let re = 0, im = 0;
      c.forEach((v, i) => ((re += (v - mean) * Math.cos(2 * Math.PI * h * i * step)), (im += (v - mean) * Math.sin(2 * Math.PI * h * i * step))));
      if (Math.hypot(re, im) > best) (best = Math.hypot(re, im)), (bh = h);
    }
    return bh;
  };
  // Speed 2.2: at 120 bpm the nearest beat step is one a beat (2 Hz); at 90 bpm two a beat (3 Hz)
  const l1 = lfo(120), l2 = lfo(90);
  ok(Math.abs(l1 - 2) < 0.12 && Math.abs(l2 - 3) < 0.12, `Invader Sync: the sweep locks to the beat (120 bpm → ${l1.toFixed(2)} Hz, 90 → ${l2.toFixed(2)})`);
}
if (want('Confetti')) {
  const one = cat(saw(220, 0.08, sr, 0.15), quiet(3, sr));
  const y = render('Confetti' && 'Pedal_Confetti', { Pitch: 12, Echo: 400, Chaos: 40, Mix: 100 }, one);
  const ps = [];
  for (let k = 1; k <= 3; k++) {
    // find the k-th echo: the loudest stretch around k × 400 ms
    const a = Math.round((k * 0.4 - 0.05) * sr), b = Math.round((k * 0.4 + 0.15) * sr);
    let best = a, bv = 0;
    for (let i = a; i < b; i += 96) if (rms(y, i, i + 1600) > bv) (bv = rms(y, i, i + 1600)), (best = i);
    ps.push(pitch(y, best, best + 1600, sr, 100, 4000));
  }
  ok(ps.every((f, i) => Math.abs(cents(f, 220 * 2 ** (i + 1))) < 60), `Confetti +12: each echo an octave above the last (${ps.map((f) => f.toFixed(0)).join(' → ')} Hz)`);
  const wild = render('Pedal_Confetti', { Chaos: 100, Pitch: 0, Echo: 60, Mix: 100 }, cat(riff(GTR, sr), quiet(6, sr)), { at: (t) => press('Pedal_Confetti', t > 0.5 && t < 6) });
  ok(peak(wild) < 1.5 && finite(wild), `Confetti: Chaos at full with a long Burst stays bounded (peak ${peak(wild).toFixed(2)})`);
  ok(rms(wild, wild.length - sr, wild.length) < 1e-3, 'Confetti: after Burst is let go it settles back');
}
if (want('Blender')) {
  const n = riff([110, 147, 196, 247], sr, 0.25, 1.5);
  const ys = [0, 1, 2].map((m) => render('Pedal_Blender', { Mode: m, Mix: 100 }, n));
  const dry = render(null, {}, n);
  const differ = (a, b) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
    return db(Math.sqrt(d / a.length)) - db(rms(b));
  };
  ok(ys.every((y) => differ(y, dry) > -6) && differ(ys[0], ys[1]) > -6 && differ(ys[1], ys[2]) > -6, 'Blender: Chop, Reverse and Scatter each sound clearly different');
  // reverse: a note that swells instead of starting with a click
  const rv = render('Pedal_Blender', { Mode: 1, Size: 200, Mix: 100 }, cat(quiet(0.3, sr), riff([220], sr, 1, 1, 0.12, 0)));
  const pk = (y, a, b) => {
    let best = a, bv = 0;
    for (let i = a; i < b; i += 48) if (rms(y, i, i + 480) > bv) (bv = rms(y, i, i + 480)), (best = i);
    return best;
  };
  ok(pk(rv, ...seg(0.3, 0.8)) > seg(0.33, 0)[0], 'Reverse: the loudest point comes after the pick, not on it');
  const jam = render('Pedal_Blender', { Mode: 0, Mix: 100 }, cat(sine(196, 0.8, sr, 0.1), quiet(1.2, sr)), { at: (t) => press('Pedal_Blender', t > 0.7 && t < 1.6) });
  ok(rms(jam, ...seg(1.0, 1.5)) > 0.01, 'Blender: Jam keeps chopping what it has after you stop');
  ok(rms(jam, ...seg(1.85, 2.0)) < 1e-4, 'Blender: let go of Jam and it goes back to the live playing (silence here)');
  ok(maxStep(jam, ...seg(1.5, 1.8)) < 0.08, 'Blender: letting go of Jam is smooth');
}
if (want('Fossil')) {
  const chord = new Float32Array(sr * 1.2);
  for (const f of [110, 164.8, 220, 277]) pluck(chord, 0, f, 0.08, 1.2, sr);
  const input = cat(chord, quiet(10, sr));
  const y = render('Pedal_Fossil', { Level: 0, Fade: 200 }, input, { at: (t) => press('Pedal_Fossil', t > 0.6 && t < 8) });
  const a = rms(y, ...seg(2, 3)), b = rms(y, ...seg(7, 8));
  ok(a > 0.005, 'Fossil: Capture holds the chord after the playing stops');
  ok(Math.abs(db(b) - db(a)) < 2, `Fossil: the drone stays steady, no growth (${(db(b) - db(a)).toFixed(1)} dB over 5 s)`);
  ok(rms(y, ...seg(8.6, 9)) < 1e-4, 'Fossil Hold: let go and it fades away');
  let clicks = 0;
  for (let t = 2; t < 7.9; t += 0.01) if (maxStep(y, ...seg(t, t + 0.01)) > 0.06) clicks++;
  ok(clicks === 0, 'Fossil: no clicks in the drone');
  const melody = cat(chord, riff([330, 392, 440], sr, 0.3, 0.3, 0.1, 0));
  const over = render('Pedal_Fossil', { Level: 0 }, melody, { at: (t) => press('Pedal_Fossil', t > 0.6) });
  const plain = render('Pedal_Fossil', { Level: 0 }, melody);
  ok(tone(over, ...seg(1.3, 1.5), sr, 330) > 0.1 && tone(over, ...seg(1.3, 1.5), sr, 164.8) > 3 * tone(plain, ...seg(1.3, 1.5), sr, 164.8), 'Fossil: play a tune over the drone (both heard)');
  const lt = render('Pedal_Fossil', { Level: 0, 'Hold/Latch': 1, Fade: 100 }, input, { at: (t) => press('Pedal_Fossil', (t > 0.6 && t < 0.7) || (t > 4 && t < 4.1)) });
  ok(rms(lt, ...seg(2, 3.5)) > 0.005 && rms(lt, ...seg(4.6, 5)) < 1e-4, 'Fossil Latch: one press captures, the next lets go');
  const si = render('Pedal_Fossil', { Level: 0 }, quiet(3, sr), { at: () => press('Pedal_Fossil', 1) });
  ok(peak(si) < 1e-6, 'Fossil: capturing silence is silent');
}
if (want('Charmer')) {
  // the drone strings ring along with a note on the third: minor (F in D) vs major (F#)
  const ring = (third, hz) => {
    const y = render('Pedal_Charmer', { Key: 1, 'Min/Maj': third, Drone: 100, Buzz: 0, Mix: 100 }, cat(saw(hz, 0.4, sr, 0.1), quiet(1.5, sr)));
    return rms(y, ...seg(0.7, 1.2));
  };
  const minF = ring(0, 174.6), majF = ring(1, 174.6), minFs = ring(0, 185), majFs = ring(1, 185);
  ok(minF > 2 * majF && majFs > 2 * minFs, `Charmer: Min/Maj changes which third rings (F: ${db(minF).toFixed(0)} vs ${db(majF).toFixed(0)} dB, F#: ${db(majFs).toFixed(0)} vs ${db(minFs).toFixed(0)} dB)`);
  const y = render('Pedal_Charmer', { Drone: 100 }, cat(saw(146.8, 0.5, sr, 0.3), quiet(4, sr)));
  const r1 = rms(y, ...seg(1, 1.5)), r2 = rms(y, ...seg(3, 3.5));
  ok(r1 > r2 * 3 && rms(y, ...seg(4.2, 4.5)) < r1 * 0.05, `Charmer: mute the guitar and the drone strings die away (${db(r1).toFixed(0)} → ${db(r2).toFixed(0)} dB)`);
  ok(peak(render('Pedal_Charmer', { Drone: 100, Buzz: 100 }, saw(146.8, 1, sr, 0.6))) < 1.5, 'Charmer: a hard attack never runs away');
}
if (want('Haunt')) {
  const zero = render('Pedal_Haunt', { Low: 0, Mid: 0, High: 0, Mix: 100 }, riff(GTR, sr));
  ok(rms(zero) < 1e-5, 'Haunt: every drawbar at 0 silences the organ layer');
  const lowY = render('Pedal_Haunt', { Low: 100, Mid: 0, High: 0, Spin: 0, Mix: 100 }, saw(220, 1, sr, 0.1));
  ok(Math.abs(cents(pitch(lowY, ...seg(0.4, 0.8), sr, 50, 1000), 110)) < 25, 'Haunt: Low is an octave below');
  const hiY = render('Pedal_Haunt', { Low: 0, Mid: 0, High: 100, Spin: 0, Mix: 100 }, sine(220, 1, sr, 0.1));
  ok(Math.abs(cents(pitch(hiY, ...seg(0.4, 0.8), sr, 200, 1000), 440)) < 25, 'Haunt: High is an octave above');
  const spinAt = (fast) => throbPeak(render('Pedal_Haunt', { Spin: 100, Mix: 100 }, saw(440, 4, sr, 0.1), { live: { latch: fast ? 1 << BIT.Pedal_Haunt : 0 } }), ...seg(1.5, 3.9), sr, fast ? 4 : 0.5, fast ? 5.5 : 1);
  ok(spinAt(false) > 0.05 && spinAt(true) > 0.05, `Haunt: Slow swirls about 0.8 a second (${spinAt(false).toFixed(2)}), Fast about 5 (${spinAt(true).toFixed(2)})`);
  // flip to Fast while it plays: it takes about half a second to get there
  const ramp = render('Pedal_Haunt', { Spin: 100, Mix: 100 }, saw(440, 4, sr, 0.1), { at: (t) => x.param(SHP.latch, t > 1 ? 1 << BIT.Pedal_Haunt : 0) });
  const r1 = throbPeak(ramp, ...seg(1.0, 1.4), sr, 4, 5.5), r2 = throbPeak(ramp, ...seg(2.4, 3.4), sr, 4, 5.5);
  ok(r2 > r1 * 1.5, `Haunt: Fast spins up gradually (${r1.toFixed(2)} just after → ${r2.toFixed(2)} later)`);
}

// ------------------------------------------------- the thirty that followed (4.20) --
const at = (fn) => ({ at: fn });
const note = (hz, secs, amp = 0.1) => cat(saw(hz, secs, sr, amp), quiet(0.01, sr));
if (want('Annwn')) {
  const inp = cat(saw(220, 1, sr, 0.1), quiet(3, sr));
  const free = render('Pedal_Annwn', { Mix: 100, Return: 0.5 }, inp), held = render('Pedal_Annwn', { Mix: 100, Return: 0.5 }, inp, at((t) => word('Pedal_Annwn', t > 0.8 ? B(0) : 0)));
  ok(rms(held, ...seg(2.5, 3.5)) > 5 * rms(free, ...seg(2.5, 3.5)) + 1e-5, `Annwn: Cross holds the cloud after you stop (${db(rms(held, ...seg(2.5, 3.5))).toFixed(0)} vs ${db(rms(free, ...seg(2.5, 3.5))).toFixed(0)} dB)`);
  const tx = [0, 1, 2].map((m) => render('Pedal_Annwn', { Mix: 100, Texture: m }, riff(GTR, sr)));
  const apart = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2; return db(Math.sqrt(d / a.length)) - db(rms(a)); };
  ok(apart(tx[0], tx[1]) > -6 && apart(tx[1], tx[2]) > -6 && apart(tx[0], tx[2]) > -6, 'Annwn: Mist, Hound and Hollow sound different');
}
if (want('Apoptosis')) {
  const inp = cat(saw(110, 1, sr, 0.1), quiet(4, sr));
  const none = render('Pedal_Apoptosis', { Mix: 100 }, inp), rel = render('Pedal_Apoptosis', { Mix: 100 }, inp, at((t) => word('Pedal_Apoptosis', t > 0.9 && t < 0.95 ? B(0) : 0)));
  ok(rms(rel, ...seg(1.5, 2)) > 0.005 && rms(none, ...seg(1.5, 2)) < 1e-4, `Apoptosis: Release turns the last moment into a drone (${db(rms(rel, ...seg(1.5, 2))).toFixed(0)} dB after you stop)`);
  const bl = render('Pedal_Apoptosis', { Mix: 100, 'Fall/Bloom': 1, Lifespan: 4 }, inp, at((t) => word('Pedal_Apoptosis', t > 0.9 && t < 0.95 ? B(0) : 0)));
  ok(rms(rel, ...seg(1.1, 1.3)) > rms(rel, ...seg(3.5, 3.7)) * 1.5 && rms(bl, ...seg(1.0, 1.1)) < rms(bl, ...seg(1.8, 2.2)), 'Apoptosis: Fall starts full and dies; Bloom grows in first');
}
if (want('Bifrost')) {
  const r = (k) => centroid(render('Pedal_Bifrost', { Mix: 100, ...k }, riff(GTR, sr)), ...seg(1, 3.5), sr);
  const dark = r({ Rift: 0 }), ice = r({ Rift: 100 }), hel = r({ Rift: 0, 'Midgard/Helheim': 1 });
  ok(ice > dark * 1.3 && hel < dark, `Bifrost: ice is bright, the dark sky dark, Helheim darker still (${ice.toFixed(0)} / ${dark.toFixed(0)} / ${hel.toFixed(0)} Hz)`);
}
if (want('BluePrince')) {
  const inp = cat(saw(220, 0.2, sr, 0.1), quiet(2.5, sr));
  const room = (n) => render('Pedal_BluePrince', { Depth: 100, Steps: 0.05 }, inp, { live: { [VAL0 + KIND.Pedal_BluePrince]: n } });
  const st = room(0), ha = room(1), ce = room(2);
  ok(rms(ha, ...seg(1.2, 1.6)) > 3 * rms(st, ...seg(1.2, 1.6)), `Blue Prince: the Hall rings far longer than the Study (${db(rms(ha, ...seg(1.2, 1.6))).toFixed(0)} vs ${db(rms(st, ...seg(1.2, 1.6))).toFixed(0)} dB)`);
  ok(centroid(ce, ...seg(0.25, 0.8), sr) < centroid(st, ...seg(0.25, 0.8), sr) * 0.8, `Blue Prince: the Cellar is darker than the Study (${centroid(ce, ...seg(0.25, 0.8), sr).toFixed(0)} vs ${centroid(st, ...seg(0.25, 0.8), sr).toFixed(0)} Hz)`);
  // change rooms while it plays: it walks there, no jump
  const walk = render('Pedal_BluePrince', { Depth: 100, Steps: 1 }, riff(GTR, sr), at((t) => lval('Pedal_BluePrince', t > 1 ? 1 : 0)));
  ok(maxStep(walk, ...seg(0.9, 1.4)) < 0.2, 'Blue Prince: a new room is walked to, not jumped to');
}
if (want('Claude')) {
  // learn a phrase that swells up, then a steady phrase takes that swell
  const swell = saw(110, 1, sr, 0.12).map((v, i) => v * (i / sr));
  const inp = cat(swell, quiet(0.6, sr), saw(110, 1.2, sr, 0.08), quiet(0.6, sr));
  const y = render('Pedal_Claude', { Mix: 100, Context: 2 }, inp, at((t) => word('Pedal_Claude', t < 1.3 ? B(0) : B(1))));
  const a = rms(y, ...seg(1.65, 1.85)), b = rms(y, ...seg(2.3, 2.6));
  ok(b > 2.5 * a, `Claude: the next phrase takes the learned swell (${db(a).toFixed(0)} → ${db(b).toFixed(0)} dB)`);
  const off = render('Pedal_Claude', { Mix: 100 }, inp), plain = render(null, {}, inp);
  ok(Math.abs(db(rms(off, ...seg(1.65, 2.6))) - db(rms(plain, ...seg(1.65, 2.6)))) < 0.5, 'Claude: with nothing lit, your playing passes as it is');
}
if (want('DejaVu')) {
  const inp = cat(riff(GTR.slice(0, 6), sr, 0.25, 0.3), quiet(3, sr));
  const y = render('Pedal_DejaVu', { Mix: 100, Loop: 1 }, inp, at((t) => word('Pedal_DejaVu', (t > 1.6 && t < 1.65 ? B(0) : 0) | (t > 1.65 && t < 3.5 ? B(1) : 0))));
  ok(rms(y, ...seg(2.5, 3.3)) > 0.005 && rms(y, ...seg(4.2, 4.6)) < 1e-4, `Deja Vu: Enter and Repeat loop what you played (${db(rms(y, ...seg(2.5, 3.3))).toFixed(0)} dB), off when Repeat goes out`);
  // the loop is two beats long at 120 a minute (one second): the sound repeats every second
  const t0 = rms(y, ...seg(2.0, 2.2)), t1 = rms(y, ...seg(3.0, 3.2));
  ok(Math.abs(db(t0) - db(t1)) < 6, `Deja Vu: the loop comes round on the beat (${db(t0).toFixed(1)} / ${db(t1).toFixed(1)} dB)`);
}
if (want('Duat')) {
  const inp = saw(220, 2, sr, 0.1);
  const all = render('Pedal_Duat', {}, inp), deep = render('Pedal_Duat', { Passage: 3 }, inp, at((t) => word('Pedal_Duat', t > 0.5 ? B(0) : 0)));
  ok(centroid(deep, ...seg(1, 1.9), sr) < centroid(all, ...seg(1, 1.9), sr) * 0.6, `Duat: Descend to Gate IV: only the deep dark (${centroid(deep, ...seg(1, 1.9), sr).toFixed(0)} vs ${centroid(all, ...seg(1, 1.9), sr).toFixed(0)} Hz)`);
  const c = cat(saw(220, 0.2, sr, 0.1), quiet(4, sr));
  const g4 = render('Pedal_Duat', { Balance: 100, 'Gate I': 0, 'Gate II': 0, 'Gate III': 0, 'Gate IV': 100 }, c), g1 = render('Pedal_Duat', { Balance: 100, 'Gate I': 100, 'Gate II': 0, 'Gate III': 0, 'Gate IV': 0 }, c);
  ok(rms(g4, ...seg(3, 3.5)) > 5 * rms(g1, ...seg(3, 3.5)), 'Duat: Gate IV rings far longer than Gate I');
}
if (want('EventHorizon')) {
  const inp = cat(saw(220, 0.15, sr, 0.15), quiet(2, sr));
  const y = render('Pedal_EventHorizon', { Mix: 100, Time: 400, Redshift: 12, 'Gravity X': 0, 'Gravity Y': 30 }, inp);
  const f = pitch(y, ...seg(0.45, 0.6), sr, 60, 400);
  ok(Math.abs(cents(f, 110)) < 60, `Event Horizon: the first echo falls by Redshift (an octave: ${f.toFixed(0)} Hz)`);
  const a = render('Pedal_EventHorizon', { Mix: 100, 'Gravity Y': 0 }, inp), b = render('Pedal_EventHorizon', { Mix: 100, 'Gravity Y': 100 }, inp);
  ok(rms(b, ...seg(1.5, 2)) > 3 * rms(a, ...seg(1.5, 2)), 'Event Horizon: more Gravity up, more echoes');
}
if (want('Fenrir')) {
  const inp = saw(110, 2, sr, 0.1);
  const y = render('Pedal_Fenrir', { Bind: 100, Howl: 7, Growl: 0 }, inp, at((t) => word('Pedal_Fenrir', t > 0.8 ? B(0) : 0)));
  const f0 = pitch(y, ...seg(0.3, 0.7), sr, 60, 400), f1 = pitch(y, ...seg(1.4, 1.9), sr, 60, 400);
  ok(Math.abs(cents(f0, 110)) < 40 && Math.abs(cents(f1, 164.8)) < 60, `Fenrir: Break howls up by Howl (${f0.toFixed(0)} → ${f1.toFixed(0)} Hz)`);
  const hiss = cat(saw(110, 0.5, sr, 0.1), new Float32Array(sr).map(() => (Math.random() * 2 - 1) * 0.0015));
  const loose = render('Pedal_Fenrir', { Restrain: 0, Bind: 100 }, hiss), tight = render('Pedal_Fenrir', { Restrain: 100, Bind: 100 }, hiss);
  ok(rms(tight, ...seg(0.9, 1.4)) < 0.3 * rms(loose, ...seg(0.9, 1.4)), 'Fenrir: Restrain keeps it quiet between notes');
}
if (want('Inanna')) {
  const inp = saw(110, 1.5, sr, 0.1);
  const full = render('Pedal_Inanna', { Echoes: 0 }, inp), down = render('Pedal_Inanna', { Echoes: 0, Descent: 80 }, inp);
  const back = render('Pedal_Inanna', { Echoes: 0, Descent: 80 }, inp, at(() => word('Pedal_Inanna', B(0))));
  const cf = centroid(full, ...seg(0.5, 1.4), sr), cd = centroid(down, ...seg(0.5, 1.4), sr), cb = centroid(back, ...seg(0.5, 1.4), sr);
  ok(cd < cf * 0.6 && cb > cf * 0.85, `Inanna: Descent takes the top away, Return brings it back (${cf.toFixed(0)} → ${cd.toFixed(0)} → ${cb.toFixed(0)} Hz)`);
  const flat = render('Pedal_Inanna', { Echoes: 0 }, sine(440, 1, sr, 0.1)), dry = render(null, {}, sine(440, 1, sr, 0.1));
  ok(Math.abs(db(rms(flat, ...seg(0.3, 0.9))) - db(rms(dry, ...seg(0.3, 0.9)))) < 1.5, 'Inanna: every band where it starts is your sound as it was');
}
if (want('Janus')) {
  const click = cat(saw(440, 0.03, sr, 0.3), quiet(1.5, sr));
  const fu = render('Pedal_Janus', { Mix: 100, Crossing: 100, Delay: 450, Repeats: 0 }, click), pa = render('Pedal_Janus', { Mix: 100, Crossing: 0, Delay: 450, Repeats: 0 }, click);
  ok(rms(fu, ...seg(0.44, 0.5)) > 4 * rms(fu, ...seg(0.25, 0.4)) && rms(pa, ...seg(0.44, 0.5)) < 0.5 * rms(fu, ...seg(0.44, 0.5)), 'Janus: the future face is an echo at Delay; the past face isn\'t');
  const sw = render('Pedal_Janus', { Mix: 100, Crossing: 0, Delay: 450, Repeats: 0 }, click, at(() => word('Pedal_Janus', B(0))));
  ok(rms(sw, ...seg(0.44, 0.5)) > 0.5 * rms(fu, ...seg(0.44, 0.5)), 'Janus: Threshold swaps the faces');
  // the past: a fading note comes back growing (backwards)
  const fade = cat(sine(330, 0.4, sr, 0.2).map((v, i) => v * Math.exp((-6 * i) / sr)), quiet(1, sr));
  const bw = render('Pedal_Janus', { Mix: 100, Crossing: 0, Reverse: 300, Age: 0, Fade: 0 }, fade);
  ok(finite(bw) && rms(bw, ...seg(0.4, 0.8)) > 1e-3, 'Janus: the past plays your notes back backwards');
}
if (want('Kitsune')) {
  const offs = Object.fromEntries([...Array(9)].map((_, i) => [`Tail ${i + 1}`, 0]));
  ok(rms(render('Pedal_Kitsune', { ...offs, Mix: 100 }, riff(GTR, sr))) < 1e-5, 'Kitsune: no tails lit, no voices');
  const m = [0, 100].map((v) => centroid(render('Pedal_Kitsune', { Mix: 100, Mask: v }, saw(110, 1.5, sr, 0.1)), ...seg(0.6, 1.4), sr));
  ok(m[1] > m[0] * 1.2, `Kitsune: Mask goes from a dark face to a bright one (${m[0].toFixed(0)} → ${m[1].toFixed(0)} Hz)`);
  const one = render('Pedal_Kitsune', { ...offs, 'Tail 9': 1, Mix: 100 }, cat(saw(220, 0.05, sr, 0.3), quiet(0.6, sr)));
  ok(rms(one, ...seg(0.34, 0.4)) > 5 * rms(one, ...seg(0.1, 0.3)), 'Kitsune: Tail 9 is a voice about a third of a second behind');
}
if (want('Kukulkan')) {
  const inp = sine(110, 2, sr, 0.1);
  const steps = Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`Step ${i}`, 12]));
  const up = render('Pedal_Kukulkan', { ...steps, Mix: 100, Wind: 0 }, inp, at(() => word('Pedal_Kukulkan', B(0)))), off = render('Pedal_Kukulkan', { ...steps, Mix: 100, Wind: 0 }, inp);
  ok(tone(up, ...seg(0.5, 1.9), sr, 220) > 0.3 && tone(off, ...seg(0.5, 1.9), sr, 220) < 0.05, 'Kukulkan: Rise moves you by the steps (an octave here); off, nothing');
  const climb = render('Pedal_Kukulkan', { Mix: 100, Wind: 0, Rate: 0 }, inp, { live: { [SHP.tempo]: 120, [WORD0 + KIND.Pedal_Kukulkan]: 1 } });
  // each step a quarter note (half a second): +3, +5 and +7 semitones in turn
  const ts = [[0.6, 3], [1.1, 5], [1.6, 7]].map(([t, st]) => tone(climb, ...seg(t, t + 0.3), sr, 110 * 2 ** (st / 12)));
  ok(ts.every((v) => v > 0.2), `Kukulkan: quarter notes at 120 climb the stair (${ts.map((v) => v.toFixed(2)).join(' / ')})`);
}
if (want('Long')) {
  const q = { Wind: 0, Rain: 0, Thunder: 0, Cloud: 0, Breath: 100 };
  const y = render('Pedal_Long', q, sine(220, 2, sr, 0.1), at((t) => word('Pedal_Long', t > 0.8 ? B(0) : 0)));
  const f0 = pitch(y, ...seg(0.3, 0.7), sr, 100, 1000), f1 = pitch(y, ...seg(1.5, 1.9), sr, 100, 1000);
  ok(Math.abs(cents(f0, 220)) < 30 && Math.abs(cents(f1, 440)) < 30, `Long: Ascend rises an octave (${f0.toFixed(0)} → ${f1.toFixed(0)} Hz)`);
  const br = [0, 100].map((v) => centroid(render('Pedal_Long', { ...q, Breath: v }, saw(110, 1, sr, 0.1)), ...seg(0.3, 0.9), sr));
  ok(br[1] > br[0] * 2, `Long: Breath opens from dark (${br[0].toFixed(0)} Hz) to open (${br[1].toFixed(0)} Hz)`);
  const pe = render('Pedal_Long', { ...q, Pearl: 2 }, sine(220, 1, sr, 0.1));
  ok(tone(pe, ...seg(0.3, 0.9), sr, 440) > 0.15, 'Long: the Pearl on Octave adds a voice an octave up');
}
if (want('Maui')) {
  const y = render('Pedal_Maui', { Sun: 2, Horizon: 0.1, Tide: 0 }, sine(440, 5, sr, 0.1), at((t) => word('Pedal_Maui', t > 0.5 && t < 2 ? B(0) : 0)));
  const f1 = pitch(y, ...seg(1.2, 1.6), sr, 100, 1000), f2 = pitch(y, ...seg(4.2, 4.8), sr, 100, 1000);
  ok(Math.abs(cents(f1, 220)) < 40 && Math.abs(cents(f2, 440)) < 30, `Maui: Haul on Sun III slows to half (${f1.toFixed(0)} Hz), let go and it catches up (${f2.toFixed(0)} Hz)`);
  const d = render('Pedal_Maui', { Sun: 2, Horizon: 0.1, Tide: 0 }, sine(440, 2, sr, 0.1), at((t) => lval('Pedal_Maui', t > 0.5 ? 0.5 : 0)));
  const fd = pitch(d, ...seg(1.2, 1.6), sr, 100, 1000);
  ok(fd < 420 && fd > 230, `Maui: the Drag hook halfway slows it part way (${fd.toFixed(0)} Hz)`);
  ok(maxStep(y, ...seg(1.9, 4)) < 0.1, 'Maui: catching up again has no click');
}
if (want('Mimic')) {
  const pulse = saw(110, 1.5, sr, 0.1).map((v, i) => v * (0.55 + 0.45 * Math.sin((2 * Math.PI * 4 * i) / sr)));
  const inp = cat(pulse, saw(110, 2, sr, 0.08));
  const y = render('Pedal_Mimic', { Mix: 100, Inherit: 100, 'Rhythm/Tone/Both': 0 }, inp, at((t) => word('Pedal_Mimic', t < 1.5 ? B(0) : B(1))));
  const plain = render('Pedal_Mimic', { Mix: 100, Inherit: 100 }, inp);
  ok(throb(y, ...seg(1.8, 3.4), sr, 4) > 3 * throb(plain, ...seg(1.8, 3.4), sr, 4) + 0.1, `Mimic: a steady note takes on the learned pulse (${throb(y, ...seg(1.8, 3.4), sr, 4).toFixed(2)})`);
  const caught = render('Pedal_Mimic', { Mix: 100, Inherit: 100, 'Rhythm/Tone/Both': 0 }, inp, at((t) => word('Pedal_Mimic', (t > 1.45 && t < 1.5 ? B(2) : 0) | (t > 1.5 ? B(1) : 0))));
  ok(throb(caught, ...seg(1.8, 3.4), sr, 4) > 0.1, 'Mimic: Catch learns the last two seconds at once');
}
if (want('Molt')) {
  const inp = cat(sine(330, 0.3, sr, 0.15), quiet(2.5, sr));
  const p = (d) => centroid(render('Pedal_Molt', { Mix: 100, Age: 100, Shed: 20, Decay: 100, 'Up/Down': d }, inp), ...seg(1.6, 2.2), sr);
  const u = p(0), dn = p(1);
  ok(cents(u, dn) > 60, `Molt: skins drift up or down (${u.toFixed(0)} / ${dn.toFixed(0)} Hz)`);
}
if (want('Nataraja')) {
  const inp = saw(110, 2, sr, 0.1);
  const y = render('Pedal_Nataraja', { Tempo: 120, Change: 0 }, inp, at(() => word('Pedal_Nataraja', B(0))));
  ok(rms(y, ...seg(0.02, 0.09)) > 5 * rms(y, ...seg(0.3, 0.45)) + 1e-6, 'Nataraja: lit steps sound, unlit ones rest (step 2 is quiet)');
  const off = render('Pedal_Nataraja', {}, inp);
  ok(Math.abs(db(rms(off)) - db(rms(render(null, {}, inp)))) < 0.5, 'Nataraja: with Dance off your sound passes as it is');
}
if (want('Nothing')) {
  const inp = riff(GTR, sr), y = render('Pedal_Nothing', {}, inp), d = render(null, {}, inp);
  ok(y.every((v, i) => Math.abs(v - d[i]) < 1e-6), 'Nothing: does nothing at all');
}
if (want('Olympus')) {
  const inp = cat(saw(110, 0.6, sr, 0.1), quiet(4, sr));
  const free = render('Pedal_Olympus', { Cloud: 100 }, inp), held = render('Pedal_Olympus', { Cloud: 100 }, inp, at((t) => word('Pedal_Olympus', t > 0.5 ? B(1) : 0)));
  ok(rms(held, ...seg(3.5, 4.3)) > 10 * rms(free, ...seg(3.5, 4.3)) + 1e-6, 'Olympus: Hold freezes the reverb tail');
  const th = [0, 100].map((v) => centroid(render('Pedal_Olympus', { Thunder: v, Cloud: 0, Echo: 0, Storm: 0 }, sine(110, 1, sr, 0.1)), ...seg(0.3, 0.9), sr));
  ok(th[1] > th[0] * 1.5, `Olympus: Thunder brings the storm (${th[0].toFixed(0)} → ${th[1].toFixed(0)} Hz)`);
}
if (want('Ouroboros')) {
  const inp = cat(saw(220, 0.2, sr, 0.1), quiet(3, sr));
  const sh = render('Pedal_Ouroboros', { Mix: 100, 'Shed/Devour': 0, Digest: 80 }, inp), dv = render('Pedal_Ouroboros', { Mix: 100, 'Shed/Devour': 1, Digest: 80 }, inp);
  ok(centroid(sh, ...seg(1, 2.5), sr) > 1.5 * centroid(dv, ...seg(1, 2.5), sr), 'Ouroboros: Shed climbs and thins, Devour sinks and darkens');
  const sw = render('Pedal_Ouroboros', { Mix: 100, Digest: 30 }, inp, at((t) => word('Pedal_Ouroboros', t > 0.1 && t < 2.6 ? B(0) : 0)));
  const no = render('Pedal_Ouroboros', { Mix: 100, Digest: 30 }, inp);
  ok(rms(sw, ...seg(2, 2.5)) > 10 * rms(no, ...seg(2, 2.5)) + 1e-6 && peak(sw) < 1.5, 'Ouroboros: Swallow keeps it going round, and it never runs away');
}
if (want('Parasite')) {
  const inp = saw(110, 2.5, sr, 0.1);
  const y = render('Pedal_Parasite', { Host: 0, Creature: 100, Hunger: 1.5 }, inp);
  ok(rms(y, ...seg(1.8, 2.3)) > 3 * rms(y, ...seg(0.1, 0.3)), `Parasite: it grows on a held note (${db(rms(y, ...seg(0.1, 0.3))).toFixed(0)} → ${db(rms(y, ...seg(1.8, 2.3))).toFixed(0)} dB)`);
  const fed = render('Pedal_Parasite', { Host: 0, Creature: 100, Hunger: 4 }, inp, at(() => word('Pedal_Parasite', B(0)))), hun = render('Pedal_Parasite', { Host: 0, Creature: 100, Hunger: 4 }, inp);
  ok(rms(fed, ...seg(0.8, 1.2)) > 1.5 * rms(hun, ...seg(0.8, 1.2)), 'Parasite: Feed makes it grow faster');
  const pv = (v) => pitch(render('Pedal_Parasite', { Host: 0, Creature: 100, Hunger: 0.2, Voice: v }, sine(110, 2, sr, 0.1)), ...seg(1, 1.8), sr, 30, 600);
  const pr = pv(0), po = pv(2);
  ok(Math.abs(cents(po, pr * 2)) < 40, `Parasite: Octave sings an octave above Root (${pr.toFixed(0)} → ${po.toFixed(0)} Hz)`);
}
if (want('Reliquary')) {
  const inp = cat(saw(220, 0.2, sr, 0.1), quiet(4, sr));
  const big = render('Pedal_Reliquary', { Mix: 100, Incense: 100 }, inp), small = render('Pedal_Reliquary', { Mix: 100, Incense: 0 }, inp);
  ok(rms(big, ...seg(2.5, 3.5)) > 5 * rms(small, ...seg(2.5, 3.5)), 'Reliquary: more Incense, a bigger, longer cathedral');
  const ch = [0, 100].map((v) => centroid(render('Pedal_Reliquary', { Mix: 100, Choir: v, Dust: 0 }, saw(110, 1.5, sr, 0.1)), ...seg(0.5, 1.4), sr));
  ok(ch[1] > ch[0] * 1.1, `Reliquary: the Choir sings above your notes (${ch[0].toFixed(0)} → ${ch[1].toFixed(0)} Hz)`);
}
if (want('Seance')) {
  const inp = cat(riff(GTR.slice(0, 5), sr, 0.3, 0.3), quiet(2.5, sr));
  const y = render('Pedal_Seance', { Mix: 100, Memory: 0 }, inp, at(() => word('Pedal_Seance', B(0))));
  const ans = rms(y, inp.length / sr - 2.2 + 0, inp.length);
  ok(rms(y, ...seg(2.6, 3.4)) > 0.002, `Seance: stop playing and your phrase answers back (${db(rms(y, ...seg(2.6, 3.4))).toFixed(0)} dB)`);
  const no = render('Pedal_Seance', { Mix: 100, Memory: 0 }, inp);
  ok(rms(no, ...seg(2.6, 3.4)) < 1e-5, 'Seance: without Listen, no answer');
  const busy = render('Pedal_Seance', { Mix: 100, Memory: 0 }, riff(GTR, sr), at((t) => word('Pedal_Seance', B(0) | (t > 0.8 && t < 0.85 ? B(1) : 0))));
  const dry = render(null, {}, riff(GTR, sr));
  let dd = 0;
  for (let i = seg(1, 3)[0]; i < seg(1, 3)[1]; i++) dd += (busy[i] - dry[i]) ** 2;
  ok(Math.sqrt(dd / (2 * sr)) < 0.2 * rms(dry, ...seg(1, 3)), 'Seance: while you play, the answers keep quiet');
  void ans;
}
if (want('Severed')) {
  const inp = riff(GTR, sr);
  const w = centroid(render('Pedal_Severed', { State: 0 }, inp), ...seg(0.5, 3), sr), hm = centroid(render('Pedal_Severed', { State: 1 }, inp), ...seg(0.5, 3), sr);
  ok(w > hm * 1.2, `Severed: Work is bright, Home warm (${w.toFixed(0)} / ${hm.toFixed(0)} Hz)`);
  const sw = render('Pedal_Severed', { State: 0, Memory: 0.3 }, inp, at((t) => word('Pedal_Severed', t > 1.5 ? B(0) : 0)));
  const home = render('Pedal_Severed', { State: 1 }, inp), work = render('Pedal_Severed', { State: 0 }, inp);
  const cs = centroid(sw, ...seg(2.2, 3.4), sr), ch = centroid(home, ...seg(2.2, 3.4), sr), cw = centroid(work, ...seg(2.2, 3.4), sr);
  ok(Math.abs(cs - ch) < Math.abs(cs - cw) && maxStep(sw, ...seg(1.4, 2)) < 0.2, `Severed: Swap crosses to the other sound, smoothly (${cs.toFixed(0)} Hz: Home ${ch.toFixed(0)}, Work ${cw.toFixed(0)})`);
}
if (want('Shango')) {
  const inp = cat(sine(220, 0.6, sr, 0.15), quiet(2.5, sr));
  const y = render('Pedal_Shango', { Pitch: 12, Delay: 200, Repeats: 0, Balance: 100, Fire: 0, Tone: 50 }, inp, at((t) => word('Pedal_Shango', (t < 0.6 ? B(0) : 0) | (t > 0.8 && t < 0.85 ? B(1) : 0))));
  const f = pitch(y, ...seg(1.15, 1.45), sr, 100, 1000);
  ok(Math.abs(cents(f, 440)) < 40, `Shango: Answer comes back an octave up (Pitch +12: ${f.toFixed(0)} Hz)`);
  const no = render('Pedal_Shango', { Balance: 100 }, inp, at((t) => word('Pedal_Shango', t < 0.6 ? B(0) : 0)));
  ok(rms(no, ...seg(0.9, 2.5)) < 1e-4, 'Shango: no Answer, no answer');
}
if (want('Tezcatl')) {
  const m = render('Pedal_Tezcatl', { 'Mirror X': 100, 'Mirror Y': 100, Smoke: 0, Ash: 0, Shadow: 100 }, sine(440, 1, sr, 0.1));
  ok(tone(m, ...seg(0.3, 0.9), sr, 1040) > 0.5, 'Tezcatl: right on the mirror moves the sound up by hertz (440 → 1040)');
  const mid = render('Pedal_Tezcatl', { 'Mirror X': 50, 'Mirror Y': 100, Smoke: 0, Ash: 0, Shadow: 100 }, sine(440, 1, sr, 0.1));
  ok(tone(mid, ...seg(0.3, 0.9), sr, 440) > 0.5, 'Tezcatl: the middle of the mirror leaves the pitch where it is');
  const v = render('Pedal_Tezcatl', { 'Mirror X': 100, 'Mirror Y': 20, Smoke: 0, Ash: 0, Shadow: 100 }, sine(440, 1, sr, 0.1), at((t) => word('Pedal_Tezcatl', t > 0.2 ? B(0) : 0)));
  ok(tone(v, ...seg(0.5, 0.9), sr, 440) < 0.1, 'Tezcatl: Vanish leaves only the mirror');
  const mv = render('Pedal_Tezcatl', { 'Mirror X': 50, 'Mirror Y': 100, Smoke: 0, Ash: 0, Shadow: 100, Motion: 1 }, sine(440, 3, sr, 0.1));
  ok(Math.abs(centroid(mv, ...seg(2.4, 2.9), sr) - centroid(mv, ...seg(0.1, 0.6), sr)) > 50, 'Tezcatl: an arrow sets the mirror moving');
}
if (want('Veles')) {
  const r = render('Pedal_Veles', { Root: 100, Earth: 0, Dream: 0, Night: 0, Mix: 100, Motion: 0 }, sine(220, 1, sr, 0.1));
  ok(Math.abs(cents(pitch(r, ...seg(0.3, 0.9), sr, 60, 600), 110)) < 30, 'Veles: Root is an octave below');
  const inp = cat(saw(110, 1, sr, 0.1), quiet(2, sr));
  const u = render('Pedal_Veles', { Mix: 100 }, inp, at((t) => word('Pedal_Veles', t > 0.7 ? B(0) : 0)));
  ok(rms(u, ...seg(2, 2.8)) > 0.003, `Veles: Underworld keeps a drone going after you stop (${db(rms(u, ...seg(2, 2.8))).toFixed(0)} dB)`);
}
if (want('WhoAreYou')) {
  const inp = sine(220, 2, sr, 0.1);
  const g = render('Pedal_WhoAreYou', { Size: 100, Wonder: 0, Smoke: 0, Mix: 100, 'Grow/Shrink': 0 }, inp), s2 = render('Pedal_WhoAreYou', { Size: 100, Wonder: 0, Smoke: 0, Mix: 100, 'Grow/Shrink': 1 }, inp);
  const fg = pitch(g, ...seg(1.5, 1.9), sr, 100, 600), fs = pitch(s2, ...seg(1.5, 1.9), sr, 100, 600);
  ok(cents(fg, 220) < -100 && cents(fs, 220) > 100, `Who Are You: Grow sinks a held note, Shrink floats it up (${fg.toFixed(0)} / ${fs.toFixed(0)} Hz)`);
}
if (want('Wukong')) {
  const clones = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`Clone ${i}`, 0]));
  const r = render('Pedal_Wukong', { ...clones, Ruyi: 12, Defiance: 0, Cloud: 0 }, sine(220, 1, sr, 0.1));
  ok(Math.abs(cents(pitch(r, ...seg(0.3, 0.9), sr, 100, 1000), 440)) < 30, 'Wukong: the Ruyi staff raises you an octave');
  const calm = render('Pedal_Wukong', { ...clones, Defiance: 0, Cloud: 0 }, riff(GTR, sr)), up = render('Pedal_Wukong', { ...clones, Defiance: 0, Cloud: 0 }, riff(GTR, sr), at(() => word('Pedal_Wukong', B(0))));
  let d = 0;
  for (let i = 0; i < calm.length; i++) d += (calm[i] - up[i]) ** 2;
  ok(db(Math.sqrt(d / calm.length)) - db(rms(calm)) > -10, 'Wukong: Uproar brings every clone in');
}

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
