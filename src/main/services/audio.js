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
  constructor({ cacheDir, tools, library, settings, log = () => {} }) {
    this.dir = cacheDir;
    this.tools = tools;
    this.library = library;
    this.settings = settings;
    this.log = log;
    this.pending = new Map();
    this._evictTimer = null;
    this.inUse = new Set();
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
    if (!song.audioEntry) {
      // 3.9.1: say what the file does hold, so a report can tell why
      this.log(`Audio: no song audio in ${song.path} (${song.title || song.songKey}): ${song.audioNote || 'not described'}`);
      throw new Error('This file has no song audio');
    }
    if (song.audioKey && fs.existsSync(this.wavPath(song.audioKey))) {
      this.markInUse(song.audioKey);
      return this._info(song.audioKey);
    }
    const p = await Psarc.open(song.path);
    let wem;
    try {
      wem = await readAudio(p, song.audioEntry);
    } finally {
      await p.close();
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
      throw new Error(`Could not decode the song audio: ${err.message}`);
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
