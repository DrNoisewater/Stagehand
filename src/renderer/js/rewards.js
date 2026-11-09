/**
 * Levels on this side (4.4): `did('looper')` when you try something, the points you
 * just earned as a small note, and a big "Level up" when you reach a new level.
 * The points themselves are worked out in services/levels.js.
 *   import { did, L } from './rewards.js';
 *   did('looper');            // safe to call any time, as often as you like
 *   L.st                      // { xp, level, tier, challenges, firsts, unlocks, … } or null
 */
import { api } from './api.js';
import { on, emit } from './store.js';
import { h, toast } from './ui.js';

export const L = { st: null };
const seen = new Set(); // points already shown
let ready = false;
const asked = new Set(); // ids sent this run (so a busy feature doesn't call home every time)

export async function loadLevels() {
  let st = null;
  try {
    st = await api.levels.state();
  } catch (_) {
    return L.st; // (no levels: an older bridge or a test page)
  }
  take(st);
  return L.st;
}

/** You tried something (see FIRSTS in services/levels.js). Quietly does nothing if it's not known. */
export function did(id) {
  if (!id || !api.levels) return;
  const day = new Date().toDateString();
  if (asked.has(`${day}:${id}`)) return;
  asked.add(`${day}:${id}`);
  api.levels.did(id).then(take).catch(() => {});
}

/** Whether a highway venue is open at your level (everything is, until levels have loaded). */
export function venueLock(id) {
  const st = L.st;
  if (!st || !st.unlocks) return 0;
  const u = st.unlocks.find((x) => x.venue === id);
  return u && st.level < u.level ? u.level : 0;
}

function take(st) {
  if (!st || typeof st.xp !== 'number') return;
  const was = L.st;
  L.st = st;
  const fresh = st.recent.filter((a) => !seen.has(a.key));
  for (const a of st.recent) seen.add(a.key);
  if (ready && was) {
    if (st.level > was.level) levelUp(was, st);
    else if (fresh.length) {
      const xp = fresh.reduce((n, a) => n + a.xp, 0);
      const why = [...new Set(fresh.map((a) => a.why))];
      toast({ title: `+${xp} XP`, message: why.slice(0, 3).join(' · ') + (why.length > 3 ? ' …' : ''), kind: 'ok', timeout: 4200 });
    }
  }
  ready = true;
  emit('levels', st);
}

/** The big moment: the new level, the pass it comes with, anything it opens up. */
function levelUp(was, st) {
  const opened = (st.unlocks || []).filter((u) => u.level > was.level && u.level <= st.level);
  const newTier = st.tier.id !== was.tier.id;
  const box = h(`div.lvup.tier-${st.tier.id}`, { role: 'status' },
    h('div.lvup-burst'),
    h('div.lvup-card', null,
      h('small', { text: 'Level up!' }),
      h('b.lvup-n', { text: String(st.level) }),
      h('span.lvup-tier', { text: newTier ? `New pass: ${st.tier.name}` : st.tier.name }),
      opened.length ? h('span.lvup-new', { text: `Unlocked: ${opened.map((u) => `${u.name} venue`).join(', ')}` }) : null,
      h('button.btn.small.primary', { type: 'button', text: 'Rock on', onclick: () => close() })));
  const close = () => {
    box.classList.add('out');
    setTimeout(() => box.remove(), 400);
  };
  document.body.append(box);
  setTimeout(close, 6500);
}

on('stats', () => loadLevels());
loadLevels();
