'use strict';
/**
 * Friends (3.10): share your takes with friends over the internet, with a code.
 *
 * Your friend code is a word or phrase (4.1.3; it was 16 random letters before,
 * which still work). Anyone you give it to can watch the videos you've marked
 * shared, while your Stagehand is open. Changing it stops the old one working.
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

const DEFAULT_RELAY = 'https://ntfy.sh';
// Where Stagehands meet: every one is tried at once, so one being down or busy doesn't matter.
const DEFAULT_RELAYS = [DEFAULT_RELAY, 'https://ntfy.envs.net'];
const MAX_MSG = 3800;
const PROTOCOL = 1; // in every message, so a later Stagehand can tell an older one apart // ntfy keeps messages up to 4096 bytes inline
const MAX_TEXT = 500; // characters in a message
const MAX_CHATS = 300; // messages kept, all friends together
const MAX_AGE = 2 * 60; // seconds, by the relay's clock (never the PCs': theirs can be off)

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

const MIN_CODE = 6; // letters and numbers
const MAX_CODE = 60;
/** 4.1.3: a code is any word or phrase with at least 6 letters or numbers (the old
 *  16-character codes still work: they're phrases too). */
function validCode(s) {
  const c = normCode(s);
  return c.length >= MIN_CODE && c.length <= MAX_CODE;
}
/** Why a typed code won't do, in plain words (null if it's fine). */
function codeProblem(s) {
  const c = normCode(s);
  if (c.length < MIN_CODE) return `A code needs at least ${MIN_CODE} letters or numbers, like happy-tiger.`;
  if (c.length > MAX_CODE) return 'That code is too long. Keep it to a few words.';
  return null;
}

// 4.1.6: two plain words, no numbers ("happy-tiger"): easy to say and to type, nothing
// to mix up (a swapped digit in "dominos2496" was what stopped two friends connecting).
// About 3,000 of them; or choose your own word or phrase.
const ADJ = ['amber', 'blue', 'bold', 'brave', 'bright', 'calm', 'cosmic', 'crimson', 'electric', 'fuzzy', 'gentle', 'golden', 'happy', 'iron', 'jolly', 'loud', 'lucky', 'lunar', 'mellow', 'mighty', 'neon', 'proud', 'quick', 'quiet', 'rapid', 'royal', 'rusty', 'silver', 'smooth', 'sonic', 'sunny', 'swift', 'velvet', 'warm', 'wild', 'witty', 'cool', 'funky', 'shiny', 'misty', 'stormy', 'wise', 'groovy', 'cosy', 'lively', 'snowy', 'tiny', 'giant', 'polar', 'purple', 'green', 'red', 'pink', 'easy'];
const NOUN = ['amp', 'banjo', 'bass', 'bear', 'chord', 'cobra', 'comet', 'drum', 'eagle', 'echo', 'falcon', 'fox', 'fret', 'groove', 'guitar', 'harp', 'hawk', 'lion', 'melody', 'moose', 'moon', 'otter', 'owl', 'panda', 'piano', 'pick', 'puma', 'raven', 'rhythm', 'riff', 'river', 'robin', 'rocket', 'shark', 'solo', 'star', 'storm', 'string', 'tempo', 'tiger', 'tuba', 'tune', 'whale', 'wolf', 'zebra', 'koala', 'llama', 'mango', 'cactus', 'canyon', 'island', 'meadow', 'galaxy', 'volcano'];
function newCode() {
  const b = crypto.randomBytes(2);
  return `${ADJ[b[0] % ADJ.length]}-${NOUN[b[1] % NOUN.length]}`;
}

/** How a code is shown: an old 16-character code in groups of four, a phrase as typed. */
function prettyCode(c) {
  const t = String(c || '').trim().replace(/\s+/g, ' ');
  if (/^[0-9A-Z]{16}$/.test(t)) return t.replace(/(.{4})(?=.)/g, '$1-');
  return t;
}
const sameCode = (a, b) => normCode(a) === normCode(b);
const chatOut = (c) => ({ id: c.id, dir: c.dir, name: c.name || '', text: c.text, at: c.at, state: c.state || null, error: c.error || null });

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
        if (this.log) this.log(`Friends relay ${this.relay}: ${(err && err.message) || err}; retrying`);
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

class Friends extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.file friends.json
   * @param {Function} o.fetchImpl fetch (streaming bodies)
   * @param {object} [o.safeStorage] Electron safeStorage, to keep codes encrypted on disk
   */
  constructor({ file, fetchImpl, safeStorage, log, fallbackName = '' }) {
    super();
    this.fallbackName = String(fallbackName || '').slice(0, 40); // 4.1.5: your Windows name until you set one
    this.file = file;
    this.fetch = fetchImpl || fetch;
    this.log = log || (() => {});
    this.safe = safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable() ? safeStorage : null;
    this.data = null;
    this.host = null; // subscription to our own topic (always on since 4.1.3: messages)
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
      code: me && validCode(me) ? me : newCode(),
      name: typeof d.name === 'string' ? d.name : '',
      sharing: !!d.sharing,
      relays: relayList(d.relays).length ? relayList(d.relays) : relayList(d.relay).length && d.relay !== DEFAULT_RELAY ? relayList(d.relay) : [...DEFAULT_RELAYS],
      shared: Array.isArray(d.shared) ? d.shared.filter((x) => typeof x === 'string') : [],
      // 4.1.3: messages, newest last: { id, with (their code, tidied), name, dir 'in'|'out', text, at, state }
      chats: (Array.isArray(d.chats) ? d.chats : []).filter((c) => c && typeof c.id === 'string' && typeof c.text === 'string').slice(-MAX_CHATS),
      friends: (Array.isArray(d.friends) ? d.friends : [])
        .map((f) => ({ id: String(f.id || ''), name: String(f.name || 'Friend'), code: this._show(f.code), addedAt: Number(f.addedAt) || Date.now() }))
        .filter((f) => f.id && f.code && validCode(f.code)),
    };
    if (!d.code) await this.save();
    // 4.1.3: always listening (messages come any time); videos only while sharing is on
    this._listen();
    return this;
  }

  async save() {
    const d = this.data;
    await writeJsonAtomic(this.file, {
      code: this._hide(d.code),
      name: d.name,
      sharing: d.sharing,
      relays: d.relays,
      shared: d.shared,
      friends: d.friends.map((f) => ({ id: f.id, name: f.name, code: this._hide(f.code), addedAt: f.addedAt })),
      chats: d.chats.slice(-MAX_CHATS),
    });
  }

  /** What the page shows. 4.1.3: friends' codes too, so you can check you typed theirs right. */
  state() {
    const d = this.data;
    return {
      code: prettyCode(d.code),
      name: d.name,
      shownName: this.shownName(),
      sharing: d.sharing,
      listening: !!(this.host && this.host.subs.some((x) => x.isReady)),
      relay: d.relays.join(', '),
      relays: [...d.relays],
      shared: [...d.shared],
      friends: d.friends.map((f) => ({ id: f.id, name: f.name, code: prettyCode(f.code), addedAt: f.addedAt, messages: d.chats.filter((c) => c.with === normCode(f.code)).map(chatOut) })),
      // messages from people not in your list (they have your code): add them back with one click
      strangers: [...new Set(d.chats.filter((c) => c.dir === 'in' && !d.friends.some((f) => normCode(f.code) === c.with)).map((c) => c.with))].map((w) => {
        const last = d.chats.filter((c) => c.with === w && c.dir === 'in').pop();
        return { key: w, name: last.name || 'Someone', code: last.reply || w, messages: d.chats.filter((c) => c.with === w).map(chatOut) };
      }),
    };
  }

  /** The name friends see: the one you set, else your Windows user name (not "Someone"). */
  shownName() {
    return this.data.name || this.fallbackName || '';
  }

  _changed() {
    this.emit('change', this.state());
    return this.save().then(() => this.state());
  }

  async setSharing(on) {
    this.data.sharing = !!on; // still listening for messages either way (4.1.3)
    return this._changed();
  }

  async setName(name) {
    this.data.name = String(name || '').trim().slice(0, 40);
    return this._changed();
  }

  /** One address, or several separated by commas; empty puts the standard ones back. */
  async setRelay(url) {
    const raw = String(url || '').trim();
    const list = relayList(raw);
    if (raw && !list.length) throw Object.assign(new Error('That doesn’t look like a web address'), { code: 'BAD_RELAY' });
    this.data.relays = list.length ? list : [...DEFAULT_RELAYS];
    this._stopListening();
    this._listen();
    return this._changed();
  }

  /** A fresh code: everyone with the old one loses access. */
  async newCode() {
    // a made-up code is for cutting people off: friends are NOT told it
    return this.setCode(newCode(), { tell: false });
  }

  /** 4.1.3: your own word or phrase. Everyone with the old one loses access. */
  async setCode(text, { tell = true } = {}) {
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    const bad = codeProblem(t);
    if (bad) throw Object.assign(new Error(bad), { code: 'BAD_CODE', field: 'code' });
    if (this.data.friends.some((f) => sameCode(f.code, t))) throw Object.assign(new Error('That’s one of your friends’ codes. Pick your own.'), { code: 'FRIEND_CODE', field: 'code' });
    const old = this.data.code;
    if (sameCode(old, t)) {
      this.data.code = t; // only the way it's written changed
      return this._changed();
    }
    this.data.code = t;
    this._stopListening();
    this._listen();
    // 4.1.5: tell the friends in your list, so their copy of your code updates by itself
    // (a changed code used to leave them with "No answer" until you sent them the new one)
    if (tell) for (const f of this.data.friends) this._tellNewCode(f, old, t);
    return this._changed();
  }

  _tellNewCode(f, old, code) {
    const { topic, key } = derive(f.code);
    this._publish(this.data.relays, topic, key, { t: 'moved', old, reply: code, from: this.shownName() }).then(
      () => this.log(`Friends: told ${f.name} the new code`),
      (err) => this.log(`Friends: couldn't tell ${f.name} the new code: ${err.message}`)
    );
  }

  /** A friend changed their code and told us: update our copy (only for someone already in the list). */
  _moved(m) {
    if (typeof m.old !== 'string' || typeof m.reply !== 'string' || !validCode(m.reply)) return;
    const f = this.data.friends.find((x) => sameCode(x.code, m.old));
    if (!f || sameCode(f.code, m.reply)) return;
    f.code = String(m.reply).slice(0, 80);
    this.log(`Friends: ${f.name} changed their code; updated`);
    this.emit('moved', { friendId: f.id, name: f.name, code: prettyCode(f.code) });
    this._changed().catch(() => {});
  }

  _checkFriendCode(code, exceptId = null) {
    const bad = codeProblem(code);
    if (bad) throw Object.assign(new Error(bad), { code: 'BAD_CODE', field: 'code' });
    if (sameCode(code, this.data.code)) throw Object.assign(new Error('That’s your own code. Ask your friend for theirs.'), { code: 'OWN_CODE', field: 'code' });
    const other = this.data.friends.find((x) => x.id !== exceptId && sameCode(x.code, code));
    return other || null;
  }

  async addFriend(code, name) {
    const t = String(code || '').trim().replace(/\s+/g, ' ');
    let f = this._checkFriendCode(t);
    if (f) {
      if (name) f.name = String(name).trim().slice(0, 40) || f.name;
    } else {
      f = { id: `f_${crypto.randomBytes(5).toString('hex')}`, name: String(name || '').trim().slice(0, 40) || 'Friend', code: t, addedAt: Date.now() };
      this.data.friends.push(f);
    }
    await this._changed();
    return { id: f.id, name: f.name, code: prettyCode(f.code), addedAt: f.addedAt };
  }

  /** 4.1.3: fix a friend's code (a typo, or they changed theirs). */
  async setFriendCode(id, code) {
    const f = this.data.friends.find((x) => x.id === id);
    if (!f) throw Object.assign(new Error('That friend isn’t in your list any more'), { code: 'NO_FRIEND' });
    const t = String(code || '').trim().replace(/\s+/g, ' ');
    if (this._checkFriendCode(t, id)) throw Object.assign(new Error('Another friend already has that code.'), { code: 'DUP_CODE', field: 'code' });
    f.code = t;
    await this._changed();
    return { id: f.id, name: f.name, code: prettyCode(f.code), addedAt: f.addedAt };
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
    const host = { topic, key, subs: [], via: new Map() }; // via: conn -> the relay its offer came through
    for (const relay of this.data.relays) {
      let newest = 0;
      const sub = new Subscription({
        relay,
        topic,
        fetchImpl: this.fetch,
        log: this.log,
        since: '12h', // messages sent while Stagehand was closed (the relay keeps them about 12 hours)
        onOpen: (time) => (newest = Math.max(newest, time)),
        onMessage: (text, time) => {
          newest = Math.max(newest, time);
          const m = this._accept(key, topic, text);
          if (!m) return;
          if (m.t === 'msg' || m.t === 'ack') return this._chatIn(m);
          if (m.t === 'moved') return this._moved(m);
          // old offers (from before a reconnect or a restart) are stale: skip them
          if (time && newest - time > MAX_AGE) return;
          if (!this.data.sharing) return; // videos only while sharing is on
          if (m.t !== 'offer' || typeof m.sdp !== 'string' || typeof m.conn !== 'string') return;
          const conn = m.conn.slice(0, 40);
          if (host.via.has(conn)) return; // the same offer through a second relay
          const now = Date.now();
          this.offers = this.offers.filter((t) => now - t < 60000);
          if (this.offers.length >= 20) return; // someone with the code is hammering; ignore for a minute
          this.offers.push(now);
          host.via.set(conn, relay);
          if (host.via.size > 200) host.via.delete(host.via.keys().next().value);
          this.emit('offer', { conn, sdp: m.sdp });
        },
      });
      sub.ready.then(() => this.emit('change', this.state()), () => {});
      host.subs.push(sub);
    }
    this.host = host;
  }

  _stopListening() {
    if (this.host) for (const s of this.host.subs) s.close();
    this.host = null;
  }

  /** Opens a message and drops repeats (each message carries a one-time number). */
  _accept(key, topic, text) {
    const m = open(key, topic, text);
    if (!m || typeof m.n !== 'string') return null;
    if (this.seen.has(m.n)) return null;
    const now = Date.now();
    this.seen.set(m.n, now);
    if (this.seen.size > 1000) for (const [n, t] of this.seen) if (now - t > 600000) this.seen.delete(n);
    return m;
  }

  /** Sends one sealed message through these relays; fine if at least one takes it. */
  async _publish(relays, topic, key, obj) {
    const body = seal(key, topic, { ...obj, v: PROTOCOL, ts: Date.now(), n: crypto.randomBytes(9).toString('base64url') });
    if (body.length > MAX_MSG) throw Object.assign(new Error('The connection details were too big to send'), { code: 'TOO_BIG' });
    const tries = await Promise.allSettled(
      relays.map(async (relay) => {
        const res = await this.fetch(`${relay}/${topic}`, { method: 'POST', body, headers: { 'Content-Type': 'text/plain', Cache: 'no' } });
        if (!res.ok) throw Object.assign(new Error(res.status === 429 ? 'busy' : `answered ${res.status}`), { status: res.status });
      })
    );
    if (tries.some((t) => t.status === 'fulfilled')) return;
    const busy = tries.some((t) => t.reason && t.reason.status === 429);
    for (const [i, t] of tries.entries()) this.log(`Friends relay ${relays[i]}: ${t.reason && t.reason.message}`);
    throw Object.assign(new Error(busy ? 'The meeting point is busy. Try again in a minute.' : 'Couldn’t reach the meeting point. Check your internet connection.'), { code: 'RELAY' });
  }

  /** The page's answer to an offer we passed it. */
  async answer(conn, sdp) {
    const host = this.host;
    if (!host || !this.data.sharing) throw Object.assign(new Error('Sharing is off'), { code: 'NOT_SHARING' });
    const via = host.via.get(String(conn));
    // back through the relay the offer came by (the others as a fallback)
    await this._publish(via ? [via] : this.data.relays, host.topic, host.key, { t: 'answer', conn: String(conn), sdp: String(sdp) }).catch((err) => {
      if (!via) throw err;
      return this._publish(this.data.relays.filter((r) => r !== via), host.topic, host.key, { t: 'answer', conn: String(conn), sdp: String(sdp) });
    });
    return true;
  }

  // ------------------------------------------------------------- messages --
  /**
   * 4.1.3: a short message to a friend, through the meeting points (sealed with their
   * code, like the connection setup), so it works even when a direct connection
   * between the PCs can't be made. It carries your name and your code, so they can
   * answer and their Stagehand can say it arrived. States: sending → sent (a meeting
   * point took it) → delivered (their Stagehand got it), or failed.
   */
  async sendMessage(to, text) {
    const t = String(text || '').trim().slice(0, MAX_TEXT);
    if (!t) throw Object.assign(new Error('Type a message first'), { code: 'EMPTY' });
    const f = this.data.friends.find((x) => x.id === to);
    const code = f ? f.code : (this.data.chats.find((c) => c.with === to && c.reply) || {}).reply;
    if (!code) throw Object.assign(new Error('That friend isn’t in your list any more'), { code: 'NO_FRIEND' });
    const msg = { id: crypto.randomBytes(8).toString('base64url'), with: normCode(code), dir: 'out', text: t, at: Date.now(), state: 'sending' };
    this._addChat(msg);
    await this._changed();
    const { topic, key } = derive(code);
    try {
      await this._publish(this.data.relays, topic, key, { t: 'msg', id: msg.id, from: this.shownName(), reply: this.data.code, text: t });
      if (msg.state === 'sending') msg.state = 'sent';
      this.log(`Friends: message to ${f ? f.name : 'a friend'} reached the meeting point`);
    } catch (err) {
      msg.state = 'failed';
      msg.error = err.message;
      this.log(`Friends: message to ${f ? f.name : 'a friend'} not sent: ${err.message}`);
    }
    await this._changed();
    return chatOut(msg);
  }

  /** A message or a receipt arrived on our topic. */
  _chatIn(m) {
    if (m.t === 'ack') {
      const c = this.data.chats.find((x) => x.id === m.id && x.dir === 'out');
      if (c && c.state !== 'delivered') {
        c.state = 'delivered';
        this._changed().catch(() => {});
      }
      return;
    }
    if (typeof m.id !== 'string' || typeof m.text !== 'string' || typeof m.reply !== 'string' || !validCode(m.reply)) return;
    const reply = m.reply.slice(0, 80);
    // a receipt back, so they see "Delivered" (also when we already had it: their first receipt may have been lost)
    const { topic, key } = derive(reply);
    this._publish(this.data.relays, topic, key, { t: 'ack', id: m.id }).catch(() => {});
    if (this.data.chats.some((x) => x.id === m.id)) return; // already have it (sent again after a restart)
    const f = this.data.friends.find((x) => sameCode(x.code, reply));
    const c = { id: m.id.slice(0, 40), with: normCode(reply), reply, name: String(m.from || '').slice(0, 40) || (f ? f.name : 'Someone'), dir: 'in', text: m.text.slice(0, MAX_TEXT), at: Date.now() };
    this._addChat(c);
    this.log(`Friends: message from ${f ? f.name : c.name}`);
    this.emit('message', { friendId: f ? f.id : null, key: c.with, name: f ? f.name : c.name, text: c.text });
    this._changed().catch(() => {});
  }

  _addChat(c) {
    this.data.chats.push(c);
    if (this.data.chats.length > MAX_CHATS) this.data.chats.splice(0, this.data.chats.length - MAX_CHATS);
  }

  // ------------------------------------------------------------- visiting --
  /**
   * Sends our offer to a friend's Stagehand and waits for its answer.
   * Resolves the answer SDP; rejects with code OFFLINE if nothing comes back.
   */
  async connect(friendId, sdp, { timeout = 20000, onStage = null } = {}) {
    const stage = (x) => onStage && onStage(x);
    const f = this.data.friends.find((x) => x.id === friendId);
    if (!f) throw Object.assign(new Error('That friend isn’t in your list any more'), { code: 'NO_FRIEND' });
    const { topic, key } = derive(f.code);
    const conn = crypto.randomBytes(9).toString('base64url');
    let done;
    const got = new Promise((res) => (done = res));
    stage('relay');
    const subs = this.data.relays.map(
      (relay) =>
        new Subscription({
          relay,
          topic,
          fetchImpl: this.fetch,
          log: this.log,
          retry: false,
          onMessage: (text) => {
            const m = this._accept(key, topic, text);
            if (m && m.t === 'answer' && m.conn === conn && typeof m.sdp === 'string') done(m.sdp);
          },
        })
    );
    let timer;
    try {
      // go as soon as one relay is listening; give the others a moment more
      const first = await Promise.race([
        Promise.any(subs.map((x) => x.ready)).then(() => true, () => false),
        new Promise((res) => setTimeout(() => res(false), 10000)),
      ]);
      if (!first) throw Object.assign(new Error('Couldn’t reach the meeting point. Check your internet connection.'), { code: 'RELAY' });
      await Promise.race([Promise.allSettled(subs.map((x) => x.ready)), new Promise((res) => setTimeout(res, 1500))]);
      const ready = subs.filter((x) => x.isReady).map((x) => x.relay);
      await this._publish(ready, topic, key, { t: 'offer', conn, sdp: String(sdp) });
      stage('asking'); // the meeting point has our call: now it's up to their Stagehand
      return await Promise.race([
        got,
        new Promise((_, rej) => {
          timer = setTimeout(
            () =>
              rej(
                Object.assign(new Error(`No answer from ${f.name}. Either their Stagehand isn’t open with Sharing on, or the code isn’t theirs.`), {
                  code: 'OFFLINE',
                })
              ),
            timeout
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      for (const x of subs) x.close();
    }
  }

  close() {
    this._stopListening();
  }
}

module.exports = { Friends, Subscription, normCode, validCode, codeProblem, sameCode, prettyCode, derive, seal, open, newCode, relayList, DEFAULT_RELAY, DEFAULT_RELAYS };
