// node shoot.js outDir scene:t[:play][:hits] ...
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..', '..', 'src', 'renderer');
const STUBS = ['api.js', 'rig.js', 'tab.js', 'tonelib.js', 'captures.js', 'realamps.js'];
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.ttf': 'font/ttf', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  let f;
  if (u === '/' || u === '/index.html') f = path.join(__dirname, 'index.html');
  else if (u === '/harness.js' || u.endsWith('.json') && !u.startsWith('/data/')) f = path.join(__dirname, path.basename(u));
  else if (u.startsWith('/js/') && STUBS.includes(path.basename(u))) f = path.join(__dirname, 'stubs', path.basename(u));
  else f = path.join(R, u);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});
(async () => {
  await new Promise((r) => srv.listen(8765, r));
  const out = process.argv[2];
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--single-process', '--no-zygote', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 1920), height: Number(process.env.VH || 1080) }, ...(process.env.VIDEO ? { recordVideo: { dir: out, size: { width: 1280, height: 720 } } } : {}) });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  for (const spec of process.argv.slice(3)) {
    const [scene, t, play, hits, file, part] = spec.split(':');
    await page.goto(`http://localhost:8765/?scene=${scene}&t=${t}&play=${play === 'p' ? 1 : 0}&file=${file || ''}&part=${part || ''}`);
    await page.waitForFunction(() => window.__hwReady, null, { timeout: 15000 });
    if (process.env.VENUE) {
      await page.evaluate((v) => { const p = JSON.parse(localStorage.getItem('stagehand.highway') || '{}'); p.venue = v; p.v = 36; localStorage.setItem('stagehand.highway', JSON.stringify(p)); localStorage.setItem('stagehand.fluidDye', '256'); }, process.env.VENUE);
      await page.reload();
      await page.waitForFunction(() => window.__hwReady, null, { timeout: 15000 });
    }
    // software rendering here is slow: keep the glow on for stills (the app turns it off on slow PCs)
    await page.evaluate(() => { const H = document.querySelector('.highway').__hw; if (H.perfState) H.perfState.n = -1e9; });
    if (process.env.PLAYCAL) {
      // the play-along timing check, with a pretend guitar that picks PLAYCAL ms after each note
      const late = Number(process.env.PLAYCAL) / 1000;
      const r = await page.evaluate(async (late) => {
        const { rig } = await import('/js/rig.js');
        const H = document.querySelector('.highway').__hw;
        const { ctx: ac } = await window.__stage.engine.extraOut();
        rig.latencyMs = 0;
        rig.samples = (buf) => {
          const sp = H.syncPlay;
          const ts0 = ac.getOutputTimestamp ? ac.getOutputTimestamp() : null;
          const now = ts0 && ts0.contextTime > 0 ? ts0.contextTime + (performance.now() - ts0.performanceTime) / 1000 : ac.currentTime;
          const n = buf.length;
          buf.fill(0);
          if (!sp) return buf;
          for (const T of sp.notes) {
            const p = T + late;
            for (let i = 0; i < n; i++) {
              const ts = now - (n - 1 - i) / 48000;
              if (ts >= p && ts < p + 0.6) buf[i] += 0.4 * Math.exp(-(ts - p) * 6) * Math.sin(2 * Math.PI * 110 * (ts - p));
            }
          }
          return buf;
        };
        rig.on = true;
        document.querySelector('.highway').__openSync?.();
        return 'started';
      }, late);
      if (r !== 'started') throw new Error(r);
      await page.waitForFunction(() => document.querySelector('.hw-syncbox .btn.primary'), null, { timeout: 10000 });
      await page.click('.hw-syncbox .btn.primary');
      await page.waitForFunction(() => document.querySelector('.hw-sync-big') || /Not enough/.test(document.querySelector('.hw-syncbox').textContent), null, { timeout: 40000 });
      const out = await page.evaluate(() => ({ big: (document.querySelector('.hw-sync-big') || {}).textContent, text: document.querySelector('.hw-syncbox').textContent, played: document.querySelector('.highway').__hw.syncPlay.played.length }));
      console.log('PLAYCAL', JSON.stringify(out));
      // scoring takes (latency 20 ms + 30 ms) off what it hears; this pretend guitar has no latency
      const got = parseInt(out.big, 10);
      const want = Number(process.env.PLAYCAL) - 50;
      if (!(Math.abs(got - want) <= 25)) throw new Error(`timing check measured ${got} ms, expected about ${want}`);
      console.log(`PASS the play-along timing check measures a guitar ${process.env.PLAYCAL} ms late as ${got} ms (expected ${want} ± 25)`);
      await page.screenshot({ path: path.join(process.argv[2], 'playcal.png') }).catch(() => {});
    }
    if (process.env.LOSE_CONTEXT) {
      // the graphics card takes the moving background away: it must come back by itself, not stay black
      const r = await page.evaluate(async () => {
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        await wait(1500);
        const old = document.querySelector('canvas.hw-visual');
        if (!old) return 'no moving background to test (set VENUE to a scene)';
        old.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();
        await wait(2500);
        const now = document.querySelector('canvas.hw-visual');
        return now && now !== old && !now.getContext('webgl2').isContextLost() ? 'ok' : 'still lost';
      });
      if (r !== 'ok') throw new Error(`background after a lost picture: ${r}`);
      console.log('PASS the moving background rebuilds itself after the graphics card drops it');
    }
    if (process.env.VERIFY) {
      const checks = await page.evaluate(async () => {
        const H = document.querySelector('.highway').__hw;
        const eng = window.__stage.engine;
        const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const failures = [];
        for (const speed of [1, .5, .85]) {
          eng.speed = speed;
          for (const t of [4, 4.016, 5.2, 2, 40, 40.01]) {
            eng.position = t;
            await frame();
            if (Math.abs(H.clock - t) > .000001) failures.push('clock at ' + t);
            for (let str = 0; str < H.tab.strings; str++) {
              const a = H.projection.point(7, str, t), b = H.projection.neck(7, str);
              if (Math.hypot(a[0]-b[0],a[1]-b[1]) > .001) failures.push('strike-plane mismatch');
            }
          }
        }
        const judged = H.judge?.judged;
        await frame();
        if (H.judge?.judged !== judged) failures.push('paused scoring changed');
        eng.speed = 1; eng.position = Number(new URLSearchParams(location.search).get('t'));
        await frame();
        return failures;
      });
      if (checks.length) throw new Error(checks.join(', '));
      console.log('PASS speaker clock, seeks, three speeds, all string strike planes, paused scoring:', spec);
      await page.getByRole('button', { name: 'Highway options', exact: true }).click();
      await page.locator('.hw-seg button', { hasText: '4 s' }).click();
      if (!await page.evaluate(() => JSON.parse(localStorage.getItem('stagehand.highway')).ahead === 4)) throw new Error('Look-ahead not saved');
      await page.locator('.hw-seg button', { hasText: '3 s' }).click();
      console.log('PASS options panel saves look-ahead');

    }
    if (hits) {
      await page.evaluate((mode) => {
        const H = document.querySelector('.highway').__hw;
        const T = H.targets;
        let next = 0;
        const j = { state: new Map(), events: [], streak: 0, hits: 0, judged: 0, accuracy: null,
          push() {}, reset() {}, rewind() {},
          tick(t) {
            while (next < T.length && T[next].t <= t) {
              const tg = T[next++];
              if (t - tg.t > 0.3) continue;
              const hit = mode === 'h' ? true : next % 3 !== 0;
              const offset = Math.round((Math.random() - 0.5) * 200);
              this.state.set(tg.id, { result: hit ? 'hit' : 'miss', at: t, offset });
              this.events.push({ id: tg.id, hit });
              this.judged++; if (hit) { this.hits++; this.streak++; } else this.streak = 0;
              this.accuracy = this.hits / this.judged;
            }
          } };
        const t0 = window.__stage.engine.position;
        next = T.findIndex((x) => x.t > t0); if (next < 0) next = T.length;
        H.judge = j;
      }, hits);
    }
    if (process.env.VIDEO) {
      const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
      console.log('fps', fps);
      await page.waitForTimeout(Number(process.env.VIDEO) * 1000);
      continue;
    }
    if (process.env.SEQ) {
      const [n, every] = process.env.SEQ.split(',').map(Number);
      for (let i = 0; i < n; i++) {
        await page.waitForTimeout(every);
        await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.open = false; cancelAnimationFrame(H.raf); });
    await page.screenshot({ timeout: 60000, path: path.join(out, `seq_${String(i).padStart(3, '0')}.jpg`), quality: 70 });
      }
      continue;
    }
    if (process.env.TCHECK) {
      // the tuning check card: a Drop D song at A425 on an E Standard guitar, the low string
      // half way down (heard 100 cents above D), then in tune: it gets a tick
      await page.evaluate(async () => {
        const { rig } = await import('/js/rig.js');
        const { tuningGuide } = await import('/js/tuning-check.js');
        localStorage.removeItem('stagehand.myTuning');
        window.__pitch = 3900 - 60 + 100;
        rig.pitch = () => { const c = window.__pitch; const midi = Math.round(c / 100); return { hz: 440 * 2 ** ((c - 6900) / 1200), midi, cents: c - midi * 100, clarity: 0.97 }; };
        tuningGuide({ tuning: [-2, 0, 0, 0, 0, 0], cents: -60, type: 'lead' }, { id: 's1', title: 'Scene T' });
      });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, 'tcheck-1.png') });
      const r = await page.evaluate(async () => {
        window.__pitch = 3800 - 60 + 2;
        await new Promise((r) => setTimeout(r, 1200));
        const row = [...document.querySelectorAll('.tcheck-row')].find((x) => x.querySelector('.tcheck-num').textContent === '6');
        return { done: row.classList.contains('done'), state: row.querySelector('.tcheck-state').textContent, rows: document.querySelectorAll('.tcheck-row').length, ref: (document.querySelector('.tcheck-ref') || {}).textContent };
      });
      await page.screenshot({ path: path.join(out, 'tcheck-2.png') });
      console.log('TCHECK', JSON.stringify(r));
      if (!r.done || r.rows !== 6 || !/425/.test(r.ref || '')) throw new Error('tuning check card: ' + JSON.stringify(r));
      console.log('PASS the tuning check card lists every string, the reference pitch, and ticks a string tuned by ear');
      continue;
    }
    await page.waitForTimeout(play === 'p' ? 2600 : 2200);
    if (process.env.TUNER) { await page.keyboard.press('u'); await page.waitForTimeout(300); }
    if (process.env.CARD) await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.showCard(); });
    if (process.env.MASTER) { await page.evaluate(() => document.querySelector('.hw-dock.collapsed .hw-dock-tab') && document.querySelector('.hw-dock-tab').click()); await page.waitForTimeout(500); }
    await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.open = false; cancelAnimationFrame(H.raf); });
    await page.screenshot({ timeout: 60000, path: path.join(out, `${scene}_${(file||'').replace('.json','')}_${t}${play === 'p' ? 'p' : ''}${hits || ''}.png`) });
    console.log('shot', spec);
  }
  await browser.close();
  srv.close();
})();
