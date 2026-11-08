/**
 * The speed control, the same in every view (highway, tab view, Now playing):
 * a chip that shows the speed and opens a small panel with a big readout,
 * − / + in 5% steps, quick picks and "Back to 100%". Also the repeat bar
 * ("Repeating Verse 2 → Chorus 3", its speed, Speed up each time, ✕).
 */
import { h, icon, esc, showMenu } from './ui.js';
import { PICKS, GOALS, MIN_SPEED, MAX_SPEED, clampSpeed, stepSpeed, pct, speedKind, speedWords } from './speed.js';

/** The chip's look: the speed, and a colour when slower (warm) or faster (cool) than 100%. */
export function paintSpeedChip(chip, s, { label = '' } = {}) {
  const kind = speedKind(s);
  const html = `${icon('clock')}${label ? `<span class="sp-chip-label">${esc(label)}</span>` : ''}<span class="sp-chip-val">${pct(s)}</span>`;
  if (chip.dataset.html !== html) {
    chip.innerHTML = html;
    chip.dataset.html = html;
  }
  chip.classList.add('speed-chip');
  chip.classList.toggle('slow', kind === 'slow');
  chip.classList.toggle('fast', kind === 'fast');
  chip.title = `Practice speed: ${pct(s)}${kind ? ` (${speedWords(s).toLowerCase()})` : ''}. [ and ] change it.`;
  chip.setAttribute('aria-label', chip.title);
}

/** [ slower, ] faster. Returns the new speed. */
export function nudgeSpeed(engine, dir) {
  engine.setSpeed(stepSpeed(engine.speed || 1, dir));
  return engine.speed;
}

const gaugeAt = (s) => `${((clampSpeed(s) - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 100}%`;

let open = null;
export function closeSpeedPopover() {
  if (open) open.close();
}

/** Opens the speed panel under (or above) `anchor`. Click the chip again, Esc or click away to close. */
export function openSpeedPopover(anchor, { engine, repeat = null, above = false } = {}) {
  if (open && open.anchor === anchor) return closeSpeedPopover();
  closeSpeedPopover();
  const words = h('small.sp-words');
  const val = h('b.sp-val');
  const down = h('button.sp-step', { type: 'button', title: 'Slower ( [ )', 'aria-label': 'Slower', html: icon('minus') });
  const up = h('button.sp-step', { type: 'button', title: 'Faster ( ] )', 'aria-label': 'Faster', html: icon('plus') });
  const fill = h('i.sp-fill');
  const knob = h('i.sp-knob');
  const gauge = h('div.sp-gauge', { title: 'Click to set the speed' }, h('i.sp-mark', { style: { left: gaugeAt(1) } }), fill, knob);
  const picks = h('div.sp-picks', { role: 'group', 'aria-label': 'Quick picks' });
  for (const p of PICKS) {
    const b = h('button', { type: 'button', text: String(Math.round(p * 100)), title: `${pct(p)}${p === 1 ? ' (full speed)' : ''}` });
    b.dataset.s = String(p);
    b.classList.add(speedKind(p) || 'full');
    b.onclick = () => engine.setSpeed(p);
    picks.append(b);
  }
  const reset = h('button.sp-reset', { type: 'button', html: `${icon('restore')}<span>Back to 100%</span>` });
  const note = h('div.sp-note', { hidden: true });
  const pop = h(
    'div.speed-pop',
    { role: 'dialog', 'aria-label': 'Practice speed' },
    h('div.sp-head', null, h('span', { text: 'Practice speed' }), words),
    h('div.sp-main', null, down, h('div.sp-read', null, val), up),
    gauge,
    picks,
    note,
    h('div.sp-foot', null, reset, h('span.sp-keys', { html: '<kbd>[</kbd> slower <kbd>]</kbd> faster' })),
  );
  down.onclick = () => nudgeSpeed(engine, -1);
  up.onclick = () => nudgeSpeed(engine, 1);
  reset.onclick = () => engine.setSpeed(1);
  gauge.onpointerdown = (e) => {
    const r = gauge.getBoundingClientRect();
    const at = (x) => {
      const f = Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width)));
      // snap to 5% steps, and stick to 100% when close
      let s = Math.round((MIN_SPEED + f * (MAX_SPEED - MIN_SPEED)) * 20) / 20;
      if (Math.abs(s - 1) < 0.026) s = 1;
      engine.setSpeed(s);
    };
    at(e.clientX);
    gauge.setPointerCapture(e.pointerId);
    gauge.onpointermove = (ev) => at(ev.clientX);
    gauge.onpointerup = () => (gauge.onpointermove = null);
  };

  function render() {
    const s = engine.speed || 1;
    const kind = speedKind(s);
    pop.classList.toggle('slow', kind === 'slow');
    pop.classList.toggle('fast', kind === 'fast');
    val.innerHTML = `${Math.round(s * 100)}<span>%</span>`;
    words.textContent = speedWords(s);
    down.disabled = s <= MIN_SPEED + 0.001;
    up.disabled = s >= MAX_SPEED - 0.001;
    reset.disabled = !kind;
    const a = gaugeAt(1);
    const b = gaugeAt(s);
    fill.style.left = s < 1 ? b : a;
    fill.style.right = `calc(100% - ${s < 1 ? a : b})`;
    knob.style.left = b;
    for (const btn of picks.children) btn.setAttribute('aria-pressed', String(Math.abs(Number(btn.dataset.s) - s) < 0.001));
    const rp = repeat && repeat.on;
    note.hidden = !rp;
    if (rp) note.textContent = repeat.speedBefore !== null && Math.abs(repeat.speedBefore - s) > 0.001 ? `For the repeat only. Back to ${pct(repeat.speedBefore)} when it stops.` : 'For the repeat only, while it repeats.';
  }
  render();
  document.body.append(pop);
  // place it under the chip (or above, for a chip at the bottom of the window), inside the window
  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - pr.width - 8, ar.left + ar.width / 2 - pr.width / 2));
  pop.style.left = `${left}px`;
  pop.style.top = `${above ? Math.max(8, ar.top - pr.height - 8) : Math.min(window.innerHeight - pr.height - 8, ar.bottom + 8)}px`;
  pop.style.setProperty('--arrow', `${Math.max(16, Math.min(pr.width - 16, ar.left + ar.width / 2 - left))}px`);
  pop.classList.toggle('above', above);
  anchor.setAttribute('aria-expanded', 'true');

  const onSpeed = () => render();
  const onDown = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      e.preventDefault();
      e.stopPropagation();
    }
  };
  engine.addEventListener('speed', onSpeed);
  if (repeat) repeat.addEventListener('change', onSpeed);
  setTimeout(() => document.addEventListener('pointerdown', onDown, true));
  window.addEventListener('keydown', onKey, true);
  function close() {
    engine.removeEventListener('speed', onSpeed);
    if (repeat) repeat.removeEventListener('change', onSpeed);
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    anchor.setAttribute('aria-expanded', 'false');
    pop.remove();
    if (open && open.pop === pop) open = null;
  }
  open = { anchor, pop, close };
  return open;
}

/**
 * The repeat bar: what repeats, its speed (− 75% +), Speed up each time (with
 * its goal and the pass you're on) and ✕. Hidden while nothing repeats.
 */
export function createRepeatBar(repeat, engine, { cls = '' } = {}) {
  const bar = h(`div.rep-bar${cls ? `.${cls}` : ''}`, { hidden: true, role: 'group', 'aria-label': 'Repeat' });
  const what = h('span.rep-what');
  const down = h('button.rep-step', { type: 'button', title: 'Slower ( [ )', 'aria-label': 'Slower', html: icon('minus') });
  const val = h('button.rep-val', { type: 'button', title: 'Speed for the repeat' });
  const up = h('button.rep-step', { type: 'button', title: 'Faster ( ] )', 'aria-label': 'Faster', html: icon('plus') });
  const speed = h('span.rep-speed', null, down, val, up);
  const train = h('button.rep-train', { type: 'button', title: 'Each time round, 5% faster, until the goal' });
  const goal = h('button.rep-goal', { type: 'button', title: 'How fast to go' });
  const pass = h('span.rep-pass');
  const prog = h('i.rep-prog');
  const x = h('button.rep-x', { type: 'button', title: 'Stop repeating (Esc)', 'aria-label': 'Stop repeating', html: icon('x') });
  bar.append(h('span.rep-icon', { html: icon('repeat') }), what, h('i.rep-sep'), speed, h('i.rep-sep'), train, goal, pass, x, prog);
  down.onclick = () => nudgeSpeed(engine, -1);
  up.onclick = () => nudgeSpeed(engine, 1);
  val.onclick = () => openSpeedPopover(val, { engine, repeat });
  train.onclick = () => repeat.setTrainer(!repeat.trainer.on);
  goal.onclick = () => {
    const r = goal.getBoundingClientRect();
    const g = repeat.trainer.goal;
    showMenu(r.left, r.bottom + 6, [{ heading: true, label: 'Speed up until' }, ...GOALS.map((v) => ({ label: v === 1 ? '100% (full speed)' : pct(v), icon: Math.abs(v - g) < 0.001 ? 'check' : null, onClick: () => repeat.setGoal(v) }))]);
  };
  x.onclick = () => repeat.stop();

  function render() {
    const loop = repeat.loop;
    bar.hidden = !loop;
    if (!loop) return;
    const s = engine.speed || 1;
    const kind = speedKind(s);
    const label = loop.label || 'a part';
    what.innerHTML = `<span class="rep-lead">Repeating</span> <b>${esc(label)}</b>`;
    what.title = `Repeating ${label}. Shift+click another section to stretch the repeat to it.`;
    val.textContent = pct(s);
    val.className = `rep-val${kind ? ` ${kind}` : ''}`;
    down.disabled = s <= MIN_SPEED + 0.001;
    up.disabled = s >= MAX_SPEED - 0.001;
    const tr = repeat.trainer;
    train.setAttribute('aria-pressed', String(tr.on));
    train.innerHTML = `<span class="rep-box">${tr.on ? icon('check') : ''}</span><span>Speed up each time</span>`;
    goal.hidden = !tr.on;
    goal.innerHTML = `<span>to ${pct(tr.goal)}</span>${icon('chevron')}`;
    pass.hidden = !tr.on;
    const atGoal = s >= tr.goal - 0.001;
    pass.textContent = tr.on ? (atGoal ? `Pass ${repeat.passes} · there` : `Pass ${repeat.passes}`) : '';
    pass.title = tr.on ? `Pass ${repeat.passes} at ${pct(s)}${atGoal ? ', at your goal' : `, next one at ${pct(Math.min(tr.goal, s + 0.05))}`}` : '';
    bar.classList.toggle('training', tr.on);
    const f = tr.on && tr.goal > tr.from ? Math.max(0, Math.min(1, (s - tr.from) / (tr.goal - tr.from))) : 0;
    prog.style.width = `${tr.on ? Math.max(4, f * 100) : 0}%`;
  }
  repeat.addEventListener('change', render);
  engine.addEventListener('speed', render);
  render();
  bar.render = render;
  return bar;
}
