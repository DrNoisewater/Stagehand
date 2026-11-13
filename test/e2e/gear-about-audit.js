/** 4.12: the Gear page's spec sheet under the knobs: the real gear, what it does, every knob in words.
 *   SH_AUDIT=test/e2e/gear-about-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.locator('#sidebar .nav-section[data-page="gear"]').first().click();
  await page.waitForSelector('#page-gear .sr-card', { timeout: 15000 });
  const pick = async (name, shot) => {
    await page.fill('#page-gear input[type=search]', name).catch(() => {});
    await page.waitForTimeout(400);
    await page.locator('#page-gear .sr-card', { hasText: name }).first().click();
    await page.waitForTimeout(700);
    const card = await page.evaluate(() => {
      const c = document.querySelector('#page-gear .gear-about');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { real: (c.querySelector('.gear-about-real b') || {}).textContent || '', text: (c.querySelector('.gear-about-text') || {}).textContent || '', knobs: c.querySelectorAll('dt').length, top: Math.round(r.top), right: Math.round(r.right), w: innerWidth };
    });
    check(!!card && card.text.length > 40 && card.knobs > 0, `${name}: a spec sheet with words and ${card && card.knobs} knobs (${card && card.real})`);
    check(!!card && card.right <= card.w, `${name}: it fits on screen`);
    await page.screenshot({ path: path.join(outDir, `gear-about-${shot}.png`) });
  };
  await pick('8-Band Graphic EQ', 'eq');
  await pick('GB-412 MKIII', 'cab');
  await pick('AT-120', 'amp');
  await pick('US Wah', 'wah');
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
};
