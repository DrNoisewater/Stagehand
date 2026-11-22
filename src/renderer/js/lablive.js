/**
 * 4.20: The Lab's footswitches and Boing's lever, played live.
 *
 * Each press goes straight to the sound engine (rig.live), never into the tone, so it is instant
 * and never saved. Everything lets go by itself when the window loses focus, the app is hidden,
 * the tone changes or the guitar is disconnected (rig.js), so nothing can stay stuck down.
 */
import { rig } from './rig.js';
import { LAB_BITS, LAB_KINDS } from './gearspec.js';

/** Press (on = true) or let go of a pedal's footswitch. The thirty that followed have several
 * each: `bit` is which (their order in the pedal's list). */
export function labPress(key, on, bit = 0) {
  if (key in LAB_KINDS) {
    const n = LAB_KINDS[key], now = rig.labWords[n] | 0, b = 1 << bit;
    rig.labWord(n, on ? now | b : now & ~b);
    return;
  }
  const b = 1 << (LAB_BITS[key] || 0);
  if (!LAB_BITS[key]) return;
  const now = rig.lab.labHold;
  const next = on ? now | b : now & ~b;
  if (next !== now) rig.live('labHold', next);
}

export function labHeld(key, bit = 0) {
  if (key in LAB_KINDS) return !!((rig.labWords[LAB_KINDS[key]] | 0) & (1 << bit));
  return !!LAB_BITS[key] && !!(rig.lab.labHold & (1 << LAB_BITS[key]));
}

/** A lever, 0 (rest) to 1 (pulled all the way): Boing's Bend, or one of the thirty's (Maui's Drag). */
export function labLever(v, key = 'Pedal_Boing') {
  v = Math.max(0, Math.min(1, Number(v) || 0));
  if (key in LAB_KINDS) rig.labVal(LAB_KINDS[key], v);
  else rig.live('labLever', v);
}

export function labLeverAt(key = 'Pedal_Boing') {
  return key in LAB_KINDS ? rig.labLevers[LAB_KINDS[key]] || 0 : rig.lab.labLever;
}

/**
 * 4.26: footswitches that used to work only while held now click on and click off (you can't hold
 * a switch while you play). A player who wants the old way picks "Hold" once (kept on this PC).
 * Nothing is saved in a tone either way.
 */
const MODE_KEY = 'stagehand.footswitchMode';
export function footMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'hold' ? 'hold' : 'toggle';
  } catch (_) {
    return 'toggle';
  }
}
export function setFootMode(m) {
  try {
    localStorage.setItem(MODE_KEY, m === 'hold' ? 'hold' : 'toggle');
  } catch (_) {}
  // let go of whatever was left on, then repaint every switch
  labClearAll();
  rig.dispatchEvent(new Event('lab'));
}

// switches pressed in Hold mode right now: only these let go when the window loses focus
const pressed = new Set();

export function labReleaseAll() {
  for (const k of [...pressed]) {
    const [key, bit] = k.split('|');
    labPress(key, false, Number(bit));
  }
  pressed.clear();
  if (rig.lab.labLever) rig.live('labLever', 0);
  rig.labLetGo();
}

/** Lets go of every switch, clicked on or held (changing the mode). */
function labClearAll() {
  pressed.clear();
  if (rig.lab.labHold) rig.live('labHold', 0);
  if (rig.lab.labLever) rig.live('labLever', 0);
  for (const n of Object.keys(rig.labWords).map(Number)) rig.labWord(n, 0);
  for (const n of Object.keys(rig.labLevers).map(Number)) rig.labVal(n, 0);
}

if (typeof window !== 'undefined') {
  window.addEventListener('blur', labReleaseAll);
  document.addEventListener('visibilitychange', () => document.hidden && labReleaseAll());
}

/**
 * Makes `el` a footswitch that holds while pressed: pointer (captured, so sliding off still
 * counts until you let go), Space or Enter. Lets go on pointer up, cancel, lost capture, key up
 * and blur. Returns a function that removes it. A 'tap' works the same (the pedal acts on the
 * press); a 'latch' stays lit after a click until it's clicked again.
 */
export function holdable(el, key, bit = 0, type = 'hold') {
  if (type === 'latch') return latchable(el, key, bit);
  let down = false;
  const id = `${key}|${bit}`;
  // 4.26: a 'hold' switch clicks on and off unless the player chose Hold; a 'tap' acts on the press
  const toggles = () => type === 'hold' && footMode() === 'toggle';
  const set = (on) => {
    if (down === on) return;
    down = on;
    if (on) pressed.add(id);
    else pressed.delete(id);
    labPress(key, on, bit);
  };
  const press = () => (toggles() ? labPress(key, !labHeld(key, bit), bit) : set(true));
  const up = () => !toggles() && set(false);
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || el.disabled) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch (_) {}
    el.focus({ preventScroll: true });
    press();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) el.addEventListener(ev, up);
  el.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      press();
    }
  });
  el.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && up());
  const paint = () => {
    const on = labHeld(key, bit);
    if (!on) down = false; // let go elsewhere (focus lost, tone changed)
    el.classList.toggle('held', on);
    el.classList.toggle('latched', on && toggles());
    el.setAttribute('aria-pressed', String(on));
  };
  rig.addEventListener('lab', paint);
  paint();
  return () => (set(false), rig.removeEventListener('lab', paint));
}

/** A button that stays lit (Speak, Repeat, Dance): click, Space or Enter turns it on and off. */
export function latchable(el, key, bit = 0) {
  const flip = () => !el.disabled && labPress(key, !labHeld(key, bit), bit);
  const click = (e) => (e.preventDefault(), flip());
  el.addEventListener('click', click);
  const paint = () => {
    const on = labHeld(key, bit);
    el.classList.toggle('held', on);
    el.classList.toggle('latched', on);
    el.setAttribute('aria-pressed', String(on));
  };
  rig.addEventListener('lab', paint);
  paint();
  return () => (el.removeEventListener('click', click), rig.removeEventListener('lab', paint));
}
