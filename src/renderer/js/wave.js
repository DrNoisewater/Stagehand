/**
 * Waveform drawing. Each lane renders its shape once into an offscreen mask
 * (a wider-than-visible strip when zoomed, so scrolling just slides it), then
 * tints it for the played / unplayed parts. Per frame it only blits two
 * images, which keeps 60 fps animation cheap even with seven lanes.
 */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  return c;
}

/** Aggregates min/max/rms for a frame range from the peak pyramid. */
function pickLevel(levels, framesPerPx) {
  let lvl = levels[0];
  for (const l of levels) if (l.size <= framesPerPx) lvl = l;
  return lvl;
}

export class WaveLane {
  constructor(canvas, palette) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.palette = palette;
    this.peaks = null;
    this.duration = 0;
    this.cache = null;
    this.tint = null;
    this.gain = 1;
    this.dimmed = false;
    this.revealAt = 0;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
  }

  setPalette(p) {
    this.palette = p;
    this.tint = null;
  }

  setPeaks(peaks, duration) {
    this.peaks = peaks;
    this.duration = duration;
    this.cache = null;
    this.tint = null;
    this.revealAt = performance.now();
  }

  clear() {
    this.peaks = null;
    this.cache = null;
    this.tint = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.cache = null;
      this.tint = null;
    }
    this.dpr = dpr;
    this.w = w;
    this.h = h;
  }

  _build(view) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const span = view.end - view.start;
    const spp = span / W;
    const zoomed = span < this.duration - 1e-3;
    const c0 = zoomed ? Math.max(0, view.start - span) : view.start;
    const c1 = zoomed ? Math.min(this.duration, view.end + span) : view.end;
    const cw = Math.max(1, Math.ceil((c1 - c0) / spp));
    const mask = makeCanvas(cw, H);
    const g = mask.getContext('2d');
    const { levels, sampleRate } = this.peaks;
    const fpp = spp * sampleRate;
    const lvl = pickLevel(levels, fpp);
    const n = lvl.min.length;
    const mid = H / 2;
    const amp = (H / 2) * 0.94;
    const top = new Float32Array(cw);
    const bot = new Float32Array(cw);
    const rms = new Float32Array(cw);
    for (let x = 0; x < cw; x++) {
      const f0 = (c0 + x * spp) * sampleRate;
      let b0 = Math.floor(f0 / lvl.size);
      let b1 = Math.ceil((f0 + fpp) / lvl.size);
      if (b1 <= b0) b1 = b0 + 1;
      if (b0 >= n) break;
      b1 = Math.min(n, b1);
      let lo = 0;
      let hi = 0;
      let sq = 0;
      for (let b = b0; b < b1; b++) {
        if (lvl.min[b] < lo) lo = lvl.min[b];
        if (lvl.max[b] > hi) hi = lvl.max[b];
        sq += lvl.rms[b] * lvl.rms[b];
      }
      top[x] = hi;
      bot[x] = lo;
      rms[x] = Math.sqrt(sq / (b1 - b0));
    }
    // Peak envelope (soft) then RMS body (solid), as filled outlines.
    g.fillStyle = 'rgba(255,255,255,0.42)';
    g.beginPath();
    g.moveTo(0, mid);
    for (let x = 0; x < cw; x++) g.lineTo(x + 0.5, mid - Math.max(top[x] * amp, 0.5));
    for (let x = cw - 1; x >= 0; x--) g.lineTo(x + 0.5, mid - Math.min(bot[x] * amp, -0.5));
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, mid);
    for (let x = 0; x < cw; x++) g.lineTo(x + 0.5, mid - Math.max(rms[x] * amp, 0.5));
    for (let x = cw - 1; x >= 0; x--) g.lineTo(x + 0.5, mid + Math.max(rms[x] * amp, 0.5));
    g.closePath();
    g.fill();
    this.cache = { c0, c1, spp, W, H, mask, span };
    this.tint = null;
  }

  _tint() {
    const { mask, H } = this.cache;
    const make = (fill) => {
      const c = makeCanvas(mask.width, H);
      const x = c.getContext('2d');
      x.drawImage(mask, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = fill(x);
      x.fillRect(0, 0, c.width, H);
      return c;
    };
    const p = this.dimmed ? this.palette.dim || this.palette : this.palette;
    const played = make((x) => {
      const gr = x.createLinearGradient(0, 0, 0, H);
      const stops = p.played;
      stops.forEach((col, i) => gr.addColorStop(i / Math.max(1, stops.length - 1), col));
      return gr;
    });
    const unplayed = make(() => p.unplayed);
    this.tint = { played, unplayed, dimmed: this.dimmed };
  }

  _valid(view) {
    const c = this.cache;
    if (!c || c.W !== this.canvas.width || c.H !== this.canvas.height) return false;
    if (Math.abs(c.span - (view.end - view.start)) > 1e-6) return false;
    return view.start >= c.c0 - 1e-6 && view.end <= c.c1 + 1e-6;
  }

  /**
   * @param view {start, end} seconds
   * @param t playhead seconds
   * @param fx {level: 0..1, beam: bool}
   */
  draw(view, t, fx = {}) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    // centre line
    ctx.fillStyle = this.palette.axis || 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, Math.floor(H / 2), W, Math.max(1, Math.round(this.dpr)));
    if (!this.peaks || !this.duration) return;
    if (!this._valid(view)) this._build(view);
    if (!this.tint || this.tint.dimmed !== this.dimmed) this._tint();
    const c = this.cache;
    const sx = (view.start - c.c0) / c.spp;
    const reveal = Math.min(1, (performance.now() - this.revealAt) / 520);
    const ease = 1 - Math.pow(1 - reveal, 3);
    const gain = Math.max(0, this.gain) * ease;
    const dh = H * gain;
    const dy = (H - dh) / 2;
    const px = ((t - view.start) / (view.end - view.start)) * W;

    if (dh >= 0.5) {
      ctx.drawImage(this.tint.unplayed, sx, 0, W, H, 0, dy, W, dh);
      if (px > 0) {
        const cw = Math.min(W, px);
        ctx.drawImage(this.tint.played, sx, 0, cw, H, 0, dy, cw, dh);
      }
      // Light catch: the waveform just behind the playhead glows with the level.
      const lvl = fx.level || 0;
      if (fx.beam && lvl > 0.01 && px > 0 && px < W + 20 * this.dpr) {
        const bw = Math.round(22 * this.dpr);
        const x0 = Math.max(0, px - bw);
        const w0 = Math.min(px, W) - x0;
        if (w0 > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.min(0.85, 0.15 + lvl * 2.2);
          ctx.drawImage(this.tint.played, sx + x0, 0, w0, H, x0, dy, w0, dh);
          ctx.restore();
        }
      }
    }
    this.lastPx = px;
    return reveal < 1;
  }
}

/** The tungsten "follow-spot" playhead drawn across every lane. */
export function drawBeam(canvas, x, level, hoverX, colors, loop = null) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, W, H);
  if (loop) {
    const [l0, l1] = loop;
    ctx.fillStyle = 'rgba(255,181,71,0.05)';
    ctx.fillRect(l0, 0, l1 - l0, H);
    ctx.fillStyle = 'rgba(255,181,71,0.35)';
    ctx.fillRect(Math.round(l0), 0, Math.max(1, dpr), H);
    ctx.fillRect(Math.round(l1) - Math.max(1, dpr), 0, Math.max(1, dpr), H);
  }
  if (hoverX !== null && hoverX >= 0 && hoverX <= W) {
    ctx.fillStyle = colors.hover;
    ctx.fillRect(Math.round(hoverX), 0, Math.max(1, Math.round(dpr)), H);
  }
  if (x === null || x < -60 * dpr || x > W + 60 * dpr) return;
  const spread = (26 + level * 40) * dpr;
  const g = ctx.createLinearGradient(x - spread, 0, x + spread, 0);
  const a = 0.05 + Math.min(1, level * 3) * 0.22;
  g.addColorStop(0, 'rgba(255,181,71,0)');
  g.addColorStop(0.5, `rgba(255,181,71,${a.toFixed(3)})`);
  g.addColorStop(1, 'rgba(255,181,71,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - spread, 0, spread * 2, H);
  ctx.fillStyle = colors.core;
  const lw = Math.max(1.5, 1.5 * dpr);
  ctx.fillRect(x - lw / 2, 0, lw, H);
}

export function niceStep(span, px) {
  const target = span / Math.max(1, px / 90);
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s >= target) || 600;
}

export function fmtTime(sec, tenths = false) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  if (tenths) return `${m}:${Math.floor(s).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
  return `${m}:${Math.floor(s).toString().padStart(2, '0')}`;
}

/** Time ruler with Rocksmith sections and the loop region. */
export function drawRuler(canvas, { view, sections, loop, hoverSection, t, colors, duration }) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, W, H);
  if (!duration) return [];
  const span = view.end - view.start;
  const X = (s) => ((s - view.start) / span) * W;
  const secH = Math.round(18 * dpr);
  const hits = [];

  // Sections band
  ctx.font = `${Math.round(11 * dpr)}px Archivo, "Segoe UI Variable Text", "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  (sections || []).forEach((sec, i) => {
    const x0 = Math.max(0, X(sec.start));
    const x1 = Math.min(W, X(sec.end));
    if (x1 <= 0 || x0 >= W || x1 - x0 < 2) return;
    const active = t >= sec.start && t < sec.end;
    const hovered = hoverSection === i;
    ctx.fillStyle = active ? colors.sectionActive : hovered ? colors.sectionHover : i % 2 ? colors.sectionA : colors.sectionB;
    ctx.fillRect(x0 + dpr, 0, x1 - x0 - 2 * dpr, secH);
    if (x1 - x0 > 34 * dpr) {
      ctx.fillStyle = active ? colors.sectionActiveText : colors.sectionText;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + 6 * dpr, 0, x1 - x0 - 10 * dpr, secH);
      ctx.clip();
      ctx.fillText(sec.label, x0 + 7 * dpr, secH / 2 + 0.5 * dpr);
      ctx.restore();
    }
    hits.push({ i, x0: x0 / dpr, x1: x1 / dpr });
  });

  // Loop region
  if (loop) {
    const x0 = X(loop.start);
    const x1 = X(loop.end);
    ctx.fillStyle = colors.loop;
    ctx.fillRect(x0, secH, x1 - x0, H - secH);
    ctx.fillStyle = colors.loopEdge;
    ctx.fillRect(x0, secH, Math.max(1, dpr * 1.5), H - secH);
    ctx.fillRect(x1 - Math.max(1, dpr * 1.5), secH, Math.max(1, dpr * 1.5), H - secH);
  }

  // Ticks
  const step = niceStep(span, W / dpr);
  ctx.fillStyle = colors.tick;
  ctx.textBaseline = 'alphabetic';
  const first = Math.ceil(view.start / step) * step;
  for (let s = first; s <= view.end + 1e-9; s += step) {
    const x = Math.round(X(s));
    ctx.fillRect(x, H - 5 * dpr, Math.max(1, dpr), 5 * dpr);
    ctx.fillStyle = colors.tickText;
    const label = step < 1 ? fmtTime(s, true) : fmtTime(s);
    ctx.fillText(label, x + 4 * dpr, H - 4 * dpr);
    ctx.fillStyle = colors.tick;
  }
  // Playhead marker
  const px = X(t);
  if (px >= 0 && px <= W) {
    ctx.fillStyle = colors.playhead;
    ctx.beginPath();
    ctx.moveTo(px - 5 * dpr, secH);
    ctx.lineTo(px + 5 * dpr, secH);
    ctx.lineTo(px, secH + 6 * dpr);
    ctx.closePath();
    ctx.fill();
  }
  return hits;
}

/** Compact log-frequency spectrum, drawn as a row of stage-light bars. */
export function drawSpectrum(canvas, data, sampleRate, state, colors) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const bars = 28;
  ctx.clearRect(0, 0, W, H);
  if (!state.values) state.values = new Float32Array(bars);
  const v = state.values;
  if (data) {
    const nyq = sampleRate / 2;
    for (let i = 0; i < bars; i++) {
      const f0 = 40 * Math.pow(16000 / 40, i / bars);
      const f1 = 40 * Math.pow(16000 / 40, (i + 1) / bars);
      const b0 = Math.floor((f0 / nyq) * data.length);
      const b1 = Math.max(b0 + 1, Math.floor((f1 / nyq) * data.length));
      let m = 0;
      for (let b = b0; b < b1 && b < data.length; b++) if (data[b] > m) m = data[b];
      const target = m / 255;
      v[i] = target > v[i] ? target : v[i] * 0.86 + target * 0.14;
    }
  } else {
    for (let i = 0; i < bars; i++) v[i] *= 0.86;
  }
  const gap = Math.max(1, Math.round(W / bars / 4));
  const bw = (W - gap * (bars - 1)) / bars;
  for (let i = 0; i < bars; i++) {
    if (v[i] < 0.02) continue;
    const h = Math.max(1, Math.round(v[i] * H));
    const x = i * (bw + gap);
    const g = ctx.createLinearGradient(0, H - h, 0, H);
    g.addColorStop(0, colors.top);
    g.addColorStop(1, colors.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(x, H - h, bw, h);
  }
  return v.some((x) => x > 0.01);
}

/** n bins of [peak, rms] (0–1) across the whole song, from the peak pyramid. */
export function overview(peaks, n) {
  const out = new Float32Array(n * 2);
  if (!peaks || !peaks.levels || !peaks.levels.length) return out;
  const fpb = peaks.frames / n;
  const lvl = pickLevel(peaks.levels, fpb);
  const m = lvl.max.length;
  let top = 1e-6;
  let topR = 1e-6;
  for (let i = 0; i < n; i++) {
    let b0 = Math.floor((i * fpb) / lvl.size);
    let b1 = Math.max(b0 + 1, Math.ceil(((i + 1) * fpb) / lvl.size));
    b1 = Math.min(m, b1);
    let pk = 0;
    let sq = 0;
    for (let b = b0; b < b1; b++) {
      pk = Math.max(pk, lvl.max[b], -lvl.min[b]);
      sq += lvl.rms[b] * lvl.rms[b];
    }
    out[i * 2] = pk;
    out[i * 2 + 1] = b1 > b0 ? Math.sqrt(sq / (b1 - b0)) : 0;
    if (pk > top) top = pk;
    if (out[i * 2 + 1] > topR) topR = out[i * 2 + 1];
  }
  // Peaks and loudness are scaled separately: mastered songs hit full peak
  // almost everywhere, so the loudness (RMS) is what shows the song's shape.
  // scale loudness to how loud the song usually gets (not its single loudest
  // hit), on a curve closer to how loud it sounds, so sections read at a glance
  const sorted = [];
  for (let i = 0; i < n; i++) sorted.push(out[i * 2 + 1]);
  sorted.sort((a, b) => a - b);
  const ref = Math.max(1e-6, sorted[Math.floor(sorted.length * 0.92)] || topR);
  for (let i = 0; i < n; i++) {
    out[i * 2] = Math.min(1, out[i * 2] / top);
    out[i * 2 + 1] = Math.min(1, Math.pow(out[i * 2 + 1] / ref, 0.7) * 0.92);
  }
  return out;
}

/**
 * The compact waveform (the bottom bar and the Now playing scrubber), drawn
 * like the stem lanes: a soft peak envelope over a solid body, the played
 * part lit in the gel colours with a glow, the rest a dim gel, a glowing
 * playhead, and an optional loop region.
 */
const BAR_SHAPES = new WeakMap();
function barShape(canvas, bins, W, H) {
  const c = BAR_SHAPES.get(canvas);
  if (c && c.bins === bins && c.W === W && c.H === H) return c;
  const n = bins ? bins.length / 2 : 0;
  const pk = new Float32Array(W);
  const rm = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    if (!n) continue;
    const j = Math.min(n - 1, Math.floor((x / W) * n));
    pk[x] = bins[j * 2];
    rm[x] = bins[j * 2 + 1];
  }
  // a little smoothing so it reads as a shape, not a comb
  const smooth = (a, r) => {
    const o = new Float32Array(a.length);
    for (let x = 0; x < a.length; x++) {
      let s = 0;
      let k = 0;
      for (let d = -r; d <= r; d++) {
        const i = x + d;
        if (i >= 0 && i < a.length) {
          s += a[i];
          k++;
        }
      }
      o[x] = s / k;
    }
    return o;
  };
  const dpr = window.devicePixelRatio || 1;
  const P = smooth(pk, 1);
  const Rr = smooth(rm, 1);
  const mid = H / 2;
  const amp = (H / 2) * 0.9;
  const env = (arr, min) => {
    const p = new Path2D();
    p.moveTo(0, mid);
    for (let x = 0; x < W; x++) p.lineTo(x, mid - Math.max(min, arr[x] * amp));
    for (let x = W - 1; x >= 0; x--) p.lineTo(x, mid + Math.max(min, arr[x] * amp));
    p.closePath();
    return p;
  };
  // the faint outer layer: loudness plus a little of the peaks above it
  const O = new Float32Array(W);
  for (let x = 0; x < W; x++) O[x] = Math.min(1, Rr[x] + 0.35 * Math.max(0, P[x] - Rr[x]) + 0.04);
  const edge = (arr, min, sign) => {
    const p = new Path2D();
    for (let x = 0; x < W; x++) {
      const y = mid - sign * Math.max(min, arr[x] * amp);
      if (x) p.lineTo(x, y);
      else p.moveTo(x, y);
    }
    return p;
  };
  const out = { bins, W, H, peak: env(O, 0.6 * dpr), body: env(Rr, 0.6 * dpr), top: edge(Rr, 0.6 * dpr, 1), bot: edge(Rr, 0.6 * dpr, -1), outTop: edge(O, 0.6 * dpr, 1), outBot: edge(O, 0.6 * dpr, -1) };
  BAR_SHAPES.set(canvas, out);
  return out;
}

export function drawBars(canvas, bins, progress, { gel = ['#ffd497', '#ffb547', '#ff7a45'], loop = null, hover = null } = {}) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(r.width * dpr));
  const H = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const px = Math.max(0, Math.min(1, progress)) * W;
  const shape = barShape(canvas, bins, W, H);
  if (loop) {
    g.fillStyle = 'rgba(51, 200, 224, 0.12)';
    g.fillRect(loop[0] * W, 0, (loop[1] - loop[0]) * W, H);
    g.fillStyle = 'rgba(51, 200, 224, 0.8)';
    g.fillRect(loop[0] * W, 0, dpr * 1.5, H);
    g.fillRect(loop[1] * W - dpr * 1.5, 0, dpr * 1.5, H);
  }
  // still to come: a faint wireframe of the song's shape
  g.save();
  g.beginPath();
  g.rect(px, 0, W - px, H);
  g.clip();
  g.fillStyle = 'rgba(214, 196, 160, 0.05)';
  g.fill(shape.peak);
  g.fillStyle = 'rgba(214, 196, 160, 0.07)';
  g.fill(shape.body);
  g.lineWidth = Math.max(1, dpr);
  g.strokeStyle = 'rgba(226, 208, 170, 0.38)';
  g.stroke(shape.top);
  g.stroke(shape.bot);
  g.strokeStyle = 'rgba(226, 208, 170, 0.12)';
  g.stroke(shape.outTop);
  g.stroke(shape.outBot);
  g.restore();
  // played: lit, glowing, with a hot neon edge
  if (px > 0) {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, gel[0]);
    gr.addColorStop(0.5, gel[1]);
    gr.addColorStop(1, gel[2]);
    g.save();
    g.beginPath();
    g.rect(0, 0, px, H);
    g.clip();
    g.globalAlpha = 0.28;
    g.fillStyle = gr;
    g.fill(shape.peak);
    g.globalAlpha = 0.92;
    g.shadowColor = 'rgba(255, 140, 50, 0.7)';
    g.shadowBlur = 10 * dpr;
    g.fill(shape.body);
    g.globalAlpha = 1;
    g.shadowBlur = 6 * dpr;
    g.shadowColor = 'rgba(255, 220, 160, 0.9)';
    g.lineWidth = 1.4 * dpr;
    g.strokeStyle = '#fff1d6';
    g.stroke(shape.top);
    g.stroke(shape.bot);
    g.restore();
    // a hot zone trailing the playhead
    const hz = Math.min(px, W * 0.06);
    const hg = g.createLinearGradient(px - hz, 0, px, 0);
    hg.addColorStop(0, 'rgba(255, 200, 120, 0)');
    hg.addColorStop(1, 'rgba(255, 230, 180, 0.55)');
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.beginPath();
    g.rect(px - hz, 0, hz, H);
    g.clip();
    g.fillStyle = hg;
    g.fill(shape.body);
    g.restore();
  }
  if (hover !== null) {
    g.fillStyle = 'rgba(236, 238, 246, 0.35)';
    g.fillRect(hover * W, 0, dpr, H);
  }
  // the playhead: a beam of light with a flare where it meets the song
  g.save();
  g.globalCompositeOperation = 'lighter';
  const fl = g.createRadialGradient(px, H / 2, 0, px, H / 2, H * 0.9);
  fl.addColorStop(0, 'rgba(255, 220, 160, 0.55)');
  fl.addColorStop(1, 'rgba(255, 150, 60, 0)');
  g.fillStyle = fl;
  g.fillRect(px - H, 0, H * 2, H);
  g.restore();
  g.save();
  g.shadowColor = 'rgba(255, 190, 90, 1)';
  g.shadowBlur = 10 * dpr;
  const bm = g.createLinearGradient(0, 0, 0, H);
  bm.addColorStop(0, 'rgba(255, 246, 230, 0)');
  bm.addColorStop(0.5, '#fffaf0');
  bm.addColorStop(1, 'rgba(255, 246, 230, 0)');
  g.fillStyle = bm;
  g.fillRect(Math.round(px - dpr), 0, 2 * dpr, H);
  g.restore();
}
