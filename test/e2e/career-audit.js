/** 4.5: Progress (all tabs), the venue picker's locked previews and the developer menu, on the real page. */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(outDir, `career-${name}.png`) }); };
  const go = async (name) => { await page.evaluate(async (n) => (await import('./js/store.js')).setPage(n), name); await page.waitForTimeout(900); };
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  // 4.5 flicker: rows rebuilt after practice is logged keep the same (already decoded) picture
  await go('songs');
  await page.waitForTimeout(1500);
  const kept = await page.evaluate(async () => {
    const img = document.querySelector('.scroller .row img');
    if (!img) return 'no art in the test songs';
    await new Promise((r) => (img.complete ? r() : img.addEventListener('load', r, { once: true })));
    img.__mark = 1;
    (await import('./js/store.js')).emit('best');
    await new Promise((r) => setTimeout(r, 300));
    const again = document.querySelector('.scroller .row img');
    return again && again.__mark === 1 ? 'same' : 'new';
  });
  check(kept !== 'new', `album art survives a list rebuild without reloading (${kept})`);
  await go('progress');
  await page.waitForTimeout(1500);
  await shot('progress-overview');
  for (const tab of ['career', 'achievements', 'songs', 'history']) {
    const b = page.locator(`.pg-tabs [data-tab="${tab}"]`);
    if (!(await b.count())) { check(false, `Progress has a ${tab} tab`); continue; }
    await b.click();
    await page.waitForTimeout(1300);
    await shot(`progress-${tab}`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab} fits the window`);
  }
  await page.locator('.pg-tabs [data-tab="overview"]').click().catch(() => {});
  check(await page.locator('.pg-level-n').count(), 'the level is shown big');
  check(await page.locator('.pg-nextgig').count(), 'the next venue (next gig) is shown');
  // 4.5: the configuration windows keep one size from section to section
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('library'));
  await page.waitForTimeout(800);
  const sizes = [];
  for (const tab of ['library', 'guitar', 'about', 'storage']) {
    await page.locator(`.settings .nav-item[data-tab="${tab}"]`).click();
    await page.waitForTimeout(500);
    sizes.push(await page.evaluate(() => { const r = document.querySelector('.modal.settings-modal').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }));
  }
  check(new Set(sizes).size === 1, `Settings keeps one size across sections (${sizes.join(', ')})`);
  await shot('settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await go('play');
  await page.waitForTimeout(800);
  const drop = page.locator('.dc').first();
  check(await drop.count(), 'the Drop console is on the Play page');
  check(!(await page.locator('.drop-pedal-face:visible').count()), 'no stray pedal picture in the Drop card');
  if (await drop.count()) {
    await drop.scrollIntoViewIfNeeded();
    await page.locator('.dc .dc-step').nth(1).click();
    await page.waitForTimeout(300);
    check(await page.evaluate(async () => { const { rig } = await import('./js/rig.js'); return rig.drop.on && rig.dropAmount() === 2; }), 'clicking −2 drops two semitones');
    await drop.screenshot({ path: path.join(outDir, 'career-drop.png') });
    await page.locator('.dc .dc-foot').click();
  }
  // developer menu
  await page.keyboard.press('Control+Shift+F12');
  await page.waitForTimeout(800);
  check(await page.locator('.devmenu').count(), 'developer menu opens (developer mode on)');
  await shot('devmenu');
  for (const tab of ['stats', 'testing']) {
    const b = page.locator(`.devmenu [data-dtab="${tab}"]`);
    if (await b.count()) { await b.click(); await page.waitForTimeout(tab === 'testing' ? 400 : 800); await shot(`devmenu-${tab}`); }
  }
  // set level 30 from the menu and check the page follows
  await page.locator('.devmenu [data-dtab="progression"]').click().catch(() => {});
  await page.locator('.devmenu input[name="level"]').fill('30').catch(() => {});
  await page.locator('.devmenu [data-act="setLevel"]').click().catch(() => {});
  await page.waitForTimeout(2500);
  check(await page.evaluate(async () => (await import('./js/rewards.js')).L.st.level) === 30, 'set level 30 from the developer menu');
  await shot('levelup-30');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  for (let i = 0; i < 3 && (await page.locator('.lvup button').count()); i++) await page.locator('.lvup button').first().click().catch(() => {}), await page.waitForTimeout(500);
  await go('progress');
  await shot('progress-overview-30');
  // Rehearsal Room look vs the other: the overview in both
  await page.setViewportSize({ width: 1280, height: 800 });
  await go('progress');
  await shot('progress-1280');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overview fits 1280×800');
};
