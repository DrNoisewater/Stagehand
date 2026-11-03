/**
 * The real app in Electron (4.1.2): Getting started. A fresh install with no songs
 * and no Rocksmith gets the guide by itself; every step opens; "Set it up for me"
 * makes a songs folder (in Music) and watches Downloads; a song arriving turns the
 * last check green; closing it means it isn't offered again. Shots gs-1…7.png.
 *
 *   ELECTRON=<path to electron> xvfb-run -a node test/e2e/guide-electron.js <outDir>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'sh-guide-out-'));
fs.mkdirSync(outDir, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-guide-home-'));
const results = [];
const check = (ok, msg) => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};
const launch = () => _electron.launch({ executablePath: process.env.ELECTRON, args: ['--no-sandbox', ROOT], env: { ...process.env, HOME: home, XDG_MUSIC_DIR: path.join(home, 'Music'), STAGEHAND_HOME: path.join(home, 'sh'), STAGEHAND_NO_EXTERNAL: '1' } });

(async () => {
  let app = await launch();
  let page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await page.waitForFunction(() => window.stagehand && document.querySelector('#app'), null, { timeout: 30000 });
  const shown = await page.waitForSelector('.gs', { timeout: 15000 }).then(() => true, () => false);
  check(shown, 'a fresh install offers Getting started by itself');
  const titles = await page.$$eval('.gs-step span', (s) => s.map((x) => x.textContent));
  check(titles.length === 7, `seven steps: ${titles.join(' · ')}`);
  for (let i = 0; i < titles.length; i++) {
    await page.click(`.gs-step:nth-child(${i + 1})`);
    await page.waitForTimeout(400);
    const h3 = await page.$eval('.gs-body h3', (e) => e.textContent);
    check(h3 === titles[i], `step ${i + 1} opens: ${h3}`);
    if (h3 === 'Get ready for songs') {
      await page.waitForSelector('.gs-status', { timeout: 5000 });
      await page.waitForTimeout(500);
      check(/doesn’t have a place for songs/.test(await page.$eval('.gs-status', (e) => e.textContent)), 'without Rocksmith: says there is no place for songs yet');
      await page.screenshot({ path: path.join(outDir, `gs-${i + 1}a.png`) });
      await page.click('.gs-body button.primary');
      await page.waitForFunction(() => /Ready\./.test((document.querySelector('.gs-status') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
      const t = await page.$eval('.gs-status', (e) => e.textContent);
      check(/Ready\./.test(t) && /Stagehand Songs/.test(t), `“Set it up for me” works: ${t}`);
      check(fs.existsSync(path.join(home, 'Music', 'Stagehand Songs')), 'the songs folder was made in Music');
      const st = await page.evaluate(() => window.stagehand.imports.status().then((r) => r.value));
      check(st.watch && /Stagehand Songs/.test(st.target.path), 'Downloads are watched, new songs go to the songs folder');
    }
    await page.screenshot({ path: path.join(outDir, `gs-${i + 1}.png`) });
  }
  // Back / Next / Done
  await page.click('.gs-step:nth-child(5)');
  check(/No songs yet/.test(await page.$eval('.gs-status', (e) => e.textContent)), 'first song step: no songs yet');
  // a song arrives (the library tells the page): the check turns green by itself
  await page.evaluate(async () => {
    const { state, emit } = await import('./js/store.js');
    state.songs.set('x', { id: 'x', title: 'Test', artist: 'Someone' });
    emit('library');
  });
  await page.waitForTimeout(300);
  check(/You have 1 song/.test(await page.$eval('.gs-status', (e) => e.textContent)), 'a song arriving turns it green');
  await page.click('.gs-step:nth-child(7)');
  check((await page.$eval('.modal footer .btn.primary span', (e) => e.textContent)) === 'Done', 'the last step says Done');
  await page.click('.modal footer .btn.primary');
  await page.waitForTimeout(300);
  check(!(await page.$('.gs')), 'Done closes it');
  // the menu opens it again
  await page.click('.nav-section[data-page="guide"]');
  check(await page.waitForSelector('.gs', { timeout: 5000 }).then(() => true, () => false), 'Getting started in the menu opens it');
  await page.keyboard.press('Escape');
  await page.click('.modal footer .btn.ghost').catch(() => {});
  await page.waitForTimeout(800);
  await app.close();
  // next start: not offered again
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => window.stagehand && document.querySelector('#app'), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  check(!(await page.$('.gs')), 'not offered again after it was closed');
  await app.close().catch(() => {});
  fs.rmSync(home, { recursive: true, force: true });
  console.log(results.every(Boolean) ? 'all passed' : 'some failed');
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.error('FAIL', e.stack || e.message);
  process.exit(1);
});
