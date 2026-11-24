// Renders the Highway 2035 mockup frame by frame in Chromium and encodes MP4s with ffmpeg.
//
//   node test/visuals/highway-2035/render.js <outDir> [chrome neon studio]
//
// Environment:
//   STILLS=1.2,3.4   only write PNG stills at these times (seconds into the clip), no video
//   DUR=9.4 FPS=30   clip length and frame rate
//   SS=2 MSAA=0      supersampling (SS x SS rendered pixels per shown pixel) and multisampling
//   CHART=<file.json> T0=<s>   a chart in the app's format (notes, chordEvents, anchors, beats, chords) and where to start
//   PORT=8790        local server port
// Time is set from here for every frame, so the result does not depend on how fast the machine is.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const HERE = __dirname;
const APP = path.join(HERE, '..', '..', '..', 'src', 'renderer');
const PORT = Number(process.env.PORT || 8790);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.json': 'application/json' };

const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f;
  if (u === '/' || u === '/index.html') f = path.join(HERE, 'index.html');
  else if (u === '/chart.json' && process.env.CHART) f = process.env.CHART;
  else if (u.startsWith('/app/')) f = path.join(APP, u.slice(5));
  else f = path.join(HERE, path.basename(u));
  fs.readFile(f, (e, d) => {
    if (e) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('usage: render.js <outDir> [styles…]');
  fs.mkdirSync(out, { recursive: true });
  const styles = process.argv.slice(3).length ? process.argv.slice(3) : ['chrome', 'neon', 'studio'];
  const FPS = Number(process.env.FPS || 30);
  const DUR = Number(process.env.DUR || 9.4);
  const stills = process.env.STILLS ? process.env.STILLS.split(',').map(Number) : null;
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const style of styles) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('PAGEERR', e.message));
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('CONSOLE', m.text().slice(0, 300)));
    const q = new URLSearchParams({ style, ss: process.env.SS || '2', msaa: process.env.MSAA || '0', t0: process.env.T0 || '0' });
    if (process.env.CHART) q.set('chart', '/chart.json');
    if (process.env.CAM) q.set('cam', process.env.CAM);
    await page.goto(`http://localhost:${PORT}/?${q}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
    const grab = async (t) => {
      const url = await page.evaluate((t) => {
        window.renderAt(t);
        return document.querySelector('canvas').toDataURL('image/png');
      }, t);
      return Buffer.from(url.split(',')[1], 'base64');
    };
    if (stills) {
      for (const t of stills) {
        const t0 = Date.now();
        const png = await grab(t);
        const file = path.join(out, `${style}-${t.toFixed(2)}.png`);
        fs.writeFileSync(file, png);
        console.log('still', file, `${Date.now() - t0} ms`);
      }
    } else {
      const mp4 = path.join(out, `highway-2035-${style}.mp4`);
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
      const frames = Math.round(DUR * FPS);
      const started = Date.now();
      for (let i = 0; i < frames; i++) {
        const png = await grab(i / FPS);
        if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
        if (i % 30 === 0) console.log(style, `frame ${i}/${frames}`, `${((Date.now() - started) / (i + 1) / 1000).toFixed(2)} s/frame`);
      }
      ff.stdin.end();
      await new Promise((r) => ff.on('close', r));
      console.log('video', mp4);
    }
    await page.close();
  }
  await browser.close();
  srv.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
