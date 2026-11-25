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
vec4 hdGem(HDGem g) {
  vec3 L1 = normalize(vec3(-0.3, 0.75, 0.6));
  vec3 n = g.n;
  vec3 v = g.v;
  bool missed = g.missed > 0.5;
  vec3 base = missed ? vec3(0.2, 0.19, 0.2) : g.col;
  float dif = max(dot(n, L1), 0.0);
  float spec = pow(max(dot(n, normalize(L1 + v)), 0.0), 70.0);
  vec3 r = reflect(-v, n);
  // what the metal reflects: glowing lava below, dark smoke above
  vec3 env = mix(vec3(1.0, 0.5, 0.16) * 0.7, vec3(0.05, 0.02, 0.018), smoothstep(-0.4, 0.3, r.y));
  float fr = hdFresnel(n, v, 4.0);
  vec3 metal = mix(base, vec3(1.0), 0.18);
  vec3 c = base * 0.16 * (0.3 + dif) + metal * env * (0.2 + 0.6 * fr) + vec3(1.0, 0.92, 0.8) * spec * (missed ? 0.3 : 1.1);
  if (missed) return vec4(c, 1.0);
  // the face toward you: a molten core under a cooled crust, hottest in the middle
  float front = smoothstep(0.8, 0.98, -g.nl.z);
  float rr = max(abs(g.l.x), abs(g.l.y));
  float core = 1.0 - smoothstep(0.25, 0.95, rr);
  float crust = smoothstep(0.42, 0.7, hdFbm(g.l.xy * vec2(2.2, 1.6) + g.wp.x * 1.7 + g.col.r * 5.0, 2.0 + uQ * 0.7));
  float heat = 0.85 + 1.1 * g.near + 2.2 * g.flare + 0.3 * uHeat;
  vec3 molten = mix(base * 1.2, vec3(1.0, 0.88, 0.62), 0.2 + 0.45 * g.near + 0.4 * g.flare);
  float kindK = g.kind > 1.5 ? 0.35 : 1.0;
  c += front * molten * heat * kindK * (0.45 + 0.55 * core) * mix(1.0, 0.55, crust * (1.0 - g.near * 0.7));
  // the sides glow dimly too: the whole block is hot
  c += base * 0.28 * kindK * (1.0 - front);
  // the rim: the rounded edges burn, white-hot as the note reaches the neck
  float bevel = 1.0 - max(abs(g.nl.x), max(abs(g.nl.y), abs(g.nl.z)));
  float rim = smoothstep(0.04, 0.28, bevel) * step(g.nl.z, 0.3);
  vec3 rimC = mix(base * 1.4, vec3(1.0, 0.95, 0.85), clamp(0.15 + g.near * 0.8 + g.flare, 0.0, 1.0));
  c += rimC * rim * (0.8 + 1.8 * g.near + 3.0 * g.flare + 1.2 * g.accent);
  // a bend: the face glows a little warmer
  c += vec3(1.0, 0.5, 0.1) * front * g.bend * 0.15;
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
  vec3 c = mix(t.col, vec3(1.0, 0.92, 0.8), 0.3) * (0.25 + 1.4 * t.glow) * (0.45 + 0.75 * pow(facing, 2.0));
  c += vec3(1.0, 0.9, 0.8) * spec * 0.5;
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
  const sparks = K.emitter({ max: 1600, life: [0.4, 0.95], speed: [3.5, 8.0], up: 1, spread: 2.3, toward: [-2.4, 0.6], accel: [0, -9.5, 0], drag: 1.2, size: [0.05, 0.022], shape: 1, stretch: 0.06, colA: [1.8, 1.5, 1.1], colB: [1, 0.28, 0.02], tintB: 0.25, alpha: 1, jitter: 0.12 });
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
      sparks.burst(e.x, e.y, e.z - 0.05, e.chord ? 22 : 40, e.rgb, k);
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
