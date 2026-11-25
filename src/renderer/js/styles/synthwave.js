/**
 * 4.34: Synthwave Drive, drawn with its own graphics (see hdstyle.js and docs/hd-styles.md).
 *
 * A night drive in 1986. The highway is wet black asphalt with a neon grid set into it, rolling toward you
 * with the notes and pulsing on the beat; the puddles mirror the sky. Ahead a big banded sun sets behind
 * three layers of purple mountains in a soft haze, a faint city skyline at its foot and stars above.
 * Palm trees line the road on both sides and go by with the song. Notes are glossy chrome blocks with a
 * neon face in their string's colour; strings are laser tubes; sustains are tail-light trails. A hit sends
 * a neon ring out along the grid and sprays glowing sparks.
 */

// shared by the road (floor) and the ground beyond it (sky), so the two meet without a seam
const COMMON = /* glsl */ `
const float SUN_EL = 0.045;   // the sun's height above the horizon (radians)
const float SUN_R = 0.12;    // and its size
// a line that stays smooth at any distance: never thinner than a pixel; a thinner one gets dimmer, not jagged
float swLine(float d, float w, float fw) {
  float W = max(w, fw);
  return (1.0 - smoothstep(W - fw, W + fw, abs(d))) * (w / W);
}
// evenly spaced lines (every P units): once they crowd within a few pixels they melt into their average glow
float swGrid(float x, float P, float w, float fw) {
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  return mix(swLine(d, w, fw), 2.0 * w / P, smoothstep(0.1, 0.35, fw / P));
}
// the sky's colour by height
vec3 swSkyGrad(float y) {
  float yy = max(y, 0.0);
  vec3 c = mix(vec3(0.62, 0.1, 0.42), vec3(0.11, 0.025, 0.24), smoothstep(0.0, 0.14, yy));
  c = mix(c, vec3(0.012, 0.004, 0.045), smoothstep(0.12, 0.5, yy));
  c += vec3(1.0, 0.38, 0.42) * exp(-yy * 45.0) * 0.55;
  return c;
}
// the haze at the horizon (what the far ground fades into)
vec3 swHorizon() { return vec3(0.95, 0.3, 0.5) * 0.62; }
// the sun's light round it: az and el measured from its middle, wide for a rough surface
vec3 swSunGlow(float daz, float del, float wx, float wy) {
  float g = exp(-(daz * daz) / (wx * wx) - (del * del) / (wy * wy));
  return mix(vec3(1.0, 0.25, 0.5), vec3(1.0, 0.62, 0.25), g) * g;
}
// the ground: wet black asphalt, a neon grid fixed to the road, the sky mirrored in the puddles.
// q = (x, z on the road, moving with the song), fw its change per pixel, v the view ray, dist from the eye.
vec3 swGround(vec2 q, vec2 fw, vec3 v, float dist, float under, out float grid) {
  float m = uMotion;
  float fwm = max(fw.x, fw.y);
  // puddles: mirror-smooth in places, rougher between
  float wet = smoothstep(0.42, 0.68, hdFbm(q * 0.085 + vec2(3.1, 7.7), 2.0 + min(uQ, 1.0)));
  float rough = mix(1.0, 0.12, wet);
  // the asphalt's grain, fading out before it is finer than a pixel (so it never sparkles)
  float grainK = 1.0 - smoothstep(0.08, 0.35, fwm);
  float grain = uQ > 0.5 ? (hdNoise(q * 6.0) - 0.5) * grainK : 0.0;
  vec3 c = vec3(0.014, 0.009, 0.032) * (1.0 + grain * 0.6) * (1.0 - wet * 0.35);
  // the mirror: the sky in the reflected direction, a little wavy where the road is rough
  vec3 r = vec3(v.x, -v.y, v.z);
  float ripple = (hdNoise(q * vec2(0.9, 0.35) + vec2(0.0, uTime * 0.25 * m)) - 0.5) * 0.06 * rough * grainK;
  float raz = atan(r.x, r.z) + ripple;
  float rel = max(r.y, 0.0);
  float cosT = clamp(-v.y, 0.0, 1.0);
  float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  vec3 refl = swSkyGrad(rel) * 0.55;
  refl += swSunGlow(raz, rel - SUN_EL * 0.5, SUN_R * (0.55 + 0.8 * rough), 0.06 + 0.3 * rough) * (1.5 - 0.7 * rough);
  c += refl * fres * mix(0.25, 1.0, wet) * mix(1.0, 0.45, under);
  // the grid: lines along the road and across it, a softer glow round each
  float gx = swGrid(q.x, 2.0, 0.022, fw.x) + swGrid(q.x, 2.0, 0.14, fw.x) * 0.12;
  float gz = swGrid(q.y, 2.0, 0.022, fw.y) + swGrid(q.y, 2.0, 0.14, fw.y) * 0.12;
  float pulse = 1.0 + 0.35 * uPulse * uFx;
  float near = exp(-dist * 0.012);
  grid = (gx + gz) * pulse * near;
  c += (vec3(0.15, 0.55, 1.0) * gx * 0.55 + vec3(1.0, 0.18, 0.75) * gz * 0.7) * pulse * near * mix(1.0, 0.22, under);
  // the grid's light caught in the wet surface
  c += vec3(0.5, 0.15, 0.6) * 0.05 * wet * near;
  // far off, everything melts into the haze at the horizon
  c = mix(c, swHorizon(), 1.0 - exp(-dist * 0.0055));
  return c;
}
`;

const FLOOR = /* glsl */ `
${COMMON}
vec4 hdFloor(HDFloor f) {
  vec3 cam = vec3(uCamPos.x, uCamPos.y, -uCamPos.z);
  vec3 wp = vec3(f.p.x, 0.0, f.p.y);
  vec3 dv = wp - cam;
  float dist = length(dv);
  vec3 v = dv / dist;
  vec2 q = vec2(f.p.x, f.track);
  float inL = f.inLane;
  float grid;
  vec3 c = swGround(q, f.fw, v, dist, inL, grid);
  // your hand position: a dark glass panel over the road (its own fainter gloss)
  vec3 glass = vec3(0.022, 0.012, 0.05) + vec3(0.25, 0.06, 0.4) * 0.05 * (0.5 + 0.5 * f.cur);
  c = mix(c, glass + c * 0.35, inL * 0.8);
  // its edges: neon tubes, the one you are in brighter
  float edge = f.lane;
  float seamK = (0.55 + 0.45 * f.cur) * (1.0 + 0.5 * uHeat);
  float seam = swLine(edge, 0.028, f.fw.x * 1.2);
  c += vec3(0.35, 0.9, 1.0) * seam * 2.2 * seamK;
  c += vec3(0.1, 0.55, 1.0) * exp(-abs(edge) * 6.0) * 0.32 * seamK * step(edge, 50.0);
  // inside it: faint fret lines and the beat lines (bars brighter), pulsing with the music
  c += vec3(0.85, 0.3, 1.0) * swLine(f.fret, 0.012, f.fw.x) * inL * 0.45;
  float bk = f.beat * min(1.0, 0.025 / f.fw.y);
  c += vec3(1.0, 0.3, 0.8) * bk * inL * (0.75 + 0.6 * uPulse * uFx);
  // the hits: a neon ring runs out along the grid, the grid round it lights up
  float ring = 0.0, glow = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uHitN) break;
    vec4 h = uHits[i];
    vec2 d = vec2(f.p.x - h.x, (f.p.y - h.z) * 1.2);
    float r = length(d);
    float age = -0.35 * log(max(h.w, 1e-3));
    float R = 0.2 + age * 6.5;
    float k = h.w * h.w;
    ring += swLine(r - R, 0.05, f.fw.x * 1.3) * k * 1.6 + exp(-abs(r - R) * 5.0) * k * 0.25;
    glow += h.w * exp(-r * r * 0.25);
  }
  c += vec3(1.0, 0.35, 0.85) * ring;
  c += (vec3(1.0, 0.4, 0.9) * grid * 1.2 + vec3(0.6, 0.2, 0.7) * 0.08) * glow;
  // over a venue picture or a moving background: only the highway shows
  float a = 1.0;
  if (uOwn < 0.5) a = edge < 50.0 ? max(inL * 0.94, exp(-max(edge, 0.0) * 1.3) * 0.8) : 0.0;
  return vec4(c, a);
}
`;

const SKY = /* glsl */ `
${COMMON}
// a mountain range's height by direction
float swRidge(float az, float fr, float s) { return hdFbm(vec2(az * fr + s, s * 1.7), 3.0 + uQ * 0.34); }
// one palm tree in its own flat plane: p = (along the road, up) from its foot; signed distance, negative inside
float swPalm(vec2 p, float seed) {
  float H = 5.2 + 1.8 * seed;
  float lean = (seed - 0.5) * 2.0;
  float yy = clamp(p.y / H, 0.0, 1.0);
  float dT = abs(p.x - lean * yy * yy) - mix(0.2, 0.11, yy);
  dT = max(dT, max(-p.y - 0.2, p.y - H));
  vec2 q = p - vec2(lean, H);
  float d = min(dT, length(q * vec2(1.0, 1.4)) - 0.4);
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float a = 3.14159 * (-0.08 + 1.16 * (fi + 0.5) / 8.0) + (hdHash(vec2(seed * 7.0, fi)) - 0.5) * 0.35;
    vec2 dir = vec2(cos(a), sin(a));
    float L = 2.4 + 0.9 * hdHash(vec2(fi, seed * 3.0));
    float s = clamp(dot(q, dir), 0.0, L);
    float k = 0.13 + 0.06 * hdHash(vec2(seed, fi + 9.0));
    vec2 cp = dir * s - vec2(0.0, k * s * s);
    float t = s / L;
    float w = 0.3 * pow(sin(3.14159 * clamp(t * 0.9 + 0.1, 0.0, 1.0)), 0.6) * (0.9 + 0.1 * cos(s * 11.0));
    d = min(d, length(q - cp) - w);
  }
  return d;
}
vec3 hdSky(HDSky s) {
  vec3 rd = s.rd;
  float y = rd.y;
  float az = atan(rd.x, rd.z);
  float m = uMotion;
  vec3 c;
  float aa = max(fwidth(y), 1e-4) * 1.2;
  if (y < 0.0) {
    // the ground beyond the road: the same wet asphalt and grid
    float t = -s.ro.y / min(y, -1e-4);
    vec3 gp = s.ro + rd * t;
    vec2 q = vec2(gp.x, gp.z + uSong * uZs);
    float grid;
    c = swGround(q, max(fwidth(q), vec2(1e-4)), rd, t, 0.0, grid);
    c = hdFog(c, gp.z);
    c = mix(c, swHorizon(), smoothstep(-0.02, 0.0, y));
  } else {
    c = swSkyGrad(y);
    // stars: soft points never smaller than a pixel, twinkling slowly, gone near the haze
    if (y > 0.05) {
      vec2 su = vec2(az, y) * 90.0;
      vec2 cell = floor(su);
      vec2 h2 = hdHash2(cell);
      float hs = hdHash(cell + 17.0);
      vec2 dd = su - cell - (0.2 + 0.6 * h2);
      float px = max(fwidth(su.x), 1e-3);
      float sz = max(0.04 + 0.06 * hs, px * 0.8);
      float st = exp(-dot(dd, dd) / (sz * sz)) * step(0.9, hs) * (0.03 + 0.06 * hs) / sz;
      st *= 0.75 + 0.25 * sin(uTime * (1.0 + 2.0 * h2.x) * m + hs * 40.0);
      c += vec3(0.85, 0.8, 1.0) * min(st, 1.5) * smoothstep(0.05, 0.2, y);
    }
    // the sun: yellow at the top to hot pink below, cut by bands that thicken as they sink
    vec2 sd = vec2(az, y - SUN_EL);
    float sr = length(sd);
    c += swSunGlow(az, y - SUN_EL, SUN_R * 2.2, SUN_R * 1.6) * 0.45;
    if (sr < SUN_R * 1.05) {
      float sa = max(fwidth(sr), 1e-4);
      float disc = 1.0 - smoothstep(SUN_R - sa, SUN_R + sa, sr);
      float v = sd.y / SUN_R;
      vec3 sc = mix(vec3(1.0, 0.12, 0.5), vec3(1.0, 0.5, 0.2), smoothstep(-0.9, 0.1, v));
      sc = mix(sc, vec3(1.0, 0.9, 0.45), smoothstep(0.1, 0.95, v));
      float tb = v * 7.0 + uTime * 0.18 * m;
      float fb = fract(tb);
      float ft = max(fwidth(tb), 1e-4);
      float g = 0.6 * smoothstep(0.5, -0.6, v);
      float band = smoothstep(g - ft, g + ft, fb) * (1.0 - smoothstep(1.0 - ft, 1.0, fb) * step(0.001, g));
      band = mix(1.0, band, step(v, 0.5));
      c = mix(c, sc * 1.25, disc * band);
    }
    if (y < 0.24) {
      // far mountains: pale and hazy, lit from behind by the sun
      float aaz = abs(az);
      float h1 = 0.012 + 0.055 * swRidge(az, 7.0, 1.3) * (0.45 + 0.55 * smoothstep(0.0, 0.45, aaz));
      float m1 = 1.0 - smoothstep(h1 - aa, h1 + aa, y);
      vec3 c1 = mix(vec3(0.42, 0.12, 0.42), vec3(0.62, 0.2, 0.45), exp(-aaz * aaz * 10.0));
      c1 += vec3(1.0, 0.45, 0.4) * exp(-max(h1 - y, 0.0) / 0.004) * 0.25 * exp(-aaz * aaz * 6.0);
      c = mix(c, c1 * mix(0.75, 1.0, y / max(h1, 1e-3)), m1);
      // a faint city at their foot, under the sun
      if (aaz < 0.5) {
        float cx = az * 70.0;
        float id = floor(cx);
        float hb = hdHash(vec2(id, 4.0));
        float hgt = (0.003 + 0.018 * hb * hb) * smoothstep(0.5, 0.15, aaz) * step(0.25, hdHash(vec2(id, 9.0)));
        float fx = fract(cx);
        float fwx = max(fwidth(cx), 1e-4);
        float inX = smoothstep(0.12 - fwx, 0.12 + fwx, fx) * (1.0 - smoothstep(0.88 - fwx, 0.88 + fwx, fx));
        float inB = inX * (1.0 - smoothstep(hgt - aa, hgt + aa, y));
        vec3 cc = vec3(0.2, 0.06, 0.26);
        // a few lit windows, only when they are big enough to show
        vec2 wv = vec2(cx * 4.0, y * 900.0);
        vec2 wf = fract(wv);
        float wk = step(0.78, hdHash(floor(wv) + id)) * smoothstep(0.3, 0.6, wf.x) * smoothstep(0.3, 0.6, wf.y) * (1.0 - smoothstep(0.4, 1.4, fwidth(wv.y)));
        cc += vec3(1.0, 0.65, 0.4) * wk * 0.35 * step(y, hgt - 0.002);
        c = mix(c, cc, inB * 0.6);
      }
      // the nearer ranges: darker, rimmed with pink light, framing the sun
      float h2 = 0.004 + 0.1 * pow(swRidge(az, 3.6, 7.1), 1.4) * smoothstep(0.1, 0.55, aaz);
      float m2 = 1.0 - smoothstep(h2 - aa, h2 + aa, y);
      vec3 c2 = vec3(0.13, 0.03, 0.2) + vec3(0.9, 0.2, 0.6) * exp(-max(h2 - y, 0.0) / 0.003) * 0.35;
      c = mix(c, c2, m2);
      float h3 = 0.002 + 0.16 * pow(swRidge(az, 2.1, 13.0), 1.3) * smoothstep(0.32, 0.95, aaz);
      float m3 = 1.0 - smoothstep(h3 - aa, h3 + aa, y);
      vec3 c3 = vec3(0.035, 0.008, 0.07) + vec3(0.4, 0.85, 1.0) * exp(-max(h3 - y, 0.0) / 0.0025) * 0.22;
      c = mix(c, c3, m3);
      // haze lying low between them
      c += vec3(0.9, 0.3, 0.55) * exp(-y * 55.0) * 0.28;
    }
  }
  // palm trees along both sides of the road, going by with the song
  for (int sd = 0; sd < 2; sd++) {
    float X = sd == 0 ? -8.5 : 32.5;
    float rx = abs(rd.x) < 1e-4 ? 1e-4 : rd.x;
    float t = (X - s.ro.x) / rx;
    vec3 hp = s.ro + rd * max(t, 0.0);
    float along = hp.z + uSong * uZs + float(sd) * 9.0;
    // worked out before any branch, so it is the same for every pixel
    float px = max(length(fwidth(vec2(along, hp.y))), 1e-4);
    const float P = 20.0;
    float cell = floor(along / P);
    float seed = hdHash(vec2(cell, float(sd) + 3.0));
    float u = along - (cell + 0.5) * P - (seed - 0.5) * 5.0;
    if (t > 0.0 && hp.y > -0.3 && hp.y < 13.0 && hp.z > -2.0 && hp.z < uZFar * 1.6 && abs(u) < 7.0 && px < 0.4) {
      float d = swPalm(vec2(u * (sd == 0 ? 1.0 : -1.0), hp.y), seed);
      float cov = (1.0 - smoothstep(-px, px, d)) * (1.0 - smoothstep(0.15, 0.4, px));
      vec3 pc = mix(vec3(0.02, 0.006, 0.04), swHorizon() * 0.9, 1.0 - exp(-t * 0.009));
      pc += vec3(0.9, 0.25, 0.6) * 0.08 * smoothstep(-0.15, 0.0, d);
      c = mix(c, pc, cov);
    }
  }
  // the horizon line glows
  c += vec3(1.0, 0.4, 0.6) * exp(-abs(y) / max(aa * 1.5, 0.0015)) * 0.35;
  return c;
}
`;

const GEM = /* glsl */ `
// what chrome sees: the dark sky above, the pink horizon, the grid-lit road below
vec3 swEnv(vec3 r) {
  vec3 c = mix(vec3(0.03, 0.02, 0.08), vec3(0.12, 0.04, 0.25), smoothstep(-0.4, 0.0, r.y));
  c = mix(c, vec3(0.05, 0.02, 0.14), smoothstep(0.05, 0.6, r.y));
  c += vec3(1.0, 0.4, 0.55) * exp(-abs(r.y - 0.03) * 14.0) * 0.9;
  return c;
}
vec4 hdGem(HDGem g) {
  vec3 L1 = normalize(vec3(-0.3, 0.75, 0.6));
  vec3 n = g.n;
  vec3 v = g.v;
  bool missed = g.missed > 0.5;
  vec3 base = missed ? vec3(0.22, 0.21, 0.25) : g.col;
  vec3 r = reflect(-v, n);
  float spec = pow(max(dot(n, normalize(L1 + v)), 0.0), 90.0);
  float fr = hdFresnel(n, v, 3.0);
  // chrome everywhere but the face: the room reflected, a touch of the note's colour
  vec3 chrome = swEnv(r) * mix(vec3(1.0), base * 1.3 + 0.2, 0.35) * (0.7 + 0.6 * fr) + vec3(1.0, 0.95, 1.0) * spec * 1.4;
  float front = smoothstep(0.85, 0.98, -g.nl.z);
  float kindK = g.kind > 1.5 ? 0.35 : 1.0;
  // the face: a neon panel in the string's colour, a bright neon line round it, a glossy sheen on top
  vec2 e2 = (1.0 - abs(g.l.xy)) * g.size;
  float e = min(e2.x, e2.y);
  float fe = max(fwidth(e), 1e-4);
  float lineW = min(0.035, min(g.size.x, g.size.y) * 0.22);
  float lineAt = lineW * 1.8;
  float neon = swLineG(e - lineAt, lineW * 0.5, fe);
  float heat = 0.9 + 0.8 * g.near + 2.0 * g.flare + 0.25 * uHeat;
  vec3 fill = base * (0.62 + 0.25 * smoothstep(-1.0, 1.0, g.l.y)) * heat;
  float sheen = smoothstep(0.15, 0.9, g.l.y - g.l.x * 0.25) * 0.22;
  vec3 face = fill + vec3(1.0) * sheen * (1.0 - 0.5 * g.near);
  face += mix(base, vec3(1.0), 0.55) * neon * (1.3 + 1.2 * g.near + 2.5 * g.flare + 1.0 * g.accent);
  face += swEnv(r) * 0.15;
  if (missed) face = base * 0.5 + swEnv(r) * 0.2;
  vec3 c = mix(chrome, face * kindK + chrome * (1.0 - kindK) * 0.6, front);
  // the sides carry a little of the colour's light so the block reads from any angle
  c += base * (1.0 - front) * 0.25 * kindK * (missed ? 0.3 : 1.0);
  c += vec3(1.0) * g.flare * 0.4;
  return vec4(c, 1.0);
}
`.replace('vec4 hdGem', 'float swLineG(float d, float w, float fw) { float W = max(w, fw); return (1.0 - smoothstep(W - fw, W + fw, abs(d))) * (w / W); }\nvec4 hdGem');

const TUBE = /* glsl */ `
vec3 swEnv(vec3 r) {
  vec3 c = mix(vec3(0.03, 0.02, 0.08), vec3(0.12, 0.04, 0.25), smoothstep(-0.4, 0.0, r.y));
  c = mix(c, vec3(0.05, 0.02, 0.14), smoothstep(0.05, 0.6, r.y));
  c += vec3(1.0, 0.4, 0.55) * exp(-abs(r.y - 0.03) * 14.0) * 0.9;
  return c;
}
vec4 hdTube(HDTube t) {
  vec3 L1 = normalize(vec3(-0.3, 0.75, 0.6));
  vec3 n = t.n;
  vec3 v = t.v;
  float spec = pow(max(dot(n, normalize(L1 + v)), 0.0), 60.0);
  float facing = max(dot(n, v), 0.0);
  vec3 r = reflect(-v, n);
  if (t.kind < 0.5) {
    // a laser: a white-hot core inside a glowing tube of the string's colour
    float flow = 1.0 + 0.06 * sin(t.along * 2.0 - uTime * 5.0) * uMotion;
    float core = pow(facing, 5.0);
    vec3 c = t.col * (0.55 + 0.6 * facing) * (1.0 + 0.9 * t.glow + 0.3 * uHeat) * flow;
    c += mix(t.col, vec3(1.0), 0.6) * core * (0.9 + 1.4 * t.glow);
    return vec4(c, 1.0);
  }
  if (t.kind < 2.5) {
    // fret wires and the nut: polished chrome showing the neon room
    float fr = hdFresnel(n, v, 2.0);
    vec3 c = vec3(0.3, 0.3, 0.36) * 0.25 + swEnv(r) * (0.7 + 0.5 * fr) + vec3(1.0) * spec * 1.2;
    c += vec3(1.0, 0.35, 0.9) * t.glow * 0.6 * pow(facing, 1.5);
    return vec4(c, 1.0);
  }
  // a light post: neon in the light's colour
  vec3 c = mix(t.col, vec3(1.0), 0.25) * (0.3 + 1.4 * t.glow) * (0.5 + 0.7 * pow(facing, 2.0));
  return vec4(c, 1.0);
}
`;

// sustains: tail-light trails (light only, added to what is behind)
const TRAIL = /* glsl */ `
vec4 hdTrail(HDTrail r) {
  float a = abs(r.u);
  bool missed = r.missed > 0.5;
  vec3 base = missed ? vec3(0.25, 0.24, 0.3) : r.col;
  float fu = r.fu * 1.3;
  float body = 1.0 - smoothstep(1.0 - fu, 1.0 + fu, a);
  // a bright line down the middle and two finer ones at the edges, like long-exposure tail-lights
  float core = exp(-a * a * 9.0);
  float ed = abs(a - 0.72);
  float edges = (1.0 - smoothstep(0.08 - fu, 0.08 + fu, ed)) * body;
  float m = uMotion;
  float streak = 0.88 + 0.12 * hdNoise(vec2(r.u * 4.0, r.t * 14.0 - uTime * 3.0 * m));
  float k = (0.75 + 0.8 * r.holding + 0.4 * r.lift) * streak;
  vec3 c = base * body * 0.42 * k + mix(base, vec3(1.0), 0.45) * core * 0.9 * k + mix(base, vec3(1.0), 0.3) * edges * 0.5 * k;
  c += base * exp(-max(a - 1.0, 0.0) * 2.4) * (1.0 - body) * 0.12 * k;
  if (missed) c *= 0.35;
  return vec4(c, 1.0);
}
`;

const SPRITE = /* glsl */ `
vec4 hdSprite(HDSprite p) {
  float d = length(p.uv);
  float a, core;
  if (p.shape > 0.5 && p.shape < 1.5) {
    float x = abs(p.uv.x);
    a = (1.0 - smoothstep(0.0, 1.0, x)) * (1.0 - smoothstep(0.6, 1.0, abs(p.uv.y)));
    core = exp(-x * x * 10.0) * a;
  } else {
    a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
    core = exp(-d * d * 18.0);
  }
  vec3 c = p.col.rgb * a + vec3(1.0) * core * 0.55 * (1.0 - p.age);
  return vec4(c * p.col.a, 0.0);
}
`;

export default function build(K) {
  // hits: neon sparks in the note's colour with white-hot heads, and slower glowing motes
  const sparks = K.emitter({ max: 1600, life: [0.35, 0.8], speed: [3.0, 7.0], up: 1, spread: 2.5, toward: [-2.0, 1.0], accel: [0, -7.5, 0], drag: 1.4, size: [0.045, 0.016], shape: 1, stretch: 0.05, colA: [1.6, 1.5, 1.6], colB: [1, 0.2, 0.8], tintA: 0.55, tintB: 0.85, alpha: 1, jitter: 0.12 });
  const motes = K.emitter({ max: 500, life: [0.6, 1.2], speed: [0.6, 1.8], up: 1, spread: 2.2, toward: [-0.8, 0.6], accel: [0, 0.8, 0], drag: 1.6, size: [0.07, 0.02], shape: 0, colA: [1, 1, 1], colB: [0.3, 0.8, 1], tintA: 0.8, tintB: 0.5, alpha: 0.8, jitter: 0.2, stagger: 0.08 });
  const trickle = K.emitter({ max: 400, life: [0.25, 0.5], speed: [1.0, 2.4], up: 1, spread: 2.2, toward: [-1.2, 0.2], accel: [0, -5, 0], drag: 1.3, size: [0.03, 0.012], shape: 1, stretch: 0.04, colA: [1.4, 1.3, 1.5], colB: [1, 0.3, 0.9], tintA: 0.5, tintB: 0.9, alpha: 0.85, jitter: 0.1 });
  let acc = 0;
  return {
    floor: { glsl: FLOOR },
    sky: { glsl: SKY },
    gem: { glsl: GEM },
    tube: { glsl: TUBE },
    trail: { glsl: TRAIL, add: true },
    sprite: { glsl: SPRITE },
    haze: 0,
    chordGlass: ['#14062e', '#2e0c52'],
    onHit(e) {
      const k = e.dead ? 1.2 : 1;
      sparks.burst(e.x, e.y, e.z - 0.05, e.chord ? 20 : 36, e.rgb, k);
      motes.burst(e.x, e.y, e.z, e.chord ? 5 : 9, e.rgb, k);
    },
    frame(F) {
      // a held note keeps throwing a few sparks, like a grinder on chrome
      if (!F.holdN || !F.motion) {
        acc = 0;
        return;
      }
      acc += F.dt * 18;
      const n = Math.floor(acc);
      if (!n) return;
      acc -= n;
      for (let i = 0; i < F.holdN; i++) trickle.burst(F.holds[i * 3], F.holds[i * 3 + 1], F.holds[i * 3 + 2] - 0.04, n, HOLD_RGB, 1);
    },
  };
}
const HOLD_RGB = [1, 0.4, 0.9];
