/**
 * The Fluid background (3.7): Pavel Dobryakov's WebGL ink simulation
 * (fluid/fluid.html, MIT) in a frame behind the highway or the Jam screen.
 * Stagehand paints it: from the song's chart (highway.js) and from your
 * guitar (guitarInk below). Every splash is mirrored left/right, so the ink
 * fills the whole picture like a kaleidoscope, and a slow pair of eddies
 * keeps it flowing between notes.
 */
import { h } from './ui.js';
import { rig } from './rig.js';

export function createFluid(host, { jam = false } = {}) {
  let frame = null;
  let api = null;
  let born = 0;
  let broken = false;
  let tries = 0;
  const look = () => {
    if (!api && frame) {
      try {
        api = frame.contentWindow.FluidVisuals || null;
      } catch (_) {
        api = null;
      }
    }
    return api;
  };
  const self = {
    get ready() {
      const a = look();
      return !!(a && a.splats);
    },
    /** True when the picture can't be made here (it was rebuilt a few times and still failed). */
    get failed() {
      return tries > 3;
    },
    ensure() {
      // 3.13: a picture that never started, or that the graphics card took away, used to
      // stay black until another background was picked; now it's rebuilt (a few tries)
      if (frame && (broken || (!self.ready && performance.now() - born > 5000))) {
        tries++;
        self.drop(true);
      }
      if (frame || self.failed) return;
      let dye = '';
      try {
        dye = localStorage.getItem('stagehand.fluidDye') || ''; // 1024 default; 512/256 for slower graphics
      } catch (_) {}
      broken = false;
      born = performance.now();
      frame = h('iframe.hw-fluid', { src: `fluid/fluid.html?embed=1${jam ? '&jam=1' : ''}${dye ? `&dye=${encodeURIComponent(dye)}` : ''}`, tabindex: '-1', 'aria-hidden': 'true', title: '' });
      const mine = frame;
      frame.addEventListener('load', () => {
        if (frame !== mine) return;
        look();
        try {
          const cv = frame.contentDocument && frame.contentDocument.querySelector('canvas');
          if (cv) cv.addEventListener('webglcontextlost', () => frame === mine && (broken = true));
        } catch (_) {}
      });
      host.prepend(frame);
    },
    drop(keepTries = false) {
      if (!keepTries) tries = 0;
      if (!frame) return;
      try {
        api && api.dispose();
      } catch (_) {}
      frame.remove();
      frame = api = null;
    },
    /** Splashes {x, y (0 = bottom), dx, dy, r, g, b, radius}; mirrored unless told not to. */
    send(list, { mirror = true } = {}) {
      if (!look() || !api.splats || !list.length) return;
      const out = mirror ? list.concat(list.map((s) => ({ ...s, x: 1 - s.x, dx: -(s.dx || 0) }))) : list;
      try {
        api.splats(out);
      } catch (_) {}
    },
  };
  return self;
}

/** A colour from a hue (0–1), full and bright, times k. */
export function hueRGB(hue, k = 1) {
  const f = (n) => {
    const kk = (n + hue * 6) % 6;
    return k * (1 - Math.max(0, Math.min(kk, 4 - kk, 1)));
  };
  return { r: f(5), g: f(3), b: f(1) };
}

/** Two slow eddies that drift around the picture: movement without new ink. */
export function ambient(t, energy = 0.3) {
  const out = [];
  const a = t * 0.35;
  for (const [cx, cy, s] of [[0.28, 0.55, 1], [0.72, 0.45, -1]]) {
    const x = cx + Math.cos(a * s) * 0.12;
    const y = cy + Math.sin(a * s * 1.3) * 0.15;
    const f = 90 + 260 * energy;
    out.push({ x, y, dx: -Math.sin(a * s) * f * s, dy: Math.cos(a * s) * f, radius: 2.2, r: 0, g: 0, b: 0 });
  }
  return out;
}

/**
 * Your guitar paints too: each note you pick bursts in its pitch's colour (a
 * rainbow round the 12 notes), placed by pitch (low notes out wide, high
 * notes toward the middle, or the other way), and a held note keeps
 * streaming while it rings. Reads the rig's input level and pitch.
 */
export function guitarInk() {
  const S = { lvl: 0, acc: 0, slow: 0, hue: 0, x: 0.2, last: 0, midi: null, wander: 0 };
  return function step(t, dt, { gain = 1 } = {}) {
    if (!rig.on || rig.muted || typeof rig.pitch !== 'function') return [];
    const l = Math.min(1, Math.sqrt(Math.max(0, rig.levels().input || 0)) * 2.2);
    const out = [];
    S.acc += dt;
    // a pick: the level jumps
    const onset = l > 0.12 && l > S.lvl * 1.5 + 0.04 && t - S.last > 0.08;
    S.slow += (l - S.slow) * Math.min(1, dt * 3);
    S.lvl = l;
    if (onset || S.acc >= 0.06) {
      const p = rig.pitch();
      if (p && p.midi) {
        S.midi = p.midi;
        S.hue = (((p.midi % 12) / 12) + 1) % 1;
        S.x = 0.06 + 0.4 * Math.min(1, Math.max(0, (p.midi - 38) / 50));
      }
    }
    S.wander += dt * 0.6;
    const y = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(S.wander));
    if (onset) {
      S.last = t;
      const k = (0.25 + l * 0.6) * gain;
      for (let j = 0; j < 3; j++) {
        const a = Math.PI * (0.2 + j * 0.3);
        out.push({ x: S.x, y, dx: Math.cos(a) * 900 * l, dy: Math.sin(a) * 900 * l + 300, radius: 0.7 + l * 0.6, ...hueRGB(S.hue + j * 0.04, k) });
      }
    } else if (S.acc >= 0.06 && l > 0.05) {
      out.push({ x: S.x, y, dx: Math.sin(t * 2.1) * 260, dy: 180 + l * 300, radius: 0.45, ...hueRGB(S.hue, (0.03 + l * 0.09) * gain) });
    }
    if (S.acc >= 0.06) S.acc = 0;
    return out;
  };
}
