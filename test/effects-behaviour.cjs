// 4.11: does every pedal and rack unit do what its kind of effect is supposed to do? Through the
// shipped engine (rig-dsp.wasm), one piece at a time, all 100 of them:
//   drives add harmonics · delays repeat the note after it stops · reverbs leave a tail ·
//   chorus/flanger/phaser/vibrato/tremolo move over time · EQ bands lift their own frequency ·
//   wahs sweep upward with the pedal · filters shape the tone · compressors even out loud and
//   quiet · the gate shuts on hiss · pitch pedals add their note.
// (test/gear-coverage.js checks every single knob changes the sound; test/pedals-wasm.cjs goes
// deeper on drives and pitch.)
const fs = require('node:fs');
const path = require('node:path');
const G = require('../src/renderer/data/gear2014.json');

const SR = 48000;
const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '../src/renderer/worklets/rig-dsp.wasm'))), {}).exports;
const need = x.mem_needed();
if (need > x.memory.buffer.byteLength) x.memory.grow(Math.ceil((need - x.memory.buffer.byteLength) / 65536));

let bad = 0, n = 0;
const fails = [];
const ok = (c, msg) => {
  n++;
  if (!c) (bad++, fails.push(msg));
  if (!c || process.env.SH_VERBOSE) console.log(c ? 'ok  ' : 'FAIL', msg);
};
const spec = (key, knobs = {}) => {
  let s = `kind\t${/^Bass_/.test(key) ? 'bass' : 'guitar'}\ngear\t${G[key].t === 'rack' ? 'rack' : 'pre'}\t${key}\n`;
  for (const [nm, , lo, hi, d] of G[key].k || []) s += `k\t${nm}\t${nm in knobs ? knobs[nm] : d}\t${lo}\t${hi}\n`;
  if (knobs.__amp) {
    // into an amp (a booster only shows what it does by how hard it pushes the amp)
    s += `gear\tamp\t${knobs.__amp}\n`;
    for (const [nm, , lo, hi, d] of G[knobs.__amp].k || []) s += `k\t${nm}\t${d}\t${lo}\t${hi}\n`;
  }
  return s;
};
const render = (key, knobs, sig, secs = 1.5) => {
  if (!x.init(SR)) throw new Error('init');
  const s = Buffer.from(spec(key, knobs) + '\0');
  new Uint8Array(x.memory.buffer, x.buf_spec(), s.length).set(s);
  if (!x.build(0)) throw new Error('build ' + key);
  x.select(0);
  const input = new Float32Array(x.memory.buffer, x.buf_in(), 128);
  const out = new Float32Array(x.memory.buffer, x.buf_l(), 128);
  const N = Math.round(secs * SR);
  const y = new Float32Array(N);
  for (let o = 0; o < N; o += 128) {
    for (let i = 0; i < 128; i++) input[i] = sig(o + i);
    x.process(128);
    for (let i = 0; i < 128 && o + i < N; i++) y[o + i] = out[i];
  }
  return y;
};
const amp = (y, a, len, hz) => {
  let re = 0, im = 0;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len);
    re += y[a + i] * w * Math.cos((2 * Math.PI * hz * i) / SR);
    im += y[a + i] * w * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return (4 * Math.hypot(re, im)) / len;
};
const db = (v) => 20 * Math.log10(v + 1e-12);
const rms = (y, a, b) => {
  let s = 0;
  for (let i = a; i < b; i++) s += y[i] * y[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const sine = (hz, a) => (i) => a * Math.sin((2 * Math.PI * hz * i) / SR);
const saw = (hz, a) => (i) => {
  let v = 0;
  for (let k = 1; k <= 30; k++) v += Math.sin((2 * Math.PI * hz * k * i) / SR) / k;
  return a * 0.55 * v;
};
// a note that stops dead after 0.15 s
const burst = (i) => (i < 0.15 * SR ? 0.3 * Math.sin((2 * Math.PI * 330 * i) / SR) * Math.min(1, i / 200, (0.15 * SR - i) / 200) : 0);
// every knob that sets "how much effect" turned up, so the effect is plainly on
const wet = (key, more = {}) => {
  const k = {};
  for (const [nm, , lo, hi] of G[key].k || []) if (/^(mix|depth|intensity|level|blend|amount|effect|wet)$/i.test(nm)) k[nm] = hi;
  return { ...k, ...more };
};
const knobHi = (key, re) => Object.fromEntries((G[key].k || []).filter(([nm]) => re.test(nm)).map(([nm, , , hi]) => [nm, hi]));
const names = (cat) => Object.keys(G).filter((k) => (G[k].t === 'pedal' || G[k].t === 'rack') && G[k].c === cat);
// how much the tone moves over time: the level of each of a 110 Hz note's first 12 harmonics in
// 50 ms slices over two seconds; the biggest swing of any of them (dB), ignoring ones too quiet to matter
const movement = (y) => {
  const w = Math.round(0.05 * SR);
  let most = 0;
  for (let k = 1; k <= 12; k++) {
    const v = [];
    for (let a = SR; a + w <= y.length; a += w) v.push(amp(y, a, w, 110 * k));
    const top = Math.max(...v);
    if (top < 1e-4) continue;
    most = Math.max(most, db(top) - db(Math.max(Math.min(...v), top * 1e-3)));
  }
  return most;
};
const thd = (y, hz = 110) => {
  const a = y.length - SR / 2, len = SR / 2;
  const h1 = amp(y, a, len, hz) ** 2;
  let rest = 0;
  for (let k = 2; k <= 20; k++) rest += amp(y, a, len, hz * k) ** 2;
  return 10 * Math.log10(rest / (h1 + 1e-18) + 1e-12);
};
const centroid = (y) => {
  const a = y.length - SR / 2, len = SR / 2;
  let num = 0, den = 0;
  for (let k = 1; k <= 30; k++) {
    const v = amp(y, a, len, 110 * k) ** 2;
    num += v * 110 * k;
    den += v;
  }
  return num / (den + 1e-18);
};
const sane = (key, y) => {
  let fin = true, peak = 0;
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) fin = false;
    peak = Math.max(peak, Math.abs(y[i]));
  }
  ok(fin && peak < 6, `${key}: output is finite and in range (peak ${peak.toFixed(2)})`);
  return fin;
};

// ---- drives, fuzzes, distortions: a clean note comes out with harmonics it didn't have
for (const key of names('Distortion')) {
  const y = render(key, knobHi(key, /^(gain|drive|fuzz|sustain|distortion|dist)$/i), sine(110, 0.3));
  if (!sane(key, y)) continue;
  ok(thd(y) > -32, `${key} (drive): adds harmonics to a clean note (${thd(y).toFixed(1)} dB)`);
}

// ---- delays and echoes: the note comes back after it has stopped
for (const key of names('Delay')) {
  const y = render(key, wet(key, knobHi(key, /^feedback$/i)), burst, 2.2);
  if (!sane(key, y)) continue;
  const note = rms(y, 0, 0.15 * SR), after = rms(y, 0.25 * SR, 2.0 * SR);
  // and it is a repeat, not a wash: somewhere after the note there is a quiet gap before a louder echo
  let peakAt = 0, peakV = 0;
  for (let a = 0.2 * SR; a < 2.0 * SR; a += 480) {
    const v = rms(y, a, a + 480);
    if (v > peakV) (peakV = v), (peakAt = a / SR);
  }
  ok(db(after) - db(note) > -30, `${key} (delay): the note repeats after it stops (${(db(after) - db(note)).toFixed(1)} dB of it, loudest ${(peakAt * 1000).toFixed(0)} ms in)`);
}

// ---- reverbs: a tail that dies away smoothly
for (const key of names('Reverb')) {
  const y = render(key, wet(key), burst, 2.5);
  if (!sane(key, y)) continue;
  const note = rms(y, 0, 0.15 * SR), early = rms(y, 0.2 * SR, 0.5 * SR), late = rms(y, 1.6 * SR, 2.4 * SR);
  ok(db(early) - db(note) > -36 && late < early, `${key} (reverb): leaves a tail (${(db(early) - db(note)).toFixed(1)} dB just after the note) that dies away (${(db(late) - db(note)).toFixed(1)} dB later)`);
}

// ---- modulation and tremolo: the sound moves by itself while you hold a note
for (const key of [...names('Modulation'), ...names('Tremolo')]) {
  const k = wet(key, knobHi(key, /^(depth|intensity|mix|width|range)$/i));
  const y = render(key, k, saw(110, 0.25), 3);
  if (!sane(key, y)) continue;
  if (/RingMod/.test(key)) {
    // a ring modulator adds notes that aren't in the one you play
    const a = y.length - SR, own = Array.from({ length: 12 }, (_, i) => amp(y, a, SR, 110 * (i + 1)) ** 2).reduce((s, v) => s + v, 0);
    const all = rms(y, a, y.length) ** 2 * 2;
    ok(all > own * 1.3, `${key} (ring mod): adds tones that aren't in the note (${(10 * Math.log10(all / (own + 1e-18))).toFixed(1)} dB more than the note's own)`);
    continue;
  }
  if (/TremOle|AutoVibe/.test(key)) {
    const softly = movement(render(key, k, saw(110, 0.004), 3));
    ok(movement(y) > 1 && movement(y) > softly + 1, `${key} (tremolo you play): wobbles when you dig in (${movement(y).toFixed(1)} dB swing) and calms down when you play softly (${softly.toFixed(1)} dB)`);
    continue;
  }
  const mv = movement(y);
  ok(mv > 1, `${key} (${G[key].c.toLowerCase()}): the tone moves over time (${mv.toFixed(1)} dB swing)`);
}

// ---- filters: EQ bands lift their own frequency; wahs sweep up with the pedal; the rest shape the tone
const bandHz = (nm) => {
  const m = /^([\d.]+)\s*(k)?hz$/i.exec(nm.replace(/\s+/g, ''));
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null;
};
for (const key of names('Filter')) {
  const bands = (G[key].k || []).map(([nm, , lo, hi]) => [nm, bandHz(nm), lo, hi]).filter((b) => b[1]);
  if (bands.length >= 3) {
    for (const [nm, hz, lo, hi] of bands) {
      if (hz > 18000 || hz < 25) continue;
      // quietly (so nothing downstream squashes it), the band from all the way down to all the way up:
      // its own frequency against one well away (the engine evens out a tone's overall loudness, so
      // what counts is this band against the others)
      const far = hz < 1000 ? hz * 6 : hz / 6;
      const lvl = (v, f) => { const y = render(key, { [nm]: v }, sine(f, 0.01), 0.8); return db(amp(y, 0.4 * SR, 0.3 * SR, f)); };
      const own = lvl(hi, hz) - lvl(lo, hz), other = lvl(hi, far) - lvl(lo, far);
      ok(own - other > 8, `${key} (EQ): ${nm} from bottom to top moves ${hz} Hz ${(own - other).toFixed(1)} dB more than ${far.toFixed(0)} Hz (slider range ${hi - lo} dB)`);
    }
    continue;
  }
  const ped = (G[key].k || []).find(([nm]) => /^pedal/i.test(nm));
  if (ped && /wah/i.test(key)) {
    const auto = (G[key].k || []).find(([nm]) => /^auto/i.test(nm));
    const base = auto ? { [auto[0]]: auto[2] } : {};
    const lo = centroid(render(key, { ...base, [ped[0]]: ped[2] }, saw(110, 0.25))), hi = centroid(render(key, { ...base, [ped[0]]: ped[3] }, saw(110, 0.25)));
    ok(hi > lo * 1.3, `${key} (wah): rocking the pedal forward sweeps the tone up (${lo.toFixed(0)} → ${hi.toFixed(0)} Hz)`);
    continue;
  }
  if (/RangeBooster/.test(key)) {
    // a treble booster into the amp: more Boost is louder and dirtier, and hit hard it breaks up
    const lo = render(key, { 'Boost!': 1, __amp: 'Amp_TW26' }, sine(110, 0.05)), hi = render(key, { 'Boost!': 100, __amp: 'Amp_TW26' }, sine(110, 0.05));
    const soft = render(key, {}, sine(110, 0.02)), hard = render(key, {}, sine(110, 0.5));
    const more = Math.max(thd(hi) - thd(lo), db(rms(hi, SR, 1.5 * SR)) - db(rms(lo, SR, 1.5 * SR)));
    ok(more > 3 && thd(hard) > thd(soft) + 5, `${key} (booster): Boost up pushes the amp harder (${more.toFixed(1)} dB more harmonics or level) and it breaks up when hit hard (${thd(soft).toFixed(1)} → ${thd(hard).toFixed(1)} dB)`);
    continue;
  }
  // every other filter: with its knobs at one end and then the other, the tone's balance changes
  const lows = {}, highs = {};
  for (const [nm, , lo, hi] of G[key].k || []) (lows[nm] = lo), (highs[nm] = hi);
  const a = render(key, lows, saw(110, 0.25)), b = render(key, highs, saw(110, 0.25)), d = render(key, {}, saw(110, 0.25));
  if (!sane(key, d)) continue;
  const c = [centroid(a), centroid(b), centroid(d)];
  const t = [thd(a), thd(b), thd(d)];
  const spread = Math.max(...c) / Math.min(...c);
  ok(spread > 1.15 || Math.max(...t) - Math.min(...t) > 3, `${key} (filter): its knobs reshape the tone (brightness ×${spread.toFixed(2)}, harmonics ${(Math.max(...t) - Math.min(...t)).toFixed(1)} dB)`);
}

// ---- dynamics: compressors bring loud and quiet closer; the gate closes on hiss
for (const key of names('Dynamics')) {
  if (/NoiseGate/.test(key)) {
    const hiss = render(key, knobHi(key, /^(threshold|gate|sensitivity)$/i), sine(220, 0.0015), 1.5), note = render(key, knobHi(key, /^(threshold|gate|sensitivity)$/i), sine(220, 0.3), 1.5);
    const g1 = db(rms(hiss, SR, 1.5 * SR)) - db(0.0015 / Math.SQRT2), g2 = db(rms(note, SR, 1.5 * SR)) - db(0.3 / Math.SQRT2);
    ok(g2 - g1 > 12, `${key} (gate): shuts on hiss and opens for a note (hiss ${g1.toFixed(1)} dB, note ${g2.toFixed(1)} dB)`);
    continue;
  }
  const k = knobHi(key, /^(compression|comp|sustain|ratio|amount|squash)$/i);
  const quiet = render(key, k, sine(220, 0.02), 1.5), loud = render(key, k, sine(220, 0.5), 1.5);
  if (!sane(key, loud)) continue;
  const range = db(rms(loud, SR, 1.5 * SR)) - db(rms(quiet, SR, 1.5 * SR));
  ok(range < 28 - 3, `${key} (compressor): 28 dB between quiet and loud going in, ${range.toFixed(1)} dB coming out`);
}

// ---- pitch: the added note is there (test/pedals-wasm.cjs checks how exactly and how steadily)
for (const key of names('Pitch')) {
  const y = render(key, wet(key), sine(196, 0.2), 2);
  if (!sane(key, y)) continue;
  const a = y.length - SR, own = amp(y, a, SR, 196);
  let other = 0, at = 0;
  for (const r of [0.25, 0.5, 2, 4, 2 ** (7 / 12), 2 ** (-5 / 12), 2 ** (5 / 12), 2 ** (4 / 12), 2 ** (3 / 12)]) {
    const v = amp(y, a, SR, 196 * r);
    if (v > other) (other = v), (at = 196 * r);
  }
  ok(db(other) > db(Math.max(own, 1e-6)) - 30 && other > 1e-4, `${key} (pitch): adds a note of its own (${at.toFixed(0)} Hz, ${(db(other) - db(own + 1e-12)).toFixed(1)} dB against the note played)`);
}

const pieces = Object.keys(G).filter((k) => G[k].t === 'pedal' || G[k].t === 'rack').length;
if (bad) {
  console.log(`\n${bad} of ${n} checks failed (${pieces} pedals and rack units):`);
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
console.log(`effects behave like their kind: ${n} checks on ${pieces} pedals and rack units passed`);
