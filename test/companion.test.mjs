// The Quest companion's bridge (4.16): pairing, reconnecting, the library, song picks,
// the PC's clock reaching a headset in time, and nothing listening when it's off.
// Runs the real server (https + WebSocket) on this machine with a made-up library.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ClockSync, SongClock } from '../src/companion/clock.js';

const require = createRequire(import.meta.url);
const { Companion, lanAddresses } = require('../src/main/services/companion.js');
const wsl = require('../src/main/core/wsserver.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const nowMs = () => performance.timeOrigin + performance.now();

function makeStore(init = {}) {
  let data = { on: false, port: 0, devices: [], ...init };
  const { merge } = require('../src/main/services/settings.js');
  return { get: () => data, set: (p) => (data = merge(data, p)), raw: () => data };
}
const SONGS = [
  { id: 's1', title: 'Sugar', artist: 'Band A', arrangements: [{ id: 'a1', type: 'lead', name: 'Lead' }, { id: 'a2', type: 'bass', name: 'Bass' }, { id: 'v', type: 'vocals' }], length: 201 },
  { id: 's2', title: 'Another', artist: 'Aardvark', arrangements: [{ id: 'b1', type: 'combo', name: 'Combo' }], length: 150 },
  { id: 's3', title: 'Talk only', artist: 'Z', arrangements: [] },
];

function makeCompanion(store, extra = {}) {
  return new Companion({
    pageDir: path.join(here, '..', 'src', 'companion'),
    fontDir: path.join(here, '..', 'src', 'renderer', 'fonts'),
    store,
    port: 0,
    host: '127.0.0.1',
    songs: () => SONGS,
    loadTab: async (songId, arrId) => {
      if (songId !== 's1') throw new Error('That song is no longer in the library');
      return { id: arrId, type: 'lead', notes: [{ t: 1, s: 0, f: 3 }], beats: [] };
    },
    version: 'test',
    ...extra,
  });
}

/** A headset: a WebSocket client over https that trusts the PC's own certificate. */
function headset(port, ca) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path: '/ws', ca, servername: 'localhost', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64') } });
    req.on('upgrade', (res, socket) => {
      const conn = new wsl.Connection(socket, { mask: true });
      const inbox = [];
      const waiters = [];
      conn.on('message', (m) => {
        const i = waiters.findIndex((w) => w.test(m));
        if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
        else inbox.push(m);
      });
      const next = (type, ms = 3000) =>
        new Promise((res2, rej2) => {
          const test = (m) => (typeof type === 'function' ? type(m) : m.type === type);
          const i = inbox.findIndex(test);
          if (i >= 0) return res2(inbox.splice(i, 1)[0]);
          const t = setTimeout(() => rej2(new Error(`no ${typeof type === 'string' ? type : 'message'} within ${ms} ms`)), ms);
          waiters.push({ test, resolve: (m) => (clearTimeout(t), res2(m)) });
        });
      const closed = new Promise((r) => conn.on('close', r));
      resolve({ conn, next, inbox, closed, send: (m) => conn.send(m) });
    });
    req.on('response', (res) => reject(new Error(`no upgrade: ${res.statusCode}`)));
    req.on('error', reject);
    req.end();
  });
}
function get(port, ca, p) {
  return new Promise((resolve, reject) => {
    https.get({ host: '127.0.0.1', port, path: p, ca, servername: 'localhost' }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(parts) }));
    }).on('error', reject);
  });
}
const portOpen = (port) =>
  new Promise((r) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => (s.destroy(), r(true)));
    s.on('error', () => r(false));
  });

test('off: nothing listens until the switch is on', async () => {
  const store = makeStore();
  const c = makeCompanion(store);
  assert.equal(c.running, false);
  assert.equal(c.status().on, false);
  c.setState({ songId: 's1', t: 3, playing: true }); // the PC carries on as ever: no error, nobody to tell
  c.judged({ t: 1, hit: true });
  c.libraryChanged();
  assert.equal(c.server, null);
});

test('pairing once, then reconnecting by itself; the page and covers', async () => {
  const store = makeStore();
  const c = makeCompanion(store, { cover: async (id) => (id === 's1' ? path.join(here, '..', 'src', 'companion', 'style.css').replace('style.css', 'index.html') : null) });
  const st = await c.start();
  assert.equal(st.on, true);
  assert.match(st.code, /^\d{4}$/);
  const ca = store.raw().cert.cert;
  const port = c.port;
  assert.ok(await portOpen(port));

  // the page is served to anyone on the network (it holds nothing), with the PC's own certificate
  const page = await get(port, ca, '/');
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /Stagehand/);
  assert.equal((await get(port, ca, '/app/app.js')).status, 200);
  assert.equal((await get(port, ca, '/app/../../main/main.js')).status, 404);
  assert.equal((await get(port, ca, '/fonts/Archivo-Variable.ttf')).status, 200);
  // covers need the key
  assert.equal((await get(port, ca, '/cover/s1')).status, 403);

  // a new headset: asked for the code; a wrong one is refused
  let q = await headset(port, ca);
  q.send({ type: 'hello', token: null, name: 'Quest 3' });
  await q.next('pair-needed');
  q.send({ type: 'library' });
  await q.next('pair-needed'); // nothing before pairing
  q.send({ type: 'pair', code: st.code === '0000' ? '0001' : '0000', name: 'Quest 3' });
  const wrong = await q.next('pair-wrong');
  assert.equal(wrong.left, 4);
  q.send({ type: 'pair', code: st.code, name: 'Quest 3' });
  const w = await q.next('welcome');
  assert.ok(w.token && w.token.length > 20);
  assert.equal(w.device.name, 'Quest 3');
  const lib = await q.next('library');
  assert.deepEqual(lib.songs.map((s) => s.title), ['Another', 'Sugar']); // by artist; the song without parts is left out
  assert.deepEqual(lib.songs[1].parts.map((p) => p.type), ['lead', 'bass']);
  assert.equal(lib.songs[0].parts[0].type, 'lead'); // combo reads as lead
  // the PC keeps only a hash of the key
  assert.equal(store.raw().devices.length, 1);
  assert.ok(!JSON.stringify(store.raw()).includes(w.token));
  assert.equal(c.status().clients, 1);
  assert.equal((await get(port, ca, `/cover/s1?k=${w.token}`)).status, 200);

  // the headset's own things kept on the PC (its piano position): back on the next visit
  q.send({ type: 'save', key: 'piano', value: { a: [0, 0.8, -0.4], b: [1.2, 0.8, -0.4] }, req: 7 });
  assert.equal((await q.next('saved')).req, 7);
  q.conn.close();
  await q.closed;

  // put the headset on again: the key is enough, no code
  q = await headset(port, ca);
  q.send({ type: 'hello', token: w.token, name: 'Quest 3' });
  const w2 = await q.next('welcome');
  assert.equal(w2.device.id, w.device.id);
  assert.deepEqual(w2.device.data.piano.b, [1.2, 0.8, -0.4]);
  assert.equal(w2.token, undefined);

  // switch off and on (Stagehand restarted): same port, same certificate, still paired
  q.conn.close();
  await c.stop();
  assert.equal(await portOpen(port), false);
  await c.start();
  assert.equal(store.raw().cert.cert, ca, 'the certificate is kept, so the headset doesn’t ask again');
  q = await headset(c.port, ca);
  q.send({ type: 'hello', token: w.token });
  await q.next('welcome');

  // forgotten on the PC: let go now, and asked for the code next time
  const closed = q.closed;
  c.forget(w.device.id);
  await closed;
  q = await headset(c.port, ca);
  q.send({ type: 'hello', token: w.token });
  await q.next('pair-needed');
  q.conn.close();
  await c.stop();
});

test('too many wrong codes: a minute’s wait', async () => {
  const store = makeStore({ code: '4821' });
  const c = makeCompanion(store);
  await c.start();
  const q = await headset(c.port, store.raw().cert.cert);
  for (let i = 0; i < 5; i++) {
    q.send({ type: 'pair', code: String(1000 + i) });
    await q.next('pair-wrong');
  }
  q.send({ type: 'pair', code: '4821' });
  const wait = await q.next('pair-wait');
  assert.ok(wait.seconds > 50 && wait.seconds <= 60);
  c.newCode(); // a new code clears the wait
  q.send({ type: 'pair', code: store.raw().code });
  await q.next('welcome');
  q.conn.close();
  await c.stop();
});

test('songs both ways: a pick goes to the PC, the PC’s song and clock reach the headset in time', async () => {
  const store = makeStore({ code: '1234' });
  const c = makeCompanion(store);
  const commands = [];
  c.on('command', (m) => commands.push(m));
  await c.start();
  const ca = store.raw().cert.cert;
  const q = await headset(c.port, ca);
  q.send({ type: 'pair', code: '1234', name: 'Quest 3' });
  await q.next('welcome');

  // picked on the headset: Stagehand on the PC is told
  q.send({ type: 'pick', songId: 's1', arrId: 'a2' });
  q.send({ type: 'pause' });
  q.send({ type: 'seek', t: 42.5 });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(commands.map((m) => [m.type, m.songId, m.arrId, m.t]), [['pick', 's1', 'a2', undefined], ['pause', undefined, undefined, undefined], ['seek', undefined, undefined, 42.5]]);

  // a chart on request (a few KB), and a clear answer for a song that's gone
  q.send({ type: 'tab', songId: 's1', arrId: 'a2', req: 1 });
  const tab = await q.next('tab');
  assert.equal(tab.tab.notes.length, 1);
  q.send({ type: 'tab', songId: 'gone', req: 2 });
  assert.match((await q.next('tab')).error, /no longer/);

  // the clock: the headset's clock is 5 s off the PC's (different machines), and
  // the network is slow one way; it still knows where the song is within 15 ms
  const skew = -5000;
  const sync = new ClockSync();
  const local = () => nowMs() + skew;
  for (let i = 0; i < 10; i++) {
    q.send({ type: 'ping', c: local() });
    const p = await q.next('pong');
    sync.add(p.c, p.s, local());
  }
  assert.ok(sync.ready);
  assert.ok(Math.abs(sync.offset - -skew) < 15, `offset off by ${Math.abs(sync.offset + skew).toFixed(1)} ms`);

  // the PC plays: its window sends the clock 30 times a second (as the real one does)
  const song = new SongClock(sync);
  const t0 = nowMs();
  const truth = (at) => 10 + (at - t0) / 1000; // the song started at 10 s
  let errs = [];
  const tick = setInterval(() => {
    const at = nowMs();
    c.setState({ songId: 's1', arrId: 'a1', part: 'lead', t: truth(at), at, playing: true, speed: 1, dur: 201 });
  }, 33);
  const songMsg = await q.next('song');
  assert.equal(songMsg.songId, 's1');
  const deadline = Date.now() + 1200;
  while (Date.now() < deadline) {
    const m = await q.next('state');
    song.set(m);
    const now = local();
    errs.push(Math.abs(song.at(now) - truth(now - skew)) * 1000);
    await new Promise((r) => setTimeout(r, 5));
  }
  clearInterval(tick);
  errs = errs.slice(5);
  const worst = Math.max(...errs);
  assert.ok(worst < 15, `the headset's song clock was up to ${worst.toFixed(1)} ms off`);

  // paused: the clock stands still where the PC says
  c.setState({ songId: 's1', arrId: 'a1', t: 33.3, at: nowMs(), playing: false });
  const ps = await q.next((m) => m.type === 'state' && !m.playing);
  song.set(ps);
  assert.equal(song.at(local() + 500), 33.3);

  // judged notes and a changed library are passed on
  c.judged({ t: 12.5, hit: true, notes: [{ s: 1, f: 3 }] });
  const j = await q.next('judged');
  assert.equal(j.hit, true);
  c.libraryChanged();
  await q.next('library', 2500);
  q.conn.close();
  await c.stop();
});

test('the song clock is smooth between messages and snaps on a seek', () => {
  const sync = new ClockSync();
  sync.add(0, 1000, 10); // PC is 995 ms ahead
  sync.add(20, 1020, 30);
  sync.add(40, 1040, 50);
  const sc = new SongClock(sync);
  sc.set({ songId: 'x', t: 5, at: 1100, playing: true, speed: 1 });
  const a = sc.at(105); // PC time 1100
  assert.ok(Math.abs(a - 5) < 0.001);
  const b = sc.at(205);
  assert.ok(Math.abs(b - 5.1) < 0.002);
  // a seek: the new place at once
  sc.set({ songId: 'x', t: 60, at: 1210, playing: true, speed: 1 });
  assert.ok(Math.abs(sc.at(215) - 60) < 0.001);
  // half speed
  sc.set({ songId: 'x', t: 60, at: 1210, playing: true, speed: 0.5 });
  assert.ok(Math.abs(sc.target(1215) - 60.5) < 0.001);
});

test('the home network address is picked over virtual adapters', () => {
  const a = lanAddresses({
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.80.1', internal: false }],
    Ethernet: [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    'Wi-Fi': [{ family: 'IPv4', address: '169.254.3.4', internal: false }],
  });
  assert.equal(a[0].address, '192.168.1.20');
  assert.equal(a.length, 2);
});
