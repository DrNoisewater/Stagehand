/**
 * The real app in Electron (4.0.7): start a recording, crash the window on purpose,
 * and check it comes back by itself, says what happened, and saves the recording as
 * far as it got.
 *
 *   ELECTRON=<path to electron> xvfb-run -a node test/e2e/crash-electron.js <outDir>
 * Needs ffmpeg on PATH (the app uses it on Linux to make the MP4).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { _electron } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'sh-crash-out-'));
fs.mkdirSync(outDir, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-crash-home-'));
const results = [];
const check = (ok, msg) => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

(async () => {
  // two seconds of real video, like the recorder makes
  const webm = path.join(home, 'piece.webm');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-c:v', 'libvpx', webm]);
  const bytes = [...fs.readFileSync(webm)];
  const app = await _electron.launch({
    executablePath: process.env.ELECTRON,
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, STAGEHAND_HOME: home },
  });
  if (process.env.SH_DEBUG) app.process().stdout.on('data', (d) => process.stdout.write('[app] ' + d));
  let page = await app.firstWindow();
  await page.waitForFunction(() => window.stagehand && document.querySelector('#app'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  // a recording running, and what you're doing
  await page.evaluate(async (bytes) => {
    const r = await window.stagehand.clips.begin({ title: 'Grease', songId: null, rate: 48000 });
    const id = r.value;
    await window.stagehand.clips.chunk(id, 'v', Uint8Array.from(bytes));
    const snd = new Int16Array(48000 * 2 * 2).map((_, i) => Math.round(Math.sin(i / 20) * 8000));
    await window.stagehand.clips.chunk(id, 'a', new Uint8Array(snd.buffer));
    await window.stagehand.app.activity('Recording a video of Grease (2:41 in)');
  }, bytes);
  // each question gets 3 s: a window still loading may not answer
  const inPage = (js) => Promise.race([app.evaluate(({ BrowserWindow }, js) => { const w = BrowserWindow.getAllWindows()[0]; return w && !w.webContents.isLoading() && !w.webContents.isCrashed() ? w.webContents.executeJavaScript(js) : null; }, js).catch(() => null), new Promise((r) => setTimeout(() => r(null), 3000))]);
  const modalText = async () => (await inPage("(document.querySelector('.modal') || {}).textContent || ''")) || '';
  // crash the page
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  // it comes back by itself, with the note
  let note = '';
  for (let i = 0; i < 60 && !/had to reload/.test(note); i++) {
    await new Promise((r) => setTimeout(r, 500));
    note = await modalText();
  }
  check(/had to reload/.test(note), 'the window came back by itself with a note');
  check(/Recording a video of Grease/.test(note), `the note says what you were doing: “${note.slice(0, 160)}”`);
  // the recording, saved as far as it got
  const vids = path.join(home, 'data', 'Takes', 'Videos');
  let saved = [];
  for (let i = 0; i < 60 && !saved.length; i++) {
    await new Promise((r) => setTimeout(r, 500));
    saved = fs.existsSync(vids) ? fs.readdirSync(vids).filter((f) => /Grease \(saved after a crash\)\.mp4$/.test(f)) : [];
  }
  check(saved.length === 1, `the recording was saved: ${saved.join(', ') || 'nothing'}`);
  if (saved.length) {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(vids, saved[0])]).stdout.toString();
    check(/video/.test(probe) && /audio/.test(probe), `…with picture and sound (${probe.trim().replace(/\n/g, ', ')})`);
  }
  await new Promise((r) => setTimeout(r, 1500));
  note = await modalText();
  check(/saved as far as it got/.test(note), 'the note says where the recording went');
  // (the page object from before the crash stays crashed for the test tool: ask the window itself)
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(outDir, 'crash-note.png'), Buffer.from(png, 'base64'));
  // the Activity log has it
  const logLines = await inPage('window.stagehand.app.log().then((r) => r.value || [])');
  check(logLines.some((l) => /window stopped/.test(l)), 'the Activity log has a line about it');
  await app.close().catch(() => {});
  fs.rmSync(home, { recursive: true, force: true });
  console.log(results.every(Boolean) ? 'all passed' : 'some failed');
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.error('FAIL', e.stack || e.message);
  process.exit(1);
});
