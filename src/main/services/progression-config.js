'use strict';
/**
 * 4.5: The Road to 100. Every number that shapes progression lives here, so balancing
 * means editing this file (and running `node test/progression-sim.test.js` to see what a
 * year of playing looks like), never hunting through the code.
 *
 * How the curve was chosen (services/progression-sim.js runs a year of playing through the
 * real XP rules; docs/progression.md has the table): the curve's four numbers were fitted so
 *   regular, dedicated (4–5 days a week, ~45 min): level 8 after a week, 24 after a month,
 *     45 after three months, 69 after six, 86 after nine, level 100 at about one year;
 *   heavy (6 days a week, ~90 min): level 100 in about five and a half months;
 *   casual (2 days a week, ~30 min): about level 44 after a year.
 * Nothing is lost by missing days.
 */

// ------------------------------------------------------------ the curve --
/**
 * XP to go from level L to L+1 = BASE + STEP·(L−1) + CURVE·(L−1)^POW. Early levels are quick
 * (a few songs), the middle steady, and 75–100 take real dedication.
 */
const CURVE = { MAX: 100, BASE: 540, STEP: 15, CURVE: 0.005, POW: 2.75 };
const stepXp = (l) => Math.round(CURVE.BASE + CURVE.STEP * (l - 1) + CURVE.CURVE * Math.pow(l - 1, CURVE.POW));
/** Total XP needed to reach each level (index = level; [1] = 0). */
const LEVEL_XP = [0, 0];
for (let l = 1; l < CURVE.MAX; l++) LEVEL_XP.push(LEVEL_XP[l] + stepXp(l));

// ---------------------------------------------------------- XP for play --
const XP = {
  /** per minute actually playing with a song; free playing (no song) earns FREE_MULT of it */
  minute: 1,
  freeMult: 0.5,
  /** most minutes that earn XP in one day (more playing still counts for everything else) */
  minutesPerDay: 180,
  /** after this many minutes in a day, playing XP (songs, accuracy, minutes) earns `longDayMult` */
  longDayMinutes: 60,
  longDayMult: 0.5,
  /** a session where the notes were scored but almost none were hit: probably not playing */
  idleHitRatio: 0.05,
  idleMult: 0.1,
  /** scoring off (no notes judged) earns this much of the minute XP */
  unscoredMult: 0.75,
  /** shortest session that counts as playing a song */
  realSeconds: 30,
  newSong: 20,
  newTuning: 40,
  fullSong: 25,
  /** whole-song accuracy bonuses, best first */
  accuracy: [[0.999, 150], [0.95, 70], [0.9, 40], [0.8, 15]],
  /** beating your best (full speed) by at least `pbStep` */
  personalBest: 30,
  pbStep: 0.02,
  /** whole songs score only with at least this many judged notes */
  scoredNotes: 50,
  /** a short arrangement earns a share of the song bonuses: notes / shortNotes (or seconds / shortSeconds) */
  shortNotes: 150,
  shortSeconds: 150,
  /** the same song and part in full on one day: each play after the first earns less */
  repeatMult: [1, 0.6, 0.35, 0.2, 0.1],
  /** songs added to your library */
  addedSong: 10,
  addedPerDay: 5,
  /** song mastery reached (once per song and part) */
  mastery: { 4: 25, 5: 50, 6: 100 },
};

/**
 * Weekly rhythm (instead of a streak you can lose): the more days you've played in the last
 * seven, the more playing earns. Missing a day never takes anything away.
 */
const RHYTHM = [1, 1, 1.04, 1.08, 1.12, 1.15, 1.15, 1.15]; // index = days played in the last 7

// ---------------------------------------------------------------- passes --
/** The Backstage pass gets fancier as you go. */
const TIERS = [
  { id: 'roadie', name: 'Roadie', from: 1 },
  { id: 'garage', name: 'Garage band', from: 5 },
  { id: 'opener', name: 'Opening act', from: 12 },
  { id: 'headliner', name: 'Headliner', from: 20 },
  { id: 'rockstar', name: 'Rock star', from: 35 },
  { id: 'legend', name: 'Legend', from: 50 },
  { id: 'hof', name: 'Hall of Fame', from: 75 },
  { id: 'immortal', name: 'Immortal', from: 100 },
];
/** Levels that get the big celebration. */
const MILESTONES = [5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];

// ---------------------------------------------------------------- venues --
/**
 * Every venue and the level it opens at (ids as in renderer venues.js / visuals.js).
 * Inventory (4.5): 10 photo venues (cheap: one texture), Plain (free, no picture), Fluid
 * (WebGL ink, moderate GPU), and 5 GPU scenes (full-screen shaders, the most expensive and
 * the most spectacular, so they sit late). `milestone` venues get a bigger reveal.
 */
const VENUES = [
  { level: 1, venue: 'soundcheck', name: 'Soundcheck', kind: 'photo' },
  { level: 1, venue: 'warehouse', name: 'Warehouse', kind: 'photo' },
  { level: 1, venue: 'studio', name: 'Plain', kind: 'plain' },
  { level: 3, venue: 'cellar', name: 'Cellar', kind: 'photo' },
  { level: 5, venue: 'jazz', name: 'Jazz club', kind: 'photo' },
  { level: 10, venue: 'studio-room', name: 'Studio', kind: 'photo' },
  { level: 15, venue: 'rooftop', name: 'Rooftop', kind: 'photo' },
  { level: 20, venue: 'festival', name: 'Festival', kind: 'photo', milestone: true },
  { level: 25, venue: 'strings', name: 'Strings', kind: 'scene' },
  { level: 30, venue: 'opera', name: 'Opera house', kind: 'photo' },
  { level: 40, venue: 'swarm', name: 'Swarm', kind: 'scene' },
  { level: 50, venue: 'fluid', name: 'Fluid', kind: 'fluid', milestone: true },
  { level: 60, venue: 'canyon', name: 'Canyon', kind: 'photo' },
  { level: 70, venue: 'astral', name: 'Astral', kind: 'photo' },
  { level: 80, venue: 'nebula', name: 'Nebula', kind: 'scene', milestone: true },
  { level: 90, venue: 'mandala', name: 'Mandala', kind: 'scene' },
  { level: 100, venue: 'valhalla', name: 'Valhalla', kind: 'scene', milestone: true, legendary: true },
];
/** 4.4's rules, for keeping what a player had already earned when they move to 4.5. */
const OLD_UNLOCKS = [
  { level: 3, venue: 'festival' }, { level: 5, venue: 'swarm' }, { level: 7, venue: 'canyon' },
  { level: 10, venue: 'astral' }, { level: 13, venue: 'mandala' }, { level: 16, venue: 'nebula' },
];

// ---------------------------------------------------------- achievements --
const METALS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Legendary'];
const TROPHY_XP = [20, 50, 100, 200, 400, 750];
/**
 * Achievements: each tier gives its XP once. Diamond and Legendary are meant to take months
 * (some, a year or more). `kind` explore/backstage give half; `xp: false` gives none (a badge).
 * `group` is the category on the Achievements tab.
 */
const TROPHIES = [
  { id: 'full', group: 'Songs', name: 'Setlist survivor', what: 'Songs played all the way through', tiers: [10, 50, 200, 500, 1200, 2500] },
  { id: 'songs', group: 'Songs', name: 'Deep cuts', what: 'Different songs played', tiers: [10, 50, 150, 400, 800, 1500] },
  { id: 'mastered', group: 'Songs', name: 'Hall of mastery', what: 'Songs mastered (95%, twice at 90%+)', tiers: [1, 5, 20, 50, 120, 250] },
  { id: 'artists', group: 'Exploration', name: 'Crate digger', what: 'Different artists played', tiers: [5, 15, 40, 100, 200, 350] },
  { id: 'tunings', group: 'Exploration', name: 'Tuning fork', what: 'Different tunings played', tiers: [2, 4, 6, 9, 12, 15] },
  { id: 'bass', group: 'Exploration', name: 'Low end', what: 'Bass parts played all the way through', tiers: [1, 10, 50, 150, 300, 600] },
  { id: 'acc95', group: 'Accuracy', name: 'Sharpshooter', what: 'Whole songs at 95% or better', tiers: [1, 10, 50, 150, 350, 700] },
  { id: 'perfect', group: 'Accuracy', name: 'Flawless', what: 'Whole songs at 100%', tiers: [1, 5, 20, 50, 120, 250] },
  { id: 'streak', group: 'Accuracy', name: 'Combo king', what: 'Most notes hit in a row', tiers: [50, 100, 250, 500, 800, 1200] },
  { id: 'sections', group: 'Accuracy', name: 'Clean sweep', what: 'Sections played without a miss', tiers: [10, 50, 200, 600, 1500, 3500] },
  { id: 'notes', group: 'Volume', name: 'Note machine', what: 'Notes hit', tiers: [1000, 10000, 50000, 150000, 400000, 1000000] },
  { id: 'chords', group: 'Volume', name: 'Chord crusher', what: 'Chords hit', tiers: [250, 1500, 6000, 20000, 50000, 100000] },
  { id: 'hours', group: 'Practice', name: 'Road warrior', what: 'Hours played', tiers: [5, 25, 100, 300, 600, 1000] },
  { id: 'days', group: 'Practice', name: 'Never miss a gig', what: 'Days in a row playing', tiers: [3, 7, 30, 100, 200, 365] },
  { id: 'slowfast', group: 'Practice', name: 'Slow and steady', what: 'Songs slowed down to learn, then 85% at full speed', tiers: [1, 5, 15, 40, 80, 150] },
  { id: 'improve', group: 'Practice', name: 'On the rise', what: 'New personal bests', tiers: [5, 25, 100, 250, 500, 1000] },
  { id: 'bends', group: 'Technique', name: 'Bend wizard', what: 'Bends hit', tiers: [100, 500, 2000, 6000, 15000, 30000] },
  { id: 'slides', group: 'Technique', name: 'Slide rule', what: 'Slides hit', tiers: [100, 500, 2000, 6000, 15000, 30000] },
  { id: 'legato', group: 'Technique', name: 'Hammer time', what: 'Hammer-ons and pull-offs hit', tiers: [200, 1000, 4000, 12000, 30000, 60000] },
  { id: 'challenges', group: 'Challenges', name: 'Gig regular', what: 'Challenges completed', tiers: [5, 25, 100, 300, 600, 1000] },
  { id: 'venues', group: 'Challenges', name: 'World tour', what: 'Venues unlocked', tiers: [4, 7, 10, 13, 15, 17], xp: false },
  // trying things and Backstage: 4 tiers, half XP
  { id: 'explorer', group: 'Trying things', name: 'Gear nerd', what: 'Things tried from the list', tiers: [3, 6, 10, -1], kind: 'explore' },
  { id: 'crew', group: 'Trying things', name: 'Backstage crew', what: 'Backstage things done', tiers: [1, 2, 4, -1], kind: 'backstage' },
];

/** Titles you can wear on your Backstage pass. */
const TITLES = [
  { id: 'garage-legend', name: 'Garage Legend', level: 5 },
  { id: 'club-circuit', name: 'Club Circuit Veteran', level: 15 },
  { id: 'arena-rocker', name: 'Arena Rocker', level: 25 },
  { id: 'living-legend', name: 'Living Legend', level: 50 },
  { id: 'hall-of-famer', name: 'Hall of Famer', level: 75 },
  { id: 'immortal', name: 'Rock Immortal', level: 100 },
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
  { id: 'chord-lord', name: 'The Chord Lord', trophy: ['chords', 5] },
  { id: 'hammer', name: 'Hammer Time', trophy: ['legato', 1] },
  { id: 'patient', name: 'Patient Shredder', trophy: ['slowfast', 1] },
  { id: 'four-string', name: 'Four-String Hero', trophy: ['bass', 1] },
  { id: 'master', name: 'Song Master', trophy: ['mastered', 2] },
  { id: 'note-machine', name: 'Note Machine', trophy: ['notes', 3] },
  { id: 'on-the-rise', name: 'On the Rise', trophy: ['improve', 1] },
  { id: 'gear-nerd', name: 'Gear Nerd', trophy: ['explorer', 1] },
  { id: 'scene', name: 'Scene Regular', trophy: ['crew', 2] },
  { id: 'world-tour', name: 'World Tourer', trophy: ['venues', 3] },
];

// ---------------------------------------------------------- song mastery --
/**
 * Per song and part, from your full-speed, whole-song runs (at least XP.scoredNotes notes).
 * Transparent: the Songs and Progress pages show these thresholds.
 */
const MASTERY = [
  { id: 0, name: 'Not played' },
  { id: 1, name: 'First play', how: 'Play it for 30 seconds' },
  { id: 2, name: 'Completed', how: 'Play it start to finish' },
  { id: 3, name: 'Improving', how: '60% on a whole run at full speed' },
  { id: 4, name: 'Proficient', how: '80% on a whole run at full speed' },
  { id: 5, name: 'Expert', how: '90% on a whole run at full speed' },
  { id: 6, name: 'Mastered', how: '95% once and 90%+ on two whole runs at full speed' },
];

module.exports = { CURVE, LEVEL_XP, stepXp, XP, RHYTHM, TIERS, MILESTONES, VENUES, OLD_UNLOCKS, METALS, TROPHY_XP, TROPHIES, TITLES, MASTERY };
