/**
 * 4.6: shared pieces for the Gear Showroom and the Create a Tone rig.
 *
 *   gearItems()        every piece of gear, one entry per amp / pedal / rack unit / cabinet family
 *   GEAR_CATS          the shelves the gear sits on (amps, drive, modulation, …)
 *   knobHelp(name)     what a knob does, in plain words (the tooltips)
 *   gearPanel(g, …)    the big view of one piece: its photo with the knobs that turn on it, and
 *                      every knob on the control strip beside it (photo knobs and strip knobs are
 *                      the same controls). Knobs the photo can't show are never faked on it.
 *   micPanel(g, …)     the cabinet's mic: drag it across the speaker, pick the mic, move it back
 *   rigBoard(tone, …)  the rig laid out like a real pedalboard, with braided cables between the
 *                      pieces and a light pulse along them that follows what you play
 */
import { h, esc } from './ui.js';
import { gearInfo, gearName } from './gearspec.js';
import { gearPhotoInfo, GEAR_PHOTOS } from './gear-photos.js';
import { gearArt } from './gearart.js';
import { rotaryKnob, fmtKnob, gearFaceplate } from './rigui.js';
import { knobsOf, orderedGear } from './tonelib.js';

export const CAB_RE = /^(.*)_(57|Condenser|Ribbon|Tube)_(Cone|Edge|OffAxis)$/;
export const MICS = [
  ['57', 'Dynamic', 'The classic stage mic: punchy, a bit of bite'],
  ['Condenser', 'Condenser', 'Detailed and airy: hears everything'],
  ['Ribbon', 'Ribbon', 'Smooth and dark: softens harsh highs'],
  ['Tube', 'Tube', 'Warm and round: thick lows, gentle top'],
];
export const POSITIONS = [
  ['Cone', 'Cone', 0.08],
  ['Edge', 'Edge', 0.72],
  ['OffAxis', 'Off axis', 0.4],
];

/** The shelves. A piece sits on exactly one. */
export const GEAR_CATS = [
  { id: 'amps', label: 'Amps', hint: 'Guitar amp heads and combos' },
  { id: 'bassamps', label: 'Bass amps', hint: 'Bass heads, combos and DI boxes' },
  { id: 'cabs', label: 'Cabinets', hint: 'Speakers, and the mic in front of them' },
  { id: 'drive', label: 'Drive & fuzz', hint: 'Overdrive, distortion, fuzz, boosts' },
  { id: 'mod', label: 'Modulation', hint: 'Chorus, flanger, phaser, vibe, tremolo, rotary' },
  { id: 'delay', label: 'Delay', hint: 'Echoes' },
  { id: 'reverb', label: 'Reverb', hint: 'Rooms, halls, springs and plates' },
  { id: 'filter', label: 'Wah & filter', hint: 'Wahs, auto-wahs, envelope filters' },
  { id: 'dynamics', label: 'Comp, gate & EQ', hint: 'Compressors, limiters, gates, EQs' },
  { id: 'pitch', label: 'Pitch & octave', hint: 'Octavers, pitch shifters, harmonizers' },
  { id: 'rack', label: 'Rack units', hint: 'Studio effects after the cabinet' },
];

let ITEMS = null;
let DB = null;

/** Every piece of gear (needs gear2014.json loaded: pass the table from loadGear()). */
export function gearItems(db) {
  if (ITEMS && db === DB) return ITEMS;
  DB = db;
  const out = [];
  const fams = {};
  for (const [key, g] of Object.entries(db || {})) {
    const bass = /^Bass_|^DI_/.test(key);
    if (g.t === 'cab') {
      const m = CAB_RE.exec(key);
      const base = m ? m[1] : key;
      const f = (fams[base] = fams[base] || { key: base, t: 'cab', slot: 'cab', cat: 'cabs', bass: base.startsWith('Bass_'), name: cabFamilyName(g.n), keys: {}, pa: g.c === 'PA' });
      f.keys[m ? `${m[2]}|${m[3]}` : 'any|any'] = key;
      continue;
    }
    let cat;
    if (g.t === 'amp') cat = bass ? 'bassamps' : 'amps';
    else if (g.t === 'rack') cat = 'rack';
    else cat = { Distortion: 'drive', Modulation: 'mod', Tremolo: 'mod', Delay: 'delay', Reverb: 'reverb', Filter: 'filter', Dynamics: 'dynamics', Pitch: 'pitch' }[g.c] || 'drive';
    out.push({ key, t: g.t, slot: g.t === 'amp' ? 'amp' : g.t === 'rack' ? 'rack' : defaultSlot(g.c), cat, bass, name: g.n, sub: g.c });
  }
  for (const f of Object.values(fams)) {
    f.defaultKey = f.keys['57|Cone'] || Object.values(f.keys)[0];
    f.sub = f.pa ? 'PA speaker' : 'Cabinet';
    out.push(f);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  ITEMS = out;
  return out;
}

const cabFamilyName = (n) => String(n || '').replace(/\s*\((Dynamic|Condenser|Ribbon|Tube)[^)]*\)\s*$/i, '').replace(/\s*-\s*(Dynamic|Condenser|Ribbon|Tube).*$/i, '').trim();

/** Where a pedal goes by default: drives, filters, compressors and pitch in front of the amp,
 * modulation, delay and reverb in the amp's loop (after it), like most real rigs. */
export function defaultSlot(cat) {
  return /Modulation|Tremolo|Delay|Reverb/.test(cat || '') ? 'post' : 'pre';
}

/** The photo (or Stagehand's drawing) of a piece, for cards and the board. */
export function gearThumb(key, slot, { full = false } = {}) {
  const p = gearPhotoInfo(key);
  if (p) {
    const img = h('img', { src: `art/gear/${full ? p.file : p.thumb || p.file}`, alt: '', loading: 'lazy', decoding: 'async', draggable: false });
    img.onerror = () => img.replaceWith(h('span.gb-drawing', { html: gearArt({ slot, key }) }));
    return img;
  }
  return h('span.gb-drawing', { html: gearArt({ slot, key }) });
}

export const hasPhoto = (key) => !!gearPhotoInfo(key);
export const photoCount = () => Object.keys(GEAR_PHOTOS).length;

// ------------------------------------------------------------ knob help --
const HELP = [
  [/^(gain|drive|distortion|preamp|smash|overdrive)/, 'How hard the sound is pushed: low is clean, high is crunchy and saturated'],
  [/^(vol|volume|loudness|level|master|output|limit$)/, 'How loud this piece is. Turning it up on an old amp also adds grit'],
  [/^bass( boost)?$|^low$|^30hz|^50hz|^63hz|^75hz|^90hz|^100hz/, 'The low end: thump and weight'],
  [/^(mid|midrange|mid-range|lo mid|low-mid|hi mid|high-mid)$|^(180|185|200|250|340|400|460|750|800)hz|^1\.\dkhz/, 'The middle: punch, and how well you cut through a band'],
  [/^(treble|high|bright)$|^(2\.\d|3\.2|5\.7|6\.\d|7\.5|15|16)khz/, 'Brightness and bite'],
  [/^presence/, 'The very top, after the distortion: sparkle and edge'],
  [/^deep/, 'Extra low-end thump'],
  [/punch/, 'Low-mid punch: more is tighter and harder hitting'],
  [/freq|shift|frequency|select|voicing|transition/, 'Which frequencies the knob next to it works on'],
  [/"q"/, 'How narrow the band is: narrow is surgical, wide is musical'],
  [/^tone$|^hi cut|^hifilter|^hi filter/, 'Dark to bright'],
  [/^(mix|blend|balance|clones!)$/, 'How much of the effect you hear against your own dry sound'],
  [/^(rate|speed|mod rate)$/, 'How fast it moves'],
  [/^(depth|mod depth|intensity)$/, 'How deep the movement is'],
  [/^(feedback|regen\.?)$/, 'How many echoes: high keeps repeating'],
  [/^time( left| right)?$|^delay$/, 'Time between echoes (or how long the reverb lasts)'],
  [/^decay$/, 'How long the reverb rings out'],
  [/^diffusion$/, 'How smooth the reverb is: low sounds like separate echoes'],
  [/^(compression|ratio|sustain)$/, 'How much it squeezes loud and soft notes together'],
  [/^threshold$/, 'How loud a note has to be before this kicks in'],
  [/attack/, 'How fast it reacts when you hit a note'],
  [/release|recovery/, 'How fast it lets go after a note'],
  [/sensitiv/, 'How strongly it follows how hard you pick'],
  [/^pedal/, 'Where the rocking pedal sits (heel to toe)'],
  [/auto-mode/, 'Moves by itself when on, or stays where you set it'],
  [/filter type|waveform|^wave$|^voice$/, 'The shape or flavor of the effect'],
  [/^resonance$/, 'How peaky and vocal the filter sounds'],
  [/low filter|lofilter|lo filter|^lo cut/, 'Cuts low end from the effect so it doesn’t get muddy'],
  [/^(pitch|pitch 1|octave-up!)$/, 'How far up or down the extra notes are'],
  [/^(enhance|body)$/, 'Adds fullness and clarity'],
  [/^(stereo|pan|spread)$/, 'Where it sits left to right'],
  [/^speaker$/, 'Speaker drive: more is breakup from the speaker itself'],
  [/downsample|bit depth|rectify/, 'Lo-fi: crushes the sound into gritty digital bits'],
  [/^(boost!|funk)$/, 'An extra switch that adds a boost or a scooped funk curve'],
  [/^mic position/, 'Where the mic points: center of the speaker (bright) to the edge (warm)'],
  [/^mic distance/, 'How far back the mic is: close is tight and bassy, far adds the room'],
  [/^mic angle/, 'Straight at the speaker, or angled away (smoother highs)'],
  [/^room mic/, 'How much of the second mic further back in the room'],
];

export function knobHelp(name) {
  const n = String(name || '').toLowerCase().trim();
  for (const [re, text] of HELP) if (re.test(n)) return text;
  return 'Turn it and listen';
}

// ------------------------------------------------------------ the panel --
/**
 * The big view of one piece in a tone: photo with its turning knobs + the control strip.
 * onKnob(key, value, final) is called as knobs move.
 */
export function gearPanel(g, { gel = '#c9a560', onKnob, disabled = false } = {}) {
  const box = h('div.gb-panel');
  const strip = h('div.gb-strip', { role: 'group', 'aria-label': `${gearName(g.key)} controls` });
  const ks = knobsOf(g);
  const photo = gearPhotoInfo(g.key);
  const onPhoto = new Set(Object.keys((photo && photo.knobs) || {}));
  for (const k of ks) {
    const knob = rotaryKnob({
      name: k.name,
      min: k.min,
      max: k.max,
      value: k.value,
      def: k.def,
      gel,
      fmt: (v) => fmtKnob(k, v),
      onInput: (v) => onKnob && onKnob(k.key, v, false),
      onChange: (v) => onKnob && onKnob(k.key, v, true),
    });
    knob.disabled = disabled;
    const cell = h('div.gb-knob', { title: `${k.name}: ${knobHelp(k.name)}. Drag up or down, Shift for fine, double-click for the default.` }, knob);
    if (onPhoto.has(k.name.toLowerCase())) cell.classList.add('on-photo');
    strip.append(cell);
  }
  if (!ks.length) strip.append(h('p.gb-none', { text: 'Nothing to set on this one: it just does its thing.' }));
  const face = photo ? gearFaceplate(g.key, strip, { enlarged: true }) : null;
  if (face) {
    face.querySelector('.gear-face-help')?.remove();
    box.append(h('div.gb-photo', { style: { '--ar': String(photo.width / photo.height) } }, face));
  } else box.append(h('div.gb-photo.drawing', { html: gearArt(g) }));
  const note = !ks.length ? '' : onPhoto.size === ks.length ? 'Turn the knobs on the photo or on the strip: they’re the same knobs.' : onPhoto.size ? 'Knobs you can’t see on the photo are on the strip below.' : 'Set it with the knobs on the strip.';
  box.append(h('div.gb-strip-wrap', null, note ? h('small.gb-note', { text: note }) : '', strip));
  box.dispose = () => face && face.dispose && face.dispose();
  return box;
}

// -------------------------------------------------------------- the mic --
/** Cabinet + mic. Continuous mic knobs live on the cab's gear entry (Mic Position, Mic Distance,
 * Mic Angle, Room Mic); the mic type and the named position stay in its Rocksmith key. */
export const MIC_KNOBS = [
  ['Mic Position', 0, 100],
  ['Mic Distance', 0, 100],
  ['Mic Angle', 0, 100],
  ['Room Mic', 0, 100],
];

export function micDefaults(key) {
  const m = CAB_RE.exec(key || '');
  const pos = m ? m[3] : 'Cone';
  return { 'Mic Position': pos === 'Edge' ? 72 : pos === 'OffAxis' ? 40 : 8, 'Mic Distance': 10, 'Mic Angle': pos === 'OffAxis' ? 70 : 0, 'Room Mic': 0 };
}

export function micValues(g) {
  const d = micDefaults(g.key);
  const k = g.knobs || {};
  const out = {};
  for (const [n] of MIC_KNOBS) out[n] = Number.isFinite(Number(k[n])) ? Number(k[n]) : d[n];
  return out;
}

/**
 * The speaker with the mic in front: drag the mic across the cone (center = bright, edge = warm),
 * the four mic types, and knobs for distance, angle and a room mic.
 * on(patch) → { key?, knobs? }; final tells whether the drag is done.
 */
export function micPanel(g, family, { on, disabled = false, reason = '' } = {}) {
  const box = h('div.gb-mic');
  const m = CAB_RE.exec(g.key);
  const mic = m ? m[2] : '57';
  const v = micValues(g);
  const cone = h('div.mic-cone', { role: 'slider', tabindex: '0', 'aria-label': 'Mic position on the speaker', 'aria-valuemin': '0', 'aria-valuemax': '100' });
  const dot = h('span.mic-dot', { 'aria-hidden': 'true' }, h('i'));
  const ring = h('span.mic-dist', { 'aria-hidden': 'true' });
  cone.append(h('span.mic-dustcap'), h('span.mic-surround'), ring, dot);
  const lbl = h('small.mic-read');
  const paint = () => {
    const p = v['Mic Position'] / 100;
    dot.style.left = `${50 + p * 44}%`;
    dot.style.setProperty('--angle', `${(v['Mic Angle'] / 100) * 45}deg`);
    dot.style.setProperty('--dist', String(1 - v['Mic Distance'] / 140));
    ring.style.setProperty('--d', String(v['Mic Distance'] / 100));
    cone.setAttribute('aria-valuenow', String(Math.round(v['Mic Position'])));
    const where = p < 0.2 ? 'at the center (brightest)' : p < 0.55 ? 'between center and edge' : 'near the edge (warmest)';
    lbl.textContent = `Mic ${where} · ${v['Mic Distance'] < 15 ? 'right up close' : v['Mic Distance'] < 55 ? 'a little back' : 'well back'}${v['Mic Angle'] > 30 ? ' · angled' : ''}${v['Room Mic'] > 3 ? ` · room mic ${Math.round(v['Room Mic'])}%` : ''}`;
    cone.setAttribute('aria-valuetext', lbl.textContent);
  };
  const knobsOut = () => ({ ...(g.knobs || {}), ...v });
  const setPos = (p, final) => {
    v['Mic Position'] = Math.max(0, Math.min(100, Math.round(p)));
    paint();
    on && on({ knobs: knobsOut() }, final);
  };
  cone.addEventListener('pointerdown', (e) => {
    if (disabled || e.button !== 0) return;
    cone.setPointerCapture(e.pointerId);
    const at = (ev) => {
      const r = cone.getBoundingClientRect();
      const dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
      return (Math.min(1, Math.hypot(dx, dy) / (r.width * 0.44)) * 100);
    };
    setPos(at(e), false);
    const move = (ev) => setPos(at(ev), false);
    const up = (ev) => {
      cone.removeEventListener('pointermove', move);
      cone.removeEventListener('pointerup', up);
      cone.removeEventListener('pointercancel', up);
      setPos(v['Mic Position'], true);
    };
    cone.addEventListener('pointermove', move);
    cone.addEventListener('pointerup', up);
    cone.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  cone.addEventListener('keydown', (e) => {
    if (disabled) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 4 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -4 : 0;
    if (!d) return;
    e.preventDefault();
    setPos(v['Mic Position'] + d * (e.shiftKey ? 0.25 : 1), true);
  });
  const types = h('div.mic-types', { role: 'radiogroup', 'aria-label': 'Which mic' });
  for (const [id, label, hint] of MICS) {
    const ok = family && Object.keys(family.keys).some((k) => k.startsWith(`${id}|`));
    const b = h('button.mic-type', { type: 'button', role: 'radio', 'aria-checked': String(id === mic), title: hint, disabled: disabled || !ok ? true : null }, h('span.mic-ico', { 'aria-hidden': 'true', 'data-mic': id }), h('b', { text: label }));
    b.onclick = () => {
      if (!family) return;
      const pos = m ? m[3] : 'Cone';
      const key = family.keys[`${id}|${pos}`] || family.keys[`${id}|Cone`] || Object.values(family.keys).find((k) => k.includes(`_${id}_`));
      if (key) on && on({ key, knobs: knobsOut() }, true);
    };
    types.append(b);
  }
  const knobs = h('div.mic-knobs');
  for (const [name, min, max] of MIC_KNOBS.slice(1)) {
    const kn = rotaryKnob({
      name: name.replace('Mic ', ''),
      min,
      max,
      value: v[name],
      def: micDefaults(g.key)[name],
      gel: '#b9a6ff',
      fmt: (x) => `${Math.round(x)}`,
      onInput: (x) => ((v[name] = x), paint(), on && on({ knobs: knobsOut() }, false)),
      onChange: (x) => ((v[name] = x), paint(), on && on({ knobs: knobsOut() }, true)),
    });
    kn.disabled = disabled;
    knobs.append(h('div.gb-knob', { title: `${name}: ${knobHelp(name)}` }, kn));
  }
  box.classList.toggle('disabled', !!disabled);
  box.append(h('div.mic-stage', null, cone, h('div.mic-side', null, h('h4', { text: 'The mic' }), types, knobs)), lbl);
  if (disabled && reason) box.append(h('p.gb-reason', { text: reason }));
  paint();
  return box;
}

// ------------------------------------------------------------ the board --
/**
 * The rig as a pedalboard: your guitar → pedals → amp head (on its cabinet) → loop pedals →
 * cabinet → rack → your speakers, joined by braided cables. Every cable carries a light pulse
 * driven by the level you play at (setLevel), moving in the signal's direction.
 *
 * o.selected: index into orderedGear(tone); o.onPick(i), o.onBypass(i)
 */
export function rigBoard(tone, { selected = -1, onPick, onBypass, kind = 'guitar' } = {}) {
  const gear = orderedGear(tone);
  const board = h('div.rb', { role: 'list', 'aria-label': 'Your rig, in signal order' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'rb-cables');
  svg.setAttribute('aria-hidden', 'true');
  const lane = h('div.rb-lane');
  const jackIn = h('div.rb-jack.in', { title: `Your ${kind}` }, h('span.rb-jack-ico', { html: GUITAR_SVG }), h('small', { text: `Your ${kind}` }));
  const jackOut = h('div.rb-jack.out', { title: 'Out to your speakers or headphones' }, h('span.rb-jack-ico', { html: SPEAKER_SVG }), h('small', { text: 'Out' }));
  const pieces = new Map(); // index → element
  const piece = (g, i) => {
    const p = h(`div.rb-piece.${g.slot}${g.bypass ? '.off' : ''}${i === selected ? '.sel' : ''}`, { role: 'listitem', 'data-i': String(i) });
    const art = h('button.rb-art', { type: 'button', title: `${gearName(g.key)}${g.bypass ? ' (off)' : ''}: click to open its knobs`, 'aria-pressed': String(i === selected) }, gearThumb(g.key, g.slot, { full: g.slot === 'amp' || g.slot === 'cab' }));
    art.onclick = () => onPick && onPick(i);
    p.append(art);
    const tape = h('span.rb-tape', { text: gearName(g.key).replace(/\s*\((Dynamic|Condenser|Ribbon|Tube)[^)]*\)/i, '') });
    if (g.slot !== 'cab' && g.slot !== 'amp') {
      const sw = h('button.rb-switch', { type: 'button', title: g.bypass ? 'Off: click to turn it on' : 'On: click to switch it off', 'aria-label': `${gearName(g.key)} on or off`, 'aria-pressed': String(!g.bypass) }, h('span.rb-led'));
      sw.onclick = (e) => (e.stopPropagation(), onBypass && onBypass(i));
      p.append(h('div.rb-foot', null, sw, tape));
    } else p.append(tape);
    pieces.set(i, p);
    return p;
  };
  const group = (cls, label) => h(`div.rb-group.${cls}`, { 'data-label': label });
  const pre = group('pre', 'Before the amp');
  const post = group('post', 'Amp’s loop');
  const rack = group('rack', 'Rack');
  const stack = h('div.rb-stack');
  let ampI = -1, cabI = -1;
  gear.forEach((g, i) => {
    if (g.slot === 'pre') pre.append(piece(g, i));
    else if (g.slot === 'post') post.append(piece(g, i));
    else if (g.slot === 'rack') rack.append(piece(g, i));
    else if (g.slot === 'amp') (ampI = i), stack.prepend(piece(g, i));
    else if (g.slot === 'cab') (cabI = i), stack.append(piece(g, i));
  });
  if (ampI < 0) stack.prepend(h('div.rb-empty.amp', { text: 'No amp: pick one from the gear below' }));
  if (cabI < 0) stack.append(h('div.rb-empty.cab', { text: 'No cabinet' }));
  lane.append(jackIn);
  for (const part of [pre, stack, post, rack]) if (part === stack || part.children.length) lane.append(part);
  lane.append(jackOut);
  board.append(lane, svg);

  // signal order: in → pre… → amp → post… → cab → rack… → out
  const order = [];
  const idx = (slot) => gear.map((g, i) => (g.slot === slot ? i : -1)).filter((i) => i >= 0);
  order.push({ el: jackIn, side: 'jack' });
  for (const i of idx('pre')) order.push({ i });
  if (ampI >= 0) order.push({ i: ampI });
  for (const i of idx('post')) order.push({ i });
  if (cabI >= 0) order.push({ i: cabI, cab: true });
  for (const i of idx('rack')) order.push({ i });
  order.push({ el: jackOut, side: 'jack' });

  const draw = () => {
    if (!board.isConnected) return;
    const B = board.getBoundingClientRect();
    if (!B.width) return;
    svg.setAttribute('viewBox', `0 0 ${B.width} ${B.height}`);
    svg.setAttribute('width', String(B.width));
    svg.setAttribute('height', String(B.height));
    const pt = (o, which) => {
      const el = o.el || (pieces.get(o.i) && pieces.get(o.i).querySelector('.rb-art img, .rb-art .gb-drawing')) || (pieces.get(o.i) && pieces.get(o.i).querySelector('.rb-art'));
      if (!el) return null;
      const r = drawn(el);
      const g = o.i >= 0 ? gear[o.i] : null;
      const yf = !g ? 0.42 : g.slot === 'amp' ? 0.5 : g.slot === 'cab' ? (which === 'in' ? 0.28 : 0.62) : g.slot === 'rack' ? 0.5 : 0.3;
      // the cabinet takes its cable on its right side (round the back) and sends from there too
      const x = !g ? (which === 'out' ? r.right - 6 : r.left + 6) : g.slot === 'cab' ? r.right - 2 : which === 'in' ? r.left + 2 : r.right - 2;
      return { x: x - B.left, y: r.top + r.height * yf - B.top, back: g && g.slot === 'cab' && which === 'in' };
    };
    let paths = '';
    let plugs = '';
    let glow = '';
    for (let k = 0; k < order.length - 1; k++) {
      const a = pt(order[k], 'out');
      const b = pt(order[k + 1], 'in');
      if (!a || !b) continue;
      const ga = order[k].i >= 0 ? gear[order[k].i] : null;
      const gb = order[k + 1].i >= 0 ? gear[order[k + 1].i] : null;
      const off = (ga && ga.bypass) || (gb && gb.bypass);
      const dx = b.x - a.x;
      const sag = 26 + Math.min(70, Math.abs(dx) * 0.18);
      let c1x, c1y, c2x, c2y;
      if (dx > 8 && !b.back) {
        c1x = a.x + dx * 0.45; c1y = a.y + sag;
        c2x = b.x - dx * 0.45; c2y = b.y + sag;
      } else {
        // going back to the cabinet: out of the last loop pedal, down under the pedals, in from the right
        const floor = B.height - 14;
        const reach = Math.max(36, Math.abs(dx) * 0.3);
        c1x = a.x + 40; c1y = floor + 30;
        c2x = b.x + reach; c2y = floor + 20;
      }
      const d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      const cls = off ? ' off' : '';
      paths += `<path class="rb-shadow${cls}" d="${d}" transform="translate(2 4)"/><path class="rb-braid${cls}" d="${d}"/><path class="rb-weave${cls}" d="${d}"/><path class="rb-sheen${cls}" d="${d}"/>`;
      glow += `<path class="rb-pulse${cls}" d="${d}" style="animation-delay:${(-0.18 * k).toFixed(2)}s"/>`;
      plugs += plug(a, c1x, c1y) + plug(b, c2x, c2y);
    }
    svg.innerHTML = `<g class="rb-wires">${paths}</g><g class="rb-glow">${glow}</g><g class="rb-plugs">${plugs}</g>`;
  };
  // the picture's own box (an <img> with object-fit: contain can be wider than what it shows)
  const drawn = (el) => {
    const r = el.getBoundingClientRect();
    if (el.tagName !== 'IMG' || !el.naturalWidth) return r;
    const ar = el.naturalWidth / el.naturalHeight;
    let w = r.width, hh = r.height;
    if (w / hh > ar) w = hh * ar;
    else hh = w / ar;
    const left = r.left + (r.width - w) / 2, top = r.top + (r.height - hh) / 2;
    return { left, top, right: left + w, bottom: top + hh, width: w, height: hh };
  };
  // a chrome jack: a short barrel along the cable's end direction, with a collar
  const plug = (p, cx, cy) => {
    let ux = cx - p.x, uy = cy - p.y;
    const l = Math.hypot(ux, uy) || 1;
    ux /= l; uy /= l;
    const e = { x: p.x + ux * 15, y: p.y + uy * 15 };
    const c = { x: p.x + ux * 11, y: p.y + uy * 11 };
    return `<line class="rb-plug" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}"/><line class="rb-plug-hi" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${c.x.toFixed(1)}" y2="${c.y.toFixed(1)}"/><line class="rb-collar" x1="${c.x.toFixed(1)}" y1="${c.y.toFixed(1)}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}"/>`;
  };
  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(board);
  for (const img of board.querySelectorAll('img')) if (!img.complete) img.addEventListener('load', () => requestAnimationFrame(draw), { once: true });
  requestAnimationFrame(draw);
  board.redraw = draw;
  /** 0..1: how loud you're playing; the pulse fades out when you stop. */
  board.setLevel = (x) => {
    const s = Math.max(0, Math.min(1, x));
    board.style.setProperty('--sig', s.toFixed(3));
    board.classList.toggle('live', s > 0.02);
  };
  board.dispose = () => ro.disconnect();
  return board;
}

const GUITAR_SVG = '<svg viewBox="0 0 48 48"><path d="M30 6l6-4 4 4-4 6-8 8 2 2-3 3-2-2-2 2c2 5 0 10-5 12-6 3-13-1-14-7-1-5 3-9 8-9l2-2-2-2 3-3 2 2z" fill="#d9a35f" stroke="#2a1b0e" stroke-width="1.6" stroke-linejoin="round"/><circle cx="15" cy="32" r="3" fill="#2a1b0e"/><path d="M22 26l10-10" stroke="#e6dfcf" stroke-width="1.2"/></svg>';
const SPEAKER_SVG = '<svg viewBox="0 0 48 48"><rect x="7" y="5" width="34" height="38" rx="3" fill="#1d1b19" stroke="#a88d57" stroke-width="1.6"/><circle cx="24" cy="28" r="10" fill="#2d2a26" stroke="#6d6253"/><circle cx="24" cy="28" r="3.5" fill="#57504a"/><circle cx="24" cy="13" r="3.5" fill="#2d2a26" stroke="#6d6253"/></svg>';

export { esc };
