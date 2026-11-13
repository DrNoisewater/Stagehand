/** 4.16: the headset's highway on a made-up part, without the full app: quick pictures while working on its look.
 *   node test/e2e/companion-vr-shot.js <outDir> [seconds …]
 * Starts the real companion server, pairs a pretend Quest 3 browser, sends a made-up part (single notes, chords,
 * open strings, held notes, a slide), marks a few hits and a miss, and takes the flat preview at each time
 * (default 3.2 and 7.5 s). Writes vr-<t>.png. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Companion, nowMs } = require('../../src/main/services/companion');
const { Settings } = require('../../src/main/services/settings');

const ROOT = path.join(__dirname, '..', '..');
const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'vrshot-'));
const times = process.argv.slice(3).map(Number).filter(Number.isFinite);
if (!times.length) times.push(3.2, 7.5);
fs.mkdirSync(outDir, { recursive: true });

function madeUpPart() {
  const targets = [];
  let i = 0;
  const note = (t, s, f, d = 0, fl = 0, slide = -1) => targets.push({ i: i++, t, d, k: 'n', c: '', r: 0, l: 0, n: [[s, f, d, fl, slide, 0]] });
  const chord = (t, name, frets, d = 0) => targets.push({ i: i++, t, d, k: 'c', c: name, r: 0, l: 0, n: frets.map(([s, f]) => [s, f, d, 0, -1, 0]) });
  // a riff in fifth position, then chords, then a held note and a slide, then open strings
  const riff = [[0, 5], [0, 7], [1, 5], [1, 7], [2, 5], [2, 7], [1, 7], [1, 5]];
  for (let k = 0; k < 16; k++) note(1.0 + k * 0.25, riff[k % 8][0], riff[k % 8][1]);
  chord(5.0, 'A5', [[0, 5], [1, 7], [2, 7]], 0.4);
  chord(5.5, 'A5', [[0, 5], [1, 7], [2, 7]], 0.4);
  chord(6.0, 'C5', [[0, 8], [1, 10], [2, 10]], 0.8);
  chord(7.0, 'D5', [[1, 5], [2, 7], [3, 7]], 0.9);
  note(8.0, 3, 7, 1.2, 32);
  note(9.5, 2, 7, 0.6, 8, 9);
  note(10.5, 5, 0, 0.5);
  note(11.0, 4, 0, 0.5);
  for (let k = 0; k < 8; k++) note(12 + k * 0.25, 4 - (k % 3), 5 + (k % 4), 0, k === 5 ? 1 : 0);
  const beats = [];
  for (let t = 0, b = 0; t < 20; t += 0.5, b++) beats.push([t, b % 4 === 0 ? b / 4 : -1]);
  return { song: 's1', part: 'lead', name: 'Lead', strings: 6, tuning: [0, 0, 0, 0, 0, 0], lowTop: true, venue: process.env.VENUE || 'warehouse', length: 20, beats, sections: [['riff', 0, 5], ['chorus', 5, 12], ['outro', 12, 20]], anchors: [[0, 5, 5, 4], [5.8, 6.6, 7, 4], [6.6, 12, 5, 4]], targets };
}

(async () => {
  const settings = new Settings(path.join(outDir, 'settings.json'));
  await settings.load();
  settings.set({ companion: { port: 0 } });
  const songs = [{ id: 's1', title: 'Made-up Riff', artist: 'The Testers', arrangements: [{ type: 'lead' }], length: 20 }];
  const c = new Companion({ dir: path.join(outDir, 'Quest'), settings, library: { songs: () => songs, get: (id) => songs.find((s) => s.id === id) }, staticDir: path.join(ROOT, 'src/companion'), rendererDir: path.join(ROOT, 'src/renderer'), pcName: 'STAGE-PC' });
  await c.setOn(true);
  const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 }, deviceScaleFactor: Number(process.env.DPR || 1) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`https://127.0.0.1:${c.port}/`);
  await page.waitForSelector('#pair:not([hidden])');
  for (const d of c.code) await page.locator(`#pad button:text-is("${d}")`).click();
  await page.waitForSelector('#home:not([hidden])');
  const chart = madeUpPart();
  c.pushChart(chart);
  await page.locator('#preview').click();
  for (const t of times) {
    // paused at t: what's been played before t is judged (one miss), the rest is coming
    const ev = chart.targets.filter((x) => x.t <= t).map((x) => [x.i, x.i % 7 === 3 ? 0 : 1]);
    c.pushState({ song: { id: 's1', title: 'Made-up Riff', artist: 'The Testers', length: 20 }, pos: t, playing: false, speed: 1, at: nowMs(), judge: { hits: ev.filter((e) => e[1]).length, judged: ev.length, streak: 6, best: 9, ev, reset: true } });
    await page.waitForTimeout(Number(process.env.WAIT || 3500));
    const file = path.join(outDir, `vr-${t}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);
  }
  await browser.close();
  await c.stop();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
