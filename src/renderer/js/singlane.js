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
import { state as store, on as onStore } from './store.js';
import { h, icon, showMenu, toast } from './ui.js';
import { mic } from './mic.js';
import { offerSinger, singerJob } from './singer-upgrade.js';
import { autotune, TUNE_STYLES, TUNE_NOTES, TUNE_LEVELS, TUNE_VOICES } from './autotune.js';
import { setJob } from './activity.js';
import { buildSing, SingJudge, SING_LEVELS, SLACK, SING_SCORING, pitchCoverage, pitchedShare, nearOctave, foldCents, flatChart, checkNotes, noteAt, tuneNotes } from './sing.js';

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
// 4.23: how far ahead the lane shows (seconds): picked in the Sing menu
const AHEADS = [
  [2, 'Close (2 s)'],
  [3, 'Normal (3 s)'],
  [4, 'Far (4 s)'],
];

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
/** 4.18.2: where a song's notes to sing come from: 'auto', 'chart' or 'recording' (kept per song). */
function notesPick(song) {
  const n = (song && prefs().notes) || {};
  return (song && n[song.id]) || 'auto';
}
function setNotesPick(song, id) {
  if (!song) return;
  const n = prefs().notes || {};
  if (id === 'auto') delete n[song.id];
  else n[song.id] = id;
  setPref('notes', n);
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
const PKEY = 'stagehand.singLines'; // 4.19: each syllable's note and line ('stagehand.singNotes' held one note each)
try {
  localStorage.removeItem('stagehand.singNotes');
} catch (_) {}
function cachedNotes(key) {
  try {
    const c = JSON.parse(localStorage.getItem(PKEY) || '[]');
    const e = c.find((x) => x.k === key);
    return e ? e.n.map((x) => (x ? { p: x[0], q: x[1], c: x[2] || null } : { p: null, c: null, q: 0 })) : null;
  } catch (_) {
    return null;
  }
}
function keepNotes(key, notes) {
  const pack = notes.map((x) => (x.p === null ? 0 : x.c ? [x.p, Math.round(x.q * 100) / 100, x.c] : [x.p, Math.round(x.q * 100) / 100]));
  // the last 20 songs sung (fewer when the browser's store is full)
  for (let keep = 19; keep >= 0; keep -= 5) {
    try {
      const c = JSON.parse(localStorage.getItem(PKEY) || '[]').filter((x) => x.k !== key);
      localStorage.setItem(PKEY, JSON.stringify([...c.slice(c.length - keep), { k: key, n: pack }]));
      return;
    } catch (_) {}
  }
}

// 4.19: how far each song's notes were checked against the singer (kept for every song sung)
const CKEY = 'stagehand.singCheck';
/** { share, heard, notes, fixed, kept, blank, agreed, added } for a song whose notes were checked, or null. */
export function singCheck(songId) {
  try {
    return (JSON.parse(localStorage.getItem(CKEY) || '{}') || {})[songId] || null;
  } catch (_) {
    return null;
  }
}
function keepCheck(songId, check) {
  try {
    const all = JSON.parse(localStorage.getItem(CKEY) || '{}') || {};
    if (check) all[songId] = check;
    else delete all[songId];
    localStorage.setItem(CKEY, JSON.stringify(all));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('sing-check', { detail: { songId } }));
}
/** The mark in words: "Checked 94%", and the long version for a tooltip. */
export function checkWords(c) {
  if (!c) return null;
  const pct = Math.round(c.share * 100);
  const parts = [`${c.heard} of ${c.notes} notes were heard clearly on the singer’s recording and are sung as the singer sang them`];
  if (c.fixed) parts.push(`${c.fixed} of the chart’s notes were wrong and were replaced`);
  if (c.added) parts.push(`${c.added} had no note in the chart`);
  if (c.kept) parts.push(`${c.kept} couldn’t be heard and keep the chart’s note (the chart is right around them)`);
  if (c.blank) parts.push(`${c.blank} couldn’t be heard and are left open: any singing counts there`);
  return { short: `Checked ${pct}%`, pct, long: parts.join('. ') + '.' };
}

let worker = null;
let jobs = 0;
/** Every syllable's note and line ({ p, c, q }), read off the song's vocals stem (null when it has none). */
export async function notesFromStem(song, syl, engine) {
  const st = await api.stems.status(song.id).catch(() => null);
  const f = st && st.state === 'ready' && Array.isArray(st.stems) ? st.stems.find((x) => x.name === 'vocals') : null;
  if (!f || !f.url) return null;
  const key = `${song.id}|${f.url}|${syl.length}`;
  const had = cachedNotes(key);
  if (had && had.length === syl.length) return had;
  const { loadTrackData } = await import('./audio-engine.js');
  const data = await loadTrackData(f.url, undefined, { rate: engine.sampleRate, frames: engine.frames });
  if (!worker) worker = new Worker(new URL('../workers/vocal-pitch-worker.js', import.meta.url), { type: 'module' });
  const id = ++jobs;
  const found = await new Promise((resolve, reject) => {
    const on = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', on);
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.notes);
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
  return a && v ? `${a} · ${v}` : a ? `Auto-tune: ${a}` : v ? `Voice: ${v}` : autotune.hear ? 'My voice' : 'Auto-tune';
}
/** Your voice in the song: plain, auto-tuned, or changed for fun (the Sing menu and the Karaoke page). */
export function tuneMenu() {
  // the ticks are read again after every press, so the menu stays open while you try things
  const check = (f) => () => (f() ? '✓' : '');
  const HOW = { off: 'No tuning', natural: 'A gentle nudge onto the note', pop: 'Tight, like a pop record', robot: 'Snaps hard from note to note: the T-Pain sound' };
  return [
    { heading: true, label: 'Your voice in the song' },
    { label: 'Hear my voice', title: 'Your voice played with the song, as it is', hint: check(() => autotune.hear), keep: true, onClick: () => (autotune.setHear(!autotune.hear), tuneTip()) },
    '-',
    { heading: true, label: 'Auto-tune: carries you onto the right note' },
    ...TUNE_STYLES.map(([id, name]) => ({ label: name, title: HOW[id] || '', hint: check(() => autotune.style === id), keep: true, onClick: () => (autotune.setStyle(id), autotune.setMuted(false), tuneTip()) })),
    { label: () => `Tune to: ${nameOf(TUNE_NOTES, autotune.notes).toLowerCase()}`, submenu: TUNE_NOTES.map(([id, name]) => ({ label: name, hint: check(() => autotune.notes === id), keep: true, onClick: () => autotune.setNotes(id) })) },
    '-',
    { heading: true, label: 'Just for fun' },
    { label: () => `Voice: ${nameOf(TUNE_VOICES, autotune.voice).toLowerCase()}`, submenu: TUNE_VOICES.map(([id, name, about]) => ({ label: name, title: about || '', hint: check(() => autotune.voice === id), keep: true, onClick: () => (autotune.setVoice(id), autotune.setMuted(false), tuneTip()) })) },
    '-',
    // muted: the choices above are kept for next time, but your voice isn't played
    { label: 'Mute my voice', hint: () => (autotune.picked ? (autotune.muted ? '✓' : '') : 'not playing'), keep: true, onClick: () => autotune.picked && (autotune.setMuted(!autotune.muted), tuneTip()) },
    { label: 'Voice volume', submenu: TUNE_LEVELS.map(([v, name]) => ({ label: name, hint: check(() => Math.abs(autotune.vol - v) < 0.01), keep: true, onClick: () => autotune.setVol(v) })) },
  ];
}

// the sound thread's note readings go to the microphone's tracker, which the score reads
autotune.addEventListener('pitch', (e) => mic.feed(e.detail));
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
// 4.18.1: say when the microphone is pulled out and when it's back
mic.addEventListener('lost', () => toast({ title: 'Microphone unplugged', message: 'Plug it back in: it comes back by itself.', kind: 'info' }));
mic.addEventListener('back', () => toast({ title: 'Microphone back', message: mic.name ? mic.name.split(' (')[0] : '', kind: 'info' }));

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
  const tuneTape = h('button.sw-tape.sw-tune', { type: 'button', title: 'Click for auto-tune, voices and hearing yourself' });
  const paintTune = () => {
    tuneTape.innerHTML = icon('wand');
    tuneTape.append(h('span', { text: tuneLabel() }));
    // 4.18.1: it looked like a label; the arrow says it opens a menu
    tuneTape.insertAdjacentHTML('beforeend', `<i class="sw-tune-arrow">${icon('chevron')}</i>`);
    tuneTape.setAttribute('aria-pressed', String(autotune.wanted));
    tuneTape.setAttribute('aria-haspopup', 'menu');
    // a little wiggle until it has been opened once
    let opened = false;
    try {
      opened = localStorage.getItem('stagehand.tuneOpened') === '1';
    } catch (_) {}
    tuneTape.classList.toggle('sw-tune-new', !opened);
  };
  paintTune();
  autotune.addEventListener('change', paintTune);
  tuneTape.onclick = (e) => {
    e.stopPropagation();
    const r = tuneTape.getBoundingClientRect();
    try {
      localStorage.setItem('stagehand.tuneOpened', '1');
    } catch (_) {}
    tuneTape.classList.remove('sw-tune-new');
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
      const html = `${icon(name === 'Sing & play' ? 'mic' : 'music')}<span>${name}</span>${icon('chevron')}`;
      if (el.__html !== html) el.innerHTML = el.__html = html;
    };
    // 4.18.2: "Sing" read like karaoke; this one is singing while your part plays on the highway
    paint(chip, singing, 'Sing & play', 'Sing & play: sing into a microphone while you play your guitar or bass part', 'Sing & play is on: level, microphone, auto-tune, look');
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

  /**
   * Works out what to sing. 4.19: on a split song every chart note is checked against the singer
   * (the recording wins where they disagree; see checkNotes). Not split: the chart's notes, unless
   * they look made up, then timing only. "Notes to sing" in the menu overrides it per song.
   */
  async function prepare() {
    const token = ++S.token;
    const song = S.song;
    S.cur = S.base;
    S.check = null;
    const share = pitchedShare(S.base.syl);
    S.flat = share >= 0.6 && flatChart(S.base.syl);
    const pick = notesPick(song);
    // until the singer has been read (a few seconds the first time), or when they can't be
    const chartOk = share >= 0.6 && (pick === 'chart' || (pick === 'auto' && !S.flat));
    S.mode = chartOk ? 'charted' : 'rhythm';
    if (!chartOk && share > 0) S.cur = { syl: S.base.syl.map((x) => ({ ...x, p: null })), lines: S.base.lines };
    S.reading = false;
    newJudge();
    paintBadge();
    autotune.setSong(S.mode === 'charted' ? S.cur.syl : null);
    offerSinger(song); // 4.19: a cleaner singer for this song? (asks once, never waits)
    if (pick === 'chart') return;
    S.reading = true;
    paintBadge();
    const job = `vocal:${song.id}`;
    setJob(job, { kind: 'vocal', label: 'Analyzing vocal melody', song: song.title, state: 'running', progress: null, phase: 'Reading the singer’s notes' });
    let found = null;
    try {
      found = await notesFromStem(song, S.base.syl, stage.engine);
    } catch (_) {
      found = null;
    }
    setJob(job, { kind: 'vocal', label: 'Analyzing vocal melody', song: song.title, state: 'done', progress: 1, phase: found ? 'Vocal notes ready' : 'Timing only for this song' });
    if (token !== S.token || !S.on) return;
    S.reading = false;
    if (found) {
      const { syl, check } = checkNotes(S.base.syl, found, S.base.lines, pick === 'recording' ? 'recording' : 'auto');
      if (pitchedShare(syl) >= 0.4) {
        // carry on from where the song is: what was sung so far on the chart's notes is let go
        S.cur = { syl, lines: S.base.lines };
        S.mode = 'stem';
        S.check = check;
        keepCheck(song.id, check);
        // how hard it is to sing, from the notes the singer really sang (the Karaoke page's mark)
        if (api.tab && api.tab.vocalDiff)
          api.tab
            .vocalDiff(syl.map((x) => ({ t: x.t, d: x.d, p: x.p === null ? 0 : x.p })))
            .then((d) => d && d.level && keepCheck(song.id, { ...check, diff: { level: d.level, score: d.score, rate: d.rate, range: d.range, guess: d.guess, why: d.why } }))
            .catch(() => {});
        newJudge();
        autotune.setSong(tuneNotes(S.cur.syl));
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
    const rhythm = S.flat || notesPick(S.song) === 'recording' ? 'Timing only: this chart’s notes are guesses. Split the song to sing the singer’s real notes' : 'Timing only: this song has no notes to sing';
    const q = S.song && store.stems ? store.stems.get(S.song.id) : null;
    const pct = q && Number.isFinite(q.progress) ? ` ${Math.round(q.progress * 100)}%` : '';
    if (S.split === 'working' && S.mode !== 'stem' && notesPick(S.song) !== 'chart') {
      badge.textContent = S.mode === 'charted' ? `Splitting the song to check the notes against the singer…${pct}` : `Splitting the song for the real notes…${pct} Timing only until it’s done`;
      badge.hidden = false;
      return;
    }
    // 4.23: what the notes are, in plain words. The old "checked: 71%" was how many of the chart's
    // notes were confirmed on the singer's recording, not your score; it now says what it is.
    const cw = S.mode === 'stem' ? checkWords(S.check) : null;
    const cov = pitchCoverage(S.cur.syl);
    let txt = '';
    if (S.micDead) txt = 'No sound from the microphone. Check it’s plugged in, or pick another in this menu.';
    else if (S.reading) txt = 'Analyzing vocal melody…';
    else if (S.mode === 'rhythm') txt = rhythm;
    else if (cov !== null && cov < 0.999) txt = `Vocal notes ready · ${Math.round(cov * 100)}% with a note to sing · some phrases are timing only`;
    else if (cov !== null) txt = 'Vocal notes ready';
    if (!txt) txt = kNote;
    badge.textContent = txt;
    badge.title = [cw ? `${cw.pct}% of the notes were confirmed on the singer’s recording. ${cw.long}` : '', S.mode === 'charted' ? 'Notes from the song’s chart.' : S.mode === 'stem' ? 'Notes read off the singer’s recording, checked against the chart.' : ''].filter(Boolean).join(' ');
    // a cleaner singer being made in the background for this song: how far along it is
    const up = S.song && !S.reading ? singerJob(S.song.id) : null;
    if (up) badge.textContent = `${badge.textContent ? badge.textContent + ' · ' : ''}Making the singer cleaner${up.state === 'running' && up.progress ? ` ${Math.round(up.progress * 100)}%` : '…'}`;
    badge.classList.toggle('sw-checked', !!cw && !S.micDead);
    badge.classList.toggle('sw-warn', !!S.micDead);
    badge.hidden = !badge.textContent;
  }

  /**
   * 4.18.2: singing needs the song split: only the singer on their own gives the real notes (charts
   * often carry made-up ones), and karaoke takes the singer out. Starting to sing starts the split;
   * until it's done the words are scored on timing only.
   */
  function splitPhase() {
    const q = S.song && store.stems ? store.stems.get(S.song.id) : null;
    if (!S.song) return 'none';
    if (S.song.hasStems || (q && q.state === 'ready')) return 'ready';
    if (q && (q.state === 'queued' || q.state === 'running')) return 'working';
    return 'none';
  }
  async function needSplit() {
    S.split = splitPhase();
    if (S.split !== 'none') return paintBadge();
    S.split = 'working';
    paintBadge();
    toast({ title: 'Splitting this song for singing', message: 'Stagehand takes the singer out to find their real notes (and for karaoke). Until it’s done, your words are scored on timing.', kind: 'info', timeout: 9000 });
    const actions = await import('./actions.js');
    await actions.requestStems([S.song.id]).catch(() => {});
    S.split = splitPhase();
    paintBadge();
  }
  onStore('singer-upgrade', (u) => S.song && u && u.songId === S.song.id && S.on && paintBadge());
  onStore('stems', () => {
    if (!S.on || !S.song) return;
    const was = S.split;
    S.split = splitPhase();
    if (was === 'working' && S.split === 'ready') {
      prepare(); // the singer's real notes, now that they can be read
      toast({ title: 'Real notes ready', message: 'The song is split: the notes now follow the singer.', kind: 'ok' });
    } else paintBadge();
  });

  async function begin() {
    if (!S.on || !S.open || !S.song) return;
    lane.hidden = false;
    lane.dataset.look = singLook();
    const token = S.token + 1;
    prepare();
    stageKaraoke(S.karaoke);
    needSplit();
    const ok = await mic.start('sing');
    if (ok && !window.__NOFAST) autotune.listen('sing', true); // the fast note reader, for the score
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
    autotune.listen('sing', false);
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
      const vocal = { scoring: SING_SCORING, mode: S.karaoke ? 'karaoke' : 'singplay', level: sum.level, source: S.mode, pitch: sum.pitch, takingPart: sum.takingPart, phrases: sum.phrases, coverage: sum.coverage };
      S.lastResult = { ...sum, mode: S.mode, karaoke: S.karaoke, prev: S.bests ? S.bests[`vocals_${sum.level}`] : undefined, songId: S.song.id, full: !!full };
      api.stats
        .log({ songId: S.song.id, part: 'vocals', seconds: S.secs, accuracy: sum.acc, notes: sum.notes, hit: sum.hit, speed: S.slowest, at: S.at, bestStreak: sum.bestStreak, vocal, ...(full ? { full: true } : {}) })
        .catch(() => {});
      if (S.slowest >= 0.999 && sum.notes >= 20) {
        S.bests = S.bests || {};
        const k = `vocals_${sum.level}`;
        S.bests[k] = Math.max(S.bests[k] || 0, sum.acc);
      }
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
      { heading: true, label: 'Difficulty' },
      ...Object.entries(SING_LEVELS).map(([id, l]) => ({
        label: l.name,
        title: l.tell,
        sub: l.tell,
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
      {
        label: 'Notes to sing',
        submenu: () =>
          [
            ['auto', 'Pick for me: the chart, checked against the singer'],
            ['chart', S.flat ? 'The chart’s notes only (they look made up)' : 'The chart’s notes only'],
            ['recording', 'The singer’s notes only, from the recording'],
          ].map(([id, name]) => ({
            label: name,
            hint: check(() => notesPick(S.song) === id),
            keep: true,
            onClick: () => {
              if (notesPick(S.song) === id) return;
              setNotesPick(S.song, id);
              if (S.on && S.song) prepare();
            },
          })),
      },
      {
        label: 'How far ahead',
        submenu: () => AHEADS.map(([v, name]) => ({ label: name, hint: check(() => aheadSecs() === v), keep: true, onClick: () => setPref('ahead', v) })),
      },
      S.karaoke
        ? null
        : { label: 'Lane size', submenu: () => [['compact', 'Compact'], ['tall', 'Taller']].map(([v, name]) => ({ label: name, hint: check(() => (prefs().laneSize || 'compact') === v), keep: true, onClick: () => setPref('laneSize', v) })) },
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
  /**
   * Sizes of the Bars look: the small lane above the highway (Sing & play), or the big stage of karaoke.
   * 4.23: karaoke's lane is sized from the window (about 45% of its height, between 300 and 720 px),
   * the pitch area takes most of it, and the words sit underneath in two rows: the line being sung,
   * then the next one. Sing & play can be made taller in its menu.
   */
  function lay() {
    if (lane.dataset.k) {
      const vh = (document.documentElement.dataset.safe && document.body.clientHeight) || window.innerHeight || 800;
      const H = Math.round(Math.max(300, Math.min(720, vh * 0.45)));
      const font = Math.round(Math.max(26, Math.min(52, H * 0.085)));
      const nextFont = Math.round(font * 0.66);
      const words = Math.round(font * 1.25 + nextFont * 1.35 + 18);
      return { H, top: 34, bot: H - words - 14, bh: Math.max(16, Math.round(H / 26)), font, wordY: H - words + font + 2, nextY: H - 14, nextFont, dot: Math.max(9, Math.round(H / 34)), big: true, nowAt: 0.18 };
    }
    const tall = prefs().laneSize === 'tall';
    return tall
      ? { H: 220, top: 30, bot: 168, bh: 14, font: 22, wordY: 202, dot: 8, nextY: 15, nextFont: 15, big: false, nowAt: 0.16 }
      : { H: 150, top: 28, bot: 104, bh: 11, font: 19, wordY: 134, dot: 6, nextY: 14, nextFont: 14, big: false, nowAt: 0.16 };
  }
  const aheadSecs = () => (AHEADS.some(([v]) => v === prefs().ahead) ? prefs().ahead : 3);
  const levelOf = () => SING_LEVELS[prefs().level] || SING_LEVELS.medium;

  function size() {
    const w = lane.clientWidth;
    const Z = lay();
    const hgt = Z.H;
    if (cv.style.height !== `${hgt}px`) cv.style.height = `${hgt}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hgt * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W: w, Hh: hgt, Z };
  }

  /** The syllable being sung at t (within the level's slack), or null. */
  function sylAt(t) {
    const syl = S.cur.syl;
    const slack = S.judge ? S.judge.slack : SLACK;
    let best = null;
    for (let i = S.judge ? Math.max(0, S.judge.next - 2) : 0; i < syl.length; i++) {
      const s = syl[i];
      if (s.t - slack > t) break;
      if (t <= s.t + s.d + slack) {
        if (!best || (t >= s.t && t <= s.t + s.d)) best = s;
      }
    }
    return best;
  }

  /**
   * Where your voice is drawn. 4.23: your real pitch, moved to the octave nearest the note (so a low
   * voice isn't drawn off the bottom), never pulled onto the bar: what you see is what was heard.
   */
  function shownVoice(t, voice, target) {
    if (!voice || !voice.voiced) return null;
    const want = target && target.p !== null ? noteAt(target, t - MIC_DELAY) : null;
    const near = want !== null ? want : S.view ? S.view.c : 60;
    const p = voice.midi === null || voice.midi === undefined ? null : nearOctave(voice.midi, near);
    let ok = false;
    if (target && S.judge) {
      const i = S.cur.syl.indexOf(target);
      ok = i >= 0 && S.judge.on(i, voice);
    }
    return { p: p === null ? near : p, ok, pitched: p !== null, want };
  }

  /**
   * 4.23: the pitch view. The height of one semitone never changes during a song (the span is set once
   * from the tune, 12 to 19 semitones), so equal steps always look equal. When the tune goes beyond the
   * span, the view glides there ahead of time (it looks a few seconds forward) and only moves when a
   * note would be near the edge, so it never jumps in the middle of a note.
   */
  function viewRange(t, ahead, syl) {
    if (!S.rng || S.rng.of !== syl) {
      const ps = [];
      for (const x of syl) {
        if (x.p === null) continue;
        ps.push(x.p);
        if (x.c) for (const [, v] of x.c) ps.push(v);
      }
      ps.sort((x, y) => x - y);
      const sLo = ps.length ? ps[Math.floor((ps.length - 1) * 0.03)] : 55;
      const sHi = ps.length ? ps[Math.ceil((ps.length - 1) * 0.97)] : 65;
      const span = Math.max(12, Math.min(19, sHi - sLo + 4));
      S.rng = { of: syl, span, whole: sHi - sLo + 4 <= span, mid: (sLo + sHi) / 2 };
      S.view = null;
      // a syllable with no note (any voice counts) sits beside its neighbours, not in the middle
      let last = null;
      for (const x of syl) x.p !== null ? (last = x.p) : (x.near = last);
      last = null;
      for (let i = syl.length - 1; i >= 0; i--) {
        const x = syl[i];
        if (x.p !== null) last = x.p;
        else if (x.near === null || x.near === undefined) x.near = last;
      }
    }
    const R = S.rng;
    const half = R.span / 2;
    if (R.whole) return (S.view = { c: R.mid, lo: R.mid - half, hi: R.mid + half, span: R.span });
    // the notes coming up (a little behind too, so a held note stays in view)
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of syl) {
      if (x.t + x.d < t - 0.4) continue;
      if (x.t > t + ahead + 1.5) break;
      if (x.p === null) continue;
      lo = Math.min(lo, x.p);
      hi = Math.max(hi, x.p);
    }
    const v = S.view || { c: Number.isFinite(lo) ? (lo + hi) / 2 : R.mid, span: R.span };
    let want = v.c;
    if (Number.isFinite(lo)) {
      const edge = 1.5; // semitones of room kept at each edge
      if (hi - lo > R.span - 2 * edge) want = (lo + hi) / 2;
      else if (hi > v.c + half - edge) want = hi - half + edge;
      else if (lo < v.c - half + edge) want = lo + half - edge;
    }
    const dt = S.viewT === undefined ? 0 : Math.max(0, Math.min(0.1, Math.abs(t - S.viewT)));
    S.viewT = t;
    const c = S.view ? v.c + (want - v.c) * (1 - Math.exp(-dt / 0.45)) : want;
    return (S.view = { c, lo: c - half, hi: c + half, span: R.span });
  }

  /**
   * The words under the lane. 4.23: the line being sung stays still (it doesn't scroll), each syllable
   * lights as it's sung, and the next line waits underneath (karaoke) or above the lane (Sing & play).
   * A line too long for the lane is broken between words into parts that fit, never shrunk to
   * nothing; each part shows in turn.
   */
  function phraseRows(li, font, avail) {
    const key = `${li}|${font}|${Math.round(avail)}`;
    if (S.rows && S.rows.key === key && S.rows.of === S.cur) return S.rows.parts;
    const syl = S.cur.syl;
    const line = S.cur.lines[li];
    g.font = `800 ${font}px ${FONT}`;
    const parts = [];
    let cur = [];
    let w = 0;
    let word = [];
    let ww = 0;
    const flushWord = () => {
      if (!word.length) return;
      if (cur.length && w + ww > avail) {
        parts.push(cur);
        cur = [];
        w = 0;
      }
      cur.push(...word);
      w += ww;
      word = [];
      ww = 0;
    };
    for (let k = line.from; k < line.to; k++) {
      const s = syl[k];
      const text = s.joined ? `${s.text}-` : s.text;
      const sw = g.measureText(text).width;
      const gap = s.joined || k === line.to - 1 ? 0 : g.measureText(' ').width;
      word.push({ k, text, w: sw, gap });
      ww += sw + gap;
      if (!s.joined) flushWord();
    }
    flushWord();
    if (cur.length) parts.push(cur);
    S.rows = { key, of: S.cur, parts };
    return parts;
  }

  function drawPhrase(t, Z, W, nowX) {
    const j = S.judge;
    const syl = S.cur.syl;
    const L = S.cur.lines;
    const li = lineAt(t);
    const pad = Z.big ? Math.round(W * 0.06) : nowX;
    const avail = W - pad - (Z.big ? pad : 24);
    let nextText = '';
    let nextSoon = Infinity;
    if (li >= 0) {
      const parts = phraseRows(li, Z.font, avail);
      // the part holding the syllable to sing now (or the next one still to come)
      let pi = 0;
      for (let p = 0; p < parts.length; p++) {
        const last = parts[p][parts[p].length - 1];
        if (t <= syl[last.k].t + syl[last.k].d + 0.15) {
          pi = p;
          break;
        }
        pi = p;
      }
      const row = parts[pi];
      const rowW = row.reduce((a, x) => a + x.w + x.gap, 0);
      let x = Z.big ? Math.round((W - rowW) / 2) : pad;
      g.font = `800 ${Z.font}px ${FONT}`;
      g.textBaseline = 'alphabetic';
      for (const it of row) {
        const s = syl[it.k];
        const res = j ? j.result[it.k] : null;
        const gold = j && j.lineResult[s.line] === 1;
        g.fillStyle = '#000';
        g.fillText(it.text, x + 2, Z.wordY + 2);
        const base = res === 'hit' ? (gold ? GOLD : CYAN_SOFT) : res === 'miss' ? 'rgba(169, 158, 140, 0.6)' : s.t + s.d < t ? INK_3 : INK;
        g.fillStyle = base;
        g.fillText(it.text, x, Z.wordY);
        // the word being sung fills from the left as it goes, in the warm stage light
        if (!res && t >= s.t && t < s.t + s.d + 0.1) {
          const f = Math.max(0, Math.min(1, (t - s.t) / Math.max(0.05, s.d)));
          g.save();
          g.beginPath();
          g.rect(x - 2, Z.wordY - Z.font * 1.2, it.w * f + 2, Z.font * 1.6);
          g.clip();
          g.shadowColor = TUNGSTEN;
          g.shadowBlur = 14;
          g.fillStyle = '#ffffff';
          g.fillText(it.text, x, Z.wordY);
          g.restore();
        }
        x += it.w + it.gap;
      }
      // what comes after this part: the rest of the line, or the next line
      if (pi + 1 < parts.length) {
        nextText = parts[pi + 1].map((x) => x.text + (x.gap ? ' ' : '')).join('');
        nextSoon = syl[parts[pi + 1][0].k].t - t;
      } else if (L[li + 1]) {
        const nl = L[li + 1];
        nextText = syl.slice(nl.from, nl.to).map((x, k) => x.text + (x.joined || k === nl.to - nl.from - 1 ? '' : ' ')).join('');
        nextSoon = nl.t0 - t;
      }
    } else {
      // between lines: the next one waits where the words will be
      let ni = 0;
      while (ni < L.length && L[ni].t0 <= t) ni++;
      const nl = L[ni];
      if (nl && nl.t0 - t < 12) {
        nextText = syl.slice(nl.from, nl.to).map((x, k) => x.text + (x.joined || k === nl.to - nl.from - 1 ? '' : ' ')).join('');
        nextSoon = nl.t0 - t;
      }
    }
    if (!nextText) return;
    g.font = `700 ${Z.nextFont}px ${FONT}`;
    g.textBaseline = 'middle';
    const label = nextSoon < 2.5 ? 'NEXT' : 'COMING UP';
    const lw = g.measureText(label).width + 10;
    const tw = Math.min(avail - lw, g.measureText(nextText).width);
    let lx = Z.big ? Math.round((W - lw - tw) / 2) : nowX;
    g.globalAlpha = 0.95;
    g.fillStyle = TUNGSTEN;
    g.fillText(label, lx, Z.nextY);
    lx += lw;
    g.fillStyle = '#000';
    g.fillText(nextText, lx + 1, Z.nextY + 1, avail - lw);
    g.fillStyle = nextSoon < 2.5 ? INK : INK_3;
    g.fillText(nextText, lx, Z.nextY, avail - lw);
    g.globalAlpha = 1;
  }

  function drawBars(t, voice) {
    const { W, Hh, Z } = size();
    if (!W) return;
    const j = S.judge;
    const syl = S.cur.syl;
    const LV = levelOf();
    const AHEAD = aheadSecs();
    g.clearRect(0, 0, W, Hh); // the road case behind is the lane's own (CSS)
    if ('fontStretch' in g) g.fontStretch = 'condensed';

    const nowX = Math.round(W * Z.nowAt); // you sing at the line near the lane's left end
    const pps = (W - nowX - 8) / AHEAD;
    const X = (time) => nowX + (time - t) * pps;
    const top = Z.top;
    const bot = Z.bot;
    // first syllable still on screen (a short dimmed history to the left of the line)
    let a = 0;
    let b = syl.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (syl[m].t + syl[m].d < t - nowX / pps - 0.2) a = m + 1;
      else b = m;
    }
    const V = viewRange(t, AHEAD, syl);
    const semi = (bot - top) / V.span; // pixels per semitone: the same all song
    const Y = (p) => bot - (p - V.lo) * semi;
    const clampY = (y) => Math.max(top - 4, Math.min(bot + 4, y));
    const midY = (top + bot) / 2;
    const fade = (x) => (x < nowX ? Math.max(0, Math.min(1, x / (nowX * 0.35))) * 0.55 : 1);
    const target = sylAt(t - MIC_DELAY);

    // the ladder: a faint line for every semitone, a stronger one at every C, named at the left
    g.font = `700 ${Z.big ? 11 : 9}px ${FONT}`;
    g.textBaseline = 'middle';
    const showNames = Z.big || semi >= 9;
    for (let p = Math.ceil(V.lo); p <= Math.floor(V.hi); p++) {
      const y = Math.round(Y(p));
      if (y < top - 2 || y > bot + 2) continue;
      const pc = ((p % 12) + 12) % 12;
      const oct = pc === 0;
      g.fillStyle = oct ? 'rgba(241, 206, 104, 0.2)' : 'rgba(245, 237, 218, 0.05)';
      g.fillRect(Z.big ? 34 : nowX, y, W - (Z.big ? 34 : nowX) - 8, oct ? 1.5 : 1);
      if (showNames && (oct || (semi >= 12 && pc !== 1 && pc !== 3 && pc !== 6 && pc !== 8 && pc !== 10))) {
        g.fillStyle = oct ? 'rgba(241, 206, 104, 0.75)' : 'rgba(245, 237, 218, 0.4)';
        g.fillText(oct ? `C${Math.floor(p / 12) - 1}` : NOTE_NAMES[pc], 8, y);
      }
    }

    // 4.23: the band you may sing in (the level's room either side of the note), around the note
    // to sing now and the next few: wide on Easy, narrow on Hard
    const band = (LV.cents / 100) * semi;
    const bandFor = (s, x0, x1, alpha) => {
      if (s.p === null) return;
      const y = clampY(Y(s.p));
      g.globalAlpha = alpha;
      g.fillStyle = 'rgba(51, 200, 224, 0.11)';
      g.fillRect(x0, y - band, x1 - x0, band * 2);
      g.fillStyle = 'rgba(51, 200, 224, 0.28)';
      g.fillRect(x0, Math.round(y - band), x1 - x0, 1);
      g.fillRect(x0, Math.round(y + band), x1 - x0, 1);
      g.globalAlpha = 1;
    };

    // bars: a pill at the note's height, its length the note's length. A word the singer slides, bends
    // or runs over is drawn along its line (not on Easy, which asks for the main note)
    const BH = Z.bh;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = a; i < syl.length; i++) {
      const s = syl[i];
      if (s.t > t + AHEAD + 0.3) break;
      const x0 = X(s.t);
      const x1 = Math.max(x0 + BH, X(s.t + s.d) - 3);
      const res = j ? j.result[i] : null;
      if (!res && s.t < t + 1.6 && s.t + s.d > t - 0.2) bandFor(s, Math.max(nowX, x0), x1, s === target ? 1 : 0.55);
      const off = s.p !== null && (Y(s.p) < top - 4 || Y(s.p) > bot + 4) ? (Y(s.p) < top ? -1 : 1) : 0;
      const y = clampY(s.p === null ? (Number.isFinite(s.near) ? Y(s.near) : midY) : Y(s.p));
      const gold = j && j.lineResult[s.line] === 1;
      const line = LV.lines && s.c && s.p !== null && x1 - x0 > BH * 1.5;
      const shape = () => {
        g.beginPath();
        if (!line) return g.roundRect ? g.roundRect(x0, y - BH / 2, x1 - x0, BH, BH / 2) : g.rect(x0, y - BH / 2, x1 - x0, BH);
        const xa = x0 + BH / 2;
        const xb = x1 - BH / 2;
        g.moveTo(xa, clampY(Y(s.c[0][1])));
        for (const [ct, cp] of s.c) g.lineTo(Math.max(xa, Math.min(xb, X(ct))), clampY(Y(cp)));
        g.lineTo(xb, clampY(Y(s.c[s.c.length - 1][1])));
      };
      const paint = (style, outline) => {
        shape();
        if (line) {
          g.strokeStyle = style;
          g.lineWidth = outline ? 1 : BH;
          g.stroke();
        } else if (outline) {
          g.strokeStyle = style;
          g.lineWidth = 1.5;
          g.stroke();
        } else {
          g.fillStyle = style;
          g.fill();
        }
      };
      g.globalAlpha = fade((x0 + x1) / 2) * (x0 > W - 40 ? Math.max(0, (W - x0) / 40) : 1);
      if (res === 'hit') {
        g.shadowColor = gold ? GOLD : CYAN;
        g.shadowBlur = 8;
        paint(gold ? GOLD : CYAN);
        g.shadowBlur = 0;
        continue;
      }
      const isNow = s === target;
      if (s.p === null && !res) {
        // no reliable note here: timing only, any voice counts, so the bar is a dashed outline
        g.setLineDash([4, 4]);
        paint('rgba(245, 237, 218, 0.42)', true);
        g.setLineDash([]);
      } else paint(res === 'miss' ? 'rgba(245, 237, 218, 0.08)' : isNow ? 'rgba(245, 237, 218, 0.5)' : 'rgba(245, 237, 218, 0.3)');
      // a note beyond the view: a small arrow on the edge says which way it goes
      if (off && !res) {
        const ay = off < 0 ? top - 2 : bot + 2;
        g.fillStyle = TUNGSTEN;
        g.beginPath();
        g.moveTo(x0 + 6, ay + off * 6);
        g.lineTo(x0, ay);
        g.lineTo(x0 + 12, ay);
        g.closePath();
        g.fill();
      }
      // the stretches you were on the note fill in
      if (j && j.spans[i].length) {
        g.save();
        g.beginPath();
        for (const [f, e] of j.spans[i]) {
          const xf = Math.max(x0, X(f));
          g.rect(xf, top - 20, Math.max(1.5, Math.min(x1, X(e)) - xf), bot - top + 40);
        }
        g.clip();
        paint(CYAN);
        g.restore();
      }
    }
    g.globalAlpha = 1;

    drawPhrase(t, Z, W, nowX);

    // now: a thin gold line in a soft beam of stage light
    const beam = g.createLinearGradient(nowX - 20, 0, nowX + 20, 0);
    beam.addColorStop(0, 'rgba(241, 206, 104, 0)');
    beam.addColorStop(0.5, 'rgba(241, 206, 104, 0.12)');
    beam.addColorStop(1, 'rgba(241, 206, 104, 0)');
    g.fillStyle = beam;
    g.fillRect(nowX - 20, top - 10, 40, bot - top + 20);
    g.fillStyle = GOLD;
    g.globalAlpha = 0.7;
    g.fillRect(nowX - 1, top - 10, 2, bot - top + 20);
    g.globalAlpha = 1;

    // what to sing right now: a small gold pointer at the note's height (Hard: only while a note is on)
    let aim = target && target.p !== null && t <= target.t + target.d ? target : null;
    if (!aim && prefs().level !== 'hard') {
      for (let i = j ? j.next : 0; i < syl.length && syl[i].t < t + 2.5; i++) {
        if (syl[i].p !== null && syl[i].t + syl[i].d > t) {
          aim = syl[i];
          break;
        }
      }
    }
    if (aim) {
      const y = clampY(Y(noteAt(aim, Math.max(t, aim.t))));
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

    // your voice: a bright dot on the now line at the pitch you're singing, with a trail behind it.
    // Gaps where you weren't singing stay gaps.
    const sv = shownVoice(t, voice, target);
    const dt = S.dotT === undefined ? 0 : Math.max(0, Math.min(0.1, t - S.dotT));
    S.dotT = t;
    if (sv && sv.pitched) {
      S.dotP = S.dotP === undefined || S.dotGone ? sv.p : S.dotP + (sv.p - S.dotP) * (1 - Math.exp(-dt / 0.03));
      S.dotGone = false;
      S.trail.push({ t, p: S.dotP, ok: sv.ok });
    } else S.dotGone = true;
    while (S.trail.length && S.trail[0].t < t - 1.2) S.trail.shift();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = Z.dot * 0.7;
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
      g.globalAlpha = Math.max(0, 1 - (t - tr[n - 1].t) / 1.2) * (ok ? 0.85 : 0.55);
      g.strokeStyle = ok ? CYAN : '#ffffff';
      g.stroke();
      if (n >= tr.length) break;
      k = gap(n) ? n : n - 1;
    }
    g.globalAlpha = 1;
    const lastP = S.trail[S.trail.length - 1];
    if (sv && sv.pitched && lastP) {
      const y = clampY(Y(lastP.p));
      g.beginPath();
      g.arc(nowX, y, Z.dot, 0, Math.PI * 2);
      g.fillStyle = lastP.ok ? CYAN : '#ffffff';
      g.shadowColor = lastP.ok ? CYAN : 'rgba(255, 255, 255, 0.7)';
      g.shadowBlur = lastP.ok ? 16 : 8;
      g.fill();
      g.shadowBlur = 0;
      // Easy and Medium: an arrow beside the dot says which way to go when you're off the note
      if (!lastP.ok && sv.want !== null && prefs().level !== 'hard') {
        const up = lastP.p < sv.want;
        const ax = nowX + Z.dot + 8;
        g.fillStyle = TUNGSTEN;
        g.beginPath();
        g.moveTo(ax, y + (up ? -Z.dot : Z.dot));
        g.lineTo(ax - Z.dot * 0.6, y);
        g.lineTo(ax + Z.dot * 0.6, y);
        g.closePath();
        g.fill();
      }
    } else if (mic.on) {
      // listening: a faint ring shows the microphone is alive and how loud it hears you
      const lv = Math.min(1, (voice ? voice.level : 0) * 8);
      g.beginPath();
      g.arc(nowX, midY, Z.dot * 0.8, 0, Math.PI * 2);
      g.strokeStyle = `rgba(245, 237, 218, ${0.18 + lv * 0.5})`;
      g.lineWidth = 1.5;
      g.stroke();
    }
    micWatch(voice);
    paintScore();
  }

  /**
   * 4.23: silence and a dead microphone look different. While a song plays, a microphone that has
   * given no sound at all for 8 seconds is said so on the lane (check it's plugged in, or pick
   * another), apart from quiet singing between lines.
   */
  function micWatch(voice) {
    const now = performance.now();
    if (voice && voice.level > 0.0005) S.micHeard = now;
    if (S.micHeard === undefined) S.micHeard = now;
    const dead = !!mic.on && now - S.micHeard > 8000 && stage.engine && stage.engine.playing;
    if (dead !== !!S.micDead) {
      S.micDead = dead;
      paintBadge();
    }
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
      let off = target && target.p !== null && voice.midi !== null && voice.midi !== undefined ? foldCents(voice.midi, noteAt(target, t - MIC_DELAY)) : 0;
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
      S.bests = null;
      S.karaoke = false;
      S.on = !!(song && prefs().on[song.id] && S.base.syl.length);
      paintChip();
      if (S.on && S.open) begin();
    },
    /** Your best singing score on this song before now (from your stats). */
    setBest(v) {
      // 4.23: your bests per level, counted the new way ({ vocals_easy, vocals_medium, vocals_hard })
      S.bests = v && typeof v === 'object' ? { ...v } : null;
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
