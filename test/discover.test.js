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
async function world() {
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
  const discover = new Discover({ file: path.join(root, 'discover.json'), mb, library });
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
