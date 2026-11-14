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
const net = require('net');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { performance } = require('perf_hooks');
const ws = require('../core/ws');
const { makeCert, certNames } = require('../core/selfcert');

const DEFAULT_PORT = 7787;
const MAX_CONNS = 8;
const WRONG_LIMIT = 5; // wrong codes before the code changes
const PAIR_WAIT = 120e3; // a page that hasn't paired is let go after this
const TYPES = { '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.avif': 'image/avif' };

/** Milliseconds on a clock both Electron processes share (wall time at start + a steady clock since). */
const nowMs = () => performance.timeOrigin + performance.now();
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const code4 = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

// network cards that aren't the home network: virtual machines, WSL, VPNs
const VIRTUAL = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Default Switch|Host-Only|Loopback|docker|veth|^br-|Bluetooth|Teredo|isatap|Npcap|Virtual/i;
const VPN = /VPN|tailscale|ZeroTier|Hamachi|Radmin|WireGuard|Wintun|NordLynx|OpenVPN|TAP-|^tun|^tap|Mullvad|Proton|Surfshark|ExpressVPN|Cisco AnyConnect|GlobalProtect|FortiClient|Zscaler|Cloudflare WARP/i;

/** The PC's addresses on the home network, the likeliest first (with the network card's name). */
function addresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list || []) {
      if (a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      if (/^169\.254\./.test(a.address)) continue; // no network yet
      const vpn = VPN.test(name);
      const virtual = vpn || VIRTUAL.test(name);
      // home routers almost always hand out 192.168.x.x or 10.x.x.x; 172.16–31 is mostly WSL, Docker or Hyper-V
      const home = /^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3;
      out.push({ address: a.address, name, vpn, rank: (virtual ? 10 : 0) + home });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ address, name, vpn }) => ({ address, name, vpn }));
}

const isLoopback = (ip) => !ip || /^(127\.|::1$|::ffff:127\.)/.test(ip);
const plainIp = (ip) => String(ip || '').replace(/^::ffff:/, '');
// how far a visitor from another device got, furthest last
const STEPS = ['knock', 'cert', 'page', 'link'];

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
  constructor({ dir, settings, library, staticDir, fontsDir = null, rendererDir = null, artFile = null, version = '', log = () => {}, pcName = os.hostname(), exe = process.execPath, platform = process.platform, countLoopback = false }) {
    super();
    this.dir = dir;
    this.settings = settings;
    this.library = library;
    this.staticDir = staticDir;
    this.fontsDir = fontsDir || (rendererDir ? path.join(rendererDir, 'fonts') : null);
    this.rendererDir = rendererDir;
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
    this.chart = null; // the notes the PC's highway shows
    this.marks = new Map(); // target id -> 1 hit / 0 miss, this time through
    this.score = null;
    this.error = null;
    this._libTimer = null;
    this.exe = exe;
    this.platform = platform;
    this.countLoopback = countLoopback; // tests: a visit from this PC counts as one from the headset
    this.reach = null; // the furthest another device got since switched on: { at, from, step }
    this.firewall = null; // Windows Firewall, as last checked (Windows only)
    this._fwAt = 0;
    this._fwBusy = null;
    this._sockets = new Set();
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
    // Windows Firewall looked at again now and then while no headset has got through (Settings shows it)
    if (this.server && this.platform === 'win32' && !this._fwBusy && Date.now() - this._fwAt > 60e3 && !(this.reach && this.reach.step === 'link')) {
      this._fwAt = Date.now();
      setImmediate(() => this.checkFirewall().catch(() => {}));
    }
    const online = new Set([...this.conns].filter((x) => x.device).map((x) => x.device.id));
    return {
      on: !!this.server,
      wanted: c.on,
      port: this.port,
      addresses: this.server ? addresses().map((a) => a.address) : [],
      where: this.server ? addresses().map(({ address, name }) => ({ address, name })) : [],
      vpn: this.server ? (addresses().find((a) => a.vpn) || {}).name || null : null,
      url: this.server ? this.urls()[0] || null : null,
      reach: this.server ? this.reach : null,
      firewall: this.server ? this.firewall : null,
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
      // kept while it lasts and still names the PC's address (a router can give the PC a new one)
      const main = addresses()[0];
      const named = !main || (x.subjectAltName || '').split(/,\s*/).includes(`IP Address:${main.address}`);
      if (new Date(x.validTo) - Date.now() > 30 * 24 * 3600e3 && new Date(x.validFrom) <= Date.now() && named) return { key, cert };
    } catch (_) {}
    const made = makeCert({ names: certNames([...addresses().map((a) => a.address), this.pcName]) });
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(keyFile, made.key, { mode: 0o600 });
    await fsp.writeFile(certFile, made.cert);
    return made;
  }

  async start() {
    if (this.server) return this.status();
    this.error = null;
    let key, cert;
    try {
      ({ key, cert } = await this._cert());
    } catch (e) {
      this.error = `Its security certificate couldn't be made (${e.message})`;
      this._changed();
      throw e;
    }
    const tlsServer = https.createServer({ key, cert }, (req, res) => this._http(req, res).catch((e) => {
      this.log(`Quest companion: ${req.url} failed: ${e.message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }));
    tlsServer.on('upgrade', (req, socket) => this._upgrade(req, socket));
    // the headset's first visit, before the certificate is accepted on its warning page, ends this way
    tlsServer.on('tlsClientError', (_e, sock) => this._reached(sock && (sock.remoteAddress || (sock._parent && sock._parent.remoteAddress)), 'cert'));
    // someone typed the address without https:// (the headset's browser then asks with plain http): sent on to https
    const plain = http.createServer((req, res) => this._redirect(req, res));
    // one port for both: a secure visit starts with a TLS handshake (first byte 22), a plain one with text
    const server = net.createServer((sock) => {
      this._sockets.add(sock);
      sock.on('close', () => this._sockets.delete(sock));
      sock.on('error', () => {});
      this._reached(sock.remoteAddress, 'knock');
      sock.setTimeout(15e3, () => sock.destroy());
      sock.once('data', (buf) => {
        sock.setTimeout(0);
        sock.pause();
        sock.unshift(buf);
        (buf[0] === 0x16 ? tlsServer : plain).emit('connection', sock);
        process.nextTick(() => sock.resume());
      });
    });
    server.on('error', () => {});
    this._tls = tlsServer;
    this._plain = plain;
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
      this._changed();
      throw new Error(this.error);
    }
    this.server = server;
    this.port = port;
    this.reach = null;
    this.firewall = null;
    this._fwAt = 0;
    if (port !== want && want === DEFAULT_PORT && !this.cfg().devices.length) this.settings.set({ companion: { port } });
    this.code = code4();
    this.wrong = 0;
    this.log(`Quest companion on ${this.urls().join(', ') || `port ${port}`}`);
    this._changed();
    this.checkFirewall().catch(() => {});
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
    const closed = new Promise((r) => s.close(() => r()));
    for (const sock of this._sockets) sock.destroy();
    this._sockets.clear();
    for (const x of [this._tls, this._plain]) if (x && x.closeAllConnections) x.closeAllConnections();
    this._tls = this._plain = null;
    await closed;
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
    // hits and misses from the PC's judge (only what's new; a headset joining late gets them all, below)
    const j = st.judge && typeof st.judge === 'object' ? st.judge : null;
    if (j) {
      if (j.reset || j.off) this.marks.clear();
      const ev = Array.isArray(j.ev) ? j.ev.filter((e) => Array.isArray(e) && Number.isInteger(e[0])).map((e) => [e[0], e[1] ? 1 : 0]) : [];
      for (const [id, r] of ev) this.marks.set(id, r);
      s.judge = j.off ? { off: true } : { hits: Number(j.hits) || 0, judged: Number(j.judged) || 0, streak: Number(j.streak) || 0, best: Number(j.best) || 0, ev, reset: !!j.reset };
      this.score = j.off ? null : { ...s.judge, ev: undefined, reset: undefined };
    }
    this.last = { ...s, judge: undefined };
    const text = JSON.stringify(s);
    for (const c of this.conns) if (c.device) c.send(text);
  }

  /** The notes of the part the PC's highway shows (once per song and part), for the VR highway. */
  pushChart(chart) {
    if (!chart || typeof chart !== 'object' || !chart.song) return;
    this.chart = { ...chart, type: 'chart' };
    this.marks.clear();
    const text = JSON.stringify(this.chart);
    for (const c of this.conns) if (c.device) c.send(text);
  }

  /** What a headset joining now needs: the notes, where the song is, and the marks so far. */
  _catchUp(c) {
    if (this.chart) c.send(JSON.stringify(this.chart));
    if (this.last) {
      const judge = this.score ? { ...this.score, ev: [...this.marks], reset: true } : undefined;
      c.send(JSON.stringify({ ...this.last, judge }));
    }
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

  // ------------------------------------------------- can the headset get here --
  /** Another device got this far (only the furthest step is kept; a new device starts over). */
  _reached(ip, step) {
    if (!this.server) return;
    if (isLoopback(ip) && !this.countLoopback) return;
    const from = plainIp(ip);
    const r = this.reach;
    if (r && r.from === from && STEPS.indexOf(step) <= STEPS.indexOf(r.step)) {
      r.at = Date.now();
      return;
    }
    if (r && r.from !== from && STEPS.indexOf(step) < STEPS.indexOf(r.step) && Date.now() - r.at < 60e3) return;
    this.reach = { at: Date.now(), from, step };
    this._changed();
  }

  _redirect(req, res) {
    const host = /^[A-Za-z0-9.\-[\]:]{1,100}$/.test(req.headers.host || '') ? req.headers.host : `${addresses()[0] ? addresses()[0].address : 'localhost'}:${this.port}`;
    const to = `https://${host}${req.url && req.url.startsWith('/') ? req.url : '/'}`;
    const safe = to.replace(/[<>"&]/g, '');
    res.writeHead(307, { Location: to, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Stagehand</title><p>Stagehand is at <a href="${safe}">${safe}</a></p>`);
  }

  /**
   * Windows Firewall (Windows only): which network the PC is on (Private or Public) and whether
   * Stagehand is let in, blocked, or has no rule yet. Asks Windows only; changes nothing.
   * → { state: 'allowed' | 'blocked' | 'no-rule' | 'off' | 'unknown', network, netName, at }
   */
  async checkFirewall() {
    if (this.platform !== 'win32' || !this.server) return null;
    if (this._fwBusy) return this._fwBusy;
    this._fwBusy = (async () => {
      const main = addresses()[0];
      const exe = this.exe.replace(/'/g, "''");
      const script = `$ErrorActionPreference='SilentlyContinue'
$exe='${exe}'
$o=@{}
$o.nets=@(Get-NetConnectionProfile | % { @{ alias=$_.InterfaceAlias; name=$_.Name; cat=$_.NetworkCategory.ToString() } })
$o.profiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore | % { @{ name=$_.Name; on=$_.Enabled.ToString(); allowRules=$_.AllowInboundRules.ToString(); inbound=$_.DefaultInboundAction.ToString() } })
$f=@(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | ? { $_.Program -and ([Environment]::ExpandEnvironmentVariables($_.Program) -ieq $exe) })
$r=@($f | Get-NetFirewallRule) + @(Get-NetFirewallRule -DisplayName 'Stagehand Quest headset' -PolicyStore ActiveStore)
$o.rules=@($r | ? { $_ -and $_.Direction.ToString() -eq 'Inbound' -and $_.Enabled.ToString() -eq 'True' } | % { @{ name=$_.DisplayName; action=$_.Action.ToString(); profile=$_.Profile.ToString() } })
$o | ConvertTo-Json -Depth 4 -Compress`;
      const out = await runPowerShell(script, 30e3).catch(() => null);
      this.firewall = readFirewall(out, main ? main.name : null);
      this._fwAt = Date.now();
      this._changed();
      return this.firewall;
    })().finally(() => (this._fwBusy = null));
    return this._fwBusy;
  }

  /**
   * The "let the headset in" button: one rule letting devices on the home network reach
   * Stagehand's companion port (Windows asks for permission first), and the block rules
   * Windows makes when its own question was closed turned off.
   * → { ok, cancelled, firewall }
   */
  async allowFirewall() {
    if (this.platform !== 'win32') return { ok: false, firewall: null };
    const exe = this.exe.replace(/'/g, "''");
    const ports = [...new Set([this.port || DEFAULT_PORT, DEFAULT_PORT, DEFAULT_PORT + 1, DEFAULT_PORT + 2, DEFAULT_PORT + 3])].join(',');
    const inner = `$exe='${exe}'
Get-NetFirewallApplicationFilter | ? { $_.Program -and ([Environment]::ExpandEnvironmentVariables($_.Program) -ieq $exe) } | Get-NetFirewallRule | ? { $_.Direction.ToString() -eq 'Inbound' -and $_.Action.ToString() -eq 'Block' } | Disable-NetFirewallRule
Remove-NetFirewallRule -DisplayName 'Stagehand Quest headset' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Stagehand Quest headset' -Description 'Lets a Meta Quest on your home network open Stagehand (Settings, Quest headset).' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${ports} -Program $exe -RemoteAddress @('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16') -Profile Any | Out-Null
exit 0`;
    const b64 = Buffer.from(inner, 'utf16le').toString('base64');
    const outer = `try { $p = Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${b64}'; exit $p.ExitCode } catch { exit 5 }`;
    let code = 0;
    try {
      await runPowerShell(outer, 120e3);
    } catch (e) {
      code = typeof e.code === 'number' ? e.code : 1;
    }
    const firewall = await this.checkFirewall().catch(() => null);
    return { ok: code === 0, cancelled: code === 5, firewall };
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
    if (rel.length === 1 && rel[0] === 'index.html') this._reached(req.socket && req.socket.remoteAddress, 'page');
    if (parts[0] === 'fonts' && this.fontsDir) {
      base = this.fontsDir;
      rel = parts.slice(1);
    } else if ((parts[0] === 'three' || parts[0] === 'venues') && this.rendererDir) {
      // shared with the app: the 3D library and the venue pictures
      base = parts[0] === 'three' ? path.join(this.rendererDir, 'vendor', 'three') : path.join(this.rendererDir, 'venues');
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
    this._reached(socket.remoteAddress, 'link');
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
    this._catchUp(c);
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

/** Runs a PowerShell script (Windows); resolves with what it printed. */
function runPowerShell(script, timeout) {
  return new Promise((resolve, reject) => {
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], { windowsHide: true, timeout, maxBuffer: 4 << 20 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout || ''))));
  });
}

/** What Windows said, in plain terms, for the network card the PC's address is on. */
function readFirewall(text, cardName) {
  const at = Date.now();
  let o = null;
  try {
    o = JSON.parse(String(text || '').trim());
  } catch (_) {}
  if (!o || typeof o !== 'object') return { state: 'unknown', network: null, netName: null, at };
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  const nets = arr(o.nets);
  const net0 = nets.find((n) => cardName && String(n.alias).toLowerCase() === String(cardName).toLowerCase()) || nets[0] || null;
  const network = net0 ? ({ Public: 'Public', Private: 'Private', DomainAuthenticated: 'Domain' }[net0.cat] || null) : null;
  const profiles = arr(o.profiles);
  const prof = network && profiles.find((p) => p.name === network);
  if (prof && prof.on === 'False') return { state: 'off', network, netName: net0 && net0.name, at };
  const applies = (r) => !network || /Any/i.test(r.profile) || String(r.profile).split(/,\s*/).includes(network);
  const rules = arr(o.rules).filter(applies);
  let state = 'no-rule';
  if (rules.some((r) => r.action === 'Block')) state = 'blocked';
  else if (prof && prof.allowRules === 'False') state = 'blocked';
  else if (rules.some((r) => r.action === 'Allow')) state = 'allowed';
  else if (prof && prof.inbound === 'Allow') state = 'allowed';
  return { state, network, netName: net0 ? net0.name || null : null, at };
}

module.exports = { Companion, addresses, nowMs, songRow, readFirewall, DEFAULT_PORT };
