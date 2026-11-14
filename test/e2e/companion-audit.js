/** 4.16: the Quest companion's bridge, the real server and page, with a pretend Quest browser.
 *   SH_AUDIT=test/e2e/companion-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 * - off until switched on (Settings › Quest headset); on: the address and a code
 * - the headset page: type the code, the library shows, the PC lists the headset as connected
 * - a song picked in the headset opens on the PC (paused); play, seek and pause go both ways
 * - the headset's song clock matches the PC's; a reload reconnects with no code; Forget and Off work */
const path = require('path');
const QUEST_UA = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.0 SamsungBrowser/4.0 Chrome/128.0.0.0 VR Safari/537.36';

module.exports = async ({ page, outDir, check, companion }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pc: ${e.message}`));
  page.on('console', (m) => /Quest companion/.test(m.text()) && errs.push(`pc: ${m.text()}`));
  const shot = (p, n) => p.screenshot({ path: path.join(outDir, `q-${n}.png`) });
  const wait = (ms) => page.waitForTimeout(ms);
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 950 });
  const pc = () => page.evaluate(async () => {
    const st = await import('./js/stage.js');
    const s = st.current();
    return { id: s ? s.id : null, title: s ? s.title : null, playing: st.engine.playing, pos: st.engine.position, at: performance.timeOrigin + performance.now(), hw: st.highwayOpen() };
  });

  // ---- off until switched on
  check(!companion.server, 'the companion is off to start with');
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('quest'));
  await wait(700);
  const sw = page.locator('.modal input[aria-label="Quest companion"]');
  check((await sw.count()) === 1 && !(await sw.isChecked()), 'Settings › Quest headset has the switch, off');
  await shot(page, '1-settings-off');
  await sw.click();
  await wait(900);
  check(!!companion.server, 'switched on: it listens');
  const code = (await page.locator('.quest-code').textContent()).trim();
  const addr = (await page.locator('.quest-addr').textContent()).trim();
  check(/^\d{4}$/.test(code) && code === companion.code, `a 4-digit code shows (${code})`);
  check(/^https:\/\/.+:\d+$/.test(addr), `the address shows (${addr})`);
  await shot(page, '2-settings-on');
  // nothing has reached the PC yet; pretend Windows said the firewall blocks it on a Public network
  companion.firewall = { state: 'blocked', network: 'Public', netName: 'MyHome', at: Date.now() };
  companion._changed();
  await wait(500);
  const help = await page.locator('.modal').textContent();
  check(/Nothing has reached this PC/.test(help) && /Windows Firewall is blocking Stagehand/.test(help) && /as Public/.test(help) && /Allow an app through Windows Firewall/.test(help), 'nothing reached yet: Settings says the firewall blocks it and what to click');
  await shot(page, '2b-settings-blocked');
  companion.firewall = null;
  companion.countLoopback = true; // the pretend headset below is on this PC
  // typed without https://: sent on to the secure page
  const redir = await new Promise((resolve) => require('http').get({ host: '127.0.0.1', port: companion.port, path: '/' }, (res) => (res.resume(), resolve(res.headers.location || ''))).on('error', () => resolve('')));
  check(redir === `https://127.0.0.1:${companion.port}/`, `http:// is sent on to https:// (${redir})`);

  // ---- the headset
  // its own browser (the app's runs as one process, which can't open a second window)
  const qb = await require(process.env.PLAYWRIGHT || 'playwright').chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await qb.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 760 }, userAgent: QUEST_UA });
  const q = await ctx.newPage();
  q.on('pageerror', (e) => errs.push(`quest: ${e.message}`));
  const url = `https://127.0.0.1:${companion.port}/`;
  await q.goto(url);
  await q.waitForSelector('#pair:not([hidden])', { timeout: 8000 });
  check(true, 'the headset page asks for the code');
  await wait(400);
  const seen = await page.locator('.modal').textContent();
  check(/The headset reached Stagehand|The page opened in the headset/.test(seen), 'Settings says the headset got through');
  await q.locator('#pad button:has-text("1")').first().click(); // a wrong first try
  for (const d of '234') await q.locator(`#pad button:text-is("${d}")`).click();
  await q.waitForTimeout(400);
  const msg = await q.locator('#pairMsg').textContent();
  check(code === '1234' || /not the code/.test(msg), `a wrong code says so (${msg})`);
  await shot(q, '3-quest-pair');
  if (code !== '1234') for (const d of code) await q.locator(`#pad button:text-is("${d}")`).click();
  await q.waitForSelector('#home:not([hidden])', { timeout: 5000 });
  await q.waitForSelector('.row', { timeout: 5000 });
  const rows = await q.locator('.row').count();
  const libCount = (await page.evaluate(async () => (await import('./js/store.js')).state.songs.size));
  check(rows > 0 && rows === Math.min(250, libCount), `the headset lists the library (${rows} of ${libCount})`);
  await wait(500);
  check((await page.locator('.quest-dev .status-pill.ok').count()) === 1 && /Meta Quest 3/.test(await page.locator('.quest-dev-name').first().textContent()), 'the PC shows the Quest as connected');
  await shot(page, '4-settings-connected');
  await page.keyboard.press('Escape');
  await wait(300);

  // ---- a song picked in the headset
  const pickTitle = (await q.locator('.row .t').nth(1).textContent()).trim();
  await q.locator('.row').nth(1).click();
  let p = null;
  for (let i = 0; i < 40; i++) {
    await wait(150);
    p = await pc();
    if (p.title === pickTitle) break;
  }
  check(p && p.title === pickTitle, `picked in the headset, it opens on the PC (${p && p.title})`);
  check(p && !p.playing, 'it opens paused (you pick up the guitar first)');
  check(p && p.hw, 'the PC shows the highway');
  await q.waitForTimeout(600);
  check((await q.locator('#nowTitle').textContent()) === pickTitle, 'the headset shows it as playing now');
  check((await q.locator('.row.on .t').textContent()) === pickTitle, 'and marks it in the list');

  // ---- play from the headset; the clocks agree
  await q.locator('#play').click();
  for (let i = 0; i < 30 && !(await pc()).playing; i++) await wait(150);
  check((await pc()).playing, `play in the headset plays on the PC${(await pc()).playing ? '' : ` (${JSON.stringify(await page.evaluate(async () => { const st = await import('./js/stage.js'); const i = st.loadInfo(); return { phase: i.phase, box: !!document.querySelector('.hw-syncbox:not([hidden])') }; }))})`}`);
  await wait(2500);
  const diffs = [];
  for (let i = 0; i < 8; i++) {
    const a = await pc();
    const b = await q.evaluate(() => ({ pos: window.__companion.songPos(), at: performance.timeOrigin + performance.now() }));
    // the PC's position carried forward to the moment the headset was asked
    diffs.push(Math.abs(b.pos - (a.pos + (b.at - a.at) / 1000)));
    await wait(120);
  }
  diffs.sort((x, y) => x - y);
  const med = diffs[diffs.length >> 1];
  check(med < 0.05, `the headset's song clock matches the PC's (median ${(med * 1000).toFixed(1)} ms off)`);
  await shot(q, '5-quest-playing');
  await shot(page, '6-pc-highway');

  // ---- step 2: the notes reach the headset, and its own highway draws them
  const pcTargets = await page.evaluate(() => (window.__shHighway && window.__shHighway.targets() ? window.__shHighway.targets().length : 0));
  let qChart = 0;
  for (let i = 0; i < 20 && !qChart; i++) {
    qChart = await q.evaluate(() => (window.__companion.chart && window.__companion.chart.targets ? window.__companion.chart.targets.length : 0));
    if (!qChart) await q.waitForTimeout(200);
  }
  check(pcTargets > 0 && qChart === pcTargets, `the headset has the part's notes (${qChart} of ${pcTargets})`);
  check(/notes ready/.test(await q.locator('#vrNote').textContent()), 'the headset says the notes are ready');
  // the PC paused just before the notes start, so the highway has some coming
  const t0 = await q.evaluate(() => window.__companion.chart.targets[0].t);
  await page.evaluate(async (t) => { const st = await import('./js/stage.js'); if (st.engine.playing) st.toggle(); st.seekTo(t); }, Math.max(0, t0 + 0.6));
  await wait(800);
  // pretend the PC's judge heard the first notes, one of them missed
  const near = await q.evaluate(() => {
    const c = window.__companion.chart;
    const t = window.__companion.songPos();
    return c.targets.filter((x) => x.t <= t + 0.01).slice(0, 4).map((x) => x.i);
  });
  if (near.length) {
    const ev = near.map((id, k) => [id, k === 1 ? 0 : 1]);
    companion.pushState({ ...companion.last, at: companion.last.at, judge: { hits: ev.filter((e) => e[1]).length, judged: ev.length, streak: 2, best: 2, ev, reset: true } });
    await q.waitForTimeout(300);
    const got = await q.evaluate((ids) => ids.map((id) => window.__companion.marks.get(id)), near);
    check(JSON.stringify(got) === JSON.stringify(ev.map((e) => e[1])), `hits and misses from the PC reach the headset (${JSON.stringify(got)})`);
  } else check(false, 'no notes near the playhead to mark');
  await q.locator('#preview').click();
  await q.waitForFunction(() => window.__companion.stage && window.__companion.stage.stats.total >= 3, null, { timeout: 30000 }).catch(() => {});
  const vr = await q.evaluate(() => ({ ...window.__companion.stage.stats }));
  check(vr.total >= 3, `the headset's highway runs (${vr.total} frames, ${vr.fps} a second here in software graphics)`);
  check(vr.drawn > 0, `notes are on it (${vr.drawn})`);
  await shot(q, '7-quest-highway');
  const d0 = await q.evaluate(() => window.__companion.stage.prefs.dist);
  await q.evaluate(() => window.__companion.stage.press('far'));
  const saved = await q.evaluate(() => JSON.parse(localStorage.getItem('stagehand.vr') || '{}').dist);
  check(Math.abs(saved - (d0 + 0.05)) < 1e-6, 'the highway moved farther, and that is remembered');
  await q.evaluate(() => window.__companion.stage.press('near'));
  await q.evaluate(() => window.__companion.stage.press('play'));
  await wait(900);
  check((await pc()).playing, 'the menu in the headset plays the PC');
  await q.waitForTimeout(1200);
  await q.evaluate(() => window.__companion.stage.press('play'));
  await wait(900);
  check(!(await pc()).playing, 'and pauses it');
  await shot(q, '8-quest-highway-paused');
  await q.locator('#stageBack').click();
  await q.waitForTimeout(300);
  check(await q.locator('#stageWrap').isHidden(), 'Back leaves the highway');
  await page.evaluate(async () => { const st = await import('./js/stage.js'); if (!st.engine.playing) st.toggle(); }); // playing again for the checks below
  await wait(500);

  // ---- seek from the headset, pause on the PC
  const len = await q.evaluate(() => window.__companion.state.song.length);
  const bar = await q.locator('#bar').boundingBox();
  await q.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
  await wait(900);
  const afterSeek = await pc();
  check(Math.abs(afterSeek.pos - len * 0.5) < 2, `a seek in the headset moves the PC (${afterSeek.pos.toFixed(1)} of ${len.toFixed(1)} s)`);
  await page.evaluate(async () => (await import('./js/stage.js')).toggle());
  await wait(600);
  const qs = await q.evaluate(() => window.__companion.state.playing);
  check(qs === false, 'pause on the PC pauses the headset');
  check((await q.locator('#play .ico').getAttribute('class')).includes('play'), 'the headset shows the play button again');

  // ---- it remembers: a reload connects with no code
  await q.reload();
  await q.waitForSelector('#home:not([hidden])', { timeout: 6000 });
  check(await q.locator('#pair').isHidden(), 'a reload reconnects by itself (no code)');
  check(companion.status().devices.length === 1, 'still one headset (not paired again)');

  // ---- Forget, then Off (leave the highway first, as you would to reach Settings)
  await page.keyboard.press('Escape');
  await wait(500);
  if (await page.locator('.highway:visible').count()) await page.locator('.highway button:has-text("Back")').first().click().catch(() => {});
  await wait(500);
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('quest'));
  await wait(700);
  await page.locator('.quest-dev button:has-text("Forget")').click();
  const asked = await q.waitForSelector('#pair:not([hidden])', { timeout: 8000 }).then(() => true, () => false);
  if (!asked) await shot(q, 'x-forget');
  check(asked, `forgotten on the PC: the headset asks for a code again${asked ? '' : ` (${await q.locator('#linkText').textContent()}, devices ${companion.status().devices.length})`}`);
  await page.locator('.modal input[aria-label="Quest companion"]').click();
  await wait(900);
  check(!companion.server, 'switched off: it stops listening');
  await q.waitForTimeout(800);
  check(/trying again|Looking/.test(await q.locator('#linkText').textContent()), 'the headset says it lost the PC');
  await page.keyboard.press('Escape');
  await qb.close();
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
};
