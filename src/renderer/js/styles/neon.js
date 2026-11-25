/**
 * 4.34: Neon Crystal, drawn with its own graphics (see hdstyle.js and docs/hd-styles.md).
 *
 * A dark polished glass highway in a deep space-blue room. The glass mirrors the room (a vast ring of light
 * far ahead, distant towers of light, soft haze) and the light of every hit; under it runs a fine circuit of
 * hexagons and traces that brightens with the beat. Light runs along the hand position's edges. Notes are
 * cut crystal in their string's colour: a glowing heart seen through the facets, bright cut edges, a light
 * rim. Strings are neon tubes with a hot core; sustains are ribbons of light. A hit rings a shockwave across
 * the glass and throws crisp shards of light.
 */

const COMMON = /* glsl */ `
const vec3 NC_CYAN = vec3(0.25, 0.85, 1.0);
const vec3 NC_DEEP = vec3(0.10, 0.30, 0.85);
const vec3 NC_HOR = vec3(0.035, 0.105, 0.22);
float ncLine(float d, float w, float fw) { return 1.0 - smoothstep(w - fw, w + fw, abs(d)); }
// the room, seen along rd (world: x across, y up, z ahead). full 0: the cheap version (for reflections).
vec3 ncEnv(vec3 rd, float full) {
  float y = rd.y;
  float yy = max(y, 0.0);
  float az = atan(rd.x, rd.z);
  vec3 c = mix(NC_HOR, vec3(0.010, 0.026, 0.066), smoothstep(0.0, 0.10, yy));
  c = mix(c, vec3(0.002, 0.005, 0.016), smoothstep(0.08, 0.55, yy));
  c += vec3(0.08, 0.26, 0.48) * exp(-yy * 30.0) * 0.35;
  float above = smoothstep(-0.004, 0.012, y);
  // the gate: a vast ring of light far ahead, its foot under the horizon
  vec3 gd = normalize(vec3(0.0, 0.015, 1.0));
  float ang = acos(clamp(dot(rd, gd), -1.0, 1.0));
  const float R = 0.30;
  float dr = ang - R;
  float ring = exp(-dr * dr / 0.00002) * 0.8 + exp(-dr * dr / 0.0016) * 0.16 + exp(-(ang - R * 0.88) * (ang - R * 0.88) / 0.000006) * 0.22;
  float glow = ring;
  c += vec3(0.35, 0.72, 1.0) * ring * above;
  c += vec3(0.03, 0.10, 0.24) * (1.0 - smoothstep(0.0, R, ang)) * above;
  // far structures: long bars of light floating above the horizon either side of the gate. Measured on a
  // flat plane ahead, so a straight bar stays straight on screen.
  vec2 pr = rd.xy / max(rd.z, 0.05);
  float pw = max(fwidth(pr.y), 1e-5);
  if (pr.y > -0.01 && pr.y < 0.15) for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float side = mod(fi, 2.0) < 0.5 ? -1.0 : 1.0;
    float h1 = hdHash(vec2(fi, 1.3));
    float h2 = hdHash(vec2(fi, 7.1));
    float ty = 0.018 + 0.016 * fi + 0.01 * h1;
    float u0 = 0.36 + 0.12 * h2;
    float along = (pr.x * side - u0) / (0.2 + 0.35 * h1);
    float span = smoothstep(0.0, 0.06, along) * smoothstep(1.0, 0.94, along);
    float dy = pr.y - ty;
    float w = max(0.0009, pw * 0.7);
    float core = exp(-dy * dy / (w * w));
    float soft = exp(-dy * dy / 0.0005) * 0.12 + exp(-dy * dy / 0.00004) * 0.2;
    vec3 tc = mod(fi, 3.0) < 1.0 ? vec3(0.5, 0.45, 1.0) : vec3(0.3, 0.78, 1.0);
    float k = span * above * (0.75 + 0.25 * sin(uTime * 0.6 + fi * 2.0) * uMotion);
    c += tc * (core * 0.7 + soft) * k;
    glow += soft * k * 1.5;
  }
  if (full > 0.5) {
    // haze: slow soft clouds, lit by the gate and the towers
    vec2 uv = vec2(rd.x, rd.z) / (yy + 0.14);
    float n = hdFbm(uv * 0.45 + vec2(uTime * 0.01, uTime * 0.02) * uMotion, 2.0 + uQ * 0.7);
    float haze = n * n;
    c += vec3(0.05, 0.13, 0.26) * haze * (0.25 + 1.2 * glow) * exp(-yy * 3.5);
    c += vec3(0.04, 0.10, 0.18) * exp(-yy * 16.0) * (0.5 + 0.5 * n) * 0.5;
    // a few far stars, soft dots
    vec2 st = vec2(az, y) * 90.0;
    vec2 cell = floor(st);
    float h = hdHash(cell);
    if (h > 0.94) {
      vec2 o = 0.25 + 0.5 * hdHash2(cell + 3.7);
      float px = max(fwidth(st.x), 1e-4);
      float sz = max(0.04, px * 0.9);
      float d = length(fract(st) - o);
      c += vec3(0.6, 0.8, 1.0) * exp(-d * d / (sz * sz)) * (h - 0.94) * 9.0 * smoothstep(0.06, 0.3, y);
    }
  }
  return c;
}
// hexagons: xy offset from the cell's middle, zw the cell's middle
vec4 ncHex(vec2 uv) {
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, uv - gv);
}
float ncSeg(vec2 p, vec2 b) { float t = clamp(dot(p, b) / dot(b, b), 0.0, 1.0); return length(p - b * t); }
// the circuit under the glass: x the hex grid, y traces, z nodes (each 0..1, already smooth); id the cell's
vec3 ncCircuit(vec2 q, vec2 fw, out float id) {
  const float HS = 0.7;
  vec2 p = q / HS;
  float aa = max(fw.x, fw.y) / HS * 1.2 + 1e-4;
  vec4 h = ncHex(p);
  id = hdHash(h.zw * 0.731 + 0.37);
  vec2 g = abs(h.xy);
  float e = 0.5 - max(dot(g, vec2(0.5, 0.8660254)), g.x);
  float grid = 1.0 - smoothstep(0.012 - aa, 0.012 + aa, e);
  float lit = step(0.5, id);
  float k = floor(hdHash(h.zw + 1.7) * 6.0);
  float k2 = k + (id > 0.8 ? 3.0 : 2.0);
  vec2 d1 = vec2(cos(k * 1.0472), sin(k * 1.0472)) * 0.5;
  vec2 d2 = vec2(cos(k2 * 1.0472), sin(k2 * 1.0472)) * 0.5;
  float ts = min(ncSeg(h.xy, d1), ncSeg(h.xy, d2));
  float trace = (1.0 - smoothstep(0.016 - aa, 0.016 + aa, ts)) * lit;
  float nd = length(h.xy);
  float node = (1.0 - smoothstep(0.065 - aa, 0.065 + aa, nd)) * lit;
  node = max(node, (1.0 - smoothstep(0.012 - aa, 0.012 + aa, abs(nd - 0.11))) * lit * 0.6);
  // thinner than a pixel: an even glow, never a shimmer
  float far = clamp(aa / 0.02 - 0.5, 0.0, 1.0);
  grid = mix(grid, 0.07, far);
  trace = mix(trace, 0.04 * lit, far);
  node = mix(node, 0.03 * lit, far);
  return vec3(grid, trace, node);
}
// the glass at a point on the ground: dark, mirroring the room. Gives back the mirrored ray and the Fresnel
vec3 ncGlass(vec3 wp, vec3 cam, out vec3 rdir, out float fres) {
  vec3 vd = normalize(wp - cam);
  rdir = vec3(vd.x, -vd.y, vd.z);
  float ct = clamp(-vd.y, 0.0, 1.0);
  fres = 0.04 + 0.96 * pow(1.0 - ct, 5.0);
  return vec3(0.003, 0.006, 0.013) + ncEnv(rdir, 0.0) * fres * 0.8;
}
// the circuit seen a little under the glass (it shifts as you look across it)
vec3 ncUnder(vec3 wp, vec3 cam, float track, vec2 fw, out float id) {
  vec3 vd = normalize(wp - cam);
  float ct = max(-vd.y, 0.12);
  vec2 q = vec2(wp.x, track) + vd.xz / ct * 0.03;
  return ncCircuit(q, fw, id);
}
vec3 ncLight(vec3 ci, float id, float energy) {
  float act = 0.55 + 0.45 * sin(id * 31.0 + uTime * (0.5 + id) * uMotion);
  return NC_DEEP * ci.x * 0.3 * (0.4 + 0.6 * energy) + NC_CYAN * ci.y * 0.5 * act * energy + mix(NC_CYAN, vec3(1.0), 0.45) * ci.z * 1.1 * act * energy;
}
`;

const FLOOR = /* glsl */ `
${COMMON}
vec4 hdFloor(HDFloor f) {
  vec3 cam = vec3(uCamPos.x, uCamPos.y, -uCamPos.z);
  vec3 wp = vec3(f.p.x, 0.0, f.p.y);
  vec3 rdir;
  float fres;
  vec3 c = ncGlass(wp, cam, rdir, fres);
  float id;
  vec3 ci = ncUnder(wp, cam, f.track, f.fw, id);
  // the hits: a shockwave rings out across the glass, the circuit lights up behind it, the light shows in the glass
  float ring = 0.0, band = 0.0, pool = 0.0, refl = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uHitN) break;
    vec4 h = uHits[i];
    vec2 d = vec2(f.p.x - h.x, (f.p.y - h.z) * 1.15);
    float dist = length(d);
    float w = h.w / max(uFx, 0.05);
    float age = -0.35 * log(clamp(w, 0.002, 1.0));
    float rk = smoothstep(0.36, 0.55, w) * min(h.w, 1.0);
    float R = 0.15 + age * 9.0;
    float rw = max(0.045 + age * 0.12, f.fw.y * 1.5);
    float dd = dist - R;
    ring += rk * exp(-dd * dd / (rw * rw));
    band += rk * exp(-dd * dd / (rw * rw * 40.0));
    pool += h.w * exp(-dist * dist * 1.6);
    vec3 H = h.xyz - wp;
    float t = max(dot(H, rdir), 0.0);
    vec3 e = H - rdir * t;
    refl += h.w * exp(-dot(e, e) * 5.0);
  }
  float inL = f.inLane;
  float pulse = uPulse * uFx;
  float energy = (0.3 + 0.7 * inL) * (0.55 + 0.9 * pulse + 0.35 * uHeat) + band * 2.5 + pool * 1.2;
  c += ncLight(ci, id, energy);
  // the hand position: a lighter, bluer pane of glass
  c += vec3(0.008, 0.022, 0.042) * inL * (0.6 + 0.4 * f.cur);
  c += NC_DEEP * hdLine(f.fret, 0.008, f.fw.x) * inL * 0.22;
  c += NC_CYAN * f.beat * inL * (0.3 + 0.5 * pulse);
  // light trails along its edges: a fine bright line, a soft glow, light running toward you
  float edge = f.lane;
  float has = step(edge, 50.0);
  float rail = hdLine(edge, 0.018, f.fw.x);
  float s = f.track * 0.1 - uTime * 0.8 * uMotion;
  float run = pow(0.5 + 0.5 * sin(s * 6.2832), 8.0);
  float rk = (0.55 + 0.45 * f.cur) * (1.0 + 0.4 * uHeat + 0.35 * pulse);
  c += mix(NC_CYAN, vec3(0.85, 0.95, 1.0), 0.3 + 0.4 * run) * rail * (1.3 + 1.6 * run) * rk * has;
  c += NC_CYAN * exp(-abs(edge) * 6.0) * (0.09 + 0.14 * run) * rk * has;
  // the hits on top
  c += mix(NC_CYAN, vec3(1.0), 0.55) * ring * 1.5;
  c += NC_CYAN * pool * 0.1;
  c += vec3(0.7, 0.9, 1.0) * refl * (0.15 + 0.85 * fres) * 0.9;
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
  if (y < -0.0005) {
    // the glass goes on beyond the highway, the same circuit under it
    float t = -s.ro.y / y;
    vec3 gp = s.ro + rd * t;
    vec3 rdir;
    float fres;
    vec3 c = ncGlass(gp, s.ro, rdir, fres);
    float track = gp.z + uSong * uZs;
    float id;
    vec3 ci = ncUnder(gp, s.ro, track, fwidth(vec2(gp.x, track)), id);
    c += ncLight(ci, id, 0.3 * (0.55 + 0.9 * uPulse * uFx + 0.35 * uHeat));
    c = hdFog(c, gp.z);
    return mix(c, NC_HOR * 1.2, 1.0 - exp(-max(0.0, gp.z - uZFar) * 0.015));
  }
  return ncEnv(rd, 1.0);
}
`;

const GEM = /* glsl */ `
${COMMON}
vec4 hdGem(HDGem g) {
  vec3 cam = vec3(uCamPos.x, uCamPos.y, -uCamPos.z);
  vec3 vd = normalize(g.wp - cam);
  vec3 nl = g.nl;
  bool missed = g.missed > 0.5;
  vec3 base = missed ? vec3(0.15, 0.17, 0.21) : g.col;
  float front = smoothstep(0.85, 0.99, -nl.z);
  // the cut: a flat table in the middle, four bevelled facets round it
  vec2 P = g.l.xy * g.size;
  vec2 fwv = fwidth(P);
  float fwP = max(fwv.x, fwv.y) + 1e-5;
  vec2 dd = g.size - abs(P);
  float b = min(g.size.x, g.size.y) * 0.4;
  float m = min(dd.x, dd.y);
  float tbl = smoothstep(b - fwP, b + fwP, m);
  vec3 side = dd.x < dd.y ? vec3(sign(P.x) * 0.8, 0.0, -1.0) : vec3(0.0, sign(P.y) * 0.8, -1.0);
  vec3 nf = normalize(mix(normalize(side), vec3(0.0, 0.0, -1.0), tbl));
  vec3 N = normalize(mix(nl, nf, front));
  float edgeL = max(ncLine(m - b, 0.0, fwP * 1.3), ncLine(dd.x - dd.y, 0.0, fwP * 1.6) * (1.0 - tbl)) * front;
  // what the crystal reflects, and the light seen through it
  vec3 V = -vd;
  float fr = hdFresnel(N, V, 3.0);
  vec3 r = reflect(vd, N);
  vec3 env = r.y > 0.0 ? ncEnv(r, 0.0) * 2.2 : vec3(0.02, 0.05, 0.09);
  vec3 L = normalize(vec3(-0.3, 0.8, -0.55));
  float spec = pow(max(dot(r, L), 0.0), 90.0);
  vec3 rr = refract(vd, N, 0.66);
  vec2 inner = g.l.xy * vec2(1.0, 1.15) + rr.xy * 0.8;
  float core = exp(-dot(inner, inner) * 1.5);
  float heat = 1.0 + 0.8 * g.near + 2.0 * g.flare + 0.25 * uHeat;
  float barK = g.kind > 1.5 ? 0.55 : 1.0;
  vec3 c;
  if (missed) {
    c = base * (0.35 + 0.4 * core) + env * fr * 0.5 + spec * 0.3;
    c += base * 1.5 * edgeL * 0.5;
    return vec4(c, 1.0);
  }
  // the face: the string's colour, deep and saturated, its heart glowing through the cut
  vec3 faceC = base * (0.42 + 0.95 * core) * heat * barK;
  faceC += mix(base, vec3(1.0), 0.6) * core * core * (0.1 + 0.35 * g.near + 0.5 * g.flare);
  // each facet of the cut catches the light differently; a glint runs across the table
  float fl = dot(nf, normalize(vec3(-0.25, 0.85, -0.5)));
  faceC *= 1.0 + (1.0 - tbl) * (fl - 0.45) * 0.9;
  float gl = g.l.x * 0.55 + g.l.y - 0.35;
  faceC += vec3(0.9, 0.97, 1.0) * exp(-gl * gl * 18.0) * tbl * 0.16;
  // the sides and top: darker crystal, the colour still clear
  vec3 sideC = base * (0.3 + 0.25 * max(N.y, 0.0) + 0.3 * core) * (0.9 + 0.4 * g.near);
  c = mix(sideC, faceC, front);
  c += env * fr * 0.9 + vec3(0.9, 0.95, 1.0) * spec * 0.9;
  // the cut edges catch the light
  c += mix(base, vec3(1.0), 0.55) * edgeL * (0.55 + 0.7 * g.near + 1.5 * g.flare + 0.5 * g.accent);
  // the rounded rims glow
  float bevel = 1.0 - max(abs(nl.x), max(abs(nl.y), abs(nl.z)));
  float rim = smoothstep(0.03, 0.25, bevel);
  c += mix(base * 1.2, vec3(1.0), 0.3) * rim * (0.5 + 0.7 * g.near + 1.4 * g.flare + 0.8 * g.accent);
  c += vec3(0.5, 0.7, 1.0) * g.bend * front * 0.08;
  return vec4(c, 1.0);
}
`;

const TUBE = /* glsl */ `
vec4 hdTube(HDTube t) {
  vec3 n = t.n;
  vec3 v = t.v;
  float facing = max(dot(n, v), 0.0);
  vec3 L = normalize(vec3(-0.3, 0.75, 0.6));
  float dif = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 60.0);
  float fr = hdFresnel(n, v, 3.0);
  if (t.kind < 0.5) {
    // a string: a neon tube, a hot core inside a glass sleeve in its colour
    float flow = 1.0 + 0.07 * sin(t.along * 0.9 - uTime * 2.0) * uMotion;
    float g = 1.0 + 0.9 * t.glow + 0.25 * uHeat;
    vec3 c = t.col * (0.28 + 1.05 * pow(facing, 1.4)) * g * flow;
    c += mix(t.col, vec3(1.0), 0.62) * pow(facing, 5.0) * (0.65 + 1.2 * t.glow);
    c += vec3(0.6, 0.85, 1.0) * fr * 0.14 + vec3(1.0) * spec * 0.45;
    return vec4(c, 1.0);
  }
  if (t.kind < 1.5) {
    // a fret: a clear glass bar, its edges lit cyan
    vec3 c = vec3(0.05, 0.09, 0.15) * (0.4 + 0.6 * dif) + vec3(0.3, 0.8, 1.0) * fr * 0.55 + vec3(1.0) * spec * 0.7;
    c += vec3(0.3, 0.85, 1.0) * t.glow * 0.9 * pow(facing, 1.5);
    return vec4(c, 1.0);
  }
  if (t.kind < 2.5) {
    // the nut: a bar of white light
    vec3 c = vec3(0.55, 0.8, 1.0) * (0.45 + 0.6 * facing) + spec * 0.5;
    return vec4(c, 1.0);
  }
  // a light post: a neon bar in the light's colour
  vec3 c = t.col * (0.35 + 1.3 * t.glow) * (0.5 + 0.8 * pow(facing, 2.0));
  c += mix(t.col, vec3(1.0), 0.6) * pow(facing, 6.0) * (0.3 + t.glow);
  return vec4(c, 1.0);
}
`;

const TRAIL = /* glsl */ `
vec4 hdTrail(HDTrail r) {
  float a = abs(r.u);
  bool missed = r.missed > 0.5;
  vec3 base = missed ? vec3(0.14, 0.16, 0.2) : r.col;
  float body = 1.0 - smoothstep(1.0 - r.fu * 1.5, 1.0 + r.fu * 1.5, a);
  // a ribbon of light: two fine bright edges, a hot centre line, light pulsing along it with the note
  float ea = (a - 0.8) / 0.22;
  float edges = exp(-ea * ea);
  float core = exp(-a * a * 7.0);
  float m = uMotion;
  float pulse = 0.5 + 0.5 * sin(r.t * 14.0 - uTime * 5.0 * m);
  pulse = 0.75 + 0.25 * pulse * pulse;
  float hk = 0.55 + 0.75 * r.holding + 0.4 * r.lift;
  vec3 c = base * (0.3 * body + 0.45 * edges * body + 0.85 * core) * hk * pulse;
  c += mix(base, vec3(1.0), 0.6) * core * (0.12 + 0.5 * r.holding);
  c += base * exp(-max(a - 1.0, 0.0) * 2.8) * (1.0 - body) * (0.09 + 0.15 * r.holding);
  if (missed) c *= 0.35;
  return vec4(c, 1.0);
}
`;

// particle looks: 0 a soft dot, 1 a crisp shard of light, 3 a thin ring
const SPRITE = /* glsl */ `
vec4 hdSprite(HDSprite p) {
  float d = length(p.uv);
  float a;
  if (p.shape > 0.5 && p.shape < 1.5) {
    float w = (1.0 - abs(p.uv.y)) * 0.9 - abs(p.uv.x);
    a = smoothstep(0.0, 0.3, w) * (1.0 + 0.6 * exp(-p.uv.x * p.uv.x * 30.0));
  } else if (p.shape > 2.5 && p.shape < 3.5) {
    float fw = fwidth(d) * 1.5 + 0.02;
    a = (1.0 - smoothstep(0.0, fw, abs(d - 0.82))) + 0.12 * (1.0 - smoothstep(0.0, 0.82, d));
  } else a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.8, 1.0, d));
  return vec4(p.col.rgb * a * p.col.a, 0.0);
}`;

export default function build(K) {
  // hits: crisp shards of light that fly out and slow, small sparks, a ring of light where it landed
  const shards = K.emitter({ max: 900, life: [0.3, 0.6], speed: [4.0, 9.0], up: 1, spread: 2.7, toward: [-2.2, 1.0], accel: [0, -3.5, 0], drag: 2.6, size: [0.06, 0.016], shape: 1, stretch: 0.07, colA: [1.7, 1.8, 2.0], colB: null, tintA: 0.3, tintB: 0, alpha: 1, jitter: 0.08 });
  const motes = K.emitter({ max: 500, life: [0.6, 1.3], speed: [0.4, 1.6], up: 1, spread: 2.4, toward: [-0.8, 0.5], accel: [0, 0.9, 0], drag: 1.6, size: [0.06, 0.018], shape: 0, colA: null, colB: [0.3, 0.8, 1.0], tintA: 0, tintB: 0.4, alpha: 0.85, jitter: 0.2, stagger: 0.1 });
  const flash = K.emitter({ max: 64, life: [0.2, 0.28], speed: [0, 0], up: 0, spread: 0, toward: [0, 0], accel: [0, 0, 0], drag: 0, size: [0.12, 0.75], shape: 3, colA: [1.3, 1.5, 1.7], colB: null, tintA: 0.4, tintB: 0, alpha: 0.9 });
  const trickle = K.emitter({ max: 300, life: [0.35, 0.7], speed: [0.6, 1.8], up: 1, spread: 2.0, toward: [-1, 0.3], accel: [0, 1.2, 0], drag: 1.8, size: [0.035, 0.01], shape: 0, colA: null, colB: [0.6, 0.9, 1.0], tintB: 0.3, alpha: 0.8, jitter: 0.1 });
  // all the time: fine dust catching the light, and big soft lights far off in the haze
  K.field({ count: 500, box: [-14, 14, -0.2, 6, -2, 46], vel: [0.05, 0.1, -0.3], size: [0.012, 0.03], colA: '#7fe8ff', colB: '#6a7dff', alpha: 0.45, sway: 0.25 });
  K.field({ count: 50, box: [-32, 32, 2, 16, 26, 76], vel: [0.1, 0.04, -0.4], size: [0.25, 0.6], colA: '#2f86ff', colB: '#7a5cff', alpha: 0.07, sway: 0.5 });
  let acc = 0;
  return {
    floor: { glsl: FLOOR },
    sky: { glsl: SKY },
    gem: { glsl: GEM },
    tube: { glsl: TUBE },
    trail: { glsl: TRAIL, add: true },
    sprite: { glsl: SPRITE },
    haze: 0,
    chordGlass: ['#03101c', '#0a2236'],
    onHit(e) {
      const k = e.dead ? 1.2 : 1;
      shards.burst(e.x, e.y, e.z - 0.05, e.chord ? 16 : 28, e.rgb, k);
      motes.burst(e.x, e.y, e.z, 10, e.rgb, k);
      flash.burst(e.x, e.y, e.z - 0.06, 1, e.rgb, k);
    },
    frame(F) {
      // a held note keeps giving off a little light
      if (!F.holdN || !F.motion) {
        acc = 0;
        return;
      }
      acc += F.dt * 14;
      const n = Math.floor(acc);
      if (!n) return;
      acc -= n;
      for (let i = 0; i < F.holdN; i++) trickle.burst(F.holds[i * 3], F.holds[i * 3 + 1], F.holds[i * 3 + 2] - 0.04, n, HOLD_RGB, 1);
    },
  };
}
const HOLD_RGB = [0.4, 0.85, 1.0];
