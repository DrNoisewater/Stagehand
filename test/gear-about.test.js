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

// 4.22: every Lab pedal says how to hear it working, every knob says what it does, and every
// footswitch and lever has its own words (not just "hold to use"), as the sheet under the controls shows them
const rigui = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'rigui.js'), 'utf8');
const table = (name) => {
  const i = rigui.indexOf(`const ${name} = {`);
  return Function(`return (${rigui.slice(rigui.indexOf('{', i), rigui.indexOf('\n};', i) + 2)})`)();
};
const HOLD = table('LAB_HOLD_HELP'), MOMENT = table('LAB_MOMENT_HELP');
let lab = 0, sw = 0;
for (const [k, g] of Object.entries(gear)) {
  if (g.c !== 'The Lab') continue;
  const a = about[k] || {};
  assert.ok(typeof a.try === 'string' && a.try.length >= 40 && a.try.length <= 320, `${k}: says how to hear it working (${(a.try || '').length} characters)`);
  for (const [name, , , , , o] of g.k || []) assert.ok(o && typeof o.help === 'string' && o.help.length >= 12, `${k}: ${name} says what it does`);
  const ms = g.m || [];
  for (const [name, type] of ms) {
    const own = MOMENT[`${k}|${name.toLowerCase()}`];
    // the old one-line help per pedal only stands for a pedal with a single footswitch
    assert.ok(own || (HOLD[k] && ms.length === 1) || (HOLD[k] && type !== 'lever' && ms.filter((m) => m[1] !== 'lever').length === 1), `${k}: the ${name} ${type} has its own words`);
    sw++;
  }
  // a pedal that does nothing until a footswitch is used says so first
  const waits = /^Nothing happens until|^On its own you hear nothing different/.test(a.try);
  if (['Pedal_Fossil', 'Pedal_Apoptosis', 'Pedal_Claude', 'Pedal_DejaVu', 'Pedal_Kukulkan', 'Pedal_Maui', 'Pedal_Mimic', 'Pedal_Nataraja', 'Pedal_Seance', 'Pedal_Anansi', 'Pedal_Boing'].includes(k)) assert.ok(waits, `${k}: its tip says it waits for a footswitch`);
  lab++;
}
for (const k of Object.keys(about)) assert.ok(!about[k].try || gear[k], `${k}: a tip for a real piece`);
console.log(`gear-about: ${lab} Lab pedals with a way to hear them working, ${sw} footswitches and levers explained`);
