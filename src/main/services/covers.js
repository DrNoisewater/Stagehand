'use strict';
/**
 * Album covers from the Cover Art Archive (the artwork side of MusicBrainz),
 * fetched once, kept on disk, and served to the page as stagehand://cover/<id>
 * so the window never talks to the internet directly.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MISS_TTL = 1000 * 60 * 60 * 24 * 7;

class Covers {
  constructor({ dir, fetchImpl, userAgent, log = () => {} }) {
    this.dir = dir;
    this.fetch = fetchImpl;
    this.ua = userAgent;
    this.log = log;
    this.active = 0;
    this.waiters = [];
    this.inflight = new Map();
    this.fixtures = process.env.STAGEHAND_MB_FIXTURES || null;
  }

  async _slot() {
    if (this.active < 4) {
      this.active++;
      return;
    }
    await new Promise((r) => this.waiters.push(r));
    this.active++;
  }

  _release() {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  /** Path of the cached cover for a release group, or null if it has none. */
  file(groupId, size = 250) {
    if (!/^[0-9a-f-]{36}$/i.test(groupId)) return Promise.resolve(null);
    const px = size > 250 ? 500 : 250;
    const key = `${groupId}-${px}`;
    if (!this.inflight.has(key)) {
      const job = this._file(groupId, px, key).finally(() => this.inflight.delete(key));
      this.inflight.set(key, job);
    }
    return this.inflight.get(key);
  }

  async _file(groupId, px, key) {
    if (this.fixtures) {
      const fx = path.join(this.fixtures, `cover_${groupId}.jpg`);
      return fs.existsSync(fx) ? fx : null;
    }
    const file = path.join(this.dir, `${key}.img`);
    const miss = path.join(this.dir, `${key}.none`);
    if (fs.existsSync(file)) return file;
    try {
      if (Date.now() - (await fsp.stat(miss)).mtimeMs < MISS_TTL) return null;
    } catch (_) {}
    await this._slot();
    try {
      const res = await this.fetch(`https://coverartarchive.org/release-group/${groupId}/front-${px}`, { headers: { 'User-Agent': this.ua } });
      if (res.status === 404) {
        await fsp.mkdir(this.dir, { recursive: true });
        await fsp.writeFile(miss, '');
        return null;
      }
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 64) return null;
      await fsp.mkdir(this.dir, { recursive: true });
      const tmp = `${file}.${crypto.randomBytes(3).toString('hex')}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, file);
      return file;
    } catch (err) {
      this.log(`Cover for ${groupId} failed: ${err.message}`);
      return null;
    } finally {
      this._release();
    }
  }
}

/** Content type from the first bytes. */
function imageType(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return 'image/jpeg';
}

module.exports = { Covers, imageType };
