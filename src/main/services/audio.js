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
const { readAudio } = require('../core/rocksmith');
const { readWavInfo } = require('../core/files');
const { run } = require('./tools');

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
   * clip of their own: decode that (small, quick) and keep it. A song without one plays a slice of
   * its full audio, but only when that is already decoded, so a click never waits on a long decode.
   * Returns { url, duration, start, length } or null when there is nothing to play.
   */
  async preparePreview(song) {
    if (!song) return null;
    if (song.previewEntry) {
      // 4.29.1: a song clicked before goes straight to its clip, without reading its file again
      let st = null;
      try {
        st = await fsp.stat(song.path);
      } catch (_) {}
      const seen = st ? `${song.path}|${song.previewEntry}|${st.size}|${st.mtimeMs}` : null;
      let key = seen ? this.previewKeys.get(seen) : null;
      if (!key || !fs.existsSync(this.wavPath(key))) {
        const wem = await this._read({ path: song.path, entry: song.previewEntry });
        key = `pv${crypto.createHash('sha1').update(wem).digest('hex').slice(0, 22)}`;
        if (!fs.existsSync(this.wavPath(key))) {
          if (!this.pending.has(key)) this.pending.set(key, this._decode(wem, key).finally(() => this.pending.delete(key)));
          await this.pending.get(key);
          this.evictSoon();
        }
        if (seen) {
          this.previewKeys.set(seen, key);
          while (this.previewKeys.size > 500) this.previewKeys.delete(this.previewKeys.keys().next().value);
        }
      }
      const i = await this._info(key);
      return { url: i.url, duration: i.duration, start: 0, length: i.duration };
    }
    if (song.audioKey && fs.existsSync(this.wavPath(song.audioKey))) {
      // 4.29.1: a slice of the song in a small file of its own, so a click fetches 30 s, not the whole song
      const key = `pv${crypto.createHash('sha1').update(`slice:${song.audioKey}`).digest('hex').slice(0, 22)}`;
      if (!fs.existsSync(this.wavPath(key))) {
        if (!this.pending.has(key)) this.pending.set(key, this._slice(song.audioKey, key, 30).finally(() => this.pending.delete(key)));
        await this.pending.get(key);
        this.evictSoon();
      }
      const i = await this._info(key);
      return { url: i.url, duration: i.duration, start: 0, length: i.duration };
    }
    return null;
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
    await fsp.rename(tmp, this.wavPath(key));
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

  async _decode(wem, key) {
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
      await run(vgm, ['-i', '-o', tmpWav, wemPath], { timeoutMs: 90000 }); // a decoder that hangs mustn't hold the song up forever
      const info = await readWavInfo(tmpWav);
      if (!info.frames) throw new Error('Decoded audio is empty');
      await fsp.rename(tmpWav, this.wavPath(key));
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
