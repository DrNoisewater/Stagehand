/**
 * 3.10: the titlebar search box. Suggestions as you type (songs, artists,
 * albums, tunings, years, setlists; best group first), the rest of the best
 * match shown faintly for Tab to finish, recent searches when the box is empty.
 * In Discover the same box searches MusicBrainz and shows no suggestions.
 */
import { state, emit, on, bump, setPage, setView } from './store.js';
import { suggest, completion } from './searchmatch.js';
import { h, icon, esc } from './ui.js';
import * as library from './library.js';
import * as discover from './discover.js';

const input = document.getElementById('search');
const box = input.closest('.search');
const inDiscover = () => state.page === 'discover' && state.view.kind === 'discover';

// the faint rest-of-the-word after what you typed
const ghost = h('span.search-ghost', { 'aria-hidden': 'true' }, h('span.typed'), h('span.rest'));
input.before(ghost);
const wrap = h('span.search-field');
ghost.before(wrap);
wrap.append(ghost, input);

const pop = h('div.search-pop', { id: 'search-pop', role: 'listbox', hidden: true });
document.body.append(pop);
input.setAttribute('role', 'combobox');
input.setAttribute('aria-controls', 'search-pop');
input.setAttribute('aria-expanded', 'false');
input.setAttribute('aria-autocomplete', 'both');

let items = []; // flat, in the order shown
let active = -1;
let rest = ''; // what Tab would add

// ------------------------------------------------------------- recents --
const RECENT_KEY = 'stagehand.recentSearches';
function recents() {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(r) ? r.filter((x) => typeof x === 'string') : [];
  } catch (_) {
    return [];
  }
}
export function remember(q) {
  q = String(q || '').trim();
  if (q.length < 2) return;
  const r = [q, ...recents().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(r));
  } catch (_) {}
}
function forget() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch (_) {}
}

// ------------------------------------------------------------ the list --
const GROUP = { song: 'Songs', artist: 'Artists', album: 'Albums', tuning: 'Tunings', year: 'Year', setlist: 'Setlists', recent: 'Recent searches' };
const ICON = { song: 'music', artist: 'person', album: 'library', tuning: 'tuning', year: 'clock', setlist: 'setlist', recent: 'history', all: 'search', online: 'globe' };

function mark(label, q) {
  // bold the part you typed, where it's plainly there
  const t = String(q || '').trim();
  const i = t ? label.toLowerCase().indexOf(t.toLowerCase()) : -1;
  if (i < 0) return esc(label);
  return `${esc(label.slice(0, i))}<b>${esc(label.slice(i, i + t.length))}</b>${esc(label.slice(i + t.length))}`;
}

function build() {
  const raw = input.value;
  const q = raw.trim();
  items = [];
  active = -1;
  pop.innerHTML = '';
  if (inDiscover() || document.activeElement !== input) return close();
  if (!q) {
    const r = recents();
    if (!r.length) return close();
    const head = h('div.sp-head', null, h('span', { text: GROUP.recent }));
    const clr = h('button.sp-clear', { type: 'button', text: 'Clear' });
    clr.addEventListener('mousedown', (e) => e.preventDefault());
    clr.onclick = () => {
      forget();
      build();
    };
    head.append(clr);
    pop.append(head);
    for (const x of r) add({ kind: 'recent', label: x, sub: '' }, '');
    return open();
  }
  const groups = suggest(q, [...state.songs.values()], state.setlists || []);
  rest = completion(raw, groups);
  for (const g of groups) {
    pop.append(h('div.sp-head', null, h('span', { text: GROUP[g.kind] }), g.more > 0 ? h('span.sp-more', { text: `+${g.more} more` }) : null));
    for (const it of g.items) add(it, q);
  }
  // always: see every match in the list, or look further afield
  pop.append(h('div.sp-sep'));
  const n = groups.find((g) => g.kind === 'song');
  const count = n ? n.items.length + n.more : 0;
  add({ kind: 'all', label: count ? `Show all ${count} matching song${count === 1 ? '' : 's'}` : `No songs match “${q}”`, sub: count ? 'Enter' : '' }, '');
  add({ kind: 'online', label: `Find “${q.length > 32 ? q.slice(0, 32) + '…' : q}” on MusicBrainz`, sub: 'songs you don’t have yet' }, '');
  showGhost();
  open();
}

function add(it, q) {
  const i = items.length;
  items.push(it);
  const el = h('div.sp-item', { role: 'option', id: `sp-${i}`, 'aria-selected': 'false' });
  el.dataset.i = i;
  el.dataset.kind = it.kind;
  el.innerHTML = `<span class="sp-ic">${icon(ICON[it.kind] || 'search')}</span><span class="sp-label">${it.kind === 'all' || it.kind === 'online' ? esc(it.label) : mark(it.label, q)}</span>${it.sub ? `<span class="sp-sub">${esc(it.sub)}</span>` : ''}`;
  if (it.kind === 'all' && !/^Show/.test(it.label)) el.classList.add('dim');
  // keep the focus in the box: the click picks, the box stays put
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('mousemove', () => highlight(i, { scroll: false }));
  el.addEventListener('click', () => pick(i));
  pop.append(el);
}

function place() {
  const r = box.getBoundingClientRect();
  pop.style.left = `${Math.round(r.left)}px`;
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  pop.style.width = `${Math.round(Math.max(r.width, 360))}px`;
  pop.style.maxHeight = `${Math.max(200, window.innerHeight - r.bottom - 24)}px`;
}
function open() {
  place();
  pop.hidden = false;
  box.classList.add('popped');
  input.setAttribute('aria-expanded', 'true');
}
export function close() {
  pop.hidden = true;
  box.classList.remove('popped');
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  active = -1;
  hideGhost();
}
const isOpen = () => !pop.hidden && items.length > 0;

function highlight(i, { scroll = true } = {}) {
  active = i;
  pop.querySelectorAll('.sp-item').forEach((el) => {
    const on = Number(el.dataset.i) === i;
    el.classList.toggle('on', on);
    el.setAttribute('aria-selected', String(on));
    if (on && scroll) el.scrollIntoView({ block: 'nearest' });
  });
  if (i >= 0) input.setAttribute('aria-activedescendant', `sp-${i}`);
  else input.removeAttribute('aria-activedescendant');
}

// ---------------------------------------------------------- the ghost --
function showGhost() {
  const v = input.value;
  const atEnd = input.selectionStart === v.length && input.selectionEnd === v.length;
  if (!rest || !atEnd || input.scrollWidth > input.clientWidth + 1) return hideGhost();
  ghost.firstChild.textContent = v;
  ghost.lastChild.textContent = rest;
  ghost.hidden = false;
}
function hideGhost() {
  ghost.hidden = true;
}
function acceptGhost() {
  if (ghost.hidden || !rest) return false;
  input.value += rest;
  rest = '';
  input.dispatchEvent(new Event('input'));
  return true;
}

// ------------------------------------------------------------- picking --
function pick(i) {
  const it = items[i];
  if (!it) return;
  const q = input.value.trim();
  if (it.kind === 'recent') {
    input.value = it.label;
    input.dispatchEvent(new Event('input'));
    return;
  }
  if (it.kind === 'online') {
    close();
    remember(q);
    import('./discover.js').then((d) => d.searchOnline(q));
    return;
  }
  if (it.kind === 'all') {
    remember(q);
    close();
    library.focusList({ first: true });
    return;
  }
  remember(q);
  close();
  if (it.kind === 'song') return library.showSong(it.id);
  // a name: open its list (this clears the search, so nothing else hides it)
  if (it.kind === 'artist') setView({ kind: 'artist', id: it.id });
  else if (it.kind === 'album') setView({ kind: 'album', id: it.id, artist: it.artist || '' });
  else if (it.kind === 'tuning') setView({ kind: 'tuning', id: it.id });
  else if (it.kind === 'year') setView({ kind: 'year', id: it.id });
  else if (it.kind === 'setlist') setView({ kind: 'setlist', id: it.id });
  input.blur();
}

// ------------------------------------------------------------ wiring --
input.addEventListener('input', () => {
  // In Discover the same box searches MusicBrainz instead of the library.
  if (inDiscover()) {
    close();
    return discover.setQuery(input.value);
  }
  const was = state.search;
  state.search = input.value;
  // a new search looks through all your songs, best matches first
  if (!was.trim() && input.value.trim()) {
    state.searchAll = true;
    state.userSorted = false;
  }
  if (!input.value.trim()) state.searchAll = true;
  // 3.8: typing anywhere else shows your songs straight away, filtered as you type
  if (input.value && state.page !== 'songs') {
    if (state.view.kind === 'discover') setView({ kind: 'all' }, { keepSearch: true });
    else setPage('songs', { keepSearch: true });
  }
  bump();
  emit('search');
  build();
});

input.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'Escape') {
    if (isOpen() && input.value) close();
    else if (input.value) {
      input.value = '';
      input.dispatchEvent(new Event('input'));
    } else input.blur();
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  if (inDiscover()) {
    if (k === 'Enter') {
      discover.setQuery(input.value, { now: true });
      e.preventDefault();
    }
    return;
  }
  if (k === 'ArrowDown' && isOpen()) {
    highlight(Math.min(items.length - 1, active + 1));
    e.preventDefault();
  } else if (k === 'ArrowUp' && isOpen()) {
    highlight(Math.max(-1, active - 1));
    e.preventDefault();
  } else if (k === 'Enter') {
    if (isOpen() && active >= 0) pick(active);
    else {
      remember(input.value);
      close();
      library.focusList({ first: true });
    }
    e.preventDefault();
  } else if (k === 'ArrowDown') {
    library.focusList({ first: true });
    e.preventDefault();
  } else if ((k === 'Tab' && !e.shiftKey) || (k === 'ArrowRight' && input.selectionStart === input.value.length)) {
    if (acceptGhost()) e.preventDefault();
  }
});
input.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') showGhost();
});
input.addEventListener('click', showGhost);
input.addEventListener('focus', () => build());
input.addEventListener('blur', () => {
  // a search you looked at counts as recent
  if (input.value.trim().length >= 2 && !inDiscover()) remember(input.value);
  close();
});
window.addEventListener('resize', () => !pop.hidden && place());

export function sync() {
  const d = inDiscover();
  box.classList.toggle('online', d);
  input.placeholder = d ? 'Search MusicBrainz for any artist or song' : 'Search songs, artists, albums, tunings';
  input.setAttribute('aria-label', d ? 'Search MusicBrainz' : 'Search your library');
  const want = d ? state.discover.query : state.search;
  if (input.value !== want) input.value = want;
  if (document.activeElement === input) build();
  else close();
}
on('view', sync);
on('page', sync);
on('search', () => {
  if (!inDiscover() && input.value !== state.search) {
    input.value = state.search;
    if (document.activeElement === input) build();
  }
});

export function focus() {
  input.focus();
  input.select();
}
