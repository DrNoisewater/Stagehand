/**
 * 4.12: the spec sheet under a piece's knobs on the Gear page: the real gear it's modelled on,
 * what it does in plain words, and every knob spelled out (the tooltips were hard to read).
 * Words live in data/gear-about.json: key (cabinets by family, without the mic) → { real, about, guess, try }
 * (guess: the real name is likely, not certain; try: 4.22, how to hear it working).
 *
 * 4.22: the same sheet sits under the controls in Create a tone, the Tones page and step by step's
 * Pedals too, and lists the footswitches and levers as well as the knobs, with each switch's
 * positions. linkSheet() lights up the line of whatever control is being turned or pressed.
 */
import { h } from './ui.js';
import { gearInfo, gearName } from './gearspec.js';
import { knobHelp, MICS } from './gearbench.js';
import { labHelp } from './rigui.js';

let ABOUT = null;
let loading = null;

export function loadAbout() {
  if (ABOUT) return Promise.resolve(ABOUT);
  if (!loading)
    loading = fetch(new URL('../data/gear-about.json', import.meta.url))
      .then((r) => r.json())
      .then((j) => (ABOUT = j))
      .catch(() => (ABOUT = {}));
  return loading;
}

export const aboutOf = (key) => (ABOUT && ABOUT[key]) || null;

const MIC_LINES = [
  ...MICS.map(([, label, hint]) => [`${label} mic`, hint]),
  ['Mic position', knobHelp('mic position')],
  ['Distance', knobHelp('mic distance')],
  ['Angle', knobHelp('mic angle')],
  ['Room mic', knobHelp('room mic')],
];

const sentence = (s) => {
  const t = String(s || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : '';
};

const KIND = { hold: 'Footswitch: click on, click off', tap: 'Footswitch: press it', latch: 'Button: click on, click off', lever: 'Lever: pull it (or click to hold it down)' };

/** Every control of a piece, in plain words: [{ name, kind, text, positions }]. Knobs first (as on
 * the strip), then the footswitches and levers. */
export function controlLines(key) {
  const info = gearInfo(key) || {};
  const out = [];
  for (const [name, , min, max, , o] of info.k || []) {
    const opt = o || {};
    let kind = '';
    if (opt.labels && opt.labels.length === 2 && /^(off|on)$/i.test(opt.labels[0])) kind = 'On/off';
    else if (opt.labels) kind = 'Switch';
    else if (max - min <= 1 && !opt.unit) kind = 'Switch';
    out.push({ name, kind, text: sentence(opt.help || knobHelp(name)), positions: opt.labels && !(kind === 'On/off') ? opt.labels.join(' · ') : '' });
  }
  for (const [name, type] of info.m || []) out.push({ name, kind: KIND[type] || 'Footswitch', text: sentence(labHelp(key, { name, type })), live: true });
  return out;
}

/** The card. it: a showroom item ({ key, t, name }); keyNow: the gear key in use (a cabinet's mic choice). */
export function aboutCard(it, keyNow) {
  const card = h('section.gear-about', { 'aria-label': `About the ${it.name || gearName(it.key)}` });
  const fill = () => {
    card.textContent = '';
    const a = aboutOf(it.key) || {};
    card.append(h('span.gear-about-tape', { text: a.real ? 'The real thing' : 'How it works' }));
    if (a.real) card.append(h('p.gear-about-real', null, h('small', { text: a.guess ? 'Probably based on' : 'Modelled on' }), h('b', { text: a.real })));
    if (a.about) card.append(h('p.gear-about-text', { text: a.about }));
    // 4.22: how to tell it's working (some only do anything once a footswitch is used)
    if (a.try) card.append(h('div.gear-about-try', null, h('b', { text: 'Hear it working' }), h('p', { text: a.try })));
    if (it.t === 'cab') {
      const dl = h('dl.gear-about-knobs');
      for (const [name, text] of MIC_LINES) dl.append(h('dt', { text: name }), h('dd', { text }));
      card.append(h('h3', { text: 'The mic' }), dl);
      return;
    }
    const lines = controlLines(keyNow || it.key);
    if (!lines.length) return;
    const dl = h('dl.gear-about-knobs');
    for (const l of lines) {
      const id = l.name.toLowerCase();
      dl.append(
        h('dt', { 'data-ctl': id }, h('span', { text: l.name }), l.kind ? h('small', { text: l.kind }) : ''),
        h('dd', { 'data-ctl': id }, l.text, l.positions ? h('small.gear-about-pos', { text: `Positions: ${l.positions}` }) : '')
      );
    }
    const knobs = lines.filter((l) => !l.live).length;
    const sw = lines.length - knobs;
    card.append(h('h3', { text: sw && knobs ? 'Every knob and footswitch' : sw ? (sw === 1 ? 'The footswitch' : 'The footswitches') : knobs === 1 ? 'The knob' : 'The knobs' }), dl);
  };
  if (ABOUT) fill();
  else loadAbout().then(fill);
  return card;
}

/**
 * 4.24: the sheet folds into one line ("What every control does") so the gear always stays big. Open
 * or folded is remembered for every piece (folded to start with). The sheet inside is the same card,
 * so turning a knob still lights its line.
 */
const FOLD_KEY = 'stagehand.sheetOpen';
export function sheetFold(card, { label = 'What every control does' } = {}) {
  let open = false;
  try {
    open = localStorage.getItem(FOLD_KEY) === '1';
  } catch (_) {}
  const d = h('details.gear-sheet', null, h('summary', null, h('span', { text: label }), h('small', { text: 'what it is, how to hear it, every knob' })), card);
  d.open = open;
  d.addEventListener('toggle', () => {
    try {
      localStorage.setItem(FOLD_KEY, d.open ? '1' : '0');
    } catch (_) {}
  });
  return d;
}

/**
 * 4.24: the gear's photo as big as the screen allows, to see every detail (click or Esc to close).
 * Adds a small "Full size" button to a photo holder (an element with an <img> of the gear in it).
 */
export function fullSizeButton(holder) {
  if (!holder) return holder;
  const img = holder.querySelector('img');
  if (!img) return holder;
  const b = h('button.gear-full-btn', { type: 'button', title: 'See it full size', 'aria-label': 'See it full size', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><span>Full size</span>' });
  b.onclick = (e) => {
    e.stopPropagation();
    const view = h('div.gear-full', { role: 'dialog', 'aria-label': img.alt || 'Gear, full size' }, h('img', { src: img.getAttribute('src'), alt: img.alt || '' }), h('small', { text: 'Click anywhere or press Esc to close' }));
    const close = () => (view.remove(), document.removeEventListener('keydown', key, true));
    const key = (ev) => ev.key === 'Escape' && (ev.stopPropagation(), close());
    view.onclick = close;
    document.addEventListener('keydown', key, true);
    document.body.append(view);
  };
  holder.append(b);
  return holder;
}

/** 4.22: light up a control's line on the sheet while it's being turned or pressed. root holds the
 * controls (the strip, the photo, the footswitches). Returns a function that stops it. */
export function linkSheet(root, card) {
  if (!root || !card) return () => {};
  let off = 0;
  const light = (name) => {
    if (!name) return;
    const id = String(name).toLowerCase();
    const rows = card.querySelectorAll(`[data-ctl="${CSS.escape(id)}"]`);
    if (!rows.length) return;
    card.querySelectorAll('.lit').forEach((e) => e.classList.remove('lit'));
    rows.forEach((e) => e.classList.add('lit'));
    clearTimeout(off);
    off = setTimeout(() => rows.forEach((e) => e.classList.remove('lit')), 2500);
  };
  const nameOf = (t) => {
    const el = t && t.closest && t.closest('[data-moment], .rknob, [role="slider"], button[aria-label]');
    if (!el) return '';
    if (el.dataset.moment) return el.dataset.moment;
    return el.getAttribute('aria-label') || '';
  };
  // knobs say what moved through their own event (it doesn't bubble), so catch it on the way down
  const onKnob = (e) => light(nameOf(e.target));
  const onDown = (e) => light(nameOf(e.target));
  root.addEventListener('knobinput', onKnob, true);
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('focusin', onDown, true);
  return () => {
    clearTimeout(off);
    root.removeEventListener('knobinput', onKnob, true);
    root.removeEventListener('pointerdown', onDown, true);
    root.removeEventListener('focusin', onDown, true);
  };
}
