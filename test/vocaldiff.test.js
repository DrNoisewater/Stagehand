// 4.14: how hard a song is to sing (the Karaoke page's pips), from its lyric chart
const test = require('node:test');
const assert = require('node:assert');
const { vocalDifficulty } = require('../src/main/core/vocaldiff');

const chart = (n, gap, notes) => Array.from({ length: n }, (_, i) => ({ t: i * gap, d: gap * 0.8, w: 'la', p: notes(i) }));

test('too few words to judge: nothing', () => {
  assert.strictEqual(vocalDifficulty([{ t: 0, d: 1, w: 'hi', p: 60 }]), null);
  assert.strictEqual(vocalDifficulty(null), null);
});
test('slow, narrow, stepwise is easy; fast, wide and jumpy is hard', () => {
  const easy = vocalDifficulty(chart(60, 1.2, (i) => 60 + (i % 3)));
  const hard = vocalDifficulty(chart(300, 0.2, (i) => 52 + ((i * 7) % 20)));
  assert.ok(easy.level <= 2, `easy came out ${easy.level}`);
  assert.strictEqual(hard.level, 5);
  assert.strictEqual(hard.name, 'Brutal');
});
test('charts without notes (0, 254, 255) go by pace alone', () => {
  const d = vocalDifficulty(chart(100, 0.5, () => 254));
  assert.ok(d.level >= 1 && d.level <= 5);
  assert.strictEqual(d.range, 0);
});
test('blank syllables are not counted', () => {
  const c = chart(40, 0.5, () => 60).concat(chart(40, 0.5, () => 60).map((v) => ({ ...v, w: ' ' })));
  assert.strictEqual(vocalDifficulty(c).syllables, 40);
});
