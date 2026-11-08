// Offline tone lab for tests: plays a synthesised DI guitar (Karplus-Strong riff, lead line,
// chord, pickup hum and hiss) through the WebAssembly sound engine and measures the result.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SH_ROOT = ROOT;
const gs = await import(pathToFileURL(path.join(ROOT, 'src/renderer/js/gearspec.js')).href);
gs.setGear(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/data/gear2014.json'), 'utf8')));
export const { toSpec } = gs;
const SR = 48000;

export function engine(wasmPath = process.env.SH_WASM || path.join(ROOT, 'src/renderer/worklets/rig-dsp.wasm')) {
  const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(wasmPath)), {}).exports;
  const need = x.mem_needed();
  if (need > x.memory.buffer.byteLength) x.memory.grow(Math.ceil((need - x.memory.buffer.byteLength) / 65536));
  if (!x.init(SR)) throw new Error('init');
  x.param(0, 0.5); // input 0 dB
  x.param(1, 0.7); // unity
  x.param(10, 0); // no room
  let slot = 0;
  return {
    x,
    build(tone, ir) {
      slot = (slot + 1) % 8;
      if (ir) {
        new Float32Array(x.memory.buffer, x.buf_ir(), 8192).set(ir.subarray(0, 8192));
        x.set_ir(slot, Math.min(8192, ir.length));
      } else x.set_ir(slot, 0);
      const bytes = new TextEncoder().encode(typeof tone === 'string' ? tone : toSpec(tone));
      const mem = new Uint8Array(x.memory.buffer, x.buf_spec(), 16384);
      mem.set(bytes.subarray(0, 16383));
      mem[Math.min(bytes.length, 16383)] = 0;
      if (!x.build(slot)) throw new Error('build failed');
      x.select(slot);
      // settle the crossfade
      const z = new Float32Array(48000 * 0.2);
      this.run(z);
      return slot;
    },
    run(input) {
      const out = new Float32Array(input.length);
      const N = 128;
      for (let o = 0; o < input.length; o += N) {
        const n = Math.min(N, input.length - o);
        const inb = new Float32Array(x.memory.buffer, x.buf_in(), N);
        inb.fill(0);
        inb.set(input.subarray(o, o + n));
        x.process(n);
        const L = new Float32Array(x.memory.buffer, x.buf_l(), N);
        const R = new Float32Array(x.memory.buffer, x.buf_r(), N);
        for (let i = 0; i < n; i++) out[o + i] = 0.5 * (L[i] + R[i]);
      }
      return out;
    },
  };
}

// --------------------------------------------------------- the cab files --
export function cabIR(id) {
  const b = fs.readFileSync(path.join(ROOT, 'src/renderer/data/cabs', `${id}.wav`));
  let p = 12, fmt = null, data = null;
  while (p < b.length - 8) {
    const idc = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (idc === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (idc === 'data') data = b.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  const bps = fmt.bits / 8, n = Math.floor(data.length / bps / fmt.ch);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * fmt.ch * bps;
    mono[i] = fmt.tag === 3 ? data.readFloatLE(o) : data.readInt16LE(o) / 32768;
  }
  // resample to 48k (linear) like decodeAudioData would
  const m = Math.floor((n * SR) / fmt.rate), out = new Float32Array(Math.min(8192, m));
  for (let i = 0; i < out.length; i++) {
    const t = (i * fmt.rate) / SR, k = Math.floor(t), f = t - k;
    out[i] = (mono[k] || 0) * (1 - f) + (mono[k + 1] || 0) * f;
  }
  let e = 0;
  for (const v of out) e += v * v;
  const g = e > 0 ? 0.35 / Math.sqrt(e) : 1;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return out;
}

// ------------------------------------------------------------ the guitar --
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}
/** Karplus-Strong string into buf at t0 for dur seconds. */
function pluck(buf, hz, t0, dur, amp, { decay = 0.996, mute = 0, seed = 1, bright = 0.5 } = {}) {
  const r = rng(seed);
  const len = Math.max(2, Math.round(SR / hz));
  const d = new Float32Array(len);
  let lp = 0;
  for (let i = 0; i < len; i++) d[i] = (lp += bright * (r() - lp));
  let p = 0;
  const s0 = Math.round(t0 * SR), n = Math.round(dur * SR);
  const fb = mute ? 0.5 - 0.5 * mute * 0.06 : 0.5 * decay - 0 + 0.5 * (1 - decay) * 0 ;
  let pk = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const q = p + 1 === len ? 0 : p + 1;
    const v = d[p];
    d[p] = (mute ? 0.5 - mute * 0.012 : 0.5 * decay) * (v + d[q]) * (mute ? 1 : 1);
    p = q;
    // release: a short fade at the end (fingers muting)
    const rel = i > n - 480 ? (n - i) / 480 : 1;
    pk = v * amp * rel;
    buf[s0 + i] += pk;
  }
}
/** A pickup: gentle resonance ~ 3 kHz then roll-off; output scaled to hit `peak`. */
function pickup(buf) {
  // 2-pole low-pass at 4.5 kHz with a little resonance
  const f = 4500 / SR, q = 1.2;
  const w = 2 * Math.PI * f, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1, x1 = x, y2 = y1, y1 = y;
    buf[i] = y;
  }
}
export function norm(buf, peakDb) {
  let pk = 0;
  for (const v of buf) pk = Math.max(pk, Math.abs(v));
  const g = Math.pow(10, peakDb / 20) / (pk || 1);
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}
/** Pickup hum and hiss, RMS in dBFS. */
export function noise(n, rmsDb, seed = 9) {
  const r = rng(seed);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const hum = Math.sin(2 * Math.PI * 60 * t) + 0.5 * Math.sin(2 * Math.PI * 180 * t + 1) + 0.3 * Math.sin(2 * Math.PI * 300 * t + 2) + 0.2 * Math.sin(2 * Math.PI * 540 * t);
    lp += 0.6 * (r() - lp);
    out[i] = hum * 0.5 + lp * 1.2;
  }
  let e = 0;
  for (const v of out) e += v * v;
  const g = Math.pow(10, rmsDb / 20) / Math.sqrt(e / n);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

const E2 = 82.41, A2 = 110, B2 = 123.47, E3 = 164.81, G3 = 196, B3 = 246.94, D4 = 293.66, E4 = 329.63, B4 = 493.88, E5 = 659.25;
/** Phrases (each normalised so the hardest strum peaks at `peak` dBFS), with their time windows. */
export function phrases(peak = -6) {
  const riff = new Float32Array(SR * 3);
  // 16 palm-muted chugs on the low E, 8ths at 180 bpm, then an E5 power chord ringing
  const eighth = 60 / 180 / 2;
  for (let i = 0; i < 12; i++) pluck(riff, E2, i * eighth, eighth * 0.95, 1, { mute: 1, seed: 10 + i, bright: 0.7 });
  for (const [hz, k] of [[E2, 0], [B2, 1], [E3, 2]]) pluck(riff, hz, 12 * eighth + k * 0.006, 1.6, 0.8, { decay: 0.9985, seed: 40 + k, bright: 0.8 });
  pickup(riff);
  norm(riff, peak);
  const lead = new Float32Array(SR * 3.2);
  // a picked single note that rings (sustain), then a quick run
  pluck(lead, B4, 0, 2.4, 1, { decay: 0.9993, seed: 77, bright: 0.6 });
  for (let i = 0; i < 6; i++) pluck(lead, [E5, D4 * 2, B4, G3 * 2, B4, E5][i], 2.45 + i * 0.12, 0.12, 0.8, { decay: 0.998, seed: 90 + i });
  pickup(lead);
  norm(lead, peak - 4); // single notes are a little quieter than a strum
  const chord = new Float32Array(SR * 2.5);
  for (const [hz, k] of [[E2, 0], [B2, 1], [E3, 2], [G3, 3], [B3, 4], [E4, 5]]) pluck(chord, hz, k * 0.012, 2.4, 0.7, { decay: 0.9988, seed: 60 + k });
  pickup(chord);
  norm(chord, peak);
  return { riff, lead, chord };
}

// ------------------------------------------------------------- analysis --
function biquadBP(hz, q) {
  const w = (2 * Math.PI * hz) / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1, x1 = x, y2 = y1, y1 = y;
    return y;
  };
}
export const BANDS = [['low', 120], ['lowmid', 350], ['mid', 800], ['upper', 2000], ['pres', 4000], ['fizz', 8000]];
export function bands(sig, from = 0, to = sig.length) {
  const out = {};
  let tot = 0;
  for (const [name, hz] of BANDS) {
    const f1 = biquadBP(hz, 1.0), f2 = biquadBP(hz, 1.0);
    let e = 0;
    for (let i = 0; i < to; i++) {
      const y = f2(f1(sig[i]));
      if (i >= from) e += y * y;
    }
    out[name] = e;
    tot += e;
  }
  for (const k in out) out[k] = 10 * Math.log10(out[k] / tot + 1e-20);
  return out;
}
export function rmsDb(sig, from = 0, to = sig.length) {
  let e = 0;
  for (let i = from; i < to; i++) e += sig[i] * sig[i];
  return 10 * Math.log10(e / Math.max(1, to - from) + 1e-20);
}
/** Envelope in 10 ms frames (dB). */
export function env(sig) {
  const f = SR / 100, out = [];
  for (let o = 0; o + f <= sig.length; o += f) out.push(rmsDb(sig, o, o + f));
  return out;
}
/** Seconds the envelope stays within `drop` dB of its peak (after the peak). */
export function sustain(sig, drop = 20, from = 0, to = sig.length) {
  const e = env(sig.subarray(from, to));
  let pk = -200, at = 0;
  e.forEach((v, i) => v > pk && ((pk = v), (at = i)));
  let i = at;
  while (i < e.length && e[i] > pk - drop) i++;
  return (i - at) / 100;
}

/** Everything about one tone. */
export function measure(eng, tone, { ir = null, peak = -6, noiseDb = -66 } = {}) {
  const P = phrases(peak);
  eng.build(tone, ir);
  const r = eng.run(P.riff), l = eng.run(P.lead), c = eng.run(P.chord);
  // soft playing: the same chord 18 dB quieter (how much the amp evens out your picking)
  const soft = P.chord.map((v) => v * 0.125);
  const cs = eng.run(soft);
  const nz = noise(SR * 1.5, noiseDb);
  const no = eng.run(nz);
  // the note dying out into noise (does the gate chop the tail?)
  const tail = new Float32Array(SR * 4);
  pluck(tail, B3, 0, 4, 1, { decay: 0.9993, seed: 5 });
  pickup(tail);
  norm(tail, peak - 4);
  const tn = noise(tail.length, noiseDb, 3);
  for (let i = 0; i < tail.length; i++) tail[i] += tn[i];
  const to = eng.run(tail);
  const level = rmsDb(c, SR * 0.1, SR * 1.0);
  const b = bands(r, 0, SR * 2.2);
  const bc = bands(c, SR * 0.05, SR * 1.5);
  return {
    level: +level.toFixed(1),
    // dB: chord at -18 dB comes out this much quieter (18 = clean, small = saturated)
    softDrop: +(level - rmsDb(cs, SR * 0.1, SR * 1.0)).toFixed(1),
    sustainLead: +sustain(l, 20, 0, SR * 2.4).toFixed(2),
    sustainChord: +sustain(c, 20).toFixed(2),
    noise: +(rmsDb(no, SR * 0.5, SR * 1.5) - level).toFixed(1), // between notes, relative to playing
    tail: +sustain(to, 40).toFixed(2), // how long the dying note is heard (to -40 dB)
    tailNoise: +(rmsDb(to, SR * 3.5, SR * 4) - level).toFixed(1),
    riff: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, +v.toFixed(1)])),
    scoop: +(bc.mid - (bc.low + bc.upper) / 2).toFixed(1),
    bright: +((bc.pres + bc.fizz) / 2 - bc.mid).toFixed(1),
  };
}

export const G = (slot, key, knobs = {}, order = 0) => ({ slot, key, knobs, order });
