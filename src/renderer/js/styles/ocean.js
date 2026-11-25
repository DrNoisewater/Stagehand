/**
 * 4.34: Deep Ocean, drawn with its own graphics (see hdstyle.js and docs/hd-styles.md).
 *
 * A calm sandy seabed far below the surface: soft sand ripples with rippling sunlight (caustics) moving over
 * them, wide shafts of light slanting down from a bright, rippling surface high above, and blue-green water
 * that swallows the distance. Your hand position is a smooth slab of wet stone edged with a soft glowing
 * line. Kelp sways in the distance on both sides; plankton drifts and bubbles rise all the time.
 * Notes are glowing jelly-like glass in their string's colour: a soft light inside, a bright rim, a glint
 * from above. Strings are glowing filaments, sustains are ribbons of light. A hit lets go a puff of bubbles,
 * a few glowing motes and a soft ring of light. Missed notes go dull and grey.
 */

// shared by the floor and the far seabed in the sky
const COMMON = /* glsl */ `
// one layer of moving light ripples: how far this point is from the nearest bright line (cell units)
float causEdge(vec2 q, float t) {
  vec2 n = floor(q);
  vec2 f = fract(q);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 h = hdHash2(n + g);
    vec2 o = 0.5 + 0.36 * sin(t * (0.55 + 0.5 * h.yx) + 6.2831 * h);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
// the rippling sunlight on the seabed: thin bright lines with a softer glow round them; a line thinner than
// a pixel spreads into an even glow of the same brightness, so nothing flickers in the distance
float caustics(vec2 q, vec2 fw) {
  float t = uTime * uMotion;
  // curve the lines with slow smooth noise: real ripples bend, they never run straight
  vec2 w = vec2(hdNoise(q * 0.31 + vec2(0.0, t * 0.05)), hdNoise(q * 0.31 + vec2(7.3, -t * 0.04))) - 0.5;
  w += (vec2(hdNoise(q * 0.83 + vec2(2.1, t * 0.08)), hdNoise(q * 0.83 + vec2(9.4, -t * 0.07))) - 0.5) * 0.45;
  const float S1 = 0.62;
  vec2 q1 = q * S1 + w * 1.5;
  float aa = max(fw.x, fw.y) * S1 * 1.4 + 1e-4;
  float e1 = causEdge(q1, t * 0.9);
  float k1 = max(0.07, aa);
  float b = exp(-e1 / k1) * (0.07 / k1) + exp(-e1 / 0.32) * 0.28;
  if (uQ > 0.5) {
    // a second, finer layer drifting the other way (High and up), mostly where the first is bright
    const float S2 = 1.15;
    float e2 = causEdge(q * S2 - w * 0.7 + 3.7, t * 1.15 + 2.0);
    float a2 = aa * S2 / S1;
    float k2 = max(0.06, a2);
    b += (exp(-e2 / k2) * (0.06 / k2) * 0.75 + exp(-e2 / 0.3) * 0.12) * (0.45 + 0.55 * b);
  }
  // brighter where the ripples above gather the light, dimmer between
  return b * (0.35 + 1.1 * hdNoise(q * 0.09 + vec2(t * 0.02, 0.0)));
}
// the sand: gentle ripples shaded by the light from above, a little mottled; returns its colour lit by the water
vec3 sand(vec2 q, vec2 fw, out float ripple) {
  float m = hdNoise(q * 0.12);
  float ph = dot(q, vec2(0.28, 0.96)) * 3.1 + m * 5.0 + hdNoise(q * 0.5) * 1.2;
  float af = max(fw.x, fw.y) * 3.1 * 1.5;
  float fade = 1.0 - smoothstep(0.4, 1.4, af);
  ripple = cos(ph) * fade;
  float mott = hdFbm(q * 0.55, 1.0 + uQ);
  vec3 alb = mix(vec3(0.46, 0.42, 0.33), vec3(0.6, 0.55, 0.43), mott);
  alb *= 0.85 + 0.15 * hdNoise(q * 2.3);
  vec3 amb = vec3(0.06, 0.17, 0.19);
  return alb * amb * (1.0 + 0.32 * ripple);
}
const vec3 CAUS_COL = vec3(0.42, 0.85, 0.8);
const vec3 DEEP = vec3(0.008, 0.075, 0.095);
// the colour far away in every direction: deep water under the highway's fog
vec3 horCol() { return hdFog(DEEP, uZFar * 2.0); }
// the water between you and a point: blue-green, thicker with distance
vec3 water(vec3 c, float z) {
  float k = 1.0 - exp(-max(z, 0.0) * 0.032);
  return mix(c, DEEP, k * 0.85);
}
// wide shafts of sunlight landing on the ground, drifting slowly
float shafts(vec2 q) {
  float t = uTime * uMotion;
  float a = hdNoise(vec2(q.x * 0.11 + q.y * 0.045 + t * 0.03, 1.7));
  return smoothstep(0.35, 0.85, a);
}
`;

const FLOOR = /* glsl */ `
${COMMON}
vec4 hdFloor(HDFloor f) {
  vec2 q = vec2(f.p.x, f.track);
  float ripple;
  vec3 c = sand(q, f.fw, ripple);
  float inL = f.inLane;
  // your hand position: a smooth slab of wet dark stone over the sand
  float slab = hdFbm(q * vec2(0.35, 0.2) + 4.0, 2.0);
  vec3 stone = mix(vec3(0.03, 0.075, 0.085), vec3(0.05, 0.11, 0.12), slab) * (0.85 + 0.25 * f.cur);
  c = mix(c, stone, inL * 0.9);
  // the light from above: caustics everywhere (softer on the stone), in wide shafts
  float sh = 0.45 + 0.9 * shafts(q);
  float cs = caustics(q, f.fw);
  float pulse = 1.0 + 0.1 * uPulse * uFx;
  c += CAUS_COL * cs * sh * mix(0.26, 0.16, inL) * pulse * (1.0 + 0.4 * uHeat);
  c += vec3(0.05, 0.14, 0.15) * sh * 0.25;
  // the hits: a soft glow spreads over the ground round each one
  float flare = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uHitN) break;
    vec4 h = uHits[i];
    vec2 d = vec2(f.p.x - h.x, (f.p.y - h.z) * 1.3);
    flare += h.w * exp(-dot(d, d) * 0.9);
  }
  c += vec3(0.25, 0.85, 0.85) * flare * 0.22;
  // the hand position's edges: a soft glowing line, brighter in the one you are in
  float edge = f.lane;
  float edgeK = (0.5 + 0.5 * f.cur) * (1.0 + 0.5 * uHeat);
  vec3 glowC = vec3(0.35, 0.95, 0.9);
  c += glowC * hdLine(edge, 0.022, f.fw.x * 1.2) * 1.3 * edgeK;
  c += glowC * exp(-abs(edge) * 6.0) * 0.16 * edgeK * step(edge, 50.0);
  // inside it: faint fret lines, and the beats as soft lines of light
  c += vec3(0.3, 0.7, 0.7) * hdLine(f.fret, 0.012, f.fw.x) * inL * 0.22;
  c += vec3(0.45, 0.95, 0.95) * f.beat * inL * (0.55 + 0.35 * uPulse * uFx);
  c = water(c, f.p.y);
  float a = 1.0;
  if (uOwn < 0.5) a = edge < 50.0 ? max(inL * 0.94, exp(-max(edge, 0.0) * 1.3) * 0.8) : 0.0;
  return vec4(c, a);
}
`;

const SKY = /* glsl */ `
${COMMON}
// one kelp stalk: az across, y up; returns how much of it covers this point (soft edged)
float kelp(float az, float y, float ak, float hk, float wk, float ph, float aa) {
  float dy = y + 0.01;
  if (dy < 0.0 || dy > hk) return 0.0;
  float u = dy / hk;
  float t = uTime * uMotion;
  float sway = (0.02 * sin(u * 3.0 + t * 0.45 + ph) + 0.006 * sin(u * 9.0 + t * 0.9 + ph * 2.0)) * u;
  // leaves: the stalk widens gently in places along its height, narrower toward the top
  float w = wk * (1.0 - 0.5 * u) * (1.0 + 1.4 * pow(max(0.0, sin(u * 26.0 + ph * 3.0)), 2.0));
  float d = abs(az - ak - sway) - w;
  return (1.0 - smoothstep(-aa, aa + wk * 0.6, d)) * (1.0 - smoothstep(0.8, 1.0, u));
}
vec3 hdSky(HDSky s) {
  vec3 rd = s.rd;
  float y = rd.y;
  float az = atan(rd.x, rd.z);
  float t = uTime * uMotion;
  vec3 hor = horCol();
  vec3 c;
  if (y < -0.002) {
    // the seabed beyond the highway, misting into the water
    float tt = -s.ro.y / y;
    vec3 gp = s.ro + rd * tt;
    vec2 q = vec2(gp.x, gp.z + uSong * uZs);
    vec2 fw = fwidth(q);
    float ripple;
    vec3 g = sand(q, fw, ripple);
    g += CAUS_COL * caustics(q, fw) * (0.45 + 0.9 * shafts(q)) * 0.3;
    g = hdFog(water(g, gp.z), gp.z);
    c = mix(g, hor, 1.0 - exp(-max(0.0, gp.z - uZFar) * 0.03));
  } else {
    // open water: deep blue-green at the horizon, brighter toward the surface far above
    float yy = max(y, 0.0);
    c = mix(hor, vec3(0.05, 0.3, 0.33), smoothstep(0.0, 0.55, yy));
    // the surface: bright ripples on a ceiling high above, fading into the water with distance
    if (yy > 0.02) {
      float tc = 36.0 / yy;
      vec2 sp = s.ro.xz + rd.xz * tc;
      vec2 sq = sp * 0.045 + vec2(t * 0.02, t * 0.035);
      float r1 = hdFbm(sq + vec2(hdNoise(sq * 1.3 + t * 0.05), 0.0) * 0.8, 2.0 + uQ * 0.5);
      float surf = smoothstep(0.35, 0.8, r1);
      c += vec3(0.25, 0.6, 0.6) * surf * exp(-tc * 0.006) * smoothstep(0.02, 0.25, yy);
    }
    // rays of sunlight slanting down from the upper left, swaying slowly
    vec2 src = vec2(s.res.x * 0.22, -s.res.y * 0.9);
    vec2 d = s.p - src;
    float ang = atan(d.x, d.y);
    float r = hdNoise(vec2(ang * 9.0 + t * 0.05, t * 0.07)) * 0.65 + hdNoise(vec2(ang * 23.0 - t * 0.08, 3.0 + t * 0.05)) * 0.35;
    float rays = smoothstep(0.35, 0.95, r);
    float down = clamp(1.0 - (s.p.y - 0.0) / max(s.vp, 1.0), 0.0, 1.0);
    c += vec3(0.32, 0.7, 0.66) * rays * (0.08 + 0.3 * down * down) * smoothstep(-0.01, 0.06, y);
    // far rocks and coral along the horizon, lost in the water
    float aa = fwidth(az) * 1.2 + 1e-4;
    float ay = fwidth(y) * 1.2 + 1e-4;
    float r1 = 0.012 + 0.035 * hdFbm(vec2(az * 4.0, 2.3), 3.0);
    float m1 = 1.0 - smoothstep(r1 - ay, r1 + ay, y);
    c = mix(c, hor * 0.55, m1 * 0.75);
    // kelp swaying on both sides, near ones darker, far ones misted
    float k = 0.0;
    k = max(k, kelp(az, y, -0.62, 0.34, 0.006, 0.0, aa) * 1.0);
    k = max(k, kelp(az, y, -0.71, 0.22, 0.005, 1.7, aa) * 0.75);
    k = max(k, kelp(az, y, -0.48, 0.16, 0.004, 3.1, aa) * 0.55);
    k = max(k, kelp(az, y, -0.86, 0.28, 0.006, 4.4, aa) * 0.85);
    k = max(k, kelp(az, y, 0.58, 0.3, 0.006, 2.2, aa) * 0.95);
    k = max(k, kelp(az, y, 0.69, 0.2, 0.005, 5.1, aa) * 0.7);
    k = max(k, kelp(az, y, 0.82, 0.36, 0.007, 0.9, aa) * 1.0);
    k = max(k, kelp(az, y, 0.5, 0.13, 0.004, 3.8, aa) * 0.5);
    c = mix(c, mix(vec3(0.01, 0.07, 0.075), hor, 0.25), k * 0.7);
  }
  // the water just above the ground glows a little where it meets the distance
  c += hor * exp(-abs(y) * 40.0) * 0.35;
  return c;
}
`;

const GEM = /* glsl */ `
vec4 hdGem(HDGem g) {
  bool missed = g.missed > 0.5;
  vec3 base = missed ? vec3(0.16, 0.2, 0.23) : g.col;
  vec3 n = g.n;
  vec3 v = g.v;
  vec3 L = normalize(vec3(-0.25, 0.85, 0.45));   // the light from the surface above
  float dif = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 60.0);
  float fr = hdFresnel(n, v, 2.2);
  float front = smoothstep(0.6, 0.95, -g.nl.z);
  // jelly: see-through body in the string's colour with a soft light inside it, strongest in the middle
  vec2 lc = g.l.xy;
  // the light sits in the middle of the body, so every face (the top too) shows it
  float core = exp(-dot(g.l, g.l) * 0.9);
  float kindK = g.kind > 1.5 ? 0.4 : 1.0;
  float glow = (0.85 + 0.9 * g.near + 1.1 * g.flare + 0.2 * uPulse * uFx) * kindK;
  float breathe = 1.0 + 0.08 * sin(uTime * 1.7 + g.wp.z * 0.6 + g.col.g * 6.0) * uMotion;
  vec3 c = base * (0.2 + 0.2 * dif);
  vec3 inner = mix(base, vec3(1.0), 0.1 + 0.25 * g.near + 0.2 * g.flare);
  c += inner * (0.3 + 0.9 * core) * glow * breathe * mix(0.8, 1.0, front);
  if (missed) {
    c = base * (0.3 + 0.4 * dif) + vec3(0.7, 0.85, 0.9) * spec * 0.25 + base * fr * 0.4;
    return vec4(c, 1.0);
  }
  // the rim: the rounded edges catch the light, tinted by the string, whiter as it reaches the neck
  vec3 rimC = mix(base * 1.4, vec3(0.85, 1.0, 1.0), 0.3 + 0.45 * g.near + 0.3 * g.flare);
  c += rimC * fr * (0.7 + 1.0 * g.near + 1.2 * g.flare + 0.8 * g.accent) * kindK;
  // a glint from above, like light on wet glass, and a soft highlight high on the face
  c += vec3(0.8, 1.0, 1.0) * spec * 0.9;
  vec2 hp = lc - vec2(-0.45, 0.5);
  c += vec3(0.75, 0.95, 1.0) * exp(-dot(hp, hp) * 14.0) * front * 0.35 * kindK;
  // a bend: the light inside grows a little
  c += base * front * g.bend * 0.25;
  return vec4(c, 1.0);
}
`;

const TUBE = /* glsl */ `
vec4 hdTube(HDTube t) {
  vec3 L = normalize(vec3(-0.25, 0.85, 0.45));
  vec3 n = t.n;
  vec3 v = t.v;
  float dif = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 50.0);
  float facing = max(dot(n, v), 0.0);
  if (t.kind < 0.5) {
    // a string: a glowing filament in its colour, brightest down its core; a soft pulse runs along it
    float wind = 1.0;
    if (t.wound > 0.5) {
      float w = t.along * 200.0;
      float aw = fwidth(w);
      wind = 0.8 + 0.2 * mix(0.5 + 0.5 * sin(w * 6.2832), 0.5, clamp(aw * 1.5 - 0.3, 0.0, 1.0));
    }
    float flow = 1.0 + 0.1 * sin(t.along * 0.9 - uTime * 1.4) * uMotion;
    vec3 hot = mix(t.col, vec3(0.9, 1.0, 1.0), 0.15 + 0.4 * t.glow);
    vec3 c = t.col * (0.3 + 0.35 * dif) * wind + hot * pow(facing, 1.4) * (1.0 + 1.2 * t.glow + 0.3 * uHeat) * flow * wind;
    c += vec3(0.8, 1.0, 1.0) * spec * 0.5;
    return vec4(c, 1.0);
  }
  if (t.kind < 1.5) {
    // a fret wire: pale, wet metal lit from above; it lights up when a note lands on it
    float fr = hdFresnel(n, v, 2.0);
    vec3 c = vec3(0.42, 0.55, 0.56) * (0.6 + 0.4 * dif) + vec3(0.25, 0.6, 0.6) * fr * 0.4 + vec3(0.8, 1.0, 1.0) * spec * 0.9;
    c += vec3(0.35, 0.95, 0.9) * t.glow * 0.7 * pow(facing, 1.5);
    return vec4(c, 1.0);
  }
  if (t.kind < 2.5) {
    // the nut: pale coral
    vec3 c = vec3(0.55, 0.5, 0.45) * (0.3 + 0.7 * dif) + vec3(0.1, 0.25, 0.25) * 0.3 + spec * 0.35;
    return vec4(c, 1.0);
  }
  // a light post: glowing in the light's colour
  vec3 c = mix(t.col, vec3(0.85, 1.0, 1.0), 0.3) * (0.25 + 1.4 * t.glow) * (0.45 + 0.75 * pow(facing, 2.0));
  c += vec3(0.8, 1.0, 1.0) * spec * 0.4;
  return vec4(c, 1.0);
}
`;

const TRAIL = /* glsl */ `
vec4 hdTrail(HDTrail r) {
  float a = abs(r.u);
  bool missed = r.missed > 0.5;
  vec3 base = missed ? vec3(0.2, 0.24, 0.26) : r.col;
  float body = 1.0 - smoothstep(1.0 - r.fu * 1.5, 1.0 + r.fu * 1.5, a);
  // light flowing toward you along the note, in soft waves fixed to it
  float m = uMotion;
  float wave = 0.5 + 0.5 * sin(r.t * 14.0 + uTime * 2.0 * m + r.u * 0.6);
  float shim = hdNoise(vec2(r.u * 2.0, r.t * 18.0 + uTime * 1.5 * m));
  float centre = exp(-a * a * 2.2);
  float lum = 0.5 + 0.8 * r.holding + 0.5 * r.lift;
  vec3 lit = mix(base, vec3(0.9, 1.0, 1.0), centre * (0.12 + 0.4 * r.holding + 0.25 * r.lift));
  vec3 c = mix(base * 0.4, lit, 0.4 + 0.35 * wave + 0.25 * shim) * lum;
  c += base * smoothstep(0.7, 0.98, a) * body * 0.6;
  float glow = exp(-max(a - 1.0, 0.0) * 2.2) * (0.25 + 0.3 * r.holding);
  if (missed) {
    c = base * (0.5 + 0.25 * shim);
    glow *= 0.15;
  }
  return vec4(mix(base * (0.9 + r.holding), c, body), clamp(body * 0.85 + (1.0 - body) * glow, 0.0, 1.0));
}
`;

// particles: shape 0 a soft glowing mote, 3 a bubble (a thin bright rim and a glint), 5 a ring of light
const SPRITE = /* glsl */ `
vec4 hdSprite(HDSprite p) {
  float d = length(p.uv);
  float fw = max(fwidth(d), 1e-3);
  float a;
  if (p.shape > 2.5 && p.shape < 3.5) {
    float rim = 1.0 - smoothstep(0.0, max(0.18, fw * 1.5), abs(d - 0.78));
    float fill = 0.12 * (1.0 - smoothstep(0.6, 0.85, d));
    vec2 gp = p.uv - vec2(-0.32, 0.36);
    float glint = exp(-dot(gp, gp) * 30.0) * 0.9;
    a = (rim * 0.75 + fill + glint) * (1.0 - smoothstep(0.9, 1.0, d));
  } else if (p.shape > 4.5) {
    // a ring of light that widens and thins as it spreads
    float w = mix(0.22, 0.07, p.age);
    a = exp(-pow((d - 0.82) / max(w, fw), 2.0)) * (1.0 - smoothstep(0.95, 1.0, d)) + 0.12 * exp(-d * d * 3.0) * (1.0 - p.age);
  } else a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
  return vec4(p.col.rgb * a * p.col.a, 0.0);
}`;

export default function build(K) {
  // hits: a puff of bubbles, a few glowing motes in the note's colour, a soft ring of light
  const bubbles = K.emitter({ max: 900, life: [1.0, 1.9], speed: [0.6, 1.7], up: 1, spread: 2.2, toward: [-0.4, 0.3], accel: [0, 2.6, 0], drag: 2.0, size: [0.03, 0.075], shape: 3, colA: [0.75, 0.95, 1], colB: [0.55, 0.85, 0.95], tintA: 0.25, alpha: 0.9, jitter: 0.16, stagger: 0.18 });
  const motes = K.emitter({ max: 500, life: [0.6, 1.3], speed: [0.8, 2.2], up: 1, spread: 2.6, toward: [-0.6, 0.5], accel: [0, 0.5, 0], drag: 2.2, size: [0.05, 0.018], shape: 0, colA: null, colB: [0.25, 0.85, 0.9], tintB: 0.4, alpha: 1, jitter: 0.1 });
  const rings = K.emitter({ max: 64, life: [0.6, 0.75], speed: [0, 0.001], up: 0, spread: 0, size: [0.12, 1.0], shape: 5, colA: null, colB: [0.3, 0.9, 0.95], tintB: 0.6, alpha: 0.45 });
  const stream = K.emitter({ max: 300, life: [0.8, 1.4], speed: [0.3, 0.8], up: 1, spread: 1.4, toward: [-0.3, 0.2], accel: [0, 2.2, 0], drag: 1.6, size: [0.022, 0.05], shape: 3, colA: [0.75, 0.95, 1], colB: [0.55, 0.85, 0.95], tintA: 0.2, alpha: 0.75, jitter: 0.1 });
  // all the time: plankton drifting, bubbles rising on both sides, big soft specks far off
  K.field({ count: 900, box: [-16, 16, -0.2, 8, -2, 48], vel: [0.06, 0.05, -0.12], size: [0.014, 0.034], colA: '#a8ffe0', colB: '#46d2ff', alpha: 0.5, sway: 0.25, heatMore: 0.6 });
  K.field({ count: 90, box: [-22, -7, -0.5, 10, 0, 45], vel: [0, 0.9, -0.1], size: [0.035, 0.09], shape: 3, colA: '#d4f4ff', alpha: 0.55, sway: 0.12 });
  K.field({ count: 90, box: [7, 22, -0.5, 10, 0, 45], vel: [0, 0.85, -0.1], size: [0.035, 0.09], shape: 3, colA: '#d4f4ff', alpha: 0.55, sway: 0.12 });
  K.field({ count: 110, box: [-30, 30, 1, 14, 18, 70], vel: [0.08, -0.1, -0.3], size: [0.1, 0.24], colA: '#7fe6e0', colB: '#3aa8c8', alpha: 0.1, sway: 0.5 });
  let acc = 0;
  return {
    floor: { glsl: FLOOR },
    sky: { glsl: SKY },
    gem: { glsl: GEM },
    tube: { glsl: TUBE },
    trail: { glsl: TRAIL },
    sprite: { glsl: SPRITE },
    haze: 0.35,
    chordGlass: ['#03222a', '#063844'],
    onHit(e) {
      const k = e.dead ? 1.2 : 1;
      bubbles.burst(e.x, e.y, e.z - 0.05, e.chord ? 10 : 18, e.rgb, k);
      motes.burst(e.x, e.y, e.z - 0.05, e.chord ? 8 : 14, e.rgb, k);
      rings.burst(e.x, e.y, e.z - 0.08, 1, e.rgb, k);
    },
    frame(F) {
      // a held note keeps letting go a thin stream of bubbles
      if (!F.holdN || !F.motion) {
        acc = 0;
        return;
      }
      acc += F.dt * 9;
      const n = Math.floor(acc);
      if (!n) return;
      acc -= n;
      for (let i = 0; i < F.holdN; i++) stream.burst(F.holds[i * 3], F.holds[i * 3 + 1], F.holds[i * 3 + 2] - 0.04, n, BUBBLE_RGB, 1);
    },
  };
}
const BUBBLE_RGB = [0.7, 0.95, 1];
