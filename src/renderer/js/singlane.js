/**
 * Sing along on the highway: an add-on, off until you press the Sing chip.
 * A lane of its own across the top, as in the band games (words, a bar for each syllable
 * placed by its note, a dot for your voice). It never touches the neck, the
 * notes, the guitar's sound or the guitar's score, and it does nothing at
 * all while it is off: no microphone, no reading of the song.
 *
 * Karaoke is the same singing with the stage to yourself: the neck and the
 * notes step aside, the words go big in the middle, the singer is taken out
 * of the song when it has been split, and the guitar isn't scored.
 */
import { api } from './api.js';
import { h, icon, showMenu, toast } from './ui.js';
import { mic } from './mic.js';
import { autotune, TUNE_STYLES, TUNE_NOTES, TUNE_LEVELS, TUNE_VOICES } from './autotune.js';
import { buildSing, SingJudge, SING_LEVELS, SLACK, pitchedShare, withPitches, nearOctave, foldCents } from './sing.js';

const KEY = 'stagehand.sing';
// the stage's own colours (as the highway's top bar and cards): warm cream ink, stage gold,
// and the vocals colour for what you sang right
const CYAN = '#33c8e0';
const CYAN_SOFT = '#9be9f5';
const GOLD = '#f1ce68';
const INK = '#f5edda';
const INK_3 = '#a99e8c';
const TUNGSTEN = '#ffb547';
const FONT = "'Archivo', 'Segoe UI', sans-serif";
/** How long the microphone's sound takes to reach the page, roughly (seconds). */
const MIC_DELAY = 0.06;
/** Seconds of song the lane shows ahead of now. 4.16.1: 4 → 5.5, so the words come in sooner
 *  ("it's kind of hard to see the words coming fast enough … to figure out what to actually sing"). */
const AHEAD = 5.5;

export const SING_LOOKS = [
  ['bars', 'Bars', 'A bar for every syllable, higher notes higher, and a dot for your voice'],
  ['words', 'Words', 'The lyrics as they are, lighting up as you sing them right'],
];

function prefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    return { on: {}, level: 'medium', look: 'bars', ...p };
  } catch (_) {
    return { on: {}, level: 'medium', look: 'bars' };
  }
}
function setPref(k, v) {
  const p = prefs();
  p[k] = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (_) {}
}
/** How strict the scoring is: easy | medium | hard (shared by Sing along and Karaoke). */
export const singLevel = () => (SING_LEVELS[prefs().level] ? prefs().level : 'medium');
export function setSingLevel(v) {
  if (SING_LEVELS[v]) setPref('level', v);
}
export const singLook = () => (prefs().look === 'words' ? 'words' : 'bars');
export function setSingLook(v) {
  setPref('look', v === 'words' ? 'words' : 'bars');
  window.dispatchEvent(new Event('sing-look'));
}

// ------------------------------------------- notes from the vocals stem --
const PKEY = 'stagehand.singNotes';
function cachedNotes(key) {
  try {
    const c = JSON.parse(localStorage.getItem(PKEY) || '[]');
    const e = c.find((x) => x.k === key);
    return e ? e.p : null;
  } catch (_) {
    return null;
  }
}
function keepNotes(key, p) {
  try {
    const c = JSON.parse(localStorage.getItem(PKEY) || '[]').filter((x) => x.k !== key);
    c.push({ k: key, p });
    localStorage.setItem(PKEY, JSON.stringify(c.slice(-30))); // the last 30 songs sung
  } catch (_) {}
}
let worker = null;
let jobs = 0;
/** The note of each syllable, read off the song's vocals stem (null when it has none). */
export async function notesFromStem(song, syl, engine) {
  const st = await api.stems.status(song.id).catch(() => null);
  const f = st && st.state === 'ready' && Array.isArray(st.stems) ? st.stems.find((x) => x.name === 'vocals') : null;
  if (!f || !f.url) return null;
  const key = `${song.id}|${f.url}|${syl.length}`;
  const had = cachedNotes(key);
  if (had) return had;
  const { loadTrackData } = await import('./audio-engine.js');
  const data = await loadTrackData(f.url, undefined, { rate: engine.sampleRate, frames: engine.frames });
  if (!worker) worker = new Worker(new URL('../workers/vocal-pitch-worker.js', import.meta.url), { type: 'module' });
  const id = ++jobs;
  const found = await new Promise((resolve, reject) => {
    const on = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', on);
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.pitches);
    };
    worker.addEventListener('message', on);
    worker.postMessage({ id, buffer: data.buffer, dataOffset: data.wav.dataOffset, frames: data.wav.frames, channels: data.wav.channels, sampleRate: data.wav.sampleRate, syl: syl.map((s) => ({ t: s.t, d: s.d })) }, [data.buffer]);
  });
  keepNotes(key, found);
  return found;
}

// ------------------------------------------------------------ the lane --
/** The first time your voice is played back, a word about headphones. */
function tuneTip() {
  if (!autotune.wanted || prefs().tuneTipSeen) return;
  setPref('tuneTipSeen', true);
  toast({
    title: 'Your voice is on',
    message: 'You hear your tuned voice with the song. Headphones are best: with speakers, keep the microphone away from them, or it squeals.',
    kind: 'info',
    timeout: 12000,
  });
}
const nameOf = (list, id) => (list.find(([x]) => x === id) || list[0])[1];
/** "Auto-tune", "Auto-tune: Hard tune", "Voice: Giant" or both, for a button or a menu line. */
export function tuneLabel() {
  const a = autotune.style === 'off' ? '' : nameOf(TUNE_STYLES, autotune.style);
  const v = autotune.voice === 'normal' ? '' : nameOf(TUNE_VOICES, autotune.voice);
  if (autotune.picked && autotune.muted) return 'Voice muted';
  return a && v ? `${a} · ${v}` : a ? `Auto-tune: ${a}` : v ? `Voice: ${v}` : 'Auto-tune';
}
/** Auto-tune and the voice changer as menu lines (the Sing menu and the Karaoke page). */
export function tuneMenu() {
  // the ticks are read again after every press, so the menu stays open while you try things
  const check = (f) => () => (f() ? '✓' : '');
  return [
    { heading: true, label: 'Auto-tune' },
    ...TUNE_STYLES.map(([id, name]) => ({ label: name, hint: check(() => autotune.style === id), keep: true, onClick: () => (autotune.setStyle(id), autotune.setMuted(false), tuneTip()) })),
    '-',
    { label: () => `Tune to: ${nameOf(TUNE_NOTES, autotune.notes).toLowerCase()}`, submenu: TUNE_NOTES.map(([id, name]) => ({ label: name, hint: check(() => autotune.notes === id), keep: true, onClick: () => autotune.setNotes(id) })) },
    { label: () => `Voice: ${nameOf(TUNE_VOICES, autotune.voice).toLowerCase()}`, submenu: TUNE_VOICES.map(([id, name]) => ({ label: name, hint: check(() => autotune.voice === id), keep: true, onClick: () => (autotune.setVoice(id), autotune.setMuted(false), tuneTip()) })) },
    '-',
    // muted: the choices above are kept for next time, but your voice isn't played
    { label: 'Mute my voice', hint: () => (autotune.picked ? (autotune.muted ? '✓' : '') : 'not playing'), keep: true, onClick: () => autotune.picked && (autotune.setMuted(!autotune.muted), tuneTip()) },
    { label: 'Voice volume', submenu: TUNE_LEVELS.map(([v, name]) => ({ label: name, hint: check(() => Math.abs(autotune.vol - v) < 0.01), keep: true, onClick: () => autotune.setVol(v) })) },
  ];
}

export function createSing({ root, stage, onKaraoke, onLeave, onAsk }) {
  const chip = h('button.hw-chip.hw-mode.hw-sing-chip', { type: 'button', hidden: true });
  const kchip = h('button.hw-chip.hw-mode.hw-karaoke-chip', { type: 'button', hidden: true });
  const lane = h('div.hw-sing', { hidden: true, 'aria-hidden': 'true' });
  const cv = h('canvas');
  // the voice dot rides on a little LED meter (green, amber, red as you get louder)
  const meterBar = h('div.sw-meter');
  const meter = h('div.sw-meter-wrap', null, meterBar, h('i'));
  const nowRow = h('div.sw-now');
  const nextRow = h('div.sw-next');
  const wordsBox = h('div.sw-words', null, meter, h('div.sw-lines', null, nowRow, nextRow));
  const badge = h('div.sw-badge');
  // a strip of tape on the case saying what this lane is, as on the rest of the stage
  const tape = h('div.sw-tape', { text: 'Vocals' });
  // the score so far rides on a second strip of tape at the right, clear of the bars
  const score = h('div.sw-score', { hidden: true });
  // auto-tune and the voice changer on their own strip of tape, right on the lane
  const tuneTape = h('button.sw-tape.sw-tune', { type: 'button', title: 'Auto-tune and the voice changer' });
  const paintTune = () => {
    tuneTape.innerHTML = icon('wand');
    tuneTape.append(h('span', { text: tuneLabel() }));
    tuneTape.setAttribute('aria-pressed', String(autotune.wanted));
  };
  paintTune();
  autotune.addEventListener('change', paintTune);
  tuneTape.onclick = (e) => {
    e.stopPropagation();
    const r = tuneTape.getBoundingClientRect();
    showMenu(r.left, r.bottom + 6, tuneMenu());
  };
  lane.append(tape, tuneTape, score, cv, wordsBox, badge);
  root.append(lane);
  const g = cv.getContext('2d');

  const S = {
    song: null,
    base: { syl: [], lines: [] }, // from the chart
    cur: { syl: [], lines: [] }, // what's being sung (may have notes from the recording)
    judge: null,
    mode: 'charted', // charted | stem | rhythm
    reading: false, // notes are being read off the recording
    on: false, // singing is switched on for this song
    karaoke: false, // just the words: no neck, no notes, the guitar isn't scored
    tookOut: false, // karaoke took the singer out of the song (put back when it ends)
    open: false, // the highway is showing
    lastT: 0,
    secs: 0, // song time sung in this run
    at: 0,
    slowest: 1,
    trail: [],
    rng: null,
    lastResult: null,
    token: 0,
    line: -2,
    best: undefined,
  };

  const live = () => S.on && S.open && !!S.judge;

  /**
   * 4.18: Sing and Karaoke are two buttons that are always there, always the same size (nothing in the
   * top bar jumps). The one that's on is lit and opens its options; a song with no words dims them.
   */
  function paintChip() {
    const words = S.base.syl.length > 0;
    const singing = S.on && !S.karaoke && !S.held;
    const kar = S.on && S.karaoke;
    const paint = (el, on, name, offTitle, onTitle) => {
      el.hidden = !S.song;
      el.setAttribute('aria-pressed', String(on));
      el.classList.toggle('dim', !words);
      el.classList.toggle('has-menu', on);
      el.title = !words ? 'This song has no words in it' : on ? onTitle : offTitle;
      const html = `${icon(name === 'Sing' ? 'mic' : 'music')}<span>${name}</span>${icon('chevron')}`;
      if (el.__html !== html) el.innerHTML = el.__html = html;
    };
    paint(chip, singing, 'Sing', 'Sing along: score your singing beside your guitar part, with a microphone', 'Singing is on: level, microphone, auto-tune, look');
    paint(kchip, kar, 'Karaoke', 'Karaoke: just the words, big, and your singing scored', 'Karaoke is on: level, microphone, auto-tune, look');
  }

  function vocalsTrack() {
    if (!stage.stems || !stage.stems().includes('vocals')) return null;
    return stage.engine.tracks[stage.trackIndex('vocals')] || null;
  }

  function newJudge() {
    S.judge = new SingJudge(S.cur.syl, S.cur.lines, prefs().level);
    S.judge.rewind(stage.engine.position);
    S.lastT = stage.engine.position;
    S.secs = 0;
    S.at = Date.now();
    S.slowest = stage.engine.speed || 1;
    S.trail = [];
    S.line = -2;
  }

  /** Works out what to sing: the chart's notes, or the recording's, or timing only. */
  async function prepare() {
    const token = ++S.token;
    const song = S.song;
    S.cur = S.base;
    const share = pitchedShare(S.base.syl);
    S.mode = share >= 0.6 ? 'charted' : 'rhythm';
    S.reading = false;
    newJudge();
    paintBadge();
    autotune.setSong(S.mode === 'charted' ? S.cur.syl : null);
    if (S.mode === 'charted') return;
    S.reading = true;
    paintBadge();
    let found = null;
    try {
      found = await notesFromStem(song, S.base.syl, stage.engine);
    } catch (_) {
      found = null;
    }
    if (token !== S.token || !S.on) return;
    S.reading = false;
    if (found) {
      const syl = withPitches(S.base.syl, found);
      if (pitchedShare(syl) >= 0.4) {
        S.cur = { syl, lines: S.base.lines };
        S.mode = 'stem';
        newJudge();
        autotune.setSong(S.cur.syl);
      }
    }
    paintBadge();
  }

  /** Karaoke shows or steps aside: the lane goes big, the singer leaves the song (and comes back after). */
  function stageKaraoke(on) {
    on = !!on && S.on && S.open;
    if (on) lane.dataset.k = '1';
    else delete lane.dataset.k;
    tape.textContent = on ? 'Karaoke' : 'Vocals';
    S.rng = null;
    S.trail = [];
    const v = vocalsTrack();
    if (on && v && !v.muted) {
      stage.setStem('vocals', { muted: true });
      S.tookOut = true;
    } else if (!on && S.tookOut) {
      if (v && v.muted) stage.setStem('vocals', { muted: false });
      S.tookOut = false;
    }
    if (S.shown !== on) {
      S.shown = on;
      onKaraoke && onKaraoke(on);
    }
    paintBadge();
  }

  function paintBadge() {
    const kNote = S.karaoke && S.on && !vocalsTrack() ? 'The singer stays in: split this song to sing it on your own' : '';
    badge.textContent = S.reading ? 'Listening to the singer…' : S.mode === 'stem' ? 'Notes from the recording' : S.mode === 'rhythm' ? 'Timing only: this song has no notes to sing' : kNote;
    badge.hidden = !badge.textContent;
  }

  async function begin() {
    if (!S.on || !S.open || !S.song) return;
    lane.hidden = false;
    lane.dataset.look = singLook();
    const token = S.token + 1;
    prepare();
    stageKaraoke(S.karaoke);
    const ok = await mic.start('sing');
    if (token !== S.token || !S.on) return;
    if (!ok) {
      turn(false);
      toast({ title: 'No microphone', message: mic.error || 'Plug in a microphone to sing along.', kind: 'err' });
      return;
    }
    const p = prefs();
    if (!p.tipSeen) {
      setPref('tipSeen', true);
      const v = vocalsTrack();
      toast({
        title: 'Singing is on',
        message: 'Headphones work best: the microphone also hears the speakers.',
        kind: 'info',
        timeout: 9000,
        actions: v && !v.muted && !S.karaoke ? [{ label: 'Take the singer out', onClick: () => stage.setStem('vocals', { muted: true }) }] : [],
      });
    }
  }

  function end() {
    log(false);
    S.token++;
    mic.stop('sing');
    autotune.setSong(null);
    S.judge = null;
    lane.hidden = true;
    stageKaraoke(false);
  }

  /** Switch singing (beside the guitar part) on or off for this song. It is remembered for the song. */
  function turn(on) {
    if (!S.song) return;
    const want = !!on && S.base.syl.length > 0;
    const map = { ...prefs().on };
    if (want) map[S.song.id] = 1;
    else delete map[S.song.id];
    setPref('on', map);
    apply(want || S.karaoke);
    api.app.activity && want && api.app.activity(`Singing ${S.song.title}`).catch(() => {});
  }

  /** Singing starts or stops (either kind). */
  function apply(on) {
    const was = S.on;
    S.on = on;
    paintChip();
    if (on && !was) begin();
    else if (on) stageKaraoke(S.karaoke);
    else if (was) end();
  }

  /**
   * Karaoke for this visit to the song (asked for from the Karaoke page; not
   * remembered, so the highway's own Sing button is always the kind beside
   * the guitar part). Says whether the song has words to sing.
   */
  function setKaraoke(on) {
    on = !!on && !!S.song && S.base.syl.length > 0;
    if (S.karaoke === on) return on;
    S.karaoke = on;
    apply(on || !!(S.song && prefs().on[S.song.id]));
    api.app.activity && on && api.app.activity(`Karaoke: ${S.song.title}`).catch(() => {});
    return on;
  }

  /** Writes the run so far to your stats (as the part "vocals") and starts a fresh one. */
  function log(full) {
    const j = S.judge;
    if (!j || !S.song) return null;
    j.tick(full ? Infinity : S.lastT); // settle what's over (all of it when the song ended)
    const sum = j.summary();
    if (sum.notes >= 5 && S.secs >= 5) {
      S.lastResult = { ...sum, mode: S.mode, prev: S.best, songId: S.song.id };
      api.stats
        .log({ songId: S.song.id, part: 'vocals', seconds: S.secs, accuracy: sum.acc, notes: sum.notes, hit: sum.hit, speed: S.slowest, at: S.at, bestStreak: sum.bestStreak, ...(full ? { full: true } : {}) })
        .catch(() => {});
      if (S.slowest >= 0.999 && sum.notes >= 20) S.best = Math.max(S.best || 0, sum.acc);
    }
    S.secs = 0;
    S.at = Date.now();
    return sum;
  }

  const noWords = () => toast({ title: 'No words to sing', message: 'This song has no lyrics in it.', kind: 'info' });
  async function options(el) {
    const r = el.getBoundingClientRect();
    const check = (f) => () => (f() ? '✓' : '');
    // the menu opens at once; the microphones are read when their side menu opens
    let list = [];
    mic.devices().then((l) => (list = l)).catch(() => {});
    const v = vocalsTrack();
    showMenu(r.left, r.bottom + 6, [
      { heading: true, label: 'How strict' },
      ...Object.entries(SING_LEVELS).map(([id, l]) => ({
        label: l.name,
        hint: check(() => prefs().level === id),
        keep: true,
        onClick: () => {
          if (prefs().level === id) return;
          setPref('level', id);
          log(false);
          if (S.judge) newJudge();
        },
      })),
      '-',
      v ? { label: 'Take the singer out of the song', hint: check(() => v.muted), keep: true, onClick: () => stage.setStem('vocals', { muted: !v.muted }) } : null,
      {
        label: 'Microphone',
        submenu: () =>
          list.length
            ? list.map((d) => ({ label: d.label, hint: check(() => d.id === mic.deviceId), keep: true, onClick: () => mic.setDevice(d.id, d.label) }))
            : [{ label: 'No microphone found', disabled: true }],
      },
      { label: () => tuneLabel(), submenu: () => tuneMenu() },
      { label: 'Look', submenu: SING_LOOKS.map(([id, name]) => ({ label: name, hint: check(() => singLook() === id), keep: true, onClick: () => setSingLook(id) })) },
      '-',
      S.karaoke ? { label: 'Leave karaoke', icon: 'x', onClick: () => onLeave && onLeave() } : { label: 'Stop singing', icon: 'x', onClick: () => turn(false) },
    ]);
  }
  chip.onclick = () => {
    if (!S.base.syl.length) return noWords();
    if (S.on && !S.karaoke && !S.held) return options(chip);
    if (onAsk) onAsk('sing');
    else turn(true);
  };
  kchip.onclick = () => {
    if (!S.base.syl.length) return noWords();
    if (S.on && S.karaoke) return options(kchip);
    if (onAsk) onAsk('karaoke');
    else setKaraoke(true);
  };
  window.addEventListener('sing-look', () => {
    lane.dataset.look = singLook();
    S.line = -2;
  });

  // ------------------------------------------------------------ drawing --
  /** Sizes of the Bars look: the small lane beside the highway, or the big one in karaoke. */
  const SMALL = { H: 124, top: 20, bot: 70, bh: 11, font: 17, wordY: 108, dot: 6, nextY: 14, nextFont: 15 };
  const BIG = { H: 310, top: 40, bot: 210, bh: 20, font: 27, wordY: 282, dot: 10, nextY: 28, nextFont: 20 };
  const lay = () => (lane.dataset.k ? BIG : SMALL);

  function size() {
    const w = lane.clientWidth;
    const hgt = lay().H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hgt * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W: w, Hh: hgt };
  }

  /** The syllable being sung at t (within the slack), or null. */
  function sylAt(t) {
    const syl = S.cur.syl;
    let best = null;
    for (let i = S.judge ? Math.max(0, S.judge.next - 2) : 0; i < syl.length; i++) {
      const s = syl[i];
      if (s.t - SLACK > t) break;
      if (t <= s.t + s.d + SLACK) {
        if (!best || (t >= s.t && t <= s.t + s.d)) best = s;
      }
    }
    return best;
  }

  function roundRect(x, y, w, hh, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, hh, r);
    else g.rect(x, y, w, hh);
  }

  /** What the voice dot shows: on the note it settles onto the bar, off the note it shows where you are. */
  function shownVoice(t, voice, target) {
    if (!voice || !voice.voiced) return null;
    const near = target && target.p !== null ? target.p : S.rng ? (S.rng.lo + S.rng.hi) / 2 : 60;
    const p = voice.midi === null || voice.midi === undefined ? null : nearOctave(voice.midi, near);
    let ok = false;
    let show = p === null ? near : p;
    if (target && S.judge) {
      const i = S.cur.syl.indexOf(target);
      ok = i >= 0 && S.judge.on(i, voice);
      // on the note: drawn mostly on the bar, so a held note looks held
      if (ok && target.p !== null && p !== null) show = target.p + (p - target.p) * 0.3;
    }
    return { p: show, ok };
  }

  function drawBars(t, voice) {
    const { W, Hh } = size();
    if (!W) return;
    const Z = lay();
    const j = S.judge;
    const syl = S.cur.syl;
    g.clearRect(0, 0, W, Hh); // the road case behind is the lane's own (CSS)
    if ('fontStretch' in g) g.fontStretch = 'condensed';

    const nowX = Math.round(W * 0.16); // the lane runs across the top; you sing at the line near its left end
    const pps = (W - nowX - 8) / AHEAD;
    const X = (time) => nowX + (time - t) * pps;
    const top = Z.top;
    const bot = Z.bot;
    // first syllable still on screen
    let a = 0;
    let b = syl.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (syl[m].t + syl[m].d < t - nowX / pps - 0.2) a = m + 1;
      else b = m;
    }
    // the notes in view decide how high and low the lane reaches (it glides, never jumps)
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = a; i < syl.length && syl[i].t < t + AHEAD + 0.5; i++) {
      if (syl[i].p === null) continue;
      lo = Math.min(lo, syl[i].p);
      hi = Math.max(hi, syl[i].p);
    }
    if (lo === Infinity) {
      lo = S.rng ? S.rng.lo + 2 : 55;
      hi = S.rng ? S.rng.hi - 2 : 65;
    }
    const mid = (lo + hi) / 2;
    const half = Math.max(5, (hi - lo) / 2 + 2);
    if (!S.rng) S.rng = { lo: mid - half, hi: mid + half };
    else {
      S.rng.lo += (mid - half - S.rng.lo) * 0.06;
      S.rng.hi += (mid + half - S.rng.hi) * 0.06;
    }
    const Y = (p) => bot - ((p - S.rng.lo) / (S.rng.hi - S.rng.lo)) * (bot - top);
    const clampY = (y) => Math.max(top - 6, Math.min(bot + 6, y));
    const midY = (top + bot) / 2;
    const fade = (x) => (x < nowX ? Math.max(0, Math.min(1, x / (nowX * 0.35))) : 1);
    const target = sylAt(t - MIC_DELAY);

    // bars: plain pills, the one to sing now a little brighter
    const BH = Z.bh;
    for (let i = a; i < syl.length; i++) {
      const s = syl[i];
      if (s.t > t + AHEAD + 0.3) break;
      const x0 = X(s.t);
      const x1 = Math.max(x0 + BH, X(s.t + s.d) - 3);
      const y = clampY(s.p === null ? midY : Y(s.p));
      const res = j ? j.result[i] : null;
      const gold = j && j.lineResult[s.line] === 1;
      g.globalAlpha = fade((x0 + x1) / 2) * (x0 > W - 40 ? Math.max(0, (W - x0) / 40) : 1);
      roundRect(x0, y - BH / 2, x1 - x0, BH, BH / 2);
      if (res === 'hit') {
        g.fillStyle = gold ? GOLD : CYAN;
        g.shadowColor = gold ? GOLD : CYAN;
        g.shadowBlur = 8;
        g.fill();
        g.shadowBlur = 0;
        continue;
      }
      const isNow = s === target;
      g.fillStyle = res === 'miss' ? 'rgba(245, 237, 218, 0.07)' : isNow ? 'rgba(245, 237, 218, 0.34)' : 'rgba(245, 237, 218, 0.18)';
      if (s.p === null && !res) {
        // no note: any voice counts, so the bar is only an outline
        g.strokeStyle = 'rgba(245, 237, 218, 0.4)';
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        g.stroke();
        g.setLineDash([]);
      } else g.fill();
      // the stretches you were on the note fill in
      if (j && j.spans[i].length) {
        g.save();
        roundRect(x0, y - BH / 2, x1 - x0, BH, BH / 2);
        g.clip();
        g.fillStyle = CYAN;
        for (const [f, e] of j.spans[i]) g.fillRect(Math.max(x0, X(f)), y - BH / 2, Math.max(1.5, Math.min(x1, X(e)) - Math.max(x0, X(f))), BH);
        g.restore();
      }
    }
    g.globalAlpha = 1;

    // 4.16.1: the next line, written out in full above the lane as soon as the one before it starts,
    // so you can read it before its words scroll in
    const L = S.cur.lines;
    let ni = 0;
    while (ni < L.length && L[ni].t0 <= t + 0.05) ni++;
    const nl = L[ni];
    if (nl && nl.t0 - t < 14) {
      const words = syl.slice(nl.from, nl.to).map((x, k) => x.text + (x.joined || k === nl.to - nl.from - 1 ? '' : ' ')).join('');
      const soon = nl.t0 - t;
      g.globalAlpha = Math.min(1, (14 - soon) / 1.5) * 0.92;
      g.font = `700 ${Z.nextFont}px ${FONT}`;
      g.textBaseline = 'middle';
      const label = soon < 2.5 ? 'NEXT' : 'COMING UP';
      g.fillStyle = TUNGSTEN;
      g.fillText(label, nowX, Z.nextY);
      const lx = nowX + g.measureText(label).width + 10;
      g.fillStyle = '#000';
      g.fillText(words, lx + 1, Z.nextY + 1, W - lx - 90);
      g.fillStyle = soon < 2.5 ? INK : INK_3;
      g.fillText(words, lx, Z.nextY, W - lx - 90);
      g.globalAlpha = 1;
    }

    // words
    g.font = `800 ${Z.font + 2}px ${FONT}`;
    g.textBaseline = 'alphabetic';
    let right = -Infinity;
    let prevJoined = false;
    for (let i = a; i < syl.length; i++) {
      const s = syl[i];
      if (s.t > t + AHEAD + 0.3) break;
      const x = Math.max(X(s.t), right + (prevJoined ? 0 : 6));
      const res = j ? j.result[i] : null;
      const isNow = t >= s.t && t < s.t + s.d + 0.1;
      const lineShare = j ? j.lineResult[s.line] : null;
      g.globalAlpha = fade(x) * (x > W - 60 ? Math.max(0, (W - x) / 60) : 1);
      const word = s.joined ? `${s.text}-` : s.text;
      // a hard black shadow, like the song title and the score (a second copy: cheap to draw)
      g.fillStyle = '#000';
      g.fillText(word, x + 2, Z.wordY + 2);
      g.fillStyle = res === 'hit' ? (lineShare === 1 ? GOLD : CYAN_SOFT) : res === 'miss' ? 'rgba(169, 158, 140, 0.55)' : isNow ? '#ffffff' : s.t < t ? INK_3 : INK;
      if (isNow && !res) {
        // the word to sing now sits in a warm spotlight
        g.shadowColor = TUNGSTEN;
        g.shadowBlur = 14;
      }
      g.fillText(word, x, Z.wordY);
      g.shadowBlur = 0;
      right = x + g.measureText(word).width;
      prevJoined = s.joined;
      if (right < X(syl[i + 1] ? syl[i + 1].t : Infinity) - 30) right = -Infinity; // a pause: the next word sits at its own time
    }
    g.globalAlpha = 1;

    // now: a thin gold line in a soft beam of stage light
    const beam = g.createLinearGradient(nowX - 20, 0, nowX + 20, 0);
    beam.addColorStop(0, 'rgba(241, 206, 104, 0)');
    beam.addColorStop(0.5, 'rgba(241, 206, 104, 0.1)');
    beam.addColorStop(1, 'rgba(241, 206, 104, 0)');
    g.fillStyle = beam;
    g.fillRect(nowX - 20, top - 10, 40, bot - top + 20);
    g.fillStyle = GOLD;
    g.globalAlpha = 0.55;
    g.fillRect(nowX - 0.75, top - 10, 1.5, bot - top + 20);
    g.globalAlpha = 1;

    // what to sing right now: a small gold pointer at the note's height
    // (it waits at the next note, dimmer, between words)
    let aim = target && target.p !== null && t <= target.t + target.d ? target : null;
    if (!aim) {
      for (let i = j ? j.next : 0; i < syl.length && syl[i].t < t + 2.5; i++) {
        if (syl[i].p !== null && syl[i].t + syl[i].d > t) {
          aim = syl[i];
          break;
        }
      }
    }
    if (aim) {
      const y = clampY(Y(aim.p));
      const r = Z.dot;
      g.globalAlpha = aim.t > t ? 0.45 : 0.95;
      g.fillStyle = GOLD;
      g.beginPath();
      g.moveTo(nowX - Z.dot - 4, y);
      g.lineTo(nowX - Z.dot - 4 - r, y - r * 0.75);
      g.lineTo(nowX - Z.dot - 4 - r, y + r * 0.75);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }

    // your voice: a dot on the now line that glides (never jumps), with a smooth tail behind it
    const sv = shownVoice(t, voice, target);
    const dt = S.dotT === undefined ? 0 : Math.max(0, Math.min(0.1, t - S.dotT));
    S.dotT = t;
    if (sv) {
      S.dotP = S.dotP === undefined || S.dotGone ? sv.p : S.dotP + (sv.p - S.dotP) * (1 - Math.exp(-dt / 0.045));
      S.dotGone = false;
      S.trail.push({ t, p: S.dotP, ok: sv.ok });
    } else S.dotGone = true;
    while (S.trail.length && S.trail[0].t < t - 1.2) S.trail.shift();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = Z.dot * 0.7;
    // one stroke per stretch of the same colour, through the midpoints (a smooth curve)
    const tr = S.trail;
    const gap = (n) => tr[n].t - tr[n - 1].t > 0.12;
    let k = 0;
    while (k < tr.length - 1) {
      const ok = tr[k + 1].ok;
      g.beginPath();
      g.moveTo(X(tr[k].t), clampY(Y(tr[k].p)));
      let n = k + 1;
      for (; n < tr.length && !gap(n) && tr[n].ok === ok; n++) {
        const x0 = X(tr[n - 1].t);
        const y0 = clampY(Y(tr[n - 1].p));
        g.quadraticCurveTo(x0, y0, (x0 + X(tr[n].t)) / 2, (y0 + clampY(Y(tr[n].p))) / 2);
      }
      g.lineTo(X(tr[n - 1].t), clampY(Y(tr[n - 1].p)));
      g.globalAlpha = Math.max(0, 1 - (t - tr[n - 1].t) / 1.2) * (ok ? 0.75 : 0.45);
      g.strokeStyle = ok ? CYAN : INK;
      g.stroke();
      if (n >= tr.length) break;
      k = gap(n) ? n : n - 1; // a change of colour carries on from the same point
    }
    g.globalAlpha = 1;
    const lastP = S.trail[S.trail.length - 1];
    if (sv && lastP) {
      const y = clampY(Y(lastP.p));
      g.beginPath();
      g.arc(nowX, y, Z.dot, 0, Math.PI * 2);
      g.fillStyle = lastP.ok ? CYAN : INK;
      g.shadowColor = lastP.ok ? CYAN : 'rgba(245, 237, 218, 0.6)';
      g.shadowBlur = lastP.ok ? 16 : 8;
      g.fill();
      g.shadowBlur = 0;
    } else if (mic.on) {
      // listening, nothing heard: a faint ring on the line shows the microphone is alive
      const lv = Math.min(1, (voice ? voice.level : 0) * 8);
      g.beginPath();
      g.arc(nowX, midY, Z.dot * 0.8, 0, Math.PI * 2);
      g.strokeStyle = `rgba(245, 237, 218, ${0.18 + lv * 0.5})`;
      g.lineWidth = 1.5;
      g.stroke();
    }

    paintScore();
  }

  /** The score tape: how much you've sung right, and good lines in a row. */
  function paintScore() {
    const j = S.judge;
    const txt = j && j.judged ? `${Math.round(j.accuracy * 100)}%${j.streak >= 2 ? ` ×${j.streak}` : ''}` : '';
    if (score.textContent !== txt) {
      score.textContent = txt;
      score.hidden = !txt;
    }
  }

  /** The line on show at t: the one being sung stays until its last word is over. */
  function lineAt(t) {
    const L = S.cur.lines;
    let i = -1;
    for (let k = 0; k < L.length; k++) {
      if (L[k].t0 <= t) i = k;
      else break;
    }
    if (i < 0) i = L.length && L[0].t0 - 1.5 <= t ? 0 : -1;
    else if (t > L[i].t1 + 0.1 && L[i + 1] && L[i + 1].t0 - t < 2.5) i++;
    return i >= 0 && t < L[i].t1 + 1.5 ? i : -1;
  }

  function drawWords(t, voice) {
    const j = S.judge;
    const syl = S.cur.syl;
    const i = lineAt(t);
    wordsBox.style.visibility = i < 0 ? 'hidden' : 'visible';
    if (i < 0) return;
    const line = S.cur.lines[i];
    const text = (k) => syl[k].text + (syl[k].joined || k === line.to - 1 ? '' : ' ');
    if (i !== S.line) {
      S.line = i;
      nowRow.innerHTML = '';
      for (let k = line.from; k < line.to; k++) nowRow.append(h('span', { text: text(k) }));
      const nx = S.cur.lines[i + 1];
      nextRow.textContent = nx ? syl.slice(nx.from, nx.to).map((s, k) => s.text + (s.joined || k === nx.to - nx.from - 1 ? '' : ' ')).join('') : '';
    }
    const spans = nowRow.children;
    for (let k = line.from; k < line.to; k++) {
      const res = j ? j.result[k] : null;
      const s = syl[k];
      const cls = res === 'hit' ? (j.lineResult[i] === 1 ? 'hit gold' : 'hit') : res === 'miss' ? 'miss' : t >= s.t && t < s.t + s.d + 0.25 ? 'now' : s.t < t ? 'sung' : '';
      if (spans[k - line.from].className !== cls) spans[k - line.from].className = cls;
    }
    // your voice against the note: the dot sits in the middle when you're on it, above when sharp
    const target = sylAt(t - MIC_DELAY);
    const dot = meter.lastChild;
    const cents = SING_LEVELS[prefs().level].cents;
    if (voice && voice.voiced) {
      let off = target && target.p !== null && voice.midi !== null && voice.midi !== undefined ? foldCents(voice.midi, target.p) : 0;
      const i = target ? syl.indexOf(target) : -1;
      const ok = i >= 0 && j ? j.on(i, voice) : !!target && Math.abs(off) <= cents;
      if (ok) off *= 0.3; // on the note: the dot settles in the middle
      dot.style.top = `${50 - Math.max(-50, Math.min(50, (off / 300) * 50))}%`;
      dot.className = ok ? 'ok' : 'off';
    } else dot.className = '';
    meterBar.style.setProperty('--lv', String(Math.min(1, (voice ? voice.level : 0) * 6)));
    paintScore();
  }

  return {
    chip,
    kchip,
    /** Singing is on and showing: the plain lyrics step aside. */
    get active() {
      return live();
    },
    /** Karaoke is showing: the highway clears the neck and the notes away and doesn't score the guitar. */
    get karaoke() {
      return live() && S.karaoke;
    },
    /** The song (or its lyrics) changed. */
    setSong(song, lyrics) {
      if (S.song && song && S.song.id === song.id && S.base.raw === lyrics) return;
      if (S.on) end();
      S.song = song || null;
      S.base = buildSing(lyrics || []);
      S.base.raw = lyrics;
      S.cur = S.base;
      S.lastResult = null;
      S.rng = null;
      S.best = undefined;
      S.karaoke = false;
      S.on = !!(song && prefs().on[song.id] && S.base.syl.length);
      paintChip();
      if (S.on && S.open) begin();
    },
    /** Your best singing score on this song before now (from your stats). */
    setBest(v) {
      S.best = v;
    },
    /** The highway opened or closed. Closed, the microphone is let go. */
    setOpen(open) {
      if (S.open === open) return;
      S.open = open;
      if (open && S.on) begin();
      else if (!open) {
        if (S.judge) end();
        // karaoke was for that visit only
        if (S.karaoke) {
          S.karaoke = false;
          S.on = !!(S.song && prefs().on[S.song.id]);
          paintChip();
        }
      }
    },
    /** Every frame while the highway shows: t is the song clock, vis the picture's clock. */
    frame(t, vis, playing, speed = 1) {
      if (!live()) return;
      const j = S.judge;
      if (t < S.lastT - 0.05 || t - S.lastT > 0.5) {
        j.rewind(t);
        S.trail = [];
      }
      const dt = Math.max(0, Math.min(0.25, t - S.lastT));
      S.lastT = t;
      const voice = mic.read();
      autotune.clock(t, playing ? speed : 0); // auto-tune follows the song's notes
      if (playing) {
        const tm = t - MIC_DELAY * speed;
        j.push(tm, voice);
        j.tick(tm);
        j.events.length = 0;
        S.secs += dt;
        S.slowest = Math.min(S.slowest, speed);
        if (S.lastResult) S.lastResult = null; // a new run
      }
      if (lane.dataset.look === 'words') drawWords(vis, voice);
      else drawBars(vis, voice);
    },
    /** The song ended: settle, log, and hand back how the singing went (or null). */
    ended() {
      if (!live()) return null;
      log(true);
      return S.lastResult;
    },
    /** How the singing went in the run that just ended (for the score card), or null. */
    result() {
      return S.lastResult;
    },
    /** Step aside for a moment (the timing check plays its own song). */
    hold(v) {
      if (S.held === v) return;
      S.held = v;
      lane.style.display = v ? 'none' : '';
      paintChip(); // while Piano shows, Sing isn't lit: pressing it comes back to singing
    },
    turn,
    setKaraoke,
    state: S, // tests
  };
}
