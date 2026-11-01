/**
 * Guitar rig, end to end in Chromium (no Electron needed):
 *   page (rig.js, audio-engine.js, worklets, WebAssembly)
 *     ⇄ mock preload (MessagePorts) ⇄ RigAudio (real main-process relay)
 *     ⇄ stagehand-audio-fake (native host with a fake device)
 *
 *   node test/e2e/rig-chromium.js <stagehand-audio-fake> <outDir>
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { RigAudio } = require('../../src/main/services/rigaudio');

const ROOT = path.resolve(__dirname, '..', '..');
const [helper, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-rig-'));
const results = [];
const check = (ok, msg) => {
  results.push({ ok: !!ok, msg });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

/* ---------------------------------------------------------- test audio -- */
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
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(fn(i, c) * 32767))), 44 + (i * channels + c) * 2);
  fs.writeFileSync(file, b);
}
// guitar: an open A (110 Hz) plucked every second, Karplus-Strong
const guitarWav = path.join(tmp, 'guitar.wav');
{
  const rate = 48000;
  const out = new Float32Array(rate * 4);
  let seed = 3;
  for (let k = 0; k < 4; k++) {
    const L = Math.round(rate / 110);
    const buf = new Float32Array(L).map(() => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1);
    let p = 0;
    for (let i = k * rate; i < (k + 1) * rate; i++) {
      const y = buf[p];
      const q = (p + 1) % L;
      buf[p] = 0.4985 * (y + buf[q]);
      p = q;
      out[i] = y * 0.3;
    }
  }
  wav16(guitarWav, rate, 1, out.length, (i) => out[i]);
}
// song: 440 Hz sine, stereo 48 kHz, 8 s
const songWav = path.join(tmp, 'song.wav');
wav16(songWav, 48000, 2, 48000 * 8, (i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / 48000));

/* -------------------------------------------------------------- server -- */
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

/* ---------------------------------------------------- page ⇄ node ports -- */
class FakePortMain extends EventEmitter {
  constructor(page, id) {
    super();
    this.page = page;
    this.id = id;
    this.q = Promise.resolve();
  }
  postMessage(msg) {
    const m = msg && msg.d instanceof Float32Array ? { ...msg, d: Array.from(msg.d) } : msg;
    this.q = this.q.then(() => this.page.evaluate(([id, m]) => window.__deliver(id, m), [this.id, m]).catch(() => {}));
  }
  start() {}
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.STAGEHAND_AUDIO_HELPER = helper;
  const relay = new RigAudio({ log: (m) => console.log(`  [main] ${m}`), appRoot: ROOT });
  let lastMeters = null;
  const origSend = relay.sendSong.bind(relay);
  let songSq = 0, songN = 0;
  relay.sendSong = (f) => {
    for (const v of f) (songSq += v * v), songN++;
    origSend(f);
  };
  setInterval(() => process.env.SH_DEBUG && songN && console.log(`  [song rms] ${Math.sqrt(songSq / songN).toFixed(4)} over ${songN}`), 1000).unref();
  relay.on('event', (ev) => {
    if (ev.ev === 'meters') lastMeters = ev;
    else if (ev.ev !== 'built') console.log(`  [helper] ${JSON.stringify(ev).slice(0, 200)}`);
  });
  setInterval(() => lastMeters && process.env.SH_DEBUG && console.log('  [meters]', JSON.stringify(lastMeters)), 1000).unref();
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${guitarWav}`],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  const ports = new Map();
  let firstSong = null;
  await page.exposeBinding('__relay', (_src, id, kind, msg) => {
    // SH_DROP_DIRECT: pretend the direct worklet → main route loses everything (as in Electron)
    if (process.env.SH_DROP_DIRECT && kind === 'song') {
      if (firstSong === null) firstSong = id;
      if (id === firstSong) return;
    }
    let p = ports.get(id);
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
      if (m && m.t === 'in' && Array.isArray(m.d)) m = { ...m, d: Float32Array.from(m.d) };
      port.postMessage(m);
    };
    window.stagehand = {
      rig: {
        available: async () => ({ __sh: true, ok: true, value: true }),
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
    };
  });
  await page.goto(`${base}/test/e2e/rig-harness.html`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 10000 });
  const outWav = path.join(tmp, 'out.wav');

  // ------------------------------------------------------------ native --
  const r1 = await page.evaluate(async ([fakeIn, fakeOut, relay]) => {
    const { rig, engine, loadTrackData } = window.__h;
    window.__shFakeAudio = { fakeIn, fakeOut };
    if (relay) engine.relayMode = true;
    const t = await loadTrackData('/song.wav');
    await engine.reset(t.wav.sampleRate, t.wav.frames);
    engine.loadTrack(0, 'mix', t.buffer, t.wav);
    const ok = await rig.start();
    const info = { ok, kind: rig.kind, latency: rig.latencyMs, error: rig.error, notice: rig.notice, mode: rig.info && rig.info.mode, rate: rig.sampleRate };
    rig.setTone('metal');
    await rig._busy;
    await engine.play();
    const p0 = engine.position;
    await new Promise((r) => setTimeout(r, 3000));
    const p1 = engine.position;
    const lv = rig.levels();
    const buf = new Float32Array(8192);
    rig.samples(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    let pitch = null;
    for (let i = 0; i < 20 && !pitch; i++) {
      pitch = rig.pitch();
      await new Promise((r) => setTimeout(r, 30));
    }
    return { ...info, relayMode: engine.relayMode, routed: !!engine.native, extra: engine.extraLatency, advanced: p1 - p0, levels: lv, inputPeak: peak, pitch, slots: rig.slots.filter(Boolean).length, active: rig.active };
  }, [guitarWav, outWav, !!process.env.SH_RELAY]);
  console.log('  native:', JSON.stringify(r1));
  console.log(`  [main] song audio relayed: ${relay.songBytes} bytes`);
  check(r1.ok && r1.kind === 'native', `native engine started (${r1.mode}, ${r1.latency} ms, ${r1.rate} Hz)`);
  check(r1.routed && r1.extra > 0.03 && r1.extra < 0.15, `song routed to the native engine, ${Math.round(r1.extra * 1000)} ms accounted for`);
  check(r1.advanced > 2.6 && r1.advanced < 3.4, `song clock runs in time (${r1.advanced.toFixed(2)} s in 3 s)`);
  check(r1.inputPeak > 0.05, `guitar input reaches the page for the tuner and scoring (peak ${r1.inputPeak.toFixed(3)})`);
  check(r1.levels.output > 0.01, `amp output metered (${r1.levels.output.toFixed(3)})`);
  check(r1.pitch && Math.abs(r1.pitch.hz - 110) < 2, `tuner reads the open A through the native engine (${r1.pitch && r1.pitch.hz.toFixed(2)} Hz)`);
  check(r1.slots >= 1 && r1.active >= 0, 'metal preset built and selected');

  // song tone from a real manifest-style gear list, then knobs
  const r2 = await page.evaluate(async () => {
    const { rig } = window.__h;
    const tone = {
      kind: 'guitar',
      key: 'lead',
      name: 'Lead',
      preset: 'crunch',
      gear: [
        { slot: 'amp', order: 0, key: 'Amp_OrangeAD50', knobs: { Amp_OrangeAD50_Gain: 60, Amp_OrangeAD50_Mid: 85 } },
        { slot: 'cab', order: 0, key: 'Cab_OrangePPC212OB_Condenser_Cone', knobs: {} },
        { slot: 'post', order: 1, key: 'Pedal_SpringReverb', knobs: { Pedal_SpringReverb_Mix: 20 } },
        { slot: 'rack', order: 1, key: 'Rack_StudioEQ', knobs: { Rack_StudioEQ_Bass: -2 } },
      ],
    };
    rig.setSongTone(tone);
    await rig._busy;
    rig.setKnob('gain', 0.9);
    rig.setKnob('treble', 0.7);
    await new Promise((r) => setTimeout(r, 400));
    return { mode: rig.mode, active: rig.active, slots: rig.slots.filter(Boolean).length, out: rig.levels().output };
  });
  check(r2.mode === 'song' && r2.slots >= 2, `song tone (Orange AD50 → 2x12 → spring → studio EQ) built (${r2.slots} tones ready)`);
  check(r2.out > 0.01, 'still sounding after tone switch and knob moves');

  // a bass is heard while a guitar song tone is chosen: a bass tone plays instead, the song tone stays chosen
  const rb = await page.evaluate(async () => {
    const { rig } = window.__h;
    const { instrumentShift } = await import('/src/renderer/js/detect.js');
    const slotBefore = rig.active;
    rig.setSongTuning([0, 0, 0, 0, 0, 0], 'guitar');
    rig.sense.instrument = 'bass';
    rig._instrumentChanged(true);
    await rig._busy;
    await new Promise((r) => setTimeout(r, 300));
    const bass = { standIn: rig.standIn && rig.standIn.id, mode: rig.mode, chosen: rig.tone.name, shift: instrumentShift.st, changed: rig.active !== slotBefore, out: rig.levels().output };
    rig.holdTone();
    await rig._busy;
    const held = { standIn: rig.standIn, active: rig.active === slotBefore };
    rig.sense.instrument = 'guitar';
    rig._instrumentChanged(true);
    await rig._busy;
    const back = { standIn: rig.standIn, shift: instrumentShift.st, hold: rig._holdFor };
    return { bass, held, back };
  });
  check(rb.bass.standIn === 'bass-clean' && rb.bass.mode === 'song' && rb.bass.chosen === 'Lead' && rb.bass.changed && rb.bass.out > 0.01, `bass heard: Bass clean plays in place of the guitar song tone (${JSON.stringify(rb.bass)})`);
  check(rb.bass.shift === -12, 'bass on a guitar part: scored an octave down');
  check(rb.held.standIn === null && rb.held.active, '"Keep my tone" goes back to the chosen tone');
  check(rb.back.standIn === null && rb.back.shift === 0 && rb.back.hold === null, 'guitar again: nothing stands in, scoring back to normal');

  // calibration
  const r3 = await page.evaluate(async () => {
    const { rig } = window.__h;
    return rig.calibrate(1.5);
  });
  check(r3 && r3.input > 0 && r3.input < 1, `calibration set the input level (${r3 && r3.peakDb.toFixed(1)} dBFS peak → knob ${r3 && r3.input.toFixed(2)})`);

  await page.evaluate(() => window.__h.rig.stop());
  await new Promise((r) => setTimeout(r, 600));
  const back = await page.evaluate(() => !window.__h.engine.native);
  check(back, 'song goes back to the normal output when the guitar is turned off');

  // the fake device recorded what the speakers would have played
  const out = fs.existsSync(outWav) ? fs.readFileSync(outWav) : null;
  if (out && out.length > 44) {
    const f = new Float32Array(out.buffer.slice(out.byteOffset + 44, out.byteOffset + out.length - ((out.length - 44) % 8)));
    const L = [];
    for (let i = 0; i < f.length; i += 2) L.push(f[i]);
    // 440 Hz (song) present? Goertzel over 1 s in the middle
    const g = (hz, a, n) => {
      let c = 0,
        s = 0;
      for (let i = a; i < a + n; i++) (c += L[i] * Math.cos((2 * Math.PI * hz * i) / 48000)), (s += L[i] * Math.sin((2 * Math.PI * hz * i) / 48000));
      return Math.sqrt(c * c + s * s) / n;
    };
    const mid = Math.min(L.length - 48000, 48000 * 2);
    const song = g(440, mid, 48000);
    let rms = 0;
    for (let i = mid; i < mid + 48000; i++) rms += L[i] * L[i];
    rms = Math.sqrt(rms / 48000);
    check(song > 0.02, `speakers got the song (440 Hz at ${song.toFixed(3)})`);
    check(rms > song * 1.2, `speakers got the guitar on top (total rms ${rms.toFixed(3)})`);
    fs.copyFileSync(outWav, path.join(outDir, 'native-out.wav'));
  } else check(false, 'fake device recorded output');

  // --------------------------------------------------------------- web --
  const r4 = await page.evaluate(async () => {
    const { rig } = window.__h;
    rig.engineChoice = 'web';
    const ok = await rig.start();
    rig.setTone('lead');
    await rig._busy;
    await new Promise((r) => setTimeout(r, 1500));
    const lv = rig.levels();
    let pitch = null;
    for (let i = 0; i < 30 && !pitch; i++) {
      pitch = rig.pitch();
      await new Promise((r) => setTimeout(r, 30));
    }
    const res = { ok, kind: rig.kind, error: rig.error, levels: lv, pitch, slots: rig.slots.filter(Boolean).length };
    rig.stop();
    return res;
  });
  console.log('  web:', JSON.stringify(r4));
  check(r4.ok && r4.kind === 'web', 'in-app engine (WebAssembly) starts on a fake microphone');
  check(r4.levels.output > 0.005, `in-app engine makes sound (${r4.levels.output.toFixed(3)})`);
  check(r4.pitch && Math.abs(r4.pitch.hz - 110) < 2, `tuner on the in-app engine (${r4.pitch && r4.pitch.hz.toFixed(2)} Hz)`);

  // ---------------------------------------------- every gear item builds --
  const r5 = await page.evaluate(async () => {
    const { loadGear, toSpec } = window.__h;
    const db = await loadGear();
    const mod = await WebAssembly.compile(await (await fetch('/src/renderer/worklets/rig-dsp.wasm')).arrayBuffer());
    const x = new WebAssembly.Instance(mod, {}).exports;
    const need = x.mem_needed();
    if (need > x.memory.buffer.byteLength) x.memory.grow(Math.ceil((need - x.memory.buffer.byteLength) / 65536));
    x.init(48000);
    const bad = [];
    let n = 0;
    const inb = () => new Float32Array(x.memory.buffer, x.buf_in(), 512);
    for (const [key, g] of Object.entries(db)) {
      if (g.t === 'cab' && !/_57_Cone$|^Cab_[A-Za-z]+$|^Cab_PA/.test(key)) continue;
      const bass = /^Bass_/.test(key) || g.b;
      const gear = g.t === 'amp' ? [{ slot: 'amp', key }] : g.t === 'cab' ? [{ slot: 'amp', key: bass ? 'Bass_Amp_BT600B' : 'Amp_TW22' }, { slot: 'cab', key }] : [{ slot: g.t === 'rack' ? 'rack' : 'pre', key }, { slot: 'amp', key: 'Amp_TW22' }];
      const spec = toSpec({ kind: bass ? 'bass' : 'guitar', gear });
      const bytes = new TextEncoder().encode(spec + '\0');
      new Uint8Array(x.memory.buffer, x.buf_spec(), 16384).set(bytes);
      const slot = n % 2;
      const ok = x.build(slot);
      x.select(slot);
      // run 0.2 s of a pluck and look for NaN / silence / blow-ups
      let peak = 0,
        nan = false;
      for (let b = 0; b < 19; b++) {
        const a = inb();
        for (let i = 0; i < 512; i++) a[i] = b === 0 && i < 64 ? 0.4 * Math.sin(i * 0.3) : (Math.random() - 0.5) * 0.02;
        x.process(512);
        const L = new Float32Array(x.memory.buffer, x.buf_l(), 512);
        for (const v of L) {
          if (!Number.isFinite(v)) nan = true;
          peak = Math.max(peak, Math.abs(v));
        }
      }
      if (!ok || nan || peak > 1.0) bad.push({ key, ok: !!ok, nan, peak: +peak.toFixed(3) });
      n++;
    }
    return { n, bad };
  });
  check(r5.bad.length === 0, `every Rocksmith amp, pedal, rack and cabinet builds and plays cleanly (${r5.n} items${r5.bad.length ? `; bad: ${JSON.stringify(r5.bad.slice(0, 8))}` : ''})`);

  const errs = logs.filter((l) => /^(error|pageerror)/.test(l));
  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  fs.writeFileSync(path.join(outDir, 'rig-chromium.log'), logs.join('\n'));
  await browser.close();
  relay.quit();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
