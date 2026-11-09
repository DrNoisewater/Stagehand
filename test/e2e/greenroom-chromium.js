/**
 * The Green Room (4.3) in Chromium: two pages are two Stagehands, each with the
 * real page (js/greenroom.js, js/room.js, js/friendlink.js), a real GreenRoom
 * service behind a stand-in bridge, and a local stand-in meeting point. Alex shows
 * a video (a short WebM made in the page) with its song, part and tone; Bo sees it
 * in The Room, watches it, keeps the tone, and they message about it. A long video
 * whose connection drops partway carries on. Screenshots go to <outDir>.
 *
 *   node test/e2e/greenroom-chromium.js <outDir>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { GreenRoom, clipSummary } = require('../../src/main/services/greenroom');
const { aboutClip } = require('../../src/main/services/stats');

const ROOT = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'sh-gr-out-'));
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-gr-'));
const results = [];
const check = (ok, msg) => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

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
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

// the app's own page, with the Green Room's parts loaded instead of the whole app
const HARNESS = fs
  .readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  .replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
  .replace('<script src="splash/noisewater-splash.js" defer></script>', '')
  .replace(
    '<script type="module" src="js/main.js"></script>',
    `<script type="module">
import { state, setPage } from './js/store.js';
import { G, host } from './js/room.js';
import * as GR from './js/greenroom.js';
import './js/shell.js';
window.GR = GR; window.G = G; window.host = host; window.shState = state; window.setPage = setPage; window.ready = true;
</script>`
  );

function site() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/src/renderer/harness.html') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(HARNESS);
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.wasm') ? 'application/wasm' : f.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

// the bridge's namespaces and methods, read from the real preload
const SHAPE = (() => {
  const pre = fs.readFileSync(path.join(ROOT, 'src/main/preload.js'), 'utf8');
  const shape = {};
  let cur = null;
  for (const line of pre.slice(pre.indexOf("exposeInMainWorld('stagehand', {")).split('\n')) {
    let m = /^  ([a-zA-Z]+): \{\s*$/.exec(line);
    if (m) {
      cur = m[1];
      shape[cur] = [];
      continue;
    }
    m = /^    ([a-zA-Z]+): /.exec(line);
    if (m && cur) shape[cur].push(m[1]);
    if (/^  \},?\s*$/.test(line)) cur = null;
  }
  return shape;
})();

async function stagehand(browser, name, relay, url) {
  const takes = []; // { id, kind, name, file, seconds, at, bytes, about, data }
  const saved = []; // tones kept
  const room = new GreenRoom({ file: path.join(tmp, `${name}.json`), fetchImpl: fetch, relays: [relay], room: 'E2E ROOM', listClips: async () => takes.filter((t) => t.kind === 'video') });
  await room.load();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load/.test(m.text()) && console.log(`[${name}] CONSOLE ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[${name}] PAGEERROR ${e.message} ${(e.stack || '').split('\n').slice(1, 3).join(' | ')}`));
  const shown = () => takes.map(({ data, ...t }) => t);
  const isShared = (id) => room.joined && room.isShared(id);
  const API = {
    'takes.list': () => shown(),
    'takes.rename': (id, n) => Object.assign(takes.find((t) => t.id === id), { name: n }),
    'takes.remove': (id) => (room.setShared(id, false).catch(() => {}), takes.splice(takes.findIndex((t) => t.id === id), 1) && true),
    'room.get': () => (room.prune && room.prune(), room.state()),
    'room.setName': (n) => room.setName(n),
    'room.leave': () => room.leave(),
    'room.send': (to, t, about) => room.sendMessage(to, t, about),
    'room.hide': (a, on) => room.hide(a, on),
    'room.share': (id, on) => {
      const t = takes.find((x) => x.id === id);
      if (on && (!t || t.kind !== 'video')) throw Object.assign(new Error('Only videos can go in the Green Room'), { code: 'NOT_VIDEO' });
      return room.setShared(id, on);
    },
    'room.connect': (addr, sdp) => room.connect(addr, sdp, { onStage: (stage) => page.evaluate((p) => window.__emit('room:progress', p), { addr, stage }).catch(() => {}) }),
    'room.answer': (c, sdp) => room.answer(c, sdp),
    'room.hostList': () => {
      const list = room.joined ? takes.filter((t) => t.kind === 'video' && room.isShared(t.id)) : [];
      return { name: room.data.name, recordings: list.map((t) => ({ ...clipSummary(t), name: t.name, seconds: t.seconds, tone: (t.about && t.about.tone) || null })) };
    },
    'room.hostRead': async (id, part, offset, length) => {
      const t = takes.find((x) => x.id === id);
      if (t && t.slow) await new Promise((r) => setTimeout(r, t.slow));
      if (!t || t.kind !== 'video' || !isShared(id)) throw Object.assign(new Error('That video isn’t shown'), { code: 'NOT_SHARED' });
      return { size: t.data.length, b64: t.data.subarray(offset, offset + length).toString('base64') };
    },
    'tones.save': (t) => (saved.push(t), { ...t, id: `t${saved.length}` }),
    'tones.list': () => [],
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
  await page.addInitScript((shape) => {
    const L = new Map();
    const call = (n, k, a) => window.__api(`${n}.${k}`, a).then((r) => (r.ok && r.value && typeof r.value.b64 === 'string' ? { ...r, value: { size: r.value.size, bytes: Uint8Array.from(atob(r.value.b64), (c) => c.charCodeAt(0)) } } : r));
    // every part of the bridge answers (with nothing, unless the test knows it)
    const sh = {};
    for (const [n, keys] of Object.entries(shape)) sh[n] = Object.fromEntries(keys.map((k) => [k, (...a) => call(n, k, a)]));
    Object.assign(sh, {
      on: (ev, fn) => (L.has(ev) || L.set(ev, new Set()), L.get(ev).add(fn), () => L.get(ev).delete(fn)),
      takeUrl: (id) => `stagehand://take/${id}`,
      artUrl: () => '',
    });
    window.stagehand = sh;
    window.__emit = (ev, d) => (L.get(ev) || []).forEach((fn) => fn(d));
  }, SHAPE);
  // the main process's events, as preload.js forwards them
  room.on('offer', (o) => page.evaluate((o) => window.__emit('room:offer', o), o).catch(() => {}));
  room.on('change', (st) => page.evaluate((st) => window.__emit('room:change', st), st).catch(() => {}));
  room.on('message', (m) => page.evaluate((m) => window.__emit('room:message', m), m).catch(() => {}));
  await page.goto(`${url}/src/renderer/harness.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
  return { room, takes, saved, page, name };
}
const clearToasts = (S) => S.page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
const shot = async (S, file) => {
  await clearToasts(S);
  await S.page.screenshot({ path: path.join(outDir, file) });
};

(async () => {
  const relay = await fakeNtfy();
  const web = await site();
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
  let A;
  let B;
  try {
    A = await stagehand(browser, 'Alex', relay.url, web.url);
    B = await stagehand(browser, 'Bo', relay.url, web.url);
    // Bo has the song Alex played
    await B.page.evaluate(() => window.shState.songs.set('s_paranoid', { id: 's_paranoid', title: 'Paranoid', artist: 'Black Sabbath' }));

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
          g.fillText('Alex · Paranoid', 24, 44);
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
    const TONE = { name: 'Crunchy Plexi', kind: 'guitar', gear: [{ slot: 'amp', key: 'plexi', knobs: { gain: 7 } }], ir: 'C:\\Users\\alex\\cab.wav' };
    A.takes.push(
      { id: 'k_aaaaaaaaaa', kind: 'video', name: 'Paranoid', file: 'Videos/SH - Paranoid.mp4', seconds: 3, at: now - 60000, bytes: vid.length, data: vid, about: aboutClip({ song: { title: 'Paranoid', artist: 'Black Sabbath' }, part: 'lead', tuning: 'E Standard', instrument: 'guitar', speed: 0.8, tone: TONE }) },
      { id: 'k_bbbbbbbbbb', kind: 'video', name: 'Jam Session', file: 'Videos/SH - Jam Session.mp4', seconds: 3, at: now - 3600000, bytes: vid.length, data: vid, about: aboutClip({ part: 'jam', instrument: 'guitar', tone: TONE }) },
      { id: 'k_cccccccccc', kind: 'audio', name: 'Loop at 90 BPM', file: 'SH - Loop at 90 BPM.wav', seconds: 7, at: now - 7200000, bytes: 1300000, data: Buffer.alloc(10) }
    );

    // Bo looks first: nobody here yet (nobody has a name)
    await B.page.evaluate(() => window.setPage('greenroom'));
    await B.page.waitForSelector('#page-greenroom .gr-empty', { timeout: 15000 });
    check(/Nobody else is here/.test(await B.page.locator('#page-greenroom .gr-empty').textContent()), 'an empty Green Room says so, and how clips get there');
    check(/Come in/.test(await B.page.locator('.gr-me').textContent()), 'without a name you can look around, with a Come in button');
    await shot(B, 'gr-1-empty.png');

    // Alex: My clips; only videos can be shown
    await A.page.evaluate(() => window.GR.openGreenRoom({ tab: 'mine' }));
    await A.page.waitForSelector('#page-greenroom .gr-row');
    check((await A.page.locator('.gr-row.video .gr-show').count()) === 2 && (await A.page.locator('.gr-row:not(.video) .gr-show').count()) === 0, 'only videos have Show in the Green Room');
    check(/Paranoid · Lead · Crunchy Plexi/.test(await A.page.locator('.gr-row[data-clip="k_aaaaaaaaaa"]').textContent()), 'a clip in My clips says its song, part and tone');
    await A.page.locator('.gr-row[data-clip="k_aaaaaaaaaa"] .gr-show').click();
    // the first time: pick a name
    await A.page.waitForSelector('.gr-ask input');
    await A.page.locator('.gr-ask input').fill('Alex');
    await shot(A, 'gr-2-pick-name.png');
    await A.page.locator('.modal button:has-text("Come in")').click();
    await A.page.waitForSelector('.gr-row[data-clip="k_aaaaaaaaaa"] .gr-show.on', { timeout: 10000 });
    check(A.room.joined && A.room.isShared('k_aaaaaaaaaa') && !A.room.isShared('k_bbbbbbbbbb'), 'after a name, that one video is in the Green Room');
    check(/You’re in as\s*Alex/.test(await A.page.locator('.gr-me').textContent()), 'Alex sees their name at the top');
    await shot(A, 'gr-3-mine-shown.png');

    // Bo: Alex and their clip show up by themselves
    await B.page.waitForSelector('#page-greenroom .gr-card', { timeout: 15000 });
    const card = await B.page.locator('.gr-card').first().textContent();
    check((await B.page.locator('.gr-card').count()) === 1, 'Bo sees exactly the one clip Alex shows');
    check(/Paranoid/.test(card) && /Alex/.test(card) && /Black Sabbath/.test(card) && /Lead · E Standard · 80% speed/.test(card) && /Crunchy Plexi/.test(card), `the card says the song, who, the part, tuning, speed and tone (${card.replace(/\s+/g, ' ').slice(0, 120)})`);
    check(/You have it/.test(card), 'and that Bo has that song');
    check(/Here now · 1/.test(await B.page.locator('.gr-section').textContent()), 'Alex is listed as here now');
    await shot(B, 'gr-4-room.png');
    // the filters
    await B.page.locator('.gr-filter button:has-text("Bass")').click();
    check((await B.page.locator('.gr-card').count()) === 0 && /No clips match/.test(await B.page.locator('#page-greenroom').textContent()), 'Bass hides a guitar clip');
    await B.page.locator('.gr-filter button:has-text("All")').click();

    // Bo watches it
    await B.page.locator('.gr-card').first().click();
    await B.page.waitForSelector('.gr-player video', { timeout: 30000 });
    await B.page.waitForFunction(() => {
      const v = document.querySelector('.gr-player video');
      return v && v.readyState >= 2 && v.currentTime > 0.8;
    }, null, { timeout: 15000 });
    const v = await B.page.evaluate(() => {
      const el = document.querySelector('.gr-player video');
      return { w: el.videoWidth, h: el.videoHeight, t: el.currentTime };
    });
    check(v.w === 640 && v.h === 360, `Alex’s clip plays on Bo’s side, straight from Alex’s PC (${v.w}×${v.h}, ${v.t.toFixed(1)} s in)`);
    const det = await B.page.locator('.gr-details').textContent();
    check(/Play this song/.test(det) && /Try it/.test(det) && /Keep it/.test(det) && /Guitar tone/.test(det), 'beside it: Play this song (Bo has it), and Try it / Keep it for the tone');
    await A.page.waitForFunction(() => /Bo is watching|is watching your clips/.test(document.querySelector('.gr-me')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    check(/is watching your clips/.test(await A.page.locator('.gr-me').textContent()), 'Alex sees someone is watching');
    await shot(B, 'gr-5-watching.png');
    // keep the tone: it arrives whole, without Alex's own cabinet file
    await B.page.locator('.gr-details button:has-text("Keep it")').click();
    await B.page.waitForFunction(() => /is in your tones/.test(document.querySelector('.toasts')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const kept = B.saved[0];
    check(kept && kept.name === 'Crunchy Plexi' && kept.gear.length === 1 && kept.gear[0].knobs.gain === 7 && !kept.ir && /Alex/.test(kept.from.song), `Keep it saves Alex’s tone in Bo’s tones (${kept && kept.name}, from ${kept && kept.from.song})`);

    // message Alex about the clip: Bo needs a name first
    await B.page.locator('.gr-details button:has-text("Message Alex")').click();
    await B.page.waitForSelector('.gr-compose.off');
    check(/Pick a name to answer/.test(await B.page.locator('.gr-compose').textContent()), 'without a name, Bo is asked to pick one to write');
    await B.page.locator('.gr-compose .btn:has-text("Come in")').click();
    await B.page.locator('.gr-ask input').fill('Alex');
    await B.page.locator('.modal button:has-text("Come in")').click();
    await B.page.waitForFunction(() => /taken|already|someone/i.test(document.querySelector('.gr-err')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    check(/./.test(await B.page.locator('.gr-err').textContent()), `a name someone here has is refused (“${await B.page.locator('.gr-err').textContent()}”)`);
    await B.page.locator('.gr-ask input').fill('Bo');
    await B.page.locator('.modal button:has-text("Come in")').click();
    await B.page.waitForSelector('.gr-type', { timeout: 10000 });
    check(/About your clip “Paranoid”|About/.test(await B.page.locator('.gr-thread').textContent()), 'the message is marked as about the clip');
    await B.page.locator('.gr-type').fill('That solo! What pickup were you on?');
    await B.page.keyboard.press('Enter');
    await B.page.waitForFunction(() => /Delivered/.test(document.querySelector('.gr-msg.out .gr-mmeta')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    check(/Delivered/.test(await B.page.locator('.gr-msg.out .gr-mmeta').last().textContent()), 'Bo’s message says “Delivered”');
    // Alex gets a note and opens it from there
    await A.page.waitForSelector('.toast:has-text("Message from Bo")', { timeout: 8000 }).catch(() => {});
    check((await A.page.locator('.toast:has-text("Message from Bo")').count()) === 1, 'Alex gets a note: “Message from Bo”');
    check(/Messages\s*1/.test(await A.page.locator('.gr-tabs').textContent()), 'and the Messages tab counts one new');
    await A.page.locator('.toast:has-text("Message from Bo") button:has-text("Open")').click();
    await A.page.waitForSelector('.gr-msg.in');
    const th = await A.page.locator('.gr-thread').textContent();
    check(/What pickup/.test(th) && /About “Paranoid”/.test(th), 'Alex reads it, with the clip it’s about');
    await A.page.locator('.gr-type').fill('Bridge, tone rolled back a bit.');
    await A.page.locator('.gr-compose .btn:has-text("Send")').click();
    await B.page.waitForFunction(() => /Bridge, tone rolled back/.test(document.querySelector('.gr-msgs')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    check(/Bridge, tone rolled back/.test(await B.page.locator('.gr-msgs').textContent()), 'Bo gets the answer in the same conversation');
    check(!/Messages\s*\d/.test(await A.page.locator('.gr-tabs').textContent()), 'once read, Alex’s new-message count goes away');
    await shot(A, 'gr-6-alex-messages.png');
    await shot(B, 'gr-7-bo-messages.png');

    // a long video, and the connection drops partway: it reconnects and carries on
    const long = Buffer.concat([vid, require('crypto').randomBytes(6 * 1024 * 1024)]);
    A.takes.push({ id: 'k_dddddddddd', kind: 'video', name: 'Long take', file: 'Videos/SH - Long take.mp4', seconds: 300, at: now, bytes: long.length, data: long, slow: 250, about: aboutClip({ part: 'jam' }) });
    await A.room.setShared('k_dddddddddd', true);
    await B.page.locator('.gr-tabs [data-tab="room"]').click();
    await B.page.waitForSelector('.gr-card:has-text("Long take")', { timeout: 15000 });
    await B.page.locator('.gr-card:has-text("Long take")').click();
    await B.page.waitForFunction(() => /([3-9]\d)%/.test(document.querySelector('.gr-progress-text')?.textContent || ''), null, { timeout: 40000 });
    await A.page.evaluate(() => [...window.host.peers.values()].forEach((pc) => pc.close()));
    await B.page.waitForFunction(() => /reconnecting/.test(document.querySelector('.gr-player')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    check(/reconnecting/.test(await B.page.locator('.gr-player').textContent()), 'a dropped connection shows “reconnecting”');
    await shot(B, 'gr-8-reconnecting.png');
    await B.page.waitForSelector('.gr-player video', { timeout: 90000 });
    const blobSize = await B.page.evaluate(async () => (await (await fetch(document.querySelector('.gr-player video').src)).blob()).size);
    check(blobSize === long.length, `after reconnecting the whole video arrives (${blobSize} of ${long.length} bytes)`);

    // Alex takes the first clip out: it leaves Bo's room
    await A.page.locator('.gr-tabs [data-tab="mine"]').click();
    await A.page.locator('.gr-row[data-clip="k_aaaaaaaaaa"] .gr-show.on').click();
    await B.page.waitForFunction(() => ![...document.querySelectorAll('.gr-card')].some((c) => c.dataset.clip === 'k_aaaaaaaaaa'), null, { timeout: 15000 }).catch(() => {});
    check(!(await B.page.locator('.gr-card[data-clip="k_aaaaaaaaaa"]').count()), 'a clip taken out leaves everyone’s Green Room');

    // Alex closes Stagehand: Bo sees them go
    await A.room.close();
    await B.page.waitForSelector('.gr-empty:has-text("Nobody else is here")', { timeout: 15000 }).catch(() => {});
    check((await B.page.locator('.gr-empty:has-text("Nobody else is here")').count()) === 1, 'when Alex closes Stagehand they leave the room');
    await shot(B, 'gr-9-gone.png');
  } finally {
    await browser.close();
    if (A) await A.room.close().catch(() => {});
    if (B) await B.room.close().catch(() => {});
    relay.server.closeAllConnections();
    relay.server.close();
    web.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const bad = results.filter((x) => !x).length;
  console.log(bad ? `${bad} failed` : 'green room: all passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
