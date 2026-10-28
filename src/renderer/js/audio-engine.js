/**
 * Renderer-side audio engine: one AudioWorklet streams every track from
 * memory on a shared frame counter; each track gets its own gain and meter.
 *
 * Track 0 is the original mix; tracks 1.. are stems.
 */
export const STEM_ORDER = ['guitar', 'bass', 'drums', 'vocals', 'piano', 'other'];
const MAX_TRACKS = 8;

export function parseWav(buffer) {
  const dv = new DataView(buffer);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let p = 12;
  let fmt = null;
  while (p + 8 <= buffer.byteLength) {
    const id = tag(p);
    const size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') {
      fmt = { format: dv.getUint16(p + 8, true), channels: dv.getUint16(p + 10, true), sampleRate: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('Bad WAV');
      if (fmt.bits !== 16) throw new Error('Only 16-bit WAV is supported');
      const dataSize = Math.min(size, buffer.byteLength - (p + 8));
      return { ...fmt, dataOffset: p + 8, frames: Math.floor(dataSize / (2 * fmt.channels)) };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('WAV has no data');
}

let peaksWorker = null;
let peaksSeq = 0;
const peaksWaiting = new Map();
function computePeaks(buffer, wav) {
  if (!peaksWorker) {
    // (also turns decoded floats into the player's 16-bit WAV layout, off the page)
    peaksWorker = new Worker(new URL('../workers/peaks-worker.js', import.meta.url));
    peaksWorker.onmessage = (e) => {
      const w = peaksWaiting.get(e.data.id);
      if (w) {
        peaksWaiting.delete(e.data.id);
        w(e.data);
      }
    };
  }
  const id = ++peaksSeq;
  return new Promise((resolve) => {
    peaksWaiting.set(id, resolve);
    if (wav.L) peaksWorker.postMessage({ id, L: wav.L, R: wav.R, rate: wav.rate }, [wav.L.buffer, wav.R.buffer]);
    else peaksWorker.postMessage({ id, buffer, dataOffset: wav.dataOffset, frames: wav.frames, channels: wav.channels }, [buffer]);
  });
}

export async function loadTrackData(url, signal, { rate, frames } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not load audio (${res.status})`);
  let buffer = await res.arrayBuffer();
  let out;
  let wav;
  if (!/\.wav(\?|$)/i.test(url)) {
    // compressed stems (FLAC / Opus): the browser decodes on its own thread; the
    // worker packs the floats into a WAV and measures it (3.7: was on the page,
    // which made the highway stutter while stems loaded)
    const { decodeTo } = await import('./codec.js');
    const d = await decodeTo(buffer, rate || 48000, frames || 0);
    buffer = null;
    out = await computePeaks(null, { L: d.L, R: d.R, rate: rate || 48000 });
    wav = parseWav(out.buffer);
  } else {
    wav = parseWav(buffer);
    out = await computePeaks(buffer, wav);
  }
  return {
    buffer: out.buffer,
    wav,
    peaks: { levels: out.levels, sampleRate: wav.sampleRate, frames: wav.frames, peak: out.peak, rms: out.rms },
  };
}

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.node = null;
    this.sampleRate = 0;
    this.frames = 0;
    this.playing = false;
    this.reports = [];
    this.pausedFrame = 0;
    this.loop = null;
    this.mode = 'mix';
    this.master = 0.85;
    this.tracks = []; // index -> {name, loaded, volume, muted, solo, gain, analyser}
    this._levelBuf = new Float32Array(1024);
    this._specBuf = null;
    this.sinkId = '';
    this._ignoreBefore = 0;
    this.speed = 1;
    // Native output: the final mix goes to the native sound engine instead of
    // a Windows device, and everything we hear is that much later.
    this.native = null; // { portFactory: () => Promise<MessagePort>, onRate: (rate) => void }
    this.extraLatency = 0;
    this.tap = null;
    this.relayPort = null;
    this.relayMode = (() => {
      try {
        return localStorage.getItem('stagehand.songRelay') === '1';
      } catch (_) {
        return false;
      }
    })();
  }

  /** Send the mix to the native sound engine (or back to the normal output with null). */
  async routeToNative(route, latencySec = 0) {
    this.native = route || null;
    this.extraLatency = route ? Math.max(0, latencySec || 0) : 0;
    await this._applyRoute();
    this.dispatchEvent(new Event('route'));
  }

  async _applyRoute() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.native) {
      if (!this.tap) {
        this.tap = new AudioWorkletNode(ctx, 'stagehand-song-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
        this.masterAnalyser.connect(this.tap);
        this.tap.connect(ctx.destination);
        this.tap.port.onmessage = (e) => {
          const m = e.data;
          if (m && m.type === 'song' && this.relayPort) this.relayPort.postMessage({ t: 'song', d: m.d });
        };
      }
      if (ctx.setSinkId) await ctx.setSinkId({ type: 'none' }).catch(() => {});
      const route = this.native;
      const port = await route.portFactory().catch(() => null);
      if (this.native !== route || this.ctx !== ctx) {
        if (port) port.close();
        return;
      }
      if (this.relayPort) this.relayPort.close();
      this.relayPort = null;
      if (port) {
        if (this.relayMode) {
          // through the page: we keep the port, the worklet hands us the audio
          this.relayPort = port;
          this.tap.port.postMessage({ type: 'relay', on: true });
        } else {
          this.tap.port.postMessage({ type: 'relay', on: false });
          this.tap.port.postMessage({ type: 'port', port }, [port]);
        }
      }
      if (route.onRate) route.onRate(ctx.sampleRate);
    } else {
      if (this.tap) {
        this.tap.port.postMessage({ type: 'port', port: null });
        this.tap.port.postMessage({ type: 'relay', on: false });
        try {
          this.masterAnalyser.disconnect(this.tap);
          this.tap.disconnect();
        } catch (_) {}
        this.tap = null;
      }
      if (this.relayPort) this.relayPort.close();
      this.relayPort = null;
      if (ctx.setSinkId) await ctx.setSinkId(this.sinkId || '').catch(() => {});
    }
  }

  /** The song isn't reaching the native engine directly: send it through the page instead. */
  async useSongRelay() {
    if (this.relayMode || !this.native) return;
    this.relayMode = true;
    try {
      localStorage.setItem('stagehand.songRelay', '1'); // remember: next time start this way
    } catch (_) {}
    if (this.tap) this.tap.port.postMessage({ type: 'port', port: null });
    await this._applyRoute();
  }

  /** Practice speed (0.25–1). Pitch stays the same. */
  setSpeed(speed) {
    const pos = this.position;
    this.speed = Math.max(0.25, Math.min(1, Number(speed) || 1));
    if (!this.node) return;
    this.node.port.postMessage({ type: 'pause' });
    this.node.port.postMessage({ type: 'seek', frame: Math.round(pos * this.sampleRate) });
    this.node.port.postMessage({ type: 'speed', speed: this.speed });
    this.pausedFrame = Math.round(pos * this.sampleRate);
    if (this.playing) {
      this._ignoreBefore = this.ctx.currentTime - 0.003;
      this.reports = [{ frame: this.pausedFrame, time: this.ctx.currentTime + this._latency(), playing: true, synthetic: true, speed: this.speed }];
      this.node.port.postMessage({ type: 'play' });
    }
    this.dispatchEvent(new Event('speed'));
  }

  async ensureContext(sampleRate) {
    if (this.ctx && this.ctx.sampleRate === sampleRate) return;
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch (_) {}
    }
    this.ctx = new AudioContext({ sampleRate, latencyHint: 'playback' });
    this.sampleRate = sampleRate;
    await this.ctx.audioWorklet.addModule(new URL('../worklets/player-worklet.js', import.meta.url));
    await this.ctx.audioWorklet.addModule(new URL('../worklets/song-tap-worklet.js', import.meta.url));
    this.tap = null;
    this.node = new AudioWorkletNode(this.ctx, 'stagehand-player', {
      numberOfInputs: 0,
      numberOfOutputs: MAX_TRACKS,
      outputChannelCount: new Array(MAX_TRACKS).fill(2),
    });
    this.node.port.onmessage = (e) => this._onMessage(e.data);
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._masterCurve(this.master);
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 4096;
    this.masterAnalyser.smoothingTimeConstant = 0.72;
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);
    this._specBuf = new Uint8Array(this.masterAnalyser.frequencyBinCount);
    const prev = this.tracks;
    this.tracks = [];
    for (let i = 0; i < MAX_TRACKS; i++) {
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      this.node.connect(gain, i, 0);
      gain.connect(this.masterGain);
      gain.connect(analyser);
      const old = prev[i] || {};
      this.tracks.push({ name: old.name || null, loaded: false, volume: old.volume ?? 0.8, muted: !!old.muted, solo: !!old.solo, gain, analyser, level: 0 });
    }
    if (this.native) await this._applyRoute();
    else if (this.sinkId && this.ctx.setSinkId) this.ctx.setSinkId(this.sinkId).catch(() => {});
    this._applyGains(true);
    this.extra = null;
    this.dispatchEvent(new Event('context'));
  }

  /**
   * A bus for sounds that aren't the song (drums, loops, tone demos). It goes
   * wherever the song goes (the native engine or the output), after the Song
   * level so it keeps its own volume.
   */
  async extraOut() {
    if (!this.ctx) await this.ensureContext(48000);
    if (!this.extra) {
      this.extra = this.ctx.createGain();
      this.extra.connect(this.masterAnalyser);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    return { ctx: this.ctx, node: this.extra };
  }

  async setSink(id) {
    this.sinkId = id || '';
    if (this.native) return; // the native engine owns the output for now
    if (this.ctx && this.ctx.setSinkId) await this.ctx.setSinkId(this.sinkId);
  }

  _onMessage(m) {
    if (m.type === 'pos') {
      if (m.playing) {
        if (m.time < this._ignoreBefore) return; // rendered before the last seek
        this.reports.push(m);
        if (this.reports.length > 96) this.reports.shift();
      } else {
        this.pausedFrame = m.frame;
      }
    } else if (m.type === 'ended') {
      this.playing = false;
      this.pausedFrame = m.frame;
      this.reports = [];
      this.dispatchEvent(new Event('ended'));
      this.dispatchEvent(new Event('state'));
    } else if (m.type === 'loaded') {
      this.dispatchEvent(new CustomEvent('loaded', { detail: m.index }));
    }
  }

  /** Clears all tracks and prepares for a new song of `frames` length. */
  async reset(sampleRate, frames) {
    await this.ensureContext(sampleRate);
    this.pause();
    this.node.port.postMessage({ type: 'unload' });
    this.node.port.postMessage({ type: 'length', frames });
    this.node.port.postMessage({ type: 'seek', frame: 0 });
    this.node.port.postMessage({ type: 'loop', loop: null });
    this.node.port.postMessage({ type: 'speed', speed: this.speed });
    this.frames = frames;
    this.pausedFrame = 0;
    this.reports = [];
    this.loop = null;
    for (const t of this.tracks) {
      t.loaded = false;
      t.name = null;
    }
    this._applyGains(true);
  }

  /** Hands a decoded track to the worklet (ownership of buffer moves). */
  loadTrack(index, name, buffer, wav) {
    const t = this.tracks[index];
    t.name = name;
    t.loaded = true;
    this.node.port.postMessage(
      { type: 'load', index, buffer, byteOffset: wav.dataOffset - (wav.dataOffset % 2), frames: wav.frames, channels: wav.channels, setLength: false },
      [buffer]
    );
    this._applyGains();
  }

  unloadStems() {
    for (let i = 1; i < this.tracks.length; i++) {
      if (this.tracks[i].loaded) this.node.port.postMessage({ type: 'unload', index: i });
      this.tracks[i].loaded = false;
      this.tracks[i].name = null;
    }
    this._applyGains();
  }

  async play() {
    if (!this.ctx || !this.frames) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this.pausedFrame >= this.frames && !this.loop) this.pausedFrame = 0;
    this._ignoreBefore = this.ctx.currentTime - 0.003;
    this.reports = [{ frame: this.pausedFrame, time: this.ctx.currentTime + this._latency(), playing: true, synthetic: true, speed: this.speed }];
    this.playing = true;
    this.node.port.postMessage({ type: 'play' });
    this.dispatchEvent(new Event('state'));
  }

  pause() {
    if (!this.node) return;
    if (this.playing) this.pausedFrame = Math.round(this.position * this.sampleRate);
    this.playing = false;
    this.reports = [];
    this.node.port.postMessage({ type: 'pause' });
    this.node.port.postMessage({ type: 'seek', frame: this.pausedFrame });
    this.dispatchEvent(new Event('state'));
  }

  toggle() {
    return this.playing ? this.pause() : this.play();
  }

  seek(seconds) {
    if (!this.node) return;
    const frame = Math.max(0, Math.min(this.frames, Math.round(seconds * this.sampleRate)));
    this.pausedFrame = frame;
    this.node.port.postMessage({ type: 'seek', frame });
    if (this.playing) {
      this._ignoreBefore = this.ctx.currentTime - 0.003;
      this.reports = [{ frame, time: this.ctx.currentTime + this._latency(), playing: true, synthetic: true, speed: this.speed }];
    }
    this.dispatchEvent(new Event('seek'));
  }

  setLoop(loop) {
    this.loop = loop && loop.end - loop.start > 0.05 ? { start: loop.start, end: loop.end } : null;
    if (this.node) {
      this.node.port.postMessage({
        type: 'loop',
        loop: this.loop ? { start: this.loop.start * this.sampleRate, end: this.loop.end * this.sampleRate } : null,
      });
    }
  }

  _latency() {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) + this.extraLatency;
  }

  /** Seconds of audio currently reaching the speakers. */
  get position() {
    if (!this.ctx || !this.sampleRate) return 0;
    if (!this.playing || !this.reports.length) return this.pausedFrame / this.sampleRate;
    let heard;
    const ts = this.ctx.getOutputTimestamp ? this.ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
      heard = ts.contextTime + Math.max(0, (performance.now() - ts.performanceTime) / 1000) - this.extraLatency;
    } else {
      heard = this.ctx.currentTime - this._latency();
    }
    let r = null;
    for (const x of this.reports) {
      if (x.time <= heard && (!r || x.time >= r.time)) r = x;
    }
    if (!r) r = this.reports.reduce((a, b) => (b.time < a.time ? b : a));
    let frame = r.frame + Math.max(0, heard - r.time) * this.sampleRate * (r.speed || 1);
    if (this.loop) {
      const ls = this.loop.start * this.sampleRate;
      const le = this.loop.end * this.sampleRate;
      if (frame >= le && le > ls) frame = ls + ((frame - ls) % (le - ls));
    }
    return Math.min(this.frames, frame) / this.sampleRate;
  }

  get duration() {
    return this.sampleRate ? this.frames / this.sampleRate : 0;
  }

  // ---------------------------------------------------------------- mixing --
  _masterCurve(p) {
    return Math.pow(Math.max(0, p), 3);
  }

  static faderGain(p) {
    return p <= 0 ? 0 : Math.pow(p / 0.8, 3);
  }

  static faderDb(p) {
    return p <= 0 ? -Infinity : 60 * Math.log10(p / 0.8);
  }

  hasStems() {
    return this.tracks.slice(1).some((t) => t.loaded);
  }

  /** Play along: silences one stem (your instrument) without touching the saved mix. */
  setPlayAlong(name) {
    // Stagehand 3: the whole song always plays; you turn your part's stem down
    // in the Mix panel if you want. Play along just means "use the stems".
    this.playAlong = null;
    if (name && this.hasStems()) this.mode = 'stems';
    this._applyGains();
  }

  effectiveGain(i) {
    const t = this.tracks[i];
    if (!t || !t.loaded) return 0;
    if (i > 0 && this.playAlong && t.name === this.playAlong && this.mode === 'stems') return 0;
    if (i === 0) return this.mode === 'mix' || !this.hasStems() ? 1 : 0;
    if (this.mode !== 'stems') return 0;
    const anySolo = this.tracks.some((x, j) => j > 0 && x.loaded && x.solo);
    const audible = anySolo ? t.solo : !t.muted;
    return audible ? AudioEngine.faderGain(t.volume) : 0;
  }

  _applyGains(instant = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.tracks.forEach((t, i) => {
      const g = this.effectiveGain(i);
      if (instant) t.gain.gain.setValueAtTime(g, now);
      else t.gain.gain.setTargetAtTime(g, now, 0.012);
    });
    this.dispatchEvent(new Event('mix'));
  }

  setMode(mode) {
    this.mode = mode;
    this._applyGains();
  }

  setMaster(p) {
    this.master = p;
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(this._masterCurve(p), this.ctx.currentTime, 0.015);
  }

  setTrack(i, patch) {
    Object.assign(this.tracks[i], patch);
    this._applyGains();
  }

  /** Instant RMS level (0..1, post-fader) for a track. */
  level(i) {
    const t = this.tracks[i];
    if (!t || !t.loaded || !this.playing) return 0;
    t.analyser.getFloatTimeDomainData(this._levelBuf);
    let s = 0;
    const b = this._levelBuf;
    for (let k = 0; k < b.length; k++) s += b[k] * b[k];
    return Math.sqrt(s / b.length);
  }

  masterLevel() {
    if (!this.masterAnalyser || !this.playing) return 0;
    if (!this._mb) this._mb = new Float32Array(2048);
    const b = this._mb;
    this.masterAnalyser.getFloatTimeDomainData(b);
    let s = 0;
    for (let k = 0; k < b.length; k++) s += b[k] * b[k];
    return Math.sqrt(s / b.length);
  }

  spectrum() {
    if (!this.masterAnalyser) return null;
    this.masterAnalyser.getByteFrequencyData(this._specBuf);
    return this._specBuf;
  }
}
