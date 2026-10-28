/**
 * Smart tuning (3.7). Stagehand remembers what your guitar (and your bass) is
 * tuned to, and when a song needs something else it says so before you play:
 *  - the song is the same tuning, just lower (E♭, D, C♯ Standard from E
 *    Standard; Drop C from Drop D…): the Drop can do it, one click (or always);
 *  - otherwise: which strings to retune, to what.
 * It learns by itself: finish a song at a good score with the Drop off and
 * that's your tuning now; "I retuned" says so straight away.
 */
const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const OPEN = { guitar: [40, 45, 50, 55, 59, 64], bass: [28, 33, 38, 43] };
const KEY = 'stagehand.myTuning';
const ALWAYS = 'stagehand.dropAuto';

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
};

function norm(offs, kind) {
  const n = OPEN[kind].length;
  return Array.from({ length: n }, (_, i) => Math.round(Number((offs || [])[i]) || 0));
}

/** What you're tuned to now (offsets from standard per string; E Standard = all 0). */
export function myTuning(kind = 'guitar') {
  const m = load()[kind];
  return norm(Array.isArray(m) ? m : [], kind);
}

export function setMyTuning(kind, offs) {
  const all = load();
  all[kind] = norm(offs, kind);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (_) {}
}

export function dropAlways() {
  try {
    return localStorage.getItem(ALWAYS) === '1';
  } catch (_) {
    return false;
  }
}
export function setDropAlways(on) {
  try {
    localStorage.setItem(ALWAYS, on ? '1' : '0');
  } catch (_) {}
}

const noteOf = (midi) => NOTES[((midi % 12) + 12) % 12];

/** "E Standard", "Drop D", "D Standard", or the notes low to high. */
export function tuningName(offs, kind = 'guitar') {
  const o = norm(offs, kind);
  const open = OPEN[kind].map((m, i) => m + o[i]);
  const rest = o.slice(1);
  if (o.every((x) => x === o[0])) return `${noteOf(open[0])} Standard`;
  if (rest.every((x) => x === rest[0]) && o[0] === rest[0] - 2) return `Drop ${noteOf(open[0])}`;
  return open.map(noteOf).join(' ');
}

/**
 * What it takes to play a song tuned `songOffs` on an instrument tuned `mine`:
 * { same } | { drop: semitones } | { retune: [{ string, from, to }] } (strings low to high, 1 = lowest).
 */
export function tuningPlan(songOffs, kind = 'guitar', mine = myTuning(kind)) {
  const s = norm(songOffs, kind);
  const d = s.map((x, i) => mine[i] - x); // how much lower the song is, per string
  if (d.every((x) => x === 0)) return { same: true };
  if (d.every((x) => x === d[0]) && d[0] > 0 && d[0] <= 12) return { drop: d[0] };
  const retune = [];
  OPEN[kind].forEach((m, i) => {
    if (s[i] !== mine[i]) retune.push({ string: i + 1, from: noteOf(m + mine[i]), to: noteOf(m + s[i]), up: s[i] > mine[i] });
  });
  return { retune };
}

/** Common tunings to pick from (offsets per string, low to high). */
export const MY_TUNINGS = [[0, 0, 0, 0, 0, 0], [-1, -1, -1, -1, -1, -1], [-2, -2, -2, -2, -2, -2], [-3, -3, -3, -3, -3, -3], [-4, -4, -4, -4, -4, -4], [-2, 0, 0, 0, 0, 0], [-3, -1, -1, -1, -1, -1], [-4, -2, -2, -2, -2, -2], [-5, -3, -3, -3, -3, -3]];
export const MY_TUNINGS_BASS = [[0, 0, 0, 0], [-1, -1, -1, -1], [-2, -2, -2, -2], [-3, -3, -3, -3], [-2, 0, 0, 0], [-4, -2, -2, -2]];
