/**
 * The tuning check (4.0.6). When a song needs a different tuning from the one your
 * guitar or bass is in (what you last tuned to, or the last song's), a card says so
 * before you play, with every string: what it is now, what it needs, which way and
 * how far, and the reference pitch when the song isn't at A440 (A425…).
 *
 * Pluck any string and it finds which one it is and shows how close you are; a
 * string held in tune for a moment gets a tick, and when every string that needs
 * changing has one, that's your tuning now and the card closes by itself.
 *
 * Or: Skip (keep going as you are; not asked again for this song this session),
 * the Drop (when the song is the same tuning, just lower), or "I'm already in it".
 */
import { h, modal, toast } from './ui.js';
import { rig } from './rig.js';
import { tuningPlan, tuningName, myTuning, myCents, myTuningFrom, setMyTuning, refLabel, howFar, whichString, dropAlways, setDropAlways } from './tuning.js';

const COLORS = ['#ff4b55', '#ffcf3a', '#3da5ff', '#ff9a3c', '#45d07c', '#b67dff'];
const skipped = new Set(); // songs × tunings you said "keep going" to, this session
let open = null;

const fullName = (offs, cents, kind) => `${tuningName(offs, kind)}${refLabel(cents) ? ` ${refLabel(cents)}` : ''}`;

/**
 * Check a song's part before playing it. tab: { tuning, cents, type }; song: { id, title };
 * engine: the player (paused while the card is up).
 * Shows the card when needed; returns quickly either way.
 */
export function checkTuning(tab, song, { force = false, engine = null } = {}) {
  if (!tab) return;
  const kind = tab.type === 'bass' ? 'bass' : 'guitar';
  const mine = myTuning(kind);
  const mc = myCents(kind);
  const sc = Number(tab.cents) || 0;
  const plan = tuningPlan(tab.tuning, kind, mine, sc, mc);
  if (plan.same) {
    if (force) toast({ title: `Your ${kind} is ready`, message: `${fullName(tab.tuning, sc, kind)}, the same as this song.`, kind: 'ok', timeout: 2500 });
    return;
  }
  const key = `${song && song.id}|${kind}|${(tab.tuning || []).join(',')}|${sc}|${mine.join(',')}|${mc}`;
  const songName = fullName(tab.tuning, sc, kind);
  const myName = fullName(mine, mc, kind);
  const what = kind === 'bass' ? 'bass' : 'guitar';
  // the Drop can do it and you said always: no card
  if (!force && plan.drop && dropAlways()) {
    if (!(rig.drop.on && rig.drop.match)) rig.setDrop({ on: true, match: true });
    toast({ title: `Drop −${plan.drop} for ${songName}`, message: `Your ${what} stays in ${myName}.`, kind: 'info', timeout: 2500 });
    return;
  }
  if (!force && plan.drop && rig.drop.on && rig.drop.match) return; // already covered by the Drop
  if (!force && skipped.has(key)) return;
  if (open) open.close();
  show({ tab, song, kind, plan, key, songName, myName, what, sc, engine });
}

function show({ tab, song, kind, plan, key, songName, myName, what, sc, engine }) {
  const from = myTuningFrom(kind);
  const eng = engine; // the player: paused while you tune, played again after
  const paused = eng && eng.playing;
  if (paused) eng.pause();
  const done = new Set();
  const body = h('div.tcheck');
  const intro = h('p.tcheck-intro');
  intro.innerHTML = '';
  intro.append(
    h('span', { text: `This song is in ` }),
    h('b', { text: songName }),
    h('span', { text: `. Your ${what} is probably still in ` }),
    h('b', { text: myName }),
    h('span', { text: from ? ` (from ${from}).` : '.' })
  );
  body.append(intro);
  if (plan.ref) body.append(h('p.tcheck-ref', { text: `Tune to ${plan.ref === 'A440' ? 'A = 440 Hz (standard pitch)' : `A = ${plan.ref.slice(1)} Hz`}: ${plan.ref === 'A440' ? 'back to normal' : 'slightly off standard pitch'}, so every string moves a little.` }));
  // the strings, thin one at the top as you look down at the guitar
  const rows = new Map();
  const list = h('div.tcheck-strings');
  for (const s of [...plan.strings].reverse()) {
    const ci = (kind === 'bass' ? s.string + 2 : s.string) - 1;
    const meter = h('div.tcheck-meter', null, h('i.tcheck-needle'));
    const state = h('span.tcheck-state', { text: s.keep ? 'Stays' : howFar(s.semis) });
    const row = h(`div.tcheck-row${s.keep ? '.keep' : ''}`, { style: { '--sc': COLORS[ci] || '#9ab' } },
      h('span.tcheck-num', { text: String(s.num) }),
      h('span.tcheck-from', { text: s.from }),
      h('span.tcheck-arrow', { text: s.keep ? '=' : s.up ? '↑' : '↓' }),
      h('span.tcheck-to', { text: s.to }),
      state,
      meter
    );
    rows.set(s.string, { row, state, meter, s });
    list.append(row);
  }
  body.append(list);
  const live = h('p.tcheck-live', { text: rig.on ? 'Pluck a string, any order: it shows which one and how close you are.' : `Connect your ${what} to tune here, or tune with your own tuner.` });
  body.append(live);

  const changing = plan.strings.filter((s) => !s.keep);
  const finish = (msg) => {
    setMyTuning(kind, tab.tuning, sc, song && song.title);
    rig.setSongTuning(tab.tuning, kind, sc);
    if (rig.drop.on && rig.drop.match) rig.setDrop({ on: false });
    m.close();
    toast({ title: msg || `Your ${what}: ${songName}`, kind: 'ok', timeout: 2200 });
  };
  const btnDone = h('button.btn.primary', { type: 'button', text: `I’m in ${songName}` });
  btnDone.onclick = () => finish();
  const btnSkip = h('button.btn.ghost', { type: 'button', text: 'Skip, keep going', title: `Play as you are, in ${myName}` });
  btnSkip.onclick = () => {
    skipped.add(key);
    m.close();
  };
  const foot = [btnSkip];
  if (plan.drop) {
    const btnDrop = h('button.btn', { type: 'button', text: `Use the Drop (−${plan.drop})`, title: `Stagehand lowers your ${what} ${plan.drop} semitone${plan.drop === 1 ? '' : 's'}: no retuning` });
    btnDrop.onclick = () => {
      rig.setDrop({ on: true, match: true });
      if (always.checked) setDropAlways(true);
      m.close();
      toast({ title: `Drop −${plan.drop} for ${songName}`, message: `Your ${what} stays in ${myName}.`, kind: 'info', timeout: 2500 });
    };
    const always = h('input', { type: 'checkbox' });
    body.append(h('label.tcheck-always', null, always, h('span', { text: 'Always use the Drop when a song is the same tuning, just lower' })));
    foot.push(btnDrop);
  }
  foot.push(btnDone);

  const m = modal({ title: `Retune for ${song ? song.title : 'this song'}?`, body, footer: foot, onClose: () => {
    cancelAnimationFrame(raf);
    open = null;
    if (paused && !eng.playing) eng.play();
  } });
  m.el.classList.add('tcheck-modal');
  m.el.parentElement.classList.add('over-highway');
  open = m;

  // listen: which string, how close; ticks when held in tune
  let raf = 0;
  let hold = null;
  let finished = false;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!rig.on || finished) return;
    const p = rig.pitch && rig.pitch();
    for (const r of rows.values()) r.row.classList.remove('now');
    if (!p || !(p.clarity > 0.85)) {
      hold = null;
      return;
    }
    const w = whichString(p.midi * 100 + p.cents, plan.strings);
    if (!w) return;
    const r = rows.get(w.string.string);
    r.row.classList.add('now');
    const off = w.off;
    r.meter.style.setProperty('--off', String(Math.max(-1, Math.min(1, off / 50))));
    if (done.has(w.string.string)) return;
    if (Math.abs(off) <= 6) {
      r.state.textContent = 'In tune';
      if (!hold || hold.string !== w.string.string) hold = { string: w.string.string, at: performance.now() };
      else if (performance.now() - hold.at > 450) {
        done.add(w.string.string);
        r.row.classList.add('done');
        r.state.textContent = '✓ In tune';
        if (changing.length && changing.every((s) => done.has(s.string))) {
          finished = true;
          live.textContent = `All tuned: ${songName}.`;
          setTimeout(() => open === m && finish(`Tuned to ${songName}`), 900);
        }
      }
    } else {
      hold = null;
      r.state.textContent = Math.abs(off) < 100 ? `${off < 0 ? 'Up' : 'Down'} a little (${Math.round(Math.abs(off))} cents)` : `${off < 0 ? 'Up' : 'Down'} ${howFar(Math.abs(off) / 100).replace(/ (up|down)/, '')}`;
    }
  };
  raf = requestAnimationFrame(tick);
}

/** The card again on request (the highway's tuning panel), even when it was skipped. */
export function tuningGuide(tab, song, engine = null) {
  checkTuning(tab, song, { force: true, engine });
}
