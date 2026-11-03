/**
 * Record clip's sound, end to end in Chromium (4.1.2): the real take-video.js,
 * rig.js and audio engine, the real main-process relay and the native sound engine
 * (built with a fake device). A song plays, a clip records, and partway through the
 * sound engine is killed as if it crashed; Stagehand brings it back by itself.
 * The recorded sound must:
 *   - be there from the start and come back after the crash (it used to stay silent
 *     for the rest of the recording: the restarted engine never sent sound again),
 *   - be as long as the recording, with the dropout filled so it stays in step.
 * And a recording must refuse to start when no sound reaches the recorder at all,
 * instead of recording minutes of silence.
 *
 *   node test/e2e/clip-chromium.js <stagehand-audio-fake> <outDir>
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { RigAudio } = require('../../src/main/services/rigaudio');

const ROOT = path.resolve(__dirname, '..', '..');
const [helper, outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-clip-out-'))] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-clip-'));
const results = [];
const check = (ok, msg) => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

function wav16(file, rate, channels, frames, fn) {
  const b = Buffer.alloc(44 + frames * channels * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + frames * channels * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(frames * channels * 2, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) b.writeInt16LE(Math.round(fn(i, c) * 32767), 44 + (i * channels + c) * 2);
  fs.writeFileSync(file, b);
}
const guitarWav = path.join(tmp, 'guitar.wav');
wav16(guitarWav, 48000, 1, 48000 * 4, (i) => 0.2 * Math.sin((2 * Math.PI * 110 * i) / 48000));
const songWav = path.join(tmp, 'song.wav');
wav16(songWav, 48000, 2, 48000 * 40, (i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / 48000));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.wav': 'audio/wav', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = u === '/song.wav' ? songWav : path.join(ROOT, u);
  if (!file.startsWith(ROOT) && file !== songWav) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// node → page: messages batched, one page call in flight at a time, sound as base64
// (one page call per piece, as numbers, is far too slow here and ran out of memory)
class FakePortMain extends EventEmitter {
  constructor(page, id) {
    super();
    this.page = page;
    this.id = id;
    this.batch = [];
    this.busy = false;
  }
  postMessage(msg) {
    this.batch.push(msg && msg.d instanceof Float32Array ? { ...msg, d: null, b64: Buffer.from(msg.d.buffer, msg.d.byteOffset, msg.d.byteLength).toString('base64') } : msg);
    this.pump();
  }
  pump() {
    if (this.busy || !this.batch.length) return;
    this.busy = true;
    const b = this.batch;
    this.batch = [];
    this.page
      .evaluate(([id, b]) => b.forEach((m) => window.__deliver(id, m)), [this.id, b])
      .catch(() => {})
      .finally(() => {
        this.busy = false;
        setTimeout(() => this.pump(), 5);
      });
  }
  start() {}
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.STAGEHAND_AUDIO_HELPER = helper;
  const relay = new RigAudio({ log: (m) => process.env.SH_DEBUG && console.log(`  [main] ${m}`), appRoot: ROOT });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  const ports = new Map();
  await page.exposeBinding('__relay', (_src, id, kind, msg) => {
    const p = ports.get(id);
    if (!p) return;
    if (msg && msg.t === 'song' && Array.isArray(msg.d)) msg = { ...msg, d: Float32Array.from(msg.d) };
    p.emit('message', { data: msg });
  });
  await page.exposeBinding('__open', (_src, id, kind) => {
    const p = new FakePortMain(page, id);
    ports.set(id, p);
    relay.attach(p, kind);
  });
  await page.addInitScript(() => {
    let seq = 0;
    const local = new Map();
    window.__deliver = (id, m) => {
      const port = local.get(id);
      if (!port) return;
      if (m && m.b64) {
        const bin = atob(m.b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        m = { t: m.t, d: new Float32Array(u.buffer) };
      }
      port.postMessage(m);
    };
    const ok = (value) => ({ __sh: true, ok: true, value });
    // the app's side of Record clip: keep what arrives
    window.__clip = { begun: 0, v: 0, a: [], finished: null };
    window.stagehand = {
      rig: {
        available: async () => ok(true),
        connect: async (kind) => {
          const id = ++seq;
          const ch = new MessageChannel();
          local.set(id, ch.port2);
          ch.port2.onmessage = (e) => {
            let m = e.data;
            if (m && m.t === 'song' && m.d) m = { t: 'song', d: Array.from(m.d) };
            window.__relay(id, kind, m);
          };
          await window.__open(id, kind);
          window.postMessage({ type: 'stagehand-rig-port', kind }, '*', [ch.port1]);
        },
      },
      clips: {
        prepare: async () => ok(true),
        source: async () => ok('screen:1'),
        begin: async (meta) => (window.__clip.begun++, (window.__clip.rate = meta.rate), ok('c1')),
        chunk: async (id, kind, data) => {
          if (kind === 'v') window.__clip.v += data.byteLength;
          else window.__clip.a.push(new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
          return ok({ full: false });
        },
        finish: async (id, meta) => ((window.__clip.finished = meta), ok({ path: 'x.mp4', take: { id: 'k_0000000000', name: 'Test' } })),
        cancel: async () => ok(true),
      },
      app: { activity: async () => ok(true) },
    };
    // the window's picture: a moving canvas stands in for the screen capture
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      const g = c.getContext('2d');
      let n = 0;
      setInterval(() => ((g.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`), g.fillRect(0, 0, 320, 180)), 33);
      return c.captureStream(30);
    };
  });
  await page.goto(`${base}/test/e2e/rig-harness.html`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 10000 });

  // the guitar on, a song playing through the sound engine
  const r0 = await page.evaluate(async ([fakeIn, fakeOut]) => {
    const { rig, engine, loadTrackData } = window.__h;
    window.__shFakeAudio = { fakeIn, fakeOut };
    const t = await loadTrackData('/song.wav');
    await engine.reset(t.wav.sampleRate, t.wav.frames);
    engine.loadTrack(0, 'mix', t.buffer, t.wav);
    await rig.autoStart();
    await engine.play();
    return { on: rig.on, kind: rig.kind };
  }, [guitarWav, path.join(tmp, 'out.wav')]);
  check(r0.on && r0.kind === 'native', `the sound engine is running (${JSON.stringify(r0)})`);

  // record: 5 s, then the sound engine crashes; Stagehand brings it back; 5 s more
  await page.evaluate(async () => {
    const { createClipRecorder } = await import('/src/renderer/js/take-video.js');
    window.__rec = createClipRecorder({ rig: window.__h.rig, engine: window.__h.engine, title: () => 'Test' });
    await window.__rec.start();
    window.__t0 = performance.now();
  });
  await new Promise((r) => setTimeout(r, 5000));
  const killedAt = await page.evaluate(() => (performance.now() - window.__t0) / 1000);
  relay.child.kill('SIGKILL');
  let back = false;
  for (let i = 0; i < 40 && !back; i++) {
    await new Promise((r) => setTimeout(r, 250));
    back = await page.evaluate(() => window.__h.rig.on && window.__h.rig.kind === 'native');
  }
  const backAt = await page.evaluate(() => (performance.now() - window.__t0) / 1000);
  check(back, `the sound engine came back by itself after the crash (${backAt.toFixed(1)} s in)`);
  await new Promise((r) => setTimeout(r, 5000));
  const res = await page.evaluate(async () => {
    await window.__rec.stop();
    const c = window.__clip;
    const n = c.a.reduce((s, x) => s + x.length, 0);
    const all = new Int16Array(n);
    let o = 0;
    for (const x of c.a) all.set(x, o), (o += x.length);
    const rate = c.rate;
    const rms = [];
    for (let s = 0; (s + 1) * rate * 2 <= all.length; s++) {
      let e = 0;
      for (let i = s * rate * 2; i < (s + 1) * rate * 2; i++) e += (all[i] / 32768) ** 2;
      rms.push(+Math.sqrt(e / (rate * 2)).toFixed(3));
    }
    const toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent);
    return { rate, soundSecs: all.length / 2 / rate, videoSecs: c.finished && c.finished.seconds, video: c.v, rms, toasts };
  });
  console.log(`  sound per second: ${res.rms.join(' ')}`);
  check(res.video > 0, `the picture was recorded (${res.video} bytes)`);
  check(Math.abs(res.soundSecs - res.videoSecs) < 0.25, `the sound is as long as the recording (${res.soundSecs.toFixed(2)} s of sound, ${res.videoSecs.toFixed(2)} s of video)`);
  const before = res.rms.slice(1, Math.floor(killedAt));
  const after = res.rms.slice(Math.ceil(backAt) + 1, -1);
  check(before.length >= 3 && before.every((x) => x > 0.02), `sound from the start (${before.join(' ')})`);
  check(after.length >= 2 && after.every((x) => x > 0.02), `sound again after the sound engine crashed and came back (${after.join(' ')})`);
  check(res.toasts.some((t) => /Sound dropped out/.test(t)), 'it said on screen, at once, that the sound dropped out');

  // a recording with no sound reaching the recorder must not start
  const refuse = await page.evaluate(async () => {
    const { rig } = window.__h;
    const real = { cap: rig.captureMix, restart: rig.restart };
    rig.captureMix = () => ({ rate: 48000, close() {} }); // the engine says nothing
    rig.restart = async () => {};
    window.__clip.begun = 0;
    const { createClipRecorder } = await import('/src/renderer/js/take-video.js');
    const rec = createClipRecorder({ rig, engine: window.__h.engine, title: () => 'Test' });
    const t0 = performance.now();
    let err = null;
    try {
      await rec.start();
    } catch (e) {
      err = e.message;
    }
    rig.captureMix = real.cap;
    rig.restart = real.restart;
    return { err, begun: window.__clip.begun, active: rec.active, secs: (performance.now() - t0) / 1000 };
  });
  check(refuse.err && /didn’t start/.test(refuse.err) && !refuse.begun && !refuse.active, `no sound reaching the recorder: it doesn't start, and says so within seconds (${refuse.secs.toFixed(1)} s: “${refuse.err}”)`);

  if (results.some((x) => !x)) console.log(logs.filter((l) => /error|warn/i.test(l)).slice(-15).join('\n'));
  await page.evaluate(() => window.__h.rig.stop()).catch(() => {});
  await browser.close();
  relay.quit && relay.quit();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(results.every(Boolean) ? 'all passed' : 'some failed');
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.error('FAIL', e.stack || e.message);
  process.exit(1);
});
