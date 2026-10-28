import assert from 'node:assert/strict';
import { approachDepth, chordSpan, isChordRepeat } from '../src/renderer/js/highway-layout.js';
// Travel has no camera-distance input, meets z=0 exactly, and follows chart speed.
assert.equal(approachDepth(12,12),0);
assert.equal(approachDepth(12,11),16);
assert.equal(approachDepth(12,11,.8),12.8);
assert.ok(approachDepth(12,11.5) > approachDepth(12,12));
const anchor={fret:7,width:4};
const notes=[{s:3,f:7},{s:5,f:9}];
assert.deepEqual(chordSpan(notes,anchor),[6,10]);
assert.deepEqual(chordSpan([{s:1,f:2},{s:2,f:4}],anchor),[1,4]);
assert.deepEqual(chordSpan([{s:0,f:0}],anchor),[6,10]);
const a={t:1,notes},b={t:1.3,notes:[...notes].reverse()};
assert.ok(isChordRepeat(a,b));
assert.ok(!isChordRepeat(a,{t:1.3,notes:[{s:3,f:7},{s:5,f:10}]},true));
assert.ok(!isChordRepeat(a,{...b,t:3}));
assert.ok(!isChordRepeat(a,{...b,t:1}));
console.log('PASS fixed travel, strike time, chord lane bounds, reordered shapes, changed notes and gaps');
