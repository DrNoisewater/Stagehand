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
  // 4.2 (user: "too much, it needs to be simple and to the point like the one in Jam"): one
  // tuner up top, the same look as the main tuner, for whichever string you pluck; below it a
  // short list of the strings, each with what to do and a tick when it's done
  const bigNote = h('div.tn-note', { text: '–' });
  const needle = h('i.tn-needle');
  const reading = h('span.c', { text: rig.on ? 'Pluck any string' : '' });
  const gauge = h('div.tuner3.tcheck-tuner', null, h('div.tn-row', null, bigNote, h('div', { style: { flex: '1' } }, h('div.tn-scale', null, needle), h('div.tn-read', null, h('span', { text: '−50' }), reading, h('span', { text: '+50' })))));
  body.append(gauge);
  const rows = new Map();
  const list = h('div.tcheck-strings');
  // thin string at the top as you look down at the guitar
  for (const s of [...plan.strings].reverse()) {
    const ci = (kind === 'bass' ? s.string + 2 : s.string) - 1;
    const state = h('span.tcheck-state', { text: s.keep ? 'Stays' : howFar(s.semis) });
    const row = h(`div.tcheck-row${s.keep ? '.keep' : ''}`, { style: { '--sc': COLORS[ci] || '#9ab' } },
      h('span.tcheck-num', { text: String(s.num) }),
      h('span.tcheck-from', { text: s.from }),
      h('span.tcheck-arrow', { text: s.keep ? '=' : s.up ? '↑' : '↓' }),
      h('span.tcheck-to', { text: s.to }),
      state
    );
    rows.set(s.string, { row, state, s, smooth: null });
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
    clearTimeout(finishTimer);
    open = null;
    if (paused && !eng.playing) eng.play();
  } });
  m.el.classList.add('tcheck-modal');
  m.el.parentElement.classList.add('over-highway');
  open = m;

  // listen: which string, how close. A string only gets its tick when it is within 3 cents
  // (the main tuner's "in tune" is 1.5, "near" is 6), held steady for 0.7 s, judged on the
  // settled note and not the pick attack. A ticked string played again and out by more than
  // 5 cents loses its tick.
  const TUNED = 3; // cents
  const KEEP = 4; // stays "holding" up to here, so a wobble at the edge doesn't restart the count
  const SLIPPED = 5;
  const SETTLE = 250; // ms of each new note ignored: the attack is sharp
  const HOLD = 700; // ms steady
  let raf = 0;
  let hold = null; // { string, at }
  let note = null; // the note being played: { string, since, last, raw: [] }
  let slip = null; // a ticked string that sounds out: { string, at }
  let finished = false;
  let finishTimer = 0;
  const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const resetLive = () => {
    hold = null;
    slip = null;
    note = null;
  };
  const say = (off) => {
    const a = Math.abs(off);
    reading.textContent = a <= TUNED ? 'In tune' : `${off > 0 ? '+' : '−'}${Math.round(a)} cents`;
    reading.className = `c${a <= TUNED ? ' ok' : ''}`;
  };
  const rest = () => {
    for (const r of rows.values()) r.row.classList.remove('now');
    bigNote.textContent = '–';
    bigNote.className = 'tn-note';
    needle.classList.remove('ok');
    needle.style.left = '50%';
    reading.textContent = 'Pluck any string';
    reading.className = 'c';
  };
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!rig.on || finished) return;
    const now = performance.now();
    const p = rig.pitch && rig.pitch();
    if (!p || !(p.clarity > 0.85)) {
      // silence: the needle rests, the next pluck is a new note
      if (note && now - note.last > 250) {
        rest();
        resetLive();
      }
      return;
    }
    const w = whichString(p.midi * 100 + p.cents, plan.strings);
    if (!w) return;
    const r = rows.get(w.string.string);
    const off = w.off;
    // a new pluck: a different string, or a jump in pitch (silence in between is handled above)
    if (!note || note.string !== w.string.string || Math.abs(off - note.raw[note.raw.length - 1]) > 40) {
      note = { string: w.string.string, since: now, last: now, raw: [] };
      hold = null;
      slip = null;
    }
    note.last = now;
    note.raw.push(off);
    if (note.raw.length > 5) note.raw.shift();
    for (const x of rows.values()) x.row.classList.toggle('now', x === r);
    // the needle is smooth; the judging uses the middle of the last few readings
    r.smooth = r.smooth == null || now - note.since < 60 ? off : r.smooth + (off - r.smooth) * 0.35;
    const shown = Math.max(-50, Math.min(50, r.smooth));
    const a = Math.abs(r.smooth);
    needle.style.left = `${50 + shown}%`;
    needle.classList.toggle('ok', a <= TUNED);
    bigNote.textContent = r.s.to;
    bigNote.className = `tn-note${a <= TUNED ? ' ok' : a < 6 ? ' near' : ''}`;
    say(r.smooth);
    const settled = now - note.since >= SETTLE && note.raw.length >= 3;
    const j = median(note.raw);
    const wasDone = done.has(w.string.string);
    const dir = j < 0 ? 'Up' : 'Down';
    if (!settled) {
      if (!wasDone) r.state.textContent = 'Listening…';
      return;
    }
    if (wasDone) {
      // ticked before: is it still right?
      if (Math.abs(j) > SLIPPED) {
        if (!slip) slip = { at: now };
        else if (now - slip.at > 300) {
          done.delete(w.string.string);
          r.row.classList.remove('done');
          r.slipped = true;
          r.state.textContent = `Slipped out: ${dir.toLowerCase()} ${Math.round(Math.abs(j))} cents`;
          live.textContent = `String ${r.s.num} is out of tune again.`;
          clearTimeout(finishTimer);
          hold = null;
          slip = null;
        }
      } else slip = null;
      return;
    }
    if (Math.abs(j) <= (hold && hold.string === w.string.string ? KEEP : TUNED)) {
      if (!hold || hold.string !== w.string.string) hold = { string: w.string.string, at: now };
      const held = now - hold.at;
      if (held < HOLD) {
        r.state.textContent = 'Hold it…';
        return;
      }
      done.add(w.string.string);
      r.slipped = false;
      r.row.classList.add('done');
      r.state.textContent = '✓ In tune';
      live.textContent = rig.on ? 'Pluck the next string.' : live.textContent;
      if (changing.length && changing.every((s) => done.has(s.string))) {
        finished = true;
        live.textContent = `All tuned: ${songName}.`;
        finishTimer = setTimeout(() => open === m && finish(`Tuned to ${songName}`), 900);
      }
    } else {
      hold = null;
      const a = Math.abs(j);
      const way = a < 100 ? `${dir} a little (${Math.round(a)} cents)` : `${dir} ${howFar(a / 100).replace(/ (up|down)/, '')}`;
      r.state.textContent = r.slipped ? `Slipped out: ${way.toLowerCase()}` : way;
    }
  };
  raf = requestAnimationFrame(tick);
}

/** The card again on request (the highway's tuning panel), even when it was skipped. */
export function tuningGuide(tab, song, engine = null) {
  checkTuning(tab, song, { force: true, engine });
}
