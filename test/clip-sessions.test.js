// Record clip writes to disk while it records (4.0.7): pieces arrive in order, the sound
// becomes a proper WAV, a session cut off (as after a crash) still has what came in.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ClipSessions } = require('../src/main/services/clip-sessions');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-clips-'));
  const cs = new ClipSessions({ tempRoot: root });
  const id = await cs.begin({ title: 'Grease', songId: 's1', rate: 48000 });
  // many pieces at once, as the page sends them: they must land in order
  const parts = [];
  for (let i = 0; i < 50; i++) parts.push(cs.chunk(id, 'v', new Uint8Array(1000).fill(i)));
  const snd = new Int16Array(48000 * 2).map((_, i) => (i % 2 ? 1000 : -1000));
  parts.push(cs.chunk(id, 'a', new Uint8Array(snd.buffer)));
  await Promise.all(parts);
  assert.strictEqual(cs.active().length, 1, 'the running recording is listed (for saving after a crash)');
  const c = await cs.close(id);
  const v = fs.readFileSync(c.input);
  assert.strictEqual(v.length, 50000);
  for (let i = 0; i < 50; i++) assert.strictEqual(v[i * 1000], i, 'video pieces in order');
  const w = fs.readFileSync(c.sound);
  assert.strictEqual(w.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(w.readUInt32LE(24), 48000);
  assert.strictEqual(w.readUInt32LE(40), snd.byteLength);
  assert.strictEqual(w.readInt16LE(44), -1000);
  assert.strictEqual(c.title, 'Grease');
  assert.strictEqual(cs.active().length, 0);
  await assert.rejects(() => Promise.resolve().then(() => cs.chunk(id, 'v', new Uint8Array(1))), /already finished/);
  await cs.remove(c.dir);
  assert.ok(!fs.existsSync(c.dir), 'cleaned up');
  // a recording with only video (the in-app engine): no WAV
  const id2 = await cs.begin({ title: 'Jam Session' });
  await cs.chunk(id2, 'v', new Uint8Array(10));
  const c2 = await cs.close(id2);
  assert.strictEqual(c2.sound, null);
  await cs.remove(c2.dir);
  fs.rmSync(root, { recursive: true, force: true });
  console.log('ok   Record clip writes to disk while it records: pieces in order, sound as a WAV, cleaned up');
})().catch((e) => {
  console.error('FAIL', e.stack || e.message);
  process.exit(1);
});
