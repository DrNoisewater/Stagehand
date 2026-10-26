'use strict';
/** Small file helpers: ZIP extraction, WAV header parsing, atomic JSON. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

/** Extracts a (non-zip64) ZIP archive. Returns the list of written files. */
async function unzip(zipPath, destDir, { strip = 0 } = {}) {
  const buf = await fsp.readFile(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const written = [];
  const root = path.resolve(destDir);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    let name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (strip) name = name.split('/').slice(strip).join('/');
    if (!name || name.endsWith('/')) continue;
    const out = path.resolve(root, name);
    if (!out.startsWith(root + path.sep)) throw new Error('Unsafe path in ZIP');
    const lnameLen = buf.readUInt16LE(local + 26);
    const lextraLen = buf.readUInt16LE(local + 28);
    const dataStart = local + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(dataStart, dataStart + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Unsupported ZIP compression method ${method}`);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, data);
    written.push(out);
  }
  return written;
}

/**
 * Lists a ZIP's entries by reading only its central directory, so large
 * archives in Downloads are never loaded whole.
 */
async function zipList(zipPath) {
  const fh = await fsp.open(zipPath, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 66000);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a ZIP file');
    const count = tail.readUInt16LE(eocd + 10);
    const dirSize = tail.readUInt32LE(eocd + 12);
    const dirOffset = tail.readUInt32LE(eocd + 16);
    if (dirOffset === 0xffffffff || count === 0xffff) throw new Error('This ZIP is too large to read (ZIP64)');
    if (dirOffset + dirSize > size) throw new Error('Corrupt ZIP directory');
    const dir = Buffer.alloc(dirSize);
    await fh.read(dir, 0, dirSize, dirOffset);
    const out = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (dir.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
      const flags = dir.readUInt16LE(p + 8);
      const method = dir.readUInt16LE(p + 10);
      const csize = dir.readUInt32LE(p + 20);
      const usize = dir.readUInt32LE(p + 24);
      const nameLen = dir.readUInt16LE(p + 28);
      const extraLen = dir.readUInt16LE(p + 30);
      const commentLen = dir.readUInt16LE(p + 32);
      const local = dir.readUInt32LE(p + 42);
      const name = dir.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
      p += 46 + nameLen + extraLen + commentLen;
      if (!name.endsWith('/')) out.push({ name, method, csize, usize, local, encrypted: !!(flags & 1) });
    }
    return out;
  } finally {
    await fh.close();
  }
}

/** Extracts one entry from zipList() to `outPath`. */
async function zipExtract(zipPath, entry, outPath) {
  if (entry.encrypted) throw new Error('This ZIP is password protected');
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Unsupported ZIP compression (method ${entry.method})`);
  const fh = await fsp.open(zipPath, 'r');
  try {
    const head = Buffer.alloc(30);
    await fh.read(head, 0, 30, entry.local);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('Corrupt ZIP entry');
    const start = entry.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = Buffer.alloc(entry.csize);
    await fh.read(raw, 0, entry.csize, start);
    const data = entry.method === 8 ? zlib.inflateRawSync(raw) : raw;
    if (data.length !== entry.usize) throw new Error('ZIP entry is incomplete');
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, data);
    return outPath;
  } finally {
    await fh.close();
  }
}

/** SHA-1 of a file, streamed. */
function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Moves a file, copying across drives (copy, check size, then delete the source). */
async function moveFile(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (err.code === 'EXDEV') break;
      // Antivirus and indexers often hold a fresh download for a moment.
      if (['EPERM', 'EBUSY', 'EACCES'].includes(err.code) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  await fsp.copyFile(from, to);
  const [a, b] = await Promise.all([fsp.stat(from), fsp.stat(to)]);
  if (a.size !== b.size) {
    await fsp.unlink(to).catch(() => {});
    throw new Error('The copy was incomplete');
  }
  await fsp.unlink(from);
}

/** Reads the format of a RIFF/WAVE file without loading the samples. */
async function readWavInfo(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const head = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    const b = head.subarray(0, bytesRead);
    if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
    let p = 12;
    let fmt = null;
    while (p + 8 <= b.length) {
      const id = b.toString('latin1', p, p + 4);
      const size = b.readUInt32LE(p + 4);
      if (id === 'fmt ') {
        fmt = {
          format: b.readUInt16LE(p + 8),
          channels: b.readUInt16LE(p + 10),
          sampleRate: b.readUInt32LE(p + 12),
          bitsPerSample: b.readUInt16LE(p + 22),
        };
      } else if (id === 'data') {
        if (!fmt) throw new Error('WAV data before format');
        const st = await fh.stat();
        const dataSize = Math.min(size, st.size - (p + 8));
        const frameBytes = (fmt.bitsPerSample / 8) * fmt.channels;
        return { ...fmt, dataOffset: p + 8, dataSize, frames: Math.floor(dataSize / frameBytes), duration: dataSize / frameBytes / fmt.sampleRate };
      }
      p += 8 + size + (size & 1);
    }
    throw new Error('WAV has no data chunk');
  } finally {
    await fh.close();
  }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(value, null, 1));
  try {
    await fsp.rename(tmp, file);
  } catch (err) {
    // Windows can briefly refuse the rename when an indexer has the file open.
    await new Promise((r) => setTimeout(r, 200));
    await fsp.rename(tmp, file).catch(async (e) => {
      await fsp.unlink(tmp).catch(() => {});
      throw e;
    });
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else {
      try {
        total += (await fsp.stat(p)).size;
      } catch (_) {}
    }
  }
  return total;
}

module.exports = { unzip, zipList, zipExtract, sha1File, moveFile, readWavInfo, writeJsonAtomic, readJson, dirSize };
