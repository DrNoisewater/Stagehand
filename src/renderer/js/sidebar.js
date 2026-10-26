/**
 * Left menu (Stagehand 3): Play, Songs (with its lists, setlists, Rocksmith
 * song lists, tunings, artists and folders), Tones, Progress, Discover, and
 * the guitar status card at the bottom.
 */
import { api } from './api.js';
import { state, on, setView, setPage, loadLibrary, emit, rsListIds, rsListCount, RS_STOCK_LISTS, RS_MAX_LISTS, rsListLabel, rsStockLabel, rsListKeys, loadRocksmith } from './store.js';
import { h, icon, esc, showMenu, confirmDialog, toast } from './ui.js';
import * as actions from './actions.js';
import { counts as discoverCounts } from './discover.js';

const side = document.getElementById('sidebar');
const root = h('div.nav-scroll');
export const guitarCardHost = h('div.guitar-card-host');
side.append(root, guitarCardHost);
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
function section({ page, label, iconName, gel, onClick }) {
  const cur = state.page === page;
  const b = h('button.nav-section', { type: 'button', 'aria-current': cur ? 'page' : 'false', style: { '--gel': gel } });
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
      iconName: 'music',
      gel: 'var(--tungsten)',
      onClick: () => (state.view.kind === 'discover' ? setView({ kind: 'all' }) : setPage('songs')),
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
      iconName: 'compass',
      gel: 'var(--gel-vocals)',
      onClick: () => setView({ kind: 'discover', id: state.view.kind === 'discover' ? state.view.id : (state.discover && state.discover.lastId) || 'search' }),
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
            label: 'Send to Rocksmith',
            icon: 'music',
            submenu: state.rs && state.rs.profile
              ? rsListIds().flatMap((id) => [
                  {
                    label: `Replace ${rsListLabel(id)}`,
                    icon: id === 'favorites' ? 'heart' : 'setlist',
                    hint: String(rsListKeys(id).length),
                    onClick: () => actions.replaceRocksmithList(id, sl.songIds.filter((x) => state.songs.has(x)), `“${sl.name}”`),
                  },
                  ...(id === 'favorites' ? ['-'] : []),
                ])
              : [{ label: 'No Rocksmith profile found', disabled: true }],
          },
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
  append(group('setlists', 'Setlists', sls, { action: addSl }));

  append(rocksmithGroup());

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

function rocksmithGroup() {
  const r = state.rs;
  const refresh = h('button.icon-btn', { type: 'button', title: 'Read the lists from Rocksmith again', html: icon('refresh') });
  refresh.onclick = async () => {
    await loadRocksmith();
    toast({ title: 'Read your Rocksmith lists', kind: 'info', timeout: 2000 });
  };
  const count = rsListCount();
  const full = count >= RS_MAX_LISTS;
  const add = h('button.icon-btn', {
    type: 'button',
    title: full ? `${RS_MAX_LISTS} song lists is the most Rocksmith can show` : `New song list (${count} of ${RS_MAX_LISTS})`,
    'aria-label': 'New song list',
    disabled: full || !r || !r.profile ? true : null,
    html: icon('plus'),
  });
  add.onclick = async () => {
    const id = await actions.addRocksmithList();
    if (id !== null) {
      if (collapsed.has('rocksmith')) {
        collapsed.delete('rocksmith');
        localStorage.setItem('stagehand.nav', JSON.stringify([...collapsed]));
      }
      render();
      const el = root.querySelector(`.nav-item[data-rslist="${id}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
      renameRsList(id);
    }
  };
  const tools = h('span.nav-actions', null, add, refresh);
  const items = [];
  if (!r) {
    items.push(h('div.nav-item.sub', { style: { color: 'var(--ink-3)', cursor: 'default' }, text: 'Reading your profile…' }));
  } else if (!r.profile || r.error) {
    const b = h('button.nav-item.sub', { type: 'button', html: `${icon('alert')}<span class="name">${esc(r.error ? 'Profile could not be read' : 'Find my Rocksmith profile')}</span>` });
    b.onclick = () => import('./dialogs.js').then((d) => d.settings('rocksmith'));
    items.push(b);
  } else {
    for (const id of rsListIds()) {
      const b = item({
        kind: 'rslist',
        id,
        label: rsListLabel(id),
        iconName: id === 'favorites' ? 'heart' : 'setlist',
        count: rsListKeys(id).length,
        drop: (ids) => actions.addToRocksmith(id, ids),
        onContext: (e) =>
          showMenu(e.clientX, e.clientY, [
            id !== 'favorites' ? { label: 'Rename…', icon: 'edit', hint: 'F2', onClick: () => renameRsList(id) } : null,
            id !== 'favorites' && rsListLabel(id) !== rsStockLabel(id) ? { label: `Use the name ${rsStockLabel(id)}`, icon: 'restore', onClick: () => actions.renameRocksmithList(id, '') } : null,
            id !== 'favorites' ? '-' : null,
            {
              label: 'Fill from a setlist',
              icon: 'setlist',
              submenu: state.setlists.length
                ? state.setlists.map((sl) => ({ label: sl.name, onClick: () => actions.replaceRocksmithList(id, sl.songIds.filter((x) => state.songs.has(x)), `“${sl.name}”`) }))
                : [{ label: 'Make a setlist first', disabled: true }],
            },
            { label: 'Copy into a new setlist', icon: 'plus', onClick: () => copyToSetlist(id) },
            '-',
            { label: 'Clear this list', icon: 'trash', danger: true, disabled: !rsListKeys(id).length, onClick: () => actions.clearRocksmithList(id) },
            id !== 'favorites' && Number(id) >= RS_STOCK_LISTS && Number(id) === rsListCount() - 1
              ? { label: 'Remove this list', icon: 'x', danger: true, onClick: () => actions.removeRocksmithList(id) }
              : null,
          ]),
      });
      b.dataset.rslist = id;
      if (id !== 'favorites') {
        b.title = rsListLabel(id) === rsStockLabel(id) ? `${rsStockLabel(id)} in Rocksmith. Double-click to rename.` : `${rsStockLabel(id)} in Rocksmith, shown as “${rsListLabel(id)}”. Double-click to rename.`;
        b.addEventListener('dblclick', () => renameRsList(id));
        b.addEventListener('keydown', (e) => {
          if (e.key === 'F2') {
            e.preventDefault();
            e.stopPropagation();
            renameRsList(id);
          }
        });
      }
      items.push(b);
    }
    if (r.profiles && r.profiles.length > 1) {
      const who = h('button.nav-item.sub', { type: 'button', title: 'Choose a different Rocksmith profile', html: `${icon('person')}<span class="name">${esc(r.profile.name || 'Profile')}</span>` });
      who.onclick = () => import('./dialogs.js').then((d) => d.settings('rocksmith'));
      items.push(who);
    }
  }
  return group('rocksmith', 'In Rocksmith', items, { action: tools, collapsible: true });
}

function renameRsList(id) {
  const btn = root.querySelector(`.nav-item[data-rslist="${id}"]`);
  if (!btn || id === 'favorites') return;
  const current = rsListLabel(id);
  const input = h('input.rename', { value: current === rsStockLabel(id) ? '' : current, placeholder: rsStockLabel(id), maxlength: '25', 'aria-label': `Name for ${rsStockLabel(id)}` });
  editRow(btn, input);
  input.focus();
  input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name !== (current === rsStockLabel(id) ? '' : current)) await actions.renameRocksmithList(id, name);
    render();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit(true);
    if (e.key === 'Escape') commit(false);
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
}

async function copyToSetlist(listId) {
  const { songsByKey } = await import('./store.js');
  const byKey = songsByKey();
  const ids = rsListKeys(listId)
    .map((k) => byKey.get(k.toLowerCase()))
    .filter(Boolean)
    .map((s) => s.id);
  const sl = await api.setlists.create(rsListLabel(listId));
  if (ids.length) await api.setlists.add(sl.id, ids);
  await loadLibrary();
  setView({ kind: 'setlist', id: sl.id });
  toast({ title: `Copied into a new setlist`, message: `${ids.length} song${ids.length === 1 ? '' : 's'} from ${rsListLabel(listId)}.` });
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
