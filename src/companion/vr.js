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

const STRING = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff']; // the PC's string colours
const FRET_W = 0.085; // metres per fret across
const STR_H = 0.042; // between strings, up and down at the neck
const SPEED = 2.4; // metres per second of song, towards you
const AHEAD = 4.2; // seconds of notes shown
const FRETS = 24;
const MAX = 640; // notes drawn at once (plenty: a busy part shows ~150)
const KEY = 'stagehand.vr';

const fretX = (f) => (f - 0.5) * FRET_W; // the middle of a fret's lane (fret 0, open, is left of fret 1)

function loadPrefs() {
  try {
    return { dist: 0.75, height: -0.42, offset: 0, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) };
  } catch (_) {
    return { dist: 0.75, height: -0.42, offset: 0 };
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

export function createStage({ canvas, getState, getChart, marks, pcNow, send, onExit }) {
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
  const hw = new THREE.Group(); // placed in front of you (distance and height are yours to set)
  scene.add(hw);
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

  // ------------------------------------------------- the score and the menu --
  const hud = textCanvas(1024, 192);
  const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.225), new THREE.MeshBasicMaterial({ map: hud.t, transparent: true, depthWrite: false, fog: false }));
  hw.add(hudMesh);
  const menu = textCanvas(512, 640);
  const menuMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), new THREE.MeshBasicMaterial({ map: menu.t, transparent: true, depthWrite: false, fog: false }));
  scene.add(menuMesh);
  const BTN = [
    { id: 'play', label: () => (getState() && getState().playing ? 'Pause' : 'Play'), x: 24, y: 96, w: 464, h: 92, big: true },
    { id: 'back', label: () => '−10 s', x: 24, y: 204, w: 224, h: 74 },
    { id: 'fwd', label: () => '+10 s', x: 264, y: 204, w: 224, h: 74 },
    { id: 'near', label: () => 'Nearer', x: 24, y: 294, w: 224, h: 62 },
    { id: 'far', label: () => 'Farther', x: 264, y: 294, w: 224, h: 62 },
    { id: 'up', label: () => 'Higher', x: 24, y: 368, w: 224, h: 62 },
    { id: 'down', label: () => 'Lower', x: 264, y: 368, w: 224, h: 62 },
    { id: 'sooner', label: () => 'Notes sooner', x: 24, y: 442, w: 224, h: 62 },
    { id: 'later', label: () => 'Notes later', x: 264, y: 442, w: 224, h: 62 },
    { id: 'exit', label: () => 'Leave VR', x: 24, y: 548, w: 464, h: 70 },
  ];
  let hover = null;
  let menuSig = '';
  function drawMenu() {
    const st = getState();
    const sig = `${st && st.playing}|${hover}|${prefs.offset}|${prefs.dist}|${prefs.height}`;
    if (sig === menuSig) return;
    menuSig = sig;
    const { g, c, t } = menu;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(19,21,23,.92)';
    g.strokeStyle = 'rgba(255,181,71,.5)';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(4, 4, c.width - 8, c.height - 8, 28);
    g.fill();
    g.stroke();
    g.font = '800 34px Archivo, system-ui, sans-serif';
    g.fillStyle = '#eceef6';
    g.textAlign = 'left';
    g.fillText('Stagehand', 28, 58);
    g.font = '500 22px Archivo, system-ui, sans-serif';
    g.fillStyle = '#97a3aa';
    g.textAlign = 'right';
    g.fillText(prefs.offset ? `notes ${prefs.offset > 0 ? '+' : ''}${prefs.offset} ms` : '', 484, 56);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const b of BTN) {
      const on = hover === b.id;
      g.fillStyle = b.big ? (on ? '#ffc978' : '#ffb547') : on ? '#3a4249' : '#2c3135';
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 16);
      g.fill();
      g.fillStyle = b.big ? '#2a1c05' : '#eceef6';
      g.font = `${b.big ? 800 : 600} ${b.big ? 40 : 28}px Archivo, system-ui, sans-serif`;
      g.fillText(b.label(), b.x + b.w / 2, b.y + b.h / 2 + 2);
    }
    g.textBaseline = 'alphabetic';
    t.needsUpdate = true;
  }
  function press(id) {
    const st = getState();
    const pos = st ? songNow() : 0;
    if (id === 'play') send({ type: 'toggle' });
    else if (id === 'back') send({ type: 'seek', t: Math.max(0, pos - 10) });
    else if (id === 'fwd') send({ type: 'seek', t: pos + 10 });
    else if (id === 'near') prefs.dist = Math.max(0.35, prefs.dist - 0.05);
    else if (id === 'far') prefs.dist = Math.min(1.6, prefs.dist + 0.05);
    else if (id === 'up') prefs.height = Math.min(0.1, prefs.height + 0.03);
    else if (id === 'down') prefs.height = Math.max(-0.9, prefs.height - 0.03);
    else if (id === 'sooner') prefs.offset = Math.max(-300, prefs.offset - 10);
    else if (id === 'later') prefs.offset = Math.min(300, prefs.offset + 10);
    else if (id === 'exit') return api.exit();
    savePrefs();
    place();
  }
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

  function place() {
    hw.position.set(0, prefs.height, -prefs.dist);
    hudMesh.position.set(0, 0.55, -3.2);
    hudMesh.scale.setScalar(1.6);
    menuMesh.position.set(-0.62, prefs.height + 0.32, -prefs.dist + 0.12);
    menuMesh.lookAt(0, 0, 0);
  }
  place();

  // -------------------------------------------------- pointing and pressing --
  const ray = new THREE.Raycaster();
  const ctrls = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.7 }));
    line.scale.z = 2;
    c.add(line);
    c.addEventListener('selectstart', () => {
      const id = pointAt(c);
      if (id) press(id);
    });
    scene.add(c);
    return c;
  });
  const tmpM = new THREE.Matrix4();
  function buttonAt(uv) {
    if (!uv) return null;
    const x = uv.x * 512;
    const y = (1 - uv.y) * 640;
    const b = BTN.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return b ? b.id : null;
  }
  function pointAt(c) {
    tmpM.identity().extractRotation(c.matrixWorld);
    ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
    const hit = ray.intersectObject(menuMesh, false)[0];
    return hit ? buttonAt(hit.uv) : null;
  }
  // the flat preview: the mouse presses the same buttons
  const mouse = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObject(menuMesh, false)[0];
    const id = hit ? buttonAt(hit.uv) : null;
    if (id) press(id);
  });

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
    // the score and the menu (redrawn only when they change)
    drawHud(Math.max(0, now));
    drawMenu();
    menuMesh.visible = renderer.xr.isPresenting;
    if (renderer.xr.isPresenting) {
      let h = null;
      for (const c of ctrls) h = h || pointAt(c);
      hover = h;
    }
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
  const api = {
    renderer,
    stats,
    prefs,
    press,
    /** 'vr' (the venue around you) or 'ar' (your room); resolves once the headset shows it. */
    async enter(mode = 'vr') {
      if (!navigator.xr) throw new Error('This browser has no VR');
      passthrough = mode === 'ar';
      renderer.setClearColor(0x000000, passthrough ? 0 : 1);
      scene.fog = passthrough ? null : new THREE.Fog(0x05070c, 6, 13);
      session = await navigator.xr.requestSession(passthrough ? 'immersive-ar' : 'immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] });
      session.addEventListener('end', () => {
        session = null;
        passthrough = false;
        renderer.setClearColor(0x000000, 1);
        resize();
        if (onExit) onExit();
      });
      await renderer.xr.setSession(session);
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
