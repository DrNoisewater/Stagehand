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
import { rotaryKnob, gearFaceplate } from './rigui.js';

const GROUPS = [
  ['drive', 'Drive, distortion and fuzz'],
  ['dynamics', 'Gate and compressor'],
  ['filter', 'Wah, filters and EQ'],
  ['mod', 'Chorus, flanger, phaser, tremolo'],
  ['time', 'Echo and reverb'],
];

const fmtKnob = (min, max) => (v) => (max - min > 20 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1));

/**
 * board: the pedals in order ({key, where, knobs, off}). onChange(board, {redraw}) is called on
 * every change; with redraw false (a knob turning) the board isn't rebuilt, so the drag goes on.
 */
export function pedalBoard({ kind, board, ampKey, onChange }) {
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
    const faceplate = gearFaceplate(p.key, knobs);
    c.append(
      h('div.pb-top', null, h('div.pb-art', { html: pedalArt(p.key) }), h('div.pb-name', null, h('b', { text: info.name }), h('span', { text: info.what }))),
      faceplate,
      knobs,
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
    chain.append(h('div.pb-amp', { title: 'The amp' }, h('div.pb-amp-art', { html: ampArt(ampKey) }), h('small', { text: 'Amp' })));
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
        const list = PEDALS[kind].filter((p) => p.group === g);
        if (!list.length) continue;
        pick.append(h('h5', { text: title }));
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
