/**
 * The real app in Electron (4.1.2): a recorded video's sound must play through
 * Stagehand's own sound path (the bus the song, looper and takes use), not the
 * computer's default speakers. With the sound engine holding the speakers to itself
 * (fastest mode), the default speakers are shut out, and videos seemed silent.
 *
 *   ELECTRON=<path to electron> xvfb-run -a node test/e2e/recplay-electron.js <outDir>
 * Needs ffmpeg and ffprobe on PATH (the app uses ffmpeg on Linux to make the MP4).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'sh-recplay-out-'));
fs.mkdirSync(outDir, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-recplay-home-'));
const results = [];
const check = (ok, msg) => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

(async () => {
  // four seconds of video only, as the recorder makes it with the sound engine on
  const webm = path.join(home, 'piece.webm');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=4', '-c:v', 'libvpx', webm]);
  const bytes = [...fs.readFileSync(webm)];
  const app = await _electron.launch({ executablePath: process.env.ELECTRON, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', ROOT], env: { ...process.env, STAGEHAND_HOME: home } });
  if (process.env.SH_DEBUG) app.process().stdout.on('data', (d) => process.stdout.write('[app] ' + d));
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.stagehand && document.querySelector('#app'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  // a recording: the video, and the engine's sound beside it (a 440 Hz tone)
  const saved = await page.evaluate(async (bytes) => {
    const id = (await window.stagehand.clips.begin({ title: 'Grease', songId: null, rate: 48000 })).value;
    await window.stagehand.clips.chunk(id, 'v', Uint8Array.from(bytes));
    const snd = new Int16Array(48000 * 4 * 2).map((_, i) => Math.round(Math.sin((2 * Math.PI * 440 * (i >> 1)) / 48000) * 12000));
    await window.stagehand.clips.chunk(id, 'a', new Uint8Array(snd.buffer));
    const r = await window.stagehand.clips.finish(id, { seconds: 4 });
    return r.ok ? r.value : { error: r.error };
  }, bytes);
  check(saved && saved.path, `the video was saved: ${saved && (saved.path || saved.error)}`);
  const probe = saved && saved.path ? spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', saved.path]).stdout.toString() : '';
  check(/video/.test(probe) && /audio/.test(probe), `the file has picture and sound (${probe.trim().replace(/\n/g, ', ')})`);

  // open Recordings and press play on it; listen on Stagehand's own sound bus
  await page.evaluate(async () => {
    const { engine } = await import('./js/stage.js');
    const { ctx, node } = await engine.extraOut();
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    node.connect(a);
    window.__busPeak = 0;
    const buf = new Float32Array(2048);
    window.__busT = setInterval(() => {
      a.getFloatTimeDomainData(buf);
      for (const x of buf) window.__busPeak = Math.max(window.__busPeak, Math.abs(x));
    }, 50);
    const { openGreenRoom } = await import('./js/greenroom.js');
    openGreenRoom({ tab: 'mine' });
  });
  await page.waitForSelector('.gr-row.video .round-play', { timeout: 10000 });
  await page.click('.gr-row.video .round-play');
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const v = document.querySelector('#page-greenroom .gr-player video');
    return { peak: window.__busPeak, t: v ? v.currentTime : -1, err: v && v.error ? v.error.message || v.error.code : null };
  });
  check(st.t > 0.5, `the video plays in the Green Room (at ${st.t.toFixed(2)} s${st.err ? ', ' + st.err : ''})`);
  check(st.peak > 0.1, `its sound reaches Stagehand's own sound path, like the song and the looper (peak ${st.peak.toFixed(3)})`);
  await page.screenshot({ path: path.join(outDir, 'recplay.png') });
  // stop it: nothing left playing
  await page.click('.gr-row.video .round-play');
  await page.waitForTimeout(300);
  check(!(await page.$('#page-greenroom .gr-player video')), 'pressing again stops it');
  await app.close().catch(() => {});
  fs.rmSync(home, { recursive: true, force: true });
  console.log(results.every(Boolean) ? 'all passed' : 'some failed');
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.error('FAIL', e.stack || e.message);
  process.exit(1);
});
