/** Checks the stem codecs in Chromium: FLAC round trip is exact, Opus decodes in time and close. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>t</title>');
  fs.readFile(path.join(ROOT, u), (err, d) => (err ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': 'text/javascript' }).end(d)));
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (m) => console.log('page:', m.text()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const out = await page.evaluate(async () => {
    const c = await import('/src/renderer/js/codec.js');
    const rate = 44100;
    const n = rate * 6 + 123;
    const l = new Int16Array(n);
    const r = new Int16Array(n);
    let s = 1;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const noise = ((s / 0x7fffffff) * 2 - 1) * 0.05;
      l[i] = Math.round(32767 * (0.4 * Math.sin((2 * Math.PI * 220 * i) / rate) + noise) * (i < rate * 2 ? 1 : 0.5));
      r[i] = Math.round(32767 * (0.3 * Math.sin((2 * Math.PI * 330 * i) / rate) + noise * 0.5));
    }
    l[rate * 3] = 32000; // a click for timing
    const res = {};
    const t0 = performance.now();
    const flac = c.encodeFlac(l, r, rate);
    res.flacMs = Math.round(performance.now() - t0);
    res.flacRatio = flac.length / (n * 4);
    const d = await c.decodeTo(flac.buffer.slice(0), rate, n);
    // compare with the same samples decoded from a plain WAV (same decoder, same scaling)
    const W = c.wavFrom(Float32Array.from(l, (x) => x / 32767), Float32Array.from(r, (x) => x / 32767), rate);
    const dw = await c.decodeTo(W, rate, n);
    let bad = 0;
    for (let i = 0; i < n; i++) if (d.L[i] !== dw.L[i] || d.R[i] !== dw.R[i]) bad++;
    res.flacMismatch = bad;
    const L = Float32Array.from(l, (x) => x / 32768);
    const R = Float32Array.from(r, (x) => x / 32768);
    for (const br of [128000, 192000]) {
      const t1 = performance.now();
      const op = await c.encodeOpus(L, R, rate, br);
      const dd = await c.decodeTo(op.buffer.slice(0), rate, n);
      // where is the click? and error energy
      let best = 0;
      let at = 0;
      for (let i = rate * 3 - 2000; i < rate * 3 + 2000; i++) {
        const v = Math.abs(dd.L[i] - L[i] + (i === rate * 3 ? L[i] : 0));
        if (v > best) (best = v), (at = i);
      }
      let e = 0;
      let sig = 0;
      for (let i = rate; i < n - rate; i++) {
        e += (dd.R[i] - R[i]) ** 2;
        sig += R[i] ** 2;
      }
      res[`opus${br / 1000}`] = { ms: Math.round(performance.now() - t1), ratio: op.length / (n * 4), clickOffset: at - rate * 3, snrDb: Math.round(10 * Math.log10(sig / e)) };
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  const ok = out.flacMismatch === 0 && Math.abs(out.opus192.clickOffset) <= 3 && out.opus192.snrDb > 15;
  console.log(ok ? 'codec ok' : 'codec FAIL');
  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
