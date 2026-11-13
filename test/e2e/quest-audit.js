/** 4.16: the Quest companion end to end: the real app page, the real server, and a pretend headset
 * (a second Chromium page that looks like the Quest's browser).
 *   SH_AUDIT=test/e2e/quest-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 * - Settings › Quest headset: off by default, nothing listening; on: the address and the code
 * - the headset: asked for the code once, the library, a song picked there opens on the PC's highway,
 *   the headset's clock follows the PC's, pause from the headset pauses the PC
 * - put on again (page reloaded): no code; Settings lists it as connected; off lets it go */
const path = require('path');
const net = require('net');
const { Companion } = require('../../src/main/services/companion');
const { merge } = require('../../src/main/services/settings');

const ROOT = path.join(__dirname, '..', '..');

module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = (p, n) => p.screenshot({ path: path.join(outDir, `quest-${n}.png`) });
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 950 });

  // the PC's side, as main.js sets it up, with the app page standing in for the window
  let data = { on: false, port: 0, code: null, devices: [], cert: null };
  const store = { get: () => data, set: (p) => (data = merge(data, p)) };
  const songs = await page.evaluate(async () => [...(await import('./js/store.js')).state.songs.values()]);
  const companion = new Companion({
    pageDir: path.join(ROOT, 'src', 'companion'),
    fontDir: path.join(ROOT, 'src', 'renderer', 'fonts'),
    store,
    port: 0,
    host: '127.0.0.1',
    songs: () => songs,
    loadTab: (id, arr) => page.evaluate(async ([i, a]) => (await import('./js/api.js')).api.tab.load(i, a), [id, arr]),
    version: 'audit',
  });
  const toPage = (ch, p) => page.evaluate(([c, x]) => window.__shEmit(c, x), [ch, p]).catch(() => {});
  companion.on('status', () => toPage('companion:status', companion.status()));
  companion.on('clients', (n) => toPage('companion:clients', n));
  companion.on('command', (m) => toPage('companion:command', m));
  const calls = { state: 0 };
  await page.exposeBinding('__quest', async (_s, name, args) => {
    const [ns, fn] = name.split('.');
    void ns;
    let value = null;
    if (fn === 'status') value = companion.status();
    else if (fn === 'set') {
      data.on = !!args[0];
      value = args[0] ? await companion.start() : await companion.stop();
      toPage('companion:clients', value.clients || 0);
    } else if (fn === 'newCode') value = companion.newCode();
    else if (fn === 'forget') value = companion.forget(args[0]);
    else if (fn === 'state') (calls.state++, companion.running && companion.setState(args[0]));
    else if (fn === 'judged') companion.running && companion.judged(args[0]);
    return { __sh: true, ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
  });
  await page.evaluate(() => {
    const orig = window.__api;
    window.__api = (name, args) => (name.startsWith('companion.') ? window.__quest(name, args) : orig(name, args));
  });

  // ---- Settings › Quest headset, off
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('quest'));
  await page.waitForTimeout(800);
  const sw = page.locator('.settings input.toggle[aria-label="Use a Meta Quest"]');
  check((await sw.count()) === 1, 'Settings has a Quest headset section with one switch');
  check(!(await sw.isChecked()), 'the Quest is off to begin with');
  check(!companion.running, 'nothing listens on the network while it is off');
  check(calls.state === 0, 'the window sends nothing while it is off');
  await shot(page, '1-settings-off');

  // ---- on
  await sw.click();
  await page.waitForTimeout(800);
  check(companion.running, 'switched on: Stagehand listens');
  const code = await page.locator('.quest-code').textContent();
  check(/^\d{4}$/.test(code) && code === data.code, `the code is shown (${code})`);
  check(/:\d+/.test(await page.locator('.quest-addr b').textContent()), 'the address is shown');
  await shot(page, '2-settings-on');

  // ---- the headset
  // its own browser (the app's runs as one process, which can't open a second window)
  const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
  const qBrowser = await chromium.launch();
  const qctx = await qBrowser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/37.0 Chrome/128.0 VR Safari/537.36' });
  const q = await qctx.newPage();
  q.on('pageerror', (e) => errs.push(`headset: ${e.message}`));
  const url = `https://127.0.0.1:${companion.port}/`;
  await q.goto(url);
  await q.waitForSelector('#pair:not([hidden])', { timeout: 8000 });
  check(true, 'a new headset is asked for the code');
  await shot(q, '3-headset-pair');
  // a wrong code first
  const wrong = code === '0000' ? '1111' : '0000';
  for (const d of wrong) await q.locator('#pad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await q.waitForTimeout(400);
  check(/not it/.test(await q.locator('#pairMsg').textContent()), 'a wrong code is refused plainly');
  for (const d of code) await q.locator('#pad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await q.waitForSelector('#main:not([hidden])', { timeout: 5000 });
  await q.waitForTimeout(800);
  const rows = await q.locator('#list .row').count();
  check(rows > 0 && rows === songs.filter((s) => (s.arrangements || []).some((a) => ['lead', 'rhythm', 'bass', 'combo', 'vocals'].includes(a.type))).length, `the headset lists the library (${rows} songs)`);
  await shot(q, '4-headset-library');
  await page.waitForTimeout(400);
  await shot(page, '5-settings-connected');
  check((await page.locator('.quest-dev .status-pill.ok').count()) === 1, 'Settings shows the headset as connected');
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');

  // ---- a song picked on the headset opens on the PC's highway
  const pickId = await q.locator('#list .row').first().getAttribute('data-id');
  await q.locator('#list .row').first().click();
  let opened = false;
  for (let i = 0; i < 60 && !opened; i++) {
    await page.waitForTimeout(250);
    opened = await page.evaluate((id) => !!(window.__shHighway && window.__shHighway.open() && window.__shHighway.songId() === id && window.__shHighway.tab()), pickId);
  }
  check(opened, 'the song picked on the headset opens on the PC’s highway');
  // the first-time timing check offer (it comes up a moment after the highway opens): not now
  await page.waitForTimeout(1500);
  const notNow = page.locator('button:visible:has-text("Not now")');
  if (await notNow.count()) await notNow.first().click().catch(() => {});
  await page.waitForTimeout(1000);
  // pause, then play, from the headset
  const pcPlaying = () => page.evaluate(() => window.__stagePlaying());
  if (await pcPlaying()) {
    await q.locator('#playBtn').click();
    await page.waitForTimeout(800);
    check(!(await pcPlaying()), 'pause on the headset pauses the PC');
  }
  await q.waitForFunction(() => document.getElementById('playBtn').dataset.pl === 'false', null, { timeout: 3000 }).catch(() => {});
  await q.locator('#playBtn').click();
  let playing = false;
  for (let i = 0; i < 40 && !playing; i++) {
    await page.waitForTimeout(200);
    playing = await page.evaluate(() => window.__stagePlaying());
  }
  check(playing, 'play on the headset plays the song on the PC');
  await page.waitForTimeout(2500);
  await shot(page, '6-pc-highway');
  // the headset's clock against the PC's: each read with the moment it was read (both
  // pages share this machine's clock), compared at the same instant
  const diffs = [];
  for (let i = 0; i < 12; i++) {
    const pc = await page.evaluate(async () => {
      const e = (await import('./js/stage.js')).engine;
      return { t: e.position, at: performance.timeOrigin + performance.now() };
    });
    const hs = await q.evaluate(() => {
      const at = performance.timeOrigin + performance.now();
      return { t: window.__companion.clock.target(at), at };
    });
    diffs.push(Math.abs(hs.t + (pc.at - hs.at) / 1000 - pc.t) * 1000);
    await page.waitForTimeout(150);
  }
  const worst = Math.max(...diffs);
  const median = diffs.slice().sort((a, b) => a - b)[diffs.length >> 1];
  const moved = await page.evaluate(async () => (await import('./js/stage.js')).engine.position);
  check(moved > 1, `the song is moving on the PC (${moved.toFixed(1)} s)`);
  // two pages asked one after the other: the asking itself takes a few ms
  check(median < 15 && worst < 40, `the headset's song clock follows the PC's (typically ${median.toFixed(1)} ms off, worst ${worst.toFixed(1)} ms)`);
  const shown = await q.locator('#title').textContent();
  check(shown.length > 0, `the headset shows what's playing (${shown})`);
  await shot(q, '7-headset-playing');

  // pause from the headset
  await q.locator('#playBtn').click();
  await page.waitForTimeout(600);
  check(!(await page.evaluate(() => window.__stagePlaying())), 'pause on the headset pauses the PC');
  await q.waitForTimeout(300);
  check((await q.locator('#playBtn').getAttribute('data-pl')) === 'false', 'the headset shows it paused');

  // ---- put on again: no code
  await q.reload();
  await q.waitForSelector('#main:not([hidden])', { timeout: 6000 }).catch(() => {});
  check(!(await q.locator('#main').isHidden()) && (await q.locator('#pair').isHidden()), 'put on again: straight to the library, no code');
  check(data.devices.length === 1, 'the PC remembers one headset');

  // ---- off lets it go
  await page.evaluate(() => window.__shHighway && window.__shHighway.open() && window.__shHighway.leave());
  await page.waitForTimeout(500);
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('quest'));
  await page.waitForTimeout(600);
  await page.locator('.settings input.toggle[aria-label="Use a Meta Quest"]').click();
  await page.waitForTimeout(800);
  check(!companion.running, 'switched off: nothing listens');
  const open = await new Promise((r) => {
    const s = net.connect(companion.port || data.port || 1, '127.0.0.1');
    s.on('connect', () => (s.destroy(), r(true)));
    s.on('error', () => r(false));
  });
  check(!open, 'the port is closed');
  await q.waitForTimeout(800);
  check(!(await q.locator('#wait').isHidden()), 'the headset says it lost the PC');
  await shot(q, '8-headset-lost');
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await qBrowser.close();
  check(!errs.length, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
