/* 4.23: Settings › Display on pretend screens: a saved window on a screen that's gone, a TV at 150%, per-screen choices. `node test/display.test.js` */
const assert = require('assert');
const { Display, validBounds, minSize, zoomFor } = require('../src/main/services/display');

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const scr = (id, x, w, h, sf = 1, hz = 60) => ({ id, size: { width: w, height: h }, scaleFactor: sf, displayFrequency: hz, bounds: { x, y: 0, width: w, height: h }, workArea: { x, y: 0, width: w, height: h - 40 } });
const desk = scr(1, 0, 1920, 1080, 1, 144);
const tv = scr(2, 1920, 853, 480, 1.5, 60); // a 1280×720 TV at 150%: Stagehand gets 853×480

test('a window saved on a screen that is gone comes back on one that exists', () => {
  assert.strictEqual(validBounds({ x: 4000, y: 100, width: 1440, height: 900 }, [desk]), null);
  const b = validBounds({ x: 100, y: 50, width: 1440, height: 900 }, [desk]);
  assert.deepStrictEqual(b, { x: 100, y: 50, width: 1440, height: 900 });
  // bigger than the screen now: brought inside it
  const t = validBounds({ x: 1950, y: 0, width: 1440, height: 900 }, [tv]);
  assert.ok(t.width <= 853 && t.height <= 440 && t.x >= 1920, JSON.stringify(t));
});

test('the smallest window fits the screen (the old 1060×680 ran off a TV)', () => {
  assert.deepStrictEqual(minSize(desk), { width: 1060, height: 680 });
  assert.deepStrictEqual(minSize(tv), { width: 853, height: 440 });
});

test('Auto size: 100% on a desk screen, smaller on a small one; a chosen size is kept within 80–150%', () => {
  assert.strictEqual(zoomFor({}, desk), 1);
  const z = zoomFor({}, tv);
  assert.ok(z < 0.7 && z >= 0.67, String(z));
  assert.strictEqual(zoomFor({ scale: 1.25 }, tv), 1.25);
  assert.strictEqual(zoomFor({ scale: 3 }, tv), 1.5);
});

test('each screen keeps its own size and border; reset clears only that screen', () => {
  let data = { display: { screens: {} } };
  const settings = { get: () => data, set: (p) => (data = { ...data, display: { screens: { ...data.display.screens, ...p.display.screens } } }) };
  let on = desk;
  const zooms = [];
  const sent = [];
  const win = { isDestroyed: () => false, getBounds: () => on.bounds, isFullScreen: () => false, isMaximized: () => false, setMinimumSize() {}, webContents: { setZoomFactor: (z) => zooms.push(z) } };
  const screen = { getAllDisplays: () => [desk, tv], getPrimaryDisplay: () => desk, getDisplayMatching: () => on };
  const d = new Display({ screen, settings, getWin: () => win, send: (c, x) => sent.push([c, x]) });
  d.set({ safe: 6, scale: 1.1 });
  assert.strictEqual(d.info().safe, 6);
  assert.strictEqual(zooms[zooms.length - 1], 1.1);
  on = tv;
  d.moved();
  assert.strictEqual(d.info().safe, 0, 'the TV starts with its own (none)');
  assert.ok(zooms[zooms.length - 1] < 0.7, 'and Auto shrinks Stagehand to fit it');
  d.set({ safe: 4 });
  on = desk;
  d.moved();
  assert.strictEqual(d.info().safe, 6);
  d.reset();
  assert.strictEqual(d.info().safe, 0);
  assert.strictEqual(d.info().scale, 'auto');
  on = tv;
  assert.strictEqual(d.info().safe, 4, 'the TV kept its own');
  assert.ok(sent.some(([c, x]) => c === 'display:changed' && x.safe === 4));
  assert.strictEqual(d.info().current.refresh, 60);
  assert.ok(d.info().sizes.every((s) => s.width <= 853), 'only sizes that fit the screen are offered');
});

console.log(`display: ${passed} passed`);
