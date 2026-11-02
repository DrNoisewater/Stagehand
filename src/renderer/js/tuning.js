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

/** cents: the reference pitch, off A440 (A425 ≈ −60); from: the song you tuned for. */
export function setMyTuning(kind, offs, cents = 0, from = null) {
  const all = load();
  all[kind] = norm(offs, kind);
  all[kind + 'Cents'] = Math.round(Number(cents) || 0);
  all[kind + 'From'] = from || null;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (_) {}
}

/** How far off A440 your instrument is tuned (cents), and the song you tuned it for. */
export function myCents(kind = 'guitar') {
  return Math.round(Number(load()[kind + 'Cents']) || 0);
}
export function myTuningFrom(kind = 'guitar') {
  return load()[kind + 'From'] || null;
}

/** "A425" for a tuning that isn't at A440 (from about 8 cents off), else ''. */
export function refLabel(cents) {
  const c = Number(cents) || 0;
  return Math.abs(c) < 8 ? '' : `A${Math.round(440 * Math.pow(2, c / 1200))}`;
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
 * What it takes to play a song tuned `songOffs` (A440 + songCents) on an instrument
 * tuned `mine` (A440 + mineCents):
 *   { same } | { drop: semitones } | { retune: [{ string, from, to, up }] }
 * (strings low to high, 1 = lowest), plus, for anything but same, `strings`: every
 * string low to high with { string, num (the guitar's own numbering: 1 = the thin
 * one), from, to, semis (how far, + = up, may be a fraction when the reference
 * changes), keep, target (cents above MIDI 0 to tune to), current }, and `ref`
 * ('A425' or '') when the song's reference pitch is not where you are.
 */
export function tuningPlan(songOffs, kind = 'guitar', mine = myTuning(kind), songCents = 0, mineCents = myCents(kind)) {
  const s = norm(songOffs, kind);
  const dc = Math.abs((Number(songCents) || 0) - (Number(mineCents) || 0)) >= 8 ? (Number(songCents) || 0) - (Number(mineCents) || 0) : 0;
  const d = s.map((x, i) => mine[i] - x); // how much lower the song is, per string
  if (d.every((x) => x === 0) && !dc) return { same: true };
  const n = OPEN[kind].length;
  const strings = OPEN[kind].map((m, i) => ({
    string: i + 1,
    num: n - i,
    from: noteOf(m + mine[i]),
    to: noteOf(m + s[i]),
    semis: s[i] - mine[i] + dc / 100,
    up: s[i] - mine[i] + dc / 100 > 0,
    keep: s[i] === mine[i] && !dc,
    target: (m + s[i]) * 100 + (Number(songCents) || 0),
    current: (m + mine[i]) * 100 + (Number(mineCents) || 0),
  }));
  const ref = dc ? refLabel(songCents) || 'A440' : '';
  if (!dc && d.every((x) => x === d[0]) && d[0] > 0 && d[0] <= 12) return { drop: d[0], strings, ref };
  const retune = strings.filter((x) => !x.keep).map(({ string, from, to, up }) => ({ string, from, to, up }));
  return { retune, strings, ref };
}

/** "2 semitones down", "a semitone up", "a little down (25 cents)". */
export function howFar(semis) {
  const a = Math.abs(semis);
  const dir = semis > 0 ? 'up' : 'down';
  const whole = Math.round(a);
  if (Math.abs(a - whole) < 0.08 && whole > 0) return whole === 1 ? `a semitone ${dir}` : whole === 2 ? `a whole step ${dir}` : `${whole} semitones ${dir}`;
  if (a < 0.92) return `a little ${dir} (${Math.round(a * 100)} cents)`;
  return `about ${a.toFixed(1)} semitones ${dir}`;
}

/** 4.0.6: which string a heard pitch (cents above MIDI 0) is, given where each one is now and should go. */
export function whichString(heard, strings) {
  let best = null;
  for (const s of strings) {
    for (const ref of [s.target, s.current]) {
      for (const oct of [0, -1200, 1200]) {
        const d = Math.abs(heard + oct - ref) + (oct ? 40 : 0); // an octave off: only if nothing's closer
        if (d < 350 && (!best || d < best.d)) best = { s, d, heard: heard + oct };
      }
    }
  }
  return best && { string: best.s, off: best.heard - best.s.target };
}

/** Common tunings to pick from (offsets per string, low to high). */
export const MY_TUNINGS = [[0, 0, 0, 0, 0, 0], [-1, -1, -1, -1, -1, -1], [-2, -2, -2, -2, -2, -2], [-3, -3, -3, -3, -3, -3], [-4, -4, -4, -4, -4, -4], [-2, 0, 0, 0, 0, 0], [-3, -1, -1, -1, -1, -1], [-4, -2, -2, -2, -2, -2], [-5, -3, -3, -3, -3, -3]];
export const MY_TUNINGS_BASS = [[0, 0, 0, 0], [-1, -1, -1, -1], [-2, -2, -2, -2], [-3, -3, -3, -3], [-2, 0, 0, 0], [-4, -2, -2, -2]];
