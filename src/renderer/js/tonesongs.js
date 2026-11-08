/**
 * Song tones, made findable (4.1.9). No page code, so tests can run it.
 *   - each tone gets a character (clean, crunch, high gain, lead) and a short line of
 *     gear: "High gain · Mesa Dual Rectifier · tube drive, graphic EQ"
 *   - the same tone used by many songs is shown once ("also in 3 more songs")
 *   - grouped by song or by artist; search matches artist, song, tone, amp, pedals
 *     and character; filters for guitar or bass and the character
 *
 * User: "search for distortion, you get thousands…"
 */
import { gearInfo, gearName, ampGain } from './gearspec.js';
import { AMPS, PEDALS } from './tonerecipes.js';
import { normText } from './searchmatch.js';

export const CHARACTERS = [
  ['clean', 'Clean'],
  ['crunch', 'Crunch'],
  ['heavy', 'Heavy'],
  ['lead', 'Lead'],
];
const LABEL = { clean: 'Clean', crunch: 'Crunch', heavy: 'High gain', lead: 'Lead' };
// words a search can use for each character
const WORDS = { clean: 'clean', crunch: 'crunch overdrive drive', heavy: 'heavy high gain metal distortion', lead: 'lead solo' };

// Rocksmith amps that are high gain whatever the knobs say
const HIGH_GAIN = /^Amp_(CA100|CA85|GB100|GB50|HG\d+|EN50|EN30|BT15|BT30|MarshallDSL100H|MarshallJVM410H|OrangeRockerverb|OrangeTinyTerror|OrangeOR100)$/i;
const CLEAN_AMP = /^Amp_(TW|AT|CS|Gibson|Epiphone)/i;

const friendly = new Map();
for (const list of Object.values(AMPS)) for (const a of list) friendly.set(a.key, a.name);
const pedalNames = new Map();
for (const list of Object.values(PEDALS)) for (const p of list) pedalNames.set(p.key, p.name);

/** The amp's name a player knows ("Mesa Dual Rectifier"), else the game's name for it. */
export function ampName(key, { amps = null } = {}) {
  if (!key) return '';
  if (friendly.has(key)) return friendly.get(key);
  if (amps && amps[key]) {
    const a = AMPS.guitar.concat(AMPS.bass).find((x) => x.pack === amps[key]);
    if (a) return a.name;
  }
  return gearName(key);
}

const category = (key) => String((gearInfo(key) && gearInfo(key).c) || '');
const pedalsOf = (tone) => (tone.gear || []).filter((g) => g && g.key && g.slot !== 'amp' && g.slot !== 'cab' && !g.bypass);
const ampOf = (tone) => (tone.gear || []).find((g) => g && g.slot === 'amp');

/** clean | crunch | heavy | lead: what the tone is for. */
export function toneCharacter(tone) {
  const name = normText(`${tone.name || ''} ${tone.key || ''}`);
  const desc = (tone.descriptors || []).map((d) => normText(d));
  const has = (w) => desc.includes(w);
  if (/\b(lead|solo)\b/.test(name) || has('lead')) return 'lead';
  if (has('high gain') || has('distortion') || has('fuzz')) return 'heavy';
  if (has('crunch') || has('overdrive')) return 'crunch';
  if (has('clean') || has('acoustic')) return 'clean';
  if (/\b(clean|acoustic|cln)\b/.test(name)) return 'clean';
  if (/\b(dist|distortion|metal|heavy|hi ?gain|high ?gain|fuzz|chug|brutal)\b/.test(name)) return 'heavy';
  if (/\b(crunch|drive|od|overdrive|dirty|rock)\b/.test(name)) return 'crunch';
  // from the gear: how hard the amp is driven, and what's in front of it
  const amp = ampOf(tone);
  const g = amp ? ampGain(tone) : 0.3;
  const drives = pedalsOf(tone).filter((p) => p.slot === 'pre' && /distortion/i.test(category(p.key)));
  const hard = drives.some((p) => /Metal|Buzz|Fuzz|Shred|Distortion|Custom/i.test(p.key) && !/Bass_Pedal_BassOverdrive/i.test(p.key));
  const hiAmp = amp && HIGH_GAIN.test(amp.key);
  if (hard || (hiAmp && g >= 0.45) || g >= 0.85) return 'heavy';
  if (drives.length || g >= (amp && CLEAN_AMP.test(amp.key) ? 0.6 : 0.42)) return 'crunch';
  return 'clean';
}

/** { kind, character, label, amp, pedals, text }: the tone in a few plain words. */
export function describeTone(tone, opts = {}) {
  const kind = tone.kind === 'bass' ? 'bass' : 'guitar';
  const character = toneCharacter(tone);
  const amp = ampOf(tone);
  const ampN = amp ? ampName(amp.key, opts) : '';
  const seen = new Set();
  const pedals = [];
  for (const p of pedalsOf(tone)) {
    const n = pedalNames.get(p.key) || gearName(p.key);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    pedals.push(n);
  }
  const label = kind === 'bass' ? (character === 'clean' ? 'Clean bass' : character === 'lead' ? 'Bass lead' : 'Driven bass') : LABEL[character];
  const main = pedals.slice(0, 3).map((n) => n.toLowerCase());
  const text = [label, ampN, main.join(', ') + (pedals.length > 3 ? ` +${pedals.length - 3}` : '')].filter(Boolean).join(' · ');
  return { kind, character, label, amp: ampN, pedals, text };
}

/** Same gear, same knobs = the same tone (songs in a pack often share one). */
export function toneSignature(tone) {
  const gear = [...(tone.gear || [])]
    .filter((g) => g && g.key && !g.bypass)
    .map((g) => `${g.slot}:${g.key}:${Object.entries(g.knobs || {}).map(([k, v]) => `${String(k).toLowerCase().replace(/^.*_/, '')}=${Math.round(Number(v) * 10) / 10}`).sort().join(',')}`)
    .sort();
  return `${tone.kind === 'bass' ? 'bass' : 'guitar'}|${gear.join('|')}`;
}

/**
 * Song tones, grouped and filtered.
 * library: [{ songId, title, artist, tones: [{ key, name, kind, part, gear, descriptors }] }]
 * Returns { groups: [{ id, title, sub, items }], count, total, hidden } where each item is
 * { songId, title, artist, tone, desc, also: [song titles that share it] }.
 */
export function groupSongTones(library, { query = '', kind = 'all', character = 'all', by = 'song', amps = null, limit = 400 } = {}) {
  const songs = [...(library || [])].sort((a, b) => normText(a.artist).localeCompare(normText(b.artist)) || normText(a.title).localeCompare(normText(b.title)));
  // one entry per distinct tone; the first song (by artist, then title) owns it
  const bySig = new Map();
  let total = 0;
  for (const s of songs) {
    for (const t of s.tones || []) {
      if (!t || !(t.gear || []).length) continue;
      total++;
      const sig = toneSignature(t);
      const had = bySig.get(sig);
      if (had) {
        if (had.songId !== s.songId && !had.also.includes(s.title)) had.also.push(s.title);
        continue;
      }
      bySig.set(sig, { songId: s.songId, title: s.title || '', artist: s.artist || '', tone: { ...t, kind: t.kind === 'bass' ? 'bass' : 'guitar' }, desc: describeTone(t, { amps }), also: [] });
    }
  }
  const terms = normText(query).split(' ').filter(Boolean);
  const match = (it) => {
    if (kind !== 'all' && it.desc.kind !== kind) return false;
    if (character !== 'all' && it.desc.character !== character) return false;
    if (!terms.length) return true;
    const hay = ` ${normText(`${it.artist} ${it.title} ${it.tone.name || ''} ${it.desc.amp} ${it.desc.pedals.join(' ')} ${it.desc.label} ${WORDS[it.desc.character]} ${it.desc.kind} ${it.also.join(' ')}`)}`;
    return terms.every((w) => hay.includes(` ${w}`) || (w.length >= 4 && hay.includes(w)));
  };
  const items = [...bySig.values()].filter(match);
  const groups = new Map();
  for (const it of items) {
    const id = by === 'artist' ? `a:${normText(it.artist)}` : `s:${it.songId}`;
    if (!groups.has(id)) groups.set(id, { id, title: by === 'artist' ? it.artist || 'Unknown artist' : it.title, sub: by === 'artist' ? '' : it.artist, items: [] });
    groups.get(id).items.push(it);
  }
  const order = { clean: 0, crunch: 1, heavy: 2, lead: 3 };
  const out = [...groups.values()];
  for (const g of out) {
    g.items.sort((a, b) => (a.desc.kind === b.desc.kind ? 0 : a.desc.kind === 'bass' ? 1 : -1) || order[a.desc.character] - order[b.desc.character] || a.title.localeCompare(b.title));
    if (by === 'artist') g.sub = `${new Set(g.items.map((i) => i.songId)).size} song${new Set(g.items.map((i) => i.songId)).size === 1 ? '' : 's'}`;
  }
  // stop at about `limit` tones (whole groups), so the page stays quick
  const shown = [];
  let n = 0;
  for (const g of out) {
    if (n >= limit) break;
    shown.push(g);
    n += g.items.length;
  }
  return { groups: shown, count: items.length, total, distinct: bySig.size, hidden: Math.max(0, items.length - n) };
}
