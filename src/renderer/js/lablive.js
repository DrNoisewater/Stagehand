/**
 * 4.20: The Lab's footswitches and Boing's lever, played live.
 *
 * Each press goes straight to the sound engine (rig.live), never into the tone, so it is instant
 * and never saved. Everything lets go by itself when the window loses focus, the app is hidden,
 * the tone changes or the guitar is disconnected (rig.js), so nothing can stay stuck down.
 */
import { rig } from './rig.js';
import { LAB_BITS } from './gearspec.js';

/** Press (on = true) or let go of a pedal's footswitch. */
export function labPress(key, on) {
  const bit = 1 << (LAB_BITS[key] || 0);
  if (!LAB_BITS[key]) return;
  const now = rig.lab.labHold;
  const next = on ? now | bit : now & ~bit;
  if (next !== now) rig.live('labHold', next);
}

export function labHeld(key) {
  return !!LAB_BITS[key] && !!(rig.lab.labHold & (1 << LAB_BITS[key]));
}

/** Boing's Bend lever, 0 (rest) to 1 (pulled all the way). */
export function labLever(v) {
  rig.live('labLever', Math.max(0, Math.min(1, Number(v) || 0)));
}

export function labReleaseAll() {
  if (rig.lab.labHold) rig.live('labHold', 0);
  if (rig.lab.labLever) rig.live('labLever', 0);
}

if (typeof window !== 'undefined') {
  window.addEventListener('blur', labReleaseAll);
  document.addEventListener('visibilitychange', () => document.hidden && labReleaseAll());
}

/**
 * Makes `el` a footswitch that holds while pressed: pointer (captured, so sliding off still
 * counts until you let go), Space or Enter. Lets go on pointer up, cancel, lost capture, key up
 * and blur. Returns a function that removes it.
 */
export function holdable(el, key) {
  let down = false;
  const set = (on) => {
    if (down === on) return;
    down = on;
    labPress(key, on);
  };
  const up = () => set(false);
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || el.disabled) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch (_) {}
    el.focus({ preventScroll: true });
    set(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) el.addEventListener(ev, up);
  el.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      set(true);
    }
  });
  el.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && up());
  const paint = () => {
    const on = labHeld(key);
    if (!on) down = false; // let go elsewhere (focus lost, tone changed)
    el.classList.toggle('held', on);
    el.setAttribute('aria-pressed', String(on));
  };
  rig.addEventListener('lab', paint);
  paint();
  return () => (up(), rig.removeEventListener('lab', paint));
}
