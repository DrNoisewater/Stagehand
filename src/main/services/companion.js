'use strict';
/**
 * The Quest companion (4.16): Stagehand on the PC serves a page to the Meta Quest's
 * browser on the home network, so the headset can show your library, the highway
 * and (later) the piano's falling notes. The PC stays the engine: cable, sound,
 * note detection, the song itself. The headset only draws.
 *
 * Nothing listens on the network until the switch (Settings › Quest) is on.
 *
 * - https (a certificate Stagehand makes for itself: the Quest's browser only allows
 *   VR on a secure page) on one port, default 4180, the same every time;
 * - the page itself needs no key; everything else does. A headset gets its key by
 *   typing the 4-digit code shown on the PC once; the PC keeps it (hashed) and the
 *   headset keeps it, so it reconnects by itself from then on;
 * - one WebSocket per headset: the library, a song's chart on request, and the song's
 *   clock and play state about 30 times a second while it plays;
 * - clock sync: the headset pings, the PC answers with its own clock (ms since 1970,
 *   with fractions), and the headset keeps the fastest round trips.
 *
 * Node built-ins only. Everything outside (library, charts, covers, settings) is
 * passed in, so the tests run it in plain Node.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const ws = require('../core/wsserver');
const selfcert = require('../core/selfcert');

const DEFAULT_PORT = 4180;
const MAX_DEVICES = 8;
const MAX_DATA = 64 * 1024; // what a headset may keep on the PC (piano position, timing), per headset
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf' };

const nowMs = () => performance.timeOrigin + performance.now();
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** The PC's addresses on the home network, the likeliest first (no virtual adapters, no link-local). */
function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const a of list || []) {
      const fam = a.family === 4 ? 'IPv4' : a.family;
      if (fam !== 'IPv4' || a.internal || /^169\.254\./.test(a.address)) continue;
      const virtual = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|Loopback|Tailscale|ZeroTier|Hamachi|vbox|virbr|br-/i.test(name);
      const home = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const wifi = /wi-?fi|wlan|wireless/i.test(name);
      out.push({ address: a.address, name, score: (home ? 4 : 0) + (virtual ? -8 : 0) + (wifi ? 1 : 0) + (/^192\.168\./.test(a.address) ? 1 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => ({ address: x.address, name: x.name }));
}

function songItem(s) {
  const parts = (s.arrangements || [])
    .filter((a) => ['lead', 'rhythm', 'bass', 'combo'].includes(a.type))
    .map((a) => ({ id: a.id, type: a.type === 'combo' ? 'lead' : a.type, name: a.name || a.type, bonus: !!a.bonus }));
  return {
    id: s.id,
    title: s.title || '',
    artist: s.artist || '',
    album: s.album || '',
    year: s.year || null,
    length: Math.round(Number(s.length) || 0),
    tuning: s.tuning || null,
    parts,
    vocals: (s.arrangements || []).some((a) => a.type === 'vocals' || a.type === 'jvocals'),
  };
}

class Companion extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.pageDir   the headset's page (src/companion)
   * @param {object} o.store     { get(): settings.companion, set(patch) }
   * @param {Function} o.songs   () -> library songs
   * @param {Function} o.loadTab (songId, arrId) -> chart (tabs.load)
   * @param {Function} [o.cover] (songId, size) -> image file path or null
   * @param {Function} [o.log]
   */
  constructor(o) {
    super();
    this.o = o;
    this.log = o.log || (() => {});
    this.server = null;
    this.port = null;
    this.clients = new Set();
    this.state = null; // the latest play state from the PC's window
    this.song = null; // { songId, arrId } the PC is on
    this.failed = []; // times of wrong codes (a lock after 5 in a minute)
    this.error = null;
    this._libTimer = null;
  }

  cfg() {
    return this.o.store.get() || {};
  }
  save(patch) {
    this.o.store.set(patch);
  }

  // ------------------------------------------------------------ switch --
  get running() {
    return !!this.server;
  }

  /** Starts listening (the switch turned on). Port: the saved one, else 4180, else the next free one. */
  async start() {
    if (this.server) return this.status();
    this.error = null;
    const c = this.cfg();
    if (!c.code) this.save({ code: newCode() });
    const tls = this._cert();
    const want = Number(c.port) || DEFAULT_PORT;
    const tries = this.o.port === 0 ? [0] : [want, ...Array.from({ length: 9 }, (_, i) => DEFAULT_PORT + i)].filter((p, i, a) => a.indexOf(p) === i);
    let lastErr = null;
    for (const p of tries) {
      try {
        await this._listen(tls, p);
        if (this.o.port !== 0 && p !== want) this.save({ port: p });
        this.log(`Quest companion on (port ${this.port})`);
        return this.status();
      } catch (err) {
        lastErr = err;
      }
    }
    this.error = lastErr ? lastErr.message : 'No free port';
    throw new Error(`Couldn’t open the Quest connection: ${this.error}`);
  }

  _listen(tls, port) {
    return new Promise((resolve, reject) => {
      const srv = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => this._http(req, res));
      srv.on('upgrade', (req, socket) => this._upgrade(req, socket));
      srv.on('tlsClientError', () => {}); // a headset that hasn't said yes to the certificate yet
      const fail = (err) => {
        srv.removeAllListeners('listening');
        reject(err);
      };
      srv.once('error', fail);
      srv.listen(port, this.o.host || '0.0.0.0', () => {
        srv.removeListener('error', fail);
        srv.on('error', (err) => this.log(`Quest companion: ${err.message}`));
        this.server = srv;
        this.port = srv.address().port;
        resolve();
      });
    });
  }

  /** Stops listening and lets every headset go (the switch turned off). */
  async stop() {
    const srv = this.server;
    if (!srv) return this.status();
    this.server = null;
    for (const c of [...this.clients]) c.conn.close(1001);
    this.clients.clear();
    await new Promise((r) => {
      srv.close(() => r());
      if (srv.closeAllConnections) srv.closeAllConnections();
      setTimeout(r, 1500).unref?.();
    });
    this.port = null;
    this.log('Quest companion off');
    this.emit('clients', 0);
    return this.status();
  }

  /** The certificate, made once and kept (a new one only when the PC's address changed or it is near its end). */
  _cert() {
    const c = this.cfg();
    const ips = lanAddresses(this.o.interfaces).map((a) => a.address);
    const cert = c.cert;
    const fresh = cert && cert.key && cert.cert && Date.now() - (cert.made || 0) < 790 * 86400e3 && ips.every((ip) => (cert.ips || []).includes(ip));
    if (fresh) return cert;
    const made = selfcert.make({ ips: ['127.0.0.1', ...ips], names: ['localhost', os.hostname().toLowerCase()].filter(Boolean), days: 825 });
    this.save({ cert: { key: made.key, cert: made.cert, ips: made.ips, made: made.made } });
    return made;
  }

  // ------------------------------------------------------------ status --
  status() {
    const c = this.cfg();
    const addrs = lanAddresses(this.o.interfaces);
    const connected = new Set([...this.clients].map((x) => x.device && x.device.id));
    return {
      on: !!this.server,
      port: this.port || Number(c.port) || DEFAULT_PORT,
      address: addrs[0] ? `https://${addrs[0].address}:${this.port || Number(c.port) || DEFAULT_PORT}` : null,
      others: addrs.slice(1).map((a) => `https://${a.address}:${this.port || Number(c.port) || DEFAULT_PORT}`),
      network: addrs[0] ? addrs[0].name : null,
      code: c.code || null,
      devices: (c.devices || []).map((d) => ({ id: d.id, name: d.name, added: d.added, lastSeen: d.lastSeen, connected: connected.has(d.id) })),
      clients: [...this.clients].filter((x) => x.device).length,
      locked: this._lockedFor() > 0,
      error: this.error,
    };
  }

  newCode() {
    this.save({ code: newCode() });
    this.failed = [];
    this.emit('status');
    return this.status();
  }

  /** Forgets a headset: it must type the code again (and is let go now). */
  forget(id) {
    const c = this.cfg();
    this.save({ devices: (c.devices || []).filter((d) => d.id !== id) });
    for (const x of [...this.clients]) if (x.device && x.device.id === id) x.conn.close(4001);
    this.emit('status');
    return this.status();
  }

  // --------------------------------------------------------- from the PC --
  /**
   * The PC's play state: { songId, arrId, part, t, at, playing, speed, open, score }.
   * t is the song clock (s) at time at (PC ms since 1970). Sent on to every headset.
   */
  setState(s) {
    if (!s || typeof s !== 'object') return;
    const st = {
      songId: s.songId || null,
      arrId: s.arrId || null,
      part: s.part || null,
      t: Number(s.t) || 0,
      at: Number(s.at) || nowMs(),
      playing: !!s.playing,
      speed: Number(s.speed) || 1,
      open: !!s.open,
      dur: Number(s.dur) || 0,
      score: s.score || null,
    };
    const changed = !this.state || this.state.songId !== st.songId || this.state.arrId !== st.arrId;
    this.state = st;
    if (changed) this.broadcast({ type: 'song', songId: st.songId, arrId: st.arrId, part: st.part });
    this.broadcast({ type: 'state', ...st }, true);
  }

  /** A note judged on the PC: { t, hit, notes: [{ s, f }] } (the headset lights it up). */
  judged(e) {
    if (!e) return;
    this.broadcast({ type: 'judged', t: Number(e.t) || 0, hit: !!e.hit, notes: Array.isArray(e.notes) ? e.notes.slice(0, 8) : [] });
  }

  /** The library changed: headsets get the new list (once a second at most). */
  libraryChanged() {
    if (!this.server || !this.clients.size) return;
    clearTimeout(this._libTimer);
    this._libTimer = setTimeout(() => this.broadcast(this._library()), 1000);
    this._libTimer.unref?.();
  }

  broadcast(msg, lossy = false) {
    for (const c of this.clients) {
      if (!c.device) continue;
      if (lossy && c.conn.backlog > 256 * 1024) continue; // a slow headset: drop a clock tick, never queue them
      c.conn.send(msg);
    }
  }

  // --------------------------------------------------------------- http --
  _http(req, res) {
    const u = new URL(req.url, 'https://x');
    const head = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const send = (code, type, body) => {
      res.writeHead(code, { ...head, 'Content-Type': type });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'No');
    if (u.pathname === '/' || u.pathname === '/index.html') return this._file(res, 'index.html', head);
    if (u.pathname.startsWith('/app/')) return this._file(res, u.pathname.slice(5), head);
    if (u.pathname.startsWith('/fonts/') && this.o.fontDir) return this._file(res, u.pathname.slice(7), { ...head, 'Cache-Control': 'max-age=86400' }, this.o.fontDir);
    if (u.pathname.startsWith('/cover/')) {
      if (!this._deviceForToken(u.searchParams.get('k'))) return send(403, 'text/plain', 'Pair first');
      const id = decodeURIComponent(u.pathname.slice(7));
      Promise.resolve()
        .then(() => (this.o.cover ? this.o.cover(id, Math.min(500, Number(u.searchParams.get('size')) || 250)) : null))
        .then((f) => {
          if (!f) return send(404, 'text/plain', 'No cover');
          fs.readFile(f, (err, buf) => {
            if (err) return send(404, 'text/plain', 'No cover');
            const type = buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';
            res.writeHead(200, { ...head, 'Cache-Control': 'max-age=86400', 'Content-Type': type });
            res.end(buf);
          });
        })
        .catch(() => send(404, 'text/plain', 'No cover'));
      return;
    }
    if (u.pathname === '/hello') return send(200, 'application/json', JSON.stringify({ stagehand: true, version: this.o.version || null }));
    send(404, 'text/plain', 'Not here');
  }

  _file(res, rel, head, dir = this.o.pageDir) {
    const base = path.resolve(dir);
    const f = path.resolve(base, decodeURIComponent(rel));
    const type = TYPES[path.extname(f).toLowerCase()];
    if (!type || (f !== base && !f.startsWith(base + path.sep))) {
      res.writeHead(404, { ...head, 'Content-Type': 'text/plain' });
      return res.end('Not here');
    }
    fs.readFile(f, (err, buf) => {
      if (err) {
        res.writeHead(404, { ...head, 'Content-Type': 'text/plain' });
        return res.end('Not here');
      }
      res.writeHead(200, { ...head, 'Content-Type': type });
      res.end(buf);
    });
  }

  // ----------------------------------------------------------- sockets --
  _upgrade(req, socket) {
    const u = new URL(req.url, 'https://x');
    if (u.pathname !== '/ws' || this.clients.size >= 16) return socket.destroy();
    const conn = ws.accept(req, socket);
    if (!conn) return;
    const client = { conn, device: null, addr: req.socket.remoteAddress };
    this.clients.add(client);
    // a headset must say who it is within 10 seconds
    const timer = setTimeout(() => !client.device && conn.close(4000), 10000);
    timer.unref?.();
    const alive = setInterval(() => conn.ping(), 15000);
    alive.unref?.();
    conn.on('message', (m) => {
      try {
        this._message(client, m);
      } catch (err) {
        this.log(`Quest companion: ${err.message}`);
      }
    });
    conn.on('close', () => {
      clearTimeout(timer);
      clearInterval(alive);
      const had = !!client.device;
      this.clients.delete(client);
      if (had) {
        this.emit('clients', this.status().clients);
        this.emit('status');
      }
    });
  }

  _lockedFor() {
    const t = Date.now();
    this.failed = this.failed.filter((x) => t - x < 60000);
    return this.failed.length >= 5 ? 60000 - (t - this.failed[0]) : 0;
  }

  _deviceForToken(token) {
    if (!token || typeof token !== 'string') return null;
    const h = hash(token);
    return (this.cfg().devices || []).find((d) => d.tokenHash === h) || null;
  }

  _welcome(client, device, token) {
    client.device = device;
    const devices = (this.cfg().devices || []).map((d) => (d.id === device.id ? { ...d, lastSeen: Date.now() } : d));
    this.save({ devices });
    client.conn.send({ type: 'welcome', device: { id: device.id, name: device.name, data: device.data || {} }, token: token || undefined, pc: { name: os.hostname(), version: this.o.version || null }, now: nowMs() });
    client.conn.send(this._library());
    if (this.state) {
      client.conn.send({ type: 'song', songId: this.state.songId, arrId: this.state.arrId, part: this.state.part });
      client.conn.send({ type: 'state', ...this.state });
    }
    this.emit('clients', this.status().clients);
    this.emit('status');
  }

  _library() {
    const songs = (this.o.songs() || []).map(songItem).filter((s) => s.parts.length || s.vocals);
    songs.sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return { type: 'library', songs };
  }

  _message(client, m) {
    const conn = client.conn;
    // the clock: answered before anything else, whether paired or not
    if (m.type === 'ping') return conn.send({ type: 'pong', c: m.c, s: nowMs() });
    if (!client.device) {
      if (m.type === 'hello') {
        const d = this._deviceForToken(m.token);
        if (d) return this._welcome(client, d);
        return conn.send({ type: 'pair-needed' });
      }
      if (m.type === 'pair') {
        const wait = this._lockedFor();
        if (wait > 0) return conn.send({ type: 'pair-wait', seconds: Math.ceil(wait / 1000) });
        const code = String(m.code || '').replace(/\D/g, '');
        if (!code || code !== String(this.cfg().code || '')) {
          this.failed.push(Date.now());
          return conn.send({ type: 'pair-wrong', left: Math.max(0, 5 - this.failed.length) });
        }
        const token = crypto.randomBytes(24).toString('base64url');
        const name = String(m.name || 'Quest').slice(0, 40) || 'Quest';
        const device = { id: crypto.randomBytes(6).toString('hex'), name, tokenHash: hash(token), added: Date.now(), lastSeen: Date.now(), data: {} };
        let devices = [...(this.cfg().devices || []), device];
        if (devices.length > MAX_DEVICES) devices = devices.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).slice(0, MAX_DEVICES);
        this.save({ devices });
        this.log(`Quest companion: paired ${name}`);
        return this._welcome(client, device, token);
      }
      return conn.send({ type: 'pair-needed' });
    }
    switch (m.type) {
      case 'library':
        return conn.send(this._library());
      case 'tab':
        return this._tab(client, m);
      case 'save': {
        // the headset's own things kept on the PC (its piano position, its timing)
        const key = String(m.key || '').slice(0, 40);
        if (!key) return;
        const devices = (this.cfg().devices || []).map((d) => {
          if (d.id !== client.device.id) return d;
          const data = { ...(d.data || {}), [key]: m.value };
          if (JSON.stringify(data).length > MAX_DATA) return d;
          client.device = { ...d, data };
          return client.device;
        });
        this.save({ devices });
        return conn.send({ type: 'saved', key, req: m.req });
      }
      case 'pick':
      case 'play':
      case 'pause':
      case 'seek':
      case 'part':
        return this.emit('command', { type: m.type, songId: m.songId ? String(m.songId) : undefined, arrId: m.arrId ? String(m.arrId) : undefined, t: Number.isFinite(Number(m.t)) ? Number(m.t) : undefined, from: client.device.name });
      default:
    }
  }

  async _tab(client, m) {
    const songId = String(m.songId || '');
    try {
      const tab = await this.o.loadTab(songId, m.arrId ? String(m.arrId) : null);
      client.conn.send({ type: 'tab', req: m.req, songId, tab });
    } catch (err) {
      client.conn.send({ type: 'tab', req: m.req, songId, error: err.message });
    }
  }
}

function newCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

module.exports = { Companion, lanAddresses, songItem, DEFAULT_PORT, nowMs };
