/**
 * Venues behind the note highway, and the fire you earn with a streak.
 * Everything is drawn in code (no images), lit by the song's beat, and
 * calmer or wilder with how well you're playing ("heat", 0–1).
 */

// Photo venues (3.6): `horizon` is where the floor meets the far wall, as a
// fraction of the picture's height; it's lined up with the highway's
// vanishing point so the highway lies on that floor.
export const VENUES = [
  { id: 'warehouse', name: 'Warehouse', photo: 'warehouse', horizon: 0.49 },
  { id: 'jazz', name: 'Jazz club', photo: 'jazz', horizon: 0.45 },
  { id: 'cellar', name: 'Cellar', photo: 'cellar', horizon: 0.45 },
  { id: 'opera', name: 'Opera house', photo: 'opera', horizon: 0.53 },
  { id: 'studio-room', name: 'Studio', photo: 'studio', horizon: 0.32 },
  { id: 'rooftop', name: 'Rooftop', photo: 'rooftop', horizon: 0.37 },
  { id: 'festival', name: 'Festival', photo: 'festival', horizon: 0.45 },
  { id: 'canyon', name: 'Canyon', photo: 'canyon', horizon: 0.5 },
  { id: 'astral', name: 'Astral', photo: 'astral', horizon: 0.32 },
  ...['aurora','orbit','spectrum'].map(id=>({id,name:{aurora:'Aurora',orbit:'Orbital',spectrum:'Prism'}[id],fluid:true,reactive:true})),
  { id: 'fluid', name: 'Fluid', fluid: true, desc: 'Ink that moves with the notes and beats' },
  { id: 'studio', name: 'Plain', desc: 'Calm and dark, nothing to distract' },
];
/** Old (3.1–3.5) drawn venues map onto the photos. */
export const VENUE_ALIAS = { arena: 'warehouse', club: 'cellar', neon: 'rooftop' };
export const venueThumb = (v) => (v.photo ? `venues/${v.photo}-thumb.jpg` : null);

// ------------------------------------------------------------ photos --
const photos = new Map();
function loadPhoto(name) {
  let p = photos.get(name);
  if (p) return p;
  p = { img: new Image(), ready: false, soft: null, lit: null };
  p.img.decoding = 'async';
  p.img.onload = () => {
    // Prepared once: a soft, darker copy (it's behind the notes, so it sits
    // back like a blurred stage beyond the lights), and a "lights" copy that
    // flashes in on the beat.
    const w = p.img.naturalWidth;
    const h = p.img.naturalHeight;
    const soft = mk(w, h);
    const g = soft.getContext('2d');
    g.filter = 'blur(1.5px) brightness(0.8) saturate(0.92)';
    g.drawImage(p.img, 0, 0);
    g.filter = 'none';
    const lit = mk(Math.round(w / 2), Math.round(h / 2));
    const l = lit.getContext('2d');
    l.filter = 'blur(6px) brightness(1.25) contrast(1.6) saturate(1.2)';
    l.drawImage(p.img, 0, 0, lit.width, lit.height);
    p.soft = soft;
    p.lit = lit;
    p.ready = true;
  };
  p.img.src = `venues/${name}.jpg`;
  photos.set(name, p);
  return p;
}

/**
 * Draws a photo venue so its horizon sits at vpY (pixels): scaled to cover,
 * a little extra for a slow sideways drift with the camera (depth), the
 * floor and edges darkened so the strings and notes read, lights pulsing on
 * the beat, warmer as you heat up.
 */
function drawPhoto(g, v, W, H, view, pulse, heat) {
  const p = loadPhoto(v.photo);
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, W, H);
  if (!p.ready) return;
  const iw = p.soft.width;
  const ih = p.soft.height;
  const hf = v.horizon;
  const vpY = Math.max(H * 0.22, Math.min(H * 0.6, view.vpY ?? H * 0.4));
  // smallest scale that covers the width (plus room to drift) with the horizon at vpY;
  // below the picture the floor just carries on dark
  const sc = Math.max((W * 1.08) / iw, H / ih * 0.85, vpY / (hf * ih));
  const dw = iw * sc;
  const dh = ih * sc;
  const oy = vpY - hf * dh;
  const room = (dw - W) / 2;
  const ox = -room + Math.max(-1, Math.min(1, view.shift || 0)) * room * 0.6;
  g.drawImage(p.soft, ox, oy, dw, dh);
  if (oy + dh < H) {
    // stretch the picture's last rows down so the floor continues
    g.drawImage(p.soft, 0, ih - 2, iw, 2, ox, oy + dh - 1, dw, H - (oy + dh) + 1);
  }
  if (pulse > 0.02) {
    g.save();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = Math.min(0.35, pulse * 0.32);
    // only above the floor: the room's lights, not the floor in front of you
    g.beginPath();
    g.rect(0, 0, W, vpY + H * 0.04);
    g.clip();
    g.drawImage(p.lit, ox, oy, dw, dh);
    g.restore();
  }
  // the floor in front darkens toward you (that's where the neck and strings are)
  const fl = g.createLinearGradient(0, vpY, 0, H);
  fl.addColorStop(0, 'rgba(4, 6, 10, 0)');
  fl.addColorStop(0.5, 'rgba(4, 6, 10, 0.4)');
  fl.addColorStop(1, 'rgba(4, 6, 10, 0.75)');
  g.fillStyle = fl;
  g.fillRect(0, vpY, W, H - vpY);
  // a calm pocket behind the highway itself, and soft dark edges
  const mid = g.createRadialGradient(W / 2, vpY, H * 0.02, W / 2, vpY, H * 0.45);
  mid.addColorStop(0, 'rgba(4, 6, 10, 0.3)');
  mid.addColorStop(1, 'rgba(4, 6, 10, 0)');
  g.fillStyle = mid;
  g.fillRect(0, 0, W, H);
  const vg = g.createRadialGradient(W / 2, H * 0.45, H * 0.35, W / 2, H * 0.45, W * 0.75);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  if (heat > 0.02) {
    g.fillStyle = `rgba(255, 110, 30, ${0.1 * heat})`;
    g.globalCompositeOperation = 'overlay';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }
}

const TAU = Math.PI * 2;
const rnd = (s) => {
  let x = s;
  return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
};
const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
};

// ------------------------------------------------------------- arena --
function arenaStatic(W, H) {
  const c = mk(W, H);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#070a18');
  bg.addColorStop(0.55, '#0d1026');
  bg.addColorStop(1, '#05060c');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // the back of the stage: a huge dim screen with soft panels
  g.fillStyle = 'rgba(40, 60, 120, 0.08)';
  for (let i = 0; i < 9; i++) g.fillRect(W * 0.08 + i * W * 0.0935, H * 0.1, W * 0.088, H * 0.36);
  // speaker stacks either side
  const stack = (x, w) => {
    for (let r = 0; r < 3; r++) {
      const y = H * 0.36 + r * H * 0.15;
      g.fillStyle = '#0b0d16';
      g.fillRect(x, y, w, H * 0.145);
      g.strokeStyle = 'rgba(120, 140, 200, 0.15)';
      g.strokeRect(x + 0.5, y + 0.5, w - 1, H * 0.145 - 1);
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        g.arc(x + w * (0.28 + k * 0.44), y + H * 0.072, Math.min(w * 0.19, H * 0.055), 0, TAU);
        g.fillStyle = '#090a12';
        g.fill();
        g.strokeStyle = 'rgba(140, 160, 220, 0.18)';
        g.stroke();
      }
    }
  };
  stack(W * 0.015, W * 0.12);
  stack(W * 0.865, W * 0.12);
  // truss across the top
  g.fillStyle = '#121626';
  g.fillRect(0, H * 0.035, W, H * 0.022);
  g.strokeStyle = 'rgba(150, 170, 220, 0.18)';
  for (let x = 0; x < W; x += H * 0.022) {
    g.beginPath();
    g.moveTo(x, H * 0.035);
    g.lineTo(x + H * 0.022, H * 0.057);
    g.stroke();
  }
  return c;
}

function drawArena(g, W, H, t, pulse, heat, pal) {
  // sweeping beams from the truss
  g.save();
  g.globalCompositeOperation = 'lighter';
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = W * (0.12 + (i * 0.76) / (n - 1));
    const ang = Math.sin(t * (0.35 + i * 0.07) + i * 1.7) * 0.5 + (i < n / 2 ? 0.18 : -0.18);
    const len = H * 1.05;
    const wide = H * (0.09 + 0.05 * heat);
    const col = pal[i % pal.length];
    const a = 0.05 + 0.07 * pulse + 0.06 * heat;
    const ex = x + Math.sin(ang) * len;
    const ey = H * 0.05 + Math.cos(ang) * len;
    const gr = g.createLinearGradient(x, H * 0.05, ex, ey);
    gr.addColorStop(0, col.replace('A', String(a * 2.2)));
    gr.addColorStop(1, col.replace('A', '0'));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - 3, H * 0.05);
    g.lineTo(ex - Math.cos(ang) * wide, ey + Math.sin(ang) * wide);
    g.lineTo(ex + Math.cos(ang) * wide, ey - Math.sin(ang) * wide);
    g.lineTo(x + 3, H * 0.05);
    g.fill();
    // the lamp
    const lg = g.createRadialGradient(x, H * 0.05, 0, x, H * 0.05, H * 0.03);
    lg.addColorStop(0, `rgba(255,255,255,${0.5 + 0.4 * pulse})`);
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(x - H * 0.03, H * 0.02, H * 0.06, H * 0.06);
  }
  // speaker cones breathe with the beat
  for (const sx of [W * 0.075, W * 0.925]) {
    const gr = g.createRadialGradient(sx, H * 0.55, 0, sx, H * 0.55, H * 0.25);
    gr.addColorStop(0, pal[0].replace('A', String(0.05 + 0.1 * pulse)));
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(sx - H * 0.25, H * 0.3, H * 0.5, H * 0.5);
  }
  g.restore();
  crowd(g, W, H, t, pulse, heat, 0.86, 1);
}

/** Silhouettes along the bottom; they jump on the beat when you're on fire. */
function crowd(g, W, H, t, pulse, heat, yBase, density) {
  const r = rnd(7);
  const n = Math.round((W / 26) * density);
  g.fillStyle = '#04050a';
  for (let i = 0; i < n; i++) {
    const x = (i + r() * 0.8) * (W / n);
    const sz = H * (0.022 + r() * 0.012);
    const ph = r() * TAU;
    const jump = (0.15 + heat) * pulse * sz * (0.5 + 0.5 * Math.sin(ph + t * 2));
    const y = H * yBase - jump + r() * H * 0.02;
    g.beginPath();
    g.arc(x, y, sz * 0.55, 0, TAU);
    g.fill();
    g.fillRect(x - sz * 0.9, y + sz * 0.45, sz * 1.8, H);
    if (heat > 0.35 && r() < 0.3) {
      // hands up
      g.fillRect(x + sz * 0.5, y - sz * (1.2 + pulse * 0.4), sz * 0.22, sz * 1.4);
    }
  }
}

// -------------------------------------------------------------- club --
function clubStatic(W, H) {
  const c = mk(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#120a08';
  g.fillRect(0, 0, W, H);
  // brick wall
  const r = rnd(3);
  const bh = Math.max(10, H * 0.028);
  const bw = bh * 2.6;
  for (let y = 0, row = 0; y < H * 0.9; y += bh, row++) {
    for (let x = row % 2 ? -bw / 2 : 0; x < W; x += bw) {
      const l = 14 + r() * 10;
      g.fillStyle = `hsl(${10 + r() * 12}, 38%, ${l}%)`;
      g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
  // darken toward the edges and the floor
  const v = g.createRadialGradient(W / 2, H * 0.35, H * 0.1, W / 2, H * 0.4, W * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0.25)');
  v.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  return c;
}

function drawClub(g, W, H, t, pulse, heat) {
  // string lights in two swags
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let s = 0; s < 2; s++) {
    const y0 = H * (0.08 + s * 0.12);
    const sag = H * 0.06;
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = u * W;
      const y = y0 + Math.sin(u * Math.PI) * sag + Math.sin(t * 0.8 + s) * 2;
      const tw = 0.6 + 0.4 * Math.sin(t * 3 + i * 1.3 + s);
      const a = (0.35 + 0.35 * pulse) * tw;
      const gr = g.createRadialGradient(x, y, 0, x, y, H * 0.03);
      gr.addColorStop(0, `rgba(255, 210, 140, ${a})`);
      gr.addColorStop(1, 'rgba(255, 160, 60, 0)');
      g.fillStyle = gr;
      g.fillRect(x - H * 0.03, y - H * 0.03, H * 0.06, H * 0.06);
    }
  }
  // a warm spotlight on the stage that pumps with the beat
  const gr = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, H * 0.7);
  gr.addColorStop(0, `rgba(255, 140, 60, ${0.06 + 0.06 * pulse + 0.06 * heat})`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.restore();
  crowd(g, W, H, t, pulse, heat, 0.9, 0.6);
}

// -------------------------------------------------------------- neon --
function neonStatic(W, H) {
  const c = mk(W, H);
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H * 0.6);
  sky.addColorStop(0, '#07041a');
  sky.addColorStop(0.6, '#2a0b46');
  sky.addColorStop(1, '#5b1550');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // stars
  const r = rnd(11);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 160; i++) g.fillRect(r() * W, r() * H * 0.45, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1);
  // the sun, striped
  const cx = W / 2;
  const cy = H * 0.42;
  const R = H * 0.2;
  const sg = g.createLinearGradient(0, cy - R, 0, cy + R);
  sg.addColorStop(0, '#ffe36e');
  sg.addColorStop(0.5, '#ff7a59');
  sg.addColorStop(1, '#ff2fa0');
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.clip();
  g.fillStyle = sg;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.fillStyle = '#2a0b46';
  for (let i = 0; i < 7; i++) {
    const y = cy + R * (0.1 + i * 0.13);
    g.fillRect(cx - R, y, R * 2, 2 + i * 1.6);
  }
  g.restore();
  // mountains
  const m = (yb, hgt, col, seed) => {
    const rr = rnd(seed);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, yb);
    for (let x = 0; x <= W; x += W / 14) g.lineTo(x, yb - rr() * hgt);
    g.lineTo(W, yb);
    g.fill();
  };
  m(H * 0.6, H * 0.12, '#1a0830', 5);
  m(H * 0.62, H * 0.07, '#110522', 9);
  g.fillStyle = '#0a0314';
  g.fillRect(0, H * 0.62, W, H);
  return c;
}

function drawNeon(g, W, H, t, pulse, heat) {
  // a glowing perspective grid that scrolls toward you
  const hy = H * 0.62;
  g.save();
  g.strokeStyle = `rgba(255, 60, 200, ${0.25 + 0.25 * pulse + 0.2 * heat})`;
  g.lineWidth = 1.5;
  g.shadowColor = '#ff3cc8';
  g.shadowBlur = 8;
  for (let i = -12; i <= 12; i++) {
    g.beginPath();
    g.moveTo(W / 2 + i * W * 0.012, hy);
    g.lineTo(W / 2 + i * W * 0.12, H);
    g.stroke();
  }
  const sp = (t * 0.6) % 1;
  for (let k = 0; k < 10; k++) {
    const u = (k + sp) / 10;
    const y = hy + (H - hy) * u * u;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.restore();
}

// ------------------------------------------------------------ studio --
function studioStatic(W, H) {
  const c = mk(W, H);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#08111f');
  bg.addColorStop(0.5, '#0a1828');
  bg.addColorStop(1, '#04070d');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  return c;
}
function drawStudio(g, W, H, t, pulse) {
  const spot = (x, y, r, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  spot(W * 0.2, H * 0.04, H * 0.6, `rgba(40, 170, 220, ${0.14 + 0.05 * pulse})`);
  spot(W * 0.8, H * 0.04, H * 0.6, `rgba(40, 170, 220, ${0.14 + 0.05 * pulse})`);
  spot(W * 0.5, H, H * 0.7, 'rgba(255, 150, 60, 0.07)');
}

const ARENA_PAL = ['rgba(80, 200, 255, A)', 'rgba(255, 80, 180, A)', 'rgba(255, 200, 80, A)', 'rgba(140, 110, 255, A)'];

/** A venue that knows how to draw itself at any size. */
export function createVenue() {
  const V = { id: null, W: 0, H: 0, still: null };
  return {
    draw(g, id, W, H, t, pulse, heat, view = {}) {
      id = VENUE_ALIAS[id] || id;
      const pv = VENUES.find((v) => v.id === id && v.photo);
      if (pv) return drawPhoto(g, pv, W, H, view, pulse, heat);
      if (V.id !== id || V.W !== W || V.H !== H) {
        V.id = id;
        V.W = W;
        V.H = H;
        V.still = id === 'arena' ? arenaStatic(W, H) : id === 'club' ? clubStatic(W, H) : id === 'neon' ? neonStatic(W, H) : studioStatic(W, H);
      }
      g.drawImage(V.still, 0, 0, W, H);
      if (id === 'arena') drawArena(g, W, H, t, pulse, heat, ARENA_PAL);
      else if (id === 'club') drawClub(g, W, H, t, pulse, heat);
      else if (id === 'neon') drawNeon(g, W, H, t, pulse, heat);
      else drawStudio(g, W, H, t, pulse);
      // keep the middle calm so the notes always read
      const v = g.createRadialGradient(W / 2, H * 0.55, H * 0.1, W / 2, H * 0.55, W * 0.6);
      v.addColorStop(0, 'rgba(3, 5, 12, 0.55)');
      v.addColorStop(1, 'rgba(3, 5, 12, 0.1)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    },
  };
}

// ------------------------------------------------------------- fire --
let spark = null;
function sparkSprite() {
  if (spark) return spark;
  spark = mk(64, 64);
  const g = spark.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255, 250, 220, 1)');
  gr.addColorStop(0.25, 'rgba(255, 190, 70, 0.9)');
  gr.addColorStop(0.6, 'rgba(255, 80, 20, 0.35)');
  gr.addColorStop(1, 'rgba(255, 40, 0, 0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return spark;
}

/** Flames and embers rising off the neck while you're on a streak. */
export function createFire() {
  const P = [];
  return {
    /** spans: [[x0, x1], …] along the neck's bottom edge at height y; embers rise a little and fade. */
    update(dt, heat, spans, y) {
      const total = spans.reduce((a, [x0, x1]) => a + Math.max(0, x1 - x0), 0) || 1;
      const rate = heat > 0.02 ? (10 + heat * 70) * Math.min(2, total / 600) : 0;
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) {
          let r = Math.random() * total;
          let x = spans[0] ? spans[0][0] : 0;
          for (const [x0, x1] of spans) {
            const w = Math.max(0, x1 - x0);
            if (r <= w) {
              x = x0 + r;
              break;
            }
            r -= w;
          }
          P.push({ x, y, vx: (Math.random() - 0.5) * 16, vy: -(25 + Math.random() * 45) * (0.6 + heat), life: 0, max: 0.3 + Math.random() * 0.35, s: 3 + Math.random() * 6 * (0.5 + heat) });
        }
        n -= 1;
      }
      for (const p of P) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx += (Math.random() - 0.5) * 120 * dt;
      }
      for (let i = P.length - 1; i >= 0; i--) if (P[i].life > P[i].max) P.splice(i, 1);
      if (P.length > 900) P.splice(0, P.length - 900);
    },
    draw(g) {
      if (!P.length) return;
      const sp = sparkSprite();
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const p of P) {
        const k = p.life / p.max;
        const s = p.s * (1 - k * 0.6);
        g.globalAlpha = Math.max(0, 1 - k) * 0.8;
        g.drawImage(sp, p.x - s, p.y - s, s * 2, s * 2);
      }
      g.restore();
    },
  };
}
