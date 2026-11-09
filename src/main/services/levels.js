'use strict';
/**
 * Levels (4.4): points (XP) for playing and for trying things, a level, and a pass style.
 *
 * Nothing is counted twice: the XP is worked out again from scratch each time from
 *  - your playing (stats.json sessions): minutes, songs played in full, doing well,
 *    personal bests, new songs, new tunings, parts; days in a row multiply it (up to x1.5);
 *  - trophies (each tier once), worked out from the same playing;
 *  - things you've tried once (`did`, kept in levels.json): Backstage, the looper, the Drop…;
 *  - songs added to your library since levels began (a few points each, capped per day);
 *  - today's and this week's challenges, kept in `done` once finished (so changing the
 *    list later never takes points away). Trophies reached are kept the same way.
 * Old playing counts too, so a long-time player starts at the level they've earned.
 *
 * Most of it is about playing, like a rhythm game. Trying the app's features is about a
 * tenth of the challenges, and Backstage a little more than that.
 */
const { readJson, writeJsonAtomic } = require('../core/files');

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
const isBackstage = (id) => id.startsWith('backstage-');
/** Things that count again each day (for the challenges). */
const DAILY = new Set(['backstage-visit', 'backstage-share', 'tone-try', 'record-video', 'looper', 'slow', 'repeat', 'stems', 'discover', 'jam', 'tab']);
/** Things that only count today, never as a first time (showing a clip also counts as the first show). */
const ALSO = { 'backstage-share': 'backstage-show' };

const STANDARD = /^(e )?standard$/i;
const isFullSpeed = (s) => (s.speed || 1) >= 0.999;
const pct = (x) => `${Math.round(x * 100)}%`;

// ------------------------------------------------------------ trophies --
/**
 * Trophies: bronze, silver, gold, platinum. Each tier gives its XP once.
 * All from your playing, except the last two (trying things, Backstage), which give half.
 */
const METALS = ['Bronze', 'Silver', 'Gold', 'Platinum'];
const TROPHY_XP = [20, 50, 100, 200];
const TRY_IDS = FIRSTS.filter((f) => !f.auto && !isBackstage(f.id)).map((f) => f.id);
const BACKSTAGE_IDS = FIRSTS.filter((f) => isBackstage(f.id)).map((f) => f.id);
const TROPHIES = [
  { id: 'full', name: 'Setlist survivor', what: 'Songs played all the way through', tiers: [10, 50, 200, 500] },
  { id: 'acc95', name: 'Sharpshooter', what: 'Whole songs at 95% or better', tiers: [1, 10, 50, 150] },
  { id: 'perfect', name: 'Flawless', what: 'Whole songs at 100%', tiers: [1, 5, 20, 50] },
  { id: 'streak', name: 'Combo king', what: 'Most notes hit in a row', tiers: [50, 100, 250, 500] },
  { id: 'sections', name: 'Clean sweep', what: 'Sections played without a miss', tiers: [10, 50, 200, 600] },
  { id: 'hours', name: 'Road warrior', what: 'Hours played', tiers: [5, 25, 100, 300] },
  { id: 'days', name: 'Never miss a gig', what: 'Days in a row playing', tiers: [3, 7, 30, 100] },
  { id: 'songs', name: 'Deep cuts', what: 'Different songs played', tiers: [10, 50, 150, 400] },
  { id: 'artists', name: 'Crate digger', what: 'Different artists played', tiers: [5, 15, 40, 100] },
  { id: 'tunings', name: 'Tuning fork', what: 'Different tunings played', tiers: [2, 4, 6, 9] },
  { id: 'bends', name: 'Bend wizard', what: 'Bends hit', tiers: [100, 500, 2000, 6000] },
  { id: 'slides', name: 'Slide rule', what: 'Slides hit', tiers: [100, 500, 2000, 6000] },
  { id: 'chords', name: 'Chord crusher', what: 'Chords hit', tiers: [250, 1500, 6000, 20000] },
  { id: 'legato', name: 'Hammer time', what: 'Hammer-ons and pull-offs hit', tiers: [200, 1000, 4000, 12000] },
  { id: 'slowfast', name: 'Slow and steady', what: 'Songs you slowed down to learn, then got 85% at full speed', tiers: [1, 5, 15, 40] },
  { id: 'bass', name: 'Low end', what: 'Bass parts played all the way through', tiers: [1, 10, 50, 150] },
  { id: 'explorer', name: 'Gear nerd', what: 'Things tried from the list', tiers: [3, 6, 10, TRY_IDS.length], kind: 'explore' },
  { id: 'crew', name: 'Backstage crew', what: 'Backstage things done', tiers: [1, 2, 4, BACKSTAGE_IDS.length], kind: 'backstage' },
];
const trophyXp = (t, i) => (t.kind ? Math.round(TROPHY_XP[i] / 2) : TROPHY_XP[i]);

/** Titles you earn and can wear on your Backstage pass instead of the joke line. */
const TITLES = [
  { id: 'garage-legend', name: 'Garage Legend', level: 5 },
  { id: 'arena-rocker', name: 'Arena Rocker', level: 15 },
  { id: 'living-legend', name: 'Living Legend', level: 25 },
  { id: 'setlist', name: 'Setlist Survivor', trophy: ['full', 1] },
  { id: 'shred-lord', name: 'Shred Lord', trophy: ['acc95', 2] },
  { id: 'perfectionist', name: 'The Perfectionist', trophy: ['perfect', 0] },
  { id: 'metronome', name: 'Human Metronome', trophy: ['streak', 2] },
  { id: 'clean', name: 'Clean Machine', trophy: ['sections', 1] },
  { id: 'road-dog', name: 'Road Dog', trophy: ['hours', 1] },
  { id: 'iron-man', name: 'Iron Man of Rock', trophy: ['days', 2] },
  { id: 'crate-digger', name: 'Crate Digger', trophy: ['artists', 1] },
  { id: 'drop-tuned', name: 'Drop-Tuned Devotee', trophy: ['tunings', 1] },
  { id: 'bend-wizard', name: 'Bend Wizard', trophy: ['bends', 1] },
  { id: 'slide-master', name: 'Slide Master', trophy: ['slides', 1] },
  { id: 'chord-crusher', name: 'Chord Crusher', trophy: ['chords', 1] },
  { id: 'hammer', name: 'Hammer Time', trophy: ['legato', 1] },
  { id: 'patient', name: 'Patient Shredder', trophy: ['slowfast', 1] },
  { id: 'four-string', name: 'Four-String Hero', trophy: ['bass', 1] },
  { id: 'gear-nerd', name: 'Gear Nerd', trophy: ['explorer', 1] },
  { id: 'scene', name: 'Scene Regular', trophy: ['crew', 2] },
];
const TROPHY = new Map(TROPHIES.map((t) => [t.id, t]));
const titleHow = (t) => (t.level ? `Reach level ${t.level}` : `${METALS[t.trophy[1]]} in ${TROPHY.get(t.trophy[0]).name}`);

/** Days in a row multiply what you earn from playing: x1.1 for two days, up to x1.5. */
const multFor = (run) => Math.min(1.5, 1 + 0.1 * (Math.max(1, run) - 1));

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
    { id: 'newsong', xp: 35, name: 'Play a song you’ve never played', target: 1, count: (t) => t.newSongs },
    { id: 'oldsong', xp: 35, name: 'Dust one off: a song you haven’t played in a month', target: 1, count: (t) => t.oldSongs },
    { id: 'tuning', xp: 35, name: 'Play a song that isn’t in standard tuning', target: 1, count: (t) => t.offStandard },
    { id: 'bass', xp: 35, name: 'Play a bass part', target: 1, count: (t) => t.bass },
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
    { id: 'w-new5', xp: 130, name: 'Play 5 songs you’ve never played', target: 5, count: (t) => t.newSongs },
    { id: 'w-pb3', xp: 150, name: 'Beat 3 of your best scores', target: 3, count: (t) => t.bests },
    { id: 'w-tunings3', xp: 130, name: 'Play in 3 different tunings', target: 3, count: (t) => t.tunings.size },
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
const pick = (pool, key) => pool[hash(key) % pool.length];
/** Today's four: playing, skill, the daily gig, and a wildcard (trying a feature or Backstage). */
function challengesFor(day) {
  const wild = hash(`${day}:wild`) % 10 < 4 ? 'explore' : 'backstage';
  return [
    { ...pick(CHALLENGES.play, `${day}:0`), kind: 'play' },
    { ...pick(CHALLENGES.skill, `${day}:1`), kind: 'play' },
    { ...pick(CHALLENGES[wild], `${day}:2`), kind: wild },
    { ...pick(CHALLENGES.gig, `${day}:3`), kind: 'play', bonus: true },
  ];
}
/** This week's three: the song of the week (when there is one), a big playing one, and one more. */
function weeklyFor(week, songOfWeek = null) {
  const pool = WEEKLY.play;
  const out = [];
  if (songOfWeek) out.push({ ...SONG_OF_WEEK, songId: songOfWeek.id, name: `Song of the week: 85% on “${songOfWeek.title || 'this song'}”`, song: songOfWeek, count: (t) => (t.weekSongBest >= 0.85 ? 1 : 0) });
  let a = hash(`${week}:a`) % pool.length;
  out.push({ ...pool[a], kind: 'play' });
  const r = hash(`${week}:c`) % 10;
  const extra = r < 1 ? 'explore' : r < 3 ? 'backstage' : 'play';
  if (extra !== 'play') out.push({ ...pick(WEEKLY[extra], `${week}:x`), kind: extra });
  const step = 1 + (hash(`${week}:b`) % (pool.length - 1));
  while (out.length < 3) out.push({ ...pool[(a = (a + step) % pool.length)], kind: 'play' });
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
 * @param {Array} o.sessions stats.json sessions
 * @param {object} o.did { id: first time (ms) }
 * @param {object} o.daily { 'YYYY-MM-DD': [ids done that day] }
 * @param {object} o.done { 'YYYY-MM-DD:challenge': { xp, at, name } } (weekly ones keyed by the week's Monday and a w- id)
 * @param {object} [o.trophies] { 'id:tier': when reached (ms) }, kept so they stay earned
 * @param {number[]} o.added when songs were added to the library (ms)
 * @param {object} [o.songs] the library: { id: { title, artist } }
 * @param {string} [o.weekSong] the song of the week's id (picked from the library when not given)
 * @param {string} [o.title] the title you wear on your pass
 * @param {number} o.since when levels began (songs added before don't count)
 * @param {number} [o.now]
 * @param {string[]} [o.ask] daily challenge ids to report today's progress on (for tests)
 * @param {string[]} [o.weekly] the same for weekly ones
 */
function compute({ sessions = [], did = {}, daily = {}, done = {}, trophies = {}, added = [], songs = {}, weekSong, title = null, since = 0, now = Date.now(), ask = null, weekly: askWeek = null }) {
  const awards = [];
  const give = (key, xp, why, at, kind = 'play') => xp > 0 && awards.push({ key, xp: Math.round(xp), why, at, kind });
  const seenSong = new Map(); // songId -> last time played
  const tunings = new Set();
  const artists = new Set();
  const best = new Map(); // `${songId}|${part}` -> best full-speed accuracy
  const firstAt = new Map(); // auto firsts
  const minutesByDay = new Map();
  const playedDays = new Set();
  const runOf = new Map(); // day -> days in a row up to it
  const slowed = new Set();
  const conquered = new Set();
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
  const todayFullAcc = new Map(); // songId -> [accuracies in order], for the encore
  // trophies: running counts, and when each tier was first reached
  const C = Object.fromEntries(TROPHIES.map((t) => [t.id, 0]));
  const reached = new Map(); // 'id:tier' -> at
  const reach = (id, at) => {
    const t = TROPHY.get(id);
    t.tiers.forEach((need, i) => C[id] >= need && !reached.has(`${id}:${i}`) && reached.set(`${id}:${i}`, at));
  };
  const autoFirst = (id, at) => {
    if (firstAt.has(id)) return;
    firstAt.set(id, at);
    give(`f:${id}`, FIRST.get(id).xp, FIRST.get(id).name, at);
  };
  const list = sessions.filter((s) => s && Number(s.at) > 0 && Number(s.seconds) > 0).sort((a, b) => a.at - b.at);
  for (const s of list) {
    const day = dayKey(s.at);
    const k = `s:${s.at}:${s.songId || 'free'}`;
    const isToday = day === today;
    const inWeek = day >= week && day <= today;
    const tl = [isToday && T, inWeek && W].filter(Boolean);
    // days in a row: a multiplier on what you earn from playing that day
    if (!playedDays.has(day)) {
      playedDays.add(day);
      let run = 1;
      while (playedDays.has(dayKey(s.at - run * DAY))) run++;
      runOf.set(day, run);
      C.days = Math.max(C.days, run);
      reach('days', s.at);
    }
    const mult = multFor(runOf.get(day));
    const earn = (key, xp, why) => give(key, xp * mult, mult > 1 ? `${why} (x${mult.toFixed(1)})` : why, s.at);
    // minutes: a point a minute with a song, half without; at most 180 a day
    const used = minutesByDay.get(day) || 0;
    const mins = Math.min(Math.max(0, 180 - used), (s.seconds / 60) * (s.songId ? 1 : 0.5));
    minutesByDay.set(day, used + mins);
    earn(`${k}:min`, mins, s.songId ? 'Playing' : 'Free playing');
    C.hours += s.seconds / 3600;
    reach('hours', s.at);
    for (const t of tl) (t.seconds += s.seconds), t.days.add(day);
    if (!s.songId) continue;
    const real = s.seconds >= 30;
    const last = seenSong.get(s.songId);
    if (last === undefined && real) {
      earn(`${k}:new`, 20, 'A new song');
      for (const t of tl) t.newSongs++;
      C.songs++;
      reach('songs', s.at);
    } else if (last !== undefined && s.at - last > 30 * DAY) for (const t of tl) t.oldSongs++;
    if (real || last !== undefined) seenSong.set(s.songId, s.at);
    for (const t of tl) t.songs.add(s.songId);
    const lib = songsLib[s.songId];
    const artist = lib && lib.artist ? String(lib.artist).trim().toLowerCase() : '';
    if (artist && real) {
      for (const t of tl) t.artists.add(artist);
      if (!artists.has(artist)) (artists.add(artist), (C.artists = artists.size), reach('artists', s.at));
    }
    if (s.tuning && real) {
      for (const t of tl) t.tunings.add(s.tuning);
      if (!tunings.has(s.tuning)) {
        if (tunings.size) earn(`${k}:tuning`, 40, `A new tuning: ${s.tuning}`);
        tunings.add(s.tuning);
        C.tunings = tunings.size;
        reach('tunings', s.at);
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
    // the breakdown: longest run of notes, clean sections, kinds of notes hit
    const streak = Number(s.bestStreak) || 0;
    C.streak = Math.max(C.streak, streak);
    const clean = (Array.isArray(s.sections) ? s.sections : []).filter((x) => Array.isArray(x) && x[2] >= 10 && x[1] >= x[2]).length;
    C.sections += clean;
    const kinds = s.kinds && typeof s.kinds === 'object' ? s.kinds : {};
    const hits = (kd) => (Array.isArray(kinds[kd]) ? Math.max(0, Number(kinds[kd][0]) || 0) : 0);
    for (const [kd, id] of [['bend', 'bends'], ['slide', 'slides'], ['chord', 'chords'], ['legato', 'legato']]) C[id] += hits(kd);
    for (const t of tl) {
      t.streak = Math.max(t.streak, streak);
      t.sections += clean;
      for (const kd of Object.keys(t.kinds)) t.kinds[kd] += hits(kd);
    }
    for (const id of ['streak', 'sections', 'bends', 'slides', 'chords', 'legato']) reach(id, s.at);

    const acc = s.accuracy === null || s.accuracy === undefined ? null : Number(s.accuracy);
    const scored = acc !== null && (s.notes || 0) >= 50 && isFullSpeed(s);
    for (const t of tl) t.runs.push({ at: s.at, seconds: s.seconds, full: !!s.full, ok: !!s.full && scored && acc >= 0.8 });
    if (s.full) {
      earn(`${k}:full`, 25, 'Played a song in full');
      autoFirst('first-full', s.at);
      C.full++;
      if (s.part === 'bass') C.bass++;
      reach('full', s.at);
      reach('bass', s.at);
      for (const t of tl) t.full.add(s.songId);
      // doing well is worth the most
      if (scored) {
        const bonus = acc >= 0.999 ? 150 : acc >= 0.95 ? 70 : acc >= 0.9 ? 40 : acc >= 0.8 ? 15 : 0;
        earn(`${k}:acc`, bonus, `${pct(acc)} on a whole song`);
        if (acc >= 0.9) autoFirst('first-90', s.at);
        if (acc >= 0.999) autoFirst('first-100', s.at);
        if (acc >= 0.95) (C.acc95++, reach('acc95', s.at));
        if (acc >= 0.999) (C.perfect++, reach('perfect', s.at));
        if (acc >= 0.85 && slowed.has(s.songId) && !conquered.has(s.songId)) (conquered.add(s.songId), C.slowfast++, reach('slowfast', s.at));
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
      const bk = `${s.songId}|${s.part || 'lead'}`;
      const was = best.get(bk);
      if (was !== undefined && acc >= was + 0.02) {
        earn(`${k}:pb`, 30, `A new best: ${pct(acc)}`);
        for (const t of tl) t.bests++;
      }
      if (was === undefined || acc > was) best.set(bk, acc);
      if (acc >= 0.8) for (const t of tl) t.good80.add(s.songId);
    }
  }
  T.set = setOf(T.runs);
  W.set = setOf(W.runs);
  // things tried once
  for (const [id, at] of Object.entries(did)) {
    const f = FIRST.get(id);
    if (!f || f.auto) continue;
    const when = Number(at) || 0;
    give(`f:${id}`, f.xp, f.name, when, isBackstage(id) ? 'backstage' : 'explore');
    if (dayKey(when) === today) T.firsts++;
    if (dayKey(when) >= week && dayKey(when) <= today) W.firsts++;
  }
  for (const at of firstAt.values()) if (dayKey(at) === today) T.firsts++;
  const triedAt = (ids) => ids.map((id) => Number(did[id])).filter((x) => x > 0).sort((a, b) => a - b);
  triedAt(TRY_IDS).forEach((at, i) => ((C.explorer = i + 1), reach('explorer', at)));
  triedAt(BACKSTAGE_IDS).forEach((at, i) => ((C.crew = i + 1), reach('crew', at)));
  // new songs in your library: 10 each, up to 50 a day
  const addedByDay = new Map();
  for (const at of added.filter((x) => x >= since).sort((a, b) => a - b)) {
    const d = dayKey(at);
    const n = addedByDay.get(d) || 0;
    addedByDay.set(d, n + 1);
    if (d === today) T.added++;
    if (d >= week && d <= today) W.added++;
    if (n < 5) give(`a:${at}:${n}`, 10, 'A new song in your library', at, 'explore');
  }
  // trophies: reached now or kept from before, each tier once
  for (const [key, at] of Object.entries(trophies || {})) if (!reached.has(key) && TROPHY.has(key.split(':')[0])) reached.set(key, Number(at) || 0);
  for (const [key, at] of reached) {
    const [id, i] = key.split(':');
    const t = TROPHY.get(id);
    give(`t:${key}`, trophyXp(t, Number(i)), `Trophy: ${t.name} (${METALS[i].toLowerCase()})`, at, t.kind || 'play');
  }
  // finished challenges (kept, so they stay earned)
  for (const [key, c] of Object.entries(done)) give(`c:${key}`, c.xp, `Challenge: ${c.name}`, c.at, c.kind || KIND_OF.get(key.split(':').pop()) || 'play');

  const xp = awards.reduce((a, x) => a + x.xp, 0);
  const byKind = { play: 0, explore: 0, backstage: 0 };
  for (const a of awards) byKind[a.kind] = (byKind[a.kind] || 0) + a.xp;
  const level = levelOf(xp);
  const card = (c, key, t) => {
    const value = Math.min(c.target, c.count(t));
    return { id: c.id, key, name: c.name, xp: c.xp, kind: c.kind, bonus: !!c.bonus, value, target: c.target, unit: c.unit || null, done: !!done[key] || value >= c.target };
  };
  const challenges = challengesFor(today).map((c) => card(c, `${today}:${c.id}`, T));
  const wsLib = wsId && songsLib[wsId] ? { id: wsId, title: songsLib[wsId].title, artist: songsLib[wsId].artist } : null;
  const weekly = weeklyFor(week, wsLib).map((c) => {
    const w = card(c, `${week}:${c.id}`, W);
    if (c.song) Object.assign(w, { songId: c.songId, artist: c.song.artist || '', best: W.weekSongBest });
    return w;
  });
  // the trophy case
  const trophyList = TROPHIES.map((t) => {
    let tier = -1;
    t.tiers.forEach((_, i) => reached.has(`${t.id}:${i}`) && (tier = i));
    const value = Math.floor(C[t.id]);
    const next = tier < 3 ? t.tiers[tier + 1] : null;
    return { id: t.id, name: t.name, what: t.what, kind: t.kind || 'play', tier, metal: tier >= 0 ? METALS[tier] : null, value, next, nextXp: next ? trophyXp(t, tier + 1) : 0, tiers: t.tiers };
  });
  const earnedTitle = (t) => (t.level ? level >= t.level : reached.has(`${t.trophy[0]}:${t.trophy[1]}`));
  const titles = TITLES.map((t) => ({ id: t.id, name: t.name, how: titleHow(t), earned: earnedTitle(t) }));
  const wearing = titles.find((t) => t.id === title && t.earned) || null;
  // days in a row: alive while you played today or yesterday
  const yesterday = dayKey(now - DAY);
  const days = runOf.get(today) || runOf.get(yesterday) || 0;
  const tried = new Set([...Object.keys(did), ...firstAt.keys()]);
  const dayOfWeek = (new Date(now).getDay() + 6) % 7;
  return {
    xp,
    level,
    tier: tierOf(level),
    from: xpFor(level),
    to: xpFor(level + 1),
    next: UNLOCKS.find((u) => u.level > level) || null,
    unlocked: UNLOCKS.filter((u) => u.level <= level).map((u) => u.venue),
    challenges,
    weekly,
    week,
    weekLeft: 7 - dayOfWeek,
    streak: { days, mult: multFor(runOf.get(today) || 1), today: runOf.has(today), nextMult: multFor((runOf.get(today) || runOf.get(yesterday) || 0) + (runOf.has(today) ? 0 : 1)) },
    trophies: trophyList,
    titles,
    title: wearing,
    firsts: FIRSTS.map((f) => ({ id: f.id, name: f.name, how: f.how, xp: f.xp, go: f.go, done: tried.has(f.id) })),
    unlocks: UNLOCKS,
    recent: awards.sort((a, b) => b.at - a.at).slice(0, 60),
    today: awards.filter((a) => dayKey(a.at) === today).reduce((n, a) => n + a.xp, 0),
    // for keeping: trophy tiers reached (the service saves the new ones)
    reached: Object.fromEntries(reached),
    weekSong: wsId || null,
    byKind, // XP from playing, from trying features, and from Backstage
    ...(ask ? { asked: Object.fromEntries(ask.map((id) => [id, Math.min(ALL_DAILY.get(id).target, ALL_DAILY.get(id).count(T))])) } : {}),
    ...(askWeek ? { weeklyAsked: Object.fromEntries(askWeek.map((id) => [id, Math.min(ALL_WEEKLY.get(id).target, ALL_WEEKLY.get(id).count(W))])) } : {}),
  };
}

class Levels {
  /**
   * @param {object} o
   * @param {string} o.file levels.json
   * @param {Function} o.sessions () => stats sessions
   * @param {Function} [o.added] () => times songs were added to the library
   * @param {Function} [o.songs] () => the library's songs { id: { title, artist } }
   */
  constructor({ file, sessions, added, songs }) {
    Object.assign(this, { file, sessions, added: added || (() => []), songs: songs || (() => ({})) });
    this.data = null;
  }

  async load() {
    const d = await readJson(this.file, null);
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
    };
    if (!d) await this.save();
    return this;
  }

  save() {
    return writeJsonAtomic(this.file, { v: 2, ...this.data });
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
      // keep two weeks
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
    const week = weekKey(now);
    // the song of the week stays put all week (unless it leaves your library)
    let ws = d.weekSong[week];
    let picked = false;
    if (!ws || !songs[ws]) {
      ws = pickWeekSong(week, songs, this.sessions() || []);
      if (ws) {
        d.weekSong = Object.fromEntries(Object.entries(d.weekSong).filter(([k]) => k >= dayKey(now - 21 * DAY)));
        d.weekSong[week] = ws;
        picked = true;
      }
    }
    const st = compute({ sessions: this.sessions() || [], did: d.did, daily: d.daily, done: d.done, trophies: d.trophies, added: this.added() || [], songs, weekSong: ws || null, title: d.title, since: d.since, now });
    return { st, picked };
  }

  /** The state for the page; finished challenges and trophies are kept as they come. */
  state(now = Date.now()) {
    const d = this.data;
    let { st, picked } = this._compute(now);
    const fresh = [...st.challenges, ...st.weekly].filter((c) => c.value >= c.target && !d.done[c.key]);
    const newTrophies = Object.keys(st.reached).filter((k) => !d.trophies[k]);
    for (const k of newTrophies) d.trophies[k] = st.reached[k];
    if (fresh.length) {
      for (const c of fresh) d.done[c.key] = { xp: c.xp, at: now, name: c.name, kind: c.kind };
      st = this._compute(now).st;
    }
    if (fresh.length || newTrophies.length || picked) this.save().catch(() => {});
    return st;
  }
}

module.exports = { Levels, compute, xpFor, levelOf, tierOf, challengesFor, weeklyFor, pickWeekSong, multFor, TIERS, UNLOCKS, FIRSTS, TROPHIES, TITLES, CHALLENGES, WEEKLY, dayKey, weekKey };
