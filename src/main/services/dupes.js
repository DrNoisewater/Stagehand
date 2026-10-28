/**
 * Duplicate songs (3.7): the same song in two or more files (an older and a
 * newer version, a DD and a non-DD build, a re-download). Stagehand always
 * plays the full arrangement (the hardest level), so a copy only differs in
 * what's packed in it: we keep the best one (it must have audio; then more
 * parts, then the newer version, then your stems and history) and move the
 * rest out of your song folders into Stagehand's backups, where Undo puts
 * them back. Nothing is deleted.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/** "The Song (Remastered 2011) [DD] v3" → "song": version noise out, real words (Live, Acoustic) kept. */
function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[([](?:[^)\]]*?\b(?:remaster(?:ed)?|dd|ndd|cdlc|custom|v\d+(?:\.\d+)*|version \d+|explicit|radio edit|single version|album version)\b[^)\]]*)[)\]]/g, ' ')
    .replace(/\b(?:v\d+(?:\.\d+)*|dd|ndd|cdlc)\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function normArtist(s) {
  return normTitle(String(s || '').replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, ''));
}

const PARTS = ['lead', 'rhythm', 'bass', 'combo', 'vocals'];
function partsOf(s) {
  const set = new Set();
  for (const a of s.arrangements || []) {
    const t = String(a.type || a.name || a.kind || '').toLowerCase();
    for (const p of PARTS) if (t.includes(p)) set.add(p);
  }
  return set;
}
/** Bigger is newer: package version, else a v-number in the file name. */
function versionOf(s) {
  const pick = (str) => {
    const m = /(\d+(?:\.\d+)*)/.exec(String(str || ''));
    return m ? m[1].split('.').map(Number) : null;
  };
  return pick(s.packageVersion) || pick((/_v(\d+(?:[._]\d+)*)/i.exec(s.fileName || '') || [])[1]) || [0];
}
function cmpVer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Why a copy ranks where it does, for the dialog. */
function facts(s, stemsReady) {
  return {
    audio: !!s.audioEntry,
    parts: [...partsOf(s)],
    version: versionOf(s).join('.'),
    dd: /(^|[^a-z])dd([^a-z]|$)/i.test(`${s.fileName || ''} ${s.packageComment || ''}`),
    stems: !!stemsReady,
    plays: (s.user && s.user.plays) || 0,
    size: s.fileSize || 0,
    mtime: s.mtimeMs || 0,
    pack: (s.multi || 1) > 1, // a file with several songs inside is never moved
  };
}

/** Higher = better to keep. */
function better(a, b) {
  return (
    a.audio - b.audio ||
    !b.pack - !a.pack || // (prefer keeping the pack: it can't be moved anyway)
    a.parts.length - b.parts.length ||
    cmpVer(a.version.split('.').map(Number), b.version.split('.').map(Number)) ||
    a.stems - b.stems ||
    a.plays - b.plays ||
    a.mtime - b.mtime ||
    a.size - b.size
  );
}

/**
 * Groups of the same song. songs: library records; stems: Set of song ids
 * with stems. → [{ key, title, artist, keep, items: [{ id, ...facts, remove }] }]
 */
function findDuplicates(songs, stems = new Set()) {
  const groups = new Map();
  for (const s of songs) {
    const t = normTitle(s.title);
    if (!t) continue;
    const k = `${normArtist(s.artist)}|${t}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const items = list.map((s) => ({ id: s.id, fileName: s.fileName, path: s.path, title: s.title, artist: s.artist, ...facts(s, stems.has(s.id)) }));
    items.sort((a, b) => better(b, a));
    const keep = items[0];
    for (const it of items) it.remove = it !== keep && !it.pack;
    // nothing to choose if no copy has audio: still listed, nothing removed by default
    if (!keep.audio) for (const it of items) it.remove = false;
    out.push({ key, title: keep.title, artist: keep.artist, keep: keep.id, items });
  }
  out.sort((a, b) => String(a.artist).localeCompare(String(b.artist)) || String(a.title).localeCompare(String(b.title)));
  return out;
}

async function moveFile(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.copyFile(from, to);
    await fsp.unlink(from);
  }
}

class Dupes {
  constructor({ library, dir }) {
    this.library = library;
    this.dir = dir; // <local>/Backups/Duplicates
    this.file = path.join(dir, 'batches.json');
  }

  async _batches() {
    try {
      return JSON.parse(await fsp.readFile(this.file, 'utf8'));
    } catch (_) {
      return [];
    }
  }

  /**
   * Moves the given copies aside. pairs: [{ remove: songId, keep: songId }].
   * Your favourite, rating, plays and setlist places carry over to the copy kept.
   */
  async remove(pairs) {
    const L = this.library;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batch = { id: stamp, at: Date.now(), files: [] };
    const bdir = path.join(this.dir, stamp);
    for (const { remove, keep } of pairs) {
      const s = L.get(remove);
      const k = L.get(keep);
      if (!s || !k || s.path === k.path) continue;
      if (L.songsInFile(s.path).length > 1) continue; // never move a pack
      const to = path.join(bdir, `${batch.files.length}`, path.basename(s.path));
      try {
        await moveFile(s.path, to);
      } catch (e) {
        batch.files.push({ from: s.path, to: null, error: e.message });
        continue;
      }
      // carry what you've done with it over to the copy you keep
      const u = s.user || {};
      const ku = k.user || {};
      const patch = {};
      if (u.fav && !ku.fav) patch.fav = true;
      if ((u.rating || 0) > (ku.rating || 0)) patch.rating = u.rating;
      if (u.plays) patch.plays = (ku.plays || 0) + u.plays;
      if ((u.lastPlayed || 0) > (ku.lastPlayed || 0)) patch.lastPlayed = u.lastPlayed;
      if (Object.keys(patch).length) L.setUser(keep, patch);
      for (const sl of L.data.setlists || []) {
        if (!sl.songIds.includes(remove)) continue;
        sl.songIds = sl.songIds.includes(keep) ? sl.songIds.filter((x) => x !== remove) : sl.songIds.map((x) => (x === remove ? keep : x));
      }
      L.forgetFile(s.path);
      batch.files.push({ from: s.path, to, songId: remove, keep });
    }
    L.saveSoon();
    const all = await this._batches();
    all.push(batch);
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.file, JSON.stringify(all.slice(-50), null, 1));
    const moved = batch.files.filter((f) => f.to);
    return { id: batch.id, moved: moved.length, failed: batch.files.filter((f) => !f.to).map((f) => ({ path: f.from, error: f.error })) };
  }

  /** Puts a batch back where it came from. */
  async undo(id) {
    const all = await this._batches();
    const b = id ? all.find((x) => x.id === id) : all[all.length - 1];
    if (!b) return { restored: 0 };
    let n = 0;
    for (const f of b.files) {
      if (!f.to) continue;
      try {
        if (fs.existsSync(f.from)) continue; // something is there again: leave both
        await moveFile(f.to, f.from);
        await this.library.refreshFile(f.from).catch(() => {});
        n++;
      } catch (_) {}
    }
    await fsp.writeFile(this.file, JSON.stringify(all.filter((x) => x !== b), null, 1));
    return { restored: n };
  }
}

module.exports = { Dupes, findDuplicates, normTitle };
