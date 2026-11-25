/**
 * 4.34: Inferno, drawn with its own graphics (see hdstyle.js and docs/hd-styles.md).
 *
 * A highway of dark basalt plates with lava glowing and slowly flowing in the cracks between them; your
 * hand position is a polished obsidian slab edged with molten seams. Notes are molten metal in their
 * string's colour: a glowing core under a cooled crust, hot rims that go white as they reach the neck.
 * Strings glow like hot wire. Hits throw sparks, embers and drops of lava and flare the cracks; embers
 * drift up all the time, and heat shimmers over the neck on a streak. Missed notes cool to grey iron.
 */

// lava's colour from cool (0) to white-hot (1); shared by the floor and the far ground in the sky
const COMMON = /* glsl */ `
vec3 lavaRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.18, 0.015, 0.0), vec3(0.8, 0.1, 0.0), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(1.0, 0.42, 0.04), smoothstep(0.3, 0.7, t));
  return mix(c, vec3(1.0, 0.86, 0.5), smoothstep(0.72, 1.0, t));
}
// slow churning lava: noise pushed around by noise, drifting toward you with the music
float lavaFlow(vec2 q) {
  float m = uMotion;
  vec2 w = vec2(hdNoise(q * 0.6 + vec2(0.0, uTime * 0.11 * m)), hdNoise(q * 0.6 + vec2(5.2, -uTime * 0.09 * m)));
  return hdFbm(q * 1.2 + w * 1.7 + vec2(uTime * 0.04, -uTime * 0.18) * m, 2.0 + uQ);
}
// the basalt ground: plates and glowing cracks. q is on the ground (fixed to the song), fw its change per pixel.
// Returns the colour; crack (0..1) and halo are given back for the caller to light more.
vec3 basalt(vec2 q, vec2 fw, out float crack, out float halo, out float lava) {
  const float SC = 0.42;           // plates about two and a half units across
  // the plates' edges bent a little by smooth noise, so the cracks wander like real ones
  vec2 qw = q * SC + (vec2(hdNoise(q * 0.23), hdNoise(q * 0.23 + 11.7)) - 0.5) * 0.9;
  vec3 vo = hdVoronoi(qw);
  float aa = max(fw.x, fw.y) * SC * 1.25 + 1e-4;
  float cw = 0.016;                // crack half width (cell units)
  crack = 1.0 - smoothstep(cw - aa, cw + aa, vo.y);
  // far away a crack is thinner than a pixel: keep its light as an even glow, never a shimmer of dots
  float far = clamp(aa / cw - 0.6, 0.0, 1.0);
  crack = mix(crack, 0.06, far);
  // finer cracks inside the plates (High and Ultra)
  if (uQ > 1.5) {
    vec3 v2 = hdVoronoi(qw * 2.7 + 7.3);
    float a2 = aa * 2.7;
    float k2 = clamp(0.5 / (a2 / 0.012) - 0.2, 0.0, 1.0);
    crack = max(crack, (1.0 - smoothstep(0.012 - a2, 0.012 + a2, v2.y)) * 0.3 * k2 * smoothstep(0.08, 0.25, vo.y));
  }
  lava = lavaFlow(q * 0.9);
  // parts of each crack have cooled: the lava shows in some stretches, glowing dimly in others
  float live = smoothstep(0.32, 0.72, lava);
  crack *= 0.25 + 0.75 * live;
  halo = exp(-vo.y * 14.0) * (1.0 - far * 0.6) * (0.2 + 0.8 * live);
  // the plates: dark, a little different each, slightly domed (darker toward the cracks), fine grain
  float grain = hdFbm(q * 2.3 + vo.z * 17.0, 1.0 + uQ);
  vec3 rock = vec3(0.05, 0.036, 0.032) * (0.65 + 0.7 * vo.z) * (0.7 + 0.6 * grain);
  rock *= 0.55 + 0.45 * smoothstep(0.0, 0.35, vo.y);
  return rock;
}
`;

const FLOOR = /* glsl */ `
${COMMON}
vec4 hdFloor(HDFloor f) {
  vec2 q = vec2(f.p.x, f.track);
  float crack, halo, lava;
  vec3 c = basalt(q, f.fw, crack, halo, lava);
  float pulse = 1.0 + 0.12 * uPulse * uFx;
  float t = 0.3 + 0.7 * lava + 0.15 * uHeat;
  // the hits: the cracks flare and the rock round them catches the light
  float flare = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uHitN) break;
    vec4 h = uHits[i];
    vec2 d = vec2(f.p.x - h.x, (f.p.y - h.z) * 1.4);
    flare += h.w * exp(-dot(d, d) * 1.2);
  }
  t += 0.35 * flare;
  vec3 lc = lavaRamp(t) * (0.95 + 0.7 * uHeat + 2.0 * flare) * pulse;
  // the sheen of the rock toward the glowing horizon
  c += vec3(0.5, 0.13, 0.03) * 0.1 * f.z01 * f.z01;
  // your hand position: a polished obsidian slab over the lava (the cracks dim under it)
  float inL = f.inLane;
  vec3 obs = vec3(0.016, 0.01, 0.011) + vec3(0.35, 0.08, 0.02) * 0.06 * (0.6 + 0.4 * f.cur);
  c = mix(c, obs, inL * 0.82);
  float under = mix(1.0, 0.3, inL);
  c += lc * crack * under + lavaRamp(t * 0.7) * halo * 0.2 * under;
  c += lavaRamp(0.85) * flare * 0.25;
  // the hand position's molten seams and their glow; the one you are in burns brighter
  float edge = f.lane;
  float seam = hdLine(edge, 0.03, f.fw.x * 1.2);
  float seamK = (0.55 + 0.45 * f.cur) * (1.0 + 0.6 * uHeat);
  c += lavaRamp(0.9 + 0.1 * uHeat) * seam * 2.6 * seamK;
  c += vec3(1.0, 0.32, 0.04) * exp(-abs(edge) * 7.0) * 0.45 * seamK * step(edge, 50.0);
  // inside it: faint fret lines and the beat lines glowing like embers
  c += vec3(0.75, 0.2, 0.03) * hdLine(f.fret, 0.012, f.fw.x) * inL * 0.45;
  c += vec3(1.0, 0.42, 0.08) * f.beat * inL * (0.9 + 0.5 * uPulse * uFx);
  // over a venue picture or a moving background: only the highway shows, the sides stay clear
  float a = 1.0;
  if (uOwn < 0.5) a = edge < 50.0 ? max(inL * 0.94, exp(-max(edge, 0.0) * 1.3) * 0.8) : 0.0;
  return vec4(c, a);
}
`;

const SKY = /* glsl */ `
${COMMON}
vec3 hdSky(HDSky s) {
  vec3 rd = s.rd;
  float y = rd.y;
  vec3 hor = vec3(0.62, 0.15, 0.03);
  float az = atan(rd.x, rd.z);
  vec3 c;
  if (y < -0.002) {
    // the lava fields beyond the highway: the same ground as the floor, misting into the glow
    float t = -s.ro.y / y;
    vec3 gp = s.ro + rd * t;
    vec2 q = vec2(gp.x, gp.z + uSong * uZs);
    float crack, halo, lava;
    vec3 g = basalt(q, fwidth(q), crack, halo, lava);
    g += lavaRamp(0.3 + 0.7 * lava) * (crack * 0.95 + halo * 0.2);
    g = hdFog(g, gp.z);
    c = mix(g, hor * 0.7, 1.0 - exp(-max(0.0, gp.z - uZFar) * 0.012));
  } else {
    // smoke lit from below, darker toward the top; it rolls slowly
    float yy = max(y, 0.0);
    vec2 uv = vec2(rd.x, rd.z) / (yy + 0.12);
    float m = uMotion;
    float smoke = hdFbm(uv * 0.35 + vec2(uTime * 0.012, uTime * 0.025) * m, 2.0 + uQ);
    float smoke2 = hdFbm(uv * 0.9 - vec2(uTime * 0.02, -uTime * 0.01) * m + smoke, 2.0 + uQ * 0.5);
    vec3 top = vec3(0.012, 0.004, 0.004);
    vec3 mid = vec3(0.09, 0.022, 0.012);
    c = mix(mid, top, smoothstep(0.0, 0.45, yy));
    float lit = exp(-yy * 5.0);
    c += vec3(0.5, 0.12, 0.03) * smoke * smoke2 * (0.25 + 0.9 * lit);
    // far mountains: two dark ridges against the glow, the nearer one rimmed with light
    float r1 = 0.018 + 0.05 * hdFbm(vec2(az * 3.0, 1.7), 4.0);
    float r2 = 0.01 + 0.035 * hdFbm(vec2(az * 5.0 + 9.0, 3.1), 4.0);
    float aa = fwidth(y) * 1.2;
    float m1 = 1.0 - smoothstep(r1 - aa, r1 + aa, y);
    float m2 = 1.0 - smoothstep(r2 - aa, r2 + aa, y);
    vec3 glowH = hor * (exp(-yy * 22.0) * 0.9 + exp(-yy * 6.0) * 0.25);
    c += glowH;
    c = mix(c, vec3(0.05, 0.012, 0.008) + hor * 0.12, m1);
    c = mix(c, vec3(0.025, 0.007, 0.005), m2);
    c += vec3(1.0, 0.35, 0.05) * exp(-abs(y - r2) / max(aa, 0.002) * 0.5) * 0.25 * (1.0 - m2) * smoothstep(0.0, 0.01, y);
    // a volcano's glow far off to one side
    float v = exp(-pow((az - 0.55) * 5.0, 2.0)) * exp(-yy * 9.0);
    c += vec3(1.0, 0.3, 0.04) * v * (0.35 + 0.1 * sin(uTime * 0.7) * m);
  }
  // the line where the ground meets the sky glows hottest
  c += hor * exp(-abs(y) * 60.0) * 0.6 * (1.0 + 0.4 * uHeat);
  return c;
}
`;

const GEM = /* glsl */ `
// 4.34.1: molten metal. A crust of dark, cooled metal in the string's colour, broken into plates; between
// them the metal still glows, hottest in the middle of the face, cooler (more crust, thinner cracks) toward
// the edges, and a hot lip runs round the bevel. The string's colour is kept everywhere: the crust is
// tinted with it and the cracks glow in it (only their thin centres go toward white).
vec4 hdGem(HDGem g) {
  vec3 base = g.col;
  if (g.missed > 0.5) {
    // cooled to grey iron: lit, no glow
    vec3 iron = vec3(0.13, 0.125, 0.13);
    return vec4(hdGemLit(g, iron, 0.45), 1.0);
  }
  float kindK = g.kind > 1.5 ? 0.45 : 1.0;   // a chord's frame glows less than its notes
  // each note its own pattern (fixed to the note, never to the screen)
  vec2 ctr = g.wp.xy - g.l.xy * g.size;
  float seed = hdHash(ctr * vec2(3.7, 11.3));
  vec2 asp = g.size / min(g.size.x, g.size.y);
  float rr = length(max(abs(g.l.xy) * asp - (asp - 1.0), 0.0));  // 0 in the middle, 1 at the edge (round corners)
  float mid = 1.0 - smoothstep(0.0, 1.0, rr);
  float boost = 0.6 * g.near + 0.5 * g.hold + 2.0 * g.hit + 0.25 * uHeat + 0.3 * g.accent;
  // a few big plates of crust per note (they read even when the note is small)
  vec2 q = g.l.xy * asp * 1.6 + seed * 23.0;
  if (g.hold > 0.5) q.y -= uTime * 0.5 * uMotion;   // a held note's metal keeps moving
  vec3 vo = hdVoronoi(q);
  float aa = length(fwidth(q)) * 0.8 + 1e-4;
  float cw = 0.05 + 0.08 * mid;
  float crack = 1.0 - smoothstep(cw - aa, cw + aa, vo.y);
  float far = clamp(aa / cw - 0.6, 0.0, 1.0);        // thinner than a pixel: an even glow instead
  crack = mix(crack, 0.2, far);
  // the crust has cooled over the edges; in the middle the metal is open and molten
  float wob = hdNoise(q * 1.7 + 3.0) - 0.5;
  float pool = (1.0 - smoothstep(0.5, 0.8, rr + wob * 0.4 - 0.15 * min(boost, 1.5))) * step(g.kind, 1.5);
  float onFront = smoothstep(-0.2, 0.6, -g.nl.z);    // face and bevel; the sides are plain crust
  pool *= onFront;
  // the crust: dark metal tinted with the string's colour, each plate a little different, lit as a block;
  // underneath it the lava's orange light catches the lower bevel
  vec3 crustAlb = mix(vec3(0.035, 0.028, 0.026), base, 0.16 + 0.1 * vo.z);
  vec3 crust = hdGemLit(g, crustAlb, 1.1);
  crust += vec3(1.0, 0.35, 0.06) * 0.22 * clamp(-g.nl.y, 0.0, 1.0);
  crust += base * 0.05 * (1.0 + boost);
  // glowing cracks between the plates, in the string's colour
  vec3 hot = mix(base, vec3(1.0, 0.85, 0.6), 0.25);
  crust += hot * crack * (0.55 + 0.6 * mid + 0.5 * boost) * onFront * (1.0 - far * 0.5);
  crust += base * exp(-vo.y * 10.0) * 0.18 * onFront;
  // the open metal: bright in the string's colour, a white-hot shimmer only as it lands or is hit
  float stir = hdNoise(q * 2.3 + vec2(0.0, uTime * 0.7 * uMotion));
  vec3 molten = base * (0.95 + 0.35 * stir + 0.35 * boost) + vec3(1.0, 0.85, 0.6) * (0.06 + 0.25 * clamp(boost - 0.5, 0.0, 1.0)) * (0.5 + stir);
  molten += vec3(1.0) * g.spec * 0.6;               // liquid shine
  vec3 c = mix(crust, molten, pool * smoothstep(0.0, 0.3, 1.0 - g.bevel));
  // the hot lip round the bevel
  float lip = smoothstep(0.6, 0.98, g.bevel) * onFront;
  vec3 lipC = mix(base * 1.1, vec3(1.0, 0.9, 0.75), clamp(0.08 + 0.35 * g.near + 1.0 * g.hit, 0.0, 0.7));
  c += lipC * lip * (0.55 + 0.35 * g.near + 1.2 * g.hit + 0.4 * g.accent);
  // a bend: the face runs a little warmer
  c += vec3(1.0, 0.45, 0.08) * g.face * g.bend * 0.08;
  c *= mix(1.0, kindK, onFront * 0.6);
  // never a white blob: bright parts roll off softly and keep their colour
  float m = max(c.r, max(c.g, c.b));
  if (m > 1.0) c *= (1.0 + log(m)) / m;
  return vec4(c, 1.0);
}
`;

const TUBE = /* glsl */ `
vec4 hdTube(HDTube t) {
  vec3 L1 = normalize(vec3(-0.3, 0.75, 0.6));
  vec3 n = t.n;
  vec3 v = t.v;
  float dif = max(dot(n, L1), 0.0);
  float spec = pow(max(dot(n, normalize(L1 + v)), 0.0), 50.0);
  float facing = max(dot(n, v), 0.0);
  vec3 r = reflect(-v, n);
  vec3 env = mix(vec3(1.0, 0.33, 0.05), vec3(0.05, 0.025, 0.02), smoothstep(-0.3, 0.3, r.y));
  if (t.kind < 0.5) {
    // a string: hot wire in its colour, brightest down its core; wound strings show their winding
    float wind = 1.0;
    if (t.wound > 0.5) {
      float w = t.along * 200.0;
      float aw = fwidth(w);
      wind = 0.72 + 0.28 * mix(0.5 + 0.5 * sin(w * 6.2832), 0.5, clamp(aw * 1.5 - 0.3, 0.0, 1.0));
    }
    float flow = 1.0 + 0.12 * sin(t.along * 1.7 - uTime * 2.5) * uMotion;
    vec3 hot = mix(t.col, vec3(1.0, 0.95, 0.82), 0.12 + 0.35 * t.glow);
    vec3 c = t.col * (0.35 + 0.5 * dif) * wind + hot * pow(facing, 1.2) * (1.1 + 1.1 * t.glow + 0.35 * uHeat) * flow * wind;
    c += vec3(1.0, 0.88, 0.75) * spec * 0.7 * wind;
    return vec4(c, 1.0);
  }
  if (t.kind < 1.5) {
    // a fret wire: dark steel catching the lava's light; warms on a streak
    float fr = hdFresnel(n, v, 2.0);
    vec3 c = vec3(0.32, 0.31, 0.33) * (0.25 + 0.75 * dif) + env * 0.35 * (0.3 + 0.7 * fr) + vec3(1.0, 0.92, 0.85) * spec * 1.2;
    c += vec3(1.0, 0.42, 0.08) * t.glow * 0.7 * pow(facing, 1.5);
    return vec4(c, 1.0);
  }
  if (t.kind < 2.5) {
    // the nut: scorched bone
    vec3 c = vec3(0.42, 0.36, 0.29) * (0.25 + 0.75 * dif) + env * 0.15 + spec * 0.35;
    return vec4(c, 1.0);
  }
  // a light post: white-hot metal in the light's colour
  // (4.34.1: in the light's colour with only a thin hot core, so a chord's posts never blaze white)
  vec3 c = t.col * (0.25 + 0.85 * t.glow) * (0.45 + 0.75 * pow(facing, 2.0));
  c += vec3(1.0, 0.8, 0.5) * pow(facing, 6.0) * 0.35 * t.glow;
  c += vec3(1.0, 0.9, 0.8) * spec * 0.4;
  return vec4(c, 1.0);
}
`;

const TRAIL = /* glsl */ `
vec4 hdTrail(HDTrail r) {
  float a = abs(r.u);
  bool missed = r.missed > 0.5;
  vec3 base = missed ? vec3(0.28, 0.26, 0.26) : r.col;
  float body = 1.0 - smoothstep(1.0 - r.fu * 1.5, 1.0 + r.fu * 1.5, a);
  // molten metal running toward you along the note, fixed to it (it moves with the music)
  float m = uMotion;
  float f1 = hdNoise(vec2(r.u * 1.3 + 3.0, r.t * 9.0 + uTime * 2.2 * m));
  float f2 = hdNoise(vec2(r.u * 3.1 - 1.0, r.t * 23.0 + uTime * 3.6 * m));
  float flow = f1 * 0.65 + f2 * 0.35;
  float centre = 1.0 - smoothstep(0.0, 0.9, a);
  float heat = 0.55 + 0.9 * r.holding + 0.6 * r.lift;
  vec3 hot = mix(base, vec3(1.0, 0.9, 0.66), centre * (0.15 + 0.55 * r.holding + 0.3 * r.lift));
  vec3 c = mix(base * 0.45, hot, 0.35 + 0.65 * flow) * heat;
  c += base * smoothstep(0.72, 0.95, a) * body * 0.9;
  float glow = exp(-max(a - 1.0, 0.0) * 2.6) * (0.22 + 0.3 * r.holding);
  if (missed) {
    c = base * (0.55 + 0.35 * flow);
    glow *= 0.15;
  }
  return vec4(mix(base * (1.0 + r.holding), c, body), clamp(body * 0.94 + (1.0 - body) * glow, 0.0, 1.0));
}
`;

export default function build(K) {
  // hits: white-hot sparks that fly up and fall, embers that rise slowly, a few drops of lava
  // 4.34.1: sparks start hot yellow (not white) with a touch of the string's colour, so a splash reads as
  // fire on that string and never washes out the notes beside it
  const sparks = K.emitter({ max: 1600, life: [0.4, 0.95], speed: [3.5, 8.0], up: 1, spread: 2.3, toward: [-2.4, 0.6], accel: [0, -9.5, 0], drag: 1.2, size: [0.085, 0.035], shape: 1, stretch: 0.1, colA: [1.7, 1.1, 0.5], tintA: 0.2, colB: [1.0, 0.25, 0.02], tintB: 0.3, alpha: 1, jitter: 0.12 });
  // the flare: a hot ring that spreads from the note and is gone in a third of a second (Hit burst)
  const flare = K.emitter({ max: 120, life: [0.28, 0.34], speed: [0, 0], up: 0, spread: 0, accel: [0, 0, 0], drag: 0, size: [0.12, 0.75], shape: 3, colA: [1, 0.6, 0.18], tintA: 0.35, colB: [0.7, 0.12, 0.01], tintB: 0.2, alpha: 0.55 });
  // and a soft glow of the lava behind it, low and wide (only light, never a white disc)
  const glow = K.emitter({ max: 120, life: [0.22, 0.3], speed: [0, 0], up: 0, spread: 0, accel: [0, 0, 0], drag: 0, size: [0.5, 0.9], shape: 4, colA: [0.9, 0.32, 0.05], tintA: 0.25, colB: [0.4, 0.06, 0], alpha: 0.5 });
  const embers = K.emitter({ max: 600, life: [1.1, 2.3], speed: [0.3, 1.2], up: 1, spread: 2.0, toward: [-0.6, 0.6], accel: [0, 1.3, 0], drag: 1.1, size: [0.075, 0.03], shape: 0, colA: [1, 0.62, 0.16], colB: [0.6, 0.07, 0], alpha: 0.9, jitter: 0.25, stagger: 0.15 });
  const drops = K.emitter({ max: 300, life: [0.45, 0.8], speed: [1.6, 3.2], up: 1, spread: 1.8, toward: [-1.2, 0.3], accel: [0, -8, 0], drag: 0.6, size: [0.09, 0.06], shape: 0, colA: [1, 0.82, 0.42], colB: [0.85, 0.18, 0], alpha: 0.95, jitter: 0.08 });
  const trickle = K.emitter({ max: 400, life: [0.25, 0.55], speed: [1.0, 2.6], up: 1, spread: 2.2, toward: [-1, 0.4], accel: [0, -6, 0], drag: 1.2, size: [0.035, 0.016], shape: 1, stretch: 0.05, colA: [1, 0.9, 0.7], colB: [1, 0.35, 0.03], alpha: 0.9, jitter: 0.1 });
  // all the time: embers drifting up from the lava, and big soft ones far off (more on a streak)
  K.field({ count: 900, box: [-16, 16, -0.2, 7, -2, 46], vel: [0.12, 0.5, -0.45], size: [0.018, 0.045], colA: '#ffb347', colB: '#ff3a0a', alpha: 0.85, sway: 0.35, heatMore: 0.8 });
  K.field({ count: 90, box: [-30, 30, 1, 14, 18, 70], vel: [0.2, 0.35, -0.6], size: [0.12, 0.3], colA: '#ff7a2a', colB: '#ff2a05', alpha: 0.13, sway: 0.6 });
  let acc = 0;
  return {
    floor: { glsl: FLOOR },
    sky: { glsl: SKY },
    gem: { glsl: GEM },
    tube: { glsl: TUBE },
    trail: { glsl: TRAIL },
    haze: 0.85,
    chordGlass: ['#2a0702', '#3d0e04'],
    onHit(e) {
      const k = e.dead ? 1.25 : 1;
      sparks.burst(e.x, e.y, e.z - 0.05, e.chord ? 24 : 38, e.rgb, k);
      glow.burst(e.x, e.y, e.z - 0.09, 1, e.rgb, k * (e.chord ? 0.6 : 1));
      if (e.burst) flare.burst(e.x, e.y, e.z - 0.1, 1, e.rgb, k);
      embers.burst(e.x, e.y, e.z, 10, e.rgb, k);
      drops.burst(e.x, e.y, e.z - 0.05, e.dead ? 5 : 3, e.rgb, k);
    },
    frame(F) {
      // a held note keeps throwing a few sparks
      if (!F.holdN || !F.motion) {
        acc = 0;
        return;
      }
      acc += F.dt * 22;
      const n = Math.floor(acc);
      if (!n) return;
      acc -= n;
      for (let i = 0; i < F.holdN; i++) trickle.burst(F.holds[i * 3], F.holds[i * 3 + 1], F.holds[i * 3 + 2] - 0.04, n, ZERO_RGB, 1);
    },
  };
}
const ZERO_RGB = [1, 0.5, 0.1];
