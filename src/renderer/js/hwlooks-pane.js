/**
 * The highway look picker and graphics settings, as one block: in the highway's Sound & settings
 * pullout (folded under one line) and in Settings › Display. Changes are saved and used at once.
 */
import { h } from './ui.js';
import { THEMES, THEME_SETTINGS, PRESETS, loadLooks, saveLooks, onLooks, themeById, themeSettings, applyPreset } from './hwlooks.js';

const STRING = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];

const PRESET_ROWS = [
  ['auto', 'Auto', 'Keeps it smooth: the fancy bits go first, sharpness last.'],
  ['low', 'Low', 'Older laptop? Every note still lands in the same place.'],
  ['medium', 'Medium', 'The sensible middle.'],
  ['high', 'High', 'The full show, for most PCs.'],
  ['ultra', 'Ultra', 'Your graphics card asked for a challenge.'],
];

/** A tiny picture of a look: its room, its floor, the lane with its rails, notes in the string colours. */
function swatch(t) {
  const [sky, hor, lane, rail] = t.swatch;
  return h('span.hl-sw', { 'aria-hidden': 'true', style: { '--sky': sky, '--hor': hor, '--lane': lane, '--rail': rail, '--n1': STRING[0], '--n2': STRING[2], '--n3': STRING[4] } }, h('i.hl-sw-lane'), h('i.hl-sw-n'));
}

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
const showFps = () => {
  try { return !!JSON.parse(localStorage.getItem('stagehand.highway') || '{}').showFps; } catch (_) { return false; }
};

/**
 * The whole block. opts: compact (the highway pullout), open (folded open at first), onFold(open).
 * It redraws itself when something changes (here or elsewhere), and nothing else.
 */
export function lookSection(opts = {}) {
  const el = h('div.hl-looks');
  let open = opts.compact ? !!opts.open : true;
  let gfxOpen = !opts.compact;
  let unsub = () => {};
  const set = (fn) => {
    const st = structuredClone(loadLooks());
    fn(st);
    saveLooks(st);
  };
  const setTheme = (k, v) => set((st) => {
    st.per[st.theme] = { ...(st.per[st.theme] || {}), [k]: v };
  });
  const setGfx = (k, v) => set((st) => {
    st.gfx = { ...st.gfx, [k]: v };
    if (['res', 'aa', 'bloom', 'refl', 'shadows'].includes(k)) st.gfx.preset = 'custom';
  });

  function themes(st) {
    const grid = h('div.hl-themes', { role: 'radiogroup', 'aria-label': 'Highway look' });
    for (const t of THEMES) {
      const on = st.theme === t.id;
      const b = h('button.hl-theme', { type: 'button', role: 'radio', 'aria-checked': String(on), title: t.wink }, swatch(t), h('span.hl-theme-n', { text: t.name }), t.isNew ? h('em.hl-new', { text: 'New' }) : null);
      b.onclick = () => set((s) => (s.theme = t.id));
      grid.append(b);
    }
    return grid;
  }

  function themeOptions(st) {
    const t = themeById(st.theme);
    const s = themeSettings(st, t.id);
    const box = h('div.hl-theme-opts');
    box.append(h('p.hl-note', null, h('b', { text: t.name }), ' ', t.about, ' ', h('i', { text: t.wink })));
    box.append(
      slider('Brightness', 'The whole highway, darker or lighter. Labels stay as they are.', THEME_SETTINGS.bright, s.bright, pct, (v) => setTheme('bright', v)),
      slider('Glow', 'Soft light round notes, rails and hits, and the bloom.', THEME_SETTINGS.glow, s.glow, pct, (v) => setTheme('glow', v)),
      seg('Reflections on the floor', null, [['off', 'Off'], ['soft', 'Soft'], ['full', 'Full', 'A mirror floor (needs Reflections quality set to Mirror floor)']], s.refl, (v) => setTheme('refl', v)),
      seg('Background', null, [['own', 'This look’s room'], ['venue', 'My venue']], s.back, (v) => setTheme('back', v)),
      slider('Fog', 'How much the far end fades into the room.', THEME_SETTINGS.fog, s.fog, pct, (v) => setTheme('fog', v)),
      seg('Notes', 'Only the finish: every note keeps its string colour, size and place.', [['solid', 'Classic', 'Lit edges and a light bar, as always'], ['satin', 'Satin', 'Smooth solid colour, soft edges'], ['glass', 'Glass', 'Tinted glass in a chrome rim'], ['neon', 'Neon', 'Dark inside, a bright glowing outline'], ['paint', 'Painted', 'Worn paint with a strip of gold tape'], ['flat', 'Flat', 'One flat colour, a white outline: the easiest to read']], s.gem, (v) => setTheme('gem', v)),
      sw('Sparks on hits', 'Little sparks fly when you hit a note.', s.sparks, (v) => setTheme('sparks', v))
    );
    const reset = h('button.btn.small.hl-reset', { type: 'button', text: `Reset ${t.name}` });
    reset.onclick = () => set((st2) => delete st2.per[st2.theme]);
    box.append(reset);
    return box;
  }

  function graphics(st) {
    const g = st.gfx;
    const body = h('div.hl-gfx');
    const presets = h('div.hl-presets', { role: 'radiogroup', 'aria-label': 'Graphics quality' });
    for (const [id, name, line] of PRESET_ROWS) {
      const b = h('button.hl-preset', { type: 'button', role: 'radio', 'aria-checked': String(g.preset === id) }, h('b', { text: name }), h('small', { text: line }));
      b.onclick = () => set((s) => (s.gfx = applyPreset(s.gfx, id)));
      presets.append(b);
    }
    body.append(presets);
    if (g.preset === 'custom') body.append(h('p.hl-note', { text: 'Custom: your own mix of the settings below.' }));
    const auto = g.preset === 'auto';
    body.append(
      seg('Sharpness (render size)', auto ? 'Auto picks it as you play.' : 'How big the picture is drawn. Above 100% is supersampling: smoother edges, a lot more work.',
        [['auto', 'Auto'], [0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.25, '125%'], [1.5, '150%'], [2, '200%']], auto ? 'auto' : g.res, (v) => setGfx('res', v)),
      seg('Edge smoothing (anti-aliasing)', 'MSAA: clean edges, some work (the usual). FXAA: cheaper, a touch softer. Off: cheapest, jagged edges.',
        [['off', 'Off'], ['fxaa', 'FXAA'], ['msaa4', 'MSAA 4×'], ['msaa8', 'MSAA 8×']], g.aa, (v) => setGfx('aa', v)),
      seg('Bloom', 'Bright things shine a little into the dark around them. Half size costs much less.', [['off', 'Off'], ['half', 'Half size'], ['full', 'Full']], g.bloom, (v) => setGfx('bloom', v)),
      seg('Reflections quality', 'Simple: a faint copy of each note on the floor (cheap). Mirror floor: notes, strings and frets mirrored (draws them twice).',
        [['off', 'Off'], ['simple', 'Simple'], ['mirror', 'Mirror floor']], g.refl, (v) => setGfx('refl', v)),
      seg('Shadows', 'A soft shadow on the floor under each note (looks that use them). Cheap.', [['off', 'Off'], ['on', 'Soft']], g.shadows, (v) => setGfx('shadows', v)),
      seg('Frame rate cap', 'Fewer pictures a second: a cooler, quieter PC. The song and scoring keep their own timing.', [[0, 'Screen'], [30, '30'], [60, '60'], [120, '120']], g.fpsCap, (v) => setGfx('fpsCap', v)),
      sw('Distance blur (depth of field)', 'Softens the far end. Off by default: far notes get a little harder to read early.', g.dof, (v) => setGfx('dof', v)),
      sw('Vignette', 'Slightly darker corners, like a camera lens. Almost free.', g.vignette, (v) => setGfx('vignette', v)),
      sw('Film grain', 'A faint moving grain over the room and floor (never the labels). Almost free.', g.grain, (v) => setGfx('grain', v)),
      sw('Show frame rate', 'A small counter in the corner: pictures a second and how busy the graphics card is.', showFps(), (v) => {
        window.dispatchEvent(new CustomEvent('stagehand:highway-pref', { detail: { key: 'showFps', value: v } }));
        draw();
      })
    );
    body.append(h('p.hl-note.hl-left-out', { text: 'Left out on purpose: motion blur and temporal smoothing (they smear moving notes), ambient occlusion, shadow maps and texture filtering (nothing on the highway they would improve). V-sync is always on: the screen sets the pace. Moving venues skip bloom, blur, vignette and grain. None of these settings adds any delay.' }));
    const name = (PRESET_ROWS.find((r) => r[0] === g.preset) || [0, 'Custom'])[1];
    return fold('hl-gfx-fold', 'Graphics', name, gfxOpen, (v) => {
      gfxOpen = v;
      draw();
    }, body);
  }

  function draw() {
    const st = loadLooks();
    el.innerHTML = '';
    const body = h('div.hl-body', null, themes(st), themeOptions(st), graphics(st));
    if (opts.compact) {
      el.append(fold('hl-look-fold', 'Look', themeById(st.theme).name, open, (v) => {
        open = v;
        if (opts.onFold) opts.onFold(v);
        draw();
      }, body));
    } else el.append(body);
  }
  draw();
  // changes made elsewhere (the other copy of this block) show here too; stop once this block is gone
  unsub = onLooks(() => {
    if (!el.isConnected) return unsub();
    draw();
  });
  return el;
}
