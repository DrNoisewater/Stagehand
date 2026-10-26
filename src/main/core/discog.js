'use strict';
/**
 * Artist discographies from MusicBrainz, and comparing them with the library.
 * Pure functions over MusicBrainz JSON (ws/2, fmt=json) so they can be tested
 * without the network.
 */

// Release groups that are not the artist's own studio work.
const SKIP_SECONDARY = new Set(['live', 'compilation', 'remix', 'dj-mix', 'mixtape/street', 'demo', 'interview', 'audiobook', 'audio drama', 'spokenword', 'field recording']);

/** Folds a title for comparison: case, accents, punctuation, "(Remastered)", "- Live" ... */
function normTitle(s) {
  let t = String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  // Strip edition notes in brackets: (Remastered 2009), [Live], (feat. X), (Radio Edit)
  t = t.replace(/[([][^)\]]*(remaster|live|version|edit|mix|mono|stereo|demo|acoustic|feat|ft\.|bonus|deluxe|explicit|instrumental|re-?record|session)[^)\]]*[)\]]/g, ' ');
  // " - Remastered 2011", " - Live at ..."
  t = t.replace(/\s[-–—]\s.*(remaster|live|version|edit|mix|mono|stereo|demo|acoustic|bonus|re-?record|single).*$/g, ' ');
  t = t.replace(/\bfeat(\.|uring)?\s.*$/g, ' ');
  t = t.replace(/&/g, ' and ');
  t = t.replace(/^the\s+/, '');
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  return t;
}

function normArtist(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Best match from /ws/2/artist?query=... */
function pickArtists(json, name) {
  const want = normArtist(name);
  const list = (json && Array.isArray(json.artists) ? json.artists : []).map((a) => ({
    id: a.id,
    name: a.name,
    disambiguation: a.disambiguation || '',
    country: a.country || '',
    type: a.type || '',
    score: Number(a.score) || 0,
    exact: normArtist(a.name) === want,
  }));
  list.sort((a, b) => b.exact - a.exact || b.score - a.score);
  return list;
}

/**
 * Songs from /ws/2/recording?query=...; one row per distinct artist + title,
 * preferring a studio album release for the album/year shown.
 */
function recordingsFrom(json) {
  const recs = json && Array.isArray(json.recordings) ? json.recordings : [];
  const out = [];
  const seen = new Set();
  for (const r of recs) {
    if (!r || !r.title) continue;
    const credit = Array.isArray(r['artist-credit']) ? r['artist-credit'] : [];
    const artist = credit.map((c) => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim();
    const artistId = credit[0] && credit[0].artist ? credit[0].artist.id : null;
    const key = `${normArtist(artist)}|${normTitle(r.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rels = (Array.isArray(r.releases) ? r.releases : []).filter((x) => x && (!x.status || /official/i.test(x.status)));
    const studio = rels.find((x) => {
      const g = x['release-group'] || {};
      return /album|ep/i.test(g['primary-type'] || '') && !(g['secondary-types'] || []).some((t) => SKIP_SECONDARY.has(String(t).toLowerCase()));
    });
    const rel = studio || rels[0] || null;
    const date = (rel && rel.date) || r['first-release-date'] || '';
    out.push({
      id: r.id,
      title: r.title,
      artist,
      artistId,
      album: rel ? rel.title : '',
      albumId: rel && rel['release-group'] ? rel['release-group'].id : null,
      year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
      length: Number(r.length) || null,
      score: Number(r.score) || 0,
    });
  }
  return out;
}

/** Studio albums and EPs from /ws/2/release-group?artist=..&type=album|ep */
function albumsFrom(json) {
  const groups = json && Array.isArray(json['release-groups']) ? json['release-groups'] : [];
  return groups
    .filter((g) => g && g.id && ['album', 'ep'].includes(String(g['primary-type'] || '').toLowerCase()))
    .filter((g) => !(g['secondary-types'] || []).some((t) => SKIP_SECONDARY.has(String(t).toLowerCase())))
    .map((g) => ({
      id: g.id,
      title: g.title,
      type: String(g['primary-type']),
      year: /^\d{4}/.test(g['first-release-date'] || '') ? Number(g['first-release-date'].slice(0, 4)) : null,
      date: g['first-release-date'] || '',
    }))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.title.localeCompare(b.title));
}

/**
 * Picks the original edition from /ws/2/release?release-group=..&inc=recordings
 * (earliest official release; fewer bonus tracks on ties) and returns its tracks.
 */
function tracksFrom(json) {
  const releases = (json && Array.isArray(json.releases) ? json.releases : []).filter((r) => r && Array.isArray(r.media));
  if (!releases.length) return [];
  const official = releases.filter((r) => !r.status || /official/i.test(r.status));
  const pool = official.length ? official : releases;
  const count = (r) => r.media.reduce((n, m) => n + (Array.isArray(m.tracks) ? m.tracks.length : 0), 0);
  pool.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || count(a) - count(b));
  const best = pool.find((r) => count(r) > 0);
  if (!best) return [];
  const out = [];
  for (const m of best.media) {
    for (const t of m.tracks || []) {
      const title = (t.recording && t.recording.title) || t.title;
      if (!title) continue;
      out.push({ title: t.title || title, length: Number(t.length || (t.recording && t.recording.length)) || null });
    }
  }
  return out;
}

/**
 * Compares a discography with the library.
 * @param albums [{id,title,year,tracks:[{title,length}]}]
 * @param songs  library songs by this artist [{id,title}]
 * Returns albums with each track marked {have, songId}, plus totals.
 * A song title seen on an earlier album is listed once (first album wins).
 */
function compare(albums, songs) {
  const byTitle = new Map();
  for (const s of songs) {
    const k = normTitle(s.title);
    if (k && !byTitle.has(k)) byTitle.set(k, s);
  }
  const seen = new Set();
  let total = 0;
  let have = 0;
  const out = [];
  for (const a of albums) {
    const tracks = [];
    for (const t of a.tracks || []) {
      const k = normTitle(t.title);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const song = byTitle.get(k);
      tracks.push({ title: t.title, length: t.length, key: k, have: !!song, songId: song ? song.id : null });
      total++;
      if (song) have++;
    }
    if (tracks.length) out.push({ ...a, tracks });
  }
  // Library songs that matched nothing (live cuts, covers, singles) are reported too.
  const matched = new Set(out.flatMap((a) => a.tracks.filter((t) => t.have).map((t) => t.songId)));
  const extras = songs.filter((s) => !matched.has(s.id));
  return { albums: out, total, have, missing: total - have, extras };
}

module.exports = { normTitle, normArtist, pickArtists, albumsFrom, tracksFrom, recordingsFrom, compare, SKIP_SECONDARY };
