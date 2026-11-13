/* Sing along: the scoring rules and reading notes off a recording. `node test/sing.test.mjs` */
import assert from 'node:assert';
import { buildSing, SingJudge, foldCents, nearOctave, withPitches, pitchedShare, hasPitch } from '../src/renderer/js/sing.js';
import { pitchesFromAudio } from '../src/renderer/js/vocal-pitch.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// two lines of four syllables, half a second each, going up a scale; the last syllable has no note
const NOTES = [60, 62, 64, 65, 67, 65, 64, null];
const lyrics = NOTES.map((p, i) => ({ t: 2 + i * 0.6, d: 0.5, w: `la${i === 3 || i === 7 ? '+' : ''}`, p: p === null ? 254 : p }));
const { syl, lines } = buildSing(lyrics);

/** Sings the song: `voice(i, s)` gives { midi } for syllable i, or null to stay quiet; `late` shifts the singer. */
function run(level, voice, { late = 0, talk = false } = {}) {
  const j = new SingJudge(syl, lines, level);
  for (let t = 0; t < 9; t += 0.02) {
    const ts = t - late;
    const i = syl.findIndex((s) => ts >= s.t && ts < s.t + s.d);
    const v = i >= 0 ? voice(i, syl[i]) : null;
    j.push(t, v ? { voiced: true, midi: talk ? null : v.midi } : { voiced: false, midi: null });
    j.tick(t);
  }
  return j;
}

test('lines and syllables are read from the lyrics', () => {
  assert.strictEqual(syl.length, 8);
  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual([lines[0].from, lines[0].to, lines[1].from, lines[1].to], [0, 4, 4, 8]);
  assert.strictEqual(syl[7].p, null);
  assert.ok(hasPitch(60) && !hasPitch(0) && !hasPitch(254) && !hasPitch(255) && !hasPitch(120));
  assert.strictEqual(pitchedShare(syl), 7 / 8);
});

test('folding to the octave', () => {
  assert.strictEqual(foldCents(72, 60), 0);
  assert.strictEqual(foldCents(48.5, 60), 50);
  assert.strictEqual(Math.round(foldCents(59.2, 60)), -80);
  assert.strictEqual(nearOctave(74, 61), 62);
});

test('a perfect singer hits everything on every level', () => {
  for (const lv of ['easy', 'medium', 'hard']) {
    const j = run(lv, (i, s) => ({ midi: s.p ?? 50 }));
    assert.strictEqual(j.judged, 8, lv);
    assert.strictEqual(j.hits, 8, lv);
    assert.strictEqual(j.bestStreak, 2, lv);
    assert.deepStrictEqual(j.lineResult, [1, 1]);
  }
});

test('an octave down counts the same', () => {
  const j = run('hard', (i, s) => ({ midi: (s.p ?? 50) - 12 }));
  assert.strictEqual(j.hits, 8);
});

test('80 cents sharp passes Easy and Medium, not Hard', () => {
  const sharp = (i, s) => ({ midi: (s.p ?? 50) + 0.8 });
  assert.strictEqual(run('easy', sharp).hits, 8);
  assert.strictEqual(run('medium', sharp).hits, 8);
  const hard = run('hard', sharp);
  assert.strictEqual(hard.hits, 1); // only the syllable without a note
  assert.strictEqual(hard.bestStreak, 0);
});

test('a little late is fine, half a second late is not', () => {
  assert.strictEqual(run('medium', (i, s) => ({ midi: s.p ?? 50 }), { late: 0.1 }).hits, 8);
  // (on Hard: on Medium a neighbour one fret away is close enough to count)
  const j = run('hard', (i, s) => ({ midi: s.p ?? 50 }), { late: 0.5 });
  assert.ok(j.hits <= 1, `late singer hit ${j.hits}`);
});

test('silence hits nothing', () => {
  const j = run('easy', () => null);
  assert.strictEqual(j.judged, 8);
  assert.strictEqual(j.hits, 0);
  assert.strictEqual(j.accuracy, 0);
});

test('talking (a voice with no note) only counts where the chart has no note', () => {
  const j = run('easy', () => ({ midi: 0 }), { talk: true });
  assert.strictEqual(j.hits, 1);
  assert.strictEqual(j.result[7], 'hit');
});

test('jumping back forgets what came after, keeps what came before', () => {
  const j = run('medium', (i, s) => ({ midi: s.p ?? 50 }));
  j.rewind(lines[1].t0 + 0.7); // into the second line: it starts again as a whole
  assert.strictEqual(j.judged, 4);
  assert.strictEqual(j.hits, 4);
  assert.strictEqual(j.lineResult[1], null);
  assert.strictEqual(j.next, 4);
});

test('notes read off a recording: steps, a glide and gaps, within 30 cents', () => {
  const sr = 44100;
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  // a made-up singer: four held notes with vibrato, a gap, a note that glides up 2 semitones, then nothing
  const plan = [
    { t: 0.5, d: 0.5, m: 57 },
    { t: 1.1, d: 0.4, m: 60.3 },
    { t: 1.6, d: 0.6, m: 64 },
    { t: 2.3, d: 0.25, m: 52 },
    { t: 3.5, d: 0.6, m: 62, glide: 2 },
    { t: 5.0, d: 0.5, m: null },
  ];
  const x = new Float32Array(sr * 6);
  for (const s of plan) {
    if (s.m === null) continue;
    let ph = 0;
    for (let i = 0; i < s.d * sr; i++) {
      const u = i / (s.d * sr);
      const m = s.m + (s.glide ? s.glide * u : 0) + 0.15 * Math.sin(2 * Math.PI * 5.5 * (i / sr));
      ph += (2 * Math.PI * hz(m)) / sr;
      const env = Math.min(1, u * 20, (1 - u) * 20);
      x[Math.round(s.t * sr) + i] = 0.3 * env * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph));
    }
  }
  // breath noise everywhere
  let seed = 7;
  for (let i = 0; i < x.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    x[i] += ((seed / 0x7fffffff) * 2 - 1) * 0.004;
  }
  const read = (start, out) => {
    for (let i = 0; i < out.length; i++) out[i] = start + i >= 0 && start + i < x.length ? x[start + i] : 0;
  };
  const got = pitchesFromAudio(read, sr, plan);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(got[i] - plan[i].m) < 0.3, `note ${i}: ${got[i]} vs ${plan[i].m}`);
  assert.ok(Math.abs(got[4] - 63) < 0.6, `glide: ${got[4]}`); // the middle of the glide
  assert.strictEqual(got[5], null);
  // laid over a chart with no notes: every found note is used, octaves kept near each other
  const merged = withPitches(plan.map((s) => ({ t: s.t, d: s.d, p: null })), got);
  assert.strictEqual(merged.filter((s) => s.p !== null).length, 5);
  // the chart's own note wins
  assert.strictEqual(withPitches([{ t: 0, d: 1, p: 61 }], [70])[0].p, 61);
});

console.log(`sing: ${passed} passed`);
