/* Sample-accurate multitrack player. Each track is 16-bit PCM held in memory
 * and rendered to its own output, so every stem stays locked to the same
 * frame counter. Gains, meters and mixing happen in the main audio graph. */
const MAX_TRACKS = 8;
// Practice speed: WSOLA time-stretch (pitch stays put). Grains are aligned on
// the original mix and the same cut is applied to every stem, so they stay locked.
// Slower (down to 25%) and faster (up to 150%) both work the same way: grains
// are always written HS apart; they are read HS × speed apart.
const MIN_SPEED = 0.25;
const MAX_SPEED = 1.5;
const N = 2048;
const HS = N / 2;
const TOL = 384;
const HANN = new Float32Array(N);
for (let k = 0; k < N; k++) HANN[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N);

class StagehandPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tracks = new Array(MAX_TRACKS).fill(null);
    this.length = 0;
    this.pos = 0;
    this.playing = false;
    this.loop = null;
    this.idx = new Int32Array(128);
    this.quanta = 0;
    this.speed = 1;
    this.st = null;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    switch (m.type) {
      case 'load':
        this.tracks[m.index] = {
          data: new Int16Array(m.buffer, m.byteOffset, m.frames * m.channels),
          ch: m.channels,
          frames: m.frames,
        };
        if (m.setLength) this.length = m.frames;
        this.port.postMessage({ type: 'loaded', index: m.index });
        break;
      case 'unload':
        if (m.index === undefined || m.index === null) this.tracks.fill(null);
        else this.tracks[m.index] = null;
        break;
      case 'length':
        this.length = m.frames;
        if (this.pos > this.length) this.pos = this.length;
        break;
      case 'speed': {
        // keep the stretcher's state so a speed change mid-play doesn't click
        // (back at 100% it carries on stretching by 1, which changes nothing,
        // until the next seek or play)
        this.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, Number(m.speed) || 1));
        this.report();
        break;
      }
      case 'play':
        if (this.pos >= this.length) this.pos = this.loop ? this.loop.start : 0;
        this.st = null;
        this.playing = true;
        this.report();
        break;
      case 'pause':
        this.playing = false;
        this.report();
        break;
      case 'seek':
        this.pos = Math.max(0, Math.min(this.length, Math.floor(m.frame)));
        this.st = null;
        this.report();
        break;
      case 'loop':
        this.loop = m.loop && m.loop.end > m.loop.start ? { start: Math.floor(m.loop.start), end: Math.floor(m.loop.end) } : null;
        break;
      default:
        break;
    }
  }

  report() {
    this.port.postMessage({ type: 'pos', frame: this.pos, time: currentTime, playing: this.playing, speed: this.speed });
  }

  /** A position for reports: past the loop's end it is back inside the loop. */
  inLoop(f) {
    const loop = this.loop;
    if (loop && f >= loop.end) f = loop.start + ((f - loop.end) % (loop.end - loop.start));
    return f;
  }

  /** Source frame for a (possibly looped) offset, or -1 past the end. */
  wrap(f) {
    const loop = this.loop;
    if (loop && f >= loop.end) f = loop.start + ((f - loop.end) % (loop.end - loop.start));
    return f >= 0 && f < this.length ? f : -1;
  }

  mono(f) {
    const tr = this.tracks[0];
    f = this.wrap(f);
    if (!tr || f < 0 || f >= tr.frames) return 0;
    return tr.ch > 1 ? tr.data[f * 2] + tr.data[f * 2 + 1] : tr.data[f];
  }

  /** Builds the next HS output frames of every track. */
  synth() {
    const st = this.st;
    const target = Math.floor(st.src);
    let start = target;
    if (st.prev >= 0 && this.tracks[0]) {
      const natural = st.prev + HS;
      // coarse search, then refine to the exact sample so grains join in phase
      const score = (d, step) => {
        let c = 0;
        let e = 1;
        for (let k = 0; k < HS; k += step) {
          const y = this.mono(target + d + k);
          c += this.mono(natural + k) * y;
          e += y * y;
        }
        return c / Math.sqrt(e);
      };
      let best = -Infinity;
      let bd = 0;
      for (let d = -TOL; d <= TOL; d += 4) {
        const v = score(d, 8);
        if (v > best) {
          best = v;
          bd = d;
        }
      }
      best = -Infinity;
      let fd = bd;
      for (let d = bd - 3; d <= bd + 3; d++) {
        const v = score(d, 2);
        if (v > best) {
          best = v;
          fd = d;
        }
      }
      start = target + fd;
    }
    for (let t = 0; t < MAX_TRACKS; t++) {
      const tr = this.tracks[t];
      const acc = st.acc[t];
      if (!tr) {
        acc.L.fill(0);
        acc.R.fill(0);
        st.out[t].L.fill(0);
        st.out[t].R.fill(0);
        continue;
      }
      const d = tr.data;
      const ch = tr.ch;
      for (let k = 0; k < N; k++) {
        const f = this.wrap(start + k);
        if (f < 0 || f >= tr.frames) continue;
        const o = f * ch;
        const l = d[o] * 3.0517578125e-5;
        acc.L[k] += HANN[k] * l;
        acc.R[k] += HANN[k] * (ch > 1 ? d[o + 1] * 3.0517578125e-5 : l);
      }
      st.out[t].L.set(acc.L.subarray(0, HS));
      st.out[t].R.set(acc.R.subarray(0, HS));
      acc.L.copyWithin(0, HS);
      acc.R.copyWithin(0, HS);
      acc.L.fill(0, N - HS);
      acc.R.fill(0, N - HS);
    }
    st.outFrame = start;
    st.prev = start;
    st.src = this.inLoop(st.src + HS * this.speed);
    st.outPos = 0;
  }

  /**
   * Starts the stretcher as if a grain had begun HS frames earlier: its tail
   * is already in the overlap, so the first grain joins it at full level. The
   * stretch starts without a fade-in, seamlessly from plain playback.
   */
  prime(st) {
    for (let t = 0; t < MAX_TRACKS; t++) {
      const tr = this.tracks[t];
      if (!tr) continue;
      const acc = st.acc[t];
      for (let k = 0; k < HS; k++) {
        const f = this.wrap(this.pos + k);
        if (f < 0 || f >= tr.frames) continue;
        const o = f * tr.ch;
        const l = tr.data[o] * 3.0517578125e-5;
        acc.L[k] = HANN[HS + k] * l;
        acc.R[k] = HANN[HS + k] * (tr.ch > 1 ? tr.data[o + 1] * 3.0517578125e-5 : l);
      }
    }
  }

  processStretched(outputs, n) {
    if (!this.st) {
      const mk = (len) => Array.from({ length: MAX_TRACKS }, () => ({ L: new Float32Array(len), R: new Float32Array(len) }));
      this.st = { src: this.pos, prev: this.pos - HS, acc: mk(N), out: mk(HS), outPos: HS, outFrame: this.pos };
      this.prime(this.st);
    }
    const st = this.st;
    const startFrame = st.outPos < HS ? st.outFrame + st.outPos * this.speed : st.src;
    for (let k = 0; k < n; k++) {
      if (st.outPos >= HS) this.synth();
      for (let t = 0; t < MAX_TRACKS; t++) {
        const out = outputs[t];
        if (!out || !out.length) continue;
        out[0][k] = st.out[t].L[st.outPos];
        if (out.length > 1) out[1][k] = st.out[t].R[st.outPos];
      }
      st.outPos++;
    }
    this.pos = Math.min(this.length, Math.round(this.inLoop(st.outFrame + st.outPos * this.speed)));
    if ((this.quanta++ & 3) === 0) this.port.postMessage({ type: 'pos', frame: Math.min(this.length, Math.round(this.inLoop(startFrame))), time: currentTime, playing: true, speed: this.speed });
    if (!this.loop && st.outFrame >= this.length) {
      this.playing = false;
      this.pos = this.length;
      this.st = null;
      this.port.postMessage({ type: 'ended', frame: this.pos, time: currentTime + n / sampleRate });
    }
    return true;
  }

  process(_inputs, outputs) {
    if (!this.playing) return true;
    if (this.speed !== 1 || this.st) return this.processStretched(outputs, outputs[0][0].length);
    const n = outputs[0][0].length;
    const idx = this.idx.length === n ? this.idx : (this.idx = new Int32Array(n));
    const loop = this.loop;
    let p = this.pos;
    const start = p;
    for (let k = 0; k < n; k++) {
      if (loop && p >= loop.end) p = loop.start;
      idx[k] = p < this.length ? p : -1;
      p++;
    }
    for (let t = 0; t < MAX_TRACKS; t++) {
      const tr = this.tracks[t];
      const out = outputs[t];
      if (!tr || !out || !out.length) continue;
      const L = out[0];
      const R = out.length > 1 ? out[1] : null;
      const d = tr.data;
      const ch = tr.ch;
      const frames = tr.frames;
      for (let k = 0; k < n; k++) {
        const f = idx[k];
        if (f < 0 || f >= frames) {
          L[k] = 0;
          if (R) R[k] = 0;
          continue;
        }
        const o = f * ch;
        const l = d[o] * 3.0517578125e-5;
        L[k] = l;
        if (R) R[k] = ch > 1 ? d[o + 1] * 3.0517578125e-5 : l;
      }
    }
    this.pos = p;
    if ((this.quanta++ & 3) === 0) this.port.postMessage({ type: 'pos', frame: start, time: currentTime, playing: true, speed: 1 });
    if (!loop && this.pos >= this.length) {
      this.playing = false;
      this.pos = this.length;
      this.port.postMessage({ type: 'ended', frame: this.pos, time: currentTime + n / sampleRate });
    }
    return true;
  }
}

registerProcessor('stagehand-player', StagehandPlayer);
