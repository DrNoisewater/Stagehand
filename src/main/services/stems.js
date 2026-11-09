'use strict';
/**
 * Stem separation queue. One job runs at a time (it uses the whole GPU/CPU);
 * results are cached per audio hash and model so they survive edits/renames.
 *
 * 4.4: one stem engine stays open between songs (`--serve`), so the model is
 * loaded once. Stopping a split asks the engine to cancel it; if it doesn't
 * stop soon, the engine is closed with everything it started (on Windows a
 * venv's python.exe starts the real Python as a child, and killing only the
 * first left splits running in the background, slowing every later one).
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const MODELS = {
  htdemucs_6s: { label: '6 stems: guitar, bass, drums, vocals, piano, other', stems: ['guitar', 'bass', 'drums', 'vocals', 'piano', 'other'] },
  htdemucs_ft: { label: '4 stems, highest quality (slower)', stems: ['bass', 'drums', 'vocals', 'other'] },
  htdemucs: { label: '4 stems, fast', stems: ['bass', 'drums', 'vocals', 'other'] },
};

const EXT = { wav: 'wav', flac: 'flac', opus192: 'opus', opus128: 'opus', opus256: 'opus' };

const IS_WIN = process.platform === 'win32';
// how long a split may take to stop after it's asked to, before the engine is closed
const STOP_GRACE_MS = 4000;
// songs split ahead because you picked them in the list: at most this many waiting
const AHEAD_MAX = 3;
// seconds of splitting per second of song, before this PC has split anything
const RATE_GUESS = { cuda: 0.12, cpu: 1.0 };

const KEY_RE = /^[a-f0-9]{8,40}$/;

/**
 * 4.4: a song's stem folder is named after it, so it can be found in Explorer:
 * "Artist - Title [1a2b3c4d]". The bracket holds the start of the audio key, and the
 * folder's meta.json holds the whole key: that is what the app goes by.
 */
function folderName(song, key) {
  const raw = [song && song.artist, song && song.title].filter(Boolean).join(' - ') || 'Song';
  let n = String(raw)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `_${n}`;
  return `${n || 'Song'} [${key.slice(0, 8)}]`;
}

/** Ends a process and everything it started (on Windows, a venv python.exe is a launcher). */
function killTree(child) {
  if (!child || child.exitCode !== null || child.killedTree) return;
  child.killedTree = true;
  try {
    if (child.stdin) child.stdin.end(); // the engine quits by itself when this closes
  } catch (_) {}
  if (IS_WIN && child.pid) {
    // the whole tree first: once the launcher is gone, its child can't be found from it
    let k;
    try {
      k = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch (_) {}
    if (k) {
      k.on('error', () => child.kill());
      k.on('exit', () => child.kill());
      return;
    }
  }
  child.kill();
}

class StemService extends EventEmitter {
  constructor({ stemsDir, audio, tools, settings, library, engineScript, log = () => {}, stopGraceMs = STOP_GRACE_MS }) {
    super();
    this.stopGraceMs = stopGraceMs;
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
    this.worker = null; // the stem engine that stays open between songs
    this.seq = 0;
    this.rates = { cuda: [], cpu: [] }; // past splits: seconds per second of song
    // 4.4: which folder holds each audio key's stems, and what's in them, kept in memory:
    // asking the disk for every song in the library each time grew with the library
    this.index = null; // audio key -> folder name
    this.cache = new Map(); // `${key}/${model}` -> ready info (or null)
    this.busy = new Set(); // keys being written now (not renamed meanwhile)
    this.doneAt = new Map(); // key -> when its split finished (for the storing time)
  }

  // ------------------------------------------------------- folders --
  /** Finds every song's stem folder (once; the index is kept up to date after that). */
  _idx() {
    if (this.index) return this.index;
    this.index = new Map();
    let names = [];
    try {
      names = fs.readdirSync(this.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (_) {}
    for (const name of names) {
      if (KEY_RE.test(name)) {
        if (!this.index.has(name)) this.index.set(name, name); // the old layout: the bare key
        continue;
      }
      const m = /\[([a-f0-9]{8})\]$/.exec(name);
      if (!m) continue;
      for (const model of Object.keys(MODELS)) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(this.dir, name, model, 'meta.json'), 'utf8'));
          if (meta.key && meta.key.startsWith(m[1])) this.index.set(meta.key, name);
          break;
        } catch (_) {}
      }
    }
    return this.index;
  }

  /** The folder that holds (or will hold) this key's stems. */
  keyDir(key) {
    return path.join(this.dir, this._idx().get(key) || key);
  }

  /** The file behind a stagehand://stems/<key>/<model>/<file> address. */
  fileFor(key, model, file) {
    if (!KEY_RE.test(key) || !MODELS[model]) return null;
    return path.join(this.keyDir(key), model, file);
  }

  _forget(key) {
    for (const m of Object.keys(MODELS)) this.cache.delete(`${key}/${m}`);
  }

  /** Clears every stem (Settings › storage). */
  async clearAll() {
    await fsp.rm(this.dir, { recursive: true, force: true });
    this.index = new Map();
    this.cache.clear();
  }

  model() {
    const m = this.settings.get().stems.model;
    return MODELS[m] ? m : 'htdemucs_6s';
  }

  _readyIn(key, model) {
    if (!key || !this._idx().has(key)) return null; // (no folder: nothing to ask the disk)
    const ck = `${key}/${model}`;
    if (this.cache.has(ck)) return this.cache.get(ck);
    const r = this._readyRead(key, model);
    this.cache.set(ck, r);
    return r;
  }

  _readyRead(key, model) {
    const dir = path.join(this.keyDir(key), model);
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
    const dir = path.join(this.keyDir(song.audioKey), model);
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
    const dir = path.join(this.keyDir(song.audioKey), model);
    const metaFile = path.join(dir, 'meta.json');
    const meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
    const ext = EXT[format];
    if (!meta.stems.every((s) => fs.existsSync(path.join(dir, `${s}.${ext}`)))) throw new Error('Some stems are missing in the new format');
    meta.format = format;
    meta.tidy = true; // the old files go at the next start
    await fsp.writeFile(`${metaFile}.part`, JSON.stringify(meta, null, 1));
    await fsp.rename(`${metaFile}.part`, metaFile);
    this._forget(song.audioKey);
    const done = this.doneAt.get(song.audioKey);
    if (done) {
      this.doneAt.delete(song.audioKey);
      this.log(`Stems for ${song.title} stored as ${format} in ${((Date.now() - done) / 1000).toFixed(1)} s`);
    }
    // The old files stay until the next start: a song that's open may still be reading them.
    this.emit('update', { songId: song.id, state: 'ready', ...this._readyIn(song.audioKey, model) });
    return this._readyIn(song.audioKey, model);
  }

  /**
   * At start: once, clear every stem (the user asked to remake them all as
   * FLAC). Then find the stem folders (quick), and tidy up in the background:
   * leftover files from a format switch, unfinished splits, and old folders
   * named by their key get the song's name.
   */
  async startup({ background = true } = {}) {
    const st = this.settings.get().stems || {};
    try {
      if (!st.cleared310) {
        await fsp.rm(this.dir, { recursive: true, force: true });
        await fsp.mkdir(this.dir, { recursive: true });
        this.settings.set({ stems: { cleared310: true, format: 'flac' } });
        this.log('Stems: cleared all stems (3.1 reset)');
        this.index = new Map();
        return;
      }
      // splits that never finished (the app closed, or the PC stopped)
      await fsp.rm(path.join(this.dir, '.work'), { recursive: true, force: true });
      this.index = null;
      this._idx();
    } catch (err) {
      this.log(`Stems: start failed: ${err.message}`);
    }
    const tidy = () => this.tidy().catch((err) => this.log(`Stems: tidying failed: ${err.message}`));
    if (background) this.tidying = new Promise((r) => setTimeout(r, 4000)).then(tidy);
    else await tidy();
  }

  /** The background part of startup (one folder at a time, never in the way of a split). */
  async tidy() {
    const st = this.settings.get().stems || {};
    const all = !st.tidied44; // once: look everywhere (older versions left files from format switches)
    const byKey = new Map();
    const songs = (this.library && this.library.data && this.library.data.songs) || {};
    for (const s of Object.values(songs)) if (s && s.audioKey && !byKey.has(s.audioKey)) byKey.set(s.audioKey, s);
    const t0 = Date.now();
    let renamed = 0;
    for (const [key, name] of [...this._idx()]) {
      if (this.busy.has(key)) continue;
      let dir = path.join(this.dir, name);
      try {
        const song = byKey.get(key);
        if (all) for (const f of await fsp.readdir(dir)) if (f.endsWith('.work')) await fsp.rm(path.join(dir, f), { recursive: true, force: true }); // (where older versions kept them)
        for (const model of Object.keys(MODELS)) {
          const mdir = path.join(dir, model);
          const metaFile = path.join(mdir, 'meta.json');
          let meta;
          try {
            meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
          } catch (_) {
            continue;
          }
          this._learn(meta);
          let changed = false;
          if ((all || meta.tidy) && Array.isArray(meta.stems)) {
            const ext = EXT[meta.format] || 'wav';
            if (meta.stems.every((s) => fs.existsSync(path.join(mdir, `${s}.${ext}`)))) {
              for (const s of meta.stems) for (const e of ['wav', 'flac', 'opus']) if (e !== ext) await fsp.rm(path.join(mdir, `${s}.${e}`), { force: true });
              if (meta.tidy) {
                delete meta.tidy;
                changed = true;
              }
            }
          }
          if (!meta.key || (song && (meta.title !== song.title || meta.artist !== song.artist))) {
            meta.key = key;
            if (song) Object.assign(meta, { title: song.title || '', artist: song.artist || '' });
            changed = true;
          }
          if (changed) {
            await fsp.writeFile(`${metaFile}.part`, JSON.stringify(meta, null, 1));
            await fsp.rename(`${metaFile}.part`, metaFile);
          }
        }
        // an old folder named by its key: give it the song's name
        const want = song ? folderName(song, key) : null;
        if (want && name === key && !this.busy.has(key) && !fs.existsSync(path.join(this.dir, want))) {
          try {
            await fsp.rename(dir, path.join(this.dir, want));
            this.index.set(key, want);
            this._forget(key);
            renamed++;
          } catch (_) {} // (a file in use: try again next time)
        }
      } catch (_) {}
    }
    if (!st.tidied44 && this.settings.set) this.settings.set({ stems: { tidied44: true } });
    this.log(`Stems: ${this.index.size} songs with stems; tidied in ${Date.now() - t0} ms${renamed ? `, ${renamed} folders named after their songs` : ''}`);
  }

  /** Remembers how fast a past split went, for the time-left guess. */
  _learn(meta, at) {
    if (!meta || !meta.seconds || !meta.frames || !meta.sampleRate) return;
    const list = this.rates[meta.device === 'cuda' ? 'cuda' : 'cpu'];
    list.push({ rate: meta.seconds / (meta.frames / meta.sampleRate), at: at || meta.createdAt || 0 });
    list.sort((a, b) => a.at - b.at);
    if (list.length > 20) list.splice(0, list.length - 20);
  }

  /** About how long a split of this song takes, before it shows any progress. */
  _guess(song, kind) {
    if (!kind) {
      const s = this.settings.get().stems || {};
      const last = (l) => (l.length ? l[l.length - 1].at : -1);
      kind = s.device === 'cpu' ? 'cpu' : last(this.rates.cuda) >= last(this.rates.cpu) && this.rates.cuda.length ? 'cuda' : this.rates.cpu.length ? 'cpu' : 'cuda';
    }
    const list = this.rates[kind].slice(-8).map((r) => r.rate).sort((a, b) => a - b);
    const rate = list.length ? list[list.length >> 1] : RATE_GUESS[kind];
    const secs = (song && song.length) || 240;
    // a fresh engine has to start up and load the model first
    const warm = this.worker && !this.worker.dead && this.worker.used;
    return rate * secs + (warm ? 2 : 10);
  }

  /** Time left for a running split: from how fast it's going, smoothed; a guess before it starts. */
  _eta(job, song, progress) {
    const now = Date.now();
    let at;
    if (progress > 0.03 && job.sepStart) {
      const took = now - job.sepStart;
      at = now + (took * (1 - progress)) / progress + 1500; // (+ writing the stems)
      job.etaAt = job.etaAt && job.measured ? job.etaAt * 0.7 + at * 0.3 : at;
      job.measured = true;
    } else if (!job.measured) {
      job.etaAt = job.startedAt + this._guess(song, job.deviceKind) * 1000;
      // the guess ran out and there's no progress yet: no time to show
      if (job.etaAt < now) job.etaAt = null;
    }
    return { startedAt: job.startedAt, etaAt: job.etaAt || null, eta: job.etaAt ? Math.max(0, Math.round((job.etaAt - now) / 1000)) : null };
  }

  /** Every song with stems: its format and size on disk. */
  formats(songs) {
    const out = [];
    for (const song of songs) {
      if (!song.audioKey) continue;
      for (const model of Object.keys(MODELS)) {
        const r = this._readyIn(song.audioKey, model);
        if (!r) continue;
        const dir = path.join(this.keyDir(song.audioKey), model);
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

  /** A running split's news, with its time left. */
  _running(job, song, st) {
    this._set(job.songId, { ...st, state: 'running', ...this._eta(job, song, st.progress || 0) });
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
      // no song audio anywhere: nothing to split (official DLC may have it in another file)
      if (song.audioEntry === null && !song.audioFrom && (song.toolkit || song.author || song.packageVersion)) continue;
      if (this.current && this.current.songId === id) {
        this.current.ahead = false;
        continue;
      }
      const queued = this.queue.find((j) => j.songId === id);
      if (queued) {
        queued.ahead = false; // you asked for it: it stays in line
        continue;
      }
      if (!force && this.ready(song)) continue;
      this.queue.push({ songId: id, force });
      this._set(id, { state: 'queued', progress: 0, message: 'Waiting' });
    }
    this._pump();
    return this.queueInfo();
  }

  /**
   * 4.4: a song you picked in the list is split ahead, so it's often ready by the
   * time you press play. It waits behind songs being opened to play and never
   * stops a split that's running. Only the last few picks wait; older ones drop out.
   */
  ahead(songId) {
    const song = this.library.get(songId);
    if (!song || !this.tools.enginePython()) return false;
    if (song.audioEntry === null && !song.audioFrom && (song.toolkit || song.author || song.packageVersion)) return false;
    if ((this.current && this.current.songId === songId) || this.queue.some((j) => j.songId === songId)) return false;
    if (this.ready(song)) return false;
    const older = this.queue.filter((j) => j.ahead).sort((a, b) => a.pickedAt - b.pickedAt);
    while (older.length >= AHEAD_MAX) {
      const drop = older.shift();
      this.queue.splice(this.queue.indexOf(drop), 1);
      this.states.delete(drop.songId);
      this.emit('update', { songId: drop.songId, state: 'none' });
    }
    // after the songs opened to play, before everything else
    let at = this.queue.findIndex((j) => !j.playing);
    if (at < 0) at = this.queue.length;
    this.queue.splice(at, 0, { songId, force: false, ahead: true, pickedAt: ++this.seq });
    this._set(songId, { state: 'queued', progress: 0, message: 'Waiting' });
    this._pump();
    return true;
  }

  /** Moves a queued song to the front (e.g. the one being listened to). */
  prioritize(songId, { now = false } = {}) {
    const i = this.queue.findIndex((j) => j.songId === songId);
    if (i > 0) this.queue.unshift(this.queue.splice(i, 1)[0]);
    if (i >= 0) {
      this.queue[0].ahead = false;
      if (now) this.queue[0].playing = true;
    }
    if (this.current && this.current.songId === songId) {
      this.current.ahead = false;
      if (now && !this.current.playing) {
        // you're waiting for this one now: full speed
        this.current.playing = true;
        this._tune(this.current);
      }
    }
    // 3.8: the song you just opened to play goes first, right now: a split of another
    // song that's running is stopped and put back in line right after it
    // 4.0: also while that split is still getting its audio ready (no engine running yet):
    // it used to carry on regardless, and the song you opened waited for the whole split
    if (now && this.queue.length && this.queue[0].songId === songId && this.current && this.current.songId !== songId && !this.current.cancelled && !this.current.requeue) {
      this.current.requeue = true;
      this.log(`Stems: ${songId} jumps ahead of ${this.current.songId}`);
      this._stop(this.current);
    }
  }

  cancel(songId) {
    const i = this.queue.findIndex((j) => j.songId === songId);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.states.delete(songId);
      this.emit('update', { songId, state: 'none' });
    }
    if (this.current && this.current.songId === songId) {
      this.current.cancelled = true; // (checked before the engine starts, too)
      this._stop(this.current);
    }
  }

  /** Stops the running split: the engine is asked first, and closed if it doesn't stop soon. */
  _stop(job) {
    if (job.wake) job.wake();
    const w = job.worker;
    if (!w || !job.jobId || w.dead) return;
    this._send(w, { cmd: 'cancel', id: job.jobId });
    clearTimeout(job.stopTimer);
    job.stopTimer = setTimeout(() => {
      if (!job.finished && !w.dead) {
        this.log('Stems: the engine did not stop in time, closing it');
        this._closeWorker(w);
      }
    }, this.stopGraceMs);
  }

  _userLoad() {
    const l = (this.settings.get().stems || {}).cpuLoad;
    return ['full', 'half', 'low'].includes(l) ? l : 'full';
  }

  /** CPU threads for a split: half of them for a split in the background while a song plays. */
  _load(job) {
    const user = this._userLoad();
    return user === 'full' && this.playing && !job.playing ? 'half' : user;
  }

  /** Tells the engine a running split's new priority and CPU share. */
  _tune(job) {
    const w = job.worker;
    if (!w || w.dead || !job.jobId || job.finished) return;
    this._send(w, { cmd: 'priority', level: job.playing ? 'normal' : 'low' });
    const load = this._load(job);
    if (load !== job.load) {
      job.load = load;
      this._send(w, { cmd: 'load', level: load });
    }
  }

  /** A song started or stopped playing (a split in the background takes half the CPU meanwhile). */
  setPlaying(on) {
    on = !!on;
    if (on === !!this.playing) return;
    this.playing = on;
    if (this.current) this._tune(this.current);
  }

  /** Closes the stem engine (when the app quits). */
  stopAll() {
    this.queue = [];
    if (this.current) this.current.cancelled = true;
    if (this.worker) this._closeWorker(this.worker);
  }

  // ------------------------------------------------------ the engine --
  /** The stem engine that stays open, started when needed. */
  _engine(python) {
    let w = this.worker;
    if (w && !w.dead && w.python === python) return w;
    if (w) this._closeWorker(w); // the engine was changed in Settings
    const child = spawn(python, ['-u', this.script, '--serve'], { env: { ...process.env, ...this.tools.engineEnv() }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    w = { child, python, jobs: new Map(), dead: false, used: false, errTail: '' };
    this.worker = w;
    // (each split sets its own priority from inside the engine: on Windows this
    // process is only a launcher, the real Python is its child)
    if (child.stdin) child.stdin.on('error', () => {}); // (writing to an engine that just quit)
    let buf = '';
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
        const fn = ev.job != null && w.jobs.get(String(ev.job));
        if (fn) fn(ev);
      }
    });
    child.stderr.on('data', (d) => {
      w.errTail = (w.errTail + d.toString()).slice(-3000);
    });
    const gone = (code, err) => {
      if (w.dead && !w.jobs.size) return;
      w.dead = true;
      if (this.worker === w) this.worker = null;
      for (const fn of [...w.jobs.values()]) fn({ event: 'exit', code, error: err });
      w.jobs.clear();
    };
    child.on('error', (err) => gone(null, err));
    child.on('close', (code) => gone(code));
    return w;
  }

  _send(w, msg) {
    try {
      if (w.child.stdin && !w.child.stdin.destroyed) w.child.stdin.write(JSON.stringify(msg) + '\n');
    } catch (_) {}
  }

  _closeWorker(w) {
    w.dead = true;
    if (this.worker === w) this.worker = null;
    killTree(w.child);
  }

  async remove(song) {
    if (!song || !song.audioKey) return;
    await fsp.rm(this.keyDir(song.audioKey), { recursive: true, force: true });
    this._idx().delete(song.audioKey);
    this._forget(song.audioKey);
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
    const stopped = () => {
      if (job.requeue) throw new Error('Moved back in line');
      if (job.cancelled) throw new Error('Cancelled');
    };
    job.startedAt = Date.now();
    this._running(job, song, { progress: 0, message: 'Decoding audio' });
    // don't hold the song you opened up while this one's audio decodes: give way at once
    // (the decode carries on by itself and is kept for later)
    const giveWay = new Promise((resolve) => (job.wake = resolve));
    const decoding = this.audio.prepare(song);
    decoding.catch(() => {});
    const info = await Promise.race([decoding, giveWay]);
    job.wake = null;
    stopped(); // another song jumped ahead (or this was cancelled) while the audio was being decoded
    const model = this.model();
    const work = path.join(this.dir, '.work', `${info.key}.${model}.${crypto.randomBytes(3).toString('hex')}`);
    await fsp.mkdir(work, { recursive: true });
    const tm = { start: job.startedAt, decoded: Date.now(), warm: !!(this.worker && !this.worker.dead && this.worker.used) };
    const s = this.settings.get().stems;
    this._running(job, song, { progress: 0, message: 'Starting engine' });

    let doneEvent = null;
    let device = null;
    let note = null;
    const w = this._engine(python);
    const id = `j${++this.seq}`;
    job.worker = w;
    job.jobId = id;
    w.errTail = '';
    await new Promise((resolve, reject) => {
      const stoppedErr = () => (job.cancelled ? new Error('Cancelled') : job.requeue ? new Error('Moved back in line') : null);
      w.jobs.set(id, (ev) => {
        if (!tm.first) tm.first = Date.now();
        if (ev.event === 'status' && ev.message === 'Loading model') tm.load = Date.now();
        if (ev.event === 'status' && ev.message === 'Separating') tm.sep = Date.now();
        if (ev.event === 'status' && ev.message === 'Writing stems') tm.write = Date.now();
        if (ev.event === 'device' && !tm.device) tm.device = Date.now();
        const cur = this.states.get(job.songId) || {};
        if (ev.event === 'progress') {
          if (!job.sepStart) job.sepStart = Date.now();
          this._running(job, song, { ...cur, progress: ev.value, message: device ? `Separating on ${device}` : 'Separating', device: job.deviceKind, deviceName: device });
        } else if (ev.event === 'status') {
          if (/GPU|CPU/.test(ev.message)) note = ev.message;
          if (ev.message === 'Separating') job.sepStart = Date.now();
          this._running(job, song, { ...cur, message: ev.message, note });
        } else if (ev.event === 'device') {
          job.deviceKind = ev.device;
          device = ev.device === 'cuda' ? ev.name || 'GPU' : 'CPU';
          this.log(
            `Separating ${song.title} on ${device}${ev.threads ? `, ${ev.threads} CPU threads (${job.load}${job.load !== this._userLoad() ? ' while a song plays' : ''})` : ''}` +
              `${ev.cores ? `, ${ev.physical || '?'} cores (${ev.cores} with hyperthreads)` : ''}, ${job.playing ? 'normal priority: you are waiting for it' : 'below normal priority'}${ev.fallback ? `; GPU ${ev.fallback}` : ''}`
          );
          this._running(job, song, { ...cur, device: job.deviceKind, deviceName: device, note });
        } else if (ev.event === 'threads') {
          this.log(`Stems: ${song.title} now uses ${ev.threads} CPU threads (${ev.level})`);
        } else if (ev.event === 'done') {
          doneEvent = ev;
          // (stopped so another song could go first, but finished anyway: keep it)
          if (job.cancelled) reject(new Error('Cancelled'));
          else resolve();
        } else if (ev.event === 'error') {
          if (ev.cancelled || stoppedErr()) return reject(stoppedErr() || new Error('Cancelled'));
          if (w.errTail.trim()) this.log(`Stem engine output:\n${w.errTail}`);
          // start the next song on a fresh engine, in case this left it in a bad way
          this._closeWorker(w);
          reject(new Error(ev.message || 'Stem separation failed'));
        } else if (ev.event === 'exit') {
          if (stoppedErr()) return reject(stoppedErr());
          if (ev.error) return reject(ev.error);
          this.log(`Stem engine output:\n${w.errTail}`);
          reject(new Error(w.errTail.trim().split('\n').slice(-1)[0] || `Engine exited with code ${ev.code}`));
        }
      });
      this._send(w, {
        cmd: 'split',
        id,
        input: this.audio.wavPath(info.key),
        outdir: work,
        model,
        shifts: s.shifts || 1,
        device: s.device || 'auto',
        cpu_load: (job.load = this._load(job)),
        // the song you're waiting for runs at normal priority; splits in the background
        // stay below normal so the app stays smooth
        priority: job.playing ? 'normal' : 'low',
      });
      tm.sent = Date.now();
      w.used = true;
      if (job.requeue || job.cancelled) this._stop(job); // stopped between the last check and now
    })
      .catch(async (err) => {
        await fsp.rm(work, { recursive: true, force: true });
        throw err;
      })
      .finally(() => {
        job.finished = true;
        clearTimeout(job.stopTimer);
        w.jobs.delete(id);
      });

    tm.done = Date.now();
    const meta = { model, key: info.key, title: song.title || '', artist: song.artist || '', stems: doneEvent.stems, sampleRate: doneEvent.sampleRate, frames: doneEvent.frames, seconds: doneEvent.seconds, device: doneEvent.device, deviceName: device, createdAt: Date.now() };
    this._learn(meta);
    await fsp.writeFile(path.join(work, 'meta.json'), JSON.stringify(meta, null, 1));
    this.busy.add(info.key);
    try {
      const idx = this._idx();
      let name = idx.get(info.key);
      if (!name) {
        name = folderName(song, info.key);
        if (fs.existsSync(path.join(this.dir, name))) name = info.key; // (taken by another song: very unlikely)
      }
      const final = path.join(this.dir, name, model);
      await fsp.mkdir(path.dirname(final), { recursive: true });
      await fsp.rm(final, { recursive: true, force: true });
      await fsp.rename(work, final);
      idx.set(info.key, name);
      this._forget(info.key);
    } finally {
      this.busy.delete(info.key);
    }
    const ready = this._readyIn(info.key, model);
    this.states.delete(job.songId);
    this.emit('update', { songId: job.songId, state: 'ready', ...ready });
    this.doneAt.set(info.key, Date.now());
    const sec = (a, b) => (a && b ? `${((b - a) / 1000).toFixed(1)} s` : '?');
    this.log(
      `Stems for ${song.title} took ${meta.seconds}s on ${device || meta.device}. ` +
        `Timing: decode ${sec(tm.start, tm.decoded)}, engine start ${sec(tm.sent, tm.first)}${tm.warm ? ' (already open)' : ''}, ` +
        `model ${tm.load ? sec(tm.load, tm.device) : 'already loaded'}, separate ${sec(tm.sep, tm.write)}, write ${sec(tm.write, tm.done)}, save ${sec(tm.done, Date.now())}`
    );
    this.emit('done', { songId: job.songId, ...ready, seconds: meta.seconds, device: meta.device, deviceName: device, note });
  }
}

module.exports = { StemService, MODELS, folderName };
