/* Run: TRIAL_DIR=test/e2e/style-trials TRIALS=brown,club,tweed,daylight,recordshop,gigposter,mahogany,bluenote SH_AUDIT=test/e2e/style-trials/trial-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>  (TRIAL_PROBE=1 lists hard-to-read text and dark blocks) */
/* Style trials: for each trial CSS, take pictures of the main pages. TRIALS=dir with name.css files (and 'brown', 'club' built in). */
const path = require('path'), fs = require('fs');
module.exports = async ({ page, outDir }) => {
  const dir = process.env.TRIAL_DIR;
  const names = (process.env.TRIALS || 'brown,club').split(',');
  const pages = (process.env.TRIAL_PAGES || 'songs,play,tones,gear,progress').split(',');
  const [W, H] = (process.env.TRIAL_SIZE || '1440x900').split('x').map(Number);
  await page.setViewportSize({ width: W, height: H });
  const go = async (p) => { await page.evaluate(async (p) => (await import('./js/store.js')).setPage(p), p); await page.waitForTimeout(1500); };
  const closeModals = async () => { for (let i = 0; i < 5 && (await page.locator('.modal').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } };
  await closeModals();
  await page.addStyleTag({ content: '.lvup,.toasts{display:none!important}' });
  for (const n of names) {
    let css = (n === 'brown' || n === 'club') ? '' : fs.readFileSync(path.join(dir, n + '.css'), 'utf8'); if (/@use _light/.test(css)) css = fs.readFileSync(path.join(dir, '_light.css'), 'utf8') + css;
    await page.evaluate(({ css, club }) => {
      document.getElementById('trial-css')?.remove();
      const l = document.querySelector('link[href*="club.css"]'); if (l) l.disabled = !club;
      const s = document.createElement('style'); s.id = 'trial-css'; s.textContent = css; document.head.appendChild(s);
    }, { css, club: n === 'club' || /@base club/.test(css) });
    for (const p of pages) {
      await go(p); await closeModals();
      if (p === 'tones') { const mine = page.locator('.mine-items .tone-item .ti-main'); if (await mine.count()) { await mine.first().click().catch(() => {}); await page.waitForTimeout(600); await closeModals(); } }
      await page.screenshot({ path: path.join(outDir, `${n}-${p}.png`) });
      if (process.env.TRIAL_PROBE) { const bad = await page.evaluate(`(${require('./probe-contrast.js').toString()})()`); console.log(`== ${n} ${p}: ${bad.length} low-contrast`); bad.slice(0,60).forEach(b => console.log('  ' + b)); const dk = await page.evaluate(`(${require('./probe-dark.js').toString()})()`); console.log(`-- dark blocks: ${dk.length}`); dk.slice(0,60).forEach(b => console.log('  ' + b)); }
    }
  }
};
