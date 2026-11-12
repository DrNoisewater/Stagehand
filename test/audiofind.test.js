'use strict';
/**
 * A song whose own file has no audio finds it in another archive the way the game does:
 * manifest (bank name, event) → that bank, wherever it is → event → sound → media id → the .wem.
 * 4.0.3: the bank is in the song's file, the audio elsewhere. 4.11: neither is (Rocksmith 1 DLC:
 * rs1compatibilitydlc_p.psarc is charts only; banks and audio are in songs.psarc and friends).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AudioFinder, idsInBank } = require('../src/main/services/audiofind');
const { fnv1, parseBank, bankSongMedia, bankEvents } = require('../src/main/core/wwise');
const { Psarc } = require('../src/main/core/psarc');
const { readSongs } = require('../src/main/core/rocksmith');
const { makePsarc, makeBank } = require('./helpers/psarc-make');

const ok = (m) => console.log(`  ok  ${m}`);
const wem = (seed, kb) => Buffer.alloc(kb * 1024, seed);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-afind-'));
  const game = path.join(dir, 'Rocksmith2014');
  fs.mkdirSync(path.join(game, 'dlc'), { recursive: true });
  fs.writeFileSync(path.join(game, 'Rocksmith2014.exe'), 'x');
  const cacheFile = path.join(dir, 'index.json');
  const logs = [];
  const mk = (o = {}) => new AudioFinder({ cacheFile, gameDir: async () => game, folders: () => [], log: (m) => logs.push(m), ...o });

  // ---- real banks (the fixtures were made by the toolkit and DLC Builder)
  {
    const p = await Psarc.open(path.join(__dirname, 'fixtures', 'integration_p.psarc'));
    const full = await p.read('audio/windows/song_integrationtest.bnk');
    const prev = await p.read('audio/windows/song_integrationtest_preview.bnk');
    await p.close();
    assert.strictEqual(fnv1('Play_IntegrationTest'), 2229648692);
    assert.deepStrictEqual(bankEvents(parseBank(full)), [2229648692]);
    const m = bankSongMedia(full, { event: fnv1('Play_IntegrationTest') });
    assert.deepStrictEqual([m.ids, m.via], [[1572044179], 'event']);
    const pm = bankSongMedia(prev, { event: fnv1('Play_IntegrationTest_Preview') });
    assert.deepStrictEqual([pm.ids, pm.via], [[1349014072], 'event']);
    // the song's event is not in the preview bank
    assert.strictEqual(bankSongMedia(prev, { event: fnv1('Play_IntegrationTest') }).hasEvent, false);
    ok('a real bank: event → action → sound → media id (the song’s, and the preview’s own)');
    const fx = await Psarc.open(path.join(__dirname, 'fixtures', 'integration_p.psarc'));
    const songs = await readSongs(fx);
    await fx.close();
    assert.ok(/song_integrationtest\.bnk$/i.test(songs[0].bankName) && songs[0].songEvent === 'Play_IntegrationTest', `${songs[0].bankName} ${songs[0].songEvent}`);
    ok('a song remembers its manifest’s bank and event names');
  }

  // ---- 4.0.3: the bank is in the song's own file, the audio in another
  const other = path.join(game, 'dlc', 'withaudio_p.psarc');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'integration_p.psarc'), other);
  {
    const p = await Psarc.open(other);
    const bank = await p.read('audio/windows/song_integrationtest.bnk');
    await p.close();
    const song = { path: path.join(dir, 'noaudio_p.psarc'), songKey: 'IntegrationTest', bankEntry: 'audio/windows/song_integrationtest.bnk' };
    const r = await mk().resolve(song, bank);
    assert.deepStrictEqual([r.path, r.entry], [other, 'audio/windows/1572044179.wem']);
    ok('own bank, audio in Rocksmith’s dlc folder: the full song, not the preview that sits beside it');
    assert.deepStrictEqual(idsInBank(Buffer.concat([Buffer.from('xx'), Buffer.from([0x93, 0x7d, 0xb3, 0x5d])]), [1, 1572044179]), [1572044179]);
  }

  // ---- 4.11: Rocksmith 1 DLC: charts in one archive, banks and audio in others
  const K = { id: 700000001, prev: 700000002 }; // Kryptonite
  const Q = { id: 700000011, prev: 700000012 }; // Killer Queen
  const D = { id: 700000021 }; // a disc song
  const charts = path.join(game, 'dlc', 'rs1compatibilitydlc_p.psarc');
  makePsarc(charts, { 'manifests/songs_rs1dlc/kryptonite_lead.json': Buffer.from('{}'), 'songs/bin/generic/kryptonite_lead.sng': Buffer.alloc(64, 1), 'gfxassets/album_art/album_kryptonite_256.dds': Buffer.alloc(64, 2) });
  makePsarc(path.join(game, 'songs.psarc'), {
    'audio/windows/song_kryptonite.bnk': makeBank({ event: 'Play_Kryptonite', media: K.id }),
    'audio/windows/song_kryptonite_preview.bnk': makeBank({ event: 'Play_Kryptonite_Preview', media: K.prev }),
    [`audio/windows/${K.id}.wem`]: wem(11, 900),
    [`audio/windows/${K.prev}.wem`]: wem(12, 1200), // a preview bigger than the song: size must not decide
    'audio/windows/song_killerqueen.bnk': makeBank({ event: 'Play_KillerQueen', media: Q.id }),
    'audio/windows/song_killerqueen_preview.bnk': makeBank({ event: 'Play_KillerQueen_Preview', media: Q.prev }),
    [`audio/windows/${Q.id}.wem`]: wem(21, 500),
    [`audio/windows/${Q.prev}.wem`]: wem(22, 450),
    'audio/windows/song_other.bnk': makeBank({ event: 'Play_Other', media: 700000031 }),
    'audio/windows/700000031.wem': wem(31, 2000), // the biggest, and first by name: never picked
  });
  makePsarc(path.join(game, 'dlc', 'rs1compatibilitydisc_p.psarc'), {
    'audio/windows/song_discsong.bnk': makeBank({ event: 'Play_DiscSong', media: D.id }),
    [`audio/windows/${D.id}.wem`]: wem(41, 600),
    'manifests/songs_rs1disc/discsong_lead.json': Buffer.from('{}'),
  });
  const krypt = { path: charts, songKey: 'Kryptonite', title: 'Kryptonite', bankName: 'song_kryptonite.bnk', songEvent: 'Play_Kryptonite', bankEntry: null };
  const queen = { path: charts, songKey: 'KillerQueen', title: 'Killer Queen', bankName: 'song_killerqueen.bnk', songEvent: 'Play_KillerQueen', bankEntry: null };
  {
    const f = mk();
    const r = await f.resolve(krypt, null);
    assert.deepStrictEqual([r.path, r.entry, r.mediaId], [path.join(game, 'songs.psarc'), `audio/windows/${K.id}.wem`, K.id]);
    assert.strictEqual(r.bank.entry, 'audio/windows/song_kryptonite.bnk');
    ok('Kryptonite: chart in rs1compatibilitydlc, bank and audio in songs.psarc (not the bigger preview, not the biggest file)');
    const q = await f.resolve(queen, null);
    assert.deepStrictEqual([q.path, q.mediaId], [path.join(game, 'songs.psarc'), Q.id]);
    ok('Killer Queen: its own audio from the same shared archive');
    assert.ok(logs.some((l) => /Kryptonite.*chart .*rs1compatibilitydlc_p\.psarc.*bank .*songs\.psarc.*audio .*songs\.psarc/.test(l)), 'the log names the song and each archive');
    ok('the log names the song, the chart’s archive, the bank’s and the audio’s');
  }
  {
    // the player's path: prepare() reads the audio from the other archive, remembers where it was
    // (every part of the song shares it), and a song that failed before gets another look
    const { AudioService } = require('../src/main/services/audio');
    const rec = { ...krypt, id: 'k1', audioEntry: null, audioFail: { code: 'OLD', message: 'no audio' } };
    const sent = [];
    const library = {
      setAudioFrom: (id, from) => ((rec.audioFrom = from || undefined), from && (rec.audioFail = undefined), rec),
      setAudioFail: (id, f) => ((rec.audioFail = f || undefined), rec),
      setAudioKey: (id, k) => (rec.audioKey = k),
    };
    const svc = new AudioService({ cacheDir: path.join(dir, 'wav'), tools: { vgmstreamPath: () => null }, library, settings: { get: () => ({ cache: {} }) }, finder: mk(), onSong: (s) => sent.push(s), log: () => {} });
    // no decoder in the test: getting as far as "decoder needed" means the right bytes were read
    await assert.rejects(svc.prepare(rec), (e) => e.code === 'NEED_VGMSTREAM');
    assert.deepStrictEqual(rec.audioFrom, { path: path.join(game, 'songs.psarc'), entry: `audio/windows/${K.id}.wem` });
    assert.strictEqual(rec.audioFail, undefined);
    assert.strictEqual(rec.audioKey, require('crypto').createHash('sha1').update(wem(11, 900)).digest('hex').slice(0, 24));
    assert.strictEqual(sent.length, 1);
    ok('opening the song reads Kryptonite’s own audio from songs.psarc; the old “no audio” mark is gone');
    const lost = { path: charts, id: 'x1', songKey: 'Nowhere', bankName: 'song_nowhere.bnk', audioEntry: null };
    const lib2 = { setAudioFrom: () => lost, setAudioFail: (id, f) => ((lost.audioFail = f), lost), setAudioKey() {} };
    const svc2 = new AudioService({ cacheDir: path.join(dir, 'wav'), tools: { vgmstreamPath: () => null }, library: lib2, settings: { get: () => ({ cache: {} }) }, finder: mk(), log: () => {} });
    await assert.rejects(svc2.prepare(lost), (e) => e.code === 'AUDIO_NO_BANK');
    assert.strictEqual(lost.audioFail.code, 'AUDIO_NO_BANK');
    ok('a song whose audio really isn’t anywhere is marked with why');
  }
  {
    // a disc song opened from the DLC pack's charts: the disc pack has the bank and the audio
    const r = await mk().resolve({ path: charts, songKey: 'DiscSong', bankName: 'song_discsong.bnk', songEvent: 'Play_DiscSong' }, null);
    assert.deepStrictEqual([path.basename(r.path), r.mediaId], ['rs1compatibilitydisc_p.psarc', D.id]);
    ok('a song whose audio is in rs1compatibilitydisc_p.psarc');
  }
  {
    // no SongBank in the manifest, and the bank's file name is no help: found by the event it holds
    const odd = path.join(game, 'dlc', 'shared_pack_p.psarc');
    makePsarc(odd, {
      'audio/windows/bank_0001.bnk': makeBank({ event: 'Play_OddOne', media: 700000051 }),
      'audio/windows/bank_0002.bnk': makeBank({ event: 'Play_OddTwo', media: 700000052 }),
      'audio/windows/700000051.wem': wem(51, 500),
      'audio/windows/700000052.wem': wem(52, 800),
    });
    const f = mk();
    const r = await f.resolve({ path: charts, songKey: 'OddOne', bankName: null, songEvent: 'Play_OddOne' }, null);
    assert.deepStrictEqual([path.basename(r.path), r.mediaId, /event/.test(r.via)], ['shared_pack_p.psarc', 700000051, true]);
    const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assert.ok(saved.files[odd].events['audio/windows/bank_0001.bnk'].includes(fnv1('Play_OddOne')));
    ok('no bank name to go by: the bank that holds the song’s event (and that is remembered)');
  }
  {
    // audio kept whole inside the bank
    const inb = path.join(game, 'dlc', 'inbank_p.psarc');
    makePsarc(inb, { 'audio/windows/song_inbank.bnk': makeBank({ event: 'Play_InBank', media: 700000061, inside: wem(61, 500) }) });
    const r = await mk().resolve({ path: charts, songKey: 'InBank', bankName: 'song_inbank.bnk' }, null);
    assert.strictEqual(r.entry, 'audio/windows/song_inbank.bnk#700000061');
    ok('audio kept inside the bank itself');
  }
  {
    // the game's own file wins over a custom song that reuses the bank's name
    const cdlc = path.join(dir, 'library');
    fs.mkdirSync(cdlc);
    makePsarc(path.join(cdlc, 'Kryptonite_custom_p.psarc'), { 'audio/windows/song_kryptonite.bnk': makeBank({ event: 'Play_Kryptonite', media: 700000071 }), 'audio/windows/700000071.wem': wem(71, 3000) });
    const r = await mk({ folders: () => [cdlc] }).resolve(krypt, null);
    assert.strictEqual(r.mediaId, K.id);
    ok('a custom song with the same bank name doesn’t stand in for the official audio');
  }
  {
    // two different recordings equally well placed: say so, play neither
    makePsarc(path.join(game, 'dlc', 'twin_a_p.psarc'), { 'audio/windows/song_twin.bnk': makeBank({ event: 'Play_Twin', media: 700000081 }), 'audio/windows/700000081.wem': wem(81, 500) });
    makePsarc(path.join(game, 'dlc', 'twin_b_p.psarc'), { 'audio/windows/song_twin.bnk': makeBank({ event: 'Play_Twin', media: 700000082 }), 'audio/windows/700000082.wem': wem(82, 500) });
    await assert.rejects(mk().resolve({ path: charts, songKey: 'Twin', bankName: 'song_twin.bnk' }, null), (e) => e.code === 'AUDIO_AMBIGUOUS' && e.matches.length === 2);
    ok('two different recordings match: reported, not guessed');
  }
  {
    await assert.rejects(mk().resolve({ path: charts, songKey: 'Nowhere', bankName: 'song_nowhere.bnk' }, null), (e) => e.code === 'AUDIO_NO_BANK' && e.songsPsarc === true);
    // the bank is there, the audio it names is not
    makePsarc(path.join(game, 'dlc', 'hollow_p.psarc'), { 'audio/windows/song_hollow.bnk': makeBank({ event: 'Play_Hollow', media: 700000091 }) });
    await assert.rejects(mk().resolve({ path: charts, songKey: 'Hollow', bankName: 'song_hollow.bnk' }, null), (e) => e.code === 'AUDIO_NO_MEDIA');
    ok('“sound bank not found” and “its audio is missing” are told apart');
  }
  {
    // the index is reused: a second finder opens nothing, and a changed archive is read again
    let opened = 0;
    const f = mk({ onProgress: () => opened++ });
    await f.index();
    assert.strictEqual(opened, 0);
    const sp = path.join(game, 'songs.psarc');
    const K2 = 700000101;
    makePsarc(sp, { 'audio/windows/song_kryptonite.bnk': makeBank({ event: 'Play_Kryptonite', media: K2 }), [`audio/windows/${K2}.wem`]: wem(13, 950) });
    const r = await f.resolve(krypt, null);
    assert.strictEqual(r.mediaId, K2);
    assert.strictEqual(opened, 1);
    ok('index kept on disk; only a changed archive is opened again, and its old mapping is dropped');
  }
  {
    // songs.psarc gone
    fs.unlinkSync(path.join(game, 'songs.psarc'));
    await assert.rejects(mk().resolve(krypt, null), (e) => e.code === 'AUDIO_NO_BANK' && e.songsPsarc === false && /songs\.psarc is missing/.test(e.message));
    // no Rocksmith folder at all
    const f = new AudioFinder({ cacheFile: path.join(dir, 'i2.json'), gameDir: async () => null, folders: () => [], log: () => {} });
    await assert.rejects(f.resolve(krypt, null), (e) => e.code === 'AUDIO_NO_GAME');
    ok('songs.psarc missing, and no Rocksmith folder at all, each say so');
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('all ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
