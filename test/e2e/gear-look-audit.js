/* 4.24: the Gear page's pedal is always shown large, its words fold away without moving it, and coming back keeps the page.
   SH_AUDIT=test/e2e/gear-look-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const go = async (p) => { await page.evaluate(async (p) => (await import('./js/store.js')).setPage(p), p); await page.waitForTimeout(1500); };
  await go('gear');
  await page.locator('.sr-shelf', { hasText: 'The Lab' }).click();
  await page.waitForTimeout(500);
  await page.locator('.sr-card', { hasText: 'Quack' }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'gear-quack.png') });
  const size = await page.evaluate(() => {
    const pic = document.querySelector('.sr-show .gb-pic, .sr-show .gb-art, .sr-show img, .sr-show canvas');
    const r = pic ? pic.getBoundingClientRect() : null;
    return r ? { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight } : null;
  });
  console.log('GEAR pedal picture', JSON.stringify(size));
  for (const k of ['Amps', 'Cabinets']) {
    await page.locator('.sr-shelf', { hasText: k }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.sr-card').first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, `gear-${k.toLowerCase()}.png`) });
  }
  // Create a tone with Quack picked
  await page.evaluate(async () => (await import('./js/rigroom.js')).openRig({ kind: 'guitar' }));
  await page.waitForTimeout(1500);
  await page.locator('.rr-shelf', { hasText: 'The Lab' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.rr-grid .rr-card', { hasText: 'Quack' }).first().click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(outDir, 'rig-quack-full.png') });
  await page.evaluate(() => { const i = document.querySelector('.rr-inspect'); if (i) i.scrollIntoView(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'rig-quack-inspect.png') });
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
};
