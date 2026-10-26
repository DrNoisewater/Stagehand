'use strict';
/**
 * AES-256-CFB (128-bit feedback) for the PSARC table of contents.
 *
 * Built on AES-ECB so it only depends on the most basic cipher primitive,
 * which every OpenSSL/BoringSSL build exposes. CFB is a stream mode, so
 * ciphertext length always equals plaintext length (no padding is stored).
 */
const crypto = require('crypto');

// Public Rocksmith 2014 PSARC key (used by every community tool).
const PSARC_KEY = Buffer.from(
  'C53DB23870A1A2F71CAE64061FDD0E1157309DC85204D4C5BFDF25090DF2572C',
  'hex'
);
const ZERO_IV = Buffer.alloc(16);

function ecb(key) {
  const c = crypto.createCipheriv('aes-256-ecb', key, null);
  c.setAutoPadding(false);
  return c;
}

function decrypt(data, { key = PSARC_KEY, iv = ZERO_IV } = {}) {
  if (data.length === 0) return Buffer.alloc(0);
  const blocks = Math.ceil(data.length / 16);
  const padded = Buffer.alloc(blocks * 16);
  data.copy(padded);
  // Keystream block i = E(C[i-1]); C[-1] = IV. All inputs are known up front.
  const feed = Buffer.concat([iv, padded.subarray(0, (blocks - 1) * 16)]);
  const ks = ecb(key).update(feed);
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return out;
}

function encrypt(data, { key = PSARC_KEY, iv = ZERO_IV } = {}) {
  if (data.length === 0) return Buffer.alloc(0);
  const cipher = ecb(key);
  const out = Buffer.allocUnsafe(data.length);
  let prev = Buffer.from(iv);
  for (let off = 0; off < data.length; off += 16) {
    const ks = cipher.update(prev);
    const end = Math.min(off + 16, data.length);
    const block = Buffer.alloc(16);
    for (let i = off; i < end; i++) {
      out[i] = data[i] ^ ks[i - off];
      block[i - off] = out[i];
    }
    prev = block;
  }
  return out;
}

module.exports = { decrypt, encrypt, PSARC_KEY };
