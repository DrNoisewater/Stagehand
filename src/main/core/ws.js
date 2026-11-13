'use strict';
/**
 * A small WebSocket (RFC 6455) for the Quest companion (4.16): text messages, ping and
 * close, no extensions. The server side takes an HTTP upgrade; `connect` is a client
 * for tests (and anything else in Node that needs to talk to the companion).
 *
 * Node built-ins only.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX = 4 * 1024 * 1024; // one message at most (a song's chart is a few hundred KB)

class Conn extends EventEmitter {
  constructor(socket, { client = false } = {}) {
    super();
    this.socket = socket;
    this.client = client; // a client masks what it sends
    this.open = true;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    socket.setNoDelay(true);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  send(text) {
    if (!this.open) return false;
    this._frame(0x1, Buffer.from(typeof text === 'string' ? text : JSON.stringify(text), 'utf8'));
    return true;
  }

  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    this._frame(0x8, b);
    this.open = false;
    setTimeout(() => this.socket.destroy(), 200).unref?.();
  }

  _frame(op, payload) {
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
    if (this.client) {
      head[1] |= 0x80;
      const mask = crypto.randomBytes(4);
      const body = Buffer.from(payload);
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
      this.socket.write(Buffer.concat([head, mask, body]));
    } else this.socket.write(Buffer.concat([head, payload]));
  }

  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80);
      const op = b[0] & 0x0f;
      const masked = !!(b[1] & 0x80);
      let n = b[1] & 0x7f;
      let at = 2;
      if (n === 126) {
        if (b.length < 4) return;
        n = b.readUInt16BE(2);
        at = 4;
      } else if (n === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX)) return this._fail();
        n = Number(big);
        at = 10;
      }
      if (n > MAX) return this._fail();
      // a client must mask what it sends; a server must not
      if (masked === this.client) return this._fail();
      const maskAt = at;
      if (masked) at += 4;
      if (b.length < at + n) return;
      let payload = b.subarray(at, at + n);
      if (masked) {
        payload = Buffer.from(payload);
        for (let i = 0; i < n; i++) payload[i] ^= b[maskAt + (i & 3)];
      }
      this.buf = b.subarray(at + n);
      if (op === 0x8) {
        if (this.open) {
          this.open = false;
          this._frameRaw(0x8, Buffer.alloc(0));
        }
        this.socket.end();
        return;
      }
      if (op === 0x9) {
        this._frameRaw(0xa, payload);
        continue;
      }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.parts.push(payload);
        const total = this.parts.reduce((s, p) => s + p.length, 0);
        if (total > MAX) return this._fail();
        if (fin) {
          const msg = Buffer.concat(this.parts).toString('utf8');
          this.parts = [];
          this.emit('message', msg);
        }
        continue;
      }
      return this._fail();
    }
  }

  _frameRaw(op, payload) {
    try {
      this._frame(op, payload);
    } catch (_) {}
  }

  _fail() {
    this.open = false;
    this.socket.destroy();
  }

  _closed() {
    if (this._gone) return;
    this._gone = true;
    this.open = false;
    this.emit('close');
  }
}

/** Takes an HTTP 'upgrade'. Returns the connection, or null (and answers 400) if it isn't a WebSocket. */
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey}`, '', ''].join('\r\n'));
  return new Conn(socket);
}

/** A client (tests): connect('wss://127.0.0.1:7787/ws', { ca }) → Promise<Conn> */
function connect(url, { ca = null, rejectUnauthorized = true, timeout = 5000 } = {}) {
  const u = new URL(url);
  const secure = u.protocol === 'wss:';
  const lib = secure ? require('tls') : require('net');
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const port = Number(u.port) || (secure ? 443 : 80);
    const opts = secure ? { host: u.hostname, port, ca: ca || undefined, rejectUnauthorized, servername: /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ? undefined : u.hostname } : { host: u.hostname, port };
    const socket = lib.connect(opts, () => {
      socket.write([`GET ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`, 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''].join('\r\n'));
    });
    const timer = setTimeout(() => (socket.destroy(), reject(new Error('timed out'))), timeout);
    let head = Buffer.alloc(0);
    const onData = (d) => {
      head = Buffer.concat([head, d]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.removeListener('data', onData);
      clearTimeout(timer);
      const text = head.subarray(0, end).toString();
      const want = crypto.createHash('sha1').update(key + GUID).digest('base64');
      if (!/^HTTP\/1\.1 101/.test(text) || !text.includes(want)) {
        socket.destroy();
        return reject(new Error(`not a WebSocket: ${text.split('\r\n')[0]}`));
      }
      const c = new Conn(socket, { client: true });
      resolve(c);
      const rest = head.subarray(end + 4);
      if (rest.length) c._data(rest);
    };
    socket.on('data', onData);
    socket.on('error', (e) => (clearTimeout(timer), reject(e)));
  });
}

module.exports = { accept, connect, Conn };
