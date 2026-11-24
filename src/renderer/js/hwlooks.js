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
  ['none', 'None', 'Nothing extra.'],
];

// Settings each style keeps for itself, with what they can be.
export const THEME_SETTINGS = {
  bright: { min: 0.6, max: 1.3, step: 0.05 },
  glow: { min: 0, max: 1.5, step: 0.05 },
  refl: ['off', 'soft', 'full'],
  fog: { min: 0, max: 1, step: 0.05 },
  gem: ['solid', 'satin', 'glass', 'neon', 'paint', 'flat'],
  hit: HITS.map((x) => x[0]),
  amb: [true, false],
};

/**
 * The styles, in the order they are listed. `def` are the settings it starts with (each can be changed
 * and reset); the rest is the style itself.
 * sig, its signature. floor: the pattern on the floor (none, boards, grid, synth, blueprint, ember,
 *   gloss); rails: how the lane edges are drawn (tube, soft, tape, chrome, neon, led, draft, lava, line,
 *   laser); pool: a pool of light under your hand position (strength); beat: how much the floor answers
 *   the beat (0..1); amb: the slow movement in the room (none, dust, stars, sweep, haze, beams, embers,
 *   scan, sun).
 * sky, the style's own room: top, middle, horizon; floor near, floor far; pattern 0 plain, 1 grid,
 *   2 boards, 3 a striped sun over a rolling grid, 4 blueprint paper, 5 glowing cracks, 6 haze and light
 *   beams; key light behind the highway; a band of light along the horizon; stars.
 * bloom: strength, radius, threshold at full glow.
 */
export const THEMES = [
  {
    id: 'studio',
    name: 'Studio',
    wink: 'Soft light, grey room, nobody squinting.',
    about: 'A calm grey room under one soft light: matte floor, gentle light strips, dust in the beam.',
    def: { bright: 1, glow: 0.7, refl: 'full', fog: 0.35, gem: 'satin', hit: 'flash', amb: true },
    sig: { floor: 'none', rails: 'soft', pool: 0.14, beat: 0.5, amb: 'dust' },
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
    id: 'synthwave',
    name: 'Synthwave',
    isNew: true,
    wink: 'Somewhere it is always 1986 and the sun never quite sets.',
    about: 'A striped sun on the horizon, a pink grid rolling toward you, laser rails.',
    def: { bright: 0.95, glow: 0.8, refl: 'soft', fog: 0.3, gem: 'neon', hit: 'ripple', amb: true },
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
    id: 'arena',
    name: 'Arena',
    isNew: true,
    wink: 'Twenty thousand people and a lighting rig. Try not to wave.',
    about: 'A big dark stage: light beams sweeping through haze, LED strip rails, the floor flashes on the beat.',
    def: { bright: 1, glow: 0.8, refl: 'full', fog: 0.4, gem: 'solid', hit: 'sparks', amb: true },
    sig: { floor: 'gloss', rails: 'led', pool: 0.08, beat: 1, amb: 'beams' },
    sky: { top: '#020306', mid: '#070a12', hor: '#1a2030', near: '#040508', far: '#10141c', pattern: 6, patA: 0.5, key: 0.1, keyCol: '#9fc4ff', horLine: 0.14, horW: 0.04, horCol: '#bcd4ff' },
    fogCol: '#0e121a',
    bloom: [0.3, 0.45, 0.8],
    reflK: 0.3,
    shadows: true,
    pal: { line: '#9fc4ff', lineA: 0.06, laneA: '#0d1420', laneB: '#0a101a', laneFill: 0.93, laneMid: '#3a5a8a', laneMidA: 0.12, laneLine: '#bcd4ff', laneLineA: 0.4, rail: '#e8f0ff', railHot: '#ffb070', beat: '#cfe0ff', beatA: 0.36, wash: '#9fc4ff', inlay: '#c8d8f0', inlayEdge: '#7f98c0', inlayA: 0.38, postA: '#ffffff', postB: '#9fc4ff' },
    swatch: ['#070a12', '#1a2030', '#0d1420', '#e8f0ff'],
  },
  {
    id: 'ember',
    name: 'Ember',
    isNew: true,
    wink: 'Playing so hot the floor cracked. Mind your boots.',
    about: 'Dark charcoal with glowing cracks, lava rails, embers floating up. Hotter on a streak.',
    def: { bright: 0.95, glow: 0.8, refl: 'off', fog: 0.35, gem: 'satin', hit: 'embers', amb: true },
    sig: { floor: 'ember', rails: 'lava', pool: 0, beat: 0.7, amb: 'embers' },
    sky: { top: '#050203', mid: '#140606', hor: '#3a1408', near: '#080404', far: '#1c0a06', pattern: 5, patA: 0.6, key: 0.1, keyCol: '#ff7a2a', horLine: 0.16, horW: 0.03, horCol: '#ff6a1f' },
    fogCol: '#1a0806',
    bloom: [0.3, 0.4, 0.8],
    reflK: 0.2,
    shadows: true,
    pal: { line: '#ff7a2a', lineA: 0.06, laneA: '#1a100c', laneB: '#150c09', laneFill: 0.94, laneMid: '#6a2a10', laneMidA: 0.14, laneLine: '#ff9a4a', laneLineA: 0.36, rail: '#ff8a2a', railHot: '#ffd36a', beat: '#ffb070', beatA: 0.3, wash: '#ff7a2a', inlay: '#ffc890', inlayEdge: '#c0703a', inlayA: 0.38, postA: '#ff7a2a', postB: '#ffc060' },
    swatch: ['#140606', '#3a1408', '#1a100c', '#ff8a2a'],
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    isNew: true,
    wink: 'Drawn up by an engineer who also plays a mean riff.',
    about: 'Navy paper and white drafting lines: a fine grid, measured rails, chalk on hits.',
    def: { bright: 1, glow: 0.4, refl: 'off', fog: 0.15, gem: 'flat', hit: 'chalk', amb: true },
    sig: { floor: 'blueprint', rails: 'draft', pool: 0, beat: 0.4, amb: 'scan' },
    sky: { top: '#0a1a33', mid: '#0e2244', hor: '#173058', near: '#081428', far: '#10264a', pattern: 4, patA: 0.12, key: 0.04, keyCol: '#cfe2ff', horLine: 0.08, horW: 0.02, horCol: '#e8f2ff' },
    fogCol: '#0e2244',
    bloom: [0.08, 0.3, 0.86],
    reflK: 0.15,
    shadows: false,
    pal: { line: '#dbe8ff', lineA: 0.1, laneA: '#0d2140', laneB: '#0c1e3a', laneFill: 0.93, laneMid: '#3a5f9a', laneMidA: 0.08, laneLine: '#e8f2ff', laneLineA: 0.5, rail: '#ffffff', railHot: '#ffc070', beat: '#e8f2ff', beatA: 0.4, wash: '#cfe2ff', inlay: '#dbe8ff', inlayEdge: '#9fb8dc', inlayA: 0.4, postA: '#ffffff', postB: '#cfe2ff' },
    swatch: ['#0e2244', '#173058', '#0d2140', '#ffffff'],
  },
  {
    id: 'roadcase',
    name: 'Road case',
    wink: 'Gaffer tape, worn boards, a light left on for the crew.',
    about: 'Stagehand’s own: worn wooden boards rolling under you, gaffer-tape rails, sawdust on hits.',
    def: { bright: 1, glow: 0.7, refl: 'soft', fog: 0.3, gem: 'paint', hit: 'dust', amb: true },
    sig: { floor: 'boards', rails: 'tape', pool: 0.12, beat: 0.3, amb: 'dust' },
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
    wink: 'Polished, cool and expensive-looking. Fingerprints not included.',
    about: 'A glass floor with a fine grid, chrome rails with a running glint, glass shards on hits.',
    def: { bright: 0.95, glow: 0.75, refl: 'full', fog: 0.3, gem: 'glass', hit: 'shards', amb: true },
    sig: { floor: 'grid', rails: 'chrome', pool: 0, beat: 0.4, amb: 'sweep' },
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
    wink: 'Late-night synth club, with the dimmer turned down a notch.',
    about: 'Bent neon tubes for rails, lane lines that pulse with the beat, violet haze drifting by.',
    def: { bright: 0.9, glow: 0.7, refl: 'full', fog: 0.35, gem: 'neon', hit: 'ripple', amb: true },
    sig: { floor: 'gloss', rails: 'neon', pool: 0, beat: 0.9, amb: 'haze' },
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
    wink: 'For the 2 a.m. session. Your eyes (and neighbours) will thank you.',
    about: 'Very dim and calm for long practice: thin soft lines, a sky of faint stars, nothing flying about.',
    def: { bright: 0.8, glow: 0.45, refl: 'off', fog: 0.45, gem: 'satin', hit: 'none', amb: true },
    sig: { floor: 'none', rails: 'line', pool: 0.06, beat: 0, amb: 'stars' },
    sky: { top: '#010204', mid: '#03060b', hor: '#0a1220', near: '#020305', far: '#070b12', pattern: 0, patA: 0, key: 0.05, keyCol: '#3f8fb8', horLine: 0, horCol: '#3fa9c8', stars: 1 },
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
    wink: 'No frills, no fog, nothing in the way. The lightest on your PC.',
    about: 'The most readable: flat dark room, crisp white lines, no glow tricks, nothing moving.',
    def: { bright: 1, glow: 0.25, refl: 'off', fog: 0, gem: 'flat', hit: 'none', amb: false },
    sig: { floor: 'none', rails: 'line', pool: 0, beat: 0, amb: 'none' },
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
export const BACKGROUNDS = ['own', 'venue'];

// ------------------------------------------------------------------ graphics --
// fx: 'full' draws each style's slow movement (dust, beams, embers …); 'simple' leaves it out.
export const GFX_DEFAULT = { preset: 'auto', res: 'auto', aa: 'msaa4', bloom: 'full', refl: 'mirror', shadows: 'on', fx: 'full', dof: false, grain: false, vignette: false, fpsCap: 0 };
export const PRESETS = {
  auto: { res: 'auto', aa: 'msaa4', bloom: 'full', refl: 'mirror', shadows: 'on', fx: 'full' },
  low: { res: 0.75, aa: 'fxaa', bloom: 'off', refl: 'off', shadows: 'off', fx: 'simple' },
  medium: { res: 1, aa: 'msaa4', bloom: 'half', refl: 'simple', shadows: 'on', fx: 'full' },
  high: { res: 1, aa: 'msaa4', bloom: 'full', refl: 'mirror', shadows: 'on', fx: 'full' },
  ultra: { res: 1.5, aa: 'msaa8', bloom: 'full', refl: 'mirror', shadows: 'on', fx: 'full' },
};
export const PRESET_KEYS = ['res', 'aa', 'bloom', 'refl', 'shadows', 'fx'];
export const GFX_OPTIONS = {
  res: ['auto', 0.5, 0.75, 1, 1.25, 1.5, 2],
  aa: ['off', 'fxaa', 'msaa4', 'msaa8'],
  bloom: ['off', 'half', 'full'],
  refl: ['off', 'simple', 'mirror'],
  shadows: ['off', 'on'],
  fx: ['simple', 'full'],
  fpsCap: [0, 30, 60, 120],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);
}

/**
 * A stored state made safe: unknown styles, settings and values are dropped.
 * Older saves (4.30.0) kept "background" per style: the style in use decides `bg`, so nothing changes
 * on screen (Classic showed the venue, the other styles their own room). Sparks off became hit 'none'.
 */
export function clean(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
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
    for (const [k, spec] of Object.entries(THEME_SETTINGS)) {
      if (!(k in o)) continue;
      const v = k === 'gem' && o[k] === 'matte' ? 'satin' : o[k]; // matte was renamed satin
      if (Array.isArray(spec)) { if (spec.includes(v)) keep[k] = v; }
      else if (Number.isFinite(v)) keep[k] = clamp(v, spec.min, spec.max);
    }
    if (o.sparks === false && !('hit' in keep)) keep.hit = 'none'; // 4.30.0's Sparks switch
    if (Object.keys(keep).length) out.per[t.id] = keep;
  }
  const g = s.gfx && typeof s.gfx === 'object' ? s.gfx : {};
  if (g.preset === 'custom' || PRESETS[g.preset]) out.gfx.preset = g.preset;
  for (const [k, opts] of Object.entries(GFX_OPTIONS)) if (opts.includes(g[k])) out.gfx[k] = g[k];
  for (const k of ['dof', 'grain', 'vignette']) if (typeof g[k] === 'boolean') out.gfx[k] = g[k];
  // a saved preset fills in what it stands for (older saves had no 'fx')
  if (PRESETS[out.gfx.preset] && !('fx' in g)) out.gfx.fx = PRESETS[out.gfx.preset].fx;
  return out;
}

/** A style's settings as they stand: its own starting values with what you changed on top. */
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
 * Everything the highway needs to draw a style: the style and its settings, held back by the graphics
 * settings, and in Auto by `budget` (3 = all effects; Auto steps it down on a slow PC: mirror
 * reflections go first, then bloom shrinks, then bloom, shadows and the slow movement go, before the
 * picture gets less sharp). After-effects also work over a moving background (the renderer keeps it
 * showing through).
 */
export function resolveLook(state, { budget = 3 } = {}) {
  const t = themeById(state.theme);
  const s = themeSettings(state, t.id);
  const g = { ...GFX_DEFAULT, ...(state.gfx || {}) };
  const auto = g.preset === 'auto';
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
    reflK: t.reflK,
    gem: s.gem,
    hit: s.hit,
    sparks: s.hit === 'sparks',
    amb: !!s.amb && t.sig.amb !== 'none' && g.fx === 'full' && lim >= 1,
    shadows: t.shadows && g.shadows === 'on' && lim >= 1,
    bloom,
    aa: g.aa,
    dof: !!g.dof,
    grain: !!g.grain,
    vignette: !!g.vignette,
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
