/**
 * Note detection for the highway: turns the guitar input into frames
 * (pitch, chroma, onset) and judges each note of the part as hit or missed.
 *
 * Pure logic over sample buffers, so it runs the same in the app and in tests.
 */
import { detectPitch } from './pitch.js';

// ------------------------------------------------------------------ FFT --
function fftMag(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

const HANN = new Map();
function hann(n) {
  if (!HANN.has(n)) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    HANN.set(n, w);
  }
  return HANN.get(n);
}

/**
 * Analyses the newest samples. `buf` holds at least 4096 samples, newest last.
 * Returns { rms, midi (float, or null), chroma[12] normalised, flux }.
 */
export class Analyzer {
  constructor(sr) {
    this.sr = sr;
    this.prevMag = null;
    this.fluxHist = [];
  }

  frame(buf) {
    const sr = this.sr;
    const n = buf.length;
    // Level from the newest 1024 samples (about 21 ms) so attacks show quickly.
    let e = 0;
    for (let i = n - 1024; i < n; i++) e += buf[i] * buf[i];
    const rms = Math.sqrt(e / 1024);
    // Pitch from the newest 4096 (enough for a low B on bass).
    const p = rms > 0.006 ? detectPitch(buf.subarray(n - 4096), sr, { threshold: 0.15 }) : null;
    const midi = p && p.clarity > 0.55 ? 69 + 12 * Math.log2(p.hz / 440) : null;
    // Spectrum of the newest 4096 for chroma and onsets.
    const N = 4096;
    const w = hann(N);
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = buf[n - N + i] * w[i];
    const mag = fftMag(re, im);
    const binHz = sr / N;
    const chroma = new Float32Array(12);
    const lo = Math.floor(70 / binHz);
    const hi = Math.min(mag.length - 1, Math.ceil(3000 / binHz));
    let flux = 0;
    let total = 0;
    for (let k = lo; k <= hi; k++) {
      const m = mag[k];
      total += m;
      if (this.prevMag) flux += Math.max(0, m - this.prevMag[k]);
      // Only local peaks count toward chroma, weighted by strength.
      if (m > mag[k - 1] && m >= mag[k + 1] && m > 1e-4) {
        // Parabolic peak for a better frequency.
        const a = mag[k - 1];
        const c = mag[k + 1];
        const d = (a - c) / (2 * (a - 2 * m + c) || 1);
        const f = (k + (Number.isFinite(d) ? d : 0)) * binHz;
        const pc = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;
        chroma[pc] += m * m;
      }
    }
    this.prevMag = mag;
    let sum = 0;
    for (const v of chroma) sum += v;
    if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] /= sum;
    const fluxN = total > 0 ? flux / total : 0;
    // A longer window for note checks: fine enough to tell E2 from F2 by their partials.
    const N2 = Math.min(8192, 1 << Math.floor(Math.log2(n)));
    const w2 = hann(N2);
    const re2 = new Float32Array(N2);
    const im2 = new Float32Array(N2);
    for (let i = 0; i < N2; i++) re2[i] = buf[n - N2 + i] * w2[i];
    const spec = fftMag(re2, im2);
    return { rms, midi, chroma, flux: fluxN, spec, binHz: sr / N2 };
  }
}

/**
 * Decides when a new note starts: a jump in level, a burst of new spectral
 * energy, or (for hammer-ons, pull-offs and slides) a change of pitch.
 */
export class OnsetTracker {
  constructor() {
    this.env = [];
    this.lastMidi = null;
    this.lastOnset = -1;
  }

  update(t, f) {
    this.env.push({ t, rms: f.rms });
    while (this.env.length && this.env[0].t < t - 0.12) this.env.shift();
    const floor = Math.min(...this.env.map((x) => x.rms));
    let onset = false;
    let kind = null;
    if (f.rms > 0.012 && f.rms > floor * 1.7 && f.flux > 0.12) {
      onset = true;
      kind = 'attack';
    } else if (f.flux > 0.28 && f.rms > 0.01) {
      onset = true;
      kind = 'attack';
    } else if (f.midi !== null && this.lastMidi !== null && Math.abs(f.midi - this.lastMidi) > 0.7) {
      onset = true;
      kind = 'legato';
    }
    if (f.midi !== null) this.lastMidi = f.midi;
    else if (f.rms < 0.006) this.lastMidi = null;
    if (onset && t - this.lastOnset < 0.05) onset = false; // one note, one onset
    if (onset) this.lastOnset = t;
    return onset ? kind : null;
  }
}

/** MIDI note a fretted string sounds (fret numbers are absolute, capo included). */
/** Semitones your guitar is dropped by (the Drop): you fret higher than the chart, so expect that. */
export const tuneShift = { st: 0 };
/** Semitones what's plugged in sounds from the part: +12 a guitar on a bass part, −12 a bass on a guitar part. */
export const instrumentShift = { st: 0 };

export function noteMidi(tab, s, f) {
  const base = tab.type === 'bass' ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64];
  const tun = Number((tab.tuning || [])[s]) || 0;
  const fret = f === 0 && tab.capo ? tab.capo : f;
  return base[s] + tun + fret + tuneShift.st + (tab.cents || 0) / 100;
}

const HARMONIC_UP = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28, 3: 31 };

/**
 * One gem (single note) or chord on the highway, as the judge sees it.
 * Built from the tab: { t, sus, notes:[{s,f,midi,...}], kind: 'note'|'chord'|'mute' }
 */
export function targetsFromTab(tab) {
  const out = [];
  for (const n of tab.notes) {
    out.push({ t: n.t, sus: n.sus || 0, notes: [{ ...n, midi: noteMidi(tab, n.s, n.f) }], kind: n.mute ? 'mute' : 'note', legato: !!(n.hammerOn || n.pullOff || n.tap) });
  }
  for (const c of tab.chordEvents) {
    const notes = c.strings.map((x) => ({ ...x, midi: noteMidi(tab, x.s, x.f) }));
    const allMuted = notes.every((x) => x.mute);
    out.push({ t: c.t, sus: c.sus || 0, notes, kind: allMuted ? 'mute' : notes.length === 1 ? 'note' : 'chord', chord: c.chord });
  }
  out.sort((a, b) => a.t - b.t);
  out.forEach((x, i) => (x.id = i));
  // a note held on from the one before it (linkNext) isn't picked again: it
  // carries its parent's result instead of being judged on its own
  const lastOn = new Map();
  for (const x of out) {
    if (x.notes.length && x.notes.every((n) => n.linked)) {
      const p = lastOn.get(x.notes[0].s);
      if (p !== undefined) {
        x.linked = true;
        x.parent = p;
      }
    }
    for (const n of x.notes) lastOn.set(n.s, x.id);
  }
  return out;
}

/**
 * Judges targets against detection frames. Times are song seconds, already
 * corrected for input delay. Windows are generous enough for real playing
 * and tight enough that noodling doesn't score.
 */
export class Judge {
  constructor(targets, { early = 0.13, late = 0.17 } = {}) {
    this.targets = targets;
    this.early0 = early;
    this.late0 = late;
    this.early = early;
    this.late = late;
    this.state = new Map(); // id -> { result: 'hit'|'miss', at, cents }
    this.onsets = []; // {t, kind}
    this.frames = []; // recent frames {t, midi, chroma, rms}
    this.next = 0;
    this.streak = 0;
    this.best = 0;
    this.hits = 0;
    this.judged = 0;
    this.events = []; // newly judged, for the renderer's effects
  }

  /**
   * The practice speed. Windows are in song seconds; above 100% the song runs
   * faster than the clock on the wall, so they widen to stay as long, in real
   * time, as at 100%. Slower than 100% they stay as they are (more forgiving).
   */
  setPace(speed) {
    const k = Math.max(1, Number(speed) || 1);
    this.early = this.early0 * k;
    this.late = this.late0 * k;
  }

  reset(t) {
    this.state.clear();
    this.confirmed=new Map();
    this.events=[];
    this.onsets = [];
    this.frames = [];
    this.next = this._index(t - 1);
    this.streak = 0;
    this.best = 0;
    this.hits = 0;
    this.judged = 0;
  }

  /** Forget results from `t` on (after a seek backwards or a loop). */
  rewind(t) {
    for(const [id]of this.confirmed||[])if(this.targets[id]?.t>=t)this.confirmed.delete(id);
    for (const [id, st] of this.state) {
      const tg = this.targets[id];
      if (tg && tg.t >= t - this.early) {
        if (!st.linked) {
          if (st.result === 'hit') this.hits--;
          this.judged--;
        }
        this.state.delete(id);
      }
    }
    this.onsets = this.onsets.filter((o) => o.t < t);
    this.frames = this.frames.filter((f) => f.t < t);
    this.next = this._index(t - 1);
    this.streak = 0;
  }

  _index(t) {
    let lo = 0;
    let hi = this.targets.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.targets[m].t < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  push(t, frame, onsetKind) {
    this.frames.push({ t, ...frame });
    while (this.frames.length && this.frames[0].t < t - 1.5) this.frames.shift();
    if (onsetKind) this.onsets.push({ t, kind: onsetKind });
    if (this.debug) this.debug.push({ t, midi: frame.midi, rms: frame.rms, flux: frame.flux, onset: onsetKind });
    while (this.onsets.length && this.onsets[0].t < t - 1.5) this.onsets.shift();
    this.confirmed ||= new Map();
    for(let i=this.next;i<this.targets.length;i++){const tg=this.targets[i];if(tg.t>t+this.early)break;if(t>tg.t+this.late||this.confirmed.has(tg.id))continue;const result=this._evaluate(tg);if(result.hit)this.confirmed.set(tg.id,result);}
    this._judge(t);
  }

  /** Called every frame even without input, so missed notes get marked. */
  tick(t) {
    this._judge(t);
  }

  /** Spectrum of new energy: the strongest frame after the onset minus what was ringing before it. */
  _newEnergy(onsetT) {
    const before = this._frameNear(onsetT - 0.07);
    let after = null;
    const end=Math.min(onsetT+.17,this.onsets.find(o=>o.t>onsetT+.015)?.t??Infinity);
    for (const f of this.frames) {
      if (f.t < onsetT + 0.025 || f.t > end || !f.spec) continue;
      if (!after) after = Float32Array.from(f.spec);
      else for (let k = 0; k < after.length; k++) if (f.spec[k] > after[k]) after[k] = f.spec[k];
    }
    if (!after) return null;
    if (before && before.spec && before.spec.length === after.length) for (let k = 0; k < after.length; k++) after[k] = Math.max(0, after[k] - before.spec[k] * 0.85);
    return { mag: after, binHz: (before || this.frames[this.frames.length - 1]).binHz };
  }

  _frameNear(t) {
    let best = null;
    for (const f of this.frames) if (f.spec && (!best || Math.abs(f.t - t) < Math.abs(best.t - t))) best = f;
    return best;
  }

  /** How strongly a note's harmonic series shows in the new energy. */
  _salience(ne, midi, spacing = 2) {
    const f0 = 440 * Math.pow(2, (midi - 69) / 12);
    const tol = Math.pow(2, 35 / 1200);
    // Start from the first harmonic where a semitone spans two or more bins,
    // so low bass notes are judged by partials that can tell neighbours apart.
    const h0 = Math.max(1, Math.ceil((spacing * ne.binHz) / (f0 * 0.0595)));
    let s = 0;
    for (let hm = h0; hm < h0 + 6; hm++) {
      const f = f0 * hm;
      if (f > 5000) break;
      const lo = Math.max(1, Math.floor(f / tol / ne.binHz));
      const hi = Math.min(ne.mag.length - 1, Math.ceil((f * tol) / ne.binHz));
      let peak = 0;
      for (let k = lo; k <= hi; k++) if (ne.mag[k] > peak) peak = ne.mag[k];
      s += peak / Math.sqrt(hm);
    }
    return s;
  }

  _strongest(ne) {
    let best = 0;
    for (let m = 26; m <= 90; m++) best = Math.max(best, this._salience(ne, m));
    return best;
  }

  _matchNote(tg, onsetT) {
    const ne = this._newEnergy(onsetT);
    if (!ne) return null;
    const want = tg.notes[0];
    let expect = want.midi;
    if (want.harmonic) expect = want.midi - want.f + (HARMONIC_UP[want.f] || 12);
    const cands = [expect];
    if (instrumentShift.st) cands.push(expect + instrumentShift.st);
    if (want.bend) for (let b = 0.5; b <= want.bend + 0.01; b += 0.5) cands.push(expect + b); // bends are in half steps
    if (want.pinchHarmonic) cands.push(expect + 12, expect + 19, expect + 24);
    if (instrumentShift.st && want.bend) for (let b = 0.5; b <= want.bend + 0.01; b += 0.5) cands.push(expect + instrumentShift.st + b);
    const top = this._strongest(ne);
    if (top <= 0) return null;
    let bestSal = 0;
    let bestM = expect;
    for (const m of cands) {
      const sv = this._salience(ne, m);
      if (sv > bestSal) {
        bestSal = sv;
        bestM = m;
      }
    }
    // Neighbours a semitone or two away must not be the real note.
    // A fret or two off (the usual slip) must lose clearly; a fourth or fifth
    // away shares harmonics with the right note, so only a clear winner counts.
    let near = 0;
    for (const d of [-3, -2, -1, 1, 2, 3]) near = Math.max(near, this._salience(ne, bestM + d));
    let far = 0;
    for (const d of [-5, -4, 4, 5]) far = Math.max(far, this._salience(ne, bestM + d));
    const ok = bestSal >= 0.3 * top && bestSal >= near && bestSal >= 0.7 * far;
    if (ok) return Math.round((bestM - expect) * 100);
    // A real bass has a strong fundamental and few upper partials, which the
    // spectrum check above leans on for low notes. The pitch tracker reads the
    // fundamental itself: if it settles on the note just after the pick, count it.
    return this._pitchVote(cands, onsetT, expect);
  }

  /** Cents off `expect` when the tracked pitch after the onset sits on one of `cands`, else null. */
  _pitchVote(cands, onsetT, expect) {
    let seen = 0;
    const agree = [];
    for (const f of this.frames) {
      if (f.t < onsetT + 0.05 || f.t > onsetT + 0.24) continue;
      seen++;
      if (f.midi === null || f.midi === undefined) continue;
      for (const m of cands) if (Math.abs(f.midi - m) < 0.45) agree.push(f.midi - expect);
    }
    if (agree.length < 3 || agree.length < seen * 0.4) return null;
    agree.sort((a, b) => a - b);
    return Math.round(agree[agree.length >> 1] * 100);
  }

  _matchChord(tg, onsetT) {
    const ne = this._newEnergy(onsetT);
    if (!ne) return null;
    const top = this._strongest(ne);
    if (top <= 0) return null;
    // A settled look at the chord once all its strings ring, to tell a fret off. A strum's
    // strings start a little apart, so the next chord is the next onset 0.1 s on or later.
    const end = Math.min(onsetT + 0.2, this.onsets.find((o) => o.t > onsetT + 0.1)?.t ?? Infinity);
    let late = null;
    for (const f of this.frames) if (f.spec && f.t >= onsetT + 0.09 && f.t <= end && (!late || f.t > late.t)) late = f;
    // Too early to tell yet: wait rather than pass it.
    if (!late && end >= onsetT + 0.09 && this.frames.length && this.frames[this.frames.length - 1].t < onsetT + 0.09) return null;
    const look = late && { mag: late.spec, binHz: late.binHz, before: this._frameNear(onsetT - 0.07) };
    const r = this._chordIn(ne, top, tg, 0, look);
    return r === null && instrumentShift.st ? this._chordIn(ne, top, tg, instrumentShift.st, look) : r;
  }

  _chordIn(ne, top, tg, shift, look) {
    const midis = [...new Set(tg.notes.filter((x) => !x.mute).map((x) => Math.round((x.midi + shift) * 100) / 100))];
    let present = 0;
    // Chords ring with many loud partials; judge each tone on harmonics spaced
    // well apart so a loud neighbour's spill-over can't pass for it.
    const sal = (m) => this._salience(ne, m, 3);
    for (const m of midis) {
      const sv = sal(m);
      const rival = Math.max(sal(m - 1), sal(m + 1), sal(m - 2), sal(m + 2));
      if (sv >= 0.1 * top && sv >= 0.8 * rival) present++;
    }
    // Half the strings is enough (a light strum, a string missed); a wrong chord is caught below.
    if (present < Math.max(1, Math.ceil(midis.length * 0.5))) return null;
    if (look && this._wrongFret(look, midis)) return null;
    return present / midis.length;
  }

  /**
   * True when one of the chord's notes was clearly fretted wrong: none of its strings show it,
   * and a note a fret or two away, one the chord doesn't have, rings in its place (E minor played
   * for E major). Forgiving on purpose: a note that's just quiet or missed is fine, a note whose
   * partials all sit under other notes can't be told and is fine, and a note heard clearly on any
   * of its strings is fine even if another of its strings slipped a fret.
   */
  _wrongFret(look, midis) {
    const pk = this._peaks(look);
    if (!pk.length) return false;
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const near = (f, g) => Math.abs(1200 * Math.log2(f / g)) < 30;
    const pc = (m) => ((Math.round(m) % 12) + 12) % 12;
    const names = new Set(midis.map(pc));
    // a frequency one of these notes' first 12 harmonics explains
    const explained = (f, notes) => notes.some((o) => {
      const g = hz(o);
      const k = Math.round(f / g);
      return k >= 1 && k <= 12 && near(f, g * k);
    });
    // How strongly a note shows on the harmonics only it has (none of `others` shares them),
    // from the first harmonic where a semitone is two bins wide. `fresh`: only peaks that are new.
    const ev = (m, others, fresh) => {
      const f0 = hz(m);
      const h0 = Math.max(1, Math.ceil((2 * look.binHz) / (f0 * 0.0595)));
      let s = 0, n = 0;
      for (let h = h0; h < h0 + 6 && f0 * h < 4000; h++) {
        const f = f0 * h;
        if (explained(f, others)) continue;
        n++;
        let a = 0;
        for (const p of pk) if (p.a > a && near(p.f, f) && (!fresh || p.fresh)) a = p.a;
        s += a / Math.sqrt(h);
      }
      return { s, n };
    };
    for (const name of names) {
      const same = midis.filter((x) => pc(x) === name);
      const others = midis.filter((x) => pc(x) !== name);
      let wrong = true;
      for (const m of same) {
        const mine = ev(m, others, false);
        // can't tell, or heard clearly: fine
        if (mine.n === 0 || mine.s >= 0.1 * pk.top) { wrong = false; break; }
        let beaten = false;
        for (const d of [-2, -1, 1, 2]) {
          if (names.has(pc(m + d))) continue;
          // the same slip on this note's other strings doesn't count as more proof
          const alt = ev(m + d, [...others, ...same.filter((o) => o !== m).map((o) => o + d)], true);
          if (alt.n >= 2 && alt.s >= 0.15 * pk.top && alt.s >= 2 * mine.s) beaten = true;
        }
        if (!beaten) { wrong = false; break; }
      }
      if (wrong) return true;
    }
    return false;
  }

  /** Peaks of a spectrum, 60 Hz to 4 kHz: real peaks only, not the spill-over beside a loud one. */
  _peaks(look) {
    if (look.peaks) return look.peaks;
    const m = look.mag, b = look.before && look.before.spec && look.before.spec.length === m.length ? look.before.spec : null;
    const all = [];
    let top = 0;
    const lo = Math.max(2, Math.floor(60 / look.binHz)), hi = Math.min(m.length - 2, Math.ceil(4000 / look.binHz));
    for (let k = lo; k <= hi; k++) {
      if (m[k] <= m[k - 1] || m[k] < m[k + 1]) continue;
      const d = (m[k - 1] - m[k + 1]) / (2 * (m[k - 1] - 2 * m[k] + m[k + 1]) || 1);
      // fresh: at least twice what was ringing there before the strum
      const was = b ? Math.max(b[k - 1], b[k], b[k + 1]) : 0;
      all.push({ f: (k + (Number.isFinite(d) ? d : 0)) * look.binHz, a: m[k], fresh: m[k] > 2 * was });
      if (m[k] > top) top = m[k];
    }
    const side = 3.5 * look.binHz;
    look.peaks = all.filter((p) => p.a >= 0.02 * top && !all.some((q) => q.a >= 4 * p.a && Math.abs(q.f - p.f) < side));
    look.peaks.top = top;
    return look.peaks;
  }

  _judge(t) {
    const T = this.targets;
    while (this.next < T.length && T[this.next].t + this.late + 0.08 < t) {
      const tg = T[this.next];
      if (tg.linked) {
        const ps = this.state.get(tg.parent);
        if (ps && !this.state.has(tg.id)) this.state.set(tg.id, { ...ps, linked: true });
        this.next++;
        continue;
      }
      if (!this.state.has(tg.id)) {
        const from = tg.t - this.early;
        const to = tg.t + this.late;
        const res = this.confirmed?.get(tg.id)||this._evaluate(tg);
        const hit = res.hit;
        const cents = res.cents;
        const onset = res.onset;
        this.state.set(tg.id, { result: hit ? 'hit' : 'miss', at: t, cents, offset: onset ? Math.round((onset.t - tg.t) * 1000) : null });
        this.judged++;
        if (hit) {
          this.hits++;
          this.streak++;
          this.best = Math.max(this.best, this.streak);
        } else this.streak = 0;
        this.events.push({ id: tg.id, hit });
      }
      this.next++;
    }
  }

  /** Tries each onset in the window (closest first); legato notes may have none. */
  _evaluate(tg) {
    const from = tg.t - this.early;
    const to = tg.t + this.late;
    const onsets = this.onsets.filter((o) => o.t >= from && o.t <= to).sort((a, b) => Math.abs(a.t - tg.t) - Math.abs(b.t - tg.t));
    const legato = tg.legato || tg.notes.some((n) => n.slideTo !== undefined);
    const tries = onsets.map((o) => o.t);
    if (legato && !tries.length) tries.push(tg.t);
    if (tg.kind === 'mute') {
      // A muted strum is a short scratch: any burst of new energy in the window counts.
      const burst = this.frames.find((f) => f.t >= from && f.t <= to && f.rms > 0.008 && f.flux > 0.07);
      if (burst || tries.length) return { hit: true, cents: null, onset: { t: burst ? burst.t : tries[0] } };
      return { hit: false, cents: null, onset: null };
    }
    for (const ot of tries) {
      const r = tg.kind === 'chord' ? this._matchChord(tg, ot) : this._matchNote(tg, ot);
      if (r !== null) return { hit: true, cents: tg.kind === 'chord' ? null : r, onset: { t: ot } };
    }
    return { hit: false, cents: null, onset: onsets[0] || null };
  }

  /** Early judgment for display: a target already matched before its window closed. */
  peek(tg, t) {
    if (this.state.has(tg.id)) return this.state.get(tg.id).result;
    if (t < tg.t - this.early + 0.17) return null;
    if (!this._peekCache || this._peekCache.t !== t) this._peekCache = { t, m: new Map() };
    if (!this._peekCache.m.has(tg.id)) this._peekCache.m.set(tg.id, this._evaluate(tg).hit ? 'hit' : null);
    return this._peekCache.m.get(tg.id);
  }

  get accuracy() {
    return this.judged ? this.hits / this.judged : null;
  }
}
