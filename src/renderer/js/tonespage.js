import {cabinetFor} from './cabinets.js';
/**
 * Tones: browse your tones, every tone in your songs, and the presets; hear
 * one (your guitar, or a demo riff), save it, rename it, put it in a slot,
 * and edit its rig. Edits are live on your guitar.
 */
import { api } from './api.js';
import { state, on, emit, setPage } from './store.js';
import { h, icon, esc, toast, showMenu, confirmDialog } from './ui.js';
import { rig, TONES } from './rig.js';
import { loadGear } from './gearspec.js';
import { readingBar, tonelib, byId, useTone, saveTone, removeTone, SLOT_GELS, SLOT_COUNT, TYPE_GELS, TYPE_NAMES, knobsOf, orderedGear, shortGearName, kindLabel, gelOf, chainText, songToneLibrary, bySlot } from './tonelib.js';
import { chainEl, rotaryKnob, fmtKnob, gearSummary, demoButton, stopDemo } from './rigui.js';
import { realAmpStrip, realBadge, getAllRealAmps, batch } from './realamps.js';
import { caps, ampOf, packForCurated, resolveCapture } from './captures.js';

const root = document.getElementById('page-tones');
const T = { tab: (() => { try { return localStorage.getItem('stagehand.tonesTab') || 'mine'; } catch (_) { return 'mine'; } })(), advanced: (() => { try { return localStorage.getItem('stagehand.toneEdit') === '1'; } catch (_) { return false; } })(), sel: null, draft: null, block: null, dirty: false, filter: '', libLoading: false, liveT: 0, liveTimer: null };
const listCol = h('section.tones-list', { 'aria-label': 'Tone list' });
const editCol = h('section.tones-edit', { 'aria-label': 'Tone editor' });
root.append(listCol, editCol);

let DB = {};
loadGear().then((d) => (DB = d || {}));

function setTab(id) {
  T.tab = id;
  try {
    localStorage.setItem('stagehand.tonesTab', id);
  } catch (_) {}
}

// ------------------------------------------------------------ slot strip --
/** Your 9 slots, always in view: click one (or drop a tone on it) to put the selected tone there. */
function slotStrip() {
  const strip = h('div.slot-strip', { role: 'group', 'aria-label': 'Your slots' });
  const d = T.draft;
  for (let n = 2; n <= SLOT_COUNT; n++) {
    const t = bySlot(n);
    const here = d && d.mine && d.id && t && t.id === d.id;
    const tile = h(`button.ss-tile${t ? '' : '.vacant'}${here ? '.here' : ''}`, { type: 'button', style: { '--gel': t ? gelOf(t) : SLOT_GELS[n - 1] }, title: d ? (here ? `${d.name} is in slot ${n}` : `Put ${d.name} in slot ${n}${t ? ` (replaces ${t.name})` : ''}  ·  Alt+${n}`) : t ? `Slot ${n}: ${t.name}` : `Slot ${n} is empty` });
    tile.append(h('span.ss-n', { text: String(n) }), h('span.ss-name', { text: t ? t.name : '' }), h('span.ss-put', { html: icon('plus') }));
    tile.onclick = () => putInSlot(n);
    tile.ondragover = (e) => {
      e.preventDefault();
      tile.classList.add('drop');
    };
    tile.ondragleave = () => tile.classList.remove('drop');
    tile.ondrop = (e) => {
      e.preventDefault();
      tile.classList.remove('drop');
      const key = e.dataTransfer.getData('text/x-stagehand-tone');
      const it = (T.items || []).find((x) => x.key === key);
      if (it) {
        select(it, { audition: false });
        putInSlot(n);
      }
    };
    strip.append(tile);
  }
  return strip;
}

/** The selected tone goes into slot n (a song tone or preset is saved to your tones first). */
async function putInSlot(n) {
  if(n===1)return toast({title:'Slot 1 follows the song automatically',message:'Use slots 2–9 for saved tones.',kind:'info'});
  const d = T.draft;
  if (!d) return toast({ title: 'Pick a tone first', kind: 'info', timeout: 2500 });
  try {
    let saved;
    if (d.mine && d.id && !T.dirty) saved = await saveTone({ ...byId(d.id), slot: n });
    else saved = await saveTone({ id: d.mine ? d.id : undefined, name: d.name, kind: d.kind, gear: d.gear, slot: n, from: d.from, ir: d.ir || null, autoCab: d.autoCab !== false, capture: d.capture || null });
    // stay on this tab; just show it landed
    T.draft = { ...clone(saved), id: saved.id, mine: true };
    if (T.tab === 'mine') T.sel = `mine:${saved.id}`;
    T.dirty = false;
    T.flash = n;
    render();
    setTimeout(() => {
      T.flash = null;
      const el = listCol.querySelector(`.ss-tile:nth-child(${n})`);
      if (el) el.classList.remove('flash');
    }, 900);
  } catch (err) {
    toast({ title: 'Couldn’t put it in the slot', message: err.message, kind: 'err' });
  }
}

// keys: ↑/↓ move through the list (hearing each on your guitar), Alt+1–9 puts the selected tone in a slot
document.addEventListener(
  'keydown',
  (e) => {
    if (state.page !== 'tones') return;
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable) && a.type !== 'range';
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && e.altKey && !e.ctrlKey) {
      putInSlot(Number(digit[1]));
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (typing || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const items = T.items || [];
    if (!items.length) return;
    let i = items.findIndex((x) => x.key === T.sel);
    i = i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    select(items[i], { audition: false });
    clearTimeout(T.navT);
    T.navT = setTimeout(() => select(items[i]), 220); // hear it once you stop on it
    const row = listCol.querySelector('.tone-item.on');
    if (row) row.scrollIntoView({ block: 'nearest' });
    e.preventDefault();
    e.stopPropagation();
  },
  true
);

// ------------------------------------------------------------- the list --
function itemsFor(tab) {
  if (tab === 'mine') {
    return uniqueKeys([...tonelib.list].sort((a, b) => (a.slot || 99) - (b.slot || 99) || a.name.localeCompare(b.name)).map((t) => ({ key: `mine:${t.id}`, tone: t, name: t.name, sub: t.slot ? `${kindLabel(t)} · ${chainText(t)}` : chainText(t), slot: t.slot, gel: gelOf(t), mine: true })));
  }
  if (tab === 'presets') return TONES.map((t) => ({ key: `preset:${t.id}`, tone: { ...t, from: { preset: t.id } }, name: t.name, sub: t.desc, gel: t.kind === 'bass' ? '#8c7bff' : '#ffb547' }));
  const out = [];
  for (const g of tonelib.library || []) {
    // 4.0.9: a song can use one tone for its guitar part and its bass part: it's listed
    // twice (guitar and bass). Each needs its own key (with the same key, both lit up and
    // clicking one picked the other), and the bass one says so
    const names = new Map();
    for (const t of g.tones) names.set(t.name, (names.get(t.name) || 0) + 1);
    for (const t of g.tones) {
      const twin = names.get(t.name) > 1;
      out.push({ key: `song:${g.songId}:${t.kind || 'guitar'}:${t.key}`, group: `${g.title}${g.artist ? ` · ${g.artist}` : ''}`, tone: { ...t, name: `${g.title} · ${t.name}`, from: { songId: g.songId, toneKey: t.key, song: `${g.title}${g.artist ? ` (${g.artist})` : ''}` } }, name: t.name, sub: `${twin ? (t.kind === 'bass' ? 'Bass · ' : 'Guitar · ') : ''}${chainText(t)}`, gel: t.kind === 'bass' ? '#8c7bff' : '#ff6b3d' });
    }
  }
  return uniqueKeys(out);
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

function renderList() {
  listCol.innerHTML = '';
  listCol.append(h('h1.page-title', { text: 'Tones' }));
  const tabs = h('div.gseg.tones-tabs', { role: 'tablist', style: { '--gel': 'var(--gel-bass)' } });
  for (const [id, label] of [['mine', 'My tones'], ['songs', 'From my songs'], ['presets', 'Presets']]) {
    const b = h('button', { type: 'button', role: 'tab', 'aria-pressed': String(T.tab === id), text: label });
    b.onclick = () => {
      setTab(id);
      if (id === 'songs') loadLibrary();
      renderList();
    };
    tabs.append(b);
  }
  listCol.append(tabs);
  listCol.append(slotStrip());
  if (T.flash) {
    const el = listCol.querySelector(`.ss-tile:nth-child(${T.flash})`);
    if (el) el.classList.add('flash');
  }
  const find = h('input.input', { type: 'search', placeholder: 'Find a tone, song or piece of gear', 'aria-label': 'Find a tone', value: T.filter });
  find.oninput = () => {
    T.filter = find.value;
    renderItems(box);
  };
  listCol.append(find);
  const box = h('div.tones-items');
  listCol.append(box);
  renderItems(box);
}

function renderItems(box) {
  box.innerHTML = '';
  if (T.tab === 'songs' && !tonelib.library) {
    const bar = readingBar();
    box.append(bar.el);
    T.readBar = bar;
    loadLibrary(); // the tab may be open from last time: start reading (once) whenever this shows
    return;
  }
  if (T.tab === 'songs') {
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
  }
  const q = T.filter.trim().toLowerCase();
  const items = itemsFor(T.tab).filter((it) => !q || `${it.name} ${it.sub} ${it.group || ''}`.toLowerCase().includes(q));
  T.items = items;
  if (!items.length) box.append(h('div.tones-hint', { text: q ? 'Nothing matches.' : T.tab === 'mine' ? 'No saved tones yet.' : 'No tones found.' }));
  let group = null;
  for (const it of items.slice(0, 600)) {
    if (it.group && it.group !== group) {
      group = it.group;
      box.append(h('div.tones-group', { text: group }));
    }
    const on = T.sel === it.key;
    const row = h(`div.tone-item${on ? '.on.lit' : ''}`, { style: { '--gel': it.gel }, draggable: 'true' });
    row.ondragstart = (e) => {
      e.dataTransfer.setData('text/x-stagehand-tone', it.key);
      e.dataTransfer.effectAllowed = 'copy';
    };
    row.append(h('span.gelbar'));
    if (it.slot) row.append(h('span.tslot', { text: String(it.slot) }));
    const main = h('button.ti-main', { type: 'button' }, h('b', { text: it.name }), h('span', { text: it.sub || '' }));
    main.onclick = () => select(it);
    row.append(main);
    const rb = realBadge(it.tone, { small: true });
    if (rb) row.append(rb);
    row.append(demoButton(it.tone, `tones:${it.key}`));
    row.oncontextmenu = (e) => {
      e.preventDefault();
      const items2 = [{ label: 'Try it on my guitar', icon: 'play', onClick: () => select(it) }];
      if (it.mine) {
        for (let n = 2; n <= SLOT_COUNT; n++) if (it.slot !== n) items2.push({ label: `Put in slot ${n}${bySlot(n) ? ` (replaces ${bySlot(n).name})` : ''}`, icon: 'plus', onClick: () => setSlot(it.tone, n) });
        if (it.slot) items2.push({ label: 'Take out of its slot', icon: 'x', onClick: () => setSlot(it.tone, null) });
        items2.push('-', { label: 'Delete', icon: 'trash', onClick: () => del(it.tone) });
      } else items2.push({ label: 'Save to my tones', icon: 'plus', onClick: () => (select(it), save()) });
      showMenu(e.clientX, e.clientY, items2);
    };
    box.append(row);
  }
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

function select(it, { audition = true } = {}) {
  T.sel = it.key;
  T.draft = { ...clone(it.tone), id: it.mine ? it.tone.id : null, name: it.tone.name, slot: it.mine ? it.tone.slot : null, from: it.tone.from || null, mine: !!it.mine };
  T.block = null;
  T.dirty = false;
  if (audition) {
    if (it.mine) useTone(it.tone.id);
    else rig.setLiveTone({ ...T.draft, fromLabel: it.tone.from && it.tone.from.song ? `Trying a tone from ${it.tone.from.song}` : 'Trying a preset (not saved)', gel: it.gel });
  }
  render();
}

function pushLive() {
  const d = T.draft;
  if (!d) return;
  const go = () => {
    T.liveT = performance.now();
    rig.setLiveTone({ ...d, fromLabel: 'Editing in Tones (not saved yet)', gel: gelOf(d) });
  };
  clearTimeout(T.liveTimer);
  const since = performance.now() - T.liveT;
  if (since > 140) go();
  else T.liveTimer = setTimeout(go, 140 - since);
}

function changed() {
  T.dirty = true;
  pushLive();
  const s = editCol.querySelector('.te-save');
  if (s) s.textContent = T.draft.mine ? 'Save changes' : 'Save tone';
  const u = editCol.querySelector('.te-dirty');
  if (u) u.hidden = false;
}

// --------------------------------------------------------------- saving --
async function save() {
  const d = T.draft;
  if (!d) return;
  try {
    const saved = await saveTone({ id: d.mine ? d.id : undefined, name: d.name, kind: d.kind, gear: d.gear, slot: d.slot, from: d.from, ir: d.ir || null, autoCab: d.autoCab !== false, capture: d.capture || null });
    if (T.tab === 'mine') T.sel = `mine:${saved.id}`;
    T.draft = { ...clone(saved), id: saved.id, mine: true };
    T.dirty = false;
    useTone(saved.id);
    toast({ title: d.mine ? `Saved ${saved.name}` : `${saved.name} is in your tones`, message: saved.slot ? `Slot ${saved.slot}` : 'Click a slot above to put it there.', kind: 'ok', timeout: 2500 });
    render();
  } catch (err) {
    toast({ title: 'Couldn’t save the tone', message: err.message, kind: 'err' });
  }
}

async function setSlot(tone, n) {
  try {
    await saveTone({ ...tone, slot: n });
    if (T.draft && T.draft.id === tone.id) T.draft.slot = n;
    render();
  } catch (err) {
    toast({ title: 'Couldn’t change the slot', message: err.message, kind: 'err' });
  }
}

async function del(tone) {
  if (!(await confirmDialog({ title: `Delete ${tone.name}?`, message: 'It’s removed from your tones (songs keep their own).', confirm: 'Delete', danger: true }))) return;
  await removeTone(tone.id);
  if (T.draft && T.draft.id === tone.id) {
    T.draft = null;
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
  if (!d) root.classList.remove('simple');
  if (!d) {
    const np = rig.tone;
    editCol.append(h('div.tones-empty', null, h('h2', { text: 'Pick a tone' }), h('p', { text: 'Choose one on the left to hear it on your guitar, edit its rig, rename it or put it in a slot.' })));
    return;
  }
  const gel = gelOf(d);
  editCol.style.setProperty('--gel', gel);
  const name = h('input.input.te-name', { value: d.name, 'aria-label': 'Tone name', maxlength: '80' });
  name.oninput = () => {
    d.name = name.value;
    T.dirty = true;
    const u = editCol.querySelector('.te-dirty');
    if (u) u.hidden = false;
  };
  const slot = h('select.input.te-slot', { 'aria-label': 'Slot' });
  slot.append(h('option', { value: '', text: 'No slot' }));
  for (let n = 2; n <= SLOT_COUNT; n++) {
    const t = bySlot(n);
    slot.append(h('option', { value: String(n), text: t ? `${n} · ${t.id === d.id ? 'this tone' : `replaces ${t.name}`}` : `${n} (empty)`, selected: d.slot === n ? true : null }));
  }
  slot.onchange = () => {
    d.slot = slot.value ? Number(slot.value) : null;
    T.dirty = true;
    const u = editCol.querySelector('.te-dirty');
    if (u) u.hidden = false;
  };
  const saveBtn = h('button.btn.glow-primary.te-save', { type: 'button', text: d.mine ? (T.dirty ? 'Save changes' : 'Save') : 'Save tone' });
  saveBtn.onclick = () => save();
  const more = h('button.icon-btn', { type: 'button', title: 'More', 'aria-label': 'More', html: icon('more') });
  more.onclick = (e) => {
    const items = [];
    if (d.mine) {
      items.push({ label: 'Save as a copy', icon: 'copy', onClick: () => ((d.mine = false), (d.id = null), (d.name = `${d.name} copy`), (d.slot = null), save()) });
      items.push({ label: 'Delete', icon: 'trash', onClick: () => del(byId(d.id)) });
    }
    items.push({ label: 'Use it on Play', icon: 'guitar', onClick: () => setPage('play') });
    const r = more.getBoundingClientRect();
    showMenu(r.right, r.bottom + 4, items, { align: 'right' });
  };
  editCol.append(
    h('div.te-head', null, h('label.te-field.grow', null, h('span', { text: 'Name' }), name), demoButton(d, 'tones:editor', { label: 'Demo riff', cls: 'big' }), saveBtn, more),
    h('div.te-from', null, h('span.te-dirty', { hidden: !T.dirty, text: 'Changed, not saved · ' }), d.mine ? `Your tone${d.from && d.from.song ? `, first saved from ${d.from.song}` : ''}. Changes are live: play while you tweak, then Save.` : d.from && d.from.song ? `From ${d.from.song}. Saving makes your own copy, so the song keeps its tone.` : d.from && d.from.preset ? 'A Stagehand preset. Saving makes your own copy.' : 'Changes are live: play while you tweak, then Save.')
  );
  root.classList.toggle('simple', !T.advanced);
  if (!T.advanced) return renderSimple(d);
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
  T.advanced = !!on;
  try {
    localStorage.setItem('stagehand.toneEdit', on ? '1' : '0');
  } catch (_) {}
  renderEditor();
}

/**
 * 3.13: the simple view. Most of the time you pick a tone, hear it, put it on a
 * key and play; the amp, cabinet, pedal and knob details are one click away
 * under Edit tone.
 */
function renderSimple(d) {
  const kind = d.kind === 'bass' ? 'Bass' : 'Guitar';
  const chain = chainText(d);
  const edit = h('button.btn.soft', { type: 'button', html: `${icon('edit')}<span>Edit tone</span>` });
  edit.onclick = () => setAdvanced(true);
  const use = h('button.btn.soft', { type: 'button', html: `${icon('guitar')}<span>Play with it now</span>` });
  use.onclick = () => (d.mine && d.id ? useTone(d.id) : rig.setLiveTone({ ...d, fromLabel: d.from && d.from.song ? `Trying a tone from ${d.from.song}` : 'Trying a tone (not saved)', gel: gelOf(d) }));
  const keys = h('div.ts-keys', { role: 'group', 'aria-label': 'Put it on a key' });
  for (let n = 2; n <= SLOT_COUNT; n++) {
    const t = bySlot(n);
    const here = d.mine && d.id && t && t.id === d.id;
    const b = h(`button.ts-key${here ? '.here' : ''}${t ? '' : '.vacant'}`, { type: 'button', style: { '--gel': t ? gelOf(t) : SLOT_GELS[n - 1] }, title: here ? `${d.name} is on key ${n}` : t ? `Put ${d.name} on key ${n} (instead of ${t.name})` : `Put ${d.name} on key ${n}` });
    b.append(h('b', { text: String(n) }), h('span', { text: here ? 'This tone' : t ? t.name : 'Empty' }));
    b.onclick = () => !here && putInSlot(n);
    keys.append(b);
  }
  const box = h('div.ts-simple', null,
    h('div.ts-what', null, h('span.inst-tag', { text: kind }), realBadge(d) || '', h('span.ts-chain', { text: chain || 'No gear yet' })),
    h('div.ts-actions', null, use, edit),
    h('h3.ts-h', { text: 'Put it on a key' }),
    h('p.ts-note', { text: 'Press its number while you play (on the highway or in Jam) to switch. Key 1 always follows the song’s own tones.' }),
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
    setTab('mine');
    const t = byId(o.id);
    select({ key: `mine:${t.id}`, tone: t, mine: true, gel: gelOf(t) }, { audition: false });
  } else if (o.tone && o.tone.gear) {
    setTab(o.tone.from && o.tone.from.songId ? 'songs' : 'mine');
    T.sel = null;
    T.draft = { ...clone(o.tone), id: null, name: o.tone.name || 'My tone', slot: null, from: o.tone.from || (o.tone.key ? { toneKey: o.tone.key } : null), mine: false };
    T.block = null;
  }
});
on('page', () => {
  if (state.page === 'tones') {
    if (!T.draft) {
      const t = byId(rig.toneId);
      if (rig.mode === 'preset' && t) select({ key: `mine:${t.id}`, tone: t, mine: true, gel: gelOf(t) }, { audition: false });
      else render();
    } else render();
  } else stopDemo();
});
on('tones', () => {
  if (state.page !== 'tones') return;
  const box = listCol.querySelector('.tones-items');
  if (box) renderItems(box);
});
on('tones-library', () => state.page === 'tones' && T.tab === 'songs' && renderList());

on('tones-progress', (p) => {
  if (T.readBar && T.readBar.el.isConnected) T.readBar.set(p);
});

caps.events.addEventListener('change', () => {
  if (state.page === 'tones' && T.tab === 'songs' && tonelib.library) {
    const box = listCol.querySelector('.tones-items');
    if (box) renderItems(box);
  }
});
