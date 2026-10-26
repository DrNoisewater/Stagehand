/** The tuner card (Play page): note, needle, cents, and a button per string. */
import { h, icon } from './ui.js';
import { rig, TUNINGS, noteName } from './rig.js';

const STRING_COLORS = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];

function load() {
  try {
    return { tuning: 'e-std', ref: 440, ...(JSON.parse(localStorage.getItem('stagehand.tuner3') || '{}') || {}) };
  } catch (_) {
    return { tuning: 'e-std', ref: 440 };
  }
}

export function createTuner() {
  const prefs = load();
  const save = () => {
    try {
      localStorage.setItem('stagehand.tuner3', JSON.stringify(prefs));
    } catch (_) {}
  };
  const T = { lock: null, last: 0, raf: 0, visible: false };
  const el = h('section.card.tint.tuner3', { 'aria-label': 'Tuner', style: { '--gel': '#6bd49a' } });
  const tuneSel = h('select.input', { 'aria-label': 'Tuning' });
  const refSel = h('select.input', { 'aria-label': 'Reference pitch' });
  const note = h('div.tn-note', { text: '–' });
  const needle = h('i.tn-needle');
  const cents = h('span.c', { text: 'Play one open string' });
  const hz = h('span', { text: '' });
  const strings = h('div.tn-strings');
  el.append(
    h('div.card-head', null, h('h2', { text: 'Tuner' }), h('span.grow'), tuneSel, refSel),
    h('div.tn-row', null, note, h('div', { style: { flex: '1' } }, h('div.tn-scale', null, needle), h('div.tn-read', null, h('span', { text: '−50' }), cents, h('span', { text: '+50' })))),
    h('div.tn-read', { style: { justifyContent: 'center' } }, hz),
    strings
  );

  function bass() {
    return rig.tone && rig.tone.kind === 'bass';
  }

  function targets() {
    const refCents = 1200 * Math.log2(Number(prefs.ref || 440) / 440);
    if (prefs.tuning === 'chromatic') return { chromatic: true, refCents, list: [] };
    const t = TUNINGS.find((x) => x.id === prefs.tuning) || TUNINGS[0];
    const base = bass() ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64];
    const list = base.map((m, i) => {
      const midi = m + t.o[i];
      const c = midi * 100 + refCents;
      return { midi, cents: c, name: noteName(midi), hz: 440 * Math.pow(2, (c - 6900) / 1200) };
    });
    return { chromatic: false, refCents, list };
  }

  function build() {
    tuneSel.innerHTML = '';
    tuneSel.append(h('option', { value: 'chromatic', text: 'Chromatic' }));
    for (const t of TUNINGS) tuneSel.append(h('option', { value: t.id, text: t.name }));
    tuneSel.value = prefs.tuning;
    refSel.innerHTML = '';
    for (const r of [440, 432, 442, 444]) refSel.append(h('option', { value: String(r), text: `A${r}` }));
    refSel.value = String(prefs.ref || 440);
    strings.innerHTML = '';
    const tg = targets();
    strings.style.setProperty('--n', String(tg.list.length || 6));
    strings.hidden = tg.chromatic;
    tg.list.forEach((x, s) => {
      const b = h('button', { type: 'button', text: x.name, title: `${x.name}: ${x.hz.toFixed(2)} Hz (click to tune only this string)`, style: { '--gel': STRING_COLORS[s] } });
      b.dataset.s = String(s);
      b.classList.toggle('locked', T.lock === s);
      b.onclick = () => {
        T.lock = T.lock === s ? null : s;
        build();
      };
      strings.append(b);
    });
  }
  tuneSel.onchange = () => {
    prefs.tuning = tuneSel.value;
    T.lock = null;
    save();
    build();
  };
  refSel.onchange = () => {
    prefs.ref = Number(refSel.value);
    save();
    build();
  };

  function update() {
    const now = performance.now();
    if (now - T.last < 60) return;
    T.last = now;
    const p = rig.on ? rig.pitch() : null;
    if (!p) {
      needle.style.opacity = '0.3';
      needle.classList.remove('ok');
      if (!rig.on) {
        note.textContent = '–';
        note.className = 'tn-note';
        cents.textContent = 'Plug in your guitar to tune';
        cents.className = 'c';
        hz.textContent = '';
      }
      return;
    }
    const c = 100 * (12 * Math.log2(p.hz / 440) + 69);
    const tg = targets();
    let target = null;
    let off;
    let label;
    let targetHz;
    if (!tg.chromatic) {
      let best = Infinity;
      tg.list.forEach((x, s) => {
        if (T.lock != null && s !== T.lock) return;
        const d = c - x.cents;
        if (Math.abs(d) < Math.abs(best)) {
          best = d;
          target = s;
        }
      });
      if (Math.abs(best) <= 350 || T.lock != null) {
        off = best;
        label = tg.list[target].name;
        targetHz = tg.list[target].hz;
      } else target = null;
    }
    if (target === null) {
      const rel = c - tg.refCents;
      const m = Math.round(rel / 100);
      off = rel - m * 100;
      label = noteName(m);
      targetHz = 440 * Math.pow(2, (m * 100 + tg.refCents - 6900) / 1200);
    }
    const a = Math.abs(off);
    note.textContent = label;
    note.className = `tn-note${a < 1.5 ? ' ok' : a < 6 ? ' near' : ''}`;
    cents.textContent = a < 0.5 ? 'In tune' : `${a.toFixed(1)} cents ${off > 0 ? 'sharp' : 'flat'}`;
    cents.className = `c${a < 1.5 ? ' ok' : ''}`;
    hz.textContent = `${p.hz.toFixed(2)} Hz · target ${targetHz.toFixed(2)} Hz`;
    needle.style.left = `${50 + Math.max(-50, Math.min(50, off))}%`;
    needle.style.opacity = '1';
    needle.classList.toggle('ok', a < 1.5);
    for (const b of strings.children) b.classList.toggle('on', Number(b.dataset.s) === target);
  }

  function loop() {
    T.raf = 0;
    if (!T.visible) return;
    update();
    T.raf = requestAnimationFrame(loop);
  }

  let lastKind = null;
  rig.addEventListener('change', () => {
    const k = bass();
    if (k !== lastKind) {
      lastKind = k;
      build();
    }
  });
  build();
  return {
    el,
    show() {
      T.visible = true;
      if (!T.raf) T.raf = requestAnimationFrame(loop);
    },
    hide() {
      T.visible = false;
    },
  };
}
