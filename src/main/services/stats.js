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

class Stats {
  constructor(file) {
    this.file = file;
    this.data = { sessions: [] };
    this._timer = null;
  }

  async load() {
    const d = await readJson(this.file, null);
    if (d && Array.isArray(d.sessions)) this.data = { sessions: d.sessions };
    return true;
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
    this.data.sessions.push(e);
    if (this.data.sessions.length > 20000) this.data.sessions.splice(0, this.data.sessions.length - 20000);
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
      if (o.best === undefined || s.accuracy > o.best) o.best = s.accuracy;
    }
    return out;
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
    return [...this.list_].sort((a, b) => b.at - a.at);
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
    const file = `${id}.wav`;
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

module.exports = { Stats, Takes, dayKey };
