// The practice log's counting (4.19): every note judged in a session counts once,
// chords are counted even when a session has only one or two, and notes an earlier
// session already logged are left out.
import assert from 'node:assert';
import { breakdown, compact } from '../src/renderer/js/scorecard.js';

const chord = (id, t) => ({ id, t, notes: [{ s: 0, f: 3 }, { s: 1, f: 5 }] });
const single = (id, t) => ({ id, t, notes: [{ s: 2, f: 7 }] });
const targets = [single(0, 1), chord(1, 2), single(2, 3), chord(3, 4), single(4, 5), { id: 5, t: 5.5, notes: [{ s: 2, f: 7, linked: true }], linked: true, parent: 4 }, single(6, 6)];
const judge = { state: new Map() };
const set = (id, result) => judge.state.set(id, { result });
let ok = 0;
const check = (name, fn) => { fn(); ok++; console.log('  ok  ', name); };

check('only notes that were reached count, a chord counts once, a held-on note is not a note of its own', () => {
  set(0, 'hit'); set(1, 'hit'); set(2, 'miss'); set(3, 'miss'); set(4, 'hit'); judge.state.set(5, { result: 'hit', linked: true });
  const b = breakdown(null, targets, judge);
  assert.strictEqual(b.notes, 5);
  assert.strictEqual(b.hit, 3);
  const c = compact(b);
  assert.deepStrictEqual(c.kinds.chord, [1, 2]); // two chords came by, one hit: kept though fewer than three
  assert.deepStrictEqual(c.kinds.single, [2, 3]);
  assert.ok(!b.kinds.find((k) => k.kind === 'chord'), 'the score card still leaves out a kind with one or two notes');
});

check('a second session leaves out what the first one logged, and counts a note played again', () => {
  const seen = new Map(judge.state); // the first session was logged here
  set(6, 'hit'); // carried on
  judge.state.delete(1); set(1, 'hit'); // went back and played the first chord again
  const b = breakdown(null, targets, judge, { skip: (id, st) => seen.get(id) === st });
  assert.strictEqual(b.notes, 2);
  assert.strictEqual(b.hit, 2);
  assert.deepStrictEqual(compact(b).kinds, { single: [1, 1], chord: [1, 1] });
});

check('the two sessions add up to what was played, nothing twice', () => {
  const all = breakdown(null, targets, judge);
  assert.strictEqual(all.notes, 6);
});
console.log(`\nscorecard: ${ok} passed`);
