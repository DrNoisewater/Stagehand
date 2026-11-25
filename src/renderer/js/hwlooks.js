/**
 * The highway's styles (themes) and graphics settings.
 *
 * A style changes how the highway is drawn: the floor and its pattern, how the rails are made, how the
 * floor answers the beat and a streak, the hit effect, slow movement in the room, the room itself, glow,
 * fog, reflections, the note finish and the after-effects (bloom and so on). It never moves anything:
 * strings, frets, notes, the hit line, the camera, labels and their sizes are worked out the same way in
 * every style (test/hwlook/shoot.js THEMES=1 checks that). Strings and notes keep their standard colours.
 *
 * The background is its own choice (`bg`): 'own' is the style's own room, 'venue' is the highway's venue
 * (a photo, Fluid or a moving scene, from the venue list, rotation included). Any style over any of them.
 *
 * Saved as `stagehand.hwlook.v1` = { theme, bg, per: { <theme>: { setting: value } }, gfx: { … } }.
 * Each style keeps its own settings; graphics quality is one setting for all styles.
 * No page code here (the settings page is hwlooks-pane.js), so the tests can load it in Node.
 */

export const KEY = 'stagehand.hwlook.v1';

// The floor and stage colours a style can change (Classic is the highway as it always was, value for value).
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

// Hit effects a style can use (the shock-wave ring is the highway's own Hit burst switch).
export const HITS = [
  ['sparks', 'Sparks', 'Little sparks fly up and fall.'],
  ['embers', 'Embers', 'Glowing embers drift up and fade.'],
  ['shards', 'Glass', 'Small glass shards spin away.'],
  ['dust', 'Sawdust', 'A puff of dust that settles.'],
  ['flash', 'Flash', 'A quick column of light.'],
  ['ripple', 'Ripple', 'Rings run out across the floor.'],
  ['chalk', 'Chalk', 'A chalk circle and a puff of chalk.'],
  ['pixels', 'Pixels', 'Blocky pixels burst out.'],
  ['bubbles', 'Bubbles', 'Bubbles rise and wobble away.'],
  ['flake', 'Snowflake', 'A snowflake opens and melts.'],
  ['confetti', 'Confetti', 'A pinch of confetti flutters down.'],
  ['none', 'None', 'Nothing extra.'],
];

// 4.31: what you can change about a style: its brightness, and its effects (Full: its hit effects and
// its movement in the room; Calm: hit effects toned down by about half, nothing moving in the room;
// Off: no hit effects at all, nothing moving). Every style has something here: even with no hit effect
// of its own, a hit lights the string, the fret posts and a ring. The style decides the rest.
export const THEME_SETTINGS = {
  bright: { min: 0.6, max: 1.3, step: 0.05 },
  fx: ['full', 'calm', 'off'],
};

/**
 * The styles, in the order they are listed. `def` are the settings it starts with (each can be changed
 * and reset); the rest is the style itself.
 * sig, its signature. floor: the pattern on the floor (none, boards, grid, synth, blueprint, ember,
 *   gloss, matte, mirror, ice, caustics, tiles, checker); rails: how the lane edges are drawn (tube, soft,
 *   tape, chrome, neon, led, draft, lava, line, crisp, laser, pixel, wave, frost, rainbow); pool: a pool of light under your hand position (strength); beat: how much the floor answers
 *   the beat (0..1); amb: the slow movement in the room (none, dust, stars, sweep, haze, beams, embers,
 *   scan, sun).
 * sky, the style's own room: top, middle, horizon; floor near, floor far; pattern 0 plain, 1 grid,
 *   2 boards, 3 a striped sun over a rolling grid, 4 blueprint paper, 5 glowing cracks, 6 haze and light
 *   beams; key light behind the highway; a band of light along the horizon; stars.
 * bloom: strength, radius, threshold at full glow.
 * hd (4.34): the style draws its own highway, notes, strings, effects and room with real graphics
 *   (src/renderer/js/styles/<hd>.js, see docs/hd-styles.md); sig, sky and pal are then only its fallbacks.
 *   The other new styles (no hd yet) show their nearest old look until they are built.
 */
export const THEMES = [
  {
    id: 'classic',
    name: 'Classic',
    wink: 'The one you know. Still bolted down exactly where you left it.',
    about: 'The highway as it has always been: cyan light-tube rails and sparks.',
    def: { bright: 1, glow: 1, refl: 'soft', fog: 0, gem: 'solid', hit: 'sparks', amb: true },
    sig: { floor: 'none', rails: 'tube', pool: 0, beat: 0, amb: 'none' },
    sky: { top: '#0b0f17', mid: '#121a26', hor: '#1d2b3c', near: '#05070c', far: '#0f1824', pattern: 0, patA: 0, key: 0.12, keyCol: '#5ad2eb', horLine: 0, horCol: '#50e8ff' },
    fogCol: '#0b1017',
    bloom: [0, 0, 1],
    reflK: 0.28,
    shadows: false,
    pal: CLASSIC_PAL,
    swatch: ['#121a26', '#1d2b3c', '#0f3346', '#50e8ff'],
  },
  {
    id: 'neon',
    name: 'Neon Crystal',
    isNew: true,
    wink: 'Glass, light and a club that has not opened yet.',
    about: 'A sci-fi glass highway: light trails, crystal notes, strong glow. (Being rebuilt: shows the old Neon look for now.)',
    def: { bright: 0.9, glow: 0.7, refl: 'full', fog: 0.35, gem: 'neon', hit: 'ripple', amb: true },
    sig: { floor: 'gloss', rails: 'neon', pool: 0, beat: 0.9, amb: 'haze' },
    sky: { top: '#010a10', mid: '#04202a', hor: '#0a4a58', near: '#020c10', far: '#06303a', pattern: 1, patA: 0.12, key: 0.16, keyCol: '#30f0ff', horLine: 0.3, horCol: '#ff3cc8' },
    fogCol: '#06303a',
    bloom: [0.36, 0.5, 0.8],
    reflK: 0.26,
    shadows: false,
    pal: { line: '#c45cff', lineA: 0.08, laneA: '#1b0e33', laneB: '#150a29', laneFill: 0.92, laneMid: '#7a3cc4', laneMidA: 0.14, laneLine: '#ff7ad8', laneLineA: 0.38, rail: '#ff5cd6', railHot: '#ffb070', beat: '#d9a6ff', beatA: 0.36, wash: '#c45cff', inlay: '#c9a2ff', inlayEdge: '#8a5cd6', inlayA: 0.4, postA: '#ff7ad2', postB: '#9a6bff' },
    swatch: ['#08040f', '#1c0a28', '#1b0e33', '#ff5cd6'],
  },
  {
    id: 'synthwave',
    name: 'Synthwave Drive',
    isNew: true,
    wink: 'Somewhere it is always 1986 and the sun never quite sets.',
    about: 'A night drive into a striped sun: a rolling grid, laser rails. (Being rebuilt: shows the old Synthwave look for now.)',
    def: { bright: 0.95, glow: 0.8, refl: 'soft', fog: 0.3, gem: 'neon', hit: 'ripple', amb: true, grain: true },
    sig: { floor: 'synth', rails: 'laser', pool: 0, beat: 0.8, amb: 'sun' },
    sky: { top: '#07021a', mid: '#1c0a3a', hor: '#5a1650', near: '#0a0418', far: '#1a0830', pattern: 3, patA: 0.5, key: 0.06, keyCol: '#ff5ab4', horLine: 0.25, horW: 0.03, horCol: '#ff4fa8' },
    fogCol: '#1a0a2c',
    bloom: [0.34, 0.45, 0.78],
    reflK: 0.26,
    shadows: false,
    pal: { line: '#ff4fa8', lineA: 0.12, laneA: '#160a30', laneB: '#120826', laneFill: 0.9, laneMid: '#7a2a9a', laneMidA: 0.12, laneLine: '#3ee6ff', laneLineA: 0.42, rail: '#3ee6ff', railHot: '#ffb347', beat: '#ff7ac8', beatA: 0.4, wash: '#ff4fa8', inlay: '#ff9ad0', inlayEdge: '#c24f9a', inlayA: 0.4, postA: '#ff4fa8', postB: '#3ee6ff' },
    swatch: ['#1c0a3a', '#ff4fa8', '#160a30', '#3ee6ff'],
  },
  {
    id: 'inferno',
    name: 'Inferno',
    isNew: true,
    hd: 'inferno', // drawn by its own graphics: styles/inferno.js (see docs/hd-styles.md)
    wink: 'The floor is lava. So are the notes. Keep playing.',
    about: 'Dark cracked basalt with lava flowing through it, molten-metal notes, red-hot strings, embers rising and heat shimmer over every hit.',
    def: { bright: 1, glow: 0.85, refl: 'off', fog: 0.3, gem: 'solid', hit: 'embers', amb: true, vig: true },
    sig: { floor: 'hd', rails: 'hd', pool: 0, beat: 0.6, amb: 'hd' },
    sky: { top: '#050102', mid: '#160403', hor: '#4a1206', near: '#0a0403', far: '#1e0805', pattern: 0, patA: 0, key: 0.12, keyCol: '#ff6a1a', horLine: 0.2, horW: 0.04, horCol: '#ff5a14' },
    fogCol: '#2a0a04',
    bloom: [0.55, 0.5, 0.72],
    reflK: 0.2,
    shadows: false,
    pal: { line: '#ff7a2a', lineA: 0.06, laneA: '#1a100c', laneB: '#150c09', laneFill: 0.94, laneMid: '#6a2a10', laneMidA: 0.14, laneLine: '#ff9a4a', laneLineA: 0.36, rail: '#ff8a2a', railHot: '#ffd36a', beat: '#ffb070', beatA: 0.3, wash: '#ff7a2a', inlay: '#ffc890', inlayEdge: '#c0703a', inlayA: 0.38, postA: '#ff7a2a', postB: '#ffc060' },
    swatch: ['#160403', '#4a1206', '#1a100c', '#ff8a2a'],
  },
  {
    id: 'frozen',
    name: 'Frozen Lake',
    isNew: true,
    wink: 'Cold hands, warm heart. Mind the cracks.',
    about: 'Real clear ice, frost and drifting snow, ice-crystal notes. (Being rebuilt: shows the old Frozen lake look for now.)',
    def: { bright: 1.05, glow: 0.8, refl: 'full', fog: 0.35, gem: 'glass', hit: 'flake', amb: true },
    sig: { floor: 'ice', rails: 'frost', pool: 0.06, beat: 0.4, amb: 'snow' },
    sky: { top: '#02060e', mid: '#0a1a2e', hor: '#4a6e8e', near: '#0e1a26', far: '#3a566e', pattern: 0, patA: 0, key: 0.16, keyCol: '#dff4ff', horLine: 0.12, horW: 0.03, horCol: '#e8f8ff', stars: 1 },
    fogCol: '#3a566e',
    bloom: [0.26, 0.4, 0.8],
    reflK: 0.32,
    shadows: true,
    pal: { line: '#dff4ff', lineA: 0.1, laneA: '#46708c', laneB: '#2e5470', laneFill: 0.93, laneMid: '#e8f8ff', laneMidA: 0.06, laneLine: '#ffffff', laneLineA: 0.4, rail: '#e8f8ff', railHot: '#ffc070', beat: '#ffffff', beatA: 0.36, wash: '#dff4ff', inlay: '#e8f8ff', inlayEdge: '#9cc8e4', inlayA: 0.42, postA: '#ffffff', postB: '#9fe0ff' },
    swatch: ['#0a1a2e', '#4a6e8e', '#46708c', '#e8f8ff'],
  },
  {
    id: 'ocean',
    name: 'Deep Ocean',
    isNew: true,
    wink: 'Very calm down here. The fish are into it.',
    about: 'Under the sea: rippling light, god rays, bubbles, glowing notes. (Being rebuilt: shows the old Deep sea look for now.)',
    def: { bright: 1, glow: 0.8, refl: 'soft', fog: 0.55, gem: 'satin', hit: 'bubbles', amb: true, vig: true },
    sig: { floor: 'caustics', rails: 'wave', pool: 0.1, beat: 0.3, amb: 'bubbles' },
    sky: { top: '#00121c', mid: '#013040', hor: '#0a6a7a', near: '#011820', far: '#04404c', pattern: 0, patA: 0, key: 0.3, keyCol: '#7ff0ff', horLine: 0.06, horW: 0.06, horCol: '#9ff6ff' },
    fogCol: '#04404c',
    bloom: [0.24, 0.5, 0.78],
    reflK: 0.2,
    shadows: true,
    pal: { line: '#7ff0ff', lineA: 0.08, laneA: '#06404c', laneB: '#04303a', laneFill: 0.92, laneMid: '#2aa8b8', laneMidA: 0.06, laneLine: '#bff8ff', laneLineA: 0.45, rail: '#7ff0ff', railHot: '#ffd27a', beat: '#bff8ff', beatA: 0.34, wash: '#7ff0ff', inlay: '#bff8ff', inlayEdge: '#5ac8d4', inlayA: 0.4, postA: '#7ff0ff', postB: '#3ad0e8' },
    swatch: ['#013040', '#0a6a7a', '#06323c', '#7ff0ff'],
  },
];
// every style starts with Effects: Full
for (const t of THEMES) t.def = { fx: 'full', ...t.def };
export const DEFAULT_THEME = 'classic'; // what everyone starts on: nothing changes under you
export const BACKGROUNDS = ['own', 'venue'];

// ------------------------------------------------------------------ graphics --
// 4.31: graphics are a preset (and a frame rate cap); each preset decides everything below it.
// fx: 'full' draws each style's slow movement (dust, beams, embers …); 'simple' leaves it out.
export const PRESETS = {
  auto: { res: 'auto', aa: 'msaa4', bloom: 'full', refl: 'mirror', shadows: 'on', fx: 'full', post: true },
  low: { res: 0.75, aa: 'fxaa', bloom: 'off', refl: 'off', shadows: 'off', fx: 'simple', post: false },
  medium: { res: 0.85, aa: 'msaa4', bloom: 'half', refl: 'simple', shadows: 'on', fx: 'full', post: true },
  high: { res: 1, aa: 'msaa4', bloom: 'full', refl: 'mirror', shadows: 'on', fx: 'full', post: true },
  ultra: { res: 1.5, aa: 'msaa8', bloom: 'full', refl: 'mirror', shadows: 'on', fx: 'full', post: true },
};
export const GFX_DEFAULT = { preset: 'auto', fpsCap: 0 };
export const GFX_OPTIONS = { fpsCap: [0, 30, 60, 120] };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);
}

/**
 * A stored state made safe: unknown styles, settings and values are dropped.
 * Older saves (4.30.0) kept "background" per style: the style in use decides `bg`, so nothing changes
 * on screen (Classic showed the venue, the other styles their own room). Their other per-style
 * settings and single graphics options are gone (4.31): Sparks off or no hit effect becomes Effects
 * Off, movement off becomes Calm, a custom graphics mix becomes Auto.
 */
// 4.34: fifteen styles became six; a saved old style becomes the nearest new one (its brightness and effects go with it)
export const OLD_STYLES = { chrome: 'neon', midnight: 'neon', blueprint: 'neon', arcade: 'neon', disco: 'neon', ember: 'inferno', ice: 'frozen', deepsea: 'ocean', studio: 'classic', roadcase: 'classic', clear: 'classic', clearview: 'classic', arena: 'classic' };
export function clean(raw) {
  const s0 = raw && typeof raw === 'object' ? raw : {};
  const s = { ...s0 };
  if (OLD_STYLES[s.theme]) {
    const was = s.theme;
    s.theme = OLD_STYLES[was];
    // the old style's own background choice and settings carry over to the new one
    if (s.per && typeof s.per === 'object' && s.per[was] && !s.per[s.theme]) s.per = { ...s.per, [s.theme]: s.per[was] };
    if (!BACKGROUNDS.includes(s.bg)) s.bg = s.per && s.per[s.theme] && BACKGROUNDS.includes(s.per[s.theme].back) ? s.per[s.theme].back : 'own';
  }
  const theme = THEMES.some((t) => t.id === s.theme) ? s.theme : DEFAULT_THEME;
  let bg = BACKGROUNDS.includes(s.bg) ? s.bg : null;
  if (!bg) {
    const old = s.per && s.per[theme] && s.per[theme].back;
    bg = BACKGROUNDS.includes(old) ? old : theme === 'classic' ? 'venue' : 'own';
  }
  const out = { theme, bg, per: {}, gfx: { ...GFX_DEFAULT } };
  for (const t of THEMES) {
    const o = s.per && s.per[t.id];
    if (!o || typeof o !== 'object') continue;
    const keep = {};
    if (Number.isFinite(o.bright)) keep.bright = clamp(o.bright, THEME_SETTINGS.bright.min, THEME_SETTINGS.bright.max);
    if (THEME_SETTINGS.fx.includes(o.fx)) keep.fx = o.fx;
    else if (o.sparks === false || o.hit === 'none') keep.fx = 'off';
    else if (o.amb === false) keep.fx = 'calm';
    if (Object.keys(keep).length) out.per[t.id] = keep;
  }
  const g = s.gfx && typeof s.gfx === 'object' ? s.gfx : {};
  if (PRESETS[g.preset]) out.gfx.preset = g.preset;
  if (GFX_OPTIONS.fpsCap.includes(g.fpsCap)) out.gfx.fpsCap = g.fpsCap;
  return out;
}

/** A style's settings as they stand: its own starting values with what you changed on top. */
export function themeSettings(state, id) {
  const t = themeById(id);
  return { ...t.def, ...((state.per && state.per[t.id]) || {}) };
}

/** Picking a preset (an unknown one keeps what was there). */
export function applyPreset(gfx, preset) {
  return PRESETS[preset] ? { ...gfx, preset } : { ...gfx };
}

/**
 * Everything the highway needs to draw a style: the style and its settings, held back by the graphics
 * settings, and in Auto by `budget` (3 = all effects; Auto steps it down on a slow PC: mirror
 * reflections go first, then bloom shrinks, then bloom, shadows and the slow movement go, before the
 * picture gets less sharp). After-effects also work over a moving background (the renderer keeps it
 * showing through).
 */
export function resolveLook(state, { budget = 3 } = {}) {
  const t = themeById(state.theme);
  const s = themeSettings(state, t.id);
  const gs = { ...GFX_DEFAULT, ...(state.gfx || {}) };
  const g = PRESETS[gs.preset] || PRESETS.auto;
  const auto = !PRESETS[gs.preset] || gs.preset === 'auto';
  const lim = auto ? budget : 3;
  // reflections: the style's wish, the quality allowed, and Auto's budget
  const refl = s.refl === 'off' || g.refl === 'off' ? 'off' : s.refl === 'full' && g.refl === 'mirror' && lim >= 3 ? 'mirror' : 'simple';
  const bloomQ = g.bloom === 'off' || lim < 1 ? 'off' : g.bloom === 'half' || lim < 2 ? 'half' : 'full';
  const strength = t.bloom[0] * s.glow;
  const bloom = bloomQ !== 'off' && strength > 0.005 ? { strength, radius: t.bloom[1], threshold: t.bloom[2], half: bloomQ === 'half' } : null;
  const own = (state.bg || 'own') === 'own';
  return {
    id: t.id,
    pal: t.pal,
    sig: t.sig,
    sky: own ? t.sky : null,
    own,
    bright: s.bright,
    glowK: s.glow,
    fogK: s.fog,
    fogCol: t.fogCol,
    refl,
    reflWish: s.refl,
    reflK: t.reflK,
    gem: s.gem,
    hit: s.fx === 'off' ? 'none' : s.hit,
    // how strong the hit effects are: Full 1, Calm about half (smaller, fainter, fewer), Off none
    // (Off also leaves out the string blaze, the light posts and the shock-wave ring: just the notes)
    fxK: s.fx === 'off' ? 0 : s.fx === 'calm' ? 0.45 : 1,
    sparks: s.fx !== 'off' && s.hit === 'sparks',
    amb: s.fx === 'full' && t.sig.amb !== 'none' && g.fx === 'full' && lim >= 1,
    shadows: t.shadows && g.shadows === 'on' && lim >= 1,
    bloom,
    aa: g.aa,
    dof: false, // distance blur makes far notes harder to read: never on
    grain: !!(t.def.grain && g.post && lim >= 1),
    vignette: !!(t.def.vig && g.post),
    res: auto ? 'auto' : g.res,
    fpsCap: gs.fpsCap || 0,
    // 4.34: a style drawn by its own graphics (styles/<hd>.js), and how much it may spend:
    // quality 0 Low, 1 Medium, 2 High, 3 Ultra (Auto: High, stepping down with the budget);
    // motion: its room and particles move (Effects Full, not Low); haze: screen effects allowed
    // (only for such a style, so the others' Auto steps stay as they were)
    hd: t.hd || null,
    quality: !t.hd ? 2 : auto ? (lim >= 3 ? 2 : lim >= 1 ? 1 : 0) : gs.preset === 'ultra' ? 3 : gs.preset === 'high' ? 2 : gs.preset === 'medium' ? 1 : 0,
    motion: !!t.hd && s.fx === 'full' && g.fx === 'full' && lim >= 1,
    haze: !!t.hd && !!(g.post && lim >= 1) && s.fx !== 'off',
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
