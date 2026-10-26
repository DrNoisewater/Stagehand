/*
 * End-to-end run of the real Electron app with Playwright.
 * Usage: xvfb-run -a node test/e2e/run.js <electronBinary> <vgmstream-cli> test/e2e/fake-engine/python <outDir>
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const [electronBin, vgm, fakePy, outDir] = process.argv.slice(2);
const APP = path.join(__dirname, '..', '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-e2e-'));
const songs = path.join(home, 'dlc');
fs.mkdirSync(path.join(songs, 'Sub folder'), { recursive: true });
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.copyFileSync(path.join(APP, 'test/fixtures/integration_p.psarc'), path.join(songs, 'integration_p.psarc'));
fs.copyFileSync(path.join(APP, 'test/fixtures/legacy_p.psarc'), path.join(songs, 'Sub folder', 'testtest_v1_p.psarc'));
fs.copyFileSync(path.join(APP, 'test/fixtures/partial_p.psarc'), path.join(songs, 'not_a_song_p.psarc'));
fs.writeFileSync(
  path.join(home, 'data', 'settings.json'),
  JSON.stringify({ tools: { vgmstream: vgm }, engine: fakePy ? { python: fakePy } : {}, stems: { auto: false } })
);
fs.mkdirSync(outDir, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('  screenshot', name);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await electron.launch({
    executablePath: electronBin,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', APP],
    env: { ...process.env, STAGEHAND_HOME: home, STAGEHAND_NO_SPLASH: "1" },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.stagehand && document.querySelector('#sidebar'), null, { timeout: 20000 }); // waitForReady
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 900);
    w.center();
  });
  await page.waitForLoadState('domcontentloaded');
  await wait(1200);
  await shot(page, '01-empty');

  // Add the folder and wait for the scan
  await page.evaluate((p) => window.stagehand.library.addFolder(p), songs);
  await page.waitForFunction(() => document.querySelectorAll('.row').length >= 2, null, { timeout: 15000 });
  await wait(800);
  await shot(page, '02-library');

  // Select + play the first song
  const row = page.locator('.row', { hasText: 'The Test' });
  await row.click();
  await wait(400);
  await row.dblclick();
  await page.waitForFunction(() => !document.querySelector('.play-btn').disabled, null, { timeout: 20000 });
  await wait(2500);
  await shot(page, '03-playing');
  const pos = await page.evaluate(() => document.querySelector('.timecode .now').textContent);
  console.log('  timecode after play:', pos);

  // Separate stems through the fake engine
  if (fakePy) {
    await page.locator('.stems-call .btn.primary').click();
    await wait(900);
    await shot(page, '04-separating');
    await page.waitForFunction(() => document.querySelector('.seg button[title^="Hear the stem"]') && !document.querySelector('.seg button[title^="Hear the stem"]').disabled, null, { timeout: 30000 });
    await wait(1800);
    await shot(page, '05-stems');
    // mute guitar, solo nothing, lower bass
    await page.keyboard.press('Digit1');
    await wait(300);
    await page.evaluate(() => {
      const f = document.querySelectorAll('.lane-head .fader')[1];
      f.value = '0.35';
      f.dispatchEvent(new Event('input'));
    });
    await wait(1200);
    await shot(page, '06-mixer');
    await page.keyboard.press('Equal');
    await page.keyboard.press('Equal');
    await wait(1500);
    await shot(page, '06b-zoomed');
    await page.keyboard.press('Digit0');
    const box = await page.locator('.ruler').boundingBox();
    await page.mouse.dblclick(box.x + box.width * 0.5, box.y + 8);
    await wait(1200);
    await shot(page, '06c-loop');
  }

  // Edit metadata
  await page.keyboard.press('Space');
  await row.click();
  await page.keyboard.press('F2');
  await wait(300);
  await shot(page, '07-edit');
  await page.fill('input[name=title]', 'The Test (Live)');
  await page.fill('input[name=year]', '1999');
  await page.click('.edit-buttons .btn.primary');
  await page.waitForFunction(() => [...document.querySelectorAll('.row .t')].some((e) => e.textContent === 'The Test (Live)'), null, { timeout: 15000 });
  await wait(600);
  await shot(page, '08-saved');

  // Grid view
  await page.click('button[title="Covers"]');
  await wait(800);
  await shot(page, '09-grid');
  await page.click('button[title="List"]');

  // Context menu + settings
  await page.locator('.row').first().click({ button: 'right' });
  await wait(300);
  await shot(page, '10-menu');
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 300);
  await page.click('#btn-settings');
  await wait(600);
  await shot(page, '11-settings');
  await page.click('.settings .nav-item[data-tab="stems"]');
  await wait(900);
  await shot(page, '12-settings-stems');
  await page.keyboard.press('Escape');

  // Organize dialog
  await page.evaluate(() => document.querySelector('.lib-tools button[title="More"]').click());
  await wait(300);
  await page.locator('.menu button', { hasText: 'Rename files' }).click();
  await wait(900);
  await shot(page, '13-organize');
  await page.keyboard.press('Escape');

  const lib = (await page.evaluate(() => window.stagehand.library.get())).value;
  console.log('  songs:', lib.songs.map((s) => `${s.title} / ${s.artist} / ${s.year} / ${s.tuning} / stems=${s.hasStems}`).join(' | '));
  console.log('  unreadable:', JSON.stringify(lib.unreadable));
  const log = (await page.evaluate(() => window.stagehand.app.log())).value;
  fs.writeFileSync(path.join(outDir, 'app-log.txt'), log.join('\n'));
  fs.writeFileSync(path.join(outDir, 'console.txt'), errors.join('\n'));
  console.log(`  console errors/warnings: ${errors.length}`);
  errors.slice(0, 20).forEach((e) => console.log('   ', e));
  await app.close();
  console.log('  home:', home);
})().catch(async (err) => {
  console.error('E2E FAILED', err);
  process.exit(1);
});
