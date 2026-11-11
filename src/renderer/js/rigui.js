/**
 * Shared pieces for the rig on the Play and Tones pages: rotary knobs, the
 * signal chain of gear blocks, and tone demos (a riff played through a tone).
 */
import { gearArt } from './gearart.js';
import { gearPhotoInfo } from './gear-photos.js';
import { h, esc, icon, toast, modal } from './ui.js';
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
    el.setAttribute('data-max', String(t >= 1));
  };
  const set = (nv, final) => {
    if (el.disabled || !Number.isFinite(Number(nv))) return;
    nv = Math.max(min, Math.min(max, nv));
    nv = Math.max(min, Math.min(max, min + Math.round((nv - min) / st) * st));
    if (nv === v && !final) return;
    v = nv;
    show();
    if (onInput) onInput(v);
    if (final && onChange) onChange(v);
    el.dispatchEvent(new CustomEvent('knobinput', { detail: v }));
  };
  // Linked faceplate controls update the same values without rebuilding the
  // editor (which would lose pointer capture midway through a drag).
  el.setValue = (nv, { emit = false, final = false } = {}) => {
    if (emit) return set(nv, final);
    if (!Number.isFinite(Number(nv))) return;
    v = Math.max(min, Math.min(max, Number(nv))); show();
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || el.disabled) return;
    el.focus({preventScroll:true});
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
      el.removeEventListener('lostpointercapture', up);
      set(v, true);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
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

/** An enlarged gear face with real linked controls placed over its knobs.
 * Unmapped controls remain in the labeled control row; no fake physical knob.
 * The supplied controls own audio, draft, save and undo semantics. */
export function gearFaceplate(key, controls, { enlarged = false } = {}) {
  const item = gearPhotoInfo(key);
  if (!item) return null;
  const wrap = h('div.gear-faceplate');
  wrap.classList.toggle('portrait',item.height>item.width);
  const face = h('div.gear-face', {style:{aspectRatio:`${item.width} / ${item.height}`}});
  const photo = h('img', {src:`art/gear/${item.file}`,alt:`${item.name} gear face`,draggable:false});
  photo.onerror = () => { wrap.hidden = true; };
  face.append(photo);
  wrap.classList.toggle('enlarged', !!enlarged);
  const src = `art/gear/${item.file}`;
  const ratio = item.height / item.width;
  let count = 0;
  const cleanup = [];
  for (const original of controls.querySelectorAll('.rknob')) {
    const name = original.getAttribute('aria-label');
    const pos = item.knobs?.[name.toLowerCase()];
    if (!pos) continue;
    const overlay = rotaryKnob({name,
      min:Number(original.getAttribute('aria-valuemin')),
      max:Number(original.getAttribute('aria-valuemax')),
      value:Number(original.getAttribute('aria-valuenow')),
      step: item.steps?.[name.toLowerCase()],
      onInput:v=>original.setValue(v,{emit:true}),
      onChange:v=>original.setValue(v,{emit:true,final:true})});
    overlay.classList.add('gear-hotspot');
    overlay.style.left=pos[0]+'%'; overlay.style.top=pos[1]+'%';
    if (item.turn && pos.length >= 4) {
      // Rock Opera: the knob face is cut from the photo itself and turned, so the real knob moves.
      const [x, y, r, a0] = pos;
      const d = 2 * r;                       // face size, % of the photo's width
      const sw = 100 / d, sh = sw * ratio;    // photo size in face widths
      const ox = (x - r) / d, oy = (y * ratio - r) / d;
      overlay.classList.add('turns');
      overlay.style.setProperty('--knob-size', d + '%');
      const cap = h('span.photo-cap', { style: {
        backgroundImage: `url("${src}")`,
        backgroundSize: `${(sw * 100).toFixed(3)}% ${(sh * 100).toFixed(3)}%`,
        backgroundPosition: `${(ox / (sw - 1) * 100).toFixed(3)}% ${(oy / (sh - 1) * 100).toFixed(3)}%`,
        '--a0': `${a0}deg`,
      } });
      const ring = overlay.children && overlay.children[0];
      if (ring && ring.append) ring.append(cap);
    } else {
      overlay.style.setProperty('--knob-size',(pos[2] ? pos[2] * 2 : 5)+'%');
    }
    overlay.title=`${name}: drag up or down (Shift for fine), double-click to reset`;
    overlay.disabled=original.disabled;
    const sync=e=>overlay.setValue(e.detail);
    original.addEventListener('knobinput',sync);
    cleanup.push(()=>original.removeEventListener('knobinput',sync));
    overlay.addEventListener('dblclick',()=>original.dispatchEvent(new MouseEvent('dblclick')));
    face.append(overlay); count++;
  }
  wrap.append(face,h('small.gear-face-help',{text:count ? 'Grab a knob and drag up or down · Shift for fine · double-click to reset' : 'Set this one with the knobs below'}));
  if (!enlarged) {
    const zoom = h('button.btn.small.soft.gear-enlarge',{type:'button',text:'Get up close',title:'Open this gear big, with the same live knobs'});
    zoom.onclick=()=>{const large=gearFaceplate(key,controls,{enlarged:true});modal({title:item.name,wide:true,body:large,onClose:()=>large.dispose()});};
    wrap.append(zoom);
  }
  wrap.dispose=()=>cleanup.forEach(fn=>fn());
  return wrap;
}

/** Rock Opera: the tone's gear set up on a stage. Pedals on the floor, the amp head
 * stacked on its cabinet, rack units off to the side. Click a piece to open it. */
export function gearLineup(tone, { onPick } = {}) {
  const box = h('div.gear-lineup', { role: 'list', 'aria-label': 'The gear in this tone' });
  const gear = orderedGear(tone);
  const piece = (g, i, extra = '') => {
    const b = h(`button.lineup-piece.${g.slot}${extra}${g.bypass ? '.bypass' : ''}`, { type: 'button', role: 'listitem', title: `${shortGearName(g.key)}${g.bypass ? ' (off)' : ''}` });
    b.append(h('span.lp-art', { html: gearArt(g), 'aria-hidden': 'true' }), h('span.lp-name', { text: shortGearName(g.key) }));
    b.onclick = () => onPick && onPick(i, g);
    return b;
  };
  const pre = h('div.lineup-floor.pre'), post = h('div.lineup-floor.post'), racks = h('div.lineup-rack');
  const stack = h('div.lineup-stack');
  gear.forEach((g, i) => {
    if (g.slot === 'amp') stack.prepend(piece(g, i));
    else if (g.slot === 'cab') stack.append(piece(g, i));
    else if (g.slot === 'rack') racks.append(piece(g, i));
    else (g.slot === 'pre' ? pre : post).append(piece(g, i, '.pedal'));
  });
  for (const part of [pre, stack, post, racks]) if (part.children.length) box.append(part);
  return box;
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
