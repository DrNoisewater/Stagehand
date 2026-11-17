/* 4.23: Settings › Display in the full page (a pretend screen) and the TV safe area round the app and the highway.
   SH_AUDIT=test/e2e/display-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('display'));
  await page.waitForTimeout(900);
  const pane = await page.locator('.settings section').textContent();
  check(/This screen/.test(pane) && /1920 × 1080/.test(pane) && /125%/.test(pane) && /144 Hz/.test(pane), `Display says what screen it's on (${pane.slice(0, 160)})`);
  check(/TV safe area/.test(pane) && /Roku/.test(pane) && /Picture size/.test(pane), 'it has the TV safe area and the Roku TV tip');
  await page.locator('.disp-seg button', { hasText: '125%' }).click();
  await page.waitForTimeout(500);
  check(/125%/.test(await page.locator('.disp-seg button[aria-pressed="true"]').first().textContent()), 'picking 125% is remembered');
  await page.locator('.disp-range input').fill('5');
  await page.waitForTimeout(900);
  const safe = await page.evaluate(() => ({ on: document.documentElement.dataset.safe, x: getComputedStyle(document.body).left, pattern: !!document.querySelector('.safe-pattern') }));
  check(safe.on === '1' && parseFloat(safe.x) > 70 && safe.pattern, `a 5% border goes round the app, with the picture to check it (${JSON.stringify(safe)})`);
  await page.screenshot({ path: path.join(outDir, 'display-settings.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // the highway inside the border: its top bar and its edges within the window, nothing cut off
  const id = await page.evaluate(async () => { const { state } = await import('./js/store.js'); return [...state.songs.keys()][0]; });
  await page.evaluate(async (id) => (await import('./js/actions.js')).playAlong(id, { autoplay: false }), id);
  await page.waitForFunction(() => { const r = document.querySelector('.highway'); return r && !r.hidden; }, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const hw = await page.evaluate(() => {
    const r = document.querySelector('.highway').getBoundingClientRect();
    const back = document.querySelector('.highway .hw-back, .highway [data-back], .highway button');
    const bb = back ? back.getBoundingClientRect() : null;
    return { left: r.left, top: r.top, right: innerWidth - r.right, bottom: innerHeight - r.bottom, back: bb && bb.left >= r.left && bb.top >= r.top };
  });
  check(hw.left > 70 && hw.top > 40 && hw.right > 70 && hw.bottom > 40 && hw.back, `the highway sits inside the border, its buttons too (${JSON.stringify(hw)})`);
  await page.screenshot({ path: path.join(outDir, 'display-highway-safe.png') });
  await page.evaluate(() => window.__shHighway.leave());
  await page.waitForTimeout(600);
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('display'));
  await page.waitForTimeout(700);
  await page.locator('.disp-foot button').click();
  await page.waitForTimeout(700);
  check(await page.evaluate(() => !document.documentElement.dataset.safe), 'Reset this screen takes the border away');
  await page.keyboard.press('Escape');
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
};
