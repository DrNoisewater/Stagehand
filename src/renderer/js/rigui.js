/**
 * Shared pieces for the rig on the Play and Tones pages: rotary knobs, the
 * signal chain of gear blocks, and tone demos (a riff played through a tone).
 */
import { gearArt } from './gearart.js';
import { gearPhotoInfo } from './gear-photos.js';
import { h, esc, icon, toast, modal } from './ui.js';
import { rig } from './rig.js';
import { engine } from './stage.js';
import { TYPE_GELS, TYPE_NAMES, orderedGear, knobsOf, momentsOf, shortGearName } from './tonelib.js';
import { holdable, labHeld, labLever, labLeverAt } from './lablive.js';
import { renderTone, demoRiff } from './render.js';
import { resolveCapture } from './captures.js';
import { knobDrag, showKnobGuide } from './knobdrag.js';

export function fmtKnob(k, v) {
  // 4.20: switches show their position's name; knobs with a unit show it
  if (k.labels) return k.labels[Math.max(0, Math.min(k.labels.length - 1, Math.round(v - k.min)))];
  if (k.off !== undefined && v <= k.off + 1e-9) return 'off';
  const span = k.max - k.min;
  if (k.unit) {
    const a = Math.abs(v);
    let n = k.step && k.step < 1 ? (Math.round(v / k.step) * k.step).toFixed(String(k.step).split('.')[1]?.length || 1) : a >= 100 || span >= 50 ? String(Math.round(v)) : a >= 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100);
    if (k.unit === 'st' && v > 0) n = `+${n}`;
    return k.unit === '%' ? `${n}%` : `${n} ${k.unit}`;
  }
  if (span >= 20) return String(Math.round(v));
  if (span >= 2) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * A rotary knob: drag up or right for more, down or left for less (Shift for fine), wheel,
 * arrow keys, double-click for the default.
 */
export function rotaryKnob({ name, min = 0, max = 1, value, def, gel = 'var(--tungsten)', fmt, step, onInput, onChange, labels, log, angle }) {
  const el = h('button.rknob', { type: 'button', role: 'slider', 'aria-label': name, 'aria-valuemin': String(min), 'aria-valuemax': String(max), style: { '--gel': gel } });
  const ring = h('span.ring', null, h('span.cap', null, h('span.ptr')));
  const label = h('span.kn-name', { text: name, title: name });
  el.title = `${name}: drag up or right for more, down or left for less (Shift for fine), or scroll · double-click to reset`;
  const val = h('span.kn-val');
  el.append(ring, label, val);
  if (labels) step = 1; // 4.20: a switch or selector with named positions
  // 4.20: frequency and time knobs turn in octaves (each bit of travel multiplies), like the real thing
  const lg = !!log && min > 0;
  const toT = (x) => (lg ? Math.log(x / min) / Math.log(max / min) : (x - min) / (max - min || 1));
  const fromT = (t) => (lg ? min * Math.pow(max / min, t) : min + t * (max - min));
  const st = step || (max - min >= 20 ? 1 : (max - min) / 100);
  const positions = Math.round((max - min) / st);
  const few = positions <= 6; // a switch or a selector
  if (few) el.classList.add('switch');
  const snap = (nv) => (lg ? Number(nv.toPrecision(nv < 10 ? 2 : 3)) : min + Math.round((nv - min) / st) * st);
  let v = Number(value);
  const show = () => {
    const t = toT(v);
    ring.style.setProperty('--deg', `${Math.round(270 * t)}deg`);
    ring.style.setProperty('--rot', `${Math.round(angle ? angle(v) : -135 + 270 * t)}deg`);
    val.textContent = fmt ? fmt(v) : String(Math.round(v * 100) / 100);
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', val.textContent);
    el.setAttribute('data-max', String(t >= 1));
  };
  const set = (nv, final) => {
    if (el.disabled || !Number.isFinite(Number(nv))) return;
    nv = Math.max(min, Math.min(max, nv));
    nv = Math.max(min, Math.min(max, snap(nv)));
    if (nv === v && !final) return;
    v = nv;
    show();
    if (onInput) onInput(v);
    if (final && onChange) onChange(v);
    el.dispatchEvent(new CustomEvent('knobinput', { detail: v }));
  };
  // Linked faceplate controls update the same values without rebuilding the
  // editor (which would lose pointer capture midway through a drag).
  el.setValue = (nv, { emit = false, final = false } = {}) => {
    if (emit) return set(nv, final);
    if (!Number.isFinite(Number(nv))) return;
    v = Math.max(min, Math.min(max, Number(nv))); show();
  };
  // 4.20: what a photo control needs to look and step the same as this one
  el._meta = { labels, log: lg, fmt, step: st, def };
  // 4.19: drag any natural way (up or right is more, down or left is less; the first few pixels
  // pick the direction), the pointer stays put, and a guide over the knob shows the value (knobdrag.js)
  {
    // 4.11: the drag is added up before it is rounded to a step, so a switch or selector (a few
    // positions) follows the hand too: before, each small move rounded back to where it was
    let raw = v;
    const span = few ? Math.max(40, 30 * positions) : 160;
    const guide = () => showKnobGuide(el, `${name}  ${val.textContent}`, toT(v));
    knobDrag(el, {
      start: () => {
        raw = lg ? toT(v) : v;
      },
      move: (px, ev) => {
        if (lg) {
          raw = Math.max(0, Math.min(1, raw + px / (ev.shiftKey ? 600 : span)));
          set(fromT(raw));
        } else {
          raw = Math.max(min, Math.min(max, raw + (px / (ev.shiftKey && !few ? 600 : span)) * (max - min)));
          set(raw);
        }
        guide();
      },
      end: (moved) => {
        // a plain click on a switch flips it to its next position
        if (few && moved < 3) return set(v + st > max + 1e-9 ? min : v + st, true);
        set(v, true);
      },
    });
  }
  const nudge = (n) => (lg ? set(fromT(Math.max(0, Math.min(1, toT(v) + n * 0.01))), true) : set(v + n * st, true));
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    nudge(-Math.sign(e.deltaY) * (e.shiftKey || few ? 1 : 3));
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowRight') nudge(e.shiftKey ? 10 : 1);
    else if (k === 'ArrowDown' || k === 'ArrowLeft') nudge(e.shiftKey ? -10 : -1);
    else if (k === 'Home') set(min, true);
    else if (k === 'End') set(max, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('dblclick', () => def !== undefined && set(Number(def), true));
  show();
  return el;
}

/** 4.20: a knob for one entry of knobsOf(g): named positions, log travel, units, help and the
 * "does nothing in this mode" dimming all come with it. step: the page's own default step. */
export function gearKnob(k, { gel, step, onInput, onChange } = {}) {
  const el = rotaryKnob({ name: k.name, min: k.min, max: k.max, value: k.value, def: k.def, gel, step: k.step || (k.labels ? 1 : step), labels: k.labels, log: k.log, fmt: (v) => fmtKnob(k, v), onInput, onChange });
  if (k.dim) el._dim = k.dim;
  if (k.help) el.dataset.help = k.help;
  return el;
}

/** Switches and selectors (a range of 4 or less) click from one position to the next. */
export function stepFor(min, max) {
  return max - min <= 4 ? 1 : undefined;
}

// 4.20: where no clear piece of slot is left on the photo (the cap covers it), the patch is painted:
// the panel's colour with the slot drawn through it. f = { fill, slot, sw: slot width % of the patch }
const drawnSlot = (f, vertical) => {
  const a = 50 - (f.sw || 30) / 2, b = 50 + (f.sw || 30) / 2;
  return { background: `linear-gradient(${vertical ? 90 : 180}deg, ${f.fill} ${a - 4}%, ${f.slot} ${a}%, ${f.slot} ${b}%, ${f.fill} ${b + 4}%)` };
};

// a piece of the photo, w% x h% big and centred on (x%, y%), as an element's background
const photoPiece = (src, x, y, w, h) => ({
  backgroundImage: `url("${src}")`,
  backgroundSize: `${(10000 / w).toFixed(2)}% ${(10000 / h).toFixed(2)}%`,
  backgroundPosition: `${(((x - w / 2) / (100 - w)) * 100).toFixed(3)}% ${(((y - h / 2) / (100 - h)) * 100).toFixed(3)}%`,
});

/** A slider on a gear photo, tied to the strip control `original` (same value, same undo). */
function photoSlider(src, [x, top, bot, cy, w, hh, py], original, name) {
  const min = Number(original.getAttribute('aria-valuemin')), max = Number(original.getAttribute('aria-valuemax'));
  const meta = original._meta || {};
  const lg = meta.log && min > 0; // 4.20: log controls (times) move along their slot as they turn
  const toT = (x2) => (lg ? Math.log(x2 / min) / Math.log(max / min) : (x2 - min) / (max - min || 1));
  const fromT = (t) => (lg ? min * Math.pow(max / min, t) : min + t * (max - min));
  let v = Number(original.getAttribute('aria-valuenow'));
  const drawn = py && typeof py === 'object';
  const patch = h(`span.photo-patch${drawn ? '.drawn' : ''}`, { 'aria-hidden': 'true', style: { left: `${x - w / 2}%`, top: `${cy - hh / 2}%`, width: `${w}%`, height: `${hh}%`, ...(drawn ? drawnSlot(py, true) : photoPiece(src, x, py, w, hh)) } });
  const lane = bot - top + hh; // the cap's whole travel, top edge to bottom edge
  const el = h('button.gear-slider', { type: 'button', role: 'slider', 'aria-orientation': 'vertical', 'aria-label': name, 'aria-valuemin': String(min), 'aria-valuemax': String(max),
    title: `${name}: drag up or down (Shift for fine), double-click to reset`, style: { left: `${x - w / 2}%`, top: `${top - hh / 2}%`, width: `${w}%`, height: `${lane}%` } });
  const cap = h('span.photo-slide', { style: { height: `${(hh / lane) * 100}%`, ...photoPiece(src, x, cy, w, hh) } });
  const tip = h('span.gsl-tip');
  el.append(cap, tip);
  el.disabled = original.disabled;
  const show = () => {
    const t = toT(v);
    cap.style.top = `${(1 - t) * (1 - hh / lane) * 100}%`;
    const txt = meta.fmt ? meta.fmt(v) : (max - min >= 20 ? Math.round(v) : Math.round(v * 10) / 10);
    tip.textContent = `${name} ${v > 0 && min < 0 && !meta.fmt ? '+' : ''}${txt}`;
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', tip.textContent);
  };
  const push = (nv, final) => {
    if (el.disabled) return;
    v = Math.max(min, Math.min(max, nv));
    show();
    original.setValue(v, { emit: true, final });
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || el.disabled) return;
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const travel = r.height * (1 - hh / lane) || 1;
    const capR = cap.getBoundingClientRect();
    // grab the cap where you touch it; a click on the slot brings the cap there
    const on = e.clientY >= capR.top && e.clientY <= capR.bottom;
    const grab = on ? e.clientY - (capR.top + capR.height / 2) : 0;
    let fineY = e.clientY, fineT = toT(v);
    const at = (ev) => {
      if (ev.shiftKey) { fineT = Math.max(0, Math.min(1, fineT - (ev.clientY - fineY) / travel / 4)); fineY = ev.clientY; return fromT(fineT); }
      fineY = ev.clientY;
      fineT = Math.max(0, Math.min(1, 1 - (ev.clientY - grab - r.top - capR.height / 2) / travel));
      return fromT(fineT);
    };
    if (!on) push(at(e), false);
    const move = (ev) => push(at(ev), false);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      push(v, true);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    e.preventDefault();
  });
  const st = max - min >= 20 ? 1 : (max - min) / 100;
  const step = (n) => (lg ? push(fromT(Math.max(0, Math.min(1, toT(v) + n * 0.01))), true) : push(v + n * st, true));
  el.addEventListener('wheel', (e) => { e.preventDefault(); step(-Math.sign(e.deltaY) * (e.shiftKey ? 1 : 3)); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowRight') step(e.shiftKey ? 10 : 1);
    else if (k === 'ArrowDown' || k === 'ArrowLeft') step(e.shiftKey ? -10 : -1);
    else if (k === 'Home') push(min, true);
    else if (k === 'End') push(max, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('dblclick', () => original.dispatchEvent(new MouseEvent('dblclick')));
  const sync = (e) => { v = Number(e.detail); show(); };
  original.addEventListener('knobinput', sync);
  show();
  return { el, patch, dispose: () => original.removeEventListener('knobinput', sync) };
}

/** 4.20: a horizontal fader on a gear photo (Slug's Rise and Tail, Caterwaul's Tail), tied to the
 * strip control `original`. The cap is cut from the photo and slides along its slot; a clear piece
 * of the same slot covers the photo's own cap. */
function photoHSlider(src, [y, left, right, cx, w, hh, px], original, name) {
  const min = Number(original.getAttribute('aria-valuemin')), max = Number(original.getAttribute('aria-valuemax'));
  const meta = original._meta || {};
  const lg = meta.log && min > 0;
  const toT = (x) => (lg ? Math.log(x / min) / Math.log(max / min) : (x - min) / (max - min || 1));
  const fromT = (t) => (lg ? min * Math.pow(max / min, t) : min + t * (max - min));
  let v = Number(original.getAttribute('aria-valuenow'));
  const drawn = px && typeof px === 'object';
  const pw = drawn ? w * 1.08 : w * 1.5, ph = drawn ? hh * 1.1 : hh * 1.6; // a little larger than the cap, with soft ends (rig.css)
  const patch = h(`span.photo-patch.horiz${drawn ? '.drawn' : ''}`, { 'aria-hidden': 'true', style: { left: `${cx - pw / 2}%`, top: `${y - ph / 2}%`, width: `${pw}%`, height: `${ph}%`, ...(drawn ? drawnSlot(px, false) : photoPiece(src, px, y, pw, ph)) } });
  const lane = right - left + w;
  const el = h('button.gear-slider.horiz', { type: 'button', role: 'slider', 'aria-orientation': 'horizontal', 'aria-label': name, 'aria-valuemin': String(min), 'aria-valuemax': String(max),
    title: `${name}: drag left or right (Shift for fine), double-click to reset`, style: { left: `${left - w / 2}%`, top: `${y - hh / 2}%`, width: `${lane}%`, height: `${hh}%` } });
  const cap = h('span.photo-slide', { style: { width: `${(w / lane) * 100}%`, ...photoPiece(src, cx, y, w, hh) } });
  const tip = h('span.gsl-tip');
  el.append(cap, tip);
  el.disabled = original.disabled;
  const show = () => {
    cap.style.left = `${toT(v) * (1 - w / lane) * 100}%`;
    tip.textContent = `${name} ${meta.fmt ? meta.fmt(v) : Math.round(v)}`;
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', tip.textContent);
  };
  const push = (nv, final) => {
    if (el.disabled) return;
    v = Math.max(min, Math.min(max, nv));
    show();
    original.setValue(v, { emit: true, final });
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || el.disabled) return;
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const travel = r.width * (1 - w / lane) || 1;
    const capR = cap.getBoundingClientRect();
    const on = e.clientX >= capR.left && e.clientX <= capR.right;
    const grab = on ? e.clientX - (capR.left + capR.width / 2) : 0;
    let fineX = e.clientX, fineT = toT(v);
    const at = (ev) => {
      if (ev.shiftKey) {
        fineT = Math.max(0, Math.min(1, fineT + (ev.clientX - fineX) / travel / 4));
        fineX = ev.clientX;
        return fromT(fineT);
      }
      fineX = ev.clientX;
      fineT = Math.max(0, Math.min(1, (ev.clientX - grab - r.left - capR.width / 2) / travel));
      return fromT(fineT);
    };
    if (!on) push(at(e), false);
    const move = (ev) => push(at(ev), false);
    const up = () => {
      for (const [ev, fn] of [['pointermove', move], ['pointerup', up], ['pointercancel', up], ['lostpointercapture', up]]) el.removeEventListener(ev, fn);
      push(v, true);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    e.preventDefault();
  });
  const nudge = (n) => push(fromT(Math.max(0, Math.min(1, toT(v) + n * 0.01))), true);
  el.addEventListener('wheel', (e) => { e.preventDefault(); nudge(-Math.sign(e.deltaY) * (e.shiftKey ? 1 : 3)); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowRight') nudge(e.shiftKey ? 10 : 1);
    else if (k === 'ArrowDown' || k === 'ArrowLeft') nudge(e.shiftKey ? -10 : -1);
    else if (k === 'Home') push(min, true);
    else if (k === 'End') push(max, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('dblclick', () => original.dispatchEvent(new MouseEvent('dblclick')));
  const sync = (e) => { v = Number(e.detail); show(); };
  original.addEventListener('knobinput', sync);
  show();
  return { el, patch, dispose: () => original.removeEventListener('knobinput', sync) };
}

/** 4.20: a pedal's footswitches and levers (The Lab), for the control strip: hold to play. They
 * never go into the tone. Returns [] for gear without any. */
export function labStrip(g) {
  const out = [];
  for (const m of momentsOf(g)) {
    const b = h('button.btn.small.rhold', { type: 'button', 'data-moment': m.name.toLowerCase(), 'data-type': m.type, 'data-bit': String(m.bit), 'aria-pressed': 'false' });
    b.innerHTML = `<span class="rh-led"></span><span>${esc(m.name)}</span>`;
    if (m.type === 'lever') {
      b.title = `${m.name}: hold to pull it all the way (it springs back when you let go). On the picture, pull it as far as you like.`;
      let down = false;
      const set = (on) => { if (down !== on) (down = on), labLever(on ? 1 : 0, g.key); };
      b.addEventListener('pointerdown', (e) => { if (e.button) return; e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) {} set(true); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) b.addEventListener(ev, () => set(false));
      b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) (e.preventDefault(), set(true)); });
      b.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && set(false));
      const paint = () => { const on = labLeverAt(g.key) > 0.001; if (!on) down = false; b.classList.toggle('held', on); b.setAttribute('aria-pressed', String(on)); };
      rig.addEventListener('lab', paint);
      b._dispose = () => rig.removeEventListener('lab', paint);
    } else {
      b.title = `${m.name}: ${labHelp(g.key, m)}`;
      b._dispose = holdable(b, g.key, m.bit, m.type);
    }
    out.push(b);
  }
  return out;
}

const LAB_HOLD_HELP = {
  Pedal_Quack: 'hold it and the mouth jumps wide open with extra bite',
  Pedal_Boing: 'hold it and your notes spring to the Interval over Rise; let go and they drop back over Fall',
  Pedal_Invader: 'hold it and the synth keeps its note while you play over it',
  Pedal_Confetti: 'hold it and the echoes pile up into a wash; let go and they settle',
  Pedal_Blender: 'hold it and it keeps chopping what it already has while you play over it',
  Pedal_Fossil: 'press it to freeze what you just played into a drone (Hold: while held; Latch: press again to let go)',
};
// 4.20: the thirty that followed, footswitch by footswitch
const LAB_MOMENT_HELP = {
  'Pedal_Annwn|cross': 'hold it and the cloud hangs on: the recording stops changing',
  'Pedal_Apoptosis|release': 'press it to turn the last moment of your playing into a drone that dies away band by band',
  'Pedal_Bifrost|cross': 'hold it to swing the rift over to the other side',
  'Pedal_BluePrince|draft': 'hold it to walk into the next room',
  'Pedal_Claude|hear': 'light it and play: the next phrase is learned',
  'Pedal_Claude|shape': 'light it and each new phrase takes the learned shape once',
  'Pedal_Claude|repeat': 'light it and the learned shape goes round and round',
  'Pedal_Claude|clear': 'press it to forget the learned shape',
  'Pedal_Claude|recall': 'press it to start the shape again now',
  'Pedal_DejaVu|enter': 'press it to catch the last few beats you played',
  'Pedal_DejaVu|repeat': 'light it and the caught beats play round and round',
  'Pedal_Duat|descend': 'hold it to hear only the layer Passage points to',
  'Pedal_EventHorizon|collapse': 'hold it and everything falls in at once',
  'Pedal_Fenrir|break': 'hold it and the wolf howls, rising in pitch',
  'Pedal_Inanna|return': 'hold it and every band comes back at full',
  'Pedal_Janus|threshold': 'light it and the past and the future swap sides',
  'Pedal_Kitsune|trick': 'press it to turn the lit tails round by one',
  'Pedal_Kukulkan|rise': 'light it to start the climb; press again to stop',
  'Pedal_Long|ascend': 'hold it and the whole sound rises an octave',
  'Pedal_Maui|haul': 'hold it and your playing slows down; let go and it catches up',
  'Pedal_Mimic|listen': 'hold it while you play to teach it a phrase',
  'Pedal_Mimic|speak': 'light it and your playing takes on what it learned',
  'Pedal_Mimic|catch': 'press it to learn the last two seconds at once',
  'Pedal_Mimic|clear': 'press it to forget what it learned',
  'Pedal_Nataraja|dance': 'light it to start the dance; press again to stop',
  'Pedal_Nataraja|reset': 'press it to go back to step one',
  'Pedal_Olympus|strike': 'hold it and every pick hits harder into the fuzz',
  'Pedal_Olympus|hold': 'light it and the reverb tail freezes; press again to let it go',
  'Pedal_Ouroboros|swallow': 'hold it and the echo goes round almost for ever',
  'Pedal_Parasite|feed': 'hold it and the creature grows four times as fast',
  'Pedal_Seance|listen': 'light it and it remembers what you play, answering when you stop',
  'Pedal_Seance|summon': 'press it for an answer now',
  'Pedal_Severed|swap': 'light it to swap to the other sound; press again to go back',
  'Pedal_Shango|call': 'hold it and play: your call is caught',
  'Pedal_Shango|answer': 'press it and the call is answered',
  'Pedal_Tezcatl|vanish': 'hold it and only the mirror is heard',
  'Pedal_Veles|underworld': 'light it and the voices become a drone beneath you; press again to let go',
  'Pedal_Wukong|uproar': 'hold it and every clone joins in at once',
};
const labHelp = (key, m) => LAB_MOMENT_HELP[`${key}|${m.name.toLowerCase()}`] || LAB_HOLD_HELP[key] || (m.type === 'latch' ? `click to turn ${m.name} on or off` : m.type === 'tap' ? `press to use ${m.name}` : `hold to use ${m.name}`);

/** An enlarged gear face with real linked controls placed over its knobs.
 * Unmapped controls remain in the labeled control row; no fake physical knob.
 * The supplied controls own audio, draft, save and undo semantics.
 * 4.20: bypass = { on: () => boolean, toggle() } puts the pedal's own on/off footswitch to work. */
export function gearFaceplate(key, controls, { enlarged = false, bypass = null } = {}) {
  const item = gearPhotoInfo(key);
  if (!item) return null;
  const wrap = h('div.gear-faceplate');
  wrap.classList.toggle('portrait',item.height>item.width);
  const face = h('div.gear-face', {style:{aspectRatio:`${item.width} / ${item.height}`}});
  const photo = h('img', {src:`art/gear/${item.file}`,alt:`${item.name} gear face`,draggable:false});
  photo.onerror = () => { wrap.hidden = true; };
  face.append(photo);
  wrap.classList.toggle('enlarged', !!enlarged);
  const src = `art/gear/${item.file}`;
  const ratio = item.height / item.width;
  let count = 0;
  const cleanup = [];
  const originals = {};
  for (const o of controls.querySelectorAll('.rknob')) originals[o.getAttribute('aria-label').toLowerCase()] = o;
  for (const original of controls.querySelectorAll('.rknob')) {
    const name = original.getAttribute('aria-label');
    const pos = item.knobs?.[name.toLowerCase()];
    if (!pos) continue;
    const meta = original._meta || {};
    const stops = item.stops?.[name.toLowerCase()];
    const kmin = Number(original.getAttribute('aria-valuemin'));
    const overlay = rotaryKnob({name,
      min:kmin,
      max:Number(original.getAttribute('aria-valuemax')),
      value:Number(original.getAttribute('aria-valuenow')),
      step: meta.step || item.steps?.[name.toLowerCase()] || stepFor(kmin, Number(original.getAttribute('aria-valuemax'))),
      labels: meta.labels, log: meta.log, fmt: meta.fmt,
      // 4.20: a selector points at the printed position it's on
      angle: stops ? (v) => stops[Math.max(0, Math.min(stops.length - 1, Math.round(v - kmin)))] : undefined,
      onInput:v=>original.setValue(v,{emit:true}),
      onChange:v=>original.setValue(v,{emit:true,final:true})});
    overlay.classList.add('gear-hotspot');
    overlay.style.left=pos[0]+'%'; overlay.style.top=pos[1]+'%';
    if (item.turn && pos.length >= 4 && pos[4] !== 'still') {
      // Rock Opera: the knob face is cut from the photo itself and turned, so the real knob moves.
      const [x, y, r, a0] = pos;
      const d = 2 * r;                       // face size, % of the photo's width
      const sw = 100 / d, sh = sw * ratio;    // photo size in face widths
      const ox = (x - r) / d, oy = (y * ratio - r) / d;
      overlay.classList.add('turns');
      overlay.style.setProperty('--knob-size', d + '%');
      const cap = h('span.photo-cap', { style: {
        backgroundImage: `url("${src}")`,
        backgroundSize: `${(sw * 100).toFixed(3)}% ${(sh * 100).toFixed(3)}%`,
        backgroundPosition: `${(ox / (sw - 1) * 100).toFixed(3)}% ${(oy / (sh - 1) * 100).toFixed(3)}%`,
        '--a0': `${a0}deg`,
      } });
      const ring = overlay.children && overlay.children[0];
      if (ring && ring.append) ring.append(cap);
    } else {
      // 4.20: a control that isn't a round knob on the photo (a mushroom, a wheel, a censer): it
      // works the same but nothing turns; a ring round it shows the setting
      overlay.style.setProperty('--knob-size',(pos[2] ? pos[2] * 2 : 5)+'%');
      if (pos[4] === 'still') overlay.classList.add('turns', 'still');
    }
    const help = (original.dataset && original.dataset.help);
    overlay.title=`${name}${help ? `: ${help}.` : ':'} Drag up or right for more, down or left for less (Shift for fine), or scroll · double-click to reset`;
    overlay.disabled=original.disabled;
    overlay.setAttribute('data-ctl', name.toLowerCase());
    const sync=e=>overlay.setValue(e.detail);
    original.addEventListener('knobinput',sync);
    cleanup.push(()=>original.removeEventListener('knobinput',sync));
    overlay.addEventListener('dblclick',()=>original.dispatchEvent(new MouseEvent('dblclick')));
    face.append(overlay); count++;
  }
  // 4.10: sliders (the graphic EQs). The cap is cut from the photo and slides in its slot; a clear
  // piece of the same slot is painted over the place where the photo shows the cap.
  let slides = 0;
  for (const original of controls.querySelectorAll('.rknob')) {
    const name = original.getAttribute('aria-label');
    const sp = item.sliders?.[name.toLowerCase()];
    if (!sp) continue;
    const sl = photoSlider(src, sp, original, name);
    sl.el.setAttribute('data-ctl', name.toLowerCase());
    cleanup.push(sl.dispose);
    face.append(sl.patch, sl.el); slides++; count++;
  }
  // 4.20 (The Lab): horizontal faders
  for (const [n, hp] of Object.entries(item.hsliders || {})) {
    const original = originals[n];
    if (!original) continue;
    const sl = photoHSlider(src, hp, original, original.getAttribute('aria-label'));
    sl.el.setAttribute('data-ctl', n);
    cleanup.push(sl.dispose);
    face.append(sl.patch, sl.el); slides++; count++;
  }
  // toggle switches: click (or Space, Enter, arrows) to flip; the printed word for where it is lights up
  for (const [n, [x, y, w, hh]] of Object.entries(item.switches || {})) {
    const original = originals[n];
    if (!original) continue;
    const name = original.getAttribute('aria-label');
    const min = Number(original.getAttribute('aria-valuemin')), max = Number(original.getAttribute('aria-valuemax'));
    const meta = original._meta || {};
    const marks = (item.marks?.[n] || []).map((m) => (m ? h('span.gear-mark', { 'aria-hidden': 'true', style: { left: `${m[0]}%`, top: `${m[1]}%` } }) : null));
    const tag = marks.some((m) => !m) || !marks.length ? h('span.gear-swtag', { 'aria-hidden': 'true', style: { left: `${x}%`, top: `${y + hh / 2 + 1}%` } }) : null;
    const sw = h('button.gear-switch', { type: 'button', role: 'switch', 'aria-label': name, style: { left: `${x - w / 2}%`, top: `${y - hh / 2}%`, width: `${w}%`, height: `${hh}%` } });
    sw.setAttribute('data-ctl', n);
    sw.disabled = original.disabled;
    let v = Number(original.getAttribute('aria-valuenow'));
    const help = (original.dataset && original.dataset.help);
    const show = () => {
      const i = Math.round(v - min);
      const word = meta.fmt ? meta.fmt(v) : String(v);
      marks.forEach((m, j) => m && m.classList.toggle('on', j === i));
      if (tag) tag.textContent = word;
      sw.setAttribute('aria-checked', String(v > min));
      sw.setAttribute('aria-valuetext', word);
      sw.title = `${name}: ${word}${help ? `. ${help}` : ''}. Click to switch.`;
      sw.classList.toggle('flip', i > 0);
    };
    const to = (nv) => { v = nv; show(); original.setValue(v, { emit: true, final: true }); };
    sw.onclick = () => !sw.disabled && to(v + 1 > max + 1e-9 ? min : v + 1);
    sw.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') to(Math.min(max, v + 1));
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') to(Math.max(min, v - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    const sync = (e) => { v = Number(e.detail); show(); };
    original.addEventListener('knobinput', sync);
    cleanup.push(() => original.removeEventListener('knobinput', sync));
    show();
    face.append(...marks.filter(Boolean), sw);
    if (tag) face.append(tag);
    count++;
  }
  // push buttons that pick one of a few (Invader's voices): the chosen one glows, the rest go dark
  for (const [n, rects] of Object.entries(item.buttons || {})) {
    const original = originals[n];
    if (!original) continue;
    const min = Number(original.getAttribute('aria-valuemin'));
    const meta = original._meta || {};
    // 4.20: a position with no button (null) is where you get by pressing the lit one again
    // (Tezcatl's arrows: press the moving one to stop)
    const rest = item.unpick?.[n];
    let cur = Number(original.getAttribute('aria-valuenow'));
    const bs = rects.map((r, i) => {
      if (!r) return null;
      const [x, y, w, hh] = r;
      const word = meta.labels ? meta.labels[i] : String(min + i);
      const b = h('button.gear-pushbtn', { type: 'button', 'aria-label': `${original.getAttribute('aria-label')}: ${word}`, title: rest !== undefined ? `${word}: click to use it, click again to stop` : `${word}: click to use it`, style: { left: `${x - w / 2}%`, top: `${y - hh / 2}%`, width: `${w}%`, height: `${hh}%` } });
      b.onclick = () => !b.disabled && original.setValue(rest !== undefined && Math.round(cur - min) === i ? rest : min + i, { emit: true, final: true });
      b.disabled = original.disabled;
      return b;
    });
    const show = (v) => ((cur = v), bs.forEach((b, i) => b && (b.classList.toggle('on', Math.round(v - min) === i), b.setAttribute('aria-pressed', String(Math.round(v - min) === i)))));
    const sync = (e) => show(Number(e.detail));
    original.addEventListener('knobinput', sync);
    cleanup.push(() => original.removeEventListener('knobinput', sync));
    show(Number(original.getAttribute('aria-valuenow')));
    face.append(...bs.filter(Boolean));
    count++;
  }
  // 4.20: buttons that each turn one thing on or off (Kitsune's tails, Nataraja's steps, Wukong's clones)
  for (const [n, [x, y, w, hh]] of Object.entries(item.toggles || {})) {
    const original = originals[n];
    if (!original) continue;
    const name = original.getAttribute('aria-label');
    const min = Number(original.getAttribute('aria-valuemin'));
    const b = h('button.gear-pushbtn.onoff', { type: 'button', 'aria-label': name, style: { left: `${x - w / 2}%`, top: `${y - hh / 2}%`, width: `${w}%`, height: `${hh}%` } });
    b.setAttribute('data-ctl', n);
    b.disabled = original.disabled;
    let v = Number(original.getAttribute('aria-valuenow'));
    const help = original.dataset && original.dataset.help;
    const show = () => {
      const on = v > min + 0.5;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.title = `${name}: ${on ? 'on' : 'off'}${help ? `. ${help}` : ''}. Click to turn it ${on ? 'off' : 'on'}.`;
    };
    b.onclick = () => { if (b.disabled) return; v = v > min + 0.5 ? min : min + 1; show(); original.setValue(v, { emit: true, final: true }); };
    const sync = (e) => { v = Number(e.detail); show(); };
    original.addEventListener('knobinput', sync);
    cleanup.push(() => original.removeEventListener('knobinput', sync));
    show();
    face.append(b);
    count++;
  }
  // 4.20: a lever or a ribbon that sets a saved control (Olympus's Thunder, Wukong's staff, Long's
  // Breath): drag along it; the part up to where it is set glows
  for (const [n, spec] of [...Object.entries(item.fills || {}).map(([k, v]) => [k, v, true]), ...Object.entries(item.hfills || {}).map(([k, v]) => [k, v, false])].map(([k, v, vert]) => [k, [v, vert]])) {
    const original = originals[n];
    if (!original) continue;
    const [[a, b0, b1, thick], vert] = spec;
    const name = original.getAttribute('aria-label');
    const min = Number(original.getAttribute('aria-valuemin')), max = Number(original.getAttribute('aria-valuemax'));
    const meta = original._meta || {};
    const style = vert ? { left: `${a - thick / 2}%`, top: `${b0}%`, width: `${thick}%`, height: `${b1 - b0}%` } : { top: `${a - thick / 2}%`, left: `${b0}%`, height: `${thick}%`, width: `${b1 - b0}%` };
    const el = h(`button.gear-fill${vert ? '' : '.horiz'}`, { type: 'button', role: 'slider', 'aria-label': name, 'aria-valuemin': String(min), 'aria-valuemax': String(max), 'aria-orientation': vert ? 'vertical' : 'horizontal', style });
    el.setAttribute('data-ctl', n);
    el.disabled = original.disabled;
    const glow = h('span.gf-glow', { 'aria-hidden': 'true' });
    const tip = h('span.gsl-tip');
    el.append(glow, tip);
    let v = Number(original.getAttribute('aria-valuenow'));
    const help = original.dataset && original.dataset.help;
    el.title = `${name}${help ? `: ${help}.` : ':'} Drag ${vert ? 'up or down' : 'across'} (Shift for fine), double-click to reset`;
    const show = () => {
      const t = (v - min) / (max - min || 1);
      glow.style[vert ? 'height' : 'width'] = `${t * 100}%`;
      tip.textContent = `${name} ${meta.fmt ? meta.fmt(v) : Math.round(v)}`;
      el.setAttribute('aria-valuenow', String(v));
      el.setAttribute('aria-valuetext', tip.textContent);
    };
    const push = (nv, final) => { if (el.disabled) return; v = Math.max(min, Math.min(max, nv)); show(); original.setValue(v, { emit: true, final }); };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || el.disabled) return;
      el.focus({ preventScroll: true });
      el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      let fine = null;
      const at = (ev) => {
        const t = vert ? 1 - (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
        if (ev.shiftKey && fine) { const d = vert ? fine.y - ev.clientY : ev.clientX - fine.x; fine = { x: ev.clientX, y: ev.clientY }; return v + (d / (vert ? r.height : r.width) / 4) * (max - min); }
        fine = { x: ev.clientX, y: ev.clientY };
        return min + Math.max(0, Math.min(1, t)) * (max - min);
      };
      push(at(e), false);
      const move = (ev) => push(at(ev), false);
      const up = () => {
        for (const [ev, fn] of [['pointermove', move], ['pointerup', up], ['pointercancel', up], ['lostpointercapture', up]]) el.removeEventListener(ev, fn);
        push(v, true);
      };
      for (const [ev, fn] of [['pointermove', move], ['pointerup', up], ['pointercancel', up], ['lostpointercapture', up]]) el.addEventListener(ev, fn);
      e.preventDefault();
    });
    const st = (max - min) / 100;
    el.addEventListener('wheel', (e) => { e.preventDefault(); push(v - Math.sign(e.deltaY) * st * (e.shiftKey ? 1 : 3), true); }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowRight') push(v + st * (e.shiftKey ? 10 : 1), true);
      else if (k === 'ArrowDown' || k === 'ArrowLeft') push(v - st * (e.shiftKey ? 10 : 1), true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('dblclick', () => original.dispatchEvent(new MouseEvent('dblclick')));
    const sync = (e) => { v = Number(e.detail); show(); };
    original.addEventListener('knobinput', sync);
    cleanup.push(() => original.removeEventListener('knobinput', sync));
    show();
    face.append(el);
    count++;
  }
  // a touch pad for two controls at once (Blorp's mouth): across is the first, up the second
  if (item.pad) {
    const [x, y, w, hh, nx, ny, shape] = item.pad;
    const ox = originals[nx], oy = originals[ny];
    if (ox && oy) {
      // 4.20: a round pad (Annwn's Veil, Event Horizon's Gravity, Tezcatl's mirror) and its own words
      const title = nx === 'mouth x' ? 'Drag the mouth: across for the first vowel sound, up and down for the second · arrow keys move it · double-click for the middle'
        : `Drag across for ${ox.getAttribute('aria-label')}${ox.dataset?.help ? ` (${ox.dataset.help.toLowerCase()})` : ''}, up and down for ${oy.getAttribute('aria-label')}${oy.dataset?.help ? ` (${oy.dataset.help.toLowerCase()})` : ''} · arrow keys move it · double-click for the middle`;
      const pname = nx === 'mouth x' ? 'Mouth' : ox.getAttribute('aria-label').replace(/\s*x$/i, '');
      const pad = h(`div.gear-pad${shape === 'round' ? '.round' : ''}`, { tabindex: '0', role: 'group', 'aria-label': `${pname}: drag across and up and down, or use the arrow keys · double-click for the middle`, title, style: { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${hh}%` } });
      const dot = h('span.gp-dot', { 'aria-hidden': 'true' }, h('i'));
      const tip = h('span.gsl-tip');
      pad.append(dot, tip);
      const lo = (o) => Number(o.getAttribute('aria-valuemin')), hi = (o) => Number(o.getAttribute('aria-valuemax'));
      let vx = Number(ox.getAttribute('aria-valuenow')), vy = Number(oy.getAttribute('aria-valuenow'));
      const show = () => {
        const tx = (vx - lo(ox)) / (hi(ox) - lo(ox)), ty = (vy - lo(oy)) / (hi(oy) - lo(oy));
        dot.style.left = `${tx * 100}%`;
        dot.style.top = `${(1 - ty) * 100}%`;
        tip.textContent = `${pname} ${Math.round(tx * 100)} / ${Math.round(ty * 100)}`;
        pad.setAttribute('aria-valuetext', tip.textContent);
      };
      const put = (nx2, ny2, final) => {
        if (ox.disabled) return;
        vx = Math.max(lo(ox), Math.min(hi(ox), nx2));
        vy = Math.max(lo(oy), Math.min(hi(oy), ny2));
        show();
        ox.setValue(vx, { emit: true, final });
        oy.setValue(vy, { emit: true, final });
      };
      pad.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || ox.disabled) return;
        pad.focus({ preventScroll: true });
        pad.setPointerCapture(e.pointerId);
        const r = pad.getBoundingClientRect();
        const at = (ev) => put(lo(ox) + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (hi(ox) - lo(ox)), lo(oy) + Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height)) * (hi(oy) - lo(oy)), false);
        at(e);
        pad.classList.add('active');
        const move = (ev) => at(ev);
        const up = () => {
          for (const [ev, fn] of [['pointermove', move], ['pointerup', up], ['pointercancel', up], ['lostpointercapture', up]]) pad.removeEventListener(ev, fn);
          pad.classList.remove('active');
          put(vx, vy, true);
        };
        pad.addEventListener('pointermove', move);
        pad.addEventListener('pointerup', up);
        pad.addEventListener('pointercancel', up);
        pad.addEventListener('lostpointercapture', up);
        e.preventDefault();
      });
      pad.addEventListener('keydown', (e) => {
        const st = e.shiftKey ? 10 : 2;
        const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        put(vx + d[0], vy + d[1], true);
      });
      pad.addEventListener('dblclick', () => put((lo(ox) + hi(ox)) / 2, (lo(oy) + hi(oy)) / 2, true));
      const sx = (e) => ((vx = Number(e.detail)), show()), sy = (e) => ((vy = Number(e.detail)), show());
      ox.addEventListener('knobinput', sx);
      oy.addEventListener('knobinput', sy);
      cleanup.push(() => (ox.removeEventListener('knobinput', sx), oy.removeEventListener('knobinput', sy)));
      // in Auto the mouth circles round the spot you left it on (shown as a ring)
      const mode = originals['talk/auto'];
      if (mode) {
        const sm = (v) => pad.classList.toggle('auto', Number(v) > 0);
        const fn = (e) => sm(e.detail);
        mode.addEventListener('knobinput', fn);
        cleanup.push(() => mode.removeEventListener('knobinput', fn));
        sm(mode.getAttribute('aria-valuenow'));
      }
      show();
      face.append(pad);
      count++;
    }
  }
  // footswitches: the pedal's on/off, and the ones you hold (Honk, Jump, Burst, Jam, Hold, Capture)
  const holdOf = (n) => [...controls.querySelectorAll('.rhold')].find((b) => b.getAttribute('data-moment') === n);
  const leds = {};
  for (const [n, [x, y]] of Object.entries(item.leds || {})) {
    leds[n] = h('span.gear-led', { 'aria-hidden': 'true', style: { left: `${x}%`, top: `${y}%` } });
    face.append(leds[n]);
  }
  for (const [n, pos] of Object.entries(item.stomps || {})) {
    const rect = pos[4] === 'rect';
    const style = rect ? { left: `${pos[0] - pos[2] / 2}%`, top: `${pos[1] - pos[3] / 2}%`, width: `${pos[2]}%`, height: `${pos[3]}%` } : { left: `${pos[0]}%`, top: `${pos[1]}%`, width: `${pos[2] * 2}%` };
    if (n === 'on') {
      if (!bypass) continue;
      const b = h(`button.gear-stomp${rect ? '.rect' : ''}`, { type: 'button', style });
      const paint = () => {
        const on = !!bypass.on();
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', on ? `${item.name}: on (stomp to turn it off)` : `${item.name}: off (stomp to turn it on)`);
        b.title = on ? 'On: stomp to bypass it' : 'Off: stomp to turn it on';
        leds.on?.classList.toggle('lit', on);
      };
      b.onclick = () => { bypass.toggle(); paint(); };
      paint();
      face.append(b);
      count++;
      continue;
    }
    const hold = holdOf(n);
    if (!hold) continue;
    const bit = Number(hold.getAttribute('data-bit')) || 0, type = hold.getAttribute('data-type') || 'hold';
    const b = h(`button.gear-stomp.momentary${rect ? '.rect' : ''}${pos[5] === 'button' ? '.btnface' : ''}`, { type: 'button', style, 'aria-label': hold.textContent.trim(), title: hold.title });
    const stop = holdable(b, key, bit, type);
    const lit = () => leds[n]?.classList.toggle('lit', labHeld(key, bit));
    rig.addEventListener('lab', lit);
    cleanup.push(stop, () => rig.removeEventListener('lab', lit));
    lit();
    face.append(b);
    count++;
  }
  // a spring-loaded lever (Boing's Bend): pull it down as far as you like; it springs back
  for (const [n, [x, top, bottom, w]] of Object.entries(item.lever || {})) {
    const hb = holdOf(n);
    if (!hb) continue;
    const lname = hb.textContent.trim();
    const pull = (v) => labLever(v, key);
    const lv = h('div.gear-lever', { tabindex: '0', role: 'slider', 'aria-label': `${lname} lever: pull down, it springs back`, 'aria-valuemin': '0', 'aria-valuemax': '100', title: `${lname}: pull the lever down as far as you like; it springs back when you let go (or hold the Down arrow)`, style: { left: `${x - w / 2}%`, top: `${top}%`, width: `${w}%`, height: `${bottom - top}%` } });
    const fill = h('span.gl-fill', { 'aria-hidden': 'true' });
    lv.append(fill);
    let pulling = false;
    const paint = () => { const v = labLeverAt(key); fill.style.height = `${v * 100}%`; lv.setAttribute('aria-valuenow', String(Math.round(v * 100))); lv.classList.toggle('held', v > 0.001); };
    lv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      lv.focus({ preventScroll: true });
      lv.setPointerCapture(e.pointerId);
      pulling = true;
      const r = lv.getBoundingClientRect();
      const at = (ev) => pull((ev.clientY - r.top) / r.height);
      at(e);
      const move = (ev) => pulling && at(ev);
      const up = () => {
        pulling = false;
        for (const [ev, fn] of [['pointermove', move], ['pointerup', up], ['pointercancel', up], ['lostpointercapture', up]]) lv.removeEventListener(ev, fn);
        pull(0);
      };
      lv.addEventListener('pointermove', move);
      lv.addEventListener('pointerup', up);
      lv.addEventListener('pointercancel', up);
      lv.addEventListener('lostpointercapture', up);
    });
    lv.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && !e.repeat) (e.preventDefault(), pull(1)); });
    lv.addEventListener('keyup', (e) => e.key === 'ArrowDown' && pull(0));
    lv.addEventListener('blur', () => pull(0));
    rig.addEventListener('lab', paint);
    cleanup.push(() => rig.removeEventListener('lab', paint));
    paint();
    face.append(lv);
    count++;
  }
  // a control that does nothing in the mode you're in is dimmed (Gobble's Rate in Hold, Blorp's Orbit in Talk)
  for (const original of controls.querySelectorAll('.rknob')) {
    const dim = original._dim;
    if (!dim) continue;
    const [ctl, is] = dim;
    const by = originals[ctl];
    if (!by) continue;
    const n = original.getAttribute('aria-label').toLowerCase();
    const apply = (v) => {
      const off = Math.round(Number(v)) === is;
      (original.closest ? original.closest('.gb-knob') || original : original).classList.toggle('dim', off);
      face.querySelectorAll(`[data-ctl="${CSS.escape(n)}"]`).forEach((el) => el.classList.toggle('dim', off));
    };
    const fn = (e) => apply(e.detail);
    by.addEventListener('knobinput', fn);
    cleanup.push(() => by.removeEventListener('knobinput', fn));
    apply(by.getAttribute('aria-valuenow'));
  }
  const helpText = !count ? 'Set this one with the knobs below' : slides === count ? 'Grab a slider and move it · Shift for fine · double-click to reset' : slides ? 'Grab a knob or a slider and drag · Shift for fine · double-click to reset' : 'Grab a knob and drag: up or right for more, down or left for less · Shift for fine · double-click to reset';
  wrap.append(face,h('small.gear-face-help',{text: item.stomps || item.switches ? 'Every knob, slider, switch and footswitch on the picture works · hold a footswitch to use it · double-click a control to reset it' : helpText}));
  if (!enlarged) {
    const zoom = h('button.btn.small.soft.gear-enlarge',{type:'button',text:'Get up close',title:'Open this gear big, with the same live knobs'});
    zoom.onclick=()=>{const large=gearFaceplate(key,controls,{enlarged:true,bypass});modal({title:item.name,wide:true,body:large,onClose:()=>large.dispose()});};
    wrap.append(zoom);
  }
  wrap.dispose=()=>cleanup.forEach(fn=>fn());
  return wrap;
}

/** Rock Opera: the tone's gear set up on a stage. Pedals on the floor, the amp head
 * stacked on its cabinet, rack units off to the side. Click a piece to open it. */
export function gearLineup(tone, { onPick } = {}) {
  const box = h('div.gear-lineup', { role: 'list', 'aria-label': 'The gear in this tone' });
  const gear = orderedGear(tone);
  const piece = (g, i, extra = '') => {
    const b = h(`button.lineup-piece.${g.slot}${extra}${g.bypass ? '.bypass' : ''}`, { type: 'button', role: 'listitem', title: `${shortGearName(g.key)}${g.bypass ? ' (off)' : ''}` });
    b.append(h('span.lp-art', { html: gearArt(g), 'aria-hidden': 'true' }), h('span.lp-name', { text: shortGearName(g.key) }));
    b.onclick = () => onPick && onPick(i, g);
    return b;
  };
  const pre = h('div.lineup-floor.pre'), post = h('div.lineup-floor.post'), racks = h('div.lineup-rack');
  const stack = h('div.lineup-stack');
  gear.forEach((g, i) => {
    if (g.slot === 'amp') stack.prepend(piece(g, i));
    else if (g.slot === 'cab') stack.append(piece(g, i));
    else if (g.slot === 'rack') racks.append(piece(g, i));
    else (g.slot === 'pre' ? pre : post).append(piece(g, i, '.pedal'));
  });
  for (const part of [pre, stack, post, racks]) if (part.children.length) box.append(part);
  return box;
}

/** The signal chain: gear blocks joined by glowing cables. */
export function chainEl(tone, { selected = -1, onPick, onAdd, sub } = {}) {
  const box = h('div.chain', { role: 'list', 'aria-label': 'Signal chain' });
  const gear = orderedGear(tone);
  gear.forEach((g, i) => {
    const kind = TYPE_NAMES[g.slot] || 'Pedal';
    const gel = TYPE_GELS[g.slot] || '#ff4d8d';
    const b = h(`button.block${g.slot === 'amp' ? '.amp' : ''}${g.bypass ? '.bypass' : ''}`, { type: 'button', role: 'listitem', 'aria-pressed': String(i === selected), style: { '--gel': gel }, title: g.bypass ? 'Bypassed' : '' });
    // a real amp (NAM capture) in the amp's place shows REAL
    const real = g.slot === 'amp' && !g.bypass && resolveCapture(tone);
    b.innerHTML = `<span class="bk-top"><span class="bk-kind">${esc(kind)}</span>${real ? `<span class="real-badge sm" title="${esc(`Real amp: ${real.pack.title}`)}">REAL</span>` : ''}<span class="led"></span></span><span class="bk-name">${esc(shortGearName(g.key))}</span>${sub ? `<span class="bk-sub">${esc(sub(g) || '')}</span>` : ''}`;
    if (real) b.classList.add('real');
    // 4.1.7: a picture of the piece (Stagehand's own drawing)
    b.prepend(h('span.bk-art', { html: gearArt(g), 'aria-hidden': 'true' }));
    b.onclick = () => onPick && onPick(i, g);
    if (i === selected) b.classList.add('lit');
    const link = h('div.link', null, b);
    if (i < gear.length - 1 || onAdd) link.append(h('span.cable', { 'aria-hidden': 'true', style: { animationDelay: `${(-0.12 * i).toFixed(2)}s` } }));
    box.append(link);
  });
  if (onAdd) {
    const add = h('button.block.add', { type: 'button', text: '+ Add' });
    add.onclick = (e) => onAdd(e);
    box.append(add);
  }
  return { el: box, gear };
}

/** A short summary of a block's main knobs, for the chain. */
export function gearSummary(g) {
  const ks = knobsOf(g).slice(0, 2);
  return ks.map((k) => `${k.name} ${fmtKnob(k, k.value)}`).join(' · ');
}

// ------------------------------------------------------------ tone demos --
const D = { src: null, gain: null, ctx: null, playing: null, cache: new Map() };

export function demoPlaying() {
  return D.playing;
}

/** Plays a short riff through a tone (on the same output as the song). id marks which button shows as playing. */
export async function playDemo(tone, id, onEnd) {
  stopDemo();
  if (!tone || !tone.gear || !tone.gear.length) return;
  D.playing = id || 'demo';
  const done = () => {
    if (D.playing === (id || 'demo')) D.playing = null;
    if (onEnd) onEnd();
    document.dispatchEvent(new Event('sh-demo'));
  };
  try {
    const { ctx, node } = await engine.extraOut();
    if (D.ctx !== ctx) {
      D.ctx = ctx;
      D.gain = ctx.createGain();
      D.gain.gain.value = 0.9;
      D.gain.connect(node);
    }
    const rate = ctx.sampleRate;
    const cap = resolveCapture(tone);
    const key = `v2|${rate}|${tone.kind}|${JSON.stringify(tone.gear)}|${cap ? `${cap.path}|${cap.gainRef}` : ''}`;
    let out = D.cache.get(key);
    if (!out) {
      const di = demoRiff(rate, tone.kind === 'bass' ? 'bass' : 'guitar', tone);
      out = await renderTone(tone, di, rate, { input: 0.5, volume: 0.7 });
      D.cache.set(key, out);
      if (D.cache.size > 12) D.cache.delete(D.cache.keys().next().value);
    }
    if (D.playing !== (id || 'demo')) return;
    const b = ctx.createBuffer(2, out.L.length, rate);
    b.copyToChannel(out.L, 0);
    b.copyToChannel(out.R, 1);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(D.gain);
    s.onended = () => {
      if (D.src === s) D.src = null;
      done();
    };
    s.start();
    D.src = s;
  } catch (err) {
    D.playing = null;
    toast({ title: 'Couldn’t play the demo', message: err.message, kind: 'err' });
    if (onEnd) onEnd();
  }
}

export function stopDemo() {
  const s = D.src;
  D.src = null;
  const was = D.playing;
  D.playing = null;
  if (was) setTimeout(() => document.dispatchEvent(new Event('sh-demo')), 0);
  if (s) {
    try {
      s.onended = null;
      s.stop();
    } catch (_) {}
  }
}

/** A ▶ button that plays a tone's demo riff and shows when it's playing. */
export function demoButton(tone, id, { label = '', cls = '' } = {}) {
  const b = h(`button.demo-btn${cls ? `.${cls}` : ''}`, { type: 'button', 'aria-label': `Hear a demo riff${tone && tone.name ? `: ${tone.name}` : ''}` });
  const paint = () => {
    const on = D.playing === id;
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `${on ? '<span class="eq"><i></i><i></i><i></i></span>' : icon('play')}${label ? `<span>${esc(on ? 'Playing…' : label)}</span>` : ''}`;
  };
  b.onclick = (e) => {
    e.stopPropagation();
    if (D.playing === id) {
      stopDemo();
      paint();
    } else {
      playDemo(tone, id, paint);
      paint();
      document.dispatchEvent(new Event('sh-demo'));
    }
  };
  const onAny = () => {
    if (!b.isConnected) return document.removeEventListener('sh-demo', onAny);
    paint();
  };
  document.addEventListener('sh-demo', onAny);
  paint();
  return b;
}
