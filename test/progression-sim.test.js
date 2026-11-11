'use strict';
/**
 * 4.5: a simulated year through the real XP rules. If a balancing change breaks the
 * "about a year for a regular player" promise, this fails.  node test/progression-sim.test.js
 */
const assert = require('assert');
const { balanceReport } = require('../src/main/services/progression-sim');

const r = balanceReport({ days: 365 });
const row = (id) => r.rows.find((x) => x.id === id);
const at = (id, d) => row(id).levels.find((x) => x.day === d).level;
for (const x of r.rows) console.log(`${x.name.padEnd(48)} ${x.levels.map((l) => `${l.day}d:${l.level}`).join('  ')}  100 on day ${x.day100 || '—'}`);
assert.ok(row('regular').day100 >= 320 && row('regular').day100 <= 400, `regular: level 100 on day ${row('regular').day100} (target ~365)`);
assert.ok(at('regular', 7) >= 5 && at('regular', 7) <= 14, 'early levels come quickly');
assert.ok(at('regular', 182) >= 55 && at('regular', 182) <= 80, 'midgame is substantial');
assert.ok(row('heavy').day100 && row('heavy').day100 < row('regular').day100, 'more playing gets there sooner');
assert.ok(row('heavy').day100 >= 120, 'but not in a few weeks');
assert.ok(!row('casual').day100 && at('casual', 365) >= 30, 'a casual player still makes real progress');
console.log('progression balance: ok');
