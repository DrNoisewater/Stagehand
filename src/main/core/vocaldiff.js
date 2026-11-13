'use strict';
/**
 * How hard a song is to sing (4.14, for the Karaoke page), from its lyric chart:
 * how many syllables a minute, how wide the tune goes, how far it jumps.
 * Rocksmith gives its vocals part no difficulty, so this is ours.
 * In: [{ t, d, w, p }] (p: the MIDI note; 0, 254 and 255 mean "no note").
 */
const NAMES = ['Easy', 'Steady', 'Medium', 'Hard', 'Brutal'];
const clamp = (x) => Math.max(0, Math.min(1, x));
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];

function vocalDifficulty(lyrics) {
  const syl = (lyrics || []).filter((v) => v && String(v.w || '').trim());
  if (syl.length < 8) return null;
  const start = syl[0].t;
  const end = syl[syl.length - 1].t + (syl[syl.length - 1].d || 0);
  const minutes = Math.max(0.25, (end - start) / 60);
  const rate = syl.length / minutes;
  const pitched = syl.filter((v) => v.p > 0 && v.p < 128);
  let range = 0;
  let leap = 0;
  let low = null;
  let high = null;
  if (pitched.length >= 20) {
    const notes = pitched.map((v) => v.p).sort((a, b) => a - b);
    low = pct(notes, 0.05);
    high = pct(notes, 0.95);
    range = pct(notes, 0.9) - pct(notes, 0.1);
    let sum = 0;
    let n = 0;
    for (let i = 1; i < pitched.length; i++) {
      if (pitched[i].t - (pitched[i - 1].t + (pitched[i - 1].d || 0)) > 2) continue; // a new phrase
      sum += Math.abs(pitched[i].p - pitched[i - 1].p);
      n++;
    }
    leap = n ? sum / n : 0;
  }
  const r = clamp((rate - 50) / 150);
  const score = pitched.length >= 20 ? 0.45 * r + 0.35 * clamp((range - 5) / 15) + 0.2 * clamp((leap - 1) / 4) : r;
  const level = 1 + Math.round(score * 4);
  return { level, name: NAMES[level - 1], rate: Math.round(rate), range, low, high, syllables: syl.length };
}

module.exports = { vocalDifficulty, NAMES };
