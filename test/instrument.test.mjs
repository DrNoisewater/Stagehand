/* Guitar or bass from what's played (instrument.js). `node --test test/instrument.test.mjs` */
import test from 'node:test';
import assert from 'assert';
import { InstrumentSense } from '../src/renderer/js/instrument.js';

/** Plays notes (MIDI) one after another, 20 readings a second, each note held `hold` s with a short gap. */
function play(s, notes, { t0 = 0, hold = 0.4 } = {}) {
  let t = t0;
  const changes = [];
  for (const m of notes) {
    for (let k = 0; k < hold * 20; k++, t += 0.05) {
      const r = s.push(t, m, 0.05);
      if (r) changes.push(r);
    }
    const r = s.push(t, null, 0.002);
    if (r) changes.push(r);
    t += 0.05;
  }
  return { t, changes };
}

test('a bass line is a bass after a couple of low notes', () => {
  const s = new InstrumentSense();
  const { changes } = play(s, [28, 31, 33, 35, 40, 43]);
  assert.deepStrictEqual(changes, ['bass']);
  assert.strictEqual(s.instrument, 'bass');
});

test('a guitar riff in standard tuning never reads as bass', () => {
  const s = new InstrumentSense();
  play(s, [40, 43, 45, 47, 50, 52, 40, 41, 43, 45, 38.8]);
  assert.notStrictEqual(s.instrument, 'bass');
});

test('a guitar dropped to C can go low without becoming a bass', () => {
  const s = new InstrumentSense({ lowest: 36 });
  play(s, [36, 36, 38, 39, 36, 41, 36]);
  assert.notStrictEqual(s.instrument, 'bass');
});

test('back to guitar: notes up high with nothing low', () => {
  const s = new InstrumentSense({ instrument: 'bass' });
  let { t, changes } = play(s, [28, 33]);
  // 15 s of quiet, then a lead line
  ({ changes } = play(s, [64, 67, 69, 71, 72, 76], { t0: t + 16 }));
  assert.deepStrictEqual(changes, ['guitar']);
});

test('bass harmonics now and then do not flip a bass to guitar', () => {
  const s = new InstrumentSense({ instrument: 'bass' });
  const line = [];
  for (let i = 0; i < 6; i++) line.push(28, 33, 67, 35, 40);
  const { changes } = play(s, line);
  assert.deepStrictEqual(changes, []);
});

test('low rhythm guitar with no high notes still turns back to guitar after a while', () => {
  const s = new InstrumentSense({ instrument: 'bass' });
  const riff = [];
  for (let i = 0; i < 120; i++) riff.push([40, 43, 45, 47][i % 4]);
  const { changes } = play(s, riff);
  assert.deepStrictEqual(changes, ['guitar']);
});

test('one-off glitches (a single low reading) are ignored', () => {
  const s = new InstrumentSense({ instrument: 'guitar' });
  let t = 0;
  for (let i = 0; i < 40; i++, t += 0.05) s.push(t, i % 13 === 0 ? 30 : 52, 0.05);
  assert.strictEqual(s.instrument, 'guitar');
});
