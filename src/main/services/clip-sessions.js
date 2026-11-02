'use strict';
/**
 * Record clip, written to disk while it records (4.0.7). The page sends each second
 * of video, and the engine's sound, as it comes; nothing big is ever kept in the
 * page. (Before, a whole song's video was kept there and copied again to save it:
 * hundreds of MB, and the page ran out of memory and went blank.)
 *
 * If the page dies mid-recording, what was written so far is still here and can be
 * saved (main.js does that after a crash).
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const MAX_BYTES = 1500 * 1024 * 1024; // a little over 10 minutes at the recording quality

class ClipSessions {
  constructor({ tempRoot }) {
    this.tempRoot = tempRoot;
    this.list = new Map();
    this.n = 0;
  }

  /** meta: { title, songId, rate } → session id */
  async begin(meta = {}) {
    const dir = await fsp.mkdtemp(path.join(this.tempRoot, 'stagehand-clip-'));
    const id = `c${Date.now().toString(36)}${++this.n}`;
    const s = {
      id,
      dir,
      video: path.join(dir, 'capture.webm'),
      pcm: path.join(dir, 'sound.pcm'),
      title: String(meta.title || 'Jam Session'),
      songId: meta.songId || null,
      rate: Number(meta.rate) || 48000,
      vbytes: 0,
      abytes: 0,
      startedAt: Date.now(),
      q: Promise.resolve(),
    };
    await fsp.writeFile(s.video, Buffer.alloc(0));
    this.list.set(id, s);
    return id;
  }

  /** kind 'v' (video, as recorded) or 'a' (16-bit stereo sound). In order, one at a time. */
  chunk(id, kind, data) {
    const s = this.list.get(id);
    if (!s) throw Error('That recording has already finished.');
    const buf = Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data);
    if (s.vbytes + s.abytes + buf.length > MAX_BYTES) return s.q.then(() => ({ full: true }));
    if (kind === 'v') s.vbytes += buf.length;
    else s.abytes += buf.length;
    const file = kind === 'v' ? s.video : s.pcm;
    s.q = s.q.then(() => fsp.appendFile(file, buf));
    return s.q.then(() => ({ full: false }));
  }

  active() {
    return [...this.list.values()];
  }

  /** Stops taking pieces; returns what to export: { input, sound (a WAV or null), title, songId, seconds, dir }. */
  async close(id) {
    const s = this.list.get(id);
    if (!s) throw Error('That recording has already finished.');
    this.list.delete(id);
    await s.q.catch(() => {});
    let sound = null;
    if (s.abytes > 0) {
      sound = path.join(s.dir, 'sound.wav');
      await writeWav(s.pcm, sound, s.rate);
    }
    return { input: s.video, sound, title: s.title, songId: s.songId, seconds: (Date.now() - s.startedAt) / 1000, dir: s.dir, vbytes: s.vbytes };
  }

  async remove(dirOrId) {
    const s = this.list.get(dirOrId);
    if (s) this.list.delete(dirOrId);
    const dir = s ? s.dir : dirOrId;
    if (s) await s.q.catch(() => {});
    if (dir && path.basename(dir).startsWith('stagehand-clip-')) await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** Raw 16-bit stereo → a WAV, copied through without loading it all. */
async function writeWav(pcmFile, wavFile, rate) {
  const size = (await fsp.stat(pcmFile)).size & ~3;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + size, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(size, 40);
  await fsp.writeFile(wavFile, h);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(wavFile, { flags: 'a' });
    const inp = fs.createReadStream(pcmFile, { start: 0, end: Math.max(0, size - 1) });
    out.on('error', reject);
    inp.on('error', reject);
    out.on('finish', resolve);
    if (size === 0) (inp.destroy(), out.end());
    else inp.pipe(out);
  });
}

module.exports = { ClipSessions, writeWav, MAX_BYTES };
