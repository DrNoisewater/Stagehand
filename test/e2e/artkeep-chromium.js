/** 4.5: album art keeps its decoded <img> across rebuilds (no reload, no blink). node test/e2e/artkeep-chromium.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '..', '..', 'src', 'renderer');
let loads = 0;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEIGBkZGRgYGAA4zgME5mJCAAAAAElFTkSuQmCC', 'base64');
const srv = http.createServer((q, r) => {
  if (q.url === '/t.html') return r.end('<!doctype html><body><div id="list"></div></body>');
  if (q.url.startsWith('/art/')) return loads++, r.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }), r.end(PNG);
  fs.readFile(path.join(ROOT, q.url), (e, b) => (e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'content-type': 'text/javascript' }), r.end(b))));
}).listen(0);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(`http://127.0.0.1:${srv.address().port}/t.html`);
  const res = await p.evaluate(async () => {
    const { drop, reuse } = await import('/js/artkeep.js');
    const list = document.getElementById('list');
    const row = (n) => {
      const el = document.createElement('div');
      el.innerHTML = `<div class="thumb"><img src="/art/${n}.png"></div><b>Song ${n}</b>`;
      reuse(el);
      return el;
    };
    let rows = [1, 2, 3].map(row);
    rows.forEach((r) => list.append(r));
    await Promise.all([...list.querySelectorAll('img')].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = r)))));
    const before = [...list.querySelectorAll('img')];
    // the list is rebuilt three times (a play count changed, a best was logged, …)
    for (let k = 0; k < 3; k++) {
      rows.forEach(drop);
      rows = [1, 2, 3].map(row);
      rows.forEach((r) => list.append(r));
    }
    const after = [...list.querySelectorAll('img')];
    return { same: after.every((img, i) => img === before[i]), complete: after.every((i) => i.complete && i.naturalWidth > 0) };
  });
  console.log(`${res.same ? 'ok  ' : 'FAIL'} the same picture elements stay through three rebuilds`);
  console.log(`${res.complete ? 'ok  ' : 'FAIL'} they are drawn at once (already decoded)`);
  console.log(`${loads === 3 ? 'ok  ' : 'FAIL'} each picture was fetched once (${loads} fetches for 3 pictures)`);
  await b.close();
  srv.close();
  process.exit(res.same && res.complete && loads === 3 ? 0 : 1);
})();
