'use strict';
const path = require('path');
const { readJson, writeJsonAtomic } = require('../core/files');

const DEFAULTS = {
  playback: { autoplay: true, endAction: 'stop' },
  stems: { model: 'htdemucs_6s', shifts: 1, auto: true, device: 'auto', preferStems: true, waitFirst: true, cpuLoad: 'full', format: 'flac', cleared310: false },
  engine: { python: null, variant: null, device: null, installedAt: null },
  tools: { vgmstream: null },
  rocksmith: { profile: null, steamDir: null, gameDir: null },
  import: { watch: false, watchDir: null, target: null, list: null, replace: true, keepOriginal: false, since: 0 },
  discover: { copyFormat: 'artist-title' },
  backups: { enabled: true, keep: 5 },
  cache: { audioLimitGB: 4 },
  window: { bounds: null, maximized: false },
  updates: { check: true }, // 4.1.4: look for a newer Stagehand on GitHub
  ui: {},
};

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = merge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class Settings {
  constructor(file) {
    this.file = file;
    this.data = merge(DEFAULTS, {});
    this._timer = null;
  }

  async load() {
    this.data = merge(DEFAULTS, await readJson(this.file, {}));
    return this.data;
  }

  get() {
    return this.data;
  }

  set(patch) {
    this.data = merge(this.data, patch);
    this.saveSoon();
    return this.data;
  }

  saveSoon() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.save().catch(() => {}), 300);
  }

  async save() {
    clearTimeout(this._timer);
    await writeJsonAtomic(this.file, this.data);
  }
}

module.exports = { Settings, DEFAULTS, merge, path };
