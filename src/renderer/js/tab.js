/**
 * Tab view: the song's guitar or bass part as tablature that plays along with
 * the music, with play-along (your instrument's stem muted), practice speed,
 * lyrics, and your own guitar through the rig.
 */
import { api } from './api.js';
import { h, icon, esc, showMenu, toast } from './ui.js';
import { rig, TONES, TUNINGS, openStrings, noteName } from './rig.js';
import { describe } from './gearspec.js';

const STRING_COLORS = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];
const GUITAR_NAMES = ['E', 'A', 'D', 'G', 'B', 'E'];
const BASS_NAMES = ['E', 'A', 'D', 'G'];
const SPEEDS = [0.5, 0.6, 0.75, 0.85, 1];
const C = {
  bg: '#141a29',
  staff: 'rgba(163, 170, 194, 0.32)',
  beat: 'rgba(163, 170, 194, 0.09)',
  bar: 'rgba(163, 170, 194, 0.3)',
  barNum: '#6e7693',
  ink: '#eceef6',
  ink2: '#a3aac2',
  ink3: '#6e7693',
  tungsten: '#ffb547',
  tungstenHi: '#ffc978',
  noteBg: '#131826',
};
const FONT = "'Archivo', 'Segoe UI', sans-serif";

function load(key, fallback) {
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(key) || 'null') || {}) };
  } catch (_) {
    return { ...fallback };
  }
}

const prefs = load('stagehand.tab', { lowTop: true, layout: 'scroll', lyrics: true, zoom: 1, speed: 1, part: 'lead', playAlong: true, maxed: false, rigOpen: false, tuning: 'song', ref: 'song' });
// Per song: 'song' (follow its own tones) or a preset id.
export const songToneChoice = load('stagehand.songTone', {});
export const saveToneChoice = () => {
  try {
    const keys = Object.keys(songToneChoice);
    for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete songToneChoice[k];
    localStorage.setItem('stagehand.songTone', JSON.stringify(songToneChoice));
  } catch (_) {}
};
const savePrefs = () => {
  try {
    localStorage.setItem('stagehand.tab', JSON.stringify(prefs));
  } catch (_) {}
};

function prettySection(name) {
  const n = String(name || '').toLowerCase();
  const map = { noguitar: 'No guitar', prechorus: 'Pre-chorus', postchorus: 'Post-chorus', tapping: 'Tapping', breakdown: 'Breakdown', modverse: 'Verse', modchorus: 'Chorus', fadein: 'Fade in', fadeout: 'Fade out', ambient: 'Ambient', hook: 'Hook', riff: 'Riff', solo: 'Solo', intro: 'Intro', outro: 'Outro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', interlude: 'Interlude', melody: 'Melody', vamp: 'Vamp', buildup: 'Build-up', transition: 'Transition', variation: 'Variation', silence: 'Silence' };
  return map[n] || (n ? n[0].toUpperCase() + n.slice(1) : '');
}

function lowerBound(arr, t) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createTabView(host, stage) {
  const V = {
    song: null,
    parts: [],
    tab: null,
    loading: false,
    error: null,
    visible: false,
    raf: 0,
    dirty: true,
    systems: null,
    sysKey: '',
    curSection: -1,
    lastTuner: null,
  };

  // ---------------------------------------------------------------- DOM --
  const bar = h('div.tab-bar');
  const partsBox = h('div.tab-parts', { role: 'group', 'aria-label': 'Part' });
  const playAlongBtn = h('button.tab-toggle', { type: 'button' });
  const speedSeg = h('div.seg.tab-speed', { role: 'group', 'aria-label': 'Practice speed' });
  for (const s of SPEEDS) {
    const b = h('button', { type: 'button', text: s === 1 ? '100%' : `${Math.round(s * 100)}%`, title: s === 1 ? 'Full speed' : `Slow down to ${Math.round(s * 100)}% (same pitch)` });
    b.dataset.speed = String(s);
    b.onclick = () => setSpeed(s);
    speedSeg.append(b);
  }
  const optBtn = h('button.icon-btn', { type: 'button', title: 'Tab options', 'aria-label': 'Tab options', html: icon('sliders') });
  const zOut = h('button.icon-btn', { type: 'button', title: 'Zoom out (-)', 'aria-label': 'Zoom out', html: icon('zoomOut') });
  const zIn = h('button.icon-btn', { type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', html: icon('zoomIn') });
  const maxBtn = h('button.icon-btn', { type: 'button' });
  const rigBtn = h('button.btn.small.rig-btn', { type: 'button' });
  // Stagehand 3: part chips live in the Now playing header, speed in its footer, the rig on Play.
  bar.append(h('span.grow'), zOut, zIn, optBtn);

  const sectionsBar = h('div.tab-sections', { title: 'Click a section to jump there. Double-click to loop it.' });
  const main = h('div.tab-main');
  const canvas = h('canvas.tab-canvas', { 'aria-label': 'Tablature' });
  const msg = h('div.tab-msg', { hidden: true });
  const panel = h('aside.rig-panel', { hidden: true, 'aria-label': 'Your guitar' });
  main.append(canvas, msg, panel);
  const foot = h('div.tab-foot');
  host.append(bar, sectionsBar, main, foot);

  // 4.2: the tuner is the Tuner tab in the right panel (nowpanel.js), never over the tab
  const toggleTuner = () => window.dispatchEvent(new CustomEvent('stagehand:tab-tuner'));
  const tunerShowing = () => !!document.querySelector('.np-tuner') && document.querySelector('.np-tuner').isConnected;
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'u' || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const shown = (el) => !!el && el.isConnected && (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0);
    if (!shown(host)) return; // the tab view isn't showing
    if (shown(document.querySelector('.highway'))) return; // the highway has its own tuner on U
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    toggleTuner();
  });
  zOut.onclick = () => zoom(-1);
  zIn.onclick = () => zoom(1);
  optBtn.onclick = (e) => {
    const r = optBtn.getBoundingClientRect();
    const check = (on) => (on ? '✓' : '');
    showMenu(
      r.right,
      r.bottom + 4,
      [
        { label: tunerShowing() ? 'Hide the tuner' : 'Tuner', icon: 'tuning', hint: 'U', onClick: toggleTuner },
        '-',
        { heading: true, label: 'Strings' },
        { label: 'Low E on top', icon: 'tuning', hint: check(prefs.lowTop), onClick: () => setPref('lowTop', true) },
        { label: 'High e on top (standard tab)', icon: 'tuning', hint: check(!prefs.lowTop), onClick: () => setPref('lowTop', false) },
        '-',
        { heading: true, label: 'Layout' },
        { label: 'Scrolling', icon: 'next', hint: check(prefs.layout === 'scroll'), onClick: () => setPref('layout', 'scroll') },
        { label: 'Pages', icon: 'list', hint: check(prefs.layout === 'page'), onClick: () => setPref('layout', 'page') },
        '-',
        { label: 'Show lyrics', icon: 'music', hint: check(prefs.lyrics), onClick: () => setPref('lyrics', !prefs.lyrics) },
      ],
      { align: 'right' }
    );
    e.stopPropagation();
  };
  maxBtn.onclick = () => setMaxed(!prefs.maxed);
  rigBtn.onclick = () => {
    prefs.rigOpen = !prefs.rigOpen;
    savePrefs();
    renderPanel();
    renderBar();
  };
  playAlongBtn.onclick = () => {
    if (!stage.stems().length) return;
    prefs.playAlong = !prefs.playAlong;
    savePrefs();
    applyPlayAlong();
    renderBar();
    renderFoot();
  };

  function setPref(k, v) {
    prefs[k] = v;
    savePrefs();
    V.sysKey = '';
    draw(true);
  }

  function setMaxed(on) {
    prefs.maxed = on;
    savePrefs();
    /* Stagehand 3: Now playing is always full size */
    renderBar();
    requestAnimationFrame(() => resize());
  }

  function setSpeed(s) {
    prefs.speed = s;
    savePrefs();
    stage.engine.setSpeed(s);
    renderBar();
  }

  function zoom(dir) {
    prefs.zoom = dir === 0 ? 1 : Math.max(0.5, Math.min(2.5, prefs.zoom * (dir > 0 ? 1.2 : 1 / 1.2)));
    savePrefs();
    V.sysKey = '';
    draw(true);
  }

  // ------------------------------------------------------------- data --
  function instrument() {
    return V.tab && V.tab.type === 'bass' ? 'bass' : 'guitar';
  }

  function applyPlayAlong() {
    const on = V.visible && prefs.playAlong && stage.stems().length > 0 && V.tab;
    stage.engine.setPlayAlong(on ? instrument() : null);
    if (on) stage.setMode('stems');
  }

  async function setSong(song) {
    V.song = song;
    V.tab = null;
    V.parts = [];
    V.error = null;
    V.sysKey = '';
    if (!song) return render();
    if (!V.visible) return render();
    await loadParts();
  }

  async function loadParts() {
    const song = V.song;
    if (!song) return;
    V.loading = true;
    render();
    try {
      V.parts = await api.tab.list(song.id);
      if (V.song !== song) return;
      const pick = V.parts.find((p) => p.type === prefs.part && !p.bonus) || V.parts.find((p) => p.type === prefs.part) || V.parts.find((p) => (prefs.part === 'lead' ? p.type === 'combo' : false)) || V.parts[0];
      if (!pick) {
        V.error = 'This song has no guitar or bass part to show.';
        V.loading = false;
        return render();
      }
      await loadPart(pick.id, { remember: false });
    } catch (err) {
      V.error = err.message;
      V.loading = false;
      render();
    }
  }

  async function loadPart(id, { remember = true } = {}) {
    const song = V.song;
    V.loading = true;
    V.error = null;
    render();
    try {
      const tab = await api.tab.load(song.id, id);
      if (V.song !== song) return;
      V.tab = tab;
      tab.allNotes = buildEvents(tab);
      tab.lyrics = tab.lyrics || [];
      if (remember) {
        prefs.part = tab.type === 'combo' ? 'lead' : tab.type;
        savePrefs();
      }
      V.toneKey = null;
      if (rig.on) applySongToneChoice();
      applyPlayAlong();
    } catch (err) {
      V.error = err.message;
    }
    V.loading = false;
    V.sysKey = '';
    render();
  }

  function followsSong() {
    const st = V.tab && V.tab.songTones;
    if (!st || !V.song) return false;
    return (songToneChoice[V.song.id] || 'song') === 'song';
  }

  /** The song's tone at time t (its base tone before the first switch). */
  function songToneAt(t) {
    const st = V.tab && V.tab.songTones;
    if (!st) return null;
    let key = st.base;
    for (const c of st.changes) {
      if (c.t <= t + 0.02) key = c.key;
      else break;
    }
    return st.tones.find((x) => x.key === key) || st.tones[0];
  }

  /** Puts the rig on this song's chosen tone (its own, or the preset picked for it). */
  function applySongToneChoice() {
    if (!V.tab) return;
    if (V.tab.songTones && rig.on) rig.prepareTones(V.tab.songTones.tones);
    const kind = V.tab.type === 'bass' ? 'bass' : 'guitar';
    const choice = V.song ? songToneChoice[V.song.id] : null;
    if (followsSong()) {
      const tone = songToneAt(stage.engine.position);
      V.toneKey = tone ? tone.key : null;
      rig.setSongTone(tone);
    } else if (choice && choice !== 'song' && rig.findTone(choice)) {
      if (rig.mode === 'song' || rig.toneId !== choice) rig.setTone(choice);
    } else if (rig.mode === 'song') rig.setTone(kind === 'bass' ? 'bass-clean' : 'crunch');
  }

  /** Flattens single notes and chord notes into one time-sorted list for drawing. */
  function buildEvents(tab) {
    const out = [];
    for (const n of tab.notes) out.push({ ...n, chord: -1 });
    let prevChord = -2;
    let prevT = -10;
    for (const ce of tab.chordEvents) {
      const same = ce.chord === prevChord && ce.t - prevT < 2.5;
      for (const sn of ce.strings) out.push({ ...sn, t: ce.t, sus: sn.sus !== undefined ? sn.sus : ce.sus, chord: ce.chord, chordHead: false });
      out.push({ t: ce.t, chordLabel: same ? null : (tab.chords[ce.chord] || {}).name || '', chordSpan: ce.strings.map((x) => x.s), chord: ce.chord, s: -1 });
      prevChord = ce.chord;
      prevT = ce.t;
    }
    out.sort((a, b) => a.t - b.t || a.s - b.s);
    return out;
  }

  // ---------------------------------------------------------- drawing --
  let W = 0;
  let H = 0;
  let dpr = 1;
  const ctx = canvas.getContext('2d');

  function resize() {
    const r = main.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(100, Math.floor(r.width));
    H = Math.max(80, Math.floor(r.height));
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    V.sysKey = '';
    draw(true);
  }
  new ResizeObserver(() => V.visible && resize()).observe(main);

  function geometry() {
    const tab = V.tab;
    const n = tab.strings;
    const lyrics = prefs.lyrics && tab.lyrics.length;
    const gutter = 44;
    const pps = 190 * prefs.zoom;
    if (prefs.layout === 'page') {
      const gap = n === 4 ? 24 : 20;
      const sysH = 76 + gap * (n - 1) + (lyrics ? 50 : 28);
      return { gutter, pps, gap, sysH, rows: Math.max(1, Math.floor((H - 8) / sysH)), lyrics };
    }
    const top = 64;
    const bottom = lyrics ? 58 : 34;
    const gap = Math.max(16, Math.min(n === 4 ? 62 : 50, (H - top - bottom) / (n - 1)));
    const used = gap * (n - 1);
    const staffTop = Math.max(top, Math.round((H - bottom - used + top) / 2) - 8);
    return { gutter, pps, gap, staffTop, lyrics };
  }

  /** Packs bars into page rows. */
  function systems(g) {
    const key = `${W}|${prefs.zoom}|${V.tab.id}`;
    if (V.sysKey === key && V.systems) return V.systems;
    const tab = V.tab;
    const usable = W - g.gutter - 16;
    const bars = tab.beats.filter((b) => b.m >= 0).map((b) => b.t);
    const first = tab.beats.length ? tab.beats[0].t : 0;
    if (!bars.length || bars[0] > first + 0.01) bars.unshift(first);
    const end = Math.max(tab.length || 0, stage.engine.duration || 0);
    bars.push(end);
    const rows = [];
    const startPre = 0;
    let rowStart = startPre;
    let i = 0;
    // Lead-in before the first bar goes on the first row.
    while (i < bars.length) {
      let j = i;
      while (j + 1 < bars.length && (bars[j + 1] - rowStart) * g.pps <= usable) j++;
      if (j === i) j = Math.min(bars.length - 1, i + 1);
      rows.push({ t0: rowStart, t1: bars[j] });
      rowStart = bars[j];
      i = j;
      if (j >= bars.length - 1) break;
    }
    V.systems = rows;
    V.sysKey = key;
    return rows;
  }

  function draw(force) {
    if (force) V.dirty = true;
    if (!V.visible) return;
    if (!V.raf) V.raf = requestAnimationFrame(frame);
  }

  function frame() {
    V.raf = 0;
    if (!V.visible) return;
    // hidden under the full-screen highway: don't paint, just check back now and then
    if (document.getElementById('app').classList.contains('under-highway')) {
      setTimeout(() => draw(true), 300);
      return;
    }
    const t = stage.engine.position;
    const live = stage.engine.playing;
    paint(t);
    updateSections(t);
    if (rig.on) {
      if (followsSong() && rig.mode === 'song') {
        const tone = songToneAt(t);
        if (tone && tone.key !== V.toneKey) {
          V.toneKey = tone.key;
          rig.setSongTone(tone);
        }
      }
      updateRig();
    }
    updateFootLevels();
    if (live || rig.on || V.dirty) {
      V.dirty = false;
      if (live || rig.on) V.raf = requestAnimationFrame(frame);
    }
  }

  function paint(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const tab = V.tab;
    if (!tab || V.loading || V.error) return;
    const g = geometry();
    if (prefs.layout === 'page') {
      const rows = systems(g);
      let cur = rows.findIndex((r) => t >= r.t0 && t < r.t1);
      if (cur < 0) cur = t >= (rows[rows.length - 1] || { t1: 0 }).t1 ? rows.length - 1 : 0;
      // Keep the playing row on top; the rows below let you read ahead.
      for (let r = 0; r < g.rows && cur + r < rows.length; r++) {
        const row = rows[cur + r];
        const top = 4 + r * g.sysH;
        const x0 = g.gutter + 6;
        const x1 = x0 + (row.t1 - row.t0) * g.pps;
        drawSystem({ t0: row.t0, t1: row.t1, x0, x1, staffTop: top + 70, gap: g.gap, t, lyrics: g.lyrics, playhead: r === 0, dim: r > 0 });
        if (r > 0) {
          ctx.fillStyle = 'rgba(42, 51, 80, 0.6)';
          ctx.fillRect(12, top - 3, W - 24, 1);
        }
      }
      drawStringNames(g, null);
    } else {
      const playX = g.gutter + Math.min(260, (W - g.gutter) * 0.24);
      const t0 = t - (playX - g.gutter) / g.pps;
      const t1 = t0 + (W - g.gutter) / g.pps;
      drawSystem({ t0, t1, x0: g.gutter, x1: W, xAt: (time) => playX + (time - t) * g.pps, staffTop: g.staffTop, gap: g.gap, t, lyrics: g.lyrics, playhead: true, playX });
      drawStringNames(g, g.staffTop);
    }
  }

  function yOf(s, staffTop, gap) {
    const n = V.tab.strings;
    return staffTop + (prefs.lowTop ? s : n - 1 - s) * gap;
  }

  function drawStringNames(g, staffTop) {
    const tab = V.tab;
    const names = tab.type === 'bass' ? BASS_NAMES : GUITAR_NAMES;
    const opens = openStrings(tab);
    ctx.fillStyle = '#171d2d';
    ctx.fillRect(0, 0, g.gutter, H);
    ctx.fillStyle = 'rgba(42, 51, 80, 0.8)';
    ctx.fillRect(g.gutter - 1, 0, 1, H);
    ctx.font = `700 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tops = prefs.layout === 'page' ? Array.from({ length: g.rows }, (_, r) => 4 + r * g.sysH + 70) : [staffTop];
    for (const top of tops) {
      for (let s = 0; s < tab.strings; s++) {
        const y = yOf(s, top, g.gap);
        ctx.fillStyle = STRING_COLORS[s];
        const changed = opens[s] !== (tab.type === 'bass' ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64])[s];
        ctx.fillText(changed ? noteName(opens[s]) : s === 5 ? 'e' : names[s], g.gutter / 2, y);
      }
    }
  }

  function drawSystem({ t0, t1, x0, x1, xAt, staffTop, gap, t, lyrics, playhead, playX, dim }) {
    const tab = V.tab;
    const n = tab.strings;
    const X = xAt || ((time) => x0 + (time - t0) * ((x1 - x0) / Math.max(0.001, t1 - t0)));
    const right = Math.min(W, Math.max(x1, x0));
    const staffBottom = staffTop + gap * (n - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 - 2, staffTop - 64, right - x0 + 4, staffBottom - staffTop + 140);
    ctx.clip();
    if (dim) ctx.globalAlpha = 0.85;

    // beats and bars
    const bi = lowerBound(tab.beats, t0 - 0.01);
    let barNo = 0;
    for (let i = 0; i < bi; i++) if (tab.beats[i].m >= 0) barNo++;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (let i = bi; i < tab.beats.length && tab.beats[i].t <= t1 + 0.01; i++) {
      const b = tab.beats[i];
      const x = Math.round(X(b.t)) + 0.5;
      if (b.m >= 0) {
        barNo++;
        ctx.fillStyle = C.bar;
        ctx.fillRect(x - 0.5, staffTop - 6, 1.5, staffBottom - staffTop + 12);
        ctx.fillStyle = C.barNum;
        ctx.font = `500 10px ${FONT}`;
        ctx.fillText(String(barNo), x + 4, staffTop - 10);
      } else {
        ctx.fillStyle = C.beat;
        ctx.fillRect(x - 0.5, staffTop, 1, staffBottom - staffTop);
      }
    }
    // section names
    ctx.font = `700 11px ${FONT}`;
    for (const sec of tab.sections) {
      if (sec.start > t1 || sec.end < t0) continue;
      const label = prettySection(sec.name).toUpperCase();
      const x = Math.max(x0 + 4, X(sec.start) + 2);
      const w = ctx.measureText(label).width + 14;
      if (sec.start < t0 && x + w > X(sec.end) - 4) continue;
      ctx.fillStyle = 'rgba(255, 181, 71, 0.14)';
      roundRect(ctx, x, staffTop - 58, w, 18, 4);
      ctx.fill();
      ctx.fillStyle = C.tungstenHi;
      ctx.fillText(label, x + 7, staffTop - 45);
    }
    // tone switches
    const st = tab.songTones;
    if (st && st.changes.length) {
      ctx.font = `italic 600 11px ${FONT}`;
      ctx.textAlign = 'left';
      for (const c of st.changes) {
        if (c.t < t0 - 1 || c.t > t1) continue;
        const tone = st.tones.find((x) => x.key === c.key);
        const x = X(c.t);
        ctx.fillStyle = 'rgba(51, 200, 224, 0.85)';
        ctx.fillRect(Math.round(x), staffTop - 34, 1.5, 10);
        ctx.fillText(`Tone: ${tone ? tone.name : c.key}`, x + 5, staffTop - 25);
      }
    }
    // strings
    for (let s = 0; s < n; s++) {
      const y = Math.round(yOf(s, staffTop, gap)) + 0.5;
      ctx.fillStyle = STRING_COLORS[s] + '4d';
      ctx.fillRect(x0, y - 0.5, right - x0, n === 4 ? 2 : 1.25);
    }

    const ev = tab.allNotes;
    let i = lowerBound(ev, t0 - 4);
    const techRow = staffBottom + 22;
    const noteFont = `750 12px ${FONT}`;
    const items = [];
    for (; i < ev.length && ev[i].t <= t1 + 0.05; i++) {
      const e = ev[i];
      const x = X(e.t);
      if (e.s < 0) {
        if (x < x0 - 40) continue;
        // chord bracket + name
        const ys = e.chordSpan.map((s) => yOf(s, staffTop, gap));
        const ya = Math.min(...ys);
        const yb = Math.max(...ys);
        const past = e.t < t - 0.15;
        ctx.fillStyle = past ? 'rgba(236, 238, 246, 0.03)' : 'rgba(236, 238, 246, 0.07)';
        roundRect(ctx, x - 15, ya - 14, 30, yb - ya + 28, 8);
        ctx.fill();
        if (e.chordLabel) {
          ctx.font = `700 13px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillStyle = past ? C.ink3 : C.tungstenHi;
          ctx.fillText(e.chordLabel, x, staffTop - 22);
        }
        continue;
      }
      const sus = e.sus || 0;
      if (x + sus * ((x1 - x0) / Math.max(0.001, t1 - t0)) < x0 - 20 && !xAt) continue;
      items.push(e);
    }
    // sustains, slides, vibrato under the notes
    for (const e of items) {
      const x = X(e.t);
      const y = yOf(e.s, staffTop, gap);
      const col = STRING_COLORS[e.s];
      const past = e.t + (e.sus || 0) < t - 0.05;
      if (e.sus > 0.05) {
        const xe = X(e.t + e.sus);
        ctx.globalAlpha = (dim ? 0.85 : 1) * (past ? 0.25 : 0.55);
        ctx.strokeStyle = col;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (e.slideTo !== undefined || e.slideUnpitchTo !== undefined) {
          const to = e.slideTo !== undefined ? e.slideTo : e.slideUnpitchTo;
          const dy = Math.max(-gap * 0.45, Math.min(gap * 0.45, (e.f - to) * 3));
          ctx.moveTo(x + 12, y);
          ctx.lineTo(xe, y + dy);
        } else if (e.vibrato) {
          ctx.moveTo(x + 12, y);
          for (let xx = x + 12; xx < xe; xx += 3) ctx.lineTo(xx, y + Math.sin((xx - x) / 4) * 3);
        } else if (e.bend) {
          ctx.moveTo(x + 12, y);
          ctx.quadraticCurveTo((x + xe) / 2, y, xe, y - Math.min(gap * 0.8, 8 + e.bend * 10) * (prefs.lowTop ? 1 : 1));
        } else {
          ctx.moveTo(x + 12, y);
          ctx.lineTo(xe, y);
        }
        ctx.stroke();
        ctx.globalAlpha = dim ? 0.85 : 1;
      }
    }
    // notes
    ctx.font = noteFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const techLabels = [];
    for (const e of items) {
      const x = X(e.t);
      if (x < x0 - 30 || x > right + 30) continue;
      const y = yOf(e.s, staffTop, gap);
      const col = STRING_COLORS[e.s];
      const now = e.t <= t + 0.03 && t < e.t + Math.max(0.12, e.sus || 0);
      const past = !now && e.t < t;
      let txt = e.mute ? '×' : String(e.f);
      if (e.harmonic) txt = `<${e.f}>`;
      const w = Math.max(22, ctx.measureText(txt).width + 9);
      ctx.globalAlpha = (dim ? 0.85 : 1) * (past ? 0.32 : 1);
      if (now) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 16;
      }
      roundRect(ctx, x - w / 2, y - 10, w, 20, 6);
      ctx.fillStyle = now ? col : C.noteBg;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = col;
      ctx.stroke();
      ctx.fillStyle = now ? C.noteBg : C.ink;
      ctx.fillText(txt, x, y + 0.5);
      ctx.globalAlpha = dim ? 0.85 : 1;
      // technique marks
      const above = [];
      if (e.hammerOn) above.push('h');
      if (e.pullOff) above.push('p');
      if (e.tap) above.push('T');
      if (e.slap) above.push('S');
      if (e.pop) above.push('P');
      if (e.slideTo !== undefined) above.push(e.slideTo > e.f ? `/${e.slideTo}` : `\\${e.slideTo}`);
      if (e.bend) above.push(`↑${({ 0.5: '¼', 1: '½', 1.5: '¾', 2: 'full', 3: '1½', 4: '2' })[e.bend] || e.bend / 2}`);
      if (e.accent) above.push('>');
      if (e.tremolo) above.push('≋');
      if (above.length) techLabels.push({ x, y: y - 17, text: above.join(' '), past });
      const below = [];
      if (e.palmMute) below.push('PM');
      if (e.pinchHarmonic) below.push('P.H.');
      if (below.length) techLabels.push({ x, y: techRow, text: below.join(' '), past, below: true });
    }
    ctx.font = `italic 650 11px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    let lastBelow = -Infinity;
    for (const l of techLabels) {
      if (l.below) {
        if (l.x - lastBelow < 24) continue;
        lastBelow = l.x;
      }
      ctx.fillStyle = l.past ? C.ink3 : C.ink2;
      ctx.fillText(l.text, l.x, l.y);
    }

    // lyrics
    if (lyrics) {
      const ly = tab.lyrics;
      let k = lowerBound(ly, t0 - 2);
      const y = staffBottom + (techLabels.some((l) => l.below) || true ? 46 : 30);
      ctx.font = `500 13px ${FONT}`;
      ctx.textAlign = 'left';
      let lastEnd = -Infinity;
      for (; k < ly.length && ly[k].t <= t1; k++) {
        const w0 = ly[k];
        const raw = w0.w.replace(/\+$/, '');
        const joined = raw.endsWith('-');
        const word = joined ? raw.slice(0, -1) : raw;
        let x = X(w0.t);
        if (x < lastEnd + (joined ? 0 : 0)) x = lastEnd;
        const width = ctx.measureText(word).width;
        const on = t >= w0.t && t < w0.t + Math.max(0.2, w0.d);
        ctx.fillStyle = on ? C.tungstenHi : w0.t < t ? C.ink3 : C.ink2;
        ctx.fillText(word, x, y);
        lastEnd = x + width + (joined ? 1 : 6);
      }
    }

    // playhead
    if (playhead) {
      const px = playX !== undefined ? playX : X(t);
      if (px >= x0 - 1 && px <= right + 1) {
        const grad = ctx.createLinearGradient(px - 40, 0, px, 0);
        grad.addColorStop(0, 'rgba(255, 181, 71, 0)');
        grad.addColorStop(1, 'rgba(255, 181, 71, 0.10)');
        ctx.fillStyle = grad;
        ctx.fillRect(px - 40, staffTop - 14, 40, staffBottom - staffTop + 28);
        ctx.fillStyle = C.tungstenHi;
        ctx.shadowColor = C.tungsten;
        ctx.shadowBlur = 12;
        ctx.fillRect(px - 1, staffTop - 20, 2, staffBottom - staffTop + 40);
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  // -------------------------------------------------------- sections bar --
  function renderSections() {
    sectionsBar.innerHTML = '';
    const tab = V.tab;
    if (!tab || !tab.sections.length) {
      sectionsBar.hidden = true;
      return;
    }
    sectionsBar.hidden = false;
    const total = Math.max(tab.length, stage.engine.duration || 0) || 1;
    const first = tab.sections[0].start;
    if (first > 0.5) sectionsBar.append(segBtn({ name: '', start: 0, end: first }, total, -1));
    tab.sections.forEach((s, i) => sectionsBar.append(segBtn(s, total, i)));
    sectionsBar.append(h('i.tab-sections-head'));
    V.curSection = -2;
  }

  function segBtn(s, total, i) {
    const b = h('button', { type: 'button', text: prettySection(s.name), title: s.name ? `${prettySection(s.name)}: jump here, double-click to loop` : 'Start' });
    b.style.flexGrow = String(Math.max(0.001, s.end - s.start));
    b.style.flexBasis = '0';
    b.dataset.i = String(i);
    b.onclick = () => stage.seek(s.start);
    b.ondblclick = () => stage.setLoop({ start: s.start, end: s.end });
    void total;
    return b;
  }

  function updateSections(t) {
    const tab = V.tab;
    if (!tab || sectionsBar.hidden) return;
    let cur = -1;
    tab.sections.forEach((s, i) => {
      if (t >= s.start && t < s.end) cur = i;
    });
    if (cur !== V.curSection) {
      V.curSection = cur;
      for (const b of sectionsBar.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.i) === cur);
    }
    const headEl = sectionsBar.querySelector('.tab-sections-head');
    const total = Math.max(tab.length, stage.engine.duration || 0) || 1;
    if (headEl) headEl.style.left = `${Math.min(100, (t / total) * 100)}%`;
  }

  // -------------------------------------------------------------- bar --
  function renderBar() {
    partsBox.innerHTML = '';
    for (const p of V.parts) {
      const on = V.tab && V.tab.id === p.id;
      const b = h('button.chip', { type: 'button', 'aria-pressed': String(!!on), title: `${p.name}${p.bonus ? ' (bonus)' : ''} · ${p.tuningName || ''}${p.capo ? ` · capo ${p.capo}` : ''}` });
      b.innerHTML = `<span class="dot" style="background:${p.type === 'bass' ? 'var(--gel-bass)' : 'var(--gel-guitar)'}"></span>${esc(p.name)}${p.bonus ? '<span class="sub">bonus</span>' : ''}<span class="sub">${esc(p.tuningName || '')}${p.capo ? ` · capo ${p.capo}` : ''}</span>`;
      b.onclick = () => !on && loadPart(p.id);
      partsBox.append(b);
    }
    const hasStems = stage.stems().length > 0;
    const inst = instrument();
    playAlongBtn.disabled = !hasStems || !V.tab;
    playAlongBtn.setAttribute('aria-pressed', String(hasStems && prefs.playAlong));
    playAlongBtn.title = hasStems ? `Mute the ${inst} in the song so you can play it yourself` : 'Split stems first, so Stagehand can take your part out of the song';
    playAlongBtn.innerHTML = `<span class="sw"><i></i></span>Play along<span class="sub">${hasStems ? (prefs.playAlong ? `${inst} muted` : `hear the ${inst}`) : 'needs stems'}</span>`;
    for (const b of speedSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === prefs.speed));
    maxBtn.innerHTML = icon(prefs.maxed ? 'chevron' : 'fit');
    maxBtn.title = prefs.maxed ? 'Show the song list again' : 'Hide the song list (more room for the tab)';
    maxBtn.setAttribute('aria-label', maxBtn.title);
    rigBtn.classList.toggle('on', rig.on);
    rigBtn.setAttribute('aria-pressed', String(prefs.rigOpen));
    rigBtn.innerHTML = `${icon('amp')}<span>Your guitar</span>${rig.on ? `<span class="live-dot" title="Input on"></span>` : ''}`;
  }

  // ------------------------------------------------------------- foot --
  const footMeters = new Map();
  function renderFoot() {
    foot.innerHTML = '';
    footMeters.clear();
    const stems = stage.stems();
    if (!V.song) return;
    if (!stems.length) {
      const st = stage.stemStatus();
      const busy = st && (st.state === 'queued' || st.state === 'running');
      const text = busy ? `Splitting stems… ${st.progress ? Math.round(st.progress * 100) + '%' : ''}` : `Split stems to take the ${instrument()} out of the song and play it yourself.`;
      const b = busy ? null : h('button.btn.small', { type: 'button', html: `${icon('split')}<span>Split stems</span>` });
      if (b) b.onclick = () => stage.requestStems();
      foot.append(h('div.tab-hint', null, h('span', { text }), b));
      return;
    }
    const inst = instrument();
    for (const name of stems) {
      const t = stage.engine.tracks[stage.trackIndex(name)];
      const yours = prefs.playAlong && name === inst;
      const muted = yours || (t && t.muted);
      const chip = h(`div.stem-chip${muted ? '.muted' : ''}${yours ? '.yours' : ''}`);
      chip.style.setProperty('--gel', stage.gel(name));
      const m = h('button', { type: 'button', text: 'M', title: yours ? 'Muted for play-along' : t && t.muted ? `Unmute ${stage.label(name)}` : `Mute ${stage.label(name)}`, 'aria-pressed': String(!!muted) });
      m.onclick = () => {
        if (yours) {
          prefs.playAlong = false;
          savePrefs();
          applyPlayAlong();
          renderBar();
        } else stage.setStem(name, { muted: !(t && t.muted) });
        renderFoot();
      };
      const s = h('button', { type: 'button', text: 'S', title: `Solo ${stage.label(name)}`, 'aria-pressed': String(!!(t && t.solo)) });
      s.onclick = () => {
        stage.setStem(name, { solo: !(t && t.solo) });
        renderFoot();
      };
      const meter = h('i');
      footMeters.set(name, meter);
      const vol = h('input.stem-vol', { type: 'range', min: '0', max: '1', step: '0.01', value: String(t ? t.volume : 0.8), 'aria-label': `${stage.label(name)} volume`, title: `${stage.label(name)} volume (double-click to reset)` });
      vol.oninput = () => stage.setStem(name, { volume: Number(vol.value) });
      vol.ondblclick = () => {
        vol.value = '0.8';
        stage.setStem(name, { volume: 0.8 });
      };
      chip.append(...[h('span.dot'), h('span.name', { text: stage.label(name) }), yours ? h('span.you', { text: 'You' }) : null, h('span.stem-mix', null, vol, h('span.meter', null, meter)), m, s].filter(Boolean));
      foot.append(chip);
    }
  }

  function updateFootLevels() {
    for (const [name, el] of footMeters) {
      const lvl = stage.engine.level(stage.trackIndex(name));
      el.style.width = `${Math.min(100, lvl * 260)}%`;
    }
  }

  // ------------------------------------------------------------ rig panel --
  const rigEls = {};
  function renderPanel() {
    // Stagehand 3: the rig and tuner moved to the Play page.
    prefs.rigOpen = false;
    panel.hidden = !prefs.rigOpen || !V.visible;
    main.classList.toggle('with-panel', !panel.hidden);
    if (panel.hidden) return;
    panel.innerHTML = '';
    const close = h('button.icon-btn', { type: 'button', title: 'Close', 'aria-label': 'Close', html: icon('x') });
    close.onclick = () => {
      prefs.rigOpen = false;
      savePrefs();
      renderPanel();
      renderBar();
    };
    const power = h(`button.btn.small${rig.on ? '' : '.primary'}`, { type: 'button', text: rig.on ? 'Turn off' : 'Turn on' });
    power.onclick = async () => {
      if (rig.on) rig.stop();
      else {
        power.disabled = true;
        power.textContent = 'Starting…';
        rig.setSink(stage.engine.sinkId);
        await rig.start();
        if (rig.on) applySongToneChoice();
      }
      renderPanel();
      renderBar();
      draw(true);
    };
    const how = !rig.on
      ? 'Plug in your Rocksmith cable'
      : `On · ${rig.kind === 'native' ? (rig.info && rig.info.mode === 'exclusive' ? 'direct to your output' : 'shared output') : 'in-app engine'}${rig.latencyMs ? ` · about ${rig.latencyMs} ms` : ''}`;
    panel.append(h('div.rig-head', null, h('div', null, h('b', { text: 'Your guitar' }), h('span.rig-status', { text: how })), power, close));
    if (rig.error) panel.append(h('div.rig-error', { text: rig.error }));
    else if (rig.notice) panel.append(h('div.rig-note', { text: rig.notice }));

    const sel = h('select.input.small', { 'aria-label': 'Input' });
    sel.append(h('option', { value: '', text: 'Finding inputs…' }));
    const outSel = h('select.input.small', { 'aria-label': 'Output' });
    const outRow = h('label.rig-row', { hidden: true }, h('span', { text: 'Output' }), outSel);
    rig.devices().then((list) => {
      sel.innerHTML = '';
      if (!list.length) sel.append(h('option', { value: '', text: 'No inputs found' }));
      for (const d of list) {
        const o = h('option', { value: d.id, text: d.rocksmith ? `${d.label} (Rocksmith cable)` : d.label });
        if (d.id === rig.deviceId) o.selected = true;
        sel.append(o);
      }
      const outs = list.outputs || [];
      if (outs.length) {
        outSel.innerHTML = '';
        const def = outs.find((o) => o.isDefault);
        outSel.append(h('option', { value: '', text: def ? `Windows default (${def.label})` : 'Windows default' }));
        for (const d of outs) {
          const o = h('option', { value: d.id, text: d.label });
          if (d.id === rig.outputId) o.selected = true;
          outSel.append(o);
        }
        outRow.hidden = false;
      }
    });
    sel.onchange = async () => {
      await rig.setDevice(sel.value);
      renderPanel();
    };
    outSel.onchange = async () => {
      await rig.setOutput(outSel.value);
      renderPanel();
    };
    rigEls.inMeter = h('i');
    rigEls.clip = h('span.clip', { text: 'Clip', hidden: true });
    rigEls.outMeter = h('i');
    const calib = h('button.btn.small', { type: 'button', text: rig.calibrating ? 'Strum hard…' : 'Set level', title: 'Strum as hard as you play for 4 seconds; Stagehand sets the input level, like Rocksmith’s calibration', disabled: !rig.on || rig.calibrating });
    calib.onclick = async () => {
      calib.disabled = true;
      const r = await rig.calibrate(4, (p) => (calib.textContent = `Strum hard… ${Math.max(1, Math.ceil(4 - p * 4))}`));
      if (!r) toast({ title: 'Didn’t hear anything', message: 'Check the cable is plugged in, then strum hard while it counts down.', kind: 'info' });
      else toast({ title: 'Input level set', message: `Your hardest strum peaked at ${Math.round(r.peakDb)} dB.`, kind: 'ok' });
      renderPanel();
    };
    panel.append(
      h('label.rig-row', null, h('span', { text: 'Input' }), sel),
      outRow,
      h('div.rig-meters', null, h('span', { text: 'In' }), h('span.meter', null, rigEls.inMeter), rigEls.clip, h('span', { text: 'Out' }), h('span.meter', null, rigEls.outMeter)),
      h('div.rig-calib', null, h('span', { text: 'Rocksmith-style calibration' }), calib)
    );

    // Sound engine: fastest (takes over the output), shared, or in-app.
    const engSel = h('select.input.small', { 'aria-label': 'Sound engine' });
    const cur = rig.engineChoice === 'web' ? 'web' : rig.exclusive ? 'fast' : 'shared';
    for (const [v, label] of [
      ['fast', 'Fastest (takes over your output)'],
      ['shared', 'Shared (other apps keep playing)'],
      ['web', 'In-app (if the others don’t work)'],
    ])
      engSel.append(h('option', { value: v, text: label, selected: v === cur }));
    const bufSel = h('select.input.small', { 'aria-label': 'Buffer' });
    for (const [v, label] of [
      [0, 'Smallest delay'],
      [1, 'Small delay'],
      [2, 'Safe (if it crackles)'],
    ])
      bufSel.append(h('option', { value: String(v), text: label, selected: v === rig.buffer }));
    const engRow = h('div.rig-engine', { hidden: true }, h('label.rig-row', null, h('span', { text: 'Engine' }), engSel), h('label.rig-row', null, h('span', { text: 'Buffer' }), bufSel));
    rig.nativeAvailable().then((ok) => (engRow.hidden = !ok));
    engSel.onchange = async () => {
      const v = engSel.value;
      await rig.setEngine(v === 'web' ? { engine: 'web' } : { engine: 'auto', exclusive: v === 'fast' });
      renderPanel();
      renderBar();
    };
    bufSel.onchange = async () => {
      await rig.setEngine({ buffer: Number(bufSel.value) });
      renderPanel();
    };
    panel.append(engRow);

    const kind = V.tab && V.tab.type === 'bass' ? 'bass' : 'guitar';
    const grid = h('div.tone-grid');
    const st = V.tab && V.tab.songTones;
    if (st) {
      const cur = rig.mode === 'song' && rig.songTone ? rig.songTone : songToneAt(stage.engine.position);
      const gear = cur ? (cur.gear && cur.gear.length ? describe(cur) : [cur.amp, ...cur.pedals].filter(Boolean).join(' · ')) : '';
      const b = h('button.tone.song', { type: 'button', 'aria-pressed': String(rig.mode === 'song'), title: 'Use the tones this song comes with, switching when the song does' });
      b.innerHTML = `<b>Song tone</b><span>${esc(cur ? cur.name : '')}${st.tones.length > 1 ? ` · ${st.tones.length} tones, switches with the song` : ''}</span>${gear ? `<span class="gear">${esc(gear)}</span>` : ''}`;
      b.onclick = () => {
        songToneChoice[V.song.id] = 'song';
        saveToneChoice();
        applySongToneChoice();
        renderPanel();
      };
      grid.append(b);
    }
    // Every tone works on either instrument; this one's tones just come first.
    for (const t of [...TONES.filter((x) => x.kind === kind), ...TONES.filter((x) => x.kind !== kind)]) {
      const b = h('button.tone', { type: 'button', 'aria-pressed': String(rig.mode !== 'song' && rig.toneId === t.id), title: t.desc });
      b.innerHTML = `<b>${esc(t.name)}</b><span>${esc(t.desc)}</span>${t.chain ? `<span class="gear">${esc(t.chain)}</span>` : ''}`;
      b.onclick = () => {
        if (V.song) {
          songToneChoice[V.song.id] = t.id;
          saveToneChoice();
        }
        rig.setTone(t.id);
        renderPanel();
      };
      grid.append(b);
    }
    panel.append(h('div.rig-label', { text: 'Tone' }), grid);

    const knobs = h('div.knobs');
    const k = (name, label) => {
      const v = name === 'gain' ? rig.knobs.gain ?? rig.tone.gain : rig.knobs[name];
      const input = h('input.fader', { type: 'range', min: '0', max: '1', step: '0.01', value: String(v), 'aria-label': label });
      const out = h('span.v', { text: name === 'gain' || name === 'fx' || name === 'volume' || name === 'input' ? String(Math.round(v * 10)) : `${v >= 0.5 ? '+' : ''}${Math.round((v - 0.5) * 24)} dB` });
      input.oninput = () => {
        rig.setKnob(name, input.value);
        const x = Number(input.value);
        out.textContent = name === 'gain' || name === 'fx' || name === 'volume' || name === 'input' ? String(Math.round(x * 10)) : `${x >= 0.5 ? '+' : ''}${Math.round((x - 0.5) * 24)} dB`;
      };
      input.ondblclick = () => {
        input.value = name === 'gain' ? String(rig.tone.gain) : name === 'volume' ? '0.7' : '0.5';
        input.dispatchEvent(new Event('input'));
      };
      knobs.append(h('label.knob', null, h('span', { text: label }), input, out));
    };
    k('gain', 'Gain');
    k('bass', 'Bass');
    k('mid', 'Mid');
    k('treble', 'Treble');
    k('fx', 'Effects');
    k('volume', 'Volume');
    k('input', 'Input level');
    panel.append(h('div.rig-label', { text: 'Amp' }), knobs);

    // Tuner
    rigEls.tunerNote = h('b.tn-note', { text: '–' });
    rigEls.tunerCents = h('span.tn-cents', { text: rig.on ? 'Play one open string' : 'Turn on to tune' });
    rigEls.tunerHz = h('span.tn-hz', { text: '' });
    rigEls.needle = h('i.tn-needle');
    rigEls.strobe = h('div.tn-strobe');
    rigEls.strings = h('div.tn-strings');
    const targets = tunerTargets();
    targets.list.forEach((tg, s) => {
      const el = h('button', { type: 'button', text: tg.name, title: `${tg.name}: ${tg.hz.toFixed(2)} Hz` });
      el.style.setProperty('--c', STRING_COLORS[s]);
      el.dataset.s = String(s);
      el.onclick = () => {
        V.lockString = V.lockString === s ? null : s;
        for (const x of rigEls.strings.children) x.classList.toggle('locked', Number(x.dataset.s) === V.lockString);
      };
      rigEls.strings.append(el);
    });
    const tuneSel = h('select.input.small', { 'aria-label': 'Tuning' });
    if (V.tab) tuneSel.append(h('option', { value: 'song', text: `This song: ${V.tab.tuningName || 'its tuning'}${V.tab.capo ? `, capo ${V.tab.capo}` : ''}` }));
    tuneSel.append(h('option', { value: 'chromatic', text: 'Chromatic (any note)' }));
    for (const t of TUNINGS) tuneSel.append(h('option', { value: t.id, text: t.name }));
    tuneSel.value = prefs.tuning === 'song' && !V.tab ? 'chromatic' : prefs.tuning;
    tuneSel.onchange = () => {
      prefs.tuning = tuneSel.value;
      V.lockString = null;
      savePrefs();
      renderPanel();
    };
    const refSel = h('select.input.small', { 'aria-label': 'Reference pitch' });
    const songRef = V.tab ? 440 * Math.pow(2, (V.tab.cents || 0) / 1200) : 440;
    refSel.append(h('option', { value: 'song', text: `Song: A = ${songRef.toFixed(1)} Hz` }));
    for (const hz of [440, 432, 442, 444, 446]) refSel.append(h('option', { value: String(hz), text: `A = ${hz} Hz` }));
    refSel.value = prefs.ref;
    refSel.onchange = () => {
      prefs.ref = refSel.value;
      savePrefs();
      renderPanel();
    };
    panel.append(
      h('div.rig-label', { text: 'Tuner' }),
      h('div.tn-pick', null, tuneSel, refSel),
      h(
        'div.tuner',
        null,
        h('div.tn-top', null, rigEls.tunerNote, h('div.tn-read', null, rigEls.tunerCents, rigEls.tunerHz)),
        rigEls.strobe,
        h('div.tn-scale', null, h('span'), rigEls.needle),
        rigEls.strings
      )
    );
    panel.append(h('p.fine', { text: 'Use headphones or speakers on this PC. If you hear yourself twice, turn off “Listen to this device” for the cable in Windows sound settings.' }));
  }

  /** Target pitches for the tuner, from the chosen tuning and reference. */
  function tunerTargets() {
    const tab = V.tab;
    const bass = tab && tab.type === 'bass';
    const n = bass ? 4 : 6;
    const refCents = prefs.ref === 'song' ? (tab ? tab.cents || 0 : 0) : 1200 * Math.log2(Number(prefs.ref) / 440);
    let midis;
    if (prefs.tuning === 'chromatic' || (prefs.tuning === 'song' && !tab)) return { chromatic: true, refCents, list: [] };
    if (prefs.tuning === 'song') midis = openStrings(tab);
    else {
      const t = TUNINGS.find((x) => x.id === prefs.tuning) || TUNINGS[0];
      const base = bass ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64];
      midis = base.map((m, i) => m + t.o[i]);
    }
    const list = midis.slice(0, n).map((m) => {
      const cents = m * 100 + refCents;
      return { midi: m, cents, name: noteName(m), hz: 440 * Math.pow(2, (cents - 6900) / 1200) };
    });
    return { chromatic: false, refCents, list };
  }

  function updateRig() {
    if (panel.hidden || !rigEls.inMeter) return;
    const l = rig.levels();
    rigEls.inMeter.style.width = `${Math.min(100, l.input * 300)}%`;
    rigEls.outMeter.style.width = `${Math.min(100, l.output * 300)}%`;
    rigEls.clip.hidden = !l.clip;
    const now = performance.now();
    // Strobe: the stripes drift at a speed set by how far off you are, and stand still when in tune.
    if (V.strobeCents !== undefined && rigEls.strobe) {
      const dt = Math.min(0.1, (now - (V.lastStrobe || now)) / 1000);
      V.strobePos = ((V.strobePos || 0) + V.strobeCents * dt * 6) % 240;
      rigEls.strobe.style.backgroundPositionX = `${V.strobePos}px`;
      rigEls.strobe.classList.toggle('ok', Math.abs(V.strobeCents) < 1);
    }
    V.lastStrobe = now;
    if (now - (V.lastTuner || 0) < 60) return;
    V.lastTuner = now;
    const p = rig.pitch();
    if (!p) {
      rigEls.needle.style.opacity = '0.25';
      rigEls.strobe.style.opacity = '0.3';
      V.strobeCents = 0;
      return;
    }
    const cents = 100 * (12 * Math.log2(p.hz / 440) + 69);
    const tg = tunerTargets();
    let target = null;
    let off;
    let label;
    let targetHz = null;
    if (!tg.chromatic && tg.list.length) {
      let best = Infinity;
      tg.list.forEach((x, s) => {
        if (V.lockString != null && s !== V.lockString) return;
        const d = cents - x.cents;
        if (Math.abs(d) < Math.abs(best)) {
          best = d;
          target = s;
        }
      });
      if (Math.abs(best) <= 350 || V.lockString != null) {
        off = best;
        label = tg.list[target].name;
        targetHz = tg.list[target].hz;
      } else target = null;
    }
    if (target === null) {
      const rel = cents - tg.refCents;
      const m = Math.round(rel / 100);
      off = rel - m * 100;
      label = `${noteName(m)}${Math.floor(m / 12) - 1}`;
      targetHz = 440 * Math.pow(2, (m * 100 + tg.refCents - 6900) / 1200);
    }
    const a = Math.abs(off);
    rigEls.tunerNote.textContent = label;
    rigEls.tunerCents.textContent = a < 0.5 ? 'In tune' : `${a.toFixed(1)} cents ${off > 0 ? 'sharp' : 'flat'}${a > 100 ? ` · ${off > 0 ? 'tune down' : 'tune up'}` : ''}`;
    rigEls.tunerHz.textContent = `${p.hz.toFixed(2)} Hz · target ${targetHz.toFixed(2)} Hz`;
    rigEls.tunerCents.className = `tn-cents${a < 1 ? ' ok' : a < 5 ? ' near' : ''}`;
    rigEls.needle.style.left = `${50 + Math.max(-50, Math.min(50, off))}%`;
    rigEls.needle.classList.toggle('ok', a < 1);
    rigEls.needle.style.opacity = '1';
    rigEls.strobe.style.opacity = '1';
    V.strobeCents = Math.max(-50, Math.min(50, off));
    for (const el of rigEls.strings.children) el.classList.toggle('on', Number(el.dataset.s) === target);
  }

  rig.addEventListener('change', () => {
    renderBar();
    if (V.visible) renderPanel();
    draw(true);
  });

  // ------------------------------------------------------------ render --
  function render() {
    renderBar();
    renderFoot();
    renderSections();
    renderPanel();
    if (V.loading) {
      msg.hidden = false;
      msg.innerHTML = '<div class="spin"></div><span>Reading the tab…</span>';
    } else if (V.error) {
      msg.hidden = false;
      msg.innerHTML = `<b>No tab to show</b><span>${esc(V.error)}</span>`;
    } else if (!V.song) {
      msg.hidden = false;
      msg.innerHTML = '<b>Pick a song</b><span>Its guitar or bass part shows here as tab.</span>';
    } else msg.hidden = true;
    draw(true);
  }

  stage.engine.addEventListener('state', () => draw(true));
  stage.engine.addEventListener('seek', () => draw(true));
  stage.engine.addEventListener('mix', () => {
    if (!V.visible) return;
    renderBar();
    // Don't rebuild the stem row under a volume slider that's being dragged.
    if (!(document.activeElement && document.activeElement.classList.contains('stem-vol') && foot.contains(document.activeElement))) renderFoot();
  });

  return {
    get visible() {
      return V.visible;
    },
    async show() {
      V.visible = true;
      host.hidden = false;
      
      resize();
      if (V.song && !V.tab && !V.loading) await loadParts();
      else render();
      applyPlayAlong();
    },
    hide() {
      V.visible = false;
      host.hidden = true;
      
    },
    setSong,
    async selectPart(id) {
      if (V.song) await loadPart(id);
    },
    stemsChanged() {
      applyPlayAlong();
      renderBar();
      renderFoot();
    },
    statusChanged() {
      if (!stage.stems().length) renderFoot();
    },
    zoom,
    draw: () => draw(true),
    get tab() {
      return V.tab;
    },
  };
}
