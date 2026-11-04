/**
 * 3.10: how the search box matches songs. Pure (no DOM), shared by the song
 * list (store.js) and the suggestions under the box (searchbox.js).
 * Forgiving: accents, punctuation and "&" don't matter, run-together names
 * ("acdc") and small typos ("metalica") still find the song, and results are
 * ranked: the whole query as a title or artist first, then word starts.
 */
/** Lower case, no accents or punctuation ("AC/DC" → "ac dc", "Mötley Crüe" → "motley crue", "Guns N' Roses" → "guns n roses", "E♭" → "eb"). */
export function normText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\p{L})\s*♭/gu, '$1b') // "E♭ Standard" = "eb standard"
    .replace(/(\p{L})\s*[♯#]/gu, '$1sharp') // "C♯" = "c#" = "csharp"
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const songIndex = new WeakMap();
export function indexed(s) {
  let f = songIndex.get(s);
  if (f) return f;
  const file = String(s.fileName || '').replace(/\.psarc$/i, '').replace(/_p$/i, '');
  f = { title: normText(s.title), artist: normText(s.artist), album: normText(s.album), other: normText(`${s.year || ''} ${s.author || ''} ${s.tuning || ''} ${file}`) };
  f.all = `${f.title} ${f.artist} ${f.album} ${f.other}`;
  f.compact = ` ${f.title.replace(/ /g, '')} ${f.artist.replace(/ /g, '')} ${f.album.replace(/ /g, '')} `;
  f.words = [...new Set(f.all.split(' '))].filter((w) => w.length >= 3);
  songIndex.set(s, f);
  return f;
}

/** How well one normalised field matches a term: 1 whole field, .8 starts with it, .6 a word starts with it, .35 inside a word. */
export function fieldScore(field, t) {
  if (!field || !t) return 0;
  if (field === t) return 1;
  if (field.startsWith(t)) return 0.8;
  if (` ${field}`.includes(` ${t}`)) return 0.6;
  if (field.includes(t)) return 0.35;
  return 0;
}

/** Edit distance, giving up past `max`. */
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // two letters swapped ("teh") is one slip, not two
      if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** A typo: "metalica", "nirvanna", "smels". Words of 4+ letters only. */
export function typoMatch(t, words) {
  if (t.length < 4) return false;
  const max = t.length >= 7 ? 2 : 1;
  for (const w of words) {
    if (within(t, w, max)) return true;
    if (w.length > t.length && within(t, w.slice(0, t.length), 1)) return true; // still typing
  }
  return false;
}

function termScore(f, t) {
  const best = Math.max(fieldScore(f.title, t) * 100, fieldScore(f.artist, t) * 90, fieldScore(f.album, t) * 55, fieldScore(f.other, t) * 40);
  if (best) return best;
  if (t.length >= 3 && f.compact.includes(t)) return 22; // "acdc", "rhcp"-style run-together words
  return typoMatch(t, f.words) ? 8 : 0;
}

/** 0 = no match; higher = better. Every word you typed has to be somewhere in the song. */
export function matchSong(s, terms, full) {
  const f = indexed(s);
  let sum = 0;
  for (const t of terms) {
    const sc = termScore(f, t);
    if (!sc) return 0;
    sum += sc;
  }
  // the whole query as a title or an artist counts most
  if (terms.length > 1 || full.length > 1) {
    sum += fieldScore(f.title, full) * 160 + fieldScore(f.artist, full) * 120;
    const both = `${f.artist} ${f.title}`;
    if (both.startsWith(full)) sum += 60;
  }
  return sum;
}

/** How well a name (artist, album, tuning, setlist) fits what you typed. */
function nameScore(name, terms, q) {
  const n = normText(name);
  if (!n) return 0;
  const whole = fieldScore(n, q);
  if (whole) return whole * 100;
  let sum = 0;
  for (const t of terms) {
    const sc = fieldScore(n, t);
    if (!sc) {
      sum = 0;
      break;
    }
    sum += sc;
  }
  if (sum) return (sum / terms.length) * 45;
  if (q.length >= 3 && n.replace(/ /g, '').includes(q.replace(/ /g, ''))) return 30;
  return typoMatch(q.replace(/ /g, ''), [n.replace(/ /g, ''), ...n.split(' ')]) || terms.every((t) => typoMatch(t, n.split(' '))) ? 10 : 0;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Suggestions for the search box, in groups (best group first):
 * songs, artists, albums, tunings, years and setlists that fit.
 * Each item: { kind, label, sub, score, ...what to open }.
 */
export function suggest(raw, songs, setlists = [], { perGroup = { song: 5, artist: 3, album: 3, tuning: 2, year: 1, setlist: 2 } } = {}) {
  const q = normText(raw);
  if (!q) return [];
  const terms = q.split(' ');
  const hits = [];
  const artists = new Map();
  const albums = new Map();
  const tunings = new Map();
  const years = new Map();
  for (const s of songs) {
    const sc = matchSong(s, terms, q);
    if (sc) hits.push({ kind: 'song', id: s.id, label: s.title || s.fileName || 'Untitled', sub: [s.artist, s.tuning].filter(Boolean).join(' · '), score: sc });
    if (s.artist) {
      const k = normText(s.artist);
      const a = artists.get(k) || { name: s.artist, n: 0 };
      a.n++;
      artists.set(k, a);
    }
    if (s.album) {
      const k = `${normText(s.artist)}\u0000${normText(s.album)}`;
      const a = albums.get(k) || { name: s.album, artist: s.artist || '', n: 0 };
      a.n++;
      albums.set(k, a);
    }
    const tu = s.tuning || '';
    if (tu) tunings.set(tu, (tunings.get(tu) || 0) + 1);
    if (s.year) years.set(s.year, (years.get(s.year) || 0) + 1);
  }
  const groups = { song: hits.sort((a, b) => b.score - a.score) };
  groups.artist = [...artists.values()]
    .map((a) => ({ kind: 'artist', id: a.name, label: a.name, sub: plural(a.n, 'song'), score: nameScore(a.name, terms, q) * 1.05 + Math.min(a.n, 20) * 0.2 }))
    .filter((x) => x.score >= 1);
  groups.album = [...albums.values()]
    .map((a) => ({ kind: 'album', id: a.name, artist: a.artist, label: a.name, sub: [a.artist, plural(a.n, 'song')].filter(Boolean).join(' · '), score: nameScore(a.name, terms, q) * 0.85 }))
    .filter((x) => x.score >= 1);
  groups.tuning = [...tunings]
    .map(([name, n]) => ({ kind: 'tuning', id: name, label: name, sub: plural(n, 'song'), score: fieldScore(normText(name), q) * 80 }))
    .filter((x) => x.score > 0);
  groups.year = /^\d{4}$/.test(q) && years.has(Number(q)) ? [{ kind: 'year', id: Number(q), label: q, sub: plural(years.get(Number(q)), 'song'), score: 70 }] : [];
  groups.setlist = setlists
    .map((sl) => ({ kind: 'setlist', id: sl.id, label: sl.name, sub: plural((sl.songIds || []).length, 'song'), score: nameScore(sl.name, terms, q) }))
    .filter((x) => x.score >= 1);
  // groups go best first; a name that fits what you typed beats songs that only match through it
  const weight = { song: 1, artist: 2.8, album: 2.2, tuning: 2.8, year: 3, setlist: 2.2 };
  const out = [];
  for (const [kind, list] of Object.entries(groups)) {
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, perGroup[kind] || 3);
    if (top.length) out.push({ kind, items: top, best: top[0].score * weight[kind], more: list.length - top.length });
  }
  return out.sort((a, b) => b.best - a.best);
}

/** The rest of the best suggestion that starts with what you typed ("metal" → "lica"), for Tab to finish. */
export function completion(raw, groups) {
  if (!raw || /\s$/.test(raw)) return '';
  const low = raw.toLowerCase();
  for (const g of groups)
    for (const it of g.items) {
      const l = String(it.label);
      if (l.length > raw.length && l.toLowerCase().startsWith(low)) return l.slice(raw.length);
    }
  return '';
}
