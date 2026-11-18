import { badgesHtml } from './songbadges.js';
import { decorativeImage } from './menu-art.js';
/**
 * Discover: search MusicBrainz, see what each artist's albums have that your
 * library doesn't, keep a Wanted list, and import what you download.
 *
 * Stagehand never searches or downloads from CustomsForge itself (their rules
 * forbid apps doing that). It opens the site in your browser with the search
 * copied, then picks the download up from your Downloads folder.
 */
import { did } from './rewards.js';
import { api } from './api.js';
import { state, on, emit, setView, rsListIds, rsListLabel, loadRocksmith, upsertSongs, loadLibrary, missingParts } from './store.js';
import { setJob } from './activity.js';
import { artImg, harvest } from './artkeep.js';
import { h, icon, esc, toast, showMenu, fmtDuration, fmtDate, fmtDateTime, modal, debounce } from './ui.js';
import * as actions from './actions.js';

const root = document.getElementById('discover');
const D = {
  query: '',
  results: null,
  searching: false,
  error: null,
  recent: [],
  page: null, // artist page data
  pageKey: '',
  loadingArtist: false,
  progress: null,
  gaps: null,
  gapsFilter: localStorage.getItem('stagehand.gapsFilter') || 'all',
  gapsSort: localStorage.getItem('stagehand.gapsSort') || 'missing',
  wanted: [],
  imports: null,
  sel: new Map(), // key -> {artist,title,album,year}
  missingOnly: localStorage.getItem('stagehand.missingOnly') === '1',
  // 4.23: which tracks an artist page shows: all | missing | wanted | owned | parts (in the library but missing a part)
  wantView: localStorage.getItem('stagehand.wantView') || 'queue',
  show: localStorage.getItem('stagehand.dvShow') || (localStorage.getItem('stagehand.missingOnly') === '1' ? 'missing' : 'all'),
  cfOpened: false,
  run: null, // 4.0.4: Get songs: { current, done, skipped: Set, total }; 4.25: kind 'wanted' | 'update', unavailable, official
  // 4.25: Wanted's two lists (to find, not available), its filter, the run-finished card, Official DLC, Updates
  wantTab: localStorage.getItem('stagehand.wantTab') === 'unavailable' ? 'unavailable' : 'find',
  wantFilter: '',
  summary: null,
  official: null,
  offFilter: '',
  updates: { rows: [], checkedAt: 0 },
  lastId: null,
};
state.discover = D;

const GELS = ['#ff6b3d', '#8c7bff', '#ff4d8d', '#33c8e0', '#9bdb5a', '#ffb547'];
const isDiscover = () => state.view.kind === 'discover';
// 4.7: Discover stays the current list when you go to another page; it only draws while it shows
const shown = () => isDiscover() && state.page === 'discover';
const sub = () => (isDiscover() ? state.view.id : null);
const keyOf = (artist, title) => `${String(artist).toLowerCase()}|${String(title).toLowerCase()}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const store = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch (_) {}
};

function hash(s) {
  let x = 0;
  for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(x);
}

function initials(name) {
  const words = String(name || '?')
    .replace(/^the\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0] || '?')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

function avatar(name, cls = '') {
  const el = h(`div.avatar${cls ? '.' + cls : ''}`, { text: initials(name), 'aria-hidden': 'true' });
  el.style.setProperty('--gel', GELS[hash(name) % GELS.length]);
  return el;
}

function cover(groupId, title, cls = '') {
  const el = h(`div.cover${cls ? '.' + cls : ''}`, { 'aria-hidden': 'true' });
  el.style.setProperty('--gel', GELS[hash(title) % GELS.length]);
  el.append(h('span', { text: initials(title) }));
  if (groupId) {
    // 4.7: a cover that has loaded before moves over from the last draw (no reload, no blink)
    const img = artImg(api.coverUrl(groupId, cls.includes('lg') ? 500 : 250), { alt: '', loading: 'lazy', decoding: 'async' });
    if (img.complete && img.naturalWidth > 1) el.classList.add('has-img');
    img.onerror = () => img.remove();
    img.onload = () => (img.naturalWidth <= 1 ? img.remove() : el.classList.add('has-img'));
    el.append(img);
  }
  return el;
}

function bar(have, total, cls = '') {
  const pct = total ? Math.round((have / total) * 100) : 0;
  const el = h(`div.meter${cls ? '.' + cls : ''}`, { role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(have), title: `${have} of ${total}` });
  const i = h('i');
  i.style.width = `${pct}%`;
  if (pct === 100) el.classList.add('full');
  el.append(i);
  return el;
}

function head(title, subText, tools = [], { kicker } = {}) {
  return h(
    'header.dv-head',
    null,
    h('div.dv-title', null, kicker ? h('div.kicker', { text: kicker }) : null, h('h1', { text: title }), subText ? h('div.sub', { html: subText }) : null),
    tools.length ? h('div.dv-tools', null, ...tools) : null
  );
}

function btn(label, { iconName, cls = '', onClick, title, disabled } = {}) {
  const b = h(`button.btn${cls ? '.' + cls : ''}`, { type: 'button', title, disabled, html: `${iconName ? icon(iconName) : ''}<span>${esc(label)}</span>` });
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function iconBtn(name, title, onClick, cls = '') {
  const b = h(`button.icon-btn${cls ? '.' + cls : ''}`, { type: 'button', title, 'aria-label': title, html: icon(name) });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

function emptyBox(title, text, actionsEls = []) {
  return h('div.dv-empty.card', null, decorativeImage('empty-discover'), h('h2', { text: title }), h('p', { html: text }), actionsEls.length ? h('div.actions', null, ...actionsEls) : null);
}

// ------------------------------------------------------------ navigation --
export function open(id = 'search', extra = {}) {
  setView({ kind: 'discover', id, ...extra });
}

export function openArtist({ id = null, name = '' }, from = sub() === 'artist' ? state.view.from : sub() || 'search') {
  open('artist', { artist: { id, name }, from });
}

/** Titlebar search box, while Discover is open. */
let searchTimer = null;
let searchSeq = 0;
export function setQuery(q, { now = false } = {}) {
  D.query = q;
  if (sub() !== 'search') open('search');
  clearTimeout(searchTimer);
  if (q.trim().length < 2) {
    searchSeq++;
    D.results = null;
    D.searching = false;
    D.error = null;
    render();
    return;
  }
  D.searching = true;
  renderSearchStatus();
  searchTimer = setTimeout(runSearch, now ? 0 : 650);
}

/** From the library's "no songs match": look the same words up online. */
export function searchOnline(q) {
  const box = document.getElementById('search');
  D.query = q;
  open('search');
  box.value = q;
  setQuery(q, { now: true });
}

async function runSearch() {
  const q = D.query.trim();
  const seq = ++searchSeq;
  D.searching = true;
  render();
  try {
    const r = await api.discover.search(q);
    if (seq !== searchSeq) return;
    D.results = r;
    D.error = null;
  } catch (err) {
    if (seq !== searchSeq) return;
    D.error = err.message;
  }
  D.searching = false;
  D.recent = await api.discover.recent().catch(() => D.recent);
  if (seq === searchSeq) render();
}

// -------------------------------------------------------------- selection --
function toggleSel(item, on) {
  const k = keyOf(item.artist, item.title);
  if (on) D.sel.set(k, item);
  else D.sel.delete(k);
  renderSelBar();
}

function checkbox(item) {
  const k = keyOf(item.artist, item.title);
  const c = h('input.check', { type: 'checkbox', 'aria-label': `Select ${item.title}` });
  c.checked = D.sel.has(k);
  c.addEventListener('click', (e) => e.stopPropagation());
  c.addEventListener('change', () => toggleSel(item, c.checked));
  return c;
}

const selBar = h('div.dv-selbar', { hidden: true, role: 'region', 'aria-label': 'Selected songs' });
function renderSelBar() {
  selBar.innerHTML = '';
  // 4.25: songs ticked on Wanted, Not available or Official DLC
  const scope = isDiscover() ? pickScope() : '';
  if (scope && scope === pick.scope && pick.ids.size) {
    selBar.hidden = false;
    const n = pick.ids.size;
    selBar.append(h('span.count', { text: `${plural(n, 'song')} selected` }));
    if (scope === 'find') {
      selBar.append(
        btn('Remove', { cls: 'soft', iconName: 'x', title: 'Take them off Wanted', onClick: () => unwant([...pick.ids]) }),
        btn('Mark not available', { cls: 'soft', iconName: 'clock', title: 'Nothing on CustomsForge: keep them on Not available', onClick: () => setStatus([...pick.ids], 'unavailable') }),
        btn('Copy as a list', { cls: 'soft', iconName: 'copy', onClick: () => copyList(pickedWanted()) })
      );
    } else if (scope === 'unavailable') {
      selBar.append(
        btn('Move back to Wanted', { cls: 'primary', iconName: 'repeat', onClick: () => setStatus([...pick.ids], 'wanted') }),
        btn('Remove', { cls: 'soft', iconName: 'x', onClick: () => unwant([...pick.ids]) })
      );
    } else if (scope === 'official') {
      const mine = ((D.official && D.official.songs) || []).filter((s) => pick.ids.has(s.key) && s.wantedId).map((s) => s.wantedId);
      selBar.append(btn('Request', { cls: 'primary', iconName: 'music', title: 'Ask Noisewater Labs for these songs', onClick: () => requestDialog(pickedOfficial()) }));
      if (mine.length) selBar.append(btn('Remove from my list', { cls: 'soft', iconName: 'x', onClick: () => unwant(mine).then(loadOfficial) }));
    }
    selBar.append(btn('Clear', { cls: 'soft', onClick: () => pickClear() }));
    return;
  }
  selBar.hidden = !D.sel.size || !isDiscover();
  if (selBar.hidden) return;
  const items = [...D.sel.values()];
  selBar.append(
    h('span.count', { text: `${plural(items.length, 'song')} selected` }),
    btn('Add to Wanted', { iconName: 'star', cls: 'primary', onClick: () => want(items) }),
    btn('Copy as a list', { iconName: 'copy', cls: 'soft', onClick: () => copyList(items) }),
    btn('Clear', { cls: 'soft', onClick: () => clearSel() })
  );
  // Keep row checkboxes in step (e.g. after "Select missing").
  for (const c of root.querySelectorAll('input.check[data-key]')) c.checked = D.sel.has(c.dataset.key);
}

function clearSel() {
  D.sel.clear();
  for (const c of root.querySelectorAll('input.check')) c.checked = false;
  renderSelBar();
}

// ------------------------------------------------- 4.25: ticking many at once --
// Wanted, Not available and Official DLC rows have tick boxes: shift-click ticks a run of them,
// Select all ticks every song showing (after the filter), and a bar says what to do with them.
const pick = { scope: '', ids: new Set(), order: [], anchor: null };
function pickScope() {
  const id = sub();
  if (id === 'wanted') return D.wantTab === 'unavailable' ? 'unavailable' : 'find';
  if (id === 'official') return 'official';
  return '';
}

function pickBox(id, label) {
  const c = h('input.check.pick', { type: 'checkbox', 'aria-label': `Select ${label}` });
  c.dataset.pick = id;
  c.checked = pick.ids.has(id);
  pick.order.push(id);
  c.addEventListener('click', (e) => {
    e.stopPropagation();
    pickClick(id, c.checked, e.shiftKey);
  });
  return c;
}

/** A tick box for a group (an artist): ticks all of its songs. */
function pickGroup(ids, label) {
  const c = h('input.check.pick-group', { type: 'checkbox', 'aria-label': `Select every song by ${label}`, title: `Select every song by ${label}` });
  c._ids = ids;
  c.addEventListener('click', (e) => {
    e.stopPropagation();
    pickSet(ids, c.checked);
  });
  return c;
}

function pickClick(id, on, shift) {
  if (shift && pick.anchor && pick.order.includes(pick.anchor) && pick.order.includes(id)) {
    const a = pick.order.indexOf(pick.anchor);
    const b = pick.order.indexOf(id);
    for (const x of pick.order.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? pick.ids.add(x) : pick.ids.delete(x);
  } else if (on) pick.ids.add(id);
  else pick.ids.delete(id);
  pick.anchor = id;
  syncPicks();
}

function pickSet(ids, on) {
  for (const x of ids) on ? pick.ids.add(x) : pick.ids.delete(x);
  syncPicks();
}

function pickClear() {
  pick.ids.clear();
  pick.anchor = null;
  syncPicks();
}

/** Tick boxes, group boxes and Select all follow the picked set, without drawing the page again. */
function syncPicks() {
  for (const c of root.querySelectorAll('input.pick')) c.checked = pick.ids.has(c.dataset.pick);
  for (const c of root.querySelectorAll('input.pick-group')) {
    const n = c._ids.filter((x) => pick.ids.has(x)).length;
    c.checked = n > 0 && n === c._ids.length;
    c.indeterminate = n > 0 && n < c._ids.length;
  }
  for (const r of root.querySelectorAll('[data-pick-row]')) r.classList.toggle('picked', pick.ids.has(r.dataset.pickRow));
  const all = root.querySelector('.pick-all');
  if (all) {
    const vis = pick.order.filter((x) => root.querySelector(`input.pick[data-pick="${CSS.escape(x)}"]`));
    const allOn = vis.length > 0 && vis.every((x) => pick.ids.has(x));
    all.querySelector('span').textContent = allOn ? 'Select none' : `Select all (${vis.length})`;
    all.setAttribute('aria-pressed', String(allOn));
  }
  renderSelBar();
}

function selectAllButton() {
  const b = btn('Select all', { cls: 'small soft pick-all', iconName: 'check' });
  b.addEventListener('click', () => {
    const vis = pick.order.filter((x) => root.querySelector(`input.pick[data-pick="${CSS.escape(x)}"]`));
    const allOn = vis.length > 0 && vis.every((x) => pick.ids.has(x));
    pickSet(vis, !allOn);
  });
  return b;
}

/** Clicking a row (not one of its buttons or links) ticks it; shift-click ticks a run. */
function pickRow(row, id) {
  row.dataset.pickRow = id;
  if (pick.ids.has(id)) row.classList.add('picked');
  row.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, select, textarea')) return;
    pickClick(id, !pick.ids.has(id), e.shiftKey);
  });
}

function pickedWanted() {
  return D.wanted.filter((w) => pick.ids.has(w.id));
}

async function setStatus(ids, status) {
  if (!ids.length) return;
  const was = D.run && D.run.current ? D.run.current.id : null;
  D.wanted = (await api.discover.setStatus(ids, status).catch((err) => (toast({ title: 'Couldn’t change that', message: err.message, kind: 'err' }), null))) || D.wanted;
  for (const id of ids) pick.ids.delete(id);
  emit('discover-wanted');
  if (status === 'wanted') {
    const stuck = D.wanted.filter((w) => ids.includes(w.id) && w.status === 'official').length;
    if (stuck) toast({ title: `${plural(stuck, 'song')} stayed on Official DLC`, message: 'Paid Rocksmith songs can’t be downloaded, so they can’t be wanted.', kind: 'info' });
  }
  if (D.run && was && ids.includes(was) && status !== 'wanted') {
    if (status === 'unavailable') D.run.unavailable = (D.run.unavailable || 0) + 1;
    await runNext();
  }
  render();
}

// ----------------------------------------------------------------- wanted --
async function want(items) {
  const r = await api.discover.addWanted(items.map(({ artist, title, album, year }) => ({ artist, title, album, year })));
  D.wanted = r.wanted;
  clearSel();
  emit('discover-wanted');
  // 4.25: official DLC can't be wanted (it can't be downloaded): said, with a way to ask for it
  const off = r.official ? `${plural(r.official, 'song')} ${r.official === 1 ? 'is' : 'are'} official DLC (paid Rocksmith songs), so not added. Ask for ${r.official === 1 ? 'it' : 'them'} on Official DLC.` : '';
  toast({
    title: r.added ? `Added ${plural(r.added, 'song')} to Wanted` : r.official ? 'Official DLC can’t be wanted' : 'Already in your Wanted list',
    message: [r.added ? 'Find them on CustomsForge from the Wanted page. Downloads are imported automatically.' : '', off].filter(Boolean).join(' '),
    actions: [r.added ? { label: 'Open Wanted', onClick: () => open('wanted') } : null, r.official ? { label: 'Official DLC', onClick: () => open('official') } : null].filter(Boolean),
  });
  render();
}

async function unwant(ids) {
  D.wanted = await api.discover.removeWanted(ids);
  for (const id of ids) pick.ids.delete(id);
  emit('discover-wanted');
  if (D.run && D.run.current && ids.includes(D.run.current.id)) await runNext();
  render();
}

function wantedFor(artist, title) {
  const k = keyOf(artist, title);
  return D.wanted.find((w) => keyOf(w.artist, w.title) === k && w.status === 'wanted') || null;
}

function copyText(items) {
  return items.map((i) => `${i.artist} - ${i.title}`).join('\n');
}

async function copyList(items) {
  await api.discover.copy(copyText(items));
  toast({ title: `Copied ${plural(items.length, 'song')}`, message: 'One “Artist - Title” per line.', kind: 'info' });
}

// ------------------------------------------------------------ CustomsForge --
// 4.12: the song finder: CustomsForge in Stagehand's own window, which types the song into
// the site's search box and puts what you download straight into your library (finder.js).
const hasFinder = () => !!(api.discover && api.discover.finder);
async function openFinder(item) {
  const left = D.wanted.filter((w) => w.status === 'wanted').length;
  const r = await api.discover.finder({ id: item.id, artist: item.artist, title: item.title, left: D.run ? runLeft().length : left, ...(item.mode ? { mode: item.mode } : {}) }).catch(() => null);
  return !!(r && (r.ok || r.open));
}

function explainCustomsForge() {
  if (hasFinder()) return explainFinder();
  try {
    if (localStorage.getItem('stagehand.cfExplained')) return Promise.resolve(true);
  } catch (_) {}
  return new Promise((resolve) => {
    let go = false;
    const ok = btn('Open CustomsForge', { cls: 'primary', iconName: 'external' });
    const cancel = btn('Cancel', { cls: 'ghost' });
    const m = modal({
      title: 'Finding songs on CustomsForge',
      body: h(
        'div.cf-explain',
        null,
        h('p', { text: 'Stagehand opens CustomsForge’s Ignition site in your browser and copies the song for you. Click Ignition’s search box, press Ctrl+V, then download the PC version.' }),
        h(
          'ol.how-steps',
          null,
          h('li', null, h('b', { text: 'Search' }), h('span', { text: 'Paste the copied “Artist Title” into Ignition.' })),
          h('li', null, h('b', { text: 'Download' }), h('span', { text: 'Sign in and download it. Pick PC when there’s a choice.' })),
          h('li', null, h('b', { text: 'Done' }), h('span', { text: 'With Watch Downloads on, Stagehand moves it into Rocksmith and ticks it off Wanted.' }))
        ),
        h('p.fine', { text: 'CustomsForge doesn’t allow apps to search or download for you, so that part stays in your browser.' })
      ),
      footer: [cancel, ok],
      onClose: () => resolve(go),
    });
    ok.onclick = () => {
      go = true;
      store('stagehand.cfExplained', '1');
      m.close();
    };
    cancel.onclick = () => m.close();
  });
}

function explainFinder() {
  try {
    if (localStorage.getItem('stagehand.finderExplained')) return Promise.resolve(true);
  } catch (_) {}
  return new Promise((resolve) => {
    let go = false;
    const ok = btn('Open the song finder', { cls: 'primary', iconName: 'search' });
    const cancel = btn('Cancel', { cls: 'ghost' });
    const m = modal({
      title: 'Finding songs on CustomsForge',
      body: h(
        'div.cf-explain',
        null,
        h('p', { text: 'Stagehand opens CustomsForge in its own window and types the song into the search box for you.' }),
        h(
          'ol.how-steps',
          null,
          h('li', null, h('b', { text: 'Sign in' }), h('span', { text: 'The first time, sign in to CustomsForge in that window. It remembers you.' })),
          h('li', null, h('b', { text: 'Download' }), h('span', { text: 'Pick the song from the results and download the PC version.' })),
          h('li', null, h('b', { text: 'Play' }), h('span', { text: 'It goes straight into your library and comes off Wanted. Next song searches for the next one.' }))
        ),
        h('p.fine', { text: 'Stagehand only searches when you ask and never downloads by itself: the clicks on the site stay yours.' })
      ),
      footer: [cancel, ok],
      onClose: () => resolve(go),
    });
    ok.onclick = () => {
      go = true;
      store('stagehand.finderExplained', '1');
      m.close();
    };
    cancel.onclick = () => m.close();
  });
}

export async function findOnCF(item, { open: openSite = true } = {}) {
  const text = `${item.artist} ${item.title}`.trim();
  if (hasFinder()) {
    if (!(await explainFinder())) return;
    if (await openFinder(item)) {
      markSearched(item);
      return;
    }
  }
  if (openSite && !(await explainCustomsForge())) return;
  await api.discover.customsforge({ text, open: openSite });
  if (openSite) D.cfOpened = true;
  markSearched(item);
  toast({
    title: openSite ? 'Opened CustomsForge in your browser' : 'Copied',
    message: `“${text}” is copied. Click Ignition’s search box and press Ctrl+V.`,
    kind: 'info',
    timeout: 7000,
  });
}

/**
 * 4.23: Find a better version of a song you have (bass only, no words, no audio…): the finder opens
 * on its artist and title. Nothing is replaced: what you download is added beside the copy you
 * have, and you choose which to keep (the duplicates check in Songs shows both).
 */
export async function findBetter(song, missing = []) {
  if (!song) return;
  const item = { id: `better:${song.id}`, artist: song.artist || '', title: song.title || '' };
  toast({
    title: `Looking for a better ${song.title || 'version'}`,
    message: `${missing.length ? `Wanted: ${missing.join(', ')}. ` : ''}Your copy stays as it is; a new download is added beside it.`,
    kind: 'info',
    timeout: 7000,
  });
  await findOnCF(item);
}

function searchedMap() {
  try {
    return JSON.parse(localStorage.getItem('stagehand.cfSearched') || '{}');
  } catch (_) {
    return {};
  }
}

function markSearched(item) {
  const m = searchedMap();
  m[keyOf(item.artist, item.title)] = Date.now();
  const entries = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 500);
  store('stagehand.cfSearched', JSON.stringify(Object.fromEntries(entries)));
  if (sub() === 'wanted') render();
}

async function findNext() {
  const left = D.wanted.filter((w) => w.status === 'wanted');
  if (!left.length) return;
  const seen = searchedMap();
  // The least recently searched song comes up next.
  const next = left.slice().sort((a, b) => (seen[keyOf(a.artist, a.title)] || 0) - (seen[keyOf(b.artist, b.title)] || 0))[0];
  await findOnCF(next, { open: hasFinder() || !D.cfOpened });
}

// ------------------------------------------------------------- get songs --
// 4.0.4: one song after another. Stagehand turns on Watch Downloads, opens CustomsForge
// once and copies the first song; each time a download ticks it off, the next one is
// copied and a Windows notice says so. The user only searches (Ctrl+V) and downloads.
/** 4.25: the updates as songs for the finder (looking for a newer version of a song you have). */
function updateItems() {
  return ((D.updates && D.updates.rows) || []).map((u) => ({ id: `upd:${u.key}`, key: u.key, artist: u.artist, title: u.title, mode: 'update', songId: u.songId }));
}

function runLeft() {
  const skipped = D.run ? D.run.skipped : new Set();
  if (D.run && D.run.kind === 'update') return updateItems().filter((u) => !skipped.has(u.id));
  const seen = searchedMap();
  return D.wanted
    .filter((w) => w.status === 'wanted' && !skipped.has(w.id))
    .sort((a, b) => (seen[keyOf(a.artist, a.title)] || 0) - (seen[keyOf(b.artist, b.title)] || 0) || (a.addedAt || 0) - (b.addedAt || 0));
}

function notify(title, body) {
  try {
    if (document.hasFocus() || typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') new Notification(title, { body, silent: false });
    else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && new Notification(title, { body }));
  } catch (_) {}
}

async function runCopy(item, { open: openSite = false } = {}) {
  if (hasFinder() && (await openFinder(item))) {
    markSearched(item);
    return;
  }
  const text = `${item.artist} ${item.title}`.trim();
  await api.discover.customsforge({ text, open: openSite });
  if (openSite) D.cfOpened = true;
  markSearched(item);
}

export async function startRun() {
  const left = runLeft();
  if (!left.length) return;
  if (!(await explainCustomsForge())) return;
  if (!D.imports || !D.imports.watch) {
    try {
      D.imports = await api.imports.configure({ watch: true });
      emit('discover-imports');
    } catch (_) {}
  }
  D.summary = null;
  D.run = { kind: 'wanted', current: left[0], done: 0, unavailable: 0, official: 0, skipped: new Set(), total: left.length };
  await runCopy(left[0], { open: true });
  emit('discover-run');
  if (sub() === 'wanted') render();
  if (hasFinder()) toast({ title: 'Getting your songs', message: `The song finder is looking for “${left[0].artist} ${left[0].title}”. Download the PC version there; the next song comes up when it arrives.`, kind: 'info', timeout: 10000 });
  else toast({ title: 'Getting your songs', message: `“${left[0].artist} ${left[0].title}” is copied. In CustomsForge, click the search box, press Ctrl+V and download the PC version. Stagehand copies the next song when it arrives.`, kind: 'info', timeout: 10000 });
}

/** 4.25: Get updates: the songs with newer versions, one after another, through the finder. */
export async function startUpdates() {
  const left = updateItems();
  if (!left.length || (D.run && D.run.kind === 'wanted')) return;
  if (!(await explainCustomsForge())) return;
  D.summary = null;
  D.run = { kind: 'update', current: left[0], done: 0, unavailable: 0, official: 0, skipped: new Set(), total: left.length };
  await runCopy(left[0], { open: true });
  emit('discover-run');
  render();
}

/**
 * 4.25: the run is over. The finder celebrates and closes itself; the page keeps a short card
 * (got, not available, official, still to find) instead of a toast that goes away.
 */
function finishRun(run) {
  const left = D.wanted.filter((w) => w.status === 'wanted').length;
  const upd = run.kind === 'update';
  D.summary = { kind: upd ? 'update' : 'wanted', got: run.done, unavailable: run.unavailable || 0, official: run.official || 0, skipped: run.skipped.size, left: upd ? updateItems().length : left, at: Date.now() };
  const title = upd ? 'Updates done' : run.done ? 'All done' : 'Nothing left to look for';
  const text = upd
    ? `${plural(run.done, 'song')} updated${D.summary.left ? `, ${D.summary.left} still to get` : ''}.`
    : [`Got ${run.done}`, run.unavailable ? `${run.unavailable} not available` : '', run.official ? `${run.official} official DLC` : '', left ? `${left} still to find` : ''].filter(Boolean).join(' · ');
  if (hasFinder() && api.discover.finderDone) Promise.resolve(api.discover.finderDone({ title, text })).catch(() => {});
  notify(`Stagehand: ${title.toLowerCase()}`, text);
}

export function stopRun() {
  if (!D.run) return;
  D.run = null;
  emit('discover-run');
  if (sub() === 'wanted') render();
}

async function runNext({ skip = false } = {}) {
  const run = D.run;
  if (!run) return;
  if (skip && run.current) run.skipped.add(run.current.id);
  const next = runLeft()[0];
  if (!next) {
    D.run = null;
    finishRun(run);
    emit('discover-run');
    if (sub() === 'wanted' || sub() === 'updates') render();
    return;
  }
  run.current = next;
  await runCopy(next);
  emit('discover-run');
  if (sub() === 'wanted') render();
}

/** After an import: when the song we're on came in, move on to the next. */
async function runAfterImport() {
  const run = D.run;
  if (!run || !run.current || run.kind === 'update') return; // (updates move on from the finder's download events)
  const now = D.wanted.find((w) => w.id === run.current.id);
  if (now && now.status === 'wanted') return;
  if (!now) return runNext(); // taken off the list
  run.done++;
  const got = run.current;
  await runNext();
  if (D.run && D.run.current) {
    const c = D.run.current;
    notify(`Got “${got.title}”`, hasFinder() ? `Next: ${c.artist} – ${c.title}. The song finder is looking for it.` : `Next: ${c.artist} – ${c.title}. It’s copied: click CustomsForge’s search box and press Ctrl+V.`);
  }
}

function runBar() {
  const run = D.run;
  if (!run) return null;
  const c = run.current;
  const left = runLeft().length;
  const bar = h('div.get-run', { role: 'status' });
  bar.append(
    h('span.status-dot.on'),
    h(
      'div.get-run-text',
      null,
      h('b', { text: c ? `Now: ${c.artist} – ${c.title}` : 'Getting songs' }),
      h('span', { text: `${hasFinder() ? 'In the song finder, download the PC version.' : 'Copied: click CustomsForge’s search box, press Ctrl+V, download the PC version.'} ${run.done} in so far, ${plural(left, 'song')} to go.` })
    ),
    ...(hasFinder()
      ? [btn('Show the finder', { cls: 'small ghost', iconName: 'search', onClick: () => c && runCopy(c) })]
      : [btn('Copy again', { cls: 'small ghost', iconName: 'copy', onClick: () => c && runCopy(c) }), btn('Open CustomsForge', { cls: 'small ghost', iconName: 'external', onClick: () => c && runCopy(c, { open: true }) })]),
    btn('Skip', { cls: 'small', title: 'Can’t find this one: go to the next', onClick: () => runNext({ skip: true }) }),
    btn('Stop', { cls: 'small ghost', onClick: () => stopRun() })
  );
  return bar;
}

// ------------------------------------------------------------------ rows --
function statusChip(t, { quietMissing = false } = {}) {
  if (t.have) {
    // 4.5: what you've done with it, at a glance
    const song = t.songId ? state.songs.get(t.songId) : null;
    // 4.23: in the library but missing a part (bass only, no words…): said, with a way to a better version
    const gaps = song ? missingParts(song).filter((x) => x !== 'words') : [];
    if (gaps.length) return h('span.state.attn', { title: `In your library, but it has no ${gaps.join(' or ')}`, html: `${icon('info')}<span>In library · no ${esc(gaps.join(', '))}</span>` });
    return h('span.state.have', { html: `${icon('check')}<span>In your library</span>${song ? badgesHtml(song) : ''}` });
  }
  if (D.run && D.run.current && keyOf(D.run.current.artist, D.run.current.title) === keyOf(t.artist || (D.page && D.page.artist && D.page.artist.name) || '', t.title)) return h('span.state.now', { html: `${icon('search')}<span>Looking for it now</span>` });
  if (t.wanted) return h('span.state.want', { html: `${icon('star', 'fill')}<span>Wanted</span>` });
  // 4.25: paid Rocksmith songs can't be downloaded; songs CustomsForge had nothing for
  if (t.official) return h('span.state.official', { title: 'A paid Rocksmith song: it can’t be downloaded, so it can’t be wanted', html: `${icon('music')}<span>Official DLC</span>` });
  if (t.unavailable) return h('span.state.unavail', { title: 'CustomsForge had nothing for it last time', html: `${icon('clock')}<span>Not available</span>` });
  return quietMissing ? h('span.state.miss.quiet', { html: `${icon('x')}<span>Missing</span>` }) : h('span.state.miss', { html: `${icon('x')}<span>Not in your library</span>` });
}

function rowActions(t, item) {
  const box = h('div.acts');
  // 4.0: say what each button does, in words (the star alone was easy to miss)
  if (t.have && t.songId) {
    const play = btn('Play', { cls: 'small glow-primary', iconName: 'play', title: 'Open it on the highway' });
    play.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.playAlong(t.songId);
    });
    box.append(play);
    box.append(
      iconBtn('library', 'Show in library', () => {
        setView({ kind: 'all' });
        emit('reveal', t.songId);
      })
    );
    const song = state.songs.get(t.songId);
    const gaps = song ? missingParts(song).filter((x) => x !== 'words') : [];
    if (gaps.length) box.append(iconBtn('search', `Find a better version (this one has no ${gaps.join(' or ')})`, () => findBetter(song, gaps)));
  } else if (t.official) {
    // 4.25: official DLC: ask Noisewater Labs for it instead
    const rq = btn('Request', { cls: 'small soft', iconName: 'music', title: 'A paid Rocksmith song: ask Noisewater Labs for it' });
    rq.addEventListener('click', (e) => {
      e.stopPropagation();
      requestDialog([{ artist: item.artist, title: item.title }]);
    });
    box.append(rq);
  } else {
    const w = wantedFor(item.artist, item.title);
    const wb = btn(w ? 'Wanted' : 'Want it', { cls: w ? 'small soft want-on' : 'small', iconName: w ? 'check' : 'plus', title: w ? 'On your Wanted list: click to take it off' : 'Add it to your Wanted list, to get it later' });
    wb.addEventListener('click', (e) => {
      e.stopPropagation();
      w ? unwant([w.id]) : want([item]);
    });
    box.append(wb);
    box.append(iconBtn('external', 'Find on CustomsForge', () => findOnCF(item)));
  }
  return box;
}

function songRow(t, item, { showArtist = true, num = null, quietMissing = false } = {}) {
  const row = h(`div.dv-row${t.have ? '.have' : ''}`);
  const sel = h('div.c-sel');
  if (t.official && !t.have) sel.append(h('span.tick.off', { html: icon('music'), title: 'Official DLC' }));
  else if (!t.have) {
    const c = checkbox(item);
    c.dataset.key = keyOf(item.artist, item.title);
    sel.append(c);
  } else sel.append(h('span.tick', { html: icon('check') }));
  row.append(sel);
  if (num !== null) row.append(h('div.c-num', { text: String(num) }));
  const main = h('div.c-main', null, h('div.t', { text: t.title }), item.album || item.year ? h('div.s', { text: [item.album, item.year].filter(Boolean).join(' · ') }) : null);
  row.append(main);
  if (showArtist) {
    const a = h('button.c-artist.dv-link', { type: 'button', text: item.artist, title: `Open ${item.artist}` });
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      openArtist({ id: item.artistId || null, name: item.artist });
    });
    row.append(a);
  }
  row.append(h('div.c-len', { text: t.length ? fmtDuration(t.length / 1000) : '' }), h('div.c-state', null, statusChip(t, { quietMissing })), rowActions(t, item));
  if (!t.have && !t.official) {
    row.addEventListener('click', () => {
      const c = row.querySelector('input.check');
      if (c) {
        c.checked = !c.checked;
        toggleSel(item, c.checked);
      }
    });
  } else if (t.songId) {
    row.addEventListener('dblclick', () => actions.playAlong(t.songId));
  }
  return row;
}

// ---------------------------------------------------------------- search --
function libraryArtists() {
  const m = new Map();
  for (const s of state.songs.values()) if (s.artist) m.set(s.artist, (m.get(s.artist) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function renderSearch(page) {
  const q = D.query.trim();
  page.append(
    head(
      q ? `Results for “${q}”` : 'Search',
      q ? 'From MusicBrainz, the open music encyclopedia. Tick songs you don’t have to collect them in Wanted.' : 'Find any artist or song on MusicBrainz and see what you already have.',
      [],
      { kicker: 'Discover' }
    )
  );
  if (!q) {
    const hero = h('div.dv-hero.card');
    hero.append(
      h('div.hero-icon', { html: icon('search') }),
      h('h2', { text: 'Type an artist or song in the search box above' }),
      h('p', { html: 'Try <b>an artist’s name</b>, <b>a song title</b>, or <b>Artist - Song</b>. Stagehand shows what you already have and what you’re missing.' })
    );
    page.append(hero);
    if (D.recent.length) {
      const chips = h('div.chips');
      for (const r of D.recent) {
        const c = h('button.chip', { type: 'button', text: r });
        c.onclick = () => {
          document.getElementById('search').value = r;
          setQuery(r, { now: true });
        };
        chips.append(c);
      }
      const clear = h('button.dv-link.small', { type: 'button', text: 'Clear' });
      clear.onclick = async () => {
        await api.discover.clearRecent();
        D.recent = [];
        render();
      };
      page.append(h('section.dv-section', null, h('h3', null, h('span', { text: 'Recent searches' }), clear), chips));
    }
    const top = libraryArtists().slice(0, 12);
    if (top.length) {
      const grid = h('div.artist-cards.compact');
      for (const [name, n] of top) grid.append(artistCard({ name, owned: n, gap: gapFor(name) }));
      page.append(h('section.dv-section', null, h('h3', null, h('span', { text: 'Your artists' }), h('span.hint', { text: 'See what’s missing from their albums' })), grid));
    }
    return;
  }
  if (D.error) {
    page.append(emptyBox('Search didn’t work', esc(D.error), [btn('Try again', { onClick: () => setQuery(D.query, { now: true }) })]));
    return;
  }
  if (!D.results || D.results.query !== q) {
    page.append(h('div.dv-loading', null, h('div.spin'), h('span', { text: 'Searching MusicBrainz…' })));
    return;
  }
  const r = D.results;
  if (!r.artists.length && !r.songs.length) {
    page.append(emptyBox('Nothing found', `MusicBrainz has no artists or songs matching <b>${esc(q)}</b>. Check the spelling, or try fewer words.`));
    return;
  }
  if (r.artists.length) {
    const grid = h('div.artist-cards');
    for (const a of r.artists) grid.append(artistCard(a));
    page.append(h('section.dv-section', null, h('h3', null, h('span', { text: 'Artists' })), grid));
  }
  if (r.songs.length) {
    const missing = r.songs.filter((s) => !s.have && !s.official);
    const selAll = btn(`Select ${missing.length} missing`, {
      cls: 'small soft',
      disabled: !missing.length,
      onClick: () => {
        for (const s of missing) D.sel.set(keyOf(s.artist, s.title), { artist: s.artist, title: s.title, album: s.album, year: s.year });
        renderSelBar();
      },
    });
    const table = h('div.dv-table.songs.card');
    table.append(h('div.dv-row.head', null, h('div'), h('div', { text: 'Song' }), h('div', { text: 'Artist' }), h('div', { text: 'Time' }), h('div', { text: 'Status' }), h('div')));
    for (const s of r.songs) table.append(songRow(s, s));
    page.append(h('section.dv-section', null, h('h3', null, h('span', { text: 'Songs' }), selAll), table));
  }
}

function renderSearchStatus() {
  const el = root.querySelector('.dv-loading span');
  if (el) el.textContent = 'Searching MusicBrainz…';
}

function gapFor(name) {
  if (!D.gaps) return null;
  const g = D.gaps.artists.find((a) => a.name === name);
  return g && g.status === 'ok' ? g : null;
}

function artistCard(a) {
  const card = h('button.artist-card', { type: 'button', title: `Open ${a.name}` });
  const meta = h('div.meta', null, h('div.name', { text: a.name }));
  const bits = [a.type, a.country, a.disambiguation].filter(Boolean).join(' · ');
  if (bits) meta.append(h('div.dis', { text: bits }));
  const g = a.gap || null;
  const foot = h('div.foot');
  if (g && g.total) {
    foot.append(bar(g.have, g.total), h('span', { text: `${g.have} of ${g.total}` }));
  } else if (a.owned) {
    foot.append(h('span.own', { text: `${plural(a.owned, 'song')} in library` }));
  } else if (a.id) {
    foot.append(h('span.muted', { text: 'Not in your library' }));
  }
  meta.append(foot);
  card.append(avatar(a.name), meta);
  card.addEventListener('click', () => openArtist({ id: a.id || null, name: a.name }));
  return card;
}

// ---------------------------------------------------------------- artist --
async function loadArtist({ fresh = false } = {}) {
  const v = state.view.artist || {};
  const key = `${v.id || ''}|${v.name || ''}`;
  if (!fresh && D.pageKey === key && (D.page || D.loadingArtist)) return;
  D.pageKey = key;
  D.page = null;
  D.loadingArtist = true;
  D.progress = null;
  render();
  try {
    const page = await api.discover.artist({ id: v.id, name: v.name, fresh });
    if (D.pageKey !== key) return;
    D.page = page;
    if (!page.needsChoice) {
      // Remember the exact artist, so reopening skips the search.
      if (!v.id) state.view.artist = { id: page.artist.id, name: v.name || page.artist.name };
      refreshGaps();
    }
  } catch (err) {
    if (D.pageKey !== key) return;
    D.page = { error: err.message };
  }
  D.loadingArtist = false;
  render();
}

function renderArtist(page) {
  const v = state.view.artist || {};
  const back = btn(state.view.from === 'gaps' ? 'Collection gaps' : state.view.from === 'wanted' ? 'Wanted' : 'Search', {
    cls: 'soft small back',
    iconName: 'chevronLeft',
    onClick: () => open(state.view.from || 'search'),
  });
  page.append(back);
  const p = D.page;
  if (D.loadingArtist || !p) {
    page.append(h('div.dv-artist.card', null, avatar(v.name || '?', 'lg'), h('div.dv-title', null, h('div.kicker', { text: 'Artist' }), h('h1', { text: v.name || 'Artist' }))));
    const pr = D.progress && D.progress.kind === 'artist' ? D.progress : null;
    const line = h('div.dv-progress', null, h('div.spin'), h('span.label', { text: pr && pr.total ? `Reading albums from MusicBrainz… ${pr.done} of ${pr.total}${pr.title ? ` · ${pr.title}` : ''}` : 'Finding this artist on MusicBrainz…' }));
    const meter = h('div.progress', null, h('i'));
    if (pr && pr.total) meter.firstChild.style.width = `${Math.round((pr.done / pr.total) * 100)}%`;
    else meter.classList.add('indeterminate');
    page.append(h('div.dv-loading.col', null, line, meter, h('p.fine', { text: 'MusicBrainz asks apps to make one request a second, so a big discography takes a little while the first time. After that it’s instant.' })));
    return;
  }
  if (p.error) {
    page.append(emptyBox('Couldn’t load this artist', esc(p.error), [btn('Try again', { onClick: () => loadArtist({ fresh: false }) })]));
    return;
  }
  if (p.needsChoice) {
    page.append(head(`Which ${p.name}?`, p.options.length ? 'MusicBrainz has more than one artist with a similar name. Pick the one you mean; Stagehand remembers it.' : `MusicBrainz has no artist called <b>${esc(p.name)}</b>.`, [], { kicker: 'Artist' }));
    const list = h('div.choice-list');
    for (const o of p.options) {
      const b = h('button.choice', { type: 'button' }, avatar(o.name), h('div.meta', null, h('div.name', { text: o.name }), h('div.dis', { text: [o.type, o.country, o.disambiguation].filter(Boolean).join(' · ') || 'No details' })), h('span.go', { html: icon('chevronRight') }));
      b.onclick = () => {
        state.view.artist = { id: o.id, name: p.name };
        D.pageKey = '';
        loadArtist();
      };
      list.append(b);
    }
    page.append(list);
    return;
  }

  const a = p.artist;
  const pct = p.total ? Math.round((p.have / p.total) * 100) : 0;
  const tools = h('div.dv-tools');
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Show' });
  // 4.23: quick filters, each with its count (the same counts as the bars and the selection)
  const all = p.albums.flatMap((al) => al.tracks);
  const partsOf = (t) => {
    const song = t.have && t.songId ? state.songs.get(t.songId) : null;
    return song ? missingParts(song).filter((x) => x !== 'words').length > 0 : false;
  };
  const n = { all: all.length, missing: all.filter((t) => !t.have).length, wanted: all.filter((t) => !t.have && t.wanted).length, owned: all.filter((t) => t.have).length, parts: all.filter(partsOf).length };
  for (const [val, label] of [
    ['all', `All (${n.all})`],
    ['missing', `Missing (${n.missing})`],
    ['wanted', `Wanted (${n.wanted})`],
    ['owned', `In library (${n.owned})`],
    ['parts', `Missing a part (${n.parts})`],
  ]) {
    if (val === 'parts' && !n.parts && D.show !== 'parts') continue;
    const b = h('button', { type: 'button', 'aria-pressed': String(D.show === val), text: label });
    b.onclick = () => {
      D.show = val;
      D.missingOnly = val === 'missing';
      store('stagehand.dvShow', val);
      store('stagehand.missingOnly', val === 'missing' ? '1' : '0');
      render();
    };
    seg.append(b);
  }
  const shows = (t) => D.show === 'missing' ? !t.have : D.show === 'wanted' ? !t.have && t.wanted : D.show === 'owned' ? t.have : D.show === 'parts' ? partsOf(t) : true;
  const missingItems = [];
  for (const al of p.albums) for (const t of al.tracks) if (!t.have && !t.official) missingItems.push({ artist: a.name, title: t.title, album: al.title, year: al.year, wanted: t.wanted });
  tools.append(
    seg,
    btn('Select all missing', {
      cls: 'soft',
      disabled: !missingItems.length,
      onClick: () => {
        for (const it of missingItems) if (!it.wanted) D.sel.set(keyOf(it.artist, it.title), it);
        renderSelBar();
      },
    }),
    iconBtn('refresh', 'Read again from MusicBrainz', () => loadArtist({ fresh: true })),
    iconBtn('globe', 'Open on MusicBrainz', () => api.shell.openExternal(`https://musicbrainz.org/artist/${a.id}`))
  );
  page.append(
    h(
      'div.dv-artist.card',
      null,
      avatar(a.name, 'lg'),
      h(
        'div.dv-title',
        null,
        h('div.kicker', { text: 'Artist' }),
        h('h1', { text: a.name }),
        h('div.sub', { text: [a.type, a.country, a.disambiguation].filter(Boolean).join(' · ') }),
        h(
          'div.completion',
          null,
          bar(p.have, p.total, 'lg'),
          h('div.cline', { html: `<b>${pct}%</b> You have ${p.have} of ${plural(p.total, 'song')} from ${plural(p.albums.length, 'studio album or EP', 'studio albums and EPs')}` })
        )
      ),
      tools
    )
  );
  if (!p.albums.length) {
    page.append(emptyBox('No studio albums listed', 'MusicBrainz doesn’t list any studio albums or EPs for this artist yet.'));
  }
  for (const al of p.albums) {
    const tracks = al.tracks.filter(shows);
    if (!tracks.length) continue;
    const have = al.tracks.filter((t) => t.have).length;
    const miss = al.tracks.filter((t) => !t.have && !t.wanted && !t.official).map((t) => ({ artist: a.name, title: t.title, album: al.title, year: al.year }));
    const selMiss = btn(miss.length ? `Select missing (${miss.length})` : 'Nothing to select', {
      cls: 'small soft',
      disabled: !miss.length,
      onClick: () => {
        for (const it of miss) D.sel.set(keyOf(it.artist, it.title), it);
        renderSelBar();
      },
    });
    const card = h(
      'section.album.card',
      null,
      h(
        'div.album-head',
        null,
        cover(al.id, al.title),
        h(
          'div.album-meta',
          null,
          h('h3', { text: al.title }),
          h('div.sub', { text: [al.type === 'EP' ? 'EP' : 'Album', al.year, plural(al.tracks.length, 'song')].filter(Boolean).join(' · ') }),
          h('div.mini', null, bar(have, al.tracks.length), h('span', { text: have === al.tracks.length ? 'Complete' : `${have} of ${al.tracks.length}` }))
        ),
        selMiss
      )
    );
    // Two columns, read top to bottom like a record sleeve.
    const list = h('div.tracks');
    list.style.setProperty('--rows', String(Math.ceil(tracks.length / 2)));
    al.tracks.forEach((t, i) => {
      if (!shows(t)) return;
      list.append(songRow(t, { artist: a.name, title: t.title, album: '', year: null }, { showArtist: false, num: i + 1, quietMissing: true }));
    });
    card.append(list);
    page.append(card);
  }
  if (p.extras.length) {
    const ex = h('div.extras');
    for (const s of p.extras) {
      const b = h('button.chip', { type: 'button', title: 'Play', html: `${icon('play')}<span>${esc(s.title)}</span>` });
      b.onclick = () => actions.playSong(s.id);
      ex.append(b);
    }
    page.append(h('section.dv-section', null, h('h3', null, h('span', { text: 'Also in your library' }), h('span.hint', { text: 'Live versions, covers and singles that aren’t on these albums' })), ex));
  }
  const notes = ['Live albums, compilations and remixes aren’t counted.'];
  if (p.skipped && p.skipped.length) notes.push(`Couldn’t read ${p.skipped.join(', ')}.`);
  notes.push('Album details come from MusicBrainz.');
  page.append(h('p.fine.dv-foot', { text: notes.join(' ') }));
}

// ------------------------------------------------------------------ gaps --
async function refreshGaps() {
  D.gaps = await api.discover.gaps().catch(() => D.gaps);
  if (sub() === 'gaps') render();
}

function renderGaps(page) {
  const g = D.gaps;
  const running = g && g.running;
  const artists = g ? g.artists : [];
  const checked = artists.filter((a) => a.status === 'ok');
  const unchecked = artists.filter((a) => a.status === 'unchecked' || a.status === 'error');
  const tools = [];
  if (running) {
    tools.push(btn('Stop', { cls: 'soft', onClick: () => api.discover.cancelGaps() }));
  } else {
    tools.push(
      btn(unchecked.length ? `Check ${plural(unchecked.length, 'artist')}` : 'Check again', {
        cls: unchecked.length ? 'primary' : '',
        iconName: 'refresh',
        disabled: !artists.length,
        onClick: async () => {
          D.gaps = await api.discover.checkGaps(unchecked.length ? {} : { fresh: true });
          render();
        },
      })
    );
  }
  page.append(head('Collection gaps', 'How much of each artist you have, compared with their studio albums and EPs on MusicBrainz.', tools, { kicker: 'Discover' }));
  if (!g) {
    page.append(h('div.dv-loading', null, h('div.spin'), h('span', { text: 'Loading…' })));
    return;
  }
  if (!artists.length) {
    page.append(emptyBox('No artists yet', 'Add a folder of songs first. Collection gaps compares the artists in your library with MusicBrainz.'));
    return;
  }
  if (running) {
    const left = running.total - running.done;
    const pr = D.progress && D.progress.kind === 'gaps' ? D.progress : null;
    const meter = h('div.progress', null, h('i'));
    meter.firstChild.style.width = `${running.total ? Math.round((running.done / running.total) * 100) : 0}%`;
    page.append(
      h(
        'div.dv-banner.card.run',
        null,
        h('div.spin'),
        h('div.grow', null, h('b', { text: `Checking ${running.current || '…'}` }), h('span', { text: ` · ${running.done} of ${running.total} artists${pr && pr.total ? ` · album ${Math.min(pr.done + 1, pr.total)} of ${pr.total}` : ''}` }), meter),
        h('span.muted', { text: left > 1 ? `About ${Math.max(1, Math.round((left * 12) / 60))} min left` : 'Almost done' })
      )
    );
  } else if (unchecked.length && !checked.length) {
    page.append(
      h(
        'div.dv-banner.card',
        null,
        h('span.ic', { html: icon('info') }),
        h('div.grow', null, h('b', { text: `${plural(unchecked.length, 'artist')} to check. ` }), h('span', { text: `MusicBrainz allows one request a second, so this takes about ${Math.max(1, Math.round((unchecked.length * 12) / 60))} min. Keep using Stagehand meanwhile; results are saved.` }))
      )
    );
  }
  const missingTotal = checked.reduce((n, a) => n + (a.missing || 0), 0);
  const complete = checked.filter((a) => a.total && a.missing === 0).length;
  page.append(
    h(
      'div.stats',
      null,
      stat(`${checked.length}`, `of ${artists.length} artists checked`),
      stat(`${missingTotal}`, 'songs missing from their albums'),
      stat(`${complete}`, complete === 1 ? 'artist complete' : 'artists complete')
    )
  );
  const filters = h('div.seg', { role: 'group', 'aria-label': 'Show' });
  for (const [val, label] of [
    ['all', 'All'],
    ['gaps', 'With gaps'],
    ['complete', 'Complete'],
    ['unchecked', 'Not checked'],
  ]) {
    const b = h('button', { type: 'button', 'aria-pressed': String(D.gapsFilter === val), text: label });
    b.onclick = () => {
      D.gapsFilter = val;
      store('stagehand.gapsFilter', val);
      render();
    };
    filters.append(b);
  }
  const sort = h('select.input.small', { 'aria-label': 'Sort' });
  for (const [val, label] of [
    ['missing', 'Most missing'],
    ['complete', 'Least complete'],
    ['name', 'Name'],
  ]) {
    const o = h('option', { value: val, text: label });
    if (val === D.gapsSort) o.selected = true;
    sort.append(o);
  }
  sort.onchange = () => {
    D.gapsSort = sort.value;
    store('stagehand.gapsSort', sort.value);
    render();
  };
  page.append(h('div.dv-bar', null, filters, h('label.sortby', null, h('span', { text: 'Sort' }), sort)));

  let rows = artists.slice();
  if (D.gapsFilter === 'gaps') rows = rows.filter((a) => a.status === 'ok' && a.missing > 0);
  else if (D.gapsFilter === 'complete') rows = rows.filter((a) => a.status === 'ok' && a.missing === 0 && a.total);
  else if (D.gapsFilter === 'unchecked') rows = rows.filter((a) => a.status !== 'ok');
  const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const byName = (a, b) => coll.compare(a.name.replace(/^the\s+/i, ''), b.name.replace(/^the\s+/i, ''));
  const rank = (a) => (a.status === 'ok' ? 0 : a.status === 'unchecked' ? 1 : 2);
  if (D.gapsSort === 'name') rows.sort(byName);
  else if (D.gapsSort === 'complete') rows.sort((a, b) => rank(a) - rank(b) || (a.total ? a.have / a.total : 1) - (b.total ? b.have / b.total : 1) || byName(a, b));
  else rows.sort((a, b) => rank(a) - rank(b) || (b.missing || 0) - (a.missing || 0) || byName(a, b));

  const table = h('div.dv-table.gaps.card');
  table.append(h('div.gap-row.head', null, h('div'), h('div', { text: 'Artist' }), h('div', { text: 'You have' }), h('div', { text: 'Complete' }), h('div', { text: 'Missing' }), h('div')));
  for (const a of rows) table.append(gapRow(a, running));
  if (!rows.length) table.append(h('div.dv-none', { text: 'No artists match this filter.' }));
  page.append(table);
}

function stat(n, label) {
  return h('div.stat.card', null, h('b', { text: n }), h('span', { text: label }));
}

function gapRow(a, running) {
  const row = h('div.gap-row', { tabindex: '0' });
  const isCurrentCheck = running && running.current === a.name;
  let detail;
  if (a.status === 'ok') detail = h('div.s', { text: a.mbName && a.mbName !== a.name ? `as “${a.mbName}” · checked ${fmtDate(a.checkedAt)}` : `${plural(a.albums || 0, 'album')} · checked ${fmtDate(a.checkedAt)}` });
  else if (isCurrentCheck) detail = h('div.s.run', { text: 'Checking now…' });
  else if (a.status === 'ambiguous') detail = h('div.s.warn', { text: 'Several artists have this name. Choose one.' });
  else if (a.status === 'not-found') detail = h('div.s', { text: 'Not on MusicBrainz' });
  else if (a.status === 'error') detail = h('div.s.warn', { text: `Couldn’t check: ${a.error || 'unknown error'}` });
  else detail = h('div.s', { text: 'Not checked yet' });
  row.append(avatar(a.name, 'sm'), h('div.c-main', null, h('div.t', { text: a.name }), detail));
  if (a.status === 'ok' && a.total) {
    const pct = Math.round((a.have / a.total) * 100);
    row.append(h('div.c-have', { html: `<b>${a.have}</b><span> of ${a.total}</span>` }), h('div.c-bar', null, bar(a.have, a.total), h('span', { text: `${pct}%` })), h('div.c-miss', { text: a.missing ? String(a.missing) : '—' }));
  } else {
    row.append(h('div.c-have', { html: `<b>${a.owned}</b><span> in library</span>` }), h('div.c-bar'), h('div.c-miss', { text: '' }));
  }
  const acts = h('div.acts');
  if (a.status !== 'ok' && a.status !== 'not-found' && !running) {
    acts.append(
      btn(a.status === 'ambiguous' ? 'Choose…' : 'Check', {
        cls: 'small ghost',
        onClick: async (e) => {
          e.stopPropagation();
          if (a.status === 'ambiguous') openArtist({ name: a.name }, 'gaps');
          else {
            D.gaps = await api.discover.checkGaps({ keys: [a.key] });
            render();
          }
        },
      })
    );
  }
  acts.append(h('span.go', { html: icon('chevronRight') }));
  row.append(acts);
  const go = () => (a.status === 'not-found' ? null : openArtist({ id: a.mbid || null, name: a.name }, 'gaps'));
  row.addEventListener('click', go);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  return row;
}

// ---------------------------------------------------------------- wanted --
function renderWanted(page) {
  const left = D.wanted.filter((w) => w.status === 'wanted');
  const found = D.wanted.filter((w) => w.status === 'found');
  const gone = D.wanted.filter((w) => w.status === 'unavailable');
  const official = D.wanted.filter((w) => w.status === 'official');
  const tools = [
    D.run ? null : btn('Get songs', { cls: 'primary', iconName: 'download', disabled: !left.length, onClick: () => startRun(), title: hasFinder() ? 'One after another: the song finder searches CustomsForge for each song and imports what you download' : 'One after another: Stagehand copies each song for CustomsForge’s search and imports what you download' }),
    btn('Find next', { cls: 'soft', iconName: hasFinder() ? 'search' : 'external', disabled: !left.length, onClick: () => findNext(), title: hasFinder() ? 'Searches CustomsForge for the next song in the song finder' : 'Copies the next song and opens CustomsForge in your browser' }),
    btn('Copy list', { cls: 'soft', iconName: 'copy', disabled: !left.length, onClick: () => copyList(left) }),
  ].filter(Boolean);
  if (found.length) {
    tools.push(
      btn('Clear found', {
        cls: 'soft',
        onClick: async () => {
          D.wanted = await api.discover.clearFound();
          emit('discover-wanted');
          render();
        },
      })
    );
  }
  const bits = [`${plural(left.length, 'song')} to find`, found.length ? `${found.length} found` : '', gone.length ? `${gone.length} not available` : '', official.length ? `${official.length} official DLC` : ''].filter(Boolean);
  const subText = D.wanted.length ? bits.join(' · ') : 'Songs you want to get, collected from Search and Collection gaps.';
  page.append(head('Wanted', subText, tools, { kicker: 'Discover' }));
  const summary = summaryCard('wanted');
  if (summary) page.append(summary);
  if (!D.wanted.length) {
    page.append(
      emptyBox('Nothing wanted yet', 'Search for an artist, or open <b>Collection gaps</b>, tick the songs you don’t have and choose <b>Add to Wanted</b>.', [
        btn('Search', { iconName: 'search', onClick: () => open('search') }),
        btn('Collection gaps', { iconName: 'pie', onClick: () => open('gaps') }),
      ])
    );
    return;
  }
  // 4.25: two lists: the ones to find, and the ones CustomsForge had nothing for
  const tabs = h('div.dv-tabs', { role: 'tablist', 'aria-label': 'Lists' });
  for (const [id, label, n] of [['find', 'To find', left.length], ['unavailable', 'Not available', gone.length]]) {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(D.wantTab === id), html: `<span>${esc(label)}</span><small>${n}</small>` });
    b.onclick = () => ((D.wantTab = id), store('stagehand.wantTab', id), render());
    tabs.append(b);
  }
  if (official.length) {
    const b = h('button.dv-tab-link', { type: 'button', html: `<span>Official DLC</span><small>${official.length}</small>`, title: 'Paid Rocksmith songs from your list: ask for them there' });
    b.onclick = () => open('official');
    tabs.append(b);
  }
  page.append(tabs);
  if (D.wantTab === 'unavailable') return renderUnavailable(page, gone);

  // 4.24: the Now card (what's happening, step by step, and whose turn it is), then the queue in order
  nowEl = h('section.want-now');
  page.append(nowEl);
  drawNow({ force: true });
  if (!D.run) page.append(howItWorks());
  const seen = searchedMap();
  const q0 = D.wantFilter.trim().toLowerCase();
  const match = (w) => !q0 || `${w.artist} ${w.title} ${w.album || ''}`.toLowerCase().includes(q0);
  // the list's tools: Select all (what's showing), a filter, and how it's laid out
  const filter = h('input.input.dv-filter', { type: 'search', placeholder: 'Filter by artist or song', 'aria-label': 'Filter the list', value: D.wantFilter });
  filter.addEventListener('input', debounce(() => {
    D.wantFilter = filter.value;
    render();
    const f = root.querySelector('.dv-filter');
    if (f) (f.focus(), f.setSelectionRange(f.value.length, f.value.length));
  }, 200));
  const view = h('div.gseg.want-view', { role: 'group', 'aria-label': 'Show the list' });
  for (const [id, label] of [['queue', 'In order'], ['artist', 'By artist']]) {
    const b = h('button', { type: 'button', text: label, 'aria-pressed': String((D.wantView || 'queue') === id) });
    b.onclick = () => ((D.wantView = id), store('stagehand.wantView', id), render());
    view.append(b);
  }
  const shownLeft = left.filter(match);
  page.append(h('div.want-tools.dv-listbar', null, selectAllButton(), filter, h('span.muted', { text: q0 ? `${shownLeft.length} of ${left.length} showing` : `${plural(left.length, 'song')} to find` }), view));
  if ((D.wantView || 'queue') === 'queue') {
    const q = runLeft().filter((w) => w.status === 'wanted');
    const skipped = left.filter((w) => !q.includes(w));
    const box = h('section.want-queue.dv-list');
    box.append(h('div.want-row.q.head', null, h('div'), h('div', { text: '#' }), h('div', { text: 'Song' }), h('div', { text: 'Status' }), h('div')));
    [...q, ...skipped].forEach((w, i) => match(w) && box.append(queueRow(w, i + 1, seen)));
    if (!left.length) box.append(h('p.muted.dv-none', { text: gone.length || official.length ? 'Nothing left to find. The rest are on Not available or Official DLC.' : 'Everything you wanted is in your library.' }));
    else if (!shownLeft.length) box.append(h('p.muted.dv-none', { text: 'No songs match the filter.' }));
    page.append(box);
    if (found.length) {
      const fb = h('section.want-queue.found.dv-list', null, h('div.want-head', null, h('h3', { text: 'Added to Songs' }), h('span.muted', { text: String(found.length) })));
      for (const w of found) if (match(w)) fb.append(queueRow(w, null, seen));
      page.append(fb);
    }
    return;
  }
  const groups = new Map();
  for (const w of [...left, ...found]) {
    if (!match(w)) continue;
    if (!groups.has(w.artist)) groups.set(w.artist, []);
    groups.get(w.artist).push(w);
  }
  const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const names = [...groups.keys()].sort((a, b) => coll.compare(a.replace(/^the\s+/i, ''), b.replace(/^the\s+/i, '')));
  if (!names.length) page.append(h('p.muted.dv-none', { text: 'No songs match the filter.' }));
  for (const artist of names) {
    const items = groups.get(artist);
    const n = items.filter((w) => w.status === 'wanted').length;
    const name = h('button.dv-link', { type: 'button', text: artist, title: `Open ${artist}` });
    name.onclick = () => openArtist({ name: artist }, 'wanted');
    const ids = items.filter((w) => w.status === 'wanted').map((w) => w.id);
    const grp = h('section.want-group.dv-list', null, h('div.want-head', null, ids.length ? pickGroup(ids, artist) : h('span.c-sel'), h('h3', null, name), h('span.muted', { text: n ? `${n} to find` : 'All found' })));
    for (const w of items) {
      const row = h(`div.want-row${w.status === 'found' ? '.found' : ''}`);
      const when = seen[keyOf(w.artist, w.title)];
      const meta = [w.album, w.year].filter(Boolean).join(' · ');
      row.append(
        w.status === 'found' ? h('div.c-ic', { html: icon('check') }) : h('div.c-sel', null, pickBox(w.id, w.title)),
        h('div.c-main', null, h('div.t', { text: w.title }), h('div.s', { text: w.status === 'found' ? `In your library${w.foundAt ? ` since ${fmtDate(w.foundAt)}` : ''}` : [meta, when ? `searched ${fmtDate(when)}` : `added ${fmtDate(w.addedAt)}`].filter(Boolean).join(' · ') }))
      );
      const acts = h('div.acts');
      if (w.status === 'found') {
        if (w.songId && state.songs.has(w.songId)) acts.append(btn('Play', { cls: 'small ghost', iconName: 'play', onClick: () => actions.playSong(w.songId) }));
      } else {
        pickRow(row, w.id);
        acts.append(btn('Find', { cls: 'small', iconName: hasFinder() ? 'search' : 'external', title: hasFinder() ? 'Search CustomsForge for it in the song finder' : 'Copy and open CustomsForge', onClick: () => findOnCF(w, { open: !D.cfOpened }) }));
        acts.append(
          iconBtn('more', 'More', (e) =>
            showMenu(e.clientX, e.clientY, [
              { label: 'Open CustomsForge with this search', icon: 'external', onClick: () => findOnCF(w, { open: true }) },
              { label: 'Copy “Artist Title”', icon: 'copy', onClick: () => findOnCF(w, { open: false }) },
              {
                label: 'Copy title only',
                icon: 'copy',
                onClick: async () => {
                  await api.discover.copy(w.title);
                  toast({ title: 'Copied', message: `“${w.title}”`, kind: 'info' });
                },
              },
              { label: 'Browse artists on CustomsForge', icon: 'person', onClick: () => api.discover.customsforge({ text: w.artist, page: 'artists' }) },
              { label: 'Not available (nothing on CustomsForge)', icon: 'clock', onClick: () => setStatus([w.id], 'unavailable') },
              '-',
              { label: `Open ${w.artist}`, icon: 'person', onClick: () => openArtist({ name: w.artist }, 'wanted') },
            ])
          )
        );
      }
      acts.append(iconBtn('x', 'Remove from Wanted', () => unwant([w.id])));
      row.append(acts);
      grp.append(row);
    }
    page.append(grp);
  }
}

/** 4.25: songs CustomsForge had nothing for. Kept to try another time (new songs do turn up). */
function renderUnavailable(page, gone) {
  const tryAll = btn('Try all again', { cls: 'soft', iconName: 'repeat', disabled: !gone.length, title: 'Put them all back on the list to find', onClick: () => setStatus(gone.map((w) => w.id), 'wanted') });
  page.append(h('p.dv-note', { text: 'CustomsForge had nothing for these. Unless a song is new, it probably won’t turn up, but you can try again now and then. Get songs skips them.' }));
  if (!gone.length) {
    page.append(h('p.muted.dv-none', { text: 'Nothing here. When the song finder finds no match for a song, it lands here by itself.' }));
    return;
  }
  const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const rows = gone.slice().sort((a, b) => coll.compare(a.artist.replace(/^the\s+/i, ''), b.artist.replace(/^the\s+/i, '')) || coll.compare(a.title, b.title));
  page.append(h('div.want-tools.dv-listbar', null, selectAllButton(), h('span.muted', { text: plural(gone.length, 'song') }), tryAll));
  const box = h('section.want-queue.gone.dv-list');
  box.append(h('div.want-row.u.head', null, h('div'), h('div', { text: 'Song' }), h('div', { text: 'Last tried' }), h('div')));
  for (const w of rows) {
    const row = h('div.want-row.u');
    pickRow(row, w.id);
    const tries = Number(w.tries) || 1;
    row.append(
      h('div.c-sel', null, pickBox(w.id, w.title)),
      h('div.c-main', null, h('div.t', { text: w.title }), h('div.s', null, h('button.dv-link', { type: 'button', text: w.artist, onclick: () => openArtist({ name: w.artist }, 'wanted') }), h('span', { text: ` · ${tries === 1 ? 'tried once' : `tried ${tries} times`}` }))),
      h('span.wstate.gone', { html: `${icon('clock')}<span>${esc(w.unavailableAt ? fmtDate(w.unavailableAt) : 'Not available')}</span>` }),
      h('div.acts', null,
        btn('Try again', { cls: 'small', iconName: 'repeat', title: 'Back on the list to find', onClick: () => setStatus([w.id], 'wanted') }),
        iconBtn('x', 'Remove', () => unwant([w.id])))
    );
    box.append(row);
  }
  page.append(box);
}

/** 4.25: the run is over: what came of it, until you put it away. */
function summaryCard(kind) {
  const s = D.summary;
  if (!s || s.kind !== kind || D.run) return null;
  const stat = (n, label, cls = '') => h(`div.sum-stat${cls ? '.' + cls : ''}`, null, h('b', { text: String(n) }), h('span', { text: label }));
  const card = h('section.dv-summary', { role: 'status' });
  const close = iconBtn('x', 'Put this away', () => ((D.summary = null), render()));
  if (kind === 'update') {
    card.append(h('div.sum-title', null, h('small', { text: 'Updates done' }), h('b', { text: s.got ? `${plural(s.got, 'song')} updated` : 'No songs updated' })), h('div.sum-stats', null, stat(s.got, 'Updated', 'ok'), stat(s.skipped, 'Skipped'), stat(s.left, 'Still to get')), close);
    return card;
  }
  card.append(
    h('div.sum-title', null, h('small', { text: 'Run finished' }), h('b', { text: s.got ? `Got ${plural(s.got, 'song')}` : 'Nothing new this time' })),
    h('div.sum-stats', null, stat(s.got, 'Got', 'ok'), stat(s.unavailable, 'Not available'), stat(s.official, 'Official DLC'), stat(s.left, 'Still to find')),
    h('div.acts', null,
      s.unavailable ? btn('See Not available', { cls: 'small ghost', onClick: () => ((D.wantTab = 'unavailable'), store('stagehand.wantTab', 'unavailable'), (D.summary = null), render()) }) : null,
      s.official ? btn('See Official DLC', { cls: 'small ghost', onClick: () => ((D.summary = null), open('official')) }) : null),
    close
  );
  return card;
}

// ------------------------------------------------------------ official DLC --
async function loadOfficial() {
  const r = api.discover.official ? await api.discover.official().catch(() => null) : null;
  D.official = r && Array.isArray(r.songs) ? r : { songs: [], nextAt: 0, contact: '' };
  if (sub() === 'official') render();
}

function offTime(t) {
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? `today at ${time}` : `${fmtDate(t)} at ${time}`;
}

/**
 * 4.25: Official DLC: the paid Rocksmith songs you don't have (and ones the finder only found as
 * official). They can't be downloaded, so they're asked for: tick them and press Request.
 */
function renderOfficial(page) {
  const o = D.official;
  const reqBtn = btn('Request', { cls: 'primary', iconName: 'music', title: 'Ask Noisewater Labs for the songs you ticked', onClick: () => requestDialog(pickedOfficial()) });
  reqBtn.classList.add('off-request');
  page.append(head('Official DLC', 'Paid Rocksmith songs you don’t have. They can’t be downloaded, so they can’t go on Wanted.', [], { kicker: 'Discover' }));
  const wait = o && o.nextAt && o.nextAt > Date.now() ? `You can send your next request ${offTime(o.nextAt)}.` : o && o.queued ? 'Your request is waiting to go out: it’s sent when you’re online.' : 'Tick the songs you’d like and press Request. One request every 12 hours.';
  page.append(h('section.off-contact', null, h('div', null, h('h2', { text: 'Contact Noisewater Labs for these songs' }), h('p', { text: wait })), reqBtn));
  if (!o) {
    page.append(h('div.dv-loading', null, h('div.spin'), h('span', { text: 'Loading…' })));
    return;
  }
  const filter = h('input.input.dv-filter', { type: 'search', placeholder: 'Find an artist or song', 'aria-label': 'Find an artist or song', value: D.offFilter });
  const listEl = h('div.off-list');
  const count = h('span.muted');
  const draw = () => {
    pick.order = [];
    const q = D.offFilter.trim().toLowerCase();
    const songs = o.songs.filter((s) => !q || `${s.artist} ${s.title}`.toLowerCase().includes(q));
    count.textContent = q ? `${songs.length} of ${o.songs.length} songs` : `${o.songs.length} songs you don’t have`;
    const groups = new Map();
    for (const s of songs) {
      if (!groups.has(s.artist)) groups.set(s.artist, []);
      groups.get(s.artist).push(s);
    }
    const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const names = [...groups.keys()].sort((a, b) => coll.compare(a.replace(/^the\s+/i, ''), b.replace(/^the\s+/i, '')));
    const frag = document.createDocumentFragment();
    const mine = songs.filter((s) => s.wantedId);
    if (mine.length) frag.append(offGroup('From your Wanted list', mine, true));
    for (const n of names) frag.append(offGroup(n, groups.get(n).filter((s) => !s.wantedId), false));
    if (!songs.length) frag.append(h('p.muted.dv-none', { text: o.songs.length ? 'No official songs match.' : 'You have every official song. Nothing to ask for.' }));
    listEl.replaceChildren(frag);
    syncPicks();
  };
  filter.addEventListener('input', debounce(() => ((D.offFilter = filter.value), draw()), 150));
  page.append(h('div.want-tools.dv-listbar', null, selectAllButton(), filter, count), listEl);
  draw();
}

function offGroup(name, songs, mineGroup) {
  if (!songs.length) return document.createDocumentFragment();
  const ids = songs.map((s) => s.key);
  const g = h(`section.off-group.dv-list${mineGroup ? '.mine' : ''}`, null, h('div.want-head', null, pickGroup(ids, name), h('h3', { text: name }), h('span.muted', { text: String(songs.length) })));
  for (const s of songs) {
    const row = h('div.want-row.o');
    pickRow(row, s.key);
    row.append(
      h('div.c-sel', null, pickBox(s.key, s.title)),
      h('div.c-main', null, h('div.t', { text: s.title }), mineGroup ? h('div.s', { text: s.artist }) : null),
      h('span.state.official', { html: `${icon('music')}<span>Official DLC</span>` }),
      h('div.acts', null, btn('Request', { cls: 'small ghost', title: 'Ask Noisewater Labs for this song', onClick: () => requestDialog([{ artist: s.artist, title: s.title }]) }), s.wantedId ? iconBtn('x', 'Take it off your list', () => unwant([s.wantedId]).then(loadOfficial)) : null)
    );
    g.append(row);
  }
  return g;
}

function pickedOfficial() {
  const songs = (D.official && D.official.songs) || [];
  return songs.filter((s) => pick.ids.has(s.key)).map((s) => ({ artist: s.artist, title: s.title }));
}

/** 4.25: ask for official songs: the songs, how to reach you (remembered), a note, Send. */
export function requestDialog(songs) {
  songs = (songs || []).filter((s) => s && s.title);
  if (!songs.length) {
    toast({ title: 'Tick some songs first', message: 'Tick the official songs you’d like, then press Request.', kind: 'info' });
    return;
  }
  const o = D.official || {};
  let remembered = o.contact || '';
  try {
    remembered = remembered || localStorage.getItem('stagehand.requestContact') || '';
  } catch (_) {}
  const list = h('ul.req-songs');
  for (const s of songs.slice(0, 8)) list.append(h('li', null, h('b', { text: s.title }), h('span', { text: ` · ${s.artist}` })));
  if (songs.length > 8) list.append(h('li.more', { text: `and ${songs.length - 8} more` }));
  const contact = h('input.input', { type: 'text', value: remembered, placeholder: 'Your email or Discord name', 'aria-label': 'How can Noisewater Labs reach you?', maxlength: '200', autofocus: true });
  const note = h('textarea.input', { rows: '3', maxlength: '2000', placeholder: 'Anything else? (optional)', 'aria-label': 'A note (optional)' });
  const msg = h('p.req-msg', { role: 'status' });
  const nextAt = o.nextAt && o.nextAt > Date.now() ? o.nextAt : 0;
  if (nextAt) msg.textContent = `One request every 12 hours. You can send the next one ${offTime(nextAt)}.`;
  const send = btn('Send', { cls: 'primary', iconName: 'check', disabled: !!nextAt });
  const cancel = btn('Cancel', { cls: 'ghost' });
  const m = modal({
    title: songs.length === 1 ? `Ask for ${songs[0].title}` : `Ask for ${songs.length} songs`,
    body: h(
      'div.req-dialog',
      null,
      h('p', { text: 'Official Rocksmith songs are paid DLC and can’t be downloaded. Noisewater Labs can look into them for you.' }),
      list,
      h('label.req-field', null, h('span', { text: 'How can Noisewater Labs reach you?' }), contact),
      h('label.req-field', null, h('span', { text: 'A note' }), note),
      msg
    ),
    footer: [cancel, send],
  });
  cancel.onclick = () => m.close();
  send.onclick = async () => {
    const c = contact.value.trim();
    if (c.length < 2) {
      msg.textContent = 'Say how Noisewater Labs can reach you: an email or a Discord name.';
      contact.focus();
      return;
    }
    send.disabled = true;
    msg.textContent = 'Sending…';
    try {
      localStorage.setItem('stagehand.requestContact', c);
    } catch (_) {}
    const r = await api.discover.requestOfficial({ songs, contact: c, note: note.value }).catch((err) => ({ ok: false, via: 'none', error: err.message }));
    if (D.official) Object.assign(D.official, { contact: c, nextAt: (r && r.nextAt) || D.official.nextAt, queued: r && r.via === 'queued' ? (D.official.queued || 0) + 1 : D.official.queued });
    if (r && r.ok) {
      m.close();
      pickClear();
      toast(
        r.via === 'queued'
          ? { title: 'Request saved', message: 'You seem to be offline. It goes out by itself when you’re back online.', kind: 'info', timeout: 8000 }
          : { title: 'Request sent', message: `Noisewater Labs will get in touch at ${c}.`, kind: 'success' }
      );
      if (sub() === 'official') render();
      return;
    }
    if (r && r.via === 'wait') msg.textContent = `One request every 12 hours. You can send the next one ${offTime(r.nextAt)}.`;
    else {
      msg.textContent = (r && r.error) || 'It didn’t go out. Try again in a moment.';
      send.disabled = false;
    }
  };
}

// ----------------------------------------------------------------- updates --
async function refreshUpdates() {
  const r = api.discover.updates ? await api.discover.updates().catch(() => null) : null;
  if (r && Array.isArray(r.rows)) D.updates = r;
  emit('discover-wanted');
  if (sub() === 'updates') render();
}

/**
 * 4.25: Updates: songs you have with a newer version on CustomsForge (its Updated CDLC list,
 * read when it's open in the song finder). Get updates looks for each, like Get songs.
 */
function renderUpdates(page) {
  const rows = (D.updates && D.updates.rows) || [];
  const busy = D.run && D.run.kind === 'wanted';
  const tools = [
    btn('Check for updates', { cls: 'soft', iconName: 'refresh', onClick: () => checkUpdates(), title: 'Opens CustomsForge’s Updated CDLC list in the song finder' }),
    D.run && D.run.kind === 'update' ? null : btn('Get updates', { cls: 'primary', iconName: 'download', disabled: !rows.length || busy, title: busy ? 'Getting your wanted songs: stop that first' : 'One after another: the song finder looks for each newer version', onClick: () => startUpdates() }),
  ].filter(Boolean);
  page.append(head('Updates', rows.length ? `${plural(rows.length, 'song')} you have ${rows.length === 1 ? 'has' : 'have'} a newer version.` : 'Newer versions of songs you have.', tools, { kicker: 'Discover' }));
  page.append(h('p.dv-note', { text: `Stagehand reads CustomsForge’s Updated CDLC list when you open it in the song finder.${D.updates && D.updates.checkedAt ? ` Last read ${fmtDateTime(D.updates.checkedAt)}.` : ''}` }));
  const summary = summaryCard('update');
  if (summary) page.append(summary);
  if (D.run && D.run.kind === 'update') page.append(runBar());
  if (!rows.length) {
    page.append(emptyBox('No updates found yet', 'Press <b>Check for updates</b>: the song finder opens CustomsForge’s Updated CDLC list, and songs you have with a newer version show up here.', [btn('Check for updates', { iconName: 'refresh', onClick: () => checkUpdates() })]));
    return;
  }
  const box = h('section.want-queue.upd.dv-list');
  box.append(h('div.want-row.up.head', null, h('div'), h('div', { text: 'Song' }), h('div', { text: 'Version' }), h('div')));
  for (const u of rows) {
    const now = D.run && D.run.current && D.run.current.id === `upd:${u.key}`;
    const row = h(`div.want-row.up${now ? '.now' : ''}`);
    const ver = [u.ours ? `yours v${u.ours}` : '', u.version ? `new v${u.version}` : 'newer', u.updated ? `updated ${u.updated}` : ''].filter(Boolean).join(' · ');
    row.append(
      h('div.c-ic', { html: icon('refresh') }),
      h('div.c-main', null, h('div.t', { text: u.title }), h('div.s', { text: u.artist })),
      h(`span.wstate${now ? '.now' : ''}`, { text: now ? 'Looking for it now' : ver }),
      h('div.acts', null,
        btn('Get it', { cls: 'small', iconName: 'search', title: 'Look for the newer version in the song finder', onClick: () => findOnCF({ id: `upd:${u.key}`, artist: u.artist, title: u.title, mode: 'update' }) }),
        iconBtn('x', 'Not this one', async () => {
          D.updates = (await api.discover.clearUpdates([u.key]).catch(() => null)) || D.updates;
          emit('discover-wanted');
          render();
        }))
    );
    box.append(row);
  }
  page.append(box);
}

async function checkUpdates() {
  if (!hasFinder() || !api.discover.finderUpdates) {
    toast({ title: 'The song finder isn’t here', message: 'Updates are read from CustomsForge in the song finder.', kind: 'info' });
    return;
  }
  if (!(await explainFinder())) return;
  await Promise.resolve(api.discover.finderUpdates()).catch(() => {});
  toast({ title: 'Reading CustomsForge’s updates', message: 'The song finder opened the Updated CDLC list. Songs you have with a newer version show up here.', kind: 'info', timeout: 7000 });
}

/** 4.24: a song in the queue: its place, what's happening with it, and what you can do. */
function queueRow(w, n, seen) {
  const now = D.run && D.run.current && D.run.current.id === w.id;
  const skipped = D.run && D.run.skipped.has(w.id);
  const when = seen[keyOf(w.artist, w.title)];
  const status = w.status === 'found' ? ['ok', 'check', `In your library${w.foundAt ? ` since ${fmtDate(w.foundAt)}` : ''}`] : now ? ['now', 'search', 'Looking for it now'] : skipped ? ['skip', 'clock', 'Skipped for now'] : when ? ['seen', 'search', `Searched ${fmtDate(when)}`] : ['wait', 'star', 'Waiting'];
  const row = h(`div.want-row.q${w.status === 'found' ? '.found' : ''}${now ? '.now' : ''}`);
  row.append(
    w.status === 'found' ? h('div.c-sel', { html: icon('check') }) : h('div.c-sel', null, pickBox(w.id, w.title)),
    h('div.c-num', { text: n ? String(n) : '' }),
    h('div.c-main', null, h('div.t', { text: w.title }), h('div.s', null, h('button.dv-link', { type: 'button', text: w.artist, onclick: () => openArtist({ name: w.artist }, 'wanted') }), [w.album, w.year].filter(Boolean).length ? h('span', { text: ` · ${[w.album, w.year].filter(Boolean).join(' · ')}` }) : '')),
    h(`span.wstate.${status[0]}`, { html: `${icon(status[1])}<span>${esc(status[2])}</span>` })
  );
  const acts = h('div.acts');
  if (w.status === 'found') {
    if (w.songId && state.songs.has(w.songId)) acts.append(btn('Play', { cls: 'small ghost', iconName: 'play', onClick: () => actions.playSong(w.songId) }), iconBtn('library', 'Show in Songs', () => (setView({ kind: 'all' }), emit('reveal', w.songId))));
  } else {
    pickRow(row, w.id);
    acts.append(btn('Find', { cls: 'small', iconName: hasFinder() ? 'search' : 'external', title: 'Look for it now', onClick: () => findOnCF(w, { open: !D.cfOpened }) }));
    acts.append(iconBtn('clock', 'Not available: nothing on CustomsForge', () => setStatus([w.id], 'unavailable')));
    acts.append(iconBtn('x', 'Remove from Wanted', () => unwant([w.id])));
  }
  row.append(acts);
  return row;
}

/**
 * 4.24: the Now card. Says the song being looked for, how far the queue has got, the steps (Ready to
 * search › Choose a version › Downloading › Checking › Importing › Added) with the one you're at lit,
 * and whose turn it is: yours (pick and download) or Stagehand's (it's working). A download that came
 * in but wasn't the song asked for doesn't tick it off: it says so and lets you choose.
 */
let nowEl = null;
function drawNow({ force = false } = {}) {
  if (!nowEl || (!force && !nowEl.isConnected)) return;
  const left = D.wanted.filter((w) => w.status === 'wanted');
  nowEl.innerHTML = '';
  if (!left.length && !D.run) {
    nowEl.hidden = true;
    return;
  }
  nowEl.hidden = false;
  const run = D.run;
  const cur = run ? run.current : runLeft()[0];
  if (!cur) {
    nowEl.hidden = true;
    return;
  }
  const f = D.fstage && Date.now() - D.fstage.at < 10 * 60 * 1000 ? D.fstage : null;
  const forCur = f && (!f.want || f.want.id === cur.id || keyOf(f.want.artist || '', f.want.title || '') === keyOf(cur.artist, cur.title));
  // where we are
  let at = run ? 1 : 0; // 0 ready, 1 choose, 2 downloading, 3 checking/importing, 4 added
  let turn = run ? 'you' : 'idle';
  let line = run ? (hasFinder() ? 'In the song finder: pick the PC version and press its download button.' : 'In CustomsForge: paste into the search box, pick the PC version and download it.') : 'Press Get songs to look for them one after another, or Find on any song.';
  if (forCur && f.state === 'going') ((at = 2), (turn = 'sh'), (line = `Downloading ${f.name}${f.pct ? ` · ${f.pct}%` : ''}`));
  else if (forCur && f.state === 'adding') ((at = 3), (turn = 'sh'), (line = `Checking ${f.name} and adding it to Songs…`));
  else if (forCur && (f.state === 'added' || f.state === 'had') && cur.status === 'wanted') ((at = 3), (turn = 'you'), (line = `${f.name} came in, but it doesn’t look like “${cur.title}”. Keep looking, or say it’s the one.`));
  else if (forCur && f.state === 'failed') ((at = 2), (turn = 'you'), (line = `${f.name}: ${f.why || 'it didn’t work'}. Try another version, or Skip.`));
  const steps = ['Ready to search', 'Choose a version', 'Downloading', 'Checking & importing', 'Added to Songs'];
  const strip = h('ol.want-steps', { 'aria-label': 'Steps' });
  steps.forEach((t, i) => strip.append(h(`li${i < at ? '.done' : i === at ? '.on' : ''}`, null, h('i', { text: i < at ? '✓' : String(i + 1) }), h('span', { text: t }))));
  const pos = run ? `${run.done + 1} of ${run.done + left.filter((w) => !run.skipped.has(w.id)).length}` : `${left.length} to find`;
  const who = h(`span.want-turn.${turn}`, { text: turn === 'you' ? 'Waiting on you' : turn === 'sh' ? 'Stagehand is working' : 'Not started' });
  const acts = h('div.acts');
  if (run) {
    if (hasFinder()) acts.append(btn('Show the finder', { cls: 'small soft', iconName: 'search', onClick: () => runCopy(cur) }));
    else acts.append(btn('Open CustomsForge', { cls: 'small soft', iconName: 'external', onClick: () => runCopy(cur, { open: true }) }));
    if (forCur && (f.state === 'added' || f.state === 'had') && cur.status === 'wanted') acts.append(btn('That’s the one', { cls: 'small', iconName: 'check', title: 'Take it off Wanted: the download was this song', onClick: () => unwant([cur.id]) }));
    if (forCur && f.state === 'failed') acts.append(btn('Try again', { cls: 'small', iconName: 'repeat', onClick: () => runCopy(cur) }));
    // 4.25: nothing on CustomsForge for it: off to Not available, and on to the next
    acts.append(btn('Not available', { cls: 'small ghost', iconName: 'clock', title: 'CustomsForge has nothing for it: keep it on Not available and go to the next', onClick: () => setStatus([cur.id], 'unavailable') }));
    acts.append(btn('Skip', { cls: 'small', title: 'Leave this one for later and look for the next', onClick: () => runNext({ skip: true }) }), btn('Stop', { cls: 'small ghost', onClick: () => stopRun() }));
  } else {
    acts.append(btn('Get songs', { cls: 'small primary', iconName: 'download', onClick: () => startRun() }), btn('Find', { cls: 'small soft', iconName: 'search', onClick: () => findOnCF(cur, { open: !D.cfOpened }) }));
  }
  const lastAdded = D.wanted.filter((w) => w.status === 'found' && w.songId && state.songs.has(w.songId)).sort((a, b) => (b.foundAt || 0) - (a.foundAt || 0))[0];
  if (lastAdded) acts.append(btn('View imported', { cls: 'small ghost', iconName: 'library', title: `Show “${lastAdded.title}” in Songs`, onClick: () => (setView({ kind: 'all' }), emit('reveal', lastAdded.songId)) }));
  nowEl.append(
    h('div.want-now-top', null,
      h('div.want-now-what', null, h('small', { text: run ? `Now · ${pos}` : `Next up · ${pos}` }), h('b', { text: `${cur.artist} – ${cur.title}` })),
      who),
    strip,
    h('p.want-now-line', { text: line }),
    acts
  );
}

function howItWorks() {
  const st = D.imports;
  const watching = st && st.watch;
  const box = h('div.how.card');
  const steps = h(
    'ol.how-steps.cols4',
    null,
    h('li', null, h('b', { text: 'Want it' }), h('span', { text: 'In Search or Collection gaps, press Want it on songs you don’t have. They collect here.' })),
    h('li', null, h('b', { text: 'Find' }), h('span', { text: hasFinder() ? 'Stagehand opens CustomsForge in its own window and searches for the song.' : 'Stagehand copies the song and opens CustomsForge. Paste it into the search box.' })),
    h('li', null, h('b', { text: 'Download' }), h('span', { text: hasFinder() ? 'Get the PC version (_p.psarc) in that window.' : 'Get the PC version (_p.psarc) in your browser.' })),
    h('li', null, h('b', { text: 'Play' }), h('span', { text: 'Stagehand moves it into Rocksmith and ticks it off here.' }))
  );
  // 4.24: folded once there's a queue (the Now card shows the steps as they happen)
  const fold = h('details.how-fold', null, h('summary', { text: 'How it works' }), steps);
  fold.open = !D.wanted.length;
  box.append(fold);
  const status = h('div.how-status');
  if (watching) {
    status.append(h('span.status-dot.on'), h('span', { html: `Watching <b>${esc(shortPath(st.watchDir))}</b> for downloads` }), btn('Import settings', { cls: 'small ghost', onClick: () => open('imports') }));
  } else {
    status.append(
      h('span.status-dot'),
      h('span', { text: 'Automatic import is off.' }),
      btn('Watch Downloads', {
        cls: 'small',
        onClick: async () => {
          D.imports = await api.imports.configure({ watch: true });
          emit('discover-imports');
          toast({ title: 'Watching for downloads', message: `New songs in ${shortPath(D.imports.watchDir)} go straight into Rocksmith.` });
          render();
        },
      })
    );
  }
  box.append(status);
  return box;
}

function shortPath(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `…\\${parts.slice(-2).join('\\')}` : p;
}

// --------------------------------------------------------------- imports --
const STATUS = {
  imported: { icon: 'check', label: 'Imported', cls: 'ok' },
  updated: { icon: 'refresh', label: 'Updated', cls: 'ok' },
  duplicate: { icon: 'copy', label: 'Already had it', cls: 'muted' },
  rejected: { icon: 'alert', label: 'Not imported', cls: 'warn' },
  error: { icon: 'alert', label: 'Failed', cls: 'err' },
  undone: { icon: 'restore', label: 'Undone', cls: 'muted' },
};

function listName(id) {
  if (id === null || id === undefined || id === '') return null;
  return rsListLabel(String(id));
}

function renderImports(page) {
  const st = D.imports;
  page.append(
    head('Imports', 'Songs you download are checked, moved into Rocksmith and ticked off your Wanted list.', [btn('Import files…', { iconName: 'download', onClick: () => importFiles() })], { kicker: 'Discover' })
  );
  if (!st) {
    page.append(h('div.dv-loading', null, h('div.spin'), h('span', { text: 'Loading…' })));
    return;
  }
  // 4.0: songs already on this PC, outside the library
  page.append(findOnPcCard());
  // Settings
  const card = h('section.imp-card.card');
  const watch = h('input.toggle', { type: 'checkbox', 'aria-label': 'Watch for downloads' });
  watch.checked = st.watch;
  watch.onchange = () => configure({ watch: watch.checked });
  card.append(
    setting(
      'Watch for downloads',
      st.watchDirExists ? `New <b>.psarc</b> song files in <span class="path">${esc(st.watchDir)}</span> are imported as soon as they finish downloading. ZIPs are left alone; drop those on Stagehand when you want them.` : `<span class="warn">The folder ${esc(st.watchDir || '')} doesn’t exist.</span> Choose your downloads folder.`,
      [btn('Change…', { cls: 'small ghost', onClick: () => pickFolder('watch') }), watch]
    )
  );
  const t = st.target;
  card.append(
    setting(
      'Put new songs in',
      t ? `<span class="path">${esc(t.path)}</span>${t.auto ? (t.game ? ' · Rocksmith’s dlc folder' : ' · your first library folder') : ''}` : '<span class="warn">Stagehand can’t find your Rocksmith folder.</span> Choose where songs should go.',
      [t && !t.auto ? btn('Use automatic', { cls: 'small ghost', onClick: () => configure({ target: null }) }) : null, btn('Change…', { cls: 'small ghost', onClick: () => pickFolder('target') })].filter(Boolean)
    )
  );
  const listSel = h('select.input.small', { 'aria-label': 'In-game list for new songs' });
  listSel.append(h('option', { value: '', text: 'Don’t add to a list' }));
  if (state.rs && state.rs.profile) for (const id of rsListIds()) listSel.append(h('option', { value: id, text: rsListLabel(id) }));
  else if (st.list) listSel.append(h('option', { value: st.list, text: `Song List ${Number(st.list) + 1}` }));
  listSel.value = st.list === null || st.list === undefined ? '' : String(st.list);
  listSel.onchange = () => configure({ list: listSel.value || null });
  card.append(setting('Add new songs to an in-game list', 'Handy for a “New songs” list. If Rocksmith is open, Stagehand waits until you close it.', [listSel]));
  const rep = h('select.input.small', { 'aria-label': 'Newer versions' });
  rep.append(h('option', { value: '1', text: 'Replace the old file' }), h('option', { value: '0', text: 'Keep both' }));
  rep.value = st.replace ? '1' : '0';
  rep.onchange = () => configure({ replace: rep.value === '1' });
  card.append(setting('When a newer version of a song arrives', 'The old file is kept in Stagehand’s Backups folder. Favorites, ratings and setlists move to the new one.', [rep]));
  const keep = h('input.toggle', { type: 'checkbox', 'aria-label': 'Leave a copy in Downloads' });
  keep.checked = st.keepOriginal;
  keep.onchange = () => configure({ keepOriginal: keep.checked });
  card.append(setting('Leave a copy in Downloads', 'Off: song files are moved out of Downloads into Rocksmith.', [keep]));
  page.append(card);

  // Banners
  if (st.waiting && st.waiting.length) {
    const n = st.waiting.length;
    page.append(
      h(
        'div.dv-banner.card',
        null,
        h('span.ic', { html: icon('download') }),
        h('div.grow', null, h('b', { text: `${plural(n, 'song file')} ${n === 1 ? 'is' : 'are'} already in ${shortPath(st.watchDir)}. ` }), h('span', { text: st.waiting.slice(0, 3).map((w) => w.name).join(', ') + (n > 3 ? ` and ${n - 3} more` : '') })),
        btn(n === 1 ? 'Import it' : 'Import them', {
          cls: 'small primary',
          onClick: async (e) => {
            e.currentTarget.disabled = true;
            const r = await api.imports.waiting().catch((err) => toast({ title: 'Import failed', message: err.message, kind: 'err' }) && []);
            summarize(r || []);
          },
        })
      )
    );
  }
  if (st.pending && st.pending.length) {
    const count = st.pending.reduce((n, p) => n + p.count, 0);
    const names = [...new Set(st.pending.map((p) => listName(p.list)))].join(', ');
    const waiting = st.pending.some((p) => p.state === 'waiting');
    page.append(
      h(
        'div.dv-banner.card',
        null,
        h('span.ic', { html: icon('clock') }),
        h('div.grow', null, h('b', { text: `${plural(count, 'song')} waiting to go into ${names}. ` }), h('span', { text: waiting ? 'Close Rocksmith and Stagehand adds them.' : 'Adding them now…' })),
        btn('Try now', {
          cls: 'small',
          onClick: async () => {
            const r = await api.imports.retryLists();
            if (r && r.waiting) toast({ title: 'Rocksmith is still open', message: 'Close the game first. Stagehand keeps trying every minute.', kind: 'info' });
            else if (r && r.error) toast({ title: 'Couldn’t add to the list', message: r.error, kind: 'err' });
            else loadRocksmith();
          },
        })
      )
    );
  }
  page.append(h('div.drop-hint', { html: `${icon('download')}<span>Drop <b>.psarc</b> files, or ZIPs with songs inside, anywhere on Stagehand to import them.</span>` }));

  // History
  const hist = st.history || [];
  const clear = hist.length ? h('button.dv-link.small', { type: 'button', text: 'Clear' }) : null;
  if (clear) clear.onclick = () => api.imports.clearHistory();
  const sec = h('section.dv-section', null, h('h3', null, h('span', { text: 'Recent imports' }), st.busy ? h('span.hint', { html: `<span class="spin"></span> Importing ${st.busy}…` }) : null, clear));
  if (!hist.length) {
    sec.append(h('div.dv-none', { text: 'Nothing imported yet.' }));
  } else {
    const list = h('div.imp-list.card');
    for (const e of hist) list.append(importRow(e));
    sec.append(list);
  }
  page.append(sec);
}

function setting(title, desc, ctls) {
  return h('div.setting', null, h('div', null, h('div.t', { text: title }), h('div.d', { html: desc })), h('div.ctl', null, ...ctls));
}

async function configure(patch) {
  try {
    D.imports = await api.imports.configure(patch);
    emit('discover-imports');
    render();
  } catch (err) {
    toast({ title: 'Couldn’t change that', message: err.message, kind: 'err' });
  }
}

async function pickFolder(which) {
  const st = await api.imports.pickFolder(which);
  if (st) {
    D.imports = st;
    emit('discover-imports');
    render();
  }
}

function importRow(e) {
  const s = STATUS[e.status] || STATUS.error;
  const row = h(`div.imp-row.${s.cls}`);
  const song = e.songs && e.songs[0];
  const title = song ? `${song.title}` : e.inner || e.source;
  const by = song ? song.artist : '';
  const details = [];
  if (e.status === 'imported' || e.status === 'updated') {
    if (e.status === 'updated') details.push('replaced an older version');
    if (e.dest) details.push(`in ${shortPath(e.dest.split(/[\\/]/).slice(0, -1).join('\\'))}`);
    if (e.list) {
      const ln = listName(e.list.id);
      details.push(e.list.state === 'added' ? `added to ${ln}` : e.list.state === 'failed' ? `couldn’t add to ${ln}: ${e.list.error}` : `goes into ${ln} when Rocksmith closes`);
    }
    if (e.found && e.found.length) details.push('ticked off Wanted');
    if (e.songs.length > 1) details.push(`${e.songs.length} songs in this file`);
  } else if (e.reason) details.push(e.reason);
  const src = e.inner ? `${e.inner} from ${e.source}` : e.source;
  row.append(
    h('div.c-ic', { html: icon(s.icon) }),
    h(
      'div.c-main',
      null,
      h('div.t', null, h('span', { text: title }), by ? h('span.by', { text: ` · ${by}` }) : null),
      h('div.s', { text: details.join(' · ') }),
      h('div.s.file', { text: src })
    ),
    h('div.c-when', { text: fmtDateTime(e.at) }),
    h('span.state.' + s.cls, { text: s.label })
  );
  const acts = h('div.acts');
  const live = song && song.id && state.songs.has(song.id);
  if (live) acts.append(iconBtn('play', 'Play', () => actions.playSong(song.id)));
  if (e.dest && (e.status === 'imported' || e.status === 'updated' || e.status === 'duplicate')) acts.append(iconBtn('folder', 'Show in folder', () => api.shell.showItem(e.dest)));
  if (e.status === 'rejected' || e.status === 'error') acts.append(iconBtn('folder', 'Show the file', () => api.shell.showItem(e.sourcePath)));
  if (e.status === 'imported' || e.status === 'updated') {
    acts.append(
      iconBtn('restore', e.status === 'updated' ? 'Undo: put the old version back' : e.inner ? 'Undo: move it to the Recycle Bin' : 'Undo: move it back to Downloads', async () => {
        try {
          await api.imports.undo(e.id);
          await loadLibrary();
          D.wanted = await api.discover.wanted();
          emit('discover-wanted');
          toast({ title: `Undid the import of ${title}`, kind: 'info' });
        } catch (err) {
          toast({ title: 'Couldn’t undo', message: err.message, kind: 'err' });
        }
      })
    );
  }
  row.append(acts);
  return row;
}

/** "Find songs on this PC": looks in Downloads and the import folder. */
function findOnPcCard() {
  const card = h('section.imp-card.card.find-pc');
  const res = D.pcScan;
  const go = btn(res && res.busy ? 'Looking…' : 'Look for songs', { cls: 'small', iconName: 'search', disabled: !!(res && res.busy), onClick: () => scanPC({ show: true }) });
  card.append(setting('Find songs on this PC', 'Looks in your Downloads folder (and your import folder) for song files (<b>.psarc</b>) that aren’t in your library yet. Songs somewhere else: drop the folder on Stagehand.', [go]));
  if (res && res.found) {
    if (!res.found.length) card.append(h('p.np-fine', { text: 'Nothing new found: every song file there is already in your library.' }));
    else {
      const list = h('div.find-list');
      for (const f of res.found.slice(0, 12)) list.append(h('div.find-row', null, h('span', { text: f.name }), h('span.muted', { text: shortPath(f.path) })));
      if (res.found.length > 12) list.append(h('div.find-row.muted', { text: `…and ${res.found.length - 12} more` }));
      const add = btn(`Add ${plural(res.found.length, 'song')}`, { cls: 'primary', iconName: 'download', onClick: () => addFound() });
      card.append(list, h('div.find-acts', null, add));
    }
  }
  return card;
}

async function scanPC({ show = false } = {}) {
  D.pcScan = { busy: true };
  if (show) render();
  try {
    const r = await api.imports.scanPC();
    D.pcScan = { found: r.found || [] };
  } catch (e) {
    D.pcScan = null;
    if (show) toast({ title: 'Couldn’t look for songs', message: e.message, kind: 'err' });
  }
  if (show || sub() === 'imports') render();
  return D.pcScan;
}

async function addFound() {
  const paths = ((D.pcScan && D.pcScan.found) || []).map((f) => f.path);
  if (!paths.length) return;
  D.pcScan = null;
  await importFiles(paths);
  render();
}

export async function importFiles(paths) {
  try {
    const r = await api.imports.files(paths);
    if (Array.isArray(r) && !r.length) toast({ title: 'No songs found there', message: 'Stagehand looks for .psarc files and ZIPs of them.', kind: 'info' });
    else if (r) summarize(r);
  } catch (err) {
    toast({ title: 'Couldn’t import', message: err.message, kind: 'err' });
  }
}

function summarize(entries, { gameRunning = false, auto = false } = {}) {
  if (!entries.length) return;
  const ok = entries.filter((e) => e.status === 'imported' || e.status === 'updated');
  const dup = entries.filter((e) => e.status === 'duplicate');
  const bad = entries.filter((e) => e.status === 'rejected' || e.status === 'error');
  const songs = ok.flatMap((e) => e.songs);
  if (ok.length) {
    const first = songs[0];
    const lists = [...new Set(ok.filter((e) => e.list).map((e) => listName(e.list.id)))];
    const bits = [];
    if (songs.length === 1 && first) bits.push(first.artist);
    if (lists.length) bits.push(ok.some((e) => e.list && e.list.state !== 'added') ? `going into ${lists.join(', ')}` : `added to ${lists.join(', ')}`);
    if (ok.some((e) => e.found && e.found.length)) bits.push('ticked off Wanted');
    if (gameRunning) bits.push('restart Rocksmith to see it');
    toast({
      title: songs.length === 1 && first ? `Imported ${first.title}` : `Imported ${plural(songs.length, 'song')}`,
      message: bits.join(' · '),
      actions: [first && first.id ? { label: 'Play', onClick: () => actions.playSong(first.id) } : null, { label: 'Imports', onClick: () => open('imports') }].filter(Boolean),
    });
  }
  if (dup.length && !ok.length) toast({ title: dup.length === 1 ? 'Already in your library' : `${plural(dup.length, 'file')} already in your library`, message: dup.map((d) => d.source).join(', '), kind: 'info' });
  if (bad.length) {
    toast({
      title: bad.length === 1 ? `Didn’t import ${bad[0].inner || bad[0].source}` : `${plural(bad.length, 'file')} not imported`,
      message: bad.length === 1 ? bad[0].reason : 'See Imports for the reasons.',
      kind: auto ? 'info' : 'err',
      actions: [{ label: 'Imports', onClick: () => open('imports') }],
    });
  }
}

// ---------------------------------------------------------------- render --
const scroll = h('div.dv-scroll');
root.append(scroll, selBar);
let lastSub = null;

export function render() {
  const app = document.getElementById('app');
  app.classList.toggle('discovering', isDiscover());
  renderSelBar();
  if (!isDiscover()) {
    lastSub = null;
    return;
  }
  if (!shown()) return; // drawn again when you come back (the page change sends 'view')
  did('discover');
  const id = sub();
  const keepScroll = id === lastSub ? scroll.scrollTop : 0;
  if (id !== lastSub && lastSub !== null) D.sel.clear();
  lastSub = id;
  if (id && id !== 'artist') D.lastId = id; // (the menu's Discover opens where you were)
  // 4.25: ticks belong to one list: going to another list starts with none
  const scope = pickScope();
  if (scope !== pick.scope) {
    pick.scope = scope;
    pick.ids.clear();
    pick.anchor = null;
  }
  pick.order = [];
  const page = h(`div.dv-page.pg-${id || 'search'}`);
  if (id === 'artist') renderArtist(page);
  else if (id === 'gaps') renderGaps(page);
  else if (id === 'wanted') renderWanted(page);
  else if (id === 'imports') renderImports(page);
  else if (id === 'official') renderOfficial(page);
  else if (id === 'updates') renderUpdates(page);
  else renderSearch(page);
  harvest(scroll);
  scroll.replaceChildren(page);
  scroll.scrollTop = keepScroll;
  syncPicks();
}

on('view', () => {
  if (isDiscover() && sub() === 'artist') loadArtist();
  if (isDiscover() && sub() === 'gaps') refreshGaps();
  if (isDiscover() && sub() === 'imports') api.imports.status().then((s) => ((D.imports = s), render()));
  if (isDiscover() && sub() === 'wanted') api.discover.wanted().then((w) => ((D.wanted = w || D.wanted), render()));
  if (isDiscover() && sub() === 'official') loadOfficial();
  if (isDiscover() && sub() === 'updates') refreshUpdates();
  render();
});
// 4.25: Discover opened as a page (the highway's Go to menu, Back) while the list showing was a
// Songs one: it drew nothing. Open Discover where you last were instead.
on('page', () => {
  if (state.page === 'discover' && !isDiscover()) setView({ kind: 'discover', id: D.lastId || 'search' });
});
on('library', debounce(() => isDiscover() && sub() !== 'artist' && render(), 200));
on('rocksmith', () => isDiscover() && sub() === 'imports' && render());

// ------------------------------------------------------------ live updates --
api.on('discover:progress', (p) => {
  D.progress = p;
  const label = root.querySelector('.dv-progress .label');
  if (p.kind === 'artist' && label && D.loadingArtist) {
    label.textContent = p.total ? `Reading albums from MusicBrainz… ${p.done} of ${p.total}${p.title ? ` · ${p.title}` : ''}` : 'Reading albums from MusicBrainz…';
    const bar = root.querySelector('.dv-loading .progress');
    if (bar && p.total) {
      bar.classList.remove('indeterminate');
      bar.firstChild.style.width = `${Math.round((p.done / p.total) * 100)}%`;
    }
  }
});
api.on(
  'discover:gaps',
  debounce((g) => {
    D.gaps = g;
    if (sub() === 'gaps') render();
    emit('discover-gaps');
  }, 80)
);
api.on('import:update', (st) => {
  D.imports = st;
  emit('discover-imports');
  if (sub() === 'imports') render();
});
api.on('import:done', async ({ entries, gameRunning }) => {
  D.wanted = await api.discover.wanted().catch(() => D.wanted);
  emit('discover-wanted');
  await runAfterImport().catch(() => {});
  const auto = entries.every((e) => e.origin === 'download');
  // Picked or dropped files already get a toast from importFiles().
  if (auto) summarize(entries, { gameRunning, auto });
  if (isDiscover() && (sub() === 'wanted' || sub() === 'artist')) {
    if (sub() === 'artist') {
      D.pageKey = '';
      loadArtist();
    } else render();
  }
});
api.on('rocksmith:changed', () => loadRocksmith());
// the song finder's own buttons: Next song, and Stop
api.on('finder:event', (e) => {
  if (!e) return;
  // 4.24: what the latest download is doing (Activity, and the Wanted page's Now card)
  if (e.type === 'download') {
    D.fstage = { ...e, at: Date.now() };
    const done = e.state === 'added' || e.state === 'had';
    setJob(`dl:${e.name}`, { kind: 'import', label: e.state === 'going' ? 'Downloading' : e.state === 'adding' ? 'Checking and importing' : done ? (e.state === 'had' ? 'Already in Songs' : 'Added to Songs') : 'Download', song: e.name, state: e.state === 'going' ? 'running' : e.state === 'adding' ? 'finalizing' : done ? 'done' : 'failed', progress: e.state === 'going' && e.pct ? e.pct / 100 : null, phase: e.state === 'failed' ? e.why || 'It didn’t work' : e.state === 'adding' ? 'Checking the file' : done ? 'In your library' : 'From the song finder' });
    if (sub() === 'wanted') drawNow();
    // 4.25: a newer version came in: off Updates, and on to the next one
    const wid = e.want && e.want.id ? String(e.want.id) : '';
    if (done && wid.startsWith('upd:')) gotUpdate(wid).catch(() => {});
    return;
  }
  // 4.25: the finder read the results: no match → Not available, only official → Official DLC
  if (e.type === 'results') {
    onResults(e).catch(() => {});
    return;
  }
  // 4.25: the finder showed CustomsForge's Updated CDLC list (main keeps the rows for songs you have)
  if (e.type === 'updates') {
    setTimeout(() => refreshUpdates(), 500);
    return;
  }
  if (e.type === 'skip') {
    if (D.run) runNext({ skip: true }).catch(() => {});
    else findNext().catch(() => {});
  } else if (e.type === 'stop') stopRun();
});

async function onResults(e) {
  const want = e.want || {};
  const wid = String(want.id || '');
  if (!wid || wid.startsWith('upd:') || wid.startsWith('better:')) return;
  if (e.verdict !== 'none' && e.verdict !== 'official') return; // a match: the player picks and downloads
  const w = D.wanted.find((x) => x.id === wid) || D.wanted.find((x) => x.status === 'wanted' && keyOf(x.artist, x.title) === keyOf(want.artist || '', want.title || ''));
  if (!w || w.status !== 'wanted') return;
  const status = e.verdict === 'none' ? 'unavailable' : 'official';
  const current = D.run && D.run.current && D.run.current.id === w.id;
  D.wanted = (await api.discover.setStatus([w.id], status).catch(() => null)) || D.wanted;
  pick.ids.delete(w.id);
  emit('discover-wanted');
  toast({
    title: status === 'unavailable' ? `Not on CustomsForge: ${w.title}` : `Official DLC: ${w.title}`,
    message: status === 'unavailable' ? `Moved to Not available. You can try it again later.${current ? ' On to the next song.' : ''}` : `A paid Rocksmith song, so it moved to Official DLC.${current ? ' On to the next song.' : ''}`,
    kind: 'info',
    timeout: 5000,
  });
  if (current) {
    D.run[status] = (D.run[status] || 0) + 1;
    await runNext();
  }
  if (sub() === 'wanted') render();
}

async function gotUpdate(wid) {
  const key = wid.slice(4);
  if (api.discover.clearUpdates) D.updates = (await api.discover.clearUpdates([key]).catch(() => null)) || D.updates;
  emit('discover-wanted');
  const run = D.run;
  if (run && run.kind === 'update' && run.current && run.current.id === wid) {
    run.done++;
    await runNext();
  }
  if (sub() === 'updates') render();
}

// ------------------------------------------------------------ drag & drop --
const overlay = h('div.drop-overlay', { hidden: true }, h('div.box', null, h('div.ic', { html: icon('download') }), h('b', { text: 'Drop to import into Rocksmith' }), h('span', { text: '.psarc song files or ZIPs of them' })));
document.body.append(overlay);
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files') && !e.dataTransfer.types.includes('application/x-stagehand-songs');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  overlay.hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.hidden = true;
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  const paths = [...e.dataTransfer.files].map((f) => window.stagehand.pathFor(f)).filter(Boolean);
  // song files, ZIPs, or folders of them (a folder name has no file ending)
  const songs = paths.filter((p) => /\.(psarc|zip)$/i.test(p) || !/\.[a-z0-9]{1,5}$/i.test(p));
  if (!songs.length) {
    toast({ title: 'Nothing to import', message: 'Drop .psarc song files, ZIPs with songs inside, or a folder of them.', kind: 'info' });
    return;
  }
  importFiles(songs);
});

// ------------------------------------------------------------------ boot --
export async function init() {
  const [wanted, imports, recent, gaps, updates] = await Promise.all([
    api.discover.wanted().catch(() => []),
    api.imports.status().catch(() => null),
    api.discover.recent().catch(() => []),
    api.discover.gaps().catch(() => null),
    api.discover.updates ? api.discover.updates().catch(() => null) : null,
  ]);
  Object.assign(D, { wanted: wanted || [], imports, recent: recent || [], gaps });
  if (updates && Array.isArray(updates.rows)) D.updates = updates;
  // once a day, quietly look for songs on this PC that aren't in the library, and offer them
  setTimeout(async () => {
    let last = 0;
    try {
      last = Number(localStorage.getItem('stagehand.pcScanAt')) || 0;
    } catch (_) {}
    if (Date.now() - last < 86400000) return;
    try {
      localStorage.setItem('stagehand.pcScanAt', String(Date.now()));
    } catch (_) {}
    const r = await scanPC();
    if (r && r.found && r.found.length) toast({ title: `Found ${plural(r.found.length, 'song')} on this PC`, message: 'They aren’t in your library yet.', kind: 'info', timeout: 12000, actions: [{ label: 'Add them', onClick: () => addFound() }, { label: 'Show', onClick: () => open('imports') }] });
  }, 20000);
  emit('discover-wanted');
  emit('discover-imports');
  if (isDiscover() && sub() === 'artist') loadArtist();
  render();
}

export function counts() {
  return {
    wanted: D.wanted.filter((w) => w.status === 'wanted').length,
    unavailable: D.wanted.filter((w) => w.status === 'unavailable').length,
    updates: ((D.updates && D.updates.rows) || []).length,
    updating: !!(D.run && D.run.kind === 'update'),
    watching: !!(D.imports && D.imports.watch),
    busy: D.imports ? D.imports.busy : 0,
    gapsRunning: !!(D.gaps && D.gaps.running),
  };
}

void upsertSongs;
