// How hard a song is to sing (the Karaoke page's mark), from its words and notes.
// 4.19: three levels, counted while singing, with breath, and made-up notes left out.
const test = require('node:test');
const assert = require('node:assert');
const { vocalDifficulty } = require('../src/main/core/vocaldiff');

// lines of `per` syllables `gap` apart, a rest of `rest` seconds between lines
const song = ({ lines = 24, per = 8, gap = 0.5, rest = 1.2, note = () => 60, hold = 0.8 }) => {
  const out = [];
  let t = 10;
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < per; i++, t += gap) out.push({ t, d: gap * hold, w: 'la', p: note(out.length, i, l) });
    t += rest;
  }
  return out;
};
const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];

test('too few words to judge: nothing', () => {
  assert.strictEqual(vocalDifficulty([{ t: 0, d: 1, w: 'hi', p: 60 }]), null);
  assert.strictEqual(vocalDifficulty(null), null);
});
test('a slow, narrow tune in short lines is easy', () => {
  const d = vocalDifficulty(song({ per: 6, gap: 0.7, note: (n, i) => 60 + scale[i % 4] }));
  assert.strictEqual(d.name, 'Easy', JSON.stringify(d));
  assert.ok(!d.guess);
});
test('an ordinary pop song is medium', () => {
  const d = vocalDifficulty(song({ per: 9, gap: 0.42, note: (n, i, l) => 57 + scale[(i + l * 2) % 8] }));
  assert.strictEqual(d.name, 'Medium', JSON.stringify(d));
});
test('fast, wide and jumpy is hard', () => {
  const d = vocalDifficulty(song({ lines: 40, per: 14, gap: 0.2, rest: 0.8, note: (n) => 52 + ((n * 7) % 20) }));
  assert.strictEqual(d.name, 'Hard', JSON.stringify(d));
  assert.ok(d.why.includes('fast words') && d.why.includes('a wide tune, low to high'), d.why.join());
});
test('one hard side is enough: very fast words on hardly any tune', () => {
  const d = vocalDifficulty(song({ lines: 40, per: 20, gap: 0.16, rest: 0.6, note: (n, i) => 60 + (i % 3) }));
  assert.strictEqual(d.name, 'Hard', JSON.stringify(d));
});
test('one hard side is enough: a slow song that goes from very low to very high', () => {
  const d = vocalDifficulty(song({ per: 6, gap: 0.8, note: (n, i, l) => 50 + ((l % 4) * 6 + i) }));
  assert.strictEqual(d.name, 'Hard', JSON.stringify(d));
});
test('a long solo in the middle does not make fast singing look slow', () => {
  const fast = song({ lines: 20, per: 14, gap: 0.22, note: (n) => 60 + scale[n % 6] });
  const withSolo = fast.map((v, i) => (i >= fast.length / 2 ? { ...v, t: v.t + 90 } : v));
  const a = vocalDifficulty(fast);
  const b = vocalDifficulty(withSolo);
  assert.ok(Math.abs(a.rate - b.rate) < 12, `${a.rate} vs ${b.rate}`);
  assert.strictEqual(a.level, b.level);
});
test('long lines without a breath count', () => {
  const short = vocalDifficulty(song({ per: 8, gap: 0.45, note: (n, i) => 60 + scale[i % 5] }));
  const long = vocalDifficulty(song({ lines: 8, per: 32, gap: 0.45, hold: 1, note: (n, i) => 60 + scale[i % 5] }));
  assert.ok(long.score > short.score + 0.1, `${long.score} vs ${short.score}`);
  assert.ok(long.why.includes('long lines without a breath'), long.why.join());
});
test('made-up notes (one note all through) are left out, and it says so', () => {
  const flat = vocalDifficulty(song({ note: () => 61 }));
  const none = vocalDifficulty(song({ note: () => 254 }));
  assert.ok(flat.guess && none.guess);
  assert.strictEqual(flat.score, none.score);
  assert.strictEqual(flat.range, 0);
});
test('the real notes change the mark of a chart with made-up ones', () => {
  const chart = song({ per: 7, gap: 0.6, note: () => 61 });
  const heard = chart.map((v, i) => ({ ...v, p: 50 + ((Math.floor(i / 7) % 4) * 6 + (i % 7)) }));
  assert.ok(vocalDifficulty(heard).score > vocalDifficulty(chart).score + 0.15);
  assert.ok(!vocalDifficulty(heard).guess);
});
test('blank syllables are not counted', () => {
  const c = song({}).concat(song({}).map((v) => ({ ...v, w: ' ' })));
  assert.strictEqual(vocalDifficulty(c).syllables, song({}).length);
});
