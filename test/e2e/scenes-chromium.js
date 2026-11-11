/**
 * 4.5: draws every GPU venue scene with simulated music (a 120 bpm beat, a moving spectrum,
 * some notes) in Chromium and saves a picture of each, highway mode and full screen.
 * Checks each one compiles and draws something.  node test/e2e/scenes-chromium.js <outDir>
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '..', '..', 'src', 'renderer');
const out = process.argv[2] || 'scenes-out';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => {
  if (q.url === '/t.html') return r.end('<!doctype html><html><body style="margin:0;background:#000"><style>#host canvas{position:fixed;inset:0;width:100%;height:100%}</style><div id="host" style="position:fixed;inset:0"></div></body></html>');
  fs.readFile(path.join(ROOT, q.url.split('?')[0]), (e, b) => (e ? (r.writeHead(404), r.end()) : (r.writeHead(200, { 'content-type': q.url.endsWith('.js') ? 'text/javascript' : 'text/plain' }), r.end(b))));
}).listen(0);
(async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('console', (m) => /warn|error/.test(m.type()) && errs.push(m.text()));
  await pg.goto(`http://127.0.0.1:${port}/t.html`);
  let bad = 0;
  for (const scene of (process.env.SCENES || 'mandala,valhalla,strings,nebula').split(',')) {
    for (const hw of [true, false]) {
      const ok = await pg.evaluate(async ([scene, hw]) => {
        const { createVisuals } = await import('/js/visuals.js');
        document.getElementById('host').innerHTML = '';
        const v = createVisuals(document.getElementById('host'), { highway: hw });
        const host = document.getElementById('host');
        let drew = true;
        for (let f = 0; f < 90; f++) {
          const t = f / 30;
          const beat = t * 2;
          const kick = Math.exp(-(beat % 1) * 6);
          const spec = Array.from({ length: 64 }, (_, i) => Math.max(0, 0.55 + 0.4 * Math.sin(i * 0.3 + t * 2) - i / 120));
          const wave = Array.from({ length: 512 }, (_, i) => Math.sin(i / 512 * Math.PI * 8 + t * 5) * 0.5 * (0.6 + kick * 0.4));
          const F = { t, phase: t * 1.3, drive: 0.7, kick, snap: (beat % 2) > 1 ? kick : 0, beats: beat, bands: [0.7, 0.6, 0.55, 0.5, 0.4], spec, wave,
            guitar: { level: 0.6, attack: kick, hue: 0.1, on: true }, events: [{ fret: 5, string: 2, at: performance.now() - (f % 15) * 30, hit: true }, { fret: 12, string: 4, at: performance.now() - (f % 20) * 30, hit: true }] };
          drew = v.draw(scene, F, performance.now()) && drew;
          await new Promise((r) => requestAnimationFrame(r));
        }
        const c = host.querySelector('canvas');
        if (c) c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
        return drew && !v.failed;
      }, [scene, hw]);
      await pg.screenshot({ path: path.join(out, `scene-${scene}${hw ? '-highway' : ''}.png`) });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${scene}${hw ? ' (behind the highway)' : ''}`);
      if (!ok) bad++;
    }
  }
  if (errs.length) console.log(errs.slice(0, 5).join('\n'));
  await b.close();
  srv.close();
  process.exit(bad ? 1 : 0);
})();
