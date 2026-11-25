/**
 * 4.34: Frozen Lake, drawn with its own graphics (see hdstyle.js and docs/hd-styles.md).
 *
 * A clear frozen lake at night. You look down into dark ice: pale cracks lie under the surface at two
 * depths, trapped bubbles hang in stacks, and the moonlit sky and the aurora shine faintly off the top.
 * Frost dusts the ice away from the highway. Your hand position is a slab of polished clear ice with frosted
 * edges. Far off, a snowy shore and a line of pines stand under a moon, stars and a slow green aurora.
 * Notes are cut ice crystal in their string's colour (facets, a bright rim); strings are frosted steel.
 * Hits throw ice shards and glints and a bloom of frost spreads over the ice round them. Snow falls.
 */

// shared by the floor and the sky: the sky's colour in a direction (used for reflections too), and the ice
const COMMON = /* glsl */ `
const vec3 MOON = vec3(-0.5, 0.3, 0.81);       // toward the moon (world: x across, y up, z ahead)
vec3 skyBase(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 top = vec3(0.006, 0.012, 0.035);
  vec3 mid = vec3(0.025, 0.05, 0.1);
  vec3 hor = vec3(0.12, 0.2, 0.3);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.12, y));
  c = mix(c, top, smoothstep(0.1, 0.6, y));
  // the moon's glow over the sky
  float md = max(dot(normalize(rd), MOON), 0.0);
  c += vec3(0.35, 0.45, 0.6) * (pow(md, 40.0) * 0.35 + pow(md, 6.0) * 0.06);
  return c;
}
// the aurora: green curtains low over the far shore, violet at their tops, slowly folding
vec3 aurora(vec3 rd, float detail) {
  float y = rd.y;
  if (y < 0.0) return vec3(0.0);
  float az = atan(rd.x, rd.z);
  float m = uMotion;
  float t = uTime * 0.03 * m;
  float base = 0.07 + 0.05 * hdNoise(vec2(az * 1.6 + t, 3.0)) + 0.03 * sin(az * 3.0 + t * 2.0);
  float h = y - base;
  float bot = smoothstep(-0.015, 0.012, h);
  float up = exp(-max(h, 0.0) * 9.0);
  float band = bot * up;
  // where along the sky the curtain is strong
  float strong = smoothstep(0.25, 0.75, hdNoise(vec2(az * 1.1 - t * 1.5, 7.0)));
  // soft vertical rays (wide enough never to shimmer)
  float rays = 0.55 + 0.45 * hdNoise(vec2(az * 26.0 + t * 6.0, h * 3.0 + t));
  if (detail > 0.5) rays *= 0.75 + 0.25 * hdNoise(vec2(az * 60.0 - t * 4.0, h * 2.0));
  vec3 green = vec3(0.12, 0.85, 0.5);
  vec3 violet = vec3(0.4, 0.2, 0.75);
  vec3 col = mix(green, violet, smoothstep(0.0, 0.18, h));
  return col * band * strong * rays * 0.42 * (0.85 + 0.25 * uFx);
}
// the ice seen from above: its colour, given the point on the ice q (fixed to the song), the view ray rd,
// and its change per pixel fw. deep (0 Low .. 1) asks for the bubbles and the deeper cracks.
vec3 iceDeep(vec2 q, vec3 rd, vec2 fw, float detail, out float crackOut) {
  // the view ray bends going into the ice (steeper), so things under the surface slide less than they would
  vec3 rr = refract(rd, vec3(0.0, 1.0, 0.0), 0.76);
  vec2 par = rr.xz / max(-rr.y, 0.08);
  float px = max(fw.x, fw.y);
  // the water far below: dark, a little green-blue, uneven
  vec2 qd = q + par * 2.5;
  float murk = hdFbm(qd * 0.12, 2.0 + uQ * 0.5);
  vec3 c = mix(vec3(0.004, 0.018, 0.036), vec3(0.02, 0.07, 0.11), murk);
  // cracks: long straight fractures in the ice, two depths: a deep soft one and a shallow sharper one
  crackOut = 0.0;
  for (int k = 0; k < 2; k++) {
    if (k == 1 && uQ < 0.5) break;
    float fk = float(k);
    float dep = mix(0.35, 0.9, fk);
    float sc = mix(0.17, 0.11, fk);
    vec2 qc = (q + par * dep) * sc + fk * 17.3;
    vec3 vo = hdVoronoi(qc);
    float aa = px * sc * 1.3 + 1e-4;
    float w = mix(0.008, 0.016, fk);
    // only some borders crack: the rest of each cell's edge is whole ice
    float live = smoothstep(0.42, 0.62, hdNoise((q + par * dep) * 0.09 + fk * 5.1));
    float core = 1.0 - smoothstep(w - aa, w + aa, vo.y);
    float glow = exp(-vo.y / (w * 6.0 + aa));
    float far = clamp(aa / w - 0.7, 0.0, 1.0);
    core = mix(core, 0.08, far);
    float kk = mix(1.0, 0.45, fk);
    vec3 cc = vec3(0.62, 0.8, 0.95);
    c += cc * live * (core * 0.75 + glow * 0.22) * kk;
    crackOut = max(crackOut, live * core * kk);
  }
  // bubbles trapped in the ice: little white discs, stacked where the gas rose (High and Ultra: three deep)
  float layers = uQ < 0.5 ? 1.0 : (uQ < 1.5 ? 2.0 : 3.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    if (fk >= layers) break;
    float dep = 0.12 + fk * 0.22;
    vec2 qb = (q + par * dep) * 1.35;
    vec2 cell = floor(qb);
    vec2 h = hdHash2(cell + 31.0);
    float patchK = smoothstep(0.45, 0.75, hdNoise(cell * 0.13 + 2.0));
    if (h.x * patchK > 0.32) {
      vec2 ctr = cell + 0.25 + 0.5 * hdHash2(cell + 7.0);
      float r = (0.05 + 0.12 * h.y) * (1.0 - fk * 0.22);
      float d = length(qb - ctr);
      float aa = px * 1.35 * 1.2 + 1e-4;
      float disc = 1.0 - smoothstep(r - aa, r + aa, d);
      float rim = disc * smoothstep(r * 0.5, r, d);
      float tiny = clamp(r / aa - 1.0, 0.0, 1.0);
      vec3 bc = vec3(0.7, 0.85, 1.0);
      c += bc * (disc * 0.12 + rim * 0.42) * tiny * (1.0 - fk * 0.25);
      // the bright moon glint on top of each bubble
      c += vec3(1.0) * (1.0 - smoothstep(0.0, r * 0.35 + aa, length(qb - ctr - vec2(-0.3, 0.35) * r))) * 0.5 * tiny;
    }
  }
  return c;
}
// frost on the surface: soft white patches, more toward the edges of the lake
float frost(vec2 q, float more) {
  float n = hdFbm(q * 0.35, 2.0 + uQ * 0.7);
  float fine = hdNoise(q * 2.7);
  return smoothstep(0.55 - 0.25 * more, 0.85, n) * (0.7 + 0.3 * fine);
}
`;

const FLOOR = /* glsl */ `
${COMMON}
vec4 hdFloor(HDFloor f) {
  vec2 q = vec2(f.p.x, f.track);
  vec3 cam = vec3(uCamPos.x, uCamPos.y, -uCamPos.z);
  vec3 rd = normalize(vec3(f.p.x, 0.0, f.p.y) - cam);
  float crack;
  vec3 c = iceDeep(q, rd, f.fw, uQ, crack);
  float inL = f.inLane;
  float edge = f.lane;
  // the sky reflected off the top of the ice (more at a glancing look)
  vec3 rf = reflect(rd, vec3(0.0, 1.0, 0.0));
  float fr = 0.04 + 0.96 * pow(1.0 - max(-rd.y, 0.0), 5.0);
  vec3 refl = skyBase(rf) + aurora(rf, 0.0) * 0.6;
  c += refl * fr * 0.85;
  // frost dusting: thicker away from the highway, none in the hand position
  float side = smoothstep(1.0, 6.0, edge);
  float fz = frost(q, side) * (0.25 + 0.75 * side) * (1.0 - inL);
  c = mix(c, vec3(0.42, 0.52, 0.62), fz * 0.55);
  // the hits: frost blooms out over the ice round each one, and the ice lights up under it
  float bloom = 0.0;
  float lit = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uHitN) break;
    vec4 h = uHits[i];
    float age = -0.35 * log(max(h.w, 1e-3));
    float R = 0.25 + 1.6 * (1.0 - exp(-age * 3.0));
    vec2 d = vec2(f.p.x - h.x, (f.p.y - h.z) * 1.3);
    float dl = length(d);
    float inside = 1.0 - smoothstep(R * 0.55, R, dl);
    float feather = hdNoise(q * 3.2 + vec2(atan(d.y, d.x) * 2.0, 0.0));
    bloom += inside * smoothstep(0.25, 0.75, feather + 0.25 * (1.0 - dl / R)) * min(1.0, h.w * 2.5);
    lit += h.w * exp(-dl * dl * 2.0);
  }
  bloom = clamp(bloom, 0.0, 1.0) * uFx;
  c += vec3(0.4, 0.75, 1.0) * lit * 0.22;
  c = mix(c, vec3(0.75, 0.88, 1.0), bloom * 0.45);
  // your hand position: a slab of polished clear ice, lighter and bluer, frosted at its edges
  vec3 slab = c * 0.65 + vec3(0.04, 0.1, 0.15) * (0.75 + 0.25 * f.cur);
  c = mix(c, slab, inL * 0.85);
  float rimIn = smoothstep(-0.32, 0.0, edge) * inL;
  float rimK = 0.6 + 0.4 * f.cur;
  c += vec3(0.6, 0.8, 1.0) * rimIn * 0.22 * rimK;
  c += vec3(0.8, 0.93, 1.0) * hdLine(edge, 0.022, f.fw.x * 1.2) * 1.3 * rimK;
  c += vec3(0.35, 0.65, 1.0) * exp(-abs(edge) * 6.0) * 0.18 * rimK * step(edge, 50.0);
  // inside it: fret lines etched in the ice, beat lines like frost lines
  c += vec3(0.6, 0.8, 0.95) * hdLine(f.fret, 0.012, f.fw.x) * inL * 0.32;
  c += vec3(0.75, 0.9, 1.0) * f.beat * inL * (0.55 + 0.3 * uPulse * uFx);
  // the moon's path on the ice, far off
  c += vec3(0.25, 0.32, 0.42) * f.z01 * f.z01 * 0.35;
  float a = 1.0;
  if (uOwn < 0.5) a = edge < 50.0 ? max(inL * 0.94, exp(-max(edge, 0.0) * 1.3) * 0.8) : 0.0;
  return vec4(c, a);
}
`;

const SKY = /* glsl */ `
${COMMON}
// a line of pines along the far shore at azimuth az; returns how tall the trees stand there
float pines(float az, float cellW, float hMax, float seed) {
  float s = az / cellW;
  float ci = floor(s);
  float top = 0.0;
  for (int k = -1; k <= 1; k++) {
    float id = ci + float(k);
    float hh = hdHash(vec2(id, seed));
    float gap = step(0.18, hdNoise(vec2(id * 0.11, seed)));      // clearings
    float h = hMax * (0.45 + 0.55 * hh) * gap;
    float cx = id + 0.5 + (hdHash(vec2(id, seed + 3.0)) - 0.5) * 0.5;
    float dx = abs(s - cx) * cellW;
    // a pine: narrow at the top, its boughs in soft tiers
    float y = h - dx / 0.32;
    float tier = 1.0 - 0.18 * fract(y / h * 4.0);
    top = max(top, h - dx / (0.32 * tier));
  }
  return top;
}
vec3 hdSky(HDSky s) {
  vec3 rd = s.rd;
  float y = rd.y;
  float az = atan(rd.x, rd.z);
  float aa = fwidth(y) * 1.2 + 1e-5;
  // the far shore: a snowbank, and two lines of pines behind it
  float bank = 0.006 + 0.004 * hdFbm(vec2(az * 6.0, 1.3), 3.0);
  float far = bank + max(pines(az, 0.009, 0.026, 4.0), 0.0) + 0.004 * hdNoise(vec2(az * 3.0, 9.0));
  float near = bank + max(pines(az + 0.37, 0.014, 0.045, 11.0), 0.0) * smoothstep(0.2, 0.55, hdNoise(vec2(az * 1.3, 2.0)));
  vec3 c;
  if (y < -0.0005) {
    // the rest of the lake: dark clear ice reflecting the sky and the shore
    float t = -s.ro.y / y;
    vec3 gp = s.ro + rd * t;
    vec2 q = vec2(gp.x, gp.z + uSong * uZs);
    float crack;
    vec3 g = iceDeep(q, rd, fwidth(q), 0.0, crack);
    vec3 rf = reflect(rd, vec3(0.0, 1.0, 0.0));
    float fr = 0.04 + 0.96 * pow(1.0 - max(-rd.y, 0.0), 5.0);
    vec3 refl = skyBase(rf) + aurora(rf, 0.0) * 0.6;
    // the shore's reflection, soft
    float ry = -y;
    float shoreR = 1.0 - smoothstep(near - 0.004, near + 0.006, ry);
    refl = mix(refl, vec3(0.01, 0.02, 0.03), shoreR * 0.85);
    g += refl * fr * 0.85;
    float fz = frost(q, 1.0);
    g = mix(g, vec3(0.42, 0.52, 0.62), fz * 0.45);
    g = hdFog(g, gp.z);
    c = mix(g, vec3(0.1, 0.16, 0.24), 1.0 - exp(-max(0.0, gp.z - uZFar) * 0.01));
    return c;
  }
  c = skyBase(rd);
  // stars: soft points that twinkle a little
  vec2 sg = vec2(az, y) * 110.0;
  vec2 sc = floor(sg);
  vec2 sh = hdHash2(sc);
  if (sh.x > 0.86) {
    vec2 sp = sc + 0.2 + 0.6 * hdHash2(sc + 5.0);
    float d = length(sg - sp) / max(fwidth(sg.x), 1e-4);
    float tw = 0.75 + 0.25 * sin(uTime * (1.0 + sh.y * 2.0) * uMotion + sh.y * 40.0);
    c += vec3(0.8, 0.88, 1.0) * exp(-d * d * 0.8) * (0.25 + 0.75 * sh.y) * tw * smoothstep(0.03, 0.12, y);
  }
  c += aurora(rd, 1.0);
  // the moon
  vec3 md = normalize(rd);
  float dm = length(cross(md, MOON));
  float mr = 0.026;
  float maw = fwidth(dm) * 1.2 + 1e-5;
  float disc = (1.0 - smoothstep(mr - maw, mr + maw, dm)) * step(0.0, dot(md, MOON));
  float maria = hdFbm(vec2(dot(md, vec3(1, 0, 0)), md.y) * 160.0, 3.0);
  c = mix(c, vec3(0.92, 0.95, 1.0) * (0.82 + 0.18 * smoothstep(0.35, 0.65, maria)), disc);
  c += vec3(0.5, 0.6, 0.75) * exp(-dm * 22.0) * 0.18;
  // the horizon's cold mist
  c += vec3(0.16, 0.24, 0.34) * exp(-y * 40.0) * 0.5;
  // the far pines, misty blue; the snowbank lit by the moon; the near pines dark
  float mFar = 1.0 - smoothstep(far - aa, far + aa, y);
  c = mix(c, vec3(0.06, 0.1, 0.15), mFar * 0.9);
  float mNear = 1.0 - smoothstep(near - aa, near + aa, y);
  c = mix(c, vec3(0.012, 0.022, 0.035), mNear);
  float mBank = 1.0 - smoothstep(bank - aa, bank + aa, y);
  c = mix(c, vec3(0.38, 0.46, 0.58) * (0.8 + 0.2 * hdNoise(vec2(az * 40.0, 1.0))), mBank);
  return c;
}
`;

const TUBE = /* glsl */ `
vec4 hdTube(HDTube t) {
  vec3 L1 = normalize(vec3(-0.35, 0.75, 0.55));
  vec3 n = t.n;
  vec3 v = t.v;
  float dif = max(dot(n, L1), 0.0);
  vec3 hv = normalize(L1 + v);
  float spec = pow(max(dot(n, hv), 0.0), 90.0);
  float spec2 = pow(max(dot(n, hv), 0.0), 14.0);
  float facing = max(dot(n, v), 0.0);
  vec3 r = reflect(-v, n);
  // the cold night: pale sky above, dark ice below
  vec3 env = mix(vec3(0.03, 0.06, 0.1), vec3(0.55, 0.68, 0.85), smoothstep(-0.25, 0.45, r.y));
  float fr = hdFresnel(n, v, 3.0);
  if (t.kind < 0.5) {
    // a string: steel in its colour, frost on its top side, a sharp cold shine
    float wind = 1.0;
    if (t.wound > 0.5) {
      float w = t.along * 200.0;
      float aw = fwidth(w);
      wind = 0.75 + 0.25 * mix(0.5 + 0.5 * sin(w * 6.2832), 0.5, clamp(aw * 1.5 - 0.3, 0.0, 1.0));
    }
    float fz = smoothstep(0.1, 0.8, n.y) * smoothstep(0.35, 0.75, hdNoise(vec2(t.along * 3.0, t.str * 7.0)));
    vec3 core = t.col * (0.55 + 0.55 * dif) * wind + t.col * pow(facing, 1.5) * (0.65 + 1.2 * t.glow);
    vec3 c = core + env * fr * 0.5;
    c = mix(c, vec3(0.85, 0.93, 1.0), fz * 0.28);
    c += vec3(0.9, 0.96, 1.0) * (spec * 1.3 + spec2 * 0.12) * wind;
    c += mix(t.col, vec3(1.0), 0.5) * t.glow * 0.6;
    return vec4(c, 1.0);
  }
  if (t.kind < 1.5) {
    // a fret wire: polished cold silver
    vec3 c = vec3(0.42, 0.46, 0.52) * (0.25 + 0.75 * dif) + env * (0.35 + 0.65 * fr) + vec3(0.95, 0.98, 1.0) * spec * 1.4;
    c += vec3(0.5, 0.8, 1.0) * t.glow * 0.7 * pow(facing, 1.5);
    return vec4(c, 1.0);
  }
  if (t.kind < 2.5) {
    // the nut: a bar of white ice
    vec3 c = vec3(0.62, 0.72, 0.82) * (0.3 + 0.7 * dif) + env * 0.3 + spec * 0.6;
    return vec4(c, 1.0);
  }
  // a light post: a glowing icicle in the light's colour
  vec3 c = mix(t.col, vec3(0.9, 0.96, 1.0), 0.35) * (0.3 + 1.3 * t.glow) * (0.45 + 0.75 * pow(facing, 2.0));
  c += vec3(0.95, 0.98, 1.0) * spec * 0.6 + env * fr * 0.3;
  return vec4(c, 1.0);
}
`;

const TRAIL = /* glsl */ `
vec4 hdTrail(HDTrail r) {
  float a = abs(r.u);
  bool missed = r.missed > 0.5;
  vec3 base = missed ? vec3(0.3, 0.34, 0.4) : r.col;
  float body = 1.0 - smoothstep(1.0 - r.fu * 1.5, 1.0 + r.fu * 1.5, a);
  // a channel of coloured ice: clear in the middle, frosted white at its edges, a slow shimmer along it
  float m = uMotion;
  float s1 = hdNoise(vec2(r.u * 1.5 + 2.0, r.t * 6.0 + uTime * 0.8 * m));
  float centre = 1.0 - smoothstep(0.0, 0.85, a);
  float rim = smoothstep(0.62, 0.95, a);
  float hold = r.holding;
  vec3 c = base * (0.55 + 0.35 * s1 + 0.5 * hold + 0.3 * r.lift);
  c += mix(base, vec3(1.0), 0.6) * centre * (0.25 + 0.6 * hold);
  c = mix(c, mix(base, vec3(0.9, 0.96, 1.0), 0.65), rim * 0.75);
  float glow = exp(-max(a - 1.0, 0.0) * 2.8) * (0.2 + 0.3 * hold);
  if (missed) {
    c = base * (0.6 + 0.3 * s1);
    glow *= 0.15;
  }
  return vec4(mix(base * (0.9 + hold), c, body), clamp(body * 0.9 + (1.0 - body) * glow, 0.0, 1.0));
}
`;

// particles: soft dots, streaks, ice shards (turning diamonds), frost puffs and snowflakes
const SPRITE = /* glsl */ `
vec4 hdSprite(HDSprite p) {
  vec2 uv = p.uv;
  float d = length(uv);
  float a;
  if (p.shape > 0.5 && p.shape < 1.5) {
    a = (1.0 - smoothstep(0.0, 1.0, abs(uv.x))) * (1.0 - smoothstep(0.6, 1.0, abs(uv.y)));
  } else if (p.shape > 1.5 && p.shape < 2.5) {
    // a shard: a thin diamond turning as it flies, a bright edge on one side
    float an = p.seed * 6.2832 + p.age * (4.0 + p.seed * 6.0);
    float cs = cos(an), sn = sin(an);
    vec2 w = vec2(cs * uv.x - sn * uv.y, sn * uv.x + cs * uv.y);
    float dd = abs(w.x) / 0.38 + abs(w.y);
    a = 1.0 - smoothstep(0.7, 1.0, dd);
    a *= 0.55 + 0.45 * smoothstep(-0.4, 0.4, w.x + w.y * 0.3);
  } else if (p.shape > 3.5 && p.shape < 4.5) {
    a = (1.0 - smoothstep(0.0, 1.0, d)) * 0.5;
  } else if (p.shape > 4.5) {
    // a snowflake: soft, with a faint six-armed star in the bigger ones
    float an = atan(uv.y, uv.x) + p.seed * 6.0;
    float arms = pow(abs(cos(an * 3.0)), 12.0) * (1.0 - smoothstep(0.2, 1.0, d));
    a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.8, 1.0, d)) + arms * 0.35;
  } else {
    a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
  }
  return vec4(p.col.rgb * a * p.col.a, 0.0);
}`;

// GEM is set last (below)
const GEM = /* glsl */ `
vec4 hdGem(HDGem g) {
  vec3 L1 = normalize(vec3(-0.35, 0.75, 0.55));
  vec3 n = g.n;
  vec3 v = g.v;
  bool missed = g.missed > 0.5;
  vec3 base = missed ? vec3(0.3, 0.34, 0.4) : g.col;
  float front = smoothstep(0.8, 0.98, -g.nl.z);
  vec2 asp = g.size / min(g.size.x, g.size.y);
  vec2 fp = g.l.xy * asp;
  float rr = max(abs(g.l.x), abs(g.l.y));
  float px = length(fwidth(fp)) + 1e-4;
  // the cut: a flat table in the middle and eight facets round it, each tilted outward
  float a = atan(fp.y, fp.x);
  float sN = 8.0;
  float s = a * sN / 6.2832;
  float sec = floor(s + 0.5);
  float sa = sec * 6.2832 / sN;
  vec2 sd = vec2(cos(sa), sin(sa));
  float tR = 0.48;
  float table = 1.0 - smoothstep(tR - px * 1.5, tR + px * 1.5, rr);
  bool facets = g.kind < 0.5;
  vec3 fn = n;
  if (facets) fn = normalize(n + vec3(sd, 0.0) * 0.6 * (1.0 - table) * front);
  // looking into it: light bent through the facets, a different brightness on each
  vec3 rf = refract(-v, fn, 0.66);
  float fh = hdHash(vec2(sec, floor(g.wp.x * 3.0) + g.col.r * 7.0));
  float inner = smoothstep(-0.7, 0.6, rf.y + (fh - 0.5) * 0.5 * (1.0 - table));
  float dif = max(dot(fn, L1), 0.0);
  vec3 hv = normalize(L1 + v);
  float spec = pow(max(dot(fn, hv), 0.0), 120.0);
  vec3 r = reflect(-v, fn);
  vec3 env = mix(vec3(0.03, 0.06, 0.1), vec3(0.7, 0.82, 1.0), smoothstep(-0.15, 0.55, r.y));
  float fr = hdFresnel(fn, v, 3.0);
  float glow = 0.85 + 0.6 * g.near + 1.6 * g.flare;
  // the body: the string's colour, rich and clear, lighter where the light comes through
  vec3 body = base * (0.45 + 0.75 * inner + 0.25 * dif) * glow;
  body += mix(base, vec3(1.0), 0.5) * inner * inner * 0.25 * (1.0 - table * 0.5);
  vec3 c = mix(base * (0.45 + 0.3 * dif) * glow, body, front);
  c += env * fr * 0.45;
  c += vec3(0.95, 0.98, 1.0) * spec * (missed ? 0.3 : 1.4);
  // the cut's edges catch the light: thin, soft lines between the facets and round the table
  if (facets) {
    float bd = abs(fract(s + 0.5) - 0.5) * 6.2832 / sN * length(fp);
    float eL = (1.0 - smoothstep(0.0, px * 1.4, bd)) * (1.0 - table) * smoothstep(0.1, 0.3, rr);
    float tL = 1.0 - smoothstep(0.0, px * 1.4, abs(rr - tR));
    c += mix(base, vec3(1.0), 0.7) * max(eL, tL) * front * 0.35;
  }
  // the rim: rounded edges bright like light through ice, whiter as the note reaches the neck
  float bevel = 1.0 - max(abs(g.nl.x), max(abs(g.nl.y), abs(g.nl.z)));
  float rim = smoothstep(0.03, 0.26, bevel) * step(g.nl.z, 0.3);
  vec3 rimC = mix(base * 1.3, vec3(0.92, 0.97, 1.0), clamp(0.35 + 0.5 * g.near + g.flare, 0.0, 1.0));
  c += rimC * rim * (0.7 + 1.1 * g.near + 2.4 * g.flare + 0.8 * g.accent) * (missed ? 0.4 : 1.0);
  // frost along its top edge
  float fz = smoothstep(0.55, 0.95, g.l.y) * smoothstep(0.3, 0.7, hdNoise(g.l.xz * vec2(9.0, 4.0) + g.wp.x * 3.0));
  c = mix(c, vec3(0.85, 0.93, 1.0), fz * 0.35 * (1.0 - g.flare));
  if (g.kind > 1.5) c *= 0.8;
  return vec4(c, 1.0);
}
`;

const ICE = [1.4, 1.65, 1.9];
export default function build(K) {
  // hits: ice shards flying up and falling, glints, a puff of frost
  const shards = K.emitter({ max: 900, life: [0.45, 0.95], speed: [2.6, 6.2], up: 1, spread: 2.2, toward: [-2.0, 0.6], accel: [0, -10, 0], drag: 1.0, size: [0.075, 0.04], shape: 2, colA: ICE, colB: [0.5, 0.7, 0.9], tintA: 0.35, tintB: 0.6, alpha: 0.95, jitter: 0.12 });
  const glints = K.emitter({ max: 500, life: [0.5, 1.1], speed: [1.0, 3.2], up: 1, spread: 2.6, toward: [-1, 0.5], accel: [0, -2.5, 0], drag: 1.6, size: [0.04, 0.012], shape: 0, colA: [1.6, 1.8, 2.0], colB: [0.5, 0.75, 1.0], alpha: 1, jitter: 0.15 });
  const puff = K.emitter({ max: 240, life: [0.7, 1.4], speed: [0.2, 0.7], up: 1, spread: 2.4, toward: [-0.4, 0.3], accel: [0, 0.4, 0], drag: 1.5, size: [0.12, 0.42], shape: 4, colA: [0.55, 0.7, 0.85], colB: [0.2, 0.3, 0.42], tintA: 0.2, alpha: 0.55, jitter: 0.2 });
  const trickle = K.emitter({ max: 300, life: [0.4, 0.8], speed: [0.5, 1.6], up: 1, spread: 2.4, toward: [-0.6, 0.3], accel: [0, -1.5, 0], drag: 1.4, size: [0.035, 0.012], shape: 0, colA: [1.4, 1.6, 1.9], colB: [0.4, 0.6, 0.9], tintB: 0.4, alpha: 0.9, jitter: 0.1 });
  // snow falling all the time, and a few big soft flakes close to the camera
  K.field({ count: 1000, box: [-16, 16, -0.2, 8, -2, 46], vel: [0.25, -0.6, -0.5], size: [0.02, 0.05], colA: '#ffffff', colB: '#bfdcff', alpha: 0.75, sway: 0.3, shape: 5 });
  K.field({ count: 70, box: [-8, 8, 0.4, 5, 0, 10], vel: [0.2, -0.45, -0.3], size: [0.07, 0.14], colA: '#e8f4ff', colB: '#a8c8e8', alpha: 0.22, sway: 0.4, shape: 5 });
  let acc = 0;
  return {
    floor: { glsl: FLOOR },
    sky: { glsl: SKY },
    gem: { glsl: GEM },
    tube: { glsl: TUBE },
    trail: { glsl: TRAIL },
    sprite: { glsl: SPRITE },
    chordGlass: ['#0a2232', '#2a5470'],
    onHit(e) {
      const k = e.dead ? 1.2 : 1;
      shards.burst(e.x, e.y, e.z - 0.05, e.chord ? 16 : 26, e.rgb, k);
      glints.burst(e.x, e.y, e.z, e.chord ? 10 : 16, e.rgb, k);
      puff.burst(e.x, e.y - 0.05, e.z, 4, e.rgb, k);
    },
    frame(F) {
      // a held note keeps shedding a few glittering ice crystals
      if (!F.holdN || !F.motion) {
        acc = 0;
        return;
      }
      acc += F.dt * 14;
      const n = Math.floor(acc);
      if (!n) return;
      acc -= n;
      for (let i = 0; i < F.holdN; i++) trickle.burst(F.holds[i * 3], F.holds[i * 3 + 1], F.holds[i * 3 + 2] - 0.04, n, ICE, 1);
    },
  };
}
