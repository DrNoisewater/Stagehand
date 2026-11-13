/** 4.16: the headset's highway, drawn in Chromium (software graphics) on a real chart (Sugar).
 *   node test/e2e/quest-vr.js <outDir>
 * The real server with a pretend PC playing the song; the headset page pairs, gets the part,
 * draws the preview, then "goes into VR" with a pretend WebXR (two eyes side by side) and the
 * trigger pauses the PC. Writes quest-vr-*.png and ends with "all passed". */
const path = require('path');
const fs = require('fs');
const { Companion } = require('../../src/main/services/companion');
const { merge } = require('../../src/main/services/settings');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = path.join(__dirname, '..', '..');
const out = process.argv[2] || '/tmp/quest-vr';
fs.mkdirSync(out, { recursive: true });
const sugar = require('../hwlook/sugar.json');
const results = [];
const check = (ok, what) => (results.push({ ok, what }), console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`));
const nowMs = () => performance.timeOrigin + performance.now();

(async () => {
  let data = { on: true, port: 0, code: '2468', devices: [], cert: null };
  const lead = { ...sugar.lead, id: 'L1', lyrics: [{ t: 22.0, d: 0.4, w: 'Sugar' }, { t: 22.5, d: 0.4, w: 'we’re' }, { t: 23, d: 0.4, w: 'going' }, { t: 23.5, d: 0.6, w: 'down+' }] };
  const song = { id: 'sugar', title: 'Sugar', artist: 'System of a Down', album: 'System of a Down', year: 1998, length: 156.8, arrangements: [{ id: 'L1', type: 'lead', name: 'Lead' }, { id: 'B1', type: 'bass', name: 'Bass' }] };
  const commands = [];
  const c = new Companion({
    pageDir: path.join(ROOT, 'src', 'companion'),
    fontDir: path.join(ROOT, 'src', 'renderer', 'fonts'),
    venueDir: path.join(ROOT, 'src', 'renderer', 'venues'),
    store: { get: () => data, set: (p) => (data = merge(data, p)) },
    port: 0,
    host: '127.0.0.1',
    songs: () => [song],
    loadTab: async (id, arr) => (arr === 'B1' ? { ...sugar.bass, id: 'B1' } : lead),
  });
  c.on('command', (m) => commands.push(m));
  await c.start();

  // the pretend PC: Sugar playing from 44 s, on the highway, in the warehouse
  const t0 = nowMs();
  let playing = true, at0 = 44, pausedAt = null;
  const songT = () => (playing ? at0 + (nowMs() - t0) / 1000 : pausedAt);
  let hits = 0, judged = 0;
  const pc = setInterval(() => c.setState({ songId: 'sugar', arrId: 'L1', part: 'lead', t: songT(), at: nowMs(), playing, speed: 1, open: true, dur: 156.8, venue: 'warehouse', score: { acc: judged ? hits / judged : null, streak: hits, hits, judged } }), 33);
  // the PC judges the notes as they pass: all hit but one
  const T = [...lead.notes.map((n) => ({ t: n.t, notes: [{ s: n.s, f: n.f }] })), ...lead.chordEvents.map((ce) => ({ t: ce.t, notes: ce.strings.map((x) => ({ s: x.s, f: x.f })) }))].sort((a, b) => a.t - b.t);
  let next = 0;
  const judge = setInterval(() => {
    const t = songT();
    while (next < T.length && T[next].t < t - 0.02) {
      const hit = judged % 4 !== 1;
      if (T[next].t > 43.5) {
        c.judged({ t: T[next].t, hit, notes: T[next].notes });
        judged++;
        if (hit) hits++;
      }
      next++;
    }
  }, 20);

  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/37.0 Chrome/128.0 VR Safari/537.36' });
  // a pretend WebXR: two eyes side by side on the page's canvas
  await ctx.addInitScript(() => {
    const persp = (fovy, aspect, n, f) => {
      const t = 1 / Math.tan(fovy / 2);
      return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
    };
    const invTranslate = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1]);
    window.__xr = { selects: 0 };
    class FakeLayer {
      constructor(session, gl) {
        this.gl = gl;
        this.framebuffer = null;
      }
      getViewport(view) {
        const c = this.gl.canvas;
        return { x: view.eye === 'left' ? 0 : c.width / 2, y: 0, width: c.width / 2, height: c.height };
      }
    }
    window.XRWebGLLayer = FakeLayer;
    const listeners = {};
    const session = {
      renderState: {},
      inputSources: [],
      updateRenderState(s) {
        Object.assign(this.renderState, s);
      },
      async requestReferenceSpace() {
        return {};
      },
      addEventListener(k, f) {
        (listeners[k] = listeners[k] || []).push(f);
      },
      requestAnimationFrame(cb) {
        return requestAnimationFrame((t) => {
          const c = this.renderState.baseLayer.gl.canvas;
          const aspect = c.width / 2 / c.height;
          const views = ['left', 'right'].map((eye) => ({ eye, projectionMatrix: persp(1.6, aspect, 0.05, 60), transform: { inverse: { matrix: invTranslate(eye === 'left' ? -0.032 : 0.032, 1.6, 0) } } }));
          cb(t, { session: this, getViewerPose: () => ({ views }) });
        });
      },
      async end() {
        (listeners.end || []).forEach((f) => f());
      },
    };
    window.__xr.session = session;
    window.__xr.fire = (k) => (listeners[k] || []).forEach((f) => f({}));
    Object.defineProperty(navigator, 'xr', { value: { isSessionSupported: async () => true, requestSession: async () => session } });
    WebGL2RenderingContext.prototype.makeXRCompatible = async function () {};
  });
  const q = await ctx.newPage();
  const errs = [];
  q.on('pageerror', (e) => errs.push(e.message));
  q.on('console', (m) => m.type() === 'error' && !/404|Failed to load/.test(m.text()) && errs.push(m.text()));
  await q.goto(`https://127.0.0.1:${c.port}/`);
  await q.waitForSelector('#pair:not([hidden])');
  for (const d of '2468') await q.locator('#pad .key', { hasText: new RegExp(`^${d}$`) }).click();
  await q.waitForSelector('#main:not([hidden])');
  // the part arrives and the preview draws
  await q.waitForSelector('#preview:not([hidden])', { timeout: 8000 }).catch(() => {});
  check(!(await q.locator('#preview').isHidden()), 'the part being played reaches the headset and the preview shows');
  await q.waitForTimeout(2500);
  const counts = await q.evaluate(() => window.__companion.vr.stage.counts());
  check(counts.solid > 40, `the highway draws strings, frets and notes (${JSON.stringify(counts)})`);
  const res = await q.evaluate(() => [...window.__companion.vr.V.results.map.values()].map((x) => x.hit));
  check(res.length > 3 && res.includes(true) && res.includes(false), `the PC's hits and misses reach the headset (${res.filter(Boolean).length} hits, ${res.filter((x) => !x).length} misses)`);
  await q.screenshot({ path: path.join(out, 'quest-vr-1-page.png') });
  check(!(await q.locator('#vrBtn').isDisabled()), 'Step onto the stage is offered where VR is');

  // into VR: the canvas fills the window to see both eyes
  await q.locator('#vrBtn').click();
  await q.addStyleTag({ content: '#preview{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:9}' });
  await q.evaluate(() => Object.assign(document.getElementById('preview'), { width: 2560, height: 1600 }));
  await q.waitForTimeout(2500);
  check(await q.evaluate(() => window.__companion.vr.inXR), 'in VR');
  await q.screenshot({ path: path.join(out, 'quest-vr-2-stereo.png') });
  // the trigger: pause on the PC
  await q.evaluate(() => window.__xr.fire('select'));
  await new Promise((r) => setTimeout(r, 300));
  check(commands.some((m) => m.type === 'pause'), 'the trigger pauses the PC');
  await q.evaluate(() => window.__xr.session.end());
  await q.waitForTimeout(300);
  check(!(await q.evaluate(() => window.__companion.vr.inXR)), 'left VR');
  // a bass part too (four strings)
  check(!errs.length, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);

  clearInterval(pc);
  clearInterval(judge);
  await browser.close();
  await c.stop();
  const bad = results.filter((r) => !r.ok);
  console.log(bad.length ? `${bad.length} failed` : 'all passed');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
