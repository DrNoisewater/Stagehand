/**
 * 4.9: cameos. A character or a scrap of paper that makes an entrance at a moment that
 * matters: a level up, the end of a song, a new best, the tuning card, a saved tone…
 * Decoration only: no audio, scoring or highway dependencies. Hidden with
 * Settings › Appearance › Less decoration; no motion with Calmer interface or the
 * system's reduced motion (css/cameo.css).
 *
 *   cameo('event-best', { enter: 'rise', place: 'top-right' })   a character from an art pool
 *   scrap('one-more-run', { enter: 'slap' })                     a scrap from art/scraps
 */
import { h } from './ui.js';
import { ART, PLACEMENTS, EVENTS } from './identity-art.js';

const last = {};
/** One id from a pool, never the same twice in a row. */
export function pickArt(pool) {
  const list = (EVENTS[pool] || PLACEMENTS[pool] || []).filter((id) => ART.some((a) => a.id === id));
  if (!list.length) return null;
  const opts = list.length > 1 ? list.filter((x) => x !== last[pool]) : list;
  return (last[pool] = opts[Math.floor(Math.random() * opts.length)]);
}

export const ENTRANCES = ['rise', 'drop', 'slide-l', 'slide-r', 'slap', 'peek', 'spin'];
const tilt = () => `${(Math.random() * 10 - 5).toFixed(1)}deg`;

function img(file, id, { enter = 'rise', place = '', cls = '', delay = 0, size } = {}) {
  const el = h(`img.cameo${cls ? `.${cls}` : ''}`, { alt: '', 'aria-hidden': 'true', decoding: 'async', draggable: 'false' });
  el.dataset.enter = enter === 'any' ? ENTRANCES[Math.floor(Math.random() * ENTRANCES.length)] : enter;
  if (place) el.dataset.place = place;
  el.dataset.art = id;
  el.style.setProperty('--tilt', tilt());
  if (delay) el.style.setProperty('--delay', `${delay}ms`);
  if (size) el.style.setProperty('--size', `${size}px`);
  el.onerror = () => el.remove();
  el.src = `art/${file}`;
  return el;
}

/** A character from an art pool, or null when the pool is empty. */
export function cameo(pool, opts = {}) {
  const id = pickArt(pool);
  const item = id && ART.find((a) => a.id === id);
  return item ? img(item.file, id, opts) : null;
}

/** A scrap from art/scraps by name (e.g. 'tune-first', 'yellow-highlighter-swipe'). */
export function scrap(name, opts = {}) {
  const item = ART.find((a) => a.id === `scrap-${name}`);
  return item ? img(item.file, item.id, { enter: 'slap', ...opts, cls: `cameo-scrap${opts.cls ? `.${opts.cls}` : ''}` }) : null;
}

/** The URL of a scrap, for CSS backgrounds. */
export const scrapUrl = (name) => {
  const item = ART.find((a) => a.id === `scrap-${name}`);
  return item ? `url("${new URL(`art/${item.file}`, location.href).href}")` : 'none';
};

/**
 * Slap a scrap or character onto an element for a moment (a stamp on the rig when a tone
 * is saved…). It leaves by itself after `ms`.
 */
export function stamp(host, el, ms = 2600) {
  if (!host || !el) return;
  el.classList.add('cameo-stamp');
  host.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 450);
  }, ms);
}
