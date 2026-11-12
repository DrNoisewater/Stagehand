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

const TYPES = { '.mjs':'text/javascript', '.webp':'image/webp', '.avif':'image/avif', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.wav': 'audio/wav', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };
let identityAPI = null;
const server = http.createServer(async (req, res) => {
  if (process.env.SH_IDENTITY_SERVE && req.url === '/identity-api' && req.method === 'POST') {
    let body = ''; for await (const b of req) body += b;
    try { const {name,args} = JSON.parse(body); const value = identityAPI[name] ? await identityAPI[name](...args) : null; res.setHeader('content-type','application/json'); return res.end(JSON.stringify({__sh:true,ok:true,value:value ?? null})); }
    catch(e) {return res.end(JSON.stringify({__sh:true,ok:false,error:e.message}));}
  }
  if (process.env.SH_IDENTITY_SERVE && req.url === '/identity-preload.js') {
    res.setHeader('content-type','text/javascript'); return res.end(fs.readFileSync(path.join(__dirname,'identity-preload.js')));
  }
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = u === '/song.wav' ? songWav : u.startsWith('/before/') ? path.join(ROOT, '../evidence/before-source', u.slice(8)) : path.join(ROOT, u === '/' ? '/src/renderer/index.html' : u);
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    if (process.env.SH_IDENTITY_SERVE && file.endsWith('/renderer/index.html')) data = Buffer.from(data.toString().replace('<script type="module"', '<script src="/identity-preload.js"></script><script type="module"'));
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
    // recorded sound (looper, clips) comes as many small pieces: batch them too, in order, none dropped
    if (msg && (msg.t === 'processed' || msg.t === 'mixed') && msg.d) {
      const k = msg.t;
      if (!this.mon) this.mon = {};
      if (!this.mon[k]) this.mon[k] = [];
      const b = this.mon[k];
      for (let i = 0; i < msg.d.length; i++) b.push(msg.d[i]);
      if (!this.monT)
        this.monT = setTimeout(() => {
          this.monT = null;
          for (const kk of Object.keys(this.mon)) {
            if (this.mon[kk].length) this._send({ t: kk, d: this.mon[kk] });
            this.mon[kk] = [];
          }
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
  await new Promise((r) => server.listen(process.env.SH_IDENTITY_SERVE ? Number(process.env.PORT || (process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : null) || 4173) : 0, '0.0.0.0', r));
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
  // song switching checks (3.13): songs whose audio fails to open, and slow answers
  const audioFail = new Set();
  // SH_GETSONGS_ONLY: three wanted songs for Discover › Wanted › Get songs
  const wantedList = process.env.SH_GETSONGS_ONLY ? [1, 2, 3].map((i) => ({ id: `w${i}`, artist: `Artist ${i}`, title: `Title ${i}`, status: 'wanted', addedAt: i })) : [];
  const cfCalls = [];
  const importCfg = [];
  const audioDelay = new Map();
  const tabDelay = new Map();
  const stemsDelay = new Map();
  const later = (ms) => new Promise((r) => setTimeout(r, ms || 0));
  const clipSessions = new (require('../../src/main/services/clip-sessions').ClipSessions)({ tempRoot: os.tmpdir() });
  const API = {
    'clips.source': () => 'test-window',
    // 4.0.7: written to disk while it records (the real clip-sessions.js); the save copies the pieces out
    'clips.begin': (meta) => clipSessions.begin(meta),
    'clips.chunk': (id, kind, data) => clipSessions.chunk(id, kind, Uint8Array.from(Object.values(data || {}))),
    'clips.finish': async (id, meta) => { const c = await clipSessions.close(id); const f = path.join(outDir, 'export-test.webm'); fs.copyFileSync(c.input, f); if (c.sound) fs.copyFileSync(c.sound, path.join(outDir, 'export-test.wav')); await clipSessions.remove(c.dir); return { path: f, take: { id: 'k_0000000000', name: `SH - ${c.title}` } }; },
    'clips.cancel': (id) => clipSessions.remove(id),
    'clips.save': (data, meta) => { const f=path.join(outDir,'export-test.webm');fs.writeFileSync(f,Buffer.from(Object.values(data)));if(meta&&meta.audio)fs.writeFileSync(path.join(outDir,'export-test.wav'),Buffer.from(Object.values(meta.audio)));return {path:f,take:{id:'k_0000000000',name:`SH - ${(meta&&meta.title)||'Jam Session'}`}};},
    'cabs.ensure': id => require('../../src/main/services/cabinets').ensureCab(path.join(tmp,'Cabs'),id,async()=>{throw Error('offline test');}),
    'cabs.bytes': id => Array.from(fs.readFileSync(path.join(ROOT,'src/renderer/data/cabs',id+'.wav'))),
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
      // SH_LISTPOS_ONLY: a long list, so there's somewhere to scroll to
      if (process.env.SH_LISTPOS_ONLY) s.songs = s.songs.concat(Array.from({ length: 300 }, (_, i) => ({ ...s.songs[i % s.songs.length], id: `pad${i}`, title: `Padding ${String(i).padStart(3, '0')}`, official: i % 4 === 1 })));
      return s;
    },
    'audio.prepare': async (id) => {
      await later(audioDelay.get(id));
      if (audioFail.has(id)) throw new Error('Could not decode the song audio: test failure');
      return { key: 'song', url: '/song.wav', sampleRate: 48000, channels: 2, frames: 48000 * SECS, duration: SECS, bits: 16 };
    },
    'tab.list': (id) => tabs.list(song(id)),
    'tab.load': async (id, arr) => {
      await later(tabDelay.get(id));
      return { ...(await tabs.load(song(id), arr)), _for: id };
    },
    'rig.available': () => true,
    // every song has stems in this test (all the same tone, which is fine for the UI)
    'stems.formats': () => library.snapshot().songs.map((x) => ({ songId: x.id, model: 'htdemucs_6s', format: 'wav', bytes: 6 * 48000 * 30 * 4, seconds: 30 })),
    'stems.status': async (id) => (await later(stemsDelay.get(id)), stemHold.has(id) ? { songId: id, state: 'running', progress: 0.4 } : { state: 'ready', model: 'htdemucs_6s', format: 'wav', sampleRate: 48000, frames: 48000 * SECS, stems: ['guitar', 'bass', 'drums', 'vocals', 'piano', 'other'].map((name) => ({ name, url: '/song.wav' })) }),
    'stems.prioritize': () => true,
    'stems.ahead': () => false,
    'stems.playing': () => true,
    'stems.note': () => true,
    'stems.queue': () => ({ items: [] }),
    'engine.status': () => ({ state: 'missing', ok: false }),
    'imports.status': () => ({ watching: false, history: [] }),
    'imports.scanPC': () => ({ places: [], found: [] }),
    'discover.wanted': () => wantedList,
    'discover.customsforge': (o) => (cfCalls.push(o || {}), { url: '', copied: (o && o.text) || null }),
    'imports.configure': (patch) => (importCfg.push(patch || {}), { watching: true, watch: !!(patch && patch.watch), history: [] }),
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
    // Backstage: one other player showing one clip
    'room.get': () => ({ joined: false, name: '', suggest: '', me: '', listening: true, inRoom: true, relays: [], shared: [], hidden: [], old: [], chats: [],
      people: [{ addr: '0123456789ABCDEFGHJKMNPQRS', name: 'Sam', seen: Date.now(), clips: [{ id: 'v1', title: 'Fade To Black', song: 'Fade To Black', artist: 'Metallica', part: 'lead', tuning: 'E Standard', speed: 0.8, tone: 'Crunch 75', sec: 42, size: 3000000, at: Date.now() - 60000 }] }] }),
    'songs.setUser': (id, patch) => library.setUser(id, patch),
    'songs.played': (id) => library.markPlayed(id),
  };

  // 4.5: levels, lifetime statistics, backups and the developer menu, from the real services
  {
    if (process.env.SH_CAREER_AUDIT) {
      // a believable career: four months of playing on most days, getting better
      const ids = library.snapshot().songs.map((x) => x.id);
      let r = 7;
      const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let d = 120; d >= 1; d--) {
        if (rnd() < 0.35) continue;
        for (let i = 0; i < 4; i++) {
          const acc = Math.min(1, 0.55 + (120 - d) / 300 + rnd() * 0.2);
          const notes = 250 + Math.floor(rnd() * 400);
          stats.log({ songId: ids[(d + i) % ids.length], part: i === 3 ? 'bass' : 'lead', seconds: 220 + Math.floor(rnd() * 120), accuracy: acc, notes, hit: Math.round(notes * acc), full: rnd() < 0.8, tuning: ['E Standard', 'Drop D', 'Eb Standard'][i % 3], at: Date.now() - d * 86400000 + i * 400000, bestStreak: Math.round(acc * 120), kinds: { chord: [Math.round(notes * acc * 0.3), Math.round(notes * 0.3)], bend: [Math.round(notes * acc * 0.05), Math.round(notes * 0.05)], slide: [8, 10], legato: [12, 16] }, sections: [['Intro', 18, 20], ['Verse', Math.round(40 * acc), 40], ['Chorus', 30, 30], ['Solo', Math.round(36 * acc), 36]] });
        }
      }
      await stats.flush();
    }
    const { CareerBackups } = require('../../src/main/services/profile-backup');
    const { lifetime } = require('../../src/main/services/lifetime');
    const backups = new CareerBackups({ dataDir: tmp, dir: path.join(tmp, 'Backups', 'Career') });
    await backups.auto();
    const levels = new (require('../../src/main/services/levels').Levels)({file:path.join(tmp,'levels.json'),sessions:()=>stats.data.sessions,songs:()=>Object.fromEntries(library.snapshot().songs.map(x=>[x.id,x])),backups});
    await levels.load();
    API['levels.state'] = () => levels.state();
    API['levels.did'] = id => levels.did(id);
    API['levels.title'] = id => levels.setTitle(id);
    API['career.lifetime'] = () => lifetime({ sessions: stats.data.sessions, archive: stats.data.archive, songs: Object.fromEntries(library.snapshot().songs.map((x) => [x.id, x])) });
    API['career.backups'] = () => backups.list();
    API['career.backup'] = () => backups.backup('manual');
    API['career.export'] = () => null;
    API['dev.enabled'] = () => !!process.env.SH_CAREER_AUDIT;
    API['dev.levels'] = (op, ...args) => levels[op](...args);
    API['dev.integrity'] = () => backups.integrity({ sessions: stats.data.sessions });
    API['dev.balance'] = (days) => require('../../src/main/services/progression-sim').balanceReport({ days: Math.min(120, days || 120) });
    API['dev.testRecovery'] = () => ({ ok: true, sessions: 50 });
    API['dev.clearRecent'] = () => ({ removed: 0 });
    API['dev.restore'] = (id) => backups.restore(id, ['stats.json', 'levels.json']);
    API['dev.eraseLifetime'] = () => { throw new Error('not in tests'); };
    global.__levels = levels;
  }
  if (process.env.SH_IDENTITY_SERVE) {
    API['stems.queue'] = () => [];
    API['updates.check'] = () => null;
    await settings.set({ui:{guideSeen:true,guideVersion:2}});
  }
  if (process.env.SH_IDENTITY_SERVE) {
    identityAPI = API;
    API['rig.available'] = () => false;
    console.log('IDENTITY renderer: '+base+'/src/renderer/index.html');
    return;
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required','--single-process','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: process.env.SH_PICTURES311?1100:950 } });
  page.setDefaultTimeout(60000);
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
    localStorage.setItem('stagehand.fluidDye','256');
    window.__shFakeAudio = { fakeIn };
    let seq = 0;
    const local = new Map();
    window.__deliver = (id, m) => {
      const port = local.get(id);
      if (!port) return;
      if (m && (m.t === 'in' || m.t === 'processed' || m.t === 'mixed') && Array.isArray(m.d)) m = { ...m, d: Float32Array.from(m.d) };
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
  const shot = (n) => process.env.SH_NO_PICS?Promise.resolve():(console.log('SHOT', n), page.screenshot({ path: path.join(outDir, `v3-${n}.png`) }));
  if (process.env.SH_CAREER_AUDIT) {
    await require('./career-audit.js')({ page, outDir, check });
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ results, logs }, null, 2));
    await browser.close(); relay.quit(); server.close();
    process.exit(results.some(r => !r.ok) ? 1 : 0);
  }
  if (process.env.SH_GEAR_AUDIT) {
    await require('./gear-audit.js')({ page, outDir, check });
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ results, logs }, null, 2));
    await browser.close(); relay.quit(); server.close();
    process.exit(results.some(r => !r.ok) ? 1 : 0);
  }
  // any audit module (a path): node ui3-chromium.js helper out with SH_AUDIT=test/e2e/foo.js
  if (process.env.SH_AUDIT) {
    await require(path.resolve(process.env.SH_AUDIT))({ page, outDir, check });
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ results, logs }, null, 2));
    await browser.close(); relay.quit(); server.close();
    process.exit(results.some(r => !r.ok) ? 1 : 0);
  }
  if (process.env.SH_IDENTITY_AUDIT) {
    await require('./identity-audit.js')({ page, outDir, check, baseline: process.env.SH_IDENTITY_AUDIT === 'before' });
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ results, logs }, null, 2));
    await browser.close(); relay.quit(); server.close();
    process.exit(results.some(r => !r.ok) ? 1 : 0);
  }
  // 4.1.9: Tones: keys on top (a click picks, never assigns), your tones, find a tone; edits are a draft
  const slotsNow = () => page.evaluate(async () => { const { tonelib } = await import('/src/renderer/js/tonelib.js'); return JSON.stringify(tonelib.list.map((t) => [t.id, t.slot || null]).sort()); });
  const tonesOverhaul = async () => {
    for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    await page.locator('.nav-section:has-text("Tones")').click();
    await page.waitForTimeout(1000);
    check((await page.locator('.tk-keys .tk-card').count()) === 9, 'Tones shows your keys 1–9 at the top');
    check((await page.locator('.tones-sec.mine').count()) === 1 && (await page.locator('.tones-sec.find').count()) === 1, 'then your tones, then Find a tone');
    check((await page.locator('.tones-list .gate-ctl .seg button').count()) === 3, 'the noise gate switch (Auto / Strong / Off) is on Tones');
    // clicking a key that holds a tone only picks it
    let s0 = await slotsNow();
    const filled = page.locator('.tk-card:not(.vacant):not(.k1)');
    if (await filled.count()) {
      await filled.first().click();
      await page.waitForTimeout(600);
      check((await slotsNow()) === s0, 'clicking a key picks its tone and never changes the key');
      check((await page.locator('.tk-card.on').count()) === 1 && (await page.locator('.modal').count()) === 0, 'the key is lit, nothing asked');
      await shot('50-tones-keys');
    }
    // presets: pick one, ↓ moves on
    await page.locator('.tones-tabs button:has-text("Presets")').click();
    await page.waitForTimeout(500);
    await page.locator('.find-items .tone-item .ti-main').first().click();
    await page.waitForTimeout(400);
    const before = await page.locator('.find-items .tone-item.on b').first().textContent();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);
    const after = await page.locator('.find-items .tone-item.on b').first().textContent();
    check(before !== after, `↓ moves to the next tone (${before} → ${after})`);
    check((await slotsNow()) === s0, 'moving through the list changes no key');
    // putting it on a key that holds a tone asks first; Cancel leaves it; Undo puts it back
    const taken = page.locator('.tones-edit .ts-key:not(.vacant):not(.here)');
    if (await taken.count()) {
      await taken.first().click();
      await page.waitForTimeout(400);
      check((await page.locator('.modal:has-text("It replaces")').count()) === 1, `putting ${after} on a key that holds a tone asks first, and says what it replaces`);
      await shot('51-tones-replace-ask');
      await page.locator('.modal button:has-text("Cancel")').click();
      await page.waitForTimeout(400);
      check((await slotsNow()) === s0, 'Cancel leaves the key as it was');
      await taken.first().click();
      await page.waitForTimeout(400);
      await page.locator('.modal button:has-text("Put on key")').click();
      await page.waitForTimeout(1000);
      const s1 = await slotsNow();
      check(s1 !== s0 && (await page.locator('.toast button:has-text("Undo")').count()) >= 1, 'Put on key puts it there, with Undo');
      await page.locator('.toast button:has-text("Undo")').last().click();
      await page.waitForTimeout(1200);
      const s2 = JSON.parse(await slotsNow()).filter(([id]) => JSON.parse(s0).some(([x]) => x === id));
      check(JSON.stringify(s2) === s0 && JSON.parse(await slotsNow()).length === JSON.parse(s0).length, 'Undo puts every key back (and the copy it made is gone)');
    }
    // an empty key: no question, but Undo
    const empty = page.locator('.tones-edit .ts-key.vacant');
    if (await empty.count()) {
      s0 = await slotsNow();
      await empty.first().click();
      await page.waitForTimeout(1000);
      check((await page.locator('.modal').count()) === 0 && (await slotsNow()) !== s0, 'an empty key takes the tone straight away');
      await page.locator('.toast button:has-text("Undo")').last().click();
      await page.waitForTimeout(1200);
    }
    // edits: heard live, marked unsaved, Revert goes back; leaving goes back too
    const mineRow = page.locator('.mine-items .tone-item .ti-main').first();
    if (await mineRow.count()) {
      await mineRow.click();
      await page.waitForTimeout(600);
      await page.locator('.tones-edit button:has-text("Edit tone")').click();
      await page.waitForTimeout(1200);
      const id = await page.evaluate(() => window.__rig.toneId);
      const knob = page.locator('.rr-inspect .gb-strip .rknob').first();
      await knob.focus();
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(600);
      check((await page.evaluate(() => window.__rig.mode)) === 'live' && (await page.locator('.rr-save').textContent()) === 'Save changes', 'a knob turn in the rig is heard live, with Save changes');
      await shot('52-tones-unsaved');
      await page.locator('.rr-close').click();
      await page.waitForTimeout(400);
      await page.locator('.modal button:has-text("Close")').last().click();
      await page.waitForTimeout(800);
      const back = await page.evaluate(() => ({ mode: window.__rig.mode, id: window.__rig.toneId }));
      check(back.mode === 'preset' && back.id === id && (await page.locator('.modal.rig-room').count()) === 0, `closing the rig without saving goes back to the saved tone (${back.mode})`);
    }
    // song tones: one row per tone, described, grouped, filtered
    await page.locator('.tones-tabs button:has-text("In my songs")').click();
    await page.waitForTimeout(2500);
    const rows = await page.locator('.find-items .tone-item').count();
    const sub = (await page.locator('.find-items .tone-item .ti-main span').first().textContent().catch(() => '')) || '';
    check(rows > 0 && /^(Clean|Crunch|High gain|Lead|Clean bass|Driven bass|Bass lead)( · |$)/.test(sub), `song tones are described by their sound and gear (“${sub}”)`);
    check(/different tones/.test((await page.locator('.tones-count').textContent().catch(() => '')) || ''), 'and counted once each');
    await shot('53-tones-songs');
    await page.locator('.tones-filters .seg button:has-text("Bass")').click();
    await page.waitForTimeout(400);
    const bassSubs = await page.locator('.find-items .tone-item .ti-main span').allTextContents();
    check(bassSubs.every((t) => /bass/i.test(t)), `the Bass filter shows bass tones only (${bassSubs.length})`);
    await page.locator('.tones-filters .seg button:has-text("All")').first().click();
    await page.locator('.tones-filters .seg button:has-text("By artist")').click();
    await page.waitForTimeout(400);
    check((await page.locator('.find-items .tones-group small').first().textContent().catch(() => '')).match(/song/), 'grouped by artist, with how many songs');
    await page.locator('.tones-filters .seg button:has-text("By song")').click();
    await page.locator('.tones-find').fill('zzzz nothing');
    await page.waitForTimeout(300);
    check((await page.locator('.find-items .tone-item').count()) === 0, 'a search with no match shows nothing');
    await page.locator('.tones-find').fill('');
    await page.waitForTimeout(300);
  };
  const createTonePedals = async () => {
    // Create tone: the Pedals step adds, moves and removes pedals, heard live
    await page.locator('.nav-section[data-page="play"]').click();
    await page.waitForTimeout(600);
    await page.locator('#page-play button:has-text("Create tone")').click();
    await page.waitForTimeout(1200);
    await page.locator('.rr-guide').click(); // 4.6: Create tone opens the rig; the old helper is one click away
    await page.waitForTimeout(800);
    await page.locator('.tw-card:has-text("Guitar")').first().click();
    await page.waitForTimeout(400);
    await page.locator('.tw-card:has-text("Thrash")').click();
    await page.waitForTimeout(600);
    for (let i = 0; i < 3; i++) await page.locator('.tw-modal footer button:has-text("Next")').click();
    await page.waitForTimeout(500);
    const pedals = await page.locator('.tw-modal .pb-pedal').count();
    check(pedals >= 2, `Thrash starts with its pedals on the board (${pedals})`);
    await page.locator('.tw-modal .pb-add').click();
    await page.waitForTimeout(300);
    await page.locator('.tw-modal .pb-choice[data-key="Pedal_AnalogueDelay"]').click();
    await page.waitForTimeout(800);
    const heard = await page.evaluate(() => (window.__rig.liveTone ? window.__rig.liveTone.gear.map((g) => g.key).join('>') : ''));
    check(/Pedal_AnalogueDelay/.test(heard) && (await page.locator('.tw-modal .pb-pedal').count()) === pedals + 1, `an added pedal is heard straight away (${heard})`);
    await shot('54-create-tone-pedals');
    await page.locator('.tw-modal .pb-pedal[data-key="Pedal_AnalogueDelay"] .pb-del').click();
    await page.waitForTimeout(600);
    check(!/Pedal_AnalogueDelay/.test(await page.evaluate(() => window.__rig.liveTone.gear.map((g) => g.key).join('>'))), 'and taken off again');
    check((await page.locator('.tw-modal .gate-ctl .seg button').count()) === 3, 'the Pedals step has the noise gate switch');
    await page.locator('.tw-modal .gate-ctl button:has-text("Strong")').click();
    check((await page.evaluate(() => window.__rig.gate)) === 'strong', 'Strong is set for every tone');
    await page.locator('.tw-modal .gate-ctl button:has-text("Auto")').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  };
  const highwayToneMenu = async () => {
    for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    await page.evaluate(async () => {
      const { state } = await import('/src/renderer/js/store.js');
      const a = await import('/src/renderer/js/actions.js');
      await a.playSong([...state.songs.values()][0].id, { autoplay: false });
      (await import('/src/renderer/js/stage.js')).openHighway();
    });
    await page.waitForTimeout(3000);
    // the first visit offers the timing check: not now
    if (await page.locator('button:has-text("Not now")').count()) await page.locator('button:has-text("Not now")').first().click();
    await page.waitForTimeout(400);
    await page.locator('button.hw-chip[title="Tone for your guitar"]').click();
    await page.waitForTimeout(500);
    check((await page.locator('.tm .tm-keys .tm-key').count()) === 9, 'the highway tone menu shows keys 1–9');
    check((await page.locator('.tm .tm-now strong').count()) === 1 && (await page.locator('.tm button:has-text("Edit this tone")').count()) === 1 && (await page.locator('.tm button:has-text("Create a tone")').count()) === 1, 'with what is playing now, Edit this tone and Create a tone');
    await shot('55-highway-tone-menu');
    // pressing a number with the menu open: the menu follows
    const k = await page.locator('.tm .tm-key:not(.vacant)').nth(1).locator('b').textContent().catch(() => null);
    if (k) {
      await page.locator('.highway canvas').first().hover().catch(() => {});
      await page.keyboard.press(k);
      await page.waitForTimeout(800);
      check((await page.locator('.tm').count()) === 1 && (await page.locator('.tm .tm-key.on b').textContent().catch(() => '')) === k, `the open menu stays open and follows key ${k}`);
    }
    await page.locator('.tm .tm-find').fill('crunch');
    await page.waitForTimeout(300);
    check((await page.locator('.tm .tm-search .tm-row').count()) >= 1, 'the search finds tones by name');
    await shot('56-highway-tone-search');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check((await page.locator('.tm').count()) === 0, 'Escape closes it');
  };
  if (process.env.SH_TONES_ONLY) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await tonesOverhaul();
    await createTonePedals();
    await highwayToneMenu();
    const errs = logs.filter((l) => /^(pageerror)/.test(l) || (/^error/.test(l) && !/404|Failed to load resource|favicon/.test(l)));
    check(errs.length === 0, `no page errors${errs.length ? `: ${errs.slice(0, 4).join(' | ')}` : ''}`);
    await browser.close();
    relay.quit();
    server.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `${failed} failed` : 'all passed');
    process.exit(failed ? 1 : 0);
  }
  if (process.env.SH_GETSONGS_ONLY) {
    // 4.0.4: Get songs: copies one wanted song after another as downloads come in
    await page.evaluate(async () => {
      localStorage.setItem('stagehand.cfExplained', '1');
      const st = await import('./js/store.js');
      st.setPage('discover');
      (await import('./js/discover.js')).open('wanted');
    });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Get songs', exact: true }).click();
    await page.waitForTimeout(600);
    check(cfCalls.length === 1 && cfCalls[0].text === 'Artist 1 Title 1' && cfCalls[0].open === true, `first song copied and CustomsForge opened ${JSON.stringify(cfCalls)}`);
    check(importCfg.some((p) => p.watch === true), 'Watch Downloads turned on');
    check(/Now: Artist 1 – Title 1/.test(await page.locator('.get-run').innerText()), 'the bar shows the song to get');
    await shot('getsongs-1');
    wantedList[0].status = 'found';
    await page.evaluate(() => window.__shEmit('import:done', { entries: [{ origin: 'picked' }] }));
    await page.waitForTimeout(800);
    const last = cfCalls[cfCalls.length - 1];
    check(last.text === 'Artist 2 Title 2' && last.open === false, `next song copied when the first came in ${JSON.stringify(last)}`);
    check(/Now: Artist 2 – Title 2/.test(await page.locator('.get-run').innerText()) && /1 in so far/.test(await page.locator('.get-run').innerText()), 'the bar moves on');
    await page.locator('.get-run').getByRole('button', { name: 'Skip', exact: true }).click();
    await page.waitForTimeout(500);
    check(cfCalls[cfCalls.length - 1].text === 'Artist 3 Title 3', 'Skip copies the next one');
    wantedList[2].status = 'found';
    await page.evaluate(() => window.__shEmit('import:done', { entries: [{ origin: 'picked' }] }));
    await page.waitForTimeout(800);
    check(!(await page.locator('.get-run').count()), 'the run ends when nothing is left');
    check(await page.getByText('All done').count() > 0, 'says it is done');
    await shot('getsongs-done');
    await browser.close();relay.quit();server.close();process.exit(results.some(r=>!r.ok)?1:0);
  }
  if (process.env.SH_LISTPOS_ONLY) {
    // 4.0.4: opening a song and coming back keeps your place in the list
    await page.evaluate(async () => (await import('./js/store.js')).setPage('songs'));
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('.scroller').scrollTop = 4000; });
    await page.waitForTimeout(300);
    await shot('listpos-list');
    const row = page.locator('.scroller .row').filter({ hasText: 'Padding' }).nth(3).getByText(/^Padding \d+$/);
    await row.click();
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => document.querySelector('.scroller').scrollTop);
    await row.dblclick();
    await page.waitForTimeout(1500);
    const away = await page.evaluate(async () => (await import('./js/store.js')).state.page);
    check(away !== 'songs', `opening a song leaves the list (${away})`);
    await page.evaluate(async () => (await import('./js/store.js')).setPage('songs'));
    await page.waitForTimeout(600);
    const top = await page.evaluate(() => document.querySelector('.scroller').scrollTop);
    check(Math.abs(top - before) < 2, `back on the list at the same place (${top}, was ${before})`);
    const rows = await page.locator('.scroller .row').filter({ hasText: 'Padding' }).count();
    check(rows > 3, `rows are drawn there (${rows})`);
    await shot('listpos');
    await browser.close();relay.quit();server.close();process.exit(results.some(r=>!r.ok)?1:0);
  }
  if (process.env.SH_TABTUNER) {
    await page.evaluate(async () => { const { state } = await import('./js/store.js'); const a = await import('./js/actions.js'); await a.playAlong([...state.songs.values()][0].id).catch(() => {}); });
    await page.waitForTimeout(2500);
    await page.locator('.hw-views button:has-text("Tab")').click();
    await page.waitForTimeout(800);
    const v1 = await page.evaluate(() => ({ hw: !!document.querySelector('.highway:not([hidden])'), now: document.getElementById('app').className }));
  // 4.2: the tab view has the tuner too: U (or its menu) opens the same small tuner, never two
  {
    const tunerUp = () => page.evaluate(() => ({ tab: !!(() => { const t = document.querySelector('.np-tuner'); return !!t && t.isConnected && !!t.closest('.np-pane') && t.getClientRects().length > 0; })(), hw: !!document.querySelector('.highway:not([hidden]) .hw-tuner:not([hidden])') }));
    await page.keyboard.press('u');
    await page.waitForTimeout(300);
    let tu = await tunerUp();
    check(tu.tab && !tu.hw, `U opens the Tuner tab in the side panel of the tab view, not over the tab (${JSON.stringify(tu)})`);
    if (process.env.SH_TABTUNER) await shot('tab-tuner');
    await page.keyboard.press('u');
    await page.waitForTimeout(300);
    tu = await tunerUp();
    check(!tu.tab, 'U closes it again');
  }
    // 4.2: click the tab to go there, drag it, the wheel, sections with a lead-in
    {
      const pos = () => page.evaluate(async () => (await import('./js/stage.js')).engine.position);
      const box = await page.locator('.tab-canvas').boundingBox();
      const t0 = await pos();
      await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
      await page.waitForTimeout(200);
      const t1 = await pos();
      check(t1 > t0 + 1, `clicking ahead on the tab goes there (${t0.toFixed(2)} → ${t1.toFixed(2)})`);
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6 - 190, box.y + box.height * 0.5, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const t2 = await pos();
      check(Math.abs(t2 - t1 - 1) < 0.35, `dragging the tab left by a second's width moves a second ahead (${t1.toFixed(2)} → ${t2.toFixed(2)})`);
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.wheel(0, 380);
      await page.waitForTimeout(200);
      const t3 = await pos();
      check(t3 > t2 + 1, `the wheel looks ahead (${t2.toFixed(2)} → ${t3.toFixed(2)})`);
      const sec = await page.evaluate(() => { const b = [...document.querySelectorAll('.tab-sections button')].find((x) => x.dataset.i === '1'); return b ? b.textContent : null; });
      if (sec) {
        const want = await page.evaluate(async () => { const s = window.__shPractice?.tab?.sections?.[1]; return s ? { start: s.start, long: s.end - s.start > 30 } : null; });
        await page.locator('.tab-sections button[data-i="1"]').click({ position: { x: 2, y: 8 } });
        await page.waitForTimeout(200);
        const t4 = await pos();
        if (want) check(Math.abs(t4 - Math.max(0, want.start - 1)) < 0.3, `a section starts a second early (${sec}: ${want.start.toFixed(2)} → ${t4.toFixed(2)})`);
      }
      await page.locator('.tab-bar button[title*="ptions" i], .tab-bar button:last-child').last().click().catch(() => {});
      await page.waitForTimeout(250);
      const keys = await page.evaluate(() => [...document.querySelectorAll('.menu button')].map((b) => b.textContent).join(' | '));
      check(/Play or pause/.test(keys) && /Slower or faster/.test(keys), 'the tab menu lists the keys');
      if (process.env.SH_TABTUNER) await shot('tab-menu');
      await page.keyboard.press('Escape');
    }
    await browser.close();relay.quit();server.close();process.exit(results.some(r=>!r.ok)?1:0);
  }
  if(process.env.SH_PICTURES311){
    await shot('311-jam');
    await page.getByRole('button',{name:'Open visualizer',exact:true}).click();
    await page.getByLabel('Jam visualizer').selectOption('orbit');
    await page.locator('.jam-controls').getByRole('button',{name:'Drums',exact:true}).click();
    await page.locator('.jam-drawer').getByRole('button',{name:'Funk',exact:true}).click();
    await page.waitForTimeout(500);await shot('311-visualizer-controls');
    await browser.close();relay.quit();server.close();process.exit(0);
  }
  if(process.env.SH_JAM311){
    check(await page.locator('.nav-section:has-text("Jam")').count()===1,'one unified Jam entry');check(await page.locator('.jam').isHidden(),'starts on dashboard');await shot('311-jam');
    await page.evaluate(async()=>{const {state,setPage}=await import('./js/store.js'),a=await import('./js/actions.js');await a.playSong([...state.songs.values()][0].id,{autoplay:false});setPage('play');});await page.waitForTimeout(700);
    check(await page.evaluate(async()=>{const e=document.querySelector('.nb-art img'),{emit}=await import('./js/store.js');emit('playing');return !e||e===document.querySelector('.nb-art img');}),'artwork node is retained');
    const tones=await page.evaluate(async()=>{const {rig}=await import('./js/rig.js'),{useSlot,bySlot}=await import('./js/tonelib.js'),{refreshSongTone}=await import('./js/song-auto.js');const p=window.__shPractice,old=p.tab;const a={...rig.tone,key:'a',name:'Auto clean'},b={...rig.tone,key:'b',name:'Auto lead'};p.tab={...p.tab,songTones:{base:'a',tones:[a,b],changes:[{t:0,key:'b'}]}};useSlot(1);refreshSongTone(true);const auto=rig.autoSong&&rig.songTone?.name==='Auto lead';useSlot(2);refreshSongTone(true);const manual=!rig.autoSong&&rig.toneId===bySlot(2)?.id;useSlot(1);const back=rig.autoSong&&rig.songTone?.name==='Auto lead';p.tab=old;return {auto,manual,back};});check(tones.auto&&tones.manual&&tones.back,'automatic/manual/return tone switching '+JSON.stringify(tones));
    const exact=await page.evaluate(async()=>{const {rig}=await import('./js/rig.js'),{ProcessedRecorder}=await import('./js/looper.js');const original=rig.captureProcessed;let feed;rig.captureProcessed=async f=>{feed=f;return {rate:48000,close(){}}};const rec=new ProcessedRecorder();await rec.start();feed(Float32Array.of(.25,-.5,.75,-.125),48000);const x=rec.stop();rig.captureProcessed=original;return [...x.L,...x.R].join(',')==='0.25,0.75,-0.5,-0.125';});check(exact,'processed recorder retains exact stereo PCM');
    await page.evaluate(async()=>{const {looper}=await import('./js/looper.js');window.__testLooper=looper;await looper.record();});await page.waitForFunction(()=>window.__testLooper.rec.n>40000,null,{timeout:15000});
    const loop=await page.evaluate(async()=>{const {looper}=await import('./js/looper.js');const before={state:looper.state,n:looper.rec.n,rate:looper.rec.rate};await looper.stopRecording();const r={before,toast:document.querySelector('.toasts')?.textContent,state:looper.state,length:looper.length,signal:looper.L?.some(x=>Math.abs(x)>.00001),finite:looper.L?.every(Number.isFinite)};looper.clear();return r;});check(loop.state==='playing'&&loop.signal&&loop.finite,'native processed loop '+JSON.stringify(loop));
    if(process.env.SH_LOOP_ONLY){await browser.close();relay.quit();server.close();process.exit(results.some(r=>!r.ok)?1:0);}
    await page.getByRole('button',{name:'Open visualizer',exact:true}).click();await page.getByLabel('Jam visualizer').selectOption('orbit');await page.locator('.jam-controls').getByRole('button',{name:'Drums',exact:true}).click();await page.locator('.jam-drawer').getByRole('button',{name:'Funk',exact:true}).click();
    const before=await page.evaluate(async()=>(await import('./js/drums.js')).drums.bpm);const faster=page.locator('.jam-drawer').getByRole('button',{name:'Faster',exact:true});await faster.hover();await page.mouse.down();await page.waitForTimeout(900);await page.mouse.up();const after=await page.evaluate(async()=>(await import('./js/drums.js')).drums.bpm);check(after>before+2,'hold-to-adjust tempo');
    await shot('311-visualizer-controls');await page.keyboard.press('Escape');check(await page.locator('#page-play .drums3').count()===1,'shared drums restored to dashboard');check(!logs.some(l=>/^pageerror/.test(l)||/Visualizer:/.test(l)),'no runtime/shader errors');
    await browser.close();relay.quit();server.close();process.exit(results.some(r=>!r.ok)?1:0);
  }
  if(process.env.SH_REPAIR){
    await page.evaluate(async()=>{const {state}=await import('./js/store.js');const a=await import('./js/actions.js');await a.playSong([...state.songs.values()][0].id,{autoplay:false});});
    const volumes=await page.evaluate(async()=>{const stage=await import('./js/stage.js'),{rig}=await import('./js/rig.js'),{state}=await import('./js/store.js'),a=await import('./js/actions.js');stage.setSongLevel(.63);stage.setYou(.72);const songs=[...state.songs.values()];await a.playSong(songs[1].id,{autoplay:false});return [stage.songLevel(),rig.knobs.volume];});
    check(Math.abs(volumes[0]-.63)<.001&&Math.abs(volumes[1]-.72)<.001,'master volumes persist across songs: '+volumes);
    await page.locator('.nav-section:has-text("Jam")').click();
    await page.waitForTimeout(800);await shot('repair-jam');check(!(await page.getByLabel('Jam visualizer').count()),'the old Aurora/Orbital/Prism picker is gone');
    const layout=await page.evaluate(()=>[...document.querySelectorAll('.jam-chip')].every(e=>e.scrollHeight<=e.clientHeight+2));check(layout,'Jam labels fit their controls');
    await page.keyboard.press('Escape');
    await page.evaluate(async()=>{const {state}=await import('./js/store.js'),a=await import('./js/actions.js');await a.playAlong(state.nowPlaying);});
    const stable=await page.evaluate(async()=>{const {rig}=await import('./js/rig.js'),H=document.querySelector('.highway').__hw;const judge=H.judge;rig._sendAllParams();return judge===H.judge;});check(stable,'tone parameter refresh does not reset note judge');
    check(!(await page.getByRole('button',{name:/Tone match/}).count()),'no Tone match button on the highway');await shot('repair-highway');
    check(!logs.some(l=>/^pageerror/.test(l)||/Visualizer:/.test(l)),'no script or shader errors');
    await browser.close();relay.quit();server.close();process.exit(results.some(r=>!r.ok)?1:0);
  }
  if(process.env.SH_PERFORMANCE){
    await page.locator('.nav-section:has-text("Progress")').click();
    await page.waitForTimeout(1500);
    check(await page.locator('.goal-card').count()===3,'three goals on Progress');
    await page.locator('.goal-grid').scrollIntoViewIfNeeded();
    await page.waitForTimeout(5000);await shot('performance-goals');
    check(await page.locator('.nav-section:has-text("Jam")').count()===1,'Jam is a main navigation item');
    const loaded=await page.evaluate(async()=>{
      const {state}=await import('./js/store.js');const a=await import('./js/actions.js');
      const song=[...state.songs.values()][0];await a.playSong(song.id,{autoplay:false});return song.id;
    });
    await page.waitForTimeout(3000);
    await page.locator('.nav-section:has-text("Jam")').click();await page.waitForTimeout(600);
    await page.getByRole('button',{name:'Play over song · Off',exact:true}).click({force:true});await page.waitForTimeout(800);
    const mix=await page.evaluate(async()=>{const {engine}=await import('./js/stage.js');return {mode:engine.mode,playing:engine.playing,guitar:engine.tracks.find(t=>t.name==='guitar')?.muted};});
    check(mix.mode==='stems'&&mix.playing&&mix.guitar,'Jam backing starts stems with guitar muted');
    await page.getByLabel('Your part',{exact:true}).selectOption('bass');
    const bass=await page.evaluate(async()=>{const {engine}=await import('./js/stage.js');return {guitar:engine.tracks.find(t=>t.name==='guitar')?.muted,bass:engine.tracks.find(t=>t.name==='bass')?.muted};});
    check(!bass.guitar&&bass.bass,'switching Jam part restores guitar and mutes bass');
    await page.waitForTimeout(1000);await shot('performance-jam');
    await page.keyboard.press('Escape');
    check(await page.evaluate(()=>document.querySelector('.jam').hidden),'Jam exits cleanly');
    await page.evaluate(async()=>{const {state}=await import('./js/store.js');const a=await import('./js/actions.js');await a.playAlong(state.nowPlaying);});
    await page.waitForTimeout(1800);await page.keyboard.press('u');
    check(await page.locator('.hw-tuner').isVisible(),'U opens highway tuner');await page.keyboard.press('u');check(!(await page.locator('.hw-tuner').isVisible()),'U closes highway tuner');
    await page.locator('.hw-tools-btn').click();await page.locator('.menu button:has-text("Score attack")').click();await page.waitForTimeout(400);
    check(await page.locator('.attack-hud').isVisible(),'Score attack starts');
    await shot('performance-highway');
    await page.evaluate(()=>{
      const real=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async c=>{
        if(c.video?.mandatory?.chromeMediaSource){
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const g=canvas.getContext('2d');
          const timer=setInterval(()=>{g.fillStyle='#10141e';g.fillRect(0,0,640,360);g.fillStyle='#ffb547';g.fillRect((performance.now()/10)%640,60,40,220);},30);
          const stream=canvas.captureStream(30);stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;
        }return real(c);
      };
    });
    await page.evaluate(async()=>{const {engine}=await import('./js/stage.js');engine.seek(0);await engine.play();});
    await page.locator('.hw-tools-btn').click();await page.locator('.menu button:has-text("Record a video clip")').click();
    await page.waitForFunction(()=>document.querySelector('.hw-tools').textContent.includes('Recording'),null,{timeout:10000});
    check(await page.locator('.hw-tools .hw-chip:visible').count()<=3,'the highway shows one Tools button (plus what is running), not a row of floating buttons');
    await page.waitForTimeout(3500);await page.locator('.hw-tool-live').click();
    await page.waitForFunction(()=>!document.querySelector('.hw-tools').textContent.includes('Recording')&&!document.querySelector('.hw-tools').textContent.includes('Saving'),null,{timeout:15000});
    check(fs.existsSync(path.join(outDir,'export-test.webm')) && fs.statSync(path.join(outDir,'export-test.webm')).size>10000,'WebM export contains encoded video');
    {
      // the sound engine's sound comes with it (4.0.6), and it isn't silence
      const w=path.join(outDir,'export-test.wav');let rms=0,secs=0;
      if(fs.existsSync(w)){const b=fs.readFileSync(w);const n=(b.length-44)>>1;let e=0;for(let i=0;i<n;i++)e+=(b.readInt16LE(44+2*i)/32768)**2;rms=Math.sqrt(e/Math.max(1,n));secs=n/2/b.readUInt32LE(24);}
      check(rms>0.003&&secs>0.3,`the clip has the engine's sound (${secs.toFixed(1)} s, rms ${rms.toFixed(3)})`);
    }
    const errs=logs.filter(l=>/^pageerror/.test(l));check(!errs.length,'no page errors: '+errs.join(';'));
    await browser.close();relay.quit();server.close();process.exit(results.some(r=>!r.ok)?1:0);
  }
  if (process.env.SH_SLOW_TONES) {
    await page.locator('.nav-section:has-text("Tones")').click();
    await page.waitForTimeout(600);
    await page.locator('.tones-tabs button:has-text("In my songs")').click();
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
    check((await page.locator('.find-items .tone-item').count()) > 0 && (await page.locator('.read-bar').count()) === 0, 'and the song tones appear');
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
  const playingBefore = await page.evaluate(async () => (await import('/src/renderer/js/stage.js')).engine.playing);
  await page.keyboard.press('h');
  await page.waitForTimeout(2500);
  // 4.1.6: the first time on the highway with a guitar, the timing check introduces itself
  const firstSync = await page.locator('.hw-syncbox:not([hidden]) h3').textContent().catch(() => '');
  check(/timing check/i.test(firstSync || ''), `the first highway visit offers the timing check: “${firstSync}”`);
  await shot('6a-highway-first-sync');
  await page.locator('.hw-syncbox button:has-text("Not now")').click().catch(() => {});
  await page.waitForTimeout(300);
  check(await page.locator('.hw-syncbox').isHidden(), 'Not now closes it');
  // the timing check plays its own short song through the song player, then gives yours back
  {
    const stageNow = () => page.evaluate(async () => { const { engine } = await import('/src/renderer/js/stage.js'); const H = document.querySelector('.highway').__hw; return { id: H.song && H.song.id, title: H.song && H.song.title, dur: engine.duration, at: engine.position, playing: engine.playing, training: !!H.training }; });
    if (await page.evaluate(async () => (await import('/src/renderer/js/stage.js')).engine.playing)) await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const was = await stageNow();
    await page.evaluate(() => document.querySelector('.highway').__openSync());
    await page.locator('.hw-syncbox:not([hidden]) button:has-text("Start")').click().catch(() => {});
    await page.waitForFunction(() => { const H = document.querySelector('.highway').__hw; return H.training && H.clock > 6; }, null, { timeout: 30000 }).catch(() => {});
    const tr = await stageNow();
    check(tr.training && tr.playing && tr.at > 5 && tr.dur > 24 && tr.dur < 30, `the timing check plays its own song on the highway (${tr.title}, ${tr.at.toFixed(1)} of ${tr.dur && tr.dur.toFixed(1)} s)`);
    check(await page.locator('.hw-trainbar').isVisible(), 'the timing check shows how far along it is');
    await shot('6a2-highway-timing-check');
    await page.locator('.hw-trainbar button:has-text("Stop")').click().catch(() => {});
    await page.waitForTimeout(1500);
    const back = await stageNow();
    check(!back.training && back.id === was.id && Math.abs(back.dur - was.dur) < 0.05 && Math.abs(back.at - was.at) < 0.5, `Stop gives the song back where it was (${back.title} at ${back.at.toFixed(1)} s of ${back.dur.toFixed(1)})`);
  }
  if (playingBefore && !(await page.evaluate(async () => (await import('/src/renderer/js/stage.js')).engine.playing))) await page.keyboard.press('Space');
  await page.waitForTimeout(1000);
  await shot('6b-highway');
  await page.waitForTimeout(3000);
  await shot('6c-highway');
  // 3.12: the moving scenes behind the highway
  for (const id of ['nebula', 'swarm', 'mandala', 'strings']) {
    await page.evaluate((v) => { document.querySelector('.highway').__hw.prefs.venue = v; }, id);
    await page.waitForTimeout(2500);
    const drawn = await page.evaluate(() => !!document.querySelector('.highway canvas.hw-visual') && !document.querySelector('.highway iframe.hw-fluid'));
    check(drawn, `${id} draws behind the highway`);
    await shot(`6g-highway-${id}`);
  }
  await page.evaluate(() => { document.querySelector('.highway').__hw.prefs.venue = 'warehouse'; });
  await page.waitForTimeout(600);
  check(await page.evaluate(() => !document.querySelector('.highway canvas.hw-visual')), 'a photo venue puts the scene away');
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
  await page.locator('.tones-tabs button:has-text("In my songs")').click();
  await page.waitForTimeout(2500);
  await page.locator('.find-items .tone-item .ti-main').first().click();
  await page.waitForTimeout(800);
  // 3.13: a picked tone shows the simple view first: what it is, play it, put it on a key
  check((await page.locator('.tones-edit .ts-keys .ts-key').count()) === 8 && (await page.locator('.tones-edit .knobs3').count()) === 0, 'Tones opens a tone simply: keys 2–9 to put it on, no knobs in the way');
  await shot('7a-tones-simple');
  await page.locator('.tones-edit button:has-text("Edit tone")').click();
  await page.waitForTimeout(1200);
  check((await page.locator('.modal.rig-room .rb-piece').count()) > 0, 'Edit tone opens the rig');
  await shot('7b-tones-song');
  await page.locator('.rr-name').fill('Song tone copy');
  await page.locator('.rr-save').click();
  await page.waitForTimeout(800);
  check(await page.evaluate(async () => { const { tonelib } = await import('/src/renderer/js/tonelib.js'); return tonelib.list.some((t) => t.name === 'Song tone copy'); }), 'saving a song tone makes your own copy');
  await page.locator('.rr-close').click();
  await page.waitForTimeout(600);
  await page.locator('.tones-edit .demo-btn').first().click();
  await page.waitForTimeout(1500);
  check((await page.locator('.tones-edit .demo-btn[aria-pressed="true"]').count()) === 1, 'demo riff plays through the tone');
  await shot('7c-tones-demo');
  // looper: record a couple of seconds of the fake guitar
  await page.locator('.nav-section:has-text("Jam")').click();
  await page.waitForTimeout(800);
  await page.locator('.looper3 .btn.rec').click();
  // 4.1.7: starting a recording takes 3–6 s on a slow test machine (the sound engine starts capturing);
  // wait until it says Recording, then record 3 s (a fixed 4 s wait passed or failed by luck)
  for (let i = 0; i < 60 && !/Recording/.test((await page.locator('.looper3 .lp-status').textContent().catch(() => '')) || ''); i++) await page.waitForTimeout(250);
  await page.waitForTimeout(3000);
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
  await page.locator('.nav-section:has-text("Progress")').click();
  await page.waitForTimeout(1200);
  // 4.5: the library-by-score bar moved to Progress › Song mastery
  const pnextN = await page.locator('.pnext .btn').count();
  await page.locator('.pg-tabs [data-tab="songs"]').click().catch(() => {});
  await page.waitForTimeout(800);
  const pmN = await page.locator('.pmastery .pm-key').count();
  await page.locator('.pg-tabs [data-tab="overview"]').click().catch(() => {});
  check(pnextN === 1 && pmN === 4, `Progress suggests what to practise next and shows your songs by mastery (“${((await page.locator('.pnext h2').textContent().catch(() => '')) || '').slice(0, 50)}”)`);
  await shot('8b-progress-top');
  // Settings › Stems: lossless FLAC (the default) or smaller Opus (4.4)
  await page.keyboard.press('Control+Comma');
  await page.waitForTimeout(800);
  await page.locator('.modal button:has-text("Stems")').first().click();
  await page.waitForTimeout(1200);
  check((await page.locator('.modal select[aria-label="How stems are stored"] option').count()) === 2 && (await page.locator('.modal select[aria-label="How stems are stored"]').inputValue()) === 'flac', 'stems are stored as FLAC, with a smaller Opus choice');
  await shot('10-settings-stems');
  await page.locator('.modal button:has-text("Guitar & audio")').first().click();
  await page.waitForTimeout(1500);
  await shot('11-settings-guitar');
  check(await page.locator('.modal select[aria-label="Sound engine"]').count() === 1, 'Settings has Guitar & audio');

  // Tones (4.1.9): keys never change on a click; put on a key asks / undoes; edits are a draft
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await tonesOverhaul();
  await page.locator('.tones-tabs button:has-text("Presets")').click();
  await page.locator('.nav-section:has-text("Jam")').first().click();
  await page.waitForTimeout(500);
  await page.locator('.nav-section:has-text("Tones")').click();
  await page.waitForTimeout(600);
  check((await page.locator('.tones-tabs button[aria-pressed="true"]').textContent()) === 'Presets', 'Tones remembers where you were looking');

  // picking a song's tone on Tones really puts that tone on your guitar
  await page.locator('.tones-tabs button:has-text("In my songs")').click();
  await page.waitForTimeout(2500);
  const songRows = page.locator('.find-items .tone-item .ti-main');
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
  check((await page.locator('.tm .tm-keys .tm-key').count()) === 9, 'highway tone menu lists your keys 1–9');
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
  for (let i = 0; i < 3 && !(await page.locator('.nav-section:has-text("Jam")').first().isVisible()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
  await page.locator('.nav-section:has-text("Jam")').first().click();
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
  await page.locator('.find-items .tone-item .ti-main:has-text("Crunch")').first().click();
  await page.waitForTimeout(2500);
  check((await page.locator('.tone-item:has(.ti-main:has-text("Crunch")) > .real-badge').count()) >= 1, 'the tone list marks it REAL');
  // 4.6: the amp's real/modelled strip lives in the rig (Edit tone)
  const closeRig = async () => {
    await page.locator('.rr-close').click();
    await page.waitForTimeout(400);
    if (await page.locator('.modal:not(.rig-room) button:has-text("Close")').count()) await page.locator('.modal:not(.rig-room) button:has-text("Close")').last().click();
    await page.waitForTimeout(600);
  };
  await page.locator('.tones-edit button:has-text("Edit tone")').click();
  await page.waitForTimeout(1500);
  check((await page.locator('.ra-strip.real .ra-ladder i').count()) === 3 && (await page.locator('.ra-strip.real .ra-ladder i.on').count()) === 1, 'the amp card shows the three gain captures, one lit');
  await shot('14-tones-real-amp');
  await page.locator('.ra-seg button:has-text("Modelled")').click();
  await until(async () => (await page.evaluate(() => window.__rig.capture)) === null);
  check((await page.evaluate(() => window.__rig.capture)) === null && (await page.locator('.ra-strip:not(.real)').count()) === 1, 'Modelled switches this tone to the modelled amp');
  await page.locator('.ra-seg button:has-text("Real")').click();
  await until(() => page.evaluate(() => !!window.__rig.capture));
  check(!!(await page.evaluate(() => window.__rig.capture)), 'Real switches it back');
  await closeRig();
  await page.locator('.find-items .tone-item .ti-main:has-text("Metal")').first().click();
  await page.waitForTimeout(1000);
  await page.locator('.tones-edit button:has-text("Edit tone")').click();
  await page.waitForTimeout(2000);
  check((await page.locator('.ra-offer .ra-get').count()) === 1 && (await page.locator('.ra-offer :text("Mesa Dual Rectifier")').count()) === 1, 'a Cali-100 tone offers the real Rectifier');
  await shot('15-tones-get-real-amp');
  await page.locator('.ra-offer .ra-get').click();
  await page.waitForTimeout(800);
  check((await page.locator('.toast:has-text("Connect TONE3000 first")').count()) === 1, 'without a TONE3000 key it points you to the one-time setup');
  await closeRig();
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
  await page.locator('.tones-tabs button:has-text("In my songs")').click();
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
  // 4.0.9: the highway's panel follows the split (it stayed at the first percentage)
  await page.evaluate((id) => window.__shEmit('stems:update', { songId: id, state: 'running', progress: 0.72 }), firstId);
  await page.waitForTimeout(500);
  const moved = await page.evaluate(() => (document.querySelector('.hw-status:not([hidden])') || {}).textContent || '');
  check(/72%/.test(moved), `the highway's stems panel moves with the split: “${moved.slice(0, 50)}”`);
  const playingBefore2 = await page.evaluate(() => window.__stagePlaying && window.__stagePlaying());
  stemHold.delete(firstId);
  await page.evaluate((id) => window.__shEmit('stems:update', { songId: id, state: 'ready' }), firstId);
  let started = false;
  for (let i = 0; i < 40 && !started; i++) {
    await page.waitForTimeout(250);
    started = await page.evaluate(() => document.querySelector('.stem-wait').hidden && !!(window.__stagePlaying && window.__stagePlaying()));
  }
  check(!playingBefore2 && started, 'and starts by itself once they’re in');

  // ---- 3.13: song switching never leaves the wrong song, a dead spinner, or a silent stall ----
  {
    const ids3 = library.snapshot().songs.map((x) => x.id);
    // (the test library has two songs: A and B)
    const [sA, sB] = ids3;
    const hwState = () =>
      page.evaluate(async () => {
        const st = await import('/src/renderer/js/stage.js');
        const info = st.loadInfo();
        const hw = window.__shHighway;
        const box = document.querySelector('.hw-status');
        return { phase: info.phase, song: info.song && info.song.id, err: info.error, hwSong: hw.songId(), tabFor: hw.tab() && hw.tab()._for, status: box && !box.hidden ? box.textContent : '', playing: !!window.__stagePlaying(), open: hw.open() };
      });
    const along = (id) => page.evaluate(async (id) => (await import('/src/renderer/js/actions.js')).playAlong(id), id).catch(() => {});
    const until = async (fn, ms = 10000) => {
      const t0 = Date.now();
      let v;
      while (Date.now() - t0 < ms) {
        v = await hwState();
        if (fn(v)) return v;
        await page.waitForTimeout(200);
      }
      return v;
    };
    // rapid switching: B's part answers slowly, A is picked straight after: A must win
    tabDelay.set(sB, 2500);
    along(sB);
    await page.waitForTimeout(150);
    along(sA);
    let v = await until((x) => x.phase === 'ready' && x.tabFor === sA);
    await page.waitForTimeout(2800); // B's late answer arrives now
    v = await hwState();
    check(v.song === sA && v.hwSong === sA && v.tabFor === sA, `rapid switching: the last song picked is on the highway, not a late answer for the one before (${JSON.stringify({ song: v.song === sA, hw: v.hwSong === sA, tab: v.tabFor === sA })})`);
    tabDelay.clear();
    // a song that fails to open: says so on the highway, nothing old plays, Try again and Back work
    along(sB);
    await until((x) => x.phase === 'ready' && x.tabFor === sB && !x.status);
    audioFail.add(sA);
    along(sA);
    v = await until((x) => x.phase === 'error');
    check(v.phase === 'error' && !v.playing && /didn’t open/.test(v.status) && /Try again/.test(v.status) && /Back to/.test(v.status), `a failed song says so on the highway with Try again and Back (“${v.status.slice(0, 90)}”)`);
    check(v.song === sA && v.hwSong === sA, 'and the highway shows the song that failed, not the one before');
    await shot('22b-song-failed');
    // picking the same song again tries again (it used to do nothing)
    audioFail.delete(sA);
    along(sA);
    v = await until((x) => x.phase === 'ready' && x.tabFor === sA && !x.status, 25000); // its stems load too: slow here
    check(v.phase === 'ready' && v.tabFor === sA && !v.status, `picking the failed song again opens it (${v.phase}${v.status ? `, still showing “${v.status.slice(0, 40)}”` : ''})`);
    // Try again and Back on the panel
    audioFail.add(sB);
    along(sB);
    v = await until((x) => x.phase === 'error' && x.song === sB);
    await page.locator('.hw-status button:has-text("Back to")').click();
    v = await until((x) => x.phase === 'ready' && x.song === sA);
    check(v.song === sA && v.tabFor === sA, 'Back to the previous song goes back to it');
    along(sB);
    v = await until((x) => x.phase === 'error' && x.song === sB);
    audioFail.delete(sB);
    await page.locator('.hw-status button:has-text("Try again")').click();
    v = await until((x) => x.phase === 'ready' && x.song === sB && x.tabFor === sB);
    check(v.phase === 'ready' && v.tabFor === sB, 'Try again opens it once it works');
    // loading shows on the highway, and leaving the highway mid-load and coming back shows the new song
    along(sA);
    await until((x) => x.phase === 'ready' && x.tabFor === sA && !x.status);
    audioDelay.set(sB, 3000);
    along(sB);
    await page.waitForTimeout(500);
    v = await hwState();
    check(v.phase === 'loading' && /Opening/.test(v.status), `while a song opens the highway says so (“${v.status.slice(0, 50)}”)`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.evaluate(async () => (await import('/src/renderer/js/stage.js')).openHighway());
    v = await until((x) => x.phase === 'ready' && x.tabFor === sB && !x.status);
    check(v.open && v.song === sB && v.hwSong === sB && v.tabFor === sB && !v.status, 'leaving the highway while a song opens and coming back shows that song, ready');
    audioDelay.clear();
    // a song still finishing up when you pick the next one must not start the new one playing
    // (here: the new one waits for its stems, so nothing should play)
    stemsDelay.set(sA, 2000);
    stemHold.add(sB);
    along(sA);
    await page.waitForTimeout(900); // A has its audio, and is asking about its stems
    along(sB);
    v = await until((x) => x.phase === 'ready' && x.song === sB && /Splitting/.test(x.status));
    await page.waitForTimeout(2500); // A's late answer comes now
    v = await hwState();
    check(v.song === sB && /Splitting/.test(v.status) && !v.playing, `an older song finishing late doesn't press play on the new one (${JSON.stringify({ song: v.song === sB, waiting: /Splitting/.test(v.status), playing: v.playing })})`);
    // 4.4: it waits for its stems however long they take (it used to give up after 15 s)
    await page.waitForTimeout(16000);
    v = await hwState();
    check(!v.playing && v.song === sB && /Splitting/.test(v.status), `a song waiting for slow stems keeps waiting for them (${JSON.stringify({ playing: v.playing, status: v.status.slice(0, 30) })})`);
    stemHold.delete(sB);
    stemsDelay.clear();
    await page.evaluate((id) => window.__shEmit('stems:update', { songId: id, state: 'ready' }), sB);
    v = await until((x) => x.playing, 10000);
    check(v.playing && v.song === sB && !v.status, 'and starts by itself once they are in');
    // back to the first song for the rest of the run
    along(firstId);
    await until((x) => x.phase === 'ready' && x.tabFor === firstId);
  }
  // 3.7: Tab | Waveform on the highway, and Back goes to your songs
  await page.mouse.move(400, 300);
  await page.mouse.move(420, 320);
  await page.waitForTimeout(300);
  await page.locator('.hw-views button:has-text("Tab")').click();
  await page.waitForTimeout(600);
  const v1 = await page.evaluate(() => ({ hw: !!document.querySelector('.highway:not([hidden])'), now: document.getElementById('app').className }));
  check(!v1.hw && /now/.test(v1.now), 'Tab on the highway switches to the Tab view of the song');
  // 4.2: the tab view has the tuner too: U (or its menu) opens the same small tuner, never two
  {
    const tunerUp = () => page.evaluate(() => ({ tab: !!(() => { const t = document.querySelector('.np-tuner'); return !!t && t.isConnected && !!t.closest('.np-pane') && t.getClientRects().length > 0; })(), hw: !!document.querySelector('.highway:not([hidden]) .hw-tuner:not([hidden])') }));
    await page.keyboard.press('u');
    await page.waitForTimeout(300);
    let tu = await tunerUp();
    check(tu.tab && !tu.hw, `U opens the Tuner tab in the side panel of the tab view, not over the tab (${JSON.stringify(tu)})`);
    if (process.env.SH_TABTUNER) await shot('tab-tuner');
    await page.keyboard.press('u');
    await page.waitForTimeout(300);
    tu = await tunerUp();
    check(!tu.tab, 'U closes it again');
  }
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
  // 3.11: the Jam menu item is the Jam dashboard; Open visualizer (or J) goes full screen
  await page.locator('.nav-section:has-text("Jam")').first().click();
  await page.waitForTimeout(800);
  await shot('24-jam-home');
  await page.getByRole('button', { name: 'Open visualizer' }).first().click();
  await page.waitForTimeout(4000);
  const jam = await page.evaluate(() => ({ open: !document.querySelector('.jam').hidden, frame: !!document.querySelector('.jam .hw-fluid'), ready: !!(document.querySelector('.jam .hw-fluid') && document.querySelector('.jam .hw-fluid').contentWindow.FluidVisuals) }));
  check(jam.open && jam.frame && jam.ready, 'Jam opens full screen with the Fluid picture');
  await page.evaluate(() => document.querySelector('.jam .hw-fluid').contentWindow.FluidVisuals.splats([{ x: 0.3, y: 0.3, dx: 400, dy: 900, r: 0.2, g: 0.05, b: 0.25, radius: 1.2 }, { x: 0.7, y: 0.3, dx: -400, dy: 900, r: 0.05, g: 0.15, b: 0.3, radius: 1.2 }]));
  await page.waitForTimeout(2500);
  await page.mouse.move(300, 300);
  await shot('25-jam');
  // 3.12: Jam's look picker: Fluid and the four scenes
  check((await page.getByLabel('Jam look').locator('option').count()) === 6, 'Jam offers Fluid and five scenes (4.5: Valhalla)');
  // 4.5: scenes open with levels; a new player sees them locked, then (developer unlock) all of them
  await page.getByLabel('Jam look').focus();
  check(await page.evaluate(() => [...document.querySelector('select[aria-label="Jam look"]').options].some((o) => o.disabled && /level/.test(o.textContent))), 'Jam shows locked scenes with their level');
  await global.__levels.unlockAll(true);
  await page.evaluate(async () => (await import('/src/renderer/js/rewards.js')).loadLevels());
  await page.getByLabel('Jam look').focus();
  for (const id of ['nebula', 'swarm', 'mandala', 'strings', 'valhalla']) {
    await page.getByLabel('Jam look').selectOption(id);
    await page.waitForTimeout(2500);
    check(await page.evaluate(() => !!document.querySelector('.jam canvas.hw-visual') && !document.querySelector('.jam iframe.hw-fluid')), `Jam shows ${id}`);
    await shot(`25-jam-${id}`);
  }
  await page.getByLabel('Jam look').selectOption('fluid');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.querySelector('.jam').hidden && !document.querySelector('.jam .hw-fluid')), 'Esc leaves Jam and stops the picture');

  // 4.3: Backstage, just above Getting started: who's here and their clips, then My clips (every recording, playable here)
  await takes.save({ name: 'Integration', seconds: 1, rate: 48000, channels: 1, pcm: new Uint8Array(new Float32Array(48000).fill(0.05).buffer) });
  check(await page.evaluate(() => { const s = [...document.querySelectorAll('.nav-section')].map((b) => b.dataset.page); return s.length > 1 && s[s.length - 1] === 'guide' && s[s.length - 2] === 'greenroom'; }), 'Backstage is just above Getting started, which is last on the menu');
  await page.locator('.nav-section[data-page="greenroom"]').click();
  await page.waitForSelector('#page-greenroom .gr-card', { timeout: 10000 });
  const cardText = await page.evaluate(() => document.querySelector('#page-greenroom .gr-card').textContent);
  check(/Sam/.test(cardText) && /Lead/.test(cardText) && /Crunch/.test(cardText), `a clip in the room shows who, the part and the tone (${cardText.slice(0, 80)})`);
  await shot('28-greenroom');
  await page.locator('#page-greenroom .gr-tabs [data-tab="mine"]').click();
  await page.waitForSelector('#page-greenroom .gr-row', { timeout: 10000 });
  const rec = await page.evaluate(() => [...document.querySelectorAll('#page-greenroom .gr-row')].map((r) => r.textContent));
  check(rec.some((t) => /Integration/.test(t) && /0:01/.test(t) && /KB|MB/.test(t)), `My clips lists takes with length and size (${rec[0] && rec[0].slice(0, 70)})`);
  await page.locator('#page-greenroom .gr-row .round-play').first().click();
  await page.waitForTimeout(600);
  check(await page.evaluate(() => !!document.querySelector('#page-greenroom .gr-player audio, #page-greenroom .gr-player video')), 'a recording plays inside Stagehand');
  await shot('28-recordings');

  // reopening Stagehand on Tones › From my songs (the tab is remembered) must start reading by itself
  await page.evaluate(() => localStorage.setItem('stagehand.tonesFind', 'songs'));
  await page.reload();
  await page.waitForTimeout(3000);
  await page.locator('.nav-section:has-text("Tones")').click();
  let appeared = false;
  for (let i = 0; i < 40 && !appeared; i++) {
    await page.waitForTimeout(250);
    appeared = (await page.locator('.find-items .tone-item').count()) > 0;
  }
  check(appeared, 'opening Tones on From my songs reads your songs by itself (no click needed)');

  // 4.1.6: the tuner follows the song you open (a hand-picked tuning lasts until the next song)
  await page.locator('.nav-section[data-page="play"]').click();
  await page.waitForTimeout(600);
  const tunerSays = () => page.evaluate(() => { const s = document.querySelector('#page-play .tuner3 select'); return s ? s.options[s.selectedIndex].text + ' | ' + [...document.querySelectorAll('#page-play .tuner3 .tn-strings button')].map((b) => b.textContent).join(' ') : ''; });
  await page.evaluate(async () => (await import('/src/renderer/js/rig.js')).rig.setSongTuning([-2, 0, 0, 0, 0, 0], 'guitar', 0));
  await page.waitForTimeout(300);
  const t1 = await tunerSays();
  check(/^Drop D \(the song\) \| D A D G B E/.test(t1), `the tuner follows a Drop D song: “${t1}”`);
  await page.selectOption('#page-play .tuner3 select', 'drop-c');
  await page.evaluate(async () => (await import('/src/renderer/js/rig.js')).rig.setSongTuning([0, 0, 0, 0, 0, 0], 'guitar', 0));
  await page.waitForTimeout(300);
  const t2 = await tunerSays();
  check(/^E Standard \(the song\) \| E A D G B E/.test(t2), `back to an E Standard song, the tuner goes with it: “${t2}”`);

  // 4.1.6: search suggestions, Tab to finish, a picked song clears the search; going elsewhere clears it too
  await page.locator('.nav-section[data-page="songs"]').first().click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+f');
  await page.keyboard.type('integ');
  await page.waitForTimeout(400);
  check((await page.locator('.search-pop .sp-item[data-kind="artist"]').count()) >= 1, 'search suggests the artist as you type');
  await page.keyboard.press('Tab');
  check((await page.inputValue('#search')) === 'integration', 'Tab finishes the name');
  await page.locator('.nav-item:has-text("Favorites")').first().click();
  await page.waitForTimeout(400);
  check((await page.inputValue('#search')) === '', 'going to another list clears the search');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(400);
  check((await page.inputValue('#search')) === 'integration', 'Back brings the search back');
  await page.locator('#search').click();
  await page.waitForTimeout(300);
  await page.locator('.search-pop .sp-item[data-kind="song"]').first().click();
  await page.waitForTimeout(500);
  check((await page.inputValue('#search')) === '' && (await page.locator('.row.sel').count()) === 1, 'picking a suggested song clears the search and selects it');
  await page.keyboard.press('ArrowDown');
  check((await page.evaluate(() => getComputedStyle(document.querySelector('.scroller')).outlineStyle)) === 'none', 'the song list has no outline box when you use the keys');

  // 4.1.6: Getting started: the tour of every section, Show me and back
  await page.locator('.nav-section[data-page="guide"]').click();
  await page.waitForTimeout(600);
  const pages = await page.locator('.gs-step span').allTextContents();
  check(['Tune up', 'The highway', 'Stems: mute any part', 'Songs', 'Jam', 'Tones', 'Progress', 'Discover', 'Backstage'].every((t) => pages.includes(t)), `Getting started covers every section: ${pages.join(' / ')}`);
  await shot('40-guide-welcome');
  await page.locator('.gs-step:has-text("Stems")').click();
  await page.waitForTimeout(250);
  await shot('41-guide-stems');
  await page.locator('.gs-show button').click();
  await page.waitForTimeout(900);
  check((await page.locator('.gs-ring:not([hidden])').count()) === 1 && /stems/i.test((await page.locator('.gs-tip').textContent()) || ''), 'Show me rings the Split stems button');
  await shot('42-guide-showme');
  await page.locator('.gs-tip button:has-text("Back to the guide")').click();
  await page.waitForTimeout(500);
  check(/Stems/.test((await page.locator('.gs-step.on span').textContent()) || ''), 'and Back to the guide returns to the same page');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 4.1.7: Create tone, step by step, live on the guitar; saves on a key
  await page.locator('.nav-section[data-page="play"]').click();
  await page.waitForTimeout(600);
  await page.locator('#page-play button:has-text("Create tone")').click();
  await page.waitForTimeout(1200);
  check((await page.locator('.modal.rig-room .rr-live').count()) === 1, 'Create tone opens the rig with your guitar live');
  await page.locator('.rr-guide').click();
  await page.waitForTimeout(800);
  check((await page.locator('.tw-modal .tw-live').count()) === 1, 'Step by step instead opens the helper, live too');
  await page.locator('.tw-card:has-text("Guitar")').click();
  await page.waitForTimeout(400);
  await page.locator('.tw-card:has-text("Heavy metal")').click();
  await page.waitForTimeout(500);
  const heard = await page.evaluate(async () => { const { rig } = await import('/src/renderer/js/rig.js'); return rig.mode + ' ' + (rig.liveTone ? rig.liveTone.gear.map((g) => g.key).join('>') : ''); });
  check(/^live .*Amp_CA100/.test(heard), `picking Metal plays it straight away (${heard})`);
  await page.locator('.tw-modal footer button:has-text("Next")').click();
  await page.waitForTimeout(400);
  check((await page.locator('.tw-card .gear-art.amp').count()) >= 10, 'every real guitar amp is offered, with a picture');
  await shot('43-create-tone-amps');
  await page.locator('.tw-modal footer button:has-text("Next")').click();
  await page.locator('.tw-card:has-text("4×12 slant")').click();
  await page.locator('.tw-modal footer button:has-text("Next")').click();
  check((await page.locator('.tw-modal .pb-pedal').count()) >= 1, 'Create tone has a Pedals step with the sound’s pedals');
  await page.locator('.tw-modal footer button:has-text("Next")').click();
  await page.locator('.tw-modal footer button:has-text("Next")').click();
  await page.waitForTimeout(400);
  await page.locator('.tw-name').fill('Test metal');
  await page.locator('.tw-key').nth(3).click();
  await page.locator('.tw-modal footer button:has-text("Save tone")').click();
  await page.waitForTimeout(800);
  const made = await page.evaluate(async () => { const { tonelib } = await import('/src/renderer/js/tonelib.js'); const t = tonelib.list.find((x) => x.name === 'Test metal'); return t ? `${t.slot} ${t.cabId}` : ''; });
  check(made === '5 4x12_slant', `the new tone is saved on key 5 with its cabinet (${made})`);
  await page.locator('.tw-modal footer button:has-text("Done")').click();
  await page.waitForTimeout(400);
  await createTonePedals();
  await page.locator('.nav-section[data-page="play"]').click();
  await page.waitForTimeout(400);
  check((await page.locator('#page-play .bk-art .gear-art').count()) >= 2, 'the rig shows pictures of its gear');

  // the plain browser can't open the app's own stagehand:// files (Electron registers them); recplay-electron.js plays them for real
  const errs = logs.filter((l) => /^(pageerror)/.test(l) || (/^error/.test(l) && !/404|Failed to load resource|favicon|'stagehand:\/\/take\//.test(l)));
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
