/**
 * Levels on this side (4.4): `did('looper')` when you try something, the points you
 * just earned as a small note, a trophy note for a finished challenge, a card for a
 * new trophy, and a big "Level up" when you reach a new level.
 * The points themselves are worked out in services/levels.js.
 *   import { did, L } from './rewards.js';
 *   did('looper');            // safe to call any time, as often as you like
 *   L.st                      // { xp, level, tier, challenges, firsts, unlocks, … } or null
 */
import { api } from './api.js';
import { on, emit } from './store.js';
import { h, toast } from './ui.js';

export const L = { st: null, previewAll: false };
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

/** Wear a title you've earned on your Backstage pass (null: the joke line). */
export async function wearTitle(id) {
  if (!api.levels || !api.levels.title) return;
  take(await api.levels.title(id || null));
}

/**
 * Whether a highway venue is open (0) or the level it opens at. 4.5: venues kept from before,
 * and developer overrides, come from the state's `venues` list. Everything is open until
 * levels have loaded (or with the developer menu's "preview locked content").
 */
export function venueLock(id) {
  const st = L.st;
  if (!st || L.previewAll) return 0;
  if (st.venues) {
    const v = st.venues.find((x) => x.venue === id);
    return v && !v.unlocked ? v.level : 0;
  }
  const u = (st.unlocks || []).find((x) => x.venue === id);
  return u && st.level < u.level ? u.level : 0;
}
/** XP still needed before a venue opens (0 when it's open). */
export function venueXpLeft(id) {
  const st = L.st;
  const v = st && st.venues && st.venues.find((x) => x.venue === id);
  if (!v || v.unlocked || !st.levelXp) return 0;
  return Math.max(0, (st.levelXp[v.level] || 0) - st.xp);
}

function take(st) {
  if (!st || typeof st.xp !== 'number') return;
  const was = L.st;
  L.st = st;
  const fresh = st.recent.filter((a) => !seen.has(a.key));
  for (const a of st.recent) seen.add(a.key);
  if (ready && was) {
    const done = fresh.filter((a) => a.key.startsWith('c:'));
    const trophies = fresh.filter((a) => a.key.startsWith('t:'));
    const rest = fresh.filter((a) => !done.includes(a) && !trophies.includes(a));
    for (const a of done) trophyToast('Challenge done!', `${a.why.replace(/^Challenge: /, '')} · +${a.xp} XP`);
    if (st.level > was.level) levelUp(was, st);
    else if (rest.length) {
      const xp = rest.reduce((n, a) => n + a.xp, 0);
      const why = [...new Set(rest.map((a) => a.why))];
      toast({ title: `+${xp} XP`, message: why.slice(0, 3).join(' · ') + (why.length > 3 ? ' …' : ''), kind: 'ok', timeout: 4200 });
    }
    for (const a of trophies.slice(0, 2)) trophyCard(a, st);
    if (trophies.length > 2) trophyToast(`${trophies.length - 2} more achievements`, 'See them in Progress › Achievements');
  }
  ready = true;
  emit('levels', st);
}

const CUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" fill="currentColor"/><path d="M7 6H4.5a2.5 2.5 0 0 0 3 3.5M17 6h2.5a2.5 2.5 0 0 1-3 3.5M12 14v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/** A finished challenge: a note with a trophy on it. */
function trophyToast(title, message) {
  toast({ title, message, kind: 'ok', timeout: 5200 });
  const el = document.querySelector('.toasts')?.lastElementChild;
  if (!el) return;
  el.classList.add('lv-toast');
  const ic = el.querySelector('svg');
  if (ic) ic.outerHTML = CUP;
}

/** Cards wait their turn, so a level up and a trophy don't land on top of each other. */
const cards = [];
function showCard(make, ms) {
  const run = () => {
    const box = make();
    const close = () => {
      if (box.classList.contains('out')) return;
      box.classList.add('out');
      setTimeout(() => {
        box.remove();
        cards.shift();
        if (cards.length) cards[0]();
      }, 400);
    };
    box.querySelector('button').onclick = close;
    box.addEventListener('click', (e) => e.target === box && close());
    document.body.append(box);
    setTimeout(close, ms);
  };
  cards.push(run);
  if (cards.length === 1) run();
}

/** A new trophy (or a better metal on one): a smaller card than a level up. */
export function trophyCard(a, st) {
  const [, id, i] = a.key.split(':');
  const t = (st.trophies || []).find((x) => x.id === id);
  if (!t) return;
  const metal = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legendary'][Number(i)] || 'bronze';
  const title = (st.titles || []).find((x) => x.earned && x.how === `${metal[0].toUpperCase()}${metal.slice(1)} in ${t.name}`);
  showCard(() => h(`div.lvup.lv-trophy-up.metal-${metal}`, { role: 'status' },
    h('div.lvup-card', null,
      h('span.lv-cup', { html: CUP }),
      h('small', { text: 'Achievement unlocked' }),
      h('b.lv-tname', { text: t.name }),
      h('span.lvup-tier', { text: `${metal[0].toUpperCase()}${metal.slice(1)} · +${a.xp} XP` }),
      title ? h('span.lvup-new', { text: `New title: ${title.name}. Wear it on your pass in Progress.` }) : null,
      h('button.btn.small.primary', { type: 'button', text: 'Nice' }))), 5000);
}

/**
 * The big moment: the new level, the pass it comes with, anything it opens up.
 * 4.5: milestone levels (5, 10, 20, 25 … 100) get a bigger stage: a poster, lights and,
 * at 100, the legendary card. Exported for the developer menu's "trigger celebration".
 */
const MILESTONE_WORDS = { 5: 'Out of the garage', 10: 'First real gig', 20: 'Headlining the bar circuit', 25: 'Quarter of the way', 30: 'Tour bus booked', 40: 'Big rooms now', 50: 'Halfway to legend', 60: 'Arena sound', 70: 'Festival main stage', 75: 'Hall of Fame pass', 80: 'Stadium lights', 90: 'Elite company', 100: 'Legendary' };
export function levelUp(was, st) {
  const opened = (st.venues || st.unlocks || []).filter((u) => u.level > was.level && u.level <= st.level);
  const newTier = st.tier.id !== was.tier.id;
  const milestones = [5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  const big = milestones.filter((m) => m > was.level && m <= st.level).pop();
  const legendary = st.level >= 100 && was.level < 100;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  showCard(() => h(`div.lvup.tier-${st.tier.id}${big ? '.milestone' : ''}${legendary ? '.legendary' : ''}${reduced ? '.calm' : ''}`, { role: 'status' },
    h('div.lvup-burst'),
    big ? h('div.lvup-lights', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')) : null,
    h('div.lvup-card', null,
      h('small', { text: legendary ? 'Level 100. You made it.' : big ? `Milestone · ${MILESTONE_WORDS[big] || 'Level up!'}` : 'Level up!' }),
      h('b.lvup-n', { text: String(st.level) }),
      h('span.lvup-tier', { text: newTier ? `New pass: ${st.tier.name}` : st.tier.name }),
      opened.length ? h('span.lvup-new', { text: `Unlocked: ${opened.map((u) => `${u.name} venue`).join(', ')}` }) : null,
      legendary ? h('span.lvup-new', { text: 'Valhalla is open. A year of playing, right here.' }) : null,
      h('button.btn.small.primary', { type: 'button', text: legendary ? 'Take a bow' : 'Rock on' }))), big ? 9000 : 6500);
}

on('stats', () => loadLevels());
loadLevels();
