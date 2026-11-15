/**
 * 4.19: the singer's real pitch line, read off the vocals stem.
 *
 * The stem is followed all the way through every sung stretch (not one reading per syllable), so
 * a word that slides, bends or runs over several notes keeps its shape. Only the lead is kept:
 * - the stem's two sides are added together, so a singer in the middle stands out from voices
 *   placed wide;
 * - at every moment the strongest voice is followed, and the line may not hop to a quieter voice
 *   and back (backing vocals, the echo of the word before);
 * - where no one voice clearly leads (two singers as loud as each other, a breath, a consonant)
 *   the moment is left out, and a syllable with too little left is left blank rather than guessed.
 *
 * No page and no audio device here, so it runs in a worker and in the tests.
 */

const MIN_HZ = 65;
const MAX_HZ = 1100;
/** A moment counts as "the lead, for sure" when its voice is this clear (1 = one perfect voice). */
export const SURE = 0.6;
const HOP = 0.01;

/** A low-pass for cutting the sample rate by `D` (windowed sinc). */
function lowpass(D) {
  const n = 8 * D + 1;
  const h = new Float32Array(n);
  const fc = 0.45 / D;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    const s = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    h[i] = s * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
    sum += h[i];
  }
  for (let i = 0; i < n; i++) h[i] /= sum;
  return h;
}

/**
 * The voice's line over one stretch of the recording.
 * @returns {{ t0:number, hop:number, midi:Float32Array, clear:Float32Array }} a reading every `hop`
 *   seconds from `t0`: the note (NaN where no voice leads) and how clear it was (0…1)
 */
export function trackVoice(read, sr, from, to) {
  const D = Math.max(1, Math.round(sr / 15000));
  const fs = sr / D;
  const fir = lowpass(D);
  const W = Math.round(0.05 * fs);
  const pad = W / fs / 2 + 0.02;
  const start = Math.round((from - pad) * sr) - ((fir.length - 1) >> 1);
  const len = Math.round((to - from + 2 * pad) * sr) + fir.length;
  const raw = new Float32Array(len);
  read(start, raw);
  const m = Math.floor((len - fir.length) / D);
  const x = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    const o = i * D;
    for (let k = 0; k < fir.length; k++) s += raw[o + k] * fir[k];
    x[i] = s;
  }
  const xt0 = from - pad; // the time of x[0]
  const hopN = HOP * fs;
  const frames = Math.max(0, Math.floor((m - W) / hopN) + 1);
  const minTau = Math.max(2, Math.floor(fs / MAX_HZ));
  const maxTau = Math.min(W - 8, Math.ceil(fs / MIN_HZ));
  const nsdf = new Float32Array(maxTau + 2);
  const sq = new Float64Array(W + 1);
  const level = new Float32Array(frames);
  const cands = new Array(frames); // per frame: [midi, cost, clarity] triples, flat
  for (let f = 0; f < frames; f++) {
    const o = Math.round(f * hopN);
    let e = 0;
    for (let i = 0; i < W; i++) {
      const v = x[o + i];
      e += v * v;
      sq[i + 1] = e;
    }
    level[f] = Math.sqrt(e / W);
  }
  // quiet moments (an echo dying away, the band leaking in) are left alone: quiet is measured
  // against the loudest singing within a second and a half either side
  const reach = Math.round(1.5 / HOP);
  const loud = new Float32Array(frames);
  {
    // sliding maximum
    const q = [];
    let r = 0;
    for (let f = 0; f < frames; f++) {
      while (r < Math.min(frames, f + reach + 1)) {
        while (q.length && level[q[q.length - 1]] <= level[r]) q.pop();
        q.push(r++);
      }
      while (q[0] < f - reach) q.shift();
      loud[f] = level[q[0]];
    }
  }
  for (let f = 0; f < frames; f++) {
    if (level[f] < 0.0025 || level[f] < loud[f] * 0.07) {
      cands[f] = null;
      continue;
    }
    const o = Math.round(f * hopN);
    let e = 0;
    for (let i = 0; i < W; i++) {
      e += x[o + i] * x[o + i];
      sq[i + 1] = e;
    }
    for (let tau = minTau - 1; tau <= maxTau + 1; tau++) {
      let acf = 0;
      const n = W - tau;
      for (let i = 0; i < n; i++) acf += x[o + i] * x[o + i + tau];
      const den = sq[n] + (sq[W] - sq[tau]);
      nsdf[tau] = den > 0 ? (2 * acf) / den : 0;
    }
    // every peak is a voice that could be the one (or the same voice an octave down)
    const peaks = [];
    let top = 0;
    for (let tau = minTau; tau <= maxTau; tau++) {
      const v = nsdf[tau];
      if (v > 0.3 && v > nsdf[tau - 1] && v >= nsdf[tau + 1]) {
        const a = nsdf[tau - 1];
        const c = nsdf[tau + 1];
        const den = a - 2 * v + c;
        const sh = den < 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den))) : 0;
        const s = Math.min(1, v - (den * sh * sh) / 2);
        peaks.push([tau + sh, s]);
        if (s > top) top = s;
      }
    }
    if (!peaks.length) {
      cands[f] = null;
      continue;
    }
    // the shortest cycle with real strength is taken as the note; a longer one costs more the
    // longer it is. (The same voice an octave down is as strong, and two voices together have a
    // long cycle in common that is stronger than either: a low note nobody is singing.)
    let ref = Infinity;
    for (const [tau, s] of peaks) if (s >= 0.5 * top && tau < ref) ref = tau;
    peaks.sort((p, q) => q[1] - p[1]);
    const keep = peaks.filter(([tau]) => tau <= ref * 1.02).slice(0, 1);
    for (const p of peaks) if (keep.length < 5 && !keep.includes(p)) keep.push(p);
    const flat = new Float32Array(keep.length * 3);
    keep.forEach(([tau, s], k) => {
      flat[k * 3] = 69 + 12 * Math.log2(fs / tau / 440);
      flat[k * 3 + 1] = 1 - s + (tau > ref * 1.02 ? 0.2 * Math.log2(tau / ref) : 0);
      // a strong shorter cycle that isn't this one an octave up means two voices, and this is
      // only the low note they have in common: never "for sure"
      let two = false;
      for (const [t2, s2] of peaks) {
        if (t2 >= tau * 0.9 || s2 < 0.4 * top) continue;
        const r = Math.log2(tau / t2);
        if (Math.abs(r - Math.round(r)) > 0.06) two = true;
      }
      flat[k * 3 + 2] = two ? Math.min(s, 0.45) : s;
    });
    cands[f] = flat;
  }

  // the cheapest path through the candidates: staying near the last note is free, a jump costs,
  // and "no voice" is a choice at every moment
  const UNV = 0.5;
  const SWITCH = 0.12;
  const STEP = 0.035;
  const best = new Array(frames); // cost per state; state 0 = no voice, k+1 = candidate k
  const back = new Array(frames);
  for (let f = 0; f < frames; f++) {
    const c = cands[f];
    const n = c ? c.length / 3 : 0;
    const cost = new Float32Array(n + 1);
    const from = new Int8Array(n + 1);
    const prev = f ? best[f - 1] : null;
    const pc = f ? cands[f - 1] : null;
    for (let s = 0; s <= n; s++) {
      const own = s === 0 ? (c ? UNV : 0) : c[(s - 1) * 3 + 1];
      let b = 0;
      let bi = 0;
      if (prev) {
        b = Infinity;
        for (let p = 0; p < prev.length; p++) {
          let tr;
          if (p === 0 || s === 0) tr = p === s ? 0 : SWITCH;
          else tr = STEP * Math.min(10, Math.abs(c[(s - 1) * 3] - pc[(p - 1) * 3]));
          if (prev[p] + tr < b) {
            b = prev[p] + tr;
            bi = p;
          }
        }
      }
      cost[s] = b + own;
      from[s] = bi;
    }
    best[f] = cost;
    back[f] = from;
  }
  const midi = new Float32Array(frames).fill(NaN);
  const clear = new Float32Array(frames);
  if (frames) {
    let s = 0;
    const last = best[frames - 1];
    for (let k = 1; k < last.length; k++) if (last[k] < last[s]) s = k;
    for (let f = frames - 1; f >= 0; f--) {
      if (s > 0) {
        midi[f] = cands[f][(s - 1) * 3];
        clear[f] = cands[f][(s - 1) * 3 + 2];
      }
      s = back[f][s];
    }
  }
  return { t0: xt0 + W / fs / 2, hop: HOP, midi, clear };
}

/** Points [t, note] thinned to the ones that carry the shape (within `tol` semitones). */
function thin(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = 0;
    let wi = -1;
    for (let i = a + 1; i < b; i++) {
      const u = (pts[i][0] - pts[a][0]) / (pts[b][0] - pts[a][0] || 1);
      const d = Math.abs(pts[i][1] - (pts[a][1] + (pts[b][1] - pts[a][1]) * u));
      if (d > worst) {
        worst = d;
        wi = i;
      }
    }
    if (worst > tol) {
      keep[wi] = 1;
      stack.push([a, wi], [wi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * One syllable's reading from the voice's line.
 * @returns {{ p:number|null, c:number[][]|null, q:number }} p: its main note (null = left blank);
 *   c: its line as [time, note] points when it moves (null when it holds one note); q: how much
 *   of the syllable the lead was clearly heard (0…1)
 */
export function readSyllable(track, s, { skip = 0.03 } = {}) {
  const from = s.t + skip;
  const to = Math.max(s.t + s.d, from + 0.09);
  const a = Math.max(0, Math.ceil((from - track.t0) / track.hop));
  const b = Math.min(track.midi.length - 1, Math.floor((to - track.t0) / track.hop));
  const n = b - a + 1;
  if (n < 3) return { p: null, c: null, q: 0 };
  const pts = [];
  for (let f = a; f <= b; f++) if (track.clear[f] >= SURE && Number.isFinite(track.midi[f])) pts.push([track.t0 + f * track.hop, track.midi[f]]);
  const q = pts.length / n;
  // too little of it heard clearly: blank. (A long held word clearly heard for a quarter second is enough.)
  if (pts.length < 4 || (q < 0.4 && pts.length * track.hop < 0.25)) return { p: null, c: null, q };
  // two voices trading places make the line leap about: that isn't one singer
  let leaps = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] - pts[i - 1][0] < track.hop * 1.5 && Math.abs(pts[i][1] - pts[i - 1][1]) > 1.5) leaps++;
  if (leaps > Math.max(2, pts.length * 0.12)) return { p: null, c: null, q: q * 0.5 };
  const sorted = pts.map((x) => x[1]).sort((x, y) => x - y);
  const p = Math.round(sorted[sorted.length >> 1] * 100) / 100;
  // the line: vibrato evened out (a 140 ms average), slides and steps kept
  const half = 0.07;
  const smooth = pts.map(([t], i) => {
    let sum = 0;
    let cnt = 0;
    for (let k = i; k >= 0 && t - pts[k][0] <= half; k--) (sum += pts[k][1]), cnt++;
    for (let k = i + 1; k < pts.length && pts[k][0] - t <= half; k++) (sum += pts[k][1]), cnt++;
    return [t, sum / cnt];
  });
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, v] of smooth) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 0.7) return { p, c: null, q }; // it holds one note: a plain bar
  const c = thin(smooth, 0.25).map(([t, v]) => [Math.round(t * 1000) / 1000, Math.round(v * 100) / 100]);
  return { p, c: c.length > 24 ? thin(smooth, 0.5).slice(0, 24).map(([t, v]) => [Math.round(t * 1000) / 1000, Math.round(v * 100) / 100]) : c, q };
}

/**
 * Every syllable read off the singer's recording.
 * @param {(start:number, out:Float32Array) => void} read fills `out` with mono samples from sample `start`
 * @param {{t:number, d:number}[]} syl
 * @returns {{p:number|null, c:number[][]|null, q:number}[]}
 */
export function melodyFromAudio(read, sr, syl) {
  const out = new Array(syl.length);
  // stretches of singing: syllables less than 0.6 s apart are followed in one go (20 s at most)
  let i = 0;
  while (i < syl.length) {
    let k = i;
    let end = syl[i].t + syl[i].d;
    while (k + 1 < syl.length && syl[k + 1].t - end < 0.6 && syl[k + 1].t + syl[k + 1].d - syl[i].t < 20) {
      k++;
      end = Math.max(end, syl[k].t + syl[k].d);
    }
    const track = trackVoice(read, sr, Math.max(0, syl[i].t - 0.3), end + 0.3);
    for (let n = i; n <= k; n++) out[n] = readSyllable(track, syl[n]);
    i = k + 1;
  }
  return out;
}
