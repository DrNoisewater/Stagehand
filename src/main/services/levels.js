'use strict';
/**
 * Levels (4.4, rebuilt for 4.5 "The Road to 100"): XP for playing and for trying things,
 * a level from 1 to 100, a pass style, venues that open along the way, achievements in six
 * tiers, song mastery, titles and a career timeline.
 *
 * All the numbers live in progression-config.js. Nothing is counted twice: XP is worked out
 * again from scratch each time from
 *  - your playing (stats.json sessions since progression began: `resetAt`): minutes actually
 *    playing, songs played in full, doing well, personal bests, new songs, new tunings, parts,
 *    song mastery; the days you've played in the last week add a little (never taken away);
 *  - achievements (each tier once), worked out from the same playing;
 *  - things you've tried once (`did`, kept in levels.json);
 *  - songs added to your library (a few points each, capped per day);
 *  - today's and this week's challenges, kept in `done` once finished;
 *  - developer adjustments (`dev.xp`), only from the developer menu.
 *
 * Progression (this file, levels.json) is separate from your lifetime statistics
 * (lifetime.js, from every session ever): resetting progression never touches them.
 */
const { readJson, writeJsonAtomic } = require('../core/files');
const CFG = require('./progression-config');

const { XP, LEVEL_XP, TIERS, VENUES, METALS, TROPHY_XP, TITLES: TITLE_DEFS, MASTERY, MILESTONES } = CFG;
const DAY = 24 * 60 * 60 * 1000;
const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** The Monday a week starts on, as a day key. */
const weekKey = (ms) => {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return dayKey(d.getTime() - ((d.getDay() + 6) % 7) * DAY);
};

/** XP needed to reach a level (1–100). */
const xpFor = (level) => LEVEL_XP[Math.max(1, Math.min(CFG.CURVE.MAX, level))];
function levelOf(xp) {
  let l = 1;
  while (l < CFG.CURVE.MAX && LEVEL_XP[l + 1] <= xp) l++;
  return l;
}
const tierOf = (level) => [...TIERS].reverse().find((t) => level >= t.from);
/** Venues on the highway and the level each opens at. */
const UNLOCKS = VENUES;
/** Days played in the last seven → a small boost to what playing earns. */
const rhythmFor = (days) => CFG.RHYTHM[Math.max(0, Math.min(7, days))];

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
const isBackstage = (id) => id.startsWith('backstage-');
/** Things that count again each day (for the challenges). */
const DAILY = new Set(['backstage-visit', 'backstage-share', 'tone-try', 'record-video', 'looper', 'slow', 'repeat', 'stems', 'discover', 'jam', 'tab']);
/** Things that only count today, never as a first time (showing a clip also counts as the first show). */
const ALSO = { 'backstage-share': 'backstage-show' };

const STANDARD = /^(e )?standard$/i;
const isFullSpeed = (s) => (s.speed || 1) >= 0.999;
const pct = (x) => `${Math.round(x * 100)}%`;

// -------------------------------------------------------- achievements --
const TRY_IDS = FIRSTS.filter((f) => !f.auto && !isBackstage(f.id)).map((f) => f.id);
const BACKSTAGE_IDS = FIRSTS.filter((f) => isBackstage(f.id)).map((f) => f.id);
const TROPHIES = CFG.TROPHIES.map((t) => ({ ...t, tiers: t.tiers.map((x) => (x < 0 ? (t.kind === 'backstage' ? BACKSTAGE_IDS.length : TRY_IDS.length) : x)) }));
const trophyXp = (t, i) => (t.xp === false ? 0 : t.kind ? Math.round(TROPHY_XP[i] / 2) : TROPHY_XP[i]);
const TROPHY = new Map(TROPHIES.map((t) => [t.id, t]));
const TITLES = TITLE_DEFS;
const titleHow = (t) => (t.level ? `Reach level ${t.level}` : `${METALS[t.trophy[1]]} in ${TROPHY.get(t.trophy[0]).name}`);

// ------------------------------------------------------------- mastery --
/**
 * Song mastery for one song and part, from its runs: see MASTERY in the config.
 * @param {{plays:number, full:number, best:number, runs90:number}} m
 */
function masteryTier(m) {
  if (!m || !m.plays) return 0;
  if (m.best >= 0.95 && m.runs90 >= 2) return 6;
  if (m.best >= 0.9) return 5;
  if (m.best >= 0.8) return 4;
  if (m.best >= 0.6) return 3;
  return m.full ? 2 : 1;
}
/** Folds one session into a song-part's mastery record. Returns the record. */
function masteryAdd(map, s) {
  const k = `${s.songId}|${s.part || 'lead'}`;
  const m = map.get(k) || { songId: s.songId, part: s.part || 'lead', plays: 0, full: 0, best: 0, runs90: 0, last: 0, first: s.at };
  if (s.seconds >= XP.realSeconds) m.plays++;
  m.last = Math.max(m.last, s.at);
  if (s.full) {
    m.full++;
    const acc = s.accuracy === null || s.accuracy === undefined ? null : Number(s.accuracy);
    if (acc !== null && (s.notes || 0) >= XP.scoredNotes && isFullSpeed(s)) {
      m.best = Math.max(m.best, acc);
      if (acc >= 0.9) m.runs90++;
    }
  }
  map.set(k, m);
  return m;
}
/** Every song-part's mastery from a list of sessions (lifetime: skill isn't reset with levels). */
function masteryOf(sessions) {
  const map = new Map();
  for (const s of [...sessions].filter((x) => x && x.songId && x.at > 0).sort((a, b) => a.at - b.at)) masteryAdd(map, s);
  const out = {};
  for (const [k, m] of map) out[k] = { ...m, tier: masteryTier(m), name: MASTERY[masteryTier(m)].name };
  return out;
}

// ---------------------------------------------------------- challenges --
/**
 * Each day: one playing challenge, one skill challenge, a bigger "daily gig" (bonus), and
 * one wildcard that's either trying a feature (4 days in 10) or Backstage (6 in 10).
 * Each week: the song of the week, a big playing one, and one more (mostly playing).
 * So of all challenges about 10% are trying features, about 14% Backstage, the rest playing.
 * `count(t)` reads a tally of the day (or week); `did` is the set of things done in it.
 */
const ever = (ids) => (t) => (ids.some((id) => t.did.has(id)) ? 1 : 0);
const CHALLENGES = {
  play: [
    { id: 'full2', xp: 25, name: 'Play 2 songs all the way through', target: 2, count: (t) => t.full.size },
    { id: 'full4', xp: 55, name: 'Play 4 songs in full today', target: 4, count: (t) => t.full.size },
    { id: 'min20', xp: 25, name: 'Play for 20 minutes', target: 20, count: (t) => Math.floor(t.seconds / 60) },
    { id: 'min45', xp: 55, name: 'Play for 45 minutes', target: 45, count: (t) => Math.floor(t.seconds / 60) },
    { id: 'songs3', xp: 25, name: 'Play 3 different songs', target: 3, count: (t) => t.songs.size },
    { id: 'newsong', needs: 'unplayed', xp: 35, name: 'Play a song you’ve never played', target: 1, count: (t) => t.newSongs },
    { id: 'oldsong', needs: 'history', xp: 35, name: 'Dust one off: a song you haven’t played in a month', target: 1, count: (t) => t.oldSongs },
    { id: 'tuning', needs: 'offStandard', xp: 35, name: 'Play a song that isn’t in standard tuning', target: 1, count: (t) => t.offStandard },
    { id: 'bass', needs: 'bass', xp: 35, name: 'Play a bass part', target: 1, count: (t) => t.bass },
    { id: 'artists3', xp: 35, name: 'Play songs by 3 different artists', target: 3, count: (t) => t.artists.size },
  ],
  skill: [
    { id: 'acc85', xp: 35, name: 'Score 85% or better on a whole song', target: 1, count: (t) => (t.bestFull >= 0.85 ? 1 : 0) },
    { id: 'acc90', xp: 50, name: 'Score 90% or better on a whole song', target: 1, count: (t) => (t.bestFull >= 0.9 ? 1 : 0) },
    { id: 'pb', xp: 40, name: 'Beat one of your best scores', target: 1, count: (t) => t.bests },
    { id: 'clean3', xp: 50, name: 'Three songs at 80% or better', target: 3, count: (t) => t.good80.size },
    { id: 'streak50', xp: 35, name: 'Hit 50 notes in a row', target: 50, count: (t) => t.streak },
    { id: 'streak100', xp: 55, name: 'Hit 100 notes in a row', target: 100, count: (t) => t.streak },
    { id: 'sections3', xp: 40, name: 'Play 3 sections without a miss', target: 3, count: (t) => t.sections },
    { id: 'bends15', xp: 35, name: 'Land 15 bends', target: 15, count: (t) => t.kinds.bend },
    { id: 'slides15', xp: 35, name: 'Land 15 slides', target: 15, count: (t) => t.kinds.slide },
    { id: 'chords40', xp: 35, name: 'Hit 40 chords', target: 40, count: (t) => t.kinds.chord },
  ],
  gig: [
    { id: 'set3', xp: 90, name: 'Daily gig: a 3-song set, back to back, each at 80% or better', target: 3, count: (t) => t.set },
    { id: 'two90', xp: 90, name: 'Daily gig: two different songs at 90% or better', target: 2, count: (t) => t.good90.size },
    { id: 'streak200', xp: 90, name: 'Daily gig: hit 200 notes in a row', target: 200, count: (t) => t.streak },
    { id: 'encore', xp: 80, name: 'Daily gig: encore! Play a song in full twice, better the second time', target: 1, count: (t) => t.encore },
    { id: 'hour', xp: 80, name: 'Daily gig: play for an hour', target: 60, count: (t) => Math.floor(t.seconds / 60) },
    { id: 'clean8', xp: 90, name: 'Daily gig: 8 sections without a miss', target: 8, count: (t) => t.sections },
    { id: 'acc95', xp: 95, name: 'Daily gig: 95% or better on a whole song', target: 1, count: (t) => (t.bestFull >= 0.95 ? 1 : 0) },
  ],
  explore: [
    { id: 'slowlearn', xp: 40, name: 'Slow a song down or loop a hard part', target: 1, count: ever(['slow', 'repeat']) },
    { id: 'tryone', xp: 40, name: 'Try something new from the list', target: 1, count: (t) => t.firsts },
    { id: 'add', xp: 40, name: 'Add a new song to your library', target: 1, count: (t) => t.added },
    { id: 'tone', xp: 35, name: 'Try a different tone on a song', target: 1, count: ever(['tone-try', 'tone-make']) },
    { id: 'film', xp: 40, name: 'Film yourself playing', target: 1, count: ever(['record-video']) },
    { id: 'jam', xp: 35, name: 'Jam, or make a loop', target: 1, count: ever(['jam', 'looper']) },
    { id: 'stems', xp: 40, name: 'Turn the part off and play it yourself', target: 1, count: ever(['stems']) },
    { id: 'discover', xp: 35, name: 'Go find new songs in Discover', target: 1, count: ever(['discover']) },
  ],
  backstage: [
    { id: 'bs-visit', xp: 30, name: 'Drop by Backstage', target: 1, count: ever(['backstage-visit']) },
    { id: 'bs-watch', xp: 40, name: 'Watch someone’s clip backstage', target: 1, count: ever(['backstage-watch']) },
    { id: 'bs-hi', xp: 40, name: 'Say hi to someone backstage', target: 1, count: ever(['backstage-message']) },
    { id: 'bs-show', xp: 50, name: 'Show one of your clips backstage', target: 1, count: ever(['backstage-share']) },
    { id: 'bs-tone', xp: 40, name: 'Keep a tone from someone’s clip', target: 1, count: ever(['backstage-tone']) },
  ],
};
const WEEKLY = {
  play: [
    { id: 'w-acc90', xp: 180, name: 'Get 90% on 5 different songs', target: 5, count: (t) => t.good90.size },
    { id: 'w-full15', xp: 150, name: 'Play 15 songs all the way through', target: 15, count: (t) => t.full.size },
    { id: 'w-days5', xp: 150, name: 'Play on 5 different days', target: 5, count: (t) => t.days.size },
    { id: 'w-hours3', xp: 170, name: 'Play for 3 hours', target: 180, count: (t) => Math.floor(t.seconds / 60), unit: 'min' },
    { id: 'w-new5', needs: 'unplayed5', xp: 130, name: 'Play 5 songs you’ve never played', target: 5, count: (t) => t.newSongs },
    { id: 'w-pb3', xp: 150, name: 'Beat 3 of your best scores', target: 3, count: (t) => t.bests },
    { id: 'w-tunings3', needs: 'tunings3', xp: 130, name: 'Play in 3 different tunings', target: 3, count: (t) => t.tunings.size },
    { id: 'w-streak300', xp: 180, name: 'Hit 300 notes in a row', target: 300, count: (t) => t.streak },
    { id: 'w-sections25', xp: 170, name: 'Play 25 sections without a miss', target: 25, count: (t) => t.sections },
  ],
  explore: [
    { id: 'w-tools3', xp: 100, name: 'Use 3 different tools: slow down, loop, tones, Jam, filming…', target: 3, count: (t) => ['slow', 'repeat', 'tone-try', 'jam', 'looper', 'record-video', 'stems', 'tab', 'discover'].filter((id) => t.did.has(id)).length },
  ],
  backstage: [
    { id: 'w-bs3', xp: 115, name: 'Drop by Backstage on 3 days', target: 3, count: (t) => t.didDays.get('backstage-visit') || 0 },
    { id: 'w-bswatch', xp: 125, name: 'Watch clips backstage on 2 days', target: 2, count: (t) => t.didDays.get('backstage-watch') || 0 },
  ],
};
const SONG_OF_WEEK = { id: 'w-song', xp: 180, target: 1, kind: 'play' };
const ALL_DAILY = new Map(Object.values(CHALLENGES).flat().map((c) => [c.id, c]));
const ALL_WEEKLY = new Map(Object.values(WEEKLY).flat().map((c) => [c.id, c]));
const KIND_OF = new Map();
for (const [k, pool] of Object.entries(CHALLENGES)) for (const c of pool) KIND_OF.set(c.id, k === 'skill' || k === 'gig' ? 'play' : k);
for (const [k, pool] of Object.entries(WEEKLY)) for (const c of pool) KIND_OF.set(c.id, k);
KIND_OF.set('backstage', 'backstage'); // 4.3.0's Backstage challenge

function hash(s) {
  let n = 2166136261;
  for (const ch of s) n = Math.imul(n ^ ch.codePointAt(0), 16777619) >>> 0;
  return n;
}
/**
 * 4.5: challenges reflect your library: one that needs something you don't have (songs off
 * standard tuning, bass parts, songs you haven't played) is skipped for the next in the pool.
 * `caps` = { offStandard, bass, unplayed, unplayed5, history, tunings3 } (missing = assume yes).
 */
const pick = (pool, key, caps = null) => {
  const i0 = hash(key) % pool.length;
  for (let n = 0; n < pool.length; n++) {
    const c = pool[(i0 + n) % pool.length];
    if (!c.needs || !caps || caps[c.needs] !== false) return c;
  }
  return pool[i0];
};
/** Today's four: playing, skill, the daily gig, and a wildcard (trying a feature or Backstage). */
function challengesFor(day, caps = null) {
  const wild = hash(`${day}:wild`) % 10 < 4 ? 'explore' : 'backstage';
  return [
    { ...pick(CHALLENGES.play, `${day}:0`, caps), kind: 'play' },
    { ...pick(CHALLENGES.skill, `${day}:1`, caps), kind: 'play' },
    { ...pick(CHALLENGES[wild], `${day}:2`, caps), kind: wild },
    { ...pick(CHALLENGES.gig, `${day}:3`, caps), kind: 'play', bonus: true },
  ];
}
/** This week's three: the song of the week (when there is one), a big playing one, and one more. */
function weeklyFor(week, songOfWeek = null, caps = null) {
  const pool = WEEKLY.play;
  const out = [];
  if (songOfWeek) out.push({ ...SONG_OF_WEEK, songId: songOfWeek.id, name: `Song of the week: 85% on “${songOfWeek.title || 'this song'}”`, song: songOfWeek, count: (t) => (t.weekSongBest >= 0.85 ? 1 : 0) });
  let a = hash(`${week}:a`) % pool.length;
  out.push({ ...pool[a], kind: 'play' });
  const r = hash(`${week}:c`) % 10;
  const extra = r < 1 ? 'explore' : r < 3 ? 'backstage' : 'play';
  if (extra !== 'play') out.push({ ...pick(WEEKLY[extra], `${week}:x`), kind: extra });
  const step = 1 + (hash(`${week}:b`) % (pool.length - 1));
  const ok = (c) => !c.needs || !caps || caps[c.needs] !== false;
  if (!ok(out[out.length - 1])) out[out.length - 1] = { ...pick(pool, `${week}:a`, caps), kind: 'play' };
  for (let guard = 0; out.length < 3 && guard < pool.length * 2; guard++) {
    const c = pool[(a = (a + step) % pool.length)];
    if (ok(c) && !out.some((o) => o.id === c.id)) out.push({ ...c, kind: 'play' });
  }
  return out.slice(0, 3);
}
/** The song of the week: one you've played but not got to 85% yet, or any song in your library. */
function pickWeekSong(week, songs = {}, sessions = []) {
  const ids = Object.keys(songs).sort();
  if (!ids.length) return null;
  const best = new Map();
  for (const s of sessions) if (s && s.songId && s.full && isFullSpeed(s) && s.accuracy !== null && s.accuracy !== undefined) best.set(s.songId, Math.max(best.get(s.songId) || 0, Number(s.accuracy)));
  const work = ids.filter((id) => best.has(id) && best.get(id) < 0.85);
  const pool = work.length >= 3 ? work : ids;
  return pool[hash(`${week}:song`) % pool.length];
}

// ------------------------------------------------------------- tallies --
const tally = () => ({
  seconds: 0, songs: new Set(), full: new Set(), bestFull: 0, bests: 0, good80: new Set(), good90: new Set(), newSongs: 0, oldSongs: 0,
  offStandard: 0, bass: 0, artists: new Set(), tunings: new Set(), streak: 0, sections: 0, kinds: { bend: 0, slide: 0, chord: 0, legato: 0 },
  days: new Set(), runs: [], encore: 0, set: 0, added: 0, firsts: 0, weekSongBest: 0, did: new Set(), didDays: new Map(),
});
/** Back to back: the longest run of whole songs at 80% or better with no more than 10 minutes between them. */
function setOf(runs) {
  let bestRun = 0;
  let run = 0;
  let endAt = -Infinity;
  for (const r of runs.sort((a, b) => a.at - b.at)) {
    if (r.at - endAt > 10 * 60 * 1000) run = 0;
    if (r.ok) run++;
    else if (r.full) run = 0;
    endAt = Math.max(endAt, r.at + r.seconds * 1000);
    bestRun = Math.max(bestRun, run);
  }
  return bestRun;
}

/**
 * Everything worked out from what's stored. Pure (no files), so it's easy to test.
 * @param {object} o
 * @param {Array} o.sessions stats.json sessions (all of them; only those from `resetAt` count)
 * @param {object} o.did { id: first time (ms) }
 * @param {object} o.daily { 'YYYY-MM-DD': [ids done that day] }
 * @param {object} o.done { 'YYYY-MM-DD:challenge': { xp, at, name } }
 * @param {object} [o.trophies] { 'id:tier': when reached (ms) }, kept so they stay earned
 * @param {number[]} o.added when songs were added to the library (ms)
 * @param {object} [o.songs] the library: { id: { title, artist, … } }
 * @param {string} [o.weekSong] the song of the week's id
 * @param {string} [o.title] the title you wear on your pass
 * @param {number} o.since when levels began (songs added before don't count)
 * @param {number} [o.resetAt] progression counts sessions from here (a reset moves it)
 * @param {number} [o.trophySince] achievements count sessions from here (an achievements reset)
 * @param {string[]} [o.legacy] venues kept from before 4.5
 * @param {object} [o.dev] developer adjustments: { xp, venues: {id: true|false}, unlockAll }
 * @param {object} [o.caps] what the library has, for challenges (see challengesFor)
 * @param {number} [o.now]
 */
function compute({ sessions = [], did = {}, daily = {}, done = {}, trophies = {}, added = [], songs = {}, weekSong, title = null, since = 0, resetAt = 0, trophySince = 0, legacy = [], dev = {}, caps = null, now = Date.now(), ask = null, weekly: askWeek = null }) {
  const awards = [];
  // 4.13: XP earned while singing, kept apart so Progress can show it quietly (it still counts toward your level)
  const sung = { xp: 0, songs: new Set(), seconds: 0 };
  let singing = false;
  const give = (key, xp, why, at, kind = 'play', extra = null) => {
    if (!(xp > 0)) return false;
    awards.push({ key, xp: Math.round(xp), why, at, kind, ...(extra || {}) });
    if (singing) sung.xp += Math.round(xp);
    return true;
  };
  const events = []; // the career timeline (besides awards): mastery, bests, firsts
  const seenSong = new Map();
  const tunings = new Set();
  const artists = new Set();
  const best = new Map();
  const firstAt = new Map();
  const minutesByDay = new Map();
  const fullsByDay = new Map(); // `${day}|song|part` -> full runs that day
  const playedDays = new Set();
  const runOf = new Map();
  const slowed = new Set();
  const conquered = new Set();
  const mastery = new Map();
  const today = dayKey(now);
  const week = weekKey(now);
  const T = tally();
  const W = tally();
  T.did = new Set(daily[today] || []);
  for (const [d, ids] of Object.entries(daily)) {
    if (d < week || d > today) continue;
    for (const id of ids || []) (W.did.add(id), W.didDays.set(id, (W.didDays.get(id) || 0) + 1));
  }
  const songsLib = songs && typeof songs === 'object' ? songs : {};
  const wsId = weekSong === undefined ? pickWeekSong(week, songsLib, sessions) : weekSong;
  const todayFullAcc = new Map();
  const C = Object.fromEntries(TROPHIES.map((t) => [t.id, 0]));
  const reached = new Map();
  const reach = (id, at) => {
    if (at < trophySince) return;
    const t = TROPHY.get(id);
    t.tiers.forEach((need, i) => C[id] >= need && !reached.has(`${id}:${i}`) && reached.set(`${id}:${i}`, at));
  };
  const autoFirst = (id, at) => {
    if (firstAt.has(id)) return;
    firstAt.set(id, at);
    give(`f:${id}`, FIRST.get(id).xp, FIRST.get(id).name, at);
  };
  // achievements count from trophySince: counters only grow for sessions after it
  const list = sessions.filter((s) => s && Number(s.at) >= resetAt && Number(s.at) > 0 && Number(s.seconds) > 0).sort((a, b) => a.at - b.at);
  const recentDays = []; // played day keys in order, for the weekly rhythm
  for (const s of list) {
    singing = s.part === 'vocals';
    if (singing) (sung.seconds += Number(s.seconds) || 0), s.songId && sung.songs.add(s.songId);
    const day = dayKey(s.at);
    const k = `s:${s.at}:${s.songId || 'free'}`;
    const isToday = day === today;
    const inWeek = day >= week && day <= today;
    const tl = [isToday && T, inWeek && W].filter(Boolean);
    const tc = s.at >= trophySince; // counts toward achievements
    if (!playedDays.has(day)) {
      playedDays.add(day);
      recentDays.push(s.at);
      let run = 1;
      while (playedDays.has(dayKey(s.at - run * DAY))) run++;
      runOf.set(day, run);
      if (tc) (C.days = Math.max(C.days, run)), reach('days', s.at);
    }
    // weekly rhythm: days played in the seven days up to this one
    let inLast7 = 0;
    for (let i = 0; i < 7; i++) if (playedDays.has(dayKey(s.at - i * DAY))) inLast7++;
    // a long day still counts, just a little less past the first hour or so (no burnout grind)
    const dayMin = (minutesByDay.get(`${day}:all`) || 0);
    minutesByDay.set(`${day}:all`, dayMin + s.seconds / 60);
    const mult = rhythmFor(inLast7) * (dayMin >= XP.longDayMinutes ? XP.longDayMult : 1);
    const earn = (key, xp, why) => give(key, xp * mult, mult !== 1 ? `${why} (x${mult.toFixed(2).replace(/0$/, '')})` : why, s.at);
    // minutes: actually playing. Notes scored but none hit = probably not playing
    const notes = Number(s.notes) || 0;
    const hitN = Number(s.hit) || 0;
    let rate = s.songId ? XP.minute : XP.minute * XP.freeMult;
    if (s.songId && notes >= 20 && hitN / notes < XP.idleHitRatio) rate *= XP.idleMult;
    else if (s.songId && (s.accuracy === null || s.accuracy === undefined) && !notes) rate *= XP.unscoredMult;
    const used = minutesByDay.get(day) || 0;
    const mins = Math.min(Math.max(0, XP.minutesPerDay - used), (s.seconds / 60) * rate);
    minutesByDay.set(day, used + mins);
    earn(`${k}:min`, mins, s.songId ? 'Playing' : 'Free playing');
    if (tc) (C.hours += s.seconds / 3600), reach('hours', s.at);
    for (const t of tl) (t.seconds += s.seconds), t.days.add(day);
    if (!s.songId) continue;
    // idle (notes scored, almost none hit) is not really playing the song
    const real = s.seconds >= XP.realSeconds && !(notes >= 20 && hitN / notes < XP.idleHitRatio);
    const last = seenSong.get(s.songId);
    if (last === undefined && real) {
      earn(`${k}:new`, XP.newSong, 'A new song');
      for (const t of tl) t.newSongs++;
      if (tc) (C.songs++, reach('songs', s.at));
    } else if (last !== undefined && s.at - last > 30 * DAY) for (const t of tl) t.oldSongs++;
    if (real || last !== undefined) seenSong.set(s.songId, s.at);
    for (const t of tl) t.songs.add(s.songId);
    const lib = songsLib[s.songId];
    const artist = lib && lib.artist ? String(lib.artist).trim().toLowerCase() : '';
    if (artist && real) {
      for (const t of tl) t.artists.add(artist);
      if (!artists.has(artist)) (artists.add(artist), tc && ((C.artists = artists.size), reach('artists', s.at)));
    }
    if (s.tuning && real) {
      for (const t of tl) t.tunings.add(s.tuning);
      if (!tunings.has(s.tuning)) {
        if (tunings.size) earn(`${k}:tuning`, XP.newTuning, `A new tuning: ${s.tuning}`);
        tunings.add(s.tuning);
        if (tc) (C.tunings = tunings.size), reach('tunings', s.at);
      }
      if (!STANDARD.test(s.tuning)) for (const t of tl) t.offStandard++;
    }
    if (real) {
      if (s.part === 'bass') autoFirst('part-bass', s.at);
      else if (s.part === 'rhythm') autoFirst('part-rhythm', s.at);
      else if (s.part === 'lead') autoFirst('part-lead', s.at);
      if (s.part === 'bass') for (const t of tl) t.bass++;
      if (!isFullSpeed(s)) slowed.add(s.songId);
    }
    const streak = Number(s.bestStreak) || 0;
    const clean = (Array.isArray(s.sections) ? s.sections : []).filter((x) => Array.isArray(x) && x[2] >= 10 && x[1] >= x[2]).length;
    const kinds = s.kinds && typeof s.kinds === 'object' ? s.kinds : {};
    const hits = (kd) => (Array.isArray(kinds[kd]) ? Math.max(0, Number(kinds[kd][0]) || 0) : 0);
    if (tc) {
      C.streak = Math.max(C.streak, streak);
      C.sections += clean;
      C.notes += hitN;
      for (const [kd, id] of [['bend', 'bends'], ['slide', 'slides'], ['chord', 'chords'], ['legato', 'legato']]) C[id] += hits(kd);
      for (const id of ['streak', 'sections', 'bends', 'slides', 'chords', 'legato', 'notes']) reach(id, s.at);
    }
    for (const t of tl) {
      t.streak = Math.max(t.streak, streak);
      t.sections += clean;
      for (const kd of Object.keys(t.kinds)) t.kinds[kd] += hits(kd);
    }

    const acc = s.accuracy === null || s.accuracy === undefined ? null : Number(s.accuracy);
    const scored = acc !== null && notes >= XP.scoredNotes && isFullSpeed(s);
    for (const t of tl) t.runs.push({ at: s.at, seconds: s.seconds, full: !!s.full, ok: !!s.full && scored && acc >= 0.8 });
    // song mastery (progression copy: XP for reaching Proficient, Expert, Mastered)
    const mk = `${s.songId}|${s.part || 'lead'}`;
    const wasTier = masteryTier(mastery.get(mk));
    const m = masteryAdd(mastery, s);
    const nowTier = masteryTier(m);
    if (nowTier > wasTier) {
      for (let tier = wasTier + 1; tier <= nowTier; tier++) {
        const x = XP.mastery[tier] || 0;
        if (x) give(`m:${mk}:${tier}`, x, `${MASTERY[tier].name}: ${(lib && lib.title) || 'a song'}`, s.at, 'play', { songId: s.songId });
        if (tier >= 4) events.push({ at: s.at, type: 'mastery', tier, songId: s.songId, part: s.part || 'lead', text: `${MASTERY[tier].name}: ${(lib && lib.title) || 'a song'}` });
      }
      if (nowTier === 6 && tc) (C.mastered++, reach('mastered', s.at));
    }
    if (s.full) {
      // short arrangements and replays of the same song on one day earn less (no farming)
      const short = notes ? Math.min(1, notes / XP.shortNotes) : Math.min(1, s.seconds / XP.shortSeconds);
      const fk = `${day}|${mk}`;
      const nth = fullsByDay.get(fk) || 0;
      fullsByDay.set(fk, nth + 1);
      const f = short * XP.repeatMult[Math.min(nth, XP.repeatMult.length - 1)];
      earn(`${k}:full`, XP.fullSong * f, 'Played a song in full');
      if (!firstAt.has('first-full')) events.push({ at: s.at, type: 'first', text: `First song all the way through: ${(lib && lib.title) || 'a song'}`, songId: s.songId });
      autoFirst('first-full', s.at);
      if (tc) {
        C.full++;
        if (s.part === 'bass') C.bass++;
        reach('full', s.at);
        reach('bass', s.at);
      }
      for (const t of tl) t.full.add(s.songId);
      if (scored) {
        const bonus = (XP.accuracy.find(([min]) => acc >= min) || [0, 0])[1];
        earn(`${k}:acc`, bonus * f, `${pct(acc)} on a whole song`);
        if (acc >= 0.9 && !firstAt.has('first-90')) events.push({ at: s.at, type: 'first', text: `First 90%: ${(lib && lib.title) || 'a song'}`, songId: s.songId });
        if (acc >= 0.999 && !firstAt.has('first-100')) events.push({ at: s.at, type: 'first', text: `First perfect song: ${(lib && lib.title) || 'a song'}`, songId: s.songId });
        if (acc >= 0.9) autoFirst('first-90', s.at);
        if (acc >= 0.999) autoFirst('first-100', s.at);
        if (tc) {
          if (acc >= 0.95) (C.acc95++, reach('acc95', s.at));
          if (acc >= 0.999) (C.perfect++, reach('perfect', s.at));
          if (acc >= 0.85 && slowed.has(s.songId) && !conquered.has(s.songId)) (conquered.add(s.songId), C.slowfast++, reach('slowfast', s.at));
        }
        for (const t of tl) {
          t.bestFull = Math.max(t.bestFull, acc);
          if (acc >= 0.9) t.good90.add(s.songId);
        }
        if (inWeek && s.songId === wsId) W.weekSongBest = Math.max(W.weekSongBest, acc);
        if (isToday) {
          const l = todayFullAcc.get(s.songId) || [];
          if (l.some((a) => acc > a)) T.encore = 1;
          l.push(acc);
          todayFullAcc.set(s.songId, l);
        }
      }
    }
    if (scored) {
      const was = best.get(mk);
      if (was !== undefined && acc >= was + XP.pbStep) {
        earn(`${k}:pb`, XP.personalBest, `A new best: ${pct(acc)}`);
        events.push({ at: s.at, type: 'best', text: `New best on ${(lib && lib.title) || 'a song'}: ${pct(was)} → ${pct(acc)}`, songId: s.songId, from: was, to: acc });
        for (const t of tl) t.bests++;
        if (tc) (C.improve++, reach('improve', s.at));
      }
      if (was === undefined || acc > was) best.set(mk, acc);
      if (acc >= 0.8) for (const t of tl) t.good80.add(s.songId);
    }
  }
  singing = false;
  T.set = setOf(T.runs);
  W.set = setOf(W.runs);
  for (const [id, at] of Object.entries(did)) {
    const f = FIRST.get(id);
    if (!f || f.auto) continue;
    const when = Number(at) || 0;
    if (when && when < resetAt) continue;
    give(`f:${id}`, f.xp, f.name, when, isBackstage(id) ? 'backstage' : 'explore');
    if (dayKey(when) === today) T.firsts++;
    if (dayKey(when) >= week && dayKey(when) <= today) W.firsts++;
  }
  for (const at of firstAt.values()) if (dayKey(at) === today) T.firsts++;
  const triedAt = (ids) => ids.map((id) => Number(did[id])).filter((x) => x > 0 && x >= trophySince).sort((a, b) => a - b);
  triedAt(TRY_IDS).forEach((at, i) => ((C.explorer = i + 1), reach('explorer', at)));
  triedAt(BACKSTAGE_IDS).forEach((at, i) => ((C.crew = i + 1), reach('crew', at)));
  const addedByDay = new Map();
  for (const at of added.filter((x) => x >= Math.max(since, resetAt)).sort((a, b) => a - b)) {
    const d = dayKey(at);
    const nn = addedByDay.get(d) || 0;
    addedByDay.set(d, nn + 1);
    if (d === today) T.added++;
    if (d >= week && d <= today) W.added++;
    if (nn < XP.addedPerDay) give(`a:${at}:${nn}`, XP.addedSong, 'A new song in your library', at, 'explore');
  }
  // challenges finished (kept)
  const doneList = Object.entries(done).filter(([, c]) => !c.at || c.at >= resetAt);
  for (const [key, c] of doneList) give(`c:${key}`, c.xp, `Challenge: ${c.name}`, c.at, c.kind || KIND_OF.get(key.split(':').pop()) || 'play');
  doneList.map(([, c]) => Number(c.at) || 0).filter((at) => at >= trophySince).sort((a, b) => a - b).forEach((at, i) => ((C.challenges = i + 1), reach('challenges', at)));
  // achievements: reached now or kept from before, each tier once
  for (const [key, at] of Object.entries(trophies || {})) if (!reached.has(key) && TROPHY.has(key.split(':')[0]) && Number(key.split(':')[1]) < TROPHY.get(key.split(':')[0]).tiers.length && (Number(at) || 0) >= trophySince) reached.set(key, Number(at) || 0);
  const trophyAward = (key, at) => {
    const [id, i] = key.split(':');
    const t = TROPHY.get(id);
    give(`t:${key}`, trophyXp(t, Number(i)), `Achievement: ${t.name} (${METALS[i].toLowerCase()})`, at, t.kind || 'play');
  };
  for (const [key, at] of reached) if (!key.startsWith('venues:')) trophyAward(key, at);
  // developer adjustment
  const adj = Math.round(Number(dev && dev.xp) || 0);
  let xp = awards.reduce((a, x) => a + x.xp, 0) + adj;
  xp = Math.max(0, xp);
  const level = levelOf(xp);
  // venues: by level, kept from before 4.5, or set by the developer menu
  const keep = new Set(legacy || []);
  const venues = VENUES.map((v) => {
    const o = dev && dev.venues ? dev.venues[v.venue] : undefined;
    const byLevel = level >= v.level;
    const open = o === false ? false : o === true || !!(dev && dev.unlockAll) || byLevel || keep.has(v.venue);
    return { ...v, unlocked: open, why: o !== undefined ? 'dev' : byLevel ? 'level' : keep.has(v.venue) ? 'kept' : dev && dev.unlockAll ? 'dev' : null };
  });
  C.venues = venues.filter((v) => v.unlocked).length;
  reach('venues', now);
  // the timeline of levels: when each level was reached, from the awards in time order
  const levelAt = [];
  {
    const sorted = [...awards].sort((a, b) => a.at - b.at);
    let sum = 0;
    let l = 1;
    for (const a of sorted) {
      sum += a.xp;
      while (l < CFG.CURVE.MAX && LEVEL_XP[l + 1] <= sum) levelAt.push({ level: ++l, at: a.at });
    }
  }
  for (const la of levelAt) {
    if (MILESTONES.includes(la.level)) events.push({ at: la.at, type: 'level', level: la.level, text: `Reached level ${la.level}` });
    for (const v of VENUES) if (v.level === la.level && v.level > 1) events.push({ at: la.at, type: 'venue', venue: v.venue, text: `Unlocked the ${v.name} venue` });
  }
  for (const [key, at] of reached) {
    const [id, i] = key.split(':');
    if (Number(i) >= 2 && id !== 'venues') events.push({ at, type: 'trophy', tier: Number(i), text: `${METALS[i]}: ${TROPHY.get(id).name}` });
  }
  const byKind = { play: 0, explore: 0, backstage: 0 };
  for (const a of awards) byKind[a.kind] = (byKind[a.kind] || 0) + a.xp;
  const card = (c, key, t) => {
    const value = Math.min(c.target, c.count(t));
    return { id: c.id, key, name: c.name, xp: c.xp, kind: c.kind, bonus: !!c.bonus, value, target: c.target, unit: c.unit || null, done: !!done[key] || value >= c.target };
  };
  const challenges = challengesFor(today, caps).map((c) => card(c, `${today}:${c.id}`, T));
  const wsLib = wsId && songsLib[wsId] ? { id: wsId, title: songsLib[wsId].title, artist: songsLib[wsId].artist } : null;
  const weekly = weeklyFor(week, wsLib, caps).map((c) => {
    const w = card(c, `${week}:${c.id}`, W);
    if (c.song) Object.assign(w, { songId: c.songId, artist: c.song.artist || '', best: W.weekSongBest });
    return w;
  });
  const trophyList = TROPHIES.map((t) => {
    let tier = -1;
    t.tiers.forEach((_, i) => reached.has(`${t.id}:${i}`) && (tier = i));
    const value = Math.floor(C[t.id]);
    const top = t.tiers.length - 1;
    const next = tier < top ? t.tiers[tier + 1] : null;
    return { id: t.id, group: t.group, name: t.name, what: t.what, kind: t.kind || 'play', tier, metal: tier >= 0 ? METALS[tier] : null, value, next, nextXp: next ? trophyXp(t, tier + 1) : 0, tiers: t.tiers, xp: t.xp !== false, at: tier >= 0 ? reached.get(`${t.id}:${tier}`) : null };
  });
  const earnedTitle = (t) => (t.level ? level >= t.level : reached.has(`${t.trophy[0]}:${t.trophy[1]}`));
  const titles = TITLES.map((t) => ({ id: t.id, name: t.name, how: titleHow(t), earned: earnedTitle(t) }));
  const wearing = titles.find((t) => t.id === title && t.earned) || null;
  const yesterday = dayKey(now - DAY);
  const days = runOf.get(today) || runOf.get(yesterday) || 0;
  let last7 = 0;
  const week7 = [];
  for (let i = 6; i >= 0; i--) {
    const on = playedDays.has(dayKey(now - i * DAY));
    week7.push(on);
    if (on) last7++;
  }
  const tried = new Set([...Object.keys(did), ...firstAt.keys()]);
  const dayOfWeek = (new Date(now).getDay() + 6) % 7;
  const nextVenue = venues.find((v) => !v.unlocked && v.level > level) || venues.find((v) => !v.unlocked) || null;
  const atMax = level >= CFG.CURVE.MAX;
  return {
    xp,
    level,
    max: CFG.CURVE.MAX,
    tier: tierOf(level),
    nextTier: TIERS.find((t) => t.from > level) || null,
    from: xpFor(level),
    to: atMax ? xpFor(level) : xpFor(level + 1),
    atMax,
    milestone: MILESTONES.includes(level),
    milestones: MILESTONES,
    levelXp: LEVEL_XP,
    nextMilestone: MILESTONES.find((m) => m > level) || null,
    next: nextVenue,
    venues,
    unlocked: venues.filter((v) => v.unlocked).map((v) => v.venue),
    challenges,
    weekly,
    week,
    weekLeft: 7 - dayOfWeek,
    // the weekly rhythm (no streak to lose): days played in the last seven and what that adds
    rhythm: { days: last7, mult: rhythmFor(last7), nextMult: rhythmFor(Math.min(7, last7 + (week7[6] ? 0 : 1))), today: !!week7[6], week: week7 },
    streak: { days, mult: rhythmFor(last7), today: runOf.has(today), nextMult: rhythmFor(Math.min(7, last7 + 1)) },
    trophies: trophyList,
    titles,
    title: wearing,
    firsts: FIRSTS.map((f) => ({ id: f.id, name: f.name, how: f.how, xp: f.xp, go: f.go, done: tried.has(f.id) })),
    unlocks: VENUES,
    recent: [...awards].sort((a, b) => b.at - a.at).slice(0, 60),
    today: awards.filter((a) => dayKey(a.at) === today).reduce((nn, a) => nn + a.xp, 0),
    timeline: events.sort((a, b) => b.at - a.at).slice(0, 400),
    levelAt,
    reached: Object.fromEntries(reached),
    weekSong: wsId || null,
    byKind,
    adjust: adj,
    resetAt,
    challengesDone: doneList.length,
    singing: { xp: sung.xp, songs: sung.songs.size, seconds: Math.round(sung.seconds) },
    ...(ask ? { asked: Object.fromEntries(ask.map((id) => [id, Math.min(ALL_DAILY.get(id).target, ALL_DAILY.get(id).count(T))])) } : {}),
    ...(askWeek ? { weeklyAsked: Object.fromEntries(askWeek.map((id) => [id, Math.min(ALL_WEEKLY.get(id).target, ALL_WEEKLY.get(id).count(W))])) } : {}),
  };
}

/** What the library offers, so challenges never ask for something you can't do. */
function capsOf(songs = {}, sessions = []) {
  const list = Object.values(songs || {});
  if (!list.length) return null;
  const played = new Set(sessions.filter((s) => s && s.songId).map((s) => s.songId));
  const tun = new Set(list.map((s) => s.tuning).filter(Boolean));
  const hasPart = (s, p) => Array.isArray(s.parts) ? s.parts.some((x) => String(x.name || x).toLowerCase().includes(p)) : true;
  const unplayed = list.filter((s) => !played.has(s.id)).length;
  return {
    offStandard: [...tun].some((t) => !STANDARD.test(String(t))) || !tun.size,
    bass: list.some((s) => hasPart(s, 'bass')),
    unplayed: unplayed >= 1,
    unplayed5: unplayed >= 5,
    history: sessions.some((s) => s && s.songId && s.at < Date.now() - 30 * DAY),
    tunings3: tun.size >= 3 || !tun.size,
  };
}

class Levels {
  /**
   * @param {object} o
   * @param {string} o.file levels.json
   * @param {Function} o.sessions () => stats sessions
   * @param {Function} [o.added] () => times songs were added to the library
   * @param {Function} [o.songs] () => the library's songs { id: { title, artist } }
   * @param {object} [o.backups] CareerBackups (a backup is made before migrations and resets)
   * @param {Function} [o.log]
   */
  constructor({ file, sessions, added, songs, backups = null, log = () => {} }) {
    Object.assign(this, { file, sessions, added: added || (() => []), songs: songs || (() => ({})), backups, log });
    this.data = null;
    this._cache = null;
  }

  async load() {
    let d;
    if (this.backups) {
      const r = await this.backups.safeRead(this.file, null);
      d = r.data;
    } else d = await readJson(this.file, null);
    const x = d || {};
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {});
    this.data = {
      since: Number(x.since) || Date.now(),
      did: obj(x.did),
      daily: obj(x.daily),
      done: obj(x.done),
      trophies: obj(x.trophies),
      weekSong: obj(x.weekSong),
      title: typeof x.title === 'string' ? x.title : null,
      resetAt: Number(x.resetAt) || 0,
      trophySince: Number(x.trophySince) || 0,
      legacy: Array.isArray(x.legacy) ? x.legacy.filter((v) => typeof v === 'string') : [],
      legacyLevel: Number(x.legacyLevel) || 0,
      dev: obj(x.dev),
      log: Array.isArray(x.log) ? x.log.slice(-300) : [],
      v: Number(x.v) || 0,
    };
    if (d && this.data.v < 3) await this.migrate();
    else if (!d) {
      this.data.v = 3;
      await this.save();
    }
    return this;
  }

  /**
   * 4.4 → 4.5: the venues you had under the old rules stay yours (every venue that wasn't
   * locked at your old level), and your old level is remembered for the timeline.
   */
  async migrate() {
    if (this.backups) await this.backups.backup('before-road-to-100').catch((e) => this.log(`Backup before the level update failed: ${e.message}`));
    let oldLevel = 0;
    try {
      const old = require('./levels-legacy');
      const st = old.compute({ sessions: this.sessions() || [], did: this.data.did, daily: this.data.daily, done: this.data.done, trophies: this.data.trophies, added: this.added() || [], songs: this.songs() || {}, title: this.data.title, since: this.data.since });
      oldLevel = st.level;
    } catch (e) {
      this.log(`Couldn’t work out the old level: ${e.message}`);
    }
    const lockedBefore = new Set(CFG.OLD_UNLOCKS.filter((u) => u.level > oldLevel).map((u) => u.venue));
    this.data.legacy = VENUES.filter((v) => v.level > 1 && v.venue !== 'valhalla' && !lockedBefore.has(v.venue)).map((v) => v.venue);
    this.data.legacyLevel = oldLevel;
    this.data.v = 3;
    this.event('migrate', `Moved to the Road to 100 (was level ${oldLevel}); kept ${this.data.legacy.length} venues`);
    await this.save();
    this.log(`Levels: moved to 4.5 (old level ${oldLevel}, kept venues: ${this.data.legacy.join(', ') || 'none'})`);
  }

  event(type, text, now = Date.now()) {
    this.data.log.push({ at: now, type, text });
    if (this.data.log.length > 300) this.data.log.splice(0, this.data.log.length - 300);
  }

  save() {
    this._cache = null;
    return writeJsonAtomic(this.file, { ...this.data, v: 3 });
  }

  /** You tried something. Returns the new state (or the same one if nothing changed). */
  async did(id, now = Date.now()) {
    id = String(id || '');
    const d = this.data;
    let changed = false;
    for (const f of [id, ALSO[id]]) if (f && FIRST.has(f) && !FIRST.get(f).auto && !d.did[f]) (d.did[f] = now), (changed = true);
    if (DAILY.has(id) || FIRST.has(id)) {
      const day = dayKey(now);
      const l = (d.daily[day] = d.daily[day] || []);
      if (!l.includes(id)) l.push(id), (changed = true);
      for (const k of Object.keys(d.daily)) if (k < dayKey(now - 14 * DAY)) delete d.daily[k];
    }
    if (changed) await this.save();
    return this.state(now);
  }

  /** Wear a title you've earned on your pass (null: the joke line). */
  async setTitle(id, now = Date.now()) {
    const st = this.state(now);
    const t = id ? st.titles.find((x) => x.id === id && x.earned) : null;
    if (id && !t) return st;
    this.data.title = t ? t.id : null;
    await this.save();
    return this.state(now);
  }

  _compute(now) {
    const d = this.data;
    const songs = this.songs() || {};
    const sessions = this.sessions() || [];
    const week = weekKey(now);
    let ws = d.weekSong[week];
    let picked = false;
    if (!ws || !songs[ws]) {
      ws = pickWeekSong(week, songs, sessions);
      if (ws) {
        d.weekSong = Object.fromEntries(Object.entries(d.weekSong).filter(([k]) => k >= dayKey(now - 21 * DAY)));
        d.weekSong[week] = ws;
        picked = true;
      }
    }
    const st = compute({ sessions, did: d.did, daily: d.daily, done: d.done, trophies: d.trophies, added: this.added() || [], songs, weekSong: ws || null, title: d.title, since: d.since, resetAt: d.resetAt, trophySince: d.trophySince, legacy: d.legacy, dev: d.dev, caps: capsOf(songs, sessions), now });
    st.legacyLevel = d.legacyLevel;
    st.devLog = d.log.slice(-60);
    return { st, picked };
  }

  /** The state for the page; finished challenges and achievements are kept as they come. */
  state(now = Date.now()) {
    const d = this.data;
    const sessions = this.sessions() || [];
    const last = sessions[sessions.length - 1];
    const key = `${sessions.length}|${last ? last.at : 0}|${dayKey(now)}|${Math.floor(now / 60000)}`;
    if (this._cache && this._cache.key === key) return this._cache.st;
    let { st, picked } = this._compute(now);
    const fresh = [...st.challenges, ...st.weekly].filter((c) => c.value >= c.target && !d.done[c.key]);
    const newTrophies = Object.keys(st.reached).filter((k) => !d.trophies[k] && !k.startsWith('venues:'));
    for (const k of newTrophies) d.trophies[k] = st.reached[k];
    if (fresh.length) {
      for (const c of fresh) d.done[c.key] = { xp: c.xp, at: now, name: c.name, kind: c.kind };
      st = this._compute(now).st;
    }
    if (fresh.length || newTrophies.length || picked) this.save().catch(() => {});
    this._cache = { key, st };
    return st;
  }

  // ------------------------------------------------- developer controls --
  // (main.js only lets these through when developer mode is on)
  async _devChange(what, fn, { backup = false } = {}) {
    if (backup && this.backups) await this.backups.backup(`before-${what}`);
    fn(this.data);
    this.data.dev = this.data.dev || {};
    this.event('dev', what);
    await this.save();
    return this.state();
  }

  /** Sets the level by adjusting XP (playing still adds on top). */
  setLevel(level) {
    const target = xpFor(Math.max(1, Math.min(CFG.CURVE.MAX, Math.round(level))));
    const raw = this.state().xp - (Number(this.data.dev.xp) || 0);
    return this._devChange(`set level ${level}`, (d) => (d.dev.xp = target - raw));
  }

  addXp(n) {
    return this._devChange(`${n >= 0 ? 'add' : 'remove'} ${Math.abs(n)} XP`, (d) => (d.dev.xp = (Number(d.dev.xp) || 0) + Math.round(n)));
  }

  /** true = unlocked, false = locked, null = back to normal. */
  setVenue(id, open) {
    return this._devChange(`venue ${id}: ${open === null ? 'normal' : open ? 'unlocked' : 'locked'}`, (d) => {
      d.dev.venues = { ...(d.dev.venues || {}) };
      if (open === null) delete d.dev.venues[id];
      else d.dev.venues[id] = !!open;
    });
  }

  unlockAll(on) {
    return this._devChange(on ? 'unlock all venues' : 'venues back to normal', (d) => {
      d.dev.unlockAll = !!on;
      d.dev.venues = {};
    });
  }

  /**
   * Starts progression over: level 1, no challenges, achievements, titles or kept venues.
   * Your playing history and lifetime statistics are not touched (a backup is made first).
   */
  resetProgression(now = Date.now()) {
    return this._devChange('reset progression', (d) => {
      Object.assign(d, { resetAt: now, trophySince: now, did: {}, daily: {}, done: {}, trophies: {}, title: null, legacy: [], dev: {} });
    }, { backup: true });
  }

  resetAchievements(now = Date.now()) {
    return this._devChange('reset achievements', (d) => {
      d.trophySince = now;
      d.trophies = {};
    }, { backup: true });
  }

  completeChallenge(key, now = Date.now()) {
    const st = this.state(now);
    const c = [...st.challenges, ...st.weekly].find((x) => x.key === key);
    if (!c) throw new Error('That challenge isn’t on the list');
    return this._devChange(`complete challenge ${c.name}`, (d) => (d.done[c.key] = { xp: c.xp, at: now, name: c.name, kind: c.kind }));
  }

  resetChallenges(now = Date.now()) {
    const today = dayKey(now);
    const week = weekKey(now);
    return this._devChange('reset this week’s challenges', (d) => {
      for (const k of Object.keys(d.done)) if (k.startsWith(`${today}:`) || k.startsWith(`${week}:`)) delete d.done[k];
      delete d.daily[today];
    }, { backup: true });
  }

  /** Puts levels.json back as a fresh object (after a restore). */
  async reload() {
    this._cache = null;
    await this.load();
    return this.state();
  }
}

module.exports = { Levels, compute, capsOf, xpFor, levelOf, tierOf, rhythmFor, multFor: rhythmFor, masteryOf, masteryTier, challengesFor, weeklyFor, pickWeekSong, TIERS, UNLOCKS, VENUES, FIRSTS, TROPHIES, TITLES, CHALLENGES, WEEKLY, MASTERY, MILESTONES, METALS, dayKey, weekKey };
