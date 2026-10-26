'use strict';
/**
 * A song's own Rocksmith tones (manifest Tones + Tone_Base/A–D, and the timed
 * switches in the .sng) mapped onto Stagehand's amp presets, so the rig can
 * follow the song's tone changes.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** "Amp_OrangeAD50" -> "Orange AD50"; "Pedal_SpringReverb" -> "Spring Reverb" */
function pretty(key) {
  return String(key || '')
    .replace(/^(Bass_)?(Amp|Cab|Pedal|Rack)_/i, '')
    .replace(/_(Condenser|Dynamic|Ribbon|Tube)_.*$/i, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function descriptors(tone) {
  return (tone.ToneDescriptors || []).map((d) => String(d).replace(/^\$\[\d+\]/, '').trim().toUpperCase());
}

function knob(values, suffix) {
  const k = Object.keys(values || {}).find((x) => x.toLowerCase().endsWith(`_${suffix}`));
  return k === undefined ? null : Number(values[k]);
}

/** GearList slot name → engine slot and order. */
function slotOf(name) {
  const n = String(name || '');
  if (/^amp$/i.test(n)) return { slot: 'amp', order: 0 };
  if (/^cab/i.test(n)) return { slot: 'cab', order: 0 };
  const m = /^(prepedal|postpedal|rack)(\d*)$/i.exec(n);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  return { slot: kind === 'prepedal' ? 'pre' : kind === 'postpedal' ? 'post' : 'rack', order: Number(m[2]) || 0 };
}

/** Picks the closest Stagehand preset and knob settings for one Rocksmith tone. */
function mapTone(tone, type) {
  const gear = tone.GearList || {};
  const items = Object.entries(gear)
    .filter(([, g]) => g && g.Key)
    .map(([slot, g]) => ({ slot, key: g.Key, type: g.Type || '', category: g.Category || '', knobs: g.KnobValues || {} }));
  const amp = items.find((g) => /amp/i.test(g.type) || /^(bass_)?amp_/i.test(g.key));
  const cab = items.find((g) => /cab/i.test(g.type) || /^(bass_)?cab_/i.test(g.key));
  const pedals = items.filter((g) => g !== amp && g !== cab);
  const desc = descriptors(tone);
  const text = `${tone.Name || ''} ${tone.Key || ''} ${desc.join(' ')} ${items.map((g) => `${g.key} ${g.category}`).join(' ')}`.toLowerCase();
  const ampGain = amp ? knob(amp.knobs, 'gain') ?? knob(amp.knobs, 'drive') ?? knob(amp.knobs, 'volume') : null;
  const g = ampGain === null ? null : clamp01(ampGain / 100);
  const has = (re) => re.test(text);
  const driven = has(/distort|overdrive|fuzz|high ?gain|metal|drive|screamer|muff|crunch/);
  let preset;
  if (type === 'bass') {
    preset = driven || (g !== null && g > 0.6) ? 'bass-grit' : 'bass-clean';
  } else if (desc.includes('FUZZ') || has(/fuzz|muff/)) preset = 'fuzz';
  else if (desc.includes('HIGH GAIN') || has(/metal|djent|high ?gain|brutal|5150|tremendous|recto|mesa/)) preset = 'metal';
  else if (desc.includes('CLEAN') || desc.includes('ACOUSTIC') || (!driven && g !== null && g < 0.3)) preset = 'clean';
  else if (has(/\blead\b|\bsolo\b/) && driven) preset = 'lead';
  else if (desc.includes('OVERDRIVE') || has(/overdrive|screamer|\bod\b/)) preset = 'overdrive';
  else if (desc.includes('DISTORTION') || has(/distort/)) preset = g !== null && g >= 0.7 ? 'metal' : 'crunch';
  else if (g !== null) preset = g < 0.3 ? 'clean' : g < 0.55 ? 'crunch' : g < 0.75 ? 'overdrive' : 'metal';
  else preset = driven ? 'crunch' : 'clean';

  const tone3 = (name) => {
    const v = amp ? knob(amp.knobs, name) : null;
    return v === null || !Number.isFinite(v) ? 0.5 : clamp01(0.5 + (v - 50) / 200);
  };
  const fxMix = pedals.reduce((m, p) => {
    if (!/reverb|delay|echo|chorus|flang|phase/i.test(`${p.key} ${p.category}`)) return m;
    const mix = knob(p.knobs, 'mix') ?? knob(p.knobs, 'level');
    return Math.max(m, mix === null ? 0.5 : clamp01(mix / 60));
  }, 0);
  const chain = items
    .map((g) => {
      const at = slotOf(g.slot);
      if (!at) return null;
      const knobs = {};
      for (const [k, v] of Object.entries(g.knobs || {})) if (Number.isFinite(Number(v))) knobs[k] = Number(v);
      return { slot: at.slot, order: at.order, key: String(g.key), knobs };
    })
    .filter(Boolean);
  return {
    kind: type === 'bass' ? 'bass' : 'guitar',
    gear: chain,
    key: tone.Key || tone.Name,
    name: String(tone.Name || tone.Key || 'Tone').replace(/_/g, ' '),
    preset,
    knobs: {
      gain: g === null ? null : clamp01(0.15 + g * 0.8),
      bass: tone3('bass'),
      mid: tone3('mid'),
      treble: tone3('treble'),
      fx: fxMix ? clamp01(0.3 + fxMix * 0.5) : 0.35,
    },
    amp: amp ? pretty(amp.key) : null,
    pedals: pedals.map((p) => pretty(p.key)).filter(Boolean),
    descriptors: desc.map((d) => d[0] + d.slice(1).toLowerCase()),
  };
}

/**
 * @param attrs manifest Attributes for the arrangement
 * @param changes [{time, id}] from the .sng (id 0–3 = Tone_A–D)
 */
function songTones(attrs, changes, type) {
  const list = Array.isArray(attrs && attrs.Tones) ? attrs.Tones : [];
  if (!list.length) return null;
  const tones = list.map((t) => mapTone(t, type));
  const byKey = new Map(tones.map((t) => [String(t.key).toLowerCase(), t]));
  const slot = [attrs.Tone_A, attrs.Tone_B, attrs.Tone_C, attrs.Tone_D];
  const find = (k) => (k ? byKey.get(String(k).toLowerCase()) : null);
  const base = find(attrs.Tone_Base) || find(attrs.Tone_A) || tones[0];
  const timeline = (changes || [])
    .map((c) => {
      const t = find(slot[c.id]);
      return t ? { t: Math.round(c.time * 1000) / 1000, key: t.key } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
  return { base: base.key, tones, changes: timeline };
}

module.exports = { songTones, mapTone, pretty };
