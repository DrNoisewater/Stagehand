/**
 * The highway's style, background and graphics settings.
 * 4.31: two sizes. In the highway's Sound & settings pullout (drawerLooks): style tiles, the
 * background, one quality row and a button to the rest. In Settings › Display (lookSection): a big
 * picture of the style, every style with a line about it, the background, Fine-tune for the style
 * in use (brightness and effects) and the graphics presets, a frame rate cap and the counter.
 * The style decides everything else (fog, reflections, glow, note finish): fewer knobs, more styles.
 * Changes are saved and used at once; each block redraws itself when something changes.
 */
import { h } from './ui.js';
import { THEMES, THEME_SETTINGS, loadLooks, saveLooks, onLooks, themeById, themeSettings, applyPreset } from './hwlooks.js';
import { VENUES, VENUE_ALIAS, venueThumb } from './venues.js';

const PRESET_ROWS = [
  ['auto', 'Auto', 'Keeps it smooth: the fancy bits go first, sharpness last.'],
  ['low', 'Low', 'Older laptop? Every note still lands in the same place.'],
  ['medium', 'Medium', 'The middle: a little less sharp, softer glow, simpler reflections.'],
  ['high', 'High', 'The full show, for most PCs.'],
  ['ultra', 'Ultra', 'Your graphics card asked for a challenge.'],
];
const FX_ROWS = [['full', 'Full', 'Everything the style does'], ['calm', 'Calm', 'Smaller, softer hit effects and nothing moving in the room'], ['off', 'Off', 'No hit effects and nothing moving: just the notes']];

/** The style's picture, rendered from the real highway (big: the large one). */
export const styleThumb = (id, big) => `art/hwstyles/${id}${big ? '-big' : ''}.webp`;

function seg(label, sub, options, cur, onPick) {
  const row = h('div.hl-row', null, h('div.hl-row-t', null, h('b', { text: label }), sub ? h('small', { text: sub }) : null));
  const g = h('div.hl-seg', { role: 'group', 'aria-label': label });
  for (const [v, text, tip] of options) {
    const b = h('button', { type: 'button', text, title: tip || null, 'aria-pressed': String(cur === v) });
    b.onclick = () => onPick(v);
    g.append(b);
  }
  row.append(g);
  return row;
}

function slider(label, sub, spec, cur, fmt, onSet) {
  const out = h('output', { text: fmt(cur) });
  const r = h('input', { type: 'range', min: String(spec.min), max: String(spec.max), step: String(spec.step), value: String(cur), 'aria-label': label });
  r.oninput = () => (out.textContent = fmt(Number(r.value)));
  r.onchange = () => onSet(Number(r.value));
  return h('div.hl-row', null, h('div.hl-row-t', null, h('b', { text: label }), sub ? h('small', { text: sub }) : null), h('div.hl-range', null, r, out));
}

function sw(label, sub, on, onFlip) {
  const b = h('button.hl-switch', { type: 'button', role: 'switch', 'aria-checked': String(!!on) }, h('span.hl-knob'), h('span.hl-row-t', null, h('b', { text: label }), sub ? h('small', { text: sub }) : null));
  b.onclick = () => onFlip(!on);
  return b;
}

function fold(cls, label, value, open, onToggle, body) {
  const head = h('button.hl-fold-head', { type: 'button', 'aria-expanded': String(!!open) }, h('span.hl-fold-l', { text: label }), h('b', { text: value }), h('span.hl-caret', { 'aria-hidden': 'true', text: open ? '▾' : '▸' }));
  head.onclick = () => onToggle(!open);
  body.hidden = !open;
  return h(`div.hl-fold.${cls}`, null, head, body);
}

const pct = (v) => `${Math.round(v * 100)}%`;
const hwPrefs = () => {
  try { return JSON.parse(localStorage.getItem('stagehand.highway') || '{}') || {}; } catch (_) { return {}; }
};
const tellHighway = (key, value) => window.dispatchEvent(new CustomEvent('stagehand:highway-pref', { detail: { key, value } }));

function change(fn) {
  const st = structuredClone(loadLooks());
  fn(st);
  saveLooks(st);
}
const pickStyle = (id) => change((s) => (s.theme = id));
const setTheme = (k, v) => change((st) => {
  st.per[st.theme] = { ...(st.per[st.theme] || {}), [k]: v };
});
const setGfx = (k, v) => change((st) => (st.gfx = { ...st.gfx, [k]: v }));

/**
 * Swap a block's contents without the menu around it jumping: the block keeps its height until the
 * new pictures are ready (an empty block for a moment let the side menu snap back to the top).
 */
function swap(el, ...kids) {
  const hgt = el.isConnected ? el.offsetHeight : 0;
  if (hgt) el.style.minHeight = `${hgt}px`;
  el.replaceChildren(...kids.filter(Boolean));
  if (!hgt) return;
  const pics = [...el.querySelectorAll('img')].map((i) => (i.complete ? null : i.decode().catch(() => {}))).filter(Boolean);
  Promise.all(pics).then(() => requestAnimationFrame(() => (el.style.minHeight = '')));
}

/** A block that redraws itself on any change to the looks, and stops once it's gone. */
function live(el, paint) {
  paint();
  const off = onLooks(() => {
    if (!el.isConnected) return off();
    paint();
  });
  return el;
}

/** Style tiles: the rendered picture and the name. */
function styleTiles(st, { lines = false } = {}) {
  const grid = h(`div.hl-styles${lines ? '.hl-gallery' : ''}`, { role: 'radiogroup', 'aria-label': 'Highway style' });
  for (const t of THEMES) {
    const on = st.theme === t.id;
    const b = h('button.hl-style', { type: 'button', role: 'radio', 'aria-checked': String(on), title: lines ? t.wink : `${t.name}: ${t.about}` },
      h('span.hl-pic', null, h('img', { src: styleThumb(t.id), alt: '', draggable: 'false' })),
      h('span.hl-style-n', { text: t.name }),
      lines ? h('small.hl-style-l', { text: t.about }) : null,
      t.isNew ? h('em.hl-new', { text: 'New' }) : null);
    b.onclick = () => pickStyle(t.id);
    grid.append(b);
  }
  return grid;
}

function qualityRow(st, label = 'Graphics quality') {
  return seg(label, null, PRESET_ROWS, st.gfx.preset, (v) => change((s) => (s.gfx = applyPreset(s.gfx, v))));
}

/**
 * The background: the style's own room first, then every venue and moving background (new ones show
 * up here by themselves). o: venue() the venue in use, pick(id) to use one, open/onFold for the fold.
 */
function backgroundPicker(st, o) {
  const own = (st.bg || 'own') === 'own';
  const cur = o.venue();
  const grid = h('div.hw-venues.hl-bgs');
  const ownBtn = h('button.hw-venue.hl-own', { type: 'button', title: 'The room that comes with the style', 'aria-pressed': String(own) }, h('img', { src: styleThumb(st.theme), alt: '' }), h('span', { text: 'Style’s room' }));
  ownBtn.onclick = () => change((s) => (s.bg = 'own'));
  grid.append(ownBtn);
  for (const v of VENUES) {
    const th = venueThumb(v);
    const b = h('button.hw-venue', { type: 'button', title: v.name, 'aria-pressed': String(!own && cur === v.id) }, th ? h('img', { src: th, alt: '' }) : h(v.scene ? `i.fluid.sc-${v.scene}` : v.fluid ? 'i.fluid' : 'i.plain'), h('span', { text: v.name }));
    b.onclick = () => {
      o.pick(v.id);
      if (own) change((s) => (s.bg = 'venue'));
      else o.redraw && o.redraw();
    };
    grid.append(b);
  }
  const name = own ? 'Style’s own room' : (VENUES.find((x) => x.id === cur) || {}).name || 'Venue';
  return fold('hl-bg-fold', 'Background', name, o.open(), (v) => o.onFold(v), grid);
}

/**
 * The highway pullout's part. o: venue(), pick(id), bgOpen(), onBgFold(v), more() (opens Settings ›
 * Display at the highway).
 */
export function drawerLooks(o) {
  const el = h('div.hl-looks.hl-drawer');
  const paint = () => {
    const st = loadLooks();
    const more = h('button.btn.small.hl-more', { type: 'button', text: 'More highway settings' });
    more.onclick = () => o.more();
    swap(el,
      h('div.hl-row', null, h('div.hl-row-t', null, h('b', { text: 'Style' }), h('small', { text: themeById(st.theme).about }))),
      styleTiles(st),
      backgroundPicker(st, { venue: o.venue, pick: o.pick, open: o.bgOpen, onFold: (v) => (o.onBgFold(v), paint()), redraw: paint }),
      qualityRow(st),
      more
    );
  };
  return live(el, paint);
}

/** Settings › Display's part: everything about the highway's look and graphics. */
export function lookSection() {
  const el = h('div.hl-looks.hl-full');
  let tuneOpen = false;
  let bgOpen = false;
  const venueNow = () => {
    const p = hwPrefs();
    return VENUE_ALIAS[p.venue] || p.venue || 'warehouse';
  };
  const paint = () => {
    const st = loadLooks();
    const t = themeById(st.theme);
    // the big picture of the style in use
    swap(el, h('figure.hl-hero', null, h('img', { src: styleThumb(t.id, true), alt: `The highway in ${t.name}` }),
      h('figcaption', null, h('b', { text: t.name }), h('span', { text: t.about }), h('i', { text: t.wink }))),
    styleTiles(st, { lines: true }),
    backgroundPicker(st, {
      venue: venueNow,
      pick: (id) => tellHighway('venue', id),
      open: () => bgOpen,
      onFold: (v) => ((bgOpen = v), paint()),
      redraw: () => setTimeout(paint, 0),
    }),
    fineTune(st, t),
    graphics(st));
  };

  function fineTune(st, t) {
    const s = themeSettings(st, t.id);
    const box = h('div.hl-theme-opts');
    box.append(
      slider('Brightness', 'The whole highway, darker or lighter. Labels stay as they are.', THEME_SETTINGS.bright, s.bright, pct, (v) => setTheme('bright', v)),
      seg('Effects', t.sig.amb === 'none' ? 'The light and effects on a hit: Calm makes them smaller and softer, Off leaves them out.' : 'The light and effects on a hit, and the style’s movement in the room.', FX_ROWS, s.fx, (v) => setTheme('fx', v))
    );
    const reset = h('button.btn.small.hl-reset', { type: 'button', text: `Reset ${t.name}` });
    reset.onclick = () => change((st2) => delete st2.per[st2.theme]);
    box.append(reset);
    return fold('hl-tune-fold', `Fine-tune ${t.name}`, st.per[t.id] ? 'Changed' : 'As made', tuneOpen, (v) => ((tuneOpen = v), paint()), box);
  }

  function graphics(st) {
    const g = st.gfx;
    const box = h('div.hl-gfx');
    const presets = h('div.hl-presets', { role: 'radiogroup', 'aria-label': 'Graphics quality' });
    for (const [id, name, line] of PRESET_ROWS) {
      const b = h('button.hl-preset', { type: 'button', role: 'radio', 'aria-checked': String(g.preset === id) }, h('b', { text: name }), h('small', { text: line }));
      b.onclick = () => change((s) => (s.gfx = applyPreset(s.gfx, id)));
      presets.append(b);
    }
    box.append(h('div.hl-row-t', null, h('b', { text: 'Graphics quality' }), h('small', { text: 'Low to Ultra: how much the graphics card does. None of these adds any delay, and every note stays in the same place.' })), presets);
    box.append(
      seg('Frame rate cap', 'Fewer pictures a second: a cooler, quieter PC. The song and scoring keep their own timing.', [[0, 'Screen'], [30, '30'], [60, '60'], [120, '120']], g.fpsCap, (v) => setGfx('fpsCap', v)),
      sw('Show frame rate', 'A small counter in the corner: pictures a second and how busy the graphics card is.', !!hwPrefs().showFps, (v) => {
        tellHighway('showFps', v);
        setTimeout(paint, 0);
      })
    );
    return box;
  }

  return live(el, paint);
}
