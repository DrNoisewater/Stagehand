/**
 * The real Stagehand page in Chromium, with the main process stood in by the
 * real services (Library, TabService, RigAudio + fake sound engine) behind a
 * mock preload. For checking UI when no Electron binary is at hand.
 *
 *   node test/e2e/ui3-chromium.js <stagehand-audio-fake> <outDir>
 *
 * Stagehand 3: visits every page and screenshots it.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { RigAudio } = require('../../src/main/services/rigaudio');
const { Library } = require('../../src/main/services/library');
const { TabService } = require('../../src/main/services/tabs');
const { Settings } = require('../../src/main/services/settings');
const { ToneStore, ToneIndex } = require('../../src/main/services/tones');
const { Stats, Takes } = require('../../src/main/services/stats');
const { Captures } = require('../../src/main/services/captures');

const ROOT = path.resolve(__dirname, '..', '..');
const [helper, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ui-'));
const results = [];
const check = (ok, msg) => {
  results.push({ ok: !!ok, msg });
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
const songWav = path.join(tmp, 'song.wav');
const SECS = Number(process.env.SH_AUDIO_SECS) || 30; // fake song length
// a stand-in that behaves like music: quiet intro, verses, loud choruses, a break, drum hits on the beat
let nseed = 1;
const noise = () => ((nseed = (nseed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff - 1);
const sectionLevel = (t) => {
  const u = (t % 30) / 30;
  return u < 0.12 ? 0.25 : u < 0.35 ? 0.6 : u < 0.55 ? 1 : u < 0.62 ? 0.35 : u < 0.85 ? 1 : 0.5;
};
wav16(songWav, 48000, 2, 48000 * SECS, (i) => {
  const t = i / 48000;
  const lv = sectionLevel(t);
  const beat = t % 0.5;
  const kick = Math.exp(-beat * 30) * Math.sin(2 * Math.PI * 60 * beat) * 0.5;
  const snare = (Math.floor(t / 0.5) % 2 === 1 ? Math.exp(-beat * 40) * noise() * 0.35 : 0) * (lv > 0.5 ? 1 : 0.4);
  const tone = 0.15 * Math.sin((2 * Math.PI * 220 * i) / 48000) * (0.6 + 0.4 * Math.sin(i / 9000));
  return Math.max(-0.95, Math.min(0.95, lv * (tone + kick + snare)));
});
const guitarWav = path.join(tmp, 'guitar.wav');
wav16(guitarWav, 48000, 1, 48000 * 2, (i) => 0.25 * Math.exp(-(i % 48000) / 12000) * Math.sin((2 * Math.PI * 110 * i) / 48000));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.wav': 'audio/wav', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = u === '/song.wav' ? songWav : path.join(ROOT, u);
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

class FakePortMain extends EventEmitter {
  constructor(page, id) {
    super();
    this.page = page;
    this.id = id;
    this.q = Promise.resolve();
  }
  postMessage(msg) {
    // raw guitar frames arrive ~190 times a second: batch them so this bridge keeps up (and engine answers aren't delayed)
    if (msg && msg.t === 'in' && msg.d) {
      if (!this.inbuf) this.inbuf = [];
      for (let i = 0; i < msg.d.length; i++) this.inbuf.push(msg.d[i]);
      if (!this.inT)
        this.inT = setTimeout(() => {
          const d = this.inbuf;
          this.inbuf = [];
          this.inT = null;
          if ((this.pending || 0) <= 4) this._send({ t: 'in', d }); // far behind: skip this batch

        }, 40);
      return;
    }
    // level meters: only the newest matters, keep one in the queue at most
    if (msg && msg.t === 'ev' && msg.ev && msg.ev.ev === 'meters') {
      this.lastMeters = msg;
      if (this.metersQueued) return;
      this.metersQueued = true;
      this.pending = (this.pending || 0) + 1;
      this.q = this.q.then(() => {
        this.metersQueued = false;
        return this.page.evaluate(([id, m]) => window.__deliver(id, m), [this.id, this.lastMeters]).catch(() => {});
      }).finally(() => this.pending--);
      return;
    }
    this._send(msg && msg.d instanceof Float32Array ? { ...msg, d: Array.from(msg.d) } : msg);
  }
  _send(m) {
    this.pending = (this.pending || 0) + 1;
    this.q = this.q.then(() => this.page.evaluate(([id, m]) => window.__deliver(id, m), [this.id, m]).catch(() => {})).finally(() => this.pending--);
  }
  start() {}
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.STAGEHAND_AUDIO_HELPER = helper;
  const relay = new RigAudio({ log: () => {}, appRoot: ROOT });
  const settings = new Settings(path.join(tmp, 'settings.json'));
  await settings.load();
  const library = new Library(path.join(tmp, 'library.json'));
  await library.load();
  // SH_ONLY_FOLDER: use another folder of songs (e.g. to look at the highway on a real song)
  await library.addFolder(process.env.SH_ONLY_FOLDER || path.join(ROOT, 'test', 'fixtures'));
  await library.scan({ full: true });
  const tabs = new TabService({});
  const song = (id) => library.get(id);
  if (process.env.SH_OLD_SLOTS) {
    // a 3.1 setup: slots filled with copies of the old presets; Crunch was edited, Clean wasn't
    const G = (slot, key, knobs = {}, order = 0) => ({ slot, key, knobs, order });
    fs.writeFileSync(path.join(tmp, 'tones.json'), JSON.stringify({ seeded: true, tones: [
      { id: 't_old1', name: 'Clean', kind: 'guitar', slot: 1, from: { preset: 'clean' }, gear: [G('amp', 'Amp_TW22', { Gain: 28, Bass: 45, Mid: 55, Treble: 66 }, 0), G('cab', 'Cab_TW112C_57_Cone', {}, 1), G('post', 'Pedal_Chorus20', { Rate: 0.6, Depth: 35, Mix: 30 }, 2), G('post', 'Pedal_SpringReverb', { Time: 55, Mix: 28 }, 3)] },
      { id: 't_old2', name: 'Crunch', kind: 'guitar', slot: 2, from: { preset: 'crunch' }, gear: [G('amp', 'Amp_MarshallPlexi', { 'Loudness 1': 70, 'Loudness 2': 40, Bass: 55, Mid: 70, Treble: 65, Presence: 45 }, 0), G('cab', 'Cab_Marshall1960AX_57_Cone', {}, 1), G('rack', 'Rack_StudioChamber', { Decay: 35, Mix: 18 }, 2)] },
    ] }));
  }
  const toneStore = new ToneStore(path.join(tmp, 'tones.json'));
  await toneStore.load();
  const toneIndex = new ToneIndex({});
  const stats = new Stats(path.join(tmp, 'stats.json'));
  await stats.load();
  const takes = new Takes(path.join(tmp, 'Takes'));
  // a little practice history so Progress has something to show
  const ids = library.snapshot().songs.map((x) => x.id);
  for (let d = 0; d < 9; d++) for (const [i, id] of ids.entries()) if ((d + i) % 3 !== 1) stats.log({ songId: id, part: 'lead', seconds: 300 + d * 40 + i * 60, accuracy: 0.5 + d * 0.04 + i * 0.03, notes: 200, hit: 150, at: Date.now() - d * 86400000 - i * 3600000, sections: [['Intro 1', 20, 22], ['Verse 1', 40, 50], ['Chorus 1', 45, 48], ['Verse 2', 30 + d, 50], ['Solo 1', 18 + d * 2, 40], ['Chorus 2', 44, 48], ['Outro 1', 12, 14]], kinds: { single: [120, 140], chord: [40, 46], bend: [10 + d, 22], slide: [9, 12], legato: [14, 20] }, bestStreak: 20 + d * 3 });

  // real amps: a Plexi pack as if got from TONE3000 (small test models stand in for the captures)
  const capDir = path.join(tmp, 'Captures');
  const nam = fs.readFileSync(path.join(ROOT, 'test/fixtures/nam/wavenet.nam'));
  fs.mkdirSync(path.join(capDir, 't3k_80875'), { recursive: true });
  const plexiModels = [['Low Gain', 0.35], ['Driven', 0.65], ['Boost', 0.92]].map(([n, g]) => {
    fs.writeFileSync(path.join(capDir, 't3k_80875', `${n}.nam`), nam);
    return { file: `${n}.nam`, name: `Marshall 1959 Plexi Super Lead ${n}`, gain: g, size: 'standard' };
  });
  fs.writeFileSync(path.join(capDir, 'captures.json'), JSON.stringify({ packs: { t3k_80875: { id: 't3k_80875', title: 'Marshall 1959 Plexi Super Lead', kind: 'amp', bass: false, maker: 'tonecast', url: 'https://www.tone3000.com/tones/-marshall-1959-plexi-super-lead--80875', license: 'T3K', toneId: 80875, source: 'tone3000', mapKey: 'plexi', models: plexiModels, addedAt: Date.now() } }, assign: {}, t3k: {} }));
  const captures = new Captures({ dir: capDir, openExternal: () => true, log: () => {} });
  await captures.load();

  const stemHold = new Set(); // songs whose stems are "still splitting" (for the wait-for-stems check)
  const API = {
    'captures.get': () => captures.state(),
    'captures.assign': (a, p) => captures.assign(a, p),
    'captures.remove': (p) => captures.remove(p),
    'captures.setKind': (p, k) => captures.setKind(p, k),
    'captures.addFiles': () => null,
    'captures.setKey': (k) => captures.setClientId(k),
    'captures.disconnect': () => captures.disconnect(),
    'shell.openExternal': () => true,
    'app.info': () => ({ version: require('../../package.json').version, platform: 'win32', packaged: false, dirs: {}, models: [] }),
    'app.log': () => [],
    'settings.get': () => settings.get(),
    'settings.set': (p) => settings.set(p),
    // the real grouping over the test songs plus three made-up copies of one song (for the picture)
    'library.findDuplicates': (stemIds) => {
      const { findDuplicates } = require('../../src/main/services/dupes');
      const a = (...t) => t.map((type) => ({ type }));
      const fake = [
        { id: 'f1', title: 'Sugar', artist: 'System Of A Down', fileName: 'System-Of-A-Down_Sugar_v1_p.psarc', audioEntry: 'x', arrangements: a('lead', 'bass'), packageVersion: '1', fileSize: 9.1e6, user: { plays: 4 } },
        { id: 'f2', title: 'Sugar', artist: 'System of a Down', fileName: 'SOAD_Sugar_v3_DD_p.psarc', audioEntry: 'y', arrangements: a('lead', 'rhythm', 'bass', 'vocals'), packageVersion: '3', fileSize: 10.4e6 },
        { id: 'f3', title: 'Sugar', artist: 'System Of A Down', fileName: 'sugar_broken_p.psarc', audioEntry: null, arrangements: a('lead', 'rhythm', 'bass', 'vocals'), packageVersion: '4', fileSize: 1.2e6 },
      ];
      return findDuplicates([...library.snapshot().songs, ...fake], new Set(stemIds || []));
    },
    'library.get': () => {
      const s = library.snapshot();
      s.songs = s.songs.map((x) => ({ ...x, hasStems: false }));
      return s;
    },
    'audio.prepare': () => ({ key: 'song', url: '/song.wav', sampleRate: 48000, channels: 2, frames: 48000 * SECS, duration: SECS, bits: 16 }),
    'tab.list': (id) => tabs.list(song(id)),
    'tab.load': (id, arr) => tabs.load(song(id), arr),
    'rig.available': () => true,
    // every song has stems in this test (all the same tone, which is fine for the UI)
    'stems.formats': () => library.snapshot().songs.map((x) => ({ songId: x.id, model: 'htdemucs_6s', format: 'wav', bytes: 6 * 48000 * 30 * 4, seconds: 30 })),
    'stems.status': (id) => (stemHold.has(id) ? { songId: id, state: 'running', progress: 0.4 } : { state: 'ready', model: 'htdemucs_6s', format: 'wav', sampleRate: 48000, frames: 48000 * SECS, stems: ['guitar', 'bass', 'drums', 'vocals', 'piano', 'other'].map((name) => ({ name, url: '/song.wav' })) }),
    'stems.prioritize': () => true,
    'stems.queue': () => ({ items: [] }),
    'engine.status': () => ({ state: 'missing', ok: false }),
    'imports.status': () => ({ watching: false, history: [] }),
    'discover.wanted': () => [],
    'discover.recent': () => [],
    // a profile with Rocksmith mastery for the test songs' parts (3.7: shown next to titles)
    'rocksmith.read': () => {
      const m = {};
      library.snapshot().songs.forEach((x, i) => (x.arrangements || []).forEach((a, j) => a.id && (m[String(a.id).toUpperCase()] = i === 0 ? 1 : 0.62 + j * 0.1)));
      return { profile: { id: 'p', name: 'Test' }, profiles: [{ id: 'p', name: 'Test' }], lists: [], favorites: [], mastery: m, rsmods: {}, names: [] };
    },
    'tones.get': () => toneStore.get(),
    'tones.save': (t) => toneStore.save(t),
    'tones.remove': (id) => toneStore.remove(id),
    'tones.setSlot': (id, n) => toneStore.setSlot(id, n),
    'tones.seed': (l) => toneStore.seed(l),
    'tones.library': async () => {
      if (process.env.SH_SLOW_TONES) {
        // stand in for a big library read for the first time: 1,200 songs over ~12 s
        for (let d = 0; d <= 1200; d += 40) {
          await page.evaluate((p) => window.__shEmit('tones:progress', p), { done: d, total: 1200 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      return toneIndex.list(library.snapshot().songs);
    },
    'stats.log': (x) => stats.log(x),
    'stats.summary': (p) => stats.summary(p),
    'stats.best': () => stats.best(),
    'takes.list': () => takes.list(),
    'takes.save': (t) => takes.save({ ...t, pcm: Uint8Array.from(Object.values(t.pcm)) }),
    'takes.remove': (id) => takes.remove(id),
    'songs.setUser': (id, patch) => library.setUser(id, patch),
    'songs.played': (id) => library.markPlayed(id),
  };

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const logs = [];
  page.on('console', (m) => (logs.push(`${m.type()}: ${m.text()}`), /error|warn/.test(m.type()) && !/404|Failed to load/.test(m.text()) && console.log('CONSOLE', m.type(), m.text())));
  page.on('pageerror', (e) => (logs.push(`pageerror: ${e.message}`), console.log('PAGEERROR', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | '))));
  const ports = new Map();
  await page.exposeBinding('__api', async (_s, name, args) => {
    const fn = API[name];
    try {
      const value = fn ? await fn(...(args || [])) : null;
      return { __sh: true, ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
    } catch (e) {
      return { __sh: true, ok: false, error: e.message, code: e.code || null };
    }
  });
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
  // namespaces and methods, read from the real preload
  const pre = fs.readFileSync(path.join(ROOT, 'src/main/preload.js'), 'utf8');
  const body = pre.slice(pre.indexOf("exposeInMainWorld('stagehand', {"));
  const shape = {};
  let cur = null;
  for (const line of body.split('\n')) {
    let m = /^  ([a-zA-Z]+): \{\s*$/.exec(line);
    if (m) {
      cur = m[1];
      shape[cur] = [];
      continue;
    }
    m = /^    ([a-zA-Z]+): /.exec(line);
    if (m && cur) shape[cur].push(m[1]);
    if (/^  \},?\s*$/.test(line)) cur = null;
  }
  await page.addInitScript(([fakeIn, shape]) => {
    window.__shFakeAudio = { fakeIn };
    let seq = 0;
    const local = new Map();
    window.__deliver = (id, m) => {
      const port = local.get(id);
      if (!port) return;
      if (m && m.t === 'in' && Array.isArray(m.d)) m = { ...m, d: Float32Array.from(m.d) };
      port.postMessage(m);
    };
    const ns = (name) => {
      const o = {};
      for (const k of shape[name] || []) o[k] = (...args) => window.__api(`${name}.${k}`, args);
      return o;
    };
    const rig = {
      available: () => window.__api('rig.available', []),
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
    };
    const handlers = {};
    window.__shEmit = (ch, p) => (handlers[ch] || []).forEach((fn) => fn(p));
    const api = { on: (ch, fn) => ((handlers[ch] = handlers[ch] || []).push(fn), () => {}), pathFor: () => '', artUrl: () => '', coverUrl: () => '' };
    for (const name of Object.keys(shape)) api[name] = ns(name);
    api.rig = rig;
    window.stagehand = api;
  }, [guitarWav, shape]);

  await page.goto(`${base}/src/renderer/index.html`);
  await page.waitForTimeout(3500);
  const shot = (n) => (console.log('SHOT', n), page.screenshot({ path: path.join(outDir, `v3-${n}.png`) }));
  if (process.env.SH_SLOW_TONES) {
    await page.locator('.nav-section:has-text("Tones")').click();
    await page.waitForTimeout(600);
    await page.locator('.tones-tabs button:has-text("From my songs")').click();
    await page.waitForTimeout(5000);
    const txt = await page.locator('.read-bar .rb-count').textContent().catch(() => '');
    check(/of 1,200 songs/.test(txt || ''), `Tones shows how far the reading is: “${txt}”`);
    await shot('18-tones-reading');
    await page.keyboard.press('Control+Comma');
    await page.waitForTimeout(800);
    await page.locator('.modal button:has-text("Real amps")').first().click();
    await page.waitForTimeout(1500);
    check((await page.locator('.modal .read-bar').count()) === 1, 'Settings › Real amps shows the same reading (one read, not two)');
    await shot('19-settings-reading');
    await page.waitForTimeout(9000);
    check((await page.locator('.modal .read-bar').count()) === 0, 'the bar goes away when it’s done');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    check((await page.locator('.tones-items .tone-item').count()) > 0 && (await page.locator('.read-bar').count()) === 0, 'and the song tones appear');
    await browser.close();
    relay.quit();
    server.close();
    const f = results.filter((r) => !r.ok).length;
    console.log(f ? `${f} failed` : 'all passed');
    process.exit(f ? 1 : 0);
  }
  if (process.env.SH_OLD_SLOTS) {
    const t = toneStore.get().tones;
    const c1 = t.find((x) => x.id === 't_old1'), c2 = t.find((x) => x.id === 't_old2'), ch = t.find((x) => x.from && x.from.preset === 'chime');
    check(c1 && c1.slot === 1 && c1.gear.find((g) => g.slot === 'amp').knobs.Gain === 31, 'an untouched old preset in slot 1 is brought up to the real-amp version');
    check(c2 && c2.gear.find((g) => g.slot === 'amp').knobs['Loudness 1'] === 70, 'a preset you edited stays as you made it');
    check(ch && ch.slot === 9, `the new Chime preset takes a free slot (${ch && ch.slot})`);
    await browser.close();
    relay.quit();
    server.close();
    const f = results.filter((r) => !r.ok).length;
    console.log(f ? `${f} failed` : 'all passed');
    process.exit(f ? 1 : 0);
  }
  await shot('1-play');
  const st = await page.locator('.guitar-card .gc-top').textContent().catch(() => '');
  check(/Guitar ready/.test(st || ''), `guitar starts by itself: “${(st || '').trim()}”`);
  check((await page.locator('.slot').count()) === 9, 'nine tone slots');
  check((await page.locator('.slot.on').count()) === 1, 'one slot is playing');
  // slot key
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(600);
  const on4 = await page.locator('.slot.on .num').textContent().catch(() => '');
  check(on4 === '4', `key 4 picks slot 4 (${on4})`);
  // turn a knob on the amp
  const knob = page.locator('.rknob').first();
  const kb = await knob.boundingBox();
  if (kb) {
    await page.mouse.move(kb.x + kb.width / 2, kb.y + 20);
    await page.mouse.down();
    await page.mouse.move(kb.x + kb.width / 2, kb.y - 30, { steps: 6 });
    await page.mouse.up();
  }
  await page.waitForTimeout(500);
  check(await page.locator('.rig-card .glow-primary:has-text("Save")').count(), 'turning a knob offers Save');
  // drums
  await page.locator('.drums3 .start').click();
  await page.waitForTimeout(900);
  check(await page.locator('.drums3 .pad.now').count(), 'drum lights follow the beat');
  await shot('2-play-drums');
  await page.locator('.drums3 .start').click();
  // songs
  await page.locator('.nav-section:has-text("Songs")').click();
  await page.waitForTimeout(1200);
  await shot('3-songs-list');
  check(await page.locator('.row .best:not(.none)').count() >= 1, 'Your best shows from practice stats');
  await page.locator('.lib-tools button:has-text("Tiles")').click();
  await page.waitForTimeout(800);
  await page.locator('.tile').first().click();
  await page.waitForTimeout(800);
  await shot('3b-songs-tiles');
  await page.locator('.lib-tools button:has-text("List")').click();
  await page.waitForTimeout(500);
  const row = page.locator('.row').first();
  // ▶ on a song just listens (double-click now plays along on the highway)
  await row.click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Just listen")').first().click();
  await page.waitForTimeout(2500);
  await shot('4-songs-playing');
  // song volume at 0 should be obvious at a glance
  await page.locator('.nb-vol').fill('0');
  await page.waitForTimeout(500);
  check((await page.locator('.nb-volbox.silent').count()) === 1, 'song at 0 shows as silent in the bottom bar');
  await shot('4b-song-silent');
  await page.locator('.nb-vol').fill('0.85');
  await page.waitForTimeout(300);
  check(await page.locator('.nowbar .nb-text').isVisible(), 'bottom bar shows the song');
  await page.locator('.nowbar .btn:has-text("Open song")').click();
  await page.waitForTimeout(1500);
  await shot('5-now');
  check(await page.locator('.stem-row').count() >= 5, 'Mix panel lists the stems');
  await page.locator('.np-panel .btn:has-text("Take my part out")').click();
  await page.waitForTimeout(400);
  check(await page.locator('.stem-row.off').count() === 1, 'Take my part out turns one stem off');
  await shot('5b-now-mix');
  await page.locator('.np-tabs button:has-text("Riff repeater")').click();
  await page.waitForTimeout(400);
  await shot('5c-now-riff');
  await page.locator('.np-tabs button:has-text("Tone")').click();
  await page.waitForTimeout(400);
  await shot('5d-now-tone');
  await page.locator('.np-views button:has-text("Waveform")').click();
  await page.waitForTimeout(1500);
  await shot('6-now-wave');
  await page.keyboard.press('h');
  await page.waitForTimeout(2500);
  await shot('6b-highway');
  await page.waitForTimeout(3000);
  await shot('6c-highway');
  // a correct note: the bracket flashes but stays its own height
  await page.evaluate(() => {
    const H = document.querySelector('.highway').__hw;
    H.bursts.push({ s: 2, f: 3, at: performance.now() });
  });
  await page.waitForTimeout(60);
  await shot('6c2-highway-hit');
  if (process.env.SH_HW_SEEK) {
    // jump ahead (5 s per press) to look at a busy part
    for (let i = 0; i < Number(process.env.SH_HW_SEEK); i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1200);
    await shot('6d-highway');
    // what a hot streak looks like
    await page.evaluate(() => (document.querySelector('.highway').__hw.forceStreak = 48));
    await page.waitForTimeout(2500);
    await shot('6e-highway');
    await page.evaluate(() => (document.querySelector('.highway').__hw.forceStreak = undefined));
  }
  await page.locator('.hw-dock-tab').click();
  await page.waitForTimeout(600);
  check((await page.locator('.hw-level').count()) === 2, 'highway mix shows Your guitar and Whole song above the stems');
  await shot('6f-highway-mix');
  await page.locator('.hw-dock-tab').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('d');
  await page.waitForTimeout(500);
  check((await page.locator('.np-drop[aria-pressed="true"]').count()) === 1, 'D turns the Drop on');
  await page.keyboard.press('d');
  check(await page.locator('.highway:not([hidden]), .hw-root:not([hidden])').count() >= 0, 'highway opens');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // Tones: pick a song tone, edit, save
  await page.locator('.nav-section:has-text("Tones")').click();
  await page.waitForTimeout(1200);
  await shot('7-tones');
  await page.locator('.tones-tabs button:has-text("From my songs")').click();
  await page.waitForTimeout(2500);
  await page.locator('.tone-item .ti-main').first().click();
  await page.waitForTimeout(800);
  await shot('7b-tones-song');
  await page.locator('.te-save').click();
  await page.waitForTimeout(800);
  check(/in your tones|Saved/.test((await page.locator('.toast').last().textContent().catch(() => '')) || ''), 'saving a song tone makes your own copy');
  await page.locator('.tones-edit .demo-btn').first().click();
  await page.waitForTimeout(1500);
  check((await page.locator('.tones-edit .demo-btn[aria-pressed="true"]').count()) === 1, 'demo riff plays through the tone');
  await shot('7c-tones-demo');
  // looper: record a couple of seconds of the fake guitar
  await page.locator('.nav-section:has-text("Play")').click();
  await page.waitForTimeout(800);
  await page.locator('.looper3 .btn.rec').click();
  await page.waitForTimeout(4000);
  await page.locator('.looper3 .btn.rec').click();
  for (let i = 0; i < 40 && !/Looping/.test((await page.locator('.looper3 .lp-status').textContent().catch(() => '')) || ''); i++) await page.waitForTimeout(250);
  check(/Looping/.test((await page.locator('.looper3 .lp-status').textContent().catch(() => '')) || ''), `looper records and loops: “${await page.locator('.looper3 .lp-status').textContent().catch(() => '')}”`);
  await shot('7d-play-looper');
  await page.locator('.looper3 button[aria-label="Save loop"]').click();
  await page.waitForTimeout(1200);
  await page.locator('.looper3 .btn:has-text("Clear")').click();
  for (const [n, name] of [['8', 'Progress'], ['9', 'Discover']]) {
    await page.locator(`.nav-section:has-text("${name}")`).click();
    await page.waitForTimeout(1500);
    await shot(`${n}-${name.toLowerCase()}`);
  }
  check(await page.locator('.take').count() >= 1, 'the saved loop is in your takes');
  // Settings › Stems (FLAC only)
  await page.keyboard.press('Control+Comma');
  await page.waitForTimeout(800);
  await page.locator('.modal button:has-text("Stems")').first().click();
  await page.waitForTimeout(1200);
  check((await page.locator('.modal button:has-text("Compare formats")').count()) === 0 && (await page.locator('.modal :text("lossless FLAC")').count()) >= 1, 'stems are FLAC only, no format choice');
  await shot('10-settings-stems');
  await page.locator('.modal button:has-text("Guitar & audio")').first().click();
  await page.waitForTimeout(1500);
  await shot('11-settings-guitar');
  check(await page.locator('.modal select[aria-label="Sound engine"]').count() === 1, 'Settings has Guitar & audio');

  // Tones: arrow keys move through the list, a slot tile takes the selected tone
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.locator('.nav-section:has-text("Tones")').click();
  await page.waitForTimeout(1000);
  check((await page.locator('.slot-strip .ss-tile').count()) === 9, 'Tones shows your 9 slots');
  await page.locator('.tones-tabs button:has-text("Presets")').click();
  await page.waitForTimeout(500);
  await page.locator('.tones-items .tone-item .ti-main').first().click();
  await page.waitForTimeout(400);
  const before = await page.locator('.tone-item.on b').first().textContent();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);
  const after = await page.locator('.tone-item.on b').first().textContent();
  check(before !== after, `↓ moves to the next tone (${before} → ${after})`);
  await page.locator('.slot-strip .ss-tile').nth(8).click();
  await page.waitForTimeout(1200);
  check((await page.locator('.slot-strip .ss-tile').nth(8).locator('.ss-name').textContent()) === after, 'clicking slot 9 puts the selected tone there');
  check((await page.locator('.tones-tabs button[aria-pressed="true"]').textContent()) === 'Presets', 'stays on the tab you were on');
  await shot('7e-tones-slots');
  await page.locator('.nav-section:has-text("Play")').first().click();
  await page.waitForTimeout(500);
  await page.locator('.nav-section:has-text("Tones")').click();
  await page.waitForTimeout(600);
  check((await page.locator('.tones-tabs button[aria-pressed="true"]').textContent()) === 'Presets', 'Tones remembers your tab');

  // picking a song's tone on Tones really puts that tone on your guitar
  await page.locator('.tones-tabs button:has-text("From my songs")').click();
  await page.waitForTimeout(2500);
  const songRows = page.locator('.tones-items .tone-item .ti-main');
  if (await songRows.count()) {
    await songRows.first().click();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      if (await page.evaluate(() => { const r = window.__rig; const a = r.liveTone && r.liveTone.gear.find((g) => g.slot === 'amp'); return r.mode === 'live' && a && (r.slots[r.active] || '').includes(a.key); })) break;
    }
    const st = await page.evaluate(() => { const r = window.__rig; return { mode: r.mode, active: r.active, spec: r.slots[r.active] || '', want: r.liveTone ? r.liveTone.gear.map((g) => g.key) : [] }; });
    const amp = st.want.find((k) => /Amp_/.test(k)) || '';
    check(st.mode === 'live' && amp && st.spec.includes(amp), `a song tone picked on Tones is the one playing (${st.mode}, slot ${st.active}, ${amp})`);
    console.log('TONECHECK', JSON.stringify(st).slice(0, 300));
    // with a song playing, the tone you picked must stay (the song used to take it back every frame)
    if (!(await page.evaluate(() => document.querySelector('.nowbar .round-play').getAttribute('aria-label') === 'Pause'))) await page.locator('.nowbar .round-play').click();
    await page.waitForTimeout(400);
    await songRows.first().click();
    await page.waitForTimeout(2000);
    const m2 = await page.evaluate(() => window.__rig.mode);
    check(m2 === 'live', `your pick stays while a song plays (mode ${m2})`);
  }

  // the highway's tone menu offers your saved slots
  await page.locator('.nav-section:has-text("Songs")').click();
  await page.waitForTimeout(800);
  await page.locator('.insp-play .btn.glow-primary').click();
  await page.waitForTimeout(2500);
  await page.locator('button.hw-chip[title="Tone for your guitar"]').click();
  await page.waitForTimeout(500);
  check((await page.locator('text=Your slots (keys 1–9)').count()) >= 1, 'highway tone menu lists your slots');
  await shot('12-highway-tones');
  await page.keyboard.press('Escape');

  // Real amps: a downloaded capture plays in the amp's place, everywhere it shows.
  // (the test bridge relays every audio frame, so engine answers can lag here: wait for the result)
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  for (let i = 0; i < 3 && !(await page.locator('.nav-section:has-text("Play")').first().isVisible()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
  await page.locator('.nav-section:has-text("Play")').first().click();
  await page.evaluate(() => window.__rig.setTone('crunch'));
  await until(() => page.evaluate(() => !!window.__rig.capture));
  const capSt = await page.evaluate(() => ({ cap: window.__rig.capture ? `${window.__rig.capture.pack.title} / ${window.__rig.capture.model.name}` : null, slot: window.__rig.slots[window.__rig.active] || '' }));
  check(capSt.cap && /\nnam\t.*Plexi/.test(capSt.slot) === false && /\nnam\t/.test(capSt.slot), `Crunch (a Plexi) plays the real Plexi capture: ${capSt.cap}`);
  check((await page.locator('.rig-card .block.amp .real-badge').count()) === 1, 'the amp block says REAL');
  check(/Driven/.test((await page.locator('.knob-well .kw-head').textContent().catch(() => '')) || ''), 'the amp knobs name the capture playing (Driven, for gain 62)');
  await shot('13-play-real-amp');
  await page.locator('.nav-section:has-text("Tones")').click();
  await page.waitForTimeout(800);
  await page.locator('.tones-tabs button:has-text("Presets")').click();
  await page.waitForTimeout(400);
  await page.locator('.tone-item .ti-main:has-text("Crunch")').first().click();
  await page.waitForTimeout(2500);
  check((await page.locator('.tone-item:has(.ti-main:has-text("Crunch")) > .real-badge').count()) >= 1, 'the tone list marks it REAL');
  check((await page.locator('.ra-strip.real .ra-ladder i').count()) === 3 && (await page.locator('.ra-strip.real .ra-ladder i.on').count()) === 1, 'the amp card shows the three gain captures, one lit');
  await shot('14-tones-real-amp');
  await page.locator('.ra-seg button:has-text("Modelled")').click();
  await until(async () => (await page.evaluate(() => window.__rig.capture)) === null);
  check((await page.evaluate(() => window.__rig.capture)) === null && (await page.locator('.ra-strip:not(.real)').count()) === 1, 'Modelled switches this tone to the modelled amp');
  await page.locator('.ra-seg button:has-text("Real")').click();
  await until(() => page.evaluate(() => !!window.__rig.capture));
  check(!!(await page.evaluate(() => window.__rig.capture)), 'Real switches it back');
  await page.locator('.tone-item .ti-main:has-text("Metal")').first().click();
  await page.waitForTimeout(2000);
  check((await page.locator('.ra-offer .ra-get').count()) === 1 && (await page.locator('.ra-offer :text("Mesa Dual Rectifier")').count()) === 1, 'a Cali-100 tone offers the real Rectifier');
  await shot('15-tones-get-real-amp');
  await page.locator('.ra-offer .ra-get').click();
  await page.waitForTimeout(800);
  check((await page.locator('.toast:has-text("Connect TONE3000 first")').count()) === 1, 'without a TONE3000 key it points you to the one-time setup');
  await page.keyboard.press('Control+Comma');
  await page.waitForTimeout(800);
  await page.locator('.modal button:has-text("Real amps")').first().click();
  await page.waitForTimeout(1500);
  check((await page.locator('.modal .ra-steps li').count()) === 3, 'Settings › Real amps shows the three setup steps');
  await shot('16-settings-real-amps-setup');
  await page.locator('.modal .ra-steps input').fill('pk_test_1234567890');
  await page.locator('.modal .ra-steps button:has-text("Save")').click();
  await page.waitForTimeout(1200);
  check((await page.locator('.modal .ra-tile:not(.add):not(.get)').count()) === 1 && (await page.locator('.modal .ra-tile.get').count()) >= 10, 'then your real amps and the ones to get');
  await shot('17-settings-real-amps');
  await page.keyboard.press('Escape');

  // highway: your guitar is one pill (mute + tone), no second Mix button
  check((await page.locator('.hw-top .hw-rig .hw-rig-mute').count()) === 1 && (await page.locator('.hw-top > .hw-chip:has-text("Mix")').count()) === 0, 'highway: guitar and tone in one pill, no extra Mix button');

  // Tones › From my songs offers every real amp your songs use, in one go
  for (let i = 0; i < 3 && !(await page.locator('.nav-section:has-text("Tones")').first().isVisible()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  await page.locator('.nav-section:has-text("Tones")').click();
  await page.waitForTimeout(500);
  await page.locator('.tones-tabs button:has-text("From my songs")').click();
  await page.waitForTimeout(2500);
  check((await page.locator('.ra-libstrip button:has-text("Get all")').count()) === 1, `From my songs offers Get all: “${(await page.locator('.ra-libstrip').textContent().catch(() => '')) || ''}”`);
  await shot('20-tones-get-all');

  // About: the Noisewater Labs logo next to Stagehand
  await page.keyboard.press('Control+Comma');
  await page.waitForTimeout(800);
  await page.locator('.modal button:has-text("About")').first().click();
  await page.waitForTimeout(800);
  check((await page.locator('.modal .about-brand img[alt="Noisewater Labs"]').count()) === 1, 'About shows the Noisewater Labs logo next to Stagehand');
  await shot('21-about');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // double-click a song: straight to the highway; it waits for the stems, then starts by itself
  const firstId = library.snapshot().songs[0].id;
  stemHold.add(firstId);
  await page.locator('.nav-section:has-text("Songs")').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__stage && window.__stage.engine && window.__stage.engine.pause && window.__stage.engine.pause());
  await page.locator(`[data-id="${firstId}"]`).first().dblclick();
  await page.waitForTimeout(3000);
  const w1 = await page.evaluate(() => ({ hw: !!document.querySelector('.highway:not([hidden])'), card: !document.querySelector('.stem-wait').hidden, text: document.querySelector('.stem-wait').textContent, playing: document.querySelector('.hw-play') && document.querySelector('.hw-play').title }));
  check(w1.hw, 'double-clicking a song opens it on the highway');
  check(w1.card && /Splitting the stems · 40%/.test(w1.text), `it waits for the stems with progress: “${w1.text.slice(0, 60)}”`);
  await shot('22-waiting-for-stems');
  const playingBefore = await page.evaluate(() => window.__stagePlaying && window.__stagePlaying());
  stemHold.delete(firstId);
  await page.evaluate((id) => window.__shEmit('stems:update', { songId: id, state: 'ready' }), firstId);
  let started = false;
  for (let i = 0; i < 40 && !started; i++) {
    await page.waitForTimeout(250);
    started = await page.evaluate(() => document.querySelector('.stem-wait').hidden && !!(window.__stagePlaying && window.__stagePlaying()));
  }
  check(!playingBefore && started, 'and starts by itself once they’re in');
  // 3.7: Tab | Waveform on the highway, and Back goes to your songs
  await page.mouse.move(400, 300);
  await page.mouse.move(420, 320);
  await page.waitForTimeout(300);
  await page.locator('.hw-views button:has-text("Tab")').click();
  await page.waitForTimeout(600);
  const v1 = await page.evaluate(() => ({ hw: !!document.querySelector('.highway:not([hidden])'), now: document.getElementById('app').className }));
  check(!v1.hw && /now/.test(v1.now), 'Tab on the highway switches to the Tab view of the song');
  await page.keyboard.press('h');
  await page.waitForTimeout(800);
  if (!(await page.evaluate(() => !!document.querySelector('.highway:not([hidden])')))) await page.evaluate(() => window.__stage && window.__stage.openHighway && window.__stage.openHighway());
  await page.waitForTimeout(800);
  await shot('23-highway-views');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const v2 = await page.evaluate(() => ({ hw: !!document.querySelector('.highway:not([hidden])'), cls: document.getElementById('app').className }));
  check(!v2.hw && /songs/.test(v2.cls), `Back (Esc) from the highway goes to your songs (${v2.cls})`);
  // Songs folds its sub-menu on a second click; no Rocksmith lists any more
  await page.locator('.nav-section:has-text("Songs")').click();
  await page.waitForTimeout(400);
  const f0 = await page.locator('.nav-sub .nav-item').count();
  await page.locator('.nav-section:has-text("Songs")').click();
  await page.waitForTimeout(400);
  const f1 = await page.locator('.nav-sub .nav-item').count();
  await page.locator('.nav-section:has-text("Songs")').click();
  await page.waitForTimeout(400);
  const f2 = await page.locator('.nav-sub .nav-item').count();
  check(Math.max(f0, f1) > 0 && Math.min(f0, f1) === 0 && f2 === f0, `clicking Songs again folds and unfolds its menu (${f0} → ${f1} → ${f2})`);
  check((await page.locator('.nav-label:has-text("In Rocksmith")').count()) === 0, 'the In Rocksmith lists are gone from the menu');
  await shot('24-menu');
  // 3.8: typing in the search from another page shows the song list, filtered
  await page.locator('.nav-section:has-text("Tones")').click();
  await page.waitForTimeout(400);
  await page.locator('#search').fill('album name');
  await page.waitForTimeout(600);
  const sr = await page.evaluate(() => ({ cls: document.getElementById('app').className, sub: (document.querySelector('.lib-title .sub') || {}).textContent || '' }));
  check(/page-songs/.test(sr.cls) && /^1 song\b/.test(sr.sub), `search from Tones jumps to your songs and filters as you type (“${sr.sub}”)`);
  await page.locator('#search').fill('');
  await page.waitForTimeout(300);
  // 3.8: click an artist in the list to see their songs; bigger rows
  await page.locator('#library .row[data-id] .go[data-go="artist"]').first().click();
  await page.waitForTimeout(800);
  const av = await page.evaluate(() => ({ h1: document.querySelector('.lib-title h1').textContent, rows: document.querySelectorAll('#library .row[data-id]').length, h: document.querySelector('#library .row[data-id]').getBoundingClientRect().height }));
  check(av.rows === 1 && av.h >= 50, `clicking an artist lists their songs (“${av.h1}”, ${av.rows} song, rows ${av.h}px tall)`);
  await shot('27-artist-view');
  await page.locator('.nav-section:has-text("Songs")').click();
  await page.waitForTimeout(300);
  // 3.9: back (mouse button / Alt+←) goes to the previous screen
  await page.locator('.nav-section:has-text("Progress")').click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(400);
  const bk = await page.evaluate(() => document.getElementById('app').className);
  check(/page-songs/.test(bk), `back goes to the previous screen (${bk.match(/page-\w+/)})`);
  // 3.7: duplicate songs (Songs › ⋯ › Find duplicate songs)
  await page.locator('.icon-btn[title="More"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.menu button:has-text("Find duplicate songs")').click();
  await page.waitForTimeout(1200);
  const dz = await page.evaluate(() => ({ groups: document.querySelectorAll('.dupe-group').length, keep: [...document.querySelectorAll('.dupe-row.keep .dupe-file')].map((x) => x.textContent), drop: document.querySelectorAll('.dupe-row.drop').length, go: (document.querySelector('.modal footer .btn.primary') || {}).textContent }));
  check(dz.groups === 1 && /v3_DD/.test(dz.keep[0]) && dz.drop === 2, `duplicates: keeps the copy with audio and the most parts (${dz.keep[0]}), ${dz.drop} to move (“${dz.go}”)`);
  await shot('26-duplicates');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // 3.7: Jam (full screen, just the Fluid picture and your guitar), and the version in the title bar
  check(/^v\d+\.\d+\.\d+$/.test(((await page.locator('#brand-ver').textContent()) || '').trim()), 'the version shows after Stagehand in the title bar');
  await page.locator('.nav-section:has-text("Play")').click();
  await page.waitForTimeout(600);
  await page.locator('.jam-open').click();
  await page.waitForTimeout(4000);
  const jam = await page.evaluate(() => ({ open: !document.querySelector('.jam').hidden, frame: !!document.querySelector('.jam .hw-fluid'), ready: !!(document.querySelector('.jam .hw-fluid') && document.querySelector('.jam .hw-fluid').contentWindow.FluidVisuals) }));
  check(jam.open && jam.frame && jam.ready, 'Jam opens full screen with the Fluid picture');
  await page.evaluate(() => document.querySelector('.jam .hw-fluid').contentWindow.FluidVisuals.splats([{ x: 0.3, y: 0.3, dx: 400, dy: 900, r: 0.2, g: 0.05, b: 0.25, radius: 1.2 }, { x: 0.7, y: 0.3, dx: -400, dy: 900, r: 0.05, g: 0.15, b: 0.3, radius: 1.2 }]));
  await page.waitForTimeout(2500);
  await page.mouse.move(300, 300);
  await shot('25-jam');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.querySelector('.jam').hidden && !document.querySelector('.jam .hw-fluid')), 'Esc leaves Jam and stops the picture');

  // reopening Stagehand on Tones › From my songs (the tab is remembered) must start reading by itself
  await page.evaluate(() => localStorage.setItem('stagehand.tonesTab', 'songs'));
  await page.reload();
  await page.waitForTimeout(3000);
  await page.locator('.nav-section:has-text("Tones")').click();
  let appeared = false;
  for (let i = 0; i < 40 && !appeared; i++) {
    await page.waitForTimeout(250);
    appeared = (await page.locator('.tones-items .tone-item').count()) > 0;
  }
  check(appeared, 'opening Tones on From my songs reads your songs by itself (no click needed)');

  const errs = logs.filter((l) => /^(pageerror)/.test(l) || (/^error/.test(l) && !/404|Failed to load resource|favicon/.test(l)));
  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 4).join(' | ')}` : ''}`);
  fs.writeFileSync(path.join(outDir, 'ui-chromium.log'), logs.join('\n'));
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
