/**
 * The Recordings window (4.1) with friends, in Chromium: two pages are two
 * Stagehands, each with the real Recordings window (js/recordings.js), a real
 * Friends service behind a stand-in bridge, and a local stand-in relay. Alex
 * shares a video (a short WebM made in the page); Bo adds Alex's code, sees
 * only that video, fetches it and watches it. Screenshots go to <outDir>.
 *
 *   node test/e2e/recordings-friends-chromium.js <outDir>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { Friends } = require('../../src/main/services/friends');

const ROOT = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'sh-recfr-out-'));
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-recfr-'));
const results = [];
const check = (ok, msg) => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

function fakeNtfy() {
  const subs = new Map();
  const server = http.createServer((req, res) => {
    const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
    if (req.method === 'POST' && parts.length === 1) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        for (const s of subs.get(parts[0]) || []) s.write(`${JSON.stringify({ id: String(Date.now()), event: 'message', message: body })}\n`);
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
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/src/renderer/css/app.css"><link rel="stylesheet" href="/src/renderer/css/v3.css"></head>
<body><div id="app"></div><div id="overlays"></div>
<script type="module">
import * as R from '/src/renderer/js/recordings.js';
import { F } from '/src/renderer/js/friends.js';
window.R = R; window.F = F; window.ready = true;
</script></body></html>`;

function site() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/harness.html') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(HARNESS);
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

async function stagehand(browser, name, relay, url) {
  const friends = new Friends({ file: path.join(tmp, `${name}.json`), fetchImpl: fetch });
  await friends.load();
  await friends.setRelay(relay);
  await friends.setName(name);
  const takes = []; // { id, kind, name, file, seconds, at, bytes, data }
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(`[${name}] PAGEERROR ${e.message}`));
  const shown = () => takes.map(({ data, ...t }) => t);
  const API = {
    'takes.list': () => shown(),
    'takes.rename': (id, n) => Object.assign(takes.find((t) => t.id === id), { name: n }),
    'takes.remove': (id) => takes.splice(takes.findIndex((t) => t.id === id), 1) && true,
    'friends.get': () => friends.state(),
    'friends.setSharing': (on) => friends.setSharing(on),
    'friends.setName': (n) => friends.setName(n),
    'friends.setRelay': (u) => friends.setRelay(u),
    'friends.newCode': () => friends.newCode(),
    'friends.add': (c, n) => friends.addFriend(c, n),
    'friends.rename': (id, n) => friends.renameFriend(id, n),
    'friends.remove': (id) => friends.removeFriend(id),
    'friends.share': (id, on) => {
      const t = takes.find((x) => x.id === id);
      if (on && (!t || t.kind !== 'video')) throw Object.assign(new Error('Only videos can be shared with friends'), { code: 'NOT_VIDEO' });
      return friends.setShared(id, on);
    },
    'friends.connect': (id, sdp) => friends.connect(id, sdp),
    'friends.answer': (c, sdp) => friends.answer(c, sdp),
    'friends.hostList': () => {
      const st = friends.state();
      const list = st.sharing ? takes.filter((t) => t.kind === 'video' && friends.isShared(t.id)) : [];
      return { name: st.name, recordings: list.map((t) => ({ id: t.id, name: t.name, seconds: t.seconds, size: t.bytes, at: t.at })) };
    },
    'friends.hostRead': (id, part, offset, length) => {
      const t = takes.find((x) => x.id === id);
      if (!t || t.kind !== 'video' || !friends.isShared(id)) throw Object.assign(new Error('That video isn’t shared'), { code: 'NOT_SHARED' });
      return { size: t.data.length, b64: t.data.subarray(offset, offset + length).toString('base64') };
    },
    'shell.openPath': () => null,
    'shell.showItem': () => null,
  };
  await page.exposeBinding('__api', async (_s, fn, args) => {
    try {
      const v = API[fn] ? await API[fn](...args) : null;
      return { __sh: true, ok: true, value: v === undefined ? null : JSON.parse(JSON.stringify(v)) };
    } catch (e) {
      return { __sh: true, ok: false, error: e.message, code: e.code || null };
    }
  });
  await page.addInitScript(() => {
    const L = new Map();
    const ns = (n, keys) => Object.fromEntries(keys.map((k) => [k, (...a) => window.__api(`${n}.${k}`, a).then((r) => (r.ok && r.value && typeof r.value.b64 === 'string' ? { ...r, value: { size: r.value.size, bytes: Uint8Array.from(atob(r.value.b64), (c) => c.charCodeAt(0)) } } : r))]));
    window.stagehand = {
      takes: ns('takes', ['list', 'rename', 'remove']),
      friends: ns('friends', ['get', 'setSharing', 'setName', 'setRelay', 'newCode', 'add', 'rename', 'remove', 'share', 'connect', 'answer', 'hostList', 'hostRead']),
      shell: ns('shell', ['openPath', 'showItem']),
      on: (ev, fn) => (L.has(ev) || L.set(ev, new Set()), L.get(ev).add(fn), () => L.get(ev).delete(fn)),
      takeUrl: (id) => `stagehand://take/${id}`,
    };
    window.__emit = (ev, d) => (L.get(ev) || []).forEach((fn) => fn(d));
  });
  // the main process's events, as preload.js forwards them
  friends.on('offer', (o) => page.evaluate((o) => window.__emit('friends:offer', o), o).catch(() => {}));
  friends.on('change', (st) => page.evaluate((st) => window.__emit('friends:change', st), st).catch(() => {}));
  await page.goto(`${url}/harness.html`);
  await page.waitForFunction(() => window.ready);
  return { friends, takes, page };
}

(async () => {
  const relay = await fakeNtfy();
  const web = await site();
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const A = await stagehand(browser, 'Alex', relay.url, web.url);
    const B = await stagehand(browser, 'Bo', relay.url, web.url);

    // a 3-second video, made in the page like a highway clip (moving bars on a canvas)
    const b64 = await A.page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const g = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8' });
      const parts = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      rec.start(250);
      const t0 = performance.now();
      await new Promise((done) => {
        (function draw() {
          const t = (performance.now() - t0) / 1000;
          g.fillStyle = '#0b1020';
          g.fillRect(0, 0, 640, 360);
          ['#ff6b3d', '#ffd497', '#8c7bff', '#ffd497', '#33c8e0', '#9bdb5a'].forEach((col, i) => {
            g.fillStyle = col;
            g.fillRect(40 + i * 95, 300 - ((t * 120 + i * 40) % 260), 70, 22);
          });
          g.fillStyle = '#fff';
          g.font = 'bold 28px sans-serif';
          g.fillText('Alex · Riff idea', 24, 44);
          if (t < 3) requestAnimationFrame(draw);
          else done();
        })();
      });
      rec.stop();
      await new Promise((r) => (rec.onstop = r));
      const buf = new Uint8Array(await new Blob(parts).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const vid = Buffer.from(b64, 'base64');
    const now = Date.now();
    A.takes.push(
      { id: 'k_aaaaaaaaaa', kind: 'video', name: 'Riff idea', file: 'Videos/SH - Riff idea.mp4', seconds: 3, at: now - 60000, bytes: vid.length, data: vid },
      { id: 'k_bbbbbbbbbb', kind: 'video', name: 'Jam Session', file: 'Videos/SH - Jam Session.mp4', seconds: 3, at: now - 3600000, bytes: vid.length, data: vid },
      { id: 'k_cccccccccc', kind: 'audio', name: 'Loop at 90 BPM', file: 'SH - Loop at 90 BPM.wav', seconds: 7, at: now - 7200000, bytes: 1300000, data: Buffer.alloc(10) }
    );

    // Alex: Mine tab, share the first video
    await A.page.evaluate(() => window.R.openRecordings());
    await A.page.waitForSelector('.rec-row');
    check((await A.page.locator('.rec-row.video .tk-share').count()) === 2 && (await A.page.locator('.rec-row:not(.video) .tk-share').count()) === 0, 'only videos have a share button');
    await A.page.locator('.rec-row[data-id="k_aaaaaaaaaa"] .tk-share').click();
    await A.page.waitForSelector('.rec-row[data-id="k_aaaaaaaaaa"] .tk-share.on');
    check(A.friends.state().sharing && A.friends.isShared('k_aaaaaaaaaa'), 'sharing a video turns sharing on');
    await A.page.waitForTimeout(400);
    await A.page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
    await A.page.screenshot({ path: path.join(outDir, 'rec-1-mine-shared.png') });
    await A.page.locator('.rec-tabs button:has-text("Friends")').click();
    await A.page.waitForSelector('.fr-code code');
    const code = await A.page.locator('.fr-code code').textContent();
    check(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(code), `Friends shows Alex’s code (${code})`);
    await A.page.screenshot({ path: path.join(outDir, 'rec-2-friends-mine.png') });

    // Bo: Friends tab, add Alex with the code
    await B.page.evaluate(() => window.R.openRecordings({ tab: 'friends' }));
    await B.page.waitForSelector('.fr-friend.add');
    await B.page.locator('.fr-friend.add').click();
    await B.page.locator('.over-rec input').fill(code.toLowerCase().replace(/-/g, ' '));
    await B.page.locator('.over-rec button:has-text("Next")').click();
    await B.page.locator('.over-rec input').fill('Alex');
    await B.page.screenshot({ path: path.join(outDir, 'rec-3-add-friend.png') });
    await B.page.locator('.over-rec button:has-text("Add friend")').click();
    await B.page.waitForSelector('.fr-view .rec-row', { timeout: 30000 });
    const names = await B.page.locator('.fr-view .rec-row .rec-text b').allTextContents();
    check(names.length === 1 && names[0] === 'Riff idea', `Bo sees only the shared video (${names.join(', ')})`);
    await B.page.screenshot({ path: path.join(outDir, 'rec-4-friend-list.png') });
    await A.page.waitForSelector('.fr-dot.live', { timeout: 5000 }).catch(() => {});
    check((await A.page.locator('.fr-dot.live').count()) >= 1, 'Alex sees a friend is watching');
    await A.page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
    await A.page.screenshot({ path: path.join(outDir, 'rec-5-alex-watched.png') });

    // Bo watches it
    await B.page.locator('.fr-view .rec-row .round-play').click();
    await B.page.waitForSelector('.rec-player video', { timeout: 20000 });
    await B.page.waitForFunction(() => {
      const v = document.querySelector('.rec-player video');
      return v && v.readyState >= 2 && v.currentTime > 0.8;
    }, null, { timeout: 15000 });
    const v = await B.page.evaluate(() => {
      const el = document.querySelector('.rec-player video');
      return { w: el.videoWidth, h: el.videoHeight, t: el.currentTime, title: document.querySelector('.rec-ptitle').textContent };
    });
    check(v.w === 640 && v.h === 360, `Bo’s video plays (${v.w}×${v.h}, ${v.t.toFixed(1)} s in, “${v.title}”)`);
    await B.page.screenshot({ path: path.join(outDir, 'rec-6-friend-watching.png') });

    // Alex turns sharing off: Bo can't get in any more
    await A.friends.setSharing(false);
    await B.page.evaluate(() => document.querySelector('.modal header .icon-btn').click());
    await B.page.evaluate(() => window.R.openRecordings({ tab: 'friends' }));
    await B.page.locator('.fr-friend:not(.add)').click();
    await B.page.waitForSelector('.fr-state.off, .fr-state.bad', { timeout: 30000 });
    check((await B.page.locator('.fr-state.off').count()) === 1, 'with sharing off, Bo is told Alex isn’t around');
    await B.page.screenshot({ path: path.join(outDir, 'rec-7-friend-away.png') });
  } finally {
    await browser.close();
    relay.server.closeAllConnections();
    relay.server.close();
    web.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const bad = results.filter((x) => !x).length;
  console.log(bad ? `${bad} failed` : 'recordings + friends: all passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
