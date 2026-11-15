/* 4.19: the singer's real pitch line read off a vocals stem, and chart notes checked against it.
   Made-up voices only (no recordings in the repo). `node test/melody.test.mjs` */
import assert from 'node:assert';
import { melodyFromAudio, trackVoice } from '../src/renderer/js/vocal-melody.js';
import { buildSing, checkNotes, noteAt, tuneNotes, foldCents, SingJudge } from '../src/renderer/js/sing.js';

let passed = 0;
const test = (name, fn) => {
  const t0 = Date.now();
  fn();
  passed++;
  console.log(`  ok  ${name} (${Date.now() - t0} ms)`);
};

const SR = 44100;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

/**
 * A made-up singer. Each note: { t, d, m, to (slide to this note), bend (up and back), run (notes
 * the word runs over), vib, gain }. The voice has overtones shaped like a vowel, a breathy edge,
 * a soft start and end, and a little drift, as a real one does.
 */
function sing(x, notes, { gain = 0.3, vib = 0.3, vowel = [700, 1200, 2600], delay = 0 } = {}) {
  for (const s of notes) {
    if (s.m === null || s.m === undefined) continue;
    let ph = 0;
    const len = Math.round(s.d * SR);
    const drift = rnd() * 0.08;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      let m = s.m;
      if (s.to !== undefined) m += (s.to - s.m) * Math.min(1, Math.max(0, (u - 0.15) / 0.6));
      if (s.bend) m += s.bend * Math.sin(Math.PI * u) ** 2;
      if (s.run) m = s.run[Math.min(s.run.length - 1, Math.floor(u * s.run.length))];
      if (s.scoop) m -= s.scoop * Math.max(0, 1 - (i / SR) / 0.08);
      m += (s.vib ?? vib) * Math.sin(2 * Math.PI * 5.6 * (i / SR)) * Math.min(1, (i / SR) / 0.15) + drift;
      const f = hz(m);
      ph += (2 * Math.PI * f) / SR;
      const env = Math.min(1, (i / SR) / 0.025, ((len - i) / SR) / 0.04);
      let v = 0;
      for (let h = 1; h <= 14 && h * f < 6000; h++) {
        // a vowel: overtones near the mouth's resonances are louder
        let a = 1 / h;
        for (const F of vowel) a += 1.6 * Math.exp(-(((h * f - F) / 180) ** 2)) / Math.sqrt(h);
        v += a * Math.sin(h * ph);
      }
      const k = Math.round((s.t + delay) * SR) + i;
      if (k >= 0 && k < x.length) x[k] += (s.gain ?? gain) * env * (v * 0.35 + rnd() * 0.03);
    }
  }
}
const reader = (x) => (start, out) => {
  for (let i = 0; i < out.length; i++) out[i] = start + i >= 0 && start + i < x.length ? x[start + i] : 0;
};
const noise = (x, a) => {
  for (let i = 0; i < x.length; i++) x[i] += rnd() * a;
};
/** A tune of n syllables from t0, each `d` long with a small gap; a line every `per` syllables. */
function tune(ps, { t0 = 1, d = 0.4, gap = 0.06, per = 6, rest = 0.9 } = {}) {
  let t = t0;
  return ps.map((m, i) => {
    const o = { t, d, m };
    t += d + gap + ((i + 1) % per === 0 ? rest : 0);
    return o;
  });
}
const lyricsOf = (notes, chartP, per = 6) => notes.map((s, i) => ({ t: s.t, d: s.d, w: `la${(i + 1) % per === 0 ? '+' : ''}`, p: chartP(i) }));
const off = (a, b) => Math.abs(foldCents(a, b));

const MELODY = [57, 59, 60, 62, 64, 62, 60, 59, 57, 64, 65, 67, 69, 67, 65, 64, 62, 60, 59, 57, 60, 64, 67, 64];

test('a clean singer: every note read within 25 cents, steady notes stay plain bars', () => {
  const notes = tune(MELODY);
  const x = new Float32Array(SR * 16);
  sing(x, notes);
  noise(x, 0.003);
  const got = melodyFromAudio(reader(x), SR, notes);
  notes.forEach((s, i) => {
    assert.ok(got[i].p !== null, `note ${i} was left blank`);
    assert.ok(off(got[i].p, s.m) < 25, `note ${i}: ${got[i].p} vs ${s.m}`);
    assert.strictEqual(got[i].c, null, `note ${i} is steady (vibrato only) but got a line: ${JSON.stringify(got[i].c)}`);
    assert.ok(Math.abs(got[i].p - s.m) < 1, `note ${i} in the wrong octave: ${got[i].p}`);
  });
});

test('slides, bends, scoops and a word over several notes keep their shape', () => {
  const notes = [
    { t: 1.0, d: 0.9, m: 60, to: 64 }, // a slide up four semitones
    { t: 2.1, d: 0.8, m: 67, bend: -2 }, // dips two semitones and comes back
    { t: 3.1, d: 1.2, m: 64, run: [64, 62, 60, 62] }, // one word, four notes
    { t: 4.5, d: 0.6, m: 62 }, // a plain held note
    { t: 5.3, d: 0.7, m: 65, to: 62 }, // a fall
  ];
  const x = new Float32Array(SR * 7);
  sing(x, notes, { vib: 0.15 });
  noise(x, 0.003);
  const got = melodyFromAudio(reader(x), SR, notes);
  const at = (i, u) => noteAt({ ...notes[i], ...got[i] }, notes[i].t + notes[i].d * u);
  assert.ok(got[0].c, 'the slide has a line');
  assert.ok(off(at(0, 0.1), 60) < 60 && off(at(0, 0.95), 64) < 60, `slide: ${at(0, 0.1)} → ${at(0, 0.95)}`);
  assert.ok(got[1].c, 'the bend has a line');
  assert.ok(off(at(1, 0.08), 67) < 70 && off(at(1, 0.5), 65) < 60 && off(at(1, 0.94), 67) < 70, `bend: ${at(1, 0.08)} ${at(1, 0.5)} ${at(1, 0.94)}`);
  assert.ok(got[2].c, 'the run has a line');
  [64, 62, 60, 62].forEach((m, k) => assert.ok(off(at(2, (k + 0.5) / 4), m) < 60, `run step ${k}: ${at(2, (k + 0.5) / 4)} vs ${m}`));
  assert.strictEqual(got[3].c, null, 'the held note is a plain bar');
  assert.ok(off(got[3].p, 62) < 25);
  assert.ok(got[4].c && at(4, 0.05) - at(4, 0.95) > 2, 'the fall goes down');
  // auto-tune gets the run as its own notes, in order
  const steps = tuneNotes([{ ...notes[2], p: got[2].p, c: got[2].c }]).map((n) => Math.round(n.p));
  assert.deepStrictEqual(steps, [64, 62, 60, 62], `auto-tune steps: ${steps}`);
});

test('backing vocals and echo: the lead line is kept', () => {
  const notes = tune(MELODY);
  const x = new Float32Array(SR * 16);
  sing(x, notes);
  // a harmony a third or so above, about half as loud, on every other line
  sing(x, notes.filter((_, i) => Math.floor(i / 6) % 2 === 0).map((s) => ({ ...s, m: s.m + 4 })), { gain: 0.13, vowel: [500, 1500, 2500] });
  // "oohs" behind the gaps between lines, and a low octave double
  sing(x, [{ t: 3.2, d: 1.2, m: 72 }, { t: 7.1, d: 1.2, m: 76 }], { gain: 0.1 });
  sing(x, notes.map((s) => ({ ...s, m: s.m - 12 })), { gain: 0.07 });
  // the echo: the whole voice again 330 ms later at about a third of the level, and again after that
  const dry = new Float32Array(SR * 16);
  sing(dry, notes);
  for (let i = 0; i < x.length; i++) {
    const a = i - Math.round(0.33 * SR);
    const b = i - Math.round(0.66 * SR);
    x[i] += (a >= 0 ? dry[a] * 0.35 : 0) + (b >= 0 ? dry[b] * 0.14 : 0);
  }
  noise(x, 0.004);
  const got = melodyFromAudio(reader(x), SR, notes);
  let wrong = 0;
  let blank = 0;
  notes.forEach((s, i) => {
    if (got[i].p === null) blank++;
    else if (off(got[i].p, s.m) > 60) wrong++;
  });
  assert.strictEqual(wrong, 0, `${wrong} notes read as someone else's`);
  assert.ok(blank <= 2, `${blank} of ${notes.length} left blank`);
});

test('two singers as loud as each other, a whisper, and a gap: left blank rather than guessed', () => {
  const notes = tune([60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65], { per: 4 });
  const x = new Float32Array(SR * 10);
  sing(x, notes.slice(0, 4)); // line 1: the lead alone
  sing(x, notes.slice(4, 8)); // line 2: a duet, the second voice a fourth up and as loud
  sing(x, notes.slice(4, 8).map((s) => ({ ...s, m: s.m + 5 })), { vowel: [450, 1700, 2700] });
  // line 3: one whispered syllable (breath only), one not sung at all, two sung
  const k = Math.round(notes[8].t * SR);
  for (let i = 0; i < 0.4 * SR; i++) x[k + i] += rnd() * 0.08;
  sing(x, notes.slice(10, 12));
  noise(x, 0.003);
  const got = melodyFromAudio(reader(x), SR, notes);
  for (let i = 0; i < 4; i++) assert.ok(got[i].p !== null && off(got[i].p, notes[i].m) < 25, `lead alone ${i}: ${got[i].p}`);
  for (let i = 4; i < 8; i++) {
    // blank, or (when one of the two happened to come out on top) one of the two real notes; never something else
    assert.ok(got[i].p === null || off(got[i].p, notes[i].m) < 40 || off(got[i].p, notes[i].m + 5) < 40, `duet ${i}: ${got[i].p}`);
  }
  assert.ok(got.slice(4, 8).filter((g) => g.p === null).length >= 3, `duet read as ${got.slice(4, 8).map((g) => g.p)}`);
  assert.strictEqual(got[8].p, null, 'the whisper');
  assert.strictEqual(got[9].p, null, 'the gap');
  assert.ok(off(got[10].p, notes[10].m) < 25 && off(got[11].p, notes[11].m) < 25);
});

test('a chart that is real in some lines and made up in others: checked note by note', () => {
  // four lines of six: lines 0 and 2 charted right (an octave down, as charts often are), lines 1 and 3
  // made up (one note). The singer skips one word in line 0 and one in line 1.
  const notes = tune(MELODY);
  const sung = notes.map((s, i) => (i === 3 || i === 8 ? { ...s, m: null } : s));
  const x = new Float32Array(SR * 16);
  sing(x, sung);
  noise(x, 0.003);
  const real = (i) => Math.floor(i / 6) % 2 === 0;
  const { syl, lines } = buildSing(lyricsOf(notes, (i) => (real(i) ? MELODY[i] - 12 : 61)));
  const read = melodyFromAudio(reader(x), SR, syl);
  const { syl: out, check } = checkNotes(syl, read, lines);
  out.forEach((s, i) => {
    if (i === 3) {
      // not heard, but its line agrees with the singer: the chart's note is kept, moved to the singer's octave
      assert.strictEqual(s.src, 'chart');
      assert.strictEqual(s.p, MELODY[3]);
    } else if (i === 8) {
      // not heard, in a made-up line: blank, not the made-up note
      assert.strictEqual(s.p, null);
      assert.strictEqual(s.src, null);
    } else {
      assert.strictEqual(s.src, 'singer', `syllable ${i}`);
      assert.ok(off(s.p, MELODY[i]) < 25 && Math.abs(s.p - MELODY[i]) < 1, `syllable ${i}: ${s.p} vs ${MELODY[i]}`);
    }
  });
  assert.strictEqual(check.notes, 24);
  assert.strictEqual(check.heard, 22);
  assert.strictEqual(check.kept, 1);
  assert.strictEqual(check.blank, 1);
  assert.ok(check.fixed >= 9 && check.fixed <= 11, `made-up notes put right: ${check.fixed}`);
  assert.ok(check.agreed >= 11, `chart notes that were right: ${check.agreed}`);
  assert.ok(Math.abs(check.share - 22 / 24) < 0.001);
  // "The singer's notes only": no chart note survives
  const rec = checkNotes(syl, read, lines, 'recording');
  assert.strictEqual(rec.syl[3].p, null);
  assert.strictEqual(rec.check.kept, 0);
});

test('scoring follows the line: copying the slide counts, holding one note through it does not', () => {
  const notes = [{ t: 1, d: 1.2, m: 60, to: 65 }];
  const x = new Float32Array(SR * 3);
  sing(x, notes, { vib: 0.1 });
  const { syl, lines } = buildSing([{ t: 1, d: 1.2, w: 'whoa+', p: 254 }]);
  const { syl: out } = checkNotes(syl, melodyFromAudio(reader(x), SR, syl), lines);
  assert.ok(out[0].c, 'the slide was read');
  const run = (voice, late = 0) => {
    const j = new SingJudge(out, lines, 'medium');
    for (let t = 0; t < 3; t += 0.016) {
      const u = (t - late - 1) / 1.2;
      j.push(t, u >= 0 && u <= 1 ? { voiced: true, midi: voice(u) } : { voiced: false, midi: null });
      j.tick(t);
    }
    return j.result[0];
  };
  const slide = (u) => 60 + 5 * Math.min(1, Math.max(0, (u - 0.15) / 0.6));
  assert.strictEqual(run(slide), 'hit');
  assert.strictEqual(run((u) => slide(u) - 12), 'hit', 'an octave down');
  assert.strictEqual(run(slide, 0.07), 'hit', 'a little late');
  assert.strictEqual(run(() => 60), 'miss', 'stayed on the first note');
  assert.strictEqual(run(() => 65), 'miss', 'went straight to the last note');
});

test('real-style: a whole song (verse, chorus up high, runs, backing voices, echo, hiss) in a few seconds', () => {
  // 3 minutes, 280 syllables: verses low and chorus a sixth up, some words held with slides or runs
  const ps = [];
  for (let i = 0; i < 280; i++) ps.push((Math.floor(i / 28) % 2 ? 66 : 57) + [0, 2, 4, 5, 7, 5, 4, 2, 0, 4, 7, 9, 7, 4][i % 14]);
  const notes = tune(ps, { t0: 2, d: 0.38, gap: 0.07, per: 7, rest: 1.4 });
  notes.forEach((s, i) => {
    if (i % 7 === 6) (s.d = 0.9), i % 3 ? (s.to = s.m - 2) : (s.run = [s.m, s.m + 2, s.m]);
    if (i % 5 === 0) s.scoop = 1.5;
  });
  const dur = Math.ceil(notes[notes.length - 1].t + 3);
  const x = new Float32Array(SR * dur);
  sing(x, notes);
  sing(x, notes.filter((_, i) => Math.floor(i / 28) % 2).map((s) => ({ ...s, m: s.m - 3 })), { gain: 0.11, vowel: [500, 1500, 2500] });
  const dry = x.slice();
  for (let i = Math.round(0.28 * SR); i < x.length; i++) x[i] += dry[i - Math.round(0.28 * SR)] * 0.3;
  noise(x, 0.006);
  const t0 = Date.now();
  const got = melodyFromAudio(reader(x), SR, notes);
  const took = Date.now() - t0;
  let wrong = 0;
  let blank = 0;
  notes.forEach((s, i) => {
    if (got[i].p === null) return blank++;
    const want = s.run ? [s.m, s.m + 2] : s.to !== undefined ? [s.m, s.to, (s.m + s.to) / 2] : [s.m];
    if (!want.some((m) => off(got[i].p, m) < 70)) wrong++;
  });
  console.log(`      ${notes.length} syllables over ${dur} s read in ${took} ms: ${wrong} wrong, ${blank} blank`);
  assert.ok(wrong <= 2, `${wrong} wrong`);
  assert.ok(blank <= notes.length * 0.05, `${blank} blank`);
  assert.ok(took < 30000, `too slow: ${took} ms`);
});

console.log(`melody: ${passed} passed`);
