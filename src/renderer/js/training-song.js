/**
 * The timing check's own song (4.2). User: "it needs to be its own psarc-like
 * style, actual notes on a highway, the exact same as a regular song… a fake
 * training song that's simple, just a few spaced-out notes on the top 3
 * strings. Needs realistic audio as well."
 *
 * About 28 seconds at 92 bpm: a bar of drumsticks counts you in, then G, Em,
 * C, D twice and home to G. You play single notes, one every beat or two, on
 * the top three strings on the highway (red, yellow and blue: low E, A and D,
 * on guitar and bass), open or the first few frets. In a lowered string (Drop D)
 * the fret moves up so the note stays in key with the band.
 *
 * trainingChart() gives the part in the same shape the highway gets from a
 * real song (tabs.js / sng.js toTab), in the player's own tuning, so it plays
 * on the real highway with the real scoring. trainingAudio() plays the backing
 * here, in plain JS (plucked strings with a guitar body, a bass, a small drum
 * kit and a room), as a WAV for the song player: the same sound path, and the
 * same delay, as any song. No vocals, no stems.
 */
import { tuningName } from './tuning.js';

export const TRAINING_BPM = 92;
export const TRAINING_SONG = { id: '__timing-check', title: 'Timing check', artist: 'Stagehand warm-up' };

const BEAT = 60 / TRAINING_BPM;
const START = 1.0; // the count-in starts here
const at = (bar, beat) => START + (bar * 4 + beat - 1) * BEAT; // bar 0 is the count-in
const LAST = at(9, 1);
const LENGTH = Math.ceil((LAST + 4 * BEAT + 1.2) * 10) / 10; // the last chord rings out

// [bar, beat, string, fret, beats it lasts]. Strings count from the lowest (0).
// 4.2 (user): "top 3 strings. Red Yellow Blue": low E, A and D on both guitar and bass.
const GUITAR = [
  [1, 1, 0, 3, 1], [1, 2, 1, 2, 1], [1, 3, 2, 0, 2],
  [2, 1, 2, 2, 2], [2, 3, 1, 2, 2],
  [3, 1, 1, 3, 1], [3, 2, 2, 2, 1], [3, 3, 0, 3, 2],
  [4, 1, 2, 0, 2], [4, 3, 1, 0, 2],
  [5, 1, 0, 3, 1], [5, 2, 1, 2, 1], [5, 3, 2, 0, 2],
  [6, 1, 0, 0, 2], [6, 3, 0, 3, 2],
  [7, 1, 1, 3, 1], [7, 2, 2, 2, 1], [7, 3, 0, 3, 2],
  [8, 1, 0, 2, 2], [8, 3, 1, 0, 2],
  [9, 1, 0, 3, 4],
];
const BASS = [
  [1, 1, 0, 3, 2], [1, 3, 2, 0, 2],
  [2, 1, 0, 0, 2], [2, 3, 1, 2, 2],
  [3, 1, 1, 3, 2], [3, 3, 0, 3, 2],
  [4, 1, 2, 0, 2], [4, 3, 1, 0, 2],
  [5, 1, 0, 3, 2], [5, 3, 2, 0, 1], [5, 4, 1, 2, 1],
  [6, 1, 0, 0, 2], [6, 3, 2, 2, 2],
  [7, 1, 1, 3, 2], [7, 3, 2, 2, 1], [7, 4, 0, 3, 1],
  [8, 1, 2, 0, 2], [8, 3, 0, 2, 1], [8, 4, 1, 0, 1],
  [9, 1, 0, 3, 4],
];
const CHORDS = [null, 'G', 'Em', 'C', 'D', 'G', 'Em', 'C', 'D', 'G'];
// open chord shapes, E Standard, low to high
const VOICING = { G: [43, 47, 50, 55, 59, 67], Em: [40, 47, 52, 55, 59, 64], C: [48, 52, 55, 60, 64], D: [50, 57, 62, 66] };
const OPEN = { guitar: [40, 45, 50, 55, 59, 64], bass: [28, 33, 38, 43] };

/**
 * The part to play, shaped like a real song's tab.
 * @param {'guitar'|'bass'} kind
 * @param {number[]} tuning your instrument's tuning (offsets from standard per string)
 * @param {number} cents your reference pitch off A440
 */
export function trainingChart(kind = 'guitar', tuning = [], cents = 0) {
  const bass = kind === 'bass';
  const n = bass ? 4 : 6;
  const tun = Array.from({ length: 6 }, (_, i) => (i < n ? Math.round(Number(tuning[i]) || 0) : 0));
  // the band follows the G string; a string tuned differently from it gets the fret that keeps the note in key
  const fretFor = (s, f) => {
    const g = f + (tun[3] - tun[s]);
    return g >= 0 && g <= 7 ? g : f;
  };
  const notes = (bass ? BASS : GUITAR).map(([bar, beat, s, f, len]) => ({ t: r3(at(bar, beat)), s, f: fretFor(s, f), sus: len >= 2 ? r3((len - 0.5) * BEAT) : 0 }));
  const beats = [];
  for (let i = 0; START + i * BEAT < LENGTH - 0.01; i++) beats.push({ t: r3(START + i * BEAT), m: i % 4 === 0 ? i / 4 : -1 });
  return {
    id: 'training',
    name: bass ? 'Bass' : 'Lead',
    type: bass ? 'bass' : 'lead',
    strings: n,
    tuning: tun,
    capo: 0,
    cents: Math.round(Number(cents) || 0),
    tuningName: tuningName(tun.slice(0, n), kind),
    length: LENGTH,
    beats,
    sections: [
      { name: 'intro', n: 1, start: r3(START), end: r3(at(1, 1)) },
      { name: 'verse', n: 1, start: r3(at(1, 1)), end: r3(at(5, 1)) },
      { name: 'chorus', n: 1, start: r3(at(5, 1)), end: r3(at(9, 1)) },
      { name: 'outro', n: 1, start: r3(at(9, 1)), end: LENGTH },
    ],
    chords: [],
    notes,
    chordEvents: [],
    anchors: [{ t: 0, end: LENGTH, fret: 1, width: 4 }],
    handShapes: [],
    events: [],
    lyrics: [],
    songTones: null,
    training: true,
  };
}

/** When each note is due (song seconds). */
export function trainingTimes(tab) {
  return tab.notes.map((n) => n.t);
}

// ---------------------------------------------------------------- sound --
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
function r3(x) {
  return Math.round(x * 1000) / 1000;
}
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One RBJ biquad over a whole buffer, in place. */
function biquad(x, sr, type, f, q = 0.707, db = 0) {
  const w = (2 * Math.PI * f) / sr;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const A = Math.pow(10, db / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') [b0, b1, b2, a0, a1, a2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al];
  else if (type === 'hp') [b0, b1, b2, a0, a1, a2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al];
  else if (type === 'bp') [b0, b1, b2, a0, a1, a2] = [al, 0, -al, 1 + al, -2 * cs, 1 - al];
  else [b0, b1, b2, a0, a1, a2] = [1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A]; // peak
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

/**
 * A plucked string (Karplus-Strong): a burst of noise, shaped by how hard and
 * where it's picked, ringing round a delay tuned to the note.
 * o: amp, ring (seconds to fade away), damp (0 bright … 0.8 dull), pick (where
 * along the string), soft (a softer pick), click (pick noise), rel (let go)
 */
function pluck(out, sr, t0, midi, len, o, rand) {
  const f = hz(midi);
  const P = sr / f;
  const damp = o.damp ?? 0.3;
  let target = P - damp / (1 - damp); // the loop's lowpass adds this much delay
  let D = Math.floor(target);
  let frac = target - D;
  if (frac < 0.15) {
    D -= 1;
    frac += 1;
  }
  const C = (1 - frac) / (1 + frac); // fractional delay, so every note is in tune
  const g = Math.pow(10, -3 / ((o.ring ?? 3) * f));
  const exc = new Float32Array(D);
  const soft = o.soft ?? 0.4;
  let lp = 0;
  for (let i = 0; i < D; i++) {
    lp += (1 - soft) * (rand() * 2 - 1 - lp);
    exc[i] = lp;
  }
  const pp = Math.max(1, Math.round(D * (o.pick ?? 0.16)));
  for (let i = D - 1; i >= pp; i--) exc[i] -= exc[i - pp];
  let mean = 0;
  for (let i = 0; i < D; i++) mean += exc[i];
  mean /= D;
  let rms = 0;
  for (let i = 0; i < D; i++) rms += (exc[i] -= mean) ** 2;
  const norm = (o.amp ?? 1) / (Math.sqrt(rms / D) || 1);
  const buf = new Float32Array(D);
  const rel = o.rel ?? 0.07;
  const total = Math.round((len + rel) * sr);
  const hold = Math.round(len * sr);
  const s0 = Math.round(t0 * sr);
  let idx = 0;
  let lps = 0;
  let ax = 0;
  let ay = 0;
  const click = o.click ?? 0.25;
  const ck = 1 / (0.0012 * sr);
  for (let n = 0; n < total && s0 + n < out.length; n++) {
    const d = buf[idx];
    lps = (1 - damp) * d + damp * lps;
    const ap = C * lps + ax - C * ay;
    ax = lps;
    ay = ap;
    const y = (n < D ? exc[n] : 0) + g * ap;
    buf[idx] = y;
    if (++idx >= D) idx = 0;
    const env = n < hold ? 1 : 1 - (n - hold) / (total - hold);
    let v = y * norm * env;
    if (n < 0.006 * sr) v += click * (o.amp ?? 1) * (rand() * 2 - 1) * Math.exp(-n * ck);
    if (s0 + n >= 0) out[s0 + n] += v;
  }
}

function peakTo(x, p) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= p / m;
  return x;
}

/** A small room (Schroeder: four combs and two allpasses per side). */
function room(x, sr, spread) {
  const s = sr / 44100;
  const out = new Float32Array(x.length);
  for (const d0 of [1116, 1188, 1277, 1356]) {
    const d = Math.round((d0 + spread) * s);
    const buf = new Float32Array(d);
    let i = 0;
    let lp = 0;
    for (let n = 0; n < x.length; n++) {
      const y = buf[i];
      lp = y * 0.75 + lp * 0.25;
      buf[i] = x[n] + lp * 0.8;
      if (++i >= d) i = 0;
      out[n] += y * 0.25;
    }
  }
  for (const d0 of [556, 441]) {
    const d = Math.round((d0 + spread) * s);
    const buf = new Float32Array(d);
    let i = 0;
    for (let n = 0; n < out.length; n++) {
      const b = buf[i];
      const v = out[n];
      buf[i] = v + b * 0.5;
      out[n] = b - v * 0.5;
      if (++i >= d) i = 0;
    }
  }
  return out;
}

function kick(out, sr, t0, amp, rand) {
  const s0 = Math.round(t0 * sr);
  let ph = 0;
  for (let n = 0; n < 0.5 * sr && s0 + n < out.length; n++) {
    const t = n / sr;
    ph += (2 * Math.PI * (48 + 95 * Math.exp(-t / 0.028))) / sr;
    out[s0 + n] += amp * (Math.sin(ph) * Math.exp(-t / 0.26) + 0.25 * (rand() * 2 - 1) * Math.exp(-t / 0.002));
  }
}
/** Shaped noise into `out` (filtered on its own first). */
function noiseHit(out, sr, t0, dur, decay, amp, rand, filt) {
  const n = Math.round(dur * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (rand() * 2 - 1) * Math.exp(-i / (decay * sr));
  for (const [type, f, q] of filt) biquad(x, sr, type, f, q);
  const s0 = Math.round(t0 * sr);
  for (let i = 0; i < n && s0 + i < out.length; i++) out[s0 + i] += amp * x[i];
}
function tone(out, sr, t0, f, decay, amp) {
  const s0 = Math.round(t0 * sr);
  for (let n = 0; n < decay * 6 * sr && s0 + n < out.length; n++) out[s0 + n] += amp * Math.sin((2 * Math.PI * f * n) / sr) * Math.exp(-n / (decay * sr));
}
function snare(out, sr, t0, amp, rand) {
  tone(out, sr, t0, 185, 0.05, 0.55 * amp);
  tone(out, sr, t0, 330, 0.03, 0.3 * amp);
  noiseHit(out, sr, t0, 0.35, 0.09, 1.1 * amp, rand, [['hp', 1400, 0.7], ['peak', 4500, 1, 4]]);
}
function crossStick(out, sr, t0, amp, rand) {
  tone(out, sr, t0, 520, 0.012, 0.6 * amp);
  noiseHit(out, sr, t0, 0.06, 0.01, 2.2 * amp, rand, [['bp', 1900, 6]]);
}
function hat(out, sr, t0, amp, rand, open = 0.035) {
  noiseHit(out, sr, t0, open * 6, open, amp, rand, [['hp', 7500, 0.7], ['peak', 10000, 1, 3]]);
}
function sticks(out, sr, t0, amp, rand) {
  tone(out, sr, t0, 2350, 0.012, 0.5 * amp);
  tone(out, sr, t0, 3700, 0.008, 0.3 * amp);
  noiseHit(out, sr, t0, 0.05, 0.008, 1.6 * amp, rand, [['bp', 2600, 3]]);
}

/** Left/right gains for a pan of −1…1 (equal power). */
const pan = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];

/**
 * The backing, as left and right channels: drums, a strummed guitar, a bass,
 * and the part you play (on guitar the melody, on bass the bass line), played
 * at exactly the chart's times and pitches.
 */
export function renderTraining(tab, sr = 48000) {
  const bassPart = tab.type === 'bass';
  const kind = bassPart ? 'bass' : 'guitar';
  const open = OPEN[kind];
  const cents = (tab.cents || 0) / 100;
  // the band follows your tuning (from your G string), the part you play follows each string
  const shift = (Number(tab.tuning[3]) || 0) + cents;
  const midiOf = (s, f) => open[s] + (Number(tab.tuning[s]) || 0) + f + cents;
  const N = Math.ceil(LENGTH * sr);
  const rand = random(20261108);
  const bus = () => new Float32Array(N);
  const lead = bus(), rhythm = bus(), low = bus(), kit = bus(), hats = bus(), cym = bus();

  // the melody (on bass: played by a guitar, a little quieter)
  for (let i = 0; i < GUITAR.length; i++) {
    const [bar, beat, s, f, len] = GUITAR[i];
    const t = at(bar, beat);
    const m = bassPart ? OPEN.guitar[s] + f + shift : midiOf(s, tab.notes[i] ? tab.notes[i].f : f);
    const ring = i === GUITAR.length - 1 ? 3.2 : len * BEAT + 0.05;
    pluck(lead, sr, t, m, ring, { amp: 1, ring: 2.6, damp: 0.22, pick: 0.14, soft: 0.25, click: 0.35, rel: i === GUITAR.length - 1 ? 0.6 : 0.09 }, rand);
  }
  // the bass line (on bass: what you play)
  for (let i = 0; i < BASS.length; i++) {
    const [bar, beat, s, f, len] = BASS[i];
    const t = at(bar, beat);
    const m = bassPart ? midiOf(s, tab.notes[i] ? tab.notes[i].f : f) : OPEN.bass[s] + f + shift;
    const ring = i === BASS.length - 1 ? 3.2 : len * BEAT - 0.04;
    pluck(low, sr, t, m, ring, { amp: 1, ring: 2.2, damp: 0.62, pick: 0.22, soft: 0.65, click: 0.08, rel: 0.08 }, rand);
    tone(low, sr, t, hz(m), Math.min(0.9, ring), 0.55);
  }
  // strummed chords: down on 1 and 3, up on the "and" of 2 and 4; one big strum to end
  const strums = [];
  for (let bar = 1; bar <= 9; bar++) {
    const ch = CHORDS[bar];
    if (bar === 9) strums.push({ t: at(9, 1), ch, up: false, amp: 0.9, last: true });
    else for (const [beat, up, amp] of [[1, false, 0.85], [2.5, true, 0.45], [3, false, 0.65], [4.5, true, 0.45]]) strums.push({ t: at(bar, beat), ch, up, amp });
  }
  strums.forEach((st, k) => {
    const v = VOICING[st.ch].map((m) => m + shift);
    const strings = st.up ? v.slice(-3).reverse() : v;
    const next = strums[k + 1] ? strums[k + 1].t : st.t + 3.4;
    strings.forEach((m, j) => {
      const t = st.t + j * (st.up ? 0.009 : 0.013);
      pluck(rhythm, sr, t, m, Math.max(0.05, next - t - 0.02), { amp: st.amp * (0.8 + 0.2 * rand()), ring: 2.4, damp: 0.38, pick: 0.2, soft: 0.45, click: 0.18, rel: st.last ? 0.8 : 0.05 }, rand);
    });
  });
  // drums: sticks count you in, then a soft groove (cross-stick, then snare from bar 5)
  for (let b = 1; b <= 4; b++) sticks(kit, sr, at(0, b), b === 1 ? 1 : 0.85, rand);
  for (let bar = 1; bar <= 8; bar++) {
    kick(kit, sr, at(bar, 1), 1, rand);
    kick(kit, sr, at(bar, 3), 0.85, rand);
    if (bar % 2 === 0) kick(kit, sr, at(bar, 3.5), 0.55, rand);
    for (const b of [2, 4]) (bar >= 5 ? snare : crossStick)(kit, sr, at(bar, b), bar >= 5 ? 0.55 : 0.6, rand);
    for (let e = 0; e < 8; e++) hat(hats, sr, at(bar, 1 + e / 2), e % 2 ? 0.55 : 0.9, rand, bar === 8 && e === 7 ? 0.12 : 0.035);
  }
  kick(kit, sr, at(9, 1), 1, rand);
  noiseHit(cym, sr, at(9, 1), 3.5, 1.1, 1, rand, [['hp', 3800, 0.7], ['peak', 7000, 0.8, 4]]);

  // a guitar body: the air and top resonances, a softer top end
  for (const x of [lead, rhythm]) {
    biquad(x, sr, 'peak', 105, 1.6, 5);
    biquad(x, sr, 'peak', 215, 1.8, 3);
    biquad(x, sr, 'peak', 480, 1.0, -3);
    biquad(x, sr, 'peak', 2800, 0.9, 2);
    biquad(x, sr, 'lp', 7500, 0.7);
    biquad(x, sr, 'hp', 70, 0.7);
  }
  biquad(low, sr, 'lp', 1500, 0.7);
  biquad(low, sr, 'hp', 32, 0.7);
  biquad(kit, sr, 'hp', 35, 0.7);

  // the mix: each instrument at its own level and place
  const mixes = bassPart
    ? [[lead, 0.42, 0.15, 0.22], [rhythm, 0.3, -0.4, 0.25], [low, 1.0, 0, 0.04], [kit, 0.62, 0, 0.1], [hats, 0.16, 0.3, 0.05], [cym, 0.2, -0.2, 0.15]]
    : [[lead, 0.82, 0.12, 0.22], [rhythm, 0.34, -0.4, 0.25], [low, 0.55, 0, 0.04], [kit, 0.62, 0, 0.1], [hats, 0.16, 0.3, 0.05], [cym, 0.2, -0.2, 0.15]];
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const send = new Float32Array(N);
  for (const [x, lvl, p, rev] of mixes) {
    peakTo(x, 1);
    const [gl, gr] = pan(p);
    for (let i = 0; i < N; i++) {
      const v = x[i] * lvl;
      L[i] += v * gl;
      R[i] += v * gr;
      send[i] += v * rev;
    }
  }
  const wl = room(send, sr, 0);
  const wr = room(send, sr, 23);
  for (let i = 0; i < N; i++) {
    L[i] += wl[i] * 0.55;
    R[i] += wr[i] * 0.55;
  }
  // a gentle limiter: about as loud as a real song, never clipping
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 0 ? 1.8 / peak : 1;
  for (let i = 0; i < N; i++) {
    L[i] = 0.9 * Math.tanh(L[i] * k);
    R[i] = 0.9 * Math.tanh(R[i] * k);
  }
  // fade the very end
  const fade = Math.round(0.4 * sr);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    L[N - 1 - i] *= g;
    R[N - 1 - i] *= g;
  }
  return { L, R, sampleRate: sr, frames: N };
}

/**
 * Just the part you play, as one plucked string (mono, peak 0.5), `late`
 * seconds after each note: a pretend player for the tests.
 */
export function renderPart(tab, sr = 48000, late = 0) {
  const open = OPEN[tab.type === 'bass' ? 'bass' : 'guitar'];
  const x = new Float32Array(Math.ceil((LENGTH + 1) * sr));
  const rand = random(7);
  tab.notes.forEach((n, i) => {
    const next = tab.notes[i + 1] ? tab.notes[i + 1].t : n.t + 2.5;
    pluck(x, sr, n.t + late, open[n.s] + (Number(tab.tuning[n.s]) || 0) + n.f + (tab.cents || 0) / 100, next - n.t - 0.03, { ring: 2.5, damp: tab.type === 'bass' ? 0.5 : 0.25, click: 0.2 }, rand);
  });
  return peakTo(x, 0.5);
}

/** 16-bit stereo WAV, the layout the song player reads. */
export function toWav(L, R, sr) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * 4, true);
  const pcm = new Int16Array(buf, 44, n * 2);
  for (let i = 0; i < n; i++) {
    pcm[2 * i] = Math.max(-32767, Math.min(32767, Math.round(L[i] * 32767)));
    pcm[2 * i + 1] = Math.max(-32767, Math.min(32767, Math.round(R[i] * 32767)));
  }
  return { buffer: buf, wav: { format: 1, channels: 2, sampleRate: sr, bits: 16, dataOffset: 44, frames: n } };
}

const cache = new Map();
/** The training song's audio for the song player (made once per tuning and rate, then reused). */
export function trainingAudio(tab, sr = 48000) {
  const key = `${tab.type}|${tab.tuning.join(',')}|${tab.cents || 0}|${sr}`;
  if (!cache.has(key)) {
    const r = renderTraining(tab, sr);
    cache.clear();
    cache.set(key, toWav(r.L, r.R, sr));
  }
  const w = cache.get(key);
  // the player takes the buffer over, so it gets a copy
  return { buffer: w.buffer.slice(0), wav: { ...w.wav } };
}
