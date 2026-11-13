/**
 * Sing along on the highway: an add-on, off until you press the Sing chip.
 * A lane of its own where the lyrics sit (words, a bar for each syllable
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
import { buildSing, SingJudge, SING_LEVELS, SLACK, pitchedShare, withPitches, nearOctave, foldCents } from './sing.js';

const KEY = 'stagehand.sing';
const CYAN = '#33c8e0';
const CYAN_SOFT = '#9be9f5';
const GOLD = '#ffcf3a';
const FONT = "'Archivo', 'Segoe UI', sans-serif";
/** How long the microphone's sound takes to reach the page, roughly (seconds). */
const MIC_DELAY = 0.06;
/** Seconds of song the lane shows ahead of now. */
const AHEAD = 4;

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
async function notesFromStem(song, syl, engine) {
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
export function createSing({ root, stage, onKaraoke }) {
  const chip = h('button.hw-chip.hw-sing-chip', { type: 'button', hidden: true });
  const lane = h('div.hw-sing', { hidden: true, 'aria-hidden': 'true' });
  const cv = h('canvas');
  const meter = h('div.sw-meter', null, h('i'));
  const nowRow = h('div.sw-now');
  const nextRow = h('div.sw-next');
  const wordsBox = h('div.sw-words', null, meter, h('div.sw-lines', null, nowRow, nextRow));
  const badge = h('div.sw-badge');
  lane.append(cv, wordsBox, badge);
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

  function paintChip() {
    chip.hidden = !S.base.syl.length;
    chip.setAttribute('aria-pressed', String(S.on));
    chip.title = S.on ? (S.karaoke ? 'Karaoke is on: level, microphone, look' : 'Singing is on: level, microphone, look') : 'Sing along or karaoke: score your singing with a microphone';
    chip.innerHTML = `${icon('mic')}<span>${S.on ? `${S.karaoke ? 'Karaoke' : 'Sing'} · ${SING_LEVELS[prefs().level].name}` : 'Sing'}</span>${S.on ? icon('chevron') : ''}`;
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
      }
    }
    paintBadge();
  }

  /** Karaoke shows or steps aside: the lane goes big, the singer leaves the song (and comes back after). */
  function stageKaraoke(on) {
    on = !!on && S.on && S.open;
    if (on) lane.dataset.k = '1';
    else delete lane.dataset.k;
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
    S.judge = null;
    lane.hidden = true;
    stageKaraoke(false);
  }

  /** Switch singing on or off for this song; `karaoke` picks which kind (left as it was when not given). */
  function turn(on, karaoke) {
    if (!S.song) return;
    const was = S.on;
    S.on = !!on && S.base.syl.length > 0;
    if (S.on && karaoke !== undefined) S.karaoke = !!karaoke;
    const map = { ...prefs().on };
    if (S.on) map[S.song.id] = S.karaoke ? 2 : 1; // 2 = karaoke
    else delete map[S.song.id];
    setPref('on', map);
    paintChip();
    if (S.on && !was) begin();
    else if (S.on) stageKaraoke(S.karaoke); // already singing: only the kind changed
    else end();
    api.app.activity && S.on && !was && api.app.activity(`${S.karaoke ? 'Karaoke:' : 'Singing'} ${S.song.title}`).catch(() => {});
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

  chip.onclick = async () => {
    const r = chip.getBoundingClientRect();
    if (!S.on) {
      // two ways to sing: beside your guitar part, or with the stage to yourself
      showMenu(r.left, r.bottom + 6, [
        { label: 'Sing along', hint: 'with your guitar part', icon: 'mic', onClick: () => turn(true, false) },
        { label: 'Karaoke', hint: 'just the words', icon: 'mic', onClick: () => turn(true, true) },
      ]);
      return;
    }
    const p = prefs();
    const check = (v) => (v ? '✓' : '');
    const list = await mic.devices().catch(() => []);
    const v = vocalsTrack();
    showMenu(r.left, r.bottom + 6, [
      { heading: true, label: 'How strict' },
      ...Object.entries(SING_LEVELS).map(([id, l]) => ({
        label: l.name,
        hint: check(p.level === id),
        onClick: () => {
          setPref('level', id);
          log(false);
          if (S.judge) newJudge();
          paintChip();
        },
      })),
      '-',
      { label: 'Karaoke: just the words', hint: check(S.karaoke), onClick: () => turn(true, !S.karaoke) },
      v ? { label: 'Take the singer out of the song', hint: check(v.muted), onClick: () => stage.setStem('vocals', { muted: !v.muted }) } : null,
      {
        label: 'Microphone',
        submenu: list.length
          ? list.map((d) => ({ label: d.label, hint: check(d.id === mic.deviceId), onClick: () => mic.setDevice(d.id, d.label) }))
          : [{ label: 'No microphone found', disabled: true }],
      },
      { label: 'Look', submenu: SING_LOOKS.map(([id, name]) => ({ label: name, hint: check(singLook() === id), onClick: () => setSingLook(id) })) },
      '-',
      { label: 'Stop singing', icon: 'x', onClick: () => turn(false) },
    ]);
  };
  window.addEventListener('sing-look', () => {
    lane.dataset.look = singLook();
    S.line = -2;
  });

  // ------------------------------------------------------------ drawing --
  /** Sizes of the Bars look: the small lane beside the highway, or the big one in karaoke. */
  const SMALL = { H: 118, top: 18, bot: 66, bh: 10, font: 17, wordY: 100, nowH: 68, dot: 6, floor: 40, lvl: 60 };
  const BIG = { H: 300, top: 30, bot: 196, bh: 18, font: 27, wordY: 268, nowH: 208, dot: 10, floor: 76, lvl: 180 };
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

  function drawBars(t, voice) {
    const { W, Hh } = size();
    if (!W) return;
    const Z = lay();
    const j = S.judge;
    const syl = S.cur.syl;
    g.clearRect(0, 0, W, Hh);
    roundRect(0.5, 0.5, W - 1, Hh - 1, 12);
    g.fillStyle = 'rgba(6, 9, 16, 0.56)';
    g.fill();
    g.strokeStyle = 'rgba(155, 233, 245, 0.14)';
    g.lineWidth = 1;
    g.stroke();

    const nowX = Math.round(W * 0.3);
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
    const midY = (top + bot) / 2;
    const fade = (x) => (x < nowX ? Math.max(0, Math.min(1, x / (nowX * 0.35))) : 1);

    // bars
    const BH = Z.bh;
    for (let i = a; i < syl.length; i++) {
      const s = syl[i];
      if (s.t > t + AHEAD + 0.3) break;
      const x0 = X(s.t);
      const x1 = Math.max(x0 + 7, X(s.t + s.d) - 2);
      const y = Math.max(top - 4, Math.min(bot + 4, s.p === null ? midY : Y(s.p)));
      const res = j ? j.result[i] : null;
      const lineShare = j ? j.lineResult[s.line] : null;
      const gold = lineShare === 1;
      g.globalAlpha = fade((x0 + x1) / 2) * (x0 > W - 40 ? Math.max(0, (W - x0) / 40) : 1);
      roundRect(x0, y - BH / 2, x1 - x0, BH, BH / 2);
      if (res === 'hit') {
        g.fillStyle = gold ? GOLD : CYAN;
        g.shadowColor = gold ? GOLD : CYAN;
        g.shadowBlur = 10;
        g.fill();
        g.shadowBlur = 0;
      } else if (res === 'miss') {
        g.fillStyle = 'rgba(255, 255, 255, 0.13)';
        g.fill();
      } else {
        g.fillStyle = 'rgba(155, 233, 245, 0.2)';
        g.fill();
        g.strokeStyle = 'rgba(155, 233, 245, 0.6)';
        g.lineWidth = 1;
        if (s.p === null) g.setLineDash([3, 3]);
        g.stroke();
        g.setLineDash([]);
      }
      // the stretches you were on the note fill in
      if (j && res !== 'hit') {
        g.save();
        roundRect(x0, y - BH / 2, x1 - x0, BH, BH / 2);
        g.clip();
        g.fillStyle = CYAN;
        for (const [f, e] of j.spans[i]) g.fillRect(Math.max(x0, X(f)), y - BH / 2, Math.max(1.5, Math.min(x1, X(e)) - Math.max(x0, X(f))), BH);
        g.restore();
      }
    }
    g.globalAlpha = 1;

    // words
    g.font = `600 ${Z.font}px ${FONT}`;
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
      g.shadowColor = 'rgba(0, 0, 0, 0.9)';
      g.shadowBlur = 5;
      g.fillStyle = res === 'hit' ? (lineShare === 1 ? GOLD : CYAN_SOFT) : res === 'miss' ? 'rgba(200, 208, 225, 0.4)' : isNow ? '#ffffff' : s.t < t ? 'rgba(200, 208, 225, 0.6)' : 'rgba(244, 246, 251, 0.92)';
      if (isNow && !res) {
        g.shadowColor = CYAN;
        g.shadowBlur = 12;
      }
      const word = s.joined ? `${s.text}-` : s.text;
      g.fillText(word, x, Z.wordY);
      right = x + g.measureText(word).width;
      prevJoined = s.joined;
      if (right < X(syl[i + 1] ? syl[i + 1].t : Infinity) - 30) right = -Infinity; // a pause: the next word sits at its own time
    }
    g.shadowBlur = 0;
    g.globalAlpha = 1;

    // now
    g.fillStyle = 'rgba(255, 255, 255, 0.45)';
    g.fillRect(nowX - 1, 8, 2, Z.nowH);

    // your voice: a dot on the now line, with a short tail
    const target = sylAt(t - MIC_DELAY);
    const cents = SING_LEVELS[prefs().level].cents;
    if (voice && voice.voiced) {
      const near = target && target.p !== null ? target.p : (S.rng.lo + S.rng.hi) / 2;
      const p = voice.midi === null || voice.midi === undefined ? null : nearOctave(voice.midi, near);
      const ok = !!target && (target.p === null || (p !== null && Math.abs(foldCents(p, target.p)) <= cents));
      S.trail.push({ t, p: p === null ? (S.rng.lo + S.rng.hi) / 2 : p, ok });
    }
    while (S.trail.length && S.trail[0].t < t - 1.4) S.trail.shift();
    g.lineWidth = Z.dot / 2;
    g.lineCap = 'round';
    for (let k = 1; k < S.trail.length; k++) {
      const p0 = S.trail[k - 1];
      const p1 = S.trail[k];
      if (p1.t - p0.t > 0.09 || Math.abs(p1.p - p0.p) > 3) continue;
      g.globalAlpha = Math.max(0, 1 - (t - p1.t) / 1.4) * 0.8;
      g.strokeStyle = p1.ok ? CYAN : 'rgba(255, 255, 255, 0.75)';
      g.beginPath();
      g.moveTo(X(p0.t), Math.max(6, Math.min(Hh - Z.floor, Y(p0.p))));
      g.lineTo(X(p1.t), Math.max(6, Math.min(Hh - Z.floor, Y(p1.p))));
      g.stroke();
    }
    g.globalAlpha = 1;
    const lastP = S.trail[S.trail.length - 1];
    if (lastP && t - lastP.t < 0.08) {
      const y = Math.max(6, Math.min(Hh - Z.floor, Y(lastP.p)));
      g.beginPath();
      g.arc(nowX, y, Z.dot, 0, Math.PI * 2);
      g.fillStyle = lastP.ok ? CYAN : '#ffffff';
      g.shadowColor = lastP.ok ? CYAN : 'rgba(255,255,255,0.8)';
      g.shadowBlur = 14;
      g.fill();
      g.shadowBlur = 0;
    }

    // the microphone is alive: a small level bar at the left edge
    const lv = Math.min(1, (voice ? voice.level : 0) * 6);
    g.fillStyle = 'rgba(155, 233, 245, 0.18)';
    g.fillRect(6, 12, 3, Z.lvl);
    g.fillStyle = CYAN;
    g.fillRect(6, 12 + Z.lvl * (1 - lv), 3, Z.lvl * lv);

    // the score so far, and good lines in a row
    if (j && j.judged) {
      g.textAlign = 'right';
      const big = Z === BIG;
      g.font = `700 ${big ? 18 : 13}px ${FONT}`;
      g.fillStyle = CYAN_SOFT;
      g.fillText(`${Math.round(j.accuracy * 100)}%`, W - 12, big ? 26 : 20);
      if (j.streak >= 2) {
        g.fillStyle = GOLD;
        g.fillText(`×${j.streak}`, W - (big ? 70 : 52), big ? 26 : 20);
      }
      g.textAlign = 'left';
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
    const dot = meter.firstChild;
    const cents = SING_LEVELS[prefs().level].cents;
    if (voice && voice.voiced) {
      const off = target && target.p !== null && voice.midi !== null && voice.midi !== undefined ? foldCents(voice.midi, target.p) : 0;
      dot.style.top = `${50 - Math.max(-50, Math.min(50, (off / 300) * 50))}%`;
      dot.className = target && Math.abs(off) <= cents ? 'ok' : 'off';
    } else dot.className = '';
    meter.style.setProperty('--lv', String(Math.min(1, (voice ? voice.level : 0) * 6)));
  }

  return {
    chip,
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
      S.on = !!(song && prefs().on[song.id] && S.base.syl.length);
      S.karaoke = S.on && prefs().on[song.id] === 2;
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
      else if (!open && S.judge) end();
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
      chip.style.display = v ? 'none' : '';
    },
    turn,
    state: S, // tests
  };
}
