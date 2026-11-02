/** Centre pane: the song table (virtualised) and the cover grid. */
import { api } from './api.js';
import { isOfficial, state, on, emit, visibleSongs, viewTitle, persistUi, bump, setSelection, setView, accBand, hasPart, loadLibrary, rsMissing, rsListKeys, rsListLabel, rsStockLabel } from './store.js';
import { h, icon, esc, fmtDuration, debounce } from './ui.js';
import * as actions from './actions.js';
import { addFolder } from './sidebar.js';

const ROW_H = 54; // 3.8: bigger, easier to read
const root = document.getElementById('library');

const COLS = [
  { key: null, label: '' },
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'year', label: 'Year' },
  { key: 'tuning', label: 'Tuning' },
  { key: 'parts', label: 'Parts' },
  { key: 'best', label: 'Your best' },
  { key: 'length', label: 'Length' },
  { key: null, label: '', title: 'Stems' },
  { key: 'rating', label: 'Rating' },
];

const PARTS = [
  ['lead', 'L', 'Lead'],
  ['rhythm', 'R', 'Rhythm'],
  ['bass', 'B', 'Bass'],
  ['vocals', 'V', 'Vocals'],
];

// ------------------------------------------------------------ skeleton --
const head = h('div.lib-head');
const titleEl = h('div.lib-title', null, h('h1'), h('div.sub'));
const tools = h('div.lib-tools');
const partFilter = h('div.part-filter', { role: 'group', 'aria-label': 'Show songs with these parts' });
for (const [key, , label] of PARTS) {
  const chip = h('button.chip', { type: 'button', 'aria-pressed': String(state.parts.has(key)), text: label });
  chip.onclick = () => {
    if (state.parts.has(key)) state.parts.delete(key);
    else state.parts.add(key);
    chip.setAttribute('aria-pressed', String(state.parts.has(key)));
    persistUi();
    bump();
    render();
  };
  partFilter.append(chip);
}
const layoutSeg = h('div.gseg', { role: 'group', 'aria-label': 'Layout' });
const listBtn = h('button', { type: 'button', title: 'List', html: `${icon('list')}<span>List</span>` });
const gridBtn = h('button', { type: 'button', title: 'Album tiles', html: `${icon('grid')}<span>Tiles</span>` });
listBtn.onclick = () => setLayout('list');
gridBtn.onclick = () => setLayout('grid');
layoutSeg.append(listBtn, gridBtn);
const moreBtn = h('button.icon-btn', { type: 'button', title: 'More', html: icon('more') });
moreBtn.onclick = (e) => {
  const r = moreBtn.getBoundingClientRect();
  actions.libraryMenu(r.right, r.bottom + 4);
  e.stopPropagation();
};
tools.append(partFilter, layoutSeg, moreBtn);
head.append(titleEl, tools);

const table = h('div.table');
const thead = h('div.table-head.cols', { role: 'row' });
const scroller = h('div.scroller', { tabindex: '0', role: 'grid', 'aria-label': 'Songs' });
const rowsEl = h('div.rows');
const gridEl = h('div.grid');
scroller.append(rowsEl, gridEl);
const emptyEl = h('div.empty', { hidden: true });
table.append(thead, scroller, emptyEl);
root.append(head, table);

function buildHead() {
  thead.innerHTML = '';
  COLS.forEach((c) => {
    if (!c.key) {
      thead.append(h('div', { title: c.title || '' }));
      return;
    }
    const active = state.sort.key === c.key;
    const b = h('button', { type: 'button', 'aria-sort': active ? (state.sort.dir > 0 ? 'ascending' : 'descending') : null });
    b.innerHTML = `<span>${esc(c.label)}</span>${active ? icon(state.sort.dir > 0 ? 'sortUp' : 'sortDown') : ''}`;
    b.onclick = () => {
      if (state.sort.key === c.key) state.sort.dir *= -1;
      else state.sort = { key: c.key, dir: c.key === 'rating' || c.key === 'year' ? -1 : 1 };
      state.userSorted = true;
      persistUi();
      bump();
      buildHead();
      render();
    };
    thead.append(b);
  });
}

function setLayout(l) {
  state.layout = l;
  persistUi();
  rowEls.forEach((el) => el.remove());
  rowEls.clear();
  tileEls.forEach((el) => el.remove());
  tileEls.clear();
  render();
}

// ---------------------------------------------------------------- rows --
let list = [];
let rowEls = new Map();
let tileEls = new Map();

function thumbHtml(s, size) {
  const src = s.art ? api.artUrl(s, size) : null;
  return src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" draggable="false">` : icon('music');
}

function partsHtml(s) {
  return PARTS.map(([key, letter, label]) => {
    const n = (s.arrangements || []).filter((a) => a.type === key || (key === 'lead' && a.type === 'combo') || (key === 'vocals' && a.type === 'jvocals')).length;
    return `<span class="part${n ? ' on' : ''}${n > 1 ? ' plus' : ''}" ${n ? `data-part="${key}" ` : ''}title="${n ? `${label}${n > 1 ? ` (${n})` : ''}: click to show only songs with ${label.toLowerCase()}` : `No ${label.toLowerCase()}`}">${letter}</span>`;
  }).join('');
}

function stemHtml(s) {
  const st = state.stems.get(s.id);
  const status = st ? st.state : s.hasStems ? 'ready' : 'none';
  const cls = status === 'ready' ? 'ready' : status === 'running' || status === 'queued' ? 'busy' : '';
  const title = status === 'ready' ? 'Stems ready' : status === 'running' ? 'Separating stems' : status === 'queued' ? 'Waiting to separate' : 'No stems yet';
  return `<span class="stem-gels ${cls}" title="${title}"><i></i><i></i><i></i><i></i><i></i></span>`;
}

/** Your best accuracy (practice stats): a glowing bar and the percentage. */
function bestOf(s) {
  const b = state.best && state.best[s.id];
  return b && b.best !== undefined ? b.best : null;
}
function bestHtml(s) {
  const v = bestOf(s);
  if (v === null) return '<span class="best none">–</span>';
  const pct = Math.round(v * 100);
  return `<span class="best${pct >= 85 ? ' top' : ''}" title="Your best: ${pct}%"><span class="bb"><i style="width:${pct}%"></i></span><span>${pct}%</span></span>`;
}

const SONG_GELS = ['#ff6b3d', '#8c7bff', '#ff4d8d', '#33c8e0', '#9bdb5a', '#ffb547'];
function gelOf(s) {
  let x = 0;
  for (const c of String(s.artist || s.title || s.id || '')) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return SONG_GELS[x % SONG_GELS.length];
}
function initialsOf(s) {
  return (s.artist || s.title || '').replace(/^the\s+/i, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '♪';
}

function starsHtml(s) {
  const r = (s.user && s.user.rating) || 0;
  let out = '<span class="stars" role="radiogroup" aria-label="Rating">';
  for (let i = 1; i <= 5; i++) out += `<button type="button" class="${i <= r ? 'on' : ''}" data-star="${i}" aria-label="${i} star${i > 1 ? 's' : ''}">${icon('star', 'fill')}</button>`;
  return out + '</span>';
}

function tuningText(s) {
  if (!s.tuning) return '';
  return s.tuningCents ? `${s.tuning} (${s.tuningCents})` : s.tuning;
}

/** 3.7: your best accuracy (full speed), as a small badge to the upper right of the title. */
function bestBadge(s) {
  const b = bestOf(s);
  if (b === null) return '';
  const pct = Math.round(b * 100);
  return `<sup class="acc${pct >= 100 ? ' full' : pct >= 90 ? ' high' : ''}" title="Your best accuracy: ${pct}%">${pct}%</sup>`;
}

/** 4.0.3: official (paid) DLC gets its own tag; a custom song with no audio says so. */
function noAudioBadge(s) {
  // 4.0.4: a small dim seal, not a word: it was too loud next to every title
  if (isOfficial(s)) return '<span class="official" title="Official Rocksmith DLC" aria-label="Official Rocksmith DLC"><svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6"/><path d="M3.9 6.1l1.4 1.4 2.8-2.9"/></svg></span>';
  return s.audioEntry === null && !s.audioFrom ? '<sup class="noaudio" title="No song audio in this file: it can’t play">no audio</sup>' : '';
}

function buildRow(s) {
  const el = h('div.row.cols', { role: 'row', draggable: 'true' });
  el.dataset.id = s.id;
  el.innerHTML = `
    <div><div class="thumb">${thumbHtml(s, 64)}</div></div>
    <div class="t" title="${esc(s.title)}"><span class="tt-text">${esc(s.title)}</span>${bestBadge(s)}${noAudioBadge(s)}</div>
    <div>${s.artist ? `<span class="go" data-go="artist" title="All songs by ${esc(s.artist)}">${esc(s.artist)}</span>` : ''}</div>
    <div>${s.album ? `<span class="go" data-go="album" title="Everything from ${esc(s.album)}">${esc(s.album)}</span>` : ''}</div>
    <div class="num">${s.year ? `<span class="go" data-go="year" title="Songs from ${s.year}">${s.year}</span>` : ''}</div>
    <div>${s.tuning ? `<span class="go" data-go="tuning" title="All songs in ${esc(s.tuning)}">${esc(tuningText(s))}</span>` : ''}</div>
    <div class="parts">${partsHtml(s)}</div>
    <div class="go-best" data-go="acc" title="Songs at this level">${bestHtml(s)}</div>
    <div class="num">${fmtDuration(s.length)}</div>
    <div>${stemHtml(s)}</div>
    <div>${starsHtml(s)}</div>`;
  const img = el.querySelector('img');
  if (img) img.onerror = () => img.replaceWith(htmlToNode(icon('music')));
  return el;
}

function buildTile(s) {
  const el = h('div.tile', { draggable: 'true' });
  el.dataset.id = s.id;
  const gel = gelOf(s);
  el.style.setProperty('--gel', gel);
  const b = bestOf(s);
  const pct = b === null ? null : Math.round(b * 100);
  const ring = pct === null ? '' : `<span class="ring${pct >= 85 ? ' top' : ''}" style="--deg:${Math.round(pct * 3.6)}deg" title="Your best: ${pct}%"><span>${pct}</span></span>`;
  const badges = PARTS.filter(([key]) => key !== 'vocals')
    .filter(([key]) => (s.arrangements || []).some((a) => a.type === key || (key === 'lead' && a.type === 'combo')))
    .map(([key, letter, label]) => `<span class="pb pb-${key}" title="${label}">${letter}</span>`)
    .join('');
  el.innerHTML = `<div class="halo"></div><div class="cover gelled"><span class="ini">${esc(initialsOf(s))}</span>${s.art ? `<img src="${esc(api.artUrl(s, 256))}" alt="" loading="lazy" decoding="async" draggable="false">` : ''}<span class="badges">${badges}</span>${ring}<button type="button" class="play" title="Play" data-play>${icon('play')}</button></div>
    <div class="tt" title="${esc(s.title)}"><span class="tt-text">${esc(s.title)}</span>${bestBadge(s)}${noAudioBadge(s)}</div><div class="ta">${esc(s.artist)}${s.tuning ? ` · ${esc(s.tuning)}` : ''}</div>`;
  const img = el.querySelector('img');
  if (img) {
    img.onload = () => el.querySelector('.cover').classList.add('has-img');
    img.onerror = () => img.remove();
  }
  return el;
}

function htmlToNode(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function decorate(el, s) {
  const sel = state.selection.has(s.id);
  el.classList.toggle('sel', sel);
  el.classList.toggle('focus', state.focus === s.id && document.activeElement === scroller);
  el.classList.toggle('playing', state.nowPlaying === s.id);
  el.setAttribute('aria-selected', String(sel));
  const thumb = el.querySelector('.thumb, .cover');
  const eq = thumb && thumb.querySelector('.eq');
  if (state.nowPlaying === s.id) {
    if (!eq) thumb.append(htmlToNode('<span class="eq"><i></i><i></i><i></i></span>'));
    const e2 = thumb.querySelector('.eq');
    e2.classList.toggle('paused', !state.playing);
  } else if (eq) eq.remove();
}

let geometry = { cols: 1, tileW: 180, tileH: 240 };

function renderWindow() {
  const top = scroller.scrollTop;
  const hgt = scroller.clientHeight || 600;
  if (state.layout === 'list') {
    rowsEl.style.height = `${list.length * ROW_H}px`;
    gridEl.style.height = '0px';
    const first = Math.max(0, Math.floor(top / ROW_H) - 6);
    const last = Math.min(list.length, Math.ceil((top + hgt) / ROW_H) + 6);
    const keep = new Map();
    for (let i = first; i < last; i++) {
      const s = list[i];
      let el = rowEls.get(s.id);
      if (el && el._song !== s) {
        el.remove();
        el = null;
      }
      if (!el) {
        el = buildRow(s);
        el._song = s;
      }
      el.style.transform = `translateY(${i * ROW_H}px)`;
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.right = '0';
      el.dataset.index = i;
      decorate(el, s);
      keep.set(s.id, el);
      if (!el.isConnected) rowsEl.append(el);
    }
    for (const [id, el] of rowEls) if (!keep.has(id)) el.remove();
    rowEls = keep;
  } else {
    const width = scroller.clientWidth - 40;
    const cols = Math.max(2, Math.floor(width / 184));
    const tileW = width / cols;
    const tileH = tileW + 52;
    geometry = { cols, tileW, tileH };
    const rows = Math.ceil(list.length / cols);
    gridEl.style.height = `${rows * tileH + 24}px`;
    rowsEl.style.height = '0px';
    const firstRow = Math.max(0, Math.floor(top / tileH) - 2);
    const lastRow = Math.min(rows, Math.ceil((top + hgt) / tileH) + 2);
    const keep = new Map();
    for (let r = firstRow; r < lastRow; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i >= list.length) break;
        const s = list[i];
        let el = tileEls.get(s.id);
        if (el && el._song !== s) {
          el.remove();
          el = null;
        }
        if (!el) {
          el = buildTile(s);
          el._song = s;
        }
        el.style.width = `${tileW}px`;
        el.style.transform = `translate(${20 + c * tileW}px, ${4 + r * tileH}px)`;
        el.style.left = '0';
        el.style.top = '0';
        el.dataset.index = i;
        decorate(el, s);
        keep.set(s.id, el);
        if (!el.isConnected) gridEl.append(el);
      }
    }
    for (const [id, el] of tileEls) if (!keep.has(id)) el.remove();
    tileEls = keep;
  }
}

function refreshDecorations() {
  for (const [id, el] of rowEls) {
    const s = state.songs.get(id);
    if (s) decorate(el, s);
  }
  for (const [id, el] of tileEls) {
    const s = state.songs.get(id);
    if (s) decorate(el, s);
  }
}

function renderEmpty() {
  emptyEl.hidden = true;
  emptyEl.innerHTML = '';
  if (list.length) return;
  emptyEl.hidden = false;
  const box = h('div.box');
  if (!state.loaded) {
    box.append(h('div.spin', { style: { margin: '0 auto', width: '22px', height: '22px', color: 'var(--tungsten)' } }));
  } else if (!state.folders.length) {
    box.innerHTML = `<svg class="art" viewBox="0 0 84 84" aria-hidden="true">
      <defs><linearGradient id="bm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb547" stop-opacity=".9"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></linearGradient></defs>
      <path d="M34 6h16l14 70H20z" fill="url(#bm)" opacity=".35"/><rect x="30" y="2" width="24" height="8" rx="3" fill="#ffb547"/>
      <rect x="18" y="58" width="48" height="20" rx="4" fill="#242c44" stroke="#2c3552"/><path d="M26 68h6M36 64v8M44 66v4M52 63v10M60 67h-2" stroke="#ffc978" stroke-width="2.4" stroke-linecap="round"/></svg>
      <h2>Bring in your songs</h2>
      <p>Add the folder where your Rocksmith .psarc files live, usually the <b>dlc</b> folder inside your Rocksmith 2014 install. Stagehand reads them where they are.</p>`;
    const actionsRow = h('div.actions');
    const add = h('button.btn.primary', { type: 'button', html: `${icon('folderPlus')}<span>Add folder</span>` });
    add.onclick = () => addFolder();
    actionsRow.append(add);
    box.append(actionsRow);
    const det = h('div.detected');
    box.append(det);
    api.library.detect().then((found) => {
      for (const p of found) {
        const b = h('button.btn', { type: 'button', html: `${icon('folder')}<span>Use ${esc(p)}</span>` });
        b.onclick = () => addFolder(p);
        det.append(b);
      }
    });
  } else if (state.scan && state.scan.state !== 'done' && !state.songs.size) {
    box.innerHTML = `<h2>Scanning your folders</h2><p>${state.scan.total ? `${state.scan.done} of ${state.scan.total} files read` : 'Looking for .psarc files…'}</p>`;
  } else if (state.view.kind === 'rslist' && !state.search && !state.parts.size) {
    const r = state.rs;
    if (!r || !r.profile) {
      box.innerHTML = `<h2>No Rocksmith profile found</h2><p>${esc(r && r.error ? r.error : 'Stagehand looks for your profile in Steam’s userdata folder. Start Rocksmith once on this PC, or point Stagehand at your Steam folder.')}</p>`;
      const go = h('button.btn', { type: 'button', text: 'Rocksmith settings' });
      go.onclick = () => import('./dialogs.js').then((d) => d.settings('rocksmith'));
      box.append(h('div.actions', null, go));
    } else {
      const extra = rsListKeys(state.view.id).length;
      box.innerHTML = extra
        ? `<h2>None of these songs are in your folders</h2><p>${rsListLabel(state.view.id)} has ${extra} song${extra === 1 ? '' : 's'} Stagehand doesn’t have files for, such as on-disc songs. They stay in the list.</p>`
        : `<h2>${esc(rsListLabel(state.view.id))} is empty</h2><p>Drag songs onto it in the sidebar, or right-click any song and choose Add to Rocksmith. Changes show up in the game next time you start it.</p>`;
    }
  } else if (state.view.kind === 'setlist' && !state.search && !state.parts.size) {
    box.innerHTML = `<h2>This setlist is empty</h2><p>Drag songs onto it in the sidebar, or right-click any song and choose Add to setlist.</p>`;
  } else if (state.search || state.parts.size) {
    box.innerHTML = `<h2>No songs match</h2><p>Nothing in ${esc(viewTitle())} fits your search and part filters.</p>`;
    const clear = h('button.btn', { type: 'button', text: 'Clear search and filters' });
    clear.onclick = () => {
      state.search = '';
      document.getElementById('search').value = '';
      state.parts.clear();
      partFilter.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      persistUi();
      bump();
      render();
    };
    const q = state.search.trim();
    if (q) {
      const online = h('button.btn.primary', { type: 'button', html: `${icon('search')}<span>Search MusicBrainz for “${esc(q.length > 30 ? q.slice(0, 30) + '…' : q)}”</span>` });
      online.onclick = () => import('./discover.js').then((d) => d.searchOnline(q));
      box.append(h('div.actions', null, online, clear));
      box.querySelector('p').textContent = `Nothing in ${viewTitle()} fits your search and part filters. Looking for a song you don’t have yet?`;
    } else box.append(h('div.actions', null, clear));
  } else if (!state.songs.size) {
    box.innerHTML = `<h2>No songs found yet</h2><p>None of your folders contain readable .psarc files. Check the folder in Settings, or add another one.</p>`;
    const add = h('button.btn', { type: 'button', html: `${icon('folderPlus')}<span>Add folder</span>` });
    add.onclick = () => addFolder();
    box.append(h('div.actions', null, add));
  } else {
    box.innerHTML = `<h2>Nothing here yet</h2><p>${esc(emptyHint())}</p>`;
  }
  emptyEl.append(box);
}

function emptyHint() {
  switch (state.view.kind) {
    case 'favorites':
      return 'Press the heart on any song to keep it here.';
    case 'played':
      return 'Songs you play in Stagehand show up here.';
    case 'stems':
      return 'Separated songs show up here. Pick a song and press Split stems.';
    case 'recent':
      return 'Songs added in the last 30 days show up here.';
    default:
      return '';
  }
}

export function render() {
  list = visibleSongs();
  titleEl.querySelector('h1').textContent = viewTitle();
  const total = list.length;
  const mins = Math.round(list.reduce((n, s) => n + (s.length || 0), 0) / 60);
  const hours = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  let sub = `${total.toLocaleString()} song${total === 1 ? '' : 's'}${total ? `, ${hours}` : ''}`;
  if (state.view.kind === 'rslist') {
    const missing = rsMissing(state.view.id).length;
    const who = state.rs && state.rs.profile ? state.rs.profile.name || 'your profile' : 'Rocksmith';
    sub = `${sub} in ${who}’s ${rsStockLabel(state.view.id)}${missing ? `. ${missing} more ${missing === 1 ? 'isn’t' : 'aren’t'} in your folders and ${missing === 1 ? 'stays' : 'stay'} in the list.` : ''}`;
  }
  titleEl.querySelector('.sub').textContent = sub;
  listBtn.setAttribute('aria-pressed', String(state.layout === 'list'));
  gridBtn.setAttribute('aria-pressed', String(state.layout === 'grid'));
  thead.hidden = state.layout !== 'list';
  rowsEl.hidden = state.layout !== 'list';
  gridEl.hidden = state.layout !== 'grid';
  renderWindow();
  renderEmpty();
}

function rebuild() {
  rowEls.forEach((el) => el.remove());
  rowEls.clear();
  tileEls.forEach((el) => el.remove());
  tileEls.clear();
  render();
}

// ---------------------------------------------------------- selection --
function idAt(target) {
  const el = target.closest('.row, .tile');
  return el ? el.dataset.id : null;
}

function selectClick(id, e) {
  const idx = list.findIndex((s) => s.id === id);
  if (e.shiftKey && state.anchor) {
    const a = list.findIndex((s) => s.id === state.anchor);
    if (a >= 0) {
      const [x, y] = a < idx ? [a, idx] : [idx, a];
      const ids = list.slice(x, y + 1).map((s) => s.id);
      setSelection(e.ctrlKey ? [...state.selection, ...ids] : ids, { focus: id });
      return;
    }
  }
  if (e.ctrlKey || e.metaKey) {
    const next = new Set(state.selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelection([...next], { anchor: id, focus: id });
    return;
  }
  setSelection([id], { anchor: id, focus: id });
}

let goTimer = 0;
function follow(go, id) {
  const s = state.songs.get(id);
  if (!s) return;
    if (go.dataset.part) {
      if (state.parts.has(go.dataset.part)) state.parts.delete(go.dataset.part);
      else state.parts.add(go.dataset.part);
      for (const c of partFilter.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(state.parts.has(PARTS[[...partFilter.children].indexOf(c)][0])));
      persistUi();
      bump();
      render();
      return;
    }
    const k = go.dataset.go;
    if (k === 'artist') return setView({ kind: 'artist', id: s.artist || '' });
    if (k === 'tuning') return setView({ kind: 'tuning', id: s.tuning || 'Unknown' });
    if (k === 'album') return setView({ kind: 'album', id: s.album || '', artist: s.artist || '' });
    if (k === 'year') return setView({ kind: 'year', id: s.year });
    if (k === 'acc') return setView({ kind: 'acc', id: accBand(s) });
}

scroller.addEventListener('click', (e) => {
  const id = idAt(e.target);
  if (!id) {
    if (e.target === scroller || e.target === rowsEl || e.target === gridEl) setSelection([]);
    return;
  }
  const star = e.target.closest('[data-star]');
  if (star) {
    e.stopPropagation();
    const s = state.songs.get(id);
    const n = Number(star.dataset.star);
    actions.rate(id, s.user && s.user.rating === n ? 0 : n);
    return;
  }
  // 3.8: click an artist, album, year, tuning, part or your best to list the songs that share it
  const go = e.target.closest('[data-go], [data-part]');
  if (go && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.detail === 1) {
    // wait a moment: a double-click on the same spot plays the song instead
    clearTimeout(goTimer);
    goTimer = setTimeout(() => follow(go, id), 260);
    selectClick(id, e);
    return;
  }
  if (e.target.closest('[data-play]')) {
    setSelection([id], { anchor: id, focus: id });
    actions.playSong(id, { autoplay: true });
    return;
  }
  selectClick(id, e);
});

scroller.addEventListener('dblclick', (e) => {
  clearTimeout(goTimer);
  const id = idAt(e.target);
  // double-click plays along: straight to the highway
  if (id && !e.target.closest('[data-star]')) actions.playAlong(id);
});

scroller.addEventListener('contextmenu', (e) => {
  const id = idAt(e.target);
  if (!id) return;
  e.preventDefault();
  if (!state.selection.has(id)) setSelection([id], { anchor: id, focus: id });
  actions.songMenu(e.clientX, e.clientY, [...state.selection]);
});

scroller.addEventListener('mouseover', (e) => {
  const star = e.target.closest('[data-star]');
  if (!star) return;
  const n = Number(star.dataset.star);
  star.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('hot', Number(b.dataset.star) <= n));
});

scroller.addEventListener('dragstart', (e) => {
  const id = idAt(e.target);
  if (!id) return;
  if (!state.selection.has(id)) setSelection([id], { anchor: id, focus: id });
  const ids = [...state.selection];
  e.dataTransfer.setData('application/x-stagehand-songs', JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'copy';
  const ghost = h('div.drag-ghost', { text: ids.length === 1 ? state.songs.get(id).title : `${ids.length} songs` });
  document.body.append(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 10);
  setTimeout(() => ghost.remove(), 0);
});

scroller.addEventListener('scroll', () => renderWindow(), { passive: true });
scroller.addEventListener('focus', refreshDecorations);
scroller.addEventListener('blur', refreshDecorations);

function moveFocus(delta, extend) {
  if (!list.length) return;
  const step = state.layout === 'grid' && Math.abs(delta) === 1 ? delta : delta;
  let idx = list.findIndex((s) => s.id === state.focus);
  idx = idx < 0 ? 0 : Math.max(0, Math.min(list.length - 1, idx + step));
  const id = list[idx].id;
  if (extend && state.anchor) {
    const a = list.findIndex((s) => s.id === state.anchor);
    const [x, y] = a < idx ? [a, idx] : [idx, a];
    setSelection(list.slice(x, y + 1).map((s) => s.id), { focus: id });
  } else {
    setSelection([id], { anchor: id, focus: id });
  }
  ensureVisible(idx);
}

function ensureVisible(idx) {
  if (state.layout === 'list') {
    const y = idx * ROW_H;
    if (y < scroller.scrollTop) scroller.scrollTop = y;
    else if (y + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = y + ROW_H - scroller.clientHeight;
  } else {
    const r = Math.floor(idx / geometry.cols);
    const y = r * geometry.tileH;
    if (y < scroller.scrollTop) scroller.scrollTop = y;
    else if (y + geometry.tileH > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = y + geometry.tileH - scroller.clientHeight + 8;
  }
}

export function revealSong(id) {
  const idx = list.findIndex((s) => s.id === id);
  if (idx >= 0) ensureVisible(idx);
}

scroller.addEventListener('keydown', (e) => {
  const pageRows = Math.max(1, Math.floor(scroller.clientHeight / (state.layout === 'list' ? ROW_H : geometry.tileH)));
  const cols = state.layout === 'grid' ? geometry.cols : 1;
  const k = e.key;
  if (k === 'ArrowDown') moveFocus(cols, e.shiftKey);
  else if (k === 'ArrowUp') moveFocus(-cols, e.shiftKey);
  else if (k === 'ArrowRight' && state.layout === 'grid') moveFocus(1, e.shiftKey);
  else if (k === 'ArrowLeft' && state.layout === 'grid') moveFocus(-1, e.shiftKey);
  else if (k === 'PageDown') moveFocus(pageRows * cols, e.shiftKey);
  else if (k === 'PageUp') moveFocus(-pageRows * cols, e.shiftKey);
  else if (k === 'Home') moveFocus(-list.length, e.shiftKey);
  else if (k === 'End') moveFocus(list.length, e.shiftKey);
  else if (k === 'Enter' && state.focus) actions.playSong(state.focus);
  else if (k === 'a' && (e.ctrlKey || e.metaKey)) setSelection(list.map((s) => s.id));
  else if (k === 'Delete' && state.view.kind === 'setlist' && state.selection.size) actions.removeFromSetlist(state.view.id, [...state.selection]);
  else if (k === 'Delete' && state.view.kind === 'rslist' && state.selection.size) actions.removeFromRocksmith(state.view.id, [...state.selection]);
  else if (k === 'ContextMenu' && state.selection.size) {
    const r = scroller.getBoundingClientRect();
    actions.songMenu(r.left + 80, r.top + 40, [...state.selection]);
  } else return;
  e.preventDefault();
});

export function focusList() {
  scroller.focus();
}

const ro = new ResizeObserver(debounce(() => renderWindow(), 16));
ro.observe(scroller);

on('library', render);
on('rocksmith', () => {
  if (state.view.kind === 'rslist') rebuild();
});
// 4.0.4: coming back to a list (after opening a song, or from another list) keeps your place
const savedTop = new Map();
const viewKey = () => `${state.layout}|${JSON.stringify(state.view)}`;
const shownNow = () => scroller.isConnected && scroller.clientHeight > 0;
scroller.addEventListener('scroll', () => {
  if (shownNow()) savedTop.set(viewKey(), scroller.scrollTop);
}, { passive: true });
function restoreTop() {
  const top = savedTop.get(viewKey()) || 0;
  if (scroller.scrollTop !== top) scroller.scrollTop = top;
  renderWindow();
}
on('view', () => {
  scroller.scrollTop = savedTop.get(viewKey()) || 0;
  rebuild();
  // the page may only just be shown again: set it once more after layout
  requestAnimationFrame(() => shownNow() && restoreTop());
});
on('page', () => requestAnimationFrame(() => shownNow() && restoreTop()));
on('selection', refreshDecorations);
on('playing', refreshDecorations);
on('stems', debounce(() => {
  // stem markers live inside rows; refresh just those cells
  for (const [id, el] of rowEls) {
    const s = state.songs.get(id);
    const cell = el.children[8];
    if (s && cell) cell.innerHTML = stemHtml(s);
  }
}, 120));
on('scan', () => {
  if (!list.length) renderEmpty();
});
on('search', () => {
  scroller.scrollTop = 0;
  savedTop.delete(viewKey());
  render();
});

buildHead();
render();
void hasPart;
void emit;
void loadLibrary;

// Your best changes when practice is logged: rebuild the visible rows and tiles.
on('best', () => {
  rowEls.forEach((el) => el.remove());
  rowEls.clear();
  tileEls.forEach((el) => el.remove());
  tileEls.clear();
  render();
});
