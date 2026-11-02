/** User actions shared by the library, inspector, stage and menus. */
import { api } from './api.js';
import { isOfficial, state, emit, bump, upsertSongs, loadLibrary, setSelection, setView, visibleSongs, rsListIds, rsListCount, RS_STOCK_LISTS, RS_MAX_LISTS, rsListLabel, rsStockLabel, rsListKeys, rsHas } from './store.js';
import { showMenu, toast, confirmDialog } from './ui.js';
import { newSetlist } from './sidebar.js';

let stageApi = null;
let inspectorApi = null;
let dialogsApi = null;
export function register({ stage, inspector, dialogs }) {
  if (stage) stageApi = stage;
  if (inspector) inspectorApi = inspector;
  if (dialogs) dialogsApi = dialogs;
}

export async function playSong(id, opts = {}) {
  const song = state.songs.get(id);
  if (!song || !stageApi) return;
  const pref = state.settings ? state.settings.playback.autoplay !== false : true;
  await stageApi.load(song, { autoplay: opts.autoplay ?? pref });
}

/**
 * Play along: straight into the note highway. If the song is already the one
 * playing, nothing restarts; you jump in wherever it is.
 */
export async function playAlong(id) {
  const song = state.songs.get(id);
  if (!song || !stageApi) return;
  // 4.0.2: a file with no song audio inside used to open the highway over an error you
  // couldn't see; 4.0.3: official DLC looks for its audio in Rocksmith's folder instead
  if (song.audioEntry === null && !song.audioFrom && !isOfficial(song)) return noAudioToast(song);
  const cur = stageApi.current && stageApi.current();
  // the same song carries on, unless it failed to open: then picking it again tries again
  const phase = stageApi.loadInfo ? stageApi.loadInfo().phase : 'ready';
  const same = cur && cur.id === id && phase !== 'error';
  // a new song starts loading (it becomes the current song straight away);
  // the same song just carries on from where it is
  const loading = same ? null : stageApi.load(song, { autoplay: true });
  if (same && !stageApi.engine.playing) stageApi.toggle();
  // the highway first, so you never see the Tab view flash by
  if (stageApi.openHighway) stageApi.openHighway();
  const { setPage } = await import('./store.js');
  setPage('now');
  await loading;
}

/** Says why a song can't play: its file has no song audio inside. */
export function noAudioToast(song) {
  toast({
    title: `${song.title || 'This song'} has no audio inside`,
    message: 'The file holds the parts but not the song’s audio (some song packs and official DLC files keep it in another file), so it can’t play. Songs › ⋯ › Find duplicate songs shows whether you have another copy with audio.',
    kind: 'err',
  });
}

export function playAdjacent(dir) {
  const list = visibleSongs();
  if (!list.length) return;
  let idx = list.findIndex((s) => s.id === state.nowPlaying);
  idx = idx < 0 ? 0 : (idx + dir + list.length) % list.length;
  const id = list[idx].id;
  setSelection([id], { anchor: id, focus: id });
  playSong(id);
  emit('reveal', id);
}

export async function rate(id, n) {
  const s = await api.songs.setUser(id, { rating: n });
  if (s) upsertSongs([s]);
}

export async function toggleFav(ids) {
  const songs = ids.map((id) => state.songs.get(id)).filter(Boolean);
  const makeFav = !songs.every((s) => s.user && s.user.fav);
  const out = [];
  for (const s of songs) out.push(await api.songs.setUser(s.id, { fav: makeFav }));
  upsertSongs(out.filter(Boolean));
}

// ------------------------------------------------------ Rocksmith lists --
function keysOf(ids) {
  const out = [];
  for (const id of ids) {
    const s = state.songs.get(id);
    if (s && s.songKey && !out.some((k) => k.toLowerCase() === s.songKey.toLowerCase())) out.push(s.songKey);
  }
  return out;
}

/**
 * Applies changes to the in-game lists. `ops` as accepted by rs:apply;
 * `say(result)` returns the toast text for a successful change.
 */
export async function rsApply(ops, say) {
  try {
    const r = await api.rocksmith.apply(ops);
    state.rs = r;
    bump();
    emit('rocksmith');
    if (!r.changed) {
      toast({ title: 'Already there', message: 'Nothing needed changing in Rocksmith.', kind: 'info' });
      return r;
    }
    toast({
      title: say(r),
      message: 'Rocksmith shows the change next time you start it.',
      actions: r.backupId ? [{ label: 'Undo', onClick: () => rsUndo(r.backupId) }] : [],
    });
    return r;
  } catch (err) {
    if (err.code === 'RS_RUNNING') {
      toast({ title: 'Close Rocksmith first', message: 'Song lists can only be changed while the game is closed, so Rocksmith doesn’t overwrite them.', kind: 'err' });
    } else {
      toast({ title: 'Rocksmith lists not changed', message: err.message, kind: 'err' });
    }
    return null;
  }
}

async function rsUndo(backupId) {
  try {
    state.rs = await api.rocksmith.restore(backupId);
    bump();
    emit('rocksmith');
    toast({ title: 'Change undone', message: 'Your Rocksmith profile is back as it was.', kind: 'info' });
  } catch (err) {
    toast({ title: 'Could not undo', message: err.code === 'RS_RUNNING' ? 'Close Rocksmith first, then try again from Settings → Rocksmith.' : err.message, kind: 'err' });
  }
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function addToRocksmith(listId, ids) {
  const keys = keysOf(ids);
  if (!keys.length) return;
  return rsApply([{ list: listId, add: keys }], (r) => `Added ${plural(r.added, 'song')} to ${rsListLabel(listId)}`);
}

export function removeFromRocksmith(listId, ids) {
  const keys = keysOf(ids);
  return rsApply([{ list: listId, remove: keys }], (r) => `Removed ${plural(r.removed, 'song')} from ${rsListLabel(listId)}`);
}

export async function replaceRocksmithList(listId, ids, sourceName) {
  const keys = keysOf(ids);
  const current = rsListKeys(listId);
  if (current.length) {
    const ok = await confirmDialog({
      title: `Replace ${rsListLabel(listId)}?`,
      message: `${rsListLabel(listId)} in Rocksmith has ${plural(current.length, 'song')}. Replace ${current.length === 1 ? 'it' : 'them'} with the ${plural(keys.length, 'song')} in ${sourceName}? Your profile is backed up first, so this can be undone.`,
      confirm: 'Replace',
    });
    if (!ok) return null;
  }
  return rsApply([{ list: listId, set: keys }], () => `${rsListLabel(listId)} now matches ${sourceName}`);
}

export async function clearRocksmithList(listId) {
  const n = rsListKeys(listId).length;
  if (!n) return;
  const ok = await confirmDialog({ title: `Clear ${rsListLabel(listId)}?`, message: `This removes all ${plural(n, 'song')} from ${rsListLabel(listId)} in Rocksmith. The songs themselves stay installed.`, confirm: 'Clear list', danger: true });
  if (ok) return rsApply([{ list: listId, set: [] }], () => `Cleared ${rsListLabel(listId)}`);
}

const RSMODS_URL = 'https://github.com/Lovrom8/RSMods/releases';

/** Renames an in-game song list (stored in RSMods.ini, shown in game by RSMods). */
export async function renameRocksmithList(listId, name) {
  if (listId === 'favorites') return null;
  const n = Number(listId);
  const before = rsListLabel(listId);
  try {
    const r = await api.rocksmith.rename({ [n]: name });
    state.rs = r;
    bump();
    emit('rocksmith');
    const now = rsListLabel(listId);
    if (now === before) return r;
    const reset = now === rsStockLabel(listId);
    if (r.rsmods && r.rsmods.installed) {
      toast({ title: reset ? `${rsStockLabel(listId)} has its stock name again` : `Renamed ${rsStockLabel(listId)} to “${now}”`, message: 'RSMods shows the new name next time you start Rocksmith.' });
    } else {
      toast({
        title: reset ? `${rsStockLabel(listId)} has its stock name again` : `Renamed ${rsStockLabel(listId)} to “${now}”`,
        message: 'Rocksmith shows custom list names only with the free RSMods mod installed. Until then the game keeps calling it ' + rsStockLabel(listId).toUpperCase() + '.',
        kind: 'info',
        timeout: 9000,
        actions: [{ label: 'Get RSMods', onClick: () => api.shell.openExternal(RSMODS_URL) }],
      });
    }
    return r;
  } catch (err) {
    if (err.code === 'RS_NO_GAME') {
      toast({ title: 'Rocksmith folder not found', message: err.message, kind: 'err', actions: [{ label: 'Choose folder', onClick: () => pickGameFolder() }] });
    } else {
      toast({ title: 'List not renamed', message: err.message, kind: 'err' });
    }
    return null;
  }
}

/** Adds a song list (7 to 20, an RSMods feature). Resolves to the new list id or null. */
export async function addRocksmithList() {
  const n = rsListCount();
  if (n >= RS_MAX_LISTS) {
    toast({ title: `You already have ${RS_MAX_LISTS} song lists`, message: 'That’s the most Rocksmith can show, even with RSMods.', kind: 'info' });
    return null;
  }
  const mods = (state.rs && state.rs.rsmods) || {};
  if (!mods.installed) {
    const ok = await confirmDialog({
      title: 'Add a song list?',
      message: `Song lists beyond the game's first ${RS_STOCK_LISTS} are an RSMods feature. Without RSMods installed, Rocksmith won’t show them everywhere, and they keep generic names. You can remove the list again any time.`,
      confirm: 'Add list',
    });
    if (!ok) return null;
  }
  const r = await rsApply([{ addList: true }], (res) => `Added ${rsStockLabel(String(res.createdList))}`);
  return r && r.createdList !== null && r.createdList !== undefined ? String(r.createdList) : null;
}

/** Removes the last extra song list. */
export async function removeRocksmithList(id) {
  const n = rsListKeys(id).length;
  if (n) {
    const ok = await confirmDialog({
      title: `Remove ${rsListLabel(id)}?`,
      message: `${rsListLabel(id)} has ${plural(n, 'song')}. Removing the list doesn’t remove the songs from your game. Your profile is backed up first, so this can be undone.`,
      confirm: 'Remove list',
      danger: true,
    });
    if (!ok) return null;
  }
  const label = rsListLabel(id);
  return rsApply([{ removeList: Number(id) }], () => `Removed ${label}`);
}

export async function pickGameFolder() {
  try {
    const r = await api.rocksmith.pickGame();
    if (r) {
      state.rs = r;
      bump();
      emit('rocksmith');
    }
    return r;
  } catch (err) {
    toast({ title: 'Not the Rocksmith folder', message: err.message, kind: 'err' });
    return null;
  }
}

export { RSMODS_URL };

/** Submenu entries for "Add to Rocksmith". */
export function rocksmithMenu(ids) {
  const r = state.rs;
  if (!r || !r.profile) {
    return [{ label: r && r.error ? 'Profile could not be read' : 'No Rocksmith profile found', disabled: true }, { label: 'Rocksmith settings…', icon: 'sliders', onClick: () => dialogsApi && dialogsApi.settings('rocksmith') }];
  }
  const songs = ids.map((id) => state.songs.get(id)).filter(Boolean);
  const entries = rsListIds().map((id) => {
    const all = songs.length && songs.every((s) => rsHas(id, s));
    const count = rsListKeys(id).length;
    return {
      label: all ? `Remove from ${rsListLabel(id)}` : rsListLabel(id),
      icon: all ? 'check' : id === 'favorites' ? 'heart' : 'setlist',
      hint: all ? '' : String(count),
      onClick: () => (all ? removeFromRocksmith(id, ids) : addToRocksmith(id, ids)),
    };
  });
  return [entries[0], '-', ...entries.slice(1)];
}

export async function engineReady() {
  if (state.engine && state.engine.installed) return true;
  try {
    state.engine = await api.engine.status();
  } catch (_) {}
  return !!(state.engine && state.engine.installed);
}

export async function requestStems(ids, opts = {}) {
  if (!(await engineReady())) {
    dialogsApi && dialogsApi.engineSetup({ thenStems: ids });
    return;
  }
  const q = await api.stems.request(ids, opts);
  for (const item of q) state.stems.set(item.songId, item);
  emit('stems');
  if (ids.length > 1) toast({ title: 'Stem separation queued', message: `${q.length} song${q.length === 1 ? '' : 's'} waiting. Progress shows at the top right.`, kind: 'info' });
}

export async function addToSetlist(id, ids) {
  await api.setlists.add(id, ids);
  await loadLibrary();
  const sl = state.setlists.find((x) => x.id === id);
  toast({ title: `Added to ${sl ? sl.name : 'setlist'}`, message: `${ids.length} song${ids.length === 1 ? '' : 's'}` });
}

export async function removeFromSetlist(id, ids) {
  await api.setlists.removeSongs(id, ids);
  await loadLibrary();
}

export function editSongs(ids) {
  if (!inspectorApi) return;
  if (ids && ids.length) setSelection(ids, { anchor: ids[0], focus: ids[0] });
  inspectorApi.beginEdit();
}

export function songMenu(x, y, ids) {
  const songs = ids.map((id) => state.songs.get(id)).filter(Boolean);
  if (!songs.length) return;
  const one = songs.length === 1 ? songs[0] : null;
  const allFav = songs.every((s) => s.user && s.user.fav);
  const stemsReady = one && (one.hasStems || (state.stems.get(one.id) || {}).state === 'ready');
  const setlistItems = [
    { label: 'New setlist…', icon: 'plus', onClick: () => newSetlist(ids) },
    ...(state.setlists.length ? ['-'] : []),
    ...state.setlists.map((sl) => ({ label: sl.name, icon: 'setlist', onClick: () => addToSetlist(sl.id, ids) })),
  ];
  const items = [
    one ? { label: 'Play', icon: 'play', hint: 'Enter', onClick: () => playSong(one.id) } : null,
    { label: one ? 'Edit details' : `Edit ${songs.length} songs`, icon: 'edit', hint: 'F2', onClick: () => editSongs(ids) },
    { label: allFav ? 'Remove from favorites' : 'Add to favorites', icon: 'heart', onClick: () => toggleFav(ids) },
    { label: 'Add to setlist', icon: 'setlist', submenu: setlistItems },
    state.view.kind === 'setlist' ? { label: 'Remove from this setlist', icon: 'x', onClick: () => removeFromSetlist(state.view.id, ids) } : null,
    '-',
    stemsReady
      ? { label: 'Split stems again', icon: 'split', onClick: () => requestStems(ids, { force: true }) }
      : { label: one ? 'Split stems' : `Split stems for ${songs.length} songs`, icon: 'split', onClick: () => requestStems(ids) },
    stemsReady ? { label: 'Delete stems', icon: 'trash', onClick: () => deleteStems(one) } : null,
    '-',
    one ? { label: 'Show in Explorer', icon: 'external', onClick: () => api.shell.showItem(one.path) } : null,
    one ? { label: 'Restore a backup…', icon: 'restore', onClick: () => dialogsApi && dialogsApi.backups(one) } : null,
    { label: 'Rename files…', icon: 'wand', onClick: () => dialogsApi && dialogsApi.organize(ids) },
    one && one.artist ? { label: `More by ${one.artist}`, icon: 'person', onClick: () => setView({ kind: 'artist', id: one.artist }) } : null,
    one && one.artist ? { label: `What’s missing from ${one.artist}`, icon: 'pie', onClick: () => setView({ kind: 'discover', id: 'artist', artist: { id: null, name: one.artist }, from: 'search' }) } : null,
    '-',
    {
      label: songs.length === 1 ? 'Hide from library' : `Hide ${songs.length} songs from library`,
      icon: 'trash',
      danger: true,
      onClick: async () => {
        if (
          await confirmDialog({
            title: 'Hide from library?',
            message: 'The files stay on disk and Rocksmith still loads them. They come back if the file changes or you rescan everything.',
            confirm: 'Hide',
          })
        ) {
          await api.library.removeSongs(ids);
          await loadLibrary();
        }
      },
    },
  ];
  showMenu(x, y, items);
}

async function deleteStems(song) {
  await api.stems.remove(song.id);
  state.stems.set(song.id, { state: 'none' });
  song.hasStems = false;
  upsertSongs([song]);
  emit('stems');
  if (state.nowPlaying === song.id && stageApi) stageApi.reloadStems();
}

export function libraryMenu(x, y) {
  const visible = visibleSongs();
  showMenu(
    x,
    y,
    [
      { label: 'Rename files…', icon: 'wand', onClick: () => dialogsApi && dialogsApi.organize(state.selection.size ? [...state.selection] : visible.map((s) => s.id)) },
      { label: `Split stems for ${state.selection.size > 1 ? 'selected' : 'all shown'} songs`, icon: 'split', onClick: () => requestStems(state.selection.size > 1 ? [...state.selection] : visible.map((s) => s.id)) },
      { label: 'Find duplicate songs…', icon: 'copy', onClick: () => dialogsApi && dialogsApi.duplicates() },
      '-',
      { label: 'Check folders for changes', icon: 'refresh', onClick: () => api.library.rescan() },
      { label: 'Re-read every file', icon: 'refresh', onClick: () => api.library.rescan({ full: true }) },
      { label: 'Add folder…', icon: 'folderPlus', onClick: () => import('./sidebar.js').then((m) => m.addFolder()) },
    ],
    { align: 'right' }
  );
}
