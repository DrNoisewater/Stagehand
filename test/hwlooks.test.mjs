// The highway's looks and graphics settings (src/renderer/js/hwlooks.js): stored settings made safe,
// Classic left as it was, presets, Auto's order of giving things up, and the old Reflections switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const L = await import('../src/renderer/js/hwlooks.js');

test('Classic is the default and changes nothing', () => {
  const st = L.clean(null);
  assert.equal(st.theme, 'classic');
  const lk = L.resolveLook(st);
  assert.equal(lk.id, 'classic');
  assert.equal(lk.own, false, 'Classic shows the venue');
  assert.equal(lk.bright, 1);
  assert.equal(lk.fogK, 0);
  assert.equal(lk.bloom, null, 'no bloom on Classic');
  assert.equal(lk.dof || lk.grain || lk.vignette, false);
  assert.equal(lk.gem, 'solid');
  assert.equal(lk.refl, 'simple', 'Classic keeps the faint note reflections it always had');
  assert.equal(lk.res, 'auto');
});

test('Studio is first in the list and marked new; every look has a name, a wink and a palette', () => {
  assert.equal(L.THEMES[0].id, 'studio');
  assert.ok(L.THEMES[0].isNew);
  const keys = Object.keys(L.THEMES.find((t) => t.id === 'classic').pal).sort();
  for (const t of L.THEMES) {
    assert.ok(t.name && t.wink && t.about, t.id);
    assert.deepEqual(Object.keys(t.pal).sort(), keys, `${t.id} palette`);
    for (const k of Object.keys(L.THEME_SETTINGS)) assert.ok(k in t.def, `${t.id} ${k}`);
  }
});

test('stored settings are made safe', () => {
  const st = L.clean({ theme: 'nope', per: { studio: { bright: 9, glow: 'x', refl: 'mirror?', gem: 'glass', junk: 1 }, ghost: { bright: 1 } }, gfx: { preset: 'mega', aa: 'smaa', res: 1.5, fpsCap: 45, dof: 'yes', grain: true } });
  assert.equal(st.theme, 'classic');
  assert.deepEqual(st.per, { studio: { bright: L.THEME_SETTINGS.bright.max, gem: 'glass' } });
  assert.equal(st.gfx.preset, 'auto');
  assert.equal(st.gfx.aa, 'msaa4');
  assert.equal(st.gfx.res, 1.5);
  assert.equal(st.gfx.fpsCap, 0);
  assert.equal(st.gfx.dof, false);
  assert.equal(st.gfx.grain, true);
});

test('note finishes: each look has its own, and the old Matte reads as Satin', () => {
  const by = Object.fromEntries(L.THEMES.map((t) => [t.id, t.def.gem]));
  assert.deepEqual(by, { studio: 'satin', classic: 'solid', synthwave: 'neon', arena: 'solid', ember: 'satin', blueprint: 'flat', roadcase: 'paint', chrome: 'glass', neon: 'neon', midnight: 'satin', clear: 'flat' });
  assert.equal(L.clean({ per: { studio: { gem: 'matte' } } }).per.studio.gem, 'satin');
});

test('each look keeps its own settings', () => {
  const st = L.clean({ theme: 'studio', per: { studio: { fog: 0.9 }, neon: { fog: 0.1 } } });
  assert.equal(L.themeSettings(st, 'studio').fog, 0.9);
  assert.equal(L.themeSettings(st, 'neon').fog, 0.1);
  assert.equal(L.themeSettings(st, 'chrome').fog, L.THEMES.find((t) => t.id === 'chrome').def.fog);
});

test('presets fill in their settings; Low turns the costly things off', () => {
  const low = L.applyPreset(L.GFX_DEFAULT, 'low');
  assert.equal(low.preset, 'low');
  const lk = L.resolveLook({ theme: 'studio', per: {}, gfx: low });
  assert.equal(lk.bloom, null);
  assert.equal(lk.refl, 'off');
  assert.equal(lk.shadows, false);
  assert.equal(lk.res, 0.75);
  const ultra = L.resolveLook({ theme: 'studio', per: {}, gfx: L.applyPreset(low, 'ultra') });
  assert.equal(ultra.refl, 'mirror');
  assert.ok(ultra.bloom && !ultra.bloom.half);
  assert.equal(L.applyPreset(low, 'what').preset, 'custom');
});

test('Auto gives up mirror reflections, then bloom size, then bloom and shadows, in that order', () => {
  const st = { theme: 'studio', per: {}, gfx: { ...L.GFX_DEFAULT } };
  const at = (b) => L.resolveLook(st, { budget: b });
  assert.equal(at(3).refl, 'mirror');
  assert.ok(at(3).bloom && !at(3).bloom.half);
  assert.equal(at(2).refl, 'simple');
  assert.ok(at(2).bloom && !at(2).bloom.half);
  assert.ok(at(1).bloom.half);
  assert.equal(at(0).bloom, null);
  assert.equal(at(0).shadows, false);
  assert.equal(L.budgetDrop(st, 3), 2);
  assert.equal(L.budgetDrop(st, 0), -1);
  // Classic has nothing costly to give up: Auto goes straight to sharpness
  assert.equal(L.budgetDrop({ theme: 'classic', per: {}, gfx: { ...L.GFX_DEFAULT } }, 3), -1);
  // a fixed preset ignores the budget
  const hi = { theme: 'studio', per: {}, gfx: L.applyPreset(L.GFX_DEFAULT, 'high') };
  assert.deepEqual(L.resolveLook(hi, { budget: 0 }), L.resolveLook(hi, { budget: 3 }));
});

test('every style has its own signature; the four new ones are marked new', () => {
  const sigs = new Set();
  for (const t of L.THEMES) {
    for (const k of ['floor', 'rails', 'pool', 'beat', 'amb']) assert.ok(k in t.sig, `${t.id} sig ${k}`);
    if (t.id !== 'classic') assert.notEqual(t.sig.rails, 'tube', `${t.id}: only Classic has light-tube rails`);
    sigs.add(JSON.stringify([t.sig.floor, t.sig.rails, t.sig.amb, t.def.hit]));
  }
  assert.equal(sigs.size, L.THEMES.length, 'no two styles share floor, rails, movement and hit effect');
  for (const id of ['synthwave', 'arena', 'ember', 'blueprint']) assert.ok(L.THEMES.find((t) => t.id === id).isNew, id);
  for (const t of L.THEMES) assert.ok(L.HITS.some((x) => x[0] === t.def.hit), `${t.id} hit`);
});

test('the background is its own choice: any style over a venue or its own room', () => {
  const st = { theme: 'neon', bg: 'venue', per: {}, gfx: { ...L.GFX_DEFAULT, dof: true, grain: true, vignette: true } };
  const lk = L.resolveLook(st);
  assert.equal(lk.own, false);
  assert.equal(lk.sky, null);
  assert.ok(lk.bloom, 'bloom stays on over a venue (moving ones too)');
  assert.ok(lk.dof && lk.grain && lk.vignette);
  assert.equal(L.resolveLook({ ...st, bg: 'own' }).own, true);
  assert.ok(L.resolveLook({ ...st, bg: 'own' }).sky);
});

test('old settings carry over: the per-style background, the Sparks switch, a preset without style effects', () => {
  assert.equal(L.clean(null).bg, 'venue', 'new players see the venue, as before');
  assert.equal(L.clean({ theme: 'classic' }).bg, 'venue');
  assert.equal(L.clean({ theme: 'studio' }).bg, 'own', 'other styles showed their own room');
  assert.equal(L.clean({ theme: 'studio', per: { studio: { back: 'venue' } } }).bg, 'venue');
  assert.equal(L.clean({ theme: 'classic', per: { classic: { back: 'own' } } }).bg, 'own');
  assert.equal(L.clean({ theme: 'studio', bg: 'own', per: { studio: { back: 'venue' } } }).bg, 'own', 'a saved choice wins');
  const st = L.clean({ theme: 'studio', per: { studio: { sparks: false, back: 'own' } } });
  assert.equal(st.per.studio.hit, 'none');
  assert.ok(!('back' in st.per.studio) && !('sparks' in st.per.studio));
  assert.equal(L.clean({ gfx: { preset: 'low' } }).gfx.fx, 'simple');
  assert.equal(L.clean({ gfx: { preset: 'high' } }).gfx.fx, 'full');
});

test('style effects: Low and a slow PC drop the moving parts', () => {
  const full = L.resolveLook({ theme: 'studio', bg: 'own', per: {}, gfx: { ...L.GFX_DEFAULT } }, { budget: 3 });
  assert.equal(full.amb, true);
  assert.equal(L.resolveLook({ theme: 'studio', per: {}, gfx: L.applyPreset(L.GFX_DEFAULT, 'low') }).amb, false);
  assert.equal(L.resolveLook({ theme: 'studio', per: { studio: { amb: false } }, gfx: { ...L.GFX_DEFAULT } }).amb, false);
  assert.equal(L.resolveLook({ theme: 'classic', per: {}, gfx: { ...L.GFX_DEFAULT } }).amb, false, 'Classic has none');
  assert.equal(L.resolveLook({ theme: 'studio', per: { studio: { hit: 'embers' } }, gfx: { ...L.GFX_DEFAULT } }).hit, 'embers');
});

test('the old Reflections switch carries over to Classic, and saving tells listeners', () => {
  store.clear();
  store.set('stagehand.highway', JSON.stringify({ reflections: false }));
  L._reset();
  assert.equal(L.themeSettings(L.loadLooks(), 'classic').refl, 'off');
  assert.equal(L.resolveLook(L.loadLooks()).refl, 'off');
  let heard = null;
  const off = L.onLooks((s) => (heard = s.theme));
  L.saveLooks({ ...L.loadLooks(), theme: 'midnight' });
  assert.equal(heard, 'midnight');
  off();
  L._reset();
  assert.equal(L.loadLooks().theme, 'midnight', 'saved and read back');
  assert.equal(L.loadLooks().per.classic.refl, 'off', 'the carried-over setting is kept once saved');
});
