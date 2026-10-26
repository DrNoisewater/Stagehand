/*
 * In-game song lists end to end against a fake Steam folder.
 * xvfb-run -a node test/e2e/rocksmith.js <electron> <vgmstream-cli> <outDir>
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const [electronBin, vgm, outDir] = process.argv.slice(2);
const APP = path.join(__dirname, '..', '..');
const TOOL = path.join(APP, 'test', 'rs_profile_tool.py');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-rsl-'));
const songs = path.join(home, 'dlc');
const steam = path.join(home, 'Steam');
fs.mkdirSync(songs, { recursive: true });
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.copyFileSync(path.join(APP, 'test/fixtures/integration_p.psarc'), path.join(songs, 'integration_p.psarc'));
fs.copyFileSync(path.join(APP, 'test/fixtures/legacy_p.psarc'), path.join(songs, 'testtest_p.psarc'));
const { profile } = JSON.parse(execFileSync('python3', [TOOL, 'make', steam], { encoding: 'utf8' }));
const dump = () => JSON.parse(execFileSync('python3', [TOOL, 'dump', profile], { encoding: 'utf8' }));
fs.writeFileSync(path.join(home, 'data', 'settings.json'), JSON.stringify({ tools: { vgmstream: vgm }, stems: { auto: false } }));
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, n) => page.screenshot({ path: path.join(outDir, `${n}.png`) }).then(() => console.log('  screenshot', n));

(async () => {
  const app = await electron.launch({ executablePath: electronBin, args: ['--no-sandbox', APP], env: { ...process.env, STAGEHAND_HOME: home, STAGEHAND_NO_SPLASH: "1", STAGEHAND_STEAM_DIR: steam } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.stagehand && document.querySelector('#sidebar'), null, { timeout: 20000 }); // waitForReady
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.evaluate((p) => window.stagehand.library.addFolder(p), songs);
  await page.waitForFunction(() => document.querySelectorAll('.row').length >= 2, null, { timeout: 15000 });
  await page.waitForSelector('.nav-item:has-text("Song List 1")', { timeout: 10000 });

  // In-game list 1 holds IntegrationTest (which we have) and BlitzkriegBop (which we don't)
  await page.click('.nav-item:has-text("Song List 1")');
  await wait(600);
  await shot(page, 'r1-song-list-1');
  console.log('  list 1 rows:', await page.locator('.row .t').allTextContents(), '|', await page.textContent('.lib-title .sub'));

  // Right-click a song > Add to Rocksmith > Song List 3
  await page.click('.nav-item:has-text("All songs")');
  await wait(300);
  await page.locator('.row', { hasText: 'Test' }).filter({ hasNotText: 'The Test' }).click({ button: 'right' });
  await page.click('.menu button:has-text("Add to Rocksmith")');
  await wait(300);
  await shot(page, 'r2-menu');
  await page.click('.menu button:has-text("Song List 3")');
  await page.waitForSelector('.toast:has-text("Added 1 song to Song List 3")', { timeout: 10000 });
  await wait(300);
  await shot(page, 'r3-added');
  console.log('  after add, list 3 in file:', JSON.stringify(dump().json.SongListsRoot.SongLists[2]));

  // Drag the other song onto Favorites
  const src = page.locator('.row', { hasText: 'The Test' });
  await src.dragTo(page.locator('.nav-item:has-text("Favorites")').nth(1));
  await wait(1500);
  console.log('  after drag, favorites in file:', JSON.stringify(dump().json.FavoritesListRoot.FavoritesList));

  // Send a Stagehand setlist to Song List 2 (replaces CallMe after confirming)
  await page.evaluate(async () => {
    const lib = (await window.stagehand.library.get()).value;
    const sl = (await window.stagehand.setlists.create('Gig night')).value;
    await window.stagehand.setlists.add(sl.id, lib.songs.map((s) => s.id));
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.click('.nav-item:has-text("Song List 1")'); // nudge a re-render
  await page.evaluate(async () => (await import('./js/store.js')).loadLibrary());
  await page.locator('.nav-item:has-text("Gig night")').click({ button: 'right' });
  await page.click('.menu button:has-text("Send to Rocksmith")');
  await page.click('.menu button:has-text("Replace Song List 2")');
  await page.waitForSelector('.modal:has-text("Replace Song List 2?")');
  await shot(page, 'r4-replace-confirm');
  await page.click('.modal .btn.primary');
  await page.waitForSelector('.toast:has-text("Song List 2 now matches")', { timeout: 10000 });
  console.log('  after send, list 2 in file:', JSON.stringify(dump().json.SongListsRoot.SongLists[1]));

  // While "Rocksmith is running" nothing is written
  await app.evaluate(() => (process.env.STAGEHAND_FAKE_RS_RUNNING = '1'));
  const before = fs.readFileSync(profile);
  await page.click('.nav-item:has-text("Song List 3")');
  await wait(300);
  await page.locator('.row').first().click();
  await page.keyboard.press('Delete');
  await page.waitForSelector('.toast:has-text("Close Rocksmith first")', { timeout: 10000 });
  await wait(300);
  await shot(page, 'r5-game-running');
  console.log('  file untouched while game runs:', fs.readFileSync(profile).equals(before));
  await app.evaluate(() => delete process.env.STAGEHAND_FAKE_RS_RUNNING);

  // Remove with Delete, then Undo from the toast
  await page.keyboard.press('Delete');
  await page.waitForSelector('.toast:has-text("Removed 1 song from Song List 3")', { timeout: 10000 });
  console.log('  after delete, list 3:', JSON.stringify(dump().json.SongListsRoot.SongLists[2]));
  await page.locator('.toast:has-text("Removed 1 song") button:has-text("Undo")').click();
  await page.waitForSelector('.toast:has-text("Change undone")', { timeout: 10000 });
  console.log('  after undo, list 3:', JSON.stringify(dump().json.SongListsRoot.SongLists[2]));
  await wait(500);
  await shot(page, 'r6-after-undo');

  // Settings tab
  await page.click('#btn-settings');
  await page.click('.settings .nav-item[data-tab="rocksmith"]');
  await page.waitForSelector('.plan-table', { timeout: 10000 });
  await wait(400);
  await shot(page, 'r7-settings');

  const d = dump();
  console.log('  final file: layout ok =', d.ubisoftLayout, '| other data intact =', d.json.Stats.SessionCount === 42 && d.json.CustomTones[0].Name === 'Café Crunch');
  console.log('  errors:', errors.length, errors.slice(0, 5).join(' / '));
  await app.close();
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
