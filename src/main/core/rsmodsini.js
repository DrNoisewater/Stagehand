'use strict';
/**
 * Song list names live in RSMods.ini (Rocksmith install folder), which the
 * RSMods mod reads to replace "SONG LIST N" in the game:
 *
 *   [SongListTitles]
 *   SongListTitle_1 = Drop D
 *   ...
 *   SongListTitle_20 = ...
 *
 * Edits change only those lines; every other line, the line endings and
 * any BOM stay exactly as they were.
 */
const SECTION = 'SongListTitles';
const MAX_LISTS = 20;
const MAX_LEN = 25; // RSMods: "Keep under ~25 characters"

const isPlaceholder = (v) => !v || /^define song list \d+ here$/i.test(v) || /^song list( \d+)?$/i.test(v);

function split(text) {
  const bom = text.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : body.includes('\n') ? '\n' : '\r\n';
  const lines = body.split(/\r\n|\n/);
  return { bom, eol, lines };
}

function sectionRange(lines) {
  const start = lines.findIndex((l) => new RegExp(`^\\s*\\[${SECTION}\\]\\s*$`, 'i').test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Returns 20 entries: the custom name, or null when unset/placeholder. */
function readTitles(text) {
  const out = new Array(MAX_LISTS).fill(null);
  if (!text) return out;
  const { lines } = split(text);
  const r = sectionRange(lines);
  if (!r) return out;
  for (let i = r.start + 1; i < r.end; i++) {
    const m = /^\s*SongListTitle_(\d+)\s*=(.*)$/i.exec(lines[i]);
    if (!m) continue;
    const n = Number(m[1]);
    const v = m[2].trim();
    if (n >= 1 && n <= MAX_LISTS) out[n - 1] = isPlaceholder(v) ? null : v;
  }
  return out;
}

function cleanName(name) {
  return String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sets names. `names` maps list index (0-based) -> name; an empty name puts
 * the stock "Song List N" back. Returns the new text.
 */
function setTitles(text, names) {
  const { bom, eol, lines } = split(text || '');
  if (!text) lines.length = 0;
  let r = sectionRange(lines);
  if (!r) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`[${SECTION}]`);
    r = { start: lines.length - 1, end: lines.length };
  }
  const want = {};
  for (const [k, v] of Object.entries(names)) {
    const idx = Number(k);
    if (!(idx >= 0 && idx < MAX_LISTS)) throw new Error('Unknown song list');
    const name = cleanName(v);
    if (name.length > MAX_LEN) throw Object.assign(new Error(`Keep names to ${MAX_LEN} characters so they fit in the game`), { code: 'RS_NAME_LONG' });
    want[idx + 1] = name || `Song List ${idx + 1}`;
  }
  // Replace existing lines in place.
  let lastKey = r.start;
  for (let i = r.start + 1; i < r.end; i++) {
    const m = /^(\s*)SongListTitle_(\d+)(\s*)=/i.exec(lines[i]);
    if (!m) continue;
    lastKey = i;
    const n = Number(m[2]);
    if (n in want) {
      lines[i] = `SongListTitle_${n} = ${want[n]}`;
      delete want[n];
    }
  }
  // Add missing keys after the last title line, in order.
  const missing = Object.keys(want)
    .map(Number)
    .sort((a, b) => a - b);
  if (missing.length) lines.splice(lastKey + 1, 0, ...missing.map((n) => `SongListTitle_${n} = ${want[n]}`));
  let out = lines.join(eol);
  const endedWithEol = !text || /\r?\n$/.test(text);
  if (endedWithEol && !out.endsWith(eol)) out += eol;
  if (!endedWithEol && out.endsWith(eol)) out = out.slice(0, -eol.length);
  return bom + out;
}

module.exports = { readTitles, setTitles, cleanName, isPlaceholder, MAX_LISTS, MAX_LEN };
