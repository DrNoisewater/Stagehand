/**
 * 4.27.1: one click on a song in Songs plays its preview and nothing else: no stems are split
 * (before, with Split songs automatically on, picking a song queued its split after a moment).
 * A double-click opens the song, and that's what starts the split.
 *   SH_AUDIT=test/e2e/click-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
 */
module.exports = async ({ page, check, stemHold }) => {
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape'), await page.waitForTimeout(200);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(async () => (await import('./js/store.js')).setPage('songs'));
  await page.waitForTimeout(700);
  // automatic splitting on, the splitter installed, and two songs that haven't been split
  const ids = await page.evaluate(async () => {
    const { state } = await import('./js/store.js');
    const { api } = await import('./js/api.js');
    state.settings.stems = { ...(state.settings.stems || {}), auto: true };
    state.engine = { ...(state.engine || {}), installed: true, ok: true };
    const ids = [...state.songs.keys()].slice(0, 2);
    for (const id of ids) state.songs.get(id).hasStems = false;
    window.__asked = [];
    for (const k of ['ahead', 'request', 'prioritize']) {
      const was = api.stems[k];
      api.stems[k] = (...a) => (window.__asked.push(k), was ? was(...a) : Promise.resolve(true));
    }
    return ids;
  });
  for (const id of ids) stemHold.add(id);

  await page.locator(`[data-id="${ids[0]}"] .tt-text`).first().click();
  await page.waitForTimeout(400);
  await page.locator(`[data-id="${ids[1]}"] .tt-text`).first().click();
  await page.waitForTimeout(2000); // longer than the old wait before a split was queued
  let r = await page.evaluate(() => {
    const b = document.querySelector('.pv-bar');
    return { asked: window.__asked.slice(), bar: b && !b.hidden ? b.textContent : '' };
  });
  check(r.asked.length === 0, `one click splits nothing (asked for: ${JSON.stringify(r.asked)})`);
  check(/Preview/.test(r.bar), `one click plays the song's preview (${r.bar})`);
  // the keyboard moves the pick too: still nothing split
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(1500);
  r = await page.evaluate(() => window.__asked.slice());
  check(r.length === 0, `moving the pick with the keyboard splits nothing (${JSON.stringify(r)})`);

  await page.locator(`[data-id="${ids[1]}"] .tt-text`).first().dblclick();
  let opened = false;
  for (let i = 0; i < 30 && !opened; i++) {
    await page.waitForTimeout(200);
    opened = await page.evaluate(() => window.__asked.length > 0);
  }
  r = await page.evaluate(() => window.__asked.slice());
  check(opened, `a double-click opens the song and starts its split (${JSON.stringify(r)})`);
  for (const id of ids) stemHold.delete(id);
};
