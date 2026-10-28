import assert from 'node:assert/strict';
import { visualTime, sustainIndex, firstSustain, noteEnd } from '../src/renderer/js/highway-timing.js';
assert.equal(visualTime(10, 60, 1), 9.94);
assert.equal(visualTime(10, 60, .5), 9.97);
assert.equal(visualTime(10, -60, .5), 10.03);
// Frame rate/stalls cannot change the mapping to chart time.
for (const t of [0, .016, .033, .9, 8, 1, 1.01]) assert.equal(visualTime(t), t);
const targets = [
 {t:0,sus:8,notes:[{sus:8}]}, {t:1,sus:0,notes:[{}]},
 {t:3,sus:0,notes:[{sus:9},{sus:1}]}, {t:9,sus:0,notes:[{}]},
];
const ends = sustainIndex(targets);
assert.deepEqual(ends,[8,8,12,12]);
assert.equal(firstSustain(ends,6),0);
assert.equal(firstSustain(ends,8),2);
assert.equal(firstSustain(ends,12),4);
assert.equal(noteEnd(targets[2].notes[1],targets[2]),4);
assert.equal(noteEnd({sus:0},targets[0]),0);
assert.equal(firstSustain([],5),0);
console.log('Highway timing: clock, speed calibration, overlapping sustains and per-string ends passed.');
