/** App state, derived song lists and a tiny event bus. */
import { api } from './api.js';

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('stagehand.ui') || '{}');
  } catch (_) {
    return {};
  }
})();

export const state = {
  songs: new Map(),
  setlists: [],
  folders: [],
  unreadable: [],
  loaded: false,
  // Always open on the song list (a saved list or folder is fine, Discover isn't).
  view: saved.view && saved.view.kind !== 'discover' && saved.view.kind !== 'rslist' ? saved.view : { kind: 'all' },
  // Stagehand 3: which section is showing. Always opens on Play.
  page: 'play',
  search: '',
  parts: new Set(saved.parts || []),
  sort: saved.sort || { key: 'artist', dir: 1 },
  layout: saved.layout || 'list',
  selection: new Set(),
  anchor: null,
  focus: null,
  nowPlaying: null,
  stems: new Map(), // songId -> status
  settings: null,
  info: null,
  scan: null,
  editing: false,
  version: 0,
  rs: null, // Rocksmith profile + its in-game song lists
  best: {}, // songId -> { lead, rhythm, bass, best } (0–1) from practice stats
};

export function persistUi() {
  try {
    localStorage.setItem(
      'stagehand.ui',
      JSON.stringify({ view: state.view, parts: [...state.parts], sort: state.sort, layout: state.layout })
    );
  } catch (_) {}
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortKey(s, key) {
  switch (key) {
    case 'title':
      return s.titleSort || s.title || '';
    case 'artist':
      return s.artistSort || s.artist || '';
    case 'album':
      return s.albumSort || s.album || '';
    case 'year':
      return s.year || 0;
    case 'tuning':
      return s.tuning || '~';
    case 'length':
      return s.length || 0;
    case 'added':
      return s.addedAt || 0;
    case 'rating':
      return (s.user && s.user.rating) || 0;
    case 'played':
      return (s.user && s.user.lastPlayed) || 0;
    case 'parts':
      return partsCode(s);
    case 'best': {
      const b = state.best && state.best[s.id];
      return b && b.best !== undefined ? b.best : -1;
    }
    default:
      return '';
  }
}

export function partsCode(s) {
  const t = new Set((s.arrangements || []).map((a) => a.type));
  return ['lead', 'rhythm', 'bass', 'vocals'].filter((x) => t.has(x) || (x === 'lead' && t.has('combo'))).length;
}

function compare(a, b, key, dir) {
  const x = sortKey(a, key);
  const y = sortKey(b, key);
  let c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
  if (c === 0 && key !== 'title') c = collator.compare(a.titleSort || a.title, b.titleSort || b.title);
  if (c === 0 && key === 'artist') c = collator.compare(a.albumSort || a.album || '', b.albumSort || b.album || '');
  return c * dir;
}

/** How well you play a song (your best, full speed): mastered / close / learning / unplayed. */
export function accBand(s) {
  const b = state.best && state.best[s.id];
  const v = b && b.best !== undefined ? b.best : null;
  if (v === null) return 'unplayed';
  return v >= 0.9 ? 'mastered' : v >= 0.6 ? 'close' : 'learning';
}

export function hasPart(s, part) {
  return (s.arrangements || []).some((a) => a.type === part || (part === 'lead' && a.type === 'combo') || (part === 'vocals' && a.type === 'jvocals'));
}

export function viewTitle(v = state.view) {
  switch (v.kind) {
    case 'all':
      return 'All songs';
    case 'favorites':
      return 'Favorites';
    case 'recent':
      return 'Recently added';
    case 'played':
      return 'Recently played';
    case 'stems':
      return 'Stems ready';
    case 'setlist': {
      const sl = state.setlists.find((x) => x.id === v.id);
      return sl ? sl.name : 'Setlist';
    }
    case 'tuning':
      return v.id;
    case 'album':
      return v.id || 'Unknown album';
    case 'year':
      return `From ${v.id}`;
    case 'acc':
      return { mastered: 'Mastered (90 % and up)', close: 'Getting there (60–89 %)', learning: 'Learning (under 60 %)', unplayed: 'Not played yet' }[v.id] || 'Your best';
    case 'artist':
      return v.id || 'Unknown artist';
    case 'folder':
      return v.id.split(/[\\/]/).filter(Boolean).slice(-1)[0] || v.id;
    case 'rslist':
      return v.id === 'favorites' ? 'Rocksmith favorites' : rsListLabel(v.id);
    case 'discover':
      return { search: 'Search', gaps: 'Collection gaps', wanted: 'Wanted', imports: 'Imports', artist: (v.artist && v.artist.name) || 'Artist' }[v.id] || 'Discover';
    default:
      return 'Songs';
  }
}

let memo = { version: -1, key: '', list: [] };

/** The songs shown in the library for the current view, search and sort. */
export function visibleSongs() {
  const key = JSON.stringify([state.view, state.search, [...state.parts], state.sort]);
  if (memo.version === state.version && memo.key === key) return memo.list;
  let list = [...state.songs.values()];
  const v = state.view;
  let keepOrder = false;
  if (v.kind === 'favorites') list = list.filter((s) => s.user && s.user.fav);
  else if (v.kind === 'recent') {
    const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 30;
    list = list.filter((s) => (s.addedAt || 0) >= cutoff);
  } else if (v.kind === 'played') list = list.filter((s) => s.user && s.user.lastPlayed);
  else if (v.kind === 'stems') list = list.filter((s) => (state.stems.get(s.id) || {}).state === 'ready' || s.hasStems);
  else if (v.kind === 'setlist') {
    const sl = state.setlists.find((x) => x.id === v.id);
    list = sl ? sl.songIds.map((id) => state.songs.get(id)).filter(Boolean) : [];
    keepOrder = true;
  } else if (v.kind === 'rslist') {
    const byKey = songsByKey();
    list = rsListKeys(v.id)
      .map((k) => byKey.get(k.toLowerCase()))
      .filter(Boolean);
    keepOrder = true;
  } else if (v.kind === 'tuning') list = list.filter((s) => (s.tuning || 'Unknown') === v.id);
  else if (v.kind === 'artist') list = list.filter((s) => (s.artist || '') === v.id);
  else if (v.kind === 'album') list = list.filter((s) => (s.album || '') === v.id && (!v.artist || (s.artist || '') === v.artist));
  else if (v.kind === 'year') list = list.filter((s) => s.year === v.id);
  else if (v.kind === 'acc') list = list.filter((s) => accBand(s) === v.id);
  else if (v.kind === 'folder') {
    const root = v.id.toLowerCase();
    list = list.filter((s) => s.path.toLowerCase().startsWith(root));
  }
  if (state.parts.size) list = list.filter((s) => [...state.parts].every((p) => hasPart(s, p)));
  const q = state.search.trim().toLowerCase();
  if (q) {
    const terms = q.split(/\s+/);
    list = list.filter((s) => {
      const hay = `${s.title} ${s.artist} ${s.album} ${s.year || ''} ${s.author} ${s.tuning || ''} ${s.fileName}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  const { key: sk, dir } = state.sort;
  if (v.kind === 'recent' && !state.userSorted) list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  else if (v.kind === 'played' && !state.userSorted) list.sort((a, b) => (b.user.lastPlayed || 0) - (a.user.lastPlayed || 0));
  else if (!keepOrder || state.userSorted) list.sort((a, b) => compare(a, b, sk, dir));
  memo = { version: state.version, key, list };
  return list;
}

export function bump() {
  state.version++;
}

// ------------------------------------------------------- Rocksmith lists --
export const RS_STOCK_LISTS = 6; // the game's own Song Lists 1-6
export const RS_MAX_LISTS = 20; // RSMods can show up to 20

/** 'favorites' plus one id per song list in the profile ('0', '1', ...). */
export function rsListIds() {
  const n = state.rs && state.rs.lists ? state.rs.lists.length : RS_STOCK_LISTS;
  return ['favorites', ...Array.from({ length: n }, (_, i) => String(i))];
}

export function rsListCount() {
  return state.rs && state.rs.lists ? state.rs.lists.length : RS_STOCK_LISTS;
}

/** The game's own name for a list ("Song List 3"). */
export function rsStockLabel(id) {
  return id === 'favorites' ? 'Favorites' : `Song List ${Number(id) + 1}`;
}

/** The name the player sees: a custom RSMods name if one is set. */
export function rsListLabel(id) {
  if (id === 'favorites') return 'Favorites';
  const custom = state.rs && state.rs.names ? state.rs.names[Number(id)] : null;
  return custom || rsStockLabel(id);
}

export function rsListKeys(id) {
  const r = state.rs;
  if (!r || !r.lists) return [];
  return id === 'favorites' ? r.favorites || [] : r.lists[Number(id)] || [];
}

let keyMemo = { version: -1, map: new Map() };
/** songKey (lower case) -> song. Prefers PC files ("_p") when keys repeat. */
export function songsByKey() {
  if (keyMemo.version === state.version) return keyMemo.map;
  const map = new Map();
  for (const s of state.songs.values()) {
    const k = String(s.songKey || '').toLowerCase();
    if (!k) continue;
    const prev = map.get(k);
    if (!prev || (/_m\.psarc$/i.test(prev.fileName) && !/_m\.psarc$/i.test(s.fileName))) map.set(k, s);
  }
  keyMemo = { version: state.version, map };
  return map;
}

/** Keys in an in-game list that Stagehand has no file for. */
export function rsMissing(id) {
  const byKey = songsByKey();
  return rsListKeys(id).filter((k) => !byKey.has(k.toLowerCase()));
}

export function rsHas(id, song) {
  const k = String(song.songKey || '').toLowerCase();
  return rsListKeys(id).some((x) => x.toLowerCase() === k);
}

export async function loadRocksmith() {
  try {
    state.rs = await api.rocksmith.read();
  } catch (err) {
    state.rs = { error: err.message, profiles: [] };
  }
  bump();
  emit('rocksmith');
  return state.rs;
}

// ------------------------------------------------------------- loading --
export async function loadLibrary() {
  const snap = await api.library.get();
  state.songs = new Map(snap.songs.map((s) => [s.id, s]));
  state.setlists = snap.setlists;
  state.folders = snap.folders;
  state.unreadable = snap.unreadable;
  state.loaded = true;
  for (const id of [...state.selection]) if (!state.songs.has(id)) state.selection.delete(id);
  bump();
  emit('library');
}

export function upsertSongs(songs) {
  for (const s of songs) state.songs.set(s.id, s);
  bump();
  emit('library');
}

export function selectedSongs() {
  return [...state.selection].map((id) => state.songs.get(id)).filter(Boolean);
}

export function setSelection(ids, { anchor, focus } = {}) {
  state.selection = new Set(ids);
  if (anchor !== undefined) state.anchor = anchor;
  if (focus !== undefined) state.focus = focus;
  emit('selection');
}

// 3.9: where you've been, for the mouse's back button (and Alt+←)
const trail = [];
let goingBack = false;
const here = () => ({ page: state.page, view: state.view });
function remember() {
  if (goingBack) return;
  const cur = here();
  const last = trail[trail.length - 1];
  if (last && last.page === cur.page && JSON.stringify(last.view) === JSON.stringify(cur.view)) return;
  trail.push(cur);
  if (trail.length > 60) trail.shift();
}
/** Back to the previous screen. Returns false when there's nowhere to go. */
export function goBack() {
  const cur = here();
  let to = trail.pop();
  while (to && to.page === cur.page && JSON.stringify(to.view) === JSON.stringify(cur.view)) to = trail.pop();
  if (!to) return false;
  goingBack = true;
  try {
    if (JSON.stringify(to.view) !== JSON.stringify(state.view) && (to.page === 'songs' || to.page === 'discover')) setView(to.view);
    else state.view = to.view;
    setPage(to.page);
  } finally {
    goingBack = false;
  }
  return true;
}

export function setView(view) {
  if (JSON.stringify(view) !== JSON.stringify(state.view) || state.page !== (view.kind === 'discover' ? 'discover' : 'songs')) remember();
  state.view = view;
  const was = goingBack;
  goingBack = true; // (setPage below mustn't remember the half-changed state)
  try {
    setPage(view.kind === 'discover' ? 'discover' : 'songs', { quiet: true });
  } finally {
    goingBack = was;
  }
  state.userSorted = false;
  persistUi();
  bump();
  emit('view');
}

/** play | songs | discover | tones | progress | now (the song you're practising). */
export function setPage(page, { quiet = false } = {}) {
  if (page !== 'now' && state.page !== 'now') state.lastPage = state.page;
  if (page === 'now' && state.page !== 'now') state.backPage = state.page;
  const changed = state.page !== page;
  if (changed) remember();
  state.page = page;
  if (changed) emit('page');
  if (!quiet && changed) emit('view');
}

/** 4.0.4: official (paid) Rocksmith DLC: no creator stamp and on the official song list (worked out by the main process). */
export function isOfficial(s) {
  return !!s && !!s.official;
}

/** A file with no creator stamp (official DLC, or a custom made without one): its audio may be in another file. */
export function noStamp(s) {
  return !!s && !s.toolkit && !s.author && !s.packageVersion;
}
