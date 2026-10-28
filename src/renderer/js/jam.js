/**
 * Jam (3.7): just you and the Fluid picture, full screen, no highway. Your
 * guitar paints the ink (pitch picks the colour, how hard you play the size),
 * the drums push from the corners when they're running, and a slow pair of
 * eddies keeps it moving. Open with the Jam button on Play or J; Esc leaves.
 */
import { api } from './api.js';
import { h, icon, esc, isTyping } from './ui.js';
import { rig } from './rig.js';
import { drums } from './drums.js';
import { createFluid, guitarInk, ambient, hueRGB } from './fluidbg.js';

const J = { open: false, raf: 0, last: 0, t: 0, beat: -1, ink: null, quietAt: 0 };

const root = h('div.jam', { hidden: true, role: 'dialog', 'aria-label': 'Jam' });
const back = h('button.jam-back', { type: 'button', title: 'Back (Esc)', html: `${icon('chevronLeft')}<span>Back</span>` });
const tone = h('div.jam-tone');
const drumBtn = h('button.jam-chip', { type: 'button', title: 'Drums on or off (Space)' });
const top = h('div.jam-top', null, back, h('span.jam-title', { text: 'Jam' }), h('span.grow'), tone, drumBtn);
const note = h('div.jam-note', { 'aria-live': 'off' });
const hint = h('div.jam-hint', { text: 'Play anything. Esc to leave.' });
root.append(top, note, hint);
document.body.append(root);
const fluid = createFluid(root, { jam: true });

back.onclick = () => closeJam();
drumBtn.onclick = () => (drums.on ? drums.stop() : drums.start());

function renderHud() {
  const t = rig.tone;
  tone.innerHTML = `${icon('guitar')}<span>${esc(t ? t.name || 'Tone' : 'Tone')}</span>`;
  tone.classList.toggle('off', !rig.on || rig.muted);
  tone.title = !rig.on ? 'Plug in your Rocksmith cable' : rig.muted ? 'Your guitar is muted' : 'Your tone (1–9 for your slots)';
  drumBtn.innerHTML = `${icon('drum')}<span>${drums.on ? `${drums.bpm} bpm` : 'Drums'}</span>`;
  drumBtn.setAttribute('aria-pressed', String(!!drums.on));
}
rig.addEventListener('change', () => J.open && renderHud());
drums.addEventListener('change', () => J.open && renderHud());

export function jamOpen() {
  return J.open;
}

export function openJam() {
  if (J.open) return;
  J.open = true;
  J.ink = guitarInk();
  J.beat = -1;
  J.last = performance.now();
  J.quietAt = performance.now();
  root.hidden = false;
  document.getElementById('app').classList.add('under-highway'); // nothing else draws underneath
  api.app.fullscreen(true).catch(() => {});
  fluid.ensure();
  renderHud();
  J.raf = requestAnimationFrame(frame);
}

export function closeJam() {
  if (!J.open) return;
  J.open = false;
  cancelAnimationFrame(J.raf);
  fluid.drop();
  root.hidden = true;
  document.getElementById('app').classList.remove('under-highway');
  api.app.fullscreen(false).catch(() => {});
}

// the drums' beats, as they're heard
function drumBeats(out) {
  if (!drums.on || !drums.ctx || !drums.startTime) return;
  const spb = 60 / drums.bpm;
  const lat = (drums.ctx.outputLatency || 0) + (drums.ctx.baseLatency || 0);
  const i = Math.floor((drums.ctx.currentTime - lat - drums.startTime) / spb);
  if (i < 0 || i === J.beat) return;
  J.beat = i;
  const bar = i % 4 === 0;
  const c = hueRGB((J.t * 0.02 + (bar ? 0.5 : 0.55)) % 1, bar ? 0.09 : 0.035);
  out.push({ x: 0.03, y: 0.04, dx: bar ? 1300 : 500, dy: bar ? 1500 : 650, radius: bar ? 1.5 : 0.9, ...c });
}

function frame(now) {
  if (!J.open) return;
  const dt = Math.min(0.1, (now - J.last) / 1000);
  J.last = now;
  J.t += dt;
  if (fluid.ready) {
    const out = J.ink(J.t, dt, { gain: 1.3 });
    drumBeats(out);
    const lvl = rig.on ? Math.min(1, Math.sqrt(rig.levels().input || 0) * 2.2) : 0;
    if (lvl > 0.05) J.quietAt = now;
    // keep it flowing between notes
    if (Math.floor(J.t * 20) !== Math.floor((J.t - dt) * 20)) out.push(...ambient(J.t, lvl));
    fluid.send(out);
    // the note you're playing, big and faint
    if (Math.floor(J.t * 12) !== Math.floor((J.t - dt) * 12)) {
      const p = lvl > 0.06 ? rig.pitch() : null;
      const txt = p ? `${p.note}` : '';
      if (note.textContent !== txt) note.textContent = txt;
      if (p) note.style.setProperty('--c', `hsl(${Math.round(((p.midi % 12) / 12) * 360)} 90% 70%)`);
    }
  }
  // controls fade while you play
  root.classList.toggle('jam-quiet', now - J.quietAt < 2500 && now - (J.moved || 0) > 2500);
  J.raf = requestAnimationFrame(frame);
}
root.addEventListener('pointermove', () => (J.moved = performance.now()));

document.addEventListener(
  'keydown',
  (e) => {
    if (!J.open) {
      if ((e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.altKey && !e.metaKey && !isTyping() && !document.querySelector('.highway:not([hidden])')) {
        openJam();
        e.preventDefault();
      }
      return;
    }
    J.moved = performance.now();
    if (e.key === 'Escape') {
      closeJam();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.code === 'Space') {
      drumBtn.click();
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);

if (typeof window !== 'undefined') window.__jam = { open: openJam, close: closeJam, state: J }; // tests
