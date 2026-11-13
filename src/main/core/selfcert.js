'use strict';
/**
 * A self-signed certificate for the Quest companion's page. The Quest's browser
 * only allows VR (WebXR) on a secure (https) page, and a home network has no
 * real certificate, so Stagehand makes its own: an EC P-256 key and an X.509
 * certificate written by hand (Node has no certificate maker built in).
 * The headset asks once ("not private": Advanced › Proceed) and then trusts it.
 *
 * make({ ips, names, days }) -> { key, cert } in PEM, plus the SHA-256 fingerprint.
 */
const crypto = require('crypto');

// ------------------------------------------------------------ DER pieces --
function len(n) {
  if (n < 128) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 255);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const ctx = (n, body, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);
function int(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(s) {
  const p = s.split('.').map(Number);
  const out = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) {
    const b = [v & 127];
    let x = Math.floor(v / 128);
    while (x > 0) {
      b.unshift((x & 127) | 128);
      x = Math.floor(x / 128);
    }
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
}
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bits = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const octets = (buf) => tlv(0x04, buf);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
function time(d) {
  // UTCTime up to 2049, GeneralizedTime after (as RFC 5280 asks)
  const z = (n, w = 2) => String(n).padStart(w, '0');
  const y = d.getUTCFullYear();
  const rest = `${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z`;
  return y < 2050 ? tlv(0x17, Buffer.from(`${z(y % 100)}${rest}`)) : tlv(0x18, Buffer.from(`${y}${rest}`));
}
function ipBytes(ip) {
  const p = String(ip).split('.').map(Number);
  return p.length === 4 && p.every((x) => x >= 0 && x <= 255) ? Buffer.from(p) : null;
}

function make({ ips = ['127.0.0.1'], names = ['localhost'], days = 3650, cn = 'Stagehand on this PC' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const name = seq(set(seq(oid('2.5.4.3'), utf8(cn))), set(seq(oid('2.5.4.10'), utf8('Stagehand'))));
  const now = Date.now();
  const validity = seq(time(new Date(now - 86400e3)), time(new Date(now + days * 86400e3)));
  const san = [];
  for (const n of names) san.push(ctx(2, Buffer.from(n, 'ascii'), false));
  for (const ip of ips) {
    const b = ipBytes(ip);
    if (b) san.push(ctx(7, b, false));
  }
  const ext = seq(
    seq(oid('2.5.29.17'), octets(seq(...san))), // subject alternative names: the PC's addresses
    seq(oid('2.5.29.19'), bool(true), octets(seq())), // basic constraints: not a CA
    seq(oid('2.5.29.15'), bool(true), octets(bits(Buffer.from([0x80])))), // key usage: digital signature
    seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))) // extended key usage: server
  );
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(ctx(0, int(Buffer.from([2]))), int(serial), ecdsaSha256, name, validity, name, spki, ctx(3, ext));
  const sig = crypto.sign('sha256', tbs, privateKey); // DER ECDSA signature
  const der = seq(tbs, ecdsaSha256, bits(sig));
  const pem = (label, b) => `-----BEGIN ${label}-----\n${b.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: pem('CERTIFICATE', der),
    fingerprint: crypto.createHash('sha256').update(der).digest('hex'),
    ips: ips.slice(),
    made: now,
  };
}

module.exports = { make };
