/* Builds a multi-resolution min/max/RMS pyramid from 16-bit PCM so waveforms
 * can be drawn at any zoom level without touching the raw samples again. */
const BASE = 64; // frames per bucket at the finest level
const FACTOR = 8;

/** Decoded floats → a 16-bit stereo WAV (the layout the player streams). */
function wavFrom(L, R, rate) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + n * 4, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  tag(36, 'data');
  dv.setUint32(40, n * 4, true);
  const pcm = new Int16Array(buf, 44, n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.round(L[i] * 32767);
    const b = Math.round(R[i] * 32767);
    pcm[i * 2] = a > 32767 ? 32767 : a < -32768 ? -32768 : a;
    pcm[i * 2 + 1] = b > 32767 ? 32767 : b < -32768 ? -32768 : b;
  }
  return buf;
}

self.onmessage = (e) => {
  let { id, buffer, dataOffset, frames, channels } = e.data;
  if (e.data.L) {
    buffer = wavFrom(e.data.L, e.data.R, e.data.rate);
    dataOffset = 44;
    frames = e.data.L.length;
    channels = 2;
  }
  let pcm;
  if (dataOffset % 2 === 0) {
    pcm = new Int16Array(buffer, dataOffset, frames * channels);
  } else {
    pcm = new Int16Array(buffer.slice(dataOffset, dataOffset + frames * channels * 2));
  }
  const n0 = Math.ceil(frames / BASE);
  const min0 = new Float32Array(n0);
  const max0 = new Float32Array(n0);
  const rms0 = new Float32Array(n0);
  const k = 1 / 32768;
  let peak = 0;
  let sumAll = 0;
  for (let b = 0; b < n0; b++) {
    const f0 = b * BASE;
    const f1 = Math.min(frames, f0 + BASE);
    let lo = 1;
    let hi = -1;
    let sq = 0;
    const i0 = f0 * channels;
    const i1 = f1 * channels;
    for (let i = i0; i < i1; i++) {
      const v = pcm[i] * k;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sq += v * v;
    }
    const cnt = Math.max(1, i1 - i0);
    min0[b] = lo > hi ? 0 : lo;
    max0[b] = lo > hi ? 0 : hi;
    rms0[b] = Math.sqrt(sq / cnt);
    sumAll += sq;
    const a = Math.max(-lo, hi);
    if (a > peak) peak = a;
  }
  const levels = [{ size: BASE, min: min0, max: max0, rms: rms0 }];
  let prev = levels[0];
  while (prev.min.length > 2048) {
    const n = Math.ceil(prev.min.length / FACTOR);
    const mn = new Float32Array(n);
    const mx = new Float32Array(n);
    const rm = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      const s = b * FACTOR;
      const e2 = Math.min(prev.min.length, s + FACTOR);
      let lo = 1;
      let hi = -1;
      let sq = 0;
      for (let i = s; i < e2; i++) {
        if (prev.min[i] < lo) lo = prev.min[i];
        if (prev.max[i] > hi) hi = prev.max[i];
        sq += prev.rms[i] * prev.rms[i];
      }
      mn[b] = lo;
      mx[b] = hi;
      rm[b] = Math.sqrt(sq / Math.max(1, e2 - s));
    }
    prev = { size: prev.size * FACTOR, min: mn, max: mx, rms: rm };
    levels.push(prev);
  }
  const transfer = [buffer];
  for (const l of levels) transfer.push(l.min.buffer, l.max.buffer, l.rms.buffer);
  self.postMessage(
    { id, buffer, levels, peak, rms: Math.sqrt(sumAll / Math.max(1, frames * channels)) },
    transfer
  );
};
