/** 4.11: the tuner is one press away on every page, and has two looks to choose from.
 *   SH_AUDIT=test/e2e/tuner-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(outDir, `tuner-${name}.png`) }); };
  const go = async (name) => { await page.evaluate(async (n) => (await import('./js/store.js')).setPage(n), name); await page.waitForTimeout(700); };
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1500, height: 900 });
  for (const pg of ['songs', 'tones', 'progress', 'discover']) {
    await go(pg);
    // 4.14: the guitar's chip in the banner's top-right corner carries the tuner
    check((await page.locator('.gchip .gchip-tuner:visible').count()) === 1, `the Tuner button is in the top-right corner on the ${pg} page`);
  }
  await go('songs');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('u');
  await page.waitForTimeout(600);
  check((await page.locator('.modal .tuner3.tn-solo').count()) === 1, 'U opens the tuner from the Songs page');
  await shot('needle');
  check(!(await page.locator('.modal .tuner3').evaluate((e) => e.classList.contains('tower'))), 'it opens in the needle look to start with');
  await page.locator('.modal .tn-look').click();
  await page.waitForTimeout(400);
  check(await page.locator('.modal .tuner3').evaluate((e) => e.classList.contains('tower')), 'one click switches it to the tower look');
  const tower = await page.locator('.modal .tn-tower').boundingBox();
  check(tower && tower.height > 150, 'the tower look has a tall meter');
  // a note a little sharp: the dot sits above the middle; in tune: on it
  // (set and read in one go: the live tuner keeps writing where the needle is)
  const pos = await page.evaluate(() => {
    const el = document.querySelector('.modal .tuner3'), dot = el.querySelector('.tn-t-dot'), c = el.querySelector('.tn-t-col').getBoundingClientRect();
    dot.style.transition = 'none';
    el.classList.add('heard', 'sharp');
    el.style.setProperty('--off', '22');
    const d = dot.getBoundingClientRect();
    return (d.top + d.height / 2 - c.top) / c.height;
  });
  check(Math.abs(pos - 0.28) < 0.03, `22 cents sharp puts the dot above the middle (${pos.toFixed(2)} of the way down)`);
  const labels = await page.locator('.modal .tn-strings button small').allTextContents();
  check(labels[0] === '6th' && labels[labels.length - 1] === '1st', `each string button says which string it is (${labels.join(' ')})`);
  await shot('tower');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await page.locator('.modal').count()) === 0, 'Escape closes it');
  // the look is remembered and shared: Jam's tuner card has it too
  await go('play');
  check(await page.locator('.tuner3').first().evaluate((e) => e.classList.contains('tower')), 'the Jam page’s tuner takes the same look');
  // Settings › Appearance › Pick your look
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(500);
  await page.locator('.modal').getByText('Appearance', { exact: true }).first().click();
  await page.waitForTimeout(600);
  const row = page.locator('.looks-row').filter({ hasText: 'Tuner' });
  check((await row.locator('button[aria-pressed="true"]').textContent()) === 'Tower', 'Settings › Appearance › Pick your look shows the tuner’s look');
  await row.getByText('Needle').click();
  await page.waitForTimeout(300);
  check(!(await page.locator('.tuner3').first().evaluate((e) => e.classList.contains('tower'))), 'choosing Needle there changes the tuner');
  check((await page.locator('.looks-row').filter({ hasText: 'Songs' }).locator('button').count()) === 2, 'the song list’s List or Tiles choice is there too');
  await shot('settings');
  await page.keyboard.press('Escape');
  check(!errs.length, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
