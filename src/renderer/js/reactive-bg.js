/**
 * What paints the Fluid ink (3.12), from the shared music reading
 * (music-features.js): every part of the music has its own gesture, so you
 * can see the song's shape in the ink.
 *
 *   kick     two big plumes rise from the bottom corners toward the middle
 *   snare    a ring of bursts flies out from the centre
 *   bass     a slow, heavy swirl low down
 *   mids     a steady stream up the middle, coloured by the palette
 *   highs    small bright flecks near the top
 *   notes    the highway's notes in their string colours, along the neck
 *   guitar   what you play, in your note's colour (Jam has its own guitar ink)
 *
 * Every splash is mirrored left/right by fluidbg.js.
 */
import { hueRGB } from './fluidbg.js';
import { STRING_RGB } from './music-features.js';

export function createFluidDriver({ guitar = true, highway = false } = {}) {
  let beats = -1;
  let snapWas = 0;
  let attackWas = 0;
  const seen = new WeakSet();
  const k = highway ? 0.75 : 1; // a touch calmer behind the notes
  return function splats(F, t) {
    const out = [];
    const b = F.bands;
    const base = (F.t * 0.006) % 1;
    const col = (h, a) => hueRGB(((h % 1) + 1) % 1, a * k);
    // kick
    if (beats < 0) beats = F.beats;
    if (F.beats !== beats) {
      beats = F.beats;
      const p = 0.6 + F.kick * 0.8;
      out.push({ x: 0.06, y: 0.04, dx: 900 * p, dy: 1700 * p, radius: 1.2 + p * 0.6, ...col(base + 0.02 * (beats % 8), 0.14 * p) });
    }
    // snare and other sharp hits
    if (F.snap > snapWas + 0.25) {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.4;
        out.push({ x: 0.5 + Math.cos(a) * 0.08, y: 0.55 + Math.sin(a) * 0.1, dx: Math.cos(a) * 1500 * F.snap, dy: Math.sin(a) * 1500 * F.snap, radius: 0.45, ...col(base + 0.5 + i * 0.04, 0.09 * F.snap) });
      }
    }
    snapWas = F.snap;
    // steady layers, every call (about 25 times a second)
    const e = F.energy;
    if (e > 0.02) {
      const sw = t * 0.7;
      out.push({ x: 0.3 + Math.cos(sw) * 0.08, y: 0.2 + Math.sin(sw * 1.3) * 0.06, dx: -Math.sin(sw) * 500 * b[1], dy: Math.cos(sw) * 350 * b[1], radius: 1.6, ...col(base + 0.08, 0.018 * b[1] * e) });
      out.push({ x: 0.5, y: 0.32, dx: Math.sin(t * 1.1) * 260 * b[3], dy: 600 * (0.3 + b[3]), radius: 0.7, ...col(base + 0.33 + b[2] * 0.2, 0.03 * b[3] * e) });
      if (b[4] > 0.35) {
        const x = 0.15 + ((t * 7.31) % 0.7);
        out.push({ x, y: 0.82 + ((t * 3.7) % 0.12), dx: Math.sin(t * 9) * 250, dy: -150, radius: 0.18, ...col(base + 0.6, 0.06 * b[4]) });
      }
    }
    // the highway's notes, in their string's colour, along the neck
    for (const ev of F.events) {
      if (seen.has(ev)) continue;
      seen.add(ev);
      const c = STRING_RGB[ev.string] || [1, 1, 1];
      const a = (ev.hit ? 0.11 : 0.06) * k;
      const x = Math.max(0.04, Math.min(0.48, 0.04 + ((ev.fret || 0) / 24) * 0.44));
      out.push({ x, y: highway ? 0.36 : 0.3, dx: (Math.random() - 0.5) * 400, dy: ev.hit ? 1400 : 800, radius: ev.hit ? 0.75 : 0.5, r: c[0] * a, g: c[1] * a, b: c[2] * a });
    }
    // your guitar
    const g = F.guitar;
    if (guitar && g.on) {
      if (g.attack > attackWas + 0.3) {
        const x = 0.12 + (1 - Math.min(1, Math.max(0, (g.midi - 40) / 40))) * 0.3;
        out.push({ x, y: 0.5, dx: 0, dy: 1300, radius: 0.9, ...hueRGB(g.hue, 0.13 * k) });
      } else if (g.level > 0.25) {
        out.push({ x: 0.34, y: 0.45, dx: Math.sin(t * 3) * 300, dy: 500 * g.level, radius: 0.35, ...hueRGB(g.hue, 0.02 * g.level * k) });
      }
      attackWas = g.attack;
    }
    return out;
  };
}
