/**
 * Note highway: the part coming toward you down a 3D fretboard, Rocksmith
 * style. Low E on top. The camera glides between hand positions, the clock
 * is smoothed so nothing jumps, notes arrive early and slowly enough to read,
 * and every gem carries a big fret number.
 */
import { api } from './api.js';
import { h, icon, esc, showMenu, toast } from './ui.js';
import { rig, TONES } from './rig.js';
import { songToneChoice, saveToneChoice } from './tab.js';
import { tonelib, useTone } from './tonelib.js';
import { VENUES, createVenue, createFire } from './venues.js';
import { Analyzer, OnsetTracker, Judge, targetsFromTab, tuneShift } from './detect.js';

const STRING = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];
const STRING_DARK = ['#7a1d27', '#7a5e12', '#164e80', '#7a4515', '#1c6a3c', '#55307f'];
const NAMES6 = ['E', 'A', 'D', 'G', 'B', 'e'];
const NAMES4 = ['E', 'A', 'D', 'G'];
const FONT = "'Archivo', 'Segoe UI', sans-serif";
const SPEEDS = [0.5, 0.6, 0.75, 0.85, 1];

function load() {
  try {
    return { ahead: 4, lowTop: true, detect: true, venue: 'arena', fx: true, ...(JSON.parse(localStorage.getItem('stagehand.highway') || '{}') || {}) };
  } catch (_) {
    return { ahead: 4, lowTop: true, detect: true, venue: 'arena', fx: true };
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

export function createHighway(stage) {
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
    paused: true,
  };

  // ---------------------------------------------------------------- DOM --
  const root = h('div.highway', { hidden: true, role: 'dialog', 'aria-label': 'Note highway' });
  const canvas = h('canvas.hw-canvas');
  const top = h('div.hw-top');
  const back = h('button.hw-back', { type: 'button', title: 'Back (Esc)', html: `${icon('chevronLeft')}<span>Back</span>` });
  const titleBox = h('div.hw-title');
  const parts = h('div.hw-parts');
  const playAlong = h('button.hw-chip', { type: 'button' });
  // Stagehand 3: the whole song plays; take your part out in the Mix panel instead.
  playAlong.style.display = 'none';
  const guitarBtn = h('button.hw-chip', { type: 'button' });
  const toneBtn = h('button.hw-chip', { type: 'button', title: 'Tone for your guitar' });
  const mixBtn = h('button.hw-chip', { type: 'button', title: 'Song mix: stem volumes, on and off', html: `${icon('sliders')}<span>Mix</span>` });
  // The song mix docks on the right edge and collapses to a small tab.
  const mixPanel = h('div.hw-mix');
  const mixTab = h('button.hw-dock-tab', { type: 'button', title: 'Show or hide the song mix', 'aria-label': 'Song mix' });
  const dock = h('div.hw-dock', null, mixTab, mixPanel);
  let mixOpen = !!prefs.mixOpen;
  const optBtn = h('button.hw-icon', { type: 'button', title: 'Highway options', 'aria-label': 'Highway options', html: icon('sliders') });
  top.append(back, titleBox, h('span.grow'), parts, mixBtn, playAlong, guitarBtn, toneBtn, optBtn);
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
  const score = h('div.hw-score');
  bottom.append(playBtn, time, h('span.grow'), score, h('span.grow'), h('span.hw-label', { text: 'Speed' }), speed);
  const msg = h('div.hw-msg', { hidden: true });
  root.append(canvas, top, sections, bottom, msg, dock);
  document.body.append(root);
  root.__hw = H; // for tests
  const ctx = canvas.getContext('2d');

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
        { heading: true, label: 'How early notes appear' },
        ...[3, 4, 5, 6].map((s) => ({ label: s === 4 ? `${s} seconds (default)` : `${s} seconds`, hint: c(prefs.ahead === s), onClick: () => setPref('ahead', s) })),
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
    H.song = song;
    H.tab = null;
    showMsg('Reading the part…');
    try {
      H.parts = await api.tab.list(song.id);
      const want = partId || pickPart();
      if (!want) throw new Error('This song has no guitar or bass part.');
      H.tab = await api.tab.load(song.id, want);
      prefs.part = H.tab.type === 'combo' ? 'lead' : H.tab.type;
      save();
      H.targets = buildTargets(H.tab);
      showMsg(null);
      applyPlayAlong();
      resetJudge();
      H.toneKey = null;
      applyTone();
    } catch (err) {
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
        const sig = x.notes.map((n) => `${n.s}:${n.f}`).join(',');
        x.repeat = prev && prev.sig === sig && x.t - prev.t < 1.2;
        x.sig = sig;
        x.name = x.chord !== undefined && tab.chords[x.chord] ? tab.chords[x.chord].name : '';
        prev = x;
      } else if (x.notes.length === 1) prev = null;
    }
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
    if (H.judge) H.judge.reset(stage.engine.position);
    analyzer.an = new Analyzer(rig.sampleRate);
    analyzer.on = new OnsetTracker();
    H.bursts = [];
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
    for (const e of H.judge.events.splice(0)) {
      const tg = H.targets[e.id];
      if (e.hit) for (const n of tg.notes) H.bursts.push({ s: n.s, f: n.f, at: performance.now() });
    }
  }

  // ------------------------------------------------------------- render --
  let W = 0;
  let HH = 0;
  let dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
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
      // A steady clock: run on the frame timer and only lean gently toward
      // the player's position, so the highway never jumps or stutters.
      const eng = stage.engine;
      const raw = eng.position;
      if (!eng.playing) H.clock = raw;
      else {
        H.clock += dt * eng.speed;
        const err = raw - H.clock;
        if (Math.abs(err) > 0.25) H.clock = raw;
        else H.clock += err * Math.min(1, dt * 3);
      }
      if (H.judge && eng.playing && H.clock < H.lastClock - 0.3) H.judge.rewind(H.clock);
      H.lastClock = H.clock;
      listen(H.clock);
      if (H.judge) H.judge.tick(H.clock - (((rig.latencyMs || 20) / 1000 + 0.03) * eng.speed));
      followTone(H.clock);
      draw(H.clock, dt);
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
  // A real perspective scene, laid out like Rocksmith's:
  //   x runs along the neck (real fret spacing), y is height above the
  //   highway floor (each string has its own height, low E on top by
  //   default), z is time ahead (0 = the neck, where you play).
  // The neck is an upright board at z = 0 facing you; the highway floor runs
  // away from its foot. Hand positions are lit troughs that step across the
  // floor as they come; the camera sits behind and above the neck and glides
  // to frame the hand position, zooming in or out with its width.
  const NECK = 64; // world units from nut to bridge
  const NX = (f) => 1 - Math.pow(2, -Math.max(0, f) / 12);
  const FX = (x) => -12 * Math.log2(Math.max(1e-6, 1 - x));
  const XF = (f) => NECK * NX(f); // world x of fret wire f
  const laneC = (f) => (XF(f - 1) + XF(f)) / 2; // middle of fret f's lane
  const laneW = (f) => XF(f) - XF(f - 1);

  // Scene geometry, refreshed each frame.
  const G = {};

  function geometry(t) {
    const n = H.tab.strings;
    G.n = n;
    G.t = t;
    G.L = prefs.ahead;
    G.gap = n === 4 ? 1.0 : 0.75; // string spacing in height (a slim neck, like Rocksmith)
    G.lift = 0.7; // lowest string above the floor
    G.top = G.lift + (n - 1) * G.gap; // highest string
  }
  const level = (s) => (prefs.lowTop ? G.n - 1 - s : s);
  const strH = (s) => G.lift + level(s) * G.gap;
  const zOf = (time) => (time - G.t) * G.zs;
  const anX0 = (an) => XF(an.fret - 1);
  const anX1 = (an) => XF(an.fret - 1 + (an.width || 4));
  const noteX = (nt, a) => (nt.f === 0 ? (anX0(a) + anX1(a)) / 2 : laneC(nt.f));

  // ---- camera --
  /** Can frets lo..hi share one view without zooming out so far the notes get small?
   *  Measured in real neck length, so low frets (which are wide) count for more. */
  const fitsView = (lo, hi) => hi - lo <= 6 && XF(Math.min(24, hi)) - XF(Math.max(0, lo)) <= 16;

  function camera(t, dt) {
    // Steady framing: keep a range of frets in view and only move when a hand
    // position coming up in the next 1.6 s doesn't fit, so songs that hop
    // between two positions don't make the camera sway back and forth.
    // Zooming back in waits until things have been settled for a while.
    const A = H.tab.anchors || [];
    let nlo = Infinity;
    let nhi = -Infinity;
    const take = (an) => {
      nlo = Math.min(nlo, an.fret - 1);
      nhi = Math.max(nhi, an.fret - 1 + Math.max(4, an.width || 4));
    };
    // look 1.6 s ahead, but if that would mean framing a huge stretch of the
    // neck (a big jump coming), look less far so the camera pans instead
    for (const ahead of [1.6, 0.7, 0.25]) {
      nlo = Infinity;
      nhi = -Infinity;
      take(anchorAt(t));
      for (let i = lower(A, t); i < A.length && A[i].t < t + ahead; i++) take(A[i]);
      if (fitsView(nlo, nhi)) break;
    }
    // still too much neck for one view (a big jump right now): frame where you are, then pan
    if (!fitsView(nlo, nhi)) {
      nlo = Infinity;
      nhi = -Infinity;
      take(anchorAt(t));
    }
    if (!isFinite(nlo)) {
      nlo = 0;
      nhi = 4;
    }
    const c0 = H.cam;
    const fr = c0.frame;
    const fits = fr && nlo >= fr.lo - 0.01 && nhi <= fr.hi + 0.01;
    if (!fr || !c0.ready) c0.frame = { lo: nlo, hi: nhi, slack: 0 };
    else if (!fits) {
      // grow to take in the new spot, but never past 8 frets: beyond that, move over
      const lo2 = Math.min(nlo, fr.lo);
      const hi2 = Math.max(nhi, fr.hi);
      if (fitsView(lo2, hi2)) c0.frame = { lo: lo2, hi: hi2, slack: 0 };
      else {
        // move only as far as needed: keep as much of the old view as still fits
        let lo = nlo;
        let hi = nhi;
        for (let k = 0; k < 12; k++) {
          if (fr.lo < lo && fitsView(lo - 1, hi)) lo--;
          else if (fr.hi > hi && fitsView(lo, hi + 1)) hi++;
          else break;
        }
        c0.frame = { lo, hi, slack: 0 };
      }
    }
    else if (nhi - nlo < (fr.hi - fr.lo) * 0.6) {
      // much more room than needed: after 2.5 s of that, close in
      fr.slack += dt;
      if (fr.slack > 2.5) c0.frame = { lo: nlo, hi: nhi, slack: 0 };
    } else fr.slack = 0;
    let lo = Math.max(0, c0.frame.lo);
    let hi = Math.min(24, c0.frame.hi);
    const x0 = XF(lo);
    const x1 = XF(hi);
    // Like Rocksmith, the camera sits a little toward the high frets of the
    // hand position, so the highway leans in from the left.
    const targetX = x0 + (x1 - x0) * 0.62;
    // How far back: the hand position takes about 45% of the screen width.
    const aspect = W / Math.max(1, HH);
    const span = Math.max(x1 - x0, 11);
    // the neck sits about 1.26 camera-distances away; the hand position fills ~45% of the width
    const targetD = Math.min(28, Math.max(12, (span * HH * 1.05) / (0.36 * W * 1.2)));
    const c = H.cam;
    if (!c.ready) {
      Object.assign(c, { x: targetX, d: targetD, vx: 0, vd: 0, ready: true });
    } else {
      const w = 2.6; // about 1.6 s to settle, no overshoot
      for (let left = dt; left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        c.vx += (w * w * (targetX - c.x) - 2 * w * c.vx) * h;
        c.x += c.vx * h;
        c.vd += (w * w * (targetD - c.d) - 2 * w * c.vd) * h;
        c.d += c.vd * h;
      }
    }
    c.f = FX(c.x / NECK); // camera centre in frets (tests read this)
    c.px = W / ((c.d * aspect) / 0.9); // rough pixels per unit at the neck (tests)
    // The view: behind the neck, above the strings, looking down the highway.
    const pitch = 0.55; // radians down: looking along the highway, a slim neck below
    G.cp = Math.cos(pitch);
    G.sp = Math.sin(pitch);
    G.camX = c.x;
    G.camY = G.top + c.d * 0.55;
    G.camZ = -c.d;
    G.F = HH * 1.05; // focal length in pixels
    G.cx = W * 0.5;
    // Put the middle of the neck at 76% of the screen height.
    G.cy = 0;
    const yNeck = G.top * 0.5;
    G.cy = HH * 0.78 - (projY(c.x, yNeck, 0) - 0);
    // the highway reaches about four camera-distances away, whatever the zoom
    G.zF = c.d * 5.5;
    G.zs = G.zF / G.L;
  }

  // camera space: depth along the view, up along the view
  const depth = (y, z) => (y - G.camY) * -G.sp + (z - G.camZ) * G.cp;
  const upv = (y, z) => (y - G.camY) * G.cp + (z - G.camZ) * G.sp;
  function projY(x, y, z) {
    return G.cy - (G.F * upv(y, z)) / Math.max(0.5, depth(y, z));
  }
  const PX = (x, y, z) => G.cx + (G.F * (x - G.camX)) / Math.max(0.5, depth(y, z));
  const PY = (x, y, z) => projY(x, y, z);
  /** pixels per world unit at a point (for sizes) */
  const scaleAt = (y, z) => G.F / Math.max(0.5, depth(y, z));

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

  function draw(t, dt) {
    const tab = H.tab;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackdrop(t);
    if (!tab) return;
    geometry(t);
    camera(t, dt);
    const a = anchorAt(t);
    // frets in view at the neck
    const vis = (W * 0.5) / scaleAt(G.top * 0.5, 0);
    const f0 = Math.max(0, Math.floor(FX(Math.max(0, G.camX - vis * 1.6) / NECK)) - 1);
    const f1 = Math.min(24, Math.ceil(FX(Math.min(0.749, (G.camX + vis * 1.6) / NECK))) + 1);
    drawFloor(t, a, f0, f1);
    drawNeck(t, a, f0, f1); // notes arrive on top of the neck, as in Rocksmith
    drawNotes(t, a);
    drawNeckFront(t, a, f0, f1);
    drawFire(a, dt);
  }

  /** Flames off the neck across your hand position, and the streak badge. */
  function drawFire(a, dt) {
    // Never over the notes: embers rise from the neck's bottom edge outside
    // your hand position, the bracket edges glow, the rails warm (drawFloor).
    const yTop = PY(anX0(a), G.neckYt, 0);
    const yBot = PY(anX0(a), G.neckYb, 0);
    const ha = PX(anX0(a), G.neckYb, 0);
    const hb = PX(anX1(a), G.neckYb, 0);
    const n0 = Math.max(0, PX(XF(0), G.neckYb, 0));
    fire.update(Math.min(0.05, dt || 0.016), G.heat, [[n0, ha - 24], [hb + 24, W]], yBot + 2);
    fire.draw(ctx);
    if (G.heat > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const x of [ha, hb]) {
        const g = ctx.createLinearGradient(0, yBot, 0, yTop - 30);
        g.addColorStop(0, `rgba(255, 120, 30, ${0.55 * G.heat})`);
        g.addColorStop(1, 'rgba(255, 60, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 5, yTop - 30, 10, yBot - yTop + 30);
      }
      // a low ember glow along the bottom of the neck
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
      const y = yTop - 24;
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
    venue.draw(ctx, prefs.venue || 'arena', W, HH, performance.now() / 1000, G.pulse, G.heat);
  }

  const tab = () => H.tab;
  /** Cyan rails that warm to orange as you heat up. */
  function railColor(a) {
    const k = G.heat || 0;
    const r = Math.round(90 + (255 - 90) * k);
    const g = Math.round(235 + (150 - 235) * k);
    const b = Math.round(255 + (60 - 255) * k);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function drawFloor(t, a, f0, f1) {
    const zF = G.zF;
    // The whole highway: a dark floor with faint lanes, fading into the distance.
    poly([[XF(f0), 0, 0], [XF(f1), 0, 0], [XF(f1), 0, zF], [XF(f0), 0, zF]]);
    const g = ctx.createLinearGradient(0, PY(G.camX, 0, zF), 0, PY(G.camX, 0, 0));
    g.addColorStop(0, 'rgba(8, 20, 36, 0.0)');
    g.addColorStop(0.35, 'rgba(10, 26, 46, 0.55)');
    g.addColorStop(1, 'rgba(12, 32, 56, 0.85)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1;
    for (let f = f0; f <= f1; f++) {
      ctx.strokeStyle = 'rgba(70, 170, 210, 0.14)';
      line3([XF(f), 0, 0], [XF(f), 0, zF]);
      ctx.stroke();
    }
    // Hand positions coming up: lit troughs with glowing rails, stepping across the floor.
    const A = tab().anchors || [];
    const segs = [];
    for (let i = Math.max(0, lower(A, t) - 1); i < A.length && A[i].t < t + G.L; i++) {
      const an = A[i];
      const za = Math.max(0, zOf(an.t));
      const next = A[i + 1];
      const zb = Math.min(zF, zOf(next ? next.t : an.end || an.t + 600));
      if (zb <= za) continue;
      segs.push({ an, za, zb });
    }
    // far to near so near walls sit on top
    for (let k = segs.length - 1; k >= 0; k--) {
      const { an, za, zb } = segs[k];
      const xa = anX0(an);
      const xb = anX1(an);
      const wall = 0.55;
      const fadeFar = (z) => Math.max(0, Math.min(1, (zF - z) / (zF * 0.3)));
      // floor of the trough
      poly([[xa, 0, za], [xb, 0, za], [xb, 0, zb], [xa, 0, zb]]);
      const lg = ctx.createLinearGradient(0, PY(xa, 0, zb), 0, PY(xa, 0, za));
      lg.addColorStop(0, `rgba(20, 70, 130, ${0.25 * fadeFar(zb)})`);
      lg.addColorStop(1, `rgba(26, 92, 165, ${0.55 * fadeFar(za)})`);
      ctx.fillStyle = lg;
      ctx.fill();
      // side walls
      for (const x of [xa, xb]) {
        poly([[x, 0, za], [x, wall, za], [x, wall, zb], [x, 0, zb]]);
        ctx.fillStyle = `rgba(40, 150, 220, ${0.22 * fadeFar(za)})`;
        ctx.fill();
      }
      // lane lines inside
      ctx.lineWidth = 1.2;
      for (let f = an.fret; f < an.fret - 1 + (an.width || 4); f++) {
        ctx.strokeStyle = `rgba(110, 225, 255, ${0.35 * fadeFar(za)})`;
        line3([XF(f), 0, za], [XF(f), 0, zb]);
        ctx.stroke();
      }
      // glowing rails on top of the walls, and the step where it starts
      ctx.shadowColor = '#3fe0ff';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = railColor(0.95 * fadeFar(za));
      ctx.shadowColor = G.heat > 0.3 ? '#ff8a3a' : '#3fe0ff';
      for (const x of [xa, xb]) {
        line3([x, wall, za], [x, wall, zb]);
        ctx.stroke();
      }
      if (za > 0.2) {
        line3([xa, wall, za], [xb, wall, za]);
        ctx.stroke();
        line3([xa, 0, za], [xb, 0, za]);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // A new hand position coming: its fret numbers on the floor at its front edge.
      if (za > G.zs * 0.5 && za < zF * 0.85) {
        const sc = scaleAt(0, za);
        ctx.font = `800 ${Math.round(Math.max(11, Math.min(22, 0.9 * sc)))}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let f = an.fret; f < an.fret + (an.width || 4); f++) {
          ctx.fillStyle = f === an.fret ? 'rgba(255, 197, 61, 0.95)' : 'rgba(110, 220, 230, 0.75)';
          ctx.fillText(String(f), PX(laneC(f), 0, za), PY(laneC(f), 0, za) + 2);
        }
      }
    }
    // Beat and bar lines across the hand position
    const beats = tab().beats || [];
    for (let i = lower(beats, t); i < beats.length && beats[i].t < t + G.L; i++) {
      const z = zOf(beats[i].t);
      const bar = beats[i].m >= 0;
      const an = anchorAt(beats[i].t);
      const fade = Math.max(0, Math.min(1, (zF - z) / (zF * 0.3)));
      ctx.strokeStyle = bar ? `rgba(170, 240, 255, ${0.5 * fade})` : `rgba(170, 240, 255, ${0.14 * fade})`;
      ctx.lineWidth = bar ? 2 : 1;
      line3([anX0(an), 0.02, z], [anX1(an), 0.02, z]);
      ctx.stroke();
    }
  }

  /** The neck: an upright fretboard at z = 0 with frets, inlays and glowing strings. */
  function drawNeck(t, a, f0, f1) {
    ctx.globalAlpha = 1;
    const n = G.n;
    const yb = -0.25;
    const yt = G.top + 0.55;
    const xn = XF(0);
    const xe = XF(24) + 1.2;
    // the board
    poly([[xn, yb, 0], [xe, yb, 0], [xe, yt, 0], [xn, yt, 0]]);
    const wood = ctx.createLinearGradient(0, PY(xn, yt, 0), 0, PY(xn, yb, 0));
    wood.addColorStop(0, 'rgba(24, 18, 22, 0.42)');
    wood.addColorStop(0.5, 'rgba(36, 26, 26, 0.5)');
    wood.addColorStop(1, 'rgba(14, 11, 14, 0.7)');
    ctx.fillStyle = wood;
    ctx.fill();
    // the lit hand position on the neck
    poly([[anX0(a), yb, 0], [anX1(a), yb, 0], [anX1(a), yt, 0], [anX0(a), yt, 0]]);
    const hl = ctx.createLinearGradient(0, PY(0, yt, 0), 0, PY(0, yb, 0));
    hl.addColorStop(0, 'rgba(60, 200, 255, 0.04)');
    hl.addColorStop(1, 'rgba(60, 200, 255, 0.2)');
    ctx.fillStyle = hl;
    ctx.fill();
    // inlays
    ctx.fillStyle = 'rgba(214, 190, 140, 0.32)';
    const mid = (yb + yt) / 2;
    for (const f of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
      if (f < f0 || f > f1) continue;
      const r = Math.min(laneW(f) * 0.16, 0.32) * scaleAt(mid, 0);
      for (const dy of f === 12 || f === 24 ? [-G.gap * 1.4, G.gap * 1.4] : [0]) {
        ctx.beginPath();
        ctx.arc(PX(laneC(f), mid + dy, 0), PY(laneC(f), mid + dy, 0), r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // nut and frets
    for (let f = f0; f <= Math.min(24, f1 + 1); f++) {
      const x = PX(XF(f), 0, 0);
      if (x < -10 || x > W + 10) continue;
      const top = PY(XF(f), yt, 0);
      const bot = PY(XF(f), yb, 0);
      const wd = f === 0 ? 7 : 3;
      const g = ctx.createLinearGradient(x - wd / 2, 0, x + wd / 2, 0);
      g.addColorStop(0, f === 0 ? '#d8d2c0' : '#6d5a48');
      g.addColorStop(0.5, f === 0 ? '#fff8e6' : '#d8c7a8');
      g.addColorStop(1, f === 0 ? '#d8d2c0' : '#5a4a3a');
      ctx.fillStyle = g;
      ctx.fillRect(x - wd / 2, top, wd, bot - top);
    }
    // strings, thicker toward the low E, glowing when hit
    const now = performance.now();
    for (let s = 0; s < n; s++) {
      const y = strH(s);
      const glow = H.bursts.some((b) => b.s === s && now - b.at < 260);
      const th = (n === 4 ? 4.6 : 3.8) - s * (n === 4 ? 0.55 : 0.42);
      ctx.strokeStyle = STRING[s];
      ctx.shadowColor = STRING[s];
      ctx.shadowBlur = glow ? 22 : 8;
      ctx.lineWidth = th + (glow ? 2 : 0);
      line3([xn, y, 0], [xe, y, 0]);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    G.neckYb = yb;
    G.neckYt = yt;
  }

  /** On the neck: the hand-position bracket, landing targets, fret numbers, names, hit sparks. */
  function drawNeckFront(t, a, f0, f1) {
    const n = G.n;
    const yb = G.neckYb;
    const yt = G.neckYt;
    // The bracket around where your hand goes, with light posts at its edges.
    const xa = anX0(a);
    const xb = anX1(a);
    ctx.shadowColor = '#5fe8ff';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = 'rgba(120, 240, 255, 0.95)';
    ctx.lineWidth = 3;
    const c = 0.9; // corner length (world)
    for (const [x, d] of [[xa, 1], [xb, -1]]) {
      ctx.beginPath();
      ctx.moveTo(PX(x + d * c, yt + 0.25, 0), PY(x + d * c, yt + 0.25, 0));
      ctx.lineTo(PX(x, yt + 0.25, 0), PY(x, yt + 0.25, 0));
      ctx.lineTo(PX(x, yb - 0.1, 0), PY(x, yb - 0.1, 0));
      ctx.lineTo(PX(x + d * c, yb - 0.1, 0), PY(x + d * c, yb - 0.1, 0));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // Landing targets: the next notes outline their spot on the neck as they arrive.
    const T = H.targets;
    const win = 0.7;
    for (let i = lower(T, t - 0.15); i < T.length && T[i].t < t + win; i++) {
      const tg = T[i];
      const k = 1 - Math.min(1, Math.max(0, (tg.t - t) / win));
      for (const nt of tg.notes) {
        if (nt.f === 0) continue;
        const x = laneC(nt.f);
        const y = strH(nt.s);
        const sc = scaleAt(y, 0);
        const w = laneW(nt.f) * 0.66 * sc;
        const hh = G.gap * 0.62 * sc;
        const px = PX(x, y, 0);
        const py = PY(x, y, 0);
        ctx.globalAlpha = 0.2 + 0.8 * k;
        ctx.strokeStyle = STRING[nt.s];
        ctx.lineWidth = 2.5;
        rr(ctx, px - w / 2, py - hh / 2, w, hh, 4);
        ctx.stroke();
        if (tg.kind === 'chord' && H.tab.chords[tg.chord] && k > 0.4) {
          const fi = (H.tab.chords[tg.chord].fingers || [])[nt.s];
          if (fi > 0) {
            ctx.fillStyle = 'rgba(10,12,20,0.88)';
            ctx.beginPath();
            ctx.arc(px, py, hh * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = `800 ${Math.round(hh * 0.78)}px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(fi), px, py + 1);
          }
        }
        ctx.globalAlpha = 1;
      }
    }
    // Fret numbers under the neck: gold in your hand position.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let f = Math.max(1, f0); f <= f1; f++) {
      const x = PX(laneC(f), yb, 0);
      if (x < 14 || x > W - 14) continue;
      const inA = f >= a.fret && f < a.fret + (a.width || 4);
      const y = PY(laneC(f), yb, 0) + 8;
      ctx.font = `${inA ? 800 : 700} ${inA ? 26 : 18}px ${FONT}`;
      ctx.fillStyle = inA ? '#ffc53d' : 'rgba(110, 200, 210, 0.45)';
      if (inA) {
        ctx.shadowColor = 'rgba(255, 180, 40, 0.6)';
        ctx.shadowBlur = 10;
      }
      ctx.fillText(String(f), x, y);
      ctx.shadowBlur = 0;
    }
    // String names at the left edge
    ctx.font = `800 13px ${FONT}`;
    ctx.textBaseline = 'middle';
    for (let s = 0; s < n; s++) {
      const y = PY(XF(0), strH(s), 0);
      ctx.fillStyle = 'rgba(5, 8, 15, 0.9)';
      rr(ctx, 8, y - 10, 22, 20, 10);
      ctx.fill();
      ctx.strokeStyle = STRING[s];
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = STRING[s];
      ctx.fillText((n === 4 ? NAMES4 : NAMES6)[s], 19, y + 1);
    }
    // The next chord's name, big, at the left (as in Rocksmith).
    for (let i = lower(T, t - 0.05); i < T.length && T[i].t < t + 1.6; i++) {
      const tg = T[i];
      if (tg.kind !== 'chord' || !tg.name) continue;
      const k = Math.min(1, (1.6 - (tg.t - t)) / 0.4);
      ctx.globalAlpha = Math.max(0, k);
      ctx.font = `800 ${Math.round(Math.min(60, HH * 0.062))}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.8)';
      const y = PY(XF(0), yt, 0) - 22;
      ctx.strokeText(tg.name, 44, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tg.name, 44, y);
      ctx.globalAlpha = 1;
      break;
    }
    // Hit sparks: a flash on the string and light posts at the hand position.
    const now = performance.now();
    H.bursts = H.bursts.filter((b) => now - b.at < 450);
    for (const b of H.bursts) {
      const k = (now - b.at) / 450;
      const x = b.f === 0 ? noteX(b, a) : laneC(b.f);
      const y = strH(b.s);
      const px = PX(x, y, 0);
      const py = PY(x, y, 0);
      const g = ctx.createRadialGradient(px, py, 0, px, py, 40 + k * 40);
      g.addColorStop(0, `rgba(255,255,255,${0.7 * (1 - k)})`);
      g.addColorStop(0.3, STRING[b.s] + Math.round(160 * (1 - k)).toString(16).padStart(2, '0'));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - 90, py - 90, 180, 180);
    }
    if (H.bursts.length) {
      const k = Math.min(1, (now - Math.max(...H.bursts.map((b) => b.at))) / 450);
      ctx.globalAlpha = 1 - k;
      ctx.shadowColor = '#ff5c8a';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#ffd1df';
      ctx.lineWidth = 3;
      for (const x of [xa, xb]) {
        line3([x, yb - 0.2, 0], [x, yt + 2.2, 0]);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
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

  function drawNotes(t, a) {
    const T = H.targets;
    const zF = G.zF;
    const i0 = lower(T, t - 0.4);
    const i1 = lower(T, t + G.L);
    const judged = (tg) => (H.judge && prefs.detect && rig.on ? H.judge.state.get(tg.id) : null);
    const fadeOf = (z) => (z < 0 ? Math.max(0, 1 + z / 3) : z > zF * 0.8 ? Math.max(0, (zF - z) / (zF * 0.2)) : 1);
    // Sustain trails first, under the gems: each follows the note exactly in
    // time, rising with its real bend, moving with slides, shaking with vibrato.
    for (let i = i0; i < i1; i++) {
      const tg = T[i];
      if (!tg.sus || tg.sus < 0.06) continue;
      const t0 = Math.max(tg.t, t);
      const t1 = Math.min(tg.t + tg.sus, t + G.L);
      if (t1 <= t0) continue;
      const an = anchorAt(tg.t);
      const st = judged(tg);
      const missed = st && st.result === 'miss';
      for (const nt of tg.notes) drawTrail(nt, tg, t0, t1, an, missed, fadeOf(zOf(t0)));
    }
    // Gems and chords, far to near
    for (let i = i1 - 1; i >= i0; i--) {
      const tg = T[i];
      const z = zOf(tg.t);
      if (z > zF) continue;
      const st = judged(tg);
      if (z < -0.5 && (!st || st.result === 'hit')) continue;
      const missed = st && st.result === 'miss';
      const al = fadeOf(z) * (missed ? 0.35 : 1);
      if (al <= 0.01) continue;
      ctx.globalAlpha = al;
      const an = anchorAt(tg.t);
      if (tg.kind === 'chord' || (tg.kind === 'mute' && tg.notes.length > 1)) drawChord(tg, Math.max(0, z), an, missed);
      else for (const nt of tg.notes) drawGem(nt, Math.max(0, z), an, missed, tg.kind === 'mute');
      ctx.globalAlpha = 1;
    }
  }

  /** A note's sustain from t0 to t1 (song times), drawn where it really is. */
  function drawTrail(nt, tg, t0, t1, an, missed, fade) {
    const open = nt.f === 0;
    const col = missed ? '#5a6078' : STRING[nt.s];
    const x0 = noteX(nt, an);
    const slideTo = nt.slideTo !== undefined ? nt.slideTo : nt.slideUnpitchTo;
    const x1 = slideTo !== undefined ? laneC(Math.max(1, slideTo)) : x0;
    const half = open ? 0.5 * (anX1(an) - anX0(an)) - 0.2 : laneW(Math.max(1, nt.f)) * 0.17;
    const base = strH(nt.s);
    const lw = laneW(Math.max(1, nt.f || an.fret));
    const steps = Math.max(8, Math.min(90, Math.round((t1 - t0) * 40)));
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const time = t0 + ((t1 - t0) * k) / steps;
      const u = tg.sus > 0 ? (time - tg.t) / tg.sus : 0;
      let x = x0 + (x1 - x0) * Math.min(1, Math.max(0, u));
      // vibrato ~5.5 shakes a second, tremolo a fast zigzag: in real time, so they read true at any speed
      if (nt.vibrato && u > 0.08) x += Math.sin((time - tg.t) * Math.PI * 2 * 5.5) * lw * 0.14;
      let y = base + (bendAt(nt, time) / 2) * G.gap * 1.5; // a full step rises a string and a half
      if (nt.tremolo) y += (((time - tg.t) * 14) % 1 < 0.5 ? 1 : -1) * G.gap * 0.12;
      pts.push([x, y, zOf(time)]);
    }
    // the ribbon
    ctx.beginPath();
    pts.forEach(([x, y, z], k) => (k ? ctx.lineTo(PX(x - half, y, z), PY(x - half, y, z)) : ctx.moveTo(PX(x - half, y, z), PY(x - half, y, z))));
    for (let k = pts.length - 1; k >= 0; k--) {
      const [x, y, z] = pts[k];
      ctx.lineTo(PX(x + half, y, z), PY(x + half, y, z));
    }
    ctx.closePath();
    ctx.globalAlpha = 0.32 * fade;
    ctx.fillStyle = col;
    ctx.fill();
    // a bright core line down the middle
    ctx.globalAlpha = 0.95 * fade;
    ctx.beginPath();
    pts.forEach(([x, y, z], k) => (k ? ctx.lineTo(PX(x, y, z), PY(x, y, z)) : ctx.moveTo(PX(x, y, z), PY(x, y, z))));
    ctx.strokeStyle = missed ? '#7a7f96' : lighten(col);
    ctx.lineWidth = Math.max(1.5, Math.min(4, 0.1 * scaleAt(base, pts[0][2])));
    ctx.shadowColor = col;
    ctx.shadowBlur = missed ? 0 : 10;
    if (nt.slideUnpitchTo !== undefined && nt.slideTo === undefined) ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // arrows along the bend: up while bending, down on the release
    if (maxBend(nt) > 0) {
      let last = -1;
      for (let k = 1; k < pts.length; k++) {
        const dy = pts[k][1] - pts[k - 1][1];
        if (Math.abs(dy) < 1e-3 || k - last < 3 || pts[k][2] < 0) continue;
        last = k;
        const [x, y, z] = pts[k];
        const px = PX(x, y, z);
        const py = PY(x, y, z);
        const sz = Math.max(4, Math.min(11, 0.3 * scaleAt(y, z)));
        const up = dy > 0;
        ctx.beginPath();
        ctx.moveTo(px - sz, py + (up ? sz * 0.6 : -sz * 0.6));
        ctx.lineTo(px, py + (up ? -sz * 0.6 : sz * 0.6));
        ctx.lineTo(px + sz, py + (up ? sz * 0.6 : -sz * 0.6));
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
    }
    // the bend's size at its peak
    const mb = maxBend(nt);
    if (mb > 0) {
      let best = 0;
      pts.forEach((p, k) => p[1] > pts[best][1] && (best = k));
      const [x, y, z] = pts[best];
      if (z >= 0) {
        const sc = scaleAt(y, z);
        const fs = Math.round(Math.max(11, Math.min(22, sc * 0.55)));
        ctx.font = `800 ${fs}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(5, 8, 15, 0.9)';
        const lbl = `↑${bendLabel(mb)}`;
        ctx.strokeText(lbl, PX(x, y, z), PY(x, y, z) - 6);
        ctx.fillStyle = '#fff3d6';
        ctx.fillText(lbl, PX(x, y, z), PY(x, y, z) - 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** A note: a glowing pill at its string's height in its fret's lane. */
  function drawGem(nt, z, an, missed, mute, inChord = false, box = null) {
    const s = nt.s;
    const open = nt.f === 0;
    const col = missed ? '#5a6078' : STRING[s];
    const y = strH(s);
    const a0 = ctx.globalAlpha;
    const near = Math.max(0, 1 - z / (G.zs * 0.5)); // brightens over the last half second
    if (open) {
      // an open string: a bar across the hand position (or the chord's frame)
      const xa = (box ? box[0] : anX0(an)) + 0.2;
      const xb = (box ? box[1] : anX1(an)) - 0.2;
      const hh = G.gap * 0.16;
      const p0x = PX(xa, y, z);
      const p1x = PX(xb, y, z);
      const py0 = PY(xa, y + hh, z);
      const py1 = PY(xa, y - hh, z);
      rr(ctx, p0x, py0, p1x - p0x, Math.max(3, py1 - py0), Math.max(2, (py1 - py0) / 2));
      const g = ctx.createLinearGradient(0, py0, 0, py1);
      g.addColorStop(0, missed ? '#8a8fa6' : lighten(col));
      g.addColorStop(1, col);
      ctx.fillStyle = g;
      ctx.shadowColor = col;
      ctx.shadowBlur = missed ? 0 : 8 + 10 * near;
      ctx.globalAlpha = a0 * 0.9;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = a0;
      if (!inChord || !box) {
        const sc = scaleAt(y, z);
        const fs = Math.round(Math.max(12, Math.min(30, G.gap * 1.2 * sc)));
        ctx.font = `900 ${fs}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(3, fs * 0.2);
        ctx.strokeStyle = 'rgba(5, 8, 15, 0.9)';
        const mx = (xa + xb) / 2;
        ctx.strokeText('0', PX(mx, y, z), PY(mx, y, z));
        ctx.fillStyle = '#ffffff';
        ctx.fillText('0', PX(mx, y, z), PY(mx, y, z));
      }
      return;
    }
    const x = laneC(nt.f);
    const hw = laneW(nt.f) * 0.36;
    const hh = G.gap * 0.42;
    if (!inChord && z > 0.3) {
      // a thin stem down to its lane, ending in a soft mark, so the fret reads from afar
      ctx.globalAlpha = a0 * 0.55;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      line3([x, y - hh, z], [x, 0, z]);
      ctx.stroke();
      poly([[x - hw * 0.8, 0.01, z - 0.18], [x + hw * 0.8, 0.01, z - 0.18], [x + hw * 0.8, 0.01, z + 0.18], [x - hw * 0.8, 0.01, z + 0.18]]);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = a0;
    }
    const fx0 = PX(x - hw, y, z);
    const fx1 = PX(x + hw, y, z);
    const fy0 = PY(x, y + hh, z);
    const fy1 = PY(x, y - hh, z);
    const w = fx1 - fx0;
    const ht = Math.max(6, fy1 - fy0);
    const r = Math.min(ht / 2, 10);
    // body: a deep gradient, a soft glow that grows as it arrives
    const g = ctx.createLinearGradient(0, fy0, 0, fy0 + ht);
    g.addColorStop(0, missed ? '#7a7f96' : lighten(col));
    g.addColorStop(0.5, col);
    g.addColorStop(1, missed ? '#3a3f52' : STRING_DARK[s]);
    rr(ctx, fx0, fy0, w, ht, r);
    ctx.fillStyle = g;
    ctx.shadowColor = col;
    ctx.shadowBlur = missed ? 0 : Math.min(24, 6 + 0.35 * scaleAt(y, z) + 12 * near);
    ctx.fill();
    ctx.shadowBlur = 0;
    // a crisp light rim and a glassy highlight along the top
    ctx.lineWidth = Math.max(1, Math.min(2.2, 0.06 * scaleAt(y, z)));
    ctx.strokeStyle = nt.palmMute || mute ? 'rgba(20, 24, 36, 0.9)' : 'rgba(255,255,255,0.75)';
    ctx.stroke();
    if (ht > 10) {
      rr(ctx, fx0 + r * 0.6, fy0 + ht * 0.12, w - r * 1.2, ht * 0.22, ht * 0.11);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill();
    }
    if (nt.accent && !missed) accentOutline(x - hw, x + hw, y - hh, y + hh, z);
    // the fret number
    const label = mute || nt.mute ? '×' : nt.harmonic || nt.pinchHarmonic ? `◆${nt.f}` : String(nt.f);
    const fs = Math.round(Math.max(12, Math.min(34, ht * 0.86)));
    const cxp = (fx0 + fx1) / 2;
    const cyp = fy0 + ht / 2;
    ctx.font = `900 ${fs}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, fs * 0.2);
    ctx.strokeStyle = 'rgba(5, 8, 15, 0.85)';
    ctx.strokeText(label, cxp, cyp + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, cxp, cyp + 1);
    // technique tags above the note (bends and slides show on their trail)
    const marks = [];
    if (nt.hammerOn) marks.push('H');
    if (nt.pullOff) marks.push('P');
    if (nt.tap) marks.push('T');
    if (nt.palmMute) marks.push('PM');
    if (nt.slap) marks.push('S');
    if (nt.pop) marks.push('Pop');
    if (maxBend(nt) && !(nt.sus > 0.06)) marks.push(`↑${bendLabel(maxBend(nt))}`);
    if (nt.slideTo !== undefined && !(nt.sus > 0.06)) marks.push(nt.slideTo > nt.f ? '↗' : '↘');
    if (marks.length && fs > 13 && !inChord) {
      const mfs = Math.round(Math.max(10, fs * 0.5));
      ctx.font = `800 ${mfs}px ${FONT}`;
      const txt = marks.join(' ');
      const tw = ctx.measureText(txt).width + mfs * 0.9;
      const ty = fy0 - mfs * 0.95;
      rr(ctx, cxp - tw / 2, ty - mfs * 0.62, tw, mfs * 1.24, mfs * 0.62);
      ctx.fillStyle = 'rgba(8, 12, 22, 0.85)';
      ctx.fill();
      ctx.fillStyle = '#ffe2b0';
      ctx.fillText(txt, cxp, ty + 1);
    }
  }

  /** Accented (played harder) notes and chords get a bright white outline, as in Rocksmith. */
  function accentOutline(x0, x1, y0, y1, z) {
    const sc = scaleAt((y0 + y1) / 2, z);
    const pad = Math.max(2, Math.min(6, 0.14 * sc));
    const ax = PX(x0, y1, z) - pad;
    const bx = PX(x1, y1, z) + pad;
    const ay = PY(x0, y1, z) - pad;
    const by = PY(x0, y0, z) + pad;
    rr(ctx, ax, ay, bx - ax, by - ay, Math.min(10, pad * 1.6));
    ctx.lineWidth = Math.max(1.2, Math.min(2.6, 0.07 * sc));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowBlur = Math.min(14, 0.45 * sc);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** A chord: a glass frame across the hand position with its notes inside. */
  function drawChord(tg, z, an, missed) {
    const fretted = tg.notes.filter((x) => x.f > 0).map((x) => x.f);
    // always the whole hand position (and any fret beyond it), so open strings sit inside
    const xa = Math.min(anX0(an), fretted.length ? XF(Math.min(...fretted) - 1) : Infinity) + 0.08;
    const xb = Math.max(anX1(an), fretted.length ? XF(Math.max(...fretted)) : -Infinity) - 0.08;
    const top = Math.max(...tg.notes.map((x) => strH(x.s)));
    const yTop = top + G.gap * 0.7;
    const accent = tg.notes.some((x) => x.accent);
    const sc = scaleAt(yTop, z);
    const pxa = PX(xa, yTop, z);
    const pxb = PX(xb, yTop, z);
    const pyt = PY(xa, yTop, z);
    const pyb = PY(xa, 0, z);
    const rad = Math.min(10, 0.25 * sc);
    const edge = missed ? '#5a6078' : 'rgba(110, 236, 255, 0.95)';
    if (tg.repeat) {
      // the same chord again: just its frame, so the rhythm (and accents) read at a glance
      rr(ctx, pxa, pyt, pxb - pxa, pyb - pyt, rad);
      ctx.fillStyle = missed ? 'rgba(90, 96, 120, 0.06)' : 'rgba(60, 200, 240, 0.06)';
      ctx.fill();
      ctx.lineWidth = Math.max(1.2, Math.min(2.4, 0.07 * sc));
      ctx.strokeStyle = missed ? '#5a6078' : 'rgba(110, 236, 255, 0.7)';
      ctx.stroke();
      if (accent && !missed) accentOutline(xa, xb, 0, yTop, z);
      if (tg.kind === 'mute') {
        ctx.font = `900 ${Math.round(Math.max(12, Math.min(30, sc * 1.0)))}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('×', (pxa + pxb) / 2, (pyt + pyb) / 2);
      }
      return;
    }
    // glass panel: brighter at the top, fading to the floor
    rr(ctx, pxa, pyt, pxb - pxa, pyb - pyt, rad);
    const g = ctx.createLinearGradient(0, pyt, 0, pyb);
    g.addColorStop(0, missed ? 'rgba(90, 96, 120, 0.16)' : 'rgba(80, 210, 250, 0.2)');
    g.addColorStop(1, missed ? 'rgba(90, 96, 120, 0.04)' : 'rgba(40, 150, 220, 0.05)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1.6, Math.min(3.4, 0.11 * sc));
    ctx.strokeStyle = edge;
    ctx.shadowColor = '#4fe3ff';
    ctx.shadowBlur = missed ? 0 : 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (accent && !missed) accentOutline(xa, xb, 0, yTop, z);
    // the chord's notes, inside the frame
    const box = [xa, xb];
    for (const nt of tg.notes) drawGem(nt, z, an, missed, tg.kind === 'mute', true, box);
    // its name in a small tag above the frame
    if (tg.name && sc > 12) {
      const fs = Math.round(Math.max(11, Math.min(22, sc * 0.62)));
      ctx.font = `800 ${fs}px ${FONT}`;
      const tw = ctx.measureText(tg.name).width + fs * 0.9;
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
    if (tg.notes.some((x) => x.palmMute) && sc > 14) {
      ctx.font = `800 ${Math.round(Math.max(10, sc * 0.42))}px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffe2b0';
      ctx.fillText('PM', pxb, pyt - 4);
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
    guitarBtn.setAttribute('aria-pressed', String(rig.on && !rig.muted));
    guitarBtn.innerHTML = `${icon('amp')}<span>${rig.on ? (rig.muted ? 'Guitar muted' : 'Guitar on') : 'Your guitar'}</span>`;
    const mineT = (tonelib.list || []).find((x) => x.id === rig.toneId);
    const toneName = rig.mode === 'song' && rig.songTone ? `Song tone · ${rig.songTone.name}` : mineT ? `${mineT.slot ? `${mineT.slot} · ` : ''}${mineT.name}` : (TONES.find((x) => x.id === rig.toneId) || {}).name || 'Tone';
    toneBtn.innerHTML = `<span>Tone: ${esc(toneName)}</span>${rig.capture ? '<span class="real-badge sm" title="Real amp">REAL</span>' : ''}`;
    toneBtn.hidden = !rig.on;
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
      if (H.open && song && (!H.song || song.id !== H.song.id)) loadSong(song).then(() => (H.cam.ready = false));
    },
    stemsChanged() {
      if (H.open) {
        applyPlayAlong();
        renderControls();
      }
    },
  };
}
