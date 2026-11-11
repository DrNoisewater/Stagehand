/**
 * 4.6: the Gear page, a showroom of every amp, cabinet, pedal and rack unit (the user: "we want
 * to have a section that shows all of these off with ability to mess with them, turn knobs").
 *
 *   ┌ Gear · 209 pieces ─────────────── [find] [Guitar|Bass|All] ┐
 *   │ shelves │ the shelf as photos       │ THE PIECE, big          │
 *   │ Amps    │ ▢ ▢ ▢ ▢                   │ photo, knobs turn on it │
 *   │ Drive…  │ ▢ ▢ ▢ ▢                   │ control strip + help    │
 *   │         │                           │ ▶ Hear it  A/B  Live    │
 *   │         │                           │ + New tone with it      │
 *   └─────────┴───────────────────────────┴─────────────────────────┘
 *
 * Hear it plays a riff through a test rig (a clean amp and cabinet around the piece, or the amp
 * on its matched cabinet). Live puts the test rig on your guitar until you leave the page.
 */
import { h, icon, toast } from './ui.js';
import { state, on } from './store.js';
import { rig } from './rig.js';
import { loadGear, gearName } from './gearspec.js';
import { byId } from './tonelib.js';
import { buildTone, freshChoices } from './tonerecipes.js';
import { playDemo, stopDemo, demoPlaying } from './rigui.js';
import { gearItems, GEAR_CATS, gearPanel, micPanel, gearThumb, CAB_RE } from './gearbench.js';

const root = document.getElementById('page-gear');
const read = (k, d) => {
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
const S = {
  items: [],
  cat: read('stagehand.gearShelf', 'amps'),
  who: read('stagehand.gearWho', 'all'),
  q: '',
  pick: read('stagehand.gearPick', ''),
  knobs: new Map(), // key → knobs you set this visit
  live: false,
  before: null,
  prevOnShelf: new Map(), // shelf → the piece you looked at before this one (for A/B)
  ab: 'a',
  built: false,
};

const shelvesEl = h('nav.sr-shelves', { 'aria-label': 'Shelves' });
const gridEl = h('div.sr-grid', { role: 'list' });
const showEl = h('section.sr-show', { 'aria-label': 'The piece' });
const findEl = h('input.input.sr-find', { type: 'search', placeholder: 'Find gear: fuzz, plexi, octave, echo…', 'aria-label': 'Find gear' });
const whoEl = h('div.gseg.sr-who', { role: 'group', 'aria-label': 'Guitar or bass gear' });
const countEl = h('span.sr-count');

function build() {
  if (S.built) return;
  S.built = true;
  root.append(
    h('header.sr-head', null, h('h1.page-title', { text: 'Gear' }), countEl, h('span.grow'), findEl, whoEl),
    h('div.sr-body', null, h('div.sr-left', null, shelvesEl, gridEl), showEl)
  );
  findEl.oninput = () => {
    S.q = findEl.value.trim().toLowerCase();
    drawGrid();
  };
}

function testRig(it, knobs) {
  const kind = it.bass ? 'bass' : 'guitar';
  const base = buildTone(freshChoices(kind));
  const gear = base.gear.filter((g) => g.slot === 'amp' || g.slot === 'cab');
  const ampI = gear.findIndex((g) => g.slot === 'amp');
  const cabI = gear.findIndex((g) => g.slot === 'cab');
  let autoCab = true;
  if (it.t === 'amp') gear[ampI] = { slot: 'amp', key: it.key, knobs: { ...knobs }, order: 1 };
  else if (it.t === 'cab') {
    gear[cabI] = { slot: 'cab', key: knobs.__key || it.defaultKey, knobs: Object.fromEntries(Object.entries(knobs).filter(([k]) => k !== '__key')), order: 3 };
    autoCab = false;
  } else gear.push({ slot: it.slot, key: it.key, knobs: { ...knobs }, order: it.slot === 'pre' ? 0 : it.slot === 'post' ? 2 : 4 });
  return { name: `${it.name} (test rig)`, kind, gear, autoCab, ir: null, capture: it.t === 'amp' ? 'off' : null };
}

const visible = (it) => S.who === 'all' || (S.who === 'bass') === !!it.bass;

function drawShelves() {
  shelvesEl.innerHTML = '';
  for (const c of GEAR_CATS) {
    const n = S.items.filter((it) => it.cat === c.id && visible(it)).length;
    if (!n) continue;
    const b = h('button.sr-shelf', { type: 'button', 'aria-pressed': String(S.cat === c.id && !S.q), title: c.hint }, h('span', { text: c.label }), h('small', { text: String(n) }));
    b.onclick = () => {
      S.cat = c.id;
      S.q = '';
      findEl.value = '';
      keep('stagehand.gearShelf', c.id);
      drawShelves();
      drawGrid();
    };
    shelvesEl.append(b);
  }
}

function drawWho() {
  whoEl.innerHTML = '';
  for (const [id, label] of [['all', 'All'], ['guitar', 'Guitar'], ['bass', 'Bass']]) {
    const b = h('button', { type: 'button', text: label, 'aria-pressed': String(S.who === id) });
    b.onclick = () => {
      S.who = id;
      keep('stagehand.gearWho', id);
      drawWho();
      drawShelves();
      drawGrid();
    };
    whoEl.append(b);
  }
}

function drawGrid() {
  const words = S.q.split(/\s+/).filter(Boolean);
  const list = S.items.filter((it) => visible(it) && (words.length ? words.every((w) => `${it.name} ${it.sub} ${it.key} ${GEAR_CATS.find((c) => c.id === it.cat).label}`.toLowerCase().includes(w)) : it.cat === S.cat));
  const sy = gridEl.scrollTop;
  gridEl.innerHTML = '';
  for (const it of list) {
    const card = h(`button.sr-card${it.key === S.pick ? '.on' : ''}`, { type: 'button', role: 'listitem', title: it.name, 'aria-pressed': String(it.key === S.pick) }, h('span.sr-card-art', null, gearThumb(it.key, it.slot)), h('span.sr-card-name', { text: it.name }), it.bass && S.who === 'all' ? h('span.sr-tag', { text: 'Bass' }) : '');
    card.onclick = () => pick(it.key);
    gridEl.append(card);
  }
  if (!list.length) gridEl.append(h('p.sr-none', { text: 'Nothing matches.' }));
  gridEl.scrollTop = words.length ? 0 : sy;
}

function pick(key) {
  const prev = S.items.find((x) => x.key === S.pick);
  const it = S.items.find((x) => x.key === key);
  if (!it) return;
  if (prev && prev.key !== key && prev.cat === it.cat) S.prevOnShelf.set(it.cat, prev.key);
  S.pick = key;
  S.ab = 'a';
  keep('stagehand.gearPick', key);
  if (demoPlaying() && String(demoPlaying()).startsWith('gear:')) stopDemo();
  drawGrid();
  drawShow();
  if (S.live) hearLive();
}

let panel = null;
function drawShow() {
  if (panel && panel.dispose) panel.dispose();
  panel = null;
  showEl.innerHTML = '';
  const it = S.items.find((x) => x.key === S.pick) || S.items.find((x) => x.cat === S.cat && visible(x));
  if (!it) return;
  S.pick = it.key;
  const cat = GEAR_CATS.find((c) => c.id === it.cat);
  const knobs = S.knobs.get(it.key) || {};
  S.knobs.set(it.key, knobs);
  const titleRow = h('div.sr-titlerow', null, h('div.sr-title', null, h('small', { text: `${cat.label}${it.bass ? ' · bass' : ''}` }), h('h2', { text: it.name })));
  showEl.append(titleRow);
  if (it.t === 'cab') {
    const g = { slot: 'cab', key: knobs.__key || it.defaultKey, knobs: Object.fromEntries(Object.entries(knobs).filter(([k]) => k !== '__key')) };
    showEl.append(h('div.sr-cab', null, h('div.sr-cabpic', null, gearThumb(g.key, 'cab', { full: true })), micPanel(g, it, {
      on: (p) => {
        if (p.key) knobs.__key = p.key;
        if (p.knobs) Object.assign(knobs, p.knobs);
        if (p.key) drawShow();
        changed();
      },
    })));
  } else {
    const g = { slot: it.slot, key: it.key, knobs };
    panel = gearPanel(g, {
      gel: it.t === 'amp' ? '#ff6b3d' : it.t === 'rack' ? '#33c8e0' : '#ff4d8d',
      onKnob: (key, v) => {
        knobs[key] = v;
        changed();
      },
    });
    showEl.append(panel);
  }
  // hear it, compare it, play through it
  const hearB = h('button.btn.primary.sr-hear', { type: 'button' });
  const paintHear = () => {
    const on = demoPlaying() === `gear:${it.key}:a`;
    hearB.innerHTML = on ? '<span class="eq"><i></i><i></i><i></i></span><span>Playing…</span>' : `${icon('play')}<span>Hear it</span>`;
  };
  hearB.onclick = () => (demoPlaying() === `gear:${it.key}:a` ? (stopDemo(), paintHear()) : (playDemo(testRig(it, knobs), `gear:${it.key}:a`, paintHear), paintHear()));
  const otherKey = S.prevOnShelf.get(it.cat);
  const other = otherKey && S.items.find((x) => x.key === otherKey);
  const bLabel = it.t === 'amp' || it.t === 'cab' ? (other ? other.name : null) : 'Without it';
  const ab = h('div.gseg.sr-ab', { role: 'group', 'aria-label': 'Compare' });
  if (bLabel) {
    const a = h('button', { type: 'button', text: `A · ${it.t === 'amp' || it.t === 'cab' ? it.name : 'With it'}`, 'aria-pressed': String(S.ab === 'a') });
    const b = h('button', { type: 'button', text: `B · ${bLabel}`, 'aria-pressed': String(S.ab === 'b') });
    const go = (which) => {
      S.ab = which;
      a.setAttribute('aria-pressed', String(which === 'a'));
      b.setAttribute('aria-pressed', String(which === 'b'));
      let t;
      if (which === 'a') t = testRig(it, knobs);
      else if (other) t = testRig(other, S.knobs.get(other.key) || {});
      else {
        t = testRig(it, knobs);
        t.gear = t.gear.map((g) => (g.key === it.key ? { ...g, bypass: true } : g));
      }
      playDemo(t, `gear:${it.key}:${which}`, paintHear);
      if (S.live) rig.setLiveTone({ ...t, fromLabel: 'Trying gear in the showroom' });
    };
    a.onclick = () => go('a');
    b.onclick = () => go('b');
    ab.append(h('span.sr-ab-l', { text: 'Compare' }), a, b);
  }
  const liveB = h(`button.btn.soft.sr-live${S.live ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(S.live), html: `<span class="rr-led"></span><span>${S.live ? 'On your guitar' : 'Play it with my guitar'}</span>`, title: 'Put this test rig on your guitar while you’re on this page' });
  liveB.onclick = () => {
    S.live = !S.live;
    if (S.live) {
      S.before = { mode: rig.mode, toneId: rig.toneId, live: rig.liveTone ? { ...rig.liveTone } : null };
      hearLive();
      if (!rig.on) toast({ title: 'Plug in to hear it', message: 'Your guitar plays through this piece as soon as it’s on. Hear it plays a riff meanwhile.', kind: 'info', timeout: 3500 });
    } else leaveLive();
    drawShow();
  };
  const reset = h('button.btn.small.ghost', { type: 'button', html: `${icon('restore')}<span>Reset knobs</span>` });
  reset.onclick = () => {
    S.knobs.set(it.key, {});
    drawShow();
    changed();
  };
  const newT = h('button.btn.soft.sr-new', { type: 'button', html: `${icon('plus')}<span>New tone with it</span>`, title: 'Opens Create a tone with this already on the board' });
  newT.onclick = () => toRig(it, null);
  const cur = rig.mode === 'preset' && rig.toneId && byId(rig.toneId);
  const addCur = cur ? h('button.btn.soft.sr-add', { type: 'button', html: `${icon('plus')}<span>Add to ${cur.name}</span>`, title: `Opens ${cur.name} with this added` }) : '';
  if (addCur) addCur.onclick = () => toRig(it, cur);
  // what you do with it sits up top, next to its name, so it's never scrolled away
  titleRow.append(h('div.sr-actions', null, hearB, ab, liveB));
  showEl.append(h('div.sr-actions.to', null, newT, addCur, h('span.grow'), reset));
  paintHear();
  const onDemo = () => (hearB.isConnected ? paintHear() : document.removeEventListener('sh-demo', onDemo));
  document.addEventListener('sh-demo', onDemo);
}

async function toRig(it, tone) {
  leaveLive();
  const { openRig } = await import('./rigroom.js');
  const knobs = { ...(S.knobs.get(it.key) || {}) };
  const add = it.t === 'cab' ? knobs.__key || it.defaultKey : it.key;
  openRig({ tone: tone || null, kind: tone ? tone.kind : it.bass ? 'bass' : 'guitar', add });
}

let liveTimer = 0;
function changed() {
  if (!S.live) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(hearLive, 120);
}
function hearLive() {
  const it = S.items.find((x) => x.key === S.pick);
  if (!it || !S.live) return;
  rig.setLiveTone({ ...testRig(it, S.knobs.get(it.key) || {}), fromLabel: 'Trying gear in the showroom' });
}
function leaveLive() {
  if (!S.live) return;
  S.live = false;
  const b = S.before;
  S.before = null;
  try {
    if (b && b.mode === 'preset' && b.toneId) rig.setTone(b.toneId);
    else if (b && b.mode === 'live' && b.live) rig.setLiveTone(b.live);
    else if (b && b.mode === 'song') import('./song-auto.js').then((s) => s.refreshSongTone && s.refreshSongTone(true)).catch(() => {});
  } catch (_) {}
}

async function render() {
  build();
  const db = await loadGear();
  S.items = gearItems(db);
  countEl.textContent = `${S.items.length} pieces · turn any knob · hear it`;
  if (!S.items.some((x) => x.key === S.pick)) S.pick = '';
  if (S.pick) S.cat = (S.items.find((x) => x.key === S.pick) || {}).cat || S.cat;
  drawWho();
  drawShelves();
  drawGrid();
  drawShow();
}

on('page', () => {
  if (state.page === 'gear') render();
  else {
    leaveLive();
    if (demoPlaying() && String(demoPlaying()).startsWith('gear:')) stopDemo();
  }
});

export const _test = { S, testRig, pick, gearName, CAB_RE };
