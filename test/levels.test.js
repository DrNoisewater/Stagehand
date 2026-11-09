'use strict';
/**
 * Levels (4.4): points from playing and trying things, nothing counted twice, today's
 * challenges kept once done, and old playing counting from the start.
 *   node --test test/levels.test.js
 */
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Levels, compute, xpFor, levelOf, tierOf, challengesFor, dayKey, UNLOCKS } = require('../src/main/services/levels');

const NOW = new Date(2026, 10, 9, 20, 0).getTime();
const H = 3600 * 1000;
const song = (id, extra = {}) => ({ songId: id, part: 'lead', seconds: 240, accuracy: 0.7, notes: 300, hit: 210, speed: 1, at: NOW - 2 * H, ...extra });

test('levels and passes', () => {
  assert.deepStrictEqual([xpFor(1), xpFor(2), xpFor(3), xpFor(5), xpFor(10)], [0, 100, 300, 1000, 4500]);
  assert.deepStrictEqual([levelOf(0), levelOf(99), levelOf(100), levelOf(4500)], [1, 1, 2, 10]);
  assert.deepStrictEqual([tierOf(1).id, tierOf(5).id, tierOf(14).id, tierOf(20).id, tierOf(42).id], ['roadie', 'opener', 'headliner', 'legend', 'hof']);
});

test('nothing yet: level 1, three challenges, things to try', () => {
  const st = compute({ now: NOW });
  assert.strictEqual(st.xp, 0);
  assert.strictEqual(st.level, 1);
  assert.strictEqual(st.challenges.length, 3);
  assert.ok(st.firsts.length > 15 && st.firsts.every((f) => !f.done));
  assert.strictEqual(st.next.level, UNLOCKS[0].level);
});

test('doing well is worth the most', () => {
  const ok = compute({ now: NOW, sessions: [song('a', { full: true, accuracy: 0.7 })] }).xp;
  const great = compute({ now: NOW, sessions: [song('a', { full: true, accuracy: 0.96 })] }).xp;
  const perfect = compute({ now: NOW, sessions: [song('a', { full: true, accuracy: 1 })] }).xp;
  assert.ok(great > ok + 100 && perfect > great + 200, `${ok} < ${great} < ${perfect}`);
  // slowed down: played in full counts, the score bonus doesn't
  const slow = compute({ now: NOW, sessions: [song('a', { full: true, accuracy: 1, speed: 0.7 })] }).xp;
  assert.ok(slow < great);
});

test('new songs, new tunings, a personal best, parts', () => {
  const st = compute({ now: NOW, sessions: [
    song('a', { tuning: 'E Standard', at: NOW - 30 * H }),
    song('a', { tuning: 'E Standard', at: NOW - 29 * H, accuracy: 0.8 }),
    song('b', { tuning: 'Drop D', part: 'bass', at: NOW - 3 * H }),
  ] });
  const why = st.recent.map((a) => a.why);
  assert.strictEqual(why.filter((w) => w === 'A new song').length, 2);
  assert.ok(why.includes('A new tuning: Drop D') && !why.some((w) => /E Standard/.test(w)), 'your first tuning is just your tuning');
  assert.ok(why.includes('A new best: 80%'));
  assert.ok(why.includes('Play a bass part') && why.includes('Play a lead part'));
  assert.ok(why.includes('2 days in a row'));
});

test('minutes are capped per day; tried things count once', () => {
  const lots = Array.from({ length: 20 }, (_, i) => ({ songId: null, seconds: 3600, at: NOW - 10 * H + i * 1000 }));
  const st = compute({ now: NOW, sessions: lots });
  assert.ok(st.xp <= 180, String(st.xp));
  const a = compute({ now: NOW, did: { looper: NOW - H, 'backstage-join': NOW - H, nonsense: NOW } });
  assert.strictEqual(a.xp, 40 + 50);
  assert.ok(a.firsts.find((f) => f.id === 'looper').done);
});

test('new songs in your library: only after levels began, 5 a day', () => {
  const added = [NOW - 400 * H, ...Array.from({ length: 9 }, (_, i) => NOW - H + i)];
  const st = compute({ now: NOW, added, since: NOW - 100 * H });
  assert.strictEqual(st.xp, 50);
});

test('today’s challenges: picked by the date, one each kind, progress from today', () => {
  const d = dayKey(NOW);
  assert.deepStrictEqual(challengesFor(d).map((c) => c.id), challengesFor(d).map((c) => c.id));
  const days = Array.from({ length: 30 }, (_, i) => challengesFor(dayKey(NOW + i * 24 * H)).map((c) => c.id).join());
  assert.ok(new Set(days).size > 10, 'they change from day to day');
});

test('the service: tried things saved, finished challenges kept for good', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-lv-'));
  const sessions = [];
  const lv = await new Levels({ file: path.join(dir, 'levels.json'), sessions: () => sessions }).load();
  let st = await lv.did('looper', NOW);
  assert.ok(st.firsts.find((f) => f.id === 'looper').done);
  // finish whatever today's challenges are, the brute way: lots of everything
  for (let i = 0; i < 6; i++) sessions.push(song(`s${i}`, { full: true, accuracy: 0.97, part: i % 2 ? 'bass' : 'lead', tuning: i ? 'Drop D' : 'E Standard', at: NOW - 3 * H + i * 300000, seconds: 900 }));
  await lv.did('backstage-visit', NOW);
  await lv.did('slow', NOW);
  st = lv.state(NOW);
  const done = st.challenges.filter((c) => c.done);
  assert.ok(done.length >= 2, st.challenges.map((c) => `${c.id}:${c.value}/${c.target}`).join(' '));
  const before = st.xp;
  // the playing goes away (say stats.json was cleared): finished challenges stay earned
  sessions.length = 0;
  const again = await new Levels({ file: path.join(dir, 'levels.json'), sessions: () => sessions }).load();
  const kept = again.state(NOW);
  assert.ok(kept.recent.filter((a) => a.key.startsWith('c:')).length === done.length && kept.xp < before && kept.xp > 0);
  assert.ok(again.state(NOW).firsts.find((f) => f.id === 'looper').done, 'tried things are saved');
});
