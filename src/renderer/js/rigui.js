/**
 * Shared pieces for the rig on the Play and Tones pages: rotary knobs, the
 * signal chain of gear blocks, and tone demos (a riff played through a tone).
 */
import { gearArt } from './gearart.js';
import { h, esc, icon, toast } from './ui.js';
import { rig } from './rig.js';
import { engine } from './stage.js';
import { TYPE_GELS, TYPE_NAMES, orderedGear, knobsOf, shortGearName } from './tonelib.js';
import { renderTone, demoRiff } from './render.js';
import { resolveCapture } from './captures.js';

export function fmtKnob(k, v) {
  const span = k.max - k.min;
  if (span >= 20) return String(Math.round(v));
  if (span >= 2) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * A rotary knob: drag up/down (Shift for fine), wheel, arrow keys,
 * double-click for the default.
 */
export function rotaryKnob({ name, min = 0, max = 1, value, def, gel = 'var(--tungsten)', fmt, step, onInput, onChange }) {
  const el = h('button.rknob', { type: 'button', role: 'slider', 'aria-label': name, 'aria-valuemin': String(min), 'aria-valuemax': String(max), style: { '--gel': gel } });
  const ring = h('span.ring', null, h('span.cap', null, h('span.ptr')));
  const label = h('span.kn-name', { text: name, title: name });
  const val = h('span.kn-val');
  el.append(ring, label, val);
  const st = step || (max - min >= 20 ? 1 : (max - min) / 100);
  let v = Number(value);
  const show = () => {
    const t = (v - min) / (max - min || 1);
    ring.style.setProperty('--deg', `${Math.round(270 * t)}deg`);
    ring.style.setProperty('--rot', `${Math.round(-135 + 270 * t)}deg`);
    val.textContent = fmt ? fmt(v) : String(Math.round(v * 100) / 100);
    el.setAttribute('aria-valuenow', String(v));
    el.setAttribute('aria-valuetext', val.textContent);
  };
  const set = (nv, final) => {
    nv = Math.max(min, Math.min(max, nv));
    nv = Math.round(nv / st) * st;
    if (nv === v && !final) return;
    v = nv;
    show();
    if (onInput) onInput(v);
    if (final && onChange) onChange(v);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    let y = e.clientY;
    const move = (ev) => {
      const dy = y - ev.clientY;
      y = ev.clientY;
      set(v + (dy / (ev.shiftKey ? 600 : 160)) * (max - min));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      set(v, true);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    set(v - Math.sign(e.deltaY) * st * (e.shiftKey ? 1 : 3), true);
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowRight') set(v + st * (e.shiftKey ? 10 : 1), true);
    else if (k === 'ArrowDown' || k === 'ArrowLeft') set(v - st * (e.shiftKey ? 10 : 1), true);
    else if (k === 'Home') set(min, true);
    else if (k === 'End') set(max, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('dblclick', () => def !== undefined && set(Number(def), true));
  show();
  return el;
}

/** The signal chain: gear blocks joined by glowing cables. */
export function chainEl(tone, { selected = -1, onPick, onAdd, sub } = {}) {
  const box = h('div.chain', { role: 'list', 'aria-label': 'Signal chain' });
  const gear = orderedGear(tone);
  gear.forEach((g, i) => {
    const kind = TYPE_NAMES[g.slot] || 'Pedal';
    const gel = TYPE_GELS[g.slot] || '#ff4d8d';
    const b = h(`button.block${g.slot === 'amp' ? '.amp' : ''}${g.bypass ? '.bypass' : ''}`, { type: 'button', role: 'listitem', 'aria-pressed': String(i === selected), style: { '--gel': gel }, title: g.bypass ? 'Bypassed' : '' });
    // a real amp (NAM capture) in the amp's place shows REAL
    const real = g.slot === 'amp' && !g.bypass && resolveCapture(tone);
    b.innerHTML = `<span class="bk-top"><span class="bk-kind">${esc(kind)}</span>${real ? `<span class="real-badge sm" title="${esc(`Real amp: ${real.pack.title}`)}">REAL</span>` : ''}<span class="led"></span></span><span class="bk-name">${esc(shortGearName(g.key))}</span>${sub ? `<span class="bk-sub">${esc(sub(g) || '')}</span>` : ''}`;
    if (real) b.classList.add('real');
    // 4.1.7: a picture of the piece (Stagehand's own drawing)
    b.prepend(h('span.bk-art', { html: gearArt(g), 'aria-hidden': 'true' }));
    b.onclick = () => onPick && onPick(i, g);
    if (i === selected) b.classList.add('lit');
    const link = h('div.link', null, b);
    if (i < gear.length - 1 || onAdd) link.append(h('span.cable', { 'aria-hidden': 'true', style: { animationDelay: `${(-0.12 * i).toFixed(2)}s` } }));
    box.append(link);
  });
  if (onAdd) {
    const add = h('button.block.add', { type: 'button', text: '+ Add' });
    add.onclick = (e) => onAdd(e);
    box.append(add);
  }
  return { el: box, gear };
}

/** A short summary of a block's main knobs, for the chain. */
export function gearSummary(g) {
  const ks = knobsOf(g).slice(0, 2);
  return ks.map((k) => `${k.name} ${fmtKnob(k, k.value)}`).join(' · ');
}

// ------------------------------------------------------------ tone demos --
const D = { src: null, gain: null, ctx: null, playing: null, cache: new Map() };

export function demoPlaying() {
  return D.playing;
}

/** Plays a short riff through a tone (on the same output as the song). id marks which button shows as playing. */
export async function playDemo(tone, id, onEnd) {
  stopDemo();
  if (!tone || !tone.gear || !tone.gear.length) return;
  D.playing = id || 'demo';
  const done = () => {
    if (D.playing === (id || 'demo')) D.playing = null;
    if (onEnd) onEnd();
    document.dispatchEvent(new Event('sh-demo'));
  };
  try {
    const { ctx, node } = await engine.extraOut();
    if (D.ctx !== ctx) {
      D.ctx = ctx;
      D.gain = ctx.createGain();
      D.gain.gain.value = 0.9;
      D.gain.connect(node);
    }
    const rate = ctx.sampleRate;
    const cap = resolveCapture(tone);
    const key = `v2|${rate}|${tone.kind}|${JSON.stringify(tone.gear)}|${cap ? `${cap.path}|${cap.gainRef}` : ''}`;
    let out = D.cache.get(key);
    if (!out) {
      const di = demoRiff(rate, tone.kind === 'bass' ? 'bass' : 'guitar', tone);
      out = await renderTone(tone, di, rate, { input: 0.5, volume: 0.7 });
      D.cache.set(key, out);
      if (D.cache.size > 12) D.cache.delete(D.cache.keys().next().value);
    }
    if (D.playing !== (id || 'demo')) return;
    const b = ctx.createBuffer(2, out.L.length, rate);
    b.copyToChannel(out.L, 0);
    b.copyToChannel(out.R, 1);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(D.gain);
    s.onended = () => {
      if (D.src === s) D.src = null;
      done();
    };
    s.start();
    D.src = s;
  } catch (err) {
    D.playing = null;
    toast({ title: 'Couldn’t play the demo', message: err.message, kind: 'err' });
    if (onEnd) onEnd();
  }
}

export function stopDemo() {
  const s = D.src;
  D.src = null;
  const was = D.playing;
  D.playing = null;
  if (was) setTimeout(() => document.dispatchEvent(new Event('sh-demo')), 0);
  if (s) {
    try {
      s.onended = null;
      s.stop();
    } catch (_) {}
  }
}

/** A ▶ button that plays a tone's demo riff and shows when it's playing. */
export function demoButton(tone, id, { label = '', cls = '' } = {}) {
  const b = h(`button.demo-btn${cls ? `.${cls}` : ''}`, { type: 'button', 'aria-label': `Hear a demo riff${tone && tone.name ? `: ${tone.name}` : ''}` });
  const paint = () => {
    const on = D.playing === id;
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `${on ? '<span class="eq"><i></i><i></i><i></i></span>' : icon('play')}${label ? `<span>${esc(on ? 'Playing…' : label)}</span>` : ''}`;
  };
  b.onclick = (e) => {
    e.stopPropagation();
    if (D.playing === id) {
      stopDemo();
      paint();
    } else {
      playDemo(tone, id, paint);
      paint();
      document.dispatchEvent(new Event('sh-demo'));
    }
  };
  const onAny = () => {
    if (!b.isConnected) return document.removeEventListener('sh-demo', onAny);
    paint();
  };
  document.addEventListener('sh-demo', onAny);
  paint();
  return b;
}
