'use strict';
/**
 * Imports downloaded songs: watches a folder (usually Downloads) for new
 * .psarc files or ZIPs of them, checks each one is a readable PC song,
 * moves it into Rocksmith's dlc folder (replacing an older version of the
 * same song, kept in Backups), ticks it off the Wanted list and, if asked,
 * adds it to an in-game song list.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Psarc } = require('../core/psarc');
const rocksmith = require('../core/rocksmith');
const { zipList, zipExtract, sha1File, moveFile, readJson, writeJsonAtomic } = require('../core/files');
const { norm } = require('./library');

const SONG_RE = /\.psarc$/i;
const ZIP_RE = /\.zip$/i;
const PARTIAL_RE = /\.(crdownload|part|partial|download|tmp|opdownload)$/i;
const HISTORY_MAX = 300;
const SEEN_MAX = 800;
const POLL_MS = 15000;
const STABLE_MS = Number(process.env.STAGEHAND_IMPORT_STABLE_MS) || 1200;
const GIVE_UP_MS = 10 * 60 * 1000;
const LIST_RETRY_MS = 45000;

const exists = (p) => fsp.access(p).then(() => true, () => false);
// Watching only ever looks at .psarc files; ZIPs are imported only when picked or dropped.
const isCandidate = (name) => SONG_RE.test(name) && !PARTIAL_RE.test(name) && !name.startsWith('.') && !name.includes('.stagehand-tmp');
const fingerprint = (p, st) => `${norm(p)}|${st.size}|${Math.round(st.mtimeMs)}`;
const newId = () => crypto.randomBytes(5).toString('hex');

/** "Song_p (1).psarc" (a browser's second download) -> "Song_p.psarc". */
function cleanName(name) {
  return name.replace(/\s\(\d+\)(?=\.psarc$)/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

class Importer extends EventEmitter {
  constructor({ file, settings, library, discover, rsprofiles, stagingDir, replacedDir, defaultWatchDir, trash, log = () => {} }) {
    super();
    this.file = file;
    this.settings = settings;
    this.library = library;
    this.discover = discover;
    this.rsprofiles = rsprofiles;
    this.stagingDir = stagingDir;
    this.replacedDir = replacedDir;
    this.defaultWatchDir = defaultWatchDir;
    this.trash = trash || ((p) => fsp.unlink(p));
    this.log = log;
    this.data = { history: [], pending: [], seen: {} };
    this.watcher = null;
    this.pollTimer = null;
    this.listTimer = null;
    this.inflight = new Set();
    this.chain = Promise.resolve();
    this.busy = 0;
    this._saveTimer = null;
    this._timers = new Map();
  }

  // -------------------------------------------------------------- storage --
  async load() {
    const d = await readJson(this.file, null);
    if (d) this.data = { ...this.data, ...d };
    return this;
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save().catch(() => {}), 300);
  }

  async save() {
    clearTimeout(this._saveTimer);
    await writeJsonAtomic(this.file, this.data);
  }

  cfg() {
    return this.settings.get().import;
  }

  watchDir() {
    return this.cfg().watchDir || this.defaultWatchDir;
  }

  /** Where new songs go: the chosen folder, else Rocksmith's dlc folder, else the first library folder. */
  async target() {
    const custom = this.cfg().target;
    if (custom && (await exists(custom))) return { path: custom, auto: false };
    const game = await this.rsprofiles.gameDir().catch(() => null);
    if (game) {
      const dlc = path.join(game, 'dlc');
      if (await exists(dlc)) return { path: dlc, auto: true, game: true };
    }
    for (const f of this.library.data.folders) if (await exists(f.path)) return { path: f.path, auto: true };
    return null;
  }

  async status() {
    const cfg = this.cfg();
    return {
      watch: !!cfg.watch,
      watching: !!this.watcher || (!!cfg.watch && !!this.pollTimer),
      watchDir: this.watchDir(),
      watchDirExists: await exists(this.watchDir() || ''),
      target: await this.target(),
      list: cfg.list,
      replace: cfg.replace !== false,
      keepOriginal: !!cfg.keepOriginal,
      history: this.data.history.slice(0, 150),
      pending: this.data.pending.map((p) => ({ list: p.list, count: p.keys.length, at: p.at, state: p.state || 'queued', error: p.error || null })),
      busy: this.busy,
      waiting: await this._waitingCached(),
    };
  }

  /** Listing a big Downloads folder on every progress update would be wasteful. */
  async _waitingCached() {
    const c = this._waitingMemo;
    if (c && Date.now() - c.at < 4000 && !this.busy) return c.value;
    const value = await this.waiting();
    this._waitingMemo = { at: Date.now(), value };
    return value;
  }

  emitUpdate() {
    clearTimeout(this._updTimer);
    this._updTimer = setTimeout(() => this.status().then((s) => this.emit('update', s)).catch(() => {}), 60);
  }

  // ------------------------------------------------------------- watching --
  async start() {
    this.stop();
    const cfg = this.cfg();
    if (this.data.pending.length) this._flushSoon(3000);
    if (!cfg.watch) return;
    const dir = this.watchDir();
    if (!dir || !(await exists(dir))) {
      this.log(`Import: folder to watch is missing (${dir})`);
      return;
    }
    try {
      this.watcher = fs.watch(dir, { recursive: false }, (_evt, name) => {
        if (!name || !isCandidate(String(name))) return;
        this._schedule(path.join(dir, String(name)));
      });
      this.watcher.on('error', () => {});
    } catch (err) {
      this.log(`Import: could not watch ${dir}: ${err.message}`);
    }
    // Catch up on anything that arrived while Stagehand was closed, then poll as a safety net.
    const poll = () => this._poll().catch((e) => this.log(`Import poll failed: ${e.message}`));
    poll();
    this.pollTimer = setInterval(poll, POLL_MS);
  }

  stop() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  _schedule(file) {
    clearTimeout(this._timers.get(file));
    this._timers.set(
      file,
      setTimeout(() => {
        this._timers.delete(file);
        this._consider(file, 'download').catch((e) => this.log(`Import failed for ${file}: ${e.message}`));
      }, 700)
    );
  }

  async _listDir(dir) {
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch (_) {
      return [];
    }
    const out = [];
    for (const name of names.filter(isCandidate)) {
      const p = path.join(dir, name);
      try {
        const st = await fsp.stat(p);
        if (st.isFile()) out.push({ path: p, name, size: st.size, mtimeMs: st.mtimeMs, newest: Math.max(st.mtimeMs, st.birthtimeMs || 0), fp: fingerprint(p, st) });
      } catch (_) {}
    }
    return out;
  }

  async _poll() {
    const since = this.cfg().since || 0;
    for (const f of await this._listDir(this.watchDir())) {
      if (f.newest >= since && !this.data.seen[f.fp] && !this.inflight.has(norm(f.path))) this._consider(f.path, 'download').catch(() => {});
    }
  }

  /** Song files already sitting in the watched folder that were never imported. */
  async waiting() {
    const cfg = this.cfg();
    const since = cfg.watch ? cfg.since || 0 : Infinity;
    const out = [];
    for (const f of await this._listDir(this.watchDir())) {
      if (this.data.seen[f.fp] || this.inflight.has(norm(f.path))) continue;
      if (f.newest >= since) continue; // the watcher will take it
      out.push({ path: f.path, name: f.name, size: f.size, mtimeMs: f.mtimeMs });
      if (out.length >= 300) break;
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  /** Waits until a download has finished (size steady, file not locked). */
  async _settled(file) {
    const started = Date.now();
    let prev = null;
    while (Date.now() - started < GIVE_UP_MS) {
      let st;
      try {
        st = await fsp.stat(file);
      } catch (_) {
        return null; // renamed or deleted (e.g. the browser's temp name)
      }
      if (prev && st.size > 0 && st.size === prev.size && st.mtimeMs === prev.mtimeMs) {
        try {
          const fh = await fsp.open(file, 'r+');
          await fh.close();
          return st;
        } catch (err) {
          if (err.code === 'ENOENT') return null;
        }
      }
      prev = st;
      await new Promise((r) => setTimeout(r, STABLE_MS));
    }
    return null;
  }

  async _consider(file, origin) {
    const key = norm(file);
    if (this.inflight.has(key)) return null;
    this.inflight.add(key);
    try {
      const st = await this._settled(file);
      if (!st || this.data.seen[fingerprint(file, st)]) return null;
      return await this._enqueue(file, { move: !this.cfg().keepOriginal, origin });
    } finally {
      this.inflight.delete(key);
    }
  }

  // ------------------------------------------------------------ importing --
  /** Imports files the user picked or dropped. Copies them; the originals stay. */
  importFiles(paths, { origin = 'manual', move = false } = {}) {
    const files = [...new Set(paths.map(String))].filter((p) => SONG_RE.test(p) || ZIP_RE.test(p));
    if (!files.length) throw Object.assign(new Error('Choose .psarc song files, or ZIP files with songs inside.'), { code: 'IMPORT_NONE' });
    return Promise.all(files.map((f) => this._enqueue(f, { move, origin }))).then((r) => r.flat());
  }

  /** Imports the song files already waiting in the watched folder. */
  async importWaiting(paths) {
    const waiting = await this.waiting();
    const pick = paths ? waiting.filter((w) => paths.includes(w.path)) : waiting;
    return this.importFiles(
      pick.map((w) => w.path),
      { origin: 'download', move: !this.cfg().keepOriginal }
    ).catch((e) => (e.code === 'IMPORT_NONE' ? [] : Promise.reject(e)));
  }

  _enqueue(file, opts) {
    this.busy++;
    this.emitUpdate();
    const job = this.chain.then(() => this._process(file, opts));
    this.chain = job.catch(() => {});
    return job.finally(() => {
      this.busy--;
      this.emitUpdate();
    });
  }

  async _process(src, { move, origin }) {
    let st;
    try {
      st = await fsp.stat(src);
    } catch (_) {
      return [];
    }
    const fp = fingerprint(src, st);
    const results = [];
    if (ZIP_RE.test(src)) {
      let entries = null;
      try {
        entries = (await zipList(src)).filter((e) => SONG_RE.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name));
        // A ZIP with both versions: take the PC file and leave the Mac one quietly.
        if (entries.some((e) => !/_m\.psarc$/i.test(e.name))) entries = entries.filter((e) => !/_m\.psarc$/i.test(e.name));
      } catch (err) {
        results.push(this._entry({ src, origin, status: 'rejected', reason: `Couldn’t open this ZIP: ${err.message}` }));
      }
      if (entries && !entries.length) results.push(this._entry({ src, origin, status: 'rejected', reason: 'There are no Rocksmith songs (.psarc files) in this ZIP.' }));
      if (entries && entries.length) {
        const stage = path.join(this.stagingDir, newId());
        try {
          for (const e of entries) {
            const inner = cleanName(path.basename(e.name));
            const out = path.join(stage, inner);
            try {
              await zipExtract(src, e, out);
            } catch (err) {
              results.push(this._entry({ src, inner, origin, status: 'rejected', reason: `Couldn’t unpack ${inner}: ${err.message}` }));
              continue;
            }
            results.push(await this._importSong(out, { move: true, origin, src, inner, staged: true }));
          }
        } finally {
          await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
        }
        const good = results.some((r) => ['imported', 'updated', 'duplicate'].includes(r.status));
        if (move && good && !results.some((r) => r.status === 'error')) {
          await this.trash(src).catch((e) => this.log(`Import: could not remove ${src}: ${e.message}`));
          for (const r of results) r.cleaned = true;
        }
      }
    } else {
      results.push(await this._importSong(src, { move, origin, src }));
    }
    if (!results.some((r) => r.status === 'error')) this.data.seen[fp] = Date.now();
    const seen = Object.entries(this.data.seen);
    if (seen.length > SEEN_MAX) this.data.seen = Object.fromEntries(seen.sort((a, b) => b[1] - a[1]).slice(0, SEEN_MAX));
    this.data.history = [...results, ...this.data.history].slice(0, HISTORY_MAX);
    this._waitingMemo = null;
    this.saveSoon();
    const gameRunning = results.some((r) => r.status === 'imported' || r.status === 'updated') ? await this.rsprofiles.isGameRunning().catch(() => false) : false;
    this.emit('imported', { entries: results, gameRunning });
    this.emitUpdate();
    return results;
  }

  _entry({ src, inner = null, origin, status, reason = '' }) {
    return { id: newId(), at: Date.now(), origin, source: path.basename(src), sourcePath: src, inner, status, reason, dest: null, songs: [], found: [], list: null, replaced: null, moved: false };
  }

  async _importSong(file, { move, origin, src, inner = null, staged = false }) {
    const entry = this._entry({ src, inner, origin, status: 'error' });
    const name = inner || path.basename(file);
    // 1. Is it a readable Rocksmith 2014 song?
    let songs = [];
    let psarc = null;
    try {
      psarc = await Psarc.open(file);
      songs = await rocksmith.readSongs(psarc);
    } catch (err) {
      return Object.assign(entry, { status: 'rejected', reason: 'This isn’t a Rocksmith 2014 song file, or it is damaged.', detail: err.message });
    } finally {
      if (psarc) await psarc.close().catch(() => {});
    }
    if (!songs.length) return Object.assign(entry, { status: 'rejected', reason: 'There are no songs inside this file.' });
    entry.songs = songs.map((s) => ({ songKey: s.songKey, artist: s.artist, title: s.title, album: s.album, year: s.year }));
    const plats = new Set(songs.map((s) => s.platform).filter(Boolean));
    if ((plats.has('mac') && !plats.has('windows')) || (!plats.size && /_m\.psarc$/i.test(name))) {
      return Object.assign(entry, { status: 'rejected', reason: 'This is the Mac version. Download the PC version instead (its file name ends in _p.psarc).' });
    }
    if (plats.size && !plats.has('windows') && !plats.has('mac')) {
      return Object.assign(entry, { status: 'rejected', reason: 'This file is for a console version of Rocksmith, not the PC.' });
    }

    // 2. Already have it, or an older version of it?
    const target = await this.target();
    if (!target) return Object.assign(entry, { reason: 'Stagehand doesn’t know where to put songs yet. Choose a folder under “Put new songs in”.' });
    const keys = new Set(songs.map((s) => String(s.songKey).toLowerCase()));
    const existing = Object.values(this.library.data.songs).filter((s) => keys.has(String(s.songKey || '').toLowerCase()) && s.platform !== 'mac' && !/_m\.psarc$/i.test(s.fileName));
    const size = (await fsp.stat(file)).size;
    const sha = await sha1File(file);
    for (const p of new Set(existing.map((s) => s.path))) {
      const ex = existing.find((s) => s.path === p);
      if (ex.fileSize === size && (await sha1File(p).catch(() => null)) === sha) {
        Object.assign(entry, { status: 'duplicate', reason: 'Already in your library.', dest: p, songs: this.library.songsInFile(p).map(brief) });
        if (move && !staged) {
          await this.trash(file).catch(() => {});
          entry.cleaned = true;
        }
        return entry;
      }
    }
    let replacing = null;
    if (existing.length && this.cfg().replace !== false) {
      const oldPath = existing[0].path;
      const oldSongs = this.library.songsInFile(oldPath);
      if (oldSongs.length && oldSongs.every((s) => keys.has(String(s.songKey).toLowerCase())) && (await exists(oldPath))) {
        replacing = { path: oldPath, songs: oldSongs.map((s) => ({ ...s })) };
      }
    }
    const destDir = replacing ? path.dirname(replacing.path) : target.path;
    const dest = await this._freeName(path.join(destDir, cleanName(name)), replacing && replacing.path);

    // 3. Put it in place: old version aside first, new file under a temp name, check it, then rename.
    const tmp = `${dest}.stagehand-tmp`;
    this.library.paused.add(norm(dest));
    if (replacing) this.library.paused.add(norm(replacing.path));
    try {
      if (replacing) {
        await fsp.mkdir(this.replacedDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backup = path.join(this.replacedDir, `${stamp}_${path.basename(replacing.path)}`);
        await moveFile(replacing.path, backup);
        entry.replaced = { path: replacing.path, backup };
      }
      try {
        if (move) await moveFile(file, tmp);
        else await fsp.copyFile(file, tmp);
        if ((await sha1File(tmp)) !== sha) throw new Error('the copy did not match the download');
        await fsp.rename(tmp, dest);
      } catch (err) {
        if (move && !(await exists(file)) && (await exists(tmp))) await moveFile(tmp, file).catch(() => {});
        await fsp.unlink(tmp).catch(() => {});
        if (entry.replaced) await moveFile(entry.replaced.backup, entry.replaced.path).catch(() => {});
        entry.replaced = null;
        throw err;
      }
    } catch (err) {
      return Object.assign(entry, { status: 'error', reason: `Couldn’t move the song into place: ${err.message}` });
    } finally {
      this.library.paused.delete(norm(dest));
      if (replacing) this.library.paused.delete(norm(replacing.path));
    }
    entry.moved = move && !staged;
    entry.cleaned = move && !staged;
    entry.dest = dest;

    // 4. Into the library (adding the folder if it isn't one yet).
    let fresh;
    if (!this.library.folderOf(dest)) {
      await this.library.addFolder(path.dirname(dest));
      fresh = this.library.songsInFile(dest);
      if (!fresh.length) fresh = await this.library.refreshFile(dest);
    } else {
      fresh = await this.library.refreshFile(dest);
    }
    if (replacing && norm(replacing.path) !== norm(dest)) {
      this.library.carryOver(replacing.songs, fresh);
      this.library.forgetFile(replacing.path);
    }
    entry.status = replacing ? 'updated' : 'imported';
    entry.reason = '';
    entry.songs = fresh.map(brief);
    this.emit('songs', fresh);

    // 5. Tick it off the Wanted list; queue the in-game list.
    for (const s of fresh) entry.found.push(...this.discover.markFound(s).map((w) => w.id));
    const list = this.cfg().list;
    if (list !== null && list !== undefined && list !== '') {
      entry.list = { id: String(list), state: 'queued' };
      this.data.pending.push({ list: String(list), keys: fresh.map((s) => s.songKey), entryId: entry.id, at: Date.now() });
      this._flushSoon(1500);
    }
    return entry;
  }

  async _freeName(dest, allow) {
    if (allow && norm(dest) === norm(allow)) return dest;
    if (!(await exists(dest))) return dest;
    const m = /^(.*?)(_[pm])?(\.psarc)$/i.exec(dest);
    for (let n = 2; n < 1000; n++) {
      const cand = `${m[1]} (${n})${m[2] || ''}${m[3]}`;
      if (!(await exists(cand))) return cand;
    }
    throw new Error('Too many files with that name');
  }

  // --------------------------------------------------- in-game song lists --
  _flushSoon(ms) {
    clearTimeout(this.listTimer);
    this.listTimer = setTimeout(() => this.flushLists().catch(() => {}), ms);
  }

  _setListState(entryId, state, error = null) {
    const e = this.data.history.find((x) => x.id === entryId);
    if (e && e.list) Object.assign(e.list, { state, error });
  }

  /** Adds queued songs to their in-game lists (waits while Rocksmith is open). */
  async flushLists() {
    if (this._flushing || !this.data.pending.length) return { done: !this.data.pending.length };
    this._flushing = true;
    const batch = this.data.pending.slice();
    try {
      const groups = new Map();
      for (const p of batch) groups.set(p.list, [...(groups.get(p.list) || []), ...p.keys]);
      const ops = [...groups].map(([list, keys]) => ({ list: list === 'favorites' ? 'favorites' : Number(list), add: [...new Set(keys)] }));
      try {
        const r = await this.rsprofiles.apply(ops);
        for (const p of batch) this._setListState(p.entryId, 'added');
        this.data.pending = this.data.pending.filter((p) => !batch.includes(p));
        this.emit('lists', r);
        return { done: true, added: r.added };
      } catch (err) {
        if (err.code === 'RS_RUNNING' || err.code === 'RS_LOCKED') {
          for (const p of batch) {
            p.state = 'waiting';
            this._setListState(p.entryId, 'waiting');
          }
          this._flushSoon(LIST_RETRY_MS);
          return { done: false, waiting: true, error: err.message, code: err.code };
        }
        for (const p of batch) this._setListState(p.entryId, 'failed', err.message);
        this.data.pending = this.data.pending.filter((p) => !batch.includes(p));
        return { done: false, error: err.message, code: err.code };
      }
    } finally {
      this._flushing = false;
      this.saveSoon();
      this.emitUpdate();
    }
  }

  // ----------------------------------------------------------------- undo --
  async undo(entryId) {
    const e = this.data.history.find((x) => x.id === entryId);
    if (!e || !['imported', 'updated'].includes(e.status)) throw new Error('That import can’t be undone.');
    if (!e.dest || !(await exists(e.dest))) throw new Error('The imported file is no longer where Stagehand put it.');
    const newSongs = this.library.songsInFile(e.dest).map((s) => ({ ...s }));
    this.library.paused.add(norm(e.dest));
    try {
      if (e.moved && !e.inner && (await exists(path.dirname(e.sourcePath)))) {
        await moveFile(e.dest, await this._freeName(e.sourcePath));
      } else {
        await this.trash(e.dest);
      }
    } finally {
      this.library.paused.delete(norm(e.dest));
    }
    this.library.forgetFile(e.dest);
    if (e.replaced && (await exists(e.replaced.backup))) {
      await moveFile(e.replaced.backup, e.replaced.path);
      const back = await this.library.refreshFile(e.replaced.path);
      this.library.carryOver(newSongs, back);
    }
    // Drop it from the in-game list again if it was brand new.
    this.data.pending = this.data.pending.filter((p) => p.entryId !== e.id);
    if (e.status === 'imported' && e.list && e.list.state === 'added') {
      await this.rsprofiles
        .apply([{ list: e.list.id === 'favorites' ? 'favorites' : Number(e.list.id), remove: e.songs.map((s) => s.songKey) }])
        .then((r) => this.emit('lists', r))
        .catch(() => {});
    }
    this.discover.unmarkFound(e.found);
    e.status = 'undone';
    this._waitingMemo = null;
    this.saveSoon();
    this.emit('songs', []);
    this.emitUpdate();
    return e;
  }

  clearHistory() {
    this.data.history = this.data.history.filter((e) => e.list && ['queued', 'waiting'].includes(e.list.state));
    this.saveSoon();
    this.emitUpdate();
  }

  /** Changes import settings and restarts the watcher. */
  async configure(patch) {
    const prev = this.cfg();
    const next = {};
    if ('watch' in patch) {
      next.watch = !!patch.watch;
      if (next.watch && !prev.watch) next.since = Date.now();
    }
    if ('watchDir' in patch) next.watchDir = patch.watchDir || null;
    if ('target' in patch) next.target = patch.target || null;
    if ('list' in patch) next.list = patch.list === null || patch.list === '' ? null : String(patch.list);
    if ('replace' in patch) next.replace = !!patch.replace;
    if ('keepOriginal' in patch) next.keepOriginal = !!patch.keepOriginal;
    if (next.watchDir && next.watchDir !== prev.watchDir) next.since = Date.now();
    this.settings.set({ import: next });
    this._waitingMemo = null;
    await this.start();
    return this.status();
  }
}

function brief(s) {
  return { id: s.id, songKey: s.songKey, artist: s.artist, title: s.title, album: s.album, year: s.year };
}

module.exports = { Importer, cleanName, isCandidate };
