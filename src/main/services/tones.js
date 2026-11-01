'use strict';
/**
 * Your tones (tones.json in the app's data folder) and an index of every tone
 * in your songs, for the Tones section.
 *
 * A saved tone: { id, name, kind: 'guitar'|'bass', gear: [{ slot, key, knobs, order }],
 *                 slot: 1–9 | null, from: { songId, toneKey, song } | null, updatedAt }
 */
const crypto = require('crypto');
const { Psarc } = require('../core/psarc');
const { mapTone } = require('../core/tones');
const { readJson, writeJsonAtomic } = require('../core/files');

const SLOTS = 9;

function cleanGear(gear) {
  return (Array.isArray(gear) ? gear : [])
    .filter((g) => g && g.key && /^(pre|amp|post|cab|rack)$/.test(g.slot))
    .slice(0, 16)
    .map((g, i) => {
      const knobs = {};
      for (const [k, v] of Object.entries(g.knobs || {})) if (Number.isFinite(Number(v))) knobs[String(k)] = Number(v);
      const out = { slot: g.slot, key: String(g.key), knobs, order: Number.isFinite(g.order) ? g.order : i };
      if (g.bypass) out.bypass = true;
      return out;
    });
}

class ToneStore {
  constructor(file) {
    this.file = file;
    this.data = { seeded: false, tones: [] };
    this._timer = null;
  }

  async load() {
    const d = await readJson(this.file, null);
    if (d && Array.isArray(d.tones)) this.data = { seeded: !!d.seeded, tones: d.tones };
    if(this.data.tones.some(t=>t.slot===1)){for(const t of this.data.tones)if(t.slot===1)t.slot=null;await writeJsonAtomic(this.file,this.data);}
    return this.get();
  }

  get() {
    return { seeded: this.data.seeded, tones: this.data.tones };
  }

  /** Creates or updates a tone. A slot can hold one tone, so taking a slot frees it elsewhere. */
  save(tone) {
    if (!tone || typeof tone !== 'object') throw new Error('No tone to save.');
    const gear = cleanGear(tone.gear);
    if (!gear.length) throw new Error('A tone needs at least an amp or a pedal.');
    const name = String(tone.name || '').trim().slice(0, 80) || 'My tone';
    let slot = tone.slot === null || tone.slot === undefined || tone.slot === '' ? null : Number(tone.slot);
    if(slot===1)throw new Error('Slot 1 is reserved for Automatic Song Tone. Choose slots 2–9.');
    if (slot !== null && !(slot >= 2 && slot <= SLOTS)) slot = null;
    const now = Date.now();
    let t = tone.id ? this.data.tones.find((x) => x.id === tone.id) : null;
    if (!t) {
      t = { id: `t_${crypto.randomBytes(5).toString('hex')}`, createdAt: now };
      this.data.tones.push(t);
    }
    const ir = typeof tone.ir === 'string' && tone.ir ? tone.ir.slice(0, 1000) : null;
    // real amp: a capture pack id, 'off' (the modelled amp), or null (Stagehand's choice)
    const capture = typeof tone.capture === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(tone.capture) ? tone.capture : null;
    Object.assign(t, { name, kind: tone.kind === 'bass' ? 'bass' : 'guitar', gear, slot, from: tone.from || t.from || null, ir, autoCab: tone.autoCab !== false, capture, updatedAt: now });
    if (slot !== null) for (const o of this.data.tones) if (o !== t && o.slot === slot) o.slot = null;
    this.saveSoon();
    return t;
  }

  setSlot(id, slot) {
    const t = this.data.tones.find((x) => x.id === id);
    if (!t) throw new Error('That tone is gone.');
    return this.save({ ...t, slot });
  }

  remove(id) {
    this.data.tones = this.data.tones.filter((x) => x.id !== id);
    this.saveSoon();
    return true;
  }

  /** The first run fills slots with Stagehand's presets (sent by the page, which owns them). */
  seed(list) {
    if (this.data.seeded) return this.get();
    this.data.seeded = true;
    for (const t of list || []) {
      try {
        this.save(t);
      } catch (_) {}
    }
    this.saveSoon();
    return this.get();
  }

  saveSoon() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush().catch(() => {}), 250);
  }

  async flush() {
    clearTimeout(this._timer);
    await writeJsonAtomic(this.file, this.data);
  }
}

/**
 * Every tone in the library, grouped by song. Each song's manifests are read
 * once and remembered by path + modified time (like the tab cache).
 */
class ToneIndex {
  constructor({ file, log = () => {}, slowMs = 15000, saveEveryMs = 10000 } = {}) {
    this.file = file;
    this.log = log;
    this.slowMs = slowMs;
    this.saveEveryMs = saveEveryMs;
    this.cache = new Map(); // path -> { mtimeMs, tones }
    this.loaded = false;
    this.dirty = false;
  }

  async _load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    const d = await readJson(this.file, null);
    if (d && d.v === 1 && d.songs) for (const [p, v] of Object.entries(d.songs)) this.cache.set(p, v);
  }

  async _save() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    const songs = {};
    for (const [p, v] of this.cache) songs[p] = v;
    await writeJsonAtomic(this.file, { v: 1, songs }).catch(() => {});
  }

  async _read(song) {
    const psarc = await Psarc.open(song.path);
    try {
      const out = [];
      const seen = new Set();
      for (const arr of song.arrangements || []) {
        if (!['lead', 'rhythm', 'combo', 'bass'].includes(arr.type) || !arr.manifest || !psarc.names.includes(arr.manifest)) continue;
        let json;
        try {
          json = JSON.parse((await psarc.read(arr.manifest)).toString('utf8').replace(/^﻿/, ''));
        } catch (_) {
          continue;
        }
        const entry = json.Entries && (json.Entries[arr.id] || Object.values(json.Entries)[0]);
        const list = (entry && entry.Attributes && Array.isArray(entry.Attributes.Tones) && entry.Attributes.Tones) || [];
        for (const t of list) {
          const m = mapTone(t, arr.type);
          const id = `${m.kind}|${String(m.key).toLowerCase()}`;
          if (seen.has(id) || !m.gear.length) continue;
          seen.add(id);
          out.push({ key: m.key, name: m.name, kind: m.kind, part: arr.type === 'combo' ? 'lead' : arr.type, gear: m.gear, descriptors: m.descriptors });
        }
      }
      return out;
    } finally {
      await psarc.close().catch(() => {});
    }
  }

  /**
   * [{ songId, title, artist, tones: [...] }] for songs that have tones.
   * onProgress({ done, total }) while songs are being read (not for remembered
   * ones). Calls while a read is running share it; progress is saved as it goes.
   */
  list(songs, opts = {}) {
    if (this._running) {
      if (opts.onProgress) {
        this._listeners.add(opts.onProgress);
        if (this._last) opts.onProgress(this._last);
      }
      return this._running;
    }
    this._listeners = new Set(opts.onProgress ? [opts.onProgress] : []);
    this._last = null;
    this._running = this._list(songs).finally(() => {
      this._running = null;
      this._listeners = new Set();
    });
    return this._running;
  }

  _report(p) {
    this._last = p;
    for (const fn of this._listeners) {
      try {
        fn(p);
      } catch (_) {}
    }
  }

  async _list(songs) {
    const t0 = Date.now();
    const total = songs.length;
    // say something straight away, before anything is opened
    this._report({ done: 0, total, read: 0 });
    await this._load();
    const out = [];
    let i = 0;
    let read = 0;
    let skipped = 0;
    let lastSent = 0;
    let lastSave = Date.now();
    const report = (force) => {
      const now = Date.now();
      if (!force && now - lastSent < 100) return;
      lastSent = now;
      this._report({ done: i, total, read });
    };
    for (const song of songs) {
      i++;
      let c = this.cache.get(song.path);
      if (!c || c.mtimeMs !== song.mtimeMs) {
        const t1 = Date.now();
        let timer = null;
        try {
          // one song file that hangs (a broken file, a cloud drive) mustn't stop the rest
          const tones = await Promise.race([this._read(song), new Promise((_, rej) => (timer = setTimeout(() => rej(Object.assign(new Error('took too long'), { code: 'slow' })), this.slowMs)))]);
          c = { mtimeMs: song.mtimeMs, tones };
          this.cache.set(song.path, c);
          this.dirty = true;
        } catch (e) {
          this.log(`Tones: ${song.path}: ${e.message}`);
          c = { mtimeMs: song.mtimeMs, tones: [] };
          if (e.code === 'slow') skipped++; // try again next time
          else this.cache.set(song.path, c), (this.dirty = true);
        } finally {
          clearTimeout(timer);
        }
        if (Date.now() - t1 > 2000) this.log(`Tones: ${song.path} took ${((Date.now() - t1) / 1000).toFixed(1)} s`);
        read++;
        // keep what's read so far, in case Stagehand is closed before the end (at most every 10 s: the file is big)
        if (Date.now() - lastSave > this.saveEveryMs) {
          lastSave = Date.now();
          await this._save();
        }
      }
      report(i === total);
      if (c.tones.length) out.push({ songId: song.id, title: song.title, artist: song.artist, tones: c.tones });
    }
    await this._save();
    this.log(`Tones: ${total} songs, ${total - read} remembered, ${read} read${skipped ? ` (${skipped} too slow, skipped)` : ''}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return out;
  }

  /** Saves what's been read (on quit too). */
  flush() {
    return this._save().catch(() => {});
  }
}

module.exports = { ToneStore, ToneIndex, cleanGear, SLOTS };
