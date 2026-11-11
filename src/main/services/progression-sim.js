'use strict';
/**
 * 4.5: simulates a year (or any span) of playing through the real levels.compute(), so the
 * curve in progression-config.js can be checked: "how long does level 100 take?".
 * Used by the developer menu (Validate XP balancing) and test/progression-sim.test.js.
 *
 * A player is a few habits: how often they play, how long, how many songs are new, how
 * often they finish a song, and how good they are (getting better as they go).
 */
const { compute, dayKey, weekKey, FIRSTS } = require('./levels');

const DAY = 24 * 60 * 60 * 1000;

/** Small seeded random (mulberry32), so a simulation gives the same answer every time. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROFILES = {
  casual: { name: 'Casual (2 days a week, 30 min)', daysPerWeek: 2, minutes: 30, newRate: 0.35, fullRate: 0.6, skill0: 0.62, skill1: 0.78, tries: 0.4 },
  regular: { name: 'Regular, dedicated (4–5 days a week, 45 min)', daysPerWeek: 4.5, minutes: 45, newRate: 0.3, fullRate: 0.72, skill0: 0.68, skill1: 0.88, tries: 0.8 },
  heavy: { name: 'Heavy (6 days a week, 90 min)', daysPerWeek: 6, minutes: 90, newRate: 0.28, fullRate: 0.75, skill0: 0.7, skill1: 0.92, tries: 1 },
};

/**
 * @param {object} o
 * @param {string|object} [o.profile] a PROFILES key or a profile object
 * @param {number} [o.days] how long
 * @param {number} [o.seed]
 * @param {number} [o.start] first day (ms)
 * @returns {{ profile, byDay: {day, level, xp}[], levelAt: {level: dayIndex}, final }}
 */
function simulate({ profile = 'regular', days = 365, seed = 7, start = new Date(2026, 0, 5, 12).getTime(), librarySize = 3000 } = {}) {
  const P = typeof profile === 'string' ? PROFILES[profile] : profile;
  const r = rng(seed);
  const songs = {};
  const tunings = ['E Standard', 'E Standard', 'E Standard', 'Eb Standard', 'Drop D', 'D Standard', 'Drop C', 'C Standard'];
  for (let i = 0; i < librarySize; i++) songs[`s${i}`] = { title: `Song ${i}`, artist: `Artist ${i % 700}`, tuning: tunings[i % tunings.length] };
  const ids = Object.keys(songs);
  const sessions = [];
  const did = {};
  const daily = {};
  const done = {};
  const trophies = {};
  const familiar = new Map(); // songId -> plays
  const working = [];
  const pickNew = () => ids[Math.floor(r() * ids.length)];
  const tryIds = FIRSTS.filter((f) => !f.auto).map((f) => f.id);
  const out = { profile: P.name, byDay: [], levelAt: {}, final: null };
  let st = null;
  for (let d = 0; d < days; d++) {
    const t0 = start + d * DAY;
    const progress = d / Math.max(1, days);
    const skill = P.skill0 + (P.skill1 - P.skill0) * Math.min(1, progress * 1.4);
    if (r() < P.daysPerWeek / 7) {
      let left = P.minutes * (0.6 + r() * 0.8) * 60;
      let at = t0 + 18 * 3600 * 1000;
      while (left > 60) {
        const isNew = !working.length || r() < P.newRate;
        const id = isNew ? pickNew() : working[Math.floor(r() * working.length)];
        if (isNew) working.push(id), working.length > 25 && working.shift();
        const plays = familiar.get(id) || 0;
        familiar.set(id, plays + 1);
        const length = 150 + Math.floor(r() * 180);
        const full = r() < P.fullRate;
        const seconds = Math.min(left, full ? length : 40 + r() * (length - 40));
        const slow = plays === 0 && r() < 0.2;
        const acc = Math.max(0.2, Math.min(1, skill - 0.12 + Math.min(0.14, plays * 0.025) + (r() - 0.5) * 0.14));
        const notes = Math.round((full ? 1 : seconds / length) * (200 + r() * 500));
        const hit = Math.round(notes * acc);
        const nSec = 6 + Math.floor(r() * 6);
        const sections = [];
        for (let i = 0; i < nSec; i++) {
          const n = Math.round(notes / nSec);
          sections.push([`S${i}`, Math.min(n, Math.round(n * Math.min(1, acc + (r() - 0.5) * 0.25))), n]);
        }
        sessions.push({
          songId: id, part: r() < 0.12 ? 'bass' : r() < 0.3 ? 'rhythm' : 'lead', seconds: Math.round(seconds), accuracy: acc, notes, hit,
          speed: slow ? 0.75 : 1, at: Math.round(at), full, tuning: songs[id].tuning, bestStreak: Math.round(acc * acc * 60 + r() * 40),
          kinds: { chord: [Math.round(hit * 0.22), Math.round(notes * 0.22)], bend: [Math.round(hit * 0.05), Math.round(notes * 0.05)], slide: [Math.round(hit * 0.04), Math.round(notes * 0.04)], legato: [Math.round(hit * 0.06), Math.round(notes * 0.06)] }, sections,
        });
        at += seconds * 1000 + 20000;
        left -= seconds + 20;
      }
      // trying things: early on mostly
      if (r() < P.tries * 0.25 * (1 - progress)) {
        const id = tryIds[Math.floor(r() * tryIds.length)];
        if (!did[id]) did[id] = t0 + 19 * 3600 * 1000;
      }
      const dk = dayKey(t0);
      daily[dk] = ['tone-try', 'slow', 'repeat'].filter(() => r() < 0.3);
      // end of the day: challenges finished today are kept, as Levels.state() does
      const now = t0 + 23 * 3600 * 1000;
      st = compute({ sessions, did, daily, done, trophies, songs, since: start, now });
      for (const c of [...st.challenges, ...st.weekly]) if (c.value >= c.target && !done[c.key]) done[c.key] = { xp: c.xp, at: now, name: c.name, kind: c.kind };
      Object.assign(trophies, st.reached);
    }
    if (d % 7 === 6 || d === days - 1) {
      st = compute({ sessions, did, daily, done, trophies, songs, since: start, now: t0 + 23.5 * 3600 * 1000 });
      out.byDay.push({ day: d + 1, level: st.level, xp: st.xp });
      for (let l = 2; l <= st.level; l++) if (out.levelAt[l] === undefined) out.levelAt[l] = d + 1;
    }
  }
  out.final = { level: st ? st.level : 1, xp: st ? st.xp : 0, sessions: sessions.length, venues: st ? st.unlocked.length : 0 };
  return out;
}

/** A small table for the developer menu: level reached after 1 week … 1 year, per profile. */
function balanceReport({ days = 365, seed = 7 } = {}) {
  const marks = [7, 30, 91, 182, 273, 365].filter((x) => x <= days);
  const rows = [];
  for (const [id, p] of Object.entries(PROFILES)) {
    const sim = simulate({ profile: id, days, seed });
    const at = (d) => (sim.byDay.find((x) => x.day >= d) || sim.byDay[sim.byDay.length - 1]).level;
    rows.push({ id, name: p.name, levels: marks.map((m) => ({ day: m, level: at(m) })), day100: sim.levelAt[100] || null, final: sim.final });
  }
  return { marks, rows };
}

module.exports = { simulate, balanceReport, PROFILES, rng, weekKey };
