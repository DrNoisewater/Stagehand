/** Stagehand layout rules: camera distance never changes chart-time spacing. */
export const APPROACH_UNITS = 16; // world units per song second (Rocksmith's pace, measured off gameplay video)
export function approachDepth(noteTime, chartTime, flow = 1) {
  return (noteTime - chartTime) * APPROACH_UNITS * flow;
}
export function chordSignature(notes) {
  return notes.map(n => `${n.s}:${n.f}:${n.mute ? 1 : 0}`).sort().join('|');
}
export function chordSpan(notes, anchor) {
  const frets = notes.filter(n => n.f > 0).map(n => n.f);
  const left = Math.max(0, anchor.fret - 1), right = left + (anchor.width || 4);
  if (!frets.length || (Math.min(...frets) > left && Math.max(...frets) <= right)) return [left, right];
  return [Math.min(...frets) - 1, Math.max(...frets)];
}
export function isChordRepeat(previous, current, sameHandShape = false) {
  if (!previous || chordSignature(previous.notes) !== chordSignature(current.notes)) return false;
  const gap = current.t - previous.t;
  return gap > 0 && gap <= (sameHandShape ? 1.2 : 0.65);
}
