/**
 * Your tone slots as two rows of ten: "Keys" (1 2 3 … 9 0) and "Shift +" (the same ten keys with
 * Shift held). Slot 1 is the song's own tone. Used by Jam, the highway's tone menu and the Now panel.
 * Empty slots are small and quiet. When the whole Shift row is empty it folds into one slim line.
 */
import { h, icon } from './ui.js';
import { bySlot, byId, SLOT_GELS, SLOT_COUNT, slotKey, slotKeyWords, gelOf, kindLabel } from './tonelib.js';

const SHIFT_KEY = 'stagehand.slotsShift';
const shiftOpen = () => {
  try {
    return localStorage.getItem(SHIFT_KEY) === '1';
  } catch (_) {
    return false;
  }
};
const setShiftOpen = (on) => {
  try {
    localStorage.setItem(SHIFT_KEY, on ? '1' : '0');
  } catch (_) {}
};

/**
 * @param {object} o
 * @param {number|null} o.active the slot playing now
 * @param {boolean} [o.live] show the little level bars on the playing slot
 * @param {boolean} [o.names=true] show tone names (false: just the keys)
 * @param {number} [o.cols=10] slots per line
 * @param {{name:string, sub?:string, tip?:string}} [o.song] how slot 1 reads
 * @param {(n:number, tone:object|null)=>void} [o.onPick] a click (empty slots too, unless emptyPick is false)
 * @param {boolean} [o.emptyPick=true] empty slots can be clicked
 * @param {(e:MouseEvent, n:number, tone:object|null)=>void} [o.onContext] right click
 * @param {(n:number, tone:object|null)=>string} [o.tip] the hover text
 * @param {boolean} [o.cards=false] roomier slots (Jam page): key, kind and name
 */
export function slotGrid(o = {}) {
  const { names = true, cols = 10, emptyPick = true, cards = false } = o;
  const root = h(`div.sg${cards ? '.sg-cards' : ''}${cols < 10 ? '.sg-top' : ''}${names ? '' : '.sg-bare'}`, { role: 'group', 'aria-label': 'Tone slots', style: { '--sg-cols': String(cols) } });

  const cell = (n) => {
    const t = bySlot(n);
    const gel = n === 1 ? SLOT_GELS[0] : t ? gelOf(t) : SLOT_GELS[n - 1];
    const on = o.active === n;
    const empty = n > 1 && !t;
    const tip = o.tip ? o.tip(n, t) : n === 1 ? (o.song && o.song.tip) || 'Follows the song’s own tones' : t ? `${t.name} (key ${slotKeyWords(n)})` : `Empty: key ${slotKeyWords(n)}`;
    const clickable = n === 1 || t || emptyPick;
    const b = h(`button.sg-slot${on ? '.on.lit' : ''}${empty ? '.vacant' : ''}${n === 1 ? '.song' : ''}${n > 10 ? '.shift' : ''}`, { type: 'button', 'data-slot': String(n), style: { '--gel': empty ? '#2c3552' : gel }, title: tip, 'aria-pressed': String(on) });
    if (!clickable) b.setAttribute('aria-disabled', 'true');
    b.append(h('span.sg-k', { text: slotKey(n) }));
    if (!empty && names) {
      const name = n === 1 ? (o.song && o.song.name) || 'Song tone' : t.name;
      const main = h('span.sg-t', null, h('span.sg-name', { text: name }));
      if (cards) {
        if (on && o.live) main.append(h('span.eq', { style: { '--gel': gel } }, h('i'), h('i'), h('i')));
        else main.append(h('span.sg-sub', { text: n === 1 ? (o.song && o.song.sub) || 'Auto' : kindLabel(t) }));
      }
      b.append(main);
    }
    if (clickable && o.onPick) b.onclick = () => o.onPick(n, t);
    if (o.onContext) b.oncontextmenu = (e) => (e.preventDefault(), o.onContext(e, n, t));
    return b;
  };

  const group = (label, from, extra) => {
    const row = h('div.sg-row');
    for (let n = from; n < from + 10 && n <= SLOT_COUNT; n++) row.append(cell(n));
    return h('div.sg-group', null, extra || h('span.sg-label', { text: label }), row);
  };

  function fill() {
    root.innerHTML = '';
    root.append(group('Keys', 1));
    const filled = [...Array(10)].some((_, i) => bySlot(11 + i));
    if (filled || shiftOpen()) {
      let label = h('span.sg-label', { text: 'Shift +' });
      if (!filled) {
        label = h('button.sg-label.sg-fold', { type: 'button', title: 'Fold the Shift row away', text: 'Shift +' });
        label.onclick = () => (setShiftOpen(false), fill());
      }
      root.append(group('Shift +', 11, label));
    } else {
      const more = h('button.sg-more', { type: 'button', title: 'Hold Shift and press a key to use these', html: `${icon('plus')}<span>Shift + key: 10 more slots</span>` });
      more.onclick = () => (setShiftOpen(true), fill());
      root.append(more);
    }
  }
  fill();
  return root;
}

/** The slot playing now (1 = the song's own tone) or null. */
export function playingSlot(rig) {
  return rig.autoSong ? 1 : rig.mode === 'preset' ? (byId(rig.toneId) || {}).slot || null : null;
}

/** Is any Shift slot (11–20) holding a tone? */
export const shiftHasTones = () => [...Array(10)].some((_, i) => bySlot(11 + i));

/**
 * For pages that draw their own slot cards (Tones): whether to draw the Shift row, and the slim
 * line that opens or folds it. `again` redraws the page after a click.
 * Returns { show, bar } where bar is the element to put where the Shift row goes (or null).
 */
export function shiftToggle(again) {
  const filled = shiftHasTones();
  const show = filled || shiftOpen();
  if (!show) {
    const more = h('button.sg-more', { type: 'button', title: 'Hold Shift and press a key to use these', html: `${icon('plus')}<span>Shift + key: 10 more slots</span>` });
    more.onclick = () => (setShiftOpen(true), again());
    return { show, bar: more };
  }
  if (filled) return { show, bar: h('span.sg-label.sg-sep', { text: 'Shift + key' }) };
  const fold = h('button.sg-label.sg-fold.sg-sep', { type: 'button', title: 'Fold the Shift row away', text: 'Shift + key' });
  fold.onclick = () => (setShiftOpen(false), again());
  return { show, bar: fold };
}
