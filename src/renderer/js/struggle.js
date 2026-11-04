/**
 * 4.1.6: notices when you're missing a lot of notes but clearly playing
 * (Stagehand hears you pick near each note it marks as missed), so the
 * highway can offer the timing check, or the tuning check. People don't
 * always know those exist. The first time through a song it speaks up sooner.
 * Pure: no DOM, tested in test/struggle.test.mjs.
 */

/** Your nearest pick to a note at `t` (from 0.4 s before to 0.3 s after), in ms off the note; null if you didn't play near it. */
export function nearestPick(onsets, t) {
  let best = null;
  for (const o of onsets || []) {
    const d = o.t - t;
    if (d >= -0.4 && d <= 0.3 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best === null ? null : Math.round(best * 1000);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export class StruggleWatch {
  /** first: the first time through this song; checked: you've done a timing check before. */
  constructor({ first = false, checked = false } = {}) {
    this.first = first;
    this.checked = checked;
    this.recent = []; // { hit, tried, offset } for the last notes
    this.said = false;
  }

  get size() {
    return this.first ? 14 : 22;
  }

  /** One judged note: hit, whether you played near it, how early (−) or late (+) in ms. */
  add({ hit, tried = false, offset = null }) {
    this.recent.push({ hit: !!hit, tried: !!tried, offset: Number.isFinite(offset) ? offset : null });
    if (this.recent.length > this.size) this.recent.shift();
  }

  /** Forget the run (a seek, a loop, a new part). */
  reset() {
    this.recent = [];
  }

  /**
   * null, or what to offer: { why: 'timing', ms } when your picks land early or late
   * the same way, else { why: 'notes' } (tuning, or the sound level) when you're
   * playing along but the notes aren't being heard as right.
   */
  verdict() {
    if (this.said || this.recent.length < this.size) return null;
    const misses = this.recent.filter((r) => !r.hit);
    const missRate = misses.length / this.recent.length;
    // a song you've played before, after a timing check: only when it's really not working
    const need = this.first ? 0.45 : this.checked ? 0.65 : 0.55;
    if (missRate < need) return null;
    const tried = misses.filter((r) => r.tried).length / misses.length;
    if (tried < 0.6) return null; // not playing much: taking a break, or just watching
    const offs = this.recent.map((r) => r.offset).filter((x) => x !== null);
    const ms = offs.length >= 5 ? Math.round(median(offs)) : 0;
    this.said = true;
    if (Math.abs(ms) >= 55) return { why: 'timing', ms };
    return { why: this.checked ? 'notes' : 'timing', ms };
  }
}
