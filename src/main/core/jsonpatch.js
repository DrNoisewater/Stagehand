'use strict';
/**
 * Format-preserving JSON edits.
 *
 * Scans the raw bytes of a JSON document, finds the byte span of selected
 * values and swaps only those spans. Indentation, line endings, key order,
 * number formatting, BOM and any non-ASCII text stay byte-identical.
 */

class JsonScanError extends Error {}

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

/**
 * @param {Buffer} buf
 * @param {(path: string[]) => boolean} wants  called for every value; return
 *        true to record its span.
 * @returns {Array<{path:string[], start:number, end:number, kind:string}>}
 */
function scan(buf, wants) {
  const s = buf.toString('latin1'); // one char per byte, so indexes are byte offsets
  let i = 0;
  if (s.charCodeAt(0) === 0xef && s.charCodeAt(1) === 0xbb && s.charCodeAt(2) === 0xbf) i = 3;
  const hits = [];

  const skipWs = () => {
    while (i < s.length && WS.has(s.charCodeAt(i))) i++;
  };
  const fail = (msg) => {
    throw new JsonScanError(`${msg} at byte ${i}`);
  };

  const readString = () => {
    if (s[i] !== '"') fail('Expected string');
    const start = i;
    i++;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 0x5c) {
        i += 2;
        continue;
      }
      if (c === 0x22) {
        i++;
        return s.slice(start, i);
      }
      i++;
    }
    fail('Unterminated string');
  };

  const value = (path) => {
    skipWs();
    const start = i;
    const c = s[i];
    let kind;
    if (c === '{') {
      kind = 'object';
      i++;
      skipWs();
      if (s[i] === '}') {
        i++;
      } else {
        for (;;) {
          skipWs();
          const rawKey = readString();
          const key = JSON.parse(Buffer.from(rawKey, 'latin1').toString('utf8'));
          skipWs();
          if (s[i] !== ':') fail('Expected ":"');
          i++;
          value(path.concat(key));
          skipWs();
          if (s[i] === ',') {
            i++;
            continue;
          }
          if (s[i] === '}') {
            i++;
            break;
          }
          fail('Expected "," or "}"');
        }
      }
    } else if (c === '[') {
      kind = 'array';
      i++;
      skipWs();
      if (s[i] === ']') {
        i++;
      } else {
        let idx = 0;
        for (;;) {
          value(path.concat(String(idx++)));
          skipWs();
          if (s[i] === ',') {
            i++;
            continue;
          }
          if (s[i] === ']') {
            i++;
            break;
          }
          fail('Expected "," or "]"');
        }
      }
    } else if (c === '"') {
      kind = 'string';
      readString();
    } else {
      const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i, i + 64));
      if (!m) fail('Unexpected token');
      kind = m[1] === 'true' || m[1] === 'false' ? 'boolean' : m[1] === 'null' ? 'null' : 'number';
      i += m[1].length;
    }
    if (wants(path)) hits.push({ path, start, end: i, kind });
  };

  value([]);
  skipWs();
  if (i !== s.length && s.charCodeAt(i) !== 0) fail('Trailing data');
  return hits;
}

/** Parses a JSON buffer, tolerating a UTF-8 BOM. */
function parse(buf) {
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

function literal(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    return Buffer.from(String(value), 'utf8');
  }
  return Buffer.from(JSON.stringify(String(value)), 'utf8');
}

/**
 * Replaces values at the given paths.
 * @param {Buffer} buf
 * @param {Array<{path:string[], value:any}>} edits
 * @returns {{buffer: Buffer, applied: number}}
 */
function patch(buf, edits) {
  const keyOf = (p) => JSON.stringify(p);
  const want = new Map(edits.map((e) => [keyOf(e.path), e]));
  const hits = scan(buf, (p) => want.has(keyOf(p)));
  const replacements = [];
  for (const h of hits) {
    const e = want.get(keyOf(h.path));
    if (h.kind === 'object' || h.kind === 'array') continue; // never replace structure
    const lit = literal(e.value);
    const old = buf.subarray(h.start, h.end);
    if (old.equals(lit)) continue;
    replacements.push({ start: h.start, end: h.end, lit });
  }
  if (!replacements.length) return { buffer: buf, applied: 0 };
  replacements.sort((a, b) => a.start - b.start);
  const parts = [];
  let cur = 0;
  for (const r of replacements) {
    parts.push(buf.subarray(cur, r.start), r.lit);
    cur = r.end;
  }
  parts.push(buf.subarray(cur));
  return { buffer: Buffer.concat(parts), applied: replacements.length };
}

function getPath(obj, path) {
  let o = obj;
  for (const k of path) {
    if (o === null || typeof o !== 'object' || !(k in o)) return undefined;
    o = o[k];
  }
  return o;
}

function setPath(obj, path, v) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = v;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

/**
 * Patch + prove: the patched document must parse, and must equal the
 * original document with exactly the requested values changed.
 */
function patchVerified(buf, edits) {
  const before = parse(buf);
  const { buffer, applied } = patch(buf, edits);
  if (!applied) return { buffer: buf, applied: 0 };
  const after = parse(buffer);
  const expected = parse(buf);
  for (const e of edits) {
    if (getPath(expected, e.path) !== undefined) setPath(expected, e.path, e.value);
  }
  if (!deepEqual(after, expected)) throw new Error('JSON edit verification failed');
  void before;
  return { buffer, applied };
}

module.exports = { scan, parse, patch, patchVerified, JsonScanError, deepEqual };
