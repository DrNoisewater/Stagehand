'use strict';
/**
 * Rocksmith 2014 song metadata: extraction from a PSARC and safe edits.
 */
const jsonpatch = require('./jsonpatch');

const STANDARD = [40, 45, 50, 55, 59, 64]; // MIDI notes E2 A2 D3 G3 B3 E4
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const TUNINGS = [
  ['E Standard', [0, 0, 0, 0, 0, 0]],
  ['Drop D', [-2, 0, 0, 0, 0, 0]],
  ['Eb Standard', [-1, -1, -1, -1, -1, -1]],
  ['Eb Drop Db', [-3, -1, -1, -1, -1, -1]],
  ['D Standard', [-2, -2, -2, -2, -2, -2]],
  ['D Drop C', [-4, -2, -2, -2, -2, -2]],
  ['C# Standard', [-3, -3, -3, -3, -3, -3]],
  ['C# Drop B', [-5, -3, -3, -3, -3, -3]],
  ['C Standard', [-4, -4, -4, -4, -4, -4]],
  ['C Drop A#', [-6, -4, -4, -4, -4, -4]],
  ['B Standard', [-5, -5, -5, -5, -5, -5]],
  ['B Drop A', [-7, -5, -5, -5, -5, -5]],
  ['Bb Standard', [-6, -6, -6, -6, -6, -6]],
  ['A Standard', [-7, -7, -7, -7, -7, -7]],
  ['F Standard', [1, 1, 1, 1, 1, 1]],
  ['F# Standard', [2, 2, 2, 2, 2, 2]],
  ['Double Drop D', [-2, 0, 0, 0, 0, -2]],
  ['DADGAD', [-2, 0, 0, 0, -2, -2]],
  ['Open D', [-2, 0, 0, -1, -2, -2]],
  ['Open G', [-2, -2, 0, 0, 0, -2]],
  ['Open E', [0, 2, 2, 1, 0, 0]],
  ['Open A', [0, 0, 2, 2, 2, 0]],
  ['Open C', [-4, -2, -2, 0, 1, 0]],
  ['Open C6', [-4, 0, -2, 0, 1, 0]],
];
// Friendlier aliases for the "drop" family that most players use.
const ALIASES = { 'Eb Drop Db': 'Drop C#', 'D Drop C': 'Drop C', 'C# Drop B': 'Drop B', 'C Drop A#': 'Drop A#', 'B Drop A': 'Drop A' };

function tuningArray(t) {
  if (!t || typeof t !== 'object') return null;
  const out = [];
  for (let i = 0; i < 6; i++) out.push(Number(t[`string${i}`]) || 0);
  return out;
}

function noteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

function tuningName(arr, isBass = false) {
  if (!arr) return null;
  const n = isBass ? 4 : 6;
  for (const [name, offs] of TUNINGS) {
    let ok = true;
    for (let i = 0; i < n; i++) if (offs[i] !== arr[i]) ok = false;
    if (ok) return ALIASES[name] || name;
  }
  const notes = [];
  for (let i = 0; i < n; i++) notes.push(noteName((isBass ? STANDARD[i] - 12 : STANDARD[i]) + arr[i]));
  return notes.join(' ');
}

function centsLabel(cents) {
  const c = Number(cents) || 0;
  if (Math.abs(c) < 1) return null;
  return `A${Math.round(440 * Math.pow(2, c / 1200))}`;
}

function arrangementType(a, fileName) {
  const name = String(a.ArrangementName || '').toLowerCase();
  const f = String(fileName || '').toLowerCase();
  if (a.JapaneseVocal || /_jvocals\.json$/.test(f)) return 'jvocals';
  if (name === 'vocals' || /_vocals\.json$/.test(f)) return 'vocals';
  if (name === 'bass') return 'bass';
  if (name === 'lead') return 'lead';
  if (name === 'rhythm') return 'rhythm';
  if (name === 'combo') {
    const p = a.ArrangementProperties || {};
    if (p.pathLead) return 'lead';
    if (p.pathRhythm) return 'rhythm';
    return 'combo';
  }
  if (name.includes('showlight')) return 'showlights';
  return name || 'other';
}

const TYPE_ORDER = { lead: 0, rhythm: 1, combo: 2, bass: 3, vocals: 4, jvocals: 5 };

function cleanSectionLabel(sec) {
  const ui = String(sec.UIName || '');
  const m = /\]\s*(.+?)\s*\[(\d+)\]\s*$/.exec(ui);
  if (m) return `${m[1]} ${m[2]}`;
  const n = String(sec.Name || 'Section');
  return n.charAt(0).toUpperCase() + n.slice(1) + (sec.Number ? ` ${sec.Number}` : '');
}

function parseToolkitVersion(text) {
  const info = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].trim().toLowerCase();
    if (k === 'toolkit version') info.toolkit = m[2].trim();
    else if (k === 'package author') info.author = m[2].trim();
    else if (k === 'package version') info.version = m[2].trim();
    else if (k === 'package comment') info.comment = m[2].trim();
  }
  return info;
}

/** Finds which .wem files a sound bank references (by little-endian id). */
function wemIdsInBank(bank, wemIds) {
  const found = [];
  for (const id of wemIds) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(id >>> 0);
    if (bank.indexOf(b) !== -1) found.push(id);
  }
  return found;
}

function audioFolderInfo(names) {
  const wems = [];
  for (const n of names) {
    const m = /^audio\/(windows|mac|xbox360|ps3)\/(\d+)\.wem$/i.exec(n);
    if (m) wems.push({ name: n, id: Number(m[2]), platform: m[1].toLowerCase() });
  }
  if (wems.length) return wems;
  // 4.0.2: some files (official DLC among them) name or place their audio differently:
  // any .wem (or Wwise .ogg) anywhere in the archive, by number when it has one
  for (const n of names) {
    if (!/\.(wem|ogg)$/i.test(n)) continue;
    const base = n.split('/').pop().replace(/\.[^.]+$/, '');
    const plat = /(?:^|\/)(windows|mac|xbox360|ps3)\//i.exec(n);
    wems.push({ name: n, id: /^\d+$/.test(base) ? Number(base) : null, platform: plat ? plat[1].toLowerCase() : 'windows' });
  }
  return wems;
}

/**
 * Audio stored inside a Wwise sound bank (DIDX index + DATA chunk) rather than as a
 * separate .wem: [{ id, offset, size }] with offsets into the bank buffer.
 */
function bankMedia(bank) {
  if (!bank || bank.length < 8) return [];
  let didx = null;
  let data = -1;
  for (let off = 0; off + 8 <= bank.length; ) {
    const tag = bank.toString('latin1', off, off + 4);
    const len = bank.readUInt32LE(off + 4);
    if (!/^[A-Z]{4}$/.test(tag) || off + 8 + len > bank.length) break;
    if (tag === 'DIDX') didx = { start: off + 8, len };
    if (tag === 'DATA') data = off + 8;
    off += 8 + len;
  }
  if (!didx || data < 0) return [];
  const out = [];
  for (let i = didx.start; i + 12 <= didx.start + didx.len; i += 12) {
    const m = { id: bank.readUInt32LE(i), offset: data + bank.readUInt32LE(i + 4), size: bank.readUInt32LE(i + 8) };
    if (m.size > 0 && m.offset + m.size <= bank.length) out.push(m);
  }
  return out;
}

/** Entry names for a song's audio: 'name' or, inside a bank, 'name#id'. */
function splitAudioEntry(entry) {
  const i = String(entry).lastIndexOf('#');
  return i < 0 ? { name: entry, media: null } : { name: entry.slice(0, i), media: Number(entry.slice(i + 1)) };
}

/** Reads a song's audio bytes from an open archive (a .wem, or media inside a bank). */
async function readAudio(psarc, entry) {
  const { name, media } = splitAudioEntry(entry);
  const buf = await psarc.read(name);
  if (media === null) return buf;
  const m = bankMedia(buf).find((x) => x.id === media);
  if (!m) throw new Error('The song audio is missing from its sound bank');
  return buf.subarray(m.offset, m.offset + m.size);
}

/** What a file holds that looks like audio, for the log when no song audio is found. */
function audioDiagnosis(names) {
  const hits = names.filter((n) => /^audio\/|\.(wem|ogg|bnk|wav)$/i.test(n));
  return hits.length ? `${hits.length} audio-like entries: ${hits.slice(0, 12).join(', ')}${hits.length > 12 ? ', …' : ''}` : `no audio entries among ${names.length} files`;
}

/**
 * Reads every song in an archive.
 * @param {import('./psarc').Psarc} psarc
 */
async function readSongs(psarc) {
  const names = psarc.names;
  const songs = new Map();
  const manifestNames = names.filter((n) => /^manifests\/.+\.json$/i.test(n));

  for (const n of manifestNames) {
    let doc;
    try {
      doc = jsonpatch.parse(await psarc.read(n));
    } catch (_) {
      continue;
    }
    const entries = doc && doc.Entries;
    if (!entries || typeof entries !== 'object') continue;
    for (const [pid, ent] of Object.entries(entries)) {
      const a = ent && ent.Attributes;
      if (!a) continue;
      const key = a.SongKey || a.DLCKey;
      if (!key) continue;
      let s = songs.get(key);
      if (!s) {
        s = { songKey: key, arrangements: [], _attrs: null };
        songs.set(key, s);
      }
      const type = arrangementType(a, n);
      if (type === 'showlights') continue;
      const props = a.ArrangementProperties || {};
      const tuning = tuningArray(a.Tuning);
      const arr = {
        id: a.PersistentID || pid,
        name: a.ArrangementName || type,
        type,
        manifest: n,
        tuning,
        tuningName: type === 'vocals' || type === 'jvocals' ? null : tuningName(tuning, type === 'bass'),
        cents: Number(a.CentOffset) || 0,
        capo: Number(a.CapoFret) || 0,
        bonus: !!props.bonusArr,
        represent: props.represent === undefined ? true : !!props.represent,
        notes: Number(a.NotesHard) || 0,
        difficulty: typeof a.SongDifficulty === 'number' ? a.SongDifficulty : null,
      };
      s.arrangements.push(arr);
      if (a.SongName && (!s._attrs || (type !== 'vocals' && s._attrsType === 'vocals'))) {
        s._attrs = a;
        s._attrsType = type;
      }
      if (!s._sections && Array.isArray(a.Sections) && a.Sections.length && (type === 'lead' || type === 'rhythm' || type === 'combo')) {
        s._sections = a.Sections;
      }
      if (!s._sectionsAny && Array.isArray(a.Sections) && a.Sections.length) s._sectionsAny = a.Sections;
      if (!s._bank && a.SongBank) s._bank = a.SongBank;
      if (!s._previewBank && a.PreviewBankPath) s._previewBank = a.PreviewBankPath;
      if (!s._event && a.SongEvent) s._event = a.SongEvent;
      if (!s._art && a.AlbumArt) s._art = a.AlbumArt;
    }
  }

  // Header (.hsan) files can fill gaps for archives whose manifests lack names.
  for (const n of names.filter((x) => /\.hsan$/i.test(x))) {
    let doc;
    try {
      doc = jsonpatch.parse(await psarc.read(n));
    } catch (_) {
      continue;
    }
    for (const ent of Object.values((doc && doc.Entries) || {})) {
      const a = ent && ent.Attributes;
      if (!a || !a.SongKey) continue;
      const s = songs.get(a.SongKey);
      if (s && !s._attrs && a.SongName) s._attrs = a;
    }
  }

  let toolkit = {};
  const tv = names.find((n) => n.toLowerCase() === 'toolkit.version');
  if (tv) {
    try {
      toolkit = parseToolkitVersion((await psarc.read(tv)).toString('utf8'));
    } catch (_) {}
  }

  // 4.0.4: signs of a custom song, for telling official DLC apart: custom files keep the
  // chart's .xml files (official ones hold only the compiled charts) and most use the
  // toolkit's stand-in Steam id (248750, Cherub Rock's).
  let appId = '';
  const ap = names.find((n) => n.toLowerCase() === 'appid.appid');
  if (ap) {
    try {
      appId = (await psarc.read(ap)).toString('utf8').trim().slice(0, 20);
    } catch (_) {}
  }
  const chartXml = names.some((n) => /^songs\/arr\/.+\.xml$/i.test(n) && !/_showlights\.xml$/i.test(n));

  const wems = audioFolderInfo(names);
  const bankCache = new Map();
  const readBank = async (bankName) => {
    if (!bankName) return null;
    if (bankCache.has(bankName)) return bankCache.get(bankName);
    const full = names.find((n) => n.toLowerCase().endsWith('/' + String(bankName).toLowerCase()));
    let data = null;
    if (full) {
      try {
        data = await psarc.read(full);
      } catch (_) {}
    }
    bankCache.set(bankName, data);
    return data;
  };

  const out = [];
  for (const s of songs.values()) {
    const a = s._attrs || {};
    s.arrangements.sort((x, y) => (TYPE_ORDER[x.type] ?? 9) - (TYPE_ORDER[y.type] ?? 9) || (x.bonus - y.bonus) || (y.represent - x.represent));
    const guitar = s.arrangements.find((x) => (x.type === 'lead' || x.type === 'rhythm' || x.type === 'combo') && x.represent && !x.bonus) ||
      s.arrangements.find((x) => x.type === 'lead' || x.type === 'rhythm' || x.type === 'combo');
    const bass = s.arrangements.find((x) => x.type === 'bass' && x.represent && !x.bonus) || s.arrangements.find((x) => x.type === 'bass');

    // Album art
    let art = null;
    const artBase = s._art ? String(s._art).split(':').pop().toLowerCase() : null;
    const artFiles = names.filter((n) => /^gfxassets\/album_art\/.+\.dds$/i.test(n));
    const pickArt = (size) =>
      artFiles.find((n) => artBase && n.toLowerCase() === `gfxassets/album_art/${artBase}_${size}.dds`) ||
      (songs.size === 1 ? artFiles.find((n) => n.toLowerCase().endsWith(`_${size}.dds`)) : null);
    art = { 256: pickArt(256) || null, 128: pickArt(128) || null, 64: pickArt(64) || null };
    if (!art[256] && !art[128] && !art[64]) art = null;

    // Main audio: the .wem referenced by the song's sound bank.
    let audio = null;
    let preview = null;
    const ids = wems.map((w) => w.id).filter((id) => id !== null);
    const sizeOf = (name) => psarc.entryFor(name).length;
    const bank = await readBank(s._bank);
    if (bank) {
      const hit = wemIdsInBank(bank, ids).map((id) => wems.find((w) => w.id === id).name);
      if (hit.length) audio = hit.reduce((best, n) => (sizeOf(n) > sizeOf(best) ? n : best), hit[0]);
    }
    const pbank = await readBank(s._previewBank);
    if (pbank) {
      const hit = wemIdsInBank(pbank, ids);
      if (hit.length) preview = wems.find((w) => w.id === hit[0]).name;
    }
    if (!audio && wems.length) {
      const candidates = wems.filter((w) => w.name !== preview);
      const pool = candidates.length ? candidates : wems;
      let best = pool[0];
      for (const w of pool) if (psarc.entryFor(w.name).length > psarc.entryFor(best.name).length) best = w;
      audio = best.name;
    }
    // 4.0.2: no separate audio file: the audio may be inside the song's sound bank
    if (!audio && bank) {
      const media = bankMedia(bank);
      if (media.length) {
        const full = names.find((n) => n.toLowerCase().endsWith('/' + String(s._bank).toLowerCase()));
        const big = media.reduce((a, b) => (b.size > a.size ? b : a));
        if (full) audio = `${full}#${big.id}`;
      }
    }

    const secs = (s._sections || s._sectionsAny || [])
      .map((x) => ({ name: String(x.Name || ''), label: cleanSectionLabel(x), start: Number(x.StartTime) || 0, end: Number(x.EndTime) || 0, solo: !!x.IsSolo }))
      .filter((x) => x.end > x.start)
      .sort((x, y) => x.start - y.start);

    out.push({
      songKey: s.songKey,
      title: a.SongName || s.songKey,
      titleSort: a.SongNameSort || '',
      artist: a.ArtistName || '',
      artistSort: a.ArtistNameSort || '',
      album: a.AlbumName || '',
      albumSort: a.AlbumNameSort || '',
      year: Number.isFinite(Number(a.SongYear)) && a.SongYear !== '' ? Number(a.SongYear) : null,
      jpTitle: a.JapaneseSongName || '',
      jpArtist: a.JapaneseArtistName || '',
      length: Number(a.SongLength) || 0,
      tempo: Number(a.SongAverageTempo) || 0,
      dlc: a.DLC !== false,
      arrangements: s.arrangements,
      tuning: guitar ? guitar.tuningName : bass ? bass.tuningName : null,
      tuningCents: guitar ? centsLabel(guitar.cents) : bass ? centsLabel(bass.cents) : null,
      bassTuning: bass ? bass.tuningName : null,
      capo: guitar ? guitar.capo : 0,
      sections: secs,
      author: toolkit.author || '',
      packageVersion: toolkit.version || '',
      packageComment: toolkit.comment || '',
      toolkit: toolkit.toolkit || '',
      appId,
      chartXml,
      art,
      audioEntry: audio,
      previewEntry: preview,
      // 4.0.3: the song's sound bank, so its audio can be looked for in other files
      bankEntry: s._bank ? names.find((n) => n.toLowerCase().endsWith('/' + String(s._bank).toLowerCase())) || null : null,
      // 4.11: what the manifest says plays this song, so its bank and audio can be found in
      // another archive when this one holds neither (Rocksmith 1 DLC: charts only)
      bankName: s._bank || null,
      songEvent: s._event || null,
      platform: wems[0] ? wems[0].platform : null,
      audioNote: audio ? undefined : audioDiagnosis(names),
    });
  }
  return out;
}

// ---------------------------------------------------------------- editing --

const FIELDS = {
  title: { json: 'SongName', xml: 'title', type: 'string' },
  titleSort: { json: 'SongNameSort', xml: 'songNameSort', type: 'string' },
  artist: { json: 'ArtistName', xml: 'artistName', type: 'string' },
  artistSort: { json: 'ArtistNameSort', xml: 'artistNameSort', type: 'string' },
  album: { json: 'AlbumName', xml: 'albumName', type: 'string' },
  albumSort: { json: 'AlbumNameSort', xml: 'albumNameSort', type: 'string' },
  year: { json: 'SongYear', xml: 'albumYear', type: 'int' },
  jpTitle: { json: 'JapaneseSongName', type: 'string' },
  jpArtist: { json: 'JapaneseArtistName', type: 'string' },
};

function sortableName(s) {
  return String(s || '')
    .trim()
    .replace(/^the\s+/i, '')
    .trim();
}

/** Validates/normalises user input. Throws with a field-specific message. */
function normalizeChanges(changes) {
  const out = {};
  for (const [k, v] of Object.entries(changes || {})) {
    const f = FIELDS[k];
    if (!f) continue;
    if (f.type === 'int') {
      const n = Number(String(v).trim());
      if (!Number.isInteger(n) || n < 0 || n > 9999) {
        const e = new Error('Year must be a whole number like 1994');
        e.field = k;
        throw e;
      }
      out[k] = n;
    } else {
      const str = String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
      if (!str && (k === 'title' || k === 'artist')) {
        const e = new Error(k === 'title' ? 'Title cannot be empty' : 'Artist cannot be empty');
        e.field = k;
        throw e;
      }
      if (str.length > 200) {
        const e = new Error('Keep text under 200 characters');
        e.field = k;
        throw e;
      }
      out[k] = str;
    }
  }
  return out;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xmlUnescape(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Replaces the first <tag>…</tag> text in an XML buffer, byte-preserving. */
function patchXml(buf, tagValues) {
  const s = buf.toString('latin1');
  const edits = [];
  for (const [tag, value] of Object.entries(tagValues)) {
    const re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
    const m = re.exec(s);
    if (!m) continue;
    const start = m.index + tag.length + 2;
    const end = start + m[1].length;
    const lit = Buffer.from(xmlEscape(value), 'utf8');
    if (buf.subarray(start, end).equals(lit)) continue;
    edits.push({ start, end, lit });
  }
  if (!edits.length) return { buffer: buf, applied: 0 };
  edits.sort((a, b) => a.start - b.start);
  const parts = [];
  let cur = 0;
  for (const e of edits) {
    parts.push(buf.subarray(cur, e.start), e.lit);
    cur = e.end;
  }
  parts.push(buf.subarray(cur));
  const out = Buffer.concat(parts);
  // verify: every requested tag now reads back as the new value
  const check = out.toString('utf8');
  for (const [tag, value] of Object.entries(tagValues)) {
    const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(check);
    if (m && xmlUnescape(m[1]) !== String(value)) throw new Error(`XML edit verification failed for <${tag}>`);
  }
  return { buffer: out, applied: edits.length };
}

/**
 * Computes the replaced files for an edit of one song inside an archive.
 * Only keys that already exist are changed; nothing is ever added.
 * @returns {Promise<Map<string, Buffer>>}
 */
async function buildEdit(psarc, songKey, rawChanges) {
  const changes = normalizeChanges(rawChanges);
  const replacements = new Map();
  if (!Object.keys(changes).length) return { replacements, changes };

  const jsonFiles = psarc.names.filter((n) => /^manifests\/.+\.(json|hsan)$/i.test(n));
  for (const n of jsonFiles) {
    const buf = await psarc.read(n);
    let doc;
    try {
      doc = jsonpatch.parse(buf);
    } catch (_) {
      continue;
    }
    const entries = doc && doc.Entries;
    if (!entries) continue;
    const edits = [];
    for (const [id, ent] of Object.entries(entries)) {
      const a = ent && ent.Attributes;
      if (!a || (a.SongKey || a.DLCKey) !== songKey) continue;
      for (const [field, value] of Object.entries(changes)) {
        const key = FIELDS[field].json;
        if (!(key in a)) continue;
        const cur = a[key];
        let v = value;
        if (FIELDS[field].type === 'int' && typeof cur === 'string') v = String(value);
        if (cur === v) continue;
        if (cur !== null && typeof cur === 'object') continue;
        edits.push({ path: ['Entries', id, 'Attributes', key], value: v });
      }
    }
    if (!edits.length) continue;
    const { buffer, applied } = jsonpatch.patchVerified(buf, edits);
    if (applied) replacements.set(n, buffer);
  }

  const prefix = `songs/arr/${String(songKey).toLowerCase()}_`;
  const xmlFiles = psarc.names.filter((n) => n.toLowerCase().startsWith(prefix) && /\.xml$/i.test(n) && !/showlights/i.test(n));
  for (const n of xmlFiles) {
    const tags = {};
    for (const [field, value] of Object.entries(changes)) if (FIELDS[field].xml) tags[FIELDS[field].xml] = value;
    const buf = await psarc.read(n);
    const { buffer, applied } = patchXml(buf, tags);
    if (applied) replacements.set(n, buffer);
  }
  return { replacements, changes };
}

module.exports = {
  readSongs,
  readAudio,
  bankMedia,
  buildEdit,
  normalizeChanges,
  sortableName,
  tuningName,
  centsLabel,
  parseToolkitVersion,
  patchXml,
  FIELDS,
};
