'use strict';
/**
 * Test helper: copies a fixture .psarc and gives the copy a different song
 * (song key, artist, title, album, year) by patching its manifests.
 */
const fs = require('fs');
const { Psarc, safeEdit } = require('../src/main/core/psarc');

const FIELDS = {
  songKey: ['SongKey'],
  artist: ['ArtistName', 'ArtistNameSort'],
  title: ['SongName', 'SongNameSort'],
  album: ['AlbumName', 'AlbumNameSort'],
  year: ['SongYear'],
};

async function makeSong(src, dest, meta) {
  fs.copyFileSync(src, dest);
  const p = await Psarc.open(dest);
  const reps = new Map();
  try {
    for (const n of p.names.filter((x) => /^manifests\/.+\.(json|hsan)$/i.test(x))) {
      let t = (await p.read(n)).toString('utf8');
      for (const [k, keys] of Object.entries(FIELDS)) {
        if (meta[k] === undefined) continue;
        for (const key of keys) {
          t = t.replace(new RegExp(`("${key}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|-?\\d+)`, 'g'), (_, a, old) =>
            a + (typeof meta[k] === 'number' && !old.startsWith('"') ? String(meta[k]) : JSON.stringify(String(meta[k])))
          );
        }
      }
      reps.set(n, Buffer.from(t, 'utf8'));
    }
  } finally {
    await p.close();
  }
  await safeEdit(dest, reps);
  return dest;
}

/** A minimal ZIP (stored, no compression) holding the given files. */
function makeZip(dest, files) {
  const crc32 = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(dest, Buffer.concat([...locals, cd, end]));
  return dest;
}

module.exports = { makeSong, makeZip };

if (require.main === module) {
  // node test/make_song.js <src> <dest> '{"songKey":"X","artist":"Y","title":"Z"}'
  makeSong(process.argv[2], process.argv[3], JSON.parse(process.argv[4]))
    .then((d) => console.log('wrote', d))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
