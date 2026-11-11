/**
 * 4.5: the Drop console, one control for every place the Drop shows (Play page, highway
 * Master Settings). Replaces the pedal photo that sat in the Play card (the user: it looked
 * cool but was in the wrong place) and the two different sets of chips.
 *
 *   ┌ DROP ─────────────────────── ● [ footswitch ] ┐
 *   │  −2   sounds like D Standard                   │  the readout: what you hear, big
 *   │  status line (working / not needed / …)        │
 *   │  [−1][−2][−3][−4][−5][−6][−7][OCT]  ‹ ›        │  steps; ← → keys nudge
 *   │  (Match the song −2)  (Hold to drop)           │
 *   │  Your guitar is in [E Standard ▾]              │
 *   └────────────────────────────────────────────────┘
 *
 * It reads and writes rig.drop only (the same state the D key and the engine use), and
 * updates itself in place when the Drop changes anywhere (no rebuild, no flicker).
 */
import { h } from './ui.js';
import { rig } from './rig.js';
import { did } from './rewards.js';
import { tuningName, myTuning, setMyTuning, MY_TUNINGS, MY_TUNINGS_BASS } from './tuning.js';

export const DROP_STEPS = [1, 2, 3, 4, 5, 6, 7, 12];

/** What your instrument sounds like with the Drop at `amt` semitones. */
export function soundsLike(amt, kind = 'guitar') {
  if (!amt) return tuningName(myTuning(kind), kind);
  if (amt >= 12) return `${tuningName(myTuning(kind), kind)}, an octave down`;
  return tuningName(myTuning(kind).map((x) => x - amt), kind);
}

/**
 * @param {object} o
 * @param {'guitar'|'bass'} [o.kind]
 * @param {boolean} [o.compact] the highway's narrower version
 * @param {Node[]} [o.extra] more rows (the highway adds what the song needs + the tuning guide)
 * @param {Function} [o.onTuningChange] after "your guitar is in" changes
 */
export function dropConsole({ kind = 'guitar', compact = false, extra = [], onTuningChange = null } = {}) {
  const el = h(`section.dc${compact ? '.compact' : ''}`, { 'aria-label': 'Drop tuning' });
  const led = h('span.dc-led', { 'aria-hidden': 'true' });
  const foot = h('button.dc-foot', { type: 'button', title: 'Drop on or off (D)', 'aria-label': 'Drop on or off' }, h('span.dc-foot-cap'));
  const amtEl = h('b.dc-amt');
  const like = h('span.dc-like');
  const line = h('small.dc-line');
  const warn = h('small.dc-warn', { hidden: true });
  const steps = h('div.dc-steps', { role: 'radiogroup', 'aria-label': 'How far down', tabindex: '0' });
  const stepBtns = DROP_STEPS.map((st) => {
    const b = h('button.dc-step', { type: 'button', role: 'radio', text: st === 12 ? 'OCT' : `−${st}`, title: `Drop ${st === 12 ? 'an octave' : `${st} semitone${st > 1 ? 's' : ''}`}: sounds like ${soundsLike(st, kind)}` });
    b.onclick = () => set({ st, match: false, on: true });
    steps.append(b);
    return b;
  });
  const nudge = (d) => {
    const cur = rig.drop.on ? rig.dropAmount() : 0;
    const i = DROP_STEPS.indexOf(cur);
    const next = i < 0 ? (d > 0 ? 0 : DROP_STEPS.length - 1) : Math.max(-1, Math.min(DROP_STEPS.length - 1, i + d));
    if (next < 0) return set({ on: false, match: false });
    set({ st: DROP_STEPS[next], match: false, on: true });
  };
  const down = h('button.dc-nudge', { type: 'button', text: '‹', title: 'Less (←)', 'aria-label': 'Drop less' });
  const up = h('button.dc-nudge', { type: 'button', text: '›', title: 'More (→)', 'aria-label': 'Drop more' });
  down.onclick = () => nudge(-1);
  up.onclick = () => nudge(1);
  steps.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') (e.preventDefault(), nudge(1));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') (e.preventDefault(), nudge(-1));
  });
  const match = h('button.dc-pill.dc-match', { type: 'button', title: 'Follow each song’s tuning automatically' });
  match.onclick = () => (rig.drop.on && rig.drop.match ? set({ match: false, st: rig.dropAmount() || rig.drop.st, on: !!rig.dropAmount() }) : set({ match: true, on: true }));
  const hold = h('button.dc-pill.dc-hold', { type: 'button', text: 'Hold to drop', title: 'Momentary: the footswitch only drops while you hold it' });
  hold.onclick = () => set({ momentary: !rig.drop.momentary });
  // the footswitch: a click toggles; in momentary mode it drops only while held
  let held = false;
  let prior = false;
  const engage = () => {
    if (held || !rig.drop.momentary) return;
    held = true;
    prior = rig.drop.on;
    window.addEventListener('blur', release);
    set({ on: true });
  };
  const release = () => {
    if (!held) return;
    held = false;
    window.removeEventListener('blur', release);
    set({ on: prior });
  };
  foot.onclick = () => !rig.drop.momentary && set({ on: !rig.drop.on });
  foot.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !rig.drop.momentary) return;
    foot.setPointerCapture(e.pointerId);
    engage();
    e.preventDefault();
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) foot.addEventListener(t, release);
  // your instrument's own tuning
  const mine = h('select.input.dc-mine', { 'aria-label': `Your ${kind} is tuned to` });
  const fill = () => {
    mine.innerHTML = '';
    const cur = myTuning(kind).join(',');
    const opts = kind === 'bass' ? MY_TUNINGS_BASS : MY_TUNINGS;
    for (const o of opts) mine.append(h('option', { value: o.join(','), text: tuningName(o, kind), selected: o.join(',') === cur ? true : null }));
    if (!opts.some((o) => o.join(',') === cur)) mine.append(h('option', { value: cur, text: tuningName(myTuning(kind), kind), selected: true }));
  };
  fill();
  mine.onchange = () => {
    setMyTuning(kind, mine.value.split(',').map(Number));
    if (rig.songTuning) rig.setSongTuning(rig.songTuning, kind, rig.songCents || 0);
    if (onTuningChange) onTuningChange();
    update();
  };

  el.append(
    h('div.dc-head', null, h('span.dc-name', { text: 'Drop' }), led, h('span.grow'), foot),
    h('div.dc-lcd', { 'aria-live': 'polite' }, amtEl, h('div.dc-lcd-text', null, like, line, warn)),
    h('div.dc-rail', null, down, steps, up),
    h('div.dc-row', null, match, hold),
    ...extra,
    h('label.dc-mine-row', null, h('span', { text: `Your ${kind} is in` }), mine)
  );

  function set(patch) {
    rig.setDrop(patch);
    if (rig.drop.on) did('drop');
    update();
  }

  function update() {
    const d = rig.drop;
    const amt = d.on ? rig.dropAmount() : 0;
    const ds = rig.dropStatus();
    el.classList.toggle('on', !!d.on);
    el.classList.toggle('idle', ds.state === 'idle');
    el.classList.toggle('working', !!d.on && amt > 0);
    foot.setAttribute('aria-pressed', String(!!d.on));
    amtEl.textContent = !d.on ? 'OFF' : amt >= 12 ? 'OCT' : amt ? `−${amt}` : '0';
    like.textContent = d.on ? (amt ? `Sounds like ${soundsLike(amt, kind)}` : 'On, nothing to drop for this song') : `Your ${kind}: ${soundsLike(0, kind)}`;
    line.textContent = ds.line || '';
    warn.hidden = !(ds.state === 'on' && ds.warn);
    warn.textContent = ds.warn || '';
    for (const [i, b] of stepBtns.entries()) {
      const on = !!d.on && amt === DROP_STEPS[i];
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('auto', on && !!d.match);
    }
    const songSt = rig.dropSong;
    match.textContent = songSt ? `Match the song (−${songSt})` : 'Match the song';
    match.setAttribute('aria-pressed', String(!!d.on && !!d.match));
    hold.setAttribute('aria-pressed', String(!!d.momentary));
  }
  update();
  // follow changes made anywhere (the D key, the other console, a song asking for it)
  const onDrop = () => {
    if (!el.isConnected) {
      if (el._shown) rig.removeEventListener('drop', onDrop); // gone for good
      return;
    }
    el._shown = true;
    update();
  };
  rig.addEventListener('drop', onDrop);
  el.update = update;
  return el;
}
