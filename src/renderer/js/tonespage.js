import { decorativeImage } from './menu-art.js';
import { did } from './rewards.js';
import {cabinetFor} from './cabinets.js';
/**
 * Tones (4.1.9): your keys at the top, then your tones, then a place to find one
 * (every tone in your songs, and the presets).
 *
 * - Clicking a key or a tone picks it and lets you hear it. It never changes a key:
 *   putting a tone on a key is its own step, and says what it replaces (with Undo).
 * - Knob changes are heard live but are not saved until you press Save; Revert (or
 *   leaving the page) goes back to the saved tone.
 * - Song tones: one row per distinct tone, described by what it is (clean, crunch,
 *   high gain, lead) and its gear, grouped by song or artist, with filters.
 *
 * User: "a lot of times I click a slot trying to select it, and write over it…"
 * "Lots of knobs: does it go back to default if a change isn't saved?"
 * "search for distortion, you get thousands…"
 */
import { api } from './api.js';
import { state, on, emit, setPage } from './store.js';
import { h, icon, esc, toast, showMenu, confirmDialog } from './ui.js';
import { rig, TONES } from './rig.js';
import { loadGear } from './gearspec.js';
import { readingBar, tonelib, byId, useTone, saveTone, removeTone, assignSlot, SLOT_GELS, SLOT_COUNT, TYPE_GELS, TYPE_NAMES, knobsOf, orderedGear, shortGearName, gelOf, chainText, songToneLibrary, bySlot, activeSlot } from './tonelib.js';
import { chainEl, gearLineup, gearFaceplate, rotaryKnob, fmtKnob, gearSummary, demoButton, stopDemo } from './rigui.js';
import { realAmpStrip, realBadge, getAllRealAmps, batch } from './realamps.js';
import { caps, ampOf, packForCurated, resolveCapture } from './captures.js';
import { slotChange, slotChangeText, isChanged } from './toneslots.js';
import { groupSongTones, describeTone, CHARACTERS } from './tonesongs.js';
import { gateControl } from './pedalboard.js';

const root = document.getElementById('page-tones');
const load = (k, d) => {
  try {
    return localStorage.getItem(k) || d;
  } catch (_) {
    return d;
  }
};
const keep = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch (_) {}
};
const T = {
  find: load('stagehand.tonesFind', 'songs') === 'presets' ? 'presets' : 'songs',
  by: load('stagehand.tonesBy', 'song') === 'artist' ? 'artist' : 'song',
  kind: 'all',
  char: 'all',
  advanced: false,
  sel: null,
  draft: null, // what you're hearing and editing
  saved: null, // the same tone as it was picked (Revert goes back to it)
  block: null,
  filter: '',
  allMine: false,
  libLoading: false,
  liveT: 0,
  liveTimer: null,
  live: false, // the rig is playing the draft
  here: false,
};
const listCol = h('section.tones-list', { 'aria-label': 'Tone list' });
const editCol = h('section.tones-edit', { 'aria-label': 'Tone editor' });
root.append(listCol, editCol);

let DB = {};
loadGear().then((d) => (DB = d || {}));

const dirty = () => !!(T.draft && T.saved && isChanged(T.saved, T.draft));

// ------------------------------------------------------------- your keys --
/** Keys 1–9 as cards. A click picks the tone on that key (you hear it); it never changes the key. */
function keyCards() {
  const box = h('div.tk-keys', { role: 'group', 'aria-label': 'Your keys' });
  const playing = activeSlot();
  const k1 = h(`button.tk-card.k1${playing === 1 ? '.playing' : ''}`, { type: 'button', style: { '--gel': SLOT_GELS[0] }, title: 'Key 1 follows the song: it switches to the song’s own tones as it plays' });
  k1.append(h('b.tk-n', { text: '1' }), h('span.tk-name', { text: 'Song’s tones' }), h('span.tk-sub', { text: 'Follows the song' }));
  k1.onclick = () => toast({ title: 'Key 1 follows the song', message: 'While a song plays, key 1 switches to the song’s own tones by itself. Keys 2–9 hold your tones.', kind: 'info', timeout: 4000 });
  box.append(k1);
  for (let n = 2; n <= SLOT_COUNT; n++) {
    const t = bySlot(n);
    const sel = t && T.draft && T.draft.mine && T.draft.id === t.id;
    const card = h(`button.tk-card${t ? '' : '.vacant'}${sel ? '.on' : ''}${playing === n ? '.playing' : ''}`, { type: 'button', 'data-key': String(n), style: { '--gel': t ? gelOf(t) : SLOT_GELS[n - 1] }, title: t ? `Key ${n}: ${t.name}. Click to hear it.` : T.draft ? `Key ${n} is empty. Click to put ${T.draft.name} here.` : `Key ${n} is empty` });
    card.append(h('b.tk-n', { text: String(n) }), h('span.tk-name', { text: t ? t.name : 'Empty' }), h('span.tk-sub', { text: t ? describeTone(t).label : T.draft ? 'Put it here' : '' }));
    card.onclick = () => {
      if (t) return select(mineItem(t));
      if (T.draft) return putOnKey(n);
      toast({ title: `Key ${n} is empty`, message: 'Pick a tone below, then put it on a key.', kind: 'info', timeout: 2500 });
    };
    card.ondragover = (e) => {
      e.preventDefault();
      card.classList.add('drop');
    };
    card.ondragleave = () => card.classList.remove('drop');
    card.ondrop = async (e) => {
      e.preventDefault();
      card.classList.remove('drop');
      const key = e.dataTransfer.getData('text/x-stagehand-tone');
      const it = (T.items || []).find((x) => x.key === key);
      if (it && (await select(it, { audition: false }))) putOnKey(n);
    };
    box.append(card);
  }
  return box;
}

/**
 * Puts the tone you picked on key n. A song tone or preset is saved to your tones first.
 * Asks first when that key already holds a tone; either way Undo puts everything back.
 */
async function putOnKey(n) {
  const d = T.draft;
  if (!d || !n || n < 2) return;
  const mine = d.mine && d.id && byId(d.id);
  const list = mine ? tonelib.list : [...tonelib.list, { id: '@new', name: d.name, slot: null }];
  const change = slotChange(list, mine ? d.id : '@new', n);
  if (change.noop) return;
  if (change.replaces && !(await confirmDialog({ title: `Put it on key ${n}?`, message: slotChangeText(change) + (mine ? '' : ' It is saved to your tones first.'), confirm: `Put on key ${n}` }))) return;
  try {
    let id = d.id;
    let made = null;
    if (!mine) {
      made = await saveTone({ name: d.name, kind: d.kind, gear: d.gear, slot: null, from: d.from, ir: d.ir || null, autoCab: d.autoCab !== false, capture: d.capture || null });
      id = made.id;
    }
    const { undo } = await assignSlot(id, n);
    const keepEdits = mine && dirty() ? T.draft : null;
    const t = byId(id);
    T.sel = `mine:${id}`;
    T.saved = { ...clone(t), id, mine: true };
    T.draft = keepEdits ? { ...keepEdits, slot: n } : { ...clone(t), id, mine: true };
    if (made && !T.live) useTone(id);
    render();
    flash(n);
    toast({
      title: `${t.name} is on key ${n}`,
      message: change.replaces ? `${change.replaces.name} is still in your tones.` : 'Press its number while you play to switch to it.',
      kind: 'ok',
      timeout: 8000,
      actions: [
        {
          label: 'Undo',
          onClick: async () => {
            try {
              await undo();
              if (made) await removeTone(made.id);
              if (T.draft && T.draft.id === id) {
                if (made) {
                  T.draft = { ...T.draft, id: null, mine: false, slot: null };
                  T.saved = { ...T.saved, id: null, mine: false, slot: null };
                  T.sel = null;
                } else T.draft.slot = T.saved.slot = change.from;
              }
              render();
            } catch (err) {
              toast({ title: 'Couldn’t undo it', message: err.message, kind: 'err' });
            }
          },
        },
      ],
    });
  } catch (err) {
    toast({ title: 'Couldn’t put it on the key', message: err.message, kind: 'err' });
  }
}

function flash(n) {
  const el = listCol.querySelector(`.tk-card[data-key="${n}"]`);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 900);
}

/** Takes a tone off its key (it stays in your tones), with Undo. */
async function offKey(tone) {
  try {
    const { change, undo } = await assignSlot(tone.id, null);
    if (T.draft && T.draft.id === tone.id) T.draft.slot = T.saved.slot = null;
    render();
    toast({ title: `${tone.name} is off key ${change.from}`, message: 'It’s still in your tones.', kind: 'ok', timeout: 6000, actions: [{ label: 'Undo', onClick: async () => (await undo(), T.draft && T.draft.id === tone.id && (T.draft.slot = T.saved.slot = change.from), render()) }] });
  } catch (err) {
    toast({ title: 'Couldn’t change the key', message: err.message, kind: 'err' });
  }
}

/** The "Put on a key" menu: every key, with what's on it now. */
function keyMenu(e) {
  const d = T.draft;
  if (!d) return;
  const items = [{ heading: true, label: 'Put it on a key' }];
  for (let n = 2; n <= SLOT_COUNT; n++) {
    const t = bySlot(n);
    const here = d.mine && t && t.id === d.id;
    items.push({ label: `Key ${n}`, hint: here ? 'this tone' : t ? t.name : 'empty', icon: here ? 'check' : t ? 'restore' : 'plus', disabled: here, onClick: () => putOnKey(n) });
  }
  if (d.mine && d.slot) items.push('-', { label: `Take it off key ${d.slot}`, icon: 'x', onClick: () => offKey(byId(d.id)) });
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, items);
}

// keys: ↑/↓ move through the list (hearing each on your guitar)
document.addEventListener(
  'keydown',
  (e) => {
    if (state.page !== 'tones') return;
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable) && a.type !== 'range';
    if (typing || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.ctrlKey) return;
    // a knob, a menu or the editor has its own use for the arrows
    if (a && a.closest && a.closest('.tones-edit, .modal, .menu, [role="slider"]')) return;
    const items = T.items || [];
    if (!items.length || document.querySelector('.modal-back, .modal')) return;
    e.preventDefault();
    e.stopPropagation();
    if (dirty()) return toast({ title: 'Save or revert your changes first', message: 'Then the arrow keys move through the list again.', kind: 'info', timeout: 2500 });
    let i = items.findIndex((x) => x.key === T.sel);
    i = i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    select(items[i], { audition: false });
    clearTimeout(T.navT);
    T.navT = setTimeout(() => select(items[i]), 220); // hear it once you stop on it
    const row = listCol.querySelector('.tone-item.on');
    if (row) row.scrollIntoView({ block: 'nearest' });
  },
  true
);

// ------------------------------------------------------------- the lists --
const mineItem = (t) => ({ key: `mine:${t.id}`, tone: t, name: t.name, sub: describeTone(t).text, slot: t.slot, gel: gelOf(t), mine: true });

function mineItems() {
  return uniqueKeys([...tonelib.list].sort((a, b) => (a.slot || 99) - (b.slot || 99) || a.name.localeCompare(b.name)).map(mineItem));
}

function presetItems() {
  const q = T.filter.trim().toLowerCase();
  return TONES.map((t) => ({ t, desc: describeTone(t) }))
    .filter(({ t, desc }) => (T.kind === 'all' || desc.kind === T.kind) && (T.char === 'all' || desc.character === T.char) && (!q || `${t.name} ${t.desc} ${desc.text}`.toLowerCase().includes(q)))
    .map(({ t, desc }) => ({ key: `preset:${t.id}`, tone: { ...t, from: { preset: t.id } }, name: t.name, sub: t.desc || desc.text, gel: t.kind === 'bass' ? '#8c7bff' : '#ffb547' }));
}

/** Song tones: { groups: [{ title, sub, items }], …counts } with list items ready to show. */
function songGroups() {
  const r = groupSongTones(tonelib.library || [], { query: T.filter, kind: T.kind, character: T.char, by: T.by, amps: (caps.st.map && caps.st.map.amps) || null });
  for (const g of r.groups)
    g.rows = g.items.map((it) => {
      const t = it.tone;
      const song = `${it.title}${it.artist ? ` (${it.artist})` : ''}`;
      const also = it.also.length ? ` · also in ${it.also.length === 1 ? it.also[0] : `${it.also.length} more songs`}` : '';
      return {
        key: `song:${it.songId}:${t.kind || 'guitar'}:${t.key}`,
        tone: { ...t, name: `${it.title} · ${t.name}`, from: { songId: it.songId, toneKey: t.key, song } },
        name: T.by === 'artist' ? `${it.title} · ${t.name}` : t.name,
        sub: `${it.desc.text}${also}`,
        title: it.also.length ? `Also in ${it.also.join(', ')}` : '',
        gel: t.kind === 'bass' ? '#8c7bff' : it.desc.character === 'clean' ? '#33c8e0' : it.desc.character === 'crunch' ? '#ffb547' : it.desc.character === 'lead' ? '#ff4d8d' : '#ff6b3d',
      };
    });
  return r;
}

/** Every row its own key, whatever the files hold (two rows with one key light up together). */
export function uniqueKeys(items) {
  const seen = new Map();
  for (const it of items) {
    const n = seen.get(it.key) || 0;
    seen.set(it.key, n + 1);
    if (n) it.key = `${it.key}#${n + 1}`;
  }
  return items;
}

function seg(label, options, value, onPick, cls = '') {
  const s = h(`div.seg${cls}`, { role: 'group', 'aria-label': label });
  for (const [id, text] of options) {
    const b = h('button', { type: 'button', 'aria-pressed': String(value === id), text });
    b.onclick = () => onPick(id);
    s.append(b);
  }
  return s;
}

function renderList() {
  const scroll = listCol.scrollTop;
  listCol.innerHTML = '';
  const create = h('button.btn.primary.tw-create', { type: 'button', html: `${icon('plus')}<span>Create tone</span>`, title: 'Make a new tone step by step, hearing each choice as you play' });
  create.onclick = () => import('./tonewizard.js').then((w) => w.openToneWizard());
  listCol.append(h('div.tones-titlebar', null, h('h1.page-title', { text: 'Tones' }), create));

  // your keys
  listCol.append(h('div.tk-head', null, h('h2.tk-h', { text: 'Your keys' }), h('span.tk-note', { text: 'Press a number while you play to switch' })), keyCards(), gateControl({ compact: true }));

  // your tones
  const mine = mineItems();
  const sec = h('div.tones-sec.mine');
  sec.append(h('h2.tk-h', { text: `Your tones${mine.length ? ` · ${mine.length}` : ''}` }));
  const shown = T.allMine ? mine : mine.slice(0, 8);
  if (!mine.length) sec.append(h('div.tones-hint', { text: 'None saved yet. Pick one below or press Create tone.' }));
  const box1 = h('div.tones-items.mine-items');
  for (const it of shown) box1.append(row(it));
  sec.append(box1);
  if (mine.length > 8) {
    const more = h('button.btn.small.ghost', { type: 'button', text: T.allMine ? 'Show fewer' : `Show all ${mine.length}` });
    more.onclick = () => ((T.allMine = !T.allMine), renderList());
    sec.append(more);
  }
  listCol.append(sec);

  // find a tone
  const find = h('div.tones-sec.find');
  find.append(h('h2.tk-h', { text: 'Find a tone' }));
  const tabs = h('div.gseg.tones-tabs', { role: 'tablist', style: { '--gel': 'var(--gel-bass)' } });
  for (const [id, label] of [['songs', 'In my songs'], ['presets', 'Presets']]) {
    const b = h('button', { type: 'button', role: 'tab', 'aria-pressed': String(T.find === id), text: label });
    b.onclick = () => {
      T.find = id;
      keep('stagehand.tonesFind', id);
      if (id === 'songs') loadLibrary();
      renderList();
    };
    tabs.append(b);
  }
  const q = h('input.input.tones-find', { type: 'search', placeholder: T.find === 'songs' ? 'Artist, song, amp or sound (e.g. metallica lead)' : 'Find a preset', 'aria-label': 'Find a tone', value: T.filter });
  q.oninput = () => {
    T.filter = q.value;
    renderItems(box);
  };
  const filters = h('div.tones-filters');
  filters.append(
    seg('Guitar or bass', [['all', 'All'], ['guitar', 'Guitar'], ['bass', 'Bass']], T.kind, (v) => ((T.kind = v), renderList())),
    seg('Sound', [['all', 'Any sound'], ...CHARACTERS], T.char, (v) => ((T.char = v), renderList()))
  );
  if (T.find === 'songs') filters.append(seg('Group', [['song', 'By song'], ['artist', 'By artist']], T.by, (v) => ((T.by = v), keep('stagehand.tonesBy', v), renderList())));
  find.append(tabs, q, filters);
  const box = h('div.tones-items.find-items');
  find.append(box);
  listCol.append(find);
  renderItems(box);
  listCol.scrollTop = scroll;
}

function row(it) {
  const on = T.sel === it.key;
  const r = h(`div.tone-item${on ? '.on.lit' : ''}`, { style: { '--gel': it.gel }, draggable: 'true', title: it.title || '' });
  r.ondragstart = (e) => {
    e.dataTransfer.setData('text/x-stagehand-tone', it.key);
    e.dataTransfer.effectAllowed = 'copy';
  };
  r.append(h('span.gelbar'));
  if (it.slot) r.append(h('span.tslot', { text: String(it.slot), title: `On key ${it.slot}` }));
  const main = h('button.ti-main', { type: 'button' }, h('b', { text: it.name }), h('span', { text: it.sub || '' }));
  main.onclick = () => select(it);
  r.append(main);
  const rb = realBadge(it.tone, { small: true });
  if (rb) r.append(rb);
  r.append(demoButton(it.tone, `tones:${it.key}`));
  r.oncontextmenu = async (e) => {
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    const items = [{ label: 'Try it on my guitar', icon: 'play', onClick: () => select(it) }];
    const keyItems = [];
    for (let n = 2; n <= SLOT_COUNT; n++) if (it.slot !== n) keyItems.push({ label: `Key ${n}`, hint: bySlot(n) ? bySlot(n).name : 'empty', onClick: async () => (await select(it, { audition: false })) && putOnKey(n) });
    items.push({ label: 'Put on a key', icon: 'plus', submenu: keyItems });
    if (it.mine) {
      if (it.slot) items.push({ label: 'Take it off its key', icon: 'x', onClick: () => offKey(it.tone) });
      items.push('-', { label: 'Delete', icon: 'trash', onClick: () => del(it.tone) });
    } else items.push({ label: 'Save to my tones', icon: 'plus', onClick: async () => (await select(it)) && save() });
    showMenu(x, y, items);
  };
  return r;
}

function renderItems(box) {
  box.innerHTML = '';
  const mine = mineItems();
  if (T.find === 'presets') {
    const list = presetItems();
    T.items = [...mine, ...list];
    if (!list.length) box.append(h('div.tones-hint', { text: 'Nothing matches.' }));
    for (const it of list) box.append(row(it));
    return;
  }
  if (!tonelib.library) {
    T.items = mine;
    const bar = readingBar();
    box.append(bar.el);
    T.readBar = bar;
    loadLibrary(); // the page may open here from last time: start reading (once) whenever this shows
    return;
  }
  // the real amps your songs use that you haven't got yet: all in one go
  const counts = {};
  for (const g of tonelib.library || [])
    for (const t of g.tones) {
      const a = ampOf(t);
      const k = a && caps.st.map.amps && caps.st.map.amps[a.key];
      if (k && !packForCurated(k)) counts[k] = (counts[k] || 0) + 1;
    }
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (keys.length || batch.on) {
    const strip = h('div.ra-libstrip');
    const tones = keys.reduce((n, k) => n + counts[k], 0);
    strip.append(h('span.real-badge.off', { text: 'MODEL' }), h('span.grow', { text: batch.on ? `Getting real amps · ${batch.i} of ${batch.n}` : `${tones} of your song tones play modelled amps. ${keys.length} real ${keys.length === 1 ? 'amp' : 'amps'} to get.` }));
    if (!batch.on) {
      const b = h('button.btn.small.glow-primary', { type: 'button', html: `${icon('download')}<span>Get all ${keys.length}</span>` });
      b.onclick = () => getAllRealAmps(keys);
      strip.append(b);
    }
    box.append(strip);
  }
  const r = songGroups();
  const filtered = T.filter.trim() || T.kind !== 'all' || T.char !== 'all';
  box.append(h('div.tones-count', { text: r.distinct ? (filtered ? `${r.count.toLocaleString()} of ${r.distinct.toLocaleString()} different tones` : `${r.distinct.toLocaleString()} different tones in your songs${r.total > r.distinct ? ` (${(r.total - r.distinct).toLocaleString()} repeats left out)` : ''}`) : 'No tones found in your songs.' }));
  const rows = [];
  for (const g of r.groups) {
    box.append(h('div.tones-group', null, h('span', { text: g.title }), g.sub ? h('small', { text: g.sub }) : ''));
    for (const it of g.rows) {
      rows.push(it);
      box.append(row(it));
    }
  }
  if (r.distinct && !r.count) box.append(h('div.tones-hint', { text: 'Nothing matches. Try fewer words, or Any sound.' }));
  if (r.hidden) box.append(h('div.tones-hint', { text: `${r.hidden.toLocaleString()} more: type an artist, a song or an amp to narrow it down.` }));
  T.items = [...mine, ...rows];
}

async function loadLibrary() {
  if (tonelib.library || T.libLoading) return;
  T.libLoading = true;
  try {
    await songToneLibrary();
  } catch (err) {
    toast({ title: 'Couldn’t read your songs’ tones', message: err.message, kind: 'err' });
  }
  T.libLoading = false;
  if (state.page === 'tones') renderList();
}

// ------------------------------------------------------------ selecting --
function clone(t) {
  return { ...t, gear: orderedGear(t).map((g) => ({ ...g, knobs: { ...(g.knobs || {}) } })) };
}

/** Asks before unsaved changes are dropped. True when it's fine to go on. */
async function okToDrop() {
  if (!dirty()) return true;
  return confirmDialog({ title: 'Drop your changes?', message: `Your changes to ${T.saved.name} aren’t saved. It goes back to how it was.`, confirm: 'Drop changes', danger: true });
}

/** Picks a tone: you hear it (audition) and can edit it. Never changes a key. */
async function select(it, { audition = true } = {}) {
  if (T.sel === it.key && T.draft && !dirty()) {
    if (audition) hear(T.draft);
    return true;
  }
  if (!(await okToDrop())) return false;
  T.sel = it.key;
  T.draft = { ...clone(it.tone), id: it.mine ? it.tone.id : null, name: it.tone.name, slot: it.mine ? it.tone.slot : null, from: it.tone.from || null, mine: !!it.mine, gel: it.gel };
  T.saved = clone(T.draft);
  T.block = null;
  if (audition) hear(T.draft);
  render();
  return true;
}

/** Plays this tone as it is saved (your tone on its key, or the song's / preset as a try). */
function hear(d) {
  T.live = false;
  if (d.mine && d.id && byId(d.id)) useTone(d.id);
  else rig.setLiveTone({ ...d, fromLabel: d.from && d.from.song ? `Trying a tone from ${d.from.song}` : 'Trying a preset (not saved)', gel: d.gel || gelOf(d) });
}

function pushLive() {
  const d = T.draft;
  if (!d) return;
  const go = () => {
    T.liveT = performance.now();
    T.live = true;
    rig.setLiveTone({ ...d, fromLabel: 'Editing in Tones (not saved yet)', gel: gelOf(d) });
  };
  clearTimeout(T.liveTimer);
  const since = performance.now() - T.liveT;
  if (since > 140) go();
  else T.liveTimer = setTimeout(go, 140 - since);
}

/** After any edit: hear it, and show whether it differs from the saved tone. */
function changed({ live = true } = {}) {
  if (live) pushLive();
  markDirty();
}

function markDirty() {
  const on = dirty();
  const u = editCol.querySelector('.te-dirty');
  if (u) u.hidden = !on;
  const s = editCol.querySelector('.te-save');
  if (s && T.draft) {
    s.textContent = T.draft.mine ? (on ? 'Save changes' : 'Saved') : 'Save tone';
    s.disabled = T.draft.mine && !on;
    s.classList.toggle('glow-primary', !T.draft.mine || on);
  }
  const r = editCol.querySelector('.te-revert');
  if (r) r.hidden = !on;
}

/** Back to the saved tone, and hear it. */
function revert() {
  if (!T.saved) return;
  clearTimeout(T.liveTimer);
  T.draft = clone(T.saved);
  T.block = null;
  hear(T.draft);
  render();
}

// --------------------------------------------------------------- saving --
async function save() {
  const d = T.draft;
  if (!d) return;
  try {
    clearTimeout(T.liveTimer);
    const saved = await saveTone({ id: d.mine ? d.id : undefined, name: d.name, kind: d.kind, gear: d.gear, slot: d.mine ? d.slot : null, from: d.from, ir: d.ir || null, autoCab: d.autoCab !== false, capture: d.capture || null });
    did('tone-make');
    T.sel = `mine:${saved.id}`;
    T.draft = { ...clone(saved), id: saved.id, mine: true };
    T.saved = clone(T.draft);
    useTone(saved.id);
    T.live = false;
    toast({ title: d.mine ? `Saved ${saved.name}` : `${saved.name} is in your tones`, message: saved.slot ? `On key ${saved.slot}` : 'Use Put on a key to play it with a number key.', kind: 'ok', timeout: 2500 });
    render();
  } catch (err) {
    toast({ title: 'Couldn’t save the tone', message: err.message, kind: 'err' });
  }
}

async function del(tone) {
  if (!(await confirmDialog({ title: `Delete ${tone.name}?`, message: 'It’s removed from your tones (songs keep their own).', confirm: 'Delete', danger: true }))) return;
  await removeTone(tone.id);
  if (T.draft && T.draft.id === tone.id) {
    T.draft = T.saved = null;
    T.sel = null;
  }
  render();
}

// --------------------------------------------------------------- editor --
function gearChoices(slotType, kind) {
  const bass = kind === 'bass';
  const out = [];
  for (const [key, g] of Object.entries(DB)) {
    const t = g.t;
    const isBass = key.startsWith('Bass_');
    if (slotType === 'amp' && t !== 'amp') continue;
    if ((slotType === 'pre' || slotType === 'post') && t !== 'pedal') continue;
    if (slotType === 'rack' && t !== 'rack') continue;
    if (slotType === 'cab') continue;
    out.push({ key, name: g.n, cat: g.c, bass: isBass });
  }
  out.sort((a, b) => (a.bass === bass ? 0 : 1) - (b.bass === bass ? 0 : 1) || a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  return out;
}

/** Cabinets: { base: { name, bass, keys: { 'mic|pos': key } } } */
function cabs() {
  const out = {};
  for (const [key, g] of Object.entries(DB)) {
    if (g.t !== 'cab') continue;
    const m = /^(.*)_(57|Condenser|Ribbon|Tube)_(Cone|Edge|OffAxis)$/.exec(key);
    const base = m ? m[1] : key;
    const o = (out[base] = out[base] || { name: g.n, bass: key.startsWith('Bass_'), keys: {} });
    o.keys[m ? `${m[2]}|${m[3]}` : 'any|any'] = key;
  }
  return out;
}
const MIC = [['57', 'Dynamic (SM57)'], ['Condenser', 'Condenser'], ['Ribbon', 'Ribbon'], ['Tube', 'Tube']];
const POS = [['Cone', 'Cone (brighter)'], ['Edge', 'Edge (warmer)'], ['OffAxis', 'Off axis (smoother)']];

function addMenu(e) {
  const d = T.draft;
  const items = [{ heading: true, label: 'Add to the chain' }];
  const add = (slot) => {
    const list = gearChoices(slot, d.kind);
    const pick = list[0];
    if (!pick) return;
    d.gear.push({ slot, key: pick.key, knobs: {}, order: d.gear.length });
    d.gear = orderedGear(d);
    T.block = d.gear.findIndex((g) => g.key === pick.key && g.slot === slot);
    changed();
    renderEditor();
  };
  items.push({ label: 'Pedal before the amp', icon: 'plus', onClick: () => add('pre') });
  if (!d.gear.some((g) => g.slot === 'amp')) items.push({ label: 'Amp', icon: 'amp', onClick: () => add('amp') });
  items.push({ label: 'Pedal after the amp', icon: 'plus', onClick: () => add('post') });
  items.push({ label: 'Rack effect', icon: 'plus', onClick: () => add('rack') });
  if (!d.gear.some((g) => g.slot === 'cab')) {
    items.push({
      label: 'Cabinet',
      icon: 'plus',
      onClick: () => {
        const c = Object.values(cabs()).find((x) => x.bass === (d.kind === 'bass'));
        if (!c) return;
        d.gear.push({ slot: 'cab', key: Object.values(c.keys)[0], knobs: {} });
        d.gear = orderedGear(d);
        changed();
        renderEditor();
      },
    });
  }
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, items);
}

function renderEditor() {
  editCol.innerHTML = '';
  const d = T.draft;
  if (!d) {
    root.classList.remove('simple');
    editCol.append(h('div.tones-empty', null, decorativeImage('empty-tones'), h('h2', { text: 'Pick a tone' }), h('p', { text: 'Click a key, one of your tones or one from your songs to hear it on your guitar. Picking a tone never changes your keys.' })));
    return;
  }
  const gel = gelOf(d);
  editCol.style.setProperty('--gel', gel);
  const name = h('input.input.te-name', { value: d.name, 'aria-label': 'Tone name', maxlength: '80' });
  name.oninput = () => {
    d.name = name.value;
    changed({ live: false });
  };
  const on = dirty();
  const saveBtn = h(`button.btn.te-save${!d.mine || on ? '.glow-primary' : ''}`, { type: 'button', text: d.mine ? (on ? 'Save changes' : 'Saved') : 'Save tone', disabled: d.mine && !on ? true : null });
  saveBtn.onclick = () => save();
  const revertBtn = h('button.btn.soft.te-revert', { type: 'button', html: `${icon('restore')}<span>Revert</span>`, title: 'Go back to the saved tone', hidden: !on });
  revertBtn.onclick = () => revert();
  const keyBtn = h('button.btn.soft.te-key', { type: 'button', html: `${icon('plus')}<span>${d.mine && d.slot ? `On key ${d.slot}` : 'Put on a key'}</span>`, title: 'Put this tone on one of the keys 2–9' });
  keyBtn.onclick = (e) => keyMenu(e);
  const more = h('button.icon-btn', { type: 'button', title: 'More', 'aria-label': 'More', html: icon('more') });
  more.onclick = () => {
    const items = [];
    if (d.mine) {
      items.push({ label: 'Save as a copy', icon: 'copy', onClick: () => ((d.mine = false), (d.id = null), (d.name = `${d.name} copy`), (d.slot = null), save()) });
      items.push({ label: 'Delete', icon: 'trash', onClick: () => del(byId(d.id)) });
    }
    items.push({ label: 'Use it on Play', icon: 'guitar', onClick: () => setPage('play') });
    const r = more.getBoundingClientRect();
    showMenu(r.right, r.bottom + 4, items, { align: 'right' });
  };
  const desc = describeTone(d);
  editCol.append(
    h('div.te-head', null, h('label.te-field.grow', null, h('span', { text: 'Name' }), name), demoButton(d, 'tones:editor', { label: 'Demo riff', cls: 'big' }), keyBtn, revertBtn, saveBtn, more),
    h('div.te-from', null, h('span.te-dirty', { hidden: !on, text: 'Changed, not saved: you hear your changes. Save keeps them; Revert or leaving the page goes back. · ' }), h('span', { text: `${desc.text}. ` }), d.mine ? `Your tone${d.from && d.from.song ? `, first saved from ${d.from.song}` : ''}.` : d.from && d.from.song ? `From ${d.from.song}. Saving makes your own copy, so the song keeps its tone.` : d.from && d.from.preset ? 'A Stagehand preset. Saving makes your own copy.' : '')
  );
  root.classList.toggle('simple', !T.advanced);
  if (!T.advanced) return renderSimple(d);
  renderAdvanced(d);
}

function renderAdvanced(d) {
  const done = h('button.btn.small.soft.te-simple', { type: 'button', html: `${icon('chevronLeft')}<span>Done editing</span>` });
  done.onclick = () => setAdvanced(false);
  editCol.append(done);
  if (!d.gear.length) {
    editCol.append(h('p', { text: 'This tone has no gear yet. Add an amp to start.' }));
  }
  if (T.block === null || T.block >= d.gear.length) T.block = Math.max(0, d.gear.findIndex((g) => g.slot === 'amp'));
  const { el } = chainEl(d, { selected: T.block, onPick: (i) => ((T.block = i), renderEditor()), onAdd: (e) => addMenu(e), sub: gearSummary });
  editCol.append(el);
  const g = d.gear[T.block];
  const row = h('div.te-cards');
  if (g && g.slot !== 'cab') {
    const bg = TYPE_GELS[g.slot] || '#ff4d8d';
    const card = h('div.card.tint.te-block', { style: { '--gel': bg } });
    const swap = h('select.input', { 'aria-label': 'Swap for another' });
    swap.append(h('option', { value: '', text: 'Swap for…' }));
    let cat = null;
    let og = null;
    for (const c of gearChoices(g.slot, d.kind)) {
      if (c.cat !== cat) {
        cat = c.cat;
        og = h('optgroup', { label: `${c.cat}${c.bass ? ' (bass)' : ''}` });
        swap.append(og);
      }
      og.append(h('option', { value: c.key, text: c.name, selected: c.key === g.key ? true : null }));
    }
    swap.value = '';
    swap.onchange = () => {
      if (!swap.value) return;
      g.key = swap.value;
      g.knobs = {};
      changed();
      renderEditor();
    };
    const byp = h('button.btn.small.soft', { type: 'button', text: g.bypass ? 'Turn on' : 'Bypass', 'aria-pressed': String(!!g.bypass) });
    byp.onclick = () => {
      g.bypass = !g.bypass;
      changed();
      renderEditor();
    };
    const rm = h('button.icon-btn', { type: 'button', title: 'Remove from the chain', 'aria-label': 'Remove', html: icon('trash') });
    rm.onclick = () => {
      d.gear.splice(T.block, 1);
      T.block = null;
      changed();
      renderEditor();
    };
    card.append(h('div.card-head', null, h('span.dot', { style: { background: bg, boxShadow: `0 0 6px ${bg}` } }), h('h2', { text: `${shortGearName(g.key)} · ${(TYPE_NAMES[g.slot] || 'Pedal').toLowerCase()}` }), h('span.grow'), swap, byp, rm));
    // the real amp (a NAM capture) or Stagehand's model
    if (g.slot === 'amp' && !g.bypass)
      card.append(
        realAmpStrip(d, () => {
          changed();
          renderEditor();
        })
      );
    const knobs = h('div.knobs3');
    for (const k of knobsOf(g)) {
      knobs.append(
        rotaryKnob({
          name: k.name,
          min: k.min,
          max: k.max,
          value: k.value,
          def: k.def,
          gel: bg,
          fmt: (v) => fmtKnob(k, v),
          onInput: (v) => {
            g.knobs = { ...(g.knobs || {}), [k.key]: v };
            changed();
          },
        })
      );
    }
    if (!knobs.childNodes.length) knobs.append(h('span', { text: 'No knobs on this one.', style: { color: 'var(--ink-3)' } }));
    const faceplate = gearFaceplate(g.key, knobs);
    if (faceplate) card.append(faceplate);
    card.append(knobs);
    row.append(card);
  }
  row.append(cabCard(d));
  editCol.append(row);
}

function cabCard(d) {
  const card = h('div.card.tint.te-cab', { style: { '--gel': 'var(--gel-bass)' } });
  card.append(h('div.card-head', null, h('h2', { text: 'Cabinet' })));
  const ci = d.gear.findIndex((g) => g.slot === 'cab');
  const all = cabs();
  if (ci < 0) {
    const add = h('button.btn.soft', { type: 'button', text: '+ Add a cabinet' });
    add.onclick = () => {
      const c = Object.values(all).find((x) => x.bass === (d.kind === 'bass'));
      if (!c) return;
      d.gear.push({ slot: 'cab', key: Object.values(c.keys)[0], knobs: {} });
      d.gear = orderedGear(d);
      changed();
      renderEditor();
    };
    card.append(h('p.np-fine', { text: 'No cabinet: you hear the amp straight.' }), add);
    return card;
  }
  const g = d.gear[ci];
  const m = /^(.*)_(57|Condenser|Ribbon|Tube)_(Cone|Edge|OffAxis)$/.exec(g.key);
  const base = m ? m[1] : g.key;
  const mic = m ? m[2] : '57';
  const pos = m ? m[3] : 'Cone';
  const setKey = (b, mi, po) => {
    const c = all[b];
    if (!c) return;
    g.key = c.keys[`${mi}|${po}`] || c.keys[`${mi}|Cone`] || c.keys[`57|${po}`] || Object.values(c.keys)[0];
    changed();
    renderEditor();
  };
  const spk = h('div.speaker', { 'aria-hidden': 'true' }, h('span.mic', { style: { left: pos === 'Cone' ? '50%' : '74%', top: pos === 'OffAxis' ? '30%' : '50%' } }));
  const cabSel = h('select.input', { 'aria-label': 'Speaker cab' });
  for (const [b, c] of Object.entries(all).sort((a, b2) => (a[1].bass === (d.kind === 'bass') ? 0 : 1) - (b2[1].bass === (d.kind === 'bass') ? 0 : 1) || a[1].name.localeCompare(b2[1].name))) cabSel.append(h('option', { value: b, text: `${c.name}${c.bass ? ' (bass)' : ''}`, selected: b === base ? true : null }));
  cabSel.onchange = () => setKey(cabSel.value, mic, pos);
  const micSel = h('select.input', { 'aria-label': 'Mic' });
  for (const [v, label] of MIC) if (all[base] && Object.keys(all[base].keys).some((k) => k.startsWith(`${v}|`))) micSel.append(h('option', { value: v, text: label, selected: v === mic ? true : null }));
  micSel.onchange = () => setKey(base, micSel.value, pos);
  const posSeg = h('div.gseg', { role: 'group', 'aria-label': 'Mic position', style: { '--gel': 'var(--gel-bass)' } });
  for (const [v, label] of POS) {
    const b = h('button', { type: 'button', text: label.split(' ')[0] === 'Off' ? 'Off axis' : label.split(' ')[0], title: label, 'aria-pressed': String(v === pos) });
    b.onclick = () => setKey(base, mic, v);
    posSeg.append(b);
  }
  const fullRig=!!resolveCapture(d)?.fullRig;
  const automatic=d.autoCab!==false;
  const mode=h('button.btn.soft.small',{text:automatic?'Use modeled cabinet controls':'Use automatic captured cabinet',disabled:fullRig||!!d.ir});
  mode.onclick=()=>{d.autoCab=!automatic;changed();renderEditor();};
  cabSel.disabled=micSel.disabled=fullRig||!!d.ir||automatic;
  for(const b of posSeg.querySelectorAll('button'))b.disabled=cabSel.disabled;
  const advanced=h('details',null,h('summary',{text:'Advanced cabinet options'}));
  advanced.append(mode);
  const cabId=cabinetFor(d,resolveCapture(d));
  const names={'1x12_open':'1×12 open-back','2x12_closed':'2×12 closed-back','4x12_straight':'4×12 straight','4x12_slant':'4×12 slant','bass-410':'EBS 4×10','bass-115':'Ampeg B15 1×15','bass-215':'Sunn 2×15','bass-810':'Ampeg SVT 8×10','bass-orange':'Orange 2×12'};
  card.append(h('p.cab-status',{text:fullRig?'Cabinet included in this amp capture':d.ir?'Custom cabinet active':automatic?`Automatic cabinet · ${names[cabId]||cabId}`:'Modeled cabinet active'}));
  card.append(h('p.np-fine',{text:'Included with Download amp + cab. Stagehand loads it for you—no separate files to choose.'}));
  const ir = h('button.btn.soft.small' , { type: 'button', text: d.ir ? 'Use automatic cab' : 'Use my own cab file (IR)…' });
  ir.disabled=fullRig;
  ir.onclick = async () => {
    if (d.ir) {
      d.ir = null;d.autoCab=true;
      changed();
      return renderEditor();
    }
    const p = await api.dialog.pickFile({ title: 'Pick a cab impulse response (WAV)', filters: [{ name: 'Impulse response', extensions: ['wav'] }] });
    if (!p) return;
    d.ir = p;
    changed();
    renderEditor();
    if (rig.kind !== 'native') toast({ title: 'Saved with the tone', message: 'Your own cab files work with the fastest sound engine (Settings › Guitar & audio).', kind: 'info' });
  };
  advanced.append(spk, h('label.te-field', null, h('span', { text: 'Speaker cab' }), cabSel), h('label.te-field', null, h('span', { text: 'Mic' }), micSel), h('div.te-field', null, h('span', { text: 'Position' }), posSeg));
  if (d.ir) card.append(h('div.np-fine', { text: `Your cab file: ${d.ir.split(/[\\/]/).pop()}` }));
  // where to get cab files: TONE3000 (formerly ToneHunt), free community captures and IRs
  const get = h('button.btn.ghost.small', { type: 'button', html: `<span>Get cab files</span> ${icon('external')}`, title: 'Opens TONE3000 in your browser: free cab IRs (download a .wav, then use it here)' });
  get.onclick = () => api.shell.openExternal('https://www.tone3000.com/categories/tags/guitar').catch(() => {});
  advanced.append(h('div.te-ir-row', null, ir));
  card.append(advanced);
  return card;
}

// --------------------------------------------------------------- render --
function setAdvanced(on) {
  // 4.6: editing opens the rig (the board with cables, the piece, the gear wall)
  T.advanced = false;
  keep('stagehand.toneEdit', '0');
  if (on) return openEditRig();
  renderEditor();
}

async function openEditRig(pickKey = null) {
  const d = T.draft;
  if (!d) return;
  const { openRig } = await import('./rigroom.js');
  const tone = { ...clone(d), id: d.mine ? d.id : null, slot: d.mine ? d.slot : null };
  await openRig({
    tone,
    onSaved: (saved) => {
      T.sel = `mine:${saved.id}`;
      T.draft = { ...clone(saved), id: saved.id, mine: true };
      T.saved = clone(T.draft);
      T.live = false;
      render();
    },
  });
  void pickKey;
}

/**
 * The simple view: what the tone is, play it, put it on a key. The amp, cabinet,
 * pedal and knob details are one click away under Edit tone.
 */
function renderSimple(d) {
  const kind = d.kind === 'bass' ? 'Bass' : 'Guitar';
  const chain = chainText(d);
  const edit = h('button.btn.soft', { type: 'button', html: `${icon('edit')}<span>Edit tone</span>` });
  edit.onclick = () => setAdvanced(true);
  const use = h('button.btn.soft', { type: 'button', html: `${icon('guitar')}<span>Play with it now</span>` });
  use.onclick = () => (dirty() ? pushLive() : hear(d));
  const keys = h('div.ts-keys', { role: 'group', 'aria-label': 'Put it on a key' });
  for (let n = 2; n <= SLOT_COUNT; n++) {
    const t = bySlot(n);
    const here = d.mine && d.id && t && t.id === d.id;
    const b = h(`button.ts-key${here ? '.here' : ''}${t ? '' : '.vacant'}`, { type: 'button', style: { '--gel': t ? gelOf(t) : SLOT_GELS[n - 1] }, title: here ? `${d.name} is on key ${n}` : t ? `Put ${d.name} on key ${n} (asks first: ${t.name} is there)` : `Put ${d.name} on key ${n}` });
    b.append(h('b', { text: String(n) }), h('span', { text: here ? 'This tone' : t ? t.name : 'Empty' }));
    b.onclick = () => !here && putOnKey(n);
    keys.append(b);
  }
  const box = h(
    'div.ts-simple',
    null,
    h('div.ts-what', null, h('span.inst-tag', { text: kind }), realBadge(d) || '', h('span.ts-chain', { text: chain || 'No gear yet' })),
    (d.gear && d.gear.length) ? gearLineup(d, { onPick: (_i, g) => { T.block = d.gear.indexOf(g); setAdvanced(true); } }) : '',
    h('div.ts-actions', null, use, edit),
    h('h3.ts-h', { text: 'Put it on a key' }),
    h('p.ts-note', { text: 'Press its number while you play (on the highway or in Jam) to switch. Key 1 always follows the song’s own tones. If a key already holds a tone, you’re asked first, and you can undo it.' }),
    keys
  );
  editCol.append(box);
}

function render() {
  if (state.page !== 'tones') return;
  renderList();
  renderEditor();
}

on('tones-open', (o) => {
  if (!o) return;
  if (o.id && byId(o.id)) {
    const t = byId(o.id);
    T.draft = null;
    select(mineItem(t), { audition: false });
  } else if (o.tone && o.tone.gear) {
    T.sel = null;
    T.draft = { ...clone(o.tone), id: null, name: o.tone.name || 'My tone', slot: null, from: o.tone.from || (o.tone.key ? { toneKey: o.tone.key } : null), mine: false };
    T.saved = clone(T.draft);
    T.block = null;
  }
});

/** Leaving Tones with unsaved changes: back to the saved tone (with a way back to the changes). */
function leave() {
  stopDemo();
  if (!dirty()) return;
  const parked = T.draft;
  T.draft = clone(T.saved);
  clearTimeout(T.liveTimer);
  if (T.live && rig.mode === 'live') hear(T.draft);
  T.live = false;
  toast({
    title: `Your changes to ${T.saved.name} weren’t saved`,
    message: 'It’s back to the saved tone.',
    kind: 'info',
    timeout: 7000,
    actions: [
      {
        label: 'Back to my changes',
        onClick: () => {
          setPage('tones');
          T.draft = parked;
          pushLive();
          render();
        },
      },
    ],
  });
}

on('page', () => {
  if (state.page === 'tones') {
    T.here = true;
    if (!T.draft) {
      const t = byId(rig.toneId);
      if (rig.mode === 'preset' && t) select(mineItem(t), { audition: false });
      else render();
    } else render();
  } else if (T.here) {
    T.here = false;
    leave();
  }
});
on('tones', () => {
  if (state.page !== 'tones') return;
  renderList();
});
on('tones-library', () => state.page === 'tones' && T.find === 'songs' && renderList());

on('tones-progress', (p) => {
  if (T.readBar && T.readBar.el.isConnected) T.readBar.set(p);
});

caps.events.addEventListener('change', () => {
  if (state.page === 'tones' && T.find === 'songs' && tonelib.library) renderList();
});
