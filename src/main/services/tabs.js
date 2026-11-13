'use strict';
/** Reads a song's guitar and bass arrangements (and lyrics) for the tab view. */
const path = require('path');
const { Psarc } = require('../core/psarc');
const sng = require('../core/sng');
const { vocalDifficulty } = require('../core/vocaldiff');
const { parseXml } = require('../core/xmlarr');
const { songTones } = require('../core/tones');

const PLAYABLE = new Set(['lead', 'rhythm', 'combo', 'bass']);

class TabService {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.cache = new Map(); // key -> tab
  }

  /** Playable parts of a song, Lead/Rhythm/Bass first, bonus parts after. */
  list(song) {
    const order = { lead: 0, combo: 1, rhythm: 2, bass: 3 };
    return (song.arrangements || [])
      .filter((a) => PLAYABLE.has(a.type))
      .map((a) => ({ id: a.id, name: a.name, type: a.type, tuning: a.tuning, tuningName: a.tuningName, cents: a.cents, capo: a.capo, bonus: a.bonus, represent: a.represent, notes: a.notes }))
      .sort((x, y) => x.bonus - y.bonus || order[x.type] - order[y.type] || x.name.localeCompare(y.name));
  }

  _base(manifest) {
    return path.posix.basename(String(manifest || ''), '.json');
  }

  async load(song, arrId, { withLyrics = true } = {}) {
    const arr = (song.arrangements || []).find((a) => a.id === arrId) || this.list(song)[0];
    if (!arr) throw Object.assign(new Error('This song has no guitar or bass part.'), { code: 'NO_TAB' });
    const sourcePath = song.dlcImport && arr.sourcePath || song.path;
    const key = `${sourcePath}|${song.mtimeMs}|${arr.id}|${!!song.dlcImport}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const psarc = await Psarc.open(sourcePath);
    try {
      const tab = await this._read(psarc, song, arr);
      tab.songTones = await this._tones(psarc, arr, tab).catch((e) => {
        this.log(`Tab: tones unreadable: ${e.message}`);
        return null;
      });
      delete tab.tones;
      if (withLyrics) tab.lyrics = await this._lyrics(psarc, song).catch(() => []);
      this.cache.set(key, tab);
      if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
      return tab;
    } finally {
      await psarc.close().catch(() => {});
    }
  }

  async _read(psarc, song, arr) {
    const base = this._base(arr.manifest);
    const names = psarc.names;
    const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
    const opts = { type: arr.type, tuning: arr.tuning, capo: arr.capo, name: arr.name, fullDifficulty: !!song.dlcImport };
    const platform = song.platform === 'mac' || names.some((n) => /^songs\/bin\/macos\//i.test(n)) ? 'mac' : 'pc';
    const sngName = lower.get(`songs/bin/generic/${base}.sng`.toLowerCase()) || lower.get(`songs/bin/macos/${base}.sng`.toLowerCase());
    let err = null;
    if (sngName) {
      try {
        const tab = sng.toTab(sng.parse(sng.unpack(await psarc.read(sngName), platform)), opts);
        tab.source = 'sng';
        return finish(tab, arr);
      } catch (e) {
        err = e;
        this.log(`Tab: could not read ${sngName}: ${e.message}`);
      }
    }
    const xmlName = lower.get(`songs/arr/${base}.xml`.toLowerCase());
    if (xmlName) {
      const tab = parseXml((await psarc.read(xmlName)).toString('utf8'), opts);
      tab.source = 'xml';
      return finish(tab, arr);
    }
    throw Object.assign(new Error(err ? `The ${arr.name} part couldn’t be read: ${err.message}` : `The ${arr.name} part isn’t in this file.`), { code: 'NO_TAB' });
  }

  async _tones(psarc, arr, tab) {
    if (!arr.manifest || !psarc.names.includes(arr.manifest)) return null;
    const json = JSON.parse((await psarc.read(arr.manifest)).toString('utf8').replace(/^\uFEFF/, ''));
    const entry = (json.Entries && (json.Entries[arr.id] || Object.values(json.Entries)[0])) || null;
    return entry ? songTones(entry.Attributes, tab.tones, arr.type) : null;
  }

  /** 4.14: how hard the song is to sing (the Karaoke page), from its lyric chart. Small and cached. */
  async vocals(song) {
    const key = `${song.path}|${song.mtimeMs}`;
    this.vocalCache = this.vocalCache || new Map();
    if (this.vocalCache.has(key)) return this.vocalCache.get(key);
    const voc = (song.arrangements || []).find((a) => a.type === 'vocals');
    const sourcePath = (song.dlcImport && voc && voc.sourcePath) || song.path;
    let out = null;
    const psarc = await Psarc.open(sourcePath);
    try {
      out = vocalDifficulty(await this._lyrics(psarc, song).catch(() => []));
    } finally {
      await psarc.close().catch(() => {});
    }
    this.vocalCache.set(key, out);
    if (this.vocalCache.size > 4000) this.vocalCache.delete(this.vocalCache.keys().next().value);
    return out;
  }

  async _lyrics(psarc, song) {
    const voc = (song.arrangements || []).find((a) => a.type === 'vocals');
    if (!voc) return [];
    const base = this._base(voc.manifest);
    const name = psarc.names.find((n) => n.toLowerCase() === `songs/bin/generic/${base}.sng`.toLowerCase());
    if (!name) return [];
    const parsed = sng.parse(sng.unpack(await psarc.read(name), song.platform === 'mac' ? 'mac' : 'pc'));
    // p: the note to sing (a MIDI number), for Sing along. Charts without notes carry 0, 254 or 255 there.
    return parsed.vocals.map((v) => ({ t: Math.round(v.time * 1000) / 1000, d: Math.round(v.length * 1000) / 1000, w: v.lyric, p: v.note }));
  }
}

function finish(tab, arr) {
  tab.id = arr.id;
  tab.tuningName = arr.tuningName;
  tab.cents = arr.cents || 0;
  return tab;
}

module.exports = { TabService };
