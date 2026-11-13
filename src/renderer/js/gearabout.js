/**
 * 4.12: the spec sheet under a piece's knobs on the Gear page: the real gear it's modelled on,
 * what it does in plain words, and every knob spelled out (the tooltips were hard to read).
 * Words live in data/gear-about.json: key (cabinets by family, without the mic) → { real, about, guess } (guess: the real name is likely, not certain).
 */
import { h } from './ui.js';
import { gearInfo } from './gearspec.js';
import { knobHelp, MICS } from './gearbench.js';

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

/** The card. it: a showroom item ({ key, t, name }); keyNow: the gear key in use (a cabinet's mic choice). */
export function aboutCard(it, keyNow) {
  const a = aboutOf(it.key) || {};
  const card = h('section.gear-about', { 'aria-label': `About the ${it.name}` });
  card.append(h('span.gear-about-tape', { text: 'The real thing' }));
  if (a.real) card.append(h('p.gear-about-real', null, h('small', { text: a.guess ? 'Probably based on' : 'Modelled on' }), h('b', { text: a.real })));
  if (a.about) card.append(h('p.gear-about-text', { text: a.about }));
  const lines = it.t === 'cab' ? MIC_LINES : ((gearInfo(keyNow || it.key) || {}).k || []).map(([name]) => [name, knobHelp(name)]);
  if (lines.length) {
    const dl = h('dl.gear-about-knobs');
    for (const [name, text] of lines) dl.append(h('dt', { text: name }), h('dd', { text }));
    card.append(h('h3', { text: it.t === 'cab' ? 'The mic' : lines.length === 1 ? 'The knob' : 'The knobs' }), dl);
  }
  return card;
}
