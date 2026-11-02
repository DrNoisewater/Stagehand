/* Recordings: file names "SH - <song>", no overwrites, sizes in the list, videos listed. `node test/recordings.test.js` */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Takes } = require('../src/main/services/stats');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-rec-'));
  const takes = new Takes(dir);
  const pcm = new Uint8Array(new Float32Array(4800).fill(0.1).buffer);
  const a = await takes.save({ name: 'Kryptonite', seconds: 0.1, rate: 48000, channels: 1, pcm });
  const b = await takes.save({ name: 'Kryptonite', seconds: 0.1, rate: 48000, channels: 1, pcm });
  assert.strictEqual(a.file, 'SH - Kryptonite.wav');
  assert.strictEqual(b.file, 'SH - Kryptonite (2).wav', 'a second take never overwrites the first');
  assert.strictEqual(takes.freeName('AC/DC: Back In Black?', 'mp4', 'Videos'), 'Videos/SH - AC DC Back In Black.mp4', 'characters Windows can’t use in names are left out');
  assert.strictEqual(takes.freeName('', 'mp4'), 'SH - Recording.mp4');
  fs.mkdirSync(path.join(dir, 'Videos'));
  const rel = takes.freeName('Jam Session', 'mp4', 'Videos');
  fs.writeFileSync(path.join(dir, rel), Buffer.alloc(2048));
  const v = await takes.addVideo({ file: rel, name: 'SH - Jam Session', seconds: 12.34 });
  assert.strictEqual(takes.freeName('Jam Session', 'mp4', 'Videos'), 'Videos/SH - Jam Session (2).mp4');
  const list = await takes.list();
  assert.strictEqual(list.length, 3);
  const lv = list.find((t) => t.id === v.id);
  assert.strictEqual(lv.kind, 'video');
  assert.strictEqual(lv.bytes, 2048);
  assert.strictEqual(lv.seconds, 12.3);
  assert.ok(list.find((t) => t.id === a.id).bytes > 44);
  assert.strictEqual(takes.pathOf(v.id), path.join(dir, 'Videos', 'SH - Jam Session.mp4'));
  // reopened later: the list comes back the same
  const again = new Takes(dir);
  assert.strictEqual((await again.list()).length, 3);
  assert.ok(await again.remove(a.id));
  assert.ok(!fs.existsSync(path.join(dir, 'SH - Kryptonite.wav')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS recordings: SH - names, no overwrites, safe names, videos listed with size and length, remove');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
