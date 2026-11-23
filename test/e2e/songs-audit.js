/* 4.26: Songs: the click preview, the capo badge and notice, and the search box's tuning card.
   SH_AUDIT=test/e2e/songs-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // count what the page tries to play
  await page.evaluate(async () => {
    const pv = await import('./js/preview.js');
    window.__nplays = () => pv.previewState().plays;
  });
  await page.addStyleTag({ content: '.toasts, .toast-stack { display: none !important; }' });
  // made-up songs: tunings, a capo
  await page.evaluate(async () => {
    const { state, upsertSongs } = await import('./js/store.js');
    const base = [...state.songs.values()][0];
    const tun = ['Eb Standard', 'Eb Standard', 'Drop D', 'E Standard', 'D Standard'];
    const names = ['Hysteria', 'Kickstart My Heart', 'Holiday', 'Enter Sandman', 'Sweet Child O Mine'];
    const made = tun.map((t, i) => ({ ...base, id: `m${i}`, title: names[i], artist: ['Muse', 'Motley Crue', 'Green Day', 'Metallica', 'Guns N Roses'][i], tuning: t, capo: 0, arrangements: [{ type: 'lead', capo: 0, represent: true }, { type: 'bass', capo: 0, represent: true }] }));
    made[0].capo = 2;
    made[0].arrangements = [{ type: 'lead', capo: 2, represent: true }, { type: 'rhythm', capo: 0, represent: true }, { type: 'bass', capo: 0, represent: true }];
    made[1].capo = 7;
    made[1].arrangements = [{ type: 'lead', capo: 7, represent: true }];
    upsertSongs(made);
  });
  await page.evaluate(async () => (await import('./js/store.js')).setPage('songs'));
  await page.waitForTimeout(700);

  // ---- capo badge on the row
  const badge = await page.locator('.row .sb-capo').first().textContent().catch(() => '');
  check(/Capo 2/.test(badge) && /2nd fret/.test(await page.locator('.row .sb-capo').first().getAttribute('title')), `a song that needs a capo says so on its row (${badge})`);
  const ords = await page.evaluate(async () => {
    const { ordinal } = await import('./js/songbadges.js');
    return [1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal).join(' ');
  });
  check(ords === '1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd', `ordinals (${ords})`);
  await page.screenshot({ path: path.join(outDir, 'songs-capo-badge.png') });

  // ---- the preview
  const rows = page.locator('.row .tt-text');
  await rows.nth(1).click();
  await page.waitForTimeout(1200);
  let bar = await page.evaluate(() => { const b = document.querySelector('.pv-bar'); return b && !b.hidden ? b.textContent : null; });
  const plays1 = await page.evaluate(() => window.__nplays());
  check(bar && /Preview/.test(bar) && plays1 === 1, `clicking a song starts a preview with a Stop (${bar}, plays ${plays1})`);
  await page.screenshot({ path: path.join(outDir, 'songs-preview.png') });
  await rows.nth(2).click();
  await page.waitForTimeout(900);
  const plays2 = await page.evaluate(() => window.__nplays());
  check(plays2 === 2, `another song replaces it (plays ${plays2})`);
  await page.locator('.pv-stop').click();
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.querySelector('.pv-bar').hidden), 'Stop ends it');
  // it ends by itself (8 s clip)
  await rows.nth(1).click();
  await page.waitForTimeout(800);
  check(await page.evaluate(() => !document.querySelector('.pv-bar').hidden), 'it plays again');
  await page.waitForTimeout(8300);
  check(await page.evaluate(() => document.querySelector('.pv-bar').hidden), 'it ends by itself, after its fade');
  // leaving Songs stops it
  await rows.nth(0).click();
  await page.waitForTimeout(800);
  await page.evaluate(async () => (await import('./js/store.js')).setPage('discover'));
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.querySelector('.pv-bar').hidden), 'leaving Songs stops it');
  await page.evaluate(async () => (await import('./js/store.js')).setPage('songs'));
  await page.waitForTimeout(500);
  // setting off: no preview
  await page.evaluate(async () => { const { state } = await import('./js/store.js'); state.settings = { ...(state.settings || {}), playback: { ...((state.settings || {}).playback || {}), preview: false } }; });
  const before = await page.evaluate(() => window.__nplays());
  await rows.nth(3).click();
  await page.waitForTimeout(900);
  check((await page.evaluate(() => window.__nplays())) === before, 'with previews off, nothing plays');
  await page.evaluate(async () => { const { state } = await import('./js/store.js'); state.settings.playback.preview = true; });
  // a song playing in the player: no preview
  const id0 = await page.evaluate(async () => [...(await import('./js/store.js')).state.songs.keys()][0]);
  await page.evaluate(async (id) => (await import('./js/actions.js')).playSong(id, { autoplay: true }), id0);
  await page.waitForFunction(() => document.querySelector('.stage, #stage') && true, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const playing = await page.evaluate(async () => (await import('./js/stage.js')).engine.playing);
  await page.evaluate(async () => (await import('./js/store.js')).setPage('songs'));
  await page.waitForTimeout(600);
  const b4 = await page.evaluate(() => window.__nplays());
  await rows.nth(2).click();
  await page.waitForTimeout(900);
  check(!playing || (await page.evaluate(() => window.__nplays())) === b4, `no preview over a playing song (playing: ${playing})`);

  // ---- search: the tuning card
  await page.evaluate(async () => { const s = await import('./js/store.js'); s.clearSearch(); s.setPage('songs'); });
  await page.evaluate(async () => (await import('./js/api.js')).api.tab.load && 0);
  const search = page.locator('#search');
  await search.click();
  await search.fill('e flat');
  await page.waitForTimeout(500);
  const card = await page.locator('.sp-card').first().textContent().catch(() => '');
  check(/Tuning: E♭ Standard/.test(card) && /2 songs/.test(card), `"e flat" shows a tuning card with the count (${card})`);
  check(await page.evaluate(() => document.querySelector('.search-pop .sp-item').classList.contains('sp-card')), 'the card is first');
  await page.screenshot({ path: path.join(outDir, 'search-tuning-card.png') });
  await search.fill('met');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'search-menu.png') });
  await search.fill('drop d');
  await page.waitForTimeout(400);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const view = await page.evaluate(async () => { const { state, viewTitle } = await import('./js/store.js'); return [state.view.kind, state.view.id, viewTitle(), state.search]; });
  check(view[0] === 'tuning' && view[1] === 'Drop D', `the card opens Songs in that tuning (${JSON.stringify(view)})`);
  await page.screenshot({ path: path.join(outDir, 'search-tuning-opened.png') });
  // typing the words on the list itself shows that tuning's songs
  await page.evaluate(async () => { const s = await import('./js/store.js'); s.setView({ kind: 'all' }); });
  await search.click();
  await search.fill('half step down');
  await page.waitForTimeout(500);
  const n = await page.evaluate(async () => (await import('./js/store.js')).visibleSongs().filter((s) => s.tuning === 'Eb Standard').length);
  const all = await page.evaluate(async () => (await import('./js/store.js')).visibleSongs().length);
  check(n === 2 && all === 2, `"half step down" lists just the E♭ songs (${n} of ${all})`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // ---- the capo notice on the highway
  await page.evaluate(async () => {
    const { api } = await import('./js/api.js');
    if (!window.__origLoad) {
      window.__origLoad = api.tab.load;
      api.tab.load = async (...a) => ({ ...(await window.__origLoad(...a)), capo: 2 });
    }
  });
  const id = await page.evaluate(async () => [...(await import('./js/store.js')).state.songs.keys()][0]);
  await page.evaluate(async (id) => (await import('./js/actions.js')).playAlong(id, { autoplay: false }), id);
  await page.waitForFunction(() => { const r = document.querySelector('.highway'); return r && !r.hidden; }, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const notNow = page.locator('button', { hasText: 'Not now' });
  if (await notNow.count()) await notNow.first().click();
  await page.evaluate(async () => (await import('./js/stage.js')).engine.seek(0));
  await page.waitForTimeout(800);
  const note = await page.evaluate(() => { const c = document.querySelector('.hw-capo'); return c && !c.hidden ? c.textContent : null; });
  check(note && /Requires capo/.test(note) && /Capo on 2nd fret/.test(note), `the highway says "Requires capo · Capo on 2nd fret" before the song starts (${note})`);
  await page.screenshot({ path: path.join(outDir, 'highway-capo.png') });
  await page.evaluate(() => window.__shHighway.leave());
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
};
