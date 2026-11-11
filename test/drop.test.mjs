// 4.3: the Drop holds from one song to the next in the same tuning, says clearly what
// it's doing, and the "Retune for this song?" card stays out of the way when it covers it.
// Runs the real tuning.js, rig.js and tuning-check.js in Node, with a tiny stand-in page.
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem: (k) => delete store[k] };

// --- a tiny stand-in page: just enough for toasts and the tuning card to be built
class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.style = { setProperty() {} };
    this.dataset = {};
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    const cls = new Set();
    this.classList = { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) };
  }
  get parentElement() {
    return this._parent || (this._parent = new El('div'));
  }
  append(...c) {
    for (const x of c) if (x && typeof x === 'object') x._parent = this;
    this.children.push(...c);
  }
  before() {}
  remove() {}
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  focus() {}
}
globalThis.Node = El;
globalThis.window = globalThis;
if (!globalThis.addEventListener) globalThis.addEventListener = () => {};
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => Object.assign(new El('#text'), { textContent: t }), addEventListener() {}, body: new El('body'), querySelectorAll: () => [], getElementById: () => new El('div') };
globalThis.getComputedStyle = () => ({ zIndex: '0' });
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const t = await import('../src/renderer/js/tuning.js');
const { rig } = await import('../src/renderer/js/rig.js');
const { checkTuning } = await import('../src/renderer/js/tuning-check.js');

let bad = 0;
const ok = (c, msg) => {
  console.log(c ? 'ok  ' : 'FAIL', msg);
  if (!c) bad++;
};
const S = (k) => Array(6).fill(k);
const flat = (el) => [el.textContent || '', ...(el.children || []).map((c) => (c && typeof c === 'object' ? flat(c) : String(c)))].join(' ');
// the card, when it opens, is added to the page's overlays: count it via the toast/modal makers
let cards = 0;
let toasts = [];
const realGet = document.getElementById;
document.getElementById = (id) => {
  const el = realGet(id);
  if (id === 'overlays') {
    const app = el.append.bind(el);
    el.append = (...c) => {
      cards++;
      lastCard = c[0];
      app(...c);
    };
  }
  return el;
};
let lastCard = null;
const realAppend = document.body.append.bind(document.body);
document.body.append = (...c) => {
  realAppend(...c);
  for (const x of c) {
    const app = x.append.bind(x);
    x.append = (...y) => {
      toasts.push(y.map(flat).join(' ') + ' ' + y.map((e) => e.innerHTML || '').join(' '));
      app(...y);
    };
  }
};
const reset = () => {
  cards = 0;
  toasts = [];
};
const findButton = (el, re) => {
  if (!el || typeof el !== 'object') return null;
  if (el.tag === 'button' && re.test(el.textContent)) return el;
  for (const c of el.children || []) {
    const f = findButton(c, re);
    if (f) return f;
  }
  return null;
};
const song = (id, tuning, cents = 0) => ({ tab: { tuning, cents, type: 'lead' }, song: { id, title: id } });
const open = (s) => {
  rig.setSongTuning(s.tab.tuning, 'guitar', s.tab.cents);
  checkTuning(s.tab, s.song);
};

// --- the words
t.setMyTuning('guitar', S(0));
const off = t.dropStatus({ on: false, st: 1, match: false }, 0, { tuning: S(-1) });
ok(off.state === 'off' && off.line === 'Off' && off.warn === 'This song needs −1.', 'off: says "Off", and what the song needs');
const on1 = t.dropStatus({ on: true, st: 1, match: true }, 1, { tuning: S(-1) });
ok(on1.state === 'on' && on1.line === 'On: your guitar sounds 1 semitone lower (E♭ Standard)' && !on1.warn, `on: "${on1.line}"`);
const idle = t.dropStatus({ on: true, st: 1, match: true }, 0, { tuning: S(0) });
ok(idle.state === 'idle' && idle.line === 'On, but this song needs no drop', `on, doing nothing: "${idle.line}"`);
const idleR = t.dropStatus({ on: true, st: 1, match: true }, 0, { tuning: [-2, 0, 0, 0, 0, 0] });
ok(idleR.state === 'idle' && /needs retuning/.test(idleR.line), `on, song needs retuning: "${idleR.line}"`);
const wrong = t.dropStatus({ on: true, st: 2, match: false }, 2, { tuning: S(-1) });
ok(wrong.state === 'on' && wrong.warn === 'This song needs −1.', 'on at the wrong step: says what the song needs');
const oct = t.dropStatus({ on: true, st: 12, match: false }, 12, null);
ok(oct.line === 'On: your guitar sounds an octave lower', `an octave: "${oct.line}"`);
ok(t.dropStatus({ on: true, st: 2, match: false }, 2, null, 'guitar', [-2, 0, 0, 0, 0, 0]).line.endsWith('(Drop C)'), 'from Drop D, −2 sounds like Drop C');
ok(t.dropCovers({ on: true, st: 1, match: false }, t.tuningPlan(S(-1))) && t.dropCovers({ on: true, st: 3, match: true }, t.tuningPlan(S(-2))), 'the Drop covers a song on match, or on the step it needs');
ok(!t.dropCovers({ on: true, st: 2, match: false }, t.tuningPlan(S(-1))) && !t.dropCovers({ on: false, st: 1, match: true }, t.tuningPlan(S(-1))), '…not on another step, nor when off');

// --- song to song, the real rig and card
const A = song('A', S(-1));
const B = song('B', S(-1));
rig.setDrop({ on: false, st: 1, match: false });
reset();
open(A);
ok(cards === 1, 'E♭ song, Drop off: the card asks');
const useDrop = findButton(lastCard, /Use the Drop/);
ok(!!useDrop, 'the card offers the Drop');
useDrop.onclick();
ok(rig.drop.on && rig.dropAmount() === 1, 'Use the Drop: on, −1');
ok(rig.dropStatus().line === 'On: your guitar sounds 1 semitone lower (E♭ Standard)', 'and it says so');
reset();
open(B);
ok(cards === 0 && rig.drop.on && rig.dropAmount() === 1, 'next E♭ song: the Drop holds, no card');

// a fixed step that already does the song (the −1 button)
rig.setDrop({ on: true, st: 1, match: false });
reset();
open(song('C', S(-1)));
ok(cards === 0 && rig.dropAmount() === 1, 'Drop on −1 (not match), next E♭ song: no card, still −1');
// a fixed step that's wrong for the song: the card, and "I'm in" never drops twice
reset();
open(song('D', S(-2)));
ok(cards === 1, 'Drop on −1, a D Standard song: the card asks');
const imIn = findButton(lastCard, /I’m in/);
imIn.onclick();
ok(!rig.drop.on && rig.dropAmount() === 0, '"I’m in D Standard": the Drop goes off (no drop on top of retuning)');
ok(t.myTuning('guitar').join() === S(-2).join(), '…and your guitar is in D Standard now');
t.setMyTuning('guitar', S(0));

// a fixed step left on for a song in your own tuning: one note, not every time
rig.setDrop({ on: true, st: 1, match: false });
reset();
open(song('E', S(0)));
ok(cards === 0 && toasts.some((x) => /still on/.test(x)), 'Drop left on −1, an E Standard song: a note says so');
reset();
open(song('E', S(0)));
ok(toasts.length === 0, '…once per song');

// match on, song in your tuning: on, but plainly doing nothing
rig.setDrop({ on: true, match: true });
rig.setSongTuning(S(0), 'guitar', 0);
ok(rig.dropAmount() === 0 && rig.dropStatus().state === 'idle' && rig.dropStatus().line === 'On, but this song needs no drop', 'match on, E Standard song: "On, but this song needs no drop"');
rig.setSongTuning(S(-1), 'guitar', 0);
ok(rig.dropAmount() === 1, '…and back to −1 for the next E♭ song');
// the reference pitch comes from the song itself, not the last one
rig.setSongTuning(S(-1), 'guitar', -60);
rig.setSongTuning(S(-1), 'guitar', 0);
ok(rig.dropAmount() === 1, 'an A425 song, then an A440 E♭ song: the Drop is −1 again');

// the learning: playing with the Drop and then turning it off never "learns" the song's tuning
const src = (await import('node:fs')).readFileSync(new URL('../src/renderer/js/practice.js', import.meta.url), 'utf8');
ok(/!s\.drop && !rig\.dropAmount\(\) && s\.tuning\)/.test(src) && /practice\.session\.drop = st/.test(src), 'learning your tuning checks the Drop as it was while you played');
const hw = (await import('node:fs')).readFileSync(new URL('../src/renderer/js/highway.js', import.meta.url), 'utf8');
// 4.5: the highway and the Play page share one Drop console (dropui.js) with one "Match the song"
const dui = (await import('node:fs')).readFileSync(new URL('../src/renderer/js/dropui.js', import.meta.url), 'utf8');
ok((dui.match(/dc-pill\.dc-match/g) || []).length === 1 && /dropConsole\(/.test(hw) && !/hw-drop-match/.test(hw), 'the highway Drop box has one "Match the song" button');
ok(!/rig\.setSongTuning\(H\.tab\.tuning, instrument\(\)\);/.test(hw), 'the highway passes each song’s own reference pitch');

if (bad) process.exit(1);
console.log('all ok');
