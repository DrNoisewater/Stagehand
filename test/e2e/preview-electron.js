/**
 * 4.27.1: the click preview in the real app (Electron), with real song files and the app's own
 * file server. 4.26's preview clips were turned away by that server (their names start with "pv"),
 * so every preview was silent; the Chromium checks use a pretend app and could not see it.
 *  - one click on a song plays its preview: the sound reaches the player's output, the bar shows;
 *  - another song replaces it.
 * 4.29.1 (previews that sometimes didn't play, or stuttered):
 *  - quick clicks across songs: the last one clicked plays, alone, without a gap;
 *  - the app tidied its sound files away (a full cache): a song clicked before still plays.
 * Linux has no Rocksmith audio decoder, so a stand-in one writes a 330 Hz tone (it takes a moment, like a real one).
 *
 *   ELECTRON=<electron 44> xvfb-run -a node test/e2e/preview-electron.js <outDir>
 *   PREVIEW_SONGS=<folder of .psarc files> uses those songs instead of the test ones (three or more).
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const out = process.argv[2] || os.tmpdir();
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

// the stand-in decoder: 6 s of a 330 Hz tone, written where it is asked to
const FAKE = `#!/usr/bin/env node
const fs=require('fs');const a=process.argv;const w=Date.now()+300;while(Date.now()<w);const o=a[a.indexOf('-o')+1];
if(fs.readFileSync(a[a.length-1]).toString('latin1',0,4)==='FAIL')process.exit(2);
const sr=48000,n=sr*6,b=Buffer.alloc(44+n*4);
b.write('RIFF',0);b.writeUInt32LE(36+n*4,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);
b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*4,40);
for(let i=0;i<n;i++){const v=Math.round(Math.sin(2*Math.PI*330*i/sr)*16000);b.writeInt16LE(v,44+i*4);b.writeInt16LE(v,46+i*4);}
fs.writeFileSync(o,b);
`;

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-preview-'));
  const bin = path.join(home, 'bin');
  const songs = path.join(home, 'songs');
  fs.mkdirSync(bin);
  fs.mkdirSync(songs);
  fs.writeFileSync(path.join(bin, 'vgmstream-cli'), FAKE, { mode: 0o755 });
  const from = process.env.PREVIEW_SONGS;
  if (from) for (const f of fs.readdirSync(from).filter((f) => f.endsWith('.psarc'))) fs.symlinkSync(path.join(from, f), path.join(songs, f));
  else for (const f of ['integration_p', 'legacy_p']) fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', `${f}.psarc`), path.join(songs, `${f}.psarc`));
  const app = await _electron.launch({ executablePath: process.env.ELECTRON, args: ['--no-sandbox', ROOT], env: { ...process.env, STAGEHAND_HOME: home, PATH: `${bin}:${process.env.PATH}` } });
  const page = await app.firstWindow();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.waitForTimeout(4000);
  await page.evaluate(async (d) => (await import('./js/api.js')).api.library.addFolder(d), songs);
  await page.waitForFunction(async () => (await import('./js/store.js')).state.songs.size >= 2, null, { timeout: 30000 });
  await page.evaluate(async () => (await import('./js/store.js')).setPage('songs'));
  await page.waitForTimeout(800);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
  await page.evaluate(() => document.querySelectorAll('#overlays .gs').forEach((e) => e.remove())); // Getting started
  await page.evaluate(async () => {
    const pv = await import('./js/preview.js');
    window.__pv = () => pv.previewState();
    // listen to the player's extra sound bus, where the preview goes
    const { engine } = await import('./js/stage.js');
    const { ctx, node } = await engine.extraOut();
    window.__an = ctx.createAnalyser();
    node.connect(window.__an);
    window.__peak = () => { const d = new Float32Array(2048); window.__an.getFloatTimeDomainData(d); let p = 0; for (const v of d) p = Math.max(p, Math.abs(v)); return p; };
    // the quietest moment over a stretch of time (a gap or stutter shows as a dip)
    window.__lowest = (ms) => new Promise((done) => { let low = 9; const t0 = performance.now(); const step = () => { low = Math.min(low, window.__peak()); if (performance.now() - t0 < ms) setTimeout(step, 20); else done(low); }; step(); });
  });
  const rows = page.locator('.row .tt-text');
  const n = await rows.count();
  const idOf = (i) => rows.nth(i).evaluate((e) => e.closest('[data-id]').dataset.id);
  await rows.nth(0).click();
  await page.waitForTimeout(2500);
  let r = await page.evaluate(() => ({ peak: window.__peak(), bar: (() => { const b = document.querySelector('.pv-bar'); return b && !b.hidden ? b.textContent : null; })(), pv: window.__pv() }));
  check(r.pv.plays === 1 && /^stagehand:\/\/audio\/pv/.test(r.pv.url || ''), `the song's own preview clip loads and plays (${JSON.stringify(r.pv)})`);
  check(r.peak > 0.05, `its sound reaches the player's output (peak ${r.peak.toFixed(3)})`);
  check(r.bar && /Preview/.test(r.bar), `the Preview bar shows (${r.bar})`);
  await page.screenshot({ path: path.join(out, 'preview-real.png') });
  await rows.nth(1).click();
  await page.waitForTimeout(2500);
  r = await page.evaluate(() => ({ peak: window.__peak(), pv: window.__pv() }));
  check(r.pv.plays === 2 && r.pv.playing && r.peak > 0.05, `another song's preview replaces it (${JSON.stringify(r.pv)}, peak ${r.peak.toFixed(3)})`);

  // quick clicks across songs, some not heard before: the last one plays, steadily
  const order = n >= 3 ? [2, 0, 1, 2, 0, 1] : [1, 0, 1, 0];
  for (const i of order) { await rows.nth(i).click(); await page.waitForTimeout(90); }
  const last = await idOf(order[order.length - 1]);
  await page.waitForTimeout(1500);
  r = await page.evaluate(async () => ({ pv: window.__pv(), low: await window.__lowest(1500) }));
  check(r.pv.playing === last, `after quick clicks the last song clicked plays (${r.pv.playing} vs ${last})`);
  check(r.low > 0.05, `it plays without gaps (quietest ${r.low.toFixed(3)})`);

  // the app tidies its sound files away (a full cache): a song heard before still plays
  const audioDir = path.join(home, 'local', 'Cache', 'audio');
  for (const f of fs.readdirSync(audioDir)) if (/^pv.*\.wav$/.test(f)) fs.unlinkSync(path.join(audioDir, f));
  const other = order[order.length - 1] === 0 ? 1 : 0;
  await page.evaluate(() => [...document.querySelectorAll('.pv-stop')].forEach((b) => b.click()));
  await page.waitForTimeout(300);
  await rows.nth(other).click();
  await page.waitForTimeout(2500);
  const want = await idOf(other);
  r = await page.evaluate(() => ({ peak: window.__peak(), pv: window.__pv() }));
  check(r.pv.playing === want && r.peak > 0.05, `a song heard before plays after its clip was tidied away (${JSON.stringify(r.pv)}, peak ${r.peak.toFixed(3)})`);

  // 4.30.1: songs whose file has no preview clip, or one the decoder can't read, never opened:
  // a slice of the song plays (before: nothing, and no word why)
  const more = path.join(home, 'more');
  fs.mkdirSync(more);
  const { makePsarc, makeBank } = require('../helpers/psarc-make');
  const odd = (key, title, prev) => {
    const files = {
      [`manifests/songs_dlc_${key}/${key}_lead.json`]: Buffer.from(JSON.stringify({ Entries: { [key]: { Attributes: { SongKey: key, SongName: title, ArtistName: 'Test', ArrangementName: 'Lead', SongBank: `song_${key}.bnk`, PreviewBankPath: `song_${key}_preview.bnk` } } } })),
      [`audio/windows/song_${key}.bnk`]: makeBank({ event: `Play_${key}`, media: 610000001 }),
      'audio/windows/610000001.wem': Buffer.alloc(300 * 1024, 3),
    };
    if (prev) {
      files[`audio/windows/song_${key}_preview.bnk`] = makeBank({ event: `Play_${key}_Preview`, media: 610000002 });
      files['audio/windows/610000002.wem'] = prev;
    }
    makePsarc(path.join(more, `${key}_p.psarc`), files);
  };
  odd('zzclipless', 'Zz No Clip', null);
  odd('zzbroken', 'Zz Broken Clip', Buffer.concat([Buffer.from('FAIL'), Buffer.alloc(40 * 1024, 4)]));
  await page.evaluate(async (d) => (await import('./js/api.js')).api.library.addFolder(d), more);
  await page.waitForFunction(async () => (await import('./js/store.js')).state.songs.size >= 4, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  for (const title of ['Zz No Clip', 'Zz Broken Clip']) {
    const row = page.locator('.row .tt-text', { hasText: title }).first();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await page.waitForFunction(() => window.__pv().playing, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    r = await page.evaluate(() => ({ peak: window.__peak(), pv: window.__pv() }));
    check(r.pv.playing && r.pv.from === 'song' && r.peak > 0.05, `${title}: a slice of the song plays (${JSON.stringify(r.pv)}, peak ${r.peak.toFixed(3)})`);
  }

  // a song playing in the player: a click says why there's no preview instead of staying quiet
  await page.evaluate(() => [...document.querySelectorAll('.pv-stop')].forEach((b) => b.click()));
  await page.waitForTimeout(300);
  await page.evaluate(async () => { (await import('./js/stage.js')).engine.playing = true; });
  await rows.nth(0).click();
  await page.waitForTimeout(700);
  r = await page.evaluate(() => { const b = document.querySelector('.pv-bar'); return { bar: b && !b.hidden ? b.textContent : null, pv: window.__pv() }; });
  check(r.bar && /song is playing/i.test(r.bar) && !r.pv.playing, `with a song playing, the bar says why nothing plays (${r.bar})`);
  await page.evaluate(async () => { (await import('./js/stage.js')).engine.playing = false; });
  await page.screenshot({ path: path.join(out, 'preview-note.png') });

  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
  await app.close();
  fs.rmSync(home, { recursive: true, force: true });
  console.log(bad ? 'some failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
