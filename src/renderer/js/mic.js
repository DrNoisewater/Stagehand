/**
 * The singer's microphone (Sing along). A second input beside the guitar
 * cable: the page listens to it only while someone is singing and reads the
 * note being sung. The voice is played back only with auto-tune on
 * (autotune.js takes it from `src` here).
 */
import { detectPitch } from './pitch.js';
import { VoiceTracker } from './sing.js';

const KEY = 'stagehand.mic';
const CABLE = /rocksmith|real ?tone|guitar adapter/i;

function saved() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}

export const mic = new (class extends EventTarget {
  constructor() {
    super();
    this.on = false;
    this.error = null;
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.src = null; // the microphone's sound, for auto-tune
    this.buf = null;
    this.voice = new VoiceTracker();
    this.last = { voiced: false, midi: null, level: 0 };
    this.lastAt = 0;
    this.open = false; // the level gate (opens a little louder than it closes)
    this.users = new Set();
  }

  /** The microphone you picked ('' = whichever Windows uses). */
  get deviceId() {
    return saved().id || '';
  }
  get label() {
    return saved().label || '';
  }
  async setDevice(id, label = '') {
    try {
      localStorage.setItem(KEY, JSON.stringify({ id: id || '', label }));
    } catch (_) {}
    if (this.on) {
      this._close();
      await this._open();
    }
    this.dispatchEvent(new Event('change'));
  }

  /** Every sound input except the guitar cable. Names show once a microphone has been opened. */
  async devices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications' && !CABLE.test(d.label))
      .map((d) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.deviceId === 'default' ? 'The one Windows uses' : d.label || 'Microphone' }))
      .filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i);
  }

  /** Start listening for `who` (a name); the microphone stays open while anyone uses it. */
  async start(who = 'sing') {
    this.users.add(who);
    if (this.on) return true;
    return this._open();
  }

  /** `who` is done; the microphone is let go when nobody uses it. */
  stop(who = 'sing') {
    this.users.delete(who);
    if (!this.users.size) this._close();
  }

  async _open() {
    this.error = null;
    const ask = (id) =>
      navigator.mediaDevices.getUserMedia({
        audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false,
      });
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('No microphone support here.');
      try {
        this.stream = await ask(this.deviceId);
      } catch (e) {
        // the microphone you picked is unplugged: use whichever Windows has
        if (!this.deviceId) throw e;
        this.stream = await ask('');
      }
      const track = this.stream.getAudioTracks()[0];
      if (track && CABLE.test(track.label)) {
        // Windows handed us the guitar cable: that isn't a microphone
        const other = (await this.devices()).find((d) => d.id);
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
        if (!other) throw new Error('Only the guitar cable was found. Plug in a microphone (USB, headset or webcam).');
        this.stream = await ask(other.id);
      }
      // no speakers of its own: listening needs none, and an open output can stop the sound
      // engine taking the speakers for itself. Auto-tune gives it speakers when it needs them.
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive', sinkId: { type: 'none' } });
      } catch (_) {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
      }
      const src = (this.src = this.ctx.createMediaStreamSource(this.stream));
      this.node = this.ctx.createAnalyser();
      this.node.fftSize = 2048;
      this.node.smoothingTimeConstant = 0;
      src.connect(this.node); // not connected to the speakers: the voice is only listened to
      this.buf = new Float32Array(this.node.fftSize);
      this.on = true;
      this.name = (this.stream.getAudioTracks()[0] || {}).label || '';
    } catch (e) {
      this._close();
      this.error = /NotAllowed|Permission/i.test(e.name || '') ? 'Windows isn’t letting Stagehand use the microphone (Windows Settings › Privacy › Microphone).' : /NotFound|Overconstrained/i.test(e.name || '') ? 'No microphone found. Plug one in (USB, headset or webcam).' : e.message || 'The microphone couldn’t be opened.';
    }
    this.dispatchEvent(new Event('change'));
    return this.on;
  }

  _close() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.src = null;
    const was = this.on;
    this.on = false;
    this.last = { voiced: false, midi: null, level: 0 };
    this.voice.reset();
    this.open = false;
    if (was) this.dispatchEvent(new Event('change'));
  }

  /**
   * What the microphone hears now: { voiced, midi, level }. Read at most
   * every 15 ms (asking more often gives the last answer again).
   */
  read() {
    if (!this.on || !this.node) return this.last;
    const now = performance.now();
    if (now - this.lastAt < 15) return this.last;
    this.lastAt = now;
    this.node.getFloatTimeDomainData(this.buf);
    let e = 0;
    for (let i = 0; i < this.buf.length; i++) e += this.buf[i] * this.buf[i];
    const level = Math.sqrt(e / this.buf.length);
    // a little louder to start than to keep going, so a held note fading out doesn't flicker
    this.open = level > (this.open ? 0.0045 : 0.007);
    const r = this.open ? detectPitch(this.buf, this.ctx.sampleRate, { minHz: 70, maxHz: 1100 }) : null;
    const midi = r && r.clarity >= 0.5 ? 69 + 12 * Math.log2(r.hz / 440) : null;
    // steadied: wobble smoothed, octave cracks ignored, short breaths bridged (VoiceTracker)
    this.last = this.voice.push(now / 1000, midi, level);
    return this.last;
  }
})();
