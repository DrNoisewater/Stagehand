/**
 * Sing along: what to sing and how it's scored. No page, no microphone here,
 * only the rules, so they can be tested on their own.
 *
 * A syllable counts when your voice was on its note (in any octave) for a
 * big enough share of its length. Syllables without a note count when a
 * voice was heard.
 */

export const SING_LEVELS = {
  easy: { name: 'Easy', cents: 250, bar: 0.4 },
  medium: { name: 'Medium', cents: 120, bar: 0.55 },
  hard: { name: 'Hard', cents: 60, bar: 0.7 },
};
/** How early or late a syllable may be sung and still count (seconds). */
export const SLACK = 0.15;
/** A line is a good one when this share of its syllables counted. */
export const GOOD_LINE = 0.7;
/** Once on a note, the room to stay on it grows by this much. */
export const HOLD_ROOM = 1.4;
/** Following a moving line: how early or late along it you may be (seconds). */
const LEAN = [0, -0.04, 0.04, -0.08, 0.08];

/** Charts mark "no note" in several ways (0, 254, 255); a voice sits between these. */
export const hasPitch = (p) => Number.isFinite(p) && p >= 36 && p <= 96;
export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

/** How far a sung note is from the target, in cents, whatever the octave (−600…+600; + is sharp). */
export function foldCents(sung, target) {
  let d = (sung - target) % 12;
  if (d > 6) d -= 12;
  if (d < -6) d += 12;
  return d * 100;
}

/** The sung note moved by whole octaves to sit nearest `near` (for drawing). */
export function nearOctave(sung, near) {
  return near + foldCents(sung, near) / 100;
}

/**
 * Lyrics ({ t, d, w, p }) as syllables and lines. "+" ends a line, "-" joins a
 * syllable to the next one; a 3 s gap or 12 words also start a new line (the
 * same rules as the lyrics on the highway).
 */
export function buildSing(lyrics) {
  const syl = [];
  const lines = [];
  let cur = null;
  for (const w of lyrics || []) {
    const raw = String(w.w || '');
    const end = raw.endsWith('+');
    const clean = raw.replace(/\+$/, '');
    const joined = clean.endsWith('-');
    const text = joined ? clean.slice(0, -1) : clean;
    const d = Math.max(0.15, Number(w.d) || 0.3);
    const prev = syl[syl.length - 1];
    if (!cur || (cur.n && (w.t - cur.t1 > 3 || (cur.n >= 12 && !prev.joined)))) {
      cur = { t0: w.t, t1: w.t + d, from: syl.length, to: syl.length, n: 0 };
      lines.push(cur);
    }
    syl.push({ t: w.t, d, p: hasPitch(w.p) ? w.p : null, text, joined, line: lines.length - 1 });
    cur.n++;
    cur.to = syl.length;
    cur.t1 = w.t + d;
    if (end) cur = null;
  }
  return { syl, lines };
}

/** The share of syllables that carry a note. */
export function pitchedShare(syl) {
  return syl.length ? syl.filter((s) => s.p !== null).length / syl.length : 0;
}

/**
 * 4.18.2: is the chart's tune made up? Rocksmith never scores singing, so many charts give every
 * syllable the same note, or a few notes close together, just to fill the field. A real tune moves:
 * true when nearly the whole song sits within four semitones, or one note takes most syllables.
 */
export function flatChart(syl) {
  const ps = syl.filter((s) => s.p !== null).map((s) => s.p);
  if (ps.length < 8) return false;
  const sorted = [...ps].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const count = new Map();
  for (const p of ps) count.set(Math.round(p), (count.get(Math.round(p)) || 0) + 1);
  const top = Math.max(...count.values()) / ps.length;
  return at(0.95) - at(0.05) <= 4 || top >= 0.6;
}

/**
 * Notes read off the recording, laid over the chart's own: the chart wins
 * where it has a note. Each note is moved by octaves to sit near the ones
 * before it, so the bars don't jump (octaves don't matter for scoring).
 */
export function withPitches(syl, found) {
  const out = syl.map((s, i) => ({ ...s, p: s.p !== null ? s.p : hasPitch(found && found[i]) ? found[i] : null }));
  const recent = [];
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.p === null) continue;
    if (syl[i].p === null && recent.length) {
      const mid = [...recent].sort((a, b) => a - b)[Math.floor(recent.length / 2)];
      s.p = nearOctave(s.p, mid);
    }
    recent.push(s.p);
    if (recent.length > 9) recent.shift();
  }
  return out;
}

/** How far apart (cents, any octave) a chart note and the singer's may be and still be the same note. */
export const AGREE = 150;

/** The note to sing at time t in syllable s: on its line when it has one, else its one note. */
export function noteAt(s, t) {
  const c = s.c;
  if (!c || !c.length) return s.p;
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i][0]) {
      const u = (t - c[i - 1][0]) / (c[i][0] - c[i - 1][0] || 1);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * u;
    }
  }
  return c[c.length - 1][1];
}

/**
 * 4.19: every chart note checked against the singer (`read`: one { p, c, q } per syllable, from
 * the vocals stem; p null where the lead wasn't clearly heard).
 * - Where the singer was heard, the recording wins: its note and its line are used.
 * - Where the singer wasn't, the chart's note is kept only in a line whose other notes agree with
 *   the singer (the chart is real there); in a line that disagrees (made up) it is left blank.
 * mode 'recording' drops every chart note (the singer's notes only).
 * Each syllable gets `src`: 'singer', 'chart' or null (blank). `check` says how it went.
 */
export function checkNotes(syl, read, lines, mode = 'auto') {
  const n = syl.length;
  const got = (i) => read && read[i] && hasPitch(read[i].p);
  const agrees = (i) => Math.abs(foldCents(read[i].p, syl[i].p)) <= AGREE;
  // is the chart real? song-wide first, then line by line
  let both = 0;
  let same = 0;
  for (let i = 0; i < n; i++) {
    if (syl[i].p !== null && got(i)) {
      both++;
      if (agrees(i)) same++;
    }
  }
  const songReal = mode !== 'recording' && (both >= 4 ? same / both >= 0.6 : !flatChart(syl));
  const lineReal = (lines || []).map((L) => {
    if (mode === 'recording') return false;
    let b = 0;
    let s = 0;
    for (let i = L.from; i < L.to; i++) {
      if (syl[i].p !== null && got(i)) {
        b++;
        if (agrees(i)) s++;
      }
    }
    return b >= 2 ? s / b >= 0.6 : songReal;
  });
  const check = { notes: n, heard: 0, agreed: 0, fixed: 0, added: 0, kept: 0, blank: 0, share: 0 };
  const out = syl.map((s, i) => {
    if (got(i)) {
      check.heard++;
      if (s.p === null) check.added++;
      else if (agrees(i)) check.agreed++;
      else check.fixed++;
      return { ...s, p: read[i].p, c: read[i].c || null, src: 'singer' };
    }
    const real = lineReal.length ? lineReal[s.line] : songReal;
    if (s.p !== null && real) {
      check.kept++;
      return { ...s, c: null, src: 'chart' };
    }
    check.blank++;
    return { ...s, p: null, c: null, src: null };
  });
  check.share = n ? check.heard / n : 0;
  tidyOctaves(out);
  return { syl: out, check };
}

/** Moves a syllable (note and line) by whole octaves. */
function shift(s, oct) {
  if (!oct) return;
  s.p += 12 * oct;
  if (s.c) s.c = s.c.map(([t, v]) => [t, v + 12 * oct]);
}

/**
 * Octaves don't matter for scoring, but bars that leap an octave and back are hard to read:
 * a chart note is moved by octaves to sit with the singer's notes around it, and a singer's
 * note that is alone an octave away from both its neighbours (a slip of the reading) is moved back.
 */
function tidyOctaves(out) {
  const near = (i, want) => {
    const v = [];
    for (let k = i - 1; k >= 0 && v.length < 4; k--) if (out[k].p !== null && want(out[k])) v.push(out[k].p);
    const half = v.length;
    for (let k = i + 1; k < out.length && v.length < half + 4; k++) if (out[k].p !== null && want(out[k])) v.push(out[k].p);
    if (v.length < 2) return null;
    v.sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.p === null || s.src !== 'singer') continue;
    const mid = near(i, (x) => x.src === 'singer');
    if (mid !== null && Math.abs(s.p - mid) > 9 && Math.abs(foldCents(s.p, mid)) <= 400) shift(s, Math.round((mid - s.p) / 12));
  }
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.p === null || s.src !== 'chart') continue;
    const mid = near(i, (x) => x.src === 'singer');
    if (mid !== null) shift(s, Math.round((mid - s.p) / 12));
  }
}

/**
 * The notes for auto-tune: a word that runs over several notes is given as those notes, one
 * after the other (its line cut into steps), so a hard tune walks the run instead of one note.
 */
export function tuneNotes(syl) {
  const out = [];
  for (const s of syl) {
    if (s.p === null || s.p === undefined) continue;
    if (!s.c || s.c.length < 2) {
      out.push({ t: s.t, d: s.d, p: s.p });
      continue;
    }
    const off = s.p - Math.round(s.p); // the recording's own tuning is kept
    const end = s.t + s.d;
    let cur = null;
    for (let t = s.t; t < end - 0.02; t += 0.04) {
      const p = Math.round(noteAt(s, t + 0.02) - off) + off;
      if (cur && Math.abs(cur.p - p) < 0.01) cur.d = t + 0.04 - cur.t;
      else {
        cur = { t, d: 0.04, p };
        out.push(cur);
      }
    }
    if (cur) cur.d = Math.max(cur.d, end - cur.t);
  }
  // a step too short to sing (the middle of a slide) joins the one after it
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i].d < 0.09 && Math.abs(out[i + 1].t - (out[i].t + out[i].d)) < 0.011) {
      out[i + 1].d += out[i + 1].t - out[i].t;
      out[i + 1].t = out[i].t;
      out.splice(i, 1);
    }
  }
  return out;
}

/**
 * Turns the microphone's raw reading (a new one every frame or so) into a
 * steady voice to draw and score. A real voice wobbles, slides into notes,
 * cracks up an octave and stops for breath; the raw pitch follows all of
 * that, so the dot jumped around. This keeps what matters:
 * - small wobble (vibrato, drift) is smoothed out, a real move to another
 *   note is followed quickly;
 * - a sudden jump of an octave is ignored unless it lasts;
 * - a short gap (a breath, a consonant) keeps the last note for a moment.
 * push(t, midi|null, level) → { voiced, midi, level }.
 */
export class VoiceTracker {
  constructor({ hold = 0.14, calm = 0.09, quick = 0.02, octaveWait = 0.12 } = {}) {
    Object.assign(this, { hold, calm, quick, octaveWait });
    this.reset();
  }
  reset() {
    this.est = null; // the steady note (midi)
    this.lastHeard = -Infinity; // when a note was last heard
    this.lastT = null;
    this.recent = []; // the last few raw notes, after octave fixing
    this.octSince = null; // when an octave jump started
    this.since = 0; // when this stretch of singing started
  }
  push(t, midi, level = 0) {
    const dt = this.lastT === null ? 0.016 : Math.max(0.001, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    if (midi === null || midi === undefined || !Number.isFinite(midi)) {
      // a breath or a consonant: keep the note a moment, then let it go
      if (this.est !== null && t - this.lastHeard <= this.hold) return { voiced: true, midi: this.est, level };
      this.est = null;
      this.recent = [];
      this.octSince = null;
      return { voiced: false, midi: null, level };
    }
    let m = midi;
    if (this.est !== null && t - this.lastHeard <= this.hold + 0.2) {
      // an octave crack (or the pitch reader slipping an octave): moved back unless it lasts
      const d = m - this.est;
      const oct = Math.round(d / 12);
      if (oct !== 0 && Math.abs(d - oct * 12) < 1.5) {
        if (this.octSince === null) this.octSince = t;
        if (t - this.octSince < this.octaveWait) m -= oct * 12;
        else {
          this.est += oct * 12; // it lasted: the singer really went there
          this.recent = this.recent.map((x) => x + oct * 12);
          this.octSince = null;
        }
      } else this.octSince = null;
    } else {
      this.est = null;
      this.recent = [];
    }
    this.lastHeard = t;
    this.recent.push(m);
    if (this.recent.length > 5) this.recent.shift();
    const med = [...this.recent].sort((a, b) => a - b)[Math.floor(this.recent.length / 2)];
    if (this.est === null) {
      this.est = med;
      this.since = t;
      return { voiced: true, midi: this.est, level };
    }
    // near the steady note: glide slowly (wobble smooths out); a semitone or more away for a
    // moment: a new note, follow it quickly
    // (the middle of the last few readings already ignores a single stray one)
    // (and the first moment of a note, while the voice slides onto it, is followed closely too)
    const tau = Math.abs(med - this.est) >= 0.8 ? this.quick : t - this.since < 0.2 ? this.quick * 1.5 : this.calm;
    this.est += (med - this.est) * (1 - Math.exp(-dt / tau));
    return { voiced: true, midi: this.est, level };
  }
}

/**
 * Follows a singer through the song. Feed it what the microphone hears with
 * push(), and tick() as time passes; it settles each syllable once its time
 * (plus the slack) is over.
 */
export class SingJudge {
  constructor(syl, lines, level = 'medium') {
    this.syl = syl;
    this.lines = lines;
    this.level = SING_LEVELS[level] ? level : 'medium';
    this.reset(0);
  }

  /** Start over from time t: everything from there on is unsung again. */
  reset(t = 0) {
    this.good = new Float32Array(this.syl.length); // seconds on the note
    this.held = new Uint8Array(this.syl.length); // on the note at the last look (holding it gets a little more room)
    this.spans = this.syl.map(() => []); // [from, to] stretches on the note, for drawing
    this.result = new Array(this.syl.length).fill(null); // 'hit' | 'miss'
    this.lineResult = new Array(this.lines.length).fill(null); // share of syllables that counted
    this.hits = 0;
    this.judged = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.goodLines = 0;
    this.doneLines = 0;
    this.events = [];
    this.rewind(t);
  }

  /** The song jumped to t: forget what was sung from there on, keep what came before. */
  rewind(t) {
    let first = this.syl.length;
    for (let i = 0; i < this.syl.length; i++) {
      if (this.syl[i].t + this.syl[i].d + SLACK > t) {
        first = i;
        break;
      }
    }
    const firstLine = first < this.syl.length ? this.syl[first].line : this.lines.length;
    // a line that is only partly behind us starts again as a whole
    const from = firstLine < this.lines.length ? Math.min(first, this.lines[firstLine].from) : first;
    for (let i = from; i < this.syl.length; i++) {
      if (this.result[i]) {
        this.judged--;
        if (this.result[i] === 'hit') this.hits--;
      }
      this.result[i] = null;
      this.good[i] = 0;
      this.held[i] = 0;
      this.spans[i] = [];
    }
    for (let l = firstLine; l < this.lines.length; l++) {
      if (this.lineResult[l] !== null) {
        this.doneLines--;
        if (this.lineResult[l] >= GOOD_LINE) this.goodLines--;
      }
      this.lineResult[l] = null;
    }
    this.streak = 0;
    this.next = from; // first syllable not settled yet
    this.lastT = t;
  }

  get accuracy() {
    return this.judged ? this.hits / this.judged : null;
  }

  /** Is this voice on syllable i? A syllable with no note takes any voice. */
  on(i, voice, t = this.lastT) {
    if (!voice || !voice.voiced) return false;
    const s = this.syl[i];
    if (s.p === null) return true;
    // once you're on the note, you get a little more room to stay there (holding a note is
    // the hard part; a wobble shouldn't drop you off it)
    const room = SING_LEVELS[this.level].cents * (this.held[i] ? HOLD_ROOM : 1);
    if (voice.midi === null || voice.midi === undefined) return false;
    if (!s.c) return Math.abs(foldCents(voice.midi, s.p)) <= room;
    // 4.19: a word with a line of its own (a slide, a bend, a run of notes) is scored along the
    // line: you're on it when you're where the singer is now, or was or will be within 80 ms
    for (const k of LEAN) if (Math.abs(foldCents(voice.midi, noteAt(s, t + k))) <= room) return true;
    return false;
  }

  /**
   * What the microphone heard at song time t: { voiced, midi } (midi may be
   * null for a voice with no clear note). Time since the last push is
   * credited to every syllable in reach that this voice is on.
   */
  push(t, voice) {
    const dt = Math.max(0, Math.min(0.25, t - this.lastT)); // a slow picture still credits the time between looks
    this.lastT = t;
    if (!dt) return;
    for (let i = this.next; i < this.syl.length; i++) {
      const s = this.syl[i];
      if (s.t - SLACK > t) break;
      if (t > s.t + s.d + SLACK) continue;
      const on = this.on(i, voice, t);
      this.held[i] = on ? 1 : 0;
      if (!on) continue;
      this.good[i] = Math.min(s.d, this.good[i] + dt);
      const sp = this.spans[i];
      const last = sp[sp.length - 1];
      if (last && t - dt - last[1] < 0.06) last[1] = t;
      else sp.push([t - dt, t]);
    }
  }

  /** Settles syllables (and lines) whose time is over at song time t. */
  tick(t) {
    const L = SING_LEVELS[this.level];
    while (this.next < this.syl.length) {
      const i = this.next;
      const s = this.syl[i];
      if (t <= s.t + s.d + SLACK) break;
      const hit = this.good[i] / s.d >= L.bar;
      this.result[i] = hit ? 'hit' : 'miss';
      this.judged++;
      if (hit) this.hits++;
      this.next++;
      this.events.push({ type: hit ? 'hit' : 'miss', i });
      const line = this.lines[s.line];
      if (line && i === line.to - 1) {
        let n = 0;
        for (let k = line.from; k < line.to; k++) if (this.result[k] === 'hit') n++;
        const share = n / Math.max(1, line.to - line.from);
        this.lineResult[s.line] = share;
        this.doneLines++;
        if (share >= GOOD_LINE) {
          this.goodLines++;
          this.streak++;
          this.bestStreak = Math.max(this.bestStreak, this.streak);
        } else this.streak = 0;
        this.events.push({ type: 'line', line: s.line, share });
      }
    }
  }

  /** How it went, for the score card and the stats. */
  summary() {
    return { hit: this.hits, notes: this.judged, acc: this.accuracy, lines: this.doneLines, goodLines: this.goodLines, bestStreak: this.bestStreak, level: this.level };
  }
}
