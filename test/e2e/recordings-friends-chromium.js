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
import { F, host } from '/src/renderer/js/friends.js';
window.R = R; window.F = F; window.host = host; window.ready = true;
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
    'friends.setCode': (c) => friends.setCode(c),
    'friends.setFriendCode': (id, c) => friends.setFriendCode(id, c),
    'friends.send': (to, t) => friends.sendMessage(to, t),
    'friends.add': (c, n) => friends.addFriend(c, n),
    'friends.rename': (id, n) => friends.renameFriend(id, n),
    'friends.remove': (id) => friends.removeFriend(id),
    'friends.share': (id, on) => {
      const t = takes.find((x) => x.id === id);
      if (on && (!t || t.kind !== 'video')) throw Object.assign(new Error('Only videos can be shared with friends'), { code: 'NOT_VIDEO' });
      return friends.setShared(id, on);
    },
    'friends.connect': (id, sdp) => friends.connect(id, sdp, { onStage: (stage) => page.evaluate((p) => window.__emit('friends:progress', p), { friendId: id, stage }).catch(() => {}) }),
    'friends.answer': (c, sdp) => friends.answer(c, sdp),
    'friends.hostList': () => {
      const st = friends.state();
      const list = st.sharing ? takes.filter((t) => t.kind === 'video' && friends.isShared(t.id)) : [];
      return { name: st.name, recordings: list.map((t) => ({ id: t.id, name: t.name, seconds: t.seconds, size: t.bytes, at: t.at })) };
    },
    'friends.hostRead': async (id, part, offset, length) => {
      const t = takes.find((x) => x.id === id);
      if (t && t.slow) await new Promise((r) => setTimeout(r, t.slow));
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
      friends: ns('friends', ['get', 'setSharing', 'setName', 'setRelay', 'newCode', 'setCode', 'setFriendCode', 'send', 'add', 'rename', 'remove', 'share', 'connect', 'answer', 'hostList', 'hostRead']),
      shell: ns('shell', ['openPath', 'showItem']),
      on: (ev, fn) => (L.has(ev) || L.set(ev, new Set()), L.get(ev).add(fn), () => L.get(ev).delete(fn)),
      takeUrl: (id) => `stagehand://take/${id}`,
    };
    window.__emit = (ev, d) => (L.get(ev) || []).forEach((fn) => fn(d));
  });
  // the main process's events, as preload.js forwards them
  friends.on('offer', (o) => page.evaluate((o) => window.__emit('friends:offer', o), o).catch(() => {}));
  friends.on('change', (st) => page.evaluate((st) => window.__emit('friends:change', st), st).catch(() => {}));
  friends.on('message', (m) => page.evaluate((m) => window.__emit('friends:message', m), m).catch(() => {}));
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
    const made = await A.page.locator('.fr-code code').textContent();
    check(/^[a-z]+-[a-z]+$/.test(made), `Friends shows Alex’s code, easy to say (${made})`);
    await A.page.waitForSelector('.fr-status.ok', { timeout: 15000 }).catch(() => {});
    check(/Ready\. Friends with your code can connect now/.test(await A.page.locator('.fr-status').textContent()), `Alex is told plainly they’re ready: “${await A.page.locator('.fr-status').textContent()}”`);
    // the ⋯ menu opens in front of the window (it opened behind it)
    await A.page.locator('.fr-me .icon-btn[aria-label="Friends options"]').click();
    const front = await A.page.evaluate(() => {
      const it = document.querySelector('.menu button, .menu [role="menuitem"]');
      if (!it) return false;
      const r = it.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(top && top.closest('.menu'));
    });
    check(front, 'the ⋯ menu shows in front of the Recordings window');
    // (a screenshot unfocuses the window, which closes menus: no picture of it)
    await A.page.locator('.over-highway .modal header h2').click();
    // Alex picks their own phrase
    await A.page.locator('.fr-code .btn:has-text("Change")').click();
    await A.page.locator('.over-rec input').fill('Alex Rocks Out');
    await A.page.screenshot({ path: path.join(outDir, 'rec-2b-change-code.png') });
    await A.page.locator('.over-rec button:has-text("Use this code")').click();
    await A.page.waitForFunction(() => document.querySelector('.fr-code code')?.textContent === 'Alex Rocks Out');
    const code = 'Alex Rocks Out';
    check(true, 'Alex chose their own code: “Alex Rocks Out”');
    await A.page.waitForSelector('.fr-status.ok', { timeout: 15000 }).catch(() => {});
    await A.page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
    await A.page.screenshot({ path: path.join(outDir, 'rec-2-friends-mine.png') });

    // Bo: Friends tab, adds Alex with a typo in the code
    await B.page.evaluate(() => window.R.openRecordings({ tab: 'friends' }));
    await B.page.waitForSelector('.fr-friend.add');
    await B.page.locator('.fr-friend.add').click();
    check((await B.page.locator('.over-rec input').getAttribute('placeholder')) === 'e.g. happy-tiger', 'the box shows an example word code, nothing to format');
    await B.page.locator('.over-rec input').fill('alex rocks');
    await B.page.locator('.over-rec button:has-text("Next")').click();
    check(/at least 6|Ask your friend/.test(await B.page.locator('.over-rec .fr-err').textContent()) === false, 'a short phrase over 6 letters is fine');
    await B.page.locator('.over-rec input').fill('Alex');
    await B.page.screenshot({ path: path.join(outDir, 'rec-3-add-friend.png') });
    await B.page.locator('.over-rec button:has-text("Add and connect")').click();
    await B.page.waitForSelector('.fr-steps li.done', { timeout: 15000 });
    await B.page.screenshot({ path: path.join(outDir, 'rec-3a-connecting.png') });
    check(/Asking Alex’s Stagehand/.test(await B.page.locator('.fr-steps').textContent()), 'Bo sees each step of connecting');
    await B.page.waitForSelector('.fr-state.off', { timeout: 40000 });
    const wrong = await B.page.locator('.fr-state').textContent();
    check(/No answer from Alex/.test(wrong) && /Is the code right\?/.test(wrong) && /alex rocks/.test(wrong), 'a wrong code: “No answer from Alex”, and it shows the code Bo typed to check');
    check((await B.page.locator('.fr-friend.bad').count()) === 1, 'Alex’s chip gets a red dot');
    await B.page.locator('.fr-type').fill('hello?');
    await B.page.keyboard.press('Enter');
    await B.page.waitForFunction(() => /Sent/.test(document.querySelector('.fr-msg.out .fr-meta')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
    await B.page.waitForTimeout(1500);
    check(/Sent/.test(await B.page.locator('.fr-msg.out .fr-meta').textContent()) && !/Delivered/.test(await B.page.locator('.fr-msg.out .fr-meta').textContent()), 'with the wrong code a message is sent but never “Delivered”');
    await B.page.screenshot({ path: path.join(outDir, 'rec-3b-wrong-code.png') });
    // Bo fixes it, typed loosely
    await B.page.locator('.fr-state .btn:has-text("Fix their code")').click();
    await B.page.locator('.over-rec input').fill(code.toLowerCase().replace(/ /g, '-'));
    await B.page.locator('.over-rec button:has-text("Save and connect")').click();
    await B.page.waitForSelector('.fr-view .rec-row', { timeout: 30000 });
    const names = await B.page.locator('.fr-view .rec-row .rec-text b').allTextContents();
    check(names.length === 1 && names[0] === 'Riff idea', `with the code fixed, Bo sees only the shared video (${names.join(', ')})`);
    check(/Connected to Alex\. The code is right\./.test(await B.page.locator('.fr-live').textContent()), 'Bo is told: connected, the code is right');
    check((await B.page.locator('.fr-friend.ok').count()) === 1, 'Alex’s chip gets a green dot');
    await B.page.screenshot({ path: path.join(outDir, 'rec-4-friend-list.png') });
    await A.page.waitForFunction(() => /Bo is connected and watching now/.test(document.querySelector('.fr-status')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    check(/Bo is connected and watching now/.test(await A.page.locator('.fr-status').textContent()), `Alex sees who’s watching: “${await A.page.locator('.fr-status').textContent()}”`);
    await A.page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
    await A.page.screenshot({ path: path.join(outDir, 'rec-5-alex-watched.png') });

    // messages: Bo writes; Alex (who hasn't added Bo) is told, sees it, adds Bo back and answers
    await B.page.locator('.fr-type').fill('Can you see my videos?');
    await B.page.locator('.fr-compose .btn:has-text("Send")').click();
    await B.page.waitForFunction(() => /Delivered/.test(document.querySelector('.fr-msg.out .fr-meta')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    check(/Delivered/.test(await B.page.locator('.fr-msg.out .fr-meta').last().textContent()), 'Bo’s message says “Delivered”: it reached Alex’s Stagehand');
    await A.page.waitForSelector('.toast:has-text("Message from Bo")', { timeout: 8000 }).catch(() => {});
    check((await A.page.locator('.toast:has-text("Message from Bo")').count()) === 1, 'Alex gets a note: “Message from Bo”');
    await A.page.waitForSelector('.fr-friend.stranger', { timeout: 5000 }).catch(() => {});
    check((await A.page.locator('.fr-friend.stranger .fr-unread').count()) === 1, 'Bo shows on Alex’s side as someone who wrote, with a new-message count');
    await A.page.locator('.fr-friend.stranger').click();
    check(/Can you see my videos\?/.test(await A.page.locator('.fr-msgs').textContent()), 'Alex reads Bo’s message');
    await A.page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
    await A.page.screenshot({ path: path.join(outDir, 'rec-5a-alex-message.png') });
    await A.page.locator('.fr-state .btn:has-text("Add Bo as a friend")').click();
    await A.page.locator('.over-rec button:has-text("Add")').click();
    await A.page.waitForSelector('.fr-friend.sel:not(.stranger)', { timeout: 10000 });
    await A.page.locator('.fr-type').fill('Yes! Loud and clear.');
    await A.page.keyboard.press('Enter');
    await B.page.waitForFunction(() => /Loud and clear/.test(document.querySelector('.fr-msgs')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    check(/Loud and clear/.test(await B.page.locator('.fr-msgs').textContent()), 'Bo gets Alex’s answer in the same screen');
    await A.page.waitForFunction(() => /Delivered/.test([...document.querySelectorAll('.fr-msg.out .fr-meta')].pop()?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    check(/Delivered/.test(await A.page.locator('.fr-msg.out .fr-meta').last().textContent()), 'Alex’s answer says “Delivered” too');
    await A.page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
    await B.page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
    await B.page.screenshot({ path: path.join(outDir, 'rec-5b-bo-messages.png') });
    await A.page.screenshot({ path: path.join(outDir, 'rec-5c-alex-messages.png') });

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

    // a long video, and the connection drops partway: it reconnects and carries on
    const long = Buffer.concat([vid, require('crypto').randomBytes(6 * 1024 * 1024)]);
    A.takes.push({ id: 'k_dddddddddd', kind: 'video', name: 'Long take', file: 'Videos/SH - Long take.mp4', seconds: 300, at: now, bytes: long.length, data: long, slow: 250 });
    await A.friends.setShared('k_dddddddddd', true);
    await B.page.locator('.fr-view .btn:has-text("Check again")').click();
    await B.page.waitForSelector('.fr-view .rec-row:has-text("Long take")');
    await B.page.locator('.fr-view .rec-row:has-text("Long take") .round-play').click();
    await B.page.waitForFunction(() => /Getting it… ([3-9]\d)%/.test(document.querySelector('.fr-view .rec-row')?.parentElement.textContent || ''), null, { timeout: 30000 });
    await A.page.evaluate(() => [...window.host.peers.values()].forEach((pc) => pc.close()));
    await B.page.waitForFunction(() => /reconnecting/.test(document.querySelector('.fr-view').textContent), null, { timeout: 15000 });
    check(true, 'a dropped connection shows “reconnecting”');
    await B.page.screenshot({ path: path.join(outDir, 'rec-6b-reconnecting.png') });
    await B.page.waitForFunction(() => /Long take/.test(document.querySelector('.rec-ptitle')?.textContent || ''), null, { timeout: 60000 });
    const blobSize = await B.page.evaluate(async () => (await (await fetch(document.querySelector('.rec-player video').src)).blob()).size);
    check(blobSize === long.length, `after reconnecting the whole video arrives (${blobSize} of ${long.length} bytes)`);

    // 4.1.5, as it happened for real: Bo's copy of Alex's code has one letter wrong; Alex writes to Bo.
    // Bo gets "No answer", and Stagehand spots that the message came from a near-miss code: one click fixes it.
    const alexId = B.friends.state().friends[0].id;
    await B.friends.setFriendCode(alexId, 'alex-rocks-oat');
    const boId = A.friends.state().friends.find((f) => f.name === 'Bo').id;
    await A.friends.sendMessage(boId, 'Did you get my code right?');
    await B.page.waitForTimeout(800);
    await B.page.evaluate(() => document.querySelector('.modal header .icon-btn').click());
    await B.page.evaluate(() => window.R.openRecordings({ tab: 'friends' }));
    await B.page.waitForSelector('.fr-friend.stranger', { timeout: 5000 }).catch(() => {});
    check((await B.page.locator('.fr-friend.stranger').count()) === 1, 'Alex’s message shows as someone new on Bo’s side (the code Bo has is wrong)');
    await B.page.locator('.fr-friend.stranger').click();
    check(/Is this Alex\?/.test(await B.page.locator('.fr-view').textContent()), 'opening it asks: “Is this Alex?” (a near-miss of the code Bo typed)');
    await B.page.screenshot({ path: path.join(outDir, 'rec-6c-is-this-alex.png') });
    await B.page.locator('.fr-friend:not(.add):not(.stranger)').click();
    await B.page.waitForSelector('.fr-state.off', { timeout: 40000 });
    const found = await B.page.locator('.fr-state').textContent();
    check(/Found it/.test(found) && /Alex Rocks Out/.test(found) && /alex-rocks-oat/.test(found), '“No answer from Alex” now says “Found it”, with both codes side by side');
    await B.page.screenshot({ path: path.join(outDir, 'rec-6d-found-it.png') });
    await B.page.locator('.fr-found .btn:has-text("Use")').click();
    await B.page.waitForSelector('.fr-live', { timeout: 40000 }).catch(() => {});
    check(/The code is right/.test((await B.page.locator('.fr-live').textContent().catch(() => '')) || ''), 'one click on “Use …” fixes the code and connects');
    check((await B.page.locator('.fr-friend.stranger').count()) === 0 && /Did you get my code right\?/.test(await B.page.locator('.fr-msgs').textContent()), 'and Alex’s message moves into Alex’s chat');

    // Alex turns sharing off: Bo can't get in any more
    await A.friends.setSharing(false);
    await B.page.evaluate(() => document.querySelector('.modal header .icon-btn').click());
    await B.page.evaluate(() => window.R.openRecordings({ tab: 'friends' }));
    await B.page.locator('.fr-friend:not(.add)').click();
    await B.page.waitForSelector('.fr-state.off, .fr-state.bad', { timeout: 30000 });
    check((await B.page.locator('.fr-state.off').count()) === 1 && /Sharing on\?/.test(await B.page.locator('.fr-state').textContent()), 'with sharing off, Bo is told nobody answered and what to check');
    await B.page.screenshot({ path: path.join(outDir, 'rec-7-friend-away.png') });

    // the friend you picked: Rename, Change code and Remove in plain sight; "Remove Alex?" in front
    check((await B.page.locator('.fr-bar').count()) === 1 && /Their code: Alex Rocks Out/.test(await B.page.locator('.fr-bar').textContent()), 'the picked friend shows their name, their code, and Rename / Change code / Remove');
    await B.page.locator('.fr-bar .btn:has-text("Remove")').click();
    await B.page.waitForTimeout(400);
    const inFront = await B.page.evaluate(() => {
      const mods = [...document.querySelectorAll('.modal')];
      const ask = mods.find((x) => /Remove Alex\?/.test(x.textContent));
      if (!ask) return 'no question';
      const btn = [...ask.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Remove');
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top && ask.contains(top) ? 'front' : `behind (${top && top.className})`;
    });
    check(inFront === 'front', `“Remove Alex?” opens in front of the Recordings window (${inFront})`);
    await B.page.screenshot({ path: path.join(outDir, 'rec-8-remove.png') });
    await B.page.evaluate(() => [...[...document.querySelectorAll('.modal')].find((x) => /Remove Alex\?/.test(x.textContent)).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Remove').click());
    await B.page.waitForFunction(() => !document.querySelector('.fr-friend:not(.add):not(.stranger)'), null, { timeout: 5000 }).catch(() => {});
    check((await B.page.locator('.fr-friend:not(.add):not(.stranger)').count()) === 0 && B.friends.state().friends.length === 0, 'Remove takes Alex off the list');
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
