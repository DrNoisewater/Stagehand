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

// ---- power chords are not bass notes (3.13) ----
import { realLow, reading } from '../src/renderer/js/instrument.js';
import { detectPitch } from '../src/renderer/js/pitch.js';

const SR = 48000;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
/** Notes (MIDI) with given partial strengths, 4096 samples, plus a little noise. */
function sound(notes, partial, n = 4096) {
  const b = new Float32Array(n);
  let seed = 7;
  for (const m of notes) {
    const f = hz(m);
    for (let h = 1; h <= 14; h++) {
      const a = partial(h);
      for (let i = 0; i < n; i++) b[i] += a * Math.sin((2 * Math.PI * f * h * i) / SR + h * 1.3);
    }
  }
  for (let i = 0; i < n; i++) b[i] += ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
  return b;
}
const guitar = (h) => (0.3 / h) * Math.exp(-h * 0.15);

test('a power chord reads an octave low, and realLow catches it', () => {
  for (const root of [36, 38, 40, 41, 43, 45, 47]) {
    for (const chord of [[root, root + 7], [root, root + 7, root + 12]]) {
      const b = sound(chord, guitar);
      const p = detectPitch(b, SR, { threshold: 0.12 });
      const m = 69 + 12 * Math.log2(p.hz / 440);
      assert.ok(Math.abs(m - (root - 12)) < 0.5, `the reader hears ${m.toFixed(1)} for ${chord}`);
      assert.strictEqual(realLow(b, SR, p.hz), false, `power chord ${chord} taken for a low note`);
    }
  }
});

test('real bass notes pass realLow, even with a weak fundamental', () => {
  const bass = (h) => 1 / (h * h);
  const thin = (h) => (h === 1 ? 0.12 : 1 / (h * h)); // pickup/cable loses most of the lowest partial
  for (const m of [23, 28, 31, 33, 35, 36]) {
    for (const shape of [bass, thin]) {
      const b = sound([m], shape);
      assert.strictEqual(realLow(b, SR, hz(m)), true, `bass note ${m} rejected`);
    }
  }
});

test('a strummed power-chord riff stays a guitar, start to finish', () => {
  const s = new InstrumentSense({ instrument: 'guitar', lowest: 38 }); // guitar in Drop D
  const changes = [];
  let t = 0;
  for (let i = 0; i < 24; i++) {
    const root = [40, 43, 45, 41, 38][i % 5];
    const b = sound([root, root + 7, root + 12], guitar);
    for (let k = 0; k < 8; k++, t += 0.05) {
      const r = s.push(t, reading(b, SR, 0.1, 38), 0.1);
      if (r) changes.push(r);
    }
    const r = s.push((t += 0.05), null, 0.002);
    if (r) changes.push(r);
  }
  assert.deepStrictEqual(changes, []);
  // and a real bass is still heard as one
  const b2 = new InstrumentSense({ instrument: 'guitar' });
  for (let i = 0; i < 6; i++) {
    const b = sound([[28, 31, 33][i % 3]], (h) => 1 / (h * h));
    for (let k = 0; k < 8; k++, t += 0.05) b2.push(t, reading(b, SR, 0.1, 40), 0.1);
    b2.push((t += 0.05), null, 0.002);
  }
  assert.strictEqual(b2.instrument, 'bass');
});

test('one stray low reading does not flip a guitar to bass', () => {
  const s = new InstrumentSense({ instrument: 'guitar' });
  const { changes } = play(s, [40, 28, 43, 45, 31, 47, 50]);
  assert.deepStrictEqual(changes, []);
});
