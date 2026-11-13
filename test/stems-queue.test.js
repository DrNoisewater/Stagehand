/* The stem queue: the song you open goes first, even while another song's split is
   still getting its audio ready; cancelling works then too. 4.4.1: each song gets its own
   engine (one that stayed open could hang on Windows), a stopped split really stops (no
   split left running in the background), time left comes only from real progress, and
   songs you pick in the list are split ahead.
   `node test/stems-queue.test.js` */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const cp = require('child_process');
const crypto = require('crypto');
const keyOf = (id) => crypto.createHash('sha1').update(id).digest('hex').slice(0, 24);

// a pretend stem engine for one song: progress, then "done" after a while, unless killed
const engines = [];
const splits = []; // every split started
let jobMs = 300;
cp.spawn = (cmd, args) => {
  assert.ok(!args.includes('--serve'), 'one engine per song');
  const opt = (k) => args[args.indexOf(k) + 1];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 0;
  child.exitCode = null;
  child.killed = false;
  child.args = args;
  const say = (ev) => child.stdout.emit('data', Buffer.from(JSON.stringify(ev) + '\n'));
  let t = null;
  const end = (code) => {
    if (child.closed) return;
    child.closed = true;
    child.exitCode = code;
    clearInterval(t);
    setImmediate(() => child.emit('close', code));
  };
  splits.push({ input: opt('--input'), child });
  setImmediate(() => {
    if (child.closed) return;
    say({ event: 'status', message: 'Loading model' });
    say({ event: 'device', device: 'cuda', name: 'Test GPU' });
    say({ event: 'status', message: 'Separating' });
    let step = 0;
    const steps = 6;
    t = setInterval(() => {
      step++;
      if (step < steps) return say({ event: 'progress', value: step / steps });
      clearInterval(t);
      for (const n of ['vocals', 'drums', 'bass', 'other']) fs.writeFileSync(path.join(opt('--outdir'), `${n}.wav`), 'x');
      say({ event: 'done', stems: ['vocals', 'drums', 'bass', 'other'], sampleRate: 48000, frames: 48000 * 200, seconds: 3, device: 'cuda' });
      end(0);
    }, jobMs / steps);
  });
  child.kill = () => {
    child.killed = true;
    end(null);
  };
  engines.push(child);
  return child;
};
const { StemService } = require('../src/main/services/stems');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const t = Date.now();
  while (!fn() && Date.now() - t < ms) await wait(20);
  return fn();
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-stems-'));
  const songs = {};
  for (const id of 'abcdefghijk') songs[id] = { id, title: id.toUpperCase(), length: 200 };
  const slow = { a: 800 }; // A's audio takes a while to decode
  const audio = {
    prepare: (song) => new Promise((r) => setTimeout(() => r({ key: (song.audioKey = keyOf(song.id)) }), slow[song.id] || 50)),
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
  const updates = [];
  svc.on('update', (u) => {
    updates.push({ ...u, t: Date.now() });
    if (u.state === 'ready' && !ready.has(u.songId)) ready.set(u.songId, Date.now());
  });
  const splitOf = (id) => splits.filter((s) => s.input.endsWith(`${keyOf(id)}.wav`));

  // 1. the opened song jumps ahead of one that's still decoding
  const t0 = Date.now();
  svc.request(['a']);
  await wait(100); // A is decoding its audio, no split yet
  svc.request(['b']);
  svc.prioritize('b', { now: true });
  await until(() => ready.has('b'));
  assert.ok(ready.has('b'), 'B got its stems');
  assert.ok(!ready.has('a') || ready.get('b') < ready.get('a'), 'B was split before A');
  assert.ok(ready.get('b') - t0 < 1000, `B didn’t wait for A’s whole split (${ready.get('b') - t0} ms)`);
  await until(() => ready.has('a'));
  assert.ok(ready.has('a'), 'A went back in line and finished after');
  assert.ok(engines.every((c) => c.closed), 'every engine closed when its song was done');
  console.log('ok   the opened song jumps ahead of one still decoding');

  // 2. cancel while decoding: no split starts for it
  slow.c = 400;
  const before = splits.length;
  svc.request(['c']);
  await wait(100);
  svc.cancel('c');
  await wait(700);
  assert.strictEqual(splits.length, before, 'a split cancelled while decoding never starts');
  assert.strictEqual(svc.status(songs.c).state, 'none');
  assert.ok(!fs.readdirSync(dir).some((n) => n.startsWith('C [')), 'nothing left behind for it');
  console.log('ok   cancel while decoding: no split starts');

  // 3. time left: only once the split is really going, and it goes down
  jobMs = 1200;
  updates.length = 0;
  svc.request(['d']);
  await until(() => ready.has('d'));
  const runs = updates.filter((u) => u.songId === 'd' && u.state === 'running');
  assert.ok(runs.length >= 4, 'running updates for D');
  assert.ok(runs.every((u) => typeof u.startedAt === 'number'), 'each update says when the split started');
  const firstProgress = runs.findIndex((u) => u.progress > 0.03);
  assert.ok(runs.slice(0, firstProgress).every((u) => u.eta == null), 'no time left before the split shows progress (no countdown while it starts)');
  const etas = runs.map((u) => u.eta).filter((e) => typeof e === 'number');
  assert.ok(etas.length >= 3, `the time left is in the updates (${JSON.stringify(etas)})`);
  for (let i = 1; i < etas.length; i++) assert.ok(etas[i] <= etas[i - 1], `the time left never goes up (${JSON.stringify(etas)})`);
  console.log(`ok   time left only from real progress, and it goes down: ${etas.join(', ')} s`);

  // 4. a song opened to play stops a running split: its engine is ended
  svc.request(['e']);
  await until(() => splitOf('e').length && (svc.states.get('e') || {}).progress > 0);
  const eEngine = splitOf('e')[0].child;
  svc.request(['f']);
  svc.prioritize('f', { now: true });
  await until(() => ready.has('f'));
  assert.ok(eEngine.killed, 'the running split of E was ended');
  assert.ok(!ready.has('e') || ready.get('f') < ready.get('e'), 'F was split before E');
  await until(() => ready.has('e'));
  assert.ok(ready.has('e'), 'E went back in line and finished after');
  const open = engines.filter((c) => !c.closed).map((c) => c.args[c.args.indexOf('--input') + 1].slice(-12));
  assert.ok(!open.length, 'nothing left running: ' + open);
  console.log('ok   jump ahead ends the running split');

  // 5. cancel ends the engine at once; the waited-for song runs at normal priority
  svc.request(['g']);
  await until(() => splitOf('g').length);
  const gEngine = splitOf('g')[0].child;
  assert.strictEqual(gEngine.args[gEngine.args.indexOf('--priority') + 1], 'normal', 'a split ahead runs at normal priority (it may become the song you wait for)');
  svc.cancel('g');
  await until(() => gEngine.closed, 2000);
  assert.ok(gEngine.killed, 'cancel ends the engine');
  await until(() => svc.status(songs.g).state === 'none', 2000);
  assert.strictEqual(svc.status(songs.g).state, 'none');
  jobMs = 300;
  svc.request(['h']);
  svc.prioritize('h', { now: true });
  await until(() => splitOf('h').length);
  const hEngine = splitOf('h')[0].child;
  assert.strictEqual(hEngine.args[hEngine.args.indexOf('--priority') + 1], 'normal', 'the song you wait for runs at normal priority');
  await until(() => ready.has('h'));
  assert.ok(ready.has('h'), 'the next song splits');
  console.log('ok   cancel ends the engine; splits run at normal priority');

  // 6. split ahead: songs picked in the list, at most a few waiting, never stopping a split
  jobMs = 1500;
  svc.request(['i']); // a running split
  await until(() => splitOf('i').length);
  const killedBefore = engines.filter((c) => c.killed).length;
  for (const id of ['j', 'k', 'b2', 'c', 'h']) svc.ahead(id); // (b2 isn't a song, h has stems)
  svc.ahead('f'); // has stems
  assert.deepStrictEqual(svc.queue.map((j) => j.songId), ['c', 'k', 'j'], `picked songs wait, newest first (${svc.queue.map((j) => j.songId)})`);
  songs.l = { id: 'l', title: 'L', length: 200 };
  songs.m = { id: 'm', title: 'M', length: 200 };
  svc.ahead('l');
  assert.deepStrictEqual(svc.queue.map((j) => j.songId), ['l', 'c', 'k'], `only the last 3 picks wait (${svc.queue.map((j) => j.songId)})`);
  assert.strictEqual(svc.status(songs.j).state, 'none', 'the oldest pick dropped out');
  svc.request(['m']);
  svc.prioritize('m', { now: true }); // opened to play: goes first, stops I
  svc.ahead('j');
  assert.strictEqual(svc.queue[0].songId, 'm', 'a song opened to play stays first');
  assert.strictEqual(svc.queue[1].songId, 'j', 'a new pick goes right after it');
  assert.strictEqual(engines.filter((c) => c.killed).length, killedBefore + 1, 'picking songs never stopped a split (only opening M did)');
  svc.request(['c']); // asked for: no longer a pick that can drop out
  assert.strictEqual(svc.queue.find((j) => j.songId === 'c').ahead, false);
  {
    const order = svc.queue.map((j) => j.songId);
    assert.ok(order.indexOf('c') < order.indexOf('j') && order.indexOf('c') < order.indexOf('l'), `a song you ask for goes before the picks (${order})`);
  }
  jobMs = 100;
  await until(() => ['m', 'j', 'l', 'c', 'i'].every((id) => ready.has(id)), 8000);
  assert.ok(ready.get('m') < ready.get('j'), 'the opened song was split first');
  console.log('ok   split ahead: picks wait behind the opened song, last 3 only, no split stopped');

  // 7. closing the app closes the engine; leftover work folders are cleaned at start
  svc.stopAll();
  await wait(50);
  assert.ok(engines.every((c) => c.closed), 'no engine left running after the app closes');
  console.log('ok   closing the app closes the engine');

  // 8. folders named after their songs; old key-named folders are renamed at start; lookups go by the key
  const { folderName } = require('../src/main/services/stems');
  assert.strictEqual(folderName({ artist: 'AC/DC', title: 'What? Me: Worry. ' }, 'abcdef0123456789abcdef01'), 'AC_DC - What_ Me_ Worry [abcdef01]');
  const keyB = 'b0b0b0b0b0b0b0b0b0b0b0b0';
  const oldDir = path.join(dir, keyB, 'htdemucs');
  fs.mkdirSync(oldDir, { recursive: true });
  for (const n of ['vocals', 'drums', 'bass', 'other']) fs.writeFileSync(path.join(oldDir, `${n}.flac`), 'x');
  fs.writeFileSync(path.join(oldDir, 'vocals.wav'), 'old');
  fs.writeFileSync(path.join(oldDir, 'meta.json'), JSON.stringify({ model: 'htdemucs', stems: ['vocals', 'drums', 'bass', 'other'], format: 'flac', sampleRate: 48000, frames: 48000 * 100, seconds: 50, device: 'cpu', createdAt: 1 }));
  fs.mkdirSync(path.join(dir, '.work', 'x'), { recursive: true });
  fs.mkdirSync(path.join(dir, keyB, 'htdemucs.abc123.work'), { recursive: true }); // where older versions left them
  const lib = { b: { id: 'b', title: 'Song: B', artist: 'Band', audioKey: keyB } };
  const svc2 = new StemService({ stemsDir: dir, audio, tools: {}, settings: { get: () => ({ stems: { model: 'htdemucs', cleared310: true } }), set() {} }, library: { get: (id) => lib[id], data: { songs: lib } }, engineScript: 'x.py', log: () => {} });
  await svc2.startup({ background: false });
  assert.ok(!fs.existsSync(path.join(dir, '.work', 'x')), 'unfinished splits are removed at start');
  assert.ok(!fs.existsSync(path.join(dir, keyB)), 'the key-named folder is gone');
  const named = path.join(dir, 'Band - Song_ B [b0b0b0b0]');
  assert.ok(fs.existsSync(path.join(named, 'htdemucs', 'vocals.flac')), `it was renamed after its song (${fs.readdirSync(dir)})`);
  assert.ok(!fs.existsSync(path.join(named, 'htdemucs.abc123.work')), 'an old leftover work folder is removed');
  assert.ok(!fs.existsSync(path.join(named, 'htdemucs', 'vocals.wav')), 'a leftover from a format switch is removed');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(named, 'htdemucs', 'meta.json'), 'utf8')).key, keyB, 'its meta.json records the whole key');
  const r = svc2.ready(lib.b);
  assert.ok(r && r.stems[0].url === `stagehand://stems/${keyB}/htdemucs/vocals.flac`, 'the stems are found by key, and their address is unchanged');
  assert.strictEqual(svc2.fileFor(keyB, 'htdemucs', 'vocals.flac'), path.join(named, 'htdemucs', 'vocals.flac'), 'the address leads to the named folder');
  assert.ok(svc2.rates.cpu.length > 0, 'past splits are remembered for the time-left guess');
  // a fresh start finds the named folder again by its meta.json
  const svc3 = new StemService({ stemsDir: dir, audio, tools: {}, settings: { get: () => ({ stems: { model: 'htdemucs', cleared310: true, tidied44: true } }), set() {} }, library: { get: (id) => lib[id], data: { songs: lib } }, engineScript: 'x.py', log: () => {} });
  await svc3.startup({ background: false });
  assert.ok(svc3.ready(lib.b), 'the named folder is found again at the next start');
  // new splits (above) went straight into named folders
  assert.ok(fs.existsSync(path.join(dir, `A [${keyOf('a').slice(0, 8)}]`, 'htdemucs', 'meta.json')), `new splits are stored by name (${fs.readdirSync(dir)})`);
  assert.ok(svc3.ready({ id: 'a', audioKey: keyOf('a') }), 'and found again too');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS stem queue');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
