/** Bottom pane: transport, timeline, full-mix lane and per-stem lanes. */
import { api } from './api.js';
import { state, on, emit, upsertSongs, setPage } from './store.js';
import { h, icon, esc, toast } from './ui.js';
import { AudioEngine, loadTrackData, STEM_ORDER } from './audio-engine.js';
import { WaveLane, drawBeam, drawRuler, drawSpectrum, fmtTime, overview, drawBars } from './wave.js';
import * as actions from './actions.js';
import { createTabView } from './tab.js';
import { createHighway } from './highway.js';
import { rig } from './rig.js';

const STEM_LABEL = { guitar: 'Guitar', bass: 'Bass', drums: 'Drums', vocals: 'Vocals', piano: 'Keys', other: 'Other' };
const GEL = {
  guitar: ['#ffb08f', '#ff6b3d', '#c8431e'],
  bass: ['#c4baff', '#8c7bff', '#5b49d6'],
  drums: ['#ff9cc0', '#ff4d8d', '#c92a62'],
  vocals: ['#9be9f5', '#33c8e0', '#1793a8'],
  piano: ['#cff09f', '#9bdb5a', '#68a92c'],
  other: ['#dde2f0', '#b0b8d4', '#7e87a6'],
};
const MIX_PALETTE = {
  played: ['#ffd497', '#ffb547', '#ff7a45'],
  unplayed: 'rgba(132, 144, 186, 0.42)',
  axis: 'rgba(255,255,255,0.05)',
  dim: { played: ['#59607a', '#4a5068', '#3c4256'], unplayed: 'rgba(90, 98, 128, 0.35)' },
};
function stemPalette(name) {
  const g = GEL[name] || GEL.other;
  return {
    played: g,
    unplayed: hexA(g[1], 0.32),
    axis: 'rgba(255,255,255,0.045)',
    dim: { played: ['#4f5670', '#454b62', '#3a3f53'], unplayed: 'rgba(80, 88, 116, 0.32)' },
  };
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const engine = new AudioEngine();
rig.player = engine;
const root = document.getElementById('stage');
const mixer = (() => {
  try {
    return JSON.parse(localStorage.getItem('stagehand.mixer') || '{}');
  } catch (_) {
    return {};
  }
})();
mixer.stems = mixer.stems || {};
engine.master = mixer.master ?? 0.85;
const saveMixer = () => {
  try {
    localStorage.setItem('stagehand.mixer', JSON.stringify(mixer));
  } catch (_) {}
};

// ------------------------------------------------- per-song mix memory --
// { you, song, stems: { name: { v, on } } } in the song's user data. Solo isn't kept.
const forget = new Set((() => {
  try {
    return JSON.parse(localStorage.getItem('stagehand.mixForget') || '[]');
  } catch (_) {
    return [];
  }
})());
export function remembersMix(id) {
  return !forget.has(id);
}
export function setRemembersMix(id, on) {
  if (on) forget.delete(id);
  else forget.add(id);
  try {
    localStorage.setItem('stagehand.mixForget', JSON.stringify([...forget].slice(-500)));
  } catch (_) {}
  if (on) saveMixSoon(true);
}
let mixTimer = null;
function saveMixSoon(now) {
  clearTimeout(mixTimer);
  const song = S.song;
  if (!song || !S.mix || !remembersMix(song.id)) return;
  const go = () => api.songs.setUser(song.id, { mix: S.mix }).then((x) => x && upsertSongs([x])).catch(() => {});
  if (now) go();
  else mixTimer = setTimeout(go, 700);
}
function rememberMix(patch) {
  if (!S.song) return;
  S.mix = S.mix || { stems: {} };
  Object.assign(S.mix, patch);
  saveMixSoon();
}
/** The whole song's level (0–1), shared by every mix panel. */
export function songLevel() {
  return Number(vol.value);
}
export function setSongLevel(v) {
  vol.value = String(Math.max(0, Math.min(1, Number(v) || 0)));
  vol.dispatchEvent(new Event('input'));
}
export function setYou(v) {
  rig.setKnob('volume', v);
  rememberMix({ you: Number(v) });
}
function stemPref(name) {
  const p = (S.mix && S.mix.stems && S.mix.stems[name]) || {};
  return { volume: p.v ?? 0.8, muted: p.on === false, solo: !!(S.solo && S.solo[name]) };
}

const S = {
  song: null,
  mix: null,
  solo: {},
  token: 0,
  info: null,
  duration: 0,
  view: { start: 0, end: 1 },
  follow: true,
  loop: null,
  stems: [], // loaded stem names in lane order
  stemNames: [], // lanes shown
  status: { state: 'none' },
  loading: false,
  error: null,
  hoverX: null,
  hoverSection: null,
  sectionHits: [],
  levels: new Map(),
  spectrum: {},
  dragging: null,
  rafPending: false,
  lastTimecode: '',
};

// ---------------------------------------------------------------- head --
// Now playing (Stagehand 3): header, the song view with a practice panel on
// the right, and the transport along the bottom.
const head = h('div.np-head');
const backBtn = h('button.btn.soft.np-back', { type: 'button', title: 'Back (Esc)', html: `${icon('back')}<span>Songs</span>` });
const np = h('div.np', null, h('div.thumb', { html: icon('music') }), h('div.np-text', null, h('div.np-title', { text: '' }), h('div.np-artist', { text: '' })));
const partChips = h('div.np-parts', { role: 'group', 'aria-label': 'Part' });
const viewSeg = h('div.gseg.np-views', { role: 'group', 'aria-label': 'What you see' });
const tabViewBtn = h('button', { type: 'button', html: `${icon('tuning')}<span>Tab</span>`, title: 'Tab to play along with (T)' });
const hwBtn = h('button', { type: 'button', html: `${icon('play')}<span>Highway</span>`, title: 'Note highway, full screen (H)' });
const waveViewBtn = h('button', { type: 'button', html: `${icon('split')}<span>Waveform</span>`, title: 'Waveforms and stem lanes (T)' });
viewSeg.append(tabViewBtn, hwBtn, waveViewBtn);
const guitarPill = h('div.np-guitar');
head.append(backBtn, np, partChips, h('span.grow'), viewSeg, guitarPill);

const prevBtn = h('button.icon-btn', { type: 'button', title: 'Previous song', html: icon('prev') });
const playBtn = h('button.round-play', { type: 'button', title: 'Play (Space)', html: icon('play'), disabled: true });
const nextBtn = h('button.icon-btn', { type: 'button', title: 'Next song', html: icon('next') });
const loopBtn = h('button.icon-btn', { type: 'button', title: 'Loop the current section (L)', html: icon('loop') });
const timecode = h('div.timecode', null, h('span.now', { text: '0:00.0' }), h('span.total', { text: ' / 0:00' }));
const transport = h('div.transport', null, prevBtn, playBtn, nextBtn, loopBtn, timecode);
const scrub = h('canvas.np-scrub', { 'aria-label': 'Song position' });
const speedSeg = h('div.gseg.np-speed', { role: 'group', 'aria-label': 'Practice speed' });
const recBtn = h('button.btn.soft.np-rec', { type: 'button', title: 'Record what you play (your guitar, through your tone)' });
const foot = h('div.np-foot', null, transport, scrub, h('span.np-label', { text: 'Speed' }), speedSeg, recBtn);

// kept for the Mix panel
const modeSeg = h('div.gseg', { role: 'group', 'aria-label': 'What you hear' });
const mixModeBtn = h('button', { type: 'button', text: 'Original mix', title: 'Hear the original song (M)' });
const stemModeBtn = h('button', { type: 'button', text: 'Stems', title: 'Hear the stems, with your mix (M)', disabled: true });
modeSeg.append(mixModeBtn, stemModeBtn);
const volIcon = h('button.icon-btn', { type: 'button', title: 'Mute the song', html: icon('volume') });
const vol = h('input.glow-range', { type: 'range', min: '0', max: '1', step: '0.001', value: String(engine.master), 'aria-label': 'Song level' });
const spectrum = h('canvas.spectrum', { 'aria-hidden': 'true', hidden: true });

const body = h('div.stage-body');
const tabHost = h('div.tab-view', { hidden: true });
const scoreLine = h('div.np-score');
const mainCol = h('div.np-main', null, body, tabHost, scoreLine);
const panel = h('aside.np-panel', { 'aria-label': 'Practice panel' });
root.append(head, h('div.np-center', null, mainCol, panel), foot);

backBtn.onclick = () => setPage(state.backPage && state.backPage !== 'now' ? state.backPage : 'songs');
prevBtn.onclick = () => actions.playAdjacent(-1);
nextBtn.onclick = () => actions.playAdjacent(1);
playBtn.onclick = () => toggle();
loopBtn.onclick = () => toggleSectionLoop();
mixModeBtn.onclick = () => setMode('mix');
stemModeBtn.onclick = () => setMode('stems');
let preMute = null;
vol.addEventListener('input', () => {
  engine.setMaster(Number(vol.value));
  mixer.master = Number(vol.value);
  preMute = null;
  vol.style.setProperty('--p', `${Math.round(Number(vol.value) * 100)}%`);
  volIcon.innerHTML = icon(Number(vol.value) > 0 ? 'volume' : 'volumeOff');
  saveMixer();
  rememberMix({ song: Number(vol.value) });
});
volIcon.onclick = () => {
  if (preMute === null) {
    preMute = Number(vol.value) || 0.85;
    vol.value = '0';
  } else {
    vol.value = String(preMute);
    preMute = null;
  }
  vol.dispatchEvent(new Event('input'));
};

function paintFader(input, value, max, color) {
  input.style.setProperty('--pct', `${(value / max) * 100}%`);
  input.style.setProperty('--fill', color);
}
vol.style.setProperty('--p', `${Math.round(engine.master * 100)}%`);

// --------------------------------------------------------------- lanes --
const lanes = new Map(); // name -> {head, lane, canvas, wave, index, fader, db, m, s}
let ruler;
let rulerCanvas;
let beamCanvas;
let stemsCall;
let hoverLabel;
let loopTag;

function trackIndex(name) {
  return name === 'mix' ? 0 : 1 + STEM_ORDER.indexOf(name);
}

function modelStems() {
  const models = (state.info && state.info.models) || {};
  const m = (state.settings && state.settings.stems.model) || 'htdemucs_6s';
  const list = (models[m] && models[m].stems) || STEM_ORDER;
  return STEM_ORDER.filter((n) => list.includes(n));
}

const appEl = document.getElementById('app');

function buildBody() {
  body.innerHTML = '';
  lanes.clear();
  appEl.classList.toggle('idle', !S.song);
  if (!S.song) {
    body.classList.add('no-stems');
    body.append(
      h(
        'div.stage-empty',
        null,
        h('div', null, h('b', { text: 'Pick a song to hear it here' }), 'Double-click any song to play along on the highway, or press ▶ on it to just listen.')
      )
    );
    return;
  }
  const names = S.stems.length ? S.stems : modelStems();
  S.stemNames = names;
  body.classList.remove('no-stems');
  body.style.setProperty('--stem-rows', String(names.length));

  const rh = h('div.ruler-head');
  rh.append(h('span', { text: S.song.sections && S.song.sections.length ? 'Sections' : 'Timeline' }));
  loopTag = h('span.loop-tag', { hidden: true });
  rh.append(loopTag);
  const zoom = h('div.zoom');
  const zOut = h('button.icon-btn', { type: 'button', title: 'Zoom out (-)', html: icon('zoomOut') });
  const zIn = h('button.icon-btn', { type: 'button', title: 'Zoom in (+)', html: icon('zoomIn') });
  const zFit = h('button.icon-btn', { type: 'button', title: 'Show whole song (0)', html: icon('fit') });
  zOut.onclick = () => zoomBy(1.6);
  zIn.onclick = () => zoomBy(1 / 1.6);
  zFit.onclick = () => fit();
  zoom.append(zOut, zIn, zFit);
  rh.append(zoom);
  ruler = h('div.ruler', { title: 'Click a section to jump there. Double-click to loop it. Drag to loop any range.' });
  rulerCanvas = h('canvas');
  ruler.append(rulerCanvas);
  body.append(rh, ruler);

  addLane('mix', 2);
  names.forEach((n, i) => addLane(n, 3 + i));

  const beam = h('div.beam');
  beamCanvas = h('canvas');
  beam.append(beamCanvas);
  body.append(beam);
  stemsCall = h('div.stems-call', { hidden: true });
  body.append(stemsCall);
  hoverLabel = h('div.hover-time', { hidden: true });
  body.append(hoverLabel);
  wireTimeline();
  updateLoopTag();
  layout();
}

function addLane(name, row) {
  const isMix = name === 'mix';
  const index = trackIndex(name);
  const headEl = h(`div.lane-head${isMix ? '.mix' : ''}`, { style: { gridRow: String(row) } });
  const gel = h('span.gel');
  gel.style.setProperty('--gel', isMix ? 'var(--tungsten)' : GEL[name][1]);
  const label = h('span.lane-name', { text: isMix ? 'Full mix' : STEM_LABEL[name] });
  const lane = h(`div.lane${isMix ? '.mix' : ''}`, { style: { gridRow: String(row) } });
  lane.style.setProperty('--gel', isMix ? '#ffb547' : GEL[name][1]);
  lane.style.setProperty('--delay', `${(row - 3) * -0.32}s`);
  const canvas = h('canvas');
  lane.append(canvas);
  const wave = new WaveLane(canvas, isMix ? MIX_PALETTE : stemPalette(name));
  const rec = { name, index, head: headEl, lane, canvas, wave, gel };
  if (isMix) {
    rec.note = h('div.mix-note', { text: 'The original song audio' });
    headEl.append(gel, h('div.lbl', null, label, rec.note));
  } else {
    const pref = stemPref(name);
    const t = engine.tracks[index] || {};
    const volume = pref.volume ?? t.volume ?? 0.8;
    const ms = h('div.ms');
    const m = h('button.m', { type: 'button', text: 'M', title: `Mute ${STEM_LABEL[name]}`, 'aria-pressed': String(!!pref.muted) });
    const s = h('button.s', { type: 'button', text: 'S', title: `Solo ${STEM_LABEL[name]}`, 'aria-pressed': String(!!pref.solo) });
    ms.append(m, s);
    const fader = h('input.fader', { type: 'range', min: '0', max: '1', step: '0.001', value: String(volume), 'aria-label': `${STEM_LABEL[name]} volume` });
    const db = h('span.lane-db');
    headEl.append(gel, h('div.lbl', null, label, db), fader, ms);
    rec.fader = fader;
    rec.db = db;
    rec.m = m;
    rec.s = s;
    if (engine.tracks[index]) Object.assign(engine.tracks[index], { volume, muted: !!pref.muted, solo: !!pref.solo });
    m.onclick = () => setStem(name, { muted: !(engine.tracks[index] || pref).muted });
    s.onclick = () => setStem(name, { solo: !(engine.tracks[index] || pref).solo });
    fader.addEventListener('input', () => setStem(name, { volume: Number(fader.value) }));
    fader.addEventListener('dblclick', () => {
      fader.value = '0.8';
      setStem(name, { volume: 0.8 });
    });
    headEl.addEventListener('wheel', (e) => {
      if (e.target !== fader) return;
      e.preventDefault();
      const v = Math.max(0, Math.min(1, Number(fader.value) - Math.sign(e.deltaY) * 0.02));
      fader.value = String(v);
      setStem(name, { volume: v });
    });
  }
  body.append(headEl, lane);
  lanes.set(name, rec);
  refreshLane(rec);
}

function setStem(name, patch) {
  const index = trackIndex(name);
  if ('solo' in patch) S.solo = { ...S.solo, [name]: !!patch.solo };
  if ('volume' in patch || 'muted' in patch) {
    S.mix = S.mix || { stems: {} };
    S.mix.stems = S.mix.stems || {};
    const cur = S.mix.stems[name] || { v: 0.8, on: true };
    S.mix.stems[name] = { v: 'volume' in patch ? Number(patch.volume) : cur.v, on: 'muted' in patch ? !patch.muted : cur.on };
    saveMixSoon();
  }
  if (engine.tracks[index]) engine.setTrack(index, patch);
  if (engine.mode !== 'stems' && S.stems.length && ('muted' in patch || 'solo' in patch || 'volume' in patch)) setMode('stems');
  lanes.forEach(refreshLane);
  requestDraw();
}

function refreshLane(rec) {
  if (rec.name === 'mix') {
    const live = engine.effectiveGain(0) > 0 || !S.stems.length;
    rec.wave.dimmed = S.stems.length > 0 && engine.mode === 'stems';
    rec.head.classList.toggle('off', !live);
    rec.lane.classList.toggle('off', !live);
    rec.note.textContent = S.stems.length ? (engine.mode === 'stems' ? 'Muted while the stem mixer plays' : 'The original song audio') : 'The original song audio';
    return;
  }
  const t = engine.tracks[rec.index] || {};
  const pref = stemPref(rec.name);
  const volume = t.volume ?? pref.volume ?? 0.8;
  const muted = !!(t.muted ?? pref.muted);
  const solo = !!(t.solo ?? pref.solo);
  rec.m.setAttribute('aria-pressed', String(muted));
  rec.s.setAttribute('aria-pressed', String(solo));
  if (Number(rec.fader.value) !== volume) rec.fader.value = String(volume);
  const loaded = S.stems.includes(rec.name);
  const audible = loaded && engine.effectiveGain(rec.index) > 0;
  const db = AudioEngine.faderDb(volume);
  rec.db.textContent = db === -Infinity ? '-∞ dB' : `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
  paintFader(rec.fader, volume, 1, audible ? GEL[rec.name][1] : '#4a5068');
  rec.head.classList.toggle('off', !audible);
  rec.lane.classList.toggle('off', loaded && !audible);
  rec.wave.dimmed = !audible;
  rec.wave.gain = loaded ? AudioEngine.faderGain(volume) : 1;
}

function layout() {
  for (const rec of lanes.values()) rec.wave.resize();
  if (rulerCanvas) sizeCanvas(rulerCanvas);
  if (beamCanvas) sizeCanvas(beamCanvas);
  sizeCanvas(spectrum);
  requestDraw();
}

function sizeCanvas(c) {
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr));
  const hh = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== hh) {
    c.width = w;
    c.height = hh;
  }
}

new ResizeObserver(() => layout()).observe(root);

// ------------------------------------------------------------ timeline --
function span() {
  return S.view.end - S.view.start;
}
function timeAtX(clientX) {
  const r = (lanes.get('mix') || {}).lane?.getBoundingClientRect();
  if (!r) return 0;
  return S.view.start + ((clientX - r.left) / r.width) * span();
}
function setView(start, end) {
  const d = S.duration || 1;
  let w = Math.max(1.5, Math.min(d, end - start));
  let s = Math.max(0, Math.min(d - w, start));
  S.view = { start: s, end: s + w };
  requestDraw();
}
function zoomBy(f, centerT) {
  if (!S.duration) return;
  const c = centerT ?? (engine.playing ? engine.position : (S.view.start + S.view.end) / 2);
  const w = span() * f;
  const rel = (c - S.view.start) / span();
  setView(c - w * rel, c - w * rel + w);
  S.follow = true;
}
function fit() {
  setView(0, S.duration);
  S.follow = true;
}

function seek(t) {
  if (!S.duration) return;
  engine.seek(Math.max(0, Math.min(S.duration, t)));
  requestDraw();
}

function wireTimeline() {
  const col = body;
  const onLaneArea = (e) => e.target.closest && e.target.closest('.lane');
  col.addEventListener('mousemove', (e) => {
    if (!onLaneArea(e) && !S.dragging) {
      if (S.hoverX !== null) {
        S.hoverX = null;
        hoverLabel.hidden = true;
        requestDraw();
      }
      return;
    }
    const r = lanes.get('mix').lane.getBoundingClientRect();
    const x = e.clientX - r.left;
    S.hoverX = x;
    const t = timeAtX(e.clientX);
    hoverLabel.hidden = false;
    hoverLabel.textContent = fmtTime(t, true);
    hoverLabel.style.left = `${236 + x}px`;
    if (S.dragging === 'seek') seek(t);
    requestDraw();
  });
  col.addEventListener('mouseleave', () => {
    S.hoverX = null;
    hoverLabel.hidden = true;
    requestDraw();
  });
  col.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !onLaneArea(e)) return;
    S.dragging = 'seek';
    seek(timeAtX(e.clientX));
    const up = () => {
      S.dragging = null;
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mouseup', up);
  });
  col.addEventListener(
    'wheel',
    (e) => {
      if (!onLaneArea(e) && !e.target.closest('.ruler')) return;
      if (e.ctrlKey) {
        e.preventDefault();
        zoomBy(e.deltaY > 0 ? 1.25 : 0.8, timeAtX(e.clientX));
        S.follow = false;
      } else if (span() < S.duration - 0.01 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
        e.preventDefault();
        const d = (e.deltaX || e.deltaY) / 600;
        setView(S.view.start + d * span(), S.view.end + d * span());
        S.follow = false;
      }
    },
    { passive: false }
  );

  // Ruler: sections, loop dragging
  let rulerDrag = null;
  ruler.addEventListener('mousemove', (e) => {
    const r = ruler.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const hit = y <= 18 ? S.sectionHits.find((s) => x >= s.x0 && x <= s.x1) : null;
    const idx = hit ? hit.i : null;
    if (idx !== S.hoverSection) {
      S.hoverSection = idx;
      requestDraw();
    }
    if (rulerDrag) {
      const t = timeAtX(e.clientX);
      const a = Math.min(rulerDrag.t0, t);
      const b = Math.max(rulerDrag.t0, t);
      if (Math.abs(e.clientX - rulerDrag.x0) > 4) {
        rulerDrag.moved = true;
        setLoop({ start: a, end: b });
      }
    }
  });
  ruler.addEventListener('mouseleave', () => {
    S.hoverSection = null;
    requestDraw();
  });
  ruler.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    rulerDrag = { t0: timeAtX(e.clientX), x0: e.clientX, moved: false, y: e.clientY - ruler.getBoundingClientRect().top };
    const up = () => {
      window.removeEventListener('mouseup', up);
      const d = rulerDrag;
      rulerDrag = null;
      if (!d || d.moved) return;
      const hit = d.y <= 18 && S.hoverSection !== null ? S.song.sections[S.hoverSection] : null;
      seek(hit ? hit.start : d.t0);
    };
    window.addEventListener('mouseup', up);
  });
  ruler.addEventListener('dblclick', (e) => {
    const t = timeAtX(e.clientX);
    const sec = (S.song.sections || []).find((s) => t >= s.start && t < s.end);
    if (sec) {
      setLoop({ start: sec.start, end: sec.end, label: sec.label });
      seek(sec.start);
    }
  });
}

function setLoop(loop) {
  S.loop = loop && loop.end - loop.start > 0.1 ? loop : null;
  engine.setLoop(S.loop);
  loopBtn.classList.toggle('on', !!S.loop);
  updateLoopTag();
  drawScrub();
  emit('stage-loop', S.loop);
  requestDraw();
}

function updateLoopTag() {
  if (!loopTag) return;
  if (!S.loop) {
    loopTag.hidden = true;
    return;
  }
  loopTag.hidden = false;
  loopTag.innerHTML = `<span>${esc(S.loop.label || `${fmtTime(S.loop.start, true)} to ${fmtTime(S.loop.end, true)}`)}</span>`;
  const x = h('button', { type: 'button', title: 'Stop looping', html: icon('x') });
  x.onclick = () => setLoop(null);
  loopTag.append(x);
}

export function toggleSectionLoop() {
  if (S.loop) return setLoop(null);
  const t = engine.position;
  const sec = (S.song && S.song.sections ? S.song.sections : []).find((s) => t >= s.start && t < s.end);
  if (sec) setLoop({ start: sec.start, end: sec.end, label: sec.label });
  else if (S.duration) setLoop({ start: t, end: Math.min(S.duration, t + 8) });
}

// -------------------------------------------------------------- drawing --
const RULER_COLORS = {
  sectionA: 'rgba(42, 51, 80, 0.75)',
  sectionB: 'rgba(36, 44, 68, 0.75)',
  sectionHover: 'rgba(60, 70, 104, 0.95)',
  sectionActive: 'rgba(255, 181, 71, 0.2)',
  sectionText: '#a3aac2',
  sectionActiveText: '#ffc978',
  tick: 'rgba(163, 170, 194, 0.35)',
  tickText: '#6e7693',
  loop: 'rgba(255, 181, 71, 0.16)',
  loopEdge: 'rgba(255, 181, 71, 0.8)',
  playhead: '#ffc978',
};
const BEAM_COLORS = { core: '#ffd9a0', hover: 'rgba(236, 238, 246, 0.22)' };
const SPECTRUM_COLORS = { top: '#ffc978', bottom: 'rgba(255, 122, 69, 0.55)' };

function smoothLevel(key, v) {
  const prev = S.levels.get(key) || 0;
  const next = v > prev ? prev + (v - prev) * 0.55 : prev + (v - prev) * 0.12;
  S.levels.set(key, next);
  return next;
}

function frame() {
  S.rafPending = false;
  if (!S.song || !lanes.size) return;
  // Under the full-screen highway nothing here is visible: drawing the stem
  // lanes, waveform and spectrum every frame only stole time from it (lag).
  if (document.getElementById('app').classList.contains('under-highway')) return;
  drawScrub();
  const t = engine.position;
  const playing = engine.playing;
  let animating = false;
  if (tabView && tabView.visible) {
    // The tab draws itself; keep the clock and spectrum going here.
    if (drawSpectrum(spectrum, playing ? engine.spectrum() : null, engine.sampleRate || 48000, S.spectrum, SPECTRUM_COLORS)) animating = true;
    const tc = fmtTime(t, true);
    if (tc !== S.lastTimecode) {
      timecode.firstChild.textContent = tc;
      S.lastTimecode = tc;
    }
    if (playing || animating) requestDraw();
    return;
  }

  if (playing && S.follow && span() < S.duration - 0.01) {
    const s = span();
    if (t < S.view.start || t > S.view.start + s * 0.62) setView(t - s * 0.3, t - s * 0.3 + s);
  }

  const master = smoothLevel('master', engine.masterLevel());
  for (const rec of lanes.values()) {
    const lvl = smoothLevel(rec.name, engine.level(rec.index));
    rec.gel.style.setProperty('--glow', String(Math.min(0.9, lvl * 3.2).toFixed(3)));
    if (rec.wave.draw(S.view, t, { level: lvl, beam: playing })) animating = true;
    if (lvl > 0.002) animating = true;
  }
  if (beamCanvas) {
    const W = beamCanvas.width;
    const x = S.duration ? ((t - S.view.start) / span()) * W : null;
    const dpr = window.devicePixelRatio || 1;
    const loopPx = S.loop ? [((S.loop.start - S.view.start) / span()) * W, ((S.loop.end - S.view.start) / span()) * W] : null;
    drawBeam(beamCanvas, x, playing ? master : 0, S.hoverX === null ? null : S.hoverX * dpr, BEAM_COLORS, loopPx);
  }
  if (rulerCanvas) {
    S.sectionHits = drawRuler(rulerCanvas, {
      view: S.view,
      sections: S.song.sections,
      loop: S.loop,
      hoverSection: S.hoverSection,
      t,
      colors: RULER_COLORS,
      duration: S.duration,
    });
  }
  if (drawSpectrum(spectrum, playing ? engine.spectrum() : null, engine.sampleRate || 48000, S.spectrum, SPECTRUM_COLORS)) animating = true;

  const tc = fmtTime(t, true);
  if (tc !== S.lastTimecode) {
    timecode.firstChild.textContent = tc;
    S.lastTimecode = tc;
  }
  if (playing || animating || S.dragging) requestDraw();
}

// ------------------------------------------------------------- scrubber --
const SC = { bins: null, for: null, hover: null };
function drawScrub() {
  if (!S.song || !root.offsetParent) return;
  const peaks = S.mixPeaks;
  if (peaks && SC.for !== peaks) {
    SC.bins = overview(peaks, 900);
    SC.for = peaks;
  }
  if (!peaks) SC.bins = null;
  const d = S.duration || 1;
  drawBars(scrub, SC.bins, engine.position / d, { loop: S.loop ? [S.loop.start / d, S.loop.end / d] : null, hover: SC.hover });
}
scrub.addEventListener('mousemove', (e) => {
  const r = scrub.getBoundingClientRect();
  SC.hover = (e.clientX - r.left) / r.width;
  drawScrub();
});
scrub.addEventListener('mouseleave', () => {
  SC.hover = null;
  drawScrub();
});
scrub.addEventListener('mousedown', (e) => {
  const r = scrub.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * (S.duration || 0));
  const move = (ev) => seek(((ev.clientX - r.left) / r.width) * (S.duration || 0));
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

export function requestDraw() {
  if (S.rafPending) return;
  S.rafPending = true;
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------- loading --
function setHead(song) {
  const thumb = np.querySelector('.thumb');
  thumb.innerHTML = '';
  if (song && song.art) {
    const img = h('img', { src: api.artUrl(song, 128), alt: '' });
    img.onerror = () => (thumb.innerHTML = icon('music'));
    thumb.append(img);
  } else thumb.innerHTML = icon('music');
  np.querySelector('.np-title').textContent = song ? song.title : 'Nothing playing';
  np.querySelector('.np-artist').textContent = song ? song.artist : 'Double-click a song to open it here';
  np.classList.toggle('idle', !song);
  timecode.lastChild.textContent = ` / ${fmtTime(song ? song.length : 0)}`;
}

function setPlayIcon() {
  if (playBtn.dataset.pl !== String(!!engine.playing)) {
    playBtn.dataset.pl = String(!!engine.playing);
    playBtn.innerHTML = icon(engine.playing ? 'pause' : 'play');
  }
  drawScrub();
  playBtn.title = engine.playing ? 'Pause (Space)' : 'Play (Space)';
  state.playing = engine.playing;
  emit('playing');
}

engine.addEventListener('state', () => {
  setPlayIcon();
  requestDraw();
});
engine.addEventListener('ended', () => {
  const s = state.settings;
  if (s && s.playback.endAction === 'next') actions.playAdjacent(1);
});
engine.addEventListener('mix', () => lanes.forEach(refreshLane));

function showLoadingState(msg) {
  const mix = lanes.get('mix');
  if (mix) mix.note.textContent = msg;
}

export async function load(song, { autoplay = true } = {}) {
  const token = ++S.token;
  engine.pause();
  stopWaiting();
  S.song = song;
  const um = song.user && song.user.mix;
  S.mix = { you: um && um.you != null ? um.you : null, song: um && um.song != null ? um.song : null, stems: { ...((um && um.stems) || {}) } };
  S.solo = {};
  S.info = null;
  S.stems = [];
  S.loop = null;
  S.error = null;
  S.duration = song.length || 0;
  S.view = { start: 0, end: Math.max(1, S.duration) };
  S.follow = true;
  S.status = state.stems.get(song.id) || { state: song.hasStems ? 'ready' : 'none' };
  state.nowPlaying = song.id;
  S.mixPeaks = null;
  emit('playing');
  emit('stage-song');
  setHead(song);
  if (tabView) tabView.setSong(song);
  if (highway) highway.songChanged(song);
  loopBtn.classList.remove('on');
  playBtn.disabled = true;
  stemModeBtn.disabled = true;
  buildBody();
  showLoadingState('Decoding audio…');
  lanes.get('mix').lane.classList.add('scanning');
  try {
    let info;
    try {
      info = await api.audio.prepare(song.id);
    } catch (err) {
      if (err.code === 'NEED_VGMSTREAM') {
        if (token !== S.token) return;
        return showDecoderPrompt(song, autoplay);
      }
      throw err;
    }
    if (token !== S.token) return;
    S.info = info;
    showLoadingState('Drawing waveform…');
    const data = await loadTrackData(info.url);
    if (token !== S.token) return;
    await engine.reset(info.sampleRate, info.frames);
    const songLevel = S.mix.song ?? mixer.master ?? 0.85;
    engine.setMaster(songLevel);
    vol.value = String(songLevel);
    vol.style.setProperty('--p', `${Math.round(songLevel * 100)}%`);
    if (S.mix.you != null) rig.setKnob('volume', S.mix.you);
    for (const name of STEM_ORDER) {
      const pref = stemPref(name);
      Object.assign(engine.tracks[trackIndex(name)], { volume: pref.volume, muted: pref.muted, solo: false });
    }
    engine.loadTrack(0, 'mix', data.buffer, data.wav);
    S.duration = info.duration;
    S.view = { start: 0, end: S.duration };
    engine.setMode('mix');
    timecode.lastChild.textContent = ` / ${fmtTime(S.duration)}`;
    const mix = lanes.get('mix');
    mix.lane.classList.remove('scanning');
    mix.wave.setPeaks(data.peaks, S.duration);
    S.mixPeaks = data.peaks;
    refreshLane(mix);
    playBtn.disabled = false;
    emit('stage-loaded');
    if (autoplay) {
      // with stems on the way, start once they're in, so the mix doesn't change under you
      if (await stemsFirst(song, token)) startWaiting(token);
      else await engine.play();
    }
    api.songs
      .played(song.id)
      .then((s) => s && upsertSongs([s]))
      .catch(() => {});
    requestDraw();
    await loadStems(token);
  } catch (err) {
    if (token !== S.token) return;
    S.error = err.message;
    emit('stage-error', { id: song.id, message: err.message });
    const mix = lanes.get('mix');
    if (mix) {
      mix.lane.classList.remove('scanning');
      mix.note.textContent = '';
      mix.note.append(h('span.stage-error', { text: `Could not play this song. ${err.message}` }));
    }
  }
}

async function loadStems(token, { switchMode = true } = {}) {
  const song = S.song;
  let st;
  try {
    st = await api.stems.status(song.id);
  } catch (_) {
    st = { state: 'none' };
  }
  if (token !== S.token) return;
  state.stems.set(song.id, st);
  S.status = st;
  if (st.state === 'ready') {
    const names = STEM_ORDER.filter((n) => st.stems.some((x) => x.name === n));
    S.stems = [];
    // rebuild lanes for the stems that exist, keeping the mix lane's peaks
    const mixPeaks = lanes.get('mix').wave.peaks;
    S.stems = names; // lanes are built for these names
    buildBody();
    S.stems = [];
    lanes.get('mix').wave.setPeaks(mixPeaks, S.duration);
    lanes.get('mix').wave.revealAt = 0;
    S.loadingStems = true;
    renderStemsCall();
    for (const n of names) {
      const url = st.stems.find((x) => x.name === n).url;
      try {
        let data;
        try {
          data = await loadTrackData(url, undefined, { rate: engine.sampleRate, frames: engine.frames });
        } catch (e) {
          // the stems may have just been converted: ask where they are now and try once more
          const fresh = await api.stems.status(song.id);
          const f = fresh && fresh.stems && fresh.stems.find((x) => x.name === n);
          if (!f || f.url === url) throw e;
          data = await loadTrackData(f.url, undefined, { rate: engine.sampleRate, frames: engine.frames });
        }
        if (token !== S.token) return;
        if (data.wav.frames !== engine.frames || data.wav.sampleRate !== engine.sampleRate) {
          throw new Error('Stem length does not match the song; separate stems again');
        }
        engine.loadTrack(trackIndex(n), n, data.buffer, data.wav);
        S.stems.push(n);
        const rec = lanes.get(n);
        rec.lane.classList.remove('scanning');
        rec.wave.setPeaks(data.peaks, S.duration);
        refreshLane(rec);
      } catch (err) {
        lanes.get(n).lane.classList.remove('scanning');
        toast({ title: `Could not load the ${STEM_LABEL[n].toLowerCase()} stem`, message: err.message, kind: 'err' });
      }
    }
    S.loadingStems = false;
    stemModeBtn.disabled = !S.stems.length;
    const prefer = state.settings ? state.settings.stems.preferStems !== false : true;
    if (switchMode && prefer && S.stems.length) setMode('stems');
    else setMode(engine.mode);
    renderStemsCall();
    if (tabView) tabView.stemsChanged();
    if (highway) highway.stemsChanged();
    requestDraw();
    if (S.waitPlay === token) {
      stopWaiting();
      await engine.play();
    }
    return;
  }
  if (st.state === 'none' && state.settings && state.settings.stems.auto && (await actions.engineReady())) {
    await actions.requestStems([song.id]);
    await api.stems.prioritize(song.id).catch(() => {});
    S.status = state.stems.get(song.id) || st;
  }
  renderStemsCall();
}

/** The open song's stems were re-stored losslessly (WAV → FLAC): same audio, new files. */
export async function stemsMoved() {
  if (!S.song) return;
  const token = S.token;
  try {
    const st = await api.stems.status(S.song.id);
    if (token !== S.token || !st) return;
    state.stems.set(S.song.id, st);
    S.status = st;
  } catch (_) {}
}

export async function reloadStems() {
  if (!S.song) return;
  engine.unloadStems();
  S.stems = [];
  engine.setMode('mix');
  stemModeBtn.disabled = true;
  const mixPeaks = lanes.get('mix') && lanes.get('mix').wave.peaks;
  buildBody();
  if (mixPeaks) {
    lanes.get('mix').wave.setPeaks(mixPeaks, S.duration);
    lanes.get('mix').wave.revealAt = 0;
  }
  await loadStems(S.token, { switchMode: false });
}

function renderStemsCall() {
  if (tabView) tabView.statusChanged();
  if (!stemsCall) return;
  const st = S.status || { state: 'none' };
  const busy = st.state === 'running' || st.state === 'queued';
  for (const n of S.stemNames) {
    const rec = lanes.get(n);
    if (rec) rec.lane.classList.toggle('scanning', busy || (!!S.loadingStems && !S.stems.includes(n)));
  }
  if (S.stems.length || st.state === 'ready') {
    stemsCall.hidden = true;
    return;
  }
  stemsCall.hidden = false;
  const a0 = state.engine && state.engine.advice;
  const pct = Math.round((st.progress || 0) * 100);
  const where = st.deviceName ? (st.device === 'cuda' ? `on your ${st.deviceName}` : 'on your CPU') : '';
  const heading = st.state === 'queued' ? 'Waiting to split this song' : `Splitting instruments${where ? ` ${where}` : ''}, ${pct}%`;
  // Progress ticks only update text, so buttons stay clickable while it runs.
  const key = [st.state, st.device, st.note, a0 && a0.action, state.engine && state.engine.installed].join('|');
  if (busy && stemsCall.dataset.key === key && stemsCall.querySelector('h3')) {
    stemsCall.querySelector('h3').textContent = heading;
    stemsCall.querySelector('.progress').style.setProperty('--p', `${pct}%`);
    return;
  }
  stemsCall.dataset.key = busy ? key : '';
  stemsCall.innerHTML = '';
  const box = h('div.box');
  if (busy) {
    box.append(
      h('h3', { text: heading }),
      h('div.progress', { style: { '--p': `${pct}%` } }, h('i')),
      h('p', { text: st.state === 'queued' ? 'Another song is being separated first.' : st.note || 'You can keep listening to the full mix meanwhile.' })
    );
    const row = h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center' } });
    const a = state.engine && state.engine.advice;
    if (st.device === 'cpu' && a && a.action) {
      box.append(h('p', { text: a.action === 'driver' ? `Your ${a.gpu} could do this much faster once its driver is updated.` : `Your ${a.gpu} could do this many times faster.`, style: { color: 'var(--tungsten-hi)' } }));
      const fix = h('button.btn.small', { type: 'button', text: a.action === 'driver' ? 'Get NVIDIA driver' : 'Switch to GPU' });
      fix.onclick = () => import('./dialogs.js').then((d) => d.fixDevice(a));
      row.append(fix);
    }
    const cancel = h('button.btn.small.ghost', { type: 'button', text: 'Cancel' });
    cancel.onclick = async () => {
      await api.stems.cancel(S.song.id);
    };
    row.append(cancel);
    box.append(row);
  } else if (st.state === 'error') {
    box.append(h('h3', { text: 'Stem separation failed' }), h('p', { text: st.message || 'The engine stopped unexpectedly.' }));
    const retry = h('button.btn', { type: 'button', text: 'Try again' });
    retry.onclick = () => actions.requestStems([S.song.id], { force: true });
    box.append(retry);
  } else if (state.engine && state.engine.installed) {
    box.append(
      h('h3', { text: 'Split this song into instruments' }),
      h('p', { text: 'Each instrument gets its own lane with volume, mute and solo, so you can drop the guitar and play along.' })
    );
    const go = h('button.btn.primary', { type: 'button', html: `${icon('split')}<span>Split stems</span>` });
    go.onclick = () => actions.requestStems([S.song.id]);
    box.append(go);
  } else {
    box.append(
      h('h3', { text: 'Split songs into instruments' }),
      h('p', { text: 'Stagehand can separate guitar, bass, drums, vocals and keys with Demucs, running on your own PC. It needs a one-time download of about 1 to 3 GB.' })
    );
    const go = h('button.btn.primary', { type: 'button', text: 'Set up stem separation' });
    go.onclick = () => actions.requestStems([S.song.id]);
    box.append(go);
  }
  stemsCall.append(box);
}

function showDecoderPrompt(song, autoplay) {
  const mix = lanes.get('mix');
  mix.lane.classList.remove('scanning');
  mix.note.textContent = '';
  stemsCall.hidden = false;
  stemsCall.style.gridRow = '2 / -1';
  stemsCall.innerHTML = '';
  const box = h('div.box');
  box.append(
    h('h3', { text: 'One small download to play Rocksmith audio' }),
    h('p', { text: 'Rocksmith stores songs in a game audio format. Stagehand uses vgmstream (a few MB, open source) to play it. It installs into Stagehand’s own folder.' })
  );
  const prog = h('div.progress', { hidden: true }, h('i'));
  const go = h('button.btn.primary', { type: 'button', text: 'Install audio decoder' });
  const manual = h('button.btn.ghost', { type: 'button', text: 'I have vgmstream-cli' });
  go.onclick = async () => {
    go.disabled = true;
    manual.disabled = true;
    go.innerHTML = '<span class="spin"></span><span>Installing</span>';
    prog.hidden = false;
    const off = api.on('tools:progress', (p) => prog.style.setProperty('--p', `${Math.round((p.value || 0) * 100)}%`));
    try {
      await api.tools.installVgmstream();
      off();
      toast({ title: 'Audio decoder installed' });
      load(song, { autoplay });
    } catch (err) {
      off();
      go.disabled = false;
      manual.disabled = false;
      go.textContent = 'Try again';
      toast({ title: 'Could not install the decoder', message: err.message, kind: 'err' });
    }
  };
  manual.onclick = async () => {
    const p = await api.dialog.pickFile({ title: 'Find vgmstream-cli', filters: [{ name: 'vgmstream-cli', extensions: ['exe', '*'] }] });
    if (!p) return;
    state.settings = await api.settings.set({ tools: { vgmstream: p } });
    load(song, { autoplay });
  };
  box.append(prog, h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '8px' } }, go, manual));
  stemsCall.append(box);
}

// ---------------------------------------------------------------- public --
// ------------------------------------------------- waiting for stems --
const waitBox = h('div.stem-wait', { hidden: true, role: 'status' });
document.body.append(waitBox);

/** Should this song wait for its stems before it starts? Starts splitting it if needed. */
async function stemsFirst(song, token) {
  if (!state.settings || !state.settings.stems || state.settings.stems.waitFirst === false) return false;
  let st;
  try {
    st = await api.stems.status(song.id);
  } catch (_) {
    return false;
  }
  if (token !== S.token) return false;
  if (st.state === 'queued') {
    // it's in line behind another song: this one goes first, now
    await api.stems.prioritize(song.id, { now: true }).catch(() => {});
    return (S.waitStatus = st), token === S.token;
  }
  if (st.state === 'ready' || st.state === 'running') return (S.waitStatus = st), true;
  if (st.state === 'none' && state.engine && state.engine.installed && (await actions.engineReady())) {
    await actions.requestStems([song.id]);
    await api.stems.prioritize(song.id, { now: true }).catch(() => {});
    S.waitStatus = state.stems.get(song.id) || { state: 'queued' };
    return token === S.token;
  }
  return false; // nothing to wait for (no stem engine yet): play the full mix
}

function startWaiting(token) {
  S.waitPlay = token;
  renderWaiting(S.waitStatus || S.status);
  emit('stage-waiting', true);
}

function stopWaiting() {
  if (!S.waitPlay) return;
  S.waitPlay = 0;
  waitBox.hidden = true;
  emit('stage-waiting', false);
}

function renderWaiting(st) {
  if (!S.waitPlay) return;
  st = st || { state: 'queued' };
  const pct = st.state === 'ready' ? 100 : Math.round((st.progress || 0) * 100);
  const title = st.state === 'ready' ? 'Loading the stems' : st.state === 'queued' ? 'Waiting to split the stems' : `Splitting the stems · ${pct}%`;
  const note = st.state === 'queued' ? 'Another song is being split first.' : st.state === 'ready' ? 'Almost there.' : 'Guitar, bass, drums and the rest, so you can mix them. The song starts by itself.';
  if (!waitBox.firstChild) {
    waitBox.innerHTML = `<div class="read-bar"><div class="rb-top"><span class="eq"><i></i><i></i><i></i><i></i></span><span class="rb-label"></span><span class="rb-count"></span></div><div class="rb-track"><i></i></div><div class="rb-note"></div><div class="sw-row"><span class="sw-song"></span></div></div>`;
    const now = h('button.btn.small', { type: 'button', html: `${icon('play')}<span>Play now with the full mix</span>` });
    now.onclick = () => {
      stopWaiting();
      engine.play();
    };
    waitBox.querySelector('.sw-row').append(now);
  }
  waitBox.querySelector('.rb-label').textContent = title;
  waitBox.querySelector('.rb-count').textContent = st.state === 'running' ? `${pct}%` : '';
  waitBox.querySelector('.rb-note').textContent = note;
  waitBox.querySelector('.sw-song').textContent = S.song ? `${S.song.title}${S.song.artist ? ` · ${S.song.artist}` : ''}` : '';
  waitBox.querySelector('.read-bar').classList.toggle('waiting', st.state === 'queued');
  waitBox.querySelector('.rb-track > i').style.width = `${Math.max(2, pct)}%`;
  waitBox.hidden = false;
}

export function waitingForStems() {
  return !!S.waitPlay;
}

export function toggle() {
  if (!S.song || playBtn.disabled) return;
  if (S.waitPlay) {
    // you pressed play while waiting for the stems: play the full mix now
    stopWaiting();
    if (!engine.playing) engine.play();
    return;
  }
  if (!engine.playing) S.follow = true;
  engine.toggle();
}
export function seekBy(d) {
  seek(engine.position + d);
}
export function setMode(mode) {
  if (mode === 'stems' && !S.stems.length) return;
  engine.setMode(mode);
  mixModeBtn.setAttribute('aria-pressed', String(mode === 'mix'));
  stemModeBtn.setAttribute('aria-pressed', String(mode === 'stems'));
  lanes.forEach(refreshLane);
  requestDraw();
}
export function toggleMode() {
  setMode(engine.mode === 'mix' ? 'stems' : 'mix');
}
export function toggleMute(i, solo = false) {
  const name = S.stemNames[i];
  if (!name) return;
  const t = engine.tracks[trackIndex(name)];
  setStem(name, solo ? { solo: !t.solo } : { muted: !t.muted });
}
export function zoom(dir) {
  if (tabView && tabView.visible) return tabView.zoom(dir);
  if (dir === 0) fit();
  else zoomBy(dir > 0 ? 1 / 1.6 : 1.6);
}
export function clearLoop() {
  if (S.loop) setLoop(null);
}
export function current() {
  return S.song;
}
export { engine };
export function duration() {
  return S.duration;
}
export function seekTo(t) {
  seek(t);
}
export function loop() {
  return S.loop;
}
export function mixPeaks() {
  const m = lanes.get('mix');
  return (m && m.wave.peaks) || S.mixPeaks || null;
}
/** The part you're playing (from the tab view), for labels. */
export function partLabel() {
  const t = tabView && tabView.tab;
  if (!t) return '';
  return { lead: 'Lead', rhythm: 'Rhythm', bass: 'Bass', combo: 'Lead' }[t.type] || '';
}
export function setSink(id) {
  rig.setSink(id);
  return engine.setSink(id);
}

// -------------------------------------------------------------- tab view --
let tabView = null;
let stageView = (() => {
  try {
    return localStorage.getItem('stagehand.stageView') === 'wave' ? 'wave' : 'tab';
  } catch (_) {
    return 'tab';
  }
})();

export function setStageView(v) {
  stageView = v === 'tab' ? 'tab' : 'wave';
  try {
    localStorage.setItem('stagehand.stageView', stageView);
  } catch (_) {}
  waveViewBtn.setAttribute('aria-pressed', String(stageView === 'wave'));
  tabViewBtn.setAttribute('aria-pressed', String(stageView === 'tab'));
  hwBtn.setAttribute('aria-pressed', 'false');
  body.hidden = stageView === 'tab';
  if (stageView === 'tab') tabView.show();
  else {
    tabView.hide();
    layout();
  }
  requestDraw();
}

export function toggleTab() {
  setStageView(stageView === 'tab' ? 'wave' : 'tab');
}

waveViewBtn.onclick = () => setStageView('wave');
tabViewBtn.onclick = () => setStageView('tab');

on('stems-update', (u) => {
  if (!S.song || u.songId !== S.song.id) return;
  S.status = u;
  if (S.waitPlay) {
    if (u.state === 'running' || u.state === 'queued' || u.state === 'ready') renderWaiting(u);
    else {
      // split failed or was cancelled: play the full mix
      stopWaiting();
      engine.play();
    }
  }
  if (u.state === 'ready' && !S.stems.length) loadStems(S.token);
  else renderStemsCall();
});
on('library', () => {
  if (!S.song) return;
  const fresh = state.songs.get(S.song.id);
  if (fresh && fresh !== S.song) {
    S.song = { ...fresh, sections: fresh.sections };
    setHead(S.song);
    timecode.lastChild.textContent = ` / ${fmtTime(S.duration || fresh.length)}`;
  }
});
function rebuildKeepingMix() {
  const mix = lanes.get('mix');
  const peaks = mix && mix.wave.peaks;
  buildBody();
  if (peaks) {
    lanes.get('mix').wave.setPeaks(peaks, S.duration);
    lanes.get('mix').wave.revealAt = 0;
    refreshLane(lanes.get('mix'));
  }
  renderStemsCall();
}

let lastModel = null;
on('settings', () => {
  const model = state.settings && state.settings.stems.model;
  if (S.song && !S.stems.length && lastModel && model !== lastModel) rebuildKeepingMix();
  lastModel = model;
});
on('engine', () => {
  if (S.song && !S.stems.length) renderStemsCall();
});

mixModeBtn.setAttribute('aria-pressed', 'true');
stemModeBtn.setAttribute('aria-pressed', 'false');
setHead(null);
buildBody();

tabView = createTabView(tabHost, {
  engine,
  stems: () => S.stems,
  stemStatus: () => S.status,
  setStem: (name, patch) => setStem(name, patch),
  setMode: (m) => setMode(m),
  seek: (t) => seek(t),
  setLoop: (loop) => setLoop(loop),
  requestStems: () => S.song && actions.requestStems([S.song.id]).then(() => api.stems.prioritize(S.song.id).catch(() => {})),
  trackIndex: (name) => trackIndex(name),
  gel: (name) => (GEL[name] || GEL.other)[1],
  label: (name) => STEM_LABEL[name] || name,
});
setStageView(stageView);

// ------------------------------------------------------------- highway --
let highway = null;
export function openHighway() {
  if (!highway)
    highway = createHighway({
      engine,
      songLevel,
      setSongLevel,
      setYou,
      stems: () => S.stems,
      setMode: (m) => setMode(m),
      seek: (t) => seek(t),
      setLoop: (loop) => setLoop(loop),
      getLoop: () => S.loop,
      toggle: () => toggle(),
      setStem: (name, patch) => setStem(name, patch),
      trackIndex: (name) => trackIndex(name),
      gel: (name) => (GEL[name] || GEL.other)[1],
      label: (name) => STEM_LABEL[name] || name,
      stemStatus: () => S.status,
      loadError: () => (S.song && S.error ? { id: S.song.id, message: S.error } : null),
      requestStems: () => S.song && actions.requestStems([S.song.id]).then(() => api.stems.prioritize(S.song.id).catch(() => {})),
      goBack: () => setPage('songs'),
      showView: (v) => setStageView(v),
      onHighwayClosed: () => {
        if (tabView && tabView.visible) tabView.stemsChanged();
        else engine.setPlayAlong(null);
        requestDraw();
        if (tabView && tabView.visible && tabView.redraw) tabView.redraw();
      },
    });
  return highway.open(S.song);
}
export function highwayOpen() {
  return !!(highway && highway.isOpen);
}
hwBtn.onclick = () => openHighway();

// ------------------------------------------- for the Now playing panel --
export const hosts = { panel, partChips, guitarPill, scoreLine, recBtn, speedSeg, modeSeg, vol, volIcon };
export function stems() {
  return S.stems;
}
export function stemNames() {
  return S.stems.length ? S.stems : modelStems();
}
export function stemStatus() {
  return S.status;
}
export function stemVolume(name) {
  const t = engine.tracks[trackIndex(name)];
  const p = stemPref(name);
  return { volume: t && t.loaded ? t.volume : p.volume, muted: t && t.loaded ? !!t.muted : p.muted, solo: !!(t && t.solo) };
}
export { setStem, trackIndex, setLoop as setLoopRange, STEM_LABEL, GEL };
export function requestStemsNow() {
  return S.song && actions.requestStems([S.song.id]).then(() => api.stems.prioritize(S.song.id).catch(() => {}));
}
export function tabViewApi() {
  return tabView;
}
if (typeof window !== 'undefined') window.__stagePlaying = () => engine.playing; // for tests
