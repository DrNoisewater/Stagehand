'use strict';
/**
 * Finds a song's audio when its own file doesn't hold it.
 *
 * 4.0.3: some official files hold the parts and the sound bank but not the audio.
 * 4.11: some hold neither. The Rocksmith 1 songs you bought (rs1compatibilitydlc_p.psarc) are
 * charts, manifests and artwork only: their sound banks and audio are in other files in the
 * game's folder (songs.psarc in its root, the RS1 disc pack, the dlc folder). So the chart's
 * file and the audio's file can differ, and the match is made the way the game makes it:
 *
 *   the manifest names the song's sound bank (SongBank) and its event (SongEvent, "Play_<key>")
 *   → that bank, wherever it is (by its file name; else the bank that holds that event)
 *   → the event's action → the sound → the id of the audio it plays
 *   → the .wem with that id (or the audio kept inside the bank).
 *
 * Never "the first" or "the biggest" audio in a file. The preview is a different bank
 * (…_preview.bnk) with a different event, so it is never taken for the song. If two
 * different recordings match equally well, nothing is played and the report says so.
 *
 * The index (which banks and audio ids each archive holds, and which events each bank of a
 * shared archive holds) is kept on disk by path, size and modified time: only new or changed
 * files are opened again, and nothing is ever unpacked wholesale. Game files are only read.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Psarc } = require('../core/psarc');
const { fnv1, parseBank, bankEvents, bankSongMedia } = require('../core/wwise');

const WEM = /\.(wem|ogg)$/i;
const BNK = /\.bnk$/i;
const PREVIEW = /_preview\.bnk$/i;
const FULL_BYTES = 400 * 1024; // audio kept inside a bank counts as the whole song from here up (a lead-in is ~50 KB)
const INDEX_VERSION = 2;

class AudioFindError extends Error {
  /** code: AUDIO_NO_GAME | AUDIO_NO_BANK | AUDIO_NO_MEDIA | AUDIO_AMBIGUOUS */
  constructor(message, code, detail = {}) {
    super(message);
    this.code = code;
    Object.assign(this, detail);
  }
}

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

/** Which ids a sound bank mentions anywhere, out of the ids we know (used only when the bank can't be read properly). */
function idsInBank(bank, ids) {
  const hit = [];
  const b = Buffer.alloc(4);
  for (const id of ids) {
    b.writeUInt32LE(id >>> 0);
    if (bank.indexOf(b) !== -1) hit.push(id);
  }
  return hit;
}

const base = (n) => String(n || '').split(/[\\/]/).pop().toLowerCase();
const same = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();

class AudioFinder {
  /**
   * @param {{ cacheFile: string, gameDir: () => Promise<string|null>, folders: () => string[], log?: Function, onProgress?: (p: { done: number, total: number, file: string }) => void }} o
   */
  constructor({ cacheFile, gameDir, folders, log = () => {}, onProgress = () => {} }) {
    this.cacheFile = cacheFile;
    this.gameDir = gameDir;
    this.folders = folders;
    this.log = log;
    this.onProgress = onProgress;
    this.files = null; // path -> { size, mtimeMs, wems: [[id, name, length]], banks: [[name, length]], events?: { [bankName]: number[] } }
    this.building = null;
    this.game = null;
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

  /** The files to look in: Rocksmith's folder (songs.psarc in its root, dlc and everything under it) and the library folders. */
  async _paths() {
    const out = new Set();
    this.game = await Promise.resolve(this.gameDir()).catch(() => null);
    if (this.game) await walk(this.game, out);
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
    const todo = [];
    for (const p of paths) {
      let st;
      try {
        st = await fsp.stat(p);
      } catch (_) {
        continue;
      }
      const rec = this.files.get(p);
      if (!(rec && rec.size === st.size && rec.mtimeMs === st.mtimeMs)) todo.push([p, st]);
    }
    let lastSave = Date.now();
    for (const [p, st] of todo) {
      const wems = [];
      const banks = [];
      let psarc = null;
      try {
        psarc = await Psarc.open(p); // reads the list of contents only
        for (const { name, length } of psarc.list()) {
          if (BNK.test(name)) banks.push([name, length]);
          else if (WEM.test(name)) {
            const b = name.split('/').pop().replace(/\.[^.]+$/, '');
            if (/^\d+$/.test(b)) wems.push([Number(b), name, length]);
          }
        }
      } catch (_) {
        // not readable: remembered as empty until it changes
      } finally {
        if (psarc) await psarc.close().catch(() => {});
      }
      this.files.set(p, { size: st.size, mtimeMs: st.mtimeMs, wems, banks });
      opened++;
      changed = true;
      this.onProgress({ done: opened, total: todo.length, file: path.basename(p) });
      if (opened % 16 === 0) await new Promise((r) => setImmediate(r)); // let the app breathe
      if (Date.now() - lastSave > 15000) {
        await this._save();
        lastSave = Date.now();
      }
    }
    if (changed) await this._save();
    if (opened) this.log(`Audio search: indexed ${opened} file(s) of ${paths.size} in ${Date.now() - started} ms${this.game ? '' : ' (Rocksmith folder not found)'}`);
  }

  /** Forget everything (the Rocksmith folder changed). */
  async reset() {
    await this._load();
    this.files.clear();
    await this._save();
  }

  // 0: in the game's own folder (songs.psarc …), 1: the RS1 packs, 2: elsewhere under the game, 3: the library
  _tier(p) {
    if (/^rs1compatibility/i.test(path.basename(p))) return 1;
    if (this.game) {
      if (same(path.dirname(p), this.game)) return 0;
      const rel = path.relative(this.game, p);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return 2;
    }
    return 3;
  }

  async _readEntry(p, entry) {
    const a = await Psarc.open(p);
    try {
      return await a.read(entry);
    } finally {
      await a.close().catch(() => {});
    }
  }

  /** The events of every (non-preview) bank in an archive: read once, then remembered. */
  async _events(p, rec) {
    if (rec.events) return rec.events;
    const ev = {};
    let a = null;
    try {
      a = await Psarc.open(p);
      for (const [name] of rec.banks) {
        if (PREVIEW.test(name)) continue;
        try {
          ev[name] = bankEvents(parseBank(await a.read(name)));
        } catch (_) {
          ev[name] = [];
        }
      }
    } catch (_) {
      // unreadable: no events
    } finally {
      if (a) await a.close().catch(() => {});
    }
    rec.events = ev;
    this._dirty = true;
    return ev;
  }

  /**
   * Finds the full-song audio for a song whose own file has none.
   * @param {object} song a library song: path, songKey, title, bankEntry, bankName, songEvent
   * @param {Buffer|null} ownBank the song's bank when its own file has one
   * @returns {Promise<{ path: string, entry: string, mediaId: number, bank: { path: string, entry: string }, via: string }>}
   * @throws {AudioFindError}
   */
  async resolve(song, ownBank = null) {
    await this.index();
    const key = String(song.songKey || '');
    const event = fnv1(song.songEvent || `Play_${key}`);
    const who = `${song.title || key} [${key}${song.songEvent ? `, ${song.songEvent}` : ''}${song.bankName ? `, ${song.bankName}` : ''}]`;
    const searched = () => `${this.files.size} archive(s)${this.game ? ` incl. ${this.game}` : ', Rocksmith folder not found'}`;

    // every audio file we know of, by id
    const wem = new Map();
    for (const [p, rec] of this.files) {
      for (const [id, name, length] of rec.wems) {
        const c = { path: p, entry: name, length, tier: same(p, song.path) ? -1 : this._tier(p) };
        if (!wem.has(id)) wem.set(id, []);
        wem.get(id).push(c);
      }
    }
    const known = (id) => wem.has(id);

    // 1. the song's sound bank(s)
    let banks = [];
    if (ownBank) banks.push({ path: song.path, entry: song.bankEntry, buf: ownBank, tier: -1, how: 'its own file' });
    else {
      const names = new Set([base(song.bankName), `song_${key.toLowerCase()}.bnk`].filter((n) => n && n !== 'song_.bnk' && !PREVIEW.test(n)));
      for (const [p, rec] of this.files) {
        if (same(p, song.path)) continue;
        for (const [name] of rec.banks) if (names.has(base(name))) banks.push({ path: p, entry: name, tier: this._tier(p), how: 'bank name' });
      }
      if (!banks.length) {
        // no bank by that name: the bank that holds the song's event, in the shared archives
        for (const [p, rec] of this.files) {
          if (same(p, song.path) || !rec.banks.length) continue;
          const tier = this._tier(p);
          if (tier > 1 && rec.banks.filter(([n]) => !PREVIEW.test(n)).length < 2) continue; // a single song's own file
          const ev = await this._events(p, rec);
          for (const [name, ids] of Object.entries(ev)) if (ids.includes(event)) banks.push({ path: p, entry: name, tier, how: 'event' });
        }
        if (this._dirty) {
          this._dirty = false;
          await this._save();
        }
      }
      if (!banks.length) {
        if (!this.game) {
          this.log(`Audio: ${who}: no Rocksmith folder to look in; searched ${searched()}`);
          throw new AudioFindError('This song keeps its audio in Rocksmith’s own folder (songs.psarc and the dlc folder), and Stagehand couldn’t find where Rocksmith 2014 is installed.', 'AUDIO_NO_GAME');
        }
        const root = fs.existsSync(path.join(this.game, 'songs.psarc'));
        this.log(`Audio: ${who}: sound bank not found (by name or by event ${event}); searched ${searched()}; songs.psarc ${root ? 'present' : 'MISSING'}`);
        throw new AudioFindError(
          root
            ? `Stagehand looked through your Rocksmith folder and library (${this.files.size} files) and none holds this song’s sound bank${song.bankName ? ` (${base(song.bankName)})` : ''}. If it plays in Rocksmith, send the Activity log so this can be tracked down.`
            : `songs.psarc is missing from your Rocksmith folder (${this.game}), and no other file holds this song’s sound bank. Steam › Rocksmith 2014 › Properties › Installed files › Verify puts it back.`,
          'AUDIO_NO_BANK',
          { songsPsarc: root }
        );
      }
      // the game's own files first; then only the best place found
      const best = Math.min(...banks.map((b) => b.tier));
      banks = banks.filter((b) => b.tier === best);
    }

    // 2. what each bank's event plays, and where that audio is
    const found = new Map(); // media id → result
    const dead = [];
    for (const b of banks) {
      let buf = b.buf;
      try {
        if (!buf) buf = await this._readEntry(b.path, b.entry);
      } catch (err) {
        dead.push(`${b.path}: ${err.message}`);
        continue;
      }
      let m = bankSongMedia(buf, { event, known });
      if (!m.ids.length) {
        // a bank we can't read properly: only a single unmistakable mention counts
        const hits = idsInBank(buf, wem.keys());
        if (hits.length === 1) m = { ids: hits, via: 'mention', embedded: new Map() };
      }
      for (const id of m.ids) {
        if (found.has(id)) continue;
        const files = (wem.get(id) || []).slice().sort((x, y) => (same(x.path, b.path) ? -1 : same(y.path, b.path) ? 1 : x.tier - y.tier || y.length - x.length));
        if (files.length) found.set(id, { path: files[0].path, entry: files[0].entry, mediaId: id, bank: { path: b.path, entry: b.entry }, via: `${b.how} → ${m.via}`, bytes: files[0].length });
        else if ((m.embedded.get(id) || 0) >= FULL_BYTES) found.set(id, { path: b.path, entry: `${b.entry}#${id}`, mediaId: id, bank: { path: b.path, entry: b.entry }, via: `${b.how} → ${m.via} (inside the bank)`, bytes: m.embedded.get(id) });
        else dead.push(`${b.path}: ${b.entry} plays media ${id}, which is in no archive`);
      }
    }
    if (found.size === 1) {
      const r = [...found.values()][0];
      this.log(`Audio: ${who}: chart ${song.path}; bank ${r.bank.path} (${r.bank.entry}); audio ${r.path} (${r.entry}, ${Math.round(r.bytes / 1024)} KB) via ${r.via}`);
      return r;
    }
    if (found.size > 1) {
      const list = [...found.values()].map((r) => `${r.mediaId} in ${r.path} (bank ${r.bank.path})`).join('; ');
      this.log(`Audio: ${who}: ${found.size} different recordings match: ${list}`);
      throw new AudioFindError('More than one different recording matches this song in your files, so Stagehand won’t guess which is right. The Activity log (Settings › About) lists them.', 'AUDIO_AMBIGUOUS', { matches: [...found.values()] });
    }
    this.log(`Audio: ${who}: bank found but its audio is missing: ${dead.join('; ') || 'the bank names no audio'}; searched ${searched()}`);
    throw new AudioFindError(`Stagehand found this song’s sound bank (${path.basename(banks[0].path)}), but the audio it plays isn’t in any of your files. If it plays in Rocksmith, send the Activity log so this can be tracked down.`, 'AUDIO_NO_MEDIA');
  }

  /** 4.0.3's call, kept for callers that have the bank: the audio, or null. */
  async find(song, bank) {
    if (!bank) return null;
    try {
      const r = await this.resolve(song, bank);
      return same(r.path, song.path) ? null : { path: r.path, entry: r.entry };
    } catch (_) {
      return null;
    }
  }
}

module.exports = { AudioFinder, AudioFindError, idsInBank };
