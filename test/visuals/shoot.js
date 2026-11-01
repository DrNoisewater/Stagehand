// Pictures of the moving backgrounds on a made-up song (test/visuals/index.html).
//   node test/visuals/shoot.js <outDir> [scene ...]
// For each scene: three moments full screen (Jam) and one behind the highway,
// plus a contact sheet (sheet.png) of them all. Checks that every scene draws
// something and reacts (the picture changes between moments).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const root = path.join(__dirname, '..', '..');
const out = path.resolve(process.argv[2] || 'visuals-out');
const scenes = process.argv.slice(3).length ? process.argv.slice(3) : ['fluid', 'nebula', 'swarm', 'mandala', 'strings'];
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => /Visualizer:/.test(m.text()) && errors.push(m.text()));
  const shots = [];
  let ok = true;
  for (const scene of scenes) {
    for (const hw of [0, 1]) {
      await page.goto(`http://localhost:${port}/test/visuals/index.html?scene=${scene}&highway=${hw}`);
      await page.waitForFunction(() => window.ready);
      const moments = hw ? [150] : [60, 150, 240];
      let done = 0;
      const sums = [];
      for (const m of moments) {
        let st;
        if (scene === 'fluid') {
          // the fluid runs on its own clock: feed it in real time
          for (let k = done; k < m; k += 4) {
            st = await page.evaluate(() => window.step(4));
            await page.waitForTimeout(40);
          }
        } else st = await page.evaluate((n) => window.step(n), m - done);
        done = m;
        const file = path.join(out, `${scene}${hw ? '-highway' : ''}-${m}.png`);
        await page.screenshot({ path: file });
        shots.push({ file, label: `${scene}${hw ? ' · behind highway' : ''} · ${(m / 60).toFixed(1)} s` });
        const buf = fs.readFileSync(file);
        sums.push(buf.length);
        if (st.failed) {
          ok = false;
          console.log(`FAIL ${scene}: the scene could not draw`);
        }
      }
      if (!hw && new Set(sums).size < 2) {
        ok = false;
        console.log(`FAIL ${scene}: the picture didn't change`);
      }
      console.log(`ok   ${scene}${hw ? ' (highway)' : ''}`);
    }
  }
  // contact sheet
  const sheet = await browser.newPage({ viewport: { width: 1440, height: 100 } });
  const imgs = shots.map((s) => `<figure><img src="data:image/png;base64,${fs.readFileSync(s.file).toString('base64')}"><figcaption>${s.label}</figcaption></figure>`).join('');
  await sheet.setContent(`<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px;font:12px sans-serif;color:#ccc}figure{margin:0}img{width:100%;display:block}</style>${imgs}`);
  await sheet.screenshot({ path: path.join(out, 'sheet.png'), fullPage: true });
  if (errors.length) {
    ok = false;
    console.log('FAIL errors:', errors.slice(0, 5).join(' | '));
  }
  await browser.close();
  server.close();
  console.log(ok ? 'all passed' : 'failed');
  process.exit(ok ? 0 : 1);
})();
