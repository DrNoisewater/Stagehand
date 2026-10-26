/**
 * Stem storage formats: a small FLAC encoder (lossless) and Opus in an Ogg
 * file (WebCodecs does the encoding; this only packs the file). Decoding uses
 * the browser's own decoders, and the result is turned back into the 16-bit
 * WAV layout the player streams from.
 */

// ===================================================================== bits
class BitWriter {
  constructor(size = 1 << 16) {
    this.buf = new Uint8Array(size);
    this.pos = 0; // bytes written
    this.acc = 0; // pending bits (up to 31)
    this.n = 0;
  }
  _grow(need) {
    if (this.pos + need <= this.buf.length) return;
    let len = this.buf.length * 2;
    while (len < this.pos + need) len *= 2;
    const b = new Uint8Array(len);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b;
  }
  write(value, bits) {
    // bits <= 32; value treated as unsigned
    while (bits > 0) {
      const take = Math.min(bits, 24 - this.n);
      const shift = bits - take;
      const part = shift >= 32 ? 0 : Math.floor(value / 2 ** shift) & ((1 << take) - 1);
      this.acc = (this.acc << take) | part;
      this.n += take;
      bits -= take;
      while (this.n >= 8) {
        this._grow(1);
        this.n -= 8;
        this.buf[this.pos++] = (this.acc >>> this.n) & 255;
      }
      this.acc &= (1 << this.n) - 1;
    }
  }
  unary(q) {
    // q zeros then a one
    while (q >= 24) {
      this.write(0, 24);
      q -= 24;
    }
    this.write(1, q + 1);
  }
  align() {
    if (this.n) this.write(0, 8 - this.n);
  }
  bytes() {
    return this.buf.subarray(0, this.pos);
  }
}

// ===================================================================== CRCs
const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255;
  CRC8[i] = c;
  let d = i << 8;
  for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
  CRC16[i] = d;
}
const crc8 = (b, s, e) => {
  let c = 0;
  for (let i = s; i < e; i++) c = CRC8[c ^ b[i]];
  return c;
};
const crc16 = (b, s, e) => {
  let c = 0;
  for (let i = s; i < e; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]];
  return c;
};

// ===================================================================== FLAC
const BLOCK = 4096;

function fixedResidual(x, n, order, out) {
  for (let i = order; i < n; i++) {
    let p;
    switch (order) {
      case 0:
        p = 0;
        break;
      case 1:
        p = x[i - 1];
        break;
      case 2:
        p = 2 * x[i - 1] - x[i - 2];
        break;
      case 3:
        p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3];
        break;
      default:
        p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
    }
    out[i] = x[i] - p;
  }
}

const zig = (r) => (r << 1) ^ (r >> 31);

/**
 * Best Rice partitioning for a residual: { p, ks, bits }. Sums of the mapped
 * residual are taken once at the finest split and merged upwards; the cost of
 * a parameter k is estimated as cnt·(k+1) + (sum >> k), as encoders usually do.
 */
const MAXP = 8;
const sums = new Float64Array(1 << MAXP);
function riceChoice(res, n, order) {
  let pmax = 0;
  while (pmax < MAXP && n % (1 << (pmax + 1)) === 0 && n >> (pmax + 1) > order) pmax++;
  const parts = 1 << pmax;
  const len = n >> pmax;
  for (let j = 0; j < parts; j++) {
    let sum = 0;
    for (let i = j === 0 ? order : j * len, e = (j + 1) * len; i < e; i++) sum += zig(res[i]);
    sums[j] = sum;
  }
  let best = null;
  let cur = sums.slice(0, parts);
  for (let p = pmax; p >= 0; p--) {
    const np = 1 << p;
    const plen = n >> p;
    let bits = 0;
    const ks = new Array(np);
    for (let j = 0; j < np; j++) {
      const cnt = j === 0 ? plen - order : plen;
      const sum = cur[j];
      let k = 0;
      if (cnt > 0) {
        const mean = sum / cnt;
        k = mean > 1 ? Math.min(14, Math.floor(Math.log2(mean))) : 0;
      }
      let bc = cnt * (k + 1) + Math.floor(sum / 2 ** k);
      if (k > 0) {
        const c2 = cnt * k + Math.floor(sum / 2 ** (k - 1));
        if (c2 < bc) (bc = c2), k--;
      }
      ks[j] = k;
      bits += 4 + bc;
    }
    if (!best || bits < best.bits) best = { p, ks, bits };
    if (p > 0) {
      const next = new Float64Array(np >> 1);
      for (let j = 0; j < np >> 1; j++) next[j] = cur[2 * j] + cur[2 * j + 1];
      cur = next;
    }
  }
  return best;
}

function subframeCost(x, n, bps) {
  let same = true;
  for (let i = 1; i < n && same; i++) same = x[i] === x[0];
  if (same) return { type: 'const', bits: 8 + bps };
  // all five fixed predictors in one pass
  const abs = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = x[i];
    const b = i > 0 ? x[i - 1] : 0;
    const c = i > 1 ? x[i - 2] : 0;
    const d = i > 2 ? x[i - 3] : 0;
    const e = i > 3 ? x[i - 4] : 0;
    const r0 = a;
    const r1 = a - b;
    const r2 = a - 2 * b + c;
    const r3 = a - 3 * b + 3 * c - d;
    const r4 = a - 4 * b + 6 * c - 4 * d + e;
    if (i >= 0) abs[0] += r0 < 0 ? -r0 : r0;
    if (i >= 1) abs[1] += r1 < 0 ? -r1 : r1;
    if (i >= 2) abs[2] += r2 < 0 ? -r2 : r2;
    if (i >= 3) abs[3] += r3 < 0 ? -r3 : r3;
    if (i >= 4) abs[4] += r4 < 0 ? -r4 : r4;
  }
  let order = 0;
  for (let o = 1; o <= Math.min(4, n - 1); o++) if (abs[o] < abs[order]) order = o;
  const res = new Int32Array(n);
  fixedResidual(x, n, order, res);
  const rc = riceChoice(res, n, order);
  const bits = 8 + order * bps + 6 + rc.bits;
  const verbatim = 8 + n * bps;
  if (verbatim <= bits) return { type: 'verbatim', bits: verbatim };
  return { type: 'fixed', order, res, rice: rc, bits };
}

function writeSubframe(w, x, n, bps, sf) {
  if (sf.type === 'const') {
    w.write(0, 8);
    w.write(x[0] & ((1 << bps) - 1), bps);
    return;
  }
  if (sf.type === 'verbatim') {
    w.write(0b00000010, 8);
    for (let i = 0; i < n; i++) w.write(x[i] & ((2 ** bps) - 1), bps);
    return;
  }
  w.write((0b001000 | sf.order) << 1, 8);
  for (let i = 0; i < sf.order; i++) w.write(x[i] & ((2 ** bps) - 1), bps);
  w.write(0, 2); // Rice, 4-bit parameters
  w.write(sf.rice.p, 4);
  const parts = 1 << sf.rice.p;
  const len = n >> sf.rice.p;
  for (let j = 0; j < parts; j++) {
    const k = sf.rice.ks[j];
    w.write(k, 4);
    const s = j === 0 ? sf.order : j * len;
    const e = (j + 1) * len;
    const mask = (1 << k) - 1;
    for (let i = s; i < e; i++) {
      const u = zig(sf.res[i]);
      const q = u >>> k;
      if (q + 1 + k <= 24) w.write((1 << k) | (u & mask), q + 1 + k);
      else {
        w.unary(q);
        if (k) w.write(u & mask, k);
      }
    }
  }
}

function utf8num(v) {
  if (v < 0x80) return [v];
  const out = [];
  let n = v;
  const bytes = v < 0x800 ? 2 : v < 0x10000 ? 3 : v < 0x200000 ? 4 : 5;
  for (let i = bytes - 1; i > 0; i--) {
    out.unshift(0x80 | (n & 0x3f));
    n >>= 6;
  }
  out.unshift(((0xff00 >> bytes) & 0xff) | n);
  return out;
}

/**
 * Lossless FLAC from 16-bit stereo or mono PCM.
 * left/right: Int16Array (right may be null for mono).
 */
export function encodeFlac(left, right, rate) {
  const ch = right ? 2 : 1;
  const total = left.length;
  const w = new BitWriter(Math.max(1 << 16, Math.round(total * ch * 1.2)));
  // fLaC + STREAMINFO (last metadata block)
  w.write(0x664c6143, 32);
  w.write(0x80, 8);
  w.write(34, 24);
  w.write(BLOCK, 16);
  w.write(BLOCK, 16);
  w.write(0, 24);
  w.write(0, 24);
  w.write(rate, 20);
  w.write(ch - 1, 3);
  w.write(15, 5);
  w.write(Math.floor(total / 2 ** 32) & 15, 4);
  w.write(total >>> 0, 32);
  for (let i = 0; i < 4; i++) w.write(0, 32); // no MD5
  const L = new Int32Array(BLOCK);
  const R = new Int32Array(BLOCK);
  const M = new Int32Array(BLOCK);
  const S = new Int32Array(BLOCK);
  let frame = 0;
  for (let off = 0; off < total; off += BLOCK, frame++) {
    const n = Math.min(BLOCK, total - off);
    for (let i = 0; i < n; i++) {
      L[i] = left[off + i];
      if (ch === 2) {
        R[i] = right[off + i];
        S[i] = L[i] - R[i];
        M[i] = (L[i] + R[i]) >> 1;
      }
    }
    let assign;
    let subs;
    if (ch === 1) {
      assign = 0;
      subs = [[L, 16, subframeCost(L, n, 16)]];
    } else {
      const cl = subframeCost(L, n, 16);
      const cr = subframeCost(R, n, 16);
      const cm = subframeCost(M, n, 16);
      const cs = subframeCost(S, n, 17);
      const opts = [
        [1, cl.bits + cr.bits, [[L, 16, cl], [R, 16, cr]]],
        [8, cl.bits + cs.bits, [[L, 16, cl], [S, 17, cs]]],
        [9, cs.bits + cr.bits, [[S, 17, cs], [R, 16, cr]]],
        [10, cm.bits + cs.bits, [[M, 16, cm], [S, 17, cs]]],
      ];
      opts.sort((a, b) => a[1] - b[1]);
      assign = opts[0][0];
      subs = opts[0][2];
    }
    w.align();
    const start = w.pos;
    w.write(0b11111111111110, 14);
    w.write(0, 1);
    w.write(0, 1); // fixed blocksize stream
    w.write(0b0111, 4); // blocksize in 16 bits at the end of the header
    w.write(0b0000, 4); // sample rate from STREAMINFO
    w.write(assign, 4);
    w.write(0b100, 3); // 16 bits per sample
    w.write(0, 1);
    for (const b of utf8num(frame)) w.write(b, 8);
    w.write(n - 1, 16);
    w.write(crc8(w.buf, start, w.pos), 8);
    for (const [x, bps, sf] of subs) writeSubframe(w, x, n, bps, sf);
    w.align();
    w.write(crc16(w.buf, start, w.pos), 16);
  }
  return w.bytes().slice();
}

// ===================================================================== Ogg
const OGG_CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i << 24;
  for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  OGG_CRC[i] = c >>> 0;
}
function oggCrc(b) {
  let c = 0;
  for (let i = 0; i < b.length; i++) c = ((c << 8) ^ OGG_CRC[((c >>> 24) ^ b[i]) & 255]) >>> 0;
  return c >>> 0;
}

function oggPage(packets, { granule, serial, seq, flags }) {
  const lace = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lace.push(255);
      n -= 255;
    }
    lace.push(n);
  }
  const size = 27 + lace.length + packets.reduce((a, p) => a + p.length, 0);
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  b.set([0x4f, 0x67, 0x67, 0x53], 0);
  b[4] = 0;
  b[5] = flags;
  dv.setUint32(6, granule % 2 ** 32, true);
  dv.setUint32(10, Math.floor(granule / 2 ** 32), true);
  dv.setUint32(14, serial, true);
  dv.setUint32(18, seq, true);
  b[26] = lace.length;
  b.set(lace, 27);
  let p = 27 + lace.length;
  for (const pk of packets) {
    b.set(pk, p);
    p += pk.length;
  }
  dv.setUint32(22, oggCrc(b), true);
  return b;
}

export function opusSupported() {
  return typeof AudioEncoder !== 'undefined';
}

/**
 * Opus in an Ogg file from planar float stereo. bitrate in bits/s (e.g. 192000).
 */
const delayCache = new Map();
/**
 * The encoder resamples to 48 kHz inside, which adds a little delay on top of
 * its usual start-up samples. Measured once per sample rate (an impulse in,
 * where it comes out) and added to the file's pre-skip, so stems stay lined
 * up with the song to the sample.
 */
async function extraDelay(rate) {
  if (delayCache.has(rate)) return delayCache.get(rate);
  const n = rate;
  const L = new Float32Array(n);
  L[n >> 1] = 0.9;
  const bytes = await encodeOpus(L, L, rate, 192000, 0);
  const d = await decodeTo(bytes.buffer.slice(0), rate, n);
  let best = 0;
  let at = n >> 1;
  for (let i = 0; i < n; i++) if (Math.abs(d.L[i]) > best) (best = Math.abs(d.L[i])), (at = i);
  const delay48 = Math.round(((at - (n >> 1)) * 48000) / rate);
  delayCache.set(rate, delay48);
  return delay48;
}

export async function encodeOpus(L, R, rate, bitrate, extra) {
  if (extra === undefined) extra = await extraDelay(rate);
  if (!opusSupported()) throw new Error('This version of Stagehand can’t encode Opus.');
  const packets = [];
  let description = null;
  let err = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new Uint8Array(chunk.byteLength);
      chunk.copyTo(d);
      packets.push(d);
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !description) description = new Uint8Array(meta.decoderConfig.description);
    },
    error: (e) => (err = e),
  });
  enc.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: 2, bitrate, bitrateMode: 'variable', opus: { complexity: 10, frameDuration: 20000, application: 'audio' } });
  const CH = 4800;
  for (let off = 0; off < L.length; off += CH) {
    const n = Math.min(CH, L.length - off);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(off, off + n), 0);
    data.set(R.subarray(off, off + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / rate) * 1e6), data });
    enc.encode(ad);
    ad.close();
    if (enc.encodeQueueSize > 64) await new Promise((r) => setTimeout(r, 0));
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
  let preSkip = 312;
  if (description && description.length >= 12 && String.fromCharCode(...description.subarray(0, 8)) === 'OpusHead') preSkip = description[10] | (description[11] << 8);
  preSkip = Math.max(0, preSkip + (extra || 0));
  const head = new Uint8Array(19);
  const hv = new DataView(head.buffer);
  head.set([...'OpusHead'].map((c) => c.charCodeAt(0)), 0);
  head[8] = 1;
  head[9] = 2;
  hv.setUint16(10, preSkip, true);
  hv.setUint32(12, rate, true);
  hv.setInt16(16, 0, true);
  head[18] = 0;
  const vendor = new TextEncoder().encode('Stagehand');
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set([...'OpusTags'].map((c) => c.charCodeAt(0)), 0);
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  const serial = (Math.random() * 2 ** 31) >>> 0;
  const pages = [oggPage([head], { granule: 0, serial, seq: 0, flags: 2 }), oggPage([tags], { granule: 0, serial, seq: 1, flags: 0 })];
  const total48 = Math.round((L.length * 48000) / rate);
  const PER = 50; // packets per page (1 s)
  let seq = 2;
  for (let i = 0; i < packets.length; i += PER) {
    const group = packets.slice(i, i + PER);
    const last = i + PER >= packets.length;
    const granule = last ? preSkip + total48 : (i + group.length) * 960;
    pages.push(oggPage(group, { granule, serial, seq: seq++, flags: last ? 4 : 0 }));
  }
  const size = pages.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(size);
  let p = 0;
  for (const pg of pages) {
    out.set(pg, p);
    p += pg.length;
  }
  return out;
}

// ==================================================================== decode
/** Any audio file the browser can decode → planar floats at `rate`, exactly `frames` long (when given). */
export async function decodeTo(arrayBuffer, rate, frames) {
  const ctx = new OfflineAudioContext(2, 1, rate);
  const ab = await ctx.decodeAudioData(arrayBuffer);
  const n = frames || ab.length;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const a = ab.getChannelData(0);
  const b = ab.numberOfChannels > 1 ? ab.getChannelData(1) : a;
  L.set(a.subarray(0, n));
  R.set(b.subarray(0, n));
  return { L, R };
}

/** Planar floats → a 16-bit stereo WAV (the layout the player streams). */
export function wavFrom(L, R, rate) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const tag = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + n * 4, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  tag(36, 'data');
  dv.setUint32(40, n * 4, true);
  const pcm = new Int16Array(buf, 44, n * 2);
  for (let i = 0; i < n; i++) {
    pcm[i * 2] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
    pcm[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
  }
  return buf;
}

/** 16-bit WAV bytes → Int16 left/right (and floats). */
export function wavChannels(buffer, wav) {
  const n = wav.frames;
  const ch = wav.channels;
  const src = new Int16Array(buffer, wav.dataOffset, n * ch);
  const l = new Int16Array(n);
  const r = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = src[i * ch];
    r[i] = ch > 1 ? src[i * ch + 1] : src[i * ch];
  }
  return { l, r };
}

export const FORMATS = [
  { id: 'wav', label: 'Original (WAV)', ext: 'wav', note: 'What the separation writes. Biggest.' },
  { id: 'flac', label: 'Lossless (FLAC)', ext: 'flac', note: 'A perfect copy, about half the size.' },
  { id: 'opus256', label: 'Opus 256 kbps', ext: 'opus', bitrate: 256000, note: 'Compressed, very high quality.' },
  { id: 'opus192', label: 'Opus 192 kbps', ext: 'opus', bitrate: 192000, note: 'Compressed, high quality.' },
  { id: 'opus128', label: 'Opus 128 kbps', ext: 'opus', bitrate: 128000, note: 'Compressed, smallest.' },
];
