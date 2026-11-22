/**
 * 4.5: small badges on songs (Songs list, tiles, Discover) from your real data:
 *   Never played · New best (this week) · Nearly mastered (86–94%) · Song of the week · Recently added
 * At most two per song, most useful first, so a row never turns into a sticker wall.
 */
import { state } from './store.js';
import { L } from './rewards.js';
import { esc } from './ui.js';

const WEEK = 7 * 24 * 3600 * 1000;
let pbCache = { at: 0, ids: new Set() };

function recentBests() {
  const st = L.st;
  if (!st || !st.timeline) return pbCache.ids;
  if (pbCache.st === st) return pbCache.ids;
  const since = Date.now() - WEEK;
  pbCache = { st, ids: new Set(st.timeline.filter((e) => e.type === 'best' && e.at >= since && e.songId).map((e) => e.songId)) };
  return pbCache.ids;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", 11 → "11th", 22 → "22nd". */
export function ordinal(n) {
  const v = Math.round(Number(n) || 0);
  const t = v % 100;
  return `${v}${t >= 11 && t <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'}`;
}
/** "Capo on 2nd fret" (4.26). */
export const capoLabel = (n) => `Capo on ${ordinal(n)} fret`;

const PART = { lead: 'Lead', rhythm: 'Rhythm', combo: 'Combo', bass: 'Bass' };
/**
 * 4.26: the capo a song needs, per part: { fret, label, parts: [{ name, fret }], differs } or null.
 * The shown part is the song's main one; the others are listed when they don't agree.
 */
export function capoOf(s) {
  if (!s) return null;
  const arrs = (s.arrangements || []).filter((a) => PART[a.type] && !a.bonus && a.represent !== false);
  const parts = arrs.map((a) => ({ name: PART[a.type], fret: Number(a.capo) || 0 }));
  const main = Number(s.capo) || (parts.find((p) => p.fret > 0) || {}).fret || 0;
  if (!main) return null;
  const differs = parts.some((p) => p.fret !== main);
  return { fret: main, label: capoLabel(main), parts, differs };
}

/** [{ id, label, title }] for a library song. */
export function songBadges(s) {
  if (!s) return [];
  const out = [];
  const capo = capoOf(s);
  if (capo) {
    const each = capo.differs ? ` ${capo.parts.map((p) => `${p.name}: ${p.fret ? `fret ${p.fret}` : 'no capo'}`).join(', ')}.` : '';
    out.push({ id: 'capo', label: capo.label, short: `Capo ${capo.fret}`, title: `Requires a capo: put it on the ${ordinal(capo.fret)} fret.${each}` });
  }
  const b = state.best && state.best[s.id];
  const best = b && b.best !== undefined ? b.best : null;
  const played = best !== null || (s.user && s.user.lastPlayed);
  const st = L.st;
  const wk = st && st.weekly && st.weekly.find((c) => c.songId === s.id && !c.done);
  if (wk) out.push({ id: 'challenge', label: 'Song of the week', title: `${wk.name} (+${wk.xp} XP)` });
  if (recentBests().has(s.id)) out.push({ id: 'pb', label: 'New best', title: 'You beat your best on this one this week' });
  if (best !== null && best >= 0.86 && best < 0.95) out.push({ id: 'nearly', label: 'Nearly mastered', title: `Your best is ${Math.round(best * 100)}%: 95% (and two runs at 90%+) masters it` });
  if (!played) out.push({ id: 'never', label: 'Never played', title: 'You haven’t played this one yet: new songs earn XP' });
  if ((s.addedAt || 0) >= Date.now() - WEEK) out.push({ id: 'added', label: 'New', title: 'Added to your library this week' });
  return out.slice(0, 2);
}

/** short: a row has little room, so the capo reads "Capo 2" there (the full words are in its tooltip, tiles and details). */
export function badgesHtml(s, { short = false } = {}) {
  return songBadges(s).map((x) => `<span class="sbadge sb-${x.id}" title="${esc(x.title)}">${esc(short && x.short ? x.short : x.label)}</span>`).join('');
}
