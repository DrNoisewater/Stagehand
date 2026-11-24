/**
 * The highway's style, background and graphics settings.
 * 4.31: two sizes. In the highway's Sound & settings pullout (drawerLooks): style tiles, the
 * background, one quality row and a button to the rest. In Settings › Display (lookSection): a big
 * picture of the style, every style with a line about it, the background, Fine-tune for the style
 * in use, and the graphics presets with the single options under Advanced.
 * Changes are saved and used at once; each block redraws itself when something changes.
 */
import { h } from './ui.js';
import { THEMES, THEME_SETTINGS, HITS, loadLooks, saveLooks, onLooks, themeById, themeSettings, applyPreset } from './hwlooks.js';
import { VENUES, VENUE_ALIAS, venueThumb } from './venues.js';

const PRESET_ROWS = [
  ['auto', 'Auto', 'Keeps it smooth: the fancy bits go first, sharpness last.'],
  ['low', 'Low', 'Older laptop? Every note still lands in the same place.'],
  ['medium', 'Medium', 'The sensible middle.'],
  ['high', 'High', 'The full show, for most PCs.'],
  ['ultra', 'Ultra', 'Your graphics card asked for a challenge.'],
];
const GEMS = [['solid', 'Classic', 'Lit edges and a light bar, as always'], ['satin', 'Satin', 'Smooth solid colour, soft edges'], ['glass', 'Glass', 'Tinted glass in a chrome rim'], ['neon', 'Neon', 'Dark inside, a bright glowing outline'], ['paint', 'Painted', 'Worn paint with a strip of gold tape'], ['flat', 'Flat', 'One flat colour, a white outline: the easiest to read']];

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
const setGfx = (k, v) => change((st) => {
  st.gfx = { ...st.gfx, [k]: v };
  if (['res', 'aa', 'bloom', 'refl', 'shadows', 'fx'].includes(k)) st.gfx.preset = 'custom';
});

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
  const g = st.gfx;
  const opts = PRESET_ROWS.map(([id, name, tip]) => [id, name, tip]);
  if (g.preset === 'custom') opts.push(['custom', 'Custom', 'Your own mix (Settings › Display)']);
  return seg(label, null, opts, g.preset, (v) => v !== 'custom' && change((s) => (s.gfx = applyPreset(s.gfx, v))));
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
    el.innerHTML = '';
    const more = h('button.btn.small.hl-more', { type: 'button', text: 'More highway settings' });
    more.onclick = () => o.more();
    el.append(
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
  let advOpen = false;
  let bgOpen = false;
  const venueNow = () => {
    const p = hwPrefs();
    return VENUE_ALIAS[p.venue] || p.venue || 'warehouse';
  };
  const paint = () => {
    const st = loadLooks();
    const t = themeById(st.theme);
    el.innerHTML = '';
    // the big picture of the style in use
    el.append(h('figure.hl-hero', null, h('img', { src: styleThumb(t.id, true), alt: `The highway in ${t.name}` }),
      h('figcaption', null, h('b', { text: t.name }), h('span', { text: t.about }), h('i', { text: t.wink }))));
    el.append(styleTiles(st, { lines: true }));
    el.append(backgroundPicker(st, {
      venue: venueNow,
      pick: (id) => tellHighway('venue', id),
      open: () => bgOpen,
      onFold: (v) => ((bgOpen = v), paint()),
      redraw: () => setTimeout(paint, 0),
    }));
    el.append(fineTune(st, t));
    el.append(graphics(st));
  };

  function fineTune(st, t) {
    const s = themeSettings(st, t.id);
    const box = h('div.hl-theme-opts');
    box.append(
      slider('Brightness', 'The whole highway, darker or lighter. Labels stay as they are.', THEME_SETTINGS.bright, s.bright, pct, (v) => setTheme('bright', v)),
      slider('Glow', 'Soft light round notes, rails and hits, and the bloom.', THEME_SETTINGS.glow, s.glow, pct, (v) => setTheme('glow', v)),
      slider('Fog', 'How much the far end fades into the room.', THEME_SETTINGS.fog, s.fog, pct, (v) => setTheme('fog', v)),
      seg('Notes', 'Only the finish: every note keeps its string colour, size and place.', GEMS, s.gem, (v) => setTheme('gem', v)),
      seg('Reflections on the floor', null, [['off', 'Off'], ['soft', 'Soft'], ['full', 'Full', 'A mirror floor (needs Reflections quality set to Mirror floor)']], s.refl, (v) => setTheme('refl', v)),
      seg('Hit effect', 'What flies off a note you hit.', HITS.map(([id, name, line]) => [id, name, line]), s.hit, (v) => setTheme('hit', v)),
      sw('Movement in the room', t.sig.amb === 'none' ? 'This style has none.' : 'The style’s slow movement: light, dust, embers and the like. Graphics quality Low turns it off.', s.amb && t.sig.amb !== 'none', (v) => setTheme('amb', v))
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
    box.append(h('div.hl-row-t', null, h('b', { text: 'Graphics quality' }), h('small', { text: g.preset === 'custom' ? 'Custom: your own mix of the settings under Advanced.' : 'None of these adds any delay.' })), presets);
    const auto = g.preset === 'auto';
    const adv = h('div.hl-adv');
    adv.append(
      seg('Sharpness (render size)', auto ? 'Auto picks it as you play.' : 'How big the picture is drawn. Above 100% is supersampling: smoother edges, a lot more work.',
        [['auto', 'Auto'], [0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.25, '125%'], [1.5, '150%'], [2, '200%']], auto ? 'auto' : g.res, (v) => setGfx('res', v)),
      seg('Edge smoothing', 'MSAA: clean edges, some work (the usual). FXAA: cheaper, a touch softer. Off: cheapest, jagged edges.',
        [['off', 'Off'], ['fxaa', 'FXAA'], ['msaa4', 'MSAA 4×'], ['msaa8', 'MSAA 8×']], g.aa, (v) => setGfx('aa', v)),
      seg('Bloom', 'Bright things shine a little into the dark around them.', [['off', 'Off'], ['full', 'On']], g.bloom === 'off' ? 'off' : 'full', (v) => setGfx('bloom', v)),
      seg('Reflections quality', 'Simple: a faint copy of each note on the floor (cheap). Mirror floor: notes, strings and frets mirrored (draws them twice).',
        [['off', 'Off'], ['simple', 'Simple'], ['mirror', 'Mirror floor']], g.refl, (v) => setGfx('refl', v)),
      seg('Style effects', 'Full: each style’s movement in the room and its moving rails. Simple: still.', [['simple', 'Simple'], ['full', 'Full']], g.fx, (v) => setGfx('fx', v)),
      seg('Frame rate cap', 'Fewer pictures a second: a cooler, quieter PC. The song and scoring keep their own timing.', [[0, 'Screen'], [30, '30'], [60, '60'], [120, '120']], g.fpsCap, (v) => setGfx('fpsCap', v)),
      sw('Distance blur', 'Softens the far end. Off by default: far notes get a little harder to read early.', g.dof, (v) => setGfx('dof', v)),
      sw('Vignette', 'Slightly darker corners, like a camera lens. Almost free.', g.vignette, (v) => setGfx('vignette', v)),
      sw('Film grain', 'A faint moving grain over the room and floor (never the labels). Almost free.', g.grain, (v) => setGfx('grain', v)),
      sw('Show frame rate', 'A small counter in the corner: pictures a second and how busy the graphics card is.', !!hwPrefs().showFps, (v) => {
        tellHighway('showFps', v);
        setTimeout(paint, 0);
      })
    );
    box.append(fold('hl-adv-fold', 'Advanced', g.preset === 'custom' ? 'Custom' : 'From the preset', advOpen, (v) => ((advOpen = v), paint()), adv));
    return box;
  }

  return live(el, paint);
}
