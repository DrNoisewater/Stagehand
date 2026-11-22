/**
 * 4.26: the live reading display. While Discover reads an artist's albums from MusicBrainz (an
 * artist page the first time, or Collection gaps checking), this fills the empty area with what
 * is happening right now: the user's animation (The Reliquary) with the artist, the album being
 * read and the songs found on its screen, and under it the same in words (a live region for
 * screen readers), how far it has got, and the songs of the album just read (ticked when yours).
 *
 * THE ANIMATION. The Reliquary lives in src/renderer/vendor/reliquary/ (bones.js, reliquary.js,
 * art/) exactly as the user sent it; docs/reliquary/CLAUDE-INTEGRATION.md says how it's driven.
 * It's loaded here on first use (two classic scripts; reliquary.js finds art/ next to itself) and
 * mounted once per reading: start(artist), then update({ album, song, completed, total }) and
 * result({ song }) from MusicBrainz's progress, update({ state }) at the end, destroy() when the
 * results take over. It looks after less motion itself. If the scripts can't load, a plain
 * spinning record stands in.
 */
import { h, esc, icon } from './ui.js';
import { api } from './api.js';

const RIG_DIR = new URL('../vendor/reliquary/', import.meta.url);
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const loose = (s) => norm(s).replace(/^the /, '');

/** Whether two artist names are the same artist (case, "The", punctuation and a little more). */
export function sameArtist(a, b) {
  const x = loose(a);
  const y = loose(b);
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))));
}

let rigLoad = null;
/** The Reliquary's two scripts, once. Resolves true when window.mountReliquary is there. */
export function loadRig() {
  if (typeof window.mountReliquary === 'function' && window.ReliquaryBones) return Promise.resolve(true);
  if (!rigLoad) {
    const one = (file) =>
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL(file, RIG_DIR).href;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`couldn't load ${file}`));
        document.head.append(s);
      });
    rigLoad = one('bones.js')
      .then(() => one('reliquary.js'))
      .then(() => typeof window.mountReliquary === 'function')
      .catch(() => ((rigLoad = null), false));
  }
  return rigLoad;
}

function initials(name) {
  const words = String(name || '?')
    .replace(/^the\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0] || '?')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

/** The fallback when the animation can't load: a record turning, a level meter under it. */
function standIn(name) {
  const label = h('div.rd-label', null, h('span', { text: initials(name) }));
  const deck = h('div.rd-deck', { 'aria-hidden': 'true' }, h('div.rd-glow'), h('div.rd-record', null, h('div.rd-grooves'), label, h('div.rd-spindle')), h('div.rd-arm', null, h('i')));
  const eq = h('div.rd-eq', { 'aria-hidden': 'true' });
  for (let i = 0; i < 14; i++) {
    const b = h('i');
    b.style.setProperty('--d', `${(i * 137) % 900}ms`);
    b.style.setProperty('--h', `${30 + ((i * 53) % 70)}%`);
    eq.append(b);
  }
  return { el: h('div.rd-standin', null, deck, eq), label };
}

/**
 * A reading display. `artist`: the name to show until MusicBrainz answers. `has(title)`: whether
 * a song is in your library (to tick it). `compact`: one band (Collection gaps), not the full area.
 * Returns { el, update(progress), setArtist(name), finish(state), state }. update takes Discover's
 * progress events ({ artist, done, total, title, year, type, albumId, last: { title, year, tracks } }).
 * finish('complete' | 'cancelled' | 'error') ends it and lets the animation go.
 */
export function readingView({ artist = '', has = () => false, compact = false } = {}) {
  const st = { artist, done: 0, total: 0, title: '', songs: 0, mine: 0, albums: [], lastKey: '', ended: false };
  const el = h(`section.dv-reading${compact ? '.compact' : ''}${reduced() ? '.still' : ''}`);
  const stage = h('div.rd-stage');
  const host = h('div.rd-rig', { 'aria-hidden': 'true' });
  stage.append(host);

  // ---- the animation: mounted once it's on screen, fed what MusicBrainz says
  let rig = null;
  let label = null; // (the stand-in's record label)
  let timers = [];
  const clearTimers = () => (timers.forEach(clearTimeout), (timers = []));
  const rigNow = { album: '', song: '', completed: null, total: null };
  const send = (patch) => {
    Object.assign(rigNow, patch);
    if (rig) rig.update(patch);
  };
  const start = () => {
    if (!rig) return;
    const take = rig.take;
    rig.start(st.artist || 'Artist', take);
    rig.take = host.querySelector('svg')?.getAttribute('data-performance') || take;
    rig.update({ ...rigNow });
  };
  const mount = (tries = 0) => {
    if (st.ended) return;
    if (!host.isConnected) {
      if (tries < 120) requestAnimationFrame(() => mount(tries + 1));
      return;
    }
    loadRig().then((ok) => {
      if (st.ended || rig || label) return;
      if (ok) {
        try {
          rig = window.mountReliquary(host);
          start();
          el.classList.add('has-rig');
          return;
        } catch (_) {
          rig = null;
          host.replaceChildren();
        }
      }
      const s = standIn(st.artist);
      label = s.label;
      host.replaceChildren(s.el);
      host.classList.add('fallback');
    });
  };
  requestAnimationFrame(() => mount());

  /** An album was read: its songs go on the screen one by one, then the next album being read. */
  function feed(p) {
    clearTimers();
    const next = { album: p.title || '', song: '', completed: Number(p.done) || 0, total: Number(p.total) || null };
    const tracks = p.last && Array.isArray(p.last.tracks) ? p.last.tracks.slice(0, 8) : [];
    if (!tracks.length || reduced()) {
      if (next.album || !next.total) send(next);
      else send({ song: '', completed: next.completed, total: next.total });
      return;
    }
    send({ album: p.last.title, song: '', completed: next.completed, total: next.total });
    const gap = Math.max(90, Math.min(160, 800 / tracks.length));
    tracks.forEach((t, i) => timers.push(setTimeout(() => send({ song: t }), gap * (i + 1))));
    if (next.album) timers.push(setTimeout(() => send({ album: next.album, song: '' }), gap * (tracks.length + 1) + 120));
  }

  // ---- the words under it
  const artistEl = h('h2.rd-artist', { text: artist || 'Artist' });
  const albumEl = h('b.rd-album', { text: 'Looking up the artist…' });
  const metaEl = h('span.rd-meta');
  const countEl = h('div.rd-count');
  const meter = h('div.rd-meter', null, h('i'));
  const songsHead = h('div.rd-songs-head');
  const songsEl = h('ul.rd-songs');
  const doneEl = h('div.rd-done');
  const now = h('div.rd-now', { role: 'status', 'aria-live': 'polite' }, h('small', { text: compact ? 'Now' : 'Now reading' }), albumEl, metaEl);
  const info = h('div.rd-info', null, h('div.rd-kicker', { html: `${icon('globe')}<span>Reading MusicBrainz</span>` }), artistEl, now, countEl, meter);
  el.append(stage, info);
  if (!compact) el.append(h('div.rd-more', null, h('div.rd-last', null, songsHead, songsEl), doneEl, h('p.rd-fine', { text: 'MusicBrainz asks apps to make one request a second, so a big discography takes a little while the first time. After that it’s instant.' })));

  function drawCount() {
    meter.classList.toggle('busy', !st.total);
    meter.firstChild.style.width = st.total ? `${Math.round((st.done / st.total) * 100)}%` : '';
    countEl.innerHTML = st.total
      ? `<b>${Math.min(st.done + (st.done < st.total ? 1 : 0), st.total)}</b><span> of ${st.total} ${st.total === 1 ? 'album' : 'albums'}</span>${st.songs ? `<em>${st.songs} songs so far${st.mine ? ` · you have ${st.mine}` : ''}</em>` : ''}`
      : '<span>Finding the albums…</span>';
  }

  function drawLast(last) {
    const key = `${last.title}|${last.tracks.length}`;
    if (key === st.lastKey) return false;
    st.lastKey = key;
    const owned = last.tracks.filter((t) => has(t));
    st.songs += last.tracks.length;
    st.mine += owned.length;
    st.albums.unshift({ title: last.title, year: last.year, n: last.tracks.length, mine: owned.length });
    st.albums.length = Math.min(st.albums.length, 6);
    if (compact) return true;
    songsHead.innerHTML = `<small>Just read</small><b>${esc(last.title)}</b>${last.year ? `<span>${esc(last.year)}</span>` : ''}`;
    const show = last.tracks.slice(0, 14);
    songsEl.replaceChildren(
      ...show.map((t, i) => {
        const li = h(`li${has(t) ? '.mine' : ''}`, null, h('i', { text: String(i + 1) }), h('span', { text: t }), has(t) ? h('em', { html: `${icon('check')}<span>You have it</span>` }) : null);
        li.style.setProperty('--i', String(i));
        return li;
      }),
      ...(last.tracks.length > show.length ? [h('li.more', { text: `and ${last.tracks.length - show.length} more` })] : [])
    );
    doneEl.replaceChildren(h('small', { text: 'Read so far' }), ...st.albums.map((a) => h('span.rd-chip', { title: `${a.n} songs${a.mine ? `, you have ${a.mine}` : ''}`, text: `${a.title}${a.year ? ` · ${a.year}` : ''}` })));
    return true;
  }

  function update(p) {
    if (!p || st.ended) return;
    if (p.artist && p.artist !== st.artist) {
      // another artist (Collection gaps moves on): start the counts again
      const other = !sameArtist(p.artist, st.artist);
      Object.assign(st, { done: 0, total: 0, title: '', songs: 0, mine: 0, albums: [], lastKey: '' });
      setArtist(p.artist);
      albumEl.textContent = 'Looking up the albums…';
      metaEl.textContent = '';
      clearTimers();
      Object.assign(rigNow, { album: '', song: '', completed: null, total: null });
      if (other) start();
      else send({ artist: st.artist });
    }
    st.done = Number(p.done) || 0;
    st.total = Number(p.total) || 0;
    const fresh = p.last && Array.isArray(p.last.tracks) ? drawLast(p.last) : false;
    if (p.title) {
      if (p.title !== st.title) {
        st.title = p.title;
        albumEl.textContent = p.title;
        albumEl.classList.remove('flip');
        void albumEl.offsetWidth; // (start the little slide again)
        albumEl.classList.add('flip');
        feed(fresh ? p : { ...p, last: null });
        if (label) {
          label.querySelector('span').textContent = initials(p.title);
          label.querySelector('img')?.remove();
          const url = p.albumId && api.coverUrl ? api.coverUrl(p.albumId, 250) : '';
          if (url) {
            const img = h('img', { src: url, alt: '', decoding: 'async' });
            img.onerror = () => img.remove();
            img.onload = () => img.naturalWidth <= 1 && img.remove();
            label.append(img);
          }
          label.style.setProperty('--hue', String([...p.title].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7)));
        }
      }
      metaEl.textContent = [p.type === 'EP' ? 'EP' : p.type ? 'Album' : '', p.year].filter(Boolean).join(' · ');
    } else if (st.total && st.done >= st.total) {
      albumEl.textContent = 'Putting it together…';
      metaEl.textContent = '';
      if (fresh) feed({ ...p, title: '' });
      else send({ completed: st.done, total: st.total });
    } else if (!st.total) send({ album: '', song: '', completed: null, total: null });
    drawCount();
  }

  function setArtist(name) {
    st.artist = name || st.artist;
    artistEl.textContent = st.artist || 'Artist';
    if (label && !st.title) label.querySelector('span').textContent = initials(st.artist);
  }

  /** The reading is over ('complete', 'cancelled' or 'error'): the animation stops and goes. */
  function finish(state = 'complete') {
    if (st.ended) return;
    st.ended = true;
    clearTimers();
    if (rig) {
      try {
        rig.update({ state });
        rig.destroy();
      } catch (_) {}
      rig = null;
    }
    host.replaceChildren();
  }

  drawCount();
  return { el, update, setArtist, finish, state: st, rig: () => rig };
}

/** A matcher for "do I have this song" by one artist, from the library's songs. */
export function libraryHas(songs, artist) {
  const titles = new Set();
  for (const s of songs) if (sameArtist(s.artist, artist)) titles.add(norm(s.title));
  return (title) => titles.has(norm(title));
}
