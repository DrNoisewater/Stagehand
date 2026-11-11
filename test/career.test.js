'use strict';
/**
 * 4.5 career: the Road to 100, venue unlocks, anti-farming, song mastery, lifetime statistics
 * kept apart from progression, backups and recovery, developer controls.
 *   node --test test/career.test.js
 */
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Levels, compute, xpFor, masteryOf, VENUES } = require('../src/main/services/levels');
const { lifetime } = require('../src/main/services/lifetime');
const { Stats, foldIntoArchive } = require('../src/main/services/stats');
const { CareerBackups } = require('../src/main/services/profile-backup');
const CFG = require('../src/main/services/progression-config');

const NOW = new Date(2026, 10, 9, 20, 0).getTime();
const H = 3600 * 1000;
const D = 24 * H;
const song = (id, extra = {}) => ({ songId: id, part: 'lead', seconds: 240, accuracy: 0.85, notes: 400, hit: 340, speed: 1, at: NOW - 2 * H, full: true, ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sh-career-'));
const xpOf = (sessions, extra = {}) => compute({ now: NOW, sessions, ...extra }).xp;

test('levels run from 1 to 100; venues spread over the whole journey', () => {
  assert.strictEqual(CFG.CURVE.MAX, 100);
  assert.strictEqual(compute({ now: NOW, dev: { xp: 1e9 } }).level, 100);
  const levels = VENUES.map((v) => v.level);
  assert.ok(levels.filter((l) => l <= 25).length <= 9, 'not every venue by level 25');
  for (const m of [50, 80, 100]) assert.ok(VENUES.some((v) => v.level === m && v.milestone), `a milestone venue at ${m}`);
  assert.ok(VENUES.find((v) => v.level === 100).legendary);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] >= levels[i - 1], 'in order');
  const st = compute({ now: NOW, dev: { xp: xpFor(20) } });
  assert.strictEqual(st.level, 20);
  assert.deepStrictEqual(st.unlocked, VENUES.filter((v) => v.level <= 20).map((v) => v.venue));
  assert.strictEqual(st.next.venue, 'strings');
});

test('anti-farming: replays, short arrangements and idling earn less', () => {
  const one = xpOf([song('a')]);
  const five = xpOf([0, 1, 2, 3, 4].map((i) => song('a', { at: NOW - 3 * H + i * 300000 })));
  assert.ok(five < one * 3, `five replays (${five}) earn far less than five songs (${one * 5})`);
  const fiveDiff = xpOf([0, 1, 2, 3, 4].map((i) => song(`s${i}`, { at: NOW - 3 * H + i * 300000 })));
  assert.ok(fiveDiff > five * 1.5, 'different songs are worth more than the same one again');
  const tiny = xpOf([song('a', { notes: 30, hit: 30, accuracy: 1, seconds: 35 })]);
  const real = xpOf([song('a', { accuracy: 1 })]);
  assert.ok(tiny < real / 3, `a 30-note “song” (${tiny}) vs a real one (${real})`);
  const idle = xpOf([song('a', { full: false, seconds: 3600, notes: 500, hit: 3, accuracy: 0.006 })]);
  const busy = xpOf([song('a', { full: false, seconds: 3600, notes: 500, hit: 400, accuracy: 0.8 })]);
  assert.ok(idle < busy / 3, `idling an hour (${idle}) vs playing (${busy})`);
  const restarts = xpOf(Array.from({ length: 40 }, (_, i) => song('a', { full: false, seconds: 10, notes: 5, hit: 4, at: NOW - 3 * H + i * 15000 })));
  assert.ok(restarts < 15, `restarting a song over and over earns next to nothing (${restarts})`);
});

test('song mastery: transparent tiers, XP once per tier', () => {
  const m = (runs) => Object.values(masteryOf(runs))[0];
  assert.strictEqual(m([song('a', { full: false, seconds: 40 })]).name, 'First play');
  assert.strictEqual(m([song('a', { accuracy: 0.4 })]).name, 'Completed');
  assert.strictEqual(m([song('a', { accuracy: 0.65 })]).name, 'Improving');
  assert.strictEqual(m([song('a', { accuracy: 0.83 })]).name, 'Proficient');
  assert.strictEqual(m([song('a', { accuracy: 0.96 })]).name, 'Expert', 'one great run is Expert');
  assert.strictEqual(m([song('a', { accuracy: 0.96 }), song('a', { accuracy: 0.91, at: NOW - H })]).name, 'Mastered');
  assert.strictEqual(m([song('a', { accuracy: 0.99, speed: 0.8 })]).name, 'Completed', 'slowed down does not count toward mastery');
  const st = compute({ now: NOW, sessions: [song('a', { accuracy: 0.96, at: NOW - 3 * H }), song('a', { accuracy: 0.97, at: NOW - 2 * H }), song('a', { accuracy: 0.98, at: NOW - H })] });
  const mk = st.recent.filter((a) => a.key.startsWith('m:'));
  assert.deepStrictEqual(mk.map((a) => a.key.split(':').pop()).sort(), ['4', '5', '6']);
  assert.ok(st.timeline.some((e) => e.type === 'mastery' && e.tier === 6));
});

test('lifetime statistics: everything, including archived sessions; never changed by a progression reset', async () => {
  const sessions = [song('a', { kinds: { chord: [40, 50] }, bestStreak: 80 }), song('b', { at: NOW - D, kinds: { chord: [10, 20] }, accuracy: 0.97 })];
  const archive = foldIntoArchive(null, [song('old', { at: NOW - 400 * D, kinds: { chord: [5000, 6000] } })]);
  const l = lifetime({ sessions, archive, now: NOW });
  assert.strictEqual(l.chordsPlayed, 6070);
  assert.strictEqual(l.chordsHit, 5050);
  assert.strictEqual(l.sessions, 3);
  assert.strictEqual(l.uniqueSongs, 3);
  assert.strictEqual(l.firstAt, NOW - 400 * D);
  assert.strictEqual(l.bestAccuracy, 0.97);
  // progression reset: level 1 again, the same lifetime numbers
  const dir = tmp();
  const lv = await new Levels({ file: path.join(dir, 'levels.json'), sessions: () => sessions }).load();
  const before = lv.state(NOW);
  assert.ok(before.xp > 0);
  const after = await lv.resetProgression(NOW + 1000);
  assert.strictEqual(after.xp, 0);
  assert.strictEqual(after.level, 1);
  assert.deepStrictEqual(lifetime({ sessions, archive, now: NOW }), l, 'lifetime untouched');
  // play after the reset: it counts again
  sessions.push(song('c', { at: NOW + 2000 }));
  lv._cache = null;
  assert.ok(lv.state(NOW + 3000).xp > 0);
});

test('stats: long histories are archived, never deleted; a double log is not counted twice', async () => {
  const st = new Stats(path.join(tmp(), 'stats.json'));
  const e = st.log(song('a', { at: NOW }));
  st.log({ ...e });
  assert.strictEqual(st.data.sessions.length, 1);
  const { KEEP_SESSIONS } = require('../src/main/services/stats');
  st.data.sessions = Array.from({ length: KEEP_SESSIONS }, (_, i) => ({ ...e, at: NOW - (KEEP_SESSIONS - i) * 1000, kinds: { chord: [1, 2] } }));
  st.log(song('b', { at: NOW + 5000 }));
  assert.strictEqual(st.data.sessions.length, KEEP_SESSIONS);
  assert.strictEqual(st.data.archive.count, 1);
  const l = lifetime({ sessions: st.data.sessions, archive: st.data.archive });
  assert.strictEqual(l.sessions, KEEP_SESSIONS + 1, 'every session still counts');
  clearTimeout(st._timer);
});

test('backups: made, listed, restored; a damaged file is recovered, never overwritten', async () => {
  const dir = tmp();
  let clock = NOW;
  const b = new CareerBackups({ dataDir: dir, dir: path.join(dir, 'bk'), now: () => clock });
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify({ sessions: [song('a')] }));
  fs.writeFileSync(path.join(dir, 'levels.json'), JSON.stringify({ v: 3 }));
  const first = await b.backup('manual');
  assert.strictEqual(first.files['stats.json'].sessions, 1);
  assert.strictEqual(await b.auto().then((x) => x && x.reason), 'auto');
  clock += H;
  assert.strictEqual(await b.auto(), null, 'one auto backup a day');
  // damage stats.json: it's moved aside and the backup copy is used
  fs.writeFileSync(path.join(dir, 'stats.json'), '{"sessions": [ oops');
  const st = new Stats(path.join(dir, 'stats.json'), { backups: b });
  await st.load();
  assert.strictEqual(st.data.sessions.length, 1);
  assert.ok(st.recovered && fs.existsSync(st.recovered.corrupt) && fs.readFileSync(st.recovered.corrupt, 'utf8').includes('oops'));
  // restore puts files back and makes an undo backup first
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify({ sessions: [] }));
  clock += H;
  const r = await b.restore(first.id, ['stats.json']);
  assert.deepStrictEqual(r.restored, ['stats.json']);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8')).sessions.length, 1);
  assert.ok((await b.list()).some((x) => x.id === r.undo));
  // integrity
  const ok = await b.integrity({ sessions: [song('a'), song('a')] });
  assert.ok(!ok.ok && ok.checks.some((c) => !c.ok && /twice/.test(c.what)));
  // pruning keeps the newest
  for (let i = 0; i < 30; i++) (clock += 21 * H), await b.backup('auto');
  const autos = (await b.list()).filter((x) => x.reason === 'auto');
  assert.ok(autos.length <= 15 + 12 && autos.length >= 15);
});

test('moving from 4.4 keeps every venue the player could already use', async () => {
  const dir = tmp();
  const file = path.join(dir, 'levels.json');
  // an old 4.4 player at a low level: festival (old level 3) was theirs, canyon (7) wasn't
  const sessions = Array.from({ length: 6 }, (_, i) => song(`s${i}`, { at: NOW - (10 - i) * D, accuracy: 0.9 }));
  fs.writeFileSync(file, JSON.stringify({ v: 2, since: NOW - 30 * D, did: {}, daily: {}, done: {}, trophies: {} }));
  const b = new CareerBackups({ dataDir: dir, dir: path.join(dir, 'bk') });
  const lv = await new Levels({ file, sessions: () => sessions, backups: b }).load();
  const old = require('../src/main/services/levels-legacy').compute({ sessions, since: NOW - 30 * D }).level;
  assert.strictEqual(lv.data.legacyLevel, old);
  const st = lv.state(NOW);
  const has = (v) => st.venues.find((x) => x.venue === v).unlocked;
  for (const v of ['cellar', 'jazz', 'opera', 'rooftop', 'studio-room', 'fluid', 'strings']) assert.ok(has(v), `${v} was free in 4.4, still open`);
  assert.strictEqual(has('valhalla'), st.level >= 100, 'the new legendary venue is earned, not kept');
  if (old < 16) assert.ok(!has('nebula'), 'nebula was locked at that level and stays locked');
  assert.ok((await b.list()).some((x) => x.reason === 'before-road-to-100'), 'a backup before the move');
  // resetting progression is the only thing that drops kept venues
  const r = await lv.resetProgression(NOW + 1);
  assert.ok(!r.venues.find((x) => x.venue === 'opera').unlocked);
});

test('developer controls: set a level, add XP, venues, challenges', async () => {
  const dir = tmp();
  const sessions = [song('a')];
  const lv = await new Levels({ file: path.join(dir, 'levels.json'), sessions: () => sessions }).load();
  let st = await lv.setLevel(42);
  assert.strictEqual(st.level, 42);
  st = await lv.addXp(xpFor(43) - st.xp);
  assert.strictEqual(st.level, 43);
  st = await lv.setVenue('valhalla', true);
  assert.ok(st.venues.find((v) => v.venue === 'valhalla').unlocked);
  st = await lv.setVenue('cellar', false);
  assert.ok(!st.venues.find((v) => v.venue === 'cellar').unlocked, 'locked even though the level allows it');
  st = await lv.unlockAll(true);
  assert.ok(st.venues.every((v) => v.unlocked));
  st = await lv.unlockAll(false);
  const key = st.challenges[0].key;
  st = await lv.completeChallenge(key);
  assert.ok(st.challenges[0].done);
  st = await lv.resetChallenges();
  assert.ok(!st.challenges[0].done || st.challenges[0].value >= st.challenges[0].target);
  assert.ok(lv.data.log.some((e) => /set level 42/.test(e.text)), 'every developer change is logged');
});
