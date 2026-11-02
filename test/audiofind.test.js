'use strict';
/** 4.0.3: a song whose file has no audio finds it in another file by the id its bank names. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AudioFinder, idsInBank } = require('../src/main/services/audiofind');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-afind-'));
  const game = path.join(dir, 'Rocksmith2014');
  fs.mkdirSync(path.join(game, 'dlc'), { recursive: true });
  const other = path.join(game, 'dlc', 'withaudio_p.psarc');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'integration_p.psarc'), other);
  const cacheFile = path.join(dir, 'index.json');
  const finder = new AudioFinder({ cacheFile, gameDir: async () => game, folders: () => [] });

  // a bank that names media 1572044179 (little-endian), among other bytes
  const id = Buffer.alloc(4);
  id.writeUInt32LE(1572044179);
  const bank = Buffer.concat([Buffer.from('BKHD....HIRC'), id, Buffer.from('rest')]);
  assert.deepStrictEqual(idsInBank(bank, [1, 1572044179, 1349014072]), [1572044179]);

  const song = { path: path.join(dir, 'noaudio_p.psarc') };
  const found = await finder.find(song, bank);
  assert.deepStrictEqual(found, { path: other, entry: 'audio/windows/1572044179.wem' });
  console.log('  ok  finds the audio in Rocksmith’s dlc folder');

  assert.strictEqual(await finder.find(song, Buffer.from('nothing here')), null);
  console.log('  ok  nothing found when the bank names no known audio');

  // the index is saved, and a second finder reads it without opening the file again
  assert.ok(fs.existsSync(cacheFile));
  const again = new AudioFinder({ cacheFile, gameDir: async () => game, folders: () => [] });
  await again._load();
  assert.ok(again.files.get(other).wems.length >= 1);
  console.log('  ok  index cached on disk');

  // the song's own file is never its own source
  assert.strictEqual(await finder.find({ path: other }, bank), null);
  console.log('  ok  skips the song’s own file');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('all ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
