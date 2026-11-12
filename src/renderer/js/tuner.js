/**
 * The tuner card (Jam page, and U on the highway): note, needle, cents, and a
 * button per string. 4.1.6: by default it follows the tuning you want to be in:
 * the open song's (less whatever the Drop is doing for you), or with no song,
 * the tuning Stagehand knows your instrument is in. Picking a tuning by hand
 * lasts until the next song.
 */
import { did } from './rewards.js';
import { h, icon } from './ui.js';
import { rig, TUNINGS, noteName } from './rig.js';
import { myTuning, myCents, tuningName } from './tuning.js';

const STRING_COLORS = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];

function load() {
  try {
    const p = { tuning: 'auto', ref: 440, ...(JSON.parse(localStorage.getItem('stagehand.tuner3') || '{}') || {}) };
    // 4.1.6: a tuning picked by hand used to stick forever (Drop D after you'd gone back to E Standard)
    if (!p.v416) p.tuning = 'auto';
    p.v416 = 1;
    return p;
  } catch (_) {
    return { tuning: 'auto', ref: 440, v416: 1 };
  }
}

/** 4.11: the tuner has two looks: 'bar' (a needle across) and 'tower' (a tall meter: up is sharp). */
export const TUNER_LOOKS = [
  ['bar', 'Needle', 'A needle across a bar'],
  ['tower', 'Tower', 'A tall meter: up is sharp, down is flat'],
];
export function tunerLook() {
  return load().look === 'tower' ? 'tower' : 'bar';
}
export function setTunerLook(look) {
  const p = load();
  p.look = look === 'tower' ? 'tower' : 'bar';
  try {
    localStorage.setItem('stagehand.tuner3', JSON.stringify(p));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('stagehand:tuner-look', { detail: p.look }));
}
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];

let tunerWin = null;
/** The tuner in a window of its own, from anywhere (U, or Tuner on your guitar's card). */
export async function openTuner() {
  if (tunerWin) return tunerWin.close();
  const { modal } = await import('./ui.js');
  const t = createTuner();
  t.el.classList.add('tn-solo');
  tunerWin = modal({ title: 'Tuner', body: t.el, onClose: () => (t.hide(), (tunerWin = null)) });
  t.show();
  return tunerWin;
}

export function createTuner() {
  const prefs = load();
  const save = () => {
    try {
      prefs.look = tunerLook(); // the look is shared by every tuner in the app
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
  // 4.11: two looks, yours to pick (here, or Settings › Appearance)
  const lookBtn = h('button.icon-btn.tn-look', { type: 'button' });
  const tower = h('div.tn-tower', { 'aria-hidden': 'true' }, h('span.tn-t-lab.up', { text: '+50' }), h('span.tn-t-lab.dn', { text: '−50' }), h('div.tn-t-col', null, h('i.tn-t-fill'), h('i.tn-t-zero'), h('i.tn-t-dot')));
  const applyLook = () => {
    const look = tunerLook();
    el.classList.toggle('tower', look === 'tower');
    lookBtn.innerHTML = icon(look === 'tower' ? 'levels' : 'sliders');
    lookBtn.title = look === 'tower' ? 'Tower look. Click for the needle look' : 'Needle look. Click for the tower look';
    lookBtn.setAttribute('aria-label', 'Change how the tuner looks');
  };
  lookBtn.onclick = () => setTunerLook(tunerLook() === 'tower' ? 'bar' : 'tower');
  window.addEventListener('stagehand:tuner-look', applyLook);
  el.append(
    h('div.card-head', null, h('h2', { text: 'Tuner' }), h('span.grow'), tuneSel, refSel, lookBtn),
    h('div.tn-row', null, note, h('div.tn-bar', { style: { flex: '1' } }, h('div.tn-scale', null, needle), h('div.tn-read', null, h('span', { text: '−50' }), cents, h('span', { text: '+50' }))), tower),
    h('div.tn-read.tn-hz', { style: { justifyContent: 'center' } }, hz),
    strings
  );
  applyLook();

  function bass() {
    // what's plugged in, when Stagehand has heard it; else the tone you picked
    return (rig.instrument || (rig.tone && rig.tone.kind)) === 'bass';
  }

  /** What "Follow the song" means right now: { offs, cents, name, from }. */
  function wanted() {
    const kind = bass() ? 'bass' : 'guitar';
    const n = kind === 'bass' ? 4 : 6;
    const song = Array.isArray(rig.songTuning) && rig.songTuning.length ? rig.songTuning : null;
    if (song) {
      // with the Drop on, the pedal lowers your sound; your strings stay that much higher
      const drop = (rig.drop && rig.drop.on && rig.dropAmount ? rig.dropAmount() : 0) || 0;
      const offs = Array.from({ length: n }, (_, i) => (Math.round(Number(song[i]) || 0) + Math.round(drop)));
      const cents = Number(rig.songCents) || 0;
      return { offs, cents, name: tuningName(offs, kind), from: drop ? `the song, with the Drop −${Math.round(drop)}` : 'the song' };
    }
    return { offs: myTuning(kind), cents: myCents(kind), name: tuningName(myTuning(kind), kind), from: 'your guitar' };
  }

  function targets() {
    let refCents = 1200 * Math.log2(Number(prefs.ref || 440) / 440);
    if (prefs.tuning === 'chromatic') return { chromatic: true, refCents, list: [] };
    let o;
    if (prefs.tuning === 'auto') {
      const w = wanted();
      o = w.offs;
      if (Math.abs(w.cents) >= 8 && Number(prefs.ref || 440) === 440) refCents = w.cents; // the song's own reference (A425…)
    } else o = (TUNINGS.find((x) => x.id === prefs.tuning) || TUNINGS[0]).o;
    const base = bass() ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64];
    const list = base.map((m, i) => {
      const midi = m + (o[i] || 0);
      const c = midi * 100 + refCents;
      return { midi, cents: c, name: noteName(midi), hz: 440 * Math.pow(2, (c - 6900) / 1200) };
    });
    return { chromatic: false, refCents, list };
  }

  function build() {
    tuneSel.innerHTML = '';
    const w = wanted();
    tuneSel.append(h('option', { value: 'auto', text: `${w.name} (${w.from})` }));
    tuneSel.title = `Follows ${w.from}. Pick another tuning for now; the next song sets it back.`;
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
      const b = h('button', { type: 'button', title: `${x.name}: ${x.hz.toFixed(2)} Hz (click to tune only this string)`, style: { '--gel': STRING_COLORS[s] } });
      b.dataset.s = String(s);
      b.append(h('b', { text: x.name }), h('small', { text: ORD[tg.list.length - 1 - s] || '' }));
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
      el.classList.remove('heard', 'intune');
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
    el.style.setProperty('--off', Math.max(-50, Math.min(50, off)).toFixed(1));
    el.classList.add('heard');
    el.classList.toggle('intune', a < 1.5);
    el.classList.toggle('sharp', off > 0);
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
  let lastWant = '';
  const refresh = () => {
    const k = bass();
    const sig = JSON.stringify([rig.songTuning || null, rig.songCents || 0]);
    const w = wanted();
    const want = JSON.stringify([w.offs, w.cents, w.from]);
    // a new song: back to following it
    if (sig !== refresh.sig) {
      refresh.sig = sig;
      if (prefs.tuning !== 'auto' && prefs.tuning !== 'chromatic') {
        prefs.tuning = 'auto';
        T.lock = null;
        save();
      }
    }
    if (k !== lastKind || want !== lastWant) {
      lastKind = k;
      lastWant = want;
      build();
    }
  };
  refresh.sig = JSON.stringify([rig.songTuning || null, rig.songCents || 0]);
  rig.addEventListener('change', refresh);
  rig.addEventListener('drop', refresh);
  window.addEventListener('storage', refresh);
  build();
  return {
    el,
    show() {
      refresh(); // what you're tuned to may have changed while it was hidden
      T.visible = true;
      did('tuner');
      if (!T.raf) T.raf = requestAnimationFrame(loop);
    },
    hide() {
      T.visible = false;
    },
  };
}
