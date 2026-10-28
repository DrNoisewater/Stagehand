/**
 * Play: where Stagehand opens. Your guitar is live, no song needed: the tone
 * you're on, slots 1–9, the rig with its knobs, the tuner, drums and the looper.
 */
import { state, on, setPage, emit } from './store.js';
import { openJam } from './jam.js';
import { tuningName, myTuning, setMyTuning, MY_TUNINGS, MY_TUNINGS_BASS } from './tuning.js';
import { h, icon, esc, toast, showMenu } from './ui.js';
import { rig } from './rig.js';
import { api } from './api.js';
import { tonelib, bySlot, byId, useSlot, useTone, SLOT_GELS, SLOT_COUNT, nowPlayingTone, kindLabel, saveTone, freeSlot, knobsOf, orderedGear, TYPE_GELS, TYPE_NAMES, shortGearName, gelOf } from './tonelib.js';
import { chainEl, rotaryKnob, fmtKnob, gearSummary } from './rigui.js';
import { createTuner } from './tuner.js';
import { drums, PATTERNS } from './drums.js';
import { looper } from './looper.js';
import { guitarStatus } from './shell.js';
import { modelLabel } from './realamps.js';

const root = document.getElementById('page-play');
const P = { block: null, draft: null, sig: '', liveT: 0, liveTimer: null };

const noteHost = h('div');
const headHost = h('div.play-head');
const slotsHost = h('section.slots', { 'aria-label': 'Tone slots' });
const rigCard = h('section.card.rig-card', { 'aria-label': 'Rig' });
const side = h('div.play-side');
const tuner = createTuner();
const drumsCard = h('section.card.tint.drums3', { 'aria-label': 'Drums and metronome', style: { '--gel': 'var(--gel-drums)' } });
const loopCard = h('section.card.tint.looper3', { 'aria-label': 'Looper', style: { '--gel': 'var(--gel-guitar)' } });
const dropCard = h('section.card.tint.drop3', { 'aria-label': 'Drop', style: { '--gel': 'var(--gel-bass)' } });
side.append(tuner.el, dropCard, drumsCard, loopCard);
root.append(noteHost, headHost, slotsHost, h('div.play-grid', null, rigCard, side));

// --------------------------------------------------------------- helpers --
function current() {
  return nowPlayingTone();
}

/** The tone the rig card shows: the one being edited, or what's playing. */
function shownTone() {
  if (P.draft) return { ...P.draft.base, gear: P.draft.gear };
  return current().tone;
}

function cloneGear(tone) {
  return orderedGear(tone).map((g) => ({ ...g, knobs: { ...(g.knobs || {}) } }));
}

function startDraft() {
  if (P.draft) return P.draft;
  const np = current();
  const base = np.tone;
  const mode = rig.mode;
  const id = rig.toneId;
  const songTone = rig.songTone;
  P.draft = {
    base: { ...base },
    gear: cloneGear(base),
    gel: np.gel,
    restore: () => {
      if (mode === 'song' && songTone) rig.setSongTone(songTone);
      else if (mode === 'preset') rig.setTone(id);
      else if (base && base.gear) rig.setLiveTone(base);
    },
  };
  return P.draft;
}

function pushLive() {
  const d = P.draft;
  if (!d) return;
  const go = () => {
    P.liveT = performance.now();
    rig.setLiveTone({ ...d.base, gear: d.gear, fromLabel: 'Changed, not saved yet', gel: d.gel });
  };
  clearTimeout(P.liveTimer);
  const since = performance.now() - P.liveT;
  if (since > 140) go();
  else P.liveTimer = setTimeout(go, 140 - since);
}

async function saveDraft() {
  const d = P.draft;
  if (!d) return;
  try {
    const mine = d.base.id && byId(d.base.id);
    let saved;
    if (mine) saved = await saveTone({ ...mine, gear: d.gear });
    else saved = await saveTone({ name: d.base.name || 'My tone', kind: d.base.kind, gear: d.gear, slot: freeSlot(), from: d.base.key ? { song: (d.base.songLabel || null), toneKey: d.base.key } : null });
    P.draft = null;
    useTone(saved.id);
    toast({ title: `Saved ${saved.name}`, message: saved.slot ? `In slot ${saved.slot}.` : 'In your tones.', kind: 'ok' });
  } catch (err) {
    toast({ title: 'Couldn’t save the tone', message: err.message, kind: 'err' });
  }
}

function discardDraft() {
  const d = P.draft;
  P.draft = null;
  clearTimeout(P.liveTimer);
  if (d) d.restore();
  render();
}

// ----------------------------------------------------------------- head --
function renderNote() {
  noteHost.innerHTML = '';
  if (rig.on) return;
  const s = guitarStatus();
  const n = h(`div.play-note${s.cls === 'err' ? '.err' : ''}`, null, h('span', { html: icon(s.cls === 'err' ? 'alert' : 'info') }), h('span', { html: `<b>${esc(s.title)}.</b> ${s.line}` }));
  noteHost.append(n);
}

function renderHead() {
  const np = current();
  headHost.style.setProperty('--gel', np.gel);
  headHost.innerHTML = '';
  const eq = h('span.eq', { style: { '--gel': np.gel } }, h('i'), h('i'), h('i'));
  const text = h('div.ph-text', null, h('div.eyebrow', null, rig.on && !rig.muted ? eq : null, 'Playing now'), h('h1', { text: P.draft ? `${np.name}` : np.name }), h('div.from', { text: np.from }));
  const calib = h('button.btn.soft', { type: 'button', text: rig.calibrating ? 'Strum hard…' : 'Set input level', disabled: !rig.on || rig.calibrating, title: 'Strum as hard as you play for 4 seconds; Stagehand sets the input level, like Rocksmith’s calibration' });
  calib.onclick = async () => {
    calib.disabled = true;
    const r = await rig.calibrate(4, (p) => (calib.textContent = `Strum hard… ${Math.max(1, Math.ceil(4 - p * 4))}`));
    if (!r) toast({ title: 'Didn’t hear anything', message: 'Check the cable is plugged in, then strum hard while it counts down.', kind: 'info' });
    else toast({ title: 'Input level set', message: `Your hardest strum peaked at ${Math.round(r.peakDb)} dB.`, kind: 'ok' });
  };
  const edit = h('button.btn.glow-primary', { type: 'button', text: 'Edit this tone' });
  edit.onclick = () => {
    const t = shownTone();
    emit('tones-open', { tone: t, id: t && t.id && byId(t.id) ? t.id : null });
    setPage('tones');
  };
  // 3.7: Jam, full screen: just the Fluid picture reacting to your playing (J)
  const jam = h('button.btn.soft.jam-open', { type: 'button', title: 'Full screen, no song: the Fluid picture follows what you play (J)', html: `${icon('sparkle')}<span>Jam</span>` });
  jam.onclick = () => openJam();
  headHost.append(text, calib, jam, edit);
}

// ---------------------------------------------------------------- slots --
function renderSlots() {
  slotsHost.innerHTML = '';
  const active = rig.mode === 'preset' ? (byId(rig.toneId) || {}).slot : null;
  for (let n = 1; n <= SLOT_COUNT; n++) {
    const t = bySlot(n);
    const gel = SLOT_GELS[n - 1];
    const on = active === n;
    const b = h(`button.slot${on ? '.on.lit' : ''}${t ? '' : '.empty'}`, { type: 'button', style: { '--gel': t ? gel : '#2c3552' }, title: t ? `${t.name} (key ${n})` : `Empty slot ${n}: click to save the tone you’re playing here` });
    const top = h('span.sl-top', null, h('span.num', { text: String(n) }));
    if (on && rig.on && !rig.muted) top.append(h('span.eq', { style: { '--gel': gel } }, h('i'), h('i'), h('i')));
    else top.append(h('span.kind', { text: t ? kindLabel(t) : 'Empty' }));
    b.append(top, h('span.name', { text: t ? t.name : '+ Save here' }), h('span.strip'));
    b.onclick = () => (t ? useSlot(n) : saveHere(n));
    b.oncontextmenu = (e) => {
      e.preventDefault();
      const items = [];
      if (t) items.push({ label: `Use ${t.name}`, icon: 'play', onClick: () => useSlot(n) });
      items.push({ label: 'Save the tone I’m playing here', icon: 'plus', onClick: () => saveHere(n) });
      if (t) {
        items.push({ label: 'Edit in Tones', icon: 'edit', onClick: () => (emit('tones-open', { id: t.id }), setPage('tones')) });
        items.push('-', { label: 'Empty this slot', icon: 'x', onClick: () => clearSlot(t) });
      }
      showMenu(e.clientX, e.clientY, items);
    };
    slotsHost.append(b);
  }
}

async function saveHere(n) {
  const np = current();
  const tone = shownTone();
  if (!tone || !tone.gear || !tone.gear.length) return;
  try {
    const mine = tone.id && byId(tone.id);
    let saved;
    if (mine && !P.draft) saved = await saveTone({ ...mine, slot: n });
    else saved = await saveTone({ name: tone.name || np.name || 'My tone', kind: tone.kind, gear: tone.gear, slot: n, from: mine ? mine.from : tone.key ? { toneKey: tone.key, song: tone.songLabel || null } : null });
    P.draft = null;
    useTone(saved.id);
    toast({ title: `${saved.name} is in slot ${n}`, message: `Press ${n} anywhere to switch to it.`, kind: 'ok' });
  } catch (err) {
    toast({ title: 'Couldn’t save the tone', message: err.message, kind: 'err' });
  }
}

async function clearSlot(t) {
  await api.tones.setSlot(t.id, null);
  t.slot = null;
  rig.registerTones(tonelib.list);
  emit('tones');
}

// ------------------------------------------------------------------ rig --
function renderRig() {
  const tone = shownTone();
  rigCard.innerHTML = '';
  const head = h('div.card-head', null, h('h2', { text: 'Rig' }), h('span.hint', { text: 'Click a piece to set its knobs' }), h('span.grow'));
  if (P.draft) {
    const save = h('button.btn.small.glow-primary', { type: 'button', text: 'Save' });
    save.onclick = () => saveDraft();
    const undo = h('button.btn.small.soft', { type: 'button', text: 'Undo changes' });
    undo.onclick = () => discardDraft();
    head.append(h('span.unsaved', null, h('span.dot', { style: { '--gel': 'var(--tungsten)' } }), 'Changed, not saved'), undo, save);
  } else if (rig.on) head.append(h('span.unsaved', { style: { color: 'var(--ink-2)' } }, h('span.dot.glow', { style: { '--gel': 'var(--tungsten)' } }), 'Signal'));
  rigCard.append(head);
  if (!tone || !tone.gear || !tone.gear.length) {
    rigCard.append(h('p', { text: 'This tone has no gear to show.', style: { color: 'var(--ink-3)' } }));
    return;
  }
  const gear = P.draft ? P.draft.gear : orderedGear(tone);
  if (P.block === null || P.block >= gear.length) P.block = Math.max(0, gear.findIndex((g) => g.slot === 'amp'));
  const { el } = chainEl({ ...tone, gear }, { selected: P.block, onPick: (i) => ((P.block = i), renderRig()), sub: gearSummary });
  for (const c of el.querySelectorAll('.cable')) c.classList.toggle('quiet', !rig.on || rig.muted);
  rigCard.append(el);
  const g = gear[P.block];
  const gel = TYPE_GELS[g.slot] || '#ff4d8d';
  const well = h('div.knob-well', { style: { '--gel': gel } });
  const kwHead = h('div.kw-head', null, h('span.dot'), `${shortGearName(g.key)} · ${(TYPE_NAMES[g.slot] || 'Pedal').toLowerCase()}`);
  if (g.slot === 'amp' && rig.capture && !P.draft) {
    const lbl = modelLabel(rig.capture);
    kwHead.append(h('span.real-badge.sm', { text: 'REAL' }), h('span.kw-cap', { text: `${rig.capture.pack.title}${lbl ? ` · ${lbl}` : ''}` }));
  }
  well.append(kwHead);
  const knobs = h('div.knobs3');
  const list = knobsOf(g);
  if (!list.length) knobs.append(h('span', { text: 'No knobs on this one.', style: { color: 'var(--ink-3)', fontSize: '12.5px' } }));
  for (const k of list) {
    knobs.append(
      rotaryKnob({
        name: k.name,
        min: k.min,
        max: k.max,
        value: k.value,
        def: k.def,
        gel,
        fmt: (v) => fmtKnob(k, v),
        onInput: (v) => {
          const d = startDraft();
          const dg = d.gear[P.block];
          dg.knobs = { ...(dg.knobs || {}), [k.key]: v };
          pushLive();
          if (!rigCard.querySelector('.unsaved .btn, .btn.glow-primary')) renderRigHeadOnly();
        },
      })
    );
  }
  well.append(knobs);
  rigCard.append(well);
  const slider = (name, label, gelc) => {
    const v = name === 'gain' ? rig.knobs.gain ?? rig.tone.gain : rig.knobs[name];
    const input = h('input.glow-range', { type: 'range', min: '0', max: '1', step: '0.01', value: String(v ?? 0.5), 'aria-label': label, style: { '--g': gelc, '--p': `${Math.round((v ?? 0.5) * 100)}%` } });
    input.oninput = () => {
      rig.setKnob(name, input.value);
      input.style.setProperty('--p', `${Math.round(Number(input.value) * 100)}%`);
    };
    input.ondblclick = () => {
      input.value = name === 'volume' ? '0.7' : '0.5';
      input.dispatchEvent(new Event('input'));
    };
    return h('label', null, label, input);
  };
  rigCard.append(h('div.rig-sliders', null, slider('input', 'Input', '#6bd49a'), slider('fx', 'Effects', '#33c8e0'), slider('volume', 'Volume', '#ffb547')));
}

/** After the first knob turn, show Save / Undo without rebuilding the knob being dragged. */
function renderRigHeadOnly() {
  const head = rigCard.querySelector('.card-head');
  if (!head || head.querySelector('.glow-primary')) return;
  for (const el of [...head.querySelectorAll('.unsaved')]) el.remove();
  const save = h('button.btn.small.glow-primary', { type: 'button', text: 'Save' });
  save.onclick = () => saveDraft();
  const undo = h('button.btn.small.soft', { type: 'button', text: 'Undo changes' });
  undo.onclick = () => discardDraft();
  head.append(h('span.unsaved', null, h('span.dot', { style: { '--gel': 'var(--tungsten)' } }), 'Changed, not saved'), undo, save);
}

// ---------------------------------------------------------------- drums --
const D = { padEls: [], raf: 0, lastStep: -2 };
function renderDrums() {
  drumsCard.innerHTML = '';
  const start = h('button.btn.small.soft.start', { type: 'button', text: drums.on ? 'Stop' : 'Start', 'aria-pressed': String(drums.on) });
  start.onclick = () => drums.toggle();
  drumsCard.append(h('div.card-head', null, h('h2', { text: 'Drums & metronome' }), start));
  const minus = h('button.sq', { type: 'button', 'aria-label': 'Slower', text: '−' });
  const plus = h('button.sq', { type: 'button', 'aria-label': 'Faster', text: '+' });
  const tap = h('button.btn.small.soft', { type: 'button', text: 'Tap' });
  minus.onclick = (e) => drums.setBpm(drums.bpm - (e.shiftKey ? 10 : 1));
  plus.onclick = (e) => drums.setBpm(drums.bpm + (e.shiftKey ? 10 : 1));
  tap.onclick = () => drums.tap();
  const bpm = h('div.bpm', { html: `${drums.bpm}<small> BPM</small>`, title: 'Scroll to change' });
  bpm.addEventListener('wheel', (e) => {
    e.preventDefault();
    drums.setBpm(drums.bpm - Math.sign(e.deltaY));
  }, { passive: false });
  const vol = h('input.glow-range', { type: 'range', min: '0', max: '1', step: '0.01', value: String(drums.volume), 'aria-label': 'Drum volume', style: { '--g': '#ff4d8d', '--p': `${Math.round(drums.volume * 100)}%` } });
  vol.oninput = () => {
    drums.setVolume(vol.value);
    vol.style.setProperty('--p', `${Math.round(Number(vol.value) * 100)}%`);
  };
  drumsCard.append(h('div.bpm-row', null, bpm, minus, plus, tap, h('span.grow'), h('label.vol', null, 'Volume', vol)));
  const p = drums.pat;
  const rows = h('div.drum-rows');
  D.padEls = [];
  const COL = [['Hats', p.h, '#ffc0d6'], ['Snare', p.s, '#ff4d8d'], ['Kick', p.k, '#c92a62']];
  if (p.id === 'click') COL.splice(0, 3, ['Click', p.c, '#ffc0d6']);
  for (const [, hits, col] of COL) {
    const r = h('div.row16');
    for (let i = 0; i < 16; i++) {
      const pad = h(`span.pad${i % 4 === 0 ? '.beat' : ''}${hits.includes(i) ? '.hit' : ''}`, { style: { '--gel': col } });
      D.padEls.push([i, pad]);
      r.append(pad);
    }
    rows.append(r);
  }
  drumsCard.append(h('div.grid16', null, h('div.labels', null, ...COL.map((c) => h('span', { text: c[0] }))), rows));
  const chips = h('div.chips');
  for (const pt of PATTERNS) {
    const c = h('button.gchip', { type: 'button', 'aria-pressed': String(pt.id === drums.pattern), html: `<span class="dot"></span>${esc(pt.name)}` });
    c.onclick = () => drums.setPattern(pt.id);
    chips.append(c);
  }
  drumsCard.append(chips);
  D.lastStep = -2;
  if (drums.on) drumLights();
}
function drumLights() {
  if (D.raf) return;
  const f = () => {
    D.raf = 0;
    if (!drums.on || state.page !== 'play') {
      for (const [, el] of D.padEls) el.classList.remove('now');
      return;
    }
    const s = drums.currentStep();
    if (s !== D.lastStep) {
      D.lastStep = s;
      for (const [i, el] of D.padEls) el.classList.toggle('now', i === s);
    }
    D.raf = requestAnimationFrame(f);
  };
  D.raf = requestAnimationFrame(f);
}
drums.addEventListener('change', renderDrums);

// ----------------------------------------------------------------- drop --
const DROP_STEPS = [1, 2, 3, 4, 5, 6, 7, 12];
const TUNE_NAMES = { 1: 'E♭ Standard', 2: 'D Standard', 3: 'C♯ Standard', 4: 'C Standard', 5: 'B Standard', 6: 'B♭ Standard', 7: 'A Standard', 12: 'an octave down' };
export function renderDrop() {
  const d = rig.drop;
  const amt = rig.dropAmount();
  dropCard.innerHTML = '';
  dropCard.classList.toggle('on', d.on);
  const sw = h('button.drop-switch', { type: 'button', 'aria-pressed': String(d.on), title: `${d.on ? 'Turn the Drop off' : 'Turn the Drop on'} (D)` }, h('span.led'));
  sw.onclick = () => rig.setDrop({ on: !d.on });
  const label = d.on ? (amt ? (amt === 12 ? 'Octave down' : `Down ${amt} semitone${amt === 1 ? '' : 's'}`) : 'Song is in standard') : 'Off';
  dropCard.append(h('div.card-head', null, h('h2', { text: 'Drop' }), h('span.drop-state', { text: label }), h('span.grow'), sw));
  const chips = h('div.drop-steps', { role: 'group', 'aria-label': 'How far to drop' });
  for (const st of DROP_STEPS) {
    const b = h('button', { type: 'button', text: st === 12 ? 'Oct' : `−${st}`, 'aria-pressed': String(!d.match && d.st === st), title: `Sound like ${TUNE_NAMES[st]}` });
    b.onclick = () => rig.setDrop({ st, match: false, on: true });
    chips.append(b);
  }
  dropCard.append(chips);
  const songSt = rig.dropSong;
  const kind = rig.songKind || 'guitar';
  const songName = rig.songTuning && rig.songTuning.length ? tuningName(rig.songTuning, kind) : '';
  const match = h('label.check.drop-match', null, h('input', { type: 'checkbox', checked: d.match ? true : null }), h('span', { text: songSt ? `Match the song (${songName}: −${songSt})` : 'Match the song’s tuning' }));
  match.querySelector('input').onchange = (e) => rig.setDrop({ match: e.target.checked, on: e.target.checked ? true : d.on });
  dropCard.append(match);
  // 3.7: what your instrument is actually tuned to (Stagehand also learns it from your playing)
  const mine = h('select.input.drop-mine', { 'aria-label': `Your ${kind} is tuned to` });
  const cur = myTuning(kind).join(',');
  const opts = kind === 'bass' ? MY_TUNINGS_BASS : MY_TUNINGS;
  for (const o of opts) mine.append(h('option', { value: o.join(','), text: tuningName(o, kind), selected: o.join(',') === cur ? true : null }));
  if (!opts.some((o) => o.join(',') === cur)) mine.append(h('option', { value: cur, text: tuningName(myTuning(kind), kind), selected: true }));
  mine.onchange = () => {
    setMyTuning(kind, mine.value.split(',').map(Number));
    if (rig.songTuning) rig.setSongTuning(rig.songTuning, kind);
    renderDrop();
  };
  dropCard.append(h('label.drop-mine-row', null, h('span', { text: `Your ${kind} is in` }), mine));
  dropCard.append(h('p.drop-fine', { text: 'Play songs tuned lower than your instrument without retuning, like a DigiTech Drop. Scoring follows it. When a song needs it, Stagehand offers the Drop or tells you which strings to retune.' }));
}
rig.addEventListener('drop', () => state.page === 'play' && renderDrop());

// --------------------------------------------------------------- looper --
const L = { canvas: null, raf: 0 };
function renderLooper() {
  loopCard.innerHTML = '';
  const st = looper.state;
  loopCard.classList.toggle('rec', st === 'recording' || st === 'overdub' || st === 'armed');
  loopCard.append(h('div.card-head', null, h('h2', { text: 'Looper' }), h('span.grow'), h('span.hint', { text: drums.on ? 'Locks to the drum beat' : 'Start the drums to lock to a beat' })));
  const well = h('div.loop-well');
  L.canvas = h('canvas', { 'aria-hidden': 'true' });
  well.append(L.canvas);
  loopCard.append(well);
  const rec = h('button.btn.rec', { type: 'button', 'aria-pressed': String(st === 'recording' || st === 'armed') });
  rec.innerHTML = st === 'recording' ? `${icon('stop')}<span>Stop</span>` : st === 'armed' ? '<span>Waiting for the bar…</span>' : `${icon('record')}<span>Record</span>`;
  rec.onclick = () => (st === 'recording' || st === 'armed' ? looper.stopRecording() : looper.record());
  const od = h('button.btn.soft', { type: 'button', text: st === 'overdub' ? 'Overdubbing…' : 'Overdub', disabled: !looper.L || st === 'busy' });
  od.onclick = () => looper.overdub();
  const clr = h('button.btn.soft', { type: 'button', text: 'Clear', disabled: st === 'empty' });
  clr.onclick = () => looper.clear();
  const save = h('button.btn.soft', { type: 'button', title: 'Save the loop to your takes', 'aria-label': 'Save loop', html: icon('download'), disabled: !looper.L });
  save.style.flex = '0 0 44px';
  save.onclick = () => looper.saveAsTake();
  loopCard.append(h('div.lp-btns', null, rec, od, clr, save));
  const msg = {
    empty: rig.on ? 'Press Record, play, press Stop. It loops straight away.' : 'Plug in your guitar to record loops.',
    armed: 'Recording starts on the next bar.',
    recording: 'Recording… press Stop when you’re done.',
    busy: 'Making the loop…',
    playing: `Looping ${looper.length.toFixed(1)} s${looper.layers > 1 ? ` · ${looper.layers} layers` : ''}${looper.bpm ? ` · ${looper.bpm} BPM` : ''}`,
    overdub: 'Overdubbing one pass, lined up with the loop…',
  }[st];
  loopCard.append(h('div.lp-status', { text: msg || '' }));
  drawLoop();
}

function drawLoop() {
  const c = L.canvas;
  if (!c || !c.isConnected) return;
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(r.width * dpr));
  c.height = Math.max(1, Math.round(r.height * dpr));
  const g = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  for (let q = 1; q < 4; q++) g.fillRect(Math.round((q * W) / 4), 0, dpr, H);
  if (looper.L) {
    const d = looper.L;
    const step = 3 * dpr;
    const n = Math.floor(W / step);
    const per = Math.max(1, Math.floor(d.length / n));
    let top = 1e-4;
    const pk = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = i * per, e = Math.min(d.length, j + per); j < e; j += 8) m = Math.max(m, Math.abs(d[j]));
      pk[i] = m;
      top = Math.max(top, m);
    }
    const pos = looper.position();
    for (let i = 0; i < n; i++) {
      const hh = (pk[i] / top) * (H / 2) * 0.9 + dpr;
      const played = pos !== null && i / n <= pos;
      g.fillStyle = played ? '#ff6b3d' : 'rgba(255, 107, 61, 0.38)';
      g.fillRect(i * step, H / 2 - hh, 2 * dpr, hh * 2);
    }
    if (pos !== null) {
      g.save();
      g.shadowColor = 'rgba(255,181,71,0.6)';
      g.shadowBlur = 6 * dpr;
      g.fillStyle = '#fff';
      g.fillRect(pos * W - dpr, 0, 2 * dpr, H);
      g.restore();
    }
  } else if (looper.state === 'recording' || looper.state === 'armed') {
    g.fillStyle = 'rgba(255,107,107,0.25)';
    g.fillRect(0, 0, W * Math.min(1, looper.rec.seconds / 8), H);
  }
  if (!L.raf && (looper.src || looper.state === 'recording') && state.page === 'play')
    L.raf = requestAnimationFrame(() => {
      L.raf = 0;
      drawLoop();
    });
}
looper.addEventListener('change', renderLooper);

// --------------------------------------------------------------- render --
function sig() {
  const t = shownTone();
  return [rig.mode, rig.toneId, rig.on, rig.muted, P.draft ? 'd' : '', P.block, t && t.gear ? t.gear.length : 0, (t && t.name) || '', rig.capture ? rig.capture.path : ''].join('|');
}

function render() {
  if (state.page !== 'play') return;
  renderNote();
  renderHead();
  renderSlots();
  const s = sig();
  if (s !== P.sig || !rigCard.firstChild) {
    P.sig = s;
    renderRig();
  }
}

function renderAll() {
  P.sig = '';
  render();
  renderDrop();
  renderDrums();
  renderLooper();
}

rig.addEventListener('change', () => {
  // A tone picked somewhere else ends any edit here.
  if (P.draft && rig.mode !== 'live') P.draft = null;
  render();
});
on('tones', () => {
  P.sig = '';
  render();
});
on('page', () => {
  if (state.page === 'play') {
    renderAll();
    tuner.show();
  } else tuner.hide();
});
if (state.page === 'play') {
  renderAll();
  tuner.show();
}
