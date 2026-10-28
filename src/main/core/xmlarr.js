'use strict';
/**
 * Rocksmith arrangement XML (songs/arr/*.xml, shipped with many custom songs)
 * read into the same tab shape as sng.toTab(). Used when a song has no .sng,
 * and by the tests to check the .sng reader against the readable copy.
 */

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z0-9_]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

const num = (v, d = 0) => (v === undefined || v === '' ? d : Number(v));
const round = (x) => Math.round(x * 1000) / 1000;
const unxml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function tags(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}\\b([^>]*?)(/>|>([\\s\\S]*?)</${name}>)`, 'g'))].map((m) => ({ a: attrs(m[1]), body: m[3] || '' }));
}

function block(xml, name) {
  const m = new RegExp(`<${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${name}>)`).exec(xml);
  return m ? m[1] || '' : '';
}

/** A note's bend curve: [{t (song time), step}]. */
function bendValues(body) {
  return body ? tags(body, 'bendValue').map((b) => ({ t: round(num(b.a.time)), step: num(b.a.step) })) : [];
}

function tech(a) {
  const t = {};
  if (num(a.hammerOn)) t.hammerOn = true;
  if (num(a.pullOff)) t.pullOff = true;
  if (num(a.palmMute)) t.palmMute = true;
  if (num(a.mute)) t.mute = true;
  if (num(a.harmonic)) t.harmonic = true;
  if (num(a.harmonicPinch)) t.pinchHarmonic = true;
  if (num(a.tremolo)) t.tremolo = true;
  if (num(a.tap)) t.tap = true;
  if (num(a.slap, -1) > 0) t.slap = true;
  if (num(a.pluck, -1) > 0) t.pop = true;
  if (num(a.accent)) t.accent = true;
  if (num(a.vibrato)) t.vibrato = true;
  if (num(a.linkNext)) t.linkNext = true;
  if (num(a.slideTo, -1) >= 0) t.slideTo = num(a.slideTo);
  if (num(a.slideUnpitchTo, -1) >= 0) t.slideUnpitchTo = num(a.slideUnpitchTo);
  if (num(a.bend) > 0) t.bend = Math.round(num(a.bend) * 2) / 2;
  // the whole bend: when it moves and how far (in steps), for drawing it exactly
  if (a._bv && a._bv.length) t.bends = a._bv;
  return t;
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

function parseXml(text, { type = 'lead', name = '' } = {}) {
  const xml = String(text);
  if (!/<song\b/.test(xml) || !/<levels\b/.test(xml)) throw new Error('Not a Rocksmith arrangement');
  const tun = attrs((/<tuning\b([^>]*)\/?>/.exec(xml) || [])[1] || '');
  const tuning = [0, 1, 2, 3, 4, 5].map((i) => num(tun[`string${i}`]));
  const beats = tags(block(xml, 'ebeats'), 'ebeat').map((b) => ({ t: round(num(b.a.time)), m: num(b.a.measure, -1) }));
  const sections = tags(block(xml, 'sections'), 'section').map((s) => ({ name: unxml(s.a.name), n: num(s.a.number), start: round(num(s.a.startTime)) }));
  const length = num((/<songLength>([^<]*)</.exec(xml) || [])[1]);
  sections.forEach((s, i) => (s.end = i + 1 < sections.length ? sections[i + 1].start : round(length)));
  const phrases = tags(block(xml, 'phrases'), 'phrase').map((p) => ({ maxDifficulty: num(p.a.maxDifficulty) }));
  const iters = tags(block(xml, 'phraseIterations'), 'phraseIteration').map((p) => ({ start: num(p.a.time), phraseId: num(p.a.phraseId) }));
  const templates = tags(block(xml, 'chordTemplates'), 'chordTemplate').map((c) => ({
    name: unxml(c.a.chordName || c.a.displayName || ''),
    frets: [0, 1, 2, 3, 4, 5].map((i) => num(c.a[`fret${i}`], -1)),
    fingers: [0, 1, 2, 3, 4, 5].map((i) => num(c.a[`finger${i}`], -1)),
    arpeggio: /-arp$/.test(c.a.displayName || ''),
  }));
  const levels = new Map(
    tags(block(xml, 'levels'), 'level').map((l) => [
      num(l.a.difficulty),
      {
        notes: tags(block(l.body, 'notes'), 'note').map((n) => ({ ...n.a, _bv: bendValues(n.body) })),
        chords: tags(block(l.body, 'chords'), 'chord').map((c) => ({ a: c.a, notes: tags(c.body, 'chordNote').map((n) => ({ ...n.a, _bv: bendValues(n.body) })) })),
        handShapes: tags(block(l.body, 'handShapes'), 'handShape').map((h) => h.a),
        anchors: tags(block(l.body, 'anchors'), 'anchor').map((a) => ({ t: num(a.a.time), fret: num(a.a.fret), width: num(a.a.width, 4) })),
      },
    ])
  );
  const notes = [];
  const chordEvents = [];
  const anchors = [];
  iters.forEach((it, i) => {
    const end = i + 1 < iters.length ? iters[i + 1].start : Infinity;
    const phrase = phrases[it.phraseId];
    const level = levels.get(phrase ? phrase.maxDifficulty : 0);
    if (!level) return;
    const inside = (time) => time >= it.start - 0.0005 && time < end - 0.0005;
    for (const a of level.anchors) if (inside(a.t)) anchors.push({ t: round(a.t), fret: a.fret, width: a.width });
    for (const n of level.notes) {
      const time = num(n.time);
      if (!inside(time)) continue;
      notes.push({ t: round(time), s: num(n.string), f: num(n.fret), sus: round(num(n.sustain)), ...tech(n) });
    }
    for (const c of level.chords) {
      const time = num(c.a.time);
      if (!inside(time)) continue;
      const id = num(c.a.chordId);
      const tpl = templates[id];
      const strings = c.notes.length
        ? c.notes.map((n) => ({ s: num(n.string), f: num(n.fret), ...tech({ ...n, palmMute: n.palmMute || c.a.palmMute, accent: n.accent || c.a.accent, mute: n.mute || c.a.fretHandMute }) }))
        : (tpl ? tpl.frets : []).map((f, s) => (f >= 0 ? { s, f, ...tech({ palmMute: c.a.palmMute, mute: c.a.fretHandMute, accent: c.a.accent }) } : null)).filter(Boolean);
      const sus = c.notes.length ? Math.max(...c.notes.map((n) => num(n.sustain))) : 0;
      chordEvents.push({ t: round(time), chord: id, sus: round(sus), strings });
    }
  });
  notes.sort((a, b) => a.t - b.t || a.s - b.s);
  chordEvents.sort((a, b) => a.t - b.t);
  markLinks(notes, chordEvents);
  anchors.sort((a, b) => a.t - b.t);
  anchors.forEach((a, i) => (a.end = i + 1 < anchors.length ? anchors[i + 1].t : round(length)));
  const maxLevel = levels.get(Math.max(...levels.keys())) || { handShapes: [] };
  return {
    name,
    type,
    strings: type === 'bass' ? 4 : 6,
    tuning,
    capo: num((/<capo>([^<]*)</.exec(xml) || [])[1]),
    length: round(length),
    beats,
    sections,
    chords: templates,
    notes,
    chordEvents,
    anchors,
    handShapes: maxLevel.handShapes.map((h) => ({ chord: num(h.chordId), start: round(num(h.startTime)), end: round(num(h.endTime)) })),
    tones: tags(block(xml, 'tones'), 'tone').map((t) => ({ time: num(t.a.time), id: num(t.a.id) })),
    events: tags(block(xml, 'events'), 'event').map((e) => ({ t: round(num(e.a.time)), name: e.a.code })),
  };
}

module.exports = { parseXml };
