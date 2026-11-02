import { APPROACH_UNITS, approachDepth, chordSpan, isChordRepeat } from './highway-layout.js';
/**
 * Note highway: the part coming toward you down a 3D fretboard, Rocksmith
 * style. Low E on top. The camera glides between hand positions, the clock
 * follows speaker time without additional smoothing, notes arrive early and slowly enough to read,
 * and every gem carries a big fret number.
 */
import { visualTime, sustainIndex, firstSustain, noteEnd } from './highway-timing.js';
import { api } from './api.js';
import { h, icon, esc, showMenu, toast, instrumentTag } from './ui.js';
import { rig, TONES } from './rig.js';
import { songToneChoice, saveToneChoice } from './tab.js';
import { tonelib, useTone } from './tonelib.js';
import { bendValue, linkChains, noteTech } from './performance-math.js';
import { createFluidDriver } from './reactive-bg.js';
import { createFeatures } from './music-features.js';
import { createVisuals } from './visuals.js';
import { createPerformanceTools } from './performance-tools.js';
import { VENUES, VENUE_ALIAS, venueThumb, createVenue, createFire } from './venues.js';
import { suggestionFor } from './captures.js';
import { getRealAmp, modelLabel } from './realamps.js';
import { Analyzer, OnsetTracker, Judge, targetsFromTab, tuneShift } from './detect.js';
import { createRenderer3D, col, mix } from './highway3d.js';
import { createFluid } from './fluidbg.js';
import { tuningName, tuningPlan, myTuning, setMyTuning, MY_TUNINGS, MY_TUNINGS_BASS } from './tuning.js';
import { breakdown, cheer } from './scorecard.js';
import { state, on } from './store.js';
import { createClassicHighway } from './highway-classic.js';

const STRING = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];
const STRING_DARK = ['#7a1d27', '#7a5e12', '#164e80', '#7a4515', '#1c6a3c', '#55307f'];
const NAMES6 = ['E', 'A', 'D', 'G', 'B', 'e'];
const NAMES4 = ['E', 'A', 'D', 'G'];
const FONT = "'Archivo', 'Segoe UI', sans-serif";
const SPEEDS = [0.5, 0.6, 0.75, 0.85, 1];

function load() {
  const base = { ahead: 3, flow: 1, lowTop: true, detect: true, venue: 'warehouse', fx: true, v: 36 };
  try {
    const saved = JSON.parse(localStorage.getItem('stagehand.highway') || '{}') || {};
    // 3.6: the 3D highway runs at the game's pace (measured off your videos), so older speed choices start fresh
    if (saved.v !== 36) {
      delete saved.ahead;
      delete saved.flow;
      delete saved.offsetMs;
    }
    return { ...base, ...saved, flow: 1, v: 36 };
  } catch (_) {
    return base;
  }
}
const prefs = load();
const save = () => {
  try {
    localStorage.setItem('stagehand.highway', JSON.stringify(prefs));
  } catch (_) {}
};

function lower(arr, t, key = 't') {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m][key] < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function rr(ctx, x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pretty(name) {
  const n = String(name || '').toLowerCase();
  const map = { noguitar: 'No guitar', prechorus: 'Pre-chorus', postchorus: 'Post-chorus', fadein: 'Fade in', fadeout: 'Fade out', buildup: 'Build-up' };
  return map[n] || (n ? n[0].toUpperCase() + n.slice(1) : '');
}

function webglWorks() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (_) {
    return false;
  }
}

export function createHighway(stage) {
  // no WebGL (very old or broken graphics drivers): the 2D highway instead
  if (prefs.renderer === '2d' || !webglWorks()) return createClassicHighway(stage);
  const H = {
    open: false,
    song: null,
    parts: [],
    tab: null,
    targets: [],
    judge: null,
    raf: 0,
    clock: 0,
    last: 0,
    cam: { x: 10, d: 30, px: 40, ready: false },
    bursts: [],
    hits: [],
    lands: [],
    paused: true,
  };

  // ---------------------------------------------------------------- DOM --
  const root = h('div.highway', { hidden: true, role: 'dialog', 'aria-label': 'Note highway' });
  // the 3D scene on the graphics card, and a 2D layer on top for crisp text
  const glCanvas = h('canvas.hw-canvas.hw-gl');
  const canvas = h('canvas.hw-canvas');
  const top = h('div.hw-top');
  const back = h('button.hw-back', { type: 'button', title: 'Back (Esc)', html: `${icon('chevronLeft')}<span>Back</span>` });
  const titleBox = h('div.hw-title');
  const parts = h('div.hw-parts');
  const playAlong = h('button.hw-chip', { type: 'button' });
  // Stagehand 3: the whole song plays; take your part out in the Mix panel instead.
  playAlong.style.display = 'none';
  // your guitar: one pill, a mute button and the tone (with REAL when a real amp plays)
  const guitarBtn = h('button.hw-rig-mute', { type: 'button' });
  const toneBtn = h('button.hw-chip.hw-rig-tone', { type: 'button', title: 'Tone for your guitar' });
  const rigBox = h('div.hw-rig', null, guitarBtn, toneBtn);
  const mixBtn = h('button.hw-chip', { type: 'button', title: 'Song mix: stem volumes, on and off', html: `${icon('sliders')}<span>Mix</span>` });
  // The song mix docks on the right edge and collapses to a small tab.
  const mixPanel = h('div.hw-mix');
  const mixTab = h('button.hw-dock-tab', { type: 'button', title: 'Master Settings: mix, Drop and tuning, highway options', 'aria-label': 'Master Settings' });
  const dock = h('div.hw-dock', null, mixTab, mixPanel);
  let mixOpen = !!prefs.mixOpen;
  // the Mix button doubled the tab on the right edge: the tab opens the mix now
  const score = h('div.hw-score');
  // the score sits up top (as in the game), leaving the fret numbers under the neck clear
  // switch straight to the Tab or Waveform view of the same song (Back goes to your songs)
  const views = h('div.hw-views', { role: 'group', 'aria-label': 'What you see' });
  const viewBtn = (v, label, ic, title) => {
    const b = h('button', { type: 'button', title, html: `${icon(ic)}<span>${label}</span>`, 'aria-pressed': String(v === 'hw') });
    b.dataset.v = v;
    if (v !== 'hw') b.onclick = () => switchView(v);
    return b;
  };
  views.append(viewBtn('tab', 'Tab', 'tuning', 'Tab view (T)'), viewBtn('hw', 'Highway', 'play', 'Note highway'), viewBtn('wave', 'Waveform', 'split', 'Waveforms and stem lanes'));
  const sections = h('div.hw-sections');
  const bottom = h('div.hw-bottom', { hidden: true }); // 3.9: everything lives in the top bar now
  const playBtn = h('button.hw-play', { type: 'button', title: 'Play / pause (Space)' });
  const time = h('div.hw-time');
  // practice speed: one chip with a menu (keeps the top bar short)
  const speedChip = h('button.hw-chip.hw-speed-chip', { type: 'button', title: 'Practice speed' });
  speedChip.onclick = () => {
    const r = speedChip.getBoundingClientRect();
    showMenu(r.left, r.bottom + 6, SPEEDS.map((sp) => ({ label: sp === 1 ? '100% (full speed)' : `${Math.round(sp * 100)}%`, icon: sp === stage.engine.speed ? 'check' : null, onClick: () => (stage.engine.setSpeed(sp), renderControls()) })));
  };
  const transport = h('div.hw-transport', null, playBtn, time, speedChip);
  top.append(back, titleBox, transport, h('span.grow'), score, h('span.grow'), views, parts, playAlong, rigBox);
  const speed = h('div.hw-speed', { role: 'group', 'aria-label': 'Practice speed' });
  for (const s of SPEEDS) {
    const b = h('button', { type: 'button', text: s === 1 ? '100%' : `${Math.round(s * 100)}%` });
    b.dataset.s = String(s);
    b.onclick = () => {
      stage.engine.setSpeed(s);
      renderControls();
    };
    speed.append(b);
  }
  bottom.append(speed); // (hidden; the speed chip in the top bar is what you use)
  const msg = h('div.hw-msg', { hidden: true });
  // what the song is doing when it isn't playing yet: loading, waiting for stems, or failed (with a way out)
  const statusBox = h('div.hw-status', { hidden: true, role: 'status' });
  const fpsBox = h('div.hw-fps', { hidden: true });
  // lyrics, two lines under the title, the words lighting up as they're sung (as in Rocksmith)
  const lyricsBox = h('div.hw-lyrics', { hidden: true, 'aria-live': 'off' });
  root.append(glCanvas, canvas, top, sections, bottom, msg, statusBox, dock, fpsBox, lyricsBox);
  document.body.append(root);
  root.__hw = H; // for tests
  // practice.js logs your sessions (Progress) from the highway's own score while it's open
  window.__shHighway = { open: () => H.open, judge: () => (prefs.detect && rig.on ? H.judge : null), songId: () => H.song && H.song.id, part: () => (H.tab ? (H.tab.type === 'combo' ? 'lead' : H.tab.type) : null), tab: () => H.tab, targets: () => H.targets, leave: () => leave() };
  const extras = createPerformanceTools({root,top,stage,H,rig});
  const practiceCheckpoint = () => window.__shPractice && window.__shPractice.checkpoint();
  const ctx = canvas.getContext('2d');
  const R3 = createRenderer3D(glCanvas);
  H.r3 = R3; // tests

  let lastInteraction = performance.now();
  const wakeControls = () => { lastInteraction = performance.now(); root.classList.remove('hw-quiet'); };
  root.addEventListener('pointermove', wakeControls);
  root.addEventListener('pointerdown', wakeControls);
  root.addEventListener('focusin', wakeControls);
  document.addEventListener('keydown', () => { if (H.open) wakeControls(); });

  back.onclick = () => leave();
  // Back (and Esc) from the highway go to your song list; Tab/Waveform stay on the song
  function leave() {
    close();
    stage.goBack && stage.goBack();
  }
  function switchView(v) {
    close();
    stage.showView && stage.showView(v);
  }
  playBtn.onclick = () => stage.toggle();
  playAlong.onclick = () => {
    if (!stage.stems().length) return toast({ title: 'Split stems first', message: 'Play along takes your part out of the song, which needs the song’s stems.', kind: 'info' });
    prefs.playAlong = !(prefs.playAlong ?? true);
    save();
    applyPlayAlong();
    renderControls();
  };
  guitarBtn.onclick = async () => {
    // Stagehand 3: the guitar is always on; this mutes it.
    if (rig.on) rig.setMuted(!rig.muted);
    else {
      rig.setSink(stage.engine.sinkId);
      const ok = await rig.start();
      if (ok) applyTone();
      if (!ok && rig.error) toast({ title: 'Couldn’t start your guitar input', message: rig.error, kind: 'err' });
    }
    renderControls();
  };
  // ------------------------------------------------------- options --
  // A small panel instead of a long menu: what you change most, as buttons
  // you can see at a glance. Timing is set by a sync check, not by guessing.
  // 3.9: the options live in the Master Settings pullout, with the mix and the Drop
  const opts = h('div.hw-master-opts');
  function closeOpts() {}
  function seg(label, items, cur, onPick) {
    const row = h('div.hw-opt-row', null, h('span.hw-opt-label', { text: label }));
    const g = h('div.hw-seg');
    for (const [v, t] of items) {
      const b = h('button', { type: 'button', text: t, 'aria-pressed': String(cur === v) });
      b.onclick = () => {
        onPick(v);
        renderOpts();
      };
      g.append(b);
    }
    row.append(g);
    return row;
  }
  function toggle(label, on, onFlip, sub) {
    const b = h('button.hw-opt-toggle', { type: 'button', role: 'switch', 'aria-checked': String(!!on) }, h('span.hw-switch'), h('span', null, h('b', { text: label }), sub ? h('small', { text: sub }) : null));
    b.onclick = () => {
      onFlip();
      renderOpts();
    };
    return b;
  }
  function venuePicker() {
    const cur = VENUE_ALIAS[prefs.venue] || prefs.venue || 'warehouse';
    const grid = h('div.hw-venues');
    for (const v of VENUES) {
      const th = venueThumb(v);
      const b = h('button.hw-venue', { type: 'button', title: v.name, 'aria-pressed': String(cur === v.id) }, th ? h('img', { src: th, alt: '' }) : h(v.scene ? `i.fluid.sc-${v.scene}` : v.fluid ? 'i.fluid' : 'i.plain'), h('span', { text: v.name }));
      b.onclick = () => {
        setPref('venue', v.id);

        renderOpts();
      };
      grid.append(b);
    }
    return h('div.hw-opt-row', null, h('span.hw-opt-label', { text: 'Venue' }), grid);
  }
  function renderOpts() {
    opts.innerHTML = '';
    opts.append(
      h('div.hw-master-sec', { text: 'Highway' }),
      seg('Look ahead', [[2, '2 s'], [2.5, '2.5 s'], [3, '3 s'], [4, '4 s']], prefs.ahead, (v) => setPref('ahead', v)),
      seg('Strings', [[true, 'Low E on top'], [false, 'High e on top']], !!prefs.lowTop, (v) => setPref('lowTop', v)),
      venuePicker(),
      h('div.hw-opt-toggles', null,
        toggle('Score my playing', prefs.detect, () => setPref('detect', !prefs.detect)),
        toggle('Lyrics', prefs.lyrics !== false, () => setPref('lyrics', prefs.lyrics === false)),
        toggle('Chord names', prefs.chordNames !== false, () => setPref('chordNames', prefs.chordNames === false)),
        toggle('Fire on a streak', prefs.fx, () => setPref('fx', !prefs.fx)),
        toggle('Score card at the end', prefs.scoreCard !== false, () => setPref('scoreCard', prefs.scoreCard === false)),
        toggle('Frame rate', !!prefs.showFps, () => setPref('showFps', !prefs.showFps))
      )
    );
  }
  function syncButton() {
    const off = prefs.offsetMs || 0;
    const sync = h('button.hw-sync', { type: 'button' }, h('span.hw-sync-icon', { html: icon('clock') }), h('span', null, h('b', { text: 'Sync check' }), h('small', { text: off ? `Notes ${Math.abs(off)} ms ${off > 0 ? 'later' : 'earlier'}` : 'Tap along to set the timing' })));
    sync.onclick = () => openSync();
    return sync;
  }
  // the Drop and your tuning, right here (3.9: there was nowhere to drop on the highway)
  const dropBox = h('div.hw-drop.drop3', {style:{'--gel':'var(--gel-bass)'}});
  function renderDropBox() {
    dropBox.innerHTML = '';
    dropBox.classList.toggle('on',rig.drop.on);
    const d = rig.drop;
    const kind = instrument() === 'bass' ? 'bass' : 'guitar';
    const amt = rig.dropAmount();
    const songT = H.tab && H.tab.tuning ? tuningName(H.tab.tuning, kind) : '';
    const mine = myTuning(kind);
    const plan = H.tab ? tuningPlan(H.tab.tuning, kind, mine) : { same: true };
    const head = h('div.hw-drop-head', null, h('div', null, h('b', { text: 'Drop' }), h('small', { text: d.on ? (amt ? (amt === 12 ? 'An octave down' : `Down ${amt} semitone${amt === 1 ? '' : 's'}`) : 'Song is in standard') : 'Off' })));
    const sw = h('button.drop-switch', { type: 'button', 'aria-pressed': String(d.on), title: 'The Drop on or off (D)' }, h('span.led'));
    sw.style.setProperty('--gel', '#8c7bff');
    sw.onclick = () => rig.setDrop({ on: !d.on });
    head.append(sw);
    dropBox.append(head);
    let need = '';
    if (H.tab) need = plan.same ? `${songT}: your ${kind} is ready` : plan.drop ? `${songT} song, your ${kind} is in ${tuningName(mine, kind)}: Drop −${plan.drop}` : `${songT}: retune ${plan.retune.map((r) => `${r.from}→${r.to}`).join(', ')}`;
    if (need) dropBox.append(h(`div.hw-drop-need${plan.same ? '.ok' : ''}`, { text: need }));
    if (plan.drop && !(d.on && d.match)) {
      const b = h('button.hw-chip.hw-drop-match', { type: 'button', html: `${icon('check')}<span>Match the song (−${plan.drop})</span>` });
      b.onclick = () => rig.setDrop({ on: true, match: true });
      dropBox.append(b);
    }
    const steps = h('div.drop-steps');
    const matchT = h('button', { type: 'button', text: 'Match', title: 'Follow each song’s tuning', 'aria-pressed': String(d.on && d.match) });
    matchT.onclick = () => rig.setDrop({ on: true, match: true });
    // Keep the original eight-button Drop layout; auto-match is separate.
    dropBox.append(matchT);
    matchT.className='hw-chip hw-drop-match';
    matchT.textContent='Match song tuning';
    for (const st of [1, 2, 3, 4, 5, 6, 7, 12]) {
      const b = h('button', { type: 'button', text: st === 12 ? 'Oct' : `−${st}`, 'aria-pressed': String(d.on && !d.match && d.st === st) });
      b.onclick = () => rig.setDrop({ st, match: false, on: true });
      steps.append(b);
    }
    dropBox.append(steps);
    const sel = h('select.input.hw-drop-mine', { 'aria-label': `Your ${kind} is tuned to` });
    const cur = mine.join(',');
    const list = kind === 'bass' ? MY_TUNINGS_BASS : MY_TUNINGS;
    for (const o of list) sel.append(h('option', { value: o.join(','), text: tuningName(o, kind), selected: o.join(',') === cur ? true : null }));
    if (!list.some((o) => o.join(',') === cur)) sel.append(h('option', { value: cur, text: tuningName(mine, kind), selected: true }));
    sel.onchange = () => {
      setMyTuning(kind, sel.value.split(',').map(Number));
      if (H.tab) rig.setSongTuning(H.tab.tuning, kind);
      renderDropBox();
    };
    dropBox.append(h('label.hw-drop-mine-row', null, h('span', { text: `Your ${kind} is in` }), sel));
  }
  rig.addEventListener('drop', () => H.open && mixOpen && renderDropBox());

  // --------------------------------------------------------- score card --
  // 3.9: when a song ends, how it went: your accuracy (and whether it's a new
  // best), each section as a bar, what went best and what to work on (with a
  // one-click repeat), and how you did on chords, bends, slides… It sits to
  // the side and never blocks: close it, play again, or just go elsewhere.
  const card = h('div.hw-card', { hidden: true, role: 'dialog', 'aria-label': 'How you did' });
  root.append(card);
  const bandCls = (a) => (a >= 0.9 ? 'g' : a >= 0.7 ? 'y' : a >= 0.5 ? 'o' : 'r');
  function hideCard() {
    card.hidden = true;
  }
  function showCard() {
    if (prefs.scoreCard === false || !H.judge || !H.tab || !(prefs.detect && rig.on)) return;
    const b = breakdown(H.tab, H.targets, H.judge);
    if (!b.notes) return;
    const part = H.tab.type === 'combo' ? 'lead' : H.tab.type;
    const prev = H.prevBest && H.prevBest[part] !== undefined ? H.prevBest[part] : null;
    const pct = Math.round(b.acc * 100);
    const isBest = prev === null ? b.notes >= 20 : b.acc > prev + 0.005;
    card.innerHTML = '';
    const x = h('button.hw-card-x', { type: 'button', title: 'Close', 'aria-label': 'Close', html: icon('x') });
    x.onclick = hideCard;
    const ring = h(`div.hw-card-ring.${bandCls(b.acc)}`, { style: { '--deg': `${Math.round(b.acc * 360)}deg` } }, h('b', { text: `${pct}%` }), h('span', { text: 'accuracy' }));
    const head = h('div.hw-card-head', null, ring, h('div.hw-card-titles', null, h('div.hw-card-eyebrow', { text: isBest ? (prev === null ? 'First score' : 'New best!') : 'Song complete' }), h('h3', { text: H.song ? H.song.title : 'Song' }), h('p', { text: cheer(b, prev) })), x);
    card.append(head);
    const facts = h('div.hw-card-facts');
    const fact = (v, l) => facts.append(h('div', null, h('b', { text: v }), h('span', { text: l })));
    fact(`${b.hit}/${b.notes}`, 'notes hit');
    fact(String(b.bestStreak), 'longest streak');
    fact(prev === null ? '–' : `${Math.round(prev * 100)}%`, 'best before');
    card.append(facts);
    if (b.sections.length) {
      const bars = h('div.hw-card-bars');
      for (const s of b.sections) {
        const bar = h(`button.hw-card-bar.${bandCls(s.acc)}`, { type: 'button', title: `${s.label}: ${Math.round(s.acc * 100)}% (${s.hit}/${s.notes}). Click to repeat it.` }, h('i', { style: { height: `${Math.max(6, Math.min(100, Math.round(((s.acc - 0.4) / 0.6) * 100)))}%` } }));
        bar.style.flexGrow = String(Math.max(0.5, s.end - s.start));
        bar.onclick = () => repeat(s);
        bars.append(bar);
      }
      card.append(h('div.hw-card-sub', { text: 'Section by section' }), bars);
    }
    const notes = h('div.hw-card-notes');
    if (b.strongest) notes.append(h('div.good', null, h('span', { html: icon('star') }), h('span', null, 'Best part: ', h('b', { text: `${b.strongest.label} · ${Math.round(b.strongest.acc * 100)}%` }))));
    if (b.weakest) {
      const rep = h('button.hw-chip', { type: 'button', html: `${icon('repeat')}<span>Repeat it</span>` });
      rep.onclick = () => repeat(b.weakest);
      notes.append(h('div.work', null, h('span', { html: icon('repeat') }), h('span', null, 'Work on: ', h('b', { text: `${b.weakest.label} · ${Math.round(b.weakest.acc * 100)}%` })), rep));
    }
    if (notes.childNodes.length) card.append(notes);
    if (b.kinds.length > 1) {
      const kinds = h('div.hw-card-kinds');
      for (const k of b.kinds) kinds.append(h(`span.${bandCls(k.acc)}`, { title: `${k.hit}/${k.notes}` }, `${k.label} `, h('b', { text: `${Math.round(k.acc * 100)}%` })));
      card.append(kinds);
    }
    const again = h('button.hw-chip.hw-card-again', { type: 'button', html: `${icon('play')}<span>Play again</span>` });
    again.onclick = () => {
      hideCard();
      jumpTo(0);
      if (!stage.engine.playing) stage.toggle();
    };
    card.append(h('div.hw-card-actions', null, again));
    card.hidden = false;
  }
  function repeat(s) {
    hideCard();
    stage.setLoop({ start: s.start, end: s.end, label: s.label });
    jumpTo(Math.max(0, s.start - 1));
    if (!stage.engine.playing) stage.toggle();
  }
  stage.engine.addEventListener('state', () => {
    if (stage.engine.playing) hideCard();
  });
  stage.engine.addEventListener('ended', () => { if(H.open){ extras.ended(); showCard(); } });
  H.showCard = showCard; // tests

  // ----------------------------------------------------- sync check --
  // Like Rocksmith's calibration: clicks play through the same path as the
  // song; you tap on each one you hear. The average gap between the clicks
  // and your taps is how late the sound really reaches you, and the notes
  // are shown that much later so they land with the music.
  const syncBox = h('div.hw-syncbox', { hidden: true, role: 'dialog', 'aria-label': 'Sync check' });
  root.append(syncBox);
  let syncRun = null;
  function openSync() {
    if (stage.engine.playing) stage.toggle();
    syncBox.hidden = false;
    syncIntro();
  }
  function closeSync() {
    if (syncRun) syncRun.stop();
    syncRun = null;
    syncBox.hidden = true;
  }
  function syncIntro() {
    syncBox.innerHTML = '';
    const go = h('button.btn.primary', { type: 'button', text: 'Start' });
    const cancel = h('button.btn.ghost', { type: 'button', text: 'Cancel' });
    go.onclick = () => syncStart();
    cancel.onclick = () => closeSync();
    syncBox.append(
      h('div.hw-sync-ring', { html: icon('clock') }),
      h('h3', { text: 'Sync check' }),
      h('p', { text: 'You’ll hear 4 clicks to get ready, then 16 more. Tap Space (or click) on every click you hear. Closing your eyes helps.' }),
      h('div.hw-sync-actions', null, cancel, go)
    );
    go.focus();
  }
  async function syncStart() {
    const N0 = 4;
    const N = 16;
    const gap = 0.6; // 100 bpm
    const { ctx: ac, node } = await stage.engine.extraOut();
    const eng = stage.engine;
    // "heard" clock of the engine (what engine.position uses), in context seconds
    const heardNow = () => {
      const ts = ac.getOutputTimestamp ? ac.getOutputTimestamp() : null;
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + Math.max(0, (performance.now() - ts.performanceTime) / 1000) - (eng.extraLatency || 0);
      return ac.currentTime - (ac.outputLatency || ac.baseLatency || 0) - (eng.extraLatency || 0);
    };
    const t0 = ac.currentTime + 0.6;
    const clicks = [];
    const srcs = [];
    for (let i = 0; i < N0 + N; i++) {
      const T = t0 + i * gap;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = i % 4 === 0 ? 1760 : 1320;
      g.gain.setValueAtTime(0, T);
      g.gain.linearRampToValueAtTime(0.5, T + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, T + 0.06);
      o.connect(g).connect(node);
      o.start(T);
      o.stop(T + 0.08);
      srcs.push(o);
      // when you'll hear it, on the page's clock
      clicks.push({ i, T, at: performance.now() + (T - heardNow()) * 1000 });
    }
    const taps = [];
    H.syncClicks = clicks; // tests
    const ring = h('div.hw-sync-ring.live');
    const dots = h('div.hw-sync-dots');
    for (let i = 0; i < N; i++) dots.append(h('i'));
    const label = h('p', { text: 'Get ready…' });
    const cancel = h('button.btn.ghost', { type: 'button', text: 'Cancel' });
    cancel.onclick = () => closeSync();
    syncBox.innerHTML = '';
    syncBox.append(ring, h('h3', { text: 'Tap on every click' }), label, dots, h('div.hw-sync-actions', null, cancel));
    const onTap = (e) => {
      if (e.type === 'keydown') {
        if (e.code !== 'Space' && e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
      } else if (e.target.closest('button')) return;
      const now = performance.now();
      taps.push(now);
      ring.classList.remove('tap');
      void ring.offsetWidth;
      ring.classList.add('tap');
      const done = clicks.filter((c) => c.i >= N0 && c.at < now + 250).length;
      label.textContent = done ? `${done} of ${N}` : 'Get ready…';
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k < done));
    };
    document.addEventListener('keydown', onTap, true);
    syncBox.addEventListener('pointerdown', onTap);
    const end = clicks[clicks.length - 1].at + 700;
    const timer = setInterval(() => {
      if (performance.now() > end) finish();
    }, 100);
    syncRun = {
      stop() {
        clearInterval(timer);
        document.removeEventListener('keydown', onTap, true);
        syncBox.removeEventListener('pointerdown', onTap);
        for (const o of srcs) try { o.stop(); } catch (_) {}
      },
    };
    function finish() {
      syncRun.stop();
      syncRun = null;
      // each measured click: the nearest tap within a quarter second
      const offs = [];
      for (const c of clicks) {
        if (c.i < N0) continue;
        let best = null;
        for (const t of taps) if (Math.abs(t - c.at) < 250 && (best === null || Math.abs(t - c.at) < Math.abs(best - c.at))) best = t;
        if (best !== null) offs.push(best - c.at);
      }
      syncResult(offs, N);
    }
  }
  function syncResult(offs, N) {
    syncBox.innerHTML = '';
    const again = h('button.btn.ghost', { type: 'button', text: 'Try again' });
    again.onclick = () => syncStart();
    if (offs.length < N / 2) {
      const cancel = h('button.btn.ghost', { type: 'button', text: 'Cancel' });
      cancel.onclick = () => closeSync();
      syncBox.append(h('div.hw-sync-ring', { html: icon('alert') }), h('h3', { text: 'Not enough taps' }), h('p', { text: `Only ${offs.length} of ${N} taps landed near a click. Tap Space on each click you hear.` }), h('div.hw-sync-actions', null, cancel, again));
      return;
    }
    const sorted = [...offs].sort((a, b) => a - b);
    const trim = sorted.slice(Math.floor(sorted.length * 0.2), Math.ceil(sorted.length * 0.8));
    const ms = Math.round(trim.reduce((a, b) => a + b, 0) / trim.length / 5) * 5;
    const spread = Math.round(Math.sqrt(trim.reduce((a, b) => a + (b - ms) ** 2, 0) / trim.length));
    const use = Math.max(-300, Math.min(300, ms));
    // your taps as dots around the beat (centre line): see how steady they were
    const strip = h('div.hw-sync-strip', null, h('i.beat'));
    for (const o of offs) {
      const d = h('i.tap');
      d.style.left = `${50 + Math.max(-48, Math.min(48, o / 5))}%`;
      strip.append(d);
    }
    const avg = h('i.avg');
    avg.style.left = `${50 + Math.max(-48, Math.min(48, use / 5))}%`;
    strip.append(avg);
    const ok = h('button.btn.primary', { type: 'button', text: use === 0 ? 'Keep in sync' : `Use ${use > 0 ? '+' : ''}${use} ms` });
    ok.onclick = () => {
      setPref('offsetMs', use);
      closeSync();
      toast({ title: use ? `Notes now ${Math.abs(use)} ms ${use > 0 ? 'later' : 'earlier'}` : 'Notes in sync', message: 'Only the picture moves; scoring is not affected.' });
    };
    const reset = h('button.btn.ghost', { type: 'button', text: 'Reset to 0' });
    reset.onclick = () => {
      setPref('offsetMs', 0);
      closeSync();
    };
    const steady = spread < 25 ? 'Nice and steady.' : spread < 45 ? 'A bit uneven: try again for a surer result.' : 'Quite uneven: try again, tapping just as you hear each click.';
    syncBox.append(
      h('div.hw-sync-big', { text: `${use > 0 ? '+' : ''}${use} ms` }),
      h('p', { text: use === 0 ? 'Your sound and the notes already line up.' : `The sound reaches you ${Math.abs(use)} ms ${use > 0 ? 'later' : 'earlier'} than Stagehand expected. The notes will move to match. ${steady}` }),
      h('div.hw-sync-legend', null, h('span', { text: 'early' }), h('span', { text: 'on the click' }), h('span', { text: 'late' })),
      strip,
      h('div.hw-sync-actions', null, reset, again, ok)
    );
    ok.focus();
  }

  // ------------------------------------------------------------- tones --
  function followsSong() {
    const st = H.tab && H.tab.songTones;
    if (!st || !H.song) return false;
    return !!rig.autoSong;
  }
  function songToneAt(t) {
    const st = H.tab && H.tab.songTones;
    if (!st) return null;
    let key = st.base;
    for (const c of st.changes) {
      if (c.t <= t + 0.02) key = c.key;
      else break;
    }
    return st.tones.find((x) => x.key === key) || st.tones[0];
  }
  function applyTone() {
    if (!H.tab || !rig.on) return;
    if (H.tab.songTones) rig.prepareTones(H.tab.songTones.tones);
    if(rig.autoSong)rig.dispatchEvent(new Event('song-auto'));
  }
  function followTone(t) {}
  function chooseTone(id) {
    if (H.song) {
      songToneChoice[H.song.id] = id;
      saveToneChoice();
    }
    if (id === 'song') {
      rig.autoSong=true;rig.dispatchEvent(new Event('song-auto'));
      H.toneKey = null;
      if (rig.on) applyTone();
    } else if ((tonelib.list || []).some((t) => t.id === id)) useTone(id); // remembers the slot, like keys 1–9
    else rig.setTone(id);
    renderControls();
  }
  toneBtn.onclick = () => {
    const r = toneBtn.getBoundingClientRect();
    const c = (on) => (on ? '✓' : '');
    const song = rig.mode === 'song';
    const kind = H.tab && H.tab.type === 'bass' ? 'bass' : 'guitar';
    const items = [];
    // what your amp is: the real one (a capture) or Stagehand's model, and the real one to get
    const cap = rig.capture;
    const sug = !cap && rig.tone ? suggestionFor(rig.tone) : null;
    if (cap) {
      const lbl = modelLabel(cap);
      items.push({ heading: true, label: `REAL amp · ${cap.pack.title}${lbl ? ` · ${lbl}` : ''}` }, '-');
    } else if (sug) {
      items.push({ heading: true, label: 'Modelled amp' }, { label: `Get the real ${sug.def.title}`, icon: 'download', onClick: () => getRealAmp(sug.key, null) }, '-');
    }
    if (H.tab && H.tab.songTones) {
      const cur = songToneAt(stage.engine.position);
      items.push({ heading: true, label: 'This song' }, { label: `Song tone${cur ? ` (${cur.name})` : ''}`, hint: c(song || followsSong()), onClick: () => chooseTone('song') }, '-');
    }
    const on = (id) => c(!song && !followsSong() && rig.toneId === id);
    // your slots first (same as keys 1–9), then your other saved tones, then the presets
    const mine = tonelib.list || [];
    const slots = mine.filter((t) => t.slot).sort((a, b) => a.slot - b.slot);
    if (slots.length) {
      items.push({ heading: true, label: 'Your slots (keys 1–9)' });
      for (const t of slots) items.push({ label: `${t.slot}  ${t.name}`, hint: on(t.id), onClick: () => chooseTone(t.id) });
      items.push('-');
    }
    const others = mine.filter((t) => !t.slot && !TONES.some((p) => p.id === t.id));
    if (others.length) {
      items.push({ heading: true, label: 'Your tones' });
      for (const t of [...others.filter((x) => x.kind === kind), ...others.filter((x) => x.kind !== kind)]) items.push({ label: t.name, hint: on(t.id), onClick: () => chooseTone(t.id) });
      items.push('-');
    }
    items.push({ heading: true, label: 'Presets' });
    for (const t of [...TONES.filter((x) => x.kind === kind), ...TONES.filter((x) => x.kind !== kind)]) items.push({ label: t.name, hint: on(t.id), onClick: () => chooseTone(t.id) });
    showMenu(r.right, r.bottom + 6, items, { align: 'right' });
  };

  // --------------------------------------------------------------- mix --
  function setMixOpen(on) {
    mixOpen = on;
    prefs.mixOpen = on;
    save();
    dock.classList.toggle('collapsed', !on);
    mixBtn.setAttribute('aria-pressed', String(on));
    mixTab.setAttribute('aria-expanded', String(on));
    mixTab.innerHTML = `${icon(on ? 'chevronRight' : 'chevronLeft')}<span>Master Settings</span>`;
    renderMix();
  }
  mixBtn.onclick = () => setMixOpen(!mixOpen);
  mixTab.onclick = () => setMixOpen(!mixOpen);
  setTimeout(() => setMixOpen(mixOpen));
  const mixMeters = new Map();
  function renderMix() {
    if (!mixOpen) return;
    // Don't rebuild under a volume slider that's being dragged.
    if (document.activeElement && document.activeElement.classList.contains('stem-vol') && mixPanel.contains(document.activeElement)) return;
    mixPanel.innerHTML = '';
    mixMeters.clear();
    mixPanel.append(h('div.hw-master-title', null, h('b', { text: 'Master Settings' })), syncButton());
    renderMixBody();
    mixPanel.append(h('div.hw-master-sec', { text: 'Tuning' }), dropBox, opts);
    renderDropBox();
    renderOpts();
  }
  function renderMixBody() {
    const stems = stage.stems();
    // Two big levels first: your guitar (live, through your tone) and the whole song.
    const level = (cls, label, sub, value, color, onInput) => {
      const inp = h('input.stem-vol', { type: 'range', min: '0', max: '1', step: '0.01', value: String(value), 'aria-label': label });
      inp.oninput = () => onInput(Number(inp.value));
      const meter = h('i');
      mixMeters.set(cls, meter);
      const row = h(`div.hw-level.${cls}`, null, h('div.hw-level-top', null, h('b', { text: label }), h('span', { text: sub })), h('span.hw-mix-fader', null, inp, h('span.meter', null, meter)));
      row.style.setProperty('--gel', color);
      return row;
    };
    mixPanel.append(
      h('div.hw-master-sec', { text: 'Mix' }),
      level('you', 'Your guitar', 'what you play, live', rig.knobs.volume ?? 0.7, '#ff6b3d', (v) => stage.setYou(v)),
      level('master', 'Whole song', 'the band, all together', stage.songLevel(), '#ffb547', (v) => stage.setSongLevel(v)),
      h('div.hw-mix-head.sub', null, h('b', { text: 'Song stems' }), h('span', { text: stems.length ? 'Each instrument in the recording' : '' }))
    );
    if (!stems.length) {
      const st = stage.stemStatus ? stage.stemStatus() : null;
      const busy = st && (st.state === 'queued' || st.state === 'running');
      mixPanel.append(h('p.hw-mix-note', { text: busy ? `Splitting stems… ${st.progress ? Math.round(st.progress * 100) + '%' : ''}` : 'Split this song into stems to set the drums, bass, vocals and guitar separately.' }));
      if (!busy && stage.requestStems) {
        const b = h('button.hw-chip', { type: 'button', html: `${icon('split')}<span>Split stems</span>` });
        b.onclick = () => {
          stage.requestStems();
          setTimeout(renderMix, 300);
        };
        mixPanel.append(b);
      }
      return;
    }
    const inst = instrument();
    for (const name of stems) {
      const t = stage.engine.tracks[stage.trackIndex(name)] || {};
      const mine = name === inst && !!H.tab;
      const on = !t.muted;
      const row = h(`div.hw-mix-row${on ? '' : '.off'}`);
      row.style.setProperty('--gel', stage.gel(name));
      const tog = h('button.hw-mix-on', { type: 'button', role: 'switch', 'aria-checked': String(on), title: on ? `Turn the ${stage.label(name).toLowerCase()} in the song off` : `Turn the ${stage.label(name).toLowerCase()} in the song on` });
      tog.onclick = () => {
        stage.setStem(name, { muted: !t.muted });
        renderMix();
      };
      const vol = h('input.stem-vol', { type: 'range', min: '0', max: '1', step: '0.01', value: String(t.volume ?? 0.8), 'aria-label': `${stage.label(name)} in the song`, title: 'Double-click to reset' });
      vol.oninput = () => stage.setStem(name, { volume: Number(vol.value) });
      vol.ondblclick = () => {
        vol.value = '0.8';
        stage.setStem(name, { volume: 0.8 });
      };
      const solo = h('button.hw-mix-solo', { type: 'button', text: 'Solo', 'aria-pressed': String(!!t.solo) });
      solo.onclick = () => {
        stage.setStem(name, { solo: !t.solo });
        renderMix();
      };
      const meter = h('i');
      mixMeters.set(name, meter);
      row.append(...[tog, h('span.dot'), h('span.name', { text: stage.label(name) }), mine ? h('span.you', { text: 'your part', title: 'The recorded part you’re playing. Turn it down or off to fill it in yourself.' }) : null, h('span.hw-mix-fader', null, vol, h('span.meter', null, meter)), solo].filter(Boolean));
      mixPanel.append(row);
    }
  }
  function updateMixLevels() {
    if (!mixOpen) return;
    for (const [name, el] of mixMeters) {
      let v;
      if (name === 'you') v = rig.on ? Math.sqrt((rig.levels() || {}).output || 0) * 1.5 : 0;
      else if (name === 'master') v = Math.sqrt(stage.engine.masterLevel ? stage.engine.masterLevel() : 0) * 1.4;
      else v = stage.engine.level(stage.trackIndex(name)) * 2.6;
      el.style.width = `${Math.min(100, v * 100)}%`;
    }
  }

  function setPref(k, v) {
    prefs[k] = v;
    save();
    if (k === 'detect') resetJudge();
  }

  // ------------------------------------------------------------ opening --
  async function open(song) {
    if (!song) return toast({ title: 'Pick a song first', message: 'Double-click a song, then open the highway.', kind: 'info' });
    H.open = true;
    root.hidden = false;
    document.getElementById('app').classList.add('under-highway');
    api.app.fullscreen(true).catch(() => {});
    H.cam.ready = false;
    if (!H.song || H.song.id !== song.id || !H.tab) await loadSong(song);
    else applyPlayAlong();
    resize();
    H.clock = stage.engine.position;
    H.last = performance.now();
    H.prevBest = H.song && state.best ? { ...(state.best[H.song.id] || {}) } : null;
    hideCard();
    resetJudge();
    renderControls();
    renderStatus();
    loop();
  }

  function close() {
    H.open = false;
    extras.close();
    practiceCheckpoint();
    dropFluid();
    visuals.drop();
    root.hidden = true;
    cancelAnimationFrame(H.raf);
    H.raf = 0;
    document.getElementById('app').classList.remove('under-highway');
    api.app.fullscreen(false).catch(() => {});
    stage.onHighwayClosed && stage.onHighwayClosed();
  }

  async function loadSong(song, partId) {
    // Only the newest request may fill the highway: a slow answer for an older song
    // (or part) must never put its notes under the new song's title.
    const token = (H.loadToken = (H.loadToken || 0) + 1);
    H.song = song;
    H.tab = null;
    H.targets = [];
    H.judge = null;
    H.lyricLines = [];
    showMsg(`Reading ${song.title || 'the part'}…`);
    try {
      const parts = await api.tab.list(song.id);
      if (token !== H.loadToken) return;
      H.parts = parts;
      const want = partId || pickPart();
      if (!want) throw new Error('This song has no guitar or bass part.');
      const tab = await api.tab.load(song.id, want);
      if (token !== H.loadToken) return;
      H.tab = tab;
      prefs.part = H.tab.type === 'combo' ? 'lead' : H.tab.type;
      save();
      rig.setSongTuning(H.tab.tuning, instrument());
      H.scoringShift=tuneShift.st=rig.dropAmount();
      H.targets = buildTargets(H.tab);
      H.lyricLines = buildLyrics(H.tab.lyrics || []);
      lyricShown = -2;
      showMsg(null);
      applyPlayAlong();
      resetJudge();
      H.toneKey = null;
      applyTone();
    } catch (err) {
      if (token !== H.loadToken) return;
      showMsg(`Couldn’t read the part for ${song.title || 'this song'}: ${err.message}`);
    }
    renderControls();
    renderStatus();
  }

  /** The panel in the middle when the song can't play yet, and why. */
  function renderStatus() {
    const info = stage.loadInfo ? stage.loadInfo() : null;
    if (!H.open || !info || !info.song) {
      statusBox.hidden = true;
      return;
    }
    const title = esc(info.song.title || 'this song');
    let html = '';
    let key = '';
    if (info.phase === 'loading') {
      key = `loading:${info.song.id}`;
      html = `<div class="hw-st-box"><span class="hw-st-spin"></span><b>Opening ${title}…</b><span>Getting the song audio ready.</span></div>`;
    } else if (info.phase === 'error') {
      key = `error:${info.song.id}:${info.error}`;
      html = `<div class="hw-st-box bad"><b>${title} didn’t open</b><span>${esc(info.error || 'Something went wrong.')}</span><div class="hw-st-acts"><button type="button" class="btn small primary" data-act="retry">Try again</button>${info.prev ? `<button type="button" class="btn small ghost" data-act="prev">Back to ${esc(info.prev.title)}</button>` : ''}</div></div>`;
    } else if (info.waiting) {
      const st = info.waiting;
      const pct = st.state === 'ready' ? 100 : Math.round((st.progress || 0) * 100);
      const what = st.state === 'ready' ? 'Loading the stems' : st.state === 'queued' ? 'Waiting to split the stems' : `Splitting the stems · ${pct}%`;
      key = `wait:${info.song.id}:${st.state}`;
      if (statusBox.dataset.key === key && st.state === 'running') {
        const b = statusBox.querySelector('b');
        if (b) b.textContent = what;
        const bar = statusBox.querySelector('.hw-st-bar > i');
        if (bar) bar.style.width = `${Math.max(2, pct)}%`;
        statusBox.hidden = false;
        return;
      }
      html = `<div class="hw-st-box"><b>${what}</b><span>${title} starts by itself when they’re ready.</span><div class="hw-st-bar"><i style="width:${Math.max(2, pct)}%"></i></div><div class="hw-st-acts"><button type="button" class="btn small" data-act="now">Play now with the full mix</button></div></div>`;
    }
    if (!html) {
      statusBox.hidden = true;
      statusBox.dataset.key = '';
      return;
    }
    if (statusBox.dataset.key !== key) {
      statusBox.dataset.key = key;
      statusBox.innerHTML = html;
    }
    statusBox.hidden = false;
  }
  statusBox.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'retry') stage.retry();
    else if (b.dataset.act === 'prev') stage.backToPrevious();
    else if (b.dataset.act === 'now') stage.playNow();
  };
  on('stage-phase', () => renderStatus());
  on('stems-update', () => H.open && renderStatus());

  function pickPart() {
    const want = prefs.part || 'lead';
    const p = H.parts.find((x) => x.type === want && !x.bonus) || H.parts.find((x) => x.type === want) || (want === 'lead' ? H.parts.find((x) => x.type === 'combo') : null) || H.parts[0];
    return p && p.id;
  }

  function showMsg(text) {
    msg.hidden = !text;
    msg.textContent = text || '';
  }

  /** Gems and chords for drawing, with a flag for repeated chords (drawn as a frame only, like Rocksmith). */
  function buildTargets(tab) {
    const t = targetsFromTab(tab);
    let prev = null;
    for (const x of t) {
      if (x.kind === 'chord' || (x.kind === 'mute' && x.notes.length > 1)) {
        const shape = (tab.handShapes || []).find((hs) => hs.start <= x.t + 0.001 && x.t < hs.end - 0.001);
        x.repeat = isChordRepeat(prev, x, !!shape && prev?.shape === shape);
        x.shape = shape;
        x.name = x.chord !== undefined && tab.chords[x.chord] ? tab.chords[x.chord].name : '';
        prev = x;
      } else if (x.notes.length === 1) prev = null;
    }
    H.sustainEnds = sustainIndex(t);
    linkChains(t); // a picked note's gem shows the bends and vibrato of the notes held on from it
    return t;
  }

  /** Lyrics as lines of words ("+" ends a line, "-" joins syllables), for the karaoke line. */
  function buildLyrics(ly) {
    const lines = [];
    let cur = null;
    for (let i = 0; i < ly.length; i++) {
      const w = ly[i];
      const raw = String(w.w || '');
      const end = raw.endsWith('+');
      const clean = raw.replace(/\+$/, '');
      const joined = clean.endsWith('-');
      const text = joined ? clean.slice(0, -1) : clean;
      if (!cur || (cur.words.length && (w.t - cur.t1 > 3 || (cur.words.length >= 12 && !cur.words[cur.words.length - 1].joined)))) {
        cur = { t0: w.t, t1: w.t + (w.d || 0.3), words: [] };
        lines.push(cur);
      }
      cur.words.push({ t: w.t, d: Math.max(0.15, w.d || 0.3), text, joined });
      cur.t1 = w.t + Math.max(0.15, w.d || 0.3);
      if (end) cur = null;
    }
    return lines;
  }
  let lyricShown = -2;
  let lyricWord = -2;
  function updateLyrics(t) {
    const L = H.lyricLines || [];
    if (prefs.lyrics === false || !L.length) {
      lyricsBox.hidden = true;
      return;
    }
    // the line being sung stays until its last word is done; only then does
    // the next one move up (it's already showing underneath)
    let i = -1;
    for (let k = 0; k < L.length; k++) {
      if (L[k].t0 <= t) i = k;
      else break;
    }
    if (i < 0) i = L[0].t0 - 1.5 <= t ? 0 : -1;
    else if (t > L[i].t1 + 0.1 && L[i + 1] && L[i + 1].t0 - t < 2.5) i++;
    const line = L[i];
    const show = !!line && t < line.t1 + 1.5;
    if (!show) {
      if (!lyricsBox.hidden) lyricsBox.hidden = true;
      return;
    }
    lyricsBox.hidden = false;
    if (i !== lyricShown) {
      lyricShown = i;
      lyricWord = -2;
      lyricsBox.innerHTML = '';
      const row = h('div.hw-ly-now');
      line.words.forEach((w, k) => row.append(h('span', { text: w.text + (w.joined || k === line.words.length - 1 ? '' : ' ') })));
      const next = L[i + 1];
      lyricsBox.append(row, h('div.hw-ly-next', { text: next ? next.words.map((w, k) => w.text + (w.joined || k === next.words.length - 1 ? '' : ' ')).join('') : '' }));
    }
    // sung words dim, the word being sung lights up, the rest wait in white
    let wi = -1;
    for (let k = 0; k < line.words.length; k++) if (line.words[k].t <= t) wi = k;
    if (wi !== lyricWord) {
      lyricWord = wi;
      const spans = lyricsBox.firstChild.children;
      for (let k = 0; k < spans.length; k++) spans[k].className = k < wi ? 'sung' : k === wi && t < line.words[k].t + line.words[k].d + 0.25 ? 'now' : k === wi ? 'sung' : '';
    }
  }

  function instrument() {
    return H.tab && H.tab.type === 'bass' ? 'bass' : 'guitar';
  }

  function applyPlayAlong() {
    const on = H.open && (prefs.playAlong ?? true) && stage.stems().length > 0 && H.tab;
    stage.engine.setPlayAlong(on ? instrument() : null);
    if (on) stage.setMode('stems');
  }

  // The Drop changes what pitches you play: re-aim the scoring here too.
  rig.addEventListener('drop', () => {
    if (!H.tab) return;
    const shift=rig.dropAmount();
    if(H.scoringShift===shift)return;
    H.scoringShift=shift;
    tuneShift.st = shift;
    H.targets = buildTargets(H.tab);
    resetJudge();
  });

  // ------------------------------------------------------------ scoring --
  const analyzer = { an: null, on: null, buf: new Float32Array(8192) };
  function resetJudge() {
    H.judge = H.targets.length ? new Judge(H.targets) : null;
    practiceCheckpoint();
    if (H.judge) {
      H.judge.reset(stage.engine.position);
      H.judge.next = lower(H.targets, stage.engine.position - H.judge.early);
    }
    analyzer.an = new Analyzer(rig.sampleRate);
    analyzer.on = new OnsetTracker();
    H.bursts = [];
    H.hits = [];
    H.lands = [];
    H.landNext = undefined;
  }

  function listen(songT) {
    if (!H.judge || !prefs.detect || !rig.on || !stage.engine.playing) return;
    const buf = rig.samples(analyzer.buf);
    if (!buf) return;
    if (!analyzer.an || analyzer.an.sr !== rig.sampleRate) analyzer.an = new Analyzer(rig.sampleRate);
    // What you play reaches us a little after you play it.
    const delay = ((rig.latencyMs || 20) / 1000 + 0.03) * stage.engine.speed;
    const t = songT - delay;
    const f = analyzer.an.frame(buf);
    H.judge.push(t, f, analyzer.on.update(t, f));
  }

  /** Newly judged notes light up (or don't); with no scoring, notes still land with a soft flash. */
  function processEvents(t) {
    const scoring = H.judge && prefs.detect && rig.on;
    if (scoring) for (const e of H.judge.events.splice(0)) onJudged(e);
    const T = H.targets;
    if (H.landNext === undefined || H.landNext > T.length || (H.landNext > 0 && T[H.landNext - 1].t > t + 0.05)) H.landNext = lower(T, t);
    while (H.landNext < T.length && T[H.landNext].t <= t) {
      const tg = T[H.landNext++];
      // the backgrounds see every note land, in its string's colour
      if (stage.engine.playing && t - tg.t < 0.2) for (const n of tg.notes) if (!n.mute && !n.linked) feat.note(n.s, n.f, false);
      if (!scoring && stage.engine.playing && t - tg.t < 0.2) {
        const now = performance.now();
        H.lands.push({ id: tg.id, at: now, until: tg.t + (tg.sus || 0) });
      }
    }
  }

  // ------------------------------------------------------------- render --
  let W = 0;
  let HH = 0;
  let dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    HH = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(HH * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${HH}px`;
    if (R3) R3.resize(W, HH, Math.min(dpr, 1.5)); // the 3D picture needs no more than 1.5x on 4K screens (text stays sharp)
  }
  window.addEventListener('resize', () => H.open && resize());

  // Keeps the highway smooth on slow graphics: if frames take too long, the
  // glow goes first, then the 3D picture renders at a lower resolution.
  const perf = { noGlow: false, acc: 0, n: 0, since: 0 };
  H.perfState = perf;
  function govern(ms, dt) {
    if (!R3) return;
    perf.acc += Math.max(ms, dt * 1000);
    perf.n++;
    if (perf.n < 60 && perf.acc < 1200) return;
    const avg = perf.acc / perf.n;
    perf.acc = 0;
    perf.n = 0;
    if (avg > 26 && R3.scale > 0.5) R3.setScale(R3.scale > 0.75 ? 0.75 : 0.5, Math.min(dpr, 1.5));
    H.perf = { avg, glow: R3.glow, scale: R3.scale };
  }

  function loop() {
    cancelAnimationFrame(H.raf);
    const step = (now) => {
      if (!H.open) return;
      H.stepStart = performance.now();
      const dt = Math.min(0.1, (now - H.last) / 1000);
      H.last = now;
      // The song clock (engine.position) follows the speakers, but it arrives
      // in small uneven steps (audio is handed over in chunks). Drawn as is,
      // fast notes judder. The picture runs on its own smooth clock that
      // advances with real time and is pulled gently onto the song clock
      // (no drift, no added delay); a seek, pause or loop snaps it at once.
      const eng = stage.engine;
      const raw = eng.position;
      H.clock = raw; // scoring keeps the exact song clock
      const realDt = Math.min(0.25, (now - (H.lastNow || now)) / 1000);
      H.lastNow = now;
      if (!eng.playing || !Number.isFinite(H.vclock) || Math.abs(raw - H.vclock) > 0.2) H.vclock = raw;
      else {
        H.vclock += realDt * (eng.speed || 1);
        H.vclock += (raw - H.vclock) * Math.min(1, realDt * 4);
      }
      if (Number.isFinite(H.lastClock) && (raw < H.lastClock - 0.05 || raw - H.lastClock > 0.5)) {
        if (H.judge) {
          H.judge.rewind(raw);
          H.judge.next = lower(H.targets, raw - H.judge.early);
          H.judge.events = []; H.judge.frames = []; H.judge.onsets = [];
        }
        H.landNext = lower(H.targets, raw);
        H.lands = []; H.hits = []; H.bursts = []; H.misses = [];
        sparks.length = 0;
        H.cam.ready = false;
      }
      H.lastClock = H.clock;
      listen(H.clock);

      // your timing nudge: positive shows notes later (they reach the neck later)
      const vis = visualTime(H.vclock, prefs.offsetMs, eng.speed);
      H.vis = vis; // lyrics follow the same timing as the notes
      if (H.judge && eng.playing && prefs.detect && rig.on) H.judge.tick(H.clock - (((rig.latencyMs || 20) / 1000 + 0.03) * eng.speed));
      processEvents(vis);
      followTone(H.clock);
      const f0 = performance.now();
      draw(vis, dt);
      govern(performance.now() - f0, dt);
      if (prefs.showFps) {
        const ours = performance.now() - (H.stepStart || now);
        H.other = (H.other || 0) * 0.95 + Math.max(0, dt * 1000 - ours) * 0.05;
        H.worst = Math.max((H.worst || 0) * 0.995, dt * 1000);
        H.fpsAcc = (H.fpsAcc || 0) * 0.95 + dt * 0.05;
        if (now - (H.fpsShown || 0) > 250) {
          H.fpsShown = now;
          const tm = H.timing || {};
          fpsBox.textContent = `${Math.round(1 / Math.max(0.001, H.fpsAcc))} fps · worst ${Math.round(H.worst)} ms · ours ${(tm.build + tm.gpu || 0).toFixed(1)} ms (scene ${(tm.build || 0).toFixed(1)}, draw ${(tm.gpu || 0).toFixed(1)}) · waiting ${H.other.toFixed(1)} ms · ${R3 ? Math.round(R3.scale * 100) : 0}% · ${R3 ? R3.gpuName : ''}`;
        }
      }
      fpsBox.hidden = !prefs.showFps;
      if (now - (H.quietAt || 0) > 250) {
        H.quietAt = now;
        root.classList.toggle('hw-quiet', eng.playing && now - lastInteraction > 2500 && !mixOpen && !document.querySelector('.menu[role="menu"]') && !root.querySelector(':focus-visible'));
      }
      updateHud(H.clock);
      updateMixLevels();
      H.raf = requestAnimationFrame(step);
    };
    H.raf = requestAnimationFrame(step);
  }

  /** The hand position (anchor) in play at time t. */
  function anchorAt(t) {
    const A = H.tab.anchors || [];
    if (!A.length) return { fret: 1, width: 4 };
    let i = lower(A, t + 0.0001) - 1;
    if (i < 0) i = 0;
    return A[i];
  }

  // ================================================================ 3D ==
  // A real 3D scene on the graphics card (highway3d.js), laid out like
  // Rocksmith 2014 as seen in your own gameplay videos:
  //   x runs along the neck (about a unit per fret), y is height above the
  //   highway floor (each string at its own height, low E on top by default),
  //   z is time ahead (0 = the neck, where you play).
  // The neck stands upright at z = 0 across the bottom of the screen. The
  // floor runs from it to a far vanishing point; your hand position is a lit
  // channel on that floor. Frets are nearly even in width so fret 20 reads
  // as easily as fret 3. Text (fret numbers, chord names, MISS…) is drawn
  // crisp on a 2D layer on top, placed by the 3D camera.
  const RATIO = 0.982; // each fret this much narrower than the one before
  const XF = (f) => (f < 0 ? f : (1 - Math.pow(RATIO, f)) / (1 - RATIO));
  const FX = (x) => (x < 0 ? x : Math.log(Math.max(1e-6, 1 - x * (1 - RATIO))) / Math.log(RATIO));
  const laneC = (f) => (XF(f - 1) + XF(f)) / 2;
  const laneW = (f) => XF(f) - XF(f - 1);
  const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
  const PAST = 0.14; // seconds a note keeps travelling past the neck toward you, fading
  const CAM_LOOK = 6.5; // a roaming solo stays pulled back, as in your KO clip // seconds of hand positions the camera frames ahead

  const G = {};

  function geometry(t) {
    const n = H.tab.strings;
    G.n = n;
    G.t = t;
    G.L = prefs.ahead;
    G.gy = n === 4 ? 0.36 : 0.27; // height per string (upright neck: every string at z = 0)
    G.hl = 0.14; // the bottom string above the floor
    G.gap = G.gy;
    G.yMid = G.hl + ((n - 1) / 2) * G.gy;
    G.yTop = G.hl + (n - 1) * G.gy;
    G.zs = APPROACH_UNITS * (prefs.flow ?? 1); // world units per song second, never tied to the camera
    G.zF = G.zs * G.L;
  }
  const level = (s) => (prefs.lowTop ? G.n - 1 - s : s);
  const nY = (L) => G.hl + L * G.gy;
  const strH = (s) => nY(level(s));
  const strZ = () => 0;
  const zOf = (time) => approachDepth(time, G.t, prefs.flow ?? 1);
  const anX0 = (an) => XF(an.fret - 1);
  const anX1 = (an) => XF(an.fret - 1 + (an.width || 4));
  const noteX = (nt, a) => (nt.f === 0 ? (anX0(a) + anX1(a)) / 2 : laneC(nt.f));

  // ---- camera --
  /** Frets (as lane edges, lo..hi) that the next few seconds of play use. */
  function playRange(t, horizon) {
    const A = H.tab.anchors || [];
    let lo = Infinity;
    let hi = -Infinity;
    const take = (a, b) => {
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    };
    const an = anchorAt(t);
    take(an.fret - 1, an.fret - 1 + (an.width || 4));
    for (let i = lower(A, t); i < A.length && A[i].t < t + horizon; i++) take(A[i].fret - 1, A[i].fret - 1 + (A[i].width || 4));
    const T = H.targets;
    for (let i = lower(T, t - 0.2); i < T.length && T[i].t < t + horizon; i++) {
      for (const nt of T[i].notes) {
        if (nt.f > 0) take(nt.f - 1, nt.f);
        const sl = nt.slideTo !== undefined ? nt.slideTo : nt.slideUnpitchTo;
        if (sl > 0) take(sl - 1, sl);
      }
    }
    if (!isFinite(lo)) return { lo: 0, hi: 5 };
    return { lo, hi };
  }

  /** The stretch of neck to show for a range: room each side, at least ~11 frets. */
  function viewFor(r) {
    let lo = r.lo - 1.6;
    let hi = r.hi + 1.4;
    const MIN = 11;
    if (hi - lo < MIN) {
      const c = (lo + hi) / 2;
      lo = c - MIN / 2;
      hi = c + MIN / 2;
    }
    if (lo < -2.5) {
      hi += -2.5 - lo;
      lo = -2.5;
    }
    if (hi > 24.8) {
      lo = Math.max(-2.5, lo - (hi - 24.8));
      hi = 24.8;
    }
    return { lo, hi };
  }

  const CAM = { fov: 60, yaw: 0.075, neckY: 0.83, fill: 0.88 };
  function camera(t, dt) {
    const c = H.cam;
    const want = viewFor(playRange(t, CAM_LOOK));
    const fr = c.frame;
    if (!fr || !c.ready) c.frame = { ...want, slack: 0 };
    else if (want.lo < fr.lo - 0.05 || want.hi > fr.hi + 0.05) {
      // something coming doesn't fit: take it in now (keep what still fits, so it pans)
      c.frame = { lo: Math.min(want.lo, fr.lo), hi: Math.max(want.hi, fr.hi), slack: 0 };
      if (c.frame.hi - c.frame.lo > want.hi - want.lo + 2.5) c.frame = { ...want, slack: 0 };
    } else if (want.hi - want.lo < (fr.hi - fr.lo) * 0.8) {
      // more room than needed: close in once it has stayed that way a moment
      fr.slack += dt;
      if (fr.slack > 3.5) c.frame = { ...want, slack: 0 };
    } else fr.slack = 0;
    const x0 = XF(c.frame.lo);
    const x1 = XF(c.frame.hi);
    const tx = (x0 + x1) / 2;
    const span = x1 - x0;
    // zoomed right out (a solo roaming the neck) the camera drops a little lower and flatter
    const zoomK0 = Math.max(0, Math.min(1, (span - 9.5) / 9));
    c.zk = c.ready && c.zk !== undefined ? c.zk + (zoomK0 - c.zk) * Math.min(1, dt * 2.5) : zoomK0;
    const zoomK = c.zk;
    const elev = 0.56 - 0.1 * zoomK; // angle from the camera down to the neck
    const pitch = 0.36 - 0.05 * zoomK; // how far the camera looks down
    const F = HH / 2 / Math.tan(((CAM.fov / 2) * Math.PI) / 180); // focal length in pixels
    const dView = (F * span) / (CAM.fill * W); // depth that fits the span across the screen at the neck
    const td = dView / Math.cos(elev - pitch);
    if (!c.ready) Object.assign(c, { x: tx, d: td, vx: 0, vd: 0, ready: true });
    else {
      // a critically damped glide: quick to pull back, gentle coming in
      const w = td > c.d ? 4.2 : 2.2;
      for (let left = dt; left > 1e-6; left -= 1 / 120) {
        const st = Math.min(left, 1 / 120);
        c.vx += (4.2 * 4.2 * (tx - c.x) - 2 * 4.2 * c.vx) * st;
        c.x += c.vx * st;
        c.vd += (w * w * (td - c.d) - 2 * w * c.vd) * st;
        c.d += c.vd * st;
      }
    }
    const d = c.d;
    const yaw = CAM.yaw; // looking a touch left: the strings fall gently to the right, the highway leans in
    const target = [c.x, G.yMid, 0];
    const ce = Math.cos(elev);
    const pos = [target[0] + d * ce * Math.sin(yaw), target[1] + d * Math.sin(elev), -d * ce * Math.cos(yaw)];
    const look = [pos[0] - Math.sin(yaw) * Math.cos(pitch), pos[1] - Math.sin(pitch), pos[2] + Math.cos(yaw) * Math.cos(pitch)];
    // shift the picture (not the camera) so the neck sits low on the screen
    const neckAt = HH / 2 + F * Math.tan(elev - pitch);
    const dy = HH * (CAM.neckY + 0.04 * zoomK) - neckAt;
    R3.setCamera(pos, look, CAM.fov, 0, dy);
    // keep the gold fret numbers under the neck on screen at any window shape
    const below = R3.project(c.x, -0.25, -0.1);
    const numBottom = below[1] + 8 + Math.min(48, below[2] * 0.42 * laneW(Math.max(1, Math.round(FX(c.x)))));
    if (numBottom > HH - 10) R3.setCamera(pos, look, CAM.fov, 0, dy - (numBottom - (HH - 10)));
    G.camX = c.x;
    G.F = F;
    G.zoomK = zoomK;
    c.f = FX(c.x); // camera centre in frets (tests read this)
    c.px = scaleAt(c.x, G.yMid, 0); // pixels per unit at the neck (tests)
    H.projection = {
      point: (f, s, time) => {
        const p = R3.project(laneC(f), strH(s), zOf(time));
        return [p[0], p[1]];
      },
      neck: (f, s) => {
        const p = R3.project(laneC(f), strH(s), 0);
        return [p[0], p[1]];
      },
    };
  }

  const PX = (x, y, z) => R3.project(x, y, z)[0];
  const PY = (x, y, z) => R3.project(x, y, z)[1];
  const scaleAt = (x, y, z) => R3.project(x, y, z)[2];
  const rgba = (hex, a) => {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
  };

  function draw(t, dt) {
    const tab = H.tab;
    const T0 = performance.now();
    if (!tab) {
      drawBackdrop(t);
      R3.begin();
      R3.render(40, 1);
      return;
    }
    geometry(t);
    camera(t, dt);
    drawBackdrop(t);
    const T1 = performance.now();
    const a = anchorAt(t);
    let f0 = 0;
    let f1 = 24;
    while (f0 < 24 && PX(XF(f0 + 1), 0, 0) < -40) f0++;
    while (f1 > 0 && PX(XF(f1 - 1), 0, 0) > W + 40) f1--;
    G.f0 = f0;
    G.f1 = f1;
    R3.begin();
    buildFloor(t, a, f0, f1);
    buildNeck(t, a, f0, f1);
    buildNotes(t, a);
    buildLands(t, a);
    buildHits(t, a);
    drawNeckFront(t, a, f0, f1);
    drawLabels();
    drawHitsFront(t, a, dt);
    drawFire(a, dt);
    const T2 = performance.now();
    R3.render(G.zF, G.zs * PAST);
    const T3 = performance.now();
    const T4 = T3;
    const k = 0.9;
    const tm = (H.timing = H.timing || { venue: 0, build: 0, gpu: 0, text: 0 });
    tm.venue = tm.venue * k + (T1 - T0) * (1 - k);
    tm.build = tm.build * k + (T2 - T1) * (1 - k);
    tm.gpu = tm.gpu * k + (T3 - T2) * (1 - k);
    tm.text = tm.text * k + (T4 - T3) * (1 - k);
  }

  // labels gathered while building the scene, drawn on the 2D layer afterwards
  const labels = [];
  function label(text, x, y, z, opts) {
    labels.push({ text, x, y, z, ...opts });
  }
  // Text and badges: drawn once into images in a texture on the graphics
  // card (R3.text), then placed as flat quads each frame. Nothing is painted
  // on the processor while you play.
  const GB = 64; // base size the images are drawn at
  const measureCtx = document.createElement('canvas').getContext('2d');
  function glyph(text, style, weight) {
    const key = `${text}|${style}|${weight}`;
    const font = `${weight} ${GB}px ${FONT}`;
    measureCtx.font = font;
    const tw = measureCtx.measureText(text).width;
    const pill = style.startsWith('pill:');
    const disc = style === 'disc';
    const pad = style === 'glow' || style.startsWith('streak') ? 24 : pill ? 4 : 12;
    let w = Math.ceil(tw) + pad * 2 + (pill ? GB * 0.9 : 0);
    let hgt = GB + pad * 2;
    if (disc) w = hgt = GB * 1.4 + 8;
    return R3.text.image(key, w, hgt, (g, W2, H2) => {
      g.font = font;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const cx = W2 / 2;
      const cy = H2 / 2 + 3;
      if (disc) {
        g.beginPath();
        g.arc(cx, H2 / 2, GB * 0.66, 0, Math.PI * 2);
        g.fillStyle = 'rgba(245, 250, 255, 0.95)';
        g.fill();
        g.fillStyle = '#20252c';
        g.fillText(text, cx, cy);
        return;
      }
      if (pill) {
        rr(g, 2, H2 / 2 - GB * 0.62, W2 - 4, GB * 1.24, GB * 0.62);
        g.fillStyle = 'rgba(8, 12, 22, 0.85)';
        g.fill();
        g.fillStyle = style.slice(5);
        g.fillText(text, cx, cy);
        return;
      }
      if (style === 'plain') {
        g.fillStyle = 'rgba(90, 200, 205, 0.7)';
        g.fillText(text, cx, cy);
        return;
      }
      const grad = (a, b) => {
        const gr = g.createLinearGradient(0, cy - GB / 2, 0, cy + GB / 2);
        gr.addColorStop(0, a);
        gr.addColorStop(1, b);
        return gr;
      };
      if (style === 'glow') {
        g.shadowColor = 'rgba(255, 170, 30, 0.6)';
        g.shadowBlur = 16;
        g.fillStyle = grad('#ffe08a', '#f0a020');
        g.fillText(text, cx, cy);
        return;
      }
      g.lineJoin = 'round';
      g.lineWidth = GB * (style.startsWith('streak') ? 0.12 : 0.16);
      g.strokeStyle = 'rgba(5, 8, 15, 0.85)';
      g.strokeText(text, cx, cy);
      if (style === 'gold') g.fillStyle = grad('#ffe9a8', '#f3a51f');
      else if (style === 'grey') g.fillStyle = grad('#a0a4b4', '#6a6f82');
      else if (style === 'chord') g.fillStyle = grad('#ffffff', '#c9d2e6');
      else if (style === 'streakHot' || style === 'streakCool') {
        g.shadowColor = style === 'streakHot' ? '#ff7a1f' : '#4fe3ff';
        g.shadowBlur = 18;
        g.fillStyle = style === 'streakHot' ? grad('#fff3b0', '#ff6a1f') : grad('#ffffff', '#7fe8ff');
      } else g.fillStyle = style;
      g.fillText(text, cx, cy);
    });
  }
  const WHITE = [1, 1, 1, 1];
  const tint = (a) => (a >= 0.999 ? WHITE : [1, 1, 1, a]);
  /** Text at (x, y) screen pixels, fs tall; base 'middle' | 'top' | 'bottom'; align 'center' | 'left' | 'right'. */
  function txt(text, style, weight, x, y, fs, base = 'middle', alpha = 1, align = 'center') {
    if (alpha <= 0.01 || fs < 4) return;
    const gi = glyph(text, style, weight);
    const k = fs / GB;
    const dw = gi.w * k;
    const dh = gi.h * k;
    const top = base === 'top' ? y - dh * 0.18 : base === 'bottom' ? y - dh * 0.82 : y - dh / 2;
    const left = align === 'left' ? x : align === 'right' ? x - dw : x - dw / 2;
    R3.text.quad(gi, left, top, dw, dh, tint(alpha));
  }
  const blit = (text, style, weight, x, y, fs, base = 'middle') => txt(text, style, weight, x, y, fs, base);

  function drawLabels() {
    for (const l of labels) {
      const [sx, sy, sc, front] = R3.project(l.x, l.y, l.z);
      if (!front) continue;
      const fs = Math.round(Math.max(l.min || 10, Math.min(l.max || 36, (l.size || 0.4) * sc)));
      if (fs < (l.hide || 0)) continue;
      const y = sy + (l.dy || 0) * fs;
      const style = l.pill ? `pill:${l.color || '#ffe2b0'}` : l.gold ? (l.grey ? 'grey' : 'gold') : l.color || '#ffffff';
      txt(l.text, style, l.weight || 900, sx, y, fs, l.base || 'middle', l.alpha ?? 1);
    }
    labels.length = 0;
  }

  /** Flames off the neck outside your hand position, and the streak badge. */
  function drawFire(a, dt) {
    const yTop = PY(anX0(a), nY(G.n - 1) + 0.3, 0);
    const yBot = PY(anX0(a), -0.25, 0);
    const ha = PX(anX0(a), -0.25, 0);
    const hb = PX(anX1(a), -0.25, 0);
    const n0 = Math.max(0, PX(XF(0), -0.25, 0));
    // the fire is the one thing still drawn in 2D, and only while it burns
    if (G.heat > 0.01 || H.fireOn) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, HH);
      fire.update(Math.min(0.05, dt || 0.016), G.heat, [[n0, ha - 24], [hb + 24, W]], yBot + 2);
      fire.draw(ctx);
      H.fireOn = G.heat > 0.01;
    }
    const streak = H.forceStreak ?? (H.judge && prefs.detect && rig.on ? H.judge.streak : 0);
    if (streak >= 8) {
      const hot = G.heat;
      const fs = Math.round(Math.min(40, HH * 0.04) * (1 + 0.08 * G.pulse));
      const x = W - 40;
      const y = Math.min(yTop - 24, HH * 0.62);
      txt(String(streak), hot > 0.5 ? 'streakHot' : 'streakCool', 900, x, y, fs * 1.3, 'bottom', 1, 'right');
      txt(hot >= 0.99 ? 'ON FIRE' : 'IN A ROW', hot > 0.5 ? '#ffb070' : '#aae6ff', 800, x, y + fs * 0.35, fs * 0.4, 'middle', 1, 'right');
    }
  }

  // The venue behind the highway, lit by the beat and by how well you're playing.
  const venue = createVenue();
  const fire = createFire();
  function beatPulse(t) {
    const B = (H.tab && H.tab.beats) || [];
    const i = lower(B, t + 0.0001) - 1;
    if (i < 0 || !stage.engine.playing) return 0;
    const k = Math.max(0, t - B[i].t);
    return Math.exp(-k * (B[i].m >= 0 ? 5 : 7)) * (B[i].m >= 0 ? 1 : 0.65);
  }
  function drawBackdrop(t) {
    const streak = H.forceStreak ?? (H.judge && prefs.detect && rig.on ? H.judge.streak : 0);
    const want = Math.max(0, Math.min(1, (streak - 8) / 32));
    H.heat = (H.heat || 0) + (want - (H.heat || 0)) * (want < (H.heat || 0) ? 0.08 : 0.03);
    G.heat = prefs.fx ? H.heat : 0;
    G.pulse = beatPulse(t || 0);
    const v = VENUES.find((x) => x.id === (VENUE_ALIAS[prefs.venue] || prefs.venue || 'warehouse'));
    // the picture's floor line goes where the highway's far end meets the floor; it drifts a little with the camera
    const vpY = H.tab && G.zF ? R3.project(G.camX || 0, 0, G.zF * 0.8)[1] : HH * 0.4;
    R3.setVenue(v && (v.photo || v.fluid) ? v : null, vpY, ((G.camX || 0) - 10) / 14, G.pulse * 0.5, G.heat * 0.5);
    if (v?.scene && H.open) {
      dropFluid();
      const now = performance.now();
      feat.update(stage.engine, rig, now);
      visuals.draw(v.scene, feat, now);
    } else {
      visuals.drop();
      if (v?.fluid && H.open) driveFluid(t || 0); else dropFluid();
    }
  }

  // Audio-driven backgrounds follow the audible song bus and processed instrument.
  const fluid = createFluid(root);
  const feat = createFeatures(); // one reading of the music shared by Fluid and the scenes
  const visuals = createVisuals(root, { highway: true });
  const ink = createFluidDriver({ highway: true });
  H.feat = feat;
  H.prefs = prefs; // for the tests
  function dropFluid() {
    fluid.drop();
  }
  function driveFluid() {
    fluid.ensure();
    const now = performance.now();
    feat.update(stage.engine, rig, now);
    if (!fluid.ready || now - (H.inkAt || 0) < 40) return;
    H.inkAt = now;
    fluid.send(ink(feat, now / 1000));
  }

  /** Cyan edges that warm to orange as you heat up. */
  const RAIL = '#50e8ff';
  const RAIL_HOT = '#ff963c';
  const railCol = (a, k = 1) => mix(RAIL, RAIL_HOT, G.heat || 0, a, k);
  function railColor(a) {
    const k = G.heat || 0;
    return `rgba(${Math.round(80 + 175 * k)}, ${Math.round(232 - 82 * k)}, ${Math.round(255 - 195 * k)}, ${a})`;
  }

  // ------------------------------------------------------------ floor --
  function buildFloor(t, a, f0, f1) {
    const { floor, glow } = R3.L;
    const zF = G.zF;
    const zN = -G.zs * PAST;
    // every fret's line runs off to the vanishing point, faint
    const lineC = col('#5ad2eb', 0.1);
    for (let f = 0; f <= 24; f++) floor.bar([XF(f), 0, zN], [XF(f), 0, zF], 0.035, lineC);
    // hand positions: dark blue channels, one per fret, bright edges, stepping across the floor
    const A = H.tab.anchors || [];
    for (let i = Math.max(0, lower(A, t) - 1); i < A.length && A[i].t < t + G.L; i++) {
      const an = A[i];
      const za = Math.max(zN, zOf(an.t));
      const next = A[i + 1];
      const zb = Math.min(zF, zOf(next ? next.t : an.end || an.t + 600));
      if (zb <= za) continue;
      const xa = anX0(an);
      const xb = anX1(an);
      for (let f = an.fret; f < an.fret + (an.width || 4); f++) {
        const l = XF(f - 1);
        const r = XF(f);
        const w = r - l;
        floor.flat(l, r, za, zb, 0.002, col('#0f3346', 0.92), col('#0b2838', 0.92));
        floor.flat(l + w * 0.18, r - w * 0.18, za, zb, 0.004, col('#3c8cb4', 0.16), col('#3c8cb4', 0.08));
      }
      for (let f = an.fret; f < an.fret - 1 + (an.width || 4); f++) floor.bar([XF(f), 0.006, za], [XF(f), 0.006, zb], 0.04, col('#78e6ff', 0.55));
      // the bright rails
      for (const x of [xa, xb]) {
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.07, railCol(0.95, 1.1));
        glow.bar([x, 0.01, za], [x, 0.01, zb], 0.26, railCol(0.14, 1));
      }
      // a new hand position: a light bar across its front edge and its fret numbers on the floor
      if (za > G.zs * 0.3 && za < zF * 0.9) {
        floor.bar([xa, 0.008, za], [xb, 0.008, za], 0.07, railCol(0.8, 1.2));
        glow.bar([xa, 0.01, za], [xb, 0.01, za], 0.25, railCol(0.2));
        const inA = (f) => f >= an.fret && f < an.fret + (an.width || 4);
        for (let f = Math.max(1, an.fret - 4); f <= Math.min(24, an.fret + (an.width || 4) + 4); f++) {
          if (!inA(f) && !INLAYS.includes(f)) continue;
          label(String(f), laneC(f), 0, za - 0.35, { size: 0.42 * laneW(f), min: 9, max: 26, weight: 800, color: inA(f) ? '#ffffff' : 'rgba(90, 210, 220, 0.8)', alpha: Math.max(0, Math.min(1, (zF - za) / (zF * 0.45))) });
        }
      }
    }
    // beat lines across the hand position: bars brighter
    const beats = H.tab.beats || [];
    for (let i = lower(beats, t); i < beats.length && beats[i].t < t + G.L; i++) {
      const z = zOf(beats[i].t);
      if (z < 0.05) continue;
      const bar = beats[i].m >= 0;
      const an = anchorAt(beats[i].t);
      floor.bar([anX0(an), 0.007, z], [anX1(an), 0.007, z], bar ? 0.06 : 0.03, col('#a0ebff', bar ? 0.45 : 0.16));
    }
  }

  // ------------------------------------------------------------- neck --
  function buildNeck(t, a, f0, f1) {
    const { solid, alpha, glow } = R3.L;
    const n = G.n;
    const xn = XF(-3);
    const xe = XF(24) + 0.8;
    const yb = -0.25;
    const yt = G.yTop + 0.32;
    // your hand position, faintly lit on the neck
    alpha.up(anX0(a), anX1(a), yb, yt, 0.06, col('#46c8ff', 0.05), col('#46c8ff', 0.1));
    // inlay panels behind the strings: gold in your hand position, teal elsewhere
    for (const f of INLAYS) {
      if (f < f0 - 1 || f > f1 + 1) continue;
      const inA = f >= a.fret && f < a.fret + (a.width || 4);
      const w = laneW(f);
      const c = laneC(f);
      alpha.up(c - w * 0.3, c + w * 0.3, G.hl - 0.05, G.yTop + 0.05, 0.05, inA ? col('#ffc446', 0.3) : col('#50c8d2', 0.12), inA ? col('#ffc446', 0.14) : col('#50c8d2', 0.05));
    }
    // fret wires: slim metal rods standing across the strings, the nut ivory.
    // (3.13: they were deep, near-black boxes; seen from the side near the camera
    // their sides showed as big black slabs beside the highway)
    for (let f = Math.max(0, f0 - 1); f <= Math.min(24, f1 + 1); f++) {
      const x = XF(f);
      const hw = f === 0 ? 0.04 : 0.024;
      const dz = f === 0 ? 0.04 : 0.012;
      solid.box(x - hw, x + hw, yb, yt, -dz, dz, f === 0 ? col('#8a8476') : col('#55555f'), f === 0 ? col('#c8c0aa') : col('#8a8378'), f === 0 ? col('#5a5548') : col('#3c3c46'));
      if (f > 0) solid.up(x - hw * 0.35, x + hw * 0.35, yb, yt, -0.045, col('#6e675d', 1));
    }
    // strings: thin and coloured, a touch thicker toward the low E, with a soft glow
    for (let s = 0; s < n; s++) {
      const y = strH(s);
      const th = (n === 4 ? 0.021 : 0.016) - s * (n === 4 ? 0.0025 : 0.0016);
      solid.box(xn, xe, y - th, y + th, -th, th, col(STRING[s], 1, 0.5), col(STRING[s], 1, 0.68), col(STRING[s], 1, 0.38));
      glow.up(xn, xe, y - th * 2.5, y + th * 2.5, -0.05, col(STRING[s], 0.08));
    }
    // the hand position's edges at the neck: two white posts, the same height as
    // the frets (3.12: they used to stand taller, which looked off to the user)
    for (const x of [anX0(a), anX1(a)]) {
      solid.box(x - 0.025, x + 0.025, yb, yt, -0.08, -0.02, col('#fff0f8', 1, 1.0));
      glow.up(x - 0.1, x + 0.1, yb, yt, -0.085, col('#ff7ad2', 0.12), col('#50e8ff', 0.1));
    }

  }

  /** In front of the neck: fret numbers, the next chord's name, finger numbers as a chord lands. */
  function drawNeckFront(t, a, f0, f1) {
    const T = H.targets;
    const yb = -0.25;
    const inA = (f) => f >= a.fret && f < a.fret + (a.width || 4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let f = Math.max(1, f0); f <= f1; f++) {
      if (!inA(f) && !INLAYS.includes(f)) continue;
      const [x, y0, sc] = R3.project(laneC(f), yb, -0.1);
      if (x < 14 || x > W - 14) continue;
      const big = inA(f);
      const fs = Math.round(Math.max(14, Math.min(big ? 48 : 30, sc * (big ? 0.42 : 0.3) * laneW(f))));
      blit(String(f), big ? 'glow' : 'plain', big ? 900 : 700, x, y0 + 6, fs, 'top');
    }
    // finger numbers on the neck: the coming chord's, or the shape you're holding
    const fingers = new Map();
    const HS = H.tab.handShapes || [];
    const hi = lower(HS, t + 0.0001, 'start') - 1;
    const hs = hi >= 0 && t < HS[hi].end ? HS[hi] : null;
    const shape = hs && H.tab.chords[hs.chord];
    if (shape && shape.frets) shape.frets.forEach((f, s) => {
      const finger = shape.fingers && shape.fingers[s];
      if (f > 0 && finger > 0) fingers.set(s, { f, finger, alpha: 0.55 });
    });
    let nextChord = null;
    for (let i = lower(T, t - 0.08); i < T.length && T[i].t < t + 0.45; i++) {
      if (T[i].kind === 'chord') {
        nextChord = T[i];
        break;
      }
    }
    if (nextChord) {
      const sh = H.tab.chords[nextChord.chord];
      fingers.clear();
      for (const nt of nextChord.notes) {
        const finger = sh && sh.fingers && sh.fingers[nt.s];
        if (nt.f > 0 && finger > 0) fingers.set(nt.s, { f: nt.f, finger, alpha: 0.95 });
      }
    }
    for (const [s, finger] of fingers) {
      const [px, py, sc] = R3.project(laneC(finger.f), strH(s), -0.1);
      const fs = Math.max(14, Math.min(34, G.gap * sc * 0.8));
      txt(String(finger.finger), 'disc', 800, px, py, fs * 1.4 / 1.4, 'middle', finger.alpha);
    }
    // the coming chord's name: small, just above the strings at your hand position (as in Rocksmith)
    if (prefs.chordNames !== false) {
      for (let i = lower(T, t - 0.05); i < T.length && T[i].t < t + 1.6; i++) {
        const tg = T[i];
        if (tg.kind !== 'chord' || !tg.name) continue;
        const k = Math.min(1, (1.6 - (tg.t - t)) / 0.4);
        const an = anchorAt(tg.t);
        const [x, y, sc] = R3.project(anX0(an), G.yTop + G.gy * 1.3, -0.1);
        const fs = Math.round(Math.max(18, Math.min(30, sc * 0.42)));
        txt(tg.name, 'chord', 900, x - 12, y, fs, 'bottom', Math.max(0, k), 'right');
        break;
      }
    }
  }

  // ------------------------------------------------------------- notes --
  /** Bend (in half steps) of a note at song time `time`, from its real bend curve. */
  const bendAt = bendValue;
  const bendLabel = (b) => ({ 0.5: '¼', 1: '½', 1.5: '¾', 2: 'full', 3: '1½', 4: '2' })[b] || `${b / 2}`;
  const maxBend = (nt) => (nt.bends && nt.bends.length ? Math.max(...nt.bends.map((p) => p.step)) : nt.bend || 0);
  const judged = (tg) => (H.judge && prefs.detect && rig.on ? H.judge.state.get(tg.id) : null);
  const isChord = (tg) => tg.kind === 'chord' || (tg.kind === 'mute' && tg.notes.length > 1);

  function buildNotes(t, a) {
    const T = H.targets;
    const zF = G.zF;
    const i0 = lower(T, t - PAST);
    const sustain0 = firstSustain(H.sustainEnds || [], t);
    const i1 = lower(T, t + G.L);
    // sustain ribbons, under the gems
    for (let i = sustain0; i < i1; i++) {
      const tg = T[i];
      if (!tg.sus || tg.sus < 0.06) continue;
      const t0 = Math.max(tg.t, t);
      const t1 = Math.min(tg.t + tg.sus, t + G.L);
      if (t1 <= t0) continue;
      const an = anchorAt(tg.t);
      const st = judged(tg);
      for (const nt of tg.notes) {
        const end = Math.min(t1, noteEnd(nt, tg));
        if (end > t0) buildTrail(nt, tg, t0, end, an, st);
      }
    }
    for (let i = i1 - 1; i >= i0; i--) {
      const tg = T[i];
      const z = zOf(tg.t);
      if (z > zF) continue;
      const st = judged(tg);
      const missed = st && st.result === 'miss';
      const hit = st && st.result === 'hit';
      if (z < 0 && hit && t - tg.t > PAST * 0.6) continue; // a hit note bursts on the neck instead
      const an = anchorAt(tg.t);
      if (isChord(tg)) buildChord(tg, z, an, missed);
      else for (const nt of tg.notes) buildGem(nt, z, an, missed, tg.kind === 'mute');
    }
  }

  /**
   * A note's sustain from t0 to t1 (song times): a flat glowing ribbon at its
   * string's height. Each technique has its own look, so they read at a glance:
   * a bend climbs (with ↑ and how far), vibrato snakes side to side in a smooth
   * wave, tremolo picking is cut into quick bright stripes like a ladder.
   */
  function buildTrail(nt, tg, t0, t1, an, st) {
    const { alpha, glow } = R3.L;
    const open = nt.f === 0;
    const missed = st && st.result === 'miss';
    const holding = st && st.result === 'hit' && G.t >= tg.t;
    const hex = missed ? '#5a6078' : STRING[nt.s];
    const x0 = noteX(nt, an);
    const slideTo = nt.slideTo !== undefined ? nt.slideTo : nt.slideUnpitchTo;
    const x1 = slideTo !== undefined ? laneC(Math.max(1, slideTo)) : x0;
    const half = open ? 0.5 * (anX1(an) - anX0(an)) - 0.15 : laneW(Math.max(1, nt.f)) * 0.16;
    const L0 = level(nt.s);
    const lw = laneW(Math.max(1, nt.f || an.fret));
    const duration = noteEnd(nt, tg) - tg.t;
    const vib = !!nt.vibrato && !open;
    // vibrato: ~2 waves per world-second of travel, wide enough to see from the back
    const VIB_HZ = 5.5;
    const vibAmp = lw * 0.25;
    const posAt = (time) => {
      const u = duration > 0 ? (time - tg.t) / duration : 0;
      const e = Math.min(1, Math.max(0, u));
      let x = x0 + (x1 - x0) * (e * e * (3 - 2 * e));
      if (vib) x += Math.sin((time - tg.t) * Math.PI * 2 * VIB_HZ) * vibAmp * Math.min(1, Math.max(0, (time - tg.t) / 0.12));
      const bend = bendAt(nt,time);
      const direction = L0 > (G.n-1)/2 ? -1 : 1; // push lower strings inward; pull upper strings inward
      const L = L0 + direction * bend * .70;
      return [x, nY(L) - G.gy * 0.12, zOf(time), L];
    };
    // enough points for the vibrato wave to stay smooth (no stepping)
    const steps = Math.max(6, Math.min(vib ? 360 : 120, Math.round((t1 - t0) * (vib ? VIB_HZ * 14 : 40))));
    const bending = maxBend(nt) > 0;
    let prev = null;
    let peak = null;
    for (let k = 0; k <= steps; k++) {
      const p = posAt(t0 + ((t1 - t0) * k) / steps);
      const L = p[3];
      if (!peak || Math.abs(L - L0) > Math.abs(peak.L - L0)) peak = { p, L };
      if (prev) {
        // a bend glows warmer and brighter the higher it goes
        const lift = bending ? Math.min(1, Math.abs(L - L0) / 1.5) : 0;
        const c = col(hex, holding ? 0.75 : 0.58, (holding ? 1.3 : 1) + lift * 0.5);
        alpha.quad([prev[0] - half, prev[1], prev[2]], [prev[0] + half, prev[1], prev[2]], [p[0] + half, p[1], p[2]], [p[0] - half, p[1], p[2]], c);
        const ec = missed ? col('#7a7f96', 0.8) : lift > 0.05 ? col('#fff3d6', 0.95, 1.4 + lift) : col(hex, 0.95, holding ? 2.2 : 1.5);
        for (const side of [-1, 1]) alpha.bar([prev[0] + side * half, prev[1] + 0.002, prev[2]], [p[0] + side * half, p[1] + 0.002, p[2]], vib ? 0.05 : 0.035, ec);
        if (!missed) glow.quad([prev[0] - half * 1.6, prev[1], prev[2]], [prev[0] + half * 1.6, prev[1], prev[2]], [p[0] + half * 1.6, p[1], p[2]], [p[0] - half * 1.6, p[1], p[2]], col(hex, holding ? 0.3 : 0.12));
      }
      prev = p;
    }
    if (nt.tremolo && !missed) {
      // tremolo picking: a stripe across the ribbon for every quick pick (fixed spacing in time, so it never shimmers)
      const RATE = 12;
      const first = Math.ceil((t0 - tg.t) * RATE);
      const last = Math.floor((t1 - tg.t) * RATE);
      for (let k = Math.max(1, first); k <= last; k++) {
        const p = posAt(tg.t + k / RATE);
        const w = half * 1.55;
        glow.bar([p[0] - w, p[1] + 0.004, p[2]], [p[0] + w, p[1] + 0.004, p[2]], 0.11, col('#ffffff', 0.85, holding ? 1.8 : 1.3));
      }
    }
    const mb = maxBend(nt);
    if(mb>0 && peak){
      const p=posAt(Math.max(t0,tg.t));
      alpha.bar([p[0],nY(L0)-G.gy*.12,p[2]],[p[0],p[1],p[2]],.045,col('#fff3d6',.8));
    }
    if (mb > 0 && peak && peak.p[2] >= 0) label(`↑${bendLabel(mb)}`, peak.p[0], peak.p[1] + G.gy * 0.4, peak.p[2], { size: 0.32, min: 12, max: 26, color: '#fff3d6', base: 'bottom' });
  }

  /**
   * A note: a glassy block in its string's colour at its string's height in
   * its fret's lane, facing you, with a bright rim; a thin stem down to the
   * floor with its fret number there.
   */
  function buildGem(nt, z, an, missed, mute, inChord = false, box = null, flare = 0, fade = 1) {
    // held on from the note before (linkNext): no new gem, its sustain just carries on
    if (nt.linked) return;
    const { solid, alpha, glow } = R3.L;
    const s = nt.s;
    const hex = missed ? '#5a6078' : STRING[s];
    const dark = missed ? '#3c4050' : STRING_DARK[s];
    const near = Math.max(0, 1 - Math.abs(z) / (G.zs * 0.5));
    const big = 1 + flare * 0.25;
    const y = strH(s);
    const DEPTH = 0.14;
    const rimK = (missed ? 0.8 : 1.4 + 0.8 * near + 2 * flare) * fade;
    if (nt.f === 0) {
      // an open string: a bar across the hand position (or the chord's frame)
      const xa = (box ? box[0] : anX0(an)) + 0.1;
      const xb = (box ? box[1] : anX1(an)) - 0.1;
      const hh = G.gy * 0.14 * big;
      solid.box(xa, xb, y - hh, y + hh, z, z + DEPTH, mix(dark, hex, 0.42, fade), col(hex, fade, 1.2), col(dark, fade));
      glow.up(xa, xb, y - hh, y + hh, z - 0.005, col(hex, 0.55 * fade * (missed ? 0.3 : 1), rimK));
      return;
    }
    const x = laneC(nt.f);
    const lw = laneW(nt.f);
    const hw = lw * (inChord ? 0.27 : 0.3) * big;
    const hh = G.gy * (inChord ? 0.4 : 0.44) * big;
    if (!inChord && z > G.zs * 0.1 && z < G.zF * 0.75) {
      // a thin stem down to the floor, a mark in the lane, and the fret number there
      alpha.up(x - 0.012, x + 0.012, 0, y - hh, z + DEPTH * 0.5, col(hex, 0.75));
      alpha.flat(x - lw * 0.32, x + lw * 0.32, z - 0.05, z + 0.09, 0.012, col(hex, 0.55));
      label(mute || nt.mute ? '×' : String(nt.f), x, 0, z - 0.3, { size: 0.42 * lw, min: 11, max: 36, gold: true, grey: missed });
    }
    // the block: dark glass front, lit top, darker sides
    solid.box(x - hw, x + hw, y - hh, y + hh, z, z + DEPTH, mix(dark, hex, missed ? 0.15 : 0.42, fade, 1 + 0.3 * near), col(hex, fade, 1.1), col(dark, fade, 0.85));
    // bright rim around the front, and a light bar across the middle
    const rim = Math.min(hw, hh) * 0.3;
    const rc = flare > 0.05 ? col('#ffffff', fade, rimK) : col(hex, fade, rimK);
    const zf = z - 0.006;
    glow.up(x - hw, x + hw, y + hh - rim, y + hh, zf, rc);
    glow.up(x - hw, x + hw, y - hh, y - hh + rim, zf, rc);
    glow.up(x - hw, x - hw + rim, y - hh, y + hh, zf, rc);
    glow.up(x + hw - rim, x + hw, y - hh, y + hh, zf, rc);
    glow.up(x - hw * 0.55, x + hw * 0.55, y - rim * 0.45, y + rim * 0.45, zf, col(hex, fade * 0.9, rimK * 0.9));
    if (!missed && near > 0.05) glow.up(x - hw * 1.8, x + hw * 1.8, y - hh * 1.8, y + hh * 1.8, z + 0.01, col(hex, 0.12 * near * fade));
    if (nt.accent && !missed) {
      const p = rim * 1.6;
      for (const [a0, a1, b0, b1] of [[x - hw - p, x + hw + p, y + hh + p * 0.4, y + hh + p], [x - hw - p, x + hw + p, y - hh - p, y - hh - p * 0.4], [x - hw - p, x - hw - p * 0.4, y - hh - p, y + hh + p], [x + hw + p * 0.4, x + hw + p, y - hh - p, y + hh + p]]) glow.up(a0, a1, b0, b1, zf, col('#ffffff', 0.9 * fade, 1.5));
    }
    const tech = nt._tech || (nt._tech = noteTech(nt));
    if (tech.bend > 0 && !missed) {
      // a bend (also one coming later on a note held from this one): a bright upward chevron on the note's face
      const cy = y + hh * 0.05;
      const ac = col('#fff3d6', fade, 1.6);
      glow.bar([x - hw * 0.55, cy - hh * 0.35, zf - 0.003], [x, cy + hh * 0.45, zf - 0.003], rim * 0.95, ac, undefined, 'z');
      glow.bar([x, cy + hh * 0.45, zf - 0.003], [x + hw * 0.55, cy - hh * 0.35, zf - 0.003], rim * 0.95, ac, undefined, 'z');
    }
    if (mute || nt.mute) {
      glow.bar([x - hw * 0.5, y - hh * 0.6, zf - 0.002], [x + hw * 0.5, y + hh * 0.6, zf - 0.002], rim * 0.9, col('#ffffff', fade, 1.3), undefined, 'z');
      glow.bar([x - hw * 0.5, y + hh * 0.6, zf - 0.002], [x + hw * 0.5, y - hh * 0.6, zf - 0.002], rim * 0.9, col('#ffffff', fade, 1.3), undefined, 'z');
    }
    // technique tags above the note
    if (!inChord && z > 0.2) {
      const marks = [];
      if (nt.hammerOn) marks.push('H');
      if (nt.pullOff) marks.push('P');
      if (nt.tap) marks.push('T');
      if (nt.palmMute) marks.push('PM');
      if (nt.harmonic) marks.push('◆');
      if (nt.pinchHarmonic) marks.push('PH');
      if (nt.slap) marks.push('S');
      if (nt.pop) marks.push('Pop');
      // every technique shows on the gem, together (a bend with vibrato says both), even
      // when it happens later on a note held on from this one
      if (tech.bend) marks.push(`${tech.pre ? 'pre ' : ''}↑${bendLabel(tech.bend)}${tech.release ? '↓' : ''}`);
      if (tech.vibrato) marks.push('~');
      if (nt.tremolo) marks.push('///');
      if (tech.slide && !(nt.sus > 0.06 && !nt.chain)) marks.push(tech.slide === 'up' ? '↗' : '↘');
      if (marks.length) label(marks.join(' '), x, y + hh + G.gy * 0.35, z, { size: 0.24, min: 12, max: 20, hide: 11, weight: 800, pill: true });
    }
  }

  /** Where a chord's frame sits across the neck. */
  function chordBox(tg, an) {
    const [left, right] = chordSpan(tg.notes, an);
    return [XF(left), XF(right)];
  }

  /**
   * A chord: an upright glowing frame standing on the highway across the
   * hand position, from the floor to just above the top string. The first
   * of a run holds its notes; repeats are lower, empty frames, so the
   * strumming reads as steps.
   */
  function buildChord(tg, z, an, missed, flare = 0) {
    const { alpha, glow, solid } = R3.L;
    const [xa, xb] = chordBox(tg, an);
    // as in the game, the frame reaches just above the highest string the chord uses
    const topL = Math.max(...tg.notes.map((nt) => level(nt.s)));
    const yT = nY(topL) + G.gy * 0.55;
    const DZ = 0.3;
    const accent = tg.notes.some((x) => x.accent);
    const ec = missed ? col('#6e748c', 0.9) : railCol(1, 0.85 + 2 * flare);
    const w = 0.04;
    // smoked glass inside, the top face, and a dimmer back frame for depth
    alpha.up(xa, xb, 0, yT, z, missed ? col('#3a3e4c', 0.3) : col('#0b2a36', 0.42), missed ? col('#3a3e4c', 0.3) : col('#103a48', 0.42));
    alpha.flat(xa, xb, z, z + DZ, yT, missed ? col('#5a6078', 0.25) : col('#0e3646', 0.6));
    const bc = missed ? col('#6e748c', 0.4) : railCol(0.5, 0.9);
    for (const [p, q] of [[[xa, 0, z + DZ], [xa, yT, z + DZ]], [[xb, 0, z + DZ], [xb, yT, z + DZ]], [[xa, yT, z + DZ], [xb, yT, z + DZ]]]) alpha.bar(p, q, w * 0.7, bc, bc, 'z');
    alpha.bar([xa, yT, z], [xa, yT, z + DZ], w, bc);
    alpha.bar([xb, yT, z], [xb, yT, z + DZ], w, bc);
    // the front frame, glowing
    solid.box(xa - w, xa + w, 0, yT + w, z - w, z + w, ec);
    solid.box(xb - w, xb + w, 0, yT + w, z - w, z + w, ec);
    solid.box(xa - w, xb + w, yT - w, yT + w, z - w, z + w, ec);
    if (!missed) {
      const gc = railCol(0.1 + 0.3 * flare);
      glow.up(xa - 0.12, xa + 0.12, 0, yT + 0.1, z - 0.01, gc);
      glow.up(xb - 0.12, xb + 0.12, 0, yT + 0.1, z - 0.01, gc);
      glow.up(xa - 0.12, xb + 0.12, yT - 0.1, yT + 0.12, z - 0.01, gc);
    }
    if (accent && !missed) {
      const p = 0.09;
      const c = col('#ffffff', 0.85, 1.2);
      glow.up(xa - p - 0.03, xb + p + 0.03, yT + p, yT + p + 0.03, z - 0.01, c);
      glow.up(xa - p - 0.03, xa - p, 0, yT + p + 0.03, z - 0.01, c);
      glow.up(xb + p, xb + p + 0.03, 0, yT + p + 0.03, z - 0.01, c);
    }
    if (tg.kind === 'mute') label('×', (xa + xb) / 2, yT / 2, z, { size: 0.5, min: 12, max: 40 });
    if (tg.repeat) return; // the same chord again: just its frame, so the rhythm reads at a glance
    if (z > G.zs * 0.15) {
      for (const f of [...new Set(tg.notes.filter((n) => n.f > 0).map((n) => n.f))]) label(String(f), laneC(f), 0, z - 0.3, { size: 0.32, min: 8, max: 28, hide: 9, weight: 800, color: '#f4cf75' });
    }
    for (const nt of tg.notes) buildGem(nt, z, an, missed, tg.kind === 'mute', true, [xa, xb], flare);
    if (tg.name && z > 0.2 && prefs.chordLabels) label(tg.name, xa + 0.6, yT + G.gy * 0.5, z, { size: 0.24, min: 11, max: 22, hide: 11, weight: 800, pill: true, color: '#ffffff' });
  }

  // --------------------------------------------------------- hit feel --
  // The moment a note lands and you hit it, its string blazes along its whole
  // length, light posts stand at its fret, the note flares on the neck and
  // sparks fly. A held note keeps its string lit. Miss it and nothing lights:
  // the note passes the neck, grey.
  const sparks = [];
  function onJudged(e) {
    extras.judged(e);
    const tg = H.targets[e.id];
    if (!tg) return;
    if (e.hit) for (const n of tg.notes) if (!n.mute) feat.note(n.s, n.f, true);
    const now = performance.now();
    const st = H.judge && H.judge.state.get(e.id);
    if (!e.hit) {
      H.misses = (H.misses || []).filter((m) => now - m.at < 600);
      H.misses.push({ id: e.id, at: now });
      return;
    }
    const chord = isChord(tg);
    H.hits.push({ id: e.id, at: now, chord, until: tg.t + (tg.sus || 0), offset: st ? st.offset : null });
    for (const nt of tg.notes) H.bursts.push({ s: nt.s, f: nt.f, at: now, until: tg.t + (tg.sus || 0) });
    if (!G.F || !R3) return;
    const an = anchorAt(tg.t);
    for (const nt of tg.notes) {
      const [px, py] = R3.project(noteX(nt, an), strH(nt.s), 0);
      const n = chord ? 2 : 4;
      for (let k = 0; k < n; k++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const sp = 65 + Math.random() * 110;
        sparks.push({ x: px, y: py, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: 0.18 + Math.random() * 0.16, col: Math.random() < 0.35 ? '#ffffff' : STRING[nt.s] });
      }
    }
    if (sparks.length > 400) sparks.splice(0, sparks.length - 400);
  }

  function buildHits(t, a) {
    const { glow, solid } = R3.L;
    const now = performance.now();
    H.hits = H.hits.filter((h) => now - h.at < 700 || t < h.until);
    H.bursts = H.bursts.filter((b) => now - b.at < 700 || t < b.until);
    // 1. the string blazes along its whole length, hottest at the note
    const byString = new Map();
    for (const b of H.bursts) {
      const k = Math.max(Math.exp(-(now - b.at) / 150)*.38, t < b.until ? .12 : 0);
      if (k < 0.02) continue;
      const cur = byString.get(b.s);
      if (!cur || cur.k < k) byString.set(b.s, { k, b });
    }
    const xn = XF(-3);
    const xe = XF(24) + 0.8;
    for (const [s, { k, b }] of byString) {
      const y = strH(s);
      glow.quad([xn, y - G.gy * 0.45, -0.06], [xe, y - G.gy * 0.45, -0.06], [xe, y, -0.06], [xn, y, -0.06], col(STRING[s], 0), col(STRING[s], 0), col(STRING[s], 0.45 * k), col(STRING[s], 0.45 * k));
      glow.quad([xn, y, -0.06], [xe, y, -0.06], [xe, y + G.gy * 0.45, -0.06], [xn, y + G.gy * 0.45, -0.06], col(STRING[s], 0.45 * k), col(STRING[s], 0.45 * k), col(STRING[s], 0), col(STRING[s], 0));
      glow.up(xn, xe, y - 0.02, y + 0.02, -0.065, col('#ffffff', 0.9 * k, 1.5));
      const x = b.f === 0 ? noteX(b, a) : laneC(b.f);
      const r = laneW(Math.max(1, b.f || a.fret)) * (0.7 + 0.4 * k);
      glow.up(x - r, x + r, y - r * 0.5, y + r * 0.5, -0.07, col(STRING[s], 0.5 * k, 1.6));
    }
    // 2. light posts at the fret wires around what you hit (the chord's box for a chord)
    const posts = new Map();
    for (const h of H.hits) {
      const tg = H.targets[h.id];
      const k = Math.max(Math.exp(-(now - h.at) / 180)*.4, t < h.until ? .12 : 0);
      if (k < 0.03) continue;
      const an = anchorAt(tg.t);
      const xs = h.chord ? chordBox(tg, an) : tg.notes.flatMap((nt) => (nt.f === 0 ? [anX0(an), anX1(an)] : [XF(nt.f - 1), XF(nt.f)]));
      for (const x of xs) posts.set(x.toFixed(3), Math.max(posts.get(x.toFixed(3)) || 0, k));
    }
    for (const [xs, k] of posts) {
      const x = Number(xs);
      solid.box(x - 0.035, x + 0.035, -0.2, G.yTop + 0.9, -0.1, -0.03, col('#fff0f8', k, 2.2));
      glow.up(x - 0.18, x + 0.18, -0.2, G.yTop + 0.95, -0.11, col('#ff5aaa', 0.4 * k, 1.3), col('#ff5aaa', 0.1 * k));
    }
    // 3. the note flares on the neck: a bright pop, held while you sustain
    for (const h of H.hits) {
      const tg = H.targets[h.id];
      const age = (now - h.at) / 1000;
      const holding = t < h.until;
      const k = Math.max(Math.exp(-age / 0.16)*.4, holding ? .15 : 0);
      if (k < 0.04) continue;
      const an = anchorAt(tg.t);
      const fl = Math.exp(-age / 0.12)*.4;
      if (h.chord) {
        const box = chordBox(tg, an);
        for (const nt of tg.notes) buildGem(nt, -0.02, an, false, false, true, box, fl, Math.min(1, k * 1.2));
      } else for (const nt of tg.notes) buildGem(nt, -0.02, an, false, tg.kind === 'mute', true, null, fl, Math.min(1, k * 1.2));
    }
  }

  /** Sparks, MISS and EARLY / LATE on the 2D layer. */
  function drawHitsFront(t, a, dt) {
    const now = performance.now();
    for (const p of sparks) {
      p.life += dt;
      p.vy += 900 * dt;
      p.vx *= 1 - 1.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life > sparks[i].max) sparks.splice(i, 1);
    for (const p of sparks) {
      const k = 1 - p.life / p.max;
      R3.text.line(p.x, p.y, p.x - p.vx * 0.025, p.y - p.vy * 0.025, 2, col(p.col, k));
    }
    // a small MISS over the note you missed (only the latest, so they never pile up)
    H.misses = (H.misses || []).filter((m) => now - m.at < 700).slice(-1);
    for (const m of H.misses) {
      const tg = H.targets[m.id];
      if (!tg) continue;
      const an = anchorAt(tg.t);
      const age = (now - m.at) / 700;
      const [px, py] = R3.project(noteX(tg.notes[0], an), G.yTop + G.gy * 1.2 + age * 0.15, 0);
      txt('MISS', '#aacdd7', 900, px, py, Math.round(Math.min(26, HH * 0.022)), 'middle', Math.min(1, (1 - age) * 2.2));
    }
    for (const h of H.hits) {
      const age = (now - h.at) / 1000;
      if (h.offset === null || h.offset === undefined || Math.abs(h.offset) <= 90 || age >= 0.7) continue;
      const tg = H.targets[h.id];
      const an = anchorAt(tg.t);
      const top = tg.notes.reduce((m, q) => (strH(q.s) > strH(m.s) ? q : m), tg.notes[0]);
      const [px, py0] = R3.project(noteX(tg.notes[0], an), strH(top.s), 0);
      txt(h.offset < 0 ? 'EARLY' : 'LATE', h.offset < 0 ? '#9fe6ff' : '#ffd38a', 900, px, py0 - 26 - age * 30, Math.round(Math.min(22, HH * 0.02)), 'bottom', Math.min(1, (0.7 - age) * 3));
    }
  }

  /** Without scoring: notes still land with a soft flash on their string, so the timing reads. */
  function buildLands(t, a) {
    const { glow } = R3.L;
    const now = performance.now();
    H.lands = H.lands.filter((l) => now - l.at < 400 || t < l.until);
    for (const l of H.lands) {
      const tg = H.targets[l.id];
      const age = (now - l.at) / 1000;
      const k = Math.max(Math.exp(-age / 0.15), t < l.until ? 0.45 : 0);
      if (k < 0.05) continue;
      const an = anchorAt(tg.t);
      for (const nt of tg.notes) {
        const x = noteX(nt, an);
        const y = strH(nt.s);
        const r = laneW(Math.max(1, nt.f || an.fret)) * 0.75;
        glow.up(x - r, x + r, y - r * 0.45, y + r * 0.45, -0.07, col(STRING[nt.s], 0.45 * k, 1.4));
      }
      const box = isChord(tg) ? chordBox(tg, an) : null;
      for (const nt of tg.notes) buildGem(nt, -0.02, an, false, tg.kind === 'mute', true, box, 0, k * 0.8);
    }
  }

  // -------------------------------------------------------------- HUD --
  let lastSec = -2;
  let scoreHtml = null;
  const setScore = (html) => {
    if (html !== scoreHtml) score.innerHTML = scoreHtml = html;
  };
  let lastTime = '';
  function updateHud(t) {
    const tab = H.tab;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const tt = `${fmt(Math.max(0, t))} / ${fmt(stage.engine.duration || 0)}`;
    if (tt !== lastTime) time.textContent = lastTime = tt;
    if (playBtn.dataset.pl !== String(!!stage.engine.playing)) {
      playBtn.dataset.pl = String(!!stage.engine.playing);
      playBtn.innerHTML = icon(stage.engine.playing ? 'pause' : 'play');
    }
    if (tab) {
      const secs = tab.sections;
      let cur = -1;
      secs.forEach((s, i) => {
        if (t >= s.start && t < s.end) cur = i;
      });
      if (cur !== lastSec) {
        lastSec = cur;
        for (const b of sections.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.i) === cur);
      }
      const head = sections.querySelector('.hw-head');
      const total = stage.engine.duration || tab.length || 1;
      if (head) head.style.left = `${Math.min(100, (t / total) * 100)}%`;
    }
    renderLoop();
    updateLyrics(H.vis ?? t);
    // your best on this part (full speed), from Progress
    const bestRec = H.song && state.best ? state.best[H.song.id] : null;
    const partKey = H.tab ? (H.tab.type === 'combo' ? 'lead' : H.tab.type) : null;
    const best = bestRec && partKey ? bestRec[partKey] : undefined;
    const bestHtml = best !== undefined ? `<b class="hw-best">${Math.round(best * 100)}%</b><span>best</span>` : '';
    if (H.judge && prefs.detect && rig.on) {
      const acc = H.judge.accuracy;
      setScore(`<b>${acc === null ? '–' : Math.round(acc * 100) + '%'}</b><span>accuracy</span>${bestHtml}<b>${H.judge.streak}</b><span>streak</span><b>${H.judge.hits}/${H.judge.judged}</b><span>notes</span>`);
    } else if (prefs.detect && !rig.on) {
      setScore('<span>Turn on <b>Your guitar</b> to see how you’re playing</span>');
    } else setScore('');
  }

  function jumpTo(t) {
    stage.seek(t);
    if (H.judge) H.judge.rewind(t);
  }
  // "Repeating: Chorus ✕" in the bottom bar, and the repeated section marked on the strip
  const loopChip = h('button.hw-chip.hw-loop-chip', { type: 'button', hidden: true, title: 'Stop repeating' });
  loopChip.onclick = () => {
    stage.setLoop(null);
    renderLoop();
  };
  transport.append(loopChip);
  let loopKey = '';
  function renderLoop(force) {
    const loop = stage.getLoop ? stage.getLoop() : null;
    const key = loop ? `${loop.start}-${loop.end}` : '';
    if (key === loopKey && !force) return;
    loopKey = key;
    loopChip.hidden = !loop;
    if (loop) loopChip.innerHTML = `${icon('repeat')}<span>Repeating ${esc(loop.label || 'a part')}</span>${icon('x')}`;
    for (const b of sections.querySelectorAll('button[data-i]')) {
      const s = H.tab && H.tab.sections[Number(b.dataset.i)];
      b.classList.toggle('looping', !!(loop && s && Math.abs(loop.start - s.start) < 0.01 && Math.abs(loop.end - s.end) < 0.01));
    }
  }

  function renderControls() {
    const t = H.tab;
    titleBox.innerHTML = H.song ? `<b>${esc(H.song.title)}</b><span>${esc(H.song.artist)}${t ? ` · ${esc(t.tuningName || '')}${t.capo ? `, capo ${t.capo}` : ''}` : ''}</span>` : '';
    parts.innerHTML = '';
    for (const p of H.parts) {
      const b = h('button.hw-chip', { type: 'button', 'aria-pressed': String(!!(t && t.id === p.id)), text: p.name });
      b.onclick = async () => {
        if (t && t.id === p.id) return;
        await loadSong(H.song, p.id);
        H.cam.ready = false;
      };
      parts.append(b);
    }
    const hasStems = stage.stems().length > 0;
    const pa = hasStems && (prefs.playAlong ?? true);
    playAlong.setAttribute('aria-pressed', String(pa));
    playAlong.textContent = hasStems ? (pa ? `Play along · ${instrument()} muted` : 'Play along') : 'Play along · needs stems';
    const muted = rig.on && rig.muted;
    guitarBtn.classList.toggle('muted', muted);
    guitarBtn.setAttribute('aria-pressed', String(rig.on && !rig.muted));
    guitarBtn.title = !rig.on ? 'Your guitar isn’t connected' : muted ? 'Your guitar is muted: click to hear it' : 'Mute your guitar';
    guitarBtn.setAttribute('aria-label', guitarBtn.title);
    guitarBtn.innerHTML = icon(muted || !rig.on ? 'volumeOff' : 'volume');
    const mineT = (tonelib.list || []).find((x) => x.id === rig.toneId);
    const cur = rig.mode === 'song' ? songToneAt(stage.engine.position) : null;
    const toneName = rig.mode === 'song' ? `Song tone${cur && cur.name ? ` · ${cur.name}` : ''}` : rig.mode === 'live' && rig.liveTone ? rig.liveTone.name : mineT ? `${mineT.slot ? `${mineT.slot} · ` : ''}${mineT.name}` : (TONES.find((x) => x.id === rig.toneId) || {}).name || 'Tone';
    const shown = rig.standIn ? `${rig.standIn.name} (for your ${rig.instrument})` : toneName;
    toneBtn.innerHTML = `${icon('amp')}${instrumentTag(rig)}<span>${esc(shown)}</span>${rig.capture ? '<span class="real-badge sm" title="A real amp is playing">REAL</span>' : ''}${icon('chevron')}`;
    toneBtn.hidden = !rig.on;
    rigBox.classList.toggle('real', !!rig.capture);
    renderMix();
    for (const b of speed.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.s) === stage.engine.speed));
    const sp = stage.engine.speed || 1;
    speedChip.innerHTML = `${icon('clock')}<span>${Math.round(sp * 100)}%</span>`;
    speedChip.classList.toggle('slow', sp < 0.999);
    // section strip
    sections.innerHTML = '';
    if (t && t.sections.length) {
      const total = stage.engine.duration || t.length || 1;
      if (t.sections[0].start > 0.5) {
        const b0 = h('button', { type: 'button', text: '' });
        b0.style.flexGrow = String(t.sections[0].start);
        b0.onclick = () => stage.seek(0);
        sections.append(b0);
      }
      t.sections.forEach((s, i) => {
        // click: jump there (and stop any repeat). The ⟲ on the section repeats it, on purpose only.
        const b = h('button', { type: 'button', title: `${pretty(s.name)}: click to jump here` });
        b.append(h('span.hw-sec-name', { text: pretty(s.name) }));
        const rep = h('span.hw-sec-rep', { role: 'button', title: `Repeat ${pretty(s.name)}`, 'aria-label': `Repeat ${pretty(s.name)}`, html: icon('repeat') });
        b.append(rep);
        b.style.flexGrow = String(Math.max(0.01, s.end - s.start));
        b.dataset.i = String(i);
        b.onclick = (e) => {
          const loop = stage.getLoop ? stage.getLoop() : null;
          if (e.target.closest('.hw-sec-rep')) {
            const same = loop && Math.abs(loop.start - s.start) < 0.01 && Math.abs(loop.end - s.end) < 0.01;
            if (same) stage.setLoop(null);
            else {
              stage.setLoop({ start: s.start, end: s.end, label: pretty(s.name) });
              jumpTo(Math.max(0, s.start - 1));
            }
          } else {
            if (loop) stage.setLoop(null);
            jumpTo(Math.max(0, s.start - 1));
          }
          renderLoop();
        };
        sections.append(b);
      });
      sections.append(h('i.hw-head'));
      renderLoop(true);
      void total;
      lastSec = -2;
    }
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (!H.open) return;
      // a menu that's open handles its own keys (arrows, Enter, Escape)
      if (document.querySelector('.menu[role="menu"]')) return;
      if (!syncBox.hidden) {
        if (e.key === 'Escape') closeSync();
        return;
      }
      if (e.key === 'Escape') {
        if (mixOpen) setMixOpen(false);
        else leave();
        e.preventDefault();
        e.stopPropagation();
      } else if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        switchView('tab');
        e.preventDefault();
        e.stopPropagation();
      } else if (e.code === 'Space') {
        stage.toggle();
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const to = stage.engine.position + (e.key === 'ArrowLeft' ? -5 : 5);
        stage.seek(Math.max(0, to));
        if (H.judge) H.judge.rewind(to);
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
  rig.addEventListener('change', () => H.open && renderControls());
  stage.engine.addEventListener('speed', () => H.open && renderControls());
  stage.engine.addEventListener('mix', () => H.open && renderControls());

  return {
    open,
    close,
    get isOpen() {
      return H.open;
    },
    songChanged(song) {
      if (!song || (H.song && song.id === H.song.id && H.tab)) return;
      if (H.open) loadSong(song).then(() => (H.cam.ready = false));
      else {
        // closed: forget the old song now, so opening the highway always reads the new one
        H.loadToken = (H.loadToken || 0) + 1;
        H.song = null;
        H.tab = null;
        H.targets = [];
        H.judge = null;
      }
    },
    stemsChanged() {
      if (H.open) {
        applyPlayAlong();
        renderControls();
      }
    },
  };
}
