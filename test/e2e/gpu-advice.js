/*
 * A GTX 1080 Ti machine with the CPU-only engine installed: the app must say so and offer the switch.
 * xvfb-run -a node test/e2e/gpu-advice.js <electron> <vgmstream-cli> <outDir>
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const [electronBin, vgm, outDir] = process.argv.slice(2);
const APP = path.join(__dirname, '..', '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-gpu-'));
const songs = path.join(home, 'dlc');
fs.mkdirSync(songs, { recursive: true });
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.copyFileSync(path.join(APP, 'test/fixtures/integration_p.psarc'), path.join(songs, 'integration_p.psarc'));
fs.writeFileSync(
  path.join(home, 'data', 'settings.json'),
  JSON.stringify({ tools: { vgmstream: vgm }, engine: { python: path.join(APP, 'test/e2e/fake-engine/python') }, stems: { auto: false } })
);
const GPUS = [{ name: 'NVIDIA GeForce GTX 1080 Ti', vendor: 'nvidia', computeCap: 6.1, driver: '581.29', source: 'nvidia-smi' }];
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, n) => page.screenshot({ path: path.join(outDir, `${n}.png`) }).then(() => console.log('  screenshot', n));

(async () => {
  const app = await electron.launch({
    executablePath: electronBin,
    args: ['--no-sandbox', APP],
    env: { ...process.env, STAGEHAND_HOME: home, STAGEHAND_NO_SPLASH: "1", STAGEHAND_FAKE_GPUS: JSON.stringify(GPUS), FAKE_ENGINE_DELAY: '0.35' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.stagehand && document.querySelector('#sidebar'), null, { timeout: 20000 }); // waitForReady
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.evaluate((p) => window.stagehand.library.addFolder(p), songs);
  await page.waitForFunction(() => document.querySelectorAll('.row').length >= 1, null, { timeout: 15000 });

  const status = (await page.evaluate(() => window.stagehand.engine.status(true))).value;
  console.log('  advice:', status.advice.kind, '|', status.advice.detail);

  // Settings > Stems
  await page.click('#btn-settings');
  await page.click('.settings .nav-item[data-tab="stems"]');
  await page.waitForSelector('text=Switch to GPU', { timeout: 10000 });
  await wait(400);
  await shot(page, 'g1-settings');
  await page.selectOption('select[aria-label="CPU load"]', 'half');
  await wait(300);
  // The switch button opens the GPU dialog
  await page.click('.setting >> text=Switch to GPU');
  await page.waitForSelector('.modal >> text=Use your graphics card for stems', { timeout: 5000 });
  await wait(300);
  await shot(page, 'g2-switch-dialog');
  await page.click('.modal footer >> text=Not now');
  await page.keyboard.press('Escape');
  await wait(300);

  // Split a song on the CPU and watch the hint
  await page.locator('.row').first().dblclick();
  await page.waitForFunction(() => !document.querySelector('.play-btn').disabled, null, { timeout: 20000 });
  await page.locator('.stems-call .btn.primary').click();
  await page.waitForSelector('.stems-call >> text=Switch to GPU', { timeout: 15000 });
  await wait(600);
  await shot(page, 'g3-splitting-on-cpu');
  await page.waitForSelector('.toast >> text=Stems ready', { timeout: 30000 });
  await wait(1200);
  await shot(page, 'g4-done');
  const log = (await page.evaluate(() => window.stagehand.app.log())).value;
  console.log('  log:', log.filter((l) => /Separating|took/.test(l)).map((l) => l.replace(/^\[[^\]]+\] /, '')).join(' | '));
  console.log('  errors:', errors.length, errors.slice(0, 5).join(' / '));
  await app.close();
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
