'use strict';
/**
 * Real amp captures (Neural Amp Modeler .nam files) for the guitar engine.
 *
 * <roaming>/Captures/
 *   captures.json   { packs: { id: Pack }, assign: { RocksmithAmpKey: packId | 'off' }, t3k: { clientId, auth } }
 *   <packId>/*.nam  the models
 *
 * Pack: { id, title, kind: 'amp' | 'full', bass, maker, makerUrl, url, license, toneId, source: 'tone3000' | 'file',
 *         mapKey (curated pack it came from), models: [{ file, name, gain (0–1 | null), size }], addedAt }
 *
 * TONE3000 (tone3000.com, formerly ToneHunt): free community captures. Its rules
 * for free apps: models are only downloaded when you ask, through TONE3000's own
 * sign-in pages (OAuth with PKCE, the load_tone and select_tone prompts), and
 * each one keeps its maker's name. Nothing is downloaded in the background.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { readJson, writeJsonAtomic, zipList, zipExtract } = require('../core/files');

const T3K = process.env.STAGEHAND_T3K_BASE || 'https://www.tone3000.com';
const REDIRECT_PORT = Number(process.env.STAGEHAND_T3K_PORT) || 47613;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/tone3000`;
const MAX_MODELS = 12;

const MAP = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'data', 'capturemap.json'), 'utf8'));
  } catch (_) {
    return { packs: {}, amps: {} };
  }
})();

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const safeName = (s) =>
  String(s || 'model')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'model';
const norm = (s) => String(s || '').trim().toLowerCase();

/** Which models of a tone to keep: the curated variants, or the best few. */
function pickModels(models, variants) {
  // one entry per name: prefer the full-size version (A2 files carry both sizes anyway)
  const rank = (m) => {
    const s = norm(m.size);
    return /nano/.test(s) ? 4 : /feather/.test(s) ? 3 : /lite/.test(s) ? 2 : 0;
  };
  const byName = new Map();
  for (const m of models) {
    if (!m || !m.model_url) continue;
    const k = norm(m.name);
    const have = byName.get(k);
    const arch = (x) => (String(x.architecture_version) === '2' ? 0 : 1);
    if (!have || arch(m) < arch(have) || (arch(m) === arch(have) && rank(m) < rank(have))) byName.set(k, m);
  }
  const list = [...byName.values()];
  if (variants && variants.length) {
    const out = [];
    for (const v of variants) {
      const want = norm(v.match);
      const hit = list.find((m) => norm(m.name) === want) || (want ? list.find((m) => norm(m.name).includes(want)) : list[0]);
      if (hit && !out.some((o) => o.m === hit)) out.push({ m: hit, gain: v.gain });
    }
    if (out.length) return out;
  }
  // no recipe: gain from the name when it says so ("Gain 7", "G5"), else spread evenly
  const out = list.slice(0, MAX_MODELS).map((m) => {
    const g = /(?:gain|\bg|#)\s*#?\s*(\d+(?:\.\d+)?)/i.exec(m.name || '');
    return { m, gain: g ? Math.max(0, Math.min(1, Number(g[1]) / 10)) : null };
  });
  if (out.length > 1 && out.every((o) => o.gain === null)) out.forEach((o, i) => (o.gain = out.length === 1 ? 0.5 : i / (out.length - 1)));
  return out;
}

/** The model of a pack that plays like a Rocksmith gain-knob position. */
function chooseModel(pack, gainPos) {
  const models = (pack && pack.models) || [];
  if (!models.length) return null;
  const g = Number.isFinite(gainPos) ? gainPos : 0.5;
  let best = models[0];
  for (const m of models) if (Math.abs((m.gain ?? 0.5) - g) < Math.abs((best.gain ?? 0.5) - g)) best = m;
  return best;
}

class Captures extends EventEmitter {
  constructor({ dir, fetchImpl, openExternal, openAuth, focus, safeStorage, log }) {
    super();
    this.openAuth = openAuth || null; // (url, redirectUri) → { promise: callback URL, close() }
    this.dir = dir;
    this.file = path.join(dir, 'captures.json');
    this.fetch = fetchImpl || fetch;
    this.openExternal = openExternal;
    this.focus = focus || (() => {});
    this.safe = safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable() ? safeStorage : null;
    this.log = log || (() => {});
    this.data = { packs: {}, assign: {}, t3k: {} };
    this.busy = null; // { packKey, stage } while a TONE3000 flow runs
    this._pending = null;
  }

  async load() {
    await fsp.mkdir(this.dir, { recursive: true });
    const d = await readJson(this.file, null);
    if (d && typeof d === 'object') this.data = { packs: d.packs || {}, assign: d.assign || {}, t3k: d.t3k || {} };
    // forget packs whose files are gone
    for (const [id, p] of Object.entries(this.data.packs)) {
      p.models = (p.models || []).filter((m) => fs.existsSync(path.join(this.dir, id, m.file)));
      if (!p.models.length) delete this.data.packs[id];
    }
    return this.state();
  }

  async save() {
    await writeJsonAtomic(this.file, this.data);
  }

  _changed() {
    this.save().catch((e) => this.log(`captures: save failed: ${e.message}`));
    this.emit('change', this.state());
  }

  /** What the page needs: your packs (with file paths), your choices, the curated map, TONE3000 status. */
  state() {
    const packs = Object.values(this.data.packs).map((p) => ({
      ...p,
      models: p.models.map((m) => ({ ...m, path: path.join(this.dir, p.id, m.file), url: `stagehand://capture/${encodeURIComponent(p.id)}/${encodeURIComponent(m.file)}` })),
    }));
    const t = this.data.t3k || {};
    return {
      packs,
      assign: { ...this.data.assign },
      map: MAP,
      t3k: { hasKey: !!t.clientId, clientId: t.clientId || '', connected: !!t.auth, user: t.user || null, redirectUri: REDIRECT_URI, useBrowser: !!t.useBrowser, inApp: !!this.openAuth },
      busy: this.busy,
    };
  }

  filePath(packId, file) {
    const p = this.data.packs[packId];
    if (!p || !p.models.some((m) => m.file === file)) return null;
    return path.join(this.dir, packId, file);
  }

  /** This Rocksmith amp uses this pack (null = Stagehand's choice, 'off' = the modelled amp). */
  assign(ampKey, packId) {
    if (!/^[A-Za-z0-9_]{3,64}$/.test(String(ampKey || ''))) throw new Error('Unknown amp.');
    if (packId === null || packId === undefined || packId === '') delete this.data.assign[ampKey];
    else if (packId === 'off' || this.data.packs[packId]) this.data.assign[ampKey] = packId;
    else throw new Error('That capture is gone.');
    this._changed();
    return this.state();
  }

  async remove(packId) {
    if (!this.data.packs[packId]) return this.state();
    delete this.data.packs[packId];
    for (const [k, v] of Object.entries(this.data.assign)) if (v === packId) delete this.data.assign[k];
    await fsp.rm(path.join(this.dir, packId), { recursive: true, force: true }).catch(() => {});
    this._changed();
    return this.state();
  }

  // ------------------------------------------------------------ own files --
  /**
   * Adds captures you downloaded yourself: .nam files, or a .zip of them (as
   * TONE3000's "Download all" gives). A zip, or loose files of the same amp,
   * become one capture with its gain levels read from the model names.
   */
  async addFiles(paths, ampKey) {
    const items = [];
    for (const src of (paths || []).slice(0, 60)) {
      if (/\.zip$/i.test(src)) {
        const entries = (await zipList(src)).filter((e) => /\.nam$/i.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name)).slice(0, 60);
        if (!entries.length) throw new Error(`${path.basename(src)} has no NAM captures (.nam) inside.`);
        const tmp = await fsp.mkdtemp(path.join(this.dir, '.zip-'));
        try {
          for (const e of entries) {
            const out = path.join(tmp, `${items.length}.nam`);
            await zipExtract(src, e, out);
            items.push({ name: path.basename(e.name), text: await fsp.readFile(out, 'utf8'), group: `zip:${src}`, groupTitle: path.basename(src).replace(/\.zip$/i, '') });
          }
        } finally {
          await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
        }
      } else items.push({ name: path.basename(src), text: await fsp.readFile(src, 'utf8') });
    }
    const groups = new Map();
    for (const it of items) {
      let j;
      try {
        j = JSON.parse(it.text);
      } catch (_) {
        j = null;
      }
      if (!j || !j.architecture || (!j.weights && !(j.config && j.config.submodels))) throw new Error(`${it.name} isn’t a NAM capture (.nam).`);
      const md = j.metadata || (j.config && j.config.submodels && j.config.submodels[0] && j.config.submodels[0].model && j.config.submodels[0].model.metadata) || {};
      const amp = [md.gear_make, md.gear_model].filter(Boolean).join(' ');
      it.md = md;
      const key = it.group || (amp ? `amp:${amp.toLowerCase()}` : `file:${it.name}`);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const added = [];
    for (const list of groups.values()) {
      const md = list[0].md;
      const amp = [md.gear_make, md.gear_model].filter(Boolean).join(' ');
      const title = (list.length === 1 && md.name) || amp || list[0].groupTitle || list[0].name.replace(/\.nam$/i, '');
      const id = `own_${crypto.createHash('sha1').update(list.map((x) => x.text).join('\n')).digest('hex').slice(0, 10)}`;
      await fsp.mkdir(path.join(this.dir, id), { recursive: true });
      // gain from the names ("Gain 7", "G5", "#3"), else in name order
      const named = list.map((x) => ({ m: { name: x.name.replace(/\.nam$/i, '').slice(0, 120), model_url: 'x' }, x }));
      const picks = pickModels(named.map((n) => n.m), null);
      const models = [];
      const used = new Set();
      for (const p of picks) {
        const it = named.find((n) => n.m === p.m).x;
        let file = `${safeName(it.name.replace(/\.nam$/i, ''))}.nam`;
        for (let i = 2; used.has(file); i++) file = `${safeName(it.name.replace(/\.nam$/i, ''))} ${i}.nam`;
        used.add(file);
        await fsp.writeFile(path.join(this.dir, id, file), it.text);
        models.push({ file, name: p.m.name, gain: list.length > 1 ? p.gain : null, size: '' });
      }
      const full = /cab|full|rig/i.test(String(md.gear_type || ''));
      this.data.packs[id] = {
        id,
        title: String(title).slice(0, 100),
        kind: full ? 'full' : 'amp',
        bass: /bass/i.test(`${title} ${md.tone_type || ''} ${md.gear_type || ''}`),
        maker: md.modeled_by ? String(md.modeled_by).slice(0, 60) : '',
        makerUrl: '',
        url: '',
        license: '',
        toneId: null,
        source: 'file',
        models,
        addedAt: Date.now(),
      };
      added.push(id);
    }
    if (ampKey && added.length) this.data.assign[ampKey] = added[0];
    this._changed();
    return { added, state: this.state() };
  }

  /** Switches a capture between "amp only" (the tone's cabinet is added) and "amp and cabinet". */
  setKind(packId, kind) {
    const p = this.data.packs[packId];
    if (!p) throw new Error('That capture is gone.');
    p.kind = kind === 'full' ? 'full' : 'amp';
    this._changed();
    return this.state();
  }

  // ------------------------------------------------------------ TONE3000 --
  setClientId(id) {
    const v = String(id || '').trim();
    if (v && !/^[A-Za-z0-9_\-.:]{8,200}$/.test(v)) throw new Error('That doesn’t look like a TONE3000 publishable key.');
    this.data.t3k = { ...this.data.t3k, clientId: v };
    if (!v) delete this.data.t3k.auth, delete this.data.t3k.user;
    this._changed();
    return this.state();
  }

  disconnect() {
    delete this.data.t3k.auth;
    delete this.data.t3k.user;
    this._changed();
    return this.state();
  }

  _token() {
    const a = this.data.t3k.auth;
    if (!a) return null;
    try {
      return JSON.parse(this.safe && a.enc ? this.safe.decryptString(Buffer.from(a.enc, 'base64')) : a.plain);
    } catch (_) {
      return null;
    }
  }

  _storeToken(tok) {
    const s = JSON.stringify({ access: tok.access_token, refresh: tok.refresh_token || null, exp: Date.now() + (Number(tok.expires_in) || 3600) * 1000 });
    this.data.t3k.auth = this.safe ? { enc: this.safe.encryptString(s).toString('base64') } : { plain: s };
  }

  _setBusy(b) {
    this.busy = b;
    this.emit('change', this.state());
  }

  /** Opens a TONE3000 page in your browser and waits for it to send you back here. */
  async _authorize(extra) {
    const clientId = this.data.t3k.clientId;
    if (!clientId) throw Object.assign(new Error('Connect TONE3000 first (Settings › Real amps).'), { code: 'nokey' });
    // a new request replaces one still waiting (e.g. TONE3000 showed an error and never sent you back)
    if (this._pending) this._pending.cancel();
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const u = new URL(`${T3K}/api/v1/oauth/authorize`);
    const params = { client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state, ...extra };
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    const flow = this.openAuth && !this.data.t3k.useBrowser ? this._inApp(u.toString()) : this._viaBrowser(u.toString(), state);
    this._pending = flow;
    let back;
    try {
      back = await flow.promise;
    } finally {
      if (this._pending === flow) this._pending = null;
    }
    const q = back;
    if (q.state !== state) throw new Error('TONE3000 sent back an unexpected answer. Try again.');
    if (q.canceled === 'true' || q.error === 'access_denied') throw Object.assign(new Error('Cancelled on TONE3000.'), { code: 'cancelled' });
    if (q.error) throw new Error(`TONE3000 said: ${q.error_description || q.error}`);
    if (!q.code) throw new Error('TONE3000 didn’t send a sign-in code. Try again.');
    const tok = await this._post('/api/v1/oauth/token', { grant_type: 'authorization_code', code: q.code, code_verifier: verifier, redirect_uri: REDIRECT_URI, client_id: clientId });
    if (!tok || !tok.access_token) throw new Error('TONE3000 didn’t give Stagehand access.');
    this._storeToken(tok);
    return back;
  }

  /** TONE3000 in a small Stagehand window (main.js): it closes itself when TONE3000 sends you back. */
  _inApp(url) {
    const w = this.openAuth(url, REDIRECT_URI);
    let rejectIt;
    const cancelled = new Promise((_, rej) => (rejectIt = rej));
    const promise = Promise.race([w.promise, cancelled]).then((cb) => {
      this.focus();
      return Object.fromEntries(new URL(cb).searchParams);
    });
    return {
      promise,
      cancel: () => {
        rejectIt(Object.assign(new Error('Replaced by a newer request.'), { code: 'replaced' }));
        w.close();
      },
    };
  }

  /** TONE3000 in your web browser; a little local server catches the way back. */
  _viaBrowser(url, state) {
    let cancel = () => {};
    const promise = new Promise((resolve, reject) => {
      let server = null;
      const done = (err, v) => {
        clearTimeout(timer);
        const sv = server;
        server = null;
        if (sv)
          // drop kept-alive connections too, or the next sign-in's redirect could land here
          setImmediate(() => {
            sv.close();
            if (sv.closeAllConnections) sv.closeAllConnections();
          });
        if (err) reject(err);
        else resolve(v);
      };
      cancel = () => done(Object.assign(new Error('Replaced by a newer request.'), { code: 'replaced' }));
      const timer = setTimeout(() => done(Object.assign(new Error('TONE3000 didn’t send you back in time. Try again.'), { code: 'timeout' })), 10 * 60 * 1000);
      const sv = http.createServer((req, res) => {
        const u = new URL(req.url, REDIRECT_URI);
        if (u.pathname !== '/tone3000') {
          res.writeHead(404, { Connection: 'close' }).end();
          return;
        }
        const q = Object.fromEntries(u.searchParams);
        const ok = q.state === state && q.code && !q.error && q.canceled !== 'true';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Stagehand</title><body style="font:16px system-ui;background:#0f1320;color:#eceef6;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:48px">${ok ? '🎸' : '✋'}</div><p>${ok ? 'All set. Back to Stagehand.' : 'Nothing was downloaded.'}</p><p style="color:#6e7693">You can close this tab.</p></div><script>setTimeout(() => window.close(), 600)</script>`
        );
        this.focus();
        done(null, q);
      });
      sv.on('error', (e) => done(new Error(e.code === 'EADDRINUSE' ? `Port ${REDIRECT_PORT} is busy, so TONE3000 can’t send you back. Close the other app using it and try again.` : e.message)));
      sv.listen(REDIRECT_PORT, '127.0.0.1', () => {
        server = sv;
        Promise.resolve(this.openExternal(url)).catch((e) => done(e));
      });
    });
    return { promise, cancel: () => cancel() };
  }

  /** Sign in with your web browser instead of Stagehand's window (for Google sign-in, which won't work inside apps). */
  setUseBrowser(on) {
    this.data.t3k = { ...this.data.t3k, useBrowser: !!on };
    this._changed();
    return this.state();
  }

  async _post(p, body) {
    const form = new URLSearchParams(body).toString();
    let r = await this.fetch(`${T3K}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form });
    if (r.status === 415 || r.status === 400) {
      // some servers want JSON
      const r2 = await this.fetch(`${T3K}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      if (r2.ok || r.status === 415) r = r2;
    }
    const txt = await r.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch (_) {}
    if (!r.ok) throw new Error((j && (j.error_description || j.error || j.message)) || `TONE3000 answered ${r.status}`);
    return j;
  }

  async _refresh() {
    const t = this._token();
    if (!t || !t.refresh) return false;
    try {
      const tok = await this._post('/api/v1/oauth/token', { grant_type: 'refresh_token', refresh_token: t.refresh, client_id: this.data.t3k.clientId });
      if (!tok || !tok.access_token) return false;
      if (!tok.refresh_token) tok.refresh_token = t.refresh;
      this._storeToken(tok);
      return true;
    } catch (_) {
      return false;
    }
  }

  async _get(p, raw) {
    const go = async () => {
      const t = this._token();
      return this.fetch(p.startsWith('http') ? p : `${T3K}/api/v1${p}`, { headers: { Authorization: `Bearer ${t ? t.access : ''}`, Accept: raw ? '*/*' : 'application/json' } });
    };
    let t = this._token();
    if (t && t.exp && t.exp < Date.now() + 30000) await this._refresh();
    let r = await go();
    if (r.status === 401 && (await this._refresh())) r = await go();
    if (r.status === 401) {
      delete this.data.t3k.auth;
      throw Object.assign(new Error('TONE3000 needs you to sign in again.'), { code: 'auth' });
    }
    if (!r.ok) throw new Error(`TONE3000 answered ${r.status}`);
    return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
  }

  /** Signs in once, so later downloads are a click. */
  async connect() {
    this._setBusy({ stage: 'signin' });
    try {
      await this._authorize({});
      try {
        const u = await this._get('/user');
        this.data.t3k.user = u ? { username: u.username || '', name: u.display_name || u.username || '', avatar: u.avatar_url || '' } : null;
      } catch (_) {}
      this._changed();
      return this.state();
    } finally {
      this._setBusy(null);
    }
  }

  /**
   * Gets a curated capture (capturemap.json) for a Rocksmith amp: TONE3000 shows
   * the capture, you confirm, Stagehand downloads its models.
   */
  async get(packKey, ampKey) {
    const def = MAP.packs[packKey];
    if (!def) throw new Error('Unknown capture.');
    const extra = { prompt: 'load_tone', tone_id: def.toneId };
    // TONE3000 treats A1 + Custom as the default and calls a tone with only A2
    // (newer) models "not compatible" unless the app says it can play A2. We can.
    const arch = await this._archFor(def.toneId, def.arch);
    if (arch) extra.architecture = arch;
    return this._fetchTone(extra, { def, packKey, ampKey });
  }

  /** '2' when a tone only has A2 models (asked of TONE3000 when signed in, else the map's hint). */
  async _archFor(toneId, hint) {
    if (this._token()) {
      try {
        const t = await this._get(`/tones/${toneId}?architecture=2`);
        const n = (k) => Number((t && t[k]) || 0);
        if (t && ('a2_models_count' in t || 'a1_models_count' in t)) return n('a1_models_count') + n('custom_models_count') === 0 && n('a2_models_count') > 0 ? '2' : null;
      } catch (_) {}
    }
    return hint ? String(hint) : null;
  }

  /** Every model of a tone: TONE3000 leaves A2 models out unless asked for them. */
  async _allModels(toneId) {
    const rows = (l) => {
      const m = l && (l.data || l.models || l);
      return Array.isArray(m) ? m : [];
    };
    const seen = new Set();
    const out = [];
    const add = (list) => {
      for (const m of list) {
        const k = m && (m.id ?? m.model_url);
        if (k == null || seen.has(k)) continue;
        seen.add(k);
        out.push(m);
      }
    };
    let first = null;
    try {
      add(rows(await this._get(`/models?tone_id=${toneId}&page_size=300`)));
    } catch (e) {
      first = e;
    }
    try {
      add(rows(await this._get(`/models?tone_id=${toneId}&page_size=300&architecture=2`)));
    } catch (e) {
      if (first || e.code === 'auth') throw e;
    }
    if (!out.length && first) throw first;
    return out;
  }

  /** Browse TONE3000 and pick any capture (select_tone). */
  async browse(ampKey, opts = {}) {
    const extra = { prompt: 'select_tone', format: 'nam' };
    void opts;
    return this._fetchTone(extra, { ampKey });
  }

  async _fetchTone(extra, { def, packKey, ampKey }) {
    this._setBusy({ stage: 'browser', packKey: packKey || null, ampKey: ampKey || null });
    try {
      const back = await this._authorize(extra);
      const toneId = Number(back.tone_id || (def && def.toneId));
      if (!toneId) throw new Error('No capture was picked.');
      this._setBusy({ stage: 'download', packKey: packKey || null, ampKey: ampKey || null });
      const tone = await this._get(`/tones/${toneId}`).catch(() => null);
      const models = await this._allModels(toneId);
      const same = def && toneId === def.toneId;
      const picks = pickModels(models, same ? def.variants : null);
      if (!picks.length) throw new Error('That capture has no NAM models Stagehand can use.');
      const id = `t3k_${toneId}`;
      const dir = path.join(this.dir, id);
      await fsp.mkdir(dir, { recursive: true });
      const out = [];
      const used = new Set();
      for (const { m, gain } of picks.slice(0, MAX_MODELS)) {
        const buf = await this._get(m.model_url, true);
        let file = `${safeName(m.name)}.nam`;
        for (let i = 2; used.has(file); i++) file = `${safeName(m.name)} ${i}.nam`;
        used.add(file);
        // only keep what parses as a NAM model (an IR or an error page would not)
        try {
          const j = JSON.parse(buf.toString('utf8'));
          if (!j.architecture) throw new Error('x');
        } catch (_) {
          this.log(`captures: ${m.name} isn't a NAM model, skipped`);
          continue;
        }
        await fsp.writeFile(path.join(dir, file), buf);
        out.push({ file, name: String(m.name || file).slice(0, 120), gain: gain ?? null, size: String(m.size || '') });
      }
      if (!out.length) throw new Error('None of that capture’s files are NAM models.');
      const user = (tone && tone.user) || {};
      const gear = String((tone && tone.gear) || '').toLowerCase();
      const kind = def && same ? def.kind : /full|cab/.test(gear) ? 'full' : 'amp';
      this.data.packs[id] = {
        id,
        title: String((tone && tone.title) || (def && def.title) || `TONE3000 #${toneId}`).slice(0, 120),
        kind,
        bass: def ? !!def.bass : /bass/i.test(String(tone && tone.title)),
        maker: user.display_name || user.username || (def && def.maker) || '',
        makerUrl: user.url || (user.username ? `${T3K}/${user.username}` : ''),
        avatar: user.avatar_url || '',
        url: (tone && tone.url) || (def && def.url) || `${T3K}/tones/${toneId}`,
        license: (tone && (tone.license && (tone.license.name || tone.license))) || 'T3K',
        toneId,
        source: 'tone3000',
        mapKey: same ? packKey : null,
        models: out,
        addedAt: Date.now(),
      };
      if (ampKey) {
        if (!same) this.data.assign[ampKey] = id;
        else if (this.data.assign[ampKey] === 'off') delete this.data.assign[ampKey];
      }
      this._changed();
      return { id, state: this.state() };
    } finally {
      this._setBusy(null);
    }
  }
}

module.exports = { Captures, pickModels, chooseModel, MAP, REDIRECT_URI };
