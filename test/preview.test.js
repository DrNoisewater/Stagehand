'use strict';
/**
 * 4.30.1: a click on a song always has something to play, or a reason why not.
 *  - the preview clip in the file is found however the file keeps it: the manifest names its bank,
 *    or only the bank's name says "_preview", or the clip sits inside its bank, or there is just a
 *    second, much smaller .wem; the song's own audio is never taken for its preview;
 *  - a song read before Stagehand knew those ways is looked at again when clicked;
 *  - a decode that fails once is tried again; a clip that never decodes, or a song with no clip,
 *    plays 30 s of the song (decoded first when it isn't yet);
 *  - quick clicks across songs with no clip decode only the last one clicked.
 * A stand-in decoder writes a short tone (Linux has no Rocksmith decoder).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
// the stand-in decoder is a Node script: run it with Node, so the test works on Windows too
const realSpawn = cp.spawn;
cp.spawn = (cmd, args = [], o) => (String(cmd).endsWith('.fake.js') ? realSpawn(process.execPath, [cmd, ...args], o) : realSpawn(cmd, args, o));
const { Psarc } = require('../src/main/core/psarc');
const { readSongs } = require('../src/main/core/rocksmith');
const { AudioService } = require('../src/main/services/audio');
const { makePsarc, makeBank } = require('./helpers/psarc-make');

const ok = (m) => console.log(`  ok  ${m}`);

// the stand-in decoder: "FAIL" audio never decodes, "FLAKY" audio fails the first time,
// "SLOW" audio takes a while; anything else becomes 2 s of tone (6 s for big files)
const FAKE = `const fs=require('fs');const a=process.argv;const o=a[a.indexOf('-o')+1];const src=a[a.length-1];
const d=fs.readFileSync(src);const tag=d.toString('latin1',0,5).replace(/[^A-Z0-9]/g,'');
fs.appendFileSync(process.env.SH_DECODES,tag+' '+d.length+'\\n');
if(tag.startsWith('FAIL'))process.exit(3);
if(tag==='FLAKY'){const m=process.env.SH_DECODES+'.flaky';if(!fs.existsSync(m)){fs.writeFileSync(m,'1');process.exit(4);}}
if(tag.startsWith('SLOW')){const w=Date.now()+400;while(Date.now()<w);}
const sr=8000,n=sr*(d.length>100000?6:2),b=Buffer.alloc(44+n*2);
b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i/3)*9000),44+i*2);
fs.writeFileSync(o,b);
`;

const audioOf = (tag, kb) => Buffer.concat([Buffer.from(tag, 'latin1'), Buffer.alloc(kb * 1024 - tag.length, 5)]);
const manifest = (key, attrs) => Buffer.from(JSON.stringify({ Entries: { [key + 'L']: { Attributes: { SongKey: key, SongName: key, ArrangementName: 'Lead', ...attrs } } } }));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-preview-'));
  const decoder = path.join(dir, 'vgmstream.fake.js');
  fs.writeFileSync(decoder, FAKE, { mode: 0o755 });
  const decodes = path.join(dir, 'decodes.txt');
  process.env.SH_DECODES = decodes;
  const decoded = () => (fs.existsSync(decodes) ? fs.readFileSync(decodes, 'utf8').trim().split('\n').filter(Boolean) : []);

  // A song file shaped like the toolkit's: the song's bank, its preview bank, two .wem files
  const song = (file, key, { main = audioOf('SONG', 300), prev = audioOf('PREV', 40), manifestPreview = true, previewInBank = false, noPreviewBank = false } = {}) => {
    const mainId = 600000001 + key.length;
    const prevId = 600000101 + key.length;
    const files = {
      [`manifests/songs_dlc_${key}/${key}_lead.json`]: manifest(key, { SongBank: `song_${key}.bnk`, ...(manifestPreview ? { PreviewBankPath: `song_${key}_preview.bnk` } : {}) }),
      [`audio/windows/song_${key}.bnk`]: makeBank({ event: `Play_${key}`, media: mainId }),
      [`audio/windows/${mainId}.wem`]: main,
    };
    if (!noPreviewBank) files[`audio/windows/song_${key}_preview.bnk`] = makeBank({ event: `Play_${key}_Preview`, media: prevId, inside: previewInBank ? prev : null });
    if (prev && !previewInBank) files[`audio/windows/${prevId}.wem`] = prev;
    makePsarc(file, files);
    return { mainId, prevId };
  };
  const read = async (file) => {
    const p = await Psarc.open(file);
    try {
      return (await readSongs(p))[0];
    } finally {
      await p.close();
    }
  };

  // ---- finding the preview in the file
  {
    const f = path.join(dir, 'plain_p.psarc');
    const { prevId, mainId } = song(f, 'plain');
    const s = await read(f);
    assert.strictEqual(s.previewEntry, `audio/windows/${prevId}.wem`);
    assert.strictEqual(s.audioEntry, `audio/windows/${mainId}.wem`);
    ok('the manifest names the preview bank: its clip is the preview');

    const g = path.join(dir, 'unnamed_p.psarc');
    const r = song(g, 'unnamed', { manifestPreview: false, prev: audioOf('PREVU', 40) });
    assert.strictEqual((await read(g)).previewEntry, `audio/windows/${r.prevId}.wem`);
    ok('the manifest says nothing, the bank is called _preview: its clip is still found');

    const i = path.join(dir, 'inbank_p.psarc');
    const r2 = song(i, 'inbank', { previewInBank: true, prev: audioOf('PREV', 120) });
    assert.strictEqual((await read(i)).previewEntry, `audio/windows/song_inbank_preview.bnk#${r2.prevId}`);
    ok('a preview kept inside its bank (no .wem of its own) is used');

    const j = path.join(dir, 'stub_p.psarc');
    song(j, 'stub', { previewInBank: true, prev: audioOf('PREV', 2) });
    assert.strictEqual((await read(j)).previewEntry, null);
    ok('only the first few KB of a streamed clip inside a bank is not taken for a preview');

    const k = path.join(dir, 'nobank_p.psarc');
    const r3 = song(k, 'nobank', { noPreviewBank: true });
    assert.strictEqual((await read(k)).previewEntry, `audio/windows/${r3.prevId}.wem`);
    ok('no preview bank, but a second much smaller .wem: that is the preview');

    // a preview bank that also mentions the song's own audio
    const m = path.join(dir, 'both_p.psarc');
    const bothMain = 600000001 + 4;
    const bothPrev = 600000101 + 4;
    const bothBank = makeBank({ event: 'Play_both_Preview', media: bothPrev, extraSounds: [[777, bothMain]] });
    makePsarc(m, {
      'manifests/songs_dlc_both/both_lead.json': manifest('both', { SongBank: 'song_both.bnk', PreviewBankPath: 'song_both_preview.bnk' }),
      'audio/windows/song_both.bnk': makeBank({ event: 'Play_both', media: bothMain }),
      'audio/windows/song_both_preview.bnk': bothBank,
      [`audio/windows/${bothMain}.wem`]: audioOf('SONG', 300),
      [`audio/windows/${bothPrev}.wem`]: audioOf('PREV', 40),
    });
    const sb = await read(m);
    assert.strictEqual(sb.previewEntry, `audio/windows/${bothPrev}.wem`);
    assert.notStrictEqual(sb.previewEntry, sb.audioEntry);
    ok("the song's own audio is never taken for its preview");
  }

  // ---- the clip played when a song is clicked
  const cache = path.join(dir, 'cache');
  const songs = new Map();
  const library = {
    get: (id) => songs.get(id),
    setAudioKey: (id, key) => {
      const s = songs.get(id);
      if (s) s.audioKey = key;
      return s;
    },
    setAudioFrom: () => null,
    setAudioFail: () => null,
  };
  const logs = [];
  const svc = () => new AudioService({ cacheDir: cache, tools: { vgmstreamPath: () => decoder }, library, settings: { get: () => ({ cache: { audioLimitGB: 4 } }) }, log: (m) => logs.push(m) });
  const add = async (id, file, over = {}) => {
    const s = { id, path: file, ...(await read(file)), ...over };
    songs.set(id, s);
    return s;
  };

  {
    const a = svc();
    const s = await add('plain', path.join(dir, 'plain_p.psarc'));
    const c = await a.preparePreview(s);
    assert.strictEqual(c.from, 'preview');
    assert.ok(/^stagehand:\/\/audio\/pv[a-f0-9]+\.wav$/.test(c.url), c.url);
    assert.ok(Math.abs(c.length - 2) < 0.01);
    ok("a click plays the song's own preview clip");

    // a song read before the preview could be found (its record has none): looked at again
    const old = await add('old', path.join(dir, 'unnamed_p.psarc'), { previewEntry: null });
    fs.writeFileSync(decodes, '');
    const c2 = await a.preparePreview(old);
    assert.strictEqual(c2.from, 'preview');
    assert.deepStrictEqual(decoded().map((l) => l.split(' ')[0]), ['PREVU']);
    ok('a song read by an older Stagehand is looked at again and plays its own clip (no whole-song decode)');
  }

  {
    // a preview that fails to decode once (a busy PC, a virus scanner): tried again
    const f = path.join(dir, 'flaky_p.psarc');
    song(f, 'flaky', { prev: audioOf('FLAKY', 40) });
    const s = await add('flaky', f);
    fs.writeFileSync(decodes, '');
    const c = await svc().preparePreview(s);
    assert.strictEqual(c.from, 'preview');
    assert.deepStrictEqual(decoded().map((l) => l.split(' ')[0]), ['FLAKY', 'FLAKY']);
    ok('a preview decode that fails once is tried again and plays');
  }

  {
    // a preview clip the decoder can't read: 30 s of the song instead (here the whole short tone)
    const f = path.join(dir, 'broken_p.psarc');
    song(f, 'broken', { prev: audioOf('FAIL', 40) });
    const s = await add('broken', f);
    fs.writeFileSync(decodes, '');
    const c = await svc().preparePreview(s);
    assert.strictEqual(c.from, 'song');
    assert.ok(c.length > 1, `length ${c.length}`);
    assert.ok(s.audioKey, 'the song is decoded for playing too');
    ok("a preview clip that never decodes: the song's own audio plays instead");
  }

  {
    // no preview clip and the song not decoded yet: it is decoded and sliced (before: nothing played)
    const f = path.join(dir, 'clipless_p.psarc');
    song(f, 'clipless', { prev: null, noPreviewBank: true });
    const s = await add('clipless', f);
    assert.strictEqual(s.previewEntry, null);
    const c = await svc().preparePreview(s);
    assert.ok(c && c.from === 'song' && c.length > 1, JSON.stringify(c));
    ok('a song with no preview clip, never opened: a slice of the song plays');
  }

  {
    // quick clicks across three songs with no clip: only the first (already started) and the last decode
    const a = svc();
    const ids = ['q1', 'q2', 'q3'];
    for (const id of ids) {
      const f = path.join(dir, `${id}_p.psarc`);
      song(f, id, { prev: null, noPreviewBank: true, main: audioOf(`SLOW${id.slice(1)}`, 300) });
      await add(id, f);
    }
    fs.writeFileSync(decodes, '');
    const first = a.preparePreview(songs.get('q1'));
    while (!a._pvFull) await new Promise((r) => setTimeout(r, 10)); // its decode has started
    const res = await Promise.allSettled([first, a.preparePreview(songs.get('q2')), a.preparePreview(songs.get('q3'))]);
    assert.strictEqual(res[0].status, 'fulfilled');
    assert.strictEqual(res[1].status, 'rejected');
    assert.strictEqual(res[1].reason.code, 'PREVIEW_SKIPPED');
    assert.strictEqual(res[2].status, 'fulfilled');
    assert.deepStrictEqual(decoded().map((l) => l.split(' ')[0]), ['SLOW1', 'SLOW3']);
    ok('quick clicks across songs with no clip decode only the one started and the last one clicked');
  }

  {
    // no decoder at all: the reason comes back (the page says it in plain words)
    const a = new AudioService({ cacheDir: path.join(dir, 'cache2'), tools: { vgmstreamPath: () => null }, library, settings: { get: () => ({ cache: {} }) } });
    await assert.rejects(a.preparePreview(songs.get('plain')), (e) => e.code === 'NEED_VGMSTREAM');
    ok('no decoder: the reason is given, not silence');
  }

  {
    // songs around the one clicked get their clips ready in the background
    const a = new AudioService({ cacheDir: path.join(dir, 'cache3'), tools: { vgmstreamPath: () => decoder }, library, settings: { get: () => ({ cache: {} }) } });
    fs.writeFileSync(decodes, '');
    await a.warmPreviews([songs.get('plain'), songs.get('clipless'), songs.get('old')]);
    assert.deepStrictEqual(decoded().map((l) => l.split(' ')[0]), ['PREV', 'PREVU']);
    fs.writeFileSync(decodes, '');
    const c = await a.preparePreview(songs.get('old'));
    assert.strictEqual(c.from, 'preview');
    assert.deepStrictEqual(decoded(), []);
    ok('the clips of the songs around are made ready (never a whole song), so the next click decodes nothing');
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('preview: all passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
