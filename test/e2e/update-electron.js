/**
 * The real app in Electron (4.1.4): updating from inside Stagehand. A pretend GitHub
 * says 9.9.9 is out; the menu shows "Update to 9.9.9" (and a note once); the update
 * window says what's new; Update now downloads the Setup (checked), starts it with
 * /update (recorded here instead of run) and Stagehand closes so Setup can update it.
 *
 *   ELECTRON=<path to electron> xvfb-run -a node test/e2e/update-electron.js <outDir>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { _electron } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'sh-update-out-'));
fs.mkdirSync(outDir, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-update-home-'));
const results = [];
const check = (ok, msg) => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

(async () => {
  const setup = crypto.randomBytes(2 * 1024 * 1024);
  const server = http.createServer((req, res) => {
    if (req.url === '/repos/DrNoisewater/Stagehand/releases/latest') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://example.invalid/release', body: "## What's Changed\n* Stagehand 9.9.9: a pretend update for the test by @x in https://x/1", assets: [{ name: 'Stagehand-Setup-9.9.9.exe', size: setup.length, digest: `sha256:${crypto.createHash('sha256').update(setup).digest('hex')}`, browser_download_url: `http://127.0.0.1:${server.address().port}/dl/Stagehand-Setup-9.9.9.exe` }] }));
    }
    if (req.url.startsWith('/dl/')) {
      res.setHeader('Content-Length', setup.length);
      // a little at a time, so the progress shows
      let o = 0;
      const tick = () => {
        if (o >= setup.length) return res.end();
        res.write(setup.subarray(o, (o += 256 * 1024)));
        setTimeout(tick, 60);
      };
      return tick();
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const mark = path.join(home, 'setup-ran.json');
  const app = await _electron.launch({
    executablePath: process.env.ELECTRON,
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, STAGEHAND_HOME: path.join(home, 'sh'), STAGEHAND_NO_EXTERNAL: '1', STAGEHAND_UPDATES_API: `http://127.0.0.1:${server.address().port}`, STAGEHAND_UPDATES_MARK: mark },
  });
  const proc = app.process();
  let exited = false;
  proc.on('exit', () => (exited = true));
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await page.waitForFunction(() => window.stagehand && document.querySelector('#app'), null, { timeout: 30000 });
  // Getting started offers itself on a fresh install: close it
  await page.waitForSelector('.gs', { timeout: 8000 }).then(() => page.click('.modal footer .btn.ghost')).catch(() => {});
  const btn = await page.waitForSelector('.nav-update', { timeout: 20000 }).catch(() => null);
  check(btn && /Update to 9\.9\.9/.test(await btn.textContent()), 'the menu shows “Update to 9.9.9” at the top');
  check((await page.locator('.toast:has-text("Stagehand 9.9.9 is out")').count()) === 1, 'and a note says it’s out');
  await page.screenshot({ path: path.join(outDir, 'up-1-menu.png') });
  await page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
  await page.click('.nav-update');
  await page.waitForSelector('.up-body');
  await page.waitForTimeout(500); // the window fades in
  const txt = await page.locator('.modal').last().textContent();
  check(/Stagehand 9\.9\.9 is ready/.test(txt) && /a pretend update for the test/.test(txt) && /You have 4\./.test(txt), 'the update window says what’s new and which version you have');
  await page.screenshot({ path: path.join(outDir, 'up-2-window.png') });
  await page.click('.modal footer .btn.primary');
  const bar = await page.waitForSelector('.up-bar', { timeout: 5000 }).then(() => true, () => false);
  await page.screenshot({ path: path.join(outDir, 'up-3-downloading.png') }).catch(() => {});
  check(bar, 'downloading shows a progress bar');
  for (let i = 0; i < 100 && !fs.existsSync(mark); i++) await new Promise((r) => setTimeout(r, 100));
  const ran = fs.existsSync(mark) ? JSON.parse(fs.readFileSync(mark, 'utf8')) : null;
  check(ran && ran.args.join(' ') === '/update' && /Stagehand-Setup-9\.9\.9\.exe$/.test(ran.file), `the checked Setup is started with /update (${ran && path.basename(ran.file)})`);
  check(ran && fs.readFileSync(ran.file).equals(setup), 'the downloaded Setup is whole');
  for (let i = 0; i < 50 && !exited; i++) await new Promise((r) => setTimeout(r, 100));
  check(exited, 'Stagehand closes so Setup can update it (Setup opens the new one)');
  await app.close().catch(() => {});
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
  console.log(results.every(Boolean) ? 'all passed' : 'some failed');
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.error('FAIL', e.stack || e.message);
  process.exit(1);
});
