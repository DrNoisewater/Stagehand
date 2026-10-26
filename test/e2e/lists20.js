/*
 * Up to 20 in-game song lists, end to end.
 * xvfb-run -a node test/e2e/lists20.js <electron> <vgmstream-cli> <outDir>
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const [electronBin, vgm, outDir] = process.argv.slice(2);
const APP = path.join(__dirname, '..', '..');
const TOOL = path.join(APP, 'test', 'rs_profile_tool.py');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-l20-'));
const steam = path.join(home, 'Steam');
const game = path.join(home, 'Rocksmith2014');
const songs = path.join(game, 'dlc');
fs.mkdirSync(songs, { recursive: true });
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.writeFileSync(path.join(game, 'Rocksmith2014.exe'), 'x');
fs.writeFileSync(path.join(game, 'xinput1_3.dll'), Buffer.alloc(400000));
fs.writeFileSync(path.join(game, 'RSMods.ini'), ['[SongListTitles]', ...Array.from({ length: 20 }, (_, i) => `SongListTitle_${i + 1} = Define Song List ${i + 1} Here`), ''].join('\r\n'));
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
  await page.evaluate(async () => (await import('./js/store.js')).loadRocksmith());
  await page.waitForSelector('.nav-item[data-rslist="5"]', { timeout: 10000 });

  // + makes Song List 7 and opens its name box
  await page.click('button[aria-label="New song list"]');
  await page.waitForSelector('.nav-item.editing input.rename', { timeout: 10000 });
  await page.keyboard.type('Extras');
  await wait(200);
  await shot(page, 'm1-new-list-naming');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast:has-text("Renamed Song List 7")', { timeout: 10000 });
  console.log('  profile lists:', dump().json.SongListsRoot.SongLists.length, '| ini 7:', fs.readFileSync(path.join(game, 'RSMods.ini'), 'utf8').split('\r\n').find((l) => l.startsWith('SongListTitle_7')));

  // Fill up to 20
  for (let i = 0; i < 13; i++) await page.evaluate(() => window.stagehand.rocksmith.apply([{ addList: true }]));
  await page.evaluate(async () => (await import('./js/store.js')).loadRocksmith());
  await wait(500);
  await page.evaluate(() => document.querySelector('.nav-item[data-rslist="19"]').scrollIntoView({ block: 'center' }));
  await wait(300);
  await shot(page, 'm2-twenty-lists');
  console.log('  + disabled at 20:', await page.isDisabled('button[aria-label="New song list"]'));

  // Add a song to Song List 20 from the menu (long menu scrolls)
  await page.click('.nav-item:has-text("All songs")');
  await wait(300);
  await page.locator('.row').first().click({ button: 'right' });
  await page.click('.menu button:has-text("Add to Rocksmith")');
  await wait(300);
  await shot(page, 'm3-long-menu');
  await page.locator('.menu').last().locator('button:has-text("Song List 20")').click();
  await page.waitForSelector('.toast:has-text("Song List 20")', { timeout: 10000 });
  console.log('  list 20 in file:', JSON.stringify(dump().json.SongListsRoot.SongLists[19]));

  // Remove the last list (it has a song, so it asks)
  await page.evaluate(() => document.querySelector('.nav-item[data-rslist="19"]').scrollIntoView({ block: 'center' }));
  await page.locator('.nav-item[data-rslist="19"]').click({ button: 'right' });
  await wait(200);
  await shot(page, 'm4-list-menu');
  await page.click('.menu button:has-text("Remove this list")');
  await page.waitForSelector('.modal:has-text("Remove Song List 20?")');
  await page.click('.modal .btn.danger');
  await page.waitForSelector('.toast:has-text("Removed Song List 20")', { timeout: 10000 });
  console.log('  after remove:', dump().json.SongListsRoot.SongLists.length, 'lists | layout ok:', dump().ubisoftLayout);

  // Collapsed section
  await page.evaluate(() => document.querySelector('.sidebar').scrollTo(0, 0));
  await page.click('.nav-toggle:has-text("In Rocksmith")');
  await wait(300);
  await shot(page, 'm5-collapsed');
  await page.click('.nav-toggle:has-text("In Rocksmith")');

  // Without RSMods: adding asks first
  fs.unlinkSync(path.join(game, 'xinput1_3.dll'));
  await page.evaluate(async () => (await import('./js/store.js')).loadRocksmith());
  await wait(300);
  await page.click('button[aria-label="New song list"]');
  await page.waitForSelector('.modal:has-text("Add a song list?")');
  await wait(200);
  await shot(page, 'm6-no-rsmods');
  await page.click('.modal .btn.ghost');

  const d = dump();
  console.log('  final:', d.json.SongListsRoot.SongLists.length, 'lists, stock list 1:', JSON.stringify(d.json.SongListsRoot.SongLists[0]), '| other data intact:', d.json.Stats.SessionCount === 42);
  console.log('  errors:', errors.length, errors.slice(0, 5).join(' / '));
  await app.close();
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
