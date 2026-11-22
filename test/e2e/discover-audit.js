/** 4.12: Discover in the same look as the other pages: Search, an artist, Collection gaps,
 * Wanted and Imports, with the main buttons there and no page errors. 4.26: Get in one step
 * (search, an artist, gaps), the live MusicBrainz reading display, one Official DLC request.
 *   SH_AUDIT=test/e2e/discover-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 * MusicBrainz answers are made up in the page (the test app has none). Pictures: discover-*.png */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.setDefaultTimeout(15000); // a missing button fails the check instead of waiting forever
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1500, height: 900 });
  // level-up cards and notes from earlier pages would cover the pictures
  await page.addStyleTag({ content: '.lvup, .toasts { display: none !important; }' });
  const shot = (n) => page.screenshot({ path: path.join(outDir, `discover-${n}.png`) });
  const btn = (name, within = '#discover') => page.locator(within).getByRole('button', { name, exact: true });
  const has = async (name, what, within) => check((await btn(name, within).count()) > 0, `${what}: “${name}”`);
  // 4.25: pictures in both looks (the Rehearsal Room and Roadshow) at two window sizes
  const setLook = async (name) => {
    await page.evaluate(async (name) => {
      const m = await import('./js/menu-art.js');
      m.appearancePrefs.look = name;
      m.director.write(m.storage('localStorage'), m.APPEARANCE_KEY, m.appearancePrefs);
      document.documentElement.dataset.look = name;
    }, name);
  };
  const looks = async (n) => {
    if (process.env.DV_LOOKS === '0') return;
    const was = await page.evaluate(() => document.documentElement.dataset.look || 'opera');
    for (const lk of ['opera', 'roadshow']) {
      await setLook(lk);
      for (const [w, hgt] of [[1500, 900], [1280, 720]]) {
        await page.setViewportSize({ width: w, height: hgt });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(outDir, `look-${lk}-${w}-${n}.png`) });
      }
    }
    await setLook(was);
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.waitForTimeout(200);
  };
  const go = async (id) => {
    await page.evaluate(async (id) => (await import('./js/discover.js')).open(id), id);
    await page.waitForTimeout(700);
  };
  const n = (sel) => page.locator(sel).count();
  const rx = (re, within = '#discover') => page.locator(within).getByRole('button', { name: re });
  const barText = async () => ((await page.locator('.dv-selbar:not([hidden])').count()) ? await page.locator('.dv-selbar .count').textContent() : '');

  // made-up MusicBrainz answers, a short Wanted list and a gaps check that has run
  await page.evaluate(async () => {
    localStorage.setItem('stagehand.cfExplained', '1');
    localStorage.setItem('stagehand.finderExplained', '1');
    localStorage.removeItem('stagehand.wantTab');
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
    // 4.25: statuses, official DLC, a request, updates and the end of a run, all made up here
    const copy = () => wanted.map((w) => ({ ...w }));
    window.__dv = { wanted, requests: [], done: [], updChecked: 0 };
    api.discover.setStatus = async (ids, status) => {
      for (const w of wanted) if (ids.includes(w.id)) Object.assign(w, { status }, status === 'unavailable' ? { tries: (w.tries || 0) + 1, unavailableAt: Date.now() } : {});
      return copy();
    };
    api.discover.removeWanted = async (ids) => {
      for (let i = wanted.length - 1; i >= 0; i--) if (ids.includes(wanted[i].id)) wanted.splice(i, 1);
      return copy();
    };
    const off = (artist, title, wantedId = null) => ({ artist, title, key: `${artist.toLowerCase()}|${title.toLowerCase()}`, wantedId, onList: true });
    window.__dv.official = { songs: [off(mine.artist, 'Long Way Down', 'w2'), off('Another Band', 'Paid Anthem'), off('Another Band', 'Store Bought'), off('Big Label Band', 'Radio Hit'), off('Big Label Band', 'Second Hit'), off('Big Label Band', 'Deep Cut')], nextAt: 0, contact: '', queued: 0 };
    api.discover.official = async () => JSON.parse(JSON.stringify(window.__dv.official));
    api.discover.requestOfficial = async (req) => {
      window.__dv.requests.push(req);
      window.__dv.official.nextAt = Date.now() + 12 * 3600e3;
      return { ok: true, via: 'ntfy', nextAt: window.__dv.official.nextAt, count: req.all ? window.__dv.official.songs.length : (req.songs || []).length };
    };
    const upd = (key, artist, title, version, ours) => ({ key, artist, title, version, ours, updated: '2026-11-10', songId: mine.id });
    window.__dv.updates = { rows: [upd('u1', mine.artist, mine.title, '3', '2'), upd('u2', 'Another Band', 'Rooftops', '1.5', '1')], checkedAt: Date.now() - 3600e3 };
    api.discover.updates = async () => JSON.parse(JSON.stringify(window.__dv.updates));
    api.discover.clearUpdates = async (keys) => ((window.__dv.updates.rows = window.__dv.updates.rows.filter((r) => !keys.includes(r.key))), JSON.parse(JSON.stringify(window.__dv.updates)));
    api.discover.finderDone = async (s) => window.__dv.done.push(s);
    api.discover.finderUpdates = async () => window.__dv.updChecked++;
    api.discover.recent = async () => ['Foo Fighters', 'Muse', 'Rush - Tom Sawyer'];
    api.discover.wanted = async () => wanted;
    // 4.26: Get puts songs on Wanted (this list) and starts the song finder on them
    window.__dv.added = [];
    window.__dv.finds = [];
    api.discover.addWanted = async (items) => {
      let added = 0;
      for (const it of items) {
        window.__dv.added.push(`${it.artist} - ${it.title}`);
        const k = `${it.artist}|${it.title}`.toLowerCase();
        const w = wanted.find((x) => `${x.artist}|${x.title}`.toLowerCase() === k);
        if (w) {
          if (w.status !== 'found') w.status = 'wanted';
          continue;
        }
        wanted.push({ id: `n${wanted.length + 1}`, artist: it.artist, title: it.title, album: it.album || '', year: it.year || null, status: 'wanted', addedAt: Date.now() });
        added++;
      }
      return { added, official: 0, wanted: copy() };
    };
    const realFinder = api.discover.finder;
    api.discover.finder = async (q) => (window.__dv.finds.push(q), realFinder ? realFinder(q) : { ok: true });
    window.__dv.gapSongs = [];
    const miss = (title, album) => ({ artist: mine.artist, title, album, year: 2004, wanted: false, unavailable: false });
    api.discover.gapSongs = async (o) => {
      window.__dv.gapSongs.push(o);
      const all = [{ key: 'a', artist: mine.artist, songs: [miss('Harbour', 'First Light'), miss('Glass', 'First Light'), miss('Night Drive', 'Night Drive'), miss('Coda', 'Night Drive'), miss('Night Swim', 'Night Drive'), miss('Long Way Down', 'Night Drive')] }];
      const q = String(o.query || '').toLowerCase();
      return all.filter((g) => !o.keys || o.keys.includes(g.key)).map((g) => ({ ...g, songs: g.songs.filter((x) => !q || `${g.artist} ${x.title} ${x.album}`.toLowerCase().includes(q)) })).filter((g) => g.songs.length);
    };
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
    api.discover.artist = async () => (window.__dv.gate && (await window.__dv.gate), {
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

  // 4.25: the highway's Go to › Discover only changes the page: Discover must still draw itself
  await page.evaluate(async () => {
    const st = await import('./js/store.js');
    st.setView({ kind: 'all' });
    st.setPage('discover');
  });
  await page.waitForTimeout(900);
  check(await page.locator('#discover .dv-head h1').isVisible(), 'Discover opened from another page is not blank');

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
  await looks('search');

  // Search results: artists and songs, ticking songs brings up the bar
  await page.evaluate(async () => {
    document.getElementById('search').value = 'Test';
    (await import('./js/discover.js')).setQuery('Test', { now: true });
  });
  await page.waitForTimeout(900);
  check((await page.locator('#discover .dv-table.songs .dv-row:not(.head)').count()) === 5, 'search results list the songs');
  await has('Get all 4 missing', 'search results');
  await has('Get it', 'a missing song');
  await has('Play', 'a song you have');
  check((await n('#discover .dv-table.songs .dv-row .get-it')) === 4 && (await n('#discover .dv-table.songs .dv-row button[title^="Save for later"]')) === 1 && (await n('#discover .dv-table.songs .dv-row button.on[title^="On Wanted"]')) === 3, 'every missing song has Get it and a star for later (lit when on Wanted)');
  check((await n('#discover .sec-ic')) >= 2, 'artists and songs have their own headings');
  await page.locator('#discover .dv-table.songs .dv-row:not(.head):not(.have)').nth(0).click({ position: { x: 300, y: 14 } });
  await page.locator('#discover .dv-table.songs .dv-row:not(.head):not(.have)').nth(1).click({ position: { x: 300, y: 14 } });
  await page.waitForTimeout(300);
  check(await page.locator('.dv-selbar').isVisible(), 'ticked songs bring up the bar');
  for (const b of ['Get these 2', 'Save for later', 'Copy as a list']) await has(b, 'the bar', '.dv-selbar');
  await shot('results');
  await looks('results');
  await btn('Clear', '.dv-selbar').click();

  // 4.26: an artist page being read: the live reading display fills the page, album by album
  await page.evaluate(() => {
    window.__dv.gate = new Promise((r) => (window.__dv.open = r));
  });
  await page.locator('#discover .artist-card').first().click();
  await page.waitForTimeout(500);
  check(await page.locator('#discover .dv-reading').isVisible(), 'the reading display shows while the artist is read');
  // the user's animation (The Reliquary, vendor/reliquary) mounts in it, the whole width, its own shape
  await page.waitForSelector('#discover .rd-rig svg[data-performance]', { timeout: 8000 }).catch(() => null);
  const rigBox = await page.evaluate(() => {
    const svg = document.querySelector('#discover .rd-rig svg[data-performance]');
    const panel = document.querySelector('#discover .dv-reading');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    // every change of what its screen says, to check it follows MusicBrainz live
    window.__dv.rigSaid = [];
    new MutationObserver(() => window.__dv.rigSaid.push(svg.getAttribute('aria-label') || '')).observe(svg, { attributes: true, attributeFilter: ['aria-label'] });
    return { w: r.width, h: r.height, panel: panel.getBoundingClientRect().width, take: svg.getAttribute('data-performance'), said: svg.getAttribute('aria-label') };
  });
  check(!!rigBox, 'the animation mounts while the artist is read');
  check(rigBox && Math.abs(rigBox.w / rigBox.h - 1983 / 793) < 0.02 && rigBox.w >= rigBox.panel - 4, `it fills the width in its own shape (${rigBox && `${Math.round(rigBox.w)}×${Math.round(rigBox.h)} of ${Math.round(rigBox.panel)}, ${rigBox.take}`})`);
  check(rigBox && /SEARCHING/.test(rigBox.said), `it starts searching (${rigBox && rigBox.said})`);
  const artistName = await page.evaluate(async () => [...(await import('./js/store.js')).state.songs.values()][0]?.artist || 'Test Band');
  check((await page.locator('#discover .dv-reading .rd-artist').textContent()) === artistName, 'it names the artist');
  const prog = (o) => page.evaluate((o) => window.__shEmit('discover:progress', { kind: 'artist', id: 'mb-1', ...o }), { artist: artistName, ...o });
  // a late event from an artist looked up before: ignored
  await page.evaluate(() => window.__shEmit('discover:progress', { kind: 'artist', id: 'mb-old', artist: 'Somebody Else Entirely', done: 4, total: 9, title: 'Old Record', last: null }));
  await page.waitForTimeout(200);
  check(!/Somebody Else|Old Record/.test((await page.locator('#discover .dv-reading').textContent()) + (await page.evaluate(() => window.__dv.rigSaid.join('|')))), 'a late event from another artist is ignored');
  await prog({ done: 0, total: 3, title: 'First Light', albumId: 'rg-1', year: 1999, type: 'Album', last: null });
  await page.waitForTimeout(200);
  check((await page.locator('#discover .rd-album').textContent()) === 'First Light', 'it shows the album being read');
  check(/1\s*of 3 albums/.test(await page.locator('#discover .rd-count').textContent()), `and how far it has got (${await page.locator('#discover .rd-count').textContent()})`);
  const mineTitle = await page.evaluate(async () => [...(await import('./js/store.js')).state.songs.values()][0]?.title || 'Song');
  await prog({ done: 1, total: 3, title: 'Night Drive', albumId: 'rg-2', year: 2004, type: 'EP', last: { title: 'First Light', year: 1999, tracks: [mineTitle, 'Second Single', 'Harbour', 'Glass', 'Under The Pier'] } });
  await page.waitForTimeout(700);
  check((await page.locator('#discover .rd-album').textContent()) === 'Night Drive' && /EP · 2004/.test(await page.locator('#discover .rd-meta').textContent()), 'the album changes live');
  check((await n('#discover .rd-songs li')) === 5 && (await n('#discover .rd-songs li.mine')) >= 1, 'the songs of the album just read, yours ticked');
  check(/2\s*of 3 albums/.test(await page.locator('#discover .rd-count').textContent()) && /5 songs so far/.test(await page.locator('#discover .rd-count').textContent()), 'the count moves on');
  await page.waitForTimeout(1200);
  const said = await page.evaluate(() => window.__dv.rigSaid.slice());
  check(said.some((x) => /First Light/.test(x)) && said.some((x) => /Second Single/.test(x)), `the animation's screen shows the album read and its songs (${said.filter((x) => /Second Single/.test(x))[0] || said.slice(-1)[0]})`);
  check(/Night Drive/.test(said[said.length - 1] || '') && /1 \/ 3/.test(said[said.length - 1] || ''), `then the album being read now, with the count (${said[said.length - 1]})`);
  await shot('reading');
  await looks('reading');
  await prog({ done: 2, total: 3, title: 'Third Time', albumId: 'rg-3', year: 2008, type: 'Album', last: { title: 'Night Drive', year: 2004, tracks: ['Long Way Down', 'Static', 'Night Drive', 'Coda'] } });
  await page.waitForTimeout(300);
  check((await n('#discover .rd-chip')) === 2, 'albums read so far pile up');
  check(/Third Time/.test(await page.locator('#discover .rd-now').textContent()) && (await page.locator('#discover .rd-now').getAttribute('aria-live')) === 'polite', 'the words under it say the same, out loud for screen readers');
  await page.evaluate(() => window.__dv.open());
  await page.waitForTimeout(900);
  check(!(await n('#discover .dv-reading')), 'the albums replace the reading display');
  check(!(await n('svg[data-performance]')), 'and the animation is let go');
  check((await page.locator('#discover section.album').count()) === 2, 'the artist page shows its albums');
  for (const b of ['Search', 'All (9)', 'Missing (6)', 'In library (3)']) await has(b, 'the artist page');
  check((await rx(/^Get all missing \(\d+\)$/).count()) === 1, 'the artist page has Get all missing');
  check((await n('#discover .album .get-album')) === 2, 'each album with gaps has its own Get');
  check((await page.locator('#discover .album .dv-row').count()) === 9, 'every song of the albums is listed');
  await shot('artist');
  await looks('artist');
  await page.evaluate(() => document.querySelector('#discover .dv-scroll').scrollTo(0, 99999));
  await page.waitForTimeout(200);
  await shot('artist-end');
  await btn('Missing (6)').click();
  await page.waitForTimeout(400);
  check((await page.locator('#discover .album .dv-row').count()) === 6, 'Missing hides the songs you have');
  // 4.23: a song you have that's missing a part (no bass, no lead…) offers a better version
  await btn('All (9)').click();
  await page.waitForTimeout(300);
  const better = await page.locator('#discover .album [title^="Find a better version"]').count();
  const partsN = await page.evaluate(() => { const b = [...document.querySelectorAll('#discover .seg button')].find((x) => /Missing a part/.test(x.textContent)); return b ? Number((/\((\d+)\)/.exec(b.textContent) || [])[1]) : 0; });
  check(better === partsN, `songs missing a part offer Find a better version (${better} of ${partsN})`);
  await btn('In library (3)').click();
  await page.waitForTimeout(400);
  check((await page.locator('#discover .album .dv-row').count()) === 3, 'In library shows only the songs you have');
  await btn('All (9)').click();

  // Collection gaps
  await page.evaluate(async () => (await import('./js/discover.js')).open('gaps'));
  await page.waitForTimeout(900);
  check((await page.locator('#discover .gap-row:not(.head)').count()) === 5, 'Collection gaps lists the artists');
  for (const b of ['Get all missing (6)', 'Check 1 artist', 'All', 'With gaps', 'Complete', 'Not checked', 'Choose…', 'Check', 'Get 6']) await has(b, 'Collection gaps');
  check((await page.locator('#discover .stats .stat').count()) === 3, 'Collection gaps shows its three numbers');
  await shot('gaps');
  await looks('gaps');
  // 4.26: search the gaps: the artists and the missing songs that match, each with Get
  await page.locator('#discover .gaps-find').pressSequentially('night', { delay: 30 });
  await page.waitForTimeout(900);
  check((await n('#discover .gap-hits .dv-row')) === 4, `the missing songs that match show (${await n('#discover .gap-hits .dv-row')})`);
  check(await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('gaps-find')), 'typing keeps the box');
  await has('Get all 4', 'the songs that match');
  await shot('gaps-search');
  await looks('gaps-search');
  await page.locator('#discover .gaps-find').fill('');
  await page.waitForTimeout(600);
  // a check running: a band with the reading display, the album changing live
  await page.evaluate(async () => {
    const { state } = await import('./js/store.js');
    window.__shEmit('discover:gaps', { ...state.discover.gaps, running: { done: 1, total: 3, current: 'Another Band' } });
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__shEmit('discover:progress', { kind: 'gaps', artist: 'Another Band', done: 1, total: 4, title: 'Skyline', year: 2011, type: 'Album', last: { title: 'Debut', year: 2009, tracks: ['One', 'Two'] } }));
  await page.waitForTimeout(300);
  check((await n('#discover .gaps-run .dv-reading.compact')) === 1, 'a check shows the reading display as a band');
  check((await page.locator('#discover .gaps-run .rd-artist').textContent()) === 'Another Band' && (await page.locator('#discover .gaps-run .rd-album').textContent()) === 'Skyline', 'the band names the artist and the album being read');
  await page.waitForSelector('#discover .gaps-run .rd-rig svg[data-performance]', { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(1500);
  check(/Another Band/.test((await page.locator('#discover .gaps-run .rd-rig svg').getAttribute('aria-label').catch(() => '')) || ''), 'the animation plays in the band too, on the artist being checked');
  await shot('gaps-checking');
  await looks('gaps-checking');
  await page.evaluate(async () => {
    const { state } = await import('./js/store.js');
    window.__shEmit('discover:gaps', { ...state.discover.gaps, running: null });
  });
  await page.waitForTimeout(500);
  check(!(await n('svg[data-performance]')), 'when the check is done the animation is let go');

  // Wanted
  await page.evaluate(async () => (await import('./js/discover.js')).open('wanted'));
  await page.waitForTimeout(900);
  for (const b of ['Get songs (3)', 'Copy list', 'Clear found', 'Watch Downloads', 'Find']) await has(b, 'Wanted');
  check(!(await btn('Find next').count()), 'no Find next (Get songs does it)');
  check((await n('#discover .want-queue .mark-na')) === 3, 'every song to find can be marked Not available');
  // 4.24: the Now card with its steps and whose turn it is, the queue in order, and by artist
  check(await page.locator('#discover .want-now').isVisible(), 'Wanted has a Now card');
  check((await page.locator('#discover .want-steps li').count()) === 5 && /Not started|Waiting on you|Stagehand is working/.test(await page.locator('#discover .want-turn').textContent()), 'the Now card has its five steps and says whose turn it is');
  check((await page.locator('#discover .want-row:not(.head)').count()) === 4, 'Wanted lists the songs (in order)');
  check((await page.locator('#discover .want-row.q .c-num').first().textContent()) === '1', 'the queue is numbered');
  await shot('wanted');
  // a song coming in through the finder: the steps move on, and Activity shows it
  await page.evaluate(() => window.__shEmit('finder:event', { type: 'download', name: 'song_p.psarc', state: 'going', pct: 40 }));
  await page.waitForTimeout(300);
  check(/Downloading/.test(await page.locator('#discover .want-steps li.on').textContent()), 'a download lights Downloading');
  check(await page.evaluate(() => [...document.querySelectorAll('#sidebar .sh-activity .act-row')].some((r) => /song_p\.psarc/.test(r.textContent))), 'the download is in Activity');
  await shot('wanted-downloading');
  await page.locator('#discover .want-view button', { hasText: 'By artist' }).click();
  await page.waitForTimeout(400);
  check((await page.locator('#discover .want-group').count()) >= 1, 'By artist groups them');
  // 4.25: a tick box for each artist ticks all their songs
  const grpBox = page.locator('#discover .want-group input.pick-group').first();
  check((await n('#discover .want-group input.pick-group')) >= 1, 'By artist has a tick box for each artist');
  await grpBox.click();
  await page.waitForTimeout(200);
  check(/^1 song selected/.test(await barText()), `the artist's box ticks their songs (${await barText()})`);
  await looks('wanted-by-artist');
  await btn('Clear', '.dv-selbar').click();
  await page.locator('#discover .want-view button', { hasText: 'In order' }).click();
  await page.waitForTimeout(300);
  await looks('wanted');

  // 4.25: ticking many: Select all, shift-click a run, and the bar's buttons
  const sa = page.locator('#discover .pick-all');
  check(/Select all \(3\)/.test(await sa.textContent()), `Select all counts what's showing (${(await sa.textContent()).trim()})`);
  await sa.click();
  await page.waitForTimeout(200);
  check(/3 songs selected/.test(await barText()), 'Select all ticks every song');
  for (const b of ['Remove', 'Mark not available', 'Copy as a list', 'Clear']) await has(b, 'the bar for ticked songs', '.dv-selbar');
  check(/Select none/.test(await sa.textContent()), 'Select all turns into Select none');
  await sa.click();
  await page.waitForTimeout(200);
  check(!(await barText()), 'Select none clears them');
  const boxes = page.locator('#discover .want-queue input.pick');
  await boxes.nth(0).click();
  await boxes.nth(2).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(200);
  check(/3 songs selected/.test(await barText()), `shift-click ticks the run between (${await barText()})`);
  await btn('Clear', '.dv-selbar').click();
  // the filter: Select all only takes what's showing
  await page.locator('#discover .dv-filter').fill('Rooftops');
  await page.waitForTimeout(600);
  check((await n('#discover .want-queue:not(.found) .want-row:not(.head)')) === 1, 'the filter narrows the list');
  await page.locator('#discover .pick-all').click();
  await page.waitForTimeout(200);
  check(/1 song selected/.test(await barText()), 'Select all respects the filter');
  await looks('wanted-picked');
  await btn('Mark not available', '.dv-selbar').click();
  await page.waitForTimeout(500);
  await page.locator('#discover .dv-filter').fill('');
  await page.waitForTimeout(600);
  check((await n('#discover .want-queue:not(.found) .want-row:not(.head)')) === 2, 'Mark not available takes it off the list to find');
  check(/1/.test(await page.locator('#discover .dv-tabs button', { hasText: 'Not available' }).textContent()), 'Not available counts it');

  // 4.25: the Not available list: Try again, Remove, Try all again; runs skip these
  await page.locator('#discover .dv-tabs button', { hasText: 'Not available' }).click();
  await page.waitForTimeout(500);
  check((await n('#discover .want-row.u:not(.head)')) === 1, 'Not available lists the song');
  for (const b of ['Try again', 'Try all again', 'Select all (1)']) await has(b, 'Not available');
  check(/tried once/.test(await page.locator('#discover .want-row.u:not(.head)').first().textContent()), 'Not available says how many tries');
  await page.locator('#discover .want-row.u:not(.head)').first().click({ position: { x: 300, y: 12 } });
  await page.waitForTimeout(200);
  for (const b of ['Move back to Wanted', 'Remove']) await has(b, 'the bar on Not available', '.dv-selbar');
  await looks('unavailable');
  await btn('Clear', '.dv-selbar').click();
  await btn('Try again').click();
  await page.waitForTimeout(500);
  check((await n('#discover .want-row.u:not(.head)')) === 0, 'Try again puts it back on the list to find');
  await page.locator('#discover .dv-tabs button', { hasText: 'To find' }).click();
  await page.waitForTimeout(500);
  check((await n('#discover .want-queue:not(.found) .want-row:not(.head)')) === 3, 'the list to find has it back');
  // 4.26: one song marked Not available by hand, and put back
  await page.locator('#discover .want-queue .mark-na').first().click();
  await page.waitForTimeout(500);
  check((await n('#discover .want-queue:not(.found) .want-row:not(.head)')) === 2, 'Not available on a row takes it off the list');
  await page.locator('#discover .dv-tabs button', { hasText: 'Not available' }).click();
  await page.waitForTimeout(500);
  await page.locator('#discover .want-row.u:not(.head)').first().click({ position: { x: 300, y: 12 } });
  await page.waitForTimeout(200);
  await btn('Move back to Wanted', '.dv-selbar').click();
  await page.waitForTimeout(500);
  await page.locator('#discover .dv-tabs button', { hasText: 'To find' }).click();
  await page.waitForTimeout(500);
  check((await n('#discover .want-queue:not(.found) .want-row:not(.head)')) === 3, 'Move back to Wanted puts it back');

  // 4.25: a run: no match → Not available, only official → Official DLC, and a card at the end
  await rx(/^Get songs/).first().click();
  await page.waitForTimeout(700);
  const cur = async () => page.evaluate(() => (window.__dv.wanted.find((w) => w.status === 'wanted' && document.querySelector('#discover .want-row.q.now .t')?.textContent === w.title) || {}).id || '');
  let c1 = await cur();
  check(!!c1, `the run is on a song (${c1})`);
  await page.evaluate((id) => window.__shEmit('finder:event', { type: 'results', verdict: 'none', want: { id } }), c1);
  await page.waitForTimeout(800);
  check(await page.evaluate((id) => window.__dv.wanted.find((w) => w.id === id).status === 'unavailable', c1), 'no match marks it Not available');
  const c2 = await cur();
  check(c2 && c2 !== c1, 'and the run moves on to the next song');
  await page.evaluate((id) => window.__shEmit('finder:event', { type: 'results', verdict: 'some', want: { id } }), c2);
  await page.waitForTimeout(400);
  check((await cur()) === c2, 'some results change nothing');
  await page.evaluate((id) => window.__shEmit('finder:event', { type: 'results', verdict: 'official', want: { id } }), c2);
  await page.waitForTimeout(800);
  check(await page.evaluate((id) => window.__dv.wanted.find((w) => w.id === id).status === 'official', c2), 'only official results mark it Official DLC');
  const c3 = await cur();
  await page.evaluate((id) => window.__shEmit('finder:event', { type: 'results', verdict: 'none', want: { id } }), c3);
  await page.waitForTimeout(900);
  check(await page.locator('#discover .dv-summary').isVisible(), 'the end of a run leaves a card on Wanted');
  const sumText = (await page.locator('#discover .dv-summary').textContent()) || '';
  check(/2\s*Not available/.test(sumText) && /1\s*Official DLC/.test(sumText) && /0\s*Still to find/.test(sumText), `the card counts what happened (${sumText.replace(/\s+/g, ' ').trim()})`);
  const done = await page.evaluate(() => window.__dv.done);
  check(done.length === 1 && done[0].title && /not available/.test(done[0].text), `the finder is told the run is over (${JSON.stringify(done[0] || null)})`);
  check((await n('#discover .dv-tabs .dv-tab-link')) === 1, 'Wanted links to Official DLC for the official one');
  await looks('run-finished');

  // 4.25: Official DLC: never wanted, asked for instead. 4.26: all of it, by artist, one request
  await go('official');
  check(/Get all 6 official songs/.test(await page.locator('#discover .off-contact h2').textContent()), 'Official DLC offers all of them');
  check((await n('#discover .off-request')) === 1 && /Request all official DLC/.test(await page.locator('#discover .off-request').textContent()), 'Official DLC has one Request all');
  check((await n('#discover .off-artist')) === 3 && (await n('#discover .off-song')) === 6, `every official song, under its artist (${await n('#discover .off-artist')} artists, ${await n('#discover .off-song')} songs)`);
  check(!(await n('#discover .off-list input[type=checkbox]')) && !(await n('#discover .pick-all')), 'no tick boxes');
  check(!(await rx(/^Request/, '#discover .off-list').count()) && !(await btn('Want it').count()), 'no request per song');
  check(await page.evaluate(() => { const a = document.querySelector('#discover .off-artist h3'); const t = document.querySelector('#discover .off-song .t'); return !!a && !!t && getComputedStyle(a).textTransform !== getComputedStyle(t).textTransform; }), 'artist headings look different from songs');
  await page.locator('#discover .dv-filter').fill('hit');
  await page.waitForTimeout(500);
  check((await n('#discover .off-song')) === 2, 'Official DLC can be searched');
  await page.locator('#discover .dv-filter').fill('');
  await page.waitForTimeout(500);
  await shot('official');
  await looks('official');
  await page.locator('#discover .off-request').click();
  await page.waitForTimeout(500);
  check(await page.locator('.modal .req-dialog').isVisible(), 'Request opens the request');
  const dlg = (await page.locator('.modal').textContent()) || '';
  check(/How can Noisewater Labs reach you\?/.test(dlg) && /6\s*official songs/.test(dlg) && !/Radio Hit/.test(dlg), 'the request is for all of them (no list) and asks how to reach you');
  check(!/mail app|email client|e-mail client|mailto/i.test(dlg), 'the request never mentions a mail app');
  await looks('request');
  await page.locator('.modal').getByRole('button', { name: 'Send request', exact: true }).click();
  await page.waitForTimeout(300);
  check(/reach you/.test(await page.locator('.modal .req-msg').textContent()) && !(await page.evaluate(() => window.__dv.requests.length)), 'Send needs a way to reach you');
  await page.locator('.modal .req-field input').fill('player@example.com');
  await page.locator('.modal .req-field textarea').fill('Thanks!');
  await page.locator('.modal').getByRole('button', { name: 'Send request', exact: true }).click();
  await page.waitForTimeout(600);
  const reqs = await page.evaluate(() => window.__dv.requests);
  check(reqs.length === 1 && reqs[0].all === true && !reqs[0].songs && reqs[0].contact === 'player@example.com' && reqs[0].note === 'Thanks!', `one request for all of it goes to the main process (${JSON.stringify(reqs[0] || null).slice(0, 160)})`);
  check(!(await n('.modal .req-dialog')), 'the request closes when sent');
  check(/send another/.test(await page.locator('#discover .off-contact p').textContent()) && (await page.locator('#discover .off-request').isDisabled()), 'Official DLC says when the next request can go');
  check(await page.evaluate(() => localStorage.getItem('stagehand.requestContact') === 'player@example.com'), 'how to reach you is remembered');
  // a song added from Search that's official is turned away
  // (the main process refuses it; the page says so with a way to Official DLC)

  // 4.25: Updates: songs you have with a newer version
  await go('updates');
  check((await n('#discover .want-row.up:not(.head)')) === 2, 'Updates lists the songs with newer versions');
  for (const b of ['Check for updates', 'Get updates']) await has(b, 'Updates');
  check(/Updated CDLC list/.test(await page.locator('#discover .dv-note').textContent()), 'Updates says where the list comes from');
  check(/2/.test(await page.locator('#sidebar [data-view="updates"], #sidebar .nav-item', { hasText: 'Updates' }).first().textContent()), 'the menu shows how many updates');
  await looks('updates');
  await btn('Check for updates').click();
  await page.waitForTimeout(300);
  check((await page.evaluate(() => window.__dv.updChecked)) === 1, 'Check for updates opens the updated list in the song finder');
  await btn('Get updates').click();
  await page.waitForTimeout(700);
  check((await n('#discover .want-row.up.now')) === 1, 'Get updates looks for the first one');
  await page.evaluate(() => window.__shEmit('finder:event', { type: 'download', name: 'new_p.psarc', state: 'added', want: { id: 'upd:u1' } }));
  await page.waitForTimeout(800);
  check((await n('#discover .want-row.up:not(.head)')) === 1, 'a song drops off Updates when its new version is added');
  await page.evaluate(() => window.__shEmit('finder:event', { type: 'download', name: 'new2_p.psarc', state: 'had', want: { id: 'upd:u2' } }));
  await page.waitForTimeout(900);
  check(await page.locator('#discover .dv-summary').isVisible() && /2 songs updated/.test(await page.locator('#discover .dv-summary').textContent()), 'Get updates ends with its own card');
  await looks('updates-done');
  await page.evaluate(async () => {
    const { api } = await import('./js/api.js');
    api.discover.wanted = async () => window.__dv.wanted;
  });
  await go('wanted');

  // 4.26: Get in one step: from a search result, from the gaps; the song finder starts straight away
  const runOn = async () => ((await n('#discover .get-run')) ? await page.locator('#discover .get-run b').textContent() : '');
  const stop = async () => {
    if (await n('#discover .get-run')) await btn('Stop', '#discover .get-run').click();
    else if (await btn('Stop').count()) await btn('Stop').first().click();
    await page.waitForTimeout(400);
  };
  await go('search');
  await page.evaluate(async () => (await import('./js/discover.js')).setQuery('Test', { now: true }));
  await page.waitForTimeout(900);
  const finds = await page.evaluate(() => window.__dv.finds.length);
  await page.locator('#discover .dv-row', { hasText: 'Brand New' }).locator('.get-it').click();
  await page.waitForTimeout(900);
  check(await page.evaluate(() => window.__dv.wanted.some((w) => w.title === 'Brand New' && w.status === 'wanted')), 'Get it puts the song on Wanted');
  check(/Brand New/.test(await runOn()), `and the song finder starts on it, no detour (${await runOn()})`);
  check((await page.evaluate(() => window.__dv.finds.length)) > finds, 'the song finder is opened');
  check(/Finding/.test(await page.locator('#discover .dv-row', { hasText: 'Brand New' }).locator('.get-it').textContent()), 'the row says it is being found');
  await has('See the list', 'the getting strip', '#discover .get-run');
  await shot('get-from-search');
  await looks('get-from-search');
  await stop();
  await go('gaps');
  const before = await page.evaluate(() => window.__dv.added.length);
  await btn('Get 6').click();
  await page.waitForTimeout(1000);
  const gs = await page.evaluate(() => window.__dv.gapSongs[window.__dv.gapSongs.length - 1]);
  check(gs && Array.isArray(gs.keys) && gs.keys.join() === 'a', `Get on an artist asks for that artist's missing songs (${JSON.stringify(gs)})`);
  const added = await page.evaluate((b) => window.__dv.added.slice(b), before);
  check(added.length === 6, `the gap's songs go on Wanted (${added.length})`);
  check(/Harbour/.test(await runOn()), `and the song finder starts on the first of them (${await runOn()})`);
  await shot('get-from-gaps');
  await looks('get-from-gaps');
  await go('wanted');
  check((await n('#discover .want-row.q.now')) === 1, 'Wanted shows the run on its song');
  await stop();

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
  await looks('imports');

  // a newer page next to it, to compare
  await page.locator('#sidebar .nav-section[data-page="karaoke"]').click().catch(() => {});
  await page.waitForTimeout(800);
  await shot('compare-karaoke');

  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
