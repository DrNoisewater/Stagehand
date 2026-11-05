/**
 * Gear pictures (4.1.7): Stagehand's own drawings of amps, cabinets, pedals and
 * rack units, made from the gear itself, so every piece has one: an amp head
 * or combo with its real number of knobs, a cabinet with its speaker layout
 * (1×12 … 8×10, straight or slanted), a stompbox coloured by what it does.
 * No makers' photos or logos (those are theirs); the name is shown beside it.
 *
 * User: "Other apps that do something similar have images for each one of
 * the pedals, cabinets and amps."
 */
import { gearInfo } from './gearspec.js';

// amp looks: tolex, front panel, grille cloth, piping/trim, knob colour, combo or head
const LOOKS = {
  black: { tolex: '#1c1d22', panel: '#c9b27a', grille: '#3a352c', trim: '#d8d2c0', knob: '#121214' },
  blackface: { tolex: '#16171b', panel: '#20232a', grille: '#b9b6ad', trim: '#c9ccd2', knob: '#0d0d0f', silver: true },
  tweed: { tolex: '#c9a66b', panel: '#3a2b1a', grille: '#6b4b2b', trim: '#e7d3a6', knob: '#2a1d10' },
  vox: { tolex: '#2b2018', panel: '#7a1f1a', grille: '#8a6d4a', trim: '#d7b88a', knob: '#1a1412', diamond: true },
  orange: { tolex: '#e3772b', panel: '#f1e6d2', grille: '#d7cdbb', trim: '#f5efe2', knob: '#1b1b1b' },
  plate: { tolex: '#17181c', panel: '#a9adb5', grille: '#2a2b30', trim: '#c4c8cf', knob: '#111', diamond: true },
  grey: { tolex: '#1d1f24', panel: '#3c414b', grille: '#2b2e35', trim: '#9aa1ad', knob: '#0e0f12' },
  bassblue: { tolex: '#1a1c22', panel: '#2f5f9a', grille: '#2a2d34', trim: '#b9c6d8', knob: '#0d0f14' },
};

/** Which look an amp gets, from its Rocksmith key (no logos; a family resemblance at most). */
function ampLook(key) {
  const k = String(key || '');
  if (/TW|CA85/i.test(k)) return { look: 'blackface', combo: true };
  if (/Gibson|Epiphone|Tweed|5E3/i.test(k)) return { look: 'tweed', combo: true };
  if (/AT120|AT20|Vox|AC30/i.test(k)) return { look: 'vox', combo: true };
  if (/Orange/i.test(k)) return { look: 'orange', combo: false };
  if (/CA100|GB100|BT15|Rectifier/i.test(k)) return { look: 'plate', combo: false };
  if (/Marshall|JCM|Plexi|JTM|JVM|DSL|CA38|EN30|GB38|GB50|BT45/i.test(k)) return { look: 'black', combo: /Bluesbreaker|DSL15/i.test(k) };
  if (/^Bass_Amp_(Eden|CH|CS)/i.test(k)) return { look: 'bassblue', combo: false };
  if (/^Bass_/i.test(k)) return { look: 'grey', combo: false };
  if (/HG|EN50/i.test(k)) return { look: 'grey', combo: false };
  // anything else: a stable choice from its name
  const names = ['black', 'grey', 'blackface', 'plate'];
  let x = 0;
  for (const c of k) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return { look: names[x % names.length], combo: x % 3 === 0 };
}

const knobRow = (n, x0, x1, y, r, fill, cap) => {
  let s = '';
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const cx = n > 1 ? x0 + step * i : (x0 + x1) / 2;
    s += `<circle cx="${cx.toFixed(1)}" cy="${y}" r="${r}" fill="${fill}" stroke="${cap}" stroke-width="0.8"/><line x1="${cx.toFixed(1)}" y1="${y}" x2="${(cx + r * 0.55).toFixed(1)}" y2="${(y - r * 0.6).toFixed(1)}" stroke="${cap}" stroke-width="0.9" stroke-linecap="round"/>`;
  }
  return s;
};

let uid = 0;
/** An amp: a head, or a combo with its grille. knobs: how many (from the gear). */
export function ampArt(key, { knobs = null } = {}) {
  const { look, combo } = ampLook(key);
  const L = LOOKS[look];
  const n = Math.max(3, Math.min(8, knobs || ((gearInfo(key) && gearInfo(key).k) || []).length || 5));
  const id = `ga${++uid}`;
  const cloth = L.diamond
    ? `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${L.grille}"/><rect width="3" height="3" fill="rgba(0,0,0,.25)"/></pattern>`
    : `<pattern id="${id}" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="${L.grille}"/><rect width="1.5" height="3" fill="rgba(0,0,0,.18)"/></pattern>`;
  const knobFill = L.silver ? '#d9dce2' : L.knob;
  const knobCap = L.silver ? '#6d717a' : 'rgba(255,255,255,.55)';
  if (combo) {
    return `<svg viewBox="0 0 120 92" class="gear-art amp" aria-hidden="true"><defs>${cloth}</defs>
      <rect x="6" y="84" width="108" height="8" rx="4" fill="rgba(0,0,0,.35)"/>
      <rect x="2" y="6" width="116" height="84" rx="7" fill="${L.tolex}"/>
      <path d="M48 6v-3.5a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2V6" fill="none" stroke="${L.trim}" stroke-width="2"/>
      <rect x="8" y="12" width="104" height="18" rx="2" fill="${L.panel}"/>
      ${knobRow(n, 18, 100, 21, 3.4, knobFill, knobCap)}
      <circle cx="108" cy="21" r="1.6" fill="#ff5a3c"/>
      <rect x="8" y="34" width="104" height="50" rx="3" fill="url(#${id})" stroke="${L.trim}" stroke-width="1.2"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 120 64" class="gear-art amp head" aria-hidden="true"><defs>${cloth}</defs>
    <rect x="6" y="57" width="108" height="7" rx="3.5" fill="rgba(0,0,0,.35)"/>
    <rect x="2" y="8" width="116" height="54" rx="6" fill="${L.tolex}"/>
    <path d="M46 8v-4a2 2 0 0 1 2-2h24a2 2 0 0 1 2 2v4" fill="none" stroke="${L.trim}" stroke-width="2"/>
    <rect x="7" y="13" width="106" height="20" rx="2" fill="url(#${id})" stroke="${L.trim}" stroke-width="1"/>
    <rect x="7" y="37" width="106" height="20" rx="2" fill="${L.panel}"/>
    ${knobRow(n, 17, 98, 47, 3.6, knobFill, knobCap)}
    <circle cx="107" cy="47" r="1.8" fill="#ff5a3c"/>
  </svg>`;
}

/** Speaker layout from a cabinet's key or Stagehand cabinet id: rows × columns, size, slant. */
function cabLayout(key) {
  const k = String(key || '');
  const slant = /slant|1960A(?!X)|1960a/i.test(k) && !/straight/i.test(k);
  const m = /(\d)\s*[x×]\s*(\d{2})/i.exec(k) || /(\d)(1[025]|0)\d?/.exec(k.replace(/^.*?_(?=\d)/, ''));
  if (/810|8x10|bass-810|bass-orange/i.test(k)) return { n: 8, size: 10, slant: false };
  if (/115|1x15|B15/i.test(k)) return { n: 1, size: 15, slant: false };
  if (/215|2x15|Sunn/i.test(k)) return { n: 2, size: 15, slant: false };
  if (/410|4x10/i.test(k)) return { n: 4, size: 10, slant: false };
  if (/412|4x12|1960|PPC412/i.test(k)) return { n: 4, size: 12, slant };
  if (/212|2x12|2120|PPC212/i.test(k)) return { n: 2, size: 12, slant: false };
  if (/112|1x12|1121/i.test(k)) return { n: 1, size: 12, slant: false, open: /open/i.test(k) };
  if (m) return { n: Number(m[1]) || 2, size: 12, slant: false };
  return { n: 4, size: 12, slant: false };
}

/** A speaker cabinet with its speakers showing through the grille. */
export function cabArt(key) {
  const L = cabLayout(key);
  const cols = L.n === 8 ? 2 : L.n === 1 ? 1 : 2;
  const rows = L.n === 8 ? 4 : L.n === 4 ? 2 : 1;
  const tall = L.n === 8;
  const W = 100;
  const H = tall ? 132 : L.n === 1 ? 84 : L.n === 2 ? 66 : 100;
  const pad = 9;
  const top = L.slant ? 16 : 0;
  const cw = (W - pad * 2) / cols;
  const ch = (H - pad * 2 - top * 0.4) / rows;
  const r = Math.min(cw, ch) * (L.size === 15 ? 0.46 : L.size === 10 ? 0.4 : 0.43);
  const shape = L.slant ? `M2 ${top + 2} L${W * 0.42} 2 H${W - 4} a2 2 0 0 1 2 2 V${H - 4} a2 2 0 0 1 -2 2 H4 a2 2 0 0 1 -2 -2 Z` : `M6 2 H${W - 6} a4 4 0 0 1 4 4 V${H - 6} a4 4 0 0 1 -4 4 H6 a4 4 0 0 1 -4 -4 V6 a4 4 0 0 1 4 -4 Z`;
  let sp = '';
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const cx = pad + cw * (x + 0.5);
      const cy = pad + top * 0.4 + ch * (y + 0.5);
      sp += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(0,0,0,.28)"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.36).toFixed(1)}" fill="rgba(0,0,0,.32)"/>`;
    }
  return `<svg viewBox="0 0 ${W} ${H}" class="gear-art cab" aria-hidden="true">
    <path d="${shape}" fill="#1b1c21"/>
    <path d="${shape}" fill="#3b3a36" transform="translate(5 5) scale(${((W - 10) / W).toFixed(3)} ${((H - 10) / H).toFixed(3)})" opacity=".95"/>
    ${sp}
    ${L.open ? `<rect x="6" y="${H - 12}" width="${W - 12}" height="4" rx="2" fill="#15161a"/>` : ''}
  </svg>`;
}

// stompbox colours by what the pedal does
const PEDAL = [
  [/gate|noise/i, '#7d8696'],
  [/comp|sustain|limit/i, '#3f7fd1'],
  [/fuzz|buzz|muff|bender/i, '#9b4fd6'],
  [/dist|metal|rat|grind|crunch/i, '#e36a2a'],
  [/drive|od\b|screamer|tube|boost|klon/i, '#3fae5a'],
  [/chorus|ensemble/i, '#35b6d6'],
  [/flang|jet/i, '#5a6fe0'],
  [/phase|phaser|vibe|uni/i, '#e0a127'],
  [/trem|vibrato|pan/i, '#d6457b'],
  [/delay|echo/i, '#c9ccd4'],
  [/reverb|spring|plate|hall|room/i, '#2f6c8f'],
  [/wah|filter|env|auto/i, '#e6c93a'],
  [/oct|pitch|whammy|harm/i, '#d13f3f'],
  [/eq|graphic|band/i, '#e9e6de'],
];
function pedalColour(key) {
  const k = String(key || '');
  for (const [re, c] of PEDAL) if (re.test(k)) return c;
  let x = 0;
  for (const c of k) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${x % 360} 55% 48%)`;
}

/** A stompbox: its colour says what it does; as many knobs as the real one (up to 4). */
export function pedalArt(key) {
  const c = pedalColour(key);
  const n = Math.max(1, Math.min(4, ((gearInfo(key) && gearInfo(key).k) || []).length || 2));
  const light = /#c9ccd4|#e9e6de|#e6c93a/.test(c);
  const ink = light ? '#25262b' : 'rgba(255,255,255,.85)';
  return `<svg viewBox="0 0 60 92" class="gear-art pedal" aria-hidden="true">
    <rect x="3" y="3" width="54" height="86" rx="7" fill="${c}"/>
    <rect x="3" y="3" width="54" height="86" rx="7" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1.2"/>
    ${knobRow(n, n > 1 ? 14 : 30, n > 1 ? 46 : 30, n > 2 ? 18 : 20, n > 2 ? 4.6 : 5.6, '#18191d', ink)}
    <circle cx="30" cy="40" r="2.2" fill="#ff3b30" opacity=".9"/>
    <rect x="10" y="50" width="40" height="10" rx="2" fill="rgba(0,0,0,.12)"/>
    <circle cx="30" cy="74" r="8" fill="#c7cad1" stroke="#7d828c" stroke-width="1.4"/>
    <circle cx="30" cy="74" r="4" fill="#9ea3ad"/>
  </svg>`;
}

/** A rack unit (studio reverbs, EQs). */
export function rackArt(key) {
  const c = /reverb|plate|hall|room|spring/i.test(key) ? '#2f6c8f' : '#3c414b';
  return `<svg viewBox="0 0 120 40" class="gear-art rack" aria-hidden="true">
    <rect x="2" y="4" width="116" height="32" rx="3" fill="#1d1f24"/>
    <rect x="8" y="8" width="104" height="24" rx="2" fill="${c}"/>
    <circle cx="5" cy="12" r="1.4" fill="#888"/><circle cx="5" cy="28" r="1.4" fill="#888"/><circle cx="115" cy="12" r="1.4" fill="#888"/><circle cx="115" cy="28" r="1.4" fill="#888"/>
    <rect x="14" y="14" width="30" height="12" rx="1.5" fill="#0d1a12"/><text x="17" y="23" font-size="7" fill="#58e08a" font-family="monospace">48.0</text>
    ${knobRow(4, 56, 104, 20, 3.4, '#15161a', 'rgba(255,255,255,.6)')}
  </svg>`;
}

/** The picture for any piece of gear in a tone ({ slot, key }). */
export function gearArt(g) {
  if (!g || !g.key) return '';
  if (g.slot === 'amp') return ampArt(g.key);
  if (g.slot === 'cab') return cabArt(g.key);
  if (g.slot === 'rack') return rackArt(g.key);
  return pedalArt(g.key);
}
