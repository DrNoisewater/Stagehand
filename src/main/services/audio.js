'use strict';
/**
 * Decodes each song's Wwise .wem into a cached 16-bit WAV with vgmstream.
 * Cache files are keyed by a hash of the audio itself, so metadata edits,
 * renames and moves never force a re-decode.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Psarc } = require('../core/psarc');
const { readAudio, readSongs } = require('../core/rocksmith');
const { readWavInfo } = require('../core/files');
const { run } = require('./tools');

/** 4.30.1: on Windows a virus scanner can hold a new file for a moment: a rename is tried for up to 2 s. */
async function renameSoon(from, to) {
  for (let i = 0; ; i++) {
    try {
      return await fsp.rename(from, to);
    } catch (err) {
      if (i >= 10 || !/^(EPERM|EBUSY|EACCES)$/.test(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

class AudioService {
  constructor({ cacheDir, tools, library, settings, finder = null, onSong = () => {}, onSearch = () => {}, log = () => {} }) {
    this.finder = finder;
    this.onSearch = onSearch;
    this.onSong = onSong;
    this.dir = cacheDir;
    this.tools = tools;
    this.library = library;
    this.settings = settings;
    this.log = log;
    this.pending = new Map();
    this._evictTimer = null;
    this.inUse = new Set();
    this.previewKeys = new Map(); // a song file and its preview → the clip already made from it
    this.foundPreviews = new Map(); // 4.30.1: a song file looked at again for its preview → what was found
    this._pvWant = null; // the song last clicked
    this._pvFull = null; // a whole song being decoded for a preview
  }

  markInUse(key) {
    this.inUse.delete(key);
    this.inUse.add(key);
    while (this.inUse.size > 4) this.inUse.delete(this.inUse.values().next().value);
  }

  wavPath(key) {
    return path.join(this.dir, `${key}.wav`);
  }

  async _info(key) {
    const wav = this.wavPath(key);
    const info = await readWavInfo(wav);
    const now = new Date();
    fsp.utimes(wav, now, now).catch(() => {});
    return {
      key,
      url: `stagehand://audio/${key}.wav`,
      sampleRate: info.sampleRate,
      channels: info.channels,
      frames: info.frames,
      duration: info.duration,
      bits: info.bitsPerSample,
    };
  }

  async prepare(song) {
    if (!song) throw new Error('Song not found');
    if (song.audioKey && fs.existsSync(this.wavPath(song.audioKey))) {
      this.markInUse(song.audioKey);
      return this._info(song.audioKey);
    }
    let src = song.audioEntry ? { path: song.path, entry: song.audioEntry } : song.audioFrom || null;
    if (!src) src = await this._findElsewhere(song);
    let wem;
    try {
      wem = await this._read(src);
    } catch (err) {
      if (!song.audioFrom) throw err;
      // the other file moved or changed: look again
      this.library.setAudioFrom(song.id, null);
      wem = await this._read((src = await this._findElsewhere(song)));
    }
    const key = crypto.createHash('sha1').update(wem).digest('hex').slice(0, 24);
    this.library.setAudioKey(song.id, key);
    this.markInUse(key);
    const wav = this.wavPath(key);
    if (!fs.existsSync(wav)) {
      if (!this.pending.has(key)) {
        const job = this._decode(wem, key).finally(() => this.pending.delete(key));
        this.pending.set(key, job);
      }
      await this.pending.get(key);
      this.evictSoon();
    }
    return this._info(key);
  }

  /**
   * 4.26: a short clip to hear when you click a song in the list. Rocksmith songs carry a preview
   * clip of their own: decode that (small, quick) and keep it.
   * 4.30.1: never nothing when the song has sound. A song with no preview clip, or one the decoder
   * can't read, gets 30 s cut from its full audio (decoded first if it isn't yet, which takes a few
   * seconds and is then ready for playing too). A decode that fails is tried once more.
   * Returns { url, duration, start, length, from: 'preview' | 'song' }. Throws when nothing can play,
   * with a plain reason; code PREVIEW_SKIPPED when another song was clicked while this one waited.
   */
  async preparePreview(song, { warm = false } = {}) {
    if (!song) return null;
    if (!warm) this._pvWant = song.id;
    let failed = null;
    const entry = song.previewEntry || (await this._lookForPreview(song));
    if (entry) {
      try {
        const key = await this._previewClip(song, entry);
        const i = await this._info(key);
        return { url: i.url, duration: i.duration, start: 0, length: i.duration, from: 'preview' };
      } catch (err) {
        if (err.code === 'NEED_VGMSTREAM') throw err;
        failed = err;
        if (!warm) this.log(`Preview clip of ${song.title || song.songKey} didn't decode (${err.message}); using a slice of the song`);
      }
    }
    if (warm) return null; // warming up never decodes a whole song
    if (!(song.audioKey && fs.existsSync(this.wavPath(song.audioKey)))) {
      // one whole-song decode at a time: quick clicks across songs without a clip don't pile up
      while (this._pvFull) await this._pvFull.catch(() => {});
      if (this._pvWant !== song.id) throw Object.assign(new Error('Another song was picked'), { code: 'PREVIEW_SKIPPED' });
      const job = this.prepare(song);
      this._pvFull = job;
      try {
        await job;
      } catch (err) {
        if (err.code === 'NEED_VGMSTREAM') throw err;
        const e = new Error(failed ? 'Its preview and its audio could not be read' : (err && err.message) || 'Its audio could not be read');
        e.code = 'PREVIEW_NONE';
        throw e;
      } finally {
        if (this._pvFull === job) this._pvFull = null;
      }
      song = this.library.get(song.id) || song;
      if (!song.audioKey) throw Object.assign(new Error('Its audio could not be read'), { code: 'PREVIEW_NONE' });
    }
    // 4.29.1: a slice of the song in a small file of its own, so a click fetches 30 s, not the whole song
    const key = `pv${crypto.createHash('sha1').update(`slice:${song.audioKey}`).digest('hex').slice(0, 22)}`;
    if (!fs.existsSync(this.wavPath(key))) {
      if (!this.pending.has(key)) this.pending.set(key, this._slice(song.audioKey, key, 30).finally(() => this.pending.delete(key)));
      await this.pending.get(key);
      this.evictSoon();
    }
    const i = await this._info(key);
    return { url: i.url, duration: i.duration, start: 0, length: i.duration, from: 'song' };
  }

  /** The song's own preview clip, decoded to a pv<hash> WAV (once; a failed decode is tried again once). */
  async _previewClip(song, entry) {
    // 4.29.1: a song clicked before goes straight to its clip, without reading its file again
    let st = null;
    try {
      st = await fsp.stat(song.path);
    } catch (_) {}
    const seen = st ? `${song.path}|${entry}|${st.size}|${st.mtimeMs}` : null;
    let key = seen ? this.previewKeys.get(seen) : null;
    if (key && fs.existsSync(this.wavPath(key))) return key;
    const wem = await this._read({ path: song.path, entry });
    key = `pv${crypto.createHash('sha1').update(wem).digest('hex').slice(0, 22)}`;
    for (let attempt = 0; attempt < 3 && !fs.existsSync(this.wavPath(key)); attempt++) {
      if (!this.pending.has(key)) this.pending.set(key, this._decode(wem, key, { timeoutMs: 20000 }).finally(() => this.pending.delete(key)));
      try {
        await this.pending.get(key);
      } catch (err) {
        // a busy PC or a virus scanner holding the file can make one try fail: one more go
        if (err.code === 'NEED_VGMSTREAM' || attempt >= 1) throw err;
        continue;
      }
      this.evictSoon();
    }
    if (!fs.existsSync(this.wavPath(key))) throw new Error('The preview clip went missing');
    if (seen) {
      this.previewKeys.set(seen, key);
      while (this.previewKeys.size > 500) this.previewKeys.delete(this.previewKeys.keys().next().value);
    }
    return key;
  }

  /**
   * 4.30.1: songs read before Stagehand knew every way a file keeps its preview: look again
   * (once per file version), so the clip in the file is used rather than a slice.
   */
  async _lookForPreview(song) {
    if (!song.path || song.audioFrom) return null;
    let st;
    try {
      st = await fsp.stat(song.path);
    } catch (_) {
      return null;
    }
    const k = `${song.path}|${song.songKey}|${st.size}|${st.mtimeMs}`;
    if (this.foundPreviews.has(k)) return this.foundPreviews.get(k);
    let entry = null;
    try {
      const p = await Psarc.open(song.path);
      try {
        const all = await readSongs(p);
        const me = all.find((x) => x.songKey === song.songKey) || (all.length === 1 ? all[0] : null);
        entry = (me && me.previewEntry) || null;
      } finally {
        await p.close();
      }
    } catch (_) {}
    this.foundPreviews.set(k, entry);
    while (this.foundPreviews.size > 500) this.foundPreviews.delete(this.foundPreviews.keys().next().value);
    return entry;
  }

  /**
   * 4.30.1: get the clips of the songs around the one clicked ready on disk, one after another,
   * so the next click (or the first click after starting) plays at once. Only songs with a clip
   * of their own; it waits while anything else is being decoded.
   */
  async warmPreviews(songs) {
    const n = (this._warmGen = (this._warmGen || 0) + 1);
    for (const song of songs) {
      if (this._warmGen !== n) return; // a newer list came
      if (!song || song.audioFrom) continue;
      while (this.pending.size || this._pvFull) await new Promise((r) => setTimeout(r, 150));
      if (this._warmGen !== n) return;
      try {
        await this.preparePreview(song, { warm: true });
      } catch (_) {}
    }
  }

  /** Copies `secs` of a decoded song (from 30% in) into its own small WAV. */
  async _slice(fromKey, key, secs) {
    const src = this.wavPath(fromKey);
    const info = await readWavInfo(src);
    const frameBytes = (info.bitsPerSample / 8) * info.channels;
    const frames = Math.min(info.frames, Math.round(secs * info.sampleRate));
    const first = Math.max(0, Math.min(Math.floor(info.frames * 0.3), info.frames - frames));
    const data = Buffer.alloc(frames * frameBytes);
    const fh = await fsp.open(src, 'r');
    try {
      await fh.read(data, 0, data.length, info.dataOffset + first * frameBytes);
    } finally {
      await fh.close();
    }
    const head = Buffer.alloc(44);
    head.write('RIFF', 0, 'latin1');
    head.writeUInt32LE(36 + data.length, 4);
    head.write('WAVEfmt ', 8, 'latin1');
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(info.format === 3 ? 3 : 1, 20);
    head.writeUInt16LE(info.channels, 22);
    head.writeUInt32LE(info.sampleRate, 24);
    head.writeUInt32LE(info.sampleRate * frameBytes, 28);
    head.writeUInt16LE(frameBytes, 32);
    head.writeUInt16LE(info.bitsPerSample, 34);
    head.write('data', 36, 'latin1');
    head.writeUInt32LE(data.length, 40);
    const tmp = path.join(this.dir, `${key}.${crypto.randomBytes(3).toString('hex')}.tmp.wav`);
    await fsp.writeFile(tmp, Buffer.concat([head, data]));
    await renameSoon(tmp, this.wavPath(key));
  }

  async _read(src) {
    const p = await Psarc.open(src.path);
    try {
      return await readAudio(p, src.entry);
    } finally {
      await p.close();
    }
  }

  /**
   * The song's own file has no audio (official files often keep it elsewhere; Rocksmith 1 DLC
   * keeps even its sound bank elsewhere): find it the way the game does (services/audiofind.js).
   * The chart's file and the audio's file may differ; every part of the song shares the result.
   */
  async _findElsewhere(song) {
    if (!this.finder) throw new Error('This file has no song audio');
    let bank = null;
    if (song.bankEntry) {
      try {
        bank = await this._read({ path: song.path, entry: song.bankEntry });
      } catch (_) {}
    }
    this.onSearch({ song, state: 'looking' });
    try {
      const r = await this.finder.resolve(song, bank);
      const found = { path: r.path, entry: r.entry };
      const s = this.library.setAudioFrom(song.id, found);
      if (s) this.onSong(s);
      return found;
    } catch (err) {
      if (!err.code) this.log(`Audio search failed for ${song.title || song.songKey} (${song.path}): ${err.message}`);
      const s = this.library.setAudioFail(song.id, { code: err.code || 'AUDIO_SEARCH', message: err.message });
      if (s) this.onSong(s);
      throw err;
    } finally {
      this.onSearch({ song, state: 'done' });
    }
  }

  async _decode(wem, key, { timeoutMs = 90000 } = {}) {
    const vgm = this.tools.vgmstreamPath();
    if (!vgm) {
      const e = new Error('Audio decoder not installed');
      e.code = 'NEED_VGMSTREAM';
      throw e;
    }
    await fsp.mkdir(this.dir, { recursive: true });
    const tag = crypto.randomBytes(3).toString('hex');
    // real Ogg audio needs its own extension for the decoder to recognise it
    const ext = wem.length >= 4 && wem.toString('latin1', 0, 4) === 'OggS' ? 'ogg' : 'wem';
    const wemPath = path.join(this.dir, `${key}.${tag}.${ext}`);
    const tmpWav = path.join(this.dir, `${key}.${tag}.tmp.wav`);
    await fsp.writeFile(wemPath, wem);
    try {
      await run(vgm, ['-i', '-o', tmpWav, wemPath], { timeoutMs }); // a decoder that hangs mustn't hold the song up forever
      const info = await readWavInfo(tmpWav);
      if (!info.frames) throw new Error('Decoded audio is empty');
      await renameSoon(tmpWav, this.wavPath(key));
    } catch (err) {
      await fsp.unlink(tmpWav).catch(() => {});
      const e = new Error(`Stagehand found this song’s audio but couldn’t decode it: ${err.message}`);
      e.code = 'AUDIO_DECODE';
      throw e;
    } finally {
      await fsp.unlink(wemPath).catch(() => {});
    }
  }

  evictSoon() {
    clearTimeout(this._evictTimer);
    this._evictTimer = setTimeout(() => this.evict().catch(() => {}), 2000);
  }

  /** Keeps the decoded-audio cache under the configured size (LRU by mtime). */
  async evict() {
    const limit = (this.settings.get().cache.audioLimitGB || 4) * 1024 ** 3;
    let files;
    try {
      files = await fsp.readdir(this.dir);
    } catch (_) {
      return;
    }
    const stats = [];
    for (const f of files) {
      if (!f.endsWith('.wav')) continue;
      try {
        const st = await fsp.stat(path.join(this.dir, f));
        stats.push({ f, size: st.size, t: st.mtimeMs });
      } catch (_) {}
    }
    let total = stats.reduce((n, s) => n + s.size, 0);
    stats.sort((a, b) => a.t - b.t);
    for (const s of stats) {
      if (total <= limit) break;
      if (this.inUse.has(s.f.replace(/\.wav$/, ''))) continue;
      await fsp.unlink(path.join(this.dir, s.f)).catch(() => {});
      total -= s.size;
    }
  }

  async clear() {
    await fsp.rm(this.dir, { recursive: true, force: true });
    await fsp.mkdir(this.dir, { recursive: true });
  }
}

module.exports = { AudioService };
