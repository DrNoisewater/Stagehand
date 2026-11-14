/**
 * Auto-tune and the voice changer for singing (4.17): your voice from the
 * microphone, moved onto the right notes (and made deep, high…) and played
 * with the song. Off until you pick a style or a voice (the Sing menu on the
 * highway, the Karaoke page, or Settings › Guitar & audio), or ask just to
 * hear your own voice (4.17.2: no tuning, nothing changed, not late at all).
 *
 * The tuning itself is worklets/autotune-worklet.js. This file decides when
 * it runs (a microphone is open and a style is picked) and where the voice
 * goes: into the sound engine when it holds the speakers (it plays the voice
 * with the song and your guitar), otherwise straight to the speakers.
 */
import { mic } from './mic.js';
import { rig } from './rig.js';

const KEY = 'stagehand.autotune';
export const TUNE_STYLES = [
  ['off', 'Off', ''],
  ['natural', 'Natural', 'Gently pulled onto the note; your vibrato stays'],
  ['pop', 'Pop', 'Tight, like a polished record'],
  ['robot', 'Hard tune', 'Snaps to every note: the T-Pain sound from rap records'],
];
export const TUNE_NOTES = [
  ['song', 'The song’s notes', 'What the singer sings, in your octave'],
  ['near', 'The nearest note', 'Whatever you sing, made exact'],
];
/** Voice changer: works with auto-tune or on its own. The note only moves by whole octaves, so it still fits the song. */
export const TUNE_VOICES = [
  ['normal', 'My own voice', ''],
  ['deep', 'Deep', 'Bigger and darker, the same notes'],
  ['high', 'High', 'Smaller and brighter, the same notes'],
  // 'giant' is the old id, kept so saved choices still work
  ['giant', 'Villain', 'An octave down, dark and menacing, like a horror-film villain'],
  ['monster', 'Monster', 'An octave down with a rough growl under it'],
  ['chipmunk', 'Chipmunk', 'An octave up and tiny, like a sped-up tape'],
  ['droid', 'Robot', 'Every line on one flat, buzzing note'],
  ['alien', 'Alien', 'Wobbly and metallic, from another planet'],
  ['radio', 'Radio', 'Thin and crunchy, like an old radio or a phone call'],
  ['stadium', 'Stadium', 'Big echoes, like singing in an arena'],
];
export const TUNE_LEVELS = [
  [0.5, 'Quiet'],
  [0.8, 'Normal'],
  [1.15, 'Loud'],
  [1.5, 'Louder'],
];

function saved() {
  try {
    return { style: 'off', notes: 'song', vol: 0.8, voice: 'normal', hear: false, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) };
  } catch (_) {
    return { style: 'off', notes: 'song', vol: 0.8, voice: 'normal', hear: false };
  }
}

export const autotune = new (class extends EventTarget {
  constructor() {
    super();
    this.p = saved();
    this.node = null;
    this.ctx = null;
    this.line = null; // the line into the sound engine, when it plays the voice
    this.pagePort = null;
    this.route = null; // 'engine' | 'speakers'
    this.song = null;
    this.state = { voiced: false, sung: null, target: null };
    this.lastClock = 0;
    this.listeners = new Set(); // who wants the notes read (the scoring), even with nothing playing
    this._busy = Promise.resolve();
    mic.addEventListener('change', () => this.sync());
    rig.addEventListener('change', () => this.sync());
    // the sound engine wants the speakers to itself: let go, and see where the voice goes once it is up
    rig.addEventListener('starting', () => {
      if (this.route !== 'speakers' || !this.ctx) return;
      this.route = null;
      if (this.ctx.setSinkId) this.ctx.setSinkId({ type: 'none' }).catch(() => {});
    });
  }

  get style() {
    return TUNE_STYLES.some(([id]) => id === this.p.style) ? this.p.style : 'off';
  }
  get notes() {
    return this.p.notes === 'near' ? 'near' : 'song';
  }
  get voice() {
    return TUNE_VOICES.some(([id]) => id === this.p.voice) ? this.p.voice : 'normal';
  }
  /** Hear my voice: played with the song even with no style and no voice changer (4.17.2). */
  get hear() {
    return !!this.p.hear;
  }
  /** A tuning style or a changed voice is picked, or Hear my voice is on (whether or not it is muted). */
  get picked() {
    return this.style !== 'off' || this.voice !== 'normal' || this.hear;
  }
  /** Muted: your choices are kept, but your voice isn't played (4.17.1). */
  get muted() {
    return !!this.p.muted;
  }
  /** Is the voice wanted out loud (something is picked, and it isn't muted)? */
  get wanted() {
    return this.picked && !this.muted;
  }
  get vol() {
    return Number.isFinite(this.p.vol) ? this.p.vol : 0.8;
  }
  /** Is a tuned voice going out right now? */
  get on() {
    return !!this.node && this.wanted;
  }

  _save(k, v) {
    this.p[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.p));
    } catch (_) {}
    this._send();
    this.sync();
    this.dispatchEvent(new Event('change'));
  }
  setStyle(v) {
    this.p.muted = false; // picking something turns your voice back on
    this._save('style', v);
  }
  setNotes(v) {
    this._save('notes', v === 'near' ? 'near' : 'song');
  }
  setVoice(v) {
    this.p.muted = false; // picking something turns your voice back on
    this._save('voice', v);
  }
  /** Hear my voice on or off (on turns your voice back on if it was muted). */
  setHear(on) {
    if (on) this.p.muted = false;
    this._save('hear', !!on);
  }
  setMuted(on) {
    this._save('muted', !!on);
  }
  setVol(v) {
    this._save('vol', Math.max(0, Math.min(1.5, Number(v) || 0)));
  }

  /** The notes of the song being sung ([{ t, d, p }], p null where there is none), or null. */
  setSong(syl) {
    this.song = syl && syl.length ? syl.filter((s) => s.p !== null && s.p !== undefined).map((s) => ({ t: s.t, d: s.d, p: s.p })) : null;
    if (this.node) this.node.port.postMessage({ type: 'song', notes: this.song });
  }

  /** Where the song is (seconds) and how fast it runs (0 = stopped). Call it often; it sends a few times a second. */
  clock(t, rate) {
    if (!this.node) return;
    const now = performance.now();
    if (now - this.lastClock < 120 && rate === this.lastRate) return;
    this.lastClock = now;
    this.lastRate = rate;
    this.node.port.postMessage({ type: 'clock', t, rate });
  }

  _send() {
    // nothing wanted out loud (only listening for the scoring): silent
    if (this.node) this.node.port.postMessage({ type: 'set', style: this.style, mode: this.notes, vol: this.wanted ? this.vol : 0, voice: this.voice });
  }

  /**
   * `who` (a name) wants the notes read from the microphone while it is open, even with nothing
   * playing: 'pitch' events then come every 20 ms ({ detail: { t, hop, midi, level } }: midi is a
   * Float32Array of readings hop seconds apart, NaN where no note was heard, the last one read at
   * about t on the microphone's sound clock, mic.ctx.currentTime).
   */
  listen(who, on = true) {
    if (on) this.listeners.add(who);
    else this.listeners.delete(who);
    this.sync();
  }

  /** Starts, stops or re-routes the tuned voice to match what is open now. One at a time. */
  sync() {
    const run = this._busy.then(() => this._sync());
    this._busy = run.catch(() => {});
    return run;
  }

  async _sync() {
    const want = mic.on && mic.ctx && mic.src && (this.wanted || this.listeners.size);
    if (!want) return this._stop();
    const ctx = mic.ctx;
    if (this.ctx !== ctx) {
      this._stop();
      await ctx.audioWorklet.addModule(new URL('../worklets/autotune-worklet.js', import.meta.url));
      if (mic.ctx !== ctx || !(this.wanted || this.listeners.size)) return;
      this.ctx = ctx;
      this.node = new AudioWorkletNode(ctx, 'stagehand-autotune', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit' });
      this.node.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'state') this.state = m;
        else if (m.type === 'voice') this._relay(m.d);
        else if (m.type === 'pitch') this.dispatchEvent(new CustomEvent('pitch', { detail: m }));
      };
      mic.src.connect(this.node);
      this.node.connect(ctx.destination);
      this._send();
      this.node.port.postMessage({ type: 'song', notes: this.song });
      this.route = null;
    }
    this._send();
    if (!this.wanted) {
      // only listening: nowhere to go
      if (this.route) {
        this._unline();
        this.node.port.postMessage({ type: 'port', port: null });
        this.node.port.postMessage({ type: 'relay', on: false });
        if (ctx.setSinkId) await ctx.setSinkId({ type: 'none' }).catch(() => {});
        this.route = null;
        this.dispatchEvent(new Event('change'));
      }
      return;
    }
    // where the voice goes: the sound engine when it holds the speakers, else the speakers
    const engine = rig.voiceNative;
    if (engine && this.route === 'engine' && this.line && this.line.backend === rig.backend) return;
    if (!engine && this.route === 'speakers') return;
    this._unline();
    if (engine) {
      const line = await rig.voiceLine(ctx.sampleRate);
      if (this.ctx !== ctx || !this.node) {
        if (line) line.port.close();
        return;
      }
      if (line) {
        this.line = line;
        let relay = false;
        try {
          relay = localStorage.getItem('stagehand.songRelay') === '1';
        } catch (_) {}
        if (relay) {
          // through the page (as the song does when a line can't reach the engine from the sound thread)
          this.pagePort = line.port;
          this.node.port.postMessage({ type: 'relay', on: true });
        } else this.node.port.postMessage({ type: 'port', port: line.port }, [line.port]);
        if (ctx.setSinkId) await ctx.setSinkId({ type: 'none' }).catch(() => {});
        this.route = 'engine';
        this.dispatchEvent(new Event('change'));
        return;
      }
    }
    this.node.port.postMessage({ type: 'port', port: null });
    this.node.port.postMessage({ type: 'relay', on: false });
    if (ctx.setSinkId) await ctx.setSinkId((rig.player && rig.player.sinkId) || '').catch(() => {});
    this.route = 'speakers';
    this.dispatchEvent(new Event('change'));
  }

  /** The sound thread couldn't reach the engine itself: pass its sound on from here. */
  _relay(d) {
    if (this.pagePort) return this.pagePort.postMessage({ t: 'voice', d });
    if (this._asking || !this.line) return;
    this._asking = true;
    const line = this.line;
    rig
      .voiceLine(this.ctx ? this.ctx.sampleRate : 48000)
      .then((l) => {
        if (l && this.line === line) this.pagePort = l.port;
        else if (l) l.port.close();
      })
      .finally(() => (this._asking = false));
  }

  _unline() {
    if (this.line) {
      try {
        this.line.close();
      } catch (_) {}
    }
    if (this.pagePort) this.pagePort.close();
    this.pagePort = null;
    this.line = null;
  }

  _stop() {
    const was = this.on;
    this._unline();
    if (this.node) {
      try {
        this.node.port.postMessage({ type: 'port', port: null });
        this.node.port.onmessage = null;
        this.node.disconnect();
        if (mic.src && this.ctx === mic.ctx) mic.src.disconnect(this.node);
      } catch (_) {}
      // back to listening only
      if (this.ctx && this.ctx === mic.ctx && this.ctx.setSinkId) this.ctx.setSinkId({ type: 'none' }).catch(() => {});
    }
    this.node = null;
    this.ctx = null;
    this.route = null;
    this.state = { voiced: false, sung: null, target: null };
    if (was) this.dispatchEvent(new Event('change'));
  }
})();
