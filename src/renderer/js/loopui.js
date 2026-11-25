/**
 * The Loop switcher on screen: the small "Both · A · B" chip that puts a piece of gear in a loop,
 * and the switcher's own face (a big footswitch and two lights, A and B). See loopswitch.js.
 */
import { h } from './ui.js';
import { rig } from './rig.js';

const CHOICES = [['', 'Both', 'Shared: always plays'], ['A', 'A', 'Only plays in loop A'], ['B', 'B', 'Only plays in loop B']];

/** Both / A / B for one piece of gear. value: '', 'A' or 'B'. onPick(value) makes the edit. */
export function loopChip({ value = '', name = 'this', onPick }) {
  const seg = h('div.seg.loop-chip', { role: 'radiogroup', 'aria-label': `Which loop ${name} is in` });
  for (const [v, text, tip] of CHOICES) {
    const on = (value || '') === v;
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-pressed': String(on), 'data-loop': v || 'both', text, title: tip });
    b.onclick = () => {
      if (on) return;
      onPick(v);
    };
    seg.append(b);
  }
  return h('div.loop-bar', null, h('span.loop-lbl', { text: 'Loop' }), seg);
}

/** The switcher's face: a big footswitch that flips A/B at once, and a light for the loop playing. */
export function loopFace() {
  const led = (id) => h(`div.loop-led-wrap`, null, h('span.loop-led', { 'data-led': id }), h('b', { text: id }));
  const a = led('A');
  const b = led('B');
  const stomp = h('button.loop-stomp', { type: 'button', 'aria-label': 'Loop switcher footswitch: jump to the other loop', title: 'Stomp to jump to the other loop' });
  const side = () => (rig.hasLoopSwitch() ? rig.loopSide() : 'A');
  const paint = () => {
    const s = side();
    a.firstChild.classList.toggle('lit', s === 'A');
    b.firstChild.classList.toggle('lit', s === 'B');
    stomp.setAttribute('data-side', s);
    stomp.setAttribute('aria-label', `Loop switcher: loop ${s} is playing. Stomp to jump to loop ${s === 'A' ? 'B' : 'A'}.`);
  };
  stomp.onclick = () => {
    rig.toggleLoop();
    paint();
  };
  const el = h('div.loop-face', null, h('div.loop-leds', null, a, b), stomp, h('small', { text: 'Stomp to jump between loops' }));
  const on = () => (el.isConnected ? paint() : rig.removeEventListener('loop', on)); // gone from the page: stop listening
  rig.addEventListener('loop', on);
  rig.addEventListener('change', on);
  paint();
  return el;
}
