/* Note detection: "play" synthesized guitar parts into the detector. `node test/detect.test.mjs` */
import assert from 'assert';
import { Analyzer, OnsetTracker, Judge, targetsFromTab, noteMidi, instrumentShift } from '../src/renderer/js/detect.js';

const SR = 48000;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** A part: notes and chords on a tab with a tuning. */
function part(type = 'lead') {
  const notes = [];
  const chordEvents = [];
  let t = 1.0;
  const riff = [[0, 3], [0, 5], [1, 3], [1, 5], [2, 2], [2, 5], [3, 2], [3, 4], [4, 3], [4, 5], [5, 3], [5, 5], [5, 3], [4, 5], [4, 3], [3, 4]];
  for (let r = 0; r < 2; r++) {
    for (const [s, f] of riff) {
      notes.push({ t, s, f, sus: 0 });
      t += 0.25;
    }
  }
  // repeated same note (needs a fresh attack each time)
  for (let i = 0; i < 6; i++) {
    notes.push({ t, s: 1, f: 7, sus: 0 });
    t += 0.2;
  }
  // hammer-on / pull-off pairs
  for (let i = 0; i < 4; i++) {
    notes.push({ t, s: 3, f: 5, sus: 0 });
    notes.push({ t: t + 0.18, s: 3, f: 7, sus: 0, hammerOn: true });
    notes.push({ t: t + 0.36, s: 3, f: 5, sus: 0, pullOff: true });
    t += 0.6;
  }
  // chords: power chords and open chords
  const shapes = [[[0, 3], [1, 5], [2, 5]], [[1, 3], [2, 5], [3, 5]], [[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]], [[0, 3], [1, 2], [2, 0], [3, 0], [4, 0], [5, 3]]];
  for (let i = 0; i < 12; i++) {
    chordEvents.push({ t, chord: i % 4, sus: 0, strings: shapes[i % 4].map(([s, f]) => ({ s, f })) });
    t += 0.5;
  }
  // muted strums
  for (let i = 0; i < 4; i++) {
    chordEvents.push({ t, chord: 9, sus: 0, strings: [0, 1, 2].map((s) => ({ s, f: 0, mute: true })) });
    t += 0.25;
  }
  // low notes on bass
  if (type === 'bass') {
    notes.length = 0;
    chordEvents.length = 0;
    t = 1;
    for (let i = 0; i < 40; i++) {
      notes.push({ t, s: i % 4, f: [0, 3, 5, 7][(i >> 2) % 4], sus: 0 });
      t += 0.3;
    }
  }
  return { type, tuning: [0, 0, 0, 0, 0, 0], capo: 0, cents: 0, notes, chordEvents, length: t + 1 };
}

/**
 * Renders a performance. `mistake(midi)` changes what is played; `jitter` is
 * human timing in seconds.
 */
function perform(tab, { mistake = (m) => m, jitter = 0.035, silent = false } = {}) {
  const targets = targetsFromTab(tab);
  const total = Math.ceil((tab.length + 0.5) * SR);
  const out = new Float32Array(total);
  if (silent) return out;
  // Each string rings until that string is played again (or a chord stops it).
  const voices = [];
  for (const tg of targets) {
    for (const n of tg.notes) {
      const start = tg.t + rnd() * jitter;
      voices.push({ s: n.s, start, midi: mistake(n.midi), mute: n.mute, legato: n.hammerOn || n.pullOff });
    }
  }
  voices.sort((a, b) => a.start - b.start);
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    const next = voices.slice(i + 1).find((x) => x.s === v.s);
    const end = Math.min(total / SR, next ? next.start : v.start + 2);
    const f0 = 440 * Math.pow(2, (v.midi - 69) / 12);
    const a0 = Math.floor(v.start * SR);
    const a1 = Math.floor(end * SR);
    // a legato note continues the previous note's amplitude (no pluck)
    const amp = v.legato ? 0.12 : 0.22;
    for (let k = a0; k < a1 && k < total; k++) {
      const t = (k - a0) / SR;
      if (v.mute) {
        out[k] += 0.15 * rnd() * Math.exp(-t * 60);
        continue;
      }
      let x = 0;
      for (let h = 1; h <= 7; h++) x += (h === 1 ? 0.7 : 0.5 / h) * Math.sin(2 * Math.PI * f0 * h * t * (1 + 0.00002 * h * h));
      const attack = v.legato ? 1 : Math.min(1, t / 0.002);
      out[k] += amp * attack * x * Math.exp(-t * 2.2);
    }
  }
  for (let k = 0; k < total; k++) out[k] += 0.002 * rnd();
  return out;
}

/** Runs the detector over the audio at 60 frames a second, like the app. */
function score(tab, audio, lag = 0.03) {
  const targets = targetsFromTab(tab);
  const judge = new Judge(targets);
  const an = new Analyzer(SR);
  const on = new OnsetTracker();
  const hop = Math.round(SR / 60);
  for (let end = 8192; end < audio.length; end += hop) {
    const t = end / SR - lag;
    const f = an.frame(audio.subarray(end - 8192, end));
    judge.push(t, f, on.update(t, f));
  }
  judge.tick(audio.length / SR + 1);
  const by = (kind) => {
    const xs = targets.filter((x) => x.kind === kind);
    return xs.filter((x) => judge.state.get(x.id) && judge.state.get(x.id).result === 'hit').length / xs.length;
  };
  return { all: judge.accuracy, note: by('note'), chord: by('chord'), mute: by('mute'), judge };
}

const tests = [];
const test = (n, fn) => tests.push({ n, fn });

test('playing the part right scores high', () => {
  const tab = part();
  const r = score(tab, perform(tab));
  console.log(`     notes ${(r.note * 100).toFixed(0)}%  chords ${(r.chord * 100).toFixed(0)}%  mutes ${(r.mute * 100).toFixed(0)}%  overall ${(r.all * 100).toFixed(0)}%`);
  assert.ok(r.note >= 0.9, `notes ${r.note}`);
  assert.ok(r.chord >= 0.85, `chords ${r.chord}`);
  assert.ok(r.all >= 0.9);
});

test('wrong notes (a whole step off) mostly miss', () => {
  const tab = part();
  const r = score(tab, perform(tab, { mistake: (m) => m + 2 }));
  console.log(`     notes ${(r.note * 100).toFixed(0)}%  chords ${(r.chord * 100).toFixed(0)}%`);
  assert.ok(r.note <= 0.1, `notes ${r.note}`);
  assert.ok(r.chord <= 0.35, `chords ${r.chord}`);
});

test('a semitone off is a miss too', () => {
  const tab = part();
  const r = score(tab, perform(tab, { mistake: (m) => m - 1 }));
  assert.ok(r.note <= 0.1, `notes ${r.note}`);
});

test('silence scores nothing', () => {
  const tab = part();
  const r = score(tab, perform(tab, { silent: true }));
  assert.strictEqual(r.all, 0);
});

test('playing late by 250 ms misses; within 100 ms hits', () => {
  const tab = part();
  // The riff only: repeated notes and hammer-on runs are the same pitch a beat apart, so lateness can't be told from playing the next one.
  tab.notes = tab.notes.filter((n) => n.t < 9);
  tab.chordEvents = [];
  const late = score(tab, perform(tab, { jitter: 0 }), 0.03 - 0.25);
  const close = score(tab, perform(tab, { jitter: 0 }), 0.03 - 0.08);
  console.log(`     250 ms late ${(late.note * 100).toFixed(0)}%   80 ms late ${(close.note * 100).toFixed(0)}%`);
  assert.ok(late.note <= 0.15, `late ${late.note}`);
  assert.ok(close.note >= 0.85, `close ${close.note}`);
});

test('bass down to the low E', () => {
  const tab = part('bass');
  const r = score(tab, perform(tab));
  const wrong = score(tab, perform(tab, { mistake: (m) => m + 2 }));
  console.log(`     right ${(r.note * 100).toFixed(0)}%   wrong ${(wrong.note * 100).toFixed(0)}%`);
  assert.ok(r.note >= 0.9 && wrong.note <= 0.1);
});

/**
 * A bass more like a real one: a strong fundamental, upper partials weak
 * (pluck position, falling as 1/h², `bright` per step) and dying fast,
 * stiff-string inharmonicity, mains hum. `oct` plays it that many semitones up.
 */
function realBass(tab, { mistake = (m) => m, bright = 0.85, oct = 0 } = {}) {
  const tg = targetsFromTab(tab);
  const total = Math.ceil((tab.length + 0.5) * SR);
  const out = new Float32Array(total);
  const vs = tg.map((x) => ({ start: x.t + rnd() * 0.03, midi: mistake(x.notes[0].midi) + oct }));
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    const end = vs[i + 1] ? vs[i + 1].start + 0.01 : v.start + 2;
    const f0 = 440 * Math.pow(2, (v.midi - 69) / 12);
    const a0 = Math.floor(v.start * SR);
    const a1 = Math.min(total, Math.floor(end * SR));
    for (let k = a0; k < a1; k++) {
      const t = (k - a0) / SR;
      let x = 0;
      for (let h = 1; h <= 16; h++) {
        const fh = f0 * h * Math.sqrt(1 + 0.0003 * h * h);
        if (fh > 4000) break;
        x += ((2 * Math.abs(Math.sin(Math.PI * h * 0.18))) / (h * h)) * Math.pow(bright, h - 1) * Math.sin(2 * Math.PI * fh * t) * Math.exp(-t * (1.5 + 0.27 * h * h));
      }
      out[k] += 0.35 * Math.min(1, t / 0.003) * Math.min(1, (a1 - k) / (SR * 0.01)) * x;
    }
  }
  for (let k = 0; k < total; k++) out[k] += 0.002 * rnd() + 0.004 * Math.sin((2 * Math.PI * 60 * k) / SR);
  return out;
}

test('a real-sounding bass (few overtones) still scores, wrong notes still miss', () => {
  const tab = part('bass');
  const r = score(tab, realBass(tab));
  const dull = score(tab, realBass(tab, { bright: 0.7 }));
  const semi = score(tab, realBass(tab, { mistake: (m) => m + 1 }));
  const tone = score(tab, realBass(tab, { mistake: (m) => m - 2 }));
  console.log(`     right ${(r.note * 100).toFixed(0)}%  dull ${(dull.note * 100).toFixed(0)}%  semitone off ${(semi.note * 100).toFixed(0)}%  tone off ${(tone.note * 100).toFixed(0)}%`);
  assert.ok(r.note >= 0.9 && dull.note >= 0.85, `right ${r.note} dull ${dull.note}`);
  assert.ok(semi.note <= 0.1 && tone.note <= 0.1, `semi ${semi.note} tone ${tone.note}`);
});

test('a bass part played on guitar (an octave up) scores when a guitar is heard', () => {
  const tab = part('bass');
  try {
    instrumentShift.st = 12;
    const r = score(tab, realBass(tab, { oct: 12, bright: 0.95 }));
    const wrong = score(tab, realBass(tab, { oct: 12, bright: 0.95, mistake: (m) => m + 2 }));
    const bass = score(tab, realBass(tab));
    console.log(`     guitar right ${(r.note * 100).toFixed(0)}%  wrong ${(wrong.note * 100).toFixed(0)}%  (bass itself ${(bass.note * 100).toFixed(0)}%)`);
    assert.ok(r.note >= 0.9 && wrong.note <= 0.1 && bass.note >= 0.9, `${r.note} ${wrong.note} ${bass.note}`);
  } finally {
    instrumentShift.st = 0;
  }
});

test('drop tunings and capo shift the expected pitch', () => {
  assert.strictEqual(noteMidi({ type: 'lead', tuning: [-2, 0, 0, 0, 0, 0], capo: 0 }, 0, 0), 38);
  assert.strictEqual(noteMidi({ type: 'lead', tuning: [0, 0, 0, 0, 0, 0], capo: 3 }, 1, 0), 48);
  assert.strictEqual(noteMidi({ type: 'bass', tuning: [-1, -1, -1, -1], capo: 0 }, 0, 5), 32);
});

export { part, perform, score, SR };
if (!process.env.DETECT_NO_RUN) for (const t of tests) {
  try {
    t.fn();
    console.log(`  ok  ${t.n}`);
  } catch (e) {
    console.log(`  FAIL ${t.n}\n       ${e.message}`);
    process.exitCode = 1;
  }
}
