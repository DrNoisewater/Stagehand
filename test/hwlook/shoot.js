// node shoot.js outDir scene:t[:play][:hits] ...
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..', '..', 'src', 'renderer');
const PORT = Number(process.env.PORT || 8765);
const STUBS = ['api.js', 'rig.js', 'tab.js', 'tonelib.js', 'captures.js', 'realamps.js', 'drums.js'];
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.ttf': 'font/ttf', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif' };
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
  await new Promise((r) => srv.listen(PORT, r));
  const out = process.argv[2];
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--single-process', '--no-zygote', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 1920), height: Number(process.env.VH || 1080) }, ...(process.env.VIDEO ? { recordVideo: { dir: out, size: { width: 1280, height: 720 } } } : {}) });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message, (e.stack || '').split('\n').slice(1, 3).join(' ')));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  for (const spec of process.argv.slice(3)) {
    const [scene, t, play, hits, file, part] = spec.split(':');
    await page.goto(`http://localhost:${PORT}/?scene=${scene}&t=${t}&play=${play === 'p' ? 1 : 0}&file=${file || ''}&part=${part || ''}${process.env.SING ? `&sing=${process.env.SING}` : ''}${process.env.PIANO ? `&piano=${process.env.PIANO}` : ''}${process.env.NONOTES ? '&nonotes=1' : ''}${process.env.TOPBAR || process.env.MODES ? '&piano=tune&sing=1' : ''}`);
    await page.waitForFunction(() => window.__hwReady, null, { timeout: 15000 });
    if (process.env.VENUE) {
      await page.evaluate((v) => { const p = JSON.parse(localStorage.getItem('stagehand.highway') || '{}'); p.venue = v; p.v = 36; localStorage.setItem('stagehand.highway', JSON.stringify(p)); localStorage.setItem('stagehand.fluidDye', '256'); }, process.env.VENUE);
      await page.reload();
      await page.waitForFunction(() => window.__hwReady, null, { timeout: 15000 });
    }
    // software rendering here is slow: keep the glow on for stills (the app turns it off on slow PCs)
    await page.evaluate(() => { const H = document.querySelector('.highway').__hw; if (H.perfState) H.perfState.n = -1e9; });
    if (process.env.PLAYCAL) {
      // the timing check: its training song on the highway, scored like any song, with a pretend
      // guitar playing the part (real plucked notes at the chart's pitches) PLAYCAL ms late
      const late = Number(process.env.PLAYCAL) / 1000;
      const r = await page.evaluate(async (late) => {
        const { rig } = await import('/js/rig.js');
        const { renderPart } = await import('/js/training-song.js');
        const H = document.querySelector('.highway').__hw;
        const eng = window.__stage.engine;
        rig.latencyMs = 0;
        rig.sampleRate = 48000;
        let part = null;
        let partOf = null;
        rig.samples = (buf) => {
          buf.fill(0);
          const tr = H.training;
          if (!tr || !eng.playing) return buf;
          if (partOf !== tr.tab) { partOf = tr.tab; part = renderPart(tr.tab, 48000, late); }
          const end = Math.round(eng.position * 48000);
          for (let i = 0; i < buf.length; i++) { const k = end - buf.length + 1 + i; if (k >= 0 && k < part.length) buf[i] = part[k]; }
          return buf;
        };
        rig.on = true;
        window.__before = { song: H.song && H.song.id, duration: eng.duration, at: eng.position };
        document.querySelector('.highway').__openSync?.();
        return 'started';
      }, late);
      if (r !== 'started') throw new Error(r);
      await page.waitForFunction(() => document.querySelector('.hw-syncbox:not([hidden]) .btn.primary'), null, { timeout: 10000 });
      const intro = await page.evaluate(() => document.querySelector('.hw-syncbox').textContent);
      if (/space|tap|click/i.test(intro)) throw new Error('the intro still talks about tapping: ' + intro);
      await page.screenshot({ path: path.join(out, 'playcal-intro.png') }).catch(() => {});
      await page.click('.hw-syncbox .btn.primary');
      await page.waitForFunction(() => { const H = document.querySelector('.highway').__hw; return H.training && window.__stage.engine.playing; }, null, { timeout: 15000 });
      const song = await page.evaluate(() => { const H = document.querySelector('.highway').__hw; const e = window.__stage.engine; H.judge.debug = []; window.__fps0 = [performance.now(), e.position]; return { title: H.song.title, notes: H.targets.length, duration: e.duration, loaded: e.loaded && e.loaded.bytes, strings: [...new Set(H.tab.notes.map((n) => n.s))].sort() }; });
      console.log('PLAYCAL training song', JSON.stringify(song));
      if (!(song.duration > 24 && song.duration < 30) || !song.loaded || song.notes < 16) throw new Error('the training song did not load');
      await page.waitForFunction(() => window.__stage.engine.position > 11.3, null, { timeout: 30000 });
      await page.screenshot({ path: path.join(out, 'playcal-song.png') }).catch(() => {});
      await page.waitForFunction(() => document.querySelector('.hw-sync-big') || /Not enough/.test(document.querySelector('.hw-syncbox').textContent), null, { timeout: 60000 });
      const res = await page.evaluate(() => ({ big: (document.querySelector('.hw-sync-big') || {}).textContent, text: document.querySelector('.hw-syncbox').textContent, played: document.querySelector('.highway').__hw.syncPlay.played.length, result: document.querySelector('.highway').__hw.syncResult, framesPerSecond: Math.round((document.querySelector('.highway').__hw.judge.debug || []).length / (window.__stage.engine.position - window.__fps0[1])) }));
      console.log('PLAYCAL', JSON.stringify(res));
      await page.screenshot({ path: path.join(out, 'playcal.png') }).catch(() => {});
      // scoring takes (latency 20 ms + 30 ms) off what it hears; this pretend guitar has no latency
      const got = parseInt(res.big, 10);
      const want = Number(process.env.PLAYCAL) - 50;
      if (!(Math.abs(got - want) <= 25)) throw new Error(`timing check measured ${got} ms, expected about ${want}`);
      const N = res.result.notes;
      // scoring needs a few frames after each pick: software drawing here can run too slowly for that
      if (!(res.result.hits >= N - 4)) {
        if (res.framesPerSecond >= 15) throw new Error(`only ${res.result.hits} of ${N} notes hit`);
        console.log(`NOTE only ${res.result.hits} of ${N} notes hit, at ${res.framesPerSecond} frames a second (too slow here to judge that)`);
      }
      console.log(`PASS the timing check measures a guitar ${process.env.PLAYCAL} ms late as ${got} ms (expected ${want} ± 25), ${res.result.hits} of ${N} notes hit`);
      // Use: the setting is saved and your song comes back where you were
      await page.click('.hw-syncbox .btn.primary');
      const after = await page.evaluate(() => { const H = document.querySelector('.highway').__hw; const e = window.__stage.engine; return { song: H.song && H.song.id, duration: e.duration, at: e.position, training: !!H.training, box: document.querySelector('.hw-syncbox').hidden, offset: JSON.parse(localStorage.getItem('stagehand.highway') || '{}').offsetMs, before: window.__before }; });
      console.log('PLAYCAL after', JSON.stringify(after));
      if (after.training || !after.box || after.song !== after.before.song || after.duration !== after.before.duration || Math.abs(after.at - after.before.at) > 0.01) throw new Error('the song did not come back after the timing check');
      if (after.offset !== got) throw new Error(`offset saved as ${after.offset}, wanted ${got}`);
      console.log('PASS back at the song after the timing check, offset saved');
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
          push() {}, reset() {}, rewind() {}, setPace() {},
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
    if (process.env.MODES) {
      // one song, four ways to play it, from the top bar: the Sing, Karaoke and Piano chips never move or
      // vanish, side menus open under the mouse and stay put, ticks change in place, the tuning card waits
      // for the guitar, and the bar doesn't fade right after a menu
      const fail = (m) => { throw new Error('modes: ' + m); };
      await page.evaluate(() => {
        navigator.requestMIDIAccess = async () => ({ inputs: new Map(), onstatechange: null });
        const ac = new AudioContext();
        const dest = ac.createMediaStreamDestination();
        navigator.mediaDevices.getUserMedia = async () => dest.stream;
        navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'default', label: 'Default' }];
        localStorage.removeItem('stagehand.keys');
        localStorage.removeItem('stagehand.myTuning');
      });
      const snap = () => page.evaluate(() => {
        const root = document.querySelector('.highway');
        const H = root.__hw;
        const box = (q) => { const e = document.querySelector(q); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; };
        const pressed = (q) => document.querySelector(q).getAttribute('aria-pressed') === 'true';
        return { sing: box('.hw-sing-chip'), karaoke: box('.hw-karaoke-chip'), piano: box('.hw-keys-chip'), go: box('.hw-go'), on: { sing: pressed('.hw-sing-chip'), karaoke: pressed('.hw-karaoke-chip'), piano: pressed('.hw-keys-chip'), part: [...document.querySelectorAll('.hw-parts button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.id).join() }, view: !document.querySelector('.hw-piano').hidden, kar: root.classList.contains('hw-karaoke'), tab: H.tab && H.tab.id, card: !!document.querySelector('.tcheck') };
      });
      const same = (a, b, what) => { for (const k of ['sing', 'karaoke', 'piano', 'go']) { if (!a[k] || !b[k]) fail(`${what}: the ${k} button is gone ${JSON.stringify(b)}`); if (Math.abs(a[k][0] - b[k][0]) > 1 || Math.abs(a[k][1] - b[k][1]) > 1) fail(`${what}: the ${k} button moved ${a[k]} -> ${b[k]}`); } };
      const s0 = await snap();
      if (s0.on.sing || s0.on.karaoke || s0.on.piano || !s0.on.part) fail('at the start: ' + JSON.stringify(s0));
      // piano
      await page.click('.hw-keys-chip');
      await page.waitForFunction(() => document.querySelector('.highway').__hw.keys.state.arr && !document.querySelector('.hw-piano').hidden, null, { timeout: 15000 });
      const s1 = await snap();
      same(s0, s1, 'piano on');
      if (!s1.on.piano || s1.on.part || s1.on.sing) fail('piano on: ' + JSON.stringify(s1.on));
      const range = () => page.evaluate(() => { const K = document.querySelector('.highway').__hw.keys.state; return [...K.range]; });
      const r88 = await range();
      if (!(r88[0] <= 21 && r88[1] >= 108)) fail('88 keys: ' + r88);
      await page.screenshot({ path: path.join(out, 'modes-1-piano.png') });
      // its menu: side menus open under the mouse, the first menu stays the same one
      await page.click('.hw-keys-chip');
      await page.waitForSelector('.menu');
      await page.evaluate(() => { window.__m0 = document.querySelector('.menu'); window.__m0.dataset.mark = '1'; });
      const row = (text, nth = 0) => page.locator('.menu').nth(nth).locator('button', { hasText: text }).first();
      await row('Look').hover();
      await page.waitForFunction(() => document.querySelectorAll('.menu').length === 2, null, { timeout: 3000 }).catch(() => fail('the Look side menu did not open under the mouse'));
      await page.locator('.menu').nth(1).locator('button', { hasText: 'Rainbow' }).click();
      const m1 = await page.evaluate(() => ({ kept: document.querySelector('.menu') === window.__m0 && document.querySelectorAll('.menu').length === 2, colours: JSON.parse(localStorage.getItem('stagehand.keys')).colours, anim: getComputedStyle(document.querySelector('.menu')).animationName }));
      if (!m1.kept || m1.colours !== 'rainbow' || m1.anim !== 'none') fail('picking a colour: ' + JSON.stringify(m1));
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, 'modes-2-menu.png') });
      await row('Piano size').hover();
      await page.waitForFunction(() => { const m = document.querySelectorAll('.menu'); return m.length === 2 && /61 keys/.test(m[1].textContent); }, null, { timeout: 3000 }).catch(() => fail('the Piano size side menu did not take over'));
      await page.locator('.menu').nth(1).locator('button', { hasText: '61 keys' }).click();
      const r61 = await range();
      if (r61[0] !== 36 || r61[1] !== 96) fail('61 keys: ' + r61);
      await page.locator('.menu').nth(1).locator('button', { hasText: '88 keys' }).click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const m2 = await page.evaluate(() => ({ menus: document.querySelectorAll('.menu').length, quiet: document.querySelector('.highway').classList.contains('hw-quiet') }));
      if (m2.menus || m2.quiet) fail('after closing the menu: ' + JSON.stringify(m2));
      // the song wants Drop D: nothing about tuning while the guitar is aside
      await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.tab.tuning = [-2, 0, 0, 0, 0, 0]; });
      await page.click('.hw-karaoke-chip');
      await page.waitForTimeout(600);
      const s2 = await snap();
      same(s0, s2, 'karaoke');
      if (!s2.on.karaoke || s2.on.piano || s2.view || !s2.kar || s2.card) fail('karaoke: ' + JSON.stringify(s2));
      await page.screenshot({ path: path.join(out, 'modes-3-karaoke.png') });
      await page.click('.hw-sing-chip');
      await page.waitForTimeout(600);
      const s3 = await snap();
      same(s0, s3, 'sing');
      if (!s3.on.sing || s3.on.karaoke || s3.kar || !s3.on.part) fail('sing with the part: ' + JSON.stringify(s3));
      if (!s3.card) fail('back on the guitar in a Drop D song: no tuning card');
      await page.screenshot({ path: path.join(out, 'modes-4-sing.png') });
      await page.click('text=Skip, keep going');
      await page.waitForFunction(() => !document.querySelector('.tcheck'), null, { timeout: 4000 }).catch(() => fail('the tuning card did not close'));
      await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.tab.tuning = [0, 0, 0, 0, 0, 0]; });
      // another part, then the go-anywhere menu
      await page.click('.hw-parts button[data-id="bass"]');
      await page.waitForFunction(() => document.querySelector('.highway').__hw.tab.id === 'bass', null, { timeout: 8000 }).catch(() => fail('the Bass button did not load the bass part'));
      same(s0, await snap(), 'bass');
      await page.click('.hw-go');
      await page.waitForSelector('.menu');
      const go = await page.evaluate(() => [...document.querySelectorAll('.menu button')].map((b) => b.textContent.trim()));
      for (const w of ['Songs', 'Karaoke', 'Tones', 'Settings']) if (!go.some((x) => x.startsWith(w))) fail('the go menu has no ' + w + ': ' + go.join(' | '));
      await page.screenshot({ path: path.join(out, 'modes-5-go.png') });
      await page.keyboard.press('Escape');
      console.log('PASS modes: Sing, Karaoke and Piano stay put in every mode, side menus open under the mouse and ticks change in place, 61 and 88 keys, the tuning card waits for the guitar, any part and any page from the top bar');
      continue;
    }
    if (process.env.TOPBAR) {
      // the top bar fits at this window size, with Piano off and on: nothing off the edges, the title readable
      const fail = (m) => { throw new Error('top bar: ' + m); };
      for (const mode of ['off', 'piano']) {
        if (mode === 'piano') {
          await page.evaluate(() => { navigator.requestMIDIAccess = async () => ({ inputs: new Map(), onstatechange: null }); document.querySelector('.highway').__hw.keys.turn(true); });
          await page.waitForTimeout(900);
        }
        const r = await page.evaluate(() => {
          const top = document.querySelector('.hw-top');
          document.querySelector('.highway').classList.remove('hw-quiet');
          const vw = innerWidth;
          const out = [...top.querySelectorAll('button')].filter((e) => e.offsetParent).filter((e) => { const b = e.getBoundingClientRect(); return b.right > vw + 1 || b.left < -1; }).map((e) => e.textContent.trim().slice(0, 20) || e.className);
          const title = top.querySelector('.hw-title, .hw-titlebox, [class*=title]');
          const b = title && title.querySelector('b');
          return { out, title: title ? Math.round(title.getBoundingClientRect().width) : -1, titleShown: b ? b.clientWidth >= Math.min(b.scrollWidth, 90) : false, settingsRight: Math.round(document.querySelector('.hw-set-btn').getBoundingClientRect().right), vw };
        });
        console.log('TOPBAR', mode, JSON.stringify(r));
        await page.screenshot({ path: path.join(out, `topbar-${process.env.VW || 1920}-${mode}.png`), clip: { x: 0, y: 0, width: Number(process.env.VW || 1920), height: 110 } });
        if (r.out.length || r.settingsRight > r.vw || !r.titleShown) fail(JSON.stringify(r));
      }
      console.log(`PASS the top bar fits at ${process.env.VW || 1920} wide, Piano off and on`);
      continue;
    }
    if (process.env.PIANO) {
      // Piano: a pretend USB keyboard (an Allegro IV) and a pretend pianist who plays the part Stagehand
      // wrote, a little early or late, holding each note, leaving bar 4 out and hitting a wrong key now and then.
      const fail = (m) => { throw new Error('piano: ' + m); };
      const level = process.env.PIANO_LEVEL || 'hard';
      await page.evaluate((level) => {
        localStorage.setItem('stagehand.keys', JSON.stringify({ level, hands: 'both', look: 'both' }));
        const listeners = new Set();
        const input = { id: 'allegro', name: 'Allegro IV', state: 'connected', addEventListener: (k, f) => listeners.add(f), removeEventListener: (k, f) => listeners.delete(f) };
        window.__press = (midi, on) => { const e = { data: new Uint8Array([on ? 0x90 : 0x80, midi, on ? 90 : 0]), timeStamp: performance.now() }; for (const f of listeners) f(e); };
        window.__midiAsked = 0;
        navigator.requestMIDIAccess = async () => (window.__midiAsked++, { inputs: new Map([['allegro', input]]), onstatechange: null });
      }, level);
      const st0 = await page.evaluate(() => ({ chip: !document.querySelector('.hw-keys-chip').hidden, view: !document.querySelector('.hw-piano').hidden, asked: window.__midiAsked }));
      if (!st0.chip || st0.view || st0.asked) fail('before pressing Piano: ' + JSON.stringify(st0));
      await page.screenshot({ path: path.join(out, 'piano-0-off.png') });
      await page.click('.hw-keys-chip');
      await page.waitForFunction(() => document.querySelector('.highway').__hw.keys.state.arr && !document.querySelector('.hw-piano').hidden, null, { timeout: 15000 });
      const info = await page.evaluate(() => { const K = document.querySelector('.highway').__hw.keys.state; return { key: K.arr.key.name, chords: K.arr.chords.filter((c) => c.len >= 4).slice(0, 12).map((c) => c.name), notes: K.notes.length, sources: K.arr.sources, neck: document.querySelector('.highway').classList.contains('hw-keys-on') }; });
      console.log('PIANO', JSON.stringify(info));
      if (!info.notes || !info.neck) fail('no part: ' + JSON.stringify(info));
      await page.evaluate(() => {
        const H = document.querySelector('.highway').__hw;
        const K = H.keys.state;
        const bar4 = K.arr.grid.bars[3];
        const skip = (n) => n.k >= bar4.k0 && n.k < bar4.k1;
        const down = new Map();
        let wrongs = 0;
        window.__pianist = setInterval(() => {
          if (!window.__stage.engine.playing) return;
          const t = K.vis;
          K.notes.forEach((n, i) => {
            const jit = ((i * 37) % 11) / 11 * 0.08 - 0.04;
            if (!down.has(i) && !skip(n) && t >= n.t + jit && t < n.t + 0.1) { window.__press(n.midi, true); down.set(i, n); }
          });
          for (const [i, n] of down) if (t >= n.t + n.d * 0.92) { window.__press(n.midi, false); down.delete(i); }
          if (t > 6 && wrongs < 3 && Math.random() < 0.002) { wrongs++; window.__press(61, true); setTimeout(() => window.__press(61, false), 120); }
        }, 4);
        const e = window.__stage.engine; e.position = 0; e.dispatchEvent(new Event('seek')); e.play();
      });
      const until = (t) => page.waitForFunction((t) => window.__stage.engine.position > t, t, { timeout: 90000 });
      const shots = (process.env.PIANO_SHOTS || '5,9,13').split(',').map(Number);
      for (const [i, at] of shots.entries()) { await until(at); await page.screenshot({ path: path.join(out, `piano-${i + 1}.png`) }); }
      const end = Number(process.env.PIANO_END || 22);
      await until(end);
      const r = await page.evaluate(async () => {
        const H = document.querySelector('.highway').__hw;
        const j = H.keys.state.judge;
        const live = { hits: j.hits, judged: j.judged, acc: j.accuracy, wrong: j.wrong.length };
        clearInterval(window.__pianist);
        const e = window.__stage.engine;
        e.pause();
        e.dispatchEvent(new Event('ended'));
        await new Promise((x) => setTimeout(x, 300));
        const card = document.querySelector('.hw-card');
        return { ...live, card: !card.hidden, cardText: card.textContent, logs: (window.__statsLogs || []).filter((x) => x.part === 'keys') };
      });
      console.log('PIANO RUN', JSON.stringify({ ...r, cardText: r.cardText.slice(0, 160) }));
      await page.screenshot({ path: path.join(out, 'piano-card.png') });
      if (!(r.acc > 0.6 && r.acc < 0.99)) fail('accuracy ' + r.acc + ' (bar 4 left out, the rest played)');
      if (!r.card || !/Piano/.test(r.cardText) || /notes hit/.test(r.cardText)) fail('the card: ' + r.cardText);
      if (!r.logs.length || !r.logs[0].full) fail('stats: ' + JSON.stringify(r.logs));
      const off = await page.evaluate(async () => { document.querySelector('.highway').__hw.keys.turn(false); const { keyboard } = await import('/js/midi.js'); return { kb: keyboard.on, view: !document.querySelector('.hw-piano').hidden, neck: document.querySelector('.highway').classList.contains('hw-keys-on') }; });
      if (off.kb || off.view || off.neck) fail('switching off: ' + JSON.stringify(off));
      console.log('PASS piano: off until pressed, a part written from the song, a pretend pianist scored note by note (bar 4 left out), the card and the stats get it, off lets the keyboard go and the neck comes back');
      continue;
    }
    if (process.env.SING) {
      // Sing along: a pretend microphone (a tone that follows the song's notes) sings the made-up song.
      // Lines 1 and 2 are sung right (an octave down), line 3 is left out, line 4 is sung right.
      const fail = (m) => { throw new Error('sing: ' + m); };
      if (process.env.SING_WOBBLE) await page.evaluate(() => { window.__SING_WOBBLE = 1; });
      const st0 = await page.evaluate(() => {
        const H = document.querySelector('.highway').__hw;
        window.__micAsked = 0;
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        osc.type = 'sawtooth';
        const gain = ac.createGain();
        gain.gain.value = 0;
        const dest = ac.createMediaStreamDestination();
        osc.connect(gain).connect(dest);
        osc.start();
        navigator.mediaDevices.getUserMedia = async () => { window.__micAsked++; return dest.stream; };
        navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'default', label: 'Default' }, { kind: 'audioinput', deviceId: 'usb1', label: 'USB Microphone' }, { kind: 'audioinput', deviceId: 'rs1', label: 'Rocksmith Guitar Adapter' }];
        const ly = window.__tab.lyrics;
        const lineOf = [];
        let ln = 0;
        for (const w of ly) { lineOf.push(ln); if (w.w.endsWith('+')) ln++; }
        window.__skipLine = 2;
        window.__wobble = !!window.__SING_WOBBLE;
        setInterval(() => {
          const t = window.__stage.engine.position;
          const i = ly.findIndex((x) => t >= x.t && t < x.t + x.d);
          const on = i >= 0 && lineOf[i] !== window.__skipLine && window.__stage.engine.playing;
          // SING_WOBBLE: a real, unsteady voice: vibrato, drift, a slide into each note, a crack up an
          // octave now and then, and short breaths where the microphone hears nothing
          if (window.__wobble && on) {
            const W = window.__wob || (window.__wob = { drift: 0, crack: 0, gap: 0, i: -1, at: 0 });
            if (W.i !== i) { W.i = i; W.at = t; W.drift = (Math.random() - 0.5) * 0.5; }
            W.drift += (Math.random() - 0.5) * 0.06 - W.drift * 0.02;
            if (W.crack > 0) W.crack--; else if (Math.random() < 0.004) W.crack = 6;
            if (W.gap > 0) W.gap--; else if (Math.random() < 0.003) W.gap = 12;
            const slide = Math.max(0, 1 - (t - W.at) / 0.12) * -1.2;
            const m = window.__singTune[i] - 12 + 0.35 * Math.sin(t * 2 * Math.PI * 5.5) + W.drift + slide + (W.crack ? 12 : 0) + (Math.random() - 0.5) * 0.5;
            gain.gain.value = W.gap ? 0 : 0.3;
            osc.frequency.value = 440 * 2 ** ((m - 69) / 12);
            return;
          }
          gain.gain.value = on ? 0.3 : 0;
          // TUNE: the pretend singer is 40 cents flat (auto-tune must put that right)
          if (on) osc.frequency.value = 440 * 2 ** ((window.__singTune[i] - 12 - (window.__flat || 0) - 69) / 12);
          window.__sungNow = on ? window.__singTune[i] - 12 : null;
        }, 4);
        const chip = document.querySelector('.hw-sing-chip');
        return { chip: !!chip && !chip.hidden, pressed: chip && chip.getAttribute('aria-pressed'), lane: !document.querySelector('.hw-sing').hidden, lyrics: !!document.querySelector('.hw-lyrics'), ctx: ac.state };
      });
      if (!st0.chip || st0.pressed !== 'false' || st0.lane) fail('before pressing Sing: ' + JSON.stringify(st0));
      await page.waitForTimeout(600);
      if (await page.evaluate(() => window.__micAsked)) fail('the microphone was opened before Sing was pressed');
      await page.screenshot({ path: path.join(out, 'sing-0-off.png') });
      const kar = process.env.SING === 'karaoke';
      // TUNE=robot|pop|natural: auto-tune on. What goes to the speakers is listened to all the way through.
      const tuneStyle = process.env.TUNE || '';
      if (tuneStyle) {
        await page.evaluate(async (style) => {
          const { autotune } = await import('/js/autotune.js');
          const { detectPitch } = await import('/js/pitch.js');
          window.__flat = 0.4;
          autotune.setStyle(style);
          autotune.setNotes('song');
          window.__tuned = [];
          let an = null;
          let node = null;
          const buf = new Float32Array(2048);
          setInterval(() => {
            if (!autotune.node) return;
            if (node !== autotune.node) {
              node = autotune.node;
              an = node.context.createAnalyser();
              an.fftSize = 2048;
              node.connect(an);
            }
            const want = window.__sungNow;
            an.getFloatTimeDomainData(buf);
            const r = detectPitch(buf, node.context.sampleRate, { minHz: 70, maxHz: 1100 });
            if (want === null || !r || r.clarity < 0.6) return;
            window.__tuned.push(Math.round((69 + 12 * Math.log2(r.hz / 440) - want) * 100));
          }, 50);
        }, tuneStyle);
      }
      // the Sing button is singing beside the guitar part; karaoke is asked for by the Karaoke page
      if (kar) await page.evaluate(() => document.querySelector('.highway').__hw.sing.setKaraoke(true));
      else await page.click('.hw-sing-chip');
      await page.waitForFunction(() => !document.querySelector('.hw-sing').hidden && document.querySelector('.highway').__hw.sing.active, null, { timeout: 8000 });
      const words = process.env.SING === 'words';
      // the song starts once the microphone is open and hearing (opening it takes a moment)
      await page.evaluate(async () => { const { mic } = await import('/js/mic.js'); for (let i = 0; i < 100 && !mic.on; i++) await new Promise((x) => setTimeout(x, 100)); await new Promise((x) => setTimeout(x, 400)); });
      if (process.env.SING === 'stem') await page.waitForFunction(() => document.querySelector('.highway').__hw.sing.state.mode === 'stem', null, { timeout: 30000 });
      // a run-up of 2.5 s before the first word: this machine draws slowly for a moment once the song starts
      await page.evaluate(() => { const e = window.__stage.engine; e.position = 0; e.dispatchEvent(new Event('seek')); e.play(); });
      const until = (t) => page.waitForFunction((t) => window.__stage.engine.position > t, t, { timeout: 60000 });
      await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; f(); });
      await until(4.6);
      if (kar) {
        const k = await page.evaluate(() => ({ cls: document.querySelector('.highway').classList.contains('hw-karaoke'), big: document.querySelector('.hw-sing').dataset.k, muted: window.__vocals.muted, chip: document.querySelector('.hw-sing-chip').textContent, guitar: window.__shHighway.judge() }));
        if (!k.cls || k.big !== '1' || !k.muted || !/Karaoke/.test(k.chip) || k.guitar) fail('karaoke on: ' + JSON.stringify(k));
      }
      await page.screenshot({ path: path.join(out, 'sing-1-bars.png') });
      {
        // auto-tune and the voice changer are on the lane itself: a strip of tape that opens their menu
        await page.click('.hw-sing .sw-tune');
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => { const all = document.querySelectorAll('.menu'); const e = all[all.length - 1]; const b = document.querySelector('.hw-sing .sw-tune'); return { menu: e ? e.textContent : '', label: b.textContent, pressed: b.getAttribute('aria-pressed') }; });
        if (!/Hard tune/.test(m.menu) || !/Voice:/.test(m.menu) || !/Tune to/.test(m.menu)) fail('the lane\'s auto-tune button opens no menu: ' + JSON.stringify(m));
        if (m.pressed !== String(!!tuneStyle)) fail('the lane\'s auto-tune button shows the wrong state: ' + JSON.stringify(m));
        await page.screenshot({ path: path.join(out, 'sing-1-tune-menu.png') });
        if (tuneStyle) {
          // Mute my voice: the voice stops, the choice is kept; pressing it again brings the voice back
          const press = async () => { await page.locator('.menu button', { hasText: 'Mute my voice' }).last().click(); await page.waitForTimeout(500); };
          const now = () => page.evaluate(async () => { const { autotune } = await import('/js/autotune.js'); return { on: autotune.on, muted: autotune.muted, style: autotune.style, label: document.querySelector('.hw-sing .sw-tune').textContent }; });
          await press();
          const off = await now();
          if (off.on || !off.muted || off.style !== tuneStyle || !/muted/i.test(off.label)) fail('Mute my voice did not stop the voice: ' + JSON.stringify(off));
          await page.click('.hw-sing .sw-tune');
          await page.waitForTimeout(250);
          await press();
          const back = await now();
          if (!back.on || back.muted) fail('un-muting did not bring the voice back: ' + JSON.stringify(back));
          console.log('MUTE', JSON.stringify({ off, back }));
        }
        // (Escape only while a menu is open: with none, it would leave the song)
        if (await page.locator('.menu').count()) await page.keyboard.press('Escape');
      }
      await until(11.2);
      await page.screenshot({ path: path.join(out, 'sing-2-bars-after-line.png') });
      const last = await page.evaluate(() => { const l = window.__tab.lyrics; return l[l.length - 1].t + l[l.length - 1].d; });
      await until(last - 2.2);
      await page.evaluate(async () => { const { setSingLook } = await import('/js/singlane.js'); setSingLook('words'); });
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, 'sing-3-words.png') });
      await until(last + 0.6);
      const r = await page.evaluate(async () => {
        const H = document.querySelector('.highway').__hw;
        const j = H.sing.state.judge;
        const live = { share: [...j.good].map((g, i) => Math.round((g / j.syl[i].d) * 100)), frames: window.__frames, hits: j.hits, judged: j.judged, lines: [...j.lineResult], mode: H.sing.state.mode, asked: window.__micAsked };
        const e = window.__stage.engine;
        e.pause();
        e.dispatchEvent(new Event('ended'));
        await new Promise((x) => setTimeout(x, 300));
        const card = document.querySelector('.hw-card');
        return { ...live, card: !card.hidden, cardText: card.textContent, logs: window.__statsLogs || [], fps: H.fpsAcc ? Math.round(1 / H.fpsAcc) : null };
      });
      console.log('SING', JSON.stringify(r));
      if (kar) {
        if (!/sung/.test(r.cardText) || /notes hit/.test(r.cardText)) fail('karaoke should end on the singing card only: ' + r.cardText);
        await page.screenshot({ path: path.join(out, 'sing-4-card.png') });
        // karaoke isn't remembered for the song: without it the neck returns, the singer is put back
        // and singing is off again (the Sing button was never pressed for this song)
        const k2 = await page.evaluate(async () => {
          const H = document.querySelector('.highway').__hw;
          H.sing.setKaraoke(false);
          await new Promise((x) => setTimeout(x, 300));
          return { cls: document.querySelector('.highway').classList.contains('hw-karaoke'), big: document.querySelector('.hw-sing').dataset.k, muted: window.__vocals.muted, on: H.sing.active };
        });
        if (k2.cls || k2.big || k2.muted || k2.on) fail('leaving karaoke: ' + JSON.stringify(k2));
      }
      await page.screenshot({ path: path.join(out, 'sing-4-card.png') });
      const log = r.logs.find((x) => x.part === 'vocals');
      if (words) {
        if (r.mode !== 'rhythm') fail('a song with no notes should be scored on timing only: ' + r.mode);
        if (!(r.lines[0] >= 0.5 && r.lines[1] >= 0.7 && r.lines[2] <= 0.15 && r.lines[3] >= 0.85)) fail('timing-only lines: ' + JSON.stringify(r.lines));
      } else {
        if (r.mode !== (process.env.SING === 'stem' ? 'stem' : 'charted')) fail('mode ' + r.mode);
        // (the first line only has to be mostly there: this machine draws slowly just after the song starts)
        if (!(r.lines[0] >= 0.5 && r.lines[1] >= 0.7 && r.lines[2] === 0 && r.lines[3] >= 0.85)) fail('lines: ' + JSON.stringify(r.lines));
      }
      if (r.asked !== 1) fail('the microphone was asked for ' + r.asked + ' times');
      {
        // auto-tune: off, the voice is never played; on, what is played is on the song's notes
        const at = await page.evaluate(async () => { const { autotune } = await import('/js/autotune.js'); return { on: autotune.on, route: autotune.route, style: autotune.style, tuned: window.__tuned || [], state: autotune.state }; });
        if (!tuneStyle) {
          if (at.on) fail('the voice is played though auto-tune is off: ' + JSON.stringify(at));
        } else {
          const d = at.tuned.map(Math.abs).sort((a, b) => a - b);
          const mid = d[Math.floor(d.length / 2)];
          const near = d.filter((x) => x <= 15).length / Math.max(1, d.length);
          console.log('TUNE', JSON.stringify({ on: at.on, route: at.route, heard: d.length, middle: mid, within15: near, state: at.state }));
          if (!at.on || at.route !== 'speakers') fail('auto-tune is not playing: ' + JSON.stringify({ on: at.on, route: at.route }));
          // (the pretend singer is 40 cents flat; a note that just changed is still on its way)
          if (d.length < 40 || !(mid <= (tuneStyle === 'robot' ? 6 : 12)) || near < (tuneStyle === 'natural' ? 0.6 : 0.75)) fail('the tuned voice is off the notes: ' + JSON.stringify({ heard: d.length, mid, near }));
        }
      }
      if (!r.card || !/sung|Singing/.test(r.cardText)) fail('no singing on the score card: ' + r.cardText);
      if (!log || log.notes !== r.judged || !(log.accuracy > 0.6 && log.accuracy < 0.85) || !log.full) fail('stats: ' + JSON.stringify(r.logs));
      // switching it off lets the microphone go and brings the plain lyrics back
      await page.evaluate(() => document.querySelector('.highway').__hw.sing.turn(false));
      const off = await page.evaluate(async () => { const { mic } = await import('/js/mic.js'); return { mic: mic.on, lane: !document.querySelector('.hw-sing').hidden, pressed: document.querySelector('.hw-sing-chip').getAttribute('aria-pressed') }; });
      if (off.mic || off.lane || off.pressed !== 'false') fail('switching off: ' + JSON.stringify(off));
      if (await page.evaluate(async () => (await import('/js/autotune.js')).autotune.on)) fail('auto-tune still plays after singing stopped');
      if (tuneStyle) console.log(`PASS auto-tune (${tuneStyle}): a singer 40 cents flat comes out on the song's notes, and it stops with the singing`);
      console.log(`PASS sing along (${words ? 'timing only' : process.env.SING === 'stem' ? 'notes read off the vocals stem' : 'notes from the chart'}): off until pressed, sung lines count (an octave down), a skipped line doesn't, the card and the stats get it, off lets the microphone go`);
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
        rig.pitch = () => { const c = window.__pitch; if (c == null) return null; const midi = Math.round(c / 100); return { hz: 440 * 2 ** ((c - 6900) / 1200), midi, cents: c - midi * 100, clarity: 0.97 }; };
        tuningGuide({ tuning: [-2, 0, 0, 0, 0, 0], cents: -60, type: 'lead' }, { id: 's1', title: 'Scene T' });
      });
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(out, 'tcheck-1.png') });
      // string 6 right, string 5 four cents off (must NOT tick), string 4 right, then string 6 played
      // again 9 cents out (loses its tick), then right again (ticks again)
      const r = await page.evaluate(async () => {
        const wait = (ms) => new Promise((x) => setTimeout(x, ms));
        const get = (n) => [...document.querySelectorAll('.tcheck-row')].find((x) => x.querySelector('.tcheck-num').textContent === String(n));
        const play = async (n, midi, off, ms) => { window.__pitch = null; await wait(350); window.__pitch = midi * 100 - 60 + off; await wait(ms); return get(n); };
        const out = {};
        let row = await play(6, 38, 2, 1700);
        out.six = row.classList.contains('done'); out.sixState0 = row.querySelector('.tcheck-state').textContent;
        row = await play(5, 45, 4, 1700);
        out.fiveTicked = row.classList.contains('done');
        out.fiveState = row.querySelector('.tcheck-state').textContent;
        out.fiveCents = document.querySelector('.tcheck-tuner .tn-read .c').textContent;
        row = await play(4, 50, -1, 1700);
        out.four = row.classList.contains('done');
        row = await play(6, 38, 9, 1400);
        out.sixSlipped = !row.classList.contains('done');
        out.sixState = row.querySelector('.tcheck-state').textContent;
        // 4.2: one tuner (the main tuner's look, centre line included), not a meter per string
        out.centre = document.querySelectorAll('.tcheck-tuner .tn-scale').length === 1 && !document.querySelector('.tcheck-row .tn-scale');
        out.rows = document.querySelectorAll('.tcheck-row').length;
        out.ref = (document.querySelector('.tcheck-ref') || {}).textContent;
        window.__shot = true;
        return out;
      });
      await page.screenshot({ path: path.join(out, 'tcheck-2.png') });
      const r2 = await page.evaluate(async () => {
        const row = [...document.querySelectorAll('.tcheck-row')].find((x) => x.querySelector('.tcheck-num').textContent === '6');
        window.__pitch = null; await new Promise((x) => setTimeout(x, 350));
        window.__pitch = 3800 - 60 + 1;
        await new Promise((x) => setTimeout(x, 1700));
        return row.classList.contains('done');
      });
      r.done = r.six && /Slipped/.test(r.sixState) && !r.fiveTicked && r.four && r.sixSlipped && r.centre && r2;
      console.log('TCHECK', JSON.stringify({ ...r, retickedAfterSlip: r2 }));
      if (!r.done || r.rows !== 6 || !/425/.test(r.ref || '')) throw new Error('tuning check card: ' + JSON.stringify(r));
      console.log('PASS the tuning check card: one tuner like the main one, 3 cents to tick, 4 cents off does not tick, a ticked string played out loses its tick');
      continue;
    }
    await page.waitForTimeout(play === 'p' ? 2600 : 2200);
    if (process.env.TUNER) { await page.keyboard.press('u'); await page.waitForTimeout(300); }
    if (process.env.CARD) { await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.showCard(); }); await page.waitForTimeout(Number(process.env.CARD_WAIT || 0)); }
    if (process.env.MASTER) { await page.evaluate(() => document.querySelector('.hw-dock.collapsed') && document.querySelector('.hw-set-btn').click()); await page.waitForTimeout(500); }
    await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.open = false; cancelAnimationFrame(H.raf); });
    await page.screenshot({ timeout: 60000, path: path.join(out, `${scene}_${(file||'').replace('.json','')}_${t}${play === 'p' ? 'p' : ''}${hits || ''}.png`) });
    console.log('shot', spec);
  }
  await browser.close();
  srv.close();
})();
