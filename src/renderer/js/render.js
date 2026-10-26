/**
 * Runs audio through a tone away from the live rig: the WebAssembly build of
 * the same amp engine, run in a worker. Used for tone demos and
 * for turning recorded takes (the dry guitar) into what you heard.
 */
import { P } from './rig.js';
import { toSpec, loadGear, ampGain } from './gearspec.js';
import { resolveCapture } from './captures.js';

let worker = null;
let seq = 0;
const waiting = new Map();

/**
 * tone: a gear chain; di: Float32Array of the dry guitar (mono); knobs: the
 * rig's knob values (input, volume, gain, bass, mid, treble, fx).
 * Returns { L, R } at the same rate. Runs in a worker, so the page (and the
 * live guitar) never waits for it.
 */
export async function renderTone(tone, di, rate, knobs = {}) {
  await loadGear();
  if (!worker) {
    worker = new Worker(new URL('../workers/render-worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error));
      else w.resolve({ L: e.data.L, R: e.data.R });
    };
  }
  const k = { input: 0.5, volume: 0.7, bass: 0.5, mid: 0.5, treble: 0.5, fx: 0.5, ...knobs };
  const params = ['input', 'volume', 'bass', 'mid', 'treble', 'fx'].map((name) => [P[name], Number(k[name])]);
  params.push([P.gain, k.gain === undefined || k.gain === null ? -1 : Number(k.gain)]);
  params.push([P.room, k.room ?? 0.5]);
  const id = ++seq;
  const copy = new Float32Array(di);
  // the real amp, as the live rig would play it
  let nam = null;
  const cap = resolveCapture(tone);
  if (cap) {
    try {
      const r = await fetch(cap.url);
      if (r.ok) nam = { bytes: new Uint8Array(await r.arrayBuffer()), fullRig: cap.fullRig, gainRef: cap.gainRef };
    } catch (_) {}
  }
  const transfer = [copy.buffer];
  if (nam) transfer.push(nam.bytes.buffer);
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, wasmUrl: new URL('../worklets/rig-dsp.wasm', import.meta.url).href, spec: toSpec(tone), di: copy, rate, params, nam }, transfer);
  });
}

/**
 * Plucked-string synthesis (Karplus–Strong with a fractional delay, pick
 * position and string-dependent damping), as a dry guitar sounds from the cable.
 * o: { amp, mute (palm mute), pick (0–1 along the string), bright (0–1) }
 */
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x3fffffff - 1;
};
function pluck(out, start, hz, dur, rate, o = {}) {
  const amp = o.amp ?? 0.5;
  const mute = !!o.mute;
  const damp = mute ? 0.18 : 0.5; // palm mute darkens the string
  const L = Math.max(2, rate / hz - damp / (1 - damp)); // the loop filter adds damp/(1-damp) samples
  const size = Math.ceil(L) + 2;
  const buf = new Float32Array(size);
  // excitation: noise, softened (pick hardness) and comb-filtered at the pick point
  const bright = o.bright ?? 0.6;
  let lp = 0;
  const ex = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    lp += (0.25 + 0.6 * bright) * (rnd() - lp);
    ex[i] = lp;
  }
  const pp = Math.max(1, Math.round(L * (o.pick ?? 0.18)));
  for (let i = 0; i < size; i++) buf[i] = (ex[i] - (i >= pp ? ex[i - pp] : 0)) * amp;
  const n = Math.min(out.length - start, Math.round(dur * rate));
  if (n <= 0) return;
  // per-period loss so every note rings for a similar time (t60 in seconds)
  const t60 = mute ? 0.09 : Math.max(0.8, 3.2 - hz / 300);
  const g = Math.pow(10, -3 / (t60 * hz));
  let w = 0;
  let y1 = 0;
  for (let i = 0; i < n; i++) {
    // read L samples behind the write head (linear interpolation)
    let r = w - L;
    while (r < 0) r += size;
    const i0 = Math.floor(r);
    const fr = r - i0;
    const a = buf[i0 % size];
    const b = buf[(i0 + 1) % size];
    const x = a + (b - a) * fr;
    const y = g * ((1 - damp) * x + damp * y1);
    y1 = y;
    buf[w] = y;
    w = (w + 1) % size;
    const env = i < 24 ? i / 24 : i > n - 480 ? (n - i) / 480 : 1;
    out[start + i] += x * env;
  }
}

const hzOf = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** How driven a tone is (0 clean – 1 high gain), from the amp's gain and any drive pedals. */
function driveOf(tone) {
  if (!tone) return 0.5;
  let d = typeof tone.gain === 'number' ? tone.gain : 0.5;
  try {
    d = ampGain(tone);
  } catch (_) {}
  for (const g of tone.gear || []) if (/drive|distort|fuzz|buzz|metal|boost|screamer|od\b/i.test(g.key || '')) d += 0.25;
  return Math.max(0, Math.min(1, d));
}

/**
 * A short demo riff that suits the tone: clean tones get ringing arpeggios,
 * crunchy ones a rock riff, high gain a tight palm-muted gallop, bass a groove.
 * About 6–7 seconds.
 */
export function demoRiff(rate, kind = 'guitar', tone = null) {
  seed = 12345;
  const out = new Float32Array(Math.round(rate * 7));
  const at = (s) => Math.round(s * rate);
  const note = (t, m, len, o) => pluck(out, at(t), hzOf(m), len, rate, o);
  // strum a voicing (low string first); up strums go high to low
  const strum = (t, notes, len, o = {}, up = false) => {
    const list = up ? [...notes].reverse() : notes;
    list.forEach((m, i) => note(t + i * (o.spread ?? 0.009), m, len, { ...o, amp: (o.amp ?? 0.3) * (up && i > 2 ? 0.7 : 1) }));
  };
  if (kind === 'bass') {
    // a fingerstyle groove in E: root, octave, a walk up to A and back
    const b = 0.3; // 100 BPM eighths
    const line = [[28, 1], [28, 0.5], [40, 1], [28, 1], [38, 1], [40, 1], [31, 1], [33, 1], [33, 1], [33, 0.5], [45, 1], [33, 1], [31, 1], [33, 1], [35, 1], [36, 1]];
    let t = 0.05;
    for (const [m, v] of line) {
      note(t, m, b * (v < 1 ? 0.35 : 1.05), { amp: 0.55 * v + 0.1, pick: 0.25, bright: 0.35, mute: v < 1 });
      t += b;
    }
    note(t, 28, 1.6, { amp: 0.6, pick: 0.25, bright: 0.35 });
    return out;
  }
  const drive = driveOf(tone);
  if (drive < 0.34) {
    // clean: Em9 – Cmaj7 – G – D/F# picked arpeggios, then a strummed Em
    const e = 0.19;
    let t = 0.05;
    const shapes = [
      [40, 47, 54, 55, 59, 66],
      [48, 52, 55, 59, 64],
      [43, 47, 50, 55, 59, 67],
      [42, 50, 57, 62, 66],
    ];
    for (const sh of shapes) {
      const order = [0, 2, 3, 4, 3, 2].map((k) => sh[Math.min(k, sh.length - 1)]);
      order[3] = sh[sh.length - 1];
      for (const m of order) {
        note(t, m, 1.6, { amp: 0.32, pick: 0.2, bright: 0.55 });
        t += e;
      }
    }
    strum(t, [40, 47, 52, 55, 59, 64], 2.2, { amp: 0.26, spread: 0.014, bright: 0.5 });
    return out;
  }
  if (drive < 0.67) {
    // crunch: an A rock riff with open-string drive, chord stabs and a blues lick
    const b = 0.27; // ~110 BPM eighths
    let t = 0.05;
    const A5 = [45, 52, 57];
    const D5 = [50, 57, 62];
    const G5 = [43, 50, 55];
    const bar = () => {
      strum(t, A5, b * 1.8, { amp: 0.3 });
      t += b * 1.5;
      note(t, 45, b * 0.5, { amp: 0.3, mute: true });
      t += b * 0.5;
      strum(t, D5, b * 0.9, { amp: 0.28 });
      t += b;
      strum(t, A5, b * 0.9, { amp: 0.28 }, true);
      t += b;
    };
    bar();
    strum(t, G5, b * 0.9, { amp: 0.28 });
    t += b;
    strum(t, D5, b * 1.9, { amp: 0.3 });
    t += b * 2;
    bar();
    for (const [m, l] of [[69, 1], [67, 0.5], [64, 0.5], [62, 1], [64, 1], [60, 0.5], [57, 1.5]]) {
      note(t, m, b * l * 1.1, { amp: 0.36, bright: 0.65 });
      t += b * l;
    }
    strum(t, A5, 1.8, { amp: 0.3 });
    return out;
  }
  // high gain: palm-muted E gallops, accented stabs, a chromatic climb
  const s16 = 0.125; // 120 BPM sixteenths
  let t = 0.05;
  const E5 = [40, 47, 52];
  const pm = (n) => {
    note(t, 40, s16 * 1.4, { amp: 0.42, mute: true, pick: 0.12, bright: 0.8 });
    note(t + 0.004, 47, s16 * 1.4, { amp: 0.25, mute: true, pick: 0.12, bright: 0.8 });
    t += s16 * n;
  };
  const stab = (root, len) => {
    strum(t, [root, root + 7, root + 12], len, { amp: 0.3, spread: 0.006, bright: 0.8, pick: 0.12 });
    t += len;
  };
  for (let r = 0; r < 2; r++) {
    pm(2);
    pm(1);
    pm(1);
    pm(2);
    pm(1);
    pm(1);
    stab(41, s16 * 2);
    stab(43, s16 * 2);
    pm(1);
    pm(1);
    stab(r ? 46 : 45, s16 * 2);
  }
  for (const m of [40, 41, 42, 43]) {
    pm(1);
    pm(1);
    stab(m + 5, s16 * 2);
  }
  strum(t, E5, 1.8, { amp: 0.32, spread: 0.008, bright: 0.8, pick: 0.12 });
  return out;
}
