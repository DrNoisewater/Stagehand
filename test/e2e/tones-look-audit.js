/* 4.25: Tones looks like Songs and Gear: a page head with the count, flat key list, flat tone rows,
   the picked tone's big name, flat key buttons. Pictures in the Roadshow and Rehearsal Room looks,
   at 1500×900 and 1280×720, with Songs and Gear beside them to compare.
   SH_AUDIT=test/e2e/tones-look-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const go = async (p) => { await page.evaluate(async (p) => (await import('./js/store.js')).setPage(p), p); await page.waitForTimeout(1200); };
  const closeModals = async () => { for (let i = 0; i < 5 && (await page.locator('.modal').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } };
  const quiet = () => page.addStyleTag({ content: '.lvup,.toasts{display:none!important}' });
  const look = async (name) => {
    await page.evaluate(async (name) => {
      const m = await import('./js/menu-art.js');
      m.appearancePrefs.look = name;
      m.director.write(m.storage('localStorage'), m.APPEARANCE_KEY, m.appearancePrefs);
      document.documentElement.dataset.look = name;
    }, name);
    await page.waitForTimeout(300);
  };
  const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  await closeModals();
  await quiet();

  for (const lk of ['roadshow', 'opera']) {
    await look(lk);
    for (const [w, hgt] of [[1500, 900], [1280, 720]]) {
      await page.setViewportSize({ width: w, height: hgt });
      await go('songs');
      await shot(`${lk}-${w}-songs`);
      await go('gear');
      await shot(`${lk}-${w}-gear`);
      await go('tones');
      // pick one of your tones (on a key) so the right side shows it
      const mine = page.locator('.mine-items .tone-item .ti-main');
      if (await mine.count()) await mine.nth(Math.min(1, (await mine.count()) - 1)).click();
      await page.waitForTimeout(700);
      await closeModals();
      await shot(`${lk}-${w}-tones`);
      await page.evaluate(() => { const l = document.querySelector('.tones-list'); if (l) l.scrollTop = l.scrollHeight; });
      await page.waitForTimeout(300);
      await shot(`${lk}-${w}-tones-scrolled`);
      await page.evaluate(() => { const l = document.querySelector('.tones-list'); if (l) l.scrollTop = 0; });
    }
  }

  // the page head and the pieces the tests use are all there
  await look('roadshow');
  await page.setViewportSize({ width: 1500, height: 900 });
  await go('tones');
  const info = await page.evaluate(() => {
    const t = document.querySelector('#page-tones .tones-head h1');
    const cs = t && getComputedStyle(t);
    return {
      title: t && t.textContent,
      upper: cs && cs.textTransform,
      count: (document.querySelector('#page-tones .tones-head .sub') || {}).textContent || '',
      keys: document.querySelectorAll('.tk-keys .tk-card').length,
      create: !!document.querySelector('.tones-head .tw-create'),
      name: !!document.querySelector('.tones-edit [aria-label="Tone name"]'),
      putKeys: document.querySelectorAll('.tones-edit .ts-keys .ts-key').length,
    };
  });
  check(info.title === 'Tones' && info.upper === 'uppercase', `the page head says TONES in capitals (${info.title}, ${info.upper})`);
  check(/tone/.test(info.count), `with a count line under it (“${info.count}”)`);
  check(info.keys === 9 && info.create, `keys 1–9 and Create tone are there (${info.keys})`);
  check(info.name && info.putKeys === 8, `the picked tone has its name to edit and keys 2–9 to put it on (${info.putKeys})`);

  // renaming still works: the name is the title, typing changes it and Save changes appears
  const nameEl = page.locator('.tones-edit [aria-label="Tone name"]');
  if (await nameEl.count()) {
    const was = await nameEl.inputValue();
    await nameEl.click();
    await nameEl.press('End');
    await nameEl.type(' X');
    await page.waitForTimeout(300);
    const btn = await page.locator('.tones-edit .te-save').textContent();
    check(btn === 'Save changes' || btn === 'Save tone', `typing in the name marks it changed (${btn})`);
    await shot('roadshow-1500-tones-renaming');
    await page.locator('.tones-edit .te-revert').click().catch(() => {});
    await page.waitForTimeout(400);
    check((await nameEl.inputValue()) === was, 'Revert puts the name back');
  }
  // the arrow keys still move through the list
  await page.locator('.mine-items .tone-item .ti-main').first().click();
  await page.waitForTimeout(400);
  const a = await page.locator('.tone-item.on .ti-main b').first().textContent();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);
  const b = await page.locator('.tone-item.on .ti-main b').first().textContent();
  check(a !== b, `↓ moves to the next tone (${a} → ${b})`);
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
};
