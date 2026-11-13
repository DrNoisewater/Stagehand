/**
 * The guitar highway in 3D for the headset (4.16, step 2): plain WebGL2, no library.
 * The same scene draws into a page (a preview, a fixed camera) or into each eye in VR.
 *
 * World (metres; you stand at 0,0,0 looking down −z): the strings run across in front
 * of you at hand height, the frets left to right, and the notes come at you from far
 * away along their string, like Rocksmith. The neck glides sideways to follow your
 * hand (the room never moves, only the highway in it).
 */
import { mul, translate, rotX } from './mat.js';
import { lower, handAt, anchorAt } from './chart.js';

export const STRING = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];
const FRET_W = 0.1; // one fret, in metres
const SPEED = 1.35; // metres per song second
const AHEAD = 3.6; // seconds of notes shown
const STR_GAP = 0.052;

const rgb = (hex, a = 1) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
};
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];

// --------------------------------------------------------------- shaders --
const BOX_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNorm;
layout(location=2) in vec3 iPos; layout(location=3) in vec3 iSize; layout(location=4) in vec4 iCol; layout(location=5) in float iGlow;
uniform mat4 uVP; uniform mat4 uModel;
out vec3 vN; out vec4 vC; out float vG; out float vZ;
void main(){ vec4 w = uModel * vec4(iPos + aPos * iSize, 1.0); gl_Position = uVP * w; vN = mat3(uModel) * aNorm; vC = iCol; vG = iGlow; vZ = iPos.z + aPos.z * iSize.z; }`;
const BOX_FS = `#version 300 es
precision mediump float;
in vec3 vN; in vec4 vC; in float vG; in float vZ; uniform float uFar; uniform float uFade; out vec4 o;
void main(){ float l = 0.55 + 0.45 * max(dot(normalize(vN), normalize(vec3(0.3, 0.9, 0.6))), 0.0);
  vec3 c = vC.rgb * (l + vG) + vec3(vG * 0.35);
  float fade = uFade > 0.5 ? smoothstep(0.0, 0.35, clamp(1.0 + vZ / uFar, 0.0, 1.0)) : 1.0;
  o = vec4(c, vC.a * fade); }`;
const TEX_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 iPos; layout(location=2) in vec2 iSize; layout(location=3) in vec4 iUV; layout(location=4) in vec4 iCol;
uniform mat4 uVP; uniform mat4 uModel; out vec2 vUV; out vec4 vC;
void main(){ vec3 p = iPos + vec3(aPos * iSize, 0.0); gl_Position = uVP * uModel * vec4(p, 1.0); vUV = mix(iUV.xy, iUV.zw, aPos * vec2(1.0, -1.0) + vec2(0.5)); vC = iCol; }`;
const TEX_FS = `#version 300 es
precision mediump float; in vec2 vUV; in vec4 vC; uniform sampler2D uTex; out vec4 o;
void main(){ vec4 t = texture(uTex, vUV); o = t * vC; }`;
const SKY_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; uniform mat4 uVP; out vec2 vUV; out float vY;
void main(){ gl_Position = uVP * vec4(aPos, 1.0); vUV = aUV; vY = aPos.y; }`;
const SKY_FS = `#version 300 es
precision mediump float; in vec2 vUV; in float vY; uniform sampler2D uTex; uniform float uHas; uniform float uDim; out vec4 o;
void main(){ vec3 base = mix(vec3(0.05,0.045,0.05), vec3(0.11,0.08,0.06), clamp(vUV.y, 0.0, 1.0));
  vec3 c = uHas > 0.5 ? texture(uTex, vUV).rgb * uDim : base;
  o = vec4(c, 1.0); }`;

function program(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

/** A unit cube centred on 0 (positions and normals). */
function cube() {
  const f = [
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  ];
  const v = [];
  for (const [n, u, w] of f) {
    const c = (a, b) => [n[0] * 0.5 + u[0] * a + w[0] * b, n[1] * 0.5 + u[1] * a + w[1] * b, n[2] * 0.5 + u[2] * a + w[2] * b];
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) v.push(...c(a, b), ...n);
  }
  return new Float32Array(v);
}

/** A growing instance buffer: push(...) then upload. */
class Batch {
  constructor(stride) {
    this.stride = stride;
    this.data = new Float32Array(stride * 512);
    this.n = 0;
  }
  reset() {
    this.n = 0;
  }
  push(...vals) {
    if ((this.n + 1) * this.stride > this.data.length) {
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    this.data.set(vals, this.n * this.stride);
    this.n++;
  }
}

export function createStage(gl, opts = {}) {
  const boxP = program(gl, BOX_VS, BOX_FS);
  const texP = program(gl, TEX_VS, TEX_FS);
  const skyP = program(gl, SKY_VS, SKY_FS);

  // boxes: one cube, many instances (position 3, size 3, colour 4, glow 1)
  const boxVao = gl.createVertexArray();
  gl.bindVertexArray(boxVao);
  const cubeBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, cube(), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  const boxInst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, boxInst);
  const BS = 11;
  [[2, 3, 0], [3, 3, 3], [4, 4, 6], [5, 1, 10]].forEach(([loc, size, off]) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, BS * 4, off * 4);
    gl.vertexAttribDivisor(loc, 1);
  });
  gl.bindVertexArray(null);

  // textured quads (position 3, size 2, uv 4, colour 4)
  const texVao = gl.createVertexArray();
  gl.bindVertexArray(texVao);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  const texInst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texInst);
  const TS = 13;
  [[1, 3, 0], [2, 2, 3], [3, 4, 5], [4, 4, 9]].forEach(([loc, size, off]) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, TS * 4, off * 4);
    gl.vertexAttribDivisor(loc, 1);
  });
  gl.bindVertexArray(null);

  // the venue: a tall curved screen around the front of you, and a floor
  const sky = (() => {
    const v = [];
    const R = 9, y0 = -0.5, y1 = 7.5, arc = (200 * Math.PI) / 180, seg = 48;
    for (let i = 0; i < seg; i++) {
      const a0 = -arc / 2 + (arc * i) / seg, a1 = -arc / 2 + (arc * (i + 1)) / seg;
      const p = (a, y) => [Math.sin(a) * R, y, -Math.cos(a) * R];
      const u0 = i / seg, u1 = (i + 1) / seg;
      const q = [[p(a0, y0), [u0, 1]], [p(a1, y0), [u1, 1]], [p(a1, y1), [u1, 0]], [p(a0, y0), [u0, 1]], [p(a1, y1), [u1, 0]], [p(a0, y1), [u0, 0]]];
      for (const [pos, uv] of q) v.push(...pos, ...uv);
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    return { vao, count: v.length / 5, tex: null, has: false };
  })();

  // fret numbers: one texture of the numbers 0–24
  const digits = (() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.font = '700 46px Archivo, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i <= 24; i++) g.fillText(String(i), i * 40 + 20, 34);
    return { tex: texture(c), cell: 40 / 1024 };
  })();

  function texture(src) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // the panel above the highway: the song, your score, the words being sung
  const panel = (() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    return { c, g: c.getContext('2d'), tex: null, key: '' };
  })();
  function drawPanel(info) {
    const key = JSON.stringify(info);
    if (key === panel.key) return;
    panel.key = key;
    const { g, c } = panel;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(14,14,16,0.86)';
    g.beginPath();
    g.roundRect(8, 8, c.width - 16, c.height - 16, 28);
    g.fill();
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#eceef6';
    g.font = '800 54px Archivo, system-ui, sans-serif';
    g.fillText(fit(g, info.title || '', 640), 40, 86);
    g.fillStyle = '#97a3aa';
    g.font = '500 34px Archivo, system-ui, sans-serif';
    g.fillText(fit(g, info.sub || '', 640), 40, 134);
    g.textAlign = 'right';
    g.fillStyle = '#ffc978';
    g.font = '800 70px Archivo, system-ui, sans-serif';
    g.fillText(info.acc == null ? '' : `${Math.round(info.acc * 100)}%`, c.width - 40, 98);
    g.fillStyle = '#97a3aa';
    g.font = '600 28px Archivo, system-ui, sans-serif';
    g.fillText(info.acc == null ? '' : info.streak ? `streak ${info.streak}` : 'accuracy', c.width - 40, 138);
    g.textAlign = 'left';
    if (info.words) {
      g.fillStyle = '#ffffff';
      g.font = '700 40px Archivo, system-ui, sans-serif';
      g.fillText(fit(g, info.words, c.width - 80), 40, 206);
    } else if (info.note) {
      g.fillStyle = '#97a3aa';
      g.font = '600 32px Archivo, system-ui, sans-serif';
      g.fillText(fit(g, info.note, c.width - 80), 40, 206);
    }
    if (!panel.tex) panel.tex = texture(c);
    else {
      gl.bindTexture(gl.TEXTURE_2D, panel.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  }
  function fit(g, s, w) {
    if (g.measureText(s).width <= w) return s;
    while (s.length > 1 && g.measureText(s + '…').width > w) s = s.slice(0, -1);
    return s + '…';
  }

  /** The venue's photo (a URL); null for the plain dark room. */
  function setVenue(url) {
    if (!url) {
      sky.has = false;
      return;
    }
    const img = new Image();
    img.onload = () => {
      sky.tex = sky.tex || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sky.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      sky.has = true;
    };
    img.src = url;
  }

  // ------------------------------------------------------------ the song --
  const S = { chart: null, targets: [], results: null, strings: 6, lowTop: true, hand: NaN, sparks: [], flashes: new Map(), comfort: { dist: 1.0, height: 1.05, tilt: 0.18 } };
  const solid = new Batch(BS);
  const glow = new Batch(BS);
  const labels = new Batch(TS);

  function setChart(chart, targets, results) {
    S.chart = chart;
    S.targets = targets || [];
    S.results = results;
    S.strings = chart && chart.strings ? chart.strings : chart && chart.type === 'bass' ? 4 : 6;
    S.hand = NaN;
    S.sparks = [];
  }
  /** A note the PC judged: a flash and sparks on a hit. */
  function judged(id, hit, now) {
    const tg = S.targets[id];
    if (!tg) return;
    S.flashes.set(id, { hit, at: now });
    if (!hit) return;
    for (const n of tg.notes)
      for (let k = 0; k < 6; k++) S.sparks.push({ s: n.s, f: n.f, at: now, vx: (Math.random() - 0.5) * 0.9, vy: 0.4 + Math.random() * 0.8, vz: (Math.random() - 0.2) * 0.5, life: 0.35 + Math.random() * 0.25 });
  }

  const strY = (s) => (S.lowTop ? S.strings - 1 - s : s) * STR_GAP; // low E on top, like Rocksmith
  const fretX = (k) => (k - S.hand) * FRET_W; // a fret wire
  const noteX = (f) => (f === 0 ? null : fretX(f - 0.5));

  /** Builds this frame's boxes. t: song time (s); now: ms for flashes. */
  function build(t, now, dt) {
    solid.reset();
    glow.reset();
    labels.reset();
    const C = S.chart;
    const anchors = (C && C.anchors) || [];
    const want = C ? handAt(anchors, t) : 6;
    S.hand = Number.isFinite(S.hand) ? S.hand + (want - S.hand) * Math.min(1, dt * 2.2) : want;
    const anc = anchorAt(anchors, t);
    const n = S.strings;
    const lo = Math.max(0, Math.floor(S.hand - 6)), hi = Math.min(24, Math.ceil(S.hand + 6));
    const far = AHEAD * SPEED;
    const yTop = (n - 1) * STR_GAP;
    const floorY = -0.05;

    // the lane: a dark floor under the strings, the hand's frets lit
    solid.push((fretX(lo) + fretX(hi)) / 2, floorY - 0.012, -far / 2, fretX(hi) - fretX(lo), 0.01, far, 0.13, 0.12, 0.12, 0.92, 0.02);
    const a0 = Math.max(0, anc.fret - 1), a1 = a0 + (anc.width || 4);
    glow.push((fretX(a0) + fretX(a1)) / 2, floorY - 0.004, -far / 2, fretX(a1) - fretX(a0), 0.004, far, 1, 0.71, 0.28, 0.1, 0.2);
    // fret lines down the lane and the fret wires at the neck
    for (let k = lo; k <= hi; k++) {
      const x = fretX(k);
      const inHand = k >= a0 && k <= a1;
      solid.push(x, floorY - 0.004, -far / 2, 0.004, 0.004, far, inHand ? 0.55 : 0.28, inHand ? 0.45 : 0.27, inHand ? 0.3 : 0.3, 1, inHand ? 0.25 : 0);
      solid.push(x, yTop / 2, 0, 0.006, yTop + 0.06, 0.006, 0.75, 0.75, 0.78, 1, 0.1);
      if (k > 0) {
        const cell = digits.cell;
        const fx = fretX(k - 0.5);
        const lit = k > a0 && k <= a1;
        labels.push(fx, floorY - 0.05, 0.03, 0.05, 0.05, k * cell, 0, (k + 1) * cell, 1, lit ? 1 : 0.6, lit ? 0.8 : 0.6, lit ? 0.45 : 0.62, lit ? 1 : 0.7);
      }
    }
    // the beats: lines across the lane, the bar lines brighter
    const beats = (C && C.beats) || [];
    for (let i = lower(beats, t - 0.1); i < beats.length && beats[i].t < t + AHEAD; i++) {
      const z = -(beats[i].t - t) * SPEED;
      const bar = beats[i].m >= 0;
      solid.push((fretX(lo) + fretX(hi)) / 2, floorY - 0.002, z, fretX(hi) - fretX(lo), 0.003, bar ? 0.012 : 0.006, bar ? 0.5 : 0.3, bar ? 0.45 : 0.28, bar ? 0.4 : 0.3, 1, bar ? 0.2 : 0);
    }
    // the strings
    for (let s = 0; s < n; s++) {
      const c = rgb(STRING[s]);
      solid.push((fretX(lo) + fretX(hi)) / 2, strY(s), 0, fretX(hi) - fretX(lo), 0.008 - s * 0.0006 + (n === 4 ? 0.002 : 0), 0.008, c[0], c[1], c[2], 1, 0.35);
    }

    // the notes, far to near
    const T = S.targets;
    for (let i = lower(T, t - 0.25); i < T.length && T[i].t < t + AHEAD; i++) {
      const tg = T[i];
      const z = -(tg.t - t) * SPEED;
      const fl = S.flashes.get(tg.id);
      const res = S.results ? S.results.get(tg.id) : null;
      const passed = tg.t < t;
      const missed = res && !res.hit;
      const hitNow = res && res.hit;
      if (passed && !tg.sus) {
        if (t - tg.t > 0.12) continue;
      }
      const chordFrets = tg.notes.filter((x) => x.f > 0).map((x) => x.f);
      if (tg.notes.length > 1) {
        // a chord: a frame around it, from the string on top to the lane
        const cl = chordFrets.length ? Math.min(...chordFrets) - 1 : a0, ch = chordFrets.length ? Math.max(...chordFrets) : a1;
        const fx0 = fretX(cl), fx1 = fretX(ch);
        const fc = missed ? [0.4, 0.4, 0.42, 0.5] : [1, 0.9, 0.75, 0.55];
        solid.push(fx0, yTop / 2, z, 0.006, yTop + 0.03, 0.006, ...fc, 0.2);
        solid.push(fx1, yTop / 2, z, 0.006, yTop + 0.03, 0.006, ...fc, 0.2);
        solid.push((fx0 + fx1) / 2, yTop + 0.015, z, fx1 - fx0, 0.006, 0.006, ...fc, 0.2);
        solid.push((fx0 + fx1) / 2, floorY, z, fx1 - fx0, 0.006, 0.006, ...fc, 0.2);
      }
      for (const nt of tg.notes) {
        if (nt.s >= n) continue;
        const base = rgb(STRING[nt.s]);
        const col = missed ? [0.35, 0.35, 0.38, 1] : base;
        const near = Math.max(0, 1 - Math.abs(tg.t - t) / 0.25);
        const flash = fl && now - fl.at < 250 && fl.hit ? 1 - (now - fl.at) / 250 : 0;
        const y = strY(nt.s);
        const g = 0.15 + near * 0.6 + flash * 1.4 + (hitNow ? 0.3 : 0);
        if (nt.f === 0) {
          // an open string: a bar across the hand's frets
          const x0 = fretX(a0), x1 = fretX(a1);
          if (!passed) solid.push((x0 + x1) / 2, y, z, x1 - x0, 0.018, 0.022, ...col, g);
        } else {
          const x = noteX(nt.f);
          if (!passed || flash > 0) {
            solid.push(x, y, z, FRET_W * 0.8, 0.044, 0.036, ...(nt.mute ? [0.8, 0.8, 0.82, 1] : col), g);
            // a halo round it, brighter as it arrives
            glow.push(x, y, z, FRET_W * 0.95, 0.06, 0.012, ...base.slice(0, 3), 0.18 + near * 0.4 + flash, 0.8);
          }
          // the stem down to the lane: where the note is, at a glance
          if (!passed && z < -0.05) solid.push(x, (floorY + y) / 2, z, 0.005, y - floorY, 0.005, col[0] * 0.6, col[1] * 0.6, col[2] * 0.6, 0.85, 0);
          if (!passed && near > 0) glow.push(x, floorY, 0, FRET_W * 0.8, 0.004, 0.06, ...base.slice(0, 3), near * 0.5, 0.6);
        }
        // a held note: its tail along the string
        const sus = nt.sus ?? tg.sus;
        if (sus > 0.05) {
          const zs = Math.min(0, -(tg.t - t) * SPEED), ze = -(tg.t + sus - t) * SPEED;
          if (ze < 0) {
            const x = nt.f === 0 ? (fretX(a0) + fretX(a1)) / 2 : noteX(nt.f);
            const w = nt.f === 0 ? fretX(a1) - fretX(a0) : FRET_W * 0.3;
            glow.push(x, y, (zs + ze) / 2, w, 0.012, zs - ze, ...base.slice(0, 3), hitNow ? 0.85 : 0.5, hitNow ? 0.9 : 0.3);
          }
        }
      }
    }
    // sparks off a hit
    S.sparks = S.sparks.filter((p) => (now - p.at) / 1000 < p.life);
    for (const p of S.sparks) {
      const k = (now - p.at) / 1000;
      const c = rgb(STRING[p.s] || '#ffffff');
      glow.push(noteX(p.f || 1) + p.vx * k, strY(p.s) + p.vy * k - 1.2 * k * k, p.vz * k, 0.01, 0.01, 0.01, ...c.slice(0, 3), 1 - k / p.life, 1.5);
    }
  }

  function model() {
    const c = S.comfort;
    return mul(translate(0, c.height, -c.dist), rotX(-c.tilt));
  }

  /** Draws one view. vp: projection × view. */
  function drawView(vp, { ar = false, panelInfo = null } = {}) {
    const M = model();
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    if (!ar) {
      gl.useProgram(skyP.p);
      gl.uniformMatrix4fv(skyP.u.uVP, false, vp);
      gl.uniform1f(skyP.u.uHas, sky.has ? 1 : 0);
      gl.uniform1f(skyP.u.uDim, 0.55);
      if (sky.has) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sky.tex);
        gl.uniform1i(skyP.u.uTex, 0);
      }
      gl.bindVertexArray(sky.vao);
      gl.drawArrays(gl.TRIANGLES, 0, sky.count);
    }
    gl.useProgram(boxP.p);
    gl.uniformMatrix4fv(boxP.u.uVP, false, vp);
    gl.uniform1f(boxP.u.uFar, AHEAD * SPEED);
    gl.bindVertexArray(boxVao);
    if (!ar) {
      // the stage floor under you
      gl.uniformMatrix4fv(boxP.u.uModel, false, translate(0, 0, 0));
      gl.uniform1f(boxP.u.uFade, 0);
      floor.reset();
      floor.push(0, -0.01, -3, 14, 0.02, 14, 0.06, 0.055, 0.06, 1, 0);
      upload(boxInst, floor);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, floor.n);
    }
    gl.uniformMatrix4fv(boxP.u.uModel, false, M);
    gl.uniform1f(boxP.u.uFade, 1);
    gl.enable(gl.BLEND);
    // colour blends; what's behind (passthrough) only shows where nothing is drawn
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    upload(boxInst, solid);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, solid.n);
    gl.depthMask(false);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    upload(boxInst, glow);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, glow.n);
    // the numbers and the panel
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(texP.p);
    gl.uniformMatrix4fv(texP.u.uVP, false, vp);
    gl.uniformMatrix4fv(texP.u.uModel, false, M);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(texP.u.uTex, 0);
    gl.bindVertexArray(texVao);
    gl.bindTexture(gl.TEXTURE_2D, digits.tex);
    upload(texInst, labels);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, labels.n);
    if (panelInfo) {
      drawPanel(panelInfo);
      const p = new Batch(TS);
      const yTop = (S.strings - 1) * STR_GAP;
      p.push(0, yTop + 0.3, -0.9, 1.0, 0.25, 0, 0, 1, 1, 1, 1, 1, 1);
      gl.bindTexture(gl.TEXTURE_2D, panel.tex);
      upload(texInst, p);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, p.n);
    }
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }
  const floor = new Batch(BS);
  function upload(buf, batch) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.n * batch.stride), gl.STREAM_DRAW);
  }

  return { S, setChart, setVenue, judged, build, drawView, model, counts: () => ({ solid: solid.n, glow: glow.n, labels: labels.n }) };
}
