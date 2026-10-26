/* Builds a multi-resolution min/max/RMS pyramid from 16-bit PCM so waveforms
 * can be drawn at any zoom level without touching the raw samples again. */
const BASE = 64; // frames per bucket at the finest level
const FACTOR = 8;

self.onmessage = (e) => {
  const { id, buffer, dataOffset, frames, channels } = e.data;
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
