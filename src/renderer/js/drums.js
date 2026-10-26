/**
 * Drums & metronome: a click or a simple beat, synthesised on the page and
 * played on the same bus as the song (so it reaches the native engine too).
 */
import { engine } from './stage.js';

export const PATTERNS = [
  { id: 'click', name: 'Click', k: [], s: [], h: [], c: [0, 4, 8, 12] },
  { id: 'rock', name: 'Rock', k: [0, 8, 10], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14] },
  { id: 'shuffle', name: 'Shuffle', k: [0, 8, 11], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14], swing: true },
  { id: 'metal', name: 'Metal', k: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], s: [4, 12], h: [0, 4, 8, 12] },
  { id: 'half', name: 'Half-time', k: [0, 6], s: [8], h: [0, 2, 4, 6, 8, 10, 12, 14] },
];

function saved() {
  try {
    return JSON.parse(localStorage.getItem('stagehand.drums') || '{}') || {};
  } catch (_) {
    return {};
  }
}

function noise(n) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.random() * 2 - 1;
  return a;
}

function makeVoices(ctx) {
  const r = ctx.sampleRate;
  const buf = (secs, fn) => {
    const n = Math.round(secs * r);
    const b = ctx.createBuffer(1, n, r);
    const d = b.getChannelData(0);
    fn(d, n);
    return b;
  };
  const kick = buf(0.4, (d, n) => {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / r;
      const f = 45 + 110 * Math.exp(-t * 28);
      ph += (2 * Math.PI * f) / r;
      d[i] = Math.sin(ph) * Math.exp(-t * 9) * 0.95 + (i < 40 ? (Math.random() - 0.5) * 0.4 : 0);
    }
  });
  const snare = buf(0.25, (d, n) => {
    const z = noise(n);
    let lp = 0;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / r;
      lp += 0.55 * (z[i] - lp);
      const hp = z[i] - lp;
      ph += (2 * Math.PI * 190) / r;
      d[i] = (hp * 0.75 * Math.exp(-t * 18) + Math.sin(ph) * 0.45 * Math.exp(-t * 30)) * 0.8;
    }
  });
  const hat = buf(0.07, (d, n) => {
    const z = noise(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += 0.8 * (z[i] - lp);
      d[i] = (z[i] - lp) * Math.exp(-(i / r) * 60) * 0.45;
    }
  });
  const click = (hz) =>
    buf(0.03, (d, n) => {
      for (let i = 0; i < n; i++) d[i] = Math.sin((2 * Math.PI * hz * i) / r) * Math.exp(-(i / r) * 140) * 0.6;
    });
  return { kick, snare, hat, click: click(1000), accent: click(1600) };
}

class Drums extends EventTarget {
  constructor() {
    super();
    const s = saved();
    this.bpm = Math.max(40, Math.min(240, s.bpm || 100));
    this.pattern = PATTERNS.some((p) => p.id === s.pattern) ? s.pattern : 'rock';
    this.volume = s.volume ?? 0.7;
    this.on = false;
    this.ctx = null;
    this.out = null;
    this.gain = null;
    this.voices = null;
    this.timer = null;
    this.nextTime = 0;
    this.step = 0;
    this.startTime = 0;
    this.taps = [];
    engine.addEventListener('context', () => {
      // the song's audio context was replaced (new sample rate): pick the new one up
      if (this.on) this.start(true);
      else this.ctx = null;
    });
  }

  save() {
    try {
      localStorage.setItem('stagehand.drums', JSON.stringify({ bpm: this.bpm, pattern: this.pattern, volume: this.volume }));
    } catch (_) {}
  }

  get pat() {
    return PATTERNS.find((p) => p.id === this.pattern) || PATTERNS[0];
  }

  /** Seconds per bar of 4 beats. */
  get barSeconds() {
    return (60 / this.bpm) * 4;
  }

  async _ensure() {
    const { ctx, node } = await engine.extraOut();
    if (this.ctx !== ctx) {
      this.ctx = ctx;
      this.voices = makeVoices(ctx);
      this.gain = ctx.createGain();
      this.gain.connect(node);
    }
    this.gain.gain.value = this.volume * this.volume;
  }

  async start(restart = false) {
    await this._ensure();
    if (this.on && !restart) return;
    clearInterval(this.timer);
    this.on = true;
    this.step = 0;
    this.startTime = this.ctx.currentTime + 0.08;
    this.nextTime = this.startTime;
    this.timer = setInterval(() => this._schedule(), 25);
    this._schedule();
    this.dispatchEvent(new Event('change'));
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.on = false;
    this.dispatchEvent(new Event('change'));
  }

  toggle() {
    return this.on ? this.stop() : this.start();
  }

  setBpm(v) {
    this.bpm = Math.round(Math.max(40, Math.min(240, Number(v) || 100)));
    this.save();
    this.dispatchEvent(new Event('change'));
  }

  setPattern(id) {
    this.pattern = id;
    this.save();
    this.dispatchEvent(new Event('change'));
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v)));
    if (this.gain) this.gain.gain.value = this.volume * this.volume;
    this.save();
  }

  /** Tap tempo: average of the last few taps. */
  tap() {
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 2500);
    this.taps.push(now);
    if (this.taps.length >= 2) {
      const d = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      this.setBpm(60000 / d);
    }
  }

  _hit(buf, when, g = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    if (g !== 1) {
      const gg = this.ctx.createGain();
      gg.gain.value = g;
      s.connect(gg);
      gg.connect(this.gain);
    } else s.connect(this.gain);
    s.start(when);
  }

  _schedule() {
    if (!this.on || !this.ctx) return;
    const ahead = this.ctx.currentTime + 0.14;
    const sd = 60 / this.bpm / 4;
    while (this.nextTime < ahead) {
      const i = this.step % 16;
      const p = this.pat;
      const swing = p.swing && i % 4 === 2 ? sd * 0.66 : 0;
      const t = this.nextTime + swing;
      if ((p.k || []).includes(i)) this._hit(this.voices.kick, t);
      if ((p.s || []).includes(i)) this._hit(this.voices.snare, t);
      if ((p.h || []).includes(i)) this._hit(this.voices.hat, t, i % 4 === 0 ? 1 : 0.7);
      if ((p.c || []).includes(i)) this._hit(i === 0 ? this.voices.accent : this.voices.click, t);
      this.nextTime += sd;
      this.step++;
    }
  }

  /** Which 16th of the bar is sounding now (for the lights), or -1. */
  currentStep() {
    if (!this.on || !this.ctx) return -1;
    const lat = (this.ctx.outputLatency || 0) + (engine.extraLatency || 0);
    const t = this.ctx.currentTime - lat - this.startTime;
    if (t < 0) return -1;
    return Math.floor(t / (60 / this.bpm / 4)) % 16;
  }

  /** ctx time of the next bar line (for the looper), or null. */
  nextBarTime(after) {
    if (!this.on || !this.ctx) return null;
    const bar = this.barSeconds;
    const n = Math.ceil((after - this.startTime) / bar - 1e-6);
    return this.startTime + Math.max(0, n) * bar;
  }

  /** A one-bar count-in (clicks only), resolving when it ends. */
  async countIn(beats = 4) {
    await this._ensure();
    const t0 = this.ctx.currentTime + 0.06;
    const b = 60 / this.bpm;
    for (let i = 0; i < beats; i++) this._hit(i === 0 ? this.voices.accent : this.voices.click, t0 + i * b);
    const ms = (beats * b + 0.06 + (this.ctx.outputLatency || 0) + (engine.extraLatency || 0)) * 1000;
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const drums = new Drums();
