/*
 * Tab view end to end: tab from the song file, play along with stems, speed,
 * layout options, and a guitar input (a fake capture file of a slightly flat
 * A string) through the rig and tuner.
 * xvfb-run -a node test/e2e/tab.js <electron> <vgmstream-cli> <fake-python> <outDir>
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const [electronBin, vgm, fakePy, outDir] = process.argv.slice(2);
const APP = path.join(__dirname, '..', '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-tab-'));
const songs = path.join(home, 'dlc');
fs.mkdirSync(songs, { recursive: true });
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.copyFileSync(path.join(APP, 'test/fixtures/integration_p.psarc'), path.join(songs, 'integration_p.psarc'));
fs.copyFileSync(path.join(APP, 'test/fixtures/legacy_p.psarc'), path.join(songs, 'testtest_p.psarc'));
fs.writeFileSync(path.join(home, 'data', 'settings.json'), JSON.stringify({ tools: { vgmstream: vgm }, engine: { python: fakePy }, stems: { auto: false } }));
fs.mkdirSync(outDir, { recursive: true });

// A plucked A string (110 Hz), 7.0 cents flat, re-plucked every second: the "guitar".
const SR = 48000;
const F = 110 * Math.pow(2, -7 / 1200);
const secs = 12;
const pcm = Buffer.alloc(44 + SR * secs * 2);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + SR * secs * 2, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(SR * secs * 2, 40);
for (let i = 0; i < SR * secs; i++) {
  const t = (i % SR) / SR;
  let v = 0;
  for (let hm = 1; hm <= 6; hm++) v += (hm === 1 ? 0.6 : 0.5 / hm) * Math.sin(2 * Math.PI * F * hm * (i / SR) + hm);
  pcm.writeInt16LE(Math.round(9000 * v * Math.exp(-t * 1.2)), 44 + i * 2);
}
const guitarWav = path.join(home, 'guitar.wav');
fs.writeFileSync(guitarWav, pcm);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, n) => page.screenshot({ path: path.join(outDir, `${n}.png`) }).then(() => console.log('  screenshot', n));
const check = (cond, what) => {
  console.log(`  ${cond ? 'ok ' : 'FAIL'} ${what}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const app = await electron.launch({
    executablePath: electronBin,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${guitarWav}`, APP],
    env: { ...process.env, STAGEHAND_HOME: home, STAGEHAND_NO_SPLASH: "1" },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.stagehand && document.querySelector('#sidebar'), null, { timeout: 20000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.evaluate((p) => window.stagehand.library.addFolder(p), songs);
  await page.waitForFunction(() => document.querySelectorAll('.row').length >= 2, null, { timeout: 20000 });

  // Play "The Test", then switch to tab view
  await page.locator('.row', { hasText: 'The Test' }).dblclick();
  await page.waitForFunction(() => !document.querySelector('.play-btn').disabled, null, { timeout: 20000 });
  await page.keyboard.press('Space'); // pause
  await page.click('.stage-right button:has-text("Tab")');
  await page.waitForSelector('.tab-parts .chip', { timeout: 10000 });
  const parts = await page.locator('.tab-parts .chip').allTextContents();
  check(parts.length === 2 && /Lead/.test(parts[0]) && /Bass/.test(parts[1]), `parts: ${parts.join(' | ')}`);
  // Jump to the first notes (about 10.5 s) and play a little
  await page.click('.tab-sections button:has-text("Melody")');
  await page.keyboard.press('Space');
  await wait(2600);
  await shot(page, 't1-tab-lead');
  const lit = await page.evaluate(() => {
    const c = document.querySelector('.tab-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 37) if (d[i] > 200 || d[i + 1] > 180 || d[i + 2] > 200) colors.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`);
    return colors.size;
  });
  check(lit > 5, `tab canvas has drawn notes (${lit} bright colours)`);

  // Bass part, high e on top, page layout
  await page.click('.tab-parts .chip:has-text("Bass")');
  await wait(800);
  await shot(page, 't2-tab-bass');
  await page.click('.tab-bar button[title="Tab options"]');
  await page.click('.menu button:has-text("Pages")');
  await wait(600);
  await page.click('.tab-bar button[title="Tab options"]');
  await page.click('.menu button:has-text("High e on top")');
  await page.click('.tab-parts .chip:has-text("Lead")');
  await wait(900);
  await shot(page, 't3-pages-high-e');
  await page.click('.tab-bar button[title="Tab options"]');
  await page.click('.menu button:has-text("Scrolling")');
  await page.click('.tab-bar button[title="Tab options"]');
  await page.click('.menu button:has-text("Low E on top")');

  // Practice speed: half speed moves the clock at half rate
  await page.click('.np-speed .speed-chip');
  await page.click('.speed-pop .sp-picks button:text-is("50")');
  await page.keyboard.press('Escape');
  await wait(400);
  const a = await page.evaluate(async () => {
    const { current } = await import('./js/stage.js');
    void current;
    const t0 = performance.now();
    const p0 = Number(document.querySelector('.timecode .now').textContent.split(':').reduce((m, x) => m * 60 + Number(x), 0));
    await new Promise((r) => setTimeout(r, 2000));
    const p1 = Number(document.querySelector('.timecode .now').textContent.split(':').reduce((m, x) => m * 60 + Number(x), 0));
    return (p1 - p0) / ((performance.now() - t0) / 1000);
  });
  check(a > 0.4 && a < 0.6, `half speed advances ${a.toFixed(2)} s per second`);
  await page.click('.np-speed .speed-chip');
  await page.click('.speed-pop .sp-reset');
  await page.keyboard.press('Escape');

  // Hide the song list
  await page.click('.tab-bar button[title^="Hide the song list"]');
  await wait(500);
  check(await page.evaluate(() => document.getElementById('app').classList.contains('tab-max')), 'song list hidden');
  await shot(page, 't4-maxed');

  // Stems, then play along mutes the guitar stem
  await page.click('.tab-foot button:has-text("Split stems")');
  await page.waitForSelector('.stem-chip', { timeout: 60000 });
  await wait(600);
  const pa = await page.evaluate(() => [document.querySelector('.tab-toggle').getAttribute('aria-pressed'), document.querySelector('.stem-chip.yours .name') && document.querySelector('.stem-chip.yours .name').textContent]);
  check(pa[0] === 'true' && pa[1] === 'Guitar', `play along: ${pa.join(', ')}`);
  await page.click('.tab-parts .chip:has-text("Bass")');
  await wait(800);
  const pb = await page.evaluate(() => document.querySelector('.stem-chip.yours .name').textContent);
  check(pb === 'Bass', `bass part mutes ${pb}`);
  check((await page.locator('.tab-foot .stem-vol').count()) >= 4, 'stem volume sliders in tab view');
  await shot(page, 't5-play-along');
  await page.click('.tab-parts .chip:has-text("Lead")');

  // Your guitar: rig + tuner on the fake capture
  await page.click('.rig-btn');
  await page.waitForSelector('.rig-panel');
  await page.click('.rig-head button:has-text("Turn on")');
  await page.waitForSelector('.rig-head button:has-text("Turn off")', { timeout: 10000 });
  await page.waitForFunction(() => /cents|In tune/.test(document.querySelector('.tn-cents').textContent) && document.querySelector('.tn-note').textContent === 'A', null, { timeout: 10000 });
  await wait(1500);
  const reading = await page.evaluate(() => [document.querySelector('.tn-note').textContent, document.querySelector('.tn-cents').textContent, document.querySelector('.tn-hz').textContent]);
  const cents = Number((/([\d.]+) cents flat/.exec(reading[1]) || [])[1]);
  check(reading[0] === 'A' && Math.abs(cents - 7) <= 0.6, `tuner reads ${reading.join(' · ')}`);
  await shot(page, 't6-rig-tuner');
  await page.evaluate(() => document.querySelector('.tuner').scrollIntoView({ block: 'end' }));
  await wait(400);
  await shot(page, 't6b-tuner');
  const tones = await page.locator('.tone b').allTextContents();
  check(tones[0] === 'Song tone' && tones.includes('Metal') && tones.includes('Crunch'), `tones: ${tones.join(', ')}`);
  check((await page.getAttribute('.tone.song', 'aria-pressed')) === 'true', 'song tone chosen by default');
  await page.click('.tone:has-text("Metal")');
  await page.selectOption('.tn-pick select[aria-label="Tuning"]', 'drop-d');
  await wait(800);
  const drop = await page.evaluate(() => [...document.querySelectorAll('.tn-strings button')].map((b) => b.textContent).join(' '));
  check(drop === 'D A D G B E', `Drop D strings: ${drop}`);
  await shot(page, 't7-metal-dropd');
  await page.click('.tone.song');
  check((await page.getAttribute('.tone.song', 'aria-pressed')) === 'true', 'back to the song tone');

  // Waveform view comes back unchanged
  await page.keyboard.press('t');
  await wait(400);
  check(await page.evaluate(() => !document.getElementById('app').classList.contains('tab-max') && !document.querySelector('.stage-body').hidden), 'waveform view restored');

  console.log('  errors:', errors.length, errors.slice(0, 5).join(' / '));
  if (errors.length) process.exitCode = 1;
  await app.close();
})().catch((e) => {
  console.error('FAILED', e.stack || e.message);
  process.exit(1);
});
