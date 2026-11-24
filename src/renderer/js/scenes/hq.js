/**
 * 4.31: five richer moving backgrounds: Liquid chrome, Light tunnel, Sunset drive,
 * Northern lights and Light show. visuals.js draws them like the others, but each
 * into its own smaller picture (`scale`, a share of the normal one), then adds a
 * soft glow round the bright parts and a film-like finish.
 *
 * Every one keeps its middle and bottom darker for the highway, and goes gentle
 * (smaller pushes, slower) with the app's calm setting or Windows' reduced motion.
 *
 * Extra inputs, worked out each frame in visuals.js:
 *   uPush   the kick, eased in and out (camera pushes, swells)
 *   uTravel how far we've moved: faster when the song is louder, a jump on each kick
 *   uSince  seconds since the last beat
 *   uSweep  a slow clock for moving lights
 *   uSlow   the song over the last few seconds: loudness, bass, mids, highs
 *   uForm   the light show's formation (changes every 8 beats, eased)
 *   uScheme the colour scheme (changes every 16 beats, eased)
 */

export const HQ_SCENES = [
  { id: 'chrome', name: 'Liquid chrome', desc: 'Mirror-bright blobs of liquid metal that swell with the bass and ripple with the highs', scale: 0.7 },
  { id: 'warp', name: 'Light tunnel', desc: 'Rings of light rushing past, a pulse down the tunnel on every beat', scale: 0.85 },
  { id: 'sunset', name: 'Sunset drive', desc: 'A neon sun over glowing hills that rise with the music', scale: 0.7 },
  { id: 'borealis', name: 'Northern lights', desc: 'Aurora curtains over mountains and a still lake, brighter as the song lifts', scale: 0.7 },
  { id: 'lightshow', name: 'Light show', desc: 'Moving-head beams cutting through stage haze, sweeping to the beat', scale: 0.75 },
];

// Shared by the five (after the common head in visuals.js).
const EXTRA = `
uniform float uPush, uTravel, uSince, uSweep, uCalm, uForm, uScheme;
uniform vec4 uSlow;
float sat(float x) { return clamp(x, 0.0, 1.0); }
float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
// the last frame of this picture, for reflections and a little smoothing
vec3 prevAt(vec2 uv) { return texture(uPrev, clamp(uv, vec2(0.001), vec2(0.999))).rgb; }
`;

// ----------------------------------------------------------- Liquid chrome --
const CHROME = `
vec3 B[6];
float R[6];
void blobs() {
  float t = uTravel * 0.22;
  for (int i = 1; i < 5; i++) {
    float f = float(i);
    B[i] = vec3(sin(t * (0.7 + f * 0.13) + f * 1.7) * 1.3,
                0.35 + sin(t * (0.9 + f * 0.11) + f * 2.9) * 0.5,
                cos(t * (0.6 + f * 0.17) + f * 0.8) * 0.9);
    R[i] = 0.24 + 0.06 * sin(f * 2.1) + spec(0.08 + f * 0.2) * 0.16;
  }
  // the big one in the middle breathes with the bass and swells on the kick
  B[0] = vec3(sin(t * 0.3) * 0.2, 0.4, 0.0);
  R[0] = 0.42 + uBands.x * 0.16 + uPush * 0.08;
  // your playing lifts a drop out of the floor
  float g = uGuitar.x * uGuitar.w;
  B[5] = vec3(sin(uTime * 0.4) * 0.9, -0.75 + g * 1.0, -0.4);
  R[5] = 0.08 + 0.26 * g;
}
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float map(vec3 p) {
  float d = length(p - B[0]) - R[0];
  for (int i = 1; i < 6; i++) d = smin(d, length(p - B[i]) - R[i], 0.6);
  // fine ripples on the surface with the highs
  d += sin(p.x * 9.0 + uTime * 2.0) * sin(p.y * 8.0 - uTime * 1.7) * sin(p.z * 9.0 + uTime) * 0.012 * (0.3 + uBands.w * 1.4);
  return d;
}
vec3 nrm(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.002;
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
// the room the metal reflects: a soft horizon, a round key light above, coloured lights either side
vec3 room(vec3 rd) {
  float y = rd.y;
  vec3 c = mix(vec3(0.02, 0.016, 0.02), mix(vec3(0.13, 0.13, 0.2), vec3(0.02, 0.025, 0.06), sat(y * 1.3)), smoothstep(-0.25, 0.05, y));
  // the horizon glows, warmer as the song lifts
  vec3 warm = mix(vec3(0.55, 0.32, 0.5), vec3(1.0, 0.6, 0.35), uSlow.x);
  c += warm * exp(-abs(y - 0.02) * 9.0) * (0.2 + uEnergy * 0.45);
  // the key light: small and soft, brighter on the kick
  vec3 kd = normalize(vec3(0.35, 0.85, -0.4));
  c += vec3(1.0, 0.97, 0.92) * pow(sat(dot(rd, kd)), 60.0) * (1.2 + uPush * 2.0);
  // two big coloured lights, mids on one side, highs on the other
  vec3 ld = normalize(vec3(-0.9, 0.25, 0.3)), rdl = normalize(vec3(0.9, 0.2, 0.4));
  c += pal(0.05 + uScheme * 0.13) * pow(sat(dot(rd, ld)), 6.0) * (0.25 + uBands.z * 1.4);
  c += pal(0.55 + uScheme * 0.13) * pow(sat(dot(rd, rdl)), 6.0) * (0.2 + uBands.w * 1.4);
  // a thin strip light that turns slowly round the room
  float a = atan(rd.x, rd.z);
  c += pal(0.3 + uScheme * 0.13) * smoothstep(0.96, 1.0, cos(a * 2.0 + uSweep * 0.5)) * exp(-abs(y - 0.35) * 14.0) * (0.3 + uBands.y * 1.2);
  return c;
}
float march(vec3 ro, vec3 rd, int steps) {
  // only rays that come near the metal pay for the search
  vec3 oc = ro - vec3(0.0, 0.2, 0.0);
  float b = dot(oc, rd), h = b * b - dot(oc, oc) + 2.7 * 2.7;
  if (h < 0.0) return -1.0;
  float t = max(0.0, -b - sqrt(h)), t1 = -b + sqrt(h);
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    float d = map(ro + rd * t);
    if (d < 0.0015 * (1.0 + t)) return t;
    t += d * 0.9;
    if (t > t1) break;
  }
  return -1.0;
}
vec3 metal(vec3 pos, vec3 rd) {
  vec3 n = nrm(pos);
  vec3 r = reflect(rd, n);
  float fr = pow(1.0 - sat(dot(n, -rd)), 4.0);
  vec3 tint = mix(vec3(0.92, 0.94, 1.0), pal(0.6 + n.y * 0.2 + uScheme * 0.13), 0.22);
  vec3 c = room(r) * tint * (0.8 + 0.6 * fr);
  // a rainbow sheen at the edges on the snare and your picks
  c += hue(fr * 1.4 + uHue + uTime * 0.04) * fr * smoothstep(0.02, 0.2, dot(n, -rd)) * (0.08 + uSnap * 0.45 + uGuitar.y * uGuitar.w * 0.3);
  c *= 0.45 + 0.55 * sat(map(pos + n * 0.18) / 0.18); // darker in the creases
  return c;
}
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  blobs();
  float orbit = uTravel * 0.045 + 0.6;
  float dist = 5.2 - uPush * 0.35;
  vec3 ro = vec3(sin(orbit) * dist, 0.7 - 0.3 * uHighway, -cos(orbit) * dist);
  vec3 ta = vec3(0.0, 0.15 - 0.75 * uHighway, 0.0);
  vec3 ww = normalize(ta - ro), uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0))), vv = cross(uu, ww);
  vec3 rd = normalize(p.x * uu + p.y * vv + 1.7 * ww);
  const float FLOOR = -0.62;
  // the room behind, very dim, with a soft spot of light behind the metal
  vec3 col0 = room(rd) * 0.06 + pal(0.65 + uScheme * 0.13) * 0.05 * exp(-length(p - vec2(0.0, 0.18 + 0.15 * uHighway)) * 2.5) * (0.6 + uSlow.x);
  vec3 col = col0;
  float tF = rd.y < 0.0 ? (FLOOR - ro.y) / rd.y : 1e9;
  float t = march(ro, rd, 56);
  if (t > 0.0 && t < tF) {
    col = metal(ro + rd * t, rd);
  } else if (tF < 1e8) {
    // a dark mirror floor: the metal and the room in it, shadows under the blobs
    vec3 pos = ro + rd * tF;
    vec3 rr = vec3(rd.x, -rd.y, rd.z);
    vec3 refl = room(rr) * 0.05;
    float t2 = march(pos, rr, 28);
    if (t2 > 0.0) refl = metal(pos + rr * t2, rr) * 0.45;
    float sh = sat(map(pos) / 0.7);
    col = refl * (0.35 + 0.65 * sh);
    // your notes ripple across the floor in their string's colour
    for (int i = 0; i < 8; i++) {
      vec4 h = uHits[i];
      if (h.z > 1.4) continue;
      vec2 hp = vec2((h.x - 0.5) * 3.2, -1.2);
      float ring = exp(-abs(length(pos.xz - hp) - h.z * 1.4) * 18.0) * exp(-h.z * 2.5);
      col += stringRGB(h.y) * ring * (0.35 + 0.35 * h.w);
    }
    col = mix(col0, col, exp(-max(0.0, length(pos.xz) - 1.5) * 0.3));
  }
  o = vec4(mix(prevAt(vUv), col, 0.88), 1.0);
}`;

// ------------------------------------------------------------ Light tunnel --
const WARP = `
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  vec2 c = vec2(0.0, 0.05 + 0.12 * uHighway);
  vec2 q = p - c;
  // the far end wanders a little so it feels like flying, not a picture
  float r0 = length(q);
  float bend = 1.0 - exp(-0.35 / max(r0, 0.01) * 0.06);
  q -= vec2(sin(uTravel * 0.13), cos(uTravel * 0.09) * 0.6) * 0.09 * bend;
  q *= rot(uTravel * 0.015 + sin(uTravel * 0.05) * 0.3);
  float a = atan(q.y, q.x);
  // an eight-sided tunnel with softened corners
  const float SIDES = 8.0;
  float seg = 2.0 * PI / SIDES;
  float r = length(q) * mix(1.0, cos(mod(a + seg * 0.5, seg) - seg * 0.5), 0.75);
  float z = 0.32 / max(r, 1e-3);
  float w = z + uTravel;
  float fog = exp(-z * 0.14);
  // which panel round the walls: bass on the floor, highs on the ceiling, mirrored left and right
  float side = floor((a + PI) / seg);
  float band = abs(fract((a + PI / 2.0) / (2.0 * PI) + 0.5) - 0.5) * 2.0;
  float lvl = spec(0.03 + band * 0.85);
  // walls: dark, a faint sheen, thin rails between the panels
  vec3 col = vec3(0.012, 0.016, 0.03) * (0.6 + 0.4 * sin(w * 3.0)) * fog;
  float pu = fract((a + PI) / seg);
  float rail = exp(-min(pu, 1.0 - pu) * r * 300.0);
  col += pal(band * 0.5 + uScheme * 0.11) * rail * (0.02 + lvl * 0.2) * fog;
  float seam = exp(-abs(fract(w * 1.5 + 0.5) - 0.5) / (0.02 + fwidth(w * 1.5)));
  col += vec3(0.05, 0.07, 0.12) * seam * fog * (0.3 + uEnergy * 0.5);
  // an LED strip down each panel, its segments lit like a level meter
  float strip = exp(-abs(pu - 0.5) * r * 120.0);
  float segw = fract(w * 1.5);
  float segOn = step(hash(vec2(side, floor(w * 1.5))), lvl * 1.2 - 0.35) * smoothstep(0.0, 0.12, segw) * smoothstep(0.62, 0.5, segw);
  col += pal(band * 0.5 + 0.25 + uScheme * 0.11) * strip * segOn * (0.1 + lvl * 0.35) * fog;
  // rings every two steps along the tunnel, each tied to a part of the music
  float rw = w * 0.5;
  float id = floor(rw + 0.5);
  float dd = abs(rw - id);
  float px = fwidth(rw);
  float thin = sat(1.0 - px * 3.0); // far rings fade before they crowd together
  float core = exp(-dd / (0.012 + px * 1.2)) * thin;
  float halo = exp(-dd / (0.08 + px * 3.0)) * thin;
  float ringLvl = spec(fract(id * 0.137) * 0.9 + 0.03);
  // the beat sends a pulse of light down the tunnel
  float pulse = exp(-abs(z - uSince * 16.0) * 0.5) * exp(-uSince * 1.6) * (1.0 - uCalm * 0.6);
  vec3 rc = pal(id * 0.11 + uScheme * 0.11);
  // rings close to you lean to the colour of your note while you play
  rc = mix(rc, hue(uGuitar.z), uGuitar.x * uGuitar.w * 0.6 * exp(-z * 0.25));
  float ringB = 0.12 + ringLvl * 0.9 + pulse * 1.8 + uPush * 0.4;
  col += rc * (core * 1.2 + halo * 0.18) * ringB * fog * (0.55 + 0.45 * lvl);
  // the rings light the walls round them
  col += rc * exp(-dd * 2.5) * 0.05 * ringB * fog * thin;
  // sparks on the walls twinkle with the highs
  vec2 sg = vec2((a + PI) * 6.0, w * 3.0);
  float sh = hash(floor(sg));
  float spark = smoothstep(0.975, 1.0, sh) * exp(-length(fract(sg) - 0.5) * 7.0);
  col += vec3(0.85, 0.9, 1.0) * spark * (0.1 + uBands.w * 1.5 + uSnap * 0.4) * fog;
  // notes go by on the walls in their string's colour
  for (int i = 0; i < 8; i++) {
    vec4 h = uHits[i];
    if (h.z > 1.2) continue;
    float ha = (h.x - 0.5) * 2.4 - PI / 2.0;
    float da = abs(mod(a - ha + PI, 2.0 * PI) - PI);
    float dz = abs(z - (2.0 + h.z * 9.0));
    col += stringRGB(h.y) * exp(-da * 6.0 - dz * 0.9) * exp(-h.z * 2.0) * (0.3 + 0.3 * h.w);
  }
  // a deep, dim glow far away (kept low so notes read in front of it)
  col += pal(0.55 + uScheme * 0.11) * exp(-r * 14.0) * 0.05 * (0.5 + uSlow.x);
  // a little smoothing from the last frame reads as motion blur
  o = vec4(mix(prevAt(vUv), col, 0.7), 1.0);
}`;

// ------------------------------------------------------------ Sunset drive --
const SUNSET = `
float horizonY() { return -0.02 + 0.15 * uHighway; }
// the hills: a flat road down the middle, hills either side that rise with the music
float hills(vec2 xz) {
  float side = smoothstep(0.9, 4.0, abs(xz.x));
  float zz = xz.y + uTravel * 1.6;
  float n = noise(vec2(xz.x * 0.3, zz * 0.3)) * 1.1 + noise(vec2(xz.x * 0.7 + 3.0, zz * 0.7)) * 0.18;
  float lvl = spec(clamp(abs(xz.x) / 10.0, 0.0, 1.0) * 0.8 + 0.03);
  return n * side * (0.4 + lvl * 1.0 + uSlow.x * 0.3 + uPush * 0.3) - 0.05;
}
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  float yh = horizonY();
  float warm = sat(uSlow.x * 1.2);
  // sky: deep night above, violet, then a hot horizon that warms as the song lifts
  float sy = p.y - yh;
  vec3 col = mix(vec3(0.32, 0.06, 0.28), vec3(0.012, 0.01, 0.045), smoothstep(0.0, 0.5, sy));
  col = mix(col, mix(vec3(0.7, 0.15, 0.3), vec3(0.9, 0.4, 0.2), warm), exp(-max(sy, 0.0) * 12.0) * 0.5);
  // stars twinkle with the highs
  vec2 g = p * 70.0; vec2 gid = floor(g);
  float st = hash(gid);
  col += vec3(0.9, 0.85, 1.0) * smoothstep(0.993, 1.0, st) * exp(-length(fract(g) - 0.5) * 8.0) * smoothstep(0.12, 0.4, sy) * (0.3 + uBands.w * 1.2);
  // the sun: banded, its glow breathing with the kick
  vec2 sc = vec2(0.0, yh + 0.16);
  float sr = 0.17 + uSlow.x * 0.02 + uPush * 0.006;
  float sd = length(p - sc);
  vec3 sunCol = mix(vec3(1.0, 0.12, 0.4), vec3(1.0, 0.7, 0.15), sat((p.y - sc.y) / sr * 0.5 + 0.6));
  sunCol = mix(sunCol, hue(uGuitar.z) * 0.6 + sunCol * 0.6, uGuitar.x * uGuitar.w * 0.35);
  float below = sc.y - p.y;
  float bands = step(0.0, below) * step(0.5, fract(below * 26.0 - uTime * 0.25)) * smoothstep(0.0, sr, below + 0.02);
  float disc = smoothstep(sr, sr - 0.004, sd) * (1.0 - bands);
  col = mix(col, sunCol * (0.45 + uBands.x * 0.2), disc);
  col += sunCol * exp(-max(sd - sr, 0.0) * 9.0) * 0.2 * (0.6 + uPush * 0.8 + uSlow.x * 0.5) * step(sr, sd);
  // far mountains: a skyline that moves with the music, rim-lit by the sun
  float ax = abs(p.x);
  float ridge = yh + 0.02 + (noise(vec2(p.x * 3.0, 1.7)) * 0.07 + noise(vec2(p.x * 9.0, 4.1)) * 0.02) * (0.5 + smoothstep(0.05, 0.6, ax))
              + spec(sat(ax * 1.1) * 0.8 + 0.05) * 0.035 * smoothstep(0.05, 0.4, ax);
  if (p.y < ridge && p.y > yh - 0.001) {
    float rim = exp(-(ridge - p.y) * 90.0);
    col = mix(vec3(0.05, 0.015, 0.08), vec3(0.11, 0.03, 0.14), sat((p.y - yh) * 8.0)) + vec3(1.0, 0.35, 0.5) * rim * (0.35 + uEnergy * 0.4);
  }
  // the ground: a glowing grid over the hills, found by stepping along each ray
  if (p.y < yh + 0.06) {
    vec3 ro = vec3(0.0, 1.0, 0.0);
    vec3 rd = normalize(vec3(p.x, p.y - yh, 1.4));
    float t = 0.3, lt = 0.3, hit = -1.0;
    for (int i = 0; i < 44; i++) {
      vec3 pos = ro + rd * t;
      float d = pos.y - hills(pos.xz);
      if (d < 0.002 * t) { hit = t; break; }
      lt = t;
      t += max(0.03 + t * 0.01, d * 0.5);
      if (t > 60.0) break;
    }
    if (hit > 0.0) {
      // home in on the exact edge (no stair-steps on the hill tops)
      float a0 = lt, a1 = hit;
      for (int i = 0; i < 5; i++) {
        float m = 0.5 * (a0 + a1);
        vec3 pm = ro + rd * m;
        if (pm.y - hills(pm.xz) < 0.0) a1 = m; else a0 = m;
      }
      hit = a1;
    } else if (rd.y < 0.0) hit = (ro.y + 0.05) / -rd.y; // far down the flat road
    if (hit > 0.0) {
      vec3 pos = ro + rd * hit;
      vec2 gp = vec2(pos.x, pos.z + uTravel * 1.6);
      vec2 fw = max(fwidth(gp), vec2(1e-4));
      vec2 gl = abs(fract(gp - 0.5) - 0.5) / fw;
      float line = 1.0 - smoothstep(0.4, 1.3, min(gl.x, gl.y));
      float glow = exp(-min(abs(fract(gp.x - 0.5) - 0.5), abs(fract(gp.y - 0.5) - 0.5)) * 18.0) * exp(-hit * 0.05);
      float road = smoothstep(0.7, 1.6, abs(pos.x));
      float fog = exp(-hit * 0.035);
      // a wave of light runs toward you on each beat
      float wave = exp(-abs(hit - (45.0 - uSince * 36.0)) * 0.25) * exp(-uSince * 1.2) * (1.0 - uCalm * 0.6);
      vec3 lc = mix(vec3(0.15, 0.75, 1.0), vec3(1.0, 0.25, 0.75), sat(hit / 30.0));
      lc = hueShift(lc, (uScheme * 0.11 + uHue) * 6.2831 * 0.3);
      float hl = sat((pos.y + 0.05) * 0.8);
      vec3 gcol = vec3(0.03, 0.008, 0.05) + vec3(0.5, 0.12, 0.4) * hl * 0.25;
      gcol += lc * (line * 0.6 + glow * 0.06) * (0.2 + hl * 0.4 + uEnergy * 0.3 + wave * 1.4) * mix(0.25, 1.0, road);
      // notes you play light the lines near the road
      gcol += hue(uGuitar.z) * line * uGuitar.x * uGuitar.w * 0.5 * (1.0 - road) * exp(-hit * 0.1);
      vec3 haze = mix(vec3(0.5, 0.1, 0.35), vec3(0.9, 0.4, 0.3), warm) * 0.16;
      col = mix(haze, gcol, fog);
      // the sun's reflection down the road, faint
      col += sunCol * exp(-abs(p.x) * 30.0) * exp(-hit * 0.06) * 0.15 * (1.0 - road);
    }
  }
  // notes rise from the horizon as sparks in their string's colour
  for (int i = 0; i < 8; i++) {
    vec4 h = uHits[i];
    if (h.z > 1.2) continue;
    vec2 hp = vec2((h.x - 0.5) * 1.2, yh + 0.03 + h.z * 0.18);
    col += stringRGB(h.y) * exp(-length(p - hp) * 60.0) * exp(-h.z * 2.5) * (0.6 + 0.6 * h.w);
  }
  o = vec4(mix(prevAt(vUv), col, 0.8), 1.0);
}`;

// --------------------------------------------------------- Northern lights --
const BOREALIS = `
float horizonY() { return -0.12 + 0.2 * uHighway; }
float ridgeAt(float x) {
  float ax = abs(x);
  return (noise(vec2(x * 2.2, 3.1)) * 0.13 + noise(vec2(x * 7.0, 8.4)) * 0.035 + noise(vec2(x * 22.0, 1.3)) * 0.008)
       * (0.35 + smoothstep(0.0, 0.7, ax) * 0.9) + 0.01;
}
// the curtains: two bright ribbons that wander across the sky, with fine rays in them
float curtain(vec2 xz, float t) {
  float wob = fbm3(vec2(xz.x * 0.14 + t * 0.25, t * 0.13 + 3.0));
  float sway = 1.0 + uBands.x * 1.2 + uSlow.y * 0.6;
  float c1 = xz.y - (7.5 + (wob - 0.5) * 9.0 + sin(xz.x * 0.22 + t * 0.4) * 1.4 * sway);
  float c2 = xz.y - (12.0 + (wob - 0.5) * 6.0 + sin(xz.x * 0.17 - t * 0.3 + 2.0) * 2.0 * sway);
  float band = exp(-c1 * c1 * 0.5) + exp(-c2 * c2 * 0.3) * 0.6;
  float rays = 0.45 + 0.55 * noise(vec2(xz.x * 2.6 + wob * 5.0, t * (1.0 + uBands.w * 2.0)));
  return band * rays;
}
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  float yh = horizonY();
  vec3 col = vec3(0.0);
  float t = uPhase * 0.18;
  if (p.y >= yh) {
    vec3 rd = normalize(vec3(p.x, (p.y - yh) * 1.1 + 0.02, 1.0));
    // night sky: navy fading up to black, a cold glow along the horizon
    col = mix(vec3(0.02, 0.04, 0.09), vec3(0.003, 0.006, 0.018), smoothstep(0.0, 0.5, p.y - yh));
    vec2 g = p * 85.0; vec2 gid = floor(g);
    float st = hash(gid);
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.991, 1.0, st) * exp(-length(fract(g) - 0.5) * 9.0)
         * (0.35 + 0.65 * sin(uTime * (1.5 + st * 4.0) + st * 60.0) * uBands.w + uBands.w * 0.5);
    // the aurora: layers from its bright lower edge up into faint violet tops
    vec3 acc = vec3(0.0);
    float jitter = hash(gl_FragCoord.xy + fract(uTime)) * 0.25;
    for (int i = 0; i < 18; i++) {
      float fi = float(i) + jitter;
      float hgt = 2.0 + fi * 0.22;
      vec3 pt = rd * (hgt / rd.y);
      if (pt.z > 60.0) break;
      float k = curtain(pt.xz, t);
      // on the beat a wave of brightness climbs the curtain
      float climb = 1.0 + uPush * 1.6 * exp(-pow(fi - uSince * 30.0, 2.0) * 0.05) * (1.0 - uCalm * 0.6);
      vec3 ac = mix(vec3(0.15, 1.0, 0.55), vec3(0.15, 0.75, 0.9), sat(fi / 8.0));
      ac = mix(ac, vec3(0.7, 0.25, 0.9), sat((fi - 8.0) / 10.0));
      ac = hueShift(ac, (uHue + uScheme * 0.07) * 6.2831 * 0.35);
      acc += ac * k * exp(-fi * 0.16) * climb;
    }
    float lift = 0.12 + uBands.z * 0.55 + uSlow.x * 0.35 + uEnergy * 0.2;
    lift += uGuitar.x * uGuitar.w * 0.25;
    col += acc * lift * 0.3 * smoothstep(0.0, 0.08, p.y - yh);
    col += vec3(0.1, 0.35, 0.3) * exp(-(p.y - yh) * 20.0) * (0.05 + uBands.z * 0.08);
    // mountains in front: snow on the ridges lit by the aurora
    float ridge = yh + ridgeAt(p.x);
    if (p.y < ridge) {
      float depth = ridge - p.y;
      float snow = exp(-depth * 60.0) * (0.5 + 0.5 * noise(vec2(p.x * 60.0, p.y * 30.0)));
      vec3 lit = vec3(0.2, 0.7, 0.55) * (0.15 + uBands.z * 0.35 + uSlow.x * 0.2);
      col = vec3(0.006, 0.01, 0.018) + lit * snow * 0.6;
    }
  } else {
    // the lake: the sky above, mirrored and broken by ripples
    float dy = yh - p.y;
    float rip = noise(vec2(p.x * 9.0, dy * 70.0 / (dy * 4.0 + 0.2) - uTime * 0.6)) - 0.5;
    float kick = exp(-abs(length(vec2(p.x, dy * 3.0)) - uSince * 0.5) * 30.0) * uPush * (1.0 - uCalm * 0.7);
    vec2 my = vec2(vUv.x + rip * 0.006 * (1.0 + dy * 6.0) + kick * 0.004, (2.0 * (yh + 0.5) * uRes.y - gl_FragCoord.y) / uRes.y);
    vec3 refl = prevAt(my);
    col = refl * (0.4 - min(dy, 0.3) * 0.6) * (0.85 + rip * 0.4);
    col += vec3(0.2, 0.7, 0.6) * kick * 0.08;
    // notes land on the water as rings in their string's colour
    for (int i = 0; i < 8; i++) {
      vec4 h = uHits[i];
      if (h.z > 1.4) continue;
      vec2 hp = vec2((h.x - 0.5) * 1.3, yh - 0.05);
      vec2 d = (p - hp) * vec2(1.0, 4.0);
      col += stringRGB(h.y) * exp(-abs(length(d) - h.z * 0.18) * 90.0) * exp(-h.z * 3.5) * (0.2 + 0.2 * h.w);
    }
  }
  o = vec4(mix(prevAt(vUv), col, 0.75), 1.0);
}`;

// --------------------------------------------------------------- Light show --
const LIGHTSHOW = `
// where a head points (0 straight down), in four formations that change every 8 beats
float aim(float fi, float form) {
  float s = fi < 4.0 ? -1.0 : 1.0;
  float k = abs(fi - 3.5);
  float f = mod(form, 4.0);
  if (f < 1.0) return s * (0.12 + k * 0.12);                  // fan out
  if (f < 2.0) return -s * (0.18 + k * 0.05);                 // cross over
  if (f < 3.0) return sin(fi * 0.8 + uSweep * 1.3) * 0.45;    // a wave along the truss
  return -s * k * 0.08;                                       // all to the middle
}
vec3 beamCol(float fi) {
  float pair = min(fi, 7.0 - fi);
  return mix(pal(uScheme * 0.23 + pair * 0.07), vec3(1.0, 0.95, 0.85), 0.15);
}
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  float aspect = uRes.x / uRes.y;
  float floorY = -0.3 + 0.08 * uHighway;
  float trussY = 0.46;
  // haze drifting through the hall
  float hz = fbm3(p * vec2(1.6, 2.6) + vec2(uPhase * 0.06, -uPhase * 0.035));
  float hz2 = noise(p * 7.0 + vec2(-uPhase * 0.1, uPhase * 0.05));
  float dens = 0.15 + 1.6 * hz * hz * hz + 0.2 * hz2;
  vec3 col = vec3(0.008, 0.006, 0.014);
  // a soft LED wall behind the band, breathing with the song, a gentle lift on the snare
  vec2 wallP = p - vec2(0.0, floorY + 0.2);
  float wall = exp(-pow(abs(wallP.x) / (aspect * 0.4), 4.0)) * smoothstep(0.32, 0.0, abs(wallP.y)) * step(floorY, p.y);
  col += pal(uScheme * 0.23 + 0.5 + p.x * 0.1) * wall * (0.025 + uEnergy * 0.04 + uSnap * 0.05);
  float form = floor(uForm), blend = smoothstep(0.0, 1.0, fract(uForm));
  float mineIdx = floor(uGuitar.z * 8.0);
  float flare = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec2 src = vec2(((fi + 0.5) / 8.0 - 0.5) * aspect * 0.86, trussY);
    float ang = mix(aim(fi, form), aim(fi, form + 1.0), blend) + sin(uSweep + fi * 1.9) * 0.07;
    vec2 dir = vec2(sin(ang), -cos(ang));
    vec2 d = p - src;
    float along = dot(d, dir);
    float across = abs(d.x * dir.y - d.y * dir.x);
    // each head plays a part of the music: bass in the middle, highs at the ends
    float lvl = spec(0.04 + abs(fi - 3.5) / 3.5 * 0.8);
    float width = 0.006 + along * (0.06 + uPush * 0.025);
    float cone = exp(-pow(across / width, 2.0)) * step(0.0, along) * exp(-along * 0.9);
    float core = exp(-pow(across / (width * 0.3), 2.0)) * step(0.0, along) * exp(-along * 1.6);
    float mine = step(abs(fi - mineIdx), 0.5) * uGuitar.x * uGuitar.w;
    float b = 0.18 + lvl * 0.9 + uPush * 0.7 + mine * 0.8;
    vec3 bc = mix(beamCol(fi), vec3(1.0), mine * 0.4);
    col += bc * (cone * dens * 0.55 + core * 0.18) * b;
    // the lens itself
    col += bc * exp(-length(d) * 120.0) * (0.6 + b);
    // where the beam lands on the stage floor
    float tl = (floorY - src.y) / dir.y;
    vec2 spot = src + dir * tl;
    vec2 sd2 = (p - spot) * vec2(1.0, 4.0);
    flare += exp(-dot(sd2, sd2) * 90.0) * b * step(p.y, floorY + 0.02);
  }
  // four warm lights from the back of the stage, crossing upward
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 src = vec2((fi / 3.0 - 0.5) * aspect * 0.5, floorY + 0.03);
    float ang = (fi < 2.0 ? -1.0 : 1.0) * (0.25 + 0.15 * sin(uSweep * 0.5 + fi)) ;
    vec2 dir = vec2(sin(ang), cos(ang));
    vec2 d = p - src;
    float along = dot(d, dir);
    float across = abs(d.x * dir.y - d.y * dir.x);
    float width = 0.008 + along * 0.08;
    float cone = exp(-pow(across / width, 2.0)) * step(0.0, along) * exp(-along * 1.8);
    col += vec3(1.0, 0.72, 0.42) * cone * dens * (0.04 + uSlow.x * 0.12 + uBands.y * 0.1);
  }
  // the truss: a dark bar with a little shine
  float tr = smoothstep(0.012, 0.006, abs(p.y - trussY - 0.012));
  col = mix(col, vec3(0.03, 0.03, 0.035) + vec3(0.15) * smoothstep(0.004, 0.0, abs(p.y - trussY - 0.018)) * 0.3, tr);
  // the stage floor: dark and glossy, the beams in it
  if (p.y < floorY) {
    float dy = floorY - p.y;
    vec2 my = vec2(vUv.x, (2.0 * (floorY + 0.5) * uRes.y - gl_FragCoord.y) / uRes.y);
    col = col * 0.25 + prevAt(my) * 0.18 * exp(-dy * 6.0);
    col += beamCol(3.0) * flare * 0.25;
    // the crowd in front: heads against the light
    float heads = floorY - 0.12 - 0.035 * noise(vec2(p.x * 30.0, 2.0)) - 0.03 * smoothstep(0.55, 1.0, noise(vec2(p.x * 14.0, floor(uBeats * 0.5) * 0.31))) * (0.3 + uEnergy);
    col *= mix(1.0, 0.08, smoothstep(heads + 0.004, heads - 0.004, p.y));
  }
  // notes fly up from the stage as small lights
  for (int i = 0; i < 8; i++) {
    vec4 h = uHits[i];
    if (h.z > 1.2) continue;
    vec2 hp = vec2((h.x - 0.5) * aspect * 0.7, floorY + 0.04 + h.z * 0.3);
    col += stringRGB(h.y) * exp(-length(p - hp) * 70.0) * exp(-h.z * 2.5) * (0.5 + 0.5 * h.w);
  }
  o = vec4(mix(prevAt(vUv), col, 0.8), 1.0);
}`;

const SOURCES = { chrome: CHROME, warp: WARP, sunset: SUNSET, borealis: BOREALIS, lightshow: LIGHTSHOW };
/** The fragment shader of scene `id`, after the common head. */
export const hqSource = (id, head) => head + EXTRA + SOURCES[id];

// ----------------------------------------------------------- glow + finish --
const SMALL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uTexel;
`;
/** Shrinks the picture to a quarter, keeping only what's bright. */
export const GLOW_DOWN = SMALL + `
uniform float uThresh;
void main() {
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  o = vec4(c * max(0.0, l - uThresh) / max(l, 1e-4), 1.0);
}`;
/** A soft blur one way (run across, then down). */
export const GLOW_BLUR = SMALL + `
uniform vec2 uDir;
void main() {
  vec2 s = uTexel * uDir;
  vec3 c = texture(uSrc, vUv).rgb * 0.227027;
  c += (texture(uSrc, vUv + s * 1.3846).rgb + texture(uSrc, vUv - s * 1.3846).rgb) * 0.316216;
  c += (texture(uSrc, vUv + s * 3.2308).rgb + texture(uSrc, vUv - s * 3.2308).rgb) * 0.070270;
  o = vec4(c, 1.0);
}`;
/** The last pass for these scenes: glow, a film-like curve, calm behind the highway, grain. */
export const FINISH_HQ = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene, uGlow;
uniform float uHighway, uTime, uExposure, uGlowAmt;
void main() {
  vec2 d = vUv - 0.5;
  vec3 c = texture(uScene, vUv).rgb + texture(uGlow, vUv).rgb * uGlowAmt;
  c *= uExposure;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  // behind the highway: calm under the neck, and a little darker in the middle where the notes run
  c *= mix(1.0, mix(0.32, 0.85, smoothstep(0.12, 0.62, vUv.y)), uHighway);
  vec2 m = d * vec2(1.5, 2.0);
  c *= 1.0 - 0.3 * uHighway * exp(-dot(m, m) * 5.0);
  c *= 1.0 - 0.4 * smoothstep(0.4, 1.0, length(d * vec2(1.0, 1.3)));
  float g = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
