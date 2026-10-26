/*
 * Renaming in-game song lists end to end.
 * xvfb-run -a node test/e2e/rename.js <electron> <vgmstream-cli> <outDir>
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const [electronBin, vgm, outDir] = process.argv.slice(2);
const APP = path.join(__dirname, '..', '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-ren-'));
const steam = path.join(home, 'Steam');
const game = path.join(home, 'Rocksmith2014');
const songs = path.join(game, 'dlc');
fs.mkdirSync(songs, { recursive: true });
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.writeFileSync(path.join(game, 'Rocksmith2014.exe'), 'x');
fs.writeFileSync(path.join(game, 'xinput1_3.dll'), Buffer.alloc(400000));
const GUI_INI = ['[SongListTitles]', ...Array.from({ length: 20 }, (_, i) => `SongListTitle_${i + 1} = Define Song List ${i + 1} Here`), '[Toggle Switches]', 'ToggleLoft = off', ''].join('\r\n');
fs.writeFileSync(path.join(game, 'RSMods.ini'), GUI_INI);
fs.copyFileSync(path.join(APP, 'test/fixtures/integration_p.psarc'), path.join(songs, 'integration_p.psarc'));
execFileSync('python3', [path.join(APP, 'test', 'rs_profile_tool.py'), 'make', steam]);
fs.writeFileSync(path.join(home, 'data', 'settings.json'), JSON.stringify({ tools: { vgmstream: vgm }, stems: { auto: false } }));
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, n) => page.screenshot({ path: path.join(outDir, `${n}.png`) }).then(() => console.log('  screenshot', n));
const iniLine = (n) => fs.readFileSync(path.join(game, 'RSMods.ini'), 'utf8').split('\r\n').find((l) => l.startsWith(`SongListTitle_${n} =`));

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
  await page.waitForFunction(() => document.querySelectorAll('.row').length >= 1, null, { timeout: 15000 });
  await page.evaluate(async () => (await import('./js/store.js')).loadRocksmith());
  await page.waitForSelector('.nav-item[data-rslist="1"]', { timeout: 10000 });

  // Double-click Song List 2, type a name, Enter
  await page.dblclick('.nav-item[data-rslist="1"]');
  await page.waitForSelector('.nav-item.editing input.rename');
  await page.keyboard.type('Warmups');
  await wait(200);
  await shot(page, 'n1-typing');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast:has-text("Renamed Song List 2")', { timeout: 10000 });
  await page.click('.nav-item[data-rslist="1"]');
  await wait(400);
  await shot(page, 'n2-renamed');
  console.log('  ini line 2:', iniLine(2), '| sidebar:', (await page.textContent('.nav-item[data-rslist="1"] .name')).trim(), '| title:', await page.textContent('.lib-title h1'));
  console.log('  other settings intact:', fs.readFileSync(path.join(game, 'RSMods.ini'), 'utf8').includes('[Toggle Switches]\r\nToggleLoft = off'));

  // Right-click > Rename via menu, another list
  await page.locator('.nav-item[data-rslist="3"]').click({ button: 'right' });
  await page.click('.menu button:has-text("Rename")');
  await page.keyboard.type('B Standard');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast:has-text("Renamed Song List 4")', { timeout: 10000 });

  // Add to Rocksmith menu shows the new names
  await page.click('.nav-item:has-text("All songs")');
  await wait(300);
  await page.locator('.row').first().click({ button: 'right' });
  await page.click('.menu button:has-text("Add to Rocksmith")');
  await wait(300);
  await shot(page, 'n3-menu-names');
  console.log('  menu entries:', (await page.locator('.menu').last().locator('button span:nth-child(2)').allTextContents()).join(', '));
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 500);

  // Back to the stock name
  await page.locator('.nav-item[data-rslist="1"]').click({ button: 'right' });
  await page.click('.menu button:has-text("Use the name Song List 2")');
  await page.waitForSelector('.toast:has-text("stock name again")', { timeout: 10000 });
  console.log('  after reset, ini line 2:', iniLine(2));

  // Without RSMods: the name is saved, and the app explains how to see it in game
  fs.unlinkSync(path.join(game, 'xinput1_3.dll'));
  await page.dblclick('.nav-item[data-rslist="5"]');
  await page.keyboard.type('Gig night');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast:has-text("Get RSMods")', { timeout: 10000 });
  await wait(300);
  await shot(page, 'n4-no-rsmods');

  await page.click('#btn-settings');
  await page.click('.settings .nav-item[data-tab="rocksmith"]');
  await page.waitForSelector('.setting:has-text("Song list names")', { timeout: 10000 });
  await wait(400);
  await shot(page, 'n5-settings');
  console.log('  errors:', errors.length, errors.slice(0, 5).join(' / '));
  await app.close();
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
