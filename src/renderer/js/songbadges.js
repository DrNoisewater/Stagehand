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

/** [{ id, label, title }] for a library song. */
export function songBadges(s) {
  if (!s) return [];
  const out = [];
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

export function badgesHtml(s) {
  return songBadges(s).map((x) => `<span class="sbadge sb-${x.id}" title="${esc(x.title)}">${esc(x.label)}</span>`).join('');
}
