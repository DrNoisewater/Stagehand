'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, clipboard, MessageChannelMain, safeStorage, desktopCapturer } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');

const { Psarc, safeEdit, restoreBackup } = require('./core/psarc');
const rocksmith = require('./core/rocksmith');
const { dirSize } = require('./core/files');
const { Settings } = require('./services/settings');
const { Library, norm } = require('./services/library');
const { Dupes, findDuplicates } = require('./services/dupes');
const { Tools } = require('./services/tools');
const { AudioService } = require('./services/audio');
const { ClipSessions } = require('./services/clip-sessions');
const { AudioFinder } = require('./services/audiofind');
const { StemService, MODELS } = require('./services/stems');
const { ArtService } = require('./services/art');
const { Companion } = require('./services/companion'); // 4.16: the Quest companion (off until switched on)
const { Organizer } = require('./services/organize');
const { RsProfiles } = require('./services/rsprofiles');
const { MusicBrainz } = require('./services/musicbrainz');
const { OfficialList } = require('./services/officiallist');
const officialList = new OfficialList();
const { Discover, IGNITION } = require('./services/discover');
const { Importer } = require('./services/importer');
const { Covers, imageType } = require('./services/covers');
const { TabService } = require('./services/tabs');
const { RigAudio } = require('./services/rigaudio');
const { ToneStore, ToneIndex } = require('./services/tones');
const { Stats, Takes } = require('./services/stats');
const { Levels } = require('./services/levels');
const { CareerBackups } = require('./services/profile-backup');
const { lifetime } = require('./services/lifetime');
const { Captures } = require('./services/captures');
const { GreenRoom } = require('./services/greenroom');

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
let finder;
let dlcImporter;
let stems;
let art;
let companion = null; // 4.16: the Quest companion
let organizer;
let rsprofiles;
let rigAudio;
let mb;
let discover;
let importer;
let songFinder = null; // 4.12: CustomsForge in a Stagehand window
let covers;
let tabs;
let toneStore;
let toneIndex;
let stats;
let levels; // 4.4: points and levels
let careerBackups; // 4.5: backups of stats/levels/tones…
/** 4.5: the developer menu works only when developer mode is on (Settings › About, or STAGEHAND_DEV=1). */
const devOn = () => process.env.STAGEHAND_DEV === '1' || !!(settings && settings.get().developer === true);
const needDev = () => {
  if (!devOn()) throw new Error('Developer mode is off');
};
let takes;
let captures;
let room; // Backstage (4.3; Friends before)
let updates; // 4.1.4: newer Stagehand from GitHub releases
const logLines = [];
let clipSessions = null;
let activity = '';
let crashNote = null;
const crashTimes = [];

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
  // 4.16: a headset following along gets the new song list too (nothing happens when it's off)
  if (companion && (channel === 'library:songs' || channel === 'library:reset')) companion.libraryChanged();
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
  return { ...s, hasStems: !!stems.ready(s), official: officialList.isOfficial(s) };
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

/**
 * 3.8: reading a song (its audio, its parts) only waits for a save that's under way,
 * not for other reads: before, a slow audio decode held the part reading for the
 * same song up (and the other way round), so a song could sit "stuck".
 */
async function withFileRead(filePath, fn) {
  const pending = fileLocks.get(norm(filePath));
  if (pending) await pending;
  return fn();
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
    // 4.4: the folder is named after the song; the address keeps the audio key
    file = stems.fileFor(parts[0], parts[1], parts[2]);
    if (!file) return notFound();
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
  if (u.host === 'app' && file.endsWith('.avif')) {
    // 4.9.1: the pictures are AVIF; say so plainly rather than rely on the file loader's guess
    const headers = new Headers(res.headers);
    headers.set('Content-Type', 'image/avif');
    return new Response(res.body, { status: res.status, headers });
  }
  if (u.host === 'take') {
    // 4.1.2: the Recordings window sends a recording's sound into the sound engine,
    // which a browser only allows when the file says the app's own page may read it
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', 'stagehand://app');
    return new Response(res.body, { status: res.status, headers });
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
    // 4.5: no Windows overlay buttons; the page draws its own minimize/maximize/close
    // (index.html .win-ctl) so they match the look. 'hidden' keeps the resize edges and snapping.
    titleBarStyle: 'hidden',
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
  // 3.9: the mouse's back button (Windows sends it as an app command)
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') send('nav:back');
  });
  const winState = () => win && !win.isDestroyed() && send('win:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  for (const ev of ['maximize', 'unmaximize']) win.on(ev, winState);
  // 4.6.1: on Windows, isFullScreen() can still say true inside 'leave-full-screen', so the page
  // kept hiding the window buttons after the highway closed. Say what happened, then check again.
  win.on('enter-full-screen', () => send('win:state', { maximized: win.isMaximized(), fullscreen: true }));
  win.on('leave-full-screen', () => {
    send('win:state', { maximized: win.isMaximized(), fullscreen: false });
    setTimeout(winState, 250);
    setTimeout(winState, 1000);
  });
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('closed', () => (win = null));

  // 4.0.7: if the page dies (out of memory, a crash), bring it back by itself and say
  // what happened; a recording that was running is saved as far as it got
  win.webContents.on('render-process-gone', (_e, details) => {
    const reason = (details && details.reason) || 'crashed';
    if (reason === 'clean-exit') return;
    const words = { oom: 'it ran out of memory', crashed: 'it crashed', 'abnormal-exit': 'it stopped unexpectedly', killed: 'it was closed by Windows', 'launch-failed': 'it couldn’t start', 'integrity-failure': 'it failed a safety check' }[reason] || 'it stopped';
    log(`The window stopped (${reason}, exit code ${details && details.exitCode}). Doing: ${activity || 'nothing in particular'}`);
    if (rigAudio) rigAudio.pageGone();
    const note = { at: Date.now(), reason, words, activity, recordings: [] };
    crashNote = note;
    const doing = activity;
    activity = '';
    for (const s of clipSessions ? clipSessions.active() : []) {
      note.recordings.push({ title: s.title, saving: true });
      const entry = note.recordings[note.recordings.length - 1];
      clipSessions.close(s.id)
        .then((c) => (c.vbytes ? saveClip({ ...c, title: `${c.title} (saved after a crash)` }).finally(() => clipSessions.remove(c.dir)) : clipSessions.remove(c.dir).then(() => null)))
        .then((r) => { entry.saving = false; entry.name = r && r.take ? r.take.name : null; log(r ? `Saved the recording that was running: ${entry.name}` : 'The recording that was running had nothing in it yet.'); send('app:recovered', { ...entry }); })
        .catch((err) => { entry.saving = false; entry.error = err.message; log(`Couldn’t save the recording that was running: ${err.message}`); send('app:recovered', { ...entry }); });
    }
    const now = Date.now();
    crashTimes.push(now);
    while (crashTimes.length && now - crashTimes[0] > 120000) crashTimes.shift();
    if (crashTimes.length >= 3) {
      // the third time in two minutes: don't loop, ask
      dialog.showMessageBox(win, { type: 'error', title: 'Stagehand', message: 'Stagehand’s window keeps stopping.', detail: `This time ${words}${doing ? `, while: ${doing}` : ''}. Reload it, or close Stagehand and open it again.`, buttons: ['Reload', 'Close Stagehand'], defaultId: 0 })
        .then((r) => { if (!win || win.isDestroyed()) return; if (r.response === 0) win.loadURL('stagehand://app/index.html'); else win.close(); });
      return;
    }
    setTimeout(() => { if (win && !win.isDestroyed()) win.loadURL('stagehand://app/index.html'); }, 600);
  });

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
/** A recorded clip (capture + optional WAV of the engine's sound) → an MP4 in your recordings. */
async function saveClip({ input, sound, title, songId, seconds, about = null }) {
  await fsp.mkdir(path.join(D.takes,'Videos'),{recursive:true});
  const rel=takes.freeName(String(title||'Jam Session'),'mp4','Videos');
  const file=path.join(D.takes,rel);
  const output=path.join(path.dirname(input),'export.mp4');
  const video=require('./services/video-export');
  const exe=await video.ensureEncoder(tools);
  await video.exportMp4(exe,input,output,sound||null);
  // 4.1.2: check the saved video's sound and log it, so "no sound" can be told apart
  // from "sound that couldn't be heard" (the cause the last few times)
  const level=await video.soundLevel(exe,output);
  const soundBytes=sound?(await fsp.stat(sound).catch(()=>({size:0}))).size:0;
  log(`Video saved: ${rel}, ${Math.round(Number(seconds)||0)} s; engine sound ${soundBytes?`${Math.round(soundBytes/1024)} KB`:'none'}; loudest ${level.peakDb===null?'no sound track':`${level.peakDb} dB`}`);
  await fsp.copyFile(output,file);
  const take=await takes.addVideo({file:rel,name:path.basename(rel,'.mp4').replace(/^SH - /,''),songId:songId||null,seconds:Number(seconds)||0,about});
  return {path:file,take,hasSound:level.hasSound,peakDb:level.peakDb};
}

function registerIpc() {
  // Native guitar rig: the page asks for a port, we hand one end to the helper relay.
  ipcMain.on('rig:connect', (e, kind) => {
    const { port1, port2 } = new MessageChannelMain();
    const k = kind === 'song' || kind === 'voice' ? kind : 'control';
    rigAudio.attach(port1, k);
    e.sender.postMessage('rig:port', { kind: k }, [port2]);
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
  handle('cabs:ensure', id => require('./services/cabinets').ensureCab(path.join(D.captures,'Cabinets'),id,(url,opts)=>net.fetch(url,opts)));
  handle('cabs:bytes',async id=>{
    const file=await require('./services/cabinets').ensureCab(path.join(D.captures,'Cabinets'),id,(url,opts)=>net.fetch(url,opts));
    return new Uint8Array(await fsp.readFile(file));
  });
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
  handle('captures:get3k', async(packKey,ampKey)=>{
    const result=await captures.get(packKey,ampKey);
    const ids=Object.keys(require('../renderer/data/cabs/manifest.json')).filter(id=>(/bass/i.test(ampKey||packKey)||!!captures.state().map.packs[packKey]?.bass) ? id.startsWith('bass-') : !id.startsWith('bass-'));
    const failed=[];
    await Promise.all(ids.map(id=>require('./services/cabinets').ensureCab(path.join(D.captures,'Cabinets'),id,(url,opts)=>net.fetch(url,opts)).catch(e=>{failed.push(id);log('Cabinet download: '+e.message);})));
    if(failed.length)result.cabWarning='The amp is ready, but the cabinet download failed. The modeled cabinet will play until the download is available.';
    return result;
  });
  handle('captures:browse', (ampKey, opts) => captures.browse(ampKey, opts));
  handle('stats:log', (s) => {
    const was = levels ? levels.state().level : 0;
    const e = stats.log(s);
    if (levels && room && levels.state().level !== was) room.announceSoon();
    return e;
  });
  handle('stats:summary', (period) => stats.summary(period));
  handle('stats:best', () => stats.best());
  handle('levels:state', () => levels.state());
  handle('levels:did', async (id) => {
    const was = levels.state().level;
    const st = await levels.did(id);
    if (st.level !== was && room) room.announceSoon();
    return st;
  });
  handle('levels:title', (id) => levels.setTitle(id));

  // 4.5: lifetime statistics (never reset with progression), backups, export
  const songsLib = () => (library.data && library.data.songs) || {};
  handle('career:lifetime', () => {
    const l = lifetime({ sessions: stats.data.sessions, archive: stats.data.archive, songs: songsLib() });
    l.recovered = stats.recovered;
    return l;
  });
  handle('career:backups', () => careerBackups.list());
  handle('career:backup', () => careerBackups.backup('manual'));
  handle('career:export', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Export your career', defaultPath: `Stagehand career ${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    const st = levels.state();
    const out = {
      exported: new Date().toISOString(), version: app.getVersion(),
      lifetime: { ...lifetime({ sessions: stats.data.sessions, archive: stats.data.archive, songs: songsLib() }), masteryBySong: undefined },
      progression: { level: st.level, xp: st.xp, unlocked: st.unlocked, trophies: st.trophies.map((t) => ({ id: t.id, tier: t.metal, value: t.value })), titles: st.titles.filter((t) => t.earned).map((t) => t.name), timeline: st.timeline },
      sessions: stats.data.sessions,
      archive: stats.data.archive || null,
    };
    await fsp.writeFile(r.filePath, JSON.stringify(out, null, 1));
    return r.filePath;
  });

  // 4.5: the developer menu. Every call checks developer mode here, not only in the page.
  handle('dev:enabled', () => devOn());
  handle('dev:levels', async (op, ...args) => {
    needDev();
    const ops = {
      setLevel: () => levels.setLevel(args[0]),
      addXp: () => levels.addXp(Number(args[0]) || 0),
      setVenue: () => levels.setVenue(String(args[0]), args[1] === null ? null : !!args[1]),
      unlockAll: () => levels.unlockAll(!!args[0]),
      resetProgression: () => levels.resetProgression(),
      resetAchievements: () => levels.resetAchievements(),
      completeChallenge: () => levels.completeChallenge(String(args[0])),
      resetChallenges: () => levels.resetChallenges(),
    };
    if (!ops[op]) throw new Error(`Unknown: ${op}`);
    const st = await ops[op]();
    if (room) room.announceSoon();
    return st;
  });
  handle('dev:integrity', async (fix) => {
    needDev();
    let fixed = 0;
    if (fix) {
      await careerBackups.backup('before-dedupe');
      fixed = stats.dedupe();
      await stats.flush();
    }
    return { ...(await careerBackups.integrity({ sessions: stats.data.sessions })), fixed };
  });
  handle('dev:balance', (days) => {
    needDev();
    return require('./services/progression-sim').balanceReport({ days: Math.max(30, Math.min(730, Number(days) || 365)) });
  });
  handle('dev:restore', async (id) => {
    needDev();
    await stats.flush();
    const r = await careerBackups.restore(id, ['stats.json', 'levels.json']); // the career; other files are kept in the backup for by-hand recovery
    await stats.load();
    await levels.reload();
    return r;
  });
  handle('dev:testRecovery', async () => {
    needDev();
    // in a scratch folder: back up, damage the copy, read it back through recovery
    const tmp = await fsp.mkdtemp(path.join(app.getPath('temp'), 'sh-recovery-'));
    const tb = new CareerBackups({ dataDir: tmp, dir: path.join(tmp, 'backups'), log: () => {} });
    await fsp.writeFile(path.join(tmp, 'stats.json'), JSON.stringify({ sessions: stats.data.sessions.slice(-50) }));
    await tb.backup('test');
    await fsp.writeFile(path.join(tmp, 'stats.json'), '{"sessions": [ damaged');
    const r = await tb.safeRead(path.join(tmp, 'stats.json'));
    const ok = !!(r.data && Array.isArray(r.data.sessions) && r.recovered && fs.existsSync(r.corrupt));
    await fsp.rm(tmp, { recursive: true, force: true });
    return { ok, sessions: r.data ? r.data.sessions.length : 0 };
  });
  /** Removes sessions logged in the last N minutes (test playing). A backup is made first. */
  handle('dev:clearRecent', async (minutes) => {
    needDev();
    const m = Math.max(1, Math.min(7 * 24 * 60, Number(minutes) || 0));
    await careerBackups.backup('before-clear-test-data');
    const since = Date.now() - m * 60000;
    const n = stats.removeWhere((x) => x.at >= since);
    await stats.flush();
    levels._cache = null;
    return { removed: n };
  });
  /** Erases ALL lifetime statistics. Needs the exact phrase; a backup is always made first. */
  handle('dev:eraseLifetime', async (phrase) => {
    needDev();
    if (phrase !== 'ERASE MY LIFETIME STATS') throw new Error('Type the phrase exactly to erase lifetime statistics');
    const b = await careerBackups.backup('before-erase-lifetime');
    stats.data = { sessions: [] };
    await stats.flush();
    await levels.resetProgression();
    log(`Lifetime statistics erased from the developer menu (backup ${b.id})`);
    return { backup: b.id };
  });
  handle('clips:source', async () => {
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0}});
    const own=win;
    const id=own?.getMediaSourceId();const source=sources.find(s=>s.id===id);
    if(!source)throw Error('Stagehand’s window could not be captured.');
    return source.id;
  });
  handle('clips:prepare',()=>require('./services/video-export').ensureEncoder(tools).then(()=>true));
  // 3.13: no save box: the video goes straight into your recordings as "SH - <song>.mp4"
  // (or "SH - Jam Session.mp4"), never over an older one, and shows backstage (My clips)
  handle('clips:save',async(data,meta={})=>{
    if(!(data instanceof Uint8Array)||data.byteLength>650*1024*1024)throw Error('Clip exceeds the 650 MB limit.');
    const temp=await fsp.mkdtemp(path.join(app.getPath('temp'),'stagehand-video-'));
    const input=path.join(temp,'capture.webm');
    // the sound engine's sound, collected beside the video (4.0.6), joined in by the encoder
    const sound=meta&&meta.audio instanceof Uint8Array&&meta.audio.byteLength>44?path.join(temp,'sound.wav'):null;
    try{
      await fsp.writeFile(input,data);
      if(sound)await fsp.writeFile(sound,meta.audio);
      return await saveClip({input,sound,title:meta&&meta.title,songId:meta&&meta.songId,seconds:meta&&meta.seconds,about:meta&&meta.about});
    }finally{await fsp.rm(temp,{recursive:true,force:true});}
  });
  // 4.0.7: Record clip writes to disk while it records (clip-sessions.js)
  handle('clips:begin',(meta)=>clipSessions.begin(meta));
  handle('clips:chunk',(id,kind,data)=>clipSessions.chunk(id,kind,data));
  handle('clips:finish',async(id,meta={})=>{
    const s=await clipSessions.close(id);
    try{
      if(!s.vbytes)throw Error('Nothing was recorded.');
      return await saveClip({...s,seconds:Number(meta.seconds)||s.seconds});
    }finally{await clipSessions.remove(s.dir);}
  });
  handle('clips:cancel',(id)=>clipSessions.remove(id));
  // 4.0.7: what you were doing, for the note after a crash ("Recording a video of …")
  handle('app:activity',(t)=>{activity=String(t||'').slice(0,200);});
  handle('app:crashNote',()=>{const n=crashNote;crashNote=null;return n;});
  handle('takes:list' , () => takes.list());
  handle('takes:save', (t) => takes.save(t));
  handle('takes:remove', async (id) => {
    const r = await takes.remove(id);
    if (room) await room.setShared(id, false).catch(() => {});
    return r;
  });
  // Backstage (4.3): everyone sees the videos you show there, and can message you.
  // Only videos (never audio takes or songs); the page makes the direct connection (js/friendlink.js).
  const sharedVideo = async (id) => {
    const t = (await takes.list()).find((x) => x.id === String(id));
    return t && t.kind === 'video' && room.isShared(t.id) ? t : null;
  };
  handle('room:get', async () => {
    await room.prune((await takes.list()).filter((t) => t.kind === 'video').map((t) => t.id));
    return room.state();
  });
  handle('room:setName', (name) => room.setName(name));
  handle('room:leave', () => room.leave());
  handle('room:send', (to, text, about) => room.sendMessage(to, text, about));
  handle('room:hide', (addr, on) => room.hide(addr, on));
  handle('room:share', async (id, on) => {
    const t = (await takes.list()).find((x) => x.id === String(id));
    if (on && (!t || t.kind !== 'video')) throw Object.assign(new Error('Only videos can be shown backstage'), { code: 'NOT_VIDEO' });
    return room.setShared(String(id), on);
  });
  handle('room:connect', (addr, sdp) => room.connect(addr, sdp, { onStage: (stage) => send('room:progress', { addr, stage }) }));
  handle('room:answer', (conn, sdp) => room.answer(conn, sdp));
  // what someone watching may see and fetch: the videos you show, with what's in them (the tone too)
  handle('room:hostList', async () => {
    const { clipSummary } = require('./services/greenroom');
    const list = room.joined ? (await takes.list()).filter((t) => t.kind === 'video' && room.isShared(t.id)) : [];
    return { name: room.data.name, recordings: list.map((t) => ({ ...clipSummary(t), name: t.name, seconds: t.seconds, tone: (t.about && t.about.tone) || null })) };
  });
  handle('room:hostRead', async (id, part, offset, length) => {
    const t = await sharedVideo(id);
    if (!t || part !== 'video') throw Object.assign(new Error('That video isn’t shown backstage'), { code: 'NOT_SHARED' });
    const fh = await fsp.open(takes.pathOf(t.id), 'r');
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, Math.min(size, Number(offset) || 0));
      const n = Math.max(0, Math.min(size - start, Number(length) || 0, 4 << 20));
      const bytes = Buffer.alloc(n);
      if (n) await fh.read(bytes, 0, n, start);
      return { size, bytes };
    } finally {
      await fh.close();
    }
  });
  handle('takes:rename', (id, name) => takes.rename(id, name));
  // 4.1.4: updates: check, download (with progress), install (Setup /update closes and reopens Stagehand)
  handle('updates:state', () => (updates ? updates.state() : null));
  handle('updates:check', () => updates.check());
  handle('updates:download', async () => {
    let last = 0;
    const file = await updates.download((p, got, total) => {
      if (p - last < 0.01 && p < 1) return;
      last = p;
      send('updates:progress', { p, got, total });
    });
    return { ready: true, file: path.basename(file) };
  });
  handle('updates:install', async () => {
    const file = await updates.download();
    updates.install(file);
    // Setup waits for Stagehand to close; close now (it opens the new version afterwards)
    setTimeout(() => app.quit(), 700);
    return true;
  });
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, dirs: D, models: MODELS }));
  handle('app:log', () => logLines.slice(-200));
  handle('win:fullscreen', (on) => {
    if (win && !win.isDestroyed()) win.setFullScreen(!!on);
    return !!(win && win.isFullScreen());
  });
  handle('win:titlebar', () => null); // the overlay is gone (4.5); kept so old callers don't fail
  handle('win:minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });
  handle('win:maximize', () => {
    if (!win || win.isDestroyed()) return false;
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  handle('win:close', () => { if (win && !win.isDestroyed()) win.close(); });
  handle('win:state', () => (win && !win.isDestroyed() ? { maximized: win.isMaximized(), fullscreen: win.isFullScreen() } : { maximized: false, fullscreen: false }));

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
  // 4.0: song files elsewhere on this PC that aren't in your library yet
  handle('import:scanPC', async () => {
    // where song files actually land: Downloads, and your import folder if you moved it
    let downloads = null;
    try {
      downloads = app.getPath('downloads');
    } catch (_) {}
    const places = [...new Set([downloads, importer.watchDir()].filter(Boolean))];
    const songs = library.snapshot().songs;
    const have = new Set(songs.map((x) => String(x.path || '').toLowerCase()));
    const haveNames = new Set(songs.map((x) => String(x.fileName || path.basename(x.path || '')).toLowerCase()));
    const { findSongs } = require('./services/songfinder');
    const found = await findSongs(places, { have, haveNames });
    return { places, found };
  });
  handle('library:removeSongs', (ids) => {
    library.removeSongs(ids);
    send('library:reset');
  });
  // 3.7: duplicate songs (the same song in several files): find, move extras aside, undo
  const dupes = () => new Dupes({ library, dir: path.join(D.backups, 'Duplicates') });
  handle('dupes:find', (stemIds) => findDuplicates(Object.values(library.data.songs), new Set(Array.isArray(stemIds) ? stemIds : [])));
  handle('dupes:remove', async (pairs) => {
    const r = await dupes().remove(Array.isArray(pairs) ? pairs : []);
    send('library:reset');
    return r;
  });
  handle('dupes:undo', async (id) => {
    const r = await dupes().undo(id);
    send('library:reset');
    return r;
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
    return withFileRead(song.path, () => audio.prepare(song));
  });

  handle('tab:list', (songId) => tabs.list(requireSong(songId)));
  handle('tab:vocals', (songId) => {
    const song = requireSong(songId);
    return withFileRead(song.path, () => tabs.vocals(song));
  });
  handle('tab:load', (songId, arrId) => {
    const song = requireSong(songId);
    return withFileRead(song.path, () => tabs.load(song, arrId ? String(arrId) : null));
  });

  handle('stems:status', (songId) => stems.status(library.get(songId)));
  handle('stems:request', (songIds, opts) => stems.request(songIds, opts || {}));
  handle('stems:prioritize', (songId, opts) => stems.prioritize(songId, opts || {}));
  handle('stems:ahead', (songId) => stems.ahead(songId));
  handle('stems:playing', (on) => stems.setPlaying(on));
  handle('stems:note', (text) => log(`Stems: ${String(text).slice(0, 300)}`));
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

  // 4.16: the Quest companion (Settings › Quest)
  handle('companion:status', () => companion.status());
  handle('companion:setOn', (on) => companion.setOn(!!on));
  handle('companion:forget', (id) => companion.forget(String(id || '')));
  handle('companion:newCode', () => companion.newCode());
  ipcMain.on('companion:state', (_e, st) => companion && companion.pushState(st));
  ipcMain.on('companion:chart', (_e, ch) => companion && companion.pushChart(ch));

  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => {
    const before = settings.get().stems.model;
    const s = settings.set(patch || {});
    if (patch && patch.engine && 'python' in patch.engine) tools._engineStatus = null;
    if (patch && patch.stems && 'device' in patch.stems) send('engine:changed');
    if (s.stems.model !== before) send('stems:model', s.stems.model);
    return s;
  });

  handle('dlc:scan', async () => {
    if (dlcImporter?.busy) throw new Error('An import operation is already running.');
    let dir = settings.get().rocksmith.gameDir;
    const valid = async (folder) => {
      if (!folder) return false;
      try { const archive = await Psarc.open(path.join(folder, 'songs.psarc')); await archive.close(); return true; } catch (_) { return false; }
    };
    if (!await valid(dir)) {
      const r = await dialog.showOpenDialog(win, { title: 'Select Rocksmith installation folder (contains songs.psarc)', properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths.length) return null;
      dir = r.filePaths[0];
      if (!await valid(dir)) throw new Error('Select the Rocksmith folder containing a valid songs.psarc.');
      settings.set({ rocksmith: { gameDir: dir } });
    }
    if (!dlcImporter) {
      const { DlcImporter } = require('./services/dlc-importer');
      dlcImporter = new DlcImporter({ library, audio, tabs, cacheFile: path.join(D.local, 'dlc-audio-index.json'),
        onProgress: (p) => send('dlc:progress', p) });
    }
    return dlcImporter.scan(dir);
  });
  handle('dlc:import', (ids) => dlcImporter?.importSelected(ids));
  handle('dlc:cancel', () => { dlcImporter?.cancel(); return true; });

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
    // 4.11: songs whose audio wasn't found get another look now that the folder is known
    try {
      await finder.reset();
      const again = library.forgetAudioSearch();
      if (again.length) send('library:songs', again.map(withStems));
      finder.index().catch((err) => log(`Audio search: ${err.message}`));
      log(`Rocksmith folder set to ${d}; ${again.length} song(s) will look for their audio again`);
    } catch (err) {
      log(`Audio search reset failed: ${err.message}`);
    }
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
  // 4.12: the song finder (finder.js): CustomsForge in a Stagehand window that types the wanted
  // song into its search box when you press Find, and takes what you download into your library
  handle('finder:open', (item) => {
    if (!songFinder) {
      const { createFinder } = require('./services/finder');
      const testSite = process.env.STAGEHAND_FINDER_URL || null; // (tests: a pretend site)
      songFinder = createFinder({
        parent: () => win,
        icon: ICON,
        stagingDir: D.staging,
        downloadsDir: () => process.env.STAGEHAND_DOWNLOADS || app.getPath('downloads'),
        importFiles: (paths) => importer.importFiles(paths, { origin: 'finder' }),
        onEvent: (e) => send('finder:event', e),
        openExternal: (u) => !process.env.STAGEHAND_NO_EXTERNAL && shell.openExternal(u),
        clipboard,
        log,
        home: testSite || undefined,
        extraHosts: testSite ? [new URL(testSite).host] : [],
      });
    }
    return songFinder.open(item || null);
  });
  handle('finder:close', () => songFinder && songFinder.close());
  handle('discover:customsforge', (opts = {}) => {
    // In your own browser: Stagehand copies the search and opens the site. (4.12: the song
    // finder, above, is the usual way; it never reads the site or downloads by itself either.)
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
    // 3.13: a dropped folder brings in every song inside it (and its folders, a few levels down)
    const out = [];
    const walk = async (p, depth) => {
      let st;
      try {
        st = await fsp.stat(p);
      } catch (_) {
        return;
      }
      if (st.isDirectory()) {
        if (depth > 4 || out.length > 5000) return;
        let names = [];
        try {
          names = await fsp.readdir(p);
        } catch (_) {
          return;
        }
        for (const n of names) if (!n.startsWith('.')) await walk(path.join(p, n), depth + 1);
      } else if (/\.(psarc|zip)$/i.test(p)) out.push(p);
    };
    for (const f of files) await walk(f, 0);
    if (!out.length) return [];
    return importer.importFiles(out, { origin: Array.isArray(paths) ? 'drop' : 'manual' });
  });
  handle('import:waiting', (paths) => importer.importWaiting(Array.isArray(paths) ? paths.map(String) : null));
  handle('import:undo', (id) => importer.undo(String(id)));
  handle('import:retryLists', () => importer.flushLists());
  handle('import:clearHistory', () => importer.clearHistory());
  // 4.1.2 Getting started: ready for songs in one go. Without Rocksmith (or a folder
  // already chosen), new songs had nowhere to go: make "Stagehand Songs" in Music, use
  // it as a library folder and as where new songs go, and watch Downloads.
  handle('guide:readySongs', async () => {
    let made = null;
    if (!(await importer.target())) {
      let base;
      try { base = app.getPath('music'); } catch (_) { base = app.getPath('documents'); }
      made = path.join(base, 'Stagehand Songs');
      await fsp.mkdir(made, { recursive: true });
      await library.addFolder(made);
      await importer.configure({ target: made });
    }
    const st = await importer.configure({ watch: true });
    return { ...st, made };
  });
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
    else if (which === 'stems') await stems.clearAll();
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
  finder = new AudioFinder({
    cacheFile: path.join(D.local, 'Cache', 'audio-index.json'),
    gameDir: () => (rsprofiles ? rsprofiles.gameDir() : null),
    folders: () => library.data.folders.map((f) => f.path),
    log,
    // 4.11: the first look through a big Rocksmith folder takes a moment: say how far it is
    onProgress: (p) => (p.done === p.total || p.done % 8 === 1) && send('audio:search', { state: 'indexing', done: p.done, total: p.total }),
  });
  audio = new AudioService({ cacheDir: D.audio, tools, library, settings, finder, onSong: (s) => send('library:songs', [withStems(s)]), onSearch: (p) => send('audio:search', { state: p.state, songId: p.song.id }), log });
  stems = new StemService({ stemsDir: D.stems, audio, tools, settings, library, engineScript: ENGINE_SCRIPT, log });
  await stems.startup();
  art = new ArtService({ cacheDir: D.art });
  tabs = new TabService({ log });
  rigAudio = new RigAudio({ log, appRoot: path.join(__dirname, '..', '..') });
  toneStore = new ToneStore(path.join(D.roaming, 'tones.json'));
  await toneStore.load();
  toneIndex = new ToneIndex({ file: path.join(D.local, 'Cache', 'tone-index.json'), log });
  // 4.5: a backup of your career files once a day, before anything reads (or migrates) them
  careerBackups = new CareerBackups({ dataDir: D.roaming, dir: path.join(D.local, 'Backups', 'Career'), version: app.getVersion(), log });
  await careerBackups.auto().catch((e) => log(`Career backup failed: ${e.message}`));
  stats = new Stats(path.join(D.roaming, 'stats.json'), { backups: careerBackups, log });
  await stats.load();
  if (stats.recovered) log(`Your practice history couldn’t be read and was ${stats.recovered.from ? `recovered from the backup ${stats.recovered.from}` : 'started fresh'}; the damaged file is kept as ${path.basename(stats.recovered.corrupt)}`);
  // 4.4: points and levels, worked out from your playing, what you've tried and new songs
  levels = new Levels({
    file: path.join(D.roaming, 'levels.json'),
    sessions: () => stats.data.sessions,
    added: () => Object.values((library.data && library.data.songs) || {}).map((s) => s.addedAt).filter(Number.isFinite),
    songs: () => (library.data && library.data.songs) || {}, // for artists and the song of the week
    backups: careerBackups,
    log,
  });
  await levels.load().catch((e) => log(`Levels failed to load: ${e.message}`));
  takes = new Takes(D.takes);
  clipSessions = new ClipSessions({ tempRoot: app.getPath('temp') });
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
  // Chromium's network stack first: it uses Windows' proxy settings (work and school networks); Node's as a fallback
  room = new GreenRoom({
    file: path.join(D.roaming, 'greenroom.json'),
    oldFile: path.join(D.roaming, 'friends.json'), // 4.1–4.2: only the name it had is offered
    level: () => levels.state().level,
    fetchImpl: (url, opts) => net.fetch(url, opts).catch((err) => (opts && opts.signal && opts.signal.aborted ? Promise.reject(err) : fetch(url, opts))),
    listClips: async () => (await takes.list()).filter((t) => t.kind === 'video'),
    safeStorage,
    log,
  });
  await room.load().catch((e) => log(`Backstage failed to load: ${e.message}`));
  room.on('change', (st) => send('room:change', st));
  room.on('offer', (o) => send('room:offer', o));
  room.on('message', (m) => send('room:message', m));
  // 4.1.4: updates from GitHub releases: checked a little after start and every 6 hours
  const { Updates } = require('./services/updates');
  // (tests only: STAGEHAND_UPDATES_API points at a pretend GitHub; STAGEHAND_UPDATES_MARK records the Setup run instead of running it)
  const testApi = process.env.STAGEHAND_UPDATES_API;
  const testMark = process.env.STAGEHAND_UPDATES_MARK;
  updates = new Updates({
    current: app.getVersion(),
    dir: path.join(D.local, 'Updates'),
    fetchImpl: (url, opts) => {
      const u = testApi ? url.replace('https://api.github.com', testApi) : url;
      return net.fetch(u, opts).catch(() => fetch(u, opts));
    },
    log,
    ...(testMark ? { platform: 'win32', spawnImpl: (file, args) => (fs.writeFileSync(testMark, JSON.stringify({ file, args })), { unref() {} }) } : {}),
  });
  updates.on('change', (st) => send('updates:change', st));
  const autoCheck = () => settings.get().updates.check !== false && updates.check().then(() => updates.tidy());
  setTimeout(autoCheck, 8000);
  setInterval(autoCheck, 6 * 3600 * 1000).unref();
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
  library.on('scan', (p) => {
    send('scan:progress', p);
    // 4.0.3: songs without their own audio (paid DLC): get the audio search ready in the background
    if (p.state === 'done' && Object.values(library.data.songs).some((s) => !s.audioEntry && !s.audioFrom)) {
      setTimeout(() => finder.index().catch((err) => log(`Audio search: ${err.message}`)), 3000);
    }
  });
  stems.on('update', (p) => send('stems:update', p));
  stems.on('done', (p) => send('stems:done', p));

  protocol.handle('stagehand', (req) =>
    serve(req).catch((err) => {
      log(`protocol error ${req.url}: ${err.message}`);
      return new Response('Error', { status: 500 });
    })
  );
  // 4.16: the Quest companion; listens on the network only if you switched it on
  companion = new Companion({
    dir: path.join(D.roaming, 'Quest'),
    settings,
    library: { songs: () => Object.values(library.data.songs || {}), get: (id) => library.get(id) },
    staticDir: path.join(__dirname, '..', 'companion'),
    rendererDir: RENDERER,
    artFile: (song, size) => art.file(song, size),
    version: app.getVersion(),
    log,
  });
  companion.on('status', (st) => send('companion:status', st));
  companion.on('cmd', (c) => send('companion:cmd', c));
  companion.startup();
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
    if (companion) companion.stop().catch(() => {});
    importer.stop();
    discover.cancelGaps();
    stems.stopAll();
    await Promise.all([room ? room.close() : null, library.save(), settings.save(), discover.save(), importer.save(), toneStore.flush(), stats.flush(), toneIndex ? toneIndex.flush() : null]);
  } catch (_) {}
  app.quit();
});

app.on('window-all-closed', () => app.quit());
