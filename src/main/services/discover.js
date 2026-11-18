'use strict';
/**
 * Discover: search MusicBrainz, compare artists' discographies with the
 * library, track wanted songs, and hand searches to CustomsForge (4.12: in
 * the song finder window, finder.js, or the user's own browser). Stagehand
 * never reads CustomsForge's pages or downloads from it by itself: its rules
 * forbid unapproved bots and scrapers.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');
const discog = require('../core/discog');
const { readJson, writeJsonAtomic } = require('../core/files');
const { OfficialList, norm: officialNorm } = require('./officiallist');
const officialRequest = require('./officialrequest');

const CHECK_TTL = 1000 * 60 * 60 * 24 * 30;
const IGNITION = 'https://ignition4.customsforge.com/';

class Discover extends EventEmitter {
  constructor({ file, mb, library, log = () => {}, official = null, post = null, now = () => Date.now() }) {
    super();
    this.file = file;
    this.mb = mb;
    this.library = library;
    this.log = log;
    // 4.25: official (paid) DLC can't be downloaded: never wanted, asked for instead
    this.officialList = official || new OfficialList();
    this.post = post; // (tests: a pretend HTTPS post for the request)
    this.now = now;
    // wanted items: status 'wanted' | 'found' | 'unavailable' (4.25) | 'official' (4.25)
    this.data = { wanted: [], gaps: {}, recent: [], updates: [], updatesDone: {}, lastRequestAt: 0, requestContact: '' };
    this.gapJob = null;
    this._saveTimer = null;
  }

  async load() {
    const d = await readJson(this.file, null);
    if (d) this.data = { ...this.data, ...d };
    if (!Array.isArray(this.data.updates)) this.data.updates = [];
    if (!this.data.updatesDone || typeof this.data.updatesDone !== 'object') this.data.updatesDone = {};
    // 4.25: songs on the official DLC list can't be downloaded: they move to Official DLC
    let moved = 0;
    for (const w of this.data.wanted) {
      if (w.status === 'wanted' && this.officialList.has(w.artist, w.title)) {
        w.status = 'official';
        w.officialAt = this.now();
        moved++;
      }
    }
    if (moved) {
      this.log(`Discover: ${moved} wanted songs are official DLC, moved to Official DLC`);
      this.saveSoon();
    }
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
      return { ...s, songId: own ? own.id : null, have: !!own, wanted: !!(w && w.status === 'wanted'), official: !own && this.isOfficialSong(s.artist, s.title), unavailable: !!(w && w.status === 'unavailable') };
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
        t.unavailable = !!(w && w.status === 'unavailable');
        t.official = !t.have && this.isOfficialSong(info.name, t.title);
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
      if (w.status === 'found') continue;
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
    const official = [];
    for (const it of items) {
      if (!it || !it.title || !it.artist) continue;
      const key = this._wantedKey(it.artist, it.title);
      const prev = have.get(key);
      if (prev && prev.status === 'wanted') continue;
      // 4.25: official DLC can't be downloaded, so it can't be wanted (it's asked for on Official DLC)
      if (!this._owned(it.artist, it.title) && this.isOfficialSong(it.artist, it.title)) {
        official.push({ artist: String(it.artist).slice(0, 200), title: String(it.title).slice(0, 200) });
        continue;
      }
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
    return { added: added.length, official: official.length, officialSongs: official, wanted: this.wanted() };
  }

  removeWanted(ids) {
    const set = new Set(ids);
    this.data.wanted = this.data.wanted.filter((w) => !set.has(w.id));
    this.saveSoon();
    return this.wanted();
  }

  clearFound() {
    this.data.wanted = this.data.wanted.filter((w) => w.status !== 'found');
    this.saveSoon();
    return this.wanted();
  }

  /** Called by the importer for each new song. Returns the wanted entries it satisfied. */
  markFound(song) {
    const key = this._wantedKey(song.artist, song.title);
    // (a song marked Not available or Official that turns up after all counts too)
    const hits = this.data.wanted.filter((w) => w.status !== 'found' && this._wantedKey(w.artist, w.title) === key);
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

  /**
   * 4.25: move songs between Wanted, Not available (nothing on CustomsForge) and Official DLC.
   * Not available keeps when and how many times; back to Wanted keeps the count. A song on the
   * official list can't go back to Wanted.
   */
  setStatus(ids, status) {
    if (!['wanted', 'unavailable', 'official'].includes(status)) throw new Error('Unknown status');
    const set = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
    let refused = 0;
    for (const w of this.data.wanted) {
      if (!set.has(w.id) || w.status === 'found') continue;
      if (status === 'wanted' && this.officialList.has(w.artist, w.title)) {
        refused++;
        continue;
      }
      if (status === 'unavailable') {
        w.tries = (Number(w.tries) || 0) + 1;
        w.unavailableAt = this.now();
      }
      if (status === 'official') w.officialAt = this.now();
      if (status === 'wanted') w.retriedAt = this.now();
      w.status = status;
    }
    if (refused) this.log(`Discover: ${refused} official songs stay on Official DLC`);
    this.saveSoon();
    return this.wanted();
  }

  /** On the official DLC list (and not in the library)? */
  isOfficialSong(artist, title) {
    return this.officialList.has(artist, title);
  }

  // ---------------------------------------------------------- official --
  /** Library songs by loose title, for the official list (the same loose names it uses). */
  _ownedOfficial() {
    const byTitle = new Map();
    for (const s of this._songs()) {
      const k = officialNorm(s.title);
      if (!k) continue;
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k).push(officialNorm(s.artist));
    }
    return (artist, title) => {
      const as = byTitle.get(officialNorm(title));
      const a = officialNorm(artist);
      if (!as || !a) return false;
      return as.some((x) => x === a || (Math.min(x.length, a.length) >= 4 && (x.includes(a) || a.includes(x))));
    };
  }

  /**
   * Official DLC the player doesn't have: every song on the list that isn't in the library,
   * plus songs the finder found only as official (status 'official'). With when the next
   * request can go out.
   */
  official() {
    const owned = this._ownedOfficial();
    const LIST = this.officialList.pairs || require('../data/official-songs.json');
    const out = [];
    const seen = new Set();
    for (const w of this.wanted()) {
      if (w.status !== 'official') continue;
      const key = this._wantedKey(w.artist, w.title);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ artist: w.artist, title: w.title, key, wantedId: w.id, onList: this.officialList.has(w.artist, w.title) });
    }
    for (const [artist, title] of LIST) {
      const key = this._wantedKey(artist, title);
      if (seen.has(key) || owned(artist, title)) continue;
      seen.add(key);
      out.push({ artist, title, key, wantedId: null, onList: true });
    }
    return { songs: out, lastRequestAt: this.data.lastRequestAt || 0, nextAt: this._nextRequestAt(), contact: this.data.requestContact || '', email: officialRequest.REQUEST_EMAIL };
  }

  _nextRequestAt() {
    const last = Number(this.data.lastRequestAt) || 0;
    return last ? last + officialRequest.REQUEST_GAP : 0;
  }

  /**
   * Ask Noisewater Labs for official songs: one request every 12 hours. Returns
   * { ok, via: 'email' | 'mailto' | 'wait', nextAt, mailto?, text? }. A request that
   * couldn't go out (via 'mailto': the page opens the player's mail app) doesn't count.
   */
  async requestOfficial(req = {}, { name = '', version = '' } = {}) {
    const songs = officialRequest.songsOf(req.songs);
    const contact = String(req.contact || '').trim().slice(0, 200);
    if (!songs.length) return { ok: false, via: 'none', error: 'Pick at least one song.' };
    if (!contact) return { ok: false, via: 'none', error: 'Say how Noisewater Labs can reach you.' };
    this.data.requestContact = contact;
    this.saveSoon();
    const nextAt = this._nextRequestAt();
    if (nextAt && this.now() < nextAt) return { ok: false, via: 'wait', nextAt };
    const r = await officialRequest.sendRequest({ songs, contact, note: req.note, name, version }, this.post ? { post: this.post } : {});
    if (r.ok) {
      this.data.lastRequestAt = this.now();
      this.saveSoon();
      this.log(`Discover: asked for ${songs.length} official songs`);
      return { ok: true, via: 'email', nextAt: this._nextRequestAt(), count: songs.length };
    }
    this.log(`Discover: song request couldn't go out (${r.why}); offered the mail app`);
    return { ok: false, via: 'mailto', mailto: r.mailto, text: r.text, why: r.why, nextAt: this._nextRequestAt(), count: songs.length };
  }

  // ----------------------------------------------------------- updates --
  /** A library song by artist + title (normalised), and whether its version is older than `version`. */
  _updateRow(r, at) {
    const own = this._owned(r.artist, r.title);
    if (!own) return null;
    const theirs = parseFloat(String(r.version || '').replace(/^v/i, ''));
    const ours = parseFloat(String(own.packageVersion || '').replace(/^v/i, ''));
    if (Number.isFinite(theirs) && Number.isFinite(ours) && ours >= theirs) return null;
    return {
      key: this._wantedKey(r.artist, r.title),
      artist: String(r.artist).slice(0, 200),
      title: String(r.title).slice(0, 200),
      version: r.version ? String(r.version).slice(0, 20) : '',
      updated: r.updated ? String(r.updated).slice(0, 40) : '',
      songId: own.id,
      ours: own.packageVersion ? String(own.packageVersion) : '',
      seenAt: at,
    };
  }

  /**
   * 4.25: CustomsForge's "Updated CDLC" list, as the song finder read it off the screen. Rows for
   * songs in the library are kept (newest seen wins); a version already got is not shown again.
   */
  setUpdates(rows) {
    const at = this.now();
    const byKey = new Map(this.data.updates.map((u) => [u.key, u]));
    let added = 0;
    for (const r of Array.isArray(rows) ? rows.slice(0, 1000) : []) {
      if (!r || !r.artist || !r.title) continue;
      const u = this._updateRow(r, at);
      if (!u) continue;
      const done = this.data.updatesDone[u.key];
      if (done !== undefined && done === u.version) continue;
      if (!byKey.has(u.key)) added++;
      byKey.set(u.key, { ...(byKey.get(u.key) || {}), ...u });
    }
    this.data.updates = [...byKey.values()].sort((a, b) => b.seenAt - a.seenAt).slice(0, 500);
    this.data.updatesCheckedAt = at;
    this.saveSoon();
    this.emit('updates', this.updates());
    return { added, updates: this.updates() };
  }

  /** The stored updates, still matched to songs in the library. */
  updates() {
    const out = [];
    for (const u of this.data.updates) {
      const fresh = this._updateRow(u, u.seenAt);
      if (fresh) out.push({ ...u, songId: fresh.songId, ours: fresh.ours });
    }
    return { rows: out, checkedAt: this.data.updatesCheckedAt || 0 };
  }

  /** Got (or not wanted): off the list, and that version isn't offered again. */
  clearUpdates(keys) {
    const set = new Set((Array.isArray(keys) ? keys : [keys]).map(String));
    for (const u of this.data.updates) if (set.has(u.key)) this.data.updatesDone[u.key] = u.version || '';
    this.data.updates = this.data.updates.filter((u) => !set.has(u.key));
    this.saveSoon();
    return this.updates();
  }

  // -------------------------------------------------------- CustomsForge --
  ignitionUrl() {
    return IGNITION;
  }
}

module.exports = { Discover, IGNITION };
