'use strict';
/**
 * The Green Room (4.3): the shared meeting point, who's here, their clips, messages,
 * hiding someone, watching (the offer and answer), old messages kept, and the
 * meeting-point helpers. Uses a small stand-in for an ntfy server on localhost.
 *   node test/greenroom.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { GreenRoom, clipSummary, cleanClip } = require('../src/main/services/greenroom');
const { derive, seal, open, newAddress, isAddress, normCode, MAX_MSG } = require('../src/main/services/relay');
const { aboutClip } = require('../src/main/services/stats');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, what = 'it') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Just enough of ntfy: POST /<topic> publishes, GET /<topic>/json streams (open, then messages; ?since= replays). */
function fakeNtfy() {
  const subs = new Map();
  const posts = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const parts = u.pathname.split('/').filter(Boolean);
    if (req.method === 'POST' && parts.length === 1) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (body.length > 4096) return res.writeHead(413).end();
        const ev = { id: `m${++n}`, time: Math.floor(Date.now() / 1000), event: 'message', topic: parts[0], message: body };
        posts.push(ev);
        for (const s of subs.get(parts[0]) || []) s.write(`${JSON.stringify(ev)}\n`);
        res.end(JSON.stringify(ev));
      });
      return;
    }
    if (req.method === 'GET' && parts.length === 2 && parts[1] === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ id: 'o', event: 'open', time: Math.floor(Date.now() / 1000), topic: parts[0] })}\n`);
      const since = u.searchParams.get('since');
      if (since) {
        const mine = posts.filter((p) => p.topic === parts[0]);
        const at = mine.findIndex((p) => p.id === since);
        for (const p of at >= 0 ? mine.slice(at + 1) : /^m\d+$/.test(since) ? [] : mine) res.write(`${JSON.stringify(p)}\n`);
      }
      if (!subs.has(parts[0])) subs.set(parts[0], new Set());
      subs.get(parts[0]).add(res);
      req.on('close', () => subs.get(parts[0]).delete(res));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}`, posts })));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-greenroom-'));
let relay;
const rooms = [];
let roomName = 'TEST ROOM';
const TONE = { name: 'Crunchy', kind: 'guitar', gear: [{ slot: 'amp', key: 'plexi', knobs: { gain: 7 } }], ir: 'C:\\Users\\me\\cab.wav', capture: null, cabId: null };
function take(id, name, extra = {}) {
  return { id, kind: 'video', name, seconds: 42.5, bytes: 1234567, at: Date.now(), about: aboutClip({ song: { title: 'Paranoid', artist: 'Black Sabbath', official: false }, part: 'lead', tuning: 'E Standard', instrument: 'guitar', speed: 0.8, tone: TONE }), ...extra };
}
async function make(name, { clips = [], ...o } = {}) {
  const r = new GreenRoom({ file: path.join(tmp, `${name}.json`), fetchImpl: fetch, relays: [relay.url], listClips: async () => clips, room: roomName, ...o });
  await r.load();
  r.clipsList = clips;
  rooms.push(r);
  await until(() => r.state().inRoom && r.state().listening, 4000, `${name} at the meeting point`);
  return r;
}
const person = (r, name) => r.state().people.find((p) => p.name === name);

test('meeting point helpers: sealed messages, hidden addresses', () => {
  const a = newAddress();
  assert.ok(isAddress(a) && a.length === 26, a);
  assert.strictEqual(normCode(a), a, 'an address survives tidying');
  assert.notStrictEqual(newAddress(), a);
  const { topic, key } = derive(a);
  const box = seal(key, topic, { hi: 1 });
  assert.deepStrictEqual(open(key, topic, box), { hi: 1 });
  assert.strictEqual(open(derive(newAddress()).key, topic, box), null, 'the wrong key opens nothing');
  assert.strictEqual(open(key, 'other', box), null, 'a message moved to another topic opens nothing');
});

test('clip details: the tone travels without its cabinet file; anything odd is dropped', () => {
  const t = take('k_0123456789', 'Paranoid');
  assert.strictEqual(t.about.tone.ir, undefined, 'the cab file on this PC is not part of it');
  assert.strictEqual(t.about.tone.name, 'Crunchy');
  assert.strictEqual(t.about.part, 'lead');
  const s = clipSummary(t);
  assert.deepStrictEqual([s.song, s.artist, s.part, s.inst, s.tuning, s.speed, s.tone], ['Paranoid', 'Black Sabbath', 'lead', 'guitar', 'E Standard', 0.8, 'Crunchy']);
  assert.strictEqual(s.gear, undefined, 'the room only gets the tone name');
  assert.strictEqual(cleanClip({ id: '../../etc', title: 'x' }), null, 'a strange id is refused');
  const odd = cleanClip({ id: 'k_abcd', title: 'x'.repeat(500), part: 'kazoo', speed: 99, extra: 'nope' });
  assert.strictEqual(odd.title.length, 120);
  assert.strictEqual(odd.part, null);
  assert.strictEqual(odd.speed, null);
  assert.strictEqual(odd.extra, undefined);
  assert.strictEqual(aboutClip(null), null);
  assert.strictEqual(aboutClip({ part: 'jam' }).tone, null);
});

test('nobody sees you until you pick a name; then everyone does, with your clips', async () => {
  const alex = await make('alex', { clips: [take('k_aaaaaaaaaa', 'Paranoid solo')] });
  const bo = await make('bo');
  await sleep(300);
  assert.strictEqual(bo.state().people.length, 0, 'Alex has no name yet: not in the room');
  await assert.rejects(alex.setShared('k_aaaaaaaaaa', true), (e) => e.code === 'NO_NAME');
  await alex.setName('Alex');
  const p = await until(() => person(bo, 'Alex'), 4000, 'Bo to see Alex');
  assert.strictEqual(p.clips.length, 0);
  await alex.setShared('k_aaaaaaaaaa', true);
  const c = await until(() => (person(bo, 'Alex') || { clips: [] }).clips[0], 5000, 'the clip in the room');
  assert.strictEqual(c.title, 'Paranoid solo');
  assert.strictEqual(c.song, 'Paranoid');
  assert.strictEqual(c.tone, 'Crunchy');
  assert.ok(alex.isShared('k_aaaaaaaaaa'));
  // someone who opens Stagehand later sees Alex straight away (the meeting point keeps the last half hour)
  const cy = await make('cy');
  await until(() => person(cy, 'Alex') && person(cy, 'Alex').clips.length === 1, 4000, 'Cy to see Alex');
  // a name already in the room is refused (any capitals)
  await assert.rejects(bo.setName('alex'), (e) => e.code === 'NAME_TAKEN');
  await assert.rejects(bo.setName(' '), (e) => e.code === 'BAD_NAME');
  // the room never shows you to yourself
  assert.ok(!alex.state().people.some((x) => x.addr === alex.state().me));
  // turning a clip off takes it out of the room
  await alex.setShared('k_aaaaaaaaaa', false);
  await until(() => person(cy, 'Alex') && person(cy, 'Alex').clips.length === 0, 5000, 'the clip to leave the room');
  assert.ok(!alex.isShared('k_aaaaaaaaaa'));
  // "bye" when Stagehand closes
  await alex.close();
  await until(() => !person(bo, 'Alex') && !person(cy, 'Alex'), 4000, 'Alex to leave');
});

test('a big list of clips still fits in one message (newest kept)', async () => {
  const many = Array.from({ length: 30 }, (_, i) => take(`k_m${String(i).padStart(9, '0')}`, `Clip ${i} ${'with a long title '.repeat(5)}`, { at: 1000 + i }));
  const dee = await make('dee', { clips: many });
  await dee.setName('Dee');
  for (const t of many) await dee.setShared(t.id, true);
  const ed = await make('ed');
  const p = await until(() => person(ed, 'Dee') && person(ed, 'Dee').clips.length && person(ed, 'Dee'), 6000, 'Dee’s clips');
  assert.ok(p.clips.length >= 5 && p.clips.length <= 12, `${p.clips.length} clips`);
  assert.strictEqual(p.clips[0].id, many[29].id, 'newest first');
  const sizes = relay.posts.filter((x) => x.topic === derive(roomName).topic).map((x) => x.message.length);
  assert.ok(Math.max(...sizes) <= MAX_MSG, `largest message ${Math.max(...sizes)}`);
});

test('messages: about a clip, delivered, answered; you need a name to send', async () => {
  const fay = await make('fay');
  const gus = await make('gus');
  await fay.setName('Fay');
  await gus.setName('Gus');
  const fayAddr = await until(() => (person(gus, 'Fay') || {}).addr, 4000, 'Gus to see Fay');
  const got = new Promise((r) => fay.once('message', r));
  const sent = await gus.sendMessage(fayAddr, 'Nice solo!', { id: 'k_bbbbbbbbbb', title: 'Paranoid solo' });
  assert.ok(['sent', 'delivered'].includes(sent.state), sent.state);
  const m = await got;
  assert.strictEqual(m.name, 'Gus');
  assert.strictEqual(m.text, 'Nice solo!');
  const conv = fay.state().chats.find((c) => c.name === 'Gus');
  assert.strictEqual(conv.messages[0].about.title, 'Paranoid solo');
  await until(() => gus.state().chats[0].messages[0].state === 'delivered', 4000, 'Delivered');
  await fay.sendMessage(conv.addr, 'Thanks!');
  await until(() => gus.state().chats[0].messages.length === 2, 4000, 'the answer');
  // without a name you can read but not send
  const hal = await make('hal');
  await assert.rejects(hal.sendMessage(fayAddr, 'hi'), (e) => e.code === 'NO_NAME');
  // hiding someone: their messages aren't taken and they drop out of the room for you
  await fay.hide(conv.addr, true);
  assert.ok(!person(fay, 'Gus'), 'Gus is hidden on Fay’s PC');
  assert.ok(!fay.state().chats.some((c) => c.addr === conv.addr));
  let more = false;
  fay.on('message', () => (more = true));
  await gus.sendMessage(fayAddr, 'hello?');
  await sleep(800);
  assert.ok(!more, 'a hidden person’s message is ignored');
  assert.notStrictEqual(gus.state().chats[0].messages.pop().state, 'delivered', 'and no receipt goes back');
  await fay.hide(conv.addr, false);
  assert.ok(person(fay, 'Gus'));
});

test('watching: a request reaches their Stagehand only while they show something', async () => {
  const ivy = await make('ivy', { clips: [take('k_cccccccccc', 'Riff')] });
  const jo = await make('jo');
  await ivy.setName('Ivy');
  const addr = await until(() => (person(jo, 'Ivy') || {}).addr, 4000, 'Jo to see Ivy');
  await assert.rejects(jo.connect(addr, 'offer-sdp', { timeout: 1200 }), (e) => e.code === 'OFFLINE' && /Ivy/.test(e.message), 'nothing shown: no answer');
  await ivy.setShared('k_cccccccccc', true);
  ivy.once('offer', ({ conn, sdp }) => {
    assert.strictEqual(sdp, 'offer-sdp');
    ivy.answer(conn, 'answer-sdp');
  });
  const stages = [];
  assert.strictEqual(await jo.connect(addr, 'offer-sdp', { onStage: (s) => stages.push(s) }), 'answer-sdp');
  assert.deepStrictEqual(stages, ['relay', 'asking']);
});

test('old friends’ messages are kept to read; old shares and codes are not carried over', async () => {
  const oldFile = path.join(tmp, 'friends.json');
  fs.writeFileSync(oldFile, JSON.stringify({
    code: { plain: 'dominos2496' },
    name: 'Jake',
    sharing: true,
    shared: ['k_dddddddddd'],
    friends: [{ id: 'f_1', name: 'Ian', code: { plain: 'happy-tiger' } }],
    chats: [
      { id: 'a', with: normCode('happy-tiger'), dir: 'out', text: 'you there?', at: 1 },
      { id: 'b', with: normCode('happy-tiger'), dir: 'in', name: 'Ian', text: 'yep', at: 2 },
      { id: 'c', with: 'SOMEONEELSE1', dir: 'in', name: 'Kim', text: 'hi from Kim', at: 3 },
    ],
  }));
  const jake = await make('jake', { oldFile });
  const st = jake.state();
  assert.strictEqual(st.joined, false, 'not in the room until you pick a name');
  assert.strictEqual(st.suggest, 'Jake', 'the old name is offered');
  assert.deepStrictEqual(st.shared, [], 'nothing shown publicly that was only shared with friends');
  assert.deepStrictEqual(st.old.map((c) => [c.name, c.messages.length]), [['Ian', 2], ['Kim', 1]]);
  assert.ok(!JSON.stringify(st).includes('dominos'), 'the old code is gone');
  assert.ok(!fs.readFileSync(path.join(tmp, 'jake.json'), 'utf8').includes('dominos'));
  // reopened: the same address and the same old messages
  const again = new GreenRoom({ file: path.join(tmp, 'jake.json'), fetchImpl: fetch, relays: [relay.url], room: roomName });
  await again.load();
  rooms.push(again);
  assert.strictEqual(again.state().me, st.me);
  assert.strictEqual(again.state().old.length, 2);
});

test('someone who goes quiet has left (no "bye": their PC crashed)', async () => {
  roomName = 'QUIET ROOM';
  const kim = await make('kim', { beat: 60 * 60 * 1000 });
  const lee = await make('lee', { gone: 2 });
  await kim.setName('Kim');
  await until(() => person(lee, 'Kim'), 4000, 'Lee to see Kim');
  await sleep(2300);
  assert.ok(!person(lee, 'Kim'), 'gone after the quiet time');
});

(async () => {
  relay = await fakeNtfy();
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${name}\n     ${err.stack}`);
    }
  }
  for (const r of rooms) await r.close().catch(() => {});
  relay.server.closeAllConnections && relay.server.closeAllConnections();
  relay.server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed) {
    console.log(`${failed} failed`);
    process.exit(1);
  }
  console.log('PASS green room: who’s here, clips, messages, hiding, watching, old messages');
})();
