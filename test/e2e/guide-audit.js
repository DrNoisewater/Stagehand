/** 4.17.1: Getting started in the real page: every page opens, stays short, and every Show me finds its control.
 *   SH_AUDIT=test/e2e/guide-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const closeAll = async () => { for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
  await closeAll();
  await page.setViewportSize({ width: 1500, height: 900 });
  const open = async (i) => { await page.evaluate(async (i) => (await import('./js/guide.js')).openGuide({ step: i }), i); await page.waitForTimeout(350); };
  await open(0);
  const groups = await page.locator('.gs-steps .gs-group').allTextContents();
  check(groups.length === 4, `the guide has four parts (${groups.join(' | ')})`);
  const listed = await page.locator('.gs-steps .gs-step').count();
  check(listed <= 5, `only the part you're in is listed in full (${listed} lines)`);
  const seen = [];
  const long = [];
  let shows = 0;
  let lost = [];
  for (let i = 0; i < 30; i++) {
    const title = await page.locator('.gs-body h3').textContent();
    seen.push(title);
    const info = await page.evaluate(() => { const b = document.querySelector('.gs-body'); return { steps: b.querySelectorAll('ol.how-steps > li').length, lists: b.querySelectorAll('ol.how-steps').length, scroll: b.scrollHeight - b.clientHeight }; });
    if (info.steps > 4 || info.scroll > 4) long.push(`${title}: ${info.steps} steps, ${info.scroll}px too tall`);
    if ([0, 2, 4, 5, 13, 16].includes(i)) await page.screenshot({ path: path.join(outDir, `guide-${String(i).padStart(2, '0')}.png`) });
    const show = page.locator('.modal button', { hasText: /^Show me$/ });
    if (await show.count()) {
      shows++;
      await show.click();
      await page.waitForTimeout(900);
      const ok = await page.evaluate(() => { const r = document.querySelector('.gs-ring'); return !!r && !r.hidden; });
      if (!ok) lost.push(title);
      await page.locator('.gs-tip button', { hasText: 'Back to the guide' }).click();
      await page.waitForTimeout(350);
    }
    const next = page.locator('.modal .modal-footer button, .modal footer button', { hasText: /^(Next|Done)$/ }).last();
    if ((await next.textContent()).trim() === 'Done') break;
    await next.click();
    await page.waitForTimeout(250);
  }
  check(seen.length === 17 && new Set(seen).size === 17, `Next walks every page once (${seen.length}: ${seen.join(', ')})`);
  check(!long.length, `every page is short: four steps at most, nothing to scroll (${long.join('; ')})`);
  check(shows >= 7 && !lost.length, `every Show me circles its control (${shows} of them; lost: ${lost.join(', ')})`);
  for (const t of ['Sing and Karaoke', 'Piano', 'Quest headset']) check(seen.includes(t), `the tour has ${t}`);
  // the overview: a card jumps to its page
  await open(4);
  const cards = await page.locator('.gs-card').count();
  await page.locator('.gs-card', { hasText: 'Sing and Karaoke' }).click();
  await page.waitForTimeout(300);
  check(cards === 11 && (await page.locator('.gs-body h3').textContent()) === 'Sing and Karaoke', `everything is on one page of cards, and a card opens its page (${cards})`);
  // a folded part opens when pressed
  await page.locator('.gs-group-btn', { hasText: 'Get set up' }).click();
  await page.waitForTimeout(300);
  check((await page.locator('.gs-body h3').textContent()) === 'Welcome', 'pressing a folded part opens it');
  await closeAll();
  // the import button is gone from Settings › Library
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('library'));
  await page.waitForTimeout(700);
  check(!/Import Rocksmith DLC/.test(await page.locator('.modal').textContent()), 'Settings › Library has no Import Rocksmith DLC button');
  await page.screenshot({ path: path.join(outDir, 'settings-library.png') });
  await closeAll();
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
};
