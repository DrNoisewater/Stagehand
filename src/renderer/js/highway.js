import { VenueRotation } from './venue-rotation.mjs';
import { did, venueLock, venueXpLeft, L as LV } from './rewards.js';
import { APPROACH_UNITS, approachDepth, chordSpan, isChordRepeat } from './highway-layout.js';
/**
 * Note highway: the part coming toward you down a 3D fretboard, Rocksmith
 * style. Low E on top. The camera glides between hand positions, the clock
 * follows speaker time without additional smoothing, notes arrive early and slowly enough to read,
 * and every gem carries a big fret number.
 */
import { visualTime, sustainIndex, firstSustain, noteEnd, matchTiming, attackAgo } from './highway-timing.js';
import { api } from './api.js';
import { h, icon, esc, showMenu, toast, instrumentTag, stemsLeft } from './ui.js';
import { rig, TONES } from './rig.js';
import { songToneChoice, saveToneChoice } from './tab.js';
import { tonelib, useTone } from './tonelib.js';
import { linkChains, noteTech, heldBend, drawnBend, bendStart, vibratoAt, VIBRATO_HZ } from './performance-math.js';
import { createFluidDriver } from './reactive-bg.js';
import { createFeatures } from './music-features.js';
import { createVisuals } from './visuals.js';
import { createPerformanceTools } from './performance-tools.js';
import { VENUES, VENUE_ALIAS, venueThumb, createVenue, createFire } from './venues.js';
import { suggestionFor } from './captures.js';
import { getRealAmp, modelLabel } from './realamps.js';
import { Analyzer, OnsetTracker, Judge, targetsFromTab, tuneShift, instrumentShift } from './detect.js';
import { createRenderer3D, col, mix, rodShades } from './highway3d.js';
import { createFluid } from './fluidbg.js';
import { tuningName, tuningPlan, myTuning, myCents, setMyTuning, refLabel, MY_TUNINGS, MY_TUNINGS_BASS } from './tuning.js';
import { tuningGuide, checkTuning } from './tuning-check.js';
import { dropSection, dropInUse } from './dropui.js';
import { createTuner } from './tuner.js';
import { breakdown, cheer } from './scorecard.js';
import { cameo } from './cameo.js';
import { StruggleWatch, nearestPick } from './struggle.js';
import { state, on, splitFirst, setPage } from './store.js';
import { createClassicHighway } from './highway-classic.js';
import { trainingChart, trainingTimes, trainingAudio, TRAINING_SONG } from './training-song.js';
import { createRepeat } from './repeat.js';
import { paintSpeedChip, openSpeedPopover, createRepeatBar } from './speedpop.js';
import { openToneMenu } from './tonemenu.js';
import { createSing, notesFromStem } from './singlane.js';
import { createKeys } from './keys.js';

const STRING = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];
const STRING_DARK = ['#7a1d27', '#7a5e12', '#164e80', '#7a4515', '#1c6a3c', '#55307f'];
const NAMES6 = ['E', 'A', 'D', 'G', 'B', 'e'];
const NAMES4 = ['E', 'A', 'D', 'G'];
const FONT = "'Archivo', 'Segoe UI', sans-serif";

function load() {
  const base = { ahead: 4, flow: 1, lowTop: true, detect: true, venue: 'warehouse', fx: true, v: 36 };
  try {
    const saved = JSON.parse(localStorage.getItem('stagehand.highway') || '{}') || {};
    // 3.6: the 3D highway runs at the game's pace (measured off your videos), so older speed choices start fresh
    if (saved.v !== 36) {
      delete saved.ahead;
      delete saved.flow;
      delete saved.offsetMs;
    }
    // 4.2: always 4 seconds ahead (the user: "it should always look 4 seconds ahead")
    return { ...base, ...saved, flow: 1, ahead: 4, v: 36 };
  } catch (_) {
    return base;
  }
}
const prefs = load();
let artStorage;
try { artStorage = localStorage; } catch (_) {}
const venueRotation = new VenueRotation({ storage: artStorage });
const appearance = () => { try { return JSON.parse(localStorage.getItem('stagehand.appearance.v1') || '{}') || {}; } catch (_) { return {}; } };
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
  // 4.18: every page of Stagehand is one click away from the highway (the song keeps playing)
  const goBtn = h('button.hw-chip.hw-go icon-only'.replace(' icon-only', '.icon-only'), { type: 'button', title: 'Go to another page of Stagehand', 'aria-label': 'Go to another page', 'aria-haspopup': 'menu', html: icon('grid') });
  const titleBox = h('div.hw-title');
  const parts = h('div.hw-parts');
  const playAlong = h('button.hw-chip', { type: 'button' });
  // Stagehand 3: the whole song plays; take your part out in the Mix panel instead.
  playAlong.style.display = 'none';
  // your guitar: one pill, a mute button and the tone (with REAL when a real amp plays)
  const guitarBtn = h('button.hw-rig-mute', { type: 'button' });
  const toneBtn = h('button.hw-chip.hw-rig-tone', { type: 'button', title: 'Tone for your guitar' });
  const rigBox = h('div.hw-rig', null, guitarBtn, toneBtn);
  // 4.12: Sound & settings opens from a button at the end of the top bar, next to Tools
  // (it was a tab on the right edge, with Tools floating beside it)
  const mixBtn = h('button.hw-chip.hw-set-btn', { type: 'button', title: 'Sound & settings: the mix, Drop and tuning, timing, how the highway looks', 'aria-label': 'Sound and settings', html: `${icon('sliders')}<span>Settings</span>` });
  const mixPanel = h('div.hw-mix');
  const dock = h('div.hw-dock', null, mixPanel);
  let mixOpen = !!prefs.mixOpen;
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
  // practice speed: one chip that opens the speed panel (keeps the top bar short)
  const speedChip = h('button.hw-chip.hw-speed-chip', { type: 'button', 'aria-haspopup': 'dialog' });
  // repeating one section or several, at its own speed (shared with the other views)
  const rep = stage.repeat || createRepeat({ engine: stage.engine, setLoop: (l) => stage.setLoop(l), getLoop: () => (stage.getLoop ? stage.getLoop() : null) });
  speedChip.onclick = () => openSpeedPopover(speedChip, { engine: stage.engine, repeat: rep });
  const transport = h('div.hw-transport', null, playBtn, time, speedChip);
  top.append(back, goBtn, titleBox, transport, h('span.grow'), score, h('span.grow'), views, parts, playAlong, rigBox);
  const msg = h('div.hw-msg', { hidden: true });
  // what the song is doing when it isn't playing yet: loading, waiting for stems, or failed (with a way out)
  const statusBox = h('div.hw-status', { hidden: true, role: 'status' });
  const fpsBox = h('div.hw-fps', { hidden: true });
  // lyrics, two lines under the title, the words lighting up as they're sung (as in Rocksmith)
  const lyricsBox = h('div.hw-lyrics', { hidden: true, 'aria-live': 'off' });
  // the repeat bar hangs under the section strip
  const repBar = createRepeatBar(rep, stage.engine, { cls: 'hw-rep-bar' });
  root.append(glCanvas, canvas, top, sections, repBar, bottom, msg, statusBox, dock, fpsBox, lyricsBox);
  document.body.append(root);
  // 4.12: sing along, an add-on. Off until its chip is pressed; its lane sits where the lyrics are.
  // Karaoke (the same chip): the neck and notes step aside and the guitar isn't scored while it shows.
  const sing = createSing({
    root,
    stage,
    onLeave: () => playAs('guitar'),
    onAsk: (mode) => playAs(mode),
    onKaraoke: (on) => {
      root.classList.toggle('hw-karaoke', on);
      asideChanged();
    },
  });
  parts.after(sing.chip, sing.kchip);
  H.sing = sing; // tests
  // 4.15: Piano, an add-on. Off until its chip is pressed: then the neck steps aside for sheet music and
  // falling notes written from the song, played on a keyboard plugged in by USB.
  const keys = createKeys({
    root,
    stage,
    parts: pianoParts,
    notesFromStem: (song, lyrics) => notesFromStem(song, lyrics.map((w) => ({ t: w.t, d: w.d || 0.3 })), stage.engine),
    onAsk: () => playAs('piano'),
    onShow: (on) => {
      root.classList.toggle('hw-keys-on', on);
      asideChanged();
    },
  });
  sing.kchip.after(keys.chip);
  H.keys = keys; // tests
  /** The guitar steps aside (karaoke, or piano): no neck, no guitar score. */
  const aside = () => sing.karaoke || keys.active;
  /**
   * 4.18: one way to change what you're playing, from anywhere on the highway:
   * 'guitar' (the part showing, or the part given), 'sing' (beside your part), 'karaoke', 'piano'.
   * Whatever was on steps aside by itself; the song keeps playing.
   */
  async function playAs(mode, partId = null) {
    if (!H.song || H.training || trainSnap) return;
    switching = true; // one mode steps aside before the next steps in: look once, at the end
    try {
      await switchTo(mode, partId);
    } finally {
      switching = false;
    }
    asideChanged();
  }
  var switching = false; // var: asked about before this line runs
  async function switchTo(mode, partId) {
    if (mode === 'piano') {
      sing.setKaraoke(false);
      keys.turn(true);
    } else if (mode === 'karaoke') {
      keys.turn(false);
      if (!sing.setKaraoke(true)) toast({ title: 'No words to sing', message: 'This song has no lyrics in it.', kind: 'info' });
    } else if (mode === 'sing') {
      keys.turn(false);
      sing.setKaraoke(false);
      sing.turn(true);
    } else {
      keys.turn(false);
      sing.setKaraoke(false);
      if (partId && !(H.tab && H.tab.id === partId)) {
        await loadSong(H.song, partId);
        H.cam.ready = false;
      }
    }
    paintModes();
  }
  H.playAs = playAs; // tests
  /** The part buttons light only while the guitar (or bass) is what's showing. */
  function paintModes() {
    const on = !aside();
    for (const b of parts.children) b.setAttribute('aria-pressed', String(on && !!H.tab && b.dataset.id === H.tab.id));
  }
  let wasAside = false;
  /** Karaoke or Piano came on or went away. */
  function asideChanged() {
    if (switching) return;
    const now = aside();
    paintModes();
    if (wasAside && !now && H.open) {
      // back to the guitar: its score starts again from here, and now is the time to say it needs tuning
      if (H.judge) {
        H.judge.rewind(stage.engine.position);
        H.judge.next = lower(H.targets, stage.engine.position - H.judge.early);
        H.judge.events = []; H.judge.frames = []; H.judge.onsets = [];
      }
      if (H.tab && H.song && !H.training) checkTuning({ ...H.tab, type: instrument() === 'bass' ? 'bass' : H.tab.type }, H.song, { engine: stage.engine });
    }
    wasAside = now;
  }
  goBtn.onclick = () => {
    const r = goBtn.getBoundingClientRect();
    const go = (page) => () => {
      close();
      if (page === 'guide') return (setPage('songs'), import('./guide.js').then((g) => g.openGuide()));
      if (page === 'settings') return (setPage('songs'), import('./dialogs.js').then((m) => m.settings()));
      setPage(page);
    };
    showMenu(r.left, r.bottom + 6, [
      { heading: true, label: 'Go to' },
      { label: 'Songs', icon: 'library', onClick: go('songs') },
      { label: 'Jam', icon: 'guitar', onClick: go('play') },
      { label: 'Karaoke', icon: 'mic', onClick: go('karaoke') },
      { label: 'Tones', icon: 'tones', onClick: go('tones') },
      { label: 'Gear', icon: 'amp', onClick: go('gear') },
      { label: 'Progress', icon: 'chart', onClick: go('progress') },
      { label: 'Discover', icon: 'compass', onClick: go('discover') },
      { label: 'Backstage', icon: 'people', onClick: go('greenroom') },
      '-',
      { label: 'Settings', icon: 'sliders', onClick: go('settings') },
      { label: 'Getting started', icon: 'info', onClick: go('guide') },
    ]);
  };
  /** The song's parts for the piano part: lead, rhythm and bass (whichever it has), its words and beats. */
  async function pianoParts(song) {
    const list = H.song && H.song.id === song.id && H.parts ? H.parts : await api.tab.list(song.id);
    const of = (type) => list.find((p) => p.type === type && !p.bonus) || list.find((p) => p.type === type);
    const load = (p) => (p ? api.tab.load(song.id, p.id).catch(() => null) : null);
    const [lead, rhythm, bass] = await Promise.all([load(of('lead') || of('combo')), load(of('rhythm')), load(of('bass'))]);
    const any = lead || rhythm || bass;
    if (!any) throw new Error('this song has no guitar or bass part to write it from');
    return { lead, rhythm: rhythm && rhythm !== lead ? rhythm : null, bass, lyrics: any.lyrics || [], beats: any.beats, length: any.length };
  }
  root.__hw = H; // for tests
  root.__openSync = () => openSync(); // for tests
  H.openSync = () => openSync();
  // practice.js logs your sessions (Progress) from the highway's own score while it's open
  window.__shHighway = { open: () => H.open, judge: () => (prefs.detect && rig.on && !aside() ? H.judge : null), songId: () => H.song && H.song.id, part: () => (H.tab ? (H.tab.type === 'combo' ? 'lead' : H.tab.type) : null), tab: () => H.tab, targets: () => H.targets, leave: () => leave(),
    // 4.16: for the Quest companion's highway (the same venue, string order, and whether the neck stepped aside)
    venue: () => H.decorVenue || VENUE_ALIAS[prefs.venue] || prefs.venue || 'warehouse', lowTop: () => prefs.lowTop !== false, aside: () => !!aside() };
  const extras = createPerformanceTools({root,top,stage,H,rig});
  top.append(mixBtn); // after Tools: the last thing in the top bar
  const practiceCheckpoint = () => window.__shPractice && window.__shPractice.checkpoint();
  const ctx = canvas.getContext('2d');
  const R3 = createRenderer3D(glCanvas);
  H.r3 = R3; // tests

  let lastInteraction = performance.now();
  const wakeControls = () => { lastInteraction = performance.now(); root.classList.remove('hw-quiet'); };
  // anywhere in the window counts (menus sit outside the highway): the top bar never fades under your mouse
  document.addEventListener('pointermove', () => H.open && wakeControls());
  document.addEventListener('pointerdown', () => H.open && wakeControls());
  root.addEventListener('focusin', wakeControls);
  window.addEventListener('menu-close', () => H.open && wakeControls());
  document.addEventListener('keydown', () => { if (H.open) wakeControls(); });

  back.onclick = () => (trainSnap || !syncBox.hidden ? closeSync() : leave());
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
  function toggle(label, on, onFlip, sub) {
    const b = h('button.hw-opt-toggle', { type: 'button', role: 'switch', 'aria-checked': String(!!on) }, h('span.hw-switch'), h('span', null, h('b', { text: label }), sub ? h('small', { text: sub }) : null));
    b.onclick = () => {
      onFlip();
      renderOpts();
    };
    return b;
  }
  let venuePreview = null; // 4.5: a locked venue you clicked, previewed under the list
  function venuePicker() {
    const cur = H.decorVenue || VENUE_ALIAS[prefs.venue] || prefs.venue || 'warehouse';
    const grid = h('div.hw-venues');
    // 4.5: in the order they unlock along the Road to 100
    const order = new Map(((LV.st && LV.st.venues) || []).map((v, i) => [v.venue, i]));
    const list = [...VENUES].sort((a, b) => (order.has(a.id) ? order.get(a.id) : 99) - (order.has(b.id) ? order.get(b.id) : 99));
    for (const v of list) {
      const th = venueThumb(v);
      const lock = cur === v.id ? 0 : venueLock(v.id);
      const b = h(`button.hw-venue${lock ? '.locked' : ''}`, { type: 'button', title: lock ? `${v.name}: opens at level ${lock}. Click for a preview.` : v.name, 'aria-pressed': String(cur === v.id), ...(lock ? { 'data-lock': `LV ${lock}` } : {}) }, th ? h('img', { src: th, alt: '' }) : h(v.scene ? `i.fluid.sc-${v.scene}` : v.fluid ? 'i.fluid' : 'i.plain'), h('span', { text: v.name }));
      b.onclick = () => {
        if (lock) {
          venuePreview = venuePreview === v.id ? null : v.id;
          return renderOpts();
        }
        venuePreview = null;
        setPref('venue', v.id);
        did('venue');
        renderOpts();
      };
      grid.append(b);
    }
    const row = h('div.hw-opt-row', null, h('span.hw-opt-label', { text: 'Venue' }), grid);
    const pv = venuePreview && VENUES.find((x) => x.id === venuePreview);
    if (pv && venueLock(pv.id)) {
      const lvl = venueLock(pv.id);
      const st = LV.st;
      const left = venueXpLeft(pv.id);
      const lx = (st && st.levelXp) || [];
      const k = st && lx[lvl] ? Math.max(0, Math.min(1, st.xp / lx[lvl])) : 0;
      const th = venueThumb(pv);
      row.append(h('div.hw-venue-preview', { role: 'status' },
        h('span.pv-pic', null, th ? h('img', { src: th.replace('-thumb', ''), alt: '' }) : h(`i.vsw.sc-${pv.id}`)),
        h('div', null, h('b', { text: `${pv.name} · opens at level ${lvl}` }), h('p', { text: pv.desc || 'A stage to earn on the Road to 100.' }),
          h('div.pv-bar', null, h('i', { style: { width: `${Math.round(k * 100)}%` } })),
          h('small', { text: st ? `You’re level ${st.level}. ${left.toLocaleString()} XP to go.` : '' }))));
    }
    return row;
  }
  function renderOpts() {
    opts.innerHTML = '';
    opts.append(
      h('div.hw-master-sec', { text: 'Highway' }),
      venuePicker(),
      h('div.hw-opt-toggles', null,
        toggle('Score my playing', prefs.detect, () => setPref('detect', !prefs.detect)),
        toggle('Lyrics', prefs.lyrics !== false, () => setPref('lyrics', prefs.lyrics === false)),
        toggle('Chord names', prefs.chordNames !== false, () => setPref('chordNames', prefs.chordNames === false)),
        toggle('Fire on a streak', prefs.fx, () => setPref('fx', !prefs.fx)),
        toggle('Score card at the end', prefs.scoreCard !== false, () => setPref('scoreCard', prefs.scoreCard === false)),
        toggle('Hit burst', prefs.hitBurst !== false, () => setPref('hitBurst', prefs.hitBurst === false)),
        toggle('Offer help when notes aren’t counting', !prefs.struggleOff, () => setPref('struggleOff', !prefs.struggleOff)),
        toggle('Frame rate', !!prefs.showFps, () => setPref('showFps', !prefs.showFps))
      )
    );
  }
  function syncButton() {
    const off = prefs.offsetMs || 0;
    const sync = h('button.hw-sync', { type: 'button' }, h('span.hw-sync-icon', { html: icon('clock') }), h('span', null, h('b', { text: 'Timing check' }), h('small', { text: off ? `Notes ${Math.abs(off)} ms ${off > 0 ? 'later' : 'earlier'}` : 'Play a short warm-up to set the timing' })));
    sync.onclick = () => openSync();
    return sync;
  }
  // the Drop and your tuning, right here (3.9: there was nowhere to drop on the highway)
  const dropBox = h('div.hw-drop.drop3', {style:{'--gel':'var(--gel-bass)'}});
  function renderDropBox() {
    // 4.5: the same Drop console as the Play page (dropui.js), plus what this song needs
    dropBox.innerHTML = '';
    const kind = instrument() === 'bass' ? 'bass' : 'guitar';
    const songT = H.tab && H.tab.tuning ? `${tuningName(H.tab.tuning, kind)}${refLabel(H.tab.cents) ? ` ${refLabel(H.tab.cents)}` : ''}` : '';
    const mine = myTuning(kind);
    const plan = H.tab ? tuningPlan(H.tab.tuning, kind, mine, H.tab.cents || 0) : { same: true };
    const extra = [];
    if (H.tab) {
      const need = plan.same ? `${songT}: your ${kind} is ready` : plan.drop ? `${songT} song, your ${kind} is in ${tuningName(mine, kind)}: Drop −${plan.drop}` : plan.retune.length ? `${songT}: retune ${plan.retune.map((r) => `${r.from}→${r.to}`).join(', ')}${plan.ref ? ` (to ${plan.ref})` : ''}` : `${songT}: retune every string a little (to ${plan.ref})`;
      const g = h('button.dc-pill', { type: 'button', text: plan.same ? 'Check my tuning' : 'Tuning guide' });
      g.onclick = () => tuningGuide({ ...H.tab, type: kind === 'bass' ? 'bass' : H.tab.type }, H.song, stage.engine);
      extra.push(h(`div.dc-need${plan.same ? '.ok' : ''}`, null, h('span', { text: need }), g));
    }
    // 4.8: folded under its own head; it opens by itself when the Drop is in use. Folding it
    // yourself holds while this song is open (Sound & settings rebuilds often).
    const sid = H.song && H.song.id;
    if (dropFold.song !== sid) dropFold = { song: sid, open: undefined };
    dropBox.append(dropSection({ kind, compact: true, extra, open: dropFold.open, onOpen: (v, why) => why !== 'start' && (dropFold.open = v), onTuningChange: () => H.tab && rig.setSongTuning(H.tab.tuning, kind, H.tab.cents || 0) }));
  }
  let dropFold = { song: undefined, open: undefined };
  // (the console updates itself on Drop changes)

  // 4.8: the Drop pops out on the highway on its own when it's in use or the song wants it,
  // without opening all of Sound & settings. Fold it to its head, or × to hide it until it
  // starts working again. Hidden while Sound & settings is open (the Drop is in there).
  const dropPop = h('div.hw-droppop', { hidden: true });
  let pop = { song: undefined, kind: null, el: null, closed: false, seen: false };
  function renderDropPop() {
    const kind = instrument() === 'bass' ? 'bass' : 'guitar';
    const sid = H.song && H.song.id;
    if (!dropPop.isConnected) root.insertBefore(dropPop, dock);
    if (!pop.el || pop.song !== sid || pop.kind !== kind) {
      pop = { song: sid, kind, el: null, closed: false, seen: false };
      dropPop.innerHTML = '';
      const x = h('button.hw-droppop-x', { type: 'button', title: 'Hide the Drop (it comes back when it starts working)', 'aria-label': 'Hide the Drop', html: icon('x') });
      x.onclick = () => {
        pop.closed = true;
        syncDropPop();
      };
      const el = dropSection({
        kind,
        compact: true,
        onOpen: (v, why) => {
          if (why === 'auto') pop.closed = false;
          syncDropPop();
        },
      });
      el.querySelector('.dc-fold-head').append(x);
      pop.el = el;
      dropPop.append(el);
    }
    syncDropPop();
  }
  function syncDropPop() {
    if (!pop.el) return;
    if (dropInUse() || (!!rig.dropSong && !!H.tab)) pop.seen = true;
    dropPop.hidden = !(H.open && !mixOpen && !pop.closed && pop.seen && !H.training);
  }
  rig.addEventListener('drop', () => H.open && renderDropPop());

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
  // 4.12: how the singing went, when Sing was on: a line on the card, or a card of its own
  // when the guitar wasn't being scored
  const SING_LEVEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  function singFacts(v) {
    const facts = h('div.hw-card-facts');
    const fact = (val, l) => facts.append(h('div', null, h('b', { text: val }), h('span', { text: l })));
    fact(`${v.hit}/${v.notes}`, 'syllables sung');
    fact(`${v.goodLines}/${v.lines}`, 'good lines');
    fact(v.prev === undefined || v.prev === null ? '–' : `${Math.round(v.prev * 100)}%`, 'best before');
    return facts;
  }
  function againButton() {
    const again = h('button.hw-chip.hw-card-again', { type: 'button', html: `${icon('play')}<span>Play again</span>` });
    again.onclick = () => {
      hideCard();
      jumpTo(0);
      if (!stage.engine.playing) stage.toggle();
    };
    return h('div.hw-card-actions', null, again);
  }
  function showSingCard(v) {
    card.innerHTML = '';
    const x = h('button.hw-card-x', { type: 'button', title: 'Close', 'aria-label': 'Close', html: icon('x') });
    x.onclick = hideCard;
    const best = v.notes >= 20 && (v.prev === undefined || v.prev === null || v.acc > v.prev + 0.005);
    const ring = h(`div.hw-card-ring.sing.${bandCls(v.acc)}`, { style: { '--deg': `${Math.round(v.acc * 360)}deg` } }, h('b', { text: `${Math.round(v.acc * 100)}%` }), h('span', { text: 'sung' }));
    card.append(h('div.hw-card-head', null, ring, h('div.hw-card-titles', null, h('div.hw-card-eyebrow', { text: best ? (v.prev === undefined || v.prev === null ? 'First time singing it' : 'New best!') : 'Song complete' }), h('h3', { text: H.song ? H.song.title : 'Song' }), h('p', { html: `${icon('mic')} Singing · ${SING_LEVEL[v.level] || 'Medium'}${v.mode === 'rhythm' ? ' · timing only' : v.mode === 'stem' ? ' · notes from the recording' : ''}` })), x), singFacts(v), againButton());
    card.hidden = false;
  }
  // 4.15: how the piano went: a card of its own (the guitar isn't scored while piano is on)
  const KEYS_LEVEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  function showKeysCard(v, vs) {
    card.innerHTML = '';
    const x = h('button.hw-card-x', { type: 'button', title: 'Close', 'aria-label': 'Close', html: icon('x') });
    x.onclick = hideCard;
    const hasPrev = v.prev !== undefined && v.prev !== null;
    const best = v.notes >= 20 && (!hasPrev || v.acc > v.prev + 0.005);
    const ring = h(`div.hw-card-ring.keys.${bandCls(v.acc)}`, { style: { '--deg': `${Math.round(v.acc * 360)}deg` } }, h('b', { text: `${Math.round(v.acc * 100)}%` }), h('span', { text: 'played' }));
    const hands = v.hands === 'R' ? ' · right hand' : v.hands === 'L' ? ' · left hand' : '';
    card.append(h('div.hw-card-head', null, ring, h('div.hw-card-titles', null, h('div.hw-card-eyebrow', { text: best ? (hasPrev ? 'New best!' : 'First time on piano') : 'Song complete' }), h('h3', { text: H.song ? H.song.title : 'Song' }), h('p', { html: `${icon('piano')} Piano · ${KEYS_LEVEL[v.level] || 'Medium'}${hands}` })), x));
    const facts = h('div.hw-card-facts');
    const fact = (val, l) => facts.append(h('div', null, h('b', { text: val }), h('span', { text: l })));
    fact(`${v.hit}/${v.notes}`, 'notes played');
    fact(String(v.bestStreak), 'longest streak');
    fact(hasPrev ? `${Math.round(v.prev * 100)}%` : '–', 'best before');
    card.append(facts);
    if (vs) card.append(h('div.hw-card-sing', null, h('span.sing-pct', { html: `${icon('mic')}<b>${Math.round(vs.acc * 100)}%</b>` }), h('span', { text: `Singing · ${SING_LEVEL[vs.level] || 'Medium'} · ${vs.hit}/${vs.notes} syllables` })));
    card.append(againButton());
    card.hidden = false;
  }
  function showCard() {
    if (prefs.scoreCard === false || !H.tab) return;
    const vs = sing.result();
    const ks = keys.result();
    const b = H.judge && prefs.detect && rig.on && !aside() ? breakdown(H.tab, H.targets, H.judge) : null;
    if (!b || !b.notes) {
      if (ks) showKeysCard(ks, vs);
      else if (vs) showSingCard(vs);
      return;
    }
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
    if (vs) card.append(h('div.hw-card-sing', null, h('span.sing-pct', { html: `${icon('mic')}<b>${Math.round(vs.acc * 100)}%</b>` }), h('span', { text: `Singing · ${SING_LEVEL[vs.level] || 'Medium'} · ${vs.hit}/${vs.notes} syllables${vs.prev !== undefined && vs.prev !== null ? ` · best before ${Math.round(vs.prev * 100)}%` : ''}` })));
    if (b.sections.length) {
      const bars = h('div.hw-card-bars');
      for (const s of b.sections) {
        const bar = h(`button.hw-card-bar.${bandCls(s.acc)}`, { type: 'button', title: `${s.label}: ${Math.round(s.acc * 100)}% (${s.hit}/${s.notes}). Click to repeat it.` }, h('i', { style: { height: `${Math.max(4, Math.min(100, Math.round(s.acc * 100)))}%` } }));
        // 4.0.9: as tall as the accuracy (29% looked empty when 40% and below were drawn as nothing)
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
    // 4.1.6: the timing check, where people look after a run that went badly
    if (!prefs.syncChecked || b.acc < 0.6) {
      const tc = h('button.hw-chip', { type: 'button', html: `${icon('clock')}<span>Timing check</span>` });
      tc.onclick = () => {
        hideCard();
        openSync();
      };
      card.append(h('div.hw-card-notes', null, h('div.work', null, h('span', { html: icon('clock') }), h('span', { text: prefs.syncChecked ? 'Notes you played on time not counting? Run the timing check again.' : 'Haven’t done the timing check yet? 30 seconds, once, and notes you hit on time count.' }), tc)));
    }
    card.append(againButton());
    card.hidden = false;
  }
  function repeat(s) {
    hideCard();
    rep.start({ start: s.start, end: s.end, label: s.label });
    did('repeat');
    jumpTo(Math.max(0, s.start - 1));
    if (!stage.engine.playing) stage.toggle();
  }
  stage.engine.addEventListener('state', () => {
    if (stage.engine.playing) hideCard();
  });
  stage.engine.addEventListener('ended', () => { if(H.open && !trainSnap){ extras.ended(); sing.ended(); keys.ended(); showCard(); } });
  H.showCard = showCard; // tests

  // ----------------------------------------------------- sync check --
  // The user: "it needs to be its own psarc-like style, actual notes on a highway,
  // the exact same as a regular song. No clicking spacebar to clicks". So the timing
  // check is a short song made for it (training-song.js), on this highway, through
  // the song player (the same sound path and delay as any song), scored like any
  // song. Your picks, heard the way scoring hears them, against the notes' times
  // say how late you play; the notes are then shown that much later.
  const syncBox = h('div.hw-syncbox', { hidden: true, role: 'dialog', 'aria-label': 'Timing check' });
  const trainBar = h('div.hw-trainbar', { hidden: true, role: 'status' });
  root.append(syncBox, trainBar);
  let syncHold = 0;
  let trainSnap = null; // the song you had, to go back to
  let trainTimer = 0;
  let trainToken = 0;
  window.__shHighway.training = () => !!(H.training || trainSnap);
  function openSync({ first = false } = {}) {
    if (H.training || trainSnap) return;
    if (stage.engine.playing) stage.toggle();
    syncBox.hidden = false;
    syncIntro({ first });
    holdSong();
  }
  /** The song may start a moment later (it was still loading): keep it paused while the box is open. */
  function holdSong() {
    clearInterval(syncHold);
    syncHold = setInterval(() => {
      if (syncBox.hidden || H.training) return clearInterval(syncHold);
      if (stage.engine.playing) stage.toggle();
    }, 200);
  }
  // 4.1.6: people don't know the timing check exists: the first time you open the
  // highway with your guitar plugged in, it introduces itself (twice at most, never once done)
  let syncAskedNow = false; // once each time Stagehand is opened, not song after song
  function maybeFirstSync() {
    if (syncAskedNow || !syncBox.hidden || H.training || trainSnap || prefs.syncChecked || (prefs.syncAsked || 0) >= 2 || !rig.on || !(prefs.detect !== false)) return;
    if (prefs.offsetMs) return setPref('syncChecked', true); // done before 4.1.6
    syncAskedNow = true;
    setPref('syncAsked', (prefs.syncAsked || 0) + 1);
    openSync({ first: true });
  }
  /** Done, or cancelled: back to the song you had, where you were (or wherever you came from). */
  function closeSync() {
    syncBox.hidden = true;
    clearInterval(syncHold);
    endTraining();
    if (H.bare) {
      H.bare = false;
      if (H.open) close();
    }
  }
  /** The highway is closing (Back, another view): the timing check ends with it. */
  function closeTraining() {
    H.bare = false;
    syncBox.hidden = true;
    clearInterval(syncHold);
    endTraining();
  }
  const kindNow = () => (rig.instrument === 'bass' ? 'bass' : 'guitar');
  const topStrings = () => 'top three strings (red, yellow and blue)';

  function syncIntro({ first = false } = {}) {
    syncBox.innerHTML = '';
    const go = h('button.btn.primary', { type: 'button', text: 'Start' });
    const cancel = h('button.btn.ghost', { type: 'button', text: first ? 'Not now' : 'Cancel' });
    cancel.onclick = () => closeSync();
    if (!rig.on) {
      // the check is a song you play: nothing to do without your guitar
      const kind = kindNow();
      const connect = h('button.btn.primary', { type: 'button', text: `Connect my ${kind}` });
      const why = h('p.fine', { text: '' });
      connect.onclick = async () => {
        connect.disabled = true;
        rig.setSink(stage.engine.sinkId);
        const ok = await rig.start().catch(() => false);
        if (syncBox.hidden) return;
        if (ok) {
          applyTone();
          renderControls();
          return syncIntro({ first });
        }
        connect.disabled = false;
        why.textContent = rig.error || `Stagehand can’t hear your ${kind} yet. Check the cable and that the input is picked in Settings.`;
      };
      syncBox.append(
        h('div.hw-sync-ring', { html: icon('guitar') }),
        h('h3', { text: `Plug in your ${kind}` }),
        h('p', { text: `The timing check is a short song you play on your ${kind}, like any song on the highway. Plug it in, then press Connect.` }),
        why,
        h('div.hw-sync-actions', null, cancel, connect)
      );
      connect.focus();
      return;
    }
    const kind = kindNow();
    go.onclick = () => startTraining();
    if (first) {
      cancel.onclick = () => {
        closeSync();
        toast({ title: 'Any time you like', message: 'The timing check is under Tools › Timing check on the highway.', kind: 'info', timeout: 6000 });
      };
      syncBox.append(
        cameo('event-timing', { enter: 'rise', cls: 'sync-cameo' }) || '',
        h('div.hw-sync-ring', { html: icon('clock') }),
        h('h3', { text: 'First, a 30-second timing check' }),
        h('p', { text: 'Every PC plays sound a little late, some more than others. This lines Stagehand up with your PC and how you play, so notes you hit on time count as hits. You only do it once.' }),
        h('p', { text: `It’s a short, easy song: play each note as it reaches the strings, only on the ${topStrings(kind)}, open or the first few frets.` }),
        h('p.fine', { text: 'Later: Tools › Timing check, any time.' }),
        h('div.hw-sync-actions', null, cancel, go)
      );
    } else {
      syncBox.append(
        cameo('event-timing', { enter: 'rise', cls: 'sync-cameo' }) || '',
        h('div.hw-sync-ring', { html: icon('guitar') }),
        h('h3', { text: 'Timing check' }),
        h('p', { text: 'A short, easy song, about 30 seconds. Drumsticks count you in, then the notes come down the highway like any song.' }),
        h('p', { text: `Play each note as it reaches the strings, the way you normally play: only the ${topStrings(kind)}, open or the first few frets.` }),
        h('p.fine', { text: 'Stagehand listens to when you pick and lines the notes up with how you play.' }),
        h('div.hw-sync-actions', null, cancel, go)
      );
    }
    go.focus();
  }

  /** The training song on the highway, through the song player, scored like any song. */
  async function startTraining() {
    const token = ++trainToken;
    clearInterval(trainTimer);
    const eng = stage.engine;
    if (eng.playing) eng.pause();
    syncBox.hidden = false;
    syncBox.innerHTML = '';
    const cancel = h('button.btn.ghost', { type: 'button', text: 'Cancel' });
    cancel.onclick = () => closeSync();
    syncBox.append(h('div.hw-sync-ring.live', { html: icon('guitar') }), h('h3', { text: 'Getting the song ready…' }), h('div.hw-sync-actions', null, cancel));
    await new Promise((r) => setTimeout(r, 50)); // let that show before the song is made
    if (token !== trainToken) return;
    const kind = kindNow();
    const tab = trainingChart(kind, myTuning(kind), myCents(kind));
    let audio;
    try {
      audio = trainingAudio(tab, eng.sampleRate || 48000);
    } catch (err) {
      syncBox.innerHTML = '';
      syncBox.append(h('div.hw-sync-ring', { html: icon('alert') }), h('h3', { text: 'The timing check didn’t start' }), h('p', { text: err.message || 'Something went wrong.' }), h('div.hw-sync-actions', null, cancel));
      return;
    }
    if (token !== trainToken) return;
    // the song you had leaves the player for now (it comes back after)
    if (!trainSnap) trainSnap = { song: H.song, parts: H.parts, tab: H.tab, lyricLines: H.lyricLines, speed: eng.speed || 1, detect: prefs.detect, player: stage.borrowPlayer ? stage.borrowPlayer() : null };
    if ((eng.speed || 1) !== 1) eng.setSpeed(1);
    await eng.reset(audio.wav.sampleRate, audio.wav.frames);
    if (token !== trainToken) return;
    eng.loadTrack(0, 'mix', audio.buffer, audio.wav);
    eng.setMode('mix');
    const notes = trainingTimes(tab);
    H.training = { tab, kind, notes, picks: [], end: notes[notes.length - 1] + 1.4 };
    H.syncPlay = { notes, played: H.training.picks }; // tests
    prefs.detect = true; // scored, whatever the switch says (put back after)
    H.song = TRAINING_SONG;
    H.parts = [];
    H.tab = tab;
    H.lyricLines = [];
    rig.setSongTuning(tab.tuning, kind, tab.cents || 0);
    H.scoringShift = tuneShift.st = rig.dropAmount();
    H.targets = buildTargets(tab);
    resetJudge();
    H.cam.ready = false;
    root.classList.add('hw-training');
    rep.paused = true; // a repeat you had waits (it never counts the training song as a pass)
    syncBox.hidden = true;
    clearInterval(syncHold);
    renderControls();
    renderStatus();
    renderTrainBar(0);
    trainBar.hidden = false;
    await eng.play();
    if (token !== trainToken) return;
    trainTimer = setInterval(trainTick, 100);
  }

  function renderTrainBar(t) {
    const tr = H.training;
    if (!tr) return;
    const n = tr.notes.length;
    const done = tr.notes.filter((T) => T < t - 0.2).length;
    const key = t < tr.notes[0] - 0.4 ? 'ready' : `n${done}`;
    if (trainBar.dataset.key === key) return;
    trainBar.dataset.key = key;
    trainBar.innerHTML = '';
    const stop = h('button.hw-chip', { type: 'button', text: 'Stop', title: 'Stop the timing check (Esc)' });
    stop.onclick = () => closeSync();
    trainBar.append(
      h('span.hw-train-icon', { html: icon('clock') }),
      h('b', { text: 'Timing check' }),
      h('span', { text: key === 'ready' ? 'Get ready: the sticks count you in' : 'Play each note as it reaches the strings · red, yellow and blue only' }),
      h('span.hw-train-count', { text: `${done} of ${n}` }),
      stop
    );
  }
  function trainTick() {
    const tr = H.training;
    if (!tr) return clearInterval(trainTimer);
    const eng = stage.engine;
    const t = eng.position;
    renderTrainBar(t);
    if (t >= tr.end || (!eng.playing && t > tr.notes[0])) finishTraining();
  }
  /** Picks heard by scoring (already less the input delay), placed by the attack itself. */
  function trainingPick(t, buf) {
    const p = H.training && !H.training.finished ? H.training.picks : null;
    if (!p) return;
    const at = t - attackAgo(buf, rig.sampleRate);
    if (!p.length || at - p[p.length - 1] > 0.12) p.push(at);
  }
  function finishTraining() {
    const tr = H.training;
    clearInterval(trainTimer);
    if (!tr) return;
    tr.finished = true;
    stage.engine.pause();
    trainBar.hidden = true;
    const r = matchTiming(tr.notes, tr.picks);
    syncBox.hidden = false;
    syncResult(r.offs, tr.notes.length, { hits: H.judge ? H.judge.hits : null });
  }
  /** Back to the song you had: its part on the highway, its audio in the player, where you were. */
  function endTraining() {
    clearInterval(trainTimer);
    trainToken++;
    const s = trainSnap;
    if (!s) return;
    trainSnap = null;
    H.training = null;
    root.classList.remove('hw-training');
    rep.paused = false;
    trainBar.hidden = true;
    const eng = stage.engine;
    if (eng.playing) eng.pause();
    prefs.detect = s.detect;
    if (s.detect !== true) save();
    H.song = s.song;
    H.parts = s.parts || [];
    H.tab = s.tab;
    H.lyricLines = s.lyricLines || [];
    lyricShown = -2;
    if (H.tab) {
      rig.setSongTuning(H.tab.tuning, instrument(), H.tab.cents || 0);
      H.scoringShift = tuneShift.st = rig.dropAmount();
      H.targets = buildTargets(H.tab);
    } else H.targets = [];
    if (s.speed !== 1 && eng.setSpeed) eng.setSpeed(s.speed);
    resetJudge();
    newWatch();
    H.cam.ready = false;
    if (stage.giveBack) stage.giveBack(s.player);
    if (H.open) {
      renderControls();
      renderStatus();
    }
  }

  /** From anywhere (the guide): open the highway (on your song if one is open), then the check. */
  async function timingCheck(song) {
    if (H.open) return openSync();
    if (song) {
      await open(song);
    } else {
      H.open = true;
      root.hidden = false;
      document.getElementById('app').classList.add('under-highway');
      api.app.fullscreen(true).catch(() => {});
      H.loadToken = (H.loadToken || 0) + 1;
      H.song = null;
      H.tab = null;
      H.parts = [];
      H.targets = [];
      H.judge = null;
      H.lyricLines = [];
      showMsg(null);
      resize();
      H.clock = stage.engine.position;
      H.last = performance.now();
      hideCard();
      renderControls();
      renderStatus();
      loop();
    }
    H.bare = true; // when it's done, the highway closes again
    openSync();
  }

  function syncResult(offs, N, { hits = null } = {}) {
    syncBox.innerHTML = '';
    const again = h('button.btn.ghost', { type: 'button', text: 'Try again' });
    again.onclick = () => startTraining();
    if (offs.length < N / 2) {
      const cancel = h('button.btn.ghost', { type: 'button', text: 'Cancel' });
      cancel.onclick = () => closeSync();
      syncBox.append(
        cameo('event-rough', { enter: 'peek', cls: 'sync-cameo' }) || '',
        h('div.hw-sync-ring', { html: icon('alert') }),
        h('h3', { text: 'Not enough notes heard' }),
        h('p', { text: `Only ${offs.length} of ${N} notes were heard near the strings. Pick a little harder, one note at a time, as each one arrives.` }),
        h('div.hw-sync-actions', null, cancel, again)
      );
      again.focus();
      return;
    }
    const sorted = [...offs].sort((a, b) => a - b);
    const trim = sorted.slice(Math.floor(sorted.length * 0.2), Math.ceil(sorted.length * 0.8));
    const mean = trim.reduce((a, b) => a + b, 0) / trim.length;
    const ms = Math.round(mean / 5) * 5;
    const spread = Math.round(Math.sqrt(trim.reduce((a, b) => a + (b - mean) ** 2, 0) / trim.length));
    const use = Math.max(-300, Math.min(300, ms));
    H.syncResult = { ms: use, spread, heard: offs.length, notes: N, hits }; // tests
    // your picks as dots around the note (centre line): see how steady they were
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
      did('timing');
      closeSync();
      toast({ title: use ? `Notes now ${Math.abs(use)} ms ${use > 0 ? 'later' : 'earlier'}` : 'Notes in sync', message: 'Only the picture moves; scoring is not affected.' });
    };
    const reset = h('button.btn.ghost', { type: 'button', text: 'Reset to 0' });
    reset.onclick = () => {
      setPref('offsetMs', 0);
      closeSync();
    };
    const steady = spread < 25 ? 'Nice and steady.' : spread < 45 ? 'A bit uneven: try again for a surer result.' : 'Quite uneven: try again, picking just as each note reaches the strings.';
    const said = use === 0 ? 'You play right on the notes: nothing to change.' : `You play ${Math.abs(use)} ms ${use > 0 ? 'after' : 'before'} the notes reach the strings. The notes will move to match how you play. ${steady}`;
    syncBox.append(
      cameo(spread < 25 ? 'event-sync-good' : 'event-timing', { enter: spread < 25 ? 'spin' : 'rise', cls: 'sync-cameo' }) || '',
      h('div.hw-sync-eyebrow', { text: hits !== null ? `Timing check · ${hits} of ${N} notes hit` : 'Timing check' }),
      h('div.hw-sync-big', { text: `${use > 0 ? '+' : ''}${use} ms` }),
      h('p', { text: said }),
      h('div.hw-sync-legend', null, h('span', { text: 'early' }), h('span', { text: 'on the note' }), h('span', { text: 'late' })),
      strip,
      h('div.hw-sync-actions', null, reset, again, ok),
      h('p.fine', { text: `Set now: ${prefs.offsetMs ? `${prefs.offsetMs > 0 ? '+' : ''}${prefs.offsetMs} ms` : '0 ms'}. Afterwards you’re back ${trainSnap && trainSnap.song ? `at ${trainSnap.song.title}` : 'where you were'}.` })
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
  // 4.1.9: the tone menu is its own module (tonemenu.js): keys 1–9, the song's tones, search
  toneBtn.onclick = () =>
    openToneMenu(toneBtn, {
      kind: H.tab && H.tab.type === 'bass' ? 'bass' : 'guitar',
      songTones: () => (H.tab && H.tab.songTones) || null,
      songToneNow: () => songToneAt(stage.engine.position),
      chooseTone,
      pause: () => stage.engine.playing && stage.toggle(),
    });

  // --------------------------------------------------------------- mix --
  function setMixOpen(on) {
    mixOpen = on;
    prefs.mixOpen = on;
    save();
    dock.classList.toggle('collapsed', !on);
    mixBtn.setAttribute('aria-pressed', String(on));
    mixBtn.setAttribute('aria-expanded', String(on));
    if (!on && typeof hwTuner !== 'undefined') hwTuner.hide(); // closed: stop listening
    if (typeof syncDropPop === 'function') syncDropPop();
    else if (on && tunerOn && H.open) hwTuner.show();
    renderMix();
  }
  // 4.2: the tuner, folded into Sound & settings (it was a floating box from the Tools menu).
  // Closed until you open it (U, or its row); it only listens while it's showing.
  const hwTuner = createTuner();
  hwTuner.el.classList.add('hw-tuner');
  let tunerOn = false;
  const tunerSec = h('div.hw-tuner-sec');
  function renderTunerSec() {
    tunerSec.innerHTML = '';
    tunerSec.classList.toggle('open', tunerOn);
    const head = h('button.hw-tuner-head', { type: 'button', 'aria-expanded': String(tunerOn), title: tunerOn ? 'Fold the tuner away (U)' : 'Open the tuner (U)' }, h('span.hw-tuner-ic', { html: icon('tuning') }), h('b', { text: 'Tuner' }), h('kbd', { text: 'U' }), h('span.hw-tuner-chev', { html: icon(tunerOn ? 'chevronUp' : 'chevron') }));
    head.onclick = () => setTunerOpen(!tunerOn);
    tunerSec.append(head);
    if (tunerOn) tunerSec.append(hwTuner.el);
  }
  function setTunerOpen(on) {
    tunerOn = on;
    if (on && mixOpen && H.open) hwTuner.show();
    else hwTuner.hide();
    renderTunerSec();
  }
  H.toggleTuner = () => {
    if (mixOpen && tunerOn) return setTunerOpen(false);
    if (!mixOpen) setMixOpen(true);
    setTunerOpen(true);
    tunerSec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  mixBtn.onclick = () => setMixOpen(!mixOpen);
  setTimeout(() => setMixOpen(mixOpen));
  const mixMeters = new Map();
  function renderMix() {
    if (!mixOpen) return;
    // Don't rebuild under a volume slider that's being dragged.
    if (document.activeElement && document.activeElement.classList.contains('stem-vol') && mixPanel.contains(document.activeElement)) return;
    mixPanel.innerHTML = '';
    mixMeters.clear();
    mixPanel.append(h('div.hw-master-title', null, h('b', { text: 'Sound & settings' })), syncButton());
    renderMixBody();
    mixPanel.append(h('div.hw-master-sec', { text: 'Tuning' }), tunerSec, dropBox, opts);
    renderTunerSec();
    renderDropBox();
    renderOpts();
  }
  // 4.12: the split's progress in Sound & settings moves as the split goes (it was written
  // once when the menu opened, so it looked stalled until the stems suddenly appeared)
  function mixSplitText(st) {
    if (st.state === 'queued') return `${splitFirst()}. This song is next.`;
    const pct = Math.round((st.progress || 0) * 100);
    const left = stemsLeft(st);
    return `${pct ? `Splitting stems · ${pct}%` : stage.stemsStep ? stage.stemsStep(st) : 'Splitting stems…'}${left ? ` · ${left}` : ''}`;
  }
  function fillMixSplit(note, st) {
    const text = mixSplitText(st);
    if (note.textContent !== text) note.textContent = text;
    const bar = note.nextElementSibling && note.nextElementSibling.firstChild;
    if (bar) bar.style.width = `${st.state === 'running' ? Math.max(2, Math.round((st.progress || 0) * 100)) : 0}%`;
  }
  /** The open song's split, newest news first (the stage may read it a moment later). */
  function splitNow() {
    const song = stage.loadInfo ? stage.loadInfo().song : null;
    return (song && state.stems.get(song.id)) || (stage.stemStatus && stage.stemStatus()) || { state: 'none' };
  }
  function mixSplitMoved() {
    if (!mixOpen || !H.open) return;
    const note = mixPanel.querySelector('.hw-mix-note[data-split]');
    if (!note) return;
    const st = splitNow();
    const busy = st.state === 'queued' || st.state === 'running';
    const was = note.dataset.split;
    if (stage.stems().length || (busy ? st.state : 'none') !== was) return renderMix();
    if (busy) fillMixSplit(note, st);
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
      const st = splitNow();
      const busy = st.state === 'queued' || st.state === 'running';
      const note = h('p.hw-mix-note', { 'data-split': busy ? st.state : 'none', text: busy ? '' : 'Split this song into stems to set the drums, bass, vocals and guitar separately.' });
      mixPanel.append(note);
      if (busy) {
        note.after(h('div.hw-st-bar.hw-mix-bar', null, h('i')));
        fillMixSplit(note, st);
      }
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

  // 4.2: string order lives in Settings › Playback; it tells the highway here
  // 4.5: the developer menu's venue tour shows each venue for a moment (nothing is saved)
  window.addEventListener('stagehand:preview-venue', (e) => {
    if (e.detail) H.decorVenue = e.detail;
  });
  window.addEventListener('stagehand:highway-pref', (e) => {
    const d = e.detail || {};
    if (d.key === 'lowTop') setPref('lowTop', !!d.value);
  });
  function setPref(k, v) {
    prefs[k] = v;
    if (k === 'venue') { H.decorVenue = v; venueRotation.use(v); }
    if (k === 'offsetMs') prefs.syncChecked = true; // 4.1.6: you've done a timing check
    save();
    if (k === 'detect') resetJudge();
  }

  // ------------------------------------------------- 4.1.6: need a hand? --
  // Missing lots of notes while clearly playing along: offer the timing check
  // (or the tuning check). Once per song each time you open it; sooner the
  // first time through a song; never while you've said not to.
  // 4.1.7 (user: "that happens too often"): at most once per app start, then not for 3 days
  let helpShownNow = false;
  const HELP_REST_MS = 3 * 24 * 3600 * 1000;
  const helpResting = () => helpShownNow || syncAskedNow || (prefs.helpAt && Date.now() - prefs.helpAt < HELP_REST_MS);
  function newWatch() {
    H.watch = new StruggleWatch({ checked: !!prefs.syncChecked });
  }
  function watchNote(e, tg) {
    if (!H.watch || H.training || prefs.struggleOff || !stage.engine.playing || helpResting()) return;
    const st = H.judge && H.judge.state.get(e.id);
    const near = nearestPick(H.judge && H.judge.onsets, tg.t);
    // offsets are in song time: at another speed, turn them into real milliseconds
    const off = st && st.offset !== null && st.offset !== undefined ? st.offset : near;
    H.watch.add({ hit: e.hit, tried: e.hit || near !== null, offset: off === null || off === undefined ? off : off / (stage.engine.speed || 1) });
    if (!syncBox.hidden) return;
    const v = H.watch.verdict();
    if (v) offerHelp(v);
  }
  function offerHelp(v) {
    helpShownNow = true;
    setPref('helpAt', Date.now());
    const kind = instrument() === 'bass' ? 'bass' : 'guitar';
    const timing = { label: 'Timing check', onClick: () => openSync() };
    const tune = { label: 'Check my tuning', onClick: () => H.tab && tuningGuide({ ...H.tab, type: kind === 'bass' ? 'bass' : H.tab.type }, H.song, stage.engine) };
    const never = { label: 'Don’t ask again', onClick: () => setPref('struggleOff', true) };
    // the other calibration: strum hard for 4 seconds and Stagehand sets your input level
    const level = {
      label: 'Set input level',
      onClick: async () => {
        if (stage.engine.playing) stage.toggle();
        toast({ title: 'Strum hard for 4 seconds', message: 'As hard as you play. Stagehand sets your input level.', kind: 'info', timeout: 4500 });
        const r = await rig.calibrate(4).catch(() => null);
        toast(r ? { title: 'Input level set', message: `Your hardest strum peaked at ${Math.round(r.peakDb)} dB. Press Space to carry on.`, kind: 'ok' } : { title: 'Didn’t hear anything', message: 'Check the cable is plugged in, then try again and strum hard.', kind: 'info' });
      },
    };
    const way = v.ms > 0 ? 'late' : 'early';
    if (v.why === 'timing')
      toast({
        title: 'Notes not counting?',
        message: Math.abs(v.ms) >= 55 ? `You’re playing about ${Math.abs(v.ms)} ms ${way}. A 30-second timing check fixes that.` : 'A 30-second timing check, or setting your input level, usually fixes it.',
        kind: 'info',
        timeout: 15000,
        actions: [timing, level, never],
      });
    else
      toast({
        title: 'Notes not counting?',
        message: `Check your ${kind} is in tune for this song, or set your input level.`,
        kind: 'info',
        timeout: 15000,
        actions: [tune, level, never],
      });
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
    sing.setBest(H.prevBest ? H.prevBest.vocals : undefined);
    sing.setOpen(true);
    keys.setBest(H.prevBest ? H.prevBest.keys : undefined);
    keys.setOpen(true);
    // opened from the Karaoke page: the words only, for this visit
    if (state.karaokeNext) {
      const want = state.karaokeNext === song.id;
      state.karaokeNext = null;
      if (want) (keys.turn(false), sing.setKaraoke(true) || toast({ title: 'No words to sing', message: 'This song has no lyrics in it.', kind: 'info' }));
    }
    // 4.18: opened from a "play it on…" button somewhere else in Stagehand
    if (state.modeNext) {
      const m = state.modeNext;
      state.modeNext = null;
      if (m.id === song.id) playAs(m.mode);
    }
    wasAside = aside();
    paintModes();
    newWatch();
    hideCard();
    resetJudge();
    renderControls();
    renderStatus();
    loop();
    setTimeout(() => H.open && H.tab && maybeFirstSync(), 700);
  }

  function close() {
    closeTraining();
    H.open = false;
    sing.setOpen(false);
    keys.setOpen(false);
    extras.close();
    hwTuner.hide();
    tunerOn = false;
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
    H.decorVenue = venueRotation.forSong(song.id, {
      enabled: !!appearance().rotateVenues,
      eligible: VENUES.filter(v => v.photo && !venueLock(v.id)).map(v => v.id),
      fallback: VENUE_ALIAS[prefs.venue] || prefs.venue || 'warehouse',
    });
    // 4.5: a venue that's locked now (a progression reset) falls back to the warehouse
    if (venueLock(H.decorVenue)) H.decorVenue = 'warehouse';
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
      rig.setSongTuning(H.tab.tuning, instrument(), H.tab.cents || 0); // 4.3: this song's pitch, not the last one's
      H.scoringShift=tuneShift.st=rig.dropAmount();
      H.targets = buildTargets(H.tab);
      H.lyricLines = buildLyrics(H.tab.lyrics || []);
      lyricShown = -2;
      sing.setSong(song, H.tab.lyrics || []);
      keys.setSong(song);
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
    if (!H.open || !info || !info.song || H.training) {
      statusBox.hidden = true;
      return;
    }
    const title = esc(info.song.title || 'this song');
    let html = '';
    let key = '';
    if (info.phase === 'loading') {
      key = `loading:${info.song.id}:${info.note || ''}`;
      html = `<div class="hw-st-box"><span class="hw-st-spin"></span><b>Opening ${title}…</b><span>${esc(info.note || 'Getting the song audio ready.')}</span></div>`;
    } else if (info.phase === 'error') {
      key = `error:${info.song.id}:${info.error}`;
      html = `<div class="hw-st-box bad"><b>${title} didn’t open</b><span>${esc(info.error || 'Something went wrong.')}</span><div class="hw-st-acts">${info.code === 'AUDIO_NO_GAME' ? '<button type="button" class="btn small primary" data-act="game">Find my Rocksmith folder</button>' : ''}<button type="button" class="btn small${info.code === 'AUDIO_NO_GAME' ? ' ghost' : ' primary'}" data-act="retry">Try again</button>${info.prev ? `<button type="button" class="btn small ghost" data-act="prev">Back to ${esc(info.prev.title)}</button>` : ''}</div></div>`;
    } else if (info.waiting) {
      const st = info.waiting;
      const pct = st.state === 'ready' ? 100 : Math.round((st.progress || 0) * 100);
      const left = stemsLeft(st);
      const what = (st.state === 'ready' ? 'Loading the stems' : st.state === 'queued' ? 'Waiting to split the stems' : pct ? `Splitting the stems · ${pct}%` : stage.stemsStep ? stage.stemsStep(st) : 'Splitting the stems…') + (left ? ` · ${left}` : '');
      key = `wait:${info.song.id}:${st.state}`;
      // 4.12: waiting in line says which song is split first, and how far it has got
      const sub = st.state === 'queued' ? `${esc(splitFirst())}. ${title} is next.` : `${title} starts by itself as soon as its stems are ready.`;
      if (statusBox.dataset.key === key && (st.state === 'running' || st.state === 'queued')) {
        const b = statusBox.querySelector('b');
        if (b) b.textContent = what;
        const sp = statusBox.querySelector('.hw-st-box > span');
        if (sp && sp.innerHTML !== sub) sp.innerHTML = sub;
        const bar = statusBox.querySelector('.hw-st-bar > i');
        if (bar) bar.style.width = `${Math.max(2, pct)}%`;
        statusBox.hidden = false;
        return;
      }
      html = `<div class="hw-st-box"><b>${what}</b><span>${sub}</span><div class="hw-st-bar"><i style="width:${Math.max(2, pct)}%"></i></div><div class="hw-st-acts"><button type="button" class="btn small" data-act="now">Play now with the full mix</button></div></div>`;
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
    else if (b.dataset.act === 'game') stage.findGameThenRetry();
    else if (b.dataset.act === 'prev') stage.backToPrevious();
    else if (b.dataset.act === 'now') stage.playNow();
  };
  on('stage-phase', () => renderStatus());
  on('stems-update', () => H.open && (renderStatus(), mixSplitMoved()));
  on('stems-tick', () => H.open && (renderStatus(), mixSplitMoved())); // (the time left counts down)
  on('stage-phase', () => mixSplitMoved()); // (the stems finished loading)

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
    if (prefs.lyrics === false || !L.length || sing.active || keys.active) {
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
    if (!H.judge || !prefs.detect || !rig.on || !stage.engine.playing || aside()) return;
    const buf = rig.samples(analyzer.buf);
    if (!buf) return;
    if (!analyzer.an || analyzer.an.sr !== rig.sampleRate) analyzer.an = new Analyzer(rig.sampleRate);
    // What you play reaches us a little after you play it.
    const delay = ((rig.latencyMs || 20) / 1000 + 0.03) * stage.engine.speed;
    const t = songT - delay;
    const f = analyzer.an.frame(buf);
    const onset = analyzer.on.update(t, f);
    H.judge.push(t, f, onset);
    if (H.training && onset === 'attack') trainingPick(t, buf); // the timing check
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
        if (H.watch) H.watch.reset();
        H.landNext = lower(H.targets, raw);
        H.lands = []; H.hits = []; H.bursts = []; H.misses = [];
        sparks.length = 0;
        H.cam.ready = false;
      }
      H.lastClock = H.clock;
      listen(H.clock);

      // your timing nudge: positive shows notes later (they reach the neck later)
      const vis = visualTime(H.vclock, H.training ? 0 : prefs.offsetMs, eng.speed); // the timing check measures from 0
      H.vis = vis; // lyrics follow the same timing as the notes
      if (H.judge) H.judge.setPace(eng.speed);
      if (H.judge && eng.playing && prefs.detect && rig.on && !aside()) H.judge.tick(H.clock - (((rig.latencyMs || 20) / 1000 + 0.03) * eng.speed));
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
      sing.hold(!!H.training || keys.active); // the timing check's own song isn't for singing; piano has its own lane
      if (sing.active && !H.training && !keys.active) sing.frame(H.clock, vis, eng.playing, eng.speed || 1);
      if (keys.active && !H.training) keys.frame(H.clock, vis, eng.playing, eng.speed || 1);
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
    if (aside()) {
      // karaoke or piano: the stage only, no neck and no guitar notes
      R3.begin();
      R3.render(G.zF, G.zs * PAST);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      return;
    }
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
    buildApproach(t, a);
    buildNotes(t, a);
    buildLands(t, a);
    buildHits(t, a);
    buildBendGauge(t);
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
    const v = VENUES.find((x) => x.id === (H.decorVenue || VENUE_ALIAS[prefs.venue] || prefs.venue || 'warehouse'));
    // the picture's floor line goes where the highway's far end meets the floor; it drifts a little with the camera
    const vpY = H.tab && G.zF ? R3.project(G.camX || 0, 0, G.zF * 0.8)[1] : HH * 0.4;
    R3.setVenue(v && (v.photo || v.fluid) ? v : null, vpY, ((G.camX || 0) - 10) / 14, G.pulse * 0.5, G.heat * 0.5);
    if (v?.scene && H.open) {
      dropFluid();
      const now = performance.now();
      feat.update(stage.engine, rig, now);
      // if the moving picture can't be drawn right now, the photo shows instead of black
      if (!visuals.draw(v.scene, feat, now)) R3.setVenue(FALLBACK_VENUE, vpY, ((G.camX || 0) - 10) / 14, G.pulse * 0.5, G.heat * 0.5);
    } else {
      visuals.drop();
      if (v?.fluid && H.open) {
        driveFluid(t || 0);
        if (fluid.failed || !fluid.ready) R3.setVenue(FALLBACK_VENUE, vpY, ((G.camX || 0) - 10) / 14, G.pulse * 0.5, G.heat * 0.5);
      } else dropFluid();
    }
  }

  // Audio-driven backgrounds follow the audible song bus and processed instrument.
  const FALLBACK_VENUE = VENUES.find((x) => x.id === 'warehouse' && x.photo) || VENUES.find((x) => x.photo) || null;
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
  /** A round dot facing you (an inlay, its glow): centre colour cIn fading to cOut at the rim. */
  const DISC = Array.from({ length: 17 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)]);
  function disc(layer, cx, cy, z, r, cIn, cOut) {
    for (let k = 0; k < 16; k += 2) {
      const [a0, b0] = DISC[k];
      const [a1, b1] = DISC[k + 1];
      const [a2, b2] = DISC[k + 2];
      layer.q(cx, cy, z, cx + a0 * r, cy + b0 * r, z, cx + a1 * r, cy + b1 * r, z, cx + a2 * r, cy + b2 * r, z, cIn, cOut, cOut, cOut);
    }
  }
  function buildNeck(t, a, f0, f1) {
    const { solid, alpha, glow } = R3.L;
    const n = G.n;
    const xn = XF(-3);
    const xe = XF(24) + 0.8;
    const yb = -0.25;
    const yt = G.yTop + 0.32;
    // your hand position, faintly lit on the neck
    alpha.up(anX0(a), anX1(a), yb, yt, 0.06, col('#46c8ff', 0.05), col('#46c8ff', 0.1));
    // inlay dots between the strings, as on a real fretboard (4.16.2: round dots with a soft glow, were
    // tall see-through panels): gold in your hand position, teal elsewhere; two at the 12th and 24th
    const midY = (G.hl + G.yTop) / 2;
    for (const f of INLAYS) {
      if (f < f0 - 1 || f > f1 + 1) continue;
      const inA = f >= a.fret && f < a.fret + (a.width || 4);
      const w = laneW(f);
      const c = laneC(f);
      const r = Math.min(w * 0.12, 0.075);
      const ys = f % 12 === 0 ? [G.hl + (G.yTop - G.hl) * 0.28, G.hl + (G.yTop - G.hl) * 0.72] : [midY];
      for (const y of ys) {
        disc(alpha, c, y, 0.055, r, inA ? col('#ffe39a', 0.9) : col('#7fdce4', 0.42), inA ? col('#ffc040', 0.82) : col('#4fb8c4', 0.36));
        if (inA) disc(glow, c, y, 0.06, r * 1.9, col('#ffc446', 0.12), col('#000000', 0));
      }
    }
    // fret wires: round metal posts standing across the strings (lit from above, a bright edge
    // where the light catches them), the nut ivory and a little wider
    for (let f = Math.max(0, f0 - 1); f <= Math.min(24, f1 + 1); f++) {
      const x = XF(f);
      if (f === 0) solid.rodY(x, 0, yb, yt, 0.04, rodShades('#e4dcc6', 'post', 6));
      else solid.rodY(x, 0, yb, yt, 0.021, rodShades('#a9adb8', 'post', 4));
    }
    // strings: round and coloured, a touch thicker toward the low E, with a bright line along the top
    // where the light catches them and a soft glow behind (4.16.2: were flat boxes)
    for (let s = 0; s < n; s++) {
      const y = strH(s);
      const th = (n === 4 ? 0.034 : 0.028) - s * (n === 4 ? 0.0035 : 0.0024);
      solid.rodX(xn, xe, y, 0, th, rodShades(STRING[s], 'string', 6));
      R3.L.floor.bar([xn, 0.004, 0.05 + s * 0.012], [xe, 0.004, 0.05 + s * 0.012], th * 2.2, col('#000000', 0.22)); // its shadow on the floor
      glow.up(xn, xe, y - th * 3, y + th * 3, 0.03, col(STRING[s], 0.07));
    }
    // the hand position's edges at the neck: two bright posts, the same height as the frets
    // (3.12: they used to stand taller, which looked off to the user)
    for (const x of [anX0(a), anX1(a)]) {
      solid.rodY(x, -0.05, yb, yt, 0.03, rodShades('#fff4fb', 'post', 6));
      glow.up(x - 0.1, x + 0.1, yb, yt, -0.085, col('#ff7ad2', 0.12), col('#50e8ff', 0.1));
    }

  }

  // ------------------------------------------------------- approach --
  // 4.2.1 (user's Rocksmith clips): the neck lights up for a note BEFORE it lands, whether
  // or not you play it. Measured frame by frame at 60 fps:
  // - each coming note's spot on the neck (its string, its fret) shows as a dim outline about
  //   a second early, getting brighter as the note closes in, and glows while it's held;
  // - the two fret wires around it light up as white posts about 0.15 s before it lands,
  //   brightest as it lands, stay lit (dimmer) through its sustain, then fade;
  // - a chord's frame does the same at the neck: an outline that brightens, a flash as it lands.
  const TARGET_LEAD = 1.0; // s before landing that a note's spot on the neck shows
  const POST_LEAD = 0.16; // s before landing that its fret wires light
  const POST_FADE = 0.22; // s for the posts to fade after the note (or its sustain) ends
  const BOX_LEAD = 0.5; // s before a chord lands that its box at the neck starts to light
  const BOX_HOLD = 0.6; // s a chord's box stays faintly lit after it lands
  const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

  /** How lit the wires around a note are at time t: rising before it lands, held while it rings. */
  function postLight(t, t0, t1) {
    if (t < t0) return 0.95 * smooth(1 - (t0 - t) / POST_LEAD) ** 1.5;
    const flash = 0.45 + 0.55 * Math.exp(-(t - t0) / 0.12);
    if (t <= t1) return Math.max(flash, 0.5);
    return Math.max(0, (t1 > t0 + 0.05 ? 0.5 : flash) * (1 - (t - t1) / POST_FADE));
  }

  function buildApproach(t, a) {
    const { solid, alpha, glow } = R3.L;
    const T = H.targets;
    if (!T || !T.length) return;
    const spots = new Map(); // one per string and fret: the soonest note there
    const posts = new Map(); // fret wire x → how lit
    let frame = null; // the chord frame at the neck, the brightest one
    const post = (x, k) => {
      if (k < 0.02) return;
      const key = x.toFixed(3);
      posts.set(key, Math.max(posts.get(key) || 0, k));
    };
    for (let i = Math.max(0, lower(T, t - 8)); i < T.length && T[i].t < t + TARGET_LEAD; i++) {
      const tg = T[i];
      const st = judged(tg);
      const missed = !!(st && st.result === 'miss');
      const an = anchorAt(tg.t);
      const chord = isChord(tg);
      const box = chord ? chordBox(tg, an) : null;
      let end = tg.t;
      for (const nt of tg.notes) end = Math.max(end, noteEnd(nt, tg));
      if (t > end + POST_FADE) continue;
      // the fret wires: a missed note's go dark as soon as it's judged
      const pk = missed ? 0 : postLight(t, tg.t, end);
      if (chord) {
        post(box[0], pk);
        post(box[1], pk);
      } else {
        for (const nt of tg.notes) {
          if (nt.linked) continue;
          if (nt.f === 0) {
            post(anX0(an), pk * 0.8);
            post(anX1(an), pk * 0.8);
          } else {
            post(XF(nt.f - 1), pk);
            post(XF(nt.f), pk);
          }
        }
      }
      // the chord's frame at the neck
      // (4.2.1b: a full-height box, lit as the chord comes in, flashing as it lands, then
      // staying faintly lit for a moment, so a strummed passage keeps its box on the neck)
      if (chord && !missed) {
        const dt = tg.t - t;
        const ring = Math.max(end, tg.t + BOX_HOLD);
        const fk = dt > 0 ? (dt < BOX_LEAD ? 0.15 + 0.55 * smooth(1 - dt / BOX_LEAD) ** 2 : 0) : t <= ring ? Math.max(0.32, Math.exp(dt / 0.13)) : 0.32 * (1 - (t - ring) / 0.3);
        if (fk > 0.02 && (!frame || fk > frame.k)) frame = { k: fk, box, tg, flash: dt <= 0 ? Math.exp(dt / 0.13) : 0 };
      }
      // each note's spot on the neck
      for (const nt of tg.notes) {
        if (nt.linked) continue;
        const key = nt.s * 64 + nt.f;
        const ne = noteEnd(nt, tg);
        let k;
        if (tg.t > t) k = 0.18 + 0.62 * smooth(1 - (tg.t - t) / TARGET_LEAD) ** 2;
        else if (t <= ne) k = Math.max(0.55, Math.exp(-(t - tg.t) / 0.12));
        else k = 0.55 * (1 - (t - ne) / POST_FADE);
        if (k <= 0.02) continue;
        const cur = spots.get(key);
        // the soonest coming note wins; a ringing one keeps its spot lit
        if (!cur || (tg.t <= t && t <= ne) || (cur.at > t && tg.t < cur.at)) spots.set(key, { nt, tg, an, box, k, at: tg.t, missed, landed: tg.t <= t });
      }
    }
    // the spots: an outline in the string's colour, filled in and glowing as the note arrives
    const z = -0.012;
    for (const { nt, an, box, k, missed, landed } of spots.values()) {
      const hex = missed ? '#5a6078' : STRING[nt.s];
      const y = strH(nt.s);
      let x0, x1, hh;
      if (nt.f === 0) {
        x0 = (box ? box[0] : anX0(an)) + 0.1;
        x1 = (box ? box[1] : anX1(an)) - 0.1;
        hh = G.gy * 0.14;
      } else {
        const x = laneC(nt.f);
        const hw = laneW(nt.f) * (box ? 0.27 : 0.3);
        x0 = x - hw;
        x1 = x + hw;
        hh = G.gy * (box ? 0.4 : 0.44);
      }
      const kk = missed ? Math.min(k, 0.3) : k;
      const r = Math.min(x1 - x0, 2 * hh) * 0.12;
      const rc = col(hex, Math.min(1, 0.35 + kk), 0.8 + 1.4 * kk);
      glow.up(x0, x1, y + hh - r, y + hh, z, rc);
      glow.up(x0, x1, y - hh, y - hh + r, z, rc);
      glow.up(x0, x0 + r, y - hh, y + hh, z, rc);
      glow.up(x1 - r, x1, y - hh, y + hh, z, rc);
      alpha.up(x0, x1, y - hh, y + hh, z + 0.004, col(hex, 0.08 + 0.3 * kk));
      // the last moments and while it rings: a white-hot rim and a halo in the string's colour
      if (!missed && kk > 0.6) {
        const hot = (kk - 0.6) / 0.4;
        const p = r * 0.5;
        glow.up(x0 + p, x1 - p, y + hh - r - p * 0.3, y + hh - p, z - 0.002, col('#ffffff', 0.85 * hot, 1.4));
        glow.up(x0 + p, x1 - p, y - hh + p, y - hh + r + p * 0.3, z - 0.002, col('#ffffff', 0.85 * hot, 1.4));
        const R = (x1 - x0) * 0.35;
        glow.up(x0 - R, x1 + R, y - hh - R * 0.6, y + hh + R * 0.6, z + 0.006, col(hex, (landed ? 0.32 : 0.2) * hot, 1.3));
      }
    }
    // the fret wires: a white post with a warm pink glow, the same height as the frets
    for (const [xs, k] of posts) {
      const x = Number(xs);
      solid.box(x - 0.03, x + 0.03, -0.2, G.yTop + 0.32, -0.1, -0.03, col('#fff6ee', Math.min(1, k * 1.1), 1 + 1.2 * k));
      glow.up(x - 0.16, x + 0.16, -0.2, G.yTop + 0.32, -0.105, col('#ff7a9a', 0.32 * k, 1.2), col('#ff9a6a', 0.12 * k));
    }
    // the chord's box at the neck (as in Rocksmith): a rectangle as wide as the chord's frame,
    // from under the bottom string to just above the top one. Thin neon lines with a soft
    // glow (4.2.1c, user: "a little closer, and soften it"): cyan along the top and bottom,
    // pink-white posts for the sides, small bright top corners, hardly lit inside.
    if (frame) {
      const [xa, xb] = frame.box;
      const k = frame.k;
      const hot = frame.flash;
      const y0 = Math.max(-0.2, nY(0) - G.gy * 0.7);
      const y1 = nY(G.n - 1) + G.gy * 0.6;
      const z = -0.06;
      const zg = z - 0.004;
      const lit = Math.min(1, 0.55 * k + 0.35 * hot);
      const g0 = railCol(0);
      // top and bottom: a thin bright core and a soft glow fading away from it
      const core = mix(RAIL, '#ffffff', 0.08 + 0.15 * hot, Math.min(1, 0.3 + lit), 0.9 + 0.5 * lit);
      const th = 0.028; // line half-width
      const R = 0.2 + 0.08 * hot;
      const gc = railCol(0.3 * lit, 1.1);
      for (const y of [y0, y1]) {
        glow.up(xa - th, xb + th, y - th, y + th, zg - 0.002, core);
        glow.quad([xa - R * 0.4, y - R, zg], [xb + R * 0.4, y - R, zg], [xb + R * 0.4, y, zg], [xa - R * 0.4, y, zg], g0, g0, gc, gc);
        glow.quad([xa - R * 0.4, y, zg], [xb + R * 0.4, y, zg], [xb + R * 0.4, y + R, zg], [xa - R * 0.4, y + R, zg], gc, gc, g0, g0);
      }
      // the sides: pink-white posts with a soft pink glow, cyan where they meet the top
      const pc = col('#ffe6f2', Math.min(1, 0.25 + lit), 0.9 + 0.5 * lit);
      const pg = col('#ff6ec4', 0.28 * lit, 1.1);
      const p0 = col('#ff6ec4', 0);
      const Rs = 0.16 + 0.06 * hot;
      for (const x of [xa, xb]) {
        glow.up(x - th, x + th, y0, y1, zg - 0.002, pc);
        glow.quad([x - Rs, y0, zg], [x, y0, zg], [x, y1, zg], [x - Rs, y1, zg], p0, pg, pg, p0);
        glow.quad([x, y0, zg], [x + Rs, y0, zg], [x + Rs, y1, zg], [x, y1, zg], pg, p0, p0, pg);
        // a small bright corner where the side meets the top
        const cR = 0.11 + 0.05 * hot;
        const cc = mix(RAIL, '#ffffff', 0.4, Math.min(0.9, 0.35 * lit + 0.3 * hot), 1.4);
        glow.quad([x - cR, y1 - cR, zg - 0.003], [x + cR, y1 - cR, zg - 0.003], [x + cR, y1, zg - 0.003], [x - cR, y1, zg - 0.003], g0, g0, cc, cc);
        glow.quad([x - cR, y1, zg - 0.003], [x + cR, y1, zg - 0.003], [x + cR, y1 + cR, zg - 0.003], [x - cR, y1 + cR, zg - 0.003], cc, cc, g0, g0);
      }
      // only a breath of light inside, a little more as it lands
      alpha.up(xa, xb, y0, y1, z + 0.02, railCol(0.015 + 0.04 * hot), railCol(0.01 + 0.02 * hot));
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
  // a held-on note keeps the bend it was left at (4.0.6)
  const bendAt = heldBend;
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
   * a bend climbs (with ↑ and how far); vibrato is quick little bends, smooth and
   * round, the same way (a bent note's bend wobbles: one bend that wobbles, 4.0.6);
   * tremolo picking is a sharp sideways zigzag with hard corners (as in Rocksmith),
   * so the two never look alike.
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
    const VIB_HZ = VIBRATO_HZ;
    const trem = !!nt.tremolo && !open;
    const TREM_HZ = 6; // zigzags per second
    const posAt = (time) => {
      const u = duration > 0 ? (time - tg.t) / duration : 0;
      const e = Math.min(1, Math.max(0, u));
      let x = x0 + (x1 - x0) * (e * e * (3 - 2 * e));
      const age = Math.max(0, time - tg.t);
      const ease = Math.min(1, age / 0.12);
      // tremolo: a sideways triangle wave (straight lines, sharp corners)
      if (trem) {
        const ph = (age * TREM_HZ) % 1;
        x += (ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4) * lw * 0.3 * ease;
      }
      // vibrato is little bends, smooth and quick: up and back on a straight note, down
      // from the bend and back on a bent one, the same way the ribbon bends (drawn twice
      // as big as it sounds, a half step, so it reads from the back; no ↑ label)
      const hb = heldBend(nt, time);
      const vb = vibratoAt(nt, time, hb);
      const bend = hb + 2 * vb;
      // seen from behind, lifting alone hardly shows: it leans a little sideways with each lift
      if (vb) x += Math.abs(vb) * 2 * lw * 0.22;
      const direction = L0 > (G.n-1)/2 ? -1 : 1; // push lower strings inward; pull upper strings inward
      const L = L0 + direction * bend * .70;
      return [x, nY(L) - G.gy * 0.12, zOf(time), L];
    };
    // enough points for the vibrato wave to stay round and the tremolo corners sharp
    const steps = Math.max(6, Math.min(vib || trem ? 400 : 120, Math.round((t1 - t0) * (trem ? TREM_HZ * 16 : vib ? VIB_HZ * 14 : 40))));
    const b0 = nt.linked ? bendStart(nt) : 0;
    const bending = maxBend(nt) > 0 || b0 > 0 || vib;
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
        for (const side of [-1, 1]) alpha.bar([prev[0] + side * half, prev[1] + 0.002, prev[2]], [p[0] + side * half, p[1] + 0.002, p[2]], trem ? 0.06 : vib ? 0.05 : 0.035, trem && !missed && lift <= 0.05 ? col('#ffffff', 0.95, holding ? 1.8 : 1.3) : ec);
        if (!missed) glow.quad([prev[0] - half * 1.6, prev[1], prev[2]], [prev[0] + half * 1.6, prev[1], prev[2]], [p[0] + half * 1.6, p[1], p[2]], [p[0] - half * 1.6, p[1], p[2]], col(hex, holding ? 0.3 : 0.12));
      }
      prev = p;
    }
    // the ↑ and the riser only where a bend starts, not again on the held-on part
    const mb = maxBend(nt) > b0 + 0.25 ? maxBend(nt) : 0;
    if(mb>0 && peak && !b0){
      const p=posAt(Math.max(t0,tg.t));
      alpha.bar([p[0],nY(L0)-G.gy*.12,p[2]],[p[0],p[1],p[2]],.045,col('#fff3d6',.8));
    }
    if (mb > 0 && peak && peak.p[2] >= 0) label(`↑${bendLabel(mb)}`, peak.p[0], peak.p[1] + G.gy * 0.4, peak.p[2], { size: 0.32, min: 12, max: 26, color: '#fff3d6', base: 'bottom' });
  }

  /**
   * 4.0: while you hold a bend at the neck, a small gauge stands on its string:
   * a rail up to how far to bend (with the amount), a bright mark where the
   * chart's bend is right now, and a white mark for how far you've bent (heard
   * from your guitar), so you can match it.
   */
  function buildBendGauge(t) {
    const { alpha, glow } = R3.L;
    const T = H.targets;
    let heard = null;
    for (let i = Math.max(0, lower(T, t - 8)); i < T.length && T[i].t <= t; i++) {
      const tg = T[i];
      for (const nt of tg.notes) {
        const held = nt.linked ? bendStart(nt) : 0;
        if (t > noteEnd(nt, tg) || !(maxBend(nt) > 0 || held > 0)) continue;
        const an = anchorAt(tg.t);
        const L0 = level(nt.s);
        const dir = L0 > (G.n - 1) / 2 ? -1 : 1; // the same way the sustain ribbon bends
        const yAt = (b) => nY(L0 + dir * b * 0.7);
        const x = noteX(nt, an) + laneW(Math.max(1, nt.f || an.fret)) * 0.32;
        const top = Math.max(maxBend(nt), held);
        const now = drawnBend(nt, t); // with its vibrato, as the ribbon shows it
        const z = -0.06;
        alpha.bar([x, yAt(0), z], [x, yAt(top), z], 0.07, col('#fff3d6', 0.45));
        // the target: a bar across, gold
        glow.bar([x - 0.18, yAt(top), z], [x + 0.18, yAt(top), z], 0.06, col('#ffc446', 0.95, 1.6));
        // where the chart is right now
        glow.bar([x - 0.13, yAt(now), z - 0.002], [x + 0.13, yAt(now), z - 0.002], 0.09, col(STRING[nt.s], 1, 2));
        // how far you've bent, heard from your guitar
        if (rig.on && stage.engine.playing) {
          if (heard === null) {
            const p = rig.pitch();
            heard = p ? p.midi + p.cents / 100 : NaN;
          }
          const mine = heard - (nt.midi + instrumentShift.st);
          if (Number.isFinite(mine) && mine > -0.6 && mine < top + 1.5) glow.bar([x - 0.14, yAt(Math.max(0, mine)), z - 0.004], [x + 0.14, yAt(Math.max(0, mine)), z - 0.004], 0.03, col('#ffffff', 0.95, 1.8));
        }
      }
    }
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
    // 4.2.1: in its last tenth of a second the rim goes white-hot, as in Rocksmith
    const rc = flare > 0.05 || (near > 0.8 && !missed) ? col('#ffffff', fade, rimK) : col(hex, fade, rimK);
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
    // 4.2.1c: at the neck the box there takes over; drawing this frame too showed a second,
    // smaller box inside it. Its notes still land.
    if (z < G.zs * 0.03 && !missed && !flare) {
      if (tg.repeat) return;
      for (const nt of tg.notes) buildGem(nt, z, an, missed, tg.kind === 'mute', true, [xa, xb], flare);
      return;
    }
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
    watchNote(e, tg);
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
      // no taller than the frets (4.0.6: taller ones read as pieces sticking out of the neck)
      solid.box(x - 0.035, x + 0.035, -0.2, G.yTop + 0.32, -0.1, -0.03, col('#fff0f8', k, 2.2));
      glow.up(x - 0.18, x + 0.18, -0.2, G.yTop + 0.32, -0.11, col('#ff5aaa', 0.4 * k, 1.3), col('#ff5aaa', 0.1 * k));
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
    // 4. 4.11: a ring of light bursts outward from each note you hit, so a hit reads at a glance:
    // in the string's colour, white-hot when you were right on time (within 30 ms). It lives for a
    // third of a second on the glow layer only: nothing about the notes, the neck, the timing or
    // the scoring changes. Sound & settings › Hit burst turns it off.
    if (prefs.hitBurst !== false) {
      for (const h of H.hits) {
        const age = (now - h.at) / 1000;
        if (age > 0.34) continue;
        const tg = H.targets[h.id];
        if (!tg) continue;
        const p = age / 0.34;
        const k = (1 - p) * (1 - p);
        const dead = h.offset !== null && h.offset !== undefined && Math.abs(h.offset) <= 30;
        const an = anchorAt(tg.t);
        const th = 0.03 + 0.02 * (1 - p);
        for (const nt of tg.notes) {
          const x = nt.f === 0 ? noteX(nt, an) : laneC(nt.f);
          const y = strH(nt.s);
          const w = laneW(Math.max(1, nt.f || an.fret)) * (0.5 + (dead ? 1.15 : 0.85) * p);
          const hh = G.gy * (0.5 + (dead ? 1.3 : 1.0) * p);
          const c = dead ? col('#ffffff', 0.9 * k, 2.2) : col(STRING[nt.s], 0.8 * k, 1.7);
          glow.up(x - w, x + w, y + hh - th, y + hh + th, -0.075, c);
          glow.up(x - w, x + w, y - hh - th, y - hh + th, -0.075, c);
          glow.up(x - w - th, x - w + th, y - hh, y + hh, -0.075, c);
          glow.up(x + w - th, x + w + th, y - hh, y + hh, -0.075, c);
        }
      }
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
  // The repeat: the bar under the strip ("Repeating Verse 2 → Chorus 3", its speed,
  // Speed up each time, ✕), and the repeated sections marked on the strip.
  let loopKey = '';
  /** "Verse 2": the name, numbered when the song has more than one. */
  function secLabel(i) {
    const secs = H.tab ? H.tab.sections : [];
    const n = pretty(secs[i] && secs[i].name);
    let k = 0;
    let all = 0;
    secs.forEach((x, j) => {
      if (pretty(x.name) !== n) return;
      all++;
      if (j <= i) k++;
    });
    return all > 1 ? `${n} ${k}` : n;
  }
  /** The sections a loop covers, as [first, last], or null. */
  function loopSections(loop) {
    const secs = H.tab ? H.tab.sections : [];
    if (!loop || !secs.length) return null;
    if (Number.isInteger(loop.from) && Number.isInteger(loop.to) && secs[loop.from] && secs[loop.to]) return [loop.from, loop.to];
    let a = -1;
    let b = -1;
    secs.forEach((x, i) => {
      if (x.start >= loop.start - 0.05 && x.end <= loop.end + 0.05) {
        if (a < 0) a = i;
        b = i;
      }
    });
    return a < 0 ? null : [a, b];
  }
  /** Repeat sections a..b (either order). The first one you picked stays the anchor for Shift+click. */
  function repeatSections(a, b, anchor = a) {
    const secs = H.tab.sections;
    const i = Math.min(a, b);
    const j = Math.max(a, b);
    const label = i === j ? secLabel(i) : `${secLabel(i)} → ${secLabel(j)}`;
    rep.start({ start: secs[i].start, end: secs[j].end, label, from: i, to: j, anchor });
    did('repeat');
    // carry on if you're already playing inside it, else start just before it
    const t = stage.engine.position;
    if (t < secs[i].start - 1.5 || t >= secs[j].end) jumpTo(Math.max(0, secs[i].start - 1));
    renderLoop(true);
  }
  function renderLoop(force) {
    const loop = rep.loop || (stage.getLoop ? stage.getLoop() : null);
    const key = loop ? `${loop.start}-${loop.end}` : '';
    if (key === loopKey && !force) return;
    loopKey = key;
    root.classList.toggle('hw-repeating', !!loop);
    const r = loopSections(loop);
    for (const b of sections.querySelectorAll('button[data-i]')) {
      const i = Number(b.dataset.i);
      const inside = !!(r && i >= r[0] && i <= r[1]);
      b.classList.toggle('looping', inside);
      b.classList.toggle('loop-first', inside && i === r[0]);
      b.classList.toggle('loop-last', inside && i === r[1]);
      const rp = b.querySelector('.hw-sec-rep');
      if (rp) {
        const t = inside ? 'Stop repeating' : r ? `Repeat ${secLabel(i)} (Shift+click: stretch the repeat to here)` : `Repeat ${secLabel(i)} (Shift+click another to repeat several)`;
        rp.title = t;
        rp.setAttribute('aria-label', t);
      }
    }
  }
  rep.addEventListener('change', () => H.open && renderLoop(true));

  function renderControls() {
    if (H.open) renderDropPop();
    const t = H.tab;
    titleBox.innerHTML = H.song ? `<b>${esc(H.song.title)}</b><span>${esc(H.song.artist)}${t ? ` · ${esc(t.tuningName || '')}${t.capo ? `, capo ${t.capo}` : ''}` : ''}</span>` : '';
    parts.innerHTML = '';
    for (const p of H.parts) {
      const b = h('button.hw-chip', { type: 'button', 'aria-pressed': String(!!(t && t.id === p.id) && !aside()), text: p.name, title: `Play the ${String(p.name).toLowerCase()} part on your ${p.type === 'bass' ? 'bass' : 'guitar'}` });
      b.dataset.id = p.id;
      b.onclick = () => playAs('guitar', p.id);
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
    const shown = toneName;
    toneBtn.innerHTML = `${icon('amp')}${instrumentTag(rig)}<span>${esc(shown)}</span>${rig.capture ? '<span class="real-badge sm" title="A real amp is playing">REAL</span>' : ''}${icon('chevron')}`;
    toneBtn.hidden = !rig.on;
    rigBox.classList.toggle('real', !!rig.capture);
    renderMix();
    paintSpeedChip(speedChip, stage.engine.speed || 1);
    // section strip
    sections.innerHTML = '';
    if (t && t.sections.length) {
      const total = stage.engine.duration || t.length || 1;
      // 4.2: a long section (some songs have only one or two) goes to the spot you click,
      // like the arrow keys; a normal one goes to its start. The time shows as you hover.
      const LONG = 30;
      const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
      const spotIn = (b, e, a, z) => {
        const r = b.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
        return a + f * (z - a);
      };
      const hoverTime = (b, a, z, name) => {
        if (z - a <= LONG) return;
        b.onpointermove = (e) => {
          b.title = `${name}: click to go to ${fmt(spotIn(b, e, a, z))}`;
        };
      };
      if (t.sections[0].start > 0.5) {
        const b0 = h('button', { type: 'button', text: '', title: 'The start' });
        const z0 = t.sections[0].start;
        b0.style.flexGrow = String(z0);
        b0.onclick = (e) => jumpTo(z0 > LONG ? spotIn(b0, e, 0, z0) : 0);
        hoverTime(b0, 0, z0, 'The start');
        sections.append(b0);
      }
      // Drag across the strip (press on one section, let go on another) to repeat them all.
      let drag = null;
      const secAt = (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const b = el && el.closest && el.closest('.hw-sections button[data-i]');
        return b ? Number(b.dataset.i) : null;
      };
      const pick = (a, z) => {
        for (const b of sections.querySelectorAll('button[data-i]')) {
          const i = Number(b.dataset.i);
          b.classList.toggle('hw-pick', a !== null && i >= Math.min(a, z) && i <= Math.max(a, z));
        }
      };
      const onMove = (e) => {
        if (!drag) return;
        const i = secAt(e);
        if (i === null || i === drag.to) return;
        drag.to = i;
        drag.moved = drag.to !== drag.from;
        pick(drag.moved ? drag.from : null, drag.to);
      };
      const endDrag = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
        const d = drag;
        drag = null;
        pick(null, 0);
        if (d && d.moved) {
          repeatSections(d.from, d.to);
          sections.dataset.dragged = '1'; // the click that follows is not a jump
          setTimeout(() => delete sections.dataset.dragged, 0);
        }
      };
      sections.onpointerdown = (e) => {
        const i = secAt(e);
        if (i === null || e.button !== 0 || e.shiftKey) return;
        drag = { from: i, to: i, moved: false };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
      };
      t.sections.forEach((s, i) => {
        // click: jump there (and stop any repeat). The ⟲ on the section repeats it, on purpose only.
        // Shift+click (or Shift+⟲) stretches the repeat to this section; so does a drag across the strip.
        const long = s.end - s.start > LONG;
        const b = h('button', { type: 'button', title: `${secLabel(i)}: click to ${long ? 'go to that spot' : 'jump here'}. Shift+click to repeat up to here.` });
        hoverTime(b, s.start, s.end, secLabel(i));
        b.append(h('span.hw-sec-name', { text: pretty(s.name) }));
        const repBtn = h('span.hw-sec-rep', { role: 'button', title: `Repeat ${secLabel(i)}`, 'aria-label': `Repeat ${secLabel(i)}`, html: icon('repeat') });
        b.append(repBtn);
        b.style.flexGrow = String(Math.max(0.01, s.end - s.start));
        b.dataset.i = String(i);
        b.onclick = (e) => {
          if (sections.dataset.dragged) return;
          const loop = rep.loop || (stage.getLoop ? stage.getLoop() : null);
          const r = loopSections(loop);
          if (e.shiftKey) {
            // stretch the repeat from the section you picked first to this one
            // (nothing repeating: from the section that's playing)
            let anchor = r ? (Number.isInteger(loop.anchor) ? loop.anchor : r[0]) : t.sections.findIndex((x) => stage.engine.position >= x.start && stage.engine.position < x.end);
            if (anchor < 0) anchor = i;
            repeatSections(anchor, i, anchor);
          } else if (e.target.closest('.hw-sec-rep')) {
            if (r && i >= r[0] && i <= r[1]) rep.stop();
            else repeatSections(i, i);
          } else {
            if (loop) rep.stop();
            if (long) {
              // near the start of the section: its start (with a second's run-up), else the spot
              const at = spotIn(b, e, s.start, s.end);
              jumpTo(at - s.start < 3 ? Math.max(0, s.start - 1) : at);
            } else jumpTo(Math.max(0, s.start - 1));
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
      if (!syncBox.hidden || trainSnap) {
        if (e.key === 'Escape') closeSync();
        // the timing check plays to the end: no pausing or skipping (Space would press a button)
        if (trainSnap && syncBox.hidden && !e.target.closest?.('input, select, textarea')) {
          e.preventDefault();
          e.stopPropagation();
        }
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
    timingCheck,
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
