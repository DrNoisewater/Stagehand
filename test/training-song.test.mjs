/* The timing check's training song (training-song.js): the chart, the audio, and that the
 * real scoring hears a guitar playing it. `node --test test/training-song.test.mjs` */
import test from 'node:test';
import assert from 'assert';
import { trainingChart, trainingTimes, renderTraining, renderPart, trainingAudio } from '../src/renderer/js/training-song.js';
import { Analyzer, OnsetTracker, Judge, targetsFromTab } from '../src/renderer/js/detect.js';
import { matchTiming, attackAgo } from '../src/renderer/js/highway-timing.js';

globalThis.localStorage ||= { getItem: () => null, setItem() {} };

for (const kind of ['guitar', 'bass']) {
  test(`${kind}: a short, simple chart shaped like a real song`, () => {
    const tab = trainingChart(kind, [], 0);
    for (const k of ['notes', 'chordEvents', 'beats', 'sections', 'anchors', 'handShapes', 'chords', 'tuning', 'strings', 'type', 'length', 'tuningName']) assert.ok(k in tab, k);
    assert.strictEqual(tab.strings, kind === 'bass' ? 4 : 6);
    assert.strictEqual(tab.tuning.length, 6);
    assert.ok(tab.length >= 24 && tab.length <= 30, `length ${tab.length}`);
    assert.ok(tab.notes.length >= 16 && tab.notes.length <= 24, `${tab.notes.length} notes`);
    const top = kind === 'bass' ? [1, 2, 3] : [3, 4, 5];
    for (const n of tab.notes) {
      assert.ok(top.includes(n.s), `string ${n.s}`);
      assert.ok(n.f >= 0 && n.f <= 3, `fret ${n.f}`);
    }
    const t = trainingTimes(tab);
    assert.ok(t[0] > 3, 'a count-in first');
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] > 0.6, 'spaced out');
    assert.ok(tab.beats.some((b) => b.m >= 0) && tab.beats.length > 30);
    assert.ok(targetsFromTab(tab).every((x) => x.kind === 'note'));
  });
}

test('the backing is music: loud enough, never clipping, silent only before the count-in', () => {
  const tab = trainingChart('guitar', [], 0);
  const sr = 48000;
  const t0 = performance.now();
  const r = renderTraining(tab, sr);
  const ms = performance.now() - t0;
  assert.ok(ms < 4000, `took ${Math.round(ms)} ms`);
  assert.strictEqual(r.L.length, Math.ceil(tab.length * sr));
  let e = 0;
  let pk = 0;
  for (const x of [r.L, r.R]) for (const v of x) {
    assert.ok(Number.isFinite(v));
    e += v * v;
    pk = Math.max(pk, Math.abs(v));
  }
  const db = 10 * Math.log10(e / (2 * r.L.length));
  assert.ok(pk < 1 && pk > 0.5, `peak ${pk}`);
  assert.ok(db > -24 && db < -10, `level ${db.toFixed(1)} dB`);
  const w = trainingAudio(tab, sr);
  assert.strictEqual(w.wav.frames, r.L.length);
  assert.strictEqual(new DataView(w.buffer).getUint32(8, false), 0x57415645); // WAVE
});

test('the part follows your tuning (E♭ Standard is a semitone down)', () => {
  const e = trainingChart('guitar', [0, 0, 0, 0, 0, 0], 0);
  const eb = trainingChart('guitar', [-1, -1, -1, -1, -1, -1], 0);
  assert.strictEqual(eb.tuningName, 'E♭ Standard');
  const m = (tab) => targetsFromTab(tab)[0].notes[0].midi;
  assert.strictEqual(m(e) - m(eb), 1);
});

/** Plays `x` into the real detector the way the highway does (a frame every 1/60 s). */
function judge(tab, x, sr) {
  const targets = targetsFromTab(tab);
  const j = new Judge(targets);
  j.reset(0);
  const an = new Analyzer(sr);
  const on = new OnsetTracker();
  const picks = [];
  const step = Math.round(sr / 60);
  for (let end = 8192; end < x.length; end += step) {
    const buf = x.subarray(end - 8192, end);
    const t = end / sr;
    const f = an.frame(buf);
    const k = on.update(t, f);
    j.push(t, f, k);
    if (k === 'attack') {
      const a = t - attackAgo(buf, sr);
      if (!picks.length || a - picks[picks.length - 1] > 0.12) picks.push(a);
    }
    j.tick(t);
  }
  j.tick(x.length / sr + 1);
  return { j, picks, targets };
}

for (const kind of ['guitar', 'bass']) {
  test(`${kind}: scoring hears the part played 60 ms late, and the timing comes out at about +60 ms`, () => {
    const sr = 48000;
    const tab = trainingChart(kind, [], 0);
    const x = renderPart(tab, sr, 0.06);
    const { j, picks } = judge(tab, x, sr);
    assert.ok(j.hits >= tab.notes.length - 2, `${j.hits} of ${tab.notes.length} hit`);
    const r = matchTiming(trainingTimes(tab), picks);
    assert.ok(r.matched >= tab.notes.length - 2, `${r.matched} matched`);
    assert.ok(Math.abs(r.ms - 60) <= 15, `measured ${r.ms} ms`);
  });
}
