'use strict';
/**
 * 4.11: reads Wwise sound banks (.bnk) well enough to say which audio a song's bank plays.
 *
 * A Rocksmith song bank holds: BKHD (version, bank id), DIDX + DATA (media kept inside the
 * bank: for a streamed song only a short lead-in), HIRC (the objects: a Sound that names its
 * media by id, an Action that plays the Sound, an Event that runs the Action) and STID.
 * The Event's id is the FNV-1 hash of its name in lower case ("Play_Kryptonite"), which is
 * how the game finds a song's audio from its manifest, and how we do.
 */

/** Wwise's id for a name (events, banks): 32-bit FNV-1 of the lower-cased name. */
function fnv1(name) {
  let h = 2166136261;
  for (const c of Buffer.from(String(name).toLowerCase(), 'utf8')) h = (Math.imul(h, 16777619) ^ c) >>> 0;
  return h >>> 0;
}

/** { version, bankId, media: [{ id, offset, size }], objects: [{ type, id, body }] } or null when it isn't a bank. */
function parseBank(buf) {
  if (!buf || buf.length < 16 || buf.toString('latin1', 0, 4) !== 'BKHD') return null;
  const out = { version: 0, bankId: 0, media: [], objects: [] };
  let didx = null;
  let data = -1;
  for (let off = 0; off + 8 <= buf.length; ) {
    const tag = buf.toString('latin1', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (!/^[A-Z]{4}$/.test(tag) || body + len > buf.length) break;
    if (tag === 'BKHD' && len >= 8) {
      out.version = buf.readUInt32LE(body);
      out.bankId = buf.readUInt32LE(body + 4);
    } else if (tag === 'DIDX') didx = [body, len];
    else if (tag === 'DATA') data = body;
    else if (tag === 'HIRC' && len >= 4) {
      const n = buf.readUInt32LE(body);
      let o = body + 4;
      for (let i = 0; i < n && o + 9 <= body + len; i++) {
        const type = buf.readUInt8(o);
        const l = buf.readUInt32LE(o + 1);
        if (l < 4 || o + 5 + l > body + len) break;
        out.objects.push({ type, id: buf.readUInt32LE(o + 5), body: buf.subarray(o + 5, o + 5 + l) });
        o += 5 + l;
      }
    }
    off = body + len;
  }
  if (didx) {
    for (let i = didx[0]; i + 12 <= didx[0] + didx[1]; i += 12) {
      out.media.push({ id: buf.readUInt32LE(i), offset: data >= 0 ? data + buf.readUInt32LE(i + 4) : -1, size: buf.readUInt32LE(i + 8) });
    }
  }
  return out;
}

const SOUND = 2;
const ACTION = 3;
const EVENT = 4;

/** The ids of the events a bank holds (what it can be asked to play). */
function bankEvents(bank) {
  return bank ? bank.objects.filter((o) => o.type === EVENT).map((o) => o.id) : [];
}

/**
 * Which media a bank's event plays.
 * @param {Buffer} buf the bank
 * @param {{ event?: number, known?: (id: number) => boolean }} o
 *   event: the event's id (fnv1 of "Play_<song>"); known: is there an audio file with this id?
 * @returns {{ ids: number[], via: 'event'|'sounds'|'none', hasEvent: boolean, embedded: Map<number, number> }}
 *   ids: media ids, in the order found; via 'event' = followed Event → Action → Sound;
 *   'sounds' = the event wasn't in the bank (or didn't lead to a sound), so every sound in it;
 *   embedded: id → bytes held inside the bank itself
 */
function bankSongMedia(buf, { event = 0, known = () => false } = {}) {
  const bank = parseBank(buf);
  const none = { ids: [], via: 'none', hasEvent: false, embedded: new Map() };
  if (!bank) return none;
  const embedded = new Map(bank.media.map((m) => [m.id, m.size]));
  const real = (id) => id !== 0 && (embedded.has(id) || known(id));
  const u32 = (b, o) => (o + 4 <= b.length ? b.readUInt32LE(o) : 0);
  // a Sound: id, plug-in, stream type, source id, file id (bank versions 56–120); the media id
  // is the source id, else the file id; other layouts: the first id nearby that is real media
  const mediaOf = (body) => {
    for (const o of [12, 16]) if (real(u32(body, o))) return u32(body, o);
    for (let o = 4; o <= 28; o++) if (real(u32(body, o))) return u32(body, o);
    return 0;
  };
  const sounds = new Map();
  for (const o of bank.objects) if (o.type === SOUND) sounds.set(o.id, mediaOf(o.body));
  const actions = new Map(bank.objects.filter((o) => o.type === ACTION).map((o) => [o.id, o.body]));
  const ev = event ? bank.objects.find((o) => o.type === EVENT && o.id === event) : null;
  const ids = [];
  const add = (id) => id && !ids.includes(id) && ids.push(id);
  if (ev) {
    // Event: id, how many actions, their ids; Action: id, kind (2 bytes), the object it plays
    for (let o = 4; o + 4 <= ev.body.length; o++) {
      const act = actions.get(u32(ev.body, o));
      if (!act) continue;
      for (const t of [6, 5, 7, 8]) if (sounds.has(u32(act, t))) { add(sounds.get(u32(act, t))); break; }
    }
    if (ids.length) return { ids, via: 'event', hasEvent: true, embedded };
  }
  for (const m of sounds.values()) add(m);
  return { ids, via: ids.length ? 'sounds' : 'none', hasEvent: !!ev, embedded };
}

module.exports = { fnv1, parseBank, bankEvents, bankSongMedia };
