'use strict';
/**
 * Friends (3.10): codes, sealing, and the offer/answer through a relay
 * (a small stand-in for an ntfy server on localhost).
 *   node test/friends.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Friends, Subscription, normCode, validCode, prettyCode, derive, seal, open, newCode, relayList } = require('../src/main/services/friends');

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** Just enough of ntfy: POST /<topic> publishes, GET /<topic>/json streams (open, then messages). */
function fakeNtfy() {
  const subs = new Map();
  const posts = [];
  let n = 0;
  let gets = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const parts = u.pathname.split('/').filter(Boolean);
    if (req.method === 'POST' && parts.length === 1) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const ev = { id: `m${++n}`, time: Math.floor(Date.now() / 1000), event: 'message', topic: parts[0], message: body };
        posts.push(ev);
        for (const s of subs.get(parts[0]) || []) s.write(`${JSON.stringify(ev)}\n`);
        res.end(JSON.stringify(ev));
      });
      return;
    }
    if (req.method === 'GET' && parts.length === 2 && parts[1] === 'json') {
      gets++;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ id: 'o', event: 'open', topic: parts[0] })}\n`);
      if (!subs.has(parts[0])) subs.set(parts[0], new Set());
      subs.get(parts[0]).add(res);
      req.on('close', () => subs.get(parts[0]).delete(res));
      return;
    }
    res.writeHead(404).end();
  });
  const inject = (topic, ev) => {
    for (const s of subs.get(topic) || []) s.write(`${JSON.stringify(ev)}\n`);
  };
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}`, posts, subs, inject, gets: () => gets })));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-friends-'));
async function make(name, relay) {
  const f = new Friends({ file: path.join(tmp, `${name}.json`), fetchImpl: fetch });
  await f.load();
  await f.setRelay(relay);
  return f;
}

test('codes: 16 characters, typed loosely', () => {
  const c = newCode();
  assert.ok(validCode(c), c);
  assert.strictEqual(prettyCode(c).length, 19);
  assert.strictEqual(normCode(` ${prettyCode(c).toLowerCase()} `), c);
  assert.strictEqual(normCode('oooo-iiii-llll-1111'), '0000111111111111');
  assert.ok(!validCode('ABCD-EFGH'));
  assert.ok(!validCode('ABCD-EFGH-JKMN-PQR!'));
  const seen = new Set(Array.from({ length: 200 }, newCode));
  assert.strictEqual(seen.size, 200);
});

test('derive: same code, same topic and key; different code, different', () => {
  const a = derive('ABCD-EFGH-JKMN-PQRS');
  const b = derive('abcdefghjkmnpqrs');
  const c = derive('ABCD-EFGH-JKMN-PQRT');
  assert.strictEqual(a.topic, b.topic);
  assert.ok(a.key.equals(b.key));
  assert.notStrictEqual(a.topic, c.topic);
  assert.ok(!a.topic.includes('ABCD'), 'the code is not in the topic');
});

test('seal/open: round trip; wrong key, other topic or tampering → null', () => {
  const { topic, key } = derive(newCode());
  const s = seal(key, topic, { t: 'offer', sdp: 'v=0 x'.repeat(200) });
  assert.ok(s.length < 2000, `compressed (${s.length})`);
  assert.deepStrictEqual(open(key, topic, s), { t: 'offer', sdp: 'v=0 x'.repeat(200) });
  assert.strictEqual(open(derive(newCode()).key, topic, s), null);
  assert.strictEqual(open(key, `${topic}x`, s), null);
  const b = Buffer.from(s.slice(4), 'base64url');
  b[20] ^= 1;
  assert.strictEqual(open(key, topic, `sh1.${b.toString('base64url')}`), null);
  assert.strictEqual(open(key, topic, 'hello'), null);
});

test('state: own code kept across loads, friend codes never shown to the page', async () => {
  const file = path.join(tmp, 'keep.json');
  const a = new Friends({ file });
  await a.load();
  const code = a.state().code;
  const f = await a.addFriend(newCode(), 'Sam');
  const b = new Friends({ file });
  await b.load();
  assert.strictEqual(b.state().code, code);
  assert.deepStrictEqual(b.state().friends.map((x) => x.name), ['Sam']);
  assert.ok(!('code' in b.state().friends[0]));
  await assert.rejects(b.addFriend(code, 'me'), /your own code/);
  await assert.rejects(b.addFriend('nope', 'x'), /16 letters/);
  await b.removeFriend(f.id);
  assert.strictEqual(b.state().friends.length, 0);
});

test('sharing: a take counts as shared only while sharing is on', async () => {
  const a = new Friends({ file: path.join(tmp, 'share.json') });
  await a.load();
  await a.setShared('k_0123456789', true);
  assert.ok(!a.isShared('k_0123456789'));
  a.data.sharing = true;
  assert.ok(a.isShared('k_0123456789'));
  await a.prune([]);
  assert.ok(!a.isShared('k_0123456789'));
});

test('connect: offer reaches the host, answer comes back; relay only sees sealed text', async () => {
  const relay = await fakeNtfy();
  try {
    const host = await make('host', relay.url);
    const guest = await make('guest', relay.url);
    await host.setSharing(true);
    await host.host.ready;
    const fr = await guest.addFriend(host.state().code, 'Host');
    host.on('offer', (o) => {
      assert.strictEqual(o.sdp, 'OFFER-SDP');
      host.answer(o.conn, 'ANSWER-SDP');
    });
    const ans = await guest.connect(fr.id, 'OFFER-SDP');
    assert.strictEqual(ans, 'ANSWER-SDP');
    assert.strictEqual(relay.posts.length, 2);
    for (const p of relay.posts) {
      assert.ok(p.message.startsWith('sh1.'));
      assert.ok(!p.message.includes('SDP'));
      assert.strictEqual(p.topic, derive(host.state().code).topic);
    }
    // a replayed offer is ignored
    let again = 0;
    host.on('offer', () => again++);
    await fetch(`${relay.url}/${relay.posts[0].topic}`, { method: 'POST', body: relay.posts[0].message });
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(again, 0);
    // a new code: the old one stops working
    await host.newCode();
    await host.host.ready;
    await assert.rejects(guest.connect(fr.id, 'OFFER-SDP', { timeout: 800 }), (e) => e.code === 'OFFLINE');
    host.close();
  } finally {
    relay.server.closeAllConnections();
    relay.server.close();
  }
});

test('connect: nobody home → OFFLINE; no relay → RELAY', async () => {
  const relay = await fakeNtfy();
  try {
    const guest = await make('guest2', relay.url);
    const fr = await guest.addFriend(newCode(), 'Away');
    await assert.rejects(guest.connect(fr.id, 'x', { timeout: 500 }), (e) => e.code === 'OFFLINE' && /Away/.test(e.message));
    await guest.setRelay('http://127.0.0.1:9');
    await assert.rejects(guest.connect(fr.id, 'x', { timeout: 500 }), (e) => e.code === 'RELAY');
  } finally {
    relay.server.closeAllConnections();
    relay.server.close();
  }
});

const stopAll = (...relays) => relays.forEach((r) => (r.server.closeAllConnections(), r.server.close()));

test('meeting points: a list is cleaned up; one being down doesn’t matter', async () => {
  assert.deepStrictEqual(relayList('https://a.example/, http://b.example ;nonsense https://a.example'), ['https://a.example', 'http://b.example']);
  const good = await fakeNtfy();
  try {
    const both = `http://127.0.0.1:9, ${good.url}`;
    const host = await make('mp-host', both);
    const guest = await make('mp-guest', both);
    assert.deepStrictEqual(host.state().relays, ['http://127.0.0.1:9', good.url]);
    await host.setSharing(true);
    await host.host.subs[1].ready;
    host.on('offer', (o) => host.answer(o.conn, 'ANSWER'));
    const fr = await guest.addFriend(host.state().code, 'Host');
    assert.strictEqual(await guest.connect(fr.id, 'OFFER'), 'ANSWER');
    await host.setRelay('');
    assert.deepStrictEqual(host.state().relays, ['https://ntfy.sh', 'https://ntfy.envs.net'], 'empty puts the standard ones back');
    host.close();
  } finally {
    stopAll(good);
  }
});

test('meeting points: the same offer through two relays is answered once', async () => {
  const r1 = await fakeNtfy();
  const r2 = await fakeNtfy();
  try {
    const host = await make('two-host', `${r1.url}, ${r2.url}`);
    const guest = await make('two-guest', `${r1.url}, ${r2.url}`);
    await host.setSharing(true);
    await Promise.all(host.host.subs.map((x) => x.ready));
    let offers = 0;
    host.on('offer', (o) => (offers++, host.answer(o.conn, 'A')));
    const fr = await guest.addFriend(host.state().code, 'Host');
    assert.strictEqual(await guest.connect(fr.id, 'O'), 'A');
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(offers, 1);
    assert.strictEqual(r1.posts.length + r2.posts.length, 3, 'offer through both, answer back through one');
    host.close();
  } finally {
    stopAll(r1, r2);
  }
});

test('clocks: a PC whose clock is hours off still connects', async () => {
  const relay = await fakeNtfy();
  const real = Date.now;
  try {
    const host = await make('clk-host', relay.url);
    const guest = await make('clk-guest', relay.url);
    await host.setSharing(true);
    await host.host.subs[0].ready;
    host.on('offer', (o) => host.answer(o.conn, 'ANSWER'));
    const fr = await guest.addFriend(host.state().code, 'Host');
    Date.now = () => real() + 3 * 3600 * 1000; // the friend's PC thinks it's 3 hours later
    assert.strictEqual(await guest.connect(fr.id, 'OFFER'), 'ANSWER');
    host.close();
  } finally {
    Date.now = real;
    stopAll(relay);
  }
});

test('reconnects: old offers the relay hands back are skipped', async () => {
  const relay = await fakeNtfy();
  try {
    const host = await make('old-host', relay.url);
    await host.setSharing(true);
    await host.host.subs[0].ready;
    const { topic, key } = derive(host.state().code);
    let got = 0;
    host.on('offer', () => got++);
    const now = Math.floor(Date.now() / 1000);
    const msg = (c) => seal(key, topic, { t: 'offer', conn: c, sdp: 'x', n: c, ts: Date.now() });
    relay.inject(topic, { id: 'a', event: 'message', time: now, message: msg('fresh') });
    relay.inject(topic, { id: 'b', event: 'message', time: now - 600, message: msg('stale') });
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(got, 1);
    host.close();
  } finally {
    stopAll(relay);
  }
});

test('reconnects: a stream that goes quiet (sleep, dropped Wi-Fi) is reopened', async () => {
  const relay = await fakeNtfy();
  try {
    const sub = new Subscription({ relay: relay.url, topic: 'quiet', fetchImpl: fetch, onMessage: () => {}, idle: 300 });
    await sub.ready;
    await new Promise((r) => setTimeout(r, 1900));
    sub.close();
    assert.ok(relay.gets() >= 2, `reopened (${relay.gets()} connections)`);
  } finally {
    stopAll(relay);
  }
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${name}\n     ${err.stack}`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `${failed} failed` : 'friends: all passed');
  process.exit(failed ? 1 : 0);
})();
