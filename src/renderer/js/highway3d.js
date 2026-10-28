/**
 * The note highway's 3D renderer (WebGL through three.js, on the graphics card).
 *
 * World units: x runs along the neck (about one unit per fret), y is height
 * above the highway floor, z is time ahead (0 = the neck, where you play;
 * positive = still coming). three.js looks down -z, so z is flipped when a
 * vertex is stored.
 *
 * Geometry is rebuilt every frame into a few big vertex buffers (one draw
 * call each): solid shapes, see-through shapes and glowing (additive) shapes.
 * A bloom pass makes bright edges glow for real instead of canvas shadows.
 * The venue is painted on a 2D canvas and used as the scene's backdrop.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';

const VS = /* glsl */ `
attribute vec4 rgba;
varying vec4 vC;
varying float vZ;
void main() {
  vC = rgba;
  vZ = -position.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// Far things fade into the distance; things that passed the neck fade quickly.
const FS = /* glsl */ `
uniform float zFar;
uniform float zPast;
uniform float additive;
varying vec4 vC;
varying float vZ;
void main() {
  float f = clamp((zFar - vZ) / (zFar * 0.3), 0.0, 1.0);
  if (vZ < 0.0) f *= clamp(1.0 + vZ / zPast, 0.0, 1.0);
  float a = vC.a * f;
  if (a < 0.003) discard;
  gl_FragColor = additive > 0.5 ? vec4(vC.rgb * a, 1.0) : vec4(vC.rgb, a);
}`;

/** sRGB hex -> linear [r, g, b] (cached), so colours match the CSS ones after output. */
const LIN = new Map();
function lin(hex) {
  let v = LIN.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    v = [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
    LIN.set(hex, v);
  }
  return v;
}
/** A colour for the layers: hex + alpha, optional brightness multiplier (> 1 blooms). */
export function col(hex, a = 1, k = 1) {
  const c = lin(hex);
  return [c[0] * k, c[1] * k, c[2] * k, a];
}
export function mix(hexA, hexB, t, a = 1, k = 1) {
  const x = lin(hexA);
  const y = lin(hexB);
  return [(x[0] + (y[0] - x[0]) * t) * k, (x[1] + (y[1] - x[1]) * t) * k, (x[2] + (y[2] - x[2]) * t) * k, a];
}

/** A vertex buffer rebuilt every frame: quads with a colour per corner. */
class Layer {
  constructor(scene, { blending = THREE.NormalBlending, depthWrite = false, order = 0, additive = false } = {}) {
    this.cap = 0;
    this.n = 0;
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { zFar: { value: 40 }, zPast: { value: 1 }, additive: { value: additive ? 1 : 0 } },
      transparent: true,
      depthWrite,
      depthTest: true,
      blending: additive ? THREE.CustomBlending : blending,
      side: THREE.DoubleSide,
    });
    if (additive) {
      this.mat.blendSrc = THREE.OneFactor;
      this.mat.blendDst = THREE.OneFactor;
      this.mat.blendEquation = THREE.AddEquation;
    }
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    scene.add(this.mesh);
    this.grow(4096);
  }
  grow(quads) {
    const cap = Math.max(quads, this.cap * 2);
    const pos = new Float32Array(cap * 12);
    const rgba = new Float32Array(cap * 16);
    if (this.pos) {
      pos.set(this.pos);
      rgba.set(this.rgba);
    }
    const idx = new Uint32Array(cap * 6);
    for (let q = 0; q < cap; q++) {
      const v = q * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    }
    this.pos = pos;
    this.rgba = rgba;
    this.cap = cap;
    this.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(rgba, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('rgba', this.aCol);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  begin() {
    this.n = 0;
  }
  /** Four corners [x, y, z] (z = time ahead), colours: one, or one per corner. */
  quad(a, b, c, d, ca, cb = ca, cc = cb, cd = cc) {
    if (this.n >= this.cap) this.grow(this.n + 1);
    const p = this.pos;
    let o = this.n * 12;
    p[o] = a[0]; p[o + 1] = a[1]; p[o + 2] = -a[2];
    p[o + 3] = b[0]; p[o + 4] = b[1]; p[o + 5] = -b[2];
    p[o + 6] = c[0]; p[o + 7] = c[1]; p[o + 8] = -c[2];
    p[o + 9] = d[0]; p[o + 10] = d[1]; p[o + 11] = -d[2];
    const r = this.rgba;
    o = this.n * 16;
    r.set(ca, o);
    r.set(cb, o + 4);
    r.set(cc, o + 8);
    r.set(cd, o + 12);
    this.n++;
  }
  /** A flat rectangle on a horizontal plane y (x0..x1, z0..z1), colours near / far. */
  flat(x0, x1, z0, z1, y, cNear, cFar = cNear) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], cNear, cNear, cFar, cFar);
  }
  /** An upright rectangle facing you at depth z. */
  up(x0, x1, y0, y1, z, cBot, cTop = cBot) {
    this.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], cBot, cBot, cTop, cTop);
  }
  /** A box: front (near) face, top, and the two sides; back and bottom never show. */
  box(x0, x1, y0, y1, z0, z1, front, top = front, side = front) {
    this.up(x0, x1, y0, y1, z0, front);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top);
    this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], side);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], side);
  }
  /** A thin bar between two points, widened across `w` (world units) in the given plane: 'y' = flat on a floor, 'z' = upright. */
  bar(a, b, w, c0, c1 = c0, plane = 'y') {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (plane === 'y') {
      // widen across x/z on the floor
      const L = Math.hypot(dx, dz) || 1;
      ox = (-dz / L) * w * 0.5;
      oz = (dx / L) * w * 0.5;
    } else {
      // widen within the upright x/y plane
      const L = Math.hypot(dx, dy) || 1;
      ox = (-dy / L) * w * 0.5;
      oy = (dx / L) * w * 0.5;
    }
    this.quad([a[0] - ox, a[1] - oy, a[2] - oz], [a[0] + ox, a[1] + oy, a[2] + oz], [b[0] + ox, b[1] + oy, b[2] + oz], [b[0] - ox, b[1] - oy, b[2] - oz], c0, c0, c1, c1);
  }
  end(zFar, zPast) {
    this.mat.uniforms.zFar.value = zFar;
    this.mat.uniforms.zPast.value = zPast;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aPos.updateRanges = [];
    this.aCol.updateRanges = [];
    this.aPos.addUpdateRange(0, this.n * 12);
    this.aCol.addUpdateRange(0, this.n * 16);
    this.geo.setDrawRange(0, this.n * 6);
  }
}

/**
 * Makes the renderer, or returns null when WebGL isn't available (the
 * highway then shows the 2D view).
 */
export function createRenderer3D(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (err) {
    console.warn('Highway: WebGL unavailable', err);
    return null;
  }
  renderer.setClearColor(0x05070c, 1);
  // which graphics card is drawing (shown with the frame rate; "SwiftShader" = no GPU)
  let gpuName = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 60);
  } catch (_) {}
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 600);

  // the venue, painted in 2D at half size and shown behind everything
  const bg = document.createElement('canvas');
  const bgTex = new THREE.CanvasTexture(bg);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;

  const L = {
    floor: new Layer(scene, { order: 0 }),
    solid: new Layer(scene, { order: 2, depthWrite: true }),
    alpha: new Layer(scene, { order: 3 }),
    glow: new Layer(scene, { order: 4, additive: true }),
  };

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.25, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let W = 1;
  let H = 1;
  let dpr = 1;
  const M = new THREE.Matrix4();
  const e = M.elements;
  let glow = true;
  let scale = 1; // render resolution (lowered automatically on slow graphics)

  const R = {
    THREE,
    L,
    camera,
    bg,
    get W() {
      return W;
    },
    get H() {
      return H;
    },
    resize(w, h, ratio) {
      W = w;
      H = h;
      dpr = ratio * scale;
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, true); // also sets the CSS size, so a lowered resolution still fills the screen
      composer.setPixelRatio(dpr);
      composer.setSize(W, H);
      bloom.resolution.set(W / 2, H / 2);
      const bw = Math.round(W * 0.5);
      const bh = Math.round(H * 0.5);
      if (bg.width !== bw || bg.height !== bh) {
        bg.width = bw;
        bg.height = bh;
      }
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    },
    setGlow(on) {
      glow = !!on;
    },
    gpuName,
    get glow() {
      return glow;
    },
    get scale() {
      return scale;
    },
    /** Render at a fraction of full resolution (the 2D text layer stays sharp). */
    setScale(s, ratio) {
      if (s === scale) return;
      scale = s;
      R.resize(W, H, ratio);
    },
    /**
     * Places the camera: position and the point it looks at (world, z = time
     * ahead), vertical field of view in degrees, and a picture shift in
     * pixels (dx, dy) that moves the view without turning the camera, so
     * lines stay straight.
     */
    setCamera(pos, look, fov, dx = 0, dy = 0, roll = 0) {
      camera.fov = fov;
      camera.aspect = W / H;
      camera.position.set(pos[0], pos[1], -pos[2]);
      camera.up.set(Math.sin(roll), Math.cos(roll), 0);
      camera.lookAt(look[0], look[1], -look[2]);
      if (dx || dy) camera.setViewOffset(W, H, -dx, -dy, W, H);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      M.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    },
    /** World point -> [screen x, screen y, pixels per world unit there, in front?]. */
    project(x, y, z) {
      const zz = -z;
      const cx = e[0] * x + e[4] * y + e[8] * zz + e[12];
      const cy = e[1] * x + e[5] * y + e[9] * zz + e[13];
      const w = e[3] * x + e[7] * y + e[11] * zz + e[15];
      const ww = Math.max(1e-4, w);
      return [((cx / ww) * 0.5 + 0.5) * W, (0.5 - (cy / ww) * 0.5) * H, (camera.projectionMatrix.elements[5] * H) / 2 / ww, w > 0.01];
    },
    begin() {
      for (const k in L) L[k].begin();
    },
    render(zFar, zPast) {
      for (const k in L) L[k].end(zFar, zPast);
      if (R.bgDirty) bgTex.needsUpdate = true;
      R.bgDirty = false;
      if (glow) composer.render();
      else renderer.render(scene, camera);
    },
    info() {
      return { quads: Object.fromEntries(Object.entries(L).map(([k, l]) => [k, l.n])), calls: renderer.info.render.calls };
    },
  };
  return R;
}
