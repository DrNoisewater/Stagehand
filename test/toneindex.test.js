'use strict';
/** Reading every song's tones: progress, one read at a time, and saving as it goes. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library } = require('../src/main/services/library');
const { ToneIndex } = require('../src/main/services/tones');

let failed = 0;
const ok = (c, m) => {
  console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`);
  if (!c) failed++;
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ti-'));
  const songsDir = path.join(tmp, 'songs');
  fs.mkdirSync(songsDir);
  const src = fs.readdirSync(path.join(__dirname, 'fixtures')).filter((f) => f.endsWith('.psarc'));
  for (let i = 0; i < 60; i++) {
    const f = src[i % src.length];
    fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(songsDir, `${i}_${f}`));
  }
  const lib = new Library(path.join(tmp, 'library.json'));
  await lib.load();
  await lib.addFolder(songsDir);
  await lib.scan({ full: true });
  const songs = lib.snapshot().songs;
  const cacheFile = path.join(tmp, 'tone-index.json');
  const ti = new ToneIndex({ file: cacheFile, saveEveryMs: 0 });
  const a = [];
  const b = [];
  const savedEarly = [];
  const save = ti._save.bind(ti);
  ti._save = async () => {
    savedEarly.push(fs.existsSync(cacheFile) ? 1 : 0);
    return save();
  };
  const p1 = ti.list(songs, { onProgress: (p) => a.push(p) });
  const p2 = ti.list(songs, { onProgress: (p) => b.push(p) });
  ok(p1 === p2, 'a second request while reading shares the same read');
  const [r1] = await Promise.all([p1, p2]);
  ok(r1.length === songs.length, `every song's tones come back (${r1.length})`);
  ok(a.length >= 2 && a[0].done === 0 && a[a.length - 1].done === songs.length && a.every((p) => p.total === songs.length), `progress goes 0 → ${songs.length} of ${songs.length} (${a.length} updates)`);
  ok(b.length >= 1 && b[b.length - 1].done === songs.length, 'the second asker sees progress too');
  ok(savedEarly.length >= 2, 'what was read is saved before the end (closing midway keeps it)');
  const ti2 = new ToneIndex({ file: cacheFile });
  const c = [];
  const t0 = Date.now();
  const r2 = await ti2.list(songs, { onProgress: (p) => c.push(p) });
  ok(r2.length === songs.length && c.length >= 1 && c[c.length - 1].done === songs.length && c[c.length - 1].read === 0, `next time it's remembered: nothing read again, and the bar still finishes at once (${Date.now() - t0} ms)`);
  // a song file that hangs is skipped (and tried again next time), the rest still come back
  const logs = [];
  const ti3 = new ToneIndex({ file: path.join(tmp, 'c3.json'), slowMs: 300, log: (l) => logs.push(l) });
  const read = ti3._read.bind(ti3);
  ti3._read = (song) => (song === songs[3] ? new Promise(() => {}) : read(song));
  const r3 = await ti3.list(songs);
  ok(r3.length === songs.length - 1 && !ti3.cache.has(songs[3].path), 'a song that hangs is skipped, not remembered, and the rest arrive');
  ok(logs.some((l) => /1 too slow, skipped/.test(l)), `and the log says so: “${logs[logs.length - 1]}”`);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `${failed} failed` : 'all ok');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
