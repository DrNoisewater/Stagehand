'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, clipboard, MessageChannelMain, safeStorage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');

const { Psarc, safeEdit, restoreBackup } = require('./core/psarc');
const rocksmith = require('./core/rocksmith');
const { dirSize } = require('./core/files');
const { Settings } = require('./services/settings');
const { Library, norm } = require('./services/library');
const { Tools } = require('./services/tools');
const { AudioService } = require('./services/audio');
const { StemService, MODELS } = require('./services/stems');
const { ArtService } = require('./services/art');
const { Organizer } = require('./services/organize');
const { RsProfiles } = require('./services/rsprofiles');
const { MusicBrainz } = require('./services/musicbrainz');
const { Discover, IGNITION } = require('./services/discover');
const { Importer } = require('./services/importer');
const { Covers, imageType } = require('./services/covers');
const { TabService } = require('./services/tabs');
const { RigAudio } = require('./services/rigaudio');
const { ToneStore, ToneIndex } = require('./services/tones');
const { Stats, Takes } = require('./services/stats');
const { Captures } = require('./services/captures');

protocol.registerSchemesAsPrivileged([
  { scheme: 'stagehand', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

const IS_WIN = process.platform === 'win32';
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const ENGINE_SCRIPT = path.join(ROOT, 'engine', 'stagehand_stems.py').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const ICON = path.join(ROOT, 'build', IS_WIN ? 'icon.ico' : 'icon.png');

if (process.env.STAGEHAND_HOME) {
  // Isolated profile for tests and portable use.
  app.setPath('userData', path.join(process.env.STAGEHAND_HOME, 'electron'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let D = null;
let settings;
let library;
let tools;
let audio;
let stems;
let art;
let organizer;
let rsprofiles;
let rigAudio;
let mb;
let discover;
let importer;
let covers;
let tabs;
let toneStore;
let toneIndex;
let stats;
let takes;
let captures;
const logLines = [];

function log(line) {
  const entry = `[${new Date().toISOString()}] ${line}`;
  logLines.push(entry);
  if (logLines.length > 500) logLines.shift();
  if (!app.isPackaged) console.log(entry);
}

function makeDirs() {
  const home = process.env.STAGEHAND_HOME;
  const roaming = home ? path.join(home, 'data') : app.getPath('userData');
  const local = home
    ? path.join(home, 'local')
    : IS_WIN && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Stagehand')
      : path.join(app.getPath('userData'), 'local');
  return {
    roaming,
    local,
    audio: path.join(local, 'Cache', 'audio'),
    art: path.join(local, 'Cache', 'art'),
    stems: path.join(local, 'Stems'),
    tools: path.join(local, 'Tools'),
    engine: path.join(local, 'Engine'),
    backups: path.join(local, 'Backups'),
    profileBackups: path.join(local, 'Backups', 'Rocksmith profiles'),
    replaced: path.join(local, 'Backups', 'Replaced songs'),
    musicbrainz: path.join(local, 'Cache', 'musicbrainz'),
    covers: path.join(local, 'Cache', 'covers'),
    staging: path.join(local, 'Imports'),
    takes: path.join(roaming, 'Takes'),
    captures: path.join(roaming, 'Captures'),
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      log(`${channel} failed: ${err.stack || err.message}`);
      return { ok: false, error: err.message || String(err), code: err.code || null, field: err.field || null };
    }
  });
}

function withStems(s) {
  return { ...s, hasStems: !!stems.ready(s) };
}

function requireSong(id) {
  const s = library.get(id);
  if (!s) throw Object.assign(new Error('That song is no longer in the library'), { code: 'NO_SONG' });
  return s;
}

// ---------------------------------------------------------------- editing --
const fileLocks = new Map();
async function withFileLock(filePath, fn) {
  const key = norm(filePath);
  const prev = fileLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  const chained = prev.then(() => next);
  fileLocks.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (fileLocks.get(key) === chained) fileLocks.delete(key);
  }
}

async function saveEdits(items) {
  const results = [];
  const groups = new Map();
  for (const it of items) {
    const song = library.get(it.songId);
    if (!song) {
      results.push({ songId: it.songId, ok: false, error: 'Song not found' });
      continue;
    }
    try {
      rocksmith.normalizeChanges(it.changes);
    } catch (err) {
      results.push({ songId: it.songId, ok: false, error: err.message, field: err.field });
      continue;
    }
    const k = norm(song.path);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ song, changes: it.changes });
  }
  const updated = [];
  let n = 0;
  for (const group of groups.values()) {
    const filePath = group[0].song.path;
    const np = norm(filePath);
    send('edit:progress', { done: n, total: groups.size, file: path.basename(filePath) });
    library.paused.add(np);
    try {
      await withFileLock(filePath, async () => {
        const psarc = await Psarc.open(filePath);
        const replacements = new Map();
        try {
          const view = {
            names: psarc.names,
            read: async (name) => replacements.get(name) || psarc.read(name),
          };
          for (const g of group) {
            const { replacements: r } = await rocksmith.buildEdit(view, g.song.songKey, g.changes);
            for (const [k, v] of r) replacements.set(k, v);
          }
        } finally {
          await psarc.close();
        }
        if (!replacements.size) {
          group.forEach((g) => results.push({ songId: g.song.id, ok: true, unchanged: true }));
          return;
        }
        const b = settings.get().backups;
        const res = await safeEdit(filePath, replacements, { backupDir: b.enabled ? D.backups : null, keepBackups: b.keep });
        log(`Saved ${filePath}: ${res.replaced.join(', ')}`);
        // Only text inside manifests changed, so the decoded audio and stems still apply.
        const fresh = await library.refreshFile(filePath, { keepAudio: true });
        updated.push(...fresh);
        group.forEach((g) => results.push({ songId: g.song.id, ok: true, replaced: res.replaced, backupPath: res.backupPath }));
      });
    } catch (err) {
      log(`Save failed for ${filePath}: ${err.stack || err.message}`);
      group.forEach((g) => results.push({ songId: g.song.id, ok: false, error: err.message, code: err.code }));
    } finally {
      library.paused.delete(np);
      n++;
    }
  }
  send('edit:progress', { done: n, total: groups.size, finished: true });
  if (updated.length) send('library:songs', updated.map(withStems));
  return { results, songs: updated.map(withStems) };
}

async function listBackups(songId) {
  const song = requireSong(songId);
  const folder = path.join(D.backups, path.basename(song.path).replace(/\.psarc$/i, ''));
  let names = [];
  try {
    names = (await fsp.readdir(folder)).filter((f) => /\.psarc$/i.test(f));
  } catch (_) {
    return [];
  }
  const out = [];
  for (const n of names) {
    const p = path.join(folder, n);
    const st = await fsp.stat(p);
    out.push({ path: p, name: n, size: st.size, at: st.mtimeMs, beforeRestore: n.includes('_before-restore_') });
  }
  return out.sort((a, b) => b.at - a.at);
}

// ----------------------------------------------------------- detection --
async function detectRocksmith() {
  const found = new Set();
  const roots = [];
  if (IS_WIN) {
    const steam = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
    for (const s of steam) {
      roots.push(s);
      try {
        const vdf = await fsp.readFile(path.join(s, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) roots.push(m[1].replace(/\\\\/g, '\\'));
      } catch (_) {}
    }
    for (const d of 'DEFGH') roots.push(`${d}:\\SteamLibrary`);
  } else {
    roots.push(path.join(app.getPath('home'), '.steam', 'steam'), path.join(app.getPath('home'), '.local', 'share', 'Steam'));
  }
  for (const r of roots) {
    const dlc = path.join(r, 'steamapps', 'common', 'Rocksmith2014', 'dlc');
    if (fs.existsSync(dlc)) found.add(dlc);
  }
  const have = new Set(library.data.folders.map((f) => norm(f.path)));
  return [...found].filter((p) => !have.has(norm(p)));
}

// ------------------------------------------------------------- protocol --
function notFound() {
  return new Response('Not found', { status: 404 });
}

async function serve(req) {
  const u = new URL(req.url);
  const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
  let file = null;
  if (u.host === 'app') {
    file = path.join(RENDERER, ...parts);
    if (!(file + path.sep).startsWith(RENDERER + path.sep)) return notFound();
    if (!parts.length) file = path.join(RENDERER, 'index.html');
  } else if (u.host === 'audio') {
    if (parts.length !== 1 || !/^[a-f0-9]{8,40}\.wav$/.test(parts[0])) return notFound();
    file = path.join(D.audio, parts[0]);
  } else if (u.host === 'stems') {
    if (parts.length !== 3 || !/^[a-f0-9]{8,40}$/.test(parts[0]) || !MODELS[parts[1]] || !/^[a-z]+\.(wav|flac|opus)$/.test(parts[2])) return notFound();
    file = path.join(D.stems, ...parts);
  } else if (u.host === 'cover') {
    const f = parts.length === 1 ? await covers.file(parts[0], Number(u.searchParams.get('size')) || 250) : null;
    // No cover: a transparent pixel, so the page keeps its drawn placeholder without logging errors.
    if (!f) return new Response(BLANK_PNG, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600', 'X-Stagehand-Cover': 'none' } });
    const buf = await fsp.readFile(f);
    return new Response(buf, { status: 200, headers: { 'Content-Type': imageType(buf), 'Cache-Control': 'max-age=31536000, immutable' } });
  } else if (u.host === 'capture') {
    if (parts.length !== 2) return notFound();
    file = captures.filePath(parts[0], parts[1]);
  } else if (u.host === 'take') {
    if (parts.length !== 1 || !/^k_[a-f0-9]{10}$/.test(parts[0])) return notFound();
    await takes.list();
    file = takes.pathOf(parts[0]);
  } else if (u.host === 'art') {
    const song = library.get(parts[0]);
    if (!song) return notFound();
    try {
      file = await art.file(song, Number(u.searchParams.get('size')) || 256);
    } catch (err) {
      log(`Art failed for ${song.path}: ${err.message}`);
      return notFound();
    }
  }
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return notFound();
  const res = await net.fetch(pathToFileURL(file).toString());
  if (u.host === 'art') {
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'max-age=31536000, immutable');
    headers.set('Content-Type', 'image/png');
    return new Response(res.body, { status: 200, headers });
  }
  return res;
}

// ---------------------------------------------------------------- window --
function createWindow() {
  const st = settings.get().window;
  const opts = {
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 680,
    show: false,
    backgroundColor: '#131826',
    title: 'Stagehand',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#131826', symbolColor: '#A3AAC2', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  };
  if (st.bounds) Object.assign(opts, st.bounds);
  win = new BrowserWindow(opts);
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return;
    if (st.maximized) win.maximize();
    win.show();
    win.focus();
  });
  win.loadURL('stagehand://app/index.html');

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    settings.set({ window: { bounds: win.isMaximized() ? st.bounds || win.getNormalBounds() : win.getBounds(), maximized: win.isMaximized() } });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('closed', () => (win = null));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('stagehand://app/')) e.preventDefault();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
}

/** A song's remembered mix: { you, song, stems: { name: { v, on } } }. */
function cleanMix(m) {
  if (!m || typeof m !== 'object') return null;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1.5, Number(v))) : d);
  const out = { you: num(m.you, 0.7), song: num(m.song, 0.85), stems: {} };
  for (const [k, v] of Object.entries(m.stems || {})) if (/^[a-z]{2,12}$/.test(k) && v) out.stems[k] = { v: num(v.v, 0.8), on: v.on !== false };
  return out;
}

/** Opens a TONE3000 sign-in/confirm page in a small window; resolves with the redirect URL it ends on. */
function openTone3000(url, redirect) {
  let w = null;
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    w = new BrowserWindow({
      parent: win || undefined,
      width: 560,
      height: 800,
      title: 'TONE3000 · Stagehand',
      autoHideMenuBar: true,
      backgroundColor: '#0f1320',
      icon: fs.existsSync(ICON) ? ICON : undefined,
      webPreferences: { partition: 'persist:tone3000', sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const hit = (u) => {
      if (settled || !String(u).startsWith(redirect)) return false;
      settled = true;
      resolve(String(u));
      setImmediate(() => w && !w.isDestroyed() && w.close());
      return true;
    };
    // the way back is a redirect to our address: catch it before anything loads
    w.webContents.session.webRequest.onBeforeRequest({ urls: [`${redirect}*`, `${redirect.replace('127.0.0.1', 'localhost')}*`] }, (d, cb) => {
      hit(d.url.replace('localhost', '127.0.0.1'));
      cb({ cancel: true });
    });
    w.webContents.on('will-redirect', (e, u) => hit(u) && e.preventDefault());
    w.webContents.on('will-navigate', (e, u) => hit(u) && e.preventDefault());
    // links that open new windows go to your browser
    w.webContents.setWindowOpenHandler(({ url: u }) => {
      if (/^https:\/\//.test(u)) shell.openExternal(u);
      return { action: 'deny' };
    });
    w.on('closed', () => {
      w = null;
      if (!settled) {
        settled = true;
        reject(Object.assign(new Error('Closed before confirming, so nothing was downloaded.'), { code: 'cancelled' }));
      }
    });
    w.loadURL(url).catch(() => {});
  });
  return { promise, close: () => w && !w.isDestroyed() && w.close() };
}

// ------------------------------------------------------------------ IPC --
function registerIpc() {
  // Native guitar rig: the page asks for a port, we hand one end to the helper relay.
  ipcMain.on('rig:connect', (e, kind) => {
    const { port1, port2 } = new MessageChannelMain();
    rigAudio.attach(port1, kind === 'song' ? 'song' : 'control');
    e.sender.postMessage('rig:port', { kind: kind === 'song' ? 'song' : 'control' }, [port2]);
  });
  handle('rig:available', () => rigAudio.available());

  // Your tones, every tone in your songs, practice stats and takes (Stagehand 3).
  handle('tones:get', () => toneStore.get());
  handle('tones:save', (tone) => toneStore.save(tone));
  handle('tones:remove', (id) => toneStore.remove(id));
  handle('tones:setSlot', (id, slot) => toneStore.setSlot(id, slot));
  handle('tones:seed', (list) => toneStore.seed(list));
  handle('tones:library', () => toneIndex.list(library.data.songs ? Object.values(library.data.songs) : library.snapshot().songs, { onProgress: (p) => send('tones:progress', p) }));
  // Real amp captures (NAM) and TONE3000
  handle('captures:get', () => captures.state());
  handle('captures:assign', (ampKey, packId) => captures.assign(ampKey, packId));
  handle('captures:remove', (packId) => captures.remove(packId));
  handle('captures:setKind', (packId, kind) => captures.setKind(packId, kind));
  handle('captures:addFiles', async (ampKey) => {
    const r = await dialog.showOpenDialog(win, { title: 'Add NAM captures (.nam files, or a .zip of them)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'NAM captures', extensions: ['nam', 'zip'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    return captures.addFiles(r.filePaths, ampKey || null);
  });
  handle('captures:setKey', (id) => captures.setClientId(id));
  handle('captures:connect', () => captures.connect());
  handle('captures:disconnect', () => captures.disconnect());
  handle('captures:useBrowser', (on) => captures.setUseBrowser(on));
  handle('captures:get3k', (packKey, ampKey) => captures.get(packKey, ampKey));
  handle('captures:browse', (ampKey, opts) => captures.browse(ampKey, opts));
  handle('stats:log', (s) => stats.log(s));
  handle('stats:summary', (period) => stats.summary(period));
  handle('stats:best', () => stats.best());
  handle('takes:list', () => takes.list());
  handle('takes:save', (t) => takes.save(t));
  handle('takes:remove', (id) => takes.remove(id));
  handle('takes:rename', (id, name) => takes.rename(id, name));
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, dirs: D, models: MODELS }));
  handle('app:log', () => logLines.slice(-200));
  handle('win:fullscreen', (on) => {
    if (win && !win.isDestroyed()) win.setFullScreen(!!on);
    return !!(win && win.isFullScreen());
  });
  handle('win:titlebar', (colors) => {
    if (win && win.setTitleBarOverlay) win.setTitleBarOverlay(colors);
  });

  handle('library:get', () => {
    const snap = library.snapshot();
    snap.songs = snap.songs.map(withStems);
    return snap;
  });
  handle('library:addFolder', async (folder) => {
    let p = folder;
    if (!p) {
      const r = await dialog.showOpenDialog(win, { title: 'Add a folder with Rocksmith songs', properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths.length) return null;
      p = r.filePaths[0];
    }
    library.addFolder(p);
    return p;
  });
  handle('library:removeFolder', (p) => library.removeFolder(p));
  handle('library:rescan', (opts) => {
    library.scan(opts || {});
  });
  handle('library:detect', () => detectRocksmith());
  handle('library:removeSongs', (ids) => {
    library.removeSongs(ids);
    send('library:reset');
  });

  handle('song:setUser', (id, patch) => {
    const allowed = {};
    if ('fav' in patch) allowed.fav = !!patch.fav;
    if ('rating' in patch) allowed.rating = Math.max(0, Math.min(5, Number(patch.rating) || 0));
    if ('notes' in patch) allowed.notes = String(patch.notes).slice(0, 2000);
    if ('mix' in patch) allowed.mix = cleanMix(patch.mix);
    const s = library.setUser(id, allowed);
    return s && withStems(s);
  });
  handle('song:played', (id) => {
    const s = library.markPlayed(id);
    return s && withStems(s);
  });

  handle('setlist:create', (name) => library.createSetlist(name));
  handle('setlist:rename', (id, name) => library.renameSetlist(id, name));
  handle('setlist:delete', (id) => library.deleteSetlist(id));
  handle('setlist:add', (id, songIds) => library.addToSetlist(id, songIds));
  handle('setlist:remove', (id, songIds) => library.removeFromSetlist(id, songIds));
  handle('setlist:reorder', (id, songIds) => library.reorderSetlist(id, songIds));

  handle('edit:save', (items) => saveEdits(items));
  handle('edit:backups', (songId) => listBackups(songId));
  handle('edit:restore', async (songId, backupPath) => {
    const song = requireSong(songId);
    const list = await listBackups(songId);
    if (!list.some((b) => b.path === backupPath)) throw new Error('Unknown backup');
    const np = norm(song.path);
    library.paused.add(np);
    try {
      await withFileLock(song.path, () => restoreBackup(backupPath, song.path, { backupDir: D.backups }));
      const fresh = (await library.refreshFile(song.path)).map(withStems);
      send('library:songs', fresh);
      return fresh;
    } finally {
      library.paused.delete(np);
    }
  });

  handle('audio:prepare', async (songId) => {
    const song = requireSong(songId);
    return withFileLock(song.path, () => audio.prepare(song));
  });

  handle('tab:list', (songId) => tabs.list(requireSong(songId)));
  handle('tab:load', (songId, arrId) => {
    const song = requireSong(songId);
    return withFileLock(song.path, () => tabs.load(song, arrId ? String(arrId) : null));
  });

  handle('stems:status', (songId) => stems.status(library.get(songId)));
  handle('stems:request', (songIds, opts) => stems.request(songIds, opts || {}));
  handle('stems:prioritize', (songId) => stems.prioritize(songId));
  handle('stems:cancel', (songId) => stems.cancel(songId));
  handle('stems:remove', (songId) => stems.remove(library.get(songId)));
  handle('stems:queue', () => stems.queueInfo());
  // Stem storage formats (Stagehand 3): the page compresses, we store.
  handle('stems:store', (songId, model, name, ext, bytes) => stems.storeFile(library.get(songId), model, name, ext, bytes));
  handle('stems:finish', (songId, model, format) => stems.finishFormat(library.get(songId), model, format));
  handle('stems:formats', () => stems.formats(library.snapshot().songs));

  handle('engine:status', async (refresh) => {
    if (refresh) await tools.detectGpus({ refresh: true });
    return tools.engineStatus({ refresh: !!refresh });
  });
  handle('engine:gpu', () => tools.chooseVariant('auto'));
  handle('engine:setup', (opts) => tools.setupEngine(opts || {}, (p) => send('engine:progress', p)));
  handle('engine:cancel', () => tools.cancelSetup());
  handle('engine:remove', () => tools.removeEngine());

  handle('tools:vgmstream', () => ({ path: tools.vgmstreamPath() }));
  handle('tools:installVgmstream', () => tools.installVgmstream((p) => send('tools:progress', p)));

  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => {
    const before = settings.get().stems.model;
    const s = settings.set(patch || {});
    if (patch && patch.engine && 'python' in patch.engine) tools._engineStatus = null;
    if (patch && patch.stems && 'device' in patch.stems) send('engine:changed');
    if (s.stems.model !== before) send('stems:model', s.stems.model);
    return s;
  });

  handle('rs:read', () => rsprofiles.read());
  handle('rs:apply', (ops) => {
    if (!Array.isArray(ops) || !ops.length) throw new Error('Nothing to change');
    const clean = ops.map((o) => {
      if (o.addList) return { addList: true };
      if (o.removeList !== undefined) return { removeList: Number(o.removeList) };
      return {
        list: o.list === 'favorites' ? 'favorites' : Number(o.list),
        add: Array.isArray(o.add) ? o.add.map(String) : undefined,
        remove: Array.isArray(o.remove) ? o.remove.map(String) : undefined,
        set: Array.isArray(o.set) ? o.set.map(String) : undefined,
      };
    });
    return rsprofiles.apply(clean);
  });
  handle('rs:rename', (names) => {
    const clean = {};
    for (const [k, v] of Object.entries(names || {})) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < 20) clean[i] = String(v ?? '').slice(0, 200);
    }
    if (!Object.keys(clean).length) throw new Error('Nothing to rename');
    return rsprofiles.rename(clean);
  });
  handle('rs:gameDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Find your Rocksmith 2014 folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    const d = r.filePaths[0];
    if (!fs.existsSync(path.join(d, 'Rocksmith2014.exe')) && !fs.existsSync(path.join(d, 'cache.psarc'))) {
      throw new Error('That folder doesn’t contain Rocksmith2014.exe. Pick the folder the game is installed in.');
    }
    settings.set({ rocksmith: { gameDir: d } });
    return rsprofiles.read();
  });
  handle('rs:backups', () => rsprofiles.backups());
  handle('rs:restore', (id) => rsprofiles.restore(id));
  handle('rs:select', (id) => {
    settings.set({ rocksmith: { profile: id } });
    return rsprofiles.read();
  });
  handle('rs:steamDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Find your Steam folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    if (!fs.existsSync(path.join(r.filePaths[0], 'userdata'))) throw new Error('That folder has no "userdata" folder inside. Pick the main Steam folder.');
    settings.set({ rocksmith: { steamDir: r.filePaths[0] } });
    return rsprofiles.read();
  });

  // Discover: MusicBrainz search, artist pages, collection gaps, wanted songs.
  handle('discover:search', (q) => discover.search(String(q || '').slice(0, 200)));
  handle('discover:recent', () => discover.data.recent);
  handle('discover:clearRecent', () => {
    discover.data.recent = [];
    discover.saveSoon();
  });
  handle('discover:artist', (opts = {}) => discover.artist({ id: opts.id ? String(opts.id) : null, name: opts.name ? String(opts.name) : '', fresh: !!opts.fresh }));
  handle('discover:gaps', () => discover.gaps());
  handle('discover:checkGaps', (opts = {}) => discover.checkGaps({ keys: Array.isArray(opts.keys) ? opts.keys.map(String) : null, fresh: !!opts.fresh }));
  handle('discover:cancelGaps', () => discover.cancelGaps());
  handle('discover:wanted', () => discover.wanted());
  handle('discover:addWanted', (items) => discover.addWanted(Array.isArray(items) ? items.slice(0, 2000) : []));
  handle('discover:removeWanted', (ids) => discover.removeWanted(Array.isArray(ids) ? ids.map(String) : []));
  handle('discover:clearFound', () => discover.clearFound());
  handle('discover:copy', (text) => clipboard.writeText(String(text || '').slice(0, 20000)));
  handle('discover:customsforge', (opts = {}) => {
    // Stagehand never searches CustomsForge itself: their rules forbid bots and
    // scrapers. It copies the search and opens the site in the user's browser.
    if (opts.text) clipboard.writeText(String(opts.text).slice(0, 300));
    const url = opts.page === 'artists' ? `${IGNITION}artist` : IGNITION;
    if (opts.open !== false && !process.env.STAGEHAND_NO_EXTERNAL) shell.openExternal(url);
    return { url, copied: opts.text ? String(opts.text).slice(0, 300) : null };
  });

  handle('import:status', () => importer.status());
  handle('import:configure', (patch) => importer.configure(patch || {}));
  handle('import:files', async (paths) => {
    let files = Array.isArray(paths) ? paths.map(String) : null;
    if (!files) {
      const r = await dialog.showOpenDialog(win, {
        title: 'Import Rocksmith songs',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Rocksmith songs', extensions: ['psarc', 'zip'] }],
      });
      if (r.canceled || !r.filePaths.length) return null;
      files = r.filePaths;
    }
    return importer.importFiles(files, { origin: Array.isArray(paths) ? 'drop' : 'manual' });
  });
  handle('import:waiting', (paths) => importer.importWaiting(Array.isArray(paths) ? paths.map(String) : null));
  handle('import:undo', (id) => importer.undo(String(id)));
  handle('import:retryLists', () => importer.flushLists());
  handle('import:clearHistory', () => importer.clearHistory());
  handle('import:pickFolder', async (which) => {
    const r = await dialog.showOpenDialog(win, {
      title: which === 'target' ? 'Where should imported songs go?' : 'Which folder do your downloads go to?',
      properties: ['openDirectory'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return importer.configure(which === 'target' ? { target: r.filePaths[0] } : { watchDir: r.filePaths[0] });
  });

  handle('organize:preview', (opts) => organizer.plan(opts));
  handle('organize:apply', async (items) => {
    for (const it of items) library.paused.add(norm(it.from));
    try {
      const r = await organizer.apply(items);
      send('library:reset');
      return r;
    } finally {
      for (const it of items) library.paused.delete(norm(it.from));
    }
  });
  handle('organize:undo', async () => {
    const r = await organizer.undo();
    send('library:reset');
    return r;
  });
  handle('organize:last', () => organizer.lastBatch());

  handle('shell:showItem', (p) => shell.showItemInFolder(p));
  handle('shell:openPath', (p) => shell.openPath(p));
  handle('shell:openExternal', (url) => {
    if (!/^https:\/\//.test(url)) throw new Error('Only web links can be opened');
    return shell.openExternal(url);
  });
  handle('dialog:pickFile', async (opts = {}) => {
    const r = await dialog.showOpenDialog(win, { title: opts.title || 'Choose a file', properties: ['openFile'], filters: opts.filters });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('cache:info', async () => ({
    audio: await dirSize(D.audio),
    stems: await dirSize(D.stems),
    art: await dirSize(D.art),
    backups: await dirSize(D.backups),
    engine: await dirSize(D.engine),
  }));
  handle('cache:clear', async (which) => {
    if (which === 'audio') await audio.clear();
    else if (which === 'stems') await fsp.rm(D.stems, { recursive: true, force: true });
    else if (which === 'art') await fsp.rm(D.art, { recursive: true, force: true });
    else throw new Error('Unknown cache');
  });
}

// ------------------------------------------------------------------ boot --
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  if (IS_WIN) app.setAppUserModelId('app.stagehand.desktop');
  Menu.setApplicationMenu(null);
  D = makeDirs();
  for (const d of Object.values(D)) await fsp.mkdir(d, { recursive: true });

  settings = new Settings(path.join(D.roaming, 'settings.json'));
  await settings.load();
  library = new Library(path.join(D.roaming, 'library.json'));
  await library.load();
  library.on('log', log);
  // Chromium's network stack honours system proxies; Node's fetch is the fallback.
  const fetchImpl = async (url, opts) => {
    try {
      const r = await net.fetch(url, opts);
      if (r.ok) return r;
      log(`net.fetch ${url} answered ${r.status}, retrying with Node fetch`);
    } catch (err) {
      log(`net.fetch ${url} failed (${err.message}), retrying with Node fetch`);
    }
    return fetch(url, opts);
  };
  tools = new Tools({ toolsDir: D.tools, engineDir: D.engine, settings, fetchImpl, engineScript: ENGINE_SCRIPT });
  tools._log = log;
  audio = new AudioService({ cacheDir: D.audio, tools, library, settings, log });
  stems = new StemService({ stemsDir: D.stems, audio, tools, settings, library, engineScript: ENGINE_SCRIPT, log });
  await stems.startup();
  art = new ArtService({ cacheDir: D.art });
  tabs = new TabService({ log });
  rigAudio = new RigAudio({ log, appRoot: path.join(__dirname, '..', '..') });
  toneStore = new ToneStore(path.join(D.roaming, 'tones.json'));
  await toneStore.load();
  toneIndex = new ToneIndex({ file: path.join(D.local, 'Cache', 'tone-index.json'), log });
  stats = new Stats(path.join(D.roaming, 'stats.json'));
  await stats.load();
  takes = new Takes(D.takes);
  captures = new Captures({
    dir: D.captures,
    fetchImpl: (url, opts) => net.fetch(url, opts).catch(() => fetch(url, opts)),
    // TONE3000 in a small window of ours: no stray browser tab, closes itself when TONE3000 sends you back
    openAuth: process.env.STAGEHAND_T3K_OPEN ? null : (url, redirect) => openTone3000(url, redirect),
    // tests stand in for the browser by following the sign-in page's redirect themselves
    openExternal: (url) => (process.env.STAGEHAND_T3K_OPEN === 'fetch' ? fetch(url).then(() => true) : shell.openExternal(url)),
    focus: () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    },
    safeStorage,
    log,
  });
  await captures.load().catch((e) => log(`Captures failed to load: ${e.message}`));
  captures.on('change', (st) => send('captures:change', st));
  organizer = new Organizer({ library, logFile: path.join(D.roaming, 'organize-log.json') });
  rsprofiles = new RsProfiles({ settings, backupDir: D.profileBackups, log, libraryFolders: () => library.data.folders.map((f) => f.path) });
  const userAgent = `Stagehand/${app.getVersion()} ( Rocksmith library manager for Windows )`;
  // MusicBrainz counts every request, so only retry with Node's fetch when Chromium's
  // network stack itself failed (no answer, or a proxy refusal), never on 503 "slow down".
  const politeFetch = async (url, opts) => {
    try {
      const r = await net.fetch(url, opts);
      if (r.status !== 403 && r.status !== 407) return r;
    } catch (_) {}
    return fetch(url, opts);
  };
  mb = new MusicBrainz({ cacheDir: D.musicbrainz, fetchImpl: politeFetch, userAgent, log });
  covers = new Covers({ dir: D.covers, fetchImpl: politeFetch, userAgent, log });
  discover = new Discover({ file: path.join(D.roaming, 'discover.json'), mb, library, log });
  await discover.load();
  importer = new Importer({
    file: path.join(D.roaming, 'imports.json'),
    settings,
    library,
    discover,
    rsprofiles,
    stagingDir: D.staging,
    replacedDir: D.replaced,
    defaultWatchDir: process.env.STAGEHAND_DOWNLOADS || app.getPath('downloads'),
    trash: process.env.STAGEHAND_HOME ? (p) => fsp.unlink(p) : (p) => shell.trashItem(p),
    log,
  });
  await importer.load();
  discover.on('progress', (p) => send('discover:progress', p));
  discover.on('gaps', (g) => send('discover:gaps', g));
  importer.on('update', (st) => send('import:update', st));
  importer.on('imported', (r) => send('import:done', r));
  importer.on('songs', (songs) => {
    if (songs.length) send('library:songs', songs.map(withStems));
    send('library:reset'); // an update or undo also removed records
  });
  importer.on('lists', () => send('rocksmith:changed'));

  let resetTimer = null;
  library.on('reset', () => {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => send('library:reset'), 60);
  });
  library.on('scan', (p) => send('scan:progress', p));
  stems.on('update', (p) => send('stems:update', p));
  stems.on('done', (p) => send('stems:done', p));

  protocol.handle('stagehand', (req) =>
    serve(req).catch((err) => {
      log(`protocol error ${req.url}: ${err.message}`);
      return new Response('Error', { status: 500 });
    })
  );
  registerIpc();
  createWindow();
  library.watch();
  setTimeout(() => library.scan(), 800);
  setTimeout(() => importer.start().catch((e) => log(`Import watcher failed: ${e.message}`)), 1500);
});

let flushed = false;
app.on('before-quit', async (e) => {
  if (flushed) return;
  e.preventDefault();
  flushed = true;
  try {
    library.close();
    if (rigAudio) rigAudio.quit();
    importer.stop();
    discover.cancelGaps();
    for (const j of [stems.current]) if (j && j.child) j.child.kill();
    await Promise.all([library.save(), settings.save(), discover.save(), importer.save(), toneStore.flush(), stats.flush(), toneIndex ? toneIndex.flush() : null]);
  } catch (_) {}
  app.quit();
});

app.on('window-all-closed', () => app.quit());
