/* Auto-tune: a made-up voice in, the tuned voice out. `node --no-warnings test/autotune.test.mjs` */
import assert from 'node:assert';
import { AutoTune } from '../src/renderer/worklets/autotune-worklet.js';
import { detectPitch } from '../src/renderer/js/pitch.js';

const sr = 48000;
let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

/** A voice: a buzz through three mouth resonances, with a little breath. midiAt(t) is the note sung. */
function voice(midiAt, secs, { amp = 0.2, from = 0 } = {}) {
  const n = Math.round(secs * sr);
  const out = new Float32Array(n);
  let ph = 0;
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2;
  const mk = (f, bw) => {
    const r = Math.exp((-Math.PI * bw) / sr);
    return { c: 2 * r * Math.cos((2 * Math.PI * f) / sr), r2: r * r, y1: 0, y2: 0 };
  };
  const F = [mk(700, 110), mk(1200, 130), mk(2600, 200)];
  for (let i = Math.round(from * sr); i < n; i++) {
    ph += (440 * 2 ** ((midiAt(i / sr) - 69) / 12)) / sr;
    let src = rnd() * 0.01;
    if (ph >= 1) {
      ph -= 1;
      src += 1;
    }
    let s = 0;
    for (const f of F) {
      const y = src + f.c * f.y1 - f.r2 * f.y2;
      f.y2 = f.y1;
      f.y1 = y;
      s += y;
    }
    out[i] = s * amp * 0.25 + rnd() * 0.002;
  }
  return out;
}
function tune(inp, set, prep) {
  const at = new AutoTune(sr);
  at.set(set);
  if (prep) prep(at);
  const out = new Float32Array(inp.length);
  for (let i = 0; i + 128 <= inp.length; i += 128) at.process(inp.subarray(i, i + 128), out.subarray(i, i + 128));
  return out;
}
/** The notes heard in buf between two times (midi, with fractions). */
function notes(buf, from, to, step = 0.02) {
  const r = [];
  for (let t = from; t < to; t += step) {
    const i = Math.round(t * sr);
    const p = detectPitch(buf.subarray(i, i + 2048), sr, { minHz: 70, maxHz: 1100 });
    if (p && p.clarity > 0.5) r.push(69 + 12 * Math.log2(p.hz / 440));
  }
  return r;
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const spread = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
const rms = (b, f, t) => Math.sqrt(mean(Array.from(b.subarray(Math.round(f * sr), Math.round(t * sr)), (v) => v * v)));
const wobbly = (base) => (t) => base + 0.3 + 0.15 * Math.sin(2 * Math.PI * 5.5 * t); // 30 cents sharp, with vibrato

test('Robot: a sharp, wobbly voice comes out dead on the note, low to high', () => {
  for (const base of [41, 48, 57, 64, 69, 76]) {
    const p = notes(tune(voice(wobbly(base), 2), { style: 'robot' }), 0.5, 1.9);
    assert.ok(p.length > 60, `a clear note at ${base}`);
    assert.ok(Math.abs(mean(p) - base) < 0.03, `on the note at ${base}: ${mean(p)}`);
    assert.ok(spread(p) < 0.06, `no wobble left at ${base}: ${spread(p)}`);
  }
});

test('Natural: the note is right, the vibrato stays', () => {
  const p = notes(tune(voice(wobbly(60), 2), { style: 'natural' }), 0.5, 1.9);
  assert.ok(Math.abs(mean(p) - 60) < 0.04, `on the note: ${mean(p)}`);
  assert.ok(spread(p) > 0.07, `vibrato kept: ${spread(p)}`);
});

test('Pop sits between the two', () => {
  const v = voice(wobbly(60), 2);
  const [r, p, n] = ['robot', 'pop', 'natural'].map((style) => spread(notes(tune(v, { style }), 0.5, 1.9)));
  assert.ok(r < p && p <= n + 0.01, `${r} < ${p} <= ${n}`);
});

test('Robot: a slide between notes comes out as steps', () => {
  const out = tune(voice((t) => 57 + Math.min(5, Math.max(0, (t - 0.5) * 2.5)), 3.2), { style: 'robot' });
  const p = notes(out, 0.3, 3);
  const onNote = p.filter((x) => Math.abs(x - Math.round(x)) < 0.06).length;
  assert.ok(onNote / p.length > 0.9, `${onNote} of ${p.length} on a note`);
  assert.deepStrictEqual([...new Set(p.map(Math.round))].sort(), [57, 58, 59, 60, 61, 62]);
});

test('The voice keeps its loudness and character when it is already on the note', () => {
  for (const m of [45, 57, 69]) {
    const inp = voice(() => m, 1.5);
    const out = tune(inp, { style: 'robot' });
    const a = rms(inp, 0.6, 1.4);
    const b = rms(out, 0.6, 1.4);
    assert.ok(b > a * 0.85 && b < a * 1.1, `loudness at ${m}: ${a} → ${b}`);
    // the same wave, a little later
    let best = 0;
    const from = 36000;
    const n = 4800;
    let ei = 0;
    for (let i = 0; i < n; i++) ei += inp[from + i] ** 2;
    for (let l = 0; l < 2400; l++) {
      let c = 0;
      let eo = 0;
      for (let i = 0; i < n; i++) {
        c += inp[from + i] * out[from + i + l];
        eo += out[from + i + l] ** 2;
      }
      best = Math.max(best, c / Math.sqrt(ei * eo));
    }
    assert.ok(best > 0.9, `the same voice at ${m}: ${best}`);
  }
});

test('A new note is heard within 30 ms', () => {
  const inp = voice(() => 60, 1.5, { from: 0.8 });
  const out = tune(inp, { style: 'robot' });
  const peak = Math.max(...out.map(Math.abs));
  const first = (b) => b.findIndex((v, i) => i > 0.7 * sr && Math.abs(v) > peak * 0.2);
  const ms = ((first(out) - first(inp)) / sr) * 1000;
  assert.ok(ms >= 0 && ms < 30, `${ms} ms`);
});

test('Breath and "sss" pass through; silence and a quiet room stay silent', () => {
  let s = 7;
  const noise = (amp) => Float32Array.from({ length: sr * 1.5 }, () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * amp);
  const loud = noise(0.2);
  const out = tune(loud, {});
  assert.ok(Math.abs(rms(out, 0.5, 1.4) / rms(loud, 0.5, 1.4) - 1) < 0.05, 'sss kept');
  assert.strictEqual(rms(tune(new Float32Array(sr), {}), 0, 0.99), 0);
  assert.ok(rms(tune(noise(0.006), {}), 0.3, 1.4) < 1e-5, 'the room is not played back');
});

test('The song’s notes: a singer three notes off lands on the song’s note, in their own octave', () => {
  const song = [
    { t: 0, d: 1, p: 72 },
    { t: 1, d: 1, p: 74 },
  ];
  const out = tune(voice(() => 57, 2), { style: 'pop', mode: 'song' }, (at) => {
    at.setSong(song);
    at.setClock(0, 1);
  });
  assert.ok(Math.abs(mean(notes(out, 0.3, 0.9)) - 60) < 0.05);
  assert.ok(Math.abs(mean(notes(out, 1.3, 1.9)) - 62) < 0.05);
});

test('Between the song’s notes, and with the song stopped, the song’s scale is used', () => {
  // the song uses C D E F G A B; a voice on C sharp (61.2) goes to a note of the scale, not to 61
  const song = [60, 62, 64, 65, 67, 69, 71, 72].map((p, i) => ({ t: 10 + i, d: 0.8, p }));
  const out = tune(voice(() => 61.2, 1.5), { style: 'robot', mode: 'song' }, (at) => at.setSong(song));
  const m = mean(notes(out, 0.5, 1.4));
  assert.ok(Math.abs(m - 62) < 0.05, `${m}`);
  // the nearest note, song or not, when asked for
  const near = mean(notes(tune(voice(() => 61.2, 1.5), { style: 'robot', mode: 'near' }, (at) => at.setSong(song)), 0.5, 1.4));
  assert.ok(Math.abs(near - 62) < 0.05 || Math.abs(near - 61) < 0.05);
});

test('A recording a little off concert pitch keeps its own notes', () => {
  const song = [60.3, 62.3, 64.3, 65.3, 67.3, 69.3, 71.3].map((p, i) => ({ t: i, d: 0.9, p }));
  const out = tune(voice(() => 60, 0.9), { style: 'robot', mode: 'song' }, (at) => {
    at.setSong(song);
    at.setClock(0, 1);
  });
  assert.ok(Math.abs(mean(notes(out, 0.4, 0.8)) - 60.3) < 0.05);
});

test('Volume, and never louder than the speakers can take', () => {
  const inp = voice(() => 60, 1, { amp: 3 });
  const out = tune(inp, { vol: 1.5 });
  assert.ok(Math.max(...out.map(Math.abs)) < 0.99);
  assert.strictEqual(rms(tune(voice(() => 60, 1), { vol: 0 }), 0.2, 0.9), 0);
});

test('Other sound rates work (44.1 kHz microphones)', () => {
  const at = new AutoTune(44100);
  at.set({ style: 'robot' });
  const n = 44100 * 1.5;
  const inp = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (440 * 2 ** (0.3 / 12)) / 44100;
    ph -= Math.floor(ph);
    inp[i] = (ph < 0.2 ? 1 - ph * 5 : 0) * 0.3 - 0.03;
  }
  const out = new Float32Array(n);
  for (let i = 0; i + 128 <= n; i += 128) at.process(inp.subarray(i, i + 128), out.subarray(i, i + 128));
  const p = [];
  for (let t = 0.5; t < 1.4; t += 0.02) {
    const r = detectPitch(out.subarray(Math.round(t * 44100), Math.round(t * 44100) + 2048), 44100, { minHz: 70, maxHz: 1100 });
    if (r) p.push(69 + 12 * Math.log2(r.hz / 440));
  }
  assert.ok(Math.abs(mean(p) - 69) < 0.03, `${mean(p)}`);
});

/** Where the weight of a voice singing A (220 Hz) sits, in Hz: lower for a darker voice, higher for a brighter one. */
function brightness(buf, from, to) {
  let num = 0;
  let den = 0;
  const a = Math.round(from * sr);
  const n = Math.round((to - from) * sr);
  for (let hz = 220; hz <= 5000; hz += 220) {
    let c = 0;
    let q = 0;
    for (let i = 0; i < n; i += 2) {
      c += buf[a + i] * Math.cos((2 * Math.PI * hz * i) / sr);
      q += buf[a + i] * Math.sin((2 * Math.PI * hz * i) / sr);
    }
    const e = c * c + q * q;
    num += e * hz;
    den += e;
  }
  return num / den;
}

test('Voice changer: Giant sings an octave down, Chipmunk an octave up, both still on the note', () => {
  const v = voice(wobbly(57), 2);
  const g = notes(tune(v, { style: 'robot', voice: 'giant' }), 0.5, 1.9);
  const c = notes(tune(v, { style: 'robot', voice: 'chipmunk' }), 0.5, 1.9);
  assert.ok(g.length > 60 && Math.abs(mean(g) - 45) < 0.04, `giant: ${mean(g)}`);
  assert.ok(c.length > 60 && Math.abs(mean(c) - 69) < 0.04, `chipmunk: ${mean(c)}`);
});

test('Voice changer: Deep is darker and High is brighter, on the same note', () => {
  const v = voice(() => 57, 2);
  const plain = tune(v, { style: 'robot' });
  const deep = tune(v, { style: 'robot', voice: 'deep' });
  const high = tune(v, { style: 'robot', voice: 'high' });
  for (const o of [deep, high]) assert.ok(Math.abs(mean(notes(o, 0.5, 1.9)) - 57) < 0.04);
  const [bp, bd, bh] = [plain, deep, high].map((o) => brightness(o, 0.8, 1.3));
  assert.ok(bd < bp * 0.9 && bh > bp * 1.1, `${bd} < ${bp} < ${bh}`);
  for (const o of [deep, high]) assert.ok(rms(o, 0.6, 1.8) > rms(plain, 0.6, 1.8) * 0.6 && rms(o, 0.6, 1.8) < rms(plain, 0.6, 1.8) * 1.6);
});

test('Voice changer without auto-tune: the voice changes, the notes sung are left as they are', () => {
  const v = voice(wobbly(57), 2);
  const p = notes(tune(v, { style: 'off', voice: 'giant' }), 0.5, 1.9);
  assert.ok(Math.abs(mean(p) - 45.3) < 0.04 && spread(p) > 0.07, `${mean(p)} ± ${spread(p)}`);
  const same = notes(tune(v, { style: 'off', voice: 'normal' }), 0.5, 1.9);
  assert.ok(Math.abs(mean(same) - 57.3) < 0.03);
});

test('Voice changer: breath and "sss" keep their loudness', () => {
  let s = 7;
  const n = Float32Array.from({ length: sr * 1.5 }, () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.2);
  for (const vc of ['deep', 'giant', 'high', 'chipmunk']) {
    const r = rms(tune(n, { voice: vc }), 0.5, 1.4) / rms(n, 0.5, 1.4);
    assert.ok(r > 0.6 && r < 1.3, `${vc}: ${r}`);
  }
});

console.log(`autotune: ${passed} passed`);
