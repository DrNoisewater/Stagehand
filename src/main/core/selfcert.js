'use strict';
/**
 * A self-signed certificate for the Quest companion (4.16). The headset's browser only
 * allows VR on a secure page, so the PC serves the companion over HTTPS with its own
 * certificate. Node can read certificates but not make them, so this writes the few
 * fields a browser needs by hand (DER), signed with an EC P-256 key.
 *
 * Node built-ins only.
 */
const crypto = require('crypto');

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  while (n > 0) {
    b.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const octets = (buf) => tlv(0x04, buf);
const bits = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const ctx = (n, body) => tlv(0xa0 + n, body);

function oid(str) {
  const p = str.split('.').map(Number);
  const out = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) {
    const b = [v & 0x7f];
    let x = v >>> 7;
    while (x) {
      b.unshift((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(d) {
  const p = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const s = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + s)) : tlv(0x18, Buffer.from(String(y) + s));
}

function ipBytes(ip) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return Buffer.from(ip.split('.').map(Number));
  return null;
}

/**
 * Makes a key and a certificate. `names`: the PC's addresses (IPs) and host names.
 * Returns { key, cert } as PEM text.
 */
function makeCert({ names = [], days = 3650, cn = 'Stagehand' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const sigAlg = seq(oid('1.2.840.10045.4.3.2'));
  const name = seq(set(seq(oid('2.5.4.3'), utf8(cn))));
  const now = new Date(Date.now() - 24 * 3600e3);
  const end = new Date(now.getTime() + days * 24 * 3600e3);
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const general = [];
  for (const n of new Set(['localhost', '127.0.0.1', ...certNames(names)])) {
    const ip = ipBytes(n);
    general.push(ip ? tlv(0x87, ip) : tlv(0x82, Buffer.from(n, 'ascii')));
  }
  const exts = seq(
    seq(oid('2.5.29.17'), octets(seq(...general))), // subject alternative names
    seq(oid('2.5.29.19'), octets(seq())), // basic constraints: not a CA
    seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))) // for a web server
  );
  const tbs = seq(ctx(0, int(Buffer.from([2]))), int(serial), sigAlg, name, seq(time(now), time(end)), name, publicKey.export({ type: 'spki', format: 'der' }), tlv(0xa3, exts));
  const sig = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, sigAlg, bits(sig));
  const pem = (label, buf) => `-----BEGIN ${label}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', der) };
}

/**
 * The names a certificate may carry: IPv4 addresses, and host names a browser accepts
 * (letters, digits, dots and dashes; a PC called "Jörg's PC" is left out rather than
 * written wrongly, which would spoil the whole certificate).
 */
function certNames(list) {
  const out = [];
  for (const n of list || []) {
    const s = String(n || '').trim();
    if (ipBytes(s)) out.push(s);
    else if (/^[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*$/.test(s)) out.push(s.toLowerCase());
  }
  return [...new Set(out)];
}

module.exports = { makeCert, certNames };
