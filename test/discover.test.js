'use strict';
/* Discover (MusicBrainz, gaps, wanted) and the download importer: `node test/discover.test.js` */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const discog = require('../src/main/core/discog');
const rocksmith = require('../src/main/core/rocksmith');
const { MusicBrainz } = require('../src/main/services/musicbrainz');
const { Discover } = require('../src/main/services/discover');
const { OfficialList } = require('../src/main/services/officiallist');
const officialRequest = require('../src/main/services/officialrequest');
const { Importer, cleanName } = require('../src/main/services/importer');
const { Library } = require('../src/main/services/library');
const { Settings } = require('../src/main/services/settings');
const { zipList } = require('../src/main/core/files');
const { makeSong, makeZip } = require('./make_song');

const FIX = path.join(__dirname, 'fixtures');
const MB_FIX = path.join(FIX, 'musicbrainz');
const SRC = path.join(FIX, 'integration_p.psarc');
const LANTERN = '78c6115a-0c68-5ddd-ad9c-445c76f8f2db';
process.env.STAGEHAND_IMPORT_STABLE_MS = '150';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `stagehand-${p}-`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  throw new Error('timed out');
}

// ---------------------------------------------------------------- discog --
test('titles fold editions, punctuation and "The"', () => {
  const same = [
    ['Paper Moons', 'Paper Moons (Remastered 2020)'],
    ['Paper Moons', 'Paper Moons - Remastered 2011'],
    ['Kingfisher', 'Kingfisher - Live at the Roundhouse'],
    ['Dust & Diamonds', 'Dust and Diamonds'],
    ['Goodnight, Ohio', 'goodnight ohio'],
    ['The Wire', 'Wire'],
    ['Café Song', 'Cafe Song'],
    ['Low Sun', 'Low Sun (feat. Mara Quell)'],
  ];
  for (const [a, b] of same) assert.strictEqual(discog.normTitle(a), discog.normTitle(b), `${a} ~ ${b}`);
  assert.notStrictEqual(discog.normTitle('Signal Fires'), discog.normTitle('Signal Fires (Reprise)'));
  assert.notStrictEqual(discog.normTitle('One'), discog.normTitle('Two'));
  assert.strictEqual(discog.normArtist('The Lantern Hours'), discog.normArtist('lantern hours'));
});

test('studio albums and EPs only; the original edition of each', () => {
  const groups = JSON.parse(fs.readFileSync(path.join(MB_FIX, `release-groups_${LANTERN}.json`)));
  const albums = discog.albumsFrom(groups);
  assert.deepStrictEqual(albums.map((a) => a.title), ['First Light', 'Signal Fires', 'Night Ferry', 'Paper Moons']);
  const paper = albums.find((a) => a.title === 'Paper Moons');
  const tracks = discog.tracksFrom(JSON.parse(fs.readFileSync(path.join(MB_FIX, `releases_${paper.id}.json`))));
  assert.strictEqual(tracks.length, 12, 'the 2017 release, not the 2018 deluxe');
  assert.ok(!tracks.some((t) => /Demo|Bonus/.test(t.title)));
});

test('compare marks owned tracks, counts each title once, reports extras', () => {
  const albums = [
    { id: 'a', title: 'A', tracks: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }] },
    { id: 'b', title: 'B', tracks: [{ title: 'Two (Remastered)' }, { title: 'Four' }] },
  ];
  const songs = [
    { id: 's1', title: 'two' },
    { id: 's2', title: 'Four - Live' },
    { id: 's3', title: 'A Cover Song' },
  ];
  const r = discog.compare(albums, songs);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.have, 2);
  assert.strictEqual(r.missing, 2);
  assert.deepStrictEqual(r.albums[1].tracks.map((t) => t.title), ['Four'], 'Two is listed under its first album only');
  assert.deepStrictEqual(r.extras.map((s) => s.id), ['s3']);
});

test('song search rows prefer the studio release and drop repeats', () => {
  const json = JSON.parse(fs.readFileSync(path.join(MB_FIX, 'recording-search_recording-night-ferry-and-status-official.json')));
  json.recordings.push({ ...json.recordings[0], id: 'dupe' });
  const rows = discog.recordingsFrom(json);
  assert.deepStrictEqual(rows.map((r) => r.title), ['Night Ferry', 'Night Ferry Blues'], 'the live take folds into the song');
  assert.deepStrictEqual([rows[0].artist, rows[0].album, rows[0].year], ['The Lantern Hours', 'Night Ferry', 2014]);
});

// ------------------------------------------------------- MusicBrainz client --
test('one request per second, identified, cached, retried when busy', async () => {
  const calls = [];
  let busy = 1;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, at: Date.now(), ua: opts.headers['User-Agent'] });
    if (url.includes('busy') && busy-- > 0) return { ok: false, status: 503 };
    return { ok: true, status: 200, json: async () => ({ artists: [{ id: 'x', name: 'X', score: 100 }] }) };
  };
  const saved = process.env.STAGEHAND_MB_FIXTURES;
  delete process.env.STAGEHAND_MB_FIXTURES;
  const mb = new MusicBrainz({ cacheDir: tmp('mbcache'), fetchImpl, userAgent: 'Stagehand/test ( test )' });
  if (saved) process.env.STAGEHAND_MB_FIXTURES = saved;
  await Promise.all([mb.get('https://musicbrainz.org/ws/2/a'), mb.get('https://musicbrainz.org/ws/2/b')]);
  assert.ok(calls[1].at - calls[0].at >= 1050, 'second call waited');
  assert.ok(calls.every((c) => c.ua === 'Stagehand/test ( test )'));
  await mb.get('https://musicbrainz.org/ws/2/a');
  assert.strictEqual(calls.length, 2, 'served from the cache');
  const r = await mb.get('https://musicbrainz.org/ws/2/busy');
  assert.strictEqual(r.artists[0].name, 'X');
  assert.strictEqual(calls.filter((c) => c.url.endsWith('busy')).length, 2, 'retried after 503');
});

// ----------------------------------------------------------- Discover svc --
async function world(opts = {}) {
  process.env.STAGEHAND_MB_FIXTURES = MB_FIX;
  const root = tmp('disc');
  const lib = path.join(root, 'dlc');
  fs.mkdirSync(lib);
  const songs = [
    ['LanternStaticBloom', 'The Lantern Hours', 'Static Bloom', 'First Light'],
    ['LanternHarbour', 'The Lantern Hours', 'Harbour Lights', 'Signal Fires'],
    ['LanternPaper', 'The Lantern Hours', 'Paper Moons (Remastered 2020)', 'Paper Moons'],
    ['LanternWildHorses', 'The Lantern Hours', 'Wild Horses', 'Covers'],
    ['MaraIronwood', 'Mara Quell', 'Ironwood', 'Quiet Engines'],
    ['NorthPylon', 'Northbound Static', 'Pylon', 'Cold Frequencies'],
  ];
  for (const [songKey, artist, title, album] of songs) await makeSong(SRC, path.join(lib, `${songKey}_p.psarc`), { songKey, artist, title, album, year: 2010 });
  fs.copyFileSync(SRC, path.join(lib, 'integration_p.psarc'));
  const library = new Library(path.join(root, 'library.json'));
  library.data.folders.push({ path: lib, addedAt: Date.now() });
  await library.scan();
  const mb = new MusicBrainz({ cacheDir: path.join(root, 'mb'), fetchImpl: null, userAgent: 'test' });
  const discover = new Discover({ file: path.join(root, 'discover.json'), mb, library, ...opts });
  return { root, lib, library, mb, discover };
}

test('search: artists and songs marked owned or missing', async () => {
  const { discover } = await world();
  const r = await discover.search('night ferry');
  assert.strictEqual(r.songs.length, 2);
  assert.ok(r.songs.every((s) => !s.have));
  const r2 = await discover.search('The Lantern Hours - Kingfisher');
  assert.deepStrictEqual(r2.songs.map((s) => s.title), ['Kingfisher']);
  const r3 = await discover.search('lantern hours');
  assert.strictEqual(r3.artists[0].name, 'The Lantern Hours');
  assert.strictEqual(r3.artists[0].owned, 4);
  const r4 = await discover.search('harbour');
  assert.deepStrictEqual(r4.songs.map((s) => [s.title, s.have]), [['Harbour Lights', true], ['Quiet Harbour', false], ['Harbour Town', false]]);
  assert.ok(r4.songs[0].songId);
  assert.deepStrictEqual(discover.data.recent.slice(0, 4), ['harbour', 'lantern hours', 'The Lantern Hours - Kingfisher', 'night ferry']);
});

test('artist page: albums with what you have and what is missing', async () => {
  const { discover } = await world();
  const page = await discover.artist({ name: 'The Lantern Hours' });
  assert.strictEqual(page.artist.id, LANTERN);
  assert.deepStrictEqual(page.albums.map((a) => a.title), ['First Light', 'Signal Fires', 'Night Ferry', 'Paper Moons']);
  assert.strictEqual(page.total, 10 + 11 + 4 + 12);
  assert.strictEqual(page.have, 3, 'Paper Moons (Remastered 2020) counts');
  assert.deepStrictEqual(page.extras.map((s) => s.title), ['Wild Horses']);
  assert.ok(page.albums[0].tracks.find((t) => t.title === 'Static Bloom').have);
  const pick = await discover.artist({ name: 'Northbound Static' });
  assert.ok(pick.needsChoice);
  assert.strictEqual(pick.options.length, 2);
  const chosen = await discover.artist({ id: pick.options[0].id, name: 'Northbound Static' });
  assert.strictEqual(chosen.have, 1);
  // The choice sticks for next time.
  const again = await discover.artist({ name: 'Northbound Static' });
  assert.ok(!again.needsChoice);
});

test('collection gaps: checks every library artist in the background', async () => {
  const { discover } = await world();
  const events = [];
  discover.on('gaps', (g) => events.push(g));
  discover.checkGaps();
  await until(() => events.length && !events[events.length - 1].running, 20000);
  const g = discover.gaps().artists;
  const by = Object.fromEntries(g.map((a) => [a.name, a]));
  assert.strictEqual(by['The Lantern Hours'].status, 'ok');
  assert.strictEqual(by['The Lantern Hours'].missing, 37 - 3);
  assert.strictEqual(by['Mara Quell'].have, 1);
  assert.strictEqual(by['Mara Quell'].total, 16);
  assert.strictEqual(by['Northbound Static'].status, 'ambiguous');
  assert.strictEqual(by['Integration'].status, 'not-found');
  // A second run only re-checks what isn't settled.
  events.length = 0;
  const r = discover.checkGaps();
  assert.strictEqual(r.running.total, 2);
  await until(() => events.length && !events[events.length - 1].running, 20000);
});

test('wanted list: dedupes, notices songs already owned, ticks off imports', async () => {
  const { discover } = await world();
  const r = discover.addWanted([
    { artist: 'The Lantern Hours', title: 'Night Ferry', album: 'Night Ferry', year: 2014 },
    { artist: 'the lantern hours', title: 'Night Ferry' },
    { artist: 'The Lantern Hours', title: 'Static Bloom' },
    { artist: '', title: 'nope' },
  ]);
  assert.strictEqual(r.added, 2);
  const w = discover.wanted();
  assert.strictEqual(w.find((x) => x.title === 'Static Bloom').status, 'found');
  const hits = discover.markFound({ id: 'x', artist: 'The Lantern Hours', title: 'Night Ferry (Remastered)' });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(discover.wanted().find((x) => x.title === 'Night Ferry').status, 'found');
  discover.unmarkFound(hits.map((h) => h.id));
  assert.strictEqual(discover.wanted().find((x) => x.title === 'Night Ferry').status, 'wanted');
  assert.strictEqual(discover.clearFound().length, 1);
});

// ------------------------------------------------- 4.25: not available, official, updates --
const OFFICIAL = [['Deep Purple', 'Smoke on the Water'], ['The Lantern Hours', 'Harbour Lights'], ['Boston', 'More than a Feeling'], ['The Lantern Hours', 'Kingfisher']];

test('not available: own status with when and how many tries; back to Wanted keeps the count', async () => {
  let now = 1000;
  const { discover } = await world({ official: new OfficialList(OFFICIAL), now: () => now });
  discover.addWanted([{ artist: 'The Lantern Hours', title: 'Night Ferry' }, { artist: 'Mara Quell', title: 'Low Sun' }]);
  const nf = discover.wanted().find((w) => w.title === 'Night Ferry');
  let w = discover.setStatus([nf.id], 'unavailable');
  let x = w.find((i) => i.id === nf.id);
  assert.deepStrictEqual([x.status, x.tries, x.unavailableAt], ['unavailable', 1, 1000]);
  now = 5000;
  w = discover.setStatus([nf.id], 'wanted');
  assert.strictEqual(w.find((i) => i.id === nf.id).status, 'wanted');
  w = discover.setStatus([nf.id], 'unavailable');
  x = w.find((i) => i.id === nf.id);
  assert.deepStrictEqual([x.tries, x.unavailableAt], [2, 5000]);
  // a song that turns up after all is found, whatever list it was on
  assert.strictEqual(discover.markFound({ id: 's9', artist: 'The Lantern Hours', title: 'Night Ferry' }).length, 1);
  assert.throws(() => discover.setStatus([nf.id], 'gone'));
  // clearing found songs leaves the Not available ones
  const low = discover.wanted().find((i) => i.title === 'Low Sun');
  discover.setStatus([low.id], 'unavailable');
  assert.deepStrictEqual(discover.clearFound().map((i) => i.status), ['unavailable']);
});

test('official DLC: never wanted, moved on load, listed when not in the library', async () => {
  const { discover, root } = await world({ official: new OfficialList(OFFICIAL) });
  const r = discover.addWanted([{ artist: 'Deep Purple', title: 'Smoke On The Water' }, { artist: 'The Lantern Hours', title: 'Night Ferry' }]);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.official, 1);
  assert.ok(!discover.wanted().some((w) => w.artist === 'Deep Purple'));
  // an older Wanted list with an official song in it: moved to Official DLC when loaded
  discover.data.wanted.push({ id: 'old1', artist: 'Boston', title: 'More Than a Feeling', status: 'wanted', addedAt: 1 });
  await discover.save();
  const again = new Discover({ file: path.join(root, 'discover.json'), mb: discover.mb, library: discover.library, official: new OfficialList(OFFICIAL) });
  await again.load();
  assert.strictEqual(again.data.wanted.find((w) => w.id === 'old1').status, 'official');
  assert.strictEqual(again.setStatus(['old1'], 'wanted').find((w) => w.id === 'old1').status, 'official', 'an official song cannot go back to Wanted');
  const o = again.official();
  const names = o.songs.map((s) => s.title);
  assert.ok(!names.includes('Harbour Lights'), 'one you have is not listed');
  assert.deepStrictEqual(names.sort(), ['Kingfisher', 'More Than a Feeling', 'Smoke on the Water']);
  assert.strictEqual(o.songs.find((s) => s.title === 'More Than a Feeling').wantedId, 'old1', 'the one from your list once, not twice');
  // search marks official songs
  const s = await again.search('The Lantern Hours - Kingfisher');
  assert.ok(s.songs[0].official);
});

test('asking for official songs: the words, ntfy then FormSubmit, kept when offline, one per 12 hours', async () => {
  let now = Date.UTC(2026, 10, 18, 12);
  const posts = [];
  // how each service answers: a status, 'down' (no connection), or for FormSubmit a reply
  const ans = { ntfy: 200, form: { status: 200, body: '{"success":"true"}' } };
  const post = async (req) => {
    posts.push(req);
    const a = req.host === 'ntfy.sh' ? ans.ntfy : ans.form;
    if (a === 'down') throw new Error(`getaddrinfo ENOTFOUND ${req.host}`);
    return typeof a === 'number' ? { status: a, body: '' } : a;
  };
  const { discover } = await world({ official: new OfficialList(OFFICIAL), now: () => now, post });
  const songs = [{ artist: 'Deep Purple', title: 'Smoke on the Water' }, { artist: 'Boston', title: 'More than a Feeling' }, { artist: 'Boston', title: 'More than a Feeling' }];
  assert.strictEqual((await discover.requestOfficial({ songs, contact: '' })).ok, false, 'a way to reach you is needed');
  assert.strictEqual(posts.length, 0);
  // 1) ntfy takes it
  const r = await discover.requestOfficial({ songs, contact: 'me@example.com', note: 'Please!\nThanks' }, { name: 'Riffs', version: '4.25.0' });
  assert.deepStrictEqual([r.ok, r.via, r.count, posts.length], [true, 'ntfy', 2, 1]);
  const p = posts[0];
  assert.strictEqual(p.host, 'ntfy.sh');
  assert.match(p.path, /^\/[a-z0-9]{24}$/);
  assert.strictEqual(p.headers.Email, officialRequest.REQUEST_EMAIL);
  assert.match(officialRequest.REQUEST_EMAIL, /^[^@\s]+@[^@\s]+\.[a-z]+$/);
  assert.strictEqual(p.headers.Title, 'Stagehand song request');
  for (const bit of ['Reach them at: me@example.com', 'Backstage name: Riffs', 'Songs (2):', '- Deep Purple – Smoke on the Water', '- Boston – More than a Feeling', 'Note:', 'Please!', 'Stagehand 4.25.0']) assert.ok(p.body.includes(bit), bit);
  assert.ok(!/mail app|mailto/i.test(JSON.stringify(r)), 'never a mail app');
  assert.strictEqual(r.nextAt, now + 12 * 3600 * 1000);
  assert.strictEqual(discover.official().contact, 'me@example.com', 'the contact is remembered');
  // a second one too soon: refused here, nothing sent
  now += 11 * 3600 * 1000;
  const soon = await discover.requestOfficial({ songs, contact: 'me@example.com' });
  assert.deepStrictEqual([soon.ok, soon.via, posts.length], [false, 'wait', 1]);
  // 2) 12 hours on, ntfy refuses: FormSubmit takes it (JSON, the player's e-mail, success)
  now += 3600 * 1000 + 1;
  ans.ntfy = 429;
  const viaForm = await discover.requestOfficial({ songs, contact: 'me@example.com', note: 'hi' }, { name: 'Riffs' });
  assert.deepStrictEqual([viaForm.ok, viaForm.via, posts.length], [true, 'formsubmit', 3]);
  const f = posts[2];
  assert.strictEqual(f.host, 'formsubmit.co');
  assert.strictEqual(f.path, `/ajax/${officialRequest.REQUEST_EMAIL}`);
  assert.strictEqual(f.headers['Content-Type'], 'application/json');
  assert.strictEqual(f.headers.Accept, 'application/json');
  const j = JSON.parse(f.body);
  assert.deepStrictEqual([j.name, j.email, j._subject, j._template, j._captcha], ['Riffs', 'me@example.com', 'Stagehand song request', 'table', 'false']);
  assert.ok(j.message.includes('Smoke on the Water'));
  // a Discord name is not passed as an e-mail
  now += 12 * 3600 * 1000 + 1;
  await discover.requestOfficial({ songs, contact: 'riffs_42 on Discord' });
  assert.ok(!('email' in JSON.parse(posts[posts.length - 1].body)));
  // FormSubmit saying no (success false) counts as failing
  now += 12 * 3600 * 1000 + 1;
  ans.form = { status: 200, body: '{"success":"false","message":"needs activation"}' };
  const kept = await discover.requestOfficial({ songs, contact: 'me@example.com' });
  // 3) both fail: kept, sent later by itself; the 12 hours count from now
  assert.deepStrictEqual([kept.ok, kept.via, kept.nextAt], [true, 'queued', now + 12 * 3600 * 1000]);
  assert.strictEqual(discover.data.pendingRequests.length, 1);
  assert.strictEqual(discover.official().queued, 1);
  assert.strictEqual((await discover.requestOfficial({ songs, contact: 'me@example.com' })).via, 'wait', 'a kept request uses up the 12 hours');
  ans.ntfy = 'down';
  ans.form = 'down';
  assert.deepStrictEqual(await discover.retryRequests(), { sent: 0, left: 1 }, 'still offline: still kept');
  assert.strictEqual(discover.data.pendingRequests[0].tries, 2);
  ans.form = { status: 200, body: '{"success":true}' };
  const n = posts.length;
  assert.deepStrictEqual(await discover.retryRequests(), { sent: 1, left: 0 }, 'back online: it goes out');
  assert.strictEqual(posts[n].host, 'ntfy.sh', 'ntfy first, again');
  assert.strictEqual(posts[n + 1].host, 'formsubmit.co');
  assert.strictEqual(discover.official().queued, 0);
});

// ------------------------------------------------- 4.26: get gaps in one step, one official request --
test('collection gaps: the missing songs, searchable, without owned or official ones', async () => {
  const { discover } = await world({ official: new OfficialList(OFFICIAL) });
  const events = [];
  discover.on('gaps', (g) => events.push(g));
  const prog = [];
  discover.on('progress', (p) => prog.push(p));
  discover.checkGaps();
  await until(() => events.length && !events[events.length - 1].running, 20000);
  // the reading display hears the artist, the album and the songs of the album just read
  const lp = prog.filter((p) => p.kind === 'gaps' && p.artist === 'The Lantern Hours');
  assert.ok(lp.some((p) => p.title === 'Signal Fires' && p.albumId && p.last && p.last.title === 'First Light' && p.last.tracks.includes('Static Bloom')), 'album by album, with the last one read');
  const all = await discover.gapSongs();
  const lantern = all.find((g) => g.artist === 'The Lantern Hours');
  assert.ok(lantern, 'the gap artist is listed');
  const titles = lantern.songs.map((s) => s.title);
  assert.ok(!titles.includes('Static Bloom') && !titles.includes('Harbour Lights'), 'owned songs left out');
  assert.ok(!titles.includes('Kingfisher'), 'official songs left out');
  assert.ok(titles.includes('Night Ferry'));
  assert.strictEqual(lantern.songs.length, 37 - 3 - 1);
  const hit = await discover.gapSongs({ query: 'night ferry' });
  assert.ok(hit.length && hit.every((g) => g.songs.every((s) => /night|ferry/i.test(`${s.title} ${s.album}`))));
  // a gap checked before 4.26 (no saved list) is read again when asked for by name
  delete discover.data.gaps[lantern.key].miss;
  assert.ok(!(await discover.gapSongs()).some((g) => g.key === lantern.key), 'not read again for a search');
  const again = await discover.gapSongs({ keys: [lantern.key] });
  assert.strictEqual(again[0].songs.length, lantern.songs.length);
  // songs on Wanted are marked, found ones dropped
  discover.addWanted([{ artist: 'The Lantern Hours', title: 'Night Ferry' }]);
  assert.ok((await discover.gapSongs({ keys: [lantern.key] }))[0].songs.find((s) => s.title === 'Night Ferry').wanted);
});

test('asking for all the official songs: one short request, no list, the count', async () => {
  let now = Date.UTC(2026, 10, 22, 12);
  const posts = [];
  const post = async (req) => (posts.push(req), { status: 200, body: '' });
  const { discover } = await world({ official: new OfficialList(OFFICIAL), now: () => now, post });
  const r = await discover.requestOfficial({ all: true, contact: 'me@example.com' }, { name: 'Riffs', version: '4.26.0' });
  const missingOfficial = discover.official().songs.length;
  assert.deepStrictEqual([r.ok, r.via, r.count], [true, 'ntfy', missingOfficial]);
  const body = posts[0].body;
  assert.ok(body.includes(`all the official Rocksmith DLC they don't have (${missingOfficial} songs)`), body);
  assert.ok(!/Songs \(/.test(body) && !body.includes('Smoke on the Water'), 'no song list');
  assert.ok(body.includes('Reach them at: me@example.com'));
  assert.ok(body.split('\n').length < 12, 'short');
  assert.ok(!/mail app|mailto/i.test(body + JSON.stringify(r)));
  now += 3600 * 1000;
  assert.strictEqual((await discover.requestOfficial({ all: true, contact: 'me@example.com' })).via, 'wait', 'one every 12 hours');
});

test('updates: CustomsForge rows matched to library songs, newer versions only, cleared once got', async () => {
  const { discover, library } = await world();
  const harbour = Object.values(library.data.songs).find((s) => s.title === 'Harbour Lights');
  harbour.packageVersion = '2';
  const r = discover.setUpdates([
    { artist: 'The Lantern Hours', title: 'Harbour Lights', version: '3', updated: '2026-11-01' },
    { artist: 'Mara Quell', title: 'Ironwood', version: '6', updated: '2026-11-02' },
    { artist: 'Mara Quell', title: 'Ironwood (Remastered)', version: '5.4' },
    { artist: 'The Lantern Hours', title: 'Static Bloom', version: '1', updated: '2026-11-02' },
    { artist: 'Nobody', title: 'Not Mine', version: '9' },
  ]);
  const keys = r.updates.rows.map((u) => u.title).sort();
  assert.ok(keys.includes('Harbour Lights') && keys.includes('Ironwood'), keys.join(','));
  assert.ok(!keys.includes('Not Mine'), 'songs not in the library are left out');
  assert.strictEqual(r.updates.rows.filter((u) => u.artist === 'Mara Quell').length, 1, 'the same version as yours is not an update');
  const h = r.updates.rows.find((u) => u.title === 'Harbour Lights');
  assert.deepStrictEqual([h.songId, h.ours, h.version], [harbour.id, '2', '3']);
  // the same version again: no change; an older or same version than yours: not listed
  harbour.packageVersion = '3';
  assert.ok(!discover.updates().rows.some((u) => u.title === 'Harbour Lights'));
  harbour.packageVersion = '2';
  const after = discover.clearUpdates([h.key]);
  assert.ok(!after.rows.some((u) => u.title === 'Harbour Lights'));
  discover.setUpdates([{ artist: 'The Lantern Hours', title: 'Harbour Lights', version: '3' }]);
  assert.ok(!discover.updates().rows.some((u) => u.title === 'Harbour Lights'), 'a version you got is not offered again');
  discover.setUpdates([{ artist: 'The Lantern Hours', title: 'Harbour Lights', version: '4' }]);
  assert.ok(discover.updates().rows.some((u) => u.title === 'Harbour Lights'), 'a newer one is');
});

// ---------------------------------------------------------------- importer --
async function importWorld({ list = '1' } = {}) {
  const w = await world();
  const downloads = path.join(w.root, 'Downloads');
  fs.mkdirSync(downloads);
  const settings = new Settings(path.join(w.root, 'settings.json'));
  settings.set({ import: { list } });
  const applied = [];
  let running = false;
  const rsprofiles = {
    gameDir: async () => null,
    isGameRunning: async () => running,
    apply: async (ops) => {
      if (running) throw Object.assign(new Error('Close Rocksmith first.'), { code: 'RS_RUNNING' });
      applied.push(ops);
      return { added: ops.reduce((n, o) => n + (o.add || []).length, 0) };
    },
  };
  const importer = new Importer({
    file: path.join(w.root, 'imports.json'),
    settings,
    library: w.library,
    discover: w.discover,
    rsprofiles,
    stagingDir: path.join(w.root, 'staging'),
    replacedDir: path.join(w.root, 'Replaced'),
    defaultWatchDir: downloads,
  });
  return { ...w, downloads, settings, importer, applied, setRunning: (v) => (running = v) };
}

test('a downloaded song is checked, moved into the dlc folder and listed', async () => {
  const { downloads, lib, importer, library, discover, applied } = await importWorld();
  discover.addWanted([{ artist: 'The Lantern Hours', title: 'Night Ferry' }]);
  const file = await makeSong(SRC, path.join(downloads, 'Night_Ferry_p (1).psarc'), { songKey: 'LanternNightFerry', artist: 'The Lantern Hours', title: 'Night Ferry', album: 'Night Ferry' });
  const [e] = await importer.importFiles([file], { move: true, origin: 'download' });
  assert.strictEqual(e.status, 'imported', e.reason);
  assert.strictEqual(e.dest, path.join(lib, 'Night_Ferry_p.psarc'), 'browser (1) suffix removed');
  assert.ok(!fs.existsSync(file), 'moved out of Downloads');
  assert.ok(fs.readdirSync(lib).every((f) => !f.includes('stagehand-tmp')));
  assert.ok(Object.values(library.data.songs).some((s) => s.songKey === 'LanternNightFerry'));
  assert.strictEqual(discover.wanted()[0].status, 'found');
  assert.strictEqual(e.found.length, 1);
  await until(() => applied.length);
  assert.deepStrictEqual(applied[0], [{ list: 1, add: ['LanternNightFerry'] }]);
  assert.strictEqual(importer.data.history[0].list.state, 'added');
});

test('duplicates, newer versions, name clashes', async () => {
  const { downloads, lib, importer, library } = await importWorld({ list: null });
  // Identical file: recognised, download cleared.
  const dupe = path.join(downloads, 'copy_p.psarc');
  fs.copyFileSync(path.join(lib, 'MaraIronwood_p.psarc'), dupe);
  let [e] = await importer.importFiles([dupe], { move: true });
  assert.strictEqual(e.status, 'duplicate');
  assert.ok(!fs.existsSync(dupe));
  // Newer version of a song: replaces the old file, keeps favourites and setlists.
  const old = Object.values(library.data.songs).find((s) => s.songKey === 'MaraIronwood');
  library.setUser(old.id, { fav: true, rating: 4 });
  const sl = library.createSetlist('Gig');
  library.addToSetlist(sl.id, [old.id]);
  const v2 = await makeSong(SRC, path.join(downloads, 'Ironwood_v2_p.psarc'), { songKey: 'MaraIronwood', artist: 'Mara Quell', title: 'Ironwood', album: 'Quiet Engines', year: 2015 });
  [e] = await importer.importFiles([v2], { move: true });
  assert.strictEqual(e.status, 'updated', e.reason);
  assert.ok(!fs.existsSync(path.join(lib, 'MaraIronwood_p.psarc')), 'old version moved aside');
  assert.ok(fs.existsSync(e.replaced.backup));
  const now = Object.values(library.data.songs).filter((s) => s.songKey === 'MaraIronwood');
  assert.strictEqual(now.length, 1);
  assert.deepStrictEqual([now[0].user.fav, now[0].user.rating], [true, 4]);
  assert.deepStrictEqual(library.data.setlists[0].songIds, [now[0].id]);
  // Same file name, different song: kept side by side.
  const clash = await makeSong(SRC, path.join(downloads, 'MaraIronwood_p.psarc'), { songKey: 'SomethingElse', artist: 'Mara Quell', title: 'Telegraph' });
  [e] = await importer.importFiles([clash], { move: false });
  assert.strictEqual(e.status, 'imported');
  assert.ok(fs.existsSync(clash), 'copied, original left alone');
  assert.ok(fs.existsSync(path.join(lib, 'MaraIronwood_p.psarc')) || e.dest.endsWith(' (2)_p.psarc'));
  // Undo the update: old version back, favourites follow.
  const upd = importer.data.history.find((x) => x.status === 'updated');
  await importer.undo(upd.id);
  assert.ok(fs.existsSync(upd.replaced.path));
  const back = Object.values(library.data.songs).filter((s) => s.songKey === 'MaraIronwood');
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].user.fav, true);
});

test('ZIPs, Mac versions and files that are not songs', async () => {
  const { downloads, lib, importer } = await importWorld({ list: null });
  const pc = await makeSong(SRC, path.join(downloads, 'x_p.psarc'), { songKey: 'ZipSong', artist: 'Mara Quell', title: 'Kerosene' });
  const zip = makeZip(path.join(downloads, 'Kerosene.zip'), [
    ['Kerosene/Kerosene_p.psarc', fs.readFileSync(pc)],
    ['Kerosene/Kerosene_m.psarc', fs.readFileSync(pc)],
    ['readme.txt', Buffer.from('hi')],
  ]);
  fs.unlinkSync(pc);
  assert.strictEqual((await zipList(zip)).length, 3);
  const r = await importer.importFiles([zip], { move: true });
  assert.deepStrictEqual(r.map((x) => x.status), ['imported'], 'Mac copy skipped quietly');
  assert.ok(fs.existsSync(path.join(lib, 'Kerosene_p.psarc')));
  assert.ok(!fs.existsSync(zip), 'ZIP cleared away');

  fs.copyFileSync(path.join(FIX, 'partial_p.psarc'), path.join(downloads, 'broken_p.psarc'));
  let [e] = await importer.importFiles([path.join(downloads, 'broken_p.psarc')], { move: true });
  assert.strictEqual(e.status, 'rejected');
  assert.ok(fs.existsSync(path.join(downloads, 'broken_p.psarc')), 'rejected files stay where they were');

  fs.writeFileSync(path.join(downloads, 'notes.zip'), 'not a zip');
  [e] = await importer.importFiles([path.join(downloads, 'notes.zip')]);
  assert.strictEqual(e.status, 'rejected');

  const real = rocksmith.readSongs;
  rocksmith.readSongs = async (p) => (await real(p)).map((s) => ({ ...s, platform: 'mac' }));
  try {
    const mac = await makeSong(SRC, path.join(downloads, 'MacOnly_m.psarc'), { songKey: 'MacOnly' });
    [e] = await importer.importFiles([mac], { move: true });
    assert.strictEqual(e.status, 'rejected');
    assert.match(e.reason, /Mac version/);
  } finally {
    rocksmith.readSongs = real;
  }
  assert.strictEqual(cleanName('Song_p (3).psarc'), 'Song_p.psarc');
});

test('watching Downloads: imports finished downloads, waits for the game to close', async () => {
  const { downloads, lib, importer, applied, setRunning } = await importWorld({ list: 'favorites' });
  // Already there before watching started: offered, not taken.
  const before = await makeSong(SRC, path.join(downloads, 'Older_p.psarc'), { songKey: 'Older', artist: 'Mara Quell', title: 'Telegraph' });
  fs.utimesSync(before, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  await importer.configure({ watch: true });
  importer.data.seen = {};
  const settledSince = importer.cfg().since;
  assert.ok(settledSince > 0);
  setRunning(true);
  // The watcher only looks for .psarc files: ZIPs, even ones with songs inside, are never touched.
  makeZip(path.join(downloads, 'holiday-photos.zip'), [['IMG_0001.jpg', Buffer.alloc(2000, 7)]]);
  makeZip(path.join(downloads, 'SongPack.zip'), [['Pack_p.psarc', fs.readFileSync(before)]]);
  await wait(1500);
  assert.ok(fs.existsSync(path.join(downloads, 'holiday-photos.zip')) && fs.existsSync(path.join(downloads, 'SongPack.zip')), 'left where they were');
  assert.strictEqual(importer.data.history.length, 0, 'no history rows, no notices');
  assert.ok(!(await importer.waiting()).some((w) => /\.zip$/.test(w.name)), 'not offered either');
  // A browser writes "<name>.crdownload" and renames it when finished.
  const staging = await makeSong(SRC, path.join(os.tmpdir(), `dl-${Date.now()}.psarc`), { songKey: 'Fresh', artist: 'Mara Quell', title: 'Riverbend' });
  const part = path.join(downloads, 'Riverbend_p.psarc.crdownload');
  fs.copyFileSync(staging, part);
  await wait(400);
  assert.ok(fs.existsSync(part), 'partial download left alone');
  fs.renameSync(part, path.join(downloads, 'Riverbend_p.psarc'));
  await until(() => fs.existsSync(path.join(lib, 'Riverbend_p.psarc')), 10000);
  await until(() => importer.data.history[0] && importer.data.history[0].list && importer.data.history[0].list.state === 'waiting', 5000);
  assert.strictEqual(applied.length, 0, 'not written while Rocksmith is running');
  setRunning(false);
  const r = await importer.flushLists();
  assert.ok(r.done);
  assert.deepStrictEqual(applied[0], [{ list: 'favorites', add: ['Fresh'] }]);
  const waiting = await importer.waiting();
  assert.deepStrictEqual(waiting.map((x) => x.name), ['Older_p.psarc']);
  assert.ok(fs.existsSync(path.join(downloads, 'holiday-photos.zip')), 'other ZIPs still untouched');
  const got = await importer.importWaiting();
  assert.strictEqual(got[0].status, 'imported');
  assert.deepStrictEqual(await importer.waiting(), []);
  // Undo puts the file back in Downloads.
  await importer.undo(got[0].id);
  assert.ok(fs.existsSync(path.join(downloads, 'Older_p.psarc')));
  importer.stop();
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ok  ${t.name}`);
    } catch (err) {
      console.log(`  FAIL ${t.name}\n       ${String(err.stack).split('\n').slice(0, 6).join('\n       ')}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit();
})();
