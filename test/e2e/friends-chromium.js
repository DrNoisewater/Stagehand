/**
 * Friends (3.10) end to end, without Electron: two Chromium pages are two
 * Stagehands. Each has a real Friends service (main process side) behind a
 * stand-in bridge; offers and answers go through a local ntfy stand-in, the
 * video itself over a real WebRTC data channel (js/friendlink.js), in pieces.
 * Only shared videos may be fetched (the same check as main.js).
 *
 *   node test/e2e/friends-chromium.js [outDir]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { Friends } = require('../../src/main/services/friends');

const ROOT = path.resolve(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const results = [];
const check = (ok, msg) => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-fr-e2e-'));

function fakeNtfy() {
  const subs = new Map();
  let n = 0;
  const posts = [];
  const server = http.createServer((req, res) => {
    const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
    if (req.method === 'POST' && parts.length === 1) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const ev = { id: `m${++n}`, event: 'message', topic: parts[0], message: body };
        posts.push(body);
        for (const s of subs.get(parts[0]) || []) s.write(`${JSON.stringify(ev)}\n`);
        res.end('{}');
      });
    } else if (req.method === 'GET' && parts[1] === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ event: 'open' })}\n`);
      if (!subs.has(parts[0])) subs.set(parts[0], new Set());
      subs.get(parts[0]).add(res);
      req.on('close', () => subs.get(parts[0]).delete(res));
    } else res.writeHead(404).end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}`, posts })));
}

/** The renderer folder plus a harness page that loads friendlink.js. */
function staticServer() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/harness.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><script type="module">import * as L from "/js/friendlink.js"; window.L = L; window.ready = true;</script>');
    }
    const f = path.join(RENDERER, p);
    if (!f.startsWith(RENDERER) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

/** One "Stagehand": its Friends service, its takes, and a page bridged to them like preload.js does. */
async function stagehand(browser, name, relayUrl, siteUrl) {
  const friends = new Friends({ file: path.join(tmp, `${name}.json`), fetchImpl: fetch });
  await friends.load();
  await friends.setRelay(relayUrl);
  await friends.setName(name);
  const videos = new Map(); // id -> { name, bytes, kind }
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] PAGEERROR ${e.message}`));
  const API = {
    'friends.connect': (id, sdp) => friends.connect(id, sdp),
    'friends.answer': (conn, sdp) => friends.answer(conn, sdp),
    'friends.hostList': async () => {
      const st = friends.state();
      const list = st.sharing ? [...videos].filter(([id, v]) => v.kind === 'video' && friends.isShared(id)) : [];
      return { name: st.name, recordings: list.map(([id, v]) => ({ id, name: v.name, seconds: 3, size: v.bytes.length, at: Date.now() })) };
    },
    'friends.hostRead': async (id, part, offset, length) => {
      const v = videos.get(id);
      if (!v || v.kind !== 'video' || !friends.isShared(id) || part !== 'video') throw Object.assign(new Error('That video isn’t shared'), { code: 'NOT_SHARED' });
      const start = Math.min(v.bytes.length, offset);
      return { size: v.bytes.length, b64: v.bytes.subarray(start, start + Math.min(length, 4 << 20)).toString('base64') };
    },
  };
  await page.exposeBinding('__api', async (_s, fn, args) => {
    try {
      return { ok: true, value: await API[fn](...args) };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code || null };
    }
  });
  await page.addInitScript(() => {
    const listeners = new Map();
    const call = (fn) => async (...args) => {
      const r = await window.__api(fn, args);
      if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code });
      if (r.value && typeof r.value.b64 === 'string') return { size: r.value.size, bytes: Uint8Array.from(atob(r.value.b64), (c) => c.charCodeAt(0)) };
      return r.value;
    };
    window.api = {
      friends: Object.fromEntries(['connect', 'answer', 'hostList', 'hostRead'].map((k) => [k, call(`friends.${k}`)])),
      on: (ev, fn) => {
        if (!listeners.has(ev)) listeners.set(ev, new Set());
        listeners.get(ev).add(fn);
        return () => listeners.get(ev).delete(fn);
      },
    };
    window.__emit = (ev, d) => (listeners.get(ev) || []).forEach((fn) => fn(d));
  });
  friends.on('offer', (o) => page.evaluate(([o]) => window.__emit('friends:offer', o), [o]).catch(() => {}));
  await page.goto(`${siteUrl}/harness.html`);
  await page.waitForFunction(() => window.ready);
  return { friends, videos, page };
}

(async () => {
  const outDir = process.argv[2] || null;
  const relay = await fakeNtfy();
  const site = await staticServer();
  // no STUN on localhost; and show real local addresses instead of mDNS names
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const A = await stagehand(browser, 'Alex', relay.url, site.url);
    const B = await stagehand(browser, 'Bo', relay.url, site.url);

    // Alex has two videos (made-up bytes, ~3.5 MB so it comes in several pieces) and an audio take; shares one video
    const big = require('crypto').randomBytes(3.5 * 1024 * 1024);
    A.videos.set('k_aaaaaaaaaa', { name: 'SH - Riff idea', bytes: big, kind: 'video' });
    A.videos.set('k_bbbbbbbbbb', { name: 'SH - Private', bytes: big.subarray(0, 5000), kind: 'video' });
    A.videos.set('k_cccccccccc', { name: 'Loop at 90 BPM', bytes: big.subarray(0, 5000), kind: 'audio' });
    await A.friends.setSharing(true);
    await A.friends.setShared('k_aaaaaaaaaa', true);
    await A.friends.setShared('k_cccccccccc', true); // an audio take marked by mistake: still never handed out
    await A.friends.host.ready;
    await A.page.evaluate(() => {
      window.peers = 0;
      window.host = window.L.startHost(window.api, { iceServers: [], onPeers: (n) => (window.peers = n) });
    });

    // Bo adds Alex's code and connects
    const fr = await B.friends.addFriend(A.friends.state().code, 'Alex');
    const got = await B.page.evaluate(async (id) => {
      const t0 = performance.now();
      const link = await window.L.connectTo(window.api, id, { iceServers: [] });
      const ms = Math.round(performance.now() - t0);
      const list = await link.list();
      let progress = 0;
      const f = await link.get(list[0].id, { onProgress: (p) => (progress = p) });
      const refused = [];
      for (const other of ['k_bbbbbbbbbb', 'k_cccccccccc']) {
        try {
          await link.get(other);
          refused.push('GOT IT');
        } catch (e) {
          refused.push(e.message);
        }
      }
      // cancel part way
      let cut = null;
      const p2 = link.get(list[0].id, { onProgress: (p) => p > 0.2 && !cut && ((cut = p), link.cancel()) });
      const g2 = await p2;
      // the connection drops at ~40%: connect again and carry on from there
      const pieces = [];
      let have = 0;
      let link2 = await window.L.connectTo(window.api, id, { iceServers: [] });
      await link2.get(list[0].id, { onChunk: (c) => (pieces.push(c), (have += c.byteLength), have > 1.4e6 && link2.close()) }).catch(() => {});
      const droppedAt = have;
      link2 = await window.L.connectTo(window.api, id, { iceServers: [] });
      const rest = await link2.get(list[0].id, { from: have, onChunk: (c) => (pieces.push(c), (have += c.byteLength)) });
      link2.close();
      const joined = new Uint8Array(have);
      let o = 0;
      for (const p of pieces) joined.set(p, o), (o += p.byteLength);
      const resumed = { droppedAt, from: rest.from, total: have, size: rest.size, digest: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', joined))).map((b) => b.toString(16).padStart(2, '0')).join('') };
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', f.bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
      const peers = 0;
      link.close();
      return { ms, name: link.name, list, size: f.bytes.byteLength, progress, refused, digest, cancelled: g2.cancelled, partial: g2.bytes.byteLength, peers, resumed };
    }, fr.id);
    console.log(`     connected in ${got.ms} ms; ${got.size} bytes`);
    check(got.name === 'Alex', `Bo sees who it is (“${got.name}”)`);
    check(got.list.length === 1 && got.list[0].name === 'SH - Riff idea', `only the shared video is listed (${got.list.map((t) => t.name).join(', ')})`);
    check(got.digest === require('crypto').createHash('sha256').update(big).digest('hex'), `the video arrives byte for byte (${got.size} bytes)`);
    check(got.progress === 1, 'progress reaches 100%');
    check(got.refused.every((x) => /isn’t shared/.test(x)), `an unshared video and an audio take are refused (${got.refused.join(' / ')})`);
    check(got.cancelled && got.partial < big.length, `stopping part way works (${got.partial} of ${big.length} bytes)`);
    const want = require('crypto').createHash('sha256').update(big).digest('hex');
    check(got.resumed.droppedAt < big.length && got.resumed.from === got.resumed.droppedAt && got.resumed.digest === want, `a download cut off at ${got.resumed.droppedAt} bytes carries on from there and arrives whole`);
    check(relay.posts.every((p) => p.startsWith('sh1.') && !/a=fingerprint|candidate|Riff/.test(p)), 'the relay only saw sealed messages');

    // Alex turns sharing off: Bo can't connect
    await A.friends.setSharing(false);
    const off = await B.page.evaluate(async (id) => {
      try {
        await window.L.connectTo(window.api, id, { iceServers: [] });
        return 'connected';
      } catch (e) {
        return e.code;
      }
    }, fr.id);
    check(off === 'OFFLINE', `with sharing off nobody answers (${off})`);
    if (outDir) fs.mkdirSync(outDir, { recursive: true });
  } finally {
    await browser.close();
    relay.server.closeAllConnections();
    relay.server.close();
    site.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const bad = results.filter((x) => !x).length;
  console.log(bad ? `${bad} failed` : 'friends e2e: all passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
