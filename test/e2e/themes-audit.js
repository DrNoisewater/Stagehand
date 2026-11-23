/* 4.29: themes. Settings › Appearance › Theme lists them; a click changes the whole app at once and is kept after a restart.
   Pictures of each theme on the main pages and Settings; lists text that is hard to read (contrast under 3.2) per page.
   SH_AUDIT=test/e2e/themes-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
   THEME_PAGES=songs,play,... picks the pages; THEMES=brown,... picks the themes. */
const path = require('path');
const probe = require('./themes-probe.js');
module.exports = async ({ page, outDir, check }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const go = async (p) => { await page.evaluate(async (p) => (await import('./js/store.js')).setPage(p), p); await page.waitForTimeout(1300); };
  const closeModals = async () => { for (let i = 0; i < 5 && (await page.locator('.modal').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } };
  const settings = async () => { await page.evaluate(async () => (await import('./js/dialogs.js')).settings('appearance')); await page.waitForTimeout(700); };
  await closeModals();
  await page.addStyleTag({ content: '.lvup,.toasts{display:none!important}' });
  check(await page.evaluate(() => document.documentElement.dataset.skin) === 'brown', 'Brown is the theme when none was picked');
  await settings();
  const listed = await page.locator('.theme-pick').evaluateAll((els) => els.map((e) => e.dataset.themeId));
  check(listed.join() === 'brown,mahogany,recordshop,bluenote,club', `Settings › Appearance lists the themes (${listed.join()})`);
  await closeModals();
  const themes = (process.env.THEMES || listed.join()).split(',');
  const pages = (process.env.THEME_PAGES || 'songs,play,tones,gear,progress,discover,greenroom,karaoke').split(',');
  const report = [];
  for (const t of themes) {
    await settings();
    await page.locator(`.theme-pick[data-theme-id='${t}']`).click();
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.documentElement.dataset.skin) === t, `${t}: a click on it changes the app`);
    check(await page.locator(`.theme-pick[data-theme-id='${t}'][aria-pressed='true']`).count() === 1, `${t}: shown as picked`);
    await page.screenshot({ path: path.join(outDir, `theme-${t}-settings.png`) });
    await closeModals();
    for (const p of pages) {
      await go(p); await closeModals();
      if (p === 'tones') { const mine = page.locator('.mine-items .tone-item .ti-main'); if (await mine.count()) { await mine.first().click().catch(() => {}); await page.waitForTimeout(600); await closeModals(); } }
      await page.screenshot({ path: path.join(outDir, `theme-${t}-${p}.png`) });
      const bad = await page.evaluate(`(${probe.toString()})()`);
      report.push(`== ${t} ${p}: ${bad.length}`, ...bad.map((b) => '   ' + b));
    }
  }
  require('fs').writeFileSync(path.join(outDir, 'themes-contrast.txt'), report.join('\n') + '\n');
  // kept after a restart
  await page.reload(); await page.waitForTimeout(2500);
  check(await page.evaluate(() => document.documentElement.dataset.skin) === themes[themes.length - 1], 'the picked theme is kept after a restart');
};
