'use strict';
/**
 * Stem separation queue. One job runs at a time (it uses the whole GPU/CPU);
 * results are cached per audio hash and model so they survive edits/renames.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const MODELS = {
  htdemucs_6s: { label: '6 stems: guitar, bass, drums, vocals, piano, other', stems: ['guitar', 'bass', 'drums', 'vocals', 'piano', 'other'] },
  htdemucs_ft: { label: '4 stems, highest quality (slower)', stems: ['bass', 'drums', 'vocals', 'other'] },
  htdemucs: { label: '4 stems, fast', stems: ['bass', 'drums', 'vocals', 'other'] },
};

const EXT = { wav: 'wav', flac: 'flac', opus192: 'opus', opus128: 'opus', opus256: 'opus' };

class StemService extends EventEmitter {
  constructor({ stemsDir, audio, tools, settings, library, engineScript, log = () => {} }) {
    super();
    this.dir = stemsDir;
    this.audio = audio;
    this.tools = tools;
    this.settings = settings;
    this.library = library;
    this.script = engineScript;
    this.log = log;
    this.queue = [];
    this.current = null;
    this.states = new Map(); // songId -> {state, progress, message}
  }

  model() {
    const m = this.settings.get().stems.model;
    return MODELS[m] ? m : 'htdemucs_6s';
  }

  _readyIn(key, model) {
    if (!key) return null;
    const dir = path.join(this.dir, key, model);
    const metaFile = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaFile)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const ext = EXT[meta.format] || 'wav';
      if (!meta.stems.every((s) => fs.existsSync(path.join(dir, `${s}.${ext}`)))) return null;
      return {
        model,
        format: meta.format || 'wav',
        stems: meta.stems.map((name) => ({ name, url: `stagehand://stems/${key}/${model}/${name}.${ext}` })),
        sampleRate: meta.sampleRate,
        frames: meta.frames,
        createdAt: meta.createdAt,
      };
    } catch (_) {
      return null;
    }
  }

  // ------------------------------------------------ storage formats --
  /** Writes one compressed stem next to the WAVs (the page encodes it). */
  async storeFile(song, model, name, ext, bytes) {
    if (!song || !song.audioKey || !MODELS[model] || !/^[a-z]+$/.test(name) || !['flac', 'opus'].includes(ext)) throw new Error('Bad stem');
    const dir = path.join(this.dir, song.audioKey, model);
    if (!fs.existsSync(path.join(dir, 'meta.json'))) throw new Error('No stems for this song');
    const buf = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    const f = path.join(dir, `${name}.${ext}`);
    await fsp.writeFile(`${f}.part`, buf);
    await fsp.rename(`${f}.part`, f);
    return buf.length;
  }

  /** Switches a song's stems to a stored format once every stem is there, and deletes the others. */
  async finishFormat(song, model, format) {
    if (!song || !song.audioKey || !MODELS[model] || !EXT[format]) throw new Error('Bad stem format');
    const dir = path.join(this.dir, song.audioKey, model);
    const metaFile = path.join(dir, 'meta.json');
    const meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
    const ext = EXT[format];
    if (!meta.stems.every((s) => fs.existsSync(path.join(dir, `${s}.${ext}`)))) throw new Error('Some stems are missing in the new format');
    meta.format = format;
    await fsp.writeFile(`${metaFile}.part`, JSON.stringify(meta, null, 1));
    await fsp.rename(`${metaFile}.part`, metaFile);
    // The old files stay until the next start: a song that's open may still be reading them.
    this.emit('update', { songId: song.id, state: 'ready', ...this._readyIn(song.audioKey, model) });
    return this._readyIn(song.audioKey, model);
  }

  /**
   * At start: once, clear every stem (the user asked to remake them all as
   * FLAC); otherwise remove files left over from a format switch.
   */
  async startup() {
    const st = this.settings.get().stems || {};
    try {
      if (!st.cleared310) {
        await fsp.rm(this.dir, { recursive: true, force: true });
        await fsp.mkdir(this.dir, { recursive: true });
        this.settings.set({ stems: { cleared310: true, format: 'flac' } });
        this.log('Stems: cleared all stems (3.1 reset)');
        return;
      }
      if (!fs.existsSync(this.dir)) return;
      for (const key of await fsp.readdir(this.dir)) {
        for (const model of Object.keys(MODELS)) {
          const dir = path.join(this.dir, key, model);
          const metaFile = path.join(dir, 'meta.json');
          if (!fs.existsSync(metaFile)) continue;
          const meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
          const ext = EXT[meta.format] || 'wav';
          if (!meta.stems.every((s) => fs.existsSync(path.join(dir, `${s}.${ext}`)))) continue;
          for (const s of meta.stems) for (const e of ['wav', 'flac', 'opus']) if (e !== ext) await fsp.rm(path.join(dir, `${s}.${e}`), { force: true });
        }
      }
    } catch (err) {
      this.log(`Stems: cleanup failed: ${err.message}`);
    }
  }

  /** Every song with stems: its format and size on disk. */
  formats(songs) {
    const out = [];
    for (const song of songs) {
      if (!song.audioKey) continue;
      for (const model of Object.keys(MODELS)) {
        const r = this._readyIn(song.audioKey, model);
        if (!r) continue;
        const dir = path.join(this.dir, song.audioKey, model);
        let bytes = 0;
        for (const f of fs.readdirSync(dir)) bytes += fs.statSync(path.join(dir, f)).size;
        out.push({ songId: song.id, model, format: r.format, bytes, seconds: r.frames && r.sampleRate ? r.frames / r.sampleRate : null });
      }
    }
    return out;
  }

  ready(song) {
    if (!song || !song.audioKey) return null;
    const pref = this.model();
    return this._readyIn(song.audioKey, pref) || Object.keys(MODELS).map((m) => this._readyIn(song.audioKey, m)).find(Boolean) || null;
  }

  status(song) {
    if (!song) return { state: 'none' };
    const live = this.states.get(song.id);
    if (live && (live.state === 'queued' || live.state === 'running')) return live;
    const ready = this.ready(song);
    if (ready) return { state: 'ready', ...ready };
    if (live && live.state === 'error') return live;
    return { state: 'none' };
  }

  _set(songId, st) {
    this.states.set(songId, st);
    this.emit('update', { songId, ...st });
  }

  queueInfo() {
    const items = [];
    if (this.current) items.push({ songId: this.current.songId, ...this.states.get(this.current.songId) });
    for (const j of this.queue) items.push({ songId: j.songId, ...this.states.get(j.songId) });
    return items;
  }

  request(songIds, { force = false } = {}) {
    for (const id of songIds) {
      const song = this.library.get(id);
      if (!song) continue;
      if (this.current && this.current.songId === id) continue;
      if (this.queue.some((j) => j.songId === id)) continue;
      if (!force && this.ready(song)) continue;
      this.queue.push({ songId: id, force });
      this._set(id, { state: 'queued', progress: 0, message: 'Waiting' });
    }
    this._pump();
    return this.queueInfo();
  }

  /** Moves a queued song to the front (e.g. the one being listened to). */
  prioritize(songId, { now = false } = {}) {
    const i = this.queue.findIndex((j) => j.songId === songId);
    if (i > 0) this.queue.unshift(this.queue.splice(i, 1)[0]);
    // 3.8: the song you just opened to play goes first, right now: a split of another
    // song that's running is stopped and put back in line right after it
    if (now && this.queue.length && this.queue[0].songId === songId && this.current && this.current.songId !== songId && this.current.child && !this.current.cancelled) {
      this.current.requeue = true;
      this.log(`Stems: ${songId} jumps ahead of ${this.current.songId}`);
      this.current.child.kill();
    }
  }

  cancel(songId) {
    const i = this.queue.findIndex((j) => j.songId === songId);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.states.delete(songId);
      this.emit('update', { songId, state: 'none' });
    }
    if (this.current && this.current.songId === songId && this.current.child) {
      this.current.cancelled = true;
      this.current.child.kill();
    }
  }

  async remove(song) {
    if (!song || !song.audioKey) return;
    await fsp.rm(path.join(this.dir, song.audioKey), { recursive: true, force: true });
    this.states.delete(song.id);
    this.emit('update', { songId: song.id, state: 'none' });
  }

  async _pump() {
    if (this.current || !this.queue.length) return;
    const job = this.queue.shift();
    this.current = job;
    try {
      await this._run(job);
    } catch (err) {
      if (job.requeue) {
        // stopped so the song you're about to play could go first: back in line, right after it
        this.queue.splice(Math.min(1, this.queue.length), 0, { songId: job.songId, force: job.force });
        this._set(job.songId, { state: 'queued', progress: 0, message: 'Waiting' });
      } else if (job.cancelled) {
        this.states.delete(job.songId);
        this.emit('update', { songId: job.songId, state: 'none' });
      } else {
        this.log(`Stem separation failed: ${err.message}`);
        this._set(job.songId, { state: 'error', progress: 0, message: err.message, code: err.code });
      }
    } finally {
      this.current = null;
      setImmediate(() => this._pump());
    }
  }

  async _run(job) {
    const song = this.library.get(job.songId);
    if (!song) throw new Error('Song is no longer in the library');
    const python = this.tools.enginePython();
    if (!python) {
      const e = new Error('Stem separation is not set up yet');
      e.code = 'NEED_ENGINE';
      throw e;
    }
    this._set(job.songId, { state: 'running', progress: 0, message: 'Decoding audio' });
    const info = await this.audio.prepare(song);
    const model = this.model();
    const final = path.join(this.dir, info.key, model);
    const work = `${final}.${crypto.randomBytes(3).toString('hex')}.work`;
    await fsp.mkdir(work, { recursive: true });
    const s = this.settings.get().stems;
    const args = [
      '-u', this.script,
      '--input', this.audio.wavPath(info.key),
      '--outdir', work,
      '--model', model,
      '--shifts', String(s.shifts || 1),
      '--device', s.device || 'auto',
      '--cpu-load', ['full', 'half', 'low'].includes(s.cpuLoad) ? s.cpuLoad : 'full',
    ];
    this._set(job.songId, { state: 'running', progress: 0, message: 'Starting engine' });

    let doneEvent = null;
    let errorEvent = null;
    let device = null;
    let deviceKind = null;
    let note = null;
    await new Promise((resolve, reject) => {
      const child = spawn(python, args, { env: { ...process.env, ...this.tools.engineEnv() }, windowsHide: true });
      job.child = child;
      // Keep the PC responsive: separation yields to whatever else you're doing.
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch (_) {}
      let buf = '';
      let errTail = '';
      child.stdout.on('data', (d) => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch (_) {
            continue;
          }
          const cur = this.states.get(job.songId) || {};
          if (ev.event === 'progress') this._set(job.songId, { ...cur, state: 'running', progress: ev.value, message: device ? `Separating on ${device}` : 'Separating', device: deviceKind, deviceName: device });
          else if (ev.event === 'status') {
            if (/GPU|CPU/.test(ev.message)) note = ev.message;
            this._set(job.songId, { ...cur, state: 'running', message: ev.message, note });
          } else if (ev.event === 'device') {
            deviceKind = ev.device;
            device = ev.device === 'cuda' ? ev.name || 'GPU' : 'CPU';
            this.log(`Separating ${song.title} on ${device}${ev.threads ? ` (${ev.threads} CPU threads)` : ''}${ev.fallback ? `; GPU ${ev.fallback}` : ''}`);
            this._set(job.songId, { ...cur, state: 'running', device: deviceKind, deviceName: device, note });
          }
          else if (ev.event === 'done') doneEvent = ev;
          else if (ev.event === 'error') errorEvent = ev;
        }
      });
      child.stderr.on('data', (d) => {
        errTail = (errTail + d.toString()).slice(-3000);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (job.cancelled) return reject(new Error('Cancelled'));
        if (code === 0 && doneEvent) return resolve();
        const msg = errorEvent ? errorEvent.message : errTail.trim().split('\n').slice(-1)[0] || `Engine exited with code ${code}`;
        this.log(`Stem engine output:\n${errTail}`);
        reject(new Error(msg));
      });
    }).catch(async (err) => {
      await fsp.rm(work, { recursive: true, force: true });
      throw err;
    });

    const meta = { model, stems: doneEvent.stems, sampleRate: doneEvent.sampleRate, frames: doneEvent.frames, seconds: doneEvent.seconds, device: doneEvent.device, deviceName: device, createdAt: Date.now() };
    await fsp.writeFile(path.join(work, 'meta.json'), JSON.stringify(meta, null, 1));
    await fsp.rm(final, { recursive: true, force: true });
    await fsp.rename(work, final);
    const ready = this._readyIn(info.key, model);
    this.states.delete(job.songId);
    this.emit('update', { songId: job.songId, state: 'ready', ...ready });
    this.log(`Stems for ${song.title} took ${meta.seconds}s on ${device || meta.device}`);
    this.emit('done', { songId: job.songId, ...ready, seconds: meta.seconds, device: meta.device, deviceName: device, note });
  }
}

module.exports = { StemService, MODELS };
