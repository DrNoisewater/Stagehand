/**
 * 4.16: the guitar highway in the headset (step 2). Drawn here with three.js (the same library the
 * PC's highway uses), at the headset's frame rate, from the notes the PC sent once and its clock.
 * Hits and misses come from the PC's judge. Works three ways: in VR (the venue all around you),
 * in passthrough (your room, the highway floating in front of you), or flat in the page (a preview).
 *
 * World units are metres. The 'local' space starts at your head when VR starts: you sit, the
 * neck lies in front of you a little below your eyes, the notes come at you from the distance.
 */
import * as THREE from '/three/three.module.min.js';
import { nearTargets, anchorAt, beatsBetween, level, sectionAt, FLAG } from './chart.js';
import { KEY, loadPlace, nudge, nudgeGuitar, resetHighway, resetGuitar, highwayPoint } from './place.js';
import { menuModel, layout as menuLayout, hit as menuHit, sortSongs, jumpTo, clampTop, ROWS, W as MW, H as MH } from './menu.js';
import { JOINTS as JOINT_NAMES, INDEX_TIP, MIDDLE_TIP, palmToward, pinching } from './handpose.js';
import { createHandsView, controllerShape } from './hands.js';
import { createGuitarOutline } from './guitar.js';

const STRING = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff']; // the PC's string colours
const FRET_W = 0.085; // metres per fret across
const STR_H = 0.042; // between strings, up and down at the neck
const SPEED = 2.4; // metres per second of song, towards you
const AHEAD = 4.2; // seconds of notes shown
const FRETS = 24;
const MAX = 640; // notes drawn at once (plenty: a busy part shows ~150)
const DEG = Math.PI / 180;
const RECENT = 'stagehand.vr.recent';
const MENU_W = 0.64; // the menu panel, metres (1024 × 768 pixels on it)
const MENU_H = 0.48;

const fretX = (f) => (f - 0.5) * FRET_W; // the middle of a fret's lane (fret 0, open, is left of fret 1)

function loadPrefs() {
  try {
    return loadPlace(localStorage.getItem(KEY));
  } catch (_) {
    return loadPlace(null);
  }
}

/** A texture with text on it (fret numbers, chord names, the score). */
function textCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { c, g: c.getContext('2d'), t };
}

/** Fret numbers 0–24 (and X for a muted note) in one picture; a note shows its number by picking its cell. */
function drawDigits(c) {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 44px Archivo, system-ui, sans-serif';
  g.lineJoin = 'round';
  for (let i = 0; i <= 25; i++) {
    const x = (i + 0.5) * (c.width / 32);
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,.85)';
    const s = i === 25 ? 'X' : String(i);
    g.strokeText(s, x, 34);
    g.fillStyle = '#fff';
    g.fillText(s, x, 34);
  }
}
function digitAtlas() {
  const { c, t } = textCanvas(2048, 64);
  drawDigits(c);
  // no smaller copies: they'd mix the clear edges in and darken the numbers seen at an angle
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const PART_GEL = { lead: '#ff6b3d', combo: '#ff6b3d', rhythm: '#ff6b3d', bass: '#8c7bff', vocals: '#33c8e0' }; // the page's own colours
const PART_TAG = { lead: 'LEAD', combo: 'LEAD', rhythm: 'RHY', bass: 'BASS', vocals: 'VOX' };
/** Paints the menu's buttons on its picture (only when something on it changed). */
function paintMenu({ g, c, t }, buttons, hoverId) {
  const F = 'Archivo, system-ui, sans-serif';
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(17,19,22,.95)';
  g.strokeStyle = 'rgba(255,181,71,.55)';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(3, 3, c.width - 6, c.height - 6, 30);
  g.fill();
  g.stroke();
  const box = (b, fill, r = 18) => {
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, r);
    g.fill();
  };
  for (const b of buttons) {
    const hov = hoverId === b.id && !b.off;
    g.globalAlpha = b.off ? 0.32 : 1;
    g.textBaseline = 'middle';
    if (b.kind === 'tab') {
      box(b, b.on ? '#ffb547' : hov ? '#3a4249' : '#24292d');
      g.fillStyle = b.on ? '#2a1c05' : '#eceef6';
      g.font = `800 36px ${F}`;
      g.textAlign = 'center';
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2, b.w - 16);
    } else if (b.kind === 'btn' || b.kind === 'primary') {
      const prim = b.kind === 'primary';
      box(b, prim ? (b.warn ? (hov ? '#f07a6c' : '#d9574a') : hov ? '#ffc978' : '#ffb547') : b.on ? (hov ? '#2a6370' : '#1f505b') : hov ? '#3a4249' : '#2c3135');
      if (b.on && !prim) {
        g.strokeStyle = '#5fe3ff';
        g.lineWidth = 4;
        g.beginPath();
        g.roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 16);
        g.stroke();
      }
      g.textAlign = 'center';
      g.fillStyle = prim ? '#21170a' : '#eceef6';
      const big = b.label.length <= 1 ? 54 : prim ? 40 : 32;
      g.font = `${prim ? 800 : 700} ${big}px ${F}`;
      const ty = b.sub ? b.y + b.h / 2 - 14 : b.y + b.h / 2 + 2;
      g.fillText(b.label, b.x + b.w / 2, ty, b.w - 20);
      if (b.sub) {
        g.font = `500 24px ${F}`;
        g.fillStyle = prim ? 'rgba(33,23,10,.75)' : '#9fb0b8';
        g.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 24, b.w - 20);
      }
    } else if (b.kind === 'row') {
      box(b, b.on ? '#2a3238' : hov ? '#30373d' : '#1e2226', 16);
      if (b.on) {
        g.fillStyle = '#ffb547';
        g.fillRect(b.x, b.y + 12, 8, b.h - 24);
      }
      g.textAlign = 'left';
      g.fillStyle = '#eceef6';
      g.font = `700 36px ${F}`;
      const chipsW = (b.parts || []).filter((p) => PART_TAG[p]).length * 92;
      g.fillText(b.label, b.x + 28, b.y + 36, b.w - 56 - chipsW);
      g.fillStyle = '#97a3aa';
      g.font = `500 26px ${F}`;
      g.fillText(b.sub || '', b.x + 28, b.y + 76, b.w - 56 - chipsW);
      let x = b.x + b.w - 20;
      const seen = new Set();
      for (const p of [...(b.parts || [])].reverse()) {
        const tag = PART_TAG[p];
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        x -= 84;
        g.fillStyle = PART_GEL[p];
        g.beginPath();
        g.roundRect(x, b.y + b.h / 2 - 20, 76, 40, 10);
        g.fill();
        g.fillStyle = '#111';
        g.font = `800 22px ${F}`;
        g.textAlign = 'center';
        g.fillText(tag, x + 38, b.y + b.h / 2 + 1);
        g.textAlign = 'left';
        x -= 8;
      }
    } else if (b.kind === 'label') {
      g.textAlign = b.right ? 'right' : 'left';
      const x = b.right ? b.x + b.w - 8 : b.x + 8;
      g.fillStyle = '#eceef6';
      g.font = `${b.big ? 800 : 700} ${b.big ? 42 : 32}px ${F}`;
      g.fillText(b.label, x, b.sub ? b.y + b.h / 2 - 16 : b.y + b.h / 2, b.w - 16);
      if (b.sub) {
        g.fillStyle = '#97a3aa';
        g.font = `500 ${b.big ? 28 : 24}px ${F}`;
        g.fillText(b.sub, x, b.y + b.h / 2 + 22, b.w - 16);
      }
    } else if (b.kind === 'value') {
      g.textAlign = 'center';
      g.fillStyle = '#ffc35a';
      g.font = `800 38px ${F}`;
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2, b.w - 8);
    } else if (b.kind === 'bar') {
      const y = b.y + b.h / 2;
      g.fillStyle = hov ? '#3a4249' : '#2c3135';
      g.beginPath();
      g.roundRect(b.x, y - 9, b.w, 18, 9);
      g.fill();
      g.fillStyle = '#ffb547';
      g.beginPath();
      g.roundRect(b.x, y - 9, Math.max(18, b.w * (b.value || 0)), 18, 9);
      g.fill();
      g.fillStyle = '#eceef6';
      g.beginPath();
      g.arc(b.x + Math.max(9, b.w * (b.value || 0)), y, 20, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  g.textBaseline = 'alphabetic';
  t.needsUpdate = true;
}

export function createStage({ canvas, getState, getChart, getSongs = () => [], getParts = () => null, arOk = () => false, marks, pcNow, send, onExit }) {
  const prefs = loadPrefs();
  const savePrefs = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch (_) {}
  };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  renderer.xr.setFoveation(0.4); // a little saving at the edges, the middle stays sharp
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05070c, 6, 13);
  const camera = new THREE.PerspectiveCamera(72, 1, 0.02, 60); // the flat preview's view (the headset sets its own)
  camera.position.set(0, 0, 0);
  camera.lookAt(0, -0.22, -1.6);

  // ------------------------------------------------------------ the venue --
  const venue = new THREE.Group();
  scene.add(venue);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { pulse: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float pulse; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 top = vec3(0.02,0.025,0.05); vec3 mid = vec3(0.09,0.06,0.12) * (1.0 + pulse*0.6); gl_FragColor = vec4(mix(mid, top, smoothstep(-0.1, 0.6, h)), 1.0); }',
    })
  );
  venue.add(sky);
  // stars for the moving-background venues (they're drawn flat on the PC; here they're all around you)
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(1800 * 3);
  for (let i = 0; i < 1800; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = 18 + Math.random() * 8;
    const k = Math.sqrt(1 - u * u);
    sp[i * 3] = Math.cos(a) * k * r;
    sp[i * 3 + 1] = Math.abs(u) * r * 0.9 - 2;
    sp[i * 3 + 2] = Math.sin(a) * k * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd4ff, size: 0.06, transparent: true, opacity: 0.8, fog: false }));
  venue.add(stars);
  // a photo venue: a big curved screen in front of you, like standing on that stage
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x8c8c8c, side: THREE.BackSide, fog: false, transparent: true, opacity: 0 });
  const screen = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 20, 64, 1, true, Math.PI - 1.3, 2.6), screenMat);
  screen.position.set(0, 1.4, 0);
  venue.add(screen);
  // the floor under you: dark close by, fading out so the picture's own floor shows beyond
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(16, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vP; void main(){ float r = length(vP); gl_FragColor = vec4(0.03, 0.035, 0.05, 0.95 * (1.0 - smoothstep(2.5, 7.0, r))); }',
    })
  );
  floor.rotation.x = -Math.PI / 2;
  // the room is drawn before the highway (see-through things are otherwise drawn nearest last, and this floor
  // right under you would cover the highway)
  for (const m of [sky, stars, screen, floor]) m.renderOrder = -10;
  floor.position.y = -1.25;
  venue.add(floor);
  let venueName = null;
  const loader = new THREE.TextureLoader();
  function setVenue(name) {
    if (name === venueName) return;
    venueName = name;
    const photo = { 'studio-room': 'studio' }[name] || name;
    const photos = ['soundcheck', 'warehouse', 'jazz', 'cellar', 'opera', 'studio', 'rooftop', 'festival', 'canyon', 'astral'];
    screenMat.opacity = 0;
    stars.visible = !photos.includes(photo);
    if (!photos.includes(photo)) return;
    // the picture's horizon (where its floor meets the far wall) a little below your eyes
    const HORIZON = { soundcheck: 0.45, warehouse: 0.49, jazz: 0.45, cellar: 0.45, opera: 0.53, studio: 0.32, rooftop: 0.37, festival: 0.45, canyon: 0.5, astral: 0.32 };
    screen.position.y = -10.15 + (HORIZON[photo] || 0.45) * 20;
    loader.load(`/venues/${photo}.jpg`, (tex) => {
      if (venueName !== name) return;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.repeat.x = -1; // seen from inside the curve: turned the right way round
      tex.offset.x = 1;
      tex.anisotropy = 8;
      if (screenMat.map) screenMat.map.dispose();
      screenMat.map = tex;
      screenMat.opacity = 1;
      screenMat.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------- the highway --
  // Made to look like the PC's 3D highway: a dark floor with a faint fret grid fading into the
  // distance, the hand's frets as a lit lane with bright edges, metal fret posts and the strings
  // where you play, gold numbers under the hand's frets, glowing gems with their numbers on them.
  // everything placed around you hangs off `base` (its origin: your eyes when VR started, or where
  // "Put it in front of me" was pressed)
  const base = new THREE.Group();
  scene.add(base);
  const hw = new THREE.Group(); // low in front of you, sloping away (height, distance, tilt and size are yours to set)
  base.add(hw);
  const neck = new THREE.Group(); // slides left and right to follow your hand on the neck
  hw.add(neck);
  const nStr = () => (getChart() && getChart().strings) || 6;
  const yOf = (s) => level(getChart(), s) * STR_H + 0.03;
  const LEN = AHEAD * SPEED;
  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x1a1a24, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.3, 2, 1.5);
  scene.add(sun);

  // the floor: a faint grid of fret lines and beat rows, fading into the distance
  const floorMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { fw: { value: FRET_W }, len: { value: LEN } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float fw; uniform float len; varying vec3 vP;
      void main(){
        float far = clamp((vP.y + len * 0.5) / len, 0.0, 1.0);
        float gx = abs(fract(vP.x / fw + 0.5) - 0.5) * fw;
        float line = 1.0 - smoothstep(0.0, fwidth(vP.x) * 1.5 + 0.0008, 0.5 * fw - gx);
        float a = (0.6 + line * 0.18) * (1.0 - far * far);
        vec3 base = vec3(0.035, 0.05, 0.07);
        vec3 c = mix(base, vec3(0.12, 0.3, 0.36), line * 0.45);
        gl_FragColor = vec4(c, a * 0.9);
      }`,
  });
  const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry((FRETS + 6) * FRET_W, LEN), floorMat);
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.set(fretX(FRETS / 2), 0, -LEN / 2);
  neck.add(floorPlane);
  // the hand's frets: a lit lane running into the distance, bright cyan edges
  const laneMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { width: { value: 0.34 }, fw: { value: FRET_W }, len: { value: LEN }, pulse: { value: 0 } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float width; uniform float fw; uniform float len; uniform float pulse; varying vec2 vU;
      void main(){
        float x = vU.x * width;
        float edge = min(x, width - x);
        float rim = 1.0 - smoothstep(0.0025, 0.007, edge);
        float div = 1.0 - smoothstep(0.0, 0.0022, abs(fract(x / fw + 0.5) - 0.5) * fw);
        float far = vU.y;
        float fade = 1.0 - far * far;
        vec3 fill = vec3(0.07, 0.36, 0.46) * (1.0 + pulse * 0.35);
        vec3 c = fill + vec3(0.25, 0.95, 1.0) * rim + vec3(0.2, 0.5, 0.6) * div * 0.6;
        float a = (0.5 + rim * 0.5 + div * 0.2) * fade;
        gl_FragColor = vec4(c, a);
      }`,
  });
  const hand = new THREE.Mesh(new THREE.PlaneGeometry(1, LEN), laneMat);
  hand.rotation.x = -Math.PI / 2;
  hand.position.set(0, 0.0015, -LEN / 2);
  neck.add(hand);
  const m4 = new THREE.Matrix4();
  // metal fret posts across the neck, where you play
  const postH = STR_H * 5 + 0.07;
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0042, 0.0042, postH, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), FRETS + 1);
  posts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((FRETS + 1) * 3).fill(1), 3);
  const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.22);
  for (let f = 0; f <= FRETS; f++) posts.setMatrixAt(f, m4.compose(new THREE.Vector3(f * FRET_W, postH / 2 - 0.005, 0.01), lean, new THREE.Vector3(1, 1, 1)));
  neck.add(posts);
  // inlay marks between the strings (3, 5, 7, 9, 12 …), as on a real neck
  const INLAY = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
  const inlays = new THREE.InstancedMesh(new THREE.PlaneGeometry(FRET_W * 0.62, STR_H * 2.6), new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.16, depthWrite: false }), INLAY.length);
  INLAY.forEach((f, i) => inlays.setMatrixAt(i, m4.makeTranslation(fretX(f), STR_H * 2.5 + 0.03, -0.004)));
  neck.add(inlays);
  // the strings: a bright core and a soft glow behind
  const glowTex = (() => {
    const { c, g, t } = textCanvas(16, 64);
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
    t.needsUpdate = true;
    return t;
  })();
  const strings = [];
  const strW = (FRETS + 1) * FRET_W;
  for (let s = 0; s < 6; s++) {
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, strW, 8).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(STRING[s]).lerp(new THREE.Color(1, 1, 1), 0.15) }));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(strW, 0.026), new THREE.MeshBasicMaterial({ color: STRING[s], map: glowTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.z = -0.003;
    core.add(glow);
    core.position.set(fretX(FRETS / 2) - FRET_W / 2, 0, 0);
    neck.add(core);
    strings.push(core);
  }
  // fret numbers under the neck: gold under your hand, dim elsewhere
  const digits = digitAtlas();
  if (document.fonts) document.fonts.load('800 44px Archivo').then(() => drawDigits(digits.image)).then(() => (digits.needsUpdate = true)).catch(() => {});
  const numMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { map: { value: digits } },
    vertexShader: 'attribute float cell; attribute vec3 tint; varying vec2 vUv; varying vec3 vT; void main(){ vUv = vec2((cell + uv.x) / 32.0, uv.y); vT = tint; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying vec3 vT; void main(){ vec4 c = texture2D(map, vUv); if (c.a < 0.04) discard; gl_FragColor = vec4(c.rgb * vT, c.a); }',
  });
  const numbers = (count, size) => {
    const g = new THREE.PlaneGeometry(size * 2, size * 2);
    const mesh = new THREE.InstancedMesh(g, numMat, count);
    g.setAttribute('cell', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    g.setAttribute('tint', new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3));
    mesh.frustumCulled = false;
    return mesh;
  };
  const edge = numbers(FRETS + 1, 0.036);
  for (let f = 0; f <= FRETS; f++) edge.geometry.attributes.cell.array[f] = f;
  neck.add(edge);

  // the notes: rounded, lit gems with a glow, their fret numbers, held-note tails, beat lines
  const gemShape = new THREE.Shape();
  {
    const w = FRET_W * 0.74;
    const h = 0.03;
    const r = 0.009;
    gemShape.moveTo(-w / 2 + r, -h / 2);
    gemShape.lineTo(w / 2 - r, -h / 2);
    gemShape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    gemShape.lineTo(w / 2, h / 2 - r);
    gemShape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    gemShape.lineTo(-w / 2 + r, h / 2);
    gemShape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    gemShape.lineTo(-w / 2, -h / 2 + r);
    gemShape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  }
  const gemGeo = new THREE.ExtrudeGeometry(gemShape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 3, curveSegments: 4 }).translate(0, 0, -0.007);
  const gemMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.15 });
  // the gem's own colour also glows a little, so it reads in a dark venue
  gemMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor.rgb * 0.42;\n#endif');
  };
  const gems = new THREE.InstancedMesh(gemGeo, gemMat, MAX);
  gems.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  gems.frustumCulled = false;
  neck.add(gems);
  const haloTex = (() => {
    const { c, g, t } = textCanvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
    t.needsUpdate = true;
    return t;
  })();
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(FRET_W * 1.7, 0.09), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), MAX);
  halos.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  halos.frustumCulled = false;
  neck.add(halos);
  // a faint line from each gem down to the floor, so you can tell how far off it is
  const drops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.003, 1, 0.003), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }), MAX);
  drops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  drops.frustumCulled = false;
  neck.add(drops);
  const gemNums = numbers(MAX, 0.022);
  neck.add(gemNums);
  const tails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }), MAX);
  tails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  tails.frustumCulled = false;
  neck.add(tails);
  const beatsMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.002, 1), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.32, depthWrite: false }), 96);
  beatsMesh.frustumCulled = false;
  neck.add(beatsMesh);
  // sparks on a hit: soft flashes that rise and fade
  const sparks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshBasicMaterial({ map: haloTex, color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }), 64);
  sparks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
  sparks.frustumCulled = false;
  neck.add(sparks);
  const flashes = [];
  // chord names, a few made as needed
  const chordLabels = [];
  const chordTex = new Map();
  function chordTexture(name) {
    let t = chordTex.get(name);
    if (t) return t;
    const { g, t: tex } = textCanvas(256, 64);
    g.font = '800 40px Archivo, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(0,0,0,.8)';
    g.strokeText(name, 128, 34);
    g.fillStyle = '#ffe2a8';
    g.fillText(name, 128, 34);
    tex.needsUpdate = true;
    chordTex.set(name, tex);
    return tex;
  }
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    m.visible = false;
    neck.add(m);
    chordLabels.push(m);
  }

  // ------------------------------------------------------------ the score --
  const hud = textCanvas(1024, 192);
  const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.225), new THREE.MeshBasicMaterial({ map: hud.t, transparent: true, depthWrite: false, fog: false }));
  base.add(hudMesh);
  let hudSig = '';
  function drawHud(now) {
    const st = getState();
    const ch = getChart();
    const sc = marks.score;
    const acc = sc && sc.judged ? `${Math.round((sc.hits / sc.judged) * 100)}%` : '–';
    const sec = sectionAt(ch, now);
    const tm = `${Math.floor(now / 60)}:${String(Math.floor(now % 60)).padStart(2, '0')}`;
    const sig = `${st && st.song && st.song.id}|${acc}|${sc && sc.streak}|${sec}|${tm}|${!!ch}`;
    if (sig === hudSig) return;
    hudSig = sig;
    const { g, c, t } = hud;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(10,12,16,.6)';
    g.beginPath();
    g.roundRect(0, 0, c.width, c.height, 30);
    g.fill();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#eceef6';
    g.font = '800 46px Archivo, system-ui, sans-serif';
    g.fillText(st && st.song ? st.song.title : 'Pick a song', 34, 62, 620);
    g.fillStyle = '#97a3aa';
    g.font = '500 30px Archivo, system-ui, sans-serif';
    g.fillText([st && st.song && st.song.artist, sec, tm].filter(Boolean).join('  ·  '), 34, 132, 620);
    g.textAlign = 'right';
    g.fillStyle = '#ffb547';
    g.font = '800 64px Archivo, system-ui, sans-serif';
    g.fillText(acc, 990, 70);
    g.fillStyle = '#aae6ff';
    g.font = '700 30px Archivo, system-ui, sans-serif';
    g.fillText(sc ? `${sc.streak} in a row` : ch ? 'no guitar heard' : 'notes coming from the PC…', 990, 140);
    t.needsUpdate = true;
  }

  // ------------------------------------------------- the guitar outline --
  const guitar = createGuitarOutline({ colors: STRING });
  base.add(guitar.root);
  const nowNotes = Array.from({ length: 12 }, () => [0, 0, 0]);

  // ------------------------------------------------------------ the menu --
  // One panel with four pages; it opens in front of you, a little below your eyes, within reach.
  const menuTex = textCanvas(MW, MH);
  menuTex.t.generateMipmaps = false;
  menuTex.t.minFilter = THREE.LinearFilter;
  const menuMesh = new THREE.Mesh(new THREE.PlaneGeometry(MENU_W, MENU_H), new THREE.MeshBasicMaterial({ map: menuTex.t, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  menuMesh.renderOrder = 20; // always over the highway
  menuMesh.visible = false;
  scene.add(menuMesh);
  const mm = menuModel();
  let leaveUntil = 0; // Leave VR pressed once: a second press leaves
  let menuOpen = false;
  let hoverId = null;
  let menuSig = '';
  let buttons = [];
  let recent = {};
  try {
    recent = JSON.parse(localStorage.getItem(RECENT) || '{}') || {};
  } catch (_) {}
  let sortedFor = null;
  let sorted = [];
  const songList = () => {
    const songs = getSongs() || [];
    const key = `${mm.sort}|${songs.length}`;
    if (sortedFor !== songs || sorted.key !== key) {
      sortedFor = songs;
      sorted = sortSongs(songs, mm.sort, recent);
      sorted.key = key;
    }
    return sorted;
  };
  // a small "Menu" button that floats by the highway while the song is stopped
  const pillTex = textCanvas(256, 96);
  {
    const { g, t } = pillTex;
    g.fillStyle = 'rgba(19,21,23,.92)';
    g.strokeStyle = 'rgba(255,181,71,.8)';
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(4, 4, 248, 88, 44);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffb547';
    for (let i = 0; i < 3; i++) g.fillRect(40, 30 + i * 15, 40, 6);
    g.font = '800 44px Archivo, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#eceef6';
    g.fillText('Menu', 98, 50);
    t.needsUpdate = true;
  }
  const pill = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), new THREE.MeshBasicMaterial({ map: pillTex.t, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  pill.renderOrder = 19;
  base.add(pill);
  // the same, small, over your wrist when you turn your palm to look at it
  const wristBtn = new THREE.Mesh(new THREE.CircleGeometry(0.024, 32), new THREE.MeshBasicMaterial({ map: (() => {
    const { g, t } = textCanvas(128, 128);
    g.fillStyle = 'rgba(19,21,23,.95)';
    g.beginPath();
    g.arc(64, 64, 60, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffb547';
    g.lineWidth = 7;
    g.stroke();
    g.fillStyle = '#ffb547';
    for (let i = 0; i < 3; i++) g.fillRect(36, 40 + i * 20, 56, 9);
    t.needsUpdate = true;
    return t;
  })(), transparent: true, depthTest: false, depthWrite: false }));
  wristBtn.renderOrder = 21;
  wristBtn.visible = false;
  scene.add(wristBtn);

  const fmtT = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
  let matchUntil = 0; // "line it up with my hand": when the hand is read
  function menuCtx() {
    const st = getState();
    const ch = getChart();
    const songId = st && st.song ? st.song.id : null;
    const parts = getParts();
    return {
      list: songList(),
      songId,
      title: st && st.song ? st.song.title : '',
      artist: st && st.song ? st.song.artist : '',
      playing: !!(st && st.playing),
      pos: rawNow(),
      len: st && st.song ? st.song.length : 0,
      parts: parts && parts.song === songId ? parts.list : [],
      partId: st && st.partId,
      speed: st && st.speed,
      phase: st && st.phase,
      aside: !!(ch && ch.aside),
      prefs,
      canPassthrough: canPass(),
      leaving: performance.now() < leaveUntil,
      passthrough,
      handsSeen: handsSeen(),
    };
  }
  function drawMenu() {
    const c = menuCtx();
    const left = matchUntil ? Math.ceil((matchUntil - performance.now()) / 1000) : 0;
    const sig = `${mm.tab}|${mm.sort}|${mm.top}|${mm.letters}|${mm.placeWhat}|${hoverId}|${c.songId}|${c.title}|${c.playing}|${Math.floor(c.pos)}|${c.len}|${c.partId}|${c.parts.map((p) => p.id).join(',')}|${c.speed}|${c.phase}|${c.aside}|${JSON.stringify(prefs)}|${c.canPassthrough}|${passthrough}|${c.handsSeen}|${c.list.length}|${left}|${c.leaving}`;
    if (sig === menuSig) return;
    menuSig = sig;
    buttons = menuLayout(mm, c);
    if (left > 0) {
      const b = buttons.find((x) => x.id === 'match');
      if (b) Object.assign(b, { label: `Hold still… ${left}`, sub: 'fretting hand on the 5th fret', off: false });
    }
    paintMenu(menuTex, buttons, hoverId);
  }
  function openMenu(tab) {
    if (tab) mm.tab = tab;
    menuOpen = true;
    // in front of you, where you look (but never above your eyes, nor down in your lap), turned to face you
    const cam = viewCam();
    cam.getWorldPosition(headP);
    cam.getWorldDirection(fwd);
    const down = Math.min(32, Math.max(10, (-Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180) / Math.PI)) * DEG;
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const far = renderer.xr.isPresenting ? 0.5 : 0.62;
    menuMesh.position.copy(headP).addScaledVector(fwd, far * Math.cos(down));
    menuMesh.position.y -= far * Math.sin(down);
    menuMesh.lookAt(headP);
    menuMesh.visible = true;
    menuSig = '';
  }
  function closeMenu() {
    menuOpen = false;
    menuMesh.visible = false;
    mm.letters = false;
    hoverId = null;
  }
  let toggledAt = 0;
  function toggleMenu() {
    const t = performance.now();
    if (t - toggledAt < 400) return; // one gesture, one toggle
    toggledAt = t;
    if (menuOpen) closeMenu();
    else openMenu();
  }

  /** Does what a menu button says. fx: where along the button it was pressed (0–1, for the song bar). */
  function act(id, fx = 0.5) {
    const st = getState();
    const i = id.indexOf(':');
    const k = i < 0 ? id : id.slice(0, i);
    const v = i < 0 ? '' : id.slice(i + 1);
    const pos = st ? songNow() : 0;
    const len = st && st.song ? st.song.length : 0;
    const speedTo = (s) => send({ type: 'speed', to: Math.round(Math.max(0.25, Math.min(1.5, s)) * 100) / 100 });
    if (k === 'tab') {
      mm.tab = v;
      mm.letters = false;
    } else if (k === 'close') closeMenu();
    else if (k === 'sort') {
      mm.sort = v;
      mm.top = 0;
      mm.letters = false;
    } else if (k === 'up') mm.top = clampTop(mm.top - ROWS, songList().length);
    else if (k === 'down') mm.top = clampTop(mm.top + ROWS, songList().length);
    else if (k === 'scroll') mm.top = clampTop(mm.top + Number(v), songList().length);
    else if (k === 'letters') mm.letters = !mm.letters;
    else if (k === 'letter') {
      const at = jumpTo(songList(), mm.sort, v);
      if (at >= 0) mm.top = clampTop(at, songList().length);
      mm.letters = false;
    } else if (k === 'song') {
      send({ type: 'pick', id: v });
      recent[v] = Date.now();
      try {
        localStorage.setItem(RECENT, JSON.stringify(recent));
      } catch (_) {}
      sortedFor = null;
      mm.tab = 'play'; // next: the part, then Play
    } else if (k === 'play') {
      const was = !!(st && st.playing);
      send({ type: 'toggle' });
      if (!was) closeMenu(); // the song starts: the menu steps out of the way
    } else if (k === 'restart') send({ type: 'restart' });
    else if (k === 'back10') send({ type: 'seek', t: Math.max(0, pos - 10) });
    else if (k === 'fwd10') send({ type: 'seek', t: pos + 10 });
    else if (k === 'bar') len && send({ type: 'seek', t: Math.max(0, Math.min(1, fx)) * len });
    else if (k === 'part') send({ type: 'part', id: v });
    else if (k === 'speed-') speedTo(((st && st.speed) || 1) - 0.05);
    else if (k === 'speed+') speedTo(((st && st.speed) || 1) + 0.05);
    else if (k === 'speed1') speedTo(1);
    else if (k === 'sooner') nudge(prefs, 'offset', -1);
    else if (k === 'later') nudge(prefs, 'offset', 1);
    else if (k === 'what') mm.placeWhat = v;
    else if (/^h:\w+[-+]$/.test(id)) nudge(prefs, id.slice(2, -1), id.endsWith('+') ? 1 : -1);
    else if (/^g:\w+[-+]$/.test(id)) {
      const key = id.slice(2, -1);
      let dir = id.endsWith('+') ? 1 : -1;
      if (key === 'z' || key === 'angle') dir = -dir; // Nearer is towards you; Flatter lays it down
      nudgeGuitar(prefs, key, dir);
    } else if (k === 'front') recenter();
    else if (k === 'resetHighway') {
      resetHighway(prefs);
      base.position.set(0, 0, 0);
      base.rotation.set(0, 0, 0);
    } else if (k === 'resetGuitar') resetGuitar(prefs);
    else if (k === 'match') matchUntil = performance.now() + 3000;
    else if (k === 'pass') setPassthrough(v === 'on');
    else if (k === 'guitar') prefs.guitar.on = v === 'on';
    else if (k === 'hands') prefs.hands = v;
    else if (k === 'exit') {
      // a second press within 4 s leaves, so a stray poke doesn't take the headset out of the song
      if (performance.now() < leaveUntil || fx === 'now') return api.exit();
      leaveUntil = performance.now() + 4000;
    }
    savePrefs();
    place();
    menuSig = '';
  }

  // the old menu's names (4.16), kept so nothing that pressed them breaks
  const OLD_IDS = { near: 'h:dist-', far: 'h:dist+', up: 'h:height+', down: 'h:height-', back: 'back10', fwd: 'fwd10' };

  function recenter() {
    const cam = viewCam();
    cam.getWorldPosition(headP);
    cam.getWorldDirection(fwd);
    base.position.copy(headP);
    base.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
  }

  function place() {
    hw.position.set(0, prefs.height, -prefs.dist);
    hw.rotation.x = -prefs.tilt * DEG; // the far end down: the whole highway faces your eyes
    hw.scale.setScalar(prefs.size);
    // the score: above the highway's far part, a little below straight ahead
    const far = highwayPoint(prefs, 3.6);
    hudMesh.position.set(0, far.y + 0.6, far.z);
    hudMesh.rotation.set(-Math.atan2(-(far.y + 0.6), -far.z), 0, 0);
    hudMesh.scale.setScalar(1.6);
    pill.position.set(-0.36 * prefs.size - 0.12, prefs.height + 0.16, -prefs.dist + 0.05);
    pill.lookAt(base.localToWorld(headP.set(0, 0, 0)));
    guitar.place(prefs.guitar);
  }

  // -------------------------------------------------- pointing and pressing --
  // Controllers or hands: a ray from each (pinch or trigger presses), and with hands a fingertip
  // that touches the panel presses too. While a song plays and the menu is closed, pinches do
  // nothing (holding a pick is a pinch).
  const ray = new THREE.Raycaster();
  const headP = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const tv = new THREE.Vector3();
  const tv2 = new THREE.Vector3();
  const targets = [];
  const handsView = createHandsView(scene);
  const handData = [0, 1].map(() => ({ pts: new Float32Array(75), radii: new Float32Array(25), on: false, side: 'left' }));
  let fake = null; // pretend hands (tests): [left points or null, right points or null]
  const pointers = [0, 1].map((i) => {
    const ctrl = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    const hand = renderer.xr.getHand(i);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.75 }));
    line.visible = false;
    ctrl.add(line);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd28a, depthTest: false }));
    dot.renderOrder = 22;
    dot.visible = false;
    scene.add(dot);
    const shape = controllerShape();
    grip.add(shape);
    const p = { i, ctrl, grip, hand, line, dot, shape, source: null, isHand: false, side: 'none', aim: null, buttons: [false, false], stickAt: 0, poked: false, pinch: false };
    ctrl.addEventListener('connected', (e) => {
      p.source = e.data;
      p.isHand = !!(e.data && e.data.hand);
      p.side = (e.data && e.data.handedness) || 'none';
    });
    ctrl.addEventListener('disconnected', () => {
      p.source = null;
      p.isHand = false;
    });
    ctrl.addEventListener('selectstart', () => {
      const a = aim(p);
      if (a) a.press();
    });
    scene.add(ctrl, grip, hand);
    return p;
  });
  const hitRes = { press: null, point: new THREE.Vector3(), dist: 0, id: null };
  /** What a pointer's ray is on: the menu's buttons, the Menu button, the wrist button (or null). */
  function aim(p) {
    tmpM.identity().extractRotation(p.ctrl.matrixWorld);
    ray.ray.origin.setFromMatrixPosition(p.ctrl.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
    return aimRay();
  }
  function aimRay() {
    targets.length = 0;
    if (menuMesh.visible) targets.push(menuMesh);
    if (pill.visible) targets.push(pill);
    if (wristBtn.visible) targets.push(wristBtn);
    if (!targets.length) return null;
    const h = ray.intersectObjects(targets, false)[0];
    if (!h) return null;
    hitRes.point.copy(h.point);
    hitRes.dist = h.distance;
    if (h.object === menuMesh) {
      const b = menuHit(buttons, h.uv.x * MW, (1 - h.uv.y) * MH);
      hitRes.id = b ? b.id : null;
      const fx = b ? (h.uv.x * MW - b.x) / b.w : 0;
      hitRes.press = b ? () => act(b.id, fx) : () => {};
    } else {
      hitRes.id = '#menu';
      hitRes.press = toggleMenu;
    }
    return hitRes;
  }
  /** A fingertip touching the panel presses what's under it (once, until the finger comes away). */
  function poke(p, tip) {
    if (!menuMesh.visible) return null;
    tv.set(tip[0], tip[1], tip[2]);
    menuMesh.worldToLocal(tv);
    if (Math.abs(tv.x) > MENU_W / 2 || Math.abs(tv.y) > MENU_H / 2) {
      p.poked = false;
      return null;
    }
    const x = (tv.x / MENU_W + 0.5) * MW;
    const y = (0.5 - tv.y / MENU_H) * MH;
    const b = menuHit(buttons, x, y);
    if (tv.z > 0.035 || tv.z < -0.06) p.poked = false;
    else if (tv.z < 0.012 && !p.poked) {
      p.poked = true;
      if (b) act(b.id, (x - b.x) / b.w);
    }
    return tv.z < 0.08 && b ? b.id : null;
  }
  // the flat preview: the mouse presses the same buttons
  const mouse = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const a = aimRay();
    if (a) a.press();
  });
  canvas.addEventListener('wheel', (e) => {
    if (menuOpen && mm.tab === 'songs' && !mm.letters) act(`scroll:${e.deltaY > 0 ? 1 : -1}`);
  }, { passive: true });

  const handsSeen = () => handData[0].on || handData[1].on;
  /** Reads the tracked hands (or the pretend ones) into handData. */
  function readHands() {
    for (let i = 0; i < 2; i++) {
      const d = handData[i];
      d.on = false;
      if (fake) {
        const pts = fake[i];
        if (pts) {
          d.pts.set(pts);
          d.radii.fill(0);
          d.on = true;
          d.side = i === 0 ? 'left' : 'right';
        }
        continue;
      }
      const p = pointers[i];
      if (!p.isHand || !p.hand.joints) continue;
      const w = p.hand.joints.wrist;
      if (!w || !w.visible) continue;
      let j = 0;
      let ok = true;
      for (const name of JOINT_NAMES) {
        const jt = p.hand.joints[name];
        if (!jt) {
          ok = false;
          break;
        }
        d.pts[j * 3] = jt.position.x;
        d.pts[j * 3 + 1] = jt.position.y;
        d.pts[j * 3 + 2] = jt.position.z;
        d.radii[j] = jt.jointRadius || 0;
        j++;
      }
      if (!ok) continue;
      d.on = true;
      d.side = p.side === 'right' ? 'right' : 'left';
    }
  }
  const tip = [0, 0, 0];
  const eye = [0, 0, 0];
  let wristTouch = false;
  /** Pointers, fingertips, the wrist button and controller buttons, once a frame. */
  function pointing(wall, playing) {
    readHands();
    const cam = viewCam();
    cam.getWorldPosition(headP);
    eye[0] = headP.x;
    eye[1] = headP.y;
    eye[2] = headP.z;
    // the wrist button: over a hand whose palm you turn to look at (raised, not down on the guitar)
    let wrist = -1;
    for (let i = 0; i < 2; i++) {
      const d = handData[i];
      if (d.on && d.pts[1] - headP.y > -0.42 && palmToward(d.pts, d.side, eye) > 0.6) wrist = i;
    }
    wristBtn.visible = wrist >= 0;
    if (wrist >= 0) {
      const d = handData[wrist].pts;
      // just above the wrist, towards your eyes
      tv.set(d[0], d[1], d[2]);
      tv2.set(eye[0], eye[1], eye[2]).sub(tv).normalize();
      wristBtn.position.copy(tv).addScaledVector(tv2, 0.045);
      wristBtn.lookAt(headP);
      // the other hand's fingertip on it, or this hand pinching, opens or closes the menu
      const o = handData[1 - wrist];
      if (o.on) {
        const dx = o.pts[INDEX_TIP * 3] - wristBtn.position.x;
        const dy = o.pts[INDEX_TIP * 3 + 1] - wristBtn.position.y;
        const dz = o.pts[INDEX_TIP * 3 + 2] - wristBtn.position.z;
        const touch = Math.hypot(dx, dy, dz) < 0.028;
        if (touch && !wristTouch) toggleMenu();
        wristTouch = touch;
      }
      const pin = pinching(handData[wrist].pts, pointers[wrist].pinch);
      if (pin && !pointers[wrist].pinch) toggleMenu();
      pointers[wrist].pinch = pin;
    }
    // "line it up with my hand": after the count, the fretting hand's fingertips are the 5th fret
    if (matchUntil && wall >= matchUntil) {
      matchUntil = 0;
      const d = handData[0].on && handData[0].side === 'left' ? handData[0] : handData[1].on && handData[1].side === 'left' ? handData[1] : handData[0].on ? handData[0] : handData[1];
      if (d.on) {
        tv.set((d.pts[INDEX_TIP * 3] + d.pts[MIDDLE_TIP * 3]) / 2, (d.pts[INDEX_TIP * 3 + 1] + d.pts[MIDDLE_TIP * 3 + 1]) / 2, (d.pts[INDEX_TIP * 3 + 2] + d.pts[MIDDLE_TIP * 3 + 2]) / 2);
        base.worldToLocal(tv);
        prefs.guitar.x = Math.round(tv.x * 1000) / 1000;
        prefs.guitar.y = Math.round(tv.y * 1000) / 1000;
        prefs.guitar.z = Math.round(tv.z * 1000) / 1000;
        savePrefs();
        place();
      }
      menuSig = '';
    }
    let hov = null;
    for (const p of pointers) {
      const live = renderer.xr.isPresenting && p.source;
      // the controller drawn when there's no hand
      p.shape.visible = !!(live && !p.isHand);
      let a = null;
      if (live && (menuOpen || !playing || !p.isHand)) a = aim(p);
      const d = handData[p.i];
      let poked = null;
      if (d.on && menuOpen) {
        tip[0] = d.pts[INDEX_TIP * 3];
        tip[1] = d.pts[INDEX_TIP * 3 + 1];
        tip[2] = d.pts[INDEX_TIP * 3 + 2];
        poked = poke(p, tip);
      }
      if (poked) hov = poked;
      else if (a && a.id && !hov) hov = a.id;
      // the ray shows only while there's something to point at
      const showRay = !!(live && a) || !!(live && menuOpen && !p.isHand);
      p.line.visible = showRay;
      p.line.scale.z = a ? a.dist : 1.2;
      p.dot.visible = !!(live && a);
      if (a) p.dot.position.copy(a.point);
      // controller buttons: A/B or X/Y open and close the menu; the stick scrolls the songs
      const gp = live && !p.isHand && p.source.gamepad;
      if (gp) {
        for (let b = 0; b < 2; b++) {
          const down = !!(gp.buttons[4 + b] && gp.buttons[4 + b].pressed);
          if (down && !p.buttons[b]) toggleMenu();
          p.buttons[b] = down;
        }
        const y = gp.axes[3] || 0;
        if (menuOpen && mm.tab === 'songs' && !mm.letters && Math.abs(y) > 0.6 && wall > p.stickAt) {
          act(`scroll:${y > 0 ? 1 : -1}`);
          p.stickAt = wall + 180;
        }
      }
    }
    if (hov !== hoverId) hoverId = hov;
  }
  place();

  // ------------------------------------------------------------ each frame --
  const col = new THREE.Color();
  const col2 = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  const grey = new THREE.Color(0.35, 0.37, 0.42);
  const q = new THREE.Quaternion();
  const numTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.55);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let neckX = null;
  let lastT = performance.now();
  const rawNow = () => {
    const st = getState();
    if (!st) return 0;
    if (!st.playing) return st.pos;
    return st.pos + ((pcNow() - st.at) / 1000) * (st.speed || 1);
  };
  // what's drawn runs on the headset's own frames and is nudged gently towards the PC's clock, so a
  // report that arrives a little early or late never makes the notes stutter; a real jump (a seek) snaps
  let shown = null;
  let shownAt = 0;
  const songNow = () => {
    const st = getState();
    const want = rawNow();
    const t = performance.now();
    if (shown == null || !st || !st.playing || Math.abs(want - shown) > 0.08) shown = want;
    else {
      shown += ((t - shownAt) / 1000) * (st.speed || 1);
      shown += (want - shown) * 0.12;
    }
    shownAt = t;
    return shown;
  };
  const stats = { frames: 0, total: 0, drawn: 0, last: 0, fps: 0 };
  const HAND_LEVEL = { bright: 0.8, dim: 0.38, faint: 0.16 };

  function frame() {
    const wall = performance.now();
    const dt = Math.min(0.1, (wall - lastT) / 1000);
    lastT = wall;
    const ch = getChart();
    const st = getState();
    const now = songNow() - (prefs.offset || 0) / 1000;
    const show = !!(ch && !ch.aside && st && st.song && st.song.id === ch.song);
    setVenue((ch && ch.venue) || 'warehouse');
    venue.visible = !passthrough;
    // follow the hand along the neck, smoothly
    const a = show ? anchorAt(ch, now + 0.4) : { fret: 1, width: 4 };
    const want = -(fretX(a.fret) + ((a.width - 1) * FRET_W) / 2);
    neckX = neckX == null ? want : neckX + (want - neckX) * Math.min(1, dt * 3);
    neck.position.x = neckX;
    hand.scale.x = a.width * FRET_W;
    hand.position.x = (a.fret - 1) * FRET_W + (a.width * FRET_W) / 2;
    laneMat.uniforms.width.value = a.width * FRET_W;
    const n = nStr();
    for (let s = 0; s < 6; s++) {
      strings[s].visible = s < n;
      strings[s].position.y = yOf(s);
    }
    for (let f = 0; f <= FRETS; f++) {
      const inHand = f >= a.fret && f < a.fret + a.width;
      // gold and bigger under your hand; dim teal elsewhere
      edge.setMatrixAt(f, m4.compose(v.set(fretX(f), 0.004, 0.115), numTilt, sc.setScalar(inHand ? 1.45 : 0.8)));
      edge.geometry.attributes.tint.array.set(inHand ? [1.25, 0.95, 0.42] : [0.28, 0.6, 0.68], f * 3);
      // the posts at the hand's two ends shine white
      const end = f === a.fret - 1 || f === a.fret + a.width - 1;
      posts.setColorAt(f, end ? col.setRGB(1, 1, 1) : inHand ? col.setRGB(0.62, 0.66, 0.72) : col.setRGB(0.4, 0.43, 0.48));
    }
    edge.instanceMatrix.needsUpdate = true;
    edge.geometry.attributes.tint.needsUpdate = true;
    posts.instanceColor.needsUpdate = true;
    // the beat: lines on the floor, and the sky breathes with it
    let pulse = 0;
    let bi = 0;
    if (show) {
      for (const b of beatsBetween(ch, now - 0.25, now + AHEAD)) {
        if (b.t < now) {
          pulse = Math.max(pulse, Math.exp(-(now - b.t) * 6) * (b.m >= 0 ? 1 : 0.6));
          continue; // a beat gone by: no line behind the strings
        }
        if (bi >= 96) break;
        const z = -(b.t - now) * SPEED;
        beatsMesh.setMatrixAt(bi++, m4.compose(v.set((a.fret - 1 + a.width / 2) * FRET_W, 0.003, z), q.identity(), sc.set(a.width * FRET_W, 1, b.m >= 0 ? 0.01 : 0.004)));
        if (b.t <= now) pulse = Math.max(pulse, Math.exp(-(now - b.t) * 6) * (b.m >= 0 ? 1 : 0.6));
      }
    }
    beatsMesh.count = bi;
    beatsMesh.instanceMatrix.needsUpdate = true;
    sky.material.uniforms.pulse.value = st && st.playing ? pulse : 0;
    laneMat.uniforms.pulse.value = st && st.playing ? pulse : 0;
    screenMat.color.setScalar(0.62 + (st && st.playing ? pulse * 0.14 : 0));
    // the notes
    let gi = 0;
    let ti = 0;
    let li = 0;
    const near = show ? nearTargets(ch, now, AHEAD, 0.4) : [];
    for (const x of near) {
      const r = marks.get(x.l && x.p != null ? x.p : x.i);
      const z = -(x.t - now) * SPEED;
      const past = x.t < now;
      for (const nn of x.n) {
        if (gi >= MAX) break;
        const [s, f, sus, fl] = nn;
        const hold = Math.max(sus || 0, x.d || 0);
        const y = yOf(s);
        col.set(STRING[s] || '#fff');
        if (r === 0) col.copy(grey);
        // a note already played: it sits on the strings while held, then goes
        if (!(past && !hold) && !x.l) {
          const open = f === 0;
          const zz = Math.min(0, z);
          const pop = r === 1 && past ? 1.25 : 1;
          const wide = open ? a.width * FRET_W : FRET_W * 0.74;
          const xx = open ? (a.fret - 1) * FRET_W + wide / 2 : fretX(f);
          const flat = fl & FLAG.mute ? 0.45 : 1;
          gems.setMatrixAt(gi, m4.compose(v.set(xx, y, zz), q.identity(), sc.set(open ? wide / (FRET_W * 0.74) : pop, (open ? 0.45 : pop) * flat, pop)));
          const c2 = r === 1 && past ? col2.copy(col).lerp(white, 0.35).multiplyScalar(1.15) : col;
          gems.setColorAt(gi, c2);
          // the glow grows as the note comes close; a line drops to the floor below it
          const close = Math.max(0, 1 - Math.abs(zz) / (SPEED * 1.2));
          halos.setMatrixAt(gi, m4.compose(v.set(xx, y, zz - 0.012), q.identity(), sc.set(open ? wide / (FRET_W * 1.2) : 1 + close * 0.5, 1 + close * 0.6, 1)));
          halos.setColorAt(gi, col2.copy(col).multiplyScalar(r === 0 ? 0.2 : 0.45 + close * 0.6));
          drops.setMatrixAt(gi, open || zz > -0.02 ? m4.makeScale(0, 0, 0) : m4.compose(v.set(xx, y / 2, zz), q.identity(), sc.set(1, y, 1)));
          drops.setColorAt(gi, col);
          if (!open && gi < MAX) {
            gemNums.setMatrixAt(gi, m4.compose(v.set(xx, y + 0.001, zz + 0.0125), q.identity(), sc.setScalar(0.62 * pop)));
            gemNums.geometry.attributes.cell.array[gi] = fl & FLAG.mute ? 25 : f;
            gemNums.geometry.attributes.tint.array.set(r === 0 ? [0.5, 0.5, 0.55] : [1, 1, 1], gi * 3);
          } else {
            gemNums.setMatrixAt(gi, m4.makeScale(0, 0, 0));
          }
          gi++;
        }
        if (hold > 0.05 && ti < MAX) {
          const end = -(x.t + hold - now) * SPEED;
          const start = Math.min(0, z);
          const len = start - end;
          if (len > 0.005) {
            const xx = f === 0 ? (a.fret - 1) * FRET_W + (a.width * FRET_W) / 2 : fretX(f);
            tails.setMatrixAt(ti, m4.compose(v.set(xx, y, (start + end) / 2), q.identity(), sc.set(f === 0 ? a.width * FRET_W * 0.9 : 0.014, 0.012, len)));
            tails.setColorAt(ti, col);
            ti++;
          }
        }
      }
      if (x.k === 'c' && x.c && !x.r && !past && li < chordLabels.length) {
        const m = chordLabels[li++];
        m.material.map = chordTexture(x.c);
        m.material.needsUpdate = true;
        const top = Math.max(...x.n.map(([s]) => yOf(s)));
        const fs = x.n.map((nn) => nn[1]).filter((f) => f > 0);
        const mid = fs.length ? (Math.min(...fs) + Math.max(...fs)) / 2 : a.fret + a.width / 2;
        m.position.set(fretX(mid), top + 0.075, z);
        m.visible = true;
      }
    }
    for (; li < chordLabels.length; li++) chordLabels[li].visible = false;
    gems.count = gi;
    gemNums.count = gi;
    halos.count = gi;
    drops.count = gi;
    halos.instanceMatrix.needsUpdate = true;
    halos.instanceColor.needsUpdate = true;
    drops.instanceMatrix.needsUpdate = true;
    drops.instanceColor.needsUpdate = true;
    tails.count = ti;
    gems.instanceMatrix.needsUpdate = true;
    if (gems.instanceColor) gems.instanceColor.needsUpdate = true;
    gemNums.instanceMatrix.needsUpdate = true;
    gemNums.geometry.attributes.cell.needsUpdate = true;
    gemNums.geometry.attributes.tint.needsUpdate = true;
    tails.instanceMatrix.needsUpdate = true;
    if (tails.instanceColor) tails.instanceColor.needsUpdate = true;
    // sparks for new hits
    while (marks.flashes.length) {
      const fl = marks.flashes.shift();
      const x = ch && ch.byId.get(fl.id);
      if (!x) continue;
      for (const [s, f] of x.n) for (let k = 0; k < 4; k++) flashes.push({ x: f === 0 ? (a.fret - 1 + a.width / 2) * FRET_W : fretX(f), y: yOf(s), s, born: wall, dx: (Math.random() - 0.5) * 0.25, dy: 0.15 + Math.random() * 0.25 });
    }
    let si = 0;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const p = flashes[i];
      const age = (wall - p.born) / 1000;
      if (age > 0.5 || si >= 64) {
        flashes.splice(i, 1);
        continue;
      }
      const k = 1 - age / 0.5;
      sparks.setMatrixAt(si, m4.compose(v.set(p.x + p.dx * age, p.y + p.dy * age, 0.01), q.identity(), sc.set(k, k, 1)));
      sparks.setColorAt(si, col.set(STRING[p.s] || '#fff').lerp(white, 0.5).multiplyScalar(k));
      si++;
    }
    sparks.count = si;
    sparks.instanceMatrix.needsUpdate = true;
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
    // the guitar outline (full VR only: in passthrough you see your own guitar)
    guitar.root.visible = !passthrough && prefs.guitar.on;
    if (guitar.root.visible) {
      let k = 0;
      for (const x of near) {
        const d = Math.abs(x.t - now);
        if (x.t - now > 0.3 || (d > 0.15 && x.t < now)) continue;
        const strength = 1 - Math.min(1, d / 0.3);
        for (const nn of x.n) {
          if (k >= 12) break;
          nowNotes[k][0] = nn[0];
          nowNotes[k][1] = nn[1];
          nowNotes[k][2] = strength;
          k++;
        }
      }
      guitar.update(n, a, nowNotes, k);
    }
    // the score, the menu, your hands (redrawn only when they change)
    drawHud(Math.max(0, now));
    const playing = !!(st && st.playing);
    if (playing && !wasPlaying && menuOpen) closeMenu(); // the song started: out of the way
    wasPlaying = playing;
    if (openSoon && renderer.xr.isPresenting && --openSoon.frames <= 0) {
      openMenu(openSoon.tab);
      openSoon = null;
    }
    pointing(wall, playing);
    if (menuOpen) drawMenu();
    pill.visible = !menuOpen && !playing;
    const bright = menuOpen || !playing || matchUntil;
    handsView.update(handData, bright ? 0.9 : HAND_LEVEL[prefs.hands] || 0.38, dt);
    renderer.render(scene, camera);
    stats.frames++;
    stats.total++;
    stats.drawn = gi;
    if (wall - stats.last > 1000) {
      stats.fps = Math.round((stats.frames * 1000) / (wall - stats.last || 1));
      stats.frames = 0;
      stats.last = wall;
    }
  }

  function resize() {
    if (renderer.xr.isPresenting) return;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let passthrough = false;
  let session = null;
  let sessionMode = null;
  let wasPlaying = false;
  let openSoon = null;
  const fog = scene.fog;
  /** The camera you see through: the headset's, or the flat preview's. */
  const viewCam = () => (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
  /** Your room can be shown: in a passthrough-capable session (or before one, if the browser can). */
  const canPass = () => (session ? sessionMode === 'immersive-ar' : !!arOk());
  function look() {
    renderer.setClearColor(0x000000, passthrough ? 0 : 1);
    scene.fog = passthrough ? null : fog;
  }
  function setPassthrough(on) {
    if (on && !canPass()) return;
    prefs.passthrough = !!on;
    passthrough = !!on && (!session || sessionMode === 'immersive-ar');
    look();
  }
  // the flat preview looks down the highway, as you would sitting with the guitar
  function previewLook(down = null, turn = 0) {
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    if (down == null) {
      const p = highwayPoint(prefs, 1.2);
      camera.lookAt(0, p.y, p.z);
    } else camera.rotation.set(-down * DEG, -turn * DEG, 0, 'YXZ');
  }
  previewLook();
  const api = {
    renderer,
    stats,
    prefs,
    /** Presses a menu button by its name (as the headset's menu does). */
    press: (id, fx) => act(OLD_IDS[id] || id, fx),
    menu: {
      open: (tab) => openMenu(tab),
      close: () => closeMenu(),
      toggle: () => toggleMenu(),
      get shown() {
        return menuOpen;
      },
      get model() {
        return mm;
      },
      buttons: () => (drawMenu(), buttons),
      /** Where a button is in the room (its middle), for tests. */
      pointOf(id) {
        drawMenu();
        const b = buttons.find((x) => x.id === id);
        if (!b) return null;
        menuMesh.updateMatrixWorld();
        const p = menuMesh.localToWorld(new THREE.Vector3(((b.x + b.w / 2) / MW - 0.5) * MENU_W, (0.5 - (b.y + b.h / 2) / MH) * MENU_H, 0));
        const n = new THREE.Vector3(0, 0, 1).transformDirection(menuMesh.matrixWorld);
        return { at: [p.x, p.y, p.z], facing: [n.x, n.y, n.z] };
      },
    },
    /** For tests: pretend hands (two arrays of 25 joints × xyz, or null) and where the flat preview looks. */
    fakeHands(h) {
      fake = h;
    },
    look: previewLook,
    /** For tests: put the highway somewhere (not remembered). */
    placeAt(o) {
      Object.assign(prefs, o);
      place();
    },
    /** For tests: the flat preview from somewhere else (e.g. the side, to see the heights). */
    view(from, at) {
      camera.position.set(from[0], from[1], from[2]);
      camera.lookAt(at[0], at[1], at[2]);
    },
    get guitar() {
      return guitar;
    },
    get passthrough() {
      return passthrough;
    },
    get handsOpacity() {
      return handsView.opacity;
    },
    /** 'vr' (the venue around you) or 'ar' (your room); resolves once the headset shows it. */
    async enter(mode = 'vr') {
      if (!navigator.xr) throw new Error('This browser has no VR');
      // a passthrough-capable session when the browser has one, so your room can be switched on and off
      // from the menu without leaving; the venue covers it while it's off
      const want = mode === 'ar' || (mode === 'vr' && arOk()) ? 'immersive-ar' : 'immersive-vr';
      const opts = { optionalFeatures: ['local-floor', 'hand-tracking'] };
      let s = null;
      try {
        s = await navigator.xr.requestSession(want, opts);
        sessionMode = want;
      } catch (e) {
        if (want !== 'immersive-ar' || mode === 'ar') throw e;
        s = await navigator.xr.requestSession('immersive-vr', opts);
        sessionMode = 'immersive-vr';
      }
      session = s;
      passthrough = mode === 'ar' && sessionMode === 'immersive-ar';
      prefs.passthrough = passthrough;
      look();
      session.addEventListener('end', () => {
        session = null;
        sessionMode = null;
        passthrough = false;
        closeMenu();
        base.position.set(0, 0, 0);
        base.rotation.set(0, 0, 0);
        look();
        resize();
        if (onExit) onExit();
      });
      await renderer.xr.setSession(session);
      // the menu, ready, unless the song is already playing (opened on the first frames, once the headset knows where you look)
      const st = getState();
      if (!(st && st.playing)) openSoon = { tab: st && st.song ? 'play' : 'songs', frames: 3 };
      // the smoothest the headset can do (Quest 3: 90 or 120 frames a second)
      try {
        const rates = session.supportedFrameRates ? [...session.supportedFrameRates] : [];
        const best = rates.filter((r) => r <= 120).sort((a, b) => b - a)[0];
        if (best && session.updateTargetFrameRate) await session.updateTargetFrameRate(best);
      } catch (_) {}
    },
    exit() {
      if (session) session.end().catch(() => {});
      else if (onExit) onExit();
    },
    start() {
      renderer.setAnimationLoop(frame);
    },
    stop() {
      renderer.setAnimationLoop(null);
    },
  };
  return api;
}
