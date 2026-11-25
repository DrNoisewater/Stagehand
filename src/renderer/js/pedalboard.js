/**
 * The pedal board in Create tone (4.1.9): add, remove, move and tweak pedals, heard live.
 * Pedals sit before the amp or after it (the effects loop); moving one past the amp
 * moves it to the other side. Also the noise gate switch (Auto / Strong / Off).
 *
 * User: "Can I add pedals to my Create tone?"
 */
import { h, icon } from './ui.js';
import { rig } from './rig.js';
import { pedalArt, ampArt } from './gearart.js';
import { PEDALS, pedalFor, newPedal, pedalKnob, movePedal } from './tonerecipes.js';
import { aboutCard, linkSheet } from './gearabout.js';
import { rotaryKnob, gearFaceplate, gearKnob, labStrip } from './rigui.js';
import { knobsOf } from './tonelib.js';
import { gearInfo } from './gearspec.js';
import { LAB_SECTIONS } from './gearbench.js';
import { loopChip, loopFace } from './loopui.js';
import { LOOP_KEY } from './loopswitch.js';

const GROUPS = [
  ['util', 'Switching'],
  ['drive', 'Drive, distortion and fuzz'],
  ['dynamics', 'Gate and compressor'],
  ['filter', 'Wah, filters and EQ'],
  ['mod', 'Chorus, flanger, phaser, tremolo'],
  ['time', 'Echo and reverb'],
  ['wacky', 'The Lab'],
];

const fmtKnob = (min, max) => (v) => (max - min > 20 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1));

/**
 * board: the pedals in order ({key, where, knobs, off}). onChange(board, {redraw}) is called on
 * every change; with redraw false (a knob turning) the board isn't rebuilt, so the drag goes on.
 */
// 4.22: which pedals have their "What does what?" open (kept while the board redraws)
const OPEN_ABOUT = {};

export function pedalBoard({ kind, board, ampKey, onChange, loops = {}, onLoops = () => {} }) {
  const el = h('div.pb');
  let adding = false;
  const set = (b, redraw = true) => {
    board = b;
    onChange(board, { redraw });
    if (redraw) draw();
  };
  function card(p, i) {
    const info = pedalFor(kind, p.key);
    const c = h(`div.pb-pedal${p.off ? '.off' : ''}`, { 'data-key': p.key });
    const led = h('button.pb-led', { type: 'button', title: p.off ? 'Turn this pedal on' : 'Turn this pedal off', 'aria-label': p.off ? `Turn ${info.name} on` : `Turn ${info.name} off`, 'aria-pressed': String(!p.off) });
    led.onclick = () => set(board.map((x, j) => (j === i ? { ...x, off: !x.off } : x)));
    const left = h('button.pb-move', { type: 'button', text: '‹', title: 'Move left (earlier in the chain)', 'aria-label': `Move ${info.name} left` });
    const right = h('button.pb-move', { type: 'button', text: '›', title: 'Move right (later in the chain)', 'aria-label': `Move ${info.name} right` });
    const del = h('button.pb-move.pb-del', { type: 'button', html: icon('x'), title: 'Take this pedal off', 'aria-label': `Remove ${info.name}` });
    left.onclick = () => set(movePedal(board, i, -1));
    right.onclick = () => set(movePedal(board, i, +1));
    del.onclick = () => set(board.filter((_, j) => j !== i));
    const knobs = h('div.pb-knobs');
    let about = '';
    if (p.key === LOOP_KEY) {
      knobs.append(loopFace()); // 4.35: the A/B box: a footswitch and two lights
    } else if (info.group === 'wacky') {
      // 4.20: The Lab's pedals: every control with its own units, switch names and footswitches
      for (const k of knobsOf({ key: p.key, knobs: p.knobs })) {
        knobs.append(gearKnob(k, { gel: 'var(--tungsten)', onInput: (v) => { p.knobs = { ...p.knobs, [k.name]: v }; set(board, false); } }));
      }
      knobs.append(...labStrip({ key: p.key }));
      // 4.22: what it does and what every control does, folded away under the knobs
      const sheet = aboutCard({ key: p.key, t: 'pedal', name: info.name }, p.key);
      linkSheet(knobs, sheet);
      const more = h('details.pb-about', null, h('summary', { text: 'What does what?' }), sheet);
      more.open = !!OPEN_ABOUT[p.key];
      more.addEventListener('toggle', () => (OPEN_ABOUT[p.key] = more.open));
      about = more;
    } else
    for (const [name, label] of info.knobs) {
      const spec = pedalKnob(p.key, name);
      if (!spec) continue;
      const [, , min, max, def] = spec;
      const cur = Object.entries(p.knobs || {}).find(([k]) => k.toLowerCase() === name.toLowerCase());
      const value = cur ? Number(cur[1]) : def;
      knobs.append(
        rotaryKnob({
          name: label,
          min,
          max,
          value,
          def: info.start[name] ?? def,
          fmt: fmtKnob(min, max),
          step: max - min > 20 ? 1 : (max - min) / 100,
          gel: 'var(--tungsten)',
          onInput: (v) => {
            p.knobs = { ...p.knobs, [name]: v };
            set(board, false);
          },
        })
      );
    }
    const faceplate = p.key === LOOP_KEY ? null : gearFaceplate(p.key, knobs, { bypass: { on: () => !p.off, toggle: () => led.onclick() } });
    // 4.35: with a Loop switcher on the board, each pedal says which loop it is in
    const loopBar = p.key !== LOOP_KEY && board.some((x) => x.key === LOOP_KEY) ? loopChip({ value: p.loop, name: info.name, onPick: (v) => set(board.map((x, j) => (j === i ? { ...x, loop: v || undefined } : x))) }) : null;
    c.append(
      h('div.pb-top', null, h('div.pb-art', { html: pedalArt(p.key) }), h('div.pb-name', null, h('b', { text: info.name }), h('span', { text: info.what }))),
      faceplate,
      knobs,
      loopBar,
      about,
      h('div.pb-tools', null, led, h('span.grow'), left, right, del)
    );
    return c;
  }
  function draw() {
    el.innerHTML = '';
    const chain = h('div.pb-chain', { 'aria-label': 'Your pedal board, in the order the sound goes through it' });
    const pre = board.map((p, i) => [p, i]).filter(([p]) => p.where !== 'post');
    const post = board.map((p, i) => [p, i]).filter(([p]) => p.where === 'post');
    chain.append(h('div.pb-end', { text: kind === 'bass' ? 'Your bass' : 'Your guitar' }));
    for (const [p, i] of pre) chain.append(card(p, i));
    const switched = board.some((x) => x.key === LOOP_KEY);
    chain.append(
      h(
        'div.pb-amp',
        { title: 'The amp' },
        h('div.pb-amp-art', { html: ampArt(ampKey) }),
        h('small', { text: 'Amp' }),
        switched ? loopChip({ value: loops.amp, name: 'the amp', onPick: (v) => { loops = { ...loops, amp: v || undefined }; onLoops(loops); draw(); } }) : null,
        switched ? h('small', { text: 'Cabinet' }) : null,
        switched ? loopChip({ value: loops.cab, name: 'the cabinet', onPick: (v) => { loops = { ...loops, cab: v || undefined }; onLoops(loops); draw(); } }) : null
      )
    );
    for (const [p, i] of post) chain.append(card(p, i));
    const add = h('button.pb-add', { type: 'button', html: `${icon('plus')}<span>Add a pedal</span>`, 'aria-expanded': String(adding) });
    add.onclick = () => {
      adding = !adding;
      draw();
    };
    chain.append(add);
    el.append(chain);
    if (!board.length) el.append(h('p.fine', { text: 'No pedals yet. Add one: a tube drive in front of a big amp is how most metal and lead sounds are made.' }));
    if (adding) {
      const pick = h('div.pb-pick');
      for (const [g, title] of GROUPS) {
        const all = PEDALS[kind].filter((p) => p.group === g);
        if (!all.length) continue;
        pick.append(h('h5', { text: title }));
        // 4.20: The Lab in its little sections of similar pedals
        const parts = g === 'wacky' ? LAB_SECTIONS.map((c) => [c.label, all.filter((p) => gearInfo(p.key)?.sec === c.id)]).filter(([, l]) => l.length) : [['', all]];
        for (const [sub, list] of parts) {
        if (sub) pick.append(h('h6.pb-sub', { text: sub }));
        const row = h('div.pb-pick-row');
        for (const p of list) {
          const b = h('button.pb-choice', { type: 'button', 'data-key': p.key }, h('div.pb-art', { html: pedalArt(p.key) }), h('b', { text: p.name }), h('span', { text: p.what }), h('small', { text: p.where === 'post' ? 'after the amp' : 'before the amp' }));
          b.onclick = () => {
            adding = false;
            const np = newPedal(kind, p.key);
            // before the amp: at the end of the pedals in front; after it: at the end
            if (np.where === 'pre') {
              const last = board.reduce((n, x, j) => (x.where !== 'post' ? j + 1 : n), 0);
              set([...board.slice(0, last), np, ...board.slice(last)]);
            } else set([...board, np]);
          };
          row.append(b);
        }
        pick.append(row);
        }
      }
      el.append(pick);
    }
  }
  draw();
  return el;
}

const GATE_TEXT = {
  auto: 'Listens to your guitar between notes and stays just above its hum and hiss',
  strong: 'Quieter still, for high gain and tight stops (very soft notes fade sooner)',
  off: 'No gate: everything you play, and all the noise, comes through',
};

/** Noise gate: Auto / Strong / Off, for every tone you play (yours, the song’s, imported ones). */
export function gateControl({ compact = false } = {}) {
  const el = h(`div.gate-ctl${compact ? '.compact' : ''}`);
  const draw = () => {
    el.innerHTML = '';
    const seg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Noise gate' });
    for (const [id, name] of [['auto', 'Auto'], ['strong', 'Strong'], ['off', 'Off']]) {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(rig.gate === id), 'aria-pressed': String(rig.gate === id), text: name, title: GATE_TEXT[id] });
      b.onclick = () => {
        rig.setGate(id);
        draw();
      };
      seg.append(b);
    }
    el.append(h('span.gate-name', { text: 'Noise gate' }), seg);
    if (!compact) el.append(h('span.gate-what', { text: GATE_TEXT[rig.gate] || '' }));
  };
  draw();
  return el;
}
