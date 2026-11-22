/** 4.26: the arrow keys move the song only on Now playing (the waveform, the tab view; the highway has its
 * own); on the Gear page they walk the pedals instead.
 *   SH_AUDIT=test/e2e/arrows-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out> */
module.exports = async ({ page, check, outDir }) => {
  for (let i = 0; i < 4 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape'), await page.waitForTimeout(250);
  await page.setViewportSize({ width: 1600, height: 950 });
  const go = (p) => page.evaluate(async (p) => (await import('./js/store.js')).setPage(p), p);
  const pos = () => page.evaluate(async () => (await import('./js/stage.js')).engine.position);
  // a song loaded on Now playing
  await page.evaluate(async () => {
    const { state } = await import('./js/store.js');
    await (await import('./js/actions.js')).playSong([...state.songs.values()][0].id, { autoplay: false }).catch(() => {});
  });
  await page.waitForTimeout(3000);
  // off the highway (it has its own arrows), onto Now playing's waveform
  for (let i = 0; i < 3 && (await page.evaluate(async () => (await import('./js/stage.js')).highwayOpen())); i++) await page.keyboard.press('Escape'), await page.waitForTimeout(500);
  await go('now');
  await page.waitForTimeout(800);
  await page.evaluate(async () => (await import('./js/stage.js')).seekTo(10));
  await page.waitForTimeout(300);
  let a = await pos();
  await page.mouse.click(5, 900).catch(() => {});
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  let b = await pos();
  check(b - a > 3, `on Now playing the right arrow moves the song on (${a.toFixed(1)} → ${b.toFixed(1)})`);

  // the Gear page: the arrows walk the pedals, the song stays put
  await go('gear');
  await page.waitForSelector('.sr-card', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.locator('.sr-card').first().click();
  await page.waitForTimeout(400);
  const picked = () => page.evaluate(() => (document.querySelector('.sr-card.on') || {}).dataset?.key || '');
  a = await pos();
  const k0 = await picked();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const k1 = await picked();
  check(k1 && k1 !== k0, `on the Gear page the right arrow picks the next pedal (${k0} → ${k1})`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  check((await picked()) === k0, 'the left arrow goes back to the one before');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  const k2 = await picked();
  check(k2 && k2 !== k0 && k2 !== k1, `the down arrow picks the pedal below (${k2})`);
  b = await pos();
  check(Math.abs(b - a) < 1.5, `the song didn't move on the Gear page (${a.toFixed(1)} → ${b.toFixed(1)})`);
  await page.screenshot({ path: require('path').join(outDir, 'arrows-gear.png') }).catch(() => {});
};
