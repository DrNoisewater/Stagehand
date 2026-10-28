// Linked notes (linkNext): one pick, one gem, one score.
import { targetsFromTab, Judge } from '../src/renderer/js/detect.js';
const tab = { strings: 6, tuning: [0, 0, 0, 0, 0, 0], capo: 0, notes: [
  { t: 1, s: 5, f: 10, sus: 0.285, linkNext: true },
  { t: 1.285, s: 5, f: 10, sus: 0.17, linked: true, slideUnpitchTo: 5 },
  { t: 2, s: 4, f: 7, sus: 0 },
], chordEvents: [] };
const T = targetsFromTab(tab);
let bad = 0;
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) bad++; };
ok(T[1].linked && T[1].parent === 0 && !T[0].linked && !T[2].linked, 'the held-on note is linked to the one before');
const j = new Judge(T);
j.tick(3);
ok(j.judged === 2, `only picked notes are scored (${j.judged} of 3 targets)`);
ok(j.state.get(1) && j.state.get(1).result === j.state.get(0).result, 'the held-on note shows its parent’s result');
ok(j.events.every((e) => e.id !== 1), 'no hit or miss effect for it');
j.rewind(0);
ok(j.judged === 0, 'rewinding counts back to zero');
if (bad) process.exit(1);
console.log('all ok');
