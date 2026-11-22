/**
 * 4.27.1: the click preview in the real app (Electron), with real song files and the app's own
 * file server. 4.26's preview clips were turned away by that server (their names start with "pv"),
 * so every preview was silent; the Chromium checks use a pretend app and could not see it.
 *  - one click on a song plays its preview: the sound reaches the player's output, the bar shows;
 *  - another song replaces it.
 * Linux has no Rocksmith audio decoder, so a stand-in one writes a 330 Hz tone.
 *
 *   ELECTRON=<electron 44> xvfb-run -a node test/e2e/preview-electron.js <outDir>
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
const fs=require('fs');const a=process.argv;const o=a[a.indexOf('-o')+1];
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
  for (const f of ['integration_p', 'legacy_p']) fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', `${f}.psarc`), path.join(songs, `${f}.psarc`));
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
    window.__plays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const src = this.src;
      return orig.call(this).then(() => window.__plays.push(`ok ${src}`), (e) => { window.__plays.push(`failed ${src}: ${e.message}`); throw e; });
    };
    // listen to the player's extra sound bus, where the preview goes
    const { engine } = await import('./js/stage.js');
    const { ctx, node } = await engine.extraOut();
    window.__an = ctx.createAnalyser();
    node.connect(window.__an);
    window.__peak = () => { const d = new Float32Array(2048); window.__an.getFloatTimeDomainData(d); let p = 0; for (const v of d) p = Math.max(p, Math.abs(v)); return p; };
  });
  const rows = page.locator('.row .tt-text');
  await rows.nth(0).click();
  await page.waitForTimeout(2500);
  let r = await page.evaluate(() => ({ peak: window.__peak(), bar: (() => { const b = document.querySelector('.pv-bar'); return b && !b.hidden ? b.textContent : null; })(), plays: window.__plays }));
  check(r.plays.length === 1 && /^ok stagehand:\/\/audio\/pv/.test(r.plays[0]), `the song's own preview clip loads and plays (${r.plays.join('; ')})`);
  check(r.peak > 0.05, `its sound reaches the player's output (peak ${r.peak.toFixed(3)})`);
  check(r.bar && /Preview/.test(r.bar), `the Preview bar shows (${r.bar})`);
  await page.screenshot({ path: path.join(out, 'preview-real.png') });
  await rows.nth(1).click();
  await page.waitForTimeout(2500);
  r = await page.evaluate(() => ({ peak: window.__peak(), plays: window.__plays }));
  check(r.plays.length === 2 && /^ok /.test(r.plays[1]) && r.peak > 0.05, `another song's preview replaces it (${r.plays[1]}, peak ${r.peak.toFixed(3)})`);
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
  await app.close();
  fs.rmSync(home, { recursive: true, force: true });
  console.log(bad ? 'some failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
