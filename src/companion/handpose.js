/**
 * 4.19: your hands in the headset, as the headset tracks them: the 25 joints of each hand (WebXR's order),
 * the bones between them, which way the palm faces, a pinch, a poke. Pure arrays of numbers, no 3D library:
 * test/companion-hands.test.mjs runs it, and the picture test makes pretend hands with pretendHand().
 */
export const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
export const J = Object.fromEntries(JOINTS.map((n, i) => [n, i]));
export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_TIP = 9;
export const MIDDLE_TIP = 14;

/** The bones drawn between joints: each finger from the wrist to its tip, and across the knuckles. */
export const BONES = (() => {
  const out = [];
  for (const chain of [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8, 9], [0, 10, 11, 12, 13, 14], [0, 15, 16, 17, 18, 19], [0, 20, 21, 22, 23, 24]]) {
    for (let i = 1; i < chain.length; i++) out.push([chain[i - 1], chain[i]]);
  }
  out.push([6, 11], [11, 16], [16, 21], [2, 6]); // the knuckles, and the web of the thumb
  return out;
})();

const sub = (a, i, b, k) => [a[i * 3] - b[k * 3], a[i * 3 + 1] - b[k * 3 + 1], a[i * 3 + 2] - b[k * 3 + 2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Joint i of a hand (a flat array of 25 × xyz). */
export const joint = (pts, i) => [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
export const dist = (pts, i, k) => Math.hypot(...sub(pts, i, pts, k));

/** Which way the palm faces (a unit vector out of the palm). side: 'left' or 'right'. */
export function palmNormal(pts, side) {
  const a = sub(pts, 6, pts, 0); // the index knuckle from the wrist
  const b = sub(pts, 21, pts, 0); // the little finger's knuckle
  const n = norm(cross(a, b));
  return side === 'left' ? [-n[0], -n[1], -n[2]] : n;
}
/** How much the palm faces your eyes: 1 straight at you, 0 side on, -1 away. */
export function palmToward(pts, side, eye) {
  const w = joint(pts, 0);
  return dot(palmNormal(pts, side), norm([eye[0] - w[0], eye[1] - w[1], eye[2] - w[2]]));
}
/** Thumb and index finger together. */
export const pinching = (pts, was = false) => dist(pts, THUMB_TIP, INDEX_TIP) < (was ? 0.03 : 0.018);

/**
 * A pretend hand for the picture test: a relaxed hand with its wrist at `wrist`, fingers pointing along
 * `point`, the palm facing `palm`, fingers bent by `curl` (0 straight, 1 a loose fist); `pointing`: the index
 * finger straight out and the others folded.
 */
export function pretendHand(side, { wrist = [0, -0.4, -0.35], point = [0, 0, -1], palm = [0, -1, 0], curl = 0.25, spread = 1, pointing = false } = {}) {
  const f = norm(point);
  let n = norm(palm);
  // keep the palm square to the fingers
  n = norm(add(n, f, -dot(n, f)));
  const c = cross(f, n);
  const s = side === 'left' ? [-c[0], -c[1], -c[2]] : c; // towards the thumb
  const out = new Array(75).fill(0);
  const put = (i, p) => ((out[i * 3] = p[0]), (out[i * 3 + 1] = p[1]), (out[i * 3 + 2] = p[2]));
  put(0, wrist);
  // fingers: metacarpal near the wrist, the knuckle, then three bones bending towards the palm
  const fingers = [
    { at: 5, across: 0.024, len: [0.045, 0.026, 0.022] },
    { at: 10, across: 0.006, len: [0.05, 0.03, 0.024] },
    { at: 15, across: -0.012, len: [0.046, 0.028, 0.023] },
    { at: 20, across: -0.03, len: [0.036, 0.021, 0.02] },
  ];
  for (const g of fingers) {
    const bend = pointing ? (g.at === 5 ? 0.02 : 1.1) : curl;
    const meta = add(add(wrist, f, 0.025), s, g.across * 0.7);
    put(g.at, meta);
    let p = add(add(wrist, f, 0.09 - Math.abs(g.across) * 0.4), s, g.across * (0.9 + 0.3 * spread));
    put(g.at + 1, p);
    let d = norm(add(f, s, g.across * 2 * spread));
    for (let k = 0; k < 3; k++) {
      // bend: turn towards the palm side
      d = norm(add(d, n, -bend * 0.55));
      p = add(p, d, g.len[k]);
      put(g.at + 2 + k, p);
    }
  }
  // the thumb: out to the side and forward, bending in
  let p = add(add(wrist, s, 0.022), f, 0.022);
  put(1, p);
  let d = norm(add(add(f, s, 1.1), n, -0.35));
  for (const [k, len] of [[2, 0.042], [3, 0.032], [4, 0.027]]) {
    p = add(p, d, len);
    put(k, p);
    d = norm(add(add(d, n, -curl * 0.35), s, -curl * 0.25));
  }
  return out;
}
