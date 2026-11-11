'use strict';
/**
 * 4.5: lifetime statistics. Everything you've ever played, from every session in stats.json
 * plus its `archive` (totals of sessions folded away when the list got very long).
 * Separate from progression: resetting levels never changes these numbers. Nothing is made
 * up: a number that wasn't recorded (e.g. chords before 3.9 logged note kinds) just starts later.
 */
const { masteryOf } = require('./levels');
const { MASTERY } = require('./progression-config');

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isFull = (s) => (s.speed || 1) >= 0.999;

/**
 * @param {object} o
 * @param {Array} o.sessions
 * @param {object} [o.archive]
 * @param {object} [o.songs] library { id: { title, artist } }
 * @param {number} [o.now]
 */
function lifetime({ sessions = [], archive = null, songs = {}, now = Date.now() }) {
  const a = archive || {};
  const list = sessions.filter((s) => s && Number(s.at) > 0).sort((x, y) => x.at - y.at);
  const T = {
    sessions: (a.count || 0) + list.length,
    seconds: a.seconds || 0,
    notes: a.notes || 0,
    hit: a.hit || 0,
    full: a.full || 0,
    kinds: {},
    firstAt: a.firstAt || 0,
    lastAt: a.lastAt || 0,
    bestAcc: a.bestAcc || 0,
    bestStreak: a.bestStreak || 0,
    songsPlayed: 0,
    perfect: 0,
    acc95: 0,
    cleanSections: 0,
    bests: 0,
    slowSessions: 0,
    bassFull: 0,
    longestSession: 0,
  };
  for (const [k, v] of Object.entries(a.kinds || {})) T.kinds[k] = [v[0] || 0, v[1] || 0];
  const songsSet = new Set(a.songs || []);
  const days = new Set(a.days || []);
  const artists = new Set();
  const tunings = new Set();
  const best = new Map();
  const perMonth = new Map();
  const perYear = new Map();
  let accN = 0;
  let accH = 0;
  let bestRun = null;
  let streakRun = null;
  for (const s of list) {
    T.seconds += Number(s.seconds) || 0;
    T.notes += Number(s.notes) || 0;
    T.hit += Number(s.hit) || 0;
    T.longestSession = Math.max(T.longestSession, Number(s.seconds) || 0);
    if (!T.firstAt || s.at < T.firstAt) T.firstAt = s.at;
    T.lastAt = Math.max(T.lastAt, s.at);
    const d = dayKey(s.at);
    days.add(d);
    const mk = d.slice(0, 7);
    perMonth.set(mk, (perMonth.get(mk) || 0) + (Number(s.seconds) || 0));
    const yk = d.slice(0, 4);
    const y = perYear.get(yk) || { seconds: 0, notes: 0, hit: 0, chords: 0, full: 0, songs: new Set(), days: new Set() };
    y.seconds += Number(s.seconds) || 0;
    y.notes += Number(s.notes) || 0;
    y.hit += Number(s.hit) || 0;
    y.days.add(d);
    if (s.full) y.full++;
    if (s.songId) y.songs.add(s.songId);
    for (const [k, v] of Object.entries(s.kinds || {})) {
      const o = (T.kinds[k] = T.kinds[k] || [0, 0]);
      o[0] += Number(v[0]) || 0;
      o[1] += Number(v[1]) || 0;
      if (k === 'chord') y.chords += Number(v[1]) || 0;
    }
    perYear.set(yk, y);
    if (s.bestStreak > T.bestStreak) (T.bestStreak = s.bestStreak), (streakRun = s);
    T.cleanSections += (Array.isArray(s.sections) ? s.sections : []).filter((x) => Array.isArray(x) && x[2] >= 10 && x[1] >= x[2]).length;
    if (!isFull(s)) T.slowSessions++;
    if (!s.songId) continue;
    if (s.seconds >= 30) T.songsPlayed++;
    songsSet.add(s.songId);
    const lib = songs[s.songId];
    if (lib && lib.artist) artists.add(String(lib.artist).trim().toLowerCase());
    if (s.tuning) tunings.add(s.tuning);
    if (s.full) {
      T.full++;
      if (s.part === 'bass') T.bassFull++;
    }
    const acc = s.accuracy === null || s.accuracy === undefined ? null : Number(s.accuracy);
    if (acc !== null && s.notes) (accN += s.notes), (accH += acc * s.notes);
    if (acc !== null && s.full && isFull(s) && s.notes >= 50) {
      if (acc > T.bestAcc || (acc === T.bestAcc && !bestRun)) (T.bestAcc = acc), (bestRun = s);
      if (acc >= 0.95) T.acc95++;
      if (acc >= 0.999) T.perfect++;
      const bk = `${s.songId}|${s.part || 'lead'}`;
      const was = best.get(bk);
      if (was !== undefined && acc >= was + 0.02) T.bests++;
      if (was === undefined || acc > was) best.set(bk, acc);
    }
  }
  // longest run of days in a row
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of [...days].sort()) {
    const t = new Date(`${d}T12:00:00`).getTime();
    run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    prev = t;
    longest = Math.max(longest, run);
  }
  const mastery = masteryOf(list);
  const byTier = MASTERY.map((m) => ({ tier: m.id, name: m.name, how: m.how || '', count: 0 }));
  for (const m of Object.values(mastery)) byTier[m.tier].count++;
  const months = [];
  const start = new Date(now);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(start.getFullYear(), start.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ month: k, at: d.getTime(), minutes: Math.round((perMonth.get(k) || 0) / 60) });
  }
  const years = [...perYear.entries()].sort().map(([year, y]) => ({ year, seconds: y.seconds, notes: y.notes, hit: y.hit, chords: y.chords, full: y.full, songs: y.songs.size, days: y.days.size }));
  const chords = T.kinds.chord || [0, 0];
  const rec = (s) => (s ? { songId: s.songId, part: s.part, accuracy: s.accuracy, at: s.at, streak: s.bestStreak || 0 } : null);
  return {
    sessions: T.sessions,
    seconds: T.seconds,
    hours: T.seconds / 3600,
    notes: T.notes,
    notesHit: T.hit,
    chordsPlayed: chords[1],
    chordsHit: chords[0],
    kinds: T.kinds,
    songsPlayed: T.songsPlayed,
    uniqueSongs: songsSet.size,
    uniqueArtists: artists.size,
    tunings: tunings.size,
    fullSongs: T.full,
    bassFull: T.bassFull,
    bestAccuracy: T.bestAcc || null,
    averageAccuracy: accN ? accH / accN : null,
    perfectSongs: T.perfect,
    songs95: T.acc95,
    personalBests: T.bests,
    cleanSections: T.cleanSections,
    bestStreak: T.bestStreak,
    longestSession: T.longestSession,
    daysPlayed: days.size,
    longestDayRun: longest,
    firstAt: T.firstAt || null,
    lastAt: T.lastAt || null,
    mastery: byTier,
    masteredSongs: byTier[6].count,
    masteryBySong: mastery,
    months,
    years,
    records: { bestAccuracy: rec(bestRun), bestStreak: rec(streakRun) },
    archived: a.count || 0,
  };
}

module.exports = { lifetime };
