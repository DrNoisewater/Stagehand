/**
 * The highway's looks (themes) and graphics settings.
 *
 * A look changes only how the highway is lit and coloured: the floor and its lane colours, the room
 * behind it, glow, fog, reflections, sparks, the note finish and the after-effects (bloom and so on).
 * It never moves anything: strings, frets, notes, the hit line, the camera, labels and their sizes are
 * worked out the same way in every look (test/hwlook/shoot.js THEMES=1 checks that). Strings and notes
 * keep their standard colours in every look.
 *
 * Saved as `stagehand.hwlook.v1` = { theme, per: { <theme>: { setting: value } }, gfx: { … } }.
 * Each look keeps its own settings; graphics quality is one setting for all looks.
 * No page code here (the settings page is hwlooks-pane.js), so the tests can load it in Node.
 */

export const KEY = 'stagehand.hwlook.v1';

// The floor and stage colours a look can change (Classic is today's highway, value for value).
const CLASSIC_PAL = {
  line: '#5ad2eb', lineA: 0.1, // every fret's line running off into the distance
  laneA: '#0f3346', laneB: '#0b2838', laneFill: 0.92, // the hand position's channel (near, far)
  laneMid: '#3c8cb4', laneMidA: 0.16, // the lit strip down each lane
  laneLine: '#78e6ff', laneLineA: 0.55, // the lines between its lanes
  rail: '#50e8ff', railHot: '#ff963c', // its edges (warming up on a streak)
  beat: '#a0ebff', beatA: 0.45, // beat lines (bars brighter)
  wash: '#46c8ff', // the hand position, faintly lit on the neck
  inlay: '#7fdce4', inlayEdge: '#4fb8c4', inlayA: 0.42, // inlay dots outside the hand position
  postA: '#ff7ad2', postB: '#50e8ff', // the glow round the hand position's two posts at the neck
};

// Settings each look keeps for itself, with what they can be.
export const THEME_SETTINGS = {
  bright: { min: 0.6, max: 1.3, step: 0.05 },
  glow: { min: 0, max: 1.5, step: 0.05 },
  refl: ['off', 'soft', 'full'],
  back: ['own', 'venue'],
  fog: { min: 0, max: 1, step: 0.05 },
  gem: ['solid', 'glass', 'matte'],
  sparks: [true, false],
};

/**
 * The looks, in the order they are listed. `def` are the settings it starts with (each can be changed
 * and reset); the rest is the look itself. sky: the look's own room (top, middle, horizon; floor near,
 * floor far; pattern 0 plain, 1 grid, 2 boards; key light behind the highway; a line of light along
 * the horizon). bloom: strength, radius, threshold at full glow.
 */
export const THEMES = [
  {
    id: 'studio',
    name: 'Studio',
    isNew: true,
    wink: 'Soft light, grey room, nobody squinting.',
    about: 'A calm, evenly lit room in greys. Matte notes, a gentle sheen on the floor.',
    def: { bright: 1, glow: 0.7, refl: 'full', back: 'own', fog: 0.35, gem: 'matte', sparks: true },
    sky: { top: '#232930', mid: '#3c434c', hor: '#87909a', near: '#22262c', far: '#4a525b', pattern: 0, patA: 0, key: 0.18, keyCol: '#dfe6ee', horLine: 0.1, horW: 0.05, horCol: '#e8eef5' },
    fogCol: '#68717b',
    bloom: [0.2, 0.3, 0.82],
    reflK: 0.2,
    shadows: true,
    pal: { line: '#e8ecf2', lineA: 0.06, laneA: '#40464f', laneB: '#3a4049', laneFill: 0.92, laneMid: '#9aa4b0', laneMidA: 0.1, laneLine: '#e8ecf2', laneLineA: 0.42, rail: '#f2f4f7', railHot: '#ffb070', beat: '#ffffff', beatA: 0.32, wash: '#ffffff', inlay: '#d6dbe2', inlayEdge: '#9aa3ae', inlayA: 0.4, postA: '#ffffff', postB: '#cfd8e3' },
    swatch: ['#1d2126', '#717b86', '#40464f', '#f2f4f7'],
  },
  {
    id: 'classic',
    name: 'Classic',
    wink: 'The one you know. Still bolted down exactly where you left it.',
    about: 'The highway as it has always been: cyan rails over your venue.',
    def: { bright: 1, glow: 1, refl: 'soft', back: 'venue', fog: 0, gem: 'solid', sparks: true },
    sky: { top: '#0b0f17', mid: '#121a26', hor: '#1d2b3c', near: '#05070c', far: '#0f1824', pattern: 0, patA: 0, key: 0.12, keyCol: '#5ad2eb', horLine: 0, horCol: '#50e8ff' },
    fogCol: '#0b1017',
    bloom: [0, 0, 1],
    reflK: 0.28,
    shadows: false,
    pal: CLASSIC_PAL,
    swatch: ['#121a26', '#1d2b3c', '#0f3346', '#50e8ff'],
  },
  {
    id: 'roadcase',
    name: 'Road case',
    isNew: true,
    wink: 'Gaffer tape, worn boards, a light left on for the crew.',
    about: 'Stagehand’s own: a warm wooden stage, black road-case lanes, cream tape lines.',
    def: { bright: 1, glow: 0.7, refl: 'soft', back: 'own', fog: 0.3, gem: 'solid', sparks: true },
    sky: { top: '#0a0705', mid: '#1a120c', hor: '#3a2a1c', near: '#140d08', far: '#3a2616', pattern: 2, patA: 0.16, key: 0.2, keyCol: '#ffc67a', horLine: 0, horCol: '#ffc67a' },
    fogCol: '#1c140d',
    bloom: [0.16, 0.3, 0.84],
    reflK: 0.22,
    shadows: true,
    pal: { line: '#d9a35a', lineA: 0.07, laneA: '#221a15', laneB: '#1c1611', laneFill: 0.93, laneMid: '#8a6a48', laneMidA: 0.12, laneLine: '#e9dcc0', laneLineA: 0.45, rail: '#e3c26a', railHot: '#ff963c', beat: '#e9dcc0', beatA: 0.34, wash: '#ffc67a', inlay: '#e8d6b0', inlayEdge: '#b89a6a', inlayA: 0.4, postA: '#ffb070', postB: '#e3c26a' },
    swatch: ['#1a120c', '#3a2616', '#221a15', '#e3c26a'],
  },
  {
    id: 'chrome',
    name: 'Chrome & glass',
    isNew: true,
    wink: 'Polished, cool and expensive-looking. Fingerprints not included.',
    about: 'Smoked glass notes in chrome, a cool blue room, a mirror floor. Turned down from the first try.',
    def: { bright: 0.95, glow: 0.75, refl: 'full', back: 'own', fog: 0.3, gem: 'glass', sparks: true },
    sky: { top: '#03060a', mid: '#0a111a', hor: '#162636', near: '#070b10', far: '#132030', pattern: 1, patA: 0.05, key: 0.1, keyCol: '#9fd8ff', horLine: 0.12, horCol: '#7ee8ff' },
    fogCol: '#0b1017',
    bloom: [0.3, 0.4, 0.8],
    reflK: 0.3,
    shadows: true,
    pal: { line: '#6fb8d0', lineA: 0.08, laneA: '#10293a', laneB: '#0c2130', laneFill: 0.92, laneMid: '#3c8cb4', laneMidA: 0.13, laneLine: '#7ee8ff', laneLineA: 0.4, rail: '#9eeeff', railHot: '#ff963c', beat: '#a0ebff', beatA: 0.36, wash: '#7ee8ff', inlay: '#a8e4ee', inlayEdge: '#5fb4c4', inlayA: 0.38, postA: '#bff4ff', postB: '#7ee8ff' },
    swatch: ['#0a111a', '#162636', '#10293a', '#9eeeff'],
  },
  {
    id: 'neon',
    name: 'Neon depth',
    isNew: true,
    wink: 'Late-night synth club, with the dimmer turned down a notch.',
    about: 'Violet and pink light in a dark room, glassy notes. Calmer than the first try.',
    def: { bright: 0.9, glow: 0.7, refl: 'full', back: 'own', fog: 0.35, gem: 'glass', sparks: true },
    sky: { top: '#020104', mid: '#08040f', hor: '#1c0a28', near: '#040307', far: '#120820', pattern: 1, patA: 0.06, key: 0.08, keyCol: '#c45cff', horLine: 0.22, horCol: '#ff5cd6' },
    fogCol: '#0a0612',
    bloom: [0.36, 0.5, 0.8],
    reflK: 0.26,
    shadows: false,
    pal: { line: '#c45cff', lineA: 0.08, laneA: '#1b0e33', laneB: '#150a29', laneFill: 0.92, laneMid: '#7a3cc4', laneMidA: 0.14, laneLine: '#ff7ad8', laneLineA: 0.38, rail: '#ff5cd6', railHot: '#ffb070', beat: '#d9a6ff', beatA: 0.36, wash: '#c45cff', inlay: '#c9a2ff', inlayEdge: '#8a5cd6', inlayA: 0.4, postA: '#ff7ad2', postB: '#9a6bff' },
    swatch: ['#08040f', '#1c0a28', '#1b0e33', '#ff5cd6'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    isNew: true,
    wink: 'For the 2 a.m. session. Your eyes (and neighbours) will thank you.',
    about: 'Very dim and calm for long practice: no sparks, no shine, soft blue lines.',
    def: { bright: 0.8, glow: 0.45, refl: 'off', back: 'own', fog: 0.45, gem: 'solid', sparks: false },
    sky: { top: '#010204', mid: '#03060b', hor: '#0a1220', near: '#020305', far: '#070b12', pattern: 0, patA: 0, key: 0.05, keyCol: '#3f8fb8', horLine: 0, horCol: '#3fa9c8' },
    fogCol: '#04070c',
    bloom: [0.1, 0.3, 0.86],
    reflK: 0.15,
    shadows: false,
    pal: { line: '#3a6f86', lineA: 0.07, laneA: '#0b1b26', laneB: '#081520', laneFill: 0.9, laneMid: '#2a5a75', laneMidA: 0.12, laneLine: '#4f9ab8', laneLineA: 0.38, rail: '#46aac8', railHot: '#d68a4a', beat: '#6f9fb8', beatA: 0.3, wash: '#3f8fb8', inlay: '#6fa8b8', inlayEdge: '#3f7888', inlayA: 0.34, postA: '#5f8fb8', postB: '#3fa9c8' },
    swatch: ['#03060b', '#0a1220', '#0b1b26', '#46aac8'],
  },
  {
    id: 'clear',
    name: 'Clear view',
    isNew: true,
    wink: 'No frills, no fog, nothing in the way. The lightest on your PC.',
    about: 'The most readable: flat dark room, crisp white lines, no glow tricks.',
    def: { bright: 1, glow: 0.25, refl: 'off', back: 'own', fog: 0, gem: 'solid', sparks: false },
    sky: { top: '#0a0c0f', mid: '#0d1013', hor: '#151a20', near: '#090b0e', far: '#12161b', pattern: 0, patA: 0, key: 0, keyCol: '#ffffff', horLine: 0, horCol: '#ffffff' },
    fogCol: '#0d1013',
    bloom: [0, 0, 1],
    reflK: 0.15,
    shadows: false,
    pal: { line: '#a8b8c8', lineA: 0.13, laneA: '#17232d', laneB: '#151f28', laneFill: 0.95, laneMid: '#5f7f9a', laneMidA: 0.08, laneLine: '#d6e2ee', laneLineA: 0.6, rail: '#ffffff', railHot: '#ffb070', beat: '#ffffff', beatA: 0.42, wash: '#ffffff', inlay: '#cfd8e2', inlayEdge: '#8f9aa6', inlayA: 0.45, postA: '#ffffff', postB: '#ffffff' },
    swatch: ['#0d1013', '#151a20', '#17232d', '#ffffff'],
  },
];
export const DEFAULT_THEME = 'classic'; // what everyone starts on: nothing changes under you

// ------------------------------------------------------------------ graphics --
export const GFX_DEFAULT = { preset: 'auto', res: 'auto', aa: 'msaa4', bloom: 'full', refl: 'mirror', shadows: 'on', dof: false, grain: false, vignette: false, fpsCap: 0 };
export const PRESETS = {
  auto: { res: 'auto', aa: 'msaa4', bloom: 'full', refl: 'mirror', shadows: 'on' },
  low: { res: 0.75, aa: 'fxaa', bloom: 'off', refl: 'off', shadows: 'off' },
  medium: { res: 1, aa: 'msaa4', bloom: 'half', refl: 'simple', shadows: 'on' },
  high: { res: 1, aa: 'msaa4', bloom: 'full', refl: 'mirror', shadows: 'on' },
  ultra: { res: 1.5, aa: 'msaa8', bloom: 'full', refl: 'mirror', shadows: 'on' },
};
export const GFX_OPTIONS = {
  res: ['auto', 0.5, 0.75, 1, 1.25, 1.5, 2],
  aa: ['off', 'fxaa', 'msaa4', 'msaa8'],
  bloom: ['off', 'half', 'full'],
  refl: ['off', 'simple', 'mirror'],
  shadows: ['off', 'on'],
  fpsCap: [0, 30, 60, 120],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);
}

/** A stored state made safe: unknown looks, settings and values are dropped. */
export function clean(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = { theme: THEMES.some((t) => t.id === s.theme) ? s.theme : DEFAULT_THEME, per: {}, gfx: { ...GFX_DEFAULT } };
  for (const t of THEMES) {
    const o = s.per && s.per[t.id];
    if (!o || typeof o !== 'object') continue;
    const keep = {};
    for (const [k, spec] of Object.entries(THEME_SETTINGS)) {
      if (!(k in o)) continue;
      const v = o[k];
      if (Array.isArray(spec)) { if (spec.includes(v)) keep[k] = v; }
      else if (Number.isFinite(v)) keep[k] = clamp(v, spec.min, spec.max);
    }
    if (Object.keys(keep).length) out.per[t.id] = keep;
  }
  const g = s.gfx && typeof s.gfx === 'object' ? s.gfx : {};
  if (g.preset === 'custom' || PRESETS[g.preset]) out.gfx.preset = g.preset;
  for (const [k, opts] of Object.entries(GFX_OPTIONS)) if (opts.includes(g[k])) out.gfx[k] = g[k];
  for (const k of ['dof', 'grain', 'vignette']) if (typeof g[k] === 'boolean') out.gfx[k] = g[k];
  return out;
}

/** A look's settings as they stand: its own starting values with what you changed on top. */
export function themeSettings(state, id) {
  const t = themeById(id);
  return { ...t.def, ...((state.per && state.per[t.id]) || {}) };
}

/** Picking a preset fills in the settings under it; changing one of those makes it "custom". */
export function applyPreset(gfx, preset) {
  if (!PRESETS[preset]) return { ...gfx, preset: 'custom' };
  return { ...gfx, ...PRESETS[preset], preset };
}

/**
 * Everything the highway needs to draw a look: the look and its settings, held back by the graphics
 * settings, and in Auto by `budget` (3 = all effects; Auto steps it down on a slow PC: mirror
 * reflections go first, then bloom shrinks, then bloom goes, before the picture gets less sharp).
 * `seeThrough` is a moving venue behind the highway (no after-effects there).
 */
export function resolveLook(state, { budget = 3, seeThrough = false } = {}) {
  const t = themeById(state.theme);
  const s = themeSettings(state, t.id);
  const g = state.gfx || GFX_DEFAULT;
  const auto = g.preset === 'auto';
  const lim = auto ? budget : 3;
  // reflections: the look's wish, the quality allowed, and Auto's budget
  let refl = s.refl === 'off' || g.refl === 'off' ? 'off' : s.refl === 'full' && g.refl === 'mirror' && lim >= 3 ? 'mirror' : 'simple';
  let bloomQ = g.bloom === 'off' || lim < 1 ? 'off' : g.bloom === 'half' || lim < 2 ? 'half' : 'full';
  const strength = t.bloom[0] * s.glow;
  const bloom = bloomQ !== 'off' && strength > 0.005 && !seeThrough ? { strength, radius: t.bloom[1], threshold: t.bloom[2], half: bloomQ === 'half' } : null;
  const own = s.back === 'own';
  return {
    id: t.id,
    pal: t.pal,
    sky: own ? t.sky : null,
    own,
    bright: s.bright,
    glowK: s.glow,
    fogK: s.fog,
    fogCol: t.fogCol,
    refl,
    reflK: t.reflK,
    gem: s.gem,
    sparks: s.sparks !== false,
    shadows: t.shadows && g.shadows === 'on' && lim >= 1,
    bloom,
    aa: g.aa,
    dof: !!g.dof && !seeThrough,
    grain: !!g.grain && !seeThrough,
    vignette: !!g.vignette && !seeThrough,
    res: auto ? 'auto' : g.res,
    fpsCap: g.fpsCap || 0,
  };
}

/** Auto's next step down: the highest budget below `budget` that turns something off, or -1 if nothing is left. */
export function budgetDrop(state, budget) {
  const cur = JSON.stringify(resolveLook(state, { budget }));
  for (let b = budget - 1; b >= 0; b--) if (JSON.stringify(resolveLook(state, { budget: b })) !== cur) return b;
  return -1;
}

// ---------------------------------------------------------------- saved state --
let cache = null;
const listeners = new Set();
function storage() {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
}
export function loadLooks() {
  if (cache) return cache;
  const st = storage();
  let raw = null;
  try { raw = JSON.parse((st && st.getItem(KEY)) || 'null'); } catch (_) {}
  cache = clean(raw);
  if (!raw && st) {
    // the old "Reflections" switch (before looks): kept as Classic's reflections
    try {
      const old = JSON.parse(st.getItem('stagehand.highway') || '{}');
      if (old && old.reflections === false) cache.per.classic = { refl: 'off' };
    } catch (_) {}
  }
  return cache;
}
export function saveLooks(next) {
  cache = clean(next);
  const st = storage();
  try { st && st.setItem(KEY, JSON.stringify(cache)); } catch (_) {}
  for (const f of listeners) {
    try { f(cache); } catch (_) {}
  }
  return cache;
}
export function onLooks(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}
/** For the tests: forget what was read (the next load reads storage again). */
export function _reset() {
  cache = null;
}
