/**
 * The note highway's 3D renderer (WebGL through three.js, on the graphics card).
 *
 * Everything on the highway is drawn by the graphics card, every frame,
 * with nothing painted on the processor:
 *  - the venue picture: uploaded once, placed, darkened and lit by the beat in a shader
 *  - the 3D scene: a few vertex buffers rebuilt each frame (solid, see-through,
 *    soft light), one draw call each
 *  - all text (fret numbers, chord names, MISS…) and sparks: images made once
 *    into a texture atlas, drawn as flat quads on top
 *
 * World units: x runs along the neck (about one unit per fret), y is height
 * above the highway floor, z is time ahead (0 = the neck, where you play;
 * positive = still coming). three.js looks down -z, so z is flipped when a
 * vertex is stored. Colours are plain sRGB, like CSS (no conversion).
 */
import * as THREE from '../vendor/three/three.module.min.js';

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

// ------------------------------------------------------------ colours --
const HEX = new Map();
function hexInt(hex) {
  let v = HEX.get(hex);
  if (v === undefined) {
    v = parseInt(hex.slice(1), 16);
    HEX.set(hex, v);
  }
  return v;
}
// colours are reused (never changed), so a frame makes no garbage
const COLS = new Map();
/** A colour for the layers: hex + alpha, optional brightness multiplier. */
export function col(hex, a = 1, k = 1) {
  const n = hexInt(hex);
  const ai = Math.max(0, Math.min(255, Math.round(a * 255)));
  const ki = Math.max(0, Math.min(63, Math.round(k * 8)));
  const key = (n * 256 + ai) * 64 + ki;
  let c = COLS.get(key);
  if (!c) {
    const kk = ki / 8;
    c = [Math.min(1, (((n >> 16) & 255) / 255) * kk), Math.min(1, (((n >> 8) & 255) / 255) * kk), Math.min(1, ((n & 255) / 255) * kk), ai / 255];
    if (COLS.size > 30000) COLS.clear();
    COLS.set(key, c);
  }
  return c;
}
export function mix(hexA, hexB, t, a = 1, k = 1) {
  const x = hexInt(hexA);
  const y = hexInt(hexB);
  const ch = (s) => {
    const p = (x >> s) & 255;
    const q = (y >> s) & 255;
    return Math.round(p + (q - p) * Math.max(0, Math.min(1, t)));
  };
  const hex = '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
  return col(hex, a, k);
}

/** A vertex buffer rebuilt every frame: quads with a colour per corner. */
class Layer {
  constructor(scene, { depthWrite = false, order = 0, additive = false } = {}) {
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
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
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
    this.grow(8192);
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
      const o = q * 6;
      idx[o] = v;
      idx[o + 1] = v + 1;
      idx[o + 2] = v + 2;
      idx[o + 3] = v;
      idx[o + 4] = v + 2;
      idx[o + 5] = v + 3;
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
  /** Four corners as 12 numbers (x, y, z with z = time ahead), colours per corner. */
  q(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, ca, cb, cc, cd) {
    if (this.n >= this.cap) this.grow(this.n + 1);
    const p = this.pos;
    let o = this.n * 12;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = -az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = -bz;
    p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = -cz;
    p[o + 9] = dx; p[o + 10] = dy; p[o + 11] = -dz;
    const r = this.rgba;
    o = this.n * 16;
    r[o] = ca[0]; r[o + 1] = ca[1]; r[o + 2] = ca[2]; r[o + 3] = ca[3];
    r[o + 4] = cb[0]; r[o + 5] = cb[1]; r[o + 6] = cb[2]; r[o + 7] = cb[3];
    r[o + 8] = cc[0]; r[o + 9] = cc[1]; r[o + 10] = cc[2]; r[o + 11] = cc[3];
    r[o + 12] = cd[0]; r[o + 13] = cd[1]; r[o + 14] = cd[2]; r[o + 15] = cd[3];
    this.n++;
  }
  /** Four corners [x, y, z], colours: one, or one per corner. */
  quad(a, b, c, d, ca, cb = ca, cc = cb, cd = cc) {
    this.q(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2], ca, cb, cc, cd);
  }
  /** A flat rectangle on a horizontal plane y (x0..x1, z0..z1), colours near / far. */
  flat(x0, x1, z0, z1, y, cNear, cFar = cNear) {
    this.q(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, cNear, cNear, cFar, cFar);
  }
  /** An upright rectangle facing you at depth z. */
  up(x0, x1, y0, y1, z, cBot, cTop = cBot) {
    this.q(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, cBot, cBot, cTop, cTop);
  }
  /** A box: front (near) face, top, and the two sides; back and bottom never show. */
  box(x0, x1, y0, y1, z0, z1, front, top = front, side = front) {
    this.q(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, front, front, front, front);
    this.q(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1, top, top, top, top);
    this.q(x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1, side, side, side, side);
    this.q(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1, side, side, side, side);
  }
  /** A thin bar between two points, widened across `w`: plane 'y' = flat on a floor, 'z' = upright. */
  bar(a, b, w, c0, c1 = c0, plane = 'y') {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (plane === 'y') {
      const L = Math.hypot(dx, dz) || 1;
      ox = (-dz / L) * w * 0.5;
      oz = (dx / L) * w * 0.5;
    } else {
      const L = Math.hypot(dx, dy) || 1;
      ox = (-dy / L) * w * 0.5;
      oy = (dx / L) * w * 0.5;
    }
    this.q(a[0] - ox, a[1] - oy, a[2] - oz, a[0] + ox, a[1] + oy, a[2] + oz, b[0] + ox, b[1] + oy, b[2] + oz, b[0] - ox, b[1] - oy, b[2] - oz, c0, c0, c1, c1);
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

// ------------------------------------------------------------- text --
// Text is drawn once per (text, style) into a small image, packed into one
// big texture, and shown as flat quads in screen pixels on top of the scene.
const TVS = /* glsl */ `
attribute vec2 uv0;
attribute vec4 rgba;
uniform vec2 res;
varying vec2 vUv;
varying vec4 vC;
void main() {
  vUv = uv0;
  vC = rgba;
  gl_Position = vec4(position.x / res.x * 2.0 - 1.0, 1.0 - position.y / res.y * 2.0, 0.0, 1.0);
}`;
const TFS = /* glsl */ `
uniform sampler2D atlas;
varying vec2 vUv;
varying vec4 vC;
void main() {
  vec4 t = texture2D(atlas, vUv);
  gl_FragColor = vec4(t.rgb * vC.rgb, t.a * vC.a);
  if (gl_FragColor.a < 0.004) discard;
}`;

class TextLayer {
  constructor(scene, renderer) {
    this.size = 1024;
    this.atlas = document.createElement('canvas');
    this.atlas.width = this.atlas.height = this.size;
    this.actx = this.atlas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.atlas);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.premultiplyAlpha = false;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = true;
    this.items = new Map();
    this.shelf = { x: 2, y: 2, h: 0 };
    // a white square for sparks and plain shapes
    this.actx.fillStyle = '#fff';
    this.actx.fillRect(2, 2, 8, 8);
    this.white = { u0: 4 / this.size, v0: 4 / this.size, u1: 8 / this.size, v1: 8 / this.size };
    this.shelf.x = 14;
    this.shelf.h = 10;
    this.dirty = true;
    this.cap = 0;
    this.n = 0;
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: TVS,
      fragmentShader: TFS,
      uniforms: { atlas: { value: this.tex }, res: { value: new THREE.Vector2(1, 1) } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    scene.add(this.mesh);
    this.grow(2048);
  }
  grow(quads) {
    const cap = Math.max(quads, this.cap * 2);
    const pos = new Float32Array(cap * 12);
    const uv = new Float32Array(cap * 8);
    const rgba = new Float32Array(cap * 16);
    if (this.pos) {
      pos.set(this.pos);
      uv.set(this.uv);
      rgba.set(this.rgba);
    }
    const idx = new Uint32Array(cap * 6);
    for (let q = 0; q < cap; q++) {
      const v = q * 4;
      const o = q * 6;
      idx[o] = v;
      idx[o + 1] = v + 1;
      idx[o + 2] = v + 2;
      idx[o + 3] = v;
      idx[o + 4] = v + 2;
      idx[o + 5] = v + 3;
    }
    Object.assign(this, { pos, uv, rgba, cap });
    this.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(rgba, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('uv0', this.aUv);
    this.geo.setAttribute('rgba', this.aCol);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  /** An image for (key), drawn by paint(ctx) into a w × h box, packed into the atlas once. */
  image(key, w, h, paint) {
    let it = this.items.get(key);
    if (it) return it;
    w = Math.ceil(w);
    h = Math.ceil(h);
    const S = this.shelf;
    if (S.x + w + 2 > this.size) {
      S.x = 2;
      S.y += S.h + 2;
      S.h = 0;
    }
    if (S.y + h + 2 > this.size) {
      // full: start again (rare; only after very many different labels)
      this.items.clear();
      this.actx.clearRect(0, 0, this.size, this.size);
      this.actx.fillStyle = '#fff';
      this.actx.fillRect(2, 2, 8, 8);
      Object.assign(S, { x: 14, y: 2, h: 10 });
    }
    const x = S.x;
    const y = S.y;
    S.x += w + 2;
    S.h = Math.max(S.h, h);
    const g = this.actx;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.translate(x, y);
    paint(g, w, h);
    g.restore();
    it = { w, h, u0: x / this.size, v0: y / this.size, u1: (x + w) / this.size, v1: (y + h) / this.size };
    this.items.set(key, it);
    this.dirty = true;
    return it;
  }
  begin() {
    this.n = 0;
  }
  /** Draw an atlas item with its top-left at (x, y) pixels, size w × h, tint [r,g,b,a]. */
  quad(it, x, y, w, h, tint) {
    if (this.n >= this.cap) this.grow(this.n + 1);
    const p = this.pos;
    let o = this.n * 12;
    p[o] = x; p[o + 1] = y + h; p[o + 2] = 0;
    p[o + 3] = x + w; p[o + 4] = y + h; p[o + 5] = 0;
    p[o + 6] = x + w; p[o + 7] = y; p[o + 8] = 0;
    p[o + 9] = x; p[o + 10] = y; p[o + 11] = 0;
    const u = this.uv;
    o = this.n * 8;
    // canvas textures are flipped (flipY): v counts from the bottom
    u[o] = it.u0; u[o + 1] = 1 - it.v1;
    u[o + 2] = it.u1; u[o + 3] = 1 - it.v1;
    u[o + 4] = it.u1; u[o + 5] = 1 - it.v0;
    u[o + 6] = it.u0; u[o + 7] = 1 - it.v0;
    const r = this.rgba;
    o = this.n * 16;
    for (let k = 0; k < 4; k++) {
      r[o + k * 4] = tint[0];
      r[o + k * 4 + 1] = tint[1];
      r[o + k * 4 + 2] = tint[2];
      r[o + k * 4 + 3] = tint[3];
    }
    this.n++;
  }
  /** A thin line from (x0, y0) to (x1, y1) in pixels, w wide (sparks). */
  line(x0, y0, x1, y1, w, tint) {
    if (this.n >= this.cap) this.grow(this.n + 1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    const ox = (-dy / L) * w * 0.5;
    const oy = (dx / L) * w * 0.5;
    const p = this.pos;
    let o = this.n * 12;
    p[o] = x0 - ox; p[o + 1] = y0 - oy; p[o + 2] = 0;
    p[o + 3] = x0 + ox; p[o + 4] = y0 + oy; p[o + 5] = 0;
    p[o + 6] = x1 + ox; p[o + 7] = y1 + oy; p[o + 8] = 0;
    p[o + 9] = x1 - ox; p[o + 10] = y1 - oy; p[o + 11] = 0;
    const it = this.white;
    const u = this.uv;
    o = this.n * 8;
    for (let k = 0; k < 4; k++) {
      u[o + k * 2] = (it.u0 + it.u1) / 2;
      u[o + k * 2 + 1] = 1 - (it.v0 + it.v1) / 2;
    }
    const r = this.rgba;
    o = this.n * 16;
    for (let k = 0; k < 4; k++) {
      r[o + k * 4] = tint[0];
      r[o + k * 4 + 1] = tint[1];
      r[o + k * 4 + 2] = tint[2];
      r[o + k * 4 + 3] = tint[3];
    }
    this.n++;
  }
  end(W, H) {
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
    this.mat.uniforms.res.value.set(W, H);
    for (const a of [this.aPos, this.aUv, this.aCol]) {
      a.needsUpdate = true;
      a.updateRanges = [];
    }
    this.aPos.addUpdateRange(0, this.n * 12);
    this.aUv.addUpdateRange(0, this.n * 8);
    this.aCol.addUpdateRange(0, this.n * 16);
    this.geo.setDrawRange(0, this.n * 6);
  }
}

// ------------------------------------------------------- venue --
// A full-screen quad behind everything: the venue picture (uploaded once),
// placed so its floor line meets the highway, the floor darkened toward the
// neck, a calm pocket behind the highway, vignette, beat lights, warmth.
const BVS = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.999, 1.0); }`;
const BFS = /* glsl */ `
uniform sampler2D soft;
uniform sampler2D lit;
uniform float hasImg;
uniform vec2 res;      // CSS pixels
uniform float dpr;
uniform vec4 rect;     // picture placed at x, y, w, h (CSS pixels, from the top)
uniform float vp;      // where the highway's far end meets the floor (CSS px from top)
uniform float pulse;
uniform float heat;
void main() {
  vec2 p = vec2(gl_FragCoord.x, res.y * dpr - gl_FragCoord.y) / dpr;
  vec3 c;
  if (hasImg > 0.5) {
    vec2 uv = (p - rect.xy) / rect.zw;
    uv = clamp(uv, vec2(0.0, 0.0), vec2(1.0, 0.999));
    vec2 tuv = vec2(uv.x, 1.0 - uv.y);
    c = texture2D(soft, tuv).rgb;
    if (p.y < vp + res.y * 0.04) {
      vec3 l = texture2D(lit, tuv).rgb * min(0.35, pulse * 0.32);
      c = 1.0 - (1.0 - c) * (1.0 - l);
    }
  } else {
    float d = distance(p / res, vec2(0.5, 0.42));
    c = mix(vec3(0.10, 0.12, 0.18), vec3(0.02, 0.03, 0.05), clamp(d * 1.6, 0.0, 1.0)) * (1.0 + pulse * 0.25);
  }
  // the floor in front darkens toward you (where the neck and strings are)
  float fy = clamp((p.y - vp) / max(1.0, res.y - vp), 0.0, 1.0);
  c *= 1.0 - (fy < 0.5 ? fy * 0.8 : 0.4 + (fy - 0.5) * 0.7);
  // a calm pocket behind the highway
  float pd = distance(p, vec2(res.x * 0.5, vp)) / (res.y * 0.45);
  c *= 1.0 - 0.3 * clamp(1.0 - pd, 0.0, 1.0);
  // soft dark edges
  float vd = distance(p, vec2(res.x * 0.5, res.y * 0.45)) / (res.x * 0.75);
  c *= 1.0 - 0.4 * smoothstep(0.45, 1.0, vd);
  // warmer as you heat up
  c = mix(c, c * vec3(1.25, 0.95, 0.75) + vec3(0.04, 0.015, 0.0), heat * 0.6);
  gl_FragColor = vec4(c, 1.0);
}`;

function makeBackdrop(scene) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: BVS,
    fragmentShader: BFS,
    uniforms: {
      soft: { value: null },
      lit: { value: null },
      hasImg: { value: 0 },
      res: { value: new THREE.Vector2(1, 1) },
      dpr: { value: 1 },
      rect: { value: new THREE.Vector4(0, 0, 1, 1) },
      vp: { value: 300 },
      pulse: { value: 0 },
      heat: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  scene.add(mesh);
  return mat;
}

// pictures are loaded and prepared once (softened copy + a "lights" copy for the beat)
const PHOTOS = new Map();
function photoTextures(name) {
  let p = PHOTOS.get(name);
  if (p) return p;
  p = { ready: false, w: 16, h: 9, soft: null, lit: null };
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const mk = (cw, ch, filter) => {
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const g = c.getContext('2d');
      g.filter = filter;
      g.drawImage(img, 0, 0, cw, ch);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    };
    p.soft = mk(w, h, 'blur(1.5px) brightness(0.8) saturate(0.92)');
    p.lit = mk(Math.round(w / 2), Math.round(h / 2), 'blur(6px) brightness(1.25) contrast(1.6) saturate(1.2)');
    p.w = w;
    p.h = h;
    p.ready = true;
  };
  img.src = `venues/${name}.jpg`;
  PHOTOS.set(name, p);
  return p;
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
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // colours are given as sRGB already
  renderer.toneMapping = THREE.NoToneMapping;
  // which graphics card is drawing (shown with the frame rate; "SwiftShader" = no GPU)
  let gpuName = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 60);
  } catch (_) {}
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 600);
  const back = makeBackdrop(scene);
  const L = {
    floor: new Layer(scene, { order: 0 }),
    solid: new Layer(scene, { order: 2, depthWrite: true }),
    alpha: new Layer(scene, { order: 3 }),
    glow: new Layer(scene, { order: 4, additive: true }),
  };
  const text = new TextLayer(scene, renderer);

  let W = 1;
  let H = 1;
  let dpr = 1;
  const M = new THREE.Matrix4();
  const e = M.elements;
  let scale = 1; // render resolution (lowered automatically on slow graphics)

  const R = {
    THREE,
    L,
    text,
    camera,
    gpuName,
    glow: false,
    get W() {
      return W;
    },
    get H() {
      return H;
    },
    get scale() {
      return scale;
    },
    resize(w, h, ratio) {
      W = w;
      H = h;
      dpr = ratio * scale;
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, true);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    },
    /** Render at a fraction of full resolution. */
    setScale(s, ratio) {
      if (s === scale) return;
      scale = s;
      R.resize(W, H, ratio);
    },
    /**
     * Places the camera: position and the point it looks at (world, z = time
     * ahead), vertical field of view in degrees, and a picture shift in
     * pixels (dx, dy) that moves the view without turning the camera.
     */
    setCamera(pos, look, fov, dx = 0, dy = 0) {
      camera.fov = fov;
      camera.aspect = W / H;
      camera.position.set(pos[0], pos[1], -pos[2]);
      camera.up.set(0, 1, 0);
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
    /**
     * The venue: v = { photo, horizon } or null for plain; vpY where the
     * highway's far end meets the floor (CSS px), shift −1..1 (camera drift).
     */
    setVenue(v, vpY, shift, pulse, heat) {
      const u = back.uniforms;
      u.res.value.set(W, H);
      u.dpr.value = renderer.getPixelRatio();
      u.pulse.value = pulse;
      u.heat.value = heat;
      const vp = Math.max(H * 0.22, Math.min(H * 0.6, vpY));
      u.vp.value = vp;
      const p = v && v.photo ? photoTextures(v.photo) : null;
      if (!p || !p.ready) {
        u.hasImg.value = 0;
        return;
      }
      u.hasImg.value = 1;
      u.soft.value = p.soft;
      u.lit.value = p.lit;
      const sc = Math.max((W * 1.08) / p.w, (H / p.h) * 0.85, vp / (v.horizon * p.h));
      const dw = p.w * sc;
      const dh = p.h * sc;
      const room = (dw - W) / 2;
      u.rect.value.set(-room + Math.max(-1, Math.min(1, shift || 0)) * room * 0.6, vp - v.horizon * dh, dw, dh);
    },
    begin() {
      for (const k in L) L[k].begin();
      text.begin();
    },
    render(zFar, zPast) {
      for (const k in L) L[k].end(zFar, zPast);
      text.end(W, H);
      renderer.render(scene, camera);
    },
    info() {
      return { quads: Object.fromEntries(Object.entries(L).map(([k, l]) => [k, l.n])), text: text.n, calls: renderer.info.render.calls };
    },
  };
  return R;
}
