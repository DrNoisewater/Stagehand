/**
 * Reads the note of each sung syllable off a recording of the singer (the
 * vocals stem), for songs whose chart has words but no notes.
 */
import { detectPitch } from './pitch.js';

/**
 * @param {(start:number, out:Float32Array) => void} read fills `out` with mono samples from sample `start` (zeros outside the audio)
 * @param {number} sr sample rate
 * @param {{t:number, d:number}[]} syl syllables
 * @returns {(number|null)[]} a MIDI note (with decimals) per syllable, or null when no steady voice was found
 */
export function pitchesFromAudio(read, sr, syl, { frame = 0.046, hop = 0.02, skip = 0.03, minVoiced = 0.4 } = {}) {
  const n = Math.round(frame * sr);
  const buf = new Float32Array(n);
  const out = [];
  for (const s of syl) {
    const from = s.t + skip;
    const to = Math.max(s.t + s.d, from + 0.09);
    const found = [];
    let frames = 0;
    for (let c = from; c <= to; c += hop) {
      frames++;
      read(Math.round(c * sr) - (n >> 1), buf);
      const r = detectPitch(buf, sr, { minHz: 70, maxHz: 1100 });
      if (r && r.clarity >= 0.6) found.push(69 + 12 * Math.log2(r.hz / 440));
    }
    if (!frames || found.length / frames < minVoiced) {
      out.push(null);
      continue;
    }
    found.sort((a, b) => a - b);
    out.push(Math.round(found[Math.floor(found.length / 2)] * 100) / 100);
  }
  return out;
}

/** A reader over 16-bit PCM (interleaved; channels are averaged). */
export function pcmReader(pcm, channels, frames) {
  return (start, out) => {
    for (let i = 0; i < out.length; i++) {
      const k = start + i;
      if (k < 0 || k >= frames) {
        out[i] = 0;
        continue;
      }
      let v = 0;
      for (let c = 0; c < channels; c++) v += pcm[k * channels + c];
      out[i] = v / (channels * 32768);
    }
  };
}
