// The highway's looks and graphics settings (src/renderer/js/hwlooks.js): stored settings made safe,
// Classic left as it was, presets, Auto's order of giving things up, and old saves carried over.
// 4.31: a style decides its own fog, reflections, glow and note finish; you pick brightness and effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const L = await import('../src/renderer/js/hwlooks.js');
const NEW = ['synthwave', 'arena', 'ember', 'blueprint', 'arcade', 'deepsea', 'ice', 'disco'];

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
  assert.equal(lk.sig.rails, 'tube');
});

test('fifteen styles, Studio first; only the new ones are marked new; every look has a name, a wink and a palette', () => {
  assert.equal(L.THEMES.length, 15);
  assert.equal(L.THEMES[0].id, 'studio');
  assert.deepEqual(L.THEMES.filter((t) => t.isNew).map((t) => t.id), NEW);
  const keys = Object.keys(L.THEMES.find((t) => t.id === 'classic').pal).sort();
  for (const t of L.THEMES) {
    assert.ok(t.name && t.wink && t.about, t.id);
    assert.deepEqual(Object.keys(t.pal).sort(), keys, `${t.id} palette`);
    for (const k of Object.keys(L.THEME_SETTINGS)) assert.ok(k in t.def, `${t.id} ${k}`);
  }
});

test('stored settings are made safe; only brightness and effects are kept per style', () => {
  const st = L.clean({ theme: 'nope', per: { studio: { bright: 9, glow: 'x', refl: 'full', gem: 'glass', fog: 0.2, junk: 1 }, neon: { fx: 'calm' }, ghost: { bright: 1 } }, gfx: { preset: 'mega', aa: 'smaa', res: 1.5, fpsCap: 45, dof: 'yes', grain: true } });
  assert.equal(st.theme, 'classic');
  assert.deepEqual(st.per, { studio: { bright: L.THEME_SETTINGS.bright.max }, neon: { fx: 'calm' } });
  assert.deepEqual(st.gfx, { preset: 'auto', fpsCap: 0 }, 'single graphics options are gone');
  assert.equal(L.clean({ gfx: { preset: 'high', fpsCap: 60 } }).gfx.fpsCap, 60);
});

test('note finishes: each style has its own', () => {
  const by = Object.fromEntries(L.THEMES.map((t) => [t.id, t.def.gem]));
  assert.deepEqual(by, { studio: 'satin', classic: 'solid', synthwave: 'neon', arena: 'solid', ember: 'satin', blueprint: 'flat', arcade: 'flat', deepsea: 'satin', ice: 'glass', disco: 'paint', roadcase: 'paint', chrome: 'glass', neon: 'neon', midnight: 'satin', clear: 'flat' });
});

test('each style keeps its own brightness and effects', () => {
  const st = L.clean({ theme: 'studio', per: { studio: { bright: 0.8 }, neon: { fx: 'off' } } });
  assert.equal(L.themeSettings(st, 'studio').bright, 0.8);
  assert.equal(L.themeSettings(st, 'studio').fx, 'full');
  assert.equal(L.themeSettings(st, 'neon').fx, 'off');
  assert.equal(L.themeSettings(st, 'chrome').bright, L.THEMES.find((t) => t.id === 'chrome').def.bright);
});

test('presets: Low turns the costly things off, and each step up adds something', () => {
  const low = L.applyPreset(L.GFX_DEFAULT, 'low');
  assert.equal(low.preset, 'low');
  const at = (p) => L.resolveLook({ theme: 'studio', bg: 'own', per: {}, gfx: L.applyPreset(L.GFX_DEFAULT, p) });
  const lk = at('low');
  assert.equal(lk.bloom, null);
  assert.equal(lk.refl, 'off');
  assert.equal(lk.shadows, false);
  assert.equal(lk.amb, false);
  assert.equal(lk.res, 0.75);
  assert.ok(at('medium').bloom.half);
  assert.equal(at('medium').refl, 'simple');
  assert.ok(at('high').bloom && !at('high').bloom.half);
  assert.equal(at('high').refl, 'mirror');
  assert.equal(at('ultra').res, 1.5);
  assert.equal(at('ultra').aa, 'msaa8');
  assert.equal(L.applyPreset(low, 'what').preset, 'low', 'an unknown preset keeps what was there');
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

test('every style has its own signature', () => {
  const sigs = new Set();
  const floors = new Set();
  const rails = new Set();
  for (const t of L.THEMES) {
    for (const k of ['floor', 'rails', 'pool', 'beat', 'amb']) assert.ok(k in t.sig, `${t.id} sig ${k}`);
    if (t.id !== 'classic') assert.notEqual(t.sig.rails, 'tube', `${t.id}: only Classic has light-tube rails`);
    sigs.add(JSON.stringify([t.sig.floor, t.sig.rails, t.sig.amb, t.def.hit]));
    floors.add(t.sig.floor);
    rails.add(t.sig.rails);
  }
  assert.equal(sigs.size, L.THEMES.length, 'no two styles share floor, rails, movement and hit effect');
  assert.ok(floors.size >= 11 && rails.size >= 12, `${floors.size} floors, ${rails.size} rails`);
  for (const t of L.THEMES) assert.ok(L.HITS.some((x) => x[0] === t.def.hit), `${t.id} hit`);
});

test('the background is its own choice: any style over a venue or its own room', () => {
  const st = { theme: 'synthwave', bg: 'venue', per: {}, gfx: { ...L.GFX_DEFAULT } };
  const lk = L.resolveLook(st);
  assert.equal(lk.own, false);
  assert.equal(lk.sky, null);
  assert.ok(lk.bloom, 'bloom stays on over a venue (moving ones too)');
  assert.ok(lk.grain, 'the style’s film grain too');
  assert.equal(lk.dof, false, 'distance blur is never on');
  assert.equal(L.resolveLook({ ...st, bg: 'own' }).own, true);
  assert.ok(L.resolveLook({ ...st, bg: 'own' }).sky);
});

test('old settings carry over: the per-style background, Sparks and movement switches, a custom graphics mix', () => {
  assert.equal(L.clean(null).bg, 'venue', 'new players see the venue, as before');
  assert.equal(L.clean({ theme: 'classic' }).bg, 'venue');
  assert.equal(L.clean({ theme: 'studio' }).bg, 'own', 'other styles showed their own room');
  assert.equal(L.clean({ theme: 'studio', per: { studio: { back: 'venue' } } }).bg, 'venue');
  assert.equal(L.clean({ theme: 'classic', per: { classic: { back: 'own' } } }).bg, 'own');
  assert.equal(L.clean({ theme: 'studio', bg: 'own', per: { studio: { back: 'venue' } } }).bg, 'own', 'a saved choice wins');
  assert.deepEqual(L.clean({ theme: 'studio', per: { studio: { sparks: false, back: 'own' } } }).per.studio, { fx: 'off' });
  assert.deepEqual(L.clean({ per: { studio: { hit: 'none' } } }).per.studio, { fx: 'off' });
  assert.deepEqual(L.clean({ per: { studio: { amb: false } } }).per.studio, { fx: 'calm' });
  assert.equal(L.clean({ gfx: { preset: 'custom', aa: 'off' } }).gfx.preset, 'auto');
  assert.equal(L.clean({ gfx: { preset: 'low' } }).gfx.preset, 'low');
});

test('effects: Full, Calm and Off; Low and a slow PC drop the moving parts', () => {
  const look = (per, gfx = { ...L.GFX_DEFAULT }, budget = 3) => L.resolveLook({ theme: 'studio', bg: 'own', per: { studio: per }, gfx }, { budget });
  const full = look({});
  assert.equal(full.amb, true);
  assert.equal(full.hit, L.THEMES[0].def.hit);
  assert.equal(look({ fx: 'calm' }).amb, false);
  assert.equal(look({ fx: 'calm' }).hit, full.hit, 'Calm keeps the hit effect');
  assert.equal(look({ fx: 'off' }).hit, 'none');
  assert.equal(look({ fx: 'off' }).sparks, false);
  assert.equal(look({}, L.applyPreset(L.GFX_DEFAULT, 'low')).amb, false);
  assert.equal(look({}, { ...L.GFX_DEFAULT }, 0).amb, false);
  assert.equal(L.resolveLook({ theme: 'classic', per: {}, gfx: { ...L.GFX_DEFAULT } }).amb, false, 'Classic has none');
  assert.equal(L.resolveLook({ theme: 'classic', per: {}, gfx: { ...L.GFX_DEFAULT } }).sparks, true, 'Classic keeps its sparks');
});

test('saving tells listeners and is read back', () => {
  store.clear();
  L._reset();
  let heard = null;
  const off = L.onLooks((s) => (heard = s.theme));
  L.saveLooks({ ...L.loadLooks(), theme: 'disco', per: { disco: { fx: 'calm' } } });
  assert.equal(heard, 'disco');
  off();
  L._reset();
  assert.equal(L.loadLooks().theme, 'disco', 'saved and read back');
  assert.equal(L.loadLooks().per.disco.fx, 'calm');
});
