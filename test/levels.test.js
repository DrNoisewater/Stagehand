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
const { Levels, compute, xpFor, levelOf, tierOf, challengesFor, weeklyFor, multFor, dayKey, weekKey, UNLOCKS, TROPHIES, TITLES, FIRSTS } = require('../src/main/services/levels');

const NOW = new Date(2026, 10, 9, 20, 0).getTime();
const H = 3600 * 1000;
const song = (id, extra = {}) => ({ songId: id, part: 'lead', seconds: 240, accuracy: 0.7, notes: 300, hit: 210, speed: 1, at: NOW - 2 * H, ...extra });

test('levels and passes', () => {
  assert.deepStrictEqual([xpFor(1), xpFor(2), xpFor(3), xpFor(5), xpFor(10)], [0, 100, 300, 1000, 4500]);
  assert.deepStrictEqual([levelOf(0), levelOf(99), levelOf(100), levelOf(4500)], [1, 1, 2, 10]);
  assert.deepStrictEqual([tierOf(1).id, tierOf(5).id, tierOf(14).id, tierOf(20).id, tierOf(42).id], ['roadie', 'opener', 'headliner', 'legend', 'hof']);
});

test('nothing yet: level 1, four challenges, three weekly, things to try', () => {
  const st = compute({ now: NOW });
  assert.strictEqual(st.xp, 0);
  assert.strictEqual(st.level, 1);
  assert.strictEqual(st.challenges.length, 4);
  assert.strictEqual(st.challenges.filter((c) => c.bonus).length, 1, 'one daily gig');
  assert.strictEqual(st.weekly.length, 3);
  assert.ok(st.trophies.every((t) => t.tier === -1) && st.titles.every((t) => !t.earned) && st.title === null);
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
  assert.strictEqual(why.filter((w) => w === 'A new song').length, 1);
  assert.strictEqual(why.filter((w) => w === 'A new song (x1.1)').length, 1, 'the second day in a row earns x1.1');
  assert.ok(why.includes('A new tuning: Drop D (x1.1)') && !why.some((w) => /E Standard/.test(w)), 'your first tuning is just your tuning');
  assert.ok(why.includes('A new best: 80%'));
  assert.ok(why.includes('Play a bass part') && why.includes('Play a lead part'));
});

test('minutes are capped per day; tried things count once', () => {
  const lots = Array.from({ length: 20 }, (_, i) => ({ songId: null, seconds: 3600, at: NOW - 10 * H + i * 1000 }));
  const st = compute({ now: NOW, sessions: lots });
  const mins = st.recent.filter((a) => a.key.endsWith(':min')).reduce((n, a) => n + a.xp, 0);
  assert.ok(mins <= 180, String(mins));
  assert.strictEqual(st.trophies.find((t) => t.id === 'hours').tier, 0, '20 hours: bronze');
  const a = compute({ now: NOW, did: { looper: NOW - H, 'backstage-join': NOW - H, nonsense: NOW } });
  assert.strictEqual(a.xp, 40 + 50 + 10, 'the looper, the pass, and a bronze Backstage crew trophy');
  assert.ok(a.firsts.find((f) => f.id === 'looper').done);
});

test('new songs in your library: only after levels began, 5 a day', () => {
  const added = [NOW - 400 * H, ...Array.from({ length: 9 }, (_, i) => NOW - H + i)];
  const st = compute({ now: NOW, added, since: NOW - 100 * H });
  assert.strictEqual(st.xp, 50);
});

test('today’s challenges: picked by the date, mostly playing', () => {
  const d = dayKey(NOW);
  assert.deepStrictEqual(challengesFor(d).map((c) => c.id), challengesFor(d).map((c) => c.id));
  const days = Array.from({ length: 30 }, (_, i) => challengesFor(dayKey(NOW + i * 24 * H)).map((c) => c.id).join());
  assert.ok(new Set(days).size > 20, 'they change from day to day');
  // two years of days and weeks: about 10% trying features, a bit more Backstage, the rest playing
  const n = { play: 0, explore: 0, backstage: 0 };
  const xp = { play: 0, explore: 0, backstage: 0 };
  const add = (c) => ((n[c.kind] += 1), (xp[c.kind] += c.xp));
  for (let i = 0; i < 728; i++) {
    const at = NOW + i * 24 * H;
    challengesFor(dayKey(at)).forEach(add);
    if (i % 7 === 0) weeklyFor(weekKey(at), { id: 'x', title: 'X' }).forEach(add);
  }
  const all = n.play + n.explore + n.backstage;
  const allXp = xp.play + xp.explore + xp.backstage;
  const share = (k) => n[k] / all;
  assert.ok(share('explore') > 0.08 && share('explore') < 0.12, `trying features: ${share('explore')}`);
  assert.ok(share('backstage') > 0.12 && share('backstage') < 0.17 && share('backstage') > share('explore'), `Backstage: ${share('backstage')}`);
  assert.ok(share('play') > 0.72, `playing: ${share('play')}`);
  assert.ok(xp.explore / allXp < 0.1 && xp.backstage / allXp < 0.15 && xp.play / allXp > 0.75, JSON.stringify(xp));
  // never two of the same on a day; a daily gig every day
  for (let i = 0; i < 60; i++) {
    const c = challengesFor(dayKey(NOW + i * 24 * H));
    assert.strictEqual(new Set(c.map((x) => x.id)).size, 4);
    assert.ok(c[3].bonus && c[3].kind === 'play');
    const w = weeklyFor(weekKey(NOW + i * 7 * 24 * H), null);
    assert.strictEqual(new Set(w.map((x) => x.id)).size, 3);
  }
});

test('daily progress: a 3-song set, an encore, streaks, clean sections, kinds of notes', () => {
  const at = NOW - 3 * H;
  const run = (id, i, acc, extra = {}) => song(id, { full: true, accuracy: acc, at: at + i * 250000, seconds: 240, bestStreak: 120, sections: [['Verse', 12, 12], ['Chorus', 9, 12]], kinds: { bend: [6, 8], slide: [2, 3], chord: [20, 25] }, ...extra });
  const ask = ['set3', 'encore', 'streak100', 'sections3', 'bends15', 'chords40', 'two90', 'artists3'];
  const songs = { a: { artist: 'AC/DC' }, b: { artist: 'Rush' }, c: { artist: 'Rush' } };
  const v = compute({ now: NOW, songs, ask, sessions: [run('a', 0, 0.82), run('b', 1, 0.86), run('a', 2, 0.91), run('c', 3, 0.5)] }).asked;
  assert.deepStrictEqual(v, { set3: 3, encore: 1, streak100: 100, sections3: 3, bends15: 15, chords40: 40, two90: 1, artists3: 2 });
  // a long break or a weak song in between starts the set again
  const gap = compute({ now: NOW, ask, sessions: [run('a', 0, 0.82), run('b', 1, 0.5), run('c', 2, 0.9), run('d', 3, 0.9, { at: at + 2 * H })] }).asked;
  assert.strictEqual(gap.set3, 1);
  assert.strictEqual(gap.encore, 0);
});

test('this week: the song of the week and weekly progress', () => {
  const songs = { a: { title: 'Paranoid', artist: 'Black Sabbath' }, b: { title: 'Money', artist: 'Pink Floyd' }, c: { title: 'Holy Wars', artist: 'Megadeth' } };
  const week = weekKey(NOW);
  const mon = new Date(week + 'T12:00:00').getTime();
  assert.ok(mon <= NOW && NOW - mon < 7 * 24 * H && new Date(mon).getDay() === 1, 'weeks start on Monday');
  const st0 = compute({ now: NOW, songs, weekSong: 'b' });
  const sw = st0.weekly.find((c) => c.id === 'w-song');
  assert.ok(sw && /Money/.test(sw.name) && sw.value === 0 && !sw.done);
  // 85% on it this week
  const st1 = compute({ now: NOW, songs, weekSong: 'b', sessions: [song('b', { full: true, accuracy: 0.88, at: mon + H })] });
  assert.ok(st1.weekly.find((c) => c.id === 'w-song').done);
  // last week doesn't count
  const st2 = compute({ now: NOW, songs, weekSong: 'b', sessions: [song('b', { full: true, accuracy: 0.88, at: mon - 30 * H })] });
  assert.ok(!st2.weekly.find((c) => c.id === 'w-song').done);
  // progress counts across the days of the week, shown as "3 / 5" and so on (on Thursday)
  const thu = mon + 3 * 24 * H + 8 * H;
  const many = [0, 1, 2].map((d) => song(`x${d}`, { full: true, accuracy: 0.92, at: mon + d * 24 * H }));
  const st3 = compute({ now: thu, sessions: many, ask: [] });
  assert.deepStrictEqual(st3.weekly.map((c) => c.id), weeklyFor(week, null).map((c) => c.id));
  assert.strictEqual(st3.weekLeft, 4);
  const W = Object.fromEntries(require('../src/main/services/levels').WEEKLY.play.map((c) => [c.id, c]));
  const st4 = compute({ now: thu, sessions: many, weekly: Object.keys(W) });
  assert.deepStrictEqual(st4.weeklyAsked, { 'w-acc90': 3, 'w-full15': 3, 'w-days5': 3, 'w-hours3': 12, 'w-new5': 3, 'w-pb3': 0, 'w-tunings3': 0, 'w-streak300': 0, 'w-sections25': 0 });
});

test('days in a row multiply what playing earns, up to x1.5', () => {
  assert.deepStrictEqual([1, 2, 3, 6, 20].map(multFor), [1, 1.1, 1.2, 1.5, 1.5]);
  const mine = (st) => st.recent.filter((a) => a.key.startsWith(`s:${NOW - 2 * H}:a`)).reduce((n, a) => n + a.xp, 0);
  const one = mine(compute({ now: NOW, sessions: [song('a', { full: true, accuracy: 0.9 })] }));
  const days = Array.from({ length: 8 }, (_, i) => song('z', { seconds: 60, at: NOW - (8 - i) * 24 * H, accuracy: null }));
  const st = compute({ now: NOW, sessions: [...days, song('a', { full: true, accuracy: 0.9 })] });
  const todayXp = mine(st);
  assert.ok(Math.abs(todayXp - one * 1.5) < 4, `${todayXp} vs ${one} x1.5`);
  assert.deepStrictEqual({ days: st.streak.days, mult: st.streak.mult, today: st.streak.today }, { days: 9, mult: 1.5, today: true });
  // played yesterday, not yet today: the streak is still alive
  const y = compute({ now: NOW, sessions: days });
  assert.ok(y.streak.days === 8 && !y.streak.today && y.streak.nextMult === 1.5);
});

test('trophies: tiers from your playing, each tier’s XP once', () => {
  const runs = Array.from({ length: 12 }, (_, i) => song(`t${i}`, { full: true, accuracy: i < 2 ? 1 : 0.96, at: NOW - (20 - i) * H, bestStreak: 40 + i * 10, kinds: { bend: [12, 14] } }));
  const st = compute({ now: NOW, sessions: runs });
  const t = (id) => st.trophies.find((x) => x.id === id);
  assert.strictEqual(t('full').tier, 0, 'bronze for 10 songs in full');
  assert.strictEqual(t('acc95').tier, 1, 'silver for 10 at 95%');
  assert.strictEqual(t('perfect').tier, 0);
  assert.strictEqual(t('streak').tier, 1, 'a 150-note streak is silver');
  assert.strictEqual(t('bends').tier, 0);
  assert.ok(t('full').next === 50 && t('full').value === 12);
  const tro = st.recent.filter((a) => a.key.startsWith('t:'));
  assert.strictEqual(new Set(tro.map((a) => a.key)).size, tro.length, 'each tier once');
  // playing more of the same doesn't give the same tier again
  const more = compute({ now: NOW, sessions: [...runs, ...runs.map((s) => ({ ...s, at: s.at + 60000 }))] });
  assert.strictEqual(more.recent.filter((a) => a.key === 't:full:0').length, 1);
  // kept trophies stay, even if the playing that earned them is gone
  const kept = compute({ now: NOW, trophies: st.reached });
  assert.strictEqual(kept.trophies.find((x) => x.id === 'acc95').tier, 1);
  assert.strictEqual(kept.xp, tro.reduce((n, a) => n + a.xp, 0));
  assert.ok(TROPHIES.length >= 15 && TROPHIES.every((x) => x.tiers.length === 4));
});

test('titles: earned from trophies and levels, worn only once earned', () => {
  const runs = Array.from({ length: 12 }, (_, i) => song(`t${i}`, { full: true, accuracy: 0.96, at: NOW - (20 - i) * H, bestStreak: 260 }));
  const st = compute({ now: NOW, sessions: runs, title: 'metronome' });
  assert.ok(st.titles.find((t) => t.id === 'metronome').earned, 'a 250-note streak (gold) makes you a Human Metronome');
  assert.deepStrictEqual(st.title && st.title.name, 'Human Metronome');
  const no = compute({ now: NOW, sessions: runs, title: 'shred-lord' });
  assert.strictEqual(no.title, null, 'not earned yet: the joke line stays');
  assert.ok(TITLES.every((t) => st.titles.find((x) => x.id === t.id).how.length > 5));
});

test('a busy player: playing is by far the biggest earner', () => {
  const sessions = [];
  const done = {};
  for (let d = 40; d >= 0; d--) {
    const at = NOW - d * 24 * H - 3 * H;
    for (let i = 0; i < 4; i++) sessions.push(song(`s${(d * 4 + i) % 30}`, { full: i < 3, accuracy: 0.86 + ((d + i) % 5) * 0.025, at: at + i * 400000, seconds: 300, bestStreak: 60 + d, sections: [['Verse', 20, 20]], kinds: { bend: [8, 10], chord: [30, 40] } }));
    for (const c of challengesFor(dayKey(at))) done[`${dayKey(at)}:${c.id}`] = { xp: c.xp, at, name: c.name, kind: c.kind };
    if (d % 7 === 0) for (const c of weeklyFor(weekKey(at), { id: 'x', title: 'X' })) done[`${weekKey(at)}:${c.id}`] = { xp: c.xp, at, name: c.name, kind: c.kind };
  }
  const did = Object.fromEntries(FIRSTS.filter((f) => !f.auto).map((f) => [f.id, NOW - 30 * 24 * H]));
  const st = compute({ now: NOW, sessions, done, did });
  const k = st.byKind;
  assert.ok(k.play / st.xp > 0.8 && k.explore / st.xp < 0.1 && k.backstage / st.xp < 0.1, JSON.stringify(k));
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
  const done = [...st.challenges, ...st.weekly].filter((c) => c.done);
  assert.ok(done.length >= 2, st.challenges.map((c) => `${c.id}:${c.value}/${c.target}`).join(' '));
  const before = st.xp;
  // the playing goes away (say stats.json was cleared): finished challenges stay earned
  sessions.length = 0;
  const again = await new Levels({ file: path.join(dir, 'levels.json'), sessions: () => sessions }).load();
  const kept = again.state(NOW);
  assert.ok(kept.recent.filter((a) => a.key.startsWith('c:')).length === done.length && kept.xp < before && kept.xp > 0);
  assert.ok(again.state(NOW).firsts.find((f) => f.id === 'looper').done, 'tried things are saved');
});

test('an old levels.json still works; trophies and titles are kept in it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-lv-'));
  const file = path.join(dir, 'levels.json');
  const yday = dayKey(NOW - 24 * H);
  // as 4.3.0 wrote it: three challenges a day, no trophies, no title
  fs.writeFileSync(file, JSON.stringify({ v: 1, since: NOW - 100 * H, did: { looper: NOW - 50 * H }, daily: { [yday]: ['backstage-visit'] }, done: { [`${yday}:backstage`]: { xp: 30, at: NOW - 24 * H, name: 'Drop by Backstage' }, [`${yday}:full5`]: { xp: 120, at: NOW - 24 * H, name: 'Play 5 songs in full today' } } }));
  const sessions = Array.from({ length: 12 }, (_, i) => song(`t${i}`, { full: true, accuracy: 0.96, at: NOW - (300 - i) * H, bestStreak: 260 }));
  const songs = { t1: { title: 'Paranoid', artist: 'Black Sabbath' } };
  const lv = await new Levels({ file, sessions: () => sessions, songs: () => songs }).load();
  let st = lv.state(NOW);
  assert.ok(st.recent.some((a) => a.key === `c:${yday}:full5` && a.xp === 120 && a.kind === 'play'), 'old challenges still count, as they were');
  assert.ok(st.recent.some((a) => a.key === `c:${yday}:backstage` && a.kind === 'backstage'));
  assert.ok(st.firsts.find((f) => f.id === 'looper').done);
  assert.strictEqual(st.weekSong, 't1', 'the song of the week comes from your library');
  await new Promise((r) => setTimeout(r, 100)); // (it saves in the background)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(saved.v === 2 && saved.done[`${yday}:full5`] && saved.did.looper && saved.trophies['acc95:1'] && saved.weekSong[weekKey(NOW)] === 't1');
  // titles: only earned ones can be worn; the choice is saved
  st = await lv.setTitle('shred-lord', NOW);
  assert.strictEqual(st.title, null, 'Shred Lord needs gold');
  st = await lv.setTitle('metronome', NOW);
  assert.strictEqual(st.title.name, 'Human Metronome');
  // the playing goes away: trophies, their XP and the title stay
  sessions.length = 0;
  const again = await new Levels({ file, sessions: () => sessions, songs: () => songs }).load();
  const kept = again.state(NOW);
  assert.ok(kept.trophies.find((t) => t.id === 'streak').tier === 2 && kept.title && kept.title.id === 'metronome');
  assert.strictEqual(kept.recent.filter((a) => a.key.startsWith('t:')).length, Object.keys(saved.trophies).length);
  st = await again.setTitle(null, NOW);
  assert.strictEqual(st.title, null, 'back to the joke line');
});

test('Backstage: showing a clip counts today, and as the first show', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-lv-'));
  const lv = await new Levels({ file: path.join(dir, 'levels.json'), sessions: () => [] }).load();
  const st = await lv.did('backstage-share', NOW);
  assert.ok(st.firsts.find((f) => f.id === 'backstage-show').done);
  assert.deepStrictEqual(lv.data.daily[dayKey(NOW)], ['backstage-share']);
});
