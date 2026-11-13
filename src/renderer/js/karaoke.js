/**
 * Karaoke (4.12): a page of its own on the left. Every song of yours that has
 * words; pick one and it opens with the stage to yourself: the words big up
 * top, no neck and no notes, the singer taken out when the song has been
 * split. (The Sing button on the highway is the other kind: singing scored
 * beside your guitar part.)
 */
import { state, on, hasPart } from './store.js';
import { h, icon } from './ui.js';
import * as actions from './actions.js';
import { coverEl } from './shell.js';
import { mic } from './mic.js';
import { SING_LEVELS } from './sing.js';
import { singLevel, setSingLevel } from './singlane.js';

const root = document.getElementById('page-karaoke');
const MOST = 240; // cards drawn at once; search narrows it
let q = '';

function songs() {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return [...state.songs.values()]
    .filter((s) => hasPart(s, 'vocals'))
    .filter((s) => !words.length || words.every((w) => `${s.title || ''} ${s.artist || ''} ${s.album || ''}`.toLowerCase().includes(w)))
    .sort((a, b) => String(a.artist || '').localeCompare(String(b.artist || '')) || String(a.title || '').localeCompare(String(b.title || '')));
}

function card(s) {
  const best = state.best && state.best[s.id] ? state.best[s.id].vocals : undefined;
  const b = h('button.kk-card', { type: 'button', title: `Sing ${s.title || 'this song'}` }, coverEl(s, 256), h('span.kk-play', { html: icon('mic') }), h('b', { text: s.title || 'Untitled' }), h('span', { text: s.artist || '' }));
  if (best !== undefined && best !== null) b.append(h('span.kk-best', { text: `Best ${Math.round(best * 100)}%` }));
  b.onclick = () => actions.playKaraoke(s.id);
  return b;
}

function grid() {
  const list = songs();
  const box = h('div.kk-grid');
  for (const s of list.slice(0, MOST)) box.append(card(s));
  const wrap = h('div.kk-list', null, box);
  if (!list.length) {
    const any = [...state.songs.values()].some((s) => hasPart(s, 'vocals'));
    wrap.prepend(h('p.kk-empty', { text: any ? 'No song matches that.' : state.songs.size ? 'None of your songs has words to sing yet. Songs with a vocals part show up here.' : 'Add songs to your library and the ones with words show up here.' }));
  } else if (list.length > MOST) wrap.append(h('p.kk-more', { text: `Showing ${MOST} of ${list.length}. Type to find a song.` }));
  return wrap;
}

function render() {
  if (state.page !== 'karaoke') return;
  root.innerHTML = '';
  const search = h('input.input.kk-search', { type: 'search', placeholder: 'Find a song or an artist', value: q, 'aria-label': 'Find a song to sing' });
  let listEl = grid();
  search.oninput = () => {
    q = search.value;
    const next = grid();
    listEl.replaceWith(next);
    listEl = next;
  };
  const levels = h('div.kk-levels', { role: 'group', 'aria-label': 'How strict the scoring is' });
  for (const [id, l] of Object.entries(SING_LEVELS)) {
    const b = h('button', { type: 'button', text: l.name, 'aria-pressed': String(singLevel() === id) });
    b.onclick = () => {
      setSingLevel(id);
      for (const x of levels.children) x.setAttribute('aria-pressed', String(x === b));
    };
    levels.append(b);
  }
  const micBtn = h('button.btn.small.soft', { type: 'button', html: `${icon('mic')}<span>${mic.label ? mic.label : 'Microphone'}</span>`, title: 'Choose and try your microphone' });
  micBtn.onclick = () => import('./dialogs.js').then((d) => d.settings('guitar'));
  root.append(
    h('div.kk-head', null, h('div', null, h('h1.page-title', { text: 'Karaoke' }), h('p.kk-sub', { text: 'Pick a song and sing. The words go big on the stage, the singer steps out when the song has been split, and your singing is scored.' })), h('span.grow'), levels, micBtn),
    search,
    listEl
  );
}

on('page', render);
on('library', render);
on('stats', render);
mic.addEventListener('change', () => state.page === 'karaoke' && !mic.on && render());
render();
