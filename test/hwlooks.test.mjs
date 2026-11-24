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
  assert.deepEqual(by, { studio: 'satin', classic: 'solid', roadcase: 'paint', chrome: 'glass', neon: 'neon', midnight: 'satin', clear: 'flat' });
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

test('a moving venue behind the highway turns the after-effects off', () => {
  const st = { theme: 'studio', per: { studio: { back: 'venue' } }, gfx: { ...L.GFX_DEFAULT, dof: true, grain: true, vignette: true } };
  const lk = L.resolveLook(st, { seeThrough: true });
  assert.equal(lk.bloom, null);
  assert.equal(lk.dof || lk.grain || lk.vignette, false);
  assert.equal(lk.sky, null);
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
