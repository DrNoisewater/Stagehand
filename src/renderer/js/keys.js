/**
 * Piano on the highway: play the song on a keyboard plugged in by USB.
 *
 * Stagehand writes the piano part from the song itself (piano-arrange.js):
 * the singer's tune in the right hand, the guitar's riff where nobody sings,
 * the band's chords, the bass line in the left hand. It shows as real sheet
 * music (a grand staff scrolling past a playhead, piano-sheet.js) over
 * glowing notes falling onto a keyboard, as in the piano videos. Your keys are
 * scored note by note. Off until the Piano chip is pressed: nothing is read or
 * opened before that, and the guitar is left alone.
 */
import { api } from './api.js';
import { h, icon, showMenu, toast } from './ui.js';
import { keyboard } from './midi.js';
import { arrange, KeysJudge, KEYS_LEVELS, noteName } from './piano-arrange.js';
import { createSheet } from './piano-sheet.js';

const KEY = 'stagehand.keys';
const WRONG = '#ff5c5c';
/** Seconds of music falling above the keyboard. */
const AHEAD = 3;

export const KEYS_LOOKS = [
  ['both', 'Sheet music and falling notes'],
  ['fall', 'Falling notes only'],
  ['sheet', 'Sheet music only'],
];
/** 4.18 the colours of the notes: one for each hand (right, left), or one for every note across the keys. */
export const KEYS_COLOURS = {
  neon: { name: 'Violet and gold', R: '#ffc83a', L: '#a47bff' },
  stage: { name: 'Green and blue', R: '#8fe36a', L: '#5fb0ff' },
  sunset: { name: 'Pink and orange', R: '#ff9838', L: '#ff5aa5' },
  ice: { name: 'Ice', R: '#7fe9ff', L: '#7a8cff' },
  rainbow: { name: 'Rainbow across the keys', R: '#ffd166', L: '#4fd1c5', rainbow: true },
};
const GLOWS = [
  ['low', 'A little', 0.5],
  ['mid', 'Glowing', 1],
  ['high', 'Lots', 1.7],
];
const BACKDROPS = [
  ['dark', 'Dark, like the piano videos'],
  ['stage', 'The stage behind'],
];
/** How many keys are drawn: a real piano's sizes (lowest and highest key), or just what the song uses. */
export const KEYS_SIZES = [
  ['88', '88 keys (a full piano)', 21, 108],
  ['76', '76 keys', 28, 103],
  ['61', '61 keys', 36, 96],
  ['49', '49 keys', 36, 84],
  ['fit', 'Only the keys this song uses', 0, 0],
];
const DEFAULTS = { on: {}, level: 'medium', hands: 'both', look: 'both', colours: 'neon', glow: 'mid', backdrop: 'dark', size: '88', names: true };
const HANDS = [
  ['both', 'Both hands'],
  ['R', 'Right hand only'],
  ['L', 'Left hand only'],
];

let prefCache = null;
let prefRaw;
function prefs() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (_) {}
  if (prefCache && raw === prefRaw) return prefCache;
  prefRaw = raw;
  try {
    prefCache = { ...DEFAULTS, ...(JSON.parse(raw || '{}') || {}) };
  } catch (_) {
    prefCache = { ...DEFAULTS };
  }
  if (!KEYS_COLOURS[prefCache.colours]) prefCache.colours = DEFAULTS.colours;
  return prefCache;
}
function setPref(k, v) {
  const p = { ...prefs(), [k]: v };
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (_) {
    prefCache = p;
  }
}

/** A colour moved towards white (0 = itself, 1 = white). */
function lighten(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (sh) => Math.round(((n >> sh) & 255) + (255 - ((n >> sh) & 255)) * k);
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
}
function hsl(hh, sat, li) {
  // to #rrggbb, so it can be lightened like the others
  const a = sat * Math.min(li, 1 - li);
  const f = (n) => {
    const k = (n + hh / 30) % 12;
    return Math.round(255 * (li - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
/** Rainbow: teal at the bottom of the piano, through green, gold and orange, to pink at the top. */
const rainbowAt = (midi) => hsl((((172 - ((Math.max(21, Math.min(108, midi)) - 21) / 87) * 210) % 360) + 360) % 360, 0.95, 0.6);
const tintCache = new Map();
/** The colour of a note (its bar, its key, its sparks) and the same colour white-hot. */
function tint(theme, midi, hand) {
  const key = `${theme}|${KEYS_COLOURS[theme].rainbow ? midi : hand}`;
  let c = tintCache.get(key);
  if (!c) {
    const base = KEYS_COLOURS[theme].rainbow ? rainbowAt(midi) : KEYS_COLOURS[theme][hand] || KEYS_COLOURS[theme].R;
    c = { base, top: lighten(base, 0.45), hot: lighten(base, 0.82) };
    tintCache.set(key, c);
  }
  return c;
}

const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

/**
 * root: the highway; stage: the song player; parts(song): loads the song's
 * parts { lead, rhythm, bass, lyrics, beats, length }; onShow(on): the
 * highway steps the neck aside (on) or brings it back.
 */
export function createKeys({ root, stage, parts, onShow, onAsk, notesFromStem }) {
  const chip = h('button.hw-chip.hw-mode.hw-keys-chip', { type: 'button', hidden: true });
  const view = h('div.hw-piano', { hidden: true, 'aria-hidden': 'true' });
  const sheetCv = h('canvas.pk-sheet');
  const fallCv = h('canvas.pk-fall');
  const sheetBox = h('div.pk-sheet-box', null, sheetCv);
  const tape = h('div.pk-tape', { text: 'Piano' });
  const score = h('div.pk-score', { hidden: true });
  const badge = h('div.pk-badge', { hidden: true });
  const keyName = h('div.pk-key');
  sheetBox.append(tape, keyName, score);
  view.append(sheetBox, fallCv, badge);
  root.append(view);
  const g = fallCv.getContext('2d');
  const sheet = createSheet(sheetCv);

  const S = {
    song: null,
    on: false,
    open: false,
    arr: null, // the written piano part (all levels)
    notes: [], // what's being played: this level, these hands
    judge: null,
    loading: false,
    token: 0,
    range: [48, 84],
    lastT: 0,
    vis: 0,
    clockAt: 0, // performance.now() of the last frame, with its song time, for timing key presses
    speed: 1,
    secs: 0,
    at: 0,
    slowest: 1,
    lastResult: null,
    best: undefined,
    sparks: [],
    flare: new Map(), // key → { at, c } a burst where a note was hit
    wrongAt: new Map(), // key → when a wrong key went down
    playing: false,
  };
  const live = () => S.on && S.open;

  function paintChip() {
    chip.hidden = !S.song;
    chip.setAttribute('aria-pressed', String(S.on));
    chip.title = S.on ? 'Piano is on: level, hands, look, piano size, keyboard' : 'Piano: play this song on a keyboard plugged in by USB, from sheet music written from the song';
    // always the same size, so nothing in the top bar jumps; lit, it opens its options
    chip.classList.toggle('has-menu', S.on);
    const html = `${icon('piano')}<span>Piano</span>${icon('chevron')}`;
    if (chip.__html !== html) chip.innerHTML = chip.__html = html;
  }

  /** How the view looks: what shows, the colours, the backdrop. */
  function paintLook() {
    const p = prefs();
    view.dataset.look = p.look;
    view.dataset.backdrop = p.backdrop;
    root.classList.toggle('hw-keys-dark', !view.hidden && p.backdrop === 'dark');
  }
  /** The two hands' colours on the sheet music (Rainbow keeps its two plain ones there). */
  const handColours = () => {
    const c = KEYS_COLOURS[prefs().colours];
    return { R: c.R, L: c.L };
  };

  function paintBadge(text, action = null) {
    badge.textContent = text || '';
    if (text && action) {
      const b = h('button', { type: 'button', text: action.label });
      b.onclick = action.onClick;
      badge.append(' ', b);
    }
    badge.classList.toggle('has-action', !!(text && action));
    badge.hidden = !text;
  }

  /** The part to play: this level, these hands. */
  function pick() {
    if (!S.arr) return;
    const p = prefs();
    const all = S.arr.levels[p.level] || S.arr.levels.medium;
    S.notes = p.hands === 'both' ? all : all.filter((n) => n.hand === p.hands);
    S.judge = new KeysJudge(S.notes);
    S.judge.rewind(stage.engine.position);
    // the keyboard drawn: the notes' range, whole octaves, at least three of them
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of all) {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
    if (lo === Infinity) (lo = 48), (hi = 84);
    S.range = keyRange(lo, hi, p.size);
    sheet.set({ notes: S.notes, grid: S.arr.grid, key: S.arr.key, chords: S.arr.chords, feel: S.arr.feel, words: S.arr.sources.tuneless ? S.arr.words : [] });
    keyName.textContent = `${S.arr.key.name} · ${S.arr.grid.bars[1] ? S.arr.grid.bars[1].beats : 4}/4${S.arr.feel === 'swing' ? ' · swing' : ''}`;
    S.secs = 0;
    S.at = Date.now();
    S.slowest = stage.engine.speed || 1;
    S.sparks = [];
    S.flare.clear();
    paintScore();
  }

  /**
   * The keys drawn. A piano size (88, 76, 61, 49) draws that whole keyboard, so the picture lines up with
   * the piano in front of you (wider if the song goes past it); 'fit' draws only the octaves the song uses.
   */
  function keyRange(lo, hi, size) {
    const sz = KEYS_SIZES.find((x) => x[0] === String(size));
    if (sz && sz[0] !== 'fit') {
      let a = Math.min(sz[2], lo);
      let b = Math.max(sz[3], hi);
      if (isBlack(a)) a--;
      if (isBlack(b)) b++;
      return [Math.max(21, a), Math.min(108, b)];
    }
    lo = Math.max(21, lo - (((lo % 12) + 12) % 12));
    hi = Math.min(108, hi + (11 - (((hi % 12) + 12) % 12)));
    while (hi - lo < 36) (lo = Math.max(21, lo - 12)), hi - lo < 36 && (hi = Math.min(108, hi + 12));
    if (isBlack(lo)) lo--;
    if (isBlack(hi)) hi++;
    return [lo, hi];
  }

  async function prepare() {
    const token = ++S.token;
    const song = S.song;
    S.loading = true;
    S.arr = null;
    paintBadge('Writing the piano part…');
    try {
      const src = await parts(song);
      if (token !== S.token) return;
      // songs without the singer's notes in the chart: read them off the recording when it's been split
      const pitched = (src.lyrics || []).filter((w) => w.p >= 36 && w.p <= 96).length;
      if (src.lyrics && src.lyrics.length && pitched / src.lyrics.length < 0.6 && notesFromStem) {
        const found = await notesFromStem(song, src.lyrics).catch(() => null);
        if (token !== S.token) return;
        if (found) src.lyrics = src.lyrics.map((w, i) => (w.p >= 36 && w.p <= 96 ? w : { ...w, p: found[i] === null || found[i] === undefined ? w.p : Math.round(found[i]) }));
      }
      S.arr = arrange(src);
      S.loading = false;
      pick();
      if (!keyboard.input) paintBadge('Plug your piano in by USB to play along (you can still watch)');
      else if (S.arr.sources.tuneless) {
        // the chart has the words but not the singer's notes: the recording has them, once it's split
        const canSplit = stage.requestStems && !(stage.stems && stage.stems().includes('vocals'));
        paintBadge('This song’s chart has the words but not the singer’s notes, so the verses are chords for now.', canSplit ? { label: 'Split the song to read the tune', onClick: () => (stage.requestStems(), paintBadge('Splitting… the tune shows the next time you open the song')) } : null);
      } else paintBadge('');
    } catch (e) {
      if (token !== S.token) return;
      S.loading = false;
      paintBadge(`Couldn’t write the piano part: ${e.message}`);
    }
  }

  async function begin() {
    if (!live() || !S.song) return;
    view.hidden = false;
    paintLook();
    onShow && onShow(true);
    const ok = await keyboard.start('keys');
    if (!live()) return;
    if (!ok && !S.arr && !S.loading) paintBadge('Plug your piano in by USB to play along (you can still watch)');
    if (!S.arr && !S.loading) await prepare();
    else if (S.arr) paintBadge(ok ? '' : 'Plug your piano in by USB to play along (you can still watch)');
  }

  function end() {
    log(false);
    keyboard.stop('keys');
    view.hidden = true;
    paintLook();
    onShow && onShow(false);
  }

  /** Piano on or off for this song (remembered for the song). */
  function turn(on) {
    if (!S.song) return;
    const map = { ...prefs().on };
    if (on) map[S.song.id] = 1;
    else delete map[S.song.id];
    setPref('on', map);
    const was = S.on;
    S.on = !!on;
    paintChip();
    if (S.on && !was && S.open) begin();
    else if (!S.on && was) end();
    if (S.on) api.app.activity && api.app.activity(`Piano: ${S.song.title}`).catch(() => {});
  }

  /** Writes the run so far to your stats (as the part "keys") and starts a fresh one. */
  function log(full) {
    const j = S.judge;
    if (!j || !S.song) return null;
    j.tick(full ? Infinity : S.lastT);
    const sum = j.summary();
    if (sum.notes >= 8 && S.secs >= 5 && j.hits > 0) {
      S.lastResult = { ...sum, level: prefs().level, hands: prefs().hands, prev: S.best, songId: S.song.id };
      api.stats.log({ songId: S.song.id, part: 'keys', seconds: S.secs, accuracy: sum.acc, notes: sum.notes, hit: sum.hit, speed: S.slowest, at: S.at, bestStreak: sum.bestStreak, ...(full ? { full: true } : {}) }).catch(() => {});
      if (S.slowest >= 0.999 && sum.notes >= 20) S.best = Math.max(S.best || 0, sum.acc);
    }
    S.secs = 0;
    S.at = Date.now();
    return sum;
  }

  function paintScore() {
    const j = S.judge;
    const txt = j && j.judged ? `${Math.round(j.accuracy * 100)}%${j.streak >= 4 ? ` ×${j.streak}` : ''}` : '';
    if (score.textContent !== txt) {
      score.textContent = txt;
      score.hidden = !txt;
    }
  }

  // ------------------------------------------------------- your keys --
  keyboard.addEventListener('note', (e) => {
    if (!live() || !S.judge) return;
    // when the key went down, in song time (on the clock the notes are drawn by)
    const t = S.vis - ((performance.now() - e.at) / 1000) * S.speed;
    if (e.on) {
      const i = S.judge.press(t, e.midi);
      if (i >= 0) {
        const c = tint(prefs().colours, e.midi, S.notes[i].hand);
        S.flare.set(e.midi, { at: performance.now(), c });
        burst(e.midi, c);
      } else S.wrongAt.set(e.midi, performance.now());
      if (S.lastResult) S.lastResult = null;
    } else S.judge.release(t, e.midi);
    paintScore();
  });
  keyboard.addEventListener('change', () => {
    if (!live()) return;
    if (keyboard.input && /Plug your piano/.test(badge.textContent)) paintBadge('');
  });

  chip.onclick = () => {
    if (!S.on) return onAsk ? onAsk() : turn(true);
    const r = chip.getBoundingClientRect();
    const check = (f) => () => (f() ? '✓' : '');
    const P = (k, v) => check(() => String(prefs()[k]) === String(v));
    // the menu opens at once; the keyboards are read when their side menu opens
    let list = [];
    keyboard.devices().then((l) => (list = l)).catch(() => {});
    const vocals = stage.stems && stage.stems().includes('vocals') ? stage.engine.tracks[stage.trackIndex('vocals')] : null;
    const repick = (k, v) => () => {
      if (String(prefs()[k]) === String(v)) return;
      log(false);
      setPref(k, v);
      pick();
    };
    const look = (k, v) => () => (setPref(k, v), paintLook());
    showMenu(r.left, r.bottom + 6, [
      { heading: true, label: 'How much to play' },
      ...Object.entries(KEYS_LEVELS).map(([id, l]) => ({ label: l.name, hint: P('level', id), title: l.hint, keep: true, onClick: repick('level', id) })),
      '-',
      { label: 'Hands', submenu: HANDS.map(([id, label]) => ({ label, hint: P('hands', id), keep: true, onClick: repick('hands', id) })) },
      { label: 'Show', submenu: KEYS_LOOKS.map(([id, label]) => ({ label, hint: P('look', id), keep: true, onClick: look('look', id) })) },
      {
        label: 'Look',
        submenu: [
          { heading: true, label: 'Colours' },
          ...Object.entries(KEYS_COLOURS).map(([id, c]) => ({ label: c.name, hint: P('colours', id), keep: true, onClick: look('colours', id) })),
          '-',
          { heading: true, label: 'Glow' },
          ...GLOWS.map(([id, label]) => ({ label, hint: P('glow', id), keep: true, onClick: look('glow', id) })),
          '-',
          { heading: true, label: 'Behind the notes' },
          ...BACKDROPS.map(([id, label]) => ({ label, hint: P('backdrop', id), keep: true, onClick: look('backdrop', id) })),
          '-',
          { label: 'Note names on the notes', hint: check(() => prefs().names !== false), keep: true, onClick: () => setPref('names', prefs().names === false) },
        ],
      },
      { label: 'Piano size', submenu: KEYS_SIZES.map(([id, label]) => ({ label, hint: P('size', id), keep: true, onClick: () => (setPref('size', id), S.arr && rerange()) })) },
      vocals ? { label: 'Take the singer out of the song', hint: check(() => vocals.muted), keep: true, onClick: () => stage.setStem('vocals', { muted: !vocals.muted }) } : null,
      {
        label: 'Keyboard',
        submenu: () => (list.length ? list.map((d) => ({ label: d.label, hint: check(() => keyboard.input && keyboard.input.id === d.id), keep: true, onClick: () => keyboard.setDevice(d.id, d.label) })) : [{ label: 'No keyboard plugged in', disabled: true }]),
      },
      '-',
      { label: 'Stop playing piano', icon: 'x', onClick: () => turn(false) },
    ]);
  };
  /** The piano size changed: the same part, the same score, a different keyboard drawn. */
  function rerange() {
    const all = S.arr.levels[prefs().level] || S.arr.levels.medium;
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of all) (lo = Math.min(lo, n.midi)), (hi = Math.max(hi, n.midi));
    if (lo === Infinity) (lo = 48), (hi = 84);
    S.range = keyRange(lo, hi, prefs().size);
    S.sparks = [];
  }

  // ----------------------------------------------------------- drawing --
  /** Sparks thrown up where a note you hit lands (placed on its key the next time the keys are drawn). */
  function burst(midi, c) {
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.7;
      const v = 120 + Math.random() * 280;
      S.sparks.push({ midi, x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.5, age: 0, c, size: 1 + Math.random() * 2.2, g: 520 });
    }
    if (S.sparks.length > 500) S.sparks.splice(0, S.sparks.length - 500);
  }

  /** The keyboard's layout across width W: x and width of each key. */
  let laid = null;
  function layout(W) {
    const [lo, hi] = S.range;
    if (laid && laid.W === W && laid.lo === lo && laid.hi === hi) return laid;
    let whites = 0;
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites++;
    const ww = W / whites;
    const pos = new Map();
    let wi = 0;
    for (let m = lo; m <= hi; m++) {
      if (!isBlack(m)) {
        pos.set(m, { x: wi * ww, w: ww, black: false });
        wi++;
      } else pos.set(m, { x: wi * ww - ww * 0.31, w: ww * 0.62, black: true });
    }
    laid = { pos, ww, W, lo, hi };
    return laid;
  }

  function roundRect(x, y, w, hh, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, hh, Math.max(0, Math.min(r, w / 2, hh / 2)));
    else g.rect(x, y, w, hh);
  }

  function drawFall(t, dtReal) {
    const W = fallCv.clientWidth;
    const Hh = fallCv.clientHeight;
    if (!W || !Hh) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (fallCv.width !== Math.round(W * dpr) || fallCv.height !== Math.round(Hh * dpr)) {
      fallCv.width = Math.round(W * dpr);
      fallCv.height = Math.round(Hh * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, Hh);
    const P = prefs();
    const theme = P.colours;
    const glow = (GLOWS.find((x) => x[0] === P.glow) || GLOWS[1])[2];
    const dark = P.backdrop === 'dark';
    const { pos, ww } = layout(W);
    const kh = Math.round(Math.min(Hh * 0.3, Math.max(64, ww * 5.4)));
    const line = Hh - kh;
    const pps = line / AHEAD;
    const Y = (time) => line - (time - t) * pps;
    const now = performance.now();

    // the floor the notes fall through: a line at each C (fainter at each F), bar lines across
    if (!dark) {
      const bg = g.createLinearGradient(0, 0, 0, line);
      bg.addColorStop(0, 'rgba(8, 9, 14, 0.0)');
      bg.addColorStop(1, 'rgba(8, 9, 14, 0.55)');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, line);
    }
    for (const [m, p] of pos) {
      if (p.black) continue;
      if (m % 12 === 0 || m % 12 === 5) {
        g.fillStyle = m % 12 === 0 ? 'rgba(255, 255, 255, 0.085)' : 'rgba(255, 255, 255, 0.035)';
        g.fillRect(Math.round(p.x), 0, 1, line);
      }
    }
    if (S.arr) {
      const G = S.arr.grid;
      for (const b of G.bars) {
        const y = Y(G.timeOf(b.k0));
        if (y < -2) break;
        if (y > line) continue;
        g.fillStyle = 'rgba(255, 255, 255, 0.06)';
        g.fillRect(0, Math.round(y), W, 1);
      }
    }

    // the notes: long glowing bars. First every halo (wide and soft), then every bar on top.
    const j = S.judge;
    const notes = S.notes;
    const sounding = new Map(); // key → its colour, for notes that should be down now
    const from = j ? Math.max(0, j.next - 40) : 0;
    g.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) g.globalCompositeOperation = 'source-over';
      for (let i = from; i < notes.length; i++) {
        const n = notes[i];
        if (n.t > t + AHEAD + 0.1) break;
        if (n.t + n.d < t - 0.3) continue;
        const p = pos.get(n.midi);
        if (!p) continue;
        const res = j ? j.result[i] : null;
        const y0 = Y(n.t + n.d);
        const y1 = Math.min(line, Y(n.t));
        if (y1 <= y0) continue;
        const on = t >= n.t && t < n.t + n.d;
        const c = tint(theme, n.midi, n.hand);
        if (on && pass === 1) sounding.set(n.midi, c);
        const pad = p.black ? 0.5 : Math.max(1.5, p.w * 0.1);
        const x = p.x + pad;
        const w = p.w - pad * 2;
        const rad = Math.min(7, w / 2);
        const miss = res === 'miss';
        const dim = n.role === 'chord' ? 0.78 : 1;
        if (pass === 0) {
          if (miss) continue;
          // the halo, in four soft layers (a blur would cost far more)
          const k = glow * dim * (on || res === 'hit' ? 1.8 : 1);
          g.fillStyle = c.base;
          const halo = (grow, a) => {
            g.globalAlpha = Math.min(1, a * k);
            roundRect(x - grow, y0 - grow, w + grow * 2, y1 - y0 + grow * 2, rad + grow);
            g.fill();
          };
          halo(22, 0.028);
          halo(13, 0.055);
          halo(7, 0.1);
          halo(3, 0.2);
          continue;
        }
        // the bar: light at the top, its full colour where it lands, a bright rim, a gloss down one side
        g.globalAlpha = miss ? 0.3 : dim;
        const grd = g.createLinearGradient(0, y0, 0, y1);
        if (miss) (grd.addColorStop(0, '#6c6a78'), grd.addColorStop(1, '#6c6a78'));
        else (grd.addColorStop(0, c.top), grd.addColorStop(Math.min(0.9, 60 / Math.max(61, y1 - y0)), c.base), grd.addColorStop(1, on ? c.hot : c.base));
        g.fillStyle = grd;
        roundRect(x, y0, w, y1 - y0, rad);
        g.fill();
        if (!miss) {
          g.globalAlpha = 0.85 * dim;
          g.lineWidth = 1.25;
          g.strokeStyle = c.hot;
          roundRect(x + 0.6, y0 + 0.6, w - 1.2, y1 - y0 - 1.2, rad);
          g.stroke();
          if (w > 7 && y1 - y0 > 10) {
            g.globalAlpha = 0.28 * dim;
            g.fillStyle = '#ffffff';
            roundRect(x + w * 0.16, y0 + 4, Math.max(1.5, w * 0.2), y1 - y0 - 8, 2);
            g.fill();
          }
        }
        // held right: the part you've held burns white-hot
        if (j && res === 'hit' && j.heldTo[i] > n.t) {
          const yh = Math.max(y0, Y(Math.min(j.heldTo[i], n.t + n.d)));
          g.globalAlpha = 0.6;
          g.fillStyle = c.hot;
          roundRect(x, yh, w, Math.max(0, y1 - yh), rad);
          g.fill();
        }
        // the note's name on long enough bars
        if (P.names !== false && y1 - y0 > 26 && w >= 13) {
          g.globalAlpha = 0.9;
          g.fillStyle = '#0b0d12';
          g.font = `800 ${Math.max(9, Math.min(13, w * 0.5))}px 'Archivo', 'Segoe UI', sans-serif`;
          g.textAlign = 'center';
          g.fillText(noteName(n.midi, S.arr ? S.arr.key.fifths : 0), x + w / 2, y1 - 7);
          g.textAlign = 'left';
        }
      }
    }
    g.globalAlpha = 1;

    // where a note is landing: a beam of light up its lane, a white-hot spot on the line, sparks drifting up
    g.globalCompositeOperation = 'lighter';
    for (const [m, c] of sounding) {
      const p = pos.get(m);
      const cx = p.x + p.w / 2;
      const beam = g.createLinearGradient(0, line, 0, line - line * 0.55);
      beam.addColorStop(0, c.base);
      beam.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = Math.min(0.5, 0.16 * glow);
      g.fillStyle = beam;
      g.fillRect(p.x - 1, line - line * 0.55, p.w + 2, line * 0.55);
      const r = Math.max(18, ww * 1.5) * (0.8 + 0.4 * glow);
      const spot = g.createRadialGradient(cx, line, 0, cx, line, r);
      spot.addColorStop(0, '#ffffff');
      spot.addColorStop(0.25, c.top);
      spot.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = Math.min(1, 0.75 * glow);
      g.fillStyle = spot;
      g.fillRect(cx - r, line - r, r * 2, r);
      if (S.playing && S.sparks.length < 500 && Math.random() < 0.5 * glow) {
        S.sparks.push({ x: cx + (Math.random() - 0.5) * p.w, y: line - 2, vx: (Math.random() - 0.5) * 46, vy: -(40 + Math.random() * 130), life: 0.5 + Math.random() * 0.8, age: 0.001, c, size: 1 + Math.random() * 1.8, g: -20 });
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // the line the notes land on: a thin line of light (every colour of the keys under Rainbow)
    let edge = '#ffe9b0';
    if (KEYS_COLOURS[theme].rainbow) {
      edge = g.createLinearGradient(0, 0, W, 0);
      const [lo, hi] = S.range;
      for (let i = 0; i <= 8; i++) edge.addColorStop(i / 8, rainbowAt(lo + ((hi - lo) * i) / 8));
    }
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = edge;
    g.globalAlpha = Math.min(0.5, 0.1 * glow);
    g.fillRect(0, line - 7, W, 9);
    g.globalAlpha = Math.min(0.7, 0.22 * glow);
    g.fillRect(0, line - 3, W, 5);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.95;
    g.fillRect(0, line - 1, W, 2);
    g.globalAlpha = 1;

    // the keys
    const held = keyboard.held;
    const keyCol = (m) => {
      if (!held.has(m)) return null;
      const f = S.flare.get(m);
      const c = (f && f.c) || sounding.get(m);
      return c ? c.base : WRONG;
    };
    const drawKey = (m, p) => {
      const top = line + 1;
      const kH = p.black ? kh * 0.62 : kh - 1;
      const hot = keyCol(m);
      const want = sounding.get(m);
      const lit = hot || (want && want.base);
      if (!p.black) {
        const kg = g.createLinearGradient(0, top, 0, top + kH);
        kg.addColorStop(0, '#fbf9f4');
        kg.addColorStop(0.86, '#e9e5dc');
        kg.addColorStop(1, '#c9c4b8');
        g.fillStyle = kg;
        roundRect(p.x + 0.5, top, p.w - 1, kH, 3);
        g.fill();
        if (lit) {
          const lg = g.createLinearGradient(0, top, 0, top + kH);
          lg.addColorStop(0, hot ? hot : lighten(lit, 0.25));
          lg.addColorStop(1, hot ? lighten(hot, 0.35) : lighten(lit, 0.55));
          g.globalAlpha = hot ? 1 : 0.8;
          g.fillStyle = lg;
          roundRect(p.x + 0.5, top, p.w - 1, kH, 3);
          g.fill();
          g.globalAlpha = 1;
        }
        if (m % 12 === 0 && p.w >= 13) {
          g.fillStyle = 'rgba(40, 34, 28, 0.5)';
          g.font = `700 ${Math.max(8, Math.min(12, p.w * 0.42))}px 'Archivo', 'Segoe UI', sans-serif`;
          g.textAlign = 'center';
          g.fillText(`C${Math.floor(m / 12) - 1}`, p.x + p.w / 2, top + kH - 6);
          g.textAlign = 'left';
        }
      } else {
        const kg = g.createLinearGradient(0, top, 0, top + kH);
        kg.addColorStop(0, '#1c1b1f');
        kg.addColorStop(0.85, '#0a0a0c');
        kg.addColorStop(1, '#26252b');
        g.fillStyle = kg;
        roundRect(p.x, top - 1, p.w, kH, 2.5);
        g.fill();
        if (lit) {
          g.globalAlpha = hot ? 1 : 0.85;
          g.fillStyle = hot || lit;
          roundRect(p.x + 1, top - 1, p.w - 2, kH - 2, 2);
          g.fill();
          g.globalAlpha = 1;
        }
      }
    };
    g.fillStyle = '#060608';
    g.fillRect(0, line, W, kh);
    for (const [m, p] of pos) if (!p.black) drawKey(m, p);
    for (const [m, p] of pos) if (p.black) drawKey(m, p);
    // a soft shadow under the line, so the keys sit below it
    const sh = g.createLinearGradient(0, line + 1, 0, line + 9);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.fillRect(0, line + 1, W, 8);

    // light rising off the keys you're holding, sparks, a flash up the lane of a note just hit
    g.globalCompositeOperation = 'lighter';
    for (const m of held.keys()) {
      const p = pos.get(m);
      if (!p) continue;
      const col = keyCol(m);
      const r = ww * 2.4;
      const rg = g.createRadialGradient(p.x + p.w / 2, line, 0, p.x + p.w / 2, line, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = Math.min(0.9, 0.5 * glow);
      g.fillStyle = rg;
      g.fillRect(p.x + p.w / 2 - r, line - r, r * 2, r);
    }
    for (const sp of S.sparks) {
      if (!sp.age) {
        const p = pos.get(sp.midi);
        if (!p) {
          sp.age = 9;
          continue;
        }
        sp.x = p.x + p.w / 2 + (Math.random() - 0.5) * p.w;
        sp.y = line - 2;
      }
      sp.age += dtReal;
      sp.x += sp.vx * dtReal;
      sp.y += sp.vy * dtReal;
      sp.vy += sp.g * dtReal;
      const a = Math.max(0, 1 - sp.age / sp.life);
      g.globalAlpha = a;
      g.fillStyle = sp.age < 0.08 ? '#ffffff' : sp.c.hot;
      g.beginPath();
      g.arc(sp.x, sp.y, sp.size * 0.7, 0, 6.3);
      g.fill();
      g.globalAlpha = a * 0.25;
      g.fillStyle = sp.c.base;
      g.beginPath();
      g.arc(sp.x, sp.y, sp.size * 2.4, 0, 6.3);
      g.fill();
    }
    S.sparks = S.sparks.filter((sp) => sp.age < sp.life);
    for (const [m, f] of S.flare) {
      const age = (now - f.at) / 1000;
      if (age > 0.35 && !held.has(m)) {
        S.flare.delete(m);
        continue;
      }
      const p = pos.get(m);
      if (!p) continue;
      const a = Math.max(0, 0.5 - age);
      if (a <= 0) continue;
      const fg = g.createLinearGradient(0, line, 0, line - ww * 7);
      fg.addColorStop(0, f.c.base);
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = a;
      g.fillStyle = fg;
      g.fillRect(p.x, line - ww * 7, p.w, ww * 7);
    }
    for (const [m, at] of S.wrongAt) if (now - at > 300 && !held.has(m)) S.wrongAt.delete(m);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  return {
    chip,
    /** Piano is on and showing: the neck steps aside and the guitar isn't scored. */
    get active() {
      return live();
    },
    setSong(song) {
      if (S.song && song && S.song.id === song.id) return;
      if (live()) end();
      S.song = song || null;
      S.arr = null;
      S.judge = null;
      S.notes = [];
      S.lastResult = null;
      S.best = undefined;
      S.token++;
      S.loading = false;
      S.on = !!(song && prefs().on[song.id]);
      paintChip();
      if (live()) begin();
    },
    setBest(v) {
      S.best = v;
    },
    setOpen(open) {
      if (S.open === open) return;
      S.open = open;
      if (open && S.on) begin();
      else if (!open && S.on) end();
    },
    /** Every frame while the highway shows: t the song clock, vis the picture's clock. */
    frame(t, vis, playing, speed = 1) {
      if (!live()) return;
      const now = performance.now();
      const dtReal = Math.min(0.1, (now - (S.clockAt || now)) / 1000);
      S.clockAt = now;
      S.vis = vis;
      S.speed = speed;
      const j = S.judge;
      if (j) {
        if (vis < S.lastT - 0.05 || vis - S.lastT > 0.5) j.rewind(vis);
        j.setPace(speed);
        if (playing) {
          j.tick(vis);
          S.secs += Math.max(0, Math.min(0.25, vis - S.lastT));
          S.slowest = Math.min(S.slowest, speed);
        }
        j.events.length = 0;
      }
      S.lastT = vis;
      S.playing = playing;
      const look = view.dataset.look;
      if (look !== 'sheet') drawFall(vis, dtReal);
      if (look !== 'fall') sheet.draw(vis, { W: sheetBox.clientWidth, H: sheetBox.clientHeight, colors: handColours(), state: (i) => (j ? j.result[i] : null) });
      if (playing) paintScore();
    },
    ended() {
      if (!live()) return null;
      log(true);
      return S.lastResult;
    },
    result() {
      return S.lastResult;
    },
    turn,
    state: S, // tests
  };
}
