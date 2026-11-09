'use strict';
/**
 * Meeting points (4.1, split out of friends.js in 4.3): how Stagehands find each
 * other with no Stagehand server. Messages go through public ntfy servers
 * (https://ntfy.sh by default), sealed with AES-256-GCM. The topic and the key
 * both come from a name (HKDF), so a topic only opens for someone who knows it.
 *
 * Node built-ins only (Stagehand ships without node_modules).
 */
const crypto = require('crypto');
const zlib = require('zlib');

const DEFAULT_RELAY = 'https://ntfy.sh';
// Where Stagehands meet: every one is tried at once, so one being down or busy doesn't matter.
const DEFAULT_RELAYS = [DEFAULT_RELAY, 'https://ntfy.envs.net'];
const MAX_MSG = 3800; // ntfy keeps messages up to 4096 bytes inline

/** Tidies a typed code: upper case, only letters and numbers, look-alike letters mapped.
 *  So "Tiger 427", "tiger-427" and "TIGER427" are the same code. */
function normCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

/** Relay topic and message key for an address (4.1: a friend code; 4.3: a hidden address or the room's name). */
function derive(code) {
  const ikm = Buffer.from(normCode(code), 'utf8');
  const salt = Buffer.from('stagehand-friends', 'utf8');
  const room = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('room v1'), 16)).toString('hex');
  const key = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('key v1'), 32));
  return { topic: `stagehand-${room}`, key };
}

function seal(key, topic, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(topic));
  const ct = Buffer.concat([c.update(zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8'))), c.final()]);
  return `sh1.${Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64url')}`;
}

/** Opens a sealed message, or null if it isn't one of ours (wrong code, tampered, junk). */
function open(key, topic, text) {
  try {
    if (typeof text !== 'string' || !text.startsWith('sh1.') || text.length > 8000) return null;
    const b = Buffer.from(text.slice(4), 'base64url');
    if (b.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAAD(Buffer.from(topic));
    d.setAuthTag(b.subarray(b.length - 16));
    const plain = Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]);
    const obj = JSON.parse(zlib.inflateRawSync(plain, { maxOutputLength: 64 * 1024 }).toString('utf8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch (_) {
    return null;
  }
}

/**
 * One ntfy topic subscription (JSON stream). Calls onMessage(text, relayTime)
 * for each message; resolves `ready` once the relay says the stream is open.
 * Reconnects (from the last message seen) until closed. A stream that goes
 * silent (a PC waking from sleep, a dropped Wi-Fi) is noticed by the relay's
 * keepalives stopping and is reopened.
 */
class Subscription {
  constructor({ relay, topic, fetchImpl, onMessage, onOpen = null, log, retry = true, idle = 90000, since = null }) {
    Object.assign(this, { relay, topic, fetchImpl, onMessage, onOpen, log, retry, idle });
    this.closed = false;
    this.since = since; // 4.1.3: '12h' on start, to get messages sent while Stagehand was closed
    this.ctl = null;
    this.isReady = false;
    this.ready = new Promise((res, rej) => {
      this._ready = () => ((this.isReady = true), res());
      this._fail = rej;
    });
    this._run();
  }

  async _run() {
    let wait = 1000;
    while (!this.closed) {
      this.ctl = new AbortController();
      let dog = null;
      const pet = () => {
        clearTimeout(dog);
        dog = setTimeout(() => this.ctl.abort(new Error('the relay went quiet')), this.idle);
      };
      try {
        pet();
        const q = this.since ? `?since=${encodeURIComponent(this.since)}` : '';
        const res = await this.fetchImpl(`${this.relay}/${this.topic}/json${q}`, { signal: this.ctl.signal, headers: { Accept: 'application/x-ndjson' } });
        if (!res.ok || !res.body) throw new Error(`The relay answered ${res.status}`);
        wait = 1000;
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          pet();
          buf += dec.decode(chunk, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev;
            try {
              ev = JSON.parse(line);
            } catch (_) {
              continue;
            }
            if (ev.event === 'open') {
              if (this.onOpen) this.onOpen(Number(ev.time) || 0);
              this._ready();
            }
            else if (ev.event === 'message') {
              if (ev.id) this.since = ev.id;
              try {
                this.onMessage(ev.message, Number(ev.time) || 0);
              } catch (_) {}
            }
          }
          if (this.closed) break;
        }
      } catch (err) {
        if (this.closed) break;
        if (!this.retry) {
          this._fail(err);
          break;
        }
        if (this.log) this.log(`Meeting point ${this.relay}: ${(err && err.message) || err}; retrying`);
      } finally {
        clearTimeout(dog);
      }
      if (this.closed) break;
      if (!this.retry) {
        this._fail(new Error('The relay closed the connection'));
        break;
      }
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 30000);
    }
  }

  close() {
    this.closed = true;
    if (this.ctl) this.ctl.abort();
  }
}

/** "a, b c" or an array → clean list of relay addresses. */
function relayList(v) {
  const list = (Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/))
    .map((u) => String(u || '').trim().replace(/\/+$/, ''))
    .filter((u) => /^https?:\/\/[^\s/]+/.test(u));
  return [...new Set(list)].slice(0, 4);
}

// 4.3: a hidden address for each Stagehand (26 letters and numbers, 130 bits). Crockford's
// alphabet has no I, L, O or U, so normCode leaves it as it is.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newAddress() {
  const b = crypto.randomBytes(26);
  let s = '';
  for (const x of b) s += ALPHABET[x & 31];
  return s;
}
const isAddress = (s) => typeof s === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);

module.exports = { Subscription, normCode, derive, seal, open, relayList, newAddress, isAddress, DEFAULT_RELAY, DEFAULT_RELAYS, MAX_MSG };
