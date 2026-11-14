// Famous tones (Create a Tone): the list is made of real gear with knobs in range, the names
// are unique, search finds tones by player, song and genre, and every tone makes sound through
// the real sound engine (clean ones stay clean, heavy ones are driven).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { engine, cabIR, measure, SH_ROOT } from './tonelab.mjs';

const F = await import(pathToFileURL(path.join(SH_ROOT, 'src/renderer/js/famous-tones.js')).href);
const { cabinetFor } = await import(pathToFileURL(path.join(SH_ROOT, 'src/renderer/js/cabinets.js')).href);
const gear = JSON.parse(fs.readFileSync(path.join(SH_ROOT, 'src/renderer/data/gear2014.json'), 'utf8'));
const cabs = JSON.parse(fs.readFileSync(path.join(SH_ROOT, 'src/renderer/data/cabs/manifest.json'), 'utf8'));
let failed = 0;
const ok = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
};

ok('there are at least 40 tones, for guitar and for bass', () => {
  assert.ok(F.FAMOUS.length >= 40, `${F.FAMOUS.length} tones`);
  assert.ok(F.FAMOUS.filter((e) => e.kind === 'guitar').length >= 30);
  assert.ok(F.FAMOUS.filter((e) => e.kind === 'bass').length >= 6);
});

ok('ids and names are unique, every entry is filled in', () => {
  const ids = new Set(), names = new Set();
  for (const e of F.FAMOUS) {
    assert.ok(!ids.has(e.id), `id ${e.id} twice`);
    assert.ok(!names.has(e.name.toLowerCase()), `name ${e.name} twice`);
    ids.add(e.id);
    names.add(e.name.toLowerCase());
    for (const f of ['name', 'after', 'why', 'cab', 'cabFile']) assert.ok(typeof e[f] === 'string' && e[f].trim(), `${e.id}: ${f}`);
    assert.ok(typeof e.pickup === 'string', `${e.id}: pickup`);
    assert.ok(['guitar', 'bass'].includes(e.kind), `${e.id}: kind`);
    assert.ok(/^(In the style of|Like the )/.test(e.after), `${e.id}: "after" starts with In the style of / Like the`);
    assert.ok(e.tags.some((t) => F.GENRES.includes(t)), `${e.id}: has a genre`);
    assert.ok(e.name.length <= 28, `${e.id}: name short enough for a card`);
    assert.ok(e.why.length <= 160, `${e.id}: the "why" line is one line`);
  }
});

ok('every piece is real gear with real knobs, values in range', () => {
  for (const e of F.FAMOUS) {
    const t = F.famousTone(e);
    for (const g of t.gear) {
      const info = gear[g.key];
      assert.ok(info, `${e.id}: ${g.key} is in the gear list`);
      const wantType = { pre: 'Pedal', post: 'Pedal', amp: 'Amp', cab: 'Cabinet', rack: 'Rack' }[g.slot];
      if (info.t) assert.ok(String(info.t).toLowerCase().startsWith(wantType.toLowerCase().slice(0, 3)), `${e.id}: ${g.key} is a ${wantType} (got ${info.t})`);
      if (g.slot === 'amp' || g.slot === 'cab') {
        const bass = /^Bass_/.test(g.key);
        assert.equal(bass, e.kind === 'bass', `${e.id}: ${g.key} fits a ${e.kind}`);
      }
      for (const [n, v] of Object.entries(g.knobs)) {
        const k = info.k.find((k) => k[0].toLowerCase() === n.toLowerCase() || k[1] === n);
        assert.ok(k, `${e.id}: ${g.key} has a knob "${n}" (it has ${info.k.map((k) => k[0]).join(', ')})`);
        assert.ok(typeof v === 'number' && v >= k[2] && v <= k[3], `${e.id}: ${g.key} ${n}=${v} is within ${k[2]}..${k[3]}`);
      }
    }
    assert.equal(t.gear.filter((g) => g.slot === 'amp').length, 1, `${e.id}: one amp`);
    assert.equal(t.gear.filter((g) => g.slot === 'cab').length, 1, `${e.id}: one cabinet`);
    assert.ok(cabs[e.cabFile], `${e.id}: cabinet sound ${e.cabFile} exists`);
    assert.equal(cabinetFor(t), e.cabFile, `${e.id}: the board uses that cabinet sound`);
    assert.deepEqual(F.famousGear(e), t.gear.map((g) => g.key), `${e.id}: gear in board order`);
  }
});

ok('search finds tones by player, song, band and genre', () => {
  const has = (q, id, opt) => assert.ok(F.searchFamous(q, opt).some((e) => e.id === id), `"${q}" finds ${id}`);
  has('van halen', 'brown-sound');
  has('Hendrix', 'purple-fuzz');
  has('jamerson', 'motown-bass', { kind: 'bass' });
  has('teen spirit', 'grunge');
  has('where the streets', 'dotted-delay');
  has('the edge', 'dotted-delay');
  has('gilmour', 'gilmour-solo');
  has('Stevie Ray', 'texas-blues');
  has('metallica', 'thrash-rhythm');
  has('pantera', 'groove-metal');
  has('surf', 'surf-spring');
  assert.ok(F.searchFamous('', { genre: 'Metal' }).length >= 5, 'Metal has tones');
  assert.ok(F.searchFamous('', { genre: 'Metal' }).every((e) => e.tags.includes('Metal')), 'genre filters');
  assert.ok(F.searchFamous('', { kind: 'bass' }).every((e) => e.kind === 'bass'), 'kind filters');
  assert.equal(F.searchFamous('zzqxv').length, 0, 'nonsense finds nothing');
  assert.equal(F.searchFamous('blues')[0].tags.includes('Blues'), true, 'best match first');
  for (const g of F.GENRES) assert.ok(F.searchFamous('', { genre: g }).length >= 1, `${g} has at least one tone`);
});

// --- through the real sound engine (guitar tones: their cabinet files ship with the app)
const eng = engine();
const irs = {};
const ir = (id) => (irs[id] ??= cabIR(id));
const results = [];
for (const e of F.FAMOUS) {
  if (cabs[e.cabFile]?.downloadOnly) {
    // bass cabinet files download on first use: measure through the amp alone
    results.push([e, measure(eng, F.famousTone(e))]);
  } else results.push([e, measure(eng, F.famousTone(e), { ir: ir(e.cabFile) })]);
}
// the amp alone, compressors off: a compressor evens out soft playing just like distortion does
const ampClean = (e) => {
  const t = F.famousTone(e);
  for (const g of t.gear) if (/Compress|Comp$/.test(g.key)) g.bypass = true;
  return measure(eng, t, cabs[e.cabFile]?.downloadOnly ? {} : { ir: ir(e.cabFile) }).softDrop;
};
if (process.env.FAMOUS_SHOW) for (const [e, m] of results) console.log(e.id.padEnd(20), 'level', m.level, 'soft', m.softDrop, 'scoop', m.scoop, 'bright', m.bright);

ok('every tone makes sound, none is deafening', () => {
  for (const [e, m] of results) {
    assert.ok(Number.isFinite(m.level) && m.level > -45, `${e.id}: heard (${m.level} dB)`);
    assert.ok(m.level < 3, `${e.id}: not clipping (${m.level} dB)`);
  }
});

ok('clean tones stay clean, heavy tones are driven', () => {
  const by = Object.fromEntries(results.map(([e, m]) => [e.id, m]));
  for (const id of ['sultans-clean', 'police-chorus', 'jazz-box', 'chicken-pickin', 'disco-chank', 'reggae-skank', 'funk-wah', 'surf-spring', 'motown-bass']) {
    const e = F.FAMOUS.find((x) => x.id === id);
    assert.ok(e, `${id} is a tone`);
    const d = ampClean(e);
    assert.ok(d > 9, `${id} is clean (soft playing drops ${d} dB)`);
  }
  for (const id of ['thrash-rhythm', 'djent', 'hm2-chainsaw', 'neoclassical', 'doom-fuzz', 'groove-metal', 'grunge', 'lemmy-bass', 'cliff-fuzz'])
    assert.ok(by[id] && by[id].softDrop < 7, `${id} is driven (soft playing drops ${by[id].softDrop} dB)`);
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
