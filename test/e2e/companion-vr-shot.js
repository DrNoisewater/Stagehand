/** 4.16: the headset's highway on a made-up part, without the full app: quick pictures while working on its look.
 *   node test/e2e/companion-vr-shot.js <outDir> [seconds …]
 * Starts the real companion server, pairs a pretend Quest 3 browser, sends a made-up part (single notes, chords,
 * open strings, held notes, a slide), marks a few hits and a miss, and takes the flat preview at each time
 * (default 3.2 and 7.5 s). Writes vr-<t>.png.
 * 4.19 also: vr-before.png and vr-after.png (4.16's spot and the new one, looking 20° down), vr-down.png (looking down at the guitar outline in
 * full VR with pretend hands on it, the song playing: hands dim), vr-menu-<page>.png (the menu open, a pretend
 * finger on a button: hands bright). ONLY=highway skips the 4.19 pictures. */
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

/** The 4.19 pictures: the heights, the guitar outline with pretend hands, the menu's pages. */
async function more(page, c, chart, outDir) {
  const { pretendHand } = await import('../../src/companion/handpose.js');
  const shot = async (name) => {
    await page.waitForTimeout(Number(process.env.WAIT || 1500));
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);
  };
  const st = (t, playing, extra = {}) => c.pushState({ song: { id: 's1', title: 'Made-up Riff', artist: 'The Testers', length: 20 }, pos: t, playing, speed: 1, at: nowMs(), partId: 'p-lead', parts: { song: 's1', list: [{ id: 'p-lead', name: 'Lead', type: 'lead' }, { id: 'p-rhy', name: 'Rhythm', type: 'rhythm' }, { id: 'p-bass', name: 'Bass', type: 'bass' }, { id: 'p-alt', name: 'Alt. Lead', type: 'lead', bonus: true }] }, ...extra });
  // before and after: 4.16's spot (a little below the eyes, flat to the horizon) beside the new one, looking
  // straight ahead and then a little down, as you would with the guitar
  st(3.2, false);
  for (const [name, spot] of [['vr-before', { height: -0.42, dist: 0.75, tilt: 0 }], ['vr-after', null]]) {
    await page.evaluate((spot) => {
      const s = window.__companion.stage;
      const keep = { height: s.prefs.height, dist: s.prefs.dist, tilt: s.prefs.tilt };
      window.__keep = window.__keep || keep;
      s.placeAt(spot || window.__keep);
      s.look(20, 0);
    }, spot);
    await shot(name);
  }
  // looking down at the guitar outline, the song playing, pretend hands on it (dim)
  const g = await page.evaluate(() => ({ ...window.__companion.stage.prefs.guitar }));
  const left = pretendHand('left', { wrist: [g.x - 0.035, g.y - 0.06, g.z + 0.07], point: [0.25, 0.75, -0.6], palm: [0.1, 0.35, -1], curl: 0.75 });
  const right = pretendHand('right', { wrist: [g.x + 0.42, g.y + 0.02, g.z + 0.03], point: [-0.35, -0.75, -0.5], palm: [0, -0.4, -1], curl: 0.55 });
  st(6.05, true);
  await page.evaluate(({ left, right }) => {
    const s = window.__companion.stage;
    s.fakeHands([left, right]);
    s.look(52, 14);
  }, { left, right });
  await shot('vr-down');
  // the menu: each page, a pretend finger hovering over a button (hands bright, the song paused)
  st(6.05, false);
  await page.evaluate(() => {
    const s = window.__companion.stage;
    s.look();
    s.menu.open('songs');
  });
  for (const [tab, target] of [['songs', 'song:x3'], ['play', 'part:p-bass'], ['place', 'h:height-'], ['view', 'hands:dim']]) {
    await page.evaluate((tab) => window.__companion.stage.press(`tab:${tab}`), tab);
    // on the songs page: the second song in the list
    const id = target === 'song:x3' ? await page.evaluate(() => window.__companion.stage.menu.buttons().filter((b) => b.id.startsWith('song:'))[1]?.id) : target;
    const p = await page.evaluate((id) => window.__companion.stage.menu.pointOf(id), id);
    if (!p) throw new Error(`no ${id} on the ${tab} page`);
    // the index fingertip 3 cm in front of the button (hovering, not pressing)
    const tip = p.at.map((v, i) => v + p.facing[i] * 0.03);
    const dir = [0.25, 0.35, -1];
    const l = Math.hypot(...dir);
    const point = dir.map((v) => v / l);
    const right = pretendHand('right', { wrist: tip.map((v, i) => v - point[i] * 0.185), point, palm: [-0.6, -0.4, -0.3], pointing: true });
    await page.evaluate((h) => window.__companion.stage.fakeHands([null, h]), right);
    await shot(`vr-menu-${tab}`);
  }
}

(async () => {
  const settings = new Settings(path.join(outDir, 'settings.json'));
  await settings.load();
  settings.set({ companion: { port: 0 } });
  const songs = [{ id: 's1', title: 'Made-up Riff', artist: 'The Testers', arrangements: [{ type: 'lead' }, { type: 'rhythm' }, { type: 'bass' }], length: 20 }];
  for (let k = 0; k < 40; k++) songs.push({ id: `x${k}`, title: ['Back in Black', 'Sugar', 'Aerials', 'Toxicity', 'Black Dog', 'Everlong', 'Plush', 'Creep'][k % 8] + (k > 7 ? ` ${k}` : ''), artist: ['AC/DC', 'System Of A Down', 'Led Zeppelin', 'Foo Fighters', 'Stone Temple Pilots', 'Radiohead', 'The Beatles', '311'][k % 8], arrangements: [{ type: 'lead' }, { type: k % 3 ? 'bass' : 'rhythm' }], length: 200, year: 1990 + k });
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
  if (process.env.ONLY !== 'highway') await more(page, c, chart, outDir);
  await browser.close();
  await c.stop();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
