/**
 * Piano: a two-hand piano part written from the song itself, the way piano /
 * vocal / guitar sheet music is arranged. No page and no keyboard here, only
 * the rules, so they can be tested on their own.
 *
 * - The right hand plays the tune: the singer's own notes, word for word.
 *   Where nobody sings (intro, solo, breaks) it plays the lead guitar's riff.
 * - The chords are read from what the band plays: the rhythm guitar's chords
 *   and the bass's notes, beat by beat, named as on a lead sheet (E5, Am, G7).
 * - The left hand plays the bass line (Hard), or the chord's root in the bass's
 *   own rhythm (Medium). Easy is the tune on its own.
 * - Everything sits on the song's own beats and bars, so it reads as sheet
 *   music: a note starts on a sixteenth and lasts whole sixteenths.
 */

/** Steps per beat: sixteenths when a beat is a quarter note. */
export const TPB = 4;

export const KEYS_LEVELS = {
  easy: { name: 'Easy', hint: 'The tune, right hand only' },
  medium: { name: 'Medium', hint: 'The tune, and the chord roots in your left hand' },
  hard: { name: 'Hard', hint: 'The tune with its chords, and the real bass line' },
};

const NAMES_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const NAMES_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
/** Key signatures: the number of sharps (+) or flats (−) of each major key's tonic. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/** A note's name in a key (sharps in sharp keys, flats in flat keys). */
export function noteName(midi, fifths = 0) {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return (fifths < 0 ? NAMES_FLAT : NAMES_SHARP)[pc];
}

/** The note a fretted string sounds, as a piano key (the song's tuning, capo; the nearest key for off-pitch songs). */
export function concertMidi(tab, s, f) {
  const base = tab.type === 'bass' ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64];
  const tun = Number((tab.tuning || [])[s]) || 0;
  const fret = f === 0 && tab.capo ? tab.capo : f;
  return Math.round(base[s] + tun + fret + (tab.cents || 0) / 100);
}

// ------------------------------------------------------------- the grid --
/**
 * The song's beats as a ruler: song time ↔ steps (sixteenths), and its bars.
 * beats: [{ t, m }] where m >= 0 starts a bar (as in the charts).
 */
export function makeGrid(beats, length = 0) {
  let B = (beats || []).map((b) => b.t).filter(Number.isFinite);
  if (B.length < 2) {
    // no beat map: a steady 120 a minute
    B = [];
    for (let t = 0; t <= Math.max(4, length) + 2; t += 0.5) B.push(t);
  }
  const first = B[1] - B[0];
  const last = B[B.length - 1] - B[B.length - 2];
  /** Song time → steps (not rounded). */
  const stepOf = (t) => {
    if (t <= B[0]) return ((t - B[0]) / first) * TPB;
    if (t >= B[B.length - 1]) return (B.length - 1 + (t - B[B.length - 1]) / last) * TPB;
    let a = 0;
    let b = B.length - 1;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (B[m] <= t) a = m;
      else b = m;
    }
    return (a + (t - B[a]) / (B[a + 1] - B[a])) * TPB;
  };
  /** Steps → song time. */
  const timeOf = (k) => {
    const i = Math.floor(k / TPB);
    const f = k / TPB - i;
    if (i < 0) return B[0] + (k / TPB) * first;
    if (i >= B.length - 1) return B[B.length - 1] + (k / TPB - (B.length - 1)) * last;
    return B[i] + f * (B[i + 1] - B[i]);
  };
  // bars: where the chart marks a downbeat; a few beats before the first one make a pickup bar
  const starts = [];
  (beats || []).forEach((b, i) => b.m >= 0 && starts.push(i));
  if (!starts.length) for (let i = 0; i < B.length; i += 4) starts.push(i);
  if (starts[0] > 0) starts.unshift(0);
  const bars = starts
    .map((b0, i) => {
      const b1 = i + 1 < starts.length ? starts[i + 1] : B.length - 1;
      return { k0: b0 * TPB, k1: b1 * TPB, beats: b1 - b0, pickup: i === 0 && starts.length > 2 && b1 - b0 < starts[2] - starts[1] };
    })
    .filter((b) => b.beats > 0); // the chart's last downbeat has nothing after it
  /** The bar a step falls in. */
  const barAt = (k) => {
    let a = 0;
    let b = bars.length - 1;
    if (k < bars[0].k0) return 0;
    while (a < b) {
      const m = (a + b + 1) >> 1;
      if (bars[m].k0 <= k) a = m;
      else b = m - 1;
    }
    return a;
  };
  /** Song time → the step a note there is written on (set to the song's feel by arrange()). */
  const q = (t) => Math.round(stepOf(t));
  return { stepOf, timeOf, bars, barAt, q, steps: (B.length - 1) * TPB };
}

/**
 * Straight or swung: in a shuffle the note between two beats lands about two
 * thirds of the way through the beat, not halfway. Sheet music writes those
 * as plain eighths under a "Swing" mark, so they're written that way here.
 */
export function detectFeel(times, grid) {
  let straight = 0;
  let swung = 0;
  for (const t of times) {
    const x = grid.stepOf(t) / TPB;
    const f = x - Math.floor(x);
    if (Math.abs(f - 0.5) < 0.06) straight++;
    else if (Math.abs(f - 2 / 3) < 0.06) swung++;
  }
  return swung >= 12 && swung > straight * 2 ? 'swing' : 'straight';
}

/** Where a note at song time t is written, in this feel: the nearest sixteenth, or in a shuffle the beat or the eighth after it. */
export function snapper(grid, feel) {
  if (feel !== 'swing') return (t) => Math.round(grid.stepOf(t));
  return (t) => {
    const x = grid.stepOf(t) / TPB;
    const b = Math.floor(x);
    const f = x - b;
    const pos = f < 0.2 ? 0 : f < 0.45 ? 0.25 : f < 0.83 ? 0.5 : 1;
    return Math.round((b + pos) * TPB);
  };
}

// --------------------------------------------------------- the parts --
/** A guitar or bass part as sounding events: { t, end, midis[], top, low }. Muted notes are left out; held-on notes lengthen the note before. */
export function partEvents(tab) {
  if (!tab) return [];
  const out = [];
  const lastOn = new Map(); // string → its last event (for held-on notes)
  const all = [];
  for (const n of tab.notes || []) all.push({ t: n.t, sus: n.sus || 0, strings: [n] });
  for (const c of tab.chordEvents || []) all.push({ t: c.t, sus: c.sus || 0, strings: c.strings || [], chord: c.chord });
  all.sort((a, b) => a.t - b.t);
  for (const e of all) {
    const live = e.strings.filter((x) => !x.mute);
    if (!live.length) continue;
    const fresh = live.filter((x) => !x.linked);
    for (const x of live) {
      if (!x.linked) continue;
      const prev = lastOn.get(x.s);
      if (prev) prev.end = Math.max(prev.end, e.t + Math.max(e.sus, x.sus || 0));
    }
    if (!fresh.length) continue;
    const midis = [...new Set(fresh.map((x) => concertMidi(tab, x.s, x.f)))].sort((a, b) => a - b);
    const ev = { t: e.t, end: e.t + e.sus, midis, top: midis[midis.length - 1], low: midis[0], chord: e.chord, held: e.sus > 0 };
    out.push(ev);
    for (const x of fresh) lastOn.set(x.s, ev);
  }
  return out;
}

/**
 * Events on the grid, one voice: each one starts on a step and lasts whole
 * steps. A note with no length of its own (a picked note, not held) lasts
 * until the next one, a beat at most.
 */
function onGrid(events, grid, high = true) {
  const out = [];
  for (const e of events) {
    const k = grid.q(e.t);
    const m = high ? e.top : e.low;
    const prev = out[out.length - 1];
    if (prev && prev.k === k) {
      // two at once: the top one for a tune, the bottom one for a bass line
      if (high ? m > prev.midi : m < prev.midi) prev.midi = m;
      prev.endT = Math.max(prev.endT, e.end);
      continue;
    }
    out.push({ k, midi: m, endT: e.end, held: e.held, t: e.t });
  }
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    const next = out[i + 1] ? out[i + 1].k : Infinity;
    const own = grid.q(n.endT) - n.k;
    n.len = Math.max(1, Math.min(next - n.k, n.held && own > 0 ? own : Math.min(TPB, next - n.k)));
  }
  return out;
}

// -------------------------------------------------------- the chords --
const QUALITIES = [
  ['', [0, 4, 7]],
  ['m', [0, 3, 7]],
  ['5', [0, 7]],
  ['7', [0, 4, 7, 10]],
  ['maj7', [0, 4, 7, 11]],
  ['m7', [0, 3, 7, 10]],
  ['sus4', [0, 5, 7]],
  ['sus2', [0, 2, 7]],
  ['dim', [0, 3, 6]],
];

/**
 * The chord that fits a weighting of the twelve notes best, and the one the
 * bass plays (bassPc) counts for the root. Returns { root, q, pcs } or null.
 */
export function bestChord(w, bassPc = null) {
  const total = w.reduce((a, b) => a + b, 0);
  if (total < 1e-6) return null;
  let best = null;
  for (let r = 0; r < 12; r++) {
    for (const [q, iv] of QUALITIES) {
      const pcs = iv.map((x) => (r + x) % 12);
      let inside = 0;
      for (const p of pcs) inside += w[p];
      let score = inside - (total - inside) * 1.1;
      // the root and the fifth carry a chord; a chord whose root isn't sounding is a guess
      score += w[r] * 0.5 + w[(r + 7) % 12] * 0.15;
      if (w[r] < total * 0.08) score -= total * 0.5;
      if (bassPc === r) score += total * 0.35;
      // every note in the chord should be heard, and simpler names win ties
      for (const p of pcs) if (w[p] < total * 0.04) score -= total * 0.3;
      score -= (pcs.length - 2) * total * 0.02;
      const heard = pcs.filter((p) => w[p] >= total * 0.08).length;
      if (!best || score > best.score) best = { root: r, q, pcs, score, inside: inside / total, heard };
    }
  }
  // a riff walking through notes that make no chord isn't one (sheet music writes N.C. there)
  // and a chord needs its notes: three of them, or both for a power chord
  return best && best.inside >= 0.72 && best.heard >= Math.min(3, best.pcs.length) ? best : null;
}

/** A chord's name as on a lead sheet (E5, F♯m, B♭7). */
export function chordName(c, fifths = 0) {
  return c ? noteName(c.root, fifths) + c.q : '';
}

/** Reads a chart's own chord name ("F#m7", "Bb", "E5") as { root, q }, or null. */
export function parseChordName(name) {
  const m = /^([A-G])([#b♯♭]?)(.*)$/.exec(String(name || '').trim());
  if (!m) return null;
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0);
  const rest = m[3].replace(/\/.*$/, '').trim();
  const q = /^(min|m)(?!aj)7/.test(rest) ? 'm7' : /^(min|m)(?!aj)/.test(rest) ? 'm' : /^maj7/.test(rest) ? 'maj7' : /^7/.test(rest) ? '7' : /^5/.test(rest) ? '5' : /^sus4|^sus$/.test(rest) ? 'sus4' : /^sus2/.test(rest) ? 'sus2' : /^dim/.test(rest) ? 'dim' : rest === '' || /^maj$|^M$/.test(rest) ? '' : null;
  if (q === null) return null;
  const iv = QUALITIES.find((x) => x[0] === q)[1];
  const root = ((pc % 12) + 12) % 12;
  return { root, q, pcs: iv.map((x) => (root + x) % 12) };
}

/**
 * The chords, from what the band plays: each chord the guitar strikes is named
 * from its own notes (a riff of power chords is a riff of power chords); where
 * it plays single notes, the chord is read beat by beat from those notes and
 * the bass (the bass names the root). Merged into spans:
 * [{ k, len, root, q, pcs }] (a span shorter than a beat is part of a riff).
 */
export function readChords({ rhythm = [], bass = [], lead = [] }, grid, chordNames = []) {
  const beats = Math.max(1, Math.ceil(grid.steps / TPB));
  const pcOf = (m) => ((m % 12) + 12) % 12;
  // 1. chords the guitar strikes
  const struck = [];
  const struckBeat = new Uint8Array(beats);
  for (const e of rhythm) {
    if (e.midis.length < 2) continue;
    const k = grid.q(e.t);
    let c = e.chord !== undefined && chordNames[e.chord] ? parseChordName(chordNames[e.chord]) : null;
    if (!c) {
      const w = new Array(12).fill(0);
      for (const m of e.midis) w[pcOf(m)] += 1;
      c = bestChord(w, pcOf(e.low));
    }
    if (!c) continue;
    // it lasts while it rings, to the end of that beat at least
    const own = Math.max(k + 1, grid.q(Math.max(e.end, e.t)));
    struck.push({ k, c, end: Math.ceil(own / TPB) * TPB });
    const b = Math.floor(k / TPB);
    if (b >= 0 && b < beats) struckBeat[b] = 1;
  }
  // 2. beat by beat where nothing is struck
  const W = Array.from({ length: beats }, () => new Float32Array(12));
  const bassAt = new Array(beats).fill(null);
  const bassMoves = Array.from({ length: beats }, () => new Set()); // the notes the bass starts in each beat
  const add = (events, weight, isBass) => {
    for (const e of events) {
      if (!isBass && e.midis.length > 1) continue;
      const k0 = grid.stepOf(e.t) / TPB;
      const k1 = Math.max(k0 + 0.5, grid.stepOf(Math.max(e.end, e.t)) / TPB);
      for (let b = Math.max(0, Math.floor(k0)); b < Math.min(beats, Math.ceil(k1)); b++) {
        const cover = Math.max(0, Math.min(b + 1, k1) - Math.max(b, k0));
        if (cover <= 0) continue;
        for (const m of e.midis) W[b][pcOf(m)] += cover * weight;
        if (isBass && (bassAt[b] === null || Math.abs(k0 - b) < 0.3)) bassAt[b] = pcOf(e.low);
        if (isBass && k0 >= b && k0 < b + 1) bassMoves[b].add(pcOf(e.low));
      }
    }
  };
  add(rhythm, 1, false);
  add(bass, 1.4, true);
  const points = struck.slice();
  let prev = null;
  let lastStruck = -Infinity;
  for (let b = 0; b < beats; b++) {
    // a struck chord rings on: the beats after it (within a bar) belong to it
    if (struckBeat[b]) lastStruck = b;
    if (b - lastStruck < 4) {
      prev = null;
      continue;
    }
    const total = W[b].reduce((x, y) => x + y, 0);
    // the bass running through notes inside one beat is a riff, not a chord
    let c = total > 0.35 && bassMoves[b].size < 2 ? bestChord(W[b], bassAt[b]) : null;
    if (!c && prev && total > 0) c = prev;
    if (c) points.push({ k: b * TPB, c, beat: true, end: (b + 1) * TPB });
    prev = c;
  }
  points.sort((x, y) => x.k - y.k);
  // a chord heard for one beat between two of the same, off the downbeat, is a passing one
  const downbeat = new Set(grid.bars.map((b) => b.k0));
  const same = (a, b) => a && b && a.root === b.root && a.q === b.q;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (p.beat && !downbeat.has(p.k) && same(points[i - 1].c, points[i + 1].c) && !same(p.c, points[i - 1].c)) p.c = points[i - 1].c;
  }
  const spans = [];
  for (let i = 0; i < points.length; i++) {
    const { k, c } = points[i];
    const end = Math.min(points[i].end, i + 1 < points.length ? points[i + 1].k : Infinity);
    if (end <= k) continue;
    const last = spans[spans.length - 1];
    if (last && same(last, c) && last.k + last.len >= k) last.len = end - last.k;
    else spans.push({ k, len: end - k, root: c.root, q: c.q, pcs: c.pcs });
  }
  return spans;
}

// ----------------------------------------------------------- the key --
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** The key, from how long each note sounds: { tonic, minor, fifths, name }. */
export function findKey(w) {
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const corr = (prof, r) => {
    const mw = mean(w);
    const mp = mean(prof);
    let num = 0;
    let dw = 0;
    let dp = 0;
    for (let i = 0; i < 12; i++) {
      const a = w[(i + r) % 12] - mw;
      const b = prof[i] - mp;
      num += a * b;
      dw += a * a;
      dp += b * b;
    }
    return dw && dp ? num / Math.sqrt(dw * dp) : 0;
  };
  let best = { tonic: 0, minor: false, r: -Infinity };
  const top = Math.max(...w) || 1;
  for (let r = 0; r < 12; r++) {
    // how well the notes fit the key, and how much its home note is heard (which tells C major from A minor)
    const home = (w[r] / top) * 0.15;
    const a = corr(KS_MAJ, r) + home;
    const b = corr(KS_MIN, r) + home;
    if (a > best.r) best = { tonic: r, minor: false, r: a };
    if (b > best.r) best = { tonic: r, minor: true, r: b };
  }
  const rel = best.minor ? (best.tonic + 3) % 12 : best.tonic;
  let fifths = MAJOR_FIFTHS[rel];
  const name = `${noteName(best.tonic, fifths)} ${best.minor ? 'minor' : 'major'}`;
  return { tonic: best.tonic, minor: best.minor, fifths, name };
}

// ---------------------------------------------------------- the tune --
/** The octave (in semitones) that moves a line so its middle sits at or above `low` (and not needlessly high). */
function placeOctave(midis, low, high) {
  if (!midis.length) return 0;
  const s = [...midis].sort((a, b) => a - b);
  const mid = s[Math.floor(s.length / 2)];
  let shift = 0;
  while (mid + shift < low) shift += 12;
  while (mid + shift > high) shift -= 12;
  return shift;
}

/** The singer's notes on the grid: [{ k, len, midi, word }]. */
function vocalLine(lyrics, grid) {
  const syl = (lyrics || []).filter((w) => Number.isFinite(w.p) && w.p >= 36 && w.p <= 96);
  const out = [];
  for (const w of syl) {
    const k = grid.q(w.t);
    const end = Math.max(k + 1, grid.q(w.t + (w.d || 0.2)));
    const word = String(w.w || '').replace(/\+$/, '').replace(/-+$/, '-');
    const prev = out[out.length - 1];
    if (prev && prev.k === k) {
      // two syllables on one step: the longer one stays, the words go together
      prev.word = `${prev.word.replace(/-$/, '')}${word}`;
      if (end - k > prev.len) Object.assign(prev, { len: end - k, midi: Math.round(w.p) });
      continue;
    }
    if (prev && prev.k + prev.len > k) prev.len = Math.max(1, k - prev.k);
    out.push({ k, len: end - k, midi: Math.round(w.p), word, t: w.t });
  }
  return out;
}

// --------------------------------------------------------- arranging --
/**
 * A chord voiced for the right hand, near the one before it (as a pianist
 * moves between chords: the fewest and smallest steps), between G3 and G5.
 * A power chord stays root, fifth and octave.
 */
export function voiceChord(c, prev = null) {
  const pcs = c.q === '5' ? [c.root, (c.root + 7) % 12] : c.pcs.slice(0, 4);
  const cands = [];
  for (let base = 52; base <= 70; base++) {
    if (((base % 12) + 12) % 12 !== pcs[0] && c.q === '5') continue;
    // each candidate: the chord's notes stacked upward from `base`, each note once
    if (!pcs.includes(((base % 12) + 12) % 12)) continue;
    const notes = [base];
    let m = base;
    const left = pcs.filter((p) => p !== ((base % 12) + 12) % 12);
    while (left.length) {
      m++;
      const i = left.indexOf(((m % 12) + 12) % 12);
      if (i >= 0) {
        notes.push(m);
        left.splice(i, 1);
      }
    }
    if (c.q === '5') notes.push(base + 12);
    if (notes[0] < 55 || notes[notes.length - 1] > 79) continue;
    cands.push(notes);
  }
  if (!cands.length) return pcs.map((p) => 60 + ((p - 60) % 12 + 12) % 12).sort((a, b) => a - b);
  const cost = (v) => {
    if (!prev) return Math.abs(v.reduce((a, b) => a + b, 0) / v.length - 64) + (v[0] % 12 === c.root ? 0 : 5); // root position near the middle to begin
    let d = 0;
    for (const m of v) d += Math.min(...prev.map((p) => Math.abs(p - m)));
    return d + Math.abs(v[0] - prev[0]) * 0.3;
  };
  return cands.sort((a, b) => cost(a) - cost(b))[0];
}

/**
 * Writes the piano part. Input: the song's parts as tabs (any may be
 * missing), its lyrics (with notes), its beats. Output:
 * { grid, key, feel, chords, levels: { easy, medium, hard }, sources } where
 * each level is a list of notes { k, len, midi, hand: 'R'|'L', role, word?, t, d }
 * sorted by time. k/len are where the note is written (sixteenths); t/d are
 * when it sounds in the recording (what you're scored against).
 */
export function arrange({ lead = null, rhythm = null, bass = null, lyrics = [], beats = null, length = 0 }) {
  const any = lead || rhythm || bass;
  const grid = makeGrid(beats || (any && any.beats) || [], length || (any && any.length) || 0);
  const ev = { lead: partEvents(lead), rhythm: partEvents(rhythm), bass: partEvents(bass) };
  // a song with one guitar part: it is the rhythm part too
  if (!ev.rhythm.length && ev.lead.length) ev.rhythm = ev.lead;
  // straight or shuffle, from where everyone's notes land
  const pitchedWords = (lyrics || []).filter((w) => Number.isFinite(w.p) && w.p >= 36 && w.p <= 96);
  const feel = detectFeel([...ev.lead, ...ev.rhythm, ...ev.bass].map((e) => e.t).concat(pitchedWords.map((w) => w.t)), grid);
  grid.q = snapper(grid, feel);
  const names = ((rhythm || lead || {}).chords || []).map((c) => c.name);
  const chords = readChords(ev, grid, names);
  const chordAt = (k) => {
    let a = 0;
    let b = chords.length - 1;
    if (!chords.length || k < chords[0].k) return null;
    while (a < b) {
      const m = (a + b + 1) >> 1;
      if (chords[m].k <= k) a = m;
      else b = m - 1;
    }
    return chords[a].k + chords[a].len > k ? chords[a] : null;
  };

  // where the words are, and whether the chart (or the recording) gives the singer's notes
  const wordsBars = new Set();
  for (const w of lyrics || []) {
    const k0 = grid.q(w.t);
    const k1 = Math.max(k0, grid.q(w.t + (w.d || 0.2)) - 1);
    for (let b = grid.barAt(k0); b <= grid.barAt(k1); b++) wordsBars.add(b);
  }
  const tuneless = (lyrics || []).length > 0 && pitchedWords.length / lyrics.length < 0.5;

  // the tune: the singer's notes where they sing, the lead guitar where nobody does
  let voc = tuneless ? [] : vocalLine(lyrics, grid);
  const vocShift = placeOctave(voc.map((n) => n.midi), 64, 76);
  voc = voc.map((n) => ({ ...n, midi: n.midi + vocShift, role: 'melody', from: 'voice' }));
  const sung = new Set(); // bars with singing in them
  for (const n of voc) {
    const b0 = grid.barAt(n.k);
    const b1 = grid.barAt(n.k + n.len - 1);
    for (let b = b0; b <= b1; b++) sung.add(b);
  }
  const busy = (k) => sung.has(grid.barAt(k)) || (tuneless && wordsBars.has(grid.barAt(k)));
  const leadLine = onGrid(ev.lead.length ? ev.lead : ev.rhythm, grid, true).filter((n) => !busy(n.k));
  // guitar is written an octave above where it sounds, and so is a riff for piano; each section of the
  // song finds its own octave so a solo up the neck doesn't fly off the top of the keyboard
  const secs = ((lead || rhythm || {}).sections || []).map((x) => grid.q(x.start));
  const secOf = (k) => {
    let i = 0;
    while (i + 1 < secs.length && secs[i + 1] <= k) i++;
    return i;
  };
  const bySec = new Map();
  for (const n of leadLine) {
    const i = secOf(n.k);
    if (!bySec.has(i)) bySec.set(i, []);
    bySec.get(i).push(n.midi + 12);
  }
  const shiftOf = new Map([...bySec].map(([i, ms]) => [i, 12 + placeOctave(ms, 62, 76)]));
  const riff = leadLine.map((n) => {
    let m = n.midi + shiftOf.get(secOf(n.k));
    while (m > 88) m -= 12;
    return { k: n.k, len: n.len, midi: m, t: n.t, role: 'melody', from: 'guitar' };
  });
  let melody = [...voc, ...riff].sort((a, b) => a.k - b.k);
  // one voice: a note ends where the next one starts; a note let go a little early is written to its full
  // length (a singer breathes before the next word; sheet music doesn't write that as a rest)
  melody = melody.filter((n, i) => i === 0 || n.k !== melody[i - 1].k);
  for (let i = 0; i < melody.length; i++) {
    const n = melody[i];
    const next = i + 1 < melody.length ? melody[i + 1].k : Infinity;
    const gap = next - (n.k + n.len);
    if (gap < 0) n.len = Math.max(1, next - n.k);
    else if (gap > 0 && gap <= Math.max(1, n.len / 4)) n.len += gap;
    else if (n.len >= TPB && (n.k + n.len) % TPB === TPB - 1) n.len += 1; // let go just before the beat: to the beat
  }
  // nothing below the middle of the keyboard for the right hand's tune
  for (const n of melody) while (n.midi < 57) n.midi += 12;

  // the key, from the chords and the tune
  const kw = new Array(12).fill(0);
  for (const c of chords) for (const p of c.pcs) kw[p] += c.len * (p === c.root ? 1.5 : 1);
  for (const n of melody) kw[n.midi % 12] += n.len * 0.6;
  // songs mostly start at home: the first real chord leans the key its way (C major, not A minor, for C Am F)
  const first = chords.find((c) => c.len >= TPB);
  if (first) kw[first.root] += kw.reduce((a, b) => a + b, 0) * 0.08;
  const key = findKey(kw);
  for (const c of chords) c.name = chordName(c, key.fifths);

  // the bass line, as the bass plays it, in the piano's bass
  // (a bass guitar sounds very low; piano music plays its line an octave up, around the bass staff)
  let bassLine = onGrid(ev.bass, grid, false).map((n) => ({ k: n.k, len: n.len, midi: n.midi, t: n.t, role: 'bass' }));
  const bassShift = placeOctave(bassLine.map((n) => n.midi), 40, 52);
  for (const n of bassLine) {
    n.midi += bassShift;
    while (n.midi > 55) n.midi -= 12;
    while (n.midi < 28) n.midi += 12;
  }
  if (!bassLine.length) {
    // no bass part: the root on the downbeat and halfway through each bar, as a piano player would
    for (const c of chords) {
      if (c.len < TPB) continue;
      for (let k = c.k; k < c.k + c.len; k += TPB * 2) {
        const len = Math.min(TPB * 2, c.k + c.len - k);
        bassLine.push({ k, len, midi: 40 + ((c.root - 40) % 12 + 12) % 12, role: 'bass' });
      }
    }
  }

  // where the right hand plays chords: each chord change, and each bar's first beat while a chord lasts
  const points = new Set();
  for (const c of chords) {
    points.add(c.k);
    for (const bar of grid.bars) if (bar.k0 > c.k && bar.k0 < c.k + c.len) points.add(bar.k0);
  }
  const sorted = [...points].sort((a, b) => a - b);
  const melodyAt = (k) => {
    let a = 0;
    let b = melody.length - 1;
    while (a <= b) {
      const m = (a + b) >> 1;
      const n = melody[m];
      if (n.k > k) b = m - 1;
      else if (n.k + n.len <= k) a = m + 1;
      else return n;
    }
    return null;
  };

  // the band's own rhythm: where the guitar strikes its chords (the piano's chords follow it)
  const strums = [...new Set(ev.rhythm.filter((e) => e.midis.length >= 2).map((e) => grid.q(e.t)))].sort((a, b) => a - b);
  /** Chord points for a level: the changes and downbeats, and the guitar's strums (all of them, or those on a beat). */
  const pointsFor = (onBeats) => {
    const all = new Set(sorted);
    for (const k of strums) if (!onBeats || k % TPB === 0) all.add(k);
    const out = [];
    for (const k of [...all].sort((a, b) => a - b)) if (!out.length || k - out[out.length - 1] >= 2) out.push(k);
    return out;
  };
  const strong = new Set(sorted);

  /**
   * The chords: under the tune where a chord changes (or a bar starts), up to two of its notes close under the
   * melody note; where the tune rests, the whole chord in the guitar's rhythm, moving smoothly from the last one.
   * Bars that have words but no notes for them get the chords as an accompaniment instead.
   */
  const compose = (pts, under) => {
    const harmony = [];
    const accomp = [];
    let prevV = null;
    for (let i = 0; i < pts.length; i++) {
      const k = pts[i];
      const c = chordAt(k);
      if (!c) continue;
      const until = Math.min(pts[i + 1] !== undefined ? pts[i + 1] : Infinity, c.k + c.len);
      const top = melodyAt(k);
      if (top && top.k === k) {
        if (!under || !strong.has(k)) continue;
        const notes = [];
        for (let m = top.midi - 1; m >= top.midi - 12 && notes.length < 2; m--) {
          if (top.midi - m < 3) continue; // not crowding the tune
          if (c.pcs.includes(((m % 12) + 12) % 12) && m >= 55) notes.push(m);
        }
        for (const m of notes) harmony.push({ k, len: Math.max(1, Math.min(until - k, top.len)), midi: m, t: top.t, role: 'chord' });
      } else if (!top) {
        const next = melody.find((n) => n.k > k);
        const stop = next ? Math.min(until - k, next.k - k) : until - k;
        if (stop < 2) continue;
        const words = tuneless && wordsBars.has(grid.barAt(k));
        if (!words && !under) continue; // Medium only fills in where the words have no notes
        const v = voiceChord(c, prevV);
        prevV = v;
        for (const m of v) (words ? accomp : harmony).push({ k, len: stop, midi: m, role: 'chord', chordRoot: c.root });
      }
    }
    return { harmony, accomp };
  };
  const hardComp = compose(pointsFor(false), true);
  const medComp = compose(pointsFor(true), false);
  const accomp = medComp.accomp;
  const harmony = hardComp.harmony;

  const levels = {};
  const R = (list) => list.map((n) => ({ ...n, hand: 'R' }));
  const L = (list) => list.map((n) => ({ ...n, hand: 'L' }));
  // Easy: the tune (and where the chart has no tune for the words, the chord's root, one note at a time)
  const easyAccomp = [];
  for (const n of accomp) {
    if (((n.midi % 12) + 12) % 12 !== n.chordRoot) continue;
    const last = easyAccomp[easyAccomp.length - 1];
    if (last && last.k === n.k) continue;
    // the same root struck again: held instead (one note per chord, as easy piano music does)
    if (last && last.midi === n.midi && last.k + last.len >= n.k) {
      last.len = n.k + n.len - last.k;
      continue;
    }
    easyAccomp.push({ ...n, role: 'melody' });
  }
  levels.easy = R([...melody, ...easyAccomp]);

  // Medium: the tune, and the chord's root wherever the bass starts a note on a beat
  const roots = [];
  for (const n of bassLine) {
    if (n.k % TPB !== 0) continue;
    const c = chordAt(n.k);
    const pc = c ? c.root : n.midi % 12;
    let m = n.midi - (((n.midi - pc) % 12) + 12) % 12; // the root at or just under the bass note
    if (m < 28) m += 12;
    const prev = roots[roots.length - 1];
    if (prev && prev.midi === m && prev.k + prev.len >= n.k && n.k % (TPB * 2) !== 0) {
      prev.len = n.k + n.len - prev.k; // the same root again off the strong beats: hold it
      continue;
    }
    if (prev && prev.k + prev.len > n.k) prev.len = n.k - prev.k;
    roots.push({ k: n.k, len: Math.max(TPB, n.len), midi: m, t: n.t, role: 'bass' });
  }
  for (let i = 0; i < roots.length - 1; i++) roots[i].len = Math.min(roots[i].len, roots[i + 1].k - roots[i].k);
  levels.medium = [...R([...melody, ...accomp]), ...L(roots)];

  // Hard: the tune with its chord under it, and the bass line
  levels.hard = [...R([...melody, ...harmony, ...hardComp.accomp]), ...L(bassLine)];

  for (const list of Object.values(levels)) {
    list.sort((a, b) => a.k - b.k || a.midi - b.midi);
    // the hands never reach for the same key at once: the left hand moves down an octave
    const rLow = new Map();
    for (const n of list) if (n.hand === 'R') rLow.set(n.k, Math.min(rLow.get(n.k) ?? Infinity, n.midi));
    for (const n of list) {
      if (n.hand !== 'L') continue;
      const r = rLow.get(n.k);
      if (r !== undefined && n.midi >= r - 2 && n.midi - 12 >= 28) n.midi -= 12;
    }
    for (const n of list) {
      // when it sounds in the recording (scored against that), written on the grid
      const tq = grid.timeOf(n.k);
      const t0 = Number.isFinite(n.t) && Math.abs(n.t - tq) < 0.3 ? n.t : tq;
      n.t = t0;
      n.d = Math.max(0.06, grid.timeOf(n.k + n.len) - tq);
      delete n.chordRoot;
    }
    list.sort((a, b) => a.t - b.t || a.midi - b.midi);
  }
  for (const c of chords) c.t = grid.timeOf(c.k);
  const sources = { voice: voc.length > 0, riff: riff.length > 0, bass: ev.bass.length > 0, rhythm: ev.rhythm.length > 0, tuneless };
  // the words, for the sheet (under the tune; on their own where the tune isn't known)
  const words = (lyrics || []).map((w) => ({ k: grid.q(w.t), text: String(w.w || '').replace(/\+$/, '').replace(/-+$/, '-') }));
  return { grid, key, feel, chords, levels, sources, words };
}

/** Where a note sits on a staff: { step (diatonic, C4 = 28), acc: -1|0|1 } in a key. */
export function spell(midi, fifths = 0) {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  // letter for each pitch class, sharps or flats by the key
  const sharp = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
  const flat = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
  const [letter, acc] = (fifths < 0 ? flat : sharp)[pc];
  return { step: oct * 7 + letter, acc, letter, oct };
}

/** The accidental the key signature gives each letter (C=0 … B=6). */
export function keyAccidentals(fifths) {
  const acc = new Array(7).fill(0);
  const sharps = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
  const flats = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
  for (let i = 0; i < Math.abs(fifths); i++) acc[(fifths > 0 ? sharps : flats)[i]] = fifths > 0 ? 1 : -1;
  return acc;
}

// ---------------------------------------------------------- the judge --
/**
 * Scores playing on a keyboard: every note counts on its own. A key pressed
 * within the window of a note's start hits it; holding it fills it. Wrong
 * keys are noted (for the picture) but don't take points away.
 */
export class KeysJudge {
  constructor(notes, { early = 0.12, late = 0.16 } = {}) {
    this.notes = notes;
    this.early0 = early;
    this.late0 = late;
    this.early = early;
    this.late = late;
    this.reset(0);
  }
  setPace(speed) {
    const k = Math.max(1, Number(speed) || 1);
    this.early = this.early0 * k;
    this.late = this.late0 * k;
  }
  reset(t = 0) {
    this.result = new Array(this.notes.length).fill(null); // 'hit' | 'miss'
    this.heldTo = new Float32Array(this.notes.length); // song time the key was held to
    this.hits = 0;
    this.judged = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.wrong = [];
    this.down = new Map(); // key → index of the note it's playing
    this.events = [];
    this.next = 0;
    this.rewind(t);
  }
  /** The song jumped to t: forget from there on. */
  rewind(t) {
    let first = this.notes.length;
    for (let i = 0; i < this.notes.length; i++) {
      if (this.notes[i].t + this.late >= t) {
        first = i;
        break;
      }
    }
    for (let i = first; i < this.notes.length; i++) {
      if (this.result[i]) {
        this.judged--;
        if (this.result[i] === 'hit') this.hits--;
      }
      this.result[i] = null;
      this.heldTo[i] = 0;
    }
    this.streak = 0;
    this.next = first;
    this.down.clear();
  }
  get accuracy() {
    return this.judged ? this.hits / this.judged : null;
  }
  /** A key went down at song time t. */
  press(t, midi) {
    let best = -1;
    let bestD = Infinity;
    for (let i = this.next; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t - this.early > t) break;
      if (this.result[i] || n.midi !== midi) continue;
      const d = Math.abs(t - n.t);
      if (t >= n.t - this.early && t <= n.t + this.late && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best < 0) {
      this.wrong.push({ t, midi });
      if (this.wrong.length > 32) this.wrong.shift();
      this.events.push({ type: 'wrong', midi, t });
      return -1;
    }
    this.result[best] = 'hit';
    this.hits++;
    this.judged++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.heldTo[best] = t;
    this.down.set(midi, best);
    this.events.push({ type: 'hit', i: best, t, off: t - this.notes[best].t });
    return best;
  }
  /** A key came up at song time t. */
  release(t, midi) {
    const i = this.down.get(midi);
    if (i !== undefined) {
      this.heldTo[i] = Math.min(this.notes[i].t + this.notes[i].d, Math.max(this.heldTo[i], t));
      this.down.delete(midi);
    }
  }
  /** Time passes: held keys fill their notes, notes whose time is over without a press are missed. */
  tick(t) {
    for (const [, i] of this.down) this.heldTo[i] = Math.min(this.notes[i].t + this.notes[i].d, Math.max(this.heldTo[i], t));
    while (this.next < this.notes.length) {
      const i = this.next;
      const n = this.notes[i];
      if (t <= n.t + this.late) break;
      if (!this.result[i]) {
        this.result[i] = 'miss';
        this.judged++;
        this.streak = 0;
        this.events.push({ type: 'miss', i });
      }
      this.next++;
    }
  }
  summary() {
    return { hit: this.hits, notes: this.judged, acc: this.accuracy, bestStreak: this.bestStreak };
  }
}
