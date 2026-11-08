// Practice speed: the steps, "Speed up each time", and the repeat's own speed.
// node --test test/speed.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampSpeed, stepSpeed, trainerStart, trainerNext, wrapped, speedKind, pct, PICKS, MIN_SPEED, MAX_SPEED } from '../src/renderer/js/speed.js';
import { createRepeat } from '../src/renderer/js/repeat.js';

test('speeds stay between 25% and 150%', () => {
  assert.equal(clampSpeed(2), 1.5);
  assert.equal(clampSpeed(0.1), 0.25);
  assert.equal(clampSpeed('x'), 1);
  assert.equal(clampSpeed(1.234), 1.23);
  for (const p of PICKS) assert.ok(p >= MIN_SPEED && p <= MAX_SPEED);
});

test('− and + go 5% at a time, and land on the 5% grid', () => {
  assert.equal(stepSpeed(1, 1), 1.05);
  assert.equal(stepSpeed(1, -1), 0.95);
  assert.equal(stepSpeed(1.45, 1), 1.5);
  assert.equal(stepSpeed(1.5, 1), 1.5);
  assert.equal(stepSpeed(0.25, -1), 0.25);
  assert.equal(stepSpeed(0.87, 1), 0.9);
  assert.equal(stepSpeed(0.87, -1), 0.85);
  // walking up from 50% reaches 150% in 20 steps with no drift
  let s = 0.5;
  for (let i = 0; i < 20; i++) s = stepSpeed(s, 1);
  assert.equal(s, 1.5);
});

test('slower and faster are told apart', () => {
  assert.equal(speedKind(0.75), 'slow');
  assert.equal(speedKind(1), '');
  assert.equal(speedKind(1.25), 'fast');
  assert.equal(pct(1.25), '125%');
});

test('Speed up each time: where it starts and each next pass', () => {
  assert.equal(trainerStart(0.7, 1), 0.7);
  assert.equal(trainerStart(1, 1), 0.75); // already there: start 25% below
  assert.equal(trainerStart(1, 1.5), 1);
  assert.equal(trainerStart(0.6, 0.5), 0.5); // never below 50% for its start
  assert.equal(trainerNext(0.7, 1), 0.75);
  assert.equal(trainerNext(0.98, 1), 1); // not past the goal
  assert.equal(trainerNext(1, 1), 1);
  assert.equal(trainerNext(1.2, 1.5), 1.25);
  let s = 0.6;
  const seen = [];
  while (s < 1) seen.push((s = trainerNext(s, 1)));
  assert.deepEqual(seen, [0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]);
});

test('a pass is counted only when the song goes round', () => {
  const loop = { start: 10, end: 20 };
  assert.equal(wrapped(19.8, 10.1, loop), true);
  assert.equal(wrapped(15, 10.1, loop), false); // jumped back by hand from the middle
  assert.equal(wrapped(19.8, 19.9, loop), false);
  assert.equal(wrapped(19.8, 10.1, null), false);
  assert.equal(wrapped(2.9, 2.05, { start: 2, end: 3 }), true); // a short repeat
});

function fakeEngine() {
  const e = new EventTarget();
  e.speed = 1;
  e.position = 0;
  e.playing = true;
  e.setSpeed = (s) => {
    e.speed = clampSpeed(s);
    e.dispatchEvent(new Event('speed'));
  };
  return e;
}

function rig() {
  const engine = fakeEngine();
  let loop = null;
  const rep = createRepeat({ engine, every: 5, setLoop: (l) => {
    loop = l;
    rep.sync(l);
  }, getLoop: () => loop });
  return { engine, rep, getLoop: () => loop };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the repeat has its own speed; stopping gives the old one back', () => {
  const { engine, rep, getLoop } = rig();
  engine.setSpeed(0.9);
  rep.start({ start: 10, end: 30, label: 'Verse 2 → Chorus 3' });
  assert.equal(rep.on, true);
  assert.equal(rep.loop.label, 'Verse 2 → Chorus 3');
  assert.equal(rep.speedBefore, 0.9);
  engine.setSpeed(0.7);
  // stretching the same repeat keeps the speed before it
  rep.start({ start: 10, end: 40, label: 'Verse 2 → Chorus 4' });
  assert.equal(rep.speedBefore, 0.9);
  assert.equal(engine.speed, 0.7);
  rep.stop();
  assert.equal(getLoop(), null);
  assert.equal(rep.on, false);
  assert.equal(engine.speed, 0.9);
});

test('a loop set some other way (Repeat it, the riff repeater) also gives its speed back', () => {
  const { engine, rep } = rig();
  rep.sync({ start: 1, end: 5 });
  engine.setSpeed(0.6);
  rep.sync(null);
  assert.equal(engine.speed, 1);
});

test('a new song forgets the repeat without touching the speed', () => {
  const { engine, rep } = rig();
  rep.start({ start: 1, end: 5 });
  engine.setSpeed(0.6);
  rep.reset();
  assert.equal(rep.on, false);
  assert.equal(engine.speed, 0.6);
});

test('Speed up each time goes 5% faster each pass, up to the goal', async () => {
  const { engine, rep } = rig();
  engine.setSpeed(1);
  rep.start({ start: 10, end: 20 });
  rep.setTrainer(true); // already at 100%: starts at 75%
  assert.equal(rep.trainer.on, true);
  assert.equal(engine.speed, 0.75);
  assert.equal(rep.passes, 1);
  const goRound = async () => {
    engine.position = 19.9;
    await wait(15);
    engine.position = 10.05;
    await wait(15);
  };
  await goRound();
  assert.equal(rep.passes, 2);
  assert.equal(engine.speed, 0.8);
  // a seek by hand is not a pass
  engine.position = 19.9;
  await wait(15);
  engine.position = 10.05;
  engine.dispatchEvent(new Event('seek'));
  await wait(15);
  assert.equal(rep.passes, 2);
  for (let i = 0; i < 8; i++) await goRound();
  assert.equal(engine.speed, 1);
  assert.equal(rep.passes, 10);
  // a lower goal pulls the speed down to it
  rep.setGoal(0.9);
  assert.equal(engine.speed, 0.9);
  rep.stop();
  assert.equal(rep.trainer.on, false);
  assert.equal(engine.speed, 1); // the speed before the repeat
});

test('paused, going round does not count', async () => {
  const { engine, rep } = rig();
  rep.start({ start: 10, end: 20 });
  rep.setTrainer(true);
  engine.playing = false;
  engine.position = 19.9;
  await wait(15);
  engine.position = 10.05;
  await wait(15);
  assert.equal(rep.passes, 1);
  rep.stop();
});
