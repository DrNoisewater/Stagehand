/**
 * 4.12: the spec sheet under a piece's knobs on the Gear page: the real gear it's modelled on,
 * what it does in plain words, and every knob spelled out (the tooltips were hard to read).
 * Words live in data/gear-about.json: key (cabinets by family, without the mic) → { real, about, guess, try }
 * (guess: the real name is likely, not certain; try: 4.22, how to hear it working).
 *
 * 4.22: the same sheet sits under the controls in Create a tone, the Tones page and step by step's
 * Pedals too, and lists the footswitches and levers as well as the knobs, with each switch's
 * positions. linkSheet() lights up the line of whatever control is being turned or pressed.
 *
 * 4.23: the user: "too intrusive, seeing the pedal full size is a major feature … the descriptive area
 * should be naturally incorporated into the section". Where the picture and its controls are shown
 * (the Gear page, Create a tone, the Tones page) there's no sheet any more: describeControls() writes
 * each control's words right beside that control, and aboutBlurb() puts what the piece does in a few
 * quiet lines above them (the rest a click away). The sheet stays for cabinets and step by step's fold.
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

const KIND = { hold: 'Footswitch: hold it', tap: 'Footswitch: press it', latch: 'Button: click on, click off', lever: 'Lever: pull it, it springs back' };

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

/** 4.23: what the piece does, in a few quiet lines at the top of its controls: the gist (three lines,
 * "More" opens the rest), what it's modelled on, and how to hear it working. */
export function aboutBlurb(it) {
  const box = h('div.gc-about');
  const fill = () => {
    box.textContent = '';
    const a = aboutOf(it.key) || {};
    if (a.real) box.append(h('p.gc-real', null, h('small', { text: a.guess ? 'Probably based on ' : 'Modelled on ' }), h('b', { text: a.real })));
    if (a.about) box.append(h('p.gc-text', { text: a.about }));
    // the rest stays a click away: the whole text, and how to hear it working
    const links = h('div.gc-links');
    const more = h('button.gc-more', { type: 'button', text: 'More', 'aria-expanded': 'false' });
    more.onclick = () => more.setAttribute('aria-expanded', String(box.classList.toggle('open')));
    if (a.about) links.append(more);
    if (a.try) {
      const tip = h('p.gc-try', { hidden: true }, a.try);
      const hear = h('button.gc-more', { type: 'button', text: 'Hear it working', 'aria-expanded': 'false' });
      hear.onclick = () => {
        tip.hidden = !tip.hidden;
        hear.setAttribute('aria-expanded', String(!tip.hidden));
      };
      links.append(hear);
      box.append(links, tip);
    } else if (a.about) box.append(links);
    if (a.about) requestAnimationFrame(() => {
      const t = box.querySelector('.gc-text');
      more.hidden = !!t && t.scrollHeight <= t.clientHeight + 2 && !box.classList.contains('open');
    });
    box.hidden = !box.childNodes.length;
  };
  if (ABOUT) fill();
  else loadAbout().then(fill);
  return box;
}

/** 4.23: each control's words beside that control. box holds the controls (knob cells, knobs,
 * footswitches); each becomes a row: the control, then what it does (and a switch's positions).
 * Lines light while their control is used (linkSheet on the same box). */
export function describeControls(box, key) {
  if (!box) return box;
  const lines = new Map(controlLines(key).map((l) => [l.name.toLowerCase(), l]));
  const words = (name) => {
    const l = lines.get(String(name || '').toLowerCase());
    if (!l) return null;
    const p = h('p.gc-say', { 'data-ctl': l.name.toLowerCase() }, h('b', { text: l.name }), l.kind && l.kind !== 'On/off' ? h('small.gc-kind', { text: l.kind }) : '', h('span', { text: l.text }));
    if (l.positions) p.append(h('small.gc-pos', { text: l.positions }));
    return p;
  };
  const rowFor = (ctl, name, holder = ctl) => {
    const say = words(name);
    if (!say) return;
    const row = h(`div.gc-row${ctl.matches('.rhold') ? '.gc-foot' : ''}`);
    holder.replaceWith(row);
    row.append(holder, say);
  };
  for (const el of [...box.children]) {
    if (el.matches('.gb-holds')) {
      for (const b of [...el.children]) if (b.matches('.rhold')) rowFor(b, b.dataset.moment);
      el.classList.add('gc-feet');
      continue;
    }
    if (el.matches('.rhold')) rowFor(el, el.dataset.moment);
    else if (el.matches('.rknob')) rowFor(el, el.getAttribute('aria-label'));
    else {
      const k = el.querySelector('.rknob[aria-label]');
      if (k) rowFor(k, k.getAttribute('aria-label'), el);
    }
  }
  box.classList.add('described');
  return box;
}
