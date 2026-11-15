// 4.19: the headset's own pieces, without a headset: where the highway and guitar outline sit (and the
// old spot moved down once), the menu's pages and buttons, your hands (which way the palm faces, a pinch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlace, DEFAULTS, OLD, LIMITS, nudge, nudgeGuitar, resetHighway, resetGuitar, highwayPoint, lookDown, fretDist, neckLayout, stringAcross } from '../src/companion/place.js';
import { menuModel, layout, hit, sortSongs, letterOf, jumpTo, clampTop, orderParts, partLabel, W, H, ROWS, TABS } from '../src/companion/menu.js';
import { pretendHand, palmNormal, palmToward, pinching, joint, dist, JOINTS, BONES, INDEX_TIP, THUMB_TIP } from '../src/companion/handpose.js';

test('the highway sits low: a glance down, not eye level', () => {
  const p = loadPlace('');
  assert.equal(p.v, 2);
  // the strings well below your eyes, and the whole highway (to 3 m off) still below eye level
  const near = lookDown(p, 0);
  const far = lookDown(p, 3);
  assert.ok(near >= 30 && near <= 50, `strings ${near.toFixed(1)}° down`);
  assert.ok(far >= 15, `far end ${far.toFixed(1)}° down (a flat highway would be near 0°)`);
  // 4.16's spot was much higher
  const old = { ...p, height: OLD.height, dist: OLD.dist, tilt: 0 };
  assert.ok(near - lookDown(old, 0) > 10, 'at least 10° lower than before');
  assert.ok(far - lookDown(old, 3) > 10);
});

test('the old saved spot moves down once; a lower one someone chose stays', () => {
  // 4.16 saved { height, dist, offset } with no version
  const a = loadPlace(JSON.stringify({ height: -0.42, dist: 0.75, offset: 40 }));
  assert.equal(a.height, DEFAULTS.height);
  assert.equal(a.dist, DEFAULTS.dist);
  assert.equal(a.offset, 40, 'note timing kept');
  const higher = loadPlace(JSON.stringify({ height: -0.1, dist: 1 }));
  assert.equal(higher.height, DEFAULTS.height, 'eye level moves down too');
  const lower = loadPlace(JSON.stringify({ height: -0.7, dist: 0.5 }));
  assert.equal(lower.height, -0.7, 'already lower: left where it was put');
  assert.equal(lower.dist, 0.5);
  // once saved as version 2 it is never moved again, even if it is high
  const v2 = loadPlace(JSON.stringify({ v: 2, height: -0.3, dist: 0.8, tilt: 5, size: 1.2, hands: 'faint', passthrough: true, guitar: { on: false, x: -0.2, angle: 70 } }));
  assert.equal(v2.height, -0.3);
  assert.equal(v2.tilt, 5);
  assert.equal(v2.hands, 'faint');
  assert.equal(v2.passthrough, true);
  assert.equal(v2.guitar.on, false);
  assert.equal(v2.guitar.angle, 70);
  assert.equal(v2.guitar.y, DEFAULTS.guitar.y, 'a missing guitar value gets the default');
  // rubbish
  for (const t of ['nope', '[]', 'null', JSON.stringify({ v: 2, height: 'x', hands: 'glow', guitar: 3 })]) {
    const r = loadPlace(t);
    assert.equal(r.height, DEFAULTS.height, t);
    assert.equal(r.hands, 'dim', t);
  }
  assert.equal(loadPlace(JSON.stringify({ v: 2, height: -9, dist: 99 })).height, LIMITS.height[0], 'kept in range');
});

test('placement buttons: one step at a time, never out of range, and back to the first spot', () => {
  const p = loadPlace('');
  nudge(p, 'height', -1);
  assert.equal(p.height, Math.round((DEFAULTS.height - 0.04) * 1000) / 1000);
  for (let i = 0; i < 100; i++) nudge(p, 'height', -1);
  assert.equal(p.height, LIMITS.height[0]);
  for (let i = 0; i < 100; i++) nudge(p, 'tilt', 1);
  assert.equal(p.tilt, LIMITS.tilt[1]);
  nudge(p, 'nonsense', 1);
  assert.equal(p.nonsense, undefined);
  nudgeGuitar(p, 'angle', 1);
  assert.equal(p.guitar.angle, DEFAULTS.guitar.angle + 5);
  p.guitar.on = false;
  resetGuitar(p);
  assert.equal(p.guitar.angle, DEFAULTS.guitar.angle);
  assert.equal(p.guitar.on, false, 'start over keeps it switched off');
  resetHighway(p);
  assert.equal(p.height, DEFAULTS.height);
  assert.equal(p.tilt, DEFAULTS.tilt);
  const y0 = highwayPoint(p, 0).y;
  p.tilt = 0;
  assert.equal(highwayPoint(p, 2).y, y0, 'flat: the far end at the same height');
});

test('the guitar outline: real fret spacing, guitar or bass, low string nearest you', () => {
  assert.ok(Math.abs(fretDist(0.648, 12) - 0.324) < 1e-9, 'fret 12 is half the string');
  const g = neckLayout(6);
  const b = neckLayout(4);
  assert.equal(g.bass, false);
  assert.equal(b.bass, true);
  assert.equal(g.frets, 22);
  assert.equal(b.frets, 20);
  assert.ok(b.scale > g.scale);
  assert.equal(neckLayout(5).bass, true);
  // the middle of fret 5's space is at 0
  assert.ok(Math.abs(g.mids[4]) < 1e-9);
  // frets get closer towards the body
  for (let n = 2; n <= g.frets; n++) assert.ok(g.wires[n] - g.wires[n - 1] < g.wires[n - 1] - g.wires[n - 2] + 1e-12);
  assert.ok(g.width(g.at(g.frets)) > g.width(g.at(0)), 'wider towards the body');
  assert.deepEqual(g.dots.slice(0, 5), [3, 5, 7, 9, 12]);
  // strings: the low one on the near (+) side, evenly spread, inside the board
  const x = g.at(5);
  const ys = [0, 1, 2, 3, 4, 5].map((s) => stringAcross(g, s, x));
  assert.ok(ys[0] > 0 && ys[5] < 0);
  for (let i = 1; i < 6; i++) assert.ok(ys[i] < ys[i - 1]);
  assert.ok(Math.abs(ys[0]) < g.width(x) / 2);
});

const SONGS = [
  { id: 'a', title: 'Sugar', artist: 'System Of A Down', parts: ['lead', 'bass'], played: 0, added: 5 },
  { id: 'b', title: 'Back in Black', artist: 'AC/DC', parts: ['lead', 'rhythm', 'bass'], played: 300, added: 1 },
  { id: 'c', title: 'The Pretender', artist: 'Foo Fighters', parts: ['lead'], played: 0, added: 9 },
  { id: 'd', title: '1979', artist: 'The Smashing Pumpkins', parts: ['bass'], played: 100, added: 2 },
];

test('songs in the menu: by artist, by title (ignoring "The"), most recent first', () => {
  assert.deepEqual(sortSongs(SONGS, 'artist').map((s) => s.id), ['b', 'c', 'd', 'a']);
  assert.deepEqual(sortSongs(SONGS, 'title').map((s) => s.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(sortSongs(SONGS, 'recent').map((s) => s.id), ['b', 'd', 'c', 'a'], 'played on the PC, then newest added');
  assert.deepEqual(sortSongs(SONGS, 'recent', { a: 1000 }).map((s) => s.id)[0], 'a', 'picked in the headset counts');
  assert.equal(letterOf(SONGS[3], 'title'), '#');
  assert.equal(letterOf(SONGS[3], 'artist'), 'S', '"The Smashing Pumpkins" under S');
  const list = sortSongs(SONGS, 'artist');
  assert.equal(jumpTo(list, 'artist', 'F'), 1);
  assert.equal(jumpTo(list, 'artist', 'Q'), -1);
  assert.equal(clampTop(99, 40), 40 - ROWS);
  assert.equal(clampTop(-3, 40), 0);
  assert.equal(clampTop(2, 3), 0);
});

test('parts: every one listed, in order, named plainly', () => {
  const parts = [
    { id: '4', type: 'bass', name: 'Bass', bonus: true },
    { id: '3', type: 'bass', name: 'Bass' },
    { id: '2', type: 'rhythm', name: 'Rhythm' },
    { id: '1', type: 'lead', name: 'Lead' },
    { id: '5', type: 'lead', name: 'Alt. Lead', bonus: true },
  ];
  assert.deepEqual(orderParts(parts).map((p) => p.id), ['1', '2', '3', '5', '4'], 'bonus ones last, also lead, rhythm, bass');
  assert.equal(partLabel(parts[0]), 'Bass (bonus)');
  assert.equal(partLabel(parts[4]), 'Alt. Lead (bonus)');
  const btns = layout({ ...menuModel(), tab: 'play' }, { list: [], songId: 's', title: 'X', parts, partId: '3', speed: 1, prefs: loadPlace(''), pos: 3, len: 100 });
  const chips = btns.filter((b) => b.id.startsWith('part:'));
  assert.equal(chips.length, 5, 'all five parts on the page');
  assert.deepEqual(chips.filter((b) => b.on).map((b) => b.id), ['part:3'], 'the one playing is lit');
});

const ctx = (more = {}) => ({ list: sortSongs(Array.from({ length: 23 }, (_, i) => ({ id: `s${i}`, title: `Song ${i}`, artist: `Band ${String.fromCharCode(65 + (i % 20))}`, parts: ['lead'] })), 'artist'), songId: 's1', title: 'Song 1', artist: 'Band B', playing: false, pos: 10, len: 200, parts: [{ id: 'p1', type: 'lead' }, { id: 'p2', type: 'bass' }], partId: 'p1', speed: 1, prefs: loadPlace(''), canPassthrough: true, handsSeen: true, ...more });

test('every menu page: buttons big enough for a finger, on the panel, not on top of each other', () => {
  const pages = [];
  for (const t of TABS) pages.push([t.id, { ...menuModel(), tab: t.id }]);
  pages.push(['letters', { ...menuModel(), letters: true }]);
  pages.push(['guitar', { ...menuModel(), tab: 'place', placeWhat: 'guitar' }]);
  // the panel is 64 cm wide: 1024 px is 0.625 mm a pixel; a fingertip needs about 2.5 cm
  const MIN = 0.025 / (0.64 / W);
  for (const [name, m] of pages) {
    const btns = layout(m, ctx());
    const press = btns.filter((b) => !['label', 'value'].includes(b.kind));
    assert.ok(press.length > 3, name);
    for (const b of btns) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H, `${name} ${b.id} on the panel`);
      if (b.kind !== 'label' && b.kind !== 'value' && b.kind !== 'bar') assert.ok(Math.min(b.w, b.h) >= MIN, `${name} ${b.id} ${b.w}×${b.h} big enough`);
    }
    for (let i = 0; i < press.length; i++) {
      for (let k = i + 1; k < press.length; k++) {
        const a = press[i];
        const c = press[k];
        const over = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
        assert.ok(!over, `${name}: ${a.id} and ${c.id} overlap`);
      }
    }
    // the middle of each button hits that button
    for (const b of press.filter((x) => !x.off)) assert.equal(hit(btns, b.x + b.w / 2, b.y + b.h / 2)?.id, b.id, `${name} ${b.id}`);
    // tabs and close are on every page
    for (const t of TABS) assert.ok(btns.some((b) => b.id === `tab:${t.id}`), `${name} has ${t.id}`);
    assert.ok(btns.some((b) => b.id === 'close'));
  }
});

test('the menu: songs page scrolls, things that can’t work are dimmed, Leave VR asks twice', () => {
  const c = ctx();
  const m = menuModel();
  let rows = layout(m, c).filter((b) => b.kind === 'row');
  assert.equal(rows.length, ROWS);
  m.top = 20;
  rows = layout(m, c).filter((b) => b.kind === 'row');
  assert.equal(rows.length, 3, 'the last page');
  assert.equal(rows[0].id, `song:${c.list[20].id}`);
  // no room view in this browser: dimmed, and a press does nothing
  const v = layout({ ...menuModel(), tab: 'view' }, ctx({ canPassthrough: false }));
  const on = v.find((b) => b.id === 'pass:on');
  assert.ok(on.off);
  assert.equal(hit(v, on.x + 5, on.y + 5), null);
  // "line it up with my hand" needs your hands seen
  const g = layout({ ...menuModel(), tab: 'place', placeWhat: 'guitar' }, ctx({ handsSeen: false }));
  assert.ok(g.find((b) => b.id === 'match').off);
  // Leave VR: the second press is the one that leaves
  assert.equal(v.find((b) => b.id === 'exit').label, 'Leave VR');
  assert.match(layout({ ...menuModel(), tab: 'view' }, ctx({ leaving: true })).find((b) => b.id === 'exit').label, /again/);
  // nothing outside the panel
  assert.equal(hit(v, -5, 10), null);
});

test('hands: 25 joints, the bones join them, the palm and a pinch', () => {
  assert.equal(JOINTS.length, 25);
  for (const [a, b] of BONES) assert.ok(a >= 0 && a < 25 && b >= 0 && b < 25);
  const eye = [0, 0, 0];
  // a hand held up in front of the face, palm towards you
  for (const side of ['left', 'right']) {
    const h = pretendHand(side, { wrist: [0, -0.15, -0.35], point: [0, 1, 0], palm: [0, 0, 1] });
    assert.equal(h.length, 75);
    assert.ok(palmToward(h, side, eye) > 0.8, `${side} palm towards you`);
    const away = pretendHand(side, { wrist: [0, -0.15, -0.35], point: [0, 1, 0], palm: [0, 0, -1] });
    assert.ok(palmToward(away, side, eye) < -0.8, `${side} palm away`);
    const n = palmNormal(h, side);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9);
    // fingers are where a hand's are: tips 12–22 cm from the wrist
    const d = dist(h, 0, INDEX_TIP);
    assert.ok(d > 0.12 && d < 0.22, `index tip ${d.toFixed(3)} m from the wrist`);
  }
  // a pinch: thumb and index together, let go needs a wider gap (no flicker)
  const h = pretendHand('right');
  assert.equal(pinching(h), false);
  const t = joint(h, INDEX_TIP);
  for (let k = 0; k < 3; k++) h[THUMB_TIP * 3 + k] = t[k] + (k === 0 ? 0.01 : 0);
  assert.equal(pinching(h), true);
  h[THUMB_TIP * 3] = t[0] + 0.024;
  assert.equal(pinching(h, false), false, 'not yet a pinch');
  assert.equal(pinching(h, true), true, 'still held');
});
