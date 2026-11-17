/** 4.12: Sing along's settings in the real page: the microphone picker and the look.
 *   SH_AUDIT=test/e2e/sing-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 * (The singing itself is checked on the highway: SING=1 node test/hwlook/shoot.js <out> T:1.5) */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1500, height: 900 });
  // a pretend microphone next to the guitar cable
  await page.evaluate(() => {
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.frequency.value = 220;
    osc.connect(dest);
    osc.start();
    window.__micAsked = 0;
    navigator.mediaDevices.getUserMedia = async () => (window.__micAsked++, dest.stream);
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: 'audioinput', deviceId: 'default', label: 'Default' },
      { kind: 'audioinput', deviceId: 'usb1', label: 'USB Microphone' },
      { kind: 'audioinput', deviceId: 'rs1', label: 'Rocksmith Guitar Adapter' },
    ];
  });
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('guitar'));
  await page.waitForTimeout(900);
  const row = page.locator('.setting', { hasText: 'Microphone for singing' });
  check((await row.count()) === 1, 'Settings › Guitar & audio has the microphone for singing');
  const opts = await row.locator('select option').allTextContents();
  check(opts.includes('USB Microphone') && !opts.some((o) => /rocksmith/i.test(o)), `the picker lists microphones and leaves the guitar cable out (${opts.join(' | ')})`);
  check((await page.evaluate(() => window.__micAsked)) === 0, 'opening the settings does not open the microphone');
  await row.locator('button', { hasText: 'Try it' }).click();
  await page.waitForTimeout(700);
  const lv = await row.locator('.mic-level').evaluate((e) => ({ lv: Number(e.style.getPropertyValue('--lv')), voiced: e.classList.contains('voiced') }));
  check(lv.lv > 0.2 && lv.voiced, `Try it shows the level moving (${JSON.stringify(lv)})`);
  await row.locator('select').selectOption('usb1');
  await row.locator('button', { hasText: 'Stop' }).click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(async () => { const { mic } = await import('./js/mic.js'); return { on: mic.on, id: mic.deviceId }; });
  check(!after.on && after.id === 'usb1', `Stop lets the microphone go, and the choice is remembered (${JSON.stringify(after)})`);
  // auto-tune and the voice changer (4.17): one row, remembered, off until picked
  const tune = page.locator('.setting', { hasText: 'Auto-tune and voice changer' });
  check((await tune.count()) === 1, 'Settings › Guitar & audio has auto-tune and the voice changer');
  const tuneOpts = (await tune.locator('select option').allTextContents()).join(' | ');
  check(/Hard tune/.test(tuneOpts) && /Villain/.test(tuneOpts) && /Chipmunk/.test(tuneOpts) && /song/i.test(tuneOpts), `it lists the styles, the notes and the voices (${tuneOpts.length} letters)`);
  const tuneWas = await page.evaluate(async () => { const { autotune } = await import('./js/autotune.js'); return { wanted: autotune.wanted, on: autotune.on }; });
  check(!tuneWas.wanted && !tuneWas.on, 'auto-tune is off until you pick something');
  await tune.locator('select[aria-label="Voice changer"]').selectOption('giant');
  await tune.locator('select[aria-label="Auto-tune"]').selectOption('robot');
  const tuneNow = await page.evaluate(async () => { const { autotune } = await import('./js/autotune.js'); const { tuneLabel } = await import('./js/singlane.js'); return { style: autotune.style, voice: autotune.voice, wanted: autotune.wanted, on: autotune.on, label: tuneLabel() }; });
  check(tuneNow.style === 'robot' && tuneNow.voice === 'giant' && tuneNow.wanted && !tuneNow.on && /Hard tune/.test(tuneNow.label) && /Villain/.test(tuneNow.label), `the choices are remembered, and nothing plays while the microphone is off (${JSON.stringify(tuneNow)})`);
  await tune.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, 'sing-settings-tune.png') });
  // (the picture comes last: it is slow here, and Try it stops by itself after 20 seconds)
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, 'sing-settings-mic.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('appearance'));
  await page.waitForTimeout(900);
  const look = page.locator('.looks-row', { hasText: 'Singing' });
  check((await look.count()) === 1, 'Pick your look has Singing');
  await look.locator('button', { hasText: 'Words' }).click();
  await page.waitForTimeout(200);
  check((await page.evaluate(async () => (await import('./js/singlane.js')).singLook())) === 'words', 'choosing Words is remembered');
  await look.locator('button', { hasText: 'Bars' }).click();
  await look.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, 'sing-settings-look.png') });
  await page.keyboard.press('Escape');
  // 4.23: Karaoke is a list under Songs (one library), and every song row has its play buttons
  await page.locator('#sidebar .nav-section[data-page="songs"]').click();
  await page.waitForTimeout(500);
  check((await page.locator('#sidebar .nav-section[data-page="karaoke"]').count()) === 0, 'Karaoke is no longer a page of its own on the left');
  await page.locator('#sidebar .nav-item[data-kind="karaoke"]').click();
  await page.waitForTimeout(800);
  const listed = await page.evaluate(async () => {
    const { state, visibleSongs, hasPart } = await import('./js/store.js');
    const v = visibleSongs();
    return { kind: state.view.kind, n: v.length, allWords: v.every((s) => hasPart(s, 'vocals')), rows: document.querySelectorAll('#library .row').length };
  });
  check(listed.kind === 'karaoke' && listed.n > 0 && listed.allWords, `Songs › Karaoke lists the songs with words (${JSON.stringify(listed)})`);
  await page.evaluate(async () => (await import('./js/store.js')).setPage('karaoke'));
  await page.waitForTimeout(300);
  check(await page.evaluate(async () => { const { state } = await import('./js/store.js'); return state.page === 'songs' && state.view.kind === 'karaoke'; }), 'an old link to the Karaoke page lands on Songs › Karaoke');
  const btns = await page.evaluate(() => {
    const r = document.querySelector('#library .row');
    return r ? [...r.querySelectorAll('.pm')].map((b) => `${b.dataset.mode}${b.classList.contains('none') ? '-' : '+'}`) : [];
  });
  check(btns.length === 5 && btns.includes('karaoke+'), `each row has Lead, Rhythm, Bass, Sing & play and Karaoke (${btns.join(' ')})`);
  await page.screenshot({ path: path.join(outDir, 'karaoke-list.png') });
  await page.locator('#library .row .pm-karaoke:not(.none)').first().click();
  await page.waitForFunction(() => { const r = document.querySelector('.highway'); return r && !r.hidden; }, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const kk = await page.evaluate(() => { const r = document.querySelector('.highway'); return { k: r.classList.contains('hw-karaoke'), chip: r.querySelector('.hw-karaoke-chip[aria-pressed="true"]')?.textContent || '', words: r.__hw.sing.state.base.syl.length }; });
  check(kk.words ? kk.k && /Karaoke/.test(kk.chip) : !kk.k, `its Karaoke button opens it as karaoke (${JSON.stringify(kk)})`);
  await page.screenshot({ path: path.join(outDir, 'karaoke-open.png') });
  await page.evaluate(() => window.__shHighway.leave());
  await page.waitForTimeout(800);
  check(await page.evaluate(async () => { const { state } = await import('./js/store.js'); return state.page === 'songs' && state.view.kind === 'karaoke'; }), 'leaving goes back to Songs › Karaoke');
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
};
