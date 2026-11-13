/**
 * 4.12: the song finder in the real app (Electron), on a pretend song site:
 *  - Discover's Find opens it (after a short explanation the first time);
 *  - Find types the wanted song into the site's search box and searches;
 *  - a download (.psarc, and a ZIP) goes straight into the library and the bar says so;
 *  - links to other sites don't open in the window; a .rar goes to Downloads with a note.
 *
 *   ELECTRON=<electron 44> xvfb-run -a node test/e2e/finder-electron.js <outDir>
 */
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { _electron } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const out = process.argv[2] || os.tmpdir();
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SONG = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'integration_p.psarc'));
const searches = [];
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/song_p.psarc') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="the_test_p.psarc"', 'Content-Length': SONG.length });
    return res.end(SONG);
  }
  if (u.pathname === '/pack.rar') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="pack.rar"' });
    return res.end('Rar!not really');
  }
  if (u.pathname === '/search') searches.push(u.searchParams.get('q'));
  res.writeHead(200, { 'Content-Type': 'text/html' });
  const q = u.searchParams.get('q');
  res.end(`<!doctype html><title>Pretend songs</title><body style="background:#222;color:#eee;font:16px sans-serif">
    <h1>Pretend song site</h1>
    <form action="/search"><input name="q" type="search" placeholder="Search" value=""></form>
    ${q ? `<p id="results">Results for <b>${q.replace(/</g, '')}</b>: <a class="dl" href="/song_p.psarc">Download</a> <a class="rar" href="/pack.rar">Download pack</a></p>` : ''}
    <p><a class="away" href="https://example.com/">Somewhere else</a></p></body>`);
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
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, STAGEHAND_HOME: home, STAGEHAND_FINDER_URL: base, STAGEHAND_NO_EXTERNAL: '1', STAGEHAND_DOWNLOADS: downloads },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.waitForTimeout(3000);
  await page.evaluate(async (dir) => {
    await window.stagehand.library.addFolder(dir);
    await window.stagehand.imports.configure({ target: dir });
  }, songsDir);
  // Discover's Find opens the finder (the first time explains it: say yes)
  await page.evaluate(() => { const m = import('./js/discover.js').then((d) => d.findOnCF({ id: 'w1', artist: 'Integration', title: 'The Test' })); window.__findDone = m; });
  const dlg = page.locator('.modal[aria-label="Finding songs on CustomsForge"]');
  await dlg.locator('button.primary').waitFor({ timeout: 10000 });
  check(/song finder/i.test(await dlg.textContent()), 'the first Find explains the song finder');
  await dlg.locator('button.primary').click();
  await page.evaluate(() => window.__findDone);
  const r = { ok: await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some((w) => w.getTitle().startsWith('Find songs'))) };
  check(r.ok, 'Discover’s Find opens the song finder');
  // the site's page and the bar, from the main process
  const contents = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => ({ id: w.id, url: w.getURL() })));
  const run = (match, js) => app.evaluate(async ({ webContents }, [match, js]) => {
    const w = webContents.getAllWebContents().find((x) => x.getURL().includes(match));
    return w ? w.executeJavaScript(js) : '(no page)';
  }, [match, js]);
  let found = null;
  for (let i = 0; i < 40 && !found; i++) {
    await wait(250);
    found = (await contents()).find((c) => c.url.includes('/search?q='));
  }
  check(!!found && searches.includes('Integration The Test'), `Find typed the song into the search box and searched (${found && found.url}; site saw ${JSON.stringify(searches)})`);
  const msg = () => run('bar.html', "document.getElementById('msg').textContent");
  const song = await run('bar.html', "document.getElementById('song').textContent");
  check(/Integration – The Test/.test(song), `the bar shows the wanted song (“${song}”)`);
  check(/Searched for/.test(await msg()), `the bar says it searched (“${await msg()}”)`);
  // a link to another site stays out of the window
  await run('/search', "document.querySelector('a.away').click(); 1");
  await wait(800);
  check((await contents()).some((c) => c.url.includes('/search?q=')) && !(await contents()).some((c) => c.url.includes('example.com')), 'a link to another site doesn’t open in the finder');
  // download the song: into the library
  await run('/search', "document.querySelector('a.dl').click(); 1");
  let said = '';
  for (let i = 0; i < 60 && !/in your library|already have/.test(said); i++) {
    await wait(250);
    said = await msg();
  }
  check(/in your library/.test(said), `a downloaded song goes into the library (“${said}”)`);
  const lib = await page.evaluate(async () => { const r = await window.stagehand.library.get(); const v = r.value || r; return Object.values(v.songs || {}).map((s) => s.title); });
  check(lib.some((t) => /test/i.test(t)), `the library has it (${lib.join(', ')})`);
  const inSongs = fs.readdirSync(songsDir);
  check(inSongs.some((n) => /\.psarc$/i.test(n)), `the file is in your songs folder (${inSongs.join(', ')})`);
  // a .rar: Downloads, with a note
  await run('/search', "document.querySelector('a.rar').click(); 1");
  for (let i = 0; i < 40 && !/Downloads/.test(said); i++) {
    await wait(250);
    said = await msg();
  }
  check(/Downloads/.test(said) && fs.existsSync(path.join(downloads, 'pack.rar')), `a file Stagehand can't open goes to Downloads with a note (“${said}”)`);
  const shot = await app.evaluate(async ({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows().find((x) => x.getTitle().startsWith('Find songs'));
    if (!w) return null;
    const views = w.contentView.children;
    const imgs = [];
    for (const v of views) imgs.push({ y: v.getBounds().y, png: (await v.webContents.capturePage()).toPNG().toString('base64') });
    return imgs;
  });
  if (shot) shot.forEach((s, i) => fs.writeFileSync(path.join(out, `finder-${s.y ? 'site' : 'bar'}.png`), Buffer.from(s.png, 'base64')));
  check(!!shot && shot.length === 2, 'the finder window has its bar and the site');
  await app.close();
  site.close();
  fs.rmSync(home, { recursive: true, force: true });
  console.log(bad ? 'some failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
