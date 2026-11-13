// Chord scoring (4.7.1): a wrong chord (E minor for E major, a power chord two frets off) is a miss,
// while a messy strum of the right chord still counts: strings uneven and a little out of tune,
// a string missed, one string of a doubled note a fret off, only the top strings.
// Synthesised playing only. About a minute; not in npm test (like detect.test.mjs).
import assert from 'node:assert';
import { Analyzer, OnsetTracker, Judge, targetsFromTab } from '../src/renderer/js/detect.js';

const SR = 48000;
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
  const xs = targets.filter((x) => x.kind === 'chord');
  return { chord: xs.filter((x) => judge.state.get(x.id)?.result === 'hit').length / xs.length };
}

const C = {
  E: [[0,0],[1,2],[2,2],[3,1],[4,0],[5,0]], Em: [[0,0],[1,2],[2,2],[3,0],[4,0],[5,0]],
  A: [[1,0],[2,2],[3,2],[4,2],[5,0]], Am: [[1,0],[2,2],[3,2],[4,1],[5,0]],
  D: [[2,0],[3,2],[4,3],[5,2]], Dm: [[2,0],[3,2],[4,3],[5,1]],
  G: [[0,3],[1,2],[2,0],[3,0],[4,0],[5,3]], C: [[1,3],[2,2],[3,0],[4,1],[5,0]],
  F: [[0,1],[1,3],[2,3],[3,2],[4,1],[5,1]], Bm: [[1,2],[2,4],[3,4],[4,3],[5,2]],
  B7: [[1,2],[2,1],[3,2],[4,0],[5,2]], Am7: [[1,0],[2,2],[3,0],[4,1],[5,0]],
  E5: [[0,0],[1,2],[2,2]], A5: [[1,0],[2,2],[3,2]], G5: [[0,3],[1,5],[2,5]], Fs5: [[0,2],[1,4],[2,4]],
  Fm: [[0,1],[1,3],[2,3],[3,1],[4,1],[5,1]], Cm: [[1,3],[2,5],[3,5],[4,4],[5,3]], C3: [[1,3],[2,5],[3,5],[4,5],[5,3]],
};
const WRONG = { E:'Em', Em:'E', A:'Am', Am:'A', D:'Dm', Dm:'D', G:'Em', C:'Am', F:'Fm', Bm:'D', B7:'Bm', Am7:'Am',
  E5:'Fs5', A5:'G5', G5:'A5', Fs5:'E5', Fm:'F', Cm:'C3', C3:'Cm' };
// a messier player: strings uneven, a little out of tune, a strum that takes time, now and then a string missed
let seed2 = 7; const R = () => ((seed2 = (seed2 * 16807) % 2147483647) / 2147483647);
function play(chords, { mess = 0 }) { // chords: arrays of [s, f]
  const len = chords.length * 0.6 + 2, total = Math.ceil(len * SR), out = new Float32Array(total);
  const ring = new Array(6).fill(null);
  const voices = [];
  chords.forEach((ch, i) => {
    const t0 = 1 + i * 0.6 + (R() - 0.5) * 0.06;
    const spread = mess ? 0.01 + R() * 0.03 : 0.004;
    const tune = [0,0,0,0,0,0].map(() => mess ? (R() - 0.5) * 0.25 : 0); // up to ±12 cents
    for (const [s, f] of ch) {
      if (mess && ch.length > 3 && R() < 0.12) continue; // missed string
      voices.push({ s, start: t0 + spread * (s / 5), midi: [40,45,50,55,59,64][s] + f + tune[s], g: mess ? 0.35 + R() * 0.9 : 1, bright: mess ? 0.5 + R() : 1 });
    }
  });
  voices.sort((a, b) => a.start - b.start);
  voices.forEach((v, i) => {
    const nx = voices.slice(i + 1).find((x) => x.s === v.s);
    const end = Math.min(len, nx ? nx.start : v.start + 2.5);
    const f0 = 440 * 2 ** ((v.midi - 69) / 12), a0 = Math.floor(v.start * SR), a1 = Math.floor(end * SR);
    for (let k = a0; k < a1 && k < total; k++) {
      const t = (k - a0) / SR; let x = 0;
      for (let h = 1; h <= 9; h++) x += (h === 1 ? 0.7 : (0.5 / h) * v.bright ** (h / 3)) * Math.sin(2 * Math.PI * f0 * h * t * (1 + 0.00002 * h * h));
      out[k] += 0.2 * v.g * Math.min(1, t / 0.002) * x * Math.exp(-t * (2 + 0.3 * v.s));
    }
  });
  for (let k = 0; k < total; k++) out[k] += 0.002 * (R() - 0.5);
  return { out, len };
}
function rate(want, played, mess) {
  const { out, len } = play(played, { mess });
  const chordEvents = want.map((w, i) => ({ t: 1 + i * 0.6, chord: 0, sus: 0, strings: w.map(([s, f]) => ({ s, f })) }));
  return score({ type: 'lead', tuning: [0,0,0,0,0,0], capo: 0, cents: 0, notes: [], chordEvents, length: len - 1 }, out).chord;
}
const keys = Object.keys(C), N = 3;
const seq = (f) => { const w = [], p = []; for (let k = 0; k < N; k++) for (const c of keys) { w.push(C[c]); p.push(f(c)); } return [w, p]; };
// a doubled note (root or fifth on another string too) a fret off: forgivable
const slip = (c) => { const s = C[c].map((x) => [...x]); const pcs = s.map(([q, f]) => ([40,45,50,55,59,64][q] + f) % 12);
  const i = s.findIndex((x, j) => pcs.filter((p) => p === pcs[j]).length > 1 && x[1] > 0); if (i >= 0) s[i][1] += 1; return s; };
const half = (c) => C[c].slice(Math.floor(C[c].length / 2) - (C[c].length > 3 ? 0 : 0));
let bad = 0;
for (const [name, f, mess, ok] of [
  ['right, clean', (c) => C[c], 0, (r) => r >= 0.97],
  ['right, messy', (c) => C[c], 1, (r) => r >= 0.93],
  ['one string of a doubled note a fret off', slip, 1, (r) => r >= 0.82],
  ['top strings only', half, 1, (r) => r >= 0.93],
  ['wrong chord (major for minor, etc.)', (c) => C[WRONG[c]], 0, (r) => r <= 0.3],
  ['wrong chord, messy', (c) => C[WRONG[c]], 1, (r) => r <= 0.4],
]) {
  const [w, p] = seq(f);
  const r = rate(w, p, mess);
  const pass = ok(r);
  if (!pass) bad++;
  console.log(pass ? '  ok  ' : '  FAIL', name.padEnd(42), (r * 100).toFixed(0) + '% counted');
}
assert.equal(bad, 0);
console.log('all passed');
