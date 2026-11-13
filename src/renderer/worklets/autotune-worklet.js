/* Auto-tune for the singer's microphone (4.17).
 *
 * The same idea as the studio effect: hear the note being sung, pick the note
 * it should be, and move the voice there. How fast it moves is the style:
 * slowly sounds natural, at once is the famous robot voice.
 *
 * How the voice is moved: it is cut into short pieces, one per cycle of the
 * voice, and the pieces are laid down again closer together (higher) or
 * further apart (lower). The voice keeps its own character, only the note
 * changes, and it costs a few thousandths of a second.
 *
 * AutoTune is plain maths (tested in test/autotune.test.mjs); the processor at
 * the bottom runs it on the sound thread.
 */

const MIN_HZ = 75;
const MAX_HZ = 1000;
/** Seconds the voice takes to reach the note. */
export const TUNE_STYLES = { natural: 0.11, pop: 0.03, robot: 0 };
/**
 * Voice changer: [notes moved, size of the "mouth"]. The note only ever moves by whole
 * octaves, so a changed voice still fits the song; the mouth makes it sound like a
 * bigger or smaller person (under 1 = bigger and darker, over 1 = smaller and brighter).
 */
export const VOICES = { normal: [0, 1], deep: [0, 0.8], giant: [-12, 0.72], high: [0, 1.22], chipmunk: [12, 1.4] };
const HANN = (() => {
  const t = new Float32Array(1025);
  for (let i = 0; i <= 1024; i++) t[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 1024);
  return t;
})();
const N = 16384; // the voice kept (a third of a second)
const YN = 4096;
const GRAINS = 12;

export class AutoTune {
  constructor(sampleRate) {
    const sr = (this.sr = sampleRate);
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
    this.sung = null; // the note sung (midi, with fractions)
    this.target = null; // the note it is moved to
    this.note = null;
    this.corr = 0; // how far the voice is being moved now (semitones)
    this.ratio = 1;
    // the pieces
    this.Pu = Math.round(sr * 0.004);
    this.mark = 0; // the newest cycle marked
    this.markP = this.Pu;
    this.mPos = new Int32Array(16); // the last few cycles: where, and how long
    this.mPer = new Int32Array(16);
    this.mc = 0; // cycles marked so far
    this.used = -1; // the cycle the last piece was cut from
    this.nextS = 0;
    this.gPos = new Float64Array(GRAINS); // where the piece is read from
    this.gN = new Int32Array(GRAINS);
    this.gLen = new Int32Array(GRAINS); // how long it plays
    this.gStep = new Float32Array(GRAINS); // how fast it is read (the voice changer)
    this.gain = 0; // the gate: closed when nobody sings, so the room isn't played back
    // settings
    this.retune = TUNE_STYLES.natural;
    this.tune = true; // off: the voice is left on the notes it sings (voice changer only)
    this.shift = 0;
    this.form = 1;
    this.mode = 'near';
    this.vol = 1;
    this.mask = new Uint8Array(12).fill(1);
    this.song = null; // { t, e, p } arrays
    this.songT = 0;
    this.songRate = 0;
    this.songW = 0;
    // input clean-up (rumble)
    this.hpA = Math.exp((-2 * Math.PI * 60) / sr);
    this.hpX = 0;
    this.hpY = 0;
  }

  /**
   * style: natural | pop | robot, or off (no tuning); mode: 'song' (the song's notes) | 'near'
   * (the nearest note); voice: normal | deep | giant | high | chipmunk; vol 0…1.5
   */
  set({ style, mode, vol, voice } = {}) {
    if (style !== undefined) {
      this.tune = TUNE_STYLES[style] !== undefined;
      if (this.tune) this.retune = TUNE_STYLES[style];
    }
    if (voice !== undefined) [this.shift, this.form] = VOICES[voice] || VOICES.normal;
    if (mode !== undefined) this.mode = mode === 'song' ? 'song' : 'near';
    if (vol !== undefined) this.vol = Math.max(0, Math.min(1.5, Number(vol) || 0));
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
      return sn + 12 * Math.round((sung - sn) / 12); // in the singer's own octave
    }
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
    // stay on the note you're on until you are clearly nearer another (no flicker between two)
    if (this.note !== null && this.mask[((this.note % 12) + 12) % 12] && Math.abs(v - this.note) < bd + 0.2) best = this.note;
    this.note = best;
    return best + off;
  }

  /** Finds the note in the latest sound: sets voiced, P, level. */
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
    this.level = Math.sqrt(e / need);
    this.open = this.level > (this.open ? 0.0045 : 0.007);
    if (!this.open) return this._heard(0);
    let run = 0;
    cm[0] = 1;
    for (let tau = 1; tau <= maxTau; tau++) {
      let d = 0;
      for (let i = 0; i < Wd; i++) {
        const v = fr[i] - fr[i + tau];
        d += v * v;
      }
      run += d;
      cm[tau] = run ? (d * tau) / run : 1;
    }
    const dip = (from, to) => {
      let b = -1;
      let bv = Infinity;
      for (let t = Math.max(minTau, from); t <= Math.min(maxTau, to); t++) {
        if (cm[t] < bv) {
          bv = cm[t];
          b = t;
        }
      }
      return b;
    };
    let tau = -1;
    for (let t = minTau; t <= maxTau; t++) {
      if (cm[t] < 0.18) {
        while (t + 1 <= maxTau && cm[t + 1] < cm[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      tau = dip(minTau, maxTau);
      if (tau < 0 || cm[tau] > 0.4) tau = -1;
    }
    // an octave slip (the reader, not the singer): the note we were on still fits better
    if (this.prevTau) {
      const near = dip(Math.floor(this.prevTau * 0.85), Math.ceil(this.prevTau * 1.18));
      if (near > 0) {
        if (tau < 0 && cm[near] < 0.45) tau = near;
        else if (tau > 0 && tau < this.prevTau * 0.7 && cm[near] < cm[tau] * 0.4) tau = near;
        else if (tau > this.prevTau * 1.5 && cm[near] < 0.35) tau = near;
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
    const target = this.tune ? this._pick(sung) : sung;
    this.target = target;
    const corr = Math.max(-7, Math.min(7, target - sung));
    const dt = this.hop / this.sr;
    if (!this.retune) this.corr = corr;
    else if (!was) this.corr = corr * 0.5; // a new note starts halfway there, then settles
    else this.corr += (corr - this.corr) * (1 - Math.exp(-dt / this.retune));
    this.ratio = Math.pow(2, (this.corr + this.shift) / 12);
  }

  /** Marks the next cycles of the voice, using only sound heard up to `limit`. */
  _marks(limit) {
    const x = this.x;
    for (;;) {
      const v = this.voiced;
      const P = v ? this.P : this.Pu;
      const Pi = Math.round(P);
      const r = v ? Math.max(2, Math.round(P * 0.08)) : 0;
      const h = Math.min(Math.round(P * 0.35), 200);
      let next = this.mark + Pi;
      if (next + r + h >= limit) return;
      if (limit - next > 3 * Pi + 512) {
        // fell behind (the start, or a pause in the sound thread): catch up
        this.mark = limit - 2 * Pi - 256;
        this.mc = 0;
        this.used = -1;
        continue;
      }
      if (r) {
        // line the new cycle up with the one before, so the pieces match
        // …and lean towards the loudest point of the cycle (where the voice "claps"), so every
        // piece is cut around it: the voice changer stretches or squeezes each piece from there
        const m0 = this.mark;
        let bc = -Infinity;
        let bk = next;
        let top = 1e-9;
        for (let k = next - r; k <= next + r; k++) top = Math.max(top, Math.abs(x[k & (N - 1)]));
        let e0 = 1e-9;
        for (let i = -h; i < h; i += 2) e0 += x[(m0 + i) & (N - 1)] * x[(m0 + i) & (N - 1)];
        e0 = Math.sqrt(e0);
        for (let k = next - r; k <= next + r; k++) {
          let c = 0;
          let e = 1e-9;
          for (let i = -h; i < h; i += 2) {
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

  /** One block of the microphone in, the tuned voice out (same length). */
  process(inp, out) {
    const n = out.length;
    const x = this.x;
    const y = this.y;
    for (let i = 0; i < n; i++) {
      const s = inp ? inp[i] : 0;
      const hp = this.hpA * (this.hpY + s - this.hpX);
      this.hpX = s;
      this.hpY = hp;
      const t = this.w;
      x[t & (N - 1)] = hp;
      this.w = t + 1;
      this.dAcc += hp;
      if (++this.dN === this.D) {
        y[this.yw++ & (YN - 1)] = this.dAcc / this.D;
        this.dAcc = 0;
        this.dN = 0;
      }
      if (--this.toHop <= 0) {
        this.toHop = this.hop;
        this._detect();
      }
      // a new piece is due
      if (t >= this.nextS) {
        this._marks(t + 1);
        let g = -1;
        for (let k = 0; k < GRAINS; k++) {
          if (!this.gLen[k]) {
            g = k;
            break;
          }
        }
        // which cycle to cut: the one after the last, so the voice runs on smoothly. Going
        // up, cycles run out and one is used twice; going down, we fall behind and skip one.
        const mc = this.mc;
        if (g >= 0 && mc) {
          let c = this.used + 1;
          if (c >= mc) c = mc - 1;
          else {
            if (c < mc - 12) c = mc - 2;
            const newest = this.mPos[(mc - 1) & 15];
            while (c < mc - 1 && newest - this.mPos[c & 15] > 1.25 * this.mPer[c & 15]) c++;
          }
          this.used = c;
          const per = this.mPer[c & 15];
          // two cycles of the voice, read faster (a smaller mouth) or slower (a bigger one).
          // Breath and "sss" have no cycles: the same length out, more or less of it read.
          const f = this.form;
          if (this.voiced) {
            this.gPos[g] = this.mPos[c & 15] - per;
            this.gLen[g] = Math.max(8, Math.round((2 * per) / f));
          } else {
            this.gPos[g] = this.mPos[c & 15] - per * Math.min(f, 1.6);
            this.gLen[g] = 2 * per;
          }
          this.gStep[g] = f;
          this.gN[g] = 0;
        }
        const step = (this.voiced ? this.P : this.Pu) / (this.voiced ? this.ratio : 1);
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
        o += (a0 + (x[(ri + 1) & (N - 1)] - a0) * (rp - ri)) * wv;
        if (j + 1 >= len) this.gLen[k] = 0;
        else this.gN[k] = j + 1;
      }
      // the gate opens quickly and closes gently
      const want = this.open ? 1 : 0;
      this.gain += (want - this.gain) * (want > this.gain ? 0.004 : 0.0004) * (48000 / this.sr);
      o *= this.gain * this.vol;
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
  const CHUNK = 256;
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
      // a few times a second, tell the page what is being sung and what it became
      if ((this.tick += len) >= sampleRate / 10) {
        this.tick = 0;
        const a = this.at;
        this.port.postMessage({ type: 'state', voiced: a.voiced, sung: a.sung, target: a.target, corr: a.corr, level: a.level });
      }
      return true;
    }
  }
  registerProcessor('stagehand-autotune', StagehandAutoTune);
}
