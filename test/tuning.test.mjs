// Smart tuning: what a song needs from the tuning your instrument is in.
const m = {};
globalThis.localStorage = { getItem: (k) => m[k] ?? null, setItem: (k, v) => (m[k] = v) };
const t = await import('../src/renderer/js/tuning.js');
let bad = 0;
const ok = (c, msg) => { console.log(c ? 'ok  ' : 'FAIL', msg); if (!c) bad++; };
const S = (k) => Array(6).fill(k);
ok(t.tuningName(S(0)) === 'E Standard' && t.tuningName([-2, 0, 0, 0, 0, 0]) === 'Drop D' && t.tuningName(S(-3)) === 'C♯ Standard' && t.tuningName([-4, -2, -2, -2, -2, -2]) === 'Drop C', 'names tunings');
ok(t.tuningPlan(S(0)).same, 'E Standard song on an E Standard guitar: nothing to do');
ok(t.tuningPlan(S(-2)).drop === 2, 'D Standard song: the Drop, −2');
const r = t.tuningPlan([-2, 0, 0, 0, 0, 0]).retune;
ok(r && r.length === 1 && r[0].from === 'E' && r[0].to === 'D', 'Drop D song: retune the low string E → D');
t.setMyTuning('guitar', [-2, 0, 0, 0, 0, 0]);
ok(t.tuningPlan([-4, -2, -2, -2, -2, -2]).drop === 2, 'in Drop D, a Drop C song is the Drop −2');
ok(t.tuningPlan([-2, 0, 0, 0, 0, 0]).same, 'and a Drop D song just plays');
ok(t.tuningPlan(S(0)).retune[0].up, 'back to E Standard: tune the low string up');
ok(t.tuningPlan([-2, -2, -2, -2], 'bass').drop === 2, 'bass is remembered separately');
if (bad) process.exit(1);
console.log('all ok');
