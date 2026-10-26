/*
 * Discover end to end: MusicBrainz search (fixtures), artist pages, Wanted,
 * Collection gaps and automatic import from a fake Downloads folder.
 * xvfb-run -a node test/e2e/discover.js <electron> <vgmstream-cli> <outDir>
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const { makeSong, makeZip } = require('../make_song');

const [electronBin, vgm, outDir] = process.argv.slice(2);
const APP = path.join(__dirname, '..', '..');
const SRC = path.join(APP, 'test/fixtures/integration_p.psarc');
const TOOL = path.join(APP, 'test', 'rs_profile_tool.py');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-disc-'));
const steam = path.join(home, 'Steam');
const game = path.join(home, 'Rocksmith2014');
const dlc = path.join(game, 'dlc');
const downloads = path.join(home, 'Downloads');
for (const d of [dlc, downloads, path.join(home, 'data')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(game, 'Rocksmith2014.exe'), 'x');
const { profile } = JSON.parse(execFileSync('python3', [TOOL, 'make', steam], { encoding: 'utf8' }));
const dump = () => JSON.parse(execFileSync('python3', [TOOL, 'dump', profile], { encoding: 'utf8' }));
fs.writeFileSync(path.join(home, 'data', 'settings.json'), JSON.stringify({ tools: { vgmstream: vgm }, stems: { auto: false } }));
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, n) => page.screenshot({ path: path.join(outDir, `${n}.png`) }).then(() => console.log('  screenshot', n));
const check = (cond, what) => {
  console.log(`  ${cond ? 'ok ' : 'FAIL'} ${what}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const songs = [
    ['LanternStaticBloom', 'The Lantern Hours', 'Static Bloom', 'First Light', 2009],
    ['LanternHarbour', 'The Lantern Hours', 'Harbour Lights', 'Signal Fires', 2012],
    ['LanternPaper', 'The Lantern Hours', 'Paper Moons (Remastered 2020)', 'Paper Moons', 2017],
    ['LanternWildHorses', 'The Lantern Hours', 'Wild Horses', 'Covers', 2019],
    ['MaraIronwood', 'Mara Quell', 'Ironwood', 'Quiet Engines', 2015],
    ['NorthPylon', 'Northbound Static', 'Pylon', 'Cold Frequencies', 2014],
  ];
  for (const [songKey, artist, title, album, year] of songs) await makeSong(SRC, path.join(dlc, `${songKey}_p.psarc`), { songKey, artist, title, album, year });

  const app = await electron.launch({
    executablePath: electronBin,
    args: ['--no-sandbox', APP],
    env: {
      ...process.env,
      STAGEHAND_HOME: home, STAGEHAND_NO_SPLASH: "1",
      STAGEHAND_STEAM_DIR: steam,
      STAGEHAND_MB_FIXTURES: path.join(APP, 'test/fixtures/musicbrainz'),
      STAGEHAND_DOWNLOADS: downloads,
      STAGEHAND_NO_EXTERNAL: '1',
      STAGEHAND_IMPORT_STABLE_MS: '300',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.stagehand && document.querySelector('#sidebar'), null, { timeout: 20000 }); // waitForReady
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.evaluate((p) => window.stagehand.library.addFolder(p), dlc);
  await page.waitForFunction(() => document.querySelectorAll('.row').length >= 6, null, { timeout: 20000 });
  await page.evaluate(async () => (await import('./js/store.js')).loadRocksmith());
  await page.waitForSelector('.nav-item[data-rslist="1"]', { timeout: 10000 });

  // ---- Search home
  await page.click('.nav-item:has-text("Search")');
  await page.waitForSelector('.dv-hero');
  await wait(300);
  check((await page.getAttribute('#search', 'placeholder')).includes('MusicBrainz'), 'titlebar search switches to MusicBrainz');
  await shot(page, 'd1-search-home');

  // ---- Search results: songs by title, then an artist
  await page.fill('#search', 'harbour');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.dv-table.songs .dv-row:not(.head)', { timeout: 10000 });
  await wait(300);
  const owned = await page.locator('.dv-table.songs .state.have').count();
  check(owned === 1, `search marks owned songs (${owned})`);
  await page.locator('.dv-row', { hasText: 'Quiet Harbour' }).locator('.c-main').click();
  await page.waitForSelector('.dv-selbar:not([hidden])');
  await shot(page, 'd2-search-songs');
  await page.click('.dv-selbar button:has-text("Clear")');
  await page.fill('#search', 'lantern hours');
  await page.waitForSelector('.artist-card', { timeout: 10000 });
  await wait(300);
  await shot(page, 'd2b-search-artist');

  // ---- Artist page
  await page.click('.artist-card');
  await page.waitForSelector('.album', { timeout: 15000 });
  await wait(700);
  const albums = await page.locator('.album h3').allTextContents();
  check(albums.join('|') === 'First Light|Signal Fires|Night Ferry|Paper Moons', `studio albums only: ${albums.join(', ')}`);
  const cline = await page.textContent('.completion .cline');
  check(/3 of 37 songs/.test(cline), `completion line: ${cline}`);
  await shot(page, 'd3-artist');

  // Select the missing songs from Night Ferry, add them to Wanted
  const nf = page.locator('.album', { hasText: 'Night Ferry' });
  await nf.scrollIntoViewIfNeeded();
  await nf.locator('button:has-text("Select missing")').click();
  await page.waitForSelector('.dv-selbar:not([hidden])');
  await wait(300);
  await shot(page, 'd4-selection');
  await page.click('.dv-selbar button:has-text("Add to Wanted")');
  await page.waitForSelector('.toast:has-text("Added 4 songs to Wanted")');
  await page.click('.seg button:has-text("Missing only")');
  await wait(300);
  await page.locator('.dv-scroll').evaluate((el) => (el.scrollTop = 0));
  await shot(page, 'd5-missing-only');
  await page.click('.seg button:has-text("All songs")');

  // ---- Wanted + CustomsForge hand-off
  await page.click('.nav-item:has-text("Wanted")');
  await page.waitForSelector('.want-row');
  await wait(300);
  const wantedCount = (await page.textContent('.nav-item:has-text("Wanted") .count')).trim();
  check(wantedCount === '4', `sidebar wanted count ${wantedCount}`);
  await shot(page, 'd6-wanted');
  await page.click('.dv-head button:has-text("Find next on CustomsForge")');
  await page.waitForSelector('.modal:has-text("Finding songs on CustomsForge")');
  await wait(250);
  await shot(page, 'd7-cf-explain');
  await page.click('.modal button:has-text("Open CustomsForge")');
  await page.waitForSelector('.toast:has-text("Opened CustomsForge")');
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  check(clip === 'The Lantern Hours Night Ferry', `clipboard: "${clip}"`);

  // ---- Collection gaps
  await page.click('.nav-item:has-text("Collection gaps")');
  await page.waitForSelector('.dv-head h1:has-text("Collection gaps")');
  await page.click('.dv-head button:has-text("Check")');
  await page.waitForSelector('.dv-banner.run', { timeout: 5000 });
  await wait(600);
  await shot(page, 'd8-gaps-running');
  await page.waitForFunction(() => !document.querySelector('.dv-banner.run'), null, { timeout: 30000 });
  await wait(400);
  const firstGap = await page.textContent('.gap-row:not(.head) .t');
  check(firstGap === 'The Lantern Hours', `most missing first: ${firstGap}`);
  check((await page.locator('.gap-row:has-text("Several artists")').count()) === 1, 'ambiguous artist flagged');
  await shot(page, 'd9-gaps');
  // Choose the ambiguous artist
  await page.click('.gap-row:has-text("Northbound Static") button:has-text("Choose")');
  await page.waitForSelector('.choice');
  await shot(page, 'd10-choose-artist');
  await page.click('.choice:has-text("Northbound Statics")');
  await page.waitForSelector('.album');
  await page.click('.back');
  await page.waitForSelector('.gap-row');
  await wait(300);
  check((await page.locator('.gap-row:has-text("Several artists")').count()) === 0, 'choice remembered');

  // ---- Imports: watch Downloads, add new songs to Song List 2
  await page.click('.nav-item:has-text("Imports")');
  await page.waitForSelector('.imp-card');
  await page.locator('.imp-card .setting:has-text("Watch for downloads") input.toggle').check();
  await page.waitForSelector('.nav-item:has-text("Imports") .live-dot');
  await page.locator('.imp-card select[aria-label="In-game list for new songs"]').selectOption('1');
  await wait(400);
  await shot(page, 'd11-imports-settings');

  // A browser download finishes: .crdownload renamed to the final name
  const tmpSong = await makeSong(SRC, path.join(home, 'nf.psarc'), { songKey: 'LanternNightFerry', artist: 'The Lantern Hours', title: 'Night Ferry', album: 'Night Ferry', year: 2014 });
  fs.copyFileSync(tmpSong, path.join(downloads, 'LanternHours_NightFerry_v1_p.psarc.crdownload'));
  await wait(800);
  fs.renameSync(path.join(downloads, 'LanternHours_NightFerry_v1_p.psarc.crdownload'), path.join(downloads, 'LanternHours_NightFerry_v1_p.psarc'));
  await page.waitForSelector('.toast:has-text("Imported Night Ferry")', { timeout: 20000 });
  await page.waitForSelector('.imp-row:has-text("added to")', { timeout: 10000 });
  await wait(500);
  await shot(page, 'd12-imported');
  check(fs.existsSync(path.join(dlc, 'LanternHours_NightFerry_v1_p.psarc')), 'moved into the dlc folder');
  check(!fs.existsSync(path.join(downloads, 'LanternHours_NightFerry_v1_p.psarc')), 'gone from Downloads');
  const list2 = dump().json.SongListsRoot.SongLists[1];
  check(list2.includes('LanternNightFerry'), `in-game Song List 2: ${JSON.stringify(list2)}`);

  // A ZIP with PC and Mac versions, imported the way a drop does it
  const kz = await makeSong(SRC, path.join(home, 'k.psarc'), { songKey: 'LanternKingfisher', artist: 'The Lantern Hours', title: 'Kingfisher', album: 'Night Ferry', year: 2014 });
  makeZip(path.join(home, 'Kingfisher.zip'), [
    ['Kingfisher_p.psarc', fs.readFileSync(kz)],
    ['Kingfisher_m.psarc', fs.readFileSync(kz)],
  ]);
  const r = await page.evaluate((p) => window.stagehand.imports.files([p]), path.join(home, 'Kingfisher.zip'));
  check(r.ok && r.value.length === 1 && r.value[0].status === 'imported', `zip import: ${JSON.stringify(r.value && r.value.map((x) => x.status))}`);
  // Not a song
  fs.copyFileSync(path.join(APP, 'test/fixtures/partial_p.psarc'), path.join(home, 'broken_p.psarc'));
  await page.evaluate((p) => window.stagehand.imports.files([p]), path.join(home, 'broken_p.psarc'));
  await wait(600);
  // The drop overlay
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'song_p.psarc'));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
  });
  await wait(200);
  await shot(page, 'd13-drop-overlay');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'song_p.psarc'));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('.drop-overlay[hidden]', { state: 'attached' });
  await wait(400);
  await page.locator('.dv-scroll').evaluate((el) => (el.scrollTop = 400));
  await wait(200);
  await shot(page, 'd14-import-history');

  // Wanted now shows the downloads as found
  await page.click('.nav-item:has-text("Wanted")');
  await page.waitForSelector('.want-row.found');
  await wait(300);
  const found = await page.locator('.want-row.found').count();
  check(found === 2, `found in Wanted: ${found}`);
  await shot(page, 'd15-wanted-found');

  // Undo the Night Ferry import
  await page.click('.nav-item:has-text("Imports")');
  await page.locator('.imp-row:has-text("Night Ferry") button[title^="Undo"]').click();
  await page.waitForSelector('.toast:has-text("Undid the import")');
  check(fs.existsSync(path.join(downloads, 'LanternHours_NightFerry_v1_p.psarc')), 'undo moved it back to Downloads');
  check(!dump().json.SongListsRoot.SongLists[1].includes('LanternNightFerry'), 'undo took it off Song List 2');

  // Library: no match -> search online; song menu link
  await page.click('.nav-item:has-text("All songs")');
  await page.waitForSelector('.row');
  check((await page.getAttribute('#search', 'placeholder')).startsWith('Search songs'), 'titlebar search back to library');
  await page.fill('#search', 'kerosene');
  await page.waitForSelector('.empty button:has-text("Search MusicBrainz")');
  await shot(page, 'd16-library-no-match');
  await page.fill('#search', '');
  await page.locator('.row', { hasText: 'Ironwood' }).click({ button: 'right' });
  check((await page.locator('.menu button:has-text("What’s missing from Mara Quell")').count()) === 1, 'song menu links to Discover');
  await page.click('.menu button:has-text("What’s missing from Mara Quell")');
  await page.waitForSelector('.album');
  await wait(400);
  await shot(page, 'd17-artist-from-menu');

  console.log('  errors:', errors.length, errors.slice(0, 5).join(' / '));
  if (errors.length) process.exitCode = 1;
  await app.close();
})().catch((e) => {
  console.error('FAILED', e.stack || e.message);
  process.exit(1);
});
