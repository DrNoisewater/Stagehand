/**
 * Left menu (Stagehand 3): Play, Songs (with its lists, setlists, tunings,
 * artists and folders), Tones, Progress, Discover, and
 * the guitar status card at the bottom.
 */
import { api } from './api.js';
import { state, on, setView, setPage, loadLibrary, emit, rsListIds, rsListLabel, rsListKeys, accBand } from './store.js';
const storeFns = { accBand };
import { h, icon, esc, showMenu, confirmDialog, toast } from './ui.js';
import { counts as discoverCounts } from './discover.js';

const side = document.getElementById('sidebar');
const root = h('div.nav-scroll');
export const guitarCardHost = h('div.guitar-card-host');
side.append(root, guitarCardHost);
// A section you're already in folds its sub-menu on a second click (and opens on the next).
let folded = null;
const fold = (page) => {
  folded = folded === page ? null : page;
  render();
};
const collapsed = new Set(JSON.parse(localStorage.getItem('stagehand.nav') || '["artists"]'));

function isCurrent(kind, id) {
  return state.view.kind === kind && (id === undefined || state.view.id === id);
}

function item({ kind, id, label, iconName, count, cls = '', onContext, drop, current, badge }) {
  const cur = current !== undefined ? current : isCurrent(kind, id);
  const b = h(`button.nav-item${cls ? '.' + cls : ''}`, { type: 'button', 'aria-current': cur ? 'true' : 'false', title: label });
  b.innerHTML = `${iconName ? icon(iconName) : ''}<span class="name">${esc(label)}</span>${badge || ''}${count !== undefined ? `<span class="count">${count}</span>` : ''}`;
  b.addEventListener('click', () => setView(id === undefined ? { kind } : { kind, id }));
  if (onContext) b.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    onContext(e);
  });
  if (drop) {
    b.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-stagehand-songs')) {
        e.preventDefault();
        b.classList.add('drop-target');
      }
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop-target'));
    b.addEventListener('drop', (e) => {
      b.classList.remove('drop-target');
      const ids = JSON.parse(e.dataTransfer.getData('application/x-stagehand-songs') || '[]');
      if (ids.length) drop(ids);
    });
  }
  return b;
}

/** A top-level section of the menu, with its own gel colour. */
function section({ page, label, iconName, gel, onClick, sub }) {
  const cur = state.page === page;
  const b = h(`button.nav-section${sub ? '.has-sub' : ''}`, { type: 'button', 'aria-current': cur ? 'page' : 'false', style: { '--gel': gel } });
  b.innerHTML = `${icon(iconName)}<span class="name">${esc(label)}</span>`;
  b.onclick = onClick || (() => setPage(page));
  return b;
}

function group(key, label, children, { action, collapsible = false } = {}) {
  const open = !collapsed.has(key);
  const g = h('div.nav-group');
  const head = h('div.nav-label');
  if (collapsible) {
    const t = h('button.nav-toggle', { type: 'button', 'aria-expanded': String(open), html: `${icon('chevron')}<span>${esc(label)}</span>` });
    t.onclick = () => {
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      localStorage.setItem('stagehand.nav', JSON.stringify([...collapsed]));
      render();
    };
    head.append(t);
  } else {
    head.append(h('span', { text: label }));
  }
  if (action) head.append(...[].concat(action));
  g.append(head);
  if (!collapsible || open) g.append(...children);
  return g;
}

/** Swaps a nav button for a plain row holding a text box (inputs inside buttons misbehave). */
function editRow(btn, input) {
  const row = h('div.nav-item.editing');
  const svg = btn.querySelector('svg');
  if (svg) row.append(svg.cloneNode(true));
  row.append(input);
  btn.replaceWith(row);
  return row;
}

export async function newSetlist(songIds = []) {
  const sl = await api.setlists.create('New setlist');
  if (songIds.length) await api.setlists.add(sl.id, songIds);
  await loadLibrary();
  renameSetlist(sl.id);
  return sl;
}

function renameSetlist(id) {
  const btn = [...root.querySelectorAll('.nav-item')].find((b) => b.dataset.setlist === id);
  const sl = state.setlists.find((x) => x.id === id);
  if (!btn || !sl) return;
  const input = h('input.rename', { value: sl.name, 'aria-label': 'Setlist name' });
  editRow(btn, input);
  input.focus();
  input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name && name !== sl.name) await api.setlists.rename(id, name);
    await loadLibrary();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape') commit(false);
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

export function render() {
  const songs = [...state.songs.values()];
  const count = (f) => songs.filter(f).length;
  const recentCut = Date.now() - 1000 * 60 * 60 * 24 * 30;
  root.innerHTML = '';
  const page = state.page === 'now' ? state.backPage || 'songs' : state.page;
  const top = h('div.nav-sections');
  top.append(section({ page: 'play', label: 'Play', iconName: 'guitar', gel: 'var(--gel-guitar)' }));
  top.append(
    section({
      page: 'songs',
      label: 'Songs',
      sub: true,
      iconName: 'music',
      gel: 'var(--tungsten)',
      onClick: () => {
        if (state.page === 'songs' && state.view.kind !== 'discover') return fold('songs');
        folded = null;
        state.view.kind === 'discover' ? setView({ kind: 'all' }) : setPage('songs');
      },
    })
  );
  const songsSub = h('div.nav-sub');
  top.append(songsSub);
  top.append(section({ page: 'tones', label: 'Tones', iconName: 'tones', gel: 'var(--gel-bass)' }));
  top.append(section({ page: 'progress', label: 'Progress', iconName: 'chart', gel: 'var(--gel-piano)' }));
  top.append(
    section({
      page: 'discover',
      label: 'Discover',
      sub: true,
      iconName: 'compass',
      gel: 'var(--gel-vocals)',
      onClick: () => {
        if (state.page === 'discover' && state.view.kind === 'discover') return fold('discover');
        folded = null;
        setView({ kind: 'discover', id: state.view.kind === 'discover' ? state.view.id : (state.discover && state.discover.lastId) || 'search' });
      },
    })
  );
  const discoverSub = h('div.nav-sub');
  top.append(discoverSub);
  root.append(top);
  // section highlight follows the page, not the Songs list
  for (const b of top.querySelectorAll('.nav-section')) b.setAttribute('aria-current', 'false');
  const idx = { play: 0, songs: 1, tones: 2, progress: 3, discover: 4 }[page];
  const secs = top.querySelectorAll('.nav-section');
  if (secs[idx]) secs[idx].setAttribute('aria-current', 'page');
  if (folded && folded !== page) folded = null;
  if (secs[idx]) secs[idx].classList.toggle('folded', folded === page);
  if (folded === page) return;
  if (page === 'discover') {
    discoverSub.append(...discoverGroup().querySelectorAll('.nav-item'));
    return;
  }
  if (page !== 'songs') return;
  const sub = songsSub;
  const lib = state.view.kind === 'discover' ? null : state.view;
  const cur = (kind, id) => !!lib && lib.kind === kind && (id === undefined || lib.id === id);
  sub.append(
    item({ kind: 'all', label: 'All songs', count: songs.length, cls: 'sub', current: cur('all') }),
    item({ kind: 'favorites', label: 'Favorites', count: count((s) => s.user && s.user.fav), cls: 'sub', current: cur('favorites') }),
    item({ kind: 'recent', label: 'Recently added', count: count((s) => (s.addedAt || 0) >= recentCut), cls: 'sub', current: cur('recent') }),
    item({ kind: 'played', label: 'Recently played', count: count((s) => s.user && s.user.lastPlayed), cls: 'sub', current: cur('played') }),
    item({ kind: 'stems', label: 'Stems ready', count: count((s) => s.hasStems || (state.stems.get(s.id) || {}).state === 'ready'), cls: 'sub', current: cur('stems') })
  );
  const rootSaved = root;
  const appendTo = (el) => sub.append(el);
  return renderSongGroups(appendTo, songs, rootSaved);
}

function renderSongGroups(append, songs) {
  const addSl = h('button.icon-btn', { type: 'button', title: 'New setlist', html: icon('plus') });
  addSl.onclick = () => newSetlist();
  const sls = state.setlists.map((sl) => {
    const b = item({
      kind: 'setlist',
      id: sl.id,
      label: sl.name,
      iconName: 'setlist',
      count: sl.songIds.filter((id) => state.songs.has(id)).length,
      drop: async (ids) => {
        await api.setlists.add(sl.id, ids);
        await loadLibrary();
        toast({ title: `Added to ${sl.name}`, message: `${ids.length} song${ids.length === 1 ? '' : 's'}` });
      },
      onContext: (e) =>
        showMenu(e.clientX, e.clientY, [
          { label: 'Rename', icon: 'edit', onClick: () => renameSetlist(sl.id) },
          {
            label: 'Delete setlist',
            icon: 'trash',
            danger: true,
            onClick: async () => {
              if (await confirmDialog({ title: 'Delete setlist?', message: `"${sl.name}" will be removed. The songs stay in your library.`, confirm: 'Delete', danger: true })) {
                await api.setlists.remove(sl.id);
                if (isCurrent('setlist', sl.id)) setView({ kind: 'all' });
                await loadLibrary();
              }
            },
          },
        ]),
    });
    b.dataset.setlist = sl.id;
    return b;
  });
  if (!sls.length) {
    const hint = h('div.nav-item.sub', { style: { color: 'var(--ink-3)', cursor: 'default' } });
    hint.textContent = 'Drag songs here or press +';
    sls.push(hint);
  }
  const bring = importRow();
  if (bring) sls.push(bring);
  append(group('setlists', 'Setlists', sls, { action: addSl }));

  // 3.8: songs by how well you play them (your best at full speed)
  const { accBand } = storeFns;
  const bands = { mastered: 0, close: 0, learning: 0, unplayed: 0 };
  for (const s of songs) bands[accBand(s)]++;
  const bandItems = [
    ['mastered', 'Mastered', '90 % and up'],
    ['close', 'Getting there', '60–89 %'],
    ['learning', 'Learning', 'under 60 %'],
    ['unplayed', 'Not played yet', ''],
  ]
    .filter(([k]) => bands[k] || k !== 'unplayed')
    .map(([k, label, hint]) => {
      const b = item({ kind: 'acc', id: k, label, count: bands[k], cls: `sub acc-${k}` });
      if (hint) b.title = `${label}: your best is ${hint}`;
      return b;
    });
  append(group('levels', 'Your level', bandItems, { collapsible: true }));

  const tunings = new Map();
  for (const s of songs) {
    const t = s.tuning || 'Unknown';
    tunings.set(t, (tunings.get(t) || 0) + 1);
  }
  const tuningItems = [...tunings.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => item({ kind: 'tuning', id: t, label: t, count: n, cls: 'sub' }));
  if (tuningItems.length) append(group('tunings', 'Tunings', tuningItems, { collapsible: true }));

  const artists = new Map();
  for (const s of songs) artists.set(s.artist || '', (artists.get(s.artist || '') || 0) + 1);
  const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const artistItems = [...artists.entries()]
    .sort((a, b) => coll.compare(a[0].replace(/^the\s+/i, ''), b[0].replace(/^the\s+/i, '')))
    .map(([a, n]) => item({ kind: 'artist', id: a, label: a || 'Unknown artist', count: n, cls: 'sub' }));
  if (artistItems.length) append(group('artists', `Artists`, artistItems, { collapsible: true }));

  const addF = h('button.icon-btn', { type: 'button', title: 'Add folder', html: icon('plus') });
  addF.onclick = () => addFolder();
  const folderItems = state.folders.map((f) =>
    item({
      kind: 'folder',
      id: f.path,
      label: f.path.split(/[\\/]/).filter(Boolean).slice(-2).join(' / '),
      iconName: 'folder',
      cls: f.exists ? '' : 'missing',
      onContext: (e) =>
        showMenu(e.clientX, e.clientY, [
          { label: 'Show in Explorer', icon: 'external', onClick: () => api.shell.openPath(f.path) },
          { label: 'Rescan', icon: 'refresh', onClick: () => api.library.rescan() },
          '-',
          {
            label: 'Remove from library',
            icon: 'trash',
            danger: true,
            onClick: async () => {
              if (await confirmDialog({ title: 'Remove folder?', message: `Stagehand will stop showing songs from ${f.path}. No files are deleted.`, confirm: 'Remove', danger: true })) {
                await api.library.removeFolder(f.path);
                if (isCurrent('folder', f.path)) setView({ kind: 'all' });
                await loadLibrary();
              }
            },
          },
        ]),
    })
  );
  append(group('folders', 'Folders', folderItems, { action: addF }));
}

function discoverGroup() {
  const c = discoverCounts();
  const v = state.view;
  const at = (id) => v.kind === 'discover' && (v.id === id || (v.id === 'artist' && (v.from || 'search') === id));
  const items = [
    item({ kind: 'discover', id: 'search', label: 'Search', iconName: 'search', current: at('search') }),
    item({ kind: 'discover', id: 'gaps', label: 'Collection gaps', iconName: 'pie', current: at('gaps'), badge: c.gapsRunning ? '<span class="spin mini" title="Checking artists"></span>' : '' }),
    item({ kind: 'discover', id: 'wanted', label: 'Wanted', iconName: 'star', count: c.wanted || undefined, current: at('wanted') }),
    item({
      kind: 'discover',
      id: 'imports',
      label: 'Imports',
      iconName: 'download',
      current: at('imports'),
      badge: c.busy ? '<span class="spin mini" title="Importing"></span>' : c.watching ? '<span class="live-dot" title="Watching for downloads"></span>' : '',
    }),
  ];
  return group('discover', 'Discover', items);
}

// Rocksmith's own song lists are retired (3.7): Stagehand is where you play now,
// so lists live as setlists. One click brings the old ones over, once.
const IMPORTED = 'stagehand.rsListsImported';
function importRow() {
  let done = false;
  try {
    done = localStorage.getItem(IMPORTED) === '1';
  } catch (_) {}
  const r = state.rs;
  if (done || !r || !r.profile) return null;
  const ids = rsListIds().filter((id) => rsListKeys(id).length);
  if (!ids.length) return null;
  const n = ids.reduce((a, id) => a + rsListKeys(id).length, 0);
  const row = h('div.nav-item.sub.rs-bring', { title: `Copy your ${ids.length} Rocksmith song lists (${n} songs) into setlists` });
  const go = h('button.rs-bring-go', { type: 'button', html: `${icon('download')}<span class="name">Bring over Rocksmith lists</span><span class="count">${ids.length}</span>` });
  go.onclick = () => importRocksmithLists();
  const x = h('button.rs-bring-x', { type: 'button', title: 'No thanks', 'aria-label': 'No thanks', html: icon('x') });
  x.onclick = () => {
    try {
      localStorage.setItem(IMPORTED, '1');
    } catch (_) {}
    render();
  };
  row.append(go, x);
  return row;
}

export async function importRocksmithLists() {
  const { songsByKey } = await import('./store.js');
  const byKey = songsByKey();
  const have = new Set(state.setlists.map((sl) => sl.name.toLowerCase()));
  let made = 0;
  let songs = 0;
  for (const id of rsListIds()) {
    const ids = rsListKeys(id)
      .map((k) => byKey.get(k.toLowerCase()))
      .filter(Boolean)
      .map((s) => s.id);
    if (!ids.length) continue;
    const name = id === 'favorites' ? 'Rocksmith favorites' : rsListLabel(id);
    if (have.has(name.toLowerCase())) continue;
    const sl = await api.setlists.create(name);
    await api.setlists.add(sl.id, ids);
    made++;
    songs += ids.length;
  }
  try {
    localStorage.setItem(IMPORTED, '1');
  } catch (_) {}
  await loadLibrary();
  toast({ title: made ? `${made} setlist${made === 1 ? '' : 's'} made` : 'Nothing new to bring over', message: made ? `${songs} songs from your Rocksmith lists.` : '', kind: 'ok' });
}

export async function addFolder(p) {
  const folder = await api.library.addFolder(p);
  if (folder) {
    toast({ title: 'Folder added', message: 'Scanning for songs…', kind: 'info' });
    await loadLibrary();
  }
}

on('library', render);
on('view', render);
on('page', render);
on('discover-wanted', render);
on('discover-imports', render);
on('discover-gaps', render);
on('rocksmith', render);
on('stems', render);
emit('sidebar-ready');
on('best', render);
