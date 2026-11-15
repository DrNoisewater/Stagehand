/**
 * 4.19: where things sit around you in the headset: the highway (low, in front, tilted to face your eyes),
 * the guitar outline (where your real guitar is), and how they're adjusted from the menu. Pure: no page,
 * no 3D (test/companion-place.test.mjs runs it in Node).
 *
 * Heights are metres from your eyes when VR starts (minus is lower); distances are metres in front.
 */
export const KEY = 'stagehand.vr';

// The highway's spot: well below the eyes, near your lap, the far end sloping down so the whole
// highway stays in a glance down (a flat floor would run up to the horizon: eye level).
export const DEFAULTS = Object.freeze({
  v: 2,
  height: -0.55, // the strings, where notes are played
  dist: 0.6,
  tilt: 14, // degrees: the far end goes down by this much
  size: 1,
  offset: 0, // ms: notes sooner (-) or later (+), for the headset's own delay
  hands: 'dim', // your hands while a song plays: bright, dim or faint
  passthrough: false,
  guitar: Object.freeze({ on: true, x: -0.34, y: -0.5, z: -0.24, angle: 55 }),
});
// 4.16's spot (a little below the eyes): a placement left there moves to the new one once
export const OLD = Object.freeze({ height: -0.42, dist: 0.75 });

export const LIMITS = { height: [-1.2, 0.1], dist: [0.3, 1.6], tilt: [0, 35], size: [0.5, 1.6], offset: [-300, 300] };
export const GLIMITS = { x: [-0.9, 0.5], y: [-1.1, 0.1], z: [-0.8, 0.1], angle: [0, 90] };
export const STEP = { height: 0.04, dist: 0.05, tilt: 3, size: 0.1, offset: 10 };
export const GSTEP = { x: 0.02, y: 0.02, z: 0.02, angle: 5 };
const HANDS = ['bright', 'dim', 'faint'];

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 1000) => Math.round(v * d) / d;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** The saved placement (the text kept in the headset's browser), with 4.16's left-over spot moved down once. */
export function loadPlace(text) {
  let o = {};
  try {
    o = JSON.parse(text || '{}') || {};
  } catch (_) {}
  if (typeof o !== 'object' || Array.isArray(o)) o = {};
  const p = { ...DEFAULTS, guitar: { ...DEFAULTS.guitar } };
  p.offset = clamp(num(o.offset, 0), LIMITS.offset);
  if (o.v === 2) {
    for (const k of ['height', 'dist', 'tilt', 'size']) p[k] = clamp(num(o[k], DEFAULTS[k]), LIMITS[k]);
    if (HANDS.includes(o.hands)) p.hands = o.hands;
    p.passthrough = !!o.passthrough;
    const g = o.guitar && typeof o.guitar === 'object' ? o.guitar : {};
    p.guitar.on = g.on !== false;
    for (const k of ['x', 'y', 'z', 'angle']) p.guitar[k] = clamp(num(g[k], DEFAULTS.guitar[k]), GLIMITS[k]);
    return p;
  }
  // saved by 4.16: the old spot (or anything higher, towards eye level) moves to the new one;
  // a highway someone had already put lower than that stays where they put it
  if (o.height != null && Number(o.height) < OLD.height - 0.005) {
    p.height = clamp(num(o.height, DEFAULTS.height), LIMITS.height);
    p.dist = clamp(num(o.dist, DEFAULTS.dist), LIMITS.dist);
  }
  return p;
}

/** One press on a placement button: key is height, dist, tilt, size or offset; dir is +1 or -1. */
export function nudge(p, key, dir) {
  if (!(key in STEP)) return p;
  p[key] = round(clamp(num(p[key], DEFAULTS[key]) + dir * STEP[key], LIMITS[key]));
  return p;
}
/** The same for the guitar outline: x (left/right), y (height), z (nearer/farther), angle. */
export function nudgeGuitar(p, key, dir) {
  if (!(key in GSTEP)) return p;
  p.guitar[key] = round(clamp(num(p.guitar[key], DEFAULTS.guitar[key]) + dir * GSTEP[key], GLIMITS[key]));
  return p;
}
export function resetHighway(p) {
  for (const k of ['height', 'dist', 'tilt', 'size']) p[k] = DEFAULTS[k];
  return p;
}
export function resetGuitar(p) {
  p.guitar = { ...DEFAULTS.guitar, on: p.guitar ? p.guitar.on : true };
  return p;
}

/** Where a point `s` metres along the highway (0: the strings, more: further off) is: { y, z } from the eyes. */
export function highwayPoint(p, s) {
  const a = (p.tilt * Math.PI) / 180;
  const k = p.size || 1;
  return { y: p.height - s * k * Math.sin(a), z: -(p.dist + s * k * Math.cos(a)) };
}
/** How far below straight ahead (degrees) you look to see that point. */
export function lookDown(p, s) {
  const { y, z } = highwayPoint(p, s);
  return (Math.atan2(-y, -z) * 180) / Math.PI;
}

// ---------------------------------------------------------- the guitar outline --
/** Distance (m) from the nut to fret n on a neck of this scale length (the real rule of 2^(1/12)). */
export const fretDist = (scale, n) => scale * (1 - Math.pow(2, -n / 12));

/**
 * The neck drawn where your guitar is: real fret spacing (guitar 648 mm, bass 864 mm), the board
 * getting wider towards the body, side dots where a real neck has them. Positions are along the
 * neck from fret 5 (the outline's middle, where "line it up with my hand" puts your hand), in metres.
 */
export function neckLayout(strings = 6) {
  const bass = strings <= 5;
  const scale = bass ? 0.864 : 0.648;
  const frets = bass ? 20 : 22;
  const nutW = bass ? (strings === 5 ? 0.046 : 0.04) : 0.043;
  const endW = bass ? (strings === 5 ? 0.07 : 0.06) : 0.056;
  const zero = fretDist(scale, 5) - (fretDist(scale, 5) - fretDist(scale, 4)) / 2; // the middle of fret 5's space
  const at = (n) => fretDist(scale, n) - zero;
  const len = fretDist(scale, frets);
  const width = (x) => nutW + ((x + zero) / len) * (endW - nutW);
  const wires = [];
  for (let n = 0; n <= frets; n++) wires.push(at(n));
  const mids = [];
  for (let n = 1; n <= frets; n++) mids.push((at(n - 1) + at(n)) / 2);
  const dots = [3, 5, 7, 9, 12, 15, 17, 19, 21].filter((n) => n <= frets);
  return { bass, scale, frets, strings, nutW, endW, zero, len, wires, mids, dots, width, at };
}
/** Across the board, string s (0 = the lowest string) sits this far from the middle (+ is the side nearest you). */
export function stringAcross(layout, s, x) {
  const w = layout.width(x) * 0.84;
  const n = layout.strings;
  return n <= 1 ? 0 : w / 2 - (s * w) / (n - 1);
}
