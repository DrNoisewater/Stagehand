'use strict';
/**
 * How hard a song is to sing (4.14, for the Karaoke page; 4.19: a firmer grip), from its words
 * and notes. Rocksmith gives its vocals part no difficulty, so this is ours.
 *
 * The user (4.19): "Karaoke mode needs to have a better grip on how easy, medium or hard a song is."
 * What was wrong: the pace was counted over the whole song (a long solo made fast singing look slow),
 * charts with made-up notes (one note all through) looked easy, and breath wasn't counted at all.
 *
 * Now four things are measured, each from 0 to 1:
 * - speed: syllables a minute while singing (breaks left out), and in the fastest passages
 * - range: how far the tune goes from low to high
 * - jumps: how far it moves from one note to the next
 * - breath: how long the lines run without a rest
 * A song is as hard as its mix, pulled towards its hardest side (one very hard thing makes a hard song).
 * Notes that are plainly made up (hardly more than one note) are left out: the mark then goes by
 * speed and breath, and says so (`guess`).
 *
 * In: [{ t, d, w, p }] (p: the MIDI note; 0, 254 and 255, or null, mean "no note").
 */
const NAMES = ['Easy', 'Medium', 'Hard'];
const clamp = (x) => Math.max(0, Math.min(1, x));
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
const REST = 0.45; // a gap this long is a breath
const PHRASE = 2; // a gap this long is a new phrase

function vocalDifficulty(lyrics) {
  const syl = (lyrics || []).filter((v) => v && String(v.w === undefined ? 'x' : v.w || '').trim() && Number.isFinite(v.t)).sort((a, b) => a.t - b.t);
  if (syl.length < 8) return null;
  const end = (v) => v.t + Math.max(0, v.d || 0);

  // --- speed: while singing, and in the fastest passages
  let sung = 0; // seconds spent in phrases
  let from = syl[0].t;
  const breaths = []; // how long each stretch runs without a rest
  let breathFrom = syl[0].t;
  for (let i = 1; i <= syl.length; i++) {
    const gap = i < syl.length ? syl[i].t - end(syl[i - 1]) : Infinity;
    if (gap > REST) {
      breaths.push(end(syl[i - 1]) - breathFrom);
      if (i < syl.length) breathFrom = syl[i].t;
    }
    if (gap > PHRASE) {
      sung += Math.max(0.5, end(syl[i - 1]) - from);
      if (i < syl.length) from = syl[i].t;
    }
  }
  const rate = syl.length / (Math.max(15, sung) / 60);
  // the busiest five seconds (9 in 10 of the song is slower)
  const wins = [];
  for (let i = 0, j = 0; i < syl.length; i++) {
    while (j < syl.length && syl[j].t < syl[i].t + 5) j++;
    wins.push((j - i) * 12);
  }
  wins.sort((a, b) => a - b);
  const fast = pct(wins, 0.9);
  const speed = 0.6 * clamp((rate - 80) / 160) + 0.4 * clamp((fast - 130) / 230);

  // --- breath: the long lines (9 in 10 are shorter)
  breaths.sort((a, b) => a - b);
  const line = pct(breaths, 0.9);
  const breath = clamp((line - 5) / 10);

  // --- the tune: only when the notes are real ones
  const pitched = syl.filter((v) => v.p > 0 && v.p < 128);
  let range = 0;
  let leap = 0;
  let low = null;
  let high = null;
  let tune = false;
  if (pitched.length >= 20 && pitched.length >= syl.length * 0.4) {
    const notes = pitched.map((v) => v.p).sort((a, b) => a - b);
    const counts = new Map();
    for (const n of notes) counts.set(Math.round(n), (counts.get(Math.round(n)) || 0) + 1);
    const top = Math.max(...counts.values());
    // made up: nearly every word on one note (a real tune never is)
    tune = !(counts.size <= 2 || top / notes.length > 0.8);
    if (tune) {
      low = pct(notes, 0.05);
      high = pct(notes, 0.95);
      range = Math.round((high - low) * 10) / 10;
      let sum = 0;
      let n = 0;
      for (let i = 1; i < pitched.length; i++) {
        if (pitched[i].t - end(pitched[i - 1]) > PHRASE) continue; // a new phrase
        sum += Math.abs(pitched[i].p - pitched[i - 1].p);
        n++;
      }
      leap = n ? sum / n : 0;
    }
  }
  const wide = clamp((range - 7) / 12);
  const jumps = clamp((leap - 1.5) / 3);

  const mix = tune ? 0.35 * speed + 0.3 * wide + 0.15 * jumps + 0.2 * breath : 0.65 * speed + 0.35 * breath;
  const worst = Math.max(speed, tune ? wide : 0, breath * 0.8);
  const score = Math.round(clamp(0.6 * mix + 0.4 * worst) * 100) / 100;
  const level = score < 0.3 ? 1 : score < 0.55 ? 2 : 3;

  // why, in plain words: what makes it hard (or easy)
  const why = [];
  if (speed >= 0.55) why.push('fast words');
  if (tune && wide >= 0.55) why.push('a wide tune, low to high');
  if (tune && jumps >= 0.55) why.push('big jumps between notes');
  if (breath >= 0.55) why.push('long lines without a breath');
  if (!why.length && level === 1) {
    if (speed < 0.25) why.push('unhurried words');
    if (tune && wide < 0.3) why.push('a narrow tune');
    if (breath < 0.3) why.push('short lines');
  }
  return { level, name: NAMES[level - 1], score, rate: Math.round(rate), fast: Math.round(fast), range: Math.round(range), leap: Math.round(leap * 10) / 10, line: Math.round(line), low, high, syllables: syl.length, guess: !tune, why };
}

module.exports = { vocalDifficulty, NAMES };
