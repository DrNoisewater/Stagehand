'use strict';
/**
 * Friends (3.10): share your takes with friends over the internet, with a code.
 *
 * Your friend code is a secret: 16 letters/digits (80 random bits). Anyone you
 * give it to can listen to the takes you've marked shared, while your Stagehand
 * is open. "New code" stops every old code working.
 *
 * How it connects, with no Stagehand server:
 *   - The two apps talk directly (WebRTC data channel, encrypted with DTLS), set
 *     up in the page (js/friends.js).
 *   - To find each other they swap one offer and one answer through a public
 *     message relay (ntfy, https://ntfy.sh by default; any ntfy server works).
 *     The relay topic and an AES-256-GCM key are both derived from the code, so
 *     the relay only ever sees random-looking topic names and sealed messages.
 *     The DTLS fingerprints travel inside those sealed messages, so nobody
 *     without the code (the relay included) can stand in the middle.
 *   - The host only ever hands out takes you marked shared (checked here).
 *
 * Node built-ins only (Stagehand ships without node_modules).
 */
const crypto = require('crypto');
const zlib = require('zlib');
const { EventEmitter } = require('events');
const { readJson, writeJsonAtomic } = require('../core/files');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const CODE_LEN = 16;
const DEFAULT_RELAY = 'https://ntfy.sh';
const MAX_MSG = 3800; // ntfy keeps messages up to 4096 bytes inline
const MAX_AGE = 2 * 60 * 1000;

/** Tidies a typed code: upper case, no spaces or dashes, look-alike letters mapped. */
function normCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

function validCode(s) {
  const c = normCode(s);
  return c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch));
}

function newCode() {
  const b = crypto.randomBytes(CODE_LEN);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[b[i] & 31];
  return s;
}

/** "ABCD-EFGH-JKMN-PQRS" */
function prettyCode(c) {
  return normCode(c).replace(/(.{4})(?=.)/g, '$1-');
}

/** Relay topic and message key for a code. */
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
 * One ntfy topic subscription (JSON stream). Calls onMessage(text) for each
 * message; resolves `ready` once the relay says the stream is open. Reconnects
 * (from the last message seen) until closed.
 */
class Subscription {
  constructor({ relay, topic, fetchImpl, onMessage, log, retry = true }) {
    Object.assign(this, { relay, topic, fetchImpl, onMessage, log, retry });
    this.closed = false;
    this.since = null;
    this.ctl = null;
    this.ready = new Promise((res, rej) => {
      this._ready = res;
      this._fail = rej;
    });
    this._run();
  }

  async _run() {
    let wait = 1000;
    while (!this.closed) {
      this.ctl = new AbortController();
      try {
        const q = this.since ? `?since=${encodeURIComponent(this.since)}` : '';
        const res = await this.fetchImpl(`${this.relay}/${this.topic}/json${q}`, { signal: this.ctl.signal, headers: { Accept: 'application/x-ndjson' } });
        if (!res.ok || !res.body) throw new Error(`The relay answered ${res.status}`);
        wait = 1000;
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
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
            if (ev.event === 'open') this._ready();
            else if (ev.event === 'message') {
              if (ev.id) this.since = ev.id;
              try {
                this.onMessage(ev.message);
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
        if (this.log) this.log(`Friends relay: ${err.message}; retrying`);
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

class Friends extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.file friends.json
   * @param {Function} o.fetchImpl fetch (streaming bodies)
   * @param {object} [o.safeStorage] Electron safeStorage, to keep codes encrypted on disk
   */
  constructor({ file, fetchImpl, safeStorage, log }) {
    super();
    this.file = file;
    this.fetch = fetchImpl || fetch;
    this.log = log || (() => {});
    this.safe = safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable() ? safeStorage : null;
    this.data = null;
    this.host = null; // subscription to our own topic while sharing
    this.seen = new Map(); // nonce -> time, against replays
    this.offers = []; // times of recent offers, to rate limit
  }

  _hide(code) {
    return this.safe ? { enc: this.safe.encryptString(code).toString('base64') } : { plain: code };
  }

  _show(v) {
    try {
      if (!v) return null;
      return v.enc && this.safe ? this.safe.decryptString(Buffer.from(v.enc, 'base64')) : v.plain || null;
    } catch (_) {
      return null;
    }
  }

  async load() {
    const d = (await readJson(this.file, null)) || {};
    const me = this._show(d.code);
    this.data = {
      code: me && validCode(me) ? normCode(me) : newCode(),
      name: typeof d.name === 'string' ? d.name : '',
      sharing: !!d.sharing,
      relay: typeof d.relay === 'string' && /^https?:\/\//.test(d.relay) ? d.relay.replace(/\/+$/, '') : DEFAULT_RELAY,
      shared: Array.isArray(d.shared) ? d.shared.filter((x) => typeof x === 'string') : [],
      friends: (Array.isArray(d.friends) ? d.friends : [])
        .map((f) => ({ id: String(f.id || ''), name: String(f.name || 'Friend'), code: this._show(f.code), addedAt: Number(f.addedAt) || Date.now() }))
        .filter((f) => f.id && f.code && validCode(f.code)),
    };
    if (!d.code) await this.save();
    if (this.data.sharing) this._listen();
    return this;
  }

  async save() {
    const d = this.data;
    await writeJsonAtomic(this.file, {
      code: this._hide(d.code),
      name: d.name,
      sharing: d.sharing,
      relay: d.relay,
      shared: d.shared,
      friends: d.friends.map((f) => ({ id: f.id, name: f.name, code: this._hide(f.code), addedAt: f.addedAt })),
    });
  }

  /** What the page shows. Friends' codes stay in here. */
  state() {
    const d = this.data;
    return {
      code: prettyCode(d.code),
      name: d.name,
      sharing: d.sharing,
      listening: !!this.host,
      relay: d.relay,
      shared: [...d.shared],
      friends: d.friends.map((f) => ({ id: f.id, name: f.name, addedAt: f.addedAt })),
    };
  }

  _changed() {
    this.emit('change', this.state());
    return this.save().then(() => this.state());
  }

  async setSharing(on) {
    this.data.sharing = !!on;
    if (on) this._listen();
    else this._stopListening();
    return this._changed();
  }

  async setName(name) {
    this.data.name = String(name || '').trim().slice(0, 40);
    return this._changed();
  }

  async setRelay(url) {
    const u = String(url || '').trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\/[^\s/]+/.test(u)) throw Object.assign(new Error('That doesn’t look like a web address'), { code: 'BAD_RELAY' });
    this.data.relay = u || DEFAULT_RELAY;
    if (this.host) {
      this._stopListening();
      this._listen();
    }
    return this._changed();
  }

  /** A fresh code: everyone with the old one loses access. */
  async newCode() {
    this.data.code = newCode();
    if (this.host) {
      this._stopListening();
      this._listen();
    }
    return this._changed();
  }

  async addFriend(code, name) {
    if (!validCode(code)) throw Object.assign(new Error('A friend code has 16 letters and numbers, like ABCD-EFGH-JKMN-PQRS'), { code: 'BAD_CODE', field: 'code' });
    const c = normCode(code);
    if (c === this.data.code) throw Object.assign(new Error('That’s your own code. Ask your friend for theirs.'), { code: 'OWN_CODE', field: 'code' });
    let f = this.data.friends.find((x) => x.code === c);
    if (f) {
      if (name) f.name = String(name).trim().slice(0, 40) || f.name;
    } else {
      f = { id: `f_${crypto.randomBytes(5).toString('hex')}`, name: String(name || '').trim().slice(0, 40) || 'Friend', code: c, addedAt: Date.now() };
      this.data.friends.push(f);
    }
    await this._changed();
    return { id: f.id, name: f.name, addedAt: f.addedAt };
  }

  async renameFriend(id, name) {
    const f = this.data.friends.find((x) => x.id === id);
    if (!f) return null;
    f.name = String(name || '').trim().slice(0, 40) || f.name;
    await this._changed();
    return { id: f.id, name: f.name };
  }

  async removeFriend(id) {
    this.data.friends = this.data.friends.filter((x) => x.id !== id);
    return this._changed();
  }

  async setShared(takeId, on) {
    const s = new Set(this.data.shared);
    if (on) s.add(String(takeId));
    else s.delete(String(takeId));
    this.data.shared = [...s];
    return this._changed();
  }

  isShared(takeId) {
    return this.data.sharing && this.data.shared.includes(takeId);
  }

  /** Drops shared marks for takes that no longer exist. */
  async prune(takeIds) {
    const have = new Set(takeIds);
    const before = this.data.shared.length;
    this.data.shared = this.data.shared.filter((x) => have.has(x));
    if (this.data.shared.length !== before) await this.save();
  }

  // -------------------------------------------------------------- hosting --
  _listen() {
    if (this.host) return;
    const { topic, key } = derive(this.data.code);
    this.host = new Subscription({
      relay: this.data.relay,
      topic,
      fetchImpl: this.fetch,
      log: this.log,
      onMessage: (text) => {
        const m = this._accept(key, topic, text);
        if (!m || m.t !== 'offer' || typeof m.sdp !== 'string' || typeof m.conn !== 'string') return;
        const now = Date.now();
        this.offers = this.offers.filter((t) => now - t < 60000);
        if (this.offers.length >= 20) return; // someone with the code is hammering; ignore for a minute
        this.offers.push(now);
        this.emit('offer', { conn: m.conn.slice(0, 40), sdp: m.sdp });
      },
    });
    this.host._key = key;
    this.host._topic = topic;
    this.host.ready.catch(() => {});
  }

  _stopListening() {
    if (this.host) this.host.close();
    this.host = null;
  }

  /** Checks age and replays; returns the message or null. */
  _accept(key, topic, text) {
    const m = open(key, topic, text);
    if (!m || typeof m.n !== 'string' || !Number.isFinite(m.ts)) return null;
    const now = Date.now();
    if (Math.abs(now - m.ts) > MAX_AGE) return null;
    if (this.seen.has(m.n)) return null;
    this.seen.set(m.n, now);
    if (this.seen.size > 500) for (const [n, t] of this.seen) if (now - t > MAX_AGE * 2) this.seen.delete(n);
    return m;
  }

  async _publish(topic, key, obj) {
    const body = seal(key, topic, { ...obj, ts: Date.now(), n: crypto.randomBytes(9).toString('base64url') });
    if (body.length > MAX_MSG) throw Object.assign(new Error('The connection details were too big to send'), { code: 'TOO_BIG' });
    const res = await this.fetch(`${this.data.relay}/${topic}`, { method: 'POST', body, headers: { 'Content-Type': 'text/plain', Cache: 'no' } });
    if (!res.ok) throw Object.assign(new Error(res.status === 429 ? 'The relay is busy. Try again in a minute.' : `The relay answered ${res.status}`), { code: 'RELAY' });
  }

  /** The page's answer to an offer we passed it. */
  async answer(conn, sdp) {
    if (!this.host) throw Object.assign(new Error('Sharing is off'), { code: 'NOT_SHARING' });
    await this._publish(this.host._topic, this.host._key, { t: 'answer', conn: String(conn), sdp: String(sdp) });
    return true;
  }

  // ------------------------------------------------------------- visiting --
  /**
   * Sends our offer to a friend's Stagehand and waits for its answer.
   * Resolves the answer SDP; rejects with code OFFLINE if nothing comes back.
   */
  async connect(friendId, sdp, { timeout = 20000 } = {}) {
    const f = this.data.friends.find((x) => x.id === friendId);
    if (!f) throw Object.assign(new Error('That friend isn’t in your list any more'), { code: 'NO_FRIEND' });
    const { topic, key } = derive(f.code);
    const conn = crypto.randomBytes(9).toString('base64url');
    let done;
    const got = new Promise((res) => (done = res));
    const sub = new Subscription({
      relay: this.data.relay,
      topic,
      fetchImpl: this.fetch,
      log: this.log,
      retry: false,
      onMessage: (text) => {
        const m = this._accept(key, topic, text);
        if (m && m.t === 'answer' && m.conn === conn && typeof m.sdp === 'string') done(m.sdp);
      },
    });
    let timer;
    try {
      await Promise.race([sub.ready, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('Couldn’t reach the relay. Check your internet connection.'), { code: 'RELAY' })), 10000))]).catch((err) => {
        this.log(`Friends relay: ${err.message}`);
        throw Object.assign(new Error('Couldn’t reach the relay. Check your internet connection.'), { code: 'RELAY' });
      });
      await this._publish(topic, key, { t: 'offer', conn, sdp: String(sdp) });
      return await Promise.race([
        got,
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(Object.assign(new Error(`${f.name}’s Stagehand didn’t answer. It needs to be open, with sharing on.`), { code: 'OFFLINE' })), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      sub.close();
    }
  }

  close() {
    this._stopListening();
  }
}

module.exports = { Friends, normCode, validCode, prettyCode, derive, seal, open, newCode, DEFAULT_RELAY };
