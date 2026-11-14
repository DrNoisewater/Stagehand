/** 4.18: Create a Tone's famous tones: the shelf, search by player and song, a tone built on the
 * board piece by piece (and skipped with a key), renamed and saved with the check-over, and no
 * movement at all when the system asks for less motion.
 *   SH_AUDIT=test/e2e/famous-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const shot = (name) => page.screenshot({ path: path.join(outDir, `famous-${name}.png`) });
  const go = async (name) => { await page.evaluate(async (n) => (await import('./js/store.js')).setPage(n), name); await page.waitForTimeout(900); };
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const closeModals = async () => { for (let i = 0; i < 4 && (await page.locator('.modal').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } };
  await closeModals();
  await page.setViewportSize({ width: 1600, height: 950 });
  await go('tones');

  // a new tone: the starting rig lays itself down
  await page.evaluate(async () => { (await import('./js/rigroom.js')).openRig({ kind: 'guitar' }); });
  await page.waitForSelector('.rr-board .rb');
  await page.waitForTimeout(450);
  const mid = await page.evaluate(() => {
    const b = document.querySelector('.rr-board .rb');
    const ps = [...b.querySelectorAll(':scope > .rb-piece')];
    return { building: b.classList.contains('rbk-building'), shown: ps.filter((p) => p.classList.contains('rbk-in')).length, all: ps.length };
  });
  await shot('open-mid');
  check(mid.building && mid.shown < mid.all, `a new tone's rig is laid down piece by piece (${mid.shown} of ${mid.all} down after 0.45 s)`);
  await page.waitForTimeout(3200);
  const rest = await page.evaluate(() => {
    const b = document.querySelector('.rr-board .rb');
    const ps = [...b.querySelectorAll(':scope > .rb-piece')];
    return { building: b.classList.contains('rbk-building'), vis: ps.every((p) => getComputedStyle(p).opacity === '1'), cables: getComputedStyle(b.querySelector('.rb-cables')).opacity, left: b.querySelectorAll('.rbk-dials,.rbk-glow,.rbk-tick').length };
  });
  check(!rest.building && rest.vis && rest.cables === '1' && !rest.left, `and it finishes on its own within 3.5 s, everything showing, nothing left over (${JSON.stringify(rest)})`);
  await shot('open-rest');

  // the shelf
  await page.locator('.rr-famous-tab').click({ force: true });
  await page.waitForTimeout(400);
  const n = await page.locator('.rr-grid .rr-ft').count();
  check(n >= 30, `the Famous tones shelf lists the guitar sounds (${n})`);
  await shot('shelf');
  await page.locator('.rr-find').fill('van halen');
  await page.waitForTimeout(300);
  const first = (await page.locator('.rr-grid .rr-ft .rr-ft-name').first().textContent()) || '';
  check(first === 'Brown sound', `"van halen" finds Brown sound first (${first})`);
  await page.locator('.rr-find').fill('teen spirit');
  await page.waitForTimeout(300);
  check((await page.locator('.rr-grid .rr-ft .rr-ft-name').first().textContent()) === 'Grunge distortion', '"teen spirit" finds the grunge tone');
  await page.locator('.rr-find').fill('jamerson');
  await page.waitForTimeout(300);
  const hint = (await page.locator('.rr-wallhint').textContent()) || '';
  check(/bass/.test(hint), `a bass player searched in the guitar room says where to look (${hint})`);

  // build one: piece by piece, then at rest
  await page.locator('.rr-find').fill('van halen');
  await page.waitForTimeout(300);
  await page.locator('.rr-grid .rr-ft').first().click({ force: true });
  await page.waitForTimeout(480);
  const b1 = await page.evaluate(() => ({ dials: document.querySelectorAll('.rr-board .rbk-dials .rbk-dial').length, building: !!document.querySelector('.rr-board .rb.rbk-building') }));
  await shot('build-1');
  check(b1.building && b1.dials > 0, `the pieces drop in and their dials turn (${b1.dials} dials showing)`);
  await page.waitForTimeout(500);
  await shot('build-2');
  await page.waitForTimeout(500);
  await shot('build-3');
  await page.waitForTimeout(2600);
  await shot('build-rest');
  const built = await page.evaluate(async () => {
    const { rig } = await import('./js/rig.js');
    return { name: document.querySelector('input.rr-name').value, live: (rig.liveTone && rig.liveTone.gear || []).map((g) => g.key), pieces: document.querySelectorAll('.rr-board .rb > .rb-piece').length };
  });
  check(built.name === 'Brown sound' && built.live.includes('Amp_MarshallPlexi') && built.pieces === built.live.length, `it's on the board and you hear it (${built.name}; ${built.live.join(', ')})`);

  // a key finishes it at once
  await page.locator('.rr-find').fill('');
  await page.locator('.rr-genre', { hasText: 'Metal' }).click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('.rr-grid .rr-ft').first().click({ force: true });
  await page.waitForTimeout(250);
  await page.locator('.rr-board').focus().catch(() => {});
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(80);
  const skipped = await page.evaluate(() => ({ building: !!document.querySelector('.rr-board .rb.rbk-building'), left: document.querySelectorAll('.rr-board .rbk-dials').length }));
  check(!skipped.building && !skipped.left, 'a key press finishes the build at once');
  // and a click
  await page.locator('.rr-grid .rr-ft').nth(1).click({ force: true });
  await page.waitForTimeout(250);
  await page.mouse.click(800, 120);
  await page.waitForTimeout(80);
  check(!(await page.locator('.rr-board .rb.rbk-building').count()), 'so does a click');
  await page.waitForTimeout(400);

  // undo puts the last one back
  const nameBefore = await page.locator('input.rr-name').inputValue();
  await page.locator('.rr-undo').click({ force: true });
  await page.waitForTimeout(300);
  check((await page.locator('input.rr-name').inputValue()) !== nameBefore, 'Undo goes back to the sound before');

  // rename and save: each piece is ticked, then the sticker
  await page.locator('input.rr-name').fill('My big metal');
  await page.locator('.rr-save').click({ force: true });
  await page.waitForTimeout(220);
  const ticks = await page.locator('.rr-board .rbk-tick').count();
  check(ticks > 0, `saving ticks the pieces in order (${ticks} so far)`);
  await shot('save-ticks');
  await page.waitForTimeout(100);
  const saved = await page.evaluate(async () => {
    const { listTones } = await import('./js/tonelib.js').catch(() => ({}));
    return { stamp: !!document.querySelector('.rr-board .saved-stamp'), btn: document.querySelector('.rr-save').textContent, list: listTones ? listTones().map((t) => t.name) : null };
  });
  check(saved.stamp && saved.btn === 'Saved', `then the saved sticker (${saved.btn})`);
  await shot('save-done');
  await page.waitForTimeout(1200);

  // less motion: no build at all
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.rr-grid .rr-ft').nth(2).click({ force: true });
  await page.waitForTimeout(60);
  const still = await page.evaluate(() => ({ building: !!document.querySelector('.rr-board .rb.rbk-building'), dials: document.querySelectorAll('.rbk-dials').length }));
  check(!still.building && !still.dials, 'with less motion asked for, the tone just appears');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // close the room straight away (openRig hands back the open one)
  await page.evaluate(async () => (await (await import('./js/rigroom.js')).openRig()).close());
  await page.waitForTimeout(600);

  // bass room
  await page.evaluate(async () => { (await import('./js/rigroom.js')).openRig({ kind: 'bass' }); });
  await page.waitForTimeout(3600);
  await page.locator('.rr-famous-tab').click({ force: true });
  await page.locator('.rr-find').fill('jamerson');
  await page.waitForTimeout(300);
  check((await page.locator('.rr-grid .rr-ft .rr-ft-name').first().textContent()) === 'Motown thump', 'in the bass room, "jamerson" finds Motown thump');
  await page.locator('.rr-find').fill('');
  await page.waitForTimeout(300);
  await shot('bass-shelf');
  await page.locator('.rr-grid .rr-ft').first().click({ force: true });
  await page.waitForTimeout(500);
  await shot('bass-build');
  await page.waitForTimeout(3000);
  await closeModals();
  check(!errs.length, `no page errors (${errs.slice(0, 3).join(' | ')})`);
};
