'use strict';
/**
 * Builds src/main/data/official-songs.json (artist and title of every official Rocksmith
 * DLC song) from the wikitext of Wikipedia's "List of downloadable songs for Rocksmith".
 * Usage: node scripts/official-songs.js <page.wiki> [out.json]
 */
const fs = require('fs');
const path = require('path');

/** Splits at `sep` outside [[ ]] and {{ }}. */
function splitTop(s, sep, max = Infinity) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; cur += two; i++; continue; }
    if ((two === ']]' || two === '}}') && depth > 0) { depth--; cur += two; i++; continue; }
    if (depth === 0 && s.startsWith(sep, i) && out.length < max) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

function clean(s) {
  return s
    .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”]+|["“”]+$/g, '')
    .replace(/"/g, "") // "Holy Diver" (Dio cover)
    .trim();
}

function parseCell(raw) {
  const parts = splitTop(raw, '|', 1);
  let attrs = '';
  let body = raw;
  if (parts.length === 2 && /^\s*(rowspan|colspan|style|class|align|scope)\s*=/i.test(parts[0])) {
    attrs = parts[0];
    body = parts[1];
  } else if (/^\s*(rowspan|colspan)\s*=\s*"?\d+"?(\s+(rowspan|colspan)\s*=\s*"?\d+"?)*\s*\{\{/i.test(raw)) {
    attrs = raw.replace(/\{\{[\s\S]*$/, '');
    body = raw.slice(attrs.length);
  }
  const num = (k) => Math.max(1, parseInt((new RegExp(k + '\\s*=\\s*"?(\\d+)', 'i').exec(attrs) || [])[1] || '1', 10));
  return { text: clean(body), rs: num('rowspan'), cs: num('colspan') };
}

function songs(wiki) {
  const start = wiki.indexOf('{|');
  const end = wiki.indexOf('\n|}', start);
  const body = wiki.slice(start, end);
  const rows = body.split(/\n\|-[^\n]*/).slice(1);
  const carry = [];
  const out = [];
  let header = null;
  for (const r of rows) {
    const cells = [];
    let head = false;
    for (const line of r.split('\n')) {
      if (!line.trim()) continue;
      if (line.startsWith('!')) { head = true; cells.push(...splitTop(line.slice(1), '!!')); continue; }
      if (line.startsWith('|')) { cells.push(...splitTop(line.replace(/^\|\|?/, ''), '||')); continue; }
      if (cells.length) cells[cells.length - 1] += ' ' + line; // a cell carried on to the next line
    }
    if (!cells.length) continue;
    if (head) { header = cells.map((c) => clean(c).toLowerCase()); continue; }
    const row = [];
    let col = 0;
    const fill = () => {
      while (carry[col] && carry[col].left > 0) { row[col] = carry[col].text; carry[col].left--; col++; }
    };
    for (const raw of cells) {
      fill();
      const c = parseCell(raw);
      for (let k = 0; k < c.cs; k++) {
        row[col] = c.text;
        carry[col] = c.rs > 1 ? { text: c.text, left: c.rs - 1 } : null;
        col++;
      }
    }
    fill();
    const ti = header ? header.findIndex((h) => /^song/.test(h)) : 0;
    const ai = header ? header.findIndex((h) => /^artist/.test(h)) : 1;
    if (row[ti] && row[ai]) out.push([row[ai], row[ti]]);
  }
  return out;
}

if (require.main === module) {
  const [src, dest = path.join(__dirname, '..', 'src', 'main', 'data', 'official-songs.json')] = process.argv.slice(2);
  const list = songs(fs.readFileSync(src, 'utf8'));
  fs.writeFileSync(dest, '[\n' + list.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
  console.log(`${list.length} songs -> ${dest}`);
}

module.exports = { songs };
