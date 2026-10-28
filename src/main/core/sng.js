'use strict';
/**
 * Rocksmith 2014 arrangement files (.sng): decrypting, reading, and turning
 * them into a playable tab (every note at the hardest difficulty).
 *
 * Layout follows Rocksmith2014.NET (MIT): AES-256-CTR with the public PC key,
 * then zlib, then little-endian records.
 */
const crypto = require('crypto');
const zlib = require('zlib');

const KEY_PC = Buffer.from('CB648DF3D12A16BF71701414E69619EC171CCA5D2A142E3E59DE7ADDA18A3A30', 'hex');
const KEY_MAC = Buffer.from('9821330E34B91F70D0A48CBD625993126970CEA09192C0E6CDA676CC9838289D', 'hex');

// Note mask bits
const M = {
  CHORD: 0x2,
  OPEN: 0x4,
  FRET_HAND_MUTE: 0x8,
  TREMOLO: 0x10,
  HARMONIC: 0x20,
  PALM_MUTE: 0x40,
  SLAP: 0x80,
  PLUCK: 0x100,
  HAMMER_ON: 0x200,
  PULL_OFF: 0x400,
  SLIDE: 0x800,
  BEND: 0x1000,
  SUSTAIN: 0x2000,
  TAP: 0x4000,
  PINCH_HARMONIC: 0x8000,
  VIBRATO: 0x10000,
  MUTE: 0x20000,
  IGNORE: 0x40000,
  UNPITCHED_SLIDE: 0x400000,
  ACCENT: 0x4000000,
  PARENT: 0x08000000, // held into the next note (linkNext)
  CHILD: 0x10000000, // carried on from the previous note: not picked again
  ARPEGGIO: 0x20000000,
};

/** Decrypts and inflates an .sng; returns the plain record bytes. */
function unpack(buf, platform = 'pc') {
  if (buf.length < 24) throw new Error('Arrangement file is too short');
  const le = platform !== 'mac';
  const magic = le ? buf.readUInt32LE(0) : buf.readUInt32BE(0);
  if (magic !== 0x4a) throw new Error('Not a Rocksmith arrangement file');
  const iv = buf.subarray(8, 24);
  const decipher = crypto.createDecipheriv('aes-256-ctr', platform === 'mac' ? KEY_MAC : KEY_PC, iv);
  const plain = Buffer.concat([decipher.update(buf.subarray(24)), decipher.final()]);
  // u32 plain length, then a zlib stream (a signature may trail it).
  return zlib.inflateSync(plain.subarray(4), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
}

class Reader {
  constructor(buf) {
    this.b = buf;
    this.p = 0;
  }
  i8() {
    return this.b.readInt8(this.p++);
  }
  u8() {
    return this.b[this.p++];
  }
  i16() {
    const v = this.b.readInt16LE(this.p);
    this.p += 2;
    return v;
  }
  i32() {
    const v = this.b.readInt32LE(this.p);
    this.p += 4;
    return v;
  }
  u32() {
    const v = this.b.readUInt32LE(this.p);
    this.p += 4;
    return v;
  }
  f32() {
    const v = this.b.readFloatLE(this.p);
    this.p += 4;
    return v;
  }
  f64() {
    const v = this.b.readDoubleLE(this.p);
    this.p += 8;
    return v;
  }
  skip(n) {
    this.p += n;
  }
  str(n) {
    const s = this.b.subarray(this.p, this.p + n);
    this.p += n;
    const z = s.indexOf(0);
    return s.toString('utf8', 0, z < 0 ? n : z);
  }
  arr(fn) {
    const n = this.i32();
    if (n < 0 || n > 5e6) throw new Error('Arrangement file is damaged');
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = fn(this);
    return out;
  }
}

const readBend = (r) => {
  const time = r.f32();
  const step = r.f32();
  r.skip(4);
  return { time, step };
};
const readBend32 = (r) => {
  const vals = [];
  for (let i = 0; i < 32; i++) vals.push(readBend(r));
  const used = r.i32();
  return vals.slice(0, Math.max(0, Math.min(32, used)));
};

/** Parses the plain record bytes into the parts a tab view needs. */
function parse(buf) {
  const r = new Reader(buf);
  const beats = r.arr((r) => ({ time: r.f32(), measure: r.i16(), beat: r.i16(), phraseIteration: r.i32(), mask: r.i32() }));
  const phrases = r.arr((r) => {
    const solo = r.i8();
    const disparity = r.i8();
    const ignore = r.i8();
    r.skip(1);
    return { solo, disparity, ignore, maxDifficulty: r.i32(), iterationCount: r.i32(), name: r.str(32) };
  });
  const chords = r.arr((r) => {
    const mask = r.u32();
    const frets = [];
    const fingers = [];
    for (let i = 0; i < 6; i++) frets.push(r.i8());
    for (let i = 0; i < 6; i++) fingers.push(r.i8());
    r.skip(24); // MIDI notes
    return { mask, frets, fingers, name: r.str(32) };
  });
  const chordNotes = r.arr((r) => {
    const mask = [];
    for (let i = 0; i < 6; i++) mask.push(r.u32());
    const bends = [];
    for (let i = 0; i < 6; i++) bends.push(readBend32(r));
    const slideTo = [];
    for (let i = 0; i < 6; i++) slideTo.push(r.i8());
    const slideUnpitchTo = [];
    for (let i = 0; i < 6; i++) slideUnpitchTo.push(r.i8());
    const vibrato = [];
    for (let i = 0; i < 6; i++) vibrato.push(r.i16());
    return { mask, bends, slideTo, slideUnpitchTo, vibrato };
  });
  const vocals = r.arr((r) => ({ time: r.f32(), note: r.i32(), length: r.f32(), lyric: r.str(48) }));
  if (vocals.length) {
    r.arr((r) => r.skip(32)); // symbol headers
    r.arr((r) => r.skip(128 + 16)); // symbol textures
    r.arr((r) => r.skip(12 + 32)); // symbol definitions
  }
  const phraseIterations = r.arr((r) => ({ phraseId: r.i32(), start: r.f32(), end: r.f32(), difficulty: [r.i32(), r.i32(), r.i32()] }));
  r.arr((r) => r.skip(16)); // phrase extra info
  r.arr((r) => {
    r.i32();
    r.arr((r) => r.i32());
  }); // new linked difficulties
  r.arr((r) => r.skip(4 + 256)); // actions
  const events = r.arr((r) => ({ time: r.f32(), name: r.str(256) }));
  const tones = r.arr((r) => ({ time: r.f32(), id: r.i32() }));
  r.arr((r) => r.skip(8)); // DNAs
  const sections = r.arr((r) => {
    const name = r.str(32);
    const number = r.i32();
    const start = r.f32();
    const end = r.f32();
    r.skip(8 + 36);
    return { name, number, start, end };
  });
  const levels = r.arr((r) => {
    const difficulty = r.i32();
    const anchors = r.arr((r) => {
      const a = { start: r.f32(), end: r.f32() };
      r.skip(8);
      a.fret = r.i8();
      r.skip(3);
      a.width = r.i32();
      r.skip(4);
      return a;
    });
    r.arr((r) => r.skip(4 + 1 + 4 + 2 + 1)); // anchor extensions
    const handShapes = r.arr((r) => ({ chordId: r.i32(), start: r.f32(), end: r.f32(), first: r.f32(), last: r.f32() }));
    const arpeggios = r.arr((r) => ({ chordId: r.i32(), start: r.f32(), end: r.f32(), first: r.f32(), last: r.f32() }));
    const notes = r.arr((r) => {
      const n = { mask: r.u32() };
      r.skip(8); // flags, hash
      n.time = r.f32();
      n.string = r.i8();
      n.fret = r.i8();
      n.anchorFret = r.i8();
      n.anchorWidth = r.i8();
      n.chordId = r.i32();
      n.chordNotesId = r.i32();
      n.phraseId = r.i32();
      n.phraseIteration = r.i32();
      r.skip(4 + 2 + 2 + 2); // fingerprints, next/prev/parent
      n.slideTo = r.i8();
      n.slideUnpitchTo = r.i8();
      n.leftHand = r.i8();
      n.tap = r.i8();
      n.pickDirection = r.i8();
      n.slap = r.i8();
      n.pluck = r.i8();
      n.vibrato = r.i16();
      n.sustain = r.f32();
      n.maxBend = r.f32();
      n.bends = r.arr(readBend);
      return n;
    });
    r.arr((r) => r.f32());
    r.arr((r) => r.i32());
    r.arr((r) => r.i32());
    return { difficulty, anchors, handShapes, arpeggios, notes };
  });
  const meta = {};
  meta.maxScore = r.f64();
  r.skip(24);
  meta.firstBeatLength = r.f32();
  meta.startTime = r.f32();
  meta.capo = r.i8();
  r.str(32);
  meta.part = r.i16();
  meta.songLength = r.f32();
  meta.tuning = r.arr((r) => r.i16());
  r.f32();
  meta.firstNoteTime = r.f32();
  meta.maxDifficulty = r.i32();
  return { beats, phrases, chords, chordNotes, vocals, phraseIterations, events, tones, sections, levels, meta };
}

/**
 * Linked notes (Rocksmith's linkNext): a note held into the next one on the
 * same string (usually to slide or bend off it) is ONE pick, not two. The
 * following note gets `linked` so the highway draws one continuous note and
 * scoring doesn't ask you to pick it again.
 */
function markLinks(notes, chordEvents) {
  const all = [];
  for (const n of notes) all.push({ t: n.t, s: n.s, n });
  for (const c of chordEvents) for (const x of c.strings) all.push({ t: c.t, s: x.s, n: x });
  all.sort((a, b) => a.t - b.t);
  const last = new Map();
  for (const e of all) {
    const prev = last.get(e.s);
    if (prev && prev.n.linkNext && e.t - prev.t < (prev.n.sus || 0) + 0.25) e.n.linked = true;
    last.set(e.s, e);
  }
}

function techFromMask(mask, extra = {}) {
  const t = {};
  if (mask & M.HAMMER_ON) t.hammerOn = true;
  if (mask & M.PULL_OFF) t.pullOff = true;
  if (mask & M.PALM_MUTE) t.palmMute = true;
  if (mask & M.FRET_HAND_MUTE || mask & M.MUTE) t.mute = true;
  if (mask & M.HARMONIC) t.harmonic = true;
  if (mask & M.PINCH_HARMONIC) t.pinchHarmonic = true;
  if (mask & M.TREMOLO) t.tremolo = true;
  if (mask & M.TAP) t.tap = true;
  if (mask & M.SLAP) t.slap = true;
  if (mask & M.PLUCK) t.pop = true;
  if (mask & M.ACCENT) t.accent = true;
  if (mask & M.VIBRATO || extra.vibrato) t.vibrato = true;
  if (mask & M.PARENT) t.linkNext = true;
  if (mask & M.CHILD) t.linked = true;
  if (extra.slideTo >= 0) t.slideTo = extra.slideTo;
  if (extra.slideUnpitchTo >= 0) t.slideUnpitchTo = extra.slideUnpitchTo;
  if (extra.bend > 0) t.bend = Math.round(extra.bend * 2) / 2;
  // the whole bend curve (song time, steps), for drawing it exactly
  if (extra.bends && extra.bends.length) t.bends = extra.bends.map((b) => ({ t: round(b.time), step: Math.round(b.step * 100) / 100 }));
  return t;
}

/**
 * Every note as Rocksmith plays it at the hardest level: each phrase
 * iteration's notes come from the level matching that phrase's max difficulty.
 */
function toTab(sng, { type = 'lead', tuning = null, capo = null, name = '' } = {}) {
  const byDiff = new Map(sng.levels.map((l) => [l.difficulty, l]));
  const notes = [];
  const chordEvents = [];
  const anchors = [];
  sng.phraseIterations.forEach((pi, idx) => {
    const phrase = sng.phrases[pi.phraseId];
    const level = byDiff.get(phrase ? phrase.maxDifficulty : 0) || sng.levels[sng.levels.length - 1];
    if (!level) return;
    for (const a of level.anchors) {
      if (a.start >= pi.start - 0.001 && a.start < pi.end - 0.001) anchors.push({ t: round(a.start), end: round(a.end), fret: a.fret, width: a.width });
    }
    for (const n of level.notes) {
      if (n.phraseIteration !== idx) continue;
      if (n.mask & M.CHORD && n.chordId >= 0 && sng.chords[n.chordId]) {
        const ch = sng.chords[n.chordId];
        const cn = n.chordNotesId >= 0 ? sng.chordNotes[n.chordNotesId] : null;
        const strings = [];
        ch.frets.forEach((fret, s) => {
          if (fret < 0) return;
          const mask = cn ? cn.mask[s] : 0;
          const bend = cn && cn.bends[s].length ? Math.max(...cn.bends[s].map((b) => b.step)) : 0;
          strings.push({
            s,
            f: fret,
            ...techFromMask(mask | (n.mask & (M.PALM_MUTE | M.FRET_HAND_MUTE | M.ACCENT)), {
              slideTo: cn ? cn.slideTo[s] : -1,
              slideUnpitchTo: cn ? cn.slideUnpitchTo[s] : -1,
              vibrato: cn ? cn.vibrato[s] : 0,
              bend,
              bends: cn ? cn.bends[s] : null,
            }),
          });
        });
        chordEvents.push({ t: round(n.time), chord: n.chordId, sus: round(n.sustain), strings });
      } else if (n.string >= 0 && n.fret >= 0) {
        notes.push({
          t: round(n.time),
          s: n.string,
          f: n.fret,
          sus: round(n.sustain),
          ...techFromMask(n.mask, { slideTo: n.slideTo, slideUnpitchTo: n.slideUnpitchTo, vibrato: n.vibrato, bend: n.maxBend, bends: n.bends }),
        });
      }
    }
  });
  notes.sort((a, b) => a.t - b.t || a.s - b.s);
  chordEvents.sort((a, b) => a.t - b.t);
  markLinks(notes, chordEvents);
  anchors.sort((a, b) => a.t - b.t);
  const isBass = type === 'bass';
  const t = tuning || sng.meta.tuning || [];
  return {
    name,
    type,
    strings: isBass ? 4 : 6,
    tuning: Array.from({ length: 6 }, (_, i) => Number(t[i]) || 0),
    capo: capo !== null ? capo : Math.max(0, sng.meta.capo),
    length: round(sng.meta.songLength),
    beats: sng.beats.map((b) => ({ t: round(b.time), m: b.mask & 1 ? b.measure : -1 })), // m >= 0 starts a bar
    sections: sng.sections.map((s) => ({ name: s.name, n: s.number, start: round(s.start), end: round(s.end) })),
    chords: sng.chords.map((c) => ({ name: c.name, frets: c.frets, fingers: c.fingers, arpeggio: !!(c.mask & 1) })),
    notes,
    chordEvents,
    anchors,
    handShapes: (() => {
      const lv = byDiff.get(sng.meta.maxDifficulty) || sng.levels[sng.levels.length - 1] || { handShapes: [], arpeggios: [] };
      return [...lv.handShapes, ...lv.arpeggios].map((h) => ({ chord: h.chordId, start: round(h.start), end: round(h.end) })).sort((a, b) => a.start - b.start);
    })(),
    tones: sng.tones,
    events: sng.events.map((e) => ({ t: round(e.time), name: e.name })),
  };
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

module.exports = { unpack, parse, toTab, M };
