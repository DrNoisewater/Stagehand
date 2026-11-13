'use strict';
/**
 * Practice stats (stats.json) and your recorded takes (WAV files in the
 * Takes folder of the app's data folder).
 *
 * A session: { songId, part, seconds, accuracy (0–1 or null), notes, hit, at (ms) }
 * Free playing (no song) is logged with songId null.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('../core/files');

const DAY = 24 * 60 * 60 * 1000;

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 4.5: the most sessions kept one by one; older ones are folded into `archive` (totals), never thrown away. */
const KEEP_SESSIONS = 50000;

/** Adds sessions into the archive's running totals (the lifetime numbers keep them). */
function foldIntoArchive(archive, list) {
  const a = archive || emptyArchive();
  const songs = new Set(a.songs);
  const days = new Set(a.days);
  for (const s of list) {
    if (!s) continue;
    a.count++;
    a.seconds += Number(s.seconds) || 0;
    a.notes += Number(s.notes) || 0;
    a.hit += Number(s.hit) || 0;
    if (s.full) a.full++;
    if (s.songId && s.seconds >= 30) songs.add(s.songId);
    if (s.at) {
      days.add(dayKey(s.at));
      a.firstAt = a.firstAt ? Math.min(a.firstAt, s.at) : s.at;
      a.lastAt = Math.max(a.lastAt || 0, s.at);
    }
    for (const [k, v] of Object.entries(s.kinds || {})) {
      const o = (a.kinds[k] = a.kinds[k] || [0, 0]);
      o[0] += Number(v[0]) || 0;
      o[1] += Number(v[1]) || 0;
    }
    if (s.full && (s.speed || 1) >= 0.999 && s.notes >= 50 && s.accuracy !== null && s.accuracy !== undefined) a.bestAcc = Math.max(a.bestAcc || 0, s.accuracy);
    a.bestStreak = Math.max(a.bestStreak || 0, Number(s.bestStreak) || 0);
  }
  a.songs = [...songs];
  a.days = [...days].sort();
  return a;
}
const emptyArchive = () => ({ count: 0, seconds: 0, notes: 0, hit: 0, full: 0, kinds: {}, songs: [], days: [], firstAt: 0, lastAt: 0, bestAcc: 0, bestStreak: 0 });

class Stats {
  /**
   * @param {string} file stats.json
   * @param {object} [o]
   * @param {object} [o.backups] CareerBackups, to recover a damaged file
   * @param {Function} [o.log]
   */
  constructor(file, { backups = null, log = () => {} } = {}) {
    this.file = file;
    this.backups = backups;
    this._log = log; // (not `log`: that's the method that logs a session)
    this.data = { sessions: [] };
    this._timer = null;
    this.recovered = null;
  }

  async load() {
    // 4.5: a file that won't read is never written over: it's set aside and the newest backup is used
    let d;
    if (this.backups) {
      const r = await this.backups.safeRead(this.file, null);
      d = r.data;
      if (r.corrupt) this.recovered = { corrupt: r.corrupt, from: r.recovered };
    } else d = await readJson(this.file, null);
    if (d && Array.isArray(d.sessions)) {
      this.data = { sessions: d.sessions };
      if (d.archive && typeof d.archive === 'object') this.data.archive = { ...emptyArchive(), ...d.archive };
    }
    return true;
  }

  /** Removes sessions (for the developer menu: test data). Returns how many went. */
  removeWhere(pred) {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => !pred(s));
    const n = before - this.data.sessions.length;
    if (n) this.saveSoon();
    return n;
  }

  /** Drops sessions logged twice (same time, song, part and length). Returns how many went. */
  dedupe() {
    const seen = new Set();
    return this.removeWhere((s) => {
      const k = `${s.at}|${s.songId}|${s.part}|${s.seconds}`;
      if (seen.has(k)) return true;
      seen.add(k);
      return false;
    });
  }

  log(s) {
    if (!s || !(Number(s.seconds) >= 5)) return null;
    const e = {
      songId: s.songId || null,
      part: s.part || null,
      seconds: Math.round(Number(s.seconds)),
      accuracy: s.accuracy === null || s.accuracy === undefined || !Number.isFinite(Number(s.accuracy)) ? null : Math.max(0, Math.min(1, Number(s.accuracy))),
      notes: Number(s.notes) || 0,
      hit: Number(s.hit) || 0,
      speed: Number(s.speed) || 1,
      at: Number(s.at) || Date.now(),
    };
    // 3.9: the breakdown of the run (sections, kinds of notes, longest streak), for Progress
    if (Array.isArray(s.sections)) e.sections = s.sections.slice(0, 60).filter((x) => Array.isArray(x) && x.length === 3).map(([l, h, n]) => [String(l).slice(0, 40), Number(h) || 0, Number(n) || 0]);
    if (s.kinds && typeof s.kinds === 'object') {
      e.kinds = {};
      for (const [k, v] of Object.entries(s.kinds)) if (/^[a-z]{3,10}$/.test(k) && Array.isArray(v)) e.kinds[k] = [Number(v[0]) || 0, Number(v[1]) || 0];
    }
    if (Number.isFinite(Number(s.bestStreak))) e.bestStreak = Number(s.bestStreak);
    // 4.4: for levels: played start to finish, and the tuning's name
    if (s.full === true) e.full = true;
    if (typeof s.tuning === 'string' && s.tuning) e.tuning = s.tuning.slice(0, 40);
    // 4.5: the same session twice in a row (a double checkpoint) is not counted again
    const prev = this.data.sessions[this.data.sessions.length - 1];
    if (prev && prev.at === e.at && prev.songId === e.songId && prev.part === e.part && prev.seconds === e.seconds && prev.notes === e.notes) return prev;
    this.data.sessions.push(e);
    if (this.data.sessions.length > KEEP_SESSIONS) {
      const old = this.data.sessions.splice(0, this.data.sessions.length - KEEP_SESSIONS);
      this.data.archive = foldIntoArchive(this.data.archive, old);
    }
    this.saveSoon();
    return e;
  }

  /** Best accuracy per song and part (full-speed passes count; slower ones are shown separately). */
  best() {
    const out = {};
    for (const s of this.data.sessions) {
      if (!s.songId || s.accuracy === null || s.notes < 20 || (s.speed || 1) < 0.999) continue;
      const o = (out[s.songId] = out[s.songId] || {});
      const k = s.part || 'lead';
      if (o[k] === undefined || s.accuracy > o[k]) o[k] = s.accuracy;
      // 4.12: a singing score has its own best (vocals); the song's best stays about playing it
      if (k !== 'vocals' && (o.best === undefined || s.accuracy > o.best)) o.best = s.accuracy;
    }
    return out;
  }

  goals(now=Date.now(),bestStreak=0){
    const date=new Date(now),month=new Date(date.getFullYear(),date.getMonth(),1).getTime();
    const mastered=new Set(this.data.sessions.filter(s=>s.at>=month&&s.songId&&s.notes>=100&&s.accuracy>=.95&&s.speed>=.999).map(s=>s.songId));
    const perfect=this.data.sessions.some(s=>s.speed>=.999&&(s.sections||[]).some(([,h,n])=>n>=10&&h===n));
    return [
      {id:`master-${date.getFullYear()}-${date.getMonth()+1}`,name:'Master 5 songs this month',detail:'95% accuracy · 100+ notes · full speed',value:Math.min(5,mastered.size),target:5},
      {id:'streak7',name:'7-day streak',detail:'Play on seven consecutive days',value:Math.min(7,bestStreak),target:7},
      {id:'perfect-section',name:'First 100% section',detail:'10+ notes · full speed',value:perfect?1:0,target:1}
    ];
  }

  /** Totals for a period: 'week' | 'month' | 'all'. */
  summary(period = 'week', now = Date.now()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const days = period === 'week' ? 7 : period === 'month' ? 30 : 0;
    const from = days ? start.getTime() - (days - 1) * DAY : 0;
    const prevFrom = days ? from - days * DAY : 0;
    const all = this.data.sessions;
    const inRange = all.filter((s) => s.at >= from);
    const prev = days ? all.filter((s) => s.at >= prevFrom && s.at < from) : [];
    const secs = (l) => l.reduce((a, s) => a + s.seconds, 0);
    const acc = (l) => {
      let n = 0;
      let h = 0;
      for (const s of l) if (s.accuracy !== null && s.notes) (n += s.notes), (h += s.accuracy * s.notes);
      return n ? h / n : null;
    };
    // minutes per day (last 7 or 30 days; all time shows the last 30)
    const span = days || 30;
    const perDay = [];
    const byDay = new Map();
    for (const s of all) byDay.set(dayKey(s.at), (byDay.get(dayKey(s.at)) || 0) + s.seconds);
    for (let i = span - 1; i >= 0; i--) {
      const t = start.getTime() - i * DAY;
      perDay.push({ day: dayKey(t), at: t, minutes: Math.round((byDay.get(dayKey(t)) || 0) / 60) });
    }
    // streak: consecutive days up to today (or yesterday) with any playing
    const played = new Set([...byDay.keys()]);
    let streak = 0;
    let cursor = start.getTime();
    if (!played.has(dayKey(cursor))) cursor -= DAY;
    while (played.has(dayKey(cursor))) {
      streak++;
      cursor -= DAY;
    }
    let bestStreak = 0;
    let run = 0;
    let last = null;
    for (const d of [...played].sort()) {
      const t = new Date(`${d}T12:00:00`).getTime();
      run = last !== null && Math.round((t - last) / DAY) === 1 ? run + 1 : 1;
      last = t;
      bestStreak = Math.max(bestStreak, run);
    }
    const songIds = new Set(inRange.filter((s) => s.songId).map((s) => s.songId));
    const prevIds = new Set(all.filter((s) => s.songId && s.at < from).map((s) => s.songId));
    // songs you're working on: most practised in the period, with a trend of session accuracies
    const bySong = new Map();
    for (const s of all) {
      if (!s.songId || s.accuracy === null) continue;
      const k = `${s.songId}|${s.part || ''}`;
      if (!bySong.has(k)) bySong.set(k, { songId: s.songId, part: s.part, sessions: 0, trend: [], best: 0, recent: 0, last: 0 });
      const o = bySong.get(k);
      o.sessions++;
      o.trend.push(Math.round(s.accuracy * 100));
      if (o.trend.length > 12) o.trend.shift();
      o.best = Math.max(o.best, s.accuracy);
      if (s.at >= from) o.recent += s.seconds;
      o.last = Math.max(o.last, s.at);
    }
    const working = [...bySong.values()]
      .filter((o) => o.recent > 0 || !days)
      .sort((a, b) => b.recent - a.recent || b.last - a.last)
      .slice(0, 8);
    const accNow = acc(inRange);
    const accPrev = acc(prev);
    return {
      goals: this.goals(now,bestStreak),
      period,
      seconds: secs(inRange),
      prevSeconds: days ? secs(prev) : null,
      streak,
      bestStreak,
      songs: songIds.size,
      newSongs: [...songIds].filter((id) => !prevIds.has(id)).length,
      accuracy: accNow,
      accuracyChange: accNow !== null && accPrev !== null ? accNow - accPrev : null,
      perDay,
      working: working.map((w) => ({ ...w, ...this._songDetail(w.songId, w.part) })),
      last: this._last(),
      kinds: this._kinds(inRange),
      bestRun: inRange.reduce((m, s) => Math.max(m, s.bestStreak || 0), 0),
      improved: this._improved(from, all),
    };
  }

  /** Per-section average over the song's last 5 runs that have a breakdown: where it's solid, where it isn't. */
  _songDetail(songId, part) {
    const runs = this.data.sessions.filter((s) => s.songId === songId && (s.part || null) === (part || null) && s.sections && s.sections.length).slice(-5);
    if (!runs.length) return {};
    const agg = new Map();
    for (const r of runs)
      for (const [l, hh, n] of r.sections) {
        const a = agg.get(l) || { label: l, hit: 0, notes: 0, order: agg.size };
        a.hit += hh;
        a.notes += n;
        agg.set(l, a);
      }
    const sections = [...agg.values()].sort((a, b) => a.order - b.order).map((a) => ({ label: a.label, acc: a.notes ? a.hit / a.notes : null, notes: a.notes }));
    return { sections };
  }

  /** The most recent run with a score, in detail. */
  _last() {
    for (let i = this.data.sessions.length - 1; i >= 0; i--) {
      const s = this.data.sessions[i];
      if (!s.songId || s.accuracy === null || (s.notes || 0) < 10) continue; // a few stray notes aren't a run
      const prev = this.data.sessions.slice(0, i).filter((x) => x.songId === s.songId && (x.part || null) === (s.part || null) && x.accuracy !== null);
      const prevBest = prev.length ? Math.max(...prev.map((x) => x.accuracy)) : null;
      const prevLast = prev.length ? prev[prev.length - 1].accuracy : null;
      return { ...s, prevBest, prevLast, runs: prev.length + 1 };
    }
    return null;
  }

  /** Accuracy per kind of note over a set of runs. */
  _kinds(list) {
    const out = {};
    for (const s of list)
      for (const [k, [hh, n]] of Object.entries(s.kinds || {})) {
        out[k] = out[k] || { hit: 0, notes: 0 };
        out[k].hit += hh;
        out[k].notes += n;
      }
    return Object.entries(out)
      .filter(([, v]) => v.notes >= 5)
      .map(([kind, v]) => ({ kind, acc: v.hit / v.notes, notes: v.notes }))
      .sort((a, b) => b.notes - a.notes);
  }

  /** Songs that got better in the period: first run in it vs your best in it. */
  _improved(from, all) {
    const by = new Map();
    for (const s of all) {
      if (!s.songId || s.accuracy === null || s.notes < 20) continue;
      const k = `${s.songId}|${s.part || ''}`;
      const o = by.get(k) || { songId: s.songId, part: s.part, before: null, first: null, best: null };
      if (s.at < from) o.before = s.accuracy;
      else {
        if (o.first === null) o.first = o.before !== null ? o.before : s.accuracy;
        o.best = Math.max(o.best ?? 0, s.accuracy);
      }
      by.set(k, o);
    }
    return [...by.values()]
      .filter((o) => o.first !== null && o.best !== null && o.best - o.first >= 0.03)
      .map((o) => ({ songId: o.songId, part: o.part, from: o.first, to: o.best, gain: o.best - o.first }))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 5);
  }

  saveSoon() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush().catch(() => {}), 500);
  }

  async flush() {
    clearTimeout(this._timer);
    await writeJsonAtomic(this.file, this.data);
  }
}

/**
 * 4.3: what a clip is of, kept with it: { song: { title, artist, official }, part, tuning,
 * instrument, speed, tone (the tone itself, so others can try it) }. Anything else is dropped.
 */
function aboutClip(a) {
  if (!a || typeof a !== 'object') return null;
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const song = a.song && typeof a.song === 'object' ? { title: s(a.song.title, 120), artist: s(a.song.artist, 120), official: !!a.song.official } : null;
  let tone = null;
  if (a.tone && typeof a.tone === 'object' && Array.isArray(a.tone.gear)) {
    // the tone's own speaker-cabinet file is a file on this PC: it doesn't travel
    const { name, kind, gear, capture, cabId, autoCab } = a.tone;
    tone = JSON.parse(JSON.stringify({ name: s(name, 80) || 'Tone', kind: kind === 'bass' ? 'bass' : 'guitar', gear: gear.slice(0, 40), capture: capture || null, cabId: cabId || null, autoCab: autoCab !== false }));
    if (JSON.stringify(tone).length > 60000) tone = { name: tone.name, kind: tone.kind, gear: [] };
  }
  const speed = Number(a.speed);
  return {
    song: song && song.title ? song : null,
    part: ['lead', 'rhythm', 'bass', 'jam'].includes(a.part) ? a.part : null,
    tuning: s(a.tuning, 40),
    instrument: a.instrument === 'bass' ? 'bass' : 'guitar',
    speed: Number.isFinite(speed) && speed > 0 && speed <= 2 ? Math.round(speed * 100) / 100 : 1,
    tone,
  };
}

class Takes {
  constructor(dir) {
    this.dir = dir;
    this.index = path.join(dir, 'takes.json');
    this.list_ = null;
  }

  async _load() {
    if (this.list_) return;
    const d = await readJson(this.index, null);
    this.list_ = (d && Array.isArray(d.takes) && d.takes) || [];
    // drop entries whose file is gone
    this.list_ = this.list_.filter((t) => fs.existsSync(path.join(this.dir, t.file)));
  }

  async list() {
    await this._load();
    // with each file's size, so the Recordings list can show it
    return [...this.list_]
      .sort((a, b) => b.at - a.at)
      .map((t) => {
        let bytes = 0;
        try {
          bytes = fs.statSync(path.join(this.dir, t.file)).size;
        } catch (_) {}
        return { ...t, kind: t.kind || 'audio', bytes };
      });
  }

  /**
   * A free file name like "SH - Song Name.mp4", then "SH - Song Name (2).mp4"…
   * @param {string} title the song's title, or "Jam Session"
   * @param {string} ext 'wav' or 'mp4'
   * @param {string} [sub] a folder inside the recordings folder
   */
  freeName(title, ext, sub = '') {
    const clean = String(title || 'Recording').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Recording';
    const base = `SH - ${clean}`;
    for (let n = 1; n < 10000; n++) {
      const name = `${base}${n > 1 ? ` (${n})` : ''}.${ext}`;
      if (!fs.existsSync(path.join(this.dir, sub, name))) return sub ? `${sub}/${name}` : name;
    }
    return `${sub ? `${sub}/` : ''}${base} ${Date.now()}.${ext}`;
  }

  /** Adds a finished video (already in the recordings folder) to the list.
   *  `about` (4.3): what was played, for Backstage (aboutClip below). */
  async addVideo({ file, name, songId = null, seconds = 0, about = null }) {
    await this._load();
    const id = `k_${crypto.randomBytes(5).toString('hex')}`;
    const t = { id, kind: 'video', file, name: String(name || 'Video').slice(0, 120), songId, seconds: Math.round(Number(seconds) * 10) / 10, bpm: null, at: Date.now(), about: aboutClip(about) };
    this.list_.push(t);
    await writeJsonAtomic(this.index, { takes: this.list_ });
    return t;
  }

  /** Saves 16-bit WAV audio sent by the page (mono or stereo Float32 data as an ArrayBuffer/Uint8Array). */
  async save({ name, songId = null, seconds = 0, bpm = null, rate = 48000, channels = 1, pcm }) {
    await this._load();
    await fs.promises.mkdir(this.dir, { recursive: true });
    const f = new Float32Array(pcm instanceof ArrayBuffer ? pcm : pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    const b = Buffer.alloc(44 + f.length * 2);
    b.write('RIFF', 0);
    b.writeUInt32LE(36 + f.length * 2, 4);
    b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(channels, 22);
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * channels * 2, 28);
    b.writeUInt16LE(channels * 2, 32);
    b.writeUInt16LE(16, 34);
    b.write('data', 36);
    b.writeUInt32LE(f.length * 2, 40);
    for (let i = 0; i < f.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, f[i])) * 32767), 44 + i * 2);
    const id = `k_${crypto.randomBytes(5).toString('hex')}`;
    const file = this.freeName(name || 'Take', 'wav');
    await fs.promises.writeFile(path.join(this.dir, file), b);
    const t = { id, file, name: String(name || 'Take').slice(0, 120), songId, seconds: Math.round(Number(seconds) * 10) / 10, bpm, at: Date.now() };
    this.list_.push(t);
    await writeJsonAtomic(this.index, { takes: this.list_ });
    return t;
  }

  async remove(id) {
    await this._load();
    const t = this.list_.find((x) => x.id === id);
    if (!t) return false;
    this.list_ = this.list_.filter((x) => x !== t);
    await fs.promises.unlink(path.join(this.dir, t.file)).catch(() => {});
    await writeJsonAtomic(this.index, { takes: this.list_ });
    return true;
  }

  async rename(id, name) {
    await this._load();
    const t = this.list_.find((x) => x.id === id);
    if (!t) return null;
    t.name = String(name || '').trim().slice(0, 120) || t.name;
    await writeJsonAtomic(this.index, { takes: this.list_ });
    return t;
  }

  pathOf(id) {
    const t = (this.list_ || []).find((x) => x.id === id);
    return t ? path.join(this.dir, t.file) : null;
  }
}

module.exports = { foldIntoArchive, emptyArchive, KEEP_SESSIONS, Stats, Takes, dayKey, aboutClip };
