/* Piano: writing a piano part from a song, and scoring a keyboard. `node test/keys.test.mjs` */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrange, makeGrid, bestChord, parseChordName, chordName, findKey, spell, keyAccidentals, KeysJudge, TPB, partEvents, concertMidi } from '../src/renderer/js/piano-arrange.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// a made-up song at 120 a minute, 4/4: bar 1 an intro riff, bars 2–3 sung over C and Am, bar 4 an F chord
const beats = [];
for (let i = 0; i <= 20; i++) beats.push({ t: 1 + i * 0.5, m: i % 4 === 0 ? i / 4 : -1 });
const at = (bar, beat) => 1 + (bar * 4 + beat) * 0.5; // song time of a beat
const E = [40, 45, 50, 55, 59, 64];
const fret = (s, m) => m - E[s]; // the fret that plays midi m on string s (standard tuning)
const lead = {
  type: 'lead', tuning: [0, 0, 0, 0, 0, 0], capo: 0, beats, sections: [{ name: 'intro', start: 1 }, { name: 'verse', start: at(1, 0) }],
  // the intro riff: E3 G3 A3 B3 on eighths, then quiet
  notes: [52, 55, 57, 59].map((m, i) => ({ t: at(0, i * 0.5), s: 2, f: fret(2, m), sus: 0 })),
  chordEvents: [],
  chords: [],
};
const rhythm = {
  type: 'rhythm', tuning: [0, 0, 0, 0, 0, 0], capo: 0, beats,
  notes: [],
  // C major (C3 E3 G3 C4), A minor, F major, strummed on each half bar
  chordEvents: [
    ...[0, 2].map((b) => ({ t: at(1, b), sus: 0.9, chord: 0, strings: [{ s: 1, f: 3 }, { s: 2, f: 2 }, { s: 3, f: 0 }, { s: 4, f: 1 }] })),
    ...[0, 2].map((b) => ({ t: at(2, b), sus: 0.9, chord: 1, strings: [{ s: 1, f: 0 }, { s: 2, f: 2 }, { s: 3, f: 2 }, { s: 4, f: 1 }] })),
    ...[0, 2].map((b) => ({ t: at(3, b), sus: 0.9, chord: 2, strings: [{ s: 0, f: 1 }, { s: 1, f: 3 }, { s: 2, f: 3 }, { s: 3, f: 2 }, { s: 4, f: 1 }, { s: 5, f: 1 }] })),
  ],
  chords: [{ name: '' }, { name: '' }, { name: '' }],
};
const bass = {
  type: 'bass', tuning: [0, 0, 0, 0], capo: 0, beats,
  // C2 on every beat of bar 2, A1 on 1 and 3 of bar 3, F1 on beat 1 of bar 4
  notes: [...[0, 1, 2, 3].map((b) => ({ t: at(1, b), s: 1, f: 3, sus: 0 })), ...[0, 2].map((b) => ({ t: at(2, b), s: 1, f: 0, sus: 0.8 })), { t: at(3, 0), s: 0, f: 1, sus: 1.8 }],
  chordEvents: [],
};
// the singer: C4 D4 E4 G4 in bar 2 (quarters), A3 C4 over bar 3 (halves), a little late, as singers are
const tune = [[1, 0, 60, 'Hel-'], [1, 1, 62, 'lo'], [1, 2, 64, 'the'], [1, 3, 67, 'sun+'], [2, 0, 57, 'shi-'], [2, 2, 60, 'ning+']];
const lyrics = tune.map(([bar, beat, p, w]) => ({ t: at(bar, beat) + 0.02, d: bar === 2 ? 0.9 : 0.42, w, p }));

const song = arrange({ lead, rhythm, bass, lyrics, beats });

test('the grid follows the song’s beats and bars', () => {
  const g = makeGrid(beats);
  assert.strictEqual(g.stepOf(1), 0);
  assert.strictEqual(g.stepOf(1.25), TPB / 2);
  assert.strictEqual(g.timeOf(TPB * 3), 2.5);
  assert.strictEqual(g.bars.length, 5);
  assert.deepStrictEqual(g.bars.slice(0, 2).map((b) => [b.k0, b.k1, b.beats]), [[0, 16, 4], [16, 32, 4]]);
  assert.strictEqual(g.barAt(17), 1);
});

test('a guitar note sounds the right piano key (tuning, capo)', () => {
  assert.strictEqual(concertMidi({ type: 'lead', tuning: [0, 0, 0, 0, 0, 0] }, 5, 0), 64);
  assert.strictEqual(concertMidi({ type: 'lead', tuning: [-2, 0, 0, 0, 0, 0] }, 0, 0), 38); // drop D
  assert.strictEqual(concertMidi({ type: 'lead', tuning: [0, 0, 0, 0, 0, 0], capo: 2 }, 1, 0), 47);
  assert.strictEqual(concertMidi({ type: 'bass', tuning: [0, 0, 0, 0] }, 0, 5), 33);
  // muted strums are left out
  assert.strictEqual(partEvents({ type: 'lead', tuning: [], notes: [{ t: 0, s: 0, f: 3, mute: true }], chordEvents: [] }).length, 0);
});

test('chords are named as on a lead sheet', () => {
  const w = (pcs, bassPc = null) => {
    const a = new Array(12).fill(0);
    pcs.forEach((p) => (a[p] += 1));
    return bestChord(a, bassPc);
  };
  assert.strictEqual(chordName(w([0, 4, 7, 0])), 'C');
  assert.strictEqual(chordName(w([9, 0, 4, 9])), 'Am');
  assert.strictEqual(chordName(w([4, 11, 4])), 'E5');
  assert.strictEqual(chordName(w([7, 11, 2, 5], 7)), 'G7');
  assert.strictEqual(chordName(w([10, 2, 5], 10), -2), 'B♭');
  assert.deepStrictEqual(parseChordName('F#m7').root, 6);
  assert.strictEqual(parseChordName('F#m7').q, 'm7');
  assert.strictEqual(parseChordName('Bb').root, 10);
  assert.strictEqual(parseChordName('E5').q, '5');
  assert.strictEqual(parseChordName('Xyz'), null);
});

test('the key comes from the song', () => {
  const major = [6, 0, 3, 0, 4, 3, 0, 5, 0, 3, 0, 2]; // C major scale, weighted
  assert.strictEqual(findKey(major).name, 'C major');
  const minor = [3, 0, 2, 0, 3, 0, 0, 2, 0, 6, 0, 2]; // A minor
  assert.strictEqual(findKey(minor).name, 'A minor');
  assert.strictEqual(findKey(minor).fifths, 0);
  assert.strictEqual(song.key.name, 'C major');
});

test('the band’s chords: C, Am, F over bars 2, 3, 4', () => {
  const named = song.chords.filter((c) => c.len >= TPB).map((c) => [c.name, c.k]);
  assert.deepStrictEqual(named.filter(([, k]) => k >= 16), [['C', 16], ['Am', 32], ['F', 48]]);
});

test('Easy: the singer’s own notes, on the beat, then the riff where nobody sings', () => {
  const R = song.levels.easy;
  assert.ok(R.every((n) => n.hand === 'R'));
  const sung = R.filter((n) => n.from === 'voice');
  // the singer's notes, exactly, an octave up (the whole song by the same octave, so the tune keeps its shape),
  // each on its beat although sung a little late
  assert.deepStrictEqual(sung.map((n) => [n.midi, n.k, n.len]), [[72, 16, 4], [74, 20, 4], [76, 24, 4], [79, 28, 4], [69, 32, 8], [72, 40, 8]]);
  assert.deepStrictEqual(sung.map((n) => n.word), ['Hel-', 'lo', 'the', 'sun', 'shi-', 'ning']);
  // the intro (no singing) is the lead guitar's riff, an octave above where guitar sounds
  const riff = R.filter((n) => n.from === 'guitar');
  assert.deepStrictEqual(riff.map((n) => [n.midi, n.k, n.len]), [[64, 0, 2], [67, 2, 2], [69, 4, 2], [71, 6, 4]]);
});

test('Medium: the chord’s root in the left hand, in the bass’s rhythm', () => {
  const L = song.levels.medium.filter((n) => n.hand === 'L');
  // C on beats 1 and 3 of bar 2 (held through the repeats), A on 1 and 3 of bar 3, F for bar 4
  assert.deepStrictEqual(L.map((n) => [n.midi % 12, n.k]), [[0, 16], [0, 24], [9, 32], [9, 40], [5, 48]]);
  assert.ok(L.every((n) => n.midi >= 28 && n.midi <= 55));
});

test('Hard: the real bass line, and the chord under the tune', () => {
  const H = song.levels.hard;
  const L = H.filter((n) => n.hand === 'L');
  // (an octave above the bass guitar, as piano music writes a bass line)
  assert.deepStrictEqual(L.map((n) => [n.midi, n.k]), [[48, 16], [48, 20], [48, 24], [48, 28], [45, 32], [45, 40], [41, 48]]);
  // under the first sung note (C5): chord notes from C major, close under it
  const under = H.filter((n) => n.hand === 'R' && n.role === 'chord' && n.k === 16).map((n) => n.midi).sort((a, b) => a - b);
  assert.deepStrictEqual(under, [64, 67]);
  // bar 4: no singing and no riff, so the F chord, in close position around middle C
  const f = H.filter((n) => n.hand === 'R' && n.k === 48).map((n) => n.midi);
  assert.deepStrictEqual(f, [65, 69, 72]);
  // every note has its song time
  assert.ok(H.every((n) => Number.isFinite(n.t) && n.d > 0));
});

test('notes are spelled in the key', () => {
  assert.deepStrictEqual([spell(66, 1).letter, spell(66, 1).acc], [3, 1]); // F♯ in G major
  assert.deepStrictEqual([spell(70, -1).letter, spell(70, -1).acc], [6, -1]); // B♭ in F major
  assert.strictEqual(spell(60, 0).step, 28); // middle C
  assert.deepStrictEqual(keyAccidentals(2), [1, 0, 0, 1, 0, 0, 0]); // D major: F♯ C♯
  assert.deepStrictEqual(keyAccidentals(-1), [0, 0, 0, 0, 0, 0, -1]); // F major: B♭
});

test('a real song: power-chord riff named chord by chord, everything playable', () => {
  const d = JSON.parse(fs.readFileSync(path.join(here, 'hwlook', 'sugar.json'), 'utf8'));
  const a = arrange({ lead: d.lead, bass: d.bass, lyrics: [], beats: d.lead.beats, length: d.lead.length });
  const names = new Set(a.chords.map((c) => c.name));
  for (const n of ['C5', 'G5', 'F♯5', 'F5']) assert.ok(names.has(n), `missing ${n}`);
  for (const L of Object.values(a.levels)) {
    assert.ok(L.every((n) => n.midi >= 21 && n.midi <= 108), 'on an 88-key piano');
    assert.ok(L.filter((n) => n.hand === 'R').every((n) => n.midi >= 55), 'the right hand stays up');
    assert.ok(L.filter((n) => n.hand === 'L').every((n) => n.midi <= 55), 'the left hand stays down');
    assert.ok(L.every((n) => Number.isInteger(n.k) && Number.isInteger(n.len) && n.len >= 1), 'on the grid');
  }
});

test('scoring a keyboard: on time hits, late misses, wrong keys noted, held notes fill', () => {
  const notes = [{ t: 1, d: 0.5, midi: 60 }, { t: 1, d: 0.5, midi: 64 }, { t: 2, d: 1, midi: 67 }, { t: 3, d: 0.25, midi: 65 }];
  const j = new KeysJudge(notes);
  j.press(1.03, 60);
  j.press(0.95, 64);
  j.press(1.5, 61); // a wrong key
  j.tick(1.6);
  j.press(2.3, 67); // too late for G
  j.tick(3.5);
  assert.deepStrictEqual(j.result, ['hit', 'hit', 'miss', 'miss']);
  assert.strictEqual(j.wrong.length, 2); // the wrong key, and the late G
  assert.strictEqual(j.accuracy, 0.5);
  assert.strictEqual(j.bestStreak, 2);
  // holding: C held to 1.4 (released), E held through to the note's end
  j.reset(0);
  j.press(1, 60);
  j.press(1, 64);
  j.tick(1.4);
  j.release(1.4, 60);
  j.tick(1.7);
  assert.ok(Math.abs(j.heldTo[0] - 1.4) < 1e-6);
  assert.ok(Math.abs(j.heldTo[1] - 1.5) < 1e-6);
  // jumping back forgets from there
  j.rewind(0.5);
  assert.deepStrictEqual(j.result, [null, null, null, null]);
  assert.strictEqual(j.judged, 0);
});

console.log(`keys: ${passed} passed`);
