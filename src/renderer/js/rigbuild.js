/**
 * 4.18: the board building itself, and the saved tone being checked over (Create a Tone).
 *
 * User: "show it as a quick animation of gear being laid on the board and settings being
 * adjusted, each in order. Add some slight shake and effects in line with our style. Same with
 * the final saving of a tone, show it as a quick animation of each piece in order."
 *
 * Build: the pieces drop onto the board one at a time in signal order (pedals, amp, cabinet,
 * loop pedals, rack), each lands with a small bounce and a soft glow, the amp and cabinet give
 * the board a little thud, and a strip of small dials turns from zero to the piece's settings.
 * Then the cables appear. About two to three seconds; a click or any key finishes it at once.
 * Save: each piece in the same order gets a glow and a tick, then the saved sticker.
 *
 * Only transforms and opacity move (Web Animations), nothing is laid out again, nothing flashes.
 * Nothing moves when the system asks for less motion or Calmer interface is on.
 */
import { gearInfo } from './gearspec.js';

const SLOT_RANK = { pre: 0, amp: 1, cab: 2, post: 3, rack: 4 };

/** True when the room should sit still. */
export function stillWanted() {
  try {
    if (document.documentElement.dataset.calm === 'true') return true;
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {
    return false;
  }
}
const lessDecoration = () => document.documentElement.dataset.decoration === 'reduced';

/** The pieces of a board in the order they are laid down. */
function piecesInOrder(board, tone) {
  const els = [...board.querySelectorAll(':scope > .rb-piece')];
  const slotOf = (el) => (tone && tone.gear[+el.dataset.i] ? tone.gear[+el.dataset.i].slot : ['pre', 'amp', 'cab', 'post', 'rack'].find((s) => el.classList.contains(s)) || 'pre');
  return els.map((el) => ({ el, i: +el.dataset.i, slot: slotOf(el) })).sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot] || a.i - b.i);
}

/** Up to four knobs worth showing: the ones the tone sets, in the order the piece has them. */
function dialsFor(g) {
  const info = g && gearInfo(g.key);
  if (!info || !info.k) return [];
  const set = g.knobs || {};
  const low = Object.fromEntries(Object.entries(set).map(([n, v]) => [n.toLowerCase(), v]));
  const out = [];
  for (const [name, key, min, max, def] of info.k) {
    if (/^(Mic |Room Mic)/.test(name)) continue;
    const v = key in set ? set[key] : low[name.toLowerCase()];
    if (v === undefined) continue;
    out.push({ name, min, max, v: Number(v), def });
    if (out.length === 4) break;
  }
  return out;
}
const shortName = (n) => n.replace(/\s*\(.*\)\s*/g, '').replace(/^Loudness /, 'Vol ').replace(/Frequency|Freq\./, 'Hz').slice(0, 9);
const fmt = (v, min, max) => (max - min <= 20 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)));

function wait(ms, run) {
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    run.timers.push(t);
    run.wakers.push(res);
  });
}

/** One run at a time per board; a new board or a skip ends it. */
function makeRun(board, onSkipKey) {
  const run = {
    over: false,
    timers: [],
    wakers: [],
    anims: [],
    extras: [],
    alive: () => !run.over && board.isConnected,
    end() {
      if (run.over) return;
      run.over = true;
      run.timers.forEach(clearTimeout);
      run.wakers.forEach((w) => w());
      for (const a of run.anims) {
        try {
          a.finish();
        } catch (_) {}
      }
      run.extras.forEach((x) => x.remove());
      document.removeEventListener('pointerdown', skip, true);
      document.removeEventListener('keydown', skipKey, true);
    },
  };
  const skip = () => run.end();
  const skipKey = (e) => {
    if (onSkipKey && !onSkipKey(e)) return;
    run.end();
  };
  document.addEventListener('pointerdown', skip, true);
  document.addEventListener('keydown', skipKey, true);
  return run;
}
const anim = (run, el, frames, opts) => {
  if (!el.animate) return null;
  const a = el.animate(frames, opts);
  run.anims.push(a);
  return a;
};

function glow(run, el, ms, warm = true) {
  if (lessDecoration()) return;
  const gl = document.createElement('span');
  gl.className = `rbk-glow${warm ? '' : ' cool'}`;
  el.append(gl);
  run.extras.push(gl);
  const a = anim(run, gl, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 0.9, transform: 'scale(1)', offset: 0.3 }, { opacity: 0, transform: 'scale(1.12)' }], { duration: ms, easing: 'ease-out' });
  if (a) a.onfinish = () => gl.remove();
  else setTimeout(() => gl.remove(), ms);
}

function dialStrip(run, board, at, dials, ms) {
  const strip = document.createElement('div');
  strip.className = 'rbk-dials';
  strip.style.left = `${Math.round(at.x)}px`;
  strip.style.top = `${Math.round(at.y + Math.min(at.h * 0.5, 70) - 6)}px`;
  const vals = [];
  for (const d of dials) {
    const cell = document.createElement('span');
    cell.className = 'rbk-dial';
    const face = document.createElement('i');
    const ptr = document.createElement('b');
    face.append(ptr);
    const val = document.createElement('em');
    val.textContent = fmt(d.min, d.min, d.max);
    const lab = document.createElement('small');
    lab.textContent = shortName(d.name);
    cell.append(face, val, lab);
    strip.append(cell);
    const p = Math.max(0, Math.min(1, (d.v - d.min) / (d.max - d.min || 1)));
    anim(run, ptr, [{ transform: 'rotate(-135deg)' }, { transform: `rotate(${-135 + 270 * p}deg)` }], { duration: ms, delay: 60, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
    vals.push([val, d]);
  }
  board.append(strip);
  run.extras.push(strip);
  anim(run, strip, [{ opacity: 0, transform: 'translate(-50%,6px)' }, { opacity: 1, transform: 'translate(-50%,0)' }], { duration: 140, easing: 'ease-out', fill: 'both' });
  // the numbers count up with the pointers
  const t0 = performance.now() + 60;
  const tick = (now) => {
    if (!run.alive() || !strip.isConnected) return;
    const k = Math.max(0, Math.min(1, (now - t0) / ms));
    const e = 1 - Math.pow(1 - k, 3);
    for (const [el, d] of vals) el.textContent = fmt(d.min + (d.v - d.min) * e, d.min, d.max);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return strip;
}
function fadeAway(run, strip, delay) {
  const a = anim(run, strip, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay, easing: 'ease-in', fill: 'forwards' });
  if (a) a.onfinish = () => strip.remove();
  else setTimeout(() => strip.remove(), delay + 220);
}

/**
 * Lay the board's pieces down one by one. Call it straight after the board is put on the page
 * (before the next paint) so the pieces don't show first and then vanish.
 *   board   the rigBoard element      tone   the tone it shows (for the knob values)
 *   onSkipKey(e)  return false to let a key through without skipping
 * Returns { running(), skip(), done } (done: a Promise for when it has finished or was skipped).
 */
export function playBuild(board, tone, { onSkipKey = null } = {}) {
  if (!board || stillWanted()) return { running: () => false, skip() {}, done: Promise.resolve() };
  board.classList.add('rbk-building');
  const run = makeRun(board, onSkipKey);
  const done = (async () => {
    // the board lays itself out on the next frame
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const list = run.alive() ? piecesInOrder(board, tone) : [];
    const step = Math.max(180, Math.min(300, 2400 / Math.max(1, list.length)));
    let prev = null;
    for (const p of list) {
      if (!run.alive()) break;
      p.el.classList.add('rbk-in');
      const big = p.slot === 'amp' || p.slot === 'cab';
      anim(run, p.el, [
        { opacity: 0, transform: `translateY(${big ? -46 : -34}px) scale(1.03)` },
        { opacity: 1, transform: 'translateY(3px) scale(.995)', offset: 0.55 },
        { transform: 'translateY(-1px) rotate(-.7deg)', offset: 0.75 },
        { transform: 'translateY(0) rotate(.35deg)', offset: 0.9 },
        { opacity: 1, transform: 'none' },
      ], { duration: big ? 320 : 280, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'backwards' });
      glow(run, p.el, 640, p.slot !== 'rack');
      if (big && !lessDecoration()) anim(run, board, [{ transform: 'none' }, { transform: 'translate(0,1.5px)' }, { transform: 'translate(-1px,-1px)' }, { transform: 'translate(1px,.5px)' }, { transform: 'none' }], { delay: 150, duration: 190, easing: 'linear' });
      const dials = dialsFor(tone && tone.gear[p.i]);
      const at = board.where && board.where(p.i);
      if (prev) fadeAway(run, prev, 0);
      prev = dials.length && at ? dialStrip(run, board, at, dials, Math.max(260, step * 1.5)) : null;
      await wait(step, run);
    }
    if (run.alive()) {
      board.classList.add('rbk-wired');
      if (prev) fadeAway(run, prev, 380);
      await wait(620, run);
    }
    run.end();
    board.classList.remove('rbk-building', 'rbk-wired');
    board.querySelectorAll('.rbk-in').forEach((el) => el.classList.remove('rbk-in'));
  })();
  return { running: () => !run.over, skip: () => run.end(), done };
}

/**
 * The saved tone checked over: each piece in signal order gets a glow and a tick.
 * Resolves when it's done (at once when skipped or when nothing should move).
 */
export function playSave(board, tone) {
  if (!board || !board.isConnected || stillWanted()) return Promise.resolve();
  const run = makeRun(board, null);
  return (async () => {
    const list = piecesInOrder(board, tone);
    // quick: the saved sticker and message follow straight after (about half a second)
    const step = Math.max(45, Math.min(90, 420 / Math.max(1, list.length)));
    for (const p of list) {
      if (!run.alive()) break;
      const at = board.where && board.where(p.i);
      anim(run, p.el, [{ transform: 'none' }, { transform: 'translateY(-3px) scale(1.02)', offset: 0.35 }, { transform: 'none' }], { duration: 240, easing: 'ease-out' });
      glow(run, p.el, 520, true);
      if (at) {
        const tk = document.createElement('span');
        tk.className = 'rbk-tick';
        tk.textContent = '✓';
        tk.style.left = `${Math.round(at.x + at.w * 0.3)}px`;
        tk.style.top = `${Math.round(at.y - at.h * 0.5 + 4)}px`;
        board.append(tk);
        run.extras.push(tk);
        anim(run, tk, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.3) rotate(-25deg)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.15) rotate(6deg)', offset: 0.6 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0)' }], { duration: 220, easing: 'ease-out', fill: 'both' });
      }
      await wait(step, run);
    }
    if (run.alive()) {
      const ticks = [...board.querySelectorAll(':scope > .rbk-tick')];
      for (const tk of ticks) anim(run, tk, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 650, fill: 'forwards' });
      // the ticks fade on their own while the sticker lands
      const t = setTimeout(() => run.end(), 1000);
      run.timers.push(t);
      return;
    }
    run.end();
  })();
}
