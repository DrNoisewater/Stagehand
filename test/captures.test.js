'use strict';
/**
 * Real amp captures: the TONE3000 sign-in and download flow against a stand-in
 * TONE3000 server, picking models by gain, your own .nam files, and running a
 * downloaded capture in the amp engine (WebAssembly build).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EX = path.join(ROOT, 'test', 'fixtures', 'nam');
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

/** A minimal ZIP (stored, no compression) for the test. */
function storedZip(files) {
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (b) => {
    let c = -1;
    for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const parts = [];
  const central = [];
  let off = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text);
    const nb = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc(data), 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc(data), 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nb.length, 28);
    c.writeUInt32LE(off, 42);
    central.push(c, nb);
    off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

(async () => {
  const small = fs.readFileSync(path.join(EX, 'wavenet.nam'), 'utf8');
  const lstm = fs.readFileSync(path.join(EX, 'lstm.nam'), 'utf8');
  const seen = { auth: [], token: 0, bearer: 0 };
  const names = ['MESADUAL - RED - MODERN - GAIN 1', 'MESADUAL - RED - MODERN - GAIN 5', 'MESADUAL - RED - MODERN - GAIN 9', 'MESADUAL - RED - VINTAGE - GAIN 5', 'MESADUAL - RED - MODERN - GAIN MAX'];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, st = 200) => res.writeHead(st, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
    const authed = req.headers.authorization === 'Bearer acc-1';
    if (u.pathname === '/api/v1/oauth/authorize') {
      seen.auth.push(Object.fromEntries(u.searchParams));
      const back = new URL(u.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'code-1');
      back.searchParams.set('state', u.searchParams.get('state'));
      if (u.searchParams.get('prompt') === 'load_tone') back.searchParams.set('tone_id', u.searchParams.get('tone_id'));
      if (u.searchParams.get('prompt') === 'select_tone') back.searchParams.set('tone_id', '999');
      return res.writeHead(302, { Location: back.toString() }).end();
    }
    if (u.pathname === '/api/v1/oauth/token' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const q = new URLSearchParams(b);
        seen.token++;
        seen.verifier = q.get('code_verifier');
        json({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600, token_type: 'bearer' });
      });
      return;
    }
    if (!authed) return json({ error: 'unauthorized' }, 401);
    seen.bearer++;
    if (u.pathname === '/api/v1/user') return json({ username: 'rockfan', display_name: null });
    if (u.pathname === '/api/v1/tones/70207') return json({ id: 70207, title: 'MESA DUAL RECTIFIER (REV G 1998) - FULL GAIN PACK', user: { username: 'deathblossomaudio', url: 'https://example/deathblossomaudio' }, license: 'T3K', gear: 'amp', url: 'https://www.tone3000.com/tones/x-70207' });
    if (u.pathname === '/api/v1/tones/999') return json({ id: 999, title: 'Some LSTM amp', user: { username: 'someone' }, license: 'T3K', gear: 'full-rig' });
    if (u.pathname === '/api/v1/models') {
      const id = u.searchParams.get('tone_id');
      const base = `http://127.0.0.1:${server.address().port}`;
      if (id === '70207')
        return json({
          data: [
            ...names.map((n, i) => ({ id: i + 1, name: n, size: 'standard', architecture_version: '2', model_url: `${base}/files/m${i}.nam` })),
            { id: 50, name: 'MESADUAL - RED - MODERN - GAIN 5', size: 'lite', architecture_version: '2', model_url: `${base}/files/lite.nam` },
            { id: 51, name: 'Not a model', size: '', architecture_version: null, model_url: `${base}/files/ir.wav` },
          ],
        });
      if (id === '999') return json({ data: [{ id: 9, name: 'Amp G7', size: 'standard', architecture_version: '1', model_url: `${base}/files/lstm.nam` }] });
    }
    if (u.pathname.startsWith('/files/')) {
      if (u.pathname === '/files/ir.wav') return res.writeHead(200).end('RIFF....WAVE');
      return res.writeHead(200).end(u.pathname === '/files/lstm.nam' ? lstm : small);
    }
    json({ error: 'not found' }, 404);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.STAGEHAND_T3K_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.STAGEHAND_T3K_PORT = String(40000 + Math.floor(Math.random() * 9000));
  const { Captures, chooseModel, MAP } = require('../src/main/services/captures');

  // 1. the curated map covers the Rocksmith amps it names, with valid packs
  const gear = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/data/gear2014.json'), 'utf8'));
  const amps = Object.keys(gear).filter((k) => /^(Amp_|Bass_Amp_)/.test(k));
  const mapped = amps.filter((k) => MAP.amps[k]);
  ok(mapped.length >= 50, `${mapped.length} of ${amps.length} Rocksmith amps have a real capture to get`);
  ok(Object.values(MAP.amps).every((p) => MAP.packs[p]), 'every amp points at a known pack');
  ok(Object.values(MAP.packs).every((p) => p.toneId > 0 && p.variants.length && /^https:\/\/www\.tone3000\.com\/tones\//.test(p.url)), 'every pack names its TONE3000 tone');
  ok(Object.keys(MAP.amps).every((k) => gear[k]), 'no made-up amp keys in the map');
  // the presets are built on real amps: each one's gain sits on a capture's gain setting
  global.localStorage = global.localStorage || { getItem: () => null, setItem: () => {} };
  const gs = await import(path.join(ROOT, 'src/renderer/js/gearspec.js'));
  gs.setGear(gear);
  const { TONES } = await import(path.join(ROOT, 'src/renderer/js/rig.js'));
  for (const t of TONES) {
    const amp = t.gear.find((g) => g.slot === 'amp');
    const pk = MAP.packs[MAP.amps[amp.key]];
    const g = gs.ampGain(t);
    const near = pk ? Math.min(...pk.variants.map((v) => Math.abs(v.gain - g))) : 1;
    ok(pk && near < 0.02 && t.gear.every((x) => gear[x.key]), `preset ${t.name}: ${gear[amp.key].n} → ${pk ? pk.title : 'no capture'} at gain ${g.toFixed(2)}`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-cap-'));
  const opened = [];
  const caps = new Captures({ dir, openExternal: (url) => (opened.push(url), fetch(url).then(() => true)), log: () => {} });
  await caps.load();

  // 2. nothing without a key, and no download without asking
  let err = null;
  await caps.get('rectifier', 'Amp_CA100').catch((e) => (err = e));
  ok(err && err.code === 'nokey', 'asks you to connect TONE3000 first');
  ok(!opened.length, 'nothing opened in the browser before that');
  let bad = null;
  try {
    caps.setClientId('no');
  } catch (e) {
    bad = e;
  }
  ok(!!bad, 'rejects a key that isn’t one');
  caps.setClientId('pk_test_1234567890');

  // 3. connect (sign in once)
  await caps.connect();
  const st1 = caps.state();
  ok(st1.t3k.connected && st1.t3k.user && st1.t3k.user.username === 'rockfan', 'signed in to TONE3000 as rockfan');
  const a0 = seen.auth[0];
  ok(a0.client_id === 'pk_test_1234567890' && a0.code_challenge_method === 'S256' && a0.code_challenge && a0.response_type === 'code' && !a0.prompt, 'sign-in uses PKCE with your key');
  ok(seen.verifier && seen.verifier.length >= 43, 'token exchange sends the code verifier');

  // 4. get a curated capture: TONE3000's load_tone page, then only the chosen models
  const r = await caps.get('rectifier', 'Amp_CA100');
  const a1 = seen.auth[1];
  ok(a1.prompt === 'load_tone' && a1.tone_id === '70207', 'opens the Rectifier on TONE3000 to confirm');
  const pack = caps.state().packs.find((p) => p.id === r.id);
  ok(pack && pack.models.length === 4, `kept 4 models (the gain variants that exist, no lite duplicate, no IR): ${pack && pack.models.map((m) => m.name).join(', ')}`);
  ok(pack && pack.maker === 'deathblossomaudio' && pack.license === 'T3K' && pack.mapKey === 'rectifier', 'maker, licence and source recorded for credits');
  ok(pack && pack.models.every((m) => fs.existsSync(m.path)), 'model files saved');
  ok(chooseModel(pack, 0.12).name.endsWith('GAIN 1') && chooseModel(pack, 0.55).name.endsWith('GAIN 5') && chooseModel(pack, 0.97).name.endsWith('GAIN MAX'), 'the gain knob picks the matching model');
  ok(seen.bearer > 0, 'downloads use your sign-in');

  // 5. browse TONE3000 (select_tone) for another amp: assigns it
  const r2 = await caps.browse('Amp_CS100');
  const a2 = seen.auth[2];
  ok(a2.prompt === 'select_tone', 'browse opens TONE3000’s picker');
  const st5 = caps.state();
  const p2 = st5.packs.find((p) => p.id === r2.id);
  ok(p2 && p2.kind === 'full' && st5.assign.Amp_CS100 === r2.id, 'the picked full-rig capture now plays for that amp');

  // 6. your own files
  const own = await caps.addFiles([path.join(EX, 'wavenet.nam')], 'Amp_TW22');
  const st6 = caps.state();
  const p3 = st6.packs.find((p) => p.id === own.added[0]);
  ok(p3 && p3.source === 'file' && p3.maker === 'Steve' && st6.assign.Amp_TW22 === p3.id, 'your own .nam file is added, credited to its maker, and used for that amp');
  let notNam = null;
  const tmpTxt = path.join(dir, 'x.nam');
  fs.writeFileSync(tmpTxt, '{"hello": 1}');
  await caps.addFiles([tmpTxt]).catch((e) => (notNam = e));
  ok(!!notNam, 'a file that isn’t a capture is refused');
  // a zip of gain variants (as TONE3000's "Download all" gives) becomes one capture
  const zipPath = path.join(dir, 'pack.zip');
  fs.writeFileSync(zipPath, storedZip([['A2/My Amp Gain 2.nam', small], ['A2/My Amp Gain 9.nam', small], ['A2/My Amp Gain 5.nam', small], ['__MACOSX/A2/._x.nam', 'junk'], ['readme.txt', 'hi']]));
  const z = await caps.addFiles([zipPath]);
  const zp = caps.state().packs.find((p) => p.id === z.added[0]);
  ok(z.added.length === 1 && zp && zp.models.length === 3, 'a zip of three .nam files becomes one capture with three models');
  ok(zp && chooseModel(zp, 0.85).name === 'My Amp Gain 9' && chooseModel(zp, 0.1).name === 'My Amp Gain 2', 'their gain levels come from the names');
  caps.assign('Amp_TW22', 'off');
  ok(caps.state().assign.Amp_TW22 === 'off', 'you can turn the real amp off for an amp');
  await caps.remove(p3.id);
  ok(!caps.state().packs.some((p) => p.id === p3.id) && !fs.existsSync(path.join(dir, p3.id)), 'removing a capture deletes its files');

  // 7. reload keeps everything
  const again = new Captures({ dir, openExternal: () => true, log: () => {} });
  await again.load();
  ok(again.state().packs.length === 3 && again.state().t3k.connected, 'everything is still there after a restart');

  // 7b. TONE3000 in Stagehand's own window; a new Get replaces one left waiting
  // (TONE3000 showed "not compatible" and never sent you back: the next Get must still work)
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-cap2-'));
  const opened2 = [];
  const caps2 = new Captures({
    dir: dir2,
    log: () => {},
    openAuth: (url) => {
      opened2.push(url);
      if (opened2.length === 1) return { promise: new Promise(() => {}), close: () => opened2.push('closed') };
      // the window follows TONE3000's redirect back to us
      return { promise: fetch(url, { redirect: 'manual' }).then((r) => new URL(r.headers.get('location')).toString()), close: () => {} };
    },
  });
  await caps2.load();
  caps2.setClientId('pk_test_1234567890');
  ok(caps2.state().t3k.inApp && !caps2.state().t3k.useBrowser, 'TONE3000 opens in Stagehand’s window by default');
  const stuck = caps2.get('rectifier', 'Amp_CA100').catch((e) => e);
  await new Promise((r) => setTimeout(r, 50));
  const fresh = await caps2.get('rectifier', 'Amp_CA100');
  const e1 = await stuck;
  ok(e1 && e1.code === 'replaced' && opened2.includes('closed'), 'a Get left waiting is closed and replaced by the next one (no “already open”)');
  ok(fresh && caps2.state().packs.some((p) => p.id === fresh.id), 'and the next one downloads');
  caps2.setUseBrowser(true);
  ok(caps2.state().t3k.useBrowser, 'you can switch to your web browser instead');
  fs.rmSync(dir2, { recursive: true, force: true });

  // 8. a downloaded capture runs in the WebAssembly engine
  const wasm = fs.readFileSync(path.join(ROOT, 'src/renderer/worklets/rig-dsp.wasm'));
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const x = instance.exports;
  const need = x.mem_needed();
  if (need > x.memory.buffer.byteLength) x.memory.grow(Math.ceil((need - x.memory.buffer.byteLength) / 65536));
  ok(x.init(48000), 'engine starts');
  const spec = 'kind\tguitar\ngear\tamp\tAmp_CA100\nk\tGain\t50\t0\t100\nk\tBass\t50\t0\t100\ngear\tcab\tCab_CA412_57_Cone\n';
  const put = (s) => {
    const b = new TextEncoder().encode(s);
    new Uint8Array(x.memory.buffer, x.buf_spec(), 16384).set(b.subarray(0, 16383));
    new Uint8Array(x.memory.buffer, x.buf_spec(), 16384)[Math.min(b.length, 16383)] = 0;
  };
  const text = fs.readFileSync(chooseModel(pack, 0.5).path);
  new Uint8Array(x.memory.buffer, x.buf_nam(), text.length).set(text);
  ok(x.set_nam(1, text.length, 0, 0.5, 0) === 1, 'the capture loads into a slot');
  put(spec);
  ok(x.build(1) === 1, 'a tone builds with the capture as its amp');
  put(spec);
  ok(x.build(0) === 1, 'the same tone builds with the modelled amp');
  const junk = new TextEncoder().encode('{"architecture":"ConvNet","config":{},"weights":[1,2]}');
  new Uint8Array(x.memory.buffer, x.buf_nam(), junk.length).set(junk);
  ok(x.set_nam(2, junk.length, 0, 0.5, 0) === 0, 'an unsupported capture is refused (the tone falls back to the modelled amp)');
  const errPtr = x.nam_error();
  const errStr = new TextDecoder().decode(new Uint8Array(x.memory.buffer, errPtr, 200)).split('\0')[0];
  ok(/supported/.test(errStr), `with a reason: “${errStr}”`);
  const run = (slot) => {
    x.select(slot);
    let e = 0;
    let finite = true;
    for (let blk = 0; blk < 200; blk++) {
      const inb = new Float32Array(x.memory.buffer, x.buf_in(), 4096);
      for (let i = 0; i < 128; i++) inb[i] = 0.1 * Math.sin((2 * Math.PI * 110 * (blk * 128 + i)) / 48000);
      x.process(128);
      const L = new Float32Array(x.memory.buffer, x.buf_l(), 128);
      for (let i = 0; i < 128; i++) {
        if (!Number.isFinite(L[i])) finite = false;
        if (blk > 50) e += L[i] * L[i];
      }
    }
    return { rms: Math.sqrt(e / (150 * 128)), finite };
  };
  const real = run(1);
  const modelled = run(0);
  ok(real.finite && real.rms > 0.01, `the real amp makes sound (rms ${real.rms.toFixed(3)})`);
  ok(modelled.finite && Math.abs(20 * Math.log10(real.rms / modelled.rms)) < 15, `and in the same loudness range as the modelled amp (toy test model) (${(20 * Math.log10(real.rms / modelled.rms)).toFixed(1)} dB)`);

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : '\nall ok');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
