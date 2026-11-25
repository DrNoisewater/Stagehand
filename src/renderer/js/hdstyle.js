/**
 * 4.34: HD highway styles. A style that wants real graphics (its own highway surface, shaded notes and
 * strings, GPU particles, a sky, heat shimmer) lives in its own file, src/renderer/js/styles/<id>.js,
 * and is drawn through this engine. Classic and the styles without a file never touch any of this.
 *
 * HOW TO MAKE A STYLE (the full guide with examples is docs/hd-styles.md)
 *
 *   1. In hwlooks.js THEMES, the style has `hd: '<id>'` (its palette, sky and sig are only fallbacks).
 *   2. src/renderer/js/styles/<id>.js exports `default function build(K)` returning any of:
 *        floor:  { uniforms, glsl }  glsl defines  vec4 hdFloor(HDFloor f)        the highway surface
 *        sky:    { uniforms, glsl }  glsl defines  vec3 hdSky(HDSky s)            its own room
 *        gem:    { uniforms, glsl }  glsl defines  vec4 hdGem(HDGem g)            notes, chord frames
 *        tube:   { uniforms, glsl }  glsl defines  vec4 hdTube(HDTube t)          strings, frets, posts
 *        trail:  { uniforms, glsl, add } glsl defines vec4 hdTrail(HDTrail r)     sustains, slides, bends
 *        sprite: { glsl }            glsl defines  vec4 hdSprite(HDSprite p)      particle look (optional)
 *        haze:   0..1                heat shimmer over hits and the neck (after-effects on)
 *        chordGlass: [hexIn, hexTop]  colours of a chord frame's see-through panel
 *        onHit(e)                    a note was hit: e = { x, y, z, s, f, rgb, dead, chord, n }
 *        frame(F)                    once a frame, before drawing: F as in begin() below, plus time, dt, holdN, holds
 *      Everything a hook leaves out is drawn the usual way.
 *   3. Particles: K.emitter(spec) at build time, then emitter.burst(x, y, z, n, rgb, k) (no garbage);
 *      K.field(spec) for ambient drift (embers, snow, bubbles) computed entirely on the graphics card.
 *   4. Uniforms shared by every HD shader: uTime (s), uSong (song s), uZs (units per song s), uPulse
 *      (beat 0..1), uHeat (streak 0..1), uFx (Effects 1 / 0.45 / 0), uMotion (0/1), uQ (quality 0..3),
 *      uZFar, uHits[8] (x, y, z, strength) and uHitN; helpers hdHash, hdHash2, hdHash3, hdNoise, hdNoise3,
 *      hdFbm, hdVoronoi, hdFresnel, hdFade, hdFog (see LIB below); the floor also has hdLine(d, w, fw)
 *      for lines that stay smooth at any distance.
 *
 * Rules: same places and sizes as Classic (the highway passes positions in; never move them); labels are
 * drawn after everything and are never touched; nothing is built or compiled mid-song (use() compiles every
 * program before the style shows); no garbage per frame (reuse arrays, no closures or object literals in
 * frame/onHit loops); quality 0..3 and uFx/uMotion scale the cost and the movement.
 * Budget at High on a GTX 1070, 1920x1080: about 4 ms of graphics time for the whole style (floor shader
 * ≤ ~250 ALU per pixel, ≤ 4000 live particles, ≤ 15 extra draw calls). Low: a quarter of the particles,
 * simplest surface (uQ = 0), no shimmer.
 */
import * as THREE from '../vendor/three/three.module.min.js';

// --------------------------------------------------------------- shader library --
export const LIB = /* glsl */ `
uniform float uTime;
uniform float uSong;
uniform float uZs;
uniform float uPulse;
uniform float uHeat;
uniform float uFx;
uniform float uMotion;
uniform float uQ;
uniform float uZFar;
uniform float uZPast;
uniform float uGain;
uniform float uFogK;
uniform vec3 uFogCol;
uniform vec4 uHits[8];
uniform float uHitN;
uniform vec3 uCamPos;
uniform float uOwn;      // 1: the style's own room is behind; 0: a venue picture or moving background (keep the sides clear)
float hdHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hdHash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float hdHash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hdNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hdHash(i), hdHash(i + vec2(1.0, 0.0)), u.x), mix(hdHash(i + vec2(0.0, 1.0)), hdHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float hdNoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hdHash3(i), hdHash3(i + vec3(1, 0, 0)), u.x), mix(hdHash3(i + vec3(0, 1, 0)), hdHash3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hdHash3(i + vec3(0, 0, 1)), hdHash3(i + vec3(1, 0, 1)), u.x), mix(hdHash3(i + vec3(0, 1, 1)), hdHash3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
// fractal noise, oct octaves (2..6), each turned a little so no grid shows
float hdFbm(vec2 p, float oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) {
    if (float(i) >= oct) break;
    s += a * hdNoise(p); n += a; p = m * p; a *= 0.5;
  }
  return s / n;
}
// cells: x = distance to the nearest centre, y = distance to the nearest border (smooth, exact), z = the cell's id (0..1)
vec3 hdVoronoi(vec2 p) {
  vec2 n = floor(p); vec2 f = fract(p);
  vec2 mg = vec2(0.0), mr = vec2(0.0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = hdHash2(n + g) * 0.8 + 0.1; vec2 r = g + o - f; float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float bd = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j)); vec2 o = hdHash2(n + g) * 0.8 + 0.1; vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) bd = min(bd, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec3(sqrt(md), bd, hdHash(n + mg));
}
float hdFresnel(vec3 n, vec3 v, float p) { return pow(1.0 - clamp(dot(n, v), 0.0, 1.0), p); }
// far things fade into the distance, things past the neck fade quickly (as the rest of the highway)
float hdFade(float z) {
  float f = clamp((uZFar - z) / (uZFar * 0.3), 0.0, 1.0);
  if (z < 0.0) f *= clamp(1.0 + z / uZPast, 0.0, 1.0);
  return f;
}
vec3 hdFog(vec3 c, float z) { return mix(c, uFogCol, uFogK * smoothstep(0.05, 0.85, z / uZFar)); }
`;

// The vertex side of each part, and the struct its style function receives.
const FLOOR_VS = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = vec3(w.x, w.y, -w.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FLOOR_FS = (glsl) => /* glsl */ `
${LIB}
#define MAXL 8
#define MAXB 40
uniform vec4 uLanes[MAXL]; // za, zb, xa, xb of each hand position on the highway
uniform float uLaneN;
uniform vec2 uBeats[MAXB]; // z, 1 = bar / 0.4 = beat
uniform float uBeatN;
uniform float uRatio;      // the fret spacing (each fret this much narrower)
varying vec3 vW;
struct HDFloor {
  vec2 p;        // world x across, z ahead (time ahead × uZs)
  float track;   // z fixed to the song: moves toward you with the notes (z + uSong × uZs)
  vec2 fw;       // how much p changes per pixel here (for smooth, unjagged lines)
  float lane;    // distance to the hand position's edge (negative inside), world units
  float inLane;  // 0..1, softened by a pixel
  float laneW;   // its width here
  float laneU;   // across it, 0 at its left edge, 1 at its right
  float cur;     // 1 in the hand position you are in now, 0 in coming ones
  float fret;    // distance to the nearest fret line, world units
  float fretN;   // which fret line that is
  float beat;    // a beat line's strength here, already smoothed (bars 1, beats 0.4)
  float z01;     // z / uZFar
};
float hdLine(float d, float w, float fw) { return 1.0 - smoothstep(w - fw, w + fw, abs(d)); }
${glsl}
void main() {
  HDFloor f;
  f.p = vec2(vW.x, vW.z);
  f.track = vW.z + uSong * uZs;
  f.fw = max(fwidth(f.p), vec2(1e-4));
  f.z01 = vW.z / uZFar;
  f.lane = 1e3; f.inLane = 0.0; f.laneW = 1.0; f.laneU = 0.5; f.cur = 0.0;
  for (int i = 0; i < MAXL; i++) {
    if (float(i) >= uLaneN) break;
    vec4 L = uLanes[i];
    if (vW.z >= L.x && vW.z < L.y) {
      float d = max(L.z - vW.x, vW.x - L.w);
      f.lane = d; f.laneW = L.w - L.z; f.laneU = (vW.x - L.z) / f.laneW; f.cur = i == 0 ? 1.0 : 0.0;
      f.inLane = 1.0 - smoothstep(-f.fw.x, f.fw.x, d);
    }
  }
  // the fret lines (the same spacing as the neck: x = (1 - r^f) / (1 - r))
  float fr = vW.x < 0.0 ? vW.x : log(max(1e-6, 1.0 - vW.x * (1.0 - uRatio))) / log(uRatio);
  f.fretN = floor(fr + 0.5);
  float xf = f.fretN < 0.0 ? f.fretN : (1.0 - pow(uRatio, f.fretN)) / (1.0 - uRatio);
  f.fret = vW.x - xf;
  f.beat = 0.0;
  for (int i = 0; i < MAXB; i++) {
    if (float(i) >= uBeatN) break;
    vec2 b = uBeats[i];
    f.beat = max(f.beat, b.y * hdLine(vW.z - b.x, mix(0.015, 0.03, b.y), f.fw.y));
  }
  vec4 c = hdFloor(f);
  float a = c.a * hdFade(vW.z);
  if (a < 0.003) discard;
  gl_FragColor = vec4(hdFog(c.rgb * uGain, vW.z), a);
}`;

const SKY_VS = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.999, 1.0); }`;
const SKY_FS = (glsl) => /* glsl */ `
${LIB}
uniform mat4 uInvVP;
uniform vec2 uRes;    // CSS pixels
uniform float uVp;    // the horizon (CSS px from the top)
uniform float uVx;    // where the floor's lines meet (CSS px from the left)
varying vec2 vNdc;
struct HDSky {
  vec2 p;      // CSS pixels from the top left
  vec2 res;
  float vp;    // horizon height (CSS px from the top)
  float vx;
  vec3 ro;     // the camera (world: x across, y up, z ahead)
  vec3 rd;     // the view ray through this pixel (normalised, same axes)
  float up;    // rd.y
};
${glsl}
void main() {
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
  a /= a.w; b /= b.w;
  vec3 rd = normalize(b.xyz - a.xyz);
  HDSky s;
  s.res = uRes;
  s.p = vec2((vNdc.x * 0.5 + 0.5) * uRes.x, (0.5 - vNdc.y * 0.5) * uRes.y);
  s.vp = uVp; s.vx = uVx;
  s.ro = vec3(a.x, a.y, -a.z);
  s.rd = vec3(rd.x, rd.y, -rd.z);
  s.up = s.rd.y;
  gl_FragColor = vec4(hdSky(s) * uGain, 1.0);
}`;

const GEM_VS = /* glsl */ `
attribute vec3 aIn;      // the box's corner side (-1..1)
attribute vec4 iA;       // x, y, z (front, time ahead), kind (0 note, 1 open string, 2 chord frame bar)
attribute vec4 iB;       // half width, half height, depth, corner radius
attribute vec4 iC;       // colour, missed
attribute vec4 iD;       // near (0..1 as it reaches the neck), flare, fade, flags (1 accent, 2 mute, 4 bend, 8 in a chord)
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;        // where on the box (-1..1 each way; z -1 at the front)
varying vec3 vWp;
varying vec4 vC;
varying vec4 vD;
varying float vKind;
varying vec2 vHalf;
varying vec3 vNl;
void main() {
  vNl = normal;
  vec3 hs = vec3(iB.x, iB.y, iB.z * 0.5);
  float r = min(iB.w, min(hs.x, min(hs.y, hs.z)));
  vec3 lp = aIn * (hs - r) + normal * r;
  vec3 wp = vec3(iA.x, iA.y, iA.z + hs.z) + lp;
  vec4 mv = modelViewMatrix * vec4(wp.x, wp.y, -wp.z, 1.0);
  vN = normalize(normalMatrix * vec3(normal.x, normal.y, -normal.z));
  vV = normalize(-mv.xyz);
  vL = lp / hs;
  vWp = wp;
  vC = iC; vD = iD; vKind = iA.w; vHalf = hs.xy;
  gl_Position = projectionMatrix * mv;
}`;
const GEM_FS = (glsl) => /* glsl */ `
${LIB}
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec3 vWp;
varying vec4 vC;
varying vec4 vD;
varying float vKind;
varying vec2 vHalf;
varying vec3 vNl;
struct HDGem {
  vec3 n;      // normal (view space: x right, y up, z toward you)
  vec3 nl;     // normal on the box itself (z -1 is the face toward you); flat faces have one axis at ±1
  vec3 v;      // toward the eye (view space)
  vec3 l;      // where on the box, -1..1 each way (l.z = -1 is the face toward you)
  vec3 wp;     // world position (z = time ahead)
  vec3 col;    // the string's colour
  float missed, near, flare, fade, kind;
  float accent, mute, bend, chord;
  vec2 size;   // half width and height (world units)
};
${glsl}
void main() {
  HDGem g;
  g.n = normalize(vN); g.nl = normalize(vNl); g.v = normalize(vV); g.l = vL; g.wp = vWp; g.col = vC.rgb; g.missed = vC.a;
  g.near = vD.x; g.flare = vD.y; g.fade = vD.z; g.kind = vKind; g.size = vHalf;
  float fl = vD.w;
  g.accent = mod(fl, 2.0); g.mute = mod(floor(fl / 2.0), 2.0); g.bend = mod(floor(fl / 4.0), 2.0); g.chord = mod(floor(fl / 8.0), 2.0);
  vec4 c = hdGem(g);
  float a = c.a * vD.z * hdFade(vWp.z);
  if (a < 0.003) discard;
  gl_FragColor = vec4(hdFog(c.rgb * uGain, vWp.z), a);
}`;

const TUBE_VS = /* glsl */ `
attribute vec3 aT;        // along (0 start, 1 end), cap (-1..1 past the ends, in radii), round (1 on the side)
attribute vec4 iP0;       // start x, y, z, radius
attribute vec4 iP1;       // end x, y, z, kind (0 string, 1 fret wire, 2 nut, 3 light post)
attribute vec4 iC;        // colour, glow (a hit: 0..1)
attribute vec4 iE;        // which string (0..5), wound (0/1), along offset, spare
varying vec3 vN;
varying vec3 vV;
varying vec3 vWp;
varying vec4 vC;
varying vec4 vE;
varying float vAlong;
varying float vAround;
varying float vKind;
varying float vR;
void main() {
  vec3 a = iP0.xyz;
  vec3 b = iP1.xyz;
  vec3 ax = b - a;
  float len = max(length(ax), 1e-5);
  vec3 t = ax / len;
  vec3 up = abs(t.y) > 0.9 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
  vec3 s1 = normalize(cross(t, up));
  vec3 s2 = cross(s1, t);
  float r = iP0.w;
  // position.xy is the round direction (cos, sin); aT.y pushes past the ends as a round cap
  vec3 nrm = normalize(s1 * position.x * aT.z + s2 * position.y * aT.z + t * aT.y);
  vec3 wp = mix(a, b, aT.x) + nrm * r;
  vec4 mv = modelViewMatrix * vec4(wp.x, wp.y, -wp.z, 1.0);
  vN = normalize(normalMatrix * vec3(nrm.x, nrm.y, -nrm.z));
  vV = normalize(-mv.xyz);
  vWp = wp; vC = iC; vE = iE; vKind = iP1.w; vR = r;
  vAlong = iE.z + aT.x * len + aT.y * r;
  vAround = atan(position.y, position.x);
  gl_Position = projectionMatrix * mv;
}`;
const TUBE_FS = (glsl) => /* glsl */ `
${LIB}
varying vec3 vN;
varying vec3 vV;
varying vec3 vWp;
varying vec4 vC;
varying vec4 vE;
varying float vAlong;
varying float vAround;
varying float vKind;
varying float vR;
struct HDTube {
  vec3 n; vec3 v;   // view space
  vec3 wp;          // world (z = time ahead)
  vec3 col;         // its colour (a string's own colour; frets: steel)
  float glow;       // a hit lighting it (0..1)
  float kind;       // 0 string, 1 fret wire, 2 nut, 3 light post (a note landing / a hit)
  float str;        // which string (0 = low)
  float wound;      // 1 for wound strings
  float along;      // world units along it (for windings, flowing light)
  float around;     // angle around it
  float r;          // radius
};
${glsl}
void main() {
  HDTube t;
  t.n = normalize(vN); t.v = normalize(vV); t.wp = vWp; t.col = vC.rgb; t.glow = vC.a; t.kind = vKind;
  t.str = vE.x; t.wound = vE.y; t.along = vAlong; t.around = vAround; t.r = vR;
  vec4 c = hdTube(t);
  float a = c.a * hdFade(vWp.z);
  if (a < 0.003) discard;
  gl_FragColor = vec4(c.rgb * uGain, a);
}`;

const TRAIL_VS = /* glsl */ `
attribute vec4 hA;   // across (-1..1 is the ribbon, beyond it the glow), song time, holding, bend lift
attribute vec4 hC;   // colour, missed
varying vec4 vA;
varying vec4 vC;
varying vec3 vWp;
void main() {
  vA = hA; vC = hC;
  vWp = vec3(position.x, position.y, -position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FS = (glsl, add) => /* glsl */ `
${LIB}
varying vec4 vA;
varying vec4 vC;
varying vec3 vWp;
struct HDTrail {
  float u;       // across: -1..1 is the ribbon itself, out to ±W the soft glow round it (W = TRAIL_WIDE)
  float t;       // song time at this point (fixed to the note: patterns travel with it)
  float holding; // 1 while you hold it
  float lift;    // how far it is bent (0..1)
  vec3 col;      // the string's colour
  float missed;
  vec3 wp;
  float fu;      // how much u changes per pixel
};
${glsl}
void main() {
  HDTrail r;
  r.u = vA.x; r.t = vA.y; r.holding = vA.z; r.lift = vA.w; r.col = vC.rgb; r.missed = vC.a; r.wp = vWp; r.fu = max(fwidth(vA.x), 1e-4);
  vec4 c = hdTrail(r);
  float a = c.a * hdFade(vWp.z);
  ${add ? 'gl_FragColor = vec4(c.rgb * a * uGain, 0.0);' : 'if (a < 0.003) discard; gl_FragColor = vec4(hdFog(c.rgb * uGain, vWp.z), a);'}
}`;

// particles: everything worked out on the graphics card from where and when each was born
const PART_VS = /* glsl */ `
uniform float uNow;       // the particles' own clock (s)
uniform float uScale;     // pixels per world unit at distance 1 (for sizes)
attribute vec2 aCorner;   // -1..1 corner of the little square
attribute vec4 iP;        // birth x, y, z, birth time
attribute vec4 iV;        // velocity x, y, z, life (s)
attribute vec4 iAc;       // acceleration x, y, z, drag
attribute vec4 iC0;       // colour at birth, alpha
attribute vec4 iC1;       // colour at death, stretch (streaks: how long the tail is, in seconds of travel)
attribute vec4 iS;        // size at birth, size at death, seed, shape (0 dot, 1 streak, 2 flake, 3 ring, 4 smoke)
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vSeed;
varying float vAge;
vec3 at(float t) {
  // drag: velocity falls off as e^(-drag t); acceleration (gravity, lift) adds on top
  float d = max(iAc.w, 1e-4);
  float k = (1.0 - exp(-d * t)) / d;
  return iP.xyz + iV.xyz * k + 0.5 * iAc.xyz * t * t;
}
void main() {
  float age = uNow - iP.w;
  float life = iV.w;
  vAge = age / life;
  if (age < 0.0 || age > life) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float u = age / life;
  vec3 p = at(age);
  // a gentle swirl of warm air (the same for every particle at a place, so they move together)
  p.x += sin(p.y * 2.1 + uNow * 1.3 + iS.z * 6.0) * 0.06 * u;
  float size = mix(iS.x, iS.y, u);
  vCol = vec4(mix(iC0.rgb, iC1.rgb, u), iC0.a * smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.6, 1.0, u)));
  vShape = iS.w; vSeed = iS.z; vUv = aCorner;
  vec4 c = modelViewMatrix * vec4(p.x, p.y, -p.z, 1.0);
  vec2 off = aCorner * size;
  if (iS.w > 0.5 && iS.w < 1.5) {
    // a streak: stretched along the way it is moving on screen
    vec3 q = at(max(0.0, age - iC1.w));
    vec4 c2 = modelViewMatrix * vec4(q.x, q.y, -q.z, 1.0);
    vec2 dir = c.xy - c2.xy;
    float L = length(dir);
    vec2 t = L > 1e-5 ? dir / L : vec2(0.0, 1.0);
    vec2 nn = vec2(-t.y, t.x);
    c.xy += nn * aCorner.x * size + t * (aCorner.y * (L * 0.5 + size)) - dir * 0.5;
  } else c.xy += off;
  gl_Position = projectionMatrix * c;
}`;
// ambient fields: a fixed set that loops through a box around the highway, with no work on the processor
const FIELD_VS = /* glsl */ `
uniform float uNow;
uniform vec3 uBox0;      // the box (x relative to the camera, y, z ahead) …
uniform vec3 uBox1;
uniform vec3 uVel;       // how they drift (units per second)
uniform vec2 uSize;      // size near, far
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uAlpha;
uniform float uSway;
uniform float uShape;
uniform float uCount;    // how many of them show (the quality's share)
uniform float uCamX;
attribute vec2 aCorner;
attribute vec4 iR;       // four randoms per particle
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vSeed;
varying float vAge;
void main() {
  if (float(gl_InstanceID) >= uCount) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec3 span = uBox1 - uBox0;
  vec3 travel = uVel * uNow;
  vec3 p = uBox0 + fract(iR.xyz + travel / span) * span;
  // each one fades in and out as it wraps, so nothing pops
  vec3 w = fract(iR.xyz + travel / span);
  float edge = min(min(w.y, 1.0 - w.y), min(w.z, 1.0 - w.z)) * 8.0;
  p.x += uCamX + sin(uNow * (0.5 + iR.w) + iR.x * 40.0) * uSway;
  p.z += cos(uNow * (0.4 + iR.y) + iR.w * 30.0) * uSway * 0.5;
  float tw = 0.6 + 0.4 * sin(uNow * (1.5 + iR.w * 3.0) + iR.z * 50.0);
  vCol = vec4(mix(uColA, uColB, iR.w), uAlpha * clamp(edge, 0.0, 1.0) * tw);
  vShape = uShape; vSeed = iR.w; vUv = aCorner; vAge = w.y;
  vec4 c = modelViewMatrix * vec4(p.x, p.y, -p.z, 1.0);
  c.xy += aCorner * mix(uSize.x, uSize.y, iR.z);
  gl_Position = projectionMatrix * c;
}`;
const SPRITE_DEFAULT = /* glsl */ `
vec4 hdSprite(HDSprite p) {
  float d = length(p.uv);
  float a;
  if (p.shape > 0.5 && p.shape < 1.5) a = (1.0 - smoothstep(0.0, 1.0, abs(p.uv.x))) * (1.0 - smoothstep(0.6, 1.0, abs(p.uv.y)));
  else if (p.shape > 2.5 && p.shape < 3.5) a = smoothstep(0.55, 0.8, d) * (1.0 - smoothstep(0.85, 1.0, d)) + 0.15 * (1.0 - d);
  else if (p.shape > 3.5) a = (1.0 - smoothstep(0.0, 1.0, d)) * 0.5;
  else a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
  return vec4(p.col.rgb * a * p.col.a, 0.0);
}`;
const PART_FS = (glsl) => /* glsl */ `
${LIB}
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vSeed;
varying float vAge;
struct HDSprite { vec2 uv; vec4 col; float shape; float seed; float age; };
${glsl || SPRITE_DEFAULT}
void main() {
  HDSprite p; p.uv = vUv; p.col = vCol; p.shape = vShape; p.seed = vSeed; p.age = vAge;
  vec4 c = hdSprite(p);
  if (c.r + c.g + c.b + c.a < 0.002) discard;
  gl_FragColor = vec4(c.rgb * uGain, c.a);
}`;

// --------------------------------------------------------------- geometry --
/** A box with round edges, any size (the size is set per note in the shader, so the rounding stays even). */
function roundedBox(m) {
  const r0 = 0.5;
  const cs = [];
  for (let i = 0; i <= m; i++) cs.push(-1 + (r0 * i) / m);
  for (let i = 0; i <= m; i++) cs.push(1 - r0 + (r0 * i) / m);
  const pos = [];
  const nrm = [];
  const idx = [];
  const N = cs.length;
  // each face: axis a fixed at ±1, the other two run over the grid
  for (const [a, b, c, sg] of [[0, 1, 2, 1], [0, 2, 1, -1], [1, 2, 0, 1], [1, 0, 2, -1], [2, 0, 1, 1], [2, 1, 0, -1]]) {
    const base = pos.length / 3;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = [0, 0, 0];
      v[a] = sg;
      v[b] = cs[i];
      v[c] = cs[j];
      const inner = v.map((x) => Math.max(-(1 - r0), Math.min(1 - r0, x)));
      const off = v.map((x, k) => x - inner[k]);
      const L = Math.hypot(...off) || 1;
      pos.push(...inner.map((x) => x / (1 - r0)));
      nrm.push(...off.map((x) => x / L));
    }
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const p = base + j * N + i;
      // (b, c) are ordered so b × c points out of every face; wound the other way round because z is
      // turned round for three.js (a mirror)
      idx.push(p, p + N + 1, p + 1, p, p + N, p + N + 1);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aIn', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** A tube with round caps: `seg` round the side; the length and radius are set per piece in the shader. */
function capsule(seg) {
  const pos = [];
  const at = [];
  const idx = [];
  // rings: [along 0/1, cap push (radii), side scale]
  const rings = [[0, -1, 0.0001], [0, -0.7, 0.71], [0, 0, 1], [1, 0, 1], [1, 0.7, 0.71], [1, 1, 0.0001]];
  for (const [t, c, k] of rings) for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pos.push(Math.cos(a), Math.sin(a), 0);
    at.push(t, c, k);
  }
  const n = seg + 1;
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < seg; i++) {
    const p = r * n + i;
    idx.push(p, p + 1, p + n, p + 1, p + n + 1, p + n); // outside out once z is turned round for three.js
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 3));
  g.setIndex(idx);
  return g;
}

function corners() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Instance data that grows when needed and only sends what changed. */
class Batch {
  constructor(geo, names, cap) {
    this.geo = geo;
    this.names = names;
    this.cap = 0;
    this.n = 0;
    this.attrs = {};
    this.grow(cap);
  }
  grow(cap) {
    const old = this.attrs;
    this.cap = cap;
    for (const nm of this.names) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      if (old[nm]) a.array.set(old[nm].array);
      this.attrs[nm] = a;
      this.geo.setAttribute(nm, a);
    }
    this.arr = this.names.map((nm) => this.attrs[nm].array);
  }
  /** Room for one more; returns its offset into each array (×4). */
  next() {
    if (this.n >= this.cap) this.grow(this.cap * 2);
    return this.n++ * 4;
  }
  send() {
    for (const nm of this.names) {
      const a = this.attrs[nm];
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * 4);
      a.needsUpdate = true;
    }
    this.geo.instanceCount = this.n;
  }
}

// colours as numbers, made once per hex (no garbage while playing)
const RGB = new Map();
export function rgbOf(hex) {
  let c = RGB.get(hex);
  if (!c) {
    const n = parseInt(String(hex).slice(1), 16);
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    RGB.set(hex, c);
  }
  return c;
}

const QK = [0.25, 0.5, 1, 1.5]; // particles per quality step (Low, Medium, High, Ultra)
const STYLES = {}; // loaded style modules by id

/**
 * The engine for the highway (one per highway). R3 is the 3D renderer (highway3d.js); ratio is the fret
 * spacing. Nothing is drawn until a style with `hd` is in use and every program is compiled.
 */
export function createHD(R3, { ratio }) {
  const { scene, renderer, camera } = R3;
  const U = {
    uTime: { value: 0 }, uSong: { value: 0 }, uZs: { value: 16 }, uPulse: { value: 0 }, uHeat: { value: 0 },
    uFx: { value: 1 }, uMotion: { value: 1 }, uQ: { value: 2 }, uZFar: { value: 40 }, uZPast: { value: 1 },
    uGain: { value: 1 }, uFogK: R3.lookU.fogK, uFogCol: R3.lookU.fogCol,
    uHits: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uHitN: { value: 0 },
    uCamPos: { value: new THREE.Vector3() }, uOwn: { value: 1 },
  };
  const lanes = Array.from({ length: 8 }, () => new THREE.Vector4());
  const beats = Array.from({ length: 40 }, () => new THREE.Vector2());
  const floorU = { uLanes: { value: lanes }, uLaneN: { value: 0 }, uBeats: { value: beats }, uBeatN: { value: 0 }, uRatio: { value: ratio } };
  const skyU = { uInvVP: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) }, uVp: { value: 300 }, uVx: { value: 0 } };
  const partU = { uNow: { value: 0 }, uScale: { value: 1 } };
  const t0 = performance.now();

  let cur = null; // the style in use (built, compiled): { id, def, parts, meshes }
  let want = null;
  let loading = 0;
  const hits = []; // the last 8 hits: { x, y, z, at, until, k }
  for (let i = 0; i < 8; i++) hits.push({ x: 0, y: 0, z: 0, at: -1e9, until: 0, k: 0 });
  let hitI = 0;
  const hazeSpots = new Float32Array(16);
  let F = null; // the frame's info (kept, reused)
  const holds = new Float32Array(24);
  let lastTime = 0;

  const mat = (vs, fs, uniforms, o = {}) => new THREE.ShaderMaterial({
    vertexShader: vs,
    fragmentShader: fs,
    uniforms: { ...U, ...uniforms },
    transparent: true,
    depthWrite: !!o.depthWrite,
    depthTest: o.depthTest !== false,
    side: o.side || THREE.FrontSide,
    // add: the shader's colour is added as it is (light), alpha ignored
    blending: o.add ? THREE.CustomBlending : THREE.NormalBlending,
    ...(o.add ? { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } : {}),
  });
  const addMesh = (geo, m, order) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  };

  /** Builds a style's meshes and materials (not shown yet). */
  function build(id, buildFn) {
    const parts = { id, meshes: [], emitters: [], fields: [] };
    const K = {
      THREE,
      LIB,
      rgb: rgbOf,
      /** A burst source: spec = { max, life: [a, b], speed: [a, b], up (0..1, how much it goes up), spread (radians), toward (z speed), accel: [x, y, z], drag, size: [birth, death], shape, stretch, colA, colB (rgb arrays or null for the hit's colour), alpha } */
      emitter(spec) {
        const e = { spec, n: 0, at: 0 };
        parts.emitters.push(e);
        e.burst = (x, y, z, n, rgb, k = 1) => burst(e, x, y, z, n, rgb, k);
        return e;
      },
      /** Ambient drift: spec = { count, box: [x0, x1, y0, y1, z0, z1] (x around the camera), vel: [x, y, z], size: [a, b], colA, colB, alpha, sway, shape, order, add } */
      field(spec) {
        const f = { spec };
        parts.fields.push(f);
        return f;
      },
    };
    const def = buildFn(K) || {};
    parts.def = def;
    if (def.floor) {
      const m = mat(FLOOR_VS, FLOOR_FS(def.floor.glsl), { ...floorU, ...(def.floor.uniforms || {}) }, {});
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2); // lying flat: x across, z (three's) ahead is negative
      parts.floor = addMesh(g, m, 0);
      parts.floor.renderOrder = -1;
      parts.meshes.push(parts.floor);
    }
    if (def.sky) {
      const m = mat(SKY_VS, SKY_FS(def.sky.glsl), { ...skyU, ...(def.sky.uniforms || {}) }, { depthTest: false });
      m.transparent = false;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      parts.sky = addMesh(g, m, -10);
      parts.meshes.push(parts.sky);
    }
    if (def.gem) {
      const geo = roundedBox(3);
      parts.gems = new Batch(geo, ['iA', 'iB', 'iC', 'iD'], 256);
      parts.gemMesh = addMesh(geo, mat(GEM_VS, GEM_FS(def.gem.glsl), def.gem.uniforms || {}, { depthWrite: true }), 2);
      parts.meshes.push(parts.gemMesh);
    }
    if (def.tube) {
      const geo = capsule(12);
      parts.tubes = new Batch(geo, ['iP0', 'iP1', 'iC', 'iE'], 128);
      parts.tubeMesh = addMesh(geo, mat(TUBE_VS, TUBE_FS(def.tube.glsl), def.tube.uniforms || {}, { depthWrite: true }), 2);
      parts.meshes.push(parts.tubeMesh);
    }
    if (def.trail) {
      parts.trail = makeStrip(mat(TRAIL_VS, TRAIL_FS(def.trail.glsl, def.trail.add), def.trail.uniforms || {}, { add: def.trail.add, side: THREE.DoubleSide }));
      parts.meshes.push(parts.trail.mesh);
    }
    // particles: one pool for every emitter (born into a ring, nothing else sent)
    if (parts.emitters.length) {
      const max = Math.max(...parts.emitters.map((e) => e.spec.max || 512)) * parts.emitters.length;
      const geo = corners();
      parts.parts = new Batch(geo, ['iP', 'iV', 'iAc', 'iC0', 'iC1', 'iS'], Math.round(max * 1.5));
      parts.parts.n = parts.parts.cap;
      parts.ring = 0;
      parts.dirty0 = parts.parts.cap; // lowest written slot since the last send
      parts.dirty1 = 0;
      for (const a of parts.parts.arr) a.fill(0);
      for (let i = 0; i < parts.parts.cap; i++) parts.parts.arr[1][i * 4 + 3] = 1e-3; // dead at birth
      for (let i = 0; i < parts.parts.cap; i++) parts.parts.arr[0][i * 4 + 3] = -1e6;
      parts.parts.send();
      const m = mat(PART_VS, PART_FS(def.sprite && def.sprite.glsl), partU, { add: true });
      parts.partMesh = addMesh(geo, m, 6);
      parts.meshes.push(parts.partMesh);
    }
    for (const f of parts.fields) {
      const s = f.spec;
      const geo = corners();
      const n = Math.round(s.count * QK[3]);
      const R = new Float32Array(n * 4);
      for (let i = 0; i < R.length; i++) R[i] = Math.random();
      geo.setAttribute('iR', new THREE.InstancedBufferAttribute(R, 4));
      geo.instanceCount = n;
      const fu = {
        uNow: partU.uNow, uBox0: { value: new THREE.Vector3(s.box[0], s.box[2], s.box[4]) }, uBox1: { value: new THREE.Vector3(s.box[1], s.box[3], s.box[5]) },
        uVel: { value: new THREE.Vector3(...s.vel) }, uSize: { value: new THREE.Vector2(...s.size) }, uColA: { value: new THREE.Color(...rgbOf(s.colA)) }, uColB: { value: new THREE.Color(...rgbOf(s.colB || s.colA)) },
        uAlpha: { value: s.alpha ?? 1 }, uSway: { value: s.sway ?? 0.2 }, uShape: { value: s.shape ?? 0 }, uCount: { value: n }, uCamX: { value: 0 },
      };
      f.u = fu;
      f.max = n;
      f.mesh = addMesh(geo, mat(FIELD_VS, PART_FS(def.sprite && def.sprite.glsl), fu, { add: s.add !== false }), s.order ?? 6);
      parts.meshes.push(f.mesh);
    }
    return parts;
  }

  function makeStrip(m) {
    const geo = new THREE.BufferGeometry();
    const S = { geo, cap: 0, n: 0, mesh: null };
    S.grow = (q) => {
      const cap = Math.max(q, S.cap * 2);
      const pos = new Float32Array(cap * 12);
      const a = new Float32Array(cap * 16);
      const c = new Float32Array(cap * 16);
      if (S.pos) {
        pos.set(S.pos);
        a.set(S.a);
        c.set(S.c);
      }
      const idx = new Uint32Array(cap * 6);
      for (let i = 0; i < cap; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      Object.assign(S, { pos, a, c, cap });
      S.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
      S.aA = new THREE.BufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage);
      S.aC = new THREE.BufferAttribute(c, 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', S.aPos);
      geo.setAttribute('hA', S.aA);
      geo.setAttribute('hC', S.aC);
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    };
    S.grow(2048);
    S.mesh = addMesh(geo, m, 3);
    return S;
  }

  // a fixed random sequence for bursts (the same hit always looks the same)
  let seed = 1;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lerp = (r, a, b) => a + (b - a) * r;
  let burstAgo = 0;
  function burst(e, x, y, z, n, rgb, k) {
    const p = cur;
    if (!p || !p.parts || !F) return;
    const s = e.spec;
    const count = Math.round(n * QK[F.quality] * F.fxK);
    const B = p.parts;
    const [P, V, Ac, C0, C1, S] = B.arr;
    const now = F.time - burstAgo;
    for (let i = 0; i < count; i++) {
      const o = p.ring * 4;
      if (p.ring < p.dirty0) p.dirty0 = p.ring;
      if (p.ring + 1 > p.dirty1) p.dirty1 = p.ring + 1;
      p.ring = (p.ring + 1) % B.cap;
      const ang = Math.PI / 2 + (rnd() - 0.5) * (s.spread ?? 2.6);
      const sp = lerp(rnd(), s.speed[0], s.speed[1]) * (0.6 + 0.4 * k);
      const up = s.up ?? 1;
      P[o] = x + (rnd() - 0.5) * (s.jitter || 0);
      P[o + 1] = y + (rnd() - 0.5) * (s.jitter || 0) * 0.5;
      P[o + 2] = z;
      P[o + 3] = now + rnd() * (s.stagger || 0);
      V[o] = Math.cos(ang) * sp;
      V[o + 1] = Math.sin(ang) * sp * up;
      V[o + 2] = lerp(rnd(), (s.toward || [0, 0])[0], (s.toward || [0, 0])[1]);
      V[o + 3] = lerp(rnd(), s.life[0], s.life[1]);
      const ac = s.accel || ZERO3;
      Ac[o] = ac[0];
      Ac[o + 1] = ac[1];
      Ac[o + 2] = ac[2];
      Ac[o + 3] = s.drag || 0;
      const a = s.colA || rgb;
      const b = s.colB || rgb;
      const mixA = s.tintA ?? 0; // how much of the hit's colour is in the birth colour
      C0[o] = a[0] + (rgb[0] - a[0]) * mixA;
      C0[o + 1] = a[1] + (rgb[1] - a[1]) * mixA;
      C0[o + 2] = a[2] + (rgb[2] - a[2]) * mixA;
      C0[o + 3] = (s.alpha ?? 1) * Math.min(1, k);
      const mixB = s.tintB ?? 0;
      C1[o] = b[0] + (rgb[0] - b[0]) * mixB;
      C1[o + 1] = b[1] + (rgb[1] - b[1]) * mixB;
      C1[o + 2] = b[2] + (rgb[2] - b[2]) * mixB;
      C1[o + 3] = s.stretch || 0.04;
      const sz = lerp(rnd(), 0.75, 1.25);
      S[o] = s.size[0] * sz;
      S[o + 1] = s.size[1] * sz;
      S[o + 2] = rnd();
      S[o + 3] = s.shape || 0;
    }
  }
  const ZERO3 = [0, 0, 0];

  function sendParticles(p) {
    if (!p.parts || p.dirty1 <= p.dirty0) return;
    for (const nm of p.parts.names) {
      const a = p.parts.attrs[nm];
      a.clearUpdateRanges();
      a.addUpdateRange(p.dirty0 * 4, (p.dirty1 - p.dirty0) * 4);
      a.needsUpdate = true;
    }
    p.dirty0 = p.parts.cap;
    p.dirty1 = 0;
  }

  async function load(id) {
    if (!STYLES[id]) STYLES[id] = (await import(`./styles/${id}.js`)).default;
    return STYLES[id];
  }

  /** Every program compiled before the style shows (in the background where the graphics driver can). */
  async function warm(parts) {
    // on a scene of their own, so nothing half-ready is ever drawn
    const tmp = new THREE.Scene();
    for (const m of parts.meshes) {
      m.visible = true;
      tmp.add(m);
    }
    try {
      if (renderer.compileAsync) await renderer.compileAsync(tmp, camera, scene);
      else renderer.compile(tmp, camera, scene);
    } catch (err) {
      console.error('HD style: compile', err);
    }
    for (const m of parts.meshes) {
      m.visible = false;
      scene.add(m);
    }
  }

  function drop(p) {
    if (!p) return;
    for (const m of p.meshes) {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }

  const E = {
    /** The style in use, built and compiled (null: draw the usual way). */
    get on() {
      return !!cur;
    },
    get style() {
      return cur ? cur.def : null;
    },
    get id() {
      return cur ? cur.id : null;
    },
    /** What the style draws itself. */
    owns(part) {
      return !!(cur && cur.def[part]);
    },
    /** A look (hwlooks.resolveLook) came in: load and warm its style, or stop. */
    use(LK) {
      const id = LK && LK.hd;
      if (id === want) return;
      want = id || null;
      if (!want) {
        drop(cur);
        cur = null;
        R3.skyOwn(false);
        R3.setHaze(0, null);
        return;
      }
      const ticket = ++loading;
      load(want)
        .then(async (fn) => {
          if (ticket !== loading) return;
          if (typeof fn !== 'function') throw new Error('not a style');
          const parts = build(want, fn);
          await warm(parts);
          if (ticket !== loading) return drop(parts);
          drop(cur);
          cur = parts;
          E.ready = true;
        })
        .catch((err) => {
          console.error('HD style: could not load', want, err);
          if (ticket === loading) want = null;
        });
    },
    /** Nothing of the style shows this frame (no highway: karaoke, piano, no song). */
    hide() {
      if (!cur) return;
      for (const m of cur.meshes) m.visible = false;
      R3.skyOwn(false);
      R3.setHaze(0, null);
    },
    /** A promise for tests: resolves when the wanted style is in use. */
    whenReady() {
      return new Promise((res) => {
        const t = setInterval(() => {
          if (!want || (cur && cur.id === want)) {
            clearInterval(t);
            res(!!cur);
          }
        }, 30);
      });
    },
    /**
     * The start of a frame. f: { t (song s), zs, zFar, zPast, pulse, heat, fxK, motion (bool), quality (0..3),
     * camX, W, H, vp, vx, bright, own (the style's own room shows) }. Kept and reused: pass the same object.
     */
    begin(f) {
      F = f;
      F.time = (performance.now() - t0) / 1000;
      if (!cur) return;
      const p = cur;
      if (p.gems) p.gems.n = 0;
      if (p.tubes) p.tubes.n = 0;
      if (p.trail) p.trail.n = 0;
      p.laneN = 0;
      p.beatN = 0;
    },
    /** A hand position on the highway: from za to zb (time ahead), xa..xb; the one you are in first. */
    lane(za, zb, xa, xb) {
      const p = cur;
      if (!p || p.laneN >= 8) return;
      lanes[p.laneN++].set(za, zb, xa, xb);
    },
    /** A beat line across the highway at z (bar: the first beat of a bar). */
    beat(z, bar) {
      const p = cur;
      if (!p || p.beatN >= 40) return;
      beats[p.beatN++].set(z, bar ? 1 : 0.4);
    },
    /** A note (kind 0), an open string's bar (1) or a chord frame's bar (2): its front face's middle x, y at depth z. */
    gem(kind, x, y, z, hw, hh, depth, radius, hex, missed, near, flare, fade, flags) {
      const p = cur;
      if (!p || !p.gems) return;
      const o = p.gems.next();
      const [A, B, C, D] = p.gems.arr;
      const c = rgbOf(hex);
      A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = kind;
      B[o] = hw; B[o + 1] = hh; B[o + 2] = depth; B[o + 3] = radius;
      C[o] = c[0]; C[o + 1] = c[1]; C[o + 2] = c[2]; C[o + 3] = missed ? 1 : 0;
      D[o] = near; D[o + 1] = flare; D[o + 2] = fade; D[o + 3] = flags;
    },
    /** A round piece from (x0, y0, z0) to (x1, y1, z1), radius r: kind 0 string (s: which), 1 fret, 2 nut, 3 light post. */
    tube(kind, x0, y0, z0, x1, y1, z1, r, hex, glow, s = 0, wound = 0, along = 0) {
      const p = cur;
      if (!p || !p.tubes) return;
      const o = p.tubes.next();
      const [P0, P1, C, Ee] = p.tubes.arr;
      const c = rgbOf(hex);
      P0[o] = x0; P0[o + 1] = y0; P0[o + 2] = z0; P0[o + 3] = r;
      P1[o] = x1; P1[o + 1] = y1; P1[o + 2] = z1; P1[o + 3] = kind;
      C[o] = c[0]; C[o + 1] = c[1]; C[o + 2] = c[2]; C[o + 3] = glow;
      Ee[o] = s; Ee[o + 1] = wound; Ee[o + 2] = along; Ee[o + 3] = 0;
    },
    /** How wide a sustain's strip is drawn, in ribbon half-widths (the glow round it fits inside). */
    TRAIL_WIDE: 2.2,
    /** One step of a sustain: from a (x, y, z, song time) to b, half width w. */
    trail(ax, ay, az, at, bx, by, bz, bt, w, hex, missed, holding, liftA, liftB) {
      const p = cur;
      if (!p || !p.trail) return;
      const S = p.trail;
      if (S.n >= S.cap) S.grow(S.n + 1);
      const W = w * E.TRAIL_WIDE;
      const U = E.TRAIL_WIDE;
      let o = S.n * 12;
      const P = S.pos;
      P[o] = ax - W; P[o + 1] = ay; P[o + 2] = -az;
      P[o + 3] = ax + W; P[o + 4] = ay; P[o + 5] = -az;
      P[o + 6] = bx + W; P[o + 7] = by; P[o + 8] = -bz;
      P[o + 9] = bx - W; P[o + 10] = by; P[o + 11] = -bz;
      o = S.n * 16;
      const A = S.a;
      A[o] = -U; A[o + 1] = at; A[o + 2] = holding; A[o + 3] = liftA;
      A[o + 4] = U; A[o + 5] = at; A[o + 6] = holding; A[o + 7] = liftA;
      A[o + 8] = U; A[o + 9] = bt; A[o + 10] = holding; A[o + 11] = liftB;
      A[o + 12] = -U; A[o + 13] = bt; A[o + 14] = holding; A[o + 15] = liftB;
      const c = rgbOf(hex);
      const C = S.c;
      for (let k = 0; k < 4; k++) {
        C[o + k * 4] = c[0];
        C[o + k * 4 + 1] = c[1];
        C[o + k * 4 + 2] = c[2];
        C[o + k * 4 + 3] = missed ? 1 : 0;
      }
      S.n++;
    },
    /** A note was hit (once, when judged): lights the floor and calls the style's onHit. ago: seconds since it happened. */
    hit(x, y, z, s, f, hex, dead, chord, until, ago = 0) {
      if (!cur || !F) return;
      const h = hits[hitI];
      hitI = (hitI + 1) % 8;
      h.x = x;
      h.y = y;
      h.z = z;
      h.at = F.time - ago;
      h.until = until;
      const e = E._hitE;
      e.x = x; e.y = y; e.z = z; e.s = s; e.f = f; e.rgb = rgbOf(hex); e.dead = dead; e.chord = chord;
      // bursts made in onHit are born when the note was hit (a hit seen a frame late starts part way)
      burstAgo = ago;
      if (cur.def.onHit) cur.def.onHit(e);
      burstAgo = 0;
    },
    _hitE: { x: 0, y: 0, z: 0, s: 0, f: 0, rgb: null, dead: false, chord: false },
    /** The end of the frame's building: everything sent to the graphics card in one go. */
    end() {
      const p = cur;
      if (!p || !F) return;
      U.uTime.value = F.time % 3600;
      U.uSong.value = F.t;
      U.uZs.value = F.zs;
      U.uPulse.value = F.pulse;
      U.uHeat.value = F.heat;
      U.uFx.value = F.fxK;
      U.uMotion.value = F.motion ? 1 : 0;
      U.uQ.value = F.quality;
      U.uZFar.value = F.zFar;
      U.uZPast.value = F.zPast;
      U.uGain.value = F.bright;
      U.uCamPos.value.copy(camera.position);
      U.uOwn.value = F.own ? 1 : 0;
      partU.uNow.value = F.time;
      // the hits: brightest as they land, held while they ring
      let hn = 0;
      for (let i = 0; i < 8; i++) {
        const h = hits[i];
        const age = F.time - h.at;
        const k = Math.max(Math.exp(-age / 0.35), F.t < h.until ? 0.35 : 0) * F.fxK;
        h.k = k;
        if (k > 0.01) U.uHits.value[hn++].set(h.x, h.y, h.z, k);
      }
      U.uHitN.value = hn;
      // notes you are holding (for sparks along a sustain): F.holdN of them, x, y, z each in F.holds
      F.dt = Math.min(0.1, Math.max(0, F.time - lastTime));
      lastTime = F.time;
      F.holdN = 0;
      F.holds = holds;
      for (let i = 0; i < 8; i++) {
        const h = hits[i];
        if (F.t < h.until && F.time - h.at < 30) {
          holds[F.holdN * 3] = h.x;
          holds[F.holdN * 3 + 1] = h.y;
          holds[F.holdN * 3 + 2] = h.z;
          F.holdN++;
        }
      }
      floorU.uLaneN.value = p.laneN;
      floorU.uBeatN.value = p.beatN;
      if (p.def.frame) p.def.frame(F);
      if (p.floor) {
        const fl = p.floor;
        // the highway's whole width, from just behind the neck to the far end
        const x0 = -6;
        const x1 = 30;
        const z0 = -F.zPast - 1;
        const z1 = F.zFar;
        fl.scale.set(x1 - x0, 1, z1 - z0);
        fl.position.set((x0 + x1) / 2, 0, -(z0 + z1) / 2);
        fl.updateMatrix();
        fl.visible = true;
      }
      if (p.sky) {
        const sky = !!F.own && !R3.seeThrough;
        p.sky.visible = sky;
        R3.skyOwn(sky);
        if (sky) {
          skyU.uInvVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
          skyU.uRes.value.set(F.W, F.H);
          skyU.uVp.value = F.vp;
          skyU.uVx.value = F.vx;
        }
      }
      if (p.gems) {
        p.gems.send();
        p.gemMesh.visible = p.gems.n > 0;
      }
      if (p.tubes) {
        p.tubes.send();
        p.tubeMesh.visible = p.tubes.n > 0;
      }
      if (p.trail) {
        const S = p.trail;
        for (const [a, k] of [[S.aPos, 12], [S.aA, 16], [S.aC, 16]]) {
          a.clearUpdateRanges();
          a.addUpdateRange(0, S.n * k);
          a.needsUpdate = true;
        }
        S.geo.setDrawRange(0, S.n * 6);
        S.mesh.visible = S.n > 0;
      }
      if (p.parts) {
        sendParticles(p);
        p.partMesh.visible = F.fxK > 0;
      }
      for (const f of p.fields) {
        const n = F.motion ? Math.round((f.max / QK[3]) * QK[F.quality] * (f.spec.heatMore ? 1 + f.spec.heatMore * F.heat : 1)) : 0;
        f.u.uCount.value = Math.min(f.max, n);
        f.u.uCamX.value = F.camX;
        f.mesh.visible = n > 0;
      }
      // heat shimmer over the latest hits and, on a streak, along the neck
      const hz = (p.def.haze || 0) * (F.haze ? 1 : 0) * F.fxK;
      if (hz > 0) {
        let j = 0;
        for (let i = 0; i < 8 && j < 4; i++) {
          const h = hits[i];
          if (h.k < 0.05) continue;
          const sp = R3.project(h.x, h.y + 0.3, h.z);
          hazeSpots[j * 4] = sp[0] / F.W;
          hazeSpots[j * 4 + 1] = 1 - sp[1] / F.H;
          hazeSpots[j * 4 + 2] = 0.07;
          hazeSpots[j * 4 + 3] = Math.min(1, h.k * 1.4);
          j++;
        }
        for (; j < 4; j++) hazeSpots[j * 4 + 3] = 0;
        R3.setHaze(hz, hazeSpots, F.neckY != null ? 1 - F.neckY / F.H + 0.08 : 0.25, 0.25 + 0.6 * F.heat);
      } else R3.setHaze(0, null);
    },
    /** The style's chord panel colours (or null: the usual ones). */
    chordGlass() {
      return cur && cur.def.chordGlass ? cur.def.chordGlass : null;
    },
    info() {
      if (!cur) return null;
      let alive = 0;
      if (cur.parts && F) {
        const [P, V] = cur.parts.arr;
        for (let i = 0; i < cur.parts.cap; i++) if (F.time >= P[i * 4 + 3] && F.time - P[i * 4 + 3] < V[i * 4 + 3]) alive++;
      }
      return { id: cur.id, gems: cur.gems ? cur.gems.n : 0, tubes: cur.tubes ? cur.tubes.n : 0, trail: cur.trail ? cur.trail.n : 0, particles: cur.parts ? cur.parts.cap : 0, alive, fields: cur.fields.map((f) => f.u.uCount.value), meshes: cur.meshes.length };
    },
    /** For test stills (the clock stands still there): every particle made s seconds earlier, so a burst shows. */
    age(s) {
      if (!cur || !cur.parts) return;
      const P = cur.parts.arr[0];
      for (let i = 0; i < cur.parts.cap; i++) P[i * 4 + 3] -= s;
      cur.dirty0 = 0;
      cur.dirty1 = cur.parts.cap;
    },
  };
  return E;
}
