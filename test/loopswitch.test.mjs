// The Loop switcher (A/B box): only the playing loop and the shared gear reach the sound engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setGear, toSpec } from '../src/renderer/js/gearspec.js';
import { loopView, hasLoopSwitch, LOOP_KEY } from '../src/renderer/js/loopswitch.js';
import { isChanged } from '../src/renderer/js/toneslots.js';
import { buildTone, freshChoices, newPedal } from '../src/renderer/js/tonerecipes.js';

setGear(JSON.parse(fs.readFileSync(new URL('../src/renderer/data/gear2014.json', import.meta.url))));

const g = (slot, key, order, extra = {}) => ({ slot, key, knobs: {}, order, ...extra });
const tone = (sw = {}) => ({
  name: 'Two sounds',
  kind: 'guitar',
  gear: [
    g('pre', 'Pedal_Compression', 0), // shared
    g('pre', LOOP_KEY, 1, sw),
    g('pre', 'Pedal_SuperDrive', 2, { loop: 'B' }),
    g('amp', 'Amp_OrangeAD50', 3, { loop: 'A' }),
    g('amp', 'Amp_MarshallJCM800', 4, { loop: 'B' }),
    g('cab', 'Cab_Orange_57_Cone', 5),
    g('post', 'Pedal_Chorus20', 6, { loop: 'A' }),
    g('rack', 'Rack_StudioPlate', 7),
  ],
});
const keys = (spec) => spec.split('\n').filter((l) => l.startsWith('gear\t')).map((l) => l.split('\t')[2]);

test('loop A leaves out loop B gear and the switcher; shared gear stays', () => {
  const k = keys(toSpec(tone(), 'A'));
  assert.deepEqual(k, ['Pedal_Compression', 'Amp_OrangeAD50', 'Pedal_Chorus20', 'Cab_Orange_57_Cone', 'Rack_StudioPlate']);
});

test('loop B leaves out loop A gear', () => {
  const k = keys(toSpec(tone(), 'B'));
  assert.deepEqual(k, ['Pedal_Compression', 'Pedal_SuperDrive', 'Amp_MarshallJCM800', 'Cab_Orange_57_Cone', 'Rack_StudioPlate']);
});

test('the switcher never reaches the engine, even by itself', () => {
  assert.ok(!toSpec(tone(), 'A').includes(LOOP_KEY));
  assert.ok(!toSpec({ kind: 'guitar', gear: [g('pre', LOOP_KEY, 0), g('amp', 'Amp_OrangeAD50', 1)] }).includes(LOOP_KEY));
});

test('a tone with no switcher ignores stray loop tags', () => {
  const t = { ...tone(), gear: tone().gear.filter((x) => x.key !== LOOP_KEY) };
  assert.equal(keys(toSpec(t, 'B')).length, 7);
  assert.equal(loopView(t, 'B'), t);
});

test('a bypassed switcher plays loop A and shared gear only, whatever side is asked', () => {
  const t = tone({ bypass: true });
  assert.ok(!hasLoopSwitch(t));
  const a = keys(toSpec(t, 'A'));
  assert.deepEqual(keys(toSpec(t, 'B')), a);
  assert.ok(a.includes('Amp_OrangeAD50') && !a.includes('Amp_MarshallJCM800'));
});

test('which loop plays is not an edit; which loop a piece is in is', () => {
  const saved = tone();
  const draft = JSON.parse(JSON.stringify(saved));
  loopView(draft, 'B');
  assert.equal(isChanged(saved, draft), false);
  draft.gear[2].loop = 'A';
  assert.equal(isChanged(saved, draft), true);
});

test('Create a tone saves the loops only when a switcher is on the board', () => {
  const W = freshChoices('guitar');
  W.board = [newPedal('guitar', 'Pedal_SuperDrive'), newPedal('guitar', LOOP_KEY)];
  W.board[0].loop = 'B';
  W.ampLoop = 'A';
  const t = buildTone(W);
  assert.equal(t.gear.find((x) => x.key === 'Pedal_SuperDrive').loop, 'B');
  assert.equal(t.gear.find((x) => x.slot === 'amp').loop, 'A');
  assert.ok(t.gear.some((x) => x.key === LOOP_KEY));
  W.board = W.board.filter((p) => p.key !== LOOP_KEY);
  assert.ok(!buildTone(W).gear.some((x) => x.loop));
});
