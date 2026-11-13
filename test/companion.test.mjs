// 4.16: the Quest companion's bridge: off until switched on, pairing, remembering, the song clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PcClock, songPos } from '../src/companion/clock.js';
const require = createRequire(import.meta.url);
const { Companion, nowMs } = require('../src/main/services/companion.js');
const { Settings } = require('../src/main/services/settings.js');
const { makeCert } = require('../src/main/core/selfcert.js');
const ws = require('../src/main/core/ws.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); // a real path on Windows too
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-quest-'));
const SONGS = [
  { id: 's1', title: 'Sugar', artist: 'System Of A Down', arrangements: [{ type: 'lead' }, { type: 'bass' }, { type: 'vocals' }], length: 151 },
  { id: 's2', title: 'Aerials', artist: 'System Of A Down', arrangements: [{ type: 'rhythm' }], length: 235 },
];
const library = { songs: () => SONGS, get: (id) => SONGS.find((s) => s.id === id) || null };

async function make(port = 0) {
  const settings = new Settings(path.join(tmp, `settings-${crypto.randomBytes(3).toString('hex')}.json`));
  await settings.load();
  settings.set({ companion: { port } });
  const c = new Companion({ dir: path.join(tmp, 'Quest'), settings, library, staticDir: path.join(ROOT, 'src/companion'), rendererDir: path.join(ROOT, 'src/renderer'), version: 'test', pcName: 'STAGE-PC' });
  return { c, settings };
}
const ca = () => fs.readFileSync(path.join(tmp, 'Quest', 'companion-cert.pem'), 'utf8');
const get = (port, p) =>
  new Promise((resolve, reject) => {
    https.get({ host: '127.0.0.1', port, path: p, ca: ca(), servername: 'localhost' }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b, type: res.headers['content-type'] }));
    }).on('error', reject);
  });

/** A pretend headset: a socket and a queue of what the PC said. */
async function headset(port) {
  const conn = await ws.connect(`wss://127.0.0.1:${port}/ws`, { ca: ca() });
  const inbox = [];
  const waiters = [];
  conn.on('message', (t) => {
    const m = JSON.parse(t);
    const i = waiters.findIndex((w) => w.type === m.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });
  return {
    conn,
    send: (m) => conn.send(JSON.stringify(m)),
    next: (type, ms = 2000) => {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { type, resolve };
        waiters.push(w);
        setTimeout(() => (waiters.includes(w) && waiters.splice(waiters.indexOf(w), 1), reject(new Error(`no ${type}`))), ms);
      });
    },
    drop: (type) => { for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].type === type) inbox.splice(i, 1); },
  };
}

test('its own certificate: a real one a browser can use, made once and kept', () => {
  const r = makeCert({ names: ['192.168.1.20', 'STAGE-PC'] });
  const x = new crypto.X509Certificate(r.cert);
  assert.ok(x.verify(x.publicKey), 'signed with its own key');
  assert.match(x.subjectAltName, /IP Address:192\.168\.1\.20/);
  assert.ok(new Date(x.validTo) - Date.now() > 3000 * 24 * 3600e3, 'lasts years');
});

test('off until switched on: nothing listens on the network', async () => {
  const { c, settings } = await make();
  assert.equal(settings.get().companion.on, false, 'off by default');
  await c.startup();
  assert.equal(c.server, null);
  assert.equal(c.status().on, false);
  assert.equal(c.status().code, null);
  c.pushState({ pos: 1, playing: true }); // the page telling it things changes nothing
  c.libraryChanged();
  assert.equal(c.server, null);
});

test('pairing, remembering, the library and the song both ways', async () => {
  const { c, settings } = await make();
  const st = await c.setOn(true);
  assert.equal(st.on, true);
  assert.equal(settings.get().companion.on, true, 'remembered as on');
  assert.match(st.code, /^\d{4}$/);
  const port = st.port;
  // the page is served, nothing outside it is
  const page = await get(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /Stagehand/);
  assert.equal((await get(port, '/app.js')).status, 200);
  assert.equal((await get(port, '/fonts/Archivo-Variable.ttf')).status, 200);
  assert.equal((await get(port, '/..%2F..%2Fpackage.json')).status, 404);
  assert.equal((await get(port, '/art/s1')).status, 404, 'covers need the key');

  // a new headset: no key yet, asked for the code
  const q = await headset(port);
  q.send({ type: 'hello', token: null, name: 'Meta Quest 3' });
  await q.next('need-code');
  q.send({ type: 'pick', id: 's1' });
  q.send({ type: 'pair', code: c.code === '0000' ? '0001' : '0000', name: 'Meta Quest 3' });
  const bad = await q.next('bad-code');
  assert.equal(bad.left, 4);
  const code = c.code;
  q.send({ type: 'pair', code, name: 'Meta Quest 3' });
  const w = await q.next('welcome');
  assert.ok(w.token && w.token.length > 20, 'gets a key to keep');
  assert.equal(w.pc.name, 'STAGE-PC');
  assert.notEqual(c.code, code, 'a code works once');
  const lib = await q.next('library');
  assert.deepEqual(lib.songs.map((s) => s.title), ['Aerials', 'Sugar'], 'sorted by artist then title');
  assert.deepEqual(lib.songs[1].parts, ['lead', 'bass', 'vocals']);
  const dev = settings.get().companion.devices;
  assert.equal(dev.length, 1);
  assert.equal(dev[0].name, 'Meta Quest 3');
  assert.ok(!JSON.stringify(dev).includes(w.token), 'the PC keeps only a fingerprint of the key');
  assert.equal(c.status().clients, 1);

  // picks and buttons go to the page on the PC
  const cmds = [];
  c.on('cmd', (m) => cmds.push(m));
  q.send({ type: 'pick', id: 'nope' });
  q.send({ type: 'pick', id: 's1' });
  q.send({ type: 'toggle' });
  q.send({ type: 'seek', t: 42.5 });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(cmds.map((m) => m.type), ['pick', 'toggle', 'seek'], 'an unknown song is ignored');
  assert.equal(cmds[2].t, 42.5);

  // the PC's song reaches the headset
  c.pushState({ song: { id: 's1', title: 'Sugar', artist: 'System Of A Down', length: 151 }, pos: 12.5, playing: true, speed: 0.8, at: nowMs() });
  const s = await q.next('state');
  assert.equal(s.song.id, 's1');
  assert.equal(s.speed, 0.8);

  // close the headset; it comes back with its key and needs no code
  q.conn.close();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(c.status().clients, 0);
  const q2 = await headset(port);
  q2.send({ type: 'hello', token: w.token, name: 'Meta Quest 3' });
  const w2 = await q2.next('welcome');
  assert.equal(w2.token, undefined, 'no new key');
  await q2.next('library');
  const s2 = await q2.next('state');
  assert.equal(s2.song.id, 's1', 'it hears where the song is straight away');
  assert.equal((await get(port, `/art/s1?k=${encodeURIComponent(w.token)}`)).status, 404, 'with the key the cover is looked for (none here)');

  // the PC restarts: the same certificate, the headset still known
  const cert1 = ca();
  await c.setOn(false);
  assert.equal(c.server, null);
  assert.equal(settings.get().companion.on, false);
  await c.setOn(true);
  assert.equal(ca(), cert1, 'the same certificate (the browser asks only once)');
  const q3 = await headset(c.port);
  q3.send({ type: 'hello', token: w.token });
  await q3.next('welcome');

  // forget it on the PC: the key stops working
  c.forget(dev[0].id);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(settings.get().companion.devices.length, 0);
  const q4 = await headset(c.port);
  q4.send({ type: 'hello', token: w.token });
  await q4.next('need-code');
  await c.stop();
});

test('guessing the code gets nowhere: five wrong and it changes', async () => {
  const { c } = await make();
  await c.setOn(true);
  const q = await headset(c.port);
  const first = c.code;
  let last;
  for (let i = 0; i < 5; i++) {
    q.send({ type: 'pair', code: String((Number(first) + 1 + i) % 10000).padStart(4, '0') });
    last = await q.next('bad-code');
  }
  assert.equal(last.changed, true);
  assert.notEqual(c.code, first);
  q.send({ type: 'pair', code: first });
  const after = await q.next('bad-code');
  assert.equal(after.left, 4, 'the old code no longer works');
  await c.stop();
});

test('the song clock: the headset is within 15 ms of the PC', async () => {
  const { c } = await make();
  await c.setOn(true);
  for (const skew of [0, -5000, 73000]) {
    // a headset whose clock is off by `skew` ms
    const clock = new PcClock({ now: () => nowMs() + skew });
    const q = await headset(c.port);
    for (let i = 0; i < 12; i++) {
      const t0 = clock.now();
      q.send({ type: 'ping', id: i, t0 });
      const p = await q.next('pong');
      clock.add(p.t0, clock.now(), p.pc);
    }
    assert.ok(Math.abs(clock.pcNow() - nowMs()) < 15, `PC clock guessed within 15 ms (off by ${(clock.pcNow() - nowMs()).toFixed(2)} ms, skew ${skew})`);
    // the PC plays from 30 s at 80 %; 300 ms later the headset says the song is at 30.24 s
    const at = nowMs();
    const st = { song: { id: 's1', length: 151 }, pos: 30, playing: true, speed: 0.8, at };
    await new Promise((r) => setTimeout(r, 300));
    const truth = 30 + ((nowMs() - at) / 1000) * 0.8;
    assert.ok(Math.abs(songPos(st, clock.pcNow()) - truth) < 0.015, 'song position within 15 ms');
    q.conn.close();
  }
  // paused: it stays put; it never runs past the end
  assert.equal(songPos({ pos: 12, playing: false, at: 0 }, 99999), 12);
  assert.equal(songPos({ song: { length: 100 }, pos: 99.9, playing: true, speed: 1, at: 0 }, 5000), 100);
  await c.stop();
});

test('a slow answer on the network does not move the clock', () => {
  let t = 1000;
  const clock = new PcClock({ now: () => t });
  for (let i = 0; i < 6; i++) clock.add(t, t + 4, t + 2 + 500); // PC 500 ms ahead, 4 ms round trips
  assert.ok(Math.abs(clock.offset - 500) < 0.5);
  clock.add(t, t + 300, t + 500 + 290); // held up on the way back: would say 640
  assert.ok(Math.abs(clock.offset - 500) < 0.5, `ignored (${clock.offset})`);
});

// ---------------------------------------------------------------- step 2: the notes in VR --
const { prepChart, nearTargets, anchorAt, level, Marks, sectionAt } = await import('../src/companion/chart.js');
const CHART = {
  song: 's1', part: 'lead', strings: 6, lowTop: true,
  beats: [[0, 0], [0.5, -1], [1, -1], [1.5, -1], [2, 1]],
  sections: [['intro', 0, 8], ['verse', 8, 30]],
  anchors: [[0, 4, 1, 4], [4, 9, 7, 5]],
  targets: [
    { i: 0, t: 1, d: 0, k: 'n', n: [[0, 3, 0, 0, -1, 0]] },
    { i: 1, t: 2, d: 3, k: 'n', n: [[2, 5, 3, 0, -1, 0]] }, // held 3 s
    { i: 2, t: 5.1, d: 0, k: 'c', c: 'G5', n: [[0, 3, 0, 0, -1, 0], [1, 5, 0, 0, -1, 0]] },
    { i: 3, t: 20, d: 0, k: 'n', n: [[5, 0, 0, 0, -1, 0]] },
  ],
};

test('the VR highway: which notes are near, where the hand is, the string order', () => {
  const ch = prepChart(CHART);
  assert.equal(ch.maxHold, 3);
  assert.deepEqual(nearTargets(ch, 0, 4).map((x) => x.i), [0, 1], 'the next 4 s');
  assert.deepEqual(nearTargets(ch, 4.5, 4, 0.4).map((x) => x.i), [1, 2], 'a note still held stays (2 s + 3 s held)');
  assert.deepEqual(nearTargets(ch, 6, 4, 0.4).map((x) => x.i), [], 'played and gone; the next is far off');
  assert.deepEqual(anchorAt(ch, 1), { fret: 1, width: 4 });
  assert.deepEqual(anchorAt(ch, 5), { fret: 7, width: 5 });
  assert.equal(level(ch, 0), 5, 'low E on top');
  assert.equal(level({ ...ch, lowTop: false }, 0), 0, 'high e on top');
  assert.equal(sectionAt(ch, 9), 'verse');
});

test('hits and misses from the PC: kept, started over, sparks only for new hits', () => {
  const m = new Marks();
  m.apply({ hits: 1, judged: 2, streak: 1, best: 1, ev: [[0, 1], [1, 0]] }, 10);
  assert.equal(m.get(0), 1);
  assert.equal(m.get(1), 0);
  assert.equal(m.flashes.length, 1, 'a spark for the hit, none for the miss');
  m.apply({ hits: 1, judged: 2, streak: 1, best: 1, ev: [] });
  assert.equal(m.get(0), 1, 'kept between messages');
  m.apply({ hits: 0, judged: 0, streak: 0, best: 1, ev: [], reset: true });
  assert.equal(m.get(0), undefined, 'a seek starts over');
  m.apply({ off: true });
  assert.equal(m.score, null, 'no guitar: no score');
});

test('a headset joining mid-song gets the notes and every mark so far', async () => {
  const { c } = await make();
  await c.setOn(true);
  const a = await headset(c.port);
  a.send({ type: 'pair', code: c.code, name: 'Quest A' });
  const w = await a.next('welcome');
  c.pushChart(CHART);
  const got = await a.next('chart');
  assert.equal(got.targets.length, 4);
  c.pushState({ song: { id: 's1', length: 30 }, pos: 2.5, playing: true, at: nowMs(), judge: { hits: 1, judged: 2, streak: 0, best: 1, ev: [[0, 1], [1, 0]], reset: true } });
  c.pushState({ song: { id: 's1', length: 30 }, pos: 2.6, playing: true, at: nowMs(), judge: { hits: 1, judged: 2, streak: 0, best: 1, ev: [] } });
  // the same headset again, as if it had just come back
  const b = await headset(c.port);
  b.send({ type: 'hello', token: w.token });
  await b.next('welcome');
  const ch = await b.next('chart');
  assert.equal(ch.song, 's1');
  const st = await b.next('state');
  assert.deepEqual(st.judge.ev, [[0, 1], [1, 0]], 'the marks so far');
  assert.equal(st.judge.reset, true);
  // the files the VR page needs are served: the 3D library and a venue picture
  assert.equal((await get(c.port, '/three/three.module.min.js')).status, 200);
  assert.equal((await get(c.port, '/vr.js')).status, 200);
  await c.stop();
});
