'use strict';
/**
 * A small WebSocket (RFC 6455) for the Quest companion: text messages only,
 * Node built-ins only (Stagehand ships without node_modules).
 *
 * accept(req, socket) answers an HTTP upgrade and returns a connection with
 * send(obj), close(), and 'message' / 'close' events. The same frame code is
 * used by the tests' client (encode with a mask, as browsers do).
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 4 * 1024 * 1024; // a chart is a few hundred KB at most

/** One frame: fin set, opcode, optional 4-byte mask (clients must mask). */
function encode(opcode, payload, mask = false) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const out = Buffer.alloc(head + (mask ? 4 : 0) + len);
  out[0] = 0x80 | opcode;
  if (len < 126) out[1] = len;
  else if (len < 65536) {
    out[1] = 126;
    out.writeUInt16BE(len, 2);
  } else {
    out[1] = 127;
    out.writeBigUInt64BE(BigInt(len), 2);
  }
  if (mask) {
    out[1] |= 0x80;
    const key = crypto.randomBytes(4);
    key.copy(out, head);
    for (let i = 0; i < len; i++) out[head + 4 + i] = data[i] ^ key[i & 3];
  } else data.copy(out, head);
  return out;
}

/** Reads whole frames off a growing buffer. */
class Decoder {
  constructor() {
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.partOp = 0;
  }
  /** Adds bytes; returns finished messages as { op, data } (op 1 text, 2 binary, 8 close, 9 ping, 10 pong). */
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      const fin = !!(b[0] & 0x80);
      const op = b[0] & 0x0f;
      const masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f;
      let p = 2;
      if (len === 126) {
        if (b.length < 4) break;
        len = b.readUInt16BE(2);
        p = 4;
      } else if (len === 127) {
        if (b.length < 10) break;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) throw new Error('message too large');
        len = Number(big);
        p = 10;
      }
      if (len > MAX_MESSAGE) throw new Error('message too large');
      const need = p + (masked ? 4 : 0) + len;
      if (b.length < need) break;
      let data = b.subarray(p + (masked ? 4 : 0), need);
      if (masked) {
        const key = b.subarray(p, p + 4);
        const d = Buffer.alloc(len);
        for (let i = 0; i < len; i++) d[i] = data[i] ^ key[i & 3];
        data = d;
      } else data = Buffer.from(data);
      this.buf = b.subarray(need);
      if (op >= 8) {
        out.push({ op, data });
        continue;
      }
      if (op !== 0) {
        this.partOp = op;
        this.parts = [];
      }
      this.parts.push(data);
      if (this.parts.reduce((n, x) => n + x.length, 0) > MAX_MESSAGE) throw new Error('message too large');
      if (fin) {
        out.push({ op: this.partOp, data: Buffer.concat(this.parts) });
        this.parts = [];
      }
    }
    return out;
  }
}

class Connection extends EventEmitter {
  constructor(socket, { mask = false } = {}) {
    super();
    this.socket = socket;
    this.mask = mask;
    this.open = true;
    this.dec = new Decoder();
    socket.setNoDelay(true);
    socket.on('data', (chunk) => {
      let msgs;
      try {
        msgs = this.dec.push(chunk);
      } catch (_) {
        return this.close(1009);
      }
      for (const m of msgs) {
        if (m.op === 1) {
          let obj = null;
          try {
            obj = JSON.parse(m.data.toString('utf8'));
          } catch (_) {}
          if (obj && typeof obj === 'object') this.emit('message', obj);
        } else if (m.op === 9) this._raw(encode(10, m.data, this.mask));
        else if (m.op === 8) this.close();
      }
    });
    const gone = () => {
      if (!this.open) return;
      this.open = false;
      this.emit('close');
    };
    socket.on('close', gone);
    socket.on('error', gone);
    socket.on('end', gone);
  }
  _raw(buf) {
    if (!this.open) return false;
    try {
      this.socket.write(buf);
      return true;
    } catch (_) {
      return false;
    }
  }
  /** Sends one object as JSON text. */
  send(obj) {
    return this._raw(encode(1, JSON.stringify(obj), this.mask));
  }
  /** How much is waiting to go out (a slow headset: skip a clock message rather than queue them). */
  get backlog() {
    return this.socket.writableLength || 0;
  }
  ping() {
    return this._raw(encode(9, Buffer.alloc(0), this.mask));
  }
  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code, 0);
    this._raw(encode(8, b, this.mask));
    this.open = false;
    try {
      this.socket.end();
    } catch (_) {}
    setTimeout(() => {
      try {
        this.socket.destroy();
      } catch (_) {}
    }, 500).unref?.();
    this.emit('close');
  }
}

/** Answers a browser's upgrade request. Returns null (and drops the socket) when it isn't one. */
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return null;
  }
  const answer = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${answer}`, '', ''].join('\r\n'));
  return new Connection(socket);
}

module.exports = { accept, encode, Decoder, Connection, GUID };
