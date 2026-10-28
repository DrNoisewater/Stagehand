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
