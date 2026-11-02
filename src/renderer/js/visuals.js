/**
 * Moving backgrounds drawn on the graphics card (3.12): Nebula, Swarm,
 * Mandala and Strings. They sit behind the highway or fill the Jam screen,
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
  { id: 'mandala', name: 'Mandala', desc: 'A kaleidoscope that breathes with the beat' },
  { id: 'strings', name: 'Strings', desc: 'Six ribbons of light you pluck as you play' },
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
const MANDALA = HEAD + `
uniform float uFold;
vec2 fold(vec2 p, float n) {
  float a = atan(p.y, p.x), r = length(p);
  float seg = 2.0 * PI / n;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  return vec2(cos(a), sin(a)) * r;
}
void main() {
  vec2 p = cen(gl_FragCoord.xy);
  float bass = uBands.x;
  // last frame, folded, turned and zoomed: everything drifts outward and spins
  vec2 pp = fold(p, uFold) * rot(0.004 + uKick * 0.05 + sin(uPhase * 0.2) * 0.01);
  pp *= 0.985 - uKick * 0.035 - bass * 0.008;
  pp += vec2(sin(uPhase * 0.31), cos(uPhase * 0.23)) * 0.004;
  pp += (vec2(noise(pp * 6.0 + uPhase * 0.4), noise(pp * 6.0 - uPhase * 0.4 + 3.0)) - 0.5) * 0.006;
  vec2 uv = pp * vec2(uRes.y / uRes.x, 1.0) + 0.5;
  vec3 prev = texture(uPrev, uv).rgb;
  // slowly turn the old colours so it keeps changing
  float cs = cos(0.025), sn = sin(0.025);
  prev = vec3(prev.r * cs + prev.g * sn * 0.6, prev.g * cs + prev.b * sn * 0.6, prev.b * cs + prev.r * sn * 0.6);
  prev *= 0.9 - 0.04 * uHighway;
  // fresh light: the waveform as a ring, the spectrum as petals
  float r = length(p), a = atan(p.y, p.x);
  float ring = 0.16 + bass * 0.12 + uKick * 0.06;
  float w = wave(a / (2.0 * PI) + 0.5) * (0.05 + uEnergy * 0.06);
  float line = exp(-abs(r - ring - w) * 160.0);
  vec2 fp = fold(p, uFold);
  float fa = atan(fp.y, fp.x) / (PI / uFold);
  float sv = spec(0.05 + fa * 0.7);
  float petal = exp(-abs(r - (0.34 + sv * 0.28)) * 70.0) * sv;
  vec3 c1 = pal(0.1 + uPhase * 0.03 + r);
  vec3 c2 = pal(0.55 + fa * 0.3 + uPhase * 0.02);
  float inner = exp(-abs(r - 0.07 - bass * 0.04 - w * 0.5) * 220.0);
  vec3 col = c1 * (line + inner * 0.6) * (0.25 + uEnergy * 0.5) + c2 * petal * 0.35;
  // your notes: sparks on the fold lines, in the note's colour
  float ga = uGuitar.y * uGuitar.w;
  col += hue(uGuitar.z) * exp(-length(fp - vec2(0.22 + uGuitar.x * 0.2, 0.0)) * 30.0) * ga * 3.0;
  for (int i = 0; i < 8; i++) {
    vec4 h = uHits[i];
    if (h.z > 0.5) continue;
    float rr = 0.12 + h.x * 0.45;
    col += stringRGB(h.y) * exp(-length(fp - vec2(rr, 0.03 * h.y)) * 45.0) * exp(-h.z * 8.0) * 1.5;
  }
  // a soft heart that pulses with the kick
  col += pal(uPhase * 0.05) * exp(-r * 12.0) * uKick * 0.35;
  o = vec4(prev + col, 1.0);
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
    float d = abs(p.y - y);
    float glow = exp(-d * 320.0) * 1.0 + exp(-d * 55.0) * 0.12;
    float bright = 0.18 + band * 0.9 + uKick * 0.25 + amp * 2.5;
    // your guitar lights the string that fits the note you play
    float mine = uGuitar.w * uGuitar.x * exp(-abs(clamp((uGuitar.z * 12.0), 0.0, 12.0) / 2.0 - s) * 1.2);
    col += stringRGB(s) * glow * (bright + mine * 1.5);
  }
  o = vec4(prev + col * 0.4, 1.0);
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
            fold = [5, 6, 7, 8, 10][Math.floor(Math.random() * 5)];
          }
          pass('mandala', MANDALA, F, now, dt, (u) => gl.uniform1f(u.uFold, fold));
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
