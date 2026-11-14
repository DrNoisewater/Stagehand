/* Auto-tune for the singer's microphone (4.17).
 *
 * The same idea as the studio effect: hear the note being sung, pick the note
 * it should be, and move the voice there. How fast it moves is the style:
 * slowly sounds natural, at once is the famous robot voice.
 *
 * How the voice is moved: it is cut into short pieces, one per cycle of the
 * voice, and the pieces are laid down again closer together (higher) or
 * further apart (lower). The voice keeps its own character, only the note
 * changes. Each piece is cut from the newest cycle and read as it arrives, so
 * the voice is about half a cycle late (a few thousandths of a second). With
 * nothing to tune or change, the voice goes straight through, not late at all.
 *
 * 4.17.2: an automatic level (a quiet microphone comes out at a healthy level
 * beside the song), a gate that learns the room, and more voices.
 *
 * AutoTune is plain maths (tested in test/autotune.test.mjs); the processor at
 * the bottom runs it on the sound thread.
 */

const MIN_HZ = 75;
const MAX_HZ = 1000;
/** Seconds the voice takes to reach the note. */
export const TUNE_STYLES = { natural: 0.11, pop: 0.03, robot: 0 };
/**
 * Voice changer. shift: notes moved (whole octaves only, so a changed voice still fits the
 * song); form: the size of the "mouth" (under 1 = bigger and darker, over 1 = smaller and
 * brighter). The rest are extras: mono (every word on one flat note), buzz (a metallic ring on
 * that note), growl (a rough note an octave under), wobble (a fast wobble in the note, in
 * semitones), ring (a metallic ring at that many Hz), radio (a thin, crunchy band), echo (an
 * arena's echoes).
 */
export const VOICES = {
  normal: { shift: 0, form: 1 },
  deep: { shift: 0, form: 0.8 },
  giant: { shift: -12, form: 0.72, grit: 0.25 }, // "Villain" (the id is kept for saved settings)
  monster: { shift: -12, form: 0.62, growl: 0.55, grit: 0.5 },
  high: { shift: 0, form: 1.22 },
  chipmunk: { shift: 12, form: 1.85 },
  droid: { shift: 0, form: 1, mono: true, buzz: 0.6 },
  alien: { shift: 0, form: 1.18, wobble: 0.7, ring: 160 },
  radio: { shift: 0, form: 1, radio: true },
  stadium: { shift: 0, form: 1, echo: true },
};
/** The voice comes out at about this loudness (before the volume), whatever the microphone. */
const LEVEL = 0.18;
const MAX_BOOST = 24; // up to about 28 dB for a quiet microphone
const HANN = (() => {
  const t = new Float32Array(1025);
  for (let i = 0; i <= 1024; i++) t[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 1024);
  return t;
})();
const N = 16384; // the voice kept (a third of a second)
const YN = 4096;
const GRAINS = 12;
const EN = 32768; // the echo's memory (two thirds of a second)
const CN = 4096; // the metallic ring's memory

/** A two-pole filter (the radio's band): [b0, b1, b2, a1, a2]. */
function biquad(kind, hz, q, sr) {
  const w = (2 * Math.PI * hz) / sr;
  const c = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  const b = kind === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * c) / a0, (1 - al) / a0];
}

export class AutoTune {
  constructor(sampleRate) {
    const sr = (this.sr = sampleRate);
    const k48 = 48000 / sr;
    this.k48 = k48;
    this.x = new Float32Array(N);
    this.w = 0; // samples heard so far
    // a 4× smaller copy to find the note on (cheap), then the full one to pin it down
    this.D = Math.max(1, Math.round(sr / 12000));
    this.fsd = sr / this.D;
    this.y = new Float32Array(YN);
    this.yw = 0;
    this.dAcc = 0;
    this.dN = 0;
    this.maxTau = Math.ceil(this.fsd / MIN_HZ);
    this.minTau = Math.max(2, Math.floor(this.fsd / MAX_HZ));
    this.Wd = Math.round(this.fsd * 0.022);
    this.fr = new Float32Array(this.Wd + this.maxTau + 2);
    this.cm = new Float32Array(this.maxTau + 2);
    this.hop = Math.round(sr * 0.005);
    this.toHop = this.hop;
    this.Wf = Math.min(1024, Math.round(sr * 0.02));
    // what is heard
    this.voiced = false;
    this.P = sr / 200; // one cycle of the voice, in samples
    this.hist = [];
    this.prevTau = 0;
    this.level = 0;
    this.open = false;
    this.floor = 0.002; // the room's own noise, learnt as it goes
    this.fast = 0; // the last few thousandths of a second (squared), so the gate opens on the first sound
    this.env = 0; // how loud the singer sings (for the automatic level)
    this.boost = 1; // the automatic level now
    this.sung = null; // the note sung (midi, with fractions)
    this.target = null; // the note it is moved to
    this.note = null;
    this.oct = null; // the octave a song note was put in (kept while the note lasts)
    this.octNote = null;
    this.monoNote = null;
    this.reads = new Float32Array(64); // the notes read since the page last asked (NaN: none)
    this.rn = 0;
    this.corr = 0; // how far the voice is being moved now (semitones)
    this.ratio = 1;
    // the pieces
    this.Pu = Math.round(sr * 0.004);
    this.mark = 0; // the newest cycle marked
    this.markP = this.Pu;
    this.mPos = new Int32Array(16); // the last few cycles: where, and how long
    this.mPer = new Int32Array(16);
    this.mc = 0; // cycles marked so far
    this.nextS = 0;
    this.gPos = new Float64Array(GRAINS); // where the piece is read from
    this.gN = new Int32Array(GRAINS);
    this.gLen = new Int32Array(GRAINS); // how long it plays
    this.gStep = new Float32Array(GRAINS); // how fast it is read (the voice changer)
    this.gAmp = new Float32Array(GRAINS);
    this.gCount = 0;
    this.gain = 0; // the gate: closed when nobody sings, so the room isn't played back
    this.dry = 1; // 1: the voice goes straight through (nothing to move)
    // settings
    this.retune = TUNE_STYLES.natural;
    this.tune = true; // off: the voice is left on the notes it sings (voice changer only)
    this.v = VOICES.normal;
    this.shift = 0;
    this.form = 1;
    this.mode = 'near';
    this.vol = 1;
    this.auto = true; // the automatic level
    this.mask = new Uint8Array(12).fill(1);
    this.song = null; // { t, e, p } arrays
    this.songT = 0;
    this.songRate = 0;
    this.songW = 0;
    // input clean-up (rumble)
    this.hpA = Math.exp((-2 * Math.PI * 60) / sr);
    this.hpX = 0;
    this.hpY = 0;
    // the extras
    this.lfo = 0;
    this.ringPh = 0;
    this.comb = null;
    this.cw = 0;
    this.echo = null;
    this.ew = 0;
    this.eLp = 0;
    this.bq = [biquad('hp', 450, 0.8, sr), biquad('lp', 2800, 0.9, sr)];
    this.bz = new Float64Array(4);
  }

  /** Nothing to move or change: the voice goes straight through. */
  get pass() {
    const v = this.v;
    return !this.tune && !this.shift && this.form === 1 && !v.mono && !v.wobble && !v.growl;
  }

  /**
   * style: natural | pop | robot, or off (no tuning); mode: 'song' (the song's notes) | 'near'
   * (the nearest note); voice: an id of VOICES; vol 0…1.5; auto: the automatic level (on unless false)
   */
  set({ style, mode, vol, voice, auto } = {}) {
    if (style !== undefined) {
      this.tune = TUNE_STYLES[style] !== undefined;
      if (this.tune) this.retune = TUNE_STYLES[style];
    }
    if (voice !== undefined) {
      this.v = VOICES[voice] || VOICES.normal;
      this.shift = this.v.shift;
      this.form = this.v.form;
      if (this.v.echo && !this.echo) this.echo = new Float32Array(EN);
      if (this.v.buzz && !this.comb) this.comb = new Float32Array(CN);
    }
    if (mode !== undefined) this.mode = mode === 'song' ? 'song' : 'near';
    if (vol !== undefined) this.vol = Math.max(0, Math.min(1.5, Number(vol) || 0));
    if (auto !== undefined) this.auto = auto !== false;
  }

  /**
   * The song's notes to sing: [{ t, d, p }] (seconds, midi), or null. The notes
   * the song uses also become the scale for everything sung between them.
   */
  setSong(notes) {
    const list = (notes || []).filter((n) => Number.isFinite(n.p) && Number.isFinite(n.t)).sort((a, b) => a.t - b.t);
    if (!list.length) {
      this.song = null;
      this.mask.fill(1);
      return;
    }
    // a recording can sit a little above or below concert pitch: keep its notes where they are
    let sx = 0;
    let sy = 0;
    for (const n of list) {
      const a = 2 * Math.PI * (n.p - Math.round(n.p));
      sx += Math.cos(a);
      sy += Math.sin(a);
    }
    const off = Math.atan2(sy, sx) / (2 * Math.PI);
    this.off = Math.abs(off) < 0.08 ? 0 : off;
    const t = new Float64Array(list.length);
    const e = new Float64Array(list.length);
    const p = new Float32Array(list.length);
    const share = new Float64Array(12);
    let total = 0;
    list.forEach((n, i) => {
      const d = Math.max(0.1, Number(n.d) || 0.3);
      t[i] = n.t;
      e[i] = n.t + d;
      const q = Math.round(n.p - this.off);
      p[i] = q + this.off;
      share[((q % 12) + 12) % 12] += d;
      total += d;
    });
    this.song = { t, e, p };
    let used = 0;
    for (let k = 0; k < 12; k++) {
      this.mask[k] = share[k] / total >= 0.03 ? 1 : 0;
      used += this.mask[k];
    }
    if (used < 5) this.mask.fill(1); // too few notes to call it a scale
  }

  /** Where the song is now (seconds), how fast it runs (0 = stopped). */
  setClock(t, rate) {
    this.songT = Number(t) || 0;
    this.songRate = Number(rate) || 0;
    this.songW = this.w;
  }

  /** The song's note to be on right now, or null. */
  _songNote() {
    const s = this.song;
    if (!s || this.mode !== 'song' || !this.songRate) return null;
    const now = this.songT + ((this.w - this.songW) / this.sr) * this.songRate;
    let lo = 0;
    let hi = s.t.length - 1;
    let i = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (s.t[m] - 0.1 <= now) {
        i = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    if (i < 0) return null;
    if (now < s.t[i] && i > 0 && now <= s.e[i - 1]) return s.p[i - 1]; // still on the note before
    if (now <= s.e[i] + 0.12) return s.p[i];
    return null;
  }

  /** The note this sung note should be. */
  _pick(sung) {
    const sn = this._songNote();
    if (sn !== null) {
      this.note = null;
      // the song's note in the singer's own octave, however far off they are; the octave is
      // kept while the note lasts, so a singer halfway between two doesn't flip back and forth
      let k = Math.round((sung - sn) / 12);
      if (this.octNote === sn && this.oct !== null && Math.abs(sung - (sn + 12 * this.oct)) < 7.5) k = this.oct;
      this.oct = k;
      this.octNote = sn;
      return sn + 12 * k;
    }
    this.octNote = null;
    const off = this.song && this.mode === 'song' ? this.off || 0 : 0;
    const v = sung - off;
    let best = Math.round(v);
    let bd = Infinity;
    for (let n = Math.floor(v) - 6; n <= Math.floor(v) + 7; n++) {
      if (!this.mask[((n % 12) + 12) % 12]) continue;
      const d = Math.abs(v - n);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    // stay on the note you're on until you are clearly nearer another (no flicker between two;
    // Hard tune holds on a little longer, so it steps cleanly from note to note)
    if (this.note !== null && this.mask[((this.note % 12) + 12) % 12] && Math.abs(v - this.note) < bd + (this.retune ? 0.2 : 0.35)) best = this.note;
    this.note = best;
    return best + off;
  }

  /** Finds the note in the latest sound: sets voiced, P, level, the gate and the automatic level. */
  _detect() {
    const { y, fr, cm, Wd, maxTau, minTau } = this;
    const need = Wd + maxTau + 1;
    if (this.yw < need) return this._heard(0);
    const base = this.yw - need;
    let e = 0;
    for (let i = 0; i < need; i++) {
      const v = y[(base + i) & (YN - 1)];
      fr[i] = v;
      e += v * v;
    }
    const level = (this.level = Math.sqrt(e / need));
    // the gate: a little above the room's own noise (learnt), with a little to spare to stay open
    const fl = this.floor;
    if (level < fl) this.floor += (level - fl) * 0.08;
    else if (!this.open) this.floor = Math.min(0.02, fl + (level - fl) * 0.006);
    else this.floor = Math.min(0.012, fl + (level - fl) * 0.0001); // a room getting noisier while you sing
    const openAt = Math.max(0.0025, this.floor * 2.5);
    const stayAt = Math.max(0.0016, this.floor * 1.6);
    this.open = level > (this.open ? stayAt : openAt) || (!this.open && this.fast > openAt * openAt * 1.7);
    if (!this.open) {
      this.monoNote = null;
      return this._heard(0);
    }
    // the automatic level: follows the singer (quickly down, slowly up), never the room
    if (!this.env) this.env = level;
    else this.env += (level - this.env) * (level > this.env ? 0.25 : 0.012);
    let tau = -1;
    if (level > fl * 1.6) {
      let run = 0;
      cm[0] = 1;
      for (let t = 1; t <= maxTau; t++) {
        let d = 0;
        for (let i = 0; i < Wd; i++) {
          const v = fr[i] - fr[i + t];
          d += v * v;
        }
        run += d;
        cm[t] = run ? (d * t) / run : 1;
      }
      for (let t = minTau; t <= maxTau; t++) {
        if (cm[t] < 0.18) {
          while (t + 1 <= maxTau && cm[t + 1] < cm[t]) t++;
          tau = t;
          break;
        }
      }
      if (tau < 0) {
        tau = this._dip(minTau, maxTau);
        if (tau < 0 || cm[tau] > 0.4) tau = -1;
      }
      // an octave slip (the reader, not the singer): the note we were on still fits better
      if (this.prevTau) {
        const near = this._dip(Math.floor(this.prevTau * 0.85), Math.ceil(this.prevTau * 1.18));
        if (near > 0) {
          if (tau < 0 && cm[near] < 0.45) tau = near;
          else if (tau > 0 && tau < this.prevTau * 0.7 && cm[near] < cm[tau] * 0.4) tau = near;
          else if (tau > this.prevTau * 1.5 && cm[near] < 0.35) tau = near;
        }
      }
    }
    if (tau < 0) return this._heard(0);
    this.prevTau = tau;
    // pin it down on the full sound
    const D = this.D;
    const Wf = this.Wf;
    const x = this.x;
    const c = tau * D;
    const lo = Math.max(2, c - D);
    const hi = c + D;
    const start = this.w - Wf - hi - 2;
    let bk = c;
    let bv = Infinity;
    const dv = this._dv || (this._dv = new Float64Array(64));
    for (let k = lo - 1; k <= hi + 1; k++) {
      let d = 0;
      for (let i = 0; i < Wf; i += 2) {
        const v = x[(start + i) & (N - 1)] - x[(start + i + k) & (N - 1)];
        d += v * v;
      }
      dv[k - lo + 1] = d;
      if (k >= lo && k <= hi && d < bv) {
        bv = d;
        bk = k;
      }
    }
    const a = dv[bk - lo];
    const b = dv[bk - lo + 1];
    const cc = dv[bk - lo + 2];
    const den = a - 2 * b + cc;
    const P = bk + (den > 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - cc)) / den)) : 0);
    return this._heard(P);
  }

  _dip(from, to) {
    const cm = this.cm;
    let b = -1;
    let bv = Infinity;
    for (let t = Math.max(this.minTau, from); t <= Math.min(this.maxTau, to); t++) {
      if (cm[t] < bv) {
        bv = cm[t];
        b = t;
      }
    }
    return b;
  }

  /** A new reading: P samples per cycle, or 0 for no note. */
  _heard(P) {
    const was = this.voiced;
    if (!P) {
      // one missed reading in the middle of a note is ignored
      if (was && !this.missed && this.open) {
        this.missed = 1;
        return;
      }
      this.voiced = false;
      this.hist.length = 0;
      this.prevTau = 0;
      this.sung = null;
      this.target = null;
      this.note = null;
      this.oct = null;
      this.octNote = null;
      this.corr = 0;
      this.ratio = Math.pow(2, this.shift / 12);
      return;
    }
    this.missed = 0;
    const h = this.hist;
    h.push(P);
    if (h.length > 3) h.shift();
    const m = h.length < 3 ? P : h[0] + h[1] + h[2] - Math.min(h[0], h[1], h[2]) - Math.max(h[0], h[1], h[2]);
    this.P = m;
    this.voiced = true;
    const sung = 69 + 12 * Math.log2(this.sr / m / 440);
    this.sung = sung;
    let target = this.tune ? this._pick(sung) : sung;
    let speed = this.retune;
    if (this.v.mono) {
      // the robot voice: the first note of a phrase is held, flat, until the singer stops
      if (this.monoNote === null) this.monoNote = this.tune ? target : Math.round(sung);
      target = this.monoNote;
      speed = 0;
    }
    const jump = was && this.target !== null && Math.abs(target - this.target) > 1;
    this.target = target;
    const corr = Math.max(-12, Math.min(12, target - sung));
    const dt = this.hop / this.sr;
    if (!this.tune && !this.v.mono) this.corr = 0;
    else if (!speed) this.corr = corr;
    else {
      // a new note starts part of the way there (most of the way when it is far), then settles;
      // a jump to another note goes most of the way at once, so a big move doesn't swoop
      if (!was) this.corr = corr * (Math.abs(corr) > 1 ? 0.75 : 0.5);
      else if (jump) this.corr += (corr - this.corr) * 0.75;
      this.corr += (corr - this.corr) * (1 - Math.exp(-dt / speed));
    }
    let wob = 0;
    if (this.v.wobble) {
      this.lfo += 2 * Math.PI * 6.5 * dt;
      wob = this.v.wobble * Math.sin(this.lfo);
    }
    this.ratio = Math.pow(2, (this.corr + this.shift + wob) / 12);
  }

  /** Marks the next cycles of the voice, using only sound heard up to `limit`. */
  _marks(limit) {
    const x = this.x;
    for (;;) {
      const v = this.voiced;
      const P = v ? this.P : this.Pu;
      const Pi = Math.round(P);
      const r = v ? Math.max(2, Math.round(P * 0.08)) : 0;
      const h = Math.min(Math.round(P * 0.7), 400);
      let next = this.mark + Pi;
      if (next + r >= limit) return;
      if (limit - next > 3 * Pi + 512) {
        // fell behind (the start, or a pause in the sound thread): catch up
        this.mark = limit - 2 * Pi - 256;
        this.mc = 0;
        continue;
      }
      if (r) {
        // line the new cycle up with the one before (on the sound just before each, so no
        // waiting for what comes after), and lean towards the loudest point of the cycle (where
        // the voice "claps"), so every piece is cut around it
        const m0 = this.mark;
        let bc = -Infinity;
        let bk = next;
        let top = 1e-9;
        for (let k = next - r; k <= next + r; k++) top = Math.max(top, Math.abs(x[k & (N - 1)]));
        let e0 = 1e-9;
        for (let i = -h; i < 0; i += 2) e0 += x[(m0 + i) & (N - 1)] * x[(m0 + i) & (N - 1)];
        e0 = Math.sqrt(e0);
        for (let k = next - r; k <= next + r; k++) {
          let c = 0;
          let e = 1e-9;
          for (let i = -h; i < 0; i += 2) {
            const b = x[(k + i) & (N - 1)];
            c += x[(m0 + i) & (N - 1)] * b;
            e += b * b;
          }
          const s = c / (Math.sqrt(e) * e0) + (0.3 * Math.abs(x[k & (N - 1)])) / top;
          if (s > bc) {
            bc = s;
            bk = k;
          }
        }
        next = bk;
      }
      this.mark = next;
      this.markP = Pi;
      this.mPos[this.mc & 15] = next;
      this.mPer[this.mc & 15] = Pi;
      this.mc++;
    }
  }

  /** Starts a new piece of the voice at sample t. */
  _grain(t) {
    this._marks(t + 1);
    let g = -1;
    for (let k = 0; k < GRAINS; k++) {
      if (!this.gLen[k]) {
        g = k;
        break;
      }
    }
    const mc = this.mc;
    if (g < 0 || !mc) return;
    const f = this.form;
    const growl = this.v.growl || 0;
    this.gAmp[g] = growl && this.gCount++ & 1 ? 1 - growl : 1;
    this.gStep[g] = f;
    this.gN[g] = 0;
    if (this.voiced) {
      // two cycles from the newest cycle on: the second is still arriving, and is read just as
      // it comes in (a smaller mouth reads faster, so it starts a little further back)
      const ahead = f > 1 ? Math.ceil((2.3 * this.P * (f - 1)) / f) : 0;
      let c = mc - 1;
      while (c > mc - 16 && c > 0 && this.mPos[c & 15] > t - 2 - ahead) c--;
      const per = this.mPer[c & 15];
      if (this.mPos[c & 15] > t - 2 - ahead) return;
      this.gPos[g] = this.mPos[c & 15];
      this.gLen[g] = Math.max(8, Math.round((2 * per) / f));
    } else {
      // breath and "sss" have no cycles: read as it comes in
      const per = this.Pu;
      this.gPos[g] = t - 2 - (f > 1 ? Math.ceil(2 * per * (f - 1)) : 0);
      this.gLen[g] = 2 * per;
    }
  }

  /** One block of the microphone in, the tuned voice out (same length). */
  process(inp, out) {
    const n = out.length;
    const x = this.x;
    const y = this.y;
    const v = this.v;
    const k48 = this.k48;
    const fastK = 0.005 * k48;
    const pass = this.pass;
    if (this.auto && this.env) {
      this.want = Math.max(0.1, Math.min(MAX_BOOST, LEVEL / this.env));
    } else this.want = 1;
    const want = this.want;
    const vol = this.vol;
    const grit = v.grit || 0;
    const ringK = v.ring ? (2 * Math.PI * v.ring) / this.sr : 0;
    const E1 = Math.round(0.11 * this.sr);
    const E2 = Math.round(0.17 * this.sr);
    const E3 = Math.round(0.29 * this.sr);
    let D = 0;
    if (v.buzz && this.monoNote !== null) D = Math.min(CN - 1, Math.max(16, Math.round(this.sr / (440 * Math.pow(2, (this.monoNote + this.shift - 69) / 12)))));
    for (let i = 0; i < n; i++) {
      const s = inp ? inp[i] : 0;
      const hp = this.hpA * (this.hpY + s - this.hpX);
      this.hpX = s;
      this.hpY = hp;
      const t = this.w;
      x[t & (N - 1)] = hp;
      this.w = t + 1;
      this.fast += (hp * hp - this.fast) * fastK;
      this.dAcc += hp;
      if (++this.dN === this.D) {
        y[this.yw++ & (YN - 1)] = this.dAcc / this.D;
        this.dAcc = 0;
        this.dN = 0;
      }
      if (--this.toHop <= 0) {
        this.toHop = this.hop;
        this._detect();
        // every reading kept for the page (the scoring can use them: quicker than its own)
        if (this.rn < 64) this.reads[this.rn++] = this.voiced ? this.sung : NaN;
      }
      // a new piece is due
      if (t >= this.nextS) {
        this._grain(t);
        const step = this.voiced ? this.P / this.ratio : this.Pu;
        this.nextS = (this.nextS < t - 4096 ? t : this.nextS) + Math.max(16, step);
      }
      let o = 0;
      for (let k = 0; k < GRAINS; k++) {
        const len = this.gLen[k];
        if (!len) continue;
        const j = this.gN[k];
        const ph = (j * 1024) / len;
        const pi = ph | 0;
        const wv = HANN[pi] + (HANN[pi + 1] - HANN[pi]) * (ph - pi);
        const rp = this.gPos[k] + j * this.gStep[k];
        const ri = Math.floor(rp);
        const a0 = x[ri & (N - 1)];
        o += (a0 + (x[(ri + 1) & (N - 1)] - a0) * (rp - ri)) * wv * this.gAmp[k];
        if (j + 1 >= len) this.gLen[k] = 0;
        else this.gN[k] = j + 1;
      }
      // nothing to move: straight through (a short fade between the two ways)
      // breath, "sss" and "t" (no note in them) go straight through too, so they never buzz
      this.dry += ((pass || !this.voiced ? 1 : 0) - this.dry) * 0.004 * k48;
      if (this.dry > 0.999) o = hp;
      else if (this.dry > 0.001) o = o + (hp - o) * this.dry;
      // the gate opens quickly and closes gently; the automatic level moves smoothly
      const g = this.open ? 1 : 0;
      this.gain += (g - this.gain) * (g > this.gain ? 0.006 : 0.0004) * k48;
      this.boost += (want - this.boost) * (want < this.boost ? 0.002 : 0.0004) * k48;
      o *= this.gain * this.boost;
      // the extras
      if (grit) o = (o * (1 + grit * 0.45)) / (1 + grit * 3 * Math.abs(o)); // a little rasp on the loud parts
      if (D) {
        const cb = this.comb;
        const fb = cb[(this.cw - D) & (CN - 1)];
        const c = o + v.buzz * fb;
        cb[this.cw++ & (CN - 1)] = c;
        o = c * (1 - v.buzz);
      }
      if (ringK) {
        this.ringPh += ringK;
        if (this.ringPh > 6.283185307179586) this.ringPh -= 6.283185307179586;
        o = o * 0.6 + o * Math.sin(this.ringPh) * 0.9;
      }
      if (v.radio) {
        const z = this.bz;
        for (let q = 0; q < 2; q++) {
          const c = this.bq[q];
          const yq = c[0] * o + z[q * 2];
          z[q * 2] = c[1] * o - c[3] * yq + z[q * 2 + 1];
          z[q * 2 + 1] = c[2] * o - c[4] * yq;
          o = yq;
        }
        o = (o * 2.2) / (1 + 2 * Math.abs(o)); // crunchy, and about as loud as before
      }
      if (v.echo) {
        // an arena: three slaps off the far walls, the last one coming round again, a little duller
        const e = this.echo;
        const w = this.ew;
        this.eLp += (e[(w - E3) & (EN - 1)] - this.eLp) * 0.35;
        e[w & (EN - 1)] = o + this.eLp * 0.42;
        this.ew = w + 1;
        o = o * 0.85 + e[(w - E1) & (EN - 1)] * 0.22 + e[(w - E2) & (EN - 1)] * 0.18 + this.eLp * 0.45;
      }
      o *= vol;
      // never harsh: clean up to about 70 %, then a soft knee
      const a = o < 0 ? -o : o;
      if (a > 0.708) {
        const u = (a - 0.708) / 0.282;
        const k = 0.708 + 0.282 * (u / (1 + u));
        o = o < 0 ? -k : k;
      }
      out[i] = o;
    }
  }
}

/* ------------------------------------------------------------ sound thread -- */
if (typeof registerProcessor === 'function') {
  // one sound-thread block at a time to the sound engine (the shortest wait there can be)
  const CHUNK = 128;
  class StagehandAutoTune extends AudioWorkletProcessor {
    constructor() {
      super();
      this.at = new AutoTune(sampleRate);
      this.tmp = new Float32Array(128);
      this.out = null; // a line to the sound engine (the voice then goes out there, not here)
      this.relay = false;
      this.buf = new Float32Array(CHUNK * 2);
      this.n = 0;
      this.tick = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'set') this.at.set(m);
        else if (m.type === 'song') this.at.setSong(m.notes);
        else if (m.type === 'clock') this.at.setClock(m.t, m.rate);
        else if (m.type === 'port') {
          this.out = m.port || null;
          this.relay = false;
          this.n = 0;
        } else if (m.type === 'relay') {
          this.relay = !!m.on;
          this.n = 0;
        }
      };
    }

    process(inputs, outputs) {
      const inp = inputs[0] && inputs[0][0];
      const outL = outputs[0] && outputs[0][0];
      const len = outL ? outL.length : 128;
      if (this.tmp.length !== len) this.tmp = new Float32Array(len);
      const o = this.tmp;
      this.at.process(inp || null, o);
      const away = !!this.out || this.relay;
      if (outL) {
        for (let c = 0; c < outputs[0].length; c++) {
          if (away) outputs[0][c].fill(0);
          else outputs[0][c].set(o);
        }
      }
      if (away) {
        for (let i = 0; i < len; i++) {
          this.buf[this.n * 2] = this.buf[this.n * 2 + 1] = o[i];
          if (++this.n === CHUNK) {
            const d = this.buf;
            this.buf = new Float32Array(CHUNK * 2);
            this.n = 0;
            try {
              if (this.relay) this.port.postMessage({ type: 'voice', d });
              else this.out.postMessage({ t: 'voice', d });
            } catch (_) {
              this.out = null;
              this.relay = true;
            }
          }
        }
      }
      // every 20 ms, the notes read (one every 5 ms, NaN where there was none; the last one
      // was read about at time t, on the sound clock), for the scoring
      const a0 = this.at;
      if (a0.rn >= 4) {
        this.port.postMessage({ type: 'pitch', t: currentTime + len / sampleRate, hop: a0.hop / sampleRate, midi: a0.reads.slice(0, a0.rn), level: a0.level });
        a0.rn = 0;
      }
      // a few times a second, tell the page what is being sung and what it became
      if ((this.tick += len) >= sampleRate / 10) {
        this.tick = 0;
        const a = this.at;
        this.port.postMessage({ type: 'state', voiced: a.voiced, sung: a.sung, target: a.target, corr: a.corr, level: a.level, boost: a.boost, open: a.open });
      }
      return true;
    }
  }
  registerProcessor('stagehand-autotune', StagehandAutoTune);
}
