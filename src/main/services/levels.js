'use strict';
/**
 * Levels (4.4): points (XP) for playing and for trying things, a level, and a pass style.
 *
 * Nothing is counted twice: the XP is worked out again from scratch each time from
 *  - your playing (stats.json sessions): minutes, songs played in full, doing well,
 *    personal bests, new songs, new tunings, parts, a streak bonus;
 *  - things you've tried once (`did`, kept in levels.json): Backstage, the looper, the Drop…;
 *  - songs added to your library since levels began (a few points each, capped per day);
 *  - today's three challenges, kept in `done` once finished (so changing the list later
 *    never takes points away).
 * Old playing counts too, so a long-time player starts at the level they've earned.
 */
const { readJson, writeJsonAtomic } = require('../core/files');

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** XP needed to reach a level: 2 at 100, 3 at 300, 5 at 1000, 10 at 4500, 20 at 19000. */
const xpFor = (level) => 50 * (level - 1) * level;
function levelOf(xp) {
  let l = 1;
  while (xpFor(l + 1) <= xp) l++;
  return l;
}

/** The pass gets fancier as you go. */
const TIERS = [
  { id: 'roadie', name: 'Roadie', from: 1 },
  { id: 'garage', name: 'Garage band', from: 3 },
  { id: 'opener', name: 'Opening act', from: 5 },
  { id: 'headliner', name: 'Headliner', from: 10 },
  { id: 'rockstar', name: 'Rock star', from: 15 },
  { id: 'legend', name: 'Legend', from: 20 },
  { id: 'hof', name: 'Hall of Fame', from: 30 },
];
const tierOf = (level) => [...TIERS].reverse().find((t) => level >= t.from);

/** Venues on the highway that open up with levels (ids as in venues.js). */
const UNLOCKS = [
  { level: 3, venue: 'festival', name: 'Festival' },
  { level: 5, venue: 'swarm', name: 'Swarm' },
  { level: 7, venue: 'canyon', name: 'Canyon' },
  { level: 10, venue: 'astral', name: 'Astral' },
  { level: 13, venue: 'mandala', name: 'Mandala' },
  { level: 16, venue: 'nebula', name: 'Nebula' },
];

/** Things to try once. `go` is where to find it (the page uses it for a button). */
const FIRSTS = [
  { id: 'backstage-join', xp: 50, name: 'Get your backstage pass', how: 'Pick a name in Backstage', go: 'greenroom' },
  { id: 'backstage-show', xp: 60, name: 'Show a clip backstage', how: 'Record a video, then show it from My clips', go: 'greenroom' },
  { id: 'backstage-watch', xp: 40, name: 'Watch someone’s clip', how: 'Backstage, under Everyone', go: 'greenroom' },
  { id: 'backstage-message', xp: 30, name: 'Say hi backstage', how: 'Message someone in Backstage', go: 'greenroom' },
  { id: 'backstage-tone', xp: 40, name: 'Keep someone’s tone', how: 'Keep it from a clip in Backstage', go: 'greenroom' },
  { id: 'record-video', xp: 50, name: 'Film yourself playing', how: 'Record a video on the highway or in Jam', go: 'play' },
  { id: 'looper', xp: 40, name: 'Make a loop', how: 'The looper in Jam', go: 'play' },
  { id: 'jam', xp: 30, name: 'Just jam', how: 'Play along in Jam with no song', go: 'play' },
  { id: 'tone-make', xp: 50, name: 'Make your own tone', how: 'Save a tone in Tones', go: 'tones' },
  { id: 'tone-try', xp: 20, name: 'Try a new tone on a song', how: 'Pick another tone while a song plays', go: 'tones' },
  { id: 'drop', xp: 30, name: 'Use the Drop', how: 'Play a lower tuning without retuning (D)', go: 'play' },
  { id: 'tuner', xp: 20, name: 'Tune up', how: 'Open the tuner', go: 'play' },
  { id: 'timing', xp: 40, name: 'Do the timing check', how: 'Highway options → Timing check', go: 'songs' },
  { id: 'slow', xp: 30, name: 'Slow a song down', how: 'Lower the speed to learn a hard part', go: 'songs' },
  { id: 'repeat', xp: 30, name: 'Loop a tricky part', how: 'Repeat a section until it’s clean', go: 'songs' },
  { id: 'tab', xp: 20, name: 'Read the tab', how: 'Open the tab view of a song', go: 'songs' },
  { id: 'stems', xp: 40, name: 'Play the part yourself', how: 'Turn the guitar or bass part off and play it', go: 'songs' },
  { id: 'discover', xp: 30, name: 'Go find new songs', how: 'Look around Discover', go: 'discover' },
  { id: 'venue', xp: 20, name: 'Change the venue', how: 'Highway options → Venue', go: 'songs' },
  // these come from your playing
  { id: 'part-bass', xp: 50, name: 'Play a bass part', how: 'Any song, Bass', auto: true, go: 'songs' },
  { id: 'part-rhythm', xp: 30, name: 'Play a rhythm part', how: 'Any song, Rhythm', auto: true, go: 'songs' },
  { id: 'part-lead', xp: 20, name: 'Play a lead part', how: 'Any song, Lead', auto: true, go: 'songs' },
  { id: 'first-full', xp: 50, name: 'Play a song all the way through', how: 'Start to finish', auto: true, go: 'songs' },
  { id: 'first-90', xp: 80, name: 'Score 90% on a song', how: 'All the way through, full speed', auto: true, go: 'songs' },
  { id: 'first-100', xp: 200, name: 'A perfect song', how: '100%, all the way through, full speed', auto: true, go: 'songs' },
];
const FIRST = new Map(FIRSTS.map((f) => [f.id, f]));
/** Things that count again each day (for the challenges). */
const DAILY = new Set(['backstage-visit', 'tone-try', 'record-video', 'looper', 'slow', 'repeat', 'stems', 'discover', 'jam']);

const STANDARD = /^(e )?standard$/i;
const isFullSpeed = (s) => (s.speed || 1) >= 0.999;

/**
 * Today's challenges: one for playing, one for playing well, one for trying something.
 * Picked by the date, so everyone gets the same three and they change at midnight.
 */
const CHALLENGES = {
  play: [
    { id: 'full5', xp: 120, name: 'Play 5 songs in full today', target: 5, count: (t) => t.fullSongs },
    { id: 'full2', xp: 50, name: 'Play 2 songs all the way through', target: 2, count: (t) => t.fullSongs },
    { id: 'min20', xp: 50, name: 'Play for 20 minutes', target: 20, count: (t) => Math.floor(t.seconds / 60) },
    { id: 'min45', xp: 100, name: 'Play for 45 minutes', target: 45, count: (t) => Math.floor(t.seconds / 60) },
    { id: 'songs3', xp: 40, name: 'Play 3 different songs', target: 3, count: (t) => t.songs },
  ],
  skill: [
    { id: 'acc85', xp: 60, name: 'Score 85% or better on a song', target: 1, count: (t) => (t.bestFull >= 0.85 ? 1 : 0) },
    { id: 'acc90', xp: 80, name: 'Score 90% or better on a song', target: 1, count: (t) => (t.bestFull >= 0.9 ? 1 : 0) },
    { id: 'pb', xp: 60, name: 'Beat one of your best scores', target: 1, count: (t) => t.bests },
    { id: 'clean3', xp: 70, name: 'Three songs at 80% or better', target: 3, count: (t) => t.good },
  ],
  explore: [
    { id: 'newsong', xp: 60, name: 'Play a song you’ve never played', target: 1, count: (t) => t.newSongs },
    { id: 'oldsong', xp: 60, name: 'Play a song you haven’t touched in a month', target: 1, count: (t) => t.oldSongs },
    { id: 'tuning', xp: 60, name: 'Play a song that isn’t in standard tuning', target: 1, count: (t) => t.offStandard },
    { id: 'bass', xp: 60, name: 'Play a bass part', target: 1, count: (t) => t.bass },
    { id: 'add', xp: 50, name: 'Add a new song to your library', target: 1, count: (t) => t.added },
    { id: 'backstage', xp: 30, name: 'Drop by Backstage', target: 1, count: (t) => (t.did.has('backstage-visit') ? 1 : 0) },
    { id: 'tryone', xp: 60, name: 'Try something new from the list', target: 1, count: (t) => t.firsts },
    { id: 'slowlearn', xp: 40, name: 'Slow a song down or loop a hard part', target: 1, count: (t) => (t.did.has('slow') || t.did.has('repeat') ? 1 : 0) },
  ],
};
function hash(s) {
  let n = 2166136261;
  for (const ch of s) n = Math.imul(n ^ ch.codePointAt(0), 16777619) >>> 0;
  return n;
}
function challengesFor(day) {
  return ['play', 'skill', 'explore'].map((k, i) => {
    const pool = CHALLENGES[k];
    return pool[hash(`${day}:${i}`) % pool.length];
  });
}

/**
 * Everything worked out from what's stored. Pure (no files), so it's easy to test.
 * @param {object} o
 * @param {Array} o.sessions stats.json sessions
 * @param {object} o.did { id: first time (ms) }
 * @param {object} o.daily { 'YYYY-MM-DD': [ids done that day] }
 * @param {object} o.done { 'YYYY-MM-DD:challenge': { xp, at, name } }
 * @param {number[]} o.added when songs were added to the library (ms)
 * @param {number} o.since when levels began (songs added before don't count)
 * @param {number} [o.now]
 */
function compute({ sessions = [], did = {}, daily = {}, done = {}, added = [], since = 0, now = Date.now() }) {
  const awards = [];
  const give = (key, xp, why, at) => xp > 0 && awards.push({ key, xp: Math.round(xp), why, at });
  const seenSong = new Map(); // songId -> last time played
  const tunings = new Set();
  const best = new Map(); // `${songId}|${part}` -> best full-speed accuracy
  const firstAt = new Map(); // auto firsts
  const minutesByDay = new Map();
  const streakDay = new Set();
  const playedDays = new Set();
  const today = dayKey(now);
  const T = { seconds: 0, fullSongs: 0, songs: 0, bestFull: 0, bests: 0, good: 0, newSongs: 0, oldSongs: 0, offStandard: 0, bass: 0, added: 0, firsts: 0, did: new Set(daily[today] || []) };
  const todaySongs = new Set();
  const todayFull = new Set();
  const todayGood = new Set();
  const autoFirst = (id, at) => {
    if (firstAt.has(id)) return;
    firstAt.set(id, at);
    give(`f:${id}`, FIRST.get(id).xp, FIRST.get(id).name, at);
  };
  const list = sessions.filter((s) => s && Number(s.at) > 0 && Number(s.seconds) > 0).sort((a, b) => a.at - b.at);
  for (const s of list) {
    const day = dayKey(s.at);
    const k = `s:${s.at}:${s.songId || 'free'}`;
    // minutes: a point a minute with a song, half without; at most 180 a day
    const used = minutesByDay.get(day) || 0;
    const mins = Math.min(Math.max(0, 180 - used), (s.seconds / 60) * (s.songId ? 1 : 0.5));
    minutesByDay.set(day, used + mins);
    give(`${k}:min`, mins, s.songId ? 'Playing' : 'Free playing', s.at);
    // a streak: the first playing of a day, more for each day in a row (up to 10)
    if (!streakDay.has(day)) {
      streakDay.add(day);
      let run = 1;
      while (playedDays.has(dayKey(s.at - run * DAY))) run++;
      playedDays.add(day);
      if (run > 1) give(`d:${day}:streak`, 5 * Math.min(run, 10), `${run} days in a row`, s.at);
    }
    const isToday = day === today;
    if (isToday) T.seconds += s.seconds;
    if (!s.songId) continue;
    const last = seenSong.get(s.songId);
    if (last === undefined && s.seconds >= 30) {
      give(`${k}:new`, 20, 'A new song', s.at);
      if (isToday) T.newSongs++;
    } else if (last !== undefined && s.at - last > 30 * DAY && isToday) T.oldSongs++;
    if (s.seconds >= 30 || last !== undefined) seenSong.set(s.songId, s.at);
    if (isToday) todaySongs.add(s.songId);
    if (s.tuning && !tunings.has(s.tuning) && s.seconds >= 30) {
      if (tunings.size) give(`${k}:tuning`, 40, `A new tuning: ${s.tuning}`, s.at);
      tunings.add(s.tuning);
    }
    if (isToday && s.tuning && !STANDARD.test(s.tuning) && s.seconds >= 30) T.offStandard++;
    if (s.seconds >= 30) {
      if (s.part === 'bass') autoFirst('part-bass', s.at);
      else if (s.part === 'rhythm') autoFirst('part-rhythm', s.at);
      else if (s.part === 'lead') autoFirst('part-lead', s.at);
      if (isToday && s.part === 'bass') T.bass++;
    }
    const acc = s.accuracy === null || s.accuracy === undefined ? null : Number(s.accuracy);
    const scored = acc !== null && (s.notes || 0) >= 50 && isFullSpeed(s);
    if (s.full) {
      give(`${k}:full`, 25, 'Played a song in full', s.at);
      autoFirst('first-full', s.at);
      if (isToday) todayFull.add(s.songId);
      // doing well is worth the most
      if (scored) {
        const bonus = acc >= 0.999 ? 150 : acc >= 0.95 ? 70 : acc >= 0.9 ? 40 : acc >= 0.8 ? 15 : 0;
        give(`${k}:acc`, bonus, `${Math.round(acc * 100)}% on a whole song`, s.at);
        if (acc >= 0.9) autoFirst('first-90', s.at);
        if (acc >= 0.999) autoFirst('first-100', s.at);
        if (isToday) T.bestFull = Math.max(T.bestFull, acc);
      }
    }
    if (scored) {
      const bk = `${s.songId}|${s.part || 'lead'}`;
      const was = best.get(bk);
      if (was !== undefined && acc >= was + 0.02) {
        give(`${k}:pb`, 30, `A new best: ${Math.round(acc * 100)}%`, s.at);
        if (isToday) T.bests++;
      }
      if (was === undefined || acc > was) best.set(bk, acc);
      if (isToday && acc >= 0.8) todayGood.add(s.songId);
    }
  }
  T.fullSongs = todayFull.size;
  T.songs = todaySongs.size;
  T.good = todayGood.size;
  // things tried once
  for (const [id, at] of Object.entries(did)) {
    const f = FIRST.get(id);
    if (!f || f.auto) continue;
    give(`f:${id}`, f.xp, f.name, Number(at) || 0);
    if (dayKey(Number(at) || 0) === today) T.firsts++;
  }
  for (const [id, at] of firstAt) if (dayKey(at) === today) T.firsts++;
  // new songs in your library: 10 each, up to 50 a day
  const addedByDay = new Map();
  for (const at of added.filter((x) => x >= since).sort((a, b) => a - b)) {
    const d = dayKey(at);
    const n = addedByDay.get(d) || 0;
    addedByDay.set(d, n + 1);
    if (d === today) T.added++;
    if (n < 5) give(`a:${at}:${n}`, 10, 'A new song in your library', at);
  }
  // finished challenges (kept, so they stay earned)
  for (const [key, c] of Object.entries(done)) give(`c:${key}`, c.xp, `Challenge: ${c.name}`, c.at);

  const xp = awards.reduce((a, x) => a + x.xp, 0);
  const level = levelOf(xp);
  const challenges = challengesFor(today).map((c) => {
    const value = Math.min(c.target, c.count(T));
    return { id: c.id, key: `${today}:${c.id}`, name: c.name, xp: c.xp, value, target: c.target, done: !!done[`${today}:${c.id}`] || value >= c.target };
  });
  const tried = new Set([...Object.keys(did), ...firstAt.keys()]);
  return {
    xp,
    level,
    tier: tierOf(level),
    from: xpFor(level),
    to: xpFor(level + 1),
    next: UNLOCKS.find((u) => u.level > level) || null,
    unlocked: UNLOCKS.filter((u) => u.level <= level).map((u) => u.venue),
    challenges,
    firsts: FIRSTS.map((f) => ({ id: f.id, name: f.name, how: f.how, xp: f.xp, go: f.go, done: tried.has(f.id) })),
    unlocks: UNLOCKS,
    recent: awards.sort((a, b) => b.at - a.at).slice(0, 40),
    today: awards.filter((a) => dayKey(a.at) === today).reduce((n, a) => n + a.xp, 0),
  };
}

class Levels {
  /**
   * @param {object} o
   * @param {string} o.file levels.json
   * @param {Function} o.sessions () => stats sessions
   * @param {Function} [o.added] () => times songs were added to the library
   */
  constructor({ file, sessions, added }) {
    Object.assign(this, { file, sessions, added: added || (() => []) });
    this.data = null;
  }

  async load() {
    const d = await readJson(this.file, null);
    const x = d || {};
    this.data = {
      since: Number(x.since) || Date.now(),
      did: x.did && typeof x.did === 'object' ? { ...x.did } : {},
      daily: x.daily && typeof x.daily === 'object' ? { ...x.daily } : {},
      done: x.done && typeof x.done === 'object' ? { ...x.done } : {},
    };
    if (!d) await this.save();
    return this;
  }

  save() {
    return writeJsonAtomic(this.file, { v: 1, ...this.data });
  }

  /** You tried something. Returns the new state (or the same one if nothing changed). */
  async did(id, now = Date.now()) {
    id = String(id || '');
    const d = this.data;
    let changed = false;
    if (FIRST.has(id) && !FIRST.get(id).auto && !d.did[id]) (d.did[id] = now), (changed = true);
    if (DAILY.has(id) || FIRST.has(id)) {
      const day = dayKey(now);
      const l = (d.daily[day] = d.daily[day] || []);
      if (!l.includes(id)) l.push(id), (changed = true);
      // keep two weeks
      for (const k of Object.keys(d.daily)) if (k < dayKey(now - 14 * DAY)) delete d.daily[k];
    }
    if (changed) await this.save();
    return this.state(now);
  }

  /** The state for the page; finished challenges are kept as they finish. */
  state(now = Date.now()) {
    const d = this.data;
    let st = compute({ sessions: this.sessions() || [], did: d.did, daily: d.daily, done: d.done, added: this.added() || [], since: d.since, now });
    const fresh = st.challenges.filter((c) => c.value >= c.target && !d.done[c.key]);
    if (fresh.length) {
      for (const c of fresh) d.done[c.key] = { xp: c.xp, at: now, name: c.name };
      this.save().catch(() => {});
      st = compute({ sessions: this.sessions() || [], did: d.did, daily: d.daily, done: d.done, added: this.added() || [], since: d.since, now });
    }
    return st;
  }
}

module.exports = { Levels, compute, xpFor, levelOf, tierOf, challengesFor, TIERS, UNLOCKS, FIRSTS, dayKey };
