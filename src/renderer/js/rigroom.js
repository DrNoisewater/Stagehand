/**
 * 4.6: Create a Tone, rebuilt as one big steady room (the user: "it should be easy to see
 * everything without menus jumping around. all gear in use should have a cord going between
 * them like in photo provided").
 *
 *   ┌ name ─ 1 Amp ✓ 2 Cab ✓ 3 Pedals 4 Knobs 5 Hear it 6 Save ─ ▶ Demo ─ ↶ ↷ ⟲ ─ key ─ Save ─ ✕ ┐
 *   │ THE BOARD   your guitar ═ pedals ═ amp head        ═ loop pedals ═ rack ═ out            │
 *   │                                    on its cabinet                                        │
 *   │             (braided cables; a light runs along them while you play)                     │
 *   ├──────────────────────────────────────────────┬───────────────────────────────────────────┤
 *   │ THE PIECE YOU PICKED                         │ THE GEAR WALL (always open)               │
 *   │ big photo, knobs turn on it + control strip  │ shelves: amps · cabs · drive · mod · …    │
 *   │ on/off · move earlier/later · swap · remove  │ every piece as a photo; click to add      │
 *   └──────────────────────────────────────────────┴───────────────────────────────────────────┘
 *
 * Nothing opens on top of anything: the board, the piece and the wall keep their places and
 * sizes. Every change is heard at once (live input), undo/redo/reset work on everything, and
 * the saved tone is the same tone as before (saved tones, song tones, keys 1–9, the engine).
 */
import { scrap, stamp } from './cameo.js';
import { h, icon, toast, modal, confirmDialog, topModal } from './ui.js';
import { rig } from './rig.js';
import { did } from './rewards.js';
import { loadGear, gearName, gearInfo } from './gearspec.js';
import { saveTone, useTone, bySlot, SLOT_COUNT, SLOT_GELS, orderedGear, gelOf, TYPE_NAMES } from './tonelib.js';
import { buildTone, freshChoices } from './tonerecipes.js';
import { demoButton, stopDemo, demoPlaying } from './rigui.js';
import { realAmpStrip } from './realamps.js';
import { loadCaptures } from './captures.js';
import { gearItems, GEAR_CATS, gearPanel, micPanel, rigBoard, gearThumb, knobHelp, defaultSlot, CAB_RE } from './gearbench.js';

const MAX = { pre: 6, post: 6, rack: 4 };
let open = null;

/**
 * Opens the rig.
 *   tone      a tone to edit (your saved tone, a song's, a preset); null starts a new one
 *   kind      'guitar' | 'bass' for a new tone (default: what's plugged in)
 *   add       a gear key to put on the board straight away (from the Showroom)
 *   onSaved   (savedTone) after Save
 */
export async function openRig({ tone = null, kind = null, add = null, onSaved = null, title = null } = {}) {
  if (open) return open;
  const DB = await loadGear();
  await loadCaptures().catch(() => {});
  const items = gearItems(DB);
  const k = (tone && tone.kind) || kind || (rig.instrument === 'bass' || (rig.tone && rig.tone.kind === 'bass') ? 'bass' : 'guitar');
  const isNew = !tone;
  const fresh = () => {
    const t = buildTone(freshChoices(k));
    t.name = '';
    return t;
  };
  const start = tone ? JSON.parse(JSON.stringify(tone)) : fresh();
  start.gear = orderedGear(start).map((g, i) => ({ ...g, knobs: { ...(g.knobs || {}) }, order: i }));
  const R = {
    t: JSON.parse(JSON.stringify(start)),
    undo: [],
    redo: [],
    sel: Math.max(0, start.gear.findIndex((g) => g.slot === 'amp')),
    cat: k === 'bass' ? 'bassamps' : 'amps',
    q: '',
    replace: null, // index being swapped
    savedSnap: tone && tone.id ? snap(start) : null,
    saved: tone && tone.id ? tone : null,
    touched: false,
    heard: false,
    lastKnob: { key: '', t: 0 },
  };
  if (!R.t.name) R.t.name = '';
  // what you were playing through, to go back to if you leave without saving
  const before = { mode: rig.mode, toneId: rig.toneId, live: rig.liveTone ? { ...rig.liveTone } : null };

  // ---------------------------------------------------------- layout --
  const top = h('header.rr-top');
  const steps = h('nav.rr-steps', { 'aria-label': 'The steps' });
  const live = h('div.rr-live');
  const boardWrap = h('section.rr-board', { 'aria-label': 'Your rig' });
  const inspect = h('section.rr-inspect', { 'aria-label': 'The piece you picked' });
  const wall = h('section.rr-wall', { 'aria-label': 'Gear' });
  const room = h('div.rr', null, top, h('div.rr-sub', null, steps, live), boardWrap, h('div.rr-bottom', null, inspect, wall));
  const m = modal({ title: title || (isNew ? 'Create a tone' : `Edit ${start.name || 'tone'}`), body: room, dismissable: false, onClose: () => cleanup() });
  m.el.classList.add('rig-room');
  m.el.parentElement && m.el.parentElement.classList.add('rig-room-backdrop');
  m.el.querySelector(':scope > header')?.remove();
  open = m;

  // ------------------------------------------------------------ live --
  let liveT = 0;
  let liveTimer = 0;
  const gel = () => (R.t.slot ? SLOT_GELS[R.t.slot - 1] : gelOf(R.t));
  function hear() {
    const go = () => {
      liveT = performance.now();
      rig.setLiveTone({ ...R.t, name: R.t.name || 'New tone', fromLabel: isNew ? 'Creating a tone (not saved yet)' : 'Editing a tone (not saved yet)', gel: gel() });
    };
    clearTimeout(liveTimer);
    const since = performance.now() - liveT;
    if (since > 140) go();
    else liveTimer = setTimeout(go, 140 - since);
  }
  function restore() {
    try {
      if (before.mode === 'preset' && before.toneId) rig.setTone(before.toneId);
      else if (before.mode === 'live' && before.live) rig.setLiveTone(before.live);
      else if (before.mode === 'song') import('./song-auto.js').then((s) => s.refreshSongTone && s.refreshSongTone(true)).catch(() => {});
    } catch (_) {}
  }

  // ------------------------------------------------------ undo / redo --
  function snap(t) {
    return JSON.stringify({ name: t.name, gear: t.gear, autoCab: t.autoCab !== false, ir: t.ir || null, capture: t.capture || null, cabId: t.cabId || null });
  }
  function apply(s) {
    const o = JSON.parse(s);
    Object.assign(R.t, o);
  }
  /** Run a change. coalesce: knob drags on the same knob within a moment are one undo step. */
  function change(fn, { structure = true, coalesce = '', sound = true } = {}) {
    const now = performance.now();
    const merge = coalesce && R.lastKnob.key === coalesce && now - R.lastKnob.t < 900;
    if (!merge) {
      R.undo.push(snap(R.t));
      if (R.undo.length > 200) R.undo.shift();
      R.redo.length = 0;
    }
    R.lastKnob = { key: coalesce, t: now };
    fn();
    // same objects, re-sorted (open knobs keep pointing at the gear they turn)
    R.t.gear = orderedGear(R.t);
    R.t.gear.forEach((g, i) => (g.order = i));
    if (sound) hear();
    if (structure) drawAll();
    else drawTop();
  }
  function undo() {
    if (!R.undo.length) return;
    R.redo.push(snap(R.t));
    apply(R.undo.pop());
    R.lastKnob = { key: '', t: 0 };
    fixSel();
    hear();
    drawAll();
  }
  function redo() {
    if (!R.redo.length) return;
    R.undo.push(snap(R.t));
    apply(R.redo.pop());
    R.lastKnob = { key: '', t: 0 };
    fixSel();
    hear();
    drawAll();
  }
  function reset() {
    if (snap(R.t) === snap(start)) return;
    R.undo.push(snap(R.t));
    R.redo.length = 0;
    apply(snap(start));
    fixSel();
    hear();
    drawAll();
    toast({ title: 'Back to how it started', message: 'Undo brings your changes back.', kind: 'info', timeout: 2500 });
  }
  const fixSel = () => {
    if (R.sel >= R.t.gear.length) R.sel = R.t.gear.length - 1;
    if (R.sel < 0) R.sel = 0;
  };
  const dirty = () => (R.savedSnap ? snap(R.t) !== R.savedSnap : true);

  // ------------------------------------------------------------ gear ops --
  const count = (slot) => R.t.gear.filter((g) => g.slot === slot).length;
  const orders = (slot) => R.t.gear.filter((g) => g.slot === slot).map((g) => g.order || 0);
  const lastOrder = (slot) => Math.max(0, ...orders(slot));
  const firstOrder = (slot) => Math.min(1000, ...orders(slot));
  function addGear(it) {
    const g0 = R.t.gear;
    if (R.replace !== null && g0[R.replace]) {
      const at = R.replace;
      const old = g0[at];
      const slot = it.t === 'cab' ? 'cab' : it.t === 'amp' ? 'amp' : it.t === 'rack' ? 'rack' : old.slot === 'pre' || old.slot === 'post' ? old.slot : it.slot;
      change(() => {
        g0[at] = { slot, key: keyFor(it, old), knobs: it.t === 'cab' ? keepMic(old) : {}, order: old.order };
        if (it.t === 'cab') R.t.autoCab = false;
      });
      R.replace = null;
      R.sel = R.t.gear.findIndex((g) => g.key === keyFor(it, old));
      return drawAll();
    }
    if (it.t === 'amp' || it.t === 'cab') {
      const i = g0.findIndex((g) => g.slot === it.t);
      change(() => {
        const old = i >= 0 ? g0[i] : null;
        const g = { slot: it.t, key: keyFor(it, old), knobs: it.t === 'cab' && old ? keepMic(old) : {}, order: old ? old.order : it.t === 'amp' ? 50 : 70 };
        if (i >= 0) g0[i] = g;
        else g0.push(g);
        if (it.t === 'cab') R.t.autoCab = false;
        if (it.t === 'amp') R.t.capture = null;
      });
      R.sel = R.t.gear.findIndex((g) => g.slot === it.t);
      return drawAll();
    }
    let slot = it.slot;
    if (slot !== 'rack' && count(slot) >= MAX[slot]) slot = slot === 'pre' ? 'post' : 'pre';
    if (count(slot) >= MAX[slot]) return toast({ title: 'The board is full there', message: `Up to ${MAX.pre} pedals before the amp, ${MAX.post} in its loop and ${MAX.rack} rack units. Remove one first.`, kind: 'info' });
    change(() => g0.push({ slot, key: it.key, knobs: {}, order: lastOrder(slot) + 1 })); // at the end of its group
    R.sel = R.t.gear.map((g, i) => [g, i]).filter(([g]) => g.key === it.key && g.slot === slot).pop()[1];
    drawAll();
    boardWrap.querySelector(`.rb-piece[data-i="${R.sel}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  const keyFor = (it, old) => {
    if (it.t !== 'cab') return it.key;
    const m = old && CAB_RE.exec(old.key);
    return (m && (it.keys[`${m[2]}|${m[3]}`] || it.keys[`${m[2]}|Cone`])) || it.defaultKey;
  };
  const keepMic = (old) => {
    const o = {};
    for (const [n, v] of Object.entries((old && old.knobs) || {})) if (/^(Mic |Room Mic)/.test(n)) o[n] = v;
    return o;
  };
  function removeAt(i) {
    const g = R.t.gear[i];
    if (!g) return;
    change(() => R.t.gear.splice(i, 1));
    fixSel();
    drawAll();
    toast({ title: `Took off ${gearName(g.key)}`, kind: 'info', timeout: 2600, actions: [{ label: 'Undo', onClick: undo }] });
  }
  function move(i, dir) {
    // pedals walk along the board; crossing the amp moves them between in front and the loop
    const seq = R.t.gear.map((g, j) => ({ g, j })).filter(({ g }) => g.slot === 'pre' || g.slot === 'post' || g.slot === 'amp');
    const p = seq.findIndex((x) => x.j === i);
    const g = R.t.gear[i];
    if (!g || g.slot === 'rack') {
      const racks = R.t.gear.map((x, j) => ({ x, j })).filter(({ x }) => x.slot === 'rack');
      const r = racks.findIndex((x) => x.j === i);
      const o = racks[r + dir];
      if (!o) return;
      change(() => {
        const t = g.order;
        g.order = o.x.order;
        o.x.order = t;
      });
      R.sel = R.t.gear.indexOf(g);
      return drawAll();
    }
    const n = seq[p + dir];
    if (!n) return;
    change(() => {
      if (n.g.slot === 'amp') {
        const to = dir > 0 ? 'post' : 'pre';
        if (count(to) >= MAX[to]) return;
        g.order = to === 'post' ? firstOrder('post') - 1 : lastOrder('pre') + 1; // first in the loop, or last in front
        g.slot = to;
      } else {
        const t = g.order;
        g.order = n.g.order;
        n.g.order = t;
      }
    });
    R.sel = R.t.gear.indexOf(g);
    drawAll();
  }
  function toggle(i) {
    const g = R.t.gear[i];
    if (!g) return;
    change(() => (g.bypass = !g.bypass));
  }

  // ------------------------------------------------------------ drawing --
  function drawAll() {
    drawTop();
    drawBoard();
    drawInspect();
    drawWall();
  }

  const nameIn = h('input.input.rr-name', { placeholder: 'Name your tone', 'aria-label': 'Tone name', maxlength: '80' });
  nameIn.oninput = () => {
    R.t.name = nameIn.value;
    drawTop();
  };
  const undoB = h('button.icon-btn.rr-undo', { type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', html: UNDO });
  const redoB = h('button.icon-btn.rr-redo', { type: 'button', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', html: REDO });
  const resetB = h('button.btn.small.ghost.rr-reset', { type: 'button', html: `${icon('restore')}<span>Reset</span>`, title: isNew ? 'Back to the starting rig' : 'Back to the tone as it was when you opened it' });
  undoB.onclick = undo;
  redoB.onclick = redo;
  resetB.onclick = reset;
  const keySel = h('select.input.rr-key', { 'aria-label': 'Put it on a key', title: 'Press this number while you play to switch to the tone' });
  const fillKeys = () => {
    keySel.innerHTML = '';
    keySel.append(h('option', { value: '', text: 'No key' }));
    for (let n = 2; n <= SLOT_COUNT; n++) {
      const t = bySlot(n);
      const mine = t && R.saved && t.id === R.saved.id;
      keySel.append(h('option', { value: String(n), text: `Key ${n}${t && !mine ? ` (replaces ${t.name})` : ''}`, selected: R.t.slot === n ? true : null }));
    }
  };
  keySel.onchange = () => {
    R.t.slot = keySel.value ? Number(keySel.value) : null;
    drawTop();
  };
  const saveB = h('button.btn.primary.rr-save', { type: 'button' });
  saveB.onclick = () => save();
  const closeB = h('button.icon-btn.rr-close', { type: 'button', title: 'Close', 'aria-label': 'Close', html: icon('x') });
  closeB.onclick = () => tryClose();
  const demo = h('span.rr-demo');
  const guide = isNew ? h('button.btn.small.ghost.rr-guide', { type: 'button', text: 'Step by step instead', title: 'Answer a few questions, one at a time, and Stagehand builds the rig' }) : '';
  if (guide)
    guide.onclick = () => {
      m.close();
      import('./tonewizard.js').then((w) => w.openStepByStep({ kind: k }));
    };
  top.append(h('span.rr-title', { text: isNew ? 'Create a tone' : 'Edit tone' }), nameIn, h('span.rr-kind', { text: k === 'bass' ? 'Bass' : 'Guitar' }), demo, guide, h('span.grow'), undoB, redoB, resetB, keySel, saveB, closeB);
  nameIn.value = R.t.name || '';
  // one button for the whole visit: it plays the rig as it is when pressed (R.t is edited in place)
  const demoB = demoButton(R.t, 'rigroom', { label: 'Demo riff', cls: 'rr-demo-btn' });
  demoB.addEventListener('click', () => ((R.heard = true), drawSteps()));
  demo.append(demoB);
  R.t.slot = R.t.slot || null;
  fillKeys();

  function drawTop() {
    undoB.disabled = !R.undo.length;
    redoB.disabled = !R.redo.length;
    resetB.disabled = snap(R.t) === snap(start);
    const d = dirty();
    saveB.textContent = R.saved ? (d || (R.t.slot || null) !== (R.saved.slot || null) ? 'Save changes' : 'Saved') : 'Save tone';
    saveB.disabled = !!R.saved && !d && (R.t.slot || null) === (R.saved.slot || null);
    if (nameIn.value !== (R.t.name || '') && document.activeElement !== nameIn) nameIn.value = R.t.name || '';
    drawSteps();
  }

  function drawSteps() {
    const has = (s) => R.t.gear.some((g) => g.slot === s);
    const list = [
      ['Amp', has('amp'), () => ((R.cat = k === 'bass' ? 'bassamps' : 'amps'), selectSlot('amp'))],
      ['Cabinet', has('cab'), () => ((R.cat = 'cabs'), selectSlot('cab'))],
      ['Pedals', has('pre') || has('post') || has('rack'), () => ((R.cat = 'drive'), drawWall())],
      ['Knobs', R.touched, () => selectSlot('amp')],
      ['Hear it', R.heard, () => demoB.click()],
      ['Save', !!R.saved && !dirty(), () => (R.t.name ? save() : nameIn.focus())],
    ];
    steps.innerHTML = '';
    list.forEach(([label, done, go], i) => {
      const b = h(`button.rr-step${done ? '.done' : ''}`, { type: 'button', title: done ? `${label}: done` : `Next: ${label}` }, h('b', { text: done ? '✓' : String(i + 1) }), h('span', { text: label }));
      b.onclick = go;
      steps.append(b);
    });
    const next = steps.querySelector('.rr-step:not(.done)');
    if (next) next.classList.add('next');
  }
  const selectSlot = (slot) => {
    const i = R.t.gear.findIndex((g) => g.slot === slot);
    if (i >= 0) R.sel = i;
    drawBoard();
    drawInspect();
    drawWall();
  };

  let board = null;
  function drawBoard() {
    const sx = boardWrap.scrollLeft;
    if (board) board.dispose();
    board = rigBoard(R.t, {
      selected: R.sel,
      kind: k,
      onPick: (i) => {
        R.sel = i;
        R.replace = null;
        drawBoard();
        drawInspect();
      },
      onBypass: (i) => toggle(i),
    });
    const f = document.activeElement && document.activeElement.closest && document.activeElement.closest('.rb-piece');
    const refocus = f && boardWrap.contains(f) ? [f.dataset.i, document.activeElement.classList.contains('rb-switch') ? '.rb-switch' : '.rb-art'] : null;
    boardWrap.innerHTML = '';
    boardWrap.append(board);
    boardWrap.scrollLeft = sx;
    if (refocus) board.querySelector(`.rb-piece[data-i="${refocus[0]}"] ${refocus[1]}`)?.focus({ preventScroll: true });
  }

  let panel = null;
  function drawInspect() {
    if (panel && panel.dispose) panel.dispose();
    panel = null;
    inspect.innerHTML = '';
    const g = R.t.gear[R.sel];
    if (!g) {
      inspect.append(h('div.rr-empty', null, h('h3', { text: 'Pick an amp to start' }), h('p', { text: 'Everything you can use is on the wall to the right. Click a piece to put it on your board.' })));
      return;
    }
    const kindName = g.slot === 'pre' ? 'Pedal, before the amp' : g.slot === 'post' ? 'Pedal, in the amp’s loop' : TYPE_NAMES[g.slot] || 'Pedal';
    const head = h('div.rr-ihead');
    const title = h('div.rr-ititle', null, h('small', { text: kindName }), h('h3', { text: g.slot === 'cab' ? cabName(g.key) : gearName(g.key) }));
    head.append(title, h('span.grow'));
    if (g.slot !== 'amp' && g.slot !== 'cab') {
      const onoff = h(`button.btn.small.rr-onoff${g.bypass ? '' : '.on'}`, { type: 'button', 'aria-pressed': String(!g.bypass), html: `<span class="rr-led"></span><span>${g.bypass ? 'Off' : 'On'}</span>`, title: 'Stomp it on or off' });
      onoff.onclick = () => toggle(R.sel);
      const l = h('button.btn.small.ghost', { type: 'button', text: '◀ Earlier', title: 'Move it earlier in the chain' });
      const r = h('button.btn.small.ghost', { type: 'button', text: 'Later ▶', title: 'Move it later in the chain' });
      l.onclick = () => move(R.sel, -1);
      r.onclick = () => move(R.sel, 1);
      head.append(onoff, l, r);
    }
    const swap = h(`button.btn.small.soft${R.replace === R.sel ? '.on' : ''}`, { type: 'button', text: R.replace === R.sel ? 'Pick its replacement →' : 'Swap', title: 'Pick another piece on the wall to take its place' });
    swap.onclick = () => {
      R.replace = R.replace === R.sel ? null : R.sel;
      R.cat = catOf(g);
      drawInspect();
      drawWall();
    };
    head.append(swap);
    if (g.slot !== 'amp') {
      const rm = h('button.icon-btn', { type: 'button', title: 'Take it off the board', 'aria-label': 'Remove', html: icon('trash') });
      rm.onclick = () => removeAt(R.sel);
      head.append(rm);
    }
    inspect.append(head);
    const body = h('div.rr-ibody');
    if (g.slot === 'cab') {
      const fam = items.find((it) => it.t === 'cab' && it.keys && Object.values(it.keys).includes(g.key));
      const auto = R.t.autoCab !== false && !R.t.ir;
      const mode = h('div.gseg.rr-cabmode', { role: 'group', 'aria-label': 'Cabinet sound' });
      const a = h('button', { type: 'button', text: 'Recorded cabinet', 'aria-pressed': String(auto), title: 'A recording of a real cabinet matched to your amp (fixed mic)' });
      const b = h('button', { type: 'button', text: 'Mic it yourself', 'aria-pressed': String(!auto), title: 'This cabinet, with a mic you place yourself' });
      a.onclick = () => !auto && change(() => (R.t.autoCab = true));
      b.onclick = () => auto && change(() => (R.t.autoCab = false));
      mode.append(a, b);
      if (R.t.ir) body.append(h('p.gb-reason', { text: `Your own cab file is in use (${String(R.t.ir).split(/[\\/]/).pop()}). Remove it in Tones to use this cabinet.` }));
      const pic = h('div.rr-cabpic', null, gearThumb(g.key, 'cab', { full: true }));
      body.append(h('div.rr-cab', null, pic, h('div.rr-cabctl', null, mode, micPanel(g, fam, {
        disabled: auto || !!R.t.ir,
        reason: auto ? 'You’re hearing a recorded cabinet. Choose Mic it yourself to place the mic.' : '',
        on: (p, final) => change(() => {
          if (p.key) g.key = p.key;
          if (p.knobs) g.knobs = p.knobs;
          R.touched = true;
        }, { structure: !!p.key, coalesce: p.key ? '' : 'mic' }),
      }))));
    } else {
      if (g.slot === 'amp' && !g.bypass) body.append(realAmpStrip(R.t, () => change(() => {}, { structure: true })));
      panel = gearPanel(g, {
        gel: g.slot === 'amp' ? '#ff6b3d' : g.slot === 'rack' ? '#33c8e0' : '#ff4d8d',
        onKnob: (key, v) => {
          change(() => {
            g.knobs = { ...(g.knobs || {}), [key]: v };
            R.touched = true;
          }, { structure: false, coalesce: `${R.sel}:${key}` });
        },
      });
      body.append(panel);
    }
    inspect.append(body);
  }

  const catOf = (g) => {
    if (g.slot === 'amp') return /^Bass_|^DI_/.test(g.key) ? 'bassamps' : 'amps';
    if (g.slot === 'cab') return 'cabs';
    const it = items.find((x) => x.key === g.key);
    return it ? it.cat : 'drive';
  };
  const cabName = (key) => (items.find((it) => it.t === 'cab' && Object.values(it.keys || {}).includes(key)) || { name: gearName(key) }).name;

  const wallTabs = h('div.rr-shelves', { role: 'tablist', 'aria-label': 'Shelves' });
  const wallFind = h('input.input.rr-find', { type: 'search', placeholder: 'Find gear (e.g. fuzz, plexi, echo)', 'aria-label': 'Find gear' });
  const onlyMine = h('label.rr-only', null, h('input', { type: 'checkbox', checked: true }), h('span', { text: k === 'bass' ? 'Bass gear first' : 'Guitar gear first' }));
  const wallGrid = h('div.rr-grid');
  const wallHint = h('small.rr-wallhint');
  wall.append(h('div.rr-wallhead', null, wallFind, onlyMine), wallTabs, wallHint, wallGrid);
  wallFind.oninput = () => ((R.q = wallFind.value.trim().toLowerCase()), drawWall());
  onlyMine.querySelector('input').onchange = drawWall;

  function drawWall() {
    wallTabs.innerHTML = '';
    for (const c of GEAR_CATS) {
      const b = h('button.rr-shelf', { type: 'button', role: 'tab', 'aria-selected': String(R.cat === c.id && !R.q), title: c.hint, text: c.label });
      b.onclick = () => {
        R.cat = c.id;
        R.q = '';
        wallFind.value = '';
        drawWall();
      };
      wallTabs.append(b);
    }
    const mineFirst = onlyMine.querySelector('input').checked;
    const words = R.q.split(/\s+/).filter(Boolean);
    let list = items.filter((it) => (words.length ? words.every((w) => `${it.name} ${it.sub} ${it.key} ${GEAR_CATS.find((c) => c.id === it.cat).label}`.toLowerCase().includes(w)) : it.cat === R.cat));
    const mine = (it) => (k === 'bass') === !!it.bass;
    if (mineFirst) list = [...list.filter(mine), ...list.filter((it) => !mine(it))];
    const inUse = new Set(R.t.gear.map((g) => (g.slot === 'cab' ? (CAB_RE.exec(g.key) || [])[1] || g.key : g.key)));
    const rep = R.replace !== null ? R.t.gear[R.replace] : null;
    wallHint.textContent = rep ? `Pick what replaces ${gearName(rep.key)}` : words.length ? `${list.length} found` : `${GEAR_CATS.find((c) => c.id === R.cat).hint}: click one to ${R.cat === 'amps' || R.cat === 'bassamps' ? 'use it as your amp' : R.cat === 'cabs' ? 'use it as your cabinet' : 'put it on your board'}`;
    const sy = wallGrid.scrollTop;
    wallGrid.innerHTML = '';
    for (const it of list) {
      const used = inUse.has(it.key);
      const card = h(`button.rr-card${used ? '.used' : ''}${mine(it) ? '' : '.other'}`, { type: 'button', title: `${it.name}${it.bass ? ' (bass)' : ''}${used ? ' · on your board' : ''}` }, h('span.rr-card-art', null, gearThumb(it.key === it.defaultKey ? it.key : it.key, it.slot)), h('span.rr-card-name', { text: it.name }), used ? h('span.rr-card-badge', { text: 'In use' }) : it.bass && k !== 'bass' ? h('span.rr-card-badge.dim', { text: 'Bass' }) : '');
      card.onclick = () => addGear(it);
      wallGrid.append(card);
    }
    if (!list.length) wallGrid.append(h('p.rr-none', { text: 'Nothing matches.' }));
    wallGrid.scrollTop = words.length ? 0 : sy;
  }

  // the live strip + the pulse along the cables
  const liveDot = h('span.rr-live-dot');
  const liveText = h('span');
  const meter = h('i');
  live.append(liveDot, liveText, h('span.rr-meter', null, meter));
  const showLive = () => {
    live.classList.toggle('off', !rig.on);
    liveText.textContent = rig.on ? `Play your ${k}: you hear every change as you make it` : `Plug in your ${k} to hear changes as you make them, or press Demo riff`;
  };
  showLive();
  rig.addEventListener('change', showLive);
  let smooth = 0;
  const meterT = setInterval(() => {
    let l = rig.on ? rig.levels().input : 0;
    if (demoPlaying() === 'rigroom') l = Math.max(l, 0.12 + 0.06 * Math.sin(performance.now() / 160));
    const target = Math.min(1, Math.sqrt(l) * 2.2);
    smooth = target > smooth ? target : smooth * 0.86;
    if (smooth > 0.15 && rig.on) R.heard = true;
    meter.style.width = `${Math.round(smooth * 100)}%`;
    if (board) board.setLevel(smooth);
  }, 50);

  // ------------------------------------------------------------- saving --
  async function save() {
    const name = (R.t.name || '').trim();
    if (!name) {
      nameIn.focus();
      nameIn.classList.add('need');
      setTimeout(() => nameIn.classList.remove('need'), 1600);
      return toast({ title: 'Name it first', message: 'Type a name at the top, then Save.', kind: 'info', timeout: 2500 });
    }
    try {
      const slot = R.t.slot || null;
      const t = await saveTone({ id: R.saved ? R.saved.id : undefined, name, kind: k, gear: R.t.gear, slot, from: (tone && tone.from) || null, ir: R.t.ir || null, autoCab: R.t.autoCab !== false, capture: R.t.capture || null, cabId: R.t.cabId || null });
      R.saved = t;
      R.savedSnap = snap(R.t);
      did('tone-make');
      useTone(t.id);
      fillKeys();
      drawTop();
      // 4.9: the inspection sticker slapped on the board
      stamp(boardWrap, scrap(Math.random() < 0.75 ? 'engineers-inspection' : 'eq-sign', { cls: 'saved-stamp' }));
      toast({ title: `Saved “${t.name}”`, message: t.slot ? `On key ${t.slot}: press ${t.slot} while you play.` : 'It’s in Tones › Your tones.', kind: 'ok', timeout: 3000 });
      if (onSaved) onSaved(t);
    } catch (err) {
      toast({ title: 'Couldn’t save the tone', message: err.message, kind: 'err' });
    }
  }
  async function tryClose() {
    if (dirty() && (R.saved || R.undo.length)) {
      const ok = await confirmDialog({ title: R.saved ? 'Close without saving your changes?' : 'Close without saving?', message: R.saved ? 'Your last changes aren’t saved. The tone stays as you last saved it.' : 'This tone isn’t saved yet. It’s gone when you close.', confirm: 'Close', danger: true });
      if (!ok) return;
    }
    m.close();
  }
  function cleanup() {
    open = null;
    clearInterval(meterT);
    clearTimeout(liveTimer);
    rig.removeEventListener('change', showLive);
    document.removeEventListener('keydown', keys, true);
    if (board) board.dispose();
    if (panel && panel.dispose) panel.dispose();
    if (demoPlaying() === 'rigroom') stopDemo();
    if (R.saved) useTone(R.saved.id); // the tone as saved (unsaved tweaks after a save are dropped)
    else restore();
  }
  function keys(e) {
    if (topModal() !== m) return; // a question on top of the rig
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !typing) (e.preventDefault(), e.stopPropagation(), e.shiftKey ? redo() : undo());
    else if (ctrl && e.key.toLowerCase() === 'y' && !typing) (e.preventDefault(), e.stopPropagation(), redo());
    else if (ctrl && e.key.toLowerCase() === 's') (e.preventDefault(), e.stopPropagation(), save());
    else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), R.replace !== null ? ((R.replace = null), drawInspect(), drawWall()) : tryClose());
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && R.t.gear[R.sel] && R.t.gear[R.sel].slot !== 'amp' && !e.target.closest('.rknob')) (e.preventDefault(), removeAt(R.sel));
  }
  // on the document: a click on the board rebuilds it, and focus falls back to the page
  document.addEventListener('keydown', keys, true);
  room.tabIndex = -1;

  if (add) {
    const it = items.find((x) => x.key === add || (x.keys && (x.key === add || Object.values(x.keys).includes(add))));
    if (it) {
      R.cat = it.cat;
      addGear(it);
      R.undo.length = 0;
    }
  }
  hear();
  drawAll();
  setTimeout(() => (isNew && !add ? nameIn.focus() : room.focus()), 40);
  return m;
}

const UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const REDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>';

export { knobHelp, defaultSlot, gearInfo };
