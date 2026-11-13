/** 4.12: Discover in the same look as the other pages: Search, an artist, Collection gaps,
 * Wanted and Imports, with the main buttons there and no page errors.
 *   SH_AUDIT=test/e2e/discover-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 * MusicBrainz answers are made up in the page (the test app has none). Pictures: discover-*.png */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1500, height: 900 });
  // level-up cards and notes from earlier pages would cover the pictures
  await page.addStyleTag({ content: '.lvup, .toasts { display: none !important; }' });
  const shot = (n) => page.screenshot({ path: path.join(outDir, `discover-${n}.png`) });
  const btn = (name, within = '#discover') => page.locator(within).getByRole('button', { name, exact: true });
  const has = async (name, what, within) => check((await btn(name, within).count()) > 0, `${what}: “${name}”`);

  // made-up MusicBrainz answers, a short Wanted list and a gaps check that has run
  await page.evaluate(async () => {
    localStorage.setItem('stagehand.cfExplained', '1');
    const { api } = await import('./js/api.js');
    const { state } = await import('./js/store.js');
    const songs = [...state.songs.values()];
    const mine = songs[0] || { artist: 'Test Band', title: 'Song' };
    const artist = { id: 'mb-1', name: mine.artist, type: 'Group', country: 'GB', disambiguation: '' };
    const t = (title, have, extra = {}) => ({ title, length: 200000 + title.length * 3000, have, songId: have ? mine.id : null, ...extra });
    const wanted = [
      { id: 'w1', artist: mine.artist, title: 'Second Single', album: 'First Light', year: 1999, status: 'wanted', addedAt: Date.now() - 86400000 },
      { id: 'w2', artist: mine.artist, title: 'Long Way Down', album: 'Night Drive', year: 2004, status: 'wanted', addedAt: Date.now() - 3600000 },
      { id: 'w3', artist: 'Another Band', title: 'Rooftops', status: 'wanted', addedAt: Date.now() },
      { id: 'w4', artist: 'Another Band', title: 'Found One', status: 'found', foundAt: Date.now() - 7200000, songId: mine.id },
    ];
    api.discover.recent = async () => ['Foo Fighters', 'Muse', 'Rush - Tom Sawyer'];
    api.discover.wanted = async () => wanted;
    api.discover.search = async (q) => ({
      query: q,
      artists: [artist, { id: 'mb-2', name: `${q} Tribute`, type: 'Group', country: 'US', disambiguation: 'cover band' }, { id: 'mb-3', name: `${q} Jr.`, type: 'Person', country: 'CA' }],
      songs: [
        { artist: artist.name, artistId: artist.id, title: mine.title, album: 'First Light', year: 1999, ...t(mine.title, true) },
        { artist: artist.name, artistId: artist.id, title: 'Second Single', album: 'First Light', year: 1999, ...t('Second Single', false) },
        { artist: artist.name, artistId: artist.id, title: 'Long Way Down', album: 'Night Drive', year: 2004, ...t('Long Way Down', false) },
        { artist: 'Another Band', title: 'Rooftops', album: 'Skyline', year: 2011, ...t('Rooftops', false) },
        { artist: 'Another Band', title: 'Brand New', album: 'Skyline', year: 2011, ...t('Brand New', false) },
      ],
    });
    api.discover.artist = async () => ({
      artist,
      have: 3,
      total: 9,
      missing: 6,
      albums: [
        { id: null, title: 'First Light', year: 1999, type: 'Album', tracks: [t(mine.title, true), t('Second Single', false, { wanted: true }), t('Harbour', false), t('Glass', false), t('Under The Pier', true)] },
        { id: null, title: 'Night Drive', year: 2004, type: 'EP', tracks: [t('Long Way Down', false), t('Static', true), t('Night Drive', false), t('Coda', false)] },
      ],
      extras: [{ id: mine.id, title: `${mine.title} (Live)` }],
      skipped: [],
    });
    const gaps = {
      running: null,
      artists: [
        { key: 'a', name: artist.name, status: 'ok', have: 3, total: 9, missing: 6, albums: 2, owned: 3, checkedAt: Date.now() - 86400000, mbid: 'mb-1' },
        { key: 'b', name: 'Another Band', status: 'ok', have: 5, total: 5, missing: 0, albums: 1, owned: 5, checkedAt: Date.now() - 86400000 },
        { key: 'c', name: 'The Somebodies', status: 'ambiguous', owned: 2 },
        { key: 'd', name: 'Nobody Knows', status: 'unchecked', owned: 1 },
        { key: 'e', name: 'Lost Group', status: 'not-found', owned: 1 },
      ],
    };
    api.discover.gaps = async () => gaps;
    api.discover.checkGaps = async () => gaps;
    api.imports.status = async () => ({ watch: false, watchDir: 'C:\\Users\\me\\Downloads', watchDirExists: true, target: { path: 'C:\\Games\\Rocksmith2014\\dlc', auto: true, game: true }, list: null, replace: true, keepOriginal: false, history: [] });
    state.discover.recent = await api.discover.recent();
    state.discover.wanted = wanted;
    state.discover.gaps = gaps;
  });

  // Search, nothing typed: recent searches and your artists
  await page.evaluate(async () => {
    (await import('./js/store.js')).setPage('discover');
    (await import('./js/discover.js')).open('search');
  });
  await page.waitForTimeout(900);
  check(await page.locator('#discover .dv-head h1').isVisible(), 'Search has its page title');
  check((await page.locator('#discover .chip').count()) === 3, 'recent searches show as chips');
  check((await page.locator('#discover .artist-card').count()) > 0, 'your artists show as cards');
  await shot('search');

  // Search results: artists and songs, ticking songs brings up the bar
  await page.evaluate(async () => {
    document.getElementById('search').value = 'Test';
    (await import('./js/discover.js')).setQuery('Test', { now: true });
  });
  await page.waitForTimeout(900);
  check((await page.locator('#discover .dv-table.songs .dv-row:not(.head)').count()) === 5, 'search results list the songs');
  await has('Select 4 missing', 'search results');
  await has('Want it', 'a missing song');
  await has('Play', 'a song you have');
  await btn('Select 4 missing').click();
  await page.waitForTimeout(300);
  check(await page.locator('.dv-selbar').isVisible(), 'ticked songs bring up the bar');
  await has('Add to Wanted', 'the bar', '.dv-selbar');
  await has('Copy as a list', 'the bar', '.dv-selbar');
  await shot('results');
  await btn('Clear', '.dv-selbar').click();

  // an artist page
  await page.locator('#discover .artist-card').first().click();
  await page.waitForTimeout(1200);
  check((await page.locator('#discover section.album').count()) === 2, 'the artist page shows its albums');
  for (const b of ['Search', 'All songs', 'Missing only (6)', 'Select all missing']) await has(b, 'the artist page');
  check((await page.locator('#discover .album .dv-row').count()) === 9, 'every song of the albums is listed');
  await shot('artist');
  await page.evaluate(() => document.querySelector('#discover .dv-scroll').scrollTo(0, 99999));
  await page.waitForTimeout(200);
  await shot('artist-end');
  await btn('Missing only (6)').click();
  await page.waitForTimeout(400);
  check((await page.locator('#discover .album .dv-row').count()) === 6, 'Missing only hides the songs you have');
  await btn('All songs').click();

  // Collection gaps
  await page.evaluate(async () => (await import('./js/discover.js')).open('gaps'));
  await page.waitForTimeout(900);
  check((await page.locator('#discover .gap-row:not(.head)').count()) === 5, 'Collection gaps lists the artists');
  for (const b of ['Check 1 artist', 'All', 'With gaps', 'Complete', 'Not checked', 'Choose…', 'Check']) await has(b, 'Collection gaps');
  check((await page.locator('#discover .stats .stat').count()) === 3, 'Collection gaps shows its three numbers');
  await shot('gaps');

  // Wanted
  await page.evaluate(async () => (await import('./js/discover.js')).open('wanted'));
  await page.waitForTimeout(900);
  for (const b of ['Get songs', 'Find next', 'Copy list', 'Clear found', 'Watch Downloads', 'Find']) await has(b, 'Wanted');
  check((await page.locator('#discover .want-row').count()) === 4, 'Wanted lists the songs by artist');
  await shot('wanted');

  // Wanted with nothing in it
  await page.evaluate(async () => {
    const { api } = await import('./js/api.js');
    api.discover.wanted = async () => [];
    (await import('./js/discover.js')).open('search');
    (await import('./js/discover.js')).open('wanted');
  });
  await page.waitForTimeout(900);
  check(await page.locator('#discover .dv-empty').isVisible(), 'an empty Wanted list says how to fill it');
  await has('Collection gaps', 'empty Wanted');
  await shot('wanted-empty');

  // Imports
  await page.evaluate(async () => (await import('./js/discover.js')).open('imports'));
  await page.waitForTimeout(900);
  for (const b of ['Import files…', 'Look for songs', 'Change…']) await has(b, 'Imports');
  await shot('imports');

  // a newer page next to it, to compare
  await page.locator('#sidebar .nav-section[data-page="karaoke"]').click().catch(() => {});
  await page.waitForTimeout(800);
  await shot('compare-karaoke');

  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
