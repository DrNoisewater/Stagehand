/**
 * After 4.26.0: the stem splitting card is the user's Unmixer animation, over the highway and over the
 * other pages, with no sticker in its corner. It follows the split, its Play now button plays the
 * full mix, and it goes away (stopped) when the stems are in.
 *   SH_AUDIT=test/e2e/unmixer-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
 * Pictures: unmixer-page.png, unmixer-highway.png, unmixer-queued.png.
 */
const path = require('path');
module.exports = async ({ page, outDir, check, stemHold }) => {
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape'), await page.waitForTimeout(200);
  await page.setViewportSize({ width: 1600, height: 900 });
  const shot = (n) => page.screenshot({ path: path.join(outDir, `${n}.png`) });
  const ids = await page.evaluate(async () => [...(await import('./js/store.js')).state.songs.keys()]);
  const id = ids[0];
  const say = (u) => page.evaluate((u) => window.__shEmit('stems:update', u), u);
  const card = () =>
    page.evaluate(() => {
      const box = document.querySelector('.stem-wait');
      const hw = document.querySelector('.hw-status');
      const svgText = (root) => (root ? [...root.querySelectorAll('svg text')].map((t) => t.textContent).join(' | ') : '');
      return {
        shown: !!box && !box.hidden && getComputedStyle(box).display !== 'none',
        unmixer: !!(box && box.querySelector('.stem-card svg')),
        cameo: !!document.querySelector('.sw-cameo'),
        text: svgText(box),
        said: (box && box.querySelector('.sc-said') || {}).textContent || '',
        hwShown: !!hw && !hw.hidden,
        hwUnmixer: !!(hw && hw.querySelector('.hw-st-unmixer svg')),
        hwText: svgText(hw),
        cards: document.querySelectorAll('.stem-card').length,
      };
    });

  // off the highway: a song waiting for its stems
  stemHold.add(id);
  await page.evaluate(async (id) => (await import('./js/stage.js')).load((await import('./js/store.js')).state.songs.get(id), { autoplay: true }), id);
  let c;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(200);
    c = await card();
    if (c.unmixer) break;
  }
  check(c.shown && c.unmixer, `the waiting card is the Unmixer (${JSON.stringify({ shown: c.shown, unmixer: c.unmixer })})`);
  check(!c.cameo, 'no sticker in its corner');
  await say({ songId: id, state: 'running', progress: 0.42, message: 'Separating', eta: 75 });
  await page.waitForTimeout(400);
  c = await card();
  check(/Splitting the stems/.test(c.text) && /42%/.test(c.text), `it follows the split: “${c.text.slice(0, 90)}”`);
  check(/Splitting the stems · 42%/.test(c.said), `and says it in words for screen readers: “${c.said}”`);
  await page.waitForTimeout(600); // let the light move
  await shot('unmixer-page');
  await say({ songId: id, state: 'running', progress: 0.42, message: 'Separating', eta: 75 }); // the same again: nothing changes
  await say({ songId: id, state: 'running', progress: 0.68, message: 'Separating', eta: 40 });
  await page.waitForTimeout(300);
  c = await card();
  check(/68%/.test(c.text), `and keeps up (${c.text.match(/\d+%/)})`);

  // its Play now plays the full mix
  await page.locator('.stem-wait .stem-card [role=button]').click();
  await page.waitForTimeout(500);
  c = await card();
  const playing = await page.evaluate(() => !!(window.__stagePlaying && window.__stagePlaying()));
  check(!c.shown && c.cards === 0, `Play now with the full mix closes the card (${JSON.stringify({ shown: c.shown, cards: c.cards })})`);
  check(playing, 'and plays the song');
  await page.evaluate(() => window.__stage && window.__stage.engine && window.__stage.engine.pause && window.__stage.engine.pause());

  // on the highway: the same card, in the middle, no sticker; it goes when the stems are in
  const id2 = ids[1] || id;
  stemHold.add(id2);
  // (a double-click, like a player: the browser only lets sound start after a real click)
  await page.locator('.nav-section:has-text("Songs")').click();
  await page.waitForTimeout(800);
  await page.locator(`[data-id="${id2}"]`).first().dblclick();
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(200);
    c = await card();
    if (c.hwUnmixer) break;
  }
  check(c.hwShown && c.hwUnmixer, `over the highway it's the Unmixer too (${JSON.stringify({ shown: c.hwShown, unmixer: c.hwUnmixer })})`);
  check(!c.cameo && !c.shown, 'with no sticker, and only the one card showing');
  // (the first-time timing check offer sits on top: not now)
  const notNow = page.locator('.highway button:has-text("Not now")');
  if (await notNow.count()) await notNow.first().click().catch(() => {});
  await say({ songId: id2, state: 'running', progress: 0.31, message: 'Separating', eta: 120 });
  await page.waitForTimeout(900);
  c = await card();
  check(/31%/.test(c.hwText), `it follows the split there (${c.hwText.slice(0, 80)})`);
  await shot('unmixer-highway');
  await say({ songId: id2, state: 'running', progress: 0, message: 'Decoding' });
  await page.waitForTimeout(300);
  c = await card();
  check(/Reading the song/.test(c.hwText) && !/\d+%/.test(c.hwText.split(' | ')[1] || ''), `before a number it says what it's doing, no made-up percentage (${c.hwText.slice(0, 90)})`);
  stemHold.delete(id2);
  await say({ songId: id2, state: 'ready' });
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    await page.waitForTimeout(250);
    c = await card();
    gone = !c.hwShown && c.cards === 0;
  }
  check(gone, 'when the stems are in the card goes and is stopped');
  let started = false;
  for (let i = 0; i < 40 && !started; i++) {
    started = await page.evaluate(() => !!(window.__stagePlaying && window.__stagePlaying()));
    if (!started) await page.waitForTimeout(250);
  }
  check(started, 'and the song starts by itself');

  // waiting in line behind another song
  await page.evaluate(() => window.__stage && window.__stage.engine && window.__stage.engine.pause && window.__stage.engine.pause());
  await page.evaluate(async () => (await import('./js/stage.js')).closeHighway && (await import('./js/stage.js')).closeHighway());
  await page.keyboard.press('Escape');
  stemHold.add(id);
  await page.evaluate(async (id) => (await import('./js/stage.js')).load((await import('./js/store.js')).state.songs.get(id), { autoplay: true }), id);
  await page.waitForTimeout(1500);
  await say({ songId: id, state: 'queued' });
  await page.waitForTimeout(400);
  c = await card();
  const any = c.text || c.hwText;
  check(/Waiting to split stems/.test(any), `waiting in line says so (${any.slice(0, 90)})`);
  await shot('unmixer-queued');
  stemHold.delete(id);
  await say({ songId: id, state: 'ready' });
  await page.waitForTimeout(1500);
};
