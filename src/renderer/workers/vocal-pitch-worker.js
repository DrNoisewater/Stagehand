/* Sing along: reads each syllable's note off the vocals stem, away from the page. */
import { pitchesFromAudio, pcmReader } from '../js/vocal-pitch.js';

self.onmessage = (e) => {
  const { id, dataOffset, channels, sampleRate, syl } = e.data;
  let { buffer, frames } = e.data;
  try {
    if (dataOffset % 2) buffer = buffer.slice(dataOffset);
    const at = dataOffset % 2 ? 0 : dataOffset;
    frames = Math.min(frames, Math.floor((buffer.byteLength - at) / (2 * channels)));
    const pcm = new Int16Array(buffer, at, frames * channels);
    self.postMessage({ id, pitches: pitchesFromAudio(pcmReader(pcm, channels, frames), sampleRate, syl) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
