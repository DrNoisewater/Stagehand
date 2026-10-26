/**
 * Recording your guitar: the looper (record, overdub, clear; locks to the
 * drum beat when it runs) and takes (Record take in Now playing).
 *
 * What's recorded is the dry guitar from the cable; it's then run through
 * the tone you were playing (the same amp engine, off the live path), so the
 * result sounds like what you heard and the live sound isn't touched.
 */
import { api } from './api.js';
import { rig } from './rig.js';
import { engine } from './stage.js';
import { drums } from './drums.js';
import { renderTone } from './render.js';
import { toast } from './ui.js';

/** Collects the dry guitar while it runs. */
export class DiRecorder {
  constructor() {
    this.chunks = [];
    this.n = 0;
    this.on = false;
    this.fn = (d) => {
      if (!this.on) return;
      this.chunks.push(d.slice ? d.slice() : new Float32Array(d));
      this.n += d.length;
    };
  }
  start() {
    this.chunks = [];
    this.n = 0;
    this.on = true;
    rig.addInputTap(this.fn);
  }
  stop() {
    this.on = false;
    rig.removeInputTap(this.fn);
    const out = new Float32Array(this.n);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.length;
    }
    this.chunks = [];
    return out;
  }
  get seconds() {
    return this.n / (rig.sampleRate || 48000);
  }
}

/** How late the recorded guitar is compared with what you heard (seconds). */
function lateBy() {
  return ((rig.latencyMs || 12) / 1000) * 0.5 + (engine.extraLatency || 0) * 0.5;
}

async function throughTone(di) {
  const tone = rig.tone;
  const knobs = { ...rig.knobs, volume: Math.max(0.35, rig.knobs.volume ?? 0.7) };
  return renderTone(tone, di, rig.sampleRate || 48000, knobs);
}

function interleave(L, R) {
  const o = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    o[i * 2] = L[i];
    o[i * 2 + 1] = R[i];
  }
  return o;
}

export async function saveTake({ name, songId = null, L, R, rate, bpm = null }) {
  const pcm = interleave(L, R);
  return api.takes.save({ name, songId, seconds: L.length / rate, bpm, rate, channels: 2, pcm: new Uint8Array(pcm.buffer) });
}

// ================================================================ looper
class Looper extends EventTarget {
  constructor() {
    super();
    this.state = 'empty'; // empty | armed | recording | busy | playing | overdub
    this.buffer = null; // AudioBuffer (stereo)
    this.L = null;
    this.R = null;
    this.rate = 48000;
    this.src = null;
    this.gain = null;
    this.ctx = null;
    this.loopStart = 0; // ctx time the loop started playing
    this.layers = 0;
    this.bpm = null;
    this.rec = new DiRecorder();
    this._t = null;
    engine.addEventListener('context', () => {
      this._stopSource();
      this.ctx = null;
      if (this.buffer) this._play();
    });
  }

  _set(s) {
    this.state = s;
    this.dispatchEvent(new Event('change'));
  }

  get length() {
    return this.L ? this.L.length / this.rate : 0;
  }

  /** 0–1 position in the loop now (for drawing), or null. */
  position() {
    if (!this.src || !this.ctx || !this.length) return null;
    const lat = (this.ctx.outputLatency || 0) + (engine.extraLatency || 0);
    const t = this.ctx.currentTime - lat - this.loopStart;
    if (t < 0) return 0;
    return (t % this.length) / this.length;
  }

  async _out() {
    const { ctx, node } = await engine.extraOut();
    if (this.ctx !== ctx) {
      this.ctx = ctx;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0.9;
      this.gain.connect(node);
    }
    return ctx;
  }

  _stopSource(when) {
    if (!this.src) return;
    try {
      this.src.stop(when);
    } catch (_) {}
    this.src = null;
  }

  async _play(at) {
    const ctx = await this._out();
    const b = ctx.createBuffer(2, this.L.length, this.rate);
    b.copyToChannel(this.L, 0);
    b.copyToChannel(this.R, 1);
    this.buffer = b;
    const when = at ?? ctx.currentTime + 0.03;
    this._stopSource(when);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.connect(this.gain);
    s.start(when);
    this.src = s;
    if (at === undefined || !this.loopStart) this.loopStart = when;
  }

  /** Record (first layer). With the drums running it starts and ends on bar lines. */
  async record() {
    if (!rig.on) {
      toast({ title: 'Plug in your guitar first', message: 'The looper records what you play through the Rocksmith cable.', kind: 'info' });
      return;
    }
    if (this.state === 'recording') return this.stopRecording();
    if (this.state !== 'empty') this.clear();
    const ctx = await this._out();
    this.bpm = drums.on ? drums.bpm : null;
    const startAt = drums.on ? drums.nextBarTime(ctx.currentTime + 0.05) : ctx.currentTime;
    this._set(drums.on ? 'armed' : 'recording');
    this.recStartAt = startAt;
    const begin = () => {
      this.rec.start();
      this._set('recording');
    };
    const wait = Math.max(0, (startAt - ctx.currentTime + lateBy()) * 1000);
    clearTimeout(this._t);
    if (wait > 5) this._t = setTimeout(begin, wait);
    else begin();
  }

  async stopRecording() {
    if (this.state !== 'recording' && this.state !== 'armed') return;
    const ctx = this.ctx;
    const rate = rig.sampleRate || 48000;
    let bars = null;
    if (this.bpm && drums.on && ctx) {
      // end on the next bar line, at least one bar long
      const bar = drums.barSeconds;
      const elapsed = ctx.currentTime - this.recStartAt;
      bars = Math.max(1, Math.ceil(elapsed / bar - 0.15));
      const endAt = this.recStartAt + bars * bar;
      const wait = Math.max(0, (endAt - ctx.currentTime + lateBy()) * 1000);
      await new Promise((r) => setTimeout(r, wait));
    }
    clearTimeout(this._t);
    let di = this.rec.stop();
    if (di.length < rate * 0.3) {
      this._set('empty');
      toast({ title: 'Nothing recorded', message: 'Play a little longer before stopping.', kind: 'info' });
      return;
    }
    if (bars) {
      const want = Math.round(bars * drums.barSeconds * rate);
      const fixed = new Float32Array(want);
      fixed.set(di.subarray(0, want));
      di = fixed;
    }
    this._set('busy');
    try {
      const { L, R } = await throughTone(di);
      this.rate = rate;
      this.L = L;
      this.R = R;
      this.layers = 1;
      this.loopStart = 0;
      const at = this.bpm && drums.on ? drums.nextBarTime(this.ctx.currentTime + 0.02) : undefined;
      await this._play(at);
      this._set('playing');
    } catch (err) {
      this._set('empty');
      toast({ title: 'The loop couldn’t be made', message: err.message, kind: 'err' });
    }
  }

  /** Records one more pass on top, lined up with the loop. */
  async overdub() {
    if (this.state === 'overdub') return;
    if (!this.L || !this.src) return this.record();
    if (!rig.on) return;
    const ctx = this.ctx;
    const len = this.length;
    const k = Math.ceil((ctx.currentTime + 0.05 - this.loopStart) / len);
    const startAt = this.loopStart + k * len;
    this._set('overdub');
    const wait = Math.max(0, (startAt - ctx.currentTime + lateBy()) * 1000);
    await new Promise((r) => setTimeout(r, wait));
    this.rec.start();
    await new Promise((r) => setTimeout(r, len * 1000 + 30));
    let di = this.rec.stop();
    const want = this.L.length;
    if (di.length !== want) {
      const f = new Float32Array(want);
      f.set(di.subarray(0, want));
      di = f;
    }
    this._set('busy');
    try {
      const { L, R } = await throughTone(di);
      for (let i = 0; i < want; i++) {
        this.L[i] += L[i];
        this.R[i] += R[i];
      }
      this.layers++;
      // swap in the new loop on the next loop boundary so nothing jumps
      const next = this.loopStart + Math.ceil((this.ctx.currentTime + 0.05 - this.loopStart) / len) * len;
      await this._play(next);
      this._set('playing');
    } catch (err) {
      this._set('playing');
      toast({ title: 'Overdub failed', message: err.message, kind: 'err' });
    }
  }

  clear() {
    clearTimeout(this._t);
    if (this.rec.on) this.rec.stop();
    this._stopSource();
    this.L = this.R = this.buffer = null;
    this.layers = 0;
    this.loopStart = 0;
    this._set('empty');
  }

  async saveAsTake() {
    if (!this.L) return null;
    const t = await saveTake({ name: `Loop${this.bpm ? ` at ${this.bpm} BPM` : ''}`, L: this.L, R: this.R, rate: this.rate, bpm: this.bpm });
    toast({ title: 'Loop saved to your takes', message: 'Find it in Progress.', kind: 'ok' });
    return t;
  }
}

export const looper = new Looper();
