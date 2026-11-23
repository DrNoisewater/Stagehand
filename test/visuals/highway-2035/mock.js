/**
 * Highway 2035: a look-only mockup of a redrawn note highway (not used by the app).
 *
 * Same layout as the app's highway (highway.js): the neck stands upright at the hit line with
 * low E on top, frets nearly even, the floor runs off into the distance with the hand position
 * as a lit channel, notes come in at their string's height, 16 world units per second, 4 s ahead.
 * What changes is the look: real materials lit by a made-up studio (image-based lighting),
 * HDR with ACES tone mapping, bloom, a reflecting floor, contact glow and shadow under every
 * note, a soft distance blur, and supersampling for clean edges.
 *
 * Three looks: ?style=chrome | neon | studio. Time is driven from outside: window.renderAt(t).
 */
import * as THREE from '/app/vendor/three/three.module.min.js';
import { EffectComposer } from '/app/vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '/app/vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/app/vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/app/vendor/three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from '/app/vendor/three/addons/postprocessing/ShaderPass.js';

const Q = new URLSearchParams(location.search);
const STYLE = Q.get('style') || 'chrome';
const SS = Number(Q.get('ss') || 2); // supersampling (renders SS x SS pixels for each one shown)
const MSAA = Number(Q.get('msaa') || 4);
const W = Number(Q.get('w') || 1920);
const HH = Number(Q.get('h') || 1080);

// ------------------------------------------------------------- layout (as in highway.js) --
const STRING = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];
const STRING_DARK = ['#7a1d27', '#7a5e12', '#164e80', '#7a4515', '#1c6a3c', '#55307f'];
const RATIO = 0.982;
const XF = (f) => (f < 0 ? f : (1 - Math.pow(RATIO, f)) / (1 - RATIO));
const laneC = (f) => (XF(f - 1) + XF(f)) / 2;
const laneW = (f) => XF(f) - XF(f - 1);
const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
const N = 6;
const GY = 0.27;
const HL = 0.14;
const YTOP = HL + (N - 1) * GY;
const ZS = 16; // world units per song second
const AHEAD = 4;
const ZF = ZS * AHEAD;
const level = (s) => N - 1 - s; // low E on top
const nY = (L) => HL + L * GY;
const strH = (s) => nY(level(s));
// world z: 0 is the neck, notes still to come are at negative z (three.js looks down -z)

// ----------------------------------------------------------------------------- looks --
const LOOKS = {
  chrome: {
    exposure: 1.0,
    bloom: [0.5, 0.45, 0.95],
    fog: '#0b1017',
    sky: ['#04070b', '#0d1520', '#1d3346'],
    floor: { base: '#121a22', line: '#6fb8d0', lineA: 0.16, refl: 1.4, rough: 0.3, glow: 2.2, ao: 0.35 },
    lane: { fill: '#1d5a7a', edge: '#7ee8ff', rail: [0.35, 1.25, 1.6], beat: 0.5 },
    env: 'softbox',
    envI: 1.6,
  },
  neon: {
    exposure: 1.05,
    bloom: [0.8, 0.55, 0.85],
    fog: '#0a0612',
    sky: ['#020104', '#0b0517', '#2a0b3a'],
    floor: { base: '#040307', line: '#c45cff', lineA: 0.22, refl: 0.95, rough: 0.3, glow: 1.8, ao: 0.0 },
    lane: { fill: '#2a1452', edge: '#ff5cd6', rail: [1.8, 0.45, 2.1], beat: 0.7 },
    env: 'neon',
    envI: 0.7,
  },
  studio: {
    exposure: 1.0,
    bloom: [0.18, 0.25, 1.8],
    fog: '#7d8792',
    sky: ['#23272d', '#4a525c', '#8d96a1'],
    floor: { base: '#3a3f47', line: '#ffffff', lineA: 0.05, refl: 0.22, rough: 0.9, glow: 0.3, ao: 0.9 },
    lane: { fill: '#4d5560', edge: '#ffffff', rail: [1.5, 1.5, 1.5], beat: 0.35 },
    env: 'studio',
    envI: 1.15,
  },
};
const LK = LOOKS[STYLE];

// ----------------------------------------------------------------------------- chart --
/** A made-up riff (the driver can pass a real chart instead with ?chart=…). */
function demoChart() {
  const notes = [];
  const add = (t, s, f, sus = 0, x = {}) => notes.push({ t, s, f, sus, ...x });
  const b = 0.25;
  let t = 1.0;
  for (const [s, f, sus, x] of [[0, 3, 0], [0, 5, 0.5], [1, 3, 0], [1, 5, 0], [2, 2, 0], [2, 5, 0.6, { bend: 2, bends: [{ t: 0.15, step: 2 }] }], [1, 5, 0], [1, 3, 0, { pullOff: true }], [0, 5, 0], [0, 0, 0], [0, 3, 0.9]]) {
    add(t, s, f, sus, x);
    t += sus > 0 ? sus + b : b;
  }
  const chordEvents = [{ t: t + 0.2, chord: 0, sus: 0, strings: [{ s: 0, f: 3 }, { s: 1, f: 5 }, { s: 2, f: 5 }] }, { t: t + 0.45, chord: 0, sus: 0, strings: [{ s: 0, f: 3 }, { s: 1, f: 5 }, { s: 2, f: 5 }] }];
  t += 0.9;
  for (const [s, f] of [[3, 2], [3, 4], [2, 5], [3, 4], [2, 2], [1, 5], [1, 3]]) add((t += b), s, f);
  const beats = [];
  for (let i = 0; i < 64; i++) beats.push({ t: i * 0.5, m: i % 4 === 0 ? i / 4 : -1 });
  return { notes, chordEvents, chords: [{ name: 'G5' }], anchors: [{ t: 0, end: 60, fret: 2, width: 4 }], beats };
}

// --------------------------------------------------------------------------- helpers --
const C = (hex) => new THREE.Color(hex);
const lin = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
let seed = 1;
function rand() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** A box with round edges and smooth normals (the usual trick: a 1x1x1 box split so only its middle is flat). */
function roundedBox(w, h, d, r, seg = 3) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const S = seg * 2 + 1;
  const g = new THREE.BoxGeometry(1, 1, 1, S, S, S);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const half = 0.5 / S;
  const box = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.set(p.x - Math.sign(p.x) * half, p.y - Math.sign(p.y) * half, p.z - Math.sign(p.z) * half).normalize();
    pos.setXYZ(i, box.x * Math.sign(p.x) + n.x * r, box.y * Math.sign(p.y) + n.y * r, box.z * Math.sign(p.z) + n.z * r);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
/** A flat rounded outline (for the note's spot on the neck). */
function outlineGeo(w, h, r, t) {
  const s = roundedRectShape(w, h, r);
  const hole = roundedRectShape(w - 2 * t, h - 2 * t, Math.max(0.002, r - t));
  s.holes.push(hole);
  return new THREE.ShapeGeometry(s, 10);
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------------- renderer --
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, HH);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LK.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);
const RW = Math.round(W * SS);
const RH = Math.round(HH * SS);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(LK.fog, ZF * 0.5, ZF * 1.15);
const camera = new THREE.PerspectiveCamera(60, W / HH, 0.05, 900);

// ------------------------------------------------------------- made-up studio (lighting) --
function buildEnvironment() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: STYLE === 'studio' ? '#2a2e33' : STYLE === 'neon' ? '#050208' : '#07090c' }));
  room.position.y = 6;
  env.add(room);
  const panel = (w, h, color, k, pos, rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: lin(color, k), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.rotation.set(...rot);
    env.add(m);
  };
  if (LK.env === 'softbox') {
    panel(14, 5, '#ffffff', 5, [0, 15.5, -4], [Math.PI / 2, 0, 0]); // big overhead softbox
    panel(3, 12, '#cfe6ff', 3, [-19.5, 6, -6], [0, Math.PI / 2, 0]); // cool strip left
    panel(3, 12, '#ffd9b0', 2.5, [19.5, 6, -6], [0, -Math.PI / 2, 0]); // warm strip right
    panel(30, 1.2, '#9fe6ff', 2, [0, 3, -19.5]); // horizon line far away
    panel(10, 4, '#ffffff', 1.2, [0, 8, 19.5], [0, Math.PI, 0]); // behind you
  } else if (LK.env === 'neon') {
    panel(30, 0.8, '#ff3cc8', 6, [0, 2.5, -19.5]);
    panel(30, 0.5, '#29e6ff', 6, [0, 5.5, -19.5]);
    panel(2, 14, '#ff3cc8', 4, [-19.5, 6, -4], [0, Math.PI / 2, 0]);
    panel(2, 14, '#29e6ff', 4, [19.5, 6, -4], [0, -Math.PI / 2, 0]);
    panel(10, 3, '#8a5cff', 2, [0, 15.5, 0], [Math.PI / 2, 0, 0]);
  } else {
    panel(24, 16, '#ffffff', 3.2, [0, 15.5, -2], [Math.PI / 2, 0, 0]); // one big soft sky
    panel(8, 10, '#ffffff', 1.4, [-19.5, 7, 4], [0, Math.PI / 2, 0]); // key
    panel(30, 3, '#dfe5ec', 0.8, [0, 2, -19.5]);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.035);
  pm.dispose();
  return rt.texture;
}
scene.environment = buildEnvironment();
scene.environmentIntensity = LK.envI;

// a key light from above and behind you, for clean highlights on the notes
const key = new THREE.DirectionalLight('#ffffff', STYLE === 'studio' ? 1.6 : STYLE === 'neon' ? 0.4 : 1.0);
key.position.set(-3, 10, 8);
scene.add(key);
scene.add(new THREE.HemisphereLight(STYLE === 'neon' ? '#5a3a8a' : '#9fb4c8', '#0a0a0c', STYLE === 'studio' ? 0.8 : 0.6));
const rimL = new THREE.DirectionalLight(STYLE === 'neon' ? '#ff4fd8' : '#9fd8ff', STYLE === 'studio' ? 0.4 : 0.8);
rimL.position.set(6, 3, -12);
scene.add(rimL);

// ------------------------------------------------------------------------ the sky --
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: { top: { value: C(LK.sky[0]) }, mid: { value: C(LK.sky[1]) }, hor: { value: C(LK.sky[2]) }, style: { value: ['chrome', 'neon', 'studio'].indexOf(STYLE) } },
  vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 top, mid, hor; uniform float style; varying vec3 vD;
    float h(float x){ return fract(sin(x*127.1)*43758.5453); }
    void main(){
      float y = vD.y;
      vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, y));
      c = mix(c, top, smoothstep(0.15, 0.6, y));
      // a soft band of light along the horizon, strongest straight ahead
      float ahead = pow(max(0.0, -vD.z), 6.0);
      c += hor * 1.6 * exp(-abs(y - 0.02) * 30.0) * (0.35 + 0.65 * ahead);
      if (style < 0.5) {
        // far stage: tall soft light columns, out of focus
        // far stage lights, out of focus: soft round discs along the horizon
        float a = atan(vD.x, -vD.z);
        for (int i = 0; i < 26; i++) {
          float fi = float(i);
          vec2 cpos = vec2((h(fi) - 0.5) * 2.0, 0.012 + h(fi + 7.3) * 0.07);
          float rad = 0.008 + h(fi + 3.1) * 0.012;
          float d = length(vec2(a * 0.75, y) - vec2(cpos.x * 0.75, cpos.y));
          float disc = smoothstep(rad, rad * 0.82, d) * (0.75 + 0.25 * smoothstep(rad * 0.5, rad, d));
          vec3 bc = mix(vec3(0.35, 0.7, 1.0), vec3(1.0, 0.75, 0.45), step(0.72, h(fi + 1.7)));
          c += bc * disc * (0.04 + 0.07 * h(fi + 9.1));
        }
      } else if (style < 1.5) {
        float a = atan(vD.x, -vD.z);
        float pink = exp(-pow((y - 0.01) * 70.0, 2.0));
        float cyan = exp(-pow((y - 0.05) * 90.0, 2.0)) * 0.7;
        c += vec3(1.0, 0.16, 0.75) * pink * 0.22 * exp(-abs(a) * 1.6) + vec3(0.1, 0.85, 1.0) * cyan * 0.1 * exp(-abs(a) * 2.0);
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat);
sky.renderOrder = -10;
sky.userData.noReflect = true;
scene.add(sky);

// --------------------------------------------------------------------------- the floor --
const MAXG = 12;
const floorU = {
  base: { value: C(LK.floor.base) },
  lineCol: { value: lin(LK.floor.line, 1) },
  lineA: { value: LK.floor.lineA },
  fogCol: { value: C(LK.sky[2]) },
  skyCol: { value: lin(LK.sky[2], 1.0) },
  zFar: { value: ZF },
  refl: { value: null },
  reflK: { value: LK.floor.refl },
  rough: { value: LK.floor.rough },
  texMat: { value: new THREE.Matrix4() },
  camPos: { value: new THREE.Vector3() },
  gems: { value: Array.from({ length: MAXG }, () => new THREE.Vector4(0, 0, 999, 0)) },
  gemCol: { value: Array.from({ length: MAXG }, () => new THREE.Vector3()) },
  glowK: { value: LK.floor.glow },
  aoK: { value: LK.floor.ao },
  // the hand position: x0, x1, z near, z far
  lane: { value: new THREE.Vector4(0, 0, 0, 0) },
  laneFill: { value: C(LK.lane.fill) },
  rail: { value: new THREE.Vector3(...LK.lane.rail) },
  railHot: { value: 0 },
  beats: { value: Array.from({ length: 16 }, () => new THREE.Vector2(999, 0)) },
  beatK: { value: LK.lane.beat },
  laneEdge: { value: lin(LK.lane.edge, 1) },
};
const floorMat = new THREE.ShaderMaterial({
  uniforms: floorU,
  fog: false,
  extensions: { derivatives: true },
  vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */ `
    uniform vec3 skyCol;
    uniform vec3 base, lineCol, fogCol, laneFill, rail, laneEdge;
    uniform float lineA, zFar, reflK, rough, glowK, aoK, railHot, beatK;
    uniform sampler2D refl;
    uniform mat4 texMat;
    uniform vec3 camPos;
    uniform vec4 gems[${MAXG}];
    uniform vec3 gemCol[${MAXG}];
    uniform vec4 lane;
    uniform vec2 beats[16];
    varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    const float RATIO = ${RATIO};
    float xOf(float f){ return (1.0 - pow(RATIO, f)) / (1.0 - RATIO); }
    float fretOf(float x){ return x < 0.0 ? x : log(max(1e-6, 1.0 - x * (1.0 - RATIO))) / log(RATIO); }
    float aaLine(float d, float w){ float fw = fwidth(d) * 1.0; return 1.0 - smoothstep(w - fw, w + fw, abs(d)); }
    void main(){
      vec3 p = vW;
      float ahead = -p.z;
      vec3 V = normalize(camPos - p);
      float fres = 0.04 + 0.96 * pow(1.0 - max(V.y, 0.0), 5.0);
      vec3 c = base * (0.75 + 0.25 * smoothstep(-5.0, 30.0, ahead));
      // a quiet surface: faint large-scale mottling, like polished stone
      float nz = vnoise(p.xz * 0.35) * 0.6 + vnoise(p.xz * 1.7) * 0.4;
      c *= 0.82 + 0.36 * nz;
      // every fret's line runs off to the distance, thin and anti-aliased
      float fl = 0.0;
      float fNear = clamp(floor(fretOf(p.x) + 0.5), 0.0, 24.0);
      fl = max(aaLine(p.x - xOf(fNear), 0.012), max(aaLine(p.x - xOf(fNear - 1.0), 0.012) * step(1.0, fNear), aaLine(p.x - xOf(fNear + 1.0), 0.012) * step(fNear, 23.0)));
      float outside = (p.x < lane.x - 0.05 || p.x > lane.y + 0.05) ? 0.45 : 1.0;
      c += lineCol * fl * lineA * outside * (1.0 - smoothstep(10.0, zFar, ahead) * 0.6);
      // the hand position: a channel, fret separators, two bright rails with a soft glow
      bool inZ = ahead > lane.z && ahead < lane.w;
      if (inZ) {
        float inX = smoothstep(lane.x - 0.01, lane.x + 0.01, p.x) * (1.0 - smoothstep(lane.y - 0.01, lane.y + 0.01, p.x));
        c = mix(c, laneFill * (0.8 + 0.4 * smoothstep(zFar, 0.0, ahead)), inX * 0.85);
        // a soft lighter strip down the middle of each lane
        float sep = 0.0;
        float xf = xOf(fNear);
        if (xf > lane.x + 0.01 && xf < lane.y - 0.01) sep = aaLine(p.x - xf, 0.02);
        c += laneEdge * sep * 0.18 * inX;
        float dr = min(abs(p.x - lane.x), abs(p.x - lane.y));
        float r = aaLine(dr, 0.018);
        float g = exp(-dr * 14.0) * 0.22 + exp(-dr * 3.0) * 0.04;
        c += rail * (r * (1.0 + railHot) + g * (1.0 + railHot * 0.6));
        // beat lines across the channel (bars brighter)
        for (int i = 0; i < 16; i++) {
          float bz = beats[i].x;
          float bl = aaLine(ahead - bz, beats[i].y > 0.5 ? 0.03 : 0.015);
          c += laneEdge * bl * inX * beatK * (beats[i].y > 0.5 ? 0.9 : 0.35);
        }
      }
      // light from the notes falls on the floor under them; studio: a soft contact shadow too
      vec3 glow = vec3(0.0);
      float ao = 0.0;
      for (int i = 0; i < ${MAXG}; i++) {
        vec4 g = gems[i];
        if (g.z > 900.0) continue;
        float hgt = g.y;
        vec2 d = vec2(p.x - g.x, p.z - g.z);
        float rx = g.w + hgt * 0.55 + 0.12;
        float rz = 0.22 + hgt * 0.5;
        float e = exp(-(d.x * d.x) / (rx * rx) - (d.y * d.y) / (rz * rz));
        glow += gemCol[i] * e / (1.0 + hgt * 1.6);
        float rx2 = g.w + hgt * 0.18 + 0.05, rz2 = 0.12 + hgt * 0.2;
        ao += exp(-(d.x * d.x) / (rx2 * rx2) - (d.y * d.y) / (rz2 * rz2)) / (1.0 + hgt * 2.2);
      }
      c *= 1.0 - clamp(ao * aoK, 0.0, 0.85);
      c += glow * glowK * 0.25;
      // reflection of everything above (rendered from below), blurred by roughness and distance
      vec4 pr = texMat * vec4(p, 1.0);
      vec2 uv = pr.xy / pr.w;
      float blur = rough * (0.003 + ahead * 0.00012);
      vec3 rc = vec3(0.0);
      rc += texture2D(refl, uv).rgb * 0.2;
      rc += texture2D(refl, uv + vec2( blur, 0.0)).rgb * 0.1;
      rc += texture2D(refl, uv + vec2(-blur, 0.0)).rgb * 0.1;
      rc += texture2D(refl, uv + vec2(0.0,  blur * 1.6)).rgb * 0.1;
      rc += texture2D(refl, uv + vec2(0.0, -blur * 1.6)).rgb * 0.1;
      rc += texture2D(refl, uv + vec2( blur,  blur) * 1.4).rgb * 0.1;
      rc += texture2D(refl, uv + vec2(-blur,  blur) * 1.4).rgb * 0.1;
      rc += texture2D(refl, uv + vec2( blur, -blur) * 1.4).rgb * 0.1;
      rc += texture2D(refl, uv + vec2(-blur, -blur) * 1.4).rgb * 0.1;
      c += rc * reflK * mix(0.55, 1.0, fres) * smoothstep(-0.05, 0.4, ahead);
      if (ahead < 0.0) c *= clamp(1.0 + ahead * 0.45, 0.0, 1.0);
      // the horizon's light along the polished floor
      c += skyCol * fres * reflK * 0.55 * smoothstep(2.0, zFar, ahead);
      // the far end melts into the distance
      float fog = smoothstep(zFar * 0.35, zFar * 1.6, ahead);
      c = mix(c, fogCol, fog);
      
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 1, 1), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.set(10, 0, -790);
floor.userData.noReflect = true;
scene.add(floor);

// reflection: the scene seen from below the floor, at half size
const reflRT = new THREE.WebGLRenderTarget(Math.round(RW / 2), Math.round(RH / 2), { type: THREE.HalfFloatType, samples: 0 });
floorU.refl.value = reflRT.texture;
const mirrorCam = new THREE.PerspectiveCamera(70, W / HH, 0.05, 900);
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const ABOVE = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
function renderReflection() {
  const p = camera.position;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  mirrorCam.position.set(p.x, -p.y, p.z);
  mirrorCam.up.set(0, -1, 0);
  mirrorCam.lookAt(p.x + dir.x * 10, -(p.y + dir.y * 10), p.z + dir.z * 10);
  mirrorCam.updateMatrixWorld();
  mirrorCam.updateProjectionMatrix();
  floorU.texMat.value.copy(BIAS).multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
  const hidden = [];
  scene.traverse((o) => {
    if (o.userData.noReflect && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  const bg = scene.background;
  scene.background = null;
  renderer.clippingPlanes = ABOVE;
  renderer.setRenderTarget(reflRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, mirrorCam);
  renderer.setRenderTarget(null);
  renderer.clippingPlanes = [];
  scene.background = bg;
  for (const o of hidden) o.visible = true;
}

// ------------------------------------------------------------------------- materials --
const NECK_CLIP = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.02)]; // keeps z <= 0.02: sustains end at the neck

function metal(color, rough = 0.18) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, clearcoat: STYLE === 'studio' ? 0 : 0.6, clearcoatRoughness: 0.08 });
}
function stringMat(i) {
  const hex = STRING[i];
  if (STYLE === 'neon') return new THREE.MeshPhysicalMaterial({ color: lin(hex, 0.3), emissive: C(hex), emissiveIntensity: 0.75, roughness: 0.3, metalness: 0.2 });
  if (STYLE === 'studio') return new THREE.MeshPhysicalMaterial({ color: C(hex), emissive: C(hex), emissiveIntensity: 0.32, roughness: 0.32, metalness: 0.35, clearcoat: 0.5 });
  return new THREE.MeshPhysicalMaterial({ color: C(hex).lerp(C('#ffffff'), 0.12), emissive: C(hex), emissiveIntensity: 0.55, roughness: 0.16, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.05 });
}

// ------------------------------------------------------------------------- the neck --
const neck = new THREE.Group();
scene.add(neck);
const XN = XF(-3);
const XE = XF(24) + 0.8;
const YB = -0.25;
const YT = YTOP + 0.32;
const strings = [];
for (let s = 0; s < N; s++) {
  const th = (0.019 - s * 0.0014) * (STYLE === 'studio' ? 1.25 : 1);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(th, th, XE - XN, 20, 1), stringMat(s));
  m.rotation.z = Math.PI / 2;
  m.position.set((XN + XE) / 2, strH(s), 0);
  m.userData.base = m.material.emissiveIntensity;
  neck.add(m);
  strings.push(m);
}
// a soft coloured glow behind each string
const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
const stripTex = (() => {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#000');
  g.addColorStop(0.5, '#fff');
  g.addColorStop(1, '#000');
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
})();
const stringGlow = [];
for (let s = 0; s < N; s++) {
  const k = STYLE === 'neon' ? 0.18 : 0.0;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(XE - XN, GY * 0.45), new THREE.MeshBasicMaterial({ color: lin(STRING[s], k), alphaMap: stripTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  m.position.set((XN + XE) / 2, strH(s), -0.04);
  m.userData.base = k;
  m.userData.hex = STRING[s];
  neck.add(m);
  stringGlow.push(m);
}
// fret wires: round polished posts; the nut ivory and a little wider
const fretMats = [];
const fretMeshes = [];
for (let f = 0; f <= 24; f++) {
  const r = f === 0 ? 0.04 : 0.021;
  const mat = f === 0 ? new THREE.MeshPhysicalMaterial({ color: '#e8dfc8', roughness: 0.35, clearcoat: 0.6, emissive: C('#ffffff'), emissiveIntensity: 0 }) : new THREE.MeshPhysicalMaterial({ color: STYLE === 'studio' ? '#c3c8d0' : '#cfd6e0', metalness: STYLE === 'neon' ? 0.9 : 0.55, roughness: STYLE === 'studio' ? 0.35 : 0.22, clearcoat: 0.5 });
  mat.emissive = C('#ffffff');
  mat.emissiveIntensity = 0;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, YT - YB, 18, 1), mat);
  m.position.set(XF(f), (YT + YB) / 2, 0);
  neck.add(m);
  fretMats.push(mat);
  fretMeshes.push(m);
}
// lit-post glow planes (shown when a note lands between two wires)
const postGlow = [];
for (let f = 0; f <= 24; f++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, YT - YB + 0.06), new THREE.MeshBasicMaterial({ color: '#ffffff', map: (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 4;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 4);
    return new THREE.CanvasTexture(c);
  })(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  m.position.set(XF(f), (YT + YB) / 2, -0.06);
  m.visible = false;
  neck.add(m);
  postGlow.push(m);
}
// a faint smoked-glass board behind the strings (chrome, studio)
if (STYLE !== 'neon') {
  const board = new THREE.Mesh(
    roundedBox(XE - XN, YT - YB - 0.12, 0.03, 0.012, 2),
    new THREE.MeshPhysicalMaterial({ color: STYLE === 'studio' ? '#20252c' : '#0a121a', roughness: STYLE === 'studio' ? 0.55 : 0.18, metalness: 0, clearcoat: STYLE === 'studio' ? 0.2 : 1, transparent: true, opacity: STYLE === 'studio' ? 0.55 : 0.42, depthWrite: false })
  );
  board.position.set((XN + XE) / 2, (YT + YB) / 2, -0.12);
  board.renderOrder = -1;
  neck.add(board);
}

// --------------------------------------------------------------------- labels (text) --
const FONT = "'Archivo', sans-serif";
const LABELS = new Map();
function labelTex(text, opts) {
  const key = text + JSON.stringify(opts);
  let t = LABELS.get(key);
  if (t) return t;
  const H = 256;
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  x.font = `${opts.weight || 800} ${H * 0.72}px ${FONT}`;
  const tw = x.measureText(text).width;
  c.width = Math.ceil(tw + H * (opts.pill ? 0.7 : 0.3));
  c.height = H;
  x.font = `${opts.weight || 800} ${H * 0.72}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  if (opts.pill) {
    const r = H * 0.36;
    x.fillStyle = opts.pillBg || 'rgba(8,12,18,0.82)';
    x.beginPath();
    x.roundRect(H * 0.06, H * 0.12, c.width - H * 0.12, H * 0.76, r);
    x.fill();
    x.lineWidth = H * 0.035;
    x.strokeStyle = opts.pillLine || 'rgba(255,255,255,0.55)';
    x.stroke();
  }
  if (opts.shadow) {
    x.shadowColor = opts.shadow;
    x.shadowBlur = H * 0.08;
    x.shadowOffsetY = H * 0.02;
  }
  if (opts.grad) {
    const g = x.createLinearGradient(0, H * 0.2, 0, H * 0.8);
    g.addColorStop(0, opts.grad[0]);
    g.addColorStop(1, opts.grad[1]);
    x.fillStyle = g;
  } else x.fillStyle = opts.color || '#ffffff';
  x.fillText(text, c.width / 2, H * 0.53);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.userData = { aspect: c.width / c.height };
  LABELS.set(key, t);
  return t;
}
const billboards = [];
function label(text, height, opts) {
  const tex = labelTex(text, opts);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(height * tex.userData.aspect, height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false, color: new THREE.Color(1, 1, 1).multiplyScalar(opts.k || 1) }));
  m.renderOrder = 10;
  m.userData.noReflect = true;
  billboards.push(m);
  return m;
}
const GOLD = { grad: ['#fff1b8', '#ffb627'], shadow: 'rgba(0,0,0,0.85)' };
const TEAL = { color: STYLE === 'neon' ? '#c9a2ff' : '#7fd8e6', shadow: 'rgba(0,0,0,0.8)', weight: 700 };

// --------------------------------------------------------------------------- notes --
const track = new THREE.Group(); // everything that moves toward you, placed at its song time
scene.add(track);
const notesOut = [];
const sustains = [];

function gemMaterials(s) {
  const hex = STRING[s];
  const dark = STRING_DARK[s];
  if (STYLE === 'chrome') {
    return {
      // tinted glass over a lit inner stone, set in polished chrome
      body: new THREE.MeshPhysicalMaterial({ color: C(hex).multiplyScalar(0.55), roughness: 0.04, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.6, specularIntensity: 1, emissive: C(hex), emissiveIntensity: 0.12, transparent: true, opacity: 0.55, depthWrite: false }),
      bezel: metal('#e6ebf2', 0.1),
      inner: new THREE.MeshPhysicalMaterial({ color: C(hex), roughness: 0.35, metalness: 0.1, emissive: C(hex), emissiveIntensity: 0.6 }),
      core: new THREE.MeshBasicMaterial({ color: lin(hex, 1.6), toneMapped: true }),
    };
  }
  if (STYLE === 'neon') {
    return {
      body: new THREE.MeshPhysicalMaterial({ color: C(dark).multiplyScalar(0.35), roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1, emissive: C(hex), emissiveIntensity: 0.12 }),
      bezel: new THREE.MeshBasicMaterial({ color: lin(hex, 3.0) }),
      core: new THREE.MeshBasicMaterial({ color: lin(hex, 1.8) }),
    };
  }
  return {
    body: new THREE.MeshPhysicalMaterial({ color: C(hex), roughness: 0.3, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.12, sheen: 0.3, emissive: C(hex), emissiveIntensity: 0.1 }),
    bezel: new THREE.MeshPhysicalMaterial({ color: '#f4f6f8', roughness: 0.25, clearcoat: 0.5, emissive: C('#ffffff'), emissiveIntensity: 0 }),
    core: new THREE.MeshBasicMaterial({ color: lin(hex, 1.0).lerp(C('#ffffff'), 0.35) }),
  };
}

const DEPTH = 0.14;
const GEO = new Map();
const geo = (key, make) => GEO.get(key) || (GEO.set(key, make()), GEO.get(key));

/** One note's block: built at the origin facing you; placed later. */
function makeGem(nt, inChord, an) {
  const g = new THREE.Group();
  const mats = gemMaterials(nt.s);
  let hw;
  let hh;
  if (nt.f === 0) {
    hw = (XF(an.fret - 1 + an.width) - XF(an.fret - 1)) / 2 - 0.1;
    hh = GY * 0.15;
  } else {
    hw = laneW(nt.f) * (inChord ? 0.27 : 0.3);
    hh = GY * (inChord ? 0.4 : 0.44);
  }
  const r = Math.min(hw, hh) * 0.34;
  const body = new THREE.Mesh(geo(`b${hw.toFixed(3)}${hh.toFixed(3)}`, () => roundedBox(hw * 2, hh * 2, DEPTH, r, 4)), mats.body);
  g.add(body);
  if (STYLE === 'chrome') {
    // the stone sits in a chrome setting
    const bz = new THREE.Mesh(geo(`z${hw.toFixed(3)}${hh.toFixed(3)}`, () => roundedBox(hw * 2 + 0.05, hh * 2 + 0.05, DEPTH * 0.55, r + 0.025, 4)), mats.bezel);
    bz.position.z = -DEPTH * 0.3;
    g.add(bz);
    const inner = new THREE.Mesh(geo(`i${hw.toFixed(3)}${hh.toFixed(3)}`, () => roundedBox(hw * 1.62, hh * 1.5, DEPTH * 0.5, r * 0.7, 3)), mats.inner);
    inner.position.z = -DEPTH * 0.05;
    g.add(inner);
    body.renderOrder = 3;
  } else if (STYLE === 'neon') {
    // a neon tube round the front
    const ring = new THREE.Mesh(geo(`r${hw.toFixed(3)}${hh.toFixed(3)}`, () => outlineGeo(hw * 2, hh * 2, r, Math.min(hw, hh) * 0.2)), mats.bezel);
    ring.position.z = DEPTH / 2 + 0.003;
    g.add(ring);
  } else {
    // a fine white edge on the front
    const ring = new THREE.Mesh(geo(`w${hw.toFixed(3)}${hh.toFixed(3)}`, () => outlineGeo(hw * 2, hh * 2, r, Math.min(hw, hh) * 0.09)), mats.bezel);
    ring.position.z = DEPTH / 2 + 0.002;
    g.add(ring);
  }
  // a light bar across the middle of the face (as today), brighter as the note nears
  const cw = nt.f === 0 ? hw * 1.6 : hw * 1.1;
  const core = new THREE.Mesh(geo(`c${cw.toFixed(3)}${hh.toFixed(3)}`, () => roundedBox(cw, Math.max(0.018, hh * (nt.f === 0 ? 0.5 : 0.28)), 0.01, Math.max(0.008, hh * 0.12), 2)), mats.core);
  core.position.z = DEPTH / 2 + 0.004;
  if (STYLE === 'studio') core.visible = false;
  g.add(core);
  g.userData = { mats, hw, hh, core };
  return g;
}

function bendChevron(hw, hh) {
  const s = new THREE.Shape();
  const w = hw * 0.55;
  const t = Math.min(hw, hh) * 0.22;
  s.moveTo(-w, -hh * 0.35);
  s.lineTo(0, hh * 0.45);
  s.lineTo(w, -hh * 0.35);
  s.lineTo(w - t, -hh * 0.35);
  s.lineTo(0, hh * 0.45 - t * 1.6);
  s.lineTo(-w + t, -hh * 0.35);
  return new THREE.ShapeGeometry(s);
}

function ribbonTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 4;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 128, 0);
  // grey levels: the alpha map reads brightness, not the canvas's own see-through
  g.addColorStop(0, '#000');
  g.addColorStop(0.07, '#fff');
  g.addColorStop(0.15, '#777');
  g.addColorStop(0.5, '#4a4a4a');
  g.addColorStop(0.85, '#777');
  g.addColorStop(0.93, '#fff');
  g.addColorStop(1, '#000');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 4);
  return new THREE.CanvasTexture(c);
}
const RIBBON_TEX = ribbonTexture();

/** A sustain: a ribbon under the note's string, bending up toward the next string on a bend. */
function makeSustain(nt, an) {
  const end = nt.t + Math.max(nt.sus, 0.12);
  const L0 = level(nt.s);
  const dir = L0 > (N - 1) / 2 ? -1 : 1;
  const x = nt.f === 0 ? (XF(an.fret - 1) + XF(an.fret - 1 + an.width)) / 2 : laneC(nt.f);
  const half = nt.f === 0 ? (XF(an.fret - 1 + an.width) - XF(an.fret - 1)) / 2 - 0.15 : laneW(nt.f) * 0.16;
  const bendAt = (time) => {
    const pts = nt.bends || [];
    if (!nt.bend) return 0;
    if (!pts.length) return nt.bend * clamp01((time - nt.t) / 0.1);
    const tb = pts[0].t < nt.t - 0.05 ? nt.t + pts[0].t : pts[0].t;
    return pts[0].step * smooth((time - nt.t) / Math.max(0.03, tb - nt.t));
  };
  const steps = 40;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= steps; i++) {
    const time = nt.t + ((end - nt.t) * i) / steps;
    const L = L0 + dir * bendAt(time) * 0.7;
    const y = nY(L) - GY * 0.12;
    const z = -(time * ZS);
    pos.push(x - half, y, z, x + half, y, z);
    uv.push(0, i / steps, 1, i / steps);
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const k = STYLE === 'neon' ? 1.6 : STYLE === 'studio' ? 0.9 : 1.15;
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: lin(STRING[nt.s], k), alphaMap: RIBBON_TEX, transparent: true, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: NECK_CLIP, blending: STYLE === 'studio' ? THREE.NormalBlending : THREE.AdditiveBlending }));
  m.renderOrder = 2;
  track.add(m);
  sustains.push({ m, nt, end });
  return m;
}

let CHART;
let T0 = 0;
const anchorAt = (t) => {
  const A = CHART.anchors;
  let a = A[0];
  for (const x of A) if (x.t <= t + 1e-6) a = x;
  return { fret: a.fret, width: a.width || 4, t: a.t, end: a.end };
};

function buildChart() {
  const notes = CHART.notes.map((n) => ({ ...n }));
  for (const nt of notes) {
    const an = anchorAt(nt.t);
    const gem = makeGem(nt, false, an);
    const x = nt.f === 0 ? (XF(an.fret - 1) + XF(an.fret - 1 + an.width)) / 2 : laneC(nt.f);
    const y = strH(nt.s);
    gem.position.set(x, y, -nt.t * ZS - DEPTH / 2);
    track.add(gem);
    const extra = [];
    if (nt.f > 0) {
      // a thin stem down to the floor, a mark in the lane and the fret number there
      const lw = laneW(nt.f);
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.022, y - gem.userData.hh, 0.022), new THREE.MeshBasicMaterial({ color: lin(STRING[nt.s], STYLE === 'neon' ? 1.4 : 0.9), transparent: true, opacity: 0.75, depthWrite: false }));
      stem.position.set(x, (y - gem.userData.hh) / 2, -nt.t * ZS - DEPTH / 2);
      track.add(stem);
      const mark = new THREE.Mesh(roundedBox(lw * 0.64, 0.01, 0.12, 0.004, 1), new THREE.MeshBasicMaterial({ color: lin(STRING[nt.s], STYLE === 'neon' ? 1.6 : 1.0), transparent: true, opacity: 0.8, depthWrite: false }));
      mark.position.set(x, 0.008, -nt.t * ZS);
      track.add(mark);
      const num = label(String(nt.f), 0.4, GOLD);
      num.position.set(x, 0.22, -nt.t * ZS + 0.34);
      track.add(num);
      extra.push(stem, mark, num);
    }
    const marks = [];
    if (nt.pullOff) marks.push('P');
    if (nt.hammerOn) marks.push('H');
    if (nt.bend) marks.push(`↑${({ 1: '½', 2: 'full', 3: '1½', 4: '2' })[nt.bend] || nt.bend / 2}`);
    if (nt.vibrato) marks.push('~');
    if (marks.length) {
      const pill = label(marks.join(' '), 0.17, { color: '#ffffff', pill: true, weight: 800, pillLine: STYLE === 'neon' ? 'rgba(255,120,220,0.9)' : 'rgba(255,255,255,0.6)' });
      pill.position.set(x, y + gem.userData.hh + GY * 0.42, -nt.t * ZS);
      track.add(pill);
      extra.push(pill);
    }
    if (nt.bend && nt.f > 0) {
      const ch = new THREE.Mesh(bendChevron(gem.userData.hw, gem.userData.hh), new THREE.MeshBasicMaterial({ color: lin('#fff3d6', STYLE === 'studio' ? 1.1 : 2.4), side: THREE.DoubleSide }));
      ch.position.z = DEPTH / 2 + 0.008;
      gem.add(ch);
      gem.userData.core.visible = false;
    }
    let sus = null;
    if (nt.sus > 0.05 || nt.bend) sus = makeSustain(nt, an);
    notesOut.push({ nt, gem, extra, sus, x, y, chord: null });
  }
  // chords: an upright frame on the highway across the hand position; repeats are empty frames
  let prev = null;
  for (const ce of CHART.chordEvents || []) {
    const an = anchorAt(ce.t);
    const fr = ce.strings.map((s) => s.f).filter((f) => f > 0);
    let lo = fr.length ? Math.min(...fr) - 1 : an.fret - 1;
    let hi = fr.length ? Math.max(...fr) : an.fret - 1 + an.width;
    lo = Math.min(lo, an.fret - 1);
    hi = Math.max(hi, an.fret - 1 + an.width);
    const xa = XF(lo);
    const xb = XF(hi);
    const repeat = prev && prev.chord === ce.chord && ce.t - prev.t < 1.2;
    prev = ce;
    const topL = Math.max(...ce.strings.map((n) => level(n.s)));
    const yT = repeat ? nY(topL) + GY * 0.2 : nY(topL) + GY * 0.55;
    const z = -ce.t * ZS;
    const frame = new THREE.Group();
    const w = 0.045;
    const railCol = STYLE === 'neon' ? lin('#ff5cd6', 1.7) : STYLE === 'studio' ? lin('#ffffff', 1.4) : lin('#9eeeff', 1.05);
    const fm = STYLE === 'studio' ? new THREE.MeshPhysicalMaterial({ color: '#f2f4f7', roughness: 0.25, clearcoat: 0.6, emissive: C('#ffffff'), emissiveIntensity: 0.25 }) : new THREE.MeshBasicMaterial({ color: railCol });
    for (const xx of [xa, xb]) {
      const post = new THREE.Mesh(roundedBox(w, yT, w, w * 0.45, 2), fm);
      post.position.set(xx, yT / 2, z);
      frame.add(post);
    }
    const top = new THREE.Mesh(roundedBox(xb - xa + w, w, w, w * 0.45, 2), fm);
    top.position.set((xa + xb) / 2, yT, z);
    frame.add(top);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa, yT), new THREE.MeshPhysicalMaterial({ color: STYLE === 'neon' ? '#1a0b2a' : STYLE === 'studio' ? '#d9dee5' : '#0e3646', roughness: 0.15, transparent: true, opacity: STYLE === 'studio' ? 0.16 : 0.38, depthWrite: false, side: THREE.DoubleSide }));
    glass.position.set((xa + xb) / 2, yT / 2, z - 0.15);
    glass.renderOrder = 1;
    frame.add(glass);
    // a dimmer back edge for depth
    const bm = new THREE.MeshBasicMaterial({ color: railCol.clone().multiplyScalar(0.35), transparent: true, opacity: 0.7 });
    for (const xx of [xa, xb]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, w * 0.6, 0.3), bm);
      e.position.set(xx, yT, z - 0.15);
      frame.add(e);
    }
    track.add(frame);
    const gems = [];
    if (!repeat) {
      for (const sn of ce.strings) {
        const nt = { t: ce.t, s: sn.s, f: sn.f, sus: ce.sus || 0 };
        const gem = makeGem(nt, true, an);
        const x = sn.f === 0 ? (xa + xb) / 2 : laneC(sn.f);
        gem.position.set(x, strH(sn.s), z - DEPTH / 2);
        track.add(gem);
        gems.push({ nt, gem, x, y: strH(sn.s) });
      }
      const name = (CHART.chords && CHART.chords[ce.chord] && CHART.chords[ce.chord].name) || '';
      if (name) {
        const l = label(name, 0.2, { color: '#ffffff', weight: 800, shadow: 'rgba(0,0,0,0.9)' });
        l.position.set((xa + xb) / 2, yT + 0.2, z);
        frame.add(l);
      }
    }
    notesOut.push({ nt: { t: ce.t, s: -1 }, chord: { frame, gems, xa, xb, repeat }, gem: null, extra: [] });
    for (const g of gems) notesOut.push({ nt: g.nt, gem: g.gem, x: g.x, y: g.y, extra: [], sus: null, inChord: true });
  }
}

// note spots lighting up on the neck before a note lands (pool)
const OUTLINES = [];
for (let i = 0; i < 14; i++) {
  const m = new THREE.Mesh(outlineGeo(1, 1, 0.2, 0.06), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  m.visible = false;
  m.userData.noReflect = true;
  neck.add(m);
  OUTLINES.push(m);
}

// the hand position's edge posts at the neck and the fret numbers under it
const handPosts = [];
for (let i = 0; i < 2; i++) {
  const m = new THREE.Mesh(roundedBox(0.045, YT - YB, 0.045, 0.02, 2), new THREE.MeshBasicMaterial({ color: STYLE === 'neon' ? lin('#ff7ad2', 1.6) : STYLE === 'studio' ? lin('#ffffff', 1.1) : lin('#bff4ff', 1.15) }));
  m.position.y = (YT + YB) / 2;
  m.position.z = 0.02;
  neck.add(m);
  handPosts.push(m);
}
const fretNums = [];
for (let f = 1; f <= 24; f++) {
  const gold = label(String(f), 0.34, GOLD);
  const teal = label(String(f), 0.22, TEAL);
  for (const l of [gold, teal]) {
    l.position.set(laneC(f), YB - 0.2, 0.3);
    l.material.depthTest = false;
    l.renderOrder = 20;
    l.visible = false;
    neck.add(l);
  }
  fretNums.push({ f, gold, teal });
}
// inlay dots between the strings
const inlays = [];
for (const f of INLAYS) {
  const r = Math.min(laneW(f) * 0.12, 0.075);
  const ys = f % 12 === 0 ? [HL + (YTOP - HL) * 0.28, HL + (YTOP - HL) * 0.72] : [(HL + YTOP) / 2];
  for (const y of ys) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    m.position.set(laneC(f), y, -0.06);
    neck.add(m);
    inlays.push({ f, m });
  }
}

// --------------------------------------------------------------------- hit effects --
const MAXP = 1400;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAXP * 3), 3));
pGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAXP * 3), 3));
pGeo.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(MAXP), 1));
const pMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { scale: { value: 1 } },
  vertexShader: /* glsl */ `uniform float scale; attribute float size; attribute vec3 color; varying vec3 vC;
    void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */ `varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.8, 1.0, r)); if (a < 0.01) discard; gl_FragColor = vec4(vC * a, a); }`,
});
const points = new THREE.Points(pGeo, pMat);
points.frustumCulled = false;
points.userData.noReflect = false;
scene.add(points);
const FLASHES = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffffff' }));
  m.visible = false;
  m.renderOrder = 5;
  scene.add(m);
  FLASHES.push(m);
}
const RINGS = [];
const ringGeo = new THREE.PlaneGeometry(1, 1);
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: glowTex, color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.visible = false;
  m.renderOrder = 5;
  scene.add(m);
  RINGS.push(m);
}

// -------------------------------------------------------------- neon: light and dust --
const dust = [];
if (STYLE === 'neon') {
  // light shafts falling on the far end of the highway
  const shaftMat = (col, k) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: { col: { value: lin(col, k) } },
      vertexShader: /* glsl */ `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 col; varying vec2 vU; void main(){ float x = abs(vU.x - 0.5) * 2.0; float a = pow(1.0 - x, 2.2) * smoothstep(0.0, 0.35, vU.y) * (0.35 + 0.65 * (1.0 - vU.y)); gl_FragColor = vec4(col, a); }`,
    });
  const shafts = STYLE === 'neon'
    ? [[-8, '#ff3cc8', 0.3, 0.3], [2, '#7a5cff', 0.26, -0.08], [11, '#29e6ff', 0.26, -0.32], [18, '#ff3cc8', 0.2, -0.5], [-2, '#29e6ff', 0.18, 0.12]]
    : [[-4, '#bfe6ff', 0.06, 0.25], [4, '#bfe6ff', 0.07, 0], [12, '#bfe6ff', 0.06, -0.25]];
  for (const [x, col, k, tilt] of shafts) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(STYLE === 'neon' ? 7 : 3.2, 46, 1, 1), shaftMat(col, k));
    m.position.set(x, 18, -60);
    m.rotation.set(0, 0, tilt);
    m.userData.noReflect = true;
    m.renderOrder = -5;
    scene.add(m);
  }
}
if (STYLE === 'neon') {
  seed = 99;
  const n = 500;
  const pos = new Float32Array(n * 3);
  const base = [];
  for (let i = 0; i < n; i++) base.push([-14 + rand() * 34, rand() * 9, -rand() * 70, rand() * 6.28, rand()]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = base[i][4] > 0.5 ? C('#ff7ae0') : C('#7ae8ff');
    col.set([c.r * 0.5, c.g * 0.5, c.b * 0.5], i * 3);
    size[i] = 0.03 + base[i][4] * 0.05;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.Points(g, pMat.clone());
  m.frustumCulled = false;
  m.userData.noReflect = true;
  scene.add(m);
  dust.push({ m, base, pos });
}

// ------------------------------------------------------------------ post processing --
const rt = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.HalfFloatType, samples: MSAA });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(1);
composer.setSize(RW, RH);
composer.renderToScreen = false;
composer.addPass(new RenderPass(scene, camera));
// soft focus far away (the near notes and the neck stay sharp)
const dof = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, y0: { value: 0.5 }, y1: { value: 0.65 }, px: { value: new THREE.Vector2(1 / RW, 1 / RH) }, maxR: { value: 1.7 * SS } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float y0, y1, maxR; uniform vec2 px; varying vec2 vUv;
    void main(){
      float k = smoothstep(y0, y1, vUv.y);
      vec4 c = texture2D(tDiffuse, vUv);
      if (k < 0.02) { gl_FragColor = c; return; }
      float r = k * maxR;
      vec3 acc = c.rgb; float wsum = 1.0;
      for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float a = fi * 2.39996;
        float rr = sqrt((fi + 0.5) / 16.0) * r;
        vec2 o = vec2(cos(a), sin(a)) * rr * px;
        acc += texture2D(tDiffuse, vUv + o).rgb; wsum += 1.0;
      }
      gl_FragColor = vec4(acc / wsum, c.a);
    }`,
});
composer.addPass(dof);
const bloom = new UnrealBloomPass(new THREE.Vector2(RW, RH), LK.bloom[0], LK.bloom[1], LK.bloom[2]);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// down to the shown size: each pixel the average of SS x SS rendered ones, in linear light; a soft vignette
const finalMat = new THREE.ShaderMaterial({
  uniforms: { src: { value: null }, srcPx: { value: new THREE.Vector2(1 / RW, 1 / RH) }, ss: { value: SS } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D src; uniform vec2 srcPx; uniform float ss; varying vec2 vUv;
    vec3 toLin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    vec3 toSrgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec3 acc = vec3(0.0);
      vec2 base = vUv - srcPx * (ss - 1.0) * 0.5;
      float n = 0.0;
      for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
        if (float(i) >= ss || float(j) >= ss) continue;
        acc += toLin(clamp(texture2D(src, base + vec2(float(i), float(j)) * srcPx).rgb, 0.0, 1.0)); n += 1.0;
      }
      vec3 c = acc / n;
      vec2 q = vUv - 0.5;
      c *= 1.0 - 0.28 * smoothstep(0.35, 0.85, length(q * vec2(1.0, 1.25)));
      gl_FragColor = vec4(toSrgb(c), 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});
const finalQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), finalMat);
const finalScene = new THREE.Scene();
finalScene.add(finalQuad);
const finalCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// --------------------------------------------------------------------------- camera --
const CAM = { fov: 60, yaw: 0.075, neckY: 0.83, fill: 0.88 };
function viewFor(an) {
  let lo = an.fret - 1 - 1.6;
  let hi = an.fret - 1 + an.width + 1.4;
  if (hi - lo < 11) {
    const c = (lo + hi) / 2;
    lo = c - 5.5;
    hi = c + 5.5;
  }
  if (lo < -2.5) {
    hi += -2.5 - lo;
    lo = -2.5;
  }
  return [XF(lo), XF(hi)];
}
function placeCamera(t) {
  // glide between hand positions (smoothly over 0.8 s), as the app does
  const A = CHART.anchors;
  let cx;
  let span;
  const [a0, a1] = viewFor(anchorAt(t));
  cx = (a0 + a1) / 2;
  span = a1 - a0;
  for (const a of A) {
    if (a.t > t && a.t < t + 0.8) {
      const [b0, b1] = viewFor({ fret: a.fret, width: a.width || 4 });
      const k = smooth(1 - (a.t - t) / 0.8);
      cx += ((b0 + b1) / 2 - cx) * k;
      span += (b1 - b0 - span) * k;
    }
  }
  const elev = 0.56;
  const pitch = 0.36;
  const F = HH / 2 / Math.tan(((CAM.fov / 2) * Math.PI) / 180);
  const dView = (F * span) / (CAM.fill * W);
  const d = dView / Math.cos(elev - pitch);
  const yMid = HL + ((N - 1) / 2) * GY;
  const yaw = CAM.yaw;
  const ce = Math.cos(elev);
  const pos = [cx + d * ce * Math.sin(yaw), yMid + d * Math.sin(elev), d * ce * Math.cos(yaw)];
  const look = [pos[0] - Math.sin(yaw) * Math.cos(pitch), pos[1] - Math.sin(pitch), pos[2] - Math.cos(yaw) * Math.cos(pitch)];
  camera.fov = CAM.fov;
  camera.aspect = W / HH;
  if (Q.get('cam') === 'close') {
    camera.fov = 30;
    camera.position.set(cx + 2.6, 2.7, 6.0);
    camera.up.set(0, 1, 0);
    camera.lookAt(cx + 0.4, 0.55, -2.2);
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    floorU.camPos.value.copy(camera.position);
    mirrorCam.aspect = W / HH;
    mirrorCam.fov = 60;
    return cx;
  }
  camera.position.set(...pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(...look);
  const neckAt = HH / 2 + F * Math.tan(elev - pitch);
  let dy = HH * CAM.neckY - neckAt;
  dy -= HH * 0.035; // a little more room under the neck for the fret numbers
  camera.setViewOffset(W, HH, 0, -dy, W, HH);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  mirrorCam.aspect = W / HH;
  mirrorCam.fov = 78;
  floorU.camPos.value.copy(camera.position);
  return cx;
}

// ------------------------------------------------------------------------ per frame --
const tmpV = new THREE.Vector3();
function frame(tChart) {
  const t = tChart;
  const camX = placeCamera(t);
  track.position.z = t * ZS;
  const an = anchorAt(t);
  const ax0 = XF(an.fret - 1);
  const ax1 = XF(an.fret - 1 + an.width);

  // the floor's hand-position channel and beats
  const A = CHART.anchors;
  let laneSet = false;
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const end = A[i + 1] ? A[i + 1].t : a.end || a.t + 600;
    if (end < t - 0.2 || a.t > t + AHEAD) continue;
    if (!laneSet) {
      floorU.lane.value.set(XF(a.fret - 1), XF(a.fret - 1 + (a.width || 4)), Math.max(-ZS * 0.14, (a.t - t) * ZS), Math.min(ZF * 1.2, (end - t) * ZS));
      laneSet = true;
    }
  }
  const beats = CHART.beats || [];
  let bi = 0;
  for (const b of beats) {
    if (b.t < t || b.t > t + AHEAD) continue;
    if (bi < 16) floorU.beats.value[bi++].set((b.t - t) * ZS, b.m >= 0 ? 1 : 0);
  }
  for (; bi < 16; bi++) floorU.beats.value[bi].set(999, 0);

  // hand posts, fret numbers, inlays
  handPosts[0].position.x = ax0;
  handPosts[1].position.x = ax1;
  for (const fn of fretNums) {
    const inA = fn.f >= an.fret && fn.f < an.fret + an.width;
    const near = Math.abs(laneC(fn.f) - camX) < 8;
    fn.gold.visible = inA;
    fn.teal.visible = !inA && near && INLAYS.includes(fn.f);
  }
  for (const il of inlays) {
    const inA = il.f >= an.fret && il.f < an.fret + an.width;
    il.m.material.color = inA ? lin('#ffd36a', STYLE === 'studio' ? 1.1 : 1.8) : lin(STYLE === 'neon' ? '#b07aff' : '#6fd0dc', 0.7);
  }

  // notes
  const gemsNear = [];
  for (const fn of fretMats) fn.emissiveIntensity = 0;
  for (const pg of postGlow) pg.visible = false;
  const postK = new Array(25).fill(0);
  const strK = new Array(N).fill(0);
  let oi = 0;
  const bursts = [];
  for (const o of notesOut) {
    const nt = o.nt;
    const dt = nt.t - t; // seconds until it lands
    if (o.chord) {
      const ch = o.chord;
      ch.frame.visible = dt > -0.06 && dt < AHEAD + 0.3;
      if (ch.frame.visible) {
        const k = dt < 0 ? clamp01(1 + dt / 0.06) : 1;
        ch.frame.scale.set(1, 1, 1);
        ch.frame.traverse((m) => m.material && (m.material.opacity = m.material.transparent ? (m.material.userData.o ?? (m.material.userData.o = m.material.opacity)) * k : 1));
      }
      if (dt <= 0 && dt > -0.5 && ch.repeat) bursts.push({ x: (ch.xa + ch.xb) / 2, y: 0.2, age: -dt, hex: '#ffffff', wide: ch.xb - ch.xa, small: true });
      continue;
    }
    const visible = dt > -0.03 && dt < AHEAD + 0.3;
    o.gem.visible = visible;
    for (const e of o.extra) e.visible = visible && dt > 0.05 && dt < AHEAD * 0.78;
    if (visible) {
      const near = clamp01(1 - (dt * ZS) / (ZS * 0.5));
      const m = o.gem.userData.mats;
      const flare = dt < 0.1 ? 1 - dt / 0.1 : 0;
      if (STYLE === 'chrome') {
        m.inner.emissiveIntensity = 0.6 + 1.6 * near * near + flare * 2.5;
        m.core.color = lin(STRING[nt.s], 1.4 + 3.5 * near * near + flare * 4).lerp(C('#ffffff'), flare * 0.5);
      } else if (STYLE === 'neon') {
        m.bezel.color = lin(STRING[nt.s], 2.6 + 3 * near + flare * 5).lerp(lin('#ffffff', 6), flare * 0.6);
        m.core.color = lin(STRING[nt.s], 1.5 + 2.5 * near);
        m.body.emissiveIntensity = 0.12 + 0.5 * near * near;
      } else {
        m.bezel.emissiveIntensity = near * near * 1.6 + flare * 2;
        m.body.emissiveIntensity = 0.1 + 0.35 * near * near;
      }
      if (dt * ZS < 40 && gemsNear.length < MAXG) gemsNear.push(o);
      // the note's spot on the neck shows a second early, brighter as it nears
      if (dt < 1.0 && dt > -0.05 && oi < OUTLINES.length) {
        const ol = OUTLINES[oi++];
        const k = smooth(1 - dt / 1.0);
        ol.visible = true;
        const hw = o.gem.userData.hw;
        const hh = o.gem.userData.hh;
        ol.scale.set(hw * 2 + 0.06, hh * 2 + 0.06, 1);
        ol.position.set(o.x, o.y, 0.03);
        ol.material.color = lin(STRING[nt.s], (0.25 + 1.2 * k * k) * (STYLE === 'studio' ? 0.7 : 1.4));
      }
    }
    // wires around a note light up as it lands, and stay lit while it rings
    const f = nt.f;
    const end = nt.t + (nt.sus || 0);
    let pl = 0;
    if (t < nt.t) pl = 0.95 * smooth(1 - (nt.t - t) / 0.16) ** 1.5;
    else if (t <= end) pl = Math.max(0.45 + 0.55 * Math.exp(-(t - nt.t) / 0.12), 0.5);
    else pl = Math.max(0, (end > nt.t + 0.05 ? 0.5 : 0.45 + 0.55 * Math.exp(-(t - nt.t) / 0.12)) * (1 - (t - end) / 0.22));
    if (pl > 0 && f > 0) {
      postK[f - 1] = Math.max(postK[f - 1], pl);
      postK[f] = Math.max(postK[f], pl);
    }
    if (dt <= 0 && dt > -0.7) {
      bursts.push({ x: o.x, y: o.y, age: -dt, hex: STRING[nt.s], wide: nt.f === 0 ? ax1 - ax0 : laneW(nt.f) * 0.6, id: nt.t * 100 + nt.s });
      strK[nt.s] = Math.max(strK[nt.s], Math.exp(-(-dt) / 0.18));
    }
    if (t >= nt.t && t <= end) strK[nt.s] = Math.max(strK[nt.s], 0.55);
  }
  for (; oi < OUTLINES.length; oi++) OUTLINES[oi].visible = false;
  for (let f = 0; f <= 24; f++) {
    if (postK[f] > 0.01) {
      fretMats[f].emissiveIntensity = postK[f] * (STYLE === 'studio' ? 0.9 : 1.3);
      postGlow[f].visible = STYLE !== 'studio';
      postGlow[f].material.opacity = 1;
      postGlow[f].material.color = lin('#ffffff', postK[f] * (STYLE === 'neon' ? 0.5 : 0.3));
    }
  }
  for (let s = 0; s < N; s++) {
    strings[s].material.emissiveIntensity = strings[s].userData.base * (1 + strK[s] * 2.2);
    stringGlow[s].material.color = lin(STRING[s], stringGlow[s].userData.base * (1 + strK[s] * 3));
  }
  // floor light/shadow under the nearest notes
  gemsNear.sort((a, b) => a.nt.t - b.nt.t);
  for (let i = 0; i < MAXG; i++) {
    const o = gemsNear[i];
    if (!o) {
      floorU.gems.value[i].set(0, 0, 999, 0);
      continue;
    }
    const dt = o.nt.t - t;
    const near = clamp01(1 - dt / 1.5);
    floorU.gems.value[i].set(o.x, o.y, -dt * ZS - DEPTH / 2, o.gem.userData.hw);
    const c = lin(STRING[o.nt.s], 0.35 + 1.4 * near * near);
    floorU.gemCol.value[i].set(c.r, c.g, c.b);
  }
  // sustains: brighter while held
  for (const s of sustains) {
    const held = t >= s.nt.t && t <= s.end;
    s.m.visible = s.end > t - 0.05 && s.nt.t < t + AHEAD + 0.3;
    const k = (STYLE === 'neon' ? 1.6 : STYLE === 'studio' ? 0.9 : 1.15) * (held ? 1.35 : 1);
    s.m.material.color = lin(STRING[s.nt.s], k);
  }

  // hit sparks, a flash and a ring where each note lands
  const posA = pGeo.attributes.position.array;
  const colA = pGeo.attributes.color.array;
  const sizeA = pGeo.attributes.size.array;
  let pi = 0;
  let fi = 0;
  for (const b of bursts) {
    seed = Math.floor((b.id || b.x * 1000) * 7919) % 2147483646 + 1;
    const n = b.small ? 14 : 46;
    const col = C(b.hex);
    for (let k = 0; k < n && pi < MAXP; k++) {
      const vx = (rand() - 0.5) * 3.2;
      const vy = 0.8 + rand() * 3.2;
      const vz = 0.6 + rand() * 2.4;
      const life = 0.25 + rand() * 0.45;
      const x0 = b.x + (rand() - 0.5) * b.wide;
      const a = b.age;
      if (a > life) continue;
      const fade = 1 - a / life;
      posA[pi * 3] = x0 + vx * a;
      posA[pi * 3 + 1] = b.y + vy * a - 4.5 * a * a;
      posA[pi * 3 + 2] = 0.05 + vz * a;
      const hot = Math.exp(-a / 0.08);
      const ck = (STYLE === 'studio' ? 2.0 : 4.0) * fade;
      colA[pi * 3] = (col.r + (1 - col.r) * hot) * ck;
      colA[pi * 3 + 1] = (col.g + (1 - col.g) * hot) * ck;
      colA[pi * 3 + 2] = (col.b + (1 - col.b) * hot) * ck;
      sizeA[pi] = (0.022 + rand() * 0.03) * (0.6 + 0.4 * fade);
      pi++;
    }
    if (fi < FLASHES.length && b.age < 0.35) {
      const fl = FLASHES[fi];
      const rg = RINGS[fi];
      fi++;
      const k = Math.exp(-b.age / 0.09);
      fl.visible = true;
      fl.position.set(b.x, b.y, 0.08);
      const sz = (b.small ? 0.5 : 0.8) * (0.4 + b.wide * 0.7) * (1 + b.age * 2.0);
      fl.scale.set(sz * 1.6, sz, 1);
      fl.material.color = lin(b.hex, (STYLE === 'studio' ? 0.6 : 1.3) * k).lerp(lin('#ffffff', 1.2 * k), 0.35);
      rg.visible = !b.small;
      rg.position.set(b.x, b.y, 0.07);
      // a thin horizontal light streak, like a lens catching the flash
      rg.scale.set(2.2 + b.age * 6, 0.05 + b.age * 0.05, 1);
      rg.material.color = lin(b.hex, 0.6).lerp(lin('#ffffff', 1), 0.5).multiplyScalar((STYLE === 'studio' ? 0.0 : 1.2) * Math.exp(-b.age / 0.1));
    }
  }
  for (let k = pi; k < MAXP; k++) sizeA[k] = 0;
  for (; fi < FLASHES.length; fi++) {
    FLASHES[fi].visible = false;
    RINGS[fi].visible = false;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
  pGeo.attributes.size.needsUpdate = true;
  pGeo.setDrawRange(0, pi);
  const pscale = (camera.projectionMatrix.elements[5] * RH) / 2;
  pMat.uniforms.scale.value = pscale;
  for (const d of dust) {
    d.m.material.uniforms.scale.value = pscale;
    const time = t - T0;
    d.base.forEach((b, i) => {
      d.pos[i * 3] = b[0] + Math.sin(time * 0.3 + b[3]) * 0.4;
      d.pos[i * 3 + 1] = b[1] + Math.sin(time * 0.5 + b[3] * 2) * 0.25;
      d.pos[i * 3 + 2] = b[2] + Math.cos(time * 0.2 + b[3]) * 0.4;
    });
    d.m.geometry.attributes.position.needsUpdate = true;
  }

  // labels face you; far ones fade
  for (const b of billboards) {
    b.quaternion.copy(camera.quaternion);
    if (!b.visible) continue;
    if (b.parent === neck) continue;
    b.getWorldPosition(tmpV);
    const ahead = -tmpV.z;
    b.material.opacity = clamp01((ZF * 0.75 - ahead) / (ZF * 0.25)) * clamp01(1 + (ahead + 0.2) / 0.3);
  }

  // where the far end of the highway is on screen (for the soft focus)
  tmpV.set(camX, 0, -ZF * 0.25).project(camera);
  const yFar = tmpV.y * 0.5 + 0.5;
  tmpV.set(camX, 0, -ZF * 0.08).project(camera);
  const yMidS = tmpV.y * 0.5 + 0.5;
  dof.uniforms.y0.value = yFar - 0.04;
  dof.uniforms.y1.value = yFar + 0.1;

  if (LK.floor.refl > 0) renderReflection();
  composer.render();
  finalMat.uniforms.src.value = composer.readBuffer.texture;
  renderer.setRenderTarget(null);
  renderer.render(finalScene, finalCam);
}

// --------------------------------------------------------------------------- start --
async function start() {
  try {
    const ff = new FontFace('Archivo', 'url(/app/fonts/Archivo-Variable.ttf)', { weight: '100 900' });
    await ff.load();
    document.fonts.add(ff);
  } catch (e) {
    console.warn('font', e);
  }
  const chartUrl = Q.get('chart');
  CHART = chartUrl ? await (await fetch(chartUrl)).json() : demoChart();
  T0 = Number(Q.get('t0') || 0);
  buildChart();
  window.renderAt = (t) => {
    frame(T0 + t);
    return true;
  };
  window.__ready = true;
}
start();
