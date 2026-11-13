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
  // the Karaoke page on the left: songs with words, and picking one opens it with the words only
  await page.locator('#sidebar .nav-section[data-page="karaoke"]').click();
  await page.waitForTimeout(600);
  const cards = await page.locator('#page-karaoke .kk-card').count();
  check(cards > 0, `Karaoke is on the left and lists the songs with words (${cards})`);
  await page.locator('#page-karaoke .kk-search').fill('zzzz no such song');
  check((await page.locator('#page-karaoke .kk-card').count()) === 0 && /No song matches/.test(await page.locator('#page-karaoke').textContent()), 'searching narrows the list');
  await page.locator('#page-karaoke .kk-search').fill('');
  await page.screenshot({ path: path.join(outDir, 'karaoke-page.png') });
  await page.locator('#page-karaoke .kk-card').first().click();
  await page.waitForFunction(() => { const r = document.querySelector('.highway'); return r && !r.hidden; }, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const kk = await page.evaluate(() => { const r = document.querySelector('.highway'); return { k: r.classList.contains('hw-karaoke'), chip: r.querySelector('.hw-sing-chip').textContent, words: r.__hw.sing.state.base.syl.length }; });
  check(kk.words ? kk.k && /Karaoke/.test(kk.chip) : !kk.k, `picking a song opens it as karaoke (${JSON.stringify(kk)})`);
  await page.screenshot({ path: path.join(outDir, 'karaoke-open.png') });
  await page.evaluate(() => window.__shHighway.leave());
  await page.waitForTimeout(800);
  check(await page.evaluate(() => document.getElementById('app').classList.contains('page-karaoke')), 'leaving goes back to the Karaoke page');
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
};
