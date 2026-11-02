'use strict';
/* Core tests: run with `node test/core.test.js` (no Electron needed). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Psarc, rewrite, verify, safeEdit } = require('../src/main/core/psarc');
const rocksmith = require('../src/main/core/rocksmith');
const jsonpatch = require('../src/main/core/jsonpatch');
const aes = require('../src/main/core/aescfb');
const image = require('../src/main/core/image');

const FIX = path.join(__dirname, 'fixtures');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-test-'));
let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('AES-CFB round trip at odd lengths', () => {
  for (const len of [1, 15, 16, 17, 31, 838, 4096 + 7]) {
    const data = Buffer.from(Array.from({ length: len }, (_, i) => (i * 31 + 7) & 255));
    const enc = aes.encrypt(data);
    assert.strictEqual(enc.length, len);
    assert.ok(!enc.equals(data));
    assert.ok(aes.decrypt(enc).equals(data));
  }
});

for (const fx of ['integration_p.psarc', 'legacy_p.psarc', 'partial_p.psarc']) {
  test(`read ${fx}`, async () => {
    const p = await Psarc.open(path.join(FIX, fx));
    try {
      assert.strictEqual(p.header.entrySize, 30);
      assert.ok(p.names.length >= 1);
      for (const e of p.entries) {
        const r = await p.inflateEntry(e);
        assert.strictEqual(r.data.length, e.length, `length for ${p.nameOf(e)}`);
      }
    } finally {
      await p.close();
    }
  });

  test(`null rewrite of ${fx} verifies and is byte-identical where layout allows`, async () => {
    const src = path.join(FIX, fx);
    const dst = path.join(tmpDir, 'null_' + fx);
    const res = await rewrite(src, new Map(), dst);
    await verify(dst, res);
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dst);
    if (fx === 'integration_p.psarc') assert.ok(a.equals(b), 'byte identical');
    else console.log(`    (${fx}: ${a.equals(b) ? 'byte-identical' : 'equivalent, re-laid-out'})`);
  });
}

test('song metadata from integration fixture', async () => {
  const p = await Psarc.open(path.join(FIX, 'integration_p.psarc'));
  const songs = await rocksmith.readSongs(p);
  await p.close();
  assert.strictEqual(songs.length, 1);
  const s = songs[0];
  assert.strictEqual(s.title, 'The Test');
  assert.strictEqual(s.titleSort, 'Test');
  assert.strictEqual(s.artist, 'Integration');
  assert.strictEqual(s.album, 'Album Name');
  assert.strictEqual(s.year, 2021);
  assert.strictEqual(s.tuning, 'E Standard');
  assert.strictEqual(s.audioEntry, 'audio/windows/1572044179.wem');
  assert.strictEqual(s.previewEntry, 'audio/windows/1349014072.wem');
  assert.deepStrictEqual(s.arrangements.map((a) => a.type), ['lead', 'bass', 'vocals', 'jvocals']);
  assert.strictEqual(s.author, 'iminashi');
  assert.ok(s.art && s.art[256]);
  assert.strictEqual(s.sections.length, 3);
  assert.strictEqual(s.sections[0].label, 'Melody 1');
});

test('legacy fixture picks the bank-referenced audio, not the largest wem', async () => {
  const p = await Psarc.open(path.join(FIX, 'legacy_p.psarc'));
  const [s] = await rocksmith.readSongs(p);
  await p.close();
  assert.strictEqual(s.audioEntry, 'audio/windows/2099943411.wem');
  assert.deepStrictEqual(s.arrangements.map((a) => a.type), ['lead', 'rhythm', 'vocals']);
});

test('tuning names', () => {
  assert.strictEqual(rocksmith.tuningName([-2, 0, 0, 0, 0, 0]), 'Drop D');
  assert.strictEqual(rocksmith.tuningName([-3, -1, -1, -1, -1, -1]), 'Drop C#');
  assert.strictEqual(rocksmith.tuningName([-1, -1, -1, -1, -1, -1]), 'Eb Standard');
  assert.strictEqual(rocksmith.tuningName([-2, 0, 0, 0, 0, 0], true), 'Drop D');
  assert.strictEqual(rocksmith.tuningName([0, 0, 0, 2, 0, 0]), 'E A D A B E');
  assert.strictEqual(rocksmith.centsLabel(-31.77), 'A432');
});

test('JSON patch preserves every other byte', () => {
  const src = Buffer.from('﻿{\r\n  "Entries": {\r\n    "X": {\r\n      "Attributes": {\r\n        "SongName": "Old",\r\n        "SongYear": 1999,\r\n        "Num": 1.50,\r\n        "Jp": "曲名"\r\n      }\r\n    }\r\n  }\r\n}', 'utf8');
  const { buffer, applied } = jsonpatch.patchVerified(src, [
    { path: ['Entries', 'X', 'Attributes', 'SongName'], value: 'Ünïcode "quoted"' },
    { path: ['Entries', 'X', 'Attributes', 'SongYear'], value: 2004 },
  ]);
  assert.strictEqual(applied, 2);
  const expect = src.toString('utf8').replace('"Old"', JSON.stringify('Ünïcode "quoted"')).replace('1999', '2004');
  assert.strictEqual(buffer.toString('utf8'), expect);
  assert.ok(buffer.toString('utf8').includes('1.50'));
});

test('XML patch escapes and preserves', () => {
  const src = Buffer.from('﻿<?xml version="1.0"?>\r\n<song>\r\n  <title>Old</title>\r\n  <albumYear>1999</albumYear>\r\n</song>', 'utf8');
  const { buffer, applied } = rocksmith.patchXml(src, { title: 'Rock & <Roll>', albumYear: 2001 });
  assert.strictEqual(applied, 2);
  assert.ok(buffer.toString('utf8').includes('<title>Rock &amp; &lt;Roll&gt;</title>'));
  assert.ok(buffer.toString('utf8').startsWith('﻿<?xml'));
});

for (const fx of ['integration_p.psarc', 'legacy_p.psarc']) {
  test(`edit metadata in ${fx} safely`, async () => {
    const file = path.join(tmpDir, 'edit_' + fx);
    fs.copyFileSync(path.join(FIX, fx), file);
    const before = await Psarc.open(file);
    const [song] = await rocksmith.readSongs(before);
    const originals = {};
    for (const n of before.names) originals[n] = await before.read(n);
    const { replacements } = await rocksmith.buildEdit(before, song.songKey, {
      title: 'Nuevo Título',
      titleSort: 'Nuevo Título',
      artist: 'AC/DC & Friends',
      album: 'Back in "Black"',
      year: '1980',
    });
    await before.close();
    assert.ok(replacements.size >= 2, 'manifest files changed');
    const backupDir = path.join(tmpDir, 'backups');
    const res = await safeEdit(file, replacements, { backupDir, keepBackups: 3 });
    assert.ok(fs.existsSync(res.backupPath));
    assert.ok(fs.readFileSync(res.backupPath).equals(fs.readFileSync(path.join(FIX, fx))), 'backup is the original');

    const after = await Psarc.open(file);
    const [s2] = await rocksmith.readSongs(after);
    assert.strictEqual(s2.title, 'Nuevo Título');
    assert.strictEqual(s2.artist, 'AC/DC & Friends');
    assert.strictEqual(s2.album, 'Back in "Black"');
    assert.strictEqual(s2.year, 1980);
    assert.strictEqual(s2.audioEntry, song.audioEntry);
    for (const n of after.names) {
      const data = await after.read(n);
      if (replacements.has(n)) {
        assert.ok(data.equals(replacements.get(n)));
      } else {
        assert.ok(data.equals(originals[n]), `untouched file ${n} is identical`);
      }
    }
    // Every JSON still parses, and only the intended keys differ.
    for (const n of after.names.filter((x) => /\.(json|hsan)$/.test(x))) {
      const a = jsonpatch.parse(originals[n]);
      const b = jsonpatch.parse(await after.read(n));
      for (const [id, ent] of Object.entries(a.Entries)) {
        for (const [k, v] of Object.entries(ent.Attributes)) {
          const nv = b.Entries[id].Attributes[k];
          if (['SongName', 'SongNameSort', 'ArtistName', 'AlbumName', 'SongYear'].includes(k)) continue;
          assert.ok(jsonpatch.deepEqual(v, nv), `${n} ${k} unchanged`);
        }
      }
    }
    if (fx === 'legacy_p.psarc') {
      const xml = (await after.read('songs/arr/testtest_lead.xml')).toString('utf8');
      assert.ok(xml.includes('<title>Nuevo Título</title>'));
      assert.ok(xml.includes('<artistName>AC/DC &amp; Friends</artistName>'));
      assert.ok(xml.includes('<albumYear>1980</albumYear>'));
    }
    await after.close();
  });
}

test('failed write leaves the original untouched', async () => {
  const file = path.join(tmpDir, 'locked_integration_p.psarc');
  fs.copyFileSync(path.join(FIX, 'integration_p.psarc'), file);
  const orig = fs.readFileSync(file);
  await assert.rejects(() => safeEdit(file, new Map([['does/not/exist.json', Buffer.from('{}')]]), {}));
  assert.ok(fs.readFileSync(file).equals(orig));
  assert.deepStrictEqual(fs.readdirSync(tmpDir).filter((f) => f.includes('stagehand-tmp')), []);
});

test('validation rejects bad input', () => {
  assert.throws(() => rocksmith.normalizeChanges({ year: '19x4' }), /Year/);
  assert.throws(() => rocksmith.normalizeChanges({ title: '   ' }), /Title/);
  assert.deepStrictEqual(rocksmith.normalizeChanges({ year: ' 2001 ', title: ' A\tB ' }), { year: 2001, title: 'A B' });
});

test('album art decodes to PNG', async () => {
  const p = await Psarc.open(path.join(FIX, 'integration_p.psarc'));
  const dds = await p.read('gfxassets/album_art/album_integrationtest_256.dds');
  await p.close();
  const img = image.decodeDds(dds);
  assert.strictEqual(img.width, 256);
  const png = image.encodePng(img);
  assert.strictEqual(png.toString('latin1', 1, 4), 'PNG');
  fs.writeFileSync(path.join(tmpDir, 'art.png'), png);
});

test('4.0.2: song audio stored inside a sound bank (DIDX/DATA) is found', () => {
  const { bankMedia } = require('../src/main/core/rocksmith');
  const chunk = (tag, body) => { const b = Buffer.alloc(8 + body.length); b.write(tag); b.writeUInt32LE(body.length, 4); body.copy(b, 8); return b; };
  const idx = Buffer.alloc(24);
  idx.writeUInt32LE(11, 0); idx.writeUInt32LE(0, 4); idx.writeUInt32LE(3, 8);
  idx.writeUInt32LE(22, 12); idx.writeUInt32LE(3, 16); idx.writeUInt32LE(5, 20);
  const bank = Buffer.concat([chunk('BKHD', Buffer.alloc(4)), chunk('DIDX', idx), chunk('DATA', Buffer.from('abcRIFFx')), chunk('HIRC', Buffer.alloc(4))]);
  const m = bankMedia(bank);
  assert.strictEqual(m.length, 2);
  const big = m.reduce((a, b) => (b.size > a.size ? b : a));
  assert.strictEqual(big.id, 22);
  assert.strictEqual(bank.toString('latin1', big.offset, big.offset + big.size), 'RIFFx');
  assert.deepStrictEqual(bankMedia(Buffer.from('not a bank')), []);
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ok  ${t.name}`);
    } catch (err) {
      console.log(`  FAIL ${t.name}\n       ${err.stack.split('\n').slice(0, 4).join('\n       ')}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed  (scratch: ${tmpDir})`);
})();
