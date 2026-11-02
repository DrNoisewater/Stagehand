/** Highway time is speaker time, never an accumulated animation clock.
 * Offset is wall-clock milliseconds; speed converts it to chart seconds.
 */
export function visualTime(audioTime, offsetMs = 0, speed = 1) {
  return audioTime - (Number(offsetMs) || 0) * 0.001 * speed;
}
export function noteEnd(note, target) {
  return target.t + Math.max(0, note.sus ?? target.sus ?? 0);
}
/** Prefix maximum ends keep overlapping, arbitrarily long sustains visible. */
export function sustainIndex(targets) {
  let end = -Infinity;
  return targets.map(t => {
    t.sus = Math.max(t.sus || 0, ...t.notes.map(n => n.sus || 0));
    end = Math.max(end, t.t + t.sus);
    return end;
  });
}
export function firstSustain(ends, time) {
  let lo = 0, hi = ends.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ends[mid] <= time) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * How your timing sits against the beat. Each expected time takes the nearest
 * played time within `win` seconds; the middle 60 % of those gaps give the
 * offset (ms, to 5 ms) and how steady you were (ms).
 * @param {number[]} expected seconds
 * @param {number[]} played seconds (taps or picked notes)
 * @returns {{offs:number[], matched:number, ms:number|null, spread:number|null}}
 */
export function matchTiming(expected, played, win = 0.25) {
  const offs = [];
  for (const e of expected) {
    let best = null;
    for (const p of played) if (Math.abs(p - e) < win && (best === null || Math.abs(p - e) < Math.abs(best - e))) best = p;
    if (best !== null) offs.push((best - e) * 1000);
  }
  if (!offs.length) return { offs, matched: 0, ms: null, spread: null };
  const sorted = [...offs].sort((a, b) => a - b);
  const trim = sorted.slice(Math.floor(sorted.length * 0.2), Math.max(Math.floor(sorted.length * 0.2) + 1, Math.ceil(sorted.length * 0.8)));
  const mean = trim.reduce((a, b) => a + b, 0) / trim.length;
  const ms = Math.round(mean / 5) * 5;
  const spread = Math.round(Math.sqrt(trim.reduce((a, b) => a + (b - mean) ** 2, 0) / trim.length));
  return { offs, matched: offs.length, ms, spread };
}

/**
 * Where the pick really was inside a buffer that just showed a new note: the
 * detector notices a note a little after it starts (and later still when the
 * screen is slow), so this finds the attack itself. Looks at the last `look`
 * seconds; returns how long ago (seconds before the buffer's end) it began.
 * @param {Float32Array} buf the latest input samples
 * @param {number} sr sample rate
 */
export function attackAgo(buf, sr, look = 0.2) {
  const B = 64;
  const n = Math.min(buf.length, Math.round(look * sr));
  const start = buf.length - n;
  const blocks = Math.floor(n / B);
  if (blocks < 4) return 0;
  const env = new Float32Array(blocks);
  for (let k = 0; k < blocks; k++) {
    let e = 0;
    const o = start + k * B;
    for (let i = 0; i < B; i++) e += buf[o + i] * buf[o + i];
    env[k] = Math.sqrt(e / B);
  }
  let peak = 0;
  for (let k = 1; k < blocks; k++) if (env[k] > env[peak]) peak = k;
  let floor = peak;
  for (let k = peak; k >= 0; k--) if (env[k] < env[floor]) floor = k;
  const thr = env[floor] + 0.25 * (env[peak] - env[floor]);
  let k = floor;
  while (k < peak && env[k] < thr) k++;
  return (blocks - k) * B / sr;
}
