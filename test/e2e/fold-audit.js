/* 4.26: the fold that says "What every control does" is on screen without scrolling, with the pedal still big,
   in the Gear page, Create a tone and Tones, at 1366x768, 1920x1080 and 2560x1440. Also: the Lab's footswitches click
   on and click off (Hold stays as a choice). Writes fold-*.png.
   SH_AUDIT=test/e2e/fold-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const go = async (p) => { await page.evaluate(async (p) => (await import('./js/store.js')).setPage(p), p); await page.waitForTimeout(1200); };
  const closeModals = async () => { for (let i = 0; i < 5 && (await page.locator('.modal').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } };
  const quiet = () => page.addStyleTag({ content: '.lvup,.toasts,.toast{display:none!important}' });
  const SIZES = [[1366, 768], [1920, 1080], [2560, 1440]];
  // where the fold's header is, against the window; and how big the pedal picture is
  const measure = (root) => page.evaluate((root) => {
    const r = document.querySelector(root);
    const d = r && r.querySelector('details.gear-sheet');
    const s = d && d.querySelector('summary');
    const pic = r && r.querySelector('.gear-faceplate, .gb-photo img, .gb-photo svg');
    if (!s) return null;
    const b = s.getBoundingClientRect(), p = pic ? pic.getBoundingClientRect() : { width: 0, height: 0 };
    // a header hidden by a scroll area's edge doesn't count as visible
    let el = s.parentElement, clip = innerHeight;
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll|hidden)/.test(cs.overflowY)) clip = Math.min(clip, el.getBoundingClientRect().bottom);
      el = el.parentElement;
    }
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), clip: Math.round(clip), vh: innerHeight, open: d.open, picW: Math.round(p.width), picH: Math.round(p.height), cat: location.hash };
  }, root);
  const seen = (m) => m && m.top >= 0 && m.bottom <= m.clip + 1 && m.bottom <= m.vh;
  await closeModals();
  await quiet();
  await page.evaluate(() => { try { localStorage.setItem('stagehand.sheetOpen', '0'); } catch (_) {} });

  for (const [w, hgt] of SIZES) {
    await page.setViewportSize({ width: w, height: hgt });
    // the Gear page
    await go('gear');
    await page.locator('#page-gear .sr-shelf', { hasText: 'The Lab' }).first().click();
    await page.waitForTimeout(300);
    await page.locator('#page-gear .sr-card', { hasText: 'Quack' }).first().click();
    await page.waitForTimeout(1200);
    let m = await measure('#page-gear .sr-show');
    check(seen(m), `${w}x${hgt} Gear page: the fold's header is in view (${JSON.stringify(m)})`);
    check(m && m.picH >= hgt * 0.38, `${w}x${hgt} Gear page: the pedal stays big (${m && m.picW}x${m && m.picH})`);
    await page.screenshot({ path: path.join(outDir, `fold-gear-${w}.png`) });
    // opening it works and the header stays in reach
    await page.locator('#page-gear .gear-sheet > summary').first().click();
    await page.waitForTimeout(500);
    m = await measure('#page-gear .sr-show');
    check(m && m.open && m.top >= 0 && m.top < hgt, `${w}x${hgt} Gear page: it opens (${JSON.stringify(m)})`);
    await page.screenshot({ path: path.join(outDir, `fold-gear-${w}-open.png`) });
    await page.locator('#page-gear .gear-sheet > summary').first().click();
    await page.waitForTimeout(300);

    // Create a tone
    await page.evaluate(async () => (await import('./js/rigroom.js')).openRig({ kind: 'guitar' }));
    await page.waitForTimeout(1500);
    await page.locator('.rr-shelf', { hasText: 'The Lab' }).first().click();
    await page.waitForTimeout(300);
    await page.locator('.rr-grid .rr-card', { hasText: 'Quack' }).first().click();
    await page.waitForTimeout(1200);
    await quiet();
    m = await measure('.rr-inspect');
    check(seen(m), `${w}x${hgt} Create a tone: the fold's header is in view (${JSON.stringify(m)})`);
    check(m && m.picH >= hgt * 0.25, `${w}x${hgt} Create a tone: the pedal stays big (${m && m.picW}x${m && m.picH})`);
    await page.screenshot({ path: path.join(outDir, `fold-rig-${w}.png`) });
    await page.locator('.rr-close').click();
    await page.waitForTimeout(500);
    for (let i = 0; i < 2 && (await page.locator('.modal').count()); i++) {
      const discard = page.locator('.modal button', { hasText: /^(Close|Discard|Leave)$/ }).first();
      if (await discard.count()) await discard.click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }

  // Tones: a tone's pedal (the first block on the chain that is a pedal, else any)
  for (const [w, hgt] of SIZES) {
    await page.setViewportSize({ width: w, height: hgt });
    await go('tones');
    const mine = page.locator('.mine-items .tone-item .ti-main');
    if (await mine.count()) await mine.nth(Math.min(1, (await mine.count()) - 1)).click();
    await page.waitForTimeout(700);
    await closeModals();
    const ed = page.locator('#page-tones button', { hasText: 'Edit tone' }).first();
    if (await ed.count()) await ed.click();
    await page.waitForTimeout(1200);
    await quiet();
    const m = await measure('.rr-inspect');
    check(seen(m), `${w}x${hgt} Tones, Edit tone: the fold's header is in view (${JSON.stringify(m)})`);
    await page.screenshot({ path: path.join(outDir, `fold-tones-${w}.png`) });
    await page.locator('.rr-close').click();
    await page.waitForTimeout(500);
    const cl = page.locator('.modal button', { hasText: /^(Close|Discard|Leave)$/ }).first();
    if (await cl.count()) await cl.click();
    await closeModals();
  }
  check(!errs.length, `no errors on the page${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
