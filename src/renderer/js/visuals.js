/**
 * Moving backgrounds drawn on the graphics card (3.12): Nebula, Swarm,
 * Mandala, Strings and (4.5) Valhalla. They sit behind the highway or fill the Jam screen,
 * and move with the music you hear and what you play (music-features.js).
 *
 * Each frame: the scene draws into a picture that also sees its own last
 * frame (so things leave trails and smoke), then a last pass sets the
 * brightness, keeps the bottom calm behind the highway, and adds a little
 * colour split on big hits. Swarm keeps 65,536 sparks moving on the card.
 *
 * Quality: the picture is drawn at 75 % of the window (localStorage
 * stagehand.visualScale, 0.4–1) and scaled up; it's soft by nature.
 */
import { STRING_RGB } from './music-features.js';

export const SCENES = [
  { id: 'nebula', name: 'Nebula', desc: 'Glowing gas clouds, lightning on the hits' },
  { id: 'swarm', name: 'Swarm', desc: 'Thousands of sparks flowing like smoke' },
  { id: 'mandala', name: 'Mandala', desc: 'A stained-glass rose window lit from behind by the music' },
  { id: 'strings', name: 'Strings', desc: 'Six ribbons of light you pluck as you play' },
  // 4.5: the level-100 venue
  { id: 'valhalla', name: 'Valhalla', desc: 'The end of the road: aurora, stadium beams, a sea of lighters, pyro on the kicks' },
];

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared by every scene: inputs, noise, colour.
const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec2 uRes;
uniform float uTime, uPhase, uDt, uEnergy, uKick, uSnap, uBeats, uHighway, uHue;
uniform vec4 uBands;   // bass, low-mid, mid, high
uniform vec4 uGuitar;  // level, attack, hue, on
uniform vec4 uHits[8]; // x 0-1 along the neck, string 0-5, age s, 1 = you hit it
uniform sampler2D uSpec, uWave, uPrev;
#define PI 3.14159265
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0, 4, 2), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
// a palette that drifts slowly round the colour wheel (uHue), leaning to your note while you play
vec3 pal(float t) {
  vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0), d = vec3(0.0, 0.33, 0.67) + uHue;
  return a + b * cos(6.2831 * (c * t + d));
}
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
float spec(float x) { return texture(uSpec, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
float wave(float x) { return texture(uWave, vec2(fract(x), 0.5)).r * 2.0 - 1.0; }
vec3 stringRGB(float s) {
  ${STRING_RGB.map((c, i) => `if (s < ${i}.5) return vec3(${c.map((v) => v.toFixed(3)).join(', ')});`).join('\n  ')}
  return vec3(1.0);
}
vec2 cen(vec2 frag) { return (frag - 0.5 * uRes) / uRes.y; }
// where a note shows: along the neck left to right, low strings low
vec2 hitPos(vec4 h) { return vec2((h.x - 0.5) * 1.5 * uRes.x / uRes.y * 0.6, -0.32 + h.y * 0.13 + 0.25 * uHighway); }
`;

// ------------------------------------------------------------ Nebula --
const NEBULA = HEAD + `
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  float t = uPhase * 0.12;
  float bass = uBands.x, high = uBands.w;
  vec2 s = p * (1.35 - 0.08 * uKick);
  vec2 q = vec2(fbm(s * 1.4 + vec2(0.0, t)), fbm(s * 1.4 + vec2(5.2, 1.3) - t * 0.8));
  vec2 r = vec2(fbm(s * 1.4 + 3.6 * q + vec2(1.7, 9.2) + t * 0.6 + bass * 0.35),
                fbm(s * 1.4 + 3.6 * q + vec2(8.3, 2.8) - t * 0.4));
  float f = fbm(s * 1.4 + 3.2 * r);
  float dens = smoothstep(0.18, 0.9, f);
  // deep violet gas, blue-teal in the folds, warm where it's thickest; the whole set turns slowly
  float turn = uHue * 6.2831 * 0.5;
  vec3 deep = hueShift(vec3(0.16, 0.03, 0.32), turn);
  vec3 fold_ = hueShift(vec3(0.05, 0.42, 0.85), turn);
  vec3 hot = hueShift(vec3(1.0, 0.45, 0.25), turn * 0.6);
  vec3 col = mix(deep, fold_, clamp(length(q) * 1.1 - 0.25, 0.0, 1.0));
  col = mix(col, hot, smoothstep(0.55, 0.95, f) * (0.45 + uBands.z * 0.6));
  col += fold_ * pow(clamp(r.x, 0.0, 1.0), 4.0) * 0.6;
  col *= dens * (0.55 + uEnergy * 0.9 + uKick * 0.8) + 0.015;
  // a far, dim layer drifting the other way gives depth
  float far = fbm(p * 3.5 - vec2(t * 0.6, -t * 0.2) + q);
  col += deep * 1.6 * smoothstep(0.45, 0.9, far) * 0.5;
  // lightning in the clouds on the hits (song snares and your picking)
  float ridge = 1.0 - abs(fbm(s * 2.4 + r * 2.0 + uBeats * 1.7) * 2.0 - 1.0);
  float bolt = pow(ridge, 24.0) * (uSnap * 1.6 + uGuitar.y * 1.4) * smoothstep(0.35, 0.8, f);
  col += mix(vec3(0.75, 0.85, 1.0), hue(uGuitar.z), uGuitar.w * 0.6) * bolt * 2.5;
  // the note you're playing glows from inside, in its colour
  float core = exp(-length(p - vec2(0.0, 0.05 + 0.2 * uHighway)) * 3.2);
  col += hue(uGuitar.z) * core * dens * uGuitar.x * uGuitar.w * 1.4;
  // stars twinkle with the highs
  vec2 g = p * 42.0; vec2 id = floor(g);
  float st = hash(id);
  float star = smoothstep(0.985, 1.0, st) * exp(-length(fract(g) - 0.5) * 9.0);
  col += vec3(0.8, 0.9, 1.0) * star * (0.25 + high * 1.4 + 0.6 * sin(uTime * 3.0 + st * 40.0) * 0.5) * (1.0 - dens * 0.7);
  // notes landing on the highway flash in their string's colour
  for (int i = 0; i < 8; i++) {
    vec4 h = uHits[i];
    if (h.z > 1.2) continue;
    float d = length(p - hitPos(h));
    float e = exp(-h.z * 4.0) * (0.5 + 0.5 * h.w);
    col += stringRGB(h.y) * exp(-d * (9.0 - h.z * 4.0)) * e * 0.8 * (0.3 + dens);
  }
  vec3 prev = texture(uPrev, vUv).rgb;
  o = vec4(mix(prev, col, 0.55), 1.0);
}`;

// ----------------------------------------------------------- Mandala --
/*
 * 4.5 rebuild (the user: the weakest scene). Was a feedback kaleidoscope that smeared into
 * mush. Now a stained-glass rose window, drawn sharp every frame:
 *  - rings of glass petals, each ring a different count, bass in the middle, highs outside;
 *    each ring's glass is lit from behind by its own band of the music;
 *  - dark lead lines between the panes, gold tracery (star polygons) that draws itself in on
 *    the bar and turns a notch on each beat (rings turn opposite ways);
 *  - the song's waveform as the rose at the centre;
 *  - your notes light the pane of their string's ring at their fret's angle;
 *  - only a soft glow is carried over from the last frame (no smear).
 */
const MANDALA = HEAD + `
uniform float uFold, uTurn, uDraw;
// petal cell of a ring: (angle index, angle within the cell 0-1)
vec2 cell(float a, float n, float off) {
  float u = (a / (2.0 * PI) + 0.5) * n + off;
  return vec2(floor(u), fract(u));
}
float lead(float d, float w) { return smoothstep(w, w * 0.35, d); }
void main() {
  vec2 p = cen(gl_FragCoord.xy) * 1.12;
  p.y -= 0.06 * uHighway;
  float r = length(p), a = atan(p.y, p.x);
  float beatTurn = uTurn; // eased quarter-steps on beats, from the page
  vec3 col = vec3(0.0);
  float lit = 0.0;
  // rings: inner radius, outer radius, panes, which band lights it
  const int RINGS = 5;
  float edges[6] = float[6](0.07, 0.15, 0.24, 0.34, 0.46, 0.62);
  float counts[5] = float[5](6.0, 8.0, 12.0, 16.0, 24.0);
  float leadMask = 0.0;
  for (int k = 0; k < RINGS; k++) {
    float r0 = edges[k], r1 = edges[k + 1];
    if (r < r0 - 0.01 || r > r1 + 0.01) continue;
    float n = counts[k] * (k == 2 ? uFold / 6.0 : 1.0);
    float dir = (k % 2 == 0) ? 1.0 : -1.0;
    float ar = mod(a + dir * beatTurn * (0.5 + float(k) * 0.12) * (2.0 * PI / n) + PI, 2.0 * PI) - PI; // wrapped: no seam
    vec2 c = cell(ar, n, 0.0);
    float t = (r - r0) / (r1 - r0);
    // a pointed petal (gothic arch) inside each pane
    float x = c.y * 2.0 - 1.0;
    float arch = 1.0 - pow(abs(x), 1.6 + float(k) * 0.2);
    float inside = step(t, arch * 0.92 + 0.04);
    float band = spec(0.03 + float(k) * 0.19 + 0.04 * hash(vec2(c.x, float(k))));
    // the glass: jewel colours by ring and pane, slowly turning with the palette
    float hk = fract(0.08 * float(k) + 0.5 * hash(vec2(c.x * 1.3, float(k) + 3.0)) * 0.6 + uHue * 0.5);
    vec3 glass = mix(pal(hk), vec3(1.0, 0.78, 0.35), 0.18);
    // a chase of light round the ring on the beat
    float chase = exp(-abs(fract((c.x + float(k)) / n - uBeats * 0.125) - 0.5) * 18.0) * uKick;
    float light = 0.12 + band * 1.3 + uEnergy * 0.25 + chase * 1.5;
    // glass texture: a little mottling and a brighter middle
    float mott = 0.75 + 0.25 * noise(p * 40.0 + float(k) * 7.0);
    col += glass * inside * light * mott * (0.55 + 0.45 * (1.0 - abs(x)));
    lit += inside * light;
    // lead lines: between panes, along the arch, at the ring edges
    float dPane = min(c.y, 1.0 - c.y) * r * 2.0 * PI / n;
    float dArch = abs(t - (arch * 0.92 + 0.04)) * (r1 - r0);
    float dRing = min(abs(r - r0), abs(r - r1));
    leadMask = max(leadMask, max(lead(dPane, 0.006), max(lead(dArch, 0.005), lead(dRing, 0.006))));
  }
  // the rose at the centre: the waveform, folded
  if (r < edges[0] + 0.01) {
    float w = wave(a / (2.0 * PI) + 0.5) * (0.02 + uEnergy * 0.03);
    float rose = exp(-abs(r - 0.045 - w - uBands.x * 0.012) * 260.0);
    col += pal(0.1 + uPhase * 0.02) * rose * (0.6 + uEnergy) + vec3(1.0, 0.85, 0.5) * exp(-r * 40.0) * (0.3 + uKick);
  }
  // gold tracery: a star polygon that draws in over the bar
  float n2 = uFold;
  float seg = 2.0 * PI / n2;
  float aa = mod(a + beatTurn * 0.25, seg) - seg * 0.5;
  vec2 q = vec2(cos(aa), sin(aa)) * r;
  float star = abs(q.x * cos(PI / n2 * 2.0) + abs(q.y) * sin(PI / n2 * 2.0) - 0.40);
  float drawn = step(fract(a / (2.0 * PI) + 0.5), uDraw);
  float gold = exp(-star * 300.0) * drawn * step(r, 0.62);
  float circ = exp(-abs(r - 0.66) * 260.0) + exp(-abs(r - 0.70 - uBands.w * 0.02) * 400.0) * 0.6;
  vec3 brass = vec3(1.0, 0.76, 0.36);
  col += brass * (gold * (0.55 + uKick * 0.8) + circ * (0.25 + uBands.w * 0.8));
  // your notes: the pane of the string's ring at the fret's angle
  for (int i = 0; i < 8; i++) {
    vec4 h = uHits[i];
    if (h.z > 0.8) continue;
    int k = int(clamp(5.0 - h.y, 0.0, 4.0));
    float rr = (edges[k] + edges[k + 1]) * 0.5;
    float ang = (h.x - 0.5) * 2.0 * PI;
    vec2 hp = vec2(cos(ang), sin(ang)) * rr;
    col += stringRGB(h.y) * exp(-length(p - hp) * 22.0) * exp(-h.z * 4.0) * (1.2 + h.w);
  }
  // dark leading over everything, then a halo of light leaking around the window
  col *= 1.0 - leadMask * 0.92;
  col += vec3(0.9, 0.6, 0.3) * exp(-max(0.0, r - 0.62) * 9.0) * step(0.62, r) * (0.05 + uEnergy * 0.08);
  // the glow only (never the shapes) carries over
  vec3 prev = texture(uPrev, vUv).rgb;
  o = vec4(max(col, prev * 0.55), 1.0);
}`;

// ----------------------------------------------------------- Strings --
const STRINGS = HEAD + `
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  float aspect = uRes.x / uRes.y;
  // trails drift up and spread a little, like smoke off the strings
  vec2 sp = p - vec2(0.0, 0.0025 + uEnergy * 0.002);
  sp.x *= 0.997;
  vec2 suv = sp * vec2(uRes.y / uRes.x, 1.0) + 0.5;
  suv += (vec2(noise(p * 3.0 + uPhase * 0.3), noise(p * 3.0 - uPhase * 0.3 + 7.0)) - 0.5) * 0.004;
  vec3 prev = texture(uPrev, suv).rgb * (0.87 - 0.03 * uHighway);
  vec3 col = vec3(0.0);
  float top = mix(0.0, 0.18, uHighway), gap = mix(0.11, 0.07, uHighway);
  for (int k = 0; k < 6; k++) {
    float s = float(k);
    float band = spec(0.04 + s * 0.15);
    float base = top + (2.5 - s) * gap;
    float x = p.x;
    float y = base;
    // each string sways with its own part of the music
    y += sin(x * (2.0 + s * 0.6) + uPhase * (0.7 + s * 0.13) + s) * (0.012 + band * 0.07);
    y += (noise(vec2(x * 1.6 + uPhase * 0.2, s * 3.1)) - 0.5) * 0.05 * (0.4 + uEnergy);
    // plucks: a ripple runs both ways from where the note is
    float amp = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 h = uHits[i];
      if (h.z > 1.4 || abs(h.y - s) > 0.5) continue;
      float x0 = (h.x - 0.5) * aspect * 0.9;
      float dx = abs(x - x0) - h.z * 0.9;
      float env = exp(-h.z * 3.0) * exp(-dx * dx * 8.0);
      y += sin((abs(x - x0) - h.z * 0.9) * 40.0) * env * (0.03 + 0.03 * h.w);
      amp += env;
    }
    // 4.5: the string rings as a real string does: a standing wave with nodes at the frets
    y += sin(x * 9.0 * (1.0 + s * 0.15)) * sin(uTime * (31.0 + s * 7.0)) * band * band * 0.025;
    float d = abs(p.y - y);
    float glow = exp(-d * 320.0) * 1.0 + exp(-d * 55.0) * 0.12;
    // sparks run along a plucked string
    float run = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 h = uHits[i];
      if (h.z > 0.9 || abs(h.y - s) > 0.5) continue;
      float x0 = (h.x - 0.5) * aspect * 0.9;
      run += exp(-abs(abs(x - x0) - h.z * 1.4) * 60.0) * exp(-h.z * 3.0) * exp(-d * 120.0);
    }
    col += vec3(1.0, 0.95, 0.85) * run * 1.6;
    float bright = 0.18 + band * 0.9 + uKick * 0.25 + amp * 2.5;
    // your guitar lights the string that fits the note you play
    float mine = uGuitar.w * uGuitar.x * exp(-abs(clamp((uGuitar.z * 12.0), 0.0, 12.0) / 2.0 - s) * 1.2);
    col += stringRGB(s) * glow * (bright + mine * 1.5);
  }
  // 4.5: fret wires behind, flashing on the beat, so it reads as a neck, not lines
  float fx = p.x * 7.0 + 0.5;
  float wire = exp(-abs(fract(fx) - 0.5) * 2.0 * 140.0 / 7.0);
  float span = smoothstep(gap * 3.4, gap * 2.6, abs(p.y - top));
  col += vec3(0.75, 0.7, 0.6) * wire * span * (0.03 + uKick * 0.12);
  // inlay dots at 3, 5, 7, 9 and the double at 12
  vec2 g = vec2(fract(fx) - 0.5, p.y - top);
  float fi = floor(fx) + 7.0;
  float dotOn = (mod(fi, 12.0) == 3.0 || mod(fi, 12.0) == 5.0 || mod(fi, 12.0) == 7.0 || mod(fi, 12.0) == 9.0) ? 1.0 : 0.0;
  col += vec3(0.9, 0.85, 0.7) * dotOn * exp(-length(g * vec2(7.0, 1.0)) * 90.0) * (0.08 + uBands.x * 0.3);
  o = vec4(prev + col * 0.4, 1.0);
}`;

// ---------------------------------------------------------- Valhalla --
/*
 * 4.5: the legendary venue, level 100. An open-air stage at the end of the world:
 * aurora curtains moving with the mids, stadium light beams that sweep and strike on the
 * beat, a sea of lighters and raised hands that brightens when the song lifts, pyro embers
 * rising on the kicks, lightning on the snares, and your notes as golden sparks on stage.
 */
const VALHALLA = HEAD + `
uniform float uSweep;
float beam(vec2 p, vec2 o, float ang, float w) {
  vec2 d = p - o;
  float a = atan(d.x, d.y) - ang;
  // a cone of light going up from the stage, fading with height
  return exp(-a * a / (w * w)) * smoothstep(-0.01, 0.06, d.y) * exp(-d.y * 1.2);
}
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  float aspect = uRes.x / uRes.y;
  float horizon = -0.18 + 0.2 * uHighway;
  // sky: deep blue to black, a faint gold dawn at the horizon
  vec3 col = mix(vec3(0.05, 0.03, 0.02), vec3(0.01, 0.015, 0.05), smoothstep(horizon, 0.6, p.y));
  col += vec3(0.5, 0.28, 0.08) * exp(-(p.y - horizon) * 7.0) * step(horizon, p.y) * (0.25 + uEnergy * 0.3);
  // aurora: curtains that ripple with the mids, colour turning with the palette
  float t = uPhase * 0.08;
  float sky = smoothstep(horizon + 0.05, 0.55, p.y);
  float curtain = fbm(vec2(p.x * 1.6 + t, p.y * 0.4 - t * 0.3));
  float fold_ = sin(p.x * 6.0 + curtain * 6.0 + t * 3.0) * 0.5 + 0.5;
  float aur = pow(fold_, 5.0) * smoothstep(0.1, 0.45, p.y - horizon) * (1.0 - smoothstep(0.45, 0.7, p.y));
  vec3 ac = mix(vec3(0.2, 1.0, 0.6), vec3(0.6, 0.3, 1.0), 0.5 + 0.5 * sin(uHue * 6.2831 + p.x));
  col += ac * aur * sky * (0.25 + uBands.z * 1.2 + uBands.y * 0.4);
  // stars
  vec2 g = p * 60.0; vec2 id = floor(g);
  float st = hash(id);
  col += vec3(1.0, 0.95, 0.85) * smoothstep(0.992, 1.0, st) * exp(-length(fract(g) - 0.5) * 10.0) * sky * (0.4 + uBands.w);
  // stadium beams: six from the stage, sweeping with the bars, flaring on the beat
  vec2 stage = vec2(0.0, horizon - 0.02);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float side = fi < 3.0 ? -1.0 : 1.0;
    vec2 o = vec2(side * (0.18 + mod(fi, 3.0) * 0.17) * aspect * 0.7, horizon - 0.02);
    float ang = side * (0.15 + 0.12 * mod(fi, 3.0)) + sin(uSweep + fi * 1.7) * 0.35;
    float b = beam(p, o, ang, 0.035 + uKick * 0.02);
    vec3 bc = mix(vec3(1.0, 0.85, 0.55), pal(fi * 0.17 + uPhase * 0.01), 0.35);
    col += bc * b * (0.18 + uKick * 0.6 + uEnergy * 0.25);
  }
  // the crowd: hands and heads against the light, and lighters
  float cy = horizon - 0.02;
  float heads = cy - 0.035 - 0.02 * noise(vec2(p.x * 40.0, 1.0)) - 0.03 * smoothstep(0.6, 1.0, noise(vec2(p.x * 18.0, floor(uBeats) * 0.37))) * (0.4 + uEnergy);
  float crowd = step(p.y, heads);
  vec3 crowdLight = vec3(0.6, 0.35, 0.12) * exp(-(heads - p.y) * 8.0) * (0.3 + uEnergy);
  col = mix(col, vec3(0.012, 0.008, 0.006) + crowdLight * 0.2, crowd);
  vec2 lg = vec2(p.x * 90.0, (p.y - cy + 0.2) * 70.0);
  vec2 lid = floor(lg);
  float lh = hash(lid);
  float lighter = smoothstep(0.93, 1.0, lh) * exp(-length(fract(lg) - vec2(0.5, 0.3)) * 6.0) * crowd * step(cy - 0.32, p.y);
  float flick = 0.6 + 0.4 * sin(uTime * (6.0 + lh * 9.0) + lh * 50.0);
  col += vec3(1.0, 0.7, 0.3) * lighter * flick * (0.35 + uEnergy * 1.4);
  // lightning on the snares
  float ridge = 1.0 - abs(fbm(vec2(p.x * 3.0 + uBeats, p.y * 1.5)) * 2.0 - 1.0);
  col += vec3(0.8, 0.85, 1.0) * pow(ridge, 30.0) * uSnap * 2.0 * sky;
  // your notes: golden sparks on stage
  for (int i = 0; i < 8; i++) {
    vec4 h = uHits[i];
    if (h.z > 1.2) continue;
    vec2 hp = vec2((h.x - 0.5) * aspect * 0.8, horizon + 0.02 + h.z * 0.25);
    col += mix(stringRGB(h.y), vec3(1.0, 0.8, 0.4), 0.5) * exp(-length(p - hp) * 30.0) * exp(-h.z * 3.0) * (1.0 + h.w);
  }
  // embers: the last frame drifts up and cools; kicks throw new ones from the stage
  vec2 uv = vUv + vec2((noise(p * 4.0 + uPhase * 0.3) - 0.5) * 0.002, -0.0035);
  vec3 prev = texture(uPrev, uv).rgb * vec3(0.94, 0.9, 0.84);
  vec2 eg = vec2(p.x * 50.0, p.y * 50.0 + uTime * 3.0);
  float ember = smoothstep(0.985, 1.0, hash(floor(eg) + floor(uTime * 8.0))) * step(p.y, horizon + 0.05) * step(horizon - 0.05, p.y);
  vec3 fire = vec3(1.0, 0.5, 0.15) * ember * uKick * 3.0;
  o = vec4(col + max(prev - col, 0.0) * 0.65 + fire, 1.0);
}`;

// ------------------------------------------------------------- Swarm --
const SWARM_N = 256; // 256 × 256 sparks
const SWARM_STEP = HEAD + `
uniform sampler2D uState;
uniform float uSeed;
vec2 curl(vec2 p) {
  float e = 0.02;
  float n1 = fbm(p + vec2(0, e)), n2 = fbm(p - vec2(0, e));
  float n3 = fbm(p + vec2(e, 0)), n4 = fbm(p - vec2(e, 0));
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 st = texelFetch(uState, c, 0);
  vec2 pos = st.xy, vel = st.zw;
  float id = hash(vec2(c) * 0.731);
  float aspect = uRes.x / uRes.y;
  vec2 flow = curl(pos * 0.9 + vec2(uPhase * 0.05, -uPhase * 0.03)) * (0.12 + uEnergy * 0.35 + uBands.y * 0.2);
  vel = mix(vel, flow, 0.06);
  // kick: a shock wave from the middle
  float r = length(pos) + 1e-3;
  vel += pos / r * uKick * 0.06 * exp(-r * 0.8) * (0.5 + id);
  // your notes pull a swirl toward the note's spot
  vec2 gp = vec2((uGuitar.z - 0.5) * aspect * 0.8, 0.1);
  vec2 dg = gp - pos;
  vel += (dg * 0.4 + vec2(-dg.y, dg.x) * 0.8) * uGuitar.y * uGuitar.w * 0.05 / (0.2 + dot(dg, dg));
  vel *= 0.985;
  pos += vel * uDt;
  // old sparks are reborn somewhere new, and off-screen ones come back
  float h = hash(vec2(c) + uSeed);
  bool out_ = abs(pos.x) > aspect * 0.55 + 0.1 || abs(pos.y) > 0.62;
  if (out_ || h < 0.004 + uSnap * 0.01) {
    float a = hash(vec2(c) * 1.7 + uSeed) * 6.2831, rr = sqrt(hash(vec2(c) * 3.1 + uSeed));
    pos = vec2(cos(a) * aspect * 0.5, sin(a) * 0.5) * rr;
    vel = vec2(0.0);
  }
  o = vec4(pos, vel);
}`;
const SWARM_FADE = HEAD + `
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  vec2 uv = vUv + (p * vec2(uRes.y / uRes.x, 1.0)) * (-0.002 - uKick * 0.006);
  o = vec4(texture(uPrev, uv).rgb * (0.88 - 0.04 * uHighway), 1.0);
}`;
const SWARM_VERT = `#version 300 es
precision highp float;
uniform sampler2D uState, uSpec;
uniform vec2 uRes;
uniform float uEnergy, uKick, uHue, uSize;
uniform vec4 uGuitar;
out vec3 vCol;
vec3 pal(float t) { return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67) + uHue)); }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0, 4, 2), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  ivec2 c = ivec2(gl_VertexID % ${SWARM_N}, gl_VertexID / ${SWARM_N});
  vec4 st = texelFetch(uState, c, 0);
  float aspect = uRes.x / uRes.y;
  gl_Position = vec4(st.x / aspect * 2.0, st.y * 2.0, 0.0, 1.0);
  float k = float(gl_VertexID) / float(${SWARM_N * SWARM_N});
  float band = texture(uSpec, vec2(0.05 + k * 0.8, 0.5)).r;
  float speed = length(st.zw);
  gl_PointSize = uSize * (0.8 + band * 1.2);
  vec3 col = pal(k * 0.6 + speed * 0.4);
  col = mix(col, hue(uGuitar.z), uGuitar.x * uGuitar.w * 0.5 * step(0.7, fract(k * 7.0)));
  // a soft glow even when it's quiet; brighter with the music and your playing
  vCol = col * (0.08 + band * 0.12 + speed * 0.1 + uKick * 0.05 + uEnergy * 0.05 + uGuitar.x * uGuitar.w * 0.05);
}`;
const SWARM_FRAG = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 14.0);
  o = vec4(vCol * a, 1.0);
}`;

// --------------------------------------------------------- finishing --
const FINISH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uKick, uHighway, uTime, uExposure;
void main() {
  vec2 d = (vUv - 0.5);
  float ca = 0.0025 * uKick * (1.0 - uHighway * 0.6);
  vec3 c;
  c.r = texture(uScene, vUv + d * ca * 2.0).r;
  c.g = texture(uScene, vUv).g;
  c.b = texture(uScene, vUv - d * ca * 2.0).b;
  c = vec3(1.0) - exp(-c * uExposure);
  // behind the highway: calm under the neck and darker overall so notes read
  float y = vUv.y;
  c *= mix(1.0, mix(0.32, 0.85, smoothstep(0.12, 0.62, y)), uHighway);
  c *= 1.0 - 0.45 * smoothstep(0.35, 0.95, length(d * vec2(1.0, 1.25)));
  // fine grain stops banding in the dark parts
  float g = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

export function createVisuals(host, { highway = false } = {}) {
  let canvas = null;
  let gl = null;
  let failed = false;
  // 3.13: a lost or failed picture used to stay black until you picked another
  // background and came back. Now it rebuilds itself (a few tries, a little apart).
  let lost = false;
  let tries = 0;
  let retryAt = 0;
  let W = 0;
  let H = 0;
  let floatOK = false;
  const progs = {};
  let fb = [];
  let cur = 0;
  let specTex = null;
  let waveTex = null;
  let swarm = null;
  let lastScene = null;
  let last = 0;
  let fold = 6;
  let foldBeat = 0;
  let turn = 0;
  let turnTo = 0;
  let lastBeat = -1;
  let sweep = 0;
  const specBytes = new Uint8Array(64);
  const waveBytes = new Uint8Array(512);
  const hits = new Float32Array(32);

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }
  function program(name, fsrc, vsrc = VERT) {
    if (progs[name]) return progs[name];
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    progs[name] = { p, u };
    return progs[name];
  }
  function texture(w, h, internal, format, type, filter = gl.LINEAR) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h, internal, format, type, filter) {
    const tex = texture(w, h, internal, format, type, filter);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, f, w, h };
  }

  function init() {
    canvas = document.createElement('canvas');
    canvas.className = 'hw-fluid hw-visual';
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    floatOK = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    specTex = texture(64, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
    waveTex = texture(512, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
    gl.bindVertexArray(gl.createVertexArray());
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      lost = true; // rebuilt on the next frame
    });
  }

  function size() {
    let scale = 0.75;
    try {
      scale = Number(localStorage.getItem('stagehand.visualScale')) || 0.75;
    } catch (_) {}
    scale = Math.max(0.4, Math.min(1, scale));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(16, Math.round(canvas.clientWidth * dpr * scale));
    const ch = Math.max(16, Math.round(canvas.clientHeight * dpr * scale));
    if (cw === W && ch === H) return;
    W = cw;
    H = ch;
    canvas.width = W;
    canvas.height = H;
    for (const t of fb) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.f);
    }
    fb = floatOK
      ? [target(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT), target(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)]
      : [target(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), target(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)];
  }

  function common(u, F, now, dt) {
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uTime, (now / 1000) % 1000);
    gl.uniform1f(u.uPhase, F.phase);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uEnergy, F.drive);
    gl.uniform1f(u.uKick, highway ? F.kick * 0.7 : F.kick);
    gl.uniform1f(u.uSnap, highway ? F.snap * 0.6 : F.snap);
    gl.uniform1f(u.uBeats, F.beats % 64);
    gl.uniform1f(u.uHighway, highway ? 1 : 0);
    // the palette turns slowly; while you play it leans toward your note's colour
    const g = F.guitar;
    const drift = (F.t * 0.006) % 1;
    gl.uniform1f(u.uHue, g.on && g.level > 0.2 ? drift + (g.hue - drift) * 0.25 : drift);
    gl.uniform4f(u.uBands, Math.max(F.bands[0], F.bands[1]), F.bands[2], F.bands[3], F.bands[4]);
    gl.uniform4f(u.uGuitar, g.level, g.attack, g.hue, g.on ? 1 : 0);
    hits.fill(0);
    for (let i = 0; i < 8; i++) hits[i * 4 + 2] = 9;
    const ev = F.events.slice(-8);
    ev.forEach((e, i) => {
      hits[i * 4] = Math.max(0, Math.min(1, 0.08 + (e.fret || 0) / 24 * 0.84));
      hits[i * 4 + 1] = e.string;
      hits[i * 4 + 2] = (now - e.at) / 1000;
      hits[i * 4 + 3] = e.hit ? 1 : 0;
    });
    if (u.uHits) gl.uniform4fv(u.uHits, hits);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, specTex);
    gl.uniform1i(u.uSpec, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, waveTex);
    gl.uniform1i(u.uWave, 2);
  }
  function upload(F) {
    for (let i = 0; i < 64; i++) specBytes[i] = Math.max(0, Math.min(255, F.spec[i] * 255));
    for (let i = 0; i < 512; i++) waveBytes[i] = Math.max(0, Math.min(255, (F.wave[i] * 0.5 + 0.5) * 255));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 1, gl.RED, gl.UNSIGNED_BYTE, specBytes);
    gl.bindTexture(gl.TEXTURE_2D, waveTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 1, gl.RED, gl.UNSIGNED_BYTE, waveBytes);
  }
  /** One full-screen pass into the next feedback picture, reading the last one. */
  function pass(name, src, F, now, dt, extra) {
    const pr = program(name, src);
    const next = fb[1 - cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.f);
    gl.viewport(0, 0, W, H);
    gl.useProgram(pr.p);
    common(pr.u, F, now, dt);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fb[cur].tex);
    gl.uniform1i(pr.u.uPrev, 0);
    if (extra) extra(pr.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = 1 - cur;
  }

  function swarmSetup() {
    if (swarm) return swarm;
    const N = SWARM_N;
    const init = new Float32Array(N * N * 4);
    const aspect = W / H;
    for (let i = 0; i < N * N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      init[i * 4] = Math.cos(a) * r * aspect * 0.5;
      init[i * 4 + 1] = Math.sin(a) * r * 0.5;
    }
    const mk = () => {
      const t = target(N, N, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, init);
      return t;
    };
    swarm = { st: [mk(), mk()], cur: 0 };
    return swarm;
  }
  function drawSwarm(F, now, dt) {
    const S = swarmSetup();
    // move the sparks
    const step = program('swarm-step', SWARM_STEP);
    const nx = S.st[1 - S.cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, nx.f);
    gl.viewport(0, 0, SWARM_N, SWARM_N);
    gl.useProgram(step.p);
    common(step.u, F, now, dt);
    gl.uniform2f(step.u.uRes, W, H);
    gl.uniform1f(step.u.uSeed, (now % 10000) * 0.0137);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, S.st[S.cur].tex);
    gl.uniform1i(step.u.uState, 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    S.cur = 1 - S.cur;
    // fade the old picture, then add the sparks on top
    pass('swarm-fade', SWARM_FADE, F, now, dt);
    const dots = program('swarm-dots', SWARM_FRAG, SWARM_VERT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb[cur].f);
    gl.viewport(0, 0, W, H);
    gl.useProgram(dots.p);
    gl.uniform2f(dots.u.uRes, W, H);
    gl.uniform1f(dots.u.uEnergy, F.drive);
    gl.uniform1f(dots.u.uKick, F.kick);
    gl.uniform1f(dots.u.uHue, (F.t * 0.006) % 1);
    gl.uniform1f(dots.u.uSize, Math.max(1.5, H / 420));
    gl.uniform4f(dots.u.uGuitar, F.guitar.level, F.guitar.attack, F.guitar.hue, F.guitar.on ? 1 : 0);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, S.st[S.cur].tex);
    gl.uniform1i(dots.u.uState, 3);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, specTex);
    gl.uniform1i(dots.u.uSpec, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, SWARM_N * SWARM_N);
    gl.disable(gl.BLEND);
  }

  function finish(F, now) {
    const pr = program('finish', FINISH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fb[cur].tex);
    gl.uniform1i(pr.u.uScene, 0);
    gl.uniform2f(pr.u.uRes, W, H);
    gl.uniform1f(pr.u.uKick, F.kick);
    gl.uniform1f(pr.u.uHighway, highway ? 1 : 0);
    gl.uniform1f(pr.u.uTime, (now / 1000) % 100);
    gl.uniform1f(pr.u.uExposure, highway ? 1.1 : 1.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    get canvas() {
      return canvas;
    },
    get failed() {
      return failed;
    },
    /** Draws one frame of scene `id` from features F. */
    draw(id, F, now = performance.now()) {
      if (lost) {
        // the graphics card took the picture away (driver reset, too many pictures open): start a fresh one
        lost = false;
        this.reset();
        tries++;
        retryAt = now + 500;
      }
      if (failed || now < retryAt) return false;
      try {
        if (!gl) init();
        size();
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        if (id !== lastScene) {
          // a fresh start for each scene: no left-over trails from the last one
          for (const t of fb) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, t.f);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
          }
          lastScene = id;
        }
        upload(F);
        if (id === 'swarm' && floatOK) drawSwarm(F, now, dt);
        else if (id === 'mandala') {
          // the number of folds changes every 32 kicks
          if (F.beats - foldBeat >= 32) {
            foldBeat = F.beats;
            fold = [6, 8, 10, 12][Math.floor(Math.random() * 4)];
          }
          // 4.5: the rings turn a notch on each beat (eased), the tracery draws in over each bar
          const beat = Math.floor(F.beats);
          if (beat !== lastBeat) (lastBeat = beat), (turnTo += 1);
          turn += (turnTo - turn) * Math.min(1, dt * 7);
          const bar = (F.beats % 4) / 4;
          pass('mandala', MANDALA, F, now, dt, (u) => {
            gl.uniform1f(u.uFold, fold);
            gl.uniform1f(u.uTurn, turn);
            gl.uniform1f(u.uDraw, Math.min(1, bar * 1.6 + 0.05));
          });
        } else if (id === 'valhalla') {
          sweep += dt * (0.35 + F.drive * 0.8) + F.kick * dt * 3;
          pass('valhalla', VALHALLA, F, now, dt, (u) => gl.uniform1f(u.uSweep, sweep));
        } else if (id === 'strings') pass('strings', STRINGS, F, now, dt);
        else pass('nebula', NEBULA, F, now, dt);
        finish(F, now);
        if (tries && now > retryAt + 10000) tries = 0; // steady again
        return true;
      } catch (e) {
        console.warn('Visualizer:', e && e.message);
        this.reset();
        // try again a little later; after a few failures give up until the background is changed
        tries++;
        retryAt = now + 1500 * tries;
        if (tries > 4) failed = true;
        return false;
      }
    },
    /** Lets go of the picture (it's rebuilt on the next draw). */
    reset() {
      if (canvas) canvas.remove();
      if (gl) {
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose && !gl.isContextLost()) lose.loseContext();
      }
      canvas = gl = specTex = waveTex = swarm = null;
      fb = [];
      for (const k of Object.keys(progs)) delete progs[k];
      W = H = 0;
      last = 0;
      lastScene = null;
    },
    drop() {
      if (canvas) canvas.remove();
      if (gl) {
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
      canvas = gl = specTex = waveTex = swarm = null;
      fb = [];
      for (const k of Object.keys(progs)) delete progs[k];
      W = H = 0;
      last = 0;
      lastScene = null;
      failed = false;
      lost = false;
      tries = 0;
      retryAt = 0;
    },
  };
}
