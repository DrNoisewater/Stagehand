'use strict';
/**
 * DDS (DXT1/DXT3/DXT5/uncompressed) decoding and a small PNG encoder,
 * used to turn Rocksmith album art into images the UI can show.
 */
const zlib = require('zlib');

function rgb565(c) {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

function decodeColorBlock(src, off, out, w, h, bx, by, alphaMode, forceFour) {
  const c0 = src.readUInt16LE(off);
  const c1 = src.readUInt16LE(off + 2);
  const bits = src.readUInt32LE(off + 4);
  const p0 = rgb565(c0);
  const p1 = rgb565(c1);
  const pal = [
    [...p0, 255],
    [...p1, 255],
  ];
  if (c0 > c1 || forceFour) {
    pal.push([((2 * p0[0] + p1[0]) / 3) | 0, ((2 * p0[1] + p1[1]) / 3) | 0, ((2 * p0[2] + p1[2]) / 3) | 0, 255]);
    pal.push([((p0[0] + 2 * p1[0]) / 3) | 0, ((p0[1] + 2 * p1[1]) / 3) | 0, ((p0[2] + 2 * p1[2]) / 3) | 0, 255]);
  } else {
    pal.push([(p0[0] + p1[0]) >> 1, (p0[1] + p1[1]) >> 1, (p0[2] + p1[2]) >> 1, 255]);
    pal.push([0, 0, 0, alphaMode ? 255 : 0]);
  }
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = bx + px;
      const y = by + py;
      if (x >= w || y >= h) continue;
      const idx = (bits >> (2 * (py * 4 + px))) & 3;
      const o = (y * w + x) * 4;
      out[o] = pal[idx][0];
      out[o + 1] = pal[idx][1];
      out[o + 2] = pal[idx][2];
      out[o + 3] = pal[idx][3];
    }
  }
}

function decodeDds(buf) {
  if (buf.length < 128 || buf.toString('latin1', 0, 4) !== 'DDS ') throw new Error('Not a DDS image');
  const h = buf.readUInt32LE(12);
  const w = buf.readUInt32LE(16);
  const pfFlags = buf.readUInt32LE(80);
  const fourCC = buf.toString('latin1', 84, 88);
  const bitCount = buf.readUInt32LE(88);
  const masks = [buf.readUInt32LE(92), buf.readUInt32LE(96), buf.readUInt32LE(100), buf.readUInt32LE(104)];
  if (!w || !h || w > 8192 || h > 8192) throw new Error('Bad DDS size');
  const out = Buffer.alloc(w * h * 4);
  let off = 128;
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);

  if (pfFlags & 4) {
    if (fourCC === 'DXT1') {
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++, off += 8) decodeColorBlock(buf, off, out, w, h, x * 4, y * 4, false, false);
    } else if (fourCC === 'DXT3' || fourCC === 'DXT5') {
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++, off += 16) {
          decodeColorBlock(buf, off + 8, out, w, h, x * 4, y * 4, true, true);
          const alphas = new Array(16);
          if (fourCC === 'DXT3') {
            for (let i = 0; i < 8; i++) {
              const b = buf[off + i];
              alphas[i * 2] = (b & 15) * 17;
              alphas[i * 2 + 1] = (b >> 4) * 17;
            }
          } else {
            const a0 = buf[off];
            const a1 = buf[off + 1];
            const pal = [a0, a1];
            if (a0 > a1) for (let i = 1; i < 7; i++) pal.push((((7 - i) * a0 + i * a1) / 7) | 0);
            else {
              for (let i = 1; i < 5; i++) pal.push((((5 - i) * a0 + i * a1) / 5) | 0);
              pal.push(0, 255);
            }
            let bits = 0n;
            for (let i = 0; i < 6; i++) bits |= BigInt(buf[off + 2 + i]) << BigInt(8 * i);
            for (let i = 0; i < 16; i++) alphas[i] = pal[Number((bits >> BigInt(3 * i)) & 7n)];
          }
          for (let i = 0; i < 16; i++) {
            const px = x * 4 + (i % 4);
            const py = y * 4 + ((i / 4) | 0);
            if (px < w && py < h) out[(py * w + px) * 4 + 3] = alphas[i];
          }
        }
      }
    } else {
      throw new Error(`Unsupported DDS format ${fourCC}`);
    }
  } else if (bitCount === 32 || bitCount === 24) {
    const bpp = bitCount / 8;
    const shift = (m) => (m ? Math.log2(m & -m) : 0);
    const width = (m) => (m ? Math.log2((m >>> shift(m)) + 1) : 0);
    const chan = (px, m) => {
      if (!m) return 255;
      const v = (px & m) >>> shift(m);
      const bitsN = width(m);
      return bitsN >= 8 ? v >>> (bitsN - 8) : Math.round((v * 255) / ((1 << bitsN) - 1));
    };
    for (let i = 0; i < w * h; i++) {
      const px = bpp === 4 ? buf.readUInt32LE(off + i * 4) : buf.readUIntLE(off + i * 3, 3);
      out[i * 4] = chan(px, masks[0]);
      out[i * 4 + 1] = chan(px, masks[1]);
      out[i * 4 + 2] = chan(px, masks[2]);
      out[i * 4 + 3] = masks[3] ? chan(px, masks[3]) : 255;
    }
  } else {
    throw new Error('Unsupported DDS pixel format');
  }
  return { width: w, height: h, rgba: out };
}

let CRC_TABLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { decodeDds, encodePng, crc32 };
