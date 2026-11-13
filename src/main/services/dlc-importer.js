'use strict';
// Selective, read-only installed-DLC import. Source archives remain in Rocksmith.
const fs = require('fs').promises;
const path = require('path');
const { Psarc } = require('../core/psarc');
const { readSongs } = require('../core/rocksmith');
const { AudioFinder } = require('./audiofind');
const { songId } = require('./library');
const lower = (x) => String(x || '').toLowerCase();
const tick = () => new Promise((r) => setImmediate(r));

async function installedArchives(dir, signal) {
  const out = [path.join(dir, 'songs.psarc')];
  async function walk(folder) {
    signal.throwIfAborted();
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    for (const e of entries) {
      signal.throwIfAborted();
      if (/^originals$/i.test(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(folder, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && /\.psarc$/i.test(e.name) && !/_m\.psarc$/i.test(e.name)) out.push(p);
    }
  }
  await walk(path.join(dir, 'dlc'));
  return out;
}

class DlcImporter {
  constructor({ library, audio, tabs, cacheFile, onProgress = () => {} }) {
    Object.assign(this, { library, audio, tabs, cacheFile, onProgress });
    this.rows = [];
    this.busy = false;
  }
  cancel() { this.controller?.abort(); }
  snapshot() {
    return this.rows.map(({ song, source, ...row }) => row);
  }
  existing(song) {
    const ids = new Set(song.arrangements.map((a) => lower(a.id)));
    return Object.values(this.library.data.songs).find((s) => lower(s.songKey) === lower(song.songKey) ||
      s.arrangements?.some((a) => ids.has(lower(a.id))));
  }
  async run(fn) {
    if (this.busy) throw new Error('An import operation is already running.');
    this.busy = true;
    this.controller = new AbortController();
    try { await fn(this.controller.signal); }
    catch (e) { if (!this.controller.signal.aborted) throw e; }
    finally { this.busy = false; }
    return this.snapshot();
  }
  async scan(dir) {
    return this.run(async (signal) => {
      this.rows = [];
      const paths = await installedArchives(dir, signal);
      // Build only the index of the selected installation, reusing the normal resolver.
      // Its index() is already satisfied by this scan; no unrelated folders or originals.
      const finder = new AudioFinder({ cacheFile: this.cacheFile, gameDir: () => dir, folders: () => [] });
      finder.game = dir;
      finder.files = new Map();
      this.archiveStats = finder.files;
      finder.index = async () => signal.throwIfAborted();
      const readEntry = finder._readEntry.bind(finder);
      finder._readEntry = async (...args) => { signal.throwIfAborted(); return readEntry(...args); };
      const seen = new Map();
      for (let i = 0; i < paths.length; i++) {
        signal.throwIfAborted();
        const p = paths[i];
        this.onProgress({ phase: 'Scanning archives', done: i, total: paths.length, file: path.basename(p) });
        let archive;
        try {
          const st = await fs.stat(p);
          if (!st.size) throw new Error('Invalid archive: zero bytes');
          archive = await Psarc.open(p);
          const rec = { size: st.size, mtimeMs: st.mtimeMs, wems: [], banks: [] };
          for (const { name, length } of archive.list()) {
            if (/\.bnk$/i.test(name)) rec.banks.push([name, length]);
            const m = /(?:^|\/)(\d+)\.(?:wem|ogg)$/i.exec(name);
            if (m) rec.wems.push([Number(m[1]), name, length]);
          }
          finder.files.set(p, rec);
          const songs = await readSongs(archive, { metadataOnly: true, signal });
          for (const meta of songs) {
            const key = lower(meta.songKey);
            if (seen.has(key)) {
              // Same song in duplicate packs; retain genuinely distinct arrangements.
              const row = seen.get(key);
              for (const a of meta.arrangements) if (!row.song.arrangements.some((b) => lower(a.id) === lower(b.id))) {
                row.song.arrangements.push({ ...a, sourcePath: p });
              }
              row.arrangements = row.song.arrangements.map((a) => `${a.name} (${a.id.slice(0, 8)})`).join(', ');
              continue;
            }
            const song = { ...meta, id: songId(p, meta.songKey), path: p, fileName: path.basename(p),
              fileSize: st.size, mtimeMs: st.mtimeMs, multi: songs.length, audioEntry: null, previewEntry: null, dlcImport: true };
            const row = { id: song.id, artist: song.artist, title: song.title,
              arrangements: song.arrangements.map((a) => `${a.name} (${a.id.slice(0, 8)})`).join(', '),
              status: 'Checking dependencies', selectable: false, song };
            seen.set(key, row);
            this.rows.push(row);
          }
        } catch (e) {
          signal.throwIfAborted();
          this.rows.push({ id: `error:${i}`, artist: '', title: path.basename(p), arrangements: '', status: e.message, selectable: false });
        } finally { if (archive) await archive.close().catch(() => {}); }
        await tick();
      }
      for (let i = 0; i < this.rows.length; i++) {
        signal.throwIfAborted();
        const row = this.rows[i];
        if (!row.song) continue;
        this.onProgress({ phase: 'Checking song audio', done: i, total: this.rows.length, file: row.title });
        try {
          let bank = null;
          if (row.song.bankEntry) bank = await finder._readEntry(row.song.path, row.song.bankEntry);
          row.source = await finder.resolve(row.song, bank, { includeOwn: true });
          const prev = this.existing(row.song);
          const sameSource = prev?.audioFrom?.path === row.source.path && prev?.audioFrom?.entry === row.source.entry;
          const sourcesUnchanged = prev?.dlcSources && Object.entries(prev.dlcSources).every(([p, old]) => {
            const current = this.archiveStats.get(p);
            return current && current.size === old.size && current.mtimeMs === old.mtimeMs;
          });
          const complete = prev?.dlcImport && sameSource && sourcesUnchanged && !prev.audioFail &&
            row.song.arrangements.every((a) => prev.arrangements.some((b) => lower(a.id) === lower(b.id)));
          row.status = complete ? 'Already in Stagehand' : prev ? 'Already in Stagehand — repair / verify audio' : 'Ready';
          row.selectable = !complete;
        } catch (e) { signal.throwIfAborted(); row.status = e.message; }
        await tick();
      }
    });
  }
  async importSelected(ids) {
    if (!Array.isArray(ids)) throw new Error('Select songs to import.');
    return this.run(async (signal) => {
      const selected = new Set(ids);
      const rows = this.rows.filter((r) => selected.has(r.id) && r.selectable);
      for (let i = 0; i < rows.length; i++) {
        signal.throwIfAborted();
        const row = rows[i];
        this.onProgress({ phase: 'Importing (checking charts and decoding audio)', done: i, total: rows.length, file: row.title });
        try {
          const dlcSources = {};
          for (const p of new Set([row.song.path, row.source.path, row.source.bank.path,
            ...row.song.arrangements.map((a) => a.sourcePath).filter(Boolean)])) {
            const st = await fs.stat(p);
            const scanned = this.archiveStats.get(p);
            if (!scanned || st.size !== scanned.size || st.mtimeMs !== scanned.mtimeMs) throw new Error('Source archive changed — scan again before importing');
            dlcSources[p] = { size: st.size, mtimeMs: st.mtimeMs };
          }
          const prev = this.existing(row.song);
          const song = { ...prev, ...row.song, id: prev?.id || row.song.id, user: prev?.user,
            addedAt: prev?.addedAt || Date.now(), audioFrom: { path: row.source.path, entry: row.source.entry },
            audioEntry: null, audioKey: undefined, audioFail: undefined, dlcSources };
          const parts = this.tabs.list(song);
          if (!parts.length) throw new Error('No playable arrangements found');
          for (const a of parts) {
            signal.throwIfAborted();
            await this.tabs.load(song, a.id);
          }
          // Normal decoder and content-addressed audio/stem cache; no alternate player.
          // Decode may finish caching after cancellation, but no library entry is committed.
          const info = await cancellable(this.audio.prepare({ ...song, id: null }), signal);
          signal.throwIfAborted();
          song.audioKey = info.key;
          this.library.data.songs[song.id] = song;
          this.library.saveSoon();
          row.status = prev ? 'Repaired / verified' : 'Imported';
          row.selectable = false;
          this.library.emit('reset');
        } catch (e) {
          if (signal.aborted) { row.status = 'Cancelled — ready to retry'; throw e; }
          row.status = e.message;
        }
        await tick();
      }
      await this.library.save();
    });
  }
}
function cancellable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
module.exports = { DlcImporter, installedArchives };
