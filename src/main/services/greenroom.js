'use strict';
/**
 * Backstage (4.3): everyone with Stagehand, in one place. It replaces
 * Friends and their codes (4.1–4.2).
 *
 *   - There is one shared meeting point (an ntfy topic everybody knows). Each
 *     Stagehand that has picked a name says "here" there, with its name and the
 *     clips it shows, every 10 minutes and whenever that changes, and "bye" when
 *     it closes. A Stagehand that opens reads the last half hour, so the room is
 *     full straight away. Someone not heard from for 25 minutes has gone.
 *   - Each Stagehand has a hidden address (random, never shown). Its own topic,
 *     sealed with a key from that address, carries messages to it and requests
 *     to watch its clips. Watching is the same direct PC-to-PC link as before
 *     (js/friendlink.js), so clips can only be watched while their owner's
 *     Stagehand is open. Only videos marked "Show backstage" are handed out.
 *   - The room is public by design: anyone can read it. So nothing private goes
 *     there: a name, and each shown clip's title, song, part and tone name.
 *
 * Node built-ins only (Stagehand ships without node_modules).
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { readJson, writeJsonAtomic } = require('../core/files');
const { Subscription, normCode, derive, seal, open, relayList, newAddress, isAddress, DEFAULT_RELAYS, MAX_MSG } = require('./relay');

const PROTOCOL = 2; // in every message, so a later Stagehand can tell an older one apart
const ROOM = 'STAGEHAND GREEN ROOM 1'; // the shared meeting point's name (its topic and key come from it)
const BEAT = 10 * 60 * 1000; // "still here" (ntfy.sh allows about 250 messages a day from one PC)
const GONE = 25 * 60; // seconds of quiet (by the meeting point's clock) before someone has left
const SINCE = '30m'; // what a Stagehand reads of the room when it opens
const MAX_TEXT = 500; // characters in a message
const MAX_CHATS = 300; // messages kept
const MAX_AGE = 2 * 60; // seconds: older requests to watch are stale (by the meeting point's clock)
const MAX_CLIPS = 12; // clips in one "here" (the message has to stay under 4 KB)
const MAX_NAME = 40;
const PARTS = ['lead', 'rhythm', 'bass', 'jam'];

const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const num = (v, lo, hi) => {
  const x = Number(v);
  return Number.isFinite(x) && x >= lo && x <= hi ? x : null;
};
const clipId = (v) => typeof v === 'string' && /^k_[0-9a-z]{4,24}$/.test(v);
const sameName = (a, b) => str(a, MAX_NAME).toLowerCase() === str(b, MAX_NAME).toLowerCase();

/** What the room shows of one of your videos: the details recorded with it (Takes.addVideo `about`). */
function clipSummary(t) {
  const a = (t && t.about) || {};
  const song = a.song || {};
  return cleanClip({
    id: t.id,
    title: t.name,
    song: song.title,
    artist: song.artist,
    official: !!song.official,
    part: a.part,
    inst: a.instrument,
    tuning: a.tuning,
    speed: a.speed,
    tone: a.tone && a.tone.name,
    sec: t.seconds,
    size: t.bytes,
    at: t.at,
  });
}

/** A clip as it came from someone else: only the fields we know, each checked and cut to size. */
function cleanClip(c) {
  if (!c || typeof c !== 'object' || !clipId(c.id)) return null;
  return {
    id: c.id,
    title: str(c.title, 120) || 'Clip',
    song: str(c.song, 120),
    artist: str(c.artist, 120),
    official: !!c.official,
    part: PARTS.includes(c.part) ? c.part : null,
    inst: c.inst === 'bass' ? 'bass' : c.inst === 'guitar' ? 'guitar' : null,
    tuning: str(c.tuning, 40),
    speed: num(c.speed, 0.1, 2),
    tone: str(c.tone, 80),
    sec: num(c.sec, 0, 36000) || 0,
    size: num(c.size, 0, 8 * 1024 ** 3) || 0,
    at: num(c.at, 0, 1e14) || 0,
  };
}

const chatOut = (c) => ({ id: c.id, dir: c.dir, name: c.name || '', text: c.text, at: c.at, state: c.state || null, error: c.error || null, about: c.about || null });
const cleanAbout = (a) => (a && typeof a === 'object' && clipId(a.id) ? { id: a.id, title: str(a.title, 120) || 'a clip' } : null);

/** Messages from before Backstage (friends.json, 4.1–4.2), grouped by person, to read. */
function oldConversations(old, show) {
  const friends = (Array.isArray(old.friends) ? old.friends : []).map((f) => ({ name: str(f.name, MAX_NAME) || 'Friend', code: show(f.code) })).filter((f) => f.code);
  const chats = (Array.isArray(old.chats) ? old.chats : []).filter((c) => c && typeof c.text === 'string' && typeof c.with === 'string');
  const by = new Map();
  for (const c of chats) {
    if (!by.has(c.with)) by.set(c.with, []);
    by.get(c.with).push({ id: String(c.id || ''), dir: c.dir === 'in' ? 'in' : 'out', name: str(c.name, MAX_NAME), text: c.text.slice(0, MAX_TEXT), at: Number(c.at) || 0, state: c.state === 'delivered' ? 'delivered' : null });
  }
  return [...by.entries()].map(([w, messages], i) => {
    const f = friends.find((x) => normCode(x.code) === w);
    const last = messages.filter((m) => m.dir === 'in' && m.name).pop();
    return { key: `old${i}`, name: (f && f.name) || (last && last.name) || 'Someone', messages };
  });
}

class GreenRoom extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.file greenroom.json
   * @param {string} [o.oldFile] friends.json (4.1–4.2): its messages are kept to read
   * @param {Function} o.fetchImpl fetch (streaming bodies)
   * @param {Function} o.listClips async () => your videos marked to show (takes, with `about`)
   * @param {object} [o.safeStorage] Electron safeStorage, only to read old friends' codes
   */
  constructor({ file, oldFile = null, fetchImpl, safeStorage, log, listClips, room = ROOM, beat = BEAT, gone = GONE, relays = null }) {
    super();
    Object.assign(this, { file, oldFile, room, beat, gone });
    this.relaysWanted = relayList(relays); // (tests: a stand-in meeting point)
    this.fetch = fetchImpl || fetch;
    this.log = log || (() => {});
    this.listClips = listClips || (async () => []);
    this.safe = safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable() ? safeStorage : null;
    this.data = null;
    this.host = null; // our own topic: messages and requests to watch
    this.lobby = null; // the shared room topic
    this.people = new Map(); // addr -> { addr, name, clips, seen (meeting point seconds) }
    this.seen = new Map(); // one-time numbers already handled
    this.offers = [];
    this.rate = new Map(); // addr -> times of their recent messages
    this.clock = null; // { t: the meeting point's time in seconds, at: our Date.now() then }
    this.timers = [];
    this.closed = false;
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
    const d = await readJson(this.file, null);
    let old = { conversations: [], name: '', relays: null };
    if (!d && this.oldFile) {
      const o = await readJson(this.oldFile, null);
      if (o) old = { conversations: oldConversations(o, (v) => this._show(v)), name: str(o.name, MAX_NAME), relays: relayList(o.relays) };
    }
    const x = d || {};
    this.data = {
      addr: isAddress(x.addr) ? x.addr : newAddress(),
      name: str(x.name, MAX_NAME),
      suggest: str(x.suggest, MAX_NAME) || old.name, // a name to offer when you first come in
      relays: this.relaysWanted.length ? this.relaysWanted : relayList(x.relays).length ? relayList(x.relays) : old.relays && old.relays.length ? old.relays : [...DEFAULT_RELAYS],
      shared: Array.isArray(x.shared) ? x.shared.filter(clipId) : [],
      hidden: (Array.isArray(x.hidden) ? x.hidden : []).filter((h) => h && isAddress(h.addr)).map((h) => ({ addr: h.addr, name: str(h.name, MAX_NAME) || 'Someone' })),
      chats: (Array.isArray(x.chats) ? x.chats : []).filter((c) => c && typeof c.id === 'string' && typeof c.text === 'string' && isAddress(c.with)).slice(-MAX_CHATS),
      old: Array.isArray(x.old) ? x.old : old.conversations,
    };
    if (!d) await this.save();
    this._listen();
    this._enter();
    this.timers.push(setInterval(() => this._announce('beat'), this.beat));
    // someone who went quiet has left: tell the page once a minute if anyone did
    this.timers.push(setInterval(() => this._expire(), 60000));
    for (const t of this.timers) if (t.unref) t.unref();
    return this;
  }

  async save() {
    const d = this.data;
    await writeJsonAtomic(this.file, { v: 1, addr: d.addr, name: d.name, suggest: d.suggest, relays: d.relays, shared: d.shared, hidden: d.hidden, chats: d.chats.slice(-MAX_CHATS), old: d.old });
  }

  get joined() {
    return !!this.data.name;
  }

  /** The meeting point's time now, in seconds (never trust the PC's clock: it can be off). */
  _now() {
    return this.clock ? this.clock.t + (Date.now() - this.clock.at) / 1000 : Date.now() / 1000;
  }

  /** The meeting point says its time when a stream opens; messages read back are older, so they only ever move it on. */
  _tick(t, opened = false) {
    if (t && (opened || (this.clock && t > this._now()))) this.clock = { t, at: Date.now() };
  }

  _here() {
    const now = this._now();
    const hidden = new Set(this.data.hidden.map((h) => h.addr));
    return [...this.people.values()].filter((p) => now - p.seen < this.gone && !hidden.has(p.addr));
  }

  _expire() {
    const now = this._now();
    let gone = false;
    for (const [a, p] of this.people) if (now - p.seen >= this.gone) (this.people.delete(a), (gone = true));
    if (gone) this.emit('change', this.state());
  }

  /** The name we know someone by: what they call themselves in the room, else in their last message. */
  nameOf(addr) {
    const p = this.people.get(addr);
    if (p) return p.name;
    const c = this.data.chats.filter((x) => x.with === addr && x.dir === 'in' && x.name).pop();
    const h = this.data.hidden.find((x) => x.addr === addr);
    return (c && c.name) || (h && h.name) || 'Someone';
  }

  /** What the page shows. */
  state() {
    const d = this.data;
    const by = new Map();
    for (const c of d.chats) {
      if (!by.has(c.with)) by.set(c.with, []);
      by.get(c.with).push(chatOut(c));
    }
    const hidden = new Set(d.hidden.map((h) => h.addr));
    return {
      joined: this.joined,
      name: d.name,
      suggest: d.suggest,
      me: d.addr, // so the page can tell its own clips apart; it is in every "here" anyway
      listening: !!(this.host && this.host.subs.some((s) => s.isReady)),
      inRoom: !!(this.lobby && this.lobby.subs.some((s) => s.isReady)),
      relays: [...d.relays],
      shared: [...d.shared],
      hidden: d.hidden.map((h) => ({ ...h })),
      people: this._here()
        .map((p) => ({ addr: p.addr, name: p.name, clips: p.clips.map((c) => ({ ...c })), seen: p.seen }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      chats: [...by.entries()]
        .filter(([a]) => !hidden.has(a))
        .map(([addr, messages]) => ({ addr, name: this.nameOf(addr), here: this.people.has(addr), messages }))
        .sort((a, b) => b.messages[b.messages.length - 1].at - a.messages[a.messages.length - 1].at),
      old: d.old,
    };
  }

  _changed() {
    this.emit('change', this.state());
    return this.save().then(() => this.state());
  }

  // ------------------------------------------------------------- you --
  /** Your name in the room. Picking one is how you come in; it must not be someone's who's here now. */
  async setName(name) {
    const n = str(name, MAX_NAME);
    if (n.length < 2) throw Object.assign(new Error('Pick a name with at least 2 letters.'), { code: 'BAD_NAME', field: 'name' });
    if (this._here().some((p) => sameName(p.name, n))) throw Object.assign(new Error(`Someone backstage is called ${n} already. Pick another name.`), { code: 'NAME_TAKEN', field: 'name' });
    const first = !this.joined;
    this.data.name = n;
    this.data.suggest = n;
    this._announce(first ? 'now' : 'soon');
    return this._changed();
  }

  /** Step out: nobody sees you or your clips, and you can't message, until you pick a name again. */
  async leave() {
    if (!this.joined) return this.state();
    await this._bye();
    this.data.name = '';
    return this._changed();
  }

  async setShared(takeId, on) {
    if (!clipId(takeId)) throw Object.assign(new Error('That isn’t one of your clips'), { code: 'NOT_CLIP' });
    if (on && !this.joined) throw Object.assign(new Error('Pick your name for Backstage first.'), { code: 'NO_NAME' });
    const s = new Set(this.data.shared);
    if (on) s.add(takeId);
    else s.delete(takeId);
    this.data.shared = [...s];
    this._announce('soon');
    return this._changed();
  }

  isShared(takeId) {
    return this.joined && this.data.shared.includes(takeId);
  }

  /** Drops marks for clips that no longer exist. */
  async prune(takeIds) {
    const have = new Set(takeIds);
    const before = this.data.shared.length;
    this.data.shared = this.data.shared.filter((x) => have.has(x));
    if (this.data.shared.length !== before) {
      this._announce('soon');
      await this.save();
    }
  }

  /** Hide someone on this PC: their clips and messages stop showing (and their messages aren't taken). */
  async hide(addr, on = true) {
    if (!isAddress(addr)) return this.state();
    this.data.hidden = this.data.hidden.filter((h) => h.addr !== addr);
    if (on) this.data.hidden.push({ addr, name: this.nameOf(addr) });
    return this._changed();
  }

  // ------------------------------------------------------- the room --
  _enter() {
    const { topic, key } = derive(this.room);
    const lobby = { topic, key, subs: [] };
    let said = false;
    for (const relay of this.data.relays) {
      const sub = new Subscription({
        relay,
        topic,
        fetchImpl: this.fetch,
        log: this.log,
        since: SINCE,
        onOpen: (t) => this._tick(t, true),
        onMessage: (text, t) => {
          this._tick(t);
          const m = this._accept(key, topic, text);
          if (m) this._roomIn(m, t || this._now());
        },
      });
      sub.ready.then(
        () => {
          this.emit('change', this.state());
          if (!said) (said = true), this._announce('now');
        },
        () => {}
      );
      lobby.subs.push(sub);
    }
    this.lobby = lobby;
  }

  _limited(addr, n = 12) {
    const now = Date.now();
    const list = (this.rate.get(addr) || []).filter((t) => now - t < 60000);
    list.push(now);
    this.rate.set(addr, list);
    if (this.rate.size > 2000) this.rate.delete(this.rate.keys().next().value);
    return list.length > n;
  }

  _roomIn(m, t) {
    if (!isAddress(m.addr) || m.addr === this.data.addr) return;
    if (this._limited(`room:${m.addr}`, 30)) return;
    const was = this.people.get(m.addr);
    if (m.t === 'here') {
      const name = str(m.name, MAX_NAME);
      if (!name) return;
      if (was && was.seen > t) return; // an older "here" read back after a newer one
      const clips = (Array.isArray(m.clips) ? m.clips.slice(0, MAX_CLIPS) : []).map(cleanClip).filter(Boolean);
      this.people.set(m.addr, { addr: m.addr, name, clips, seen: t });
      if (this.people.size > 500) this.people.delete(this.people.keys().next().value);
    } else if (m.t === 'bye') {
      if (!was || was.seen > t) return;
      this.people.delete(m.addr);
    } else return;
    this._soon();
  }

  /** Tell the page, at most every 300 ms (a newly opened Stagehand reads half an hour at once). */
  _soon() {
    if (this._soonT) return;
    this._soonT = setTimeout(() => {
      this._soonT = null;
      this.emit('change', this.state());
    }, 300);
  }

  /**
   * Says "here" in the room, with your name and the clips you show. 'now', 'soon' (after
   * a change: waits a moment, in case more follow) or 'beat' (the 10-minute "still here").
   */
  _announce(when) {
    if (!this.joined || this.closed) return;
    if (when === 'soon') {
      clearTimeout(this._annT);
      this._annT = setTimeout(() => this._announce('now'), 1500);
      return;
    }
    clearTimeout(this._annT);
    this._annP = (this._annP || Promise.resolve()).then(() => this._sayHere()).catch((err) => this.log(`Backstage: couldn’t say here: ${err.message}`));
    return this._annP;
  }

  async _sayHere() {
    if (!this.joined || !this.lobby) return;
    const ready = this.lobby.subs.filter((s) => s.isReady).map((s) => s.relay);
    if (!ready.length) return; // said when the meeting point opens
    const mine = new Set(this.data.shared);
    const takes = (await this.listClips()).filter((t) => mine.has(t.id)).sort((a, b) => b.at - a.at);
    let clips = takes.map(clipSummary).filter(Boolean).slice(0, MAX_CLIPS);
    // keep it under the meeting point's size limit: fewer clips if need be (newest kept)
    for (;;) {
      const obj = { t: 'here', addr: this.data.addr, name: this.data.name, clips };
      const size = seal(this.lobby.key, this.lobby.topic, { ...obj, v: PROTOCOL, ts: 0, n: 'x'.repeat(12) }).length;
      if (size <= MAX_MSG || !clips.length) return this._publish(ready, this.lobby.topic, this.lobby.key, obj);
      clips = clips.slice(0, -1);
    }
  }

  async _bye() {
    if (!this.lobby || !this.joined) return;
    const ready = this.lobby.subs.filter((s) => s.isReady).map((s) => s.relay);
    if (!ready.length) return;
    await Promise.race([this._publish(ready, this.lobby.topic, this.lobby.key, { t: 'bye', addr: this.data.addr }).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  }

  // ------------------------------------------------- your own topic --
  _listen() {
    if (this.host) return;
    const { topic, key } = derive(this.data.addr);
    const host = { topic, key, subs: [], via: new Map() };
    for (const relay of this.data.relays) {
      let newest = 0;
      const sub = new Subscription({
        relay,
        topic,
        fetchImpl: this.fetch,
        log: this.log,
        since: '12h', // messages sent while Stagehand was closed (the meeting point keeps them about 12 hours)
        onOpen: (t) => ((newest = Math.max(newest, t)), this._tick(t, true)),
        onMessage: (text, t) => {
          newest = Math.max(newest, t);
          this._tick(t);
          const m = this._accept(key, topic, text);
          if (!m) return;
          if (m.t === 'msg' || m.t === 'ack') return this._chatIn(m);
          if (m.t !== 'offer' || typeof m.sdp !== 'string' || typeof m.conn !== 'string') return;
          if (t && newest - t > MAX_AGE) return; // from before a reconnect or a restart
          if (!this.joined || !this.data.shared.length) return; // nothing to watch
          const conn = m.conn.slice(0, 40);
          if (host.via.has(conn)) return; // the same request through a second meeting point
          const now = Date.now();
          this.offers = this.offers.filter((x) => now - x < 60000);
          if (this.offers.length >= 30) return; // too many at once: ignore for a minute
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

  /** Opens a message and drops repeats (each message carries a one-time number). */
  _accept(key, topic, text) {
    const m = open(key, topic, text);
    if (!m || typeof m.n !== 'string') return null;
    if (this.seen.has(m.n)) return null;
    const now = Date.now();
    this.seen.set(m.n, now);
    if (this.seen.size > 3000) for (const [n, t] of this.seen) if (now - t > 3600000) this.seen.delete(n);
    return m;
  }

  /** Sends one sealed message through these meeting points; fine if at least one takes it. */
  async _publish(relays, topic, key, obj) {
    const body = seal(key, topic, { ...obj, v: PROTOCOL, ts: Date.now(), n: crypto.randomBytes(9).toString('base64url') });
    if (body.length > MAX_MSG) throw Object.assign(new Error('That was too big to send'), { code: 'TOO_BIG' });
    const tries = await Promise.allSettled(
      relays.map(async (relay) => {
        const res = await this.fetch(`${relay}/${topic}`, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });
        if (!res.ok) throw Object.assign(new Error(res.status === 429 ? 'busy' : `answered ${res.status}`), { status: res.status });
      })
    );
    if (tries.some((t) => t.status === 'fulfilled')) return;
    const busy = tries.some((t) => t.reason && t.reason.status === 429);
    for (const [i, t] of tries.entries()) this.log(`Meeting point ${relays[i]}: ${t.reason && t.reason.message}`);
    throw Object.assign(new Error(busy ? 'The meeting point is busy. Try again in a minute.' : 'Couldn’t reach the meeting point. Check your internet connection.'), { code: 'RELAY' });
  }

  /** The page's answer to a request to watch that we passed it. */
  async answer(conn, sdp) {
    const host = this.host;
    if (!host || !this.joined) throw Object.assign(new Error('You’re not backstage'), { code: 'NOT_SHARING' });
    const via = host.via.get(String(conn));
    const say = (relays) => this._publish(relays, host.topic, host.key, { t: 'answer', conn: String(conn), sdp: String(sdp) });
    await say(via ? [via] : this.data.relays).catch((err) => {
      if (!via) throw err;
      return say(this.data.relays.filter((r) => r !== via));
    });
    return true;
  }

  // ---------------------------------------------------------- messages --
  /**
   * A short message to someone in the room (or someone who wrote to you), through the
   * meeting points, sealed with their address. `about`: the clip it's about, if any.
   * States: sending → sent (a meeting point took it) → delivered (their Stagehand got it), or failed.
   */
  async sendMessage(to, text, about = null) {
    if (!this.joined) throw Object.assign(new Error('Pick your name for Backstage first.'), { code: 'NO_NAME' });
    if (!isAddress(to)) throw Object.assign(new Error('That person isn’t backstage any more'), { code: 'NO_PERSON' });
    const t = String(text || '').trim().slice(0, MAX_TEXT);
    if (!t) throw Object.assign(new Error('Type a message first'), { code: 'EMPTY' });
    const ab = cleanAbout(about);
    const msg = { id: crypto.randomBytes(8).toString('base64url'), with: to, name: this.nameOf(to), dir: 'out', text: t, at: Date.now(), state: 'sending', about: ab };
    this._addChat(msg);
    await this._changed();
    const { topic, key } = derive(to);
    try {
      await this._publish(this.data.relays, topic, key, { t: 'msg', id: msg.id, from: this.data.name, reply: this.data.addr, text: t, about: ab });
      if (msg.state === 'sending') msg.state = 'sent';
    } catch (err) {
      msg.state = 'failed';
      msg.error = err.message;
      this.log(`Backstage: message not sent: ${err.message}`);
    }
    await this._changed();
    return chatOut(msg);
  }

  _chatIn(m) {
    if (m.t === 'ack') {
      const c = this.data.chats.find((x) => x.id === m.id && x.dir === 'out');
      if (c && c.state !== 'delivered') {
        c.state = 'delivered';
        this._changed().catch(() => {});
      }
      return;
    }
    if (typeof m.id !== 'string' || typeof m.text !== 'string' || !isAddress(m.reply) || m.reply === this.data.addr) return;
    if (this.data.hidden.some((h) => h.addr === m.reply)) return; // hidden on this PC: not taken, no receipt
    if (this._limited(`msg:${m.reply}`, 20)) return;
    const { topic, key } = derive(m.reply);
    this._publish(this.data.relays, topic, key, { t: 'ack', id: m.id }).catch(() => {});
    if (this.data.chats.some((x) => x.id === m.id)) return; // already have it
    const name = str(m.from, MAX_NAME) || this.nameOf(m.reply);
    const c = { id: m.id.slice(0, 40), with: m.reply, name, dir: 'in', text: m.text.slice(0, MAX_TEXT), at: Date.now(), about: cleanAbout(m.about) };
    this._addChat(c);
    this.emit('message', { addr: m.reply, name, text: c.text });
    this._changed().catch(() => {});
  }

  _addChat(c) {
    this.data.chats.push(c);
    if (this.data.chats.length > MAX_CHATS) this.data.chats.splice(0, this.data.chats.length - MAX_CHATS);
  }

  // ------------------------------------------------------------ watching --
  /**
   * Sends our request to watch to someone's Stagehand and waits for its answer.
   * Resolves the answer SDP; rejects with code OFFLINE if nothing comes back.
   */
  async connect(addr, sdp, { timeout = 20000, onStage = null } = {}) {
    const stage = (x) => onStage && onStage(x);
    if (!isAddress(addr)) throw Object.assign(new Error('That person isn’t backstage any more'), { code: 'NO_PERSON' });
    const who = this.nameOf(addr);
    const { topic, key } = derive(addr);
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
      const first = await Promise.race([Promise.any(subs.map((x) => x.ready)).then(() => true, () => false), new Promise((res) => setTimeout(() => res(false), 10000))]);
      if (!first) throw Object.assign(new Error('Couldn’t reach the meeting point. Check your internet connection.'), { code: 'RELAY' });
      await Promise.race([Promise.allSettled(subs.map((x) => x.ready)), new Promise((res) => setTimeout(res, 1500))]);
      const ready = subs.filter((x) => x.isReady).map((x) => x.relay);
      await this._publish(ready, topic, key, { t: 'offer', conn, sdp: String(sdp) });
      stage('asking');
      return await Promise.race([
        got,
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(Object.assign(new Error(`No answer from ${who}. Their Stagehand has probably closed: clips can only be watched while it’s open.`), { code: 'OFFLINE' })), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      for (const x of subs) x.close();
    }
  }

  /** Says "bye" (waits at most 1.5 s), then stops listening. */
  async close() {
    if (this.closed) return;
    await this._bye().catch(() => {});
    this.closed = true;
    clearTimeout(this._annT);
    clearTimeout(this._soonT);
    for (const t of this.timers) clearInterval(t);
    for (const s of [...((this.host && this.host.subs) || []), ...((this.lobby && this.lobby.subs) || [])]) s.close();
    this.host = this.lobby = null;
  }
}

module.exports = { GreenRoom, clipSummary, cleanClip, oldConversations, ROOM, PROTOCOL };
