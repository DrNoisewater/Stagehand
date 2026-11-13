/**
 * The song's part, ready to draw on the headset (4.16): notes and chords as
 * targets (like the PC's highway), where the hand is (anchors), the beats,
 * and which notes the PC judged. Pure: the tests run it in Node.
 */

/** Notes and chords in time order: { t, sus, notes: [{ s, f, sus, mute, ... }], chord, kind }. */
export function targets(tab) {
  const out = [];
  for (const n of tab.notes || []) out.push({ t: n.t, sus: n.sus || 0, notes: [n], kind: n.mute ? 'mute' : 'note' });
  for (const c of tab.chordEvents || []) {
    const notes = (c.strings || []).map((x) => ({ ...x, sus: x.sus ?? c.sus ?? 0 }));
    if (!notes.length) continue;
    out.push({ t: c.t, sus: c.sus || 0, notes, kind: notes.every((x) => x.mute) ? 'mute' : notes.length === 1 ? 'note' : 'chord', chord: c.chord });
  }
  out.sort((a, b) => a.t - b.t);
  out.forEach((x, i) => (x.id = i));
  return out;
}

/** The first index with t >= time (binary search). */
export function lower(list, time, key = 't') {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m][key] < time) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Where the hand is at a time: { fret, width } (the first anchor before songs start). */
export function anchorAt(anchors, t) {
  if (!anchors || !anchors.length) return { fret: 1, width: 4 };
  let a = anchors[0];
  for (const x of anchors) {
    if (x.t <= t + 0.001) a = x;
    else break;
  }
  return { fret: a.fret || 1, width: a.width || 4 };
}

/** The hand position the camera follows: eased between anchors so the neck glides, never jumps. */
export function handAt(anchors, t, look = 1.2) {
  const now = anchorAt(anchors, t);
  const next = anchorAt(anchors, t + look);
  const mid = (a) => Math.max(0, a.fret - 1) + (a.width || 4) / 2;
  const k = 0.35;
  return mid(now) * (1 - k) + mid(next) * k;
}

/**
 * Hits and misses from the PC, matched to targets by time (and strings).
 * judged({ t, hit, notes }) returns the target id it matched, or -1.
 */
export class Results {
  constructor(list) {
    this.list = list || [];
    this.map = new Map(); // id -> { hit, at }
  }
  judged(e, now = 0) {
    const i0 = lower(this.list, e.t - 0.006);
    for (let i = i0; i < this.list.length && this.list[i].t <= e.t + 0.006; i++) {
      const tg = this.list[i];
      const sameStrings = !e.notes || !e.notes.length || e.notes.every((n) => tg.notes.some((m) => m.s === n.s && m.f === n.f));
      if (!sameStrings) continue;
      this.map.set(tg.id, { hit: !!e.hit, at: now });
      return tg.id;
    }
    return -1;
  }
  get(id) {
    return this.map.get(id) || null;
  }
  /** A seek back: forget results after this time (they'll be judged again). */
  rewind(t) {
    for (const [id] of this.map) if (this.list[id] && this.list[id].t > t - 0.2) this.map.delete(id);
  }
}

/** The words in lines, as the PC's highway shows them: [{ t0, t1, text }]. */
export function lyricLines(ly) {
  const lines = [];
  let cur = null;
  for (const w of ly || []) {
    const raw = String(w.w || '');
    const end = raw.endsWith('+');
    const clean = raw.replace(/\+$/, '');
    const joined = clean.endsWith('-');
    const text = joined ? clean.slice(0, -1) : clean;
    const d = Math.max(0.15, w.d || 0.3);
    if (!cur || (cur.words.length && (w.t - cur.t1 > 3 || (cur.words.length >= 12 && !cur.words[cur.words.length - 1].joined)))) {
      cur = { t0: w.t, t1: w.t + d, words: [] };
      lines.push(cur);
    }
    cur.words.push({ text, joined });
    cur.t1 = w.t + d;
    if (end) cur = null;
  }
  return lines.map((l) => ({ t0: l.t0, t1: l.t1, text: l.words.map((w, i) => w.text + (w.joined || i === l.words.length - 1 ? '' : ' ')).join('') }));
}

/** The line to show at a time (it comes up 1.5 s early and stays until it's sung). */
export function lyricAt(lines, t) {
  for (const l of lines) if (t >= l.t0 - 1.5 && t < l.t1 + 0.4) return l.text;
  return '';
}
