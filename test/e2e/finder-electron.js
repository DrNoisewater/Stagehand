/**
 * 4.12: the song finder in the real app (Electron), on a pretend song site:
 *  - Discover's Find opens it (after a short explanation the first time);
 *  - Find types the wanted song into the site's search box and searches;
 *  - a download (.psarc, and a ZIP) goes straight into the library and the bar says so;
 *  - links to other sites don't open in the window; a .rar goes to Downloads with a note.
 * 4.25, the pretend site now acts like CustomsForge's Ignition: it draws its search box late, shows
 * a table (Artist, Title, Album, Tuning, Creator), an Official DLC row with a cart button, "No matching
 * CDLC", ads, pop-ups, and a My Library › Updated CDLC tab. Checked:
 *  - the late search box is waited for (and typed once); results read: match, some, official, none
 *    (with the one simpler second search), and a second search that finds it;
 *  - pop-ups are dropped, never sent to the browser; a clicked outside link is offered instead;
 *  - ads stopped (by host) and hidden (by their boxes), the song table never;
 *  - the Roadie follows the real state (never In Songs before the import says so), a new download
 *    cuts a celebration short, a failed download shows the still; its frame rate is measured;
 *  - Updated CDLC: opened by its words, its rows read; the run's end closes the window.
 *
 *   ELECTRON=<electron 44> xvfb-run -a -s "-screen 0 4000x2400x24" node test/e2e/finder-electron.js <outDir>
 *   (SCALE=2: the same at 200% display scale, for the pictures)
 */
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { _electron } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const out = process.argv[2] || os.tmpdir();
fs.mkdirSync(out, { recursive: true });
const SCALE = Number(process.env.SCALE) || 1;
let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SONG = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'integration_p.psarc'));
// the pretend site's songs
const SONGS = [
  { artist: 'Integration', title: 'The Test', album: 'Tests', tuning: 'E Standard', creator: 'Tester', dl: '/song_p.psarc' },
  { artist: 'Integration', title: 'Different Song', album: 'Tests', tuning: 'Drop D', creator: 'Tester', dl: '/slow_p.psarc' },
  { artist: 'Integration', title: 'Long Way Home', album: 'Tests', tuning: 'E Standard', creator: 'Tester', dl: '/nolen_p.psarc' },
  { artist: 'Integration', title: 'Broken Link', album: 'Tests', tuning: 'E Standard', creator: 'Tester', dl: '/broken_p.psarc' },
  { artist: 'Queen', title: 'Bohemian Rhapsody', album: 'A Night at the Opera', tuning: 'E Standard', creator: 'Ubisoft', official: true },
  { artist: 'Other Artist', title: 'Nothing Here', album: 'Elsewhere', tuning: 'E Standard', creator: 'Someone', dl: '/song_p.psarc' },
  { artist: 'Integration Xylophone Tribute Band', title: 'Melody', album: 'Covers', tuning: 'E Standard', creator: 'Someone', dl: '/song_p.psarc' },
];
const searches = [];
const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const APP = `<!doctype html><title>Pretend Ignition</title>
<style>body{background:#222;color:#eee;font:15px sans-serif;margin:0} nav a{color:#fc6;margin-right:14px} table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #444;padding:6px;text-align:left}
.badge{background:#c33;color:#fff;font-size:11px;padding:1px 5px;border-radius:3px;margin-left:6px} .badge.official{background:#36c} .tab.active{font-weight:bold;text-decoration:underline}
.adsbygoogle,#ad-slot-top,.advert-box{display:block;background:#f0f;color:#000;height:60px}</style>
<body>
<div id="ad-slot-top">AD: Download Opera now!</div>
<nav><a href="#" class="tab active" id="t-search">Search</a><a href="#" class="tab" id="t-lib">My Library</a><span id="sub" hidden><a href="#" class="tab" id="t-fav">Favorites</a><a href="#" class="tab" id="t-upd">Updated CDLC</a></span></nav>
<h1>Pretend song site</h1>
<div id="boxhere"></div>
<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-1"></ins>
<img id="adpx" src="https://pagead2.googlesyndication.com/pagead/px.gif" width="1" height="1">
<div class="ad-slot-wrap advert-wrap"><table id="songs"><thead><tr><th>Artist</th><th>Title</th><th>Album</th><th>Tuning</th><th>Creator</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
<p id="more"><a class="dl2" href="/nolen_p.psarc">Long Way Home (another server)</a></p>
<p><a class="away" href="https://example.com/">Somewhere else</a> <button id="popad" onclick="window.open('https://ads.example.net/pop','_blank')">Free stuff</button>
<button id="latepop" onclick="setTimeout(() => window.open('https://www.opera.com/download'), 1800)">Later</button>
<button id="redirect" onclick="setTimeout(() => { location.href = 'https://store.steampowered.com/app/1' }, 1800)">Redirect</button></p>
<script>
const esc = (s) => String(s).replace(/[<&"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '"': '&quot;' }[c]));
const row = (s) => '<tr><td>' + esc(s.artist) + '</td><td><a href="#">' + esc(s.title) + '</a></td><td>' + esc(s.album) + (s.official ? '<span class="badge official">Official</span>' : '') + '</td><td>' + esc(s.tuning) + '</td><td>' + esc(s.creator) + '</td><td>' + (s.official ? '<button class="btn-cart">Add to cart</button>' : '<a class="dl" href="' + s.dl + '">Download</a>') + '</td></tr>';
function show(list) { document.getElementById('rows').innerHTML = list.length ? list.map(row).join('') : '<tr><td colspan="6">No matching CDLC</td></tr>'; }
async function search(q) {
  const r = await fetch('/api/search?q=' + encodeURIComponent(q)).then((x) => x.json());
  history.pushState({}, '', '/?q=' + encodeURIComponent(q));
  // the table fills in two goes, the way a slow site does
  document.getElementById('rows').innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  setTimeout(() => show(r), 500);
}
// the search box is drawn late (2.5 s), the way the real site does
setTimeout(() => {
  const i = document.createElement('input');
  i.type = 'search'; i.placeholder = 'Search CDLC'; i.style.width = '320px';
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(i.value); });
  document.getElementById('boxhere').append(i);
}, 2500);
fetch('/api/search?q=').then((x) => x.json()).then(show);
const tabs = (on) => { for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.id === on); };
document.getElementById('t-search').onclick = (e) => { e.preventDefault(); tabs('t-search'); document.getElementById('songs').querySelector('thead').innerHTML = '<tr><th>Artist</th><th>Title</th><th>Album</th><th>Tuning</th><th>Creator</th><th></th></tr>'; fetch('/api/search?q=').then((x) => x.json()).then(show); };
document.getElementById('t-lib').onclick = (e) => { e.preventDefault(); tabs('t-lib'); document.getElementById('sub').hidden = false; };
document.getElementById('t-upd').onclick = (e) => {
  e.preventDefault(); tabs('t-upd');
  setTimeout(() => {
    document.getElementById('songs').querySelector('thead').innerHTML = '<tr><th>Artist</th><th>Title</th><th>Version</th><th>Updated</th><th>Creator</th></tr>';
    document.getElementById('rows').innerHTML = '<tr><td>Integration</td><td><a href="#">The Test</a><span class="badge">Update</span></td><td>v3</td><td>2026-11-01</td><td>Tester</td></tr>'
      + '<tr><td>Other Artist</td><td><a href="#">Lost Song</a> <span class="badge">Update</span></td><td>1.2</td><td>2026-10-20</td><td>Someone</td></tr>';
  }, 400);
};
</script></body>`;

const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const psarc = (name, opts = {}) => {
    const head = { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` };
    if (!opts.nolength) head['Content-Length'] = SONG.length;
    res.writeHead(200, head);
    if (!opts.slow) return res.end(SONG);
    // a slow download: the song in 20 pieces over opts.slow ms (or cut off half way)
    let i = 0;
    const n = 20, size = Math.ceil(SONG.length / n);
    const t = setInterval(() => {
      if (opts.cut && i === n / 2) { clearInterval(t); return res.destroy(); }
      res.write(SONG.subarray(i * size, (i + 1) * size));
      if (++i >= n) { clearInterval(t); res.end(); }
    }, opts.slow / n);
  };
  if (u.pathname === '/song_p.psarc') return psarc('the_test_p.psarc');
  if (u.pathname === '/slow_p.psarc') return psarc('different_song_p.psarc', { slow: 5000 });
  if (u.pathname === '/nolen_p.psarc') return psarc('long_way_p.psarc', { slow: 2500, nolength: true });
  if (u.pathname === '/broken_p.psarc') return psarc('broken_p.psarc', { slow: 1500, cut: true });
  if (u.pathname === '/pack.rar') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="pack.rar"' });
    return res.end('Rar!not really');
  }
  // a file host's page, the way Drive does it: its Download button opens an empty new window and
  // sends that to the file; a big file first shows a "can't scan it" page there with its own button
  if (u.pathname === '/warn') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<!doctype html><title>Can\'t scan this file</title><body><form action="/song_p.psarc"><button id="anyway">Download anyway</button></form></body>');
  }
  if (u.pathname === '/host') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><title>No preview available</title><body style="background:#333;color:#eee">
      <button id="blank" onclick="const w = window.open('', '_blank'); setTimeout(() => { w.location = '/song_p.psarc'; }, 150)">Download</button>
      <button id="big" onclick="const w = window.open('', '_blank'); setTimeout(() => { w.location = '/warn'; }, 150)">Download big</button>
      <button id="adpop" onclick="const w = window.open('', '_blank'); setTimeout(() => { w.location = 'https://ads.example.net/steam-game'; }, 150)">Ad</button></body>`);
  }
  if (u.pathname === '/api/search') {
    const q = u.searchParams.get('q') || '';
    if (q) searches.push(q);
    const ws = words(q);
    const list = q ? SONGS.filter((s) => { const all = words(`${s.artist} ${s.title} ${s.album} ${s.creator}`); return ws.every((w) => all.includes(w)); }) : SONGS.slice(0, 5);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(list));
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(APP);
  }
  res.writeHead(404);
  res.end();
});

(async () => {
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${site.address().port}/`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-finder-'));
  const songsDir = path.join(home, 'Songs');
  const downloads = path.join(home, 'Downloads');
  fs.mkdirSync(songsDir, { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  const app = await _electron.launch({
    executablePath: process.env.ELECTRON,
    args: ['--no-sandbox', ...(SCALE !== 1 ? [`--force-device-scale-factor=${SCALE}`] : []), ROOT],
    env: { ...process.env, STAGEHAND_HOME: home, STAGEHAND_FINDER_URL: base, STAGEHAND_NO_EXTERNAL: '1', STAGEHAND_DOWNLOADS: downloads },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.waitForTimeout(3000);
  await page.evaluate(async (dir) => {
    await window.stagehand.library.addFolder(dir);
    await window.stagehand.imports.configure({ target: dir });
    window.__fev = [];
    window.stagehand.on('finder:event', (e) => window.__fev.push({ ...e, at: Date.now() }));
  }, songsDir);
  const events = (type) => page.evaluate((t) => window.__fev.filter((e) => !t || e.type === t), type);
  const lastResults = async () => (await events('results')).slice(-1)[0];
  const waitFor = async (fn, ms = 15000, step = 200) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await wait(step); } return v; };
  // the finder (main process, tests only), its site and its bar
  const siteJs = (js) => app.evaluate(async (_e, js) => { const f = global.__stagehandFinder; const w = f && f.siteContents(); return w ? w.executeJavaScript(js) : '(no page)'; }, js);
  const barJs = (js) => app.evaluate(async (_e, js) => { const f = global.__stagehandFinder; const w = f && f.barContents(); return w ? w.executeJavaScript(js) : '(no bar)'; }, js);
  const stats = () => app.evaluate(() => global.__stagehandFinder.stats());
  const external = () => app.evaluate(() => global.__stagehandOpenedExternal || []);
  const msg = () => barJs("document.getElementById('msg').textContent");
  const roadie = () => barJs('window.__roadie ? { actual: window.__roadie.actual, visual: window.__roadie.visual, history: window.__roadie.history, celebrating: window.__roadie.celebrating, front: window.__roadie.front.dataset.clip, still: window.__roadie.img.getAttribute("src"), on: !!document.querySelector("#roadie video.on") } : null');
  const finderOpen = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some((w) => !w.isDestroyed() && w.getTitle().startsWith('Find songs')));
  /** A real mouse click (the player's) on something in the site's page. */
  const realClick = (sel) => app.evaluate(async (_e, sel) => {
    const wc = global.__stagehandFinder.siteContents();
    const r = await wc.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!r) return false;
    const z = wc.getZoomFactor();
    const x = Math.round(r.x * z), y = Math.round(r.y * z);
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    return true;
  }, sel);
  const shots = [];
  const shoot = async (name) => {
    const png = await app.evaluate(async () => { const b = global.__stagehandFinder.barContents(); return b ? (await b.capturePage()).toPNG().toString('base64') : null; });
    if (!png) return;
    const file = path.join(out, `bar-${name}@${SCALE}x.png`);
    fs.writeFileSync(file, Buffer.from(png, 'base64'));
    shots.push(file);
  };
  const setWidth = (w) => app.evaluate(({ BaseWindow }, w) => { const win = BaseWindow.getAllWindows().find((x) => x.getTitle().startsWith('Find songs')); if (win) { win.unmaximize(); win.setContentSize(w, 820); } }, w);
  const open = (item) => page.evaluate((item) => window.stagehand.discover.finder(item), item);

  // ---- 1. Discover's Find opens it; the late search box is waited for and typed into once
  await page.evaluate(() => { const m = import('./js/discover.js').then((d) => d.findOnCF({ id: 'w1', artist: 'Integration', title: 'The Test' })); window.__findDone = m; });
  const dlg = page.locator('.modal[aria-label="Finding songs on CustomsForge"]');
  const asked = await dlg.locator('button.primary').waitFor({ timeout: 10000 }).then(() => true, () => false);
  if (asked) {
    check(/song finder/i.test(await dlg.textContent()), 'the first Find explains the song finder');
    await dlg.locator('button.primary').click();
  }
  await page.evaluate(() => window.__findDone);
  check(await finderOpen(), 'Discover’s Find opens the song finder');
  await setWidth(1280);
  await waitFor(async () => /^(searching)$/.test(((await roadie()) || {}).actual), 4000, 100);
  await shoot('searching');
  const first = await waitFor(() => lastResults(), 25000);
  check(searches.filter((q) => q === 'Integration The Test').length === 1, `the search box drawn 2.5 s late was waited for, and the song typed once (site saw ${JSON.stringify(searches)})`);
  check(!/No search box/.test(await msg()), `no “no search box” warning (“${await msg()}”)`);
  check((await events('searched')).some((e) => e.text === 'Integration The Test'), 'a “searched” event went to the page');
  check(first && first.verdict === 'match' && first.rows.some((r) => r.title === 'The Test' && r.artist === 'Integration'), `the results were read: ${first && first.verdict} (${JSON.stringify(first && first.rows)})`);
  const song = await barJs("document.getElementById('song').textContent");
  check(/Integration – The Test/.test(song), `the bar shows the wanted song (“${song}”)`);
  check(/Found/.test(await msg()), `the bar says it found it (“${await msg()}”)`);
  check(((await roadie()) || {}).actual === 'found', `the Roadie holds up the record (found: ${JSON.stringify(((await roadie()) || {}).actual)})`);
  await wait(1800);
  await shoot('found');

  // ---- 2. ads: stopped by host, their boxes hidden, the song table never
  const look = await siteJs(`(() => { const d = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'missing'; }; return { ins: d('ins.adsbygoogle'), top: d('#ad-slot-top'), table: d('#songs'), wrap: d('.ad-slot-wrap'), box: d('input[type=search]'), nav: d('nav') }; })()`);
  check(look.ins === 'none' && look.top === 'none', `ad boxes are hidden (${JSON.stringify(look)})`);
  check(look.table !== 'none' && look.wrap !== 'none' && look.box !== 'none' && look.nav !== 'none', 'the song table (even inside an “ad-slot” box), the search box and the menu stay');
  const st0 = await stats();
  check(st0.ads['pagead2.googlesyndication.com'] >= 1, `an ad host's request was stopped (${JSON.stringify(st0.ads)})`);

  // ---- 3. pop-ups and links to other sites
  const winsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await realClick('#popad');
  await wait(1200);
  await siteJs("document.getElementById('latepop').click(); 1");
  await wait(2600);
  const winsAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length);
  const blockedEv = (await events('blocked')).map((e) => e.host);
  check(winsAfter === winsBefore, `pop-ups open no window (${winsBefore} → ${winsAfter})`);
  check(blockedEv.includes('ads.example.net'), `a clicked pop-up to an ad site is dropped and noted (${JSON.stringify(blockedEv)})`);
  check(blockedEv.includes('www.opera.com') || !(await external()).length, `a pop-up nobody clicked is dropped (${JSON.stringify(blockedEv)})`);
  check(!(await external()).length, `nothing was sent to the player's browser (${JSON.stringify(await external())})`);
  // a hidden pop-up window that ends up on an ad page closes unseen
  // (on the file host page, below)
  // a link the player clicks: offered, not opened
  await realClick('a.away');
  const offered = await waitFor(async () => (await barJs("!document.getElementById('offer').hidden && document.getElementById('offerHost').textContent")) || null, 4000);
  check(offered === 'example.com', `a clicked link to another site is offered as “Open in my browser” (${offered})`);
  check(!(await external()).length && !String(await siteJs('location.href')).includes('example.com'), 'and isn’t opened, in the window or the browser, by itself');
  await shoot('offer');
  await barJs("document.getElementById('offerBtn').click(); 1");
  await wait(500);
  check((await external()).some((u) => u.includes('example.com')), `pressing it opens it in the browser (${JSON.stringify(await external())})`);
  await realClick('a.away');
  await waitFor(async () => (await barJs("!document.getElementById('offer').hidden")) === true, 3000);
  await siteJs("document.getElementById('redirect').click(); 1");
  await wait(2600);
  check((await events('blocked')).map((e) => e.host).includes('store.steampowered.com'), `a page that moves itself to another site is stopped (${JSON.stringify((await events('blocked')).map((e) => e.host))})`);
  check((await external()).length === 1 && !String(await siteJs('location.href')).includes('steampowered'), 'and isn’t offered or opened');

  // ---- 4. results: some, official, none (after one simpler search), a second search that finds it
  const verdictFor = async (item) => {
    const n = (await events('results')).length;
    await open(item);
    return waitFor(async () => { const r = await events('results'); return r.length > n ? r[r.length - 1] : null; }, 30000);
  };
  const before = searches.length;
  let v = await verdictFor({ id: 'w2', artist: 'Integration', title: 'Xylophone' });
  check(v && v.verdict === 'some', `the artist's other songs, not this one: “some” (${v && v.verdict})`);
  check(!(await barJs("!document.getElementById('offer').hidden")), 'a new page clears the “Open in my browser” offer');
  v = await verdictFor({ id: 'w3', artist: 'Queen', title: 'Bohemian Rhapsody' });
  check(v && v.verdict === 'official' && v.rows.some((r) => r.official), `only an official copy (badge, Ubisoft, a cart): “official” (${JSON.stringify(v)})`);
  check(/official DLC/.test(await msg()), `the bar says so (“${await msg()}”)`);
  await shoot('official');
  v = await verdictFor({ id: 'w4', artist: 'Ghost Band', title: 'Nothing Here (Live)' });
  const tried = searches.slice(before);
  check(v && v.verdict === 'none', `nothing: “none” (${v && v.verdict})`);
  check(tried.includes('Ghost Band Nothing Here (Live)') && tried.includes('Nothing Here'), `after one simpler second search, the title alone (${JSON.stringify(tried)})`);
  check(/Not on CustomsForge/.test(await msg()), `the bar says “Not on CustomsForge” (“${await msg()}”)`);
  const rn = await roadie();
  check(rn && rn.actual === 'failed' && /keyframe-15/.test(rn.still) && !rn.on, `the Roadie shows the still picture (${rn && rn.actual}, ${rn && rn.still})`);
  await shoot('none');
  v = await verdictFor({ id: 'w5', artist: 'Integration', title: 'The Test - Remastered 2011' });
  check(v && v.verdict === 'match' && searches.includes('The Test'), `a title with extras is found by the second search (${v && v.verdict}; ${JSON.stringify(searches.slice(-2))})`);

  // ---- 5. the Roadie follows real downloads
  v = await verdictFor({ id: 'w6', artist: 'Integration', title: 'Different Song' });
  check(v && v.verdict === 'match', `found the next song (${v && v.verdict})`);
  // the frame rate the bar really shows (a hold, looping)
  await wait(2500);
  await barJs('window.__roadie.resetStats(); 1');
  await wait(4000);
  const fps = await barJs('window.__roadie.stats()');
  console.log(`info the Roadie in the bar: ${fps.frames} frames in ${fps.seconds} s = ${fps.fps} frames a second (dropped ${fps.dropped} of ${fps.total}); ${JSON.stringify(fps.clips)}`);
  check(fps.frames > 0, 'the Roadie’s clips play in the bar');
  await realClick('a.dl[href="/slow_p.psarc"]');
  let pctSeen = '';
  const wasDownloading = await waitFor(async () => (((await roadie()) || {}).actual === 'downloading'), 5000, 100);
  check(wasDownloading, 'the Roadie goes to downloading as the download starts');
  for (let i = 0; i < 40 && !/%/.test(pctSeen); i++) { await wait(150); pctSeen = await msg(); }
  check(/Downloading different_song_p\.psarc \d+%/.test(pctSeen), `the words give the real progress (“${pctSeen}”)`);
  await wait(1500);
  await shoot('downloading');
  const imp = await waitFor(async () => { const r = await roadie(); return r && (r.actual === 'importing' || r.actual === 'imported') ? r.actual : null; }, 15000, 40);
  if (imp === 'importing') await shoot('importing');
  check(!!imp, `then importing (${imp})`);
  const doneR = await waitFor(async () => (((await roadie()) || {}).actual === 'imported'), 15000, 100);
  check(doneR && /in your library|already have/.test(await msg()), `In Songs once the library says so (“${await msg()}”)`);
  await wait(1200);
  await shoot('success');
  let h = (await roadie()).history;
  const at = (kind, what) => h.findIndex((x) => x.kind === kind && x.what === what);
  check(at('clip', 'success') > at('actual', 'imported') && at('actual', 'imported') > -1, `never In Songs before the import’s answer (actual imported at #${at('actual', 'imported')}, success clip at #${at('clip', 'success')})`);
  const dlEv = (await events('download')).filter((e) => e.name === 'different_song_p.psarc');
  check(dlEv.length && dlEv.every((e) => e.job === dlEv[0].job) && /^d\d+$/.test(dlEv[0].job), `the download's events carry its job id (${dlEv[0] && dlEv[0].job}, ${[...new Set(dlEv.map((e) => e.state))].join(' › ')})`);
  check(h.some((x) => x.kind === 'clip' && x.what === 'download-enter') && h.some((x) => x.kind === 'clip' && x.what === 'import-enter'), 'the download and import clips played');
  // a new download (unknown size) within a second of the success: the celebration is cut short
  await realClick('a.dl2');
  let noPct = '';
  const cut = await waitFor(async () => { const r = await roadie(); const m = await msg(); if (/Downloading long_way/.test(m)) noPct = m; return r && r.actual === 'downloading' && r.visual === 'downloading' && r.front === 'download-enter' ? r : null; }, 4000, 50);
  h = cut ? cut.history : (await roadie()).history;
  const sIdx = h.map((x) => x.kind === 'clip' && x.what === 'success').lastIndexOf(true);
  const eIdx = h.findIndex((x, i) => i > sIdx && x.kind === 'clip' && x.what === 'download-enter');
  const holdIdx = h.findIndex((x, i) => i > sIdx && x.kind === 'clip' && x.what === 'success-hold');
  check(!!cut && sIdx > -1 && eIdx > sIdx && (holdIdx < 0 || holdIdx > eIdx), `a new download cuts the celebration short (success at #${sIdx}, download-enter at #${eIdx})`);
  check(/Downloading long_way_p\.psarc…/.test(noPct) && !/%/.test(noPct), `unknown size: no made-up percentage (“${noPct}”)`);
  await waitFor(async () => (((await roadie()) || {}).actual === 'imported'), 15000, 100);
  // a download that breaks off
  v = await verdictFor({ id: 'w8', artist: 'Integration', title: 'Broken Link' });
  await realClick('a.dl[href="/broken_p.psarc"]');
  const failed = await waitFor(async () => { const r = await roadie(); return r && r.actual === 'failed' ? r : null; }, 15000, 100);
  check(failed && /keyframe-15/.test(failed.still) && !failed.on && /didn’t finish/.test(await msg()), `a broken download: the still and the reason (“${await msg()}”)`);
  check(failed && !failed.history.slice(-6).some((x) => x.kind === 'clip' && /success/.test(x.what)), 'and no celebration');
  await shoot('failed');
  // the same callbacks twice change nothing
  const hl = (await roadie()).history.length;
  await barJs('(() => { const r = window.__roadie; r.set({ state: "imported", job: "d1", seq: 1 }); r.set({ state: r.actual, job: r.job, seq: r.seq + 1 }); return 1; })()');
  await wait(300);
  const after = await roadie();
  check(after.actual === 'failed' && after.history.length - hl <= 0, `old and repeated news is ignored (${after.actual}, ${after.history.length - hl} new entries)`);

  // ---- 6. the file sites (4.18), and an ad in a hidden pop-up window
  const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.getTitle() !== 'Stagehand').map((w) => ({ title: w.getTitle(), shown: w.isVisible(), url: w.webContents.getURL() })));
  const sayAfter = async (re) => { let t = ''; for (let i = 0; i < 60 && !re.test(t); i++) { await wait(250); t = await msg(); } return t; };
  await siteJs(`(() => { const a = document.createElement('a'); a.href = '/pack.rar'; document.body.append(a); a.click(); return 1; })()`);
  let said = await sayAfter(/Downloads/);
  check(/Downloads/.test(said) && fs.existsSync(path.join(downloads, 'pack.rar')), `a file Stagehand can't open goes to Downloads with a note (“${said}”)`);
  const lib = await page.evaluate(async () => { const r = await window.stagehand.library.get(); const v = r.value || r; return Object.values(v.songs || {}).map((s) => s.title); });
  check(lib.some((t) => /test/i.test(t)), `the library has the song (${lib.join(', ')})`);
  check(fs.readdirSync(songsDir).some((n) => /\.psarc$/i.test(n)), 'the file is in your songs folder');
  await siteJs("location.href = '/host'; 1");
  await wait(1000);
  await siteJs("document.getElementById('adpop').click(); 1");
  await wait(2500);
  let left = (await windows()).filter((w) => w.shown && !/Find songs/.test(w.title));
  check(!left.length && (await events('blocked')).some((e) => e.host === 'ads.example.net'), `a hidden download window sent to an ad closes unseen (${JSON.stringify(left)})`);
  await siteJs("document.getElementById('blank').click(); 1");
  said = await sayAfter(/already have|in your library|couldn/);
  check(/already have|in your library/.test(said), `a download a file host starts in a new, empty window is taken (“${said}”)`);
  await wait(600);
  left = (await windows()).filter((w) => w.shown && !/Find songs/.test(w.title));
  check(!left.length, `no empty window is left behind (${JSON.stringify(left)})`);
  check(!String(await siteJs('location.href')).includes('/host'), 'the finder is back on the song site, not stranded on the file host');
  await siteJs("location.href = '/host'; 1");
  await wait(1000);
  await siteJs("document.getElementById('big').click(); 1");
  let warnW = null;
  for (let i = 0; i < 40 && !warnW; i++) { await wait(250); warnW = (await windows()).find((w) => w.url.includes('/warn') && w.shown); }
  check(!!warnW, 'a file host\'s second page (“can\'t scan this file”) opens in its own window');
  await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/warn')); if (w) await w.webContents.executeJavaScript("document.getElementById('anyway').click(); 1"); });
  said = await sayAfter(/already have|in your library|couldn/);
  check(/already have|in your library/.test(said), `its Download anyway button brings the song in (“${said}”)`);
  await wait(800);
  left = (await windows()).filter((w) => w.shown && !/Find songs/.test(w.title));
  check(!left.length, `that window closes by itself (${JSON.stringify(left)})`);

  // ---- 7. Updated CDLC: opened by its words (inside My Library), its rows read
  const nUpd = (await events('updates')).length;
  await page.evaluate(() => window.stagehand.discover.finderUpdates());
  const upd = await waitFor(async () => { const u = await events('updates'); return u.length > nUpd ? u[u.length - 1] : null; }, 25000);
  check(upd && upd.rows.length === 2, `the Updated CDLC list is opened and read (${JSON.stringify(upd && upd.rows)})`);
  check(upd && upd.rows[0].title === 'The Test' && upd.rows[0].version === 'v3' && upd.rows[0].updated === '2026-11-01', 'its artist, title (without the Update badge), version and date');
  const kept = await page.evaluate(() => (window.stagehand.discover.updates ? window.stagehand.discover.updates().catch((e) => `(${e.message})`) : '(none)'));
  console.log(`info Discover kept: ${JSON.stringify(kept).slice(0, 300)}`);
  await shoot('updates');

  // ---- 8. the run's end: the bar says so, the window closes about 3.5 s later (not if a new song opens)
  await page.evaluate(() => window.stagehand.discover.finderDone({ title: 'All done.', text: '2 songs went into your library.' }));
  await wait(400);
  check(/All done\. 2 songs/.test(await msg()), `the bar shows the run's end (“${await msg()}”)`);
  check(((await roadie()) || {}).actual === 'imported', `the Roadie celebrates (songs went in: ${((await roadie()) || {}).actual})`);
  await shoot('done');
  await wait(800);
  await open({ id: 'w9', artist: 'Integration', title: 'The Test' });
  await wait(4500);
  check(await finderOpen(), 'a new song opened meanwhile keeps the window');
  await page.evaluate(() => window.stagehand.discover.finderDone({ title: 'All done.', text: 'Nothing more to find.' }));
  const t0 = Date.now();
  await waitFor(async () => !(await finderOpen()), 8000, 100);
  const took = Date.now() - t0;
  check(!(await finderOpen()) && took >= 3000 && took < 6000, `then it closes by itself (${took} ms)`);
  const front = await app.evaluate(({ BrowserWindow }) => { const f = BrowserWindow.getFocusedWindow(); const all = BrowserWindow.getAllWindows(); return { focused: f ? f.getTitle() : null, visible: all.filter((w) => w.isVisible()).map((w) => w.getTitle()) }; });
  console.log(`info after closing: ${JSON.stringify(front)}`);
  check(front.visible.includes('Stagehand'), 'Stagehand’s own window is up again');
  check((await events('closed')).length >= 1, 'the page heard the finder closed');

  // ---- 9. the pictures at two widths (the bar is told each state directly), and a narrow window
  const nRes = (await events('results')).length;
  await open({ id: 'w10', artist: 'Integration', title: 'The Test' });
  await waitFor(async () => (await events('results')).length > nRes, 30000); // (the real search done: only the pictures' states from here)
  await wait(500);
  const views = { idle: 'idle', searching: 'searching', found: 'found', downloading: 'downloading', importing: 'importing', imported: 'imported', failed: 'failed' };
  let seq = 1e6;
  for (const w of [1920, 1280, 940]) {
    await setWidth(w);
    for (const s of Object.keys(views)) {
      const dl = s === 'downloading' ? [{ job: 'dX', name: 'some_song_p.psarc', pct: 42, known: true, state: 'going' }] : s === 'importing' ? [{ job: 'dX', name: 'some_song_p.psarc', pct: 100, known: true, state: 'adding' }] : [];
      const message = { idle: 'Sign in to CustomsForge here once.', searching: 'Searched for “Integration The Test”. Pick the song and press its download button.', found: 'Found “The Test”. Press its download button.', importing: 'Importing some_song_p.psarc: checking it and adding it to your library…', imported: 'some_song_p.psarc is in your library.', failed: 'Not on CustomsForge: nothing for “Nothing Here”.' }[s] || '';
      const kind = { found: 'good', imported: 'good', failed: 'warn' }[s] || '';
      await app.evaluate((_e, a) => global.__stagehandFinder.barContents().send('finder-bar:state', a), { want: { artist: 'Integration', title: 'The Test', left: 4 }, message, kind, canBack: true, canForward: false, downloads: dl, focus: 'dX', view: { state: views[s], job: `g${seq}`, seq: ++seq }, offer: null, done: null, zoom: 0.8 });
      await wait(s === 'imported' ? 2600 : 1600);
      await shoot(`${w}-${s}`);
    }
  }
  const fits = await barJs("(() => { const r = [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect()); return { buttons: r.length, inside: r.every((x) => x.right <= innerWidth + 0.5 && x.left >= 0), roadie: getComputedStyle(document.getElementById('roadie')).display }; })()");
  check(fits.inside, `at 940 wide every button is still on the bar (${JSON.stringify(fits)})`);
  await setWidth(1280);

  console.log(`info pictures: ${shots.length} in ${out}`);
  await app.close();
  site.close();
  fs.rmSync(home, { recursive: true, force: true });
  console.log(bad ? 'some failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
