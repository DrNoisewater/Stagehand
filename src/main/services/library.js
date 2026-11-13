'use strict';
/**
 * The song library: watched folders, scanned PSARC files, per-song user data
 * (favorites, ratings, play counts) and setlists. Persisted as JSON.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Psarc } = require('../core/psarc');
const rocksmith = require('../core/rocksmith');
const { readJson, writeJsonAtomic } = require('../core/files');

const AUDIO_REV = 3; // bump to re-read files that had no song audio found (2: 4.0.3 keeps the bank's name; 3: 4.11 keeps the manifest's bank and event names, and forgets old "no audio" results)
const IS_WIN = process.platform === 'win32';
const norm = (p) => {
  const r = path.resolve(p);
  return IS_WIN ? r.toLowerCase() : r;
};
const songId = (filePath, key) => crypto.createHash('sha1').update(norm(filePath) + '|' + key).digest('hex').slice(0, 16);
const isTemp = (name) => name.startsWith('.') || name.includes('.stagehand-tmp');

async function walk(dir, found, depth = 0) {
  if (depth > 12) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && e.name !== '$RECYCLE.BIN') await walk(p, found, depth + 1);
    } else if (/\.psarc$/i.test(e.name) && !isTemp(e.name)) {
      found.set(norm(p), p);
    }
  }
}

function within(file, folder) {
  const f = norm(file);
  const d = norm(folder);
  return f === d || f.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
}

class Library extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.data = { version: 1, folders: [], files: {}, songs: {}, setlists: [], orphans: {} };
    this.scanning = false;
    this.rescanQueued = false;
    this._saveTimer = null;
    this._watchers = new Map();
    this._watchTimer = null;
    this.paused = new Set(); // files being written by us
  }

  async load() {
    const d = await readJson(this.file, null);
    if (d && d.version === 1) this.data = { ...this.data, ...d };
    this.data.orphans = this.data.orphans || {};
    return this;
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save().catch((e) => this.emit('log', `Library save failed: ${e.message}`)), 400);
  }

  async save() {
    clearTimeout(this._saveTimer);
    await writeJsonAtomic(this.file, this.data);
  }

  snapshot() {
    return {
      folders: this.data.folders.map((f) => ({ ...f, exists: fs.existsSync(f.path) })),
      songs: Object.values(this.data.songs),
      setlists: this.data.setlists,
      unreadable: Object.values(this.data.files)
        .filter((f) => f.error)
        .map((f) => ({ path: f.path, error: f.error })),
    };
  }

  get(id) {
    return this.data.songs[id] || null;
  }

  songsInFile(filePath) {
    const rec = this.data.files[norm(filePath)];
    return rec ? rec.songIds.map((id) => this.data.songs[id]).filter(Boolean) : [];
  }

  // ------------------------------------------------------------ folders --
  async addFolder(folder) {
    const p = path.resolve(folder);
    if (!this.data.folders.some((f) => norm(f.path) === norm(p))) {
      this.data.folders.push({ path: p, addedAt: Date.now() });
      this.saveSoon();
      this.watch();
    }
    return this.scan();
  }

  async removeFolder(folder) {
    this.data.folders = this.data.folders.filter((f) => norm(f.path) !== norm(folder));
    for (const [np, rec] of Object.entries(this.data.files)) {
      if (!this.data.folders.some((f) => within(rec.path, f.path))) this._dropFile(np, false);
    }
    this.saveSoon();
    this.watch();
    this.emit('reset');
  }

  // ------------------------------------------------------------ scanning --
  async scan({ full = false } = {}) {
    if (this.scanning) {
      this.rescanQueued = true;
      return;
    }
    this.scanning = true;
    const started = Date.now();
    this.emit('scan', { state: 'start', done: 0, total: 0 });
    try {
      const found = new Map();
      for (const f of this.data.folders) await walk(f.path, found);

      for (const [np, rec] of Object.entries(this.data.files)) {
        if (!found.has(np)) this._dropFile(np, true);
      }

      const todo = [];
      for (const [np, p] of found) {
        let st;
        try {
          st = await fsp.stat(p);
        } catch (_) {
          continue;
        }
        const rec = this.data.files[np];
        if (full || !rec || rec.size !== st.size || rec.mtimeMs !== st.mtimeMs) todo.push({ np, p, st });
        // 4.0.2: files read before Stagehand could find audio stored differently get one more look
        // 4.0.4: files with no creator stamp read before Stagehand noted the custom-song signs
        else if ((rec.songIds || []).some((id) => { const x = this.data.songs[id]; return x && x.appId === undefined && !x.toolkit && !x.author && !x.packageVersion; })) todo.push({ np, p, st });
        else if ((rec.audioRev || 0) < AUDIO_REV && (rec.songIds || []).some((id) => this.data.songs[id] && !this.data.songs[id].audioEntry)) todo.push({ np, p, st });
      }

      let done = 0;
      let lastEmit = 0;
      const changedIds = new Set();
      const worker = async () => {
        while (todo.length) {
          const job = todo.shift();
          if (this.paused.has(job.np)) continue;
          const ids = await this._ingest(job.p, job.st);
          ids.forEach((id) => changedIds.add(id));
          done++;
          if (Date.now() - lastEmit > 120) {
            lastEmit = Date.now();
            this.emit('scan', { state: 'progress', done, total: done + todo.length, file: path.basename(job.p) });
          }
        }
      };
      const total = todo.length;
      await Promise.all(Array.from({ length: Math.min(4, total || 1) }, worker));
      if (total || changedIds.size) this.saveSoon();
      this.emit('scan', { state: 'done', done: total, total, ms: Date.now() - started });
      this.emit('reset');
    } finally {
      this.scanning = false;
      if (this.rescanQueued) {
        this.rescanQueued = false;
        setTimeout(() => this.scan(), 50);
      }
    }
  }

  _dropFile(np, keepUserData) {
    const rec = this.data.files[np];
    if (!rec) return;
    for (const id of rec.songIds || []) {
      const s = this.data.songs[id];
      if (s?.dlcImport) continue; // Explicit imports are independent of watched-folder membership.
      if (s && keepUserData && (s.user || s.audioKey)) {
        this.data.orphans[`${s.songKey}|${s.fileSize}`] = { id, user: s.user, addedAt: s.addedAt, audioKey: s.audioKey, at: Date.now() };
      }
      delete this.data.songs[id];
      if (!keepUserData) {
        for (const sl of this.data.setlists) sl.songIds = sl.songIds.filter((x) => x !== id);
      }
    }
    delete this.data.files[np];
  }

  async _ingest(filePath, st, { keepAudio = false } = {}) {
    const np = norm(filePath);
    let parsed = [];
    let error = null;
    let psarc = null;
    try {
      psarc = await Psarc.open(filePath);
      parsed = await rocksmith.readSongs(psarc);
    } catch (err) {
      error = err.message;
    } finally {
      if (psarc) await psarc.close().catch(() => {});
    }
    const old = this.data.files[np];
    const oldIds = new Set(old ? old.songIds : []);
    const ids = [];
    for (const meta of parsed) {
      const imported = Object.values(this.data.songs).find((s) => s.dlcImport && String(s.songKey).toLowerCase() === String(meta.songKey).toLowerCase());
      const id = imported?.id || songId(filePath, meta.songKey);
      const prev = this.data.songs[id];
      const orphanKey = `${meta.songKey}|${st.size}`;
      const orphan = !prev && this.data.orphans[orphanKey];
      if (orphan) {
        delete this.data.orphans[orphanKey];
        // A moved file keeps its place in setlists.
        for (const sl of this.data.setlists) sl.songIds = sl.songIds.map((x) => (x === orphan.id ? id : x));
      }
      const rec = {
        id,
        path: filePath,
        fileName: path.basename(filePath),
        fileSize: st.size,
        mtimeMs: st.mtimeMs,
        multi: parsed.length,
        ...meta,
        addedAt: prev ? prev.addedAt : orphan ? orphan.addedAt : Math.round(st.birthtimeMs || st.mtimeMs || Date.now()),
        user: prev ? prev.user : orphan ? orphan.user : undefined,
        audioKey: prev && prev.audioEntry === meta.audioEntry && (keepAudio || prev.fileSize === st.size) ? prev.audioKey : orphan ? orphan.audioKey : undefined,
        // 4.0.3: where the audio was found when the file has none (kept until the file gets its own)
        audioFrom: !meta.audioEntry && prev && prev.audioFrom ? prev.audioFrom : undefined,
      };
      this.data.songs[id] = prev?.dlcImport ? prev : rec;
      ids.push(id);
      oldIds.delete(id);
    }
    for (const id of oldIds) if (!this.data.songs[id]?.dlcImport) delete this.data.songs[id];
    this.data.files[np] = { path: filePath, size: st.size, mtimeMs: st.mtimeMs, songIds: ids, error: error || (parsed.length ? null : undefined), audioRev: AUDIO_REV };
    if (error) this.emit('log', `Could not read ${filePath}: ${error}`);
    return ids;
  }

  /** Re-reads one file after we changed it; returns the fresh song records. */
  async refreshFile(filePath, opts = {}) {
    const st = await fsp.stat(filePath);
    const ids = await this._ingest(filePath, st, opts);
    this.saveSoon();
    return ids.map((id) => this.data.songs[id]);
  }

  /** Moves a file record after a rename; keeps ids and user data. */
  renameFile(from, to) {
    const npFrom = norm(from);
    const rec = this.data.files[npFrom];
    if (!rec) return;
    delete this.data.files[npFrom];
    rec.path = to;
    this.data.files[norm(to)] = rec;
    for (const id of rec.songIds) {
      const s = this.data.songs[id];
      if (s) {
        s.path = to;
        s.fileName = path.basename(to);
      }
    }
    this.saveSoon();
  }

  /**
   * A newer version of a song replaced an older file: keep the player's
   * favorites, ratings, play counts and setlist places on the new record.
   */
  carryOver(oldSongs, newSongs) {
    const byKey = new Map(newSongs.map((s) => [String(s.songKey || '').toLowerCase(), s]));
    for (const old of oldSongs) {
      const n = byKey.get(String(old.songKey || '').toLowerCase());
      if (!n || n.id === old.id) continue;
      if (old.user) n.user = { ...old.user, ...(n.user || {}) };
      if (old.addedAt) n.addedAt = old.addedAt;
      n.updatedAt = Date.now();
      for (const sl of this.data.setlists) sl.songIds = sl.songIds.map((x) => (x === old.id ? n.id : x));
    }
    this.saveSoon();
  }

  /** Drops a file's records without keeping them as orphans (it was replaced on purpose). */
  forgetFile(filePath) {
    const np = norm(filePath);
    const rec = this.data.files[np];
    if (!rec) return;
    for (const id of rec.songIds || []) delete this.data.songs[id];
    delete this.data.files[np];
    this.saveSoon();
  }

  /** The library folder a path is in, if any. */
  folderOf(filePath) {
    const f = this.data.folders.find((x) => within(filePath, x.path));
    return f ? f.path : null;
  }

  removeSongs(ids) {
    const files = new Set(ids.map((id) => this.data.songs[id]).filter(Boolean).map((s) => norm(s.path)));
    for (const np of files) {
      const rec = this.data.files[np];
      if (rec) {
        rec.songIds = rec.songIds.filter((id) => !ids.includes(id));
        rec.ignored = true;
      }
    }
    for (const id of ids) delete this.data.songs[id];
    this.saveSoon();
  }

  // ---------------------------------------------------------- user data --
  setUser(id, patch) {
    const s = this.data.songs[id];
    if (!s) return null;
    s.user = { ...(s.user || {}), ...patch };
    this.saveSoon();
    return s;
  }

  markPlayed(id) {
    const s = this.data.songs[id];
    if (!s) return null;
    const u = s.user || {};
    return this.setUser(id, { plays: (u.plays || 0) + 1, lastPlayed: Date.now() });
  }

  /** 4.0.3: remembers which other file holds this song's audio. */
  setAudioFrom(id, from) {
    const s = this.data.songs[id];
    if (!s) return null;
    s.audioFrom = from || undefined;
    if (from) s.audioFail = undefined;
    this.saveSoon();
    return s;
  }

  /** 4.11: why a song's audio couldn't be found last time ({ code, message }); cleared when it is found or looked for afresh. */
  setAudioFail(id, fail) {
    const s = this.data.songs[id];
    if (!s) return null;
    s.audioFail = fail ? { code: String(fail.code || ''), message: String(fail.message || '').slice(0, 400), at: Date.now() } : undefined;
    this.saveSoon();
    return s;
  }

  /** Forget every "audio not found" (and where audio was found): the Rocksmith folder changed. Returns the songs touched. */
  forgetAudioSearch() {
    const out = [];
    for (const s of Object.values(this.data.songs)) {
      if (!s.audioFail && !s.audioFrom) continue;
      s.audioFail = undefined;
      s.audioFrom = undefined;
      out.push(s);
    }
    if (out.length) this.saveSoon();
    return out;
  }

  setAudioKey(id, key) {
    const s = this.data.songs[id];
    if (s && s.audioKey !== key) {
      s.audioKey = key;
      this.saveSoon();
    }
  }

  // ----------------------------------------------------------- setlists --
  createSetlist(name) {
    const sl = { id: crypto.randomBytes(6).toString('hex'), name: String(name || 'New setlist').slice(0, 80), songIds: [], createdAt: Date.now() };
    this.data.setlists.push(sl);
    this.saveSoon();
    return sl;
  }

  renameSetlist(id, name) {
    const sl = this.data.setlists.find((x) => x.id === id);
    if (sl) sl.name = String(name).slice(0, 80);
    this.saveSoon();
    return sl;
  }

  deleteSetlist(id) {
    this.data.setlists = this.data.setlists.filter((x) => x.id !== id);
    this.saveSoon();
  }

  addToSetlist(id, songIds) {
    const sl = this.data.setlists.find((x) => x.id === id);
    if (!sl) return null;
    for (const s of songIds) if (!sl.songIds.includes(s)) sl.songIds.push(s);
    this.saveSoon();
    return sl;
  }

  removeFromSetlist(id, songIds) {
    const sl = this.data.setlists.find((x) => x.id === id);
    if (!sl) return null;
    sl.songIds = sl.songIds.filter((s) => !songIds.includes(s));
    this.saveSoon();
    return sl;
  }

  reorderSetlist(id, songIds) {
    const sl = this.data.setlists.find((x) => x.id === id);
    if (!sl) return null;
    const set = new Set(sl.songIds);
    sl.songIds = songIds.filter((s) => set.has(s));
    this.saveSoon();
    return sl;
  }

  // ------------------------------------------------------------- watching --
  watch() {
    for (const [p, w] of this._watchers) {
      if (!this.data.folders.some((f) => norm(f.path) === p)) {
        w.close();
        this._watchers.delete(p);
      }
    }
    for (const f of this.data.folders) {
      const key = norm(f.path);
      if (this._watchers.has(key) || !fs.existsSync(f.path)) continue;
      try {
        const w = fs.watch(f.path, { recursive: true }, (_evt, name) => {
          if (!name || !/\.psarc$/i.test(name) || isTemp(path.basename(String(name)))) return;
          clearTimeout(this._watchTimer);
          this._watchTimer = setTimeout(() => this.scan(), 1500);
        });
        w.on('error', () => {});
        this._watchers.set(key, w);
      } catch (_) {
        /* recursive watch unsupported: manual rescan only */
      }
    }
  }

  close() {
    for (const w of this._watchers.values()) w.close();
    this._watchers.clear();
  }
}

module.exports = { Library, songId, norm };
