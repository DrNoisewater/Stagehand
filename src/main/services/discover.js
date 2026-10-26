'use strict';
/**
 * Discover: search MusicBrainz, compare artists' discographies with the
 * library, track wanted songs, and hand searches to CustomsForge in the
 * user's own browser (Stagehand never queries CustomsForge itself: its
 * rules forbid unapproved bots and scrapers).
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');
const discog = require('../core/discog');
const { readJson, writeJsonAtomic } = require('../core/files');

const CHECK_TTL = 1000 * 60 * 60 * 24 * 30;
const IGNITION = 'https://ignition4.customsforge.com/';

class Discover extends EventEmitter {
  constructor({ file, mb, library, log = () => {} }) {
    super();
    this.file = file;
    this.mb = mb;
    this.library = library;
    this.log = log;
    this.data = { wanted: [], gaps: {}, recent: [] };
    this.gapJob = null;
    this._saveTimer = null;
  }

  async load() {
    const d = await readJson(this.file, null);
    if (d) this.data = { ...this.data, ...d };
    return this;
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save().catch(() => {}), 300);
  }

  async save() {
    clearTimeout(this._saveTimer);
    await writeJsonAtomic(this.file, this.data);
  }

  // -------------------------------------------------------------- library --
  _songs() {
    return Object.values(this.library.data.songs);
  }

  /** normArtist -> { name, songs[] } */
  _byArtist() {
    const m = new Map();
    for (const s of this._songs()) {
      const k = discog.normArtist(s.artist);
      if (!k) continue;
      if (!m.has(k)) m.set(k, { name: s.artist, songs: [] });
      m.get(k).songs.push(s);
    }
    return m;
  }

  _owned(artist, title) {
    const a = this._byArtist().get(discog.normArtist(artist));
    if (!a) return null;
    const t = discog.normTitle(title);
    return a.songs.find((s) => discog.normTitle(s.title) === t) || null;
  }

  _wantedKey(artist, title) {
    return `${discog.normArtist(artist)}|${discog.normTitle(title)}`;
  }

  _wantedMap() {
    return new Map(this.data.wanted.map((w) => [this._wantedKey(w.artist, w.title), w]));
  }

  // --------------------------------------------------------------- search --
  async search(query) {
    const q = String(query || '').trim();
    if (!q) return { query: q, artists: [], songs: [] };
    this.data.recent = [q, ...this.data.recent.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    this.saveSoon();
    const byArtist = this._byArtist();
    const artists = (await this.mb.searchArtist(q)).slice(0, 6).map((a) => {
      const own = byArtist.get(discog.normArtist(a.name));
      const gap = this.data.gaps[discog.normArtist(a.name)];
      return { ...a, owned: own ? own.songs.length : 0, gap: gap && gap.mbid === a.id ? gap : null };
    });
    // "artist - title" or "title by artist" narrows the song search.
    let text = q;
    let artist = null;
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(q) || /^(.+?)\s+by\s+(.+)$/i.exec(q);
    if (m) {
      if (/\sby\s/i.test(q)) {
        text = m[1];
        artist = m[2];
      } else {
        artist = m[1];
        text = m[2];
      }
    }
    let songs = await this.mb.searchRecordings(text, artist);
    if (!songs.length && artist) songs = await this.mb.searchRecordings(q);
    const wanted = this._wantedMap();
    songs = songs.slice(0, 30).map((s) => {
      const own = this._owned(s.artist, s.title);
      const w = wanted.get(this._wantedKey(s.artist, s.title));
      return { ...s, songId: own ? own.id : null, have: !!own, wanted: !!(w && w.status === 'wanted') };
    });
    return { query: q, artists, songs };
  }

  // --------------------------------------------------------------- artist --
  async resolveArtist(name) {
    const list = await this.mb.searchArtist(name);
    const exact = list.filter((a) => a.exact);
    if (exact.length === 1 || (exact.length && exact[0].score >= 95)) return { match: exact[0], options: list };
    return { match: null, options: list };
  }

  /** Full artist page: albums with owned / wanted / missing tracks. */
  async artist({ id, name, fresh = false }) {
    let info = null;
    if (!id) {
      const known = this.data.gaps[discog.normArtist(name)];
      if (known && known.mbid) id = known.mbid;
      else {
        const r = await this.resolveArtist(name);
        if (!r.match) return { needsChoice: true, options: r.options, name };
        info = r.match;
        id = info.id;
      }
    }
    if (!info) info = (await this.mb.artistInfo(id).catch(() => null)) || { id, name: name || 'Artist', disambiguation: '', country: '', type: '' };
    const albums = await this.mb.discography(id, (done, total, title) => this.emit('progress', { kind: 'artist', id, done, total, title }), { fresh });
    // Library songs credited to this artist (MusicBrainz name or the name the user clicked).
    const keys = new Set([discog.normArtist(info.name), discog.normArtist(name)].filter(Boolean));
    const songs = this._songs().filter((s) => keys.has(discog.normArtist(s.artist)));
    const cmp = discog.compare(albums, songs);
    const wanted = this._wantedMap();
    for (const a of cmp.albums) {
      for (const t of a.tracks) {
        const w = wanted.get(this._wantedKey(info.name, t.title));
        t.wanted = !!(w && w.status === 'wanted');
      }
    }
    this._recordGap(info, cmp, name);
    return {
      artist: { id: info.id, name: info.name, disambiguation: info.disambiguation, country: info.country, type: info.type },
      albums: cmp.albums,
      total: cmp.total,
      have: cmp.have,
      missing: cmp.missing,
      extras: cmp.extras.map((s) => ({ id: s.id, title: s.title, album: s.album, year: s.year })),
      skipped: albums.filter((a) => a.error).map((a) => a.title),
    };
  }

  _recordGap(info, cmp, libraryName) {
    const k = discog.normArtist(libraryName || info.name);
    this.data.gaps[k] = {
      name: libraryName || info.name,
      mbid: info.id,
      mbName: info.name,
      total: cmp.total,
      have: cmp.have,
      missing: cmp.missing,
      albums: cmp.albums.length,
      checkedAt: Date.now(),
      status: 'ok',
    };
    this.saveSoon();
  }

  // ----------------------------------------------------------------- gaps --
  gaps() {
    const out = [];
    for (const [k, a] of this._byArtist()) {
      const g = this.data.gaps[k];
      out.push({ key: k, name: a.name, owned: a.songs.length, ...(g || {}), status: g ? g.status : 'unchecked' });
    }
    return { artists: out, running: this.gapJob ? { done: this.gapJob.done, total: this.gapJob.total, current: this.gapJob.current } : null };
  }

  checkGaps({ keys = null, fresh = false } = {}) {
    if (this.gapJob) return this.gaps();
    const all = [...this._byArtist().entries()].filter(([k]) => !keys || keys.includes(k));
    const todo = all.filter(([k]) => {
      const g = this.data.gaps[k];
      return fresh || keys || !g || Date.now() - g.checkedAt > CHECK_TTL || g.status !== 'ok';
    });
    const job = { done: 0, total: todo.length, current: '', cancelled: false };
    this.gapJob = job;
    (async () => {
      for (const [k, a] of todo) {
        if (job.cancelled) break;
        job.current = a.name;
        this.emit('gaps', this.gaps());
        try {
          // Once an artist is matched (or the user picked one), keep using that MusicBrainz id.
          const known = this.data.gaps[k];
          const r = known && known.mbid ? { match: { id: known.mbid, name: known.mbName || a.name } } : await this.resolveArtist(a.name);
          if (!r.match) {
            this.data.gaps[k] = { name: a.name, status: r.options.length ? 'ambiguous' : 'not-found', checkedAt: Date.now(), options: r.options.slice(0, 5).map((o) => ({ id: o.id, name: o.name, disambiguation: o.disambiguation, country: o.country })) };
          } else {
            const albums = await this.mb.discography(r.match.id, (done, total, title) => this.emit('progress', { kind: 'gaps', artist: a.name, done, total, title }), { fresh });
            this._recordGap(r.match, discog.compare(albums, a.songs), a.name);
          }
        } catch (err) {
          this.data.gaps[k] = { name: a.name, status: 'error', error: err.message, checkedAt: Date.now() };
        }
        job.done++;
        this.saveSoon();
        this.emit('gaps', this.gaps());
      }
      this.gapJob = null;
      this.emit('gaps', this.gaps());
    })();
    return this.gaps();
  }

  cancelGaps() {
    if (this.gapJob) this.gapJob.cancelled = true;
  }

  // --------------------------------------------------------------- wanted --
  wanted() {
    // Anything that has since arrived in the library counts as found.
    let changed = false;
    for (const w of this.data.wanted) {
      if (w.status !== 'wanted') continue;
      const own = this._owned(w.artist, w.title);
      if (own) {
        Object.assign(w, { status: 'found', foundAt: Date.now(), songId: own.id });
        changed = true;
      }
    }
    if (changed) this.saveSoon();
    return this.data.wanted;
  }

  addWanted(items) {
    const have = this._wantedMap();
    const added = [];
    for (const it of items) {
      if (!it || !it.title || !it.artist) continue;
      const key = this._wantedKey(it.artist, it.title);
      const prev = have.get(key);
      if (prev && prev.status === 'wanted') continue;
      if (prev) this.data.wanted = this.data.wanted.filter((w) => w !== prev);
      const own = this._owned(it.artist, it.title);
      const w = {
        id: crypto.randomBytes(5).toString('hex'),
        artist: String(it.artist).slice(0, 200),
        title: String(it.title).slice(0, 200),
        album: it.album ? String(it.album).slice(0, 200) : '',
        year: Number(it.year) || null,
        addedAt: Date.now(),
        status: own ? 'found' : 'wanted',
        songId: own ? own.id : null,
      };
      this.data.wanted.push(w);
      have.set(key, w);
      added.push(w);
    }
    this.saveSoon();
    return { added: added.length, wanted: this.wanted() };
  }

  removeWanted(ids) {
    const set = new Set(ids);
    this.data.wanted = this.data.wanted.filter((w) => !set.has(w.id));
    this.saveSoon();
    return this.wanted();
  }

  clearFound() {
    this.data.wanted = this.data.wanted.filter((w) => w.status === 'wanted');
    this.saveSoon();
    return this.wanted();
  }

  /** Called by the importer for each new song. Returns the wanted entries it satisfied. */
  markFound(song) {
    const key = this._wantedKey(song.artist, song.title);
    const hits = this.data.wanted.filter((w) => w.status === 'wanted' && this._wantedKey(w.artist, w.title) === key);
    for (const w of hits) Object.assign(w, { status: 'found', foundAt: Date.now(), songId: song.id || null });
    if (hits.length) this.saveSoon();
    return hits;
  }

  /** An import was undone: those songs are wanted again. */
  unmarkFound(ids = []) {
    const set = new Set(ids);
    for (const w of this.data.wanted) if (set.has(w.id)) Object.assign(w, { status: 'wanted', foundAt: null, songId: null });
    if (set.size) this.saveSoon();
  }

  // -------------------------------------------------------- CustomsForge --
  ignitionUrl() {
    return IGNITION;
  }
}

module.exports = { Discover, IGNITION };
