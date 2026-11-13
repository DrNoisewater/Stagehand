/**
 * 4.16: the notes the PC's highway shows, as the headset gets them, and the little sums the
 * VR highway needs (which notes are near, where the hand is on the neck). Pure: tested in Node.
 */
export const FLAG = { mute: 1, hopo: 2, bend: 4, slide: 8, harmonic: 16, vibrato: 32, palmMute: 64, tremolo: 128, accent: 256, tap: 512 };

/** The first index whose time is >= t (arr sorted by `key`). */
export function lower(arr, t, key = (x) => x.t) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Tidies a chart from the PC: sorted, with the longest held note known (to look back far enough). */
export function prepChart(ch) {
  if (!ch || !Array.isArray(ch.targets)) return null;
  const targets = ch.targets.slice().sort((a, b) => a.t - b.t);
  let maxHold = 0;
  for (const x of targets) maxHold = Math.max(maxHold, x.d || 0, ...x.n.map((n) => n[2] || 0));
  const beats = (ch.beats || []).map(([t, m]) => ({ t, m }));
  const anchors = (ch.anchors || []).map(([t, end, fret, width]) => ({ t, end, fret, width })).sort((a, b) => a.t - b.t);
  const sections = (ch.sections || []).map(([name, start, end]) => ({ name, start, end }));
  return { ...ch, targets, beats, anchors, sections, maxHold, byId: new Map(targets.map((x) => [x.i, x])) };
}

/** Notes worth drawing at `now`: from `behind` seconds ago (or still held) to `ahead` seconds on. */
export function nearTargets(chart, now, ahead = 4, behind = 0.5) {
  if (!chart) return [];
  const out = [];
  const from = lower(chart.targets, now - behind - chart.maxHold);
  for (let i = from; i < chart.targets.length; i++) {
    const x = chart.targets[i];
    if (x.t > now + ahead) break;
    const hold = Math.max(x.d || 0, ...x.n.map((n) => n[2] || 0));
    if (x.t + hold < now - behind) continue;
    out.push(x);
  }
  return out;
}

/** Where the hand is on the neck at `t`: the fret it starts at and how many frets it spans. */
export function anchorAt(chart, t) {
  const A = chart && chart.anchors;
  if (!A || !A.length) return { fret: 1, width: 4 };
  const i = Math.max(0, lower(A, t + 0.0001) - 1);
  const a = A[i];
  return { fret: Math.max(1, a.fret || 1), width: Math.max(4, a.width || 4) };
}

/** Beat lines between `from` and `to` (m >= 0 starts a bar). */
export function beatsBetween(chart, from, to) {
  if (!chart) return [];
  const B = chart.beats;
  const out = [];
  for (let i = lower(B, from); i < B.length && B[i].t <= to; i++) out.push(B[i]);
  return out;
}

/** The section playing at `t` (its name, or ''). */
export function sectionAt(chart, t) {
  if (!chart) return '';
  for (const s of chart.sections) if (t >= s.start && t < s.end) return s.name;
  return '';
}

/** A string's height level: 0 at the bottom. Low E on top (Rocksmith) puts string 0 highest. */
export function level(chart, s) {
  const n = (chart && chart.strings) || 6;
  return chart && chart.lowTop === false ? s : n - 1 - s;
}

/** Hit/miss marks from the PC's judge, kept between messages. */
export class Marks {
  constructor() {
    this.map = new Map();
    this.score = null;
    this.flashes = []; // { id, at } new hits, for sparks
  }
  apply(judge, at = 0) {
    if (!judge) return;
    if (judge.off) {
      this.map.clear();
      this.score = null;
      return;
    }
    if (judge.reset) this.map.clear();
    for (const [id, r] of judge.ev || []) {
      if (!this.map.has(id) && r && !judge.reset) this.flashes.push({ id, at });
      this.map.set(id, r);
    }
    this.score = { hits: judge.hits, judged: judge.judged, streak: judge.streak, best: judge.best };
  }
  clear() {
    this.map.clear();
    this.score = null;
    this.flashes = [];
  }
  /** 1 hit, 0 missed, undefined not judged yet. */
  get(id) {
    return this.map.get(id);
  }
}
