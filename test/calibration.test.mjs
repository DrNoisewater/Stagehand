/* The play-along calibration's timing maths (highway-timing.js matchTiming). `node --test test/calibration.test.mjs` */
import test from 'node:test';
import assert from 'assert';
import { matchTiming } from '../src/renderer/js/highway-timing.js';

const beats = Array.from({ length: 16 }, (_, i) => 2 + i * 0.75);

test('playing 40 ms late on every note gives +40 ms', () => {
  let seed = 3;
  const jitter = () => (((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5) * 0.02; // ±10 ms
  const r = matchTiming(beats, beats.map((b) => b + 0.04 + jitter()));
  assert.strictEqual(r.matched, 16);
  assert.ok(Math.abs(r.ms - 40) <= 5, `got ${r.ms}`);
  assert.ok(r.spread < 10);
});

test('a few stray notes and missed beats do not throw it off', () => {
  const played = beats.filter((_, i) => i % 5 !== 2).map((b) => b - 0.025);
  played.push(3.1, 7.4, 9.0); // extra strums between beats
  const r = matchTiming(beats, played);
  assert.ok(r.matched >= 12);
  assert.ok(Math.abs(r.ms + 25) <= 10, `got ${r.ms}`);
});

test('nothing played: no result', () => {
  const r = matchTiming(beats, []);
  assert.strictEqual(r.matched, 0);
  assert.strictEqual(r.ms, null);
});

test('the same playing gives the same answer every time (repeatable)', () => {
  const played = beats.map((b, i) => b + 0.06 + (i % 3) * 0.004);
  assert.deepStrictEqual(matchTiming(beats, played), matchTiming(beats, played));
});

import { attackAgo } from '../src/renderer/js/highway-timing.js';
test('finds the pick inside the buffer, whenever the detector noticed it', () => {
  const sr = 48000;
  for (const ago of [0.02, 0.06, 0.12]) {
    const b = new Float32Array(8192);
    const at = b.length - Math.round(ago * sr);
    for (let i = 0; i < b.length; i++) b[i] = (Math.random() - 0.5) * 0.002 + (i >= at ? 0.4 * Math.exp(-(i - at) / 9000) * Math.sin((2 * Math.PI * 110 * (i - at)) / sr) : 0);
    const got = attackAgo(b, sr);
    assert.ok(Math.abs(got - ago) < 0.006, `pick ${ago * 1000} ms ago, found ${Math.round(got * 1000)} ms`);
  }
});
