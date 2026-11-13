/*
 * Note highway end to end: opens full screen, draws gems with fret numbers,
 * moves smoothly (no clock or camera jumps), options, Back/Esc.
 * xvfb-run -a node test/e2e/highway.js <electron> <vgmstream-cli> <fake-python> <outDir>
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const [electronBin, vgm, fakePy, outDir] = process.argv.slice(2);
const APP = path.join(__dirname, '..', '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-hw-'));
const songs = path.join(home, 'dlc');
fs.mkdirSync(songs, { recursive: true });
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.copyFileSync(path.join(APP, 'test/fixtures/integration_p.psarc'), path.join(songs, 'integration_p.psarc'));
fs.copyFileSync(path.join(APP, 'test/fixtures/legacy_p.psarc'), path.join(songs, 'testtest_p.psarc'));
fs.writeFileSync(path.join(home, 'data', 'settings.json'), JSON.stringify({ tools: { vgmstream: vgm }, engine: { python: fakePy }, stems: { auto: false } }));
fs.mkdirSync(outDir, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, n) => page.screenshot({ path: path.join(outDir, `${n}.png`) }).then(() => console.log('  screenshot', n));
const check = (cond, what) => {
  console.log(`  ${cond ? 'ok ' : 'FAIL'} ${what}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const app = await electron.launch({ executablePath: electronBin, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', APP], env: { ...process.env, STAGEHAND_HOME: home, STAGEHAND_NO_SPLASH: "1" } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.stagehand && document.querySelector('#sidebar'), null, { timeout: 20000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.evaluate((p) => window.stagehand.library.addFolder(p), songs);
  await page.waitForFunction(() => document.querySelectorAll('.row').length >= 2, null, { timeout: 20000 });
  await page.locator('.row', { hasText: 'The Test' }).dblclick();
  await page.waitForFunction(() => !document.querySelector('.play-btn').disabled, null, { timeout: 20000 });
  await page.keyboard.press('Space');

  await page.click('.stage-right button:has-text("Highway")');
  await page.waitForSelector('.highway:not([hidden]) .hw-parts .hw-chip', { timeout: 10000 });
  await wait(800);
  const fs1 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  check(fs1, 'window went full screen');
  const parts = await page.locator('.hw-parts .hw-chip').allTextContents();
  check(parts.length === 2, `parts: ${parts.join(' | ')}`);

  await page.click('.hw-sections button:has-text("Melody")');
  await page.keyboard.press('Space');
  // Sample the clock and camera every frame for 4 s
  const motion = await page.evaluate(
    () =>
      new Promise((res) => {
        const H = document.querySelector('.highway').__hw;
        const out = [];
        const t0 = performance.now();
        const f = (now) => {
          out.push({ now, clock: H.clock, cam: H.cam.f, px: H.cam.px });
          if (now - t0 < 4000) requestAnimationFrame(f);
          else res(out);
        };
        requestAnimationFrame(f);
      })
  );
  let worstClock = 0;
  let worstCam = 0;
  for (let i = 1; i < motion.length; i++) {
    const dt = (motion[i].now - motion[i - 1].now) / 1000;
    const dc = motion[i].clock - motion[i - 1].clock;
    worstClock = Math.max(worstClock, Math.abs(dc - dt));
    worstCam = Math.max(worstCam, Math.abs(motion[i].cam - motion[i - 1].cam) / Math.max(dt, 0.001));
  }
  check(worstClock < 0.02, `clock steady: worst frame error ${(worstClock * 1000).toFixed(1)} ms over ${motion.length} frames`);
  check(worstCam < 10.5, `camera glides: fastest ${worstCam.toFixed(1)} frets/s`);
  // Frozen just before the notes arrive, to see them coming
  const at = async (t) => {
    await page.evaluate(async (t) => {
      const st = await import('./js/stage.js');
      void st;
    }, t);
  };
  void at;
  await page.keyboard.press('Space');
  await page.click('.hw-sections button:has-text("Melody")'); // seeks to 1 s before
  await wait(700);
  await shot(page, 'h1-lead');
  await page.keyboard.press('Space');
  await wait(2100);
  await page.keyboard.press('Space');
  await wait(400);
  await shot(page, 'h2-lead-later');

  await page.click('.hw-parts .hw-chip:has-text("Bass")');
  await page.click('.hw-sections button:has-text("Melody")');
  await wait(1500);
  await shot(page, 'h3-bass');
  const lit = await page.evaluate(() => {
    const c = document.querySelector('.hw-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    for (let i = 0; i < d.length; i += 4 * 3) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++;
    return white;
  });
  check(lit > 20, `white fret numbers drawn (${lit} samples)`);

  await page.click('.hw-icon[title="Highway options"]');
  await page.click('.menu button:has-text("6 seconds")');
  await page.click('.hw-speed-chip');
  await page.click('.speed-pop .sp-picks button:text-is("75")');
  await page.keyboard.press('Escape');
  await wait(1200);
  await shot(page, 'h4-6s-75pct');
  await page.click('.hw-parts .hw-chip:has-text("Lead")');
  await page.click('.hw-sections button:has-text("Melody")');
  await wait(1500);
  await shot(page, 'h5-lead-6s');

  // Song mix: split stems from the highway, then turn one off and set a volume
  await page.click('.hw-top button:has-text("Mix")');
  await page.click('.hw-mix button:has-text("Split stems")');
  await page.waitForFunction(() => document.querySelectorAll('.hw-mix-row').length >= 4, null, { timeout: 60000 });
  await wait(600);
  const rows = await page.locator('.hw-mix-row .name').allTextContents();
  check(rows.length >= 4, `mix rows: ${rows.join(', ')}`);
  const yours = await page.evaluate(() => [...document.querySelectorAll('.hw-mix-row')].filter((r) => r.querySelector('.you')).map((r) => r.querySelector('.name').textContent));
  check(yours.length === 1 && yours[0] === 'Guitar', `play along takes out: ${yours}`);
  await page.click('.hw-mix-row:has-text("Drums") .hw-mix-on');
  await wait(300);
  const drumsOff = await page.getAttribute('.hw-mix-row:has-text("Drums") .hw-mix-on', 'aria-checked');
  check(drumsOff === 'false', 'drums turned off');
  const vol = page.locator('.hw-mix-row:has-text("Vocals") .stem-vol');
  await vol.focus();
  await vol.evaluate((el) => {
    el.value = '0.3';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(300);
  const v = await page.evaluate(async () => {
    const st = await import('./js/stage.js');
    void st;
    return document.querySelector('.hw-mix-row:has(.name) .stem-vol') && [...document.querySelectorAll('.hw-mix-row')].find((r) => r.querySelector('.name').textContent === 'Vocals').querySelector('.stem-vol').value;
  });
  check(v === '0.3', `vocals volume set to ${v}`);
  await shot(page, 'h6-mix');
  await page.click('.hw-mix-row:has-text("Drums") .hw-mix-on');
  await page.click('.hw-set-btn');
  await wait(500);
  const box = await page.evaluate(() => [document.querySelector('.hw-dock').classList.contains('collapsed'), Math.round(document.querySelector('.hw-mix').getBoundingClientRect().left), window.innerWidth, getComputedStyle(document.querySelector('.hw-dock')).visibility]);
  check(box[0] && box[1] >= box[2] - 2 && box[3] === 'hidden', `mix tucks away off the right edge (${box.join(', ')})`);
  await shot(page, 'h6b-mix-collapsed');

  // Every tone, on the bass part too
  await page.click('.hw-parts .hw-chip:has-text("Bass")');
  await wait(600);
  await page.click('.hw-top button:has-text("Your guitar")');
  await page.waitForSelector('.hw-top button:has-text("Tone:")', { timeout: 10000 });
  await page.click('.hw-top button:has-text("Tone:")');
  const toneItems = await page.locator('.menu button').allTextContents();
  check(['Metal', 'Lead', 'Clean', 'Bass grit'].every((x) => toneItems.some((y) => y.startsWith(x))), `tone menu: ${toneItems.map((x) => x.replace(/✓/, '')).join(' | ')}`);
  await shot(page, 'h7-tones');
  await page.click('.menu button:has-text("Metal")');
  await wait(300);
  const tl = await page.locator('.hw-top button:has-text("Tone:")').textContent();
  check(/Metal/.test(tl), `bass part playing through ${tl}`);

  await page.keyboard.press('Escape');
  await wait(800);
  const closed = await page.evaluate(() => document.querySelector('.highway').hidden && !document.getElementById('app').classList.contains('under-highway'));
  const fs2 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  check(closed && !fs2, 'Esc goes back and leaves full screen');
  await page.keyboard.press('h');
  await page.waitForSelector('.highway:not([hidden])');
  await page.click('.hw-back');
  check(await page.evaluate(() => document.querySelector('.highway').hidden), 'H opens it again, Back closes it');

  console.log('  errors:', errors.length, errors.slice(0, 5).join(' / '));
  if (errors.length) process.exitCode = 1;
  await app.close();
})().catch((e) => {
  console.error('FAILED', e.stack || e.message);
  process.exit(1);
});
