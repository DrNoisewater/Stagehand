'use strict';
/**
 * 4.0.3: finds a song's audio in another file when its own file has none.
 *
 * Some paid (official) DLC files hold the parts but not the song audio. The song's
 * sound bank still names the audio it plays (by Wwise media id), so we look for a
 * .wem with that id in Rocksmith's own folder (songs.psarc, the RS1 import packs,
 * the dlc folder) and in the library folders.
 *
 * The index (which .wem ids each file holds) is cached on disk by path, size and
 * modified time, so only new or changed files are opened again.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Psarc } = require('../core/psarc');

const WEM = /\.(wem|ogg)$/i;
const MIN_SONG_BYTES = 400 * 1024; // a full song, not a preview or a sound effect
const INDEX_VERSION = 1;

async function walk(dir, out, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && e.name !== '$RECYCLE.BIN') await walk(p, out, depth + 1);
    } else if (/\.psarc$/i.test(e.name)) out.add(p);
  }
}

/** Which .wem ids a sound bank refers to, out of the ids we know (4-byte little-endian match). */
function idsInBank(bank, ids) {
  const hit = [];
  const b = Buffer.alloc(4);
  for (const id of ids) {
    b.writeUInt32LE(id >>> 0);
    if (bank.indexOf(b) !== -1) hit.push(id);
  }
  return hit;
}

class AudioFinder {
  /**
   * @param {{ cacheFile: string, gameDir: () => Promise<string|null>, folders: () => string[], log?: Function }} o
   */
  constructor({ cacheFile, gameDir, folders, log = () => {} }) {
    this.cacheFile = cacheFile;
    this.gameDir = gameDir;
    this.folders = folders;
    this.log = log;
    this.files = null; // path -> { size, mtimeMs, wems: [[id, name, length]] }
    this.building = null;
  }

  async _load() {
    if (this.files) return;
    this.files = new Map();
    try {
      const doc = JSON.parse(await fsp.readFile(this.cacheFile, 'utf8'));
      if (doc && doc.v === INDEX_VERSION) for (const [p, rec] of Object.entries(doc.files || {})) this.files.set(p, rec);
    } catch (_) {}
  }

  async _save() {
    const files = {};
    for (const [p, rec] of this.files) files[p] = rec;
    try {
      await fsp.mkdir(path.dirname(this.cacheFile), { recursive: true });
      const tmp = `${this.cacheFile}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify({ v: INDEX_VERSION, files }));
      await fsp.rename(tmp, this.cacheFile);
    } catch (err) {
      this.log(`Audio search: index not saved: ${err.message}`);
    }
  }

  /** The files to look in: Rocksmith's folder (and everything under it) and the library folders. */
  async _paths() {
    const out = new Set();
    const game = await Promise.resolve(this.gameDir()).catch(() => null);
    if (game) await walk(game, out);
    for (const f of this.folders() || []) await walk(f, out);
    return out;
  }

  /** Brings the index up to date (only new or changed files are opened). */
  index() {
    if (!this.building) {
      this.building = this._index().finally(() => (this.building = null));
    }
    return this.building;
  }

  async _index() {
    await this._load();
    const started = Date.now();
    const paths = await this._paths();
    let opened = 0;
    let changed = false;
    for (const p of this.files.keys()) {
      if (!paths.has(p)) {
        this.files.delete(p);
        changed = true;
      }
    }
    for (const p of paths) {
      let st;
      try {
        st = await fsp.stat(p);
      } catch (_) {
        continue;
      }
      const rec = this.files.get(p);
      if (rec && rec.size === st.size && rec.mtimeMs === st.mtimeMs) continue;
      const wems = [];
      let psarc = null;
      try {
        psarc = await Psarc.open(p);
        for (const { name, length } of psarc.list()) {
          if (!WEM.test(name) || length < MIN_SONG_BYTES) continue;
          const base = name.split('/').pop().replace(/\.[^.]+$/, '');
          if (/^\d+$/.test(base)) wems.push([Number(base), name, length]);
        }
      } catch (_) {
        // not readable: remembered as empty until it changes
      } finally {
        if (psarc) await psarc.close().catch(() => {});
      }
      this.files.set(p, { size: st.size, mtimeMs: st.mtimeMs, wems });
      opened++;
      changed = true;
    }
    if (changed) await this._save();
    if (opened) this.log(`Audio search: indexed ${opened} file(s) of ${paths.size} in ${Date.now() - started} ms`);
  }

  /**
   * Finds the audio for a song whose own file has none.
   * @param {object} song a library song (path, bankEntry)
   * @param {Buffer} bank the song's sound bank
   * @returns {Promise<{ path: string, entry: string } | null>}
   */
  async find(song, bank) {
    if (!bank) return null;
    await this.index();
    const byId = new Map();
    for (const [p, rec] of this.files) {
      if (p === song.path) continue;
      for (const [id, name, length] of rec.wems) {
        const cur = byId.get(id);
        if (!cur || length > cur.length) byId.set(id, { path: p, entry: name, length });
      }
    }
    const hits = idsInBank(bank, byId.keys()).map((id) => byId.get(id));
    if (!hits.length) return null;
    const best = hits.reduce((a, b) => (b.length > a.length ? b : a));
    return { path: best.path, entry: best.entry };
  }
}

module.exports = { AudioFinder, idsInBank };
