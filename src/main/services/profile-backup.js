'use strict';
/**
 * 4.5: your career is precious. Backups of the files that hold it, recovery from a damaged
 * file, and an integrity check.
 *
 *   <local>/Backups/Career/<YYYY-MM-DD_HHMMSS>-<reason>/{stats.json, levels.json, …, manifest.json}
 *
 * - `auto` backups at most once every 20 hours (at start-up), the newest 15 kept, plus the
 *   first one of each of the last 12 months;
 * - `manual`, `before-*` (made before anything that changes your career on purpose:
 *   a reset, a restore, a migration) and `recovered` ones: the newest 25 kept.
 * - `safeRead(file)`: a file that won't parse is moved aside (never overwritten) as
 *   `<name>.corrupt-<stamp>` and the newest backup copy that does parse takes its place.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const CAREER_FILES = ['stats.json', 'levels.json', 'tones.json', 'greenroom.json', 'settings.json'];
const HOUR = 3600 * 1000;

const stamp = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const cleanReason = (r) => String(r || 'manual').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'manual';

class CareerBackups {
  /**
   * @param {object} o
   * @param {string} o.dataDir where the career files live (roaming)
   * @param {string} o.dir where backups go
   * @param {string} [o.version]
   * @param {Function} [o.log]
   * @param {Function} [o.now]
   */
  constructor({ dataDir, dir, version = '', log = () => {}, now = () => Date.now(), files = CAREER_FILES }) {
    Object.assign(this, { dataDir, dir, version, log, now, files });
  }

  async list() {
    let names = [];
    try {
      names = await fsp.readdir(this.dir);
    } catch (_) {
      return [];
    }
    const out = [];
    for (const name of names) {
      const m = /^(\d{4}-\d{2}-\d{2}_\d{6})-(.+)$/.exec(name);
      if (!m) continue;
      let man = null;
      try {
        man = JSON.parse(await fsp.readFile(path.join(this.dir, name, 'manifest.json'), 'utf8'));
      } catch (_) {}
      out.push({ id: name, reason: m[2], at: (man && man.at) || 0, version: (man && man.version) || '', files: (man && man.files) || {} });
    }
    return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  }

  /** Copies every career file that exists into a new backup folder. Returns its entry. */
  async backup(reason = 'manual') {
    const at = this.now();
    let id = `${stamp(at)}-${cleanReason(reason)}`;
    let n = 1;
    while (fs.existsSync(path.join(this.dir, id))) id = `${stamp(at)}-${cleanReason(reason)}-${++n}`;
    const dest = path.join(this.dir, id);
    await fsp.mkdir(dest, { recursive: true });
    const files = {};
    for (const f of this.files) {
      const src = path.join(this.dataDir, f);
      let buf;
      try {
        buf = await fsp.readFile(src);
      } catch (_) {
        continue;
      }
      await fsp.writeFile(path.join(dest, f), buf);
      const info = { size: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex') };
      if (f === 'stats.json') {
        try {
          const d = JSON.parse(buf.toString('utf8'));
          info.sessions = Array.isArray(d.sessions) ? d.sessions.length : 0;
          if (d.archive && d.archive.count) info.archived = d.archive.count;
        } catch (_) {
          info.unreadable = true;
        }
      }
      files[f] = info;
    }
    const entry = { id, reason: cleanReason(reason), at, version: this.version, files };
    await fsp.writeFile(path.join(dest, 'manifest.json'), JSON.stringify(entry, null, 1));
    this.log(`Career backup: ${id} (${Object.keys(files).length} files)`);
    await this.prune().catch((e) => this.log(`Career backups: tidy failed: ${e.message}`));
    return entry;
  }

  /** At start-up: a backup unless there's one from the last 20 hours. */
  async auto() {
    const l = await this.list();
    const last = l.find((b) => b.reason === 'auto');
    if (last && this.now() - last.at < 20 * HOUR) return null;
    return this.backup('auto');
  }

  async prune() {
    const l = await this.list();
    const keep = new Set();
    const autos = l.filter((b) => b.reason === 'auto');
    autos.slice(0, 15).forEach((b) => keep.add(b.id));
    // the first auto backup of each month, for a year
    const months = new Map();
    for (const b of [...autos].reverse()) {
      const d = new Date(b.at);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (!months.has(k)) months.set(k, b.id);
    }
    [...months.values()].slice(-12).forEach((id) => keep.add(id));
    l.filter((b) => b.reason !== 'auto').slice(0, 25).forEach((b) => keep.add(b.id));
    for (const b of l) if (!keep.has(b.id)) await fsp.rm(path.join(this.dir, b.id), { recursive: true, force: true });
  }

  /**
   * Puts a backup's files back (a `before-restore` backup is made first, so it can be undone).
   * @param {string} id
   * @param {string[]} [only] just these files
   */
  async restore(id, only = null) {
    const src = path.join(this.dir, path.basename(String(id)));
    if (!fs.existsSync(src)) throw new Error('That backup isn’t there anymore');
    const names = (await fsp.readdir(src)).filter((f) => this.files.includes(f) && (!only || only.includes(f)));
    if (!names.length) throw new Error('That backup has no career files in it');
    // every file must read before anything is replaced
    for (const f of names) JSON.parse(await fsp.readFile(path.join(src, f), 'utf8'));
    const before = await this.backup('before-restore');
    for (const f of names) {
      const tmp = path.join(this.dataDir, `${f}.${crypto.randomBytes(3).toString('hex')}.tmp`);
      await fsp.copyFile(path.join(src, f), tmp);
      await fsp.rename(tmp, path.join(this.dataDir, f));
    }
    this.log(`Career restored from ${id}: ${names.join(', ')}`);
    return { restored: names, undo: before.id };
  }

  /**
   * Reads a JSON career file. When it exists but won't parse, it's moved aside and the newest
   * readable backup copy is put in its place. Returns { data, recovered, corrupt }.
   */
  async safeRead(file, fallback = null) {
    let text;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch (_) {
      return { data: fallback, recovered: null, corrupt: null, missing: true };
    }
    try {
      return { data: JSON.parse(text), recovered: null, corrupt: null };
    } catch (_) {}
    const name = path.basename(file);
    const corrupt = `${file}.corrupt-${stamp(this.now())}`;
    await fsp.rename(file, corrupt).catch(() => {});
    this.log(`${name} couldn’t be read; kept it as ${path.basename(corrupt)}`);
    for (const b of await this.list()) {
      const p = path.join(this.dir, b.id, name);
      try {
        const data = JSON.parse(await fsp.readFile(p, 'utf8'));
        await fsp.copyFile(p, file);
        this.log(`${name} recovered from the backup ${b.id}`);
        return { data, recovered: b.id, corrupt };
      } catch (_) {}
    }
    return { data: fallback, recovered: null, corrupt };
  }

  /** Checks the career files: each one reads, sessions look sane, no duplicates, backups exist. */
  async integrity({ sessions = null } = {}) {
    const checks = [];
    const add = (ok, what, detail = '') => checks.push({ ok: !!ok, what, detail });
    for (const f of this.files) {
      const p = path.join(this.dataDir, f);
      if (!fs.existsSync(p)) {
        add(f !== 'stats.json' && f !== 'levels.json', `${f} exists`, 'not there yet');
        continue;
      }
      try {
        JSON.parse(await fsp.readFile(p, 'utf8'));
        add(true, `${f} reads`);
      } catch (e) {
        add(false, `${f} reads`, e.message);
      }
    }
    if (sessions) {
      const bad = sessions.filter((s) => !s || !(Number(s.at) > 0) || !(Number(s.seconds) >= 0) || (s.accuracy !== null && s.accuracy !== undefined && !(s.accuracy >= 0 && s.accuracy <= 1)));
      add(!bad.length, 'Every session is well formed', bad.length ? `${bad.length} odd sessions` : `${sessions.length} sessions`);
      const seen = new Set();
      let dupes = 0;
      for (const s of sessions) {
        const k = `${s.at}|${s.songId}|${s.part}|${s.seconds}`;
        if (seen.has(k)) dupes++;
        seen.add(k);
      }
      add(!dupes, 'No session counted twice', dupes ? `${dupes} duplicates` : '');
      const future = sessions.filter((s) => s.at > this.now() + 24 * HOUR).length;
      add(!future, 'No sessions dated in the future', future ? `${future} sessions` : '');
    }
    const l = await this.list();
    add(l.length > 0, 'There is at least one backup', l.length ? `${l.length} backups, newest ${new Date(l[0].at).toLocaleString()}` : 'none yet');
    return { ok: checks.every((c) => c.ok), checks };
  }
}

module.exports = { CareerBackups, CAREER_FILES, stamp };
