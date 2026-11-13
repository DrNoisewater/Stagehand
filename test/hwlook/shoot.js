// node shoot.js outDir scene:t[:play][:hits] ...
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..', '..', 'src', 'renderer');
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
  await new Promise((r) => srv.listen(8765, r));
  const out = process.argv[2];
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--single-process', '--no-zygote', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 1920), height: Number(process.env.VH || 1080) }, ...(process.env.VIDEO ? { recordVideo: { dir: out, size: { width: 1280, height: 720 } } } : {}) });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message, (e.stack || '').split('\n').slice(1, 3).join(' ')));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  for (const spec of process.argv.slice(3)) {
    const [scene, t, play, hits, file, part] = spec.split(':');
    await page.goto(`http://localhost:8765/?scene=${scene}&t=${t}&play=${play === 'p' ? 1 : 0}&file=${file || ''}&part=${part || ''}${process.env.SING ? `&sing=${process.env.SING}` : ''}`);
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
    if (process.env.SING) {
      // Sing along: a pretend microphone (a tone that follows the song's notes) sings the made-up song.
      // Lines 1 and 2 are sung right (an octave down), line 3 is left out, line 4 is sung right.
      const fail = (m) => { throw new Error('sing: ' + m); };
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
        setInterval(() => {
          const t = window.__stage.engine.position;
          const i = ly.findIndex((x) => t >= x.t && t < x.t + x.d);
          const on = i >= 0 && lineOf[i] !== window.__skipLine && window.__stage.engine.playing;
          gain.gain.value = on ? 0.3 : 0;
          if (on) osc.frequency.value = 440 * 2 ** ((window.__singTune[i] - 12 - 69) / 12);
        }, 4);
        const chip = document.querySelector('.hw-sing-chip');
        return { chip: !!chip && !chip.hidden, pressed: chip && chip.getAttribute('aria-pressed'), lane: !document.querySelector('.hw-sing').hidden, lyrics: !!document.querySelector('.hw-lyrics'), ctx: ac.state };
      });
      if (!st0.chip || st0.pressed !== 'false' || st0.lane) fail('before pressing Sing: ' + JSON.stringify(st0));
      await page.waitForTimeout(600);
      if (await page.evaluate(() => window.__micAsked)) fail('the microphone was opened before Sing was pressed');
      await page.screenshot({ path: path.join(out, 'sing-0-off.png') });
      const kar = process.env.SING === 'karaoke';
      // the chip asks which kind: beside the guitar part, or karaoke
      await page.click('.hw-sing-chip');
      await page.click(`.menu[role="menu"] button:has-text("${kar ? 'Karaoke' : 'Sing along'}")`);
      await page.waitForFunction(() => !document.querySelector('.hw-sing').hidden && document.querySelector('.highway').__hw.sing.active, null, { timeout: 8000 });
      const words = process.env.SING === 'words';
      // the song starts once the microphone is open and hearing (opening it takes a moment)
      await page.evaluate(async () => { const { mic } = await import('/js/mic.js'); for (let i = 0; i < 100 && !mic.on; i++) await new Promise((x) => setTimeout(x, 100)); await new Promise((x) => setTimeout(x, 400)); });
      if (process.env.SING === 'stem') await page.waitForFunction(() => document.querySelector('.highway').__hw.sing.state.mode === 'stem', null, { timeout: 30000 });
      await page.evaluate(() => { const e = window.__stage.engine; e.position = 1.5; e.dispatchEvent(new Event('seek')); e.play(); });
      const until = (t) => page.waitForFunction((t) => window.__stage.engine.position > t, t, { timeout: 60000 });
      await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; f(); });
      await until(4.6);
      if (kar) {
        const k = await page.evaluate(() => ({ cls: document.querySelector('.highway').classList.contains('hw-karaoke'), big: document.querySelector('.hw-sing').dataset.k, muted: window.__vocals.muted, chip: document.querySelector('.hw-sing-chip').textContent, guitar: window.__shHighway.judge() }));
        if (!k.cls || k.big !== '1' || !k.muted || !/Karaoke/.test(k.chip) || k.guitar) fail('karaoke on: ' + JSON.stringify(k));
      }
      await page.screenshot({ path: path.join(out, 'sing-1-bars.png') });
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
        // back to singing beside the guitar: the neck returns and the singer is put back
        const k2 = await page.evaluate(async () => {
          const H = document.querySelector('.highway').__hw;
          H.sing.turn(true, false);
          await new Promise((x) => setTimeout(x, 300));
          return { cls: document.querySelector('.highway').classList.contains('hw-karaoke'), big: document.querySelector('.hw-sing').dataset.k, muted: window.__vocals.muted, on: H.sing.active };
        });
        if (k2.cls || k2.big || k2.muted || !k2.on) fail('leaving karaoke: ' + JSON.stringify(k2));
      }
      await page.screenshot({ path: path.join(out, 'sing-4-card.png') });
      const log = r.logs.find((x) => x.part === 'vocals');
      if (words) {
        if (r.mode !== 'rhythm') fail('a song with no notes should be scored on timing only: ' + r.mode);
        if (!(r.lines[0] >= 0.7 && r.lines[1] >= 0.7 && r.lines[2] <= 0.15 && r.lines[3] >= 0.85)) fail('timing-only lines: ' + JSON.stringify(r.lines));
      } else {
        if (r.mode !== (process.env.SING === 'stem' ? 'stem' : 'charted')) fail('mode ' + r.mode);
        if (!(r.lines[0] >= 0.7 && r.lines[1] >= 0.7 && r.lines[2] === 0 && r.lines[3] >= 0.85)) fail('lines: ' + JSON.stringify(r.lines));
      }
      if (r.asked !== 1) fail('the microphone was asked for ' + r.asked + ' times');
      if (!r.card || !/sung|Singing/.test(r.cardText)) fail('no singing on the score card: ' + r.cardText);
      if (!log || log.notes !== r.judged || !(log.accuracy > 0.6 && log.accuracy < 0.85) || !log.full) fail('stats: ' + JSON.stringify(r.logs));
      // switching it off lets the microphone go and brings the plain lyrics back
      await page.evaluate(() => document.querySelector('.highway').__hw.sing.turn(false));
      const off = await page.evaluate(async () => { const { mic } = await import('/js/mic.js'); return { mic: mic.on, lane: !document.querySelector('.hw-sing').hidden, pressed: document.querySelector('.hw-sing-chip').getAttribute('aria-pressed') }; });
      if (off.mic || off.lane || off.pressed !== 'false') fail('switching off: ' + JSON.stringify(off));
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
    if (process.env.MASTER) { await page.evaluate(() => document.querySelector('.hw-dock.collapsed .hw-dock-tab') && document.querySelector('.hw-dock-tab').click()); await page.waitForTimeout(500); }
    await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.open = false; cancelAnimationFrame(H.raf); });
    await page.screenshot({ timeout: 60000, path: path.join(out, `${scene}_${(file||'').replace('.json','')}_${t}${play === 'p' ? 'p' : ''}${hits || ''}.png`) });
    console.log('shot', spec);
  }
  await browser.close();
  srv.close();
})();
