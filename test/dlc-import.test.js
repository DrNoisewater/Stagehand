'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { makePsarc, makeBank } = require('./helpers/psarc-make');
const { DlcImporter } = require('../src/main/services/dlc-importer');
const { Library } = require('../src/main/services/library');
const { TabService } = require('../src/main/services/tabs');
const { StemService } = require('../src/main/services/stems');
const { AudioService } = require('../src/main/services/audio');
const { parseXml } = require('../src/main/core/xmlarr');
const sng = require('../src/main/core/sng');
const xml = `<song><songLength>20</songLength><phrases><phrase maxDifficulty="1"/><phrase maxDifficulty="2"/></phrases>
<phraseIterations><phraseIteration time="0" phraseId="0"/><phraseIteration time="10" phraseId="1"/></phraseIterations>
<levels><level difficulty="1"><notes><note time="1" string="0" fret="3" sustain="2" slideTo="5" vibrato="1"/></notes><handShapes><handShape chordId="0" startTime="1" endTime="3"/></handShapes></level>
<level difficulty="2"><notes><note time="11" string="1" fret="7" sustain="1"/></notes><handShapes><handShape chordId="1" startTime="11" endTime="14"/></handShapes></level></levels></song>`;
function chart(key, artist, names = ['Lead']) {
  const files = {};
  names.forEach((name, i) => {
    const base = `${key.toLowerCase()}_${name.toLowerCase()}${i}`;
    files[`manifests/songs/${base}.json`] = Buffer.from(JSON.stringify({ Entries: { [`${key}-${i}`]: { Attributes: {
      SongKey: key, SongName: key, ArtistName: artist, ArrangementName: name, SongBank: `song_${key.toLowerCase()}.bnk`, SongEvent: `Play_${key}`,
    } } } }));
    files[`songs/arr/${base}.xml`] = Buffer.from(xml);
  });
  return files;
}
function media(key, id) {
  return { [`audio/windows/song_${key.toLowerCase()}.bnk`]: makeBank({ event: `Play_${key}`, media: id }),
    [`audio/windows/${id}.wem`]: Buffer.alloc(500000, id % 255),
    [`audio/windows/song_${key.toLowerCase()}_preview.bnk`]: makeBank({ event: `Play_${key}_Preview`, media: id + 1 }),
    [`audio/windows/${id + 1}.wem`]: Buffer.alloc(900000, 99) };
}
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-dlc-'));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dlc'), { recursive: true });
  fs.mkdirSync(path.join(game, 'originals'));
  const charts = path.join(game, 'dlc', 'rs1compatibilitydlc_p.psarc');
  makePsarc(charts, { ...chart('Kryptonite', '3 Doors Down'), ...chart('KillerQueen', 'Queen', ['Combo', 'Combo']), ...chart('Missing', 'Unknown') });
  fs.copyFileSync(charts, path.join(game, 'originals', 'rs1compatibilitydlc_p.psarc'));
  makePsarc(path.join(game, 'songs.psarc'), { ...media('Kryptonite', 1001), ...media('KillerQueen', 1011), ...chart('BaseSong', 'Base'), ...media('BaseSong', 1021) });
  makePsarc(path.join(game, 'dlc', 'rs1compatibilitydisc_p.psarc'), { ...chart('DiscSong', 'Disc'), ...media('DiscSong', 1031) });
  makePsarc(path.join(game, 'dlc', 'ordinary_p.psarc'), { ...chart('Ordinary', 'DLC'), ...media('Ordinary', 1041) });
  fs.writeFileSync(path.join(game, 'dlc', 'The-Rolling-Stones_Start-Me-Up_v1_p.psarc'), '');
  const library = await new Library(path.join(dir, 'library.json')).load();
  const tabs = new TabService();
  const audio = new AudioService({ cacheDir: path.join(dir, 'audio'), library, tools: { vgmstreamPath: () => null }, settings: { get: () => ({ cache: { audioLimitGB: 4 } }) } });
  // Exercise real source extraction, content hashing, cache and prepare; only native codec is stubbed.
  const decoded = [];
  audio._decode = async (buf, key) => { decoded.push({ key, buf }); fs.mkdirSync(audio.dir, { recursive: true }); fs.writeFileSync(audio.wavPath(key), buf); };
  audio._info = async (key) => ({ key, url: `stagehand://audio/${key}.wav` });
  audio.evictSoon = () => {};
  const importer = new DlcImporter({ library, tabs, audio, cacheFile: path.join(dir, 'index.json') });
  t.after(() => { clearTimeout(library._saveTimer); library.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, game, charts, library, tabs, audio, importer, decoded };
}

test('discovery, cross/same archive selection, Combo identity, duplicates and persistent normal library', async (t) => {
  const x = await fixture(t);
  const rows = await x.importer.scan(x.game);
  assert.equal(rows.length, 7); // six songs + zero-byte archive, no originals duplicates
  assert.match(rows.find((r) => r.title.includes('Start-Me-Up')).status, /zero bytes/);
  assert.equal(rows.find((r) => r.title === 'Missing').selectable, false);
  assert.match(rows.find((r) => r.title === 'Missing').status, /sound bank/);
  const queen = x.importer.rows.find((r) => r.title === 'KillerQueen');
  assert.equal(queen.song.arrangements.length, 2);
  assert.equal(queen.source.entry, 'audio/windows/1011.wem');
  assert.equal(x.importer.rows.find((r) => r.title === 'Kryptonite').source.path, path.join(x.game, 'songs.psarc'));
  assert.equal(x.importer.rows.find((r) => r.title === 'DiscSong').source.path, path.join(x.game, 'dlc', 'rs1compatibilitydisc_p.psarc'));
  const hashes = new Map(fs.readdirSync(path.join(x.game, 'dlc')).map((n) => [n, crypto.createHash('sha1').update(fs.readFileSync(path.join(x.game, 'dlc', n))).digest('hex')]));
  await x.importer.importSelected(rows.filter((r) => r.selectable).map((r) => r.id));
  assert.equal(Object.keys(x.library.data.songs).length, 5);
  assert.equal(x.decoded.length, 5);
  const song = Object.values(x.library.data.songs).find((s) => s.songKey === 'Kryptonite');
  assert.equal(song.audioEntry, null);
  const info = await x.audio.prepare(song);
  assert.equal(info.key, song.audioKey);
  assert.equal(x.decoded.length, 5, 'normal playback reuses imported audio cache');
  const stems = new StemService({ stemsDir: path.join(x.dir, 'stems'), audio: x.audio, library: x.library,
    settings: { get: () => ({ stems: { model: 'htdemucs_6s' } }) }, tools: {} });
  stems._pump = () => {}; // inspect the normal queue without launching Demucs
  assert.equal(stems.request([song.id])[0].songId, song.id);
  stems.states.clear(); stems.queue = [];
  stems.index = new Map([[song.audioKey, 'cached-song']]);
  stems.cache.set(`${song.audioKey}/htdemucs_6s`, { model: 'htdemucs_6s', stems: [] });
  assert.equal(stems.status(song).state, 'ready', 'normal stem cache uses the same full-song audio hash');
  assert.equal(stems.request([song.id]).length, 0, 'existing stems prevent another split');

  const tab = await x.tabs.load(song, song.arrangements[0].id);
  assert.deepEqual(tab.notes.map((n) => n.f), [3, 7]);
  assert.equal(tab.notes[0].slideTo, 5);
  assert.equal(tab.notes[0].sus, 2);
  assert.equal(tab.handShapes.length, 2);
  await x.library.scan({ full: true });
  assert.equal(Object.keys(x.library.data.songs).length, 5, 'rescan outside watched folders retains selected imports');
  await x.importer.scan(x.game);
  assert.equal(x.importer.rows.filter((r) => r.selectable).length, 0);
  await x.importer.importSelected(rows.map((r) => r.id));
  assert.equal(Object.keys(x.library.data.songs).length, 5);
  const loaded = await new Library(x.library.file).load();
  assert.equal(loaded.snapshot().songs.length, 5);
  for (const [n, hash] of hashes) assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(x.game, 'dlc', n))).digest('hex'), hash);
});

test('repairs failed entry in place, preserving ID, favorites, history, setlists and unrelated metadata', async (t) => {
  const x = await fixture(t);
  await x.importer.scan(x.game);
  const row = x.importer.rows.find((r) => r.title === 'Kryptonite');
  const old = { ...row.song, id: 'old-id', dlcImport: undefined, audioFail: { message: 'no audio' }, user: { favorite: true, plays: 37, score: 88 }, addedAt: 12, customField: 'keep' };
  x.library.data.songs[old.id] = old;
  x.library.data.setlists.push({ songIds: [old.id] });
  await x.importer.scan(x.game);
  assert.match(x.importer.rows.find((r) => r.id === row.id).status, /repair/);
  await x.importer.importSelected([row.id]);
  const repaired = x.library.get('old-id');
  assert.equal(Object.keys(x.library.data.songs).length, 1);
  assert.deepEqual(repaired.user, old.user);
  assert.equal(repaired.addedAt, 12);
  assert.equal(repaired.customField, 'keep');
  assert.equal(repaired.audioFail, undefined);
  assert.deepEqual(x.library.data.setlists[0].songIds, ['old-id']);
  await x.library.addFolder(path.join(x.game, 'dlc'));
  assert.equal(Object.values(x.library.data.songs).filter((s) => s.songKey === 'Kryptonite').length, 1);
  assert.equal(x.library.get('old-id').audioFrom.entry, 'audio/windows/1001.wem');
});

test('decoder failure is per-song, leaves old data intact and can retry', async (t) => {
  const x = await fixture(t);
  await x.importer.scan(x.game);
  const rows = x.importer.rows.filter((r) => r.selectable).slice(0, 2);
  const original = x.audio._decode;
  let count = 0;
  x.audio._decode = async (...args) => { if (!count++) throw new Error('Decoder unavailable'); return original(...args); };
  await x.importer.importSelected(rows.map((r) => r.id));
  assert.equal(rows[0].status, 'Decoder unavailable');
  assert.equal(rows[1].status, 'Imported');
  x.audio._decode = original;
  await x.importer.importSelected([rows[0].id]);
  assert.equal(rows[0].status, 'Imported');
});

test('scan cancellation and import cancellation never commit unfinished song', async (t) => {
  const x = await fixture(t);
  x.importer.onProgress = () => x.importer.cancel();
  await x.importer.scan(x.game);
  assert.equal(x.importer.busy, false);
  assert.equal(Object.keys(x.library.data.songs).length, 0);
  x.importer.onProgress = () => {};
  await x.importer.scan(x.game);
  const row = x.importer.rows.find((r) => r.selectable);
  let resolve;
  const original = x.audio.prepare.bind(x.audio);
  x.audio.prepare = () => new Promise((r) => { resolve = r; setImmediate(() => x.importer.cancel()); });
  await x.importer.importSelected([row.id]);
  assert.equal(Object.keys(x.library.data.songs).length, 0);
  assert.match(row.status, /Cancelled/);
  resolve({ key: 'late' });
  await new Promise(setImmediate);
  assert.equal(Object.keys(x.library.data.songs).length, 0);
  x.audio.prepare = original;
  await x.importer.importSelected([row.id]);
  assert.equal(row.status, 'Imported');
});

test('source removed after discovery is a per-song error; rescan repairs missing dependency', async (t) => {
  const x = await fixture(t);
  await x.importer.scan(x.game);
  const ordinary = x.importer.rows.find((r) => r.title === 'Ordinary');
  fs.unlinkSync(ordinary.song.path);
  await x.importer.importSelected([ordinary.id]);
  assert.match(ordinary.status, /ENOENT/);
  assert.equal(x.library.get(ordinary.id), null);
  makePsarc(path.join(x.game, 'dlc', 'missing-audio_p.psarc'), media('Missing', 1051));
  await x.importer.scan(x.game);
  const missing = x.importer.rows.find((r) => r.title === 'Missing');
  assert.equal(missing.selectable, true);
  await x.importer.importSelected([missing.id]);
  assert.equal(missing.status, 'Imported');
});

test('compiled SNG full difficulty selects each phrase, including shapes, while default is unchanged', () => {
  const note = (iteration, time, fret) => ({ phraseIteration: iteration, time, string: 0, fret, sustain: 1, mask: 0, slideTo: -1, slideUnpitchTo: -1 });
  const data = { phrases: [{ maxDifficulty: 1 }, { maxDifficulty: 2 }], phraseIterations: [{ phraseId: 0, start: 0, end: 10 }, { phraseId: 1, start: 10, end: 20 }],
    levels: [{ difficulty: 1, notes: [note(0, 1, 3)], anchors: [], handShapes: [{ chordId: 0, start: 1, end: 3 }], arpeggios: [] },
      { difficulty: 2, notes: [note(1, 11, 7)], anchors: [], handShapes: [{ chordId: 1, start: 11, end: 14 }], arpeggios: [] }],
    chords: [], chordNotes: [], beats: [], sections: [], events: [], tones: [], meta: { maxDifficulty: 2, songLength: 20, tuning: [] } };
  const tab = sng.toTab(data, { fullDifficulty: true });
  assert.deepEqual(tab.notes.map((n) => n.f), [3, 7]);
  assert.equal(tab.handShapes.length, 2);
  assert.equal(sng.toTab(data).handShapes.length, 1, 'default behavior unchanged');
  data.phrases[0].maxDifficulty = 9;
  assert.throws(() => sng.toTab(data, { fullDifficulty: true }), /Missing authored/);
  assert.throws(() => parseXml(xml.replace('maxDifficulty="1"', 'maxDifficulty="9"'), { fullDifficulty: true }), /Missing authored/);
});

test('changed archive requires rescan, and named-bank gaps resolve by same-archive event', async (t) => {
  const x = await fixture(t);
  const files = { ...chart('RenamedBank', 'DLC'), ...media('RenamedBank', 1061) };
  files['audio/windows/renamed.bnk'] = files['audio/windows/song_renamedbank.bnk'];
  delete files['audio/windows/song_renamedbank.bnk'];
  makePsarc(path.join(x.game, 'dlc', 'renamed_p.psarc'), files);
  await x.importer.scan(x.game);
  const renamed = x.importer.rows.find((r) => r.title === 'RenamedBank');
  assert.equal(renamed.selectable, true);
  assert.equal(renamed.source.entry, 'audio/windows/1061.wem');
  const row = x.importer.rows.find((r) => r.title === 'Kryptonite');
  const now = new Date(Date.now() + 2000);
  fs.utimesSync(x.charts, now, now);
  await x.importer.importSelected([row.id, renamed.id]);
  assert.match(row.status, /Source archive changed/);
  assert.equal(renamed.status, 'Imported');
  await x.importer.scan(x.game);
  await x.importer.importSelected([row.id]);
  assert.ok(x.library.get(row.id));
});

test('distinct arrangements across duplicate packs load from their own source; real decoder absence is reported', async (t) => {
  const x = await fixture(t);
  const extra = chart('KillerQueen', 'Queen', ['Rhythm']);
  for (const key of Object.keys(extra).filter((k) => k.endsWith('.json'))) {
    const doc = JSON.parse(extra[key]);
    doc.Entries['Queen-extra'] = doc.Entries['KillerQueen-0']; delete doc.Entries['KillerQueen-0'];
    extra[key] = Buffer.from(JSON.stringify(doc));
  }
  makePsarc(path.join(x.game, 'dlc', 'zz-extra_p.psarc'), extra);
  await x.importer.scan(x.game);
  const queen = x.importer.rows.find((r) => r.title === 'KillerQueen');
  assert.equal(queen.song.arrangements.length, 3);
  assert.ok(queen.song.arrangements.find((a) => a.type === 'rhythm').sourcePath);
  const original = x.audio._decode;
  x.audio._decode = AudioService.prototype._decode;
  await x.importer.importSelected([queen.id]);
  assert.equal(queen.status, 'Audio decoder not installed');
  assert.equal(x.library.get(queen.id), null);
  x.audio._decode = original;
  await x.importer.importSelected([queen.id]);
  assert.equal(queen.status, 'Imported');
  const song = x.library.get(queen.id);
  assert.equal((await x.tabs.load(song, 'Queen-extra')).notes.length, 2);
});
