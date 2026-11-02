'use strict';
/**
 * 4.0.4: which songs are official (paid) Rocksmith DLC.
 *
 * A file with no creator stamp isn't proof: many custom songs have none either. So a song
 * is official only when it has no creator stamp AND its artist and title are on the list of
 * official DLC (src/main/data/official-songs.json, built by scripts/official-songs.js from
 * Wikipedia's "List of downloadable songs for Rocksmith"; DLC ended in March 2020).
 */
const LIST = require('../data/official-songs.json');

/** Loose form for comparing names: case, accents, "the", "feat.", brackets and punctuation don't count. */
function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, ' ')
    .replace(/\s(feat\.?|ft\.?|featuring|with)\s.*$/, ' ')
    .replace(/&|\+/g, ' and ')
    .replace(/^\s*the\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

class OfficialList {
  constructor(pairs = LIST) {
    this.byTitle = new Map(); // title -> [artist]
    for (const [a, t] of pairs) {
      const k = norm(t);
      if (!k) continue;
      if (!this.byTitle.has(k)) this.byTitle.set(k, []);
      this.byTitle.get(k).push(norm(a));
    }
    this.count = pairs.length;
  }

  /** True when the song's artist and title are on the official list. */
  has(artist, title) {
    const artists = this.byTitle.get(norm(title));
    const a = norm(artist);
    if (!artists || !a) return false;
    // "Jimi Hendrix" vs "The Jimi Hendrix Experience", "Santana" vs "Santana feat. Rob Thomas"
    return artists.some((x) => x === a || (Math.min(x.length, a.length) >= 4 && (x.includes(a) || a.includes(x))));
  }

  /** Official DLC: no creator stamp in the file and on the list. */
  isOfficial(song) {
    if (!song || song.toolkit || song.author || song.packageVersion) return false;
    return this.has(song.artist, song.title);
  }
}

module.exports = { OfficialList, norm };
