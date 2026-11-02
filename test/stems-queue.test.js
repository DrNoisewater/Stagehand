/* The stem queue: the song you open goes first, even while another song's split is
   still getting its audio ready; cancelling works then too. `node test/stems-queue.test.js` */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const cp = require('child_process');

// a pretend stem engine: prints progress, then "done" after a while, unless killed
const spawned = [];
cp.spawn = (cmd, args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 0;
  const out = args[args.indexOf('--outdir') + 1];
  const timer = setTimeout(() => {
    for (const n of ['vocals', 'drums', 'bass', 'other']) fs.writeFileSync(path.join(out, `${n}.wav`), 'x');
    child.stdout.emit('data', Buffer.from(JSON.stringify({ event: 'done', stems: ['vocals', 'drums', 'bass', 'other'], sampleRate: 48000, frames: 1, seconds: 1 }) + '\n'));
    child.emit('close', 0);
  }, 300);
  child.kill = () => {
    clearTimeout(timer);
    setImmediate(() => child.emit('close', null));
  };
  spawned.push({ song: args[args.indexOf('--input') + 1], child });
  return child;
};
const { StemService } = require('../src/main/services/stems');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-stems-'));
  const songs = { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' }, c: { id: 'c', title: 'C' } };
  const slow = { a: 800, b: 50, c: 50 }; // A's audio takes a while to decode
  const audio = {
    prepare: (song) => new Promise((r) => setTimeout(() => r({ key: `k${song.id}` }), slow[song.id])),
    wavPath: (k) => path.join(dir, `${k}.wav`),
  };
  const svc = new StemService({
    stemsDir: dir,
    audio,
    tools: { enginePython: () => 'python', engineEnv: () => ({}) },
    settings: { get: () => ({ stems: { model: 'htdemucs' } }) },
    library: { get: (id) => songs[id] },
    engineScript: 'x.py',
  });
  const ready = new Map();
  svc.on('update', (u) => u.state === 'ready' && !ready.has(u.songId) && ready.set(u.songId, Date.now()));
  const t0 = Date.now();
  svc.request(['a']);
  await new Promise((r) => setTimeout(r, 100)); // A is decoding its audio, no engine yet
  svc.request(['b']);
  svc.prioritize('b', { now: true });
  while (!ready.has('b') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ready.has('b'), 'B got its stems');
  assert.ok(!ready.has('a') || ready.get('b') < ready.get('a'), 'B was split before A');
  assert.ok(ready.get('b') - t0 < 1000, `B didn’t wait for A’s whole split (${ready.get('b') - t0} ms)`);
  while (!ready.has('a') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ready.has('a'), 'A went back in line and finished after');
  // cancel while decoding: no engine starts for it
  slow.c = 400;
  const before = spawned.length;
  svc.request(['c']);
  await new Promise((r) => setTimeout(r, 100));
  svc.cancel('c');
  await new Promise((r) => setTimeout(r, 700));
  assert.strictEqual(spawned.length, before, 'a split cancelled while decoding never starts');
  assert.strictEqual(svc.status(songs.c).state, 'none');
  assert.ok(!fs.existsSync(path.join(dir, 'kc')), 'nothing left behind for it');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS stem queue: the opened song jumps ahead even while another is decoding; cancel works then too');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
