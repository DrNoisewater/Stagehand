// 4.20: the fourteen pedals in The Lab through the shipped engine (rig-dsp.wasm), on made-up
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
  for (const [k, v] of Object.entries(live)) x.param(SHP[k], v);
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
const press = (key, on) => x.param(SHP.hold, on ? 1 << BIT[key] : 0);

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
ok(LAB.length === 14, `The Lab has 14 pedals (${LAB.length})`);
for (const key of LAB) {
  if (!want(key)) continue;
  const name = G[key].n;
  for (const kind of ['guitar', 'bass']) {
    for (const sr of [44100, 48000, 96000]) {
      const inp = riff(kind === 'bass' ? BASS : GTR, sr);
      const end = inp.length;
      const dry = render(null, {}, inp, { kind, sr });
      // the footswitch held through the middle of the riff, then let go
      const hasHold = (G[key].m || []).some(([, t]) => t === 'hold');
      const y = render(key, {}, inp, {
        kind, sr, block: sr === 44100 ? 32 : 128,
        at: (t) => { if (hasHold) press(key, t > 1.2 && t < 2.4); if (key === 'Pedal_Boing') x.param(SHP.lever, t > 2.6 && t < 3.0 ? 0.6 : 0); },
      });
      const lv = db(rms(y, 0, end)) - db(rms(dry, 0, end));
      const pk = peak(y) / peak(dry);
      if (sr === 48000) wav(`${name}-${kind}`, y, sr);
      ok(finite(y), `${name} ${kind} ${sr}: every sample a number`);
      ok(Math.abs(lv) < 6, `${name} ${kind} ${sr}: level near the dry sound (${lv.toFixed(1)} dB)`);
      ok(pk < 4, `${name} ${kind} ${sr}: peaks sane (${pk.toFixed(2)}x the dry peak)`);
      if (sr === 48000) {
        // silence in → silence out, also with the footswitch held and the lever pulled
        const s = render(key, {}, quiet(3, sr), { kind, sr, at: (t) => { press(key, t > 0.5 && t < 2); x.param(SHP.lever, t > 0.5 && t < 2 ? 1 : 0); } });
        ok(peak(s) < 1e-5, `${name} ${kind}: silence stays silent (${peak(s).toExponential(1)})`);
        // after the playing stops it goes quiet (tails die away)
        const tail = render(key, {}, cat(inp, quiet(4, sr)), { kind, sr });
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
    const opts = { sr, at: (t) => press(key, t > 0.6 && t < 3.0) };
    // the controls that only work in a mode: test them in it
    const loose = { 'Pedal_Charmer Min/Maj': -40 }; // checked on its own below
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

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
