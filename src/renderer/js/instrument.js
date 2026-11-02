/**
 * Works out whether a guitar or a bass is plugged in, from what you play.
 *
 * A bass gives itself away the moment it plays below anything your guitar can
 * reach (the low E string, or wherever your guitar is tuned down to): a couple
 * of those and it's a bass. A guitar shows up as notes above the bass's usual
 * range (E4 and up), or simply as a long stretch of playing with nothing low.
 *
 * Pure logic over pitch readings, so it runs the same in the app and in tests.
 *
 * One trap: a power chord (root + fifth) repeats at half the root's frequency,
 * so a pitch reader hears a note an octave BELOW the root, which looks just like
 * a bass. `realLow()` checks a low reading against the sound itself: a real low
 * note has energy at its own frequency (or its 5th/7th harmonics); a power
 * chord's phantom note has none there.
 */

/** Strength of one frequency in a Hann-windowed buffer (Goertzel). */
function strength(buf, win, sr, hz) {
  const w = (2 * Math.PI * hz) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const s0 = buf[i] * win[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

let hann = null;
/**
 * Is this low pitch reading a real note, or the phantom of a chord above it?
 * @param {Float32Array} buf recent input (a few thousand samples)
 * @param {number} sr sample rate
 * @param {number} hz the pitch that was read
 * @returns {boolean} true when the note itself is there
 */
export function realLow(buf, sr, hz) {
  if (!hann || hann.length !== buf.length) {
    hann = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (buf.length - 1));
  }
  const at = (h) => strength(buf, hann, sr, hz * h);
  // A root + fifth only ever sounds at 2, 3, 4, 6… times the phantom pitch, never at 1, 5 or 7.
  const own = at(1) + at(5) + at(7);
  const chord = at(2) + at(3) + at(4);
  return chord <= 0 || own / chord > 0.08;
}

import { detectPitch } from './pitch.js';

const BASS_VOTES = 3; // notes below the guitar's range, within BASS_WINDOW (3, so one stray reading can't flip it mid-song)
const BASS_WINDOW = 20;
const HIGH_MIDI = 64.5; // above E4: the open high E, a bass rarely goes there
const HIGH_VOTES = 3;
const HIGH_WINDOW = 30;
const QUIET_LOW = 15; // ...and nothing low for this long
const LONG_PLAY = 45; // seconds of playing with nothing low at all → guitar
const LONG_NOTES = 20;

/**
 * One reading from the input: a clear pitch (fractional MIDI) or null.
 * @param {Float32Array} buf the last ~4096 input samples
 * @param {number} sr sample rate
 * @param {number} level input level (rms)
 * @param {number} lowest MIDI of the guitar's lowest open string
 */
export function reading(buf, sr, level, lowest = 40) {
  const p = level > 0.006 ? detectPitch(buf, sr, { threshold: 0.12 }) : null;
  if (!p || p.clarity <= 0.85) return null;
  const midi = 69 + 12 * Math.log2(p.hz / 440);
  // a power chord reads an octave below its root: that's a guitar, not a bass
  if (midi < lowest - 1.5 && !realLow(buf, sr, p.hz)) return midi + 12;
  return midi;
}

export class InstrumentSense {
  /**
   * @param {object} o
   * @param {number} o.lowest MIDI note of your guitar's lowest open string (40 = E2)
   * @param {'guitar'|'bass'|null} o.instrument what it was last time
   */
  constructor({ lowest = 40, instrument = null } = {}) {
    this.lowest = lowest;
    this.instrument = instrument;
    this.reset();
  }

  reset() {
    this.run = []; // readings of the note sounding now
    this.counted = false;
    this.votes = []; // {t, kind: 'low'|'mid'|'high'}
    this.lastLow = -Infinity;
    this.playSinceLow = 0; // seconds of sound since the last low note
    this.notesSinceLow = 0;
    this.lastT = null;
  }

  /**
   * One reading, about 20 a second.
   * @param {number} t seconds
   * @param {number|null} midi a clear, steady pitch (fractional MIDI) or null
   * @param {number} level input level (rms)
   * @returns {'guitar'|'bass'|null} the new instrument when it changes, else null
   */
  push(t, midi, level) {
    const dt = this.lastT === null ? 0 : Math.min(0.25, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (level > 0.01) this.playSinceLow += dt;
    // A note is a few steady readings in a row; count each note once.
    if (midi === null || midi === undefined || !Number.isFinite(midi)) {
      this.run = [];
      this.counted = false;
    } else {
      if (this.run.length && Math.abs(midi - this.run[this.run.length - 1]) > 0.5) {
        this.run = [];
        this.counted = false;
      }
      this.run.push(midi);
      if (this.run.length >= 3 && !this.counted) {
        this.counted = true;
        const s = [...this.run].sort((a, b) => a - b);
        this._note(t, s[s.length >> 1]);
      }
    }
    while (this.votes.length && this.votes[0].t < t - Math.max(BASS_WINDOW, HIGH_WINDOW)) this.votes.shift();
    return this._decide(t);
  }

  _note(t, m) {
    let kind = 'mid';
    if (m >= 21 && m < this.lowest - 1.5) kind = 'low';
    else if (m >= HIGH_MIDI) kind = 'high';
    this.votes.push({ t, kind });
    if (kind === 'low') {
      this.lastLow = t;
      this.playSinceLow = 0;
      this.notesSinceLow = 0;
    } else this.notesSinceLow++;
  }

  _decide(t) {
    const count = (kind, win) => this.votes.filter((v) => v.kind === kind && v.t >= t - win).length;
    let next = this.instrument;
    if (this.instrument !== 'bass' && count('low', BASS_WINDOW) >= BASS_VOTES) next = 'bass';
    else if (this.instrument !== 'guitar') {
      const high = count('high', HIGH_WINDOW) >= HIGH_VOTES && t - this.lastLow > QUIET_LOW;
      const long = this.playSinceLow >= LONG_PLAY && this.notesSinceLow >= LONG_NOTES;
      if (high || long) next = 'guitar';
    }
    if (next === this.instrument) return null;
    this.instrument = next;
    this.votes = []; // start fresh: what made the old call can't flip it straight back
    return next;
  }
}
