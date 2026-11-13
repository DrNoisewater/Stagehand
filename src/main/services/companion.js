'use strict';
/**
 * The Quest companion (4.16): the headset's browser opens a page served by Stagehand on
 * the home network and follows the PC's song. Off until switched on (Settings › Quest):
 * nothing listens on the network before that.
 *
 * - HTTPS (the headset only allows VR on a secure page) with Stagehand's own certificate,
 *   made once and kept, so the browser only asks about it once.
 * - Pairing: a 4-digit code shown on the PC; the headset gets a key it keeps, the PC keeps
 *   its fingerprint. Both remember each other; reconnecting needs nothing.
 * - One WebSocket per headset: the library, the song clock and play state from the PC;
 *   song picks, play/pause and seeks from the headset (the page on the PC does them).
 *
 * Node built-ins only.
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { performance } = require('perf_hooks');
const ws = require('../core/ws');
const { makeCert } = require('../core/selfcert');

const DEFAULT_PORT = 7787;
const MAX_CONNS = 8;
const WRONG_LIMIT = 5; // wrong codes before the code changes
const PAIR_WAIT = 120e3; // a page that hasn't paired is let go after this
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.avif': 'image/avif' };

/** Milliseconds on a clock both Electron processes share (wall time at start + a steady clock since). */
const nowMs = () => performance.timeOrigin + performance.now();
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const code4 = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

/** The PC's addresses on the home network, the likeliest first. */
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      if (/^169\.254\./.test(a.address)) continue; // no network yet
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|docker|veth|br-|tailscale|ZeroTier|Bluetooth/i.test(name);
      const home = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      out.push({ address: a.address, name, rank: (virtual ? 2 : 0) + (home ? 0 : 1) });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ address, name }) => ({ address, name }));
}

function songRow(s) {
  const parts = [];
  for (const a of s.arrangements || []) {
    const t = a.type === 'jvocals' ? 'vocals' : a.type;
    if (t && !parts.includes(t)) parts.push(t);
  }
  return { id: s.id, title: s.title || '', artist: s.artist || '', album: s.album || '', year: s.year || null, length: Math.round(Number(s.length) || 0), parts };
}

class Companion extends EventEmitter {
  /**
   * dir: where the certificate is kept. settings: the Settings store (`companion` section).
   * library: { songs() } → song records. staticDir: the page. fontsDir: the app's fonts.
   * artFile(song, size) → a picture file for a song (or null).
   */
  constructor({ dir, settings, library, staticDir, fontsDir = null, artFile = null, version = '', log = () => {}, pcName = os.hostname() }) {
    super();
    this.dir = dir;
    this.settings = settings;
    this.library = library;
    this.staticDir = staticDir;
    this.fontsDir = fontsDir;
    this.artFile = artFile;
    this.version = version;
    this.log = log;
    this.pcName = pcName;
    this.server = null;
    this.port = null;
    this.code = null;
    this.wrong = 0;
    this.conns = new Set();
    this.last = null; // the last state from the page
    this.error = null;
    this._libTimer = null;
  }

  cfg() {
    const c = (this.settings.get() && this.settings.get().companion) || {};
    return { on: !!c.on, port: c.port === 0 ? 0 : Number(c.port) || DEFAULT_PORT, devices: Array.isArray(c.devices) ? c.devices : [] };
  }

  /** At app start: listen only if it was left on. */
  async startup() {
    if (this.cfg().on) await this.start().catch((e) => this.log(`Quest companion failed to start: ${e.message}`));
  }

  status() {
    const c = this.cfg();
    const online = new Set([...this.conns].filter((x) => x.device).map((x) => x.device.id));
    return {
      on: !!this.server,
      wanted: c.on,
      port: this.port,
      addresses: this.server ? addresses().map((a) => a.address) : [],
      url: this.server ? this.urls()[0] || null : null,
      code: this.server ? this.code : null,
      error: this.error,
      clients: online.size,
      devices: c.devices.map((d) => ({ id: d.id, name: d.name, added: d.added, seen: d.seen, online: online.has(d.id) })),
    };
  }

  urls() {
    return addresses().map((a) => `https://${a.address}:${this.port}`);
  }

  async setOn(on) {
    this.settings.set({ companion: { on: !!on } });
    if (on) await this.start();
    else await this.stop();
    return this.status();
  }

  async _cert() {
    const keyFile = path.join(this.dir, 'companion-key.pem');
    const certFile = path.join(this.dir, 'companion-cert.pem');
    try {
      const [key, cert] = await Promise.all([fsp.readFile(keyFile, 'utf8'), fsp.readFile(certFile, 'utf8')]);
      const x = new crypto.X509Certificate(cert);
      if (new Date(x.validTo) - Date.now() > 30 * 24 * 3600e3) return { key, cert };
    } catch (_) {}
    const made = makeCert({ names: [...addresses().map((a) => a.address), this.pcName] });
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(keyFile, made.key, { mode: 0o600 });
    await fsp.writeFile(certFile, made.cert);
    return made;
  }

  async start() {
    if (this.server) return this.status();
    this.error = null;
    const { key, cert } = await this._cert();
    const server = https.createServer({ key, cert }, (req, res) => this._http(req, res).catch((e) => {
      this.log(`Quest companion: ${req.url} failed: ${e.message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }));
    server.on('upgrade', (req, socket) => this._upgrade(req, socket));
    server.on('tlsClientError', () => {}); // the headset's first visit (before the certificate is accepted) ends this way
    const want = this.cfg().port;
    let port = null;
    // the same address every time if we can (the headset keeps it); a nearby one if it's taken
    for (const p of want ? [want, want + 1, want + 2, want + 3, 0] : [0]) {
      try {
        await new Promise((resolve, reject) => {
          const fail = (e) => (server.removeListener('listening', ok), reject(e));
          const ok = () => (server.removeListener('error', fail), resolve());
          server.once('error', fail);
          server.once('listening', ok);
          server.listen(p, '0.0.0.0');
        });
        port = server.address().port;
        break;
      } catch (e) {
        if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') {
          this.error = e.message;
          throw e;
        }
      }
    }
    if (!port) {
      this.error = 'No free network port';
      throw new Error(this.error);
    }
    this.server = server;
    this.port = port;
    if (port !== want && want === DEFAULT_PORT && !this.cfg().devices.length) this.settings.set({ companion: { port } });
    this.code = code4();
    this.wrong = 0;
    this.log(`Quest companion on ${this.urls().join(', ') || `port ${port}`}`);
    this._changed();
    return this.status();
  }

  async stop() {
    const s = this.server;
    if (!s) return this.status();
    this.server = null;
    this.port = null;
    this.code = null;
    for (const c of this.conns) c.close(1001);
    this.conns.clear();
    await new Promise((r) => s.close(() => r()));
    s.closeAllConnections && s.closeAllConnections();
    this.log('Quest companion off');
    this._changed();
    return this.status();
  }

  newCode() {
    if (this.server) {
      this.code = code4();
      this.wrong = 0;
      this._changed();
    }
    return this.status();
  }

  forget(id) {
    const devices = this.cfg().devices.filter((d) => d.id !== id);
    this.settings.set({ companion: { devices } });
    for (const c of this.conns) if (c.device && c.device.id === id) {
      c.send(JSON.stringify({ type: 'forgotten' }));
      c.close(4001);
    }
    this._changed();
    return this.status();
  }

  /** Where the page on the PC is (30 times a second while a headset is connected). */
  pushState(st) {
    if (!st || typeof st !== 'object') return;
    const s = {
      type: 'state',
      song: st.song && st.song.id ? { id: String(st.song.id), title: String(st.song.title || ''), artist: String(st.song.artist || ''), length: Number(st.song.length) || 0 } : null,
      pos: Number(st.pos) || 0,
      playing: !!st.playing,
      speed: Number(st.speed) || 1,
      at: Number(st.at) || nowMs(),
      phase: st.phase ? String(st.phase) : null,
      part: st.part ? String(st.part) : null,
      notice: st.notice ? String(st.notice) : null,
    };
    this.last = s;
    const text = JSON.stringify(s);
    for (const c of this.conns) if (c.device) c.send(text);
  }

  /** The library changed: the headsets get the new list (once things settle). */
  libraryChanged() {
    if (!this.server || ![...this.conns].some((c) => c.device)) return;
    clearTimeout(this._libTimer);
    this._libTimer = setTimeout(() => {
      const text = JSON.stringify(this._libraryMsg());
      for (const c of this.conns) if (c.device) c.send(text);
    }, 1000);
  }

  _libraryMsg() {
    const songs = (this.library.songs() || []).filter((s) => s && s.id).map(songRow);
    songs.sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return { type: 'library', songs };
  }

  _changed() {
    this.emit('status', this.status());
  }

  // ------------------------------------------------------------ the page --
  async _http(req, res) {
    const u = new URL(req.url, 'https://x');
    const head = { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, head);
      return res.end();
    }
    const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
    if (parts[0] === 'art') {
      const dev = this._deviceFor(u.searchParams.get('k'));
      const song = dev && parts[1] ? this.library.get(parts[1]) : null;
      const file = song && this.artFile ? await this.artFile(song, Math.min(512, Number(u.searchParams.get('size')) || 256)).catch(() => null) : null;
      if (!file) {
        res.writeHead(404, head);
        return res.end();
      }
      const buf = await fsp.readFile(file);
      res.writeHead(200, { ...head, 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' });
      return res.end(buf);
    }
    let base = this.staticDir;
    let rel = parts.length ? parts : ['index.html'];
    if (parts[0] === 'fonts' && this.fontsDir) {
      base = this.fontsDir;
      rel = parts.slice(1);
    }
    if (rel.some((p) => p === '..' || p.includes('\\') || p.includes('\0'))) {
      res.writeHead(404, head);
      return res.end();
    }
    const file = path.join(base, ...rel);
    if (!(file + path.sep).startsWith(base + path.sep) && file !== base) {
      res.writeHead(404, head);
      return res.end();
    }
    let buf;
    try {
      buf = await fsp.readFile(file);
    } catch (_) {
      res.writeHead(404, head);
      return res.end();
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const extra = type.startsWith('text/html') ? { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'; font-src 'self'" } : {};
    res.writeHead(200, { ...head, ...extra, 'Content-Type': type, 'Content-Length': buf.length });
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  _deviceFor(token) {
    if (!token || typeof token !== 'string' || token.length < 20) return null;
    const h = hash(token);
    return this.cfg().devices.find((d) => d.hash === h) || null;
  }

  // ------------------------------------------------------------ the link --
  _upgrade(req, socket) {
    const u = new URL(req.url, 'https://x');
    if (u.pathname !== '/ws' || this.conns.size >= MAX_CONNS) return socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    const c = ws.accept(req, socket);
    if (!c) return;
    c.device = null;
    this.conns.add(c);
    c.waitTimer = setTimeout(() => !c.device && c.close(4000), PAIR_WAIT);
    c.on('message', (text) => {
      let m;
      try {
        m = JSON.parse(text);
      } catch (_) {
        return;
      }
      if (m && typeof m === 'object') this._message(c, m);
    });
    c.on('close', () => {
      clearTimeout(c.waitTimer);
      const had = !!c.device;
      this.conns.delete(c);
      if (had) this._changed();
    });
  }

  _welcome(c, dev, extra = {}) {
    clearTimeout(c.waitTimer);
    c.device = { id: dev.id, name: dev.name };
    const devices = this.cfg().devices.map((d) => (d.id === dev.id ? { ...d, seen: Date.now() } : d));
    this.settings.set({ companion: { devices } });
    c.send(JSON.stringify({ type: 'welcome', ...extra, device: c.device, pc: { name: this.pcName, version: this.version }, now: nowMs() }));
    c.send(JSON.stringify(this._libraryMsg()));
    if (this.last) c.send(JSON.stringify(this.last));
    this._changed();
  }

  _message(c, m) {
    const name = String(m.name || 'Quest').slice(0, 40);
    if (m.type === 'ping') {
      // the headset works out how far its clock is from ours (allowed before pairing: it says nothing)
      return c.send(JSON.stringify({ type: 'pong', id: m.id, t0: m.t0, pc: nowMs() }));
    }
    if (m.type === 'hello') {
      const dev = this._deviceFor(m.token);
      if (dev) return this._welcome(c, dev);
      return c.send(JSON.stringify({ type: 'need-code', pc: { name: this.pcName } }));
    }
    if (m.type === 'pair') {
      if (!this.code) return;
      if (String(m.code || '') !== this.code) {
        this.wrong++;
        let left = WRONG_LIMIT - this.wrong;
        if (left <= 0) {
          // too many tries: a new code, so guessing gets nowhere
          this.code = code4();
          this.wrong = 0;
          left = WRONG_LIMIT;
          this._changed();
          return c.send(JSON.stringify({ type: 'bad-code', left, changed: true }));
        }
        return c.send(JSON.stringify({ type: 'bad-code', left }));
      }
      const token = crypto.randomBytes(24).toString('base64url');
      const dev = { id: `q_${crypto.randomBytes(5).toString('hex')}`, name, hash: hash(token), added: Date.now(), seen: Date.now() };
      this.settings.set({ companion: { devices: [...this.cfg().devices, dev] } });
      this.code = code4(); // a code works once
      this.wrong = 0;
      return this._welcome(c, dev, { token });
    }
    if (!c.device) return;
    // from a paired headset: the page on the PC does it, exactly as if you'd clicked there
    if (m.type === 'pick' && typeof m.id === 'string' && this.library.get(m.id)) return this.emit('cmd', { type: 'pick', id: m.id, from: c.device.name });
    if (m.type === 'play' || m.type === 'pause' || m.type === 'toggle') return this.emit('cmd', { type: m.type });
    if (m.type === 'seek' && Number.isFinite(Number(m.t))) return this.emit('cmd', { type: 'seek', t: Math.max(0, Number(m.t)) });
    if (m.type === 'library') return c.send(JSON.stringify(this._libraryMsg()));
  }
}

module.exports = { Companion, addresses, nowMs, songRow, DEFAULT_PORT };
