'use strict';
/** Album art: DDS inside the PSARC -> cached PNG served to the UI. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Psarc } = require('../core/psarc');
const image = require('../core/image');

class ArtService {
  constructor({ cacheDir }) {
    this.dir = cacheDir;
    this.pending = new Map();
  }

  _pick(song, size) {
    if (!song.art) return null;
    const sizes = [64, 128, 256].filter((s) => song.art[s]);
    if (!sizes.length) return null;
    const fit = sizes.find((s) => s >= size) || sizes[sizes.length - 1];
    return { entry: song.art[fit], size: fit };
  }

  async file(song, size = 256) {
    const pick = this._pick(song, size);
    if (!pick) return null;
    const key = crypto.createHash('sha1').update(`${song.path}|${song.mtimeMs}|${pick.entry}`).digest('hex').slice(0, 20);
    const out = path.join(this.dir, `${key}.png`);
    if (fs.existsSync(out)) return out;
    if (!this.pending.has(key)) {
      this.pending.set(
        key,
        (async () => {
          const p = await Psarc.open(song.path);
          try {
            const dds = await p.read(pick.entry);
            const png = image.encodePng(image.decodeDds(dds));
            await fsp.mkdir(this.dir, { recursive: true });
            const tmp = `${out}.${crypto.randomBytes(3).toString('hex')}.tmp`;
            await fsp.writeFile(tmp, png);
            await fsp.rename(tmp, out);
          } finally {
            await p.close();
          }
        })().finally(() => this.pending.delete(key))
      );
    }
    await this.pending.get(key);
    return out;
  }
}

module.exports = { ArtService };
