'use strict';
/**
 * Updates (4.1.4): Stagehand looks for a newer release on GitHub, downloads its
 * Setup, checks it, and runs it with /update: Setup closes Stagehand, copies the
 * new files (a few seconds: the runtime and decoder are already there) and opens
 * Stagehand again. Nothing is installed without you pressing Update.
 *
 * The release page's Setup is the same one people download by hand, so an update
 * is exactly a normal install. Checked against the size and SHA-256 GitHub lists
 * for the file; a download that doesn't match is thrown away.
 *
 * Node built-ins only.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const REPO = 'DrNoisewater/Stagehand';
const SETUP_RE = /^Stagehand-Setup-(\d+\.\d+\.\d+)\.exe$/i;

/** -1, 0 or 1: "4.1.10" is newer than "4.1.9". */
function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** What's new, from the release notes: the lines under "What's Changed", without links. */
function notesFrom(body) {
  const text = String(body || '');
  const part = text.includes("## What's Changed") ? text.split("## What's Changed")[1] : '';
  return part
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[*-] /.test(l))
    .map((l) => l.replace(/^[*-] /, '').replace(/ by @\S+ in https?:\/\/\S+$/, '').replace(/^Stagehand \d+\.\d+\.\d+:\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

class Updates extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.current this Stagehand's version
   * @param {string} o.dir where downloaded Setups are kept
   * @param {Function} o.fetchImpl fetch (follows redirects; streams)
   * @param {Function} [o.spawnImpl] child_process.spawn (tests pass a stand-in)
   */
  constructor({ current, dir, fetchImpl, spawnImpl, log, repo = REPO, platform = process.platform }) {
    super();
    Object.assign(this, { current, dir, fetch: fetchImpl || fetch, spawn: spawnImpl || require('child_process').spawn, log: log || (() => {}), repo, platform });
    this.latest = null; // { version, url, size, sha256, page, notes }
    this.checkedAt = 0;
    this.busy = null;
  }

  state() {
    const l = this.latest;
    return {
      current: this.current,
      latest: l ? l.version : null,
      available: !!(l && compareVersions(l.version, this.current) > 0),
      canInstall: this.platform === 'win32',
      notes: l ? l.notes : [],
      page: l ? l.page : `https://github.com/${this.repo}/releases/latest`,
      size: l ? l.size : 0,
      checkedAt: this.checkedAt,
    };
  }

  /** Asks GitHub for the newest release. Never throws for "no internet": says so. */
  async check() {
    try {
      const res = await this.fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Stagehand' } });
      if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? 'GitHub is busy. Try again in a while.' : `GitHub answered ${res.status}`);
      const r = await res.json();
      const asset = (r.assets || []).find((a) => SETUP_RE.test(a.name || ''));
      const version = asset ? SETUP_RE.exec(asset.name)[1] : String(r.tag_name || '').replace(/^v/i, '');
      const sha = /^sha256:([0-9a-f]{64})$/i.exec(String((asset && asset.digest) || ''));
      this.latest = { version, url: asset ? asset.browser_download_url : null, name: asset ? asset.name : null, size: asset ? Number(asset.size) || 0 : 0, sha256: sha ? sha[1].toLowerCase() : null, page: r.html_url || `https://github.com/${this.repo}/releases/latest`, notes: notesFrom(r.body) };
      this.checkedAt = Date.now();
      const st = this.state();
      this.log(`Updates: newest is ${version}${st.available ? ' (newer than this one)' : ''}`);
      this.emit('change', st);
      return st;
    } catch (err) {
      this.log(`Updates: couldn't check: ${err.message}`);
      return { ...this.state(), error: /fetch failed|ENOTFOUND|ECONN|network/i.test(err.message) ? 'Couldn’t reach GitHub. Check your internet connection.' : err.message };
    }
  }

  /** Downloads the newest Setup (or reuses one already here) and checks it. → its path */
  async download(onProgress = () => {}) {
    if (this.busy) return this.busy;
    this.busy = this._download(onProgress).finally(() => (this.busy = null));
    return this.busy;
  }

  async _download(onProgress) {
    const l = this.latest;
    if (!l || !l.url) throw new Error('There’s no update to download. Check again.');
    await fsp.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, l.name);
    if (await this._good(file, l)) return file;
    const part = `${file}.part`;
    const res = await this.fetch(l.url, { headers: { 'User-Agent': 'Stagehand' } });
    if (!res.ok || !res.body) throw new Error(`The download didn’t start (GitHub answered ${res.status}). Try again.`);
    const total = Number(res.headers.get('content-length')) || l.size || 0;
    const out = fs.createWriteStream(part);
    const hash = crypto.createHash('sha256');
    let got = 0;
    try {
      for await (const chunk of res.body) {
        const b = Buffer.from(chunk);
        hash.update(b);
        got += b.length;
        if (!out.write(b)) await new Promise((r) => out.once('drain', r));
        onProgress(total ? got / total : 0, got, total);
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    } catch (err) {
      out.destroy();
      await fsp.rm(part, { force: true });
      throw new Error(`The download stopped: ${err.message}. Try again.`);
    }
    const sum = hash.digest('hex');
    if ((l.size && got !== l.size) || (l.sha256 && sum !== l.sha256)) {
      await fsp.rm(part, { force: true });
      this.log(`Updates: download didn't match (${got} bytes, ${sum})`);
      throw new Error('The download came through damaged, so it was thrown away. Try again.');
    }
    await fsp.rename(part, file);
    this.log(`Updates: downloaded ${l.name} (${got} bytes, checked)`);
    return file;
  }

  async _good(file, l) {
    try {
      const st = await fsp.stat(file);
      if (l.size && st.size !== l.size) return false;
      if (!l.sha256) return true;
      const sum = crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
      return sum === l.sha256;
    } catch (_) {
      return false;
    }
  }

  /** Runs the downloaded Setup with /update, on its own (it outlives Stagehand, which it closes). */
  install(file) {
    if (this.platform !== 'win32') throw new Error('Updating by itself works on Windows only.');
    const child = this.spawn(file, ['/update'], { detached: true, stdio: 'ignore', windowsHide: false });
    if (child && child.unref) child.unref();
    this.log(`Updates: started ${path.basename(file)} /update`);
    return true;
  }

  /** Old downloaded Setups (not the newest) are deleted. */
  async tidy() {
    try {
      const keep = this.latest && this.latest.name;
      for (const f of await fsp.readdir(this.dir)) if (SETUP_RE.test(f.replace(/\.part$/, '')) && f !== keep) await fsp.rm(path.join(this.dir, f), { force: true });
    } catch (_) {}
  }
}

module.exports = { Updates, compareVersions, notesFrom, REPO };
