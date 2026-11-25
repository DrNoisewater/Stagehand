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
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';

const VS = /* glsl */ `
attribute vec4 rgba;
uniform float mirror;
varying vec4 vC;
varying float vZ;
varying float vY;
void main() {
  vC = rgba;
  vZ = -position.z;
  vY = position.y;
  vec3 p = position;
  // a look's mirror floor: the same quads turned upside down under the floor (nothing else moves)
  if (mirror > 0.5) p.y = -p.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
// Far things fade into the distance; things that passed the neck fade quickly.
// A look can dim or brighten (gain) and add fog (fogK, towards fogCol); at 1 and 0 the colours are untouched.
const FS = /* glsl */ `
uniform float zFar;
uniform float zPast;
uniform float additive;
uniform float gain;
uniform float fogK;
uniform vec3 fogCol;
uniform float mirror;
uniform float reflK;
varying vec4 vC;
varying float vZ;
varying float vY;
void main() {
  if (mirror > 0.5 && (vY < 0.0 || vZ < 0.0)) discard;
  float f = clamp((zFar - vZ) / (zFar * 0.3), 0.0, 1.0);
  if (vZ < 0.0) f *= clamp(1.0 + vZ / zPast, 0.0, 1.0);
  float a = vC.a * f;
  if (mirror > 0.5) a *= reflK * exp(-vY * 1.8) * clamp(vZ / 3.0, 0.0, 1.0);
  if (a < 0.003) discard;
  vec3 c = vC.rgb * gain;
  float fg = fogK * smoothstep(0.05, 0.85, vZ / zFar);
  // glow adds light only: alpha 0, so on a see-through highway (Nebula, Fluid)
  // it brightens the moving background instead of covering it with a dark slab
  if (additive > 0.5) gl_FragColor = vec4(c * (1.0 - fg) * a, 0.0);
  else gl_FragColor = vec4(mix(c, fogCol, fg), a);
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


// ------------------------------------------------------------- rods (4.16.2) --
// Strings and fret wires are drawn round: a few facets, each corner coloured by how the light from above
// the camera falls on it, with a highlight. The colours are worked out once per colour and kept.
const ROD_A0 = -Math.PI * 0.55; // from just under the front …
const ROD_SPAN = Math.PI * 1.25; // … over the top to just behind
const RODS = new Map();
/** The corner colours for a rod of colour `hex`: 'string' (lying across, lit from above) or 'post' (standing up). */
export function rodShades(hex, kind = 'string', facets = 6) {
  const key = `${hex}|${kind}|${facets}`;
  let out = RODS.get(key);
  if (out) return out;
  out = [];
  for (let i = 0; i <= facets; i++) {
    let lit;
    let spec;
    if (kind === 'post') {
      const a = -Math.PI / 2 + (Math.PI * i) / facets; // left side → front → right side
      lit = 0.42 + 0.58 * Math.max(0, Math.cos(a + 0.35));
      spec = Math.pow(Math.max(0, Math.cos(a + 0.5)), 18) * 0.85;
    } else if (kind === 'wire') {
      // 4.17: polished fret wire: darker flanks, a sharp white line where the light catches it and a
      // second, softer one from the stage lights on the other side
      const a = -Math.PI / 2 + (Math.PI * i) / facets;
      lit = 0.32 + 0.72 * Math.max(0, Math.cos(a + 0.3));
      spec = Math.min(1, Math.pow(Math.max(0, Math.cos(a + 0.45)), 24) * 1.0 + Math.pow(Math.max(0, Math.cos(a - 0.9)), 10) * 0.3);
    } else {
      const a = ROD_A0 + (ROD_SPAN * i) / facets;
      // normal (sin a up, -cos a towards you); light from above and in front
      const ny = Math.sin(a);
      const nz = Math.cos(a);
      const d = Math.max(0, ny * 0.8 + nz * 0.6);
      lit = 0.42 + 0.66 * d;
      spec = Math.pow(d, 30) * 0.55;
    }
    out.push(mix(hex, '#ffffff', spec, 1, lit));
  }
  RODS.set(key, out);
  return out;
}

// ------------------------------------------------------- soft light (4.17) --
// Round glows instead of rectangles: a fan bright in the middle, fading to nothing at the rim, in
// three steps so the edge is soft (the light falls off like a lamp's, not like a cone).
const CIRCLES = new Map();
function circle(n) {
  let c = CIRCLES.get(n);
  if (!c) {
    c = [];
    for (let i = 0; i <= n; i++) c.push([Math.cos((i / n) * Math.PI * 2), Math.sin((i / n) * Math.PI * 2)]);
    CIRCLES.set(n, c);
  }
  return c;
}
const HALO_R = [0, 0.3, 0.62, 1]; // radii of the steps …
const HALO_K = [1, 0.5, 0.14, 0]; // … and how bright each is
const BLACK0 = [0, 0, 0, 0];
/** A colour as a hex string, mixed and stepped (so caches keyed by it stay small). */
export function mixHex(hexA, hexB, t, steps = 16) {
  const x = hexInt(hexA);
  const y = hexInt(hexB);
  const u = Math.round(Math.max(0, Math.min(1, t)) * steps) / steps;
  const ch = (s) => Math.round(((x >> s) & 255) + (((y >> s) & 255) - ((x >> s) & 255)) * u);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}
// a frame's corner colours, made once per (hex, a, k) and kept for a while
const HALOS = new Map();
function haloCols(hex, a, k) {
  const key = `${hex}|${Math.round(a * 255)}|${Math.round(k * 8)}`;
  let c = HALOS.get(key);
  if (!c) {
    c = HALO_K.map((f) => (f ? col(hex, a * f, k) : BLACK0));
    if (HALOS.size > 6000) HALOS.clear();
    HALOS.set(key, c);
  }
  return c;
}

/** A vertex buffer rebuilt every frame: quads with a colour per corner. */
class Layer {
  constructor(scene, { depthWrite = false, order = 0, additive = false, look = null } = {}) {
    this.cap = 0;
    this.additive = additive;
    this.softTo = null; // the glow layer sends its soft lights (halos, bands, rings) to their own layer
    this.n = 0;
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { zFar: { value: 40 }, zPast: { value: 1 }, additive: { value: additive ? 1 : 0 }, gain: { value: 1 }, fogK: look ? look.fogK : { value: 0 }, fogCol: look ? look.fogCol : { value: new THREE.Color(0, 0, 0) }, mirror: { value: 0 }, reflK: { value: 0 } },
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
  /** The same quads seen in a mirror floor: drawn just after the floor, faint, fading under it. */
  mirrorIn(scene) {
    const mat = this.mat.clone();
    mat.uniforms = { ...this.mat.uniforms, mirror: { value: 1 }, reflK: { value: 0.25 }, gain: this.mat.uniforms.gain };
    mat.depthWrite = false;
    if (this.additive) {
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneFactor;
      mat.blendEquation = THREE.AddEquation;
    }
    const m = new THREE.Mesh(this.geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 1;
    m.visible = false;
    scene.add(m);
    return m;
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
  /**
   * 4.16.2: a round rod lying across the neck (a string): x0..x1 at height y, depth z, radius r. Drawn as
   * facets around its front and top, lit from above the camera, with a bright line where the light catches it,
   * so it reads as a round string and not a flat line. `shades` comes from rodShades(hex).
   */
  rodX(x0, x1, y, z, r, shades, yEnd = y) {
    // yEnd: the right end's height, when the rod is a piece of a string that sways (4.17)
    const n = shades.length - 1;
    const dy = yEnd - y;
    for (let i = 0; i < n; i++) {
      const a0 = ROD_A0 + (ROD_SPAN * i) / n;
      const a1 = ROD_A0 + (ROD_SPAN * (i + 1)) / n;
      const y0 = y + r * Math.sin(a0);
      const z0 = z - r * Math.cos(a0);
      const y1 = y + r * Math.sin(a1);
      const z1 = z - r * Math.cos(a1);
      this.q(x0, y0, z0, x1, y0 + dy, z0, x1, y1 + dy, z1, x0, y1, z1, shades[i], shades[i], shades[i + 1], shades[i + 1]);
    }
  }
  /**
   * 4.17: a soft round light: bright in the middle (hex at alpha a, brightness k), fading to nothing at the
   * rim, rx × ry. plane 'z' stands upright facing you at depth z; plane 'y' lies flat on height y.
   */
  halo(x, y, z, rx, ry, hex, a, k = 1, plane = 'z', segs = 16) {
    if (this.softTo) return this.softTo.halo(...arguments);
    if (a < 0.004 || rx <= 0 || ry <= 0) return;
    const C = circle(segs);
    const cs = haloCols(hex, a, k);
    const flat = plane === 'y';
    for (let i = 0; i < segs; i++) {
      const [c0, s0] = C[i];
      const [c1, s1] = C[i + 1];
      for (let b = 0; b < 3; b++) {
        const ra = HALO_R[b];
        const rb = HALO_R[b + 1];
        const ca = cs[b];
        const cb = cs[b + 1];
        if (flat) {
          this.q(x + c0 * rx * ra, y, z + s0 * ry * ra, x + c0 * rx * rb, y, z + s0 * ry * rb, x + c1 * rx * rb, y, z + s1 * ry * rb, x + c1 * rx * ra, y, z + s1 * ry * ra, ca, cb, cb, ca);
        } else {
          this.q(x + c0 * rx * ra, y + s0 * ry * ra, z, x + c0 * rx * rb, y + s0 * ry * rb, z, x + c1 * rx * rb, y + s1 * ry * rb, z, x + c1 * rx * ra, y + s1 * ry * ra, z, ca, cb, cb, ca);
        }
      }
    }
  }
  /**
   * 4.17: a soft ring of light (the hit's shock wave): radius rx × ry, th thick, brightest along its middle
   * and fading to nothing on both sides. Upright, facing you at depth z.
   */
  ring(x, y, z, rx, ry, th, hex, a, k = 1, segs = 24) {
    if (this.softTo) return this.softTo.ring(...arguments);
    if (a < 0.004) return;
    const C = circle(segs);
    const c = col(hex, a, k);
    const h = th * 0.5;
    const R = [-h, 0, h];
    const K = [BLACK0, c, BLACK0];
    for (let i = 0; i < segs; i++) {
      const [c0, s0] = C[i];
      const [c1, s1] = C[i + 1];
      for (let b = 0; b < 2; b++) {
        const ia = R[b];
        const ib = R[b + 1];
        this.q(x + c0 * (rx + ia), y + s0 * (ry + ia), z, x + c0 * (rx + ib), y + s0 * (ry + ib), z, x + c1 * (rx + ib), y + s1 * (ry + ib), z, x + c1 * (rx + ia), y + s1 * (ry + ia), z, K[b], K[b + 1], K[b + 1], K[b]);
      }
    }
  }
  /** 4.17: an upright band of light from x0 to x1, brightest along x (its middle), fading to nothing at both sides. */
  upSoft(x0, x1, y0, y1, z, cBot, cTop = cBot) {
    if (this.softTo) return this.softTo.upSoft(...arguments);
    const xm = (x0 + x1) / 2;
    this.q(x0, y0, z, xm, y0, z, xm, y1, z, x0, y1, z, BLACK0, cBot, cTop, BLACK0);
    this.q(xm, y0, z, x1, y0, z, x1, y1, z, xm, y1, z, cBot, BLACK0, BLACK0, cTop);
  }
  /** 4.17: a horizontal band of light from y0 to y1, brightest along its middle, fading at top and bottom. */
  acrossSoft(x0, x1, y0, y1, z, c) {
    if (this.softTo) return this.softTo.acrossSoft(...arguments);
    const ym = (y0 + y1) / 2;
    this.q(x0, y0, z, x1, y0, z, x1, ym, z, x0, ym, z, BLACK0, BLACK0, c, c);
    this.q(x0, ym, z, x1, ym, z, x1, y1, z, x0, y1, z, c, c, BLACK0, BLACK0);
  }
  /** A round post standing up (a fret wire): at x, depth z, from y0 to y1, radius r; `shades` from rodShades(hex, 'post'). */
  rodY(x, z, y0, y1, r, shades) {
    const n = shades.length - 1;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + (Math.PI * i) / n;
      const a1 = -Math.PI / 2 + (Math.PI * (i + 1)) / n;
      const xa = x + r * Math.sin(a0);
      const za = z - r * Math.cos(a0);
      const xb = x + r * Math.sin(a1);
      const zb = z - r * Math.cos(a1);
      this.q(xa, y0, za, xb, y0, zb, xb, y1, zb, xa, y1, za, shades[i], shades[i + 1], shades[i + 1], shades[i]);
    }
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
    // what changed since the last upload: the whole picture (at the start, after a clean-out) or the box
    // round the labels drawn since. 4.32.1: a new label sent only its own box, not the whole 4 MB picture
    // (that came every time a new fret number, chord name or streak count first showed: little freezes,
    // most of them in the first seconds of a song)
    this.whole = true;
    this.box = null;
    this.renderer = renderer;
    this.part = new THREE.Box2();
    this.at = new THREE.Vector2();
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
      this.whole = true;
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
    const b = this.box;
    if (!b) this.box = { x0: x, y0: y, x1: x + w, y1: y + h };
    else Object.assign(b, { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x + w), y1: Math.max(b.y1, y + h) });
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
      const b = this.box;
      if (this.whole || !b || !this.renderer || this.sendWhole) this.tex.needsUpdate = true;
      else {
        // only the new labels' box (canvas pictures are stored upside down: flipY)
        this.part.min.set(b.x0, this.size - b.y1);
        this.part.max.set(b.x1, this.size - b.y0);
        this.at.set(b.x0, this.size - b.y1);
        this.renderer.copyTextureToTexture(this.tex, this.tex, this.part, this.at);
      }
      this.whole = false;
      this.box = null;
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
uniform vec2 texel;    // one picture pixel in texture units
uniform float hasImg;
uniform vec2 res;      // CSS pixels
uniform float dpr;
uniform vec4 rect;     // picture placed at x, y, w, h (CSS pixels, from the top)
uniform float vp;      // where the highway's far end meets the floor (CSS px from top)
uniform float pulse;
uniform float heat;
uniform float gain;    // a look's brightness (1 = as is)
uniform float skyOn;   // a look's own room instead of the venue
uniform float fogK;    // 4.31: the style's fog also fills its room toward the horizon
uniform vec3 fogCol;
uniform vec3 sTop;
uniform vec3 sMid;
uniform vec3 sHor;
uniform vec3 sNear;
uniform vec3 sFar;
uniform vec3 keyCol;
uniform vec3 horCol;
uniform float pat;     // the floor: 0 plain, 1 faint lines across, 2 boards
uniform float patA;
uniform float keyK;    // a soft light behind the highway
uniform float horK;    // a band of light (haze) along the horizon …
uniform float horW;    // … and how tall it is (part of the screen height)
uniform float vx;      // where the floor's lines meet (CSS px from the left)
uniform float time;    // seconds, for a style's slow movement
uniform float amb;     // 1: the room moves (sun stripes, embers, beams, twinkling); 0: still
uniform float stars;   // a sky of faint stars
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = vec2(gl_FragCoord.x, res.y * dpr - gl_FragCoord.y) / dpr;
  vec3 c;
  if (hasImg > 0.5) {
    vec2 uv = (p - rect.xy) / rect.zw;
    uv = clamp(uv, vec2(0.0, 0.0), vec2(1.0, 0.999));
    vec2 tuv = vec2(uv.x, 1.0 - uv.y);
    c = texture2D(soft, tuv).rgb;
    // a light unsharp mask: the photos are stretched past their own size, which softens them
    vec3 b = (texture2D(soft, tuv + vec2(texel.x, 0.0)).rgb + texture2D(soft, tuv - vec2(texel.x, 0.0)).rgb
            + texture2D(soft, tuv + vec2(0.0, texel.y)).rgb + texture2D(soft, tuv - vec2(0.0, texel.y)).rgb) * 0.25;
    c = max(c + (c - b) * 0.6, 0.0);
    if (p.y < vp + res.y * 0.04) {
      vec3 l = texture2D(lit, tuv).rgb * min(0.35, pulse * 0.32);
      c = 1.0 - (1.0 - c) * (1.0 - l);
    }
  } else if (skyOn > 0.5) {
    float tm = time * amb;
    if (p.y < vp) {
      float u = clamp(p.y / max(1.0, vp), 0.0, 1.0);
      c = u < 0.6 ? mix(sTop, sMid, u / 0.6) : mix(sMid, sHor, (u - 0.6) / 0.4);
      if (stars > 0.5) {
        // faint stars, twinkling slowly
        vec2 cell = floor(p / 9.0);
        float h = hash2(cell);
        if (h > 0.985) {
          vec2 o = p - (cell + vec2(hash2(cell + 3.1), hash2(cell + 7.7)) * 0.8 + 0.1) * 9.0;
          float tw = 0.55 + 0.45 * sin(tm * (0.7 + h * 2.0) + h * 40.0);
          c += vec3(0.75, 0.85, 1.0) * (1.0 - smoothstep(0.3, 1.3, length(o))) * 0.35 * tw * (1.0 - u * 0.7);
        }
      }
      if (pat > 2.5 && pat < 3.5) {
        // a striped sun sinking into the horizon; its stripes roll down slowly
        float r = res.y * 0.15;
        vec2 d = p - vec2(vx, vp - r * 0.25);
        float dist = length(d);
        float up = -d.y / r;
        vec3 sun = mix(vec3(1.0, 0.3, 0.55), vec3(1.0, 0.8, 0.38), clamp(up * 0.6 + 0.4, 0.0, 1.0));
        float stripe = 1.0;
        if (up < 0.45) {
          float f = fract(up * 8.0 + tm * 0.25);
          stripe = smoothstep(0.0, 0.08, f - mix(0.6, 0.05, clamp((up + 0.25) / 0.7, 0.0, 1.0)));
        }
        float inSun = 1.0 - smoothstep(r - 1.5, r + 1.5, dist);
        c = mix(c, sun * (0.55 + 0.1 * pulse), inSun * stripe * 0.8);
        c += sun * 0.16 * exp(-max(0.0, dist - r) / (res.y * 0.07));
      }
      if (pat > 5.5) {
        // haze and light beams from the rig above, sweeping slowly; brighter on the beat
        for (int i = 0; i < 4; i++) {
          float fi = float(i);
          vec2 src = vec2(res.x * (0.14 + fi * 0.24), -res.y * 0.05);
          float ang = 0.32 * sin(tm * (0.23 + fi * 0.05) + fi * 1.9) + (fi - 1.5) * 0.1;
          vec2 dv = p - src;
          float a = atan(dv.x, dv.y);
          float k = exp(-pow((a - ang) / 0.045, 2.0)) * smoothstep(0.0, 0.5, dv.y / max(1.0, vp));
          c += keyCol * k * patA * 0.16 * (1.0 + pulse * 0.8);
        }
        c += keyCol * 0.035 * u;
      }
      if (pat > 4.5 && pat < 5.5) {
        // embers drifting up out of the cracks
        vec2 g = vec2(p.x / 26.0, p.y / 26.0 + tm * 0.9);
        vec2 id = floor(g);
        float h = hash2(id);
        if (h > 0.94) {
          vec2 f = fract(g) - vec2(0.5 + 0.3 * sin(tm + h * 30.0), 0.5);
          c += horCol * (1.0 - smoothstep(0.02, 0.14, length(f))) * 0.45 * u * (0.6 + 0.4 * sin(tm * 3.0 + h * 50.0));
        }
      }
    } else {
      float v = clamp((p.y - vp) / max(1.0, res.y - vp), 0.0, 1.0);
      c = mix(sFar, sNear, pow(v, 0.6));
      // the floor: depth across (1 at the bottom of the screen, growing toward the horizon) and
      // lines running off to the vanishing point (as a floor seen from the camera would have them)
      float gy = max(0.5, p.y - vp);
      float dep = res.y / gy * 0.35;
      float run = (p.x - vx) / gy * 0.9;
      float near = smoothstep(0.015, 0.2, v); // patterns fade out before the horizon (no shimmer)
      if (pat > 4.5 && pat < 5.5) {
        // charcoal with glowing cracks, hotter on the beat and on a streak
        vec2 q = vec2(run * 1.4, dep * 0.7);
        float n = abs(sin(q.x * 2.1 + sin(q.y * 1.7) * 2.0 + sin(q.y * 0.6 + q.x * 0.4) * 1.5));
        float cr = 1.0 - smoothstep(0.0, 0.06 + fwidth(n) * 1.5, n);
        c *= 0.9 + 0.1 * hash2(floor(q * 3.0));
        c += horCol * cr * patA * near * (0.35 + 0.4 * heat + 0.3 * pulse) * (0.8 + 0.2 * sin(tm * 1.3 + q.x));
      } else if (pat > 3.5 && pat < 4.5) {
        // drafting lines on the floor
        float fa = fwidth(dep) * 1.2;
        float fb = fwidth(run * 2.0) * 1.2;
        float la = 1.0 - smoothstep(0.0, fa, min(fract(dep), 1.0 - fract(dep)));
        float lb = 1.0 - smoothstep(0.0, fb, min(fract(run * 2.0), 1.0 - fract(run * 2.0)));
        c += horCol * patA * near * max(la, lb);
      } else if (pat > 2.5 && pat < 3.5) {
        // a pink grid rolling toward you, brighter on the beat
        float dd = dep + tm * 0.8;
        float fa = fwidth(dd) * 1.2;
        float fb = fwidth(run) * 1.2;
        float la = 1.0 - smoothstep(0.0, fa, min(fract(dd), 1.0 - fract(dd)));
        float lb = 1.0 - smoothstep(0.0, fb, min(fract(run), 1.0 - fract(run)));
        c += horCol * patA * near * max(la, lb) * (0.8 + 0.4 * pulse);
      } else if (pat > 5.5) {
        // a glossy stage floor catching the beams
        c += keyCol * 0.05 * (1.0 - v) * (1.0 + pulse);
      } else if (pat > 1.5) {
        // boards running away from you, their ends staggered
        float b = floor(run);
        float len = floor(dep * 0.5 + hash(b) * 3.0);
        c *= 0.88 + 0.14 * hash(b * 7.3 + len);
        float fs = fwidth(run) * 1.5;
        float seam = 1.0 - smoothstep(0.0, fs, min(fract(run), 1.0 - fract(run)));
        float fe = fwidth(dep * 0.5) * 1.5;
        float ends = 1.0 - smoothstep(0.0, fe, min(fract(dep * 0.5 + hash(b) * 3.0), 1.0 - fract(dep * 0.5 + hash(b) * 3.0)));
        c *= 1.0 - patA * near * max(seam, ends * 0.6);
      } else if (pat > 0.5) {
        float fa = fwidth(dep) * 1.2;
        float fb = fwidth(run) * 1.2;
        float la = 1.0 - smoothstep(0.0, fa, min(fract(dep), 1.0 - fract(dep)));
        float lb = 1.0 - smoothstep(0.0, fb, min(fract(run), 1.0 - fract(run)));
        c += horCol * patA * near * max(la, lb);
      }
      // the floor meets the sky in haze, not along a hard line
      c = mix(sHor, c, smoothstep(0.0, 0.06, v));
    }
    float kd = length((p - vec2(res.x * 0.5, vp)) / vec2(res.x * 0.42, res.y * 0.32));
    c += keyCol * keyK * exp(-kd * kd * 2.0);
    float hd = p.y - vp;
    c += horCol * horK * exp(-abs(hd) / (res.y * (hd < 0.0 ? horW : horW * 0.4)));
    c *= 1.0 + pulse * 0.12;
    if (pat > 3.5 && pat < 4.5) {
      // blueprint paper: a fine square grid over everything
      vec2 gm = abs(fract(p / 22.0 + 0.5) - 0.5) * 22.0;
      vec2 gM = abs(fract(p / 110.0 + 0.5) - 0.5) * 110.0;
      float lm = 1.0 - smoothstep(0.0, 1.0, min(gm.x, gm.y));
      float lM = 1.0 - smoothstep(0.0, 1.2, min(gM.x, gM.y));
      c += horCol * (lm * 0.35 + lM * 0.7) * patA;
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
  if (skyOn > 0.5 && fogK > 0.0) {
    float fz = 1.0 - clamp(abs(p.y - vp) / (res.y * 0.4), 0.0, 1.0);
    c = mix(c, fogCol, fogK * (0.35 + 0.55 * fz));
  }
  gl_FragColor = vec4(c * gain, 1.0);
}`;

function makeBackdrop(scene) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: BVS,
    fragmentShader: BFS,
    uniforms: {
      soft: { value: null },
      lit: { value: null },
      texel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
      hasImg: { value: 0 },
      res: { value: new THREE.Vector2(1, 1) },
      dpr: { value: 1 },
      rect: { value: new THREE.Vector4(0, 0, 1, 1) },
      vp: { value: 300 },
      pulse: { value: 0 },
      heat: { value: 0 },
      gain: { value: 1 },
      skyOn: { value: 0 },
      fogK: { value: 0 },
      fogCol: { value: new THREE.Color() },
      sTop: { value: new THREE.Color() },
      sMid: { value: new THREE.Color() },
      sHor: { value: new THREE.Color() },
      sNear: { value: new THREE.Color() },
      sFar: { value: new THREE.Color() },
      keyCol: { value: new THREE.Color() },
      horCol: { value: new THREE.Color() },
      pat: { value: 0 },
      patA: { value: 0 },
      keyK: { value: 0 },
      horK: { value: 0 },
      horW: { value: 0.006 },
      vx: { value: 0 },
      time: { value: 0 },
      amb: { value: 0 },
      stars: { value: 0 },
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

// ------------------------------------------------------- after-effects --
// Only used when a look or the graphics settings ask for one (bloom, FXAA, a different edge smoothing,
// distance blur, vignette, grain). The scene is drawn into a picture of the same size, worked on, and
// put on screen in the same frame: no frame of delay. Text is drawn after, untouched.
const PVS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const PFS = /* glsl */ `
uniform sampler2D src;
uniform vec2 px;      // one pixel in texture units
uniform float fxaa;
uniform float dof;    // 0 or 1: soften the far end around the horizon
uniform float vpUv;   // the horizon, from the bottom (0..1)
uniform float vig;
uniform float grain;
uniform float time;
uniform float keepA;  // a moving background behind: keep the picture see-through where nothing is drawn
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 fx(vec2 uv) {
  vec3 m = texture2D(src, uv).rgb;
  if (fxaa < 0.5) return m;
  // FXAA (after Timothy Lottes): blur only across edges that stand out from their neighbours
  vec3 nw = texture2D(src, uv + vec2(-1.0, -1.0) * px).rgb;
  vec3 ne = texture2D(src, uv + vec2(1.0, -1.0) * px).rgb;
  vec3 sw = texture2D(src, uv + vec2(-1.0, 1.0) * px).rgb;
  vec3 se = texture2D(src, uv + vec2(1.0, 1.0) * px).rgb;
  float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se), lM = luma(m);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return m;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (texture2D(src, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(src, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(src, uv - dir * 0.5).rgb + texture2D(src, uv + dir * 0.5).rgb);
  float lB = luma(b);
  return (lB < lMin || lB > lMax) ? a : b;
}
void main() {
  vec3 c = fx(vUv);
  float a = keepA > 0.5 ? clamp(texture2D(src, vUv).a, 0.0, 1.0) : 1.0;
  if (dof > 0.5) {
    // strongest at and above the horizon, gone a quarter of the screen below it
    // 4.31: reaches further down the far highway, and blurs wider (it was hardly visible)
    float k = smoothstep(vpUv - 0.3, vpUv - 0.02, vUv.y);
    if (k > 0.01) {
      vec4 b = vec4(0.0);
      for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) b += texture2D(src, vUv + vec2(float(i), float(j)) * px * 3.0);
      c = mix(c, b.rgb / 25.0, k * 0.85);
      if (keepA > 0.5) a = mix(a, clamp(b.a / 25.0, 0.0, 1.0), k * 0.85);
    }
  }
  if (vig > 0.5) {
    float d = distance(vUv, vec2(0.5, 0.5));
    float v = 1.0 - 0.5 * smoothstep(0.3, 0.8, d);
    c *= v;
    // over a moving background the corners darken it too: less of it shows through
    if (keepA > 0.5) a = 1.0 - (1.0 - a) * v;
  }
  if (grain > 0.5) {
    float n = fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) * 0.08 * a;
  }
  gl_FragColor = vec4(c, a);
}`;

function makePost(renderer) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: PVS,
    fragmentShader: PFS,
    uniforms: { src: { value: null }, px: { value: new THREE.Vector2() }, fxaa: { value: 0 }, dof: { value: 0 }, vpUv: { value: 0.6 }, vig: { value: 0 }, grain: { value: 0 }, time: { value: 0 }, keepA: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const qScene = new THREE.Scene();
  qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let rt = null;
  let samples = -1;
  let bloom = null;
  let bloomKey = '';
  const size = new THREE.Vector2();
  return {
    mat,
    /** Draws `scene` through the after-effects onto the screen. o: { samples, fxaa, bloom, dof, vpUv, vignette, grain } */
    render(scene, camera, o) {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(1, size.x);
      const h = Math.max(1, size.y);
      if (!rt || samples !== o.samples) {
        if (rt) rt.dispose();
        rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: o.samples, depthBuffer: true });
        rt.texture.colorSpace = THREE.NoColorSpace;
        samples = o.samples;
      } else if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
      if (o.bloom) {
        const bw = o.bloom.half ? Math.round(w / 2) : w;
        const bh = o.bloom.half ? Math.round(h / 2) : h;
        const key = `${bw}x${bh}`;
        if (!bloom) {
          bloom = new UnrealBloomPass(new THREE.Vector2(bw, bh), 1, 0.4, 0.8);
          // add the light but keep the picture's own alpha, so a moving background still shows
          // through (where the picture is solid this is the same as before)
          const bm = bloom.blendMaterial;
          bm.blending = THREE.CustomBlending;
          bm.blendEquation = THREE.AddEquation;
          bm.blendSrc = THREE.SrcAlphaFactor;
          bm.blendDst = THREE.OneFactor;
          bm.blendSrcAlpha = THREE.ZeroFactor;
          bm.blendDstAlpha = THREE.OneFactor;
        }
        if (key !== bloomKey) {
          bloom.setSize(bw, bh);
          bloomKey = key;
        }
        bloom.strength = o.bloom.strength;
        bloom.radius = o.bloom.radius;
        bloom.threshold = o.bloom.threshold;
        bloom.render(renderer, null, rt, 0, false);
      }
      const u = mat.uniforms;
      u.src.value = rt.texture;
      u.px.value.set(1 / w, 1 / h);
      u.fxaa.value = o.fxaa ? 1 : 0;
      u.dof.value = o.dof ? 1 : 0;
      u.vpUv.value = o.vpUv;
      u.vig.value = o.vignette ? 1 : 0;
      u.grain.value = o.grain ? 1 : 0;
      u.time.value = (performance.now() / 1000) % 100;
      u.keepA.value = o.keepAlpha ? 1 : 0;
      renderer.setRenderTarget(null);
      renderer.render(qScene, qCam);
    },
    dispose() {
      if (rt) rt.dispose();
      rt = null;
      if (bloom) bloom.dispose();
      bloom = null;
      bloomKey = '';
      samples = -1;
    },
  };
}

/** A hex colour into a three.js colour as is (the colours here are sRGB already: no conversion). */
function setHex(c, hex) {
  const n = parseInt(String(hex).slice(1), 16);
  c.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace);
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
    p.soft = mk(w, h, 'brightness(0.8) saturate(0.92)'); // 3.7: no blur on the picture itself (user: a little sharper)
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
    // alpha: the Fluid venue shows through from behind (another page under this canvas)
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    console.warn('Highway: WebGL unavailable', err);
    return null;
  }
  renderer.setClearColor(0x05070c, 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // colours are given as sRGB already
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.info.autoReset = false; // the scene and its labels are two passes: count both
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
  const backMesh = scene.children[scene.children.length - 1];
  let seeThrough = false;
  // what a look changes in every layer (shared): fog amount and colour
  const lookU = { fogK: { value: 0 }, fogCol: { value: new THREE.Color(0, 0, 0) } };
  const L = {
    floor: new Layer(scene, { order: 0, look: lookU }),
    solid: new Layer(scene, { order: 2, depthWrite: true, look: lookU }),
    alpha: new Layer(scene, { order: 3, look: lookU }),
    glow: new Layer(scene, { order: 4, additive: true, look: lookU }),
    // the glow layer's soft lights (halos, bands, rings), so a look can turn them up or down on their own
    soft: new Layer(scene, { order: 4, additive: true, look: lookU }),
    // 4.31: a style's own touches that are not the notes or the neck: hit effects, slow movement
    fx: new Layer(scene, { order: 5, additive: true, look: lookU }),
  };
  L.glow.softTo = L.soft;
  // a look's mirror floor: the notes, strings and frets (and with "full" their glow) upside down under it
  const mirrors = { solid: L.solid.mirrorIn(scene), glow: L.glow.mirrorIn(scene) };
  // text is drawn last, on its own, so no after-effect, fog or brightness ever touches a label
  const textScene = new THREE.Scene();
  const text = new TextLayer(textScene, renderer);
  const post = makePost(renderer);
  let look = null; // the look in use (from hwlooks.resolveLook); null = Classic as it always was
  let usePost = false;
  let vpUv = 0.6;

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
    mirror: false,
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
    /** Render at a fraction of full resolution (or above it, 4.17: a fast PC sharpens the picture up to 1.5x). */
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
      // the Fluid venue lives behind this canvas: draw no backdrop, clear to transparent
      u.time.value = (performance.now() / 1000) % 1000;
      const fluid = !!(v && v.fluid);
      if (fluid !== seeThrough) {
        seeThrough = fluid;
        backMesh.visible = !fluid;
        renderer.setClearColor(0x05070c, fluid ? 0 : 1);
      }
      if (fluid) return;
      const p = v && v.photo ? photoTextures(v.photo) : null;
      if (!p || !p.ready) {
        u.hasImg.value = 0;
        return;
      }
      u.hasImg.value = 1;
      u.soft.value = p.soft;
      u.lit.value = p.lit;
      u.texel.value.set(1 / p.w, 1 / p.h);
      const sc = Math.max((W * 1.08) / p.w, (H / p.h) * 0.85, vp / (v.horizon * p.h));
      const dw = p.w * sc;
      const dh = p.h * sc;
      const room = (dw - W) / 2;
      u.rect.value.set(-room + Math.max(-1, Math.min(1, shift || 0)) * room * 0.6, vp - v.horizon * dh, dw, dh);
    },
    /**
     * A look (hwlooks.resolveLook): brightness, glow, fog, the look's own room, reflections and
     * after-effects. Colours and light only: nothing here moves anything.
     */
    setLook(lk) {
      look = lk || null;
      const g = look ? look.bright : 1;
      for (const k of ['floor', 'solid', 'alpha', 'glow', 'fx']) L[k].mat.uniforms.gain.value = g;
      L.soft.mat.uniforms.gain.value = g * (look ? look.glowK : 1);
      lookU.fogK.value = look ? look.fogK : 0;
      setHex(lookU.fogCol.value, look ? look.fogCol : '#000000');
      const u = back.uniforms;
      u.gain.value = g;
      const sky = look && look.sky;
      u.skyOn.value = sky ? 1 : 0;
      u.fogK.value = look ? look.fogK : 0;
      setHex(u.fogCol.value, look ? look.fogCol : '#000000');
      if (sky) {
        setHex(u.sTop.value, sky.top);
        setHex(u.sMid.value, sky.mid);
        setHex(u.sHor.value, sky.hor);
        setHex(u.sNear.value, sky.near);
        setHex(u.sFar.value, sky.far);
        setHex(u.keyCol.value, sky.keyCol);
        setHex(u.horCol.value, sky.horCol);
        u.pat.value = sky.pattern;
        u.patA.value = sky.patA;
        u.keyK.value = sky.key;
        u.horK.value = sky.horLine;
        u.horW.value = sky.horW || 0.006;
        u.stars.value = sky.stars ? 1 : 0;
      }
      u.amb.value = look && look.amb ? 1 : 0;
      const mir = !!look && look.refl === 'mirror';
      mirrors.solid.visible = mir;
      mirrors.glow.visible = mir;
      // 4.31: strong enough to read as a mirror floor (it was hardly visible)
      mirrors.solid.material.uniforms.reflK.value = look ? look.reflK * 2.4 : 0;
      mirrors.glow.material.uniforms.reflK.value = look ? look.reflK * 1.5 : 0;
      R.mirror = mir;
      const aaPost = look && (look.aa === 'off' || look.aa === 'fxaa' || look.aa === 'msaa8');
      // 4.31: also over a moving background (the after-effects keep it showing through)
      usePost = !!look && !!(look.bloom || aaPost || look.dof || look.grain || look.vignette);
      if (!usePost) post.dispose();
    },
    /** The horizon's height on screen (CSS px from the top), for the distance blur. */
    setHorizon(y, x = W / 2) {
      vpUv = 1 - y / Math.max(1, H);
      back.uniforms.vx.value = x;
    },
    get post() {
      return usePost;
    },
    begin() {
      for (const k in L) L[k].begin();
      text.begin();
    },
    render(zFar, zPast) {
      for (const k in L) L[k].end(zFar, zPast);
      text.end(W, H);
      renderer.info.reset();
      if (usePost) {
        const aa = look.aa;
        const max = renderer.capabilities.maxSamples || 4;
        post.render(scene, camera, { samples: aa === 'msaa8' ? Math.min(8, max) : aa === 'msaa4' ? Math.min(4, max) : 0, fxaa: aa === 'fxaa', bloom: look.bloom, dof: look.dof, vpUv, vignette: look.vignette, grain: look.grain, keepAlpha: seeThrough });

      } else renderer.render(scene, camera);
      // the labels on top, never touched by the after-effects
      renderer.autoClear = false;
      renderer.render(textScene, camera);
      renderer.autoClear = true;
    },
    info() {
      return { quads: Object.fromEntries(Object.entries(L).map(([k, l]) => [k, l.n])), text: text.n, calls: renderer.info.render.calls };
    },
  };
  return R;
}
