/**
 * 4.5: the Drop console, one control for every place the Drop shows (Play page, highway
 * Master Settings). Replaces the pedal photo that sat in the Play card (the user: it looked
 * cool but was in the wrong place) and the two different sets of chips.
 *
 *   ┌ DROP ─────────────────────── ● [ footswitch ] ┐
 *   │  −2   sounds like D Standard                   │  the readout: what you hear, big
 *   │  status line (working / not needed / …)        │
 *   │  [−1][−2][−3][−4][−5][−6][−7][OCT]  ‹ ›        │  steps; ← → keys nudge
 *   │  (Match the song −2)  (Hold to drop)           │
 *   │  Your guitar is in [E Standard ▾]              │
 *   └────────────────────────────────────────────────┘
 *
 * It reads and writes rig.drop only (the same state the D key and the engine use), and
 * updates itself in place when the Drop changes anywhere (no rebuild, no flicker).
 *
 * 4.8: two looks, the player's choice (the small button in the head switches, everywhere):
 *  - 'pedal' (default): the real DigiTech Drop photo. The knob sets how far down (drag, scroll,
 *    click, or the lights), the footswitch on the photo (or the round button) turns it on and
 *    goes down when it does, the MOMENTARY toggle is Hold to drop. The readout sits beside it.
 *  - 'console': the 4.5 panel above.
 * dropSection() folds either one under a head that always shows the state (the highway uses it).
 */
import { h } from './ui.js';
import { rig } from './rig.js';
import { did } from './rewards.js';
import { tuningName, myTuning, setMyTuning, MY_TUNINGS, MY_TUNINGS_BASS } from './tuning.js';

export const DROP_STEPS = [1, 2, 3, 4, 5, 6, 7, 12];

const LOOK_KEY = 'stagehand.dropLook';
/** 'pedal' (the photo) or 'console' (the panel). */
export function dropLook() {
  try {
    return localStorage.getItem(LOOK_KEY) === 'console' ? 'console' : 'pedal';
  } catch (_) {
    return 'pedal';
  }
}
export function setDropLook(v) {
  try {
    localStorage.setItem(LOOK_KEY, v === 'console' ? 'console' : 'pedal');
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('stagehand:drop-look', { detail: dropLook() }));
}
/** The Drop is doing something right now (on, and dropping). */
export const dropInUse = () => !!rig.drop.on && rig.dropAmount() > 0;

// where things are on the photo (art/gear/full/digitech-drop.avif, 546 x 931)
const PHOTO = { w: 546, h: 931, src: 'art/gear/full/digitech-drop.avif' };
const KNOB = { x: 270, y: 147, r: 75 };
// the lights under the knob: 1 to 7, OCT, OCT+DRY (the last isn't on Stagehand's Drop)
const LEDS = [[84, 212], [131, 240], [177, 266], [222, 295], [269, 322], [313, 350], [360, 379], [405, 408], [462, 408]];
const TOGGLE = { x: 435, y: 250, r: 23 };
const STATUS = { x: 270, y: 675 };
const SWITCH = { x: 270, y: 795, r: 40 };
const px = (x) => `${((x / PHOTO.w) * 100).toFixed(2)}%`;
const py = (y) => `${((y / PHOTO.h) * 100).toFixed(2)}%`;
const ledAngle = (i) => (Math.atan2(LEDS[i][1] - KNOB.y, LEDS[i][0] - KNOB.x) * 180) / Math.PI;
const OFF_ANGLE = ledAngle(0) + 28; // knob turned all the way down, past 1

/** What your instrument sounds like with the Drop at `amt` semitones. */
export function soundsLike(amt, kind = 'guitar') {
  if (!amt) return tuningName(myTuning(kind), kind);
  if (amt >= 12) return `${tuningName(myTuning(kind), kind)}, an octave down`;
  return tuningName(myTuning(kind).map((x) => x - amt), kind);
}

/**
 * @param {object} o
 * @param {'guitar'|'bass'} [o.kind]
 * @param {boolean} [o.compact] the highway's narrower version
 * @param {Node[]} [o.extra] more rows (the highway adds what the song needs + the tuning guide)
 * @param {Function} [o.onTuningChange] after "your guitar is in" changes
 */
export function dropConsole(opts = {}) {
  const { kind = 'guitar', compact = false, extra = [], onTuningChange = null } = opts;
  const look = opts.look || dropLook();
  const el = h(`section.dc${compact ? '.compact' : ''}${look === 'pedal' ? '.dc-pedal' : ''}`, { 'aria-label': 'Drop tuning' });
  el.dataset.look = look;
  const led = h('span.dc-led', { 'aria-hidden': 'true' });
  const foot = h('button.dc-foot', { type: 'button', title: 'Drop on or off (D)', 'aria-label': 'Drop on or off' }, h('span.dc-foot-cap'));
  const amtEl = h('b.dc-amt');
  const like = h('span.dc-like');
  const line = h('small.dc-line');
  const warn = h('small.dc-warn', { hidden: true });
  const steps = h('div.dc-steps', { role: 'radiogroup', 'aria-label': 'How far down', tabindex: '0' });
  const stepBtns = DROP_STEPS.map((st) => {
    const b = h('button.dc-step', { type: 'button', role: 'radio', text: st === 12 ? 'OCT' : `−${st}`, title: `Drop ${st === 12 ? 'an octave' : `${st} semitone${st > 1 ? 's' : ''}`}: sounds like ${soundsLike(st, kind)}` });
    b.onclick = () => set({ st, match: false, on: true });
    steps.append(b);
    return b;
  });
  const nudge = (d) => {
    const cur = rig.drop.on ? rig.dropAmount() : 0;
    const i = DROP_STEPS.indexOf(cur);
    const next = i < 0 ? (d > 0 ? 0 : DROP_STEPS.length - 1) : Math.max(-1, Math.min(DROP_STEPS.length - 1, i + d));
    if (next < 0) return set({ on: false, match: false });
    set({ st: DROP_STEPS[next], match: false, on: true });
  };
  const down = h('button.dc-nudge', { type: 'button', text: '‹', title: 'Less (←)', 'aria-label': 'Drop less' });
  const up = h('button.dc-nudge', { type: 'button', text: '›', title: 'More (→)', 'aria-label': 'Drop more' });
  down.onclick = () => nudge(-1);
  up.onclick = () => nudge(1);
  steps.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') (e.preventDefault(), nudge(1));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') (e.preventDefault(), nudge(-1));
  });
  const match = h('button.dc-pill.dc-match', { type: 'button', title: 'Follow each song’s tuning automatically' });
  match.onclick = () => (rig.drop.on && rig.drop.match ? set({ match: false, st: rig.dropAmount() || rig.drop.st, on: !!rig.dropAmount() }) : set({ match: true, on: true }));
  const hold = h('button.dc-pill.dc-hold', { type: 'button', text: 'Hold to drop', title: 'Momentary: the footswitch only drops while you hold it' });
  hold.onclick = () => set({ momentary: !rig.drop.momentary });
  // the footswitch: a click toggles; in momentary mode it drops only while held
  let held = false;
  let prior = false;
  const engage = () => {
    if (held || !rig.drop.momentary) return;
    held = true;
    prior = rig.drop.on;
    window.addEventListener('blur', release);
    set({ on: true });
  };
  const release = () => {
    if (!held) return;
    held = false;
    window.removeEventListener('blur', release);
    set({ on: prior });
  };
  foot.onclick = () => {
    if (rig.drop.momentary) return;
    set({ on: !rig.drop.on });
    if (pedal) pedal.stomp();
  };
  foot.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !rig.drop.momentary) return;
    foot.setPointerCapture(e.pointerId);
    engage();
    e.preventDefault();
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) foot.addEventListener(t, release);
  // your instrument's own tuning
  const mine = h('select.input.dc-mine', { 'aria-label': `Your ${kind} is tuned to` });
  const fill = () => {
    mine.innerHTML = '';
    const cur = myTuning(kind).join(',');
    const opts = kind === 'bass' ? MY_TUNINGS_BASS : MY_TUNINGS;
    for (const o of opts) mine.append(h('option', { value: o.join(','), text: tuningName(o, kind), selected: o.join(',') === cur ? true : null }));
    if (!opts.some((o) => o.join(',') === cur)) mine.append(h('option', { value: cur, text: tuningName(myTuning(kind), kind), selected: true }));
  };
  fill();
  mine.onchange = () => {
    setMyTuning(kind, mine.value.split(',').map(Number));
    if (rig.songTuning) rig.setSongTuning(rig.songTuning, kind, rig.songCents || 0);
    if (onTuningChange) onTuningChange();
    update();
  };

  // switch between the photo and the panel (everywhere the Drop shows)
  const lookBtn = h('button.dc-look', { type: 'button', text: look === 'pedal' ? 'Panel view' : 'Pedal view', title: look === 'pedal' ? 'Show the Drop as a simple panel' : 'Show the Drop as the real pedal' });
  lookBtn.onclick = () => setDropLook(look === 'pedal' ? 'console' : 'pedal');
  const lcd = h('div.dc-lcd', { 'aria-live': 'polite' }, amtEl, h('div.dc-lcd-text', null, like, line, warn));
  const mineRow = h('label.dc-mine-row', null, h('span', { text: `Your ${kind} is in` }), mine);
  let pedal = null;
  if (look === 'pedal') {
    pedal = pedalPhoto({ kind, set, nudge, engage, release, isHeld: () => held });
    el.append(
      h('div.dc-head', null, h('span.dc-name', { text: 'Drop' }), led, h('span.grow'), foot),
      h('div.dc-body', null, pedal.el, h('div.dc-side', null, lcd, h('div.dc-row', null, match, hold), ...extra, mineRow, h('div.dc-look-row', null, lookBtn)))
    );
  } else {
    el.append(
      h('div.dc-head', null, h('span.dc-name', { text: 'Drop' }), led, h('span.grow'), foot),
      lcd,
      h('div.dc-rail', null, down, steps, up),
      h('div.dc-row', null, match, hold),
      ...extra,
      mineRow,
      h('div.dc-look-row', null, lookBtn)
    );
  }

  function set(patch) {
    rig.setDrop(patch);
    if (rig.drop.on) did('drop');
    update();
  }

  function update() {
    const d = rig.drop;
    const amt = d.on ? rig.dropAmount() : 0;
    const ds = rig.dropStatus();
    el.classList.toggle('on', !!d.on);
    el.classList.toggle('idle', ds.state === 'idle');
    el.classList.toggle('working', !!d.on && amt > 0);
    foot.setAttribute('aria-pressed', String(!!d.on));
    amtEl.textContent = !d.on ? 'OFF' : amt >= 12 ? 'OCT' : amt ? `−${amt}` : '0';
    like.textContent = d.on ? (amt ? `Sounds like ${soundsLike(amt, kind)}` : 'On, nothing to drop for this song') : `Your ${kind}: ${soundsLike(0, kind)}`;
    line.textContent = ds.line || '';
    warn.hidden = !(ds.state === 'on' && ds.warn);
    warn.textContent = ds.warn || '';
    for (const [i, b] of stepBtns.entries()) {
      const on = !!d.on && amt === DROP_STEPS[i];
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('auto', on && !!d.match);
    }
    const songSt = rig.dropSong;
    match.textContent = songSt ? `Match the song (−${songSt})` : 'Match the song';
    match.setAttribute('aria-pressed', String(!!d.on && !!d.match));
    hold.setAttribute('aria-pressed', String(!!d.momentary));
    if (pedal) pedal.update(amt);
  }
  update();
  // follow changes made anywhere (the D key, the other console, a song asking for it)
  const onDrop = () => {
    if (!el.isConnected) {
      if (el._shown) rig.removeEventListener('drop', onDrop); // gone for good
      return;
    }
    el._shown = true;
    update();
  };
  rig.addEventListener('drop', onDrop);
  const onLook = () => {
    if (!el.isConnected) {
      if (el._shown) window.removeEventListener('stagehand:drop-look', onLook);
      return;
    }
    if (dropLook() === look) return;
    window.removeEventListener('stagehand:drop-look', onLook);
    rig.removeEventListener('drop', onDrop);
    const next = dropConsole({ ...opts, look: dropLook() });
    Object.assign(next.dataset, { ...el.dataset, look: dropLook() });
    el.replaceWith(next);
  };
  window.addEventListener('stagehand:drop-look', onLook);
  el.update = update;
  return el;
}

/**
 * The DigiTech Drop photo with working controls laid on it: the knob (drag up/down, scroll,
 * click for one more, arrow keys), the nine lights (click one to go there), the MOMENTARY
 * toggle (Hold to drop) and the footswitch (on/off; held down in momentary mode).
 */
function pedalPhoto({ kind, set, nudge, engage, release, isHeld }) {
  const el = h('div.dp', { style: { aspectRatio: `${PHOTO.w} / ${PHOTO.h}` } });
  const img = h('img.dp-img', { src: PHOTO.src, alt: 'DigiTech Drop pedal', draggable: 'false', decoding: 'async' });
  const knob = h('button.dp-knob', { type: 'button', role: 'slider', 'aria-label': 'How far down', 'aria-valuemin': '0', 'aria-valuemax': '12', title: 'Turn: drag up or down, scroll, or click for one more (← → keys)', style: { left: px(KNOB.x - KNOB.r), top: py(KNOB.y - KNOB.r), width: px(KNOB.r * 2) } }, h('i.dp-pointer'));
  const leds = LEDS.map(([x, y], i) => {
    const st = DROP_STEPS[i];
    const b = h('button.dp-led', { type: 'button', style: { left: px(x), top: py(y) }, tabindex: '-1', title: i === 8 ? 'Octave plus dry: not on Stagehand’s Drop' : `Drop ${st === 12 ? 'an octave' : st}: sounds like ${soundsLike(st, kind)}`, 'aria-label': i === 8 ? 'Octave plus dry (not available)' : `Drop ${st === 12 ? 'an octave' : st}` });
    if (i === 8) b.disabled = true;
    else b.onclick = () => set({ st, match: false, on: true });
    return b;
  });
  const toggle = h('button.dp-toggle', { type: 'button', title: 'MOMENTARY: on = the Drop works only while you hold the footswitch', 'aria-label': 'Momentary', style: { left: px(TOGGLE.x - TOGGLE.r * 1.6), top: py(TOGGLE.y - TOGGLE.r * 3.4), width: px(TOGGLE.r * 3.2), height: py(TOGGLE.r * 6.8) } });
  // the toggle's bat: the photo's own (leaning to OFF), flipped over for ON
  const bat = h('span.dp-photo.dp-bat', { style: { clipPath: `circle(${px(TOGGLE.r)} at ${px(TOGGLE.x)} ${py(TOGGLE.y)})`, transformOrigin: `${px(TOGGLE.x)} ${py(TOGGLE.y)}`, backgroundImage: `url('${PHOTO.src}')` } });
  toggle.onclick = () => set({ momentary: !rig.drop.momentary });
  const status = h('i.dp-status', { style: { left: px(STATUS.x), top: py(STATUS.y) } });
  // the footswitch: a copy of the photo cut to the switch, so the real switch goes down
  const sw = h('span.dp-photo.dp-sw', { style: { clipPath: `circle(${px(SWITCH.r)} at ${px(SWITCH.x)} ${py(SWITCH.y)})`, transformOrigin: `${px(SWITCH.x)} ${py(SWITCH.y)}`, backgroundImage: `url('${PHOTO.src}')` } });
  const swBtn = h('button.dp-switch', { type: 'button', title: 'Footswitch: Drop on or off (D)', 'aria-label': 'Footswitch', style: { left: px(SWITCH.x - SWITCH.r * 1.5), top: py(SWITCH.y - SWITCH.r * 1.5), width: px(SWITCH.r * 3) } });
  el.append(img, sw, bat, status, ...leds, knob, toggle, swBtn);

  let stompT = 0;
  const stomp = (down = null) => {
    clearTimeout(stompT);
    if (down === null) {
      el.classList.add('stomp');
      stompT = setTimeout(() => el.classList.remove('stomp'), 170);
    } else el.classList.toggle('stomp', down);
  };
  swBtn.onclick = () => {
    if (rig.drop.momentary) return;
    set({ on: !rig.drop.on });
    stomp();
  };
  swBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !rig.drop.momentary) return;
    swBtn.setPointerCapture(e.pointerId);
    engage();
    stomp(true);
    e.preventDefault();
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'])
    swBtn.addEventListener(t, () => {
      if (!isHeld()) return;
      release();
      stomp(false);
    });

  // the knob: drag up/down (about 26 px a step), scroll, click, keys
  let drag = null;
  knob.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    knob.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, x: e.clientX, moved: 0 };
    e.preventDefault();
    knob.focus({ preventScroll: true });
  });
  knob.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const d = drag.y - e.clientY + (e.clientX - drag.x);
    const steps = Math.trunc(d / 26);
    if (steps) {
      for (let i = 0; i < Math.abs(steps); i++) nudge(Math.sign(steps));
      drag.y = e.clientY;
      drag.x = e.clientX;
      drag.moved += Math.abs(steps);
    }
  });
  const endDrag = () => {
    if (!drag) return;
    if (!drag.moved) {
      // a click: one more; from OCT round to −1
      if (rig.drop.on && rig.dropAmount() >= 12) set({ st: 1, match: false, on: true });
      else nudge(1);
    }
    drag = null;
  };
  knob.addEventListener('pointerup', endDrag);
  knob.addEventListener('pointercancel', () => (drag = null));
  knob.addEventListener('wheel', (e) => {
    e.preventDefault();
    nudge(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  knob.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') (e.preventDefault(), nudge(1));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') (e.preventDefault(), nudge(-1));
  });
  knob.onclick = (e) => e.detail === 0 && nudge(1); // Enter / Space

  function update(amt) {
    const d = rig.drop;
    const i = d.on ? DROP_STEPS.indexOf(amt) : -1;
    // the knob stays where it was set while the Drop is off (as a real one does)
    const at = d.on ? i : DROP_STEPS.indexOf(d.match ? rig.dropSong : d.st);
    knob.style.setProperty('--turn', `${at < 0 ? OFF_ANGLE : ledAngle(at)}deg`);
    knob.setAttribute('aria-valuenow', String(d.on ? amt : 0));
    knob.setAttribute('aria-valuetext', d.on ? (amt ? `Down ${amt >= 12 ? 'an octave' : amt}` : 'Nothing to drop') : 'Off');
    // a real Drop lights the setting whether or not it's on; dim when off
    for (const [k, b] of leds.entries()) {
      b.classList.toggle('lit', k === at);
      b.classList.toggle('auto', k === at && !!d.on && !!d.match);
    }
    el.classList.toggle('on', !!d.on);
    el.classList.toggle('working', !!d.on && amt > 0);
    el.classList.toggle('momentary', !!d.momentary);
    toggle.setAttribute('aria-pressed', String(!!d.momentary));
    swBtn.setAttribute('aria-pressed', String(!!d.on));
  }
  return { el, update, stomp };
}

/**
 * The Drop folded under a head that always shows what it's doing: name, light, state, the round
 * on/off button and a fold arrow. It opens by itself when the Drop starts working (and when a song
 * needs it); you can fold it any time. `o.onOpen(open)` hears about it.
 */
export function dropSection(o = {}) {
  const box = h('section.dc-fold');
  const head = h('div.dc-fold-head');
  const led = h('span.dc-led', { 'aria-hidden': 'true' });
  const state = h('span.dc-fold-state');
  const foot = h('button.dc-foot.dc-foot-sm', { type: 'button', title: 'Drop on or off (D)', 'aria-label': 'Drop on or off' }, h('span.dc-foot-cap'));
  const chev = h('button.dc-fold-chev', { type: 'button' });
  const name = h('button.dc-fold-name', { type: 'button' }, h('b', { text: 'Drop' }), led, state);
  head.append(name, foot, chev);
  const body = h('div.dc-fold-body');
  box.append(head, body);
  let open = false;
  let built = null;
  let wasUsing = dropInUse();
  let wasNeeded = !!rig.dropSong;
  const setOpen = (v, why = 'you') => {
    open = !!v;
    box.classList.toggle('open', open);
    chev.setAttribute('aria-expanded', String(open));
    name.setAttribute('aria-expanded', String(open));
    chev.title = open ? 'Fold the Drop away' : 'Open the Drop';
    chev.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>`;
    if (open && !built) {
      built = dropConsole({ ...o, compact: true });
      body.append(built);
    }
    if (o.onOpen) o.onOpen(open, why);
  };
  name.onclick = chev.onclick = () => setOpen(!open);
  foot.onclick = () => {
    if (rig.drop.momentary && !rig.drop.on) return setOpen(true); // momentary: hold the switch on the pedal
    rig.setDrop({ on: !rig.drop.on });
    if (rig.drop.on) did('drop');
    const sw = built && built.querySelector('.dp');
    if (sw) {
      sw.classList.add('stomp');
      setTimeout(() => sw.classList.remove('stomp'), 170);
    }
  };
  const update = () => {
    const d = rig.drop;
    const amt = d.on ? rig.dropAmount() : 0;
    const using = dropInUse();
    const needed = !!rig.dropSong && !using;
    box.classList.toggle('on', !!d.on);
    box.classList.toggle('working', using);
    box.classList.toggle('needed', needed);
    foot.setAttribute('aria-pressed', String(!!d.on));
    state.textContent = !d.on ? (needed ? `Off · this song wants −${rig.dropSong}` : 'Off') : amt >= 12 ? 'Down an octave' : amt ? `−${amt} · ${soundsLike(amt, o.kind || 'guitar')}` : 'On, nothing to drop';
    // opens itself when it starts working, or when a song turns up that wants it
    if (o.autoOpen !== false && ((using && !wasUsing) || (needed && !wasNeeded))) setOpen(true, 'auto');
    wasUsing = using;
    wasNeeded = needed;
  };
  setOpen(o.open ?? (dropInUse() || !!rig.dropSong), 'start');
  update();
  const onDrop = () => {
    if (!box.isConnected) {
      if (box._shown) rig.removeEventListener('drop', onDrop);
      return;
    }
    box._shown = true;
    update();
  };
  rig.addEventListener('drop', onDrop);
  box.setOpen = setOpen;
  box.isOpen = () => open;
  box.update = update;
  return box;
}
