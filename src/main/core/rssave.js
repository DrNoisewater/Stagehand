'use strict';
/**
 * Rocksmith 2014 save files (*_PRFLDB profiles and LocalProfiles.json).
 *
 * Layout (from rsrtools and Rocksmith2014.NET, which agree):
 *   16-byte header  "EVAS" | u32 version | u64 profile id
 *   u32 LE          size of the JSON payload including its trailing NUL
 *   AES-256-ECB     zlib(payload) padded to 16 bytes
 *
 * Edits are made by splicing new text into the original JSON, so every byte
 * Stagehand does not mean to change stays exactly as Rocksmith wrote it.
 */
const crypto = require('crypto');
const zlib = require('zlib');

const SAVE_KEY = Buffer.from('728B369E24ED0134768511021812AFC0A3C25D02065F166B4BCC58CD2644F29E', 'hex');
const HEADER = 16;
const LIST_COUNT = 6; // the game's own song lists
const MAX_LISTS = 20; // RSMods can show up to 20

class SaveError extends Error {
  constructor(message, code = 'RS_SAVE_INVALID') {
    super(message);
    this.code = code;
  }
}

function ecb(decrypt) {
  const c = decrypt ? crypto.createDecipheriv('aes-256-ecb', SAVE_KEY, null) : crypto.createCipheriv('aes-256-ecb', SAVE_KEY, null);
  c.setAutoPadding(false);
  return c;
}

/** Decodes a save file. Returns { header, text, size } (text without the NUL). */
function decode(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER + 4 + 16) throw new SaveError('File is too small to be a Rocksmith save');
  if (buf.toString('latin1', 0, 4) !== 'EVAS') throw new SaveError('Not a Rocksmith save file (bad magic)');
  const header = Buffer.from(buf.subarray(0, HEADER));
  const size = buf.readUInt32LE(HEADER);
  const enc = buf.subarray(HEADER + 4);
  if (enc.length % 16 !== 0) throw new SaveError('Encrypted data is not a whole number of blocks');
  const c = ecb(true);
  const dec = Buffer.concat([c.update(enc), c.final()]);
  let payload;
  try {
    payload = zlib.inflateSync(dec);
  } catch (err) {
    throw new SaveError(`Could not decompress the save data (${err.message})`);
  }
  if (payload.length !== size) throw new SaveError(`Save data is ${payload.length} bytes but the header says ${size}`);
  if (payload[payload.length - 1] !== 0) throw new SaveError('Save data is not NUL terminated');
  return { header, size, text: payload.subarray(0, payload.length - 1).toString('utf8') };
}

/** rsrtools-style padding: a NUL, then the pad length repeated. */
function pad16(buf) {
  const n = (16 - (buf.length % 16)) % 16;
  if (!n) return buf;
  const p = Buffer.alloc(n, n);
  p[0] = 0;
  return Buffer.concat([buf, p]);
}

/** Encodes JSON text with the given 16-byte header. */
function encode(header, text) {
  if (!Buffer.isBuffer(header) || header.length !== HEADER || header.toString('latin1', 0, 4) !== 'EVAS') throw new SaveError('Bad save header');
  const payload = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0])]);
  const z = pad16(zlib.deflateSync(payload, { level: 9 }));
  const c = ecb(false);
  const enc = Buffer.concat([c.update(z), c.final()]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  return Buffer.concat([header, size, enc]);
}

// ------------------------------------------------------------ JSON spans --
/**
 * Finds the byte span of the value at `path` (keys and array indexes)
 * without building the whole tree. Returns {start, end} into `text` or null.
 */
function findSpan(text, path) {
  let i = 0;
  const n = text.length;
  const ws = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i++;
  };
  const fail = (m) => {
    throw new SaveError(`Unexpected profile JSON (${m} at ${i})`);
  };
  const str = () => {
    if (text[i] !== '"') fail('expected string');
    const s = i++;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') i += 2;
      else if (ch === '"') {
        i++;
        return text.slice(s, i);
      } else i++;
    }
    fail('unterminated string');
  };
  const skip = () => {
    ws();
    const ch = text[i];
    if (ch === '"') return str();
    if (ch === '{' || ch === '[') {
      let depth = 0;
      while (i < n) {
        const c = text[i];
        if (c === '"') {
          str();
          continue;
        }
        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') {
          depth--;
          if (depth === 0) {
            i++;
            return;
          }
        }
        i++;
      }
      fail('unterminated container');
    }
    const m = /^-?[0-9.eE+-]+|^true|^false|^null/.exec(text.slice(i, i + 40));
    if (!m) fail('bad value');
    i += m[0].length;
  };
  const descend = (depth) => {
    ws();
    if (depth === path.length) {
      const start = i;
      skip();
      return { start, end: i };
    }
    const want = path[depth];
    if (text[i] === '{') {
      i++;
      ws();
      if (text[i] === '}') return null;
      for (;;) {
        ws();
        const key = JSON.parse(str());
        ws();
        if (text[i] !== ':') fail('expected ":"');
        i++;
        if (key === want) return descend(depth + 1);
        skip();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') return null;
        fail('expected "," or "}"');
      }
    }
    if (text[i] === '[') {
      if (typeof want !== 'number') return null;
      i++;
      ws();
      if (text[i] === ']') return null;
      for (let idx = 0; ; idx++) {
        if (idx === want) return descend(depth + 1);
        skip();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        return null;
      }
    }
    return null;
  };
  return descend(0);
}

function quoteAscii(s) {
  return JSON.stringify(String(s)).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** One song list in Rocksmith's own layout. */
function formatList(keys) {
  return keys.length ? `[\n${keys.map(quoteAscii).join(',\n')}\n]` : '[\n]';
}

/** All song lists in Rocksmith's own layout. */
function formatLists(lists) {
  return `[\n${lists.map((l) => `\n${formatList(l)}`).join(',\n')}\n]`;
}

function splice(text, span, insert) {
  return text.slice(0, span.start) + insert + text.slice(span.end);
}

function cleanKeys(list) {
  const out = [];
  const seen = new Set();
  for (const k of list || []) {
    if (typeof k !== 'string' || !k.trim()) continue;
    if (seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

/** Reads the song lists out of profile JSON text. */
function readLists(text) {
  const doc = JSON.parse(text);
  const root = doc.SongListsRoot && Array.isArray(doc.SongListsRoot.SongLists) ? doc.SongListsRoot.SongLists : null;
  const favRoot = doc.FavoritesListRoot && Array.isArray(doc.FavoritesListRoot.FavoritesList) ? doc.FavoritesListRoot.FavoritesList : null;
  const lists = [];
  const count = Math.max(LIST_COUNT, root ? root.length : 0);
  for (let i = 0; i < count; i++) lists.push(root && Array.isArray(root[i]) ? root[i].filter((k) => typeof k === 'string') : []);
  return { lists, favorites: favRoot ? favRoot.filter((k) => typeof k === 'string') : [], hasLists: !!root, hasFavorites: !!favRoot };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!(k in b) || !deepEqual(a[k], b[k])) return false;
  return true;
}

/**
 * Replaces song lists and/or favorites in profile JSON text.
 * `next` = { lists?: Array<string[]|undefined>, count?: number, favorites?: string[] }
 * `count` sets how many song lists there are (6 to 20); extra lists are
 * added empty or removed from the end.
 * Returns the new text; throws if the result is not exactly the old
 * document with only those lists changed.
 */
function patchLists(text, next) {
  const before = JSON.parse(text);
  let out = text;
  const expected = JSON.parse(text);

  if (next.lists) {
    const span = findSpan(out, ['SongListsRoot', 'SongLists']);
    if (!span) throw new SaveError('This profile has no song lists yet. Open Song Lists in Rocksmith once, then try again.', 'RS_NO_LISTS');
    const current = JSON.parse(out.slice(span.start, span.end));
    if (!Array.isArray(current)) throw new SaveError('Unexpected song list data in the profile');
    const merged = current.slice();
    while (merged.length < LIST_COUNT) merged.push([]);
    if (next.count !== undefined) {
      if (!(Number.isInteger(next.count) && next.count >= LIST_COUNT && next.count <= Math.max(MAX_LISTS, current.length))) {
        throw new SaveError(`Rocksmith can have ${LIST_COUNT} to ${MAX_LISTS} song lists`, 'RS_LIST_COUNT');
      }
      while (merged.length < next.count) merged.push([]);
      merged.length = next.count;
    }
    next.lists.forEach((l, i) => {
      if (!l) return;
      if (i >= merged.length) throw new SaveError('That song list does not exist', 'RS_BAD_LIST');
      merged[i] = cleanKeys(l);
    });
    for (let i = 0; i < merged.length; i++) if (!Array.isArray(merged[i])) throw new SaveError('Unexpected song list data in the profile');
    out = splice(out, span, formatLists(merged));
    expected.SongListsRoot.SongLists = merged;
  }
  if (next.favorites) {
    const span = findSpan(out, ['FavoritesListRoot', 'FavoritesList']);
    if (!span) throw new SaveError('This profile has no favorites list yet. Favorite one song in Rocksmith, then try again.', 'RS_NO_LISTS');
    const fav = cleanKeys(next.favorites);
    out = splice(out, span, formatList(fav));
    expected.FavoritesListRoot.FavoritesList = fav;
  }
  const after = JSON.parse(out);
  if (!deepEqual(after, expected)) throw new SaveError('Song list edit verification failed; nothing was written', 'RS_VERIFY');
  void before;
  return out;
}

/** Sets LastModified for one profile in LocalProfiles.json text (raw "123.000000" form). */
function patchLastModified(text, uniqueId, seconds) {
  const doc = JSON.parse(text);
  const profiles = Array.isArray(doc.Profiles) ? doc.Profiles : [];
  const idx = profiles.findIndex((p) => p && String(p.UniqueID).toLowerCase() === String(uniqueId).toLowerCase());
  if (idx < 0 || !('LastModified' in profiles[idx])) return { text, changed: false };
  const span = findSpan(text, ['Profiles', idx, 'LastModified']);
  if (!span) return { text, changed: false };
  const raw = `${Math.floor(seconds)}.000000`;
  const out = splice(text, span, raw);
  const expected = JSON.parse(text);
  expected.Profiles[idx].LastModified = Math.floor(seconds);
  if (!deepEqual(JSON.parse(out), expected)) throw new SaveError('LocalProfiles edit verification failed', 'RS_VERIFY');
  return { text: out, changed: out !== text };
}

/** Updates Steam Cloud metadata for one file in remotecache.vdf text. */
function patchRemoteCache(text, fileName, { size, sha, mtime }) {
  const esc = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`("${esc}"\\s*\\{)([^{}]*)(\\})`, 'i');
  const m = re.exec(text);
  if (!m) return { text, changed: false };
  let body = m[2];
  const set = (key, value) => {
    const r = new RegExp(`("${key}"\\s+")[^"]*(")`, 'i');
    if (r.test(body)) body = body.replace(r, `$1${value}$2`);
  };
  set('size', String(size));
  set('sha', String(sha).toLowerCase());
  set('localtime', String(Math.floor(mtime)));
  set('time', String(Math.floor(mtime)));
  const out = text.slice(0, m.index) + m[1] + body + m[3] + text.slice(m.index + m[0].length);
  return { text: out, changed: out !== text };
}

module.exports = { decode, encode, findSpan, readLists, patchLists, patchLastModified, patchRemoteCache, formatList, formatLists, SaveError, LIST_COUNT, MAX_LISTS, SAVE_KEY };
