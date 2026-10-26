'use strict';
/**
 * PSARC reader and byte-preserving rewriter (Rocksmith 2014 flavour).
 *
 * Layout (big-endian):
 *   header (32 bytes) | TOC entries (count * 30) | block size table | data
 * The TOC + block size table are AES-CFB encrypted when (flags & 4).
 * Entry 0 is the manifest: newline-separated file names for entries 1..n.
 *
 * Rewrites never re-encode files that were not edited: their stored blocks
 * (compressed or raw, exactly as they are on disk) are copied verbatim and
 * only offsets / block indexes in the TOC are recomputed.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const aes = require('./aescfb');

const HEADER_SIZE = 32;
const FLAG_TOC_ENCRYPTED = 4;

class PsarcError extends Error {
  constructor(message, code = 'PSARC_INVALID') {
    super(message);
    this.code = code;
  }
}

function zTypeFor(blockSize) {
  let n = 1;
  while (Math.pow(256, n) < blockSize) n++;
  return n;
}

function readUIntBE(buf, off, len) {
  return buf.readUIntBE(off, len);
}

function writeUIntBE(buf, value, off, len) {
  buf.writeUIntBE(value, off, len);
}

function looksZlib(b) {
  // 0x78 0xDA (best) is what Rocksmith tools write; accept the other standard
  // zlib headers as well, falling back to raw if inflating fails.
  return b.length >= 2 && b[0] === 0x78 && (b[1] === 0xda || b[1] === 0x9c || b[1] === 0x01 || b[1] === 0x5e);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

class Psarc {
  constructor(fh, filePath, size) {
    this.fh = fh;
    this.path = filePath;
    this.size = size;
    this.header = null;
    this.entries = [];
    this.zTable = null;
    this.names = [];
    this._nameIndex = new Map();
  }

  static async open(filePath) {
    const fh = await fsp.open(filePath, 'r');
    try {
      const st = await fh.stat();
      const p = new Psarc(fh, filePath, st.size);
      await p._readToc();
      await p._readManifest();
      return p;
    } catch (err) {
      await fh.close().catch(() => {});
      throw err;
    }
  }

  async close() {
    if (this.fh) {
      const fh = this.fh;
      this.fh = null;
      await fh.close();
    }
  }

  async _readExact(position, length) {
    const buf = Buffer.allocUnsafe(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await this.fh.read(buf, done, length - done, position + done);
      if (bytesRead === 0) throw new PsarcError(`Unexpected end of file at ${position + done}`, 'PSARC_TRUNCATED');
      done += bytesRead;
    }
    return buf;
  }

  async _readToc() {
    if (this.size < HEADER_SIZE) throw new PsarcError('File is too small to be a PSARC archive');
    const raw = await this._readExact(0, HEADER_SIZE);
    const magic = raw.toString('latin1', 0, 4);
    if (magic !== 'PSAR') throw new PsarcError('Not a PSARC file (bad magic)');
    const h = {
      raw,
      versionMajor: raw.readUInt16BE(4),
      versionMinor: raw.readUInt16BE(6),
      compression: raw.toString('latin1', 8, 12),
      tocLength: raw.readUInt32BE(12),
      entrySize: raw.readUInt32BE(16),
      entryCount: raw.readUInt32BE(20),
      blockSize: raw.readUInt32BE(24),
      flags: raw.readUInt32BE(28),
    };
    if (h.compression !== 'zlib') throw new PsarcError(`Unsupported compression "${h.compression}"`, 'PSARC_UNSUPPORTED');
    if (h.entrySize < 30) throw new PsarcError('Invalid TOC entry size', 'PSARC_UNSUPPORTED');
    if (h.blockSize < 1024 || h.blockSize > 1 << 30) throw new PsarcError('Invalid block size');
    if (h.entryCount < 1) throw new PsarcError('Archive has no entries');
    const tocBytes = h.tocLength - HEADER_SIZE;
    if (tocBytes < h.entryCount * h.entrySize || h.tocLength > this.size) throw new PsarcError('Invalid TOC length');
    h.encrypted = (h.flags & FLAG_TOC_ENCRYPTED) !== 0;
    h.zType = zTypeFor(h.blockSize);

    let toc = await this._readExact(HEADER_SIZE, tocBytes);
    if (h.encrypted) toc = aes.decrypt(toc);

    const entries = [];
    for (let i = 0; i < h.entryCount; i++) {
      const o = i * h.entrySize;
      entries.push({
        index: i,
        md5: Buffer.from(toc.subarray(o, o + 16)),
        zIndex: toc.readUInt32BE(o + 16),
        length: readUIntBE(toc, o + 20, 5),
        offset: readUIntBE(toc, o + 25, 5),
      });
    }
    const zStart = h.entryCount * h.entrySize;
    const zCount = Math.floor((tocBytes - zStart) / h.zType);
    const zTable = new Uint32Array(zCount);
    for (let i = 0; i < zCount; i++) zTable[i] = readUIntBE(toc, zStart + i * h.zType, h.zType);

    for (const e of entries) {
      if (e.length > 0 && (e.zIndex >= zCount || e.offset >= this.size)) {
        throw new PsarcError(`TOC entry ${e.index} points outside the archive`);
      }
    }
    this.header = h;
    this.entries = entries;
    this.zTable = zTable;
  }

  async _readManifest() {
    const data = await this.inflateEntry(this.entries[0]);
    const text = data.data.toString('utf8');
    const names = text.length ? text.split('\n').map((s) => s.replace(/\r$/, '')) : [];
    if (names.length !== this.entries.length - 1) {
      throw new PsarcError(`Manifest lists ${names.length} files but TOC has ${this.entries.length - 1}`);
    }
    this.names = names;
    names.forEach((n, i) => this._nameIndex.set(n.toLowerCase(), i + 1));
  }

  /** Returns the TOC entry for a file name (case-insensitive) or null. */
  entryFor(name) {
    const idx = this._nameIndex.get(String(name).toLowerCase());
    return idx === undefined ? null : this.entries[idx];
  }

  nameOf(entry) {
    return entry.index === 0 ? null : this.names[entry.index - 1];
  }

  has(name) {
    return this._nameIndex.has(String(name).toLowerCase());
  }

  /**
   * Inflates one entry. Returns { data, blocks, storedSize } where blocks is
   * how many block-table slots it used and storedSize the bytes on disk.
   */
  async inflateEntry(entry) {
    const { blockSize } = this.header;
    const zTable = this.zTable;
    if (entry.length === 0) return { data: Buffer.alloc(0), blocks: 0, storedSize: 0 };

    // Read the expected stored region in one go; extend if blocks inflate short.
    let expectBlocks = Math.ceil(entry.length / blockSize);
    let span = 0;
    for (let k = 0; k < expectBlocks; k++) {
      const z = zTable[entry.zIndex + k];
      if (z === undefined) throw new PsarcError(`Block table ended early for entry ${entry.index}`);
      span += z === 0 ? blockSize : z;
    }
    let region = await this._readExact(entry.offset, Math.min(span, this.size - entry.offset));

    const parts = [];
    let got = 0;
    let rpos = 0;
    let z = entry.zIndex;
    while (got < entry.length) {
      if (z >= zTable.length) throw new PsarcError(`Block table ended early for entry ${entry.index}`);
      const s = zTable[z];
      const stored = s === 0 ? blockSize : s;
      if (rpos + stored > region.length) {
        const more = await this._readExact(entry.offset + region.length, rpos + stored - region.length);
        region = Buffer.concat([region, more]);
      }
      const blk = region.subarray(rpos, rpos + stored);
      let out = blk;
      if (s !== 0 && looksZlib(blk)) {
        try {
          out = zlib.inflateSync(blk);
        } catch (_) {
          out = blk; // raw data that merely starts like a zlib header
        }
      }
      parts.push(out);
      got += out.length;
      rpos += stored;
      z++;
    }
    let data = parts.length === 1 ? Buffer.from(parts[0]) : Buffer.concat(parts);
    if (data.length !== entry.length) {
      if (data.length > entry.length) data = data.subarray(0, entry.length);
    }
    return { data, blocks: z - entry.zIndex, storedSize: rpos };
  }

  async read(name) {
    const e = this.entryFor(name);
    if (!e) throw new PsarcError(`File not found in archive: ${name}`, 'PSARC_NOT_FOUND');
    return (await this.inflateEntry(e)).data;
  }

  /** Lightweight file listing: [{ name, length }] */
  list() {
    return this.names.map((name, i) => ({ name, length: this.entries[i + 1].length }));
  }
}

/** Splits data into zlib blocks exactly like the community toolchain. */
function blockZip(data, blockSize) {
  const chunks = [];
  const zs = [];
  for (let off = 0; off < data.length; off += blockSize) {
    const plain = data.subarray(off, Math.min(off + blockSize, data.length));
    const packed = zlib.deflateSync(plain, { level: 9 });
    if (packed.length < blockSize) {
      chunks.push(packed);
      zs.push(packed.length);
    } else {
      chunks.push(Buffer.from(plain));
      zs.push(plain.length === blockSize ? 0 : plain.length);
    }
  }
  return { chunks, zs, storedSize: chunks.reduce((n, c) => n + c.length, 0) };
}

/**
 * Writes a copy of `srcPath` to `destPath` with some files replaced.
 * `replacements` maps file name (any case) -> Buffer.
 * Returns the expectation list used by verify().
 */
async function rewrite(srcPath, replacements, destPath) {
  const repl = new Map();
  for (const [k, v] of replacements) repl.set(String(k).toLowerCase(), v);

  const src = await Psarc.open(srcPath);
  let out = null;
  try {
    const h = src.header;
    if (h.entrySize !== 30) throw new PsarcError('This PSARC variant cannot be saved safely', 'PSARC_UNSUPPORTED');
    for (const k of repl.keys()) {
      if (!src.has(k)) throw new PsarcError(`Cannot replace missing file ${k}`, 'PSARC_NOT_FOUND');
    }

    const plan = [];
    for (const entry of src.entries) {
      const name = src.nameOf(entry);
      const key = name ? name.toLowerCase() : null;
      if (key && repl.has(key)) {
        const data = repl.get(key);
        const z = blockZip(data, h.blockSize);
        plan.push({ kind: 'new', name, md5: entry.md5, length: data.length, chunks: z.chunks, zs: z.zs, storedSize: z.storedSize, hash: sha256(data) });
      } else {
        const r = await src.inflateEntry(entry);
        if (r.data.length !== entry.length) {
          throw new PsarcError(`Source file is damaged: ${name || 'manifest'} is shorter than its TOC entry`);
        }
        plan.push({
          kind: 'copy',
          name,
          md5: entry.md5,
          length: entry.length,
          srcOffset: entry.offset,
          storedSize: r.storedSize,
          zs: Array.from(src.zTable.subarray(entry.zIndex, entry.zIndex + r.blocks)),
          hash: sha256(r.data),
        });
      }
    }

    const totalBlocks = plan.reduce((n, p) => n + p.zs.length, 0);
    const zType = h.zType;
    const zMax = Math.pow(256, zType);
    const count = plan.length;
    const tocLength = HEADER_SIZE + count * 30 + totalBlocks * zType;

    const toc = Buffer.alloc(tocLength - HEADER_SIZE);
    let zIndex = 0;
    let offset = tocLength;
    plan.forEach((p, i) => {
      const o = i * 30;
      p.md5.copy(toc, o);
      toc.writeUInt32BE(zIndex, o + 16);
      writeUIntBE(toc, p.length, o + 20, 5);
      writeUIntBE(toc, offset, o + 25, 5);
      p.offset = offset;
      p.zIndex = zIndex;
      for (const z of p.zs) {
        if (z >= zMax) throw new PsarcError('Block size does not fit the block table');
        writeUIntBE(toc, z, count * 30 + zIndex * zType, zType);
        zIndex++;
      }
      offset += p.storedSize;
    });

    const header = Buffer.from(h.raw);
    header.writeUInt32BE(tocLength, 12);
    header.writeUInt32BE(count, 20);
    const tocOnDisk = h.encrypted ? aes.encrypt(toc) : toc;

    out = await fsp.open(destPath, 'w');
    let pos = 0;
    const write = async (buf) => {
      let done = 0;
      while (done < buf.length) {
        const { bytesWritten } = await out.write(buf, done, buf.length - done, pos + done);
        done += bytesWritten;
      }
      pos += buf.length;
    };
    await write(header);
    await write(tocOnDisk);
    const CHUNK = 1 << 20;
    for (const p of plan) {
      if (pos !== p.offset) throw new PsarcError('Internal layout error while writing');
      if (p.kind === 'new') {
        for (const c of p.chunks) await write(c);
      } else {
        for (let done = 0; done < p.storedSize; done += CHUNK) {
          const n = Math.min(CHUNK, p.storedSize - done);
          await write(await src._readExact(p.srcOffset + done, n));
        }
      }
    }
    await out.sync();
    await out.close();
    out = null;

    return {
      size: pos,
      names: src.names.slice(),
      expected: plan.map((p) => ({ name: p.name, md5: p.md5.toString('hex'), length: p.length, hash: p.hash })),
      replaced: plan.filter((p) => p.kind === 'new').map((p) => p.name),
    };
  } finally {
    if (out) await out.close().catch(() => {});
    await src.close();
  }
}

/** Re-reads an archive and checks every entry against expectations. */
async function verify(filePath, { names, expected, size }) {
  const st = await fsp.stat(filePath);
  if (size !== undefined && st.size !== size) throw new PsarcError('Written file has the wrong size', 'PSARC_VERIFY');
  const p = await Psarc.open(filePath);
  try {
    if (p.entries.length !== expected.length) throw new PsarcError('Entry count changed', 'PSARC_VERIFY');
    if (names && (names.length !== p.names.length || names.some((n, i) => n !== p.names[i]))) {
      throw new PsarcError('File list changed', 'PSARC_VERIFY');
    }
    for (let i = 0; i < p.entries.length; i++) {
      const e = p.entries[i];
      const x = expected[i];
      if (e.md5.toString('hex') !== x.md5) throw new PsarcError(`Name hash mismatch at entry ${i}`, 'PSARC_VERIFY');
      if (e.length !== x.length) throw new PsarcError(`Length mismatch for ${x.name || 'manifest'}`, 'PSARC_VERIFY');
      const { data } = await p.inflateEntry(e);
      if (data.length !== x.length || sha256(data) !== x.hash) {
        throw new PsarcError(`Content mismatch for ${x.name || 'manifest'}`, 'PSARC_VERIFY');
      }
    }
  } finally {
    await p.close();
  }
  return true;
}

async function renameWithRetry(from, to, attempts = 8) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  const e = new PsarcError(
    'The file is locked by another program (is Rocksmith running?). Close it and try again.',
    'FILE_LOCKED'
  );
  e.cause = lastErr;
  throw e;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Safely replaces files inside a PSARC:
 * write temp copy -> verify every entry -> back up original -> atomic rename.
 * The original is never modified in place.
 */
async function safeEdit(filePath, replacements, { backupDir = null, keepBackups = 5 } = {}) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${crypto.randomBytes(4).toString('hex')}.stagehand-tmp`);
  let backupPath = null;
  try {
    const result = await rewrite(filePath, replacements, tmp);
    await verify(tmp, result);
    if (backupDir) {
      const folder = path.join(backupDir, base.replace(/\.psarc$/i, ''));
      await fsp.mkdir(folder, { recursive: true });
      backupPath = path.join(folder, `${stamp()}_${base}`);
      await fsp.copyFile(filePath, backupPath);
      const [a, b] = await Promise.all([fsp.stat(filePath), fsp.stat(backupPath)]);
      if (a.size !== b.size) throw new PsarcError('Backup copy is incomplete; nothing was changed', 'BACKUP_FAILED');
      await pruneBackups(folder, keepBackups);
    }
    await renameWithRetry(tmp, filePath);
    return { replaced: result.replaced, backupPath, size: result.size };
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function pruneBackups(folder, keep) {
  if (!keep || keep < 1) return;
  const files = (await fsp.readdir(folder)).filter((f) => /\.psarc$/i.test(f)).sort();
  const extra = files.length - keep;
  for (let i = 0; i < extra; i++) await fsp.unlink(path.join(folder, files[i])).catch(() => {});
}

/** Restores a backup over the live file (the live file is backed up first). */
async function restoreBackup(backupPath, filePath, opts = {}) {
  const probe = await Psarc.open(backupPath); // must be a readable archive
  await probe.close();
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(4).toString('hex')}.stagehand-tmp`);
  try {
    await fsp.copyFile(backupPath, tmp);
    const [a, b] = await Promise.all([fsp.stat(backupPath), fsp.stat(tmp)]);
    if (a.size !== b.size) throw new PsarcError('Copy failed', 'RESTORE_FAILED');
    const check = await Psarc.open(tmp);
    await check.close();
    if (opts.backupDir && fs.existsSync(filePath)) {
      const folder = path.join(opts.backupDir, path.basename(filePath).replace(/\.psarc$/i, ''));
      await fsp.mkdir(folder, { recursive: true });
      await fsp.copyFile(filePath, path.join(folder, `${stamp()}_before-restore_${path.basename(filePath)}`));
    }
    await renameWithRetry(tmp, filePath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

module.exports = { Psarc, PsarcError, rewrite, verify, safeEdit, restoreBackup, blockZip, sha256 };
