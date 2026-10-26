import { detectPitch, PitchSmoother } from './pitch.js';
import { loadGear, toSpec, ampGain, describe } from './gearspec.js';
import { resolveCapture, caps } from './captures.js';

/**
 * Your guitar through Stagehand.
 *
 * Two engines run the same amp code (native/dsp):
 *  - native: stagehand-audio.exe opens the Rocksmith cable and your output
 *    directly (exclusive WASAPI, like Rocksmith), runs the rig and also plays
 *    the song, so nothing goes through Windows' shared mixer;
 *  - web: the WebAssembly build inside an AudioWorklet, used when the native
 *    engine can't run (or isn't wanted).
 *
 * Tones are chains of real Rocksmith gear (amp, pedals, cabinet, racks).
 * A song's own tones are built from its manifest; the presets below are
 * chains too.
 */

const G = (slot, key, knobs = {}) => ({ slot, key, knobs });
/*
 * Presets, built around amps that have a real capture (Real amps, 3.2): each
 * gain sits on one of that capture's gain settings, so with the real amp got
 * it plays exactly as captured (and the modelled amp otherwise).
 * Slot order matches 3.1 (Chime is new, in slot 9).
 */
export const TONES = [
  { id: 'clean', name: 'Clean', kind: 'guitar', desc: 'Fender Deluxe Reverb: clean, a touch of chorus and spring', gear: [G('amp', 'Amp_TW22', { Gain: 31, Bass: 45, Mid: 55, Treble: 62 }), G('cab', 'Cab_TW112C_57_Cone'), G('post', 'Pedal_Chorus20', { Rate: 0.6, Depth: 30, Mix: 25 }), G('post', 'Pedal_SpringReverb', { Time: 55, Mix: 25 })] },
  { id: 'crunch', name: 'Crunch', kind: 'guitar', desc: 'Marshall Plexi, driven: classic rock', gear: [G('amp', 'Amp_MarshallPlexi', { 'Loudness 1': 65, 'Loudness 2': 40, Bass: 50, Mid: 60, Treble: 55, Presence: 50 }), G('cab', 'Cab_Marshall1960AX_57_Cone'), G('rack', 'Rack_StudioChamber', { Decay: 35, Mix: 15 })] },
  { id: 'overdrive', name: 'Overdrive', kind: 'guitar', desc: 'Marshall JCM800 with a drive pedal in front: hard rock', gear: [G('pre', 'Pedal_SuperDrive', { Gain: 20, Tone: 55 }), G('amp', 'Amp_MarshallJCM800', { PreAmp: 75, Bass: 50, Mid: 60, Treble: 55, Presence: 50 }), G('cab', 'Cab_Marshall1960a_57_Cone'), G('post', 'Pedal_AnalogueDelay', { Time: 380, Feedback: 20, Mix: 14 })] },
  { id: 'metal', name: 'Metal', kind: 'guitar', desc: 'Mesa Dual Rectifier, tight and heavy', gear: [G('pre', 'Pedal_NoiseGate', { Threshold: -62, Rate: 85 }), G('pre', 'Pedal_SuperDrive', { Gain: 8, Tone: 60 }), G('amp', 'Amp_CA100', { Gain: 80, Bass: 55, Mid: 50, Treble: 55, Presence: 50 }), G('cab', 'Cab_CA412C_57_Cone')] },
  { id: 'fuzz', name: 'Fuzz', kind: 'guitar', desc: 'Fuzz into an Orange: thick and woolly', gear: [G('pre', 'Pedal_BuzzOne', { Gain: 70, Tone: 40 }), G('amp', 'Amp_OrangeRockerverb', { Gain: 46, Bass: 55, Mid: 55, Treble: 50 }), G('cab', 'Cab_OrangePPC412_57_Cone')] },
  { id: 'lead', name: 'Lead', kind: 'guitar', desc: 'Peavey 5150 with delay and plate: for solos', gear: [G('amp', 'Amp_HG180', { Gain: 85, Bass: 50, Mid: 60, Treble: 55 }), G('cab', 'Cab_HG212C_57_Cone'), G('post', 'Pedal_AnalogueDelay', { Time: 400, Feedback: 30, Mix: 24 }), G('rack', 'Rack_StudioPlate', { Decay: 50, Mix: 22 })] },
  { id: 'bass-clean', name: 'Bass clean', kind: 'bass', desc: 'Ampeg SVT, clean and round', gear: [G('amp', 'Bass_Amp_BT600B', { Gain: 21, Compression: 40 }), G('cab', 'Bass_Cab_AT810BC_57_Cone')] },
  { id: 'bass-grit', name: 'Bass grit', kind: 'bass', desc: 'Orange AD200 bass, growling', gear: [G('pre', 'Bass_Pedal_BassOverdrive', { Gain: 35, Tone: 45, Blend: 45 }), G('amp', 'Bass_Amp_OrangeAD200B', { Gain: 50, Bass: 55, Mid: 55, Treble: 50 }), G('cab', 'Bass_Cab_OrangeOBC810_57_Cone')] },
  { id: 'chime', name: 'Chime', kind: 'guitar', desc: 'Vox AC30 on the edge of breakup: jangly', gear: [G('amp', 'Amp_AT120', { Gain: 31, Bass: 45, Mid: 55, Treble: 60 }), G('cab', 'Cab_AT1121C_57_Cone'), G('rack', 'Rack_StudioPlate', { Decay: 40, Mix: 15 })] },
];
for (const t of TONES) t.gain = 0.5;
loadGear().then(() => {
  for (const t of TONES) {
    t.gain = ampGain(t);
    t.chain = describe(t);
  }
});

/** Offsets in semitones from E standard, low string first (bass uses the first four). */
export const TUNINGS = [
  { id: 'e-std', name: 'E Standard', o: [0, 0, 0, 0, 0, 0] },
  { id: 'eb-std', name: 'E♭ Standard', o: [-1, -1, -1, -1, -1, -1] },
  { id: 'd-std', name: 'D Standard', o: [-2, -2, -2, -2, -2, -2] },
  { id: 'cs-std', name: 'C♯ Standard', o: [-3, -3, -3, -3, -3, -3] },
  { id: 'c-std', name: 'C Standard', o: [-4, -4, -4, -4, -4, -4] },
  { id: 'b-std', name: 'B Standard', o: [-5, -5, -5, -5, -5, -5] },
  { id: 'f-std', name: 'F Standard', o: [1, 1, 1, 1, 1, 1] },
  { id: 'drop-d', name: 'Drop D', o: [-2, 0, 0, 0, 0, 0] },
  { id: 'drop-cs', name: 'Drop C♯', o: [-3, -1, -1, -1, -1, -1] },
  { id: 'drop-c', name: 'Drop C', o: [-4, -2, -2, -2, -2, -2] },
  { id: 'drop-b', name: 'Drop B', o: [-5, -3, -3, -3, -3, -3] },
  { id: 'drop-bb', name: 'Drop B♭', o: [-6, -4, -4, -4, -4, -4] },
  { id: 'drop-a', name: 'Drop A', o: [-7, -5, -5, -5, -5, -5] },
  { id: 'open-g', name: 'Open G', o: [-2, -2, 0, 0, 0, -2] },
  { id: 'open-d', name: 'Open D', o: [-2, 0, 0, -1, -2, -2] },
  { id: 'open-e', name: 'Open E', o: [0, 2, 2, 1, 0, 0] },
  { id: 'open-a', name: 'Open A', o: [0, 0, 2, 2, 2, 0] },
  { id: 'open-c', name: 'Open C', o: [-4, -2, -2, 0, 1, 0] },
  { id: 'dadgad', name: 'DADGAD', o: [-2, 0, 0, 0, -2, -2] },
];

const DEFAULT_KNOBS = { input: 0.5, bass: 0.5, mid: 0.5, treble: 0.5, fx: 0.5, volume: 0.7 };
const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const P = { input: 0, volume: 1, gain: 2, bass: 3, mid: 4, treble: 5, fx: 6, gate: 7, bypass: 8, drop: 9, room: 10 };
const SLOTS = 8;

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch (_) {
    return fallback;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A MessagePort from the main process (see preload.js). */
function portFrom(kind, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      window.removeEventListener('message', on);
      reject(new Error('No answer from the sound engine'));
    }, timeout);
    const on = (e) => {
      if (e.source !== window || !e.data || e.data.type !== 'stagehand-rig-port' || e.data.kind !== kind || !e.ports || !e.ports[0]) return;
      clearTimeout(t);
      window.removeEventListener('message', on);
      resolve(e.ports[0]);
    };
    window.addEventListener('message', on);
    window.stagehand.rig.connect(kind);
  });
}

// ===================================================================== native
class NativeBackend {
  constructor(rig) {
    this.rig = rig;
    this.port = null;
    this.waiters = [];
    this.rate = 48000;
    this.latency = null;
    this.songLatency = 0;
    this.meters = { in: 0, inPeak: 0, out: 0, outPeak: 0 };
    this.ring = new Float32Array(16384);
    this.w = 0;
    this.info = null;
    this.devicesCache = null;
  }

  async connect() {
    if (this.port) return;
    this.port = await portFrom('control');
    this.port.onmessage = (e) => this._msg(e.data);
    this.port.start();
  }

  _msg(m) {
    if (!m) return;
    if (m.t === 'in') {
      const d = m.d;
      const r = this.ring;
      for (let i = 0; i < d.length; i++) r[(this.w + i) & 16383] = d[i];
      this.w = (this.w + d.length) & 16383;
      if (this.rig._taps.size) this.rig._feedTaps(d);
      return;
    }
    if (m.t !== 'ev') return;
    const ev = m.ev;
    if (ev.ev === 'meters') {
      this.meters = ev;
      this.rig._songWatch(ev);
    }
    if ((ev.ev === 'lost' || ev.ev === 'exit') && this.running) {
      this.running = false;
      this.rig._lost(ev.message || 'The sound engine stopped.');
    }
    for (const w of [...this.waiters]) {
      if (w.match(ev)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.t);
        w.resolve(ev);
      }
    }
  }

  _cmd(cmd) {
    this.port.postMessage({ t: 'cmd', cmd });
  }

  _wait(match, ms = 8000) {
    return new Promise((resolve, reject) => {
      const w = { match, resolve };
      w.t = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(Object.assign(new Error('The sound engine didn’t answer.'), { code: 'timeout' }));
      }, ms);
      this.waiters.push(w);
    });
  }

  async devices() {
    await this.connect();
    const p = this._wait((e) => e.ev === 'devices' || (e.ev === 'error' && e.during === 'devices'), 6000);
    this._cmd({ cmd: 'devices' });
    const ev = await p;
    if (ev.ev === 'error') throw new Error(ev.message);
    this.devicesCache = ev;
    return ev;
  }

  async start({ input, output, exclusive, buffer }) {
    await this.connect();
    const p = this._wait((e) => e.ev === 'started' || (e.ev === 'error' && (e.during === 'start' || e.during === 'devices')), 10000);
    const cmd = { cmd: 'start', input: input || '', output: output || '', exclusive: exclusive ? 1 : 0, buffer: buffer ?? 1 };
    if (window.__shFakeAudio) Object.assign(cmd, window.__shFakeAudio);
    this._cmd(cmd);
    const ev = await p;
    if (ev.ev === 'error') throw Object.assign(new Error(ev.message), { code: ev.code });
    this.info = ev;
    this.rate = ev.rate;
    this.latency = Math.round(ev.latencyMs);
    this.songLatency = ev.songLatencyMs / 1000;
    this.running = true;
    if (this.songRate) this.song(this.songRate);
    return ev;
  }

  stop() {
    this.running = false;
    if (this.port) this._cmd({ cmd: 'stop' });
  }

  async build(slot, spec) {
    const p = this._wait((e) => e.ev === 'built' && e.slot === slot, 8000);
    this._cmd({ cmd: 'build', slot, spec });
    const ev = await p;
    return !!ev.ok;
  }

  select(slot) {
    this._cmd({ cmd: 'select', slot });
  }

  param(id, v) {
    this._cmd({ cmd: 'param', id, v });
  }

  ir(slot, path) {
    this._cmd({ cmd: 'ir', slot, path: path || '' });
  }

  /** A real amp capture for a slot (before building it); cap null clears it. */
  async nam(slot, cap) {
    const p = this._wait((e) => e.ev === 'nam' && e.slot === slot, 8000);
    this._cmd({ cmd: 'nam', slot, path: cap ? cap.path : '', fullRig: cap && cap.fullRig ? 1 : 0, gainRef: cap ? cap.gainRef : 0.5, trim: 0 });
    const ev = await p;
    return { ok: !!ev.ok, error: ev.error || '' };
  }

  song(rate) {
    this.songRate = rate;
    if (this.port && this.running) this._cmd({ cmd: 'song', rate, on: 1 });
  }

  samples(buf) {
    const n = buf.length;
    const r = this.ring;
    let p = (this.w - n + 16384 * 4) & 16383;
    for (let i = 0; i < n; i++, p = (p + 1) & 16383) buf[i] = r[p];
    return buf;
  }

  levels() {
    const m = this.meters;
    return { input: m.in || 0, output: m.out || 0, clip: (m.inPeak || 0) > 0.98, inPeak: m.inPeak || 0 };
  }
}

// ======================================================================== web
let wasmBytes = null;
export async function wasm() {
  if (!wasmBytes) wasmBytes = await (await fetch(new URL('../worklets/rig-dsp.wasm', import.meta.url))).arrayBuffer();
  return wasmBytes;
}

class WebBackend {
  constructor(rig) {
    this.rig = rig;
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.tuner = null;
    this.meters = [0, 0, 0, 0, 0];
    this.pending = new Map();
    this.seq = 0;
  }

  async devices() {
    if (!navigator.mediaDevices) return { inputs: [], outputs: [] };
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, name: d.label || 'Audio input', rocksmith: /rocksmith|real ?tone|guitar adapter/i.test(d.label) }));
    return { inputs, outputs: [] };
  }

  async start({ input, sinkId }) {
    const open = (deviceId) =>
      navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, latency: 0 },
        video: false,
      });
    let id = input;
    if (!id) {
      const rs = (await this.devices()).inputs.find((d) => d.rocksmith);
      if (rs) id = rs.id;
    }
    this.stream = await open(id);
    if (!input) {
      // Labels appear only after access is granted; pick the cable now if we couldn't before.
      const rs = (await this.devices()).inputs.find((d) => d.rocksmith);
      if (rs && rs.id !== id) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = await open(rs.id);
      }
    }
    const track = this.stream.getAudioTracks()[0];
    const rate = track && track.getSettings ? track.getSettings().sampleRate : 0;
    let ctx;
    try {
      ctx = new AudioContext(rate ? { latencyHint: 0, sampleRate: rate } : { latencyHint: 0 });
    } catch (_) {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    this.ctx = ctx;
    if (sinkId && ctx.setSinkId) await ctx.setSinkId(sinkId).catch(() => {});
    await ctx.audioWorklet.addModule(new URL('../worklets/rig-dsp-worklet.js', import.meta.url));
    const bytes = await wasm();
    this.node = new AudioWorkletNode(ctx, 'stagehand-rig-dsp', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit' });
    const ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The amp engine didn’t start.')), 8000);
      this.node.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(t);
          resolve();
        } else if (m.type === 'meters') this.meters = m.m;
        else if (m.type === 'built') {
          const p = this.pending.get(m.id);
          if (p) this.pending.delete(m.id), p(m.ok);
        } else if (m.type === 'nam') {
          const p = this.pending.get(m.id);
          if (p) this.pending.delete(m.id), p({ ok: !!m.ok, error: m.error || '' });
        } else if (m.type === 'error') console.warn('rig engine:', m.message);
      };
    });
    this.node.port.onmessageerror = () => console.warn('rig engine: message could not be delivered');
    this.node.port.postMessage({ type: 'init', bytes: bytes.slice(0) });
    await ready;
    const src = ctx.createMediaStreamSource(this.stream);
    this.src = src;
    this.tuner = ctx.createAnalyser();
    this.tuner.fftSize = 8192;
    src.connect(this.tuner);
    src.connect(this.node);
    this.node.connect(ctx.destination);
    this.rate = ctx.sampleRate;
    const s = track && track.getSettings ? track.getSettings() : {};
    this.latency = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0) + (s.latency || 0.01)) * 1000);
    this.info = { mode: 'in-app', inName: track ? track.label : '', outName: '' };
    this.inputId = id;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.node = null;
  }

  async setSink(id) {
    if (this.ctx && this.ctx.setSinkId) await this.ctx.setSinkId(id || '').catch(() => {});
  }

  build(slot, spec) {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.node.port.postMessage({ type: 'build', slot, id, bytes: new TextEncoder().encode(spec) });
    });
  }

  select(slot) {
    this.node.port.postMessage({ type: 'select', slot });
  }

  param(id, v) {
    if (this.node) this.node.port.postMessage({ type: 'param', id, v });
  }

  irData(slot, data) {
    if (this.node) this.node.port.postMessage({ type: 'ir', slot, data });
  }

  async nam(slot, cap) {
    let bytes = null;
    if (cap) {
      try {
        const r = await fetch(cap.url);
        if (!r.ok) throw new Error(String(r.status));
        bytes = new Uint8Array(await r.arrayBuffer());
      } catch (_) {
        return { ok: false, error: 'Couldn’t read the capture file.' };
      }
    }
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.node.port.postMessage({ type: 'nam', slot, id, bytes, fullRig: cap && cap.fullRig ? 1 : 0, gainRef: cap ? cap.gainRef : 0.5, trim: 0 });
    });
  }

  /** Raw input for recording, only while something is listening. */
  tap(on) {
    if (!this.ctx || !this.src) return;
    if (on && !this.sp) {
      this.sp = this.ctx.createScriptProcessor(2048, 1, 1);
      const quiet = this.ctx.createGain();
      quiet.gain.value = 0;
      this.sp.onaudioprocess = (e) => this.rig._feedTaps(new Float32Array(e.inputBuffer.getChannelData(0)));
      this.src.connect(this.sp);
      this.sp.connect(quiet);
      quiet.connect(this.ctx.destination);
    } else if (!on && this.sp) {
      try {
        this.src.disconnect(this.sp);
        this.sp.disconnect();
      } catch (_) {}
      this.sp = null;
    }
  }

  samples(buf) {
    this.tuner.getFloatTimeDomainData(buf);
    return buf;
  }

  levels() {
    const m = this.meters;
    return { input: m[0], output: m[2], clip: m[1] > 0.98, inPeak: m[1] };
  }
}

// ======================================================================== rig
export class Rig extends EventTarget {
  constructor() {
    super();
    const saved = load('stagehand.rig', {});
    this.deviceId = saved.deviceId || '';
    this.outputId = saved.outputId || '';
    this.engineChoice = saved.engine || 'auto'; // auto | native | web
    this.exclusive = saved.exclusive !== false;
    this.buffer = saved.buffer ?? 1; // 0 smallest, 1 small, 2 safe
    this.toneId = saved.toneId || 'crunch';
    this.knobs = { ...DEFAULT_KNOBS, ...(saved.knobs || {}) };
    this.perTone = saved.perTone || {};
    // Drop: a pitch drop on your guitar, like a DigiTech Drop pedal (not part of any tone)
    const d = load('stagehand.drop', {});
    this.drop = { on: !!d.on, st: Math.max(1, Math.min(12, Number(d.st) || 1)), match: !!d.match };
    this.room = Number.isFinite(Number(d.room)) && d.room !== undefined ? Number(d.room) : 0.5;
    this.dropSong = 0; // semitones the open song is tuned down (for "match the song")
    this.on = false;
    this.mode = 'preset';
    this.songTone = null;
    this.smoother = new PitchSmoother(7);
    this.error = null;
    this.notice = null;
    this.sinkId = '';
    this.backend = null;
    this.kind = null; // 'native' | 'web'
    this.player = null; // AudioEngine (set by stage.js)
    this.slots = new Array(SLOTS).fill(null); // spec per slot
    this.active = -1;
    this.lastUse = new Array(SLOTS).fill(0);
    this.useSeq = 0;
    this._busy = Promise.resolve();
    this._tb = null;
    this.calibrating = false;
    this.muted = !!saved.muted;
    this.custom = []; // your own tones (tones.js), looked up before the presets
    this.liveTone = null; // a tone being auditioned or edited, not saved yet
    this.auto = false;
    this._pollT = null;
    this._taps = new Set();
    this._irSlots = new Set();
    this._namSlots = new Set();
    this._badCaps = new Map(); // capture path → why it couldn't load
    this.capture = null; // the real amp playing now (see captures.js), or null
    // a new or changed capture (or Real amps on/off) rebuilds what you're playing
    caps.events.addEventListener('change', () => {
      if (this.on && this.backend) this._useTone(this._currentTone());
    });
  }

  /** Listen to the raw guitar (before the amp), e.g. for recording. fn(Float32Array) */
  addInputTap(fn) {
    this._taps.add(fn);
    if (this.backend && this.backend.tap) this.backend.tap(true);
  }

  removeInputTap(fn) {
    this._taps.delete(fn);
    if (!this._taps.size && this.backend && this.backend.tap) this.backend.tap(false);
  }

  _feedTaps(d) {
    for (const fn of this._taps) {
      try {
        fn(d);
      } catch (_) {}
    }
  }

  /** Your saved tones, so setTone() can find them by id. */
  registerTones(list) {
    this.custom = (list || []).filter((t) => t && t.gear && t.gear.length);
    for (const t of this.custom) {
      t.gain = ampGain(t);
      t.chain = describe(t);
    }
  }

  findTone(id) {
    return this.custom.find((t) => t.id === id) || TONES.find((t) => t.id === id) || null;
  }

  /** Plays a tone that isn't saved (or isn't saved yet): auditions, edits, song tones from other songs. */
  setLiveTone(tone) {
    if (!tone || !tone.gear || !tone.gear.length) return;
    if (this.mode !== 'song' && this.mode !== 'live') this.perTone[this.toneId] = { ...this.knobs };
    this.mode = 'live';
    this.liveTone = { ...tone, gain: ampGain(tone) };
    this.knobs = { ...DEFAULT_KNOBS, input: this.knobs.input, volume: this.knobs.volume };
    this._sendAllParams();
    this._useTone(this.liveTone);
    this.dispatchEvent(new Event('change'));
  }

  /** Silences the guitar without stopping it (the tuner keeps working). */
  setMuted(on) {
    this.muted = !!on;
    this._param('volume');
    this.save();
    this.dispatchEvent(new Event('change'));
  }

  /**
   * Always on: starts with the Rocksmith cable if it's there, and keeps
   * looking for it every few seconds while it isn't (or after it's unplugged).
   */
  async autoStart() {
    this.auto = true;
    if (!this._autoHooked) {
      this._autoHooked = true;
      this.addEventListener('change', () => {
        if (this.auto && !this.on && !this._starting) this._poll(4000);
      });
    }
    await this._tryStart();
  }

  _poll(ms) {
    clearTimeout(this._pollT);
    this._pollT = setTimeout(() => this._tryStart(), ms);
  }

  async _tryStart() {
    clearTimeout(this._pollT);
    if (this.on || this._starting || !this.auto) return;
    this._starting = true;
    try {
      const list = await this.devices();
      const cable = list.find((d) => d.rocksmith) || (this.deviceId && list.find((d) => d.id === this.deviceId));
      this.cablePresent = !!cable;
      if (!cable) {
        this.status = 'nocable';
        this.dispatchEvent(new Event('change'));
        return;
      }
      this.status = 'starting';
      this.dispatchEvent(new Event('change'));
      await this.start();
      this.status = this.on ? 'on' : 'error';
    } catch (err) {
      this.status = 'error';
      this.error = this.error || (err && err.message) || String(err);
    } finally {
      this._starting = false;
      if (!this.on && this.auto) this._poll(this.status === 'error' ? 8000 : 4000);
      this.dispatchEvent(new Event('change'));
    }
  }

  save() {
    try {
      localStorage.setItem(
        'stagehand.rig',
        JSON.stringify({ deviceId: this.deviceId, outputId: this.outputId, engine: this.engineChoice, exclusive: this.exclusive, buffer: this.buffer, toneId: this.toneId, knobs: this.knobs, perTone: this.perTone, muted: this.muted })
      );
    } catch (_) {}
  }

  get tone() {
    if (this.mode === 'song' && this.songTone) return { ...this.songTone, gain: this.songTone.gainPos ?? 0.5, kind: this.songTone.kind };
    if (this.mode === 'live' && this.liveTone) return this.liveTone;
    return this.findTone(this.toneId) || TONES[1];
  }

  /** Is the native engine an option on this computer? */
  async nativeAvailable() {
    try {
      const r = await window.stagehand.rig.available();
      return !!(r && (r.__sh ? r.ok && r.value : r));
    } catch (_) {
      return false;
    }
  }

  /** Inputs (and outputs, for the native engine), Rocksmith cable first. */
  async devices() {
    const b = this.backend || ((await this._wantNative()) ? new NativeBackend(this) : new WebBackend(this));
    try {
      const d = await b.devices();
      const inputs = (d.inputs || []).map((x) => ({ id: x.id, label: x.name, rocksmith: !!x.rocksmith })).sort((a, b2) => b2.rocksmith - a.rocksmith);
      const outputs = (d.outputs || []).map((x) => ({ id: x.id, label: x.name, isDefault: !!x.default }));
      inputs.outputs = outputs;
      return inputs;
    } catch (_) {
      return [];
    }
  }

  async _wantNative() {
    if (this.engineChoice === 'web') return false;
    return this.nativeAvailable();
  }

  get engineName() {
    return this.kind === 'native' ? 'native' : this.kind === 'web' ? 'in-app' : null;
  }

  async start() {
    this.error = null;
    this.notice = null;
    await loadGear();
    let ok = false;
    if (await this._wantNative()) {
      const nb = new NativeBackend(this);
      // Windows only grants exclusive use of an output nobody else has open,
      // and that includes our own player: move it onto the native engine first.
      const route = { portFactory: () => portFrom('song'), onRate: (rate) => nb.song(rate) };
      if (this.player) {
        await this.player.routeToNative(route, 0.065);
        if (this.player.ctx) await wait(150); // let Windows close our shared stream
      }
      const tries = this.exclusive ? [true, false] : [false];
      let lastErr = null;
      for (const exclusive of tries) {
        try {
          await nb.start({ input: this.deviceId, output: this.outputId, exclusive, buffer: this.buffer });
          this.backend = nb;
          this.kind = 'native';
          ok = true;
          if (exclusive !== this.exclusive || (lastErr && !exclusive))
            this.notice = `Sharing your output with other apps (a little more delay): ${lastErr ? lastErr.message : ''}`.trim();
          break;
        } catch (err) {
          lastErr = err;
          nb.stop();
          // a busy or missing guitar input won't get better in shared mode
          if (/guitar input/i.test(err.message || '') && err.code !== 'notallowed') break;
        }
      }
      if (ok) {
        if (this.player) this.player.extraLatency = nb.songLatency;
      } else {
        if (this.player) await this.player.routeToNative(null);
        if (this.engineChoice === 'native') this.error = (lastErr && lastErr.message) || 'The sound engine didn’t start.';
        else this.notice = `Using the in-app engine: ${(lastErr && lastErr.message) || 'the sound engine didn’t start'}`;
      }
    }
    if (!ok && !this.error) {
      const wb = new WebBackend(this);
      try {
        await wb.start({ input: this.deviceId, sinkId: this.sinkId });
        this.backend = wb;
        this.kind = 'web';
        ok = true;
      } catch (err) {
        wb.stop();
        this.error =
          err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
            ? 'Windows is blocking microphone access. Open Settings › Privacy & security › Microphone and allow desktop apps, then try again.'
            : err && err.name === 'NotFoundError'
              ? 'No audio input found. Plug in your Rocksmith cable and try again.'
              : err && err.name === 'NotReadableError'
                ? 'Another program is using your guitar input. Close Rocksmith or your DAW and try again.'
                : `Couldn’t open the input: ${(err && err.message) || err}`;
      }
    }
    if (ok) {
      this.on = true;
      this.slots.fill(null);
      this._irSlots.clear();
      this._namSlots.clear();
      this.active = -1;
      this._sendAllParams();
      await this._useTone(this._currentTone());
      this.save();
    }
    this.dispatchEvent(new Event('change'));
    return this.on;
  }

  stop() {
    const was = this.backend;
    this.on = false;
    this.backend = null;
    this.kind = null;
    if (was) was.stop();
    if (this.player && this.player.native) this.player.routeToNative(null);
    this.dispatchEvent(new Event('change'));
  }

  /** If the song is playing but none of it reaches the native engine, try the other route. */
  _songWatch(ev) {
    const p = this.player;
    if (!p || !p.native || !p.playing || this.kind !== 'native') {
      this._dryFor = 0;
      return;
    }
    if ((ev.songFill || 0) > 1) {
      this._dryFor = 0;
      return;
    }
    const now = performance.now();
    if (!this._dryFor) this._dryFor = now;
    if (now - this._dryFor < 1500) return;
    this._dryFor = 0;
    if (!p.relayMode) {
      console.warn('rig: song not reaching the native engine directly; relaying through the page');
      p.useSongRelay();
    } else if (!this._songWarned) {
      this._songWarned = true;
      this.notice = 'The song isn’t reaching the sound engine. Try Engine: In-app in this panel, and tell me this happened.';
      this.dispatchEvent(new Event('change'));
    }
  }

  _lost(message) {
    this.error = message;
    this.stop();
  }

  async restart() {
    if (!this.on) return;
    this.stop();
    await this.start();
  }

  async setDevice(id) {
    this.deviceId = id;
    this.save();
    await this.restart();
  }

  async setOutput(id) {
    this.outputId = id;
    this.save();
    await this.restart();
  }

  async setEngine({ engine, exclusive, buffer } = {}) {
    if (engine) this.engineChoice = engine;
    if (exclusive !== undefined) this.exclusive = !!exclusive;
    if (buffer !== undefined) this.buffer = buffer;
    this.save();
    await this.restart();
  }

  async setSink(id) {
    this.sinkId = id || '';
    if (this.kind === 'web' && this.backend) await this.backend.setSink(this.sinkId);
  }

  // ------------------------------------------------------------- tones --
  _currentTone() {
    if (this.mode === 'song' && this.songTone && this.songTone.gear && this.songTone.gear.length) return this.songTone;
    if (this.mode === 'live' && this.liveTone) return this.liveTone;
    return this.findTone(this.toneId) || TONES[1];
  }

  /** Builds a tone into a free slot (or finds it already built). */
  /** The real amp for a tone, unless it already failed to load. */
  captureFor(tone) {
    const cap = resolveCapture(tone);
    return cap && !this._badCaps.has(cap.path) ? cap : null;
  }

  async _slotFor(tone) {
    const spec = toSpec(tone);
    const cap = this.backend.nam ? this.captureFor(tone) : null;
    // your own cab file (IR) and the real amp are part of what makes a slot this tone
    let key = tone.ir ? `${spec}\nir\t${tone.ir}` : spec;
    if (cap) key += `\nnam\t${cap.path}\t${cap.gainRef.toFixed(3)}\t${cap.fullRig ? 1 : 0}`;
    let slot = this.slots.indexOf(key);
    if (slot >= 0) {
      this.lastUse[slot] = ++this.useSeq;
      return slot;
    }
    // least recently used, never the one playing
    let best = -1;
    for (let i = 0; i < SLOTS; i++) {
      if (i === this.active || i === this._prev) continue;
      if (best < 0 || !this.slots[i] || (this.slots[best] && this.lastUse[i] < this.lastUse[best])) best = i;
      if (!this.slots[i]) break;
    }
    if (best < 0) return -1;
    this.slots[best] = null;
    if (this.backend.nam && (cap || this._namSlots.has(best))) {
      const r = await this.backend.nam(best, cap);
      if (cap && !r.ok) {
        // plays the modelled amp instead; say why once
        this._badCaps.set(cap.path, r.error);
        this._namSlots.delete(best);
        this.dispatchEvent(new CustomEvent('capture-error', { detail: { cap, error: r.error } }));
      } else if (cap) this._namSlots.add(best);
      else this._namSlots.delete(best);
    }
    const ok = await this.backend.build(best, spec);
    if (!ok) return -1;
    if (this.backend.ir && (tone.ir || this._irSlots.has(best))) {
      this.backend.ir(best, tone.ir || '');
      if (tone.ir) this._irSlots.add(best);
      else this._irSlots.delete(best);
    }
    this.slots[best] = key;
    this.lastUse[best] = ++this.useSeq;
    return best;
  }

  _useTone(tone) {
    // Serialise builds; switching tones is a short crossfade inside the engine.
    // While one is building, only the newest request waits (turning a knob
    // asks many times a second; the in-between ones don't matter).
    this._want = tone;
    if (this._queued) return this._busy;
    this._queued = true;
    this._busy = this._busy.then(async () => {
      this._queued = false;
      tone = this._want;
      if (!this.on || !this.backend || !tone) return;
      const backend = this.backend;
      const slot = await this._slotFor(tone);
      if (slot < 0 || this.backend !== backend) return;
      const cap = backend.nam ? this.captureFor(tone) : null;
      if ((cap && cap.path) !== (this.capture && this.capture.path)) {
        this.capture = cap;
        this.dispatchEvent(new Event('capture'));
        this.dispatchEvent(new Event('change'));
      }
      if (slot !== this.active) {
        this._prev = this.active;
        backend.select(slot);
        this.active = slot;
        setTimeout(() => {
          if (this._prev !== this.active) this._prev = -1;
        }, 120);
      }
    }).catch((e) => console.warn('rig tone:', e));
    return this._busy;
  }

  /** Builds a song's tones ahead of time so tone changes are instant. */
  prepareTones(tones) {
    if (!tones || !this.on) return;
    const list = tones.filter((t) => t && t.gear && t.gear.length).slice(0, SLOTS - 2);
    this._busy = this._busy.then(async () => {
      for (const t of list) if (this.on && this.backend) await this._slotFor(t);
    }).catch(() => {});
  }

  /** Follow the song: its own Rocksmith rig. */
  setSongTone(mapped) {
    if (!mapped) return;
    if (this.mode !== 'song' && this.mode !== 'live') this.perTone[this.toneId] = { ...this.knobs };
    this.mode = 'song';
    this.songTone = { ...mapped, gainPos: mapped.gear ? ampGain(mapped) : mapped.knobs && mapped.knobs.gain };
    this.toneId = mapped.preset;
    // The song's own settings, untouched: knobs at their middle (= as the song has them).
    this.knobs = { ...DEFAULT_KNOBS, input: this.knobs.input, volume: this.knobs.volume };
    this._sendAllParams();
    if (mapped.gear && mapped.gear.length) this._useTone(this.songTone);
    else this._useTone(this.findTone(mapped.preset) || TONES[1]);
    this.dispatchEvent(new Event('change'));
  }

  setTone(id) {
    // Each tone remembers its own knob settings.
    if (this.mode !== 'song' && this.mode !== 'live') this.perTone[this.toneId] = { ...this.knobs };
    this.mode = 'preset';
    this.songTone = null;
    this.liveTone = null;
    this.toneId = id;
    this.knobs = { ...DEFAULT_KNOBS, ...(this.perTone[id] || {}), input: this.knobs.input, volume: this.knobs.volume };
    this.save();
    this._sendAllParams();
    this._useTone(this.tone);
    this.dispatchEvent(new Event('change'));
  }

  setKnob(name, v) {
    this.knobs[name] = Math.max(0, Math.min(1, Number(v)));
    this._param(name);
    if (this.mode === 'preset' || name === 'input' || name === 'volume') this._saveSoon();
  }

  /** Back to the tone's own value. */
  resetKnob(name) {
    if (name === 'gain') delete this.knobs.gain;
    else this.knobs[name] = DEFAULT_KNOBS[name];
    this._param(name);
    this._saveSoon();
  }

  _param(name) {
    if (!this.backend || !(name in P)) return;
    let v = this.knobs[name];
    if (name === 'volume' && this.muted) v = 0;
    if (name === 'gain') v = this.knobs.gain === undefined || this.knobs.gain === null ? -1 : this.knobs.gain;
    this.backend.param(P[name], v);
  }

  _sendAllParams() {
    for (const k of ['input', 'volume', 'gain', 'bass', 'mid', 'treble', 'fx']) this._param(k);
    this._sendDrop();
  }

  /** Semitones the Drop is lowering your guitar by right now (0 = off). */
  dropAmount() {
    if (!this.drop.on) return 0;
    return this.drop.match ? this.dropSong : this.drop.st;
  }

  /** Change the Drop: { on, st (1–12, 12 = octave), match (follow the song's tuning) }. */
  setDrop(patch) {
    Object.assign(this.drop, patch || {});
    this.drop.st = Math.max(1, Math.min(12, Math.round(this.drop.st)));
    try {
      localStorage.setItem('stagehand.drop', JSON.stringify({ ...this.drop, room: this.room }));
    } catch (_) {}
    this._sendDrop();
  }

  /** The open song's tuning, so "match the song" knows how far to drop. */
  setSongTuning(offsets) {
    const o = (offsets || []).map(Number).filter((x) => Number.isFinite(x));
    // a song tuned down evenly (E♭, D, C♯ standard…) can be played in E standard with the Drop
    const even = o.length && o.every((x) => x === o[0]) && o[0] < 0 ? -o[0] : 0;
    this.dropSong = Math.min(12, even);
    if (this.drop.on && this.drop.match) this._sendDrop();
    else this.dispatchEvent(new Event('drop'));
  }

  /** How much room sound goes around the cabinet (0 dry – 1 roomy). */
  setRoom(v) {
    this.room = Math.max(0, Math.min(1, Number(v) || 0));
    this.setDrop({});
  }

  _sendDrop() {
    if (this.backend) {
      this.backend.param(P.drop, this.dropAmount());
      this.backend.param(P.room, this.room);
    }
    this.dispatchEvent(new Event('drop'));
  }

  apply() {
    this._sendAllParams();
  }

  _saveSoon() {
    clearTimeout(this._st);
    this._st = setTimeout(() => this.save(), 400);
  }

  /** Strum hard for a few seconds: sets Input so your loudest playing sits where the amps expect it. */
  async calibrate(seconds = 4, onTick) {
    if (!this.on || this.calibrating) return null;
    this.calibrating = true;
    this.dispatchEvent(new Event('change'));
    let peak = 0;
    const t0 = performance.now();
    try {
      while (performance.now() - t0 < seconds * 1000) {
        await wait(50);
        const l = this.levels();
        // raw input peak, before the Input knob
        peak = Math.max(peak, l.inPeak || 0);
        if (onTick) onTick((performance.now() - t0) / (seconds * 1000), peak);
      }
    } finally {
      this.calibrating = false;
    }
    if (peak < 0.003) {
      this.dispatchEvent(new Event('change'));
      return null;
    }
    // aim the hardest strum at about -6 dBFS after the Input knob
    const wantDb = -6;
    const db = 20 * Math.log10(peak);
    const knob = Math.max(0, Math.min(1, 0.5 + (wantDb - db) / 24));
    this.setKnob('input', knob);
    this.save();
    this.dispatchEvent(new Event('change'));
    return { peakDb: db, input: knob };
  }

  // ------------------------------------------------------------ readings --
  levels() {
    if (!this.on || !this.backend) return { input: 0, output: 0, clip: false, inPeak: 0 };
    return this.backend.levels();
  }

  /** Newest input samples, for note detection. */
  samples(buf) {
    if (!this.on || !this.backend) return null;
    return this.backend.samples(buf);
  }

  get sampleRate() {
    return (this.backend && this.backend.rate) || 48000;
  }

  get latencyMs() {
    return this.backend ? this.backend.latency : null;
  }

  get info() {
    return this.backend ? this.backend.info : null;
  }

  /** Detected pitch: { hz, note, octave, midi, cents } or null. Accurate to a fraction of a cent. */
  pitch() {
    if (!this.on || !this.backend) return null;
    if (!this._tb) this._tb = new Float32Array(8192);
    this.backend.samples(this._tb);
    const p = detectPitch(this._tb, this.sampleRate);
    const hz = this.smoother.push(p && p.clarity > 0.6 ? p.hz : null);
    if (!hz) return null;
    const midiF = 69 + 12 * Math.log2(hz / 440);
    const midi = Math.round(midiF);
    return { hz, midi, note: NOTE[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents: (midiF - midi) * 100, clarity: p.clarity };
  }
}

/** MIDI note of each open string for an arrangement's tuning. */
export function openStrings(tab) {
  const bass = tab && tab.type === 'bass';
  const base = bass ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64];
  const tun = (tab && tab.tuning) || [];
  const capo = (tab && tab.capo) || 0;
  return base.map((m, i) => m + (Number(tun[i]) || 0) + capo);
}

export function noteName(midi) {
  return NOTE[((midi % 12) + 12) % 12];
}

export const rig = new Rig();
if (typeof window !== 'undefined') window.__rig = rig;
