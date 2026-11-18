'use strict';
/**
 * 4.25: reading the song site's page the player is looking at (only that page, after a search
 * the player asked for), and what it says about the wanted song.
 *
 * The site's markup isn't known for sure (it changes), so the page reader is careful: it looks
 * for the visible table whose headings include Artist and Title, finds the other columns by
 * their headings, and treats anything it can't read as "nothing there". The empty page says
 * "No matching CDLC".
 */
const { norm } = require('../services/officiallist');

/**
 * Run in the page. mode 'results': the search results; mode 'updates': the Updated CDLC list
 * (only when that tab is the one on screen). Returns { empty, rows, sig, on }.
 */
const readPage = (mode) => `((mode) => {
  const vis = (el) => { if (!el || !el.getClientRects().length) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const txt = (el) => (el ? (el.innerText || el.textContent || '') : '').replace(/\\s+/g, ' ').trim();
  const BADGE = /^(update|updated|official|official dlc|new|hot|cdlc|dlc)$/i;
  // a cell's words without its little badges ("Update", "Official")
  const clean = (cell) => {
    if (!cell) return '';
    const c = cell.cloneNode(true);
    for (const b of c.querySelectorAll('*')) if (!b.children.length && BADGE.test(txt(b))) b.remove();
    // (a song really called "New" or "Update" keeps its name: only take badges off other words)
    return txt(c) || txt(cell);
  };
  const bodyText = document.body ? document.body.innerText || '' : '';
  const out = { empty: /no matching cdlc/i.test(bodyText), rows: [], on: true, url: location.href };
  if (mode === 'updates') {
    // the Updated CDLC tab must be the one showing
    const tabs = [...document.querySelectorAll('a, button, [role=tab], li, span, div')].filter((el) => /^updated cdlc$/i.test(txt(el)) && vis(el));
    const active = (el) => { for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) { if (e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-current') || /(^|[\\s-])(active|selected|current|is-active)([\\s-]|$)/i.test(e.className || '')) return true; } return false; };
    out.on = /updat/i.test(location.pathname + location.hash + location.search) || tabs.some(active);
    if (!out.on) return { on: false, rows: [], sig: 'off' };
  }
  const grids = [];
  for (const t of document.querySelectorAll('table')) {
    if (!vis(t)) continue;
    const head = (t.tHead && t.tHead.rows[0]) || t.rows[0];
    if (!head) continue;
    const body = t.tBodies.length ? [...t.tBodies].flatMap((b) => [...b.rows]) : [...t.rows];
    grids.push({ heads: [...head.cells].map((c) => txt(c).toLowerCase()), rows: body.filter((r) => r !== head && vis(r)).map((r) => [...r.cells]), el: t });
  }
  for (const g of document.querySelectorAll('[role=table], [role=grid]')) {
    if (!vis(g)) continue;
    const heads = [...g.querySelectorAll('[role=columnheader]')].map((c) => txt(c).toLowerCase());
    const rows = [...g.querySelectorAll('[role=row]')].filter(vis).map((r) => [...r.querySelectorAll('[role=cell], [role=gridcell]')]).filter((c) => c.length);
    grids.push({ heads, rows, el: g });
  }
  for (const g of grids) {
    const col = (re) => g.heads.findIndex((h) => re.test(h));
    const ia = col(/^artist/), it = col(/^(song|title|name)\\b/);
    if (ia < 0 || it < 0) continue;
    const ial = col(/^album/), icr = col(/^(creator|author|charter|uploader|by)\\b/), iv = col(/^(version|ver)\\b/), iu = col(/^(updated|last updated|update date|date)\\b/);
    for (const cells of g.rows.slice(0, 200)) {
      if (cells.length <= Math.max(ia, it)) continue; // a row across the whole table ("No matching CDLC")
      const row = cells[0].closest('tr, [role=row]') || cells[0].parentElement;
      const artist = clean(cells[ia]), title = clean(cells[it]);
      if (!artist && !title) continue;
      const creator = icr >= 0 && cells[icr] ? txt(cells[icr]) : '';
      // official DLC: an "Official" badge, made by Ubisoft, or a shop button where a download would be
      const els = [...row.querySelectorAll('*')];
      const badge = els.some((e) => (!e.children.length && /^official( dlc)?$/i.test(txt(e))) || /(^|[\\s_-])official([\\s_-]|$)/i.test(typeof e.className === 'string' ? e.className : ''));
      const cart = els.some((e) => /(^|[\\s_-])(cart|buy|shop|store)([\\s_-]|$)/i.test(typeof e.className === 'string' ? e.className : '') || (/^(a|button)$/i.test(e.tagName) && (/add to cart|buy|in store/i.test(txt(e)) || /store\\.(steampowered|ubi(soft)?)\\.com/i.test(e.getAttribute('href') || ''))));
      const dl = els.some((e) => /^(a|button)$/i.test(e.tagName) && (/download/i.test(txt(e) + ' ' + (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.className || '')) || e.hasAttribute('download')));
      const r = { artist: artist.slice(0, 200), title: title.slice(0, 200), official: badge || /^ubisoft\\b/i.test(creator) || (cart && !dl) };
      if (ial >= 0 && cells[ial]) r.album = clean(cells[ial]).slice(0, 200);
      if (creator) r.creator = creator.slice(0, 100);
      if (iv >= 0 && cells[iv]) r.version = txt(cells[iv]).slice(0, 40);
      if (iu >= 0 && cells[iu]) r.updated = txt(cells[iu]).slice(0, 60);
      out.rows.push(r);
    }
    if (out.rows.length) break;
  }
  out.sig = JSON.stringify([out.empty, out.rows.map((r) => r.artist + '|' + r.title + '|' + (r.version || ''))]);
  return out;
})(${JSON.stringify(mode)})`;

/**
 * Run in the page: clicks the visible thing whose words are exactly these ("Updated CDLC"),
 * the innermost one. Returns whether there was one.
 */
const clickText = (words) => `((words) => {
  const vis = (el) => { if (!el.getClientRects().length) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const want = words.toLowerCase();
  const all = [...document.querySelectorAll('a, button, [role=tab], [role=button], li, span, div, label')].filter((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase() === want && vis(el));
  const inner = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
  const el = inner.find((e) => /^(a|button)$/i.test(e.tagName) || e.getAttribute('role')) || inner[0];
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  el.click();
  return true;
})(${JSON.stringify(words)})`;

/** Same name, loosely: one holds the other (for names long enough to mean something). */
function near(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 4 && l.includes(s);
}
const sameArtist = (want, row) => !want.artist || near(want.artist, row.artist);
const sameSong = (want, row) => sameArtist(want, row) && (!want.title || near(want.title, row.title));

/** A title without the extras the site's search trips over: "(Live)", "- Remastered 2011", "feat. …". */
function plainTitle(t) {
  return String(t || '')
    .replace(/\s*[([].*?[)\]]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The one simpler second search when the first finds nothing. The site matches every word, so
 * one extra word in the wanted title ("Remastered 2011", "Live at …") or a different way of
 * writing the artist ("The", "&") empties the results. So: the title alone with its extras
 * taken off, then the rows are checked for the wanted artist. When that title is too short
 * to search by (a word or two letters: "Up", "X") or too long to be typed the same way
 * (over 40 letters), the artist alone, which lists all their songs. Null: nothing simpler.
 */
function simplerSearch(want, first) {
  if (!want) return null;
  const t = plainTitle(want.title);
  const a = String(want.artist || '').trim();
  let s = null;
  if (t.length >= 3 && t.length <= 40) s = t;
  else if (a) s = a;
  else if (t) s = t;
  if (!s || norm(s) === norm(first)) return null;
  return s;
}

/**
 * What the results say about the wanted song:
 *  'none'      nothing (after the second search: nothing by this artist);
 *  'official'  every row that is this song is official DLC (can't be downloaded);
 *  'match'     a row is this song;
 *  'some'      there are rows, none is clearly this song (the player picks).
 * second: these are the simpler second search's rows; only the wanted artist's count.
 */
function verdict(want, rows, second = false) {
  let list = Array.isArray(rows) ? rows : [];
  if (second && want && want.artist) list = list.filter((r) => sameArtist(want, r));
  if (!list.length) return 'none';
  const same = want ? list.filter((r) => sameSong(want, r)) : [];
  if (same.length) return same.every((r) => r.official) ? 'official' : 'match';
  // nothing is this song exactly, but everything shown by this artist is official DLC
  if (want && want.artist && list.every((r) => r.official && sameArtist(want, r))) return 'official';
  return 'some';
}

module.exports = { readPage, clickText, verdict, simplerSearch, plainTitle, near };
