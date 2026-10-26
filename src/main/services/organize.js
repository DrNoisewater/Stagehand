'use strict';
/**
 * Rename and sort PSARC files from their metadata, with preview and undo.
 * Only file names/locations change; archive contents are never touched.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { readJson, writeJsonAtomic } = require('../core/files');
const { norm } = require('./library');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const TOKENS = ['artist', 'title', 'album', 'year', 'author', 'version', 'tuning'];

function clean(part) {
  let s = String(part ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (RESERVED.test(s)) s = `_${s}`;
  return s.slice(0, 120);
}

function render(pattern, song) {
  const values = {
    artist: song.artist,
    title: song.title,
    album: song.album,
    year: song.year || '',
    author: song.author,
    version: song.packageVersion,
    tuning: song.tuning,
  };
  let out = String(pattern).replace(/\{(\w+)\}/g, (m, k) => (TOKENS.includes(k) ? clean(values[k]) : m));
  // Tidy separators left behind by empty values, e.g. "Artist -  - Title".
  out = out.replace(/\s*-\s*(-\s*)+/g, ' - ').replace(/_{2,}/g, '_').replace(/^[\s\-_]+|[\s\-_]+$/g, '');
  return clean(out);
}

function platformSuffix(fileName) {
  const m = /(_[pm])\.psarc$/i.exec(fileName);
  return m ? m[1].toLowerCase() : '';
}

class Organizer {
  constructor({ library, logFile }) {
    this.library = library;
    this.logFile = logFile;
  }

  /**
   * @param {object} opts { songIds, pattern, mode: 'rename' | 'folders' }
   */
  plan({ songIds, pattern, mode = 'rename' }) {
    const lib = this.library;
    const files = new Map();
    for (const id of songIds) {
      const s = lib.get(id);
      if (s && !files.has(norm(s.path))) files.set(norm(s.path), s);
    }
    const items = [];
    const targets = new Map();
    for (const song of files.values()) {
      const from = song.path;
      const base = render(pattern, song) || clean(song.title) || 'Untitled';
      const name = `${base}${platformSuffix(song.fileName)}.psarc`;
      let dir = path.dirname(from);
      if (mode === 'folders') {
        const root = lib.data.folders.map((f) => f.path).find((f) => norm(from).startsWith(norm(f) + path.sep)) || path.dirname(from);
        dir = path.join(root, clean(song.artist) || 'Unknown artist');
      }
      const to = path.join(dir, name);
      const item = { songId: song.id, title: song.title, artist: song.artist, from, to, status: 'ok', reason: '' };
      if (norm(from) === norm(to)) {
        item.status = from === to ? 'same' : 'ok'; // a case-only change is still a rename
        if (from === to) item.reason = 'Already named this way';
      } else if (fs.existsSync(to)) {
        item.status = 'conflict';
        item.reason = 'A file with this name already exists';
      }
      const t = norm(to);
      if (targets.has(t) && item.status === 'ok') {
        item.status = 'conflict';
        item.reason = 'Two songs would get the same name';
        const other = targets.get(t);
        if (other.status === 'ok') {
          other.status = 'conflict';
          other.reason = item.reason;
        }
      }
      targets.set(t, item);
      items.push(item);
    }
    return items;
  }

  async apply(items) {
    const moves = [];
    const results = [];
    for (const it of items) {
      if (it.status !== 'ok') continue;
      try {
        await fsp.mkdir(path.dirname(it.to), { recursive: true });
        if (norm(it.from) !== norm(it.to) && fs.existsSync(it.to)) throw new Error('Target already exists');
        if (norm(it.from) === norm(it.to)) {
          // Case-only rename on a case-insensitive disk needs a hop.
          const hop = `${it.to}.stagehand-tmp`;
          await fsp.rename(it.from, hop);
          await fsp.rename(hop, it.to);
        } else {
          await fsp.rename(it.from, it.to);
        }
        this.library.renameFile(it.from, it.to);
        moves.push({ from: it.from, to: it.to });
        results.push({ ...it, status: 'done' });
      } catch (err) {
        results.push({ ...it, status: 'error', reason: err.code === 'EBUSY' || err.code === 'EPERM' ? 'File is in use' : err.message });
      }
    }
    if (moves.length) {
      const log = await readJson(this.logFile, []);
      log.push({ at: Date.now(), moves });
      await writeJsonAtomic(this.logFile, log.slice(-20));
    }
    return results;
  }

  async lastBatch() {
    const log = await readJson(this.logFile, []);
    return log.length ? log[log.length - 1] : null;
  }

  async undo() {
    const log = await readJson(this.logFile, []);
    const last = log.pop();
    if (!last) return { undone: 0, failed: [] };
    let undone = 0;
    const failed = [];
    for (const m of last.moves.slice().reverse()) {
      try {
        if (fs.existsSync(m.from) && norm(m.from) !== norm(m.to)) throw new Error('Original name is taken');
        await fsp.mkdir(path.dirname(m.from), { recursive: true });
        await fsp.rename(m.to, m.from);
        this.library.renameFile(m.to, m.from);
        undone++;
        // Remove artist folders we created if they are now empty.
        const dir = path.dirname(m.to);
        if (norm(dir) !== norm(path.dirname(m.from))) {
          const left = await fsp.readdir(dir).catch(() => ['x']);
          if (!left.length) await fsp.rmdir(dir).catch(() => {});
        }
      } catch (err) {
        failed.push({ ...m, reason: err.message });
      }
    }
    await writeJsonAtomic(this.logFile, log);
    return { undone, failed };
  }
}

module.exports = { Organizer, render, clean, TOKENS };
