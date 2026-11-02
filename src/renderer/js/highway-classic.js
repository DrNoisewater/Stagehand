import { chordSpan, isChordRepeat } from './highway-layout.js';
// the 2D highway keeps its own pace (3.5)
const APPROACH_UNITS = 8.8;
const approachDepth = (noteTime, chartTime, flow = 1) => (noteTime - chartTime) * APPROACH_UNITS * flow;
/**
 * Note highway: the part coming toward you down a 3D fretboard, Rocksmith
 * style. Low E on top. The camera glides between hand positions, the clock
 * follows speaker time without additional smoothing, notes arrive early and slowly enough to read,
 * and every gem carries a big fret number.
 */
import { visualTime, sustainIndex, firstSustain, noteEnd } from './highway-timing.js';
import { api } from './api.js';
import { vibratoAt } from './performance-math.js';
import { h, icon, esc, showMenu, toast } from './ui.js';
import { rig, TONES } from './rig.js';
import { songToneChoice, saveToneChoice } from './tab.js';
import { tonelib, useTone } from './tonelib.js';
import { VENUES, createVenue, createFire } from './venues.js';
import { suggestionFor } from './captures.js';
import { getRealAmp, modelLabel } from './realamps.js';
import { Analyzer, OnsetTracker, Judge, targetsFromTab, tuneShift } from './detect.js';

const STRING = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];
const STRING_DARK = ['#7a1d27', '#7a5e12', '#164e80', '#7a4515', '#1c6a3c', '#55307f'];
const NAMES6 = ['E', 'A', 'D', 'G', 'B', 'e'];
const NAMES4 = ['E', 'A', 'D', 'G'];
const FONT = "'Archivo', 'Segoe UI', sans-serif";
const SPEEDS = [0.5, 0.6, 0.75, 0.85, 1];

function load() {
  try {
    return { ahead: 4, flow: 1, lowTop: true, detect: true, venue: 'arena', fx: true, ...(JSON.parse(localStorage.getItem('stagehand.highway') || '{}') || {}) };
  } catch (_) {
    return { ahead: 4, flow: 1, lowTop: true, detect: true, venue: 'arena', fx: true };
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

/** The 2D highway (3.5), used only when the graphics card can't do WebGL. */
export function createClassicHighway(stage) {
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
  root.dataset.renderer = '2d';
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
  const mixTab = h('button.hw-dock-tab', { type: 'button', title: 'Show or hide the song mix', 'aria-label': 'Song mix' });
  const dock = h('div.hw-dock', null, mixTab, mixPanel);
  let mixOpen = !!prefs.mixOpen;
  const optBtn = h('button.hw-icon', { type: 'button', title: 'Highway options', 'aria-label': 'Highway options', html: icon('sliders') });
  // the Mix button doubled the tab on the right edge: the tab opens the mix now
  const score = h('div.hw-score');
  // the score sits up top (as in the game), leaving the fret numbers under the neck clear
  top.append(back, titleBox, h('span.grow'), score, h('span.grow'), parts, playAlong, rigBox, optBtn);
  const sections = h('div.hw-sections');
  const bottom = h('div.hw-bottom');
  const playBtn = h('button.hw-play', { type: 'button', title: 'Play / pause (Space)' });
  const time = h('div.hw-time');
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
  bottom.append(playBtn, time, h('span.grow'), h('span.hw-label', { text: 'Speed' }), speed);
  const msg = h('div.hw-msg', { hidden: true });
  root.append(canvas, top, sections, bottom, msg, dock);
  document.body.append(root);
  root.__hw = H; // for tests
  const ctx = canvas.getContext('2d');

  let lastInteraction = performance.now();
  const wakeControls = () => { lastInteraction = performance.now(); root.classList.remove('hw-quiet'); };
  root.addEventListener('pointermove', wakeControls);
  root.addEventListener('pointerdown', wakeControls);
  root.addEventListener('focusin', wakeControls);
  document.addEventListener('keydown', () => { if (H.open) wakeControls(); });

  back.onclick = () => close();
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
  optBtn.onclick = () => {
    const r = optBtn.getBoundingClientRect();
    const c = (on) => (on ? '✓' : '');
    showMenu(
      r.right,
      r.bottom + 6,
      [
        { heading: true, label: 'Highway motion (song tempo stays unchanged)' },
        ...[[0.8, 'Relaxed'], [1, 'Reference (default)'], [1.2, 'Brisk']].map(([v, label]) => ({ label, hint: c((prefs.flow ?? 1) === v), onClick: () => setPref('flow', v) })),
        '-',
        { heading: true, label: 'Preview in song seconds' },
        ...[3, 4, 5, 6].map((s) => ({ label: s === 4 ? `${s} seconds (default)` : `${s} seconds`, hint: c(prefs.ahead === s), onClick: () => setPref('ahead', s) })),
        '-',
        { heading: true, label: 'Note timing (if notes look early or late against the music)' },
        ...[-100, -75, -50, -25, -10, 0, 10, 25, 50, 75, 100].map((ms) => ({ label: ms === 0 ? 'In sync (default)' : ms < 0 ? `Notes ${-ms} ms earlier` : `Notes ${ms} ms later`, hint: c((prefs.offsetMs || 0) === ms), onClick: () => setPref('offsetMs', ms) })),
        '-',
        { label: 'Low E on top', hint: c(prefs.lowTop), onClick: () => setPref('lowTop', true) },
        { label: 'High e on top', hint: c(!prefs.lowTop), onClick: () => setPref('lowTop', false) },
        '-',
        { label: 'Score my playing', hint: c(prefs.detect), onClick: () => setPref('detect', !prefs.detect) },
        '-',
        { heading: true, label: 'Venue' },
        ...VENUES.map((v) => ({ label: v.name, hint: c(prefs.venue === v.id), onClick: () => setPref('venue', v.id) })),
        { label: 'Fire when you’re on a streak', hint: c(prefs.fx), onClick: () => setPref('fx', !prefs.fx) },
      ],
      { align: 'right' }
    );
  };


  // ------------------------------------------------------------- tones --
  function followsSong() {
    const st = H.tab && H.tab.songTones;
    if (!st || !H.song) return false;
    return (songToneChoice[H.song.id] || 'song') === 'song';
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
    const choice = H.song ? songToneChoice[H.song.id] : null;
    if (followsSong()) {
      const tone = songToneAt(stage.engine.position);
      H.toneKey = tone ? tone.key : null;
      if (tone) rig.setSongTone(tone);
    } else if (choice && choice !== 'song' && rig.findTone(choice)) {
      if (rig.mode === 'song' || rig.toneId !== choice) rig.setTone(choice);
    }
  }
  function followTone(t) {
    if (!rig.on || !followsSong() || rig.mode !== 'song') return;
    const tone = songToneAt(t);
    if (tone && tone.key !== H.toneKey) {
      H.toneKey = tone.key;
      rig.setSongTone(tone);
    }
  }
  function chooseTone(id) {
    if (H.song) {
      songToneChoice[H.song.id] = id;
      saveToneChoice();
    }
    if (id === 'song') {
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
    mixTab.innerHTML = `${icon(on ? 'chevronRight' : 'chevronLeft')}<span>Mix</span>`;
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
      h('div.hw-mix-head', null, h('b', { text: 'Mix' })),
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
    resetJudge();
    renderControls();
    loop();
  }

  function close() {
    H.open = false;
    root.hidden = true;
    cancelAnimationFrame(H.raf);
    H.raf = 0;
    document.getElementById('app').classList.remove('under-highway');
    api.app.fullscreen(false).catch(() => {});
    stage.onHighwayClosed && stage.onHighwayClosed();
  }

  async function loadSong(song, partId) {
    // only the newest request fills the highway (an older song's late answer is dropped)
    const token = (H.loadToken = (H.loadToken || 0) + 1);
    H.song = song;
    H.tab = null;
    showMsg('Reading the part…');
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
      H.targets = buildTargets(H.tab);
      showMsg(null);
      applyPlayAlong();
      resetJudge();
      H.toneKey = null;
      applyTone();
    } catch (err) {
      if (token !== H.loadToken) return;
      showMsg(err.message);
    }
    renderControls();
  }

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
    return t;
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
    tuneShift.st = rig.dropAmount();
    H.targets = buildTargets(H.tab);
    resetJudge();
  });

  // ------------------------------------------------------------ scoring --
  const analyzer = { an: null, on: null, buf: new Float32Array(8192) };
  function resetJudge() {
    H.judge = H.targets.length ? new Judge(H.targets) : null;
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
  }
  window.addEventListener('resize', () => H.open && resize());

  function loop() {
    cancelAnimationFrame(H.raf);
    const step = (now) => {
      if (!H.open) return;
      const dt = Math.min(0.1, (now - H.last) / 1000);
      H.last = now;
      // The engine already interpolates the speaker's sample clock. A second
      // smoothing clock adds lag at speed changes, seeks and frame stalls.
      const eng = stage.engine;
      const raw = eng.position;
      H.clock = raw;
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
      const vis = visualTime(H.clock, prefs.offsetMs, eng.speed);
      if (H.judge && eng.playing && prefs.detect && rig.on) H.judge.tick(H.clock - (((rig.latencyMs || 20) / 1000 + 0.03) * eng.speed));
      processEvents(vis);
      followTone(H.clock);
      draw(vis, dt);
      root.classList.toggle('hw-quiet', eng.playing && now - lastInteraction > 2500 && !mixOpen && !document.querySelector('.menu[role="menu"]') && !root.querySelector(':focus-visible'));
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
  // Laid out like Rocksmith 2014 (measured off real gameplay), drawn sharper:
  //   x runs along the neck, y is height above the highway floor (each string
  //   has its own height, low E on top by default), z is time ahead (0 = the
  //   neck, where you play). The neck is an upright strip at z = 0 near the
  //   bottom of the screen; the highway floor runs from it to a far vanishing
  //   point. Frets are nearly even in width (Rocksmith squeezes the real
  //   spacing), so fret 20 reads as easily as fret 3.
  // Camera framing follows the imminent playing area. Distant preview notes
  // must not pull the neck sideways before the player needs to move. It sits a little toward the high frets and looks slightly back
  // across the neck, so the strings fall gently to the right and the highway
  // leans in from the left, as in the game.
  const RATIO = 0.982; // each fret this much narrower than the one before
  // world x of fret wire f (below the nut it carries on evenly, so the view can run past it)
  const XF = (f) => (f < 0 ? f : (1 - Math.pow(RATIO, f)) / (1 - RATIO));
  const FX = (x) => (x < 0 ? x : Math.log(Math.max(1e-6, 1 - x * (1 - RATIO))) / Math.log(RATIO));
  const laneC = (f) => (XF(f - 1) + XF(f)) / 2; // middle of fret f's lane
  const laneW = (f) => XF(f) - XF(f - 1);
  const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
  // seconds of hand positions the camera frames: Rocksmith keeps a whole roaming
  // phrase in view (a solo stays zoomed out), so this looks well past the notes on screen
  const LOOK = () => Math.max(4, (prefs.ahead || 4) * 1.1);

  // Scene geometry, refreshed each frame.
  const G = {};

  function geometry(t) {
    const n = H.tab.strings;
    G.n = n;
    G.t = t;
    G.L = prefs.ahead;
    // The neck leans back like a guitar on a stand: each string up is a little
    // higher and a little further away. A note rides in at its own string's
    // height and depth the whole way and meets its string exactly; nothing
    // drops. Notes meet a common strike plane; string height carries pitch information.
    G.gy = n === 4 ? 0.42 : 0.32; // height per string: an upright neck, every string at z = 0
    G.gz = 0; // so every note reaches its string at the same instant
    G.hl = 0.1; // the bottom string above the floor
    G.gap = Math.hypot(G.gy, G.gz); // spacing along the neck
    G.yMid = G.hl + ((n - 1) / 2) * G.gy;
    G.zMid = ((n - 1) / 2) * G.gz;
  }
  const level = (s) => (prefs.lowTop ? G.n - 1 - s : s);
  /** A point on the leaning neck: L counts strings up from the bottom one (fractions allowed). */
  const nY = (L) => G.hl + L * G.gy;
  const nZ = (L) => L * G.gz;
  const strH = (s) => nY(level(s)); // a string's height
  const strZ = (s) => nZ(level(s)); // and how far back it sits
  const zOf = (time) => approachDepth(time, G.t, prefs.flow ?? 1);
  const anX0 = (an) => XF(an.fret - 1);
  const anX1 = (an) => XF(an.fret - 1 + (an.width || 4));
  const noteX = (nt, a) => (nt.f === 0 ? (anX0(a) + anX1(a)) / 2 : laneC(nt.f));

  // ---- camera --
  /** Frets (as lane edges, lo..hi) that the next few seconds of play use. */
  function playRange(t, horizon = LOOK()) {
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
    // notes that stretch outside their hand position, and slides, count too
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

  /** The stretch of neck to show for a range: a little room each side, at least ~9 frets. */
  function viewFor(r) {
    let lo = r.lo - 1.6;
    let hi = r.hi + 1.4;
    const MIN = 11;
    if (hi - lo < MIN) {
      const c = (lo + hi) / 2;
      lo = c - MIN / 2;
      hi = c + MIN / 2;
    }
    // like the game, the view may run past the nut so the hand position stays near the middle
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

  function camera(t, dt) {
    const c = H.cam;
    const want = viewFor(playRange(t, 1.25));
    const fr = c.frame;
    if (!fr || !c.ready) c.frame = { ...want, slack: 0 };
    else if (want.lo < fr.lo - 0.05 || want.hi > fr.hi + 0.05) {
      // something coming doesn't fit: take it in now (keep what still fits, so it pans)
      c.frame = { lo: Math.min(want.lo, fr.lo), hi: Math.max(want.hi, fr.hi), slack: 0 };
      if (c.frame.hi - c.frame.lo > want.hi - want.lo + 2.5) c.frame = { ...want, slack: 0 };
    } else if (want.hi - want.lo < (fr.hi - fr.lo) * 0.8) {
      // more room than needed: close in once it has stayed that way a moment
      fr.slack += dt;
      if (fr.slack > 2.5) c.frame = { ...want, slack: 0 };
    } else fr.slack = 0;
    const x0 = XF(c.frame.lo);
    const x1 = XF(c.frame.hi);
    const tx = (x0 + x1) / 2;
    const span = x1 - x0;
    G.F = HH * 1.0; // focal length in pixels
    // Measured off Rocksmith at 1080p: close in, the neck sits 75% down and the
    // highway runs up to a vanishing point 18% from the top; with the whole
    // neck in view the camera drops lower and flatter (neck 84% down, vanishing
    // point at 39%), so the strings spread a little more against the frets.
    const zoomK0 = Math.max(0, Math.min(1, (span - 9.5) / 9));
    c.zk = c.ready && c.zk !== undefined ? c.zk + (zoomK0 - c.zk) * Math.min(1, dt * 2.5) : zoomK0;
    const zoomK = c.zk;
    const elev = 0.56 - 0.12 * zoomK; // how steeply the camera looks down at the neck
    const pitch = 0.28 - 0.06 * zoomK;
    // distance that fits the span across ~96% of the width at the neck
    const depthN = (G.F * span) / (0.96 * W);
    // fitK learns how far off that estimate is (the slight turn makes the right side nearer)
    const td = ((depthN * Math.cos(elev)) / Math.cos(elev - pitch));
    if (!c.ready) Object.assign(c, { x: tx, d: td, vx: 0, vd: 0, ready: true });
    else {
      // a critically damped glide: quick to pull back, gentle coming in
      const w = td > c.d ? 4.2 : 2.2;
      for (let left = dt; left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        c.vx += (4.2 * 4.2 * (tx - c.x) - 2 * 4.2 * c.vx) * h;
        c.x += c.vx * h;
        c.vd += (w * w * (td - c.d) - 2 * w * c.vd) * h;
        c.d += c.vd * h;
      }
    }
    const d = c.d;
    const yaw = 0.06; // a touch: the strings fall gently to the right
    G.ca = Math.cos(yaw);
    G.sa = Math.sin(yaw);
    G.cp = Math.cos(pitch);
    G.sp = Math.sin(pitch);
    const yMid = G.yMid;
    const zMid = G.zMid;
    G.camY = yMid + d * Math.tan(elev);
    G.camZ = -d;
    // The camera sits toward the high frets (the vanishing point lands right of
    // centre, over them) while the picture is shifted so your frets stay centred.
    G.camX = c.x + span * 0.06 + d * Math.tan(yaw);
    G.cx = W * 0.5;
    G.cy = HH * 0.5;
    G.cx = W - PX(c.x, G.yMid, G.zMid);
    G.cy = 0;
    G.cy = HH * (0.75 + 0.09 * zoomK) - PY(c.x, yMid, zMid);

    // the highway reaches far enough to fade into the distance at any zoom
    // Camera motion must never rescale the time axis. Practice speed follows audio.
    G.zs = APPROACH_UNITS * (prefs.flow ?? 1);
    G.zF = G.zs * G.L;
    G.zoomK = zoomK;
    c.f = FX(c.x); // camera centre in frets (tests read this)
    H.projection = { point: (f, s, time) => { const x = laneC(f), y = strH(s), z = zOf(time); return [PX(x,y,z), PY(x,y,z)]; }, neck: (f,s) => [PX(laneC(f),strH(s),0), PY(laneC(f),strH(s),0)] };
    c.px = scaleAt(c.x, yMid, zMid); // pixels per unit at the neck (tests)
  }

  // world -> camera: yaw about y, then pitch down
  function cam3(x, y, z) {
    const dx = x - G.camX;
    const dy = y - G.camY;
    const dz = z - G.camZ;
    const x1 = dx * G.ca + dz * G.sa;
    const z1 = -dx * G.sa + dz * G.ca;
    const y2 = dy * G.cp + z1 * G.sp;
    const z2 = -dy * G.sp + z1 * G.cp;
    return [x1, y2, Math.max(0.05, z2)];
  }
  const PX = (x, y, z) => {
    const [a, , d] = cam3(x, y, z);
    return G.cx + (G.F * a) / d;
  };
  const PY = (x, y, z) => {
    const [, b, d] = cam3(x, y, z);
    return G.cy - (G.F * b) / d;
  };
  /** pixels per world unit at a point (for sizes) */
  const scaleAt = (x, y, z) => G.F / cam3(x, y, z)[2];

  function poly(pts) {
    ctx.beginPath();
    pts.forEach(([x, y, z], i) => (i ? ctx.lineTo(PX(x, y, z), PY(x, y, z)) : ctx.moveTo(PX(x, y, z), PY(x, y, z))));
    ctx.closePath();
  }
  function line3(a, b) {
    ctx.beginPath();
    ctx.moveTo(PX(a[0], a[1], a[2]), PY(a[0], a[1], a[2]));
    ctx.lineTo(PX(b[0], b[1], b[2]), PY(b[0], b[1], b[2]));
  }
  const rgba = (hex, a) => {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
  };

  function draw(t, dt) {
    const tab = H.tab;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackdrop(t);
    if (!tab) return;
    geometry(t);
    camera(t, dt);
    const a = anchorAt(t);
    // frets on screen at the neck
    let f0 = 0;
    let f1 = 24;
    while (f0 < 24 && PX(XF(f0 + 1), 0, 0) < -40) f0++;
    while (f1 > 0 && PX(XF(f1 - 1), 0, 0) > W + 40) f1--;
    G.f0 = f0;
    G.f1 = f1;
    drawFloor(t, a, f0, f1);
    drawNeck(t, a, f0, f1);
    drawNotes(t, a);
    drawNeckFront(t, a, f0, f1);
    drawLands(t, a);
    drawHits(t, a, dt);
    drawFire(a, dt);
  }

  /** Flames off the neck across your hand position, and the streak badge. */
  function drawFire(a, dt) {
    // Never over the notes: embers rise from the neck's bottom edge outside
    // your hand position, the rails warm (drawFloor).
    const yTop = PY(...NP(anX0(a), G.neckLt));
    const yBot = PY(...NP(anX0(a), G.neckLb));
    const ha = PX(...NP(anX0(a), G.neckLb));
    const hb = PX(...NP(anX1(a), G.neckLb));
    const n0 = Math.max(0, PX(...NP(XF(0), G.neckLb)));
    fire.update(Math.min(0.05, dt || 0.016), G.heat, [[n0, ha - 24], [hb + 24, W]], yBot + 2);
    fire.draw(ctx);
    if (G.heat > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createLinearGradient(0, yBot - 18, 0, yBot + 14);
      gl.addColorStop(0, 'rgba(255, 90, 20, 0)');
      gl.addColorStop(1, `rgba(255, 110, 30, ${0.22 * G.heat * (0.8 + 0.2 * G.pulse)})`);
      ctx.fillStyle = gl;
      ctx.fillRect(0, yBot - 18, W, 32);
      ctx.restore();
    }
    const streak = H.forceStreak ?? (H.judge && prefs.detect && rig.on ? H.judge.streak : 0);
    if (streak >= 8) {
      const hot = G.heat;
      const fs = Math.round(Math.min(40, HH * 0.04) * (1 + 0.08 * G.pulse));
      ctx.font = `900 ${fs}px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      const x = W - 40;
      const y = Math.min(yTop - 24, HH * 0.62);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.8)';
      ctx.strokeText(String(streak), x, y);
      const g = ctx.createLinearGradient(0, y - fs, 0, y);
      g.addColorStop(0, hot > 0.5 ? '#fff3b0' : '#ffffff');
      g.addColorStop(1, hot > 0.5 ? '#ff6a1f' : '#7fe8ff');
      ctx.fillStyle = g;
      ctx.shadowColor = hot > 0.5 ? '#ff7a1f' : '#4fe3ff';
      ctx.shadowBlur = 10 + 20 * hot;
      ctx.fillText(String(streak), x, y);
      ctx.shadowBlur = 0;
      ctx.font = `800 ${Math.round(fs * 0.36)}px ${FONT}`;
      ctx.fillStyle = hot > 0.5 ? '#ffb070' : 'rgba(170, 230, 255, 0.85)';
      ctx.fillText(hot >= 0.99 ? 'ON FIRE' : 'IN A ROW', x, y + fs * 0.45);
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
    // heat follows the streak: warms from 8 notes in a row, full fire at 40
    const streak = H.forceStreak ?? (H.judge && prefs.detect && rig.on ? H.judge.streak : 0); // forceStreak: tests
    const want = Math.max(0, Math.min(1, (streak - 8) / 32));
    H.heat = (H.heat || 0) + (want - (H.heat || 0)) * (want < (H.heat || 0) ? 0.08 : 0.03);
    G.heat = prefs.fx ? H.heat : 0;
    G.pulse = beatPulse(t || 0);
    venue.draw(ctx, prefs.venue || 'arena', W, HH, performance.now() / 1000, G.pulse * 0.5, G.heat * 0.5);
    ctx.fillStyle = 'rgba(4, 6, 10, 0.22)';
    ctx.fillRect(0, 0, W, HH);
  }

  const tab = () => H.tab;
  /** Cyan edges that warm to orange as you heat up. */
  function railColor(a) {
    const k = G.heat || 0;
    const r = Math.round(80 + (255 - 80) * k);
    const g = Math.round(232 + (150 - 232) * k);
    const b = Math.round(255 + (60 - 255) * k);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const fadeFar = (z) => Math.max(0, Math.min(1, (G.zF - z) / (G.zF * 0.45)));

  function drawFloor(t, a, f0, f1) {
    const zF = G.zF;
    // Every fret's line runs off to the vanishing point, faint and fading.
    ctx.lineWidth = 1;
    for (let f = 0; f <= 24; f++) {
      const x = XF(f);
      const g = ctx.createLinearGradient(0, PY(x, 0, -G.zs * PAST), 0, PY(x, 0, zF));
      g.addColorStop(0, 'rgba(90, 210, 235, 0.42)');
      g.addColorStop(0.6, 'rgba(90, 210, 235, 0.16)');
      g.addColorStop(1, 'rgba(90, 210, 235, 0)');
      ctx.strokeStyle = g;
      line3([x, 0, -G.zs * PAST], [x, 0, zF]);
      ctx.stroke();
    }
    // Hand positions: dark blue channels, one per fret, cyan edges, stepping across the floor.
    const A = tab().anchors || [];
    const segs = [];
    for (let i = Math.max(0, lower(A, t) - 1); i < A.length && A[i].t < t + G.L; i++) {
      const an = A[i];
      const za = Math.max(-G.zs * PAST, zOf(an.t));
      const next = A[i + 1];
      const zb = Math.min(zF, zOf(next ? next.t : an.end || an.t + 600));
      if (zb <= za) continue;
      segs.push({ an, za, zb });
    }
    for (let k = segs.length - 1; k >= 0; k--) {
      const { an, za, zb } = segs[k];
      const xa = anX0(an);
      const xb = anX1(an);
      const ya = PY(xa, 0, za);
      const yb = PY(xa, 0, zb);
      for (let f = an.fret; f < an.fret + (an.width || 4); f++) {
        const l = XF(f - 1);
        const r = XF(f);
        const w = r - l;
        // the channel
        poly([[l, 0, za], [r, 0, za], [r, 0, zb], [l, 0, zb]]);
        const g = ctx.createLinearGradient(0, ya, 0, yb);
        g.addColorStop(0, `rgba(18, 56, 86, ${0.92 * fadeFar(za)})`);
        g.addColorStop(1, `rgba(14, 44, 70, ${0.92 * fadeFar(zb)})`);
        ctx.fillStyle = g;
        ctx.fill();
        // a soft raised middle, like a rounded groove catching the light
        for (const [inset, al] of [[0.14, 0.22], [0.3, 0.28]]) {
          poly([[l + w * inset, 0, za], [r - w * inset, 0, za], [r - w * inset, 0, zb], [l + w * inset, 0, zb]]);
          const g2 = ctx.createLinearGradient(0, ya, 0, yb);
          g2.addColorStop(0, `rgba(70, 150, 210, ${al * fadeFar(za)})`);
          g2.addColorStop(1, `rgba(70, 150, 210, ${al * 0.5 * fadeFar(zb)})`);
          ctx.fillStyle = g2;
          ctx.fill();
        }
      }
      // fret lines inside, then the bright edges
      ctx.lineWidth = 1.3;
      for (let f = an.fret; f < an.fret - 1 + (an.width || 4); f++) {
        const g = ctx.createLinearGradient(0, ya, 0, yb);
        g.addColorStop(0, `rgba(120, 230, 255, ${0.7 * fadeFar(za)})`);
        g.addColorStop(1, `rgba(120, 230, 255, ${0.5 * fadeFar(zb)})`);
        ctx.strokeStyle = g;
        line3([XF(f), 0, za], [XF(f), 0, zb]);
        ctx.stroke();
      }
      ctx.shadowColor = G.heat > 0.3 ? '#ff8a3a' : '#38dcff';
      ctx.shadowBlur = 16;
      ctx.lineWidth = 4;
      for (const x of [xa, xb]) {
        const g = ctx.createLinearGradient(0, ya, 0, yb);
        g.addColorStop(0, railColor(fadeFar(za)));
        g.addColorStop(1, railColor(0.8 * fadeFar(zb)));
        ctx.strokeStyle = g;
        line3([x, 0, za], [x, 0, zb]);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // A new hand position: a light bar across its front edge, and a row of fret numbers on the floor.
      if (za > G.zs * 0.35 && za < zF * 0.9) {
        const fa = fadeFar(za);
        ctx.lineWidth = 2;
        ctx.strokeStyle = railColor(0.75 * fa);
        line3([xa, 0, za], [xb, 0, za]);
        ctx.stroke();
        const sc = scaleAt((xa + xb) / 2, 0, za);
        const fs = Math.round(Math.max(9, Math.min(26, 0.42 * laneW(an.fret) * sc)));
        ctx.font = `800 ${fs}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // the hand position's frets on a soft bar, plus the inlay frets either side
        const bx0 = PX(xa, 0, za);
        const bx1 = PX(xb, 0, za);
        const by = PY(xa, 0, za) + fs * 0.75;
        ctx.fillStyle = `rgba(150, 230, 255, ${0.16 * fa})`;
        rr(ctx, bx0, by - fs * 0.62, bx1 - bx0, fs * 1.24, fs * 0.3);
        ctx.fill();
        const inA = (f) => f >= an.fret && f < an.fret + (an.width || 4);
        for (let f = Math.max(1, f0); f <= Math.min(24, f1); f++) {
          if (!inA(f) && !INLAYS.includes(f)) continue;
          const x = laneC(f);
          ctx.fillStyle = inA(f) ? `rgba(255, 255, 255, ${0.95 * fa})` : `rgba(90, 210, 220, ${0.7 * fa})`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = `rgba(4, 10, 20, ${0.6 * fa})`;
          ctx.strokeText(String(f), PX(x, 0, za), by);
          ctx.fillText(String(f), PX(x, 0, za), by);
        }
      }
    }
    // Beat lines across the hand position: bars brighter
    const beats = tab().beats || [];
    for (let i = lower(beats, t); i < beats.length && beats[i].t < t + G.L; i++) {
      const z = zOf(beats[i].t);
      if (z < 0.05) continue;
      const bar = beats[i].m >= 0;
      const an = anchorAt(beats[i].t);
      const fade = fadeFar(z);
      ctx.strokeStyle = bar ? `rgba(160, 235, 255, ${0.42 * fade})` : `rgba(160, 235, 255, ${0.13 * fade})`;
      ctx.lineWidth = bar ? 1.6 : 1;
      line3([anX0(an), 0.005, z], [anX1(an), 0.005, z]);
      ctx.stroke();
    }
  }

  /** The neck: a see-through board leaning back at z = 0.., with fret wires, inlay panels and coloured strings. */
  const NP = (x, L) => [x, nY(L), nZ(L)];
  function drawNeck(t, a, f0, f1) {
    const n = G.n;
    const Lb = -0.7;
    const Lt = n - 1 + 0.45;
    G.neckLb = Lb;
    G.neckLt = Lt;
    const xn = XF(0) - 0.5;
    const xe = XF(24) + 0.8;
    // a dark, mostly see-through board so the strings read against any venue
    poly([NP(xn, Lb), NP(xe, Lb), NP(xe, Lt), NP(xn, Lt)]);
    const g = ctx.createLinearGradient(0, PY(...NP(G.camX, Lt)), 0, PY(...NP(G.camX, Lb)));
    g.addColorStop(0, 'rgba(10, 10, 16, 0.4)');
    g.addColorStop(1, 'rgba(6, 6, 10, 0.62)');
    ctx.fillStyle = g;
    ctx.fill();
    // your hand position, faintly lit on the neck
    poly([NP(anX0(a), Lb), NP(anX1(a), Lb), NP(anX1(a), Lt), NP(anX0(a), Lt)]);
    ctx.fillStyle = 'rgba(70, 200, 255, 0.07)';
    ctx.fill();
    // inlay panels: gold in your hand position, teal elsewhere
    for (const f of INLAYS) {
      if (f < f0 || f > f1) continue;
      const inA = f >= a.fret && f < a.fret + (a.width || 4);
      const w = laneW(f);
      const c = laneC(f);
      poly([NP(c - w * 0.42, 0.2), NP(c + w * 0.42, 0.9), NP(c + w * 0.42, n - 1.2), NP(c - w * 0.42, n - 1.9)]);
      const ig = ctx.createLinearGradient(0, PY(...NP(c, n - 1)), 0, PY(...NP(c, 0)));
      ig.addColorStop(0, inA ? 'rgba(255, 196, 70, 0.16)' : 'rgba(80, 200, 210, 0.07)');
      ig.addColorStop(1, inA ? 'rgba(255, 196, 70, 0.34)' : 'rgba(80, 200, 210, 0.16)');
      ctx.fillStyle = ig;
      ctx.fill();
    }
    // strings: thin and coloured, a touch thicker toward the low E
    for (let s = 0; s < n; s++) {
      const y = strH(s);
      const z = strZ(s);
      const th = (n === 4 ? 4.4 : 3.8) - s * (n === 4 ? 0.45 : 0.35);
      ctx.strokeStyle = rgba(STRING[s], 0.95);
      ctx.shadowColor = STRING[s];
      ctx.shadowBlur = 9;
      ctx.lineWidth = Math.max(1, th * Math.min(1.3, (G.F / 1080) * (1.2 - 0.4 * G.zoomK)));
      line3([xn, y, z], [xe, y, z]);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // fret wires: dark rods across the strings, curling back at the top
    for (let f = f0; f <= Math.min(24, f1 + 1); f++) {
      const x = XF(f);
      const sc = scaleAt(x, G.yMid, G.zMid);
      const wd = Math.max(2, Math.min(9, (f === 0 ? 0.13 : 0.075) * sc));
      ctx.lineCap = 'round';
      ctx.beginPath();
      // a rod standing from the front edge up past the top string, bending back at its tip
      const b0 = [x, nY(Lb), 0];
      const b1 = [x, nY(Lt) + 0.12, 0];
      ctx.moveTo(PX(...b0), PY(...b0));
      ctx.lineTo(PX(...b1), PY(...b1));
      ctx.strokeStyle = f === 0 ? '#cfc6ae' : 'rgba(30, 30, 36, 0.95)';
      ctx.lineWidth = wd + 1.5;
      ctx.stroke();
      ctx.strokeStyle = f === 0 ? '#fff6e0' : 'rgba(150, 140, 125, 0.7)';
      ctx.lineWidth = Math.max(1, wd * 0.3);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  /** In front of the neck: fret numbers, the next chord's name, finger numbers as a chord lands. */
  function drawNeckFront(t, a, f0, f1) {
    const Lb = G.neckLb;
    const T = H.targets;
    // Fret numbers under the neck: gold in your hand position, teal on the inlay frets.
    const inA = (f) => f >= a.fret && f < a.fret + (a.width || 4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let f = Math.max(1, f0); f <= f1; f++) {
      if (!inA(f) && !INLAYS.includes(f)) continue;
      const x = PX(...NP(laneC(f), Lb));
      if (x < 14 || x > W - 14) continue;
      const sc = scaleAt(...NP(laneC(f), Lb));
      const big = inA(f);
      const fs = Math.round(Math.max(14, Math.min(big ? 48 : 30, sc * (big ? 0.42 : 0.28) * laneW(f))));
      const y = PY(...NP(laneC(f), Lb)) + 8;
      ctx.font = `${big ? 900 : 700} ${fs}px ${FONT}`;
      if (big) {
        const g = ctx.createLinearGradient(0, y, 0, y + fs);
        g.addColorStop(0, '#ffe08a');
        g.addColorStop(1, '#f0a020');
        ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(255, 170, 30, 0.55)';
        ctx.shadowBlur = 12;
      } else ctx.fillStyle = 'rgba(90, 200, 205, 0.6)';
      ctx.fillText(String(f), x, y);
      ctx.shadowBlur = 0;
    }
    // Resolve one fingering per string; repeated attacks must not stack discs.
    const fingers = new Map();
    const HS = H.tab.handShapes || [];
    const hi = lower(HS, t + 0.0001, 'start') - 1;
    const hs = hi >= 0 && t < HS[hi].end ? HS[hi] : null;
    const shape = hs && H.tab.chords[hs.chord];
    if (shape?.frets) shape.frets.forEach((f, s) => {
      const finger = shape.fingers?.[s];
      if (f > 0 && finger > 0) fingers.set(s, { f, finger, alpha: 0.55 });
    });
    let nextChord = null;
    for (let i = lower(T, t - 0.08); i < T.length && T[i].t < t + 0.45; i++) {
      if (T[i].kind === 'chord') { nextChord = T[i]; break; }
    }
    if (nextChord) {
      const shape = H.tab.chords[nextChord.chord];
      fingers.clear();
      for (const nt of nextChord.notes) {
        const finger = shape?.fingers?.[nt.s];
        if (nt.f > 0 && finger > 0) fingers.set(nt.s, { f: nt.f, finger, alpha: 0.9 });
      }
    }
    for (const [s, finger] of fingers) {
      const x = laneC(finger.f), y = strH(s), z = strZ(s);
      const fs = Math.max(14, Math.min(34, G.gap * scaleAt(x, y, z) * 0.75));
      ctx.globalAlpha = finger.alpha;
      ctx.font = `800 ${Math.round(fs)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(245,250,255,0.9)';
      ctx.strokeText(String(finger.finger), PX(x,y,z), PY(x,y,z));
      ctx.fillStyle = '#252a30';
      ctx.fillText(String(finger.finger), PX(x,y,z), PY(x,y,z));
    }
    ctx.globalAlpha = 1;
    // The next chord's name, big and bold on the left (as in Rocksmith).
    for (let i = lower(T, t - 0.05); i < T.length && T[i].t < t + 1.6; i++) {
      const tg = T[i];
      if (tg.kind !== 'chord' || !tg.name) continue;
      const k = Math.min(1, (1.6 - (tg.t - t)) / 0.4);
      ctx.globalAlpha = Math.max(0, k);
      const fs = Math.round(Math.min(88, HH * 0.08));
      ctx.font = `900 ${fs}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const x = W * 0.15;
      const y = HH * 0.5;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.7)';
      ctx.strokeText(tg.name, x, y);
      const g = ctx.createLinearGradient(0, y - fs, 0, y);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#c9d2e6');
      ctx.fillStyle = g;
      ctx.shadowColor = 'rgba(120, 220, 255, 0.35)';
      ctx.shadowBlur = 18;
      ctx.fillText(tg.name, x, y);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      break;
    }
  }

  // ------------------------------------------------------------- notes --
  /** Bend (in steps) of a note at song time `time`, from its real bend curve. */
  function bendAt(nt, time) {
    const pts = nt.bends;
    if (pts && pts.length) {
      // points are song times; some charts store them relative to the note
      const rel = pts[0].t < nt.t - 0.01;
      let pt = nt.t;
      let ps = 0;
      for (const p of pts) {
        const pt2 = rel ? nt.t + p.t : p.t;
        if (time <= pt2) {
          if (pt2 <= pt) return p.step;
          return ps + ((p.step - ps) * (time - pt)) / (pt2 - pt);
        }
        pt = pt2;
        ps = p.step;
      }
      return ps;
    }
    if (nt.bend) {
      const ramp = Math.max(0.08, (nt.sus || 0.3) * 0.3);
      return nt.bend * Math.min(1, Math.max(0, (time - nt.t) / ramp));
    }
    return 0;
  }
  // bends are charted in half steps: 1 = ½, 2 = full, 3 = 1½, 4 = 2
  const bendLabel = (b) => ({ 0.5: '¼', 1: '½', 1.5: '¾', 2: 'full', 3: '1½', 4: '2' })[b] || `${b / 2}`;
  const maxBend = (nt) => (nt.bends && nt.bends.length ? Math.max(...nt.bends.map((p) => p.step)) : nt.bend || 0);

  const judged = (tg) => (H.judge && prefs.detect && rig.on ? H.judge.state.get(tg.id) : null);

  // A point on the leaning string plane: x along the neck, L strings up from
  // the bottom one, dz how far ahead in time (0 = at the neck).
  const P3 = (x, L, dz) => [x, nY(L), dz + nZ(L)];
  function quad(x0, x1, L0, L1, dz, lift = 0) {
    const a = P3(x0, L0, dz);
    const b = P3(x1, L0, dz);
    const c = P3(x1, L1, dz);
    const d = P3(x0, L1, dz);
    for (const p of [a, b, c, d]) p[1] += lift;
    poly([a, b, c, d]);
  }
  const PAST = 0.12; // seconds a note keeps travelling past the neck toward you

  function drawNotes(t, a) {
    const T = H.targets;
    const zF = G.zF;
    const i0 = lower(T, t - PAST);
    const sustain0 = firstSustain(H.sustainEnds || [], t);
    const i1 = lower(T, t + G.L);
    const fadeOf = (z) => Math.pow(Math.max(0, 1 - Math.max(0, z) / zF), 1.5);
    // Sustain ribbons first, under the gems: each follows the note in time,
    // bending across the strings, moving with slides, shaking with vibrato.
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
        if (end > t0) drawTrail(nt, tg, t0, end, an, st, fadeOf(zOf(t0)));
      }
    }
    // Gems and chords, far to near. Nothing stops at the neck: everything
    // carries on toward you and fades, a missed note grey.
    for (let i = i1 - 1; i >= i0; i--) {
      const tg = T[i];
      const z = zOf(tg.t);
      if (z > zF) continue;
      const st = judged(tg);
      const missed = st && st.result === 'miss';
      const hit = st && st.result === 'hit';
      let al = fadeOf(z);
      if (z < 0) {
        const past = (t - tg.t) / (hit ? PAST * 0.6 : PAST);
        if (past >= 1) continue;
        al *= 1 - past;
      }
      if (missed) al *= 0.6;
      if (al <= 0.01) continue;
      ctx.globalAlpha = al;
      const an = anchorAt(tg.t);
      if (tg.kind === 'chord' || (tg.kind === 'mute' && tg.notes.length > 1)) drawChord(tg, z, an, missed);
      else for (const nt of tg.notes) drawGem(nt, z, an, missed, tg.kind === 'mute');
      ctx.globalAlpha = 1;
    }
  }

  /** A note's sustain from t0 to t1 (song times): a flat ribbon along its string. */
  function drawTrail(nt, tg, t0, t1, an, st, fade) {
    const open = nt.f === 0;
    const missed = st && st.result === 'miss';
    const holding = st && st.result === 'hit' && G.t >= tg.t;
    const col = missed ? '#5a6078' : STRING[nt.s];
    const x0 = noteX(nt, an);
    const slideTo = nt.slideTo !== undefined ? nt.slideTo : nt.slideUnpitchTo;
    const x1 = slideTo !== undefined ? laneC(Math.max(1, slideTo)) : x0;
    const half = open ? 0.5 * (anX1(an) - anX0(an)) - 0.15 : laneW(Math.max(1, nt.f)) * 0.14;
    const L0 = level(nt.s);
    const lw = laneW(Math.max(1, nt.f || an.fret));
    const steps = Math.max(8, Math.min(240, Math.round((t1 - t0) * (nt.tremolo ? 96 : 50))));
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const time = t0 + ((t1 - t0) * k) / steps;
      const duration = noteEnd(nt, tg) - tg.t;
      const u = duration > 0 ? (time - tg.t) / duration : 0;
      // slides ease in and out, like the real glide of the hand
      const e = Math.min(1, Math.max(0, u));
      let x = x0 + (x1 - x0) * (e * e * (3 - 2 * e));
      // a bend pushes the ribbon across the strings: a full step a string and a half, and
      // vibrato is quick little bends (smooth, one side), tremolo a sharp
      // zigzag across (4.0.6: they must never look alike), in real time so they read true at any speed
      const age = Math.max(0, time - tg.t);
      if (nt.tremolo) { const ph = (age * 6) % 1; x += (ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4) * lw * 0.24; }
      const b = bendAt(nt, time);
      // vibrato: quick little bends (drawn a half step), leaning a little sideways with each
      const vb = vibratoAt(nt, time, b);
      if (vb) x += Math.abs(vb) * 2 * lw * 0.2;
      const L = L0 + ((b + 2 * vb) / 2) * 1.5;
      pts.push([x, L, zOf(time)]);
    }
    const edge = (side) => pts.map(([x, L, dz]) => {
      const p = P3(x + side * half, L, dz);
      return [PX(...p), PY(...p)];
    });
    const Lft = edge(-1);
    const Rgt = edge(1);
    ctx.beginPath();
    Lft.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let k = Rgt.length - 1; k >= 0; k--) ctx.lineTo(Rgt[k][0], Rgt[k][1]);
    ctx.closePath();
    ctx.globalAlpha = (holding ? 0.6 : 0.36) * fade;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 0.95 * fade;
    ctx.strokeStyle = missed ? '#7a7f96' : lighten(col);
    const p0 = P3(x0, L0, Math.max(0, pts[0][2]));
    ctx.lineWidth = Math.max(1.2, Math.min(3, 0.05 * scaleAt(...p0)));
    ctx.shadowColor = col;
    ctx.shadowBlur = missed ? 0 : holding ? 18 : 8;
    if (nt.slideUnpitchTo !== undefined && nt.slideTo === undefined) ctx.setLineDash([6, 5]);
    for (const side of [Lft, Rgt]) {
      ctx.beginPath();
      side.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // the bend's size at its peak
    const mb = maxBend(nt);
    if (mb > 0) {
      let best = 0;
      pts.forEach((p, k) => Math.abs(p[1] - L0) > Math.abs(pts[best][1] - L0) && (best = k));
      const [x, L, dz] = pts[best];
      if (dz >= 0) {
        const p = P3(x, L, dz);
        const fs = Math.round(Math.max(12, Math.min(26, scaleAt(...p) * 0.32)));
        ctx.font = `900 ${fs}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(5, 8, 15, 0.9)';
        const lbl = `↑${bendLabel(mb)}`;
        ctx.strokeText(lbl, PX(...p), PY(...p) - 6);
        ctx.fillStyle = '#fff3d6';
        ctx.fillText(lbl, PX(...p), PY(...p) - 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A note: an upright glassy block in its string's colour at its string's
   * height in its fret's lane, facing you; a thin stem down to the floor with
   * its fret number there.
   */
  function drawGem(nt, z, an, missed, mute, inChord = false, box = null, flare = 0) {
    const s = nt.s;
    const L = level(s);
    const open = nt.f === 0;
    const col = missed ? '#5a6078' : STRING[s];
    const a0 = ctx.globalAlpha;
    const near = Math.max(0, 1 - Math.abs(z) / (G.zs * 0.6)); // brightens over the last moments
    const DEPTH = 0.12; // how thick the block is, front to back
    const big = 1 + flare * 0.3;
    const y = nY(L);
    if (open) {
      // an open string: a bar across the hand position (or the chord's frame)
      const xa = (box ? box[0] : anX0(an)) + 0.12;
      const xb = (box ? box[1] : anX1(an)) - 0.12;
      const hh = G.gy * 0.16 * big;
      poly([[xa, y + hh, z], [xb, y + hh, z], [xb, y + hh, z + DEPTH], [xa, y + hh, z + DEPTH]]);
      ctx.fillStyle = missed ? '#8a8fa6' : lighten(col);
      ctx.fill();
      poly([[xa, y - hh, z], [xb, y - hh, z], [xb, y + hh, z], [xa, y + hh, z]]);
      ctx.fillStyle = missed ? 'rgba(120, 125, 145, 0.9)' : rgba(STRING[s], 0.92);
      ctx.shadowColor = col;
      ctx.shadowBlur = missed ? 0 : 6 + 12 * near + 18 * flare;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = a0;
      return;
    }
    const x = laneC(nt.f);
    const lw = laneW(nt.f);
    const hw = lw * (inChord ? 0.34 : 0.4) * big;
    const hh = G.gy * (inChord ? 0.20 : 0.22) * big;
    if (!inChord && z > G.zs * 0.12 && z < G.zs * 1.8) {
      // a thin stem down to the floor, with the fret number on the floor just in front
      ctx.globalAlpha = a0 * 0.85;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, Math.min(2.5, 0.025 * scaleAt(x, y, z)));
      line3([x, y - hh, z], [x, 0, z]);
      ctx.stroke();
      ctx.globalAlpha = a0;
      const f = [x, 0, z - 0.25];
      const sc = scaleAt(...f);
      const fs = Math.round(Math.max(12, Math.min(36, 0.42 * lw * sc)));
      const fx = PX(...f);
      const fy = PY(...f) + fs * 0.55;
      ctx.font = `900 ${fs}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2.5, fs * 0.16);
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.85)';
      const label = mute || nt.mute ? '×' : String(nt.f);
      ctx.strokeText(label, fx, fy);
      const ng = ctx.createLinearGradient(0, fy - fs / 2, 0, fy + fs / 2);
      ng.addColorStop(0, missed ? '#a0a4b4' : '#ffe9a8');
      ng.addColorStop(1, missed ? '#6a6f82' : '#f3a51f');
      ctx.fillStyle = ng;
      ctx.fillText(label, fx, fy);
    }
    // the top face, for depth
    poly([[x - hw, y + hh, z], [x + hw, y + hh, z], [x + hw, y + hh, z + DEPTH], [x - hw, y + hh, z + DEPTH]]);
    ctx.fillStyle = missed ? 'rgba(140, 145, 165, 0.8)' : rgba(STRING[s], 0.85);
    ctx.fill();
    // the front: dark glass, a bright rim, a light bar across the middle
    const fx0 = PX(x - hw, y, z);
    const fx1 = PX(x + hw, y, z);
    const fy0 = PY(x, y + hh, z);
    const fy1 = PY(x, y - hh, z);
    const w = fx1 - fx0;
    const ht = Math.max(5, fy1 - fy0);
    const r = Math.min(ht * 0.08, 2);
    rr(ctx, fx0, fy0, w, ht, r);
    ctx.fillStyle = missed ? 'rgba(60, 64, 80, 0.88)' : rgba(STRING_DARK[s], 0.72 + 0.25 * near);
    ctx.shadowColor = col;
    ctx.shadowBlur = missed ? 0 : Math.min(28, 6 + 14 * near + 22 * flare);
    ctx.fill();
    ctx.shadowBlur = 0;
    const rim = Math.max(1.5, Math.min(5, 0.07 * lw * scaleAt(x, y, z)));
    ctx.lineWidth = rim;
    ctx.strokeStyle = missed ? '#8a8fa6' : flare > 0.05 ? '#ffffff' : lighten(col);
    ctx.stroke();
    if (ht > 7) {
      const bh = Math.max(1.5, ht * 0.2);
      rr(ctx, fx0 + w * 0.2, fy0 + ht * 0.5 - bh / 2, w * 0.6, bh, bh / 2);
      ctx.fillStyle = missed ? 'rgba(170, 175, 190, 0.6)' : rgba(STRING[s], 0.98);
      ctx.fill();
    }
    if (nt.accent && !missed) {
      const pad = Math.max(2, rim * 1.2);
      rr(ctx, fx0 - pad, fy0 - pad, w + pad * 2, ht + pad * 2, r + pad);
      ctx.lineWidth = Math.max(1.2, rim * 0.7);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (mute || nt.mute) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, rim * 0.8);
      ctx.beginPath();
      ctx.moveTo(fx0 + w * 0.32, fy0 + ht * 0.2);
      ctx.lineTo(fx1 - w * 0.32, fy1 - ht * 0.2);
      ctx.moveTo(fx1 - w * 0.32, fy0 + ht * 0.2);
      ctx.lineTo(fx0 + w * 0.32, fy1 - ht * 0.2);
      ctx.stroke();
    }
    // technique tags above the note (bends and slides show on their ribbon)
    const marks = [];
    if (nt.hammerOn) marks.push('H');
    if (nt.pullOff) marks.push('P');
    if (nt.tap) marks.push('T');
    if (nt.palmMute) marks.push('PM');
    if (nt.harmonic) marks.push('◆');
    if (nt.pinchHarmonic) marks.push('PH');
    if (nt.slap) marks.push('S');
    if (nt.pop) marks.push('Pop');
    if (maxBend(nt) && !(nt.sus > 0.06)) marks.push(`↑${bendLabel(maxBend(nt))}`);
    if (nt.slideTo !== undefined && !(nt.sus > 0.06)) marks.push(nt.slideTo > nt.f ? '↗' : '↘');
    if (marks.length && w > 30 && !inChord && z > 0) {
      const mfs = Math.round(Math.max(10, Math.min(18, w * 0.22)));
      ctx.font = `800 ${mfs}px ${FONT}`;
      const txt = marks.join(' ');
      const tw = ctx.measureText(txt).width + mfs * 0.9;
      const cxp = (fx0 + fx1) / 2;
      const ty = fy0 - mfs * 0.95;
      rr(ctx, cxp - tw / 2, ty - mfs * 0.62, tw, mfs * 1.24, mfs * 0.62);
      ctx.fillStyle = 'rgba(8, 12, 22, 0.85)';
      ctx.fill();
      ctx.fillStyle = '#ffe2b0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, cxp, ty + 1);
    }
  }

  /** Where a chord's frame sits across the neck. */
  function chordBox(tg, an) {
    const [left, right] = chordSpan(tg.notes, an);
    return [XF(left), XF(right)];
  }

  /**
   * A chord: an upright glowing frame standing on the highway across the hand
   * position, from the floor to just above the top string; the first one of a
   * run holds its notes, repeats are just the frame, so the strumming reads
   * as steps.
   */
  function drawChord(tg, z, an, missed) {
    const [xa, xb] = chordBox(tg, an);
    const yB = 0;
    const yT = (nY(G.n - 1) + G.gy * 0.6) * (tg.repeat ? 0.5 : 1);
    const DZ = 0.14;
    const accent = tg.notes.some((x) => x.accent);
    const sc = scaleAt((xa + xb) / 2, yT, Math.max(0.1, z));
    const edge = missed ? 'rgba(110, 116, 140, 0.9)' : railColor(0.95);
    // the back edge and its corners, dimmer, for a little thickness
    ctx.lineWidth = Math.max(1, Math.min(2.4, 0.025 * sc));
    ctx.strokeStyle = missed ? 'rgba(110, 116, 140, 0.4)' : railColor(0.4);
    poly([[xa, yB, z + DZ], [xb, yB, z + DZ], [xb, yT, z + DZ], [xa, yT, z + DZ]]);
    ctx.stroke();
    // the glass, brighter at the top
    poly([[xa, yB, z], [xb, yB, z], [xb, yT, z], [xa, yT, z]]);
    const pyt = PY(xa, yT, z);
    const pyb = PY(xa, yB, z);
    const g = ctx.createLinearGradient(0, pyt, 0, pyb);
    g.addColorStop(0, missed ? 'rgba(90, 96, 120, 0.16)' : tg.repeat ? 'rgba(80, 210, 250, 0.025)' : 'rgba(80, 210, 250, 0.07)');
    g.addColorStop(1, missed ? 'rgba(90, 96, 120, 0.03)' : 'rgba(40, 150, 220, 0.03)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(2, Math.min(6, 0.06 * sc));
    ctx.strokeStyle = edge;
    ctx.shadowColor = G.heat > 0.3 ? '#ff8a3a' : '#38dcff';
    ctx.shadowBlur = missed ? 0 : 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (accent && !missed) {
      const pad = Math.max(3, 0.05 * sc);
      const ax = PX(xa, yT, z) - pad;
      const bx = PX(xb, yT, z) + pad;
      rr(ctx, ax, pyt - pad, bx - ax, pyb - pyt + pad * 2, pad);
      ctx.lineWidth = Math.max(1.2, Math.min(3, 0.03 * sc));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (tg.kind === 'mute') {
      ctx.font = `900 ${Math.round(Math.max(12, Math.min(40, sc * 0.5)))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('×', (PX(xa, yB, z) + PX(xb, yB, z)) / 2, (pyt + pyb) / 2);
    }
    if (z > 0) {
      const frets = [...new Set(tg.notes.filter(n => n.f > 0).map(n => n.f))];
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const f of frets) {
        const x = laneC(f), sc = scaleAt(x, 0, z);
        if (sc * laneW(f) < 20) continue;
        const fs = Math.max(8, Math.min(28, sc * 0.32));
        ctx.font = `800 ${fs}px ${FONT}`;
        ctx.fillStyle = '#f4cf75';
        ctx.fillText(String(f), PX(x, 0, z), PY(x, 0, z) + 3);
      }
    }
    if (tg.repeat) return; // the same chord again: just its frame, so the rhythm reads at a glance
    for (const nt of tg.notes) drawGem(nt, z, an, missed, tg.kind === 'mute', true, [xa, xb]);
    // its name in a small tag above the frame's left corner
    if (tg.name && sc > 30 && z > 0 && prefs.chordLabels) {
      const fs = Math.round(Math.max(11, Math.min(22, sc * 0.2)));
      ctx.font = `800 ${fs}px ${FONT}`;
      const tw = ctx.measureText(tg.name).width + fs * 0.9;
      const pxa = PX(xa, yT, z);
      const ty = pyt - fs * 0.9;
      rr(ctx, pxa, ty - fs * 0.62, tw, fs * 1.24, fs * 0.62);
      ctx.fillStyle = 'rgba(8, 14, 26, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(110, 236, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tg.name, pxa + tw / 2, ty + 1);
    }
  }

  // --------------------------------------------------------- hit feel --
  // What makes playing feel good: the moment a note lands and you hit it,
  // its string blazes along its whole length, light posts stand at its fret,
  // the note flares on the neck and sparks fly. A held note keeps its string
  // lit. Miss it and nothing lights: the note sinks past the neck, grey.
  const sparks = [];
  function onJudged(e) {
    const tg = H.targets[e.id];
    if (!tg) return;
    const now = performance.now();
    const st = H.judge && H.judge.state.get(e.id);
    if (!e.hit) {
      H.misses = (H.misses || []).filter((m) => now - m.at < 600);
      H.misses.push({ id: e.id, at: now });
      return;
    }
    const chord = tg.kind === 'chord' || (tg.kind === 'mute' && tg.notes.length > 1);
    H.hits.push({ id: e.id, at: now, chord, until: tg.t + (tg.sus || 0), offset: st ? st.offset : null });
    for (const nt of tg.notes) H.bursts.push({ s: nt.s, f: nt.f, at: now, until: tg.t + (tg.sus || 0) });
    // sparks from each note's spot on the neck
    if (!G.F) return;
    const an = anchorAt(tg.t);
    for (const nt of tg.notes) {
      const x = noteX(nt, an);
      const y = strH(nt.s);
        const zq = strZ(nt.s);
      const px = PX(x, y, zq);
      const py = PY(x, y, zq);
      const n = chord ? 6 : 12;
      for (let k = 0; k < n; k++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const sp = 160 + Math.random() * 380;
        sparks.push({ x: px, y: py, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: 0.35 + Math.random() * 0.35, col: Math.random() < 0.35 ? '#ffffff' : STRING[nt.s] });
      }
    }
    if (sparks.length > 400) sparks.splice(0, sparks.length - 400);
  }

  function drawHits(t, a, dt) {
    const now = performance.now();
    H.hits = H.hits.filter((h) => now - h.at < 700 || t < h.until);
    H.bursts = H.bursts.filter((b) => now - b.at < 700 || t < b.until);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 1. the string blazes: a wide glow along its whole length, hottest at the note
    const byString = new Map();
    for (const b of H.bursts) {
      const k = Math.max(Math.exp(-(now - b.at) / 260), t < b.until ? 0.55 : 0);
      if (k < 0.02) continue;
      const cur = byString.get(b.s);
      if (!cur || cur.k < k) byString.set(b.s, { k, b });
    }
    const xn = XF(0) - 0.5;
    const xe = XF(24) + 0.8;
    for (const [s, { k, b }] of byString) {
      const y = strH(s);
      const zq = strZ(s);
      const sc = scaleAt(G.camX, y, zq);
      ctx.strokeStyle = rgba(STRING[s], 0.28 * k);
      ctx.lineWidth = G.gap * sc * 0.9 * (0.6 + 0.4 * k);
      ctx.lineCap = 'round';
      line3([xn, y, zq], [xe, y, zq]);
      ctx.stroke();
      ctx.strokeStyle = rgba(STRING[s], 0.7 * k);
      ctx.lineWidth = G.gap * sc * 0.28;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.75 * k})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineCap = 'butt';
      // the hot spot at the note
      const x = b.f === 0 ? noteX(b, a) : laneC(b.f);
      const px = PX(x, y, zq);
      const py = PY(x, y, zq);
      const rad = laneW(Math.max(1, b.f || a.fret)) * scaleAt(x, y, zq) * (0.9 + 0.5 * k);
      const gg = ctx.createRadialGradient(px, py, 0, px, py, rad);
      gg.addColorStop(0, `rgba(255, 255, 255, ${0.8 * k})`);
      gg.addColorStop(0.25, rgba(STRING[s], 0.6 * k));
      gg.addColorStop(1, rgba(STRING[s], 0));
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.ellipse(px, py, rad, rad * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 2. light posts at the fret wires around what you hit (the chord's box for a chord)
    const posts = new Map();
    for (const h of H.hits) {
      const tg = H.targets[h.id];
      const k = Math.max(Math.exp(-(now - h.at) / 320), t < h.until ? 0.5 : 0);
      if (k < 0.03) continue;
      const an = anchorAt(tg.t);
      const xs = h.chord ? chordBox(tg, an) : tg.notes.flatMap((nt) => (nt.f === 0 ? [anX0(an), anX1(an)] : [XF(nt.f - 1), XF(nt.f)]));
      for (const x of xs) posts.set(x.toFixed(3), Math.max(posts.get(x.toFixed(3)) || 0, k));
    }
    for (const [xs, k] of posts) {
      const x = Number(xs);
      // upright, like the fret wires, from below the neck to well above it
      const zr = 0;
      const top = [x, nY(G.neckLt) + 0.9, zr];
      const p0x = PX(x, -0.15, zr);
      const p0y = PY(x, -0.15, zr);
      const p1x = PX(...top);
      const p1y = PY(...top);
      const sc = scaleAt(x, G.yMid, 0);
      const wd = Math.max(3, Math.min(9, 0.06 * sc));
      ctx.lineCap = 'round';
      ctx.shadowColor = '#ff5ca8';
      ctx.shadowBlur = 24;
      ctx.strokeStyle = `rgba(255, 90, 170, ${0.55 * k})`;
      ctx.lineWidth = wd * 2.2;
      ctx.beginPath();
      ctx.moveTo(p0x, p0y);
      ctx.lineTo(p1x, p1y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255, 240, 248, ${0.95 * k})`;
      ctx.lineWidth = wd * 0.7;
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    // 3. sparks
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
      ctx.strokeStyle = rgba(p.col, k);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
      ctx.stroke();
    }
    ctx.restore();
    // a MISS where you missed, as in the game
    // (small, over the note you missed, and only the latest so they never pile up)
    H.misses = (H.misses || []).filter((m) => now - m.at < 700).slice(-1);
    for (const m of H.misses) {
      const tg = H.targets[m.id];
      if (!tg) continue;
      const an = anchorAt(tg.t);
      const age = (now - m.at) / 700;
      const nt = tg.notes[0];
      const p = [noteX(nt, an), nY(G.n - 1) + G.gy * 1.2 + age * 0.15, 0];
      const fs = Math.round(Math.min(26, HH * 0.022));
      ctx.globalAlpha = Math.min(1, (1 - age) * 2.2);
      ctx.font = `900 ${fs}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.7)';
      ctx.strokeText('MISS', PX(...p), PY(...p));
      ctx.fillStyle = 'rgba(170, 205, 215, 0.95)';
      ctx.fillText('MISS', PX(...p), PY(...p));
      ctx.globalAlpha = 1;
    }
    // 4. the note flares on the neck: a bright pop, held while you sustain
    for (const h of H.hits) {
      const tg = H.targets[h.id];
      const age = (now - h.at) / 1000;
      const holding = t < h.until;
      const k = Math.max(Math.exp(-age / 0.22), holding ? 0.6 : 0);
      if (k < 0.04) continue;
      const an = anchorAt(tg.t);
      ctx.globalAlpha = Math.min(1, k * 1.2);
      if (h.chord) {
        const box = chordBox(tg, an);
        for (const nt of tg.notes) drawGem(nt, 0, an, false, false, true, box, Math.exp(-age / 0.15));
      } else for (const nt of tg.notes) drawGem(nt, 0, an, false, tg.kind === 'mute', true, null, Math.exp(-age / 0.15));
      ctx.globalAlpha = 1;
      // a little EARLY / LATE when you were off the beat
      if (h.offset !== null && h.offset !== undefined && Math.abs(h.offset) > 90 && age < 0.7) {
        const nt = tg.notes[0];
        const x = noteX(nt, an);
        const top = tg.notes.reduce((m, q) => (strH(q.s) > strH(m.s) ? q : m), tg.notes[0]);
        const y = strH(top.s);
        const zq = strZ(top.s);
        const fs = Math.round(Math.min(22, HH * 0.02));
        ctx.globalAlpha = Math.min(1, (0.7 - age) * 3);
        ctx.font = `900 ${fs}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(5, 8, 15, 0.85)';
        const txt = h.offset < 0 ? 'EARLY' : 'LATE';
        const py = PY(x, y, zq) - 26 - age * 30;
        ctx.strokeText(txt, PX(x, y, zq), py);
        ctx.fillStyle = h.offset < 0 ? '#9fe6ff' : '#ffd38a';
        ctx.fillText(txt, PX(x, y, zq), py);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Without scoring: notes still land with a soft flash on their string, so the timing reads. */
  function drawLands(t, a) {
    const now = performance.now();
    H.lands = H.lands.filter((l) => now - l.at < 400 || t < l.until);
    if (!H.lands.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of H.lands) {
      const tg = H.targets[l.id];
      const k = Math.max(Math.exp(-(now - l.at) / 180), t < l.until ? 0.3 : 0) * 0.6;
      const an = anchorAt(tg.t);
      for (const nt of tg.notes) {
        const x = noteX(nt, an);
        const y = strH(nt.s);
        const zq = strZ(nt.s);
        const px = PX(x, y, zq);
        const py = PY(x, y, zq);
        const rad = laneW(Math.max(1, nt.f || an.fret)) * scaleAt(x, y, zq) * 0.8;
        const gg = ctx.createRadialGradient(px, py, 0, px, py, rad);
        gg.addColorStop(0, rgba(STRING[nt.s], 0.8 * k));
        gg.addColorStop(1, rgba(STRING[nt.s], 0));
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.ellipse(px, py, rad, rad * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    for (const l of H.lands) {
      const tg = H.targets[l.id];
      const age = (now - l.at) / 1000;
      const k = Math.max(Math.exp(-age / 0.15), t < l.until ? 0.45 : 0);
      if (k < 0.05) continue;
      const an = anchorAt(tg.t);
      ctx.globalAlpha = k * 0.8;
      const chord = tg.kind === 'chord' || (tg.kind === 'mute' && tg.notes.length > 1);
      for (const nt of tg.notes) drawGem(nt, 0, an, false, tg.kind === 'mute', true, chord ? chordBox(tg, an) : null, 0);
      ctx.globalAlpha = 1;
    }
  }

  function lighten(hex) {
    const v = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((v >> 16) & 255) + 70);
    const g = Math.min(255, ((v >> 8) & 255) + 70);
    const b = Math.min(255, (v & 255) + 70);
    return `rgb(${r},${g},${b})`;
  }

  // -------------------------------------------------------------- HUD --
  let lastSec = -2;
  function updateHud(t) {
    const tab = H.tab;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    time.textContent = `${fmt(Math.max(0, t))} / ${fmt(stage.engine.duration || 0)}`;
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
    if (H.judge && prefs.detect && rig.on) {
      const acc = H.judge.accuracy;
      score.innerHTML = `<b>${acc === null ? '–' : Math.round(acc * 100) + '%'}</b><span>accuracy</span><b>${H.judge.streak}</b><span>streak</span><b>${H.judge.hits}/${H.judge.judged}</b><span>notes</span>`;
    } else if (prefs.detect && !rig.on) {
      score.innerHTML = '<span>Turn on <b>Your guitar</b> to see how you’re playing</span>';
    } else score.innerHTML = '';
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
    toneBtn.innerHTML = `${icon('amp')}<span>${esc(toneName)}</span>${rig.capture ? '<span class="real-badge sm" title="A real amp is playing">REAL</span>' : ''}${icon('chevron')}`;
    toneBtn.hidden = !rig.on;
    rigBox.classList.toggle('real', !!rig.capture);
    renderMix();
    for (const b of speed.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.s) === stage.engine.speed));
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
        const b = h('button', { type: 'button', text: pretty(s.name), title: `${pretty(s.name)}: click to jump, double-click to loop` });
        b.style.flexGrow = String(Math.max(0.01, s.end - s.start));
        b.dataset.i = String(i);
        b.onclick = () => {
          stage.seek(Math.max(0, s.start - 1));
          if (H.judge) H.judge.rewind(s.start - 1);
        };
        b.ondblclick = () => stage.setLoop({ start: s.start, end: s.end });
        sections.append(b);
      });
      sections.append(h('i.hw-head'));
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
      if (e.key === 'Escape') {
        if (mixOpen) setMixOpen(false);
        else close();
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
        H.loadToken = (H.loadToken || 0) + 1; // closed: opening it later reads the new song
        H.song = null;
        H.tab = null;
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
