/* Checks the first-run decoder download path: xvfb-run -a node test/e2e/decoder.js <electron> <outDir> */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const [electronBin, outDir] = process.argv.slice(2);
const APP = path.join(__dirname, '..', '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-dec-'));
const songs = path.join(home, 'dlc');
fs.mkdirSync(songs, { recursive: true });
fs.copyFileSync(path.join(APP, 'test/fixtures/integration_p.psarc'), path.join(songs, 'integration_p.psarc'));
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const app = await electron.launch({ executablePath: electronBin, args: ['--no-sandbox', APP], env: { ...process.env, STAGEHAND_HOME: home, STAGEHAND_NO_SPLASH: "1", PATH: '/usr/bin:/bin', NODE_USE_ENV_PROXY: '1' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.stagehand && document.querySelector('#sidebar'), null, { timeout: 20000 }); // waitForReady
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.evaluate((p) => window.stagehand.library.addFolder(p), songs);
  await page.waitForFunction(() => document.querySelectorAll('.row').length >= 1, null, { timeout: 15000 });
  await page.locator('.row').first().dblclick();
  await new Promise((r) => setTimeout(r, 4000));
  await page.screenshot({ path: path.join(outDir, 'decoder-prompt.png') });

  await page.waitForSelector('text=Install audio decoder', { timeout: 15000 });
  await page.screenshot({ path: path.join(outDir, 'decoder-prompt.png') });
  await page.click('text=Install audio decoder');
  await new Promise((r) => setTimeout(r, 20000));
  await page.screenshot({ path: path.join(outDir, 'decoder-after.png') });
  console.log('LOG2', (await page.evaluate(() => window.stagehand.app.log())).value.slice(-3));
  await page.waitForFunction(() => !document.querySelector('.play-btn').disabled, null, { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(outDir, 'decoder-done.png') });
  console.log('decoder installed and song plays:', (await page.evaluate(() => window.stagehand.tools.vgmstream())).value);
  await app.close();
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
