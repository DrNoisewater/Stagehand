// 4.19: everything from inside the headset reaches the PC: the song's parts listed, a part picked,
// start over, the speed; a headset joining late hears the parts too. Real server, pretend headset.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { Companion, nowMs, partList } = require('../src/main/services/companion.js');
const { Settings } = require('../src/main/services/settings.js');
const ws = require('../src/main/core/ws.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-quest-parts-'));
const SONGS = [
  { id: 's1', title: 'Sugar', artist: 'System Of A Down', arrangements: [{ type: 'lead' }, { type: 'rhythm' }, { type: 'bass' }], length: 151, addedAt: 50, user: { lastPlayed: 900 } },
  { id: 's2', title: 'Aerials', artist: 'System Of A Down', arrangements: [{ type: 'bass' }], length: 235 },
];
const library = { songs: () => SONGS, get: (id) => SONGS.find((s) => s.id === id) || null };
const PARTS = { song: 's1', list: [{ id: 'arr-lead', name: 'Lead', type: 'lead' }, { id: 'arr-rhy', name: 'Rhythm', type: 'rhythm' }, { id: 'arr-bass', name: 'Bass', type: 'bass' }, { id: 'arr-alt', name: 'Alt. Bass', type: 'bass', bonus: true }] };
const SUGAR = { id: 's1', title: 'Sugar', artist: 'System Of A Down', length: 151 };

async function make() {
  const settings = new Settings(path.join(tmp, `settings-${crypto.randomBytes(3).toString('hex')}.json`));
  await settings.load();
  settings.set({ companion: { port: 0 } });
  const c = new Companion({ dir: path.join(tmp, 'Quest'), settings, library, staticDir: path.join(ROOT, 'src/companion'), rendererDir: path.join(ROOT, 'src/renderer'), version: 'test', pcName: 'STAGE-PC' });
  await c.setOn(true);
  return c;
}
async function headset(c) {
  const ca = fs.readFileSync(path.join(tmp, 'Quest', 'companion-cert.pem'), 'utf8');
  const conn = await ws.connect(`wss://127.0.0.1:${c.port}/ws`, { ca });
  const inbox = [];
  conn.on('message', (t) => inbox.push(JSON.parse(t)));
  const q = {
    conn,
    inbox,
    send: (m) => conn.send(JSON.stringify(m)),
    async next(type, ms = 2000) {
      const end = Date.now() + ms;
      for (;;) {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) return inbox.splice(i, 1)[0];
        if (Date.now() > end) throw new Error(`no ${type}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  };
  q.send({ type: 'hello', token: null, name: 'Meta Quest 3' });
  await q.next('need-code');
  q.send({ type: 'pair', code: c.code, name: 'Meta Quest 3' });
  const w = await q.next('welcome');
  q.token = w.token;
  return q;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the parts list: tidied, limited, kept to its song', () => {
  assert.equal(partList(null), null);
  const long = { song: 's1', list: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: 'N'.repeat(100), type: 'lead', tuning: 'Drop D' })) };
  long.list.unshift({ id: 'x'.repeat(200), name: 'Too long a name to match' }, null, { id: 5 });
  const p = partList(long);
  assert.equal(p.song, 's1');
  assert.equal(p.list.length, 12);
  assert.equal(p.list[0].id, 'p0', 'one that could never be matched is left out');
  assert.ok(p.list[0].name.length <= 40);
  assert.equal(p.list[0].tuning, 'Drop D');
});

test('the headset hears the parts, picks one, starts over and changes the speed', async () => {
  const c = await make();
  const q = await headset(c);
  const lib = await q.next('library');
  const sugar = lib.songs.find((s) => s.id === 's1');
  assert.equal(sugar.played, 900, 'when it was last played (for the Recent list)');
  assert.equal(sugar.added, 50);
  const cmds = [];
  c.on('cmd', (m) => cmds.push(m));

  // before the PC has listed the parts, a part can't be picked
  q.send({ type: 'part', id: 'arr-bass' });
  await wait(100);
  assert.equal(cmds.length, 0);

  c.pushState({ song: SUGAR, pos: 10, playing: true, speed: 1, at: nowMs(), partId: 'arr-lead', parts: PARTS });
  const s = await q.next('state');
  assert.equal(s.partId, 'arr-lead');
  assert.equal(s.parts.list.length, 4, 'every part, not just one');
  assert.deepEqual(s.parts.list.map((p) => p.type), ['lead', 'rhythm', 'bass', 'bass']);
  // the 30-a-second updates don't repeat the list
  c.pushState({ song: SUGAR, pos: 10.1, playing: true, speed: 1, at: nowMs(), partId: 'arr-lead' });
  const s2 = await q.next('state');
  assert.equal(s2.parts, undefined);

  q.send({ type: 'part', id: 'arr-nope' });
  q.send({ type: 'part', id: 'arr-bass' });
  q.send({ type: 'restart' });
  q.send({ type: 'speed', to: 0.7 });
  q.send({ type: 'speed', to: 9 });
  q.send({ type: 'speed', to: 'fast' });
  q.send({ type: 'pause' });
  q.send({ type: 'play' });
  q.send({ type: 'seek', t: 30 });
  await wait(200);
  assert.deepEqual(cmds, [
    { type: 'part', id: 'arr-bass' },
    { type: 'seek', t: 0 },
    { type: 'speed', to: 0.7 },
    { type: 'speed', to: 1.5 },
    { type: 'pause' },
    { type: 'play' },
    { type: 'seek', t: 30 },
  ], 'an unknown part and a speed that is not a number are ignored; too fast is held at 150%');

  // a headset joining now hears the parts straight away
  const q2 = await headset(c);
  const s3 = await q2.next('state');
  assert.equal(s3.parts && s3.parts.list.length, 4);
  assert.equal(s3.partId, 'arr-lead');

  // another song: the old parts are gone (no picking Sugar's bass while Aerials plays)
  c.pushState({ song: { id: 's2', title: 'Aerials', artist: 'System Of A Down', length: 235 }, pos: 0, playing: false, speed: 1, at: nowMs(), partId: 'x' });
  await wait(50);
  cmds.length = 0;
  q.send({ type: 'part', id: 'arr-bass' });
  await wait(100);
  assert.equal(cmds.length, 0);
  await c.stop();
});
