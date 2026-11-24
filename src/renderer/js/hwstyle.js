/**
 * 4.31: what makes each highway style look like itself (hwlooks.js `sig`): the floor's pattern inside
 * your hand position, how the rails are drawn, a pool of light, how the floor answers the beat, the
 * slow movement in the room and the hit effect.
 *
 * Only decoration: everything here goes on the floor, soft-light and effects layers. Nothing here
 * touches the notes, strings, frets, labels or the camera, so every style keeps them exactly where
 * they are (test/hwlook/shoot.js THEMES=1 compares those layers point for point).
 * Classic draws none of this: its rails stay in highway.js, as they always were.
 *
 * Every effect is small (a few hundred flat pieces at most) and the moving ones only run when the
 * style's slow movement is on (Graphics › Style effects: Full, and Auto drops it on a slow PC).
 */
import { col, mix, mixHex } from './highway3d.js';

const BLANK = col('#000000', 0);

// a small fixed random sequence (the same every frame, so nothing flickers)
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** A soft band lying on the floor along the rail (x), bright in the middle, w wide each side. */
function softAlong(layer, x, y, za, zb, w, c) {
  layer.q(x - w, y, za, x, y, za, x, y, zb, x - w, y, zb, BLANK, c, c, BLANK);
  layer.q(x, y, za, x + w, y, za, x + w, y, zb, x, y, zb, c, BLANK, BLANK, c);
}
/** A soft band lying on the floor across (x0..x1) at depth z, d deep each side. */
function softAcross(layer, x0, x1, y, z, d, c) {
  layer.q(x0, y, z - d, x1, y, z - d, x1, y, z, x0, y, z, BLANK, BLANK, c, c);
  layer.q(x0, y, z, x1, y, z, x1, y, z + d, x0, y, z + d, c, c, BLANK, BLANK);
}
/** A soft speck of light facing you: a little diamond fading from the middle. */
function speck(layer, x, y, z, r, c) {
  layer.q(x, y, z, x + r, y, z, x, y + r, z, x, y + r, z, c, BLANK, BLANK, BLANK);
  layer.q(x, y, z, x, y + r, z, x - r, y, z, x - r, y, z, c, BLANK, BLANK, BLANK);
  layer.q(x, y, z, x - r, y, z, x, y - r, z, x, y - r, z, c, BLANK, BLANK, BLANK);
  layer.q(x, y, z, x, y - r, z, x + r, y, z, x + r, y, z, c, BLANK, BLANK, BLANK);
}
/** A beam of light from (tx, ty, tz) down to (bx, by, bz): w0 wide at the top, w1 at the bottom, soft at the sides. */
function beam(layer, tx, ty, tz, bx, by, bz, w0, w1, cTop, cBot) {
  layer.q(tx - w0, ty, tz, tx, ty, tz, bx, by, bz, bx - w1, by, bz, BLANK, cTop, cBot, BLANK);
  layer.q(tx, ty, tz, tx + w0, ty, tz, bx + w1, by, bz, bx, by, bz, cTop, BLANK, BLANK, cBot);
}
/** A small square facing you (a pixel, a scrap of confetti turned by `r`). */
function square(layer, x, y, z, w, h, r, c) {
  const cs = Math.cos(r);
  const sn = Math.sin(r);
  const p = (dx, dy) => [x + dx * cs - dy * sn, y + dx * sn + dy * cs];
  const [ax, ay] = p(-w, -h);
  const [bx, by] = p(w, -h);
  const [cx, cy] = p(w, h);
  const [dx, dy] = p(-w, h);
  layer.q(ax, ay, z, bx, by, z, cx, cy, z, dx, dy, z, c, c, c, c);
}
const RAINBOW = ['#ff4b6e', '#ffb03a', '#ffe14a', '#4be07a', '#3ab4ff', '#b67dff'];
/** A ring lying on the floor (a ripple): radius r across, rz deep, th thick, soft both sides. */
const RING = Array.from({ length: 29 }, (_, i) => [Math.cos((i / 28) * Math.PI * 2), Math.sin((i / 28) * Math.PI * 2)]);
function floorRing(layer, x, y, z, r, rz, th, c) {
  const h = th / 2;
  for (let i = 0; i < 28; i++) {
    const [c0, s0] = RING[i];
    const [c1, s1] = RING[i + 1];
    for (const [ia, ib, ca, cb] of [[-h, 0, BLANK, c], [0, h, c, BLANK]]) {
      layer.q(x + c0 * (r + ia), y, z + s0 * (rz + ia), x + c0 * (r + ib), y, z + s0 * (rz + ib), x + c1 * (r + ib), y, z + s1 * (rz + ib), x + c1 * (r + ia), y, z + s1 * (rz + ia), ca, cb, cb, ca);
    }
  }
}

/**
 * env: the highway's own measures (they never change): R3, G, XF, laneW, laneC, anX0, anX1, zOf,
 * noteX, strH, anchorAt, STRING, beats() (the song's beat list), calm() (less movement wanted).
 */
export function createStyle(env) {
  const { R3, G, XF, zOf, noteX, strH, anchorAt, STRING } = env;
  const secs = () => performance.now() / 1000;

  /** The rails (the hand position's edges) as the style draws them, at x from za to zb. */
  function rail(LK, P, x, za, zb, railCol) {
    const { floor, soft, fx } = R3.L;
    const tw = G.tierW || 0;
    const beatK = (LK.sig.beat || 0) * (G.pulse || 0);
    const now = secs();
    switch (LK.sig.rails) {
      case 'soft':
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.05, railCol(0.85, 1));
        softAlong(soft, x, 0.01, za, zb, 0.32 + 0.1 * tw, railCol(0.11 + 0.06 * tw + 0.05 * beatK));
        break;
      case 'tape': {
        // a strip of gaffer tape, darker at its edges, torn here and there (the tears roll with the song)
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.17, railCol(0.88, 0.9));
        floor.bar([x - 0.08, 0.009, za], [x - 0.08, 0.009, zb], 0.012, col('#000000', 0.3));
        floor.bar([x + 0.08, 0.009, za], [x + 0.08, 0.009, zb], 0.012, col('#000000', 0.3));
        const t0 = G.t - 0.2;
        const per = 1.3;
        for (let k = Math.floor(t0 / per); k * per < G.t + G.L; k++) {
          const z = zOf(k * per + hash(k + x * 7) * 0.9);
          if (z < za || z > zb) continue;
          floor.bar([x - 0.09, 0.0095, z], [x + 0.09, 0.0095, z], 0.05, col(P.laneA, 0.85));
        }
        break;
      }
      case 'chrome': {
        // polished metal: a dark bevel, a bright edge, and a glint that runs toward you
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.07, col('#26313b', 0.92));
        floor.bar([x - 0.014, 0.009, za], [x - 0.014, 0.009, zb], 0.024, railCol(0.95, 1.25));
        softAlong(soft, x, 0.01, za, zb, 0.16, railCol(0.08 + 0.05 * tw));
        if (LK.amb) {
          const span = G.zF + 12;
          const zg = G.zF - ((now * 11 + x * 3) % span);
          const a = Math.max(za, zg - 2.5);
          const b = Math.min(zb, zg + 0.6);
          if (b > a) {
            fx.bar([x, 0.012, a], [x, 0.012, Math.min(b, zg)], 0.08, BLANK, col('#ffffff', 0.55));
            if (b > zg) fx.bar([x, 0.012, zg], [x, 0.012, b], 0.08, col('#ffffff', 0.55), BLANK);
          }
        }
        break;
      }
      case 'neon': {
        const k = 1 + 0.5 * beatK + 0.3 * tw;
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.032, mix(P.rail, '#ffffff', 0.55, 0.95, 1));
        softAlong(soft, x, 0.01, za, zb, 0.13, railCol(0.34 * k));
        softAlong(soft, x, 0.011, za, zb, 0.42, col(P.postB, 0.1 * k));
        break;
      }
      case 'led': {
        // an LED strip: a dark base, bright dots with a light chase running toward you
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.06, col('#0c1018', 0.92));
        const step = 0.8;
        const chase = LK.amb ? now * 9 : 0;
        for (let z = Math.ceil(za / step) * step; z < zb - 0.3; z += step) {
          const k = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(z * 0.55 + chase)) + 0.4 * (G.pulse || 0);
          floor.bar([x, 0.009, z], [x, 0.009, z + 0.36], 0.045, railCol(0.95, 0.7 + 0.5 * k));
        }
        softAlong(soft, x, 0.01, za, zb, 0.22, railCol(0.08 + 0.05 * tw + 0.06 * beatK));
        break;
      }
      case 'draft': {
        // two fine drafting lines with a tick on every beat (a longer one on the bar)
        const c = col(P.rail, 0.8);
        floor.bar([x - 0.035, 0.008, za], [x - 0.035, 0.008, zb], 0.014, c);
        floor.bar([x + 0.035, 0.008, za], [x + 0.035, 0.008, zb], 0.014, c);
        const B = env.beats();
        for (let i = env.lower(B, G.t); i < B.length && B[i].t < G.t + G.L; i++) {
          const z = zOf(B[i].t);
          if (z < za || z > zb) continue;
          const w = B[i].m >= 0 ? 0.16 : 0.09;
          floor.bar([x - w, 0.0085, z], [x + w, 0.0085, z], 0.012, c);
        }
        break;
      }
      case 'lava': {
        // molten: an orange core that flickers slowly piece by piece, a red glow round it
        const step = 1.1;
        const fl = LK.amb ? now * 2.3 : 0;
        for (let z = Math.floor(za / step) * step; z < zb; z += step) {
          const a = Math.max(za, z);
          const b = Math.min(zb, z + step);
          const k = 0.8 + 0.22 * Math.sin(z * 2.7 + fl + x) + 0.3 * (G.heat || 0);
          floor.bar([x, 0.008, a], [x, 0.008, b], 0.075, mix(P.rail, P.railHot, (G.heat || 0) * 0.8, 0.95, k));
        }
        softAlong(soft, x, 0.01, za, zb, 0.3 + 0.12 * tw, col('#ff5a1a', 0.16 + 0.12 * (G.heat || 0) + 0.06 * beatK));
        break;
      }
      case 'laser':
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.028, mix(P.rail, '#ffffff', 0.5, 0.95, 1));
        softAlong(soft, x, 0.01, za, zb, 0.16, railCol(0.3 + 0.1 * beatK));
        softAlong(soft, x, 0.011, za, zb, 0.5, col(P.postA, 0.07 + 0.05 * tw));
        break;
      case 'pixel': {
        // 8-bit: square blocks with gaps, rolling with the song, brighter on the beat
        const per = 0.18;
        for (let k = Math.floor((G.t - 0.2) / per); k * per < G.t + G.L; k++) {
          const z0 = zOf(k * per);
          const z1 = zOf(k * per + per * 0.6);
          if (z1 < za || z0 > zb) continue;
          floor.flat(x - 0.07, x + 0.07, Math.max(za, z0), Math.min(zb, z1), 0.008, railCol(0.95, 0.8 + 0.5 * beatK));
        }
        break;
      }
      case 'wave': {
        // sea-soft: a glowing band that sways a little along its length
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.035, railCol(0.85, 1));
        const step = 0.9;
        const now2 = LK.amb ? now : 0;
        for (let z = Math.floor(za / step) * step; z < zb; z += step) {
          const a = Math.max(za, z);
          const b = Math.min(zb, z + step);
          const w = 0.22 + 0.12 * Math.sin(z * 0.7 + now2 * 1.6 + x);
          softAlong(soft, x + 0.05 * Math.sin(z * 0.5 + now2), 0.01, a, b, w, railCol(0.13 + 0.05 * tw));
        }
        break;
      }
      case 'frost': {
        // two fine icy lines, a cold glow, and frost crystals along them
        const c = mix(P.rail, '#ffffff', 0.4, 0.95, 1.1);
        floor.bar([x - 0.03, 0.008, za], [x - 0.03, 0.008, zb], 0.016, c);
        floor.bar([x + 0.03, 0.008, za], [x + 0.03, 0.008, zb], 0.016, c);
        softAlong(soft, x, 0.01, za, zb, 0.26, railCol(0.12 + 0.05 * tw));
        const per = 0.7;
        for (let k = Math.floor((G.t - 0.2) / per); k * per < G.t + G.L; k++) {
          const z = zOf(k * per + hash(k + x) * 0.4);
          if (z < za || z > zb) continue;
          floor.bar([x - 0.1, 0.009, z - 0.1], [x + 0.1, 0.009, z + 0.1], 0.012, c);
          floor.bar([x + 0.1, 0.009, z - 0.1], [x - 0.1, 0.009, z + 0.1], 0.012, c);
        }
        break;
      }
      case 'rainbow': {
        // a rainbow running toward you, a colour a beat
        const B = env.beats();
        for (let i = Math.max(0, env.lower(B, G.t - 2)); i < B.length && B[i].t < G.t + G.L; i++) {
          const z0 = Math.max(za, zOf(B[i].t));
          const z1 = Math.min(zb, zOf(B[i + 1] ? B[i + 1].t : B[i].t + 0.5));
          if (z1 <= z0) continue;
          const c = RAINBOW[i % RAINBOW.length];
          floor.bar([x, 0.008, z0], [x, 0.008, z1], 0.06, col(c, 0.95, 1.05));
          softAlong(soft, x, 0.01, z0, z1, 0.24, col(c, 0.12 + 0.08 * beatK));
        }
        if (!B.length) floor.bar([x, 0.008, za], [x, 0.008, zb], 0.06, railCol(0.95));
        break;
      }
      case 'line':
      default:
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.04, railCol(0.92, 1));
        if (LK.glowK > 0.05) softAlong(soft, x, 0.01, za, zb, 0.12, railCol(0.05));
    }
  }

  /** The floor inside a hand position (xa..xb, za..zb): its pattern, a pool of light, the beat. */
  function floorPattern(LK, P, an, xa, xb, za, zb, here) {
    const { floor, soft } = R3.L;
    const sig = LK.sig;
    const t = G.t;
    const beatK = (sig.beat || 0) * (G.pulse || 0);
    const across = (per, w, c, glow) => {
      for (let k = Math.ceil((t - 0.15) / per); k * per < t + G.L; k++) {
        const z = zOf(k * per);
        if (z < za || z > zb) continue;
        floor.bar([xa, 0.005, z], [xb, 0.005, z], w, c);
        if (glow) softAcross(soft, xa, xb, 0.006, z, 0.35, glow);
      }
    };
    const along = (n, c) => {
      for (let f = an.fret; f < an.fret + (an.width || 4); f++) {
        const l = XF(f - 1);
        const w = XF(f) - l;
        for (let i = 1; i < n; i++) floor.bar([l + (w * i) / n, 0.005, za], [l + (w * i) / n, 0.005, zb], 0.012, c);
      }
    };
    switch (sig.floor) {
      case 'boards': {
        // planks running toward you, seams between them, ends staggered (they roll with the song)
        const pw = 0.42;
        for (let i = 0, x = xa; x < xb - 0.01; i++, x += pw) {
          const x1 = Math.min(xb, x + pw);
          floor.flat(x, x1, za, zb, 0.003, col(hash(i * 3.7 + an.fret) > 0.5 ? '#ffe2b8' : '#000000', 0.05 + 0.06 * hash(i + 9)));
          if (x > xa + 0.01) floor.bar([x, 0.0035, za], [x, 0.0035, zb], 0.045, col('#000000', 0.5));
          const per = 2.2;
          const off = hash(i * 5.1 + an.fret * 1.3) * per;
          for (let k = Math.floor((t - off) / per); k * per + off < t + G.L; k++) {
            const z = zOf(k * per + off);
            if (z < za || z > zb) continue;
            floor.bar([x, 0.0036, z], [x1, 0.0036, z], 0.06, col('#000000', 0.5));
          }
        }
        break;
      }
      case 'grid':
        across(0.25, 0.016, col(P.line, 0.2));
        along(3, col(P.line, 0.09));
        break;
      case 'synth':
        across(0.25, 0.03, col(P.line, Math.min(1, 0.42 * (0.75 + 0.5 * beatK + 0.3 * (G.tierW || 0)))), col(P.line, 0.07 + 0.08 * beatK));
        break;
      case 'blueprint':
        across(0.125, 0.01, col(P.line, 0.08));
        across(0.5, 0.02, col(P.line, 0.18));
        along(4, col(P.line, 0.07));
        break;
      case 'ice':
      case 'ember': {
        // charcoal with cracks glowing through (hotter on the beat and on a streak); the cracks roll with the song
        const ice = sig.floor === 'ice';
        if (ice) soft.flat(xa, xb, za, zb, 0.006, col(P.wash, 0.03), col(P.wash, 0.08));
        else floor.flat(xa, xb, za, zb, 0.0025, col('#000000', 0.22));
        const per = ice ? 0.8 : 0.55;
        const heat = ice ? 0.38 + 0.15 * beatK : 0.5 + 0.4 * (G.heat || 0) + 0.3 * beatK;
        const [hotA, hotB] = ice ? ['#cfefff', '#ffffff'] : ['#ff6a1f', '#ffb347'];
        for (let k = Math.floor((t - 0.3) / per); k * per < t + G.L; k++) {
          const rnd = seeded(k * 7919 + an.fret * 31);
          for (let c = 0; c < 2; c++) {
            let x = xa + rnd() * (xb - xa);
            let tt = k * per + rnd() * per;
            for (let s = 0; s < 4; s++) {
              const nx = Math.max(xa, Math.min(xb, x + (rnd() - 0.5) * 0.9));
              const nt = tt + 0.05 + rnd() * 0.1;
              const z0 = zOf(tt);
              const z1 = zOf(nt);
              if (z1 > za && z0 < zb) {
                const c0 = Math.max(za, z0);
                const c1 = Math.min(zb, z1);
                if (!ice) floor.bar([x, 0.004, c0], [nx, 0.004, c1], 0.09, col('#000000', 0.5));
                soft.bar([x, 0.006, c0], [nx, 0.006, c1], ice ? 0.03 : 0.06, col(hotA, heat), col(hotB, heat * 0.8));
              }
              x = nx;
              tt = nt;
            }
          }
        }
        break;
      }
      case 'checker': {
        // a checkerboard, two squares a fret, rolling with the song
        const per = 0.25;
        for (let k = Math.floor((t - 0.2) / per); k * per < t + G.L; k++) {
          const z0 = Math.max(za, zOf(k * per));
          const z1 = Math.min(zb, zOf((k + 1) * per));
          if (z1 <= z0) continue;
          for (let f = an.fret; f < an.fret + (an.width || 4); f++) {
            const l = XF(f - 1);
            const m = (l + XF(f)) / 2;
            const odd = (k + f) & 1;
            floor.flat(odd ? l : m, odd ? m : XF(f), z0, z1, 0.003, col('#000000', 0.38));
          }
        }
        break;
      }
      case 'caustics': {
        // light from the surface wobbling over the floor
        const now = LK.amb ? secs() : 0;
        const per = 0.45;
        for (let k = Math.floor((t - 0.2) / per); k * per < t + G.L; k++) {
          for (let c = 0; c < 3; c++) {
            const h1 = hash(k * 3 + c);
            const x = xa + (0.15 + 0.7 * h1) * (xb - xa) + 0.25 * Math.sin(now * 0.9 + k + c * 2);
            const z = zOf(k * per + hash(k * 7 + c) * per);
            if (z < za || z > zb) continue;
            soft.halo(x, 0.007, z, 0.35 + 0.2 * hash(k + c * 5), 0.9 + 0.5 * Math.sin(now * 1.3 + k), P.wash, 0.14 + 0.05 * Math.sin(now * 2 + k * 3 + c), 1, 'y', 10);
          }
        }
        break;
      }
      case 'tiles': {
        // a lit dance floor: a tile a fret and a beat, some lit in a colour on each beat
        const B = env.beats();
        for (let i = Math.max(0, env.lower(B, t - 0.5) - 1); i < B.length && B[i].t < t + G.L; i++) {
          const z0 = Math.max(za, zOf(B[i].t));
          const z1 = Math.min(zb, zOf(B[i + 1] ? B[i + 1].t : B[i].t + 0.5));
          if (z1 <= z0) continue;
          for (let f = an.fret; f < an.fret + (an.width || 4); f++) {
            const hv = hash(i * 13.1 + f * 3.7);
            floor.bar([XF(f - 1), 0.0035, z0], [XF(f - 1), 0.0035, z1], 0.03, col('#000000', 0.5));
            if (hv < 0.45) continue;
            const c = RAINBOW[Math.floor(hv * 97) % RAINBOW.length];
            soft.flat(XF(f - 1) + 0.04, XF(f) - 0.04, z0 + 0.04, z1 - 0.04, 0.006, col(c, 0.2 + 0.2 * beatK));
          }
          floor.bar([xa, 0.0035, z0], [xb, 0.0035, z0], 0.03, col('#000000', 0.5));
        }
        break;
      }
      case 'gloss':
        // a glossy floor: the far end catches the room's light
        soft.flat(xa, xb, za, zb, 0.006, BLANK, col(P.wash, 0.05));
        break;
      default:
    }
    if (here) {
      const zMax = Math.min(zb, G.zF * 0.45);
      // a pool of light under your hand position, warmer on a streak
      if (sig.pool > 0 && zMax > za) soft.halo((xa + xb) / 2, 0.012, Math.max(za, 0) + G.zF * 0.1, (xb - xa) * 0.75, G.zF * 0.16, mixHex(P.wash, P.railHot, (G.tierW || 0) * 0.5, 8), sig.pool * (1 + 0.6 * (G.tierW || 0)), 1, 'y', 16);
      // the floor flashes softly on the beat
      if (beatK > 0.02 && zMax > za) soft.flat(xa, xb, Math.max(za, 0), zMax, 0.011, col(P.beat, 0.09 * beatK), BLANK);
    }
  }

  /** The style's slow movement in the room (only with Style effects on). */
  function ambient(LK, P, a) {
    if (!LK.amb) return;
    const { fx } = R3.L;
    const now = secs();
    const cx = (env.anX0(a) + env.anX1(a)) / 2;
    const zF = G.zF;
    const x0 = XF(Math.max(0, (G.f0 || 0) - 1));
    const x1 = XF(Math.min(24, (G.f1 ?? 24) + 1));
    switch (LK.sig.amb) {
      case 'dust': {
        // one soft light from above over your hand position, dust drifting through it
        const w = (env.anX1(a) - env.anX0(a)) * 0.55;
        beam(fx, cx, 9, zF * 0.3, cx, 0, zF * 0.12, 0.5, w, col(P.wash, 0.035), col(P.wash, 0.05));
        for (let i = 0; i < 34; i++) {
          const h = hash(i + 1);
          const h2 = hash(i * 3.3 + 7);
          const y = 0.3 + ((now * 0.05 * (0.5 + h) + h2) % 1) * 4.2;
          const x = cx + (h - 0.5) * w * 1.6 + Math.sin(now * 0.3 + i) * 0.25;
          const z = zF * (0.06 + 0.3 * hash(i * 7.1));
          const tw = 0.5 + 0.5 * Math.sin(now * (0.8 + h) + i);
          speck(fx, x, y, z, 0.03 + 0.03 * h2, col(P.wash, 0.22 * tw));
        }
        break;
      }
      case 'sweep': {
        // a broad sheet of light sliding slowly over the glass floor
        const z = zF * 1.1 - ((now * 6) % (zF * 1.3));
        if (z > 0 && z < zF) softAcross(fx, x0, x1, 0.013, z, 2.2, col('#cfefff', 0.045));
        break;
      }
      case 'haze': {
        for (let i = 0; i < 26; i++) {
          const h = hash(i + 3);
          const x = x0 + (((h * 97 + now * 0.25 * (0.4 + h)) % 1) + 1) % 1 * (x1 - x0);
          const y = 0.6 + 3.2 * hash(i * 2.9);
          const z = zF * (0.15 + 0.5 * hash(i * 5.3));
          speck(fx, x, y, z, 0.07 + 0.05 * h, col(i % 2 ? P.postA : P.postB, 0.1 * (0.6 + 0.4 * Math.sin(now * 0.7 + i))));
        }
        break;
      }
      case 'beams': {
        // stage lights from the rig, sweeping slowly, brighter on the beat and on a streak
        const k = 0.03 * (1 + 0.8 * (G.pulse || 0)) + 0.02 * (G.tierW || 0);
        for (let i = 0; i < 4; i++) {
          const tx = x0 + ((i + 0.5) / 4) * (x1 - x0);
          const bx = cx + Math.sin(now * (0.3 + i * 0.05) + i * 1.7) * (x1 - x0) * 0.35;
          const c = i % 2 ? P.wash : '#ffd7a0';
          beam(fx, tx, 10, zF * 0.55, bx, 0, zF * 0.22, 0.12, 1.6, col(c, k * 1.4), col(c, k));
        }
        break;
      }
      case 'embers': {
        const n = 20 + Math.round(16 * (G.heat || 0));
        for (let i = 0; i < n; i++) {
          const h = hash(i + 11);
          const u = (now * 0.12 * (0.6 + h) + hash(i * 4.1)) % 1;
          const x = x0 + hash(i * 1.9) * (x1 - x0) + Math.sin(now * 0.8 + i) * 0.3;
          const z = zF * (0.12 + 0.55 * hash(i * 6.7));
          const fl = 0.6 + 0.4 * Math.sin(now * 5 + i * 3);
          speck(fx, x, u * 4, z, 0.05, mix('#ffd36a', '#ff4a10', u, 0.5 * (1 - u) * fl));
        }
        break;
      }
      case 'snow': {
        for (let i = 0; i < 40; i++) {
          const h = hash(i + 21);
          const u = (now * 0.07 * (0.6 + h) + hash(i * 2.3)) % 1;
          const x = x0 + hash(i * 1.7) * (x1 - x0) + Math.sin(now * 0.6 + i) * 0.35;
          const z = zF * (0.08 + 0.6 * hash(i * 5.9));
          speck(fx, x, 4.5 * (1 - u), z, 0.035 + 0.03 * h, col('#ffffff', 0.35 * Math.min(1, u * 4)));
        }
        break;
      }
      case 'bubbles': {
        for (let i = 0; i < 22; i++) {
          const h = hash(i + 31);
          const u = (now * 0.09 * (0.6 + h) + hash(i * 3.1)) % 1;
          const x = x0 + hash(i * 2.1) * (x1 - x0) + Math.sin(now * 1.4 + i) * 0.12;
          const z = zF * (0.1 + 0.5 * hash(i * 4.3));
          const r = 0.04 + 0.05 * h;
          fx.ring(x, u * 4.5, z, r, r, 0.018, '#bff8ff', 0.4 * (1 - u), 1, 12);
        }
        break;
      }
      case 'pixels': {
        // a few pixels drifting down, a block at a time
        for (let i = 0; i < 18; i++) {
          const h = hash(i + 41);
          const u = Math.floor(((now * 0.12 * (0.5 + h) + hash(i * 1.3)) % 1) * 16) / 16;
          const x = x0 + (Math.floor(hash(i * 2.7) * 24) / 24) * (x1 - x0);
          const z = zF * (0.15 + 0.5 * hash(i * 6.1));
          square(fx, x, 4.5 * (1 - u), z, 0.07, 0.07, 0, col(RAINBOW[i % 6], 0.3));
        }
        break;
      }
      case 'disco': {
        // mirror-ball spots wheeling slowly over the floor
        for (let i = 0; i < 14; i++) {
          const ang = now * 0.25 + (i / 14) * Math.PI * 2;
          const rr = (x1 - x0) * (0.2 + 0.3 * hash(i + 2));
          const x = cx + Math.cos(ang) * rr;
          const z = zF * 0.3 + Math.sin(ang) * zF * 0.22;
          if (z < 0.5) continue;
          fx.halo(x, 0.014, z, 0.35, 0.7, RAINBOW[i % 6], 0.16 * (0.7 + 0.6 * (G.pulse || 0)), 1, 'y', 10);
        }
        break;
      }
      case 'scan': {
        // a drafting line passing slowly over the floor, toward you
        const z = zF * (1 - ((now / 7) % 1));
        fx.bar([x0, 0.013, z], [x1, 0.013, z], 0.025, col('#e8f2ff', 0.28));
        fx.q(x0, 0.012, z, x1, 0.012, z, x1, 0.012, z + 3, x0, 0.012, z + 3, col('#e8f2ff', 0.05), col('#e8f2ff', 0.05), BLANK, BLANK);
        break;
      }
      default:
    }
  }

  /** The style's hit effect, for hits younger than a second (sparks stay in highway.js, as always). */
  function hits(LK, list, targets) {
    const kind = LK.hit;
    if (!kind || kind === 'none' || kind === 'sparks' || env.calm()) return;
    const { fx } = R3.L;
    const now = performance.now();
    for (const h of list) {
      const age = (now - h.at) / 1000;
      if (age > 1.1) continue;
      const tg = targets[h.id];
      if (!tg) continue;
      const an = anchorAt(tg.t);
      for (const nt of tg.notes) {
        if (nt.mute) continue;
        const x0 = noteX(nt, an);
        const y0 = strH(nt.s);
        const hex = STRING[nt.s];
        const rnd = seeded((h.id + 1) * 7919 + nt.s * 104729);
        if (kind === 'flash') {
          if (age > 0.28) continue;
          const k = (1 - age / 0.28) ** 2;
          const w = 0.32;
          fx.q(x0 - w, y0 - 0.3, -0.12, x0, y0 - 0.3, -0.12, x0, y0 + 2.6, -0.12, x0 - w, y0 + 2.6, -0.12, BLANK, col(hex, 0.45 * k, 1.3), col(hex, 0), BLANK);
          fx.q(x0, y0 - 0.3, -0.12, x0 + w, y0 - 0.3, -0.12, x0 + w, y0 + 2.6, -0.12, x0, y0 + 2.6, -0.12, col(hex, 0.45 * k, 1.3), BLANK, BLANK, col(hex, 0));
        } else if (kind === 'ripple') {
          for (const d of [0, 0.14]) {
            const u = (age - d) / 0.6;
            if (u < 0 || u > 1) continue;
            const r = 0.25 + u * 2.4;
            floorRing(fx, x0, 0.014, 0.4, r, r * 1.8, 0.12, col(hex, 0.5 * (1 - u) * (1 - u), 1.2));
          }
        } else if (kind === 'embers') {
          for (let i = 0; i < 7; i++) {
            const life = 0.7 + rnd() * 0.4;
            const vx = (rnd() - 0.5) * 1.2;
            const vy = 0.9 + rnd() * 1.4;
            const ph = rnd() * 6;
            if (age > life) continue;
            const u = age / life;
            const fl = 0.7 + 0.3 * Math.sin(age * 30 + ph);
            speck(fx, x0 + vx * age + Math.sin(age * 6 + ph) * 0.06, y0 + vy * age, -0.1 - age * 0.3, 0.045, mix('#ffd36a', '#ff5a1a', u, (1 - u) * 0.8 * fl, 1.2));
          }
        } else if (kind === 'shards') {
          for (let i = 0; i < 6; i++) {
            const life = 0.38 + rnd() * 0.15;
            const ang = Math.PI / 2 + (rnd() - 0.5) * 2.6;
            const sp = 1.6 + rnd() * 1.6;
            const spin = (rnd() - 0.5) * 18;
            const s = 0.05 + rnd() * 0.04;
            if (age > life) continue;
            const u = age / life;
            const cx = x0 + Math.cos(ang) * sp * age;
            const cy = y0 + Math.sin(ang) * sp * age * 0.8 - 4 * age * age;
            const cz = -0.1 - age * 0.6;
            const r = spin * age;
            const c = mix(hex, '#ffffff', 0.55, (1 - u) * 0.85, 1.2);
            const p = (k) => [cx + Math.cos(r + k) * s, cy + Math.sin(r + k) * s];
            const [a1, b1] = p(0);
            const [a2, b2] = p(2.2);
            const [a3, b3] = p(4.0);
            fx.q(a1, b1, cz, a2, b2, cz, a3, b3, cz, a3, b3, cz, c, c, col(hex, (1 - u) * 0.4), col(hex, (1 - u) * 0.4));
          }
        } else if (kind === 'pixels') {
          // blocky: pixels jump outward a block at a time
          if (age > 0.5) continue;
          const d = Math.floor(age / 0.07) * 0.11;
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
            square(fx, x0 + Math.round(Math.cos(ang) * d * 8) / 8, y0 + Math.round(Math.sin(ang) * d * 8) / 8, -0.1, 0.05, 0.05, 0, col(i % 2 ? hex : '#ffffff', 0.9 * (1 - age / 0.5), 1.2));
          }
        } else if (kind === 'bubbles') {
          for (let i = 0; i < 5; i++) {
            const life = 0.7 + rnd() * 0.4;
            const vx = (rnd() - 0.5) * 0.5;
            const r = 0.04 + rnd() * 0.05;
            const ph = rnd() * 6;
            if (age > life) continue;
            const u = age / life;
            fx.ring(x0 + vx * age + Math.sin(age * 9 + ph) * 0.05, y0 + age * 1.3, -0.1, r, r, 0.02, mixHex(hex, '#ffffff', 0.5, 8), 0.7 * (1 - u), 1.2, 12);
          }
        } else if (kind === 'flake') {
          if (age > 0.6) continue;
          const u = age / 0.6;
          const r = 0.12 + 0.3 * (1 - (1 - u) * (1 - u));
          const c = mix(hex, '#ffffff', 0.6, 0.85 * (1 - u), 1.2);
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI + age * 1.5;
            const dx = Math.cos(a) * r;
            const dy = Math.sin(a) * r;
            fx.bar([x0 - dx, y0 - dy, -0.1], [x0 + dx, y0 + dy, -0.1], 0.025, c, c, 'z');
          }
        } else if (kind === 'confetti') {
          for (let i = 0; i < 9; i++) {
            const life = 0.8 + rnd() * 0.4;
            const ang = Math.PI / 2 + (rnd() - 0.5) * 2.2;
            const sp = 1.2 + rnd() * 1.2;
            const spin = (rnd() - 0.5) * 20;
            const c = RAINBOW[Math.floor(rnd() * 6)];
            if (age > life) continue;
            const u = age / life;
            const go = (1 - Math.exp(-age * 4)) / 4;
            square(fx, x0 + Math.cos(ang) * sp * go + Math.sin(age * 5 + i) * 0.05, y0 + Math.sin(ang) * sp * go - 0.6 * age * age, -0.1 - go * 0.3, 0.05, 0.025 * Math.abs(Math.cos(age * 8 + i)) + 0.008, spin * age, col(c, 0.9 * (1 - u), 1.1));
          }
        } else if (kind === 'dust' || kind === 'chalk') {
          const n = kind === 'dust' ? 10 : 7;
          const tint = kind === 'dust' ? '#e9d6b0' : '#f2f6ff';
          for (let i = 0; i < n; i++) {
            const life = 0.6 + rnd() * 0.35;
            const ang = rnd() * Math.PI * 2;
            const sp = 0.6 + rnd() * 0.7;
            if (age > life) continue;
            const u = age / life;
            const go = (1 - Math.exp(-age * 5)) / 5;
            speck(fx, x0 + Math.cos(ang) * sp * go, y0 + Math.sin(ang) * sp * go * 0.7 - 0.5 * age * age, -0.1 - go * 0.4, 0.04 + 0.05 * u, col(tint, 0.45 * (1 - u)));
          }
          if (kind === 'chalk' && age < 0.45) {
            const u = age / 0.45;
            const r = 0.3 + 0.35 * (1 - (1 - u) * (1 - u));
            fx.ring(x0, y0, -0.08, r, r * 0.62, 0.035, '#f2f6ff', 0.6 * (1 - u), 1);
          }
        }
      }
    }
  }

  return { rail, floorPattern, ambient, hits };
}
