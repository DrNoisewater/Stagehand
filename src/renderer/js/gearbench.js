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
import { rotaryKnob, fmtKnob, gearFaceplate, stepFor } from './rigui.js';
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
  const onPhoto = new Set([...Object.keys((photo && photo.knobs) || {}), ...Object.keys((photo && photo.sliders) || {})]);
  for (const k of ks) {
    const knob = rotaryKnob({
      name: k.name,
      min: k.min,
      max: k.max,
      value: k.value,
      def: k.def,
      gel,
      step: stepFor(k.min, k.max),
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
  const note = !ks.length ? '' : onPhoto.size === ks.length ? 'Work the controls on the photo or on the strip: they’re the same controls.' : onPhoto.size ? 'Controls you can’t see on the photo are on the strip.' : 'Set it with the knobs on the strip.';
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
 * The rig set up the way a real one is, seen from where you stand: your guitar comes in on the
 * right, the signal runs right to left (a pedal's input is on its right, its output on its
 * left), through the pedals into the amp head sitting on its cabinet, out through the amp's
 * loop pedals and back, then from the cabinet's mic through the rack to your speakers.
 *
 * 4.10: everything stands in signal order on one floor line. Neighbours are joined by short patch
 * cables, jack to jack; the two long runs (back from the loop, and from the cabinet's mic past
 * the loop pedals) lie flat along the floor under gaffer tape. Pieces can be dragged: a little
 * to nudge them (the cables follow), or past a neighbour to change the order.
 *
 * o.selected: index into orderedGear(tone); o.onPick(i), o.onBypass(i),
 * o.onMove(i, steps) (steps > 0 = later in the chain), o.onNudge(i, [dx, dy])
 */
const NUDGE = { x: 24, up: 34, down: 10 };
const HINT_KEY = 'stagehand.rigDragHint';

export function rigBoard(tone, { selected = -1, onPick, onBypass, onMove, onNudge, kind = 'guitar' } = {}) {
  const gear = orderedGear(tone);
  const board = h('div.rb', { role: 'list', 'aria-label': 'Your rig, in signal order: your guitar is on the right' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'rb-cables');
  svg.setAttribute('aria-hidden', 'true');
  const deco = h('div.rb-deco', { 'aria-hidden': 'true' });
  const jackIn = h('div.rb-jack.in', { title: `Your ${kind} plugs in here` }, h('span.rb-jack-ico', { html: GUITAR_SVG }), h('span.rb-tag', { text: kind === 'bass' ? 'Bass in' : 'Guitar in' }));
  const jackOut = h('div.rb-jack.out', { title: 'Out to your speakers or headphones' }, h('span.rb-jack-ico', { html: SPEAKER_SVG }), h('span.rb-tape.duct', { text: 'Out' }));
  const idx = (slot) => gear.map((g, i) => (g.slot === slot ? i : -1)).filter((i) => i >= 0);
  const pre = idx('pre'), post = idx('post'), racks = idx('rack');
  const ampI = idx('amp')[0] ?? -1, cabI = idx('cab')[0] ?? -1;
  const short = (key) => gearName(key).replace(/\s*\((Dynamic|Condenser|Ribbon|Tube)[^)]*\)/i, '');

  // ---- the pieces
  const P = new Map(); // gear index → { el, art, pic, g, w, h, x, y, at }
  const aspect = (g) => {
    const ph = gearPhotoInfo(g.key);
    if (ph && ph.width && ph.height) return ph.width / ph.height;
    return g.slot === 'amp' ? 2.4 : g.slot === 'cab' ? 1.25 : g.slot === 'rack' ? 4.2 : 0.62;
  };
  const piece = (g, i) => {
    const el = h(`div.rb-piece.${g.slot}${g.bypass ? '.off' : ''}${i === selected ? '.sel' : ''}`, { role: 'listitem', 'data-i': String(i) });
    const pic = gearThumb(g.key, g.slot, { full: g.slot === 'amp' || g.slot === 'cab' });
    const canMove = g.slot === 'pre' || g.slot === 'post' || g.slot === 'rack';
    const art = h('button.rb-art', { type: 'button', title: `${short(g.key)}${g.bypass ? ' (off)' : ''}: click for its knobs${canMove ? ', drag to move it' : ''}`, 'aria-pressed': String(i === selected) }, pic);
    const foot = h('div.rb-foot');
    if (g.slot !== 'cab' && g.slot !== 'amp') {
      const sw = h('button.rb-switch', { type: 'button', title: g.bypass ? 'Off: click to turn it on' : 'On: click to switch it off', 'aria-label': `${short(g.key)} on or off`, 'aria-pressed': String(!g.bypass) }, h('span.rb-led'));
      sw.onclick = (e) => (e.stopPropagation(), onBypass && onBypass(i));
      foot.append(sw);
    }
    foot.append(h('span.rb-tape', { text: short(g.key) }));
    el.append(art, foot);
    const at = Array.isArray(g.at) ? [Number(g.at[0]) || 0, Number(g.at[1]) || 0] : [0, 0];
    P.set(i, { el, art, pic, foot, g, i, at, canMove });
    board.append(el);
    drag(P.get(i));
  };
  gear.forEach((g, i) => piece(g, i));
  const noAmp = ampI < 0 ? h('div.rb-empty.amp', { text: 'No amp yet: pick one from the gear wall' }) : null;
  const noCab = cabI < 0 ? h('div.rb-empty.cab', { text: 'No cabinet' }) : null;
  if (noAmp) board.append(noAmp);
  if (noCab) board.append(noCab);
  board.append(jackIn, jackOut, deco, svg);

  // ---- the furniture: tape labels, the chalk arrow, the tone's sticker (decoration only)
  const groupTape = (text) => h('span.rb-gaffer', { text });
  const tapes = { pre: pre.length ? groupTape('Before the amp') : null, post: post.length ? groupTape('Amp’s loop') : null, rack: racks.length ? groupTape('Rack') : null };
  for (const t of Object.values(tapes)) if (t) deco.append(t);
  const chalk = h('span.rb-chalk', null, h('img', { src: 'art/scraps/white-chalk-arrow.avif', alt: '', draggable: false }), h('small', { text: 'signal' }));
  const sticker = h('span.rb-sticker', null, h('b', { text: (tone && tone.name) || 'New tone' }));
  deco.append(chalk, sticker);
  const eqI = gear.findIndex((g) => /EQ/.test(g.key) && g.slot !== 'amp' && g.slot !== 'cab');
  const eqSign = eqI >= 0 ? h('img.rb-eqsign', { src: 'art/scraps/eq-sign.avif', alt: '', draggable: false }) : null;
  if (eqSign) deco.append(eqSign);
  const runTapes = [h('img.rb-runtape', { src: 'art/scraps/black-gaffer-tape.avif', alt: '', draggable: false }), h('img.rb-runtape', { src: 'art/scraps/black-gaffer-tape.avif', alt: '', draggable: false })];
  deco.append(...runTapes);
  let hint = null;
  const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
  if (!hintSeen() && pre.length + post.length + racks.length > 0) {
    hint = h('span.rb-hint', null, h('span', { text: 'Drag gear to shift it. Drag it past its neighbour to swap places.' }), h('img', { src: 'art/scraps/red-hooked-arrow.avif', alt: '', draggable: false }));
    deco.append(hint);
  }
  const hintDone = () => {
    if (!hint) return;
    hint.remove();
    hint = null;
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ }
  };

  // ---- where everything stands
  let L = null; // the last layout: { base, runA, runB, W, H }
  const place = (n) => {
    n.el.style.left = `${Math.round(n.x + n.at[0])}px`;
    n.el.style.top = `${Math.round(n.y + n.at[1])}px`;
  };
  const layout = () => {
    const host = board.parentElement;
    const H = (host && host.clientHeight) || board.clientHeight;
    const VW = (host && host.clientWidth) || board.clientWidth;
    if (!H || !VW) return false;
    const TOP = 34, FOOT = 64, PAD = 30, JACK = 62;
    const U0 = Math.max(120, H - TOP - FOOT);
    const base = TOP + U0; // the floor line every piece stands on
    const stackOf = () => Math.max(ampI >= 0 ? P.get(ampI).w : 230, cabI >= 0 ? P.get(cabI).w : 210);
    const size = (n, U) => {
      const ar = aspect(n.g), s = n.g.slot;
      let w, hh;
      if (s === 'amp') {
        w = Math.max(110, Math.min(330, U * 1.1));
        hh = w / ar;
        const cap = cabI >= 0 || noCab ? U * 0.43 : U * 0.8;
        if (hh > cap) (hh = cap), (w = hh * ar);
      } else if (s === 'cab') {
        const head = ampI >= 0 ? P.get(ampI).h : noAmp ? U * 0.3 : 0;
        hh = Math.max(60, U - head - 2);
        w = hh * ar;
        const cap = Math.max(U * 0.8, (ampI >= 0 ? P.get(ampI).w : 220) * 1.08);
        if (w > cap) (w = cap), (hh = w / ar);
      } else if (s === 'rack') {
        w = Math.max(96, Math.min(220, U * 0.8));
        hh = w / ar;
        if (hh > 76) (hh = 76), (w = hh * ar);
      } else {
        hh = Math.max(64, Math.min(190, U * 0.52));
        w = hh * ar;
        if (w > hh * 1.3) (w = hh * 1.3), (hh = w / ar);
      }
      n.w = Math.round(w);
      n.h = Math.round(hh);
      n.pic.style.width = `${n.w}px`;
      n.pic.style.height = `${n.h}px`;
    };
    // left to right on screen: out · rack (last…first) · loop (last…first) · the stack · pedals (last…first) · in
    const row = (list) => list.slice().reverse().map((i) => P.get(i));
    let U = U0, GAP = 54, GROUP = 78, groups, total, stackW;
    // a big rig is made a little smaller rather than running off the side of the board
    for (let pass = 0; pass < 7; pass++) {
      if (ampI >= 0) size(P.get(ampI), U);
      for (const [i, n] of P) if (i !== ampI) size(n, U);
      stackW = stackOf();
      groups = [{ k: 'out', w: JACK }, { k: 'rack', list: row(racks) }, { k: 'post', list: row(post) }, { k: 'stack', w: stackW }, { k: 'pre', list: row(pre) }, { k: 'in', w: JACK }].filter((g) => !g.list || g.list.length);
      for (const g of groups) if (g.list) g.w = g.list.reduce((a, n) => a + n.w, 0) + GAP * (g.list.length - 1);
      total = groups.reduce((a, g) => a + g.w, 0) + GROUP * (groups.length - 1);
      const room = VW - PAD * 2;
      if (total <= room || U <= U0 * 0.36) break;
      const k = Math.max(0.5, (room / total) * 0.98);
      U = Math.max(U0 * 0.36, U * k);
      GAP = Math.max(30, GAP * k);
      GROUP = Math.max(40, GROUP * k);
    }
    const W = Math.max(VW, total + PAD * 2);
    board.style.width = `${W}px`;
    board.style.height = `${H}px`;
    let x = (W - total) / 2;
    const at = {};
    for (const g of groups) {
      at[g.k] = { x, w: g.w };
      if (g.list) {
        let px = x;
        for (const n of g.list) {
          n.x = px;
          n.y = base - n.h;
          px += n.w + GAP;
        }
      }
      x += g.w + GROUP;
    }
    const sx = at.stack.x;
    let headH = U * 0.3;
    if (ampI >= 0) {
      const a = P.get(ampI);
      headH = a.h;
      a.x = sx + (stackW - a.w) / 2;
    }
    if (cabI >= 0) {
      const c = P.get(cabI);
      c.x = sx + (stackW - c.w) / 2;
      c.y = base - c.h;
      if (ampI >= 0) P.get(ampI).y = c.y - headH - 2;
    } else if (ampI >= 0) P.get(ampI).y = base - headH - (noCab ? U * 0.34 + 4 : 0);
    if (noCab) Object.assign(noCab.style, { left: `${sx}px`, top: `${base - U * 0.34}px`, width: `${stackW}px`, height: `${U * 0.34}px` });
    if (noAmp) Object.assign(noAmp.style, { left: `${sx}px`, top: `${(cabI >= 0 ? P.get(cabI).y : base - U * 0.34) - U * 0.3 - 4}px`, width: `${stackW}px`, height: `${U * 0.3}px` });
    for (const n of P.values()) {
      place(n);
      const tape = n.foot.querySelector('.rb-tape');
      if (tape) tape.style.maxWidth = `${Math.max(74, n.w + GAP - (n.foot.children.length > 1 ? 40 : 12))}px`;
    }
    const mid = base - Math.min(U * 0.3, 80);
    Object.assign(jackIn.style, { left: `${at.in.x}px`, top: `${mid - 30}px`, width: `${JACK}px` });
    Object.assign(jackOut.style, { left: `${at.out.x}px`, top: `${mid - 30}px`, width: `${JACK}px` });
    // furniture
    for (const k of ['pre', 'post', 'rack']) if (tapes[k]) Object.assign(tapes[k].style, { left: `${at[k].x + at[k].w / 2}px`, top: '6px' });
    Object.assign(chalk.style, { left: `${Math.min(W - 196, at.in.x - 110)}px`, top: `${base + 32}px` });
    Object.assign(sticker.style, { left: `${Math.max(10, at.out.x - 24)}px`, top: '4px' });
    if (eqSign) {
      const n = P.get(eqI);
      Object.assign(eqSign.style, { left: `${n.x + n.w / 2}px`, top: `${Math.max(30, n.y - 30)}px` });
    }
    if (hint) {
      const first = pre.length ? P.get(pre[0]) : post.length ? P.get(post[0]) : P.get(racks[0]);
      Object.assign(hint.style, { left: `${first.x + first.w / 2}px`, top: `${Math.max(36, first.y - 108)}px` });
    }
    L = { base, W, H, runA: base + 44, runB: base + 55, at, stackW, sx };
    return true;
  };

  // ---- the cables
  const box = (n) => ({ l: n.x + n.at[0], t: n.y + n.at[1], r: n.x + n.at[0] + n.w, b: n.y + n.at[1] + n.h, w: n.w, h: n.h });
  const jackBox = (el) => {
    const ico = el.querySelector('.rb-jack-ico');
    const l = el.offsetLeft + ico.offsetLeft, t = el.offsetTop + ico.offsetTop;
    return { l, t, r: l + ico.offsetWidth, b: t + ico.offsetHeight, w: ico.offsetWidth, h: ico.offsetHeight };
  };
  // where a cable plugs in: every pedal and rack unit takes it on the right and sends from the left
  const port = (i, which) => {
    const n = P.get(i), b = box(n), s = n.g.slot;
    if (s === 'amp') {
      if (which === 'in') return { x: b.r - 2, y: b.t + b.h * 0.5, d: 1 };
      if (which === 'send') return { x: b.l + 2, y: b.t + b.h * 0.34, d: -1 };
      if (which === 'return') return { x: b.l + 2, y: b.t + b.h * 0.7, d: -1 };
      return { x: b.r - 2, y: b.t + b.h * 0.86, d: 1 }; // speaker out
    }
    if (s === 'cab') return which === 'in' ? { x: b.r - 2, y: b.t + b.h * 0.16, d: 1 } : { x: b.l + 2, y: b.t + b.h * 0.56, d: -1 };
    const yf = s === 'rack' ? 0.5 : 0.31;
    return which === 'in' ? { x: b.r - 2, y: b.t + b.h * yf, d: 1 } : { x: b.l + 2, y: b.t + b.h * yf, d: -1 };
  };
  const f = (v) => v.toFixed(1);
  // a short patch cable between two jacks that face each other: out of one, a little slack, into the next
  const hop = (a, b) => {
    const d = Math.abs(a.x - b.x);
    const reach = Math.max(18, Math.min(60, d * 0.45));
    const sag = Math.max(8, Math.min(30, 6 + d * 0.16)) + Math.min(24, Math.abs(a.y - b.y) * 0.12);
    const c1 = { x: a.x + a.d * reach, y: a.y + sag }, c2 = { x: b.x + b.d * reach, y: b.y + sag };
    return { d: `M${f(a.x)},${f(a.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(b.x)},${f(b.y)}`, a, b, ua: c1, ub: c2 };
  };
  // a long run: out of the jack, down to the floor, along it, and up into the other jack
  const run = (a, b, y, xa, xb) => {
    const R = 12;
    const pts = [[a.x, a.y], [xa, a.y], [xa, y], [xb, y], [xb, b.y], [b.x, b.y]];
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const [px, py] = pts[k - 1], [cx, cy] = pts[k], [nx, ny] = pts[k + 1];
      const l1 = Math.hypot(cx - px, cy - py) || 1, l2 = Math.hypot(nx - cx, ny - cy) || 1;
      const r = Math.min(R, l1 / 2, l2 / 2);
      d += ` L${f(cx - ((cx - px) / l1) * r)},${f(cy - ((cy - py) / l1) * r)} Q${f(cx)},${f(cy)} ${f(cx + ((nx - cx) / l2) * r)},${f(cy + ((ny - cy) / l2) * r)}`;
    }
    d += ` L${f(b.x)},${f(b.y)}`;
    return { d, a, b, ua: { x: xa, y: a.y }, ub: { x: xb, y: b.y }, floor: [Math.min(xa, xb), Math.max(xa, xb), y] };
  };
  // the speaker lead: a short loop down the side of the stack
  const jumper = (a, b) => {
    const out = Math.max(a.x, b.x) + 26;
    return { d: `M${f(a.x)},${f(a.y)} C${f(out)},${f(a.y)} ${f(out)},${f(b.y)} ${f(b.x)},${f(b.y)}`, a, b, ua: { x: a.x + 20, y: a.y }, ub: { x: b.x + 20, y: b.y }, fat: true };
  };
  const plug = (p, u) => {
    let ux = u.x - p.x, uy = u.y - p.y;
    const l = Math.hypot(ux, uy) || 1;
    ux /= l; uy /= l;
    const e = { x: p.x + ux * 14, y: p.y + uy * 14 }, c = { x: p.x + ux * 10, y: p.y + uy * 10 };
    return `<line class="rb-plug" x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(e.x)}" y2="${f(e.y)}"/><line class="rb-plug-hi" x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(c.x)}" y2="${f(c.y)}"/><line class="rb-collar" x1="${f(c.x)}" y1="${f(c.y)}" x2="${f(e.x)}" y2="${f(e.y)}"/>`;
  };
  const draw = () => {
    if (!board.isConnected || !L) return;
    svg.setAttribute('viewBox', `0 0 ${L.W} ${L.H}`);
    svg.setAttribute('width', String(L.W));
    svg.setAttribute('height', String(L.H));
    const ji = jackBox(jackIn), jo = jackBox(jackOut);
    const IN = { x: ji.l + 4, y: ji.t + ji.h * 0.62, d: -1 }, OUT = { x: jo.r - 4, y: jo.t + jo.h * 0.5, d: 1 };
    const cables = [];
    const off = (...is) => is.some((i) => i >= 0 && gear[i] && gear[i].bypass);
    const add = (c, ...is) => (c.off = off(...is), cables.push(c));
    // guitar → pedals → amp
    let from = IN, fromI = -1;
    for (const i of pre) { add(hop(from, port(i, 'in')), fromI, i); from = port(i, 'out'); fromI = i; }
    const stackLeft = Math.min(ampI >= 0 ? box(P.get(ampI)).l : L.sx, cabI >= 0 ? box(P.get(cabI)).l : L.sx);
    if (ampI >= 0) {
      add(hop(from, port(ampI, 'in')), fromI);
      // the loop: send → loop pedals → back along the floor to the return
      if (post.length) {
        from = port(ampI, 'send'); fromI = -1;
        for (const i of post) { add(hop(from, port(i, 'in')), fromI, i); from = port(i, 'out'); fromI = i; }
        add(run(from, port(ampI, 'return'), L.runA, from.x - 16, stackLeft - 30), fromI);
      }
      if (cabI >= 0) add(jumper(port(ampI, 'spk'), port(cabI, 'in')));
      from = cabI >= 0 ? port(cabI, 'out') : port(ampI, post.length ? 'return' : 'send');
    }
    // cabinet (its mic) → rack → out; past the loop pedals it lies along the floor
    const next = racks.length ? port(racks[0], 'in') : OUT;
    if (ampI >= 0 || pre.length) {
      if (post.length && ampI >= 0) add(run(from, next, L.runB, stackLeft - 16, next.x + 18));
      else add(hop(from, next), fromI >= 0 && ampI < 0 ? fromI : -1, racks.length ? racks[0] : -1);
    }
    for (let k = 0; k < racks.length; k++) add(hop(port(racks[k], 'out'), k + 1 < racks.length ? port(racks[k + 1], 'in') : OUT), racks[k], k + 1 < racks.length ? racks[k + 1] : -1);
    let paths = '', plugs = '', glow = '';
    const floors = [];
    cables.forEach((c, k) => {
      const cls = `${c.off ? ' off' : ''}${c.fat ? ' fat' : ''}`;
      paths += `<path class="rb-shadow${cls}" d="${c.d}" transform="translate(1.5 3)"/><path class="rb-braid${cls}" d="${c.d}"/><path class="rb-weave${cls}" d="${c.d}"/><path class="rb-sheen${cls}" d="${c.d}"/>`;
      glow += `<path class="rb-pulse${cls}" pathLength="100" d="${c.d}" style="animation-delay:${(-0.18 * k).toFixed(2)}s"/>`;
      plugs += plug(c.a, c.ua) + plug(c.b, c.ub);
      if (c.floor) floors.push(c.floor);
    });
    svg.innerHTML = `<g class="rb-wires">${paths}</g><g class="rb-glow">${glow}</g><g class="rb-plugs">${plugs}</g>`;
    // gaffer tape over the floor runs, the way cables are taped down on a stage
    runTapes.forEach((t, k) => {
      const fl = floors[0];
      const span = fl ? fl[1] - fl[0] : 0;
      if (!fl || span < 150 * (k + 1)) return void (t.hidden = true);
      t.hidden = false;
      Object.assign(t.style, { left: `${fl[0] + span * (k ? 0.72 : 0.3)}px`, top: `${(floors.length > 1 ? (L.runA + L.runB) / 2 : fl[2])}px`, rotate: k ? '86deg' : '-94deg' });
    });
  };

  // ---- dragging a piece: a nudge, or past a neighbour to swap (one piece at a time)
  let dragging = false;
  function drag(n) {
    n.art.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || dragging) return;
      dragging = true;
      const x0 = e.clientX, y0 = e.clientY, a0 = n.at.slice();
      let moved = false, done = false;
      const free = n.canMove;
      const move = (ev) => {
        if (done) return;
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        if (!moved) {
          moved = true;
          n.art.setPointerCapture(e.pointerId);
          n.el.classList.add('dragging');
          hintDone();
        }
        n.at[0] = free ? a0[0] + dx : Math.max(-NUDGE.x, Math.min(NUDGE.x, a0[0] + dx));
        n.at[1] = n.g.slot === 'amp' || n.g.slot === 'cab' ? 0 : Math.max(-NUDGE.up, Math.min(NUDGE.down, a0[1] + dy));
        place(n);
        if (free) n.el.classList.toggle('swap', steps() !== 0);
        draw();
      };
      // how many neighbours its middle has passed: + = later in the chain (to the left)
      const steps = () => {
        const c = n.x + n.at[0] + n.w / 2;
        const lane = n.g.slot === 'rack' ? racks.map((i) => P.get(i)) : [...pre.map((i) => P.get(i)), ...(ampI >= 0 ? [P.get(ampI)] : []), ...post.map((i) => P.get(i))];
        const me = lane.indexOf(n);
        let k = 0;
        for (let j = me + 1; j < lane.length && c < lane[j].x + lane[j].w / 2; j++) k++;
        if (!k) for (let j = me - 1; j >= 0 && c > lane[j].x + lane[j].w / 2; j--) k--;
        return k;
      };
      const up = () => {
        if (done) return;
        done = true;
        dragging = false;
        n.art.removeEventListener('pointermove', move);
        n.art.removeEventListener('pointerup', up);
        n.art.removeEventListener('pointercancel', up);
        if (!moved) return;
        n.el.classList.remove('dragging', 'swap');
        // the click that follows a drag isn't a pick
        const eat = (ev) => (ev.stopImmediatePropagation(), ev.preventDefault());
        n.art.addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => n.art.removeEventListener('click', eat, { capture: true }), 80);
        const k = free ? steps() : 0;
        if (k) {
          onMove && onMove(n.i, k);
          return;
        }
        n.at[0] = Math.max(-NUDGE.x, Math.min(NUDGE.x, n.at[0]));
        n.el.classList.add('settle');
        place(n);
        draw();
        setTimeout(() => (n.el.classList.remove('settle'), draw()), 170);
        onNudge && onNudge(n.i, n.at[0] || n.at[1] ? [Math.round(n.at[0]), Math.round(n.at[1])] : null);
      };
      n.art.addEventListener('pointermove', move);
      n.art.addEventListener('pointerup', up);
      n.art.addEventListener('pointercancel', up);
    });
    n.art.addEventListener('click', () => onPick && onPick(n.i));
    // keyboard: Alt + arrows move a pedal along the chain
    n.art.addEventListener('keydown', (e) => {
      if (!e.altKey || !n.canMove) return;
      const k = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
      if (!k) return;
      e.preventDefault();
      onMove && onMove(n.i, k);
    });
  }

  const redraw = () => layout() && draw();
  const ro = new ResizeObserver(() => requestAnimationFrame(redraw));
  ro.observe(board);
  let hostSeen = null;
  const watchHost = () => {
    if (board.parentElement && board.parentElement !== hostSeen) ro.observe((hostSeen = board.parentElement));
  };
  requestAnimationFrame(() => (watchHost(), redraw()));
  board.redraw = redraw;
  /** where piece i stands on the board (its middle), for stickers and stamps */
  board.where = (i) => {
    const n = P.get(i);
    return n ? { x: n.x + n.at[0] + n.w / 2, y: n.y + n.at[1] + n.h / 2, w: n.w, h: n.h } : null;
  };
  board.setName = (name) => (sticker.firstChild.textContent = name || 'New tone');
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
