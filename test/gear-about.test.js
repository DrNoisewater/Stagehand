/** 4.12: every piece on the Gear page has a spec sheet: what it's modelled on (or nothing) and plain words. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const D = path.join(__dirname, '..', 'src', 'renderer', 'data');
const gear = JSON.parse(fs.readFileSync(path.join(D, 'gear2014.json'), 'utf8'));
const about = JSON.parse(fs.readFileSync(path.join(D, 'gear-about.json'), 'utf8'));
const CAB_RE = /^(.*)_(57|Condenser|Ribbon|Tube)_(Cone|Edge|OffAxis)$/; // as in gearbench.js
const keys = new Set();
for (const [k, g] of Object.entries(gear)) keys.add(g.t === 'cab' ? (CAB_RE.exec(k) || [, k])[1] : k);
let n = 0;
for (const k of keys) {
  const a = about[k];
  assert.ok(a, `${k} (${(gear[k] || {}).n || 'cabinet'}) has a spec sheet`);
  assert.strictEqual(typeof a.real, 'string', `${k}: real is a name or empty`);
  assert.ok(typeof a.about === 'string' && a.about.length >= 40 && a.about.length <= 420, `${k}: a few plain sentences (${(a.about || '').length} characters)`);
  assert.ok(!/rocksmith|stagehand/i.test(a.about + a.real), `${k}: talks about the real gear, not the app`);
  n++;
}
for (const k of Object.keys(about)) assert.ok(keys.has(k), `${k} is a piece on the Gear page`);
console.log(`gear-about: ${n} pieces described, ${[...keys].filter((k) => about[k].real).length} with the real gear named`);
