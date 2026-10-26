/**
 * Discover: search MusicBrainz, see what each artist's albums have that your
 * library doesn't, keep a Wanted list, and import what you download.
 *
 * Stagehand never searches or downloads from CustomsForge itself (their rules
 * forbid apps doing that). It opens the site in your browser with the search
 * copied, then picks the download up from your Downloads folder.
 */
import { api } from './api.js';
import { state, on, emit, setView, rsListIds, rsListLabel, loadRocksmith, upsertSongs, loadLibrary } from './store.js';
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
  cfOpened: false,
};
state.discover = D;

const GELS = ['#ff6b3d', '#8c7bff', '#ff4d8d', '#33c8e0', '#9bdb5a', '#ffb547'];
const isDiscover = () => state.view.kind === 'discover';
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
    const img = h('img', { src: api.coverUrl(groupId, cls.includes('lg') ? 500 : 250), alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.remove());
    img.addEventListener('load', () => (img.naturalWidth <= 1 ? img.remove() : el.classList.add('has-img')));
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
  return h('div.dv-empty', null, h('h2', { text: title }), h('p', { html: text }), actionsEls.length ? h('div.actions', null, ...actionsEls) : null);
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
  selBar.hidden = !D.sel.size || !isDiscover();
  if (selBar.hidden) return;
  const items = [...D.sel.values()];
  selBar.append(
    h('span.count', { text: `${plural(items.length, 'song')} selected` }),
    btn('Add to Wanted', { iconName: 'star', cls: 'primary', onClick: () => want(items) }),
    btn('Copy as a list', { iconName: 'copy', cls: 'ghost', onClick: () => copyList(items) }),
    btn('Clear', { cls: 'ghost', onClick: () => clearSel() })
  );
  // Keep row checkboxes in step (e.g. after "Select missing").
  for (const c of root.querySelectorAll('input.check[data-key]')) c.checked = D.sel.has(c.dataset.key);
}

function clearSel() {
  D.sel.clear();
  for (const c of root.querySelectorAll('input.check')) c.checked = false;
  renderSelBar();
}

// ----------------------------------------------------------------- wanted --
async function want(items) {
  const r = await api.discover.addWanted(items.map(({ artist, title, album, year }) => ({ artist, title, album, year })));
  D.wanted = r.wanted;
  clearSel();
  emit('discover-wanted');
  toast({
    title: r.added ? `Added ${plural(r.added, 'song')} to Wanted` : 'Already in your Wanted list',
    message: r.added ? 'Find them on CustomsForge from the Wanted page. Downloads are imported automatically.' : '',
    actions: [{ label: 'Open Wanted', onClick: () => open('wanted') }],
  });
  render();
}

async function unwant(ids) {
  D.wanted = await api.discover.removeWanted(ids);
  emit('discover-wanted');
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
function explainCustomsForge() {
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

export async function findOnCF(item, { open: openSite = true } = {}) {
  const text = `${item.artist} ${item.title}`.trim();
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
  await findOnCF(next, { open: !D.cfOpened });
}

// ------------------------------------------------------------------ rows --
function statusChip(t, { quietMissing = false } = {}) {
  if (t.have) return h('span.state.have', { html: `${icon('check')}<span>In library</span>` });
  if (t.wanted) return h('span.state.want', { html: `${icon('star', 'fill')}<span>Wanted</span>` });
  return quietMissing ? null : h('span.state.miss', { text: 'Missing' });
}

function rowActions(t, item) {
  const box = h('div.acts');
  if (t.have && t.songId) {
    box.append(iconBtn('play', 'Play', () => actions.playSong(t.songId)));
    box.append(
      iconBtn('library', 'Show in library', () => {
        setView({ kind: 'all' });
        emit('reveal', t.songId);
      })
    );
  } else {
    const w = wantedFor(item.artist, item.title);
    box.append(
      iconBtn(
        'star',
        w ? 'Remove from Wanted' : 'Add to Wanted',
        () => (w ? unwant([w.id]) : want([item])),
        w ? 'on' : ''
      )
    );
    box.append(iconBtn('external', 'Find on CustomsForge', () => findOnCF(item)));
  }
  return box;
}

function songRow(t, item, { showArtist = true, num = null, quietMissing = false } = {}) {
  const row = h(`div.dv-row${t.have ? '.have' : ''}`);
  const sel = h('div.c-sel');
  if (!t.have) {
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
  if (!t.have) {
    row.addEventListener('click', () => {
      const c = row.querySelector('input.check');
      if (c) {
        c.checked = !c.checked;
        toggleSel(item, c.checked);
      }
    });
  } else if (t.songId) {
    row.addEventListener('dblclick', () => actions.playSong(t.songId));
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
    const hero = h('div.dv-hero');
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
    const missing = r.songs.filter((s) => !s.have);
    const selAll = btn(`Select ${missing.length} missing`, {
      cls: 'small ghost',
      disabled: !missing.length,
      onClick: () => {
        for (const s of missing) D.sel.set(keyOf(s.artist, s.title), { artist: s.artist, title: s.title, album: s.album, year: s.year });
        renderSelBar();
      },
    });
    const table = h('div.dv-table.songs');
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
    cls: 'ghost small back',
    iconName: 'chevronLeft',
    onClick: () => open(state.view.from || 'search'),
  });
  page.append(back);
  const p = D.page;
  if (D.loadingArtist || !p) {
    page.append(h('div.dv-artist', null, avatar(v.name || '?', 'lg'), h('div.dv-title', null, h('div.kicker', { text: 'Artist' }), h('h1', { text: v.name || 'Artist' }))));
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
  for (const [val, label] of [
    [false, 'All songs'],
    [true, `Missing only (${p.missing})`],
  ]) {
    const b = h('button', { type: 'button', 'aria-pressed': String(D.missingOnly === val), text: label });
    b.onclick = () => {
      D.missingOnly = val;
      store('stagehand.missingOnly', val ? '1' : '0');
      render();
    };
    seg.append(b);
  }
  const missingItems = [];
  for (const al of p.albums) for (const t of al.tracks) if (!t.have) missingItems.push({ artist: a.name, title: t.title, album: al.title, year: al.year, wanted: t.wanted });
  tools.append(
    seg,
    btn('Select all missing', {
      cls: 'ghost',
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
      'div.dv-artist',
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
    const tracks = D.missingOnly ? al.tracks.filter((t) => !t.have) : al.tracks;
    if (!tracks.length) continue;
    const have = al.tracks.filter((t) => t.have).length;
    const miss = al.tracks.filter((t) => !t.have && !t.wanted).map((t) => ({ artist: a.name, title: t.title, album: al.title, year: al.year }));
    const selMiss = btn(miss.length ? `Select missing (${miss.length})` : 'Nothing to select', {
      cls: 'small ghost',
      disabled: !miss.length,
      onClick: () => {
        for (const it of miss) D.sel.set(keyOf(it.artist, it.title), it);
        renderSelBar();
      },
    });
    const card = h(
      'section.album',
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
      if (D.missingOnly && t.have) return;
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
    tools.push(btn('Stop', { cls: 'ghost', onClick: () => api.discover.cancelGaps() }));
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
        'div.dv-banner.run',
        null,
        h('div.spin'),
        h('div.grow', null, h('b', { text: `Checking ${running.current || '…'}` }), h('span', { text: ` · ${running.done} of ${running.total} artists${pr && pr.total ? ` · album ${Math.min(pr.done + 1, pr.total)} of ${pr.total}` : ''}` }), meter),
        h('span.muted', { text: left > 1 ? `About ${Math.max(1, Math.round((left * 12) / 60))} min left` : 'Almost done' })
      )
    );
  } else if (unchecked.length && !checked.length) {
    page.append(
      h(
        'div.dv-banner',
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

  const table = h('div.dv-table.gaps');
  table.append(h('div.gap-row.head', null, h('div'), h('div', { text: 'Artist' }), h('div', { text: 'You have' }), h('div', { text: 'Complete' }), h('div', { text: 'Missing' }), h('div')));
  for (const a of rows) table.append(gapRow(a, running));
  if (!rows.length) table.append(h('div.dv-none', { text: 'No artists match this filter.' }));
  page.append(table);
}

function stat(n, label) {
  return h('div.stat', null, h('b', { text: n }), h('span', { text: label }));
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
  const tools = [
    btn('Find next on CustomsForge', { cls: 'primary', iconName: 'external', disabled: !left.length, onClick: () => findNext(), title: 'Copies the next song and opens CustomsForge in your browser' }),
    btn('Copy list', { cls: 'ghost', iconName: 'copy', disabled: !left.length, onClick: () => copyList(left) }),
  ];
  if (found.length) {
    tools.push(
      btn('Clear found', {
        cls: 'ghost',
        onClick: async () => {
          D.wanted = await api.discover.clearFound();
          emit('discover-wanted');
          render();
        },
      })
    );
  }
  const subText = D.wanted.length ? `${plural(left.length, 'song')} to find${found.length ? ` · ${found.length} found` : ''}` : 'Songs you want to get, collected from Search and Collection gaps.';
  page.append(head('Wanted', subText, tools, { kicker: 'Discover' }));
  page.append(howItWorks());
  if (!D.wanted.length) {
    page.append(
      emptyBox('Nothing wanted yet', 'Search for an artist, or open <b>Collection gaps</b>, tick the songs you don’t have and choose <b>Add to Wanted</b>.', [
        btn('Search', { iconName: 'search', onClick: () => open('search') }),
        btn('Collection gaps', { iconName: 'pie', onClick: () => open('gaps') }),
      ])
    );
    return;
  }
  const seen = searchedMap();
  const groups = new Map();
  for (const w of [...left, ...found]) {
    if (!groups.has(w.artist)) groups.set(w.artist, []);
    groups.get(w.artist).push(w);
  }
  const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const names = [...groups.keys()].sort((a, b) => coll.compare(a.replace(/^the\s+/i, ''), b.replace(/^the\s+/i, '')));
  for (const artist of names) {
    const items = groups.get(artist);
    const n = items.filter((w) => w.status === 'wanted').length;
    const name = h('button.dv-link', { type: 'button', text: artist, title: `Open ${artist}` });
    name.onclick = () => openArtist({ name: artist }, 'wanted');
    const grp = h('section.want-group', null, h('div.want-head', null, avatar(artist, 'sm'), h('h3', null, name), h('span.muted', { text: n ? `${n} to find` : 'All found' })));
    for (const w of items) {
      const row = h(`div.want-row${w.status === 'found' ? '.found' : ''}`);
      const when = seen[keyOf(w.artist, w.title)];
      const meta = [w.album, w.year].filter(Boolean).join(' · ');
      row.append(
        h('div.c-ic', { html: w.status === 'found' ? icon('check') : icon('star') }),
        h('div.c-main', null, h('div.t', { text: w.title }), h('div.s', { text: w.status === 'found' ? `In your library${w.foundAt ? ` since ${fmtDate(w.foundAt)}` : ''}` : [meta, when ? `searched ${fmtDate(when)}` : `added ${fmtDate(w.addedAt)}`].filter(Boolean).join(' · ') }))
      );
      const acts = h('div.acts');
      if (w.status === 'found') {
        if (w.songId && state.songs.has(w.songId)) acts.append(btn('Play', { cls: 'small ghost', iconName: 'play', onClick: () => actions.playSong(w.songId) }));
      } else {
        acts.append(btn('Find', { cls: 'small', iconName: 'external', title: 'Copy and open CustomsForge', onClick: () => findOnCF(w, { open: !D.cfOpened }) }));
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

function howItWorks() {
  const st = D.imports;
  const watching = st && st.watch;
  const box = h('div.how');
  const steps = h(
    'ol.how-steps.cols3',
    null,
    h('li', null, h('b', { text: 'Find' }), h('span', { text: 'Stagehand copies the song and opens CustomsForge. Paste it into the search box.' })),
    h('li', null, h('b', { text: 'Download' }), h('span', { text: 'Get the PC version (_p.psarc) in your browser.' })),
    h('li', null, h('b', { text: 'Play' }), h('span', { text: 'Stagehand moves it into Rocksmith and ticks it off here.' }))
  );
  box.append(steps);
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
  // Settings
  const card = h('section.imp-card');
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
        'div.dv-banner',
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
        'div.dv-banner',
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
    const list = h('div.imp-list');
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

export async function importFiles(paths) {
  try {
    const r = await api.imports.files(paths);
    if (r) summarize(r);
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
  const id = sub();
  const keepScroll = id === lastSub ? scroll.scrollTop : 0;
  if (id !== lastSub && lastSub !== null) D.sel.clear();
  lastSub = id;
  const page = h(`div.dv-page.pg-${id || 'search'}`);
  if (id === 'artist') renderArtist(page);
  else if (id === 'gaps') renderGaps(page);
  else if (id === 'wanted') renderWanted(page);
  else if (id === 'imports') renderImports(page);
  else renderSearch(page);
  scroll.replaceChildren(page);
  scroll.scrollTop = keepScroll;
  renderSelBar();
}

on('view', () => {
  if (isDiscover() && sub() === 'artist') loadArtist();
  if (isDiscover() && sub() === 'gaps') refreshGaps();
  if (isDiscover() && sub() === 'imports') api.imports.status().then((s) => ((D.imports = s), render()));
  if (isDiscover() && sub() === 'wanted') api.discover.wanted().then((w) => ((D.wanted = w), render()));
  render();
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
  const songs = paths.filter((p) => /\.(psarc|zip)$/i.test(p));
  if (!songs.length) {
    toast({ title: 'Nothing to import', message: 'Drop .psarc song files, or ZIPs with songs inside.', kind: 'info' });
    return;
  }
  importFiles(songs);
});

// ------------------------------------------------------------------ boot --
export async function init() {
  const [wanted, imports, recent, gaps] = await Promise.all([
    api.discover.wanted().catch(() => []),
    api.imports.status().catch(() => null),
    api.discover.recent().catch(() => []),
    api.discover.gaps().catch(() => null),
  ]);
  Object.assign(D, { wanted, imports, recent, gaps });
  emit('discover-wanted');
  emit('discover-imports');
  if (isDiscover() && sub() === 'artist') loadArtist();
  render();
}

export function counts() {
  return {
    wanted: D.wanted.filter((w) => w.status === 'wanted').length,
    watching: !!(D.imports && D.imports.watch),
    busy: D.imports ? D.imports.busy : 0,
    gapsRunning: !!(D.gaps && D.gaps.running),
  };
}

void upsertSongs;
