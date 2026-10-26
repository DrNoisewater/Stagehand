'use strict';
/**
 * MusicBrainz client: one request per second (their rule), identified by a
 * User-Agent, results cached on disk for 30 days.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const discog = require('../core/discog');

const BASE = 'https://musicbrainz.org/ws/2';
const TTL = 1000 * 60 * 60 * 24 * 30;
const GAP = 1100;

class MusicBrainz {
  constructor({ cacheDir, fetchImpl, userAgent, log = () => {} }) {
    this.dir = cacheDir;
    this.fetch = fetchImpl;
    this.ua = userAgent;
    this.log = log;
    this.next = 0;
    this.chain = Promise.resolve();
    this.fixtures = process.env.STAGEHAND_MB_FIXTURES || null; // tests: serve JSON from a folder
  }

  _cacheFile(url) {
    return path.join(this.dir, `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 24)}.json`);
  }

  /** Test fixtures: artist-search_<name>, recording-search_<query>, release-groups_<artist>, releases_<group>. */
  async _fixture(url) {
    const u = new URL(url);
    const p = u.searchParams;
    const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let key;
    const lookup = /\/artist\/([0-9a-f-]{36})$/.exec(u.pathname);
    if (lookup) key = `artist_${lookup[1]}`;
    else if (u.pathname.endsWith('/artist')) key = `artist-search_${slug(p.get('query').replace(/^artist:/, ''))}`;
    else if (u.pathname.endsWith('/recording')) key = `recording-search_${slug(p.get('query'))}`;
    else if (u.pathname.endsWith('/release-group')) key = `release-groups_${p.get('artist')}`;
    else if (u.pathname.endsWith('/release')) key = `releases_${p.get('release-group')}`;
    else key = slug(u.pathname);
    const file = path.join(this.fixtures, `${key}.json`);
    if (!fs.existsSync(file)) {
      if (key.startsWith('artist-search') || key.startsWith('recording-search')) return { artists: [], recordings: [] };
      throw new Error(`MusicBrainz has no data for that (${key})`);
    }
    await new Promise((r) => setTimeout(r, 120)); // feel like the network
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  }

  /** GET with cache + global 1 request/second spacing. */
  get(url, { fresh = false } = {}) {
    const job = this.chain.then(() => this._get(url, fresh));
    this.chain = job.catch(() => {});
    return job;
  }

  async _get(url, fresh) {
    if (this.fixtures) return this._fixture(url);
    const file = this._cacheFile(url);
    if (!fresh) {
      try {
        const c = JSON.parse(await fsp.readFile(file, 'utf8'));
        if (Date.now() - c.at < TTL) return c.data;
      } catch (_) {}
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = this.next - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.next = Date.now() + GAP;
      let res;
      try {
        res = await this.fetch(url, { headers: { 'User-Agent': this.ua, Accept: 'application/json' } });
      } catch (err) {
        if (attempt === 2) throw new Error('MusicBrainz could not be reached. Check your internet connection.');
        continue;
      }
      if (res.status === 503 || res.status === 429) {
        this.next = Date.now() + 3000 * (attempt + 1); // asked to slow down
        continue;
      }
      if (!res.ok) throw new Error(`MusicBrainz answered ${res.status}`);
      const data = await res.json();
      await fsp.mkdir(this.dir, { recursive: true });
      await fsp.writeFile(file, JSON.stringify({ at: Date.now(), url, data })).catch(() => {});
      return data;
    }
    throw new Error('MusicBrainz is busy right now. Try again in a minute.');
  }

  /** Free-text song search. Returns [{id,title,artist,artistId,album,albumId,year,length}]. */
  async searchRecordings(text, artist = null) {
    const clean = (x) => String(x).replace(/["\\]/g, ' ').trim();
    let q = `recording:"${clean(text)}"`;
    if (artist) q += ` AND artist:"${clean(artist)}"`;
    q += ' AND status:official';
    const json = await this.get(`${BASE}/recording?query=${encodeURIComponent(q)}&limit=40&fmt=json`);
    return discog.recordingsFrom(json);
  }

  async artistInfo(id) {
    const a = await this.get(`${BASE}/artist/${id}?fmt=json`);
    return { id: a.id, name: a.name, disambiguation: a.disambiguation || '', country: a.country || '', type: a.type || '', lifeSpan: a['life-span'] || null };
  }

  async searchArtist(name) {
    const q = encodeURIComponent(`artist:"${String(name).replace(/"/g, '')}"`);
    return discog.pickArtists(await this.get(`${BASE}/artist?query=${q}&limit=8&fmt=json`), name);
  }

  /**
   * Studio albums and EPs with tracklists. `progress(done, total, title)`
   * is called as each album is read.
   */
  async discography(artistId, progress = () => {}, { fresh = false } = {}) {
    let groups = [];
    for (let offset = 0; offset < 400; offset += 100) {
      const page = await this.get(`${BASE}/release-group?artist=${artistId}&type=album|ep&limit=100&offset=${offset}&fmt=json`, { fresh });
      groups = groups.concat(page['release-groups'] || []);
      if ((page['release-groups'] || []).length < 100) break;
    }
    const albums = discog.albumsFrom({ 'release-groups': groups });
    const out = [];
    for (let i = 0; i < albums.length; i++) {
      const a = albums[i];
      progress(i, albums.length, a.title);
      try {
        const rel = await this.get(`${BASE}/release?release-group=${a.id}&status=official&inc=recordings&limit=100&fmt=json`, { fresh });
        out.push({ ...a, tracks: discog.tracksFrom(rel) });
      } catch (err) {
        this.log(`MusicBrainz: skipped ${a.title}: ${err.message}`);
        out.push({ ...a, tracks: [], error: err.message });
      }
    }
    progress(albums.length, albums.length, '');
    return out;
  }
}

module.exports = { MusicBrainz, BASE };
