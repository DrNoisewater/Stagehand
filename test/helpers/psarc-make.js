'use strict';
/** Test helper: writes a small PSARC (plain table of contents) and Wwise song banks shaped like Rocksmith's. */
const fs = require('fs');
const crypto = require('crypto');
const { blockZip } = require('../../src/main/core/psarc');
const { fnv1 } = require('../../src/main/core/wwise');

const BLOCK = 65536;
function u40(n) {
  const b = Buffer.alloc(5);
  b.writeUInt8(Math.floor(n / 2 ** 32), 0);
  b.writeUInt32BE(n >>> 0, 1);
  return b;
}

/** files: { 'path/in/archive': Buffer } */
function makePsarc(file, files) {
  const names = Object.keys(files);
  const blobs = [Buffer.from(names.join('\n'), 'utf8'), ...names.map((n) => files[n])];
  const packed = blobs.map((b) => blockZip(b, BLOCK));
  const zs = packed.flatMap((p) => p.zs);
  const tocLen = 32 + blobs.length * 30 + zs.length * 2;
  const head = Buffer.alloc(32);
  head.write('PSAR', 0, 'latin1');
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(4, 6);
  head.write('zlib', 8, 'latin1');
  head.writeUInt32BE(tocLen, 12);
  head.writeUInt32BE(30, 16);
  head.writeUInt32BE(blobs.length, 20);
  head.writeUInt32BE(BLOCK, 24);
  head.writeUInt32BE(0, 28);
  const toc = [];
  let off = tocLen;
  let zi = 0;
  blobs.forEach((b, i) => {
    const e = Buffer.alloc(30);
    if (i) crypto.createHash('md5').update(names[i - 1]).digest().copy(e, 0);
    e.writeUInt32BE(zi, 16);
    u40(b.length).copy(e, 20);
    u40(off).copy(e, 25);
    toc.push(e);
    zi += packed[i].zs.length;
    off += packed[i].storedSize;
  });
  const zt = Buffer.alloc(zs.length * 2);
  zs.forEach((z, i) => zt.writeUInt16BE(z, i * 2));
  fs.writeFileSync(file, Buffer.concat([head, ...toc, zt, ...packed.flatMap((p) => p.chunks)]));
}

const chunk = (tag, body) => {
  const h = Buffer.alloc(8);
  h.write(tag, 0, 'latin1');
  h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body]);
};
const obj = (type, body) => {
  const h = Buffer.alloc(5);
  h.writeUInt8(type, 0);
  h.writeUInt32LE(body.length, 1);
  return Buffer.concat([h, body]);
};
const u32 = (...v) => {
  const b = Buffer.alloc(4 * v.length);
  v.forEach((x, i) => b.writeUInt32LE(x >>> 0, i * 4));
  return b;
};

/**
 * A song bank like Rocksmith's (version 91): its event → action → sound → media id, with a short
 * lead-in of that media inside the bank (or the whole audio when `inside` is given).
 */
function makeBank({ event, media, soundId = media ^ 0x5a5a5a5a, inside = null, extraSounds = [] }) {
  const lead = inside || Buffer.alloc(2048, 7);
  const sounds = [[soundId, media], ...extraSounds];
  const objects = [];
  for (const [sid, mid] of sounds) objects.push(obj(2, Buffer.concat([u32(sid, 0x00040001, 2, mid, mid), Buffer.alloc(63)])));
  const actionId = (soundId + 17) >>> 0;
  const action = Buffer.alloc(18);
  action.writeUInt32LE(actionId, 0);
  action.writeUInt16LE(0x0403, 4);
  action.writeUInt32LE(soundId >>> 0, 6);
  objects.push(obj(3, action));
  objects.push(obj(4, u32(fnv1(event), 1, actionId)));
  return Buffer.concat([
    chunk('BKHD', Buffer.concat([u32(91, fnv1(`bank_${event}`)), Buffer.alloc(20)])),
    chunk('DIDX', u32(media, 0, lead.length)),
    chunk('DATA', lead),
    chunk('HIRC', Buffer.concat([u32(objects.length), ...objects])),
  ]);
}

module.exports = { makePsarc, makeBank };
