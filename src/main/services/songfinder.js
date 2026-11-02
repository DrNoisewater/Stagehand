'use strict';
/**
 * Looks for Rocksmith song files on this PC that aren't in your library yet
 * (4.0): your Downloads (and your import folder), a few folders deep. Only
 * reads names and sizes; nothing is moved until you choose to add them.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SKIP = /^(node_modules|\.git|AppData|\$RECYCLE\.BIN|System Volume Information|Backups)$/i;

/**
 * @param {string[]} places folders to look in
 * @param {{ have: Set<string>, haveNames: Set<string>, depth?: number, max?: number }} o
 *   have: paths already in the library (lower case); haveNames: their file names (lower case)
 * @returns {Promise<{path:string, name:string, size:number}[]>}
 */
async function findSongs(places, { have = new Set(), haveNames = new Set(), depth = 4, max = 2000 } = {}) {
  const out = [];
  const seen = new Set();
  const walk = async (dir, d) => {
    if (out.length >= max || d > depth) return;
    let ents;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of ents) {
      if (out.length >= max) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIP.test(e.name)) await walk(p, d + 1);
      } else if (e.isFile() && /_p\.psarc$|\.psarc$/i.test(e.name)) {
        const key = p.toLowerCase();
        const name = e.name.toLowerCase();
        if (have.has(key) || haveNames.has(name) || seen.has(name)) continue; // already in the library, or the same file twice
        seen.add(name);
        let size = 0;
        try {
          size = (await fsp.stat(p)).size;
        } catch (_) {}
        out.push({ path: p, name: e.name, size });
      }
    }
  };
  for (const p of places) if (p && fs.existsSync(p)) await walk(p, 0);
  return out;
}

module.exports = { findSongs };
