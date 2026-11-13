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
/** The hands' colours: the piano's own green (right) and a cool blue (left). */
const HAND = { R: '#8fe36a', L: '#5fb0ff' };
const HAND_HOT = { R: '#e4ffd2', L: '#dcefff' };
const WRONG = '#ff8a5c';
/** Seconds of music falling above the keyboard. */
const AHEAD = 3;

export const KEYS_LOOKS = [
  ['both', 'Sheet music and falling notes'],
  ['fall', 'Falling notes only'],
  ['sheet', 'Sheet music only'],
];
const HANDS = [
  ['both', 'Both hands'],
  ['R', 'Right hand only'],
  ['L', 'Left hand only'],
];

function prefs() {
  try {
    return { on: {}, level: 'medium', hands: 'both', look: 'both', ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) };
  } catch (_) {
    return { on: {}, level: 'medium', hands: 'both', look: 'both' };
  }
}
function setPref(k, v) {
  const p = prefs();
  p[k] = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (_) {}
}

const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

/**
 * root: the highway; stage: the song player; parts(song): loads the song's
 * parts { lead, rhythm, bass, lyrics, beats, length }; onShow(on): the
 * highway steps the neck aside (on) or brings it back.
 */
export function createKeys({ root, stage, parts, onShow, notesFromStem }) {
  const chip = h('button.hw-chip.hw-keys-chip', { type: 'button', hidden: true });
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
    flare: new Map(), // key → { t, hand } a burst where a note was hit
    wrongAt: new Map(), // key → when a wrong key went down
    playing: false,
  };
  const live = () => S.on && S.open;

  function paintChip() {
    chip.hidden = !S.song;
    chip.setAttribute('aria-pressed', String(S.on));
    chip.title = S.on ? 'Piano is on: level, hands, look, keyboard' : 'Piano: play this song on a keyboard plugged in by USB, from sheet music written from the song';
    chip.innerHTML = `${icon('piano')}<span>${S.on ? `Piano · ${KEYS_LEVELS[prefs().level].name}` : 'Piano'}</span>${S.on ? icon('chevron') : ''}`;
  }

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
    lo = Math.max(21, lo - (((lo % 12) + 12) % 12) - 0);
    hi = Math.min(108, hi + (11 - (((hi % 12) + 12) % 12)));
    while (hi - lo < 36) (lo = Math.max(21, lo - 12)), hi - lo < 36 && (hi = Math.min(108, hi + 12));
    S.range = [lo, hi];
    sheet.set({ notes: S.notes, grid: S.arr.grid, key: S.arr.key, chords: S.arr.chords, feel: S.arr.feel, words: S.arr.sources.tuneless ? S.arr.words : [] });
    keyName.textContent = `${S.arr.key.name} · ${S.arr.grid.bars[1] ? S.arr.grid.bars[1].beats : 4}/4${S.arr.feel === 'swing' ? ' · swing' : ''}`;
    S.secs = 0;
    S.at = Date.now();
    S.slowest = stage.engine.speed || 1;
    S.sparks = [];
    S.flare.clear();
    paintScore();
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
    view.dataset.look = prefs().look;
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
        const n = S.notes[i];
        S.flare.set(e.midi, { at: performance.now(), hand: n.hand });
        burst(e.midi, n.hand);
      } else S.wrongAt.set(e.midi, performance.now());
      if (S.lastResult) S.lastResult = null;
    } else S.judge.release(t, e.midi);
    paintScore();
  });
  keyboard.addEventListener('change', () => {
    if (!live()) return;
    if (keyboard.input && /Plug your piano/.test(badge.textContent)) paintBadge('');
  });

  chip.onclick = async () => {
    if (!S.on) return turn(true);
    const r = chip.getBoundingClientRect();
    const p = prefs();
    const check = (v) => (v ? '✓' : '');
    const list = await keyboard.devices().catch(() => []);
    const vocals = stage.stems && stage.stems().includes('vocals') ? stage.engine.tracks[stage.trackIndex('vocals')] : null;
    showMenu(r.left, r.bottom + 6, [
      { heading: true, label: 'How much to play' },
      ...Object.entries(KEYS_LEVELS).map(([id, l]) => ({
        label: l.name,
        hint: check(p.level === id),
        title: l.hint,
        onClick: () => {
          log(false);
          setPref('level', id);
          pick();
          paintChip();
        },
      })),
      '-',
      {
        label: 'Hands',
        submenu: HANDS.map(([id, label]) => ({
          label,
          hint: check(p.hands === id),
          onClick: () => {
            log(false);
            setPref('hands', id);
            pick();
          },
        })),
      },
      { label: 'Look', submenu: KEYS_LOOKS.map(([id, label]) => ({ label, hint: check(p.look === id), onClick: () => (setPref('look', id), (view.dataset.look = id)) })) },
      vocals ? { label: 'Take the singer out of the song', hint: check(vocals.muted), onClick: () => stage.setStem('vocals', { muted: !vocals.muted }) } : null,
      {
        label: 'Keyboard',
        submenu: list.length ? list.map((d) => ({ label: d.label, hint: check(keyboard.input && keyboard.input.id === d.id), onClick: () => keyboard.setDevice(d.id, d.label) })) : [{ label: 'No keyboard plugged in', disabled: true }],
      },
      '-',
      { label: 'Stop playing piano', icon: 'x', onClick: () => turn(false) },
    ]);
  };

  // ----------------------------------------------------------- drawing --
  function burst(midi, hand) {
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const v = 120 + Math.random() * 260;
      S.sparks.push({ midi, x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.45, age: 0, hand, size: 1 + Math.random() * 2 });
    }
    if (S.sparks.length > 400) S.sparks.splice(0, S.sparks.length - 400);
  }

  /** The keyboard's layout across width W: x and width of each key. */
  function layout(W) {
    const [lo, hi] = S.range;
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
    return { pos, ww };
  }

  function roundRect(x, y, w, hh, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, hh, Math.min(r, w / 2, hh / 2));
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
    const { pos, ww } = layout(W);
    const kh = Math.round(Math.min(Hh * 0.3, Math.max(70, ww * 5.4)));
    const line = Hh - kh;
    const pps = line / AHEAD;
    const Y = (time) => line - (time - t) * pps;
    const now = performance.now();

    // the floor the notes fall through: darker lanes for the black keys, a line at each C, bar lines across
    const bg = g.createLinearGradient(0, 0, 0, line);
    bg.addColorStop(0, 'rgba(8, 9, 14, 0.0)');
    bg.addColorStop(1, 'rgba(8, 9, 14, 0.55)');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, line);
    for (const [m, p] of pos) {
      if (p.black) {
        g.fillStyle = 'rgba(0, 0, 0, 0.22)';
        g.fillRect(p.x, 0, p.w, line);
      } else if (m % 12 === 0 || m % 12 === 5) {
        g.fillStyle = m % 12 === 0 ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.04)';
        g.fillRect(Math.round(p.x), 0, 1, line);
      }
    }
    if (S.arr) {
      const G = S.arr.grid;
      for (const b of G.bars) {
        const y = Y(G.timeOf(b.k0));
        if (y < -2) break;
        if (y > line) continue;
        g.fillStyle = 'rgba(255, 255, 255, 0.07)';
        g.fillRect(0, Math.round(y), W, 1);
      }
    }

    // the notes: long glowing bars, the tune brightest
    const j = S.judge;
    const notes = S.notes;
    const sounding = new Map(); // key → hand, notes that should be down now
    g.globalCompositeOperation = 'lighter';
    // first the glow (wide and faint), then the bars
    for (let pass = 0; pass < 2; pass++) {
      for (let i = j ? Math.max(0, j.next - 40) : 0; i < notes.length; i++) {
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
        if (on && pass === 1) sounding.set(n.midi, n.hand);
        const pad = p.black ? 1 : Math.max(1.5, p.w * 0.08);
        const x = p.x + pad;
        const w = p.w - pad * 2;
        const col = res === 'miss' ? '#7c7a86' : HAND[n.hand];
        const dim = n.role === 'chord' ? 0.72 : 1;
        if (pass === 0) {
          if (res === 'miss') continue;
          // a soft halo in three layers (cheap stand-in for a blur)
          const boost = on || res === 'hit' ? 1.7 : 1;
          g.fillStyle = col;
          g.globalAlpha = 0.06 * dim * boost;
          roundRect(x - 14, y0 - 14, w + 28, y1 - y0 + 28, 16);
          g.fill();
          g.globalAlpha = 0.11 * dim * boost;
          roundRect(x - 7, y0 - 7, w + 14, y1 - y0 + 14, 10);
          g.fill();
          g.globalAlpha = 0.2 * dim * boost;
          roundRect(x - 3, y0 - 3, w + 6, y1 - y0 + 6, 7);
          g.fill();
          continue;
        }
        // the bar: a gradient tube, lighter at its leading edge, a bright core down the middle
        g.globalAlpha = (res === 'miss' ? 0.35 : 0.92) * dim;
        const grd = g.createLinearGradient(0, y0, 0, y1);
        grd.addColorStop(0, col);
        grd.addColorStop(1, res === 'miss' ? col : HAND_HOT[n.hand]);
        g.fillStyle = grd;
        roundRect(x, y0, w, y1 - y0, Math.min(6, w / 2));
        g.fill();
        if (res !== 'miss') {
          g.globalAlpha = 0.5 * dim;
          g.fillStyle = '#ffffff';
          g.fillRect(x + w * 0.38, y0 + 3, Math.max(1, w * 0.24), Math.max(0, y1 - y0 - 6));
        }
        // held right: the part you've held burns white
        if (j && res === 'hit' && j.heldTo[i] > n.t) {
          const yh = Y(Math.min(j.heldTo[i], n.t + n.d));
          g.globalAlpha = 0.55;
          g.fillStyle = HAND_HOT[n.hand];
          roundRect(x, Math.max(y0, yh), w, Math.max(0, y1 - Math.max(y0, yh)), Math.min(6, w / 2));
          g.fill();
        }
        // the note's name on long enough bars
        if (y1 - y0 > 26 && w >= 13) {
          g.globalCompositeOperation = 'source-over';
          g.globalAlpha = 0.85;
          g.fillStyle = '#0b1210';
          g.font = `800 ${Math.max(9, Math.min(13, w * 0.5))}px 'Archivo', 'Segoe UI', sans-serif`;
          g.textAlign = 'center';
          g.fillText(noteName(n.midi, S.arr ? S.arr.key.fifths : 0), x + w / 2, y1 - 6);
          g.textAlign = 'left';
          g.globalCompositeOperation = 'lighter';
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // the line the notes land on: a band of light
    const lg = g.createLinearGradient(0, line - 18, 0, line + 2);
    lg.addColorStop(0, 'rgba(241, 206, 104, 0)');
    lg.addColorStop(1, 'rgba(241, 206, 104, 0.28)');
    g.fillStyle = lg;
    g.fillRect(0, line - 18, W, 20);
    g.fillStyle = 'rgba(255, 226, 150, 0.9)';
    g.fillRect(0, line - 1, W, 2);

    // the keys
    const held = keyboard.held;
    const keyCol = (m) => {
      const f = S.flare.get(m);
      if (held.has(m)) {
        const hand = (f && f.hand) || sounding.get(m);
        if (hand && (f || sounding.has(m))) return HAND[hand];
        return WRONG;
      }
      return null;
    };
    const drawKey = (m, p) => {
      const top = line + 1;
      const kH = p.black ? kh * 0.62 : kh - 1;
      const hot = keyCol(m);
      const want = sounding.get(m);
      if (!p.black) {
        const kg = g.createLinearGradient(0, top, 0, top + kH);
        kg.addColorStop(0, hot ? hot : want ? '#e9f3e4' : '#f3efe6');
        kg.addColorStop(1, hot ? hot : '#d9d3c6');
        g.fillStyle = kg;
        g.fillRect(p.x + 0.5, top, p.w - 1, kH);
        if (want && !hot) {
          g.fillStyle = HAND[want];
          g.globalAlpha = 0.35;
          g.fillRect(p.x + 0.5, top, p.w - 1, kH);
          g.globalAlpha = 1;
        }
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(p.x + p.w - 1, top, 1, kH);
        if (m % 12 === 0) {
          g.fillStyle = 'rgba(40, 34, 28, 0.55)';
          g.font = `700 ${Math.max(8, Math.min(12, p.w * 0.42))}px 'Archivo', 'Segoe UI', sans-serif`;
          g.textAlign = 'center';
          g.fillText(`C${Math.floor(m / 12) - 1}`, p.x + p.w / 2, top + kH - 6);
          g.textAlign = 'left';
        }
      } else {
        const kg = g.createLinearGradient(0, top, 0, top + kH);
        kg.addColorStop(0, hot || '#2a2622');
        kg.addColorStop(1, hot || '#0d0b0a');
        g.fillStyle = kg;
        roundRect(p.x, top - 1, p.w, kH, 2);
        g.fill();
        if (want && !hot) {
          g.fillStyle = HAND[want];
          g.globalAlpha = 0.45;
          roundRect(p.x, top - 1, p.w, kH, 2);
          g.fill();
          g.globalAlpha = 1;
        }
      }
      if (hot) {
        // a burst of light rising off a pressed key
        const rg = g.createRadialGradient(p.x + p.w / 2, line, 0, p.x + p.w / 2, line, ww * 2.6);
        rg.addColorStop(0, hot);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.55;
        g.fillStyle = rg;
        g.fillRect(p.x + p.w / 2 - ww * 2.6, line - ww * 2.6, ww * 5.2, ww * 2.6);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    };
    g.fillStyle = '#0b0a09';
    g.fillRect(0, line, W, kh);
    for (const [m, p] of pos) if (!p.black) drawKey(m, p);
    for (const [m, p] of pos) if (p.black) drawKey(m, p);
    // a felt strip along the top of the keys
    g.fillStyle = '#5a1d1d';
    g.fillRect(0, line, W, 3);

    // sparks off notes you hit
    g.globalCompositeOperation = 'lighter';
    for (const sp of S.sparks) {
      const p = pos.get(sp.midi);
      if (!p) continue;
      if (!sp.age) (sp.x = p.x + p.w / 2 + (Math.random() - 0.5) * p.w), (sp.y = line - 2);
      sp.age += dtReal;
      sp.x += sp.vx * dtReal;
      sp.y += sp.vy * dtReal;
      sp.vy += 520 * dtReal;
      const a = Math.max(0, 1 - sp.age / sp.life);
      g.globalAlpha = a;
      g.fillStyle = sp.age < 0.08 ? '#ffffff' : HAND_HOT[sp.hand];
      g.fillRect(sp.x, sp.y, sp.size, sp.size);
    }
    S.sparks = S.sparks.filter((sp) => sp.age < sp.life);
    // a flash up the lane of a note just hit
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
      fg.addColorStop(0, HAND[f.hand]);
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
      const look = view.dataset.look;
      if (look !== 'sheet') drawFall(vis, dtReal);
      if (look !== 'fall') sheet.draw(vis, { W: sheetBox.clientWidth, H: sheetBox.clientHeight, colors: HAND, state: (i) => (j ? j.result[i] : null) });
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
