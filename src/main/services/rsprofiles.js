'use strict';
/**
 * Rocksmith in-game song lists (Song List 1-6 and Favorites) stored in the
 * player's profile in Steam's userdata folder.
 *
 * Every change: Rocksmith must be closed -> read the profile fresh from disk ->
 * patch only the lists -> encode and decode the result to prove it -> back up
 * the profile, LocalProfiles.json and remotecache.vdf -> swap files in ->
 * update Steam Cloud's metadata so the change syncs rather than being undone.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const rs = require('../core/rssave');
const ini = require('../core/rsmodsini');
const { run } = require('./tools');

const IS_WIN = process.platform === 'win32';
const APP_ID = '221680';
const KEEP_BACKUPS = 20;

class RsProfileError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function renameWithRetry(from, to) {
  let last;
  for (let i = 0; i < 8; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      last = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw new RsProfileError('A Rocksmith save file is locked by another program. Close Rocksmith and try again.', 'RS_LOCKED');
}

class RsProfiles {
  constructor({ settings, backupDir, log = () => {}, libraryFolders = () => [] }) {
    this.settings = settings;
    this.backupDir = backupDir;
    this.log = log;
    this.libraryFolders = libraryFolders;
    this._queue = Promise.resolve();
  }

  // ---------------------------------------------------------- game folder --
  /** The Rocksmith 2014 install folder (where Rocksmith2014.exe and RSMods.ini live). */
  async gameDir() {
    const isGame = (d) => d && (fs.existsSync(path.join(d, 'Rocksmith2014.exe')) || fs.existsSync(path.join(d, 'cache.psarc')));
    const custom = this.settings.get().rocksmith.gameDir || process.env.STAGEHAND_RS_GAME_DIR;
    if (isGame(custom)) return custom;
    const libs = [];
    const steam = await this.steamDir();
    if (steam) {
      libs.push(steam);
      try {
        const vdf = await fsp.readFile(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, '\\'));
      } catch (_) {}
    }
    for (const lib of libs) {
      const d = path.join(lib, 'steamapps', 'common', 'Rocksmith2014');
      if (isGame(d)) return d;
    }
    // A Stagehand library folder that is the game's dlc folder.
    for (const f of this.libraryFolders()) {
      const parent = path.dirname(path.resolve(f));
      if (/^dlc$/i.test(path.basename(path.resolve(f))) && isGame(parent)) return parent;
    }
    return null;
  }

  async rsmods() {
    const dir = await this.gameDir();
    if (!dir) return { gameDir: null, installed: false, names: new Array(ini.MAX_LISTS).fill(null) };
    const iniPath = path.join(dir, 'RSMods.ini');
    let text = null;
    try {
      text = await fsp.readFile(iniPath, 'utf8');
    } catch (_) {}
    const dll = ['xinput1_3.dll', 'D3DX9_42.dll'].some((f) => {
      try {
        return fs.statSync(path.join(dir, f)).size >= 300000;
      } catch (_) {
        return false;
      }
    });
    return { gameDir: dir, iniPath, iniExists: text !== null, installed: dll, names: ini.readTitles(text) };
  }

  /** Renames song lists in RSMods.ini. `names` maps 0-based index -> name ('' = default). */
  rename(names) {
    const job = this._queue.then(() => this._rename(names));
    this._queue = job.catch(() => {});
    return job;
  }

  async _rename(names) {
    const mods = await this.rsmods();
    if (!mods.gameDir) throw new RsProfileError('Stagehand couldn’t find your Rocksmith 2014 folder. Choose it in Settings → Rocksmith.', 'RS_NO_GAME');
    let text = '';
    if (mods.iniExists) text = await fsp.readFile(mods.iniPath, 'utf8');
    const next = ini.setTitles(text, names);
    // Prove the edit: requested names read back, and no other line changed.
    const got = ini.readTitles(next);
    for (const [k, v] of Object.entries(names)) {
      const name = ini.cleanName(v);
      const want = ini.isPlaceholder(name) ? null : name;
      if (got[Number(k)] !== want) throw new RsProfileError('Song list name did not read back correctly; nothing was written.', 'RS_VERIFY');
    }
    const strip = (t) => t.split(/\r?\n/).filter((l) => !/^\s*SongListTitle_\d+\s*=/i.test(l) && !/^\s*\[SongListTitles\]\s*$/i.test(l) && l.trim() !== '');
    if (mods.iniExists && JSON.stringify(strip(text)) !== JSON.stringify(strip(next))) {
      throw new RsProfileError('Renaming would have changed other RSMods settings; nothing was written.', 'RS_VERIFY');
    }
    if (mods.iniExists) {
      const dest = path.join(this.backupDir, 'RSMods.ini');
      await fsp.mkdir(dest, { recursive: true });
      await fsp.copyFile(mods.iniPath, path.join(dest, `${stamp()}_RSMods.ini`));
      const old = (await fsp.readdir(dest)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 10))) await fsp.unlink(path.join(dest, f)).catch(() => {});
    }
    const tmp = path.join(mods.gameDir, `.stagehand-${crypto.randomBytes(4).toString('hex')}.tmp`);
    await fsp.writeFile(tmp, next, 'utf8');
    try {
      await renameWithRetry(tmp, mods.iniPath);
    } catch (err) {
      await fsp.unlink(tmp).catch(() => {});
      throw err;
    }
    this.log(`Song list names updated in ${mods.iniPath}`);
    return this.read();
  }

  // -------------------------------------------------------------- discovery --
  async steamDir() {
    const custom = this.settings.get().rocksmith.steamDir || process.env.STAGEHAND_STEAM_DIR;
    if (custom && fs.existsSync(path.join(custom, 'userdata'))) return custom;
    const candidates = [];
    if (IS_WIN) {
      try {
        const out = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
        const m = /SteamPath\s+REG_\w+\s+(.+)/i.exec(out);
        if (m) candidates.push(path.normalize(m[1].trim()));
      } catch (_) {}
      candidates.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
    } else {
      const home = process.env.HOME || '';
      candidates.push(path.join(home, '.steam', 'steam'), path.join(home, '.local', 'share', 'Steam'), path.join(home, 'Library', 'Application Support', 'Steam'));
    }
    return candidates.find((c) => fs.existsSync(path.join(c, 'userdata'))) || null;
  }

  async _accountName(steam, account) {
    try {
      const vdf = await fsp.readFile(path.join(steam, 'userdata', account, 'config', 'localconfig.vdf'), 'utf8');
      const m = /"PersonaName"\s+"([^"]*)"/.exec(vdf);
      return m ? m[1] : null;
    } catch (_) {
      return null;
    }
  }

  /** All Rocksmith profiles on this PC, newest first. */
  async list() {
    const steam = await this.steamDir();
    if (!steam) return { steam: null, profiles: [] };
    let accounts = [];
    try {
      accounts = (await fsp.readdir(path.join(steam, 'userdata'))).filter((a) => /^\d+$/.test(a));
    } catch (_) {}
    const profiles = [];
    for (const account of accounts) {
      const dir = path.join(steam, 'userdata', account, APP_ID, 'remote');
      let files;
      try {
        files = await fsp.readdir(dir);
      } catch (_) {
        continue;
      }
      const names = {};
      try {
        const lp = rs.decode(await fsp.readFile(path.join(dir, 'LocalProfiles.json')));
        for (const p of JSON.parse(lp.text).Profiles || []) names[String(p.UniqueID).toLowerCase()] = p.PlayerName;
      } catch (_) {}
      const accountName = await this._accountName(steam, account);
      for (const f of files) {
        const m = /^(.+)_PRFLDB$/i.exec(f);
        if (!m) continue;
        const st = await fsp.stat(path.join(dir, f)).catch(() => null);
        if (!st) continue;
        profiles.push({
          id: `${account}/${m[1]}`,
          account,
          accountName,
          uniqueId: m[1],
          name: names[m[1].toLowerCase()] || null,
          file: path.join(dir, f),
          modified: st.mtimeMs,
        });
      }
    }
    profiles.sort((a, b) => b.modified - a.modified);
    return { steam, profiles };
  }

  async current() {
    const { steam, profiles } = await this.list();
    const want = this.settings.get().rocksmith.profile;
    const profile = profiles.find((p) => p.id === want) || profiles[0] || null;
    return { steam, profiles, profile };
  }

  // ------------------------------------------------------------- reading --
  async read() {
    const { steam, profiles, profile } = await this.current();
    const mods = await this.rsmods().catch(() => ({ gameDir: null, installed: false, names: [] }));
    const rsmods = { gameDir: mods.gameDir, installed: mods.installed, iniExists: !!mods.iniExists };
    const names = mods.names.slice(0, rs.MAX_LISTS);
    if (!profile) return { steam, profiles, profile: null, rsmods, names };
    try {
      const buf = await fsp.readFile(profile.file);
      const save = rs.decode(buf);
      const lists = rs.readLists(save.text);
      const st = await fsp.stat(profile.file);
      return { steam, profiles, profile, ...lists, modified: st.mtimeMs, rsmods, names };
    } catch (err) {
      return { steam, profiles, profile, error: err.message, rsmods, names };
    }
  }

  // ------------------------------------------------------------ the game --
  async isGameRunning() {
    if (process.env.STAGEHAND_FAKE_RS_RUNNING) return process.env.STAGEHAND_FAKE_RS_RUNNING === '1';
    try {
      if (IS_WIN) {
        const out = await run('tasklist', ['/FI', 'IMAGENAME eq Rocksmith2014.exe', '/NH', '/FO', 'CSV']);
        return /rocksmith2014\.exe/i.test(out);
      }
      const out = await run('ps', ['-A', '-o', 'comm=']);
      return /rocksmith/i.test(out);
    } catch (_) {
      return false;
    }
  }

  // ------------------------------------------------------------ writing --
  /** Serialises all writes so two quick edits can't interleave. */
  apply(ops) {
    const job = this._queue.then(() => this._apply(ops));
    this._queue = job.catch(() => {});
    return job;
  }

  async _apply(ops) {
    const { profile } = await this.current();
    if (!profile) throw new RsProfileError('No Rocksmith profile was found on this PC.', 'RS_NO_PROFILE');
    if (await this.isGameRunning()) {
      throw new RsProfileError('Close Rocksmith first. Song lists can only be changed while the game is closed.', 'RS_RUNNING');
    }
    const dir = path.dirname(profile.file);
    const original = await fsp.readFile(profile.file);
    const save = rs.decode(original);
    // The writer must reproduce this exact profile before it is trusted with an edit.
    const check = rs.decode(rs.encode(save.header, save.text));
    if (check.text !== save.text || !check.header.equals(save.header)) {
      throw new RsProfileError('Stagehand could not reproduce this profile exactly, so it will not edit it.', 'RS_VERIFY');
    }

    const cur = rs.readLists(save.text);
    const next = { lists: cur.lists.map((l) => l.slice()), favorites: cur.favorites.slice() };
    const touched = { lists: new Set(), favorites: false, count: false };
    let added = 0;
    let removed = 0;
    let createdList = null;
    let removedList = null;
    for (const op of ops) {
      if (op.addList) {
        if (next.lists.length >= rs.MAX_LISTS) throw new RsProfileError(`Rocksmith can have up to ${rs.MAX_LISTS} song lists with RSMods.`, 'RS_MAX_LISTS');
        next.lists.push([]);
        createdList = next.lists.length - 1;
        touched.count = true;
        continue;
      }
      if (op.removeList !== undefined) {
        const i = Number(op.removeList);
        if (i !== next.lists.length - 1 || i < rs.LIST_COUNT) {
          throw new RsProfileError(`Only the last extra song list can be removed, and the game's first ${rs.LIST_COUNT} always stay.`, 'RS_BAD_LIST');
        }
        next.lists.pop();
        removedList = i;
        touched.count = true;
        continue;
      }
      const fav = op.list === 'favorites';
      const idx = fav ? -1 : Number(op.list);
      if (!fav && !(Number.isInteger(idx) && idx >= 0 && idx < next.lists.length)) throw new RsProfileError('That song list doesn’t exist in this profile.', 'RS_BAD_LIST');
      let arr = fav ? next.favorites : next.lists[idx];
      const has = new Set(arr.map((k) => k.toLowerCase()));
      if (op.set) {
        arr = op.set.slice();
      } else {
        if (op.remove) {
          const rm = new Set(op.remove.map((k) => k.toLowerCase()));
          const before = arr.length;
          arr = arr.filter((k) => !rm.has(k.toLowerCase()));
          removed += before - arr.length;
        }
        if (op.add) {
          for (const k of op.add) {
            if (!has.has(k.toLowerCase())) {
              arr.push(k);
              has.add(k.toLowerCase());
              added++;
            }
          }
        }
      }
      if (fav) {
        next.favorites = arr;
        touched.favorites = true;
      } else {
        next.lists[idx] = arr;
        touched.lists.add(idx);
      }
    }

    const patchArg = {};
    if (touched.count) {
      patchArg.count = next.lists.length;
      patchArg.lists = next.lists.map((l, i) => (touched.lists.has(i) || i >= cur.lists.length ? l : undefined));
    } else if (touched.lists.size) patchArg.lists = next.lists.map((l, i) => (touched.lists.has(i) ? l : undefined));
    if (touched.favorites) patchArg.favorites = next.favorites;
    const newText = rs.patchLists(save.text, patchArg);
    if (newText === save.text) {
      return { ...(await this.read()), changed: false, added, removed, backupId: null, createdList, removedList };
    }
    const newBuf = rs.encode(save.header, newText);
    const proof = rs.decode(newBuf);
    if (proof.text !== newText) throw new RsProfileError('The new profile did not read back correctly; nothing was written.', 'RS_VERIFY');

    const backupId = await this._backup(profile, 'before-edit');
    await this._install(profile, newBuf, dir);

    // Read the installed file back from disk one last time.
    const final = rs.readLists(rs.decode(await fsp.readFile(profile.file)).text);
    const want = rs.readLists(newText);
    if (JSON.stringify(final) !== JSON.stringify(want)) {
      await this._restore(backupId, { skipBackup: true });
      throw new RsProfileError('The saved profile did not match what was written, so the backup was put back.', 'RS_VERIFY');
    }
    this.log(`Rocksmith song lists updated in ${profile.file} (+${added} -${removed}); backup ${backupId}`);
    // A removed list's RSMods name would otherwise come back on the next new list.
    if (removedList !== null) {
      const mods = await this.rsmods().catch(() => null);
      if (mods && mods.gameDir && mods.names[removedList]) await this._rename({ [removedList]: '' }).catch((e) => this.log(`Name not reset: ${e.message}`));
    }
    return { ...(await this.read()), changed: true, added, removed, backupId, createdList, removedList };
  }

  /** Writes a profile, then LocalProfiles.json and Steam Cloud metadata. */
  async _install(profile, newBuf, dir) {
    const stagingDir = path.dirname(dir); // .../221680, same disk, outside Steam's synced folder
    const tmp = path.join(stagingDir, `.stagehand-${crypto.randomBytes(4).toString('hex')}.tmp`);
    await fsp.writeFile(tmp, newBuf);
    try {
      await renameWithRetry(tmp, profile.file);
    } catch (err) {
      await fsp.unlink(tmp).catch(() => {});
      throw err;
    }
    const st = await fsp.stat(profile.file);
    const changed = [{ name: path.basename(profile.file), buf: newBuf, mtime: st.mtimeMs / 1000 }];

    const lpPath = path.join(dir, 'LocalProfiles.json');
    try {
      const lpBuf = await fsp.readFile(lpPath);
      const lp = rs.decode(lpBuf);
      const patched = rs.patchLastModified(lp.text, profile.uniqueId, st.mtimeMs / 1000);
      if (patched.changed) {
        const out = rs.encode(lp.header, patched.text);
        if (rs.decode(out).text !== patched.text) throw new Error('LocalProfiles did not read back');
        const t2 = path.join(stagingDir, `.stagehand-${crypto.randomBytes(4).toString('hex')}.tmp`);
        await fsp.writeFile(t2, out);
        await renameWithRetry(t2, lpPath);
        const st2 = await fsp.stat(lpPath);
        changed.push({ name: 'LocalProfiles.json', buf: out, mtime: st2.mtimeMs / 1000 });
      }
    } catch (err) {
      this.log(`LocalProfiles.json not updated: ${err.message}`);
    }

    const vdfPath = path.join(path.dirname(dir), 'remotecache.vdf');
    try {
      let text = await fsp.readFile(vdfPath, 'utf8');
      let any = false;
      for (const c of changed) {
        const r = rs.patchRemoteCache(text, c.name, { size: c.buf.length, sha: sha1(c.buf), mtime: c.mtime });
        text = r.text;
        any = any || r.changed;
      }
      if (any) {
        const t3 = path.join(stagingDir, `.stagehand-${crypto.randomBytes(4).toString('hex')}.tmp`);
        await fsp.writeFile(t3, text);
        await renameWithRetry(t3, vdfPath);
      }
    } catch (err) {
      this.log(`remotecache.vdf not updated: ${err.message}`);
    }
  }

  // ------------------------------------------------------------ backups --
  _backupRoot(profile) {
    return path.join(this.backupDir, profile.account);
  }

  async _backup(profile, reason) {
    const dir = path.dirname(profile.file);
    const id = `${stamp()}_${profile.uniqueId}_${reason}`;
    const dest = path.join(this._backupRoot(profile), id);
    await fsp.mkdir(dest, { recursive: true });
    const files = [profile.file, path.join(dir, 'LocalProfiles.json'), path.join(path.dirname(dir), 'remotecache.vdf')];
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      await fsp.copyFile(f, path.join(dest, path.basename(f)));
      const [a, b] = await Promise.all([fsp.stat(f), fsp.stat(path.join(dest, path.basename(f)))]);
      if (a.size !== b.size) throw new RsProfileError('Backup copy was incomplete; nothing was changed.', 'RS_BACKUP');
    }
    await fsp.writeFile(path.join(dest, 'backup.json'), JSON.stringify({ profileId: profile.id, file: profile.file, reason, at: Date.now() }, null, 1));
    await this._prune(profile);
    return `${profile.account}/${id}`;
  }

  async _prune(profile) {
    const root = this._backupRoot(profile);
    const all = (await fsp.readdir(root).catch(() => [])).filter((d) => d.includes(`_${profile.uniqueId}_`)).sort();
    for (const d of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) await fsp.rm(path.join(root, d), { recursive: true, force: true });
  }

  async backups() {
    const { profile } = await this.current();
    if (!profile) return [];
    const root = this._backupRoot(profile);
    const out = [];
    for (const d of await fsp.readdir(root).catch(() => [])) {
      if (!d.includes(`_${profile.uniqueId}_`)) continue;
      try {
        const meta = JSON.parse(await fsp.readFile(path.join(root, d, 'backup.json'), 'utf8'));
        const save = rs.decode(await fsp.readFile(path.join(root, d, path.basename(profile.file))));
        const l = rs.readLists(save.text);
        out.push({ id: `${profile.account}/${d}`, at: meta.at, reason: meta.reason, counts: { favorites: l.favorites.length, lists: l.lists.map((x) => x.length) } });
      } catch (_) {}
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /** Puts a backed-up profile (and its LocalProfiles.json) back in place. */
  restore(backupId) {
    const job = this._queue.then(() => this._restore(backupId));
    this._queue = job.catch(() => {});
    return job;
  }

  async _restore(backupId, { skipBackup = false } = {}) {
    const { profile } = await this.current();
    if (!profile) throw new RsProfileError('No Rocksmith profile was found on this PC.', 'RS_NO_PROFILE');
    const [account, id] = String(backupId).split('/');
    if (account !== profile.account || !id || id.includes('..') || !id.includes(`_${profile.uniqueId}_`)) throw new RsProfileError('That backup belongs to a different profile.', 'RS_BAD_BACKUP');
    if (await this.isGameRunning()) throw new RsProfileError('Close Rocksmith first, then restore.', 'RS_RUNNING');
    const src = path.join(this._backupRoot(profile), id);
    const buf = await fsp.readFile(path.join(src, path.basename(profile.file)));
    rs.decode(buf); // must be a readable profile
    if (!skipBackup) await this._backup(profile, 'before-restore');
    const dir = path.dirname(profile.file);
    await this._install(profile, buf, dir);
    this.log(`Rocksmith profile restored from ${backupId}`);
    return this.read();
  }
}

module.exports = { RsProfiles, RsProfileError };
